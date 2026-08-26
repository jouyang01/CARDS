"""build_glb_fbx2gltf.py — the Blender-free path from a Mixamo folder to one .glb.

    npx --yes fbx2gltf --version          # once: puts the binary in node_modules
    python3 tools/art/build_glb_fbx2gltf.py wisp path/to/mixamo/folder \
        --exe node_modules/fbx2gltf/bin/Linux/FBX2glTF

Same contract as `build_glb.py` — same input folder layout, same clip naming,
same `<id>.clips.json` beside the `.glb` — and it writes to the same place, so
the two are interchangeable from the client's point of view. It exists because
`build_glb.py` needs Blender, and because the Blender path **corrupted the root
bone's translation** on Wisp.

## What was wrong with the Blender-built asset

Measured from the shipped `wisp.glb`, Hips bind translation `(0.00, 0.14, -1.09)`
against per-clip tracks reaching `(20.48, -15.94, 31.32)`. Through the
`Armature`'s +90° X that is **tens of metres**, mostly straight down, on a rig
whose hips stand 1.09 m off the floor: `wisp_idle` alone sat between 10 and 23
metres out. Two of the owner's reports are that number — *"Wisp is floating
above the ground and is outside of her tile confines"* — and MODEL-ROOT-LOCK
was written to pin **every** axis precisely because no per-axis rule survives
garbage of that size.

The same FBX files through fbx2gltf come out in metres, in place: `wisp_idle`
holds Y between 1.05 and 1.08 against a 1.09 bind — a 3 cm breath — and the
clips that genuinely travel (`knocked_down`, 2.2 m of it) travel by amounts a
body could. Nothing here fixes anything: it just does not break it.

## Why the output is orientation-identical to the Blender one

Blender's exporter writes `Armature` with a +90° X rotation and Hips with -90° X
under it, which cancel; fbx2gltf writes a plain `RootNode` and puts the same
pose on Hips directly. Composing the first pair gives the second exactly —
`R(+90°X)·(x, y, z) = (x, -z, y)`, and `(-0.00101, 0.14307, -1.09193)` maps to
`(-0.00101, 1.09193, 0.14307)`, which is byte-for-byte what fbx2gltf writes. So
every bone at and below Hips lands in the same world pose, and a model built
here faces the way the renderer already expects.

Bone names keep their colon (`mixamorig:Hips`); GLTFLoader sanitises them to
`mixamorigHips` on load, and `findBone` accepts either, so the manifest's prop
bones and the root lock both still resolve.

Not a replacement for `build_glb.py`: that one also applies the pipeline's own
decimation and material work. This one takes the FBX exactly as it is.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import struct
import subprocess
import sys

GLB_JSON, GLB_BIN = 0x4E4F534A, 0x004E4942
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BYTES_PER_COMPONENT = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    """Split a .glb into its JSON chunk and its binary chunk."""
    blob = open(path, "rb").read()
    if blob[:4] != b"glTF":
        raise SystemExit(f"{path} is not a .glb")
    off, js, bin_ = 12, None, b""
    while off < len(blob):
        length, kind = struct.unpack_from("<II", blob, off)
        off += 8
        chunk = blob[off:off + length]
        off += length
        if kind == GLB_JSON:
            js = json.loads(chunk)
        elif kind == GLB_BIN:
            bin_ = bytes(chunk)
    return js, bytearray(bin_)


def _pad4(buf, fill=b"\x00"):
    return buf + fill * (-len(buf) % 4)


def write_glb(path, js, bin_):
    body = _pad4(bytes(bin_))
    js["buffers"] = [{"byteLength": len(body)}]
    # Spaces, not NULs: the spec pads the JSON chunk with 0x20 and the binary
    # chunk with 0x00, and a trailing NUL is a parse error to anything stricter
    # than a browser's own JSON.parse.
    head = _pad4(json.dumps(js, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(head) + 8 + len(body)
    with open(path, "wb") as out:
        out.write(b"glTF" + struct.pack("<II", 2, total))
        out.write(struct.pack("<II", len(head), GLB_JSON))
        out.write(head)
        out.write(struct.pack("<II", len(body), GLB_BIN))
        out.write(body)


def copy_accessor(src_js, src_bin, index, dst_js, dst_bin):
    """Append one accessor, and the bytes behind it, to `dst`. Returns its index.

    De-interleaves as it copies (`byteStride` is dropped), so the appended view
    is tightly packed whatever the source did — which is what lets every sampler
    get its own view without reasoning about the layout it came from.
    """
    acc = dict(src_js["accessors"][index])
    view = src_js["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    width = BYTES_PER_COMPONENT[acc["componentType"]] * COMPONENTS[acc["type"]]
    stride = view.get("byteStride") or width
    raw = bytearray()
    for i in range(acc["count"]):
        raw += src_bin[start + i * stride: start + i * stride + width]
    dst_bin += b"\x00" * (-len(dst_bin) % 4)
    dst_js["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(dst_bin), "byteLength": len(raw)})
    dst_bin += raw
    acc["bufferView"] = len(dst_js["bufferViews"]) - 1
    acc.pop("byteOffset", None)
    dst_js["accessors"].append(acc)
    return len(dst_js["accessors"]) - 1


def _read_vecs(js, bin_, index):
    """One accessor's rows as lists of floats, de-interleaved."""
    acc = js["accessors"][index]
    view = js["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    n = COMPONENTS[acc["type"]]
    stride = view.get("byteStride") or 4 * n
    return [list(struct.unpack_from(f"<{n}f", bin_, start + i * stride))
            for i in range(acc["count"])]


def _write_vecs(js, bin_, index, rows):
    """Repoint an accessor at a fresh, tightly-packed view holding `rows`."""
    acc = js["accessors"][index]
    n = COMPONENTS[acc["type"]]
    raw = b"".join(struct.pack(f"<{n}f", *r) for r in rows)
    bin_ += b"\x00" * (-len(bin_) % 4)
    js["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(raw)})
    bin_ += raw
    acc["bufferView"] = len(js["bufferViews"]) - 1
    acc.pop("byteOffset", None)
    acc["min"] = [min(r[c] for r in rows) for c in range(n)]
    acc["max"] = [max(r[c] for r in rows) for c in range(n)]


def _read_mat4(js, bin_, index):
    """One MAT4 accessor as a list of 16-float, column-major matrices."""
    acc = js["accessors"][index]
    view = js["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or 64
    return [list(struct.unpack_from("<16f", bin_, start + i * stride))
            for i in range(acc["count"])]


def _write_mat4(js, bin_, index, mats):
    acc = js["accessors"][index]
    raw = b"".join(struct.pack("<16f", *m) for m in mats)
    bin_ += b"\x00" * (-len(bin_) % 4)
    js["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(raw)})
    bin_ += raw
    acc["bufferView"] = len(js["bufferViews"]) - 1
    acc.pop("byteOffset", None)
    acc.pop("min", None)
    acc.pop("max", None)


def _mat_mul(a, b):
    """`a · b`, both column-major 16-float glTF matrices."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def _matrix(node):
    """The node's TRS as a 3x3 linear part and a translation, both row-major."""
    tx, ty, tz = node.get("translation") or [0.0, 0.0, 0.0]
    x, y, z, w = node.get("rotation") or [0.0, 0.0, 0.0, 1.0]
    sx, sy, sz = node.get("scale") or [1.0, 1.0, 1.0]
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    lin = [[rot[r][c] * (sx, sy, sz)[c] for c in range(3)] for r in range(3)]
    return lin, (tx, ty, tz), rot


def _invert_trs(node):
    """`M⁻¹` for a node's TRS, as a column-major glTF matrix.

    Analytic rather than a general 4x4 inverse: `M = T·R·S` with a positive
    scale, so `M⁻¹ = S⁻¹·Rᵀ` for the linear part and `-linear⁻¹·t` for the
    translation. A determinant-based inverse would be one more thing to be
    subtly wrong on a matrix nothing else in this file can check.
    """
    _, (tx, ty, tz), rot = _matrix(node)
    sx, sy, sz = node.get("scale") or [1.0, 1.0, 1.0]
    # Rᵀ scaled by 1/s on the correct side: (R·S)⁻¹ = S⁻¹·Rᵀ.
    inv = [[rot[c][r] / (sx, sy, sz)[r] for c in range(3)] for r in range(3)]
    t = [-sum(inv[r][c] * (tx, ty, tz)[c] for c in range(3)) for r in range(3)]
    return [inv[0][0], inv[1][0], inv[2][0], 0.0,
            inv[0][1], inv[1][1], inv[2][1], 0.0,
            inv[0][2], inv[1][2], inv[2][2], 0.0,
            t[0], t[1], t[2], 1.0]


def bake_mesh_transform(js, bin_):
    """Fold a skinned mesh node's own TRS into its vertices, leaving it identity.

    fbx2gltf leaves the FBX's unit and axis conversion **on the mesh node** —
    Wisp comes out with `scale 100` and a -90° X rotation over centimetre-ish
    vertices. Blender's exporter bakes the same conversion into the vertices and
    ships an identity node. Both render correctly; they measure differently, and
    `modelBounds` (renderer3d.ts) reads GEOMETRY bounds precisely so that the
    Armature's rotation cannot poison the number. Unbaked, it read Wisp's
    0.008-unit local extent as her height and scaled her up 245x.

    Normalising here rather than teaching the renderer a second rule keeps every
    shipped asset the same shape, which is what that measurement assumes.

    The compensation has two halves and BOTH are needed. A skinned vertex is
    `Σ wᵢ · (jointWorldᵢ · IBMᵢ) · p`, and fbx2gltf carries `M` in the IBMs as
    well as on the node — its Hips IBM has `M`'s 100x scale and -90° X sitting
    in the linear part, where the Blender-built file's is the identity. So
    folding `M` into `p` alone applies it **twice**: the first attempt at this
    drew Wisp a hundred times life size, off every edge of the frame, with only
    her dagger — a prop parented to a bone, never skinned — left in view at the
    right size and place. Post-multiplying each IBM by `M⁻¹` cancels the second
    copy exactly: `(IBM · M⁻¹) · (M · p) = IBM · p`.

    Verified rather than reasoned: after both halves, the rebuilt POSITION
    accessor's bounds match the shipped Blender-built file's to the last
    printed digit, and the Hips IBM comes out as its identity-linear one.
    """
    for node in js["nodes"]:
        if "mesh" not in node or "skin" not in node:
            continue
        lin, (tx, ty, tz), rot = _matrix(node)
        if lin == [[1, 0, 0], [0, 1, 0], [0, 0, 1]] and (tx, ty, tz) == (0, 0, 0):
            continue
        for prim in js["meshes"][node["mesh"]]["primitives"]:
            attrs = prim.get("attributes", {})
            if "POSITION" in attrs:
                rows = _read_vecs(js, bin_, attrs["POSITION"])
                _write_vecs(js, bin_, attrs["POSITION"], [[
                    lin[r][0] * p[0] + lin[r][1] * p[1] + lin[r][2] * p[2] + (tx, ty, tz)[r]
                    for r in range(3)] for p in rows])
            # Directions take the rotation only — the scale here is uniform, so
            # renormalising after it would be the identity anyway.
            for key in ("NORMAL", "TANGENT"):
                if key not in attrs:
                    continue
                rows = _read_vecs(js, bin_, attrs[key])
                _write_vecs(js, bin_, attrs[key], [
                    [rot[r][0] * v[0] + rot[r][1] * v[1] + rot[r][2] * v[2] for r in range(3)]
                    + v[3:] for v in rows])
        # …and the other half: take `M` back out of the inverse bind matrices.
        skin = js["skins"][node["skin"]]
        if "inverseBindMatrices" in skin:
            inv = _invert_trs(node)
            _write_mat4(js, bin_, skin["inverseBindMatrices"],
                        [_mat_mul(m, inv) for m in
                         _read_mat4(js, bin_, skin["inverseBindMatrices"])])
        for key in ("translation", "rotation", "scale", "matrix"):
            node.pop(key, None)


def compact(js, bin_):
    """Drop buffer views nothing points at any more, and repack the buffer.

    `bake_mesh_transform` and the clip merge both work by APPENDING a fresh view
    and repointing the accessor, which is the only way to sidestep whatever
    `byteStride` the source used — and which orphans the bytes left behind. On
    Wisp that was 240 kB of dead mesh, enough on its own to put her over the
    2 MiB per-character asset budget.
    """
    used = sorted({a["bufferView"] for a in js.get("accessors", []) if "bufferView" in a}
                  | {i["bufferView"] for i in js.get("images", []) if "bufferView" in i})
    packed, views, remap = bytearray(), [], {}
    for old in used:
        view = dict(js["bufferViews"][old])
        start = view.get("byteOffset", 0)
        raw = bytes(bin_[start:start + view["byteLength"]])
        packed += b"\x00" * (-len(packed) % 4)
        view["byteOffset"] = len(packed)
        packed += raw
        remap[old] = len(views)
        views.append(view)
    js["bufferViews"] = views
    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            acc["bufferView"] = remap[acc["bufferView"]]
    for image in js.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]
    return packed


def slug(name):
    """"Falling Back Death.fbx" -> "falling_back_death" — build_glb.py's rule."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def convert(exe, fbx, out_base):
    """One FBX through fbx2gltf. Returns the .glb it wrote."""
    subprocess.run([exe, "--input", str(fbx), "--output", str(out_base), "--binary"],
                   check=True, capture_output=True)
    return f"{out_base}.glb"


def build(cid, folder, exe, out_dir, work_dir):
    folder = pathlib.Path(folder)
    work_dir = pathlib.Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() == ".fbx")
    # The rigged one is the only file with a mesh — Mixamo calls it "With Skin",
    # and in practice it is the T-Pose. Found by size rather than by name so a
    # folder that named it something else still builds.
    rig = max(files, key=lambda p: p.stat().st_size)
    print(f"  rig: {rig.name}")

    js, bin_ = read_glb(convert(exe, rig, work_dir / "base"))
    # The rigged export carries an empty "mixamo.com" track. Keeping it would put
    # a zero-length animation in the manifest's clip list.
    js["animations"] = []
    bake_mesh_transform(js, bin_)
    by_name = {n.get("name"): i for i, n in enumerate(js["nodes"])}

    exported = []
    for fbx in files:
        if fbx == rig:
            continue
        name = slug(fbx.stem)
        cjs, cbin = read_glb(convert(exe, fbx, work_dir / name))
        animations = cjs.get("animations") or []
        if not animations:
            print(f"  ! {fbx.name}: no animation, skipped")
            continue
        # Mixamo files carry one take; if a file somehow has several, the one
        # with the most channels is the clip and the rest are stubs.
        anim = max(animations, key=lambda a: len(a["channels"]))
        samplers, channels, remap = [], [], {}
        for channel in anim["channels"]:
            node = channel["target"].get("node")
            if node is None:
                continue
            target = by_name.get(cjs["nodes"][node].get("name"))
            if target is None:
                raise SystemExit(
                    f"{fbx.name}: bone {cjs['nodes'][node].get('name')!r} is not in the rig")
            src = channel["sampler"]
            if src not in remap:
                sampler = anim["samplers"][src]
                samplers.append({
                    "input": copy_accessor(cjs, cbin, sampler["input"], js, bin_),
                    "output": copy_accessor(cjs, cbin, sampler["output"], js, bin_),
                    "interpolation": sampler.get("interpolation", "LINEAR"),
                })
                remap[src] = len(samplers) - 1
            channels.append({"sampler": remap[src],
                             "target": {"node": target, "path": channel["target"]["path"]}})
        js["animations"].append({"name": name, "samplers": samplers, "channels": channels})
        exported.append(name)
        seconds = max(js["accessors"][s["input"]]["max"][0] for s in samplers)
        print(f"  {name:<22} {len(channels):>3} channels  {seconds:6.3f}s")

    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cid}.glb"
    write_glb(out, js, compact(js, bin_))
    print(f"\n  -> {out}  ({out.stat().st_size // 1024} kB), {len(exported)} clip(s)")

    # The manifest, written exactly as build_glb.py writes it: the clip map and
    # posture come from data/art/<id>.json, the props survive from whatever
    # build_prop.py last wrote, and `version` is a content hash the client
    # appends as ?v= so a cached rig can never outlive the manifest beside it.
    art_path = ROOT / "data" / "art" / f"{cid}.json"
    art = json.loads(art_path.read_text()) if art_path.exists() else {}
    manifest = out_dir / f"{cid}.clips.json"
    existing = json.loads(manifest.read_text()) if manifest.exists() else {}
    props = existing.get("props")
    manifest.write_text(json.dumps({
        "id": cid,
        "version": hashlib.sha256(out.read_bytes()).hexdigest()[:12],
        "clips": sorted(exported),
        "map": {k: v for k, v in (art.get("clips") or {}).items() if not k.startswith("_")},
        "posture": {k: v for k, v in (art.get("posture") or {}).items() if not k.startswith("_")},
        **({"props": props} if props else {}),
    }, indent=2) + "\n")
    print(f"  -> {manifest.name}")

    named = set((art.get("clips") or {}).get("abilities", {}).values()) | {
        v for k, v in (art.get("clips") or {}).items()
        if isinstance(v, str) and not k.startswith("_")}
    missing = sorted(named - set(exported))
    if missing:
        print(f"\n  ! named by data/art/{cid}.json but not in the .glb: {', '.join(missing)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("id", help="character id, e.g. wisp")
    ap.add_argument("folder", help="folder of Mixamo .fbx files")
    ap.add_argument("--exe", default="node_modules/fbx2gltf/bin/Linux/FBX2glTF",
                    help="the FBX2glTF binary")
    ap.add_argument("--out", default=str(ROOT / "packages/client/public/models"))
    ap.add_argument("--work", default=None, help="scratch dir for the per-clip .glb files")
    args = ap.parse_args()
    if not os.access(args.exe, os.X_OK):
        raise SystemExit(f"no FBX2glTF at {args.exe} — see the module docstring")
    work = args.work or os.path.join(os.path.dirname(args.out) or ".", f".{args.id}-fbx2gltf")
    build(args.id, args.folder, args.exe, args.out, work)


if __name__ == "__main__":
    sys.exit(main())

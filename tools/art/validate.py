"""
validate.py — check a generated body against Mixamo's auto-rig requirements.

    blender --background --python tools/art/validate.py -- aegis

Every check here corresponds to a way the auto-rigger fails or produces a bad
skeleton. Running it takes two seconds; discovering the same problems after
rigging and collecting eight clips does not.
"""

import json
import pathlib
import sys
from collections import defaultdict

import bpy  # noqa: F401

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import generate_character as gc  # noqa: E402

TOL = 1e-4


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print("usage: blender --background --python tools/art/validate.py -- <id>")
        sys.exit(2)
    cid = argv[0]
    spec = json.loads((ROOT / "data" / "art" / f"{cid}.json").read_text())

    gc.clear_scene()
    body = gc.build_body(spec)
    bpy.context.view_layer.update()

    vs = [v.co for v in body.data.vertices]
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    xs = [v.x for v in vs]
    zs = [v.z for v in vs]
    lo, hi = min(zs), max(zs)
    fails = []

    def check(name, ok, detail):
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<22} {detail}")
        if not ok:
            fails.append(name)

    print(f"\n{cid}: {len(vs)} verts, {tris} tris\n")

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    check("single mesh", len(meshes) == 1, f"{len(meshes)} mesh object(s)")
    check("triangle budget", tris < 150_000, f"{tris} (limit 150000)")

    # Symmetry, split into the part that matters and the part that does not.
    #
    # Mixamo's markers go on chin, wrists, elbows, knees and groin. If those
    # LANDMARKS differ between sides the skeleton comes out skewed, and that is
    # a hard failure. Decoration that merely sits over a joint — a heavier
    # pauldron on one shoulder, say — changes vertex counts without moving any
    # landmark, and is a deliberate art choice rather than a defect.
    have = {(round(v.x, 4), round(v.y, 4), round(v.z, 4)) for v in vs}
    asym = [v for v in vs if (round(-v.x, 4), round(v.y, 4), round(v.z, 4)) not in have]
    if asym:
        print(f"  note  asymmetric vertices  {len(asym)}/{len(vs)}, "
              f"z {min(v.z for v in asym):.2f}-{max(v.z for v in asym):.2f} "
              f"(decoration is fine; landmarks are checked below)")

    left = [v for v in vs if v.x < -TOL]
    right = [v for v in vs if v.x > TOL]
    landmarks = []
    for label, pick in (
        ("wrist reach", lambda side: max(abs(v.x) for v in side)),
        ("arm height", lambda side: sorted(side, key=lambda v: -abs(v.x))[0].z),
        ("foot depth", lambda side: min(v.z for v in side)),
        ("leg spread", lambda side: sum(abs(v.x) for v in side if v.z < lo + (hi - lo) * 0.12)
                                    / max(1, sum(1 for v in side if v.z < lo + (hi - lo) * 0.12))),
    ):
        dl, dr = pick(left), pick(right)
        landmarks.append((label, abs(dl - dr)))
    worst = max(d for _, d in landmarks)
    check("joint landmarks", worst < 1e-3,
          ", ".join(f"{n} {d:.5f}" for n, d in landmarks))

    # T-pose: the arm's CENTRELINE must hold one height. Measuring raw z spread
    # instead just measures how thick the hand is.
    cols = defaultdict(list)
    for v in vs:
        if abs(v.x) > (max(xs) * 0.42):
            cols[round(abs(v.x), 2)].append(v.z)
    mids = [(min(z) + max(z)) / 2 for z in cols.values()]
    tilt = max(mids) - min(mids) if mids else 0.0
    check("T-pose arms", tilt < 0.01, f"centreline drift {tilt:.4f}")

    # Fused limbs are the most common auto-rig failure.
    hip = lo + (hi - lo) * 0.30
    midline = [v for v in vs if hip * 0.75 < v.z < hip * 1.15 and abs(v.x) < 0.012]
    check("crotch gap", not midline, "clear" if not midline else f"{len(midline)} verts on midline")

    chest_z = lo + (hi - lo) * 0.68
    torso = [abs(v.x) for v in vs if abs(v.z - chest_z) < 0.06 and abs(v.x) < max(xs) * 0.35]
    arm = [abs(v.x) for v in vs if abs(v.x) > max(xs) * 0.35]
    gap = (min(arm) - max(torso)) if torso and arm else 0.0
    check("armpit gap", gap > 0.0, f"{gap:+.4f}")

    # Legs must hang INSIDE the pelvis. Spreading the stance to unfuse the feet
    # is an easy way to push them outboard of the hip, which reads as legs
    # sprouting from the sides of the torso and is invisible in a front view.
    # Use WINDOWS, not thin slices: a tube only has vertices at its profile
    # stops, so a narrow band can fall between rings and silently match nothing.
    def widest(f0, f1):
        z0, z1 = lo + (hi - lo) * f0, lo + (hi - lo) * f1
        return max((abs(v.x) for v in vs if z0 <= v.z <= z1), default=0.0)

    hip_w = widest(0.42, 0.54)
    leg_w = widest(0.26, 0.40)
    check("legs inside hips", leg_w <= hip_w + 1e-4,
          f"hip {hip_w:.3f} vs leg {leg_w:.3f}"
          + ("" if leg_w <= hip_w else f"  ({leg_w - hip_w:+.3f} overhang)"))

    # Head must clear whatever is under it. A jaw resting exactly on a collar
    # passes every still render and punches through it on the first head turn.
    near_axis = [v for v in vs if abs(v.x) < max(xs) * 0.16 and v.z > lo + (hi - lo) * 0.62]
    if near_axis:
        skinlike = [v.z for v in near_axis if v.z > lo + (hi - lo) * 0.80]
        gap = (min(skinlike) - max(v.z for v in near_axis if v.z < lo + (hi - lo) * 0.80)
               if skinlike else 0.0)
        check("head clears collar", gap > 0.012 or gap < -0.02,
              f"{gap:+.4f} between neck stack and head")

    # Feet on the floor: Mixamo assumes the character stands at the origin.
    check("feet near origin", abs(lo) < 0.12, f"lowest z {lo:+.3f}")

    # ── proportion spec ──────────────────────────────────────────────────────
    # Every one of these encodes a mistake that was made and had to be found by
    # eye. A rule written only in prose gets skipped; a rule that fails the build
    # does not.
    H = hi - lo

    def frac(z):
        return (z - lo) / H

    arm_x = max(xs)
    arm_verts = [v for v in vs if abs(v.x) > arm_x * 0.55]
    arm_z = (min(v.z for v in arm_verts) + max(v.z for v in arm_verts)) / 2

    # Shoulders belong at the top of the ribcage. At 81% up the torso the arms
    # read as sprouting from mid-chest.
    check("shoulder height", 0.72 <= frac(arm_z) <= 0.86,
          f"{frac(arm_z) * 100:.0f}% of height (want 72-86%)")

    # A lowered fingertip should reach mid-thigh — roughly 0.39 of height.
    # Shoulder anchor: the widest TORSO vertex at shoulder height. Measuring the
    # widest thing in that z-window instead returns the outstretched arm itself,
    # which makes the reach come out as ~0.
    shoulder_x = max((abs(v.x) for v in vs
                      if abs(v.x) < arm_x * 0.32 and abs(v.z - arm_z) < H * 0.06),
                     default=0.0)
    reach = arm_x - shoulder_x                  # fingertip minus shoulder
    landing = frac(arm_z - reach)
    check("arm reach", 0.31 <= landing <= 0.47,
          f"lowered fingertip lands at {landing * 100:.0f}% of height (mid-thigh ~39%)")

    # Feet must not fuse. The crotch check covers the upper leg; this is the sole.
    sole = [v for v in vs if v.z < lo + H * 0.09]
    left = [v.x for v in sole if v.x < 0]
    right = [v.x for v in sole if v.x > 0]
    foot_gap = (min(right) - max(left)) if left and right else 0.0
    check("feet separated", foot_gap > 0.008, f"{foot_gap:+.4f} between soles")

    # A pauldron is a cap over the joint, not a sleeve around it. One early
    # version was deeper than the torso and punched out front and back.
    torso_d = max((abs(v.y) for v in vs if abs(v.x) < arm_x * 0.30), default=0.0)
    shoulder_d = max((abs(v.y) for v in vs
                      if arm_x * 0.30 <= abs(v.x) <= arm_x * 0.62), default=0.0)
    check("shoulder bulk", shoulder_d <= torso_d * 1.45,
          f"shoulder depth {shoulder_d:.3f} vs torso {torso_d:.3f}")

    # UV outliers. A face whose UV area dwarfs its neighbours' is the signature of
    # a wrapped seam — the modulo bug that striped every limb. Region-mapped faces
    # (head, torso, door) are legitimately large, so compare against the median
    # rather than an absolute.
    # QUADS only, and on u-span alone. A wrapped seam is a tube quad whose u runs
    # the full width of its swatch cell instead of 1/sides of it. An n-gon cap is
    # legitimately large in both axes — comparing raw area flags the chin cap and
    # calls a clean mesh broken.
    uv_layer = body.data.uv_layers.active
    if uv_layer:
        spans = []
        for poly in body.data.polygons:
            if len(poly.vertices) != 4:
                continue
            us = [uv_layer.data[i].uv.x for i in poly.loop_indices]
            spans.append((max(us) - min(us), poly.index))
        if spans:
            ordered = sorted(sp for sp, _ in spans)
            med_u = ordered[len(ordered) // 2]
            bad = [i for sp, i in spans if med_u > 0 and sp > med_u * 8]
            check("no UV seam wrap", not bad,
                  f"{len(bad)} quad(s) with u-span >8x median ({med_u:.4f})")

    print()
    if fails:
        print(f"  {len(fails)} FAILED: {', '.join(fails)}")
        sys.exit(1)
    print("  ready for Mixamo")


if __name__ == "__main__":
    main()

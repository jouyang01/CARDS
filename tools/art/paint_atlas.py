#!/usr/bin/env python3
"""
paint_atlas.py — draw a character's texture atlas from data/art/<id>.json.

Deliberately has NOTHING to do with Blender. Painting a face into a PNG is 2D
image drawing; Blender builds geometry and assigns UVs to match this layout, and
never touches pixels. Keeping the two apart means this script runs and tests on
its own, and the pipeline never depends on what Blender's bundled Python ships.

The layout below is a CONTRACT. generate_character.py assigns UVs against these
exact rectangles, so a change here is a change there.

    ┌───────────┬───────────┬───────────┬───────────┐  0
    │ head      │ head      │ head      │ crown     │
    │ front     │ back      │ sides     │ / top     │
    ├───────────┴───────────┼───────────┴───────────┤  256
    │ torso                 │ flat swatches         │
    │ (front | back)        │ (limbs, boots, belt)  │
    ├───────────────────────┼───────────────────────┤  512
    │ THE DOOR              │ door reverse          │
    │ (face, tallies)       │ (hinges, bracing)     │
    └───────────────────────┴───────────────────────┘  1024
    0                       512                   1024

Usage:
    python3 tools/art/paint_atlas.py aegis
    python3 tools/art/paint_atlas.py aegis --out build/art/aegis/aegis_atlas.png
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

# The UV contract lives in atlas_layout.json so this script and the Blender
# geometry script read the SAME numbers and cannot drift apart.
LAYOUT = json.loads((pathlib.Path(__file__).with_name("atlas_layout.json")).read_text())
SIZE = LAYOUT["size"]
REGION = {k: tuple(v) for k, v in LAYOUT["regions"].items()}


def hex_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


class Atlas:
    """A 1024² image plus region-local drawing helpers.

    Every helper takes coordinates local to a named region, so the face code
    reads in face coordinates and never has to know where the region sits.
    """

    def __init__(self, seed: int) -> None:
        self.img = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.rng = random.Random(seed)

    def origin(self, region: str) -> tuple[int, int]:
        x0, y0, _, _ = REGION[region]
        return x0, y0

    def size(self, region: str) -> tuple[int, int]:
        x0, y0, x1, y1 = REGION[region]
        return x1 - x0, y1 - y0

    def fill(self, region: str, color: tuple[int, int, int]) -> None:
        self.d.rectangle(REGION[region], fill=color)

    def box(self, region: str, xy, color, width: int = 0) -> None:
        ox, oy = self.origin(region)
        x0, y0, x1, y1 = xy
        coords = (ox + x0, oy + y0, ox + x1, oy + y1)
        if width:
            self.d.rectangle(coords, outline=color, width=width)
        else:
            self.d.rectangle(coords, fill=color)

    def ellipse(self, region: str, xy, color, width: int = 0) -> None:
        ox, oy = self.origin(region)
        x0, y0, x1, y1 = xy
        coords = (ox + x0, oy + y0, ox + x1, oy + y1)
        if width:
            self.d.ellipse(coords, outline=color, width=width)
        else:
            self.d.ellipse(coords, fill=color)

    def line(self, region: str, pts, color, width: int = 1) -> None:
        ox, oy = self.origin(region)
        self.d.line([(ox + x, oy + y) for x, y in pts], fill=color, width=width)

    def polygon(self, region: str, pts, color) -> None:
        ox, oy = self.origin(region)
        self.d.polygon([(ox + x, oy + y) for x, y in pts], fill=color)


def weather(atlas: Atlas, region: str, base, dark, light, passes: int = 260) -> None:
    """Scratches and grime. Seeded, so the same character always weathers identically."""
    w, h = atlas.size(region)
    rng = atlas.rng
    for _ in range(passes):
        x, y = rng.randrange(w), rng.randrange(h)
        length = rng.randint(3, 26)
        horizontal = rng.random() < 0.72  # a dragged slab scars along its length
        dx, dy = (length, rng.randint(-2, 2)) if horizontal else (rng.randint(-2, 2), length)
        tone = dark if rng.random() < 0.62 else light
        atlas.line(region, [(x, y), (x + dx, y + dy)], mix(base, tone, rng.uniform(0.25, 0.8)), width=1)


def rust_bloom(atlas: Atlas, region: str, base, rust, blooms: int = 14, strength: float = 0.18) -> None:
    """Soft irregular corrosion patches, densest at the edges where water sits."""
    w, h = atlas.size(region)
    rng = atlas.rng
    for _ in range(blooms):
        cx = rng.choice([rng.randint(0, w // 5), rng.randint(4 * w // 5, w), rng.randrange(w)])
        cy = rng.choice([rng.randint(0, h // 6), rng.randint(5 * h // 6, h), rng.randrange(h)])
        r = rng.randint(10, 46)
        for ring in range(4, 0, -1):
            rr = r * ring / 4
            atlas.ellipse(
                region,
                (cx - rr, cy - rr * 0.7, cx + rr, cy + rr * 0.7),
                mix(base, rust, strength * (5 - ring)),
            )


# ── the face ────────────────────────────────────────────────────────────────
#
# Exhaustion, not nobility. The read is hooded eyes, a heavy flat brow with no
# arch (an arch reads as surprise or piety), sunken sockets, and a mouth that is
# set rather than grimacing — he is not straining, he is tired of this.

def paint_face(atlas: Atlas, pal: dict, face: dict) -> None:
    skin = hex_rgb(pal["skin"])
    shadow = hex_rgb(pal["skinShadow"])
    iron = hex_rgb(pal["iron"])
    blood = hex_rgb(pal["driedBlood"])
    deep = mix(shadow, (0, 0, 0), 0.55)

    atlas.fill("head_front", skin)

    # Planes first: temple, cheekbone, jaw. The geometry carries the real form;
    # this only has to keep the flat areas from reading as flat.
    atlas.polygon("head_front", [(0, 0), (256, 0), (256, 40), (0, 40)], mix(skin, shadow, 0.5))
    atlas.polygon("head_front", [(0, 0), (46, 0), (30, 120), (0, 140)], mix(skin, shadow, 0.35))
    atlas.polygon("head_front", [(256, 0), (210, 0), (226, 120), (256, 140)], mix(skin, shadow, 0.35))
    atlas.polygon("head_front", [(0, 206), (256, 206), (256, 256), (0, 256)], mix(skin, shadow, 0.4))

    # Forehead furrows. Three of them, unevenly spaced — held tension, not a frown.
    for y, alpha in ((44, 0.30), (56, 0.22), (67, 0.14)):
        atlas.line("head_front", [(64, y), (128, y - 3), (192, y)], mix(skin, shadow, alpha), width=3)

    # Sunken sockets: a broad soft well the eyes sit down inside.
    for cx in (84, 172):
        for ring in range(6, 0, -1):
            rr = 38 * ring / 6
            atlas.ellipse("head_front", (cx - rr, 108 - rr * 0.66, cx + rr, 108 + rr * 0.66),
                          mix(skin, shadow, 0.15 * (7 - ring)))

    # Brow: low, heavy, and close to the eye. Proximity is what reads as grim —
    # a raised brow is surprise, an arched one is piety. Neither is him.
    for cx, inward in ((84, 1), (172, -1)):
        atlas.polygon("head_front", [
            (cx - 44 * inward, 84), (cx + 40 * inward, 92),
            (cx + 40 * inward, 106), (cx - 44 * inward, 100),
        ], deep)
        atlas.polygon("head_front", [
            (cx - 44 * inward, 82), (cx + 40 * inward, 90),
            (cx + 40 * inward, 95), (cx - 44 * inward, 88),
        ], mix(deep, (0, 0, 0), 0.35))

    # Eyes: a narrow lens, not a circle. The upper lid eats most of the sclera,
    # so what shows is a slit with a lot of shadow above it.
    for cx in (84, 172):
        atlas.polygon("head_front", [(cx - 24, 116), (cx - 8, 106), (cx + 12, 106), (cx + 24, 114),
                                     (cx + 10, 126), (cx - 10, 126)], mix(skin, shadow, 0.9))
        atlas.polygon("head_front", [(cx - 20, 115), (cx - 6, 108), (cx + 10, 108), (cx + 20, 114),
                                     (cx + 8, 123), (cx - 8, 123)], (170, 172, 166))
        atlas.ellipse("head_front", (cx - 8, 108, cx + 8, 124), mix(iron, (0, 0, 0), 0.45))
        atlas.ellipse("head_front", (cx - 3, 112, cx + 3, 119), (14, 16, 18))
        # Upper lid line — heavy, and it cuts into the iris.
        atlas.line("head_front", [(cx - 24, 114), (cx - 6, 106), (cx + 12, 106), (cx + 24, 113)], deep, width=5)
        # Under-eye hollow. This is doing most of the exhaustion work.
        atlas.polygon("head_front", [(cx - 22, 127), (cx + 22, 127), (cx + 15, 142), (cx - 15, 142)],
                      mix(skin, shadow, 0.5))
        atlas.line("head_front", [(cx - 20, 128), (cx + 18, 128)], mix(skin, shadow, 0.75), width=2)

    # Nose: shadow pair only. The wedge is geometry.
    atlas.polygon("head_front", [(120, 104), (126, 160), (114, 162)], mix(skin, shadow, 0.42))
    atlas.polygon("head_front", [(136, 104), (130, 160), (142, 162)], mix(skin, shadow, 0.2))
    atlas.polygon("head_front", [(112, 160), (144, 160), (140, 170), (116, 170)], mix(skin, shadow, 0.3))

    # Stubble BEFORE the mouth, and kept off the lips, or it swallows them.
    if face.get("stubble"):
        rng = atlas.rng
        for _ in range(1400):
            x = rng.randint(52, 204)
            y = rng.randint(162, 240)
            if (x - 128) ** 2 / 5600 + (y - 206) ** 2 / 3400 > 1:
                continue
            if 92 < x < 164 and 182 < y < 202:   # lip exclusion zone
                continue
            atlas.box("head_front", (x, y, x + 1, y + 1), mix(skin, shadow, rng.uniform(0.35, 0.8)))

    # Mouth: a thin closed line with the corners pulled down. Set, not snarling.
    atlas.line("head_front", [(98, 188), (128, 191), (158, 188)], mix(skin, shadow, 0.45), width=7)
    atlas.line("head_front", [(96, 187), (128, 190), (160, 187)], deep, width=3)
    atlas.line("head_front", [(96, 187), (89, 194)], deep, width=3)
    atlas.line("head_front", [(160, 187), (167, 194)], deep, width=3)
    atlas.line("head_front", [(104, 197), (152, 197)], mix(skin, shadow, 0.22), width=3)

    # Scar: thin, broken, desaturated. An old one he stopped noticing.
    scar = face.get("scar")
    if scar:
        sx = 58 if scar["side"] == "left" else 198
        d = 1 if scar["side"] == "left" else -1
        segments = [[(sx + 2 * d, 78), (sx + 10 * d, 96), (sx + 8 * d, 106)],
                    [(sx + 12 * d, 122), (sx + 18 * d, 138)]]
        for seg in segments:
            atlas.line("head_front", seg, mix(skin, blood, 0.28), width=5)
            atlas.line("head_front", seg, mix(skin, shadow, 0.5), width=2)

    # Back and sides: matted, filthy hair. Seen constantly under a 360° camera.
    hair = mix(hex_rgb(pal["leather"]), (0, 0, 0), 0.25)
    atlas.fill("head_back", hair)
    atlas.fill("head_sides", hair)
    atlas.fill("crown", mix(hair, (0, 0, 0), 0.2))
    for region in ("head_back", "head_sides", "crown"):
        w, h = atlas.size(region)
        for _ in range(420):
            x, y = atlas.rng.randrange(w), atlas.rng.randrange(h)
            ln = atlas.rng.randint(8, 30)
            atlas.line(region, [(x, y), (x + atlas.rng.randint(-4, 4), y + ln)],
                       mix(hair, (0, 0, 0) if atlas.rng.random() < 0.5 else (150, 140, 128),
                           atlas.rng.uniform(0.1, 0.45)), width=1)


# ── the door ────────────────────────────────────────────────────────────────
#
# The tally marks are the whole character. One per person he didn't reach in
# time. At unit-token scale they stop being countable and become texture, which
# is exactly right — you register "covered in them", not "forty-seven".

def paint_door(atlas: Atlas, pal: dict, weapon: dict) -> None:
    iron = hex_rgb(pal["iron"])
    dark = hex_rgb(pal["ironDark"])
    light = hex_rgb(pal["ironLight"])
    rust = hex_rgb(pal["rust"])
    rust_deep = hex_rgb(pal["rustDeep"])

    atlas.fill("door_face", iron)
    w, h = atlas.size("door_face")

    # Salvage reads through construction: pressed panel lines, not a shield boss.
    for y in (int(h * 0.24), int(h * 0.52), int(h * 0.79)):
        atlas.line("door_face", [(14, y), (w - 14, y)], mix(iron, dark, 0.75), width=5)
        atlas.line("door_face", [(14, y + 5), (w - 14, y + 5)], mix(iron, light, 0.4), width=2)
    atlas.box("door_face", (12, 12, w - 12, h - 12), mix(iron, dark, 0.6), width=6)

    # Rivets around the rim — the give-away that this was structural, not armour.
    for i in range(11):
        y = 26 + i * (h - 52) / 10
        for x in (24, w - 24):
            atlas.ellipse("door_face", (x - 5, y - 5, x + 5, y + 5), mix(iron, light, 0.55))
            atlas.ellipse("door_face", (x - 3, y - 3, x + 2, y + 2), mix(iron, dark, 0.5))

    rust_bloom(atlas, "door_face", iron, rust, blooms=11, strength=0.11)
    weather(atlas, "door_face", iron, dark, light, passes=420)

    # A torn edge along one side: this was cut out of something, badly.
    if weapon.get("edge") == "torn":
        rng = atlas.rng
        x = w - 12
        pts = [(x, 0)]
        y = 0
        while y < h:
            y += rng.randint(12, 34)
            pts.append((x + rng.randint(-9, 4), min(y, h)))
        pts += [(w, h), (w, 0)]
        atlas.polygon("door_face", pts, mix(dark, (0, 0, 0), 0.55))

    # ── tallies ──
    count = int(weapon.get("tallies", 0))
    if count:
        placement = weapon.get("tallyPlacement", "lower-third")
        top = int(h * (0.60 if placement == "lower-third" else 0.18))
        bottom = h - 40
        left, right = 40, w - 56

        chalk = (206, 202, 190)
        groups = (count + 4) // 5
        per_row = max(1, (right - left) // 62)
        rows = (groups + per_row - 1) // per_row
        row_h = max(30, min(52, (bottom - top) // max(rows, 1)))

        drawn = 0
        for g in range(groups):
            row, col = divmod(g, per_row)
            gx = left + col * 62 + atlas.rng.randint(-3, 3)
            gy = top + row * row_h + atlas.rng.randint(-3, 3)
            if gy + 26 > bottom:
                break
            in_group = min(5, count - drawn)
            # Four uprights, gouged not written — each one is a person.
            for k in range(min(in_group, 4)):
                x = gx + k * 11
                jitter = atlas.rng.randint(-2, 2)
                atlas.line("door_face", [(x, gy), (x + jitter, gy + 26)], mix(dark, (0, 0, 0), 0.5), width=4)
                atlas.line("door_face", [(x - 1, gy - 1), (x + jitter - 1, gy + 25)], chalk, width=2)
            if in_group == 5:
                atlas.line("door_face", [(gx - 5, gy + 24), (gx + 40, gy + 2)], mix(dark, (0, 0, 0), 0.5), width=4)
                atlas.line("door_face", [(gx - 6, gy + 23), (gx + 39, gy + 1)], chalk, width=2)
            drawn += in_group

    # Reverse: bracing, hinge remnants, and none of the tallies. He doesn't look at them.
    atlas.fill("door_back", mix(iron, dark, 0.5))
    bw, bh = atlas.size("door_back")
    atlas.polygon("door_back", [(20, bh - 30), (bw - 30, 24), (bw - 14, 48), (36, bh - 8)], mix(iron, dark, 0.15))
    atlas.polygon("door_back", [(20, 30), (bw - 30, bh - 24), (bw - 14, bh - 48), (36, 8)], mix(iron, dark, 0.15))
    if weapon.get("hingeRemnants"):
        for y in (int(bh * 0.2), int(bh * 0.8)):
            atlas.box("door_back", (0, y - 22, 56, y + 22), mix(iron, rust_deep, 0.55))
            atlas.box("door_back", (0, y - 22, 56, y + 22), mix(dark, (0, 0, 0), 0.4), width=4)
    rust_bloom(atlas, "door_back", mix(iron, dark, 0.5), rust_deep, blooms=12, strength=0.12)
    weather(atlas, "door_back", mix(iron, dark, 0.5), dark, light, passes=300)


# ── body ────────────────────────────────────────────────────────────────────

def paint_torso(atlas: Atlas, pal: dict) -> None:
    iron = hex_rgb(pal["iron"])
    dark = hex_rgb(pal["ironDark"])
    light = hex_rgb(pal["ironLight"])
    rust = hex_rgb(pal["rust"])
    leather = hex_rgb(pal["leather"])

    atlas.fill("torso", mix(iron, dark, 0.3))
    w, h = atlas.size("torso")

    # Front half is plate; back half is strapping, because the camera goes behind him.
    atlas.box("torso", (0, 0, w // 2, h), mix(iron, dark, 0.12))
    for i in range(5):
        y = 30 + i * 42
        atlas.box("torso", (10, y, w // 2 - 10, y + 34), mix(iron, light, 0.12 if i % 2 else 0.03))
        atlas.line("torso", [(10, y + 34), (w // 2 - 10, y + 34)], mix(iron, dark, 0.7), width=3)

    for i in range(4):
        y = 40 + i * 52
        atlas.box("torso", (w // 2 + 14, y, w - 14, y + 22), leather)
        atlas.line("torso", [(w // 2 + 14, y + 22), (w - 14, y + 22)], mix(leather, (0, 0, 0), 0.5), width=3)

    rust_bloom(atlas, "torso", mix(iron, dark, 0.3), rust, blooms=7, strength=0.10)
    weather(atlas, "torso", mix(iron, dark, 0.3), dark, light, passes=240)


SWATCH_ORDER = LAYOUT["swatchOrder"]


def paint_swatches(atlas: Atlas, pal: dict, magic: dict) -> None:
    """Flat colours for everything that needs no detail — limbs, boots, gloves.

    This is the economy of the whole approach: most of the body samples a single
    pixel from here, so only the face and the door cost real texture space.
    """
    w, h = atlas.size("swatches")
    cols, rows = LAYOUT["swatchGrid"]["cols"], LAYOUT["swatchGrid"]["rows"]
    cell_w, cell_h = w // cols, h // rows

    def lookup(name: str) -> tuple[int, int, int]:
        if name.startswith("magic_"):
            return hex_rgb(magic[name[len("magic_"):]])
        return hex_rgb(pal[name])

    # Every cell must be filled — an unpainted cell is pure black, and any UV that
    # lands on it samples black.
    for i in range(cols * rows):
        name = SWATCH_ORDER[min(i, len(SWATCH_ORDER) - 1)]
        r, c = divmod(i, cols)
        atlas.box("swatches", (c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h), lookup(name))


def build(spec: dict, seed: int) -> Image.Image:
    atlas = Atlas(seed)
    pal, magic = spec["palette"], spec["magic"]
    paint_face(atlas, pal, spec["face"])
    paint_torso(atlas, pal)
    paint_swatches(atlas, pal, magic)
    door = (spec.get("weapon") or {}).get("mainHand")
    if door:
        paint_door(atlas, pal, door)
    # A whisper of blur knocks the hard pixel edges off the weathering without
    # softening the face, which is drawn large enough to survive it.
    return atlas.img.filter(ImageFilter.GaussianBlur(0.4))


def verify(spec: dict, path: pathlib.Path) -> int:
    """Check every swatch cell samples the colour the mesh expects.

    generate_character.py points dull faces at a single pixel per swatch. If the
    grid here and the UV maths there ever disagree, a limb comes out silently the
    wrong colour — which looks like an art problem and is really an index bug.
    """
    img = Image.open(path).convert("RGB")
    grid, order = LAYOUT["swatchGrid"], LAYOUT["swatchOrder"]
    x0, y0, x1, y1 = REGION["swatches"]
    cw, ch = (x1 - x0) / grid["cols"], (y1 - y0) / grid["rows"]
    bad = 0
    for i, name in enumerate(order):
        r, c = divmod(i, grid["cols"])
        got = img.getpixel((int(x0 + cw * (c + 0.5)), int(y0 + ch * (r + 0.5))))
        want = hex_rgb(spec["magic"][name[6:]] if name.startswith("magic_") else spec["palette"][name])
        if any(abs(a - b) > 6 for a, b in zip(got, want)):
            print(f"  MISMATCH {name}: want #{want[0]:02x}{want[1]:02x}{want[2]:02x}, got #{got[0]:02x}{got[1]:02x}{got[2]:02x}")
            bad += 1
    print(f"  swatches: {len(order) - bad}/{len(order)} correct")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser(description="Paint a character texture atlas.")
    ap.add_argument("character", help="character id, e.g. aegis")
    ap.add_argument("--verify", action="store_true", help="check swatch cells match the palette")
    ap.add_argument("--out", default=None, help="output PNG path")
    ap.add_argument("--seed", type=int, default=None, help="override the deterministic seed")
    args = ap.parse_args()

    root = pathlib.Path(__file__).resolve().parents[2]
    spec = json.loads((root / "data" / "art" / f"{args.character}.json").read_text())

    # Seed from the id so a character weathers identically on every machine.
    seed = args.seed if args.seed is not None else sum(ord(c) * (i + 1) for i, c in enumerate(spec["id"]))

    out = pathlib.Path(args.out) if args.out else root / "build" / "art" / args.character / f"{args.character}_atlas.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    build(spec, seed).save(out)
    print(f"{out}  ({out.stat().st_size // 1024} kB, seed {seed})")
    if args.verify and verify(spec, out):
        sys.exit(1)


if __name__ == "__main__":
    main()

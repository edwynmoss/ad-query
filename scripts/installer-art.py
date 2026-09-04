"""Generate the AD Query icon set and installer artwork from the mark.

    python scripts/installer-art.py

The mark is a small directory tree: a root, a spine, and two children with
the second child in brand blue. It is drawn from geometry here and mirrored
as an inline SVG in app/frontend/src/components/Mark.tsx, so both stay crisp
at any size.

Writes:
  app/build/appicon.png                      1024 px source (Wails reads this)
  app/build/windows/icon.ico                 16..256 px multi-size icon
  app/build/windows/installer/sidebar.bmp    164 x 314, welcome and finish pages
  app/build/windows/installer/header.bmp     150 x 57, inner pages
  app/build/windows/installer/splash.bmp     420 x 260, fading splash
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "app" / "build"
INSTALLER = BUILD / "windows" / "installer"

NAVY = (17, 24, 39)
INK = (243, 244, 246)
BLUE = (59, 130, 246)
MUTED = (156, 163, 175)
PAPER = (250, 250, 249)


def mark(d: ImageDraw.ImageDraw, x: float, y: float, size: float, ink=INK, blue=BLUE) -> None:
    """Draw the tree with its bounding square at (x, y) with side `size`.

    Geometry on a 100-unit box (matches Mark.tsx):
      root      rect  x 14..52, y 12..38, r 7
      spine     rect  x 23..30, y 38..87
      branch 1  rect  x 23..46, y 50..57
      child 1   rect  x 50..90, y 40..66, r 7   (ink)
      branch 2  rect  x 23..46, y 80..87
      child 2   rect  x 50..90, y 70..96, r 7   (blue)
    """
    u = size / 100.0
    r = 7 * u

    def rect(x0, y0, x1, y1, fill, radius=0):
        box = [x + x0 * u, y + y0 * u, x + x1 * u, y + y1 * u]
        if radius:
            d.rounded_rectangle(box, radius=radius, fill=fill)
        else:
            d.rectangle(box, fill=fill)

    rect(14, 12, 52, 38, ink, r)
    rect(23, 38, 30, 87, ink)
    rect(23, 50, 46, 57, ink)
    rect(50, 40, 90, 66, ink, r)
    rect(23, 80, 46, 87, ink)
    rect(50, 70, 90, 96, blue, r)


def supersampled(size, paint, scale=4, mode="RGB", background=(0, 0, 0, 0)):
    big = Image.new(mode, (size[0] * scale, size[1] * scale), background)
    paint(ImageDraw.Draw(big), scale)
    return big.resize(size, Image.LANCZOS)


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    name = {"Semibold": "segoeuisb.ttf", "Bold": "segoeuib.ttf"}.get(weight, "segoeui.ttf")
    for candidate in (f"C:/Windows/Fonts/{name}", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def icon_tile(size: int) -> Image.Image:
    """The mark on a navy rounded tile, filling the canvas like a modern app icon."""
    def paint(d, k):
        s = size * k
        inset = int(s * 0.04)
        d.rounded_rectangle([inset, inset, s - inset, s - inset], radius=int(s * 0.21), fill=NAVY)
        # Mark box is 68% of the tile, centred.
        box = s * 0.68
        mark(d, (s - box) / 2, (s - box) / 2, box)
    return supersampled((size, size), paint, mode="RGBA")


def sidebar() -> Image.Image:
    def paint(d, k):
        d.rectangle([0, 0, 164 * k, 314 * k], fill=NAVY)
        mark(d, 46 * k, 84 * k, 72 * k)
        d.rectangle([30 * k, 176 * k, 134 * k, 177 * k], fill=(40, 48, 70))
    img = supersampled((164, 314), paint)
    d = ImageDraw.Draw(img)
    d.text((30, 194), "AD Query", font=font(17, "Semibold"), fill=INK)
    d.text((30, 220), "Read-only directory", font=font(11), fill=MUTED)
    d.text((30, 236), "queries and exports.", font=font(11), fill=MUTED)
    return img


def header() -> Image.Image:
    def paint(d, k):
        d.rectangle([0, 0, 150 * k, 57 * k], fill=NAVY)
        mark(d, 104 * k, 12 * k, 33 * k)
    return supersampled((150, 57), paint)


def splash() -> Image.Image:
    def paint(d, k):
        d.rectangle([0, 0, 420 * k, 260 * k], fill=NAVY)
        mark(d, 160 * k, 58 * k, 100 * k)
    img = supersampled((420, 260), paint)
    d = ImageDraw.Draw(img)
    f = font(20, "Semibold")
    w = d.textlength("AD Query", font=f)
    d.text(((420 - w) / 2, 190), "AD Query", font=f, fill=INK)
    return img


def main() -> None:
    INSTALLER.mkdir(parents=True, exist_ok=True)
    icon_tile(1024).save(BUILD / "appicon.png")
    # Windows wants a multi-size ICO; draw each size rather than downscaling once.
    sizes = [16, 24, 32, 48, 64, 128, 256]
    tiles = [icon_tile(s) for s in sizes]
    tiles[-1].save(BUILD / "windows" / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=tiles[:-1])
    print("wrote appicon.png and windows/icon.ico")
    for name, image in (("sidebar.bmp", sidebar()), ("header.bmp", header()), ("splash.bmp", splash())):
        image.convert("RGB").save(INSTALLER / name, format="BMP")
        print(f"wrote {INSTALLER / name} ({image.size[0]}x{image.size[1]})")


if __name__ == "__main__":
    main()

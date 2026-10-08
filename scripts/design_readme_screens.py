from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json
import argparse

p = argparse.ArgumentParser(description="Compose README presentation boards from the original screenshots.")
p.add_argument("--font", default="C:/Windows/Fonts/BASKVILL.TTF")
args = p.parse_args()

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/images/readme"
OUT = SOURCE / "editorial"
OUT.mkdir(parents=True, exist_ok=True)
HERE = Path(__file__).parent
W, H, S = 1800, 1200, 2
PAPER = "#f2eee5"
INK = "#24352f"
COPPER = "#a68a67"
RULE = "#d4c8b4"
FONT = args.font
records = []


def font(size):
    return ImageFont.truetype(FONT, round(size * S))


def text(draw, xy, value, size=15, color=COPPER, tracking=2.0):
    x, y = xy[0] * S, xy[1] * S
    f = font(size)
    for letter in value:
        draw.text((x, y), letter, font=f, fill=color)
        x += draw.textlength(letter, font=f) + tracking * S


def line(draw, coords, color=RULE, width=0.7):
    draw.line(tuple(v * S for v in coords), fill=color, width=max(1, round(width * S)))


def new_page(number):
    canvas = Image.new("RGB", (W * S, H * S), PAPER)
    draw = ImageDraw.Draw(canvas)
    text(draw, (104, 27), "LIFEOS / PRIVATE PAPERS", size=13, tracking=2.0)
    text(draw, (1649, 26), number, size=18, color=INK, tracking=1.0)
    line(draw, (104, 56, 1696, 56))
    return canvas


def place(canvas, source, x, y, width, crop=None, label=None, shadow=True):
    im = Image.open(SOURCE / source).convert("RGB")
    source_size = im.size
    if crop:
        im = im.crop(crop)
    height = width * im.height / im.width
    box = tuple(round(v * S) for v in (x, y, x + width, y + height))
    if shadow:
        shade = Image.new("RGBA", canvas.size)
        d = ImageDraw.Draw(shade)
        d.rectangle((box[0] + 4 * S, box[1] + 13 * S, box[2] + 4 * S, box[3] + 13 * S), fill=(42, 43, 31, 24))
        shade = shade.filter(ImageFilter.GaussianBlur(18 * S))
        canvas.paste(shade, (0, 0), shade)
    resized = im.resize((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
    canvas.paste(resized, (box[0], box[1]))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((box[0]-1, box[1]-1, box[2], box[3]), outline=RULE, width=1)
    records.append({
        "output": label,
        "source": "docs/images/readme/" + source,
        "source_size": list(source_size),
        "crop_box_ltrb": list(crop) if crop else None,
        "placement_xywh": [x, y, width, round(height, 3)],
        "treatment": "Unaltered real screenshot; proportional resize, external paper frame and subtle shadow only.",
    })
    return height


def save(canvas, name):
    canvas.resize((W, H), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)


desk = new_page("01")
place(desk, "desk.png", 148, 86, 1504, label="editorial/desk.png")
draw = ImageDraw.Draw(desk)
line(draw, (104, 1159, 151, 1159), COPPER)
save(desk, "desk.png")

memory = new_page("02")
place(memory, "journal.png", 104, 88, 1340, label="editorial/memory.png")
# The genuine result excerpt overlaps only the book footer, below its visible prose.
# It is a separate detail illustration, not a simulated application window.
place(memory, "memory.png", 794, 898, 902, crop=(362, 350, 1440, 630), label="editorial/memory.png")
draw = ImageDraw.Draw(memory)
text(draw, (794, 1150), "MEMORY DRAW / DETAIL", size=12, tracking=1.7)
line(draw, (104, 1159, 151, 1159), COPPER)
save(memory, "memory.png")

letters = new_page("03")
place(letters, "bottles.png", 128, 144, 1544, crop=(0, 0, 1600, 895), label="editorial/letters.png")
draw = ImageDraw.Draw(letters)
# An open stationery fold in the margin; the product screenshot remains untouched.
line(draw, (1180, 1077, 1672, 1077), RULE)
line(draw, (1180, 1077, 1426, 1130), RULE)
line(draw, (1426, 1130, 1672, 1077), RULE)
line(draw, (104, 1159, 151, 1159), COPPER)
save(letters, "letters.png")

(OUT / "screen-sources.json").write_text(json.dumps({
    "canvas": [W, H],
    "palette": {"paper": PAPER, "ink": INK, "copper": COPPER},
    "font": "Baskerville or a user-provided local font; font files are not distributed",
    "description": "Editorial presentation boards, not new UI captures. All UI pixels derive from existing v0.5.2 demo screenshots. No image generation, recoloring, replaced UI text, or fabricated interface elements.",
    "sources": records,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("\n".join(str(OUT / name) for name in ("desk.png", "memory.png", "letters.png")))

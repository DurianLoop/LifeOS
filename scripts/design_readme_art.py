"""Render the Private Papers editorial plates used in the README.

Requires Pillow and locally licensed fonts. No font files are distributed.
Screenshots are scaled as complete images; their content is never retouched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fonts', type=Path, default=Path('C:/Windows/Fonts'))
parser.add_argument('--output', type=Path, default=ROOT / 'docs/images/readme/editorial')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

FONTS = {'song': 'STSONG.TTF', 'serif': 'BOD_R.TTF', 'italic': 'BOD_I.TTF', 'sans': 'msyh.ttc'}
PALETTES = {
    'light': {'paper': '#f1eff2', 'ink': '#332b3a', 'muted': '#716978', 'rule': '#b4abb9', 'accent': '#ae4c3b'},
    'dark': {'paper': '#26232c', 'ink': '#ece7ed', 'muted': '#b7aebb', 'rule': '#645b6b', 'accent': '#d98a76'},
}
manifest = []


class Plate:
    def __init__(self, width, height, theme):
        self.c = PALETTES[theme]
        self.image = Image.new('RGB', (width, height), self.c['paper'])
        self.draw = ImageDraw.Draw(self.image)
        self.regions = []

    def text(self, xy, text, size, face='song', color='ink', tracking=0, baseline=None):
        font = ImageFont.truetype(str(args.fonts / FONTS[face]), size)
        x, y = xy
        if baseline is None:
            baseline = y - font.getbbox(text, anchor='ls')[1]
        for char in text:
            self.draw.text((x, baseline), char, fill=self.c[color], font=font, anchor='ls')
            x += self.draw.textlength(char, font=font) + tracking

    def line(self, xy, color='rule', width=1):
        self.draw.line(xy, fill=self.c[color], width=width)

    def screenshot(self, file, x, y, width):
        source = ROOT / 'docs/images/readme' / file
        original = Image.open(source).convert('RGB')
        height = round(original.height * width / original.width)
        assert x >= 0 and y >= 0 and x + width <= self.image.width and y + height <= self.image.height
        self.image.paste(original.resize((width, height), Image.Resampling.LANCZOS), (x, y))
        self.regions.append({'source': file, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'rectangle': [x, y, width, height], 'operation': 'whole-image proportional resize only'})

    def save(self, name):
        path = args.output / name
        self.image.save(path, optimize=True)
        manifest.append({'file': name, 'size': self.image.size, 'bytes': path.stat().st_size, 'screenshot_regions': self.regions})


def opening(lang, theme, mobile):
    p = Plate(800, 1060, theme) if mobile else Plate(1600, 1220, theme)
    if mobile:
        p.text((32, 32), 'LifeOS', 60, 'serif')
        p.text((573, 52), 'VOL. 0.5.2', 27, 'sans', 'muted')
        p.line((32, 112, 768, 112), 'ink', 2)
        if lang == 'zh':
            p.text((40, 167), '私人文献', 169, tracking=5)
            p.text((42, 370), 'Private papers.', 46, 'italic', 'muted')
        else:
            p.text((33, 146), 'Private', 154, 'serif')
            p.text((160, 290), 'papers.', 154, 'italic')
        p.screenshot('workspace.png', 24, 464, 752)
        p.line((32, 1001, 768, 1001))
        p.text((32, 1020), '01 / 正文' if lang == 'zh' else '01 / THE DESK', 27, 'sans', 'muted')
        p.text((640, 1020), 'LifeOS', 29, 'serif', 'muted')
    else:
        p.text((62, 34), 'LifeOS', 63, 'serif')
        p.text((1120, 54), 'VOL. 0.5.2 / PRIVATE PAPERS', 22, 'sans', 'muted')
        p.line((64, 118, 1536, 118), 'ink', 2)
        if lang == 'zh':
            p.text((58, 155), '私人文献', 220, tracking=24)
            p.text((1190, 206), 'Private', 63, 'italic')
            p.text((1272, 276), 'papers.', 63, 'italic')
        else:
            p.text((57, 149), 'Private', 210, 'serif')
            headline_font = ImageFont.truetype(str(args.fonts / FONTS['serif']), 210)
            headline_baseline = 149 - headline_font.getbbox('Private', anchor='ls')[1]
            p.text((775, 151), 'papers.', 210, 'italic', baseline=headline_baseline)
        p.text((62, 430), '01', 157, 'italic')
        if lang == 'zh':
            p.text((73, 644), '正', 88)
            p.text((73, 748), '文', 88)
        else:
            p.text((70, 696), 'Write.', 72, 'italic')
        p.text((77, 882), 'THE DESK', 22, 'sans', 'muted', 2)
        p.line((79, 948, 79, 1113))
        p.text((103, 1060), 'WRITE', 20, 'sans', 'muted', 3)
        p.text((103, 1096), 'KEEP', 20, 'sans', 'muted', 3)
        p.screenshot('workspace.png', 336, 370, 1200)
        p.text((337, 1191), 'JOURNAL / A DESK OF YOUR OWN', 18, 'sans', 'muted', 2)
        p.text((1476, 1188), '001', 24, 'serif', 'muted')
    # A single red index mark, aligned to the rule above the title.
    x = 741 if mobile else 1510
    p.draw.rectangle((x, 111, x + 26, 119), fill=p.c['accent'])
    p.save(f'opening-{lang}-{theme}' + ('-mobile' if mobile else '') + '.png')


def reading(lang, theme, mobile):
    p = Plate(800, 755, theme) if mobile else Plate(1600, 925, theme)
    if mobile:
        p.text((29, 25), '02', 83, 'italic')
        p.text((168, 49), '查阅' if lang == 'zh' else 'Read again', 47, 'song' if lang == 'zh' else 'italic')
        p.line((32, 119, 768, 119))
        p.screenshot('journal.png', 24, 151, 752)
        p.text((32, 705), '流年 / 日期目录与书本阅读' if lang == 'zh' else 'JOURNAL / THE ORIGINAL WORDS', 27, 'sans', 'muted')
    else:
        p.screenshot('journal.png', 64, 64, 1120)
        p.text((1284, 73), '02', 138, 'italic')
        if lang == 'zh':
            p.text((1319, 296), '查', 95)
            p.text((1319, 420), '阅', 95)
        else:
            p.text((1274, 320), 'Read', 72, 'italic')
            p.text((1274, 405), 'again.', 72, 'italic')
        p.line((1327, 606, 1327, 732))
        p.text((1271, 784), 'THE ORIGINAL', 19, 'sans', 'muted', 1)
        p.text((1271, 817), 'WORDS', 19, 'sans', 'muted', 1)
        p.line((64, 867, 1536, 867))
        p.text((65, 888), 'READING / RETURN TO AN ENTRY', 18, 'sans', 'muted', 2)
        p.text((1478, 884), '002', 24, 'serif', 'muted')
    p.save(f'reading-{lang}-{theme}' + ('-mobile' if mobile else '') + '.png')


for lang in ('zh', 'en'):
    for theme in PALETTES:
        for mobile in (False, True):
            opening(lang, theme, mobile)
            reading(lang, theme, mobile)
(args.output / 'plates.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'plates': len(manifest), 'bytes': sum(x['bytes'] for x in manifest)}))

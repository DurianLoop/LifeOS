"""Generate a compact, outlined LifeOS masthead for the GitHub README.

Requires fontTools and a locally installed display font; no font file is copied.
Use --font to substitute a locally licensed typeface.
"""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--font', default='C:/Windows/Fonts/BOD_R.TTF')
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'docs/images/readme/editorial')
args = parser.parse_args()
font = TTFont(args.font)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
paths = []
bounds = []
advance = 0
for ch in 'LifeOS':
    glyph = glyphs[cmap[ord(ch)]]
    pen = SVGPathPen(glyphs)
    glyph.draw(pen)
    box = BoundsPen(glyphs)
    glyph.draw(box)
    x0,y0,x1,y1 = box.bounds
    bounds.append((x0+advance,y0,x1+advance,y1))
    paths.append((advance,pen.getCommands()))
    advance += glyph.width - 26
xmin = min(b[0] for b in bounds)
xmax = max(b[2] for b in bounds)
ymin = min(b[1] for b in bounds)
ymax = max(b[3] for b in bounds)
width,height = 1800,480
scale = min(1718/(xmax-xmin),370/(ymax-ymin))
dx = 3-xmin*scale
dy = 12+ymax*scale
args.output.mkdir(parents=True,exist_ok=True)
for dark in (False,True):
    ink = '#f0efeb' if dark else '#1c1c1c'
    accent = '#d07a71' if dark else '#a3433a'
    shapes = ''.join(f'<path d="{path}" transform="translate({dx+x*scale:.4f} {dy:.4f}) scale({scale:.6f} {-scale:.6f})"/>' for x,path in paths)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title"><title id="title">LifeOS</title><g fill="{ink}">{shapes}</g><path d="M0 445H1800" stroke="{ink}" stroke-width="3"/><path d="M1757 26h31v31h-31z" fill="{accent}"/></svg>\n'
    (args.output/('masthead-'+('dark' if dark else 'light')+'.svg')).write_text(svg,encoding='utf-8',newline='\n')

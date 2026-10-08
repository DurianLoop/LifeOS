"""Build the README's self-contained SVG covers; font files are not distributed.

Requires fonttools and locally licensed Song / Baskerville fonts. Defaults use
Windows fonts. Override --song, --roman and --italic on other systems.
"""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--song', default='C:/Windows/Fonts/STSONG.TTF')
p.add_argument('--roman', default='C:/Windows/Fonts/BASKVILL.TTF')
p.add_argument('--italic', default='C:/Windows/Fonts/georgiai.ttf')
p.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'docs/images/readme/editorial')
args = p.parse_args()
fonts = {k: TTFont(getattr(args,k)) for k in ('song','roman','italic')}

def lettering(text, x, baseline, size, color, font='song', tracking=0):
    f=fonts[font]; glyphs=f.getGlyphSet(); cmap=f.getBestCmap(); unit=f['head'].unitsPerEm
    out=[]
    for ch in text:
        name=cmap[ord(ch)]; glyph=glyphs[name]; pen=SVGPathPen(glyphs); glyph.draw(pen)
        d=pen.getCommands()
        if d:
            out.append(f'<path d="{d}" transform="translate({x:.3f} {baseline}) scale({size/unit:.6f} {-size/unit:.6f})"/>')
        x+=glyph.width*size/unit+tracking
    return f'<g fill="{color}">'+''.join(out)+'</g>'

def cover(dark=False, english=False):
    bg, ink, muted, line, paper, behind, accent = (
        ('#1d2b27','#eee7d8','#b5b7a8','#526052','#28392f','#24332c','#c3a47b') if dark else
        ('#f4f0e7','#29382f','#798072','#c9c8b5','#faf7ef','#eae6d8','#927450')
    )
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900" viewBox="0 0 1800 900" role="img" aria-labelledby="title desc"><title id="title">LifeOS — Days pass. Words remain.</title><desc id="desc">A private chronicle. A literary cover with Song typography and an illustrated open journal. Local-first journaling, v0.5.2.</desc><rect width="1800" height="900" fill="{bg}"/>']
    parts += [lettering('LifeOS',100,114,64,ink,'roman'), lettering('A  P R I V A T E  C H R O N I C L E',372,107,18,muted,'roman'), lettering('VOL. 05 / 02',1530,107,20,muted,'roman')]
    parts += [f'<path d="M100 154H1700" stroke="{line}" stroke-width="1"/>']
    if english:
        parts += [lettering('Days pass.',96,350,132,ink,'roman'),lettering('Words remain.',96,500,132,ink,'roman'),lettering('A place for the days you want to keep.',102,596,29,muted,'italic')]
    else:
        parts += [lettering('日子翻过去，',96,350,137,ink,tracking=1),lettering('字留下来。',96,522,137,ink,tracking=1),lettering('D A Y S  P A S S .  W O R D S  R E M A I N .',103,606,19,muted,'roman')]
    # An open journal: fine pen lines, a quiet ribbon, and the space of unwritten pages.
    parts += [f'<g transform="translate(1140 270) rotate(-7 235 210)">'
        f'<path d="M-25 62Q96 9 217 78Q338 9 477 47L477 408Q334 359 217 425Q95 360-25 408Z" fill="{behind}" stroke="{line}" stroke-width="1.3"/>'
        f'<path d="M-20 46Q96 1 217 64Q338 1 470 32L470 397Q334 350 217 413Q95 350-20 397Z" fill="{bg}" stroke="{line}" stroke-width="1.3"/>'
        f'<path d="M-12 25Q101-12 217 49Q332-12 461 12L461 383Q334 338 217 400Q97 338-12 383Z" fill="{paper}" stroke="{muted}" stroke-width="1.6"/>'
        f'<path d="M217 49Q205 208 217 400" fill="none" stroke="{line}" stroke-width="1.3"/>'
        f'<path d="M375 4L390 6V111L382 99L375 109Z" fill="{accent}"/>'
        f'<path d="M20 99Q96 80 173 113M20 137Q96 118 173 151M20 175Q96 156 173 189M20 213Q96 194 173 227M20 251Q96 232 173 265M20 289Q96 270 139 285" fill="none" stroke="{line}" stroke-width="1"/>'
        +lettering('08',274,235,108,muted,'roman')
        +lettering('O C T O B E R',270,266,12,muted,'roman')
        +f'<path d="M274 307Q339 292 423 313" fill="none" stroke="{line}"/>'
        '</g>']
    parts += [f'<path d="M100 750H1700" stroke="{line}" stroke-width="1"/>']
    if english:
        parts += [lettering('A journal, a reading room, a letter to tomorrow.',102,807,27,ink,'roman'),lettering('LOCAL FIRST / AI OPTIONAL',1260,806,17,muted,'roman',tracking=1)]
    else:
        parts += [lettering('落笔，翻页。把寻常留给来日。',102,807,29,ink,tracking=2),lettering('LOCAL FIRST / AI OPTIONAL',1260,806,17,muted,'roman',tracking=1)]
    parts += ['</svg>']
    return ''.join(parts)+'\n'

args.output.mkdir(parents=True,exist_ok=True)
for english in (False,True):
    for dark in (False,True):
        name='cover-'+('en-' if english else '')+('dark' if dark else 'light')+'.svg'
        (args.output/name).write_text(cover(dark,english),encoding='utf-8',newline='\n')
        print(name)

"""Generate small, self-contained status badges for the README header."""
from pathlib import Path
from html import escape
from PIL import ImageFont

root = Path(__file__).resolve().parents[1]
output = root / 'docs/images/readme/badges'
output.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/verdana.ttf', 11)
badges = [
    ('version', 'version', 'v0.5.2', '#52745b'),
    ('desktop', 'desktop', 'Windows | macOS', '#657681'),
    ('data', 'data', 'local-first', '#4d796e'),
    ('license', 'license', 'Personal / Non-commercial', '#8b714e'),
]
for name, label, value, color in badges:
    left = round(font.getlength(label)) + 12
    right = round(font.getlength(value)) + 12
    width = left + right
    title = escape(f'{label}: {value}')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" viewBox="0 0 {width} 20" role="img" aria-label="{title}">
<title>{title}</title><defs><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient><clipPath id="r"><rect width="{width}" height="20" rx="3"/></clipPath></defs>
<g clip-path="url(#r)"><path fill="#555" d="M0 0h{left}v20H0z"/><path fill="{color}" d="M{left} 0h{right}v20H{left}z"/><path fill="url(#s)" d="M0 0h{width}v20H0z"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="{left/2}" y="14">{escape(label)}</text><text x="{left+right/2}" y="14">{escape(value)}</text></g>
</svg>
'''
    (output / f'{name}.svg').write_text(svg, encoding='utf-8', newline='\n')
print(f'Generated {len(badges)} badges.')

#!/usr/bin/env python3
from pathlib import Path
import re,json,sys
ROOT=Path(__file__).resolve().parents[1]
baseline=json.loads((ROOT/'config/features_127_baseline.json').read_text(encoding='utf-8'))
app=(ROOT/'app/index.html').read_text(encoding='utf-8')
m=re.search(r'const FEATURES=\[(.*?)\]\.map\(',app,re.S)
if not m: raise SystemExit('Could not parse FEATURES registry')
current=re.findall(r'\["([^"]+)","[^"]+",',m.group(1))
removed=[x for x in baseline if x not in current]
added=[x for x in current if x not in baseline]
out={'baseline':len(baseline),'current':len(current),'removed':removed,'added':added,'ok':not removed and len(current)>=len(baseline)}
print(json.dumps(out,ensure_ascii=False,indent=2))
sys.exit(0 if out['ok'] else 1)

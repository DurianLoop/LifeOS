#!/usr/bin/env python3
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'app' / 'index.html').read_text(encoding='utf-8')
checks = {
    'global_focus_exit': 'id="focusExit"' in HTML,
    'world_flash': 'id="worldFlash"' in HTML and 'function flashWorld(' in HTML,
    'page_turn': 'id="memoryVeil"' in HTML and 'function triggerMemoryTurn(' in HTML,
    'daily_ritual': 'class="dayPulse"' in HTML and 'todayInArchive' in HTML,
    'journal_progress': 'id="journalProgressFill"' in HTML and 'function updateJournalReadingUI(' in HTML,
    'journal_focus_toggle': 'id="journalFocusToggle"' in HTML and 'function setJournalFocus(' in HTML,
    'focus_escape': "document.body.classList.contains('journalFocusMode')" in HTML and 'setJournalFocus(false)' in HTML,
    'focus_auto_exit': "if(STATE.feature!=='Journal')setJournalFocus(false,{silent:true})" in HTML,
    'reduced_motion': '@media(prefers-reduced-motion:reduce)' in HTML and '.memoryVeil{display:none}' in HTML,
    'motion_off': 'html[data-motion="off"] *' in HTML,
    'dark_color_scheme': "['rain','abyss','oracle'].includes(theme)?'dark':'light'" in HTML,
}
# Registry count: features are declared in the first FEATURES array only.
m = re.search(r'const FEATURES=\[(.*?)\]\.map\(\(x,i\)=>\(\{name:x\[0\],room:x\[1\],desc:x\[2\],no:i\+1\}\)\);\s*const ROOMS=', HTML, re.S)
if m:
    names = re.findall(r'\["([^"]+)"\s*,\s*"[A-Z]+"', m.group(1))
else:
    names = []
checks['feature_registry_142'] = len(names) == 142 and len(set(names)) == 142
result = {'ok': all(checks.values()), 'checks': checks, 'feature_count': len(names)}
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(0 if result['ok'] else 1)

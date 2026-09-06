#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'app'/'index.html').read_text(encoding='utf-8')
PET=(ROOT/'desktop'/'pet.html').read_text(encoding='utf-8')
PET_RUNTIME=PET+(ROOT/'app'/'v012-pet-float.js').read_text(encoding='utf-8')
checks={
 'section_compass': 'class="sectionRail"' in HTML and 'data-section-jump' in HTML,
 'mobile_section_chip': 'id="mobileSectionChip"' in HTML,
 'read_to_end_storage': 'journalFinishedKey' in HTML and 'markJournalFinished' in HTML,
 'short_page_progress_fix': 'desiredEnd=top+paper.offsetHeight' in HTML and 'maxScroll=Math.max(1' in HTML,
 'focus_shortcut_f': "e.key.toLowerCase()==='f'" in HTML,
 'focus_escape': "document.body.classList.contains('journalFocusMode')" in HTML and 'setJournalFocus(false)' in HTML,
 'pet_focus_event': 'journal-focus-enter' in PET_RUNTIME,
 'pet_section_event': 'journal-section' in PET_RUNTIME,
 'pet_complete_event': 'journal-complete' in PET_RUNTIME,
 'reduced_motion': '@media(prefers-reduced-motion:reduce)' in HTML,
}
m=re.search(r'const FEATURES=\[(.*?)\]\.map\(\(x,i\)=>\(\{name:x\[0\],room:x\[1\],desc:x\[2\],no:i\+1\}\)\);\s*const ROOMS=',HTML,re.S)
names=re.findall(r'\["([^"]+)"\s*,\s*"[A-Z]+"',m.group(1)) if m else []
checks['feature_registry_142']=len(names)==142 and len(set(names))==142
out={'ok':all(checks.values()),'checks':checks,'feature_count':len(names)}
print(json.dumps(out,ensure_ascii=False,indent=2))
sys.exit(0 if out['ok'] else 1)

"""Isolated local mobile-engine host for renderer acceptance (not shipped)."""
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mobile/src'))
from lifeosmobile.runtime import MobileRuntime
runtime = MobileRuntime(sys.argv[1], 'android', resources=ROOT)
try:
    url = runtime.start()
    Path(sys.argv[2]).write_text(json.dumps({'url': url, 'origin': runtime.origin}), encoding='utf-8')
    while True:
        time.sleep(1)
finally:
    runtime.stop()

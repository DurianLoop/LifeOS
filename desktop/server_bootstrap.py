"""Initialize and run the backend with code and user data in separate folders."""
from __future__ import annotations

from pathlib import Path
import os
import sys

SOURCE_ROOT = Path(os.environ.get('LIFEOS_RESOURCE_ROOT') or Path(__file__).resolve().parents[1])
ROOT = Path(os.environ.get('LIFEOS_ROOT') or SOURCE_ROOT)
os.environ['LIFEOS_ROOT'] = str(ROOT)
os.environ['LIFEOS_RESOURCE_ROOT'] = str(SOURCE_ROOT)
sys.path.insert(0, str(SOURCE_ROOT))
sys.path.insert(0, str(SOURCE_ROOT / 'engine'))
ROOT.mkdir(parents=True, exist_ok=True)
os.chdir(ROOT)

if not (ROOT / 'data' / 'lifeos.db').exists():
    from engine.rebuild_memory_engine import main as rebuild
    rebuild()

from backend.server import HOST, PORT, Handler, ThreadingHTTPServer, threading, webbrowser

url = f"http://{HOST}:{PORT}"
print(f"LifeOS local server: {url}")
if os.getenv("LIFEOS_NO_BROWSER", "0") != "1":
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

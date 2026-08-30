"""Start the bundled LifeOS backend from Electron's resources directory.

The public installer launches this frozen wrapper instead of relying on a
system Python installation.  Its sibling folders are the same clean resources
that are included in the desktop package.
"""
from __future__ import annotations

from pathlib import Path
import os
import sys

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LIFEOS_ROOT", str(ROOT))

# Importing the server makes its local-only dependencies discoverable by the
# frozen build while the journal data itself stays beside this executable.
from backend.server import DB, HOST, PORT, Handler, ThreadingHTTPServer, threading, webbrowser

if not DB.exists():
    raise SystemExit("data/lifeos.db is missing. Reinstall LifeOS or rebuild the local index.")

url = f"http://{HOST}:{PORT}"
print(f"LifeOS local server: {url}")
if os.getenv("LIFEOS_NO_BROWSER", "0") != "1":
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

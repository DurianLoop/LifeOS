#!/usr/bin/env python3
"""Background corpus refresh worker for the local desktop/backend process."""
from __future__ import annotations
from pathlib import Path
import threading, time
from engine import product_core as product
from engine.incremental_index import run_one_pending_refresh

ROOT=Path(__file__).resolve().parents[1]

class RefreshWorker:
    def __init__(self, root:Path=ROOT, poll_seconds=.35):
        self.root=root;self.poll_seconds=poll_seconds;self.stop_event=threading.Event();self.thread=None
    def start(self):
        if self.thread and self.thread.is_alive():return self
        product.recover_refresh_state(self.root)
        self.thread=threading.Thread(target=self._run,name='lifeos-derived-refresh',daemon=True);self.thread.start();return self
    def stop(self,timeout=2):
        self.stop_event.set()
        if self.thread:self.thread.join(timeout)
    def _run(self):
        while not self.stop_event.is_set():
            try:
                enabled=product.get_setting('refresh.background_enabled','true',self.root)=='true'
                st=product.derived_refresh_status(self.root)
                pending=int(st['requested_generation'])>int(st['completed_generation'])
                if enabled and pending and st['status']!='running':
                    # Debounce bursts of Writer autosaves/import items into one corpus generation.
                    try: debounce=max(0,int(product.get_setting('refresh.debounce_ms','700',self.root) or 700))/1000
                    except Exception: debounce=.7
                    requested=st.get('requested_at') or ''
                    # A simple fixed debounce is sufficient because every subsequent request
                    # increments the generation and superseded builds are never published.
                    if self.stop_event.wait(debounce):break
                    run_one_pending_refresh(self.root)
                    continue
            except Exception:
                # State/error is persisted by run_one_pending_refresh. Keep the backend alive.
                pass
            self.stop_event.wait(self.poll_seconds)

_WORKERS={}
_LOCK=threading.Lock()
def start_refresh_worker(root:Path=ROOT):
    key=str(root.resolve())
    with _LOCK:
        w=_WORKERS.get(key)
        if not w:w=_WORKERS[key]=RefreshWorker(root)
        return w.start()

#!/usr/bin/env python3
"""Quiet, memory-native notifications for LifeOS P2."""
from pathlib import Path
import os
import datetime as dt,hashlib,sqlite3
from engine import p2_core
ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def _nid(kind,key):return 'note_'+hashlib.sha256((kind+'|'+key).encode()).hexdigest()[:32]

def refresh_due(root=ROOT,today=None):
    from engine import drift_bottles
    drift_bottles.arrivals(root)
    root=Path(root);day=dt.date.fromisoformat(today) if isinstance(today,str) else (today or dt.date.today());iso=day.isoformat();created=[]
    db=root/'data'/'lifeos.db'
    if not db.exists():return {'created':created}
    con=sqlite3.connect(db);con.row_factory=sqlite3.Row
    try:
        md=iso[4:]
        olds=con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND date LIKE ? AND date<>? AND date_anomaly=0 ORDER BY date DESC LIMIT 5",('%'+md,iso)).fetchall()
        if olds:
            n=_nid('old-letter',iso);p2_core.add_notification('old-letter','有一封旧日来信。',f'{len(olds)} 个过去的今天仍留在档案里。',{'feature':'On This Day','date':iso},None,root,n);created.append(n)
    finally:con.close()
    return {'created':created,'today':iso}

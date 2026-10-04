"""Collect an explicit public snapshot from local current journal revisions."""
from __future__ import annotations

import os
from pathlib import Path
from engine import product_core as pc

ROOT = Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])


def available(root=ROOT):
    items = [e for e in pc.list_entries(limit=5000, root=Path(root)) if e.get('kind') == 'daily']
    return [{'entry_id': e['entry_id'], 'date': e.get('journal_date') or '',
             'title': e.get('title') or e.get('journal_date') or '一页日记'} for e in items]


def build_snapshot(entry_ids, root=ROOT):
    if not isinstance(entry_ids, list) or not entry_ids or len(entry_ids) > 5000:
        raise ValueError('select 1–5000 journal pages')
    if any(not isinstance(entry_id, str) or not entry_id for entry_id in entry_ids):
        raise ValueError('invalid selected journal page')
    result = []
    for entry_id in dict.fromkeys(entry_ids):
        e = pc.get_entry(entry_id=str(entry_id), root=Path(root))
        if not e or e.get('deleted_at') or e.get('kind') != 'daily':
            raise ValueError('selected journal page is unavailable')
        rev = pc.read_revision(e['current_revision_id'], Path(root))
        if not rev or not (Path(root) / rev['revision_file']).is_file():
            raise ValueError('selected journal revision is unavailable')
        result.append({'entry_id': e['entry_id'], 'date': e.get('journal_date') or '',
                       'title': e.get('title') or e.get('journal_date') or '一页日记',
                       'content': rev.get('content') or ''})
    return result

"""Source-backed, local memory draws, independent of AI and derived freshness."""
from __future__ import annotations

from collections import OrderedDict
from datetime import date
from html import unescape
import hashlib
import json
from pathlib import Path, PurePosixPath
import random
import re
import sqlite3
import threading

from engine import product_core as product


MAX_EXCLUDE = 120
_PREVIEWS = OrderedDict()
_PREVIEW_LOCK = threading.RLock()


def parse_exclude(value):
    """Bound client history without repeated database draws or arbitrary input."""
    if value in (None, ''):
        return set()
    if isinstance(value, str):
        if len(value) > 20000:
            raise ValueError('抽签记录过长，请重新开始')
        try:
            value = json.loads(value)
        except (ValueError, TypeError) as error:
            raise ValueError('抽签记录格式无效') from error
    if not isinstance(value, list) or len(value) > MAX_EXCLUDE:
        raise ValueError('抽签记录格式无效')
    if any(not isinstance(item, str) or len(item) > 160 for item in value):
        raise ValueError('抽签记录格式无效')
    return set(value)


def source_file(root, source_path):
    """Only a current Markdown journal inside the Vault can be opened/drawn."""
    if not isinstance(source_path, str) or not source_path or len(source_path) > 600:
        return None
    if '\\' in source_path or ':' in source_path or any(ord(c) < 32 for c in source_path):
        return None
    parts = source_path.split('/')
    if any(part in ('', '.', '..') for part in parts):
        return None
    path = PurePosixPath(source_path)
    if path.is_absolute() or len(parts) < 3 or parts[:2] not in (['memories', 'daily'], ['memories', 'weekly']) or path.suffix.lower() != '.md':
        return None
    try:
        vault = (Path(root) / 'vault').resolve()
        file = (vault / source_path).resolve()
        return file if file.is_relative_to(vault) and file.is_file() else None
    except (OSError, ValueError, RuntimeError):
        return None


def _body(text):
    return re.sub(r'\A\ufeff?---\r?\n.*?\r?\n---(?:\r?\n|$)', '', text, count=1, flags=re.S)


def _sections(text):
    """Same heading convention as the writer, plus plain imported Markdown."""
    text = _body(text)
    sections, name, buffer = {}, None, []
    preamble = []
    for line in text.splitlines():
        if line.startswith('### '):
            if name is not None:
                sections[name] = '\n\n'.join(filter(None, [sections.get(name), '\n'.join(buffer).strip()]))
            name, buffer = line[4:].strip() or '日记', []
        elif name is None:
            preamble.append(line)
        else:
            buffer.append(line)
    if name is not None:
        sections[name] = '\n\n'.join(filter(None, [sections.get(name), '\n'.join(buffer).strip()]))
    if not sections:
        sections['日记'] = text.strip()
    elif '\n'.join(preamble).strip():
        sections = {'随记': '\n'.join(preamble).strip(), **sections}
    return sections


def _plain(value):
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', str(value or ''), flags=re.I | re.S)
    value = re.sub(r'<(?:br|/p|/div)\b[^>]*>', '\n', value, flags=re.I)
    value = unescape(re.sub(r'<[^>]*>', '', value))
    value = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', value)
    value = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', value)
    value = re.sub(r'(?m)^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)', '', value)
    value = re.sub(r'[`*_~]', '', value)
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return re.sub(r'\s+', ' ', value).strip()


def _preview(file):
    try:
        stat = file.stat()
        key = (str(file), stat.st_mtime_ns, stat.st_size)
        with _PREVIEW_LOCK:
            cached = _PREVIEWS.get(key)
            if cached is not None:
                _PREVIEWS.move_to_end(key)
                return cached
        text = file.read_text(encoding='utf-8-sig')
        sections = _sections(text)
        values = [_plain(sections[name]) for name in ('日记', '自我探索') if name in sections]
        values += [_plain(value) for name, value in sections.items() if name not in ('日记', '自我探索')]
        plain = next((value for value in values if value), '')
        meta = product.extract_frontmatter(text.replace('\r\n', '\n'))
        result = {'excerpt': plain[:320] + ('…' if len(plain) > 320 else ''),
                  'title': _plain(meta.get('title') or '')[:100]}
        with _PREVIEW_LOCK:
            _PREVIEWS[key] = result
            while len(_PREVIEWS) > 1024:
                _PREVIEWS.popitem(last=False)
        return result
    except (OSError, UnicodeError):
        return None


def _query(con, sql):
    # Empty installs need no derived tables; other SQLite errors stay visible.
    try:
        return [dict(row) for row in con.execute(sql)]
    except sqlite3.OperationalError as error:
        if 'no such table' in str(error):
            return []
        raise


def _entry_states(root):
    database = Path(root) / '.lifeos' / 'core.db'
    if not database.is_file():
        return {}
    con = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        con.row_factory = sqlite3.Row
        return {row['source_path']: dict(row) for row in con.execute(
            'SELECT entry_id,kind,journal_date,title,source_path,deleted_at FROM entries')}
    finally:
        con.close()


def _label(record):
    if record.get('journal_date') or record.get('date'):
        return record.get('journal_date') or record.get('date')
    if record.get('week'):
        return f"{record['year']}_W{int(record['week']):02d}"
    match = re.search(r'/(\d{4})_(\d{1,2})\.md$', record['source_path'])
    return f'{match[1]}_W{int(match[2]):02d}' if match else ''


def _sources(con, root):
    entries = _entry_states(root)
    records = {row['source_path']: row for row in _query(con,
        "SELECT source_path,kind,date,year,week FROM memories WHERE kind IN ('daily','weekly')")}
    records.update(entries)
    sources = {}
    for path, record in records.items():
        if record.get('deleted_at') or record.get('kind') not in ('daily', 'weekly'):
            continue
        file = source_file(root, path)
        preview = _preview(file) if file else None
        if not preview or not preview['excerpt']:
            continue
        title = _plain(record.get('title') or preview['title'])[:100]
        sources[path] = {'source_path': path, 'date': _label(record),
                         'kind': record['kind'], 'title': title or ('周记' if record['kind'] == 'weekly' else '日记'),
                         'excerpt': preview['excerpt']}
    return sources


def _id(kind, identity):
    return kind + ':' + hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]


def _json_list(value):
    try:
        result = json.loads(value or '[]')
        return result if isinstance(result, list) else []
    except (TypeError, ValueError):
        return []


def _echoes(con, sources):
    candidates = []
    for row in _query(con, """SELECT e.*,ml.source_path left_source,mr.source_path right_source
        FROM memory_echoes e JOIN memories ml ON ml.id=e.left_memory_id
        JOIN memories mr ON mr.id=e.right_memory_id ORDER BY e.score DESC LIMIT 200"""):
        left, right = row['left_source'], row['right_source']
        if left == right or left not in sources or right not in sources:
            continue
        row['shared_terms'] = [term[:80] for term in _json_list(row.pop('shared_terms_json', None))
                               if isinstance(term, str)][:12]
        row['reason'] = '两页记录留下了相似的词句，打开原文看看它们如何相遇'
        candidates.append({'type': 'echo', 'item': row,
                           'draw_id': _id('echo', sorted([left, right])),
                           'sources': [sources[left], sources[right]]})
    return list({item['draw_id']: item for item in candidates}.values())


def _cards(con, sources):
    candidates = []

    def add(kind, title, body, metric, paths, identity):
        paths = list(dict.fromkeys(path for path in paths if isinstance(path, str) and path in sources))[:2]
        if not paths:
            return
        item = {'card_type': kind, 'title': title, 'body': body, 'metric': metric,
                'source_paths': paths, 'payload': {}}
        candidates.append({'type': 'card', 'item': item, 'draw_id': _id('card', [kind, identity, paths]),
                           'sources': [sources[path] for path in paths]})

    titles = {'echo': '隔页相逢', 'silence': '留白之间', 'question': '心中回响',
              'first': '初次落笔', 'density': '浓墨一日'}
    bodies = {'echo': '相隔许久的两页，留下了相似的词句', 'silence': '翻到一段留白两端的记录',
              'question': '一个曾经反复写下的问题，或许值得重新打开',
              'first': '从最早留下的记录，重看一段故事的起点', 'density': '这一天写得格外丰盈，回去看看当时的你'}
    for row in _query(con, 'SELECT * FROM curiosity_cards ORDER BY id LIMIT 200'):
        kind = row['card_type']
        add(kind, titles.get(kind, '旧日一隅'), bodies.get(kind, '沿着原文，重拾一段未曾主动寻找的往事'),
            '', _json_list(row.get('source_paths_json')), kind)
    for row in _query(con, 'SELECT * FROM trajectory_signals ORDER BY id LIMIT 100'):
        add('signal', '微光初现', f"{row.get('first_date') or row.get('first_month') or ''} 留下了一点早期的线索",
            f"{row.get('lead_days') or 0} 天后再次浮现", [row.get('first_source')], [row.get('kind'), row.get('label')])
    for row in _query(con, """SELECT r.*,mp.source_path prev_source,mr.source_path return_source
        FROM return_events r LEFT JOIN memories mp ON mp.id=r.prev_memory_id
        LEFT JOIN memories mr ON mr.id=r.return_memory_id ORDER BY r.id LIMIT 100"""):
        add('return', '故事归来', f"{row.get('prev_date') or ''} → {row.get('return_date') or ''}，相似的线索又出现了",
            f"相隔 {row.get('gap_days') or 0} 天", [row.get('prev_source'), row.get('return_source')],
            [row.get('kind'), row.get('label'), row.get('prev_date'), row.get('return_date')])
    for row in _query(con, 'SELECT * FROM dormant_threads ORDER BY id LIMIT 100'):
        add('dormant', '未完的回响', f"{row.get('first_date') or ''} 至 {row.get('last_date') or ''}，几页记录曾留下相关的思绪",
            f"{row.get('occurrences') or 0} 处记录", _json_list(row.get('source_paths_json')),
            [row.get('kind'), row.get('anchor'), row.get('first_date')])
    for row in _query(con, 'SELECT * FROM month_portraits ORDER BY month LIMIT 200'):
        days = _json_list(row.get('notable_days_json'))
        add('portrait', '月中拾光', f"翻到 {row.get('month') or ''}，重读那个月留下的几页",
            f"{row.get('entries') or 0} 篇日记", [day.get('source_path') for day in days if isinstance(day, dict)], row.get('month'))
    return list({item['draw_id']: item for item in candidates}.values())


def draw(con, root, mode='mixed', exclude=None, rng=None):
    if mode not in ('memory', 'echo', 'mixed'):
        raise ValueError('请选择日记、回声或拾遗')
    excluded = parse_exclude(exclude)
    sources = _sources(con, root)
    memories = [{'type': 'memory', 'item': source, 'draw_id': _id('memory', path), 'sources': [source]}
                for path, source in sources.items()]
    pool = _echoes(con, sources) if mode == 'echo' else _cards(con, sources) if mode == 'mixed' else memories
    if mode == 'mixed' and not pool:
        pool = memories
    base = {'mode': mode, 'available_count': len(pool), 'repeated': False}
    if not pool:
        return {**base, 'type': 'echo' if mode == 'echo' else 'memory', 'item': None,
                'draw_id': None, 'sources': [],
                'empty_reason': '暂时还没有能相互呼应的两页，试试抽一页日记' if mode == 'echo' and memories
                else '写下一页日记，或导入旧日记录，再来抽一签'}
    fresh = [item for item in pool if item['draw_id'] not in excluded]
    return {**base, 'repeated': not bool(fresh), **(rng or random.SystemRandom()).choice(fresh or pool)}


def current_source(root, source_path):
    """Validate before indexed reads; deleted entries cannot be revived by an index."""
    file = source_file(root, source_path)
    if not file:
        return None
    entry = product.get_entry(source_path=source_path, root=root)
    if entry and entry.get('deleted_at'):
        return None
    try:
        raw = file.read_bytes()
        text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    except (OSError, UnicodeError):
        return None
    return {'text': text, 'entry': entry, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def current_journal(root, source_path, current, indexed=None):
    """Serve an unindexed/newly edited page without inventing derived context."""
    entry = current['entry']
    record = entry or indexed
    if not record or record.get('kind') not in ('daily', 'weekly'):
        return None
    text, kind = current['text'], record['kind']
    journal_date, year, month, week = record.get('journal_date') or record.get('date'), None, None, None
    if kind == 'daily' and journal_date:
        try:
            day = date.fromisoformat(journal_date)
            year, month = day.year, day.month
        except ValueError:
            journal_date = None
    if kind == 'weekly':
        match = re.search(r'/(\d{4})_(\d{1,2})\.md$', source_path)
        if not match:
            return None
        year, week = int(match[1]), int(match[2])
    sections = _sections(text)
    values = [_plain(value) for value in sections.values()]
    memory = {'id': None, 'kind': kind, 'date': journal_date, 'year': year,
              'month': month, 'week': week, 'source_path': source_path,
              'sha256': current['sha256'], 'bytes': current['bytes'], 'raw_text': text, 'date_anomaly': 0,
              'provenance_type': 'daily_raw' if kind == 'daily' else 'weekly_review', 'authorship': 'user'}
    return {'memory': memory, 'sections': sections,
            'metrics': {'memory_id': None, 'char_count': sum(len(value) for value in values),
                        'line_count': len(text.splitlines()), 'nonempty_sections': sum(bool(value) for value in values),
                        'schedule_items': 0}, 'skills': [], 'topics': [],
            'context': {'previous': None, 'next': None, 'roles': [], 'people': [], 'places': [],
                        'signals': [], 'artifacts': [], 'events': []}, 'product_entry': entry,
            'revisions': product.list_revisions(entry['entry_id'], root)[:12] if entry else [],
            'attachments': product.list_attachments(entry['entry_id'], root) if entry else []}

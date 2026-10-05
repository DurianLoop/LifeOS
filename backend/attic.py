"""Read-only serving queries for the editorial attic. No AI or stored mutations."""
from __future__ import annotations

from datetime import date, timedelta
from html import unescape
import json
import re


VALID = """m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL
AND EXISTS(SELECT 1 FROM sections s WHERE s.memory_id=m.id AND length(trim(s.content))>0)"""
TABLES = {'project': 'project_candidates', 'question': 'question_candidates',
          'decision': 'decision_candidates'}
LABELS = {'project': '项目', 'question': '问题', 'decision': '决定'}


def plain(text):
    text = re.sub(r'<(?:br|/p|/div)\b[^>]*>', '\n', str(text or ''), flags=re.I)
    text = re.sub(r'</?(?:strong|b|em|i|u|s|mark|span|p|div|br)\b[^>]*>', '', text, flags=re.I)
    return unescape(text).strip()


def matched_terms(raw):
    items = json.loads(raw or '[]')
    return [x if isinstance(x, str) else x[0] for x in items
            if isinstance(x, str) or (isinstance(x, list) and x and isinstance(x[0], str))]


def excerpt(con, memory_id, terms=(), limit=240):
    sections = con.execute("""SELECT normalized_name,content FROM sections
        WHERE memory_id=? AND length(trim(content))>0
        ORDER BY CASE normalized_name WHEN '日记' THEN 0 WHEN '自我探索' THEN 1 ELSE 2 END,ordinal""",
        (memory_id,)).fetchall()
    texts = [plain(r['content']) for r in sections]
    found = next((t for t in texts if any(str(term).lower() in t.lower() for term in terms)), None)
    text = found or next((t for t in texts if t), '')
    pos = min((text.lower().find(str(t).lower()) for t in terms if str(t).lower() in text.lower()), default=0)
    start = max(0, pos - 65)
    chunk = text[start:start + limit]
    return ('…' if start else '') + chunk + ('…' if start + limit < len(text) else '')


def source(con, row, terms=()):
    item = dict(row)
    item['excerpt'] = excerpt(con, item['id'], terms)
    return item


def valid_year(value):
    if not value:
        return None
    if not re.fullmatch(r'\d{4}', str(value)) or not 1 <= int(value) <= 9999:
        raise ValueError('年份格式无效')
    return str(value)


def page_args(offset=0, limit=30):
    return max(0, int(offset)), max(1, min(100, int(limit)))


def topic_rows(con):
    items = []
    for row in con.execute(f"""SELECT t.topic,COUNT(DISTINCT m.date) days,COUNT(DISTINCT m.id) pages,
        MIN(m.date) first_date,MAX(m.date) last_date FROM topic_mentions t
        JOIN memories m ON m.id=t.memory_id WHERE {VALID}
        GROUP BY t.topic ORDER BY days DESC,last_date DESC,t.topic LIMIT 24"""):
        item = dict(row)
        ends = []
        for order in ('ASC', 'DESC'):
            end = con.execute(f"""SELECT m.id,m.date,m.source_path,t.matched_terms_json
                FROM memories m JOIN topic_mentions t ON t.memory_id=m.id
                WHERE {VALID} AND t.topic=? ORDER BY m.date {order},m.id {order} LIMIT 1""",
                (item['topic'],)).fetchone()
            record = dict(end)
            terms = matched_terms(record.pop('matched_terms_json'))
            record['excerpt'] = excerpt(con, end['id'], terms or [item['topic']])
            ends.append(record)
        item['first'], item['last'] = ends
        item['span_days'] = (date.fromisoformat(item['last_date']) - date.fromisoformat(item['first_date'])).days
        items.append(item)
    return items


def ledger(con, kind=None, year=None, offset=0, limit=30):
    year = valid_year(year)
    offset, limit = page_args(offset, limit)
    if kind and kind not in TABLES:
        raise ValueError('线索类别无效')
    queries, params = [], []
    for name, table in TABLES.items():
        if kind and name != kind:
            continue
        cond = " AND m.date LIKE ?" if year else ''
        queries.append(f"""SELECT '{name}' kind,c.id,c.text,c.trigger,m.date,m.source_path,
            m.id memory_id FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE {VALID}{cond}""")
        if year:
            params.append(year + '-%')
    union = ' UNION ALL '.join(queries)
    total = con.execute(f'SELECT COUNT(*) FROM ({union})', params).fetchone()[0]
    rows = con.execute(f'SELECT * FROM ({union}) ORDER BY date DESC,kind,id DESC LIMIT ? OFFSET ?',
                       params + [limit, offset]).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item['text'] = plain(item['text'])
        item['title'] = item['text'][:72] + ('…' if len(item['text']) > 72 else '')
        item['label'] = LABELS[item['kind']]
        item['pages'] = 1
        items.append(item)
    return {'items': items, 'total': total, 'offset': offset, 'has_more': offset + len(items) < total}


def overview(con, year=None):
    years = [str(r[0]) for r in con.execute(f'SELECT DISTINCT substr(m.date,1,4) FROM memories m WHERE {VALID} ORDER BY 1 DESC')]
    year = valid_year(year) or (years[0] if years else str(date.today().year))
    months = [{'month': f'{year}-{n:02}', 'days': 0, 'pages': 0, 'quotes': 0} for n in range(1, 13)]
    for r in con.execute(f"""SELECT substr(m.date,1,7) month,COUNT(DISTINCT m.date) days,COUNT(*) pages
        FROM memories m WHERE {VALID} AND m.date LIKE ? GROUP BY substr(m.date,1,7)""", (year + '-%',)):
        month = int(r['month'][5:7])
        if 1 <= month <= 12:
            months[month - 1].update(dict(r))
    for r in con.execute(f"""SELECT substr(m.date,1,7) month,COUNT(*) count FROM quote_candidates q
        JOIN memories m ON m.id=q.memory_id WHERE {VALID} AND m.date LIKE ? GROUP BY substr(m.date,1,7)""", (year + '-%',)):
        month = int(r['month'][5:7])
        if 1 <= month <= 12:
            months[month - 1]['quotes'] = r['count']
    count = con.execute(f'SELECT COUNT(*) FROM memories m WHERE {VALID}').fetchone()[0]
    # Show one actual candidate per category; never infer a project identity from a trigger.
    previews = [ledger(con, name, limit=1)['items'] for name in TABLES]
    return {'topics': topic_rows(con), 'ledger': [item for group in previews for item in group],
            'years': years, 'year': year, 'months': months, 'recorded_days': sum(m['days'] for m in months),
            'pages': count}


def review(con, topic=None, year=None, offset=0, limit=30):
    offset, limit = page_args(offset, limit)
    year = valid_year(year)
    cond, params = VALID, []
    if topic:
        cond += ' AND EXISTS(SELECT 1 FROM topic_mentions t WHERE t.memory_id=m.id AND t.topic=?)'
        params.append(topic)
    if year:
        cond += ' AND m.date LIKE ?'
        params.append(year + '-%')
    total = con.execute(f'SELECT COUNT(*) FROM memories m WHERE {cond}', params).fetchone()[0]
    rows = con.execute(f'SELECT m.id,m.date,m.source_path FROM memories m WHERE {cond} ORDER BY m.date DESC,m.id DESC LIMIT ? OFFSET ?',
                       params + [limit, offset]).fetchall()
    items = []
    for row in rows:
        match = con.execute('SELECT matched_terms_json FROM topic_mentions WHERE memory_id=? AND topic=?', (row['id'], topic)).fetchone() if topic else None
        items.append(source(con, row, matched_terms(match[0]) if match else []))
    return {'items': items, 'total': total,
            'offset': offset, 'has_more': offset + len(rows) < total}


def month_pages(con, month, offset=0, limit=30):
    if not re.fullmatch(r'\d{4}-\d{2}', str(month)):
        raise ValueError('月份格式无效')
    date.fromisoformat(month + '-01')
    offset, limit = page_args(offset, limit)
    cond = VALID + ' AND m.date LIKE ?'
    total = con.execute(f'SELECT COUNT(*) FROM memories m WHERE {cond}', (month + '-%',)).fetchone()[0]
    rows = con.execute(f'SELECT m.id,m.date,m.source_path FROM memories m WHERE {cond} ORDER BY m.date DESC,m.id DESC LIMIT ? OFFSET ?',
                       (month + '-%', limit, offset)).fetchall()
    return {'items': [source(con, r) for r in rows], 'total': total, 'offset': offset,
            'has_more': offset + len(rows) < total}


def lineage(con, kind, item_id):
    if kind not in TABLES:
        raise ValueError('线索类别无效')
    row = con.execute(f"""SELECT c.*,m.source_path,m.date recorded_date FROM {TABLES[kind]} c
        JOIN memories m ON m.id=c.memory_id WHERE c.id=? AND {VALID}""", (int(item_id),)).fetchone()
    if row is None:
        return None
    item = dict(row)
    item['text'] = plain(item['text'])
    item['date'] = item.pop('recorded_date')
    related = []
    if kind == 'decision':
        until = date.fromordinal(min(date.fromisoformat(item['date']).toordinal()+30,date.max.toordinal())).isoformat()
        for r in con.execute(f"""SELECT DISTINCT m.id,m.date,m.source_path FROM memories m
            JOIN topic_mentions t ON t.memory_id=m.id WHERE {VALID} AND m.date>? AND m.date<=?
            AND t.topic IN (SELECT topic FROM topic_mentions WHERE memory_id=?) ORDER BY m.date,m.id LIMIT 6""",
            (item['date'], until, item['memory_id'])):
            related.append(source(con, r))
    return {'item': item, 'related': related}

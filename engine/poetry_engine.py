"""A small, source-preserving daily poetry recommendation for the local journal."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import threading
from pathlib import Path

from engine import product_core as product

ROOT = Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
CATALOG_PATH = ROOT / 'config' / 'poetry_catalog.json'
_GENERATING: set[tuple[str, str]] = set()
_ERRORS: dict[tuple[str, str], str] = {}
_LOCK = threading.Lock()


class PoetryError(ValueError):
    pass


def catalog() -> list[dict]:
    items = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
    ids = [item['id'] for item in items]
    if len(ids) != len(set(ids)):
        raise PoetryError('诗词库存在重复作品 ID')
    for item in items:
        if item['quote'] not in ''.join(item['lines']):
            raise PoetryError(f"诗词库名句与全文不符：{item['id']}")
    return items


def _date(value: str | None) -> str:
    day = value or dt.date.today().isoformat()
    try:
        if dt.date.fromisoformat(day).isoformat() != day:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise PoetryError('日期格式应为 YYYY-MM-DD') from exc
    return day


def _connect(root: Path):
    con = product.connect(root)
    con.execute('''CREATE TABLE IF NOT EXISTS daily_poetry (
        journal_date TEXT PRIMARY KEY,
        poem_id TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        created_at TEXT NOT NULL
    )''')
    con.commit()
    return con


def _record(row, poems: dict[str, dict]):
    if not row:
        return None
    data = dict(row)
    return {**data, 'poem': poems.get(data['poem_id'])}


def _journal(root: Path, day: str):
    con = product.connect(root)
    try:
        row = con.execute("""SELECT entry_id,current_revision_id FROM entries
            WHERE kind='daily' AND journal_date=? AND deleted_at IS NULL
            ORDER BY updated_at DESC LIMIT 1""", (day,)).fetchone()
    finally:
        con.close()
    if not row or not row['current_revision_id']:
        return None
    revision = product.read_revision(row['current_revision_id'], root)
    if not revision:
        return None
    raw = revision['content'] or ''
    raw = re.sub(r'^---\s*\n.*?\n---\s*\n', '', raw, count=1, flags=re.S)
    raw = re.sub(r'^#{1,6}\s+[^\n]*$', '', raw, flags=re.M).strip()
    if not raw:
        return None
    return {'entry_id': row['entry_id'], 'revision_id': row['current_revision_id'], 'text': raw[:6000]}


def status(day: str | None = None, root: Path = ROOT) -> dict:
    day = _date(day)
    poems = {item['id']: item for item in catalog()}
    con = _connect(root)
    try:
        rows = con.execute('SELECT * FROM daily_poetry ORDER BY journal_date DESC').fetchall()
    finally:
        con.close()
    records = [_record(row, poems) for row in rows]
    current = next((record for record in records if record['journal_date'] == day), None)
    key = (str(root.resolve()), day)
    from backend import ai_providers
    ai = ai_providers.availability('今日一诗')
    return {
        'date': day,
        'current': current,
        'history': records,
        'has_journal': bool(_journal(root, day)),
        'auto_enabled': product.get_setting('poetry.auto_enabled', 'false', root) == 'true',
        'generating': key in _GENERATING,
        'last_error': _ERRORS.get(key, ''),
        'remaining': len(poems) - len({record['poem_id'] for record in records}),
        'ai': {'configured': ai['configured'], 'enabled': ai['enabled'],
               'available': ai['available'], 'allow_remote': not ai['requires_remote'] or ai_providers.privacy_status()['allow_remote'],
               'reason': ai['reason']},
    }


def set_auto(enabled: bool, root: Path = ROOT) -> bool:
    product.set_settings({'poetry.auto_enabled': enabled}, root)
    return enabled


def _candidates(text: str, used: set[str], day: str) -> list[dict]:
    available = [item for item in catalog() if item['id'] not in used]
    def rank(item):
        hits = sum(1 for tag in item['tags'] if tag in text)
        tie = int(hashlib.sha256(f"{day}:{item['id']}".encode()).hexdigest()[:8], 16)
        return (-hits, tie)
    ranked = sorted(available, key=rank)
    # Exact keyword matching is only a hint. When it finds nothing, give the
    # model the full small anthology so a diary can still meet a fitting poem.
    limit = 12 if any(tag in text for item in available for tag in item['tags']) else len(ranked)
    return ranked[:limit]


def _parse_choice(text: str, candidates: list[dict]) -> tuple[str, str]:
    raw = (text or '').strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw).strip()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PoetryError('AI 返回的推荐格式无效，请重试') from exc
    if not isinstance(obj, dict) or not isinstance(obj.get('reason'), str):
        raise PoetryError('AI 返回的推荐格式无效，请重试')
    chosen = str(obj.get('poem_id') or '')
    reason = re.sub(r'\s+', ' ', str(obj.get('reason') or '')).strip()
    if chosen not in {item['id'] for item in candidates}:
        raise PoetryError('AI 未从候选诗词中选择，请重试')
    if not 12 <= len(reason) <= 220:
        raise PoetryError('AI 未给出合适的推荐缘由，请重试')
    return chosen, reason


def generate(day: str | None = None, root: Path = ROOT, *, chat=None, _reserved=False) -> dict:
    day = _date(day)
    key = (str(root.resolve()), day)
    if not _reserved:
        with _LOCK:
            if key in _GENERATING:
                return {'generating': True, 'date': day}
            _GENERATING.add(key)
            _ERRORS.pop(key, None)
    try:
        current = status(day, root)['current']
        if current:
            return {'current': current, 'existing': True}
        journal = _journal(root, day)
        if not journal:
            raise PoetryError('这一天还没有可用于荐诗的日记正文')
        from backend import ai_providers
        if chat is None and not ai_providers.availability('今日一诗')['available']:
            raise PoetryError('请先在隐私 / AI 中启用并配置模型')
        con = _connect(root)
        try:
            used = {row[0] for row in con.execute('SELECT poem_id FROM daily_poetry')}
        finally:
            con.close()
        candidates = _candidates(journal['text'], used, day)
        if not candidates:
            raise PoetryError('诗词库中的作品都已推荐过，可以回看往日所得')
        briefs = [{'poem_id': item['id'], 'title': item['title'], 'author': item['author'],
                   'quote': item['quote'], 'context': item['context'], 'tags': item['tags']} for item in candidates]
        prompt = (
            '你是日记荐诗助手。只能从候选诗词中选一首，不能编造诗句、作者生平或用户经历。'
            '依据日记中明确写出的经历与心绪，优先选贴切且易记的名句。'
            'reason 用易读的短篇文言，约 50 到 100 字；可联系候选的 context，'
            '若 context 仅描述诗中场景，不可扩写成未经证实的诗人生平。'
            '只返回 JSON 对象：{"poem_id":"候选 ID","reason":"推荐缘由"}。'
        )
        caller = chat or ai_providers.chat
        # A queued automatic job must respect an opt-out before sending a diary.
        if _reserved and product.get_setting('poetry.auto_enabled', 'false', root) != 'true':
            return {'cancelled': True, 'date': day}
        response = caller([{'role': 'system', 'content': prompt},
                           {'role': 'user', 'content': json.dumps({'date': day, 'journal': journal['text'],
                                                                  'candidates': briefs}, ensure_ascii=False)}],
                          temperature=0.35, max_tokens=340, feature='今日一诗', use_cache=False)
        if not response:
            raise PoetryError('AI 暂不可用，请稍后重试')
        poem_id, reason = _parse_choice(response.get('text', ''), candidates)
        con = _connect(root)
        try:
            con.execute('''INSERT OR IGNORE INTO daily_poetry
                (journal_date,poem_id,reason,entry_id,revision_id,created_at)
                VALUES(?,?,?,?,?,?)''', (day, poem_id, reason, journal['entry_id'],
                                         journal['revision_id'], product.utcnow()))
            con.commit()
            row = con.execute('SELECT * FROM daily_poetry WHERE journal_date=?', (day,)).fetchone()
        finally:
            con.close()
        if not row:
            raise PoetryError('这首诗刚被用于另一日，请重试')
        return {'current': _record(row, {item['id']: item for item in catalog()}), 'existing': False}
    except Exception as exc:
        _ERRORS[key] = str(exc) if isinstance(exc, PoetryError) else '荐诗暂时失败，请稍后重试'
        raise
    finally:
        with _LOCK:
            _GENERATING.discard(key)


def schedule(day: str, root: Path = ROOT) -> bool:
    day = _date(day)
    if product.get_setting('poetry.auto_enabled', 'false', root) != 'true':
        return False
    if day != dt.date.today().isoformat():
        return False
    if not _journal(root, day):
        return False
    key = (str(root.resolve()), day)
    con = _connect(root)
    try:
        if con.execute('SELECT 1 FROM daily_poetry WHERE journal_date=?', (day,)).fetchone():
            return False
    finally:
        con.close()
    with _LOCK:
        if key in _GENERATING:
            return False
        _GENERATING.add(key)
        _ERRORS.pop(key, None)
    def work():
        try:
            generate(day, root, _reserved=True)
        except Exception:
            pass  # The error is retained for a visible manual retry.
    try:
        threading.Thread(target=work, name='lifeos-daily-poetry', daemon=True).start()
    except Exception:
        with _LOCK:
            _GENERATING.discard(key)
        raise
    return True

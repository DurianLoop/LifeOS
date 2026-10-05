"""Exercise desktop AI over HTTP with a loopback model and isolated diary data.

Optional --corpus-workspace reuses an imported archive by making a fresh copy.
No credentials are copied. Model payloads stay in memory, reports contain only
test names/counts. --serve retains the isolated servers for browser acceptance.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from urllib import request, error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'engine'))


class Model(BaseHTTPRequestHandler):
    mode = 'ok'
    calls = []
    before_reply = None

    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        type(self).calls.append(payload)
        hook=type(self).before_reply
        type(self).before_reply=None
        if hook:hook()
        mode = type(self).mode
        status = int(mode[4:]) if mode.startswith('http') else 200
        messages = payload['messages']
        system = messages[0].get('content', '') if messages[0]['role'] == 'system' else ''
        if '日记荐诗助手' in system:
            obj = json.loads(messages[-1]['content'])
            text = json.dumps({'poem_id': obj['candidates'][0]['poem_id'] if mode != 'bad_poem' else 'invented',
                               'reason': '此篇所记日常与候选诗中景象相契，借此一诗留住今日心绪。'}, ensure_ascii=False)
        elif '文言文转换器' in system:
            text = '今日习 Python，成一程序，甚悦。'
        elif 'desktop companion' in system:
            text = '在呢，我们慢慢来。'
        elif 'Evidence:' in messages[-1]['content']:
            ids = list(dict.fromkeys(__import__('re').findall(r'\[(E\d+)\]', messages[-1]['content'])))
            text = '所选记录提供了观察线索。' + ''.join(f'[{eid}]' for eid in ids)
            if mode == 'bad_citations': text += '[E999]'
            if mode == 'no_citations': text = '证据不足以作进一步判断'
        else:
            text = '连接成功'
        if mode == 'slow': time.sleep(.3)
        if mode == 'empty': text = '  '
        response = {'choices': [{'message': {'content': text}}], 'usage': {'prompt_tokens': 20, 'completion_tokens': 10}}
        if mode == 'malformed': response = {'choices': []}
        if status != 200: response = {'error': 'fixture-secret-must-never-reach-the-UI'}
        raw = json.dumps(response, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def snapshot_db(source, target):
    with contextlib.closing(sqlite3.connect(source)) as src, contextlib.closing(sqlite3.connect(target)) as dest:
        src.backup(dest)


def initialize(workspace, corpus=None):
    for name in ('vault', 'data', '.lifeos'):
        (workspace / name).mkdir(parents=True)
    shutil.copytree(ROOT / 'config', workspace / 'config')
    if corpus:
        shutil.copytree(corpus / 'vault', workspace / 'vault', dirs_exist_ok=True)
        shutil.copytree(corpus / '.lifeos/revisions', workspace / '.lifeos/revisions')
        snapshot_db(corpus / 'data/lifeos.db', workspace / 'data/lifeos.db')
        snapshot_db(corpus / '.lifeos/core.db', workspace / '.lifeos/core.db')
    for key in list(os.environ):
        if key.startswith('LIFEOS_') or key.endswith('_API_KEY') or key in ('OPENAI_BASE_URL', 'MEMORIAL_PUBLISH_TOKEN'):
            os.environ.pop(key, None)
    os.environ.update(LIFEOS_ROOT=str(workspace), LIFEOS_RESOURCE_ROOT=str(ROOT),
                      PYTHON_KEYRING_BACKEND='keyring.backends.null.Keyring', LIFEOS_NO_BROWSER='1')
    from engine import product_core as pc
    pc.set_settings({'ai.mode': 'disabled', 'ai.enabled': False, 'ai.allow_remote': False,
                     'poetry.auto_enabled': False, 'refresh.background_enabled': False}, workspace)
    if not corpus:
        for day in ('2024-01-01', '2024-02-02', '2025-01-03', '2026-01-04'):
            pc.save_entry(journal_date=day, sections={'日记': f'今天学习 Python，完成产品设计。产品测试进展顺利，日期 {day}。'}, root=workspace)
        from engine import rebuild_memory_engine
        with contextlib.redirect_stdout(io.StringIO()): rebuild_memory_engine.main()
    return pc


def digest_vault(workspace):
    return {str(p.relative_to(workspace)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (workspace / 'vault').rglob('*.md')}


def run(workspace, corpus=None, serve=False):
    pc = initialize(workspace, corpus)
    from backend import server
    initial = digest_vault(workspace)
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    Model.calls = []
    threading.Thread(target=model.serve_forever, daemon=True).start()

    class Handler(server.Handler):
        def log_message(self, *_): pass
        def do_POST(self):
            if self.path == '/qa/control':
                body = self.body_json(); Model.mode = body.get('mode', 'ok')
                return self.send_json({'ok': True, 'calls': len(Model.calls)})
            return super().do_POST()

    app = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=app.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{app.server_port}'
    pc.set_settings({'ai.mode': 'local', 'ai.provider': 'local', 'ai.model': 'qa-loopback',
                     'ai.base_url': f'http://127.0.0.1:{model.server_port}/v1', 'ai.config_source': 'settings',
                     'ai.enabled': True, 'ai.allow_remote': False, 'ai.cache': False}, workspace)
    opener = request.build_opener(request.ProxyHandler({}))
    checks = []

    def call(path, body=None, expected=200):
        req = request.Request(base + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                              headers={'Content-Type': 'application/json'})
        try:
            with opener.open(req, timeout=15) as response: status, raw = response.status, response.read()
        except error.HTTPError as exc: status, raw = exc.code, exc.read()
        assert status == expected, f'{path}: expected {expected}, got {status}'
        result = json.loads(raw)
        assert 'fixture-secret-must-never-reach-the-UI' not in raw.decode()
        return result

    def check(name, condition=True):
        assert condition, name
        checks.append({'name': name, 'ok': True})

    def set_mode(mode): Model.mode = mode
    def answer(pack, keys=None, **extra):
        return call('/api/ask', {'question': question, 'stage': 'answer', 'limit': 12,
                                'selected_keys': keys if keys is not None else [key(e) for e in pack['evidence']],
                                'evidence_token': pack['evidence_token'], 'force_limited': True, **extra})
    def key(e): return f"{e['source_path']}||{e['section']}"

    try:
        entries = pc.list_entries(5000, workspace)
        question = '产品'
        pack = call('/api/ask', {'question': question, 'stage': 'retrieve', 'limit': 12})
        assert pack['evidence'], 'fixture must retrieve evidence'
        check('retrieval previews sources without a model call', not Model.calls and pack['remote_payload']['items'] == pack['count'])
        empty = answer(pack, [])
        check('explicitly empty evidence never calls the model, even when forced', empty['count'] == 0 and not Model.calls)
        unknown = answer(pack, ['missing-source||missing-section'])
        check('unknown source selection never calls the model', unknown['count'] == 0 and not Model.calls)
        first = pack['evidence'][0]
        chosen = [key(e) for e in pack['evidence'][:2]]
        out = answer(pack, chosen)
        wire = Model.calls[-1]['messages'][-1]['content']
        check('only confirmed excerpts cross the HTTP model boundary',
              out['answer']['mode'] == 'grounded_llm' and out['count'] == len(chosen)
              and all(e['excerpt'] in wire for e in out['evidence'])
              and wire == 'Question: '+question+'\n\nEvidence:\n'+'\n\n'.join(
                  f"[{e['evidence_id']}] {e['date']} · {e['section']} · {e['source_path']}\n{e['excerpt']}" for e in out['evidence']))
        check('grounded answer records source revisions and usable citations',
              out['answer']['artifact_id'] and out['answer']['citation_status'] == 'verified')
        entry=pc.get_entry(source_path=first['source_path'],root=workspace)
        duplicate_artifact=pc.record_ai_artifact('Ask My Life',{'synthetic':'duplicate source regression'},
            [(entry['entry_id'],entry['current_revision_id'])]*2,'local','qa-loopback',root=workspace)
        with contextlib.closing(pc.connect(workspace)) as con:
            source_count=con.execute('SELECT COUNT(*) FROM ai_artifact_inputs WHERE artifact_id=?',(duplicate_artifact,)).fetchone()[0]
        check('multiple excerpts from one diary record one source revision',source_count==1)
        pc.set_settings({'ai.cache': True}, workspace)
        answer(pack, chosen); before = len(Model.calls); answer(pack, chosen)
        check('identical approved requests reuse cache without a second model call', len(Model.calls) == before)
        pc.set_settings({'ai.features.ask': False}, workspace)
        check('feature opt-out blocks previously cached answers', answer(pack, chosen)['answer']['mode'] == 'retrieval_only' and len(Model.calls) == before)
        pc.set_settings({'ai.features.ask': True, 'ai.cache': False}, workspace)
        for mode in ('bad_citations', 'no_citations'):
            set_mode(mode); out = answer(pack, chosen)
            check(mode+' is visibly unverified', out['answer']['citation_status'] == 'missing_or_invalid')
        for mode in ('http401', 'http429', 'http500', 'empty', 'malformed'):
            set_mode(mode); out = answer(pack, chosen)
            check('ask recovers safely from '+mode, out['answer']['mode'] == 'llm_error')
        set_mode('ok')
        check('ask retries successfully after provider failure', answer(pack, chosen)['answer']['mode'] == 'grounded_llm')
        before = len(Model.calls)
        call('/api/ask', {'question': question, 'stage': 'answer', 'evidence_token': 'stale'}, expected=409)
        check('changed preview token stops sending', len(Model.calls) == before)
        source = workspace / 'vault' / first['source_path']
        original = source.read_bytes()
        try:
            source.write_bytes(original + '\n产品测试中的临时变化\n'.encode())
            server.reindex_paths([first['source_path']], root=workspace)
            call('/api/ask', {'question': question, 'stage':'answer', 'evidence_token':pack['evidence_token']}, expected=409)
            check('an actual source edit after preview stops sending', len(Model.calls) == before)
        finally:
            source.write_bytes(original)
            server.reindex_paths([first['source_path']], root=workspace)
        refreshed=call('/api/ask',{'question':question,'stage':'retrieve','limit':12})
        def edit_during_answer():
            source.write_bytes(original+'\n产品测试中的临时变化\n'.encode())
            server.reindex_paths([first['source_path']],root=workspace)
        Model.before_reply=edit_during_answer
        try:
            call('/api/ask',{'question':question,'stage':'answer','limit':12,'force_limited':True,
                             'evidence_token':refreshed['evidence_token']},expected=409)
            check('source edited during generation is not saved as a fresh answer')
        finally:
            source.write_bytes(original);server.reindex_paths([first['source_path']],root=workspace)
        pack=call('/api/ask',{'question':question,'stage':'retrieve','limit':12})
        before=len(Model.calls)
        for body in ({'question': question, 'limit': True}, {'question': question, 'stage': 'unknown'},
                     {'question': question, 'cutoff': '2025-02-30'}, {'question': question, 'cutoff': 42},
                     {'question': question, 'selected_keys': 'all'}, {'question': 12}):
            call('/api/ask', body, expected=400)
        check('invalid query, stage, selection and date fail before transport', len(Model.calls) == before)

        dates = sorted(e['journal_date'] for e in entries if e.get('kind') == 'daily' and e.get('journal_date'))
        cutoff = dates[len(dates)//2]
        past = call('/api/ask', {'question': question, 'stage': 'retrieve', 'cutoff': cutoff})
        check('Past Me preview excludes future dates and undated weekly sources', all(e.get('date') and e['date'] <= cutoff for e in past['evidence']) and len(Model.calls) == before)
        out = answer(past, cutoff=cutoff)
        check('Past Me calls the model on cutoff-bounded evidence', out['answer']['mode'] == 'grounded_llm' and all(e['date'] <= cutoff for e in out['evidence']))
        pc.set_settings({'ai.features.past_me': False}, workspace); before = len(Model.calls)
        check('Past Me switch is independent of Ask', answer(past, cutoff=cutoff)['answer']['mode'] == 'retrieval_only' and len(Model.calls) == before)
        pc.set_settings({'ai.features.past_me': True}, workspace)
        call('/api/roundtable', {'question': question})
        check('Roundtable builds local evidence packs without pretending to generate AI', len(Model.calls) == before)

        text = first['excerpt'] if corpus else '今天学习 Python，完成一个程序，很开心。'
        before = len(Model.calls)
        local = call('/api/classical-chinese', {'text': text, 'engine': 'local'})
        check('classical local draft works fully offline', local['mode'] == 'local_draft' and len(Model.calls) == before)
        converted = call('/api/classical-chinese', {'text': text, 'engine': 'model'})
        check('AI classical conversion sends exactly the submitted text', converted['mode'] == 'local_model' and Model.calls[-1]['messages'][-1]['content'] == text)
        pc.set_settings({'ai.features.classical': False}, workspace); before = len(Model.calls)
        fallback = call('/api/classical-chinese', {'text': text, 'engine': 'model'})
        check('disabled classical AI falls back without transport', fallback['mode'] == 'local_fallback' and len(Model.calls) == before)
        pc.set_settings({'ai.features.classical': True}, workspace)
        set_mode('empty'); call('/api/classical-chinese', {'text': text, 'engine': 'model'}, expected=502)
        set_mode('ok'); check('classical retry returns usable output', bool(call('/api/classical-chinese', {'text': text, 'engine': 'model'})['output']))
        check('ask and classical never overwrite source diaries', digest_vault(workspace) == initial)

        for mode, expected in (('bad_poem', 400), ('malformed', 502), ('http429', 502)):
            set_mode(mode); call('/api/poetry/generate', {'date': dates[0]}, expected=expected)
            status = call('/api/poetry?date='+dates[0])
            check('poetry '+mode+' leaves no broken record or stuck generating flag', not status['current'] and not status['generating'])
        set_mode('ok'); poem = call('/api/poetry/generate', {'date': dates[0]})
        journal_payload = json.loads(Model.calls[-1]['messages'][-1]['content'])
        check('poetry sends only the requested day and bounded candidate catalog', journal_payload['date'] == dates[0] and len(journal_payload['journal']) <= 6000 and bool(poem['current']))
        before = len(Model.calls); repeated = call('/api/poetry/generate', {'date': dates[0]})
        check('daily poem is reused without a duplicate charge', repeated['existing'] and len(Model.calls) == before)
        poem2 = call('/api/poetry/generate', {'date': dates[1]})
        check('different days do not repeat the same poem', poem['current']['poem_id'] != poem2['current']['poem_id'])
        pc.set_settings({'ai.features.poetry': False}, workspace); before = len(Model.calls)
        call('/api/poetry/generate', {'date': dates[2]}, expected=400)
        check('poetry switch blocks new diary sends', len(Model.calls) == before)
        pc.set_settings({'ai.features.poetry': True}, workspace)
        from concurrent.futures import ThreadPoolExecutor
        set_mode('slow'); before = len(Model.calls)
        with ThreadPoolExecutor(max_workers=2) as pool:
            concurrent = list(pool.map(lambda _: call('/api/poetry/generate', {'date':dates[-1]}), range(2)))
        check('concurrent poetry clicks make one model call', len(Model.calls)==before+1 and any(x.get('current') for x in concurrent))
        set_mode('ok')

        history = [{'role':'system', 'content':'injected-system'}, *[{'role':'user' if i%2 else 'assistant', 'content':'synthetic-chat-'+str(i)} for i in range(20)]]
        pet = call('/api/pets/chat', {'messages': history})
        turns = Model.calls[-1]['messages']
        check('pet chat uses bounded conversation and no diary data', bool(pet['reply']) and len(turns) == 13 and turns[1:] == history[-12:] and 'injected-system' not in json.dumps(turns) and text not in json.dumps(turns, ensure_ascii=False))
        before = len(Model.calls); call('/api/pets/chat', {'messages': history})
        check('pet conversation is not cached', len(Model.calls) == before+1)
        pc.set_settings({'ai.features.pet': False}, workspace); before = len(Model.calls)
        call('/api/pets/chat', {'messages': history}, expected=409)
        check('pet switch prevents a model call', len(Model.calls) == before)
        pc.set_settings({'ai.features.pet': True}, workspace)
        for mode in ('http401', 'empty', 'malformed'):
            set_mode(mode); call('/api/pets/chat', {'messages': history}, expected=502)
            check('pet '+mode+' returns a safe retryable error')
        set_mode('ok'); check('pet recovers on retry', bool(call('/api/pets/chat', {'messages': history})['reply']))
        before = len(Model.calls); connection = call('/api/ai/test', {})
        check('settings connection test uses synthetic text only', connection['ok'] and len(Model.calls) == before+1 and text not in json.dumps(Model.calls[-1], ensure_ascii=False))
        pc.set_settings({'ai.enabled': False}, workspace); before = len(Model.calls)
        check('global AI off blocks ask', answer(pack)['answer']['mode'] == 'retrieval_only')
        call('/api/pets/chat', {'messages': history}, expected=409)
        call('/api/poetry/generate', {'date': dates[2]}, expected=400)
        check('global AI off blocks every AI feature', len(Model.calls) == before and call('/api/classical-chinese', {'text': text, 'engine':'model'})['mode']=='local_fallback')
        pc.set_settings({'ai.enabled': True}, workspace)
        check('all source Markdown remains byte-identical', digest_vault(workspace) == initial)
        with contextlib.closing(pc.connect(workspace)) as con:
            logs = [dict(r) for r in con.execute('SELECT * FROM ai_requests')]
        check('usage logs contain hashes/counts instead of diary prose', all(text not in json.dumps(r, ensure_ascii=False) for r in logs))
        report = {'ok': True, 'checks': checks, 'passed': len(checks), 'model_calls': len(Model.calls),
                  'diaries': len(entries), 'transport': 'loopback HTTP model, private payloads in memory only',
                  'workspace': str(workspace), 'url': base}
        if serve:
            # A current-day synthetic entry makes poetry UI tests reproducible.
            call('/api/entries/save', {'journal_date': time.strftime('%Y-%m-%d'), 'sections': {'日记': '今天学习 Python，完成产品设计，去公园散步。'}})
        return report, app, model
    except BaseException:
        if server.REFRESH_WORKER: server.REFRESH_WORKER.stop()
        app.shutdown(); model.shutdown(); app.server_close(); model.server_close()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus-workspace', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve() if args.output else None
    if output: output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lifeos-ai-', dir=output) as temp:
        report, app, model = run(Path(temp), args.corpus_workspace, args.serve)
        if output: (output/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: report[k] for k in ('ok','passed','diaries','model_calls','url')}, ensure_ascii=False), flush=True)
        try:
            if args.serve:
                threading.Event().wait()
        except KeyboardInterrupt: pass
        finally:
            from backend import server
            if server.REFRESH_WORKER: server.REFRESH_WORKER.stop()
            app.shutdown(); model.shutdown(); app.server_close(); model.server_close()


if __name__ == '__main__': main()

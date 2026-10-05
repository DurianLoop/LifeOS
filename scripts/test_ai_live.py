"""Opt-in live Codex acceptance using synthetic diaries and an isolated profile.

Never included in the offline release runner. Requires the user's existing
local Codex authentication; does not read or send their real journal content.
"""
from __future__ import annotations

import argparse
import gc
import json
from pathlib import Path
import re
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ai_workflows import initialize


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--classical-only',action='store_true')
    parser.add_argument('--output',type=Path,default=Path('docs/qa_ai_live'))
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    checks=json.loads((args.output/'report.json').read_text(encoding='utf-8'))['checks'] if args.classical_only and (args.output/'report.json').is_file() else []
    def check(name,condition,**safe):
        checks[:]=[item for item in checks if item['name']!=name]
        checks.append({'name':name,'ok':bool(condition),**safe})
        (args.output/'report.json').write_text(json.dumps({'ok':all(x['ok'] for x in checks),'checks':checks,'synthetic_only':True},ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(checks[-1],ensure_ascii=False),flush=True)
    with tempfile.TemporaryDirectory(prefix='lifeos-live-',dir=args.output) as tmp:
        root=Path(tmp);pc=initialize(root)
        pc.set_settings({'ai.mode':'codex','ai.provider':'codex','ai.enabled':True,'ai.allow_remote':True,'ai.cache':False},root)
        from backend import server,ai_control,ai_providers
        from engine import poetry_engine
        if args.classical_only:
            result=server.call_classical_chinese('今天用 Python 写了 3 个程序，测试了 2 次，很开心。')
            text=(result or {}).get('text','')
            check('classical real rewrite preserves concrete facts','Python' in text and bool(re.search(r'[3三]',text)) and bool(re.search(r'[2二两]',text)))
            server.REFRESH_WORKER.stop();gc.collect()
            return 0 if all(x['ok'] for x in checks) else 1
        state=ai_providers.availability()
        if not state['available']:
            check('installed Codex available',False,reason=state['reason']);return 1
        connected=ai_control.test_connection(root)
        check('real Codex connection',connected.get('ok'),model=connected.get('model'),status=connected.get('status'))
        evidence=[{'evidence_id':'E1','date':'2024-01-01','section':'日记','source_path':'synthetic/one.md','excerpt':'今天完成了产品原型。'},
                  {'evidence_id':'E2','date':'2024-02-02','section':'日记','source_path':'synthetic/two.md','excerpt':'今天测试产品原型，发现按钮位置需要调整。'}]
        for feature in ('Ask My Life','Past Me'):
            result=server.call_llm('这些记录明确写了哪些产品进展？',evidence,feature=feature)
            text=(result or {}).get('text','')
            cited=set(re.findall(r'\[(E\d+)\]',text))
            check(feature+' real answer and citation IDs',bool(text.strip()) and bool(cited) and cited<={'E1','E2'})
        result=server.call_classical_chinese('今天用 Python 写了 3 个程序，测试了 2 次，很开心。')
        text=(result or {}).get('text','')
        check('classical real rewrite preserves concrete facts','Python' in text and bool(re.search(r'[3三]',text)) and bool(re.search(r'[2二两]',text)))
        try:
            result=poetry_engine.generate('2024-01-01',root)
            check('poetry real model selects a valid catalog item',bool(result.get('current')))
        except Exception:
            check('poetry real model selects a valid catalog item',False)
        try:
            result=server.pet_companion_chat([{'role':'user','content':'我正在做一个测试，请简单打个招呼。'}])
            check('pet real conversation',bool((result or {}).get('text','').strip()))
        except Exception:
            check('pet real conversation',False)
        server.REFRESH_WORKER.stop();gc.collect()
    return 0 if all(x['ok'] for x in checks) else 1


if __name__=='__main__':raise SystemExit(main())

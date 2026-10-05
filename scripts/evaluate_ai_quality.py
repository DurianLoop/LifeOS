"""Opt-in semantic acceptance with a locally prepared, private case manifest.

Prepare cases and expected facts before invoking this script. --run sends only
the questions and selected evidence to the configured Codex connection. Both
private answers and the manifest must remain in a Git-ignored output directory.
Citation checks are mechanical; factual support needs a separate source review.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ai_workflows import initialize


def require_private_path(path):
    repo=Path(__file__).resolve().parents[1]
    try:relative=path.resolve().relative_to(repo).as_posix()
    except ValueError:raise ValueError('Private evaluation files must stay inside a Git-ignored repository folder') from None
    result=subprocess.run(['git','check-ignore','--quiet','--',relative],cwd=repo,capture_output=True)
    if result.returncode!=0:
        raise ValueError('Private evaluation files must be Git ignored')


def validate_case(case):
    if not isinstance(case,dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,48}',case.get('id','')):
        raise ValueError('Each case needs a short, unique id')
    if not isinstance(case.get('question'),str) or not case['question'].strip():
        raise ValueError('Each case needs a question')
    evidence=case.get('evidence')
    if not isinstance(evidence,list) or not 1<=len(evidence)<=8:
        raise ValueError('Each case needs 1–8 selected excerpts')
    if sum(len(e.get('excerpt','')) for e in evidence)>8000:
        raise ValueError('Evidence must stay within 8,000 characters per case')
    for i,e in enumerate(evidence,1):
        if e.get('evidence_id')!=f'E{i}' or any(not isinstance(e.get(k),str) for k in ('date','section','source_path','excerpt')):
            raise ValueError('Evidence IDs must be sequential and fields must be text')
        cutoff=case.get('cutoff')
        if cutoff and (not re.fullmatch(r'\d{4}-\d{2}-\d{2}',e['date']) or e['date']>cutoff):
            raise ValueError('A Past Me case cannot contain future or undated evidence')
    if not case.get('expected_facts') or not isinstance(case['expected_facts'],list):
        raise ValueError('Record the expected facts before running the model')
    return case


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--run',action='store_true')
    p.add_argument('--case',action='append',default=[])
    p.add_argument('--workers',type=int,choices=(1,2),default=2)
    args=p.parse_args()
    manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
    cases=[validate_case(c) for c in manifest['cases']]
    if len({c['id'] for c in cases})!=len(cases):raise ValueError('Duplicate case IDs')
    if args.case:cases=[c for c in cases if c['id'] in args.case]
    if not cases:raise ValueError('No cases selected')
    require_private_path(args.manifest)
    require_private_path(args.output)
    args.output.mkdir(parents=True,exist_ok=True)
    if not args.run:
        print(json.dumps({'prepared':len(cases),'evidence_characters':sum(len(e['excerpt']) for c in cases for e in c['evidence']),
                          'network_requests':0},ensure_ascii=False));return 0
    if manifest.get('remote_excerpt_authorized') is not True:
        raise ValueError('Real diary excerpts require explicit user authorization recorded in the private manifest')
    with tempfile.TemporaryDirectory(prefix='quality-runtime-',dir=args.output) as temp:
        root=Path(temp);pc=initialize(root)
        pc.set_settings({'ai.mode':'codex','ai.provider':'codex','ai.enabled':True,'ai.allow_remote':True,'ai.cache':False},root)
        from backend import server,ai_providers
        status=ai_providers.availability()
        if not status['available']:
            print(json.dumps({'status':'unavailable','reason':status['reason']},ensure_ascii=False));return 1
        results=[]
        def execute(case):
            started=time.perf_counter()
            result=server.call_llm(case['question'],case['evidence'],feature='Past Me' if case.get('cutoff') else 'Ask My Life') or {}
            text=result.get('text','');valid={e['evidence_id'] for e in case['evidence']}
            cited=set(re.findall(r'\[(E\d+)\]',text))
            private={'id':case['id'],'question':case['question'],'answer':text,'error':result.get('error',''),
                     'provider':result.get('provider'), 'model':result.get('model'),
                     'seconds':round(time.perf_counter()-started,2),
                     'citation_ids_valid':bool(cited) and cited<=valid,'invalid_citations':sorted(cited-valid),
                     'answer_present':bool(text.strip())}
            (args.output/(case['id']+'.json')).write_text(json.dumps(private,ensure_ascii=False,indent=2),encoding='utf-8')
            return private
        try:
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures=[pool.submit(execute,case) for case in cases]
                for future in as_completed(futures):
                    result=future.result()
                    safe={k:result[k] for k in ('id','seconds','answer_present','citation_ids_valid','invalid_citations')}
                    results.append(safe)
                    report={'status':'awaiting_source_review','transport':'real Codex, explicitly selected private excerpts',
                            'results':sorted(results,key=lambda r:r['id']),'completed':len(results),'requested':len(cases)}
                    (args.output/'transport-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                    print(json.dumps(safe,ensure_ascii=False),flush=True)
        finally:
            server.REFRESH_WORKER.stop()
    return 0 if all(r['answer_present'] for r in results) else 1


if __name__=='__main__':raise SystemExit(main())

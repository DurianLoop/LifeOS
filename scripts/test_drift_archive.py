"""Verify bottles on an isolated diary corpus; print only counts and hashes."""
from pathlib import Path
import argparse,contextlib,hashlib,io,json,shutil,sqlite3,sys,tempfile,time
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def digest(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'vault').rglob('*.md')}


def run(workspace,corpus,video):
    from scripts.test_ai_workflows import initialize
    initialize(workspace,corpus)
    if (corpus/'.lifeos/attachments').exists():shutil.copytree(corpus/'.lifeos/attachments',workspace/'.lifeos/attachments',dirs_exist_ok=True)
    from engine import drift_bottles as b,product_core as pc,durable_io
    before=digest(corpus);baseline=digest(workspace);checks=[]
    def check(label,condition):
        if not condition:raise AssertionError(label)
        checks.append(label)
    original=next((workspace/'vault').rglob('*.md')).read_text(encoding='utf-8')
    future=time.time()+100
    text=b.save_draft(workspace,{'body':original[:600]+'\ndrift-private-unindexed-marker','unlock_at':future,'title':'archive test'})
    wav=b'RIFF'+(40).to_bytes(4,'little')+b'WAVEfmt '+(16).to_bytes(4,'little')+bytes.fromhex('01000100401f0000803e000002001000')+b'data'+(4).to_bytes(4,'little')+b'\0'*4
    audio=b.save_draft(workspace,{'kind':'audio','unlock_at':future});audio=b.upload(workspace,audio['id'],wav,'audio/wav')
    film=b.save_draft(workspace,{'kind':'video','unlock_at':future});film=b.upload(workspace,film['id'],video.read_bytes(),'video/webm')
    for d in (text,audio,film):b.seal(workspace,d['id'],d['revision'])
    check('all modalities seal on diary corpus',len(b.list_bottles(workspace)['items'])==3)
    check('sealed corpus excerpt excluded from list response','body' not in json.dumps(b.list_bottles(workspace)))
    from engine import rebuild_memory_engine
    with contextlib.redirect_stdout(io.StringIO()):rebuild_memory_engine.main()
    con=sqlite3.connect(workspace/'data/lifeos.db')
    try:
        count=con.execute('SELECT COUNT(*) FROM memories').fetchone()[0]
        check('future letter never enters diary retrieval',con.execute("SELECT COUNT(*) FROM sections WHERE content LIKE '%drift-private-unindexed-marker%'").fetchone()[0]==0)
    finally:con.close()
    check('rebuilding index preserves every bottle',len(b.list_bottles(workspace)['items'])==3)
    check('all diary files preserved during sealing and rebuild',digest(workspace)==baseline and count==len(baseline))
    pc.set_settings({'backup.auto_before_restore':False},workspace);backup=pc.create_backup('drift archive acceptance',workspace)
    for d in (text,audio,film):b.delete(workspace,d['id'])
    pc.save_entry(journal_date='2099-01-01',sections={'日记':'post backup fixture'},root=workspace)
    pc.restore_backup(backup['backup_id'],workspace,defer=True);durable_io.recover_restore(workspace)
    check('backup restores exact diary corpus',digest(workspace)==baseline)
    check('backup restores sealed bottles and media',len(b.list_bottles(workspace)['items'])==3)
    with patch.object(b,'now',return_value=future):
        check('missed arrivals caught after reopening',len(b.arrivals(workspace)['items'])==3)
        for d in (text,audio,film):b.detail(workspace,d['id'],open_bottle=True)
        check('letter opens with original selected excerpt',b.detail(workspace,text['id'])['body'].startswith(original[:600]))
        check('video retains recorded bytes',b.media(workspace,film['id'])[0].read_bytes()==video.read_bytes())
        check('audio retains exact bytes',b.media(workspace,audio['id'])[0].read_bytes()==wav)
        check('opened bottles stop reminding',b.arrivals(workspace)['items']==[])
    check('source private corpus remains unchanged',digest(corpus)==before)
    return {'ok':True,'diaries':len(baseline),'passed':len(checks),'checks':checks,'original_corpus_unchanged':True,'remote_calls':0}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--corpus-workspace',type=Path,required=True);parser.add_argument('--video-fixture',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='drift-archive-',dir=args.output) as directory:result=run(Path(directory),args.corpus_workspace,args.video_fixture)
    (args.output/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='checks'}))

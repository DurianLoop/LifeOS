#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
import sqlite3, json, os, re, math, datetime, threading, webbrowser, urllib.request, urllib.error, random, sys, base64, mimetypes, time, shutil, tempfile
try:
    from PIL import Image
except ImportError:
    Image=None

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
sys.path.insert(0,str(ROOT)) if str(ROOT) not in sys.path else None
from engine import product_core as product
from engine.incremental_index import reindex_paths, run_one_pending_refresh
from engine.refresh_worker import start_refresh_worker
from engine import import_pipeline
from engine import sync_engine
from engine import p2_core, p2_sync, crypto_vault
from connectors import CONNECTORS
from backend import ai_providers
from backend.secret_store import set_secret, delete_secret
APP=ROOT/'app'
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))

# Pet packages are intentionally downloaded only from the upstream gallery on an
# explicit user action.  The archive and journal text are never part of this
# flow; only publicly listed sprite packages are handled here.
PET_CATALOG_URL='https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json'
PET_RAW_ROOT='https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets'
PET_ASSET_ROOT=APP/'assets'/'pets'
PET_PREVIEW_ROOT=APP/'assets'/'pet-readme-previews'
PET_CATALOG_SNAPSHOT=ROOT/'config'/'pet_catalog_cache.json'
PET_CATALOG_CACHE={'at':0.0,'items':[]}
PET_FRAME_CACHE={}
PET_SLUG=re.compile(r'^[a-z0-9][a-z0-9-]{1,110}$')

def pet_license_allowed(license_text):
    text=str(license_text or '').lower()
    return 'mit license' in text or 'cc by-nc' in text or 'non-commercial' in text or 'noncommercial' in text

def pet_frame_map(sprite,version=1):
    """Return populated frame columns by animation row; never animate transparent slots."""
    rows=11 if int(version or 1)==2 else 9
    fallback=[list(range(8)) for _ in range(rows)]
    try:
        stamp=(str(sprite),sprite.stat().st_mtime_ns,sprite.stat().st_size,rows)
        if stamp in PET_FRAME_CACHE: return PET_FRAME_CACHE[stamp]
        if Image is None: return fallback
        with Image.open(sprite) as source:
            image=source.convert('RGBA')
        cell_w,cell_h=image.width//8,image.height//rows
        if cell_w<1 or cell_h<1: return fallback
        result=[]
        alpha=image.getchannel('A')
        for row in range(rows):
            cells=[]
            for column in range(8):
                box=(column*cell_w,row*cell_h,(column+1)*cell_w,(row+1)*cell_h)
                if alpha.crop(box).getbbox(): cells.append(column)
            result.append(cells or [0])
        PET_FRAME_CACHE.clear();PET_FRAME_CACHE[stamp]=result
        return result
    except Exception:
        return fallback

def pet_fetch_bytes(url,limit=30_000_000):
    request=urllib.request.Request(url,headers={'User-Agent':'LifeOS-local-pet-gallery/0.1','Accept':'application/json,image/webp,image/png,*/*;q=0.8'})
    with urllib.request.urlopen(request,timeout=20) as response:
        raw=response.read(limit+1)
    if len(raw)>limit: raise ValueError('pet package exceeds 30 MB limit')
    return raw

def pet_catalog(force=False):
    now=time.monotonic()
    if not force and PET_CATALOG_CACHE['items'] and now-PET_CATALOG_CACHE['at']<900:
        return PET_CATALOG_CACHE['items']
    try:
        raw=json.loads(pet_fetch_bytes(PET_CATALOG_URL,2_000_000).decode('utf-8'))
        PET_CATALOG_SNAPSHOT.write_text(json.dumps(raw,ensure_ascii=False),encoding='utf-8')
    except Exception:
        if PET_CATALOG_SNAPSHOT.exists(): raw=json.loads(PET_CATALOG_SNAPSHOT.read_text(encoding='utf-8'))
        else:
            # The local shelf stays usable even before its first gallery refresh.
            raw=[{'slug':x['slug'],'name':x['name'],'author':x['author'],'license':x['license'],'description':x['description'],'spriteVersionNumber':x['spriteVersionNumber'],'primary_category':'Installed'} for x in pet_local_items()]
    items=[]
    for item in raw if isinstance(raw,list) else []:
        slug=str(item.get('slug') or '')
        if not PET_SLUG.fullmatch(slug) or not pet_license_allowed(item.get('license')): continue
        record={key:item.get(key) for key in ('slug','name','localized_names','author','author_handle','author_url','primary_category','collections','license','description','spriteVersionNumber')}
        preview=PET_PREVIEW_ROOT/slug/'idle.webp'
        record['preview_url']=f'/assets/pet-readme-previews/{quote(slug)}/idle.webp' if preview.exists() else ''
        items.append(record)
    PET_CATALOG_CACHE.update({'at':now,'items':items})
    return items

def pet_local_items():
    PET_ASSET_ROOT.mkdir(parents=True,exist_ok=True)
    found=[]
    for folder in PET_ASSET_ROOT.iterdir():
        if not folder.is_dir(): continue
        meta_path=folder/'pet.json'; sprite=folder/'spritesheet.webp'
        if not meta_path.exists() or not sprite.exists(): continue
        try: meta=json.loads(meta_path.read_text(encoding='utf-8'))
        except Exception: continue
        submission={}
        try: submission=json.loads((folder/'submission.json').read_text(encoding='utf-8'))
        except Exception: pass
        slug=str(submission.get('slug') or meta.get('id') or folder.name)
        version=int(meta.get('spriteVersionNumber') or 1)
        found.append({'slug':slug,'folder':folder.name,'name':meta.get('displayName') or submission.get('name') or slug,'author':submission.get('author') or 'community contributor','license':submission.get('license') or 'See package attribution','description':meta.get('description') or submission.get('description') or '', 'spriteVersionNumber':version,'frame_map':pet_frame_map(sprite,version),'asset_url':f'/assets/pets/{quote(folder.name)}/spritesheet.webp','builtin':folder.name=='desk-otter'})
    return found

def pet_status(force=False):
    installed=pet_local_items(); active=product.get_setting('pet.active_slug','desk-otter--zihualiu1997',ROOT)
    if not any(p['slug']==active for p in installed): active=installed[0]['slug'] if installed else ''
    return {'catalog':pet_catalog(force),'installed':installed,'active_slug':active,'content_access':False,'source':'awesome-codex-pet'}

def install_pet(slug):
    slug=str(slug or '')
    if not PET_SLUG.fullmatch(slug): raise ValueError('invalid pet slug')
    catalog_item=next((item for item in pet_catalog() if item['slug']==slug),None)
    if not catalog_item: raise ValueError('pet is not in the permitted personal-use gallery')
    if any(item['slug']==slug for item in pet_local_items()):
        product.set_settings({'pet.active_slug':slug},ROOT); return {'slug':slug,'installed':False,'active':True}
    target=PET_ASSET_ROOT/slug
    PET_ASSET_ROOT.mkdir(parents=True,exist_ok=True)
    work=Path(tempfile.mkdtemp(prefix=f'.pet-{slug}-',dir=str(PET_ASSET_ROOT)))
    try:
        base=f'{PET_RAW_ROOT}/{slug}'
        meta_raw=pet_fetch_bytes(base+'/pet.json',200_000)
        meta=json.loads(meta_raw.decode('utf-8'))
        if not isinstance(meta,dict): raise ValueError('invalid pet manifest')
        sprite_raw=pet_fetch_bytes(base+'/spritesheet.webp')
        submission_raw=b''
        try: submission_raw=pet_fetch_bytes(base+'/submission.json',400_000)
        except urllib.error.HTTPError: pass
        (work/'pet.json').write_bytes(meta_raw)
        (work/'spritesheet.webp').write_bytes(sprite_raw)
        if submission_raw: (work/'submission.json').write_bytes(submission_raw)
        attribution=(f"# {catalog_item.get('name') or slug} attribution\n\n"
                     f"- Source: https://github.com/legeling/awesome-codex-pet/tree/main/pets/{slug}\n"
                     f"- Author: {catalog_item.get('author') or 'community contributor'}\n"
                     f"- License: {catalog_item.get('license') or 'see upstream'}\n"
                     "- Installed locally by LifeOS at the user's request. This pet cannot read journal content.\n")
        (work/'LICENSE.md').write_text(attribution,encoding='utf-8')
        os.replace(work,target)
        product.set_settings({'pet.active_slug':slug},ROOT)
        return {'slug':slug,'installed':True,'active':True}
    except Exception:
        shutil.rmtree(work,ignore_errors=True)
        raise

def uninstall_pet(slug):
    slug=str(slug or '')
    item=next((item for item in pet_local_items() if item['slug']==slug),None)
    if not item: raise ValueError('pet is not installed')
    if item['builtin']: raise ValueError('the bundled Desk Otter cannot be removed')
    target=PET_ASSET_ROOT/item['folder']
    if target.parent.resolve()!=PET_ASSET_ROOT.resolve(): raise ValueError('invalid pet location')
    shutil.rmtree(target)
    remaining=pet_local_items(); active=product.get_setting('pet.active_slug','',ROOT)
    if active==slug: product.set_settings({'pet.active_slug':remaining[0]['slug'] if remaining else ''},ROOT)
    return {'slug':slug,'removed':True}

def load_dotenv():
    p=ROOT/'.env'
    if not p.exists(): return
    for line in p.read_text(encoding='utf-8').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1)
        os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))

load_dotenv()
# Product metadata is durable and independent from the disposable derived DB.
product.seed_feature_dependencies(root=ROOT)
PRODUCT_BOOTSTRAP=product.bootstrap_existing(ROOT)
P2_BOOTSTRAP=p2_core.migrate(ROOT)
REFRESH_WORKER=start_refresh_worker(ROOT)
HOST=os.getenv('LIFEOS_HOST','127.0.0.1')
PORT=int(os.getenv('LIFEOS_PORT','8787'))

def db():
    con=sqlite3.connect(DB)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def jrow(r): return dict(r) if r is not None else None
def rows(rs): return [dict(r) for r in rs]

REVIEW_SCOPES={'projects','chapters','skills','people'}

def get_review_map(con,scope):
    if scope not in REVIEW_SCOPES: return {}
    r=con.execute("SELECT value FROM app_settings WHERE key=?",(f'review.{scope}',)).fetchone()
    if not r: return {}
    try:
        v=json.loads(r[0])
        return v if isinstance(v,dict) else {}
    except Exception:
        return {}

def save_review_map(con,scope,value):
    con.execute("""INSERT INTO app_settings(key,value) VALUES(?,?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (f'review.{scope}',json.dumps(value,ensure_ascii=False)))

def evidence_health(ret):
    """A restraint signal, not a probability or truth score."""
    ev=ret.get('evidence') or []; cov=ret.get('coverage') or {}; intent=ret.get('query_intent','general')
    n=len(ev); strong=int(cov.get('strong_count') or 0); dates=int(cov.get('unique_dates') or 0); raw=float(cov.get('daily_raw_ratio') or 0)
    reasons=[]
    if n<2: reasons.append('fewer than 2 retrieved source passages')
    if strong<1: reasons.append('no strong lexical/source match')
    if intent in ('change','recurring') and dates<3: reasons.append(f'{intent} questions need broader date coverage')
    if raw<0.6 and n: reasons.append('less than 60% of the pack is daily raw source')
    if not ev: status='insufficient'
    elif reasons and (n<3 or strong<1): status='thin'
    elif reasons: status='limited'
    else: status='adequate'
    return {'status':status,'reasons':reasons,'note':'Evidence health is a restraint heuristic. It is not answer confidence, truth probability, or semantic entailment.'}

def filter_selected_evidence(ret,selected_keys):
    if not selected_keys: return ret
    keys=set(str(x) for x in selected_keys)
    kept=[]
    for e in ret.get('evidence') or []:
        key=f"{e.get('source_path','')}||{e.get('section','')}"
        if key in keys: kept.append(dict(e))
    for i,e in enumerate(kept,1): e['evidence_id']=f'E{i}';e['rank']=i
    dates=sorted({e['date'] for e in kept if re.fullmatch(r'20\d{2}-\d{2}-\d{2}',e.get('date') or '')})
    span=(datetime.date.fromisoformat(dates[-1])-datetime.date.fromisoformat(dates[0])).days if len(dates)>=2 else 0
    ret=dict(ret);ret['evidence']=kept;ret['count']=len(kept);ret['coverage']={
        'unique_dates':len({e.get('date') for e in kept if e.get('date')}),
        'strong_count':sum(1 for e in kept if e.get('confidence')=='strong'),
        'daily_raw_ratio':round(sum(1 for e in kept if e.get('provenance_type')=='daily_raw')/max(1,len(kept)),3),
        'date_span_days':span}
    ret['retrieval_note']=(ret.get('retrieval_note') or '')+' · manually selected evidence subset'
    return ret

def sections_for(con,mid):
    out={}
    for r in con.execute("SELECT normalized_name,content FROM sections WHERE memory_id=? ORDER BY ordinal",(mid,)):
        n=r['normalized_name']; c=r['content']
        if n in out and c: out[n]=(out[n]+'\n\n'+c).strip()
        else: out[n]=c
    return out

def memory_label(r):
    return r['date'] if r['date'] else f"{r['year']}_W{int(r['week']):02d}"

def snippet(text,terms,maxlen=320):
    if not text: return ''
    low=text.lower()
    pos=-1
    for t in terms:
        p=low.find(t.lower())
        if p>=0 and (pos<0 or p<pos): pos=p
    if pos<0: return text[:maxlen].replace('\n',' ')
    start=max(0,pos-maxlen//3); end=min(len(text),start+maxlen)
    s=text[start:end].replace('\n',' ')
    return ('…' if start else '')+s+('…' if end<len(text) else '')

def parse_period(period):
    # returns start,end strings or None
    if not period: return None,None
    if re.fullmatch(r'\d{4}',period):
        return period+'-01-01', period+'-12-31'
    if re.fullmatch(r'\d{4}-\d{2}',period):
        y,m=map(int,period.split('-'))
        if m==12: nxt=f"{y+1}-01-01"
        else: nxt=f"{y}-{m+1:02d}-01"
        start=period+'-01'
        end=(datetime.date.fromisoformat(nxt)-datetime.timedelta(days=1)).isoformat()
        return start,end
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',period):
        return period,period
    return None,None

def query_terms(q):
    """Return conservative lexical anchors.

    Product/reflection questions often contain long Chinese framing phrases
    ("什么时候开始真正…", "我对…的看法怎么变化"). Earlier n-gram logic
    accidentally indexed fragments of those frames. Refinement 10.2 keeps
    question grammar first, while still expanding explicit configured concepts.
    """
    q=q.strip(); qlow=q.lower(); direct=[]; expanded=[]
    for topic,tlist in CFG['topics'].items():
        if topic.lower() in qlow or any(t.lower() in qlow for t in tlist):
            direct += [t for t in tlist if t.lower() in qlow]
            expanded += [t for t in tlist if t.lower() not in qlow]
    for sk in CFG['skills']:
        if sk['name'].lower() in qlow or any(t.lower() in qlow for t in sk['terms']):
            direct += [t for t in sk['terms'] if t.lower() in qlow]
            expanded += [t for t in sk['terms'] if t.lower() not in qlow]
    for t in CFG['places']+CFG['roles']+CFG['word_terms']:
        if t.lower() in qlow: direct.append(t)
    direct += re.findall(r'[A-Za-z][A-Za-z0-9+.#_-]{1,}',q)

    clean=q
    frames=['什么时候开始真正','什么时候开始','何时开始','什么时候','为什么','怎么变化','如何变化','怎么变','如何变','过去一年','最近一年','近一年','过去半年','最近半年','近半年','反复问自己','反复问','我对','我的','自己','问题是什么','问题','看法','观点','真正','开始','变化','改变','演变','哪些','什么','怎么','如何','时候','过去','现在','后来','是否','这个','那个','一下','反复','经常','重复','总是']
    for x in sorted(frames,key=len,reverse=True): clean=clean.replace(x,' ')
    # split common Chinese grammar instead of generating grams across it
    clean=re.sub(r'[的是了在对和与把从到中里上下一些一个我你他她它]+',' ',clean)
    chunks=re.findall(r'[\u4e00-\u9fff]{2,}',clean)
    for ch in chunks:
        direct.append(ch)
        if len(ch)>=4:
            for n in (4,3,2):
                for i in range(len(ch)-n+1): direct.append(ch[i:i+n])
    seen=set(); out=[]
    # direct anchors first; expansions are deliberately capped
    for t in direct+expanded[:16]:
        k=t.lower().strip()
        if len(k)<2 or k in seen: continue
        seen.add(k);out.append(t)
    return out[:40]

def retrieve(con,q,limit=12,cutoff=None):
    """Source-first local retrieval.

    Refinement 10.2 keeps the same API/function, but improves date diversity,
    change/earliest intent handling, rank explanations and evidence coverage.
    It intentionally scans the small local section corpus rather than relying
    on Chinese FTS tokenization alone.
    """
    terms=query_terms(q)
    date_match=re.search(r'(20\d{2})(?:[年\-/\.](\d{1,2}))?',q)
    start=end=None
    if date_match:
        y=int(date_match.group(1)); m=date_match.group(2)
        if m: start,end=parse_period(f"{y}-{int(m):02d}")
        else: start,end=parse_period(str(y))
    if cutoff: end=min(end,cutoff) if end else cutoff
    latest_row=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()
    latest_date=latest_row[0] if latest_row else None
    if latest_date and not date_match:
        days=None
        if any(x in q for x in ['过去一年','最近一年','近一年']): days=365
        elif any(x in q for x in ['过去半年','最近半年','近半年']): days=183
        if days:
            end=end or latest_date
            start=(datetime.date.fromisoformat(end)-datetime.timedelta(days=days)).isoformat()
    if any(x in q for x in ['第一次','最早','什么时候开始','何时开始']): intent='earliest'
    elif any(x in q for x in ['变化','改变','演变','怎么变','如何变','前后']): intent='change'
    elif any(x in q for x in ['反复','经常','重复','总是','多次']): intent='recurring'
    else: intent='general'
    sec_pref=[]
    if any(x in q for x in ['观点','看法','价值观','认为','改变','变化','为什么','自我','意义']): sec_pref=['自我探索','体系构建']
    elif any(x in q for x in ['想法','计划','项目','做什么']): sec_pref=['日记','体系构建']
    elif any(x in q for x in ['日程','做了什么','发生']): sec_pref=['日程','日记']
    sql="""SELECT s.id section_id,s.memory_id,s.normalized_name,s.content,m.date,m.year,m.week,m.source_path,m.provenance_type
           FROM sections s JOIN memories m ON m.id=s.memory_id WHERE length(trim(s.content))>0"""
    params=[]
    if start: sql+=" AND (m.date IS NULL OR m.date>=?)"; params.append(start)
    if end: sql+=" AND (m.date IS NULL OR m.date<=?)"; params.append(end)
    candidates=con.execute(sql,params).fetchall(); scored=[]; qlow=q.lower()
    recurring_section_ids=set()
    if intent=='recurring' and not terms:
        qsql="SELECT DISTINCT section_id FROM question_candidates WHERE section_id IS NOT NULL"; qp=[]
        if start: qsql+=" AND date>=?"; qp.append(start)
        if end: qsql+=" AND date<=?"; qp.append(end)
        recurring_section_ids={r[0] for r in con.execute(qsql,qp)}
    for r in candidates:
        text=r['content']; low=text.lower(); score=0.0; hits=[]; reasons=[]
        if qlow and qlow in low:
            score+=22; hits.append(q); reasons.append('exact query phrase')
        if r['section_id'] in recurring_section_ids:
            score+=8; hits.append('explicit question candidate'); reasons.append('explicit question candidate')
        for t in terms:
            c=low.count(t.lower())
            if c:
                weight=1.1+min(len(t),10)/3.6
                if t.lower() in qlow: weight*=2.25
                score += min(c,5)*weight
                hits.append(t)
        if not hits:
            continue
        reasons.append(f"{len(set(hits))} matched anchor(s)")
        if r['normalized_name'] in sec_pref: score+=4.5; reasons.append('preferred section')
        if r['provenance_type']=='daily_raw': score+=4.0; reasons.append('daily raw source')
        else: score-=2.0
        if r['normalized_name']=='本周复盘': score-=1.5
        if score<=0: continue
        score += 1/(1+len(text)/1100)
        scored.append((score,r,list(dict.fromkeys(hits)),reasons))
    scored.sort(key=lambda x:(-x[0], x[1]['date'] or '9999'))
    if not scored:
        return {'query':q,'terms':terms,'evidence':[],'count':0,'query_intent':intent,
                'coverage':{'unique_dates':0,'strong_count':0,'daily_raw_ratio':0,'date_span_days':0},
                'retrieval_note':'No matching source evidence found. LifeOS will not fill the gap.'}

    # Build a relevance pool, then deliberately diversify dates/sources.
    pool=scored[:max(limit*8,80)]
    chosen=[]; used_sections=set(); per_source={}
    def take(x):
        sid=x[1]['section_id']; sp=x[1]['source_path']
        if sid in used_sections or per_source.get(sp,0)>=2: return False
        used_sections.add(sid);per_source[sp]=per_source.get(sp,0)+1;chosen.append(x);return True
    strong_threshold=max(3.0,scored[0][0]*0.25)
    strong=[x for x in scored if x[0]>=strong_threshold and x[1]['date']]
    if intent=='earliest':
        for x in sorted(strong,key=lambda x:x[1]['date'])[:max(3,limit//3)]: take(x)
    elif intent=='change' and strong:
        chrono=sorted(strong,key=lambda x:x[1]['date'])
        # force evidence from across the full span rather than only the latest/highest score
        for idx in sorted(set([0,len(chrono)//4,len(chrono)//2,(len(chrono)*3)//4,len(chrono)-1])):
            if 0<=idx<len(chrono): take(chrono[idx])
    elif intent=='recurring':
        # recurrence questions benefit from chronological spread across matching dates
        chrono=sorted(strong,key=lambda x:x[1]['date'])
        step=max(1,len(chrono)//max(1,min(limit,6)))
        for x in chrono[::step][:6]: take(x)
    for x in pool:
        if len(chosen)>=limit: break
        take(x)
    chosen=chosen[:limit]

    maxscore=scored[0][0] or 1.0; evidence=[]
    for i,(score,r,hits,reasons) in enumerate(chosen,1):
        rel=score/maxscore
        confidence='strong' if rel>=0.58 and len(hits)>=1 and r['provenance_type']=='daily_raw' else ('matched' if rel>=0.28 else 'weak')
        evidence.append({'evidence_id':f'E{i}','rank':i,'score':round(score,2),'confidence':confidence,
          'date':r['date'] or f"{r['year']}_W{int(r['week']):02d}",'section':r['normalized_name'],
          'source_path':r['source_path'],'provenance_type':r['provenance_type'],
          'excerpt':snippet(r['content'],hits or terms),'matched_terms':hits[:12],
          'rank_reason':'; '.join(reasons[:4])})
    dates=sorted({e['date'] for e in evidence if re.fullmatch(r'20\d{2}-\d{2}-\d{2}',e['date'])})
    span=0
    if len(dates)>=2:
        span=(datetime.date.fromisoformat(dates[-1])-datetime.date.fromisoformat(dates[0])).days
    coverage={'unique_dates':len({e['date'] for e in evidence}),
              'strong_count':sum(1 for e in evidence if e['confidence']=='strong'),
              'daily_raw_ratio':round(sum(1 for e in evidence if e['provenance_type']=='daily_raw')/max(1,len(evidence)),3),
              'date_span_days':span}
    return {'query':q,'terms':terms,'evidence':evidence,'count':len(evidence),'query_intent':intent,
            'coverage':coverage,'retrieval_note':f"{intent} intent · diversified by source/date · raw Markdown preferred"}

def skill_summary(con,period=None):
    start,end=parse_period(period) if period else (None,None)
    cond="m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL"
    params=[]
    if start: cond+=" AND m.date>=?"; params.append(start)
    if end: cond+=" AND m.date<=?"; params.append(end)
    rs=con.execute(f"""SELECT sd.name,sd.category,sd.parent_name,sd.description,
                      COUNT(DISTINCT CASE WHEN {cond} THEN m.id END) evidence_days,
                      COALESCE(SUM(CASE WHEN {cond} THEN sa.mention_count ELSE 0 END),0) mentions,
                      MIN(CASE WHEN {cond} THEN m.date END) first_seen,
                      MAX(CASE WHEN {cond} THEN m.date END) last_seen
                      FROM skill_definitions sd
                      LEFT JOIN skill_activity sa ON sa.skill_id=sd.id
                      LEFT JOIN memories m ON m.id=sa.memory_id
                      GROUP BY sd.id ORDER BY evidence_days DESC,mentions DESC""",params*4).fetchall()
    maxraw=max([r['evidence_days']*4+r['mentions'] for r in rs] or [1])
    out=[]
    for r in rs:
        raw=r['evidence_days']*4+r['mentions']
        level=1 if raw<=0 else round(1+9*math.log1p(raw)/math.log1p(maxraw),1)
        d=dict(r); d['activity_score']=raw; d['level']=level; out.append(d)
    return out

def aggregate_topics(con,period=None):
    start,end=parse_period(period) if period else (None,None)
    params=[]; cond="m.kind='daily'"
    if start: cond+=" AND m.date>=?"; params.append(start)
    if end: cond+=" AND m.date<=?"; params.append(end)
    return rows(con.execute(f"""SELECT tm.topic,COUNT(DISTINCT tm.memory_id) days,SUM(tm.mention_count) mentions,
                         MIN(m.date) first_seen,MAX(m.date) last_seen
                         FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id
                         WHERE {cond} GROUP BY tm.topic ORDER BY days DESC,mentions DESC""",params))

def overview(con,year=None):
    cond="WHERE kind='daily'"; params=[]
    if year:
        cond+=" AND year=?"; params.append(int(year))
    b=con.execute(f"""SELECT COUNT(*) entries,MIN(date) first_date,MAX(CASE WHEN date_anomaly=0 THEN date END) last_date,
                      SUM(bytes) bytes FROM memories {cond}""",params).fetchone()
    mids=[r[0] for r in con.execute(f"SELECT id FROM memories {cond}",params)]
    if mids:
        qs=','.join('?'*len(mids))
        metrics=con.execute(f"SELECT COALESCE(SUM(char_count),0) chars,COALESCE(SUM(schedule_items),0) schedules FROM memory_metrics WHERE memory_id IN ({qs})",mids).fetchone()
    else: metrics={'chars':0,'schedules':0}
    def cc(table):
        if year: return con.execute(f"SELECT COUNT(*) FROM {table} WHERE date LIKE ?",(str(year)+'%',)).fetchone()[0]
        return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return {**dict(b),'char_count':metrics['chars'],'schedule_items':metrics['schedules'],
            'ideas':cc('idea_candidates'),'questions':cc('question_candidates'),'beliefs':cc('belief_candidates'),
            'events':cc('event_candidates'),'achievements':cc('achievement_candidates'),'decisions':cc('decision_candidates')}

def table_candidates(con,table,limit=80,year=None):
    wh=[]; p=[]
    if year: wh.append("c.date LIKE ?"); p.append(str(year)+'%')
    where="WHERE "+' AND '.join(wh) if wh else ''
    return rows(con.execute(f"""SELECT c.*,m.source_path,s.normalized_name section
                               FROM {table} c JOIN memories m ON m.id=c.memory_id
                               LEFT JOIN sections s ON s.id=c.section_id {where}
                               ORDER BY COALESCE(c.date,printf('%04d-W%02d',m.year,m.week)) DESC,c.id DESC LIMIT ?""",p+[limit]))



def date_where(period, alias='m'):
    """Return a conservative daily-date SQL condition for UI refinements.

    This is a serving helper only; it does not change the Memory Engine schema.
    """
    start,end=parse_period(period) if period else (None,None)
    wh=[f"{alias}.kind='daily'",f"{alias}.date_anomaly=0",f"{alias}.date IS NOT NULL"]
    params=[]
    if start: wh.append(f"{alias}.date>=?"); params.append(start)
    if end: wh.append(f"{alias}.date<=?"); params.append(end)
    return ' AND '.join(wh),params

def journal_context(con,memory_id,kind='daily',date=None,year=None,week=None):
    """Derived context around one immutable source page.

    Everything returned here is rebuildable and source-linked. The helper never
    writes into the raw journal.
    """
    if kind=='daily' and date:
        prev=jrow(con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND date<? ORDER BY date DESC LIMIT 1",(date,)).fetchone())
        nxt=jrow(con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND date>? AND date_anomaly=0 ORDER BY date LIMIT 1",(date,)).fetchone())
    else:
        key=(int(year or 0)*100+int(week or 0))
        prev=jrow(con.execute("SELECT year,week,source_path FROM memories WHERE kind='weekly' AND (year*100+week)<? ORDER BY year DESC,week DESC LIMIT 1",(key,)).fetchone())
        nxt=jrow(con.execute("SELECT year,week,source_path FROM memories WHERE kind='weekly' AND (year*100+week)>? ORDER BY year,week LIMIT 1",(key,)).fetchone())
        for x in (prev,nxt):
            if x: x['date']=f"{x['year']}_W{int(x['week']):02d}"
    roles=rows(con.execute("SELECT role label,mention_count FROM role_mentions WHERE memory_id=? ORDER BY mention_count DESC,role",(memory_id,)))
    people=rows(con.execute("SELECT person label,mention_count FROM person_mentions WHERE memory_id=? ORDER BY mention_count DESC,person",(memory_id,)))
    places=rows(con.execute("SELECT place label,mention_count FROM place_mentions WHERE memory_id=? ORDER BY mention_count DESC,place",(memory_id,)))
    signals=[]
    for table,label in [('idea_candidates','idea'),('question_candidates','question'),('belief_candidates','belief'),('decision_candidates','decision'),('achievement_candidates','milestone'),('project_candidates','project')]:
        for r in con.execute(f"SELECT date,text,trigger FROM {table} WHERE memory_id=? ORDER BY id LIMIT 8",(memory_id,)):
            signals.append({'kind':label,'date':r['date'],'text':r['text'],'trigger':r['trigger']})
    artifacts=rows(con.execute("SELECT artifact_type,action,text,confidence FROM artifact_ledger WHERE memory_id=? ORDER BY id",(memory_id,)))
    events=rows(con.execute("SELECT date,text,event_type,source_type FROM event_candidates WHERE memory_id=? ORDER BY id",(memory_id,)))
    return {'previous':prev,'next':nxt,'roles':roles,'people':people,'places':places,'signals':signals[:24],'artifacts':artifacts,'events':events}

def people_context(con,kind,name):
    table,col=('person_mentions','person') if kind=='person' else ('role_mentions','role')
    mids=[r[0] for r in con.execute(f"SELECT memory_id FROM {table} WHERE {col}=?",(name,))]
    if not mids: return None
    ph=','.join('?'*len(mids))
    topics=rows(con.execute(f"SELECT topic,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions FROM topic_mentions WHERE memory_id IN ({ph}) GROUP BY topic ORDER BY days DESC,mentions DESC LIMIT 10",mids))
    skills=rows(con.execute(f"SELECT sd.name,COUNT(DISTINCT sa.memory_id) days,SUM(sa.mention_count) mentions FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id IN ({ph}) GROUP BY sd.name ORDER BY days DESC,mentions DESC LIMIT 10",mids))
    places=rows(con.execute(f"SELECT place,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions FROM place_mentions WHERE memory_id IN ({ph}) GROUP BY place ORDER BY days DESC,mentions DESC LIMIT 8",mids))
    artifacts=rows(con.execute(f"SELECT artifact_type,COUNT(DISTINCT memory_id) days,COUNT(*) traces FROM artifact_ledger WHERE memory_id IN ({ph}) GROUP BY artifact_type ORDER BY days DESC,traces DESC LIMIT 8",mids))
    recent=rows(con.execute(f"SELECT m.date,m.source_path,x.mention_count FROM memories m JOIN {table} x ON x.memory_id=m.id WHERE x.{col}=? ORDER BY m.date DESC LIMIT 24",(name,)))
    first=rows(con.execute(f"SELECT m.date,m.source_path,x.mention_count FROM memories m JOIN {table} x ON x.memory_id=m.id WHERE x.{col}=? ORDER BY m.date LIMIT 4",(name,)))
    monthly=rows(con.execute(f"""SELECT substr(m.date,1,7) month,COUNT(DISTINCT m.id) days,SUM(x.mention_count) mentions
                                FROM memories m JOIN {table} x ON x.memory_id=m.id WHERE x.{col}=? AND m.kind='daily'
                                GROUP BY substr(m.date,1,7) ORDER BY month""",(name,)))
    dates=sorted({r[0] for r in con.execute(f"SELECT m.date FROM memories m JOIN {table} x ON x.memory_id=m.id WHERE x.{col}=? AND m.kind='daily' AND m.date_anomaly=0",(name,)) if r[0]})
    def context_window(start,end):
        if not (start and end): return {'start':start,'end':end,'topics':[],'skills':[]}
        mids2=[r[0] for r in con.execute(f"SELECT m.id FROM memories m JOIN {table} x ON x.memory_id=m.id WHERE x.{col}=? AND m.date BETWEEN ? AND ?",(name,start,end))]
        if not mids2:return {'start':start,'end':end,'topics':[],'skills':[],'days':0}
        pp=','.join('?'*len(mids2))
        t=rows(con.execute(f"SELECT topic,COUNT(DISTINCT memory_id) days FROM topic_mentions WHERE memory_id IN ({pp}) GROUP BY topic ORDER BY days DESC LIMIT 6",mids2))
        k=rows(con.execute(f"SELECT sd.name,COUNT(DISTINCT sa.memory_id) days FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id IN ({pp}) GROUP BY sd.name ORDER BY days DESC LIMIT 6",mids2))
        return {'start':start,'end':end,'topics':t,'skills':k,'days':len(set(mids2))}
    early=recent_window=None
    if dates:
        d0=datetime.date.fromisoformat(dates[0]); d1=datetime.date.fromisoformat(dates[-1])
        early=context_window(dates[0],min(d1,d0+datetime.timedelta(days=90)).isoformat())
        recent_window=context_window(max(d0,d1-datetime.timedelta(days=90)).isoformat(),dates[-1])
    return {'kind':kind,'name':name,'memory_days':len(set(mids)),'topics':topics,'skills':skills,'places':places,'artifacts':artifacts,
            'recent_sources':recent,'first_sources':first,'monthly':monthly,'early_window':early,'recent_window':recent_window,
            'note':'Early/recent context windows describe co-visible archive context only. They do not prove relationship change, influence, or sentiment.'}


def place_context(con,name):
    mids=[r[0] for r in con.execute("SELECT memory_id FROM place_mentions WHERE place=?",(name,))]
    if not mids: return None
    ph=','.join('?'*len(mids))
    topics=rows(con.execute(f"SELECT topic,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions FROM topic_mentions WHERE memory_id IN ({ph}) GROUP BY topic ORDER BY days DESC,mentions DESC LIMIT 10",mids))
    skills=rows(con.execute(f"SELECT sd.name,COUNT(DISTINCT sa.memory_id) days,SUM(sa.mention_count) mentions FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id IN ({ph}) GROUP BY sd.name ORDER BY days DESC,mentions DESC LIMIT 10",mids))
    roles=rows(con.execute(f"SELECT role,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions FROM role_mentions WHERE memory_id IN ({ph}) GROUP BY role ORDER BY days DESC,mentions DESC LIMIT 8",mids))
    people=rows(con.execute(f"SELECT person,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions FROM person_mentions WHERE memory_id IN ({ph}) GROUP BY person ORDER BY days DESC,mentions DESC LIMIT 8",mids))
    artifacts=rows(con.execute(f"SELECT artifact_type,COUNT(DISTINCT memory_id) days,COUNT(*) traces FROM artifact_ledger WHERE memory_id IN ({ph}) GROUP BY artifact_type ORDER BY days DESC,traces DESC LIMIT 8",mids))
    recent=rows(con.execute("""SELECT m.date,m.source_path,p.mention_count,mm.char_count
                              FROM memories m JOIN place_mentions p ON p.memory_id=m.id
                              JOIN memory_metrics mm ON mm.memory_id=m.id
                              WHERE p.place=? ORDER BY m.date DESC LIMIT 24""",(name,)))
    first=rows(con.execute("""SELECT m.date,m.source_path,p.mention_count FROM memories m JOIN place_mentions p ON p.memory_id=m.id
                               WHERE p.place=? ORDER BY m.date LIMIT 3""",(name,)))
    return {'place':name,'memory_days':len(set(mids)),'topics':topics,'skills':skills,'roles':roles,'people':people,'artifacts':artifacts,'recent_sources':recent,'first_sources':first}

def year_review_bundle(con,year):
    y=str(year)
    first=jrow(con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND year=? ORDER BY date LIMIT 1",(int(y),)).fetchone())
    last=jrow(con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND year=? AND date_anomaly=0 ORDER BY date DESC LIMIT 1",(int(y),)).fetchone())
    months=rows(con.execute("SELECT * FROM month_stats WHERE month LIKE ? ORDER BY month",(y+'-%',)))
    if last: months=[m for m in months if m['month']<=last['date'][:7]]
    base=con.execute("""SELECT COUNT(*) entries,MIN(m.date) first_date,MAX(m.date) last_date,COALESCE(SUM(mm.char_count),0) char_count,
                               COALESCE(SUM(mm.schedule_items),0) schedule_items
                        FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                        WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date LIKE ?""",(y+'%',)).fetchone()
    def yc(table):
        return con.execute(f"SELECT COUNT(*) FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND c.date LIKE ?",(y+'%',)).fetchone()[0]
    ov={**dict(base),'ideas':yc('idea_candidates'),'questions':yc('question_candidates'),'beliefs':yc('belief_candidates'),'events':yc('event_candidates'),'achievements':yc('achievement_candidates'),'decisions':yc('decision_candidates')}
    roles=rows(con.execute("""SELECT r.role,COUNT(DISTINCT r.memory_id) days,SUM(r.mention_count) mentions FROM role_mentions r JOIN memories m ON m.id=r.memory_id
                              WHERE m.date LIKE ? GROUP BY r.role ORDER BY days DESC,mentions DESC LIMIT 8""",(y+'%',)))
    places=rows(con.execute("""SELECT p.place,COUNT(DISTINCT p.memory_id) days,SUM(p.mention_count) mentions FROM place_mentions p JOIN memories m ON m.id=p.memory_id
                               WHERE m.date LIKE ? GROUP BY p.place ORDER BY days DESC,mentions DESC LIMIT 8""",(y+'%',)))
    artifacts=rows(con.execute("""SELECT artifact_type,COUNT(DISTINCT memory_id) days,COUNT(*) traces,MIN(date) first_seen,MAX(date) last_seen
                                  FROM artifact_ledger WHERE date LIKE ? GROUP BY artifact_type ORDER BY days DESC,traces DESC LIMIT 10""",(y+'%',)))
    dense=rows(con.execute("""SELECT m.date,m.source_path,mm.char_count,mm.nonempty_sections,mm.schedule_items
                              FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                              WHERE m.kind='daily' AND m.date LIKE ? AND m.date_anomaly=0 ORDER BY mm.char_count DESC LIMIT 8""",(y+'%',)))
    available_years=[str(r[0]) for r in con.execute("SELECT DISTINCT year FROM memories WHERE kind='daily' AND date_anomaly=0 ORDER BY year DESC")]
    return {'year':y,'available_years':available_years,'overview':ov,'skills':skill_summary(con,y)[:12],'topics':aggregate_topics(con,y)[:12],
            'first':first,'last':last,'months':months,'roles':roles,'places':places,'artifacts':artifacts,'dense_sources':dense,
            'ideas':table_candidates(con,'idea_candidates',10,y),'questions':table_candidates(con,'question_candidates',10,y),
            'achievements':table_candidates(con,'achievement_candidates',12,y),
            'note':'Year in Review is assembled from dated source-linked tables. High visibility is not importance, competence, happiness, or impact.'}

def grouped_projects(con):
    groups=[]
    trs=con.execute("SELECT trigger,COUNT(*) candidates,COUNT(DISTINCT memory_id) days,MIN(date) first_seen,MAX(date) last_seen FROM project_candidates GROUP BY trigger ORDER BY days DESC,candidates DESC").fetchall()
    for tr in trs:
        trigger=tr['trigger']; mids=[r[0] for r in con.execute("SELECT DISTINCT memory_id FROM project_candidates WHERE trigger=?",(trigger,))]
        if not mids: continue
        ph=','.join('?'*len(mids))
        topics=rows(con.execute(f"SELECT topic,COUNT(DISTINCT memory_id) days FROM topic_mentions WHERE memory_id IN ({ph}) GROUP BY topic ORDER BY days DESC LIMIT 6",mids))
        skills=rows(con.execute(f"SELECT sd.name,COUNT(DISTINCT sa.memory_id) days FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id IN ({ph}) GROUP BY sd.name ORDER BY days DESC LIMIT 6",mids))
        samples=rows(con.execute("SELECT c.date,c.text,c.trigger,m.source_path FROM project_candidates c JOIN memories m ON m.id=c.memory_id WHERE c.trigger=? ORDER BY c.date DESC,c.id DESC LIMIT 18",(trigger,)))
        monthly=rows(con.execute("SELECT substr(date,1,7) month,COUNT(DISTINCT memory_id) days,COUNT(*) candidates FROM project_candidates WHERE trigger=? GROUP BY substr(date,1,7) ORDER BY month",(trigger,)))
        artifacts=rows(con.execute(f"SELECT artifact_type,COUNT(DISTINCT memory_id) days,COUNT(*) traces,MIN(date) first_seen,MAX(date) last_seen FROM artifact_ledger WHERE memory_id IN ({ph}) GROUP BY artifact_type ORDER BY days DESC,traces DESC LIMIT 8",mids))
        milestones=rows(con.execute(f"SELECT c.date,c.text,m.source_path FROM achievement_candidates c JOIN memories m ON m.id=c.memory_id WHERE c.memory_id IN ({ph}) ORDER BY c.date DESC,c.id DESC LIMIT 8",mids))
        decisions=rows(con.execute(f"SELECT c.date,c.text,m.source_path FROM decision_candidates c JOIN memories m ON m.id=c.memory_id WHERE c.memory_id IN ({ph}) ORDER BY c.date DESC,c.id DESC LIMIT 8",mids))
        groups.append({**dict(tr),'topics':topics,'skills':skills,'samples':samples,'monthly':monthly,'artifacts':artifacts,'milestones':milestones,'decisions':decisions})
    return groups


def book_chapters(con):
    out=[]
    for r in con.execute("SELECT * FROM hidden_chapters ORDER BY start_month"):
        ch=dict(r); ch['dominant_topics']=json.loads(ch.pop('dominant_topics_json') or '[]')
        start=ch['start_month']+'-01'; _,end=parse_period(ch['end_month'])
        stats=con.execute("SELECT COALESCE(SUM(daily_entries),0) entries,COALESCE(SUM(char_count),0) chars,COALESCE(SUM(ideas),0) ideas,COALESCE(SUM(questions),0) questions,COALESCE(SUM(beliefs),0) beliefs,COALESCE(SUM(events),0) events FROM month_stats WHERE month BETWEEN ? AND ?",(ch['start_month'],ch['end_month'])).fetchone()
        ribbon=rows(con.execute("SELECT e.date,e.text,e.event_type,m.source_path FROM event_candidates e JOIN memories m ON m.id=e.memory_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date LIMIT 12",(start,end)))
        milestones=rows(con.execute("SELECT c.date,c.text,m.source_path FROM achievement_candidates c JOIN memories m ON m.id=c.memory_id WHERE c.date BETWEEN ? AND ? ORDER BY c.date LIMIT 6",(start,end)))
        dense=rows(con.execute("SELECT m.date,m.source_path,mm.char_count FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE m.kind='daily' AND m.date BETWEEN ? AND ? AND m.date_anomaly=0 ORDER BY mm.char_count DESC LIMIT 5",(start,end)))
        months=rows(con.execute("SELECT month,daily_entries,char_count,events,ideas,questions,beliefs FROM month_stats WHERE month BETWEEN ? AND ? ORDER BY month",(ch['start_month'],ch['end_month'])))
        pages=rows(con.execute("SELECT m.id,m.date,m.source_path,mm.char_count FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date BETWEEN ? AND ? ORDER BY m.date",(start,end)))
        reps=[]
        if pages:
            idxs=sorted(set([0,len(pages)//4,len(pages)//2,(3*len(pages))//4,len(pages)-1]))
            for i in idxs:
                pg=pages[i]; sec=sections_for(con,pg['id']); txt=sec.get('日记') or sec.get('自我探索') or next((v for v in sec.values() if v.strip()),'')
                reps.append({'date':pg['date'],'source_path':pg['source_path'],'char_count':pg['char_count'],'excerpt':snippet(txt,[],380)})
        out.append({**ch,'stats':dict(stats),'source_ribbon':ribbon,'milestones':milestones,'dense_sources':dense,'months':months,'representative_sources':reps})
    return out


def compare(con,left,right):
    def period_stats(p):
        s,e=parse_period(p)
        if not (s and e):
            s,e=parse_period(str(p)[:4])
        cond="m.kind='daily' AND m.date_anomaly=0 AND m.date BETWEEN ? AND ?"
        b=con.execute(f"""SELECT COUNT(*) entries,COALESCE(SUM(mm.char_count),0) char_count,
                         COALESCE(SUM(mm.schedule_items),0) schedule_items,MIN(m.date) first_date,MAX(m.date) last_date
                         FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE {cond}""",(s,e)).fetchone()
        def c(table): return con.execute(f"SELECT COUNT(*) FROM {table} WHERE date BETWEEN ? AND ?",(s,e)).fetchone()[0]
        ov={**dict(b),'ideas':c('idea_candidates'),'questions':c('question_candidates'),'beliefs':c('belief_candidates'),
            'events':c('event_candidates'),'achievements':c('achievement_candidates'),'decisions':c('decision_candidates')}
        denom=max(1,int(ov.get('entries') or 0))
        ov['per_recorded_day']={k:round(float(ov.get(k) or 0)/denom,3) for k in ('char_count','events','ideas','questions','beliefs','achievements','decisions')}
        sk=skill_summary(con,p)[:24]; tp=aggregate_topics(con,p)[:24]
        months=rows(con.execute("SELECT * FROM month_stats WHERE month BETWEEN ? AND ? ORDER BY month",(s[:7],e[:7])))
        return {'period':p,'start':s,'end':e,'overview':ov,'skills':sk,'topics':tp,'months':months}
    L,R=period_stats(left),period_stats(right)
    ls={x['name']:x for x in L['skills']}; rs={x['name']:x for x in R['skills']}
    lt={x['topic']:x for x in L['topics']}; rt={x['topic']:x for x in R['topics']}
    le=max(1,int(L['overview'].get('entries') or 0)); re_=max(1,int(R['overview'].get('entries') or 0))
    skill_delta=[]
    for n in set(ls)|set(rs):
        a=ls.get(n,{}).get('evidence_days',0); b=rs.get(n,{}).get('evidence_days',0)
        ar=round(a/le*10,2); br=round(b/re_*10,2)
        skill_delta.append({'name':n,'left':a,'right':b,'delta':b-a,'left_rate':ar,'right_rate':br,'rate_delta':round(br-ar,2)})
    topic_delta=[]
    for n in set(lt)|set(rt):
        a=lt.get(n,{}).get('days',0); b=rt.get(n,{}).get('days',0)
        ar=round(a/le*10,2); br=round(b/re_*10,2)
        topic_delta.append({'topic':n,'left':a,'right':b,'delta':b-a,'left_rate':ar,'right_rate':br,'rate_delta':round(br-ar,2)})
    skill_delta.sort(key=lambda x:(-abs(x['rate_delta']),-abs(x['delta']),x['name']))
    topic_delta.sort(key=lambda x:(-abs(x['rate_delta']),-abs(x['delta']),x['topic']))
    ratio=max(le,re_)/max(1,min(le,re_))
    return {'left':L,'right':R,'skill_delta':skill_delta[:20],'topic_delta':topic_delta[:20],
            'comparability':{'recorded_day_ratio':round(ratio,2),'uneven_windows':ratio>=1.8,
                             'note':'Normalized rates use visible evidence days per 10 recorded diary days. They reduce window-size bias but still measure archive visibility only.'},
            'note':'Compare Me compares archive visibility between two date windows. Raw counts and normalized rates are both descriptive; neither is a competence, importance or wellbeing score.'}


def graph_data(con,limit=45):
    # build nodes from top skills, topics, roles, places and co-occurrence edges
    skills=skill_summary(con)[:12]
    topics=aggregate_topics(con)[:10]
    roles=rows(con.execute("""SELECT role,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions
                              FROM role_mentions GROUP BY role ORDER BY days DESC LIMIT 8"""))
    places=rows(con.execute("""SELECT place,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions
                               FROM place_mentions GROUP BY place ORDER BY days DESC LIMIT 8"""))
    nodes=[]
    for x in skills: nodes.append({'id':'skill:'+x['name'],'label':x['name'],'type':'skill','weight':x['evidence_days']})
    for x in topics: nodes.append({'id':'topic:'+x['topic'],'label':x['topic'],'type':'topic','weight':x['days']})
    for x in roles: nodes.append({'id':'role:'+x['role'],'label':x['role'],'type':'role','weight':x['days']})
    for x in places: nodes.append({'id':'place:'+x['place'],'label':x['place'],'type':'place','weight':x['days']})
    node_ids={n['id'] for n in nodes}
    memory_sets={}
    for n in nodes:
        typ,val=n['id'].split(':',1)
        if typ=='skill':
            ids={r[0] for r in con.execute("""SELECT sa.memory_id FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sd.name=?""",(val,))}
        elif typ=='topic':
            ids={r[0] for r in con.execute("SELECT memory_id FROM topic_mentions WHERE topic=?",(val,))}
        elif typ=='role':
            ids={r[0] for r in con.execute("SELECT memory_id FROM role_mentions WHERE role=?",(val,))}
        else:
            ids={r[0] for r in con.execute("SELECT memory_id FROM place_mentions WHERE place=?",(val,))}
        memory_sets[n['id']]=ids
    edges=[]
    nl=list(nodes)
    for i,a in enumerate(nl):
        for b in nl[i+1:]:
            inter=len(memory_sets[a['id']] & memory_sets[b['id']])
            if inter>=2:
                edges.append({'source':a['id'],'target':b['id'],'weight':inter})
    edges=sorted(edges,key=lambda x:x['weight'],reverse=True)[:120]
    return {'nodes':nodes[:limit],'edges':edges}

def product_ai_chat(messages,temperature=.2,feature='generic'):
    mode=product.get_setting('ai.mode','byok',ROOT)
    if mode=='disabled' or product.get_setting('ai.enabled','true',ROOT)!='true': return None
    if mode=='cloud': return p2_sync.cloud_ai(messages,feature,ROOT)
    return ai_providers.chat(messages,temperature=temperature,feature=feature)

def pet_companion_chat(history):
    """A deliberately context-free companion chat.

    The pet may only receive the current chat turns.  It never receives the
    vault, an open journal, a diary title, or any desktop event payload.
    """
    if not isinstance(history,list): raise ValueError('messages must be a list')
    turns=[]
    for item in history[-12:]:
        if not isinstance(item,dict): continue
        role=item.get('role')
        content=str(item.get('content') or '').strip()
        if role not in ('user','assistant') or not content: continue
        turns.append({'role':role,'content':content[:1800]})
    if not turns or turns[-1]['role']!='user': raise ValueError('a message is required')
    system=("You are a small, warm LifeOS desktop companion. Reply in Chinese unless the user writes in another language. "
            "Keep replies concise, grounded and companionable. You do not have access to diaries, the vault, prior LifeOS data, "
            "or any private information beyond the current chat turns. Never claim that you read or remember a diary. "
            "Do not diagnose mental health or give professional advice; for urgent safety concerns, encourage contacting local emergency services or a trusted person.")
    # Casual private conversation should not become a reusable AI cache entry.
    return ai_providers.chat([{'role':'system','content':system},*turns],temperature=.65,max_tokens=420,feature='Pet Companion',use_cache=False)

def call_llm(question,evidence):
    ev='\n\n'.join(f"[{e['evidence_id']}] {e['date']} · {e['section']} · {e['source_path']}\n{e['excerpt']}" for e in evidence)
    system="""You are the grounded reasoning layer of a private personal diary system.
Only use the evidence supplied by the system. Never invent missing events, motives, dates, people, or causal explanations.
Separate explicit facts from interpretation. If evidence is insufficient, say so.
Every factual or interpretive claim must cite one or more evidence IDs such as [E1].
Prefer chronological structure for change-over-time questions.
Do not treat AI summaries as the user's original words."""
    try:
        return product_ai_chat([{'role':'system','content':system},{'role':'user','content':f"Question: {question}\n\nEvidence:\n{ev}"}],temperature=0.2,feature='Ask My Life')
    except Exception as e:
        return {'error':str(e)}

def llm_configured():
    return bool(ai_providers.privacy_status().get('configured'))


CLASSICAL_STYLE_LABELS={'qingjian':'清简文言','biji':'笔记小品','shizhuan':'史传纪事','chidu':'尺牍书简'}
CLASSICAL_STRENGTH_LABELS={'light':'浅化 · 易读','medium':'中度 · 文言','deep':'凝练 · 古雅'}

def local_classical_draft(text,style='qingjian',strength='medium'):
    """Conservative offline lexical draft. It intentionally avoids deletion-heavy rewriting."""
    maps={
      'light':[('终于完成了','终成'),('我们','吾等'),('我觉得','吾以为'),('我想要','吾欲'),('我想','吾思'),('今天','今日'),('昨天','昨日'),('明天','明日'),('现在','今'),('之后','其后'),('之前','此前'),('然后','遂'),('但是','然'),('因为','因'),('所以','故'),('已经','已'),('可以','可'),('不能','不可'),('没有','无'),('需要','须'),('开始','始'),('结束','毕'),('一起','共'),('可能','或'),('非常','甚')],
      'medium':[('还有','尚有'),('一些','若干'),('修改','改'),('终于','终'),('如果','若'),('虽然','虽'),('不过','然'),('于是','遂'),('为了','为'),('关于','于'),('看到','见'),('听到','闻'),('告诉','告'),('发现','察'),('知道','知'),('认为','以为'),('准备','备'),('完成','成'),('继续','续'),('决定','决'),('选择','择'),('朋友','友'),('老师','师'),('工作','事'),('事情','事'),('办法','法'),('问题','问'),('结果','果')],
      'deep':[('这个','此'),('那个','彼'),('这些','诸'),('那些','诸'),('还是','仍'),('其实','实'),('大概','盖'),('突然','忽'),('终于','终'),('马上','即'),('后来','后'),('以前','昔'),('最近','近来'),('很多','多'),('一点','少许'),('比较','颇'),('更加','益'),('觉得','觉'),('想起','忆'),('来到','至'),('回到','归'),('离开','去')],
    }
    levels=['light'] + (['medium'] if strength in ('medium','deep') else []) + (['deep'] if strength=='deep' else [])
    lines=[]
    for line in text.splitlines():
        if line.startswith('### '): line='【'+line[4:]+'】'
        elif line.startswith('## '): line='【'+line[3:]+'】'
        lines.append(line)
    out='\n'.join(lines)
    pairs=[]
    for lv in levels: pairs.extend(maps[lv])
    for a,b in sorted(pairs,key=lambda x:len(x[0]),reverse=True): out=out.replace(a,b)
    if style in ('chidu','shizhuan'):
        out=out.replace('吾以为','余以为').replace('吾欲','余欲').replace('吾思','余思').replace('吾','余')
    elif style=='biji':
        out=out.replace('吾以为','余谓').replace('吾欲','余欲').replace('吾思','余思').replace('吾','余')
    return out.strip()

def call_classical_chinese(text,style='qingjian',strength='medium'):
    style_desc={
      'qingjian':'清简自然的文言，近明清笔记，避免生僻炫技，第一人称可用“余/吾”。',
      'biji':'古雅而有私人札记气息的笔记小品，保留原文情绪与节奏。',
      'shizhuan':'清楚有层次的史传纪事笔法，仍保留原文第一人称事实，不擅自改成第三人称传记。',
      'chidu':'尺牍书简风，亲切、简洁、有古意，但不虚构称谓或收信人。'}
    strength_desc={'light':'轻度文言化，优先易读，保留较多现代专有名词。','medium':'中度文言化，句式明显古雅但仍易懂。','deep':'较凝练的古文表达，可压缩冗词，但不得遗漏任何事实。'}
    system=f"""你是私人日记系统中的文言文转换器。任务仅是改写语言，不是总结、评论或补写。
必须遵守：
1. 不新增、删去或改变事实、日期、数字、人物关系、地点、项目、情绪方向与事件顺序。
2. 人名、机构名、论文名、产品名、AI/RAG/PRD/PPT/GitHub 等现代专有名词默认原样保留，除非有无歧义的常见译法。
3. 原文不确定、口语化或带 emoji 时，可保留其信息，不得猜测隐含含义。
4. 只输出转换后的文言文，不解释，不加标题，不评论。
5. 风格：{style_desc.get(style,style_desc['qingjian'])}
6. 程度：{strength_desc.get(strength,strength_desc['medium'])}
"""
    try:
        return product_ai_chat([{'role':'system','content':system},{'role':'user','content':text}],temperature=0.25,feature='文言化')
    except Exception as e:
        return {'error':str(e)}

def curiosity_bundle(con):
    cards=[]
    for r in con.execute("SELECT * FROM curiosity_cards ORDER BY id"):
        d=dict(r); d['source_paths']=json.loads(d.pop('source_paths_json') or '[]'); d['payload']=json.loads(d.pop('payload_json') or '{}'); cards.append(d)
    return {'cards':cards,'strongest_shift':jrow(con.execute('SELECT * FROM attention_shifts ORDER BY shift_score DESC LIMIT 1').fetchone()),'longest_gap':jrow(con.execute('SELECT * FROM silence_gaps ORDER BY gap_days DESC LIMIT 1').fetchone()),'top_skill_pairs':rows(con.execute('SELECT * FROM skill_pairs ORDER BY days DESC LIMIT 8')),'chapters':rows(con.execute('SELECT * FROM hidden_chapters ORDER BY start_month')),'question_threads':rows(con.execute('SELECT * FROM question_threads ORDER BY span_days DESC,occurrences DESC LIMIT 8')),'rhythms':rows(con.execute('SELECT * FROM weekday_rhythm ORDER BY weekday')),'note':'Curiosity Layer 只做可追溯的统计、共现和检索线索；意外不等于事实解释。'}

def echo_rows(con,limit=30):
    out=[]
    for r in con.execute("SELECT e.*,ml.source_path left_source,mr.source_path right_source FROM memory_echoes e JOIN memories ml ON ml.id=e.left_memory_id JOIN memories mr ON mr.id=e.right_memory_id ORDER BY e.score DESC LIMIT ?",(limit,)):
        d=dict(r); d['shared_terms']=json.loads(d.pop('shared_terms_json') or '[]'); out.append(d)
    return out

def first_last_rows(con,kind=None):
    if kind: rs=con.execute("SELECT f.*,mf.source_path first_source,ml.source_path last_source FROM first_last_mentions f LEFT JOIN memories mf ON mf.id=f.first_memory_id LEFT JOIN memories ml ON ml.id=f.last_memory_id WHERE f.kind=? ORDER BY f.first_date",(kind,))
    else: rs=con.execute("SELECT f.*,mf.source_path first_source,ml.source_path last_source FROM first_last_mentions f LEFT JOIN memories mf ON mf.id=f.first_memory_id LEFT JOIN memories ml ON ml.id=f.last_memory_id ORDER BY f.kind,f.first_date")
    return rows(rs)


def timefold_bundle(con):
    def count(t): return con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    top_turn=[]
    for r in con.execute("SELECT * FROM turning_points ORDER BY score DESC LIMIT 6"):
        x=dict(r);x['signals']=json.loads(x.pop('signals_json') or '[]');top_turn.append(x)
    momentum=rows(con.execute("SELECT * FROM skill_momentum ORDER BY momentum DESC LIMIT 8"))
    promises=rows(con.execute("SELECT status,COUNT(*) count FROM promise_ledger GROUP BY status ORDER BY count DESC"))
    seasonal=[]
    for r in con.execute("SELECT * FROM seasonal_echoes ORDER BY topic_similarity ASC LIMIT 4"):
        x=dict(r)
        for k in ('rising_topics_json','falling_topics_json','rising_skills_json','falling_skills_json'):
            x[k[:-5]]=json.loads(x.pop(k) or '[]')
        seasonal.append(x)
    return {
      'growth_months':count('growth_rings'),'novelty_days':count('novelty_days'),'bridge_days':count('bridge_days'),
      'promise_candidates':count('promise_ledger'),'future_echoes':count('future_echoes'),'identity_statements':count('identity_ledger'),
      'motifs':count('motif_atlas'),'turning_points':count('turning_points'),'thread_reopenings':count('thread_reopenings'),
      'skills_tracked':count('skill_momentum'),'seasonal_echoes':count('seasonal_echoes'),
      'top_turning_points':top_turn,'warming_skills':momentum,'promise_status':promises,'seasonal_differences':seasonal,
      'note':'Timefold Layer links long-range recurrence, explicit future-facing language and archive structure. It surfaces review candidates; it does not prove intention, fulfillment, causality, competence or identity.'
    }


def mirror_bundle(con):
    vals={r['key']:int(r['value']) if str(r['value']).isdigit() else r['value'] for r in con.execute('SELECT * FROM mirror_summary')}
    closures=[]
    for r in con.execute('SELECT * FROM closure_candidates ORDER BY score DESC LIMIT 5'):
        x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');closures.append(x)
    quiet=rows(con.execute('SELECT * FROM quiet_priorities ORDER BY quiet_score DESC LIMIT 6'))
    protocols=[]
    for r in con.execute('SELECT * FROM protocol_threads ORDER BY span_days DESC,occurrences DESC LIMIT 5'):
        x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');protocols.append(x)
    return {**vals,'top_closures':closures,'quiet_priorities_top':quiet,'long_protocols':protocols,
            'note':'Mirror Layer compares explicit language, later archive echoes and local context. It is designed for review, not judgment: an echo is not fulfillment, silence is not neglect, and context is not causality.'}


def compass_bundle(con):
    vals={r['key']:int(r['value']) if str(r['value']).isdigit() else r['value'] for r in con.execute('SELECT * FROM compass_summary')}
    loops=[]
    for r in con.execute('SELECT * FROM learning_loops ORDER BY score DESC LIMIT 5'):
        x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');loops.append(x)
    transfers=[]
    for r in con.execute("SELECT * FROM skill_transfer_trails WHERE left_category<>'Personal' AND right_category<>'Personal' ORDER BY evidence_days DESC LIMIT 6"):
        x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');transfers.append(x)
    revisions=[]
    for r in con.execute('SELECT * FROM revision_trails ORDER BY span_days DESC,occurrences DESC LIMIT 6'):
        x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');revisions.append(x)
    questions=[]
    for r in con.execute('SELECT * FROM compass_questions ORDER BY priority DESC LIMIT 6'):
        x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');questions.append(x)
    cards=[]
    for r in con.execute('SELECT * FROM orientation_cards ORDER BY id'):
        x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');x['payload']=json.loads(x.pop('payload_json') or '{}');cards.append(x)
    return {**vals,'top_learning_loops':loops,'top_transfers':transfers,'long_revisions':revisions,'questions':questions,'cards':cards,
            'note':'Compass Layer turns existing evidence into navigational review cues. Same-day context, recurrence, bursts and later traces are not causality, competence, personality or value-alignment scores.'}



def topology_bundle(con):
    vals={r['key']:int(r['value']) if str(r['value']).isdigit() else r['value'] for r in con.execute('SELECT * FROM topology_summary')}
    neighborhoods=[]
    for r in con.execute('SELECT * FROM life_neighborhoods ORDER BY edge_weight DESC,node_count DESC LIMIT 8'):
        x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');x['top_months']=json.loads(x.pop('top_months_json') or '[]');neighborhoods.append(x)
    gateways=[]
    for r in con.execute('SELECT * FROM gateway_nodes ORDER BY gateway_score DESC LIMIT 8'):
        x=dict(r);x['sample_neighbors']=json.loads(x.pop('sample_neighbors_json') or '[]');gateways.append(x)
    anchors=[]
    for r in con.execute('SELECT * FROM anchor_memories_topology ORDER BY anchor_score DESC LIMIT 6'):
        x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');anchors.append(x)
    surprises=[]
    for r in con.execute('SELECT * FROM cooccurrence_surprises WHERE evidence_days>=3 AND left_kind<>right_kind ORDER BY lift DESC,evidence_days DESC LIMIT 6'):
        x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');surprises.append(x)
    return {**vals,'top_neighborhoods':neighborhoods,'top_gateways':gateways,'top_anchor_memories':anchors,'top_surprise_pairs':surprises,
            'note':'Topology Layer maps same-day co-occurrence into neighborhoods, bridges, routes and transitions. Graph proximity, lift, centrality and sequence are navigation signals only: they do not prove causality, importance, identity or prediction.'}


def footprint_bundle(con):
    vals={r['key']:int(r['value']) if str(r['value']).isdigit() else r['value'] for r in con.execute('SELECT * FROM footprint_summary')}
    trails=[]
    for r in con.execute('SELECT * FROM output_trails ORDER BY recorded_days DESC,span_days DESC LIMIT 8'):
        x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');trails.append(x)
    shares=[]
    for r in con.execute('SELECT * FROM sharing_trails ORDER BY date DESC LIMIT 8'):
        x=dict(r);x['audiences']=json.loads(x.pop('audiences_json') or '[]');shares.append(x)
    validates=rows(con.execute("SELECT * FROM external_validation WHERE artifact_type IS NOT NULL ORDER BY date DESC LIMIT 8"))
    reuse=[]
    for r in con.execute('SELECT * FROM reuse_trails ORDER BY span_days DESC LIMIT 6'):
        x=dict(r);x['return_gaps']=json.loads(x.pop('return_gaps_json') or '[]');x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');reuse.append(x)
    links=[]
    for r in con.execute("SELECT * FROM learning_output_links WHERE skill NOT IN ('Writing','Reflection') ORDER BY output_days DESC,linked_outputs DESC LIMIT 8"):
        x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');links.append(x)
    qs=[]
    for r in con.execute('SELECT * FROM legacy_questions ORDER BY priority DESC LIMIT 6'):
        x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');qs.append(x)
    return {**vals,'top_output_trails':trails,'recent_sharing':shares,'recent_validation':validates,'long_reuse_trails':reuse,'top_learning_output':links,'questions':qs,
            'note':'Footprint Layer tracks explicit artifact/output, sharing, handoff, feedback and validation traces. It records what left a textual footprint in the archive; it does not measure quality, ownership, audience reception, influence or causal impact.'}


def lineage_bundle(con):
    vals={r['key']:int(r['value']) if str(r['value']).isdigit() else r['value'] for r in con.execute('SELECT * FROM lineage_summary')}
    trails=[]
    for r in con.execute('SELECT * FROM thought_artifact_trails ORDER BY score DESC,gap_days ASC LIMIT 7'):
        x=dict(r);x['shared_anchors']=json.loads(x.pop('shared_anchors_json') or '[]');x['shared_context']=json.loads(x.pop('shared_context_json') or '[]');trails.append(x)
    proofs=rows(con.execute('SELECT * FROM first_proofs ORDER BY date LIMIT 8'))
    loops=rows(con.execute('SELECT * FROM lineage_feedback_loops ORDER BY score DESC,gap_to_feedback ASC LIMIT 6'))
    cross=[]
    for r in con.execute('SELECT * FROM cross_pollination ORDER BY nearby_pairs DESC,shared_days DESC LIMIT 7'):
        x=dict(r);x['shared_skills']=json.loads(x.pop('shared_skills_json') or '[]');x['shared_topics']=json.loads(x.pop('shared_topics_json') or '[]');x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');cross.append(x)
    chains=[]
    for r in con.execute('SELECT * FROM evidence_chains ORDER BY score DESC,span_days DESC LIMIT 6'):
        x=dict(r);x['steps']=json.loads(x.pop('steps_json') or '[]');chains.append(x)
    return {**vals,'top_thought_artifact':trails,'first_proof_samples':proofs,'feedback_loop_samples':loops,'top_cross_pollination':cross,'top_evidence_chains':chains,
            'note':'Lineage Layer composes dated thoughts, project-like traces, artifacts, handoffs, feedback and revisions into reviewable source chains. A lineage is a documented sequence/proximity structure, not proof of causality, fulfillment, authorship, or impact.'}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(APP),**kw)
    def log_message(self,fmt,*args): print('[LifeOS]',fmt%args)
    def end_headers(self):
        # The app shell is deliberately never cached: opening start.bat must
        # show the files from this workspace rather than an older LifeOS tab.
        source=urlparse(self.path).path
        if source=='/' or source.endswith(('.html','.css','.js')):
            self.send_header('Cache-Control','no-store, max-age=0, must-revalidate')
        super().end_headers()
    def send_json(self,obj,status=200):
        raw=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(raw)
    def send_binary(self,data,content_type='application/octet-stream',filename=None,status=200,disposition='inline'):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','private, no-store')
        if filename: self.send_header('Content-Disposition',f"{disposition}; filename*=UTF-8''"+quote(filename))
        self.end_headers(); self.wfile.write(data)
    def body_json(self):
        n=int(self.headers.get('Content-Length','0') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}') if n else {}
    def do_GET(self):
        u=urlparse(self.path)
        if u.path.startswith('/api/'):
            try: return self.api_get(u.path,parse_qs(u.query))
            except Exception as e:
                import traceback; traceback.print_exc()
                return self.send_json({'error':str(e)},500)
        return super().do_GET()
    def do_POST(self):
        u=urlparse(self.path)
        if u.path.startswith('/api/'):
            try: return self.api_post(u.path,self.body_json())
            except Exception as e:
                import traceback; traceback.print_exc()
                return self.send_json({'error':str(e)},500)
        return self.send_json({'error':'POST not supported'},405)
    def api_get(self,path,q):
        con=db()
        try:
            if path=='/api/health':
                return self.send_json({'ok':True,'mode':'local-first','engine':con.execute("SELECT value FROM meta WHERE key='engine_version'").fetchone()[0],'core':product.core_status(ROOT),'ai':ai_providers.privacy_status(),'bootstrap':PRODUCT_BOOTSTRAP,'p2':p2_core.status(ROOT),'encryption':crypto_vault.status(ROOT)})
            if path=='/api/core/status':
                return self.send_json({'core':product.core_status(ROOT),'settings':product.settings_dict(ROOT),'features':product.feature_states(ROOT),'derived_refresh':product.derived_refresh_status(ROOT)})
            if path=='/api/copydeck':
                cp=ROOT/'config'/'copydeck.json'
                if not cp.exists(): return self.send_json({'error':'copydeck not found'},404)
                try: return self.send_json(json.loads(cp.read_text(encoding='utf-8')))
                except Exception as e: return self.send_json({'error':f'copydeck invalid: {e}'},500)
            if path=='/api/pets/catalog':
                return self.send_json(pet_status(q.get('refresh',['0'])[0]=='1'))
            if path=='/api/pets/desktop':
                status=pet_status(); item=next((x for x in status['installed'] if x['slug']==status['active_slug']),None)
                if not item: return self.send_json({'pet':None})
                sprite=(PET_ASSET_ROOT/item['folder']/'spritesheet.webp').resolve()
                return self.send_json({'pet':{'id':item['slug'],'name':item['name'],'version':item['spriteVersionNumber'],'frameMap':item.get('frame_map'),'sprite':str(sprite)}})
            if path=='/api/entries':
                return self.send_json({'items':product.list_entries(int(q.get('limit',['1000'])[0]),ROOT)})
            if path=='/api/entry':
                item=product.get_entry(entry_id=q.get('entry_id',[None])[0],source_path=q.get('source',[None])[0],root=ROOT)
                if not item:return self.send_json({'error':'entry not found'},404)
                cur=product.read_revision(item['current_revision_id'],ROOT)
                return self.send_json({'entry':item,'current':cur,'revisions':product.list_revisions(item['entry_id'],ROOT),'attachments':product.list_attachments(item['entry_id'],ROOT)})
            if path=='/api/revisions':
                eid=q.get('entry_id',[''])[0]
                return self.send_json({'items':product.list_revisions(eid,ROOT)})
            if path=='/api/revision':
                item=product.read_revision(q.get('revision_id',[''])[0],ROOT)
                return self.send_json(item or {'error':'revision not found'},200 if item else 404)
            if path=='/api/import/job':
                job=import_pipeline.get_job(q.get('job_id',[''])[0],ROOT)
                return self.send_json(job or {'error':'job not found'},200 if job else 404)
            if path=='/api/backups':
                return self.send_json({'items':product.list_backups(ROOT)})
            if path=='/api/export':
                entry_ids=q.get('entry_id',[])
                bundle=product.export_entries(
                    export_format=q.get('format',['markdown'])[0],
                    date_from=q.get('from',[''])[0],
                    date_to=q.get('to',[''])[0],
                    entry_ids=entry_ids,
                    include_attachments=q.get('attachments',['0'])[0] in ('1','true','yes'),
                    root=ROOT,
                )
                return self.send_binary(bundle['data'],bundle['content_type'],bundle['filename'],disposition='attachment')
            if path=='/api/feature-state':
                return self.send_json({'items':product.feature_states(ROOT),'artifact':product.artifact_status(q.get('feature',[None])[0],ROOT)})
            if path=='/api/ai/status':
                out=ai_providers.privacy_status();out['usage']=product.ai_usage_summary(ROOT);return self.send_json(out)
            if path=='/api/sync/status':
                out=sync_engine.status(ROOT);out['items']=product.list_sync_conflicts(ROOT);return self.send_json(out)
            if path=='/api/p2/status':
                return self.send_json({'p2':p2_core.status(ROOT),'encryption':crypto_vault.status(ROOT),'notifications':p2_core.notification_preferences(ROOT),'shares':p2_core.list_shares(ROOT)})
            if path=='/api/inbox':
                return self.send_json({'items':p2_core.list_inbox(q.get('status',['pending'])[0],int(q.get('limit',['200'])[0]),ROOT)})
            if path=='/api/notifications':
                return self.send_json({'items':p2_core.list_notifications(q.get('status',[None])[0],int(q.get('limit',['100'])[0]),ROOT),'preferences':p2_core.notification_preferences(ROOT)})
            if path=='/api/marketplace':
                catalog_path=ROOT/'marketplace'/'catalog.json';catalog=json.loads(catalog_path.read_text(encoding='utf-8')) if catalog_path.exists() else {'items':[]};return self.send_json({'catalog':catalog,'installed':p2_core.list_addons(ROOT)})
            if path=='/api/encryption/status':
                return self.send_json(crypto_vault.status(ROOT))
            if path=='/api/subscription':
                return self.send_json(p2_core.subscription(ROOT))
            if path=='/api/shares':
                return self.send_json({'items':p2_core.list_shares(ROOT)})
            if path=='/api/attachments':
                return self.send_json({'items':product.list_attachments(q.get('entry_id',[''])[0],ROOT)})
            if path=='/api/attachment':
                rec=product.attachment_record(q.get('attachment_id',[''])[0],ROOT)
                if not rec:return self.send_json({'error':'attachment not found'},404)
                fp=ROOT/rec['stored_path']
                if not fp.exists():return self.send_json({'error':'attachment file missing'},404)
                return self.send_binary(fp.read_bytes(),rec.get('mime_type') or 'application/octet-stream',rec.get('original_name'))
            if path=='/api/status':
                meta={r['key']:r['value'] for r in con.execute("SELECT * FROM meta")}
                latest=con.execute("SELECT date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 ORDER BY date DESC LIMIT 1").fetchone()
                anomalies=rows(con.execute("SELECT date,source_path FROM memories WHERE date_anomaly=1"))
                return self.send_json({'meta':meta,'overview':overview(con),'latest':jrow(latest),'anomalies':anomalies,
                                       'skills':len(CFG['skills']),'topics':len(CFG['topics']),'llm_configured':llm_configured()})
            if path=='/api/home':
                latest=rows(con.execute("""SELECT m.id,m.date,m.source_path,mm.char_count
                                           FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                                           WHERE m.kind='daily' AND m.date_anomaly=0 ORDER BY m.date DESC LIMIT 7"""))
                current=latest[0]['date'] if latest else None
                onthis=[]
                if current:
                    mm=current[5:]
                    onthis=rows(con.execute("""SELECT date,source_path FROM memories WHERE kind='daily' AND date LIKE ?
                                             AND date<>? ORDER BY date DESC""",('%-'+mm,current)))
                month=current[:7] if current else None
                month_stats=jrow(con.execute("SELECT * FROM month_stats WHERE month=?",(month,)).fetchone()) if month else None
                return self.send_json({'overview':overview(con),'latest':latest,'on_this_day':onthis,
                                       'month':month_stats,'skills':skill_summary(con)[:8],'topics':aggregate_topics(con)[:8],
                                       'recent_ideas':table_candidates(con,'idea_candidates',5),
                                       'recent_beliefs':table_candidates(con,'belief_candidates',5)})
            if path=='/api/journals':
                kind=q.get('kind',['daily'])[0]; limit=max(1,min(2000,int(q.get('limit',['700'])[0])))
                if kind=='daily':
                    rs=con.execute("""SELECT m.id,m.kind,m.date,m.source_path,m.sha256,m.date_anomaly,m.provenance_type,
                                      mm.char_count,mm.nonempty_sections,mm.schedule_items
                                      FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                                      WHERE m.kind='daily' ORDER BY m.date DESC LIMIT ?""",(limit,))
                else:
                    rs=con.execute("""SELECT m.id,m.kind,m.year,m.week,m.source_path,m.sha256,m.provenance_type,
                                      mm.char_count,mm.nonempty_sections,mm.schedule_items
                                      FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                                      WHERE m.kind='weekly' ORDER BY m.year DESC,m.week DESC LIMIT ?""",(limit,))
                return self.send_json({'items':rows(rs)})
            if path=='/api/journal':
                sp=q.get('path',[''])[0]
                r=con.execute("SELECT * FROM memories WHERE source_path=?",(sp,)).fetchone()
                if not r: return self.send_json({'error':'not found'},404)
                pe=product.get_entry(source_path=sp,root=ROOT)
                return self.send_json({'memory':dict(r),'sections':sections_for(con,r['id']),
                                       'metrics':jrow(con.execute("SELECT * FROM memory_metrics WHERE memory_id=?",(r['id'],)).fetchone()),
                                       'skills':rows(con.execute("""SELECT sd.name,sa.mention_count,sa.matched_terms_json
                                            FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id=?
                                            ORDER BY sa.mention_count DESC""",(r['id'],))),
                                       'topics':rows(con.execute("SELECT topic,mention_count FROM topic_mentions WHERE memory_id=? ORDER BY mention_count DESC",(r['id'],))),
                                       'context':journal_context(con,r['id'],r['kind'],r['date'],r['year'],r['week']),
                                       'product_entry':pe,
                                       'revisions':product.list_revisions(pe['entry_id'],ROOT)[:12] if pe else [],
                                       'attachments':product.list_attachments(pe['entry_id'],ROOT) if pe else []})
            if path=='/api/search':
                query=q.get('q',[''])[0].strip(); limit=max(1,min(120,int(q.get('limit',['60'])[0])))
                section=q.get('section',[''])[0].strip(); kind=q.get('kind',['all'])[0].strip(); year=q.get('year',[''])[0].strip(); sort=q.get('sort',['relevance'])[0]
                terms=query_terms(query); wh=["m.kind IN ('daily','weekly')"]; params=[]
                if section: wh.append("s.normalized_name=?"); params.append(section)
                if kind in ('daily','weekly'): wh.append("m.kind=?"); params.append(kind)
                if re.fullmatch(r'20\d{2}',year): wh.append("COALESCE(m.date,printf('%04d',m.year)) LIKE ?"); params.append(year+'%')
                rs=con.execute(f"""SELECT m.kind,m.date,m.year,m.week,m.source_path,m.provenance_type,s.normalized_name section,s.content
                                   FROM sections s JOIN memories m ON m.id=s.memory_id
                                   WHERE {' AND '.join(wh)}""",params).fetchall()
                scored=[]; ql=query.lower()
                for r in rs:
                    low=r['content'].lower(); score=0.0; hits=[]; reasons=[]
                    if not query: score=1.0; reasons.append('browse mode')
                    if query and ql in low: score+=24;hits.append(query);reasons.append('exact phrase')
                    for t in terms:
                        c=low.count(t.lower())
                        if c:
                            w=1+min(len(t),10)/3.5
                            if t.lower() in ql: w*=1.8
                            score+=min(c,4)*w;hits.append(t)
                    if hits: reasons.append(f"{len(set(hits))} lexical anchor(s)")
                    if r['provenance_type']=='daily_raw': score+=1.5; reasons.append('daily raw preference')
                    if score>0: scored.append((score,r,list(dict.fromkeys(hits)),reasons))
                def labeldate(r): return r['date'] or f"{r['year']}_W{int(r['week']):02d}"
                if sort=='date_desc' or (sort=='relevance' and not query): scored.sort(key=lambda x:labeldate(x[1]),reverse=True)
                elif sort=='date_asc': scored.sort(key=lambda x:labeldate(x[1]))
                else: scored.sort(key=lambda x:(-x[0],labeldate(x[1])),reverse=False)
                facets={'years':{},'sections':{},'kinds':{}}
                for score,r,hits,reasons in scored:
                    lab=labeldate(r); yy=lab[:4]
                    facets['years'][yy]=facets['years'].get(yy,0)+1
                    facets['sections'][r['section']]=facets['sections'].get(r['section'],0)+1
                    facets['kinds'][r['kind']]=facets['kinds'].get(r['kind'],0)+1
                items=[]
                for score,r,hits,reasons in scored[:limit]:
                    d=dict(r); d['date']=labeldate(r);d['score']=round(score,2);d['matched_terms']=hits[:10];d['rank_reason']=' · '.join(reasons)
                    d['snippet']=snippet(d.pop('content'),hits or terms,360);items.append(d)
                return self.send_json({'items':items,'count':len(items),'total_matches':len(scored),'terms':terms,'facets':facets,
                                       'filters':{'section':section,'kind':kind,'year':year,'sort':sort},
                                       'note':'Local lexical search across immutable source sections. Facets describe matching sections, not whole-life frequency.'})
            if path=='/api/timeline':
                limit=max(1,min(500,int(q.get('limit',['200'])[0])))
                start=q.get('from',[None])[0]; end=q.get('to',[None])[0]
                wh=['1=1']; params=[]
                if start: wh.append('e.date>=?'); params.append(start)
                if end: wh.append('e.date<=?'); params.append(end)
                rs=con.execute(f"""SELECT e.*,m.source_path FROM event_candidates e JOIN memories m ON m.id=e.memory_id
                                   WHERE {' AND '.join(wh)} ORDER BY e.date DESC,e.id DESC LIMIT ?""",params+[limit])
                items=rows(rs); monthly={}
                for x in items:
                    m=(x.get('date') or 'unknown')[:7]; monthly[m]=monthly.get(m,0)+1
                bounds=jrow(con.execute("SELECT MIN(date) first_date,MAX(date) last_date FROM event_candidates").fetchone())
                return self.send_json({'items':items,'monthly':monthly,'bounds':bounds,'note':'Timeline contains only direct schedule/event candidate text from dated sources.'})
            if path=='/api/on-this-day':
                date=q.get('date',[datetime.date.today().isoformat()])[0]; mm=date[5:10]
                base=con.execute("""SELECT m.id,m.date,m.source_path,mm.char_count,mm.nonempty_sections,mm.schedule_items
                                    FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                                    WHERE m.kind='daily' AND substr(m.date,6,5)=? ORDER BY m.date DESC""",(mm,)).fetchall()
                items=[]
                for r in base:
                    sec=sections_for(con,r['id']); txt=sec.get('日记') or sec.get('自我探索') or next((v for v in sec.values() if v.strip()),'')
                    skills=rows(con.execute("""SELECT sd.name,sa.mention_count FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id
                                               WHERE sa.memory_id=? ORDER BY sa.mention_count DESC LIMIT 5""",(r['id'],)))
                    topics=rows(con.execute("SELECT topic,mention_count FROM topic_mentions WHERE memory_id=? ORDER BY mention_count DESC LIMIT 5",(r['id'],)))
                    x=dict(r);x['excerpt']=snippet(txt,[],360);x['skills']=skills;x['topics']=topics;items.append(x)
                return self.send_json({'date':date,'items':items,'note':'Same calendar day across recorded years. Side-by-side context is descriptive; it does not claim recurrence or annual causality.'})
            if path=='/api/skills':
                period=q.get('period',[None])[0]
                return self.send_json({'items':skill_summary(con,period),'note':'Level is a relative activity-derived signal, not a competence score.'})
            if path=='/api/skill':
                name=q.get('name',[''])[0]
                base=next((x for x in skill_summary(con) if x['name']==name),None)
                if not base: return self.send_json({'error':'skill not found'},404)
                ev=[]
                for rr in con.execute("""SELECT m.id memory_id,m.date,m.source_path,sa.mention_count,sa.matched_terms_json
                                      FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id
                                      JOIN memories m ON m.id=sa.memory_id
                                      WHERE sd.name=? ORDER BY m.date DESC LIMIT 60""",(name,)):
                    d=dict(rr); raw_terms=json.loads(d.get('matched_terms_json') or '[]'); terms=[]
                    for item in raw_terms:
                        if isinstance(item,str): terms.append(item)
                        elif isinstance(item,list): terms.extend(str(x) for x in item if isinstance(x,(str,int,float)))
                    sec=con.execute("SELECT normalized_name,content FROM sections WHERE memory_id=? AND length(trim(content))>0 ORDER BY CASE WHEN normalized_name='日记' THEN 0 WHEN normalized_name='自我探索' THEN 1 ELSE 2 END,ordinal",(d['memory_id'],)).fetchall()
                    best=next((x for x in sec if any(t.lower() in x['content'].lower() for t in terms)),sec[0] if sec else None)
                    d['section']=best['normalized_name'] if best else ''
                    d['excerpt']=snippet(best['content'],terms,260) if best else ''
                    d['matched_terms']=terms[:12]
                    ev.append(d)
                monthly=rows(con.execute("""SELECT substr(m.date,1,7) month,COUNT(DISTINCT m.id) days,SUM(sa.mention_count) mentions
                                           FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id
                                           JOIN memories m ON m.id=sa.memory_id
                                           WHERE sd.name=? AND m.kind='daily' GROUP BY substr(m.date,1,7) ORDER BY month""",(name,)))
                topics=rows(con.execute("""SELECT tm.topic,COUNT(DISTINCT tm.memory_id) days,SUM(tm.mention_count) mentions
                                           FROM topic_mentions tm WHERE tm.memory_id IN (
                                             SELECT sa.memory_id FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sd.name=?
                                           ) GROUP BY tm.topic ORDER BY days DESC,mentions DESC LIMIT 10""",(name,)))
                artifacts=rows(con.execute("""SELECT al.artifact_type,COUNT(DISTINCT al.memory_id) days,COUNT(*) traces
                                              FROM artifact_ledger al WHERE al.memory_id IN (
                                                SELECT sa.memory_id FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sd.name=?
                                              ) GROUP BY al.artifact_type ORDER BY days DESC,traces DESC LIMIT 8""",(name,)))
                return self.send_json({'skill':base,'evidence':ev,'monthly':monthly,'contexts':{'topics':topics,'artifacts':artifacts}})
            if path=='/api/topics':
                period=q.get('period',[None])[0]
                return self.send_json({'items':aggregate_topics(con,period)})
            if path=='/api/words':
                terms=q.get('terms',[''])[0].split(',') if q.get('terms') else CFG['word_terms']
                data={}
                for term in terms:
                    data[term]=rows(con.execute("SELECT month,mention_count FROM term_monthly WHERE term=? ORDER BY month",(term,)))
                return self.send_json({'terms':data})
            if path=='/api/analytics':
                year=q.get('year',[None])[0]
                months=rows(con.execute("SELECT * FROM month_stats WHERE month LIKE ? ORDER BY month",((year+'%') if year else '%',)))
                return self.send_json({'overview':overview(con,year),'months':months,'skills':skill_summary(con,year)[:12] if year else skill_summary(con)[:12],
                                       'topics':aggregate_topics(con,year)[:10] if year else aggregate_topics(con)[:10]})
            if path=='/api/ideas':
                return self.send_json({'items':table_candidates(con,'idea_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0])})
            if path=='/api/questions':
                return self.send_json({'items':table_candidates(con,'question_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0])})
            if path=='/api/beliefs':
                return self.send_json({'items':table_candidates(con,'belief_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0])})
            if path=='/api/achievements':
                return self.send_json({'items':table_candidates(con,'achievement_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0])})
            if path=='/api/decisions':
                return self.send_json({'items':table_candidates(con,'decision_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0])})
            if path=='/api/projects':
                limit=int(q.get('limit',['100'])[0]); year=q.get('year',[None])[0]; trigger=q.get('trigger',[None])[0]
                items=table_candidates(con,'project_candidates',limit,year)
                if trigger: items=[x for x in items if x.get('trigger')==trigger]
                return self.send_json({'items':items,'groups':grouped_projects(con) if q.get('grouped',['0'])[0]=='1' else [],
                                       'note':'Project groups are anchored by the explicit trigger words already stored in project_candidates; they are navigation buckets, not inferred project identities.'})
            if path=='/api/quotes':
                return self.send_json({'items':table_candidates(con,'quote_candidates',int(q.get('limit',['100'])[0]),q.get('year',[None])[0]),
                                       'warning':'心得与摘录可能包含外部引用，因此这里只称“摘录候选”，不自动声称是本人原创。'})
            if path=='/api/habits':
                rs=con.execute("""SELECT m.date,s.content FROM sections s JOIN memories m ON m.id=s.memory_id
                                  WHERE s.normalized_name='习惯打卡' AND m.kind='daily' AND length(trim(s.content))>0
                                  ORDER BY m.date""").fetchall()
                counter={}; first={}; last={}
                for r in rs:
                    for line in r['content'].splitlines():
                        item=re.sub(r'^\\s*[-*+]\\s*','',line.strip())
                        if not item: continue
                        counter[item]=counter.get(item,0)+1
                        first.setdefault(item,r['date']); last[item]=r['date']
                items=[{'habit':k,'days_present':v,'first_seen':first[k],'last_seen':last[k]} for k,v in counter.items()]
                items.sort(key=lambda x:(-x['days_present'],x['habit']))
                return self.send_json({'items':items,'note':'当前日记模板记录的是“习惯栏目/模板出现”，未必代表当天实际完成；LifeOS 不把它自动解释成完成率。'})
            if path=='/api/people':
                roles=rows(con.execute("""SELECT role,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions,
                                         MIN(m.date) first_seen,MAX(m.date) last_seen
                                         FROM role_mentions r JOIN memories m ON m.id=r.memory_id
                                         GROUP BY role ORDER BY days DESC"""))
                persons=rows(con.execute("""SELECT person,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions,
                                           MIN(m.date) first_seen,MAX(m.date) last_seen
                                           FROM person_mentions p JOIN memories m ON m.id=p.memory_id
                                           GROUP BY person ORDER BY days DESC"""))
                detail=None
                if q.get('role'): detail=people_context(con,'role',q.get('role',[''])[0])
                elif q.get('person'): detail=people_context(con,'person',q.get('person',[''])[0])
                return self.send_json({'roles':roles,'people':persons,'detail':detail,'note':'默认不猜真实人名；可在 config/entities.json 中显式配置。角色上下文来自同日共现，只用于回看，不评价关系质量或影响。'})
            if path=='/api/places':
                items=rows(con.execute("""SELECT place,COUNT(DISTINCT memory_id) days,SUM(mention_count) mentions,
                                      MIN(m.date) first_seen,MAX(m.date) last_seen
                                      FROM place_mentions p JOIN memories m ON m.id=p.memory_id
                                      GROUP BY place ORDER BY days DESC,mentions DESC"""))
                name=q.get('place',[None])[0]
                return self.send_json({'items':items,'detail':place_context(con,name) if name else None,
                                       'note':'Places are explicit configured lexical mentions. They are archive indexes, not inferred GPS history or evidence that a place caused an outcome.'})
            if path=='/api/compare':
                left=q.get('left',['2025'])[0]; right=q.get('right',['2026'])[0]
                return self.send_json(compare(con,left,right))
            if path=='/api/graph':
                return self.send_json(graph_data(con))
            if path=='/api/book':
                return self.send_json({'chapters':book_chapters(con),'note':'Book uses Hidden Chapter candidates plus dated source ribbons. Chapter boundaries and title seeds remain reviewable interpretations, not replacements for raw sources.'})
            if path=='/api/year-review':
                year=q.get('year',[str(datetime.date.today().year)])[0]
                return self.send_json(year_review_bundle(con,year))
            if path=='/api/retrieve':
                query=q.get('q',[''])[0]; limit=int(q.get('limit',['12'])[0])
                return self.send_json(retrieve(con,query,limit))
            if path=='/api/provenance':
                kinds=rows(con.execute("""SELECT provenance_type,COUNT(*) count FROM memories GROUP BY provenance_type"""))
                review_counts={scope:len(get_review_map(con,scope)) for scope in REVIEW_SCOPES}
                return self.send_json({'sources':kinds,'anomalies':rows(con.execute("SELECT date,source_path,sha256 FROM memories WHERE date_anomaly=1")),
                                       'corrections':rows(con.execute("SELECT * FROM corrections ORDER BY id DESC LIMIT 100")),
                                       'review_counts':review_counts})
            if path=='/api/reviews':
                scope=q.get('scope',[''])[0]
                if scope not in REVIEW_SCOPES: return self.send_json({'error':'unknown review scope'},400)
                return self.send_json({'scope':scope,'items':get_review_map(con,scope),
                                       'note':'Manual review metadata lives in local app_settings and never rewrites raw Markdown or deterministic derived tables.'})
            if path=='/api/capsules':
                now=datetime.date.today().isoformat()
                con.execute("UPDATE capsules SET status='open' WHERE unlock_date IS NOT NULL AND unlock_date<=?",(now,)); con.commit()
                return self.send_json({'items':rows(con.execute("SELECT * FROM capsules ORDER BY id DESC"))})
            if path=='/api/curiosities':
                return self.send_json(curiosity_bundle(con))
            if path=='/api/echoes':
                return self.send_json({'items':echo_rows(con,int(q.get('limit',['30'])[0]))})
            if path=='/api/hidden-chapters':
                items=[]
                for r in con.execute('SELECT * FROM hidden_chapters ORDER BY start_month'):
                    d=dict(r); d['dominant_topics']=json.loads(d.pop('dominant_topics_json') or '[]'); items.append(d)
                return self.send_json({'items':items,'shifts':rows(con.execute('SELECT * FROM attention_shifts ORDER BY shift_score DESC LIMIT 12'))})
            if path=='/api/rhythms':
                dense=rows(con.execute("SELECT m.date,m.source_path,mm.char_count FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE m.kind='daily' AND m.date_anomaly=0 ORDER BY mm.char_count DESC LIMIT 12"))
                return self.send_json({'weekdays':rows(con.execute('SELECT * FROM weekday_rhythm ORDER BY weekday')),'gaps':rows(con.execute('SELECT g.*,mp.source_path prev_source,mn.source_path next_source FROM silence_gaps g LEFT JOIN memories mp ON mp.id=g.prev_memory_id LEFT JOIN memories mn ON mn.id=g.next_memory_id ORDER BY gap_days DESC LIMIT 20')),'dense_days':dense})
            if path=='/api/skill-alchemy':
                return self.send_json({'items':rows(con.execute('SELECT * FROM skill_pairs ORDER BY days DESC LIMIT 80')),'note':'共同出现表示同一天都留下活动证据，不表示能力之间存在因果关系。'})
            if path=='/api/first-last':
                return self.send_json({'items':first_last_rows(con,q.get('kind',[None])[0])})
            if path=='/api/question-threads':
                items=[]
                for r in con.execute('SELECT * FROM question_threads ORDER BY span_days DESC,occurrences DESC'):
                    d=dict(r); d['samples']=json.loads(d.pop('samples_json') or '[]'); items.append(d)
                return self.send_json({'items':items,'note':'这些是按可见关键词聚类得到的反复问题候选，不代表问题尚未解决。'})
            if path=='/api/serendipity':
                mode=q.get('mode',['mixed'])[0]
                if mode=='echo':
                    total=con.execute('SELECT COUNT(*) FROM memory_echoes').fetchone()[0]
                    if not total:return self.send_json({'item':None})
                    off=random.randrange(min(total,60)); r=con.execute("SELECT e.*,ml.source_path left_source,mr.source_path right_source FROM memory_echoes e JOIN memories ml ON ml.id=e.left_memory_id JOIN memories mr ON mr.id=e.right_memory_id ORDER BY e.score DESC LIMIT 1 OFFSET ?",(off,)).fetchone(); d=dict(r); d['shared_terms']=json.loads(d.pop('shared_terms_json') or '[]')
                    return self.send_json({'type':'echo','item':d})
                # Mixed mode can also surface one of the deterministic Observatory clues.
                if mode=='mixed' and random.random()<0.48:
                    typ=random.choice(['signal','return','dormant','portrait'])
                    if typ=='signal':
                        x=con.execute('SELECT * FROM trajectory_signals ORDER BY RANDOM() LIMIT 1').fetchone()
                        if x:
                            x=dict(x); return self.send_json({'type':'card','item':{'card_type':'EARLY SIGNAL','title':x['label'],'metric':str(x['lead_days'])+' days before peak','body':x['reason'],'source_paths':[x['first_source']] if x.get('first_source') else [],'payload':x}})
                    if typ=='return':
                        x=con.execute('SELECT r.*,mp.source_path prev_source,mr.source_path return_source FROM return_events r LEFT JOIN memories mp ON mp.id=r.prev_memory_id LEFT JOIN memories mr ON mr.id=r.return_memory_id ORDER BY RANDOM() LIMIT 1').fetchone()
                        if x:
                            x=dict(x); return self.send_json({'type':'card','item':{'card_type':'RETURN','title':x['label']+' came back','metric':str(x['gap_days'])+' quiet days','body':x['prev_date']+' → '+x['return_date']+'. No recorded evidence in between does not mean the activity stopped in real life.','source_paths':[p for p in [x.get('prev_source'),x.get('return_source')] if p],'payload':x}})
                    if typ=='dormant':
                        x=con.execute('SELECT * FROM dormant_threads ORDER BY RANDOM() LIMIT 1').fetchone()
                        if x:
                            x=dict(x); paths=json.loads(x.pop('source_paths_json') or '[]'); return self.send_json({'type':'card','item':{'card_type':'DORMANT THREAD','title':x['anchor'],'metric':str(x['dormant_days'])+' days quiet','body':str(x['occurrences'])+' related '+x['kind']+' candidates were recorded between '+x['first_date']+' and '+x['last_date']+'. Dormant is not the same as unresolved.','source_paths':paths[:2],'payload':x}})
                    if typ=='portrait':
                        x=con.execute('SELECT * FROM month_portraits ORDER BY RANDOM() LIMIT 1').fetchone()
                        if x:
                            x=dict(x); days=json.loads(x.pop('notable_days_json') or '[]'); return self.send_json({'type':'card','item':{'card_type':'MONTH PORTRAIT','title':x['month']+' · '+x['weather'],'metric':str(x['entries'])+' diary days','body':str(x['char_count'])+' characters. The weather label describes writing structure, not personality.','source_paths':[z.get('source_path') for z in days[:2] if z.get('source_path')],'payload':x}})
                r=con.execute('SELECT * FROM curiosity_cards ORDER BY RANDOM() LIMIT 1').fetchone()
                if r:
                    d=dict(r); d['source_paths']=json.loads(d.pop('source_paths_json') or '[]'); d['payload']=json.loads(d.pop('payload_json') or '{}'); return self.send_json({'type':'card','item':d})
                return self.send_json({'item':None})
            if path=='/api/observatory':
                era=con.execute('SELECT * FROM personal_eras ORDER BY start_month').fetchall()
                ret=rows(con.execute('SELECT r.*,mp.source_path prev_source,mr.source_path return_source FROM return_events r LEFT JOIN memories mp ON mp.id=r.prev_memory_id LEFT JOIN memories mr ON mr.id=r.return_memory_id ORDER BY gap_days DESC LIMIT 8'))
                sig=rows(con.execute('SELECT * FROM trajectory_signals ORDER BY lead_days DESC,peak_value DESC LIMIT 8'))
                dorm=[]
                for r in con.execute('SELECT * FROM dormant_threads ORDER BY dormant_days DESC,occurrences DESC LIMIT 8'):
                    x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');dorm.append(x)
                weather=rows(con.execute('SELECT month,weather,avg_chars,reflection_ratio,question_rate,idea_rate FROM voice_monthly ORDER BY month'))
                return self.send_json({'eras_count':len(era),'returns_count':con.execute('SELECT COUNT(*) FROM return_events').fetchone()[0],
                    'dormant_count':con.execute('SELECT COUNT(*) FROM dormant_threads').fetchone()[0],
                    'genealogy_count':con.execute('SELECT COUNT(*) FROM idea_genealogies').fetchone()[0],
                    'bridges_count':con.execute('SELECT COUNT(*) FROM skill_topic_bridges').fetchone()[0],
                    'signals_count':con.execute('SELECT COUNT(*) FROM trajectory_signals').fetchone()[0],
                    'top_returns':ret,'top_signals':sig,'top_dormant':dorm,'weather':weather,
                    'note':'Observatory Layer 使用时间、共现、结构比例与局部窗口做可追溯观察；它提出线索，不自动证明因果、人格或人生阶段。'})
            if path=='/api/eras':
                items=[]
                for r in con.execute('SELECT * FROM personal_eras ORDER BY start_month'):
                    x=dict(r);x['dominant_topics']=json.loads(x.pop('dominant_topics_json') or '[]');x['dominant_skills']=json.loads(x.pop('dominant_skills_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'阶段边界来自月度主题+技能结构变化，只是章节候选。'})
            if path=='/api/returns':
                return self.send_json({'items':rows(con.execute('SELECT r.*,mp.source_path prev_source,mr.source_path return_source FROM return_events r LEFT JOIN memories mp ON mp.id=r.prev_memory_id LEFT JOIN memories mr ON mr.id=r.return_memory_id ORDER BY gap_days DESC LIMIT 120')),
                    'note':'Return 表示某主题/技能在较长无记录区间后再次留下证据；无记录不等于现实中停止。'})
            if path=='/api/dormant-threads':
                items=[]
                for r in con.execute('SELECT * FROM dormant_threads ORDER BY dormant_days DESC,occurrences DESC LIMIT 120'):
                    x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Dormant 只表示在日记中一段时间没有再次出现，不代表“尚未解决”。'})
            if path=='/api/idea-genealogy':
                items=[]
                for r in con.execute('SELECT * FROM idea_genealogies ORDER BY span_days DESC,occurrences DESC LIMIT 80'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');x['samples']=json.loads(x.pop('samples_json') or '[]');x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Idea Genealogy 依据文本相似性连接想法片段，是“可能属于同一想法”的候选链。'})
            if path=='/api/voice-drift':
                return self.send_json({'items':rows(con.execute('SELECT * FROM voice_monthly ORDER BY month')),
                    'note':'这里的 Voice 指写作结构：长度、反思栏目占比、问题/想法/日程密度，不做情绪或人格诊断。'})
            if path=='/api/before-after':
                items=[]
                for r in con.execute('SELECT * FROM before_after_windows ORDER BY anchor_date DESC LIMIT 80'):
                    x=dict(r)
                    for k in ('rising_topics_json','falling_topics_json','rising_skills_json','falling_skills_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'事件前后各 30 天的结构差异仅表示时间邻近，不表示事件导致了变化。'})
            if path=='/api/skill-bridges':
                return self.send_json({'items':rows(con.execute('SELECT * FROM skill_topic_bridges ORDER BY days DESC LIMIT 160')),
                    'note':'Bridge 表示某技能与某生活主题在同一天共同留下证据。'})
            if path=='/api/month-portraits':
                items=[]
                for r in con.execute('SELECT * FROM month_portraits ORDER BY month'):
                    x=dict(r);x['dominant_topics']=json.loads(x.pop('dominant_topics_json') or '[]');x['dominant_skills']=json.loads(x.pop('dominant_skills_json') or '[]');x['notable_days']=json.loads(x.pop('notable_days_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Month Portrait 是当月结构化索引，不是 AI 对月份意义的总结。'})
            if path=='/api/archive-health':
                return self.send_json({'items':rows(con.execute('SELECT * FROM archive_health ORDER BY key'))})
            if path=='/api/early-signals':
                return self.send_json({'items':rows(con.execute('SELECT * FROM trajectory_signals ORDER BY lead_days DESC,peak_value DESC LIMIT 120')),
                    'note':'Early Signal 指“第一次留下记录”早于后来的月度峰值；First recorded ≠ first in life。'})
            if path=='/api/timefold':
                return self.send_json(timefold_bundle(con))
            if path=='/api/growth-rings':
                items=[]
                for r in con.execute('SELECT * FROM growth_rings ORDER BY month'):
                    x=dict(r)
                    for k in ('new_skills_json','new_topics_json','new_places_json','new_roles_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'Growth Rings show when tracked categories first became visible in the archive. “Newly recorded” is not “newly acquired in life”.'})
            if path=='/api/novelty-atlas':
                items=[]
                for r in con.execute('SELECT * FROM novelty_days ORDER BY novelty_score DESC LIMIT 120'):
                    x=dict(r);x['new_terms']=json.loads(x.pop('new_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Novelty compares visible lexical anchors with the preceding 90 recorded days. Different language/topics ≠ psychological change.'})
            if path=='/api/bridge-days':
                items=[]
                for r in con.execute('SELECT * FROM bridge_days ORDER BY bridge_score DESC LIMIT 120'):
                    x=dict(r);x['labels']=json.loads(x.pop('labels_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Bridge Days connect several tracked domains in one dated source. More domains ≠ more important day.'})
            if path=='/api/attention-portfolio':
                items=[]
                for r in con.execute('SELECT * FROM attention_portfolio ORDER BY month'):
                    x=dict(r);x['top_topics']=json.loads(x.pop('top_topics_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Entropy describes how concentrated the recorded topic mix was in a month. It is not a measure of focus quality or actual time spent.'})
            if path=='/api/promise-ledger':
                status=q.get('status',[None])[0]
                sql='SELECT * FROM promise_ledger';params=[]
                if status: sql+=' WHERE status=?';params.append(status)
                sql+=' ORDER BY date DESC LIMIT 240'
                items=[]
                for r in con.execute(sql,params):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Future-facing statement candidates. “Echoed” means related language reappeared later; it does not mean the plan was completed.'})
            if path=='/api/future-echoes':
                items=[]
                for r in con.execute('SELECT * FROM future_echoes ORDER BY score DESC,gap_days DESC LIMIT 100'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A later passage shares meaningful anchors with an earlier future-facing statement. This is resonance, not prediction accuracy.'})
            if path=='/api/identity-ledger':
                typ=q.get('type',[None])[0];sql='SELECT * FROM identity_ledger';params=[]
                if typ:sql+=' WHERE identity_type=?';params.append(typ)
                sql+=' ORDER BY date DESC LIMIT 220'
                return self.send_json({'items':rows(con.execute(sql,params)),'note':'Only explicit self-descriptions are included. LifeOS does not infer identity from unrelated behavior.'})
            if path=='/api/motif-atlas':
                items=[]
                for r in con.execute('SELECT * FROM motif_atlas ORDER BY echo_pairs DESC,span_days DESC LIMIT 120'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Motifs aggregate repeated terms found in distant Memory Echo pairs. A lexical motif is not a hidden psychological theme.'})
            if path=='/api/turning-points':
                items=[]
                for r in con.execute('SELECT * FROM turning_points ORDER BY score DESC LIMIT 100'):
                    x=dict(r);x['signals']=json.loads(x.pop('signals_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Turning Point Index is a review queue built from structural density, novelty, cross-domain bridges, decisions, milestones and ideas. It does not claim causality.'})
            if path=='/api/thread-reopenings':
                items=[]
                for r in con.execute('SELECT * FROM thread_reopenings ORDER BY score DESC,gap_days DESC LIMIT 120'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A later idea/question/project resembles an earlier one after a long interval. It may be a reopening, continuation, or coincidence—not proof of closure.'})
            if path=='/api/skill-momentum':
                return self.send_json({'items':rows(con.execute("SELECT * FROM skill_momentum ORDER BY CASE status WHEN 'warming' THEN 0 WHEN 'newly-visible' THEN 1 WHEN 'steady' THEN 2 WHEN 'cooling' THEN 3 ELSE 4 END, momentum DESC")),'note':'Momentum compares recorded evidence-day rates in the latest 60 days against the preceding 180 days. It is visibility/activity, not competence.'})
            if path=='/api/seasonal-echoes':
                items=[]
                for r in con.execute('SELECT * FROM seasonal_echoes ORDER BY calendar_month'):
                    x=dict(r)
                    for k in ('rising_topics_json','falling_topics_json','rising_skills_json','falling_skills_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'Same calendar month across two recorded years. Differences reflect the archive, not a seasonal cause.'})
            if path=='/api/mirror':
                return self.send_json(mirror_bundle(con))
            if path=='/api/intention-outcome':
                status=rows(con.execute("SELECT CASE WHEN echo_count>0 THEN 'later echo' ELSE 'no tracked echo' END status,COUNT(*) count FROM promise_ledger GROUP BY status"))
                return self.send_json({'status':status,'closures':con.execute('SELECT COUNT(*) FROM closure_candidates').fetchone()[0],'note':'Later echo and closure candidate are retrieval signals only. They do not prove a plan was completed.'})
            if path=='/api/closure-candidates':
                items=[]
                for r in con.execute('SELECT * FROM closure_candidates ORDER BY score DESC,gap_days ASC LIMIT 120'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Earlier future-facing language paired with later milestone/project candidates using visible lexical anchors. Manual review required.'})
            if path=='/api/friction-atlas':
                items=[]
                for r in con.execute('SELECT * FROM friction_statements ORDER BY date DESC LIMIT 220'):
                    x=dict(r);x['anchors']=json.loads(x.pop('anchors_json') or '[]');items.append(x)
                markers=rows(con.execute('SELECT marker,COUNT(*) count,MIN(date) first_date,MAX(date) last_date FROM friction_statements GROUP BY marker ORDER BY count DESC'))
                return self.send_json({'items':items,'markers':markers,'note':'Only explicit friction-like wording is surfaced. LifeOS does not infer stress, mental state, or severity.'})
            if path=='/api/personal-protocols':
                items=[]
                for r in con.execute('SELECT * FROM protocol_statements ORDER BY date DESC LIMIT 240'):
                    x=dict(r);x['anchors']=json.loads(x.pop('anchors_json') or '[]');items.append(x)
                threads=[]
                for r in con.execute('SELECT * FROM protocol_threads ORDER BY span_days DESC,occurrences DESC LIMIT 80'):
                    x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');threads.append(x)
                return self.send_json({'items':items,'threads':threads,'note':'Rule-like language such as “我应该 / 我需要 / 不要 / 下次要”. Repetition does not mean compliance or current endorsement.'})
            if path=='/api/boundary-ledger':
                items=[]
                for r in con.execute('SELECT * FROM boundary_statements ORDER BY date DESC LIMIT 220'):
                    x=dict(r);x['anchors']=json.loads(x.pop('anchors_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Only explicit negative preferences/boundaries are shown. These are dated statements, not permanent traits.'})
            if path=='/api/quiet-priorities':
                return self.send_json({'items':rows(con.execute('SELECT * FROM quiet_priorities ORDER BY quiet_score DESC LIMIT 100')),'note':'Historically visible topics/skills that are less visible in the latest 90 days. Quiet ≠ neglected or abandoned.'})
            if path=='/api/idea-survival':
                items=[]
                for r in con.execute('SELECT * FROM idea_survival ORDER BY span_days DESC,occurrences DESC LIMIT 100'):
                    x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Recurring idea anchors across time. Project/milestone echoes are literal-match hints, not implementation proof.'})
            if path=='/api/milestone-leadups':
                items=[]
                for r in con.execute('SELECT * FROM milestone_leadups ORDER BY score DESC,lag_days DESC LIMIT 100'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Prior idea/project candidate linked to a later milestone candidate by shared visible anchors. This is documented lead-up, not effort or causality.'})
            if path=='/api/decision-replays':
                items=[]
                for r in con.execute('SELECT * FROM decision_replays ORDER BY decision_date DESC LIMIT 100'):
                    x=dict(r)
                    for k in ('before_topics_json','after_topics_json','before_skills_json','after_skills_json','rising_topics_json','rising_skills_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'±30-day context around explicit decision language. Changes after the date are not attributed to the decision.'})
            if path=='/api/fork-replays':
                items=[]
                for r in con.execute('SELECT * FROM fork_replays ORDER BY gap_days DESC LIMIT 100'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A fork-like sentence and a later related project/milestone candidate. The unchosen alternative remains unknown.'})
            if path=='/api/identity-mirror':
                items=[]
                for r in con.execute('SELECT * FROM identity_mirror ORDER BY date DESC LIMIT 160'):
                    x=dict(r);x['nearby_topics']=json.loads(x.pop('nearby_topics_json') or '[]');x['nearby_skills']=json.loads(x.pop('nearby_skills_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Same-source context around an explicit self-description. Context is not validation of identity.'})
            if path=='/api/completion-texture':
                items=[]
                for r in con.execute('SELECT * FROM completion_texture ORDER BY milestone_count DESC LIMIT 100'):
                    x=dict(r);x['examples']=json.loads(x.pop('examples_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Counts milestone-candidate sentences on dates where a topic/skill was also visible. Co-occurrence ≠ cause.'})
            if path=='/api/compass':
                return self.send_json(compass_bundle(con))
            if path=='/api/learning-loops':
                items=[]
                for r in con.execute('SELECT * FROM learning_loops ORDER BY score DESC,gap_days DESC LIMIT 140'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Question → later trace candidates use specific visible anchors. A loop does not prove the question caused or solved the later action.'})
            if path=='/api/skill-transfer-trails':
                items=[]
                for r in con.execute('SELECT * FROM skill_transfer_trails ORDER BY evidence_days DESC,span_days DESC LIMIT 180'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Cross-category skills visible on the same dated sources. Co-occurrence is a transfer trail candidate, not proof that one skill produced another.'})
            if path=='/api/social-gravity':
                items=[]
                for r in con.execute('SELECT * FROM social_gravity ORDER BY evidence_days DESC LIMIT 220'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Role × context co-occurrence in dated sources. It describes what is written around a role, not the quality or cause of a relationship.'})
            if path=='/api/place-imprints':
                items=[]
                for r in con.execute('SELECT * FROM place_imprints ORDER BY evidence_days DESC LIMIT 220'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Place × topic/skill co-occurrence in dated sources. A place imprint is recorded context, not what the place caused.'})
            if path=='/api/focus-bursts':
                items=[]
                for r in con.execute('SELECT * FROM focus_bursts ORDER BY density DESC,evidence_days DESC LIMIT 180'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Compact runs of repeated topic/skill visibility. Density is an archive signal, not effort, productivity or importance.'})
            if path=='/api/visibility-arcs':
                items=[]
                for r in con.execute('SELECT * FROM visibility_arcs ORDER BY peak_days DESC,months_visible DESC LIMIT 160'):
                    x=dict(r);x['monthly']=json.loads(x.pop('monthly_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Monthly evidence arcs. Peak, quiet and reappearance refer to the archive only; they do not prove real-world interest or competence changed.'})
            if path=='/api/after-friction':
                items=[]
                for r in con.execute('SELECT * FROM friction_followthrough ORDER BY score DESC,gap_days ASC LIMIT 120'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'An explicit friction sentence followed by a later related action/milestone candidate. This is follow-through context, not emotional recovery or causality.'})
            if path=='/api/forgotten-doors':
                return self.send_json({'items':rows(con.execute('SELECT * FROM forgotten_doors ORDER BY days_since DESC LIMIT 100')),'note':'Old idea/question candidates with little later lexical trace. They may be forgotten, completed elsewhere, intentionally abandoned, or simply described differently later.'})
            if path=='/api/revision-trails':
                items=[]
                for r in con.execute('SELECT * FROM revision_trails ORDER BY span_days DESC,occurrences DESC LIMIT 120'):
                    x=dict(r);x['samples']=json.loads(x.pop('samples_json') or '[]');x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Repeated explicit belief/protocol/identity language around the same direct label or phrase. LifeOS does not decide whether the later statement confirms, refines or rejects the earlier one.'})
            if path=='/api/evidence-gaps':
                items=[]
                for r in con.execute("SELECT * FROM evidence_gaps ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,gap_type,label"):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Evidence Gaps is a restraint layer: situations where LifeOS should explicitly avoid strong claims until more or cleaner evidence exists.'})
            if path=='/api/compass-questions':
                items=[]
                for r in con.execute('SELECT * FROM compass_questions ORDER BY priority DESC LIMIT 40'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Questions are generated locally from evidence patterns. They are invitations to inspect the archive, not inferred answers.'})
            if path=='/api/orientation-cards':
                items=[]
                for r in con.execute('SELECT * FROM orientation_cards ORDER BY id'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');x['payload']=json.loads(x.pop('payload_json') or '{}');items.append(x)
                return self.send_json({'items':items,'note':'A compact orientation deck derived from the Compass tables.'})
            if path=='/api/footprint':
                return self.send_json(footprint_bundle(con))
            if path=='/api/artifact-ledger':
                items=[]
                for r in con.execute('SELECT * FROM artifact_ledger ORDER BY date DESC,id DESC LIMIT 240'):
                    x=dict(r);x['matched_terms']=json.loads(x.pop('matched_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Explicit output-oriented wording paired with an artifact term. Candidate status is intentionally conservative: a trace is not a quality, effort, authorship or impact score.'})
            if path=='/api/output-trails':
                items=[]
                for r in con.execute('SELECT * FROM output_trails ORDER BY span_days DESC,recorded_days DESC'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Longitudinal artifact-category traces. A repeated category may represent multiple different artifacts.'})
            if path=='/api/sharing-trails':
                items=[]
                for r in con.execute('SELECT * FROM sharing_trails ORDER BY date DESC LIMIT 180'):
                    x=dict(r);x['audiences']=json.loads(x.pop('audiences_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Explicit outward sharing candidates in work/artifact contexts. Sharing does not prove reception, reuse or influence.'})
            if path=='/api/handoff-moments':
                items=[]
                for r in con.execute('SELECT * FROM handoff_moments ORDER BY date DESC LIMIT 180'):
                    x=dict(r);x['audiences']=json.loads(x.pop('audiences_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':"Transfer/handoff wording such as 交给/提交/上传/发给/对接/汇报. The recipient's actual use remains unknown."})
            if path=='/api/audience-map':
                items=[]
                for r in con.execute('SELECT * FROM audience_map ORDER BY evidence_days DESC,mentions DESC'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Who/which role was visible around explicit sharing traces. It is not audience size or relationship strength.'})
            if path=='/api/feedback-echoes':
                return self.send_json({'items':rows(con.execute('SELECT * FROM feedback_echoes ORDER BY date DESC LIMIT 180')),'note':'Explicit feedback-like wording paired to a nearby artifact category when possible. Pairing is a review cue, not proof of exact reference.'})
            if path=='/api/external-validation':
                return self.send_json({'items':rows(con.execute("SELECT * FROM external_validation ORDER BY date DESC LIMIT 160")),'note':'Explicit recognition/acceptance/award-like wording. Future plans and generic praise are not supposed to become universal quality scores.'})
            if path=='/api/reuse-trails':
                items=[]
                for r in con.execute('SELECT * FROM reuse_trails ORDER BY span_days DESC,recorded_days DESC'):
                    x=dict(r);x['return_gaps']=json.loads(x.pop('return_gaps_json') or '[]');x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'An artifact category reappeared after long gaps. It may be reuse, revisiting, or a different artifact of the same type.'})
            if path=='/api/learning-output':
                items=[]
                for r in con.execute("SELECT * FROM learning_output_links WHERE skill NOT IN ('Writing','Reflection') ORDER BY output_days DESC,linked_outputs DESC LIMIT 180"):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Skill evidence visible during the 30 days before output traces. Temporal proximity is not attribution or causality.'})
            if path=='/api/artifact-leadups':
                items=[]
                for r in con.execute('SELECT * FROM artifact_leadups ORDER BY date DESC LIMIT 160'):
                    x=dict(r);x['top_skills']=json.loads(x.pop('top_skills_json') or '[]');x['top_topics']=json.loads(x.pop('top_topics_json') or '[]');x['prior_source_paths']=json.loads(x.pop('prior_source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A 14-day context window before explicit create/submit/publish traces. Context is not proof of effort or cause.'})
            if path=='/api/contribution-threads':
                items=[]
                for r in con.execute('SELECT * FROM contribution_threads ORDER BY span_days DESC,recorded_days DESC'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');x['sample_texts']=json.loads(x.pop('sample_texts_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Repeated explicit outward helping/sharing traces in work/learning contexts. This is not an impact, generosity or social-value score.'})
            if path=='/api/legacy-questions':
                items=[]
                for r in con.execute('SELECT * FROM legacy_questions ORDER BY priority DESC LIMIT 40'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Questions generated from footprint structure only. No answer is generated until you explicitly ask.'})
            if path=='/api/topology':
                return self.send_json(topology_bundle(con))
            if path=='/api/life-neighborhoods':
                items=[]
                for r in con.execute('SELECT * FROM life_neighborhoods ORDER BY edge_weight DESC,node_count DESC'):
                    x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');x['top_months']=json.loads(x.pop('top_months_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Neighborhoods are locally detected co-occurrence communities. They are navigation clusters, not hidden personality categories.'})
            if path=='/api/gateway-nodes':
                items=[]
                for r in con.execute('SELECT * FROM gateway_nodes ORDER BY gateway_score DESC LIMIT 160'):
                    x=dict(r);x['sample_neighbors']=json.loads(x.pop('sample_neighbors_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Gateways connect graph neighborhoods in the archive. High gateway score means cross-neighborhood co-occurrence, not real-world importance or influence.'})
            if path=='/api/topology-bridge-memories':
                items=[]
                for r in con.execute('SELECT * FROM bridge_memories_topology ORDER BY bridge_score DESC LIMIT 160'):
                    x=dict(r);x['nodes']=json.loads(x.pop('nodes_json') or '[]');x['communities']=json.loads(x.pop('communities_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Bridge memories touch several graph neighborhoods on one dated source. Structural density is not subjective importance.'})
            if path=='/api/context-signatures':
                items=[]
                for r in con.execute('SELECT * FROM context_signatures ORDER BY evidence_days DESC'):
                    x=dict(r)
                    for k in ('top_nodes_json','top_roles_json','top_places_json','top_months_json'): x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'A neighborhood signature summarizes what is commonly visible in its dated sources. It does not define you.'})
            if path=='/api/transition-matrix':
                items=[]
                for r in con.execute('SELECT * FROM transition_matrix ORDER BY transition_days DESC,probability DESC'):
                    x=dict(r);x['sample_dates']=json.loads(x.pop('sample_dates_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Observed nearby-day context transitions. The matrix describes sequence in the archive and is neither causality nor prediction.'})
            if path=='/api/cooccurrence-surprises':
                items=[]
                for r in con.execute('SELECT * FROM cooccurrence_surprises ORDER BY lift DESC,evidence_days DESC LIMIT 180'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Lift compares observed same-day pairing with a simple independence baseline. Sparse pairs can have high lift; reread the sources before interpreting.'})
            if path=='/api/rare-pairings':
                items=[]
                for r in con.execute('SELECT * FROM rare_pairings ORDER BY lift DESC,evidence_days DESC LIMIT 160'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Rare Pairings are sparse, concentrated co-occurrences. They are curiosity prompts, not proof of a meaningful relationship.'})
            if path=='/api/orphan-islands':
                items=[]
                for r in con.execute('SELECT * FROM orphan_islands ORDER BY evidence_days DESC,weighted_degree ASC'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Weakly connected nodes may be under-recorded, truly isolated, or described with different language elsewhere.'})
            if path=='/api/topology-anchor-memories':
                items=[]
                for r in con.execute('SELECT * FROM anchor_memories_topology ORDER BY anchor_score DESC LIMIT 160'):
                    x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Anchor Memories are structurally central dated sources. Centrality is not the same as personal importance.'})
            if path=='/api/neighborhood-drift':
                items=[]
                for r in con.execute('SELECT * FROM neighborhood_drift ORDER BY month'):
                    x=dict(r);x['shares']=json.loads(x.pop('shares_json') or '[]');x['prev_shares']=json.loads(x.pop('prev_shares_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Monthly drift compares archive-neighborhood distributions. It is a change in recorded context, not a claim that identity changed.'})
            if path=='/api/context-switches':
                items=[]
                for r in con.execute('SELECT * FROM context_switches ORDER BY date DESC LIMIT 180'):
                    x=dict(r);x['nodes']=json.loads(x.pop('nodes_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A context switch means the dominant graph neighborhood changed between nearby recorded days. It is not a mood or identity switch.'})
            if path=='/api/life-routes':
                items=[]
                for r in con.execute('SELECT * FROM life_routes ORDER BY occurrences DESC,last_start DESC'):
                    x=dict(r);x['route']=json.loads(x.pop('route_json') or '[]');x['route_labels']=json.loads(x.pop('route_labels_json') or '[]');x['sample_starts']=json.loads(x.pop('sample_starts_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Life Routes are repeated three-record sequences of dominant archive neighborhoods. They do not predict what comes next.'})

            if path=='/api/lineage':
                return self.send_json(lineage_bundle(con))
            if path=='/api/thought-artifact-trails':
                items=[]
                for r in con.execute('SELECT * FROM thought_artifact_trails ORDER BY score DESC,gap_days ASC LIMIT 220'):
                    x=dict(r);x['shared_anchors']=json.loads(x.pop('shared_anchors_json') or '[]');x['shared_context']=json.loads(x.pop('shared_context_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Idea/future-facing sentence → later artifact trace candidates. Shared anchors/context plus time order are review cues, not implementation proof or causality.'})
            if path=='/api/project-artifact-families':
                items=[]
                for r in con.execute('SELECT * FROM project_artifact_families ORDER BY artifact_days DESC,project_candidate_days DESC'):
                    x=dict(r);x['shared_context']=json.loads(x.pop('shared_context_json') or '[]');x['project_sources']=json.loads(x.pop('project_sources_json') or '[]');x['artifact_sources']=json.loads(x.pop('artifact_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Artifact-category families built from project-candidate text sharing explicit artifact vocabulary. A family may contain several unrelated real-world projects.'})
            if path=='/api/artifact-ancestry':
                return self.send_json({'items':rows(con.execute('SELECT * FROM artifact_ancestry ORDER BY to_date DESC LIMIT 240')),'note':'Adjacent traces within one artifact category. Adjacency does not prove exact version/file ancestry.'})
            if path=='/api/version-trees':
                items=[]
                for r in con.execute('SELECT * FROM version_trees ORDER BY recorded_days DESC,events DESC'):
                    x=dict(r);x['action_sequence']=json.loads(x.pop('action_sequence_json') or '[]');x['transition_counts']=json.loads(x.pop('transition_counts_json') or '[]');x['branch_points']=json.loads(x.pop('branch_points_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Category-level create/revise/submit/publish/share sequences. They are not reconstructed Git histories.'})
            if path=='/api/idea-output-latency':
                items=[]
                for r in con.execute('SELECT * FROM idea_output_latency ORDER BY links DESC,median_days DESC'):
                    x=dict(r);x['sample_links']=json.loads(x.pop('sample_links_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Calendar gap between conservatively linked idea-like and artifact traces. This is not time-to-build.'})
            if path=='/api/lineage-feedback-loops':
                return self.send_json({'items':rows(con.execute('SELECT * FROM lineage_feedback_loops ORDER BY score DESC,feedback_date DESC LIMIT 180')),'note':'Artifact → feedback → optional revision sequences. Time/type proximity does not prove the feedback referred to or caused the revision.'})
            if path=='/api/rework-cycles':
                items=[]
                for r in con.execute('SELECT * FROM rework_cycles ORDER BY revision_days DESC,span_days DESC LIMIT 160'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');x['sample_texts']=json.loads(x.pop('sample_texts_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Clusters of revise-like traces within 30-day gaps. A cluster can span multiple artifacts in the same category.'})
            if path=='/api/cross-pollination':
                items=[]
                for r in con.execute('SELECT * FROM cross_pollination ORDER BY nearby_pairs DESC,shared_days DESC LIMIT 180'):
                    x=dict(r);x['shared_skills']=json.loads(x.pop('shared_skills_json') or '[]');x['shared_topics']=json.loads(x.pop('shared_topics_json') or '[]');x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Two artifact categories appeared within seven days of each other. Proximity is a cross-reading prompt, not influence or causation.'})
            if path=='/api/first-proofs':
                return self.send_json({'items':rows(con.execute('SELECT * FROM first_proofs ORDER BY date')),'note':'Earliest conservative completed/outward marker recorded for an artifact category. First recorded ≠ first in real life.'})
            if path=='/api/unfinished-lineages':
                items=[]
                for r in con.execute('SELECT * FROM unfinished_lineages ORDER BY days_since DESC,occurrences DESC LIMIT 120'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');x['sample_texts']=json.loads(x.pop('sample_texts_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Repeated idea/project-like threads that later became quiet without a confidently traced output in this layer. Untraced does not mean unfinished in life.'})
            if path=='/api/release-cadence':
                items=[]
                for r in con.execute('SELECT * FROM release_cadence ORDER BY outbound_events DESC,active_months DESC'):
                    x=dict(r);x['monthly']=json.loads(x.pop('monthly_json') or '[]');x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Spacing of submit/publish/share traces. Cadence is archive timing, not productivity or shipping speed.'})
            if path=='/api/evidence-chains':
                items=[]
                for r in con.execute('SELECT * FROM evidence_chains ORDER BY score DESC,span_days DESC LIMIT 140'):
                    x=dict(r);x['steps']=json.loads(x.pop('steps_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Source-backed multi-step review chains. Missing steps remain missing; sequence is not a causal narrative.'})
            if path=='/api/settings':
                return self.send_json({'items':{r['key']:r['value'] for r in con.execute("SELECT * FROM app_settings")},'product':product.settings_dict(ROOT)})
            return self.send_json({'error':'unknown endpoint'},404)
        finally:
            con.close()
    def api_post(self,path,b):
        con=db()
        try:
            if path=='/api/entries/save':
                date=(b.get('journal_date') or '').strip();sections=b.get('sections') or {}
                out=product.save_entry(journal_date=date,sections=sections,entry_id=b.get('entry_id'),title=b.get('title') or '',tags=b.get('tags') or [],timezone=b.get('timezone') or '',source='writer',note=b.get('note') or '',root=ROOT,raw_markdown=b.get('raw_markdown'))
                idx=reindex_paths([out['source_path']],root=ROOT,deleted_paths=[out['old_source_path']] if out.get('old_source_path') else []) if (not out.get('unchanged') or out.get('old_source_path')) else {'changed':[]}
                return self.send_json({'ok':True,'result':out,'index':idx,'core':product.core_status(ROOT)})
            if path=='/api/revisions/restore':
                out=product.restore_revision(b.get('entry_id',''),b.get('revision_id',''),ROOT);idx=reindex_paths([out['source_path']],root=ROOT)
                return self.send_json({'ok':True,'result':out,'index':idx})
            if path=='/api/attachments':
                raw=base64.b64decode(b.get('data_base64') or '')
                out=product.add_attachment(b.get('entry_id',''),b.get('name') or 'attachment',raw,b.get('mime_type'),b.get('revision_id'),ROOT)
                return self.send_json({'ok':True,'attachment':out})
            if path=='/api/import/preview':
                return self.send_json(import_pipeline.preview_import(b.get('files') or [],b.get('source_name') or 'browser import',ROOT))
            if path=='/api/import/commit':
                return self.send_json(import_pipeline.commit_import(b.get('job_id',''),b.get('overrides') or {},ROOT))
            if path=='/api/import/rollback':
                return self.send_json(import_pipeline.rollback_import(b.get('job_id',''),ROOT))
            if path=='/api/backups/create':
                return self.send_json(product.create_backup(b.get('reason') or 'manual',ROOT,bool(b.get('include_derived'))))
            if path=='/api/backups/restore':
                return self.send_json(product.restore_backup(b.get('backup_id',''),ROOT))
            if path=='/api/product/settings':
                product.set_settings(b.get('items') or {},ROOT);return self.send_json({'ok':True,'items':product.settings_dict(ROOT)})
            if path=='/api/pets/install':
                return self.send_json({'ok':True,'result':install_pet(b.get('slug')),'pets':pet_status()})
            if path=='/api/pets/activate':
                slug=str(b.get('slug') or '')
                if not any(item['slug']==slug for item in pet_local_items()): return self.send_json({'error':'pet is not installed'},404)
                product.set_settings({'pet.active_slug':slug},ROOT)
                return self.send_json({'ok':True,'pets':pet_status()})
            if path=='/api/pets/uninstall':
                return self.send_json({'ok':True,'result':uninstall_pet(b.get('slug')),'pets':pet_status()})
            if path=='/api/pets/chat':
                try:
                    result=pet_companion_chat(b.get('messages') or [])
                    if result is None:
                        return self.send_json({'error':'桌宠对话尚未启用。请在隐私设置中确认 DeepSeek 已配置并允许远端请求。'},409)
                    return self.send_json({'ok':True,'reply':str(result.get('text') or '').strip(),'provider':result.get('provider'),'model':result.get('model'),'remote':True,'note':'仅发送本次对话文字；不会读取、检索或写入日记。'})
                except ValueError as e:
                    return self.send_json({'error':str(e)},400)
                except Exception:
                    return self.send_json({'error':'桌宠暂时没有连上模型，请稍后再试。'},502)
            if path=='/api/refresh/derived':
                product.request_derived_refresh(b.get('reason') or 'manual refresh',ROOT)
                if b.get('run_now'):
                    return self.send_json(run_one_pending_refresh(ROOT))
                return self.send_json({'ok':True,'status':product.derived_refresh_status(ROOT)})
            if path=='/api/ai/settings':
                allowed={'ai.mode','ai.enabled','ai.allow_remote','ai.payload_preview','ai.cache','ai.provider','ai.model','ai.base_url','ai.embed_model'};items={k:v for k,v in (b.get('items') or {}).items() if k in allowed};product.set_settings(items,ROOT);return self.send_json({'ok':True,'status':ai_providers.privacy_status()})
            if path=='/api/ai/key':
                provider=(b.get('provider') or product.get_setting('ai.provider','deepseek',ROOT)).strip();key=(b.get('key') or '').strip()
                if not key:return self.send_json({'error':'key required'},400)
                result=set_secret(f'ai.{provider}.api_key',key,ROOT);return self.send_json({'ok':True,'storage':result.get('storage'),'status':ai_providers.privacy_status()})
            if path=='/api/sync/register':
                return self.send_json(sync_engine.register_account(b.get('url') or '',b.get('email') or '',b.get('password') or '',ROOT))
            if path=='/api/sync/login':
                return self.send_json(sync_engine.login_account(b.get('url') or '',b.get('email') or '',b.get('password') or '',ROOT))
            if path=='/api/sync/config':
                return self.send_json(sync_engine.configure(b.get('url') or '',b.get('token'),bool(b.get('enabled',True)),ROOT))
            if path=='/api/sync/run':
                return self.send_json(sync_engine.sync_once(ROOT))
            if path=='/api/sync/conflict':
                out=product.resolve_sync_conflict(b.get('conflict_id',''),b.get('choice',''),ROOT)
                if out.get('result') and out['result'].get('source_path'):reindex_paths([out['result']['source_path']],root=ROOT)
                return self.send_json(out)
            if path=='/api/inbox/add':
                return self.send_json({'ok':True,'item':p2_core.add_inbox_item(b.get('item_type') or 'text',b.get('title') or '',b.get('body') or '',b.get('source') or 'local',b.get('source_ref') or '',b.get('attachment_ids') or [],b.get('metadata') or {},None,ROOT)})
            if path=='/api/inbox/status':
                return self.send_json({'ok':True,'item':p2_core.update_inbox_status(b.get('inbox_id',''),b.get('status','pending'),None,ROOT)})
            if path=='/api/inbox/convert':
                out=p2_core.convert_inbox_to_entry(b.get('inbox_id',''),b.get('journal_date'),b.get('title'),ROOT);idx=reindex_paths([out['entry']['source_path']],root=ROOT);return self.send_json({'ok':True,'result':out,'index':idx})
            if path=='/api/notifications/preferences':
                return self.send_json({'ok':True,'preferences':p2_core.set_notification_preferences(bool(b.get('enabled',True)),b.get('quiet_start'),b.get('quiet_end'),b.get('kinds') or [],ROOT)})
            if path=='/api/notifications/read':
                return self.send_json(p2_core.mark_notification(b.get('notification_id',''),'read',ROOT))
            if path=='/api/marketplace/install':
                return self.send_json(p2_core.install_addon(b.get('manifest') or {},b.get('addon_type') or '',b.get('source') or 'local',ROOT))
            if path=='/api/connectors/run':
                kind=b.get('kind') or '';conn=CONNECTORS.get(kind)
                if not conn:return self.send_json({'error':'unknown connector'},404)
                drafts=list(conn.ingest(b.get('payload') or ''));items=[p2_core.add_inbox_item(x.item_type,x.title,x.body,x.source,x.source_ref,x.attachments,x.metadata,None,ROOT) for x in drafts];return self.send_json({'ok':True,'count':len(items),'items':items})
            if path=='/api/encryption/create':
                key=crypto_vault.create_recovery_key(ROOT);return self.send_json({'ok':True,'recovery_key':key,'warning':'Store this recovery key somewhere safe. LifeOS Cloud cannot recover it.','status':crypto_vault.status(ROOT)})
            if path=='/api/encryption/import':
                return self.send_json({'ok':True,'status':crypto_vault.import_recovery_key(b.get('recovery_key') or '',ROOT)})
            if path=='/api/encryption/export':
                return self.send_json({'recovery_key':crypto_vault.export_recovery_key(ROOT),'warning':'Anyone with this key can decrypt your E2EE sync payloads.'})
            if path=='/api/encryption/disable':
                return self.send_json({'ok':True,'status':crypto_vault.disable(ROOT,bool(b.get('forget_key')), )})
            if path=='/api/p2/pull':
                return self.send_json({'ok':True,'result':p2_sync.pull_extras(ROOT)})
            if path=='/api/share/create':
                return self.send_json(p2_sync.create_share(b.get('entry_id',''),b.get('revision_id'),b.get('expires_in_days',30),b.get('title'),ROOT))
            if path=='/api/share/revoke':
                return self.send_json(p2_sync.revoke_share(b.get('share_id',''),ROOT))
            if path=='/api/cloud-ai':
                return self.send_json(p2_sync.cloud_ai(b.get('messages') or [],b.get('feature') or 'desktop-cloud-ai',ROOT))
            if path=='/api/classical-chinese':
                text=(b.get('text') or '').strip()
                if not text: return self.send_json({'error':'text required'},400)
                if len(text)>20000: return self.send_json({'error':'text too long; keep one conversion under 20,000 characters'},400)
                style=b.get('style') if b.get('style') in CLASSICAL_STYLE_LABELS else 'qingjian'
                strength=b.get('strength') if b.get('strength') in CLASSICAL_STRENGTH_LABELS else 'medium'
                engine=b.get('engine') or 'local'
                remote=False
                note='本地机械草译：完全离线，仅做保守词汇/句式替换；请以原文为事实依据。'
                if engine=='model':
                    result=call_classical_chinese(text,style,strength)
                    if isinstance(result,dict) and result.get('error'):
                        return self.send_json({'error':'模型调用失败：'+result['error']},502)
                    if result is None:
                        output=local_classical_draft(text,style,strength)
                        mode='local_fallback'
                        mode_label='AI 未启用/未配置 · 已回退本地草译'
                        note='没有文本被发送到外部模型。以下仅为本地机械草译。'
                    else:
                        output=(result.get('text') or '').strip()
                        remote=True
                        mode='remote_model'
                        mode_label='AI 文言化'
                        note=f"仅本次输入文本被发送给 {result.get('provider')} / {result.get('model')}；转换结果不会写回 Vault。"
                else:
                    output=local_classical_draft(text,style,strength)
                    mode='local_draft'
                    mode_label='本地草译'
                return self.send_json({'output':output,'mode':mode,'mode_label':mode_label,'remote':remote,'style':style,'style_label':CLASSICAL_STYLE_LABELS[style],'strength':strength,'strength_label':CLASSICAL_STRENGTH_LABELS[strength],'note':note})
            if path=='/api/ask':
                q=(b.get('question') or '').strip()
                if not q: return self.send_json({'error':'question required'},400)
                ret=retrieve(con,q,int(b.get('limit',12)),b.get('cutoff'))
                ret=filter_selected_evidence(ret,b.get('selected_keys') or [])
                health=evidence_health(ret); ret['evidence_health']=health
                stage=b.get('stage') or 'answer'
                if stage=='retrieve':
                    answer={'mode':'evidence_review','text':'Evidence pack ready for review. Nothing has been interpreted yet.'}
                    return self.send_json({'answer':answer,**ret})
                if health['status'] in ('insufficient','thin') and not b.get('force_limited'):
                    answer={'mode':'insufficient_evidence','text':'当前证据包过薄，LifeOS 暂不调用模型生成解释。你可以调整问题、补充/选择证据，或明确选择“仍然谨慎解释”。'}
                    return self.send_json({'answer':answer,**ret})
                model=call_llm(q,ret['evidence'])
                preview=ai_providers.payload_preview(ret['evidence'])
                if model is None:
                    answer={'mode':'retrieval_only','text':f"已保留 {ret['count']} 条你确认过的本地证据。当前 AI 未启用、禁止远程或未配置，因此 LifeOS 不发送内容，也不生成未经验证的解释。"}
                elif isinstance(model,dict) and model.get('error'):
                    answer={'mode':'llm_error','text':'模型调用失败：'+model['error']}
                else:
                    model_text=model.get('text','')
                    valid_ids={e['evidence_id'] for e in ret['evidence']}
                    cited=set(re.findall(r'\[(E\d+)\]',model_text))
                    valid=sorted(cited & valid_ids,key=lambda x:int(x[1:]))
                    invalid=sorted(cited-valid_ids)
                    inputs=[]
                    for ev in ret['evidence']:
                        pe=product.get_entry(source_path=ev.get('source_path'),root=ROOT)
                        if pe and pe.get('current_revision_id'):inputs.append((pe['entry_id'],pe['current_revision_id']))
                    artifact_id=product.record_ai_artifact('Ask My Life',{'question':q,'answer':model_text,'citation_status':'verified' if valid and not invalid else 'missing_or_invalid'},inputs,model.get('provider','unknown'),model.get('model','unknown'),'ask-v2',ROOT) if inputs else None
                    answer={'mode':'grounded_llm','text':model_text,'valid_citations':valid,'invalid_citations':invalid,'citation_status':'verified' if valid and not invalid else 'missing_or_invalid','provider':model.get('provider'),'model':model.get('model'),'artifact_id':artifact_id}
                return self.send_json({'answer':answer,'remote_payload':preview,**ret})
            if path=='/api/roundtable':
                q=(b.get('question') or '').strip()
                cutoffs=b.get('cutoffs') or ['2025-06-30','2025-12-31','2026-08-13']
                packs=[]
                for c in cutoffs:
                    packs.append({'cutoff':c,'retrieval':retrieve(con,q,8,c)})
                return self.send_json({'question':q,'perspectives':packs,'note':'每个 Past Me 只检索 cutoff 之前的原始记录；未配置模型时只返回证据包。'})
            if path=='/api/corrections':
                verdict=b.get('verdict')
                if verdict not in ('correct','partial','wrong'): return self.send_json({'error':'bad verdict'},400)
                cur=con.execute("INSERT INTO corrections(inference_id,verdict,correction,context_json) VALUES(?,?,?,?)",
                                (b.get('inference_id'),verdict,b.get('correction',''),json.dumps(b.get('context',{}),ensure_ascii=False)))
                con.commit(); return self.send_json({'ok':True,'id':cur.lastrowid})
            if path=='/api/capsules':
                title=(b.get('title') or '').strip(); body=(b.get('body') or '').strip()
                if not title or not body: return self.send_json({'error':'title and body required'},400)
                cur=con.execute("INSERT INTO capsules(title,body,unlock_date,status) VALUES(?,?,?,?)",
                                (title,body,b.get('unlock_date'),'locked'))
                con.commit(); return self.send_json({'ok':True,'id':cur.lastrowid})
            if path=='/api/timefold':
                return self.send_json(timefold_bundle(con))
            if path=='/api/growth-rings':
                items=[]
                for r in con.execute('SELECT * FROM growth_rings ORDER BY month'):
                    x=dict(r)
                    for k in ('new_skills_json','new_topics_json','new_places_json','new_roles_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'Growth Rings show when tracked categories first became visible in the archive. “Newly recorded” is not “newly acquired in life”.'})
            if path=='/api/novelty-atlas':
                items=[]
                for r in con.execute('SELECT * FROM novelty_days ORDER BY novelty_score DESC LIMIT 120'):
                    x=dict(r);x['new_terms']=json.loads(x.pop('new_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Novelty compares visible lexical anchors with the preceding 90 recorded days. Different language/topics ≠ psychological change.'})
            if path=='/api/bridge-days':
                items=[]
                for r in con.execute('SELECT * FROM bridge_days ORDER BY bridge_score DESC LIMIT 120'):
                    x=dict(r);x['labels']=json.loads(x.pop('labels_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Bridge Days connect several tracked domains in one dated source. More domains ≠ more important day.'})
            if path=='/api/attention-portfolio':
                items=[]
                for r in con.execute('SELECT * FROM attention_portfolio ORDER BY month'):
                    x=dict(r);x['top_topics']=json.loads(x.pop('top_topics_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Entropy describes how concentrated the recorded topic mix was in a month. It is not a measure of focus quality or actual time spent.'})
            if path=='/api/promise-ledger':
                status=q.get('status',[None])[0]
                sql='SELECT * FROM promise_ledger';params=[]
                if status: sql+=' WHERE status=?';params.append(status)
                sql+=' ORDER BY date DESC LIMIT 240'
                items=[]
                for r in con.execute(sql,params):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Future-facing statement candidates. “Echoed” means related language reappeared later; it does not mean the plan was completed.'})
            if path=='/api/future-echoes':
                items=[]
                for r in con.execute('SELECT * FROM future_echoes ORDER BY score DESC,gap_days DESC LIMIT 100'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A later passage shares meaningful anchors with an earlier future-facing statement. This is resonance, not prediction accuracy.'})
            if path=='/api/identity-ledger':
                typ=q.get('type',[None])[0];sql='SELECT * FROM identity_ledger';params=[]
                if typ:sql+=' WHERE identity_type=?';params.append(typ)
                sql+=' ORDER BY date DESC LIMIT 220'
                return self.send_json({'items':rows(con.execute(sql,params)),'note':'Only explicit self-descriptions are included. LifeOS does not infer identity from unrelated behavior.'})
            if path=='/api/motif-atlas':
                items=[]
                for r in con.execute('SELECT * FROM motif_atlas ORDER BY echo_pairs DESC,span_days DESC LIMIT 120'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Motifs aggregate repeated terms found in distant Memory Echo pairs. A lexical motif is not a hidden psychological theme.'})
            if path=='/api/turning-points':
                items=[]
                for r in con.execute('SELECT * FROM turning_points ORDER BY score DESC LIMIT 100'):
                    x=dict(r);x['signals']=json.loads(x.pop('signals_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Turning Point Index is a review queue built from structural density, novelty, cross-domain bridges, decisions, milestones and ideas. It does not claim causality.'})
            if path=='/api/thread-reopenings':
                items=[]
                for r in con.execute('SELECT * FROM thread_reopenings ORDER BY score DESC,gap_days DESC LIMIT 120'):
                    x=dict(r);x['shared_terms']=json.loads(x.pop('shared_terms_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A later idea/question/project resembles an earlier one after a long interval. It may be a reopening, continuation, or coincidence—not proof of closure.'})
            if path=='/api/skill-momentum':
                return self.send_json({'items':rows(con.execute("SELECT * FROM skill_momentum ORDER BY CASE status WHEN 'warming' THEN 0 WHEN 'newly-visible' THEN 1 WHEN 'steady' THEN 2 WHEN 'cooling' THEN 3 ELSE 4 END, momentum DESC")),'note':'Momentum compares recorded evidence-day rates in the latest 60 days against the preceding 180 days. It is visibility/activity, not competence.'})
            if path=='/api/seasonal-echoes':
                items=[]
                for r in con.execute('SELECT * FROM seasonal_echoes ORDER BY calendar_month'):
                    x=dict(r)
                    for k in ('rising_topics_json','falling_topics_json','rising_skills_json','falling_skills_json'):
                        x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'Same calendar month across two recorded years. Differences reflect the archive, not a seasonal cause.'})
            if path=='/api/topology':
                return self.send_json(topology_bundle(con))
            if path=='/api/life-neighborhoods':
                items=[]
                for r in con.execute('SELECT * FROM life_neighborhoods ORDER BY edge_weight DESC,node_count DESC'):
                    x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');x['top_months']=json.loads(x.pop('top_months_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Neighborhoods are locally detected co-occurrence communities. They are navigation clusters, not hidden personality categories.'})
            if path=='/api/gateway-nodes':
                items=[]
                for r in con.execute('SELECT * FROM gateway_nodes ORDER BY gateway_score DESC LIMIT 160'):
                    x=dict(r);x['sample_neighbors']=json.loads(x.pop('sample_neighbors_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Gateways connect graph neighborhoods in the archive. High gateway score means cross-neighborhood co-occurrence, not real-world importance or influence.'})
            if path=='/api/topology-bridge-memories':
                items=[]
                for r in con.execute('SELECT * FROM bridge_memories_topology ORDER BY bridge_score DESC LIMIT 160'):
                    x=dict(r);x['nodes']=json.loads(x.pop('nodes_json') or '[]');x['communities']=json.loads(x.pop('communities_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Bridge memories touch several graph neighborhoods on one dated source. Structural density is not subjective importance.'})
            if path=='/api/context-signatures':
                items=[]
                for r in con.execute('SELECT * FROM context_signatures ORDER BY evidence_days DESC'):
                    x=dict(r)
                    for k in ('top_nodes_json','top_roles_json','top_places_json','top_months_json'): x[k[:-5]]=json.loads(x.pop(k) or '[]')
                    items.append(x)
                return self.send_json({'items':items,'note':'A neighborhood signature summarizes what is commonly visible in its dated sources. It does not define you.'})
            if path=='/api/transition-matrix':
                items=[]
                for r in con.execute('SELECT * FROM transition_matrix ORDER BY transition_days DESC,probability DESC'):
                    x=dict(r);x['sample_dates']=json.loads(x.pop('sample_dates_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Observed nearby-day context transitions. The matrix describes sequence in the archive and is neither causality nor prediction.'})
            if path=='/api/cooccurrence-surprises':
                items=[]
                for r in con.execute('SELECT * FROM cooccurrence_surprises ORDER BY lift DESC,evidence_days DESC LIMIT 180'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Lift compares observed same-day pairing with a simple independence baseline. Sparse pairs can have high lift; reread the sources before interpreting.'})
            if path=='/api/rare-pairings':
                items=[]
                for r in con.execute('SELECT * FROM rare_pairings ORDER BY lift DESC,evidence_days DESC LIMIT 160'):
                    x=dict(r);x['sample_sources']=json.loads(x.pop('sample_sources_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Rare Pairings are sparse, concentrated co-occurrences. They are curiosity prompts, not proof of a meaningful relationship.'})
            if path=='/api/orphan-islands':
                items=[]
                for r in con.execute('SELECT * FROM orphan_islands ORDER BY evidence_days DESC,weighted_degree ASC'):
                    x=dict(r);x['source_paths']=json.loads(x.pop('source_paths_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Weakly connected nodes may be under-recorded, truly isolated, or described with different language elsewhere.'})
            if path=='/api/topology-anchor-memories':
                items=[]
                for r in con.execute('SELECT * FROM anchor_memories_topology ORDER BY anchor_score DESC LIMIT 160'):
                    x=dict(r);x['top_nodes']=json.loads(x.pop('top_nodes_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Anchor Memories are structurally central dated sources. Centrality is not the same as personal importance.'})
            if path=='/api/neighborhood-drift':
                items=[]
                for r in con.execute('SELECT * FROM neighborhood_drift ORDER BY month'):
                    x=dict(r);x['shares']=json.loads(x.pop('shares_json') or '[]');x['prev_shares']=json.loads(x.pop('prev_shares_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Monthly drift compares archive-neighborhood distributions. It is a change in recorded context, not a claim that identity changed.'})
            if path=='/api/context-switches':
                items=[]
                for r in con.execute('SELECT * FROM context_switches ORDER BY date DESC LIMIT 180'):
                    x=dict(r);x['nodes']=json.loads(x.pop('nodes_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'A context switch means the dominant graph neighborhood changed between nearby recorded days. It is not a mood or identity switch.'})
            if path=='/api/life-routes':
                items=[]
                for r in con.execute('SELECT * FROM life_routes ORDER BY occurrences DESC,last_start DESC'):
                    x=dict(r);x['route']=json.loads(x.pop('route_json') or '[]');x['route_labels']=json.loads(x.pop('route_labels_json') or '[]');x['sample_starts']=json.loads(x.pop('sample_starts_json') or '[]');items.append(x)
                return self.send_json({'items':items,'note':'Life Routes are repeated three-record sequences of dominant archive neighborhoods. They do not predict what comes next.'})
            if path=='/api/reviews':
                scope=(b.get('scope') or '').strip(); key=(b.get('key') or '').strip(); patch=b.get('patch') or {}
                if scope not in REVIEW_SCOPES or not key or not isinstance(patch,dict): return self.send_json({'error':'scope, key and patch required'},400)
                items=get_review_map(con,scope); current=items.get(key,{})
                if not isinstance(current,dict): current={}
                current.update(patch); current['updated_at']=datetime.datetime.now().isoformat(timespec='seconds')
                items[key]=current; save_review_map(con,scope,items); con.commit()
                return self.send_json({'ok':True,'scope':scope,'key':key,'item':current})
            if path=='/api/settings':
                for k,v in (b.get('items') or {}).items():
                    con.execute("""INSERT INTO app_settings(key,value) VALUES(?,?)
                                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",(k,str(v).lower() if isinstance(v,bool) else str(v)))
                con.commit(); return self.send_json({'ok':True})
            return self.send_json({'error':'unknown endpoint'},404)
        finally:
            con.close()

if __name__=='__main__':
    if not DB.exists():
        raise SystemExit('data/lifeos.db is missing. Run: python engine/rebuild_memory_engine.py')
    url=f'http://{HOST}:{PORT}'
    print(f'LifeOS local server: {url}')
    print('Vault and Memory Engine stay on this computer. Ctrl+C to stop.')
    if os.getenv('LIFEOS_NO_BROWSER','0')!='1':
        threading.Timer(0.8,lambda:webbrowser.open(url)).start()
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()

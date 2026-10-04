#!/usr/bin/env python3
from pathlib import Path
import os
import sqlite3, json, re, datetime, collections, math
from timefold_engine import anchors, display_anchors, split_sentences

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))

FRICTION_MARKERS=['没时间','来不及','卡住','不懂','担心','困难','麻烦','拖延','风险','压力','问题是','没办法','不够','失败','耽误','太忙','忙不过来']
PROTOCOL_MARKERS={
 'should':['我应该','应该要','应该先','应该把'],
 'need':['我需要','需要先','需要把','我得'],
 'must':['我必须','一定要','务必要'],
 'avoid':['不要','不能再','别再','不应该'],
 'remember':['要记得','记得要','以后要','下次要']
}
BOUNDARY_MARKERS=['我不想','我不要','我不愿意','我不喜欢','我不能接受','我不接受','我不再想','我不会再']
FORK_MARKERS=['要不要','二选一','选择','放弃','不再','或者']


def js(x): return json.dumps(x,ensure_ascii=False)
def d(s): return datetime.date.fromisoformat(s)
def norm(s): return re.sub(r'\s+',' ',s or '').strip()

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS mirror_summary;
    DROP TABLE IF EXISTS closure_candidates;
    DROP TABLE IF EXISTS friction_statements;
    DROP TABLE IF EXISTS protocol_statements;
    DROP TABLE IF EXISTS protocol_threads;
    DROP TABLE IF EXISTS boundary_statements;
    DROP TABLE IF EXISTS quiet_priorities;
    DROP TABLE IF EXISTS idea_survival;
    DROP TABLE IF EXISTS milestone_leadups;
    DROP TABLE IF EXISTS decision_replays;
    DROP TABLE IF EXISTS fork_replays;
    DROP TABLE IF EXISTS identity_mirror;
    DROP TABLE IF EXISTS completion_texture;
    CREATE TABLE mirror_summary(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE closure_candidates(id INTEGER PRIMARY KEY,source_date TEXT,source_path TEXT,source_text TEXT,later_date TEXT,later_source TEXT,later_text TEXT,later_type TEXT,gap_days INTEGER,shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE friction_statements(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,section TEXT,text TEXT,marker TEXT,anchors_json TEXT);
    CREATE TABLE protocol_statements(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,section TEXT,text TEXT,protocol_type TEXT,marker TEXT,anchors_json TEXT);
    CREATE TABLE protocol_threads(id INTEGER PRIMARY KEY,anchor TEXT,protocol_type TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,samples_json TEXT,note TEXT);
    CREATE TABLE boundary_statements(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,section TEXT,text TEXT,marker TEXT,anchors_json TEXT);
    CREATE TABLE quiet_priorities(id INTEGER PRIMARY KEY,kind TEXT,label TEXT,total_days INTEGER,recent_days INTEGER,prior_days INTEGER,last_date TEXT,days_since_last INTEGER,recent_rate REAL,prior_rate REAL,quiet_score REAL,note TEXT);
    CREATE TABLE idea_survival(id INTEGER PRIMARY KEY,anchor TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,project_echoes INTEGER,milestone_echoes INTEGER,samples_json TEXT,note TEXT);
    CREATE TABLE milestone_leadups(id INTEGER PRIMARY KEY,milestone_date TEXT,milestone_source TEXT,milestone_text TEXT,lead_type TEXT,lead_date TEXT,lead_source TEXT,lead_text TEXT,lag_days INTEGER,shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE decision_replays(id INTEGER PRIMARY KEY,decision_date TEXT,source_path TEXT,decision_text TEXT,before_topics_json TEXT,after_topics_json TEXT,before_skills_json TEXT,after_skills_json TEXT,rising_topics_json TEXT,rising_skills_json TEXT,note TEXT);
    CREATE TABLE fork_replays(id INTEGER PRIMARY KEY,decision_date TEXT,source_path TEXT,decision_text TEXT,marker TEXT,later_date TEXT,later_source TEXT,later_text TEXT,later_type TEXT,gap_days INTEGER,shared_terms_json TEXT,note TEXT);
    CREATE TABLE identity_mirror(id INTEGER PRIMARY KEY,date TEXT,source_path TEXT,identity_type TEXT,identity_text TEXT,nearby_topics_json TEXT,nearby_skills_json TEXT,note TEXT);
    CREATE TABLE completion_texture(id INTEGER PRIMARY KEY,kind TEXT,label TEXT,milestone_count INTEGER,first_date TEXT,last_date TEXT,examples_json TEXT,note TEXT);
    ''')

def valid_memories(con):
    return con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date").fetchall()

def sections(con,mid):
    return con.execute("SELECT normalized_name,content FROM sections WHERE memory_id=? AND length(trim(content))>0 ORDER BY ordinal",(mid,)).fetchall()

def item_anchors(text):
    bad={'AI','模型','产品','项目','工作','学习','事情','问题','自己','日记','记录','今天','以后','计划','希望'}
    vals=display_anchors(text)[:40]
    return {x for x in vals if x not in bad and len(x)>=2 and '\\' not in x and not re.fullmatch(r'[0-9._+\-]+',x)}

def meaningful_shared(a,b):
    return sorted(item_anchors(a)&item_anchors(b),key=lambda x:(-len(x),x))[:14]

def indexed_candidates(items):
    idx=collections.defaultdict(list)
    for i,x in enumerate(items):
        x['_anchors']=item_anchors(x['text'])
        for a in x['_anchors']:
            idx[a.lower()].append(i)
    return idx

def build_closures(con):
    later=[]
    # Milestone candidates + project candidates are allowed, but a closure candidate must share
    # at least one specific anchor (>=4 Chinese chars or a Latin token) with the earlier statement.
    for table,typ in [('achievement_candidates','milestone'),('project_candidates','project')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            later.append({'date':r['date'],'text':r['text'],'source':r['source_path'],'type':typ})
    later.sort(key=lambda x:x['date']); idx=indexed_candidates(later)
    out=[]
    allowed=('我想','想要','计划','准备','希望','打算','要做','想做','准备做','接下来','目标是','以后','未来')
    marks=','.join('?'*len(allowed))
    for p in con.execute(f"SELECT date,source_path,text FROM promise_ledger WHERE date IS NOT NULL AND trigger IN ({marks}) ORDER BY date",allowed):
        pa=item_anchors(p['text']); cand=set()
        for a in pa: cand.update(idx.get(a.lower(),[]))
        best=None; pd=d(p['date'])
        for i in cand:
            x=later[i]
            if x['date']<=p['date']: continue
            gap=(d(x['date'])-pd).days
            if gap>720: continue
            shared=sorted(pa & x['_anchors'],key=lambda z:(-len(z),z))[:14]
            strong=[z for z in shared if (re.search(r'[A-Za-z]',z) and len(z)>=3) or (not re.search(r'[A-Za-z]',z) and len(z)>=4)]
            if not strong: continue
            score=len(shared)*1.2 + len(strong)*2.2 - min(gap,720)/360 + (0.8 if x['type']=='milestone' else 0)
            if best is None or score>best[0]: best=(score,x,gap,shared)
        if best and best[0]>=2.6:
            score,x,gap,shared=best
            out.append((p['date'],p['source_path'],p['text'],x['date'],x['source'],x['text'],x['type'],gap,js(shared),round(score,2),'A later milestone/project candidate shares at least one specific visible anchor with an earlier future-facing statement. This is a closure review candidate, not proof that the intention was fulfilled.'))
    # Supplement with a small set of future-echo pairs where the later passage contains explicit progress/work language.
    seen={(x[0],x[3]) for x in out}
    for r in con.execute("SELECT * FROM future_echoes ORDER BY score DESC"):
        if (r['source_date'],r['later_date']) in seen: continue
        later_text=r['later_excerpt'] or ''
        if not any(m in later_text for m in ('进展','开始做','去做','做了','做得','完成','上线','拿到','发表','实现')): continue
        shared=json.loads(r['shared_terms_json'] or '[]')
        strong=[z for z in shared if (re.search(r'[A-Za-z]',z) and len(z)>=3) or (not re.search(r'[A-Za-z]',z) and len(z)>=4)]
        if not strong: continue
        out.append((r['source_date'],r['source_path'],r['source_text'],r['later_date'],r['later_source'],r['later_excerpt'],'future_echo_progress',r['gap_days'],js(shared),round(float(r['score'])+1.0,2),'A later passage contains explicit progress/work language and shares a specific anchor with an earlier future-facing statement. Review manually; this is not proof of fulfillment.'))
        seen.add((r['source_date'],r['later_date']))
    out=sorted(out,key=lambda x:x[9],reverse=True)[:120]
    con.executemany("INSERT INTO closure_candidates(source_date,source_path,source_text,later_date,later_source,later_text,later_type,gap_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",out)
    return len(out)

def build_friction_protocols_boundaries(con):
    fr=[]; pr=[]; bd=[]
    for m in valid_memories(con):
        for sec in sections(con,m['id']):
            if sec['normalized_name'] in ('习惯打卡','心得与摘录'): continue
            for s in split_sentences(sec['content']):
                for mk in FRICTION_MARKERS:
                    if mk in s:
                        # Do not classify explicit negations such as “一点压力都没有 / 不担心 / 没啥压力” as friction.
                        neg_patterns=['没有压力','没压力','压力都没有','一点压力都没有','没啥压力','不用担心','不担心','无需担心','并不困难','不困难','没问题']
                        if any(x in s for x in neg_patterns):
                            continue
                        fr.append((m['date'],m['id'],m['source_path'],sec['normalized_name'],s,mk,js(display_anchors(s)[:12])));break
                hit=False
                for typ,markers in PROTOCOL_MARKERS.items():
                    for mk in markers:
                        if mk not in s: continue
                        if typ=='avoid' and mk=='不要' and '要不要' in s: continue
                        if '说不要' in s or '告诉我不要' in s or '跟我说不要' in s: continue
                        self_directed=('我' in s or '自己' in s or (sec['normalized_name'] in ('自我探索','体系构建') and s.startswith(('不要','以后要','下次要','一定要'))))
                        if not self_directed: continue
                        pr.append((m['date'],m['id'],m['source_path'],sec['normalized_name'],s,typ,mk,js(display_anchors(s)[:12])));hit=True;break
                    if hit: break
                for mk in BOUNDARY_MARKERS:
                    if mk in s:
                        bd.append((m['date'],m['id'],m['source_path'],sec['normalized_name'],s,mk,js(display_anchors(s)[:12])));break
    # de-dupe by date/text
    def dedupe(xs,keyidx=(0,4)):
        seen=set();out=[]
        for x in xs:
            k=tuple(x[i] for i in keyidx)
            if k in seen: continue
            seen.add(k);out.append(x)
        return out
    fr=dedupe(fr);pr=dedupe(pr);bd=dedupe(bd)
    con.executemany("INSERT INTO friction_statements(date,memory_id,source_path,section,text,marker,anchors_json) VALUES(?,?,?,?,?,?,?)",fr)
    con.executemany("INSERT INTO protocol_statements(date,memory_id,source_path,section,text,protocol_type,marker,anchors_json) VALUES(?,?,?,?,?,?,?,?)",pr)
    con.executemany("INSERT INTO boundary_statements(date,memory_id,source_path,section,text,marker,anchors_json) VALUES(?,?,?,?,?,?,?)",bd)
    return len(fr),len(pr),len(bd)

def semantic_labels(text):
    low=(text or '').lower(); out=[]
    for topic,terms in CFG.get('topics',{}).items():
        if topic.lower() in low or any(t.lower() in low for t in terms if len(t)>=2): out.append(topic)
    for sk in CFG.get('skills',[]):
        if sk['name'].lower() in low or any(t.lower() in low for t in sk.get('terms',[]) if len(t)>=2): out.append(sk['name'])
    return list(dict.fromkeys(out))

def build_protocol_threads(con):
    groups=collections.defaultdict(list)
    for r in con.execute("SELECT * FROM protocol_statements ORDER BY date"):
        labels=semantic_labels(r['text'])
        if not labels:
            aa=json.loads(r['anchors_json'] or '[]'); labels=[x for x in aa if len(x)>=4][:2]
        for label in labels[:3]: groups[(r['protocol_type'],label)].append(dict(r))
    n=0
    for (typ,a),items in groups.items():
        # unique dated statements
        uniq=[];seen=set()
        for x in items:
            k=(x['date'],x['text'])
            if k not in seen:seen.add(k);uniq.append(x)
        items=uniq
        if len(items)<2: continue
        span=(d(items[-1]['date'])-d(items[0]['date'])).days
        if span<14: continue
        samples=[{'date':x['date'],'text':x['text'],'source_path':x['source_path']} for x in [items[0],items[len(items)//2],items[-1]]]
        con.execute("INSERT INTO protocol_threads(anchor,protocol_type,occurrences,first_date,last_date,span_days,samples_json,note) VALUES(?,?,?,?,?,?,?,?)",(a,typ,len(items),items[0]['date'],items[-1]['date'],span,js(samples),'Repeated rule-like language around the same tracked topic/skill or visible anchor. Repetition does not mean the rule was followed or is still endorsed.'))
        n+=1
    return n

def build_quiet_priorities(con):
    latest=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    ld=d(latest); recent_start=(ld-datetime.timedelta(days=89)).isoformat(); prior_end=(ld-datetime.timedelta(days=90)).isoformat()
    out=[]
    queries=[
      ('topic',"SELECT tm.topic label,COUNT(DISTINCT tm.memory_id) total_days,MAX(m.date) last_date FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY tm.topic"),
      ('skill',"SELECT sd.name label,COUNT(DISTINCT sa.memory_id) total_days,MAX(m.date) last_date FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY sd.name")]
    total_archive_days=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    earliest=con.execute("SELECT MIN(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    recent_calendar=90; prior_calendar=max((ld-d(earliest)).days-89,90)
    for kind,q in queries:
        for r in con.execute(q):
            label=r['label']; total=r['total_days']
            if total<5: continue
            if kind=='topic':
                recent=con.execute("SELECT COUNT(DISTINCT tm.memory_id) FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE tm.topic=? AND m.date BETWEEN ? AND ?",(label,recent_start,latest)).fetchone()[0]
                prior=con.execute("SELECT COUNT(DISTINCT tm.memory_id) FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE tm.topic=? AND m.date<?",(label,recent_start)).fetchone()[0]
            else:
                recent=con.execute("SELECT COUNT(DISTINCT sa.memory_id) FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE sd.name=? AND m.date BETWEEN ? AND ?",(label,recent_start,latest)).fetchone()[0]
                prior=con.execute("SELECT COUNT(DISTINCT sa.memory_id) FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE sd.name=? AND m.date<?",(label,recent_start)).fetchone()[0]
            rr=recent/recent_calendar; pr=prior/prior_calendar
            days_since=(ld-d(r['last_date'])).days
            if prior>=3 and (rr < pr*0.9 or days_since>=30):
                quiet=max(0,pr-rr)*100 + min(days_since,365)/30
                out.append((kind,label,total,recent,prior,r['last_date'],days_since,round(rr,4),round(pr,4),round(quiet,3),'Historically visible but less visible in the latest 90-day window. This describes the archive, not a neglected obligation.'))
    out.sort(key=lambda x:x[9],reverse=True)
    con.executemany("INSERT INTO quiet_priorities(kind,label,total_days,recent_days,prior_days,last_date,days_since_last,recent_rate,prior_rate,quiet_score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",out[:40])
    return len(out[:40])

def build_idea_survival(con):
    groups=collections.defaultdict(list)
    for r in con.execute("SELECT i.date,i.text,m.source_path FROM idea_candidates i JOIN memories m ON m.id=i.memory_id WHERE i.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY i.date"):
        labels=semantic_labels(r['text'])
        if not labels:
            aa=[x for x in display_anchors(r['text']) if len(x)>=4 and x not in ('我想做','计划','以后可以')]
            labels=aa[:1]
        for label in labels[:3]:groups[label].append(dict(r))
    n=0
    for a,items in groups.items():
        uniq=[];seen=set()
        for x in items:
            k=(x['date'],x['text'])
            if k not in seen:seen.add(k);uniq.append(x)
        items=uniq
        if len(items)<2: continue
        span=(d(items[-1]['date'])-d(items[0]['date'])).days
        if span<21: continue
        # project/milestone echoes use semantic label terms first, literal label second
        pe=0;me=0
        for x in con.execute("SELECT text,date FROM project_candidates WHERE date>=?",(items[0]['date'],)):
            if a in semantic_labels(x['text']) or a.lower() in x['text'].lower(): pe+=1
        for x in con.execute("SELECT text,date FROM achievement_candidates WHERE date>=?",(items[0]['date'],)):
            if a in semantic_labels(x['text']) or a.lower() in x['text'].lower(): me+=1
        samples=[{'date':x['date'],'text':x['text'],'source_path':x['source_path']} for x in [items[0],items[len(items)//2],items[-1]]]
        con.execute("INSERT INTO idea_survival(anchor,occurrences,first_date,last_date,span_days,project_echoes,milestone_echoes,samples_json,note) VALUES(?,?,?,?,?,?,?,?,?)",(a,len(items),items[0]['date'],items[-1]['date'],span,pe,me,js(samples),'A recurring idea thread around the same tracked topic/skill or visible anchor. Project/milestone echoes are context hints, not implementation proof.'))
        n+=1
    return n

def build_milestone_leadups(con):
    lead_pool=[]
    for table,typ in [('project_candidates','project'),('idea_candidates','idea')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            lead_pool.append({'date':r['date'],'text':r['text'],'source_path':r['source_path'],'type':typ})
    idx=indexed_candidates(lead_pool); out=[]
    strong_triggers=('完成','拿到','实现','发表','做完','上线','录用','交付','发布'); marks=','.join('?'*len(strong_triggers))
    for a in con.execute(f"SELECT a.date,a.text,m.source_path FROM achievement_candidates a JOIN memories m ON m.id=a.memory_id WHERE a.date IS NOT NULL AND a.trigger IN ({marks}) AND m.kind='daily' AND m.date_anomaly=0 ORDER BY a.date",strong_triggers):
        aa=item_anchors(a['text']); cand=set()
        for z in aa: cand.update(idx.get(z.lower(),[]))
        ad=d(a['date']); best=None
        for i in cand:
            x=lead_pool[i]
            if x['date']>=a['date']: continue
            gap=(ad-d(x['date'])).days
            if gap>540: continue
            shared=sorted(aa & x['_anchors'],key=lambda z:(-len(z),z))[:14]
            strong=[z for z in shared if len(z)>=4 or re.search(r'[A-Za-z]',z)]
            if len(shared)<2 and not strong: continue
            score=len(shared)*2 + len(strong) - gap/270 + (0.5 if x['type']=='project' else 0)
            if best is None or score>best[0]: best=(score,x,gap,shared)
        if best and best[0]>=2.5:
            score,x,gap,shared=best
            out.append((a['date'],a['source_path'],a['text'],x['type'],x['date'],x['source_path'],x['text'],gap,js(shared),round(score,2),'A prior idea/project candidate shares visible anchors with a later milestone candidate. This shows documented lead-up, not effort amount or causality.'))
    out.sort(key=lambda x:x[9],reverse=True)
    con.executemany("INSERT INTO milestone_leadups(milestone_date,milestone_source,milestone_text,lead_type,lead_date,lead_source,lead_text,lag_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",out[:100])
    return len(out[:100])

def aggregate_context(con,start,end,kind):
    if kind=='topics':
        q="SELECT tm.topic label,SUM(tm.mention_count) v FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.date BETWEEN ? AND ? GROUP BY tm.topic ORDER BY v DESC"
    else:
        q="SELECT sd.name label,SUM(sa.mention_count) v FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.date BETWEEN ? AND ? GROUP BY sd.name ORDER BY v DESC"
    return [{'label':r['label'],'value':r['v']} for r in con.execute(q,(start,end))]

def deltas(before,after):
    b={x['label']:x['value'] for x in before}; a={x['label']:x['value'] for x in after}
    return sorted([{'label':k,'delta':a.get(k,0)-b.get(k,0)} for k in set(a)|set(b) if a.get(k,0)-b.get(k,0)>0],key=lambda x:x['delta'],reverse=True)[:6]

def build_decision_replays(con):
    earliest=con.execute("SELECT MIN(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]; latest=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    min_dec=(d(earliest)+datetime.timedelta(days=30)).isoformat(); max_dec=(d(latest)-datetime.timedelta(days=30)).isoformat()
    rows=list(con.execute("SELECT d.date,d.text,m.source_path FROM decision_candidates d JOIN memories m ON m.id=d.memory_id WHERE d.date BETWEEN ? AND ? AND m.kind='daily' AND m.date_anomaly=0 ORDER BY d.date DESC LIMIT 120",(min_dec,max_dec)))
    n=0
    for r in rows:
        dt=d(r['date']); bs=(dt-datetime.timedelta(days=30)).isoformat(); be=(dt-datetime.timedelta(days=1)).isoformat(); as_=(dt+datetime.timedelta(days=1)).isoformat(); ae=(dt+datetime.timedelta(days=30)).isoformat()
        bt=aggregate_context(con,bs,be,'topics')[:6]; at=aggregate_context(con,as_,ae,'topics')[:6]; bsx=aggregate_context(con,bs,be,'skills')[:6]; asx=aggregate_context(con,as_,ae,'skills')[:6]
        con.execute("INSERT INTO decision_replays(decision_date,source_path,decision_text,before_topics_json,after_topics_json,before_skills_json,after_skills_json,rising_topics_json,rising_skills_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",(r['date'],r['source_path'],r['text'],js(bt),js(at),js(bsx),js(asx),js(deltas(bt,at)),js(deltas(bsx,asx)),'±30-day context around an explicit decision candidate. A changed mix after the date does not mean the decision caused it.'))
        n+=1
    return n

def build_fork_replays(con):
    later=[]
    for table,typ in [('project_candidates','project'),('achievement_candidates','milestone')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            later.append({'date':r['date'],'text':r['text'],'source':r['source_path'],'type':typ})
    idx=indexed_candidates(later); n=0
    for r in con.execute("SELECT d.date,d.text,m.source_path,s.normalized_name section FROM decision_candidates d JOIN memories m ON m.id=d.memory_id LEFT JOIN sections s ON s.id=d.section_id WHERE d.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 AND COALESCE(s.normalized_name,'') IN ('日记','自我探索') ORDER BY d.date"):
        if '\\' in r['text'] or len(r['text'])>180: continue
        if not ('我' in r['text'] or '自己' in r['text'] or '要不要' in r['text']): continue
        mk=next((x for x in FORK_MARKERS if x in r['text']),None)
        if not mk: continue
        if mk=='选择' and not any(z in r['text'] for z in ('我选择','我会选择','我也选择','选择了','选择的是','选择提前')): continue
        ra=item_anchors(r['text']); cand=set()
        for z in ra: cand.update(idx.get(z.lower(),[]))
        best=None
        for i in cand:
            x=later[i]
            if x['date']<=r['date']: continue
            gap=(d(x['date'])-d(r['date'])).days
            if gap>540: continue
            shared=sorted(ra & x['_anchors'],key=lambda z:(-len(z),z))[:14]
            sem=sorted((set(semantic_labels(r['text'])) & set(semantic_labels(x['text']))) - {'Self','Relationships'})
            useful=[z for z in shared if z not in ('选择','自己','人生')]
            strong=[z for z in useful if (re.search(r'[A-Za-z]',z) and len(z)>=3) or (not re.search(r'[A-Za-z]',z) and len(z)>=3)]
            if not strong and not sem: continue
            shared=list(dict.fromkeys(sem+useful))[:14]
            score=len(shared)*1.6 + len(sem)*1.2 + (1 if x['type']=='milestone' else 0)-gap/360
            if best is None or score>best[0]: best=(score,x,gap,shared)
        if best and best[0]>=2:
            _,x,gap,shared=best
            con.execute("INSERT INTO fork_replays(decision_date,source_path,decision_text,marker,later_date,later_source,later_text,later_type,gap_days,shared_terms_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(r['date'],r['source_path'],r['text'],mk,x['date'],x['source'],x['text'],x['type'],gap,js(shared),'An explicit fork-like sentence and a later related project/milestone candidate. It shows the path later recorded, not the fate of the alternative path.'))
            n+=1
    return n

def build_identity_mirror(con):
    n=0
    for r in con.execute("SELECT i.date,i.source_path,i.identity_type,i.text,m.id memory_id FROM identity_ledger i JOIN memories m ON m.source_path=i.source_path ORDER BY i.date"):
        tops=[{'label':x['topic'],'mentions':x['mention_count']} for x in con.execute("SELECT topic,mention_count FROM topic_mentions WHERE memory_id=? ORDER BY mention_count DESC LIMIT 6",(r['memory_id'],))]
        sk=[{'label':x['name'],'mentions':x['mention_count']} for x in con.execute("SELECT sd.name,sa.mention_count FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id=? ORDER BY sa.mention_count DESC LIMIT 6",(r['memory_id'],))]
        con.execute("INSERT INTO identity_mirror(date,source_path,identity_type,identity_text,nearby_topics_json,nearby_skills_json,note) VALUES(?,?,?,?,?,?,?)",(r['date'],r['source_path'],r['identity_type'],r['text'],js(tops),js(sk),'Shows topics and skill signals present in the same dated source as an explicit self-description. Context is not evidence that the self-description is objectively true.'))
        n+=1
    return n

def build_completion_texture(con):
    items=[]
    # achievement contexts by topic and skill
    strong_triggers=('完成','拿到','实现','发表','做完','上线','录用','交付','发布'); marks=','.join('?'*len(strong_triggers))
    mids=[r for r in con.execute(f"SELECT a.memory_id,a.date,a.text,m.source_path FROM achievement_candidates a JOIN memories m ON m.id=a.memory_id WHERE a.date IS NOT NULL AND a.trigger IN ({marks}) AND m.kind='daily' AND m.date_anomaly=0",strong_triggers)]
    for kind in ('topic','skill'):
        groups=collections.defaultdict(list)
        for a in mids:
            if kind=='topic': vals=con.execute("SELECT topic label FROM topic_mentions WHERE memory_id=?",(a['memory_id'],)).fetchall()
            else: vals=con.execute("SELECT sd.name label FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id=?",(a['memory_id'],)).fetchall()
            for v in vals: groups[v['label']].append(a)
        for label,xs in groups.items():
            if len(xs)<2: continue
            xs=sorted(xs,key=lambda x:x['date'])
            examples=[{'date':x['date'],'text':x['text'],'source_path':x['source_path']} for x in xs[:2]+(xs[-1:] if len(xs)>2 else [])]
            items.append((kind,label,len(xs),xs[0]['date'],xs[-1]['date'],js(examples),'Counts milestone-candidate sentences on dates where this topic/skill was also visible. Co-occurrence does not mean the topic/skill caused completion.'))
    items.sort(key=lambda x:x[2],reverse=True)
    con.executemany("INSERT INTO completion_texture(kind,label,milestone_count,first_date,last_date,examples_json,note) VALUES(?,?,?,?,?,?,?)",items[:100])
    return len(items[:100])

def build_mirror_layer(con,cfg=None):
    ensure_schema(con)
    if con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0] == 0:
        summary={'promise_candidates':0,'promises_with_echo':0,'closure_candidates':0,'friction_statements':0,'protocol_statements':0,'protocol_threads':0,'boundary_statements':0,'quiet_priorities':0,'idea_survival_threads':0,'milestone_leadups':0,'decision_replays':0,'fork_replays':0,'identity_mirror_items':0,'completion_texture_rows':0}
        con.executemany("INSERT INTO mirror_summary(key,value) VALUES(?,?)",[(k,str(v)) for k,v in summary.items()]); con.commit(); return summary
    closures=build_closures(con)
    friction,protocols,bounds=build_friction_protocols_boundaries(con)
    pthr=build_protocol_threads(con)
    quiet=build_quiet_priorities(con)
    ideas=build_idea_survival(con)
    leadups=build_milestone_leadups(con)
    decisions=build_decision_replays(con)
    forks=build_fork_replays(con)
    identities=build_identity_mirror(con)
    texture=build_completion_texture(con)
    promises=con.execute("SELECT COUNT(*) FROM promise_ledger").fetchone()[0]
    echoed=con.execute("SELECT COUNT(*) FROM promise_ledger WHERE echo_count>0").fetchone()[0]
    summary={
      'promise_candidates':promises,'promises_with_echo':echoed,'closure_candidates':closures,'friction_statements':friction,
      'protocol_statements':protocols,'protocol_threads':pthr,'boundary_statements':bounds,'quiet_priorities':quiet,
      'idea_survival_threads':ideas,'milestone_leadups':leadups,'decision_replays':decisions,'fork_replays':forks,
      'identity_mirror_items':identities,'completion_texture_rows':texture
    }
    con.executemany("INSERT INTO mirror_summary(key,value) VALUES(?,?)",[(k,str(v)) for k,v in summary.items()])
    return summary

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    print(json.dumps(build_mirror_layer(con,CFG),ensure_ascii=False,indent=2));con.commit();con.close()

#!/usr/bin/env python3
from pathlib import Path
import os
import sqlite3, json, re, math, datetime, collections

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))

STOP_PHRASES={
'今天','明天','昨天','然后','但是','还是','就是','这个','那个','一些','一个','自己','觉得','感觉','其实','可以','可能','应该','因为','所以','如果','时候','事情','什么','怎么','没有','还是','非常','已经','现在','后来','一下','比较','真的','不是','我们','他们','她们','进行','开始','继续','以及','而且','不过','之后','之前','目前','对于','需要','希望','想要','未来','计划','准备','目标','工作','学习','日记','记录','复盘'
}
FUTURE_MARKERS=['以后','未来','我想','想要','计划','准备','希望','打算','要去','要做','想做','准备做','接下来','明年','下个月','之后要','目标是']
FORECAST_MARKERS=['可能会','应该会','估计','预计','我觉得会','我认为会','未来会','希望能','希望会','大概会','也许会','想象','预测']
IDENTITY_MARKERS={
 'identity':['我是','我觉得自己','我认为自己','我算是','我这个人'],
 'aspiration':['我想成为','我希望成为','我想做一个','我希望自己'],
 'boundary':['我不想成为','我不喜欢','我不愿意','我不会成为','我不要成为'],
 'preference':['对我来说','我更喜欢','我更在意','我最在意','我看重','我擅长','我不擅长']
}

VOCAB=[]
for _k,_vs in CFG.get('topics',{}).items(): VOCAB += [_k]+_vs
for _s in CFG.get('skills',[]): VOCAB += [_s['name']]+_s.get('terms',[])
VOCAB += CFG.get('places',[])+CFG.get('roles',[])+CFG.get('word_terms',[])
# de-duplicate once; longest first helps specific terms survive caps
VOCAB=list(dict.fromkeys(x for x in VOCAB if x and len(x)>=2))
GENERIC_FRAGMENTS=['的事情','做的事情','我当时','出自于','于我而言','我而言','我身上','身上的','想象中','继续保持','希望能','希望会','可能会','应该会','我觉得','我认为','本来','后来','还是','这个','那个','自己','感觉','觉得','好像就是','像就是','一切都是','一切都','给我带来','带来','有这种','那场比赛','那场比','不知道为什么','不知道','我想表达','想表达','大概会','估计是']
_DOCS=None
_POST=None
_DF=None

def d(s): return datetime.date.fromisoformat(s)
def js(x): return json.dumps(x,ensure_ascii=False)
def norm(s): return re.sub(r'\s+',' ',s or '').strip()

def split_sentences(text):
    out=[]
    for s in re.split(r'[\n。！？!?；;]+',text or ''):
        s=norm(re.sub(r'^\s*[-*+>]\s*','',s))
        if 6<=len(s)<=260: out.append(s)
    return out

def anchors(text):
    """Small deterministic anchor set. Designed for linking, not semantic truth."""
    text=text or ''
    out=[]
    # configured vocabulary gets priority
    low=text.lower()
    for v in VOCAB:
        v=v.strip()
        if len(v)>=2 and v.lower() in low: out.append(v)
    # Latin tokens
    out += re.findall(r'(?i)\b[A-Za-z][A-Za-z0-9+.#_-]{2,}\b',text)
    # Chinese chunks and selective n-grams
    chunks=re.findall(r'[\u4e00-\u9fff]{2,12}',text)
    for ch in chunks:
        if 2<=len(ch)<=6 and ch not in STOP_PHRASES: out.append(ch)
        for n in (4,3,2):
            if len(ch)>=n:
                for i in range(len(ch)-n+1):
                    g=ch[i:i+n]
                    if g not in STOP_PHRASES and not any(x in g for x in ['这个','那个','什么','怎么','自己','觉得','感觉','然后','但是','还是','因为','所以','可能','应该','今天','明天','已经','开始','事情','当时','身上','出自','而言','想象','保持','希望','计划','准备','打算','未来']):
                        out.append(g)
    seen=set();ret=[]
    for x in out:
        k=x.lower()
        if k in seen or len(k)<2: continue
        seen.add(k);ret.append(x)
    return ret[:160]

def display_anchors(text):
    out=[];low=(text or '').lower()
    for v in VOCAB:
        if v.lower() in low and v not in STOP_PHRASES:out.append(v)
    out += re.findall(r'(?i)\b[A-Za-z][A-Za-z0-9+.#_-]{2,}\b',text or '')
    for part in re.split(r"[\n，。！？；：,.!?;:、（）()\[\]【】“”\"'\s]+",text or ''):
        part=part.strip()
        if 3<=len(part)<=12 and not any(g in part for g in GENERIC_FRAGMENTS) and part not in STOP_PHRASES:
            out.append(part)
    seen=set();ret=[]
    for x in out:
        k=x.lower()
        if k not in seen:
            seen.add(k);ret.append(x)
    return ret[:80]

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS growth_rings;
    DROP TABLE IF EXISTS novelty_days;
    DROP TABLE IF EXISTS bridge_days;
    DROP TABLE IF EXISTS attention_portfolio;
    DROP TABLE IF EXISTS promise_ledger;
    DROP TABLE IF EXISTS future_echoes;
    DROP TABLE IF EXISTS identity_ledger;
    DROP TABLE IF EXISTS motif_atlas;
    DROP TABLE IF EXISTS turning_points;
    DROP TABLE IF EXISTS thread_reopenings;
    DROP TABLE IF EXISTS skill_momentum;
    DROP TABLE IF EXISTS seasonal_echoes;
    CREATE TABLE growth_rings(month TEXT PRIMARY KEY,cumulative_skills INTEGER,cumulative_topics INTEGER,cumulative_places INTEGER,cumulative_roles INTEGER,new_skills_json TEXT,new_topics_json TEXT,new_places_json TEXT,new_roles_json TEXT);
    CREATE TABLE novelty_days(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,char_count INTEGER,novelty_score REAL,new_terms_json TEXT,reason TEXT);
    CREATE TABLE bridge_days(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,skill_count INTEGER,topic_count INTEGER,place_count INTEGER,role_count INTEGER,domain_count INTEGER,entropy REAL,bridge_score REAL,labels_json TEXT);
    CREATE TABLE attention_portfolio(month TEXT PRIMARY KEY,topic_entropy REAL,normalized_entropy REAL,top_share REAL,top_topics_json TEXT,description TEXT);
    CREATE TABLE promise_ledger(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,section TEXT,text TEXT,trigger TEXT,status TEXT,echo_count INTEGER,first_echo_date TEXT,first_echo_source TEXT,shared_terms_json TEXT,note TEXT);
    CREATE TABLE future_echoes(id INTEGER PRIMARY KEY,source_date TEXT,source_path TEXT,source_text TEXT,later_date TEXT,later_source TEXT,later_excerpt TEXT,gap_days INTEGER,shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE identity_ledger(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,section TEXT,identity_type TEXT,text TEXT,trigger TEXT);
    CREATE TABLE motif_atlas(id INTEGER PRIMARY KEY,motif TEXT,echo_pairs INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,source_paths_json TEXT,note TEXT);
    CREATE TABLE turning_points(id INTEGER PRIMARY KEY,date TEXT,memory_id INTEGER,source_path TEXT,score REAL,signals_json TEXT,reason TEXT);
    CREATE TABLE thread_reopenings(id INTEGER PRIMARY KEY,kind TEXT,first_date TEXT,first_source TEXT,first_text TEXT,return_date TEXT,return_source TEXT,return_text TEXT,gap_days INTEGER,shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE skill_momentum(skill TEXT PRIMARY KEY,recent_days INTEGER,prior_days INTEGER,recent_mentions INTEGER,prior_mentions INTEGER,recent_rate REAL,prior_rate REAL,momentum REAL,status TEXT,latest_date TEXT,note TEXT);
    CREATE TABLE seasonal_echoes(id INTEGER PRIMARY KEY,calendar_month INTEGER,left_year INTEGER,right_year INTEGER,left_days INTEGER,right_days INTEGER,topic_similarity REAL,rising_topics_json TEXT,falling_topics_json TEXT,rising_skills_json TEXT,falling_skills_json TEXT,note TEXT);
    ''')

def valid_daily(con):
    return con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date").fetchall()

def memory_text(con,mid):
    return '\n'.join(r[0] or '' for r in con.execute("SELECT content FROM sections WHERE memory_id=? AND length(trim(content))>0 ORDER BY ordinal",(mid,)))

def build_growth_rings(con):
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    seen={k:set() for k in ('skills','topics','places','roles')}
    for m in months:
        cur={}
        cur['skills']={r[0] for r in con.execute("SELECT DISTINCT sd.name FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories mm ON mm.id=sa.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=?",(m,))}
        cur['topics']={r[0] for r in con.execute("SELECT DISTINCT tm.topic FROM topic_mentions tm JOIN memories mm ON mm.id=tm.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=?",(m,))}
        cur['places']={r[0] for r in con.execute("SELECT DISTINCT pm.place FROM place_mentions pm JOIN memories mm ON mm.id=pm.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=?",(m,))}
        cur['roles']={r[0] for r in con.execute("SELECT DISTINCT rm.role FROM role_mentions rm JOIN memories mm ON mm.id=rm.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=?",(m,))}
        new={k:sorted(cur[k]-seen[k]) for k in seen}
        for k in seen: seen[k]|=cur[k]
        con.execute("INSERT INTO growth_rings VALUES(?,?,?,?,?,?,?,?,?)",(m,len(seen['skills']),len(seen['topics']),len(seen['places']),len(seen['roles']),js(new['skills']),js(new['topics']),js(new['places']),js(new['roles'])))
    return len(months)

def build_novelty(con):
    days=valid_daily(con)
    history=collections.deque() # (date,set)
    hist_count=collections.Counter()
    candidates=[]
    for r in days:
        date=r['date']; text=memory_text(con,r['id']); toks=set(anchors(text))
        # purge >90d
        while history and (d(date)-d(history[0][0])).days>90:
            _,old=history.popleft()
            for x in old:
                hist_count[x]-=1
                if hist_count[x]<=0: del hist_count[x]
        if len(text)>=120 and toks:
            new=[x for x in toks if hist_count.get(x,0)==0]
            disp=[x for x in display_anchors(text) if hist_count.get(x,0)==0 and x not in STOP_PHRASES]; rare=sorted(disp,key=lambda x:(-len(x),x))[:12]
            score=len(new)/max(1,len(toks))
            # dampen first 21 days because there is little history
            if len(history)<14: score*=len(history)/14
            candidates.append((score,date,r['id'],r['source_path'],len(text),rare))
        history.append((date,toks))
        for x in toks: hist_count[x]+=1
    candidates=sorted(candidates,reverse=True)[:100]
    for score,date,mid,src,chars,rare in candidates:
        con.execute("INSERT INTO novelty_days(date,memory_id,source_path,char_count,novelty_score,new_terms_json,reason) VALUES(?,?,?,?,?,?,?)",(date,mid,src,chars,round(score,4),js(rare),'Novelty compares visible lexical anchors with the preceding 90 recorded days. A high score means “different wording/topics appeared”, not a psychological change.'))
    return len(candidates)

def entropy(vals):
    s=sum(vals)
    if s<=0:return 0.0
    return -sum((v/s)*math.log(v/s) for v in vals if v>0)

def build_bridge_days(con):
    out=[]
    for r in valid_daily(con):
        mid=r['id']
        skills=[x[0] for x in con.execute("SELECT DISTINCT sd.name FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id=?",(mid,))]
        topics=[x[0] for x in con.execute("SELECT DISTINCT topic FROM topic_mentions WHERE memory_id=?",(mid,))]
        places=[x[0] for x in con.execute("SELECT DISTINCT place FROM place_mentions WHERE memory_id=?",(mid,))]
        roles=[x[0] for x in con.execute("SELECT DISTINCT role FROM role_mentions WHERE memory_id=?",(mid,))]
        counts=[len(skills),len(topics),len(places),len(roles)]
        dom=sum(c>0 for c in counts); ent=entropy([c for c in counts if c>0])
        score=len(skills)*.75+len(topics)*1.2+len(places)*.8+len(roles)*.6+dom*1.5+ent
        if score>=5:
            labels=(skills[:5]+topics[:5]+places[:3]+roles[:3])[:14]
            out.append((score,r['date'],mid,r['source_path'],len(skills),len(topics),len(places),len(roles),dom,ent,labels))
    out=sorted(out,reverse=True)[:120]
    for score,date,mid,src,sc,tc,pc,rc,dom,ent,labels in out:
        con.execute("INSERT INTO bridge_days(date,memory_id,source_path,skill_count,topic_count,place_count,role_count,domain_count,entropy,bridge_score,labels_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(date,mid,src,sc,tc,pc,rc,dom,round(ent,4),round(score,3),js(labels)))
    return len(out)

def build_attention(con):
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 ORDER BY 1")]
    for m in months:
        vals=[(r['topic'],r['c']) for r in con.execute("SELECT tm.topic,SUM(tm.mention_count)c FROM topic_mentions tm JOIN memories mm ON mm.id=tm.memory_id WHERE mm.kind='daily' AND substr(mm.date,1,7)=? GROUP BY tm.topic ORDER BY c DESC",(m,))]
        total=sum(v for _,v in vals); H=entropy([v for _,v in vals]); Hn=H/math.log(len(vals)) if len(vals)>1 else 0; top=vals[0][1]/total if total and vals else 0
        desc='concentrated' if Hn<.58 else ('diversified' if Hn>.82 else 'balanced')
        con.execute("INSERT INTO attention_portfolio VALUES(?,?,?,?,?,?)",(m,round(H,4),round(Hn,4),round(top,4),js([{'topic':k,'mentions':v,'share':round(v/total,3) if total else 0} for k,v in vals[:6]]),f'{desc}: normalized topic entropy {Hn:.2f}; top topic share {top:.0%}. This describes recorded attention, not actual time spent.'))
    return len(months)

def prepare_docs(con):
    global _DOCS,_POST,_DF
    if _DOCS is not None:return _DOCS,_POST
    docs=[];post=collections.defaultdict(list)
    for r in valid_daily(con):
        text=memory_text(con,r['id']); aa=set(anchors(text))
        doc={'id':r['id'],'date':r['date'],'source_path':r['source_path'],'text':text,'anchors':aa}
        idx=len(docs);docs.append(doc)
        for a in aa:post[a.lower()].append(idx)
    _DOCS,_POST=docs,post
    _DF={k:len(v) for k,v in post.items()}
    return docs,post

def link_later(con,src_date,text,min_gap=14,max_gap=540,limit=80):
    docs,post=prepare_docs(con)
    a=set(anchors(text)); a={x for x in a if len(x)>=2 and x not in STOP_PHRASES}
    if not a:return []
    candidates=set()
    for term in a:candidates.update(post.get(term.lower(),[]))
    scored=[]
    for idx in candidates:
        r=docs[idx]; gap=(d(r['date'])-d(src_date)).days
        if gap<min_gap or gap>max_gap:continue
        shared=a&r['anchors']
        meaningful=[];score=0.0
        for x in shared:
            xl=x.lower(); df=(_DF or {}).get(xl,999)
            if any(g in x for g in GENERIC_FRAGMENTS): continue
            configured=any(xl==v.lower() for v in VOCAB)
            latin=bool(re.search(r'[A-Za-z]',x))
            rare=(len(x)>=4 and df<=4) or (len(x)>=3 and df<=2)
            if configured or latin or rare:
                meaningful.append(x)
                score += (2.2 if configured else 1.5) + min(2.0, math.log((len(docs)+1)/(df+1)+1))
        if score>=3.2 and (len(meaningful)>=2 or any(x.lower() in {v.lower() for v in VOCAB} for x in meaningful)):
            scored.append((score,{'date':r['date'],'source_path':r['source_path'],'content':r['text']},meaningful))
    return sorted(scored,key=lambda x:(-x[0],x[1]['date']))[:limit]

def build_promises(con):
    rows=con.execute("""SELECT m.id,m.date,m.source_path,s.normalized_name,s.content FROM sections s JOIN memories m ON m.id=s.memory_id
                        WHERE m.kind='daily' AND m.date_anomaly=0 AND s.normalized_name IN ('日记','自我探索','体系构建','日程') AND length(trim(s.content))>0 ORDER BY m.date""").fetchall()
    items=[]
    for r in rows:
        for sent in split_sentences(r['content']):
            trig=next((x for x in FUTURE_MARKERS if x in sent),None)
            if not trig:continue
            matches=link_later(con,r['date'],sent,14,420,8)
            # suppress weak personal-dialogue "想要" lines unless there is a clearer marker or later echo
            if trig=='想要' and not matches and len(sent)<16:continue
            status='recent' if (d('2026-08-13')-d(r['date'])).days<60 else ('recurring' if len(matches)>=2 else ('echoed' if matches else 'quiet'))
            if matches:
                first=matches[0][1]; shared=matches[0][2]
                first_date,first_src=first['date'],first['source_path']
            else:first_date=first_src=None;shared=[]
            items.append((r['date'],r['id'],r['source_path'],r['normalized_name'],sent,trig,status,len(matches),first_date,first_src,shared))
    # prioritize explicit plans and entries with echoes, but keep range across time
    score=lambda x: (2 if x[6] in ('recurring','echoed') else 0)+(2 if x[5] in ('计划','打算','目标是','准备做','想做') else 0)+min(len(x[4])/80,1)
    items=sorted(items,key=score,reverse=True)[:240]
    for x in items:
        con.execute("INSERT INTO promise_ledger(date,memory_id,source_path,section,text,trigger,status,echo_count,first_echo_date,first_echo_source,shared_terms_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(*x[:10],js(x[10]),'This is a future-facing statement candidate. Later echoes mean related language reappeared; they do not prove completion or causation.'))
    return len(items)

def build_future_echoes(con):
    rows=con.execute("""SELECT m.date,m.source_path,s.content FROM sections s JOIN memories m ON m.id=s.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND s.normalized_name IN ('日记','自我探索','体系构建') ORDER BY m.date""").fetchall()
    out=[]
    for r in rows:
        for sent in split_sentences(r['content']):
            if not any(x in sent for x in FORECAST_MARKERS):continue
            if len(sent)>150 or '会不会' in sent or ('有没有' in sent and '?' in sent): continue
            ms=link_later(con,r['date'],sent,21,540,3)
            if not ms:continue
            score,later,shared=ms[0]; gap=(d(later['date'])-d(r['date'])).days
            if gap<21:continue
            out.append((score,gap,r['date'],r['source_path'],sent,later['date'],later['source_path'],norm(later['content'])[:240],shared))
    out=sorted(out,reverse=True)[:100]
    for score,gap,sd,ss,st,ld,ls,le,shared in out:
        con.execute("INSERT INTO future_echoes(source_date,source_path,source_text,later_date,later_source,later_excerpt,gap_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?)",(sd,ss,st,ld,ls,le,gap,js(shared[:12]),round(score,2),'A later passage shares visible anchors with an earlier future-facing statement. “Echo” is not the same as a correct prediction or fulfilled goal.'))
    return len(out)

def build_identity(con):
    rows=con.execute("""SELECT m.id,m.date,m.source_path,s.normalized_name,s.content FROM sections s JOIN memories m ON m.id=s.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND s.normalized_name IN ('日记','自我探索','体系构建') ORDER BY m.date""").fetchall()
    out=[];seen=set()
    for r in rows:
        for sent in split_sentences(r['content']):
            for typ,markers in IDENTITY_MARKERS.items():
                trig=next((x for x in markers if x in sent),None)
                if trig:
                    if typ=='identity':
                        bad=['我是怎么','我是因为','因为我是','你说我是','说我是','问我是','如果我是']
                        start_ok=bool(re.match(r'^(?:我是一个|我是个|我算是|我觉得自己|我认为自己|我一直是|我真的是|我确实是|原来我是|其实我是一个|不过我是一个|我可能是一个|我也许是一个)',sent))
                        if any(x in sent for x in bad) or not start_ok: continue
                    key=(r['date'],sent)
                    if key not in seen:
                        seen.add(key);out.append((r['date'],r['id'],r['source_path'],r['normalized_name'],typ,sent,trig))
                    break
    for x in out: con.execute("INSERT INTO identity_ledger(date,memory_id,source_path,section,identity_type,text,trigger) VALUES(?,?,?,?,?,?,?)",x)
    return len(out)

def build_motifs(con):
    agg={}
    for r in con.execute("SELECT left_date,right_date,left_memory_id,right_memory_id,shared_terms_json FROM memory_echoes"):
        try:terms=json.loads(r['shared_terms_json'] or '[]')
        except:terms=[]
        for term in terms:
            term=norm(term)
            if len(term)<3 or term in STOP_PHRASES or any(g in term for g in GENERIC_FRAGMENTS):continue
            a=agg.setdefault(term,{'pairs':0,'dates':set(),'mids':set()})
            a['pairs']+=1;a['dates'].update([r['left_date'],r['right_date']]);a['mids'].update([r['left_memory_id'],r['right_memory_id']])
    candidates=[]
    for motif,a in agg.items():
        dates=sorted(x for x in a['dates'] if x)
        if a['pairs']<2 or len(dates)<3:continue
        span=(d(dates[-1])-d(dates[0])).days
        if span<60:continue
        src=[r[0] for mid in list(a['mids'])[:8] for r in con.execute("SELECT source_path FROM memories WHERE id=?",(mid,))]
        candidates.append((a['pairs'],span,motif,dates[0],dates[-1],src))
    candidates=sorted(candidates,key=lambda x:(x[0],x[1],len(x[2])),reverse=True)[:120]
    for pairs,span,motif,first,last,src in candidates:
        con.execute("INSERT INTO motif_atlas(motif,echo_pairs,first_date,last_date,span_days,source_paths_json,note) VALUES(?,?,?,?,?,?,?)",(motif,pairs,first,last,span,js(src[:6]),'Motif comes from shared terms inside distant Memory Echo pairs. It is a lexical recurrence, not a hidden psychological theme.'))
    return len(candidates)

def normalize_scores(vals):
    if not vals:return {}
    xs=sorted(vals);lo=xs[max(0,int(len(xs)*.05)-1)];hi=xs[min(len(xs)-1,int(len(xs)*.95))]
    if hi<=lo:hi=lo+1
    return lambda v:max(0,min(1,(v-lo)/(hi-lo)))

def build_turning_points(con):
    nov={r['date']:r['novelty_score'] for r in con.execute("SELECT date,novelty_score FROM novelty_days")}
    br={r['date']:r['bridge_score'] for r in con.execute("SELECT date,bridge_score FROM bridge_days")}
    decisions=collections.Counter(r['date'] for r in con.execute("SELECT date FROM decision_candidates WHERE date IS NOT NULL"))
    ach=collections.Counter(r['date'] for r in con.execute("SELECT date FROM achievement_candidates WHERE date IS NOT NULL"))
    ideas=collections.Counter(r['date'] for r in con.execute("SELECT date FROM idea_candidates WHERE date IS NOT NULL"))
    dates=sorted(set(nov)|set(br)|set(decisions)|set(ach)|set(ideas))
    nn=normalize_scores(list(nov.values())) if nov else (lambda x:0)
    bn=normalize_scores(list(br.values())) if br else (lambda x:0)
    out=[]
    for date in dates:
        sig=[];score=0
        if date in nov:score+=nn(nov[date])*2.0;sig.append({'signal':'novelty','value':round(nov[date],3)})
        if date in br:score+=bn(br[date])*2.2;sig.append({'signal':'bridge','value':round(br[date],2)})
        if decisions[date]:score+=min(2,decisions[date]*.35);sig.append({'signal':'decisions','value':decisions[date]})
        if ach[date]:score+=min(2,ach[date]*.5);sig.append({'signal':'milestones','value':ach[date]})
        if ideas[date]:score+=min(1.2,ideas[date]*.2);sig.append({'signal':'ideas','value':ideas[date]})
        if score<2.7:continue
        r=con.execute("SELECT id,source_path FROM memories WHERE kind='daily' AND date=? LIMIT 1",(date,)).fetchone()
        if r:out.append((score,date,r['id'],r['source_path'],sig))
    out=sorted(out,reverse=True)[:80]
    for score,date,mid,src,sig in out:
        con.execute("INSERT INTO turning_points(date,memory_id,source_path,score,signals_json,reason) VALUES(?,?,?,?,?,?)",(date,mid,src,round(score,3),js(sig),'Turning Point Index ranks structurally dense dates using novelty, cross-domain bridge signals, decisions, milestones and ideas. It is a review queue, not a claim that the day changed your life.'))
    return len(out)

def cand_rows(con,table,kind):
    return [dict(r) | {'kind':kind} for r in con.execute(f"SELECT c.date,m.source_path,c.text FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL ORDER BY c.date")]

def build_reopenings(con):
    allc=cand_rows(con,'idea_candidates','idea')+cand_rows(con,'question_candidates','question')+cand_rows(con,'project_candidates','project')
    bykind=collections.defaultdict(list)
    for x in allc:bykind[x['kind']].append(x)
    out=[]
    for kind,arr in bykind.items():
        arr=sorted(arr,key=lambda x:x['date'])
        aset=[set(anchors(x['text'])) for x in arr]
        post=collections.defaultdict(set)
        for i,aa in enumerate(aset):
            for term in aa:post[term.lower()].add(i)
        for i,a in enumerate(arr):
            aa=aset[i]
            if not aa:continue
            cand=set()
            for term in aa:cand.update(post.get(term.lower(),set()))
            best=None
            for j in cand:
                if j<=i:continue
                b=arr[j];gap=(d(b['date'])-d(a['date'])).days
                if gap<75 or gap>600:continue
                shared=aa&aset[j]
                strong=[x for x in shared if not any(g in x for g in GENERIC_FRAGMENTS) and (x.lower() in {v.lower() for v in VOCAB} or re.search(r'[A-Za-z]',x) or len(x)>=4)]
                score=len(strong)*1.7
                if score>=3.4 and (best is None or score>best[0]):best=(score,b,strong,gap)
            if best:
                score,b,shared,gap=best;out.append((score,gap,kind,a,b,shared))
    seen=set();final=[]
    for score,gap,kind,a,b,shared in sorted(out,reverse=True,key=lambda x:(x[0],x[1])):
        key=(kind,a['date'],b['date'],tuple(sorted(shared)[:3]))
        if key in seen:continue
        seen.add(key);final.append((score,gap,kind,a,b,shared))
        if len(final)>=100:break
    for score,gap,kind,a,b,shared in final:
        con.execute("INSERT INTO thread_reopenings(kind,first_date,first_source,first_text,return_date,return_source,return_text,gap_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(kind,a['date'],a['source_path'],a['text'],b['date'],b['source_path'],b['text'],gap,js(shared[:12]),round(score,2),'This links a later candidate to an earlier similar one after a long quiet interval. It may be a reopening, continuation, or coincidence; it does not prove closure.'))
    return len(final)

def build_skill_momentum(con):
    latest=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    L=d(latest);recent_start=(L-datetime.timedelta(days=59)).isoformat();prior_start=(L-datetime.timedelta(days=239)).isoformat();prior_end=(L-datetime.timedelta(days=60)).isoformat()
    names=[r[0] for r in con.execute("SELECT name FROM skill_definitions ORDER BY id")]
    for name in names:
        def stat(a,b):
            r=con.execute("""SELECT COUNT(DISTINCT m.date) days,COALESCE(SUM(sa.mention_count),0) mentions FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE sd.name=? AND m.kind='daily' AND m.date BETWEEN ? AND ?""",(name,a,b)).fetchone();return r['days'],r['mentions']
        rd,rm=stat(recent_start,latest);pd,pm=stat(prior_start,prior_end)
        rr=rd/60;pr=pd/180;mom=rr-pr
        if rd==0 and pd==0:status='quiet'
        elif pd==0 and rd>0:status='newly-visible'
        elif mom>.045:status='warming'
        elif mom<-.045:status='cooling'
        else:status='steady'
        ld=con.execute("SELECT MAX(m.date) FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE sd.name=? AND m.kind='daily' AND m.date_anomaly=0",(name,)).fetchone()[0]
        con.execute("INSERT INTO skill_momentum VALUES(?,?,?,?,?,?,?,?,?,?,?)",(name,rd,pd,rm,pm,round(rr,4),round(pr,4),round(mom,4),status,ld,'Momentum compares recorded evidence-days per calendar day in the latest 60 days against the preceding 180 days. It is activity visibility, not skill competence.'))
    return len(names)

def cosine(a,b):
    keys=set(a)|set(b)
    if not keys:return 0
    dot=sum(a.get(k,0)*b.get(k,0) for k in keys);na=math.sqrt(sum(v*v for v in a.values()));nb=math.sqrt(sum(v*v for v in b.values()))
    return dot/(na*nb) if na and nb else 0

def monthly_map(con,year,month,kind):
    if kind=='topic':
        return {r['topic']:r['c'] for r in con.execute("SELECT tm.topic,SUM(tm.mention_count)c FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.year=? AND cast(substr(m.date,6,2) as int)=? GROUP BY tm.topic",(year,month))}
    return {r['name']:r['c'] for r in con.execute("SELECT sd.name,SUM(sa.mention_count)c FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.year=? AND cast(substr(m.date,6,2) as int)=? GROUP BY sd.name",(year,month))}

def deltas(a,b):
    keys=set(a)|set(b);sa=sum(a.values()) or 1;sb=sum(b.values()) or 1
    ds=[(b.get(k,0)/sb-a.get(k,0)/sa,k,a.get(k,0),b.get(k,0)) for k in keys]
    rising=[{'label':k,'delta':round(x,3),'left':av,'right':bv} for x,k,av,bv in sorted(ds,reverse=True) if x>0][:6]
    falling=[{'label':k,'delta':round(x,3),'left':av,'right':bv} for x,k,av,bv in sorted(ds) if x<0][:6]
    return rising,falling

def build_seasonal(con):
    years=sorted({r[0] for r in con.execute("SELECT DISTINCT year FROM memories WHERE kind='daily' AND date_anomaly=0")})
    if len(years)<2:return 0
    left,right=years[-2],years[-1];count=0
    for m in range(1,13):
        ld=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0 AND year=? AND cast(substr(date,6,2) as int)=?",(left,m)).fetchone()[0]
        rd=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0 AND year=? AND cast(substr(date,6,2) as int)=?",(right,m)).fetchone()[0]
        if ld<3 or rd<3:continue
        ta=monthly_map(con,left,m,'topic');tb=monthly_map(con,right,m,'topic');sa=monthly_map(con,left,m,'skill');sb=monthly_map(con,right,m,'skill')
        rt,ft=deltas(ta,tb);rs,fs=deltas(sa,sb);sim=cosine(ta,tb)
        con.execute("INSERT INTO seasonal_echoes(calendar_month,left_year,right_year,left_days,right_days,topic_similarity,rising_topics_json,falling_topics_json,rising_skills_json,falling_skills_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(m,left,right,ld,rd,round(sim,4),js(rt),js(ft),js(rs),js(fs),'Same calendar month across two recorded years. Differences are archive composition, not proof that season caused the change.'))
        count+=1
    return count

def build_timefold_layer(con,cfg=None):
    ensure_schema(con)
    prepare_docs(con)
    if con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0] == 0:
        report={'growth_rings':0,'novelty_days':0,'bridge_days':0,'attention_months':0,'promise_candidates':0,'future_echoes':0,'identity_statements':0,'motifs':0,'turning_point_candidates':0,'thread_reopenings':0,'skill_momentum':0,'seasonal_echoes':0}
        con.commit(); return report
    report={
      'growth_rings':build_growth_rings(con),
      'novelty_days':build_novelty(con),
      'bridge_days':build_bridge_days(con),
      'attention_months':build_attention(con),
      'promise_candidates':build_promises(con),
      'future_echoes':build_future_echoes(con),
      'identity_statements':build_identity(con),
      'motifs':build_motifs(con),
      'turning_point_candidates':build_turning_points(con),
      'thread_reopenings':build_reopenings(con),
      'skill_momentum':build_skill_momentum(con),
      'seasonal_echoes':build_seasonal(con),
    }
    con.commit();return report

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    print(json.dumps(build_timefold_layer(con,CFG),ensure_ascii=False,indent=2));con.close()

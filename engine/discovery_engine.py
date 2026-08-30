#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, re, math, datetime, collections, itertools, statistics

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
TODAY=datetime.date(2026,8,13)
STOP={'今天','现在','觉得','感觉','就是','然后','还是','一个','没有','什么','怎么','为什么','这个','那个','一下','时候','可能','应该','比较','自己','以后','已经','真的','开始','进行','可以','需要','事情','东西','问题','日记','计划','想要'}

def d(s):
    try:return datetime.date.fromisoformat(s)
    except:return None

def cos(a,b,keys):
    dot=sum(a.get(k,0)*b.get(k,0) for k in keys)
    na=math.sqrt(sum(a.get(k,0)**2 for k in keys)); nb=math.sqrt(sum(b.get(k,0)**2 for k in keys))
    return dot/(na*nb) if na and nb else 0.0

def qtile(vals,q=.75):
    vals=sorted(vals)
    if not vals:return 0
    pos=(len(vals)-1)*q; lo=int(pos); hi=min(lo+1,len(vals)-1); w=pos-lo
    return vals[lo]*(1-w)+vals[hi]*w

def meaningful_terms():
    out=set(CFG.get('word_terms',[]))
    for topic,terms in CFG.get('topics',{}).items(): out.add(topic); out.update(terms)
    for sk in CFG.get('skills',[]): out.add(sk['name']); out.update(sk.get('terms',[]))
    out.update(CFG.get('places',[])); out.update(CFG.get('roles',[]))
    return sorted((x for x in out if isinstance(x,str) and len(x.strip())>=2),key=len,reverse=True)

TERMS=meaningful_terms()

def anchors(text,limit=5):
    low=text.lower(); found=[]
    for term in TERMS:
        if term.lower() in low and term.lower() not in {x.lower() for x in found}:
            found.append(term)
            if len(found)>=limit:return found
    # fallback to compact CJK chunks; only use reasonably specific fragments
    chunks=[]
    for run in re.findall(r'[\u4e00-\u9fff]{4,12}',text):
        for n in (4,3):
            for i in range(max(0,len(run)-n+1)):
                g=run[i:i+n]
                if not any(s in g for s in STOP): chunks.append(g)
    for g,_ in collections.Counter(chunks).most_common(limit-len(found)):
        found.append(g)
    return found[:limit]

def shingles(text):
    out=set()
    for run in re.findall(r'[\u4e00-\u9fff]{3,}',text):
        for i in range(len(run)-2):
            g=run[i:i+3]
            if not any(s in g for s in STOP): out.add(g)
    for x in re.findall(r'[A-Za-z][A-Za-z0-9+.#_-]{2,}',text.lower()): out.add('@'+x)
    for a in anchors(text,8): out.add('#'+a.lower())
    return out

def ensure_schema(con):
    con.executescript('''
    CREATE TABLE IF NOT EXISTS personal_eras(id INTEGER PRIMARY KEY,start_month TEXT,end_month TEXT,title_seed TEXT,dominant_topics_json TEXT,dominant_skills_json TEXT,entries INTEGER,char_count INTEGER,boundary_score REAL,reason TEXT);
    CREATE TABLE IF NOT EXISTS return_events(id INTEGER PRIMARY KEY,kind TEXT,label TEXT,prev_date TEXT,return_date TEXT,gap_days INTEGER,prev_memory_id INTEGER,return_memory_id INTEGER);
    CREATE TABLE IF NOT EXISTS dormant_threads(id INTEGER PRIMARY KEY,kind TEXT,anchor TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,dormant_days INTEGER,status TEXT,samples_json TEXT,source_paths_json TEXT);
    CREATE TABLE IF NOT EXISTS idea_genealogies(id INTEGER PRIMARY KEY,title_seed TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,shared_terms_json TEXT,samples_json TEXT,source_paths_json TEXT);
    CREATE TABLE IF NOT EXISTS voice_monthly(month TEXT PRIMARY KEY,entries INTEGER,avg_chars REAL,reflection_ratio REAL,question_rate REAL,idea_rate REAL,schedule_rate REAL,belief_rate REAL,weather TEXT);
    CREATE TABLE IF NOT EXISTS before_after_windows(id INTEGER PRIMARY KEY,anchor_type TEXT,anchor_date TEXT,anchor_text TEXT,source_path TEXT,before_start TEXT,after_end TEXT,rising_topics_json TEXT,falling_topics_json TEXT,rising_skills_json TEXT,falling_skills_json TEXT,note TEXT);
    CREATE TABLE IF NOT EXISTS skill_topic_bridges(skill TEXT,topic TEXT,days INTEGER,first_seen TEXT,last_seen TEXT,PRIMARY KEY(skill,topic));
    CREATE TABLE IF NOT EXISTS month_portraits(month TEXT PRIMARY KEY,entries INTEGER,char_count INTEGER,weather TEXT,dominant_topics_json TEXT,dominant_skills_json TEXT,notable_days_json TEXT);
    CREATE TABLE IF NOT EXISTS archive_health(key TEXT PRIMARY KEY,label TEXT,value TEXT,status TEXT,note TEXT);
    CREATE TABLE IF NOT EXISTS trajectory_signals(id INTEGER PRIMARY KEY,kind TEXT,label TEXT,first_date TEXT,first_month TEXT,peak_month TEXT,lead_days INTEGER,first_value INTEGER,peak_value INTEGER,first_source TEXT,reason TEXT);
    ''')
    for t in ('personal_eras','return_events','dormant_threads','idea_genealogies','voice_monthly','before_after_windows','skill_topic_bridges','month_portraits','archive_health','trajectory_signals'):
        con.execute(f'DELETE FROM {t}')

def monthly_vectors(con):
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    topic_names=sorted({r[0] for r in con.execute('SELECT DISTINCT topic FROM topic_mentions')})
    skill_names=sorted({r[0] for r in con.execute('SELECT name FROM skill_definitions')})
    vec={}
    for m in months:
        v={}
        for r in con.execute("SELECT tm.topic,SUM(tm.mention_count) c FROM topic_mentions tm JOIN memories mm ON mm.id=tm.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=? GROUP BY tm.topic",(m,)): v['T:'+r['topic']]=r['c']
        for r in con.execute("SELECT sd.name,SUM(sa.mention_count) c FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories mm ON mm.id=sa.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=? GROUP BY sd.name",(m,)): v['S:'+r['name']]=r['c']
        vec[m]=v
    return months,vec,sorted(['T:'+x for x in topic_names]+['S:'+x for x in skill_names])

def build_eras(con):
    months,vec,keys=monthly_vectors(con)
    if not months:return 0
    shifts=[]
    for i in range(1,len(months)):
        shifts.append((1-cos(vec[months[i-1]],vec[months[i]],keys),i))
    # Choose a small set of well-spaced structural boundaries. We deliberately do
    # not require a dramatic threshold: subtle shifts can still be useful as
    # chapter candidates, but are labelled as candidates rather than facts.
    candidates=sorted(shifts,reverse=True)
    chosen=[]
    for score,i in candidates:
        if i<3 or i>len(months)-3: continue
        if all(abs(i-j)>=3 for _,j in chosen):
            chosen.append((score,i))
        if len(chosen)>=4:break
    chosen=sorted(chosen,key=lambda x:x[1])
    cuts=[0]+[i for _,i in chosen]+[len(months)]
    boundaries={i:s for s,i in chosen}
    for a,b in zip(cuts,cuts[1:]):
        seg=months[a:b]
        if not seg:continue
        topic=collections.Counter(); skill=collections.Counter(); entries=chars=0
        for m in seg:
            for k,v in vec[m].items(): (topic if k.startswith('T:') else skill)[k[2:]]+=v
            row=con.execute('SELECT daily_entries,char_count FROM month_stats WHERE month=?',(m,)).fetchone()
            if row: entries+=row['daily_entries']; chars+=row['char_count']
        tops=topic.most_common(4); sks=skill.most_common(4)
        title=' × '.join([x[0] for x in tops[:2]]) or (sks[0][0] if sks else 'Recorded life')
        bs=boundaries.get(a,0)
        con.execute('INSERT INTO personal_eras(start_month,end_month,title_seed,dominant_topics_json,dominant_skills_json,entries,char_count,boundary_score,reason) VALUES(?,?,?,?,?,?,?,?,?)',
                    (seg[0],seg[-1],title,json.dumps(tops,ensure_ascii=False),json.dumps(sks,ensure_ascii=False),entries,chars,round(bs,6),'按相邻月份的主题+技能向量变化提出的阶段候选。边界是结构变化线索，不等于真实人生阶段已被证明。'))
    return con.execute('SELECT COUNT(*) FROM personal_eras').fetchone()[0]

def build_returns(con):
    series=[]
    # topics
    for label in [r[0] for r in con.execute('SELECT DISTINCT topic FROM topic_mentions')]:
        rs=list(con.execute("SELECT DISTINCT m.id,m.date FROM topic_mentions t JOIN memories m ON m.id=t.memory_id WHERE t.topic=? AND m.kind='daily' AND m.date_anomaly=0 ORDER BY m.date",(label,)))
        series.append(('topic',label,rs))
    for label in [r[0] for r in con.execute('SELECT name FROM skill_definitions')]:
        rs=list(con.execute("SELECT DISTINCT m.id,m.date FROM skill_activity a JOIN skill_definitions s ON s.id=a.skill_id JOIN memories m ON m.id=a.memory_id WHERE s.name=? AND m.kind='daily' AND m.date_anomaly=0 ORDER BY m.date",(label,)))
        series.append(('skill',label,rs))
    for kind,label,rs in series:
        for x,y in zip(rs,rs[1:]):
            gap=(d(y['date'])-d(x['date'])).days
            if gap>=60:
                con.execute('INSERT INTO return_events(kind,label,prev_date,return_date,gap_days,prev_memory_id,return_memory_id) VALUES(?,?,?,?,?,?,?)',(kind,label,x['date'],y['date'],gap,x['id'],y['id']))
    return con.execute('SELECT COUNT(*) FROM return_events').fetchone()[0]

def build_dormant(con):
    rows=[]
    for kind,table in [('question','question_candidates'),('idea','idea_candidates'),('project','project_candidates')]:
        groups=collections.defaultdict(list)
        for r in con.execute(f"SELECT c.id,c.memory_id,c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.date_anomaly=0 ORDER BY c.date"):
            aa=anchors(r['text'],4)
            for a in aa: groups[a.lower()].append(dict(r)|{'anchor_label':a})
        for k,items in groups.items():
            # unique dates only, avoid template-like repetition
            bydate={x['date']:x for x in items}; items=list(bydate.values())
            if len(items)<2:continue
            first=min(x['date'] for x in items); last=max(x['date'] for x in items); dorm=(TODAY-d(last)).days
            if dorm<45:continue
            label=items[0]['anchor_label']; samples=[{'date':x['date'],'text':x['text'][:220]} for x in sorted(items,key=lambda z:z['date'])[:5]]
            paths=list(dict.fromkeys(x['source_path'] for x in sorted(items,key=lambda z:z['date'])[-4:]))
            rows.append((kind,label,len(items),first,last,dorm,'dormant',json.dumps(samples,ensure_ascii=False),json.dumps(paths,ensure_ascii=False)))
    rows.sort(key=lambda x:(x[5],x[2]),reverse=True)
    # de-duplicate highly overlapping anchors by kind
    kept=[]
    for row in rows:
        if any(row[0]==k[0] and (row[1] in k[1] or k[1] in row[1]) for k in kept):continue
        kept.append(row)
        if len(kept)>=80:break
    con.executemany('INSERT INTO dormant_threads(kind,anchor,occurrences,first_date,last_date,dormant_days,status,samples_json,source_paths_json) VALUES(?,?,?,?,?,?,?,?,?)',kept)
    return len(kept)

def build_idea_genealogy(con):
    docs=[]
    for r in con.execute("SELECT c.id,c.memory_id,c.date,c.text,m.source_path FROM idea_candidates c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.date_anomaly=0 ORDER BY c.date"):
        sh=shingles(r['text'])
        if len(sh)>=2:docs.append(dict(r)|{'sh':sh})
    n=len(docs); parent=list(range(n))
    def find(x):
        while parent[x]!=x: parent[x]=parent[parent[x]];x=parent[x]
        return x
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b:parent[b]=a
    # inverted index avoids full dense comparisons
    inv=collections.defaultdict(list)
    for i,x in enumerate(docs):
        for g in x['sh']: inv[g].append(i)
    pair=collections.Counter()
    for ids in inv.values():
        if len(ids)>35:continue
        for a,b in itertools.combinations(ids,2): pair[(a,b)]+=1
    for (a,b),shared in pair.items():
        union_size=len(docs[a]['sh']|docs[b]['sh']); jac=shared/union_size if union_size else 0
        if shared>=2 and jac>=.15: union(a,b)
    groups=collections.defaultdict(list)
    for i,x in enumerate(docs):groups[find(i)].append(x)
    out=[]
    for items in groups.values():
        bydate={x['date']:x for x in items};items=list(bydate.values())
        if len(items)<2:continue
        items=sorted(items,key=lambda x:x['date']); common=collections.Counter()
        for x in items:
            for a in anchors(x['text'],6):common[a]+=1
        shared=[x for x,c in common.most_common(6) if c>=2]
        title=' / '.join(shared[:2]) if shared else re.sub(r'\s+',' ',items[0]['text'])[:24]
        first,last=items[0]['date'],items[-1]['date']; span=(d(last)-d(first)).days
        samples=[{'date':x['date'],'text':x['text'][:250]} for x in items[:6]]
        paths=list(dict.fromkeys(x['source_path'] for x in items))[:6]
        out.append((title,len(items),first,last,span,json.dumps(shared,ensure_ascii=False),json.dumps(samples,ensure_ascii=False),json.dumps(paths,ensure_ascii=False)))
    out.sort(key=lambda x:(x[4],x[1]),reverse=True)
    con.executemany('INSERT INTO idea_genealogies(title_seed,occurrences,first_date,last_date,span_days,shared_terms_json,samples_json,source_paths_json) VALUES(?,?,?,?,?,?,?,?)',out[:50])
    return min(50,len(out))

def build_voice(con):
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    for m in months:
        ids=[r[0] for r in con.execute("SELECT id FROM memories WHERE kind='daily' AND date_anomaly=0 AND substr(date,1,7)=?",(m,))]
        if not ids:continue
        qs=','.join('?'*len(ids))
        mt=con.execute(f'SELECT SUM(char_count) chars,SUM(schedule_items) schedules FROM memory_metrics WHERE memory_id IN ({qs})',ids).fetchone()
        total=mt['chars'] or 0; entries=len(ids)
        ref=con.execute(f"SELECT COALESCE(SUM(length(content)),0) FROM sections WHERE memory_id IN ({qs}) AND normalized_name IN ('自我探索','体系构建')",ids).fetchone()[0]
        def cnt(t):return con.execute(f"SELECT COUNT(*) FROM {t} WHERE memory_id IN ({qs})",ids).fetchone()[0]
        qr,ir,br=cnt('question_candidates')/entries,cnt('idea_candidates')/entries,cnt('belief_candidates')/entries
        sr=(mt['schedules'] or 0)/entries; rr=ref/max(1,total); avg=total/entries
        if avg<500:weather='Sparse'
        elif rr>=.34:weather='Reflective'
        elif qr>=2.2 and ir>=1.0:weather='Exploratory'
        elif sr>=4 and rr<.22:weather='Action-heavy'
        elif br>=1.8:weather='Conceptual'
        else:weather='Mixed'
        con.execute('INSERT INTO voice_monthly VALUES(?,?,?,?,?,?,?,?,?)',(m,entries,round(avg,1),round(rr,4),round(qr,3),round(ir,3),round(sr,3),round(br,3),weather))
    return con.execute('SELECT COUNT(*) FROM voice_monthly').fetchone()[0]

def _window_counts(con,start,end):
    topics=collections.Counter(); skills=collections.Counter()
    for r in con.execute("SELECT t.topic,SUM(t.mention_count) c FROM topic_mentions t JOIN memories m ON m.id=t.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date BETWEEN ? AND ? GROUP BY t.topic",(start,end)):topics[r['topic']]=r['c']
    for r in con.execute("SELECT s.name,SUM(a.mention_count) c FROM skill_activity a JOIN skill_definitions s ON s.id=a.skill_id JOIN memories m ON m.id=a.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date BETWEEN ? AND ? GROUP BY s.name",(start,end)):skills[r['name']]=r['c']
    return topics,skills

def deltas(before,after,limit=4):
    keys=set(before)|set(after); diff=[(after.get(k,0)-before.get(k,0),k,before.get(k,0),after.get(k,0)) for k in keys]
    rise=[{'label':k,'delta':v,'before':b,'after':a} for v,k,b,a in sorted(diff,reverse=True) if v>0][:limit]
    fall=[{'label':k,'delta':-v,'before':b,'after':a} for v,k,b,a in sorted(diff) if v<0][:limit]
    return rise,fall

def build_before_after(con):
    candidates=[]
    for typ,table in [('achievement','achievement_candidates'),('decision','decision_candidates')]:
        for r in con.execute(f"SELECT c.date,MIN(c.text) text,COUNT(*) density,MIN(m.source_path) source FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.date_anomaly=0 GROUP BY c.date ORDER BY density DESC,c.date"):
            candidates.append((r['density'],typ,dict(r)))
    candidates.sort(reverse=True,key=lambda x:x[0]); picked=[]
    for _,typ,r in candidates:
        dd=d(r['date'])
        if any(abs((dd-d(x[2]['date'])).days)<21 for x in picked):continue
        picked.append((_,typ,r))
        if len(picked)>=18:break
    for _,typ,r in sorted(picked,key=lambda x:x[2]['date']):
        dd=d(r['date']); bs=(dd-datetime.timedelta(days=30)).isoformat(); be=(dd-datetime.timedelta(days=1)).isoformat(); as_=(dd+datetime.timedelta(days=1)).isoformat(); ae=(dd+datetime.timedelta(days=30)).isoformat()
        bt,bski=_window_counts(con,bs,be); at,aski=_window_counts(con,as_,ae); rt,ft=deltas(bt,at); rs,fs=deltas(bski,aski)
        con.execute('INSERT INTO before_after_windows(anchor_type,anchor_date,anchor_text,source_path,before_start,after_end,rising_topics_json,falling_topics_json,rising_skills_json,falling_skills_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                    (typ,r['date'],r['text'][:380],r['source'],bs,ae,json.dumps(rt,ensure_ascii=False),json.dumps(ft,ensure_ascii=False),json.dumps(rs,ensure_ascii=False),json.dumps(fs,ensure_ascii=False),'只比较事件前后 30 天的记录结构；时间相邻不等于因果。'))
    return len(picked)

def build_bridges(con):
    pair=collections.defaultdict(lambda:{'dates':[]})
    for m in con.execute("SELECT id,date FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date"):
        ss=[r[0] for r in con.execute('SELECT s.name FROM skill_activity a JOIN skill_definitions s ON s.id=a.skill_id WHERE a.memory_id=?',(m['id'],))]
        ts=[r[0] for r in con.execute('SELECT topic FROM topic_mentions WHERE memory_id=?',(m['id'],))]
        for s in ss:
            for t in ts:pair[(s,t)]['dates'].append(m['date'])
    out=[]
    for (s,t),x in pair.items():
        dates=sorted(set(x['dates']))
        if len(dates)>=2:out.append((s,t,len(dates),dates[0],dates[-1]))
    out.sort(key=lambda x:x[2],reverse=True);con.executemany('INSERT INTO skill_topic_bridges VALUES(?,?,?,?,?)',out)
    return len(out)

def build_portraits(con):
    for v in con.execute('SELECT * FROM voice_monthly ORDER BY month'):
        m=v['month']; topics=[dict(r) for r in con.execute("SELECT t.topic,SUM(t.mention_count) mentions FROM topic_mentions t JOIN memories mm ON mm.id=t.memory_id WHERE substr(mm.date,1,7)=? AND mm.kind='daily' AND mm.date_anomaly=0 GROUP BY t.topic ORDER BY mentions DESC LIMIT 5",(m,))]
        skills=[dict(r) for r in con.execute("SELECT s.name,SUM(a.mention_count) mentions FROM skill_activity a JOIN skill_definitions s ON s.id=a.skill_id JOIN memories mm ON mm.id=a.memory_id WHERE substr(mm.date,1,7)=? AND mm.kind='daily' AND mm.date_anomaly=0 GROUP BY s.name ORDER BY mentions DESC LIMIT 5",(m,))]
        days=[]
        for r in con.execute("""SELECT mm.id,mm.date,mm.source_path,mt.char_count,
             (SELECT COUNT(*) FROM idea_candidates i WHERE i.memory_id=mm.id) ideas,
             (SELECT COUNT(*) FROM question_candidates q WHERE q.memory_id=mm.id) questions,
             (SELECT COUNT(*) FROM belief_candidates b WHERE b.memory_id=mm.id) beliefs
             FROM memories mm JOIN memory_metrics mt ON mt.memory_id=mm.id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=?""",(m,)):
            score=r['char_count']/800+r['ideas']*.8+r['questions']*.45+r['beliefs']*.5
            days.append((score,dict(r)))
        notable=[]
        for score,r in sorted(days,key=lambda x:x[0],reverse=True)[:4]:notable.append({'date':r['date'],'source_path':r['source_path'],'score':round(score,2),'chars':r['char_count'],'ideas':r['ideas'],'questions':r['questions'],'beliefs':r['beliefs']})
        ms=con.execute('SELECT daily_entries,char_count FROM month_stats WHERE month=?',(m,)).fetchone()
        con.execute('INSERT INTO month_portraits VALUES(?,?,?,?,?,?,?)',(m,ms['daily_entries'],ms['char_count'],v['weather'],json.dumps(topics,ensure_ascii=False),json.dumps(skills,ensure_ascii=False),json.dumps(notable,ensure_ascii=False)))
    return con.execute('SELECT COUNT(*) FROM month_portraits').fetchone()[0]

def build_health(con):
    total=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily'").fetchone()[0]
    valid=con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL").fetchone()[0]
    first,last=con.execute("SELECT MIN(date),MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL").fetchone()
    span=(d(last)-d(first)).days+1 if first and last else 0
    coverage=valid/span if span else 0
    dup=con.execute("SELECT COUNT(*) FROM (SELECT sha256 FROM memories GROUP BY sha256 HAVING COUNT(*)>1)").fetchone()[0]
    anomalies=con.execute("SELECT COUNT(*) FROM memories WHERE date_anomaly=1").fetchone()[0]
    avgsec=con.execute("SELECT AVG(nonempty_sections) FROM memory_metrics mt JOIN memories m ON m.id=mt.memory_id WHERE m.kind='daily' AND m.date_anomaly=0").fetchone()[0] or 0
    refl=con.execute("SELECT COUNT(DISTINCT memory_id) FROM sections s JOIN memories m ON m.id=s.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND s.normalized_name IN ('自我探索','体系构建') AND length(trim(s.content))>0").fetchone()[0]
    values=[
      ('coverage','Recorded day coverage',f'{coverage*100:.1f}%','info',f'{valid} 个有效 daily 文件覆盖 {first} 至 {last} 的 {span} 个自然日；空白日不是错误。'),
      ('duplicates','Duplicate hashes',str(dup),'good' if dup==0 else 'review','按 SHA-256 检查完全相同文件。'),
      ('anomalies','Date anomalies',str(anomalies),'review' if anomalies else 'good','日期异常只标记，不修改原始文件。'),
      ('sections','Average non-empty sections',f'{avgsec:.2f}','info','每天实际写入内容的栏目平均数量。'),
      ('reflection','Reflection coverage',f'{refl/max(1,valid)*100:.1f}%','info','至少在“自我探索/体系构建”之一留下内容的天数比例。'),
      ('source_truth','Raw source policy','IMMUTABLE','good','AI / 统计层均可重建；Vault 原始 Markdown 保留为 Source of Truth。')]
    con.executemany('INSERT INTO archive_health VALUES(?,?,?,?,?)',values)
    return len(values)

def build_signals(con):
    signals=[]
    # skill monthly series
    for label in [r[0] for r in con.execute('SELECT name FROM skill_definitions')]:
        monthly=[]
        for r in con.execute("SELECT substr(m.date,1,7) month,SUM(a.mention_count) c,MIN(m.date) first_date FROM skill_activity a JOIN skill_definitions s ON s.id=a.skill_id JOIN memories m ON m.id=a.memory_id WHERE s.name=? AND m.kind='daily' AND m.date_anomaly=0 GROUP BY month ORDER BY month",(label,)):monthly.append(dict(r))
        if len(monthly)<2:continue
        peak=max(monthly,key=lambda x:x['c']); first=monthly[0]
        lead=(d(peak['month']+'-01')-d(first['month']+'-01')).days
        if lead>=60 and peak['c']>=max(4,first['c']*2):
            src=con.execute("SELECT source_path FROM memories m JOIN skill_activity a ON a.memory_id=m.id JOIN skill_definitions s ON s.id=a.skill_id WHERE s.name=? AND m.date=? LIMIT 1",(label,first['first_date'])).fetchone()
            signals.append(('skill',label,first['first_date'],first['month'],peak['month'],lead,first['c'],peak['c'],src[0] if src else None,'早期记录先出现，至少两个月后才达到当前档案中的月度峰值；这是“先有微弱信号、后变强”的时间结构，不代表当时已经有明确目标。'))
    for label in [r[0] for r in con.execute('SELECT DISTINCT topic FROM topic_mentions')]:
        monthly=[]
        for r in con.execute("SELECT substr(m.date,1,7) month,SUM(t.mention_count) c,MIN(m.date) first_date FROM topic_mentions t JOIN memories m ON m.id=t.memory_id WHERE t.topic=? AND m.kind='daily' AND m.date_anomaly=0 GROUP BY month ORDER BY month",(label,)):monthly.append(dict(r))
        if len(monthly)<2:continue
        peak=max(monthly,key=lambda x:x['c']); first=monthly[0]; lead=(d(peak['month']+'-01')-d(first['month']+'-01')).days
        if lead>=60 and peak['c']>=max(4,first['c']*2):
            src=con.execute("SELECT source_path FROM memories m JOIN topic_mentions t ON t.memory_id=m.id WHERE t.topic=? AND m.date=? LIMIT 1",(label,first['first_date'])).fetchone()
            signals.append(('topic',label,first['first_date'],first['month'],peak['month'],lead,first['c'],peak['c'],src[0] if src else None,'主题在较早记录中已经出现，随后才进入更高密度月份。First recorded ≠ first in life。'))
    signals.sort(key=lambda x:(x[5],x[7]),reverse=True);con.executemany('INSERT INTO trajectory_signals(kind,label,first_date,first_month,peak_month,lead_days,first_value,peak_value,first_source,reason) VALUES(?,?,?,?,?,?,?,?,?,?)',signals[:80])
    return min(80,len(signals))

def build_discovery_layer(con,cfg=None):
    ensure_schema(con)
    report={
      'personal_eras':build_eras(con),
      'returns':build_returns(con),
      'dormant_threads':build_dormant(con),
      'idea_genealogies':build_idea_genealogy(con),
      'voice_months':build_voice(con),
      'before_after_windows':build_before_after(con),
      'skill_topic_bridges':build_bridges(con),
      'month_portraits':build_portraits(con),
      'archive_health':build_health(con),
      'trajectory_signals':build_signals(con),
    }
    con.commit();return report

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    print(json.dumps(build_discovery_layer(con,CFG),ensure_ascii=False,indent=2));con.close()

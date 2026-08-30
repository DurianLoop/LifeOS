#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, re, math, datetime, itertools, collections

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
CJK_RE=re.compile(r'[\u4e00-\u9fff]{3,}')
ECHO_STOP=('搞笑','不太','有点','感觉','觉得','真的','就是','现在','今天','然后','还是','比较','一个','没有','什么','怎么','这样','时候','可能','应该','东西','一下','的话')

def _analysis_text(con, mid):
    rows=con.execute("SELECT normalized_name,content FROM sections WHERE memory_id=? ORDER BY ordinal",(mid,)).fetchall()
    return '\n'.join(r['content'] for r in rows if r['normalized_name'] in ('日记','自我探索','体系构建') and r['content'])

def _date(s):
    try:return datetime.date.fromisoformat(s)
    except:return None

def _cos(a,b,keys):
    dot=sum(a.get(k,0)*b.get(k,0) for k in keys)
    na=math.sqrt(sum(a.get(k,0)**2 for k in keys)); nb=math.sqrt(sum(b.get(k,0)**2 for k in keys))
    return dot/(na*nb) if na and nb else 0.0

def _merge_shared(items):
    config=[x[1:] for x in items if x.startswith('@')]
    frags=[x for x in items if not x.startswith('@')]
    changed=True
    while changed:
        changed=False
        best=None
        for i,a in enumerate(frags):
            for j,b in enumerate(frags):
                if i==j: continue
                if a in b: best=(i,j,b); break
                if b in a: best=(i,j,a); break
                for k in range(min(len(a),len(b))-1,1,-1):
                    if a[-k:]==b[:k]: best=(i,j,a+b[k:]); break
                if best: break
            if best: break
        if best:
            i,j,m=best; frags=[x for n,x in enumerate(frags) if n not in (i,j)]+[m]; changed=True
    vals=[]
    for x in config+sorted(frags,key=len,reverse=True):
        if x and x not in vals and not any(x in y for y in vals): vals.append(x)
    return vals[:8]

def _ngrams(text):
    out=set()
    for run in CJK_RE.findall(text):
        for n in (3,4):
            if len(run)>=n:
                for i in range(len(run)-n+1):
                    g=run[i:i+n]
                    if not any(x in g for x in ECHO_STOP): out.add(g)
    meaningful=set(CFG.get('word_terms',[]))
    for ts in CFG.get('topics',{}).values(): meaningful.update(ts)
    for sk in CFG.get('skills',[]): meaningful.update(sk.get('terms',[]))
    low=text.lower()
    for term in meaningful:
        if len(term)>=2 and term.lower() in low: out.add('@'+term.lower())
    return out

def ensure_schema(con):
    con.executescript('''
    CREATE TABLE IF NOT EXISTS memory_echoes(id INTEGER PRIMARY KEY,left_memory_id INTEGER,right_memory_id INTEGER,left_date TEXT,right_date TEXT,days_apart INTEGER,score REAL,shared_terms_json TEXT,reason TEXT);
    CREATE TABLE IF NOT EXISTS attention_shifts(id INTEGER PRIMARY KEY,from_month TEXT,to_month TEXT,shift_score REAL,rising_json TEXT,falling_json TEXT);
    CREATE TABLE IF NOT EXISTS weekday_rhythm(weekday INTEGER PRIMARY KEY,label TEXT,entries INTEGER,avg_chars REAL,reflection_days INTEGER,ideas INTEGER,questions INTEGER);
    CREATE TABLE IF NOT EXISTS skill_pairs(skill_a TEXT,skill_b TEXT,days INTEGER,first_seen TEXT,last_seen TEXT,PRIMARY KEY(skill_a,skill_b));
    CREATE TABLE IF NOT EXISTS first_last_mentions(kind TEXT,label TEXT,first_date TEXT,last_date TEXT,total_days INTEGER,total_mentions INTEGER,first_memory_id INTEGER,last_memory_id INTEGER,PRIMARY KEY(kind,label));
    CREATE TABLE IF NOT EXISTS silence_gaps(id INTEGER PRIMARY KEY,start_date TEXT,end_date TEXT,gap_days INTEGER,prev_memory_id INTEGER,next_memory_id INTEGER);
    CREATE TABLE IF NOT EXISTS hidden_chapters(id INTEGER PRIMARY KEY,start_month TEXT,end_month TEXT,title_seed TEXT,dominant_topics_json TEXT,reason TEXT,boundary_score REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS question_threads(id INTEGER PRIMARY KEY,anchor TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,samples_json TEXT);
    CREATE TABLE IF NOT EXISTS curiosity_cards(id INTEGER PRIMARY KEY,card_type TEXT,title TEXT,body TEXT,metric TEXT,source_paths_json TEXT DEFAULT '[]',payload_json TEXT DEFAULT '{}');
    ''')
    for t in ('memory_echoes','attention_shifts','weekday_rhythm','skill_pairs','first_last_mentions','silence_gaps','hidden_chapters','question_threads','curiosity_cards'):
        con.execute(f'DELETE FROM {t}')

def build_echoes(con):
    docs=[]
    for r in con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date"):
        text=_analysis_text(con,r['id'])
        if len(text.strip())<40: continue
        docs.append({'id':r['id'],'date':r['date'],'path':r['source_path'],'grams':_ngrams(text)})
    N=len(docs); df=collections.Counter(g for d in docs for g in d['grams'])
    useful={g for g,c in df.items() if 2<=c<=max(12,int(N*.055))}
    inv=collections.defaultdict(list)
    for i,d in enumerate(docs):
        d['grams'] &= useful
        for g in d['grams']: inv[g].append(i)
    pair_score=collections.defaultdict(float); pair_shared=collections.defaultdict(list)
    for g,idxs in inv.items():
        if len(idxs)>30: continue
        w=(math.log((N+1)/(df[g]+1))+1.0)*(2.2 if g.startswith('@') else 1.0)
        for a,b in itertools.combinations(idxs,2):
            gap=abs((_date(docs[b]['date'])-_date(docs[a]['date'])).days)
            if gap<75: continue
            pair_score[(a,b)] += w
            if len(pair_shared[(a,b)])<12: pair_shared[(a,b)].append(g)
    ranked=[]
    for (a,b),raw in pair_score.items():
        shared=pair_shared[(a,b)]
        if len(shared)<3: continue
        norm=raw/math.sqrt(max(1,len(docs[a]['grams']))*max(1,len(docs[b]['grams'])))
        gap=abs((_date(docs[b]['date'])-_date(docs[a]['date'])).days)
        ranked.append((norm*(1+min(gap,500)/2500),a,b,gap,shared))
    ranked.sort(reverse=True); used=collections.Counter(); kept=[]
    for item in ranked:
        _,a,b,_,_=item
        if used[docs[a]['date']]>=2 or used[docs[b]['date']]>=2: continue
        kept.append(item); used[docs[a]['date']]+=1; used[docs[b]['date']]+=1
        if len(kept)>=90: break
    for score,a,b,gap,shared in kept:
        con.execute("INSERT INTO memory_echoes(left_memory_id,right_memory_id,left_date,right_date,days_apart,score,shared_terms_json,reason) VALUES(?,?,?,?,?,?,?,?)",
                    (docs[a]['id'],docs[b]['id'],docs[a]['date'],docs[b]['date'],gap,round(score,6),json.dumps(_merge_shared(shared),ensure_ascii=False),'两篇相隔较远的原始日记共享一组相对少见的字符片段；这只是检索线索，不自动等同于相同情绪或因果关系。'))

def build_attention_shifts(con):
    topics=sorted({r[0] for r in con.execute('SELECT DISTINCT topic FROM topic_mentions')})
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    vec={}
    for m in months:
        d={t:0 for t in topics}
        for r in con.execute("SELECT tm.topic,SUM(tm.mention_count) c FROM topic_mentions tm JOIN memories mm ON mm.id=tm.memory_id WHERE mm.kind='daily' AND mm.date_anomaly=0 AND substr(mm.date,1,7)=? GROUP BY tm.topic",(m,)): d[r['topic']]=r['c']
        vec[m]=d
    for a,b in zip(months,months[1:]):
        score=1-_cos(vec[a],vec[b],topics)
        rising=[{'topic':t,'delta':d} for d,t in sorted(((vec[b][t]-vec[a][t],t) for t in topics),reverse=True) if d>0][:5]
        falling=[{'topic':t,'delta':d} for d,t in sorted(((vec[a][t]-vec[b][t],t) for t in topics),reverse=True) if d>0][:5]
        con.execute('INSERT INTO attention_shifts(from_month,to_month,shift_score,rising_json,falling_json) VALUES(?,?,?,?,?)',(a,b,round(score,6),json.dumps(rising,ensure_ascii=False),json.dumps(falling,ensure_ascii=False)))

def build_rhythms(con):
    labels=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']; agg={i:{'chars':[],'entries':0,'reflection':0,'ideas':0,'questions':0} for i in range(7)}; daily=[]
    for r in con.execute("SELECT m.id,m.date,mm.char_count FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL ORDER BY m.date"):
        d=_date(r['date']); w=d.weekday(); daily.append((r['id'],d,r['date'])); a=agg[w];a['entries']+=1;a['chars'].append(r['char_count'])
        a['reflection']+=1 if con.execute("SELECT 1 FROM sections WHERE memory_id=? AND normalized_name IN ('自我探索','体系构建') AND length(trim(content))>0 LIMIT 1",(r['id'],)).fetchone() else 0
        a['ideas']+=con.execute('SELECT COUNT(*) FROM idea_candidates WHERE memory_id=?',(r['id'],)).fetchone()[0]; a['questions']+=con.execute('SELECT COUNT(*) FROM question_candidates WHERE memory_id=?',(r['id'],)).fetchone()[0]
    for w,a in agg.items(): con.execute('INSERT INTO weekday_rhythm VALUES(?,?,?,?,?,?,?)',(w,labels[w],a['entries'],round(sum(a['chars'])/len(a['chars']),1) if a['chars'] else 0,a['reflection'],a['ideas'],a['questions']))
    for (mid1,d1,s1),(mid2,d2,s2) in zip(daily,daily[1:]):
        gap=(d2-d1).days-1
        if gap>0: con.execute('INSERT INTO silence_gaps(start_date,end_date,gap_days,prev_memory_id,next_memory_id) VALUES(?,?,?,?,?)',(s1,s2,gap,mid1,mid2))

def build_skill_pairs(con):
    agg={}
    for m in con.execute("SELECT id,date FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date"):
        ss=[r['name'] for r in con.execute("SELECT sd.name FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id WHERE sa.memory_id=? ORDER BY sd.name",(m['id'],))]
        for a,b in itertools.combinations(ss,2):
            x=agg.setdefault((a,b),{'days':0,'first':m['date'],'last':m['date']});x['days']+=1;x['last']=m['date']
    for (a,b),x in sorted(agg.items(),key=lambda z:-z[1]['days']):
        if x['days']>=2: con.execute('INSERT INTO skill_pairs VALUES(?,?,?,?,?)',(a,b,x['days'],x['first'],x['last']))

def build_first_last(con):
    queries=[
      ('topic',"SELECT tm.topic label,COUNT(DISTINCT tm.memory_id) days,SUM(tm.mention_count) mentions,MIN(m.date) first_date,MAX(m.date) last_date FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY tm.topic"),
      ('skill',"SELECT sd.name label,COUNT(DISTINCT sa.memory_id) days,SUM(sa.mention_count) mentions,MIN(m.date) first_date,MAX(m.date) last_date FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY sd.name"),
      ('place',"SELECT pm.place label,COUNT(DISTINCT pm.memory_id) days,SUM(pm.mention_count) mentions,MIN(m.date) first_date,MAX(m.date) last_date FROM place_mentions pm JOIN memories m ON m.id=pm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY pm.place"),
      ('role',"SELECT rm.role label,COUNT(DISTINCT rm.memory_id) days,SUM(rm.mention_count) mentions,MIN(m.date) first_date,MAX(m.date) last_date FROM role_mentions rm JOIN memories m ON m.id=rm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY rm.role")]
    for kind,q in queries:
        for r in con.execute(q):
            first=con.execute("SELECT id FROM memories WHERE date=? AND kind='daily' LIMIT 1",(r['first_date'],)).fetchone(); last=con.execute("SELECT id FROM memories WHERE date=? AND kind='daily' LIMIT 1",(r['last_date'],)).fetchone()
            con.execute('INSERT INTO first_last_mentions VALUES(?,?,?,?,?,?,?,?)',(kind,r['label'],r['first_date'],r['last_date'],r['days'],r['mentions'],first[0] if first else None,last[0] if last else None))

def build_question_threads(con):
    terms=[]
    for topic,ts in CFG.get('topics',{}).items():
        for t in ts:
            if len(t)>=2: terms.append((t,topic))
    for sk in CFG.get('skills',[]):
        for t in sk.get('terms',[]):
            if len(t)>=2: terms.append((t,sk['name']))
    groups=collections.defaultdict(list)
    for r in con.execute("SELECT q.id,q.date,q.text,m.source_path FROM question_candidates q JOIN memories m ON m.id=q.memory_id WHERE q.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY q.date"):
        matches=[(len(t),label,t) for t,label in terms if t.lower() in r['text'].lower()]
        if matches:
            _,label,term=max(matches);groups[label].append({'id':r['id'],'date':r['date'],'text':r['text'],'source_path':r['source_path'],'term':term})
    for anchor,items in groups.items():
        dates=[_date(x['date']) for x in items]; span=(max(dates)-min(dates)).days if dates else 0
        if len(items)>=4 and span>=60:
            samples=[items[0],items[len(items)//2],items[-1]]
            con.execute('INSERT INTO question_threads(anchor,occurrences,first_date,last_date,span_days,samples_json) VALUES(?,?,?,?,?,?)',(anchor,len(items),items[0]['date'],items[-1]['date'],span,json.dumps(samples,ensure_ascii=False)))

def build_hidden_chapters(con):
    shifts=[dict(r) for r in con.execute('SELECT * FROM attention_shifts ORDER BY shift_score DESC')]; months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    if not months:return
    boundaries=[]
    for s in shifts:
        idx=months.index(s['to_month'])
        a=con.execute('SELECT daily_entries FROM month_stats WHERE month=?',(s['from_month'],)).fetchone()
        b=con.execute('SELECT daily_entries FROM month_stats WHERE month=?',(s['to_month'],)).fetchone()
        if (a and a[0]<10) or (b and b[0]<10): continue
        if all(abs(idx-bx)>1 for bx in boundaries): boundaries.append(idx)
        if len(boundaries)>=4: break
    cuts=[0]+sorted(boundaries)+[len(months)]
    for a,b in zip(cuts,cuts[1:]):
        seg=months[a:b]
        if not seg:continue
        start,end=seg[0],seg[-1]; tops=[{'topic':r['topic'],'mentions':r['c']} for r in con.execute("SELECT tm.topic,SUM(tm.mention_count) c FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND substr(m.date,1,7)>=? AND substr(m.date,1,7)<=? GROUP BY tm.topic ORDER BY c DESC LIMIT 4",(start,end))]
        title=' × '.join(x['topic'] for x in tops[:2]) if tops else f'{start} → {end}'; rr=con.execute('SELECT shift_score FROM attention_shifts WHERE to_month=?',(start,)).fetchone() if a>0 else None
        con.execute('INSERT INTO hidden_chapters(start_month,end_month,title_seed,dominant_topics_json,reason,boundary_score) VALUES(?,?,?,?,?,?)',(start,end,title,json.dumps(tops,ensure_ascii=False),'按月度主题结构变化自动切分的“章节候选”；它不是对人生阶段的事实判断，适合你确认、改名或合并。',rr[0] if rr else 0))

def build_curiosity_cards(con):
    echo=con.execute('SELECT * FROM memory_echoes ORDER BY score DESC LIMIT 1').fetchone()
    if echo:
        paths=[con.execute('SELECT source_path FROM memories WHERE id=?',(echo['left_memory_id'],)).fetchone()[0],con.execute('SELECT source_path FROM memories WHERE id=?',(echo['right_memory_id'],)).fetchone()[0]]
        con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,source_paths_json,payload_json) VALUES(?,?,?,?,?,?)',('echo','Two days that did not know they rhymed',f"{echo['left_date']} 与 {echo['right_date']} 相隔 {echo['days_apart']} 天，却共享一组相对少见的语言片段。",f"{echo['days_apart']:,} days apart",json.dumps(paths,ensure_ascii=False),json.dumps(dict(echo),ensure_ascii=False)))
    shift=con.execute('SELECT * FROM attention_shifts ORDER BY shift_score DESC LIMIT 1').fetchone()
    if shift: con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,payload_json) VALUES(?,?,?,?,?)',('shift','The month your attention changed shape',f"{shift['from_month']} → {shift['to_month']} 是现有记录中月度主题结构变化最大的相邻月份。",f"shift {shift['shift_score']:.2f}",json.dumps(dict(shift),ensure_ascii=False)))
    gap=con.execute('SELECT * FROM silence_gaps ORDER BY gap_days DESC LIMIT 1').fetchone()
    if gap:
        paths=[con.execute('SELECT source_path FROM memories WHERE id=?',(gap['prev_memory_id'],)).fetchone()[0],con.execute('SELECT source_path FROM memories WHERE id=?',(gap['next_memory_id'],)).fetchone()[0]]
        con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,source_paths_json,payload_json) VALUES(?,?,?,?,?,?)',('silence','The longest silence in the archive',f"{gap['start_date']} 与 {gap['end_date']} 两篇日记之间，有 {gap['gap_days']} 个没有 daily source 的日期。",f"{gap['gap_days']} silent days",json.dumps(paths,ensure_ascii=False),json.dumps(dict(gap),ensure_ascii=False)))
    pair=con.execute("SELECT * FROM skill_pairs WHERE skill_a NOT IN ('Writing','Reflection') AND skill_b NOT IN ('Writing','Reflection') ORDER BY days DESC LIMIT 1").fetchone()
    if pair: con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,payload_json) VALUES(?,?,?,?,?)',('skill_pair','Your most frequent skill combination',f"{pair['skill_a']} + {pair['skill_b']} 在 {pair['days']} 个不同日期里共同留下活动证据。",f"{pair['days']} co-occurrence days",json.dumps(dict(pair),ensure_ascii=False)))
    rhythm=con.execute('SELECT * FROM weekday_rhythm ORDER BY avg_chars DESC LIMIT 1').fetchone()
    if rhythm: con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,payload_json) VALUES(?,?,?,?,?)',('rhythm','Your longest-writing weekday',f"按已有 daily source 统计，{rhythm['label']} 的平均日记长度最高。这里只描述写作记录，不推断原因。",f"{int(rhythm['avg_chars'])} chars / entry",json.dumps(dict(rhythm),ensure_ascii=False)))
    thread=con.execute('SELECT * FROM question_threads ORDER BY span_days DESC,occurrences DESC LIMIT 1').fetchone()
    if thread:
        samples=json.loads(thread['samples_json']);con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,source_paths_json,payload_json) VALUES(?,?,?,?,?,?)',('question','A question that keeps returning',f"与「{thread['anchor']}」相关的问题候选跨越 {thread['span_days']} 天反复出现 {thread['occurrences']} 次。",f"{thread['occurrences']} candidates",json.dumps([x['source_path'] for x in samples],ensure_ascii=False),json.dumps(dict(thread),ensure_ascii=False)))
    first=con.execute("SELECT * FROM first_last_mentions WHERE kind='skill' ORDER BY first_date DESC LIMIT 1").fetchone()
    if first:
        p=con.execute('SELECT source_path FROM memories WHERE id=?',(first['first_memory_id'],)).fetchone();con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,source_paths_json,payload_json) VALUES(?,?,?,?,?,?)',('first','A relatively new skill signal',f"{first['label']} 的最早活动证据出现在 {first['first_date']}；此后共出现在 {first['total_days']} 个日期中。",first['first_date'],json.dumps([p[0]] if p else [],ensure_ascii=False),json.dumps(dict(first),ensure_ascii=False)))
    dense=con.execute("SELECT m.id,m.date,m.source_path,mm.char_count FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id WHERE m.kind='daily' AND m.date_anomaly=0 ORDER BY mm.char_count DESC LIMIT 1").fetchone()
    if dense: con.execute('INSERT INTO curiosity_cards(card_type,title,body,metric,source_paths_json,payload_json) VALUES(?,?,?,?,?,?)',('density','The densest day on paper',f"{dense['date']} 是当前 daily archive 中字符数最多的一篇。长度不等于重要性，但它是一个值得重新打开的“高密度记忆”。",f"{dense['char_count']:,} chars",json.dumps([dense['source_path']],ensure_ascii=False),json.dumps(dict(dense),ensure_ascii=False)))

def build_surprise_layer(con,cfg=None):
    global CFG
    if cfg is not None: CFG=cfg
    ensure_schema(con);build_echoes(con);build_attention_shifts(con);build_rhythms(con);build_skill_pairs(con);build_first_last(con);build_question_threads(con);build_hidden_chapters(con);build_curiosity_cards(con)
    return {k:con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for k,t in [('echoes','memory_echoes'),('attention_shifts','attention_shifts'),('skill_pairs','skill_pairs'),('first_last','first_last_mentions'),('silence_gaps','silence_gaps'),('hidden_chapters','hidden_chapters'),('question_threads','question_threads'),('curiosity_cards','curiosity_cards')]}

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row;r=build_surprise_layer(con);con.commit();con.close();print(json.dumps(r,ensure_ascii=False,indent=2))

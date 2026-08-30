#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, re, datetime, collections, math
from timefold_engine import display_anchors, split_sentences

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))

def js(x): return json.dumps(x,ensure_ascii=False)
def d(s): return datetime.date.fromisoformat(s)
def norm(s): return re.sub(r'\s+',' ',s or '').strip()

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS compass_summary;
    DROP TABLE IF EXISTS learning_loops;
    DROP TABLE IF EXISTS skill_transfer_trails;
    DROP TABLE IF EXISTS social_gravity;
    DROP TABLE IF EXISTS place_imprints;
    DROP TABLE IF EXISTS focus_bursts;
    DROP TABLE IF EXISTS visibility_arcs;
    DROP TABLE IF EXISTS friction_followthrough;
    DROP TABLE IF EXISTS forgotten_doors;
    DROP TABLE IF EXISTS revision_trails;
    DROP TABLE IF EXISTS evidence_gaps;
    DROP TABLE IF EXISTS compass_questions;
    DROP TABLE IF EXISTS orientation_cards;
    CREATE TABLE compass_summary(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE learning_loops(
      id INTEGER PRIMARY KEY,question_date TEXT,question_source TEXT,question_text TEXT,
      later_date TEXT,later_source TEXT,later_text TEXT,later_type TEXT,gap_days INTEGER,
      shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE skill_transfer_trails(
      id INTEGER PRIMARY KEY,left_skill TEXT,left_category TEXT,right_skill TEXT,right_category TEXT,
      evidence_days INTEGER,first_date TEXT,last_date TEXT,span_days INTEGER,sample_sources_json TEXT,note TEXT);
    CREATE TABLE social_gravity(
      id INTEGER PRIMARY KEY,role TEXT,context_kind TEXT,context_label TEXT,evidence_days INTEGER,
      first_date TEXT,last_date TEXT,sample_sources_json TEXT,note TEXT);
    CREATE TABLE place_imprints(
      id INTEGER PRIMARY KEY,place TEXT,context_kind TEXT,context_label TEXT,evidence_days INTEGER,
      first_date TEXT,last_date TEXT,sample_sources_json TEXT,note TEXT);
    CREATE TABLE focus_bursts(
      id INTEGER PRIMARY KEY,kind TEXT,label TEXT,start_date TEXT,end_date TEXT,evidence_days INTEGER,
      span_days INTEGER,density REAL,total_mentions INTEGER,source_paths_json TEXT,note TEXT);
    CREATE TABLE visibility_arcs(
      id INTEGER PRIMARY KEY,kind TEXT,label TEXT,first_month TEXT,peak_month TEXT,peak_days INTEGER,
      last_month TEXT,months_visible INTEGER,months_after_peak_visible INTEGER,quiet_month TEXT,
      reappearance_months INTEGER,monthly_json TEXT,note TEXT);
    CREATE TABLE friction_followthrough(
      id INTEGER PRIMARY KEY,friction_date TEXT,friction_source TEXT,friction_text TEXT,marker TEXT,
      later_date TEXT,later_source TEXT,later_text TEXT,later_type TEXT,gap_days INTEGER,
      shared_terms_json TEXT,score REAL,note TEXT);
    CREATE TABLE forgotten_doors(
      id INTEGER PRIMARY KEY,kind TEXT,date TEXT,source_path TEXT,text TEXT,anchor TEXT,
      days_since INTEGER,related_count INTEGER,note TEXT);
    CREATE TABLE revision_trails(
      id INTEGER PRIMARY KEY,anchor TEXT,statement_kind TEXT,occurrences INTEGER,first_date TEXT,last_date TEXT,
      span_days INTEGER,samples_json TEXT,source_paths_json TEXT,note TEXT);
    CREATE TABLE evidence_gaps(
      id INTEGER PRIMARY KEY,gap_type TEXT,label TEXT,severity TEXT,evidence_count INTEGER,
      detail TEXT,source_paths_json TEXT,note TEXT);
    CREATE TABLE compass_questions(
      id INTEGER PRIMARY KEY,prompt TEXT,question_type TEXT,rationale TEXT,source_paths_json TEXT,
      target_feature TEXT,priority REAL,note TEXT);
    CREATE TABLE orientation_cards(
      id INTEGER PRIMARY KEY,card_type TEXT,title TEXT,metric TEXT,body TEXT,source_paths_json TEXT,
      target_feature TEXT,payload_json TEXT,note TEXT);
    ''')

def valid_daily(con):
    return con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date").fetchall()

def specific_anchors(text):
    vals=display_anchors(text)[:60]
    bad={'AI','模型','产品','项目','工作','学习','事情','问题','自己','日记','记录','今天','以后','计划','希望','想要','研究','科研'}
    out=[];seen=set()
    for x in vals:
        x=norm(x);k=x.lower()
        if not x or k in seen or x in bad: continue
        strong=(bool(re.search(r'[A-Za-z]',x)) and len(x)>=3) or (not re.search(r'[A-Za-z]',x) and len(x)>=4)
        if strong:
            seen.add(k);out.append(x)
    return out[:30]

def statement_labels(text):
    low=(text or '').lower();out=[]
    for topic,terms in CFG.get('topics',{}).items():
        if any(len(t)>=2 and t.lower() in low for t in terms): out.append('topic:'+topic)
    for sk in CFG.get('skills',[]):
        if any(len(t)>=2 and t.lower() in low for t in sk.get('terms',[])): out.append('skill:'+sk['name'])
    # Suppress only the broadest labels when they are the sole bridge.
    return list(dict.fromkeys(out))

def build_learning_loops(con):
    later=[]
    for table,typ in [('idea_candidates','idea'),('project_candidates','project'),('achievement_candidates','milestone')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            later.append({'date':r['date'],'text':r['text'],'source':r['source_path'],'type':typ,'anchors':set(specific_anchors(r['text']))})
    idx=collections.defaultdict(set)
    for i,x in enumerate(later):
        for a in x['anchors']: idx[a.lower()].add(i)
    out=[]
    for q in con.execute("SELECT q.date,q.text,m.source_path FROM question_candidates q JOIN memories m ON m.id=q.memory_id WHERE q.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY q.date"):
        qa=set(specific_anchors(q['text'])); cand=set()
        for a in qa:cand |= idx.get(a.lower(),set())
        best=None
        for i in cand:
            x=later[i]
            if x['date']<=q['date']:continue
            gap=(d(x['date'])-d(q['date'])).days
            if gap>540:continue
            shared=sorted(qa & x['anchors'],key=lambda z:(-len(z),z))
            if not shared:continue
            bonus={'milestone':2.0,'project':1.2,'idea':.4}[x['type']]
            score=len(shared)*2.1+bonus+max(0,1-gap/540)
            if best is None or score>best[0]: best=(score,x,gap,shared)
        if best and best[0]>=3.5:
            score,x,gap,shared=best
            out.append((q['date'],q['source_path'],q['text'],x['date'],x['source'],x['text'],x['type'],gap,js(shared[:12]),round(score,2),'A dated question is paired with a later idea/project/milestone candidate sharing specific visible anchors. This is a review loop, not proof the question caused the later action.'))
    out=sorted(out,key=lambda x:(-x[9],-x[7]))[:140]
    con.executemany("INSERT INTO learning_loops(question_date,question_source,question_text,later_date,later_source,later_text,later_type,gap_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",out)
    return len(out)

def build_skill_transfer(con):
    skills={r['id']:(r['name'],r['category']) for r in con.execute('SELECT id,name,category FROM skill_definitions')}
    days=collections.defaultdict(list)
    for r in con.execute("SELECT sa.memory_id,sa.skill_id,m.date,m.source_path FROM skill_activity sa JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL"):
        days[r['memory_id']].append((r['skill_id'],r['date'],r['source_path']))
    pairs=collections.defaultdict(list)
    for vals in days.values():
        uniq=sorted(set(v[0] for v in vals)); date=vals[0][1]; src=vals[0][2]
        for i,a in enumerate(uniq):
            for b in uniq[i+1:]:
                na,ca=skills[a];nb,cb=skills[b]
                if ca==cb:continue
                key=(a,b);pairs[key].append((date,src))
    rows=[]
    for (a,b),ev in pairs.items():
        unique=sorted(dict.fromkeys(ev));
        if len(unique)<3:continue
        na,ca=skills[a];nb,cb=skills[b]
        span=(d(unique[-1][0])-d(unique[0][0])).days
        rows.append((na,ca,nb,cb,len(unique),unique[0][0],unique[-1][0],span,js([x[1] for x in unique[:8]]),'Two skills from different categories were visible on the same dated source. Co-occurrence is a transfer trail candidate, not proof one skill caused the other.'))
    rows.sort(key=lambda x:(-x[4],-x[7]))
    con.executemany("INSERT INTO skill_transfer_trails(left_skill,left_category,right_skill,right_category,evidence_days,first_date,last_date,span_days,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",rows[:180])
    return min(len(rows),180)

def build_context_matrix(con, table_name, entity_table, entity_col, min_days):
    # entity × topic
    acc=collections.defaultdict(list)
    q=f'''SELECT e.{entity_col} entity,tm.topic label,m.id,m.date,m.source_path
          FROM {entity_table} e JOIN memories m ON m.id=e.memory_id
          JOIN topic_mentions tm ON tm.memory_id=m.id
          WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL'''
    for r in con.execute(q):acc[(r['entity'],'topic',r['label'])].append((r['date'],r['source_path']))
    q=f'''SELECT e.{entity_col} entity,sd.name label,m.id,m.date,m.source_path
          FROM {entity_table} e JOIN memories m ON m.id=e.memory_id
          JOIN skill_activity sa ON sa.memory_id=m.id JOIN skill_definitions sd ON sd.id=sa.skill_id
          WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL'''
    for r in con.execute(q):acc[(r['entity'],'skill',r['label'])].append((r['date'],r['source_path']))
    rows=[]
    for (entity,kind,label),ev in acc.items():
        uniq=sorted(dict.fromkeys(ev))
        if len(uniq)<min_days:continue
        rows.append((entity,kind,label,len(uniq),uniq[0][0],uniq[-1][0],js([x[1] for x in uniq[:8]])))
    rows.sort(key=lambda x:(-x[3],x[0],x[2]))
    entity_label='role' if table_name=='social_gravity' else 'place'
    note=('A role and a tracked topic/skill were visible on the same dated sources. This describes archive context, not the relationship itself.' if table_name=='social_gravity' else 'A place and a tracked topic/skill were visible on the same dated sources. This describes recorded context, not what the place caused.')
    sql=f"INSERT INTO {table_name}({entity_label},context_kind,context_label,evidence_days,first_date,last_date,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?)"
    con.executemany(sql,[r+(note,) for r in rows[:220]])
    return min(len(rows),220)

def visible_days_by_label(con):
    out={}
    for r in con.execute('''SELECT tm.topic label,m.date,m.source_path,tm.mention_count mentions FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL ORDER BY m.date'''):
        out.setdefault(('topic',r['label']),[]).append((r['date'],r['source_path'],r['mentions']))
    for r in con.execute('''SELECT sd.name label,m.date,m.source_path,sa.mention_count mentions FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 AND m.date IS NOT NULL ORDER BY m.date'''):
        out.setdefault(('skill',r['label']),[]).append((r['date'],r['source_path'],r['mentions']))
    return out

def build_focus_bursts(con):
    out=[]
    for (kind,label),ev in visible_days_by_label(con).items():
        ev=sorted(ev); run=[]
        def flush(run):
            if len(run)<3:return
            span=(d(run[-1][0])-d(run[0][0])).days+1
            if span>24:return
            density=len(run)/span
            if density<.28:return
            out.append((kind,label,run[0][0],run[-1][0],len(run),span,round(density,3),sum(x[2] for x in run),js([x[1] for x in run[:12]]),'A short calendar window contains repeated archive evidence for the same topic/skill. This is a writing/activity burst, not a measure of effort or importance.'))
        for x in ev:
            if not run or (d(x[0])-d(run[-1][0])).days<=4:
                run.append(x)
            else:
                flush(run);run=[x]
        flush(run)
    out.sort(key=lambda x:(-(x[6]*math.log1p(x[4])), -x[4], x[2]))
    con.executemany("INSERT INTO focus_bursts(kind,label,start_date,end_date,evidence_days,span_days,density,total_mentions,source_paths_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",out[:180])
    return min(len(out),180)

def month_index(s):
    y,m=map(int,s.split('-'));return y*12+m

def build_visibility_arcs(con):
    all_months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY 1")]
    series=collections.defaultdict(collections.Counter)
    for r in con.execute('''SELECT tm.topic label,substr(m.date,1,7) month,COUNT(DISTINCT m.id) days FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY label,month'''):
        series[('topic',r['label'])][r['month']]=r['days']
    for r in con.execute('''SELECT sd.name label,substr(m.date,1,7) month,COUNT(DISTINCT m.id) days FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY label,month'''):
        series[('skill',r['label'])][r['month']]=r['days']
    rows=[]
    for (kind,label),cnt in series.items():
        visible=sorted(m for m,v in cnt.items() if v>0)
        if len(visible)<2:continue
        peak=max(visible,key=lambda m:(cnt[m],m)); peakv=cnt[peak]; pidx=all_months.index(peak)
        threshold=max(1,math.ceil(peakv*.25)); quiet=None
        # first two consecutive archive months after peak both below threshold
        for i in range(pidx+1,len(all_months)-1):
            if cnt[all_months[i]]<threshold and cnt[all_months[i+1]]<threshold:
                quiet=all_months[i];break
        after=[m for m in visible if m>peak]
        reapp=0
        if quiet:
            reapp=sum(1 for m in after if m>quiet and cnt[m]>=threshold)
        rows.append((kind,label,visible[0],peak,peakv,visible[-1],len(visible),len(after),quiet,reapp,js([{ 'month':m,'days':cnt[m]} for m in all_months if cnt[m]>0]),'Visibility Arc summarizes recorded evidence by month. A decline or reappearance in the archive is not equivalent to loss or regain of real-world interest/skill.'))
    rows.sort(key=lambda x:(-x[4],-x[6]))
    con.executemany("INSERT INTO visibility_arcs(kind,label,first_month,peak_month,peak_days,last_month,months_visible,months_after_peak_visible,quiet_month,reappearance_months,monthly_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",rows)
    return len(rows)

def build_friction_followthrough(con):
    later=[]
    excluded={'skill:AI','skill:Research','topic:Self','topic:Learning','topic:Relationships','skill:Communication & Ownership'}
    for table,typ in [('project_candidates','project'),('achievement_candidates','milestone'),('decision_candidates','decision')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            later.append({'date':r['date'],'text':r['text'],'source':r['source_path'],'type':typ,'anchors':set(specific_anchors(r['text'])),'labels':set(statement_labels(r['text']))})
    idx=collections.defaultdict(set)
    for i,x in enumerate(later):
        for a in x['anchors']:idx[('a',a.lower())].add(i)
        for a in x['labels']-excluded:idx[('l',a)].add(i)
    rows=[]
    for f in con.execute('SELECT date,source_path,text,marker FROM friction_statements ORDER BY date'):
        fa=set(specific_anchors(f['text'])); fl=set(statement_labels(f['text']))-excluded; cand=set()
        for a in fa:cand |= idx.get(('a',a.lower()),set())
        for a in fl:cand |= idx.get(('l',a),set())
        best=None
        for i in cand:
            x=later[i]
            if x['date']<=f['date']:continue
            gap=(d(x['date'])-d(f['date'])).days
            if gap>120:continue
            shared_a=sorted(fa&x['anchors'],key=lambda z:(-len(z),z))
            shared_l=sorted(fl&(x['labels']-excluded))
            # Broad configured labels alone are too weak for a follow-through pair.
            # Require either a specific lexical anchor, or at least two independent tracked labels.
            if not shared_a and len(shared_l)<2:continue
            shared=shared_a[:6]+[z.replace('topic:','').replace('skill:','') for z in shared_l[:6]]
            score=len(shared_a)*2.2+len(shared_l)*1.1+({'milestone':1.8,'project':1.0,'decision':.4}[x['type']])+max(0,1-gap/120)
            if best is None or score>best[0]:best=(score,x,gap,shared)
        if best and best[0]>=2.25:
            score,x,gap,shared=best
            rows.append((f['date'],f['source_path'],f['text'],f['marker'],x['date'],x['source'],x['text'],x['type'],gap,js(shared[:10]),round(score,2),'An explicit friction sentence is paired with a later related action/milestone candidate using specific anchors or directly matched configured topic/skill labels. This is follow-through context, not emotional recovery or causality.'))
    rows.sort(key=lambda x:(-x[10],x[8]))
    con.executemany("INSERT INTO friction_followthrough(friction_date,friction_source,friction_text,marker,later_date,later_source,later_text,later_type,gap_days,shared_terms_json,score,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",rows[:120])
    return min(len(rows),120)

def build_forgotten_doors(con):
    latest=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    candidates=[]
    for table,kind in [('idea_candidates','idea'),('question_candidates','question')]:
        for r in con.execute(f"SELECT c.date,c.text,m.source_path FROM {table} c JOIN memories m ON m.id=c.memory_id WHERE c.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY c.date"):
            age=(d(latest)-d(r['date'])).days
            if age<180:continue
            ans=specific_anchors(r['text'])
            if not ans:continue
            anchor=ans[0]
            # count later appearances of the specific anchor in idea/question/project/milestone text
            rel=0
            for t in ['idea_candidates','question_candidates','project_candidates','achievement_candidates']:
                rel += con.execute(f"SELECT COUNT(*) FROM {t} WHERE date>? AND lower(text) LIKE ?",(r['date'],'%'+anchor.lower()+'%')).fetchone()[0]
            if rel<=1:
                score=age/(1+rel)*(1+min(len(anchor),8)/8)
                candidates.append((score,kind,r['date'],r['source_path'],r['text'],anchor,age,rel))
    # de-dupe same source+anchor
    seen=set();rows=[]
    for score,kind,date0,src,text,anchor,age,rel in sorted(candidates,reverse=True):
        key=(src,anchor.lower())
        if key in seen:continue
        seen.add(key)
        rows.append((kind,date0,src,text,anchor,age,rel,'An old idea/question has little later lexical trace in the tracked candidate tables. It may be forgotten, completed elsewhere, intentionally abandoned, or simply phrased differently.'))
        if len(rows)>=100:break
    con.executemany("INSERT INTO forgotten_doors(kind,date,source_path,text,anchor,days_since,related_count,note) VALUES(?,?,?,?,?,?,?,?)",rows)
    return len(rows)

def build_revision_trails(con):
    items=[]
    for r in con.execute("SELECT b.date,m.source_path,b.text FROM belief_candidates b JOIN memories m ON m.id=b.memory_id WHERE b.date IS NOT NULL AND m.kind='daily' AND m.date_anomaly=0 ORDER BY b.date"):
        items.append({'kind':'belief','date':r['date'],'source':r['source_path'],'text':r['text'],'anchors':specific_anchors(r['text']),'labels':statement_labels(r['text'])})
    for r in con.execute("SELECT date,source_path,text FROM protocol_statements WHERE date IS NOT NULL ORDER BY date"):
        items.append({'kind':'protocol','date':r['date'],'source':r['source_path'],'text':r['text'],'anchors':specific_anchors(r['text']),'labels':statement_labels(r['text'])})
    for r in con.execute("SELECT date,source_path,text FROM identity_ledger WHERE date IS NOT NULL ORDER BY date"):
        items.append({'kind':'identity','date':r['date'],'source':r['source_path'],'text':r['text'],'anchors':specific_anchors(r['text']),'labels':statement_labels(r['text'])})
    grouped=collections.defaultdict(list)
    broad={'skill:AI','skill:Research','topic:Self','topic:Learning','topic:Relationships'}
    for x in items:
        keys=[('phrase',a) for a in x['anchors'][:6]]+[('label',a) for a in x['labels'] if a not in broad]
        for typ,a in keys:grouped[(x['kind'],typ,a)].append(x)
    rows=[];seen_group=set()
    for (kind,typ,a),xs in grouped.items():
        uniq=[];seen=set()
        for x in xs:
            k=(x['date'],x['text'])
            if k not in seen:seen.add(k);uniq.append(x)
        uniq.sort(key=lambda x:x['date'])
        if len(uniq)<2:continue
        span=(d(uniq[-1]['date'])-d(uniq[0]['date'])).days
        if span<60:continue
        label=a.replace('topic:','').replace('skill:','')
        dedupe=(kind,label.lower())
        # Prefer configured labels over lexical fragments if both cover the same stream.
        if typ=='phrase' and dedupe in seen_group:continue
        if typ=='label':seen_group.add(dedupe)
        rows.append((label,kind,len(uniq),uniq[0]['date'],uniq[-1]['date'],span,js([{'date':x['date'],'text':x['text']} for x in uniq[:6]]),js(list(dict.fromkeys(x['source'] for x in uniq[:8]))),'Repeated explicit statements share a directly matched topic/skill label or specific visible phrase across time. This is a revision/revisit trail; LifeOS does not decide whether the later statement confirms, refines or rejects the earlier one.'))
    rows.sort(key=lambda x:(-x[5],-x[2]))
    con.executemany("INSERT INTO revision_trails(anchor,statement_kind,occurrences,first_date,last_date,span_days,samples_json,source_paths_json,note) VALUES(?,?,?,?,?,?,?,?,?)",rows[:120])
    return min(len(rows),120)

def build_evidence_gaps(con):
    rows=[]
    # Skills with lots of mentions concentrated in few days: activity signal can look stronger than breadth.
    for r in con.execute('''SELECT sd.name,COUNT(DISTINCT m.id) days,SUM(sa.mention_count) mentions,MIN(m.source_path) source
                            FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id
                            WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY sd.id'''):
        if r['days']<=3 and r['mentions']>=5:
            sev='high' if r['days']==1 else 'medium'
            rows.append(('thin_skill_evidence',r['name'],sev,r['days'],f"{r['mentions']} mentions across only {r['days']} recorded days.",js([r['source']]),'Treat the skill as thinly evidenced; do not turn repeated words on a few days into a stable competence claim.'))
    # Topics with a single day only.
    for r in con.execute('''SELECT tm.topic,COUNT(DISTINCT m.id) days,SUM(tm.mention_count) mentions,MIN(m.source_path) source
                            FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY tm.topic'''):
        if r['days']<=2:
            rows.append(('thin_topic_evidence',r['topic'],'medium',r['days'],f"Visible on only {r['days']} recorded day(s).",js([r['source']]),'Do not infer a lasting life priority from a very small number of recorded days.'))
    # Places visible only once.
    for r in con.execute('''SELECT pm.place,COUNT(DISTINCT m.id) days,MIN(m.source_path) source FROM place_mentions pm JOIN memories m ON m.id=pm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY pm.place'''):
        if r['days']==1:
            rows.append(('single_place_trace',r['place'],'low',1,'Only one dated source currently mentions this place.',js([r['source']]),'A single place mention is not enough to summarize what the place meant.'))
    # Known archive date anomalies.
    for r in con.execute("SELECT date,source_path FROM memories WHERE date_anomaly=1"):
        rows.append(('date_anomaly',r['date'],'high',1,'The filename date lies beyond the current archive cutoff used during build.',js([r['source_path']]),'Keep the raw source unchanged; exclude from time-series claims until reviewed.'))
    order={'high':0,'medium':1,'low':2};rows.sort(key=lambda x:(order[x[2]],x[0],x[1]))
    con.executemany("INSERT INTO evidence_gaps(gap_type,label,severity,evidence_count,detail,source_paths_json,note) VALUES(?,?,?,?,?,?,?)",rows)
    return len(rows)

def build_compass_questions(con):
    qs=[]
    def add(prompt,typ,rat,paths,target,priority):
        qs.append((prompt,typ,rat,js([p for p in paths if p]),target,priority,'Generated locally from deterministic archive signals. It is a question invitation, not an answer.'))
    # longest revision trails
    for r in con.execute('SELECT * FROM revision_trails ORDER BY span_days DESC,occurrences DESC LIMIT 5'):
        paths=json.loads(r['source_paths_json'] or '[]')
        add(f"我对「{r['anchor']}」的说法，在 {r['span_days']} 天里到底发生了什么变化？",'revision',f"This anchor appears across {r['occurrences']} explicit {r['statement_kind']} statements.",paths,'Revision Trails',8+r['span_days']/365)
    for r in con.execute('SELECT * FROM forgotten_doors ORDER BY days_since DESC LIMIT 5'):
        add(f"我在 {r['date']} 写下的这扇“门”后来去了哪里：{r['anchor']}？",'forgotten_door',f"Little later lexical trace was found over {r['days_since']} days.",[r['source_path']],'Forgotten Doors',7+r['days_since']/500)
    for r in con.execute("SELECT * FROM skill_transfer_trails WHERE left_category<>'Personal' AND right_category<>'Personal' ORDER BY evidence_days DESC LIMIT 4"):
        add(f"「{r['left_skill']}」和「{r['right_skill']}」共同出现的那些日子，有什么共同背景？",'skill_transfer',f"They co-occur on {r['evidence_days']} dated sources across different skill categories.",json.loads(r['sample_sources_json'] or '[]'),'Skill Transfer Trails',6+r['evidence_days']/20)
    for r in con.execute("SELECT * FROM social_gravity WHERE context_label NOT IN ('Writing','Reflection','Self','Learning') ORDER BY evidence_days DESC LIMIT 4"):
        add(f"日记里同时出现「{r['role']}」与「{r['context_label']}」的那些日期，有哪些共同情境？",'social_context',f"Same-day co-occurrence on {r['evidence_days']} sources; this does not imply the role caused the context.",json.loads(r['sample_sources_json'] or '[]'),'Social Gravity',5+r['evidence_days']/30)
    for r in con.execute("SELECT * FROM place_imprints WHERE context_label NOT IN ('Writing','Reflection','Self','Learning') ORDER BY evidence_days DESC LIMIT 3"):
        add(f"「{r['place']}」与「{r['context_label']}」同时进入日记的那些日期，有什么共同背景？",'place_context',f"Same-day archive context on {r['evidence_days']} source(s).",json.loads(r['sample_sources_json'] or '[]'),'Place Imprints',5+r['evidence_days']/20)
    for r in con.execute('SELECT * FROM learning_loops ORDER BY score DESC LIMIT 4'):
        add(f"{r['question_date']} 的这个问题，后来是否真的推动了什么：{r['question_text'][:42]}？",'learning_loop',f"A later {r['later_type']} candidate shares visible anchors after {r['gap_days']} days.",[r['question_source'],r['later_source']],'Learning Loops',8+r['score']/5)
    qs=sorted(qs,key=lambda x:-x[5])[:24]
    con.executemany("INSERT INTO compass_questions(prompt,question_type,rationale,source_paths_json,target_feature,priority,note) VALUES(?,?,?,?,?,?,?)",qs)
    return len(qs)

def build_orientation_cards(con):
    cards=[]
    def add(ct,title,metric,body,paths,target,payload):
        cards.append((ct,title,metric,body,js([p for p in paths if p]),target,js(payload),'A locally generated orientation card. It points to evidence; it does not summarize your identity or assign meaning for you.'))
    r=con.execute('SELECT * FROM learning_loops ORDER BY score DESC LIMIT 1').fetchone()
    if r:add('LEARNING LOOP','A question found a later trace',f"{r['gap_days']} days",f"A question from {r['question_date']} shares specific anchors with a later {r['later_type']} candidate.",[r['question_source'],r['later_source']],'Learning Loops',dict(r))
    r=con.execute("SELECT * FROM skill_transfer_trails WHERE left_category<>'Personal' AND right_category<>'Personal' ORDER BY evidence_days DESC LIMIT 1").fetchone()
    if r:add('SKILL TRANSFER',f"{r['left_skill']} × {r['right_skill']}",f"{r['evidence_days']} days",'Two skill families repeatedly share dated evidence.',json.loads(r['sample_sources_json'] or '[]'),'Skill Transfer Trails',dict(r))
    r=con.execute('SELECT * FROM focus_bursts ORDER BY density DESC,evidence_days DESC LIMIT 1').fetchone()
    if r:add('FOCUS BURST',r['label'],f"{r['evidence_days']} / {r['span_days']}d",f"A compact run of recorded {r['kind']} visibility.",json.loads(r['source_paths_json'] or '[]'),'Focus Bursts',dict(r))
    r=con.execute('SELECT * FROM revision_trails ORDER BY span_days DESC LIMIT 1').fetchone()
    if r:add('REVISION TRAIL',r['anchor'],f"{r['span_days']} days",f"The same anchor returns across {r['occurrences']} explicit {r['statement_kind']} statements.",json.loads(r['source_paths_json'] or '[]'),'Revision Trails',dict(r))
    r=con.execute('SELECT * FROM forgotten_doors ORDER BY days_since DESC LIMIT 1').fetchone()
    if r:add('FORGOTTEN DOOR',r['anchor'],f"{r['days_since']} days",'An older idea/question has little later lexical trace in tracked candidate tables.',[r['source_path']],'Forgotten Doors',dict(r))
    r=con.execute('SELECT * FROM friction_followthrough ORDER BY score DESC LIMIT 1').fetchone()
    if r:add('AFTER FRICTION',r['marker'],f"{r['gap_days']} days",f"A later {r['later_type']} candidate shares specific anchors with an explicit friction sentence.",[r['friction_source'],r['later_source']],'After Friction',dict(r))
    r=con.execute("SELECT * FROM social_gravity WHERE context_label NOT IN ('Writing','Reflection','Self','Learning') ORDER BY evidence_days DESC LIMIT 1").fetchone()
    if r:add('SOCIAL CONTEXT',r['role']+' × '+r['context_label'],f"{r['evidence_days']} days",'A role and a tracked context repeatedly share dated sources.',json.loads(r['sample_sources_json'] or '[]'),'Social Gravity',dict(r))
    r=con.execute("SELECT * FROM place_imprints WHERE context_label NOT IN ('Writing','Reflection','Self','Learning') ORDER BY evidence_days DESC LIMIT 1").fetchone()
    if r:add('PLACE IMPRINT',r['place']+' × '+r['context_label'],f"{r['evidence_days']} days",'A place and a tracked context share dated sources.',json.loads(r['sample_sources_json'] or '[]'),'Place Imprints',dict(r))
    con.executemany("INSERT INTO orientation_cards(card_type,title,metric,body,source_paths_json,target_feature,payload_json,note) VALUES(?,?,?,?,?,?,?,?)",cards)
    return len(cards)

def build_compass_layer(con,cfg=None):
    ensure_schema(con)
    if con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0] == 0:
        report={'learning_loops':0,'skill_transfer_trails':0,'social_gravity':0,'place_imprints':0,'focus_bursts':0,'visibility_arcs':0,'friction_followthrough':0,'forgotten_doors':0,'revision_trails':0,'evidence_gaps':0,'compass_questions':0,'orientation_cards':0,'note':'Empty memory space: Compass has no evidence to analyze yet.'}
        for k,v in report.items(): con.execute('INSERT INTO compass_summary(key,value) VALUES(?,?)',(k,str(v)))
        con.commit(); return report
    report={}
    report['learning_loops']=build_learning_loops(con)
    report['skill_transfer_trails']=build_skill_transfer(con)
    report['social_gravity']=build_context_matrix(con,'social_gravity','role_mentions','role',3)
    report['place_imprints']=build_context_matrix(con,'place_imprints','place_mentions','place',1)
    report['focus_bursts']=build_focus_bursts(con)
    report['visibility_arcs']=build_visibility_arcs(con)
    report['friction_followthrough']=build_friction_followthrough(con)
    report['forgotten_doors']=build_forgotten_doors(con)
    report['revision_trails']=build_revision_trails(con)
    report['evidence_gaps']=build_evidence_gaps(con)
    report['compass_questions']=build_compass_questions(con)
    report['orientation_cards']=build_orientation_cards(con)
    report['note']='Compass connects existing evidence into navigational review cues: learning loops, cross-skill transfer, social/place context, bursts, visibility arcs, follow-through, forgotten doors, revisions and evidence gaps. None of these are causal or personality claims.'
    for k,v in report.items():
        if k!='note':con.execute('INSERT INTO compass_summary(key,value) VALUES(?,?)',(k,str(v)))
    con.execute('INSERT INTO compass_summary(key,value) VALUES(?,?)',('note',report['note']))
    return report

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    print(json.dumps(build_compass_layer(con,CFG),ensure_ascii=False,indent=2));con.commit();con.close()

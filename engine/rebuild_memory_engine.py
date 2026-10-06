#!/usr/bin/env python3
from pathlib import Path
import os
import sqlite3, hashlib, re, datetime, json, math, collections

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])
VAULT=ROOT/'vault'
DB=ROOT/'data/lifeos.db'
CFG=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
ENTCFG=json.loads((ROOT/'config/entities.json').read_text(encoding='utf-8'))
TODAY=datetime.date.today()
SECTION_NORM=CFG.get('section_normalize',{})

IDEA_TRIGGERS=['我想','想做','想要','想把','想试','计划','打算','以后可以','可以做','有一个想法','有个想法','要做','准备做','希望能','希望可以']
QUESTION_TRIGGERS=['为什么','怎么办','如何','怎么','要不要','是否','能不能','可不可以','什么才','到底']
BELIEF_TRIGGERS=['我觉得','我认为','我发现','我意识到','我越来越','我需要','我应该','我希望','我不想','最重要','重要的是','必须','不要','值得','意义','我更']
ACH_TRIGGERS=['第一次','完成','发表','录用','获奖','金奖','银奖','通过','拿到','上线','发布','交付','做完','实现']
DECISION_TRIGGERS=['决定','选择','还是','要不要','放弃','申请','去不去','考虑','打算','更想','不再']
PROJECT_TRIGGERS=['项目','课题','论文','产品','实习','比赛','创业','研究','系统','网站','网页']
STOP_SENTENCES={'','-','*'}

def clean_line(s):
    s=re.sub(r'^\s*[-*+]\s*','',s.strip())
    s=re.sub(r'\s+',' ',s)
    return s.strip()

def split_sentences(text):
    out=[]
    for line in text.splitlines():
        line=clean_line(line)
        if not line or line in STOP_SENTENCES:
            continue
        parts=re.split(r'(?<=[。！？!?；;])\s*',line)
        for p in parts:
            p=p.strip()
            if 5 <= len(p) <= 260:
                out.append(p)
    return out

def parse_sections(text):
    sections=[]; current=None; buf=[]
    for line in text.splitlines():
        if line.startswith('### '):
            if current is not None:
                sections.append((current,'\n'.join(buf).strip()))
            current=line[4:].strip(); buf=[]
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections.append((current,'\n'.join(buf).strip()))
    return sections

def count_terms(text, terms):
    low=text.lower()
    n=0
    matched=[]
    for term in terms:
        c=low.count(term.lower())
        if c:
            n += c
            matched.append((term,c))
    return n, matched

def schema(con):
    con.executescript("""
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE memories(
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('daily','weekly')),
      date TEXT,
      year INTEGER NOT NULL,
      month INTEGER,
      week INTEGER,
      source_path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      date_anomaly INTEGER NOT NULL DEFAULT 0,
      provenance_type TEXT NOT NULL,
      authorship TEXT NOT NULL DEFAULT 'user'
    );
    CREATE INDEX idx_mem_kind_date ON memories(kind,date DESC);
    CREATE INDEX idx_mem_year_month ON memories(year,month);

    CREATE TABLE sections(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX idx_sections_memory ON sections(memory_id,ordinal);
    CREATE INDEX idx_sections_name ON sections(normalized_name);

    CREATE TABLE memory_metrics(
      memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      char_count INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      nonempty_sections INTEGER NOT NULL,
      schedule_items INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE event_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT NOT NULL
    );
    CREATE INDEX idx_event_date ON event_candidates(date);

    CREATE TABLE idea_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      status TEXT NOT NULL DEFAULT 'thought',
      source_type TEXT NOT NULL
    );
    CREATE TABLE question_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source_type TEXT NOT NULL
    );
    CREATE TABLE belief_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      topic TEXT,
      source_type TEXT NOT NULL
    );
    CREATE TABLE achievement_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      source_type TEXT NOT NULL
    );
    CREATE TABLE decision_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      source_type TEXT NOT NULL
    );
    CREATE TABLE project_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      trigger TEXT,
      source_type TEXT NOT NULL
    );
    CREATE TABLE quote_candidates(
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES sections(id),
      date TEXT,
      text TEXT NOT NULL,
      source_type TEXT NOT NULL
    );

    CREATE TABLE skill_definitions(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      parent_name TEXT,
      description TEXT NOT NULL,
      terms_json TEXT NOT NULL
    );
    CREATE TABLE skill_activity(
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
      mention_count INTEGER NOT NULL,
      matched_terms_json TEXT NOT NULL,
      PRIMARY KEY(memory_id,skill_id)
    );
    CREATE INDEX idx_skill_activity_skill ON skill_activity(skill_id);

    CREATE TABLE topic_mentions(
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      matched_terms_json TEXT NOT NULL,
      PRIMARY KEY(memory_id,topic)
    );
    CREATE TABLE role_mentions(
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      PRIMARY KEY(memory_id,role)
    );
    CREATE TABLE place_mentions(
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      place TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      PRIMARY KEY(memory_id,place)
    );
    CREATE TABLE person_mentions(
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      person TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      PRIMARY KEY(memory_id,person)
    );
    CREATE TABLE term_monthly(
      month TEXT NOT NULL,
      term TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      PRIMARY KEY(month,term)
    );
    CREATE TABLE month_stats(
      month TEXT PRIMARY KEY,
      daily_entries INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      schedule_items INTEGER NOT NULL,
      ideas INTEGER NOT NULL,
      questions INTEGER NOT NULL,
      beliefs INTEGER NOT NULL,
      events INTEGER NOT NULL
    );

    CREATE TABLE ai_inferences(
      id INTEGER PRIMARY KEY,
      inference_type TEXT NOT NULL,
      topic TEXT,
      statement TEXT NOT NULL,
      confidence REAL,
      source_type TEXT NOT NULL DEFAULT 'ai_inference',
      status TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE inference_evidence(
      inference_id INTEGER NOT NULL REFERENCES ai_inferences(id) ON DELETE CASCADE,
      memory_id INTEGER NOT NULL REFERENCES memories(id),
      section_id INTEGER REFERENCES sections(id),
      PRIMARY KEY(inference_id,memory_id,section_id)
    );
    CREATE TABLE corrections(
      id INTEGER PRIMARY KEY,
      inference_id INTEGER REFERENCES ai_inferences(id),
      verdict TEXT NOT NULL CHECK(verdict IN ('correct','partial','wrong')),
      correction TEXT,
      context_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE capsules(
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      unlock_date TEXT,
      status TEXT NOT NULL DEFAULT 'locked',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    """)
    try:
        con.execute("CREATE VIRTUAL TABLE memory_fts USING fts5(memory_id UNINDEXED,date,kind,section_name,text,tokenize='unicode61')")
        return True
    except sqlite3.OperationalError:
        con.execute("CREATE TABLE memory_fts(memory_id INTEGER, date TEXT, kind TEXT, section_name TEXT, text TEXT)")
        return False

def topic_for_sentence(sentence):
    best=None; bestc=0
    for topic,terms in CFG['topics'].items():
        c,_=count_terms(sentence,terms)
        if c>bestc:
            best,bestc=topic,c
    return best

def add_candidate(con, table, mid, sid, date, sent, trigger, source_type, extra=None):
    cols=['memory_id','section_id','date','text','trigger','source_type']
    vals=[mid,sid,date,sent,trigger,source_type]
    if extra:
        for k,v in extra.items():
            cols.append(k); vals.append(v)
    q=f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?'*len(vals))})"
    con.execute(q,vals)

def scan_candidates(con, mid, date, source_type, section_rows):
    for sid,name,content in section_rows:
        if not content:
            continue
        norm=SECTION_NORM.get(name,name)
        sents=split_sentences(content)
        # Timeline: schedule is direct source, not AI inference
        if norm=='日程':
            for sent in sents[:24]:
                con.execute("INSERT INTO event_candidates(memory_id,section_id,date,text,event_type,source_type) VALUES(?,?,?,?,?,?)",
                            (mid,sid,date,sent,'schedule','human_raw'))
        # Quote candidates: may contain external quotes, label clearly
        if norm=='心得与摘录':
            for sent in sents[:30]:
                if len(sent)>=8:
                    con.execute("INSERT INTO quote_candidates(memory_id,section_id,date,text,source_type) VALUES(?,?,?,?,?)",
                                (mid,sid,date,sent,'human_or_external_excerpt'))
        if norm not in ('日记','自我探索','体系构建','本周复盘'):
            continue
        for sent in sents:
            for trig in IDEA_TRIGGERS:
                if trig in sent:
                    add_candidate(con,'idea_candidates',mid,sid,date,sent,trig,source_type)
                    break
            if ('?' in sent or '？' in sent):
                trig='?'
                add_candidate(con,'question_candidates',mid,sid,date,sent,trig,source_type)
            else:
                for trig in QUESTION_TRIGGERS:
                    if trig in sent:
                        add_candidate(con,'question_candidates',mid,sid,date,sent,trig,source_type)
                        break
            for trig in BELIEF_TRIGGERS:
                if trig in sent:
                    add_candidate(con,'belief_candidates',mid,sid,date,sent,trig,source_type,{'topic':topic_for_sentence(sent)})
                    break
            for trig in ACH_TRIGGERS:
                if trig in sent:
                    add_candidate(con,'achievement_candidates',mid,sid,date,sent,trig,source_type)
                    break
            for trig in DECISION_TRIGGERS:
                if trig in sent:
                    add_candidate(con,'decision_candidates',mid,sid,date,sent,trig,source_type)
                    break
            for trig in PROJECT_TRIGGERS:
                if trig in sent:
                    add_candidate(con,'project_candidates',mid,sid,date,sent,trig,source_type)
                    break

def add_file(con,p,kind,fts):
    raw=p.read_bytes(); text=raw.decode('utf-8-sig',errors='replace'); sha=hashlib.sha256(raw).hexdigest()
    if kind=='daily':
        m=re.match(r'(\d{4})-(\d{2})-(\d{2})\.md$',p.name)
        y=int(m.group(1)); mo=int(m.group(2)); date=p.stem; week=None
        try: anomaly=datetime.date.fromisoformat(date)>TODAY
        except Exception: anomaly=False
        provenance='daily_raw'; authorship='user'; source_type='human_raw'
    else:
        m=re.match(r'(\d{4})_(\d{1,2})\.md$',p.name)
        y=int(m.group(1)); week=int(m.group(2)); mo=None; date=None; anomaly=False
        provenance='weekly_review'; authorship='user_or_generated_review'; source_type='weekly_review'
    rel=str(p.relative_to(VAULT)).replace('\\','/')
    cur=con.execute("""INSERT INTO memories(kind,date,year,month,week,source_path,sha256,bytes,raw_text,date_anomaly,provenance_type,authorship)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (kind,date,y,mo,week,rel,sha,len(raw),text,int(anomaly),provenance,authorship))
    mid=cur.lastrowid
    secs=parse_sections(text); section_rows=[]; nonempty=0; schedule_items=0
    for i,(name,content) in enumerate(secs):
        norm=SECTION_NORM.get(name,name)
        scur=con.execute("INSERT INTO sections(memory_id,ordinal,name,normalized_name,content) VALUES(?,?,?,?,?)",(mid,i,name,norm,content))
        sid=scur.lastrowid; section_rows.append((sid,norm,content))
        if content.strip(): nonempty+=1
        if norm=='日程': schedule_items=len(split_sentences(content))
        con.execute("INSERT INTO memory_fts(memory_id,date,kind,section_name,text) VALUES(?,?,?,?,?)",(mid,date or f'{y}_W{week:02d}',kind,norm,content))
    con.execute("INSERT INTO memory_metrics(memory_id,char_count,line_count,nonempty_sections,schedule_items) VALUES(?,?,?,?,?)",
                (mid,len(text),len(text.splitlines()),nonempty,schedule_items))
    scan_candidates(con,mid,date,source_type,section_rows)

    # Derived analytics operate on section CONTENT, not Markdown headings or the repeated habit template.
    # This avoids falsely turning every journal into evidence for "Reflection", "Reading", "Fitness", etc.
    analysis_text='\n'.join(content for _sid,norm,content in section_rows if norm!='习惯打卡' and content)
    section_map={norm:content for _sid,norm,content in section_rows}
    for skill in CFG['skills']:
        c,matched=count_terms(analysis_text,skill['terms'])
        # Two transparent structural signals:
        # - Writing: a non-empty journal section means the user actually wrote that day.
        # - Reflection: non-empty self-exploration/system-building sections are direct reflective activity.
        if skill['name']=='Writing' and section_map.get('日记','').strip():
            c += 1; matched.append(('section:日记',1))
        if skill['name']=='Reflection':
            structural=sum(1 for n in ('自我探索','体系构建') if section_map.get(n,'').strip())
            if structural:
                c += structural; matched.append(('section:reflection',structural))
        if c:
            sid=con.execute("SELECT id FROM skill_definitions WHERE name=?",(skill['name'],)).fetchone()[0]
            con.execute("INSERT INTO skill_activity(memory_id,skill_id,mention_count,matched_terms_json) VALUES(?,?,?,?)",
                        (mid,sid,c,json.dumps(matched,ensure_ascii=False)))
    for topic,terms in CFG['topics'].items():
        c,matched=count_terms(analysis_text,terms)
        if c:
            con.execute("INSERT INTO topic_mentions(memory_id,topic,mention_count,matched_terms_json) VALUES(?,?,?,?)",
                        (mid,topic,c,json.dumps(matched,ensure_ascii=False)))
    for role in CFG['roles']:
        c=analysis_text.lower().count(role.lower())
        if c: con.execute("INSERT INTO role_mentions(memory_id,role,mention_count) VALUES(?,?,?)",(mid,role,c))
    place_terms=list(CFG['places'])
    for pdef in ENTCFG.get('places',[]):
        if isinstance(pdef,str): place_terms.append(pdef)
        else: place_terms.extend([pdef.get('name','')]+pdef.get('aliases',[]))
    for place in set(x for x in place_terms if x):
        c=analysis_text.lower().count(place.lower())
        if c: con.execute("INSERT INTO place_mentions(memory_id,place,mention_count) VALUES(?,?,?)",(mid,place,c))
    for pdef in ENTCFG.get('people',[]):
        name=pdef.get('name','').strip()
        if not name: continue
        aliases=[name]+pdef.get('aliases',[])
        c=sum(analysis_text.lower().count(a.lower()) for a in aliases if a)
        if c: con.execute("INSERT INTO person_mentions(memory_id,person,mention_count) VALUES(?,?,?)",(mid,name,c))

    if kind=='daily' and not anomaly:
        month=date[:7]
        for term in CFG['word_terms']:
            c=analysis_text.lower().count(term.lower())
            if c:
                con.execute("""INSERT INTO term_monthly(month,term,mention_count) VALUES(?,?,?)
                               ON CONFLICT(month,term) DO UPDATE SET mention_count=mention_count+excluded.mention_count""",(month,term,c))

def build_month_stats(con):
    months=[r[0] for r in con.execute("SELECT DISTINCT substr(date,1,7) FROM memories WHERE kind='daily' AND date IS NOT NULL ORDER BY 1")]
    for month in months:
        base=con.execute("""SELECT COUNT(*) n,COALESCE(SUM(mm.char_count),0) chars,COALESCE(SUM(mm.schedule_items),0) schedules
                            FROM memories m JOIN memory_metrics mm ON mm.memory_id=m.id
                            WHERE m.kind='daily' AND m.date_anomaly=0 AND substr(m.date,1,7)=?""",(month,)).fetchone()
        def cnt(table):
            return con.execute(f"SELECT COUNT(*) FROM {table} WHERE date LIKE ?",(month+'%',)).fetchone()[0]
        con.execute("""INSERT INTO month_stats(month,daily_entries,char_count,schedule_items,ideas,questions,beliefs,events)
                       VALUES(?,?,?,?,?,?,?,?)""",
                    (month,base['n'],base['chars'],base['schedules'],cnt('idea_candidates'),cnt('question_candidates'),cnt('belief_candidates'),cnt('event_candidates')))

def build_skill_defs(con):
    for s in CFG['skills']:
        con.execute("INSERT INTO skill_definitions(name,category,parent_name,description,terms_json) VALUES(?,?,?,?,?)",
                    (s['name'],s['category'],s.get('parent'),s['description'],json.dumps(s['terms'],ensure_ascii=False)))

def build_defaults(con):
    defaults={
      'share_raw_journal':'false',
      'share_people':'false',
      'share_skills':'false',
      'share_projects':'false',
      'share_year_review':'false',
      'evidence_policy':'strict',
      'engine_mode':'local-first'
    }
    con.executemany("INSERT INTO app_settings(key,value) VALUES(?,?)",defaults.items())

def main():
    import sys
    source_root=str(Path(__file__).resolve().parents[1])
    if source_root not in sys.path: sys.path.insert(0,source_root)
    from engine import drift_bottles
    drift_bottles.migrate_legacy(ROOT)
    DB.parent.mkdir(parents=True,exist_ok=True)
    preserved_settings={}
    if DB.exists():
        try:
            old=sqlite3.connect(DB); old.row_factory=sqlite3.Row
            preserved_settings={r['key']:r['value'] for r in old.execute("SELECT key,value FROM app_settings")}
            old.close()
        except Exception: preserved_settings={}
        DB.unlink()
    con=sqlite3.connect(DB); con.row_factory=sqlite3.Row
    fts=schema(con); build_skill_defs(con); build_defaults(con)
    for k,v in preserved_settings.items():
        con.execute("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(k,v))
    daily=sorted((VAULT/'memories/daily').glob('*/*.md'))
    weekly=sorted((VAULT/'memories/weekly').glob('*/*.md'))
    for p in daily: add_file(con,p,'daily',fts)
    for p in weekly: add_file(con,p,'weekly',fts)
    build_month_stats(con)
    from surprise_engine import build_surprise_layer
    surprise_report=build_surprise_layer(con,CFG)
    from discovery_engine import build_discovery_layer
    discovery_report=build_discovery_layer(con,CFG)
    from timefold_engine import build_timefold_layer
    timefold_report=build_timefold_layer(con,CFG)
    from mirror_engine import build_mirror_layer
    mirror_report=build_mirror_layer(con,CFG)
    from compass_engine import build_compass_layer
    compass_report=build_compass_layer(con,CFG)
    from topology_engine import build_topology_layer
    topology_report=build_topology_layer(con,CFG)
    from footprint_engine import build_footprint_layer
    footprint_report=build_footprint_layer(con,CFG)
    from lineage_engine import build_lineage_layer
    lineage_report=build_lineage_layer(con,CFG)
    counts={
      'daily':len(daily),'weekly':len(weekly),'total':len(daily)+len(weekly),
      'events':con.execute("SELECT COUNT(*) FROM event_candidates").fetchone()[0],
      'ideas':con.execute("SELECT COUNT(*) FROM idea_candidates").fetchone()[0],
      'questions':con.execute("SELECT COUNT(*) FROM question_candidates").fetchone()[0],
      'beliefs':con.execute("SELECT COUNT(*) FROM belief_candidates").fetchone()[0],
      'achievements':con.execute("SELECT COUNT(*) FROM achievement_candidates").fetchone()[0],
      'decisions':con.execute("SELECT COUNT(*) FROM decision_candidates").fetchone()[0],
      'projects':con.execute("SELECT COUNT(*) FROM project_candidates").fetchone()[0],
      'quotes':con.execute("SELECT COUNT(*) FROM quote_candidates").fetchone()[0]
    }
    meta={
      'schema_version':'10',
      'engine_version':'Memory Engine 11.1 · Core IX Living Memory / Lazy Refresh',
      'built_at':datetime.datetime.now().isoformat(timespec='seconds'),
      'fts5':str(int(fts)),
      **{k:str(v) for k,v in counts.items()}
    }
    con.executemany("INSERT INTO meta(key,value) VALUES(?,?)",meta.items())
    con.commit()
    anomalies=[dict(r) for r in con.execute("SELECT source_path,date FROM memories WHERE date_anomaly=1")]
    report={'db':str(DB),'counts':counts,'fts5':fts,'anomalies':anomalies,'skills':len(CFG['skills']),'topics':len(CFG['topics']),'surprise_layer':surprise_report,'observatory_layer':discovery_report,'timefold_layer':timefold_report,'mirror_layer':mirror_report,'compass_layer':compass_report,'topology_layer':topology_report,'footprint_layer':footprint_report,'lineage_layer':lineage_report}
    (ROOT/'data/engine_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    con.close()
    try:
        from product_core import seed_feature_dependencies, bootstrap_existing, mark_deterministic_fresh, derived_refresh_status, complete_derived_refresh
        seed_feature_dependencies(root=ROOT)
        bootstrap_existing(ROOT)
        # A full rebuild already includes every deterministic corpus layer.
        mark_deterministic_fresh(ROOT)
        rst=derived_refresh_status(ROOT)
        complete_derived_refresh(int(rst.get('requested_generation') or 0),root=ROOT,duration_ms=0)
    except Exception as e:
        print('[LifeOS Core] metadata reconcile warning:',e)

if __name__=='__main__':
    main()

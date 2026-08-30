#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, re, collections, datetime, statistics, math

ROOT=Path(__file__).resolve().parents[1]
try:
    from footprint_engine import ARTIFACTS
except Exception:
    ARTIFACTS={}

def js(x): return json.dumps(x,ensure_ascii=False)
def d(s): return datetime.date.fromisoformat(s)

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS lineage_summary;
    DROP TABLE IF EXISTS thought_artifact_trails;
    DROP TABLE IF EXISTS project_artifact_families;
    DROP TABLE IF EXISTS artifact_ancestry;
    DROP TABLE IF EXISTS version_trees;
    DROP TABLE IF EXISTS idea_output_latency;
    DROP TABLE IF EXISTS lineage_feedback_loops;
    DROP TABLE IF EXISTS rework_cycles;
    DROP TABLE IF EXISTS cross_pollination;
    DROP TABLE IF EXISTS first_proofs;
    DROP TABLE IF EXISTS unfinished_lineages;
    DROP TABLE IF EXISTS release_cadence;
    DROP TABLE IF EXISTS evidence_chains;

    CREATE TABLE lineage_summary(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE thought_artifact_trails(
      id INTEGER PRIMARY KEY,thought_id INTEGER NOT NULL,thought_date TEXT NOT NULL,thought_source TEXT NOT NULL,
      thought_text TEXT NOT NULL,artifact_id INTEGER NOT NULL,artifact_date TEXT NOT NULL,artifact_source TEXT NOT NULL,
      artifact_type TEXT NOT NULL,artifact_action TEXT NOT NULL,artifact_text TEXT NOT NULL,gap_days INTEGER NOT NULL,
      shared_anchors_json TEXT NOT NULL,shared_context_json TEXT NOT NULL,score REAL NOT NULL,note TEXT NOT NULL
    );
    CREATE INDEX idx_tat_date ON thought_artifact_trails(thought_date,artifact_date);
    CREATE TABLE project_artifact_families(
      artifact_type TEXT PRIMARY KEY,project_candidate_days INTEGER NOT NULL,artifact_days INTEGER NOT NULL,
      first_project_date TEXT,last_project_date TEXT,first_artifact_date TEXT,last_artifact_date TEXT,
      shared_context_json TEXT NOT NULL,project_sources_json TEXT NOT NULL,artifact_sources_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE artifact_ancestry(
      id INTEGER PRIMARY KEY,artifact_type TEXT NOT NULL,from_artifact_id INTEGER NOT NULL,to_artifact_id INTEGER NOT NULL,
      from_date TEXT NOT NULL,to_date TEXT NOT NULL,gap_days INTEGER NOT NULL,from_action TEXT NOT NULL,to_action TEXT NOT NULL,
      from_source TEXT NOT NULL,to_source TEXT NOT NULL,from_text TEXT NOT NULL,to_text TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE version_trees(
      artifact_type TEXT PRIMARY KEY,first_date TEXT,last_date TEXT,recorded_days INTEGER NOT NULL,events INTEGER NOT NULL,
      action_sequence_json TEXT NOT NULL,transition_counts_json TEXT NOT NULL,branch_points_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE idea_output_latency(
      artifact_type TEXT PRIMARY KEY,links INTEGER NOT NULL,median_days REAL,min_days INTEGER,max_days INTEGER,
      sample_links_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE lineage_feedback_loops(
      id INTEGER PRIMARY KEY,artifact_type TEXT NOT NULL,artifact_date TEXT NOT NULL,artifact_source TEXT NOT NULL,
      artifact_text TEXT NOT NULL,feedback_date TEXT NOT NULL,feedback_source TEXT NOT NULL,feedback_text TEXT NOT NULL,
      next_revision_date TEXT,next_revision_source TEXT,gap_to_feedback INTEGER NOT NULL,gap_to_revision INTEGER,
      score REAL NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE rework_cycles(
      id INTEGER PRIMARY KEY,artifact_type TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,
      revision_days INTEGER NOT NULL,span_days INTEGER NOT NULL,source_paths_json TEXT NOT NULL,sample_texts_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE cross_pollination(
      left_artifact TEXT NOT NULL,right_artifact TEXT NOT NULL,nearby_pairs INTEGER NOT NULL,shared_days INTEGER NOT NULL,
      median_gap_days REAL,shared_skills_json TEXT NOT NULL,shared_topics_json TEXT NOT NULL,sample_sources_json TEXT NOT NULL,note TEXT NOT NULL,
      PRIMARY KEY(left_artifact,right_artifact)
    );
    CREATE TABLE first_proofs(
      artifact_type TEXT PRIMARY KEY,date TEXT NOT NULL,source_path TEXT NOT NULL,action TEXT NOT NULL,text TEXT NOT NULL,
      strict_marker TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE unfinished_lineages(
      id INTEGER PRIMARY KEY,kind TEXT NOT NULL,anchor TEXT NOT NULL,first_date TEXT NOT NULL,last_date TEXT NOT NULL,
      span_days INTEGER NOT NULL,occurrences INTEGER NOT NULL,days_since INTEGER NOT NULL,source_paths_json TEXT NOT NULL,
      sample_texts_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE release_cadence(
      artifact_type TEXT PRIMARY KEY,outbound_events INTEGER NOT NULL,first_date TEXT,last_date TEXT,median_gap_days REAL,
      max_gap_days INTEGER,active_months INTEGER NOT NULL,monthly_json TEXT NOT NULL,sample_sources_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE evidence_chains(
      id INTEGER PRIMARY KEY,chain_type TEXT NOT NULL,artifact_type TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,
      span_days INTEGER NOT NULL,steps_json TEXT NOT NULL,score REAL NOT NULL,note TEXT NOT NULL
    );
    ''')

def memory_context(con,mid):
    topics=[r[0] for r in con.execute('SELECT topic FROM topic_mentions WHERE memory_id=? ORDER BY mention_count DESC',(mid,))]
    skills=[r[0] for r in con.execute('''SELECT sd.name FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id
                                      WHERE sa.memory_id=? AND sd.name NOT IN ('Writing','Reflection') ORDER BY sa.mention_count DESC''',(mid,))]
    roles=[r[0] for r in con.execute('SELECT role FROM role_mentions WHERE memory_id=? ORDER BY mention_count DESC',(mid,))]
    places=[r[0] for r in con.execute('SELECT place FROM place_mentions WHERE memory_id=? ORDER BY mention_count DESC',(mid,))]
    return {'topics':topics,'skills':skills,'roles':roles,'places':places,'labels':set(topics+skills)}

def anchor_vocab(cfg):
    vals=set()
    for topic,terms in cfg.get('topics',{}).items():
        vals.add(topic); vals.update(terms)
    for s in cfg.get('skills',[]):
        vals.add(s['name']); vals.update(s.get('terms',[]))
    for typ,terms in ARTIFACTS.items():
        vals.add(typ); vals.update(terms)
    vals.update(['病历夹','桌宠','简历','论文','PPT','GitHub','github','产品经理','RAG','Agent','agent','PRD','网页','网站','数据库','benchmark','海报','poster','技能','skill','申请','申研','实习','科研'])
    bad={'AI','模型','项目','产品','系统','工作','学习','研究','代码','报告','文档','软件','文章','功能','网页'}
    return sorted([x for x in vals if isinstance(x,str) and len(x.strip())>=2 and x not in bad],key=lambda x:(-len(x),x))

def anchors(text,vocab):
    low=(text or '').lower(); out=[]
    for a in vocab:
        if a.lower() in low: out.append(a)
    # Specific latin identifiers often carry more signal than generic Chinese ngrams.
    for t in re.findall(r'[A-Za-z][A-Za-z0-9_.+/#-]{2,}',text or ''):
        if t.lower() not in {'the','and','for','with','this','that','from','into','html','work'}: out.append(t)
    seen=[]
    for x in out:
        if x.lower() not in [y.lower() for y in seen]: seen.append(x)
    return seen[:30]

def is_self_directed(text):
    if not text: return False
    if re.search(r'(^|[，。；!?\s])(他|她|他们|她们).{0,16}(做|写|改|发布|发表|分享|提交|上传)',text): return False
    return ('我' in text) or bool(re.search(r'(^|[，。；!?\s])(做了|改了|写了|完成了|开发了|实现了|提交了|上传了|发布了|发表了|分享了|做完|写完|改完)',text))

def is_future_intention(text):
    t=text or ''
    if re.search(r'(再也不要|不想|不打算|不准备|放弃|搁置|取消|为何.{0,12}要做|为什么.{0,12}要做)',t,re.I): return False
    patterns=[
      r'我(?:也)?想要.{0,40}(?:做|写|改|设计|开发|制作|发表|发布|提交|上传|学习|尝试|完成|准备|申请|分享|建立|搭建|搞)',
      r'我(?:也)?想.{0,24}(?:做|写|改|设计|开发|制作|发表|发布|提交|上传|学习|尝试|完成|准备|申请|分享|建立|搭建|搞)',
      r'(?:突发奇想|突然想|忽然想|萌生.{0,6}想法).{0,28}(?:做|写|改|设计|开发|制作|发表|发布|提交|上传|完成|搭建)',
      r'(?:打算|计划|准备|争取|希望).{0,45}(?:做|写|改|设计|开发|制作|发表|发布|提交|上传|完成|申请|分享|论文|简历|网站|网页|ppt|PPT|产品|代码|项目)',
      r'(?:接下来|以后|下次|明天|下周|之后).{0,45}(?:做|写|改|设计|开发|制作|发表|发布|提交|上传|完成|申请|分享|安排)',
      r'(?:想要|想去|想把|想做|想设计|想发表|想发布|想开发|想制作|想搞).{0,45}(?:论文|文章|简历|作品集|网站|网页|ppt|PPT|产品|功能|代码|项目|海报|报告)',
      r'(?:要做|要写|要改|要设计|要开发|要制作|要发表|要提交|要上传).{0,40}(?:论文|文章|简历|网站|网页|ppt|PPT|产品|代码|项目|海报|报告)',
      r'(?:可能会|可能要|会被安排|被安排).{0,36}(?:设计|开发|制作|改|写|做).{0,28}(?:病历夹|产品|网页|网站|前端|代码|ppt|PPT|论文|简历)'
    ]
    return any(re.search(p,t,re.I) for p in patterns)

def intent_artifact_types(text):
    # Map explicit future-facing language to artifact categories. Generic 产品/系统 alone is intentionally insufficient.
    t=(text or '').lower(); found=[]
    for typ,terms in ARTIFACTS.items():
        if typ=='Product / Feature':
            specific=['病历夹','桌宠','小程序','具体功能','功能原型','产品原型']
            if any(x.lower() in t for x in specific): found.append(typ)
            continue
        if any(term.lower() in t for term in terms): found.append(typ)
    if ('个人网站' in t or 'website' in t) and 'Website / HTML' not in found: found.append('Website / HTML')
    if ('ppt' in t or 'pre ' in t) and 'Presentation' not in found: found.append('Presentation')
    if ('简历' in t or '作品集' in t) and 'Resume / Portfolio' not in found: found.append('Resume / Portfolio')
    return found

def intent_action_preferences(text):
    t=text or ''
    if re.search(r'(提交|投稿|上传|交论文)',t,re.I): return ['submit','publish','revise','create','share']
    if re.search(r'(发表|发布|上线|开源)',t,re.I): return ['publish','submit','create','revise','share']
    if re.search(r'(分享|展示|演示|发给)',t,re.I): return ['share','publish','submit','create','revise']
    if re.search(r'(改|修改|优化|迭代)',t,re.I): return ['revise','create','submit','publish','share']
    return ['create','revise','submit','publish','share']

def concrete_artifact_event(a):
    text=a.get('text',''); action=a.get('action',''); typ=a.get('artifact_type','')
    if not text: return False
    if typ=='Product / Feature' and re.search(r'(修改|改).{0,12}病历夹.{0,8}权限|病历夹.{0,8}权限',text,re.I): return False
    if any(x in text for x in ['（什么','(什么','最终达到了（','如果没有','有没有','会不会','能不能']): return False
    if any(x in text for x in ['没做完','没有做完','还没做完','没完成','没有完成','未完成','一篇论文都没有产出']): return False
    if re.search(r'(他|她|他们|她们|牢弟|章哥).{0,24}(发表|发布|做了|写了|提交|上传|分享)',text) and '我' not in text: return False
    future=['计划','争取','希望','目标','准备','打算','明天','下周','下个月','以后','我会','能不能','要完成','要发表','要提交','可能会','预计','想要去','想要发表']
    completed=['已经','完成了','做完','写完','熬完','发表了','成功发表','被接收','提交了','上传到','上传了','分享了','向他们分享','发给了','写了','做了','生成','改了','改改','修改','更新','整理到了','注册交论文','交论文']
    if any(x in text for x in future) and not any(x in text for x in completed): return False

    if action=='create':
        if typ=='Product / Feature':
            return bool(re.search(r'(我.{0,24}|^)(做完|做了|开发了|实现了|制作了|做成|完成了).{0,30}(病历夹|桌宠|小程序)',text,re.I))
        terms=[re.escape(x) for x in ARTIFACTS.get(typ,[]) if len(x)>=2]
        if not terms: return False
        term_re='(?:'+'|'.join(terms)+')'
        return bool(re.search(r'(完成了?|做完|写完|熬完|制作了?|生成(?:了)?|开发了?|实现了?|搭建了?|写了|画了|做了).{0,45}'+term_re,text,re.I) or re.search(term_re+r'.{0,28}(完成了?|做完|写完|熬完|制作了?|生成(?:了)?|开发了?|实现了?|搭建了?)',text,re.I))
    if action=='revise':
        if re.search(r'(不看|没看|不看看|没有改|没改)',text,re.I): return False
        if typ=='Product / Feature':
            return bool(re.search(r'(改|修改|更新|重构|优化|迭代).{0,25}(病历夹|桌宠|小程序|具体功能)',text,re.I))
        terms=[re.escape(x) for x in ARTIFACTS.get(typ,[]) if len(x)>=2]
        if not terms: return False
        term_re='(?:'+'|'.join(terms)+')'
        return bool(re.search(r'(改|修改|更新|重构|优化|整理|包装).{0,25}'+term_re,text,re.I))
    if action=='submit':
        return bool(re.search(r'(我.{0,30})?(提交了|已经提交|上传了|上传到|已经上传|投稿了|注册交论文|交论文|推到github|推上github|把.{0,30}上传)',text,re.I)) and not re.search(r'(当时提交|提交.{0,12}遇到的问题|准备提交)',text,re.I)
    if action=='publish':
        return bool(re.search(r'(成功发表|发表了|被接收|接收了|录用|上线了|发布了|开源了)',text,re.I)) and not re.search(r'(他|她|他们|牢弟|消息|如果|想要|希望)',text,re.I)
    if action=='share':
        if typ=='Product / Feature':
            return bool(re.search(r'(我.{0,30}(分享|发给|展示|演示)|向(?:他们|他|她|朋友|同学|同事).{0,18}(分享|展示)|顺便把.{0,35}发给).{0,40}(桌宠|病历夹|小程序|安装包)',text,re.I))
        return bool(re.search(r'(我.{0,35}(分享|发给|展示|演示|给.{0,10}看)|把.{0,35}(发给|分享给|给.{0,10}看)|向(?:他们|他|她|老师|老板|朋友|同学|同事).{0,18}(分享|展示|汇报))',text,re.I))
    return False

def strict_achievement(text,action):
    t=text or ''
    if '（什么' in t or '(什么' in t or '最终达到了（' in t: return None
    future=['计划','争取','希望','目标','准备','打算','明天','下周','以后','能不能','想要','想做','要完成','要发表','要提交','可能会','预计']
    if any(x in t for x in future): return None
    if re.search(r'(他|她|他们|她们).{0,18}(发表|发布|做了|写了|提交|上传|分享)',t) and '我' not in t: return None
    markers={
      'create':['完成了','做完','写完','画完','改完','做成','实现了','开发了','搭建了','制作了','生成了','做了','写了','画了'],
      'revise':['改完','修改了','更新了','重构了','优化了','包装了','整理了'],
      'submit':['提交了','已经提交','上传了','已经上传','投稿了','投了','交了','推到github','推上github'],
      'publish':['成功发表','发表了','被接收','接收了','上线了','发布了','开源了','录用'],
      'share':['分享了','向他们分享','向他分享','向她分享','发给了','展示了','演示了','发了','给他们看','给他看','给她看'],
    }
    for m in markers.get(action,[]):
        if m.lower() in t.lower(): return m
    return None

def is_explicit_received_feedback(text):
    t=text or ''
    if re.search(r'我.{0,16}(问|求|请).{0,24}(建议|意见|有没有看|评价)',t,re.I): return False
    if re.search(r'(可能|也许|假如|如果|会因为).{0,30}(意见|冲突|拒|反馈)',t,re.I): return False
    if re.search(r'(得到|得到了|获得|收到了).{0,20}(认可|肯定|反馈|建议|意见)',t,re.I): return True
    if re.search(r'(评审|老师|老板|同学|他们|他|她).{0,18}(说|指出|反馈|建议|评价|夸|肯定).{0,50}',t,re.I): return True
    if re.search(r'(对我的|对于我的|对我).{0,24}(有意见|反馈|评价|建议|认可|肯定)',t,re.I): return True
    if re.search(r'(他|她|他们|老师|老板|同学|学弟).{0,14}问我.{0,36}(怎么|为什么|如何|是什么|进展|问题)',t,re.I): return True
    return False

def is_explicit_validation(text):
    t=text or ''
    if re.search(r'(看看|等待|等.{0,10}结果|如果|以后|之后|早点|希望|能不能|会不会|可能|目标)',t,re.I): return False
    patterns=[
      r'被接收了', r'成功发表了?', r'得到了?.{0,18}(认可|肯定)', r'收到了?.{0,18}(认可|肯定)',
      r'(他|她|老师|导师|老板|同学).{0,16}夸了?我', r'被.{0,16}(认可|肯定|录用)', r'获得了?.{0,12}(认可|肯定|奖)'
    ]
    return any(re.search(p,t,re.I) for p in patterns)

def build_lineage_layer(con,cfg):
    ensure_schema(con)
    if con.execute("SELECT COUNT(*) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0] == 0:
        summary={'thought_artifact_trails':0,'project_artifact_families':0,'artifact_ancestry_edges':0,'version_trees':0,'latency_profiles':0,'feedback_loops':0,'rework_cycles':0,'cross_pollination_pairs':0,'first_proofs':0,'unfinished_lineages':0,'release_cadence_profiles':0,'evidence_chains':0}
        con.executemany('INSERT INTO lineage_summary(key,value) VALUES(?,?)',[(k,str(v)) for k,v in summary.items()]); con.commit(); return summary
    vocab=anchor_vocab(cfg)
    memories={r['id']:dict(r) for r in con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL")}
    ctx={mid:memory_context(con,mid) for mid in memories}
    artifact_rows=[dict(r) for r in con.execute('SELECT * FROM artifact_ledger ORDER BY date,id')]
    artifacts_by_type=collections.defaultdict(list)
    for a in artifact_rows: artifacts_by_type[a['artifact_type']].append(a)

    # 1) Thought -> artifact: conservative category-matched pairings only.
    # Sources include idea candidates, promise ledger and the source side of future echoes.
    # They are deduplicated by dated source text before pairing.
    thoughts=[]; seen_thoughts=set()
    raw_thoughts=[]
    for r in con.execute("SELECT i.id AS raw_id,i.memory_id,i.date,m.source_path,i.text,'idea' AS source_kind FROM idea_candidates i JOIN memories m ON m.id=i.memory_id WHERE i.date IS NOT NULL ORDER BY i.date"):
        raw_thoughts.append(dict(r))
    for r in con.execute("SELECT id AS raw_id,memory_id,date,source_path,text,'promise' AS source_kind FROM promise_ledger WHERE date IS NOT NULL ORDER BY date"):
        x=dict(r); x['raw_id']=1000000+x['raw_id']; raw_thoughts.append(x)
    for r in con.execute("SELECT id AS raw_id,source_date AS date,source_path,source_text AS text,'future_echo' AS source_kind FROM future_echoes WHERE source_date IS NOT NULL ORDER BY source_date"):
        x=dict(r); mem=con.execute("SELECT id FROM memories WHERE source_path=? LIMIT 1",(x['source_path'],)).fetchone()
        if not mem: continue
        x['memory_id']=mem[0]; x['raw_id']=2000000+x['raw_id']; raw_thoughts.append(x)
    raw_thoughts.sort(key=lambda x:(x['date'],x['source_path'],x['raw_id']))
    for x in raw_thoughts:
        key=(x['date'],x['source_path'],re.sub(r'\s+',' ',x['text']).strip())
        if key in seen_thoughts: continue
        seen_thoughts.add(key)
        if not is_future_intention(x['text']): continue
        if re.search(r'(^|[，。；!?\s])(他|她|他们|她们).{0,18}(想|计划|准备|希望|打算)',x['text']) and '我' not in x['text']: continue
        intent_types=intent_artifact_types(x['text'])
        if not intent_types: continue
        x['id']=x['raw_id']; x['anchors']=anchors(x['text'],vocab); x['intent_types']=intent_types; x['action_preferences']=intent_action_preferences(x['text'])
        thoughts.append(x)

    tat=[]
    for th in thoughts:
        td=d(th['date']); tctx=ctx.get(th['memory_id'],{'labels':set()})['labels']
        candidates=[]
        for a in artifact_rows:
            if a['artifact_type'] not in th['intent_types']: continue
            gap=(d(a['date'])-td).days
            if gap<0 or gap>240: continue
            if not concrete_artifact_event(a): continue
            if a['source_path']==th['source_path'] and a['text'].strip()==th['text'].strip(): continue
            aa=anchors(a['text'],vocab)
            shared_a=sorted(set(x.lower() for x in th['anchors']) & set(x.lower() for x in aa))
            shared_ctx=sorted(tctx & ctx.get(a['memory_id'],{'labels':set()})['labels'])
            if gap==0 and not shared_a: continue
            anchor_bonus=3.2*len(shared_a)
            type_bonus=3.2
            context_bonus=0.35*min(len(shared_ctx),4)
            time_bonus=max(0.15,1.8-gap/180)
            action_bonus={'publish':1.2,'submit':1.0,'share':0.9,'create':0.8,'revise':0.6}.get(a['action'],0)
            score=type_bonus+anchor_bonus+context_bonus+time_bonus+action_bonus
            if not shared_a and gap>120: continue
            action_rank=th['action_preferences'].index(a['action']) if a['action'] in th['action_preferences'] else 99
            if score>=5.0: candidates.append((score,gap,a,shared_a,shared_ctx,action_rank))
        candidates.sort(key=lambda z:(0 if z[3] else 1,-len(z[3]),z[5],z[1],-z[0]))
        if candidates:
            score,gap,a,sa,sc,_rank=candidates[0]
            tat.append((th,a,gap,sa,sc,score))
    tat.sort(key=lambda z:(-z[5],z[2]))
    for th,a,gap,sa,sc,score in tat[:160]:
        con.execute('''INSERT INTO thought_artifact_trails(thought_id,thought_date,thought_source,thought_text,artifact_id,artifact_date,artifact_source,
                     artifact_type,artifact_action,artifact_text,gap_days,shared_anchors_json,shared_context_json,score,note)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (th['id'],th['date'],th['source_path'],th['text'],a['id'],a['date'],a['source_path'],a['artifact_type'],a['action'],a['text'],gap,js(sa),js(sc),round(score,2),
                     'A future-facing sentence naming this artifact category is placed before a later concrete artifact trace. Shared anchors raise confidence. Category/time proximity does not prove the thought caused, became, or was fulfilled by the artifact.'))

    # 2) Project -> Artifact Families. Category families, not inferred named projects.
    proj=[dict(r) for r in con.execute("SELECT p.*,m.source_path FROM project_candidates p JOIN memories m ON m.id=p.memory_id WHERE p.date IS NOT NULL ORDER BY p.date")]
    for typ, ars in artifacts_by_type.items():
        terms=ARTIFACTS.get(typ,[])
        ps=[]
        for p in proj:
            if any(t.lower() in p['text'].lower() for t in terms): ps.append(p)
        if not ps: continue
        p_days=sorted(set(x['date'] for x in ps)); a_days=sorted(set(x['date'] for x in ars))
        contexts=collections.Counter()
        for x in ps:
            contexts.update(ctx.get(x['memory_id'],{'labels':set()})['labels'])
        for x in ars:
            contexts.update(ctx.get(x['memory_id'],{'labels':set()})['labels'])
        con.execute('''INSERT INTO project_artifact_families VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(
            typ,len(p_days),len(a_days),p_days[0],p_days[-1],a_days[0],a_days[-1],js([x for x,_ in contexts.most_common(10)]),
            js(list(dict.fromkeys(x['source_path'] for x in ps))[:12]),js(list(dict.fromkeys(x['source_path'] for x in ars))[:12]),
            'This is an artifact-category family built from project-candidate text containing the same explicit artifact vocabulary. It may contain multiple distinct real-world projects.'
        ))

    # 3) Artifact ancestry: adjacent category-level traces.
    ancestry=[]
    for typ,ars in artifacts_by_type.items():
        for left,right in zip(ars,ars[1:]):
            gap=(d(right['date'])-d(left['date'])).days
            if gap<0: continue
            ancestry.append((typ,left,right,gap))
            con.execute('''INSERT INTO artifact_ancestry(artifact_type,from_artifact_id,to_artifact_id,from_date,to_date,gap_days,from_action,to_action,from_source,to_source,from_text,to_text,note)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(
                typ,left['id'],right['id'],left['date'],right['date'],gap,left['action'],right['action'],left['source_path'],right['source_path'],left['text'],right['text'],
                'Adjacent traces inside the same artifact category. Category adjacency is not proof they are versions of the exact same file or project.'
            ))

    # 4) Version trees summarize action sequences + branches.
    for typ,ars in artifacts_by_type.items():
        seq=[{'date':a['date'],'action':a['action'],'source_path':a['source_path'],'text':a['text'][:180]} for a in ars]
        trans=collections.Counter((a['action'],b['action']) for a,b in zip(ars,ars[1:]))
        branches=[]
        for action,c in collections.Counter(a['action'] for a in ars).items():
            outs=collections.Counter(b['action'] for a,b in zip(ars,ars[1:]) if a['action']==action)
            if len(outs)>=2: branches.append({'from':action,'to':dict(outs)})
        con.execute('''INSERT INTO version_trees VALUES(?,?,?,?,?,?,?,?,?)''',(
            typ,ars[0]['date'],ars[-1]['date'],len(set(a['date'] for a in ars)),len(ars),js(seq),js([{'from':a,'to':b,'count':c} for (a,b),c in trans.most_common()]),js(branches),
            'A category-level action tree. It visualizes how create/revise/submit/publish/share traces succeed one another; it does not reconstruct exact file versions.'
        ))

    # 5) Idea -> output latency aggregated from strong trails.
    tat_rows=[dict(r) for r in con.execute('SELECT * FROM thought_artifact_trails ORDER BY score DESC')]
    by=collections.defaultdict(list)
    for x in tat_rows: by[x['artifact_type']].append(x)
    for typ,xs in by.items():
        vals=[x['gap_days'] for x in xs]
        samples=[{'thought_date':x['thought_date'],'artifact_date':x['artifact_date'],'gap_days':x['gap_days'],'thought_source':x['thought_source'],'artifact_source':x['artifact_source']} for x in xs[:8]]
        con.execute('INSERT INTO idea_output_latency VALUES(?,?,?,?,?,?,?)',(
            typ,len(vals),round(statistics.median(vals),1),min(vals),max(vals),js(samples),
            'Latency is the calendar gap between a conservatively linked idea-like sentence and a later artifact trace. It is not build time and does not prove implementation.'
        ))

    # 6) Feedback loops: artifact -> later feedback -> optional next revision, same category/time.
    loops=[]
    feedbacks=[dict(r) for r in con.execute("SELECT * FROM feedback_echoes WHERE artifact_type IS NOT NULL AND prior_artifact_date IS NOT NULL ORDER BY date") if is_explicit_received_feedback(r['text'] or '')]
    for fb in feedbacks:
        # Rank concrete prior artifact traces by explicit shared anchor first, then proximity.
        pool=[a for a in artifacts_by_type.get(fb['artifact_type'],[]) if a['date']<=fb['date'] and concrete_artifact_event(a)]
        ranked=[]; fb_a=anchors(fb['text'],vocab)
        for a in pool:
            if a['source_path']==fb['source_path'] and a['text'].strip()==fb['text'].strip(): continue
            gap=(d(fb['date'])-d(a['date'])).days
            if gap<0 or gap>90: continue
            shared=sorted(set(x.lower() for x in fb_a)&set(x.lower() for x in anchors(a['text'],vocab)))
            if gap==0 and not shared: continue
            if not shared and gap>30: continue
            ranked.append((0 if shared else 1,-len(shared),gap,a))
        if not ranked: continue
        ranked.sort(key=lambda z:(z[0],z[1],z[2]))
        art=ranked[0][3]
        gap=(d(fb['date'])-d(art['date'])).days
        revisions=[a for a in artifacts_by_type.get(fb['artifact_type'],[]) if a['action']=='revise' and concrete_artifact_event(a) and a['date']>fb['date'] and (d(a['date'])-d(fb['date'])).days<=90]
        rev=revisions[0] if revisions else None
        gr=(d(rev['date'])-d(fb['date'])).days if rev else None
        score=2.0+(1.5 if rev else 0)+max(0,1-gap/45)
        loops.append((art,fb,rev,gap,gr,score))
        con.execute('''INSERT INTO lineage_feedback_loops(artifact_type,artifact_date,artifact_source,artifact_text,feedback_date,feedback_source,feedback_text,next_revision_date,next_revision_source,gap_to_feedback,gap_to_revision,score,note)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(
            fb['artifact_type'],art['date'],art['source_path'],art['text'],fb['date'],fb['source_path'],fb['text'],rev['date'] if rev else None,rev['source_path'] if rev else None,gap,gr,round(score,2),
            'Artifact → feedback → optional later revision review chain. Type/time proximity does not prove the feedback caused the revision or referred to the exact same artifact.'
        ))

    # 7) Rework cycles: clusters of >=2 distinct revision days separated <=30 days.
    cycles=[]
    for typ,ars in artifacts_by_type.items():
        revs=[]
        seen=set()
        for a in ars:
            if a['action']=='revise' and a['date'] not in seen:
                seen.add(a['date']); revs.append(a)
        if len(revs)<2: continue
        groups=[]; cur=[revs[0]]
        for a in revs[1:]:
            if (d(a['date'])-d(cur[-1]['date'])).days<=30: cur.append(a)
            else:
                if len(cur)>=2: groups.append(cur)
                cur=[a]
        if len(cur)>=2: groups.append(cur)
        for g in groups:
            span=(d(g[-1]['date'])-d(g[0]['date'])).days
            cycles.append((typ,g,span))
            con.execute('INSERT INTO rework_cycles(artifact_type,start_date,end_date,revision_days,span_days,source_paths_json,sample_texts_json,note) VALUES(?,?,?,?,?,?,?,?)',(
                typ,g[0]['date'],g[-1]['date'],len(g),span,js([a['source_path'] for a in g]),js([a['text'][:220] for a in g[:6]]),
                'Cluster of explicit revise-like traces no more than 30 days apart. It may represent iterative work on one artifact or separate artifacts of the same category.'
            ))

    # 8) Cross-pollination: artifact categories appearing same/nearby days.
    pair_stats={}
    types=sorted(artifacts_by_type)
    for i,left in enumerate(types):
        for right in types[i+1:]:
            la=artifacts_by_type[left]; rb=artifacts_by_type[right]
            pairs=[]
            for a in la:
                for b in rb:
                    gap=abs((d(a['date'])-d(b['date'])).days)
                    if gap<=7: pairs.append((a,b,gap))
            if len(pairs)<2: continue
            shared_days=len(set(a['date'] for a,b,g in pairs if g==0) | set(b['date'] for a,b,g in pairs if g==0))
            skill_counter=collections.Counter(); topic_counter=collections.Counter(); sources=[]
            for a,b,g in pairs[:80]:
                sources.extend([a['source_path'],b['source_path']])
                ca,cb=ctx.get(a['memory_id'],{}),ctx.get(b['memory_id'],{})
                for x in set(ca.get('skills',[])) & set(cb.get('skills',[])): skill_counter[x]+=1
                for x in set(ca.get('topics',[])) & set(cb.get('topics',[])): topic_counter[x]+=1
            con.execute('INSERT INTO cross_pollination VALUES(?,?,?,?,?,?,?,?,?)',(
                left,right,len(pairs),shared_days,round(statistics.median([g for _,_,g in pairs]),1),js([x for x,_ in skill_counter.most_common(8)]),js([x for x,_ in topic_counter.most_common(8)]),js(list(dict.fromkeys(sources))[:12]),
                'Two artifact categories appeared on the same or nearby (≤7 day) archive dates. This is a cross-pollination review cue, not evidence that one artifact influenced the other.'
            ))

    # 9) First proofs: earliest strict self-directed achieved trace by artifact category.
    proofs=[]
    for typ,ars in artifacts_by_type.items():
        for a in ars:
            marker=strict_achievement(a['text'],a['action'])
            if marker and concrete_artifact_event(a):
                proofs.append((typ,a,marker));
                con.execute('INSERT INTO first_proofs VALUES(?,?,?,?,?,?,?)',(
                    typ,a['date'],a['source_path'],a['action'],a['text'],marker,
                    'Earliest conservative achieved/output marker found for this artifact category. “First recorded proof” is not necessarily the first time in real life.'
                ));break

    # 10) Unfinished lineages: old dormant idea/project threads with no later strong artifact link.
    linked_thought_ids={x['thought_id'] for x in tat_rows}
    latest=con.execute("SELECT MAX(date) FROM memories WHERE kind='daily' AND date_anomaly=0").fetchone()[0]
    candidates=[]
    for r in con.execute("SELECT * FROM dormant_threads WHERE kind IN ('idea','project') AND occurrences>=2 ORDER BY dormant_days DESC"):
        x=dict(r); srcs=json.loads(x['source_paths_json'] or '[]'); samples=json.loads(x['samples_json'] or '[]')
        # Require old enough and no direct artifact vocabulary in the later sample leading to a trace.
        if x['dormant_days']<120: continue
        candidates.append((x,srcs,samples))
    # Dedupe generic anchors and prefer interpretable anchors.
    bad_anchor=['老师','妈妈','我想着是','这让我想','要做的','还是','朋友']
    ui=0
    for x,srcs,samples in candidates:
        if any(x['anchor']==b for b in bad_anchor): continue
        con.execute('INSERT INTO unfinished_lineages(kind,anchor,first_date,last_date,span_days,occurrences,days_since,source_paths_json,sample_texts_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)',(
            x['kind'],x['anchor'],x['first_date'],x['last_date'],(d(x['last_date'])-d(x['first_date'])).days,x['occurrences'],x['dormant_days'],js(srcs),js([s.get('text','') for s in samples]),
            'A repeated idea/project-like thread became quiet and has no confidently linked artifact lineage in this layer. “Unfinished” means untraced in the archive, not incomplete in life.'
        )); ui+=1
        if ui>=80: break

    # 11) Release cadence: explicit outward artifact events.
    outbound={'submit','publish','share'}
    for typ,ars in artifacts_by_type.items():
        ev=[a for a in ars if a['action'] in outbound and concrete_artifact_event(a)]
        if not ev: continue
        dates=sorted(set(a['date'] for a in ev)); gaps=[(d(b)-d(a)).days for a,b in zip(dates,dates[1:])]
        monthly=collections.Counter(x[:7] for x in dates)
        con.execute('INSERT INTO release_cadence VALUES(?,?,?,?,?,?,?,?,?,?)',(
            typ,len(ev),dates[0],dates[-1],round(statistics.median(gaps),1) if gaps else None,max(gaps) if gaps else None,len(monthly),js([{'month':m,'events':c} for m,c in sorted(monthly.items())]),js(list(dict.fromkeys(a['source_path'] for a in ev))[:12]),
            'Cadence of explicit submit/publish/share traces. It measures archive spacing, not shipping velocity, productivity, or quality.'
        ))

    # 12) Evidence chains: compose only dated source-backed steps.
    chains=[]
    # thought -> artifact -> optional handoff -> optional feedback/validation
    for tr in tat_rows[:120]:
        steps=[{'kind':'thought','date':tr['thought_date'],'source_path':tr['thought_source'],'text':tr['thought_text']},
               {'kind':'artifact','date':tr['artifact_date'],'source_path':tr['artifact_source'],'text':tr['artifact_text'],'action':tr['artifact_action']}]
        typ=tr['artifact_type']; end=tr['artifact_date']; score=tr['score']
        hand=con.execute('''SELECT * FROM handoff_moments WHERE artifact_type=? AND date>=? AND julianday(date)-julianday(?) BETWEEN 0 AND 90 ORDER BY date LIMIT 1''',(typ,tr['artifact_date'],tr['artifact_date'])).fetchone()
        if hand:
            steps.append({'kind':'handoff','date':hand['date'],'source_path':hand['source_path'],'text':hand['text']});end=hand['date'];score+=1.3
        vals=[dict(v) for v in con.execute('''SELECT * FROM external_validation WHERE artifact_type=? AND date>=? AND julianday(date)-julianday(?) BETWEEN 0 AND 120 ORDER BY date''',(typ,end,end))]
        val=next((v for v in vals if is_explicit_validation(v['text'])),None)
        fb=con.execute('''SELECT feedback_date AS date,feedback_source AS source_path,feedback_text AS text FROM lineage_feedback_loops
                          WHERE artifact_type=? AND feedback_date>=? AND julianday(feedback_date)-julianday(?) BETWEEN 0 AND 120
                          ORDER BY feedback_date LIMIT 1''',(typ,end,end)).fetchone()
        later=None; kind=None
        if val and fb: later=val if val['date']<=fb['date'] else dict(fb); kind='validation' if later is val else 'feedback'
        elif val: later=val; kind='validation'
        elif fb: later=dict(fb); kind='feedback'
        if later:
            steps.append({'kind':kind,'date':later['date'],'source_path':later['source_path'],'text':later['text']});end=later['date'];score+=1.4
        if len(steps)>=3:
            chains.append((typ,steps,tr['thought_date'],end,score))
    # feedback -> revision chains are also valuable even without an idea step.
    for art,fb,rev,gap,gr,score in loops:
        if not rev: continue
        steps=[{'kind':'artifact','date':art['date'],'source_path':art['source_path'],'text':art['text'],'action':art['action']},
               {'kind':'feedback','date':fb['date'],'source_path':fb['source_path'],'text':fb['text']},
               {'kind':'revision','date':rev['date'],'source_path':rev['source_path'],'text':rev['text'],'action':rev['action']}]
        chains.append((fb['artifact_type'],steps,art['date'],rev['date'],score+1.5))
    # dedupe source/date signature
    seen=set(); cid=0
    for typ,steps,start,end,score in sorted(chains,key=lambda x:-x[4]):
        sig=tuple((s['kind'],s['date'],s['source_path']) for s in steps)
        if sig in seen: continue
        seen.add(sig); cid+=1
        con.execute('INSERT INTO evidence_chains(chain_type,artifact_type,start_date,end_date,span_days,steps_json,score,note) VALUES(?,?,?,?,?,?,?,?)',(
            ' → '.join(s['kind'] for s in steps),typ,start,end,(d(end)-d(start)).days,js(steps),round(score,2),
            'A composited chain of already source-linked dated records. The chain is an audit path, not a causal story; missing steps remain missing.'
        ))
        if cid>=100: break

    # Summary
    summary={
      'thought_artifact_trails':con.execute('SELECT COUNT(*) FROM thought_artifact_trails').fetchone()[0],
      'project_artifact_families':con.execute('SELECT COUNT(*) FROM project_artifact_families').fetchone()[0],
      'artifact_ancestry_edges':con.execute('SELECT COUNT(*) FROM artifact_ancestry').fetchone()[0],
      'version_trees':con.execute('SELECT COUNT(*) FROM version_trees').fetchone()[0],
      'latency_profiles':con.execute('SELECT COUNT(*) FROM idea_output_latency').fetchone()[0],
      'feedback_loops':con.execute('SELECT COUNT(*) FROM lineage_feedback_loops').fetchone()[0],
      'rework_cycles':con.execute('SELECT COUNT(*) FROM rework_cycles').fetchone()[0],
      'cross_pollination_pairs':con.execute('SELECT COUNT(*) FROM cross_pollination').fetchone()[0],
      'first_proofs':con.execute('SELECT COUNT(*) FROM first_proofs').fetchone()[0],
      'unfinished_lineages':con.execute('SELECT COUNT(*) FROM unfinished_lineages').fetchone()[0],
      'release_cadence_profiles':con.execute('SELECT COUNT(*) FROM release_cadence').fetchone()[0],
      'evidence_chains':con.execute('SELECT COUNT(*) FROM evidence_chains').fetchone()[0],
    }
    con.executemany('INSERT INTO lineage_summary(key,value) VALUES(?,?)',[(k,str(v)) for k,v in summary.items()])
    con.commit()
    return summary

if __name__=='__main__':
    con=sqlite3.connect(ROOT/'data/lifeos.db'); con.row_factory=sqlite3.Row
    cfg=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
    print(json.dumps(build_lineage_layer(con,cfg),ensure_ascii=False,indent=2));con.close()

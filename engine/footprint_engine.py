#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, re, collections, datetime, math

ROOT=Path(__file__).resolve().parents[1]

def js(x): return json.dumps(x,ensure_ascii=False)
def d(s): return datetime.date.fromisoformat(s)

def split_sentences(text):
    out=[]
    for line in (text or '').splitlines():
        line=re.sub(r'^\s*[-*+]\s*','',line.strip())
        line=re.sub(r'\s+',' ',line).strip()
        if not line: continue
        for p in re.split(r'(?<=[。！？!?；;])\s*',line):
            p=p.strip()
            if 5<=len(p)<=320: out.append(p)
    return out

ARTIFACTS={
 'Paper / Manuscript':['论文','paper','稿件','投稿','文章','manuscript'],
 'Presentation':['ppt','presentation','汇报','演讲','pre '],
 'Poster':['海报','poster'],
 'PRD / Product Doc':['prd','需求文档','产品文档'],
 'Prototype / Demo':['原型','demo','交互稿','墨刀'],
 'Website / HTML':['网站','网页','个人主页','html'],
 'Code / Repository':['代码','代码库','github','仓库','安装包','软件','程序'],
 'Report / Research Doc':['报告','调研报告','研究内容','文档'],
 'Resume / Portfolio':['简历','作品集','portfolio'],
 'Diagram / Figure':['流程图','架构图','figure','fig1','svg'],
 'Dataset / Experiment':['数据集','实验结果','benchmark','评测结果'],
 'Product / Feature':['产品','功能','系统','小程序','桌宠','病历夹'],
}
CREATE=['完成','做完','制作','生成','写完','画完','搭建','实现','开发','产出','做出','做成','搞完','弄完','熬完','整理完','准备好','完成了','做了','写了','画了','更新了','改完']
REVISE=['改','修改','更新','包装','整理','重构','优化','迭代']
SUBMIT=['提交','投稿','上传','交付','注册交','交论文','推到github','推上github']
PUBLISH=['发表','发布','上线','开源']
SHARE=['分享','发给','给他看','给她看','给他们看','展示','演示','show','发到','发了','发给了']
HANDOFF=['交给','交付','提交','上传','发给','对接','移交','给开发','给测试','给老师','给老板','汇报']
FEEDBACK=['反馈','意见','建议','认可','肯定','夸','表扬','问我','说我','说这个','评价','觉得这个','能实现','实现不了','没法开发','通过了','接收了','被接收','拒稿','被拒']
VALIDATION=['被接收','接收了','录用','通过了','认可','肯定','夸','获奖','金奖','银奖','奖状','发表了','成功发表','上线了','拿到offer','拿到了offer','accepted','批准']
CONTRIB=['帮','帮助','教','带','协助','支持','分享','发给','给他看','给她看','给他们看','给别人','提醒','建议','准备给','做给']
WORK_CONTEXT=['论文','科研','实习','工作','项目','产品','代码','网站','网页','简历','作品集','报告','ppt','海报','经验','心得','安装包','资料','信息','原型','文档','模型','数据集']
AUDIENCES=['老板','老师','导师','教授','朋友','同学','同事','开发','测试','用户','医生','客户','学弟','学妹','师兄','师姐','评委','学生','姐姐','家人','项目组','组里']

NEGATIVE_DONE=['没做完','没有做完','还没做完','没完成','没有完成','未完成','实现不了','没法实现','没法开发']

def contains_any(text,arr):
    low=text.lower()
    return [x for x in arr if x.lower() in low]

def first_person_outward(text):
    # Conservative directionality check: “X 向我分享 / 帮助我 / 教会我” is incoming, not my outward footprint.
    if re.search(r'(跟|和|向)我(?:分享|展示|发)',text) or re.search(r'(?:帮我|帮助我|教我|教会了?我|给我看|发给我)',text):
        return False
    patterns=[
      r'我.{0,24}(?:分享|发给|展示|演示|帮|帮助|教|协助|提醒|建议|给.{0,10}看)',
      r'我把.{0,40}(?:发给|分享|给.{0,10}看|上传|提交)',
      r'分享了我的',
      r'把我.{0,40}(?:发给|分享给|给.{0,10}看)',
      r'向(?:他们|他|她|老师|老板|朋友|同学|同事|开发|测试|用户|医生|客户).{0,12}(?:分享|展示|汇报)',
      r'顺便把.{0,40}发给',
      r'顺便帮',
      r'帮[^，。；!?]{1,14}(?:改|做|看|准备)'
    ]
    return any(re.search(p,text,re.I) for p in patterns)

def artifact_types(text):
    low=text.lower(); found=[]
    for typ,terms in ARTIFACTS.items():
        hits=[t for t in terms if t.lower() in low]
        if hits: found.append((typ,hits))
    return found

def classify_action(text):
    if contains_any(text,PUBLISH): return 'publish'
    if contains_any(text,SUBMIT): return 'submit'
    if contains_any(text,SHARE): return 'share'
    if contains_any(text,CREATE) and not contains_any(text,NEGATIVE_DONE): return 'create'
    if contains_any(text,REVISE): return 'revise'
    return None

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS footprint_summary;
    DROP TABLE IF EXISTS artifact_ledger;
    DROP TABLE IF EXISTS output_trails;
    DROP TABLE IF EXISTS sharing_trails;
    DROP TABLE IF EXISTS handoff_moments;
    DROP TABLE IF EXISTS audience_map;
    DROP TABLE IF EXISTS feedback_echoes;
    DROP TABLE IF EXISTS external_validation;
    DROP TABLE IF EXISTS reuse_trails;
    DROP TABLE IF EXISTS learning_output_links;
    DROP TABLE IF EXISTS artifact_leadups;
    DROP TABLE IF EXISTS contribution_threads;
    DROP TABLE IF EXISTS legacy_questions;

    CREATE TABLE footprint_summary(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE artifact_ledger(
      id INTEGER PRIMARY KEY,memory_id INTEGER NOT NULL,date TEXT NOT NULL,source_path TEXT NOT NULL,
      artifact_type TEXT NOT NULL,action TEXT NOT NULL,text TEXT NOT NULL,matched_terms_json TEXT NOT NULL,
      confidence REAL NOT NULL,note TEXT NOT NULL
    );
    CREATE INDEX idx_artifact_date ON artifact_ledger(date);
    CREATE INDEX idx_artifact_type ON artifact_ledger(artifact_type);

    CREATE TABLE output_trails(
      artifact_type TEXT PRIMARY KEY,first_date TEXT,last_date TEXT,span_days INTEGER,recorded_days INTEGER,
      mentions INTEGER,create_days INTEGER,revise_days INTEGER,submit_days INTEGER,publish_days INTEGER,share_days INTEGER,
      sample_sources_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE sharing_trails(
      id INTEGER PRIMARY KEY,memory_id INTEGER NOT NULL,date TEXT NOT NULL,source_path TEXT NOT NULL,
      artifact_type TEXT NOT NULL,audiences_json TEXT NOT NULL,text TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE handoff_moments(
      id INTEGER PRIMARY KEY,memory_id INTEGER NOT NULL,date TEXT NOT NULL,source_path TEXT NOT NULL,
      artifact_type TEXT,marker TEXT NOT NULL,audiences_json TEXT NOT NULL,text TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE audience_map(
      audience TEXT NOT NULL,artifact_type TEXT NOT NULL,evidence_days INTEGER NOT NULL,mentions INTEGER NOT NULL,
      first_date TEXT,last_date TEXT,sample_sources_json TEXT NOT NULL,note TEXT NOT NULL,
      PRIMARY KEY(audience,artifact_type)
    );
    CREATE TABLE feedback_echoes(
      id INTEGER PRIMARY KEY,date TEXT NOT NULL,source_path TEXT NOT NULL,artifact_type TEXT,marker TEXT NOT NULL,
      text TEXT NOT NULL,prior_artifact_date TEXT,prior_source_path TEXT,gap_days INTEGER,note TEXT NOT NULL
    );
    CREATE TABLE external_validation(
      id INTEGER PRIMARY KEY,date TEXT NOT NULL,source_path TEXT NOT NULL,artifact_type TEXT,marker TEXT NOT NULL,
      text TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE reuse_trails(
      artifact_type TEXT PRIMARY KEY,first_date TEXT,last_date TEXT,span_days INTEGER,recorded_days INTEGER,
      return_gaps_json TEXT NOT NULL,sample_sources_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE learning_output_links(
      skill TEXT NOT NULL,artifact_type TEXT NOT NULL,output_days INTEGER NOT NULL,linked_outputs INTEGER NOT NULL,
      median_lead_days REAL,first_output_date TEXT,last_output_date TEXT,sample_sources_json TEXT NOT NULL,note TEXT NOT NULL,
      PRIMARY KEY(skill,artifact_type)
    );
    CREATE TABLE artifact_leadups(
      id INTEGER PRIMARY KEY,artifact_id INTEGER NOT NULL,date TEXT NOT NULL,source_path TEXT NOT NULL,artifact_type TEXT NOT NULL,
      action TEXT NOT NULL,lead_days INTEGER NOT NULL,top_skills_json TEXT NOT NULL,top_topics_json TEXT NOT NULL,
      prior_source_paths_json TEXT NOT NULL,note TEXT NOT NULL
    );
    CREATE TABLE contribution_threads(
      audience TEXT NOT NULL,context TEXT NOT NULL,recorded_days INTEGER NOT NULL,mentions INTEGER NOT NULL,
      first_date TEXT,last_date TEXT,span_days INTEGER,sample_sources_json TEXT NOT NULL,sample_texts_json TEXT NOT NULL,note TEXT NOT NULL,
      PRIMARY KEY(audience,context)
    );
    CREATE TABLE legacy_questions(
      id INTEGER PRIMARY KEY,priority REAL NOT NULL,question TEXT NOT NULL,reason TEXT NOT NULL,
      source_paths_json TEXT NOT NULL,note TEXT NOT NULL
    );
    ''')

def build_footprint_layer(con,cfg):
    ensure_schema(con)
    daily=con.execute("SELECT id,date,source_path,raw_text FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date").fetchall()
    artifacts=[]; sharing=[]; handoffs=[]; feedback=[]; validation=[]; contributions=[]
    for r in daily:
        mid,date,source,text=r['id'],r['date'],r['source_path'],r['raw_text']
        for sent in split_sentences(text):
            ats=artifact_types(sent); action=classify_action(sent)
            # Artifact ledger is deliberately stricter than generic mention extraction.
            if ats and action:
                # avoid negative completion as positive creation; negative implementation can still be feedback below.
                for typ,hits in ats:
                    confidence=.70
                    if action in ('submit','publish'): confidence=.92
                    elif action=='create': confidence=.86
                    elif action=='share': confidence=.78
                    elif action=='revise': confidence=.74
                    artifacts.append((mid,date,source,typ,action,sent,hits,confidence))
                    if action=='share' and first_person_outward(sent):
                        aud=contains_any(sent,AUDIENCES)
                        sharing.append((mid,date,source,typ,aud,sent))
            # sharing can be a work contribution even when artifact noun is implicit
            if contains_any(sent,SHARE) and contains_any(sent,WORK_CONTEXT) and first_person_outward(sent):
                ats2=ats or [('Work / Experience',contains_any(sent,WORK_CONTEXT))]
                aud=contains_any(sent,AUDIENCES)
                for typ,_ in ats2:
                    sharing.append((mid,date,source,typ,aud,sent))
            hm=contains_any(sent,HANDOFF)
            if hm and (ats or contains_any(sent,WORK_CONTEXT)):
                typ=ats[0][0] if ats else None; aud=contains_any(sent,AUDIENCES)
                handoffs.append((mid,date,source,typ,hm[0],aud,sent))
            fb=contains_any(sent,FEEDBACK)
            if fb and (ats or contains_any(sent,WORK_CONTEXT)):
                typ=ats[0][0] if ats else None
                feedback.append((date,source,typ,fb[0],sent))
            vv=contains_any(sent,VALIDATION)
            if vv and (ats or contains_any(sent,WORK_CONTEXT)):
                typ=ats[0][0] if ats else None
                validation.append((date,source,typ,vv[0],sent))
            cc=contains_any(sent,CONTRIB)
            if cc and contains_any(sent,WORK_CONTEXT) and first_person_outward(sent):
                aud=contains_any(sent,AUDIENCES) or ['unspecified']
                # context prefers artifact type; otherwise first work-context token
                ctx=ats[0][0] if ats else contains_any(sent,WORK_CONTEXT)[0]
                for a in aud:
                    contributions.append((date,source,a,ctx,sent))
    # dedupe artifact ledger by date/type/action/text
    seen=set(); artifact_rows=[]
    for x in artifacts:
        key=(x[1],x[3],x[4],x[5])
        if key in seen: continue
        seen.add(key); artifact_rows.append(x)
    for mid,date,source,typ,action,text,hits,conf in artifact_rows:
        con.execute("INSERT INTO artifact_ledger(memory_id,date,source_path,artifact_type,action,text,matched_terms_json,confidence,note) VALUES(?,?,?,?,?,?,?,?,?)",
                    (mid,date,source,typ,action,text,js(hits),conf,'Explicit output-oriented wording + artifact term. Candidate is a documented trace, not proof of quality, ownership, completion scope or external impact.'))

    # trails
    bytype=collections.defaultdict(list)
    for r in con.execute('SELECT * FROM artifact_ledger ORDER BY date,id'): bytype[r['artifact_type']].append(r)
    for typ,rs in bytype.items():
        dates=sorted(set(r['date'] for r in rs)); sources=[]
        for r in rs:
            if r['source_path'] not in sources:sources.append(r['source_path'])
        ac=collections.Counter(r['action'] for r in rs)
        con.execute("INSERT INTO output_trails VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (typ,dates[0],dates[-1],(d(dates[-1])-d(dates[0])).days,len(dates),len(rs),
                     len(set(r['date'] for r in rs if r['action']=='create')),len(set(r['date'] for r in rs if r['action']=='revise')),
                     len(set(r['date'] for r in rs if r['action']=='submit')),len(set(r['date'] for r in rs if r['action']=='publish')),
                     len(set(r['date'] for r in rs if r['action']=='share')),js(sources[:12]),'Longitudinal footprint of explicit output-oriented mentions. More recorded days does not equal greater value or effort.'))

    # sharing / handoffs dedupe
    seen=set()
    for mid,date,source,typ,aud,text in sharing:
        key=(date,typ,text)
        if key in seen:continue
        seen.add(key)
        con.execute("INSERT INTO sharing_trails(memory_id,date,source_path,artifact_type,audiences_json,text,note) VALUES(?,?,?,?,?,?,?)",
                    (mid,date,source,typ,js(aud),text,'Explicit outward sharing of a work/artifact/experience trace. Sharing does not imply reception or influence.'))
    seen=set()
    for mid,date,source,typ,marker,aud,text in handoffs:
        key=(date,marker,text)
        if key in seen:continue
        seen.add(key)
        con.execute("INSERT INTO handoff_moments(memory_id,date,source_path,artifact_type,marker,audiences_json,text,note) VALUES(?,?,?,?,?,?,?,?)",
                    (mid,date,source,typ,marker,js(aud),text,'Explicit transfer/handoff wording. It does not prove the recipient used or accepted the artifact.'))

    # audience map from sharing rows
    amap=collections.defaultdict(list)
    for r in con.execute('SELECT * FROM sharing_trails ORDER BY date'):
        aud=json.loads(r['audiences_json'] or '[]') or ['unspecified']
        for a in aud: amap[(a,r['artifact_type'])].append(r)
    for (a,typ),rs in amap.items():
        dates=sorted(set(r['date'] for r in rs)); sources=[]
        for r in rs:
            if r['source_path'] not in sources:sources.append(r['source_path'])
        con.execute("INSERT INTO audience_map VALUES(?,?,?,?,?,?,?,?)",
                    (a,typ,len(dates),len(rs),dates[0],dates[-1],js(sources[:10]),'Audience co-visible in explicit sharing traces. This does not measure audience size, attention or impact.'))

    # Feedback echoes link to nearest prior artifact of same type within 60d; otherwise remain unpaired.
    art_by_type=collections.defaultdict(list)
    for r in con.execute('SELECT date,source_path,artifact_type FROM artifact_ledger ORDER BY date'):
        art_by_type[r['artifact_type']].append((r['date'],r['source_path']))
    seen=set()
    for date,source,typ,marker,text in feedback:
        key=(date,marker,text)
        if key in seen:continue
        seen.add(key); prior=None
        if typ:
            candidates=[x for x in art_by_type.get(typ,[]) if x[0]<=date and 0<=(d(date)-d(x[0])).days<=60]
            if candidates: prior=max(candidates,key=lambda x:x[0])
        gap=(d(date)-d(prior[0])).days if prior else None
        con.execute("INSERT INTO feedback_echoes(date,source_path,artifact_type,marker,text,prior_artifact_date,prior_source_path,gap_days,note) VALUES(?,?,?,?,?,?,?,?,?)",
                    (date,source,typ,marker,text,prior[0] if prior else None,prior[1] if prior else None,gap,'Explicit feedback-like wording near an artifact trace. Pairing by type/time is a review cue, not proof the feedback refers to that exact artifact.'))
    seen=set()
    for date,source,typ,marker,text in validation:
        key=(date,marker,text)
        if key in seen:continue
        seen.add(key)
        con.execute("INSERT INTO external_validation(date,source_path,artifact_type,marker,text,note) VALUES(?,?,?,?,?,?)",
                    (date,source,typ,marker,text,'Explicit acceptance/recognition/award-like wording. It is a source-linked candidate, not a universal quality score.'))

    # reuse trails: category appears on >=3 dates and has at least one >=30d return gap
    for typ,rs in bytype.items():
        dates=sorted(set(r['date'] for r in rs))
        gaps=[]
        for a,b in zip(dates,dates[1:]):
            gap=(d(b)-d(a)).days
            if gap>=30:gaps.append({'from':a,'to':b,'gap_days':gap})
        if len(dates)>=3 and gaps:
            sources=[]
            for r in rs:
                if r['source_path'] not in sources:sources.append(r['source_path'])
            con.execute("INSERT INTO reuse_trails VALUES(?,?,?,?,?,?,?,?)",
                        (typ,dates[0],dates[-1],(d(dates[-1])-d(dates[0])).days,len(dates),js(sorted(gaps,key=lambda x:-x['gap_days'])[:12]),js(sources[:12]),'Repeated artifact-category traces after long gaps. This may be reuse, revisiting, or simply another artifact of the same type.'))

    # learning -> output: prior 30 days skill activity linked to artifact dates, excluding same-day only templates.
    daily_skills=collections.defaultdict(dict)
    skill_categories={r['name']:r['category'] for r in con.execute('SELECT name,category FROM skill_definitions')}
    for r in con.execute("SELECT m.date,sd.name,SUM(sa.mention_count) mentions FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY m.date,sd.name"):
        if skill_categories.get(r['name'])=='Personal': continue
        daily_skills[r['date']][r['name']]=r['mentions']
    link=collections.defaultdict(list)
    for r in con.execute("SELECT id,date,source_path,artifact_type,action FROM artifact_ledger WHERE action IN ('create','submit','publish') ORDER BY date"):
        od=d(r['date']); candidates=[]
        for i in range(1,31):
            day=(od-datetime.timedelta(days=i)).isoformat()
            for sk,c in daily_skills.get(day,{}).items():
                if c>0:candidates.append((sk,i,day))
        best={}
        for sk,lag,day in candidates:
            if sk not in best or lag<best[sk][0]:best[sk]=(lag,day)
        for sk,(lag,day) in best.items(): link[(sk,r['artifact_type'])].append((r['date'],lag,r['source_path']))
    for (sk,typ),vals in link.items():
        outs=sorted(set(x[0] for x in vals))
        if len(outs)<2: continue
        lags=sorted(x[1] for x in vals); med=lags[len(lags)//2]
        sources=[]
        for _,_,s in vals:
            if s not in sources:sources.append(s)
        con.execute("INSERT INTO learning_output_links VALUES(?,?,?,?,?,?,?,?,?)",
                    (sk,typ,len(outs),len(vals),float(med),outs[0],outs[-1],js(sources[:10]),'Skill evidence appeared in the 30 days before output traces. Temporal proximity is not proof that the skill caused the output.'))

    # artifact lead-ups for strongest output candidates: top skills/topics in previous 14 calendar days.
    daily_topics=collections.defaultdict(dict)
    for r in con.execute("SELECT m.date,tm.topic,SUM(tm.mention_count) mentions FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0 GROUP BY m.date,tm.topic"):
        daily_topics[r['date']][r['topic']]=r['mentions']
    art_select=con.execute("SELECT * FROM artifact_ledger WHERE action IN ('create','submit','publish') ORDER BY confidence DESC,date DESC LIMIT 160").fetchall()
    for ar in art_select:
        od=d(ar['date']); skills=collections.Counter(); topics=collections.Counter(); prior=[]
        for i in range(1,15):
            day=(od-datetime.timedelta(days=i)).isoformat()
            for sk,c in daily_skills.get(day,{}).items():skills[sk]+=c
            for tp,c in daily_topics.get(day,{}).items():topics[tp]+=c
            row=con.execute("SELECT source_path FROM memories WHERE kind='daily' AND date=? AND date_anomaly=0",(day,)).fetchone()
            if row:prior.append(row['source_path'])
        con.execute("INSERT INTO artifact_leadups(artifact_id,date,source_path,artifact_type,action,lead_days,top_skills_json,top_topics_json,prior_source_paths_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (ar['id'],ar['date'],ar['source_path'],ar['artifact_type'],ar['action'],14,
                     js([{'skill':k,'mentions':v} for k,v in skills.most_common(6)]),js([{'topic':k,'mentions':v} for k,v in topics.most_common(6)]),js(prior[:10]),'A 14-day pre-output context window. Co-visible skills/topics are context, not attribution or effort measurement.'))

    # contribution threads
    cg=collections.defaultdict(list)
    for date,source,a,ctx,text in contributions:
        cg[(a,ctx)].append((date,source,text))
    for (a,ctx),vals in cg.items():
        dates=sorted(set(x[0] for x in vals))
        if len(dates)<2:continue
        sources=[]; texts=[]
        for _,s,t in vals:
            if s not in sources:sources.append(s)
            if t not in texts:texts.append(t)
        con.execute("INSERT INTO contribution_threads VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (a,ctx,len(dates),len(vals),dates[0],dates[-1],(d(dates[-1])-d(dates[0])).days,js(sources[:10]),js(texts[:5]),'Repeated explicit helping/sharing/support traces in a work/learning context. This is not an impact or generosity score.'))

    # questions: deterministic prompts from strongest longitudinal signals.
    questions=[]
    for r in con.execute('SELECT * FROM output_trails ORDER BY span_days DESC,recorded_days DESC LIMIT 4'):
        q=f"我围绕 {r['artifact_type']} 的输出方式，在 {r['span_days']} 天里发生了什么变化？"
        reason=f"{r['recorded_days']} 个不同日期留下了输出痕迹（{r['first_date']} → {r['last_date']}）。"
        questions.append((10+r['recorded_days']/10,q,reason,json.loads(r['sample_sources_json'])[:4]))
    for r in con.execute('SELECT * FROM learning_output_links ORDER BY linked_outputs DESC,output_days DESC LIMIT 3'):
        q=f"{r['skill']} 与 {r['artifact_type']} 经常在怎样的前后文里相遇？"
        reason=f"{r['output_days']} 个输出日期在此前 30 天出现过该技能证据。"
        questions.append((8+r['output_days']/10,q,reason,json.loads(r['sample_sources_json'])[:4]))
    for r in con.execute('SELECT * FROM contribution_threads ORDER BY span_days DESC,recorded_days DESC LIMIT 3'):
        q=f"我向“{r['audience']}”输出或分享 {r['context']} 时，通常在什么情境下？"
        reason=f"跨 {r['span_days']} 天出现 {r['recorded_days']} 个不同日期的相关痕迹。"
        questions.append((7+r['recorded_days']/10,q,reason,json.loads(r['sample_sources_json'])[:4]))
    for r in con.execute('SELECT * FROM external_validation ORDER BY date DESC LIMIT 3'):
        q=f"这条外部认可/结果记录前面，档案里真实留下了哪些准备过程？"
        reason=f"{r['date']} 有明确“{r['marker']}”字面记录。"
        questions.append((7.5,q,reason,[r['source_path']]))
    for pr,q,reason,sources in sorted(questions,key=lambda x:-x[0])[:24]:
        con.execute("INSERT INTO legacy_questions(priority,question,reason,source_paths_json,note) VALUES(?,?,?,?,?)",
                    (round(pr,3),q,reason,js(sources),'Question generated from deterministic footprint structure. It contains no pre-generated answer.'))

    counts={
      'artifact_candidates':con.execute('SELECT COUNT(*) FROM artifact_ledger').fetchone()[0],
      'artifact_types':con.execute('SELECT COUNT(*) FROM output_trails').fetchone()[0],
      'sharing_traces':con.execute('SELECT COUNT(*) FROM sharing_trails').fetchone()[0],
      'handoff_moments':con.execute('SELECT COUNT(*) FROM handoff_moments').fetchone()[0],
      'audience_pairs':con.execute('SELECT COUNT(*) FROM audience_map').fetchone()[0],
      'feedback_echoes':con.execute('SELECT COUNT(*) FROM feedback_echoes').fetchone()[0],
      'external_validation':con.execute('SELECT COUNT(*) FROM external_validation').fetchone()[0],
      'reuse_trails':con.execute('SELECT COUNT(*) FROM reuse_trails').fetchone()[0],
      'learning_output_links':con.execute('SELECT COUNT(*) FROM learning_output_links').fetchone()[0],
      'artifact_leadups':con.execute('SELECT COUNT(*) FROM artifact_leadups').fetchone()[0],
      'contribution_threads':con.execute('SELECT COUNT(*) FROM contribution_threads').fetchone()[0],
      'legacy_questions':con.execute('SELECT COUNT(*) FROM legacy_questions').fetchone()[0],
    }
    for k,v in counts.items(): con.execute('INSERT INTO footprint_summary(key,value) VALUES(?,?)',(k,str(v)))
    con.execute('INSERT INTO footprint_summary(key,value) VALUES(?,?)',('version','Memory Engine 9.0 · Footprint Layer'))
    con.commit()
    return counts

if __name__=='__main__':
    import json
    con=sqlite3.connect(ROOT/'data/lifeos.db');con.row_factory=sqlite3.Row
    cfg=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
    print(json.dumps(build_footprint_layer(con,cfg),ensure_ascii=False,indent=2))
    con.close()

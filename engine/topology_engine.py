#!/usr/bin/env python3
from pathlib import Path
import os
import sqlite3, json, collections, math, datetime

ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

def js(x): return json.dumps(x,ensure_ascii=False)
def d(s): return datetime.date.fromisoformat(s)

def ensure_schema(con):
    con.executescript('''
    DROP TABLE IF EXISTS topology_summary;
    DROP TABLE IF EXISTS life_neighborhoods;
    DROP TABLE IF EXISTS topology_nodes;
    DROP TABLE IF EXISTS topology_edges;
    DROP TABLE IF EXISTS gateway_nodes;
    DROP TABLE IF EXISTS bridge_memories_topology;
    DROP TABLE IF EXISTS context_signatures;
    DROP TABLE IF EXISTS transition_matrix;
    DROP TABLE IF EXISTS cooccurrence_surprises;
    DROP TABLE IF EXISTS rare_pairings;
    DROP TABLE IF EXISTS orphan_islands;
    DROP TABLE IF EXISTS anchor_memories_topology;
    DROP TABLE IF EXISTS neighborhood_drift;
    DROP TABLE IF EXISTS context_switches;
    DROP TABLE IF EXISTS life_routes;

    CREATE TABLE topology_summary(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE life_neighborhoods(
      id INTEGER PRIMARY KEY, community_id INTEGER, label TEXT, node_count INTEGER, edge_weight REAL,
      first_date TEXT,last_date TEXT,top_nodes_json TEXT,top_months_json TEXT,note TEXT);
    CREATE TABLE topology_nodes(
      id INTEGER PRIMARY KEY,node_key TEXT UNIQUE,node_kind TEXT,label TEXT,community_id INTEGER,
      evidence_days INTEGER,weighted_degree REAL,gateway_score REAL,first_date TEXT,last_date TEXT,
      sample_sources_json TEXT,note TEXT);
    CREATE TABLE topology_edges(
      id INTEGER PRIMARY KEY,left_key TEXT,right_key TEXT,evidence_days INTEGER,weight REAL,lift REAL,
      first_date TEXT,last_date TEXT,sample_sources_json TEXT,note TEXT);
    CREATE TABLE gateway_nodes(
      id INTEGER PRIMARY KEY,node_key TEXT,label TEXT,node_kind TEXT,community_id INTEGER,
      weighted_degree REAL,cross_weight REAL,gateway_score REAL,neighbor_communities INTEGER,
      sample_neighbors_json TEXT,note TEXT);
    CREATE TABLE bridge_memories_topology(
      id INTEGER PRIMARY KEY,date TEXT,source_path TEXT,node_count INTEGER,community_count INTEGER,
      bridge_score REAL,nodes_json TEXT,communities_json TEXT,note TEXT);
    CREATE TABLE context_signatures(
      id INTEGER PRIMARY KEY,community_id INTEGER,label TEXT,evidence_days INTEGER,
      top_nodes_json TEXT,top_roles_json TEXT,top_places_json TEXT,top_months_json TEXT,note TEXT);
    CREATE TABLE transition_matrix(
      id INTEGER PRIMARY KEY,from_community INTEGER,to_community INTEGER,transition_days INTEGER,
      from_label TEXT,to_label TEXT,probability REAL,sample_dates_json TEXT,note TEXT);
    CREATE TABLE cooccurrence_surprises(
      id INTEGER PRIMARY KEY,left_label TEXT,left_kind TEXT,right_label TEXT,right_kind TEXT,
      evidence_days INTEGER,expected_days REAL,lift REAL,first_date TEXT,last_date TEXT,
      sample_sources_json TEXT,note TEXT);
    CREATE TABLE rare_pairings(
      id INTEGER PRIMARY KEY,left_label TEXT,left_kind TEXT,right_label TEXT,right_kind TEXT,
      evidence_days INTEGER,lift REAL,first_date TEXT,last_date TEXT,sample_sources_json TEXT,note TEXT);
    CREATE TABLE orphan_islands(
      id INTEGER PRIMARY KEY,node_key TEXT,label TEXT,node_kind TEXT,evidence_days INTEGER,
      weighted_degree REAL,community_id INTEGER,source_paths_json TEXT,note TEXT);
    CREATE TABLE anchor_memories_topology(
      id INTEGER PRIMARY KEY,date TEXT,source_path TEXT,node_count INTEGER,community_count INTEGER,
      weighted_degree_sum REAL,anchor_score REAL,top_nodes_json TEXT,note TEXT);
    CREATE TABLE neighborhood_drift(
      id INTEGER PRIMARY KEY,month TEXT,prev_month TEXT,dominant_community INTEGER,dominant_label TEXT,
      dominant_share REAL,drift_score REAL,shares_json TEXT,prev_shares_json TEXT,note TEXT);
    CREATE TABLE context_switches(
      id INTEGER PRIMARY KEY,date TEXT,source_path TEXT,from_community INTEGER,to_community INTEGER,
      from_label TEXT,to_label TEXT,days_since_previous INTEGER,nodes_json TEXT,note TEXT);
    CREATE TABLE life_routes(
      id INTEGER PRIMARY KEY,route_json TEXT,route_labels_json TEXT,length INTEGER,occurrences INTEGER,
      first_start TEXT,last_start TEXT,sample_starts_json TEXT,note TEXT);
    ''')

def daily_nodes(con):
    # day -> {node_key: {kind,label}}
    day=collections.defaultdict(dict); src={}; dates={}
    for r in con.execute("SELECT id,date,source_path FROM memories WHERE kind='daily' AND date_anomaly=0 AND date IS NOT NULL ORDER BY date"):
        src[r['id']]=r['source_path'];dates[r['id']]=r['date']
    for r in con.execute("SELECT sa.memory_id,sd.name FROM skill_activity sa JOIN skill_definitions sd ON sd.id=sa.skill_id JOIN memories m ON m.id=sa.memory_id WHERE m.kind='daily' AND m.date_anomaly=0"):
        if r['name'] in ('Writing','Reflection'): continue
        k='skill:'+r['name'];day[r['memory_id']][k]=('skill',r['name'])
    for r in con.execute("SELECT tm.memory_id,tm.topic FROM topic_mentions tm JOIN memories m ON m.id=tm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0"):
        k='topic:'+r['topic'];day[r['memory_id']][k]=('topic',r['topic'])
    for r in con.execute("SELECT rm.memory_id,rm.role FROM role_mentions rm JOIN memories m ON m.id=rm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0"):
        k='role:'+r['role'];day[r['memory_id']][k]=('role',r['role'])
    for r in con.execute("SELECT pm.memory_id,pm.place FROM place_mentions pm JOIN memories m ON m.id=pm.memory_id WHERE m.kind='daily' AND m.date_anomaly=0"):
        k='place:'+r['place'];day[r['memory_id']][k]=('place',r['place'])
    return day,src,dates

def label_propagation(nodes, edges):
    # Deterministic one-level Louvain-style modularity optimization.
    # We keep the function name for compatibility with the first Topology draft,
    # but unlike naive label propagation this preserves meaningful boundaries in dense graphs.
    adj=collections.defaultdict(dict)
    for (a,b),w in edges.items():
        adj[a][b]=float(w);adj[b][a]=float(w)
    degree={n:sum(adj[n].values()) for n in nodes}
    m2=sum(degree.values())
    if not m2:
        return {n:i+1 for i,n in enumerate(sorted(nodes))},adj
    comm={n:i for i,n in enumerate(sorted(nodes))}
    totals={comm[n]:degree[n] for n in nodes}
    for _ in range(40):
        moved=0
        for n in sorted(nodes,key=lambda x:(-degree[x],x)):
            old=comm[n];ki=degree[n]
            neigh=collections.defaultdict(float)
            for nb,w in adj[n].items():neigh[comm[nb]]+=w
            totals[old]=totals.get(old,0)-ki
            best=old;best_gain=0.0
            # modularity gain up to a positive constant: k_i,in - k_i * Sigma_tot / (2m)
            for c,kin in sorted(neigh.items()):
                gain=kin - ki*totals.get(c,0)/m2
                if gain>best_gain+1e-9:
                    best_gain=gain;best=c
            comm[n]=best;totals[best]=totals.get(best,0)+ki
            if best!=old:moved+=1
        if not moved:break
    groups=collections.defaultdict(list)
    for n,c in comm.items():groups[c].append(n)
    ranked=sorted(groups.values(),key=lambda arr:(-sum(degree[n] for n in arr),sorted(arr)[0]))
    out={}
    for i,arr in enumerate(ranked,1):
        for n in arr:out[n]=i
    return out,adj

def cosine_distance(a,b):
    keys=set(a)|set(b)
    dot=sum(a.get(k,0)*b.get(k,0) for k in keys)
    na=math.sqrt(sum(v*v for v in a.values()));nb=math.sqrt(sum(v*v for v in b.values()))
    if not na or not nb:return 0.0
    return 1-dot/(na*nb)

def build_topology_layer(con,cfg):
    ensure_schema(con)
    day,src,dates=daily_nodes(con)
    valid_days=len(day)
    evidence=collections.defaultdict(list)
    edge_days=collections.defaultdict(list)
    node_meta={}
    for mid,nmap in day.items():
        date=dates[mid];source=src[mid]
        for k,(kind,label) in nmap.items():
            node_meta[k]=(kind,label);evidence[k].append((date,source,mid))
        ks=sorted(nmap)
        for i,a in enumerate(ks):
            for b in ks[i+1:]:edge_days[(a,b)].append((date,source,mid))
    # graph keeps pairs with >=3 dated co-occurrences; weak nodes remain as orphans.
    graph_edges={k:len(v) for k,v in edge_days.items() if len(v)>=3}
    communities,adj=label_propagation(node_meta,graph_edges)
    degree={n:sum(adj[n].values()) for n in node_meta}
    # insert edges with lift
    for (a,b),ev in sorted(graph_edges.items(),key=lambda kv:(-kv[1],kv[0])):
        ea=len(evidence[a]);eb=len(evidence[b]);expected=(ea*eb/valid_days) if valid_days else 0
        lift=ev/expected if expected else 0
        vals=sorted(edge_days[(a,b)]);
        con.execute("INSERT INTO topology_edges(left_key,right_key,evidence_days,weight,lift,first_date,last_date,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?,?)",
                    (a,b,ev,float(ev),round(lift,3),vals[0][0],vals[-1][0],js([x[1] for x in vals[:8]]),'Same-day co-occurrence edge. Weight is dated co-occurrence count; lift compares observed co-occurrence with an independence baseline and is not causality.'))
    # communities
    comm_nodes=collections.defaultdict(list)
    for n,c in communities.items():comm_nodes[c].append(n)
    comm_labels={}
    for c,ns in comm_nodes.items():
        top=sorted(ns,key=lambda n:(-degree[n],-len(evidence[n]),node_meta[n][1]))
        # prioritize topic/skill labels for readability
        named=sorted(top,key=lambda n:((node_meta[n][0] not in ('topic','skill')),-degree[n]))[:3]
        label=' × '.join(node_meta[n][1] for n in named) or f'Neighborhood {c}'
        comm_labels[c]=label
        all_ev=sorted({(x[0],x[1]) for n in ns for x in evidence[n]})
        internal=sum(w for (a,b),w in graph_edges.items() if communities[a]==c and communities[b]==c)
        months=collections.Counter(x[0][:7] for x in all_ev)
        con.execute("INSERT INTO life_neighborhoods(community_id,label,node_count,edge_weight,first_date,last_date,top_nodes_json,top_months_json,note) VALUES(?,?,?,?,?,?,?,?,?)",
                    (c,label,len(ns),float(internal),all_ev[0][0] if all_ev else None,all_ev[-1][0] if all_ev else None,
                     js([{'kind':node_meta[n][0],'label':node_meta[n][1],'degree':degree[n],'evidence_days':len(evidence[n])} for n in top[:10]]),
                     js([{'month':m,'days':v} for m,v in months.most_common(8)]),'A local graph neighborhood produced by weighted label propagation over same-day co-occurrence. It is a navigation cluster, not a latent psychological category.'))
    # node rows + gateways
    for n,(kind,label) in node_meta.items():
        ev=sorted(evidence[n]);cross=0.0;neighbor_comms=set();neighbors=[]
        for nb,w in adj[n].items():
            if communities.get(nb)!=communities.get(n):cross+=w;neighbor_comms.add(communities.get(nb))
            neighbors.append((nb,w))
        gscore=(cross/(degree[n] or 1))*math.log1p(degree[n])
        con.execute("INSERT INTO topology_nodes(node_key,node_kind,label,community_id,evidence_days,weighted_degree,gateway_score,first_date,last_date,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (n,kind,label,communities[n],len(ev),float(degree[n]),round(gscore,3),ev[0][0],ev[-1][0],js([x[1] for x in ev[:8]]),'A tracked skill/topic/role/place node. Graph position reflects dated co-occurrence only.'))
        if cross>0 and len(neighbor_comms)>=1:
            topn=sorted(neighbors,key=lambda x:-x[1])[:8]
            con.execute("INSERT INTO gateway_nodes(node_key,label,node_kind,community_id,weighted_degree,cross_weight,gateway_score,neighbor_communities,sample_neighbors_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (n,label,kind,communities[n],float(degree[n]),float(cross),round(gscore,3),len(neighbor_comms),js([{'label':node_meta[x][1],'kind':node_meta[x][0],'weight':w,'community':communities[x]} for x,w in topn]),'Gateway score highlights nodes whose visible co-occurrence links multiple neighborhoods. It does not mean importance or causal influence.'))
    # per-day community profiles
    day_comms={}; day_dom={}
    for mid,nmap in day.items():
        cc=collections.Counter(communities[k] for k in nmap)
        day_comms[mid]=cc
        if cc:day_dom[mid]=max(cc.items(),key=lambda kv:(kv[1],-kv[0]))[0]
        cs=len(cc);nn=len(nmap)
        if cs>=2:
            score=cs*2+math.log1p(nn)+sum(degree[k] for k in nmap)/max(1,nn*20)
            con.execute("INSERT INTO bridge_memories_topology(date,source_path,node_count,community_count,bridge_score,nodes_json,communities_json,note) VALUES(?,?,?,?,?,?,?,?)",
                        (dates[mid],src[mid],nn,cs,round(score,3),js([{'kind':node_meta[k][0],'label':node_meta[k][1],'community':communities[k]} for k in sorted(nmap)]),js([{'community':c,'label':comm_labels[c],'nodes':v} for c,v in cc.most_common()]),'A date touching more than one graph neighborhood. Bridge score is structural density, not life importance.'))
        # anchor memory uses degree and community span
        degsum=sum(degree[k] for k in nmap)
        ascore=math.log1p(degsum)*(1+0.35*max(0,cs-1))*math.log1p(nn)
        if nn>=3:
            tops=sorted(nmap,key=lambda k:-degree[k])[:10]
            con.execute("INSERT INTO anchor_memories_topology(date,source_path,node_count,community_count,weighted_degree_sum,anchor_score,top_nodes_json,note) VALUES(?,?,?,?,?,?,?,?)",
                        (dates[mid],src[mid],nn,cs,round(degsum,2),round(ascore,3),js([{'label':node_meta[k][1],'kind':node_meta[k][0],'community':communities[k],'degree':degree[k]} for k in tops]),'A structurally central dated source in the co-occurrence graph. Centrality is not subjective importance.'))
    # context signatures per community
    for c,ns in comm_nodes.items():
        mids=set(x[2] for n in ns for x in evidence[n]); roles=collections.Counter();places=collections.Counter();months=collections.Counter()
        for mid in mids:
            months[dates[mid][:7]]+=1
            for k,(kind,label) in day[mid].items():
                if kind=='role':roles[label]+=1
                if kind=='place':places[label]+=1
        top=sorted(ns,key=lambda n:(-degree[n],-len(evidence[n])))[:10]
        con.execute("INSERT INTO context_signatures(community_id,label,evidence_days,top_nodes_json,top_roles_json,top_places_json,top_months_json,note) VALUES(?,?,?,?,?,?,?,?)",
                    (c,comm_labels[c],len(mids),js([{'label':node_meta[n][1],'kind':node_meta[n][0],'days':len(evidence[n])} for n in top]),js([{'role':k,'days':v} for k,v in roles.most_common(8)]),js([{'place':k,'days':v} for k,v in places.most_common(8)]),js([{'month':k,'days':v} for k,v in months.most_common(8)]),'Signature summarizes what is commonly visible inside a graph neighborhood. It is descriptive, not a personality or domain score.'))
    # transitions and switches
    ordered=sorted((dates[mid],mid,day_dom.get(mid)) for mid in day if mid in day_dom)
    trans=collections.defaultdict(list); prev=None
    for date,mid,c in ordered:
        if prev:
            pdate,pmid,pc=prev; gap=(d(date)-d(pdate)).days
            if gap<=7:
                trans[(pc,c)].append((pdate,date,src[pmid],src[mid]))
            if pc!=c and gap<=14:
                con.execute("INSERT INTO context_switches(date,source_path,from_community,to_community,from_label,to_label,days_since_previous,nodes_json,note) VALUES(?,?,?,?,?,?,?,?,?)",
                            (date,src[mid],pc,c,comm_labels[pc],comm_labels[c],gap,js([node_meta[k][1] for k in day[mid]]),'Dominant graph neighborhood changed from the previous recorded day. A switch in writing context is not a switch in identity or real-world priorities.'))
        prev=(date,mid,c)
    fromtot=collections.Counter()
    for (a,b),v in trans.items():fromtot[a]+=len(v)
    for (a,b),vals in sorted(trans.items(),key=lambda kv:-len(kv[1])):
        con.execute("INSERT INTO transition_matrix(from_community,to_community,transition_days,from_label,to_label,probability,sample_dates_json,note) VALUES(?,?,?,?,?,?,?,?)",
                    (a,b,len(vals),comm_labels[a],comm_labels[b],round(len(vals)/fromtot[a],3),js([{'from':x[0],'to':x[1]} for x in vals[:10]]),'Observed transitions between dominant archive neighborhoods on nearby recorded days. Sequence is not causality or prediction.'))
    # surprise and rare pairings based on lift
    pairs=[]
    for (a,b),vals in edge_days.items():
        obs=len(vals);ea=len(evidence[a]);eb=len(evidence[b]);expected=(ea*eb/valid_days) if valid_days else 0
        lift=obs/expected if expected else 0
        pairs.append((lift,obs,a,b,expected,vals))
    for lift,obs,a,b,expected,vals in sorted(pairs,key=lambda x:(-x[0],-x[1])):
        if obs>=3 and lift>=1.7:
            ka,la=node_meta[a];kb,lb=node_meta[b]; vals=sorted(vals)
            con.execute("INSERT INTO cooccurrence_surprises(left_label,left_kind,right_label,right_kind,evidence_days,expected_days,lift,first_date,last_date,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (la,ka,lb,kb,obs,round(expected,2),round(lift,2),vals[0][0],vals[-1][0],js([x[1] for x in vals[:8]]),'Observed same-day co-occurrence exceeds a simple independence baseline. Lift is descriptive and can be inflated by sparse evidence; it is not causality.'))
        if 2<=obs<=4 and lift>=3.0:
            ka,la=node_meta[a];kb,lb=node_meta[b]; vals=sorted(vals)
            con.execute("INSERT INTO rare_pairings(left_label,left_kind,right_label,right_kind,evidence_days,lift,first_date,last_date,sample_sources_json,note) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (la,ka,lb,kb,obs,round(lift,2),vals[0][0],vals[-1][0],js([x[1] for x in vals[:8]]),'A sparse but unusually concentrated pairing. Rare pairings are invitations to reread sources, not evidence of a meaningful relationship.'))
    # orphans
    for n,(kind,label) in node_meta.items():
        if degree[n]<=2 or not adj[n]:
            ev=sorted(evidence[n])
            con.execute("INSERT INTO orphan_islands(node_key,label,node_kind,evidence_days,weighted_degree,community_id,source_paths_json,note) VALUES(?,?,?,?,?,?,?,?)",
                        (n,label,kind,len(ev),float(degree[n]),communities[n],js([x[1] for x in ev[:12]]),'A tracked node with weak graph connectivity. It may be genuinely isolated, under-recorded, or simply described differently elsewhere.'))
    # monthly neighborhood shares + drift
    bymonth=collections.defaultdict(collections.Counter)
    for mid,c in day_dom.items():bymonth[dates[mid][:7]][c]+=1
    prev=None
    for month in sorted(bymonth):
        counts=bymonth[month];tot=sum(counts.values());shares={c:v/tot for c,v in counts.items()}
        dom=max(shares.items(),key=lambda kv:kv[1])[0]
        if prev:
            pmonth,pshares=prev;dr=cosine_distance(shares,pshares)
        else:pmonth=None;pshares={};dr=0.0
        con.execute("INSERT INTO neighborhood_drift(month,prev_month,dominant_community,dominant_label,dominant_share,drift_score,shares_json,prev_shares_json,note) VALUES(?,?,?,?,?,?,?,?,?)",
                    (month,pmonth,dom,comm_labels[dom],round(shares[dom],3),round(dr,3),js([{'community':c,'label':comm_labels[c],'share':round(v,3)} for c,v in sorted(shares.items(),key=lambda kv:-kv[1])]),js([{'community':c,'label':comm_labels[c],'share':round(v,3)} for c,v in sorted(pshares.items(),key=lambda kv:-kv[1])]),'Month-to-month distance between distributions of dominant archive neighborhoods. Drift is a writing-context signal, not identity change.'))
        prev=(month,shares)
    # recurrent routes of 3 consecutive recorded days (gap <=3 each)
    seq=[]
    for date,mid,c in ordered:
        if not seq or (d(date)-d(seq[-1][0])).days<=3:seq.append((date,c))
        else:
            seq.append((date,c))
    routes=collections.defaultdict(list)
    for i in range(len(ordered)-2):
        a,b,c=ordered[i:i+3]
        if (d(b[0])-d(a[0])).days<=3 and (d(c[0])-d(b[0])).days<=3:
            key=(a[2],b[2],c[2]);routes[key].append(a[0])
    for key,starts in sorted(routes.items(),key=lambda kv:(-len(kv[1]),kv[0])):
        if len(starts)<3:continue
        con.execute("INSERT INTO life_routes(route_json,route_labels_json,length,occurrences,first_start,last_start,sample_starts_json,note) VALUES(?,?,?,?,?,?,?,?)",
                    (js(list(key)),js([comm_labels[c] for c in key]),3,len(starts),starts[0],starts[-1],js(starts[:12]),'A recurring three-record sequence of dominant archive neighborhoods. Routes describe repeated writing-context sequences and are not behavioral predictions.'))
    # summary
    vals={
      'neighborhoods':con.execute('SELECT COUNT(*) FROM life_neighborhoods').fetchone()[0],
      'nodes':con.execute('SELECT COUNT(*) FROM topology_nodes').fetchone()[0],
      'edges':con.execute('SELECT COUNT(*) FROM topology_edges').fetchone()[0],
      'gateways':con.execute('SELECT COUNT(*) FROM gateway_nodes').fetchone()[0],
      'bridge_memories':con.execute('SELECT COUNT(*) FROM bridge_memories_topology').fetchone()[0],
      'transitions':con.execute('SELECT COUNT(*) FROM transition_matrix').fetchone()[0],
      'surprise_pairs':con.execute('SELECT COUNT(*) FROM cooccurrence_surprises').fetchone()[0],
      'rare_pairings':con.execute('SELECT COUNT(*) FROM rare_pairings').fetchone()[0],
      'orphans':con.execute('SELECT COUNT(*) FROM orphan_islands').fetchone()[0],
      'anchor_memories':con.execute('SELECT COUNT(*) FROM anchor_memories_topology').fetchone()[0],
      'drift_months':con.execute('SELECT COUNT(*) FROM neighborhood_drift').fetchone()[0],
      'context_switches':con.execute('SELECT COUNT(*) FROM context_switches').fetchone()[0],
      'life_routes':con.execute('SELECT COUNT(*) FROM life_routes').fetchone()[0],
    }
    con.executemany('INSERT INTO topology_summary(key,value) VALUES(?,?)',[(k,str(v)) for k,v in vals.items()])
    return vals

if __name__=='__main__':
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    cfg=json.loads((ROOT/'config/taxonomy.json').read_text(encoding='utf-8'))
    print(json.dumps(build_topology_layer(con,cfg),ensure_ascii=False,indent=2));con.commit();con.close()

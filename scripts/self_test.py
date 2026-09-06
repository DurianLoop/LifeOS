#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json, sys, re, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/lifeos.db'
con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
expected={
 'memories':550,
 'personal_eras':1,'return_events':1,'dormant_threads':1,'idea_genealogies':1,
 'voice_monthly':1,'before_after_windows':1,'skill_topic_bridges':1,'month_portraits':1,
 'archive_health':1,'trajectory_signals':1,
 'growth_rings':1,'novelty_days':1,'bridge_days':1,'attention_portfolio':1,'promise_ledger':1,
 'future_echoes':1,'identity_ledger':1,'motif_atlas':1,'turning_points':1,'thread_reopenings':1,
 'skill_momentum':1,'seasonal_echoes':1,
 'closure_candidates':1,'friction_statements':1,'protocol_statements':1,'protocol_threads':1,
 'boundary_statements':1,'quiet_priorities':1,'idea_survival':1,'milestone_leadups':1,
 'decision_replays':1,'fork_replays':1,'identity_mirror':1,'completion_texture':1,
 'learning_loops':1,'skill_transfer_trails':1,'social_gravity':1,'place_imprints':1,
 'life_neighborhoods':1,'topology_nodes':1,'topology_edges':1,'gateway_nodes':1,
 'bridge_memories_topology':1,'context_signatures':1,'transition_matrix':1,
 'cooccurrence_surprises':1,'rare_pairings':1,'orphan_islands':1,'anchor_memories_topology':1,
 'neighborhood_drift':1,'context_switches':1,'life_routes':1,
 'focus_bursts':1,'visibility_arcs':1,'friction_followthrough':1,'forgotten_doors':1,
 'revision_trails':1,'evidence_gaps':1,'compass_questions':1,'orientation_cards':1,
 'footprint_summary':1,'artifact_ledger':1,'output_trails':1,'sharing_trails':1,'handoff_moments':1,
 'audience_map':1,'feedback_echoes':1,'external_validation':1,'reuse_trails':1,'learning_output_links':1,
 'artifact_leadups':1,'contribution_threads':1,'legacy_questions':1,
 'lineage_summary':1,'thought_artifact_trails':1,'project_artifact_families':1,'artifact_ancestry':1,
 'version_trees':1,'idea_output_latency':1,'lineage_feedback_loops':1,'rework_cycles':1,
 'cross_pollination':1,'first_proofs':1,'unfinished_lineages':1,'release_cadence':1,'evidence_chains':1,
}
errors=[];counts={}
for t,n in expected.items():
    try: got=con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]; counts[t]=got
    except Exception as e: errors.append(f'{t}: {e}'); continue
    if got<n:errors.append(f'{t}: expected >= {n}, got {got}')
meta={r['key']:r['value'] for r in con.execute('select * from meta')}
if meta.get('schema_version')!='10': errors.append('schema_version is not 10')
if not meta.get('engine_version','').startswith('Memory Engine 11.'): errors.append('unexpected engine_version')
raw=con.execute("SELECT COUNT(*) FROM memories WHERE kind IN ('daily','weekly')").fetchone()[0]
if raw<550: errors.append(f'raw memory count dropped below the 550-page baseline: {raw}')
anom=con.execute("SELECT COUNT(*) FROM memories WHERE date_anomaly=1").fetchone()[0]
if anom<1: errors.append('expected known date anomaly flag')
app=(ROOT/'app/index.html').read_text(encoding='utf-8')
new_features=['文言化','Other','Lineage Atlas','Thought → Artifact','Project Families','Artifact Ancestry','Version Trees','Idea-to-Output Latency','Feedback Loops','Rework Cycles','Cross-Pollination','First Proofs','Unfinished Lineages','Release Cadence','Evidence Chain Builder']
for text in new_features:
    if text not in app: errors.append('UI missing '+text)
if '142 systems' not in app: errors.append('UI system count not updated to 142')
feature_block=re.search(r'const FEATURES=\[(.*?)\]\.map\(',app,re.S)
if feature_block:
    names=re.findall(r'\["([^"]+)","[^"]+",',feature_block.group(1))
    if len(names)!=142: errors.append(f'FEATURES expected 142, got {len(names)}')
    baseline=json.loads((ROOT/'config/features_127_baseline.json').read_text(encoding='utf-8'))
    removed=[x for x in baseline if x not in names]
    if removed: errors.append('add-only violation: '+', '.join(removed))
else: errors.append('Could not parse FEATURES registry')
try:
    scripts=re.findall(r'<script>(.*?)</script>',app,re.S)
    if scripts:
        tmp=ROOT/'lifeos_lineage_check.js';tmp.write_text(scripts[-1],encoding='utf-8')
        r=subprocess.run(['node','--check',str(tmp)],capture_output=True,text=True)
        if r.returncode:errors.append('frontend JS syntax: '+r.stderr.strip())
        tmp.unlink(missing_ok=True)
except FileNotFoundError: pass
for rel in ['backend/server.py','engine/rebuild_memory_engine.py','engine/compass_engine.py','engine/mirror_engine.py','engine/topology_engine.py','engine/footprint_engine.py','engine/lineage_engine.py','engine/incremental_index.py','engine/refresh_worker.py','engine/product_core.py','scripts/p0_p1_release_audit.py','scripts/lazy_refresh_e2e_test.py','scripts/add_only_audit.py']:
    r=subprocess.run([sys.executable,'-m','py_compile',str(ROOT/rel)],capture_output=True,text=True)
    if r.returncode: errors.append(rel+' compile: '+r.stderr.strip())
print(json.dumps({'ok':not errors,'errors':errors,'engine':meta.get('engine_version'),'schema':meta.get('schema_version'),'tables_checked':len(expected),'feature_count':len(names) if feature_block else None,'selected_counts':{k:counts.get(k) for k in ['memories','artifact_ledger','thought_artifact_trails','project_artifact_families','artifact_ancestry','version_trees','idea_output_latency','lineage_feedback_loops','rework_cycles','cross_pollination','first_proofs','unfinished_lineages','release_cadence','evidence_chains']}},ensure_ascii=False,indent=2))
con.close();sys.exit(1 if errors else 0)

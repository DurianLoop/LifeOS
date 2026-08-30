#!/usr/bin/env python3
from pathlib import Path
import sqlite3, json
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/lifeos.db'
con=sqlite3.connect(DB); con.row_factory=sqlite3.Row
tables=['memories','sections','event_candidates','idea_candidates','question_candidates','belief_candidates','achievement_candidates','decision_candidates','project_candidates','quote_candidates','skill_activity','topic_mentions','term_monthly','memory_echoes','hidden_chapters','skill_pairs','personal_eras','return_events','dormant_threads','idea_genealogies','voice_monthly','before_after_windows','skill_topic_bridges','month_portraits','archive_health','trajectory_signals']
print('Memory Engine:',DB)
for t in tables:
    print(f'{t:24s}',con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
print('\nTop skills:')
for r in con.execute("""SELECT sd.name,COUNT(DISTINCT CASE WHEN m.kind='daily' AND m.date_anomaly=0 THEN m.id END) days,
                        SUM(CASE WHEN m.kind='daily' AND m.date_anomaly=0 THEN sa.mention_count ELSE 0 END) mentions
                        FROM skill_definitions sd LEFT JOIN skill_activity sa ON sa.skill_id=sd.id
                        LEFT JOIN memories m ON m.id=sa.memory_id GROUP BY sd.id ORDER BY days DESC LIMIT 12"""):
    print(f"{r['name']:28s} {r['days']:4d} days  {r['mentions'] or 0:4d} mentions")
con.close()

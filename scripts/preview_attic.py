"""Run the product UI with synthetic journals for visual acceptance."""
from pathlib import Path
import argparse
import subprocess
import sys
import tempfile

from test_desktop_backend import environment, prepare_workspace

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=8782)
parser.add_argument('--empty',action='store_true')
args=parser.parse_args()

with tempfile.TemporaryDirectory(prefix='lifeos-attic-preview-') as folder:
    workspace=Path(folder)
    prepare_workspace(ROOT,workspace)
    if not args.empty:
        entries={
            '2023-11-04':'那天读完一本关于写作的书，想把阅读中真正留下的几句话整理起来，放在自己的笔记里。',
            '2024-03-18':'阅读完旧笔记，想给写作留下一段完整的时间，先从一个周末开始。',
            '2024-08-17':'旅行的第三天，在陌生街道慢慢走。后来最想念的是那些小店，而不是计划中的目的地。',
            '2026-09-20':'决定把周末上午留给阅读和写作，先试四周，再决定要不要长期继续。',
            '2026-09-28':'今天完成了阅读索引项目，旧笔记终于能重新打开。这个周末写完了第一篇的开头。',
        }
        for month in range(1,10):
            for day in (3,7,12,18):
                entries[f'2026-{month:02}-{day:02}']=f'阅读笔记项目留下了新的问题：怎么让读书留下可复用的内容？今天学习了 Python，用一段程序整理阅读笔记。'
        for day,text in entries.items():
            path=workspace/'vault'/'memories'/'daily'/day[:4]/(day+'.md')
            path.parent.mkdir(parents=True,exist_ok=True)
            quote = '把反复记起的事写下来，时间会慢慢给出它的轮廓。' if day.endswith(('04','20','28')) else ''
            path.write_text(f'# {day}\n\n### 日记\n{text}\n\n### 心得与摘录\n{quote}\n\n### 习惯打卡\n散步\n',encoding='utf-8')
    env={**environment(ROOT,workspace),'LIFEOS_PORT':str(args.port)}
    print(f'Synthetic acceptance preview: http://127.0.0.1:{args.port}/#Attic',flush=True)
    subprocess.run([sys.executable,str(ROOT/'desktop/server_bootstrap.py')],env=env,cwd=workspace)

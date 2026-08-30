from pathlib import Path
exec((Path(__file__).resolve().parents[1]/'engine/rebuild_memory_engine.py').read_text(encoding='utf-8'))

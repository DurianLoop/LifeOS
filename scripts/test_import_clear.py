"""Exercise import staging cleanup against isolated synthetic LifeOS data."""
from __future__ import annotations

from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine import import_pipeline, product_core as pc
from engine import rebuild_memory_engine


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="lifeos-import-clear-") as raw:
        root = Path(raw)
        pc.connect(root).close()
        (root / "data").mkdir(parents=True, exist_ok=True)
        derived = sqlite3.connect(root / "data" / "lifeos.db")
        rebuild_memory_engine.schema(derived)
        rebuild_memory_engine.build_skill_defs(derived)
        rebuild_memory_engine.build_defaults(derived)
        derived.commit()
        derived.close()

        preview = import_pipeline.preview_import(
            [{"name": "2099-01-02.md", "content": "# 预览测试\n\n只用于清除预览。"}],
            root=root,
        )
        job_id = preview["job_id"]
        payload = root / ".lifeos" / "imports" / job_id
        check(payload.exists(), "preview payload should be staged")
        result = import_pipeline.clear_import(job_id, root)
        check(result["restored"] is False, "preview cleanup should not restore")
        check(import_pipeline.get_job(job_id, root) is None, "preview job should be removed")
        check(not payload.exists(), "preview payload should be removed")

        baseline = pc.save_entry(
            journal_date="2099-01-01",
            sections={"日记": "保留的原有日记"},
            root=root,
        )
        committed = import_pipeline.preview_import(
            [{"name": "2099-01-03.md", "content": "# 提交测试\n\n之后要清除。"}],
            root=root,
        )
        committed_id = committed["job_id"]
        import_pipeline.commit_import(committed_id, root=root)
        imported = next(
            (x for x in pc.list_entries(5000, root) if x.get("journal_date") == "2099-01-03"),
            None,
        )
        check(imported is not None, "commit should create the imported entry")
        committed_payload = root / ".lifeos" / "imports" / committed_id
        result = import_pipeline.clear_import(committed_id, root)
        check(result["restored"] is True, "committed cleanup should restore the snapshot")
        check(import_pipeline.get_job(committed_id, root) is None, "committed job should be removed")
        check(not committed_payload.exists(), "committed payload should be removed")
        check(
            any(x.get("entry_id") == baseline["entry_id"] for x in pc.list_entries(5000, root)),
            "pre-existing entries should remain after cleanup",
        )
        check(
            not any(x.get("journal_date") == "2099-01-03" for x in pc.list_entries(5000, root)),
            "imported entries should be restored away",
        )

        sentinel = root / ".lifeos" / "imports" / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        try:
            import_pipeline.clear_import("../keep", root)
        except ValueError:
            pass
        else:
            raise AssertionError("path traversal job ids must be rejected")
        check(sentinel.exists(), "invalid job id must not remove arbitrary files")

    print("import clear checks passed")


if __name__ == "__main__":
    main()

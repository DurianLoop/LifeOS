"""Refresh the public pet metadata snapshot without downloading pet packages."""
from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/legeling/awesome-codex-pet"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "LifeOS-pet-catalog/0.5"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(2_000_001)
    if len(content) > 2_000_000:
        raise ValueError("Pet catalog response exceeded the metadata size limit")
    return content


def main() -> None:
    commit = json.loads(fetch("https://api.github.com/repos/legeling/awesome-codex-pet/commits?path=pets.json&per_page=1"))[0]
    revision = commit["sha"]
    source = f"https://raw.githubusercontent.com/legeling/awesome-codex-pet/{revision}/pets.json"
    content = fetch(source)
    catalog = json.loads(content)
    if not isinstance(catalog, list) or not catalog or not all(isinstance(item, dict) and item.get("slug") for item in catalog):
        raise ValueError("Invalid upstream pet catalog")
    metadata = {
        "repository": REPOSITORY,
        "source_url": source,
        "catalog_commit": revision,
        "catalog_commit_date": commit["commit"]["committer"]["date"],
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "upstream_sha256": hashlib.sha256(content).hexdigest(),
        "upstream_count": len(catalog),
        "sprite_versions": sorted(set(item.get("spriteVersionNumber", 1) for item in catalog)),
        "asset_terms": "Each package retains its own author, source and license; this snapshot contains metadata only. Unknown or unsupported licenses are excluded from installation.",
    }
    for path, value in ((ROOT / "config/pet_catalog_cache.json", catalog), (ROOT / "config/pet_catalog_source.json", metadata)):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        formatted = json.dumps(value, ensure_ascii=False, indent=None if isinstance(value, list) else 2)
        temporary.write_text(formatted, encoding="utf-8")
        temporary.replace(path)
    print(json.dumps({"count": len(catalog), "commit": revision, "sha256": metadata["upstream_sha256"]}))


if __name__ == "__main__":
    main()

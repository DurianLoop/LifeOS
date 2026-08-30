"""Mirror the animated preview images referenced by awesome-codex-pet README.

The upstream README currently uses animated WebP previews (not GIF files).  This
script preserves their source URL and attribution context in a local manifest so
LifeOS can work from a local preview archive while retaining the upstream terms.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
from io import BytesIO
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "app" / "assets" / "pet-readme-previews"
README_URL = "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/README.md"
COVER_URL = "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/assets/cover/awesome-codex-pet-cover.png"
PREVIEW_PATTERN = re.compile(
    r"https://codexpet\.top/assets/previews/([^/]+)/webp/([a-z-]+)\.webp"
)
USER_AGENT = "LifeOS-Pet-Preview-Archive/1.0 (non-commercial local use)"
ACTION_ROWS = {"idle": 0, "running-right": 1, "running-left": 2, "waving": 3, "jumping": 4, "failed": 5, "waiting": 6, "running": 7, "review": 8}


def download(url: str, destination: Path) -> tuple[bool, str | None]:
    if destination.exists() and destination.stat().st_size > 0:
        return False, None
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=40) as response:
                content = response.read()
            if not content:
                raise RuntimeError("empty response")
            temporary = destination.with_suffix(destination.suffix + ".part")
            temporary.write_bytes(content)
            temporary.replace(destination)
            return True, None
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            if attempt == 2:
                return False, str(error)
            time.sleep(0.7 * (attempt + 1))
    return False, "unreachable"


def render_missing_preview(pet_id: str, action: str, destination: Path) -> str:
    """Render an upstream sprite row if its generated README preview is unavailable."""
    row = ACTION_ROWS.get(action)
    if row is None:
        return "error:unknown action row"
    local_source = ROOT / ".codex-pet-preview-source" / "pets" / pet_id / "spritesheet.webp"
    try:
        if local_source.exists():
            sprite = Image.open(local_source).convert("RGBA")
        else:
            sprite_url = f"https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/{pet_id}/spritesheet.webp"
            with urlopen(Request(sprite_url, headers={"User-Agent": USER_AGENT}), timeout=40) as response:
                sprite = Image.open(BytesIO(response.read())).convert("RGBA")
        cell_width, cell_height = sprite.width // 8, sprite.height // (11 if sprite.height // 208 == 11 else 9)
        if row >= sprite.height // cell_height:
            return "error:sprite sheet has no requested row"
        frames: list[Image.Image] = []
        for column in range(8):
            frame = sprite.crop((column * cell_width, row * cell_height, (column + 1) * cell_width, (row + 1) * cell_height))
            pixels = frame.load()
            for y in range(frame.height):
                for x in range(frame.width):
                    red, green, blue, alpha = pixels[x, y]
                    if red > 210 and green < 75 and blue > 210:
                        pixels[x, y] = (red, green, blue, 0)
            frames.append(frame)
        destination.parent.mkdir(parents=True, exist_ok=True)
        frames[0].save(destination, format="WEBP", save_all=True, append_images=frames[1:], duration=150, loop=0, lossless=True, method=6)
        return "locally-rendered-from-upstream-spritesheet"
    except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as error:
        if local_source.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(local_source, destination)
            return "source-spritesheet-fallback"
        return f"error:{error}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--limit", type=int, default=0, help="For a small connectivity test only.")
    args = parser.parse_args()
    previous_manifest_path = DESTINATION / "manifest.json"
    previous: dict = json.loads(previous_manifest_path.read_text(encoding="utf-8")) if previous_manifest_path.exists() else {}
    try:
        readme_request = Request(README_URL, headers={"User-Agent": USER_AGENT})
        with urlopen(readme_request, timeout=40) as response:
            readme = response.read().decode("utf-8")
        pairs = list(dict.fromkeys(PREVIEW_PATTERN.findall(readme)))
        readme_sha256 = hashlib.sha256(readme.encode("utf-8")).hexdigest()
    except (HTTPError, URLError, TimeoutError, OSError):
        stored = [*previous.get("items", []), *previous.get("failures", [])]
        pairs = list(dict.fromkeys((str(item.get("pet_id")), str(item.get("action"))) for item in stored if item.get("pet_id") not in (None, "cover")))
        if not pairs:
            raise
        readme_sha256 = str(previous.get("source_readme_sha256", "unavailable-offline"))
    if args.limit:
        pairs = pairs[: args.limit]
    jobs = [(COVER_URL, DESTINATION / "awesome-codex-pet-cover.png", "cover", "cover")]
    jobs.extend(
        (
            f"https://codexpet.top/assets/previews/{pet_id}/webp/{action}.webp",
            DESTINATION / pet_id / f"{action}.webp",
            pet_id,
            action,
        )
        for pet_id, action in pairs
    )
    manifest: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    downloaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        pending = {}
        for url, path, pet_id, action in jobs:
            local_source = ROOT / ".codex-pet-preview-source" / "pets" / pet_id / "spritesheet.webp"
            if pet_id != "cover" and local_source.exists() and not path.exists():
                item = {"pet_id": pet_id, "action": action, "source_url": url, "local_path": path.relative_to(ROOT).as_posix()}
                fallback = render_missing_preview(pet_id, action, path)
                if fallback.startswith("error:"):
                    failures.append({**item, "error": fallback.removeprefix("error:")})
                else:
                    manifest.append({**item, "preview_origin": fallback})
                continue
            pending[pool.submit(download, url, path)] = (url, path, pet_id, action)
        for future in concurrent.futures.as_completed(pending):
            url, path, pet_id, action = pending[future]
            did_download, error = future.result()
            downloaded += int(did_download)
            item = {
                "pet_id": pet_id,
                "action": action,
                "source_url": url,
                "local_path": path.relative_to(ROOT).as_posix(),
            }
            if error:
                fallback = render_missing_preview(pet_id, action, path) if pet_id != "cover" else f"error:{error}"
                if fallback.startswith("error:"):
                    failures.append({**item, "error": fallback.removeprefix("error:")})
                else:
                    manifest.append({**item, "preview_origin": fallback})
            else:
                manifest.append({**item, "preview_origin": "upstream-generated"})
    DESTINATION.mkdir(parents=True, exist_ok=True)
    (DESTINATION / "manifest.json").write_text(
        json.dumps(
            {
                "source_readme": README_URL,
                "source_readme_sha256": readme_sha256,
                "license_notice": "Upstream code is MIT; pet assets follow the upstream asset terms, commonly CC BY-NC 4.0. Local archive is for the authorized non-commercial LifeOS use case.",
                "preview_format": "animated WebP (the upstream README does not reference GIF files)",
                "items": manifest,
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"requested": len(jobs), "downloaded": downloaded, "available": len(manifest), "failed": len(failures)}))
    return 0 if not failures else 2


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Rebuild the bundled ambience from the credited Blanket audio files.

Requires NumPy and FFmpeg with libvorbis, only at asset-build time. Download the
six source files from the pinned URLs in app/assets/audio/SOURCES.json first.
No code or audio is downloaded by this script or by the application at runtime.
"""
from __future__ import annotations

import argparse
import hashlib
from html import escape
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '9d229d2be7cb6619135d55ff9e49926e40298686'
REPOSITORY = 'https://github.com/rafaelmardojai/blanket'
SAMPLE_RATE = 32000
TRACKS = [
    ('rain', '雨声 · 庭院', 'rain.ogg', 'alex36917', 'Porrumentzio', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://freesound.org/people/alex36917/sounds/524605/'),
    ('fire', '篝火 · 炉边', 'fireplace.ogg', 'ezwa', '', 'Public Domain', 'https://soundbible.com/1543-Fireplace.html', 'https://soundbible.com/1543-Fireplace.html'),
    ('ocean', '海浪 · 潮汐', 'waves.ogg', 'Luftrum', 'Porrumentzio', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://freesound.org/people/Luftrum/sounds/48412/'),
    ('forest', '森林 · 鸟鸣', 'birds.ogg', 'kvgarlic', 'Porrumentzio', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'https://freesound.org/people/kvgarlic/sounds/156826/'),
    ('stream', '溪流 · 林间', 'stream.ogg', 'gluckose', '', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'https://freesound.org/people/gluckose/sounds/333987/'),
    ('night', '夏夜 · 虫鸣', 'summer-night.ogg', 'Lisa Redfern', '', 'Public Domain', 'https://soundbible.com/2083-Crickets-Chirping-At-Night.html', 'https://soundbible.com/2083-Crickets-Chirping-At-Night.html'),
]


def run(ffmpeg, args, data=None):
    return subprocess.run([ffmpeg, '-hide_banner', '-nostdin', *args], input=data,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)


def decode(ffmpeg, path):
    result = run(ffmpeg, ['-i', str(path), '-t', '72', '-ac', '2', '-ar', str(SAMPLE_RATE), '-f', 'f32le', '-'])
    return np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).copy()


def loudness(ffmpeg, data):
    measured = run(ffmpeg, ['-f', 'f32le', '-ar', str(SAMPLE_RATE), '-ac', '2', '-i', '-',
        '-af', 'loudnorm=I=-23:TP=-6:LRA=11:print_format=json', '-f', 'null', '-'], data.tobytes())
    report = measured.stderr.decode('utf-8', errors='replace')
    return json.loads(report[report.rfind('{'):report.rfind('}') + 1])


def write_credits(manifest, output):
    cards = []
    for track in manifest['tracks']:
        editor = f"；上游剪辑：{escape(track['upstream_editor'])}" if track['upstream_editor'] else ''
        cards.append(f'''<article><h2>{escape(track['label'])}</h2>
<p>录音：{escape(track['author'])}{editor}</p>
<p><a href="{escape(track['license_url'])}">{escape(track['license'])}</a>
<span aria-hidden="true"> · </span><a href="{escape(track['original_url'])}">原始录音与作者页面</a>
<span aria-hidden="true"> · </span><a href="{escape(track['source_url'])}">上游音频文件</a></p></article>''')
    page = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>自然录音 · 来源与许可 — LifeOS</title>
<style>body{margin:0;background:#f5f3ed;color:#30352c;font:16px/1.8 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:64px 24px}h1{font-size:32px;letter-spacing:-.03em;line-height:1.3}h2{font-size:20px;margin:0 0 8px}p{margin:8px 0}a{color:#496448;text-underline-offset:4px}article{padding:24px 0;border-bottom:1px solid #d8dace}.eyebrow,footer{color:#66705f;font-size:13px}.intro{margin-bottom:32px}footer{margin-top:32px}@media(max-width:500px){main{padding:36px 20px}h1{font-size:27px}}</style>
</head><body><main><p class="eyebrow">LIFEOS / SOUND CREDITS</p><h1>自然录音，感谢记录它们的人。</h1>
<p class="intro">LifeOS 的环境声音来自真实录音，随应用保存在本机。播放时无需联网；下方的作者与许可链接可用于查阅原始来源。</p>
''' + '\n'.join(cards) + f'''
<footer><p>音频取自 <a href="{REPOSITORY}">Blanket</a> 的环境声音库，依据每段录音本身的许可使用，独立于该项目的代码许可。<a href="{escape(manifest['audio_license_evidence'])}">查看上游音频许可清单</a>。</p>
<p>LifeOS 对选段进行了裁剪、循环交叉淡化、响度调整、瞬态峰值限制与 Ogg Vorbis 转码。原作者没有为 LifeOS 背书。CC BY 4.0 录音保留署名并按原许可提供；CC0 和公有领域录音仍保留来源供查证。</p>
<p>核实日期：2026-10-03。<a href="SOURCES.json">完整来源、固定版本、文件校验值与处理说明</a>。</p></footer>
</main></body></html>'''
    (output / 'ATTRIBUTION.html').write_text(page + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--source-dir', required=True, type=Path)
    args = parser.parse_args()
    output = ROOT / 'app/assets/audio'
    output.mkdir(parents=True, exist_ok=True)
    tracks = []
    for kind, label, original, author, editor, license_name, license_url, original_url in TRACKS:
        source = args.source_dir / original
        samples = decode(args.ffmpeg, source)
        start = 6 * SAMPLE_RATE if len(samples) > 68 * SAMPLE_RATE else 0
        samples = samples[start:start + 62 * SAMPLE_RATE]
        overlap = 2 * SAMPLE_RATE
        phase = np.linspace(0, np.pi / 2, overlap, dtype=np.float32)[:, None]
        # The final sample joins the original sample immediately before the
        # first. Equal-power overlap avoids a silent gap at every loop boundary.
        join = samples[-overlap:] * np.cos(phase) + samples[:overlap] * np.sin(phase)
        samples = np.concatenate([samples[overlap:-overlap], join])
        measured = loudness(args.ffmpeg, samples)
        samples *= 10 ** ((-25 - float(measured['input_i'])) / 20)
        # Smooth isolated crackles without making the whole fireplace inaudible.
        # Filter three periods and retain the middle, so limiter history is also
        # continuous at the circular seam. No runtime processing is necessary.
        periods = np.tile(samples, (3, 1))
        limited = run(args.ffmpeg, ['-f', 'f32le', '-ar', str(SAMPLE_RATE), '-ac', '2', '-i', '-',
            '-af', 'alimiter=limit=0.5:attack=5:release=80:level=false:latency=true',
            '-f', 'f32le', '-'], periods.tobytes())
        limited = np.frombuffer(limited.stdout, dtype='<f4').reshape(-1, 2)
        samples = limited[len(samples):2 * len(samples)].copy()
        destination = output / f'{kind}.ogg'
        run(args.ffmpeg, ['-y', '-f', 'f32le', '-ar', str(SAMPLE_RATE), '-ac', '2', '-i', '-',
            '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '4',
            '-metadata', f'title={label}', '-metadata', f'artist={author}',
            '-metadata', f'copyright={license_name}; {original_url}', str(destination)], samples.tobytes())
        decoded = decode(args.ffmpeg, destination)
        analysis = loudness(args.ffmpeg, decoded)
        block = SAMPLE_RATE // 4
        block_rms = [float(np.sqrt(np.mean(decoded[i:i + block] ** 2))) for i in range(0, len(decoded) - block, block)]
        tracks.append({
            'id': kind, 'label': label, 'file': destination.name, 'author': author,
            'upstream_editor': editor or None, 'license': license_name, 'license_url': license_url,
            'original_url': original_url,
            'source_url': f'https://raw.githubusercontent.com/rafaelmardojai/blanket/{COMMIT}/data/resources/sounds/{original}',
            'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            'bytes': destination.stat().st_size, 'duration_seconds': round(len(decoded) / SAMPLE_RATE, 3),
            'sample_rate': SAMPLE_RATE, 'channels': 2,
            'loudness_lufs': float(analysis['input_i']), 'true_peak_dbtp': float(analysis['input_tp']),
            'minimum_quarter_second_rms': round(min(block_rms), 7),
            'loop_boundary_step': round(float(np.max(np.abs(decoded[0] - decoded[-1]))), 7),
            'changes': 'Selected excerpt; 2-second equal-power circular crossfade; loudness adjustment with gentle transient limiting; 32 kHz stereo Ogg Vorbis quality 4 encoding.',
        })
        print(f"{kind}: {tracks[-1]['duration_seconds']} s, {destination.stat().st_size} bytes, {analysis['input_i']} LUFS")
    manifest = {
        'version': 1, 'verified_on': '2026-10-03', 'upstream_repository': REPOSITORY,
        'upstream_commit': COMMIT,
        'audio_license_evidence': f'{REPOSITORY}/blob/{COMMIT}/SOUNDS_LICENSING.md',
        'note': 'Licenses apply to the recordings themselves, independently of Blanket application code. No endorsement by the original authors is implied.',
        'tracks': tracks,
    }
    (output / 'SOURCES.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    write_credits(manifest, output)


if __name__ == '__main__':
    main()

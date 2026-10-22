"""Create transparent, timed canvas atlases from the attributed DSH originals.

Mobile WebViews do not preserve VP9 alpha consistently. The source WebM files
remain unchanged; generated atlases live only in the mobile resource bundle.
"""
from pathlib import Path
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
SIZE = (320, 180)
FPS = 12


def convert(row, folder, ffmpeg):
    from PIL import Image
    source = ROOT / 'app/assets/pets/dsh-pet' / row['asset']
    destination = folder / row['id']
    destination.mkdir(parents=True, exist_ok=True)
    command = [ffmpeg, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source),
               '-vf', f'fps={FPS},scale={SIZE[0]}:{SIZE[1]}', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']
    count, pages, tile, transparent = 0, [], None, None
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        while True:
            data = process.stdout.read(SIZE[0] * SIZE[1] * 4)
            if not data:
                break
            if len(data) != SIZE[0] * SIZE[1] * 4:
                raise RuntimeError('Incomplete decoded animation frame')
            if count % 64 == 0:
                tile = Image.new('RGBA', (SIZE[0] * 8, SIZE[1] * 8))
            frame = Image.frombytes('RGBA', SIZE, data)
            if count == 0:
                transparent = frame.getchannel('A').histogram()[0]
                if not SIZE[0] * SIZE[1] * 0.1 < transparent < SIZE[0] * SIZE[1]:
                    raise RuntimeError('Source animation alpha was not decoded: ' + row['id'])
            tile.paste(frame, ((count % 8) * SIZE[0], ((count % 64) // 8) * SIZE[1]))
            count += 1
            if count % 64 == 0:
                name = f'page-{len(pages)}.png'
                tile.save(destination / name, format='PNG', compress_level=6)
                pages.append(name)
                tile = None
        error = process.stderr.read().decode('utf-8', 'replace')
        if process.wait() != 0:
            raise RuntimeError(error)
    if tile is not None:
        name = f'page-{len(pages)}.png'
        tile.save(destination / name, format='PNG', compress_level=6)
        pages.append(name)
    if not count:
        raise RuntimeError('Animation has no frames')
    value = {'width': SIZE[0], 'height': SIZE[1], 'columns': 8, 'per_page': 64,
             'fps': FPS, 'frames': count, 'pages': pages, 'first_frame_transparent': transparent,
             'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    (destination / 'animation.json').write_text(json.dumps(value), encoding='utf-8')
    print(row['id'], count, flush=True)


def main():
    import imageio_ffmpeg
    folder = ROOT / 'mobile/src/lifeosmobile/resources/app/assets/pets/dsh-pet/portable'
    manifest = json.loads((ROOT / 'app/assets/pets/dsh-pet/pet.json').read_text(encoding='utf-8'))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda row: convert(row, folder, ffmpeg), manifest['actions']))
    print(json.dumps({'ok': True, 'animations': len(manifest['actions']), 'fps': FPS, 'originals_unchanged': True}))


if __name__ == '__main__':
    main()

"""HTTP surface for private bottles, including seekable binary media."""
import json
import re
from urllib.parse import urlparse
from engine import drift_bottles as bottles, product_core as pc


class BottleAPI:
    def bottle_request(self, path, root, *, post=False, head=False):
        try:
            # Mutations require a same-origin request; uploads never go through JSON/base64.
            if post:
                origin = self.headers.get('Origin')
                if origin and urlparse(origin).netloc != self.headers.get('Host'):
                    raise bottles.BottleError('请求来源无效', 403)
            match = re.fullmatch(r'/api/bottles/([a-zA-Z0-9_-]{8,80})(?:/(media|open|seal|delete|remove-media))?', path)
            if not post:
                if path in ('/api/bottles', '/api/capsules'):
                    return self.send_json(bottles.list_bottles(root))
                if path == '/api/bottles/arrivals':
                    return self.send_json(bottles.arrivals(root))
                if match:
                    bid, action = match.groups()
                    if action == 'media': return self.bottle_media(root, bid, head=head)
                    if action is None: return self.send_json(bottles.detail(root, bid))
            else:
                length = int(self.headers.get('Content-Length', '0'))
                if match and match[2] == 'media':
                    if not 0 < length <= bottles.MAX_MEDIA:
                        self.close_connection = True
                        raise bottles.BottleError('单个文件不超过 100 MB', 413)
                    mime = self.headers.get('Content-Type', '')
                    if mime.split(';')[0].strip() not in bottles.MIMES:
                        self.close_connection = True
                        raise bottles.BottleError('不支持这个录音或视频格式', 415)
                    # Reject a sealed/unknown target before reading a large upload.
                    if bottles.detail(root, match[1])['state'] != 'draft':
                        self.close_connection = True
                        raise bottles.BottleError('已封存，无法替换内容', 409)
                    data = self.rfile.read(length)
                    if len(data) != length: raise bottles.BottleError('上传未完成，请重试')
                    return self.send_json(bottles.upload(root, match[1], data, mime))
                if length < 0 or length > 150000:
                    self.close_connection = True
                    raise bottles.BottleError('请求过大', 413)
                value = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(value, dict): raise bottles.BottleError('请求格式无效')
                if path == '/api/bottles/draft': return self.send_json(bottles.save_draft(root, value))
                if path == '/api/bottles/reminders/ack': return self.send_json(bottles.acknowledge_native(root, value.get('ids')))
                if path == '/api/capsules':
                    import datetime as dt
                    try: unlock = dt.datetime.fromisoformat(value['unlock_date']).astimezone().timestamp()
                    except (KeyError, TypeError, ValueError): raise bottles.BottleError('请选择未来的开启日期')
                    draft = bottles.save_draft(root, {**value, 'unlock_at': unlock})
                    return self.send_json(bottles.seal(root, draft['id'], draft['revision']))
                if match:
                    bid, action = match.groups()
                    if action == 'seal': return self.send_json(bottles.seal(root, bid, value.get('revision')))
                    if action == 'open': return self.send_json(bottles.detail(root, bid, open_bottle=True))
                    if action == 'delete': return self.send_json(bottles.delete(root, bid))
                    if action == 'remove-media': return self.send_json(bottles.remove_media(root, bid))
            return self.send_json({'error': '漂流瓶接口不存在'}, 404)
        except bottles.BottleError as error:
            return self.send_json({'error': str(error)}, error.status)
        except (ValueError, TypeError):
            return self.send_json({'error': '漂流瓶参数无效'}, 400)
        except (BrokenPipeError, ConnectionResetError):
            return None
        except Exception:
            import traceback
            traceback.print_exc()
            return self.send_json({'error': '漂流瓶暂时无法保存，请重试'}, 500)

    def bottle_media(self, root, bid, *, head=False):
        with pc._LOCK:
            path, mime = bottles.media(root, bid)
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            request = self.headers.get('Range')
            if request:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', request)
                if not match or not any(match.groups()):
                    return self.bottle_range_error(size)
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                else:
                    start = max(0, size - int(last))
                if start > end or start >= size:
                    return self.bottle_range_error(size)
                status = 206
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if status == 206: self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if head: return
            with path.open('rb') as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(remaining, 256 * 1024))
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    def bottle_range_error(self, size):
        self.send_response(416)
        self.send_header('Content-Range', f'bytes */{size}')
        self.send_header('Content-Length', '0')
        self.end_headers()

"""Durable, origin-independent UI state, compatible with the desktop workspace."""
from __future__ import annotations
import json
from pathlib import Path
import re
import threading

KEY = re.compile(r'^lifeos[.:][^\x00-\x1f]{1,240}$')


class WorkspaceStorage:
    def __init__(self, root):
        self.path = Path(root) / '.lifeos' / 'ui-state.json'
        self.previous = self.path.with_name(self.path.name + '.previous')
        self.lock = threading.RLock()
        self.state = {'format': 1, 'items': {}, 'migratedOrigins': [], 'removed': {}}
        damaged = False
        for source in (self.path, self.previous):
            if source.exists():
                try:
                    value = json.loads(source.read_text(encoding='utf-8'))
                    if value.get('format') != 1 or not isinstance(value.get('items'), dict):
                        raise ValueError('Invalid workspace UI state')
                    self.validate(value['items'])
                    self.state.update(value)
                    break
                except (ValueError, OSError):
                    damaged = True
                    if source == self.previous:
                        raise RuntimeError('无法读取草稿存储，请从备份恢复')
        else:
            if damaged:
                raise RuntimeError('无法读取草稿存储，请从备份恢复')

    @staticmethod
    def validate(items):
        if any(not isinstance(k, str) or not KEY.fullmatch(k) or not isinstance(v, str)
               or len(v.encode('utf-8')) > 4 * 1024 * 1024 for k, v in items.items()):
            raise ValueError('Invalid UI storage key or value')
        if len(json.dumps(items, ensure_ascii=False).encode('utf-8')) > 32 * 1024 * 1024:
            raise ValueError('UI storage quota exceeded')

    def command(self, command):
        from engine.durable_io import atomic_bytes, atomic_json
        with self.lock:
            op, key = command.get('op'), command.get('key')
            items = dict(self.state['items'])
            removed = dict(self.state.get('removed', {}))
            if op == 'snapshot':
                return items
            if op == 'get':
                return items.get(key)
            if op == 'set':
                items[key] = command.get('value')
                removed.pop(key, None)
            elif op == 'remove':
                if not isinstance(key, str) or not KEY.fullmatch(key):
                    raise ValueError('Invalid UI storage key')
                items.pop(key, None)
                removed[key] = True
            elif op == 'import':
                self.validate(command.get('items', {}))
                for k, v in command.get('items', {}).items():
                    if k not in removed and k not in items:
                        items[k] = v
            else:
                raise ValueError('Unsupported UI storage operation')
            self.validate(items)
            updated = {**self.state, 'items': items, 'removed': removed}
            if self.path.exists():
                atomic_bytes(self.previous, self.path.read_bytes())
            atomic_json(self.path, updated)
            self.state = updated
            return items if op == 'import' else None

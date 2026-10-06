"""Durable unsubmitted attachments; retries use stable attachment identifiers."""
from pathlib import Path
import hashlib, json, mimetypes, re, uuid
from engine.durable_io import atomic_bytes, atomic_json


def stage(root, name, data, mime=None):
    if not data or len(data) > 25_000_000:
        raise ValueError('附件须为 1B 至 25MB')
    identifier = uuid.uuid4().hex
    folder = root / '.lifeos' / 'draft-attachments' / identifier
    record = {'id': identifier, 'name': Path(name).name[:120] or 'attachment',
              'bytes': len(data), 'mime_type': mime or mimetypes.guess_type(name)[0] or 'application/octet-stream',
              'sha256': hashlib.sha256(data).hexdigest()}
    atomic_bytes(folder / 'content', data)
    atomic_json(folder / 'metadata.json', record)
    return record


def read(root, identifier):
    if not re.fullmatch('[a-f0-9]{32}', identifier or ''):
        raise ValueError('附件标识无效')
    folder = root / '.lifeos' / 'draft-attachments' / identifier
    record = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
    data = (folder / 'content').read_bytes()
    if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
        raise ValueError('草稿附件损坏，请重新选择文件')
    return record, data


def commit(root, identifier, entry_id, revision_id=None):
    from engine import product_core as product
    attachment_id = 'att_' + hashlib.sha256((entry_id + ':' + identifier).encode()).hexdigest()[:32]
    existing = product.attachment_record(attachment_id, root)
    if existing:
        return {'attachment_id': attachment_id, 'name': existing['original_name'], 'bytes': existing['bytes']}
    record, data = read(root, identifier)
    return product.add_attachment(entry_id, record['name'], data, record['mime_type'], revision_id, root,
                                  attachment_id=attachment_id)

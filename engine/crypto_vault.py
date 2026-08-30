#!/usr/bin/env python3
"""Optional end-to-end encryption for LifeOS sync payloads.

The cloud only receives an AES-GCM envelope. The 256-bit recovery key is created
locally and stored through the existing secret-store abstraction. Users can
explicitly export/import the recovery key to another trusted device. LifeOS does
not upload that key to the reference cloud service.
"""
from __future__ import annotations
from pathlib import Path
import base64, json, os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from backend.secret_store import get_secret, set_secret, delete_secret
from engine import product_core as pc

ROOT=Path(__file__).resolve().parents[1]
SECRET_NAME='sync.e2ee.recovery_key'


def _root(root): return Path(root or ROOT)

def _b64e(b:bytes)->str: return base64.urlsafe_b64encode(b).decode().rstrip('=')
def _b64d(s:str)->bytes: return base64.urlsafe_b64decode(s + '='*((4-len(s)%4)%4))

def status(root=ROOT):
    root=_root(root); enabled=pc.get_setting('encryption.sync_enabled','false',root)=='true'
    key,source=get_secret(SECRET_NAME,'LIFEOS_RECOVERY_KEY',root)
    return {
      'enabled':enabled,'configured':bool(key),'key_source':source,
      'mode':'e2ee-aes-256-gcm' if enabled else 'transport-only',
      'recovery_key_exported':pc.get_setting('encryption.recovery_exported','false',root)=='true',
      'policy':'When enabled, journal/attachment sync payloads are encrypted before leaving this device. Entry/revision IDs remain visible for conflict routing.'
    }

def create_recovery_key(root=ROOT):
    root=_root(root); key=os.urandom(32); token='LIFEOS-RK1-'+_b64e(key)
    set_secret(SECRET_NAME,token,root)
    pc.set_settings({'encryption.sync_enabled':True,'encryption.recovery_exported':False},root)
    return token

def import_recovery_key(token:str,root=ROOT):
    root=_root(root); token=(token or '').strip()
    if not token.startswith('LIFEOS-RK1-'): raise ValueError('invalid LifeOS recovery key')
    raw=_b64d(token.split('-',2)[2])
    if len(raw)!=32: raise ValueError('invalid recovery key length')
    set_secret(SECRET_NAME,token,root);pc.set_settings({'encryption.sync_enabled':True},root)
    return status(root)

def export_recovery_key(root=ROOT):
    root=_root(root); token,_=get_secret(SECRET_NAME,'LIFEOS_RECOVERY_KEY',root)
    if not token: raise RuntimeError('no recovery key configured')
    pc.set_settings({'encryption.recovery_exported':True},root)
    return token

def disable(root=ROOT,forget_key=False):
    root=_root(root);pc.set_settings({'encryption.sync_enabled':False},root)
    if forget_key: delete_secret(SECRET_NAME,root)
    return status(root)

def _key(root=ROOT)->bytes:
    token,_=get_secret(SECRET_NAME,'LIFEOS_RECOVERY_KEY',_root(root))
    if not token: raise RuntimeError('E2EE is enabled but no recovery key is configured')
    if token.startswith('LIFEOS-RK1-'): return _b64d(token.split('-',2)[2])
    raw=_b64d(token)
    if len(raw)!=32: raise RuntimeError('invalid recovery key')
    return raw

def encrypt_json(payload:dict,aad:dict|None=None,root=ROOT)->dict:
    nonce=os.urandom(12); raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
    aad_raw=json.dumps(aad or {},sort_keys=True,separators=(',',':')).encode()
    ct=AESGCM(_key(root)).encrypt(nonce,raw,aad_raw)
    return {'v':1,'alg':'A256GCM','nonce':_b64e(nonce),'ciphertext':_b64e(ct),'aad':aad or {}}

def decrypt_json(envelope:dict,root=ROOT)->dict:
    if not isinstance(envelope,dict) or envelope.get('alg')!='A256GCM': raise ValueError('unsupported encrypted envelope')
    aad=envelope.get('aad') or {};aad_raw=json.dumps(aad,sort_keys=True,separators=(',',':')).encode()
    raw=AESGCM(_key(root)).decrypt(_b64d(envelope['nonce']),_b64d(envelope['ciphertext']),aad_raw)
    return json.loads(raw.decode())

def maybe_encrypt_operation(op:dict,root=ROOT)->dict:
    if pc.get_setting('encryption.sync_enabled','false',_root(root))!='true': return op
    if 'encrypted_envelope' in (op.get('payload') or {}): return op
    out=dict(op);payload=out.get('payload') or {}
    aad={k:out.get(k) for k in ('operation_id','entry_id','revision_id','base_revision_id','op_type')}
    out['payload']={'encrypted_envelope':encrypt_json(payload,aad,root)}
    return out

def maybe_decrypt_operation(op:dict,root=ROOT)->dict:
    payload=op.get('payload') or {}
    env=payload.get('encrypted_envelope') if isinstance(payload,dict) else None
    if not env: return op
    out=dict(op);out['payload']=decrypt_json(env,root);return out

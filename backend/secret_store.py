#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json, os, stat
ROOT=Path(__file__).resolve().parents[1]
SERVICE='LifeOS'

def _keyring():
    try:
        import keyring
        return keyring
    except Exception:return None

def get_secret(name:str, env_name:str|None=None, root:Path=ROOT):
    if env_name and os.getenv(env_name): return os.getenv(env_name), 'environment'
    kr=_keyring()
    if kr:
        try:
            v=kr.get_password(SERVICE,name)
            if v:return v,'os-keychain'
        except Exception:pass
    p=root/'.lifeos'/'secrets.json'
    if p.exists():
        try:
            v=json.loads(p.read_text(encoding='utf-8')).get(name,'')
            if v:return v,'local-protected-file'
        except Exception:pass
    # Compatibility fallback for existing local .env only. We never write it here.
    if env_name:
        p=root/'.env'
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                if line.strip().startswith(env_name+'='):
                    v=line.split('=',1)[1].strip().strip('"').strip("'")
                    if v:return v,'local-env-file'
    return '', 'not-configured'

def set_secret(name:str,value:str,root:Path=ROOT):
    kr=_keyring()
    if kr:
        try:
            kr.set_password(SERVICE,name,value)
            return {'ok':True,'storage':'os-keychain'}
        except Exception:
            pass
    # Headless Linux/dev fallback. On macOS/Windows installs, requirements.txt
    # enables OS Keychain/Credential Manager via keyring. This file is local-only
    # and chmod 0600 where supported.
    p=root/'.lifeos'/'secrets.json';p.parent.mkdir(parents=True,exist_ok=True)
    try:data=json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}
    except Exception:data={}
    data[name]=value;p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    try:os.chmod(p,0o600)
    except Exception:pass
    return {'ok':True,'storage':'local-protected-file','warning':'Install requirements.txt to use the OS keychain.'}

def delete_secret(name:str,root:Path=ROOT):
    removed=False;kr=_keyring()
    if kr:
        try: kr.delete_password(SERVICE,name);removed=True
        except Exception: pass
    p=Path(root)/'.lifeos'/'secrets.json'
    if p.exists():
        try:
            data=json.loads(p.read_text(encoding='utf-8'))
            if name in data:
                data.pop(name,None);p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');os.chmod(p,0o600);removed=True
        except Exception: pass
    return removed

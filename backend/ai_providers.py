#!/usr/bin/env python3
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import json, os, urllib.request, urllib.error, hashlib, time
from backend.secret_store import get_secret
from engine import product_core as pc
ROOT=Path(os.getenv('LIFEOS_ROOT') or Path(__file__).resolve().parents[1])

@dataclass
class ProviderConfig:
    provider:str
    model:str
    base_url:str
    api_key:str
    key_source:str
    embed_model:str=''

class AIError(RuntimeError): pass

def _setting(name,default=''):
    return pc.get_setting(name,default,ROOT) or default

def config() -> ProviderConfig:
    provider=os.getenv('LIFEOS_AI_PROVIDER') or _setting('ai.provider','deepseek')
    model=os.getenv('LIFEOS_LLM_MODEL') or _setting('ai.model','deepseek-v4-flash')
    base=os.getenv('LIFEOS_LLM_BASE_URL') or _setting('ai.base_url','https://api.deepseek.com')
    env_name={'deepseek':'LIFEOS_LLM_API_KEY','openai':'OPENAI_API_KEY','anthropic':'ANTHROPIC_API_KEY'}.get(provider,'LIFEOS_LLM_API_KEY')
    key,source=get_secret(f'ai.{provider}.api_key',env_name,ROOT)
    embed=os.getenv('LIFEOS_EMBED_MODEL') or _setting('ai.embed_model','')
    return ProviderConfig(provider,model,base.rstrip('/'),key,source,embed)

def privacy_status():
    c=config()
    return {
      'mode':_setting('ai.mode','byok'),
      'enabled':_setting('ai.enabled','true')=='true',
      'allow_remote':_setting('ai.allow_remote','true')=='true',
      'payload_preview':_setting('ai.payload_preview','true')=='true',
      'cache':_setting('ai.cache','true')=='true',
      'provider':c.provider,'model':c.model,'base_url':c.base_url,
      'configured':bool(c.api_key),'key_source':c.key_source,'embed_model':c.embed_model,
      'policy':'Only the explicitly selected evidence/input for the current action is sent. The raw Vault is never bulk-uploaded by default.'
    }

def remote_allowed():
    s=privacy_status(); return s['enabled'] and s['allow_remote'] and s['configured']

def _json_request(url,payload,headers,timeout=90):
    req=urllib.request.Request(url,data=json.dumps(payload,ensure_ascii=False).encode('utf-8'),headers=headers,method='POST')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as resp:return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body=e.read().decode('utf-8',errors='replace')[:2000];raise AIError(f'HTTP {e.code}: {body}')
    except Exception as e: raise AIError(str(e))

def chat(messages,temperature=.2,max_tokens=None,feature='generic',use_cache=True):
    status=privacy_status();c=config()
    normalized={'provider':c.provider,'model':c.model,'base_url':c.base_url,'messages':messages,'temperature':temperature,'max_tokens':max_tokens}
    raw=json.dumps(normalized,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    ih=hashlib.sha256(raw.encode('utf-8')).hexdigest();input_chars=sum(len(str(m.get('content') or '')) for m in messages)
    cache_enabled=_setting('ai.cache','true')=='true' and use_cache
    if cache_enabled:
        hit=pc.get_ai_cache(ih,ROOT)
        if hit:
            resp=hit['response'];pc.log_ai_request(feature_id=feature,provider=c.provider,model=c.model,input_hash=ih,input_chars=input_chars,output_chars=len(str(resp.get('text') or '')),prompt_tokens=resp.get('usage',{}).get('prompt_tokens'),completion_tokens=resp.get('usage',{}).get('completion_tokens'),cache_hit=True,sent_remote=False,elapsed_ms=0,root=ROOT)
            return {**resp,'cache_hit':True}
    if not (status['enabled'] and status['allow_remote'] and status['configured']): return None
    started=time.perf_counter();data=None
    try:
        if c.provider=='anthropic':
            system='\n\n'.join(m['content'] for m in messages if m.get('role')=='system')
            amsg=[{'role':m['role'],'content':m['content']} for m in messages if m.get('role') in ('user','assistant')]
            payload={'model':c.model,'messages':amsg,'temperature':temperature,'max_tokens':max_tokens or 4096}
            if system:payload['system']=system
            data=_json_request(c.base_url+'/v1/messages',payload,{'x-api-key':c.api_key,'anthropic-version':'2023-06-01','content-type':'application/json'})
            text=''.join(x.get('text','') for x in data.get('content',[]) if x.get('type')=='text')
            u=data.get('usage') or {};usage={'prompt_tokens':u.get('input_tokens'),'completion_tokens':u.get('output_tokens')}
        else:
            payload={'model':c.model,'messages':messages,'temperature':temperature}
            if max_tokens:payload['max_tokens']=max_tokens
            base=c.base_url
            url=base+'/chat/completions' if base.endswith('/v1') or c.provider in ('deepseek','custom','local') else base+'/v1/chat/completions'
            if c.provider=='deepseek' and not base.endswith('/v1'): url=base+'/chat/completions'
            data=_json_request(url,payload,{'Authorization':'Bearer '+c.api_key,'Content-Type':'application/json'})
            text=data['choices'][0]['message']['content'];u=data.get('usage') or {};usage={'prompt_tokens':u.get('prompt_tokens'),'completion_tokens':u.get('completion_tokens')}
        elapsed=round((time.perf_counter()-started)*1000);resp={'text':text,'provider':c.provider,'model':c.model,'base_url':c.base_url,'usage':usage,'cache_hit':False}
        if cache_enabled:pc.put_ai_cache(ih,c.provider,c.model,resp,ROOT)
        pc.log_ai_request(feature_id=feature,provider=c.provider,model=c.model,input_hash=ih,input_chars=input_chars,output_chars=len(text),prompt_tokens=usage.get('prompt_tokens'),completion_tokens=usage.get('completion_tokens'),cache_hit=False,sent_remote=True,elapsed_ms=elapsed,root=ROOT)
        return resp
    except Exception as e:
        pc.log_ai_request(feature_id=feature,provider=c.provider,model=c.model,input_hash=ih,input_chars=input_chars,cache_hit=False,sent_remote=True,elapsed_ms=round((time.perf_counter()-started)*1000),error=str(e),root=ROOT)
        raise

def embeddings(texts:list[str]):
    if not remote_allowed(): return None
    c=config()
    if not c.embed_model: return None
    if c.provider=='anthropic': return None
    base=c.base_url
    url=base+'/embeddings' if base.endswith('/v1') else base+'/v1/embeddings'
    data=_json_request(url,{'model':c.embed_model,'input':texts},{'Authorization':'Bearer '+c.api_key,'Content-Type':'application/json'})
    vecs=[x['embedding'] for x in sorted(data.get('data',[]),key=lambda x:x.get('index',0))]
    return {'vectors':vecs,'provider':c.provider,'model':c.embed_model}

def payload_preview(items):
    # No content duplication is needed because Ask already renders the exact evidence.
    return {
        'items': len(items),
        'characters': sum(len(str(x.get('excerpt') or x.get('content') or '')) for x in items),
        'sources': sorted(set(str(x.get('source_path') or x.get('source_name') or '') for x in items if x.get('source_path') or x.get('source_name')))
    }

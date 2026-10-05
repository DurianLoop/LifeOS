from __future__ import annotations
from dataclasses import dataclass, field, asdict
from pathlib import Path
import datetime as dt, hashlib, html, json, re

@dataclass
class EntryDraft:
    source_name:str
    source_format:str
    journal_date:str|None
    content:str
    title:str=''
    tags:list[str]=field(default_factory=list)
    timezone:str=''
    original_metadata:dict=field(default_factory=dict)
    confidence:str='high'
    note:str=''
    kind:str='daily'
    week_year:int|None=None
    week:int|None=None
    def asdict(self): return asdict(self)

class Importer:
    name='base'; extensions=()
    def supports(self,name,mime=''): return Path(name).suffix.lower() in self.extensions
    def parse(self,name,content,meta=None): raise NotImplementedError

def guess_date(name:str,text:str='',metadata=None):
    metadata=metadata or {}
    for key in ('journal_date','date','creationDate','created_at','createdAt','creation_date'):
        v=metadata.get(key)
        if not v: continue
        m=re.search(r'(20\d{2})[-/](\d{1,2})[-/](\d{1,2})',str(v))
        if m:
            try:return dt.date(int(m.group(1)),int(m.group(2)),int(m.group(3))).isoformat()
            except ValueError:continue
        try:
            s=str(v).replace('Z','+00:00'); return dt.datetime.fromisoformat(s).date().isoformat()
        except Exception: pass
    for hay in (Path(name).stem,text[:1200]):
        m=re.search(r'(20\d{2})[-_.年/](\d{1,2})[-_.月/](\d{1,2})',hay)
        if m:
            try:return dt.date(int(m.group(1)),int(m.group(2)),int(m.group(3))).isoformat()
            except ValueError: pass
    return None

def guess_week(name:str,metadata=None):
    """Recognize archive week numbers without inventing an ISO calendar date.

    Older journals use calendar-year weeks, including week 53 in 2025.
    Their existing year/week identity must remain intact.
    """
    metadata=metadata or {}
    for candidate in (metadata.get('source_path') or '',name):
        stem=Path(str(candidate).replace('\\','/')).stem
        if re.match(r'^20\d{2}[-_.]\d{1,2}[-_.]\d{1,2}(?:$|\D)',stem):
            continue
        match=re.match(r'^(20\d{2})[_-](?:[Ww])?(\d{1,2})(?:$|[ -])',stem)
        if match and 1<=int(match[2])<=53:
            return int(match[1]),int(match[2])
    return None

def strip_html(raw:str):
    raw=re.sub(r'(?is)<(script|style).*?>.*?</\1>',' ',raw)
    raw=re.sub(r'(?i)<br\s*/?>','\n',raw);raw=re.sub(r'(?i)</p\s*>','\n\n',raw);raw=re.sub(r'(?i)</h[1-6]\s*>','\n\n',raw)
    raw=re.sub(r'(?s)<[^>]+>',' ',raw);raw=html.unescape(raw)
    raw=re.sub(r'[ \t]+',' ',raw);raw=re.sub(r'\n\s+','\n',raw);raw=re.sub(r'\n{3,}','\n\n',raw)
    return raw.strip()

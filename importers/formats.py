from __future__ import annotations
import csv, io, json
from .base import Importer,EntryDraft,guess_date,strip_html

class MarkdownImporter(Importer):
    name='markdown';extensions=('.md','.markdown')
    def parse(self,name,content,meta=None): return [EntryDraft(name,'markdown',guess_date(name,content,meta),content,original_metadata=meta or {})]

class TextImporter(Importer):
    name='text';extensions=('.txt',)
    def parse(self,name,content,meta=None): return [EntryDraft(name,'text',guess_date(name,content,meta),content,original_metadata=meta or {})]

class HTMLImporter(Importer):
    name='html';extensions=('.html','.htm')
    def parse(self,name,content,meta=None):
        text=strip_html(content);return [EntryDraft(name,'html',guess_date(name,text,meta),text,original_metadata=meta or {})]

class JSONImporter(Importer):
    name='json';extensions=('.json',)
    def parse(self,name,content,meta=None):
        data=json.loads(content); out=[]
        # Day One export: {entries:[{text,creationDate,tags,...}]}
        items=data.get('entries') if isinstance(data,dict) and isinstance(data.get('entries'),list) else data
        if isinstance(items,dict): items=[items]
        if not isinstance(items,list): raise ValueError('JSON must contain an entry object, list, or Day One entries[]')
        for i,x in enumerate(items):
            if not isinstance(x,dict): continue
            text=x.get('text') or x.get('content') or x.get('body') or x.get('journal') or ''
            if not isinstance(text,str): text=json.dumps(text,ensure_ascii=False,indent=2)
            date=guess_date(f'{name}#{i+1}',text,x); title=str(x.get('title') or '')
            tags=x.get('tags') or []
            if isinstance(tags,str): tags=[t.strip() for t in tags.split(',') if t.strip()]
            fmt='dayone-json' if 'creationDate' in x or ('entries' in data if isinstance(data,dict) else False) else 'json'
            out.append(EntryDraft(f'{name}#{i+1}',fmt,date,text,title,tags if isinstance(tags,list) else [],str(x.get('timeZone') or x.get('timezone') or ''),x,'high' if date else 'low'))
        return out

class CSVImporter(Importer):
    name='csv';extensions=('.csv',)
    def parse(self,name,content,meta=None):
        sample=content[:4096]
        try: dialect=csv.Sniffer().sniff(sample)
        except Exception: dialect=csv.excel
        reader=csv.DictReader(io.StringIO(content),dialect=dialect);out=[]
        for i,row in enumerate(reader):
            lower={str(k).lower():v for k,v in row.items()}
            text=next((lower[k] for k in ('content','text','body','journal','entry','日记','正文') if lower.get(k)), '')
            title=next((lower[k] for k in ('title','标题') if lower.get(k)), '')
            dateval=next((lower[k] for k in ('date','journal_date','created_at','created','日期') if lower.get(k)), '')
            tags=next((lower[k] for k in ('tags','tag','标签') if lower.get(k)), '')
            date=guess_date(f'{name}#{i+1}',text,{'date':dateval})
            out.append(EntryDraft(f'{name}#{i+1}','csv',date,text,title,[x.strip() for x in str(tags).split(',') if x.strip()],original_metadata=row,confidence='high' if date else 'low'))
        return out

IMPORTERS=[MarkdownImporter(),TextImporter(),HTMLImporter(),JSONImporter(),CSVImporter()]

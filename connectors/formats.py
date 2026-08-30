from __future__ import annotations
import json,re
from connectors.base import Connector,InboxDraft

class GenericJSONConnector(Connector):
    id='generic-json';name='Generic JSON'
    def ingest(self,payload):
        data=json.loads(payload) if isinstance(payload,str) else payload
        rows=data if isinstance(data,list) else data.get('items',[data])
        for x in rows:
            if not isinstance(x,dict):continue
            yield InboxDraft(item_type=x.get('type','text'),title=str(x.get('title') or ''),body=str(x.get('body') or x.get('text') or ''),source=x.get('source') or self.id,source_ref=str(x.get('id') or x.get('url') or ''),metadata={k:v for k,v in x.items() if k not in ('body','text')})

class ICSConnector(Connector):
    id='calendar-ics';name='Calendar ICS'
    def ingest(self,payload):
        text=payload.decode() if isinstance(payload,bytes) else str(payload)
        for block in re.findall(r'BEGIN:VEVENT\s*(.*?)\s*END:VEVENT',text,re.S|re.I):
            props={}
            for line in re.sub(r'\r?\n[ \t]','',block).splitlines():
                if ':' in line:
                    k,v=line.split(':',1);props[k.split(';',1)[0].upper()]=v
            title=props.get('SUMMARY','Calendar event');date=(props.get('DTSTART') or '')[:8]
            iso=f'{date[:4]}-{date[4:6]}-{date[6:8]}' if len(date)>=8 and date.isdigit() else None
            body='\n'.join(x for x in [props.get('DESCRIPTION',''),('Location: '+props['LOCATION']) if props.get('LOCATION') else ''] if x)
            yield InboxDraft('calendar',title,body,self.id,props.get('UID',''),metadata={'journal_date':iso,'dtstart':props.get('DTSTART'),'dtend':props.get('DTEND')})

CONNECTORS={x.id:x for x in (GenericJSONConnector(),ICSConnector())}

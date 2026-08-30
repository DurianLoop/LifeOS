from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Iterable

@dataclass
class InboxDraft:
    item_type:str='text'; title:str=''; body:str=''; source:str='connector'; source_ref:str=''; attachments:list[str]=field(default_factory=list); metadata:dict[str,Any]=field(default_factory=dict)

class Connector:
    id='base'; name='Base Connector'
    def ingest(self,payload:Any)->Iterable[InboxDraft]: raise NotImplementedError

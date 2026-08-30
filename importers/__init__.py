from .base import EntryDraft
from .formats import IMPORTERS
from pathlib import Path

def choose_importer(name,mime=''):
    for imp in IMPORTERS:
        if imp.supports(name,mime): return imp
    return None

def parse_file(name,content,mime='',meta=None):
    imp=choose_importer(name,mime)
    if not imp: raise ValueError(f'unsupported import format: {Path(name).suffix or mime or name}')
    return imp.name,imp.parse(name,content,meta)

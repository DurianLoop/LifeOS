"""Exercise unlock boundaries, binary privacy, durability and reminders."""
from pathlib import Path
import contextlib
import datetime as dt
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import drift_bottles as b, product_core as pc, p2_core, durable_io
from backend.bottles import BottleAPI


class Bottles(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='lifeos-bottles-')
        self.root=Path(self.tmp.name)
        pc.connect(self.root).close()
        self.clock=patch.object(b,'now',return_value=1000000000.0)
        self.clock.start()
    def tearDown(self):
        self.clock.stop();self.tmp.cleanup()
    def draft(self,kind='text',body='写给未来的一句话'):
        return b.save_draft(self.root,{'title':'重逢','kind':kind,'body':body,'unlock_at':1000000100.0})
    def seal(self,d): return b.seal(self.root,d['id'],d['revision'])
    def test_server_enforces_unlock_in_all_reads(self):
        d=self.draft();self.seal(d)
        for route in (lambda:b.detail(self.root,d['id']),lambda:b.detail(self.root,d['id'],open_bottle=True),lambda:b.media(self.root,d['id'])):
            with self.assertRaises(b.BottleError) as ctx:route()
            self.assertEqual(ctx.exception.status,423)
        self.assertNotIn('body',b.list_bottles(self.root)['items'][0])
        with patch.object(b,'now',return_value=1000000099.999):
            with self.assertRaises(b.BottleError):b.detail(self.root,d['id'],open_bottle=True)
        with patch.object(b,'now',return_value=1000000100.0):
            arrived=b.detail(self.root,d['id']);self.assertEqual(arrived['state'],'arrived');self.assertNotIn('body',arrived)
            opened=b.detail(self.root,d['id'],open_bottle=True);self.assertEqual(opened['body'],d['body'])
        with self.assertRaises(b.BottleError):b.detail(self.root,d['id'])
    def test_immutable_and_idempotent_seal(self):
        d=self.draft();one=self.seal(d);two=self.seal(d);self.assertEqual(one,two)
        with self.assertRaises(b.BottleError):b.save_draft(self.root,{**d,'body':'overwrite'})
        with self.assertRaises(b.BottleError):b.remove_media(self.root,d['id'])
    def test_concurrent_draft_cannot_overwrite_newer_revision(self):
        d=self.draft();updated=b.save_draft(self.root,{**d,'body':'newer'})
        with self.assertRaises(b.BottleError):b.save_draft(self.root,{**d,'body':'older'})
        self.assertEqual(b.detail(self.root,d['id'])['body'],'newer')
        with self.assertRaises(b.BottleError):self.seal(d)
        self.seal(updated)
    def test_validation(self):
        for extra in ({'kind':'script'},{'theme':'unknown'},{'body':'x'*20001},{'unlock_at':float('nan')},{'id':'../../escape'}):
            with self.assertRaises(b.BottleError):b.save_draft(self.root,{'body':'a',**extra})
        d=b.save_draft(self.root,{'body':'a','unlock_at':999999999})
        with self.assertRaises(b.BottleError):self.seal(d)
        d=self.draft('video')
        with self.assertRaises(b.BottleError):self.seal(d)
    def test_media_private_before_open_and_format_validation(self):
        d=self.draft('audio','');raw=b'RIFF'+(48).to_bytes(4,'little')+b'WAVE'+b'\0'*48
        for mime,data in [('text/html',b'<script>'),('audio/wav',b'<script>'),('video/webm',b'\x1aE\xdf\xa3x')]:
            with self.assertRaises(b.BottleError):b.upload(self.root,d['id'],data,mime)
        d=b.upload(self.root,d['id'],raw,'audio/wav');self.assertEqual(b.media(self.root,d['id'])[0].read_bytes(),raw);self.seal(d)
        with self.assertRaises(b.BottleError):b.media(self.root,d['id'])
        with patch.object(b,'now',return_value=1000000100):
            with self.assertRaises(b.BottleError):b.media(self.root,d['id'])
            b.detail(self.root,d['id'],open_bottle=True);self.assertEqual(b.media(self.root,d['id'])[0].read_bytes(),raw)
    def test_failed_upload_retains_previous_media(self):
        d=self.draft('video');raw=b'\x1aE\xdf\xa3original'
        d=b.upload(self.root,d['id'],raw,'video/webm');before=b.media(self.root,d['id'])[0]
        with patch.object(durable_io,'atomic_bytes',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):b.upload(self.root,d['id'],b'\x1aE\xdf\xa3replacement','video/webm')
        self.assertEqual(before.read_bytes(),raw);self.assertEqual(b.media(self.root,d['id'])[0],before)
    def test_missing_or_corrupt_media_cannot_seal(self):
        d=b.upload(self.root,self.draft('video')['id'],b'\x1aE\xdf\xa3original','video/webm');path=b.media(self.root,d['id'])[0];path.write_bytes(b'corrupt')
        with self.assertRaises(b.BottleError):self.seal(d)
    def test_backup_restore_includes_sealed_media_and_drafts(self):
        pc.set_settings({'backup.auto_before_restore':False},self.root)
        text=self.draft();video=b.upload(self.root,self.draft('video')['id'],b'\x1aE\xdf\xa3media','video/webm');self.seal(video)
        backup=pc.create_backup('bottle test',self.root);b.delete(self.root,video['id']);b.delete(self.root,text['id'])
        pc.restore_backup(backup['backup_id'],self.root,defer=True);durable_io.recover_restore(self.root)
        self.assertEqual(len(b.list_bottles(self.root)['items']),2);self.assertEqual(b.detail(self.root,text['id'])['body'],text['body'])
        with patch.object(b,'now',return_value=1000000100):
            b.detail(self.root,video['id'],open_bottle=True);self.assertEqual(b.media(self.root,video['id'])[0].read_bytes(),b'\x1aE\xdf\xa3media')
    def test_due_reminder_dedup_and_reopen(self):
        d=self.draft();self.seal(d);self.assertEqual(b.arrivals(self.root)['items'],[])
        with patch.object(b,'now',return_value=1000000100):
            for _ in range(3):self.assertEqual(b.arrivals(self.root)['native_pending'],[d['id']])
            notes=p2_core.list_notifications(root=self.root);self.assertEqual(len(notes),1)
            b.acknowledge_native(self.root,[d['id']]);self.assertEqual(b.arrivals(self.root)['native_pending'],[])
            self.assertEqual(len(b.arrivals(self.root)['items']),1)
            b.detail(self.root,d['id'],open_bottle=True);self.assertEqual(b.arrivals(self.root)['items'],[])
            self.assertEqual(p2_core.list_notifications(root=self.root)[0]['status'],'read')
    def test_disabled_reminders_retain_arrivals(self):
        d=self.draft();self.seal(d);p2_core.set_notification_preferences(enabled=False,root=self.root)
        with patch.object(b,'now',return_value=1000000100):
            self.assertFalse(b.arrivals(self.root)['notify']);self.assertEqual(b.arrivals(self.root)['native_pending'],[]);self.assertEqual(len(b.arrivals(self.root)['items']),1)
    def test_legacy_migrates_once_and_deleted_stays_deleted(self):
        path=self.root/'data/lifeos.db';path.parent.mkdir();con=sqlite3.connect(path)
        con.execute('CREATE TABLE capsules(id INTEGER,title TEXT,body TEXT,unlock_date TEXT,status TEXT)')
        con.execute('INSERT INTO capsules VALUES(1,?,?,?,?)',('legacy','old private text','2099-01-01','locked'));con.commit();con.close()
        self.assertEqual(b.migrate_legacy(self.root),1);self.assertEqual(b.migrate_legacy(self.root),0)
        bid=b.list_bottles(self.root)['items'][0]['id'];b.delete(self.root,bid);self.assertEqual(b.list_bottles(self.root)['items'],[])
    def test_delete_removes_binary_and_arrival(self):
        d=b.upload(self.root,self.draft('audio')['id'],b'\x1aE\xdf\xa3audio','audio/webm');path=b.media(self.root,d['id'])[0];self.seal(d)
        with patch.object(b,'now',return_value=1000000100):
            b.arrivals(self.root);b.delete(self.root,d['id']);self.assertEqual(b.arrivals(self.root)['items'],[])
        self.assertFalse(path.exists())
    def test_http_ranges_origin_and_locked_media(self):
        root=self.root
        class Handler(BottleAPI,BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def send_json(self,value,status=200):
                raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_GET(self):self.bottle_request(self.path,root)
            def do_POST(self):self.bottle_request(self.path,root,post=True)
            def do_HEAD(self):self.bottle_request(self.path,root,head=True)
        d=b.upload(root,self.draft('video')['id'],b'\x1aE\xdf\xa3'+bytes(range(100)),'video/webm');url='/api/bottles/'+d['id']+'/media'
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
        def get(path,headers=None,method='GET',data=None):
            try:r=urllib.request.urlopen(urllib.request.Request(base+path,headers=headers or {},method=method,data=data));return r.status,dict(r.headers),r.read()
            except urllib.error.HTTPError as error:return error.code,dict(error.headers),error.read()
        try:
            status,headers,data=get(url,{'Range':'bytes=4-13'});self.assertEqual(status,206);self.assertEqual(data,bytes(range(10)));self.assertEqual(headers['Content-Range'],'bytes 4-13/104')
            self.assertEqual(get(url,{'Range':'bytes=-3'})[2],bytes([97,98,99]));self.assertEqual(get(url,{'Range':'bytes=999-'})[0],416)
            self.assertEqual(get(url,{'Range':'bytes=-0'})[0],416);self.assertEqual(get(url,{'Range':'bytes=1-2,4-5'})[0],416)
            self.assertEqual(get(url,method='HEAD')[2],b'');self.seal(d);self.assertEqual(get(url)[0],423)
            self.assertEqual(get('/api/bottles/draft',{'Origin':'https://untrusted.example','Content-Type':'application/json'},'POST',b'{}')[0],403)
            self.assertNotIn(b'body',get('/api/capsules')[2])
        finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main(verbosity=2)

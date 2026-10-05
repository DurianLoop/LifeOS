"""Synthetic public-AI response, citation, allowance and error regressions."""
import io
import json
import os
import sqlite3
import unittest
from unittest.mock import Mock, patch
from cloud import memorial, p2_services


class CloudAITests(unittest.TestCase):
    def setUp(self):
        self.c=sqlite3.connect(':memory:');self.c.row_factory=sqlite3.Row
        self.c.execute('CREATE TABLE users(user_id TEXT PRIMARY KEY)')
        self.c.execute("INSERT INTO users VALUES('fixture')");self.c.commit()
        p2_services.ensure_schema(self.c)
        self.c.execute("UPDATE subscriptions SET plan='plus' WHERE user_id='fixture'");self.c.commit()
        self.payload={'title':'Synthetic archive','introduction':'Synthetic only','ai_enabled':True,'story_ids':[],
                      'entries':[{'entry_id':'one','date':'2030-01-01','title':'产品','content':'产品设计记录。'},
                                 {'entry_id':'two','date':'2030-02-02','title':'产品','content':'产品测试记录。'}]}
        status,page=memorial.save(self.c,'fixture',self.payload,'https://fixture.invalid')
        self.assertEqual(status,200);self.public_id=page['public_id']
        self.env=patch.dict(os.environ,{'LIFEOS_CLOUD_AI_PROVIDER':'custom','LIFEOS_CLOUD_AI_BASE_URL':'https://fixture.invalid/v1',
                                       'LIFEOS_CLOUD_AI_API_KEY':'secret-never-returned','LIFEOS_CLOUD_AI_MODEL':'fixture'})
        self.env.start();self.addCleanup(self.env.stop);self.addCleanup(self.c.close)
        self.transport=patch('cloud.memorial.request.urlopen',side_effect=self.respond)
        self.upstream=self.transport.start();self.addCleanup(self.transport.stop)
        self.reply={'choices':[{'message':{'content':'测试记录说明了进展。[2]'}}]}
        self.messages=[{'role':'user','content':'synthetic-input'}]

    def respond(self,*args,**kwargs):
        body=io.BytesIO(json.dumps(self.reply).encode())
        return body

    def ask(self):return memorial.ask(self.c,self.public_id,'产品','visitor')

    def test_memorial_cites_only_referenced_published_entry_and_keeps_number(self):
        status,out=self.ask();self.assertEqual(status,200)
        self.assertEqual(out['citation_status'],'verified')
        self.assertEqual(out['citations'],[{'citation_id':2,'entry_id':'two','date':'2030-02-02','title':'产品'}])
        req=self.upstream.call_args.args[0];payload=json.loads(req.data)
        self.assertEqual(payload['max_tokens'],500)
        self.assertEqual(self.upstream.call_args.kwargs['timeout'],45)
        self.assertNotIn('synthetic-input',payload['messages'][1]['content'])

    def test_memorial_missing_citations_does_not_falsely_claim_sources(self):
        self.reply['choices'][0]['message']['content']='无法确定'
        status,out=self.ask();self.assertEqual(status,200)
        self.assertEqual(out['citation_status'],'missing');self.assertEqual(out['citations'],[])

    def test_memorial_bad_shapes_empty_and_invalid_citations_fail_safely(self):
        for reply in ({}, {'choices':[]}, {'choices':[{'message':{'content':[]}}]},
                      {'choices':[{'message':{'content':' '}}]}, {'choices':[{'message':{'content':'编造引用[9]'}}]}):
            self.reply=reply
            status,out=self.ask();self.assertEqual(status,502)
            self.assertNotIn('secret',json.dumps(out))

    def test_failed_memorial_calls_consume_allowance_and_retry_limit(self):
        self.upstream.side_effect=TimeoutError('secret-never-returned synthetic-input')
        for _ in range(12):
            status,out=self.ask();self.assertEqual(status,502);self.assertNotIn('secret',str(out))
        self.assertEqual(self.ask()[0],429);self.assertEqual(self.upstream.call_count,12)

    def test_no_match_and_ai_off_do_not_call_model(self):
        status,out=memorial.ask(self.c,self.public_id,'zebra','visitor')
        self.assertEqual(status,200);self.assertEqual(out['citations'],[])
        self.c.execute('UPDATE memorials SET ai_enabled=0');self.c.commit()
        self.assertEqual(self.ask()[0],403);self.upstream.assert_not_called()

    def test_cloud_message_validation_precedes_transport(self):
        for messages in (['bad'],[{}],[{'role':'tool','content':'bad'}],[{'role':'user','content':{}}]):
            self.assertEqual(p2_services._cloud_ai(self.c,'fixture',{'messages':messages})[0],400)
        self.upstream.assert_not_called()

    def test_cloud_success_logs_counts_and_strips_extra_message_fields(self):
        self.reply={'choices':[{'message':{'content':'usable answer'}}]}
        status,out=p2_services._cloud_ai(self.c,'fixture',{'messages':[{'role':'user','content':'synthetic-input','extra':'discard'}]})
        self.assertEqual(status,200)
        payload=json.loads(self.upstream.call_args.args[0].data)
        self.assertNotIn('extra',payload['messages'][0])
        row=dict(self.c.execute('SELECT * FROM ai_requests').fetchone())
        self.assertNotIn('synthetic-input',str(row));self.assertEqual(row['input_chars'],15)

    def test_cloud_provider_failures_are_safe_and_not_counted_as_success(self):
        self.upstream.side_effect=RuntimeError('secret-never-returned synthetic-input')
        status,out=p2_services._cloud_ai(self.c,'fixture',{'messages':self.messages})
        self.assertEqual(status,502);self.assertNotIn('secret',str(out));self.assertNotIn('synthetic-input',str(out))
        self.assertEqual(self.c.execute("SELECT status FROM ai_requests").fetchone()[0],'error')
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM usage_counters').fetchone()[0],0)

    def test_cloud_rejects_empty_or_structured_model_output(self):
        for content in (' ',None,[],{}):
            self.reply={'choices':[{'message':{'content':content}}]}
            self.assertEqual(p2_services._cloud_ai(self.c,'fixture',{'messages':self.messages})[0],502)


if __name__=='__main__':unittest.main()

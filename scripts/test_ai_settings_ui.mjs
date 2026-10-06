import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/ai-settings.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const flush = async () => {await new Promise(setImmediate); await new Promise(setImmediate);};
const catalog = [
  {id:'deepseek',label:'DeepSeek',model:'deepseek-chat',base_url:'https://api.deepseek.com',wire_api:'chat_completions'},
  {id:'qwen',label:'通义千问',model:'qwen-test',base_url:'https://qwen.example.test/v1',wire_api:'chat_completions'},
  {id:'glm',label:'智谱 GLM',model:'glm-test',base_url:'https://glm.example.test/v4',wire_api:'chat_completions'},
];
function setup({ai={},saved_connection,integrations={},providers=catalog,postImpl,apiError}={}) {
  const events={},windowEvents={},nodes={},posts=[],reads=[];
  const data={ai:{mode:'byok',enabled:true,provider:'deepseek',model:'deepseek-chat',base_url:'https://api.deepseek.com',wire_api:'chat_completions',configured:true,available:true,payload_preview:true,cache:true,...ai},providers,saved_connection,integrations,
    features:['ask','past_me','classical','poetry','pet'].map(id=>({id,enabled:true,available:true,setting_key:`ai.features.${id}`}))};
  function node(id,values={}) {return nodes[id]={id,value:'',checked:false,disabled:false,hidden:false,dataset:{},
    closest(selector){return selector==='#aiSettingsForm'?nodes.aiSettingsForm:this;},hasAttribute(name){return name==='data-open-ai-settings'&&this.openAI;},setAttribute(){},removeAttribute(){},...values};}
  node('aiSettingsForm',{reportValidity:()=>true,querySelectorAll:()=>Object.values(nodes)});
  for(const id of ['aiApiFields','aiConnectionNote','aiAdvancedConnection','aiTestConnection','aiSaveSettings','aiSettingsFeedback','aiSecret'])node(id);
  const connection=saved_connection||data.ai;
  node('aiProvider',{value:connection.provider});node('aiModel',{value:connection.model});node('aiBaseUrl',{value:connection.base_url});node('aiWireApi',{value:connection.wire_api});
  node('aiEnabled',{checked:data.ai.enabled});node('aiPayloadPreview',{checked:true});node('aiUseCache',{checked:true});
  node('connection',{name:'aiConnection',value:data.ai.mode});
  const featureNodes=data.features.map(item=>node(item.id,{checked:true,dataset:{aiSetting:item.setting_key}}));
  let renders=0,opened;
  const context={FEATURES:[],DREAM_META:{},RENDERERS:{},STATE:{feature:'Home'},esc:escape,pageWrap:body=>body,bindSpecific(){},
    async api(url){reads.push(url);if(apiError)throw new Error(apiError);return data;},
    async post(url,payload){posts.push({url,payload:JSON.parse(JSON.stringify(payload))});return postImpl?postImpl(url,payload):{ok:true};},
    async render(){renders++;},openFeature(name){opened=name;},
    document:{getElementById:id=>nodes[id],addEventListener(name,callback){events[name]=callback;},querySelector:()=>nodes.connection,querySelectorAll:()=>featureNodes},
    window:{addEventListener(name,callback){windowEvents[name]=callback;},lifeosPoetry:{openSettings(){opened='poetry-settings';}}},
  };
  vm.runInNewContext(code,context,{filename:'ai-settings.js'});context.STATE.feature='AI Settings';
  return {context,nodes,posts,reads,data,windowEvents,get renders(){return renders;},get opened(){return opened;},
    async render(){const html=await context.RENDERERS['AI Settings']();context.bindSpecific();return html;},
    async submit(){events.submit({target:nodes.aiSettingsForm,preventDefault(){}});await flush();},
    async click(id){events.click({target:nodes[id]||node(id),preventDefault(){}});await flush();},
    change(id,value){nodes[id].value=value;events.change({target:nodes[id]});},
  };
}

test('simple API form uses the server provider catalog and does not expose saved secrets or integration instructions',async()=>{
  const app=setup({ai:{key:'SAVED_SECRET'},providers:[...catalog,{id:'custom-label',label:'<untrusted>',model:'m',base_url:'https://example.test',wire_api:'responses'}]});
  const html=await app.render();
  for(const id of ['deepseek','qwen','glm'])assert.match(html,new RegExp(`option value="${id}"`));
  assert.match(html,/&lt;untrusted&gt;/);assert.match(html,/id="aiSecret" type="password"/);
  assert.match(html,/<details class="aiFeatureSettings">/);assert.doesNotMatch(html,/aiPoetrySettings|诗文设置/);
  assert.doesNotMatch(html,/SAVED_SECRET|codex login|CC Switch|aiCodexModel|aiImportCC|data_scope|公开纪念页/);
  assert.deepEqual(app.reads,['/api/ai/control']);assert.deepEqual(app.posts,[]);
});

for(const [installed,available] of [[false,true],[true,false],[false,false]])test(`CC option is hidden unless the app and Codex are present (${installed},${available})`,async()=>{
  const app=setup({integrations:{cc_switch:{installed},codex:{available}}});assert.doesNotMatch(await app.render(),/name="aiConnection"/);
});

test('selecting a provider matches model, endpoint and protocol and clears the typed key',async()=>{
  const app=setup();await app.render();app.nodes.aiSecret.value='old-provider-key';app.change('aiProvider','qwen');
  assert.equal(app.nodes.aiModel.value,'qwen-test');assert.equal(app.nodes.aiBaseUrl.value,'https://qwen.example.test/v1');assert.equal(app.nodes.aiWireApi.value,'chat_completions');assert.equal(app.nodes.aiSecret.value,'');
  await app.submit();assert.equal(app.posts[0].payload.items['ai.provider'],'qwen');assert.equal(app.posts[0].payload.items['ai.model'],'qwen-test');
});

test('detected CC connection follows current Codex configuration without overwriting API credentials',async()=>{
  const app=setup({ai:{configured:false},integrations:{cc_switch:{installed:true},codex:{available:true}}});
  assert.match(await app.render(),/value="codex" checked/);await app.submit();
  const {items}=app.posts[0].payload;assert.equal(items['ai.mode'],'codex');assert.equal(items['ai.codex_model'],'');
  for(const name of ['ai.provider','ai.model','ai.base_url','ai.wire_api'])assert.equal(Object.hasOwn(items,name),false);
  assert.equal(Object.hasOwn(app.posts[0].payload,'key'),false);
});

for(const mode of ['byok','disabled'])test(`a saved ${mode} selection stays on API after reload even without a key and with CC detected`,async()=>{
  const app=setup({ai:{mode,enabled:mode!=='disabled',configured:false,config_source:'settings',provider:'qwen',model:'qwen-test',base_url:'https://qwen.example.test/v1'},integrations:{cc_switch:{installed:true},codex:{available:true}}});
  const html=await app.render();
  assert.match(html,/value="byok" checked/);assert.doesNotMatch(html,/value="codex" checked/);
  assert.equal(app.nodes.aiApiFields.hidden,false);await app.submit();
  assert.equal(app.posts[0].payload.items['ai.mode'],'byok');assert.equal(app.posts[0].payload.items['ai.provider'],'qwen');assert.equal(app.posts[0].payload.items['ai.enabled'],mode!=='disabled');
});

for(const mode of ['codex','cloud','local'])test(`legacy ${mode} remains usable and switching to API restores saved connection`,async()=>{
  const app=setup({ai:{mode,provider:mode,model:'runtime-model'},saved_connection:{provider:'glm',model:'kept-model',base_url:'https://saved.example.test',wire_api:'responses'}});
  const html=await app.render();assert.doesNotMatch(html,/name="aiConnection"/);assert.match(app.nodes.aiConnectionNote.innerHTML,/当前连接/);
  await app.submit();assert.equal(app.posts[0].payload.items['ai.mode'],mode);assert.equal(Object.hasOwn(app.posts[0].payload.items,'ai.model'),false);
  await app.click('aiSwitchToAPI');await app.submit();assert.equal(app.posts[1].payload.items['ai.mode'],'byok');assert.equal(app.posts[1].payload.items['ai.model'],'kept-model');assert.equal(app.posts[1].payload.items['ai.provider'],'glm');
});

test('blank keys are omitted, submitted keys are cleared, and feature switches are captured before disabling',async()=>{
  const app=setup();await app.render();app.nodes.poetry.checked=false;await app.submit();
  assert.equal(Object.hasOwn(app.posts[0].payload,'key'),false);assert.equal(app.posts[0].payload.items['ai.features.poetry'],false);assert.equal(app.posts[0].payload.items['ai.features.ask'],true);
  app.nodes.aiSecret.value='fresh-key-value';await app.submit();assert.equal(app.posts[1].payload.key,'fresh-key-value');assert.equal(app.nodes.aiSecret.value,'');
  app.nodes.aiEnabled.checked=false;await app.submit();assert.equal(app.posts[2].payload.items['ai.enabled'],false);assert.equal(app.posts[2].payload.items['ai.allow_remote'],false);
});

test('save and test errors cannot echo request secrets',async()=>{
  const app=setup({postImpl:()=>{throw new Error('SECRET_IN_REQUEST');}});await app.render();app.nodes.aiSecret.value='SECRET_IN_REQUEST';await app.submit();assert.doesNotMatch(app.nodes.aiSettingsFeedback.textContent,/SECRET_IN_REQUEST/);
  const tested=setup({postImpl:url=>{if(url==='/api/ai/test')throw new Error('UPSTREAM_SECRET');return {ok:true};}});await tested.render();await tested.click('aiTestConnection');
  assert.deepEqual(tested.posts.map(item=>item.url),['/api/ai/settings','/api/ai/test']);assert.deepEqual(tested.posts[1].payload,{});assert.match(tested.nodes.aiSettingsFeedback.textContent,/已保存/);assert.doesNotMatch(tested.nodes.aiSettingsFeedback.textContent,/UPSTREAM_SECRET/);
  const failed=setup({apiError:'UPSTREAM_SECRET'});assert.doesNotMatch(await failed.render(),/UPSTREAM_SECRET/);
});

test('late shell binding preserves the settings navigation',async()=>{
  const app=setup();await app.render();let called=0;app.context.bindSpecific=()=>called++;app.windowEvents['lifeos:i2-ready']();app.context.bindSpecific();assert.equal(called,1);
  app.nodes.aiSaveSettings.openAI=true;await app.click('aiSaveSettings');assert.equal(app.opened,'AI Settings');
});

test('AI Settings direct links hydrate while their optional script loads',async()=>{
  const start=index.indexOf('function hydrateFromLocation(){'),end=index.indexOf('\nfunction roomHeader(',start);
  const context={STATE:{},location:{hash:'#AI%20Settings'},featureObj:()=>null,URLSearchParams,pageWrap:value=>value,loading:()=> 'loading'};
  vm.runInNewContext(index.slice(start,end),context);assert.equal(context.hydrateFromLocation(),true);assert.equal(context.STATE.feature,'AI Settings');
  vm.runInNewContext(index.split('\n').find(line=>line.startsWith('async function renderGeneric(){')),context);assert.equal(await context.renderGeneric(),'loading');
});

test('payload preview counts only selected evidence while enabled',()=>{
  const start=index.indexOf('function askControls('),end=index.indexOf('\nfunction renderAskEvidenceReview(',start),count={textContent:''};
  const rows=[{checked:true,dataset:{evchars:'23'}},{checked:false,dataset:{evchars:'99'}},{checked:true,dataset:{evchars:'41'}}];
  const context={STATE:{askPack:{payload_preview_enabled:true}},fmt:String,$:selector=>selector==='#askAnswer .askSelectionCount'?count:undefined,$$:selector=>selector==='#askAnswer .askEvidenceCheck'?rows:[]};
  vm.runInNewContext(index.slice(start,end),context);context.syncAskSelection();assert.match(count.textContent,/64 字/);rows[1].checked=true;context.syncAskSelection();assert.match(count.textContent,/163 字/);
  context.STATE.askPack.payload_preview_enabled=false;context.syncAskSelection();assert.doesNotMatch(count.textContent,/ 字/);
});

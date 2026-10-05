import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const chartSource = readFileSync(new URL('../app/charts.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const monthly = [{month:'2025-01',mentions:2,char_count:200,days:1,daily_entries:1}, {month:'2025-04',mentions:7,char_count:700,days:2,daily_entries:2}];
const skills = [{name:'Reading',description:'阅读记录',mentions:9,evidence_days:3,level:2,first_seen:'2025-01-01',last_seen:'2025-04-02'}];

function fixture({empty=false,noSkills=false} = {}) {
  const select = {value:'阅读'}, target = {isConnected:true,innerHTML:''};
  const context = vm.createContext({
    STATE:{skill:'removed-skill'}, esc:escape, fmt:value => Number(value||0).toLocaleString('zh-CN'),
    pref:()=>'removed-skill', remember:()=>{}, moduleHead:name=>`<h2>${escape(name)}</h2>`,
    pageWrap:html=>html, sourceBtn:path=>`<button>${escape(path)}</button>`,
    getSkills:async()=>noSkills?[]:skills,
    $:selector=>selector==='#wordSelect'?select:target,
    api:async path=>{
      if(path.startsWith('/api/skill?')) {assert.ok(path.endsWith('Reading'));return {skill:skills[0],monthly:empty?[]:monthly,evidence:[],contexts:{}};}
      if(path.startsWith('/api/reviews'))return {items:{}};
      if(path==='/api/analytics')return {overview:{entries:empty?0:3,char_count:empty?0:900},months:empty?[]:monthly};
      if(path==='/api/words')return {terms:empty?{}:{'未出现':[],'阅读':monthly.map(x=>({...x,mention_count:x.mentions}))}};
      throw Error('Unexpected API: '+path);
    },
  });
  vm.runInContext(chartSource,context);
  for(const name of ['renderSkillEvidence','renderSkillEvolution','renderAnalytics','renderWords']) {
    const fn=shell.match(new RegExp(`async function ${name}\\(\\)\\{[\\s\\S]*?\\n\\}`));
    assert.ok(fn,`Renderer ${name} is present`);
    vm.runInContext(fn[0],context);
  }
  return {context,select,target};
}

test('all four production renderers build charts from source data and tolerate empty archives',async()=>{
  for(const empty of [false,true]) {
    const {context}=fixture({empty});
    for(const name of ['renderSkillEvidence','renderSkillEvolution','renderAnalytics','renderWords']) {
      const html=await context[name]();
      assert.doesNotMatch(html,/NaN|Infinity|undefined|Could not render/);
      assert.match(html,empty?/lineChartEmpty/:/role="img"/);
    }
  }
});

test('removed skill selections fall back to a current skill; missing skills show an empty state',async()=>{
  const {context}=fixture();
  assert.match(await context.renderSkillEvidence(),/Reading/);
  assert.equal(context.STATE.skill,'Reading');
  const missing=fixture({noSkills:true}).context;
  assert.match(await missing.renderSkillEvolution(),/暂无技能记录/);
  assert.match(await missing.renderSkillEvidence(),/暂无技能记录/);
});

test('sparse months use calendar spacing and duplicate monthly rows retain their sum',()=>{
  const {context}=fixture();
  const html=context.lineChart([{month:'2025-12',mentions:4},{month:'2025-01',mentions:1},{month:'2025-02',mentions:2},{month:'2025-02',mentions:3}]);
  assert.match(html,/cx="54\.55"/); // February is one of eleven calendar intervals, not halfway.
  assert.match(html,/2025-02 · 5 次/);
  assert.match(html,/共 10 次/);
});

test('zero and single month values render finite geometry; invalid values are excluded',()=>{
  const {context}=fixture();
  const single=context.lineChart([{month:'2025-01',mentions:0}]);
  assert.match(single,/cx="300\.00"/);
  assert.doesNotMatch(single,/<polyline|NaN|Infinity/);
  const invalid=context.lineChart([{month:'2025-13',mentions:1},{month:'bad',mentions:10},{month:'2025-01',mentions:Infinity},{month:'2025-02',mentions:-4},null]);
  assert.match(invalid,/暂无月度记录/);
});

test('chart titles and units escape user-controlled text; monthly values have a readable table',()=>{
  const {context}=fixture();
  const html=context.lineChart(monthly,'mentions',{label:'<img src=x onerror=alert(1)>',unit:'"<script>'});
  assert.doesNotMatch(html,/<img|<script>/);
  assert.match(html,/&lt;img/);
  assert.match(html,/<th scope="row">2025-01<\/th><td>2<\/td>/);
});

test('word selection keeps a live chart and displays empty words without crashing',async()=>{
  const {context,select,target}=fixture();
  const handler=shell.split('\n').find(line=>line.includes('if($("#wordSelect"))'));
  assert.ok(handler);vm.runInContext(handler,context);
  await select.onchange({target:select});assert.match(target.innerHTML,/role="img"/);
  select.value='未出现';await select.onchange({target:select});assert.match(target.innerHTML,/这个词还没有月度记录/);
  target.isConnected=false;target.innerHTML='closed';await select.onchange({target:select});assert.equal(target.innerHTML,'closed');
});

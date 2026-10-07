'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function loadPetActions(resourceRoot){
  const context={module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(path.join(resourceRoot,'app','pet-actions.js'),'utf8'),context,{timeout:1000,filename:'pet-actions.js'});
  const actions=context.module.exports.actions;
  if(!Array.isArray(actions)||!actions.length)throw new Error('桌宠动作配置不可用');
  return actions.map(([id,label])=>[String(id),String(label)]);
}
module.exports={loadPetActions};

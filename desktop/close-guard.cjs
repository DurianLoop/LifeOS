'use strict';
function createCloseGuard({window,dialog}){
  let allowed=false,closing=null;
  async function prepare(){
    let timer;
    try{return await Promise.race([
      window.webContents.executeJavaScript('window.lifeosPrepareToClose ? window.lifeosPrepareToClose() : true'),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('保存超时')),15000)})
    ])===true}catch{return false}finally{clearTimeout(timer)}
  }
  function onClose(event){
    if(allowed)return;
    event.preventDefault();if(closing)return;
    closing=(async()=>{
      let safe=await prepare();
      if(!safe){const result=await dialog.showMessageBox(window,{type:'warning',title:'草稿尚未保存',message:'保存未完成，关闭后可能丢失这次输入',buttons:['返回继续保存','仍然关闭'],defaultId:0,cancelId:0});safe=result.response===1}
      if(safe){allowed=true;window.close()}
    })().catch(()=>{}).finally(()=>{closing=null});
  }
  return {prepare,onClose,allow:()=>{allowed=true},isAllowed:()=>allowed};
}
module.exports={createCloseGuard};

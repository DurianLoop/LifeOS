'use strict';
function createUpdateController({updater,isPackaged,send,prepare,backup,install,CancellationToken,lock=async()=>{},unlock=async()=>{}}){
  let status={status:updater&&isPackaged?'idle':'unsupported'},available=false,ready=false,task=null,cancel=null;
  const publish=value=>{status={...status,...value};send({...status})};
  const safeError=()=>publish({status:'error',message:'更新未完成，请检查网络和磁盘空间后重试'});
  if(updater&&isPackaged){
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;
    updater.on('checking-for-update',()=>publish({status:'checking',message:''}));
    updater.on('update-available',info=>{available=true;publish({status:'available',hasUpdate:true,version:info.version,message:''})});
    updater.on('update-not-available',()=>{available=false;ready=false;publish({status:'current',hasUpdate:false,version:'',message:''})});
    updater.on('download-progress',p=>{if(!cancel?.cancelled)publish({status:'downloading',percent:Math.round(p.percent||0)})});
    updater.on('update-downloaded',info=>{if(!cancel?.cancelled){ready=true;publish({status:'ready',version:info.version,percent:100})}});
    updater.on('error',()=>{if(!cancel?.cancelled)safeError()});
  }
  const supported=()=>Boolean(updater&&isPackaged);
  return {
    snapshot:()=>({...status}),
    async check(){
      if(!supported())return {ok:false,reason:'源码模式请使用本地安装包验收更新'};
      if(task)return {ok:false,error:'请等待当前更新操作完成'};
      if(ready)return {ok:true,...status};
      try{task=updater.checkForUpdates();await task;return {ok:true,...status}}catch{safeError();return {ok:false,error:status.message}}finally{task=null}
    },
    async download(){
      if(!supported()||!available)return {ok:false,error:'请先检查可用更新'};
      if(task)return {ok:false,error:'正在下载更新'};
      cancel=new CancellationToken();publish({status:'downloading',percent:0,message:''});
      try{task=updater.downloadUpdate(cancel);await task;if(cancel.cancelled){ready=false;publish({status:'available',percent:0});return {ok:false,cancelled:true}}return {ok:true,...status}}
      catch{if(cancel.cancelled){publish({status:'available',percent:0});return {ok:false,cancelled:true}}safeError();return {ok:false,error:status.message}}
      finally{task=null;cancel=null}
    },
    cancel(){if(cancel){cancel.cancel();publish({status:'cancelling'});return {ok:true}}return {ok:false}},
    async install(){
      if(!supported()||!ready||task)return {ok:false,error:'更新尚未准备好'};
      task=Promise.resolve();publish({status:'preparing',message:''});
      try{
        await lock();
        if(!await prepare()){await unlock();publish({status:'ready'});return {ok:false,error:'草稿尚未保存，已保留当前版本'}}
        await backup();install();return {ok:true};
      }catch{await unlock();publish({status:'ready',message:'安全备份未完成，请释放磁盘空间后重试'});return {ok:false,error:status.message}}
      finally{task=null}
    }
  };
}
module.exports={createUpdateController};

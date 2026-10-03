/* Decode local atlases once and derive occupied cells without a Python image dependency. */
(() => {
  'use strict';
  const assets=new Map();
  function occupiedFrames(image,version){
    const rows=Number(version)===2?11:9,canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const width=Math.floor(canvas.width/8),height=Math.floor(canvas.height/rows);
    if(!width||!height)throw new Error('桌宠图集尺寸无效');
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    return Array.from({length:rows},(_,row)=>{
      const cells=[];
      for(let column=0;column<8;column++){
        const pixels=context.getImageData(column*width,row*height,width,height).data;
        for(let i=3;i<pixels.length;i+=4)if(pixels[i]){cells.push(column);break}
      }
      return cells.length?cells:[0];
    });
  }
  async function prepare(item){
    if(!item?.asset_url)return item;
    const key=`${item.asset_url}|${item.spriteVersionNumber||1}`;
    if(!assets.has(key)){
      const image=new Image();image.src=item.asset_url;
      assets.set(key,image.decode().then(()=>({image,frames:occupiedFrames(image,item.spriteVersionNumber)})).catch(error=>{assets.delete(key);throw error}));
    }
    const decoded=await assets.get(key);
    // A server without Pillow returns every column, including transparent ones.
    return {...item,frame_map:decoded.frames};
  }
  window.lifeosPetSprites={prepare};
})();

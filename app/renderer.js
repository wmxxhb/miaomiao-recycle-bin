import { PetViewer } from './viewer.js';
import { randomAfkDelay } from './actions.js';
const $=id=>document.getElementById(id);
const viewer=new PetViewer($('scene'));
viewer.onLayout=value=>window.pet.dialogueAnchors(value);
const forms=await fetch('/resources/miaomiao/runtime.json').then(r=>r.json());
let state, loading=Promise.resolve(), requestedForm, loadingForm=false, messageTimer, idleTimer, moving=false, busy=false, hoveringFiles=false;
function message(text,ms=3500){clearTimeout(messageTimer);$('message').textContent=text;$('message').classList.remove('quiet');if(ms)messageTimer=setTimeout(()=>$('message').classList.add('quiet'),ms);}
function clearIdle(){clearTimeout(idleTimer);}
function canIdle(){return !busy&&!moving&&!loadingForm&&!hoveringFiles&&!document.hidden&&viewer.isIdle;}
function scheduleIdle(){
  clearIdle();if(!canIdle())return;
  idleTimer=setTimeout(()=>{if(canIdle())viewer.trigger('afk');},randomAfkDelay());
}
function trigger(kind){clearIdle();return viewer.trigger(kind);}
viewer.onIdle=scheduleIdle;
async function applyState(next){
  state=next;
  if(requestedForm!==state.form){
    requestedForm=state.form;loadingForm=true;clearIdle();viewer.play('Idle');
    loading=viewer.load(forms[state.form]).then(ok=>{if(ok){loadingForm=false;scheduleIdle();}}).catch(error=>{loadingForm=false;message('精灵加载失败：'+error.message,0);throw error;});
  }
  await loading;
}
window.petReady=async function(form){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,100));await loading;if(!loadingForm&&state?.form===form&&viewer.form?.id===forms[form].id)return {form,...viewer.status()};}
  throw new Error('精灵加载超时');
};
window.petRenderInfo=()=>({dpr:devicePixelRatio,canvas:[viewer.renderer.domElement.width,viewer.renderer.domElement.height],display:[viewer.mount.clientWidth,viewer.mount.clientHeight],projection:viewer.camera.projectionMatrix.toArray(),resizeCount:viewer.resizeCount});
window.petFrameStats=()=>({targetFPS:viewer.targetFPS,renderedFrames:viewer.renderedFrames,now:performance.now()});
window.petActionStatus=()=>viewer.player?.status();
window.petActionTest={
  trigger:kind=>trigger(kind),advance:seconds=>viewer.player.advance(seconds),
  idle:()=>{viewer.play('Idle');scheduleIdle();},canIdle,hold:value=>viewer.holding=value,
  choose(kind,values){let i=0;const previous=viewer.player.random;viewer.player.random=()=>values[Math.min(i++,values.length-1)];try{return trigger(kind);}finally{viewer.player.random=previous;}},
};
window.pet.onState(next=>applyState(next).catch(console.error));
window.pet.onAIReply(reply=>{
  if(document.hidden||busy||moving||loadingForm||hoveringFiles||!['idle','afk','chat'].includes(viewer.player?.source))return;
  const clips={happy:'Happy',calm:'Relax',alert:'Alert',sad:'Sad',shocked:'Shock',angry:'Anger',fear:'Fear',proud:'Show'};
  if(reply.emotions&&clips[reply.emotion]){clearIdle();viewer.player.play([{id:clips[reply.emotion]}],'chat');}
  scheduleIdle();
});
$('scene').addEventListener('contextmenu',event=>{event.preventDefault();window.pet.dialogueOpen().catch(error=>message(error.message,6000));});
document.addEventListener('contextmenu',event=>event.preventDefault());
$('scene').addEventListener('pointerdown',async e=>{
  if(e.button!==0||loadingForm||moving||busy)return;
  e.preventDefault();clearIdle();moving=true;viewer.holding=true;
  try{
    const result=await window.pet.dragBegin();
    if(!result.dragged&&!result.cancelled&&!busy&&!loadingForm){trigger('click');message('喵～');}
  }catch(error){message('拖动未完成：'+error.message);}
  finally{moving=false;viewer.holding=false;scheduleIdle();}
});
$('scene').addEventListener('dragstart',e=>e.preventDefault());
window.addEventListener('blur',()=>{if(moving)window.pet.dragCancel();});
document.addEventListener('visibilitychange',()=>{document.hidden?clearIdle():scheduleIdle();});
window.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
window.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';hoveringFiles=true;clearIdle();document.body.classList.add('dragging');});
window.addEventListener('dragleave',e=>{if(e.relatedTarget===null){hoveringFiles=false;document.body.classList.remove('dragging');scheduleIdle();}});
window.addEventListener('drop',async e=>{
  e.preventDefault();hoveringFiles=false;document.body.classList.remove('dragging');
  if(!e.dataTransfer.files.length){scheduleIdle();return;}
  if(busy){message('正在处理上一批，请稍后再投喂');return;}
  busy=true;clearIdle();viewer.play('Idle');message('开饭啦…',0);
  try{
    const result=await window.pet.feedFiles(Array.from(e.dataTransfer.files));await applyState(result.state);
    if(result.count){
      $('snack').classList.remove('eaten');void $('snack').offsetWidth;$('snack').classList.add('eaten');trigger('feed');
      if(result.evolved){document.body.classList.add('evolving');setTimeout(()=>document.body.classList.remove('evolving'),1400);message(`进化成${state.name}啦！`,5000);}
      else message(`吃饱啦！${result.count} 项已移入回收站`);
      if(result.rejected.length)message(`${result.count} 项已回收，${result.rejected.length} 项没能投喂`,6000);
    }else message(result.rejected[0]?.message||'没有可投喂的文件',5000);
  }catch(error){message('这次没吃到：'+error.message,5000);}finally{busy=false;scheduleIdle();}
});
await applyState(await window.pet.state());message('把文件拖过来，喂我吧～',6000);

const $=id=>document.getElementById(id),surface=new URLSearchParams(location.search).get('surface');
const panel=$(surface==='bubble'?'bubble':'composer');panel.hidden=false;
let currentId=null,active=false,busy=false,frame;
const cleanError=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
function measure(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>window.pet.dialogueMeasure(surface,Math.ceil(panel.getBoundingClientRect().height+36)));}
new ResizeObserver(measure).observe(panel);
function controls(){if(surface!=='input')return;$('send').hidden=active;$('input-stop').hidden=!active;$('send').disabled=busy||!$('input').value.trim();$('input-stop').disabled=busy;}
window.pet.onDialogueLayout(value=>{
  document.body.dataset.tail=value.tailSide||'bottom';document.body.style.setProperty('--tail-offset',(value.tailOffset||180)+'px');
  document.body.style.setProperty('--max-text-height',value.maxTextHeight+'px');measure();
});
window.pet.onDialogueContent(value=>{
  if(surface!=='bubble'||!value)return;
  const reply=$('reply'),fresh=value.id!==currentId,atBottom=reply.scrollHeight-reply.scrollTop-reply.clientHeight<45;
  currentId=value.id;reply.textContent=value.text;$('thinking').hidden=!!value.text||!value.active;
  $('reply-note').textContent=value.note||(!value.active&&!value.text?'这次没有收到文字，可以再问我一次。':'');
  $('stop').hidden=!value.active;active=value.active;
  if(fresh)reply.scrollTop=0;else if(atBottom)reply.scrollTop=reply.scrollHeight;
  measure();
});
window.pet.onDialogueInputState(value=>{active=value.active;if(surface==='input'&&value.hint)$('input-status').textContent=value.hint;controls();});
window.pet.onDialogueNotice(text=>{if(surface==='input'){$('input-status').textContent=text;measure();}});
window.pet.onDialogueFocus(()=>{if(surface==='input'){$('input').focus();$('input').setSelectionRange($('input').value.length,$('input').value.length);}});
for(const kind of ['bubble','input'])$('close-'+kind).onclick=()=>window.pet.dialogueClose(kind);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();window.pet.dialogueClose(surface);}});
document.addEventListener('contextmenu',event=>event.preventDefault());
async function stop(){if(busy)return;busy=true;controls();try{await window.pet.aiStop();}catch(error){if(surface==='input')$('input-status').textContent=cleanError(error);else $('reply-note').textContent=cleanError(error);}finally{busy=false;controls();measure();}}
$('stop').onclick=stop;$('input-stop').onclick=stop;
$('input').addEventListener('input',()=>{controls();});
$('input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!active&&!busy&&$('input').value.trim())$('composer').requestSubmit();}});
$('composer').onsubmit=async event=>{
  event.preventDefault();const text=$('input').value.trim();if(!text||active||busy)return;
  busy=true;$('input-status').textContent='';controls();
  try{await window.pet.aiSend({text});$('input').value='';}
  catch(error){$('input-status').textContent=cleanError(error);}
  finally{busy=false;controls();measure();}
};
controls();measure();document.documentElement.dataset.ready='true';

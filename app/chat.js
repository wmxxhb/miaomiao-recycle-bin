const $=id=>document.getElementById(id);
let state,uiBusy=false;const messageNodes=new Map();
const cleanError=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
function status(text='',error=false){$('chat-status').textContent=text;$('chat-status').classList.toggle('error',error);}
function nearBottom(){const e=$('messages');return e.scrollHeight-e.scrollTop-e.clientHeight<85;}
function scrollEnd(){requestAnimationFrame(()=>$('messages').scrollTop=$('messages').scrollHeight);}
function providerName(id){return state?.providers.find(p=>p.id===id)?.name||id;}
function controls(){
  if(!state)return;const active=!!state.active,profile=state.config.profiles[state.config.selectedProvider],canSend=!!profile?.hasKey&&!!profile.model;
  $('configuration-hint').hidden=canSend;$('model').textContent=profile?.model||'尚未选择模型';
  if(!uiBusy){$('provider').value=state.config.selectedProvider;$('conversations').value=state.conversation.id;}
  for(const id of ['provider','conversations','new','export','clear','delete'])$(id).disabled=active||uiBusy;
  $('stop').hidden=!active;$('stop').disabled=uiBusy;
  $('regenerate').hidden=active;$('regenerate').disabled=uiBusy||!canSend||!state.conversation.messages.some(m=>m.role==='user');
}
function appendMessage(message){
  const article=document.createElement('article');article.className='message '+message.role+' '+message.status;
  const by=document.createElement('div');by.className='by';by.textContent=message.role==='user'?'我':(message.petName||'精灵')+(message.provider?' · '+providerName(message.provider):'');
  const text=document.createElement('div');text.className='text';text.textContent=message.content;
  const meta=document.createElement('div');meta.className='meta';
  const note=document.createElement('span');note.textContent=message.status==='generating'?'正在生成…':message.error||'';meta.append(note);
  if(message.role==='assistant'&&message.content){const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.onclick=async()=>{try{await window.pet.aiCopy(message.id);status('已复制回复');}catch(error){status(cleanError(error),true);}};meta.append(copy);}
  article.append(by,text,meta);$('messages').append(article);messageNodes.set(message.id,{article,text,note});
}
function render(next){
  if(state&&next.revision<state.revision)return;
  const bottom=nearBottom(),top=$('messages').scrollTop,first=!state;state=next;
  $('provider').replaceChildren(...state.providers.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;return o;}));
  $('provider').value=state.config.selectedProvider;
  $('conversations').replaceChildren(...state.conversations.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.title;return o;}));$('conversations').value=state.conversation.id;
  messageNodes.clear();const empty=$('empty');$('messages').replaceChildren();if(!state.conversation.messages.length)$('messages').append(empty||makeEmpty());
  for(const message of state.conversation.messages)appendMessage(message);
  controls();if(bottom||first)scrollEnd();else $('messages').scrollTop=top;
  document.documentElement.dataset.ready='true';
}
function makeEmpty(){const e=document.createElement('div');e.id='empty';const mark=document.createElement('span');mark.className='pet-mark';mark.textContent='✿';const h=document.createElement('h2');h.textContent='今天想聊些什么？';const p=document.createElement('p');p.textContent='对话保存在本机。你可以随时停止回复，或新建一个对话。';e.append(mark,h,p);return e;}
async function operation(action){if(uiBusy)return;uiBusy=true;controls();try{const next=await action();if(next?.conversation)render(next);return next;}catch(error){status(cleanError(error),true);}finally{uiBusy=false;controls();}}
$('continue').onclick=async()=>{try{await window.pet.dialogueOpen();window.close();}catch(error){status(cleanError(error),true);}};
$('stop').onclick=()=>operation(async()=>{status('正在停止…');const next=await window.pet.aiStop();status('已停止生成，已收到的内容仍保留。');return next;});
$('regenerate').onclick=()=>operation(()=>{status('');return window.pet.aiSend({regenerate:true});});
$('provider').onchange=()=>{const id=$('provider').value;operation(()=>window.pet.aiProvider(id));};
$('conversations').onchange=()=>{const id=$('conversations').value;operation(()=>window.pet.aiSelect(id));};
$('new').onclick=()=>operation(async()=>{status('');return window.pet.aiNew();});
$('clear').onclick=()=>operation(async()=>{$('more').open=false;status('');return window.pet.aiClear();});
$('delete').onclick=()=>operation(async()=>{$('more').open=false;status('');return window.pet.aiDelete();});
$('export').onclick=()=>operation(async()=>{$('more').open=false;if(await window.pet.aiExport())status('当前对话已导出，文件不包含保存的 API Key。');});
window.pet.onAIUpdate(event=>{
  if(event.type==='state')render(event.state);
  else if(event.type==='config'&&state&&event.revision>=state.revision){state.config=event.config;state.revision=event.revision;controls();}
  else if(event.type==='delta'){
    const node=messageNodes.get(event.messageId);if(!node)return;const bottom=nearBottom();node.text.textContent=event.text;node.note.textContent='正在生成…';
    const message=state.conversation.messages.find(m=>m.id===event.messageId);if(message)message.content=event.text;
    if(bottom)scrollEnd();
  }else if(event.type==='thinking'){const node=messageNodes.get(event.messageId);if(node)node.note.textContent='正在思考…';}
  else if(event.type==='notice')status(event.message,true);
});
try{render(await window.pet.aiState());}catch(error){status(cleanError(error),true);}

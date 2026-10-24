const $=id=>document.getElementById(id);let state,scaleTimer;
const names=['喵喵','喵呜','魔力猫'];
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function render(next){
  state=next;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
  document.querySelectorAll('[data-form]').forEach(b=>b.classList.toggle('active',Number(b.dataset.form)===state.form));
  $('mode-description').textContent=state.mode==='growth'?'达到累计次数后自动进化，成长记录一直保留。':`当前手动显示${state.name}；投喂仍会积累成长。`;
  $('feed-total').textContent=`已投喂 ${state.feeds} 次`;
  $('progress-fill').style.width=(state.progress*100)+'%';
  $('progress-detail').textContent=state.next?`成长形态：${names[state.growthForm]} · 再投喂 ${Math.max(0,state.next-state.feeds)} 次成为${names[state.growthForm+1]}（累计 ${state.next} 次）`:'已完成进化：魔力猫，投喂次数仍继续累计。';
  for(const [index,id]of ['first-threshold','second-threshold'].entries())if(document.activeElement!==$(id))$(id).value=state.thresholds[index];
  if(document.activeElement!==$('pet-scale'))$('pet-scale').value=Math.round(state.scale*100);
  $('scale-label').textContent=Math.round(state.scale*100)+'%';
}
window.pet.onState(render);
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=async()=>{try{render(await window.pet.choose({mode:b.dataset.mode}));status('模式已保存');}catch(error){status(error.message,true);}});
document.querySelectorAll('[data-form]').forEach(b=>b.onclick=async()=>{try{render(await window.pet.choose({mode:'manual',manualForm:Number(b.dataset.form)}));status('形态已保存');}catch(error){status(error.message,true);}});
$('threshold-form').onsubmit=async event=>{event.preventDefault();try{render(await window.pet.configure({thresholds:[Number($('first-threshold').value),Number($('second-threshold').value)]}));status('进化次数已保存，成长形态已按新门槛更新');}catch(error){status(error.message,true);}};
$('pet-scale').oninput=()=>{const scale=Number($('pet-scale').value)/100;$('scale-label').textContent=Math.round(scale*100)+'%';clearTimeout(scaleTimer);scaleTimer=setTimeout(async()=>{try{render(await window.pet.configure({scale}));status('桌面大小已保存');}catch(error){status(error.message,true);}},100);};
$('reset-scale').onclick=async()=>{clearTimeout(scaleTimer);render(await window.pet.configure({scale:1}));status('已恢复 100%');};
$('studio').onclick=async()=>{status('正在打开精灵动作室…');try{await window.pet.openStudio();status('动作室已在浏览器打开');}catch(error){status(error.message,true);}};
$('hide').onclick=()=>window.pet.hide();$('quit').onclick=()=>window.pet.quit();
window.addEventListener('keydown',event=>{if(event.key==='Escape')window.close();});
render(await window.pet.state());
document.documentElement.dataset.ready='true';

let aiConfig,aiProviders=[],aiDirty=false,aiBusy=false;
const aiForm=$('ai-form');
const cleanError=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
function aiStatus(text,error=false){$('ai-status').textContent=text;$('ai-status').classList.toggle('error',error);}
function aiModelOptions(values){$('ai-model-list').replaceChildren(...values.map(value=>{const option=document.createElement('option');option.value=value;return option;}));}
function renderAIProfile(id){
  const p=aiConfig.profiles[id];if(!p)return;
  $('ai-provider').value=id;$('ai-base-url').value=p.baseURL;$('ai-protocol').value=p.protocol;$('ai-model').value=p.model;
  $('ai-api-version').value=p.apiVersion;$('ai-workspace').value=p.workspaceId;$('ai-api-key').value='';
  $('ai-api-key').placeholder=p.hasKey?'已加密保存，留空保留':'在这里安全填写密钥';
  $('ai-key-status').textContent=p.hasKey?'密钥已加密保存':'尚未填写密钥';
  $('ai-claude-fields').hidden=p.protocol!=='claude';
  aiModelOptions(aiProviders.find(item=>item.id===id)?.models||[]);
}
function renderAI(config){
  aiConfig=config;renderAIProfile(config.selectedProvider);
  const p=config.preferences;$('ai-nickname').value=p.nickname;$('ai-personality').value=p.personality;
  $('ai-context').value=p.contextTurns;$('ai-max-tokens').value=p.maxTokens;$('ai-bubbles').checked=p.bubbles;$('ai-emotions').checked=p.emotions;
  if(!config.encryptionAvailable)aiStatus('Windows 本机加密当前不可用，请稍后重试；程序不会保存明文密钥。',true);
}
function aiPayload(){return {provider:$('ai-provider').value,apiKey:$('ai-api-key').value,
  profile:{baseURL:$('ai-base-url').value,protocol:$('ai-protocol').value,model:$('ai-model').value,apiVersion:$('ai-api-version').value,workspaceId:$('ai-workspace').value},
  preferences:{nickname:$('ai-nickname').value,personality:$('ai-personality').value,contextTurns:Number($('ai-context').value),maxTokens:Number($('ai-max-tokens').value),bubbles:$('ai-bubbles').checked,emotions:$('ai-emotions').checked}};}
async function aiOperation(action){
  if(aiBusy)return;aiBusy=true;for(const element of aiForm.elements)element.disabled=true;
  try{await action();}catch(error){aiStatus(cleanError(error),true);}finally{aiBusy=false;for(const element of aiForm.elements)element.disabled=false;}
}
aiForm.addEventListener('input',()=>{aiDirty=true;});
$('ai-provider').onchange=()=>{renderAIProfile($('ai-provider').value);aiDirty=true;aiStatus('切换完成，点击“保存 AI 设置”后使用此厂商。');};
$('ai-protocol').onchange=()=>{$('ai-claude-fields').hidden=$('ai-protocol').value!=='claude';aiDirty=true;};
$('ai-base-url').addEventListener('input',()=>{
  const p=aiConfig?.profiles[$('ai-provider').value];let changed=true;
  try{changed=new URL($('ai-base-url').value).origin!==new URL(p.baseURL).origin;}catch{}
  if(p?.hasKey){$('ai-key-status').textContent=changed?'新域名需重新填密钥':'密钥已加密保存';$('ai-api-key').placeholder=changed?'服务域名已改变，请重新填写':'已加密保存，留空保留';}
});
aiForm.onsubmit=event=>{event.preventDefault();aiOperation(async()=>{
  const payload=aiPayload(),config=await window.pet.aiSave(payload);$('ai-api-key').value='';payload.apiKey='';aiDirty=false;renderAI(config);aiStatus(config.profiles[config.selectedProvider].hasKey?'AI 设置已保存，密钥仅以加密形式保存在本机。':'AI 设置已保存，填写 API Key 后即可聊天。');
});};
$('ai-test').onclick=()=>aiOperation(async()=>{aiStatus('正在测试当前地址和模型…');const result=await window.pet.aiTest(aiPayload());aiStatus(result.message);});
$('ai-models').onclick=()=>aiOperation(async()=>{aiStatus('正在获取模型列表…');const models=await window.pet.aiModels(aiPayload());aiModelOptions(models);aiStatus(models.length?`已获取 ${models.length} 个模型，可在模型框中选择或直接输入。`:'服务未返回模型列表，仍可手动填写模型名称。');});
$('ai-forget-key').onclick=()=>{if(!window.confirm('删除此厂商已保存在本机的密钥？'))return;aiOperation(async()=>{const payload=aiPayload();payload.apiKey='';payload.removeKey=true;const config=await window.pet.aiSave(payload);aiDirty=false;renderAI(config);aiStatus('此厂商的已存密钥已删除。');});};
window.pet.onAIConfig(config=>{aiConfig=config;if(!aiDirty&&!aiBusy)renderAI(config);});
try{const data=await window.pet.aiConfig();aiProviders=data.providers;$('ai-provider').replaceChildren(...aiProviders.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;return o;}));renderAI(data.config);document.documentElement.dataset.aiReady='true';}
catch(error){aiStatus(cleanError(error),true);}

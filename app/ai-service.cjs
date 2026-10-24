const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PROVIDERS,normalizeProfile,normalizeBaseURL,redact,streamReply,listModels}=require('./ai-providers.cjs');
const {buildPersona,finishPersonaReply}=require('./pet-persona.cjs');
const EMOTIONS=new Set(['happy','calm','alert','sad','shocked','angry','fear','proud','neutral']);
const DEFAULT_PREFERENCES={nickname:'',personality:'温柔、好奇，喜欢陪伴。使用中文自然交流，回复简洁，也能认真回答问题。',contextTurns:8,maxTokens:1024,bubbles:true,emotions:true};
const clone=value=>JSON.parse(JSON.stringify(value));
const now=()=>new Date().toISOString();
function preferences(value={}) {
  return {nickname:String(value.nickname??'').trim().slice(0,40),personality:String(value.personality??DEFAULT_PREFERENCES.personality).trim().slice(0,3000),
    contextTurns:Math.max(1,Math.min(30,Math.round(Number(value.contextTurns)||8))),
    maxTokens:Math.max(128,Math.min(8192,Math.round(Number(value.maxTokens)||1024))),bubbles:value.bubbles!==false,emotions:value.emotions!==false};
}
function cleanReply(raw,final=false) {
  const value=String(raw||'');
  const match=value.match(/^\s*\[\[emotion:([a-z]+)\]\]\s*/i);
  if(match)return {text:value.slice(match[0].length),emotion:EMOTIONS.has(match[1].toLowerCase())?match[1].toLowerCase():'neutral'};
  const start=value.trimStart();
  if(!final&&start.length<70&&('[[emotion:'.startsWith(start)||/^\[\[emotion:[a-z]*\]?$/i.test(start)))return {text:'',emotion:'neutral'};
  return {text:value,emotion:'neutral'};
}
function streamSafeText(raw,key) {
  // Hold only a suffix that could still become the API key in the next chunk.
  let pending=String(raw);
  for(let n=Math.min(key.length-1,pending.length);n>0;n--)if(pending.endsWith(key.slice(0,n))){pending=pending.slice(0,-n);break;}
  return redact(pending,key);
}
function buildContext(messages,turns=8) {
  const valid=messages.filter(m=>m.content&&['user','assistant'].includes(m.role)&&m.status!=='error');
  const users=valid.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0);
  let selected=valid.slice(users[Math.max(0,users.length-turns)]??0),chars=0,result=[];
  for(let i=selected.length-1;i>=0;i--){const m=selected[i];if(chars+m.content.length>40000&&result.length)break;result.unshift({role:m.role,content:m.content});chars+=m.content.length;}
  while(result[0]?.role==='assistant')result.shift();
  return result;
}
function conversation(){return {id:randomUUID(),title:'新对话',createdAt:now(),updatedAt:now(),messages:[]};}
function usageNumbers(value) {
  if(!value||typeof value!=='object')return null;
  const result={};for(const field of ['input_tokens','output_tokens','total_tokens','prompt_tokens','completion_tokens'])if(Number.isFinite(value[field])&&value[field]>=0)result[field]=value[field];
  return result;
}

class AIService {
  constructor({directory,secretStorage,fetchImpl=fetch,getPetName=()=> '喵喵',onEvent=()=>{}}) {
    this.directory=directory;this.crypto=secretStorage;this.fetchImpl=fetchImpl;this.getPetName=getPetName;this.onEvent=onEvent;
    this.writes=Promise.resolve();this.configWrites=Promise.resolve();this.active=null;this.revision=0;
    this.config={version:1,selectedProvider:'deepseek',profiles:Object.fromEntries(PROVIDERS.map(p=>[p.id,normalizeProfile(p.id)])),preferences:{...DEFAULT_PREFERENCES}};
    this.secrets={version:1,keys:{}};const first=conversation();this.history={version:1,currentId:first.id,conversations:[first]};
    this.ready=this.load();this.ready.catch(()=>{});
  }
  emit(event){try{this.onEvent(event);}catch{ /* A closed UI must not interrupt persistence. */ }}
  async read(name,fallback) {
    try{return JSON.parse(await fs.readFile(path.join(this.directory,name),'utf8'));}
    catch(error){if(error.code==='ENOENT')return fallback;throw new Error(name+' 无法读取，请保留原文件并从备份恢复；原文件未被覆盖');}
  }
  async load() {
    const [config,secrets,history]=await Promise.all([this.read('ai-settings.json',null),this.read('ai-secrets.json',null),this.read('chat-history.json',null)]);
    if(config){this.config.preferences=preferences(config.preferences);for(const p of PROVIDERS)this.config.profiles[p.id]=normalizeProfile(p.id,config.profiles?.[p.id]);if(PROVIDERS.some(p=>p.id===config.selectedProvider))this.config.selectedProvider=config.selectedProvider;}
    if(secrets){if(!secrets.keys||typeof secrets.keys!=='object')throw new Error('密钥文件格式错误，原文件未被覆盖');this.secrets=secrets;}
    if(history){
      if(!Array.isArray(history.conversations)||!history.conversations.length||history.conversations.some(c=>!c.id||!Array.isArray(c.messages)))throw new Error('聊天记录格式错误，原文件未被覆盖');
      this.history=history;
      for(const c of history.conversations)for(const m of c.messages)if(m.status==='generating'){m.status='stopped';m.error='上次回复被中断，可重新回答';}
      if(!history.conversations.some(c=>c.id===history.currentId))history.currentId=history.conversations[0].id;
    }
    this.encryptionAvailable=await this.crypto.isAsyncEncryptionAvailable().catch(()=>false);
  }
  write(name,value) {
    const data=JSON.stringify(value,null,2)+'\n',target=path.join(this.directory,name);
    const task=this.writes.catch(()=>{}).then(async()=>{await fs.mkdir(this.directory,{recursive:true});await fs.writeFile(target+'.tmp',data,{mode:0o600});await fs.rename(target+'.tmp',target);});
    this.writes=task;return task;
  }
  current(){return this.history.conversations.find(c=>c.id===this.history.currentId);}
  publicConfig() {
    return {selectedProvider:this.config.selectedProvider,preferences:clone(this.config.preferences),encryptionAvailable:!!this.encryptionAvailable,
      profiles:Object.fromEntries(PROVIDERS.map(p=>[p.id,{...this.config.profiles[p.id],hasKey:!!this.secrets.keys[p.id]?.encrypted}]))};
  }
  snapshot() {
    return {revision:this.revision,config:this.publicConfig(),providers:PROVIDERS,conversation:clone(this.current()),
      conversations:this.history.conversations.map(c=>({id:c.id,title:c.title,updatedAt:c.updatedAt})),
      active:this.active?{conversationId:this.active.conversationId,messageId:this.active.message.id,requestId:this.active.id}:null};
  }
  stateChanged(){this.revision++;this.emit({type:'state',state:this.snapshot()});}
  async getConfig(){await this.ready;return {config:this.publicConfig(),providers:PROVIDERS};}
  async getState(){await this.ready;return this.snapshot();}
  async saveConfig(payload) {
    const task=this.configWrites.catch(()=>{}).then(async()=>{
      await this.ready;
      this.ensureIdle();
      if(!payload||!PROVIDERS.some(p=>p.id===payload.provider))throw new Error('请选择 AI 厂商');
      const id=payload.provider,profile=normalizeProfile(id,{...this.config.profiles[id],...payload.profile});
      const newKey=typeof payload.apiKey==='string'?payload.apiKey.trim():'';
      if(newKey.length>8192||/[\r\n\x00-\x20]/.test(newKey))throw new Error('密钥中不能包含空格、换行或控制字符');
      const keys={...this.secrets.keys},origin=profile.baseURL?new URL(profile.baseURL).origin:'';
      if(payload.removeKey||keys[id]?.origin!==origin)delete keys[id];
      if(newKey){
        if(!origin)throw new Error('保存密钥前请填写服务地址');
        if(!await this.crypto.isAsyncEncryptionAvailable())throw new Error('Windows 本机加密暂时不可用，密钥没有保存，请稍后重试');
        this.encryptionAvailable=true;
        let encrypted;try{encrypted=await this.crypto.encryptStringAsync(newKey);}catch{throw new Error('密钥加密失败，未保存明文，请稍后重试');}
        keys[id]={origin,encrypted:encrypted.toString('base64')};
      }
      const next={version:1,selectedProvider:id,profiles:{...this.config.profiles,[id]:profile},preferences:preferences(payload.preferences??this.config.preferences)};
      const secrets={version:1,keys};
      await this.write('ai-secrets.json',secrets);await this.write('ai-settings.json',next);
      this.secrets=secrets;this.config=next;this.revision++;this.emit({type:'config',config:this.publicConfig(),revision:this.revision});return this.publicConfig();
    });
    this.configWrites=task;return task;
  }
  async credential(id,profile) {
    const item=this.secrets.keys[id];
    if(!item?.encrypted||!profile.baseURL||item.origin!==new URL(profile.baseURL).origin)throw new Error('请先在设置中填写此服务的 API Key；更换服务域名后需要重新填写');
    try{return (await this.crypto.decryptStringAsync(Buffer.from(item.encrypted,'base64'))).result;}
    catch{throw new Error('此密钥无法在当前 Windows 用户下解密，请到设置中重新填写');}
  }
  async draft(payload) {
    await this.ready;const id=payload?.provider||this.config.selectedProvider;
    const profile=normalizeProfile(id,{...this.config.profiles[id],...payload?.profile});
    let key=typeof payload?.apiKey==='string'?payload.apiKey.trim():'';
    if(key.length>8192||/[\r\n\x00-\x20]/.test(key))throw new Error('密钥格式不正确');
    if(!key)key=await this.credential(id,profile);
    return {id,profile,key};
  }
  async testConnection(payload) {
    const {profile,key}=await this.draft(payload);
    try{const result=await streamReply({profile,key,messages:[{role:'user',content:'请只回复：连接成功'}],system:'这是一次连接测试，请简短回答。',maxTokens:512,signal:AbortSignal.timeout(25000),fetchImpl:this.fetchImpl});return {ok:true,message:'连接成功，模型已返回文字',reply:cleanReply(redact(result.text,key),true).text.slice(0,120)};}
    catch(error){throw new Error(this.friendlyError(error,key));}
  }
  async models(payload) {
    const {profile,key}=await this.draft(payload);
    try{return (await listModels({profile,key,signal:AbortSignal.timeout(20000),fetchImpl:this.fetchImpl})).filter(id=>!id.includes(key));}
    catch(error){throw new Error(this.friendlyError(error,key));}
  }
  async selectProvider(id) {
    await this.ready;if(this.active)throw new Error('请先停止当前回复');
    if(!PROVIDERS.some(p=>p.id===id))throw new Error('未知厂商');
    await this.saveConfig({provider:id});return this.snapshot();
  }
  ensureIdle(){if(this.active)throw new Error('请先停止当前回复，再修改设置或管理记录');}
  async mutateHistory(change) {
    const previous=clone(this.history);change();
    try{await this.write('chat-history.json',this.history);}catch{this.history=previous;throw new Error('记录保存失败，更改未生效，请检查磁盘空间');}
    this.stateChanged();return this.snapshot();
  }
  async newConversation() {
    await this.ready;this.ensureIdle();if(this.history.conversations.length>=100)throw new Error('已保存 100 个对话，请清理不再需要的对话后再新建');
    const c=conversation();return this.mutateHistory(()=>{this.history.conversations.unshift(c);this.history.currentId=c.id;});
  }
  async selectConversation(id) {
    await this.ready;this.ensureIdle();if(!this.history.conversations.some(c=>c.id===id))throw new Error('找不到该对话');
    return this.mutateHistory(()=>{this.history.currentId=id;});
  }
  async clearConversation() {
    await this.ready;this.ensureIdle();return this.mutateHistory(()=>{const c=this.current();c.messages=[];c.title='新对话';c.updatedAt=now();});
  }
  async deleteConversation() {
    await this.ready;this.ensureIdle();return this.mutateHistory(()=>{const id=this.history.currentId;this.history.conversations=this.history.conversations.filter(c=>c.id!==id);
      if(!this.history.conversations.length)this.history.conversations=[conversation()];this.history.currentId=this.history.conversations[0].id;});
  }
  persona(name) {
    return buildPersona(name,this.config.preferences);
  }
  friendlyError(error,key='') {
    if(error?.name==='TimeoutError')return '连接超时，请检查网络或代理后重试';
    if(error?.name==='TypeError'||error?.message==='fetch failed')return '连接服务失败，请检查 API 地址、网络或系统代理';
    return redact(error?.message||'请求失败，请稍后重试',key).slice(0,350);
  }
  async send({text='',regenerate=false}={}) {
    await this.ready;this.ensureIdle();const id=this.config.selectedProvider,profile=clone(this.config.profiles[id]);
    const key=await this.credential(id,profile);this.ensureIdle();
    if(!profile.model)throw new Error('请先在设置中填写模型名称');
    const c=this.current();let backup=null;
    if(regenerate){
      const last=c.messages.at(-1);
      if(last?.role==='assistant')backup=c.messages.pop();
      if(c.messages.at(-1)?.role!=='user'){if(backup)c.messages.push(backup);throw new Error('当前没有可重新回答的问题');}
    } else {
      text=String(text).trim();if(!text||text.length>10000)throw new Error('请输入 1–10000 个字符');
      if(c.messages.length>=1000)throw new Error('当前对话已达 1000 条，请新建对话');
      c.messages.push({id:randomUUID(),role:'user',content:text,at:now(),status:'complete'});
      if(c.title==='新对话')c.title=text.replace(/\s+/g,' ').slice(0,24);
    }
    const context=buildContext(c.messages,this.config.preferences.contextTurns),petName=this.getPetName();
    const message={id:randomUUID(),role:'assistant',content:'',at:now(),status:'generating',provider:id,model:profile.model,petName};c.messages.push(message);c.updatedAt=now();
    const active={id:randomUUID(),conversationId:c.id,message,controller:new AbortController(),backup,preferences:clone(this.config.preferences)};
    this.active=active;this.stateChanged();
    active.promise=this.run(active,c,profile,key,context,this.persona(petName));active.promise.catch(()=>{});
    return this.snapshot();
  }
  async run(active,c,profile,key,context,system) {
    let raw='',emotion='neutral',lastEmit=0,pendingTimer;
    const publish=()=>{clearTimeout(pendingTimer);pendingTimer=null;lastEmit=Date.now();this.emit({type:'delta',conversationId:c.id,messageId:active.message.id,text:active.message.content,emotion});};
    const timeout=setTimeout(()=>{active.timedOut=true;active.controller.abort();},120000);timeout.unref?.();
    try {
      await this.write('chat-history.json',this.history);
      const result=await streamReply({profile,key,messages:context,system,maxTokens:active.preferences.maxTokens,signal:active.controller.signal,fetchImpl:this.fetchImpl,
        onText:value=>{raw=value;const reply=cleanReply(streamSafeText(value,key));active.message.content=reply.text;emotion=reply.emotion;if(Date.now()-lastEmit>70)publish();else if(!pendingTimer)pendingTimer=setTimeout(publish,70);},
        onThinking:()=>{if(!active.thinking&&!active.message.content){active.thinking=true;this.emit({type:'thinking',messageId:active.message.id});}}});
      const reply=cleanReply(redact(result.text,key),true);reply.text=finishPersonaReply(reply.text);active.message.content=reply.text;emotion=reply.emotion;active.message.status='complete';active.message.usage=usageNumbers(result.usage);
      if(result.limited)active.message.error='已达到本次回复长度上限';
      publish();this.emit({type:'reply',text:reply.text,emotion,bubbles:active.preferences.bubbles,emotions:active.preferences.emotions});
    } catch(error) {
      const stopped=active.controller.signal.aborted&&!active.timedOut;
      active.message.content=cleanReply(redact(raw,key),true).text;active.message.status=stopped?'stopped':'error';
      active.message.error=stopped?'已停止生成':active.timedOut?'请求超过两分钟，请重试或缩短回复':this.friendlyError(error,key);
      if(active.backup&&!active.message.content){c.messages.pop();c.messages.push(active.backup);this.emit({type:'notice',message:active.message.error});}
      publish();
    } finally {
      clearTimeout(timeout);clearTimeout(pendingTimer);key='';c.updatedAt=now();
      try{await this.write('chat-history.json',this.history);}catch{this.emit({type:'notice',message:'聊天记录保存失败，请检查磁盘空间'});}
      if(this.active===active)this.active=null;this.stateChanged();
    }
  }
  async stop(){await this.ready;if(this.active){const active=this.active;active.controller.abort();await active.promise;}return this.snapshot();}
  async exportConversation(){await this.ready;return clone(this.current());}
  async shutdown(){if(this.active){this.active.controller.abort();await this.active.promise;}await this.writes.catch(()=>{});await this.configWrites.catch(()=>{});}
}
module.exports={AIService,DEFAULT_PREFERENCES,EMOTIONS,cleanReply,buildContext,streamSafeText};

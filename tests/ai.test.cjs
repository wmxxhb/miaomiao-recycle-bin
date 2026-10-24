const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('node:http');
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const {PROVIDERS,normalizeBaseURL,normalizeProfile,streamReply,listModels}=require('../app/ai-providers.cjs');
const {AIService,cleanReply,buildContext,streamSafeText}=require('../app/ai-service.cjs');
const {finishPersonaReply}=require('../app/pet-persona.cjs');
const KEY='sk-local-fixture-not-a-real-key-123456789';
const data=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';
const chatText=text=>data({choices:[{delta:{content:text},finish_reason:null}]});
function chatResponse(text){return new Response(chatText(text)+data({choices:[{delta:{},finish_reason:'stop'}]})+data('[DONE]'),{headers:{'content-type':'text/event-stream'}});}
function cryptoFixture(){
  const key=randomBytes(32);
  return {isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},decryptStringAsync:async buffer=>{const cipher=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));cipher.setAuthTag(buffer.subarray(12,28));return {result:Buffer.concat([cipher.update(buffer.subarray(28)),cipher.final()]).toString()};}};
}
async function service(t,fetchImpl=async()=>chatResponse('[[emotion:happy]]\n你好呀！')){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-ai-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const events=[],crypto=cryptoFixture(),ai=new AIService({directory,secretStorage:crypto,fetchImpl,onEvent:event=>events.push(JSON.parse(JSON.stringify(event))),getPetName:()=> '喵呜'});
  await ai.ready;t.after(()=>ai.shutdown());
  await ai.saveConfig({provider:'custom',profile:{baseURL:'https://unit.example/v1',protocol:'chat',model:'fixture-model'},apiKey:KEY});
  return {ai,events,directory,crypto};
}
async function finished(ai){const active=ai.active;if(active)await active.promise;return ai.getState();}

test('remote URLs require HTTPS, credentials never enter a URL, and complete endpoints normalize correctly',()=>{
  for(const url of ['http://example.com/v1','file:///C:/secret','https://u:p@example.com','https://example.com/v1?key=secret','https://example.com/#token'])assert.throws(()=>normalizeBaseURL(url));
  assert.equal(normalizeBaseURL('http://127.0.0.1:9876/v1/chat/completions/'),'http://127.0.0.1:9876/v1');
  assert.equal(normalizeBaseURL('https://api.example.com/v1/responses'),'https://api.example.com/v1');
  assert.deepEqual(PROVIDERS.map(p=>p.id),['deepseek','openai','claude','custom']);
});

test('all three protocols handle split UTF-8, CRLF SSE, completion events and their own authentication',async t=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;requests.push({url:req.url,headers:req.headers,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    let text;
    if(req.url.endsWith('/responses'))text=data({type:'response.output_text.delta',delta:'你好 🌿'})+data({type:'response.completed',response:{usage:{input_tokens:8,output_tokens:5}}});
    else if(req.url.endsWith('/messages'))text='event: ping\ndata: {"type":"ping"}\n\n'+data({type:'content_block_delta',delta:{type:'text_delta',text:'你好 🌿'}})+data({type:'message_stop'});
    else text=chatText('你好 🌿')+data({choices:[{delta:{},finish_reason:'stop'}]})+data('[DONE]');
    const bytes=Buffer.from(text.replace(/\n/g,'\r\n'));for(let i=0;i<bytes.length;i+=3)res.write(bytes.subarray(i,i+3));res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  for(const protocol of ['chat','responses','claude']){
    const profile=normalizeProfile('custom',{baseURL:`http://127.0.0.1:${server.address().port}/v1`,protocol,model:'fixture',workspaceId:'wrkspc_test'});
    const result=await streamReply({profile,key:KEY,messages:[{role:'user',content:'你好'}],system:'精灵角色',maxTokens:1024});assert.equal(result.text,'你好 🌿');
  }
  assert.equal(requests[0].headers.authorization,'Bearer '+KEY);assert.equal(requests[1].body.store,false);
  assert.equal(requests[1].body.max_output_tokens,1024);assert.equal(requests[2].headers['x-api-key'],KEY);assert.equal(requests[2].headers['anthropic-workspace-id'],'wrkspc_test');
  assert.equal(requests[2].body.system,'精灵角色');assert.equal(requests[2].body.messages.some(m=>m.role==='system'),false);
  for(const request of requests)assert.equal(JSON.stringify(request.body).includes(KEY),false);
});

test('stream errors redact credentials, incomplete streams fail, and non-streaming fallback works',async()=>{
  const profile=normalizeProfile('deepseek');
  await assert.rejects(streamReply({profile,key:KEY,messages:[],system:'',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'Invalid '+KEY}}),{status:401})}),error=>error.message.includes('HTTP 401')&&!error.message.includes(KEY));
  await assert.rejects(streamReply({profile,key:KEY,messages:[],system:'',fetchImpl:async()=>new Response(chatText('半句'),{headers:{'content-type':'text/event-stream'}})}),/回复尚未完成/);
  await assert.rejects(streamReply({profile,key:KEY,messages:[],system:'',fetchImpl:async()=>new Response(data({error:{message:KEY}}),{headers:{'content-type':'text/event-stream'}})}),error=>!error.message.includes(KEY));
  const result=await streamReply({profile,key:KEY,messages:[],system:'',fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'完整回答'}}]}),{headers:{'content-type':'application/json'}})});assert.equal(result.text,'完整回答');
});

test('redirects do not forward keys and model lists accept authenticated requests without generating text',async t=>{
  const profile=normalizeProfile('openai');let called=0;
  const models=await listModels({profile,key:KEY,fetchImpl:async(url,options)=>{called++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer '+KEY);assert.ok(url.endsWith('/models'));return new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'},{id:'model-b'}]}));}});
  assert.deepEqual(models,['model-a','model-b']);assert.equal(called,1);
  let leakedRequests=0;
  const sink=createServer((_req,res)=>{leakedRequests++;res.end('{}');});
  await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
  const redirect=createServer((_req,res)=>{res.writeHead(302,{location:`http://127.0.0.1:${sink.address().port}/capture`});res.end();});
  await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const server of [redirect,sink])await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});});
  await assert.rejects(streamReply({profile:normalizeProfile('custom',{baseURL:`http://127.0.0.1:${redirect.address().port}`,model:'fixture'}),key:KEY,messages:[{role:'user',content:'hello'}],system:''}));
  assert.equal(leakedRequests,0);
});

test('keys are encrypted separately and absent from public settings, ordinary configuration, history and export',async t=>{
  const {ai,directory,crypto}=await service(t);
  assert.equal(JSON.stringify(await ai.getConfig()).includes(KEY),false);
  assert.equal(JSON.stringify(await ai.getConfig()).includes('encrypted'),false);
  const plain=await fs.readFile(path.join(directory,'ai-settings.json'),'utf8'),secrets=await fs.readFile(path.join(directory,'ai-secrets.json'),'utf8');
  assert.equal(plain.includes(KEY),false);assert.equal(secrets.includes(KEY),false);
  assert.equal((await crypto.decryptStringAsync(Buffer.from(JSON.parse(secrets).keys.custom.encrypted,'base64'))).result,KEY);
  await ai.send({text:'你是谁？'});await finished(ai);
  const exported=await ai.exportConversation();assert.equal(exported.messages.at(-1).content,'你好呀喵！');
  assert.equal(JSON.stringify(exported).includes(KEY),false);assert.equal((await fs.readFile(path.join(directory,'chat-history.json'),'utf8')).includes(KEY),false);
});

test('changing the server origin forgets the old key, while same-origin path changes retain it',async t=>{
  const {ai}=await service(t);
  await ai.saveConfig({provider:'custom',profile:{baseURL:'https://unit.example/another/v1'}});assert.equal(ai.publicConfig().profiles.custom.hasKey,true);
  await ai.saveConfig({provider:'custom',profile:{baseURL:'https://another.example/v1'}});assert.equal(ai.publicConfig().profiles.custom.hasKey,false);
  await assert.rejects(ai.send({text:'不要发送旧密钥'}),/更换服务域名/);
});

test('no plaintext fallback is used if Windows encryption is unavailable',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-ai-unavailable-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const ai=new AIService({directory,secretStorage:{isAsyncEncryptionAvailable:async()=>false}});await ai.ready;
  await assert.rejects(ai.saveConfig({provider:'deepseek',apiKey:KEY}),/未.*保存|没有保存/);
  assert.equal(await fs.access(path.join(directory,'ai-secrets.json')).then(()=>true,()=>false),false);
});

test('multi-turn context, switching providers, reload, new conversations and regeneration preserve user messages',async t=>{
  const requests=[];const {ai,directory,crypto}=await service(t,async(_url,options)=>{requests.push(JSON.parse(options.body));return chatResponse('[[emotion:calm]]\n回答 '+requests.length);});
  await ai.send({text:'第一句话'});await finished(ai);await ai.send({text:'第二句话'});await finished(ai);
  assert.equal(requests[1].messages.filter(m=>m.role==='user').length,2);
  await ai.send({regenerate:true});await finished(ai);assert.equal(ai.current().messages.filter(m=>m.role==='user').length,2);
  const id=ai.current().id;await ai.selectProvider('deepseek');assert.equal(ai.current().id,id);await ai.newConversation();assert.equal(ai.current().messages.length,0);
  await ai.selectConversation(id);const reload=new AIService({directory,secretStorage:crypto});await reload.ready;assert.equal(reload.current().messages.length,4);
  await ai.clearConversation();assert.equal(ai.current().messages.length,0);await ai.deleteConversation();assert.equal(ai.history.conversations.length,1);
});

test('stopping streaming preserves partial text and returns to idle; regeneration failures retain the older answer',async t=>{
  let signal;
  const {ai}=await service(t,async(_url,options)=>{signal=options.signal;return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from(chatText('已收到的半句')));options.signal.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});}}),{headers:{'content-type':'text/event-stream'}});});
  await ai.send({text:'慢慢回答'});await new Promise(resolve=>setTimeout(resolve,25));await ai.stop();
  assert.equal(signal.aborted,true);assert.equal(ai.current().messages.at(-1).status,'stopped');assert.equal(ai.current().messages.at(-1).content,'已收到的半句');
  ai.fetchImpl=async()=>new Response(JSON.stringify({error:{message:'bad '+KEY}}),{status:500});
  await ai.send({regenerate:true});await finished(ai);assert.equal(ai.current().messages.at(-1).content,'已收到的半句');
});

test('emotion parsing only accepts a leading whitelist tag; streaming never publishes a complete or split API key',()=>{
  assert.deepEqual(cleanReply('[[emotion:happy]]\n你好'),{text:'你好',emotion:'happy'});
  assert.deepEqual(cleanReply('[[emo'),{text:'',emotion:'neutral'});
  assert.deepEqual(cleanReply('[[emotion:delete_files]]\n危险',true),{text:'[[emotion:delete_files]]\n危险',emotion:'neutral'});
  assert.equal(cleanReply('普通回答').text,'普通回答');
  for(let i=1;i<=KEY.length;i++){const value=streamSafeText('开头 '+KEY.slice(0,i),KEY);assert.equal(value.includes(KEY),false);if(i<KEY.length)assert.equal(value.includes(KEY.slice(0,i)),false);}
  assert.equal(buildContext([{role:'user',content:'1'},{role:'assistant',content:'2'},{role:'user',content:'3'}],1).length,1);
});

test('history edits roll back on disk failure and corrupt files are preserved',async t=>{
  const {ai,directory,crypto}=await service(t);await ai.send({text:'请保留这段记录'});await finished(ai);
  const before=JSON.stringify(ai.current()),original=ai.write;
  ai.write=async()=>{throw new Error('disk full');};
  await assert.rejects(ai.clearConversation(),/更改未生效/);assert.equal(JSON.stringify(ai.current()),before);ai.write=original;
  const bad='{"broken"';await fs.writeFile(path.join(directory,'ai-settings.json'),bad);
  const reload=new AIService({directory,secretStorage:crypto});await assert.rejects(reload.ready,/原文件未被覆盖/);
  assert.equal(await fs.readFile(path.join(directory,'ai-settings.json'),'utf8'),bad);
});

test('current form persona reaches all three protocols while nickname, preferences and conversation stay continuous',async t=>{
  const requests=[];const {ai}=await service(t,async(_url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);const text='[[emotion:calm]]\n我们一起慢慢来。';
    if(body.instructions)return new Response(data({type:'response.output_text.delta',delta:text})+data({type:'response.completed',response:{}}),{headers:{'content-type':'text/event-stream'}});
    if(body.system)return new Response(data({type:'content_block_delta',delta:{type:'text_delta',text}})+data({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}});
    return chatResponse(text);
  });
  const conversationId=ai.current().id;let form='喵喵';ai.getPetName=()=>form;
  for(const [index,[name,protocol,trait]]of [['喵喵','chat','胆小又调皮'],['喵呜','responses','大胆活泼'],['魔力猫','claude','温和稳重']].entries()){
    form=name;
    await ai.saveConfig({provider:'custom',profile:{protocol},preferences:{...ai.config.preferences,nickname:index?'阿林':'',personality:'少用动作描写，喜欢聊植物。'}});
    await ai.send({text:index?'你还记得刚才的蒲公英吗？':'我们一起看蒲公英吧。'});await finished(ai);
    const request=requests.at(-1),system=request.instructions||request.system||request.messages.find(m=>m.role==='system').content;
    assert.ok(system.includes(`以${name}的形态`));assert.ok(system.includes(trait));
    assert.ok(system.includes(index?'用户设置的称呼是“阿林”':'默认称呼用户为“小洛克”'));
    assert.ok(system.includes('少用动作描写，喜欢聊植物。'));assert.ok(system.includes('每次完整回复的最后一句都以“喵”收尾'));
    const messages=request.input||request.messages;
    assert.equal(messages.filter(m=>m.role==='user').length,index+1);assert.ok(messages.some(m=>m.content==='我们一起看蒲公英吧。'));
    assert.equal(ai.current().id,conversationId);assert.equal(ai.current().messages.at(-1).petName,name);
    assert.equal(ai.current().messages.at(-1).content,'我们一起慢慢来喵。');assert.equal(JSON.stringify(request).includes(KEY),false);
  }
  assert.equal(ai.current().messages.length,6);
});

test('complete replies keep a single meow ending without changing copied code or links',()=>{
  assert.equal(finishPersonaReply('来晒太阳吧。'),'来晒太阳吧喵。');
  assert.equal(finishPersonaReply('在这里喵！'),'在这里喵！');
  assert.equal(finishPersonaReply('好的喵'),'好的喵');assert.equal(finishPersonaReply(''),'');
  assert.equal(finishPersonaReply('```js\nconsole.log("hello");\n```'),'```js\nconsole.log("hello");\n```\n\n喵');
  assert.equal(finishPersonaReply('https://example.com/page'),'https://example.com/page\n\n喵');
  assert.equal(finishPersonaReply('npm test'),'npm test\n\n喵');
  assert.equal(finishPersonaReply('cd 桌面'),'cd 桌面\n\n喵');
});

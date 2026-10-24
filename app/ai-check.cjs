const fs=require('node:fs/promises');
const path=require('node:path');
const {createServer}=require('node:http');
const FIXTURE_KEY='sk-local-fixture-not-a-real-key-123456789';
const packet=value=>'data: '+JSON.stringify(value)+'\n\n';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(40);}throw new Error('AI integration timeout: '+label);}
async function windowReady(window,ai=false){await waitFor(()=>window.webContents.executeJavaScript(`document.documentElement.dataset.${ai?'aiReady':'ready'}==='true'`),'window ready');}

async function checkAI({win,ai,desktopChat,mover,choose,openSettings,openChat,getSettings,getChat,output}) {
  await ai.ready;await ai.stop();await ai.clearConversation();
  const requests=[];let redirectedToSink=0;
  const server=createServer(async(req,res)=>{
    if(req.url==='/capture'){redirectedToSink++;res.end('{}');return;}
    if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-model'},{id:'fixture-model-2'}]}));return;}
    let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);requests.push({route:req.url,headers:req.headers,body:value});
    if(req.url.includes('/redirect/')){res.writeHead(302,{location:`http://127.0.0.1:${server.address().port}/capture`});res.end();return;}
    const source=value.messages||value.input||[],user=source.filter(m=>m.role==='user').at(-1)?.content||'';
    res.writeHead(200,{'content-type':'text/event-stream'});
    let answer='[[emotion:happy]]\n很高兴见到你！今天想和我聊点什么？';
    if(user.includes('验证文字显示'))answer='[[emotion:calm]]\n<img src=x onerror="globalThis.injected=true"> 这是一段普通文字。';
    if(user.includes('验证密钥隐藏'))answer='[[emotion:calm]]\n测试回显 '+FIXTURE_KEY+'，密钥应该被隐藏。';
    if(user.includes('慢慢回答'))answer='[[emotion:calm]]\n我正在慢慢回答，你可以随时停止生成。'.repeat(8);
    if(user.includes('长回复'))answer='[[emotion:calm]]\n'+Array.from({length:18},(_,i)=>`第 ${i+1} 段：今天也想和你一起看看窗外，聊聊遇到的小事。无论是开心的事情，还是让你烦恼的问题，都可以慢慢告诉我。`).join('\n\n');
    const parts=Array.from(answer).reduce((all,ch,i)=>{if(i%5===0)all.push('');all[all.length-1]+=ch;return all;},[]);
    let index=0;
    const timer=setInterval(()=>{
      if(index<parts.length){const text=parts[index++];if(req.url.endsWith('/responses'))res.write(packet({type:'response.output_text.delta',delta:text}));else if(req.url.endsWith('/messages'))res.write(packet({type:'content_block_delta',delta:{type:'text_delta',text}}));else res.write(packet({choices:[{delta:{content:text},finish_reason:null}]}));}
      else {
        clearInterval(timer);
        if(req.url.endsWith('/responses'))res.write(packet({type:'response.completed',response:{usage:{input_tokens:20,output_tokens:30}}}));
        else if(req.url.endsWith('/messages'))res.write(packet({type:'message_stop'}));
        else res.write(packet({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n');res.end();
      }
    },user.includes('慢慢回答')?120:user.includes('长回复')?1:25);
    res.on('close',()=>clearInterval(timer));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=`http://127.0.0.1:${server.address().port}/v1`;
  const report={localFixtureOnly:true,realVendorCredentialsUsed:false,protocols:[]};
  try {
    await waitFor(()=>win.webContents.executeJavaScript(`typeof window.petReady==='function'`),'pet bootstrap');
    await win.webContents.executeJavaScript('window.petReady(0)');
    openSettings();let settings=getSettings();await windowReady(settings,true);
    async function configure(provider,protocol){
      await settings.webContents.executeJavaScript(`(()=>{const $=id=>document.getElementById(id);$('ai-provider').value=${JSON.stringify(provider)};$('ai-provider').dispatchEvent(new Event('change'));$('ai-base-url').value=${JSON.stringify(baseURL)};$('ai-protocol').value=${JSON.stringify(protocol)};$('ai-protocol').dispatchEvent(new Event('change'));$('ai-model').value='fixture-model';$('ai-api-key').value=${JSON.stringify(FIXTURE_KEY)};$('ai-form').requestSubmit();})()`);
      await waitFor(()=>ai.publicConfig().selectedProvider===provider&&ai.publicConfig().profiles[provider].hasKey&&ai.publicConfig().profiles[provider].protocol===protocol,'save '+provider);
      await waitFor(()=>settings.webContents.executeJavaScript(`document.getElementById('ai-api-key').value===''`),'clear key field');
    }
    await configure('deepseek','chat');
    report.passwordInput=await settings.webContents.executeJavaScript(`document.getElementById('ai-api-key').type==='password'&&document.getElementById('ai-api-key').value===''`);
    await settings.webContents.executeJavaScript(`document.getElementById('ai-models').click()`);
    await waitFor(()=>settings.webContents.executeJavaScript(`document.getElementById('ai-status').textContent.includes('已获取 2')`),'models');
    await settings.webContents.executeJavaScript(`document.getElementById('ai-test').click()`);
    await waitFor(()=>settings.webContents.executeJavaScript(`document.getElementById('ai-status').textContent.includes('连接成功')`),'test connection');
    report.connectionAndModels=true;
    await settings.webContents.executeJavaScript(`document.getElementById('ai-settings').scrollIntoView({block:'start'})`);await pause(100);
    await fs.writeFile(path.join(output,'ai-settings.png'),(await settings.webContents.capturePage()).toPNG());
    openChat();await windowReady(getChat());
    async function start(text){
      await win.webContents.executeJavaScript(`document.getElementById('scene').dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}));`);
      await waitFor(()=>desktopChat.getWindow('input')?.isVisible(),'right click opens input');
      const input=desktopChat.getWindow('input');await windowReady(input);
      await input.webContents.executeJavaScript(`(()=>{const e=document.getElementById('input');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input'));document.getElementById('composer').requestSubmit();})()`);
      await waitFor(()=>!!ai.active,'send starts');await waitFor(()=>!ai.active,'send finishes');
    }
    async function send(text){
      await start(text);
      if(ai.current().messages.at(-1)?.status!=='complete')throw new Error('AI reply failed: '+JSON.stringify(ai.current().messages.at(-1)));
      await pause(90);
    }
    const personaForms=[];
    for(const [index,[provider,protocol]]of [['deepseek','chat'],['openai','responses'],['claude','claude']].entries()){
      if(provider!=='deepseek')await configure(provider,protocol);
      await choose({mode:'manual',manualForm:index});await win.webContents.executeJavaScript(`window.petReady(${index})`);
      await win.webContents.executeJavaScript('window.petActionTest.idle()');
      await send('你好，'+provider);
      const last=requests.at(-1);if(protocol==='claude'?last.headers['x-api-key']!==FIXTURE_KEY:last.headers.authorization!=='Bearer '+FIXTURE_KEY)throw new Error('Provider authentication mismatch');
      if(JSON.stringify(last.body).includes(FIXTURE_KEY))throw new Error('Key leaked into model messages');
      const system=last.body.instructions||last.body.system||last.body.messages.find(m=>m.role==='system').content;
      const name=['喵喵','喵呜','魔力猫'][index];
      if(!system.includes(`以${name}的形态`)||!system.includes('每次完整回复的最后一句都以“喵”收尾'))throw new Error('Current persona missing from provider request');
      if(!/喵[。.!！？?~～…]*$/u.test(ai.current().messages.at(-1).content))throw new Error('Complete reply did not end in meow');
      personaForms.push(name);
      report.protocols.push({provider,protocol,route:last.route,reply:true});
    }
    report.currentFormPersonaInRequests=personaForms.length===3;report.personaForms=personaForms;
    report.meowEndingInBubble=await desktopChat.getWindow('bubble').webContents.executeJavaScript(`/喵[。.!！？?~～…]*$/u.test(document.getElementById('reply').textContent)`);
    report.chatEmotion=await win.webContents.executeJavaScript(`window.petActionStatus().source==='chat'`);
    report.comicBubble=await desktopChat.getWindow('bubble').webContents.executeJavaScript(`document.getElementById('reply').textContent.includes('很高兴')&&document.querySelectorAll('.speech').length===1`);
    if(!report.chatEmotion)throw new Error('Desktop chat emotion/bubble did not trigger');
    await fs.writeFile(path.join(output,'ai-chat.png'),(await getChat().webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(output,'ai-pet.png'),(await win.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(output,'ai-bubble.png'),(await desktopChat.getWindow('bubble').webContents.capturePage()).toPNG());
    await choose({mode:'manual',manualForm:0});await win.webContents.executeJavaScript('window.petReady(0)');
    const beforeSwitch=ai.current().messages.length;
    for(const id of ['openai','claude']){
      await getChat().webContents.executeJavaScript(`(()=>{const e=document.getElementById('provider');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change'));})()`);
      await waitFor(()=>ai.publicConfig().selectedProvider===id,'chat provider switch');
      await waitFor(()=>getChat().webContents.executeJavaScript(`!document.getElementById('provider').disabled`),'provider controls');
    }
    report.providerSwitchKeepsHistory=ai.current().messages.length===beforeSwitch;
    const shape=await getChat().webContents.executeJavaScript(`window.pet.aiConfig()`);
    report.rendererHasNoKey=!JSON.stringify(shape).includes(FIXTURE_KEY)&&!JSON.stringify(shape).includes('encrypted');
    report.settingsOnly=await getChat().webContents.executeJavaScript(`window.pet.aiSave({provider:'deepseek'}).then(()=>false,()=>true)`);
    report.noFileAccessFromChat=await getChat().webContents.executeJavaScript(`window.pet.feedFiles([]).then(()=>false,()=>true)`);
    report.noKeyAccessFromInput=await desktopChat.getWindow('input').webContents.executeJavaScript(`window.pet.aiConfig().then(()=>false,()=>true)`);
    report.noFileAccessFromInput=await desktopChat.getWindow('input').webContents.executeJavaScript(`window.pet.feedFiles([]).then(()=>false,()=>true)`);
    const refused=await ai.testConnection({provider:'claude',profile:{baseURL:baseURL+'/redirect'}}).then(()=>false,()=>true);
    report.redirectDoesNotForwardKey=refused&&redirectedToSink===0;
    await send('验证文字显示');
    report.textIsInert=await getChat().webContents.executeJavaScript(`!document.querySelector('#messages img,#messages script')&&!globalThis.injected&&document.getElementById('messages').textContent.includes('<img')`);
    report.bubbleTextIsInert=await desktopChat.getWindow('bubble').webContents.executeJavaScript(`!document.querySelector('#reply img,#reply script')&&!globalThis.injected&&document.getElementById('reply').textContent.includes('<img')`);
    await send('验证密钥隐藏');
    report.noKeyInChat=await getChat().webContents.executeJavaScript(`!document.body.innerText.includes(${JSON.stringify(FIXTURE_KEY)})&&document.body.innerText.includes('[密钥已隐藏]')`);
    report.noKeyInBubble=await desktopChat.getWindow('bubble').webContents.executeJavaScript(`!document.body.innerText.includes(${JSON.stringify(FIXTURE_KEY)})&&document.getElementById('reply').textContent.includes('[密钥已隐藏]')`);
    await win.webContents.executeJavaScript(`window.petActionTest.trigger('click')`);
    await send('手动动作优先');
    report.manualActionPriority=await win.webContents.executeJavaScript(`window.petActionStatus().source==='click'`);
    await desktopChat.openInput();
    await desktopChat.getWindow('input').webContents.executeJavaScript(`(()=>{const e=document.getElementById('input');e.value='慢慢回答';e.dispatchEvent(new Event('input'));document.getElementById('composer').requestSubmit();})()`);
    await waitFor(()=>ai.active&&ai.active.message.content.length>3,'partial answer');
    report.streamingInOneBubble=await desktopChat.getWindow('bubble').webContents.executeJavaScript(`document.getElementById('reply').textContent.length>0&&!document.getElementById('stop').hidden`);
    report.inputHidesOnSend=!desktopChat.getWindow('input').isVisible();
    const oldChatId=ai.current().id;getChat().close();await pause(120);openChat();await windowReady(getChat());
    report.reopenWhileGenerating=!!ai.active;
    const beforeFrames=await win.webContents.executeJavaScript('window.petFrameStats()');await pause(3000);
    const afterFrames=await win.webContents.executeJavaScript('window.petFrameStats()');
    report.fpsWhileStreaming=(afterFrames.renderedFrames-beforeFrames.renderedFrames)*1000/(afterFrames.now-beforeFrames.now);
    if(report.fpsWhileStreaming<50||afterFrames.targetFPS!==60)throw new Error('Desktop frame rate regressed while chatting');
    const stale=ai.snapshot();
    await desktopChat.getWindow('bubble').webContents.executeJavaScript(`document.getElementById('close-bubble').click()`);await waitFor(()=>!desktopChat.getWindow('bubble').isVisible(),'hide streaming bubble');
    await desktopChat.openInput();await pause(200);
    report.closedStreamingBubbleStaysClosed=!!ai.active&&!desktopChat.getWindow('bubble').isVisible();
    await desktopChat.getWindow('input').webContents.executeJavaScript(`document.getElementById('input-stop').click()`);await waitFor(()=>!ai.active,'stop');
    report.stopKeepsPartial=ai.current().messages.at(-1).status==='stopped'&&ai.current().messages.at(-1).content.length>0;
    await waitFor(()=>getChat().webContents.executeJavaScript(`document.getElementById('stop').hidden`),'stop UI');
    getChat().webContents.send('ai-update',{type:'state',state:stale});await pause(70);
    report.staleStateDoesNotRestartGeneration=await getChat().webContents.executeJavaScript(`document.getElementById('stop').hidden`);
    await getChat().webContents.executeJavaScript(`document.getElementById('regenerate').click()`);await waitFor(()=>!!ai.active,'regenerate starts');await ai.stop();
    report.regenerationNoExtraUser=ai.current().messages.filter(m=>m.role==='user'&&m.content==='慢慢回答').length===1;
    await send('请给我一个长回复');
    const speech=desktopChat.getWindow('bubble');
    await pause(250);
    report.fullReplyScrollable=await speech.webContents.executeJavaScript(`(()=>{const e=document.getElementById('reply');return e.textContent.includes('第 18 段')&&e.scrollHeight>e.clientHeight&&document.querySelectorAll('.speech').length===1;})()`);
    await speech.webContents.executeJavaScript(`document.getElementById('reply').scrollTop=0`);
    await desktopChat.openInput();
    await desktopChat.getWindow('input').webContents.executeJavaScript(`document.getElementById('input').value='这句草稿先保留';document.getElementById('input').dispatchEvent(new Event('input'));document.getElementById('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));`);
    report.imeDoesNotSend=!ai.active;
    await fs.writeFile(path.join(output,'ai-bubble-long.png'),(await speech.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(output,'ai-input.png'),(await desktopChat.getWindow('input').webContents.capturePage()).toPNG());
    await desktopChat.getWindow('input').webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    await waitFor(()=>!desktopChat.getWindow('input').isVisible(),'escape hides input');
    await desktopChat.openInput();
    report.draftSurvivesEscape=await desktopChat.getWindow('input').webContents.executeJavaScript(`document.getElementById('input').value==='这句草稿先保留'`);
    const {screen}=require('electron'),work=screen.getPrimaryDisplay().workArea;
    const beforeRender=await win.webContents.executeJavaScript('window.petRenderInfo()'),petSize=win.getSize();
    const moves=[];
    for(const location of [{x:work.x+8,y:work.y+8},{x:work.x+work.width-petSize[0]-8,y:work.y+8},{x:work.x+8,y:work.y+work.height-petSize[1]-8},{x:work.x+work.width-petSize[0]-8,y:work.y+work.height-petSize[1]-8}]){
      const point=screen.dipToScreenPoint(location);await mover.position(point.x,point.y);await pause(180);
      const b=speech.getBounds(),i=desktopChat.getWindow('input').getBounds();
      const desired=desktopChat.layout();
      const inside=r=>r.x>=work.x&&r.y>=work.y&&r.x+r.width<=work.x+work.width+1&&r.y+r.height<=work.y+work.height+1;
      if(!inside(b)||!inside(i))throw new Error('Dialogue moved outside display: '+JSON.stringify({work,b,i,pet:win.getBounds(),layout:desktopChat.layout()}));
      if(Math.abs(b.height-desired.bubble.height)>4||Math.abs(i.height-desired.input.height)>4)throw new Error('Companion content size changed during movement: '+JSON.stringify({b,i,desired,diagnostics:desktopChat.diagnostics(),render:await speech.webContents.executeJavaScript('({innerWidth,innerHeight,panel:document.getElementById("bubble").getBoundingClientRect().height})')}));
      moves.push({pet:win.getBounds(),bubble:b,input:i});
    }
    const afterRender=await win.webContents.executeJavaScript('window.petRenderInfo()');
    report.companionsFollowAtScreenEdges=moves.length===4;
    report.dialogueDoesNotResizePet=JSON.stringify(beforeRender)===JSON.stringify(afterRender)&&JSON.stringify(petSize)===JSON.stringify(win.getSize());
    report.companionBounds=moves;
    await fs.writeFile(path.join(output,'ai-bubble-after-move.png'),(await speech.webContents.capturePage()).toPNG());
    await speech.webContents.executeJavaScript(`document.getElementById('close-bubble').click()`);
    await waitFor(()=>!speech.isVisible(),'close bubble');
    await desktopChat.openInput();report.closedBubbleStaysClosed=!speech.isVisible();
    await send('关闭后再聊一句');report.newReplyOpensBubble=speech.isVisible();
    win.hide();await pause(60);report.hidePetHidesDialogue=!speech.isVisible();win.show();await pause(150);report.showPetRestoresDialogue=speech.isVisible();
    const oldPreferences={...ai.config.preferences};
    await ai.saveConfig({provider:ai.config.selectedProvider,preferences:{...oldPreferences,bubbles:false}});
    await send('关闭气泡设置');report.bubblePreferenceRespected=!speech.isVisible();
    await ai.saveConfig({provider:ai.config.selectedProvider,preferences:oldPreferences});
    await desktopChat.openInput();
    for(const scale of [.5,2]){
      await choose({scale});await pause(250);
      const before=await win.webContents.executeJavaScript('window.petRenderInfo()');
      const location=screen.dipToScreenPoint({x:work.x+12,y:work.y+12});await mover.position(location.x,location.y);await pause(150);
      const after=await win.webContents.executeJavaScript('window.petRenderInfo()');
      if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Companion movement resized pet at scale '+scale);
      const layout=desktopChat.layout();
      if(layout.bubble.x<work.x||layout.input.y<work.y)throw new Error('Scaled dialogue layout failed');
    }
    await choose({scale:1});report.companionsAt50And200Percent=true;
    await getChat().webContents.executeJavaScript(`document.getElementById('new').click()`);await waitFor(()=>ai.current().id!==oldChatId,'new conversation');
    await waitFor(()=>getChat().webContents.executeJavaScript(`!document.getElementById('conversations').disabled`),'conversation controls');
    await getChat().webContents.executeJavaScript(`(()=>{const e=document.getElementById('conversations');e.value=${JSON.stringify(oldChatId)};e.dispatchEvent(new Event('change'));})()`);await waitFor(()=>ai.current().id===oldChatId,'restore conversation');
    report.localHistory=true;
    const secrets=await fs.readFile(path.join(ai.directory,'ai-secrets.json'),'utf8');
    const config=await fs.readFile(path.join(ai.directory,'ai-settings.json'),'utf8');
    const history=await fs.readFile(path.join(ai.directory,'chat-history.json'),'utf8');
    report.osEncryptedKeyFile=!secrets.includes(FIXTURE_KEY)&&Object.values(JSON.parse(secrets).keys).every(k=>k.encrypted);
    report.noKeyInConfigurationHistoryExport=![config,history,JSON.stringify(await ai.exportConversation())].some(text=>text.includes(FIXTURE_KEY));
    for(const [key,value]of Object.entries(report))if(typeof value==='boolean'&&value===false&&key!=='realVendorCredentialsUsed')throw new Error('AI check failed: '+key);
    await fs.writeFile(path.join(output,'ai-results.json'),JSON.stringify(report,null,2));
  } finally {await ai.stop();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
}
module.exports={checkAI};

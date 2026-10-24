const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, protocol, net, screen, shell, utilityProcess, safeStorage, dialog, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FORM_NAMES, validThresholds, normalizeState, currentForm, viewState, contains, feedFiles } = require('./core.cjs');
const { notifyRemoved } = require('./shell-refresh.cjs');
const { createWindowMover } = require('./window-move.cjs');
const { AIService } = require('./ai-service.cjs');
const { createDesktopChat } = require('./desktop-chat.cjs');
const { loadAssetBundle, relativeAsset } = require('./asset-files.cjs');
const { leafPNG } = require('./tray-icon.cjs');

app.setName('喵喵回收站');
const smoke = process.argv.includes('--smoke-test');
const dragTest = process.argv.includes('--drag-test');
const dragLive = process.argv.includes('--drag-live-test');
const actionTest = process.argv.includes('--action-test');
const aiTest = process.argv.includes('--ai-test');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts');
if (smoke) app.setPath('userData', path.join(output, 'smoke-profile'));
if (dragTest) app.setPath('userData',path.join(output,'drag-test-profile'));
if (dragLive) app.setPath('userData',path.join(output,'drag-live-profile'));
if (actionTest) app.setPath('userData',path.join(output,'action-test-profile'));
if (aiTest) app.setPath('userData',path.join(output,'ai-test-profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, settingsWin, chatWin, desktopChat, ai, studioProcess, studioURL, studioStarting, assetBundle, mover, tray, trayMenu, state, stateFile, saving = Promise.resolve(), feedQueue = Promise.resolve(), quitting = false, quitRequested = false;
const serialize = () => viewState(state);
function save() {
  const data = JSON.stringify(state, null, 2);
  saving = saving.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile + '.tmp', data + '\n');
    await fs.rename(stateFile + '.tmp', stateFile);
  });
  return saving;
}
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state', serialize());
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('state', serialize());
  updateTray();
}
async function choose(changes) {
  const previousScale=state.scale;
  state = normalizeState({ ...state, ...changes });
  if(win && previousScale!==state.scale)resizePet();
  await save(); broadcast(); return serialize();
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`${FORM_NAMES[currentForm(state)]} · 喵喵回收站`);
  trayMenu=Menu.buildFromTemplate([
    { id:'open-settings', label: '打开设置', click:openSettings },
    { id:'open-input', label: '和精灵说句话', click:()=>desktopChat.openInput().catch(console.error) },
    { id:'open-chat', label: '查看聊天记录', click:openChat },
    { type: 'separator' },
    { label: `投喂成长（${state.thresholds.join(' / ')} 次进化）`, type: 'checkbox', checked: state.mode === 'growth', click() { choose({ mode: 'growth' }); } },
    { label: '手动选择形态', submenu: FORM_NAMES.map((name, i) => ({ label: name, type: 'radio',
      checked: state.mode === 'manual' && state.manualForm === i, click() { choose({ mode: 'manual', manualForm: i }); } })) },
    { type: 'separator' },
    { label: '显示 / 隐藏', click() { win.isVisible() ? win.hide() : win.show(); } },
    { label: '召回屏幕右下角', async click() { const w = screen.getPrimaryDisplay().workArea,b=win.getBounds();const p=screen.dipToScreenPoint({x:w.x+w.width-b.width-10,y:w.y+w.height-b.height-15});await mover.position(p.x,p.y);state.position={x:win.getBounds().x,y:win.getBounds().y};await save();win.show(); } },
    { label: '打开精灵动作室', click() { openStudio().catch(console.error); } },
    { label: '退出', click() { app.quit(); } },
  ]);
  tray.setContextMenu(trayMenu);
}
function trusted(event,allowed=[win,settingsWin]) {
  if (!allowed.some(w=>w&&!w.isDestroyed()&&event.sender===w.webContents) || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的窗口请求');
}
async function feed(paths) {
  const before = currentForm(state);
  const result = await feedFiles(paths, { trashItem: p => shell.trashItem(p), notifyRemoved,
    protectedPaths: [root, app.getPath('userData'), process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) });
  if (result.count) await choose({ feeds: state.feeds + 1 });
  const logFile=path.join(app.getPath('userData'),'recycle-log.json');
  try{let log=[];try{log=JSON.parse(await fs.readFile(logFile,'utf8'));}catch{}log.push({at:new Date().toISOString(),count:result.count,shellNotified:result.shellNotified,removed:result.removed,rejected:result.rejected});await fs.writeFile(logFile,JSON.stringify(log.slice(-50),null,2));}catch(error){console.error(error);}
  return { ...result, evolved: currentForm(state) !== before, state: serialize() };
}

function configurePage(window){
  window.webContents.once('did-finish-load',()=>{window.webContents.setZoomFactor(1);window.webContents.setVisualZoomLevelLimits(1,1).catch(console.error);});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('before-input-event',(event,input)=>{if(input.control&&['+','-','=','0'].includes(input.key))event.preventDefault();});
}
function resizePet(){
  const before=win.getBounds(),work=screen.getDisplayMatching(before).workArea;
  const factor=Math.min(state.scale,work.width/360,work.height/450);
  const width=Math.round(360*factor),height=Math.round(450*factor);
  const x=Math.max(work.x,Math.min(work.x+work.width-width,Math.round(before.x+before.width/2-width/2)));
  const y=Math.max(work.y,Math.min(work.y+work.height-height,before.y+before.height-height));
  win.setBounds({x,y,width,height});state.position={x,y};
}
function openSettings(){
  win?.show();
  if(settingsWin&&!settingsWin.isDestroyed()){settingsWin.show();settingsWin.focus();return;}
  settingsWin=new BrowserWindow({width:430,height:690,minWidth:400,minHeight:580,resizable:true,autoHideMenuBar:true,title:'喵喵回收站 · 设置',backgroundColor:'#f6f9f1',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  configurePage(settingsWin);
  settingsWin.on('closed',()=>{settingsWin=null;});
  settingsWin.once('ready-to-show',()=>settingsWin.show());
  settingsWin.loadURL('pet://app/app/settings.html');
}
function sendTo(window,channel,value){if(window&&!window.isDestroyed())window.webContents.send(channel,value);}
function openChat(){
  if(chatWin&&!chatWin.isDestroyed()){chatWin.show();chatWin.focus();return;}
  chatWin=new BrowserWindow({width:700,height:780,minWidth:500,minHeight:560,autoHideMenuBar:true,title:'精灵聊天记录',backgroundColor:'#f6f9f1',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  configurePage(chatWin);chatWin.on('closed',()=>{chatWin=null;});chatWin.once('ready-to-show',()=>chatWin.show());
  chatWin.loadURL('pet://app/app/chat.html');
}
function aiEvent(event){
  desktopChat?.event(event);
  if(event.type==='config'){sendTo(settingsWin,'ai-config',event.config);sendTo(chatWin,'ai-update',event);}
  else if(event.type==='reply')sendTo(win,'ai-reply',event);
  else sendTo(chatWin,'ai-update',event);
}
function setupAI(){
  ai=new AIService({directory:app.getPath('userData'),secretStorage:safeStorage,fetchImpl:(...args)=>net.fetch(...args),getPetName:()=>FORM_NAMES[currentForm(state)],onEvent:aiEvent});
  // AI storage errors are shown in its windows; the desktop pet remains available.
  ai.ready.catch(()=>{});
  ipcMain.handle('ai-config',event=>{trusted(event,[settingsWin,chatWin]);return ai.getConfig();});
  for(const [channel,method] of [['ai-save','saveConfig'],['ai-test','testConnection'],['ai-models','models']])ipcMain.handle(channel,(event,value)=>{trusted(event,[settingsWin]);return ai[method](value);});
  for(const [channel,method] of [['ai-state','getState'],['ai-provider','selectProvider'],['ai-new','newConversation'],['ai-select','selectConversation']])ipcMain.handle(channel,(event,value)=>{trusted(event,[chatWin]);return ai[method](value);});
  ipcMain.handle('ai-send',async(event,value)=>{trusted(event,[chatWin,desktopChat?.getWindow('input')]);const result=await ai.send(value);if(event.sender===desktopChat?.getWindow('input')?.webContents)desktopChat.sent();return result;});
  ipcMain.handle('ai-stop',event=>{trusted(event,[chatWin,desktopChat?.getWindow('input'),desktopChat?.getWindow('bubble')]);return ai.stop();});
  for(const [channel,method,label] of [['ai-clear','clearConversation','清空当前对话'],['ai-delete','deleteConversation','删除当前对话']])ipcMain.handle(channel,async event=>{
    trusted(event,[chatWin]);ai.ensureIdle();
    const result=await dialog.showMessageBox(chatWin,{type:'question',message:label+'？',detail:'本机保存的当前对话记录将被移除。',buttons:['取消',label],defaultId:0,cancelId:0});
    return result.response===1?ai[method]():ai.getState();
  });
  ipcMain.handle('ai-copy',async(event,id)=>{trusted(event,[chatWin]);const c=await ai.exportConversation(),message=c.messages.find(m=>m.id===id);if(message)clipboard.writeText(message.content);return !!message;});
  ipcMain.handle('ai-export',async event=>{
    trusted(event,[chatWin]);const c=await ai.exportConversation();
    const result=await dialog.showSaveDialog(chatWin,{title:'导出当前对话',defaultPath:`精灵对话-${new Date().toISOString().slice(0,10)}.md`,filters:[{name:'Markdown 文本',extensions:['md']},{name:'JSON 记录',extensions:['json']}]});
    if(result.canceled||!result.filePath)return false;
    const text=result.filePath.toLowerCase().endsWith('.json')?JSON.stringify(c,null,2):'# '+c.title+'\n\n'+c.messages.map(m=>`## ${m.role==='user'?'我':m.petName||'精灵'}\n\n${m.content}${m.error?'\n\n（'+m.error+'）':''}`).join('\n\n');
    await fs.writeFile(result.filePath,text+'\n','utf8');return true;
  });
}
async function openStudio(){
  if(!studioProcess&&!studioStarting){
    studioStarting=new Promise((resolve,reject)=>{
      const child=utilityProcess.fork(path.join(root,'action-studio/server.mjs'),[],{env:{...process.env,STUDIO_PORT:'0',STUDIO_DATA_DIR:app.getPath('userData')},stdio:'pipe',serviceName:'精灵动作室'});
      studioProcess=child;
      const timer=setTimeout(()=>{child.kill();reject(new Error('动作室启动超时，请检查本机素材'));},10000);timer.unref();
      child.on('message',message=>{if(message?.type==='studio-ready'&&/^http:\/\/127\.0\.0\.1:\d+$/u.test(message.url)){clearTimeout(timer);studioURL=message.url;resolve();}});
      child.once('exit',()=>{clearTimeout(timer);if(studioProcess===child){studioProcess=null;studioURL=null;}reject(new Error('动作室服务已退出，请检查本机素材'));});
      child.stderr?.on('data',()=>{});
    }).finally(()=>{studioStarting=null;});
  }
  if(studioStarting)await studioStarting;
  if(!studioURL)throw new Error('动作室尚未就绪');
  await shell.openExternal(studioURL+'/?family=miaomiao');return true;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('before-quit', event => {
    if (quitting || !stateFile) return;
    event.preventDefault();
    if (quitRequested) return;
    quitRequested = true;
    Promise.allSettled([feedQueue,ai?.shutdown()]).then(save).catch(console.error).finally(() => { quitting = true;desktopChat?.dispose();mover?.dispose();studioProcess?.kill(); app.quit(); });
  });
  app.on('second-instance', (_event,args) => { if(args.includes('--quit-for-update'))app.quit();else win?.show(); });
  app.whenReady().then(async () => {
    if(process.platform!=='win32')throw new Error('桌面版仅支持 Windows');
    try{assetBundle=await loadAssetBundle(path.join(root,'resources/miaomiao'));await fs.access(path.join(root,'native/PetMove.exe'));await fs.access(path.join(root,'native/ShellRefresh.exe'));}
    catch{dialog.showErrorBox('本机资源未就绪','请先按 README 导入精灵素材并运行 npm run build:native。详细步骤见 docs/assets.md。');app.exit(1);return;}
    const pendingStateFile=path.join(app.getPath('userData'),'state.json');
    try { state = normalizeState(JSON.parse(await fs.readFile(pendingStateFile, 'utf8'))); }
    catch(error) { if(error.code==='ENOENT')state=normalizeState();else{dialog.showErrorBox('成长记录无法读取','原文件已保留，请先备份应用数据，再检查 state.json。');app.exit(1);return;} }
    stateFile=pendingStateFile;
    setupAI();
    if(dragLive||aiTest)state=normalizeState({...state,mode:'manual',manualForm:0,scale:1,position:null});
    protocol.handle('pet', async request => {
      const url = new URL(request.url);
      let relative;try{relative=relativeAsset(decodeURIComponent(url.pathname).replace(/^\/+/,''));}catch{return new Response('Not found',{status:404});}
      const target = path.resolve(root, relative);
      const resource=relative.startsWith('resources/miaomiao/')?relative.slice('resources/miaomiao/'.length):null;
      const allowed=resource!==null?resource==='runtime.json'||assetBundle.files.has(resource):/^app\/[^/]+\.(?:html|css|js)$/u.test(relative)||/^node_modules\/three\/(?:build|examples\/jsm)\/.+\.js$/u.test(relative);
      if (url.host !== 'app' || !contains(root, target) || !allowed) {
        return new Response('Not found', { status: 404 });
      }
      if(resource==='runtime.json')return new Response(JSON.stringify(assetBundle.forms),{headers:{'Content-Type':'application/json'}});
      try{if(!contains(await fs.realpath(root),await fs.realpath(target)))return new Response('Not found',{status:404});}catch{return new Response('Not found',{status:404});}
      return net.fetch(pathToFileURL(target).href);
    });
    const work = screen.getPrimaryDisplay().workArea;
    let pos = state.position || { x: work.x + work.width - 370, y: work.y + work.height - 465 };
    if (!screen.getAllDisplays().some(d => containsPoint(d.workArea, pos))) pos = { x: work.x + work.width - 370, y: work.y + work.height - 465 };
    win = new BrowserWindow({ width: 360, height: 450, ...pos, frame: false, transparent: true,
      resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true,
      skipTaskbar: true, show: false, title: '喵喵回收站', backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true } });
    configurePage(win);resizePet();
    win.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
    win.webContents.session.setPermissionCheckHandler(()=>false);
    mover=createWindowMover(win,{onMove(){desktopChat?.layout();},onEnd(){desktopChat?.layout();state.position={x:win.getBounds().x,y:win.getBounds().y};save().catch(console.error);}});
    desktopChat=createDesktopChat({pet:win,ai,configurePage});
    win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    win.on('moved', () => { state.position = { x: win.getBounds().x, y: win.getBounds().y }; });
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); save(); } });
    win.on('ready-to-show', () => win.show());
    const customIcon=nativeImage.createFromPath(path.join(root,'resources/miaomiao/renders/icon.png'));
    tray = new Tray((customIcon.isEmpty()?nativeImage.createFromBuffer(leafPNG()):customIcon).resize({width:32,height:32}));
    tray.on('double-click', () => win.show()); updateTray();
    ipcMain.handle('state', event => { trusted(event,[win,settingsWin,chatWin]); return serialize(); });
    ipcMain.handle('choose', (event, value) => {
      trusted(event,[settingsWin]);
      if (!value || !['growth','manual'].includes(value.mode)) throw new Error('未知模式');
      return choose({ mode: value.mode, manualForm: [0,1,2].includes(value.manualForm) ? value.manualForm : state.manualForm });
    });
    ipcMain.handle('configure', (event, value) => {
      trusted(event,[settingsWin]);
      if(!value||typeof value!=='object')throw new Error('设置格式错误');
      const changes={};
      if(value.thresholds!==undefined){if(!validThresholds(value.thresholds))throw new Error('请输入递增的累计投喂次数：1–999999，魔力猫必须大于喵呜');changes.thresholds=value.thresholds;}
      if(value.scale!==undefined){if(!Number.isFinite(value.scale)||value.scale<.5||value.scale>2)throw new Error('缩放范围为 50%–200%');changes.scale=value.scale;}
      return choose(changes);
    });
    ipcMain.handle('open-studio',event=>{trusted(event,[settingsWin]);return openStudio();});
    ipcMain.handle('dialogue-open',event=>{trusted(event,[win,chatWin]);return desktopChat.openInput();});
    ipcMain.on('dialogue-close',(event,kind)=>{trusted(event,[win,desktopChat.getWindow(kind)]);if(['bubble','input'].includes(kind))desktopChat.close(kind);});
    ipcMain.on('dialogue-measure',(event,kind,height)=>{trusted(event,[desktopChat.getWindow(kind)]);desktopChat.measure(kind,height);});
    ipcMain.on('dialogue-anchors',(event,value)=>{trusted(event,[win]);desktopChat.setAnchors(value);});
    ipcMain.handle('feed', (event, paths) => {
      trusted(event,[win]);
      const result = feedQueue.then(() => feed(paths)); feedQueue = result.catch(() => {}); return result;
    });
    ipcMain.on('quit', event => { trusted(event,[settingsWin]); app.quit(); });
    ipcMain.on('hide', event => { trusted(event,[settingsWin]); win.hide(); });
    ipcMain.handle('drag-begin', async event => {
      trusted(event);if(event.sender!==win.webContents)throw new Error('请从精灵窗口拖动');
      const before=dragLive?await win.webContents.executeJavaScript('window.petRenderInfo()'):null;
      const result=await mover.begin();
      if(dragLive){
        const after=await win.webContents.executeJavaScript('window.petRenderInfo()');
        const report={...result,before,after,sizeUnchanged:result.start[2]===result.end[2]&&result.start[3]===result.end[3],renderUnchanged:JSON.stringify(before)===JSON.stringify(after)};
        await fs.mkdir(output,{recursive:true});
        const file=path.join(output,'drag-live-results.json');let reports=[];
        try{reports=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
        await fs.writeFile(file,JSON.stringify([...reports,report].slice(-20),null,2));
      }
      return result;
    });
    ipcMain.on('drag-cancel',event=>{trusted(event);mover.cancel();});
    await win.loadURL('pet://app/app/index.html');
    if (smoke) runSmoke().catch(async error => { await fs.mkdir(output, { recursive:true }); await fs.writeFile(path.join(output, 'smoke-error.txt'), error.stack); app.exit(1); });
    if (dragTest) runDragTest().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'drag-error.txt'),error.stack);mover?.dispose();app.exit(1);});
    if(actionTest){
      await fs.mkdir(output,{recursive:true});await fs.rm(path.join(output,'action-error.txt'),{force:true});
      require('./action-check.cjs').checkActions({win,choose,output}).then(async()=>{await saving;app.quit();}).catch(async error=>{await fs.writeFile(path.join(output,'action-error.txt'),error.stack);mover?.dispose();app.exit(1);});
    }
    if(aiTest){
      await fs.mkdir(output,{recursive:true});await fs.rm(path.join(output,'ai-error.txt'),{force:true});
      await fs.rm(path.join(output,'ai-results.json'),{force:true});
      require('./ai-check.cjs').checkAI({win,ai,desktopChat,mover,choose,openSettings,openChat,getSettings:()=>settingsWin,getChat:()=>chatWin,output}).then(()=>app.quit()).catch(async error=>{await fs.writeFile(path.join(output,'ai-error.txt'),error.stack);desktopChat?.dispose();mover?.dispose();app.exit(1);});
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
async function runDragTest(){
  await fs.mkdir(output,{recursive:true});
  await fs.rm(path.join(output,'drag-error.txt'),{force:true});
  await win.webContents.executeJavaScript(`new Promise(resolve=>{const t=setInterval(()=>{if(window.petReady){clearInterval(t);resolve(true);}},50);})`);
  await mover.ready;
  const work=screen.getPrimaryDisplay().workArea;
  const samples=[];
  for(const scale of [.5,1,1.5,2]){
    await choose({mode:'manual',manualForm:0,scale});
    await win.webContents.executeJavaScript('window.petReady(0)');
    await new Promise(r=>setTimeout(r,200));
    let resizes=0;const resized=()=>resizes++;win.on('resize',resized);
    const before=await win.webContents.executeJavaScript('window.petRenderInfo()');
    const beforeScale=state.scale;
    let physicalSize;
    for(let i=0;i<100;i++){
      const point=screen.dipToScreenPoint({x:work.x+10+i%25*3,y:work.y+10+Math.floor(i/25)*3});
      const result=await mover.position(point.x,point.y);
      if(!physicalSize)physicalSize=result.bounds.slice(2);
      if(result.bounds[2]!==physicalSize[0]||result.bounds[3]!==physicalSize[1])throw new Error('Native move changed the physical window size');
      await new Promise(r=>setTimeout(r,8));
    }
    await new Promise(r=>setTimeout(r,100));
    const after=await win.webContents.executeJavaScript('window.petRenderInfo()');
    win.removeListener('resize',resized);
    if(state.scale!==beforeScale||JSON.stringify(before)!==JSON.stringify(after))throw new Error('Drag reallocated or zoomed the rendering surface: '+JSON.stringify({resizes,before,after}));
    samples.push({scale,moves:100,physicalSize,resizeSignals:resizes,canvasReallocations:after.resizeCount-before.resizeCount,before,after});
  }
  await fs.writeFile(path.join(output,'drag-results.json'),JSON.stringify(samples,null,2));
  await saving;app.quit();
}
function containsPoint(area, point) { return point.x >= area.x && point.x <= area.x + area.width - 100 && point.y >= area.y && point.y <= area.y + area.height - 80; }
async function runSmoke() {
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, 'smoke-error.txt'), { force:true });
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{ const started=Date.now(); const t=setInterval(()=>{if(typeof window.petReady==='function'){clearInterval(t);resolve(true);}else if(Date.now()-started>15000){clearInterval(t);reject(new Error('界面未就绪'));}},100); })`);
  // Only this generated disposable file is used for the system Recycle Bin check.
  const fixtureDir = app.getPath('desktop');
  await fs.mkdir(fixtureDir, { recursive: true });
  const fixture = path.join(fixtureDir, 'disposable-' + Date.now() + '.txt');
  await fs.writeFile(fixture, 'Generated only for the recycle integration check.');
  const beforeDrop = state.feeds;
  await win.webContents.executeJavaScript(`window.dropTrace=[]; for(const type of ['dragenter','dragover','drop'])window.addEventListener(type,e=>window.dropTrace.push({type,types:[...e.dataTransfer.types],files:[...e.dataTransfer.files].map(f=>f.name)}),true);`);
  win.webContents.debugger.attach('1.3');
  const data = { items:[{mimeType:'text/uri-list',data:pathToFileURL(fixture).href}], files:[fixture], dragOperationsMask:17 };
  await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type:'dragEnter', x:180, y:200, data });
  await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type:'dragOver', x:180, y:200, data });
  await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type:'drop', x:180, y:200, data });
  for (let n=0; n<100 && state.feeds===beforeDrop; n++) await new Promise(resolve=>setTimeout(resolve,100));
  win.webContents.debugger.detach();
  if (state.feeds !== beforeDrop+1) throw new Error('文件拖放未触发投喂：'+await win.webContents.executeJavaScript('JSON.stringify({message:document.getElementById("message").textContent,trace:window.dropTrace})'));
  await fs.access(fixture).then(() => { throw new Error('Disposable file still exists'); }, () => {});
  const recycleLog=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'recycle-log.json'),'utf8'));
  if(!recycleLog.at(-1).shellNotified)throw new Error('Windows Shell notification failed');
  const feedAction=await win.webContents.executeJavaScript(`window.petActionStatus()`);
  if(feedAction.source!=='feed'||!['Happy','Relax','Show','Skill3Start'].includes(feedAction.animation))throw new Error('Successful feeding did not trigger its action pool: '+JSON.stringify(feedAction));
  await win.webContents.executeJavaScript(`document.getElementById('scene').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));`);
  let clickAction;
  for(let n=0;n<50;n++){clickAction=await win.webContents.executeJavaScript('window.petActionStatus()');if(clickAction.source==='click')break;await new Promise(r=>setTimeout(r,30));}
  if(clickAction.source!=='click')throw new Error('Click handler did not trigger its action pool: '+JSON.stringify(clickAction));
  const checks = [{ systemRecycle: true, rendererDropAndPreload: true,shellNotified:true,desktopFile:true,feedAction:feedAction.animation,clickAction:clickAction.animation,clickHandlerThroughNativeBridge:true }];
  const desktopControlsRemoved=await win.webContents.executeJavaScript(`!document.querySelector('footer,button,#pet-name,#settings-toggle,#info')&&typeof window.pet.openSettings==='undefined'`);
  if(!desktopControlsRemoved||ipcMain.listenerCount('open-settings'))throw new Error('Desktop controls or settings IPC entry still exists');
  const settingsEntry=trayMenu.getMenuItemById('open-settings');
  if(!settingsEntry)throw new Error('Tray settings entry is missing');
  settingsEntry.click();
  await new Promise(resolve=>settingsWin.webContents.once('did-finish-load',resolve));
  await settingsWin.webContents.executeJavaScript(`new Promise(resolve=>{const t=setInterval(()=>{if(document.documentElement.dataset.ready){clearInterval(t);resolve(true);}},50);})`);
  await settingsWin.webContents.executeJavaScript(`document.getElementById('first-threshold').value='2';document.getElementById('second-threshold').value='4';document.getElementById('threshold-form').requestSubmit();`);
  for(let n=0;n<50&&state.thresholds[0]!==2;n++)await new Promise(r=>setTimeout(r,50));
  if(state.thresholds.join(',')!=='2,4')throw new Error('Custom thresholds were not saved');
  const oldBounds=win.getBounds();
  await settingsWin.webContents.executeJavaScript(`const slider=document.getElementById('pet-scale');slider.value=150;slider.dispatchEvent(new Event('input',{bubbles:true}));`);
  for(let n=0;n<50&&state.scale!==1.5;n++)await new Promise(r=>setTimeout(r,50));
  if(state.scale!==1.5||win.getBounds().width<=oldBounds.width)throw new Error('Settings scaling failed');
  await new Promise(r=>setTimeout(r,200));
  await fs.writeFile(path.join(output,'settings.png'),(await settingsWin.webContents.capturePage()).toPNG());
  await settingsWin.webContents.executeJavaScript(`document.getElementById('reset-scale').click()`);
  await new Promise(r=>setTimeout(r,200));
  const renderInfo=await win.webContents.executeJavaScript('window.petRenderInfo()');
  const noDesktopProgress=await win.webContents.executeJavaScript(`!document.getElementById('progress')&&!document.getElementById('progress-label')`);
  if(!noDesktopProgress||renderInfo.canvas[0]<renderInfo.display[0]*renderInfo.dpr)throw new Error('Desktop progress or resolution check failed');
  checks.push({customThresholds:true,settingsScale:true,desktopProgressRemoved:true,desktopControlsRemoved,traySettingsEntry:true,renderInfo});
  for (const i of [0,1,2]) {
    await settingsWin.webContents.executeJavaScript(`document.querySelector('[data-form="${i}"]').click()`);
    const status = await win.webContents.executeJavaScript(`window.petReady(${i})`);
    if (status.form !== i || !status.meshes || !status.animation || state.mode !== 'manual' || state.manualForm !== i) throw new Error('Model failed: '+JSON.stringify(status));
    await new Promise(resolve => setTimeout(resolve, 500));
    const shot = await win.webContents.capturePage();
    await fs.writeFile(path.join(output, `form-${i}.png`), shot.toPNG());
    checks.push({ ...status, manualChoice:true });
  }
  await choose({ mode:'growth', feeds:1 });
  const fixture2 = path.join(fixtureDir, 'evolution-' + Date.now() + '.txt');
  await fs.writeFile(fixture2, 'Generated only for evolution test.');
  const evolution = await feed([fixture2]);
  if (!evolution.evolved || evolution.state.form !== 1 || evolution.state.feeds!==2) throw new Error('Custom evolution check failed');
  checks.push({ evolution:true, feeds:evolution.state.feeds });
  await fs.writeFile(path.join(output, 'smoke-results.json'), JSON.stringify(checks, null, 2));
  await saving; app.quit();
}

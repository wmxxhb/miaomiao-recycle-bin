const path=require('node:path');
const {BrowserWindow,screen}=require('electron');
const {createWindowMover}=require('./window-move.cjs');
const {dialogueLayout}=require('./dialogue-layout.cjs');

function createDesktopChat({pet,ai,configurePage}){
  const surfaces={};let anchors={},sizes={},bubble=null,dismissed=null,revision=-1,disposed=false,layoutQueued=false,inputHint='';
  let lastConversation=null,activeId=null;
  function send(window,channel,value){if(window&&!window.isDestroyed()&&!window.webContents.isLoadingMainFrame())window.webContents.send(channel,value);}
  function allowed(kind){return surfaces[kind]?.window;}
  function create(kind){
    if(surfaces[kind])return surfaces[kind];
    // A frameless surface needs programmatic resizing as text grows. No thick frame means no resize handles.
    const window=new BrowserWindow({width:kind==='bubble'?400:380,height:kind==='bubble'?108:146,frame:false,transparent:true,thickFrame:false,
      resizable:true,maximizable:false,minimizable:false,fullscreenable:false,hasShadow:false,alwaysOnTop:true,skipTaskbar:true,show:false,
      title:kind==='bubble'?'精灵的对白':'和精灵说句话',backgroundColor:'#00000000',
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    configurePage(window);
    const mover=createWindowMover(window),entry={window,mover,ready:false,wanted:false,placing:false,pending:null,lastSize:null};surfaces[kind]=entry;
    window.on('show',()=>{entry.lastSize=null;queueLayout();});
    window.on('close',event=>{if(!disposed){event.preventDefault();close(kind);}});
    window.webContents.once('did-finish-load',()=>{entry.ready=true;render();layout();});
    window.loadURL('pet://app/app/dialogue.html?surface='+kind).catch(console.error);
    return entry;
  }
  async function position(entry,bounds){
    entry.pending=bounds;if(entry.placing)return;entry.placing=true;
    try{
      while(entry.pending&&!disposed&&!entry.window.isDestroyed()){
        const value=entry.pending;entry.pending=null;
        // Only explicit content changes can resize a companion. Moving never resizes the pet or a companion.
        const size=value.width+','+value.height;
        if(entry.lastSize!==size){
          entry.window.setSize(value.width,value.height);
          entry.lastNative=await entry.mover.bounds(screen.dipToScreenRect(entry.window,{x:value.x,y:value.y,width:value.width,height:value.height}));entry.lastSize=size;
        }else{
          const point=screen.dipToScreenPoint({x:value.x,y:value.y});entry.lastNative=await entry.mover.position(point.x,point.y);
        }
        if(entry.wanted&&pet.isVisible()&&entry.ready&&!entry.window.isVisible())entry.window.showInactive();
      }
    }catch(error){if(!disposed)console.error('对白位置更新失败',error.message);}
    finally{entry.placing=false;}
  }
  function layout(){
    if(disposed||pet.isDestroyed())return;
    const bounds=pet.getBounds(),work=screen.getDisplayMatching(bounds).workArea;
    const result=dialogueLayout(bounds,work,sizes,anchors);
    for(const kind of ['bubble','input']){
      const entry=surfaces[kind];if(!entry?.ready)continue;
      send(entry.window,'dialogue-layout',{...result[kind],...result.limits});
      if(entry.wanted&&pet.isVisible())position(entry,result[kind]);else entry.window.hide();
    }
    return result;
  }
  function queueLayout(){if(layoutQueued||disposed)return;layoutQueued=true;setImmediate(()=>{layoutQueued=false;layout();});}
  function render(){
    send(allowed('bubble'),'dialogue-content',bubble);
    send(allowed('input'),'dialogue-input-state',{active:!!ai.active,hint:inputHint});
  }
  function showBubble(value){
    bubble=value;const entry=create('bubble');entry.wanted=dismissed!==value.id;render();layout();
  }
  function close(kind){
    const entry=surfaces[kind];if(!entry)return;
    entry.wanted=false;entry.window.hide();if(kind==='bubble')dismissed=bubble?.id;
  }
  async function openInput(){
    pet.show();const entry=create('input');entry.wanted=true;
    try{const state=await ai.getState();const profile=state.config.profiles[state.config.selectedProvider];inputHint=profile?.hasKey&&profile.model?'':'先右键托盘图标 → 打开设置，填写 API Key 和模型并保存。';event({type:'state',state});render();}
    catch(error){inputHint=error.message;render();}
    if(disposed)return;
    if(!entry.ready)await new Promise(resolve=>entry.window.webContents.once('did-finish-load',resolve));
    layout();await entry.mover.ready;
    // Wait until the initial native positioning completes before focusing the input.
    while(entry.placing&&!disposed)await new Promise(resolve=>setTimeout(resolve,10));
    if(entry.wanted&&!disposed&&pet.isVisible()){entry.window.show();entry.window.focus();send(entry.window,'dialogue-focus',true);}
  }
  function event(value){
    if(disposed)return;
    if(value.type==='state'){
      const state=value.state;if(state.revision<revision)return;revision=state.revision;
      const conversationId=state.conversation.id,changed=lastConversation!==conversationId;
      lastConversation=conversationId;activeId=state.active?.messageId||null;
      const message=state.conversation.messages.at(-1);
      if(changed){bubble=null;dismissed=null;if(surfaces.bubble){surfaces.bubble.wanted=false;surfaces.bubble.window.hide();}}
      const enabled=state.config.preferences.bubbles;
      if(!enabled&&surfaces.bubble){surfaces.bubble.wanted=false;surfaces.bubble.window.hide();}
      else if(enabled&&message?.role==='assistant'&&(state.active||bubble?.id===message.id)){
        if(state.active&&bubble?.id!==message.id)dismissed=null;
        showBubble({id:message.id,text:message.content,active:!!state.active,note:message.error||''});
      }else if(!message&&surfaces.bubble){bubble=null;surfaces.bubble.wanted=false;surfaces.bubble.window.hide();}
      render();
    }else if(value.type==='delta'&&value.messageId===activeId&&ai.config.preferences.bubbles){
      showBubble({id:value.messageId,text:value.text,active:true,note:''});
    }else if(value.type==='config'&&value.revision>=revision){
      revision=value.revision;
      if(!value.config.preferences.bubbles&&surfaces.bubble){surfaces.bubble.wanted=false;surfaces.bubble.window.hide();}
    }else if(value.type==='notice'){
      if(bubble)showBubble({...bubble,note:value.message});
      send(allowed('input'),'dialogue-notice',value.message);
    }
  }
  function measure(kind,height){
    if(!['bubble','input'].includes(kind)||!Number.isFinite(height))return;
    const bounded=Math.round(Math.max(kind==='bubble'?88:110,Math.min(kind==='bubble'?340:220,height)));
    if(sizes[kind]!==bounded){sizes[kind]=bounded;layout();}
  }
  function setAnchors(value){
    if(!value||!['head','feet'].every(key=>Number.isFinite(value[key]?.x)&&Number.isFinite(value[key]?.y)))return;
    const bounds=pet.getBounds();
    if(['head','feet'].some(key=>value[key].x<0||value[key].x>bounds.width||value[key].y<0||value[key].y>bounds.height))return;
    anchors=value;queueLayout();
  }
  function hide(){for(const entry of Object.values(surfaces))entry.window.hide();}
  pet.on('move',queueLayout);pet.on('resize',queueLayout);pet.on('show',queueLayout);pet.on('hide',hide);
  screen.on('display-metrics-changed',queueLayout);screen.on('display-removed',queueLayout);
  return {openInput,close,event,measure,setAnchors,layout,getWindow:allowed,
    diagnostics:()=>Object.fromEntries(Object.entries(surfaces).map(([kind,entry])=>[kind,{lastSize:entry.lastSize,lastNative:entry.lastNative,pending:entry.pending,placing:entry.placing}])),
    sent(){close('input');},
    dispose(){disposed=true;pet.removeListener('move',queueLayout);pet.removeListener('resize',queueLayout);pet.removeListener('show',queueLayout);pet.removeListener('hide',hide);screen.removeListener('display-metrics-changed',queueLayout);screen.removeListener('display-removed',queueLayout);for(const entry of Object.values(surfaces)){entry.mover.dispose();entry.window.destroy();}},
  };
}
module.exports={createDesktopChat};

const fs=require('node:fs/promises');
const path=require('node:path');

async function checkActions({win,choose,output}) {
  await fs.mkdir(output,{recursive:true});
  await win.webContents.executeJavaScript(`new Promise(resolve=>{const timer=setInterval(()=>{if(window.petReady){clearInterval(timer);resolve();}},50);})`);
  const reports=[];
  for(const form of [0,1,2]) {
    await choose({mode:'manual',manualForm:form,scale:1});
    await win.webContents.executeJavaScript(`window.petReady(${form})`);
    const report=await win.webContents.executeJavaScript(`(${inspectActions.toString()})()`);
    const frameRate=await win.webContents.executeJavaScript(`(${inspectFrameRate.toString()})()`);
    reports.push({form,...report,frameRate});
    await win.webContents.executeJavaScript(`window.petActionTest.choose('afk',[.5625,.5]);window.petActionTest.advance(2);`);
    await new Promise(resolve=>setTimeout(resolve,100));
    await fs.writeFile(path.join(output,`action-sleep-${form}.png`),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`window.petActionTest.idle();window.petActionTest.hold(false);`);
  }
  const realTime=await win.webContents.executeJavaScript(`(${inspectRealTime.toString()})()`);
  reports.push({realTime});
  await fs.writeFile(path.join(output,'action-results.json'),JSON.stringify(reports,null,2));
}

async function inspectFrameRate() {
  window.petActionTest.idle();window.petActionTest.hold(false);
  await new Promise(resolve=>setTimeout(resolve,500));
  const before=window.petFrameStats();
  await new Promise(resolve=>setTimeout(resolve,3000));
  const after=window.petFrameStats();
  const frames=after.renderedFrames-before.renderedFrames,elapsedMs=after.now-before.now;
  const fps=frames*1000/elapsedMs;
  if(after.targetFPS!==60||fps<54||fps>66)throw new Error('60 FPS playback check failed: '+JSON.stringify({frames,elapsedMs,fps}));
  return {targetFPS:after.targetFPS,frames,elapsedMs,fps};
}

async function inspectActions() {
  const {ACTION_POOLS}=await import('/app/actions.js');
  const t=window.petActionTest;
  t.hold(true);t.idle();
  const initialRender=window.petRenderInfo();
  const results=[];
  for(const [kind,choices] of Object.entries(ACTION_POOLS))for(let index=0;index<choices.length;index++) {
    const plan=t.choose(kind,[(index+.5)/choices.length,.5]);
    const played=[];
    for(const step of plan) {
      const before=window.petActionStatus();
      if(before.animation!==step.id)throw new Error('Unexpected action: '+JSON.stringify({step,before}));
      t.advance((before.seconds-before.elapsed)/2);
      const middle=window.petActionStatus();
      if(middle.animation!==step.id)throw new Error('Action ended early: '+step.id);
      if(step.seconds&&(!middle.loop||middle.seconds<5||middle.seconds>10))throw new Error('Timed action did not loop for 5–10 seconds');
      played.push({id:step.id,seconds:before.seconds,loop:before.loop});
      t.advance(middle.seconds-middle.elapsed+.000001);
    }
    if(window.petActionStatus().source!=='idle')throw new Error('Action did not return to Idle');
    results.push({kind,choice:choices[index],played});
  }
  t.choose('afk',[.5625,.5]);t.advance(3);
  t.choose('click',[.86,.5]);
  if(window.petActionStatus().animation!=='Stun')throw new Error('Click did not interrupt sleep');
  t.choose('feed',[.99]);t.advance(10);
  if(window.petActionStatus().source!=='idle')throw new Error('Feed did not replace the click sequence');
  const renderUnchanged=JSON.stringify(initialRender)===JSON.stringify(window.petRenderInfo());
  if(!renderUnchanged)throw new Error('An action changed the window rendering dimensions or camera');
  return {results,interruptions:true,renderUnchanged};
}

async function inspectRealTime() {
  const t=window.petActionTest;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  t.hold(false);t.choose('click',[.86,.5]);
  await wait(3500);
  if(window.petActionStatus().animation!=='Stun')throw new Error('Real-time stun ended before 5 seconds');
  const deadline=performance.now()+7500;
  while(window.petActionStatus().source!=='idle'&&performance.now()<deadline)await wait(50);
  if(window.petActionStatus().source!=='idle')throw new Error('Real-time stun did not finish');
  const original=Math.random;
  try{Math.random=()=>0;t.idle();}finally{Math.random=original;}
  const started=performance.now();
  while(window.petActionStatus().source==='idle'&&performance.now()-started<30000)await wait(50);
  const afk=window.petActionStatus(),elapsedMs=performance.now()-started;
  if(afk.source!=='afk'||elapsedMs<24500)throw new Error('AFK timer did not trigger after its inactivity delay');
  t.idle();
  return {stunStayedActiveAfter3500ms:true,stunReturnedToIdle:true,afkTriggered:true,afkDelayMs:elapsedMs,afkAnimation:afk.animation};
}
module.exports={checkActions};

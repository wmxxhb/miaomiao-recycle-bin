const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts');
app.setPath('userData',path.join(output,'studio-smoke-profile'));
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  const {createStudioServer}=await import('../action-studio/server.mjs');const server=await createStudioServer({decisionsPath:path.join(output,'studio-smoke-choices.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));app.on('before-quit',()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;
  const win=new BrowserWindow({width:1280,height:860,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const errors=[];win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  await win.loadURL(base+'/?family=miaomiao');
  async function waitLoaded(key){
    return win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{const error=document.getElementById('stageMessage');if(error&&!error.hidden){clearInterval(timer);reject(new Error(error.textContent));}else if(document.getElementById('canvasMount').dataset.loaded===${JSON.stringify(key)}){clearInterval(timer);resolve(true);}else if(Date.now()-start>15000){clearInterval(timer);reject(new Error('预览超时'));}},30);})`);
  }
  const catalog=await fetch(base+'/api/catalog?family=miaomiao').then(r=>r.json());
  await waitLoaded(catalog.forms[0].id+':Idle');
  await win.webContents.executeJavaScript(`document.getElementById('resetFilters').click()`);
  let checked=0;
  for(const form of catalog.forms){
    for(const clip of form.clips){
      const key=form.id+':'+clip.id;
      await win.webContents.executeJavaScript(`document.querySelector('[data-key="${key}"]').click()`);
      await waitLoaded(key);checked++;
    }
    const key=form.id+':Idle';
    await win.webContents.executeJavaScript(`document.querySelector('[data-key="${key}"]').click()`);await waitLoaded(key);
    await new Promise(resolve=>setTimeout(resolve,200));
    await fs.writeFile(path.join(output,'studio-'+form.id+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  const key=catalog.forms[0].id+':Happy';
  await win.webContents.executeJavaScript(`document.querySelector('[data-key="${key}"]').click()`);await waitLoaded(key);
  await win.webContents.executeJavaScript(`document.getElementById('playPause').click();document.getElementById('timeline').value=0;document.getElementById('timeline').dispatchEvent(new Event('input'));document.getElementById('nextFrame').click();document.getElementById('speed').value='0.5';document.getElementById('speed').dispatchEvent(new Event('change'));document.getElementById('sideCamera').click();document.getElementById('frontCamera').click();`);
  const frameTime=await win.webContents.executeJavaScript(`Number(document.getElementById('timeline').value)`);
  if(Math.abs(frameTime-1/30)>.002)throw new Error('逐帧检查失败');
  if(errors.length)throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(output,'studio-render-results.json'),JSON.stringify({forms:catalog.forms.length,clipsPlayed:checked,frameTime,halfSpeed:true,cameras:true,errors},null,2));
  win.destroy();app.quit();
}).catch(async error=>{await fs.writeFile(path.join(output,'studio-render-error.txt'),error.stack);app.exit(1);});

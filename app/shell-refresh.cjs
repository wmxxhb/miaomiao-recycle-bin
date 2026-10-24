const {spawn}=require('node:child_process');
const path=require('node:path');
function notifyRemoved(items){
  if(process.platform!=='win32')return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(__dirname,'../native/ShellRefresh.exe'),[],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let errors='';child.stderr.on('data',data=>errors+=data);
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(errors||'桌面刷新通知失败')));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(items));
    const timer=setTimeout(()=>{child.kill();reject(new Error('桌面刷新通知超时'));},4000);
    timer.unref();child.on('exit',()=>clearTimeout(timer));
  });
}
module.exports={notifyRemoved};

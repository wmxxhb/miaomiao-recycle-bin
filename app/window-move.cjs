const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const path=require('node:path');

function createWindowMover(window,{onEnd=()=>{},onMove=()=>{}}={}){
  const handle=window.getNativeWindowHandle();
  const hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
  const child=spawn(path.join(__dirname,'../native/PetMove.exe'),[hwnd,String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let id=0,stopped=false,stderr='';
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  // Keep a handler attached even if the app closes before the first drag request.
  ready.catch(()=>{});
  const timer=setTimeout(()=>readyReject(new Error('拖动服务启动超时')),5000);timer.unref();
  child.stderr.on('data',data=>stderr+=data);
  child.stdin.on('error',()=>{});
  function failed(error){clearTimeout(timer);readyReject(error);for(const entry of pending.values())entry.reject(error);pending.clear();}
  child.on('error',failed);
  child.on('exit',()=>{stopped=true;failed(new Error(stderr||'拖动服务已退出'));});
  createInterface({input:child.stdout}).on('line',line=>{
    let value;try{value=JSON.parse(line);}catch{return;}
    if(value.kind==='ready'){clearTimeout(timer);readyResolve();return;}
    if(value.kind==='error'){failed(new Error(value.message));return;}
    if(value.kind==='move'){onMove(value);return;}
    const entry=pending.get(value.id);if(!entry)return;
    pending.delete(value.id);
    if(value.kind==='end')onEnd(value);
    if(value.kind==='position')onMove(value);
    entry.resolve(value);
  });
  async function send(command,values={}){
    await ready;if(stopped||window.isDestroyed())throw new Error('精灵窗口已关闭');
    const request=++id;
    return new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});child.stdin.write(JSON.stringify({command,id:request,...values})+'\n');});
  }
  return {ready,begin:()=>send('begin'),position:(x,y)=>send('position',{x,y}),
    bounds:rect=>send('bounds',rect),
    cancel(){if(!stopped)child.stdin.write('{"command":"cancel"}\n');},
    dispose(){stopped=true;child.stdin.end();child.kill();},};
}
module.exports={createWindowMover};

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(executable,args,env={}){const result=spawnSync(executable,args,{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error('发布构建步骤失败：'+result.status);}
async function inventory(folder,prefix=''){
  const result=[];
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const relative=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('发行目录不能包含链接文件');
    if(entry.isDirectory())result.push(...await inventory(path.join(folder,entry.name),relative+'/'));
    else if(entry.isFile())result.push(relative);
    else throw new Error('发行目录包含非常规文件');
  }
  return result;
}
function nsis(value){return value.replaceAll('$',()=>'$$').replaceAll('"','$\\"').replaceAll('/','\\');}
async function main(){
  if(process.platform!=='win32')throw new Error('Windows 发布构建需要 Windows');
  const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/u.test(version))throw new Error('版本号无效');
  const compiler=process.env.MIAO_MAKENSIS;
  if(!compiler)throw new Error('请用 MIAO_MAKENSIS 指定 NSIS 3 的 makensis.exe');
  const output=path.join(root,'dist','release-v'+version),portable=path.join(output,'portable','Miaomiao-Recycle-Bin-'+version);
  run(process.execPath,[path.join(root,'scripts/build-native.cjs')]);
  run(process.execPath,[path.join(root,'scripts/package.cjs'),'--out',path.relative(root,portable)]);
  const files=await inventory(portable);
  if(files.some(file=>/(^|\/)(?:artifacts|signing|downloads|\.git)(\/|$)|(?:^|\/)(?:ai-settings|ai-secrets|chat-history|recycle-log|state|action-choices)\.json$|(?:^|\/)\.env(?:\.|$)|\.(?:jks|keystore|pem|key|pfx|p12)$/u.test(file)))throw new Error('发行目录混入私有数据');
  const required=['喵喵回收站.exe','resources/app/resources/miaomiao/runtime.json','resources/app/native/PetMove.exe','resources/app/native/ShellRefresh.exe'];
  for(const name of required)if(!files.includes(name))throw new Error('发行文件缺失：'+name);
  const directories=new Set();for(const file of files){let parent=path.posix.dirname(file);while(parent!=='.'){directories.add(parent);parent=path.posix.dirname(parent);}}
  const manifest=path.join(output,'uninstall-files.nsh');
  await fs.writeFile(manifest,files.map(file=>'Delete "$INSTDIR\\'+nsis(file)+'"').concat([...directories].sort((a,b)=>b.split('/').length-a.split('/').length||b.localeCompare(a)).map(folder=>'RMDir "$INSTDIR\\'+nsis(folder)+'"')).join('\n')+'\n');
  const installer=path.join(output,`Miaomiao-Recycle-Bin-Setup-${version}.exe`),zip=path.join(output,`Miaomiao-Recycle-Bin-${version}-Windows-x64.zip`);
  run(compiler,['/INPUTCHARSET','UTF8','/V2','/DVERSION='+version,'/DSOURCE_DIR='+portable,'/DOUTPUT_FILE='+installer,'/DUNINSTALL_MANIFEST='+manifest,path.join(root,'native/installer.nsi')]);
  run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath $env:MIAO_RELEASE_SOURCE -DestinationPath $env:MIAO_RELEASE_ZIP -CompressionLevel Optimal"],{MIAO_RELEASE_SOURCE:portable,MIAO_RELEASE_ZIP:zip});
  const sums=[];for(const file of [installer,zip]){const bytes=await fs.readFile(file),sha=crypto.createHash('sha256').update(bytes).digest('hex');sums.push(sha+'  '+path.basename(file));console.log(path.basename(file)+': '+bytes.length+' bytes');}
  await fs.writeFile(path.join(output,'SHA256SUMS.txt'),sums.join('\n')+'\n');
  console.log('发行包仅含运行资源，不包含用户密钥、聊天或回收记录。');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

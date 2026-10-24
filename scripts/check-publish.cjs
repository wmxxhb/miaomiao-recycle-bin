const {spawnSync}=require('node:child_process');
const path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
function git(args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(r.status!==0)throw new Error('无法读取 Git 暂存区；请先 git add 源码后检查。');return r.stdout;}
const entries=git(['ls-files','--stage','-z']).split('\0').filter(Boolean);
if(!entries.length)throw new Error('Git 暂存区没有文件，尚不能确认发布内容。');
const roots=new Set(['.gitignore','.gitattributes','README.md','LICENSE','SECURITY.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json']);
const fixture='sk-local-fixture-not-a-real-key-123456789';
const issues=[];let bytes=0;
for(const entry of entries){
  const split=entry.indexOf('\t'),metadata=entry.slice(0,split),file=entry.slice(split+1);
  const allowed=roots.has(file)||file==='resources/miaomiao/README.md'||/^(app|action-studio|native|scripts|tests|docs|\.github)\/.+\.(?:cjs|mjs|js|json|html|css|cs|nsi|md|ya?ml)$/u.test(file);
  if(!allowed||!metadata.startsWith('100')){issues.push(file+'：不属于允许发布的源码文件');continue;}
  if(/(^|\/)(?:node_modules|dist|artifacts|android|signing|downloads)(\/|$)|(?:^|\/)(?:ai-secrets|ai-settings|chat-history|recycle-log|state|action-choices)\.json$|(?:^|\/)\.env(?:\.|$)/u.test(file)){issues.push(file+'：含私有数据或构建目录');continue;}
  const content=git(['show',':'+file]);bytes+=Buffer.byteLength(content);
  if(content.includes('\0')||Buffer.byteLength(content)>2*1024*1024)issues.push(file+'：二进制或过大文件');
  const keys=content.match(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})/gu)||[];
  if(keys.some(key=>key!==fixture)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content))issues.push(file+'：发现疑似真实凭据（具体内容不会打印）');
  for(const location of [root,os.homedir()]){
    if([location,location.replaceAll('\\','/'),encodeURI(location.replaceAll('\\','/'))].some(value=>value.length>8&&content.toLowerCase().includes(value.toLowerCase())))issues.push(file+'：含本机绝对目录');
  }
}
if(issues.length){console.error('发布检查未通过：\n'+issues.join('\n'));process.exitCode=1;}
else console.log(`发布检查通过：${entries.length} 个源码文件，${(bytes/1024).toFixed(1)} KiB；未发现禁止文件或匹配的敏感凭据。`);

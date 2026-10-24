const fs = require('node:fs/promises');
const path = require('node:path');
const { loadAssetBundle, assetFile } = require('../app/asset-files.cjs');
const { contains } = require('../app/core.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  if(process.platform !== 'win32') throw new Error('便携桌面版仅支持 Windows');
  const bundle = await loadAssetBundle(path.join(root, 'resources/miaomiao'), { models: true });
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  const option=process.argv.indexOf('--out');
  const output=option>=0?path.resolve(root,process.argv[option+1]||''):path.join(root,'dist','喵喵回收站-'+version);
  if(output===path.join(root,'dist')||!contains(path.join(root,'dist'),output))throw new Error('打包输出必须是 dist 内的独立目录');
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Refuse to overwrite a version which may be running or contain local changes.
  await fs.mkdir(output);
  await fs.cp(path.join(root, 'node_modules/electron/dist'), output, { recursive: true });
  await fs.rename(path.join(output, 'electron.exe'), path.join(output, '喵喵回收站.exe'));
  const target = path.join(output, 'resources/app');
  await fs.mkdir(target, { recursive: true });
  for (const item of ['app','action-studio','docs','package.json','README.md','LICENSE','SECURITY.md','THIRD_PARTY_NOTICES.md']) await fs.cp(path.join(root,item),path.join(target,item),{recursive:true});
  await fs.mkdir(path.join(target,'native'));
  for(const name of ['PetMove','ShellRefresh']) for(const extension of ['.cs','.exe']) await fs.copyFile(path.join(root,'native',name+extension),path.join(target,'native',name+extension));
  for(const item of ['build','examples/jsm','LICENSE','package.json']) await fs.cp(path.join(root,'node_modules/three',item),path.join(target,'node_modules/three',item),{recursive:true});
  const source=path.join(root,'resources/miaomiao'), assets=path.join(target,'resources/miaomiao');
  for(const relative of bundle.files) { const file=path.join(assets,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(await assetFile(source,relative),file); }
  await fs.writeFile(path.join(assets,'runtime.json'),JSON.stringify(bundle.forms,null,2)+'\n');
  await fs.copyFile(path.join(root,'README.md'),path.join(output,'README.md'));
  console.log('本机便携版已生成：'+path.join(output,'喵喵回收站.exe'));
}
main().catch(error=>{console.error(error.code==='EEXIST'?'该版本输出目录已存在；请保留或手动另存后再打包，程序不会覆盖。':error.message);process.exitCode=1;});

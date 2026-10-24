const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=fs.readdirSync(path.join(root,'tests')).filter(name=>/\.test\.(cjs|mjs)$/u.test(name)).sort().map(name=>path.join(root,'tests',name));
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;

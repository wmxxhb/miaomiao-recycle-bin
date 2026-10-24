const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') { console.error('桌面精灵与 Windows 回收站组件仅支持 Windows。'); process.exit(1); }
const folder = path.resolve(__dirname, '../native');
const compiler = ['Framework64', 'Framework'].map(name => path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', name, 'v4.0.30319/csc.exe')).find(file => fs.existsSync(file));
if (!compiler) throw new Error('未找到 Windows .NET Framework C# 编译器；请安装 .NET Framework 4.x 开发组件。');
for (const name of ['PetMove', 'ShellRefresh']) {
  const source = path.join(folder, name + '.cs'), target = path.join(folder, name + '.exe');
  if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs) continue;
  const result = spawnSync(compiler, ['/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll', '/out:' + target, source], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('原生组件编译失败：' + (result.stdout || result.stderr));
  console.log('已编译原生组件：' + name);
}

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from './server.mjs';

const port = Number(process.env.STUDIO_PORT || 4280);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('预览端口不正确。');
const url = `http://127.0.0.1:${port}`;
async function open() {
  if (process.env.STUDIO_NO_OPEN) return;
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(command, [url], error => { if (error) console.log(`Open ${url} in your browser.`); });
}
try {
  await access(fileURLToPath(new URL('../node_modules/three/build/three.module.js', import.meta.url)));
  let existing = null;
  try {
    const response = await fetch(url + '/api/catalog', { signal: AbortSignal.timeout(1500) });
    existing = await response.json();
  } catch { }
  if (existing?.sourceFingerprint && existing?.totalTracks > 0) {
    console.log(`精灵动作室已在运行：${url}`); await open();
  } else {
    const server = await createStudioServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被其他程序使用。` : error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      console.log(`精灵动作室 ${url}\n请保留此窗口，关闭窗口将停止本地预览。\n按 Ctrl+C 退出。`);
      void open();
    });
  }
} catch (error) {
  console.error(error.code === 'ENOENT' ? '缺少预览依赖，请在项目目录运行 npm install。' : error.message);
  process.exitCode = 1;
}

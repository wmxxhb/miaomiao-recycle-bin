import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActions, validateDecisions } from './shared.js';
import { loadMiaomiao } from './libraries.mjs';
import assets from '../app/asset-files.cjs';

const appRoot = dirname(fileURLToPath(import.meta.url)), root = resolve(appRoot, '..');
const defaultAssets = resolve(root, 'resources/miaomiao');
const choicesFile = resolve(process.env.STUDIO_DATA_DIR || resolve(root, 'artifacts/studio'), 'action-choices.json');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const pages = new Set(['index.html', 'app.js', 'viewer.js', 'eyes.js', 'glassy.js', 'shared.js', 'style.css']);
export async function loadStudioCatalog({ family = 'miaomiao', assetDirectory = defaultAssets } = {}) {
  if (family !== 'miaomiao') throw new Error('仅支持喵喵进化链');
  return { ...await loadMiaomiao({ folder: assetDirectory }), family, families: [{ id: family, name: '喵喵 → 喵呜 → 魔力猫' }] };
}
export async function createStudioServer({ decisionsPath = choicesFile, assetDirectory = defaultAssets } = {}) {
  const catalog = await loadStudioCatalog({ assetDirectory }), bundle = await assets.loadAssetBundle(assetDirectory);
  const validKeys = new Set(createActions(catalog).map(a => a.key));
  let pendingWrite = Promise.resolve();
  const readDecisions = async () => {
    try { return JSON.parse(await readFile(decisionsPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, revision: 0, decisions: {} }; throw error; }
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = createServer(async (req, res) => {
    const host = '127.0.0.1:' + server.address().port;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '仅接受来源匹配的本机访问。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;connect-src 'self';object-src 'none';base-uri 'none';frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname === '/api/catalog' && req.method === 'GET') {
        if (url.searchParams.has('family') && url.searchParams.get('family') !== 'miaomiao') return json(res, 404, { error: '没有该精灵素材库。' });
        return json(res, 200, catalog);
      }
      if (url.pathname === '/api/decisions' && req.method === 'GET') return json(res, 200, await readDecisions());
      if (url.pathname === '/api/decisions' && req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: '仅接受 JSON。' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 700000) return json(res, 413, { error: '清单过大。' }); }
        const incoming = JSON.parse(body), decisions = validateDecisions(incoming.decisions, validKeys);
        const write = pendingWrite.then(async () => {
          const previous = await readDecisions();
          if (incoming.revision !== previous.revision) return json(res, 409, { error: '清单已更新，请重新加载后再编辑。' });
          const result = { schemaVersion: 1, revision: previous.revision + 1, updatedAt: new Date().toISOString(), decisions };
          await mkdir(dirname(decisionsPath), { recursive: true });
          await writeFile(decisionsPath + '.tmp', JSON.stringify(result, null, 2) + '\n');
          await rename(decisionsPath + '.tmp', decisionsPath); json(res, 200, result);
        });
        pendingWrite = write.catch(() => {}); await write; return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持此操作。' });
      let folder, relative;
      const requested = decodeURIComponent(url.pathname);
      if (requested.startsWith('/assets/miaomiao/')) {
        folder = assetDirectory; relative = requested.slice('/assets/miaomiao/'.length);
        if (!bundle.files.has(relative)) return json(res, 404, { error: '文件不在素材清单中。' });
      } else if (requested.startsWith('/vendor/')) {
        folder = resolve(root, 'node_modules/three'); relative = requested.slice(8);
        if (!/^(build|examples\/jsm)\/.+\.js$/u.test(relative)) return json(res, 404, { error: '文件不可用。' });
      } else {
        folder = appRoot; relative = requested === '/' ? 'index.html' : requested.slice(1);
        if (!pages.has(relative)) return json(res, 404, { error: '文件不可用。' });
      }
      assets.relativeAsset(relative);
      const realFolder = await realpath(folder), file = await realpath(resolve(folder, relative));
      if (!file.startsWith(realFolder + sep)) return json(res, 403, { error: '文件不在预览目录内。' });
      const info = await stat(file);
      if (!info.isFile() || !mime[extname(file)]) return json(res, 404, { error: '文件不可用。' });
      res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { if (!res.headersSent) json(res, 400, { error: '请求或本机记录无法读取，请检查素材及记录文件。' }); else res.end(); }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUDIO_PORT || 4280);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('预览端口无效');
  const server = await createStudioServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '动作室端口被占用。' : '动作室启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + server.address().port;
    console.log('精灵动作室 ' + url);
    process.parentPort?.postMessage({ type: 'studio-ready', url });
  });
}

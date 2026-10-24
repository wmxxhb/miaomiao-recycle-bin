const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FORM_NAMES, contains } = require('./core.cjs');
const { ACTION_IDS } = require('./asset-labels.cjs');

// Imported assets are data, never executable code or unrestricted directory trees.
function relativeAsset(value, extensions) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\\:\x00-\x1f]/u.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('素材路径必须是目录内的相对路径');
  if (extensions && !extensions.includes(path.posix.extname(value).toLowerCase())) throw new Error('素材文件类型不受支持');
  return value;
}
async function assetFile(directory, relative) {
  relativeAsset(relative);
  const base = await fs.realpath(directory), target = await fs.realpath(path.join(directory, relative));
  if (!contains(base, target) || base === target) throw new Error('素材链接指向目录外部');
  const info = await fs.stat(target);
  if (!info.isFile() || info.size > 256 * 1024 * 1024) throw new Error('素材必须是小于 256 MB 的普通文件');
  return target;
}
async function readJSON(file) {
  if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('素材清单过大');
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
}
async function glbDocument(file) {
  const bytes = await fs.readFile(file);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.toString('ascii', 16, 20) !== 'JSON' || 20 + bytes.readUInt32LE(12) > bytes.length) throw new Error('模型不是有效的 GLB 2 文件');
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  if ([...(doc.buffers || []), ...(doc.images || [])].some(item => item.uri && !item.uri.startsWith('data:'))) throw new Error('GLB 不能引用外部文件或网络地址');
  return doc;
}
function normalizeRuntime(value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((f, i) => f?.name !== FORM_NAMES[i])) throw new Error('需要按喵喵、喵呜、魔力猫顺序提供三个形态');
  const ids = new Set();
  return value.map(form => {
    if (typeof form.id !== 'string' || !/^[\w-]{1,100}$/u.test(form.id) || ids.has(form.id)) throw new Error('形态编号无效或重复');
    ids.add(form.id);
    if (!form.materials || typeof form.materials !== 'object' || Array.isArray(form.materials) || !Object.keys(form.materials).length) throw new Error('缺少模型材质');
    const materials = Object.fromEntries(Object.entries(form.materials).map(([name, spec]) => {
      if (!spec || !spec.textures || typeof spec.textures !== 'object') throw new Error('缺少材质贴图');
      const textures = Object.fromEntries(Object.entries(spec.textures).map(([key, file]) => [key, relativeAsset(file, ['.png'])]));
      if (!textures[spec.face ? 'EyeTex' : 'BaseTex']) throw new Error('缺少身体或表情贴图');
      return [name, { textures, face: !!spec.face, curve: spec.curve === 'EC_Mouth' ? 'EC_Mouth' : 'EC_Eye', twoSided: !!spec.twoSided }];
    }));
    if (!Array.isArray(form.clips) || form.clips.length > 150) throw new Error('动作清单无效');
    const clips = form.clips.map(clip => {
      if (!clip || !/^[\w-]{1,100}$/u.test(clip.id) || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0 || clip.durationSeconds > 600) throw new Error('动作名称或时长无效');
      const curves = Object.fromEntries(['EC_Eye', 'EC_Mouth'].filter(key => clip.curves?.[key]).map(key => {
        const pairs = clip.curves[key];
        if (!Array.isArray(pairs) || pairs.length > 10000 || pairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n)) || p[0] < 0)) throw new Error('表情曲线无效');
        return [key, pairs.map(p => [...p]).sort((a, b) => a[0] - b[0])];
      }));
      return { id: clip.id, label: ACTION_IDS[clip.id] || clip.id, durationSeconds: clip.durationSeconds, curves };
    });
    const clipIds = new Set(clips.map(c => c.id));
    if (clipIds.size !== clips.length || Object.keys(ACTION_IDS).some(id => !clipIds.has(id))) throw new Error('需要完整的 27 段动作，且不能重复');
    return { id: form.id, name: form.name, model: relativeAsset(form.model, ['.glb']), materials, clips };
  });
}
async function loadAssetBundle(directory, { runtime, models = false } = {}) {
  const forms = normalizeRuntime(runtime || await readJSON(path.join(directory, 'runtime.json')));
  const files = new Set();
  for (const form of forms) {
    files.add(form.model); const modelFile = await assetFile(directory, form.model);
    if (models) {
      const doc = await glbDocument(modelFile), names = (doc.animations || []).map(a => a.name);
      if (form.clips.some(c => !names.includes(c.id))) throw new Error('模型与动作清单不匹配');
    }
    for (const spec of Object.values(form.materials)) for (const [key, relative] of Object.entries(spec.textures)) {
      try { await assetFile(directory, relative); files.add(relative); }
      catch (error) { if (error.code !== 'ENOENT' || key === (spec.face ? 'EyeTex' : 'BaseTex')) throw error; delete spec.textures[key]; }
    }
  }
  for (const relative of ['renders/icon.png', 'source/packs/glassy/glassy-dump.json']) {
    try { await assetFile(directory, relative); files.add(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (files.has('source/packs/glassy/glassy-dump.json')) {
    for (const name of await fs.readdir(path.join(directory, 'source/packs/glassy'))) if (name.endsWith('.png')) { const relative = 'source/packs/glassy/' + name; await assetFile(directory, relative); files.add(relative); }
  }
  return { forms, files, fingerprint: createHash('sha256').update(JSON.stringify(forms)).digest('hex') };
}
module.exports = { relativeAsset, assetFile, readJSON, glbDocument, normalizeRuntime, loadAssetBundle };

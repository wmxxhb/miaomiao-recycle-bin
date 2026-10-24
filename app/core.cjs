const path = require('node:path');
const fs = require('node:fs/promises');
const FORM_NAMES = ['喵喵', '喵呜', '魔力猫'];
const THRESHOLDS = [0, 10, 30];

function validThresholds(value) {
  return Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= 1 && n <= 999999) && value[1] > value[0];
}

function normalizeState(value = {}) {
  return { version: 2, mode: value.mode === 'manual' ? 'manual' : 'growth',
    feeds: Number.isSafeInteger(value.feeds) && value.feeds >= 0 ? value.feeds : 0,
    manualForm: [0, 1, 2].includes(value.manualForm) ? value.manualForm : 0,
    thresholds: validThresholds(value.thresholds) ? [...value.thresholds] : [10, 30],
    scale: Number.isFinite(value.scale) ? Math.round(Math.min(2, Math.max(.5, value.scale)) * 100) / 100 : 1,
    position: value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
      ? { x: Math.round(value.position.x), y: Math.round(value.position.y) } : null };
}
function currentForm(state) {
  return state.mode === 'manual' ? state.manualForm : growthForm(state);
}
function growthForm(state) {
  const [first, second] = state.thresholds || [10, 30];
  return state.feeds >= second ? 2 : state.feeds >= first ? 1 : 0;
}
function viewState(state) {
  const form = currentForm(state), growth = growthForm(state), thresholds = [0, ...(state.thresholds || [10,30])], next = thresholds[growth + 1];
  return { ...state, form, name: FORM_NAMES[form], growthForm:growth, next:next ?? null,
    progress: !next ? 1 : Math.max(0, Math.min(1, (state.feeds - thresholds[growth]) / (next - thresholds[growth]))) };
}
function contains(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function feedFiles(paths, { trashItem, protectedPaths = [], verifyRemoval = true, notifyRemoved = async()=>{} }) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 200) throw new Error('每次可投喂 1–200 个文件或文件夹');
  const unique = [...new Map(paths.filter(p => typeof p === 'string' && path.isAbsolute(p))
    .map(p => [path.resolve(p).toLowerCase(), path.resolve(p)])).values()];
  const accepted = [], rejected = [], removed = [];
  const resolvedProtected=await Promise.all(protectedPaths.map(async p=>{try{return await fs.realpath(p);}catch{return path.resolve(p);}}));
  // Never process a descendant separately after its parent folder is accepted.
  unique.sort((a, b) => a.length - b.length);
  for (const file of unique) {
    if (accepted.some(parent => contains(parent, file))) continue;
    try {
      if (file === path.parse(file).root || protectedPaths.some(p => contains(p, file) || contains(file, p))) {
        throw new Error('这个位置不适合投喂');
      }
      const info = await fs.lstat(file);
      if (!info.isFile() && !info.isDirectory() && !info.isSymbolicLink()) throw new Error('不支持这种文件');
      const physical=await fs.realpath(file);
      if(resolvedProtected.some(p=>contains(p,physical)||contains(physical,p)))throw new Error('这个位置指向受保护目录');
      const started=Date.now();
      await trashItem(file);
      if (verifyRemoval) {
        let gone = false;
        for (let attempt=0; attempt<40; attempt++) {
          try { await fs.lstat(file); }
          catch (error) { if (error.code==='ENOENT') { gone=true; break; } throw error; }
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        if (!gone) throw new Error('系统返回后原文件仍然存在，请检查后重试');
      }
      accepted.push(file);
      removed.push({path:file,directory:info.isDirectory(),elapsedMs:Date.now()-started});
    } catch (error) { rejected.push({ name: path.basename(file), message: error.message }); }
  }
  let shellNotified=false;
  if(removed.length){try{await notifyRemoved(removed);shellNotified=true;}catch{ /* File removal succeeded; a refresh failure must not change its result. */ }}
  return { count: accepted.length, rejected, removed, shellNotified };
}
module.exports = { FORM_NAMES, THRESHOLDS, validThresholds, normalizeState, currentForm, growthForm, viewState, contains, feedFiles };

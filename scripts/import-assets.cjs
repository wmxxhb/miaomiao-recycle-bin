const fs = require('node:fs/promises');
const path = require('node:path');
const { readJSON, assetFile, glbDocument, loadAssetBundle } = require('../app/asset-files.cjs');
const { ACTION_IDS } = require('../app/asset-labels.cjs');
const { FORM_NAMES, contains } = require('../app/core.cjs');

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function exportedRuntime(folder) {
  const dump = await readJSON(path.join(folder, 'dump.json'));
  if (!Array.isArray(dump.forms) || !Array.isArray(dump.chain?.forms)) throw new Error('dump.json 不是支持的 rocom-pets 解包结果');
  return Promise.all(FORM_NAMES.map(async name => {
    const declared = dump.chain.forms.find(f => f.name === name), raw = dump.forms.find(f => f.asset === declared?.asset);
    if (!raw) throw new Error('缺少形态：' + name);
    const doc = await glbDocument(await assetFile(folder, raw.model));
    const clips = (doc.animations || []).map(anim => {
      const accessors = anim.samplers.map(s => doc.accessors[s.input]);
      return { id: anim.name, label: ACTION_IDS[anim.name] || anim.name, durationSeconds: Math.max(...accessors.map(a => a.max[0])) - Math.min(...accessors.map(a => a.min[0])), curves: raw.clips.find(c => c.logical === anim.name)?.curves || {} };
    });
    const materials = Object.fromEntries(raw.slots.map(slot => {
      const textures = {}, visited = new Set(), direct = raw.materials[raw.slot_paths[slot]];
      let material = direct;
      while (material && !visited.has(material.path)) {
        visited.add(material.path);
        for (const t of material.textures || []) if (t.path && !textures[t.name] && raw.textures[t.path]) textures[t.name] = raw.textures[t.path].file;
        material = raw.materials[material.parent?.path];
      }
      return [slot, { textures, face: !!textures.EyeTex, curve: slot.endsWith('_Mh') ? 'EC_Mouth' : 'EC_Eye', twoSided: !!direct?.two_sided }];
    }));
    return { id: raw.asset, name, model: raw.model, materials, clips };
  }));
}
async function importAssets({ from, to, replace = false }) {
  from = await fs.realpath(from); to = path.resolve(to);
  if (contains(from, to) || contains(to, from)) throw new Error('导入来源与目标目录不能相同或互相包含');
  if (await exists(path.join(to, 'runtime.json')) && !replace) throw new Error('目标已有素材；如需覆盖，请明确加上 --replace');
  let directory = from, runtime;
  if (!await exists(path.join(from, 'runtime.json'))) {
    directory = undefined;
    for (const candidate of [from, path.join(from, 'source/packs/002-喵喵'), path.join(from, '002-喵喵'), path.join(from, 'packs/002-喵喵')]) if (await exists(path.join(candidate, 'dump.json'))) { directory = candidate; break; }
    if (!directory) throw new Error('找不到 runtime.json 或喵喵进化链的 dump.json；请先解包导出的宠物包');
    runtime = await exportedRuntime(directory);
  }
  const bundle = await loadAssetBundle(directory, { runtime, models: true });
  await fs.mkdir(to, { recursive: true });
  const realBase=await fs.realpath(to);
  // Validate every referenced file before writing. Do not copy logs, voice files or settings.
  for (const relative of bundle.files) {
    const source = await assetFile(directory, relative), target = path.join(to, relative);
    let parent=to;
    for(const part of relative.split('/').slice(0,-1)){
      parent=path.join(parent,part);
      try{if((await fs.lstat(parent)).isSymbolicLink())throw new Error('目标目录链接指向目录外部');}
      catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(parent);}
      if(!contains(realBase,await fs.realpath(parent)))throw new Error('目标目录链接指向目录外部');
    }
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('不能覆盖链接文件'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.copyFile(source, target);
  }
  await fs.mkdir(to, { recursive: true });
  const manifest = path.join(to, 'runtime.json');
  if (await exists(manifest) && (await fs.lstat(manifest)).isSymbolicLink()) throw new Error('素材清单不能是链接文件');
  await fs.writeFile(manifest + '.tmp', JSON.stringify(bundle.forms, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(manifest + '.tmp', manifest);
  return bundle;
}
if (require.main === module) {
  const args = process.argv.slice(2), fromIndex = args.indexOf('--from'), intoIndex = args.indexOf('--into');
  if (fromIndex < 0 || !args[fromIndex + 1]) { console.error('用法：npm run assets:import -- --from "本机导出目录" [--into "目标目录"] [--replace]'); process.exitCode = 1; }
  else importAssets({ from: args[fromIndex + 1], to: intoIndex >= 0 ? args[intoIndex + 1] : path.resolve(__dirname, '../resources/miaomiao'), replace: args.includes('--replace') }).then(bundle => console.log(`已导入 ${bundle.forms.length} 个形态；素材仅保存在本机，Git 会忽略它们。`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { importAssets, exportedRuntime };

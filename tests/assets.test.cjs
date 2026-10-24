const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {relativeAsset,assetFile,glbDocument,normalizeRuntime,loadAssetBundle}=require('../app/asset-files.cjs');
const {importAssets}=require('../scripts/import-assets.cjs');
const {forms,glb,bundle}=require('./fixtures/assets.cjs');
test('asset manifest rejects paths, missing clips, invalid curves and remote resources',async t=>{
  for(const file of ['../secret.png','C:/secret.png','//host/a.png','safe/../secret.png','safe\\secret.png','image.png:stream'])assert.throws(()=>relativeAsset(file));
  const runtime=forms();runtime[0].clips.pop();assert.throws(()=>normalizeRuntime(runtime),/27/);
  const invalid=forms();invalid[0].clips[0].curves.EC_Eye=[[NaN,100]];assert.throws(()=>normalizeRuntime(invalid),/曲线/);
  const {folder}=await bundle(t),file=path.join(folder,'remote.glb');await fs.writeFile(file,glb({buffers:[{uri:'https://example.com/private'}]}));await assert.rejects(glbDocument(file),/外部/);
});
test('validated imports copy only referenced data and leave settings and logs behind',async t=>{
  const {folder,directory}=await bundle(t),target=path.join(folder,'imported');await fs.writeFile(path.join(directory,'ai-secrets.json'),'private fixture');await fs.writeFile(path.join(directory,'export.log'),'private path fixture');
  await importAssets({from:directory,to:target});const loaded=await loadAssetBundle(target,{models:true});assert.equal(loaded.forms.length,3);assert.equal(loaded.files.size,6);
  await assert.rejects(fs.access(path.join(target,'ai-secrets.json')));await assert.rejects(fs.access(path.join(target,'export.log')));await assert.rejects(importAssets({from:directory,to:target}),/--replace/);
});
test('links cannot redirect imported reads or writes outside the selected directories',async t=>{
  const {folder,directory}=await bundle(t),outside=path.join(folder,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.png'),'private fixture');await fs.symlink(outside,path.join(directory,'escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(assetFile(directory,'escape/private.png'),/外部/);
  const target=path.join(folder,'destination');await fs.mkdir(target);await fs.symlink(outside,path.join(target,'forms'),process.platform==='win32'?'junction':'dir');await assert.rejects(importAssets({from:directory,to:target}),/外部/);await assert.rejects(fs.access(path.join(outside,'0/model.glb')));
});

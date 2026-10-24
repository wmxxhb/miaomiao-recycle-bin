const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeState, currentForm, viewState, feedFiles,validThresholds } = require('../app/core.cjs');

test('growth evolves at 10 and 30 feeds; manual choice preserves growth', () => {
  for (const [feeds, form] of [[0,0],[9,0],[10,1],[29,1],[30,2],[100,2]]) {
    assert.equal(currentForm(normalizeState({ feeds })), form);
  }
  const manual = normalizeState({ feeds:30, mode:'manual', manualForm:0 });
  assert.equal(currentForm(manual),0);
  assert.equal(currentForm({ ...manual, mode:'growth' }),2);
  assert.equal(viewState(normalizeState({ feeds:20 })).progress,.5);
});
test('invalid saved data returns to usable defaults', () => {
  const state=normalizeState({ feeds:-3, mode:'other', manualForm:8, position:{x:NaN,y:1} });
  assert.equal(state.feeds,0); assert.equal(state.mode,'growth'); assert.equal(state.manualForm,0);assert.equal(state.position,null);
});
test('protected folders and their parents never reach the recycle API', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-guard-'));
  const calls=[];
  const result=await feedFiles([folder,path.join(folder,'keep.txt')],{trashItem:async p=>calls.push(p),protectedPaths:[folder]});
  assert.equal(calls.length,0);assert.equal(result.count,0);assert.equal(result.rejected.length,2);
});
test('a parent folder and its descendants are recycled only once', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-batch-'));
  const child=path.join(folder,'child.txt');await fs.writeFile(child,'test fixture');
  const calls=[];
  const result=await feedFiles([child,folder,folder],{trashItem:async p=>calls.push(p),verifyRemoval:false});
  assert.deepEqual(calls,[folder]);assert.equal(result.count,1);
});
test('a failed system recycle is reported and does not count as feeding', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-failure-'));
  const file=path.join(folder,'keep.txt');await fs.writeFile(file,'fixture');
  const result=await feedFiles([file],{trashItem:async()=>{throw new Error('file locked');}});
  assert.equal(result.count,0);assert.equal(result.rejected[0].message,'file locked');
  assert.equal(await fs.readFile(file,'utf8'),'fixture');
});

test('custom cumulative thresholds migrate old state and keep manual progress meaningful',()=>{
  assert.deepEqual(normalizeState({feeds:8}).thresholds,[10,30]);
  assert.equal(normalizeState({}).scale,1);
  const state=normalizeState({feeds:8,thresholds:[5,12],mode:'manual',manualForm:0,scale:1.5});
  assert.equal(currentForm(state),0);assert.equal(viewState(state).growthForm,1);assert.equal(viewState(state).next,12);
  assert.ok(Math.abs(viewState(state).progress-3/7)<1e-8);
  assert.equal(currentForm({...state,mode:'growth'}),1);
  for(const invalid of [[0,2],[2,2],[3,2],[1.5,4],[1,1000000]])assert.equal(validThresholds(invalid),false);
});

test('a successful callback is counted only after the original file actually disappears',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-removal-'));
  const file=path.join(folder,'fixture.txt');await fs.writeFile(file,'disposable fixture');
  const notified=[];
  const result=await feedFiles([file],{trashItem:async file=>fs.unlink(file),notifyRemoved:async items=>notified.push(...items)});
  assert.equal(result.count,1);assert.equal(result.shellNotified,true);assert.equal(notified[0].path,file);
  await assert.rejects(fs.access(file));
});

test('a system callback leaving the file in place is never reported as successful',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-incomplete-'));
  const file=path.join(folder,'keep.txt');await fs.writeFile(file,'fixture');
  const result=await feedFiles([file],{trashItem:async()=>{}});
  assert.equal(result.count,0);assert.match(result.rejected[0].message,/仍然存在/);
  assert.equal(await fs.readFile(file,'utf8'),'fixture');
});

test('a junction into a protected folder never reaches the recycle API',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-protected-link-'));const protectedFolder=path.join(folder,'protected'),alias=path.join(folder,'alias');await fs.mkdir(protectedFolder);await fs.symlink(protectedFolder,alias,process.platform==='win32'?'junction':'dir');const calls=[];const result=await feedFiles([alias],{protectedPaths:[protectedFolder],trashItem:async p=>calls.push(p)});assert.equal(calls.length,0);assert.equal(result.count,0);assert.equal(result.rejected.length,1);
});

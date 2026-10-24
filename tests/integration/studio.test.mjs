import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStudioServer,loadStudioCatalog} from '../../action-studio/server.mjs';

test('喵喵动作室提供三种形态、81 段真实动画及独立嘴部曲线',async()=>{
  const catalog=await loadStudioCatalog({family:'miaomiao'});
  assert.deepEqual(catalog.forms.map(f=>f.name),['喵喵','喵呜','魔力猫']);assert.equal(catalog.totalTracks,81);
  for(const form of catalog.forms){
    assert.equal(form.clips.length,27);
    assert.ok(form.clips.every(c=>c.durationSeconds>0));
    const model=decodeURIComponent(form.modelUrl.replace('/assets/miaomiao/',''));
    const bytes=await readFile(new URL('../../resources/miaomiao/'+model,import.meta.url));
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.deepEqual(json.animations.map(a=>a.name).sort(),form.clips.map(c=>c.id).sort());
  }
  const mouth=Object.values(catalog.forms[0].materialSpecs).find(s=>s.curve==='EC_Mouth');
  assert.ok(mouth.eye);assert.ok(mouth.textures.EyeTex);
  assert.ok(catalog.forms[0].clips.some(c=>c.mouthCurve.length));
});

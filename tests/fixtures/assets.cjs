const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ACTION_IDS}=require('../../app/asset-labels.cjs');
const {FORM_NAMES}=require('../../app/core.cjs');
const {leafPNG}=require('../../app/tray-icon.cjs');
// Synthetic test data: no game geometry, animation keys, textures or credentials.
function forms(){return FORM_NAMES.map((name,index)=>({id:'Fixture_'+index,name,model:`forms/${index}/model.glb`,materials:{body:{face:false,textures:{BaseTex:`forms/${index}/body.png`}}},clips:Object.entries(ACTION_IDS).map(([id,label])=>({id,label,durationSeconds:id==='SleepStart'?2:id==='SleepEnd'?1.5:1,curves:{EC_Eye:[[0,100]]}}))}));}
function glb(document){const json=Buffer.from(JSON.stringify(document)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+padded.length,8);header.writeUInt32LE(padded.length,12);header.write('JSON',16);return Buffer.concat([header,padded]);}
async function bundle(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'miaomiao-source-test-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const directory=path.join(folder,'assets'),runtime=forms();for(const form of runtime){await fs.mkdir(path.dirname(path.join(directory,form.model)),{recursive:true});await fs.writeFile(path.join(directory,form.model),glb({asset:{version:'2.0'},accessors:[{min:[0],max:[2]}],animations:form.clips.map(c=>({name:c.id,samplers:[{input:0}]}))}));await fs.writeFile(path.join(directory,form.materials.body.textures.BaseTex),leafPNG());}await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify(runtime));return {folder,directory,runtime};}
module.exports={forms,glb,bundle};

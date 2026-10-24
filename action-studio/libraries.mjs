import { resolve } from 'node:path';
import assets from '../app/asset-files.cjs';
export function librariesFor(root){
  return {miaomiao:{id:'miaomiao',name:'喵喵 → 喵呜 → 魔力猫',folder:resolve(root,'resources/miaomiao')}};
}
export async function loadMiaomiao(library){
  const bundle=await assets.loadAssetBundle(library.folder);
  const url=p=>'/assets/miaomiao/'+p.split('/').map(encodeURIComponent).join('/');
  const forms=bundle.forms.map(form=>{
    const materialSpecs=Object.fromEntries(Object.entries(form.materials).map(([slot,spec])=>[slot,{textures:Object.fromEntries(Object.entries(spec.textures).map(([key,path])=>[key,url(path)])),eye:spec.face,curve:spec.curve,alpha:false,twoSided:spec.twoSided}]));
    return {id:form.id,name:form.name,modelUrl:url(form.model),materialSpecs,warnings:[],unexportedCount:0,
      clips:form.clips.map(clip=>({...clip,previewUrl:null,faceCurve:clip.curves.EC_Eye||[],mouthCurve:clip.curves.EC_Mouth||[]}))};
  });
  return {forms,references:[],sourceFingerprint:bundle.fingerprint,totalTracks:forms.reduce((sum,f)=>sum+f.clips.length,0),glassyUrl:bundle.files.has('source/packs/glassy/glassy-dump.json')?url('source/packs/glassy/glassy-dump.json'):null,glassyBase:'/assets/miaomiao/source/packs/glassy/'};
}

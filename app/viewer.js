import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ActionPlayer } from './actions.js';
const asset = p => '/resources/miaomiao/' + p.split('/').map(encodeURIComponent).join('/');
function faceIndex(curve, time) {
  let value = 100;
  for (const [at, cell] of curve || []) { if (at > time) break; value = cell; }
  return Math.max(0, Math.min(7, Math.round(value / 100) - 1));
}

export class PetViewer {
  constructor(mount) {
    this.mount = mount; this.loadToken = 0; this.cache = new Map();
    this.renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true, powerPreference:'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio * 1.5, 4));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0,0);
    mount.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfffdf5, 0xa3b28a, 2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3,5,5); this.scene.add(key);
    this.camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
    this.last = performance.now(); this.targetFPS = 60; this.nextFrameAt = 0; this.renderedFrames = 0;
    new ResizeObserver(() => this.resize()).observe(mount);
    this.renderer.setAnimationLoop(now => {
      if (now + .75 < this.nextFrameAt) return;
      const interval = 1000 / this.targetFPS;
      this.nextFrameAt += interval;
      // Preserve the cadence on displays above 60 Hz; discard missed deadlines after a pause.
      if (this.nextFrameAt < now - interval) this.nextFrameAt = now + interval;
      const delta = Math.min((now-this.last)/1000,.1); this.last=now;
      if (this.action && !document.hidden && !this.holding) this.player.advance(delta);
      this.renderer.render(this.scene,this.camera);
      this.renderedFrames++;
    });
  }
  resize() {
    const width=this.mount.clientWidth,height=this.mount.clientHeight;
    if(!width||!height)return;
    const ratio=Math.min(devicePixelRatio*1.5,4);
    if(this.viewport?.width===width&&this.viewport?.height===height&&this.viewport?.ratio===ratio)return;
    this.viewport={width,height,ratio};this.resizeCount=(this.resizeCount||0)+1;
    if(this.renderer.getPixelRatio()!==ratio)this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width,height,false);
    if (this.bounds) this.fit();
    // Do not leave a cleared transparent canvas between a resize and the next animation tick.
    this.renderer.render(this.scene,this.camera);
  }
  async prepare(form) {
    const gltf=await new GLTFLoader().loadAsync(asset(form.model));
    const faces=[];
    const texturePromises=new Map();
    function texture(url) {
      if (!texturePromises.has(url)) texturePromises.set(url,new THREE.TextureLoader().loadAsync(asset(url)));
      return texturePromises.get(url);
    }
    const meshes=[]; gltf.scene.traverse(n=>{if(n.isMesh)meshes.push(n);});
    await Promise.all(meshes.map(async mesh=>{
      const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const replacements=await Promise.all(originals.map(async old=>{
        const spec=form.materials[old.name];
        const url=spec?.textures[spec.face?'EyeTex':'BaseTex'];
        if(!url)throw new Error('缺少贴图：'+old.name);
        const map=(await texture(url)).clone();map.colorSpace=THREE.SRGBColorSpace;map.flipY=false;
        map.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
        if(spec.face){map.generateMipmaps=false;map.minFilter=THREE.LinearFilter;}
        map.needsUpdate=true;
        if(spec.face)faces.push({map,curve:spec.curve});
        return new THREE.MeshToonMaterial({map,color:0xffffff,side:spec.twoSided?THREE.DoubleSide:THREE.FrontSide,
          transparent:spec.face,alphaTest:spec.face?1/255:0,depthWrite:!spec.face,
          polygonOffset:spec.face,polygonOffsetFactor:spec.face?-1:0,polygonOffsetUnits:spec.face?-1:0});
      }));
      mesh.material=Array.isArray(mesh.material)?replacements:replacements[0];mesh.frustumCulled=false;
      mesh.renderOrder=originals.some(m=>form.materials[m.name]?.face)?10:0;
      originals.forEach(m=>m.dispose());
    }));
    for(const p of texturePromises.values())(await p).dispose();
    return {model:gltf.scene,clips:gltf.animations,faces,form,meshes:meshes.length};
  }
  async load(form) {
    const token=++this.loadToken;
    if(!this.cache.has(form.id))this.cache.set(form.id,this.prepare(form));
    const prepared=await this.cache.get(form.id);
    if(token!==this.loadToken)return false;
    if(this.model)this.scene.remove(this.model);
    this.mixer?.stopAllAction();
    Object.assign(this,prepared);
    this.mixer=new THREE.AnimationMixer(this.model);this.scene.add(this.model);
    this.player=new ActionPlayer({durations:new Map(this.clips.map(clip=>[clip.name,clip.duration])),
      start:step=>this.startClip(step.id),sample:time=>this.sampleClip(time),onIdle:()=>this.onIdle?.()});
    this.play('Idle');
    const bounds=new THREE.Box3();
    for(const f of [0,.25,.5,.75,.999]){
      this.action.time=this.action.getClip().duration*f;this.mixer.update(0);
      this.model.updateMatrixWorld(true);bounds.union(new THREE.Box3().setFromObject(this.model,true));
    }
    this.sampleClip(0);this.bounds=bounds;this.fit();
    return true;
  }
  fit() {
    const aspect=this.mount.clientWidth/this.mount.clientHeight;
    const size=this.bounds.getSize(new THREE.Vector3()),center=this.bounds.getCenter(new THREE.Vector3());
    const height=Math.max(size.y,size.x/aspect)*1.28;
    this.camera.left=-height*aspect/2;this.camera.right=height*aspect/2;
    this.camera.top=height/2;this.camera.bottom=-height/2;
    this.camera.position.set(center.x,center.y+.035,center.z+5);
    this.camera.lookAt(center);this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const anchor=y=>{const p=new THREE.Vector3(center.x,y,center.z).project(this.camera);return {x:this.mount.offsetLeft+(p.x+1)*this.mount.clientWidth/2,y:this.mount.offsetTop+(1-p.y)*this.mount.clientHeight/2};};
    this.onLayout?.({head:anchor(this.bounds.max.y),feet:anchor(this.bounds.min.y)});
  }
  play(id) {
    if(!this.mixer)return;
    if(id==='Idle')this.player.idle();
    else this.player.play([{id,loop:id==='SleepLoop'}]);
  }
  trigger(kind) { return this.player.trigger(kind); }
  get isIdle() { return !!this.player?.isIdle; }
  startClip(id) {
    const source=this.clips.find(c=>c.name===id);
    if(!source)throw new Error('模型没有动作：'+id);
    const animation=source.clone();
    animation.tracks=animation.tracks.filter(t=>!/^(Root|root)\.position$/.test(t.name));
    this.mixer.stopAllAction();
    if(this.action)this.mixer.uncacheAction(this.action.getClip());
    this.action=this.mixer.clipAction(animation);this.action.reset().play();this.action.paused=true;
    this.clip=this.form.clips.find(c=>c.id===id);
  }
  sampleClip(time) {
    this.action.time=time;this.mixer.update(0);
    for(const face of this.faces){
      const i=faceIndex(this.clip?.curves?.[face.curve],time);
      face.map.offset.set(i%2*.5,Math.floor(i/2)*.25);
    }
  }
  status() { return { meshes:this.meshes,animation:this.clip?.id,asset:this.form?.id }; }
}

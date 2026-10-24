import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EYES, eyeIndex } from './eyes.js';
import { attachGlassy, GlassyAppearance, DEFAULT_GLASSY } from './glassy.js';

export function createPetMaterial(spec, map, appearance, regionMask) {
  // The game's opaque eye shader still uses EyeTex alpha for its face decal.
  // Standard Three.js materials need that compositing enabled explicitly.
  const faceOverlay = Boolean(spec.eye);
  const transparent = faceOverlay || Boolean(spec.alpha);
  const material = new THREE.MeshToonMaterial({
    map, color: 0xffffff,
    side: spec.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent,
    alphaTest: faceOverlay ? 1 / 255 : transparent ? .05 : 0,
    depthWrite: !transparent,
    depthTest: true,
    // Face patches lie close to the head. Keep them ahead of the skin surface
    // while retaining depth testing so the back eye cannot show through it.
    polygonOffset: faceOverlay,
    polygonOffsetFactor: faceOverlay ? -1 : 0,
    polygonOffsetUnits: faceOverlay ? -1 : 0,
  });
  if (appearance && !faceOverlay && regionMask) attachGlassy(material, appearance, regionMask);
  return material;
}

export class PetViewer {
  constructor(mount, onTime, glassyCatalog) {
    this.mount = mount; this.onTime = onTime;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0, 0);
    mount.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
    this.camera.position.set(0, .6, 2.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .08;
    this.controls.minDistance = .2; this.controls.maxDistance = 12;
    this.scene.add(new THREE.HemisphereLight(0xfffdf4, 0x9d978a, 2.4));
    const key = new THREE.DirectionalLight(0xfff7e5, 2.0); key.position.set(-3, 5, 5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, .7); fill.position.set(4, 2, -2); this.scene.add(fill);
    this.speed = 1; this.loop = true; this.playing = true; this.inPlace = true; this.autoEyes = true; this.outline = true;
    this.eye = 'default';
    this.glassyCatalog = glassyCatalog; this.glassy = { ...DEFAULT_GLASSY };
    this.time = 0; this.duration = 0; this.visualTime = 0; this.loadToken = 0; this.disposed = false;
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(mount);
    this.last = performance.now();
    this.renderer.setAnimationLoop(now => this.tick(now));
  }
  resize() {
    const width = this.mount.clientWidth, height = this.mount.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  disposeModel(model) {
    if (!model) return;
    model.userData.appearance?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    model.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
        materials.add(material);
        for (const v of Object.values(material)) if (v?.isTexture) textures.add(v);
        const regionMask = material.userData?.glassyRegionMask;
        if (regionMask?.isTexture) textures.add(regionMask);
      }
    });
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
    this.scene.remove(model);
  }
  async load(form) {
    const token = ++this.loadToken;
    this.playing = false;
    const gltf = await new GLTFLoader().loadAsync(form.modelUrl);
    if (token !== this.loadToken) { this.disposeModel(gltf.scene); return false; }
    const model = gltf.scene, eyeTextures = [], outlines = [];
    const appearance = new GlassyAppearance(this.glassyCatalog, url => new THREE.TextureLoader().loadAsync(url));
    model.userData.appearance = appearance;
    const textures = new Map();
    const texture = async (url, colorSpace = THREE.SRGBColorSpace) => {
      const key = `${colorSpace}:${url}`;
      if (!textures.has(key)) textures.set(key, new THREE.TextureLoader().loadAsync(url).then(t => {
        t.colorSpace = colorSpace; t.flipY = false; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); return t;
      }));
      return textures.get(key);
    };
    const meshes = [];
    model.traverse(node => { if (node.isMesh) meshes.push(node); });
    await Promise.all(meshes.map(async mesh => {
      const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = await Promise.all(original.map(async old => {
        const spec = form.materialSpecs[old.name];
        const url = spec?.textures[spec.eye ? 'EyeTex' : 'BaseTex'];
        if (!url) return new THREE.MeshToonMaterial({ color: 0xe3d0ae });
        const map = (await texture(url)).clone(); map.needsUpdate = true;
        if (spec.eye) {map.userData.faceCurve=spec.curve||'EC_Eye';map.generateMipmaps=false;map.minFilter=THREE.LinearFilter;eyeTextures.push(map);}
        const maskUrl = !spec.eye && spec.textures.MaskTex;
        const regionMask = maskUrl ? (await texture(maskUrl, THREE.NoColorSpace)).clone() : null;
        if (regionMask) regionMask.needsUpdate = true;
        return createPetMaterial(spec, map, appearance, regionMask);
      }));
      original.forEach(m => m.dispose());
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
      mesh.frustumCulled = false;
      mesh.renderOrder = original.some(m => form.materialSpecs[m.name]?.eye) ? 10 : 0;
      // A back-face shell shares the animated skeleton, so its outline follows every pose.
      if (!original.some(m => form.materialSpecs[m.name]?.eye)) {
        const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x79553b, side: THREE.BackSide });
        outlineMaterial.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.0012;');
        };
        const shell = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, outlineMaterial) : new THREE.Mesh(mesh.geometry, outlineMaterial);
        shell.name = 'preview-outline'; shell.frustumCulled = false;
        if (mesh.isSkinnedMesh) { shell.bindMode = mesh.bindMode; shell.bind(mesh.skeleton, mesh.bindMatrix); }
        mesh.add(shell); outlines.push(shell);
      }
    }));
    // Original cached textures have no GPU allocation until used; dispose them after clones exist.
    for (const promise of textures.values()) (await promise).dispose();
    if (token !== this.loadToken) { this.disposeModel(model); return false; }
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.disposeModel(this.model);
    this.model = model; this.clips = gltf.animations; this.eyeTextures = eyeTextures; this.outlines = outlines;
    this.scene.add(model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.form = form;
    await this.setGlassy(this.glassy);
    if (token !== this.loadToken) return false;
    this.resize();
    return true;
  }
  setClip(clip) {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    if (this.action) this.mixer.uncacheAction(this.action.getClip());
    const data = this.clips.find(c => c.name === clip.id);
    if (!data) throw new Error(`模型内没有动作 ${clip.id}`);
    const animation = data.clone();
    if (this.inPlace) {
      // Keep the exported root's original height and remove only its locomotion track.
      animation.tracks = animation.tracks.filter(track => !/^(Root|root)\.position$/.test(track.name));
    }
    this.currentClip = clip; this.duration = data.duration; this.time = 0;
    this.action = this.mixer.clipAction(animation); this.action.setLoop(THREE.LoopOnce, 1); this.action.clampWhenFinished = true;
    this.action.reset().play(); this.action.paused = true;
    this.playing = true;
    this.sample(0);
    this.fitCamera();
  }
  sample(time) {
    if (!this.action) return;
    this.time = Math.max(0, Math.min(time, this.duration));
    this.action.time = Math.min(this.time, Math.max(0, this.duration - .000001));
    this.mixer.update(0);
    const index = eyeIndex(this.eye, this.currentClip.faceCurve, this.time, this.autoEyes);
    this.eyeTextures.forEach(t => {const cell=t.userData?.faceCurve==='EC_Mouth'?eyeIndex('default',this.currentClip.mouthCurve,this.time,this.autoEyes):index;t.offset.set(cell%2*.5,Math.floor(cell/2)*.25);});
    this.model.updateMatrixWorld(true);
    this.outlines.forEach(shell => { shell.visible = this.outline; });
    this.onTime?.(this.time, this.duration, this.playing);
  }
  setEye(id) {
    if (!EYES.some(option => option.id === id)) throw new Error('未知眼神');
    this.eye = id;
    this.sample(this.time);
  }
  async setGlassy(selection) {
    // A selection is kept across actions and forms, independently of the eye.
    this.glassy = { ...selection };
    const appearance = this.model?.userData.appearance;
    if (!appearance) return;
    try { await appearance.set(selection); }
    catch (error) {
      if (this.model?.userData.appearance === appearance && this.glassy.mode === selection.mode
        && this.glassy.colorId === selection.colorId && this.glassy.particleId === selection.particleId) this.glassy = { ...appearance.selection };
      throw error;
    }
  }
  fitCamera() {
    if (!this.model) return;
    const previousTime = this.time;
    const box = new THREE.Box3();
    if (this.action) {
      for (const fraction of [0, .25, .5, .75, .999]) {
        this.sample(this.duration * fraction);
        box.union(new THREE.Box3().setFromObject(this.model, true));
      }
      this.sample(previousTime);
    } else {
      this.model.updateMatrixWorld(true);
      box.setFromObject(this.model, true);
    }
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, .3);
    const distance = Math.max(height, size.x / this.camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(35 / 2))) * 1.35;
    this.target = center; this.distance = distance;
    this.controls.target.copy(center); this.camera.position.set(center.x, center.y + height * .05, center.z + distance);
    this.controls.update(); this.controls.saveState();
  }
  view(side = false) {
    if (!this.target) return;
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target).add(new THREE.Vector3(side ? this.distance : 0, .03, side ? 0 : this.distance));
    this.controls.update();
  }
  tick(now) {
    if (this.disposed) return;
    const delta = Math.min((now - this.last) / 1000, .1); this.last = now;
    if (!document.hidden && this.action && this.playing) {
      this.visualTime += delta * this.speed;
      let next = this.time + delta * this.speed;
      if (next >= this.duration) { if (this.loop) next %= this.duration; else { next = this.duration; this.playing = false; } }
      this.sample(next);
    }
    this.model?.userData.appearance?.setTime(this.visualTime);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true; this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect();
    this.controls.dispose(); this.disposeModel(this.model); this.renderer.dispose();
  }
}

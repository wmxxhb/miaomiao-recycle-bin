import * as THREE from 'three';

const folder = '/assets/source/packs/glassy/';
const textureUrl = path => folder + encodeURIComponent(path.replace(/'$/, '').split('.').pop()) + '.png';
const plainName = name => name.replace(/<[^>]*>/g, '');
export const DEFAULT_GLASSY = Object.freeze({ mode: 'none', colorId: 1, particleId: 1 });

export function glassyCatalog(raw, base = folder) {
  const textureUrl=path=>base+encodeURIComponent(path.replace(/'$/, '').split('.').pop())+'.png';
  return {
    colors: Object.values(raw.colors).sort((a, b) => a.id - b.id),
    particles: Object.values(raw.particles).sort((a, b) => a.id - b.id).map(p => ({
      id: p.id, name: p.name, texture: textureUrl(p.particle_res), tiling: p.StarStickTiling,
    })),
    hidden: Object.values(raw.hidden).map(h => {
      const textures = Object.fromEntries(h.tex_param.map(p => [p.tex_param_name, textureUrl(p.tex_param_path)]));
      const numbers = Object.fromEntries(h.num_param.map(p => [p.num_param_name, p.num_param_value ?? 0]));
      return { id: h.id, name: plainName(h.name), color1: h.glass_color_1.slice(0, 3), color2: h.glass_color_2.slice(0, 3),
        noise: textures.MainTex, particle: textures.StarStickTex, tiling: numbers.StarStickTiling ?? 2.2,
        flow: [numbers.MainTexFlowSpeedX ?? .08, numbers.MainTexFlowSpeedY ?? .08], strength: numbers.StarIntensity ?? 10 };
    }),
    noise: base + 'Tex_PetGlassy_007_D.png',
  };
}

export function resolveGlassy(catalog, selection) {
  if (selection.mode === 'none') return null;
  if (selection.mode === 'normal') {
    const color = catalog.colors.find(c => c.id === Number(selection.colorId));
    const particle = catalog.particles.find(p => p.id === Number(selection.particleId));
    if (!color || !particle) throw new Error('找不到所选的炫彩配色或粒子');
    return { noise: catalog.noise, particle: particle.texture, color1: color.mat_color_1, color2: color.mat_color_2,
      tiling: particle.tiling, flow: [.08, .08], strength: color.shine_strength };
  }
  const hidden = catalog.hidden.find(h => selection.mode === `hidden:${h.id}`);
  if (!hidden) throw new Error('找不到所选的炫彩');
  return hidden;
}

// Preview shader built for this viewer. Source palettes and texture channels are
// retained; the original game's refraction, bloom and material layers are not reproduced.
export function attachGlassy(material, appearance, regionMask) {
  if (!regionMask) return;
  material.userData.glassyRegionMask = regionMask;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, appearance.uniforms);
    shader.uniforms.studioGlassyRegionMask = { value: regionMask };
    shader.fragmentShader = `
      uniform float studioGlassyEnabled;
      uniform float studioGlassyTime;
      uniform sampler2D studioGlassyNoise;
      uniform sampler2D studioGlassyStars;
      uniform sampler2D studioGlassyRegionMask;
      uniform vec3 studioGlassyColor1;
      uniform vec3 studioGlassyColor2;
      uniform vec2 studioGlassyFlow;
      uniform float studioGlassyTiling;
      uniform float studioGlassyStrength;
    ` + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      // MaskTex alpha stores material regions, not body opacity. In these source
      // models, the high-ID region (about 0.7 / 0.8) is the glassy surface;
      // the low IDs (0 / about 0.2 / 0.3) keep their original material.
      float glassyRegion = step(0.5, texture2D(studioGlassyRegionMask, vMapUv).a);
      if (studioGlassyEnabled > 0.5 && glassyRegion > 0.0) {
        vec2 glassyUv = vMapUv + studioGlassyTime * studioGlassyFlow;
        vec3 noise = texture2D(studioGlassyNoise, glassyUv).rgb;
        float blend = noise.g / max(noise.r + noise.g, 0.001);
        vec3 glassyColor = mix(studioGlassyColor1, studioGlassyColor2, blend);
        float detail = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float star = texture2D(studioGlassyStars, vMapUv * studioGlassyTiling).b;
        float pulse = 0.65 + 0.35 * sin(studioGlassyTime * 2.0 + vMapUv.x * 18.0);
        vec3 glassySurface = glassyColor * (0.65 + 0.35 * detail)
          + vec3(star * pulse * studioGlassyStrength);
        diffuseColor.rgb = mix(diffuseColor.rgb, glassySurface, glassyRegion);
      }
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'studio-glassy-regions-v2';
}

export class GlassyAppearance {
  constructor(catalog, loadTexture) {
    this.catalog = catalog; this.loadTexture = loadTexture; this.revision = 0;
    this.cache = new Map(); this.textures = new Set(); this.disposed = false;
    this.selection = { ...DEFAULT_GLASSY };
    this.uniforms = {
      studioGlassyEnabled: { value: 0 }, studioGlassyTime: { value: 0 },
      studioGlassyNoise: { value: null }, studioGlassyStars: { value: null },
      studioGlassyColor1: { value: new THREE.Vector3() }, studioGlassyColor2: { value: new THREE.Vector3() },
      studioGlassyFlow: { value: new THREE.Vector2() }, studioGlassyTiling: { value: 1 }, studioGlassyStrength: { value: 0 },
    };
  }
  texture(url) {
    if (!this.cache.has(url)) {
      const pending = Promise.resolve().then(() => this.loadTexture(url)).then(texture => {
        texture.colorSpace = THREE.NoColorSpace;
        texture.flipY = false; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        if (this.disposed) texture.dispose(); else this.textures.add(texture);
        return texture;
      }).catch(error => { this.cache.delete(url); throw error; });
      this.cache.set(url, pending);
    }
    return this.cache.get(url);
  }
  async set(selection) {
    const look = resolveGlassy(this.catalog, selection);
    const revision = ++this.revision;
    if (this.disposed) return false;
    if (!look) {
      this.uniforms.studioGlassyEnabled.value = 0;
      this.selection = { ...selection }; return true;
    }
    let noise, stars;
    try { [noise, stars] = await Promise.all([this.texture(look.noise), this.texture(look.particle)]); }
    catch (error) {
      if (this.disposed || revision !== this.revision) return false;
      throw error;
    }
    if (this.disposed || revision !== this.revision) return false;
    const u = this.uniforms;
    u.studioGlassyNoise.value = noise; u.studioGlassyStars.value = stars;
    u.studioGlassyColor1.value.fromArray(look.color1); u.studioGlassyColor2.value.fromArray(look.color2);
    u.studioGlassyFlow.value.fromArray(look.flow); u.studioGlassyTiling.value = look.tiling;
    u.studioGlassyStrength.value = Math.min(2, Math.max(0, look.strength * .12));
    u.studioGlassyEnabled.value = 1; this.selection = { ...selection }; return true;
  }
  setTime(time) { this.uniforms.studioGlassyTime.value = time; }
  dispose() {
    this.disposed = true; this.revision++; this.uniforms.studioGlassyEnabled.value = 0;
    this.textures.forEach(texture => texture.dispose()); this.textures.clear(); this.cache.clear();
  }
}

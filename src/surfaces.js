// Textured PBR surfaces for the city.
//
// All surface textures live in two texture arrays (one draw call can use any layer):
//   tAlb  colour, alpha = cut-out              (KTX2 / ETC1S)
//   tDet  normal XY, roughness, ambient occl.  (KTX2 / UASTC + zstd)
// Layers come from ambientCG (CC0), packed by tools/textures/. "Tint" layers are
// stored neutral grey so one plaster texture can be painted any colour per instance.
//
// Materials here are MeshStandardMaterial with a few shader additions:
//  - box mapping for instanced boxes (UVs from the box's own size, no UV data needed)
//  - a layer per instance (iLayer) or per vertex (uvl.z)
//  - weathering: a damp, dirty band near the ground and faint rain streaks
//  - baked contact occlusion where walls meet the ground
// Low-power quality compiles them without normal maps or weathering (DC_LOW).
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// 10 and 11 have no texture: plain painted ground, and water (glossy, rippling)
export const L = { plaster: 0, concrete: 1, brick: 2, asphalt: 3, paving: 4, steel: 5, bark: 6, leaves: 7, manhole: 8, paint: 9, plain: 10, water: 11 };
const N = 9;

// shared by every surface material; textures are swapped in when they finish loading
const flatArray = (rgba) => { const d = new Uint8Array(4 * N); for (let i = 0; i < N; i++) d.set(rgba, i * 4); const t = new THREE.DataArrayTexture(d, 1, 1, N); t.needsUpdate = true; return t; };
export const surfaceUniforms = {
  tAlb: { value: flatArray([128, 128, 128, 255]) },
  tDet: { value: flatArray([128, 128, 200, 255]) },
  uTime: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
};
const materials = new Set();
let low = false;
export function setSurfaceQuality(isLow) {
  if (low === isLow) return;
  low = isLow;
  for (const m of materials) { if (low) m.defines.DC_LOW = 1; else delete m.defines.DC_LOW; m.needsUpdate = true; }
}

// ---- loading -----------------------------------------------------------------------
export async function loadSurfaces(renderer, scene) {
  const ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  const get = (f) => ktx.loadAsync('/textures/' + f);
  const [alb, det] = await Promise.all([
    Promise.all(Array.from({ length: N }, (_, i) => get(`c${i}.ktx2`))),
    Promise.all(Array.from({ length: N }, (_, i) => get(`n${i}.ktx2`))),
  ]);
  const a = toArray(alb, THREE.SRGBColorSpace), d = toArray(det, THREE.NoColorSpace);
  if (a) surfaceUniforms.tAlb.value = a;
  if (d) surfaceUniforms.tDet.value = d;
  ktx.dispose();
  // image-based light: a small dusk HDRI, prefiltered once
  const hdr = await new RGBELoader().loadAsync('/env/venice_sunset_1k.hdr');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
}

// stack same-format compressed textures into one array texture, mip level by mip level
function toArray(list, colorSpace) {
  const t0 = list[0];
  if (list.some((t) => t.format !== t0.format || t.mipmaps.length !== t0.mipmaps.length)) { console.warn('surface layers transcoded to different formats; using flat colours'); return null; }
  const mipmaps = t0.mipmaps.map((m, i) => {
    const size = list.reduce((s, t) => s + t.mipmaps[i].data.byteLength, 0), data = new Uint8Array(size);
    let o = 0; for (const t of list) { data.set(t.mipmaps[i].data, o); o += t.mipmaps[i].data.byteLength; }
    return { data, width: m.width, height: m.height };
  });
  const arr = new THREE.CompressedArrayTexture(mipmaps, t0.image.width, t0.image.height, list.length, t0.format, t0.type);
  arr.colorSpace = colorSpace;
  arr.wrapS = arr.wrapT = THREE.RepeatWrapping;
  arr.minFilter = THREE.LinearMipmapLinearFilter; arr.magFilter = THREE.LinearFilter;
  arr.generateMipmaps = false; arr.anisotropy = 4; arr.needsUpdate = true;
  list.forEach((t) => t.dispose());
  return arr;
}

// ---- shader pieces -------------------------------------------------------------------
const COMMON = /* glsl */ `
uniform highp sampler2DArray tAlb, tDet;
uniform float uTime, uWet, uNight;
varying vec3 vUvl;      // uv (already in texture repeats), layer
varying vec3 vWPos;     // world position
varying vec3 vWNrm;     // world normal
float dcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dcHash(i), dcHash(i + vec2(1, 0)), f.x), mix(dcHash(i + vec2(0, 1)), dcHash(i + vec2(1, 1)), f.x), f.y);
}`;

// tile size (metres per repeat) and whether the layer takes the instance colour
const LAYER_TABLE = /* glsl */ `
const float DC_TILE[12] = float[12](2.4, 2.0, 1.4, 4.5, 1.6, 1.3, 1.2, 1.0, 1.0, 4.5, 2.0, 2.0);
const float DC_TINT[12] = float[12](1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
const float DC_METAL[12] = float[12](0.0, 0.0, 0.0, 0.0, 0.0, 0.45, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0);`;

const VERT_OUT = /* glsl */ `
  {
    vec4 wp = vec4(transformed, 1.0);
    vec3 wn = objectNormal;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
    #endif
    vWPos = (modelMatrix * wp).xyz;
    vWNrm = normalize(mat3(modelMatrix) * wn);
  }`;

// fragment: colour, detail, weathering, occlusion (shared by all surface materials)
const FRAG_SURFACE = /* glsl */ `
  int li = int(vUvl.z + 0.5);
  float isPaint = li == 9 ? 1.0 : 0.0;
  bool plain = li >= 10;
  float tl = isPaint > 0.5 ? 3.0 : vUvl.z;
  // ground is seen at grazing angles: sample it a touch softer (mip bias) so pavers
  // and asphalt never sparkle while you walk; walls keep their crispness
  float dcBias = vWNrm.y > 0.7 ? 0.9 : 0.25;
  vec4 alb = plain ? vec4(1.0) : texture(tAlb, vec3(vUvl.xy, tl), dcBias);
  if (!plain) {
    // calmer texture: pull each layer towards its own average colour
    vec3 avgC = textureLod(tAlb, vec3(0.5, 0.5, tl), 9.0).rgb;
    alb.rgb = mix(avgC, alb.rgb, (li == 3 || li == 4 || li == 9) ? 0.5 : 0.8);
  }
  float dcFlat = 0.0, dcMetal = 0.0, dcNoTint = 0.0; vec3 dcGlow = vec3(0.0);
  // texture detail fades as it shrinks on screen: no sparkling normal maps at a distance
  float dcDetail = 1.0 - smoothstep(0.04, 0.2, length(fwidth(vUvl.xy)));
  #ifdef DC_CUTOUT
    if (alb.a < 0.45) discard;
  #endif
  if (li == 8 && alb.a < 0.5) discard; // manhole decal
  vec3 tex = alb.rgb * (DC_TINT[li] > 0.5 ? 4.63 : 1.0);
  #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  if (isPaint > 0.5) {
    // road paint, worn through to the asphalt in patches
    float worn = smoothstep(0.42, 0.8, dcNoise(vWPos.xz * 1.7) * 0.7 + dcNoise(vWPos.xz * 11.0) * 0.3);
    tex = mix(vColor * (0.75 + alb.rgb * 0.9), alb.rgb, worn * 0.8);
  }
  #endif
  diffuseColor.rgb *= tex;
  float dcRough = 0.85, dcAO = 1.0;
  #ifndef DC_LOW
    vec4 det = plain ? vec4(0.5, 0.5, li == 11 ? 0.05 : 0.9, 1.0) : texture(tDet, vec3(vUvl.xy, tl), dcBias);
    if (li == 11) { // water: slow ripples, darker and clearer than paint
      float t = uTime * 0.6;
      det.rg += vec2(dcNoise(vWPos.xz * 1.3 + t) - dcNoise(vWPos.xz * 1.3 - t + 3.1), dcNoise(vWPos.zx * 1.7 + t * 0.7) - 0.5) * 0.18;
    }
    dcRough = mix(0.8, det.b, dcDetail); dcAO = mix(1.0, det.a, dcDetail);
    // weathering on walls: a damp band at the foot, faint streaks running down
    float vert = 1.0 - smoothstep(0.35, 0.75, abs(vWNrm.y));
    float h = vWPos.y - 0.25;
    float foot = (1.0 - smoothstep(0.0, 0.9 + dcNoise(vWPos.xz * 2.0) * 0.4, h)) * vert;
    float streak = smoothstep(0.62, 0.95, dcNoise(vec2((vWPos.x + vWPos.z) * 5.0, vWPos.y * 0.35))) * vert * step(1.2, h);
    float grime = foot * 0.32 + streak * 0.12;
    // ground: darker, oilier where tyres and feet go
    float flatUp = smoothstep(0.75, 0.95, vWNrm.y);
    grime += flatUp * (dcNoise(vWPos.xz * 0.35) * 0.12 + dcNoise(vWPos.xz * 3.1) * 0.05);
    diffuseColor.rgb *= 1.0 - grime;
    dcRough = clamp(dcRough + grime * 0.15 - uWet * 0.4, 0.04, 1.0);
    // baked contact occlusion where a wall meets the ground
    dcAO *= mix(0.5, 1.0, smoothstep(0.0, 1.4, h)) * vert + (1.0 - vert);
    // monsoon: everything darkens and turns glossy, and puddles collect on the ground
    float puddle = uWet * flatUp * smoothstep(0.58, 0.72, dcNoise(vWPos.xz * 0.42) * 0.75 + dcNoise(vWPos.xz * 2.3) * 0.25);
    diffuseColor.rgb *= 1.0 - uWet * (0.22 * flatUp + 0.12 * vert) - puddle * 0.3;
    dcRough = mix(dcRough, 0.03, puddle);
    dcFlat = max(dcFlat, puddle);
  #endif`;

function patch(m, { vertexPre = '', vertexBody = '', fragPre = '', fragExtra = '', uniforms = {}, cutout = false, key }) {
  m.defines = { ...(m.defines || {}), ...(cutout ? { DC_CUTOUT: 1 } : {}), ...(low ? { DC_LOW: 1 } : {}) };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, surfaceUniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + LAYER_TABLE + vertexPre)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertexBody)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_OUT);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON + LAYER_TABLE + fragPre + `
mat3 dcTBN(vec3 p, vec3 n, vec2 uv) {
  vec3 q0 = dFdx(p), q1 = dFdy(p); vec2 s0 = dFdx(uv), s1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * s0.x + q0p * s1.x, B = q1p * s0.y + q0p * s1.y;
  float d = max(dot(T, T), dot(B, B)), sc = d == 0.0 ? 0.0 : inversesqrt(d);
  return mat3(T * sc, B * sc, n);
}`)
      .replace('#include <map_fragment>', FRAG_SURFACE + fragExtra)
      .replace('#include <color_fragment>', `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  if (isPaint < 0.5) diffuseColor.rgb *= mix(vColor, vec3(1.0), dcNoTint);
#endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix(dcRough, 0.06, dcFlat);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = max(max(metalness, DC_METAL[li]), dcMetal);')
      .replace('#include <normal_fragment_maps>', `#ifndef DC_LOW
  { vec3 mn = vec3((det.rg * 2.0 - 1.0) * dcDetail, 0.0); mn.z = sqrt(max(0.0, 1.0 - dot(mn.xy, mn.xy)));
    mn = normalize(mix(mn, vec3(0.0, 0.0, 1.0), dcFlat));
    normal = normalize(dcTBN(-vViewPosition, normal, vUvl.xy) * mn); }
#endif`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += dcGlow;')
      .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= dcAO; reflectedLight.indirectSpecular *= dcAO;`);
  };
  m.customProgramCacheKey = () => key + (low ? '-low' : '');
  materials.add(m);
  return m;
}

// Instanced unit boxes (InstanceBin): UVs come from the box's own size, so a 6 m wall
// and a 0.1 m grille bar both get correctly scaled texture. Layer per instance.
export function boxSurface({ roughness = 1, envMapIntensity = 0.8 } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness: 0, envMapIntensity });
  return patch(m, {
    key: 'dc-box',
    vertexPre: '\nattribute float iLayer;',
    vertexBody: `
  {
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec3 lp = position * sc + vec3(instanceMatrix[3].x * 0.37, 0.0, instanceMatrix[3].z * 0.29);
    vec3 an = abs(normal);
    vec2 uv = an.x > 0.5 ? lp.zy : an.y > 0.5 ? lp.xz : lp.xy;
    int li = int(iLayer + 0.5);
    vUvl = vec3(uv / DC_TILE[li], iLayer);
  }`,
  });
}

// The buildings that fill the blocks: plain boxes, so their facades are drawn in the
// shader. Windows sit on a grid in metres on each wall: a frame and sill around
// dark, reflective glass; offices (concrete layer) get ribbon glazing instead; after
// dark a random share of rooms light up. Layer 5 (steel: tanks, crowns) has none.
const WINDOWS = /* glsl */ `
  if (vFace.z > 0.5 && li <= 1 && vFace.y > 3.4) {
    bool tech = li == 1;
    float fh = tech ? 3.5 : 3.0, bw = tech ? 1.9 : 2.7;
    vec2 cell = vec2(vFace.x / bw, (vFace.y - 0.4) / fh), f = fract(cell), id = floor(cell);
    // far away the grid gets finer than a pixel: fade it into its average so towers
    // don't sparkle (the same job mipmaps do for textures)
    vec2 fw = fwidth(cell);
    float far = smoothstep(0.18, 0.45, max(fw.x, fw.y));
    vec2 lo = tech ? vec2(0.03, 0.2) : vec2(0.27, 0.3), hi = tech ? vec2(0.97, 0.92) : vec2(0.73, 0.8);
    vec2 ex = vec2(0.07 / bw, 0.07 / fh);
    float win = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
    float fr = step(lo.x - ex.x, f.x) * step(f.x, hi.x + ex.x) * step(lo.y - ex.y, f.y) * step(f.y, hi.y + ex.y) - win;
    float sill = tech ? 0.0 : step(lo.x - ex.x * 2.0, f.x) * step(f.x, hi.x + ex.x * 2.0) * step(lo.y - ex.y * 2.2, f.y) * step(f.y, lo.y - ex.y);
    float shade = tech ? 0.0 : step(hi.y + ex.y, f.y) * step(f.y, hi.y + ex.y * 2.5) * step(lo.x - ex.x * 2.5, f.x) * step(f.x, hi.x + ex.x * 2.5);
    float mull = tech ? step(abs(f.x - 0.5), 0.012) * win : step(abs(f.x - 0.5), 0.015) * win;
    float rnd = dcHash(id + vSeed); // one draw per window, seeded by the building (not the pixel)
    float lit = step(mix(0.86, 0.5, uNight), rnd) * win * (1.0 - mull);
    vec3 glass = mix(vec3(0.045, 0.055, 0.065), vec3(0.08, 0.09, 0.1), rnd);
    // glass is darker at the top of the opening (the lintel's shadow)
    glass *= 1.0 - 0.35 * smoothstep(hi.y - 0.12, hi.y, f.y);
    float keep = 1.0 - far;
    win *= keep; fr *= keep; sill *= keep; shade *= keep; mull *= keep; lit *= keep;
    vec3 wall = diffuseColor.rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, tech ? vec3(0.17, 0.18, 0.19) : vec3(0.9, 0.88, 0.84), clamp(fr + sill + mull, 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.13, 0.1), shade * 0.85); // maroon sunshade line over each window
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * (1.0 - mull));
    // the averaged look: wall darkened by the share of glass
    diffuseColor.rgb = mix(diffuseColor.rgb, wall * (tech ? 0.42 : 0.72), far * 0.85);
    dcFlat = win; dcMetal = win * 0.15; dcNoTint = clamp(fr + sill + win + shade, 0.0, 1.0);
    dcGlow = vec3(1.0, 0.76, 0.46) * (lit * (0.55 + 0.45 * f.y) * 1.2 + far * mix(0.14, 0.5, uNight) * 0.45 * step(0.5, uNight)) * uNight;
  }`;
export function blockSurface() {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.8 });
  return patch(m, {
    key: 'dc-block',
    vertexPre: '\nattribute float iLayer;\nvarying vec3 vFace;\nvarying vec2 vSeed;',
    fragPre: '\nvarying vec3 vFace;\nvarying vec2 vSeed;',
    vertexBody: `
  {
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec3 lp = position * sc;
    vec3 an = abs(normal);
    vec2 uv = an.x > 0.5 ? lp.zy : an.y > 0.5 ? lp.xz : lp.xy;
    vFace = vec3(uv.x + (an.x > 0.5 ? sc.z : sc.x) * 0.5, uv.y, an.y < 0.5 ? 1.0 : 0.0);
    vSeed = floor(instanceMatrix[3].xz * 0.37) + (an.x > 0.5 ? vec2(17.0, 0.0) : vec2(0.0, 29.0));
    int li = int(iLayer + 0.5);
    vUvl = vec3((uv + vec2(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29, 0.0)) / DC_TILE[li], iLayer);
  }`,
    fragExtra: '\n  ' + WINDOWS,
  });
}

// Ground decals with explicit uv + layer per vertex (attribute uvl), colour per vertex.
export function flatSurface() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.6 });
  return patch(m, { key: 'dc-flat', vertexPre: '\nattribute vec3 uvl;', vertexBody: '  vUvl = uvl;' });
}

// Street furniture (merged, vertex-coloured): keeps its paint colours and gets the
// concrete layer's fine surface detail, mapped from world position.
export function propSurface({ vertexColors = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors, roughness: 0.9, metalness: 0, envMapIntensity: 0.7 });
  return patch(m, {
    key: 'dc-prop' + (vertexColors ? '' : '-i'),
    vertexBody: `
  {
    vec3 an = abs(normal);
    vec4 lp4 = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      lp4 = instanceMatrix * lp4;
    #endif
    vec3 p = (modelMatrix * lp4).xyz;
    vec2 uv = an.x > 0.5 ? p.zy : an.y > 0.5 ? p.xz : p.xy;
    // layer 1 (concrete) is neutral grey: it adds grain without changing the colour much
    vUvl = vec3(uv / 1.5, 1.0);
  }`,
  });
}

// Trees: bark and leaf cards from one geometry; cards are alpha-tested and the crown
// sways in the wind (attribute sway: 0 at the trunk base, 1 at the crown's edge).
const SWAY = /* glsl */ `
  {
    vec3 ip = vec3(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
    #endif
    float ph = uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17;
    vec2 gust = vec2(sin(ph) + 0.4 * sin(ph * 2.3 + 1.7), cos(ph * 0.8) * 0.6) * 0.045;
    transformed.xz += gust * sway * (1.0 + position.y * 0.1);
    transformed.y += sin(ph * 3.1 + position.x * 4.0) * 0.012 * sway;
  }`;
export function treeSurface() {
  // solid canopies (no cut-outs): the vertex colour carries the leafy shading
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.5 });
  return patch(m, { key: 'dc-tree', vertexPre: '\nattribute vec3 uvl;\nattribute float sway;', vertexBody: '  vUvl = uvl;\n' + SWAY });
}
// the matching shadow caster: same sway, same cut-outs
export function treeDepth() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, surfaceUniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 uvl;\nattribute float sway;\nvarying vec3 vUvl;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vUvl = uvl;\n' + SWAY);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray tAlb;\nvarying vec3 vUvl;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (texture(tAlb, vUvl).a < 0.45) discard;');
  };
  m.customProgramCacheKey = () => 'dc-tree-depth';
  return m;
}

// Window glass: smooth and reflective by day; after dark warm windows glow.
export function glassSurface(uNight) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.1, envMapIntensity: 1.3 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = uNight;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lit_ = step(0.55, vColor.r);
        // a lit room: warm, brighter towards the ceiling, never a flat white panel
        vec3 day_ = mix(vec3(0.05, 0.07, 0.09), vec3(0.11, 0.12, 0.12), lit_);
        diffuseColor.rgb = mix(day_, vColor * (0.15 + 0.25 * lit_), uNight);
        float room_ = 0.55 + 0.45 * smoothstep(-0.4, 0.5, vRoomY);
        totalEmissiveRadiance += vColor * vec3(1.0, 0.82, 0.62) * lit_ * uNight * 0.75 * room_;`);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRoomY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRoomY = position.y;');
    s.fragmentShader = s.fragmentShader.replace('uniform float uNight;', 'uniform float uNight;\nvarying float vRoomY;');
  };
  m.customProgramCacheKey = () => 'dc-glass';
  return m;
}

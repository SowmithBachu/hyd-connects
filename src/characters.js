// Rigged glTF townsfolk.
//
// Bodies, hairstyles and animation clips: Quaternius "Universal Base Characters" and
// "Universal Animation Library" (Standard editions, CC0 1.0). They are simplified and
// packed by tools/characters/build.mjs into public/characters/.
//
// One character = one SkinnedMesh with one material: body, eyes, brows, hair and the
// clothing pieces are merged into a single geometry and textured from one shared
// atlas, so each costs one draw call (plus its shadow). Clothes are painted and
// "inflated" in the vertex shader from a per-vertex body zone, so every outfit and
// colour comes from the same geometry; only a hood, a collar or a kurta's skirt adds
// a few hundred triangles of real cloth.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash, rng } from './geo.js';

const BASE = '/characters/';
// zones written by the build script (keep in sync with Z in build.mjs)
const Z = { head: 0, torso: 1, arm: 2, hand: 3, leg: 4, foot: 5, eye: 6, hair: 7, brow: 8, beard: 9, hood: 10, collar: 11, skirt: 12 };
export const OUTFIT = { tee: 0, shirt: 1, hoodie: 2, kurta: 3 };

// ---- look: from profile data to a character spec ---------------------------------
const HAIR = {
  male: { short: 'Hair_SimpleParted', side: 'Hair_SimpleParted', curly: 'Hair_Buzzed', spiky: 'Hair_Buzzed', cap: 'Hair_Buzzed', long: 'Hair_Long', bun: 'Hair_Long' },
  female: { short: 'Hair_BuzzedFemale', side: 'Hair_SimpleParted', curly: 'Hair_Buns', spiky: 'Hair_BuzzedFemale', cap: 'Hair_BuzzedFemale', long: 'Hair_Long', bun: 'Hair_Buns' },
};
// four builds per body; numbers are torso, arms, legs, belly, chest (offset from the bone axis)
const BUILDS = {
  male: {
    slim: { shape: [0.9, 0.84, 0.9, 0, 0.88], height: 1.0 },
    average: { shape: [0.95, 0.88, 0.95, 0.012, 0.9], height: 0.985 },
    broad: { shape: [1.02, 0.95, 1.0, 0.025, 0.95], height: 1.0 },
    heavy: { shape: [1.1, 1.0, 1.06, 0.065, 1.0], height: 0.97 },
  },
  female: {
    slim: { shape: [0.92, 0.9, 0.93, 0, 1], height: 0.99 },
    average: { shape: [0.97, 0.95, 0.98, 0.01, 1], height: 0.975 },
    broad: { shape: [1.03, 1.0, 1.03, 0.02, 1], height: 0.99 },
    heavy: { shape: [1.1, 1.06, 1.09, 0.05, 1], height: 0.96 },
  },
};
const SHOES = ['#f4f1ea', '#2b2b30', '#7a4b2a', '#3a5a8a', '#c94f3d'];
const SLEEVE = { tee: 0.3, shirt: 1.0, hoodie: 1.04, kurta: 0.97 };

export function specFromLook(look, id = '') {
  const h = hash(String(id) + JSON.stringify(look));
  const r = rng(h);
  const body = look.body || (look.hair === 'bun' || look.hair === 'long' ? 'female' : 'male');
  const outfit = look.outfit === 'suit' ? 'shirt' : OUTFIT[look.outfit] != null ? look.outfit : 'tee';
  const build = look.build && typeof look.build === 'string' ? look.build : ['slim', 'average', 'average', 'broad', 'heavy'][(r() * 5) | 0];
  let sleeve = SLEEVE[outfit];
  if (outfit === 'shirt' && r() < 0.4) sleeve = 0.62; // sleeves rolled up
  return {
    body, build, outfit, sleeve,
    hair: HAIR[body][look.hair || 'short'] || HAIR[body].short,
    beard: body === 'male' && !!look.beard,
    skin: look.skin || '#c99067', hairColor: look.hairColor || '#2e2019',
    top: look.top || '#2f6fb5', trim: look.accent || '#ffb81c',
    bottom: outfit === 'kurta' ? (r() < 0.6 ? '#efe8d8' : look.bottom || '#efe8d8') : look.bottom || '#2d3a5c',
    shoes: outfit === 'kurta' ? '#7a4b2a' : SHOES[(r() * SHOES.length) | 0],
    seed: h,
  };
}

// ---- shared shader --------------------------------------------------------------
// region: 0 skin, 1 top, 2 bottom, 3 shoe, 4 sole, 5 hair, 6 eye, 7 brow
const REGION = /* glsl */ `
uniform vec4 uBody;   // pelvis y, neck base y, knee y, unused
uniform vec3 uArm;    // shoulder x, elbow x, wrist x (bind pose is a T-pose, arms along x)
uniform float uOutfit, uSleeve;
float shoeTop() { return uOutfit > 2.5 ? 0.06 : 0.085; }
float hemY() { return uBody.x - (uOutfit > 2.5 ? 0.1 : uOutfit > 1.5 ? 0.035 : uOutfit > 0.5 ? 0.03 : 0.015); }
float sleeveX() { return uArm.x + uSleeve * (uArm.z - uArm.x); }
float regionOf(float zone, vec3 b) {
  if (zone < 0.5) return 0.0;
  if (zone < 2.5 && zone > 1.5) return abs(b.x) < sleeveX() ? 1.0 : 0.0;
  if (zone < 3.5 && zone > 2.5) return 0.0;
  if (zone < 5.5) {
    // torso, legs and feet share one rule, so hem and ankle lines are straight
    // legs and feet share one rule, so the ankle line is the same on both sides
    if (b.y > hemY()) return 1.0;
    if (b.y > shoeTop()) return 2.0;
    if (uOutfit > 2.5) return b.y < 0.022 ? 4.0 : 0.0; // sandals
    return b.y < 0.03 ? 4.0 : 3.0;
  }
  if (zone < 6.5) return 6.0;
  if (zone < 7.5) return 5.0;
  if (zone < 8.5) return 7.0;
  if (zone < 9.5) return 5.0;
  return 1.0; // hood, collar, skirt
}`;

const VERT_PARS = /* glsl */ `
attribute vec4 _zone;
attribute vec3 _axis;
uniform vec4 uShape;  // torso, arms, legs, belly
uniform float uChest;
varying vec4 vZone;
flat varying float vZid;
varying vec3 vBind;
varying vec3 vAxis;
attribute vec3 _smooth;
${REGION}`;

const VERT_BODY = /* glsl */ `
  // clothing lines are drawn on the smoothed body, the surface the cloth actually
  // follows, so hems and cuffs come out straight
  vZone = _zone; vZid = _zone.x; vBind = _smooth; vAxis = _axis;
  {
    float zid = _zone.x;
    float reg = regionOf(zid, _smooth);
    // under clothes, start from a smoothed body: cloth bridges over muscles
    if (reg > 0.5 && reg < 4.5) transformed = mix(position, _smooth, 0.85);
    // slimmer or fuller: scale the vertex's offset from the bone it hangs from
    float k = 1.0;
    if (zid > 0.5 && zid < 1.5) k = uShape.x * mix(1.0, uChest, smoothstep(uBody.x + 0.25, uBody.x + 0.45, position.y));
    else if (zid > 1.5 && zid < 2.5) k = uShape.y;
    else if (zid > 3.5 && zid < 4.5) {
      k = mix(uShape.z, uShape.x, smoothstep(uBody.x - 0.15, uBody.x + 0.05, position.y));
      // under a kurta's skirt the legs tuck in a little so a stride never pokes through
      if (uOutfit > 2.5) k *= 1.0 - 0.18 * smoothstep(uBody.z - 0.1, uBody.z + 0.05, position.y) * smoothstep(uBody.x, uBody.x - 0.08, position.y);
    }
    transformed = _axis + (transformed - _axis) * k;
    // a little belly for the fuller builds
    if (zid > 0.5 && zid < 1.5 || zid > 3.5 && zid < 4.5) {
      float g = exp(-pow((position.y - uBody.x - 0.14) / 0.13, 2.0));
      transformed.z += uShape.w * g * smoothstep(-0.05, 0.08, position.z);
      transformed.x *= 1.0 + uShape.w * 1.4 * g;
    }
    // clothes sit on top of the skin
    float th = 0.0;
    if (reg > 0.5 && reg < 1.5) th = zid > 9.5 ? 0.0 : uOutfit > 1.5 && uOutfit < 2.5 ? 0.024 : uOutfit > 2.5 ? 0.016 : 0.012;
    else if (reg > 1.5 && reg < 2.5) th = uOutfit > 2.5 ? (position.y > uBody.z ? 0.004 : 0.016) : 0.012;
    else if (reg > 2.5 && reg < 3.5) th = 0.016;
    else if (reg > 3.5 && reg < 4.5) th = 0.02;
    transformed += normal * th;
  }`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uSkin, uHair, uTop, uTrim, uBottom, uShoe, uRimColor;
uniform float uRim, uHi;
varying vec4 vZone;
flat varying float vZid;
varying vec3 vBind;
varying vec3 vAxis;
${REGION}
// bump from a procedural height (metres), like three's bump map but with a slope in world units
vec3 dcBump(vec3 p, vec3 n, float h, float faceDir) {
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  vec2 dh = vec2(dFdx(h) / max(length(dpx), 1e-6), dFdy(h) / max(length(dpy), 1e-6));
  vec3 sx = normalize(dpx), sy = normalize(dpy);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
float band(float x, float a, float b) { return step(a, x) * step(x, b); }`;

// colour, folds and trims for every region
const FRAG_COLOR = /* glsl */ `
  float zid = vZid, reg = regionOf(zid, vBind);
  vec3 b = vBind;
  vec4 tex = texture2D(map, vMapUv);
  vec3 base;
  float fold = 0.0, rough = 0.82, clothy = 0.0;
  float ax = abs(b.x), front = step(0.0, b.z - vAxis.z);
  float ang = atan(b.z - vAxis.z, (zid > 1.5 && zid < 3.5) ? b.y - vAxis.y : b.x - vAxis.x);
  if (reg < 0.5) { base = uSkin * tex.rgb * 4.6; rough = 0.55; }
  else if (reg > 4.5 && reg < 5.5) { base = uHair * tex.rgb * 4.6; rough = 0.45; }
  else if (reg > 5.5 && reg < 6.5) { base = tex.rgb; rough = 0.18; }
  else if (reg > 6.5) { base = uHair * tex.rgb * 3.6; rough = 0.6; }
  else {
    clothy = 1.0;
    // a faint woven texture so cloth never looks like plastic
    fold += sin(b.x * 1300.0 + b.z * 700.0) * sin(b.y * 1300.0) * 0.00006;
    if (reg < 1.5) {
      base = uTop;
      float sx = sleeveX(), hy = hemY();
      if (zid > 1.5 && zid < 2.5) {
        // sleeve: soft rings at the elbow, bunching towards the cuff
        fold += sin(ax * 110.0 + ang * 1.7) * 0.0014 * exp(-pow((ax - uArm.y) / 0.06, 2.0));
        fold += sin(ax * 150.0 + ang * 2.3) * 0.0009 * smoothstep(sx - 0.12, sx, ax);
        if (ax > sx - 0.045) { // cuff
          if (uOutfit > 1.5 && uOutfit < 2.5) { base *= 0.86; fold += sin(ang * 34.0) * 0.0005; }
          else if (uOutfit > 2.5) base = mix(base, uTrim, 0.85);
          else if (uOutfit > 0.5 && uSleeve > 0.9) base *= 0.93;
          else if (uOutfit > 0.5) { base *= 0.9; fold += 0.0012 * sin((ax - sx) * 140.0); } // rolled sleeve
        }
      } else if (zid > 9.5) {
        // hood, collar and skirt
        if (zid > 11.5) {
          fold += sin(ang * 9.0 + b.y * 6.0) * 0.004 * smoothstep(uBody.x, uBody.z, b.y * -1.0 + uBody.x + uBody.z); // drape
          if (b.y < uBody.z - 0.02) base = mix(base, uTrim, 0.9); // embroidered hem
        } else if (zid > 10.5) { if (uOutfit > 2.5) base = mix(base, uTrim, 0.9); else base *= 0.96; }
        else { base *= 0.9; fold += sin(ang * 7.0) * 0.002; }
      } else {
        // torso: pulls from the armpits and a soft gather at the waist
        float wy = b.y - uBody.x;
        fold += sin(wy * 55.0 + ax * 30.0) * 0.0011 * exp(-pow((wy - 0.02) / 0.1, 2.0));
        fold += sin((b.y - ax * 1.4) * 48.0) * 0.0008 * smoothstep(0.08, 0.2, ax) * smoothstep(uBody.y - 0.05, uBody.y - 0.3, b.y);
        float nk = uBody.y - b.y; // depth below the neck base
        if (uOutfit < 0.5) { // T-shirt: ribbed crew neck
          if (nk < 0.03 && ax < 0.1) { base *= 0.88; }
        } else if (uOutfit < 1.5) { // shirt: placket, buttons, a chest pocket
          if (front > 0.5 && ax < 0.014 && b.y > hy) {
            base *= 0.94;
            float by = fract((b.y - uBody.x) / 0.075);
            if (ax < 0.006 && abs(by - 0.5) < 0.07) base = vec3(0.93, 0.92, 0.88);
          }
          if (front > 0.5 && b.x > 0.06 && b.x < 0.15 && nk > 0.16 && nk < 0.27) {
            float e = min(min(b.x - 0.06, 0.15 - b.x), min(nk - 0.16, 0.27 - nk));
            if (e < 0.004) base *= 0.82; else if (nk < 0.18) base *= 0.95;
          }
        } else if (uOutfit < 2.5) { // hoodie: kangaroo pocket, drawstrings, ribbed hem
          if (front > 0.5 && ax < 0.13 && wy > -0.06 && wy < 0.13) {
            float e = min(0.13 - ax, min(wy + 0.06, 0.13 - wy));
            if (e < 0.005) base *= 0.78; else base *= 0.96;
          }
          if (front > 0.5 && abs(ax - 0.045) < 0.004 && nk > 0.0 && nk < 0.17) base = vec3(0.95);
          if (zid > 3.5 && b.y < hy + 0.055) { base *= 0.86; fold += sin(b.x * 260.0) * 0.0005; }
        } else { // kurta: embroidered placket and neckline
          if (front > 0.5 && ax < 0.022 && nk < 0.25) {
            base = mix(base, uTrim, 0.9);
            if (ax < 0.006 && abs(fract(nk / 0.06) - 0.5) < 0.12) base = vec3(0.96, 0.9, 0.7);
          }
          if (nk < 0.03 && ax < 0.1) base = mix(base, uTrim, 0.9);
          fold += sin(b.x * 60.0) * 0.0012 * smoothstep(uBody.x + 0.1, uBody.x - 0.1, b.y); // vertical drape
        }
      }
    } else if (reg < 2.5) {
      // trousers: bunching at the knee and the ankle; a pyjama is softer and baggier
      base = uBottom; rough = 0.9;
      float ka = atan(b.z - vAxis.z, b.x - vAxis.x);
      fold += sin(b.y * 85.0 + ka * 1.4) * 0.0015 * (exp(-pow((b.y - uBody.z) / 0.07, 2.0)) + 1.3 * smoothstep(0.22, 0.06, b.y));
      if (uOutfit > 2.5) fold += sin(ka * 6.0 + b.y * 20.0) * 0.0012;
      else if (abs(b.x - vAxis.x) > 0.045 && sign(b.x) == sign(b.x - vAxis.x) && abs(b.z - vAxis.z) < 0.01) base *= 0.85; // outer seam
    } else if (reg < 3.5) { base = uShoe; rough = 0.6; if (b.y < 0.06 && front > 0.5 && b.z > vAxis.z + 0.06) base = mix(base, vec3(0.95), 0.6); }
    else { base = vec3(0.92, 0.9, 0.86); rough = 0.7; if (uOutfit > 2.5) base = vec3(0.32, 0.2, 0.13); }
  }
  diffuseColor.rgb = base * (1.0 + uHi * 0.12);
  #ifdef DC_DEBUG_ZONES
  diffuseColor.rgb = vec3(mod(reg, 2.0), mod(floor(reg / 2.0), 2.0), mod(floor(reg / 4.0), 2.0)) * 0.8 + 0.1;
  if (abs(vBind.y - hemY()) < 0.003) diffuseColor.rgb = vec3(1.0, 0.0, 1.0);
  #endif`;

let shared = null;
export function characterUniforms() {
  shared ??= { uRim: { value: 0.32 }, uRimColor: { value: new THREE.Color('#ffe6c8') } };
  return shared;
}

function applySpec(m, lib, spec) {
  const u = m.userData.u, B = lib.bodies[spec.body], bld = BUILDS[spec.body][spec.build];
  u.uSkin.value.set(spec.skin); u.uHair.value.set(spec.hairColor); u.uTop.value.set(spec.top);
  u.uTrim.value.set(spec.trim); u.uBottom.value.set(spec.bottom); u.uShoe.value.set(spec.shoes);
  u.uOutfit.value = OUTFIT[spec.outfit]; u.uSleeve.value = spec.sleeve;
  u.uShape.value.set(...bld.shape.slice(0, 4)); u.uChest.value = bld.shape[4];
  u.uBody.value = B.uBody; u.uArm.value = B.uArm;
}

function makeMaterial(lib, spec) {
  const m = new THREE.MeshStandardMaterial({ map: lib.atlas, normalMap: lib.atlasN, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const u = {
    uSkin: { value: new THREE.Color() }, uHair: { value: new THREE.Color() }, uTop: { value: new THREE.Color() },
    uTrim: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uShoe: { value: new THREE.Color() },
    uOutfit: { value: 0 }, uSleeve: { value: 1 }, uShape: { value: new THREE.Vector4() }, uChest: { value: 1 },
    uBody: { value: null }, uArm: { value: null }, uHi: { value: 0 },
  };
  m.userData.u = u;
  applySpec(m, lib, spec);
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, characterUniforms());
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      // cloth ignores the skin's normal map and gets procedural folds instead
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
  if (clothy < 0.5) {
    #include <normal_fragment_maps>
  } else normal = dcBump(-vViewPosition, normal, fold, faceDirection);
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // soft fresnel rim so people read against the street, stronger when highlighted
  float rim_ = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += (diffuseColor.rgb * 0.5 + uRimColor * 0.25) * rim_ * (uRim + uHi * 0.9);
  if (reg < 0.5) totalEmissiveRadiance += uSkin * 0.035; // a hint of warmth through the skin`);
  };
  m.customProgramCacheKey = () => 'dc-character';
  return m;
}

// ---- cloth pieces built to fit each body ----------------------------------------
function ringPiece({ rings, segs, zone, bones, axis, gap = 0 }, B) {
  // rings: [{ y, cx, cz, rx, rz, w: [[bone, weight] ... ] | fn(angle) }]
  const pos = [], nrm = [], uv = [], si = [], sw = [], zo = [], axs = [], idx = [];
  const n = segs + 1;
  rings.forEach((r, ri) => {
    for (let s = 0; s <= segs; s++) {
      const a = gap + (s / segs) * (Math.PI * 2 - 2 * gap) - Math.PI / 2 + Math.PI; // start at the back
      const x = r.cx + Math.cos(a) * r.rx, z = r.cz + Math.sin(a) * r.rz;
      pos.push(x, r.y, z);
      const nx = Math.cos(a) / r.rx, nz = Math.sin(a) / r.rz, l = Math.hypot(nx, r.ny || 0, nz);
      nrm.push(nx / l, (r.ny || 0) / l, nz / l);
      uv.push(0.45, 0.9);
      const w = typeof r.w === 'function' ? r.w(x, z) : r.w;
      const pad = [...w, ...Array(4 - w.length).fill([w[0][0], 0])];
      for (const [bn, ww] of pad) { si.push(B.boneIndex[bn]); sw.push(ww); }
      zo.push(zone, 0, 0, 0);
      axs.push(...(axis || [r.cx, r.y, r.cz]));
    }
    if (ri) for (let s = 0; s < segs; s++) { const a = (ri - 1) * n + s, b = ri * n + s; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('_zone', new THREE.Float32BufferAttribute(zo, 4));
  g.setAttribute('_axis', new THREE.Float32BufferAttribute(axs, 3));
  g.setIndex(idx);
  return g;
}

function clothPieces(spec, B) {
  const out = [], s = B.fit;
  if (spec.outfit === 'kurta') {
    // the long kurta: an A-line skirt from the hips to just below the knee; its lower
    // edge follows the thighs, so it swings as they walk
    const top = s.hip.y, bot = B.uBody.z - 0.07, rings = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, y = top + (bot - top) * t;
      const flare = 1 + 0.1 + t * 0.32;
      rings.push({
        y, cx: 0, cz: s.hip.cz + t * 0.03, rx: Math.max(s.hip.rx, s.knee.rx * (t > 0.5 ? 1 : 0)) * flare + 0.012, rz: s.hip.rz * flare + 0.012, ny: 0.15,
        w: (x) => { const l = THREE.MathUtils.smoothstep(x, -0.1, 0.1), k = Math.min(1, 1.1 * t); return [['pelvis', 1 - k], ['thigh_l', k * l], ['thigh_r', k * (1 - l)]]; },
      });
    }
    out.push(ringPiece({ rings, segs: 22, zone: Z.skirt }, B));
    // mandarin collar
    const ny = B.uBody.y;
    out.push(ringPiece({ rings: [0, 1].map((i) => ({ y: ny - 0.01 + i * 0.035, cx: 0, cz: s.neck.cz, rx: s.neck.r + 0.012, rz: s.neck.r + 0.012, w: [['neck_01', 0.5], ['spine_03', 0.5]] })), segs: 16, zone: Z.collar, gap: 0.0 }, B));
  } else if (spec.outfit === 'shirt') {
    // a folded collar, open at the front
    const ny = B.uBody.y;
    out.push(ringPiece({ rings: [
      { y: ny - 0.015, cx: 0, cz: s.neck.cz, rx: s.neck.r + 0.01, rz: s.neck.r + 0.01, w: [['spine_03', 0.6], ['neck_01', 0.4]] },
      { y: ny + 0.03, cx: 0, cz: s.neck.cz, rx: s.neck.r + 0.016, rz: s.neck.r + 0.016, w: [['spine_03', 0.4], ['neck_01', 0.6]] },
      { y: ny + 0.01, cx: 0, cz: s.neck.cz, rx: s.neck.r + 0.04, rz: s.neck.r + 0.035, ny: 0.6, w: [['spine_03', 0.6], ['neck_01', 0.4]] },
    ], segs: 18, zone: Z.collar, gap: 0.32 }, B));
  } else if (spec.outfit === 'hoodie') {
    // the hood, resting on the shoulders behind the neck
    const ny = B.uBody.y - 0.02, cz = s.neck.cz - s.neck.r - 0.035, rings = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, sw = Math.sin(t * Math.PI);
      rings.push({ y: ny - 0.07 + t * 0.12, cx: 0, cz: cz - 0.02 * sw, rx: 0.11 + 0.04 * sw - 0.03 * t, rz: 0.045 + 0.03 * sw, w: [['spine_03', 1]] });
    }
    out.push(ringPiece({ rings, segs: 14, zone: Z.hood }, B));
  }
  return out;
}

// ---- library ---------------------------------------------------------------------
let libPromise = null;
export function loadCharacterLib() {
  libPromise ??= (async () => {
    const loader = new GLTFLoader(), tl = new THREE.TextureLoader();
    const get = (u) => new Promise((res, rej) => loader.load(BASE + u, res, undefined, rej));
    const tex = (u, srgb) => new Promise((res, rej) => tl.load(BASE + u, (t) => { t.flipY = false; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
    const [male, female, anims, atlas, atlasN] = await Promise.all([get('body_male.glb'), get('body_female.glb'), get('anims.glb'), tex('atlas.webp', true), tex('atlas_n.webp', false)]);
    const animPelvis = anims.scene.getObjectByName('pelvis').position.clone();
    const bodies = { male: prepBody(male, anims.animations, animPelvis), female: prepBody(female, anims.animations, animPelvis) };
    return { bodies, atlas, atlasN, geoCache: new Map() };
  })();
  return libPromise;
}

function prepBody(gltf, clips, animPelvis) {
  const parts = { near: {}, far: {} };
  let skeleton = null;
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const [lod, part] = o.name.split('__');
    if (parts[lod]) parts[lod][part] = o.geometry;
    skeleton ??= o.skeleton;
  });
  const boneNames = skeleton.bones.map((b) => b.name), boneIndex = {};
  boneNames.forEach((n, i) => { boneIndex[n] = i; });
  const jp = (n) => new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[boneIndex[n]].clone().invert());
  const J = Object.fromEntries(['pelvis', 'neck_01', 'Head', 'calf_l', 'upperarm_l', 'lowerarm_l', 'hand_l'].map((n) => [n, jp(n)]));
  const uBody = new THREE.Vector4(J.pelvis.y, J.neck_01.y, J.calf_l.y, 0);
  const uArm = new THREE.Vector3(J.upperarm_l.x, J.lowerarm_l.x, J.hand_l.x);
  for (const lod of ['near', 'far']) parts[lod].body.setAttribute('_smooth', envelope(parts[lod].body));
  // measure the body to fit the cloth pieces
  const body = parts.near.body, P = body.attributes.position, ZA = body.attributes._zone;
  const slice = (y0, y1, zones) => {
    let rx = 0, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i); if (y < y0 || y > y1 || !zones.includes(ZA.getX(i))) continue;
      rx = Math.max(rx, Math.abs(P.getX(i))); z0 = Math.min(z0, P.getZ(i)); z1 = Math.max(z1, P.getZ(i));
    }
    return { rx, cz: (z0 + z1) / 2, rz: (z1 - z0) / 2 };
  };
  const hipY = J.pelvis.y - 0.1;
  const hip = { y: hipY, ...slice(hipY - 0.03, hipY + 0.03, [Z.leg, Z.torso]) };
  const knee = slice(uBody.z - 0.04, uBody.z + 0.04, [Z.leg]);
  const nk = slice(J.neck_01.y, J.neck_01.y + 0.04, [Z.head]);
  const fit = { hip, knee, neck: { cz: nk.cz, r: Math.max(nk.rx, nk.rz) } };
  // fit the clips to this body: the mannequin's pelvis sits a little lower
  const rest = gltf.scene.getObjectByName('pelvis').position, d = rest.clone().sub(animPelvis);
  const fitted = {};
  for (const c of clips) {
    const cc = c.clone();
    for (const tr of cc.tracks) if (tr.name === 'pelvis.position') for (let i = 0; i < tr.values.length; i += 3) { tr.values[i] += d.x; tr.values[i + 1] += d.y; tr.values[i + 2] += d.z; }
    fitted[c.name] = cc;
  }
  return { parts, skeleton, boneNames, boneIndex, uBody, uArm, fit, clips: fitted, armature: gltf.scene.getObjectByName('root') };
}

// A smoothed copy of the body (Taubin smoothing, which does not shrink): clothes are
// built on it so they drape over muscles instead of being painted onto them.
function envelope(g, iters = 14) {
  const P = g.attributes.position, n = P.count, key = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
    if (!key.has(k)) key.set(k, key.size);
    weld[i] = key.get(k);
  }
  const m = key.size, p = new Float32Array(m * 3), nb = Array.from({ length: m }, () => new Set());
  for (let i = 0; i < n; i++) p.set([P.getX(i), P.getY(i), P.getZ(i)], weld[i] * 3);
  const I = g.index.array;
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = weld[I[t + e]], b = weld[I[t + (e + 1) % 3]]; nb[a].add(b); nb[b].add(a); }
  const lists = nb.map((s) => [...s]), tmp = new Float32Array(m * 3);
  const step = (lam) => {
    for (let v = 0; v < m; v++) {
      const L = lists[v]; if (!L.length) { tmp.set(p.subarray(v * 3, v * 3 + 3), v * 3); continue; }
      let x = 0, y = 0, z = 0; for (const u of L) { x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2]; }
      const c = 1 / L.length;
      tmp[v * 3] = p[v * 3] + lam * (x * c - p[v * 3]); tmp[v * 3 + 1] = p[v * 3 + 1] + lam * (y * c - p[v * 3 + 1]); tmp[v * 3 + 2] = p[v * 3 + 2] + lam * (z * c - p[v * 3 + 2]);
    }
    p.set(tmp);
  };
  for (let k = 0; k < iters; k++) { step(0.5); step(-0.53); }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set(p.subarray(weld[i] * 3, weld[i] * 3 + 3), i * 3);
  return new THREE.BufferAttribute(out, 3);
}

function geometryFor(lib, spec, lod) {
  const key = [spec.body, lod, spec.hair, spec.beard, spec.outfit].join('|');
  let g = lib.geoCache.get(key);
  if (g) return g;
  const B = lib.bodies[spec.body], P = B.parts[lod];
  const list = [P.body, P.eyes];
  if (P.brows) list.push(P.brows);
  if (P[spec.hair]) list.push(P[spec.hair]);
  if (spec.beard && P.Hair_Beard) list.push(P.Hair_Beard);
  if (lod === 'near') list.push(...clothPieces(spec, B));
  const clean = list.map((src) => {
    const c = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', '_zone', '_axis', '_smooth']) {
      // plain, non-interleaved copies so every part merges cleanly
      const a = src.attributes[n] || src.attributes.position, k = a.itemSize, arr = n === 'skinIndex' ? new Uint16Array(a.count * k) : new Float32Array(a.count * k);
      for (let i = 0; i < a.count; i++) for (let q = 0; q < k; q++) arr[i * k + q] = a.getComponent(i, q);
      c.setAttribute(n, new THREE.BufferAttribute(arr, k));
    }
    c.setIndex(Array.from(src.index.array));
    return c;
  });
  g = mergeGeometries(clean);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.25);
  g.userData.triangles = g.index.count / 3;
  lib.geoCache.set(key, g);
  return g;
}

// ---- one character -------------------------------------------------------------
const blobTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.7)'); r.addColorStop(0.5, 'rgba(0,0,0,0.32)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const blobGeo = new THREE.CircleGeometry(0.48, 20).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6, color: '#000000', polygonOffset: true, polygonOffsetFactor: -2 });

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const sstep = THREE.MathUtils.smoothstep, clamp = THREE.MathUtils.clamp;

// natural speed of each clip (metres per second), measured from the root-motion versions
const CLIP_SPEED = { walk: 0.98, run: 5.4, sprint: 8.2 };
const CLIPS = ['idle', 'talk', 'walk', 'run', 'sprint'];

export class Character {
  constructor(lib, spec, lod = 'near', { blob = false } = {}) {
    const B = lib.bodies[spec.body];
    this.group = new THREE.Group();
    // a private copy of the bones
    const root = B.armature.clone(true);
    const byName = {}; root.traverse((o) => { if (o.isBone) byName[o.name] = o; });
    this.skeleton = new THREE.Skeleton(B.boneNames.map((n) => byName[n]), B.skeleton.boneInverses);
    this.bones = byName;
    this.material = makeMaterial(lib, spec);
    this.mesh = new THREE.SkinnedMesh(geometryFor(lib, spec, lod), this.material);
    this.mesh.receiveShadow = true;
    this.mesh.add(root);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.group.add(this.mesh);
    if (blob) { const b = new THREE.Mesh(blobGeo, blobMat); b.renderOrder = 1; this.group.add(b); }
    // animation: every clip runs all the time and only the weights change, with a
    // random phase and pace per person so a crowd never moves in step
    this.mixer = new THREE.AnimationMixer(root);
    this.act = {};
    const r = rng(spec.seed + 3);
    for (const name of CLIPS) {
      const a = this.mixer.clipAction(B.clips[name]);
      a.play(); a.time = r() * a.getClip().duration; a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      a.timeScale = name === 'idle' || name === 'talk' ? 0.88 + r() * 0.24 : 1;
      this.act[name] = a;
    }
    this.w = { idle: 1, talk: 0, walk: 0, run: 0, sprint: 0 };
    this.restyle(lib, spec, lod);
  }
  get object() { return this.group; }
  get triangles() { return this.mesh.geometry.userData.triangles; }
  // new clothes, colours or build on the same body (a different body needs a new Character)
  restyle(lib, spec, lod = this.lod || 'near') {
    this.spec = spec;
    applySpec(this.material, lib, spec);
    const bld = BUILDS[spec.body][spec.build], r = rng(spec.seed + 7);
    this.mesh.scale.setScalar(bld.height * (0.975 + r() * 0.05));
    // a slightly larger head and hands read as friendly at game scale
    this.bones.Head.scale.setScalar(spec.body === 'male' ? 1.12 : 1.09);
    this.bones.hand_l.scale.setScalar(1.08); this.bones.hand_r.scale.setScalar(1.08);
    this.lod = null; this.setLod(lib, lod);
  }
  setLod(lib, lod) {
    if (this.lod === lod) return;
    this.lod = lod;
    this.mesh.geometry = geometryFor(lib, this.spec, lod);
    this.mesh.boundingSphere = this.mesh.geometry.boundingSphere.clone();
    this.mesh.castShadow = lod === 'near';
  }
  // speed in metres per second drives idle / walk / jog / sprint; greet 0..1 blends in
  // the greeting gesture; headYaw turns the neck and head towards someone
  update(dt, { speed = 0, greet = 0, headYaw = 0 } = {}) {
    const mv = sstep(speed, 0.12, 0.5), jog = sstep(speed, 2.0, 3.6), spr = sstep(speed, 8, 11);
    const target = { idle: (1 - mv) * (1 - greet), talk: (1 - mv) * greet, walk: mv * (1 - jog), run: mv * jog * (1 - spr), sprint: mv * jog * spr };
    const f = 1 - Math.exp(-dt / 0.12); // ~0.25 s cross-fade
    for (const n of CLIPS) { this.w[n] += (target[n] - this.w[n]) * f; this.act[n].setEffectiveWeight(this.w[n]); }
    if (speed > 0.05) {
      this.act.walk.timeScale = clamp(speed / CLIP_SPEED.walk, 0.7, 1.9);
      this.act.run.timeScale = clamp(speed / CLIP_SPEED.run, 0.55, 1.6);
      this.act.sprint.timeScale = clamp(speed / CLIP_SPEED.sprint, 0.8, 1.9);
    }
    this.mixer.update(dt);
    if (headYaw) {
      for (const [n, part] of [['spine_03', 0.25], ['neck_01', 0.35], ['Head', 0.4]]) {
        const bone = this.bones[n];
        bone.parent.getWorldQuaternion(_q).invert();
        _q2.setFromAxisAngle(_up, headYaw * part);
        bone.quaternion.premultiply(_q.clone().multiply(_q2).multiply(_q.invert()));
      }
    }
  }
  place(x, y, z, yaw) { this.group.position.set(x, y, z); this.group.rotation.y = yaw; }
  highlight(k) { this.material.userData.u.uHi.value = k; }
  dispose() { this.group.removeFromParent(); this.material.dispose(); this.mixer.stopAllAction(); }
}

// ---- a crowd ---------------------------------------------------------------------
// Same interface as the old instanced Crowd (add / paint / set / hide / commit), so
// the people standing around and the pedestrians use it unchanged. Level of detail:
// the nearest few get the full model with shadows, the next ones the light model
// animated at a third of the rate, and the rest are not drawn. Contact shadows and
// status rings stay instanced: one draw call each for the whole crowd.
const ringGeo = new THREE.RingGeometry(0.62, 0.86, 28).rotateX(-Math.PI / 2).translate(0, 0.035, 0);
const _m = new THREE.Matrix4(), _c = new THREE.Color();
export class CharacterCrowd {
  static eye = new THREE.Vector3(0, 1e6, 0); // camera position, updated by the app every frame
  constructor(scene, cap, { ring = false, near = 10, far = 36, farDist = 110 } = {}) {
    Object.assign(this, { scene, cap, nearMax: near, farMax: far, farDist, count: 0, slots: [], lib: null, frame: 0, last: performance.now() });
    this.blob = new THREE.InstancedMesh(blobGeo, blobMat, cap);
    this.blob.count = 0; this.blob.frustumCulled = false; this.blob.renderOrder = 1; scene.add(this.blob);
    if (ring) {
      this.ring = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), cap);
      this.ring.count = 0; this.ring.frustumCulled = false; scene.add(this.ring);
      this.ring.setColorAt(0, _c.set('#000000'));
    }
    this.order = [];
    loadCharacterLib().then((lib) => { this.lib = lib; for (const s of this.slots) this.build(s); }).catch((e) => console.warn('characters failed to load', e));
  }
  add(look, ringColor) {
    const i = this.count++;
    this.slots[i] = { i, ch: null, vis: false, x: 0, y: -60, z: 0, yaw: 0, greet: 0, headYaw: 0, speed: 0, hi: 0, px: null, pz: 0, acc: 0 };
    this.blob.count = this.count; if (this.ring) this.ring.count = this.count;
    this.paint(i, look, ringColor);
    return i;
  }
  paint(i, look, ringColor) {
    const s = this.slots[i];
    s.spec = specFromLook(look);
    s.ringOn = !!ringColor;
    if (this.ring) { this.ring.setColorAt(i, _c.set(ringColor || '#000000')); this.ring.instanceColor.needsUpdate = true; }
    if (this.lib) this.build(s);
  }
  build(s) {
    if (s.ch && s.ch.spec.body === s.spec.body) { s.ch.restyle(this.lib, s.spec, s.ch.lod); return; }
    s.ch?.dispose();
    s.ch = new Character(this.lib, s.spec, 'far');
    s.ch.object.visible = false;
    this.scene.add(s.ch.object);
  }
  set(i, x, y, z, yaw, phase = 0, amt = 0, wave = 0, t = 0, sc = 1, headYaw = 0) {
    const s = this.slots[i];
    if (y < -1) { s.vis = false; return; }
    s.vis = true; s.x = x; s.y = y; s.z = z; s.yaw = yaw; s.greet = wave; s.headYaw = headYaw || 0;
  }
  hide(i) { this.slots[i].vis = false; }
  highlight(i, k) { this.slots[i].hi = k; }
  commit() {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    if (dt < 0.002) return; // committed twice in one frame
    this.last = now; this.frame++;
    const eye = CharacterCrowd.eye, order = this.order;
    order.length = 0;
    for (const s of this.slots) {
      // walking speed from how far they moved since the last frame (a jump is a teleport)
      if (s.vis && s.px != null) {
        const d = Math.hypot(s.x - s.px, s.z - s.pz), sp = d > 3 ? 0 : d / dt;
        s.speed += (sp - s.speed) * Math.min(1, dt * 8);
      }
      s.px = s.vis ? s.x : null; s.pz = s.z;
      s.d2 = (s.x - eye.x) ** 2 + (s.y - eye.y) ** 2 + (s.z - eye.z) ** 2;
      s.acc += dt;
      s.shown = false;
      if (s.vis && s.d2 < this.farDist * this.farDist) order.push(s); else if (s.ch) s.ch.object.visible = false;
    }
    order.sort((a, b) => a.d2 - b.d2);
    for (let k = 0; k < order.length; k++) {
      const s = order[k], ch = s.ch;
      if (k >= this.nearMax + this.farMax || !ch) { if (ch) ch.object.visible = false; continue; }
      const near = k < this.nearMax;
      ch.setLod(this.lib, near ? 'near' : 'far');
      ch.object.visible = true; s.shown = true;
      ch.place(s.x, s.y, s.z, s.yaw);
      // the light models animate at a third of the rate: nobody notices at that distance
      if (near || (this.frame + s.i) % 3 === 0) { ch.update(Math.min(0.2, s.acc), { speed: s.speed, greet: s.greet, headYaw: s.headYaw }); s.acc = 0; }
      ch.highlight(s.hi);
    }
    for (const s of this.slots) {
      const on = s.shown;
      if (on) _m.makeTranslation(s.x, s.y, s.z); else _m.makeScale(0, 0, 0);
      this.blob.setMatrixAt(s.i, _m);
      if (this.ring) { if (!s.ringOn) _m.makeScale(0, 0, 0); this.ring.setMatrixAt(s.i, _m); }
    }
    this.blob.instanceMatrix.needsUpdate = true;
    if (this.ring) this.ring.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    for (const s of this.slots) s.ch?.dispose();
    this.blob.removeFromParent(); this.ring?.removeFromParent(); this.ring?.material.dispose();
  }
}

// ---- the visitor's own character --------------------------------------------------
// Until the models have loaded, the old figure stands in (makeFallback), so you are
// never invisible on a slow connection.
const GUEST_LOOK = { outfit: 'hoodie', top: '#ffb81c', bottom: '#2d3a5c', skin: '#c99067', hairColor: '#16120f', accent: '#1d2433', hair: 'side', build: 'average' };
export function makeCharacterAvatar(scene, look, ghost, makeFallback) {
  let old = makeFallback(), ch = null, dead = false, last = performance.now(), px = null, pz = 0, speed = 0;
  const spec = specFromLook(ghost ? GUEST_LOOK : { build: 'average', ...look }, 'me');
  loadCharacterLib().then((lib) => {
    if (dead) return;
    ch = new Character(lib, spec, 'near', { blob: true });
    scene.add(ch.object);
    old.dispose(); old = null;
  }).catch(() => {});
  return {
    place(x, y, z, yaw, phase, amt, t) {
      if (old) { old.place(x, y, z, yaw, phase, amt, t); return; }
      if (!ch) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (px != null && dt > 0) { const d = Math.hypot(x - px, z - pz), sp = d > 6 ? 0 : d / dt; speed += (sp - speed) * Math.min(1, dt * 10); }
      px = x; pz = z;
      ch.object.visible = true;
      ch.place(x, y, z, yaw);
      ch.update(dt, { speed });
    },
    hide() { old?.hide(); if (ch) ch.object.visible = false; },
    dispose() { dead = true; old?.dispose(); ch?.dispose(); },
  };
}

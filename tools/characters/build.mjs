// Character asset pipeline.
//
// Source: Quaternius "Universal Base Characters" + "Universal Animation Library"
// (Standard, CC0 1.0). The raw packs live in assets/source/ (git-ignored); this
// script turns them into the small files the game loads from public/characters/.
//
//   node tools/characters/build.mjs            build everything
//   node tools/characters/build.mjs --report   only print what is in the sources
//
// What it does
//  - welds and simplifies every mesh with meshoptimizer, in two passes so the face
//    and hands keep far more detail than the torso and legs (they are what you look at)
//  - builds a near LOD (~4.5-5k triangles with hair) and a far LOD (~1k)
//  - rebinds the hairstyles onto each body's head bone
//  - tags each vertex with a body zone (_ZONE) that the clothing shader uses
//  - remaps UVs into one shared texture atlas (built by atlas.py) so a whole
//    character is a single material and a single draw call
//  - copies only the animation clips the game uses, without the mannequin mesh
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier as MS } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const UBC = path.join(ROOT, 'assets/source/ubc/x/Universal Base Characters[Standard]');
const UAL = path.join(ROOT, 'assets/source/ual/x/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb');
const OUT = path.join(ROOT, 'public/characters');
const REPORT = process.argv.includes('--report');
const io = new NodeIO();
await MS.ready;

// read a .gltf with its .bin but without its images: we build our own atlas, and the
// pack references one texture that is not in the zip
async function readGltf(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  const resources = {};
  for (const b of json.buffers || []) if (b.uri) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(path.dirname(file), decodeURIComponent(b.uri))));
  return io.readJSON({ json, resources });
}

// ---- atlas layout (must match atlas.py) -------------------------------------------
// 2048 x 1280: [male body 1024 | female body 1024] on top, a 256-px strip below
// holding the eye texture and the two hair textures.
const AW = 2048, AH = 1280;
const RECT = {
  male: [0, 0, 1024, 1024], female: [1024, 0, 1024, 1024],
  eye: [0, 1024, 256, 256], hair1: [256, 1024, 256, 256], hair2: [512, 1024, 256, 256],
};
// zone ids, read by the character shader
const Z = { head: 0, torso: 1, arm: 2, hand: 3, leg: 4, foot: 5, eye: 6, hair: 7, brow: 8, beard: 9 };

// ---- helpers ----------------------------------------------------------------------
const attr = (prim, name) => prim.getAttribute(name)?.getArray();
function inv4(m) { // column-major 4x4 inverse
  const o = new Float64Array(16), a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
const mul4 = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const xf = (m, x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];

// pull one skinned primitive out as plain arrays
function grab(node) {
  const skin = node.getSkin(), prim = node.getMesh().listPrimitives()[0];
  const joints = skin.listJoints().map((j) => j.getName());
  const ibm = skin.getInverseBindMatrices().getArray();
  const W = attr(prim, 'WEIGHTS_0'), J = attr(prim, 'JOINTS_0');
  const raw = {
    name: node.getName(), joints, ibm,
    pos: Float32Array.from(attr(prim, 'POSITION')), nrm: Float32Array.from(attr(prim, 'NORMAL')),
    uv: Float32Array.from(attr(prim, 'TEXCOORD_0')),
    j: Uint16Array.from(J), w: Float32Array.from(W),
    idx: Uint32Array.from(prim.getIndices().getArray()),
    material: prim.getMaterial()?.getName(),
  };
  return raw;
}
const tris = (m) => m.idx.length / 3;
function bounds(a, n, off = 0) { const mn = [1e9, 1e9], mx = [-1e9, -1e9]; for (let i = 0; i < a.length; i += n) for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], a[i + off + k]); mx[k] = Math.max(mx[k], a[i + off + k]); } return [mn, mx]; }

// joint bind position (world) = inverse(IBM) translation
function jointPos(m, name) { const i = m.joints.indexOf(name); const inv = inv4(m.ibm.slice(i * 16, i * 16 + 16)); return [inv[12], inv[13], inv[14]]; }

// per-vertex zone, head weight, hand weight
function zones(m, forced) {
  const n = m.pos.length / 3, z = new Float32Array(n * 4);
  const jn = m.joints;
  const group = (name) => {
    if (name === 'Head') return 'head';
    if (name === 'neck_01') return 'head';
    if (/^spine|^clavicle/.test(name)) return 'torso';
    if (/^upperarm|^lowerarm/.test(name)) return 'arm';
    if (/^hand|^index|^middle|^ring|^pinky|^thumb/.test(name)) return 'hand';
    if (name === 'pelvis' || /^thigh|^calf/.test(name)) return 'leg';
    if (/^foot|^ball/.test(name)) return 'foot';
    return 'torso';
  };
  for (let v = 0; v < n; v++) {
    let best = -1, bw = -1, head = 0, hand = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.w[v * 4 + k]; if (w <= 0) continue;
      const name = jn[m.j[v * 4 + k]];
      if (name === 'Head') head += w;
      if (group(name) === 'hand') hand += w;
      if (w > bw) { bw = w; best = name; }
    }
    z[v * 4] = forced != null ? forced : Z[group(best)];
    z[v * 4 + 1] = forced === Z.hair || forced === Z.eye || forced === Z.brow || forced === Z.beard ? 1 : head;
    z[v * 4 + 2] = hand;
  }
  return z;
}

// the point on the bone this vertex hangs from: the shader scales a vertex's offset
// from it to make limbs and torsos slimmer or fuller without breaking the skinning
const CHILD = (name) => {
  const fixed = { Head: null, neck_01: 'Head', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', pelvis: 'spine_01' };
  if (name in fixed) return fixed[name];
  const m = name.match(/^(clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball)_([lr])$/);
  if (m) return { clavicle: 'upperarm', upperarm: 'lowerarm', lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', calf: 'foot', foot: 'ball', ball: 'ball_leaf' }[m[1]] + '_' + m[2];
  const f = name.match(/^(\w+)_0(\d)_([lr])$/);
  if (f) return +f[2] < 3 ? `${f[1]}_0${+f[2] + 1}_${f[3]}` : `${f[1]}_04_leaf_${f[3]}`;
  return null;
};
function axes(m, forceJoint) {
  const n = m.pos.length / 3, out = new Float32Array(n * 3);
  const jp = {}; for (const j of m.joints) jp[j] = jointPos(m, j);
  for (let v = 0; v < n; v++) {
    let best = 0; for (let k = 1; k < 4; k++) if (m.w[v * 4 + k] > m.w[v * 4 + best]) best = k;
    const name = forceJoint || m.joints[m.j[v * 4 + best]], a = jp[name], cn = CHILD(name);
    const b = cn && jp[cn] ? jp[cn] : [a[0], a[1] + 0.2, a[2]];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const t = Math.max(0, Math.min(1, ((m.pos[v * 3] - a[0]) * d[0] + (m.pos[v * 3 + 1] - a[1]) * d[1] + (m.pos[v * 3 + 2] - a[2]) * d[2]) / L));
    out.set([a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], v * 3);
  }
  return out;
}

// position + "where does this vertex bend" (weighted joint centre) + normal + uv
function simplifyAttrs(m, jpos) {
  const n = m.pos.length / 3, a = new Float32Array(n * 8);
  for (let v = 0; v < n; v++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) { const w = m.w[v * 4 + k], p = jpos[m.j[v * 4 + k]]; cx += w * p[0]; cy += w * p[1]; cz += w * p[2]; }
    a.set([cx, cy, cz, m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2], m.uv[v * 2], m.uv[v * 2 + 1]], v * 8);
  }
  return a;
}

// two-pass simplify: important vertices (face, hands) are locked while the rest is
// reduced; then the rest is locked while the important region is reduced gently
function simplify(m, target, important, label, maxErr = 0.08) {
  const n = m.pos.length / 3;
  const jpos = m.joints.map((jn) => jointPos(m, jn));
  const A = simplifyAttrs(m, jpos);
  const weights = [0.6, 0.6, 0.6, 0.35, 0.35, 0.35, 0.5, 0.5];
  let idx = m.idx;
  if (important && tris(m) > target) {
    const imp = new Uint8Array(n), rest = new Uint8Array(n);
    let impTris = 0;
    for (let t = 0; t < idx.length; t += 3) if (important(idx[t]) && important(idx[t + 1]) && important(idx[t + 2])) impTris++;
    for (let v = 0; v < n; v++) { imp[v] = important(v) ? 1 : 0; rest[v] = imp[v] ? 0 : 1; }
    const impTarget = Math.min(impTris, Math.round(target * important.share));
    const restTarget = Math.max(60, target - impTarget);
    [idx] = MS.simplifyWithAttributes(idx, m.pos, 3, A, 8, weights, imp, (restTarget + impTris) * 3, important.err ?? 0.05, []);
    [idx] = MS.simplifyWithAttributes(idx, m.pos, 3, A, 8, weights, rest, target * 3, important.err ?? 0.05, []);
    if (REPORT) console.log(`  ${label}: important region ${impTris} tris -> budget ${impTarget}`);
  } else if (tris(m) > target) {
    [idx] = MS.simplifyWithAttributes(idx, m.pos, 3, A, 8, weights, null, target * 3, maxErr, []);
  }
  return compact({ ...m, idx });
}

// drop unreferenced vertices
function compact(m) {
  const n = m.pos.length / 3, map = new Int32Array(n).fill(-1);
  let c = 0; for (const i of m.idx) if (map[i] < 0) map[i] = c++;
  const pick = (src, k, T) => { const o = new T(c * k); for (let v = 0; v < n; v++) if (map[v] >= 0) for (let q = 0; q < k; q++) o[map[v] * k + q] = src[v * k + q]; return o; };
  return {
    ...m, pos: pick(m.pos, 3, Float32Array), nrm: pick(m.nrm, 3, Float32Array), uv: pick(m.uv, 2, Float32Array),
    j: pick(m.j, 4, Uint16Array), w: pick(m.w, 4, Float32Array), zone: m.zone ? pick(m.zone, 4, Float32Array) : undefined, axis: m.axis ? pick(m.axis, 3, Float32Array) : undefined,
    idx: Uint32Array.from(m.idx, (i) => map[i]),
  };
}

// move a part bound with another file's skeleton into this body's bind space
function rebind(part, body) {
  const out = { ...part, pos: new Float32Array(part.pos), nrm: new Float32Array(part.nrm), j: new Uint16Array(part.j) };
  const n = part.pos.length / 3;
  for (let v = 0; v < n; v++) {
    // dominant joint decides the rebind (hair is rigged to the head bone only)
    let best = 0; for (let k = 1; k < 4; k++) if (part.w[v * 4 + k] > part.w[v * 4 + best]) best = k;
    const jname = part.joints[part.j[v * 4 + best]], bi = body.joints.indexOf(jname);
    const M = mul4(inv4(body.ibm.slice(bi * 16, bi * 16 + 16)), part.ibm.slice(part.j[v * 4 + best] * 16, part.j[v * 4 + best] * 16 + 16));
    const p = xf(M, part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2], 1);
    const q = xf(M, part.nrm[v * 3], part.nrm[v * 3 + 1], part.nrm[v * 3 + 2], 0);
    const l = Math.hypot(...q) || 1;
    out.pos.set(p, v * 3); out.nrm.set([q[0] / l, q[1] / l, q[2] / l], v * 3);
    for (let k = 0; k < 4; k++) out.j[v * 4 + k] = body.joints.indexOf(part.joints[part.j[v * 4 + k]]);
  }
  out.joints = body.joints; out.ibm = body.ibm;
  return out;
}

// texture coordinates into the shared atlas
function toAtlas(m, rect) {
  const [x, y, w, h] = RECT[rect], uv = new Float32Array(m.uv);
  for (let i = 0; i < uv.length; i += 2) {
    // hair textures tile; wrap into the cell (the strip is only sampled for colour noise)
    let u = uv[i], v = uv[i + 1];
    if (rect.startsWith('hair')) { u -= Math.floor(u); v -= Math.floor(v); }
    uv[i] = (x + u * w) / AW; uv[i + 1] = (y + v * h) / AH;
  }
  return { ...m, uv };
}

// ---- load sources -------------------------------------------------------------------
const BODY = {
  male: { file: 'Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', atlas: 'male', hairs: ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'Hair_Beard'] },
  female: { file: 'Base Characters/Godot - UE/Superhero_Female_FullBody.gltf', atlas: 'female', hairs: ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale', 'Hair_SimpleParted'] },
};
const HAIR_DIR = 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)';
const HAIR_TEX = { Hair_SimpleParted: 'hair1', Hair_Buzzed: 'hair1', Hair_Beard: 'hair1', Hair_Long: 'hair2', Hair_Buns: 'hair2', Hair_BuzzedFemale: 'hair2' };

// LOD budgets (triangles). Near = everything you see up close; far = for the crowd.
const BUDGET = {
  near: { body: 3300, eyes: 160, brows: 120, hair: { Hair_SimpleParted: 900, Hair_Buzzed: 360, Hair_Long: 1100, Hair_Buns: 1100, Hair_BuzzedFemale: 360, Hair_Beard: 420 } },
  far: { body: 760, eyes: 48, brows: 0, hair: { Hair_SimpleParted: 160, Hair_Buzzed: 70, Hair_Long: 200, Hair_Buns: 200, Hair_BuzzedFemale: 70, Hair_Beard: 70 } },
};

const report = {};
fs.mkdirSync(OUT, { recursive: true });

for (const [key, B] of Object.entries(BODY)) {
  const doc = await readGltf(path.join(UBC, B.file));
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh() && n.getSkin());
  const parts = nodes.map(grab);
  const body = parts.find((p) => /Hero|Sphere/i.test(p.name) || /Superhero/.test(p.material));
  const eyes = parts.find((p) => p.material === 'MI_Eyes');
  const brows = parts.find((p) => p !== body && p !== eyes);
  if (REPORT) {
    console.log(`\n${key}: body ${tris(body)} eyes ${tris(eyes)} brows ${tris(brows)}  (${body.name}/${eyes.name}/${brows.name})`);
    console.log('  uv body', bounds(body.uv, 2), 'eyes', bounds(eyes.uv, 2), 'brows', bounds(brows.uv, 2));
    console.log('  head joint', jointPos(body, 'Head'), 'hand_l', jointPos(body, 'hand_l'), 'pelvis', jointPos(body, 'pelvis'));
  }
  body.zone = zones(body); eyes.zone = zones(eyes, Z.eye); brows.zone = zones(brows, Z.brow);
  body.axis = axes(body); eyes.axis = axes(eyes, 'Head'); brows.axis = axes(brows, 'Head');
  const hairs = {};
  for (const h of B.hairs) {
    const hd = await readGltf(path.join(UBC, HAIR_DIR, h + '.gltf'));
    const hn = hd.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin());
    const raw = rebind(grab(hn), body);
    raw.zone = zones(raw, h === 'Hair_Beard' ? Z.beard : Z.hair);
    raw.axis = axes(raw, 'Head');
    if (REPORT) console.log(`  ${h}: ${tris(raw)} tris uv`, bounds(raw.uv, 2));
    hairs[h] = raw;
  }

  // the face and the hands are what people look at: keep them dense
  const headJ = jointPos(body, 'Head');
  const important = (v) => {
    const z = body.zone[v * 4], y = body.pos[v * 3 + 1], zf = body.pos[v * 3 + 2];
    return (z === Z.head && y > headJ[1] - 0.02 && zf > -0.02) || z === Z.hand;
  };
  important.share = 0.5;

  const lods = {};
  for (const lod of ['near', 'far']) {
    const bud = BUDGET[lod];
    const set = {};
    const err = lod === 'near' ? 0.08 : 1; // far: hit the budget whatever it takes
    important.share = lod === 'near' ? 0.5 : 0.34; important.err = err;
    set.body = toAtlas(simplify(body, bud.body, important, `${key} ${lod} body`, err), B.atlas);
    set.eyes = toAtlas(simplify(eyes, bud.eyes, null, '', err), 'eye');
    if (bud.brows) set.brows = toAtlas(simplify(brows, bud.brows, null, '', err), 'hair1');
    for (const h of B.hairs) set[h] = toAtlas(simplify(hairs[h], bud.hair[h], null, '', err), HAIR_TEX[h]);
    lods[lod] = set;
  }
  report[key] = Object.fromEntries(Object.entries(lods).map(([l, s]) => [l, Object.fromEntries(Object.entries(s).map(([k, m]) => [k, tris(m)]))]));
  if (REPORT) { console.log('  result', JSON.stringify(report[key])); continue; }

  // ---- write: reuse the source document's skeleton, replace the meshes -------------
  const root = doc.getRoot(), buffer = root.listBuffers()[0], skin = nodes[0].getSkin();
  const scene = root.listScenes()[0];
  for (const n of nodes) { n.getMesh().dispose(); n.dispose(); }
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  const armature = root.listNodes().find((n) => n.getName() === 'Armature') || scene.listChildren()[0];
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  for (const [lod, set] of Object.entries(lods)) {
    for (const [part, m] of Object.entries(set)) {
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', acc(m.pos, 'VEC3')).setAttribute('NORMAL', acc(m.nrm, 'VEC3'))
        .setAttribute('TEXCOORD_0', acc(m.uv, 'VEC2'))
        .setAttribute('JOINTS_0', acc(Uint8Array.from(m.j), 'VEC4')).setAttribute('WEIGHTS_0', acc(m.w, 'VEC4'))
        .setAttribute('_ZONE', acc(m.zone, 'VEC4')).setAttribute('_AXIS', acc(m.axis, 'VEC3'))
        .setIndices(acc(m.pos.length / 3 > 65535 ? m.idx : Uint16Array.from(m.idx), 'SCALAR'));
      const mesh = doc.createMesh(`${lod}__${part}`).addPrimitive(prim);
      const node = doc.createNode(`${lod}__${part}`).setMesh(mesh).setSkin(skin);
      armature.addChild(node);
    }
  }
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
  const file = path.join(OUT, `body_${key}.glb`);
  await io.write(file, doc);
  console.log(`wrote ${path.relative(ROOT, file)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`, JSON.stringify(report[key]));
}

// ---- animations ---------------------------------------------------------------------
{
  const KEEP = { Idle_Loop: 'idle', Walk_Loop: 'walk', Jog_Fwd_Loop: 'run', Sprint_Loop: 'sprint', Idle_Talking_Loop: 'talk' };
  const doc = await io.read(UAL);
  const root = doc.getRoot();
  if (REPORT) {
    // compare rest translations with the base characters, so the clips fit the bodies
    const ref = await readGltf(path.join(UBC, BODY.male.file));
    const rest = (d) => Object.fromEntries(d.getRoot().listNodes().map((n) => [n.getName(), n.getTranslation()]));
    const a = rest(doc), b = rest(ref);
    for (const k of ['pelvis', 'spine_01', 'neck_01', 'Head', 'thigh_l', 'calf_l', 'upperarm_l', 'lowerarm_l']) console.log(`  rest ${k}: anim ${a[k]?.map((x) => x.toFixed(3))} body ${b[k]?.map((x) => x.toFixed(3))}`);
  }
  for (const anim of root.listAnimations()) {
    if (!KEEP[anim.getName()]) { for (const c of anim.listChannels()) c.dispose(); for (const sm of anim.listSamplers()) sm.dispose(); anim.dispose(); continue; }
    anim.setName(KEEP[anim.getName()]);
    // keep rotations everywhere, and translation only on the pelvis (the bob):
    // per-bone translation/scale would force the mannequin's bone lengths onto our bodies
    for (const ch of anim.listChannels()) {
      const p = ch.getTargetPath(), n = ch.getTargetNode()?.getName();
      if (p === 'scale' || (p === 'translation' && n !== 'pelvis')) { ch.getSampler().dispose(); ch.dispose(); }
    }
  }
  for (const n of root.listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setMesh(null); n.setSkin(null); }
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  // samplers left behind by the dropped channels/clips, then their keyframe data
  for (const sm of root.listAnimations().flatMap((an) => an.listSamplers())) if (!sm.listParents().some((p) => p.propertyType === 'AnimationChannel')) sm.dispose();
  for (const a of root.listAccessors()) if (!a.listParents().some((p) => p.propertyType !== 'Root')) a.dispose();
  await doc.transform(prune({ keepLeaves: true }));
  if (!REPORT) {
    const file = path.join(OUT, 'anims.glb');
    await io.write(file, doc);
    console.log(`wrote ${path.relative(ROOT, file)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
  }
}

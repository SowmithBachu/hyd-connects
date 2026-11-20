// Jointed, customisable townsfolk.
//
// Each person is 10 rigid segments (body, head, 2 thighs, 2 shins, 2 upper arms,
// 2 forearms) driven by a simple skeleton. Every segment type is one InstancedMesh,
// so the whole crowd costs 6 draw calls. Colours come from per-instance attributes
// (skin, top, bottom, hair, accent) and optional pieces (hood, tie, cap, beard...)
// are switched on and off per person with a bit mask in the vertex shader.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, hash } from './geo.js';

// ---- palettes ---------------------------------------------------------------
export const SKIN = ['#f1c9a1', '#e2b089', '#c99067', '#a8714a', '#8a5a3b', '#6b4430'];
export const HAIRCOL = ['#16120f', '#2e2019', '#4a3022', '#7a5232', '#9a9590', '#b5352a'];
export const TOPS = ['#e2574c', '#2f6fb5', '#1fa971', '#e8891a', '#8a5bd1', '#d9488f', '#2aa6b8', '#f2c230', '#f4f1e6', '#3d4250', '#b5523a', '#3d7d5a', '#6fa8dc', '#ffffff'];
export const SUITS = ['#232b3d', '#363b48', '#1d2230', '#4a3a30', '#2f3a52'];
export const KURTAS = ['#f4efe2', '#e8c76a', '#b85c3c', '#6b8fb8', '#efe6f2', '#9bc4a8'];
export const BOTTOMS = ['#2d3a5c', '#3b4f7a', '#24262d', '#7b6a4e', '#5b616e', '#8a9bb0', '#efe8d8'];
export const ACCENTS = ['#e2574c', '#ffb81c', '#2aa6b8', '#1fa971', '#8a5bd1', '#f4f1e6', '#d9488f'];
export const HAIRSTYLES = ['short', 'side', 'bun', 'long', 'curly', 'cap'];
export const OUTFITS = [['tee', 'T-shirt'], ['hoodie', 'Hoodie'], ['shirt', 'Shirt'], ['kurta', 'Kurta'], ['suit', 'Suit']];

// bit positions for optional pieces and colour switches
const B = { hood: 1, collar: 2, suit: 3, kurta: 4, cap: 5, bun: 6, long: 7, fringe: 8, glasses: 9, headphones: 10, backpack: 11, beard: 12, shorts: 13, shortSleeve: 14, lanyard: 15, curly: 16, phone: 17 };
// idle poses for people standing around: relaxed, on the phone, arms crossed, hands in pockets
export const IDLE = { relaxed: 0, phone: 1, crossed: 2, pockets: 3 };
const idleOf = (look) => (look.idle != null ? look.idle : [0, 0, 0, 1, 1, 1, 2, 2, 3, 3][hash(JSON.stringify(look)) % 10]);
const bit = (n) => 2 ** (n - 1);
export function maskOf(look) {
  let m = 0;
  const o = look.outfit || 'tee';
  if (o === 'hoodie') m |= bit(B.hood);
  if (o === 'shirt') m |= bit(B.collar);
  if (o === 'suit') m |= bit(B.suit) | bit(B.collar);
  if (o === 'kurta') m |= bit(B.kurta) | bit(B.collar);
  if (o === 'tee') m |= bit(B.shortSleeve);
  const h = look.hair || 'short';
  if (h === 'cap') m |= bit(B.cap);
  if (h === 'bun') m |= bit(B.bun);
  if (h === 'long') m |= bit(B.long) | bit(B.fringe);
  if (h === 'side') m |= bit(B.fringe);
  if (h === 'curly' || h === 'spiky') m |= bit(B.curly);
  if (look.glasses) m |= bit(B.glasses);
  if (look.headphones) m |= bit(B.headphones);
  if (look.backpack) m |= bit(B.backpack);
  if (look.beard) m |= bit(B.beard);
  if (look.legs === 'shorts' && o !== 'suit' && o !== 'kurta') m |= bit(B.shorts);
  if (look.lanyard && o !== 'suit') m |= bit(B.lanyard);
  return m;
}

export const seedOf = (id) => hash(String(id));
export function lookFromSeed(seed) {
  const r = rng(seed), pick = (a) => a[(r() * a.length) | 0];
  const x = r(), outfit = x < 0.3 ? 'tee' : x < 0.52 ? 'hoodie' : x < 0.77 ? 'shirt' : x < 0.9 ? 'kurta' : 'suit';
  const top = outfit === 'suit' ? pick(SUITS) : outfit === 'kurta' ? pick(KURTAS) : pick(TOPS);
  return {
    outfit, top, bottom: pick(BOTTOMS.slice(0, 6)), skin: pick(SKIN), hairColor: pick(HAIRCOL.slice(0, 4)), accent: pick(ACCENTS),
    hair: pick(['short', 'short', 'side', 'bun', 'long', 'curly', 'cap']), legs: outfit === 'tee' && r() < 0.3 ? 'shorts' : 'pants',
    glasses: r() < 0.22, beard: r() < 0.25, lanyard: (outfit === 'shirt' || outfit === 'hoodie') && r() < 0.3, backpack: r() < 0.12, headphones: r() < 0.06,
  };
}
export const shirtOf = (id) => lookFromSeed(seedOf(id)).top;

// ---- geometry -----------------------------------------------------------------
// Slots pick the colour: skin 0, top 1, bottom 2, hair 3, accent 4, lower leg 5
// (skin in shorts), forearm 6 (skin in a T-shirt), fixed colour 9.
// Roughness per slot is set in the shader (skin and hair a little glossy).
const S = { skin: 0, top: 1, bottom: 2, hair: 3, accent: 4, shin: 5, forearm: 6, fixed: 9 };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
// ao = [yLow, yHigh, amount]: darkens the piece towards yLow, a cheap ambient-occlusion bake
function piece(geo, slot, part = 0, color = '#ffffff', at = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], ao = null) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.applyMatrix4(tmpM.compose(tmpV.set(...at), tmpQ.setFromEuler(tmpE.set(rot[0], rot[1], rot[2], 'YXZ')), tmpS.set(...scl)));
  const pos = g.attributes.position, n = pos.count, c = new THREE.Color(color);
  const col = new Float32Array(n * 3), sl = new Float32Array(n).fill(slot), pt = new Float32Array(n).fill(part);
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (ao) { const t = THREE.MathUtils.smoothstep(pos.getY(i), ao[0], ao[1]); k = 1 - ao[2] * (1 - t); }
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('slot', new THREE.BufferAttribute(sl, 1));
  g.setAttribute('part', new THREE.BufferAttribute(pt, 1));
  return g;
}
const lathe = (pts, seg = 9) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const sph = (r, w = 9, h = 6) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, s = 9) => new THREE.CylinderGeometry(a, b, h, s);
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  return geo;
}

const HIP = 0.93, HIP_X = 0.095, THIGH = 0.46, SHOULDER = 1.425, SHOULDER_X = 0.235, UPPER = 0.3, NECK = 1.53;

// body: pelvis, torso and every outfit piece. Feet at y = 0, facing +z.
const BODY = mergeGeometries([
  piece(lathe([[0, 0.8], [0.09, 0.805], [0.142, 0.85], [0.162, 0.92], [0.162, 1.0], [0, 1.0]], 11), S.bottom, 0, '#ffffff', [0, 0, 0], [0, 0, 0], [1.05, 1, 0.74], [0.8, 0.95, 0.35]),
  piece(cyl(0.166, 0.166, 0.045, 11), S.fixed, 0, '#2b2622', [0, 0.995, 0], [0, 0, 0], [1.05, 1, 0.75]),
  piece(box(0.05, 0.035, 0.02), S.fixed, 0, '#c2a25e', [0, 0.995, 0.124]),
  piece(lathe([[0, 0.98], [0.152, 0.985], [0.142, 1.08], [0.158, 1.2], [0.186, 1.31], [0.196, 1.4], [0.168, 1.48], [0.09, 1.535], [0, 1.54]], 12), S.top, 0, '#ffffff', [0, 0, 0], [0, 0, 0], [1.14, 1, 0.68], [0.98, 1.16, 0.22]),
  piece(sph(0.088, 8, 6), S.top, 0, '#ffffff', [-0.208, 1.415, 0], [0, 0, 0], [1.1, 0.88, 1]),
  piece(sph(0.088, 8, 6), S.top, 0, '#ffffff', [0.208, 1.415, 0], [0, 0, 0], [1.1, 0.88, 1]),
  piece(cyl(0.05, 0.058, 0.14, 8), S.skin, 0, '#ffffff', [0, 1.55, 0.005], [0, 0, 0], [1, 1, 0.95], [1.49, 1.62, 0.4]),
  // T-shirt crew neck
  piece(new THREE.TorusGeometry(0.066, 0.013, 3, 10), S.top, B.shortSleeve, '#d0d0d0', [0, 1.505, 0.012], [Math.PI / 2, 0, 0], [1, 0.82, 1]),
  // hoodie: hood folded behind the neck, kangaroo pocket, drawstrings, ribbed hem
  piece(new THREE.TorusGeometry(0.115, 0.06, 5, 10, Math.PI * 1.3), S.top, B.hood, '#d2d2d2', [0, 1.5, -0.035], [Math.PI / 2 + 0.3, 0, Math.PI * 0.85], [1.05, 1, 1]),
  piece(box(0.25, 0.13, 0.035), S.top, B.hood, '#c4c4c4', [0, 1.1, 0.112], [-0.05, 0, 0]),
  piece(cyl(0.006, 0.006, 0.15, 5), S.fixed, B.hood, '#f2f0ea', [-0.042, 1.39, 0.128]),
  piece(cyl(0.006, 0.006, 0.15, 5), S.fixed, B.hood, '#f2f0ea', [0.042, 1.39, 0.128]),
  piece(cyl(0.162, 0.158, 0.05, 11), S.top, B.hood, '#bdbdbd', [0, 1.0, 0], [0, 0, 0], [1.14, 1, 0.71]),
  // shirt collar and buttons (shirt, kurta, suit)
  piece(box(0.095, 0.045, 0.11), S.top, B.collar, '#f0f0f0', [-0.055, 1.505, 0.055], [0.45, 0.5, 0.35]),
  piece(box(0.095, 0.045, 0.11), S.top, B.collar, '#f0f0f0', [0.055, 1.505, 0.055], [0.45, -0.5, -0.35]),
  piece(box(0.022, 0.34, 0.008), S.top, B.collar, '#d6d6d6', [0, 1.3, 0.13]),
  ...[1.42, 1.34, 1.26, 1.18].map((y) => piece(sph(0.008, 4, 2), S.accent, B.collar, '#ffffff', [0, y, 0.134])),
  // suit: shirt front, tie, lapels and pocket square
  piece(box(0.12, 0.2, 0.01), S.fixed, B.suit, '#f4f4f2', [0, 1.39, 0.131]),
  piece(sph(0.02, 5, 3), S.accent, B.suit, '#ffffff', [0, 1.475, 0.135], [0, 0, 0], [1, 0.8, 0.7]),
  piece(box(0.045, 0.26, 0.014), S.accent, B.suit, '#ffffff', [0, 1.33, 0.139], [0.04, 0, 0]),
  piece(box(0.07, 0.3, 0.018), S.top, B.suit, '#8c8c8c', [-0.074, 1.34, 0.13], [0, 0, -0.33]),
  piece(box(0.07, 0.3, 0.018), S.top, B.suit, '#8c8c8c', [0.074, 1.34, 0.13], [0, 0, 0.33]),
  piece(box(0.045, 0.02, 0.01), S.fixed, B.suit, '#f4f4f2', [-0.12, 1.33, 0.126], [0, 0, 0.1]),
  // kurta: long tunic flaring over the thighs
  piece(lathe([[0.168, 1.0], [0.19, 0.9], [0.215, 0.79], [0.232, 0.7]], 11), S.top, B.kurta, '#ededed', [0, 0, 0], [0, 0, 0], [1.1, 1, 0.8], [0.7, 0.85, 0.2]),
  piece(box(0.03, 0.22, 0.01), S.accent, B.kurta, '#ffffff', [0, 1.38, 0.132]),
  // office ID lanyard and card
  piece(box(0.016, 0.3, 0.008), S.accent, B.lanyard, '#ffffff', [-0.058, 1.36, 0.132], [0, 0, 0.22]),
  piece(box(0.016, 0.3, 0.008), S.accent, B.lanyard, '#ffffff', [0.058, 1.36, 0.132], [0, 0, -0.22]),
  piece(box(0.07, 0.095, 0.008), S.fixed, B.lanyard, '#f4f6f8', [0, 1.19, 0.138]),
  piece(box(0.05, 0.02, 0.009), S.accent, B.lanyard, '#ffffff', [0, 1.215, 0.14]),
  // backpack
  piece(deform(sph(1, 8, 6), (v) => { v.y *= 1.25; v.z *= v.z > 0 ? 0.6 : 1; }), S.fixed, B.backpack, '#2b2d36', [0, 1.24, -0.17], [0, 0, 0], [0.17, 0.2, 0.1]),
  piece(box(0.22, 0.14, 0.04), S.accent, B.backpack, '#ffffff', [0, 1.13, -0.27]),
  piece(new THREE.TorusGeometry(0.035, 0.008, 3, 5, Math.PI), S.fixed, B.backpack, '#2b2d36', [0, 1.49, -0.17]),
  piece(box(0.035, 0.36, 0.022), S.fixed, B.backpack, '#2b2d36', [-0.12, 1.3, 0.112], [0.1, 0, 0]),
  piece(box(0.035, 0.36, 0.022), S.fixed, B.backpack, '#2b2d36', [0.12, 1.3, 0.112], [0.1, 0, 0]),
]);

// head, modelled around the neck pivot: a sculpted skull with jaw, cheeks and chin
const skull = deform(sph(1, 18, 13), (v) => {
  const low = Math.max(0, -v.y);
  v.x *= 1 - 0.24 * low * low;                       // narrower jaw
  if (v.z > 0) v.z *= 1 + 0.06 * low - 0.04 * Math.max(0, v.y); else v.z *= 1.08 - 0.1 * low; // chin forward, fuller back
  if (v.y > 0) v.y *= 1.03;
  if (v.z > 0.5 && Math.abs(v.y) < 0.35) v.z -= 0.04 * (1 - Math.abs(v.x) * 1.2) * (v.z - 0.5); // flatter face plane
});
const eye = (s) => [
  piece(sph(1, 6, 4), S.fixed, 0, '#f7f4ef', [s * 0.071, 0.29, 0.181], [0, 0, 0], [0.03, 0.023, 0.016]),
  piece(sph(1, 5, 3), S.fixed, 0, '#3a2414', [s * 0.071, 0.288, 0.193], [0, 0, 0], [0.0165, 0.0165, 0.008]),
  piece(sph(1, 4, 2), S.fixed, 0, '#0a0a0c', [s * 0.071, 0.288, 0.198], [0, 0, 0], [0.008, 0.008, 0.005]),
  piece(sph(0.0042, 4, 2), S.fixed, 0, '#ffffff', [s * 0.071 + 0.006, 0.295, 0.2]),
  piece(new THREE.SphereGeometry(1, 6, 2, 0, Math.PI * 2, 0, Math.PI * 0.45), S.skin, 0, '#e2c2b0', [s * 0.071, 0.292, 0.181], [-0.5, 0, 0], [0.033, 0.026, 0.02]),
  piece(box(0.068, 0.017, 0.018), S.hair, 0, '#ffffff', [s * 0.074, 0.336, 0.19], [0.15, 0, -s * 0.14]),
];
const HEAD = mergeGeometries([
  piece(skull, S.skin, 0, '#ffffff', [0, 0.27, 0.005], [0, 0, 0], [0.198, 0.243, 0.212], [0.07, 0.2, 0.12]),
  piece(sph(1, 6, 5), S.skin, 0, '#e8d3c8', [-0.197, 0.265, -0.01], [0, -0.3, 0], [0.022, 0.05, 0.036]),
  piece(sph(1, 6, 5), S.skin, 0, '#e8d3c8', [0.197, 0.265, -0.01], [0, 0.3, 0], [0.022, 0.05, 0.036]),
  piece(deform(sph(1, 10, 8), (v) => { if (v.y > 0) v.z *= 0.6; }), S.skin, 0, '#efe0d8', [0, 0.248, 0.2], [0.25, 0, 0], [0.026, 0.05, 0.034]),
  ...eye(-1), ...eye(1),
  piece(new THREE.TorusGeometry(0.034, 0.0075, 4, 12, Math.PI * 0.9), S.fixed, 0, '#7a3330', [0, 0.19, 0.2], [0.25, 0, Math.PI * 1.05]),
  piece(sph(1, 7, 4), S.skin, 0, '#d98a7c', [0, 0.163, 0.197], [0.15, 0, 0], [0.03, 0.009, 0.014]),
  piece(sph(1, 7, 4), S.skin, 0, '#f3b9ad', [-0.105, 0.225, 0.17], [0, -0.4, 0], [0.04, 0.026, 0.012]),
  piece(sph(1, 7, 4), S.skin, 0, '#f3b9ad', [0.105, 0.225, 0.17], [0, 0.4, 0], [0.04, 0.026, 0.012]),
  // hair: a full shell that leaves the face clear, plus volume on top
  piece(deform(new THREE.SphereGeometry(1, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.64), (v) => { if (v.z > 0.2) v.y += 0.08 * v.z; }), S.hair, 0, '#ffffff', [0, 0.298, -0.008], [-0.42, 0, 0], [0.212, 0.25, 0.232], [0.2, 0.4, 0.25]),
  piece(sph(1, 8, 5), S.hair, 0, '#ffffff', [0.02, 0.47, 0.03], [0, 0, 0.2], [0.15, 0.06, 0.15]),
  piece(deform(sph(1, 9, 5), (v) => { v.y -= 0.25 * v.x * v.x; }), S.hair, B.fringe, '#ffffff', [0.03, 0.43, 0.13], [0.35, 0, -0.35], [0.16, 0.05, 0.08]),
  piece(sph(1, 8, 6), S.hair, B.bun, '#ffffff', [0, 0.5, -0.15], [0, 0, 0], [0.105, 0.095, 0.1]),
  piece(deform(sph(1, 10, 7), (v) => { if (v.y < 0) v.z *= 0.7; }), S.hair, B.long, '#ffffff', [0, 0.16, -0.12], [0.12, 0, 0], [0.2, 0.25, 0.1], [-0.1, 0.1, 0.3]),
  piece(sph(1, 10, 8), S.hair, B.long, '#ffffff', [-0.19, 0.2, -0.02], [0, 0, 0.1], [0.045, 0.16, 0.08]),
  piece(sph(1, 10, 8), S.hair, B.long, '#ffffff', [0.19, 0.2, -0.02], [0, 0, -0.1], [0.045, 0.16, 0.08]),
  ...[[-0.11, 0.47, 0.07], [0.11, 0.47, 0.07], [0, 0.51, -0.04], [-0.17, 0.4, -0.06], [0.17, 0.4, -0.06]]
    .map((at) => piece(sph(0.08, 6, 4), S.hair, B.curly, '#ffffff', at)),
  piece(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), S.accent, B.cap, '#ffffff', [0, 0.335, -0.005], [-0.08, 0, 0], [0.222, 0.2, 0.238]),
  piece(deform(cyl(1, 1, 1, 12), (v) => { if (v.z < 0) v.z = 0; }), S.accent, B.cap, '#c8c8c8', [0, 0.36, 0.215], [-0.15, 0, 0], [0.15, 0.012, 0.13]),
  piece(sph(0.016, 6, 5), S.accent, B.cap, '#c8c8c8', [0, 0.535, -0.01]),
  piece(deform(new THREE.SphereGeometry(1, 11, 5, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.5, Math.PI * 0.4), () => {}), S.hair, B.beard, '#ffffff', [0, 0.25, 0.02], [0, 0, 0], [0.205, 0.235, 0.21]),
  piece(new THREE.TorusGeometry(0.036, 0.0065, 3, 10), S.fixed, B.glasses, '#1b1b20', [-0.071, 0.29, 0.207]),
  piece(new THREE.TorusGeometry(0.036, 0.0065, 3, 10), S.fixed, B.glasses, '#1b1b20', [0.071, 0.29, 0.207]),
  piece(box(0.036, 0.007, 0.007), S.fixed, B.glasses, '#1b1b20', [0, 0.294, 0.21]),
  piece(box(0.006, 0.006, 0.19), S.fixed, B.glasses, '#1b1b20', [-0.106, 0.292, 0.11]),
  piece(box(0.006, 0.006, 0.19), S.fixed, B.glasses, '#1b1b20', [0.106, 0.292, 0.11]),
  piece(new THREE.TorusGeometry(0.235, 0.02, 4, 12, Math.PI), S.fixed, B.headphones, '#1b1b20', [0, 0.27, -0.01]),
  piece(cyl(0.065, 0.065, 0.05, 9), S.accent, B.headphones, '#ffffff', [-0.225, 0.26, -0.01], [0, 0, Math.PI / 2]),
  piece(cyl(0.065, 0.065, 0.05, 9), S.accent, B.headphones, '#ffffff', [0.225, 0.26, -0.01], [0, 0, Math.PI / 2]),
]);

const THIGH_G = mergeGeometries([
  piece(lathe([[0, 0.03], [0.07, 0.025], [0.094, -0.03], [0.092, -0.17], [0.08, -0.34], [0.07, -0.44], [0.05, -0.47], [0, -0.475]], 9), S.bottom, 0, '#ffffff', [0, 0, 0], [0, 0, 0], [1, 1, 0.95]),
]);
const SHIN_G = mergeGeometries([
  piece(lathe([[0, 0.015], [0.064, 0.005], [0.071, -0.07], [0.073, -0.15], [0.06, -0.29], [0.046, -0.38], [0.044, -0.41], [0, -0.415]], 9), S.shin, 0, '#ffffff'),
  piece(cyl(0.05, 0.05, 0.05, 8), S.fixed, 0, '#efede8', [0, -0.39, 0]),
  piece(deform(sph(1, 10, 6), (v) => { if (v.y < 0) v.y *= 0.4; if (v.z < -0.5) v.y *= 1.15; }), S.fixed, 0, '#f6f4ef', [0, -0.43, 0.035], [0, 0, 0], [0.066, 0.06, 0.14], [-0.47, -0.4, 0.15]),
  piece(box(0.14, 0.03, 0.3), S.accent, 0, '#ffffff', [0, -0.475, 0.035]),
  piece(box(0.1, 0.018, 0.06), S.accent, 0, '#ffffff', [0, -0.41, 0.12], [0.35, 0, 0]),
]);
const UPPER_G = mergeGeometries([
  piece(lathe([[0, 0.03], [0.06, 0.02], [0.07, -0.04], [0.068, -0.14], [0.058, -0.27], [0.05, -0.3], [0, -0.31]], 9), S.top, 0, '#ffffff'),
  piece(lathe([[0.072, -0.1], [0.078, -0.13], [0.074, -0.16]], 9), S.top, B.shortSleeve, '#d4d4d4'),
]);
const FORE_G = mergeGeometries([
  piece(lathe([[0, 0.012], [0.054, 0.004], [0.058, -0.06], [0.049, -0.19], [0.04, -0.255], [0, -0.265]], 9), S.forearm, 0, '#ffffff'),
  piece(sph(1, 7, 5), S.skin, 0, '#ffffff', [0, -0.315, 0.008], [0, 0, 0], [0.036, 0.055, 0.024]),
  piece(deform(sph(1, 7, 5), (v) => { if (v.y < 0) v.z += 0.2 * v.y; }), S.skin, 0, '#f2e8e2', [0, -0.37, 0.012], [0, 0, 0], [0.034, 0.04, 0.021]),
  piece(new THREE.CapsuleGeometry(0.013, 0.035, 1, 5), S.skin, 0, '#ffffff', [0, -0.315, 0.04], [0.5, 0, 0]),
  piece(box(0.075, 0.14, 0.012), S.fixed, B.phone, '#16171c', [0, -0.35, 0.04], [0.2, 0, 0]),
  piece(box(0.064, 0.12, 0.004), S.fixed, B.phone, '#6fa8dc', [0, -0.35, 0.047], [0.2, 0, 0]),
]);

// ---- shader: per-instance colours, optional pieces, PBR + rim light ------------
const ATTR = `
attribute float slot; attribute float part; attribute float iMask;
attribute vec3 iSkin; attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iHair; attribute vec3 iAccent;
float hasBit(float m, float b) { return mod(floor((m + 0.5) / exp2(b - 1.0)), 2.0); }`;
const COLLAPSE = `#include <begin_vertex>
  if (part > 0.5 && hasBit(iMask, part) < 0.5) transformed = vec3(0.0);`;
export const personUniforms = { uRim: { value: 0.3 }, uRimColor: { value: new THREE.Color('#ffe6c8') } };
function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, personUniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + ATTR + '\nvarying vec3 vTint;\nvarying float vRough;')
      .replace('#include <begin_vertex>', COLLAPSE + `
  vec3 t_ = vec3(1.0); float r_ = 0.82;
  if (slot < 0.5) { t_ = iSkin; r_ = 0.55; }
  else if (slot < 1.5) t_ = iTop;
  else if (slot < 2.5) { t_ = iBottom; r_ = 0.9; }
  else if (slot < 3.5) { t_ = iHair; r_ = 0.42; }
  else if (slot < 4.5) { t_ = iAccent; r_ = 0.6; }
  else if (slot < 5.5) { bool sk_ = hasBit(iMask, 13.0) > 0.5; t_ = sk_ ? iSkin : iBottom; r_ = sk_ ? 0.55 : 0.9; }
  else if (slot < 6.5) { bool sk_ = hasBit(iMask, 14.0) > 0.5; t_ = sk_ ? iSkin : iTop; r_ = sk_ ? 0.55 : 0.82; }
  else r_ = 0.5;
  vTint = t_; vRough = r_;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;\nvarying float vRough;\nuniform float uRim;\nuniform vec3 uRimColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vTint;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vRough;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float rim_ = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
  totalEmissiveRadiance += (diffuseColor.rgb * 0.55 + uRimColor * 0.18) * rim_ * uRim;`);
  };
  m.customProgramCacheKey = () => 'person-pbr';
  return m;
}
function depthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + ATTR).replace('#include <begin_vertex>', COLLAPSE); };
  m.customProgramCacheKey = () => 'person-depth';
  return m;
}

// ---- a crowd -------------------------------------------------------------------
const SEGMENTS = [['body', BODY, 1], ['head', HEAD, 1], ['thigh', THIGH_G, 2], ['shin', SHIN_G, 2], ['upper', UPPER_G, 2], ['fore', FORE_G, 2]];
const ringGeo = new THREE.RingGeometry(0.62, 0.86, 28).rotateX(-Math.PI / 2).translate(0, 0.035, 0);
// soft contact shadow under each person, so they sit on the ground even where the sun shadow is faint
const blobGeo = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2).translate(0, 0.025, 0);
const blobTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.55, 'rgba(0,0,0,0.35)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55, color: '#000000', polygonOffset: true, polygonOffsetFactor: -2 });

export class Crowd {
  constructor(scene, cap, { ring = false, ghost = false } = {}) {
    this.scene = scene; this.cap = cap; this.count = 0;
    const mat = personMaterial(), depth = depthMaterial();
    this.seg = {};
    for (const [name, geo, k] of SEGMENTS) {
      const g = geo.clone(), n = cap * k;
      for (const a of ['iSkin', 'iTop', 'iBottom', 'iHair', 'iAccent']) g.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('iMask', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
      const im = new THREE.InstancedMesh(g, mat, n);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      im.customDepthMaterial = depth;
      scene.add(im);
      this.seg[name] = { im, k };
    }
    this.blob = new THREE.InstancedMesh(blobGeo, blobMat, cap);
    this.blob.count = 0; this.blob.frustumCulled = false; this.blob.renderOrder = 1; scene.add(this.blob);
    if (ring) {
      this.ring = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), cap);
      this.ring.count = 0; this.ring.frustumCulled = false; scene.add(this.ring);
      this.ringOn = new Uint8Array(cap);
    }
    this.pose = new Uint8Array(cap);
    this.bw = new Float32Array(cap).fill(1); this.bh = new Float32Array(cap).fill(1);
    this.c = new THREE.Color();
    this.M = new THREE.Matrix4(); this.A = new THREE.Matrix4(); this.Bm = new THREE.Matrix4(); this.J = new THREE.Matrix4(); this.R = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.sv = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }
  add(look, ringColor) {
    const i = this.count++;
    for (const { im, k } of Object.values(this.seg)) im.count = this.count * k;
    if (this.ring) this.ring.count = this.count;
    this.blob.count = this.count;
    this.paint(i, look, ringColor);
    return i;
  }
  paint(i, look, ringColor) {
    const c = this.c, mask = maskOf(look), pose = idleOf(look);
    this.pose[i] = pose;
    const hb = hash(JSON.stringify(look) + 'b');
    this.bw[i] = look.build ? look.build[0] : 0.93 + ((hb % 1000) / 1000) * 0.15;
    this.bh[i] = look.build ? look.build[1] : 0.95 + (((hb >> 10) % 1000) / 1000) * 0.11;
    const cols = { iSkin: look.skin || SKIN[2], iTop: look.top || TOPS[0], iBottom: look.bottom || BOTTOMS[0], iHair: look.hairColor || HAIRCOL[0], iAccent: look.accent || ACCENTS[0] };
    for (const { im, k } of Object.values(this.seg)) {
      const at = im.geometry.attributes;
      for (let j = 0; j < k; j++) {
        const n = i * k + j;
        for (const [a, hex] of Object.entries(cols)) { c.set(hex); at[a].setXYZ(n, c.r, c.g, c.b); at[a].needsUpdate = true; }
        // the phone shows only in the right hand of someone whose idle pose is texting
        at.iMask.setX(n, mask + (k === 2 && j === 1 && pose === IDLE.phone ? 2 ** (B.phone - 1) : 0)); at.iMask.needsUpdate = true;
      }
    }
    if (this.ring) { this.ringOn[i] = ringColor ? 1 : 0; this.ring.setColorAt(i, c.set(ringColor || '#000000')); this.ring.instanceColor.needsUpdate = true; }
  }
  // phase/amt drive the walk cycle (amt 0 idle, 1 walk, ~1.3 run); wave 0..1 raises the right hand
  // phase/amt drive the walk cycle (amt 0 idle, 1 walk, ~1.3 run); wave 0..1 raises the right hand;
  // headYaw turns the head (e.g. to look at the visitor); y is the surface they stand on
  set(i, x, y, z, yaw, phase = 0, amt = 0, wave = 0, t = 0, s = 1, headYaw = 0) {
    const { M, A, Bm, J, R } = this, sg = this.seg;
    // k blends smoothly from the standing pose (0) to the walk cycle (1): no snapping
    const k = Math.min(1, Math.max(0, (amt - 0.02) / 0.4)), kk = k * k * (3 - 2 * k), pose = this.pose[i];
    const run = Math.max(0, amt - 1), sw = Math.sin(phase), cw = Math.cos(phase), mix = (a, b) => a + (b - a) * kk;
    const bob = mix(Math.sin(t * 1.6) * 0.004, Math.abs(sw) * 0.045 * Math.min(1.2, amt));
    M.compose(this.p.set(x, y + bob, z), this.q.setFromAxisAngle(this.up, yaw), this.sv.set(s * this.bw[i], s * this.bh[i], s * this.bw[i]));
    M.multiply(R.makeRotationY(sw * 0.09 * kk)); // hips swing with the stride
    if (run > 0) M.multiply(R.makeRotationX(0.36 * run)); // lean into a run
    M.multiply(R.makeRotationZ(mix(Math.sin(t * 0.45) * 0.025, cw * 0.03))); // weight shift / side sway
    sg.body.im.setMatrixAt(i, M);
    const look = (1 - kk) * Math.sin(t * 0.37) * 0.18;
    const nod = pose === IDLE.phone && !wave ? 0.38 * (1 - kk) : wave ? -0.12 * wave : 0;
    A.multiplyMatrices(M, J.makeTranslation(0, NECK, 0)).multiply(R.makeRotationY((headYaw || look) - sw * 0.09 * kk)).multiply(J.makeRotationX(nod + (wave ? Math.sin(t * 4) * 0.04 * wave : 0)));
    sg.head.im.setMatrixAt(i, A);
    const restLeg = Math.sin(t * 0.45) > 0 ? 1 : 0;
    for (let kx = 0; kx < 2; kx++) {
      const side = kx ? 1 : -1, n = i * 2 + kx;
      // legs: thigh swings, knee bends as the leg comes through; standing, one knee relaxes
      const thW = -sw * 0.55 * side * Math.min(1.25, amt), knW = Math.min(1.25, amt) * (0.08 + 0.85 * Math.max(0, cw * side));
      const thI = kx === restLeg ? -0.05 : 0, knI = kx === restLeg ? 0.12 : 0.02;
      A.multiplyMatrices(M, J.makeTranslation(side * HIP_X, HIP, 0)).multiply(R.makeRotationX(mix(thI, thW)));
      sg.thigh.im.setMatrixAt(n, A);
      Bm.multiplyMatrices(A, J.makeTranslation(0, -THIGH, 0)).multiply(R.makeRotationX(mix(knI, knW)));
      sg.shin.im.setMatrixAt(n, Bm);
      // arms: idle pose blended with the walking swing
      let ax, az, el, fz = 0;
      if (pose === IDLE.phone) { ax = kx ? -0.38 : -0.3; az = side * 0.12; el = kx ? -1.72 : -1.5; fz = -side * 0.25; }
      else if (pose === IDLE.crossed) { ax = -0.22; az = side * 0.14; el = kx ? -1.6 : -1.78; fz = -side * 1.12; }
      else if (pose === IDLE.pockets) { ax = 0.14; az = side * 0.07; el = -0.5; fz = side * 0.12; }
      else { ax = 0.02 + Math.sin(t * 1.6 + kx) * 0.01; az = side * 0.1; el = -0.15; }
      ax = mix(ax, sw * 0.5 * side * Math.min(1.2, amt)); az = mix(az, side * (0.1 + run * 0.1)); el = mix(el, -(0.2 + 0.4 * Math.min(1, amt) + run * 0.6)); fz = mix(fz, 0);
      if (kx === 1 && wave > 0) { // blend the right arm up into a wave
        ax += (-0.2 - ax) * wave; az += (side * 2.45 - az) * wave; el += (-0.5 - el) * wave; fz = fz * (1 - wave) + Math.sin(t * 10) * 0.45 * wave;
      }
      A.multiplyMatrices(M, J.makeTranslation(side * SHOULDER_X, SHOULDER, 0)).multiply(R.makeRotationY(-sw * 0.1 * kk)).multiply(J.makeRotationZ(az)).multiply(R.makeRotationX(ax));
      sg.upper.im.setMatrixAt(n, A);
      Bm.multiplyMatrices(A, J.makeTranslation(0, -UPPER, 0)).multiply(R.makeRotationX(el));
      if (fz) Bm.multiply(R.makeRotationZ(fz));
      sg.fore.im.setMatrixAt(n, Bm);
    }
    if (y < -1) A.makeScale(0, 0, 0); else A.makeTranslation(x, y, z);
    this.blob.setMatrixAt(i, A);
    if (this.ring) {
      if (!this.ringOn[i] || y < -1) A.makeScale(0, 0, 0); else A.makeTranslation(x, y, z);
      this.ring.setMatrixAt(i, A);
    }
  }
  hide(i) { this.set(i, 0, -60, 0, 0, 0, 0, 0, 0, 0.0001); }
  commit() { for (const { im } of Object.values(this.seg)) im.instanceMatrix.needsUpdate = true; this.blob.instanceMatrix.needsUpdate = true; if (this.ring) this.ring.instanceMatrix.needsUpdate = true; }
  dispose() {
    for (const { im } of Object.values(this.seg)) { this.scene.remove(im); im.geometry.dispose(); }
    Object.values(this.seg)[0].im.material.dispose();
    this.scene.remove(this.blob);
    if (this.ring) { this.scene.remove(this.ring); this.ring.material.dispose(); }
  }
}

// ---- the visitor's own character (a crowd of one) -----------------------------
// guests get a solid, friendly default character (no translucent ghost)
const GUEST_LOOK = { outfit: 'hoodie', top: '#ffb81c', bottom: '#2d3a5c', skin: '#c99067', hairColor: '#16120f', accent: '#1d2433', hair: 'side', legs: 'pants' };
export function makeAvatar(scene, look, ghost) {
  const c = new Crowd(scene, 1, { ghost });
  c.add({ ...(ghost ? GUEST_LOOK : look), idle: IDLE.relaxed, build: [1, 1.02] });
  return {
    place(x, y, z, yaw, phase, amt, t) { c.set(0, x, y, z, yaw, phase, amt, 0, t); c.commit(); },
    hide() { c.hide(0); c.commit(); },
    dispose() { c.dispose(); },
  };
}

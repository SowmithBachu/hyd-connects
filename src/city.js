import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DISTRICTS, ROADS, METRO, LAKES, PARKS, LANDMARKS, WORLD_HALF, BOUNDS, inBounds,
  resolvePts, rng, nearestDistrict,
} from './geo.js';
import { Boxes, glassMaterial, streetBuilding, WALLS } from './facade.js';
import { InstanceBin, tiledMerge } from './chunks.js';
import { L, boxSurface, flatSurface, propSurface, treeSurface, treeDepth, glassSurface, blockSurface, surfaceUniforms } from './surfaces.js';
import { treeGeometry } from './trees.js';

// Solid props (lamp posts, tree trunks, benches, carts, pillars) that people walk around.
export class Props {
  constructor() { this.cells = new Map(); }
  key(x, z) { return (Math.floor(x / 4) + 1000) * 4096 + (Math.floor(z / 4) + 1000); } // numeric: no string garbage
  add(x, z, r) { const k = this.key(x, z); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push({ x, z, r }); }
  // calls fn(prop) for props near (x, z)
  near(x, z, fn) {
    const i0 = Math.floor(x / 4), j0 = Math.floor(z / 4);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const c = this.cells.get((i + 1000) * 4096 + (j + 1000)); if (c) for (const p of c) fn(p); }
  }
}

export const ROAD = 1, WATER = 2, SOLID = 4, PLAZA = 8, DECOR = 16, CARRIAGE = 32;

// Coarse occupancy grid: used for placing buildings and for player collision.
export class Grid {
  constructor() {
    this.c = 1; // 1-unit cells: fine enough that nobody clips a wall or a cart
    this.n = (WORLD_HALF * 2) / this.c;
    this.a = new Uint8Array(this.n * this.n);
    this.h = new Uint8Array(this.n * this.n); // building heights, for the camera
    this.gh = new Uint8Array(this.n * this.n); // walkable surface height in cm (squares, roads and footpaths sit above the ground)
  }
  i(x) { return Math.floor((x + WORLD_HALF) / this.c); }
  get(x, z) {
    const i = this.i(x), j = this.i(z);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 255;
    return this.a[j * this.n + i];
  }
  rect(x0, z0, x1, z1, bit) {
    const i0 = Math.max(0, this.i(x0)), i1 = Math.min(this.n - 1, this.i(x1));
    const j0 = Math.max(0, this.i(z0)), j1 = Math.min(this.n - 1, this.i(z1));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.a[j * this.n + i] |= bit;
  }
  any(x0, z0, x1, z1, mask) {
    const i0 = this.i(x0), i1 = this.i(x1), j0 = this.i(z0), j1 = this.i(z1);
    if (i0 < 0 || j0 < 0 || i1 >= this.n || j1 >= this.n) return true;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.a[j * this.n + i] & mask) return true;
    return false;
  }
  circle(x, z, r, bit) {
    const i0 = Math.max(0, this.i(x - r)), i1 = Math.min(this.n - 1, this.i(x + r));
    const j0 = Math.max(0, this.i(z - r)), j1 = Math.min(this.n - 1, this.i(z + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * this.c - WORLD_HALF, cz = (j + 0.5) * this.c - WORLD_HALF;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) this.a[j * this.n + i] |= bit;
    }
  }
  setH(x0, z0, x1, z1, h) {
    const i0 = Math.max(0, this.i(x0)), i1 = Math.min(this.n - 1, this.i(x1)), j0 = Math.max(0, this.i(z0)), j1 = Math.min(this.n - 1, this.i(z1));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.h[j * this.n + i] = Math.min(255, Math.ceil(h));
  }
  height(x, z) {
    const i = this.i(x), j = this.i(z);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? 0 : this.h[j * this.n + i];
  }
  // raise the walkable surface inside a circle to h (metres); keeps the highest
  surface(x, z, r, h) {
    const v = Math.round(h * 100);
    const i0 = Math.max(0, this.i(x - r)), i1 = Math.min(this.n - 1, this.i(x + r));
    const j0 = Math.max(0, this.i(z - r)), j1 = Math.min(this.n - 1, this.i(z + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * this.c - WORLD_HALF, cz = (j + 0.5) * this.c - WORLD_HALF, k = j * this.n + i;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r && this.gh[k] < v) this.gh[k] = v;
    }
  }
  groundAt(x, z) {
    const i = this.i(x), j = this.i(z);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? 0 : this.gh[j * this.n + i] / 100;
  }
  blocked(x, z) {
    const v = this.get(x, z);
    return (v & SOLID) !== 0 || ((v & WATER) !== 0 && (v & ROAD) === 0);
  }
}

const paint = (g, color) => {
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};

// Collects coloured solid shapes and bakes them into one mesh (one draw call).
class Parts {
  constructor() { this.list = []; this.m = new THREE.Matrix4(); this.e = new THREE.Euler(); this.q = new THREE.Quaternion(); }
  geo(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')); // yaw last, so tilts follow the shape's own axes
    g.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz)));
    this.list.push(paint(g, color));
  }
  // y is the base of the shape, not its centre
  box(w, h, d, color, x, y, z, ry = 0) { this.geo(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, 0, ry, 0); }
  cyl(rt, rb, h, color, x, y, z, seg = 10, ry = 0) { this.geo(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y + h / 2, z, 0, ry, 0); }
  ball(r, color, x, y, z, sy = 1) { this.geo(new THREE.SphereGeometry(r, 10, 8), color, x, y, z, 0, 0, 0, 1, sy, 1); }
  beam(a, b, r, color) {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 5).toNonIndexed();
    g.deleteAttribute('uv');
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    this.list.push(paint(g, color));
  }
  mesh(material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })) {
    const g = tiledMerge(this.list, material, mergeGeometries);
    this.list = [];
    return g;
  }
}

// Collects flat ground decals (pads, water, roads, paving) into one mesh.
class Flat {
  // layer: texture layer for the following shapes (src/surfaces.js); concrete is a
  // neutral grain that keeps each shape's own colour
  constructor() { this.p = []; this.c = []; this.u = []; this.col = new THREE.Color(); this.layer = L.concrete; this.tile = 2.2; }
  tri(ax, az, bx, bz, cx, cz, y) {
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { let t = bx; bx = cx; cx = t; t = bz; bz = cz; cz = t; } // always face up
    this.p.push(ax, y, az, bx, y, bz, cx, y, cz);
    for (let i = 0; i < 3; i++) this.c.push(this.col.r, this.col.g, this.col.b);
    this.u.push(ax / this.tile, az / this.tile, this.layer, bx / this.tile, bz / this.tile, this.layer, cx / this.tile, cz / this.tile, this.layer);
  }
  fan(pts, cx, cz, y, color) {
    this.col.set(color);
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.tri(cx, cz, a[0], a[1], b[0], b[1], y); }
  }
  disc(x, z, r, y, color, seg = 36) {
    const pts = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    this.fan(pts, x, z, y, color);
  }
  ring(x, z, r0, r1, y, n, colA, colB) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      this.col.set(i % 2 ? colB : colA);
      const p = (ang, r) => [x + Math.cos(ang) * r, z + Math.sin(ang) * r];
      const [a0x, a0z] = p(a, r0), [a1x, a1z] = p(a, r1), [b0x, b0z] = p(b, r0), [b1x, b1z] = p(b, r1);
      this.tri(a0x, a0z, a1x, a1z, b1x, b1z, y); this.tri(a0x, a0z, b1x, b1z, b0x, b0z, y);
    }
  }
  quad(x0, z0, x1, z1, y, color) { this.col.set(color); this.tri(x0, z0, x1, z0, x1, z1, y); this.tri(x0, z0, x1, z1, x0, z1, y); }
  ribbon(s, w, y, color) {
    this.col.set(color);
    let plx, plz, prx, prz;
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const lx = s[i].x - tz * w / 2, lz = s[i].z + tx * w / 2, rx = s[i].x + tz * w / 2, rz = s[i].z - tx * w / 2;
      if (i > 0) { this.tri(plx, plz, prx, prz, lx, lz, y); this.tri(prx, prz, rx, rz, lx, lz, y); }
      plx = lx; plz = lz; prx = rx; prz = rz;
    }
  }
  mesh(material = new THREE.MeshLambertMaterial({ vertexColors: true })) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uvl', new THREE.Float32BufferAttribute(this.u, 3));
    const n = new Float32Array(this.p.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.frustumCulled = false;
    return m;
  }
}

// Textured ground decals: like Flat, plus a texture layer and uv per vertex
// (world-mapped, so neighbouring pieces line up), for the PBR streets.
class TexFlat {
  constructor() { this.p = []; this.c = []; this.u = []; this.col = new THREE.Color(); }
  tri(ax, az, bx, bz, cx, cz, y, layer, tile) {
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { let t = bx; bx = cx; cx = t; t = bz; bz = cz; cz = t; }
    for (const [x, z] of [[ax, az], [bx, bz], [cx, cz]]) { this.p.push(x, y, z); this.c.push(this.col.r, this.col.g, this.col.b); this.u.push(x / tile, z / tile, layer); }
  }
  ribbon(s, w, y, color, layer, tile) {
    this.col.set(color);
    let plx, plz, prx, prz;
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const lx = s[i].x - tz * w / 2, lz = s[i].z + tx * w / 2, rx = s[i].x + tz * w / 2, rz = s[i].z - tx * w / 2;
      if (i > 0) { this.tri(plx, plz, prx, prz, lx, lz, y, layer, tile); this.tri(prx, prz, rx, rz, lx, lz, y, layer, tile); }
      plx = lx; plz = lz; prx = rx; prz = rz;
    }
  }
  // a square decal with its own 0..1 uv (a manhole cover)
  decal(x, z, size, y, layer, rot = 0) {
    this.col.set('#ffffff');
    const c = Math.cos(rot) * size / 2, sn = Math.sin(rot) * size / 2;
    const P = [[x - c + sn, z - sn - c, 0, 0], [x + c + sn, z + sn - c, 1, 0], [x + c - sn, z + sn + c, 1, 1], [x - c - sn, z - sn + c, 0, 1]];
    for (const [i, j, k] of [[0, 2, 1], [0, 3, 2]]) for (const q of [P[i], P[j], P[k]]) { this.p.push(q[0], y, q[1]); this.c.push(1, 1, 1); this.u.push(q[2], q[3], layer); }
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uvl', new THREE.Float32BufferAttribute(this.u, 3));
    const n = new Float32Array(this.p.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.frustumCulled = false;
    return m;
  }
}
// split a sampled line into runs inside / outside a region (runs share their end points)
const runsBy = (s, pred) => {
  const out = []; let cur = null;
  for (let i = 0; i < s.length; i++) {
    const f = pred(s[i].x, s[i].z);
    if (!cur || cur.f !== f) { if (cur) cur.s.push(s[i]); cur = { f, s: cur ? [s[i - 1], s[i]] : [s[i]] }; out.push(cur); } else cur.s.push(s[i]);
  }
  return out.filter((r) => r.s.length > 1);
};

// Shop signboards: one canvas atlas, one mesh.
const SIGNS = [
  ['IRANI CHAI', '#7a1f2b', '#f6e7c1', 'Since 1978'], ['DUM BIRYANI', '#f2c230', '#3a1d12', 'Family Restaurant'], ['చాయ్ అడ్డా', '#1f6f5c', '#fdf3d7', 'Chai Adda'], ['TIFFINS', '#f6efdf', '#b5352a', 'Idli · Vada · Dosa'],
  ['బిర్యానీ హౌస్', '#b5352a', '#fde9a8', 'Biryani House'], ['MIRCHI BAJJI', '#2f7d4f', '#fff6d8', 'Hot & Fresh'], ['OSMANIA BISCUITS', '#f4e3c0', '#5a3a1d', 'Bakery'], ['HALEEM', '#5a3a2a', '#f2c230', 'Ramzan Special'],
  ['DOSA BANDI', '#e8891a', '#2a2530', 'Morning Only'], ['టిఫిన్స్', '#2f6fb5', '#ffffff', 'Tiffin Centre'], ['XEROX · PRINT', '#ffffff', '#1f4f9a', 'Lamination'], ['CO-WORK', '#2a2530', '#8fe0c9', 'Day Pass 299'],
  ['PAAN SHOP', '#1fa971', '#fffbe6', 'Meetha Paan'], ['JUICE CENTRE', '#f08a3c', '#ffffff', 'Fresh Fruit'], ['PEARLS', '#eef3f2', '#3f7590', 'Hyderabadi Pearls'], ['BAKERY', '#d9488f', '#fff1f6', 'Cakes · Puffs'],
  ['MEDICALS', '#1f8f4a', '#ffffff', '24 Hours'], ['MOBILE WORLD', '#1f4f9a', '#ffd34d', 'Repairs · Covers'], ['SWEET HOUSE', '#f6e2a8', '#8a1f2b', 'Pure Ghee'], ['TAILORS', '#3d4a5a', '#f6efdf', 'Ladies & Gents'],
  ['HAIR STUDIO', '#202024', '#ff8fb1', 'Unisex'], ['OPTICALS', '#ffffff', '#2a6f9a', 'Eye Testing'], ['FLOWERS', '#f6d6e2', '#a3274f', 'Garlands'], ['STATIONERY', '#f2c230', '#1d2433', 'Books · Gifts'],
  ['ELECTRICALS', '#e8eef2', '#d9483b', 'Fans · Lights'], ['KIRANA STORE', '#3d7d5a', '#fff4c2', 'Daily Needs'], ['CHAT CORNER', '#ff7a3d', '#ffffff', 'Pani Puri'], ['FILTER COFFEE', '#5a3a1d', '#f4e3c0', 'Since 1992'],
  ['ఆంధ్ర మెస్', '#b5352a', '#ffffff', 'Andhra Meals'], ['قہوہ خانہ', '#2f5a7a', '#f6efdf', 'Qahwa Khana'], ['GYM', '#202024', '#2ec4b6', 'Open 5 AM'], ['STARTUP HUB', '#ffffff', '#ff7a3d', 'Floors 2-4'],
  ['LAUNDRY', '#d8eef8', '#1f4f9a', 'Wash & Iron'], ['PG FOR MEN', '#fff6d8', '#2a2530', 'Food Included'], ['TECH REPAIRS', '#2a2530', '#ffd34d', 'Laptops'], ['ICE CREAM', '#ffd6e6', '#8a1f4b', 'Kulfi'],
  ['MILLETS CAFE', '#9bc45a', '#1d2433', 'Healthy Bowls'], ['TICKETS · TRAVEL', '#1f6f5c', '#ffffff', 'Bus · Train'], ['FURNITURE', '#8a5a3c', '#fff1d6', 'Teak'], ['FABRICS', '#d9488f', '#fff6d8', 'Pochampally Ikat'],
  ['HITECH CITY METRO', '#2f6fb5', '#ffffff', 'హైటెక్ సిటీ మెట్రో'],
];
const shade = (hex, k) => '#' + new THREE.Color(hex).offsetHSL(0, 0, k).getHexString();
class Signs {
  constructor() {
    // 8 x 8 atlas of 256 x 128 boards: a name in big letters and a smaller line below
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const g = c.getContext('2d');
    SIGNS.forEach(([text, bg, fg, sub], i) => {
      const x = (i % 8) * 256, y = ((i / 8) | 0) * 128;
      const grad = g.createLinearGradient(0, y, 0, y + 128); grad.addColorStop(0, bg); grad.addColorStop(1, shade(bg, -0.12));
      g.fillStyle = grad; g.fillRect(x, y, 256, 128);
      g.strokeStyle = fg; g.globalAlpha = 0.6; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, 240, 112); g.globalAlpha = 1;
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 54; do { g.font = `800 ${size}px "Segoe UI", "Nirmala UI", "Noto Sans Telugu", "Noto Nastaliq Urdu", system-ui, sans-serif`; size -= 3; } while (g.measureText(text).width > 220);
      g.fillText(text, x + 128, y + (sub ? 54 : 66));
      if (sub) { g.font = `600 20px "Segoe UI", "Nirmala UI", system-ui, sans-serif`; g.globalAlpha = 0.85; g.fillText(sub, x + 128, y + 98); g.globalAlpha = 1; }
    });
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.p = []; this.uv = []; this.n = SIGNS.length - 1; this.metro = SIGNS.length - 1;
  }
  add(x, y, z, th, w, h, cell) {
    const ax = Math.cos(th) * w / 2, az = -Math.sin(th) * w / 2, u0 = (cell % 8) / 8, u1 = u0 + 0.125, v1 = 1 - ((cell / 8) | 0) / 8, v0 = v1 - 0.125;
    const bl = [x - ax, y - h / 2, z - az, u0, v0], br = [x + ax, y - h / 2, z + az, u1, v0], tr = [x + ax, y + h / 2, z + az, u1, v1], tl = [x - ax, y + h / 2, z - az, u0, v1];
    for (const v of [bl, br, tr, bl, tr, tl]) { this.p.push(v[0], v[1], v[2]); this.uv.push(v[3], v[4]); }
  }
  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.tex }));
    m.frustumCulled = false;
    return m;
  }
}

// every third point is plenty for drawing a ribbon
const thin = (s) => s.filter((_, i) => i % 3 === 0 || i === s.length - 1);
const sample = (pts2) => {
  const curve = new THREE.CatmullRomCurve3(pts2.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength())));
};

const PAD = { tech: '#cfdcd6', mixed: '#e6d9bb', residential: '#dadcb9' };
// building colours: grey concrete and glass for the tech blocks, lime-washed
// off-whites, creams, beiges, light ochre and muted pastels everywhere else
const HOMES = ['#c9675a', '#8fbfa9', '#93b6d2', '#ead9b4', '#ddb06e', '#e3a8a0', '#b9c98f', '#f0e7d6', '#d98b62', '#a9c7c9', '#efe2c8', '#c98e8a'];
const PALETTE = {
  tech: ['#c9cdd0', '#b7bcc0', '#d6d4ce', '#a9b4ba', '#bfc3c0', '#9fb0ba'],
  mixed: HOMES,
  residential: HOMES,
};
const AWN = ['#a34a35', '#3c6378', '#5a7148', '#b07a33', '#7b5d48', '#8e3b3b', '#4f5d6b'];

function buildingMaterial(uNight) {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying float vNY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        vWP = (modelMatrix * wp_).xyz;
        vNY = objectNormal.y;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying float vNY;\nuniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float side_ = 1.0 - step(0.5, abs(vNY));
        float gx_ = fract((vWP.x + vWP.z) * 0.8);
        float gy_ = fract(vWP.y * 0.75);
        float win_ = step(0.28, gx_) * step(gx_, 0.74) * step(0.3, gy_) * step(gy_, 0.78) * step(0.9, vWP.y);
        float rnd_ = fract(sin(dot(floor(vec2((vWP.x + vWP.z) * 0.8, vWP.y * 0.75)), vec2(12.9898, 78.233))) * 43758.5453);
        float lit_ = step(mix(0.84, 0.55, uNight), rnd_);
        vec3 glass_ = mix(diffuseColor.rgb * 0.5 + vec3(0.05, 0.09, 0.14), vec3(0.72, 0.86, 0.95), (0.18 + 0.25 * clamp(vWP.y / 60.0, 0.0, 1.0)) * (1.0 - uNight));
        glass_ = mix(glass_, vec3(1.0, 0.9, 0.62), lit_ * 0.5 * (1.0 - uNight));
        float on_ = step(0.9, vWP.y) * side_;
        float frame_ = step(0.2, gx_) * step(gx_, 0.82) * step(0.22, gy_) * step(gy_, 0.86) * on_ - win_ * side_;
        float shade_ = step(0.86, gy_) * step(gy_, 0.95) * step(0.14, gx_) * step(gx_, 0.88) * on_;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.93, 0.86), clamp(frame_, 0.0, 1.0) * 0.8);
        diffuseColor.rgb *= 1.0 - shade_ * 0.28;
        diffuseColor.rgb = mix(diffuseColor.rgb, glass_, win_ * side_);
        diffuseColor.rgb *= 1.0 + 0.14 * step(0.5, vNY);
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.45) * lit_ * win_ * side_ * uNight * 1.5;`);
  };
  return m;
}

function landmarks(p, flat, grid, R) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const l of LANDMARKS) {
    const { x, z } = l;
    if (l.clear) { grid.circle(x, z, l.clear, PLAZA); grid.surface(x, z, l.clear, 0.29); flat.disc(x, z, l.clear, 0.29, '#eee4cb', 36); }
    if (l.type === 'fountain') {
      // Cyber Towers roundabout: a planted island with a giant pearl, for the City of Pearls
      flat.ring(x, z, 7.2, 7.8, 0.32, 40, '#f2c230', '#25242b');
      flat.disc(x, z, 7.2, 0.33, '#7fa65a', 40);
      flat.ring(x, z, 3.2, 3.8, 0.34, 32, '#e9e2d0', '#e9e2d0');
      p.cyl(2.2, 2.6, 1.0, '#d9d2c4', x, 0.3, z, 16);
      p.cyl(1.4, 1.8, 1.1, '#cfc7b6', x, 1.3, z, 16);
      p.geo(new THREE.SphereGeometry(1.9, 24, 18), '#fbf7f0', x, 4.3, z);
      p.geo(new THREE.TorusGeometry(2.6, 0.12, 8, 40), '#d9a441', x, 4.3, z, Math.PI / 2 - 0.35, 0, 0.2);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; p.geo(new THREE.IcosahedronGeometry(0.55, 0), ['#e2574c', '#f2c230', '#d9488f'][i % 3], x + Math.cos(a) * 5.4, 0.7, z + Math.sin(a) * 5.4); }
      grid.circle(x, z, 7.6, SOLID); grid.setH(x - 7, z - 7, x + 7, z + 7, 3);
    } else if (l.type === 'cyber') {
      p.cyl(11, 11.5, 1.6, '#c2ccc9', x, 0, z, 24);
      p.cyl(8, 8, 22, '#6aa5bf', x, 1.6, z, 20);
      for (let y = 4; y < 23; y += 3.6) p.cyl(8.25, 8.25, 0.3, '#eef3f2', x, y, z, 20);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; p.box(1.2, 23, 2.4, '#eef3f2', x + Math.cos(a) * 8, 1.6, z + Math.sin(a) * 8, -a); }
      p.cyl(5.5, 6.5, 2.4, '#3f7590', x, 23.6, z, 16);
      p.cyl(0.12, 0.12, 6, '#55606a', x, 26, z, 5);
      grid.circle(x, z, 11.5, SOLID); grid.setH(x - 9, z - 9, x + 9, z + 9, 26);
    } else if (l.type === 'thub') {
      p.box(12, 4, 7, '#3d4250', x, 0, z);
      p.box(13, 3.4, 6, '#e2574c', x + 1, 4, z, 0.45);
      p.box(10, 3, 6, '#3d4250', x - 0.5, 7.4, z, -0.3);
      p.box(6, 2.2, 4, '#9fd0d8', x, 10.4, z, 0.2);
      grid.circle(x, z, 8, SOLID); grid.setH(x - 6, z - 6, x + 6, z + 6, 12);
    } else if (l.type === 'stadium') {
      const oval = (rx, rz) => { const o = []; for (let i = 0; i < 36; i++) { const a = (i / 36) * 6.283; o.push([x + Math.cos(a) * rx, z + Math.sin(a) * rz]); } return o; };
      flat.fan(oval(14.5, 18.5), x, z, 0.31, '#c8674a');
      flat.fan(oval(11.5, 15.5), x, z, 0.33, '#6fae5c');
      flat.fan(oval(3, 3), x, z, 0.35, '#8cc474');
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, px = x + Math.cos(a) * 18, pz = z + Math.sin(a) * 22, h = 4 + 2.6 * Math.abs(Math.sin(a));
        p.box(5.9, h, 3.6, '#ece6d8', px, 0, pz, -a + Math.PI / 2);
        p.box(5.9, 0.5, 3.9, i % 2 ? '#2f6fb5' : '#e2574c', px, h, pz, -a + Math.PI / 2);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { p.cyl(0.22, 0.3, 19, '#8d8a84', x + sx * 20, 0, z + sz * 24, 6); p.box(2.6, 1.5, 0.5, '#fff7d6', x + sx * 20, 19, z + sz * 24, sx * sz * 0.7); }
      grid.circle(x, z, 24, SOLID); grid.setH(x - 21, z - 25, x + 21, z + 25, 7);
    } else if (l.type === 'rocks') {
      const g = new THREE.DodecahedronGeometry(1, 0);
      for (let i = 0; i < 13; i++) {
        const a = R() * 6.28, r = R() * 12, s = 4 + R() * 5;
        p.geo(g, R() < 0.5 ? '#b3a48c' : '#a2957f', x + Math.cos(a) * r, s * 0.42, z + Math.sin(a) * r, R() * 3, R() * 3, R() * 3, s, s * 0.8, s * 0.9);
      }
      p.geo(g, '#c0b29b', x + 1, 11.5, z - 1, 0.4, 0.8, 0.2, 3.4, 4.6, 3.2);
      grid.circle(x, z, 15, SOLID); grid.setH(x - 12, z - 12, x + 12, z + 12, 10);
    } else if (l.type === 'arch') {
      for (const sx of [-1, 1]) { p.box(1.3, 6, 1.3, '#b5523a', x + sx * 4.2, 0, z); grid.circle(x + sx * 4.2, z, 1, SOLID); }
      p.box(11, 0.9, 1.6, '#d9a441', x, 6, z);
      p.geo(new THREE.ConeGeometry(6.6, 2.6, 4), '#c9a063', x, 8.2, z, 0, Math.PI / 4, 0, 1, 1, 0.34);
      for (const [hx, hz] of [[-5, -6], [0.5, -7.5], [5.5, -5.5]]) { p.cyl(2, 2, 1.9, '#e9d3ac', x + hx, 0, z + hz, 10); p.geo(new THREE.ConeGeometry(2.9, 2.2, 10), '#b98a5e', x + hx, 3, z + hz); grid.circle(x + hx, z + hz, 2.2, SOLID); }
    } else if (l.type === 'bridge') {
      const c = '#f1eee4';
      p.box(50, 0.16, 4.4, '#d9d6cc', x, 0.14, z);
      for (const sz of [-1, 1]) p.box(50, 0.8, 0.14, c, x, 0.22, z + sz * 2.2);
      for (const px of [-10, 10]) {
        for (const sz of [-1, 1]) p.beam(V(x + px, 0, z + sz * 3.2), V(x + px, 20, z), 0.36, c);
        for (const sz of [-1, 1]) for (let k = 1; k <= 5; k++) for (const dir of [-1, 1]) {
          p.beam(V(x + px, 20 - k * 1.6, z + sz * (k * 0.16)), V(x + px + dir * k * 1.9, 1, z + sz * 2.2), 0.05, c);
        }
      }
    }
  }
}

const gradientTex = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return (t = new THREE.CanvasTexture(c));
  };
})();

// shift a sampled line sideways (positive = left of travel direction)
const offsetLine = (s, o) => s.map((p, i) => {
  const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
  let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: p.x - tz * o, z: p.z + tx * o };
});
const dirAt = (s, i) => {
  const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
  let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1;
  return [tx / l, tz / l];
};

export function buildWorld(scene, { lite = false } = {}) {
  const grid = new Grid();
  const flat = new Flat();
  const parts = new Parts();
  const glow = new Parts(); // things that light up after dark
  const signs = new Signs();
  const R = rng(20261);
  const props = new Props();
  const uNight = { value: 0 };
  const lights = []; // [x, z] under each lamp head
  const streetTrees = [];
  const S = new Boxes(), Dt = new Boxes(), G = new Boxes(); // structure, details, window glass
  const ctx = { S, D: Dt, G, parts, signs, R, glow, props };
  const wires = [];
  const B = BOUNDS;
  // Textured PBR city with the realistic palette. (dev only: /?classic shows the old
  // flat-colour look, for before/after comparisons)
  const CLASSIC = import.meta.env.DEV && location.search.includes('classic');
  const FOCUS = () => !CLASSIC;
  const S2 = new Boxes(), Dt2 = new Boxes(), G2 = new Boxes(), parts2 = new Parts(), flat2 = new TexFlat();
  const paint2 = new TexFlat(); // road paint and manholes: drawn with a depth offset, never flicker against the asphalt
  const ctx2 = { ...ctx, S: S2, D: Dt2, G: G2, parts: parts2, real: true };
  const pp = (x, z) => (FOCUS(x, z) ? parts2 : parts);

  // ---- ground: paved neighbourhood inside a green belt ---------------------
  flat.quad(-B - 25, -B - 25, B + 25, B + 25, 0.02, '#cdbfa3');
  grid.surface(0, 0, 0, 0);

  // ---- water & park --------------------------------------------------------
  const inLake = (l, x, z, pad = 0) => {
    const dx = x - l.x, dz = z - l.z, c = Math.cos(-l.rot), s = Math.sin(-l.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return (lx / (l.rx + pad)) ** 2 + (lz / (l.rz + pad)) ** 2 <= 1;
  };
  for (const l of LAKES) {
    for (const [pad, y, col] of [[3.2, 0.1, '#bfb08a'], [1.6, 0.11, '#7b8f6a'], [0, 0.13, '#2f6f80'], [-l.rx * 0.4, 0.15, '#3f8394']]) {
      flat.layer = pad > 0 ? L.plain : L.water;
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2, lx = Math.cos(a) * (l.rx + pad) * (1 + 0.06 * Math.sin(a * 3 + l.rx)), lz = Math.sin(a) * (l.rz + pad);
        pts.push([l.x + lx * Math.cos(l.rot) - lz * Math.sin(l.rot), l.z + lx * Math.sin(l.rot) + lz * Math.cos(l.rot)]);
      }
      flat.fan(pts, l.x, l.z, y, col);
    }
    flat.layer = L.concrete;
    const m = Math.max(l.rx, l.rz) + 3;
    for (let x = l.x - m; x <= l.x + m; x += grid.c) for (let z = l.z - m; z <= l.z + m; z += grid.c) if (inLake(l, x, z, 0.5)) grid.rect(x, z, x, z, WATER);
    // promenade railing along the shore
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, lx = Math.cos(a) * (l.rx + 2.6), lz = Math.sin(a) * (l.rz + 2.6);
      const x = l.x + lx * Math.cos(l.rot) - lz * Math.sin(l.rot), z = l.z + lx * Math.sin(l.rot) + lz * Math.cos(l.rot);
      if (!inBounds(x, z, 2)) continue;
      parts.box(0.12, 0.9, 0.12, '#e9e4d8', x, 0, z);
      props.add(x, z, 0.2);
    }
  }
  for (const pk of PARKS) {
    flat.layer = L.plain;
    flat.disc(pk.x, pk.z, pk.r + 2, 0.05, '#93a56c', 48);
    flat.disc(pk.x, pk.z, pk.r, 0.07, '#728f52', 48);
    flat.layer = L.paving; flat.tile = 1.6;
    flat.ring(pk.x, pk.z, pk.r * 0.6, pk.r * 0.6 + 1.6, 0.09, 40, '#f2ede4', '#f2ede4');
    flat.layer = L.plain; flat.tile = 2.2;
    grid.circle(pk.x, pk.z, pk.r, PLAZA); grid.surface(pk.x, pk.z, pk.r + 2, 0.08);
    for (let k = 0; k < 18; k++) { const a = R() * 6.28, r = pk.r * (0.2 + R() * 0.3); flat.disc(pk.x + Math.cos(a) * r, pk.z + Math.sin(a) * r, 1.2 + R(), 0.1, ['#c8442f', '#e0b23a', '#c45a7a', '#f2ead8'][k % 4], 10); } // flower beds
    flat.layer = L.concrete;
  }

  // ---- street furniture --------------------------------------------------
  const lamp = (x, z, tx, tz) => {
    const ry = Math.atan2(tx, tz);
    pp(x, z).cyl(0.07, 0.13, 6.4, '#3a3f4a', x, 0, z, 6);
    pp(x, z).box(0.09, 0.09, 1.9, '#3a3f4a', x + tx * 0.8, 6.22, z + tz * 0.8, ry);
    pp(x, z).box(0.62, 0.12, 0.98, '#3a3f4a', x + tx * 1.65, 6.22, z + tz * 1.65, ry);
    glow.box(0.5, 0.12, 0.85, '#fff4d6', x + tx * 1.65, 6.1, z + tz * 1.65, ry);
    lights.push([x + tx * 1.65, z + tz * 1.65]);
    props.add(x, z, 0.22);
    return [x, z];
  };
  const SCOOTER = ['#a8382c', '#2f5f8a', '#ece8de', '#222428', '#3f6f4f', '#7a7f86', '#5a5f66'];
  const scooter = (x, z, ry) => { // a parked two-wheeler
    const c = SCOOTER[(R() * SCOOTER.length) | 0], sn = Math.sin(ry), cs = Math.cos(ry);
    for (const o of [-0.62, 0.62]) pp(x, z).geo(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), '#18181c', x + sn * o, 0.27, z + cs * o, 0, ry, Math.PI / 2);
    pp(x, z).box(0.42, 0.42, 1.25, c, x, 0.32, z, ry);
    pp(x, z).box(0.36, 0.14, 0.62, '#202024', x - sn * 0.2, 0.74, z - cs * 0.2, ry);
    pp(x, z).box(0.36, 0.5, 0.12, c, x + sn * 0.55, 0.55, z + cs * 0.55, ry);
    pp(x, z).box(0.62, 0.05, 0.05, '#2b2b30', x + sn * 0.6, 1.05, z + cs * 0.6, ry);
    props.add(x, z, 0.6);
  };
  const bin = (x, z) => { pp(x, z).cyl(0.26, 0.22, 0.85, '#2f7d4f', x, 0.2, z, 8); pp(x, z).cyl(0.28, 0.28, 0.06, '#245f3c', x, 1.05, z, 8); props.add(x, z, 0.32); };
  const cart = (x, z, a) => { // fruit / chai cart with a striped umbrella
    const goods = ['#e2574c', '#f2c230', '#6fa83a', '#e8891a'];
    pp(x, z).box(1.9, 0.12, 1.1, '#7a5a3c', x, 0.85, z, a);
    for (let k = 0; k < 4; k++) pp(x, z).box(0.42, 0.2, 0.9, goods[k], x + Math.cos(a) * (k - 1.5) * 0.45, 0.97, z - Math.sin(a) * (k - 1.5) * 0.45, a);
    for (const s of [-0.75, 0.75]) pp(x, z).geo(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 10), '#26252b', x + Math.cos(a) * s, 0.33, z - Math.sin(a) * s, Math.PI / 2, a, 0);
    pp(x, z).cyl(0.04, 0.04, 2.2, '#55606a', x, 0.97, z, 5);
    pp(x, z).geo(new THREE.ConeGeometry(1.6, 0.6, 8), AWN[(R() * AWN.length) | 0], x, 3.4, z);
    glow.ball(0.14, '#ffe3a0', x, 2.95, z);
    props.add(x, z, 1.15);
  };
  const shop = (x, z, th, mask, kind = 'mixed', residence = false, type) => {
    const yard = residence ? 2.2 : 0;
    const fx = Math.sin(th), fz = Math.cos(th), ax = Math.cos(th), az = -Math.sin(th);
    for (const u of [-3.3, 0, 3.3]) for (const v of [-2.6, 0, 2.4 + yard]) if (grid.get(x + ax * u + fx * v, z + az * u + fz * v) & mask) return false;
    const { H } = streetBuilding(FOCUS(x, z) ? ctx2 : ctx, x, z, th, { kind, shop: !residence, yard, type });
    grid.circle(x, z, 3.7, SOLID); grid.setH(x - 3.6, z - 3.6, x + 3.6, z + 3.6, H + 1);
    for (let u = -3.2; u <= 3.2; u += 0.8) for (let v = -2.6; v <= 2.6; v += 0.8) { const px = x + ax * u + fx * v, pz = z + az * u + fz * v; grid.rect(px, pz, px, pz, SOLID); }
    if (yard) for (let u = -3.2; u <= 3.2; u += 0.5) if (u < 0.6 || u > 2.3) { const px = x + ax * u + fx * (2.6 + yard), pz = z + az * u + fz * (2.6 + yard); grid.rect(px, pz, px, pz, SOLID); }
    return true;
  };

  // ---- streets: asphalt, footpaths, lane paint ----------------------------
  const roads = ROADS.map((r) => ({ ...r, pts: resolvePts(r.pts) }));
  for (const r of roads) { r.s = sample(r.pts); for (const p of r.s) grid.circle(p.x, p.z, r.w / 2 - 0.4, CARRIAGE); }
  for (const r of roads) {
    const { s, w } = r, fp = r.main ? 4 : 3.2;
    for (const run of runsBy(s, FOCUS)) {
      const t = thin(run.s);
      if (run.f) {
        // side by side, not stacked: stacked layers a few cm apart flicker at a distance
        for (const side of [-1, 1]) {
          flat2.ribbon(thin(offsetLine(run.s, side * (w / 2 + 0.15 + fp / 2))), fp - 0.3, 0.2, '#efe9df', L.paving, 1.6); // interlocking pavers
          flat2.ribbon(thin(offsetLine(run.s, side * (w / 2 + 0.15))), 0.3, 0.22, '#a9a59d', L.concrete, 2.0); // gutter
        }
        flat2.ribbon(t, w, 0.24, '#7d7f86', L.asphalt, 4.5);
        for (const side of [-1, 1]) paint2.ribbon(thin(offsetLine(run.s, side * (w / 2 - 0.35))), 0.12, 0.25, '#e6e1d4', L.paint, 4.5);
        // manhole covers, staggered between the lanes
        for (let i = 6; i < run.s.length - 2; i += 23) { const [tx, tz] = dirAt(run.s, i), o = ((i / 23) | 0) % 2 ? w / 4 : -w / 4; paint2.decal(run.s[i].x - tz * o, run.s[i].z + tx * o, 0.8, 0.25, L.manhole, Math.atan2(tx, tz)); }
      } else {
        flat.ribbon(t, w + fp * 2, 0.2, '#c3baa8');
        flat.ribbon(t, w + 0.6, 0.22, '#8e8a83');
        flat.ribbon(t, w, 0.24, r.main ? '#33313c' : '#3b3946');
        for (const side of [-1, 1]) flat.ribbon(thin(offsetLine(run.s, side * (w / 2 - 0.35))), 0.12, 0.26, '#e9e5da');
      }
    }
    if (r.main) {
      flat.ribbon(thin(s), 1.6, 0.27, '#7c8a5e'); // planted median under the metro
      for (const side of [-1, 1]) for (let i = 2; i < s.length - 4; i += 6) { const a = offsetLine([s[i], s[i + 3]], side * 2.9); flat.ribbon(a, 0.16, 0.27, '#f3efe5'); }
    } else for (let i = 2; i < s.length - 4; i += 6) {
      if (FOCUS(s[i].x, s[i].z)) paint2.ribbon([s[i], s[i + 3]], 0.16, 0.25, '#e6e1d4', L.paint, 4.5);
      else flat.ribbon([s[i], s[i + 3]], 0.16, 0.27, '#f3efe5');
    }
    for (const p of s) { grid.circle(p.x, p.z, w / 2 + fp, ROAD); grid.surface(p.x, p.z, w / 2 + fp + 0.1, 0.2); grid.surface(p.x, p.z, w / 2, 0.24); }
    r.fp = fp;
  }
  // zebra crossings on every arm of every junction
  const segHit = (a, b, c, d) => {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(den) < 1e-6) return null;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : null;
  };
  const junctions = [];
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const A = roads[i].pts, Bp = roads[j].pts;
    for (let a = 1; a < A.length; a++) for (let b = 1; b < Bp.length; b++) { const h = segHit(A[a - 1], A[a], Bp[b - 1], Bp[b]); if (h) junctions.push({ x: h[0], z: h[1], roads: [roads[i], roads[j]] }); }
  }
  for (const jn of junctions) for (const r of jn.roads) {
    const other = jn.roads[0] === r ? jn.roads[1] : jn.roads[0], s = r.s;
    for (let i = 1; i < s.length; i++) {
      const d0 = Math.hypot(s[i - 1].x - jn.x, s[i - 1].z - jn.z), d1 = Math.hypot(s[i].x - jn.x, s[i].z - jn.z), R0 = other.w / 2 + other.fp + 1.6;
      if ((d0 - R0) * (d1 - R0) > 0) continue;
      const [tx, tz] = dirAt(s, i);
      for (let o = -r.w / 2 + 0.55; o < r.w / 2 - 0.3; o += 0.9) {
        const cx = s[i].x - tz * o, cz = s[i].z + tx * o;
        const zebra = [{ x: cx - tx * 1.3, z: cz - tz * 1.3 }, { x: cx + tx * 1.3, z: cz + tz * 1.3 }];
        if (FOCUS(cx, cz)) paint2.ribbon(zebra, 0.46, 0.25, '#f0ece2', L.paint, 4.5); else flat.ribbon(zebra, 0.46, 0.28, '#f3efe5');
      }
    }
    // traffic signal on the corner
    if (r === jn.roads[0] && inBounds(jn.x, jn.z) && Math.hypot(jn.x - 60, jn.z) > 2) {
      const cx = jn.x + other.w / 2 + 1.2, cz = jn.z + r.w / 2 + 1.2;
      if (!(grid.get(cx, cz) & CARRIAGE)) {
        parts.cyl(0.08, 0.1, 3.4, '#2b2d34', cx, 0, cz, 6); parts.box(0.36, 1.0, 0.3, '#1d1f24', cx, 3.4, cz);
        glow.ball(0.1, '#ff4d4d', cx, 4.2, cz + 0.16); glow.ball(0.1, '#ffd34d', cx, 3.9, cz + 0.16); glow.ball(0.1, '#4dff8a', cx, 3.6, cz + 0.16);
        props.add(cx, cz, 0.2);
      }
    }
  }

  // ---- blocks: small squares where people gather ---------------------------
  const plazas = {};
  const PR = 11;
  for (const d of DISTRICTS) {
    plazas[d.id] = { x: d.x, z: d.z, inner: 2.6, outer: PR - 1.8 };
    flat.layer = L.paving; flat.tile = 1.6;
    flat.disc(d.x, d.z, PR, 0.28, '#f3eee6', 40);
    flat.layer = L.concrete; flat.tile = 2.2;
    flat.ring(d.x, d.z, PR - 0.9, PR, 0.3, 40, '#c4673f', '#efe7da');
    flat.ring(d.x, d.z, 4.4, 4.9, 0.3, 32, '#c9bc9b', '#c9bc9b');
    const star = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + Math.PI / 8, r = i % 2 ? 1.5 : 3.6; star.push([d.x + Math.cos(a) * r, d.z + Math.sin(a) * r]); }
    flat.fan(star, d.x, d.z, 0.31, d.kind === 'tech' ? '#5b958c' : d.kind === 'residential' ? '#7f9a5c' : '#c99a6a');
    grid.circle(d.x, d.z, PR + 0.6, PLAZA); grid.surface(d.x, d.z, PR + 0.4, 0.31);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.8, x = d.x + Math.cos(a) * (PR - 1.6), z = d.z + Math.sin(a) * (PR - 1.6); if (!(grid.get(x, z) & CARRIAGE)) lamp(x, z, -Math.cos(a), -Math.sin(a)); }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + 0.3, x = d.x + Math.cos(a) * (PR - 3.4), z = d.z + Math.sin(a) * (PR - 3.4);
      if (grid.get(x, z) & CARRIAGE) continue;
      if (i % 2) { parts.cyl(0.5, 0.36, 0.55, '#b5523a', x, 0.3, z, 8); parts.geo(new THREE.IcosahedronGeometry(0.62, 1), '#5b8a4e', x, 1.25, z); props.add(x, z, 0.55); }
      else { parts.box(1.9, 0.12, 0.55, '#8a5a3c', x, 0.72, z, -a); parts.box(1.7, 0.42, 0.1, '#6b4630', x, 0.3, z, -a); parts.box(1.9, 0.5, 0.08, '#8a5a3c', x - Math.cos(a) * 0.3, 0.8, z - Math.sin(a) * 0.3, -a); for (const o of [-0.6, 0, 0.6]) props.add(x + Math.sin(a) * o, z - Math.cos(a) * o, 0.4); }
    }
    { // a cart on the edge of every square
      let a = R() * 6.28, x, z;
      for (let k = 0; k < 12; k++, a += 0.6) { x = d.x + Math.cos(a) * 7; z = d.z + Math.sin(a) * 7; if (!(grid.get(x, z) & (CARRIAGE | SOLID))) break; }
      cart(x, z, a); grid.circle(x, z, 1.1, SOLID);
    }
  }

  // ---- kerbs, roadside buildings, trees, lamps, parked scooters ---------------
  const curbs = [];
  for (const r of roads) {
    const { s, w } = r;
    for (let i = 0; i < s.length; i += 1.6) {
      const k = Math.floor(i), [tx, tz] = dirAt(s, k);
      for (const side of [-1, 1]) {
        const x = s[k].x - tz * (w / 2 + 0.2) * side, z = s[k].z + tx * (w / 2 + 0.2) * side;
        if (grid.get(x, z) & (CARRIAGE | PLAZA | WATER) || !inBounds(x, z, -20)) continue;
        curbs.push([x, z, Math.atan2(tx, tz), Math.floor(i / 1.6) % 2]);
      }
    }
    const lastPole = { [-1]: null, [1]: null };
    for (let k = 3, n = 0; k < s.length - 3; k += 7.4, n++) {
      const kk = Math.floor(k), [tx, tz] = dirAt(s, kk), p = s[kk];
      if (!inBounds(p.x, p.z, -6)) continue;
      const nd = nearestDistrict(p.x, p.z), kind = r.main || (Math.abs(p.x - 60) < 14 && Math.abs(p.z) < 70) ? 'tech' : nd.district.kind;
      for (const side of [-1, 1]) {
        const nx = -tz * side, nz = tx * side;
        const home = kind === 'residential' ? R() < 0.7 : kind === 'mixed' ? R() < 0.25 : false, off = w / 2 + r.fp + 2.8 + (home ? 2.2 : 0);
        shop(p.x + nx * off, p.z + nz * off, Math.atan2(-nx, -nz), ROAD | WATER | SOLID | PLAZA, kind, home);
        if (n % 2 === (side > 0 ? 0 : 1)) streetTrees.push([p.x + nx * (w / 2 + r.fp - 1.0), p.z + nz * (w / 2 + r.fp - 1.0)]);
        else if (R() < 0.55) { const ox = p.x + nx * (w / 2 + 0.85), oz = p.z + nz * (w / 2 + 0.85); if (!(grid.get(ox, oz) & (CARRIAGE | PLAZA | WATER))) scooter(ox, oz, Math.atan2(tx, tz) + (R() - 0.5) * 0.4); }
        if (R() < 0.08) { const bx = p.x + nx * (w / 2 + r.fp - 0.5), bz = p.z + nz * (w / 2 + r.fp - 0.5); if (!(grid.get(bx, bz) & (CARRIAGE | PLAZA))) bin(bx, bz); }
        if (n % 3 === (side > 0 ? 0 : 1)) {
          const x = p.x + nx * (w / 2 + 0.9), z = p.z + nz * (w / 2 + 0.9);
          if (grid.get(x, z) & (CARRIAGE | WATER | PLAZA)) { lastPole[side] = null; continue; }
          const pole = lamp(x, z, -nx, -nz);
          if (lastPole[side] && !r.main) wires.push([lastPole[side], pole]);
          lastPole[side] = pole;
        }
      }
    }
  }
  {
    const geo = new THREE.BoxGeometry(0.34, 0.26, 1.5).translate(0, 0.25, 0); // long side runs along the road
    const bin2 = new InstanceBin(), bin3 = new InstanceBin();
    const d = new THREE.Object3D(), y = new THREE.Color('#f2c230'), b = new THREE.Color('#25242b'), y2 = new THREE.Color('#d2ad4c'), b2 = new THREE.Color('#3a3936');
    curbs.forEach(([x, z, ry, c]) => {
      d.position.set(x, 0, z); d.rotation.y = ry; d.updateMatrix();
      if (FOCUS(x, z)) bin3.add(d.matrix, c ? y2 : b2, L.concrete); else bin2.add(d.matrix, c ? y : b);
    });
    scene.add(bin2.build(geo, new THREE.MeshLambertMaterial(), { castShadow: false }));
    scene.add(bin3.build(geo, boxSurface(), { castShadow: false }));
  }
  for (const r of roads) {
    if (r.name !== '100 Feet Road') continue;
    const { s, w } = r;
    for (let k = 5, n = 0; k < s.length - 5; k += 9, n++) {
      const p = s[k], [tx, tz] = dirAt(s, k), side = n % 2 ? 1 : -1, nx = -tz * side, nz = tx * side, ry = Math.atan2(tx, tz);
      const x = p.x + nx * (w / 2 + r.fp - 0.55), z = p.z + nz * (w / 2 + r.fp - 0.55);
      if (!FOCUS(x, z) || grid.get(x, z) & (CARRIAGE | PLAZA | SOLID | DECOR)) continue;
      let clash = false; props.near(x, z, (o) => { if ((o.x - x) ** 2 + (o.z - z) ** 2 < 2.2) clash = true; });
      if (clash) continue;
      const kind = n % 3;
      if (kind === 0) { // electrical feeder pillar on a little plinth
        S2.add(1.0, 0.18, 0.55, '#a8a49c', x, 0.2, z, ry, 0, L.concrete);
        Dt2.add(0.9, 1.25, 0.45, '#6f7d70', x, 0.38, z, ry, 0, L.steel);
        Dt2.add(0.96, 0.06, 0.52, '#5d695f', x, 1.63, z, ry, 0, L.steel);
      } else if (kind === 1) { // concrete planter with a shrub
        S2.add(1.15, 0.55, 1.15, '#c9c4ba', x, 0.2, z, ry, 0, L.concrete);
        parts2.geo(new THREE.IcosahedronGeometry(0.55, 1), '#5c7a43', x, 1.05, z, 0, ry, 0, 1, 0.75, 1);
      } else { // a municipal bin
        parts2.cyl(0.27, 0.23, 0.85, '#3d6b4e', x, 0.2, z, 10); parts2.cyl(0.29, 0.29, 0.06, '#2f5440', x, 1.05, z, 10);
      }
      props.add(x, z, 0.55); grid.rect(x, z, x, z, DECOR);
    }
  }
  {
    const pts = [];
    for (const [[x0, z0], [x1, z1]] of wires) for (const [h, sag] of [[6.35, 0.7], [5.95, 0.9]]) {
      for (let i = 0; i < 8; i++) {
        const t0 = i / 8, t1 = (i + 1) / 8, y = (t) => h - sag * 4 * t * (1 - t);
        pts.push(x0 + (x1 - x0) * t0, y(t0), z0 + (z1 - z0) * t0, x0 + (x1 - x0) * t1, y(t1), z0 + (z1 - z0) * t1);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ln = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#15161c' }));
    scene.add(ln);
  }

  // ---- metro viaduct over the main road, with a station --------------------
  const metroSamples = [];
  for (const line of METRO) {
    const s = sample(line.pts), t = thin(s);
    metroSamples.push({ s, color: line.color });
    flat.ribbon(t, 3.2, 6.5, '#d9d5ca');
    flat.ribbon(t, 0.6, 6.54, line.color);
    for (let i = 6; i < s.length; i += 16) {
      parts.box(1.0, 6.1, 1.0, '#c9c4b8', s[i].x, 0, s[i].z); parts.box(3.4, 0.5, 1.6, '#c9c4b8', s[i].x, 6.0, s[i].z);
      grid.circle(s[i].x, s[i].z, 0.8, SOLID); props.add(s[i].x, s[i].z, 0.7);
    }
    for (const [x, z] of line.stations) {
      parts.box(26, 1.6, 9, '#ece7da', x, 6.5, z); parts.box(27, 0.4, 10, '#2f6fb5', x, 10.2, z);
      parts.geo(new THREE.CylinderGeometry(5.2, 5.2, 27, 16, 1, false, 0, Math.PI), '#9fc3dc', x, 10.4, z, 0, 0, Math.PI / 2, 1, 1, 0.9);
      for (const sx of [-12, -4, 4, 12]) for (const sz of [-4.2, 4.2]) parts.box(0.3, 2.1, 0.3, '#8d8a84', x + sx, 8.1, z + sz);
      for (const sz of [-1, 1]) { // stairs down to the footpaths
        const zz = z + sz * 9.8;
        for (let k = 0; k < 12; k++) parts.box(3, 0.3, 0.55, '#d6d0c2', x + 9, 6.2 - k * 0.52, zz + sz * k * 0.0, 0);
        parts.box(3.4, 6.5, 0.3, '#bfbab0', x + 9, 0, zz + sz * 1.6);
        grid.rect(x + 7, zz - 1, x + 11, zz + 1, SOLID);
      }
      signs.add(x, 9.2, z + 4.56, 0, 14, 1.2, signs.metro);
      signs.add(x, 9.2, z - 4.56, Math.PI, 14, 1.2, signs.metro);
    }
  }

  landmarks(parts, flat, grid, R);

  // ---- blocks filled with buildings ------------------------------------------
  const bGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const buildingBin = new InstanceBin();
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  let nb = 0;
  const inst = (bin, x, y, z, w, h, d, color, layer = L.plaster) => { dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); bin.add(dummy.matrix, col.set(color).offsetHSL(0, 0, (R() - 0.5) * 0.05), CLASSIC ? undefined : layer); nb++; };
  const place = (x, z, w, d, h, color, kind) => {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (grid.any(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, ROAD | WATER | SOLID | PLAZA)) return false;
    grid.rect(x0, z0, x1, z1, SOLID); grid.setH(x0, z0, x1, z1, h);
    inst(buildingBin, x, 0, z, w, h, d, color, kind === 'tech' ? L.concrete : L.plaster);
    if (kind === 'tech' && h > 15) { inst(buildingBin, x, h, z, w * 0.62, 1.6 + R() * 2, d * 0.62, '#6c747a', L.steel); if (h > 30) inst(buildingBin, x, 0, z, w + 1.6, 3.2, d + 1.6, '#d3d5d3', L.steel); }
    else if (h < 14 && R() < 0.6) inst(buildingBin, x + w * 0.22, h, z - d * 0.2, 0.9, 0.8, 0.9, '#202024', L.steel); // rooftop water tank
    return true;
  };
  for (let x = -B; x <= B; x += 9) for (let z = -B; z <= B; z += 9) {
    const nd = nearestDistrict(x, z).district, nearMain = Math.abs(z) < 50 || (Math.abs(x - 60) < 30 && Math.abs(z) < 120);
    const kind = nearMain ? 'tech' : nd.kind, pal = PALETTE[kind];
    const w = 5.6 + R() * 2.2, d = 5.6 + R() * 2.2;
    const h = kind === 'tech' ? 12 + R() ** 1.6 * 34 : kind === 'mixed' ? 6 + R() * 12 : 5 + R() * 9;
    place(x + (R() - 0.5) * 1.5, z + (R() - 0.5) * 1.5, w, d, h, pal[(R() * pal.length) | 0], kind);
  }
  scene.add(buildingBin.build(bGeo, CLASSIC ? buildingMaterial(uNight) : blockSurface()));
  // a distant skyline so the edge of the neighbourhood never looks empty
  const skyBin = new InstanceBin();
  for (let x = -380; x <= 380; x += 13) for (let z = -380; z <= 380; z += 13) {
    if (inBounds(x, z, -18) || Math.hypot(x, z) > 400 || R() > 0.6) continue;
    const far = Math.max(Math.abs(x), Math.abs(z)) / 380;
    const k = (R() * 5) | 0;
    inst(skyBin, x + (R() - 0.5) * 4, 0, z + (R() - 0.5) * 4, 7 + R() * 5, 8 + R() * (14 + 34 * far), 7 + R() * 5, ['#b9c2c8', '#c9cccc', '#d9cdb6', '#cfc8b4', '#e2d3b8'][k], k < 2 ? L.concrete : L.plaster);
  }
  scene.add(skyBin.build(bGeo, CLASSIC ? buildingMaterial(uNight) : blockSurface(), { castShadow: false }));

  // ---- trees & granite boulders ------------------------------------------
  const tp = new Parts();
  tp.cyl(0.14, 0.22, 1.5, '#6e5038', 0, 0, 0, 5);
  tp.geo(new THREE.IcosahedronGeometry(1, 0), '#ffffff', 0, 2.3, 0, 0, 0, 0, 1.25, 0.85, 1.25);
  tp.geo(new THREE.IcosahedronGeometry(0.75, 0), '#f2f2f2', 0.75, 1.95, 0.35);
  tp.geo(new THREE.IcosahedronGeometry(0.7, 0), '#e8e8e8', -0.6, 2.0, -0.4);
  const treeBin = new InstanceBin();
  const greens = ['#5f9150', '#4f8046', '#78a556', '#437349', '#8bb062', '#d9683f', '#e8b23a'];
  let nt = 0;
  const tree = (x, z, s, mask) => {
    if (grid.get(x, z) & mask) return;
    dummy.position.set(x, 0, z); dummy.scale.set(s, s * (0.9 + R() * 0.4), s); dummy.rotation.set(0, R() * 6, 0); dummy.updateMatrix();
    treeBin.add(dummy.matrix, col.set(greens[R() < 0.08 ? 5 + ((R() * 2) | 0) : (R() * 5) | 0]));
    grid.rect(x, z, x, z, DECOR); props.add(x, z, 0.18 * s + 0.12); nt++;
  };
  const OPEN = ROAD | WATER | SOLID | DECOR;
  const treeBin2 = new InstanceBin(), leafTint = ['#ffffff', '#e2f0d0', '#f5f2d6', '#d4e6c6', '#eef6dc', '#fff0d8'];
  const tree2 = (x, z, s, mask) => { // leaf-card tree, a little smaller than the blob trees it replaces
    if (grid.get(x, z) & mask) return;
    dummy.position.set(x, 0.2, z); dummy.scale.set(s, s * (0.9 + R() * 0.25), s); dummy.rotation.set(0, R() * 6.28, 0); dummy.updateMatrix();
    treeBin2.add(dummy.matrix, col.set(leafTint[(R() * leafTint.length) | 0]));
    grid.rect(x, z, x, z, DECOR); props.add(x, z, 0.25 * s); nt++;
  };
  // leaf-card trees (the old blob trees only in /?classic); s is the old blob-tree scale
  const plant = (x, z, s, mask) => (CLASSIC ? tree(x, z, s, mask) : tree2(x, z, 0.62 + s * 0.33, mask));
  for (const [x, z] of streetTrees) plant(x, z, 1.1 + R() * 0.9, WATER | SOLID | CARRIAGE | PLAZA | DECOR);
  for (const pk of PARKS) for (let k = 0; k < (lite ? 70 : 160); k++) { const a = R() * 6.28, r = Math.sqrt(R()) * pk.r; if (Math.abs(r - pk.r * 0.6 - 0.8) > 1.8) plant(pk.x + Math.cos(a) * r, pk.z + Math.sin(a) * r, 1.2 + R() * 0.9, OPEN); }
  // fewer trees on phones and low-spec laptops
  for (let k = 0; k < (lite ? 520 : 1300); k++) { const x = (R() - 0.5) * 2 * (B + 60), z = (R() - 0.5) * 2 * (B + 60); if (!(grid.get(x, z) & PLAZA)) plant(x, z, 0.9 + R() * 0.9, OPEN); }
  scene.add(treeBin.build(mergeGeometries(tp.list), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  scene.add(treeBin2.build(treeGeometry(), treeSurface()));

  const rockBin = new InstanceBin();
  const rocksAt = LANDMARKS.find((l) => l.type === 'rocks');
  for (let k = 0; k < 140; k++) {
    const a = R() * 6.28, r = 14 + R() * 26, x = rocksAt.x + Math.cos(a) * r, z = rocksAt.z + Math.sin(a) * r;
    if (grid.get(x, z) & (ROAD | WATER | SOLID | PLAZA | DECOR)) continue;
    const s = 0.6 + R() ** 2 * 2.6;
    dummy.position.set(x, s * 0.3, z); dummy.scale.set(s * (0.8 + R() * 0.6), s * (0.6 + R() * 0.5), s); dummy.rotation.set(R() * 3, R() * 3, R() * 3); dummy.updateMatrix();
    rockBin.add(dummy.matrix, col.set(R() < 0.5 ? '#b3a48c' : '#9c917f').offsetHSL(0, 0, (R() - 0.5) * 0.08));
    if (s > 1.2) grid.circle(x, z, s * 0.7, SOLID); else props.add(x, z, s * 0.8);
  }
  scene.add(rockBin.build(new THREE.DodecahedronGeometry(1, 0), CLASSIC ? new THREE.MeshLambertMaterial({ flatShading: true }) : propSurface({ vertexColors: false })));

  // ---- warm pools of light under every lamp (only visible after dark) -----
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: gradientTex(), color: '#ffa94a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), lights.length);
  lights.forEach(([x, z], i) => { dummy.position.set(x, 0.34, z); dummy.scale.set(5.5, 1, 5.5); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pools.setMatrixAt(i, dummy.matrix); });
  pools.renderOrder = 2; pools.computeBoundingSphere(); scene.add(pools);

  // ---- ground ------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2).translate(0, -0.08, 0), new THREE.MeshLambertMaterial({ color: '#9aa874' }));
  ground.receiveShadow = true;
  const glowMesh = glow.mesh();
  const glowMat = glowMesh.children[0].material; // all tiles share one material
  glowMat.emissive = new THREE.Color('#ffd08a');
  const signMesh = signs.mesh();
  const glassMat = glassMaterial(uNight);
  const facadeCount = S.count + Dt.count + G.count;
  scene.add(ground, flat.mesh(CLASSIC ? undefined : flatSurface()), parts.mesh(CLASSIC ? undefined : propSurface()), glowMesh, signMesh,
    S.mesh(new THREE.MeshLambertMaterial(), true), Dt.mesh(new THREE.MeshLambertMaterial(), false), G.mesh(glassMat, false));
  // the textured street
  const paintMat = flatSurface(); paintMat.polygonOffset = true; paintMat.polygonOffsetFactor = -2; paintMat.polygonOffsetUnits = -4;
  scene.add(flat2.mesh(flatSurface()), paint2.mesh(paintMat), parts2.mesh(propSurface()), S2.mesh(boxSurface(), true), Dt2.mesh(boxSurface(), false), G2.mesh(glassSurface(uNight), false));

  return {
    grid, metroSamples, plazas, props, groundAt: (x, z) => grid.groundAt(x, z),
    roads: roads.map((r) => ({ s: r.s, w: r.w, major: !!r.main, fp: r.fp, name: r.name })),
    stats: { buildings: nb, trees: nt, lamps: lights.length, curbs: curbs.length, facadeBoxes: facadeCount, wires: wires.length },
    setNight(n) {
      uNight.value = n; surfaceUniforms.uNight.value = n;
      glowMat.emissiveIntensity = n * 4.2 + 0.5;
      signMesh.material.color.setScalar(1 + n * 0.3);
      pools.material.opacity = n * 0.38; pools.visible = n > 0.02;
    },
  };
}

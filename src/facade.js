// Street-front buildings: painted walls, framed windows with grilles, sunshades,
// balconies, AC units, rooftop tanks, shopfronts and compound walls.
// Every piece is a box, so thousands of them render as one instanced mesh.
import * as THREE from 'three';
import { InstanceBin } from './chunks.js';
import { L } from './surfaces.js';

// Colours of a Hyderabad street at dusk: ochre, terracotta, teal, sky blue, rose, mint, cream.
export const WALLS = ['#e0b64a', '#cf6a45', '#4fa59b', '#5f9ad3', '#d97f95', '#9cc47a', '#efe3c4', '#e89a4a', '#7fc3c9', '#c9a3d9', '#f2d675', '#b8574a'];
export const TRIMS = ['#f6efdf', '#f6efdf', '#7a3b2e', '#2f5f5a', '#a3412f', '#e9e2d0'];
const OFFICE = ['#d9dee3', '#c3ccd4', '#e6e1d6', '#9fb3c2', '#bfd0cc'];
const AWN = ['#e2574c', '#2f6fb5', '#1fa971', '#e8891a', '#8a5bd1', '#d9488f', '#2aa6b8'];
const LIT = ['#ffd590', '#ffc978', '#ffe2a8', '#ffb46b', '#fff0c8'];
// The realistic street palette (textured streets): lime-washed off-whites, creams,
// beiges and light ochre, a few muted pastels, grey concrete and glass for offices.
const REAL = {
  // warm pastels a neighbourhood actually paints its houses: brick red, mint, sky
  // blue, cream, ochre, rose, pistachio, with off-white for the plainer ones
  walls: ['#c9675a', '#8fbfa9', '#93b6d2', '#ead9b4', '#ddb06e', '#e3a8a0', '#b9c98f', '#f0e7d6', '#d98b62', '#a9c7c9', '#efe2c8', '#c98e8a'],
  trims: ['#f4f1ea', '#f4f1ea', '#f4f1ea', '#efe9dc'],
  office: ['#c9cdd0', '#b7bcc0', '#d6d4ce', '#a9b4ba', '#bfc3c0'],
  awn: ['#a34a35', '#3c6378', '#5a7148', '#b07a33', '#7b5d48', '#8e3b3b', '#4f5d6b'],
  goods: ['#c8442f', '#e0b23a', '#6e9a3a', '#d9822b', '#9c2f22', '#93b552'],
  poster: ['#2f5f8a', '#b8432f', '#d4a93a', '#3f7d55'],
};
const DARK = '#1b2333';

export class Boxes {
  constructor() { this.bin = new InstanceBin(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color(); }
  // y is the bottom of the box; ry turns it to face the street; rx tilts it (awnings)
  add(w, h, d, color, x, y, z, ry = 0, rx = 0, layer) {
    this.q.setFromEuler(this.e.set(rx, ry, 0, 'YXZ'));
    this.m.compose(this.p.set(x, y + h / 2, z), this.q, this.s.set(w, h, d));
    this.bin.add(this.m, this.c.set(color), layer);
  }
  get count() { return this.bin.count; }
  mesh(material, shadows = true) {
    return this.bin.build(new THREE.BoxGeometry(1, 1, 1), material, { castShadow: shadows });
  }
}

// Window glass: blue-grey by day; after dark, warm instances glow and dark ones stay dark.
export function glassMaterial(uNight) {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = uNight;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lit_ = step(0.55, vColor.r);
        vec3 day_ = mix(vec3(0.24, 0.34, 0.44), vec3(0.42, 0.56, 0.66), lit_);
        diffuseColor.rgb = mix(day_, vColor * (0.25 + 0.5 * lit_), uNight);
        totalEmissiveRadiance += vColor * lit_ * uNight * 1.15;`);
  };
  return m;
}

// One building facing the street. Local frame: u runs along the street, v points
// towards it, y is up. Returns the footprint radius it occupies, or 0 if it did not fit.
export function streetBuilding(ctx, x, z, th, opt) {
  const { S, D, G, parts, signs, R } = ctx;
  const fx = Math.sin(th), fz = Math.cos(th), ax = Math.cos(th), az = -Math.sin(th);
  const P = (u, v) => [x + ax * u + fx * v, z + az * u + fz * v];
  const real = !!ctx.real, lay = (l) => (real ? l : undefined);
  const s = (w, h, d, c, u, y, v, l = L.plaster) => { const [X, Z] = P(u, v); S.add(w, h, d, c, X, y, Z, th, 0, lay(l)); };
  const dt = (w, h, d, c, u, y, v, rx = 0, l = L.plaster) => { const [X, Z] = P(u, v); D.add(w, h, d, c, X, y, Z, th, rx, lay(l)); };
  const gl = (w, h, d, c, u, y, v) => { const [X, Z] = P(u, v); G.add(w, h, d, c, X, y, Z, th); };
  const pick = (a) => a[(R() * a.length) | 0];
  const lit = () => (R() < 0.5 ? pick(LIT) : DARK);
  const AWNS = real ? REAL.awn : AWN;

  const office = opt.kind === 'tech' && R() < 0.6;
  const W = opt.width || 6.6, Dp = 5.2, GH = 3.4, FH = 2.9;
  const floors = opt.floors ?? (office ? 4 + ((R() * 3) | 0) : opt.kind === 'residential' ? 2 + ((R() * 3) | 0) : 2 + ((R() * 4) | 0));
  const wall = office ? pick(real ? REAL.office : OFFICE) : pick(real ? REAL.walls : WALLS), trim = office ? '#f2f4f5' : pick(real ? REAL.trims : TRIMS);
  // some houses are left as exposed brick, as many are
  const brick = real && !office && opt.kind !== 'tech' && R() < 0.14;
  const wallL = office ? L.concrete : brick ? L.brick : L.plaster, wallC = brick ? '#f1ebe4' : wall;
  const H = GH + (floors - 1) * FH, fv = Dp / 2;

  // body, plinth and roof
  s(W, H, Dp, wallC, 0, 0, 0, wallL);
  s(W + 0.3, 0.32, Dp + 0.5, '#a39d93', 0, 0, 0.1, L.concrete);
  s(W + 0.24, 0.26, Dp + 0.24, trim, 0, H, 0);

  // ground floor: one of several shopfront types, or a house front
  const [sx, sz] = P(0, fv + 0.1);
  const sign = (y = 3.33) => signs.add(sx, y, sz, th, W - 0.3, 0.92, (R() * signs.n) | 0);
  const awning = (col = pick(AWNS)) => { for (let k = 0; k < 6; k++) dt(W / 6, 0.1, 1.5, k % 2 ? col : '#ece6da', (k - 2.5) * (W / 6), 2.75, fv + 0.72, 0.32, L.steel); };
  const prop = (u, v, r) => { const [X, Z] = P(u, v); ctx.props?.add(X, Z, r); };
  if (opt.shop) {
    const type = opt.type || pick(['shutter', 'shutter', 'cafe', 'stall', 'pharmacy', 'mobile', 'sweets']);
    dt(W - 0.6, 2.55, 0.1, real ? '#2e2c29' : '#262830', 0, 0.32, fv + 0.03, 0, L.concrete);
    if (type === 'cafe') {
      gl(W - 0.9, 2.1, 0.12, pick(LIT), 0, 0.4, fv + 0.05);
      for (const u of [-1.9, 1.9]) dt(0.08, 2.2, 0.16, '#3a2d26', u, 0.32, fv + 0.08, 0, L.steel);
      for (const u of [-1.6, 1.6]) { // outdoor table with two stools and an umbrella
        const [X, Z] = P(u, fv + 1.8);
        parts.cyl(0.38, 0.38, 0.05, '#f2efe6', X, 0.78, Z, 10); parts.cyl(0.04, 0.05, 0.75, '#3a3f4a', X, 0.03, Z, 5);
        for (const o of [-0.55, 0.55]) { const [Xs, Zs] = P(u + o, fv + 1.8); parts.cyl(0.16, 0.16, 0.45, '#8a5a3c', Xs, 0.03, Zs, 8); }
        parts.cyl(0.03, 0.03, 2.1, '#d9d4c8', X, 0.8, Z, 5); parts.geo(new THREE.ConeGeometry(1.1, 0.45, 8), pick(AWNS), X, 2.95, Z);
        prop(u, fv + 1.8, 0.75);
      }
      sign();
    } else if (type === 'stall') {
      // open front with tiers of produce
      const goods = real ? REAL.goods : ['#e2574c', '#f2c230', '#6fa83a', '#e8891a', '#b5352a', '#9bc45a'];
      for (let tier = 0; tier < 3; tier++) for (let k = 0; k < 5; k++) dt(1.0, 0.28, 0.5, pick(goods), -2.2 + k * 1.1, 0.35 + tier * 0.42, fv + 0.9 - tier * 0.35, -0.2);
      dt(W - 0.6, 0.12, 1.4, '#7a5a3c', 0, 0.25, fv + 0.75, 0, L.steel);
      awning(real ? '#5a7148' : '#1fa971'); sign(); prop(0, fv + 0.9, 1.0);
    } else if (type === 'pharmacy') {
      gl(W - 1.3, 1.75, 0.12, '#e8fff0', -0.25, 0.45, fv + 0.05);
      dt(1.0, 2.2, 0.14, '#3a5a4a', W / 2 - 0.85, 0.32, fv + 0.06, 0, L.steel);
      const [X, Z] = P(-W / 2 + 0.2, fv + 0.55); // glowing green cross lightbox sticking out
      ctx.glow.box(0.75, 0.24, 0.12, '#3be27a', X, 4.1, Z, th); ctx.glow.box(0.24, 0.75, 0.12, '#3be27a', X, 3.86, Z, th);
      awning('#ffffff'); sign();
    } else if (type === 'mobile') {
      gl(W - 0.9, 2.0, 0.12, '#dff3ff', 0, 0.42, fv + 0.05);
      for (let k = 0; k < 4; k++) dt(0.9, 1.2, 0.04, pick(real ? REAL.poster : ['#2f6fb5', '#e2574c', '#f2c230', '#1fa971']), -2.1 + k * 1.4, 0.9, fv + 0.12); // posters
      const [X, Z] = P(W / 2 + 0.05, fv + 0.7); ctx.glow.box(0.12, 1.5, 0.9, pick(real ? ['#2f6fb5', '#c8442f', '#2f7d55'] : ['#2f6fb5', '#e2574c', '#8a5bd1']), X, 3.0, Z, th); // blade sign
      sign();
    } else if (type === 'sweets') {
      gl(W - 1.3, 1.0, 0.7, '#fff3d6', -0.25, 0.32, fv + 0.45); // glass counter
      for (let k = 0; k < 6; k++) dt(0.6, 0.2, 0.4, pick(real ? ['#e0b23a', '#c8442f', '#f2ead8', '#d9822b', '#b9604f'] : ['#f2c230', '#e2574c', '#f6efdf', '#e8891a', '#d9488f']), -2.4 + k * 0.85, 1.05, fv + 0.45);
      awning(); sign();
    } else {
      gl(W - 1.3, 1.75, 0.12, R() < 0.8 ? pick(LIT) : DARK, -0.25, 0.45, fv + 0.05);
      dt(1.0, 2.2, 0.14, '#4a3a33', W / 2 - 0.85, 0.32, fv + 0.06, 0, L.steel);
      dt(W - 0.9, 0.55, 0.14, '#9aa0a6', -0.15, 2.3, fv + 0.08, 0, L.steel); // half-rolled shutter
      if (real && R() < 0.4) dt(W - 0.9, 2.0, 0.08, '#8e9296', -0.15, 0.32, fv + 0.1, 0, L.steel); // shutter pulled down
      awning(); sign();
    }
  } else {
    dt(1.0, 2.3, 0.12, '#6b3f2a', -W / 2 + 1.1, 0.32, fv + 0.04, 0, L.steel);
    for (const u of [0.4, 2.1]) { dt(1.3, 1.25, 0.12, trim, u, 1.0, fv + 0.04); gl(1.05, 1.0, 0.14, lit(), u, 1.12, fv + 0.05); dt(1.6, 0.09, 0.5, trim, u, 2.45, fv + 0.22); }
  }
  s(W + 0.16, 0.2, Dp + 0.16, trim, 0, GH, 0, L.concrete);

  // upper floors
  for (let f = 1; f < floors; f++) {
    const y0 = GH + (f - 1) * FH;
    if (f > 1) s(W + 0.14, 0.16, Dp + 0.14, trim, 0, y0, 0, L.concrete);
    const balcony = !office && R() < 0.45;
    const us = office ? [-2.1, 0, 2.1] : balcony ? [-2.15, 2.15] : [-1.55, 1.55];
    for (const u of us) {
      if (office) { gl(1.85, 1.9, 0.1, lit(), u, y0 + 0.5, fv + 0.03); dt(0.12, 2.2, 0.16, real ? '#c9ccce' : '#e9edf0', u + 1.0, y0 + 0.35, fv + 0.05, 0, L.steel); continue; }
      dt(1.45, 1.45, 0.12, trim, u, y0 + 0.62, fv + 0.04);
      gl(1.15, 1.15, 0.14, lit(), u, y0 + 0.77, fv + 0.05);
      for (const b of [-0.2, 0.2]) dt(0.05, 1.15, 0.17, real ? '#3b3d40' : trim, u + b, y0 + 0.77, fv + 0.07, 0, L.steel); // grille
      dt(1.7, 0.08, 0.3, trim, u, y0 + 0.56, fv + 0.12, 0, L.concrete);
      dt(1.9, 0.09, 0.62, real ? '#8c3a30' : trim === '#f6efdf' ? '#b5523a' : trim, u, y0 + 2.18, fv + 0.28, 0, L.concrete); // chajja sunshade (maroon)
    }
    if (balcony) {
      dt(0.95, 2.0, 0.1, '#5a3a2a', 0, y0 + 0.2, fv + 0.03, 0, L.steel);
      dt(2.5, 0.14, 1.0, trim, 0, y0 + 0.08, fv + 0.48, 0, L.concrete);
      dt(2.5, 0.07, 0.07, '#2d3038', 0, y0 + 1.1, fv + 0.95, 0, L.steel);
      for (let k = 0; k < (real ? 9 : 4); k++) dt(0.05, 0.9, 0.05, '#2d3038', -1.2 + k * (real ? 0.3 : 0.8), y0 + 0.22, fv + 0.95, 0, L.steel); // railing
      if (R() < 0.5) dt(1.2, 0.5, 0.05, pick(AWNS), -0.3, y0 + 0.5, fv + 0.92); // drying sari / cloth
      if (R() < 0.6) for (const u of [-0.9, 0.9]) { const [X, Z] = P(u, fv + 0.75); parts.cyl(0.14, 0.1, 0.22, '#b5523a', X, y0 + 0.22, Z, 6); parts.ball(0.2, '#4f8a3e', X, y0 + 0.55, Z); } // potted plants
    }
    if (!office && R() < (real ? 0.5 : 0.35)) { // AC unit, with its bracket
      const au = (R() < 0.5 ? -1 : 1) * (W / 2 - 0.55);
      dt(0.78, 0.5, 0.32, '#e3e5e4', au, y0 + 1.85, fv + 0.17, 0, L.steel);
      if (real) dt(0.7, 0.04, 0.36, '#55585c', au, y0 + 1.8, fv + 0.17, 0, L.steel);
    }
  }

  // roof: parapet, black water tank, sometimes a tiled pitched roof
  if (office) {
    dt(W - 1.6, 1.1, Dp - 1.8, real ? '#8f9599' : '#5b6670', 0, H + 0.26, 0, 0, L.steel);
  } else if (opt.kind === 'residential' && R() < 0.35) {
    const [X, Z] = P(0, 0);
    parts.geo(new THREE.ConeGeometry(1, 1, 4), '#a2412f', X, H + 0.26 + 0.95, Z, 0, th + Math.PI / 4, 0, W * 0.78, 1.9, Dp * 0.78);
  } else {
    for (const [w, d, u, v] of [[W, 0.16, 0, fv - 0.08], [W, 0.16, 0, -fv + 0.08], [0.16, Dp, -W / 2 + 0.08, 0], [0.16, Dp, W / 2 - 0.08, 0]]) dt(w, 0.65, d, real ? wall : trim, u, H + 0.26, v, 0, brick ? L.concrete : L.plaster);
    const [X, Z] = P(W / 2 - 1.3, -0.8);
    parts.cyl(0.48, 0.48, 1.0, '#202024', X, H + 0.26, Z, 10);
    parts.cyl(0.2, 0.48, 0.18, '#202024', X, H + 1.26, Z, 10);
    const extra = R();
    if (extra < 0.22) { // rooftop billboard
      const [bx, bz] = P(0, 0.4);
      for (const u of [-2, 2]) { const [px, pz] = P(u, 0.4); parts.box(0.12, 2.2, 0.12, '#3a3f4a', px, H + 0.26, pz, th); }
      parts.box(W - 0.6, 1.9, 0.12, '#2a2d34', bx, H + 1.9, bz, th);
      signs.add(bx + Math.sin(th) * 0.08, H + 2.85, bz + Math.cos(th) * 0.08, th, W - 0.9, 1.6, (R() * signs.n) | 0);
    } else if (extra < 0.45) { // solar panels
      for (const u of [-1.6, 0, 1.6]) { const [px, pz] = P(u, 0.6); parts.geo(new THREE.BoxGeometry(1.4, 0.06, 1.9), '#23406b', px, H + 0.9, pz, -0.45, th, 0); }
    } else if (extra < 0.6) { // dish antenna
      const [px, pz] = P(-W / 2 + 1, 1.2); parts.geo(new THREE.SphereGeometry(0.45, 10, 5, 0, Math.PI * 2, 0, 0.9), '#e9ecef', px, H + 1.2, pz, -0.9, th, 0);
      parts.cyl(0.04, 0.04, 0.8, '#8d8a84', px, H + 0.26, pz, 4);
    } else if (extra < 0.78) { // washing line
      const [p1x, p1z] = P(-2.4, -1.2), [p2x, p2z] = P(2.4, -1.2);
      parts.cyl(0.04, 0.04, 1.4, '#8d8a84', p1x, H + 0.26, p1z, 4); parts.cyl(0.04, 0.04, 1.4, '#8d8a84', p2x, H + 0.26, p2z, 4);
      for (let k = 0; k < 4; k++) { const [cx, cz] = P(-1.8 + k * 1.2, -1.2); parts.box(0.8, 0.7, 0.03, pick(AWNS), cx, H + 0.9, cz, th); }
    }
  }

  // houses get a white compound wall with a gate at the front of the plot
  if (opt.yard) {
    const wv = fv + opt.yard - 0.1;
    for (const [u0, u1] of [[-W / 2, 0.7], [2.2, W / 2]]) {
      const w = u1 - u0;
      dt(w, 1.35, 0.22, '#ece7dc', (u0 + u1) / 2, 0, wv);
      dt(w + 0.04, 0.12, 0.3, '#c9c1b2', (u0 + u1) / 2, 1.35, wv, 0, L.concrete);
    }
    for (const u of [0.7, 2.2]) dt(0.38, 1.7, 0.38, '#d9d2c4', u, 0, wv, 0, L.concrete);
    dt(1.42, 1.25, 0.06, '#3f4752', 1.45, 0.05, wv, 0, L.steel); // gate
    for (const u of [-W / 2 + 0.1, W / 2 - 0.1]) dt(0.22, 1.35, opt.yard, '#ece7dc', u, 0, fv + opt.yard / 2);
    if (R() < 0.5) dt(2.6, 0.8, 0.6, '#3f7d46', -1.6, 0, fv + 0.6); // hedge
    if (R() < 0.5) dt(W - 0.6, 0.05, 0.05, '#f2efe6', 0, 1.6, wv); // poster rope line
  }
  return { H, floors };
}

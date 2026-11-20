// Street trees: a bark-textured trunk with a few branches under a soft, rounded
// canopy of four lumpy blobs (smooth normals, darker underneath, lighter on top).
// No alpha-tested leaf cards: solid shapes stay perfectly still on screen instead of
// shimmering. One shared geometry, instanced per 120-unit tile; the canopy sways in
// the vertex shader (surfaces.js). About 380 triangles a tree.
import * as THREE from 'three';
import { L } from './surfaces.js';

const BARK_TILE = 1.2;

export function treeGeometry(seed = 7) {
  let s = seed;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = [], nrm = [], col = [], uvl = [], sway = [], idx = [];
  const vtx = (p, n, c, u, v, l, w) => { pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); uvl.push(u, v, l); sway.push(w); return pos.length / 3 - 1; };
  const white = new THREE.Color(1, 1, 1);

  // a tapered tube from a to b
  const tube = (a, b, r0, r1, seg, w0, w1) => {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const base = pos.length / 3;
    for (let ring = 0; ring <= 1; ring++) for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2, r = ring ? r1 : r0;
      const n = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(q);
      const p = new THREE.Vector3(Math.cos(ang) * r, ring * len, Math.sin(ang) * r).applyQuaternion(q).add(a);
      vtx(p, n, white, (i / seg) * (r0 * 6.28) / BARK_TILE * 3, (ring * len) / BARK_TILE, L.bark, ring ? w1 : w0);
    }
    for (let i = 0; i < seg; i++) { const a0 = base + i, b0 = base + seg + 1 + i; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
  };
  const top = new THREE.Vector3(0.06, 2.2, -0.03);
  tube(new THREE.Vector3(0, 0, 0), top, 0.17, 0.12, 8, 0, 0.12);
  const ends = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + R(), end = new THREE.Vector3(Math.cos(a) * 0.8, 2.9 + R() * 0.4, Math.sin(a) * 0.8);
    tube(top, end, 0.09, 0.05, 5, 0.12, 0.45);
    ends.push(end);
  }

  // canopy: a big central blob and three around it, each a slightly lumpy sphere
  const centre = new THREE.Vector3(0, 3.45, 0);
  const dark = new THREE.Color('#2f6b35'), light = new THREE.Color('#7db352'), c = new THREE.Color();
  const blobs = [[centre, 1.45, 1.05], ...ends.map((e) => [e.clone().lerp(centre, 0.15).add(new THREE.Vector3(0, 0.25, 0)), 0.95 + R() * 0.2, 0.85])];
  for (const [ctr, rad, squash] of blobs) {
    const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position, base = pos.length / 3;
    const ph = R() * 10;
    for (let i = 0; i < P.count; i++) {
      const d = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)).normalize();
      // gentle lumps so the outline is organic, not a perfect ball
      const lump = 1 + 0.09 * Math.sin(d.x * 5 + ph) * Math.sin(d.y * 4 + ph * 0.7) * Math.sin(d.z * 5 - ph);
      const p = d.clone().multiply(new THREE.Vector3(rad, rad * squash, rad)).multiplyScalar(lump).add(ctr);
      // shading baked into the colour: darker under the canopy, sunlit on top
      const h = THREE.MathUtils.clamp((p.y - (centre.y - 1.3)) / 2.6, 0, 1);
      c.copy(dark).lerp(light, h * h * (3 - 2 * h));
      // smooth normals, bent towards the whole canopy so the blobs shade as one mass
      const n = p.clone().sub(centre).normalize().lerp(d, 0.6).normalize();
      vtx(p, n, c, 0, 0, L.plain, Math.min(1, p.distanceTo(top) / 1.6));
    }
    if (g.index) for (const i of g.index.array) idx.push(base + i);
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    g.dispose();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uvl', new THREE.Float32BufferAttribute(uvl, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

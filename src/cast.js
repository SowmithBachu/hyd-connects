import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, inBounds } from './geo.js';
import { lookFromSeed } from './people3d.js';
import { CharacterCrowd } from './characters.js';

export { Crowd, makeAvatar, lookFromSeed, seedOf, shirtOf, maskOf, SKIN, HAIRCOL, TOPS, SUITS, KURTAS, BOTTOMS, ACCENTS, HAIRSTYLES, OUTFITS } from './people3d.js';

const tint = (g, color) => {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};

// ---- background pedestrians on the footpaths -------------------------------
// They keep to their lane, slow down and step aside for obstacles (the visitor,
// people standing around, each other) and never walk through anyone.
const SEP = 0.9; // closest two people may stand, centre to centre
const BODY_R = 0.32; // a person's radius when squeezing past a post or tree
const VISIBLE = 44; // only the nearest pedestrians are drawn; the rest keep walking unseen
const cellKey = (x, z) => (Math.floor(x / 3) + 1000) * 4096 + (Math.floor(z / 3) + 1000);
export class Walkers {
  constructor(scene, roads, n, groundAt, props, grid, { visible = VISIBLE, near = 8, far = 24 } = {}) {
    this.visible = visible;
    this.crowd = new CharacterCrowd(scene, visible, { near, far });
    this.groundAt = groundAt; this.props = props; this.grid = grid;
    this.w = [];
    this.slotOf = new Int32Array(n).fill(-1);
    this.owner = new Int32Array(visible).fill(-1);
    const r = rng(77);
    const lanes = [];
    for (const road of roads) {
      if (road.major) continue;
      for (let k = 2; k < road.s.length - 2; k += 4) if (inBounds(road.s[k].x, road.s[k].z, 12)) lanes.push([road, k]);
    }
    for (let i = 0; i < visible; i++) { this.crowd.add(lookFromSeed(1000 + i)); this.crowd.hide(i); }
    for (let i = 0; i < n && lanes.length; i++) {
      const [road, k] = lanes[(r() * lanes.length) | 0];
      this.w.push({ i, look: lookFromSeed(1000 + i), road, t: k, dir: r() < 0.5 ? 1 : -1, side: r() < 0.5 ? 1 : -1, off: road.w / 2 + 1.0 + r() * ((road.fp || 3.2) - 1.6), sp: 1.1 + r() * 0.7, phase: r() * 6, ph: r() * 6,
        x: road.s[k].x, z: road.s[k].z, yaw: 0, far: false, dodge: 0, dodgeT: 0, speed: 0, d2: 0 });
    }
    this.crowd.commit();
  }
  // obstacles: [{x, z}] of the visitor and people standing near them
  update(dt, t, px, pz, hideR = 0, obstacles = []) {
    const active = [];
    for (const w of this.w) { w.far = Math.abs(w.x - px) > 200 || Math.abs(w.z - pz) > 200; if (!w.far) active.push(w); }
    // bucket the walkers into 3-unit cells, so each one only checks its neighbours
    const cells = this.cells || (this.cells = new Map());
    for (const list of cells.values()) list.length = 0;
    for (const w of active) { const k = cellKey(w.x, w.z); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(w); }
    this.frame = (this.frame || 0) + 1;
    // walkers far from you think four times less often (nobody can tell at 70 m)
    for (const w of active) {
      const far = w.d2 > 70 * 70;
      if (!far || (this.frame + w.i) % 4 === 0) this.step(w, far ? Math.min(0.2, dt * 4) : dt, obstacles);
    }

    // level of detail: hand the drawing slots to the nearest walkers
    for (const w of active) w.d2 = (w.x - px) ** 2 + (w.z - pz) ** 2;
    const want = active.filter((w) => w.d2 < 150 * 150 && !(hideR && w.d2 < hideR * hideR)).sort((a, b) => a.d2 - b.d2).slice(0, this.visible);
    const keep = new Set(want.map((w) => w.i));
    for (let sl = 0; sl < this.visible; sl++) { const o = this.owner[sl]; if (o >= 0 && !keep.has(o)) { this.slotOf[o] = -1; this.owner[sl] = -1; this.crowd.hide(sl); } }
    for (const w of want) {
      if (this.slotOf[w.i] < 0) {
        const sl = this.owner.indexOf(-1);
        if (sl < 0) break;
        this.owner[sl] = w.i; this.slotOf[w.i] = sl;
        this.crowd.paint(sl, w.look);
      }
      const amt = w.speed < 0.15 ? 0 : 0.85 * Math.min(1.2, w.speed / 1.4);
      this.crowd.set(this.slotOf[w.i], w.x, this.groundAt(w.x, w.z), w.z, w.yaw, w.phase, amt, 0, t + w.ph, 0.97);
    }
    this.crowd.commit();
  }
  // calls fn for walkers in the 3x3 cells around (x, z)
  neighbours(x, z, fn) {
    const cx = Math.floor(x / 3), cz = Math.floor(z / 3);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) { const l = this.cells.get((i + 1000) * 4096 + (j + 1000)); if (l) for (const o of l) fn(o); }
  }
  step(w, dt, obstacles) {
    const s = w.road.s;
    const k = Math.max(1, Math.min(s.length - 2, w.t | 0)), p = s[k], q = s[k + 1];
    let tx = q.x - p.x, tz = q.z - p.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const hx = tx * w.dir, hz = tz * w.dir, Lx = -tz * w.side, Lz = tx * w.side; // heading, and sideways (away from the road)
    // look ahead for anyone or anything in the way
    let block = null, bd = 1.8;
    const consider = (o, r = 0) => {
      const dx = o.x - w.x, dz = o.z - w.z, d = Math.hypot(dx, dz) - r;
      if (d < bd && dx * hx + dz * hz > -0.15) { bd = d; block = o; }
    };
    for (const o of obstacles) consider(o);
    this.neighbours(w.x, w.z, (o) => { if (o !== w) consider(o); });
    this.props.near(w.x, w.z, (o) => consider(o, o.r));
    let speed = w.sp;
    if (block) {
      const s2 = (w.x - block.x) * Lx + (w.z - block.z) * Lz;
      w.dodgeT = (s2 >= 0 ? 1 : -1) * (1.0 + (block.r || 0)); w.hold = 1.2;
      speed *= bd < 0.9 ? 0.15 : 0.55;
    } else if ((w.hold = (w.hold || 0) - dt) <= 0) w.dodgeT = 0;
    const room = (w.road.fp || 3.2) - 0.9; // stay on the footpath when stepping aside
    w.dodgeT = Math.max(-(w.off - w.road.w / 2 - 0.7), Math.min(room - (w.off - w.road.w / 2), w.dodgeT));
    w.dodge += (w.dodgeT - w.dodge) * Math.min(1, dt * 2.5);
    w.speed += (speed - w.speed) * Math.min(1, dt * 4);
    w.t += w.dir * w.speed * dt;
    if (w.t < 2 || w.t > s.length - 3 || !inBounds(w.x, w.z, 8)) { w.dir = -w.dir; w.t += w.dir * 0.5; }
    const f = w.t - k, off = w.off + w.dodge;
    let x = p.x + (q.x - p.x) * f + Lx * off, z = p.z + (q.z - p.z) * f + Lz * off;
    // hard separation so bodies never overlap people or props
    const push = (o, min) => { const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz); if (d < min && d > 0.0001) { x = o.x + (dx / d) * min; z = o.z + (dz / d) * min; } };
    for (const o of obstacles) push(o, SEP);
    this.neighbours(x, z, (o) => { if (o !== w) push(o, SEP); });
    this.props.near(x, z, (o) => push(o, o.r + BODY_R));
    // walls, carts and the roundabout: if the body would overlap anything solid, stay put this frame
    const g = this.grid;
    if (g && [[BODY_R, 0], [-BODY_R, 0], [0, BODY_R], [0, -BODY_R], [0, 0]].some(([ox, oz]) => g.blocked(x + ox, z + oz))) {
      x = w.x; z = w.z; w.dir = g.blocked(x, z) ? w.dir : w.dir; w.speed *= 0.5; w.dodgeT = -w.dodgeT || -0.8; w.hold = 1;
    }
    // ease into the corrected spot instead of snapping, so avoidance looks smooth
    const mvx = x - w.x, mvz = z - w.z;
    w.x = x; w.z = z;
    const want = Math.hypot(mvx, mvz) > 0.002 ? Math.atan2(mvx, mvz) : Math.atan2(hx, hz);
    let dy = want - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); w.yaw += dy * Math.min(1, dt * 7);
    w.phase += dt * 5.2 * w.speed;
  }
  // walkers near (x, z), for the visitor's collisions
  near(x, z, r) { return this.w.filter((w) => !w.far && Math.abs(w.x - x) < r && Math.abs(w.z - z) < r); }
}

// ---- metro trains on the viaduct -------------------------------------------
const box = (w, h, d, c, y, z = 0, x = 0) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
export class Metro {
  constructor(scene, metros) {
    const trainGeo = mergeGeometries([-1, 0, 1].flatMap((k) => [
      box(1.9, 1.5, 6.4, '#f4f1e6', 0.95, k * 6.8), box(1.94, 0.5, 6.44, '#3d4250', 1.15, k * 6.8),
    ]));
    this.trains = metros.map((m, i) => {
      const mesh = new THREE.Mesh(trainGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#fff0c8'), emissiveIntensity: 0 }));
      mesh.castShadow = true; scene.add(mesh);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.16, 20), new THREE.MeshBasicMaterial({ color: m.color }));
      stripe.position.y = 0.55; mesh.add(stripe);
      return { mesh, s: m.s, t: 20 + i * 90, dir: 1 };
    });
  }
  update(dt, night) {
    for (const tr of this.trains) {
      tr.t += tr.dir * 22 * dt;
      if (tr.t < 12) { tr.t = 12; tr.dir = 1; } else if (tr.t > tr.s.length - 13) { tr.t = tr.s.length - 13; tr.dir = -1; }
      const k = tr.t | 0, p = tr.s[k], q = tr.s[k + 1];
      tr.mesh.position.set(p.x, 6.5, p.z);
      tr.mesh.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      tr.mesh.material.emissiveIntensity = night * 0.25;
    }
  }
}

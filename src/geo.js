// One compact, walkable neighbourhood: Madhapur & HITEC City, Hyderabad.
// Stylised and condensed (about 1 unit = 1 metre) so you can wander from block to
// block in a minute or two. +x is east, +z is south. The real landmarks are here:
// the Cyber Towers junction, Hitech City metro, 100 Feet Road, Ayyappa Society,
// Durgam Cheruvu with its cable bridge, Shilparamam and Kavuri Hills.
export const WORLD_HALF = 320; // the grid covers this; the playable streets sit inside BOUNDS
export const BOUNDS = 205;
export const inBounds = (x, z, pad = 0) => Math.abs(x) < BOUNDS - pad && Math.abs(z) < BOUNDS - pad;
export const CITY = 'Hyderabad', HOOD = 'Madhapur';

// Blocks (each has a small square where people hang out). kind sets the look of the block.
const Z = (id, name, x, z, kind, blurb) => ({ id, name, x, z, r: 30, kind, blurb });
export const DISTRICTS = [
  Z('cyber', 'Cyber Towers Circle', 84, -24, 'tech', 'The junction everyone gives directions from.'),
  Z('metro', 'Hitech City Metro', -46, 22, 'tech', 'Blue Line station, chai stalls and the evening rush.'),
  Z('hundred', '100 Feet Road', 36, -66, 'mixed', 'Cafes, phone shops and startup offices above them.'),
  Z('ayyappa', 'Ayyappa Society', 176, -78, 'residential', 'Paying-guest lanes where half the corridor lives.'),
  Z('lake', 'Durgam Cheruvu Lakefront', 120, 140, 'mixed', 'The lake, the cable bridge and sunset walks.'),
  Z('shilparamam', 'Shilparamam', -132, -52, 'mixed', 'The crafts village, its arch and the weekend crowd.'),
  Z('kavuri', 'Kavuri Hills', -44, 128, 'residential', 'Quiet roads, a park and design studios in old bungalows.'),
];
export const districtById = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));

// Streets: [x, z] points, width w. main = the wide boulevard under the metro.
export const ROADS = [
  { name: 'Hitech City Main Road', w: 11, main: true, pts: [[-245, 0], [245, 0]] },
  { name: '100 Feet Road', w: 8, pts: [[60, -245], [60, 245]] },
  { name: 'Shilparamam Road', w: 6, pts: [[-96, -245], [-96, 62]] },
  { name: 'Kothaguda Road', w: 6, pts: [[-245, -112], [245, -112]] },
  { name: 'Ayyappa Society Road', w: 5, pts: [[150, -245], [150, 0]] },
  { name: 'Kavuri Hills Road', w: 6, pts: [[-245, 104], [60, 104]] },
  { name: 'Lake Road', w: 6, pts: [[60, 70], [92, 92], [140, 104], [245, 108]] },
  { name: 'Khanamet Lane', w: 4.5, pts: [[-168, -112], [-168, 104]] },
  { name: 'Image Gardens Lane', w: 4.5, pts: [[-96, 58], [60, 58]] },
  { name: 'Silicon Lane', w: 4.5, pts: [[118, -112], [118, 0]] },
];

export const METRO = [{ name: 'Blue Line', color: 0x2f6fb5, pts: [[-245, -3], [245, -3]], stations: [[-46, -3]] }];
export const LAKES = [{ name: 'Durgam Cheruvu', x: 172, z: 178, rx: 30, rz: 62, rot: 0.08 }];
export const PARKS = [{ name: 'Kavuri Hills Park', x: -46, z: 160, r: 30 }];
export const RIVER = null;
export const ORR = null;

export const LANDMARKS = [
  { type: 'cyber', name: 'Cyber Towers', x: 104, z: -62, clear: 15, y: 0 },
  { type: 'thub', name: 'Knowledge Hub', x: -30, z: -66, clear: 11, y: 0 },
  { type: 'arch', name: 'Shilparamam Arch', x: -140, z: -86, clear: 9, y: 2 },
  { type: 'bridge', name: 'Durgam Cheruvu Cable Bridge', x: 172, z: 178, clear: 0, y: 19 },
  { type: 'rocks', name: 'Khajaguda Rocks', x: -188, z: 168, clear: 18, y: 6 },
  { type: 'fountain', name: 'Cyber Towers Circle', x: 60, z: 0, clear: 0, y: 3 },
];

export const resolvePts = (pts) => pts.map((p) => (typeof p === 'string' ? [districtById[p].x, districtById[p].z] : p));
export const toXZ = (a, b) => [a, b]; // kept for older callers; coordinates are already local

export function nearestDistrict(x, z) {
  let best = null, bd = Infinity;
  for (const d of DISTRICTS) {
    const dist = Math.hypot(d.x - x, d.z - z) / d.r;
    if (dist < bd) { bd = dist; best = d; }
  }
  return { district: best, ratio: bd };
}
// the street you're on, for the location chip
export function nearestRoad(x, z) {
  let best = null, bd = Infinity;
  for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < bd) { bd = d; best = r; }
  }
  return { road: best, dist: bd };
}

// Small deterministic RNG so the neighbourhood looks the same on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const SPOTS = [];

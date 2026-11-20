// Spatial tiling for instanced geometry.
//
// One InstancedMesh for the whole city can never be frustum-culled, so every
// tree and building is drawn every frame (and again for shadows). Binning the
// instances into ~120-unit tiles lets three.js skip tiles that are off screen
// or outside the shadow camera.
import * as THREE from 'three';

export const TILE = 120;
const keyOf = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;

export class InstanceBin {
  constructor() { this.bins = new Map(); this.count = 0; }
  // m: a Matrix4 (its translation decides the tile); color: THREE.Color or null;
  // layer: optional texture layer (src/surfaces.js) for textured materials
  add(m, color, layer) {
    const e = m.elements, k = keyOf(e[12], e[14]);
    let b = this.bins.get(k);
    if (!b) this.bins.set(k, (b = { m: [], c: [], l: [] }));
    b.m.push(...e);
    if (color) b.c.push(color.r, color.g, color.b);
    if (layer != null) b.l.push(layer);
    this.count++;
  }
  build(geometry, material, { castShadow = true, receiveShadow = true, renderOrder = 0, depth = null } = {}) {
    const group = new THREE.Group();
    for (const b of this.bins.values()) {
      const n = b.m.length / 16;
      const im = new THREE.InstancedMesh(geometry, material, n);
      im.instanceMatrix.array.set(b.m);
      if (b.c.length) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.c), 3);
      if (b.l.length) { const g = geometry.clone(); g.setAttribute('iLayer', new THREE.InstancedBufferAttribute(new Float32Array(b.l), 1)); im.geometry = g; }
      im.computeBoundingSphere();
      im.castShadow = castShadow; im.receiveShadow = receiveShadow; im.renderOrder = renderOrder;
      if (depth) im.customDepthMaterial = depth;
      group.add(im);
    }
    this.bins = null;
    return group;
  }
}

// Merge a list of baked geometries into one mesh per tile.
export function tiledMerge(list, material, merge, { castShadow = true, receiveShadow = true } = {}) {
  const bins = new Map();
  for (const g of list) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3()), k = keyOf(c.x, c.z);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(g);
  }
  const group = new THREE.Group();
  for (const gs of bins.values()) {
    const m = new THREE.Mesh(merge(gs), material);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow;
    group.add(m);
    gs.forEach((g) => g.dispose());
  }
  return group;
}

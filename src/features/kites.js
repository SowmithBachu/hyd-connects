// Sankranti kites by day, floating sky lanterns after dark.
//
// Paper kites (the diamond patang with a tail) bob and dart over the rooftops on
// strings tied to the terraces. As night falls they turn into glowing lanterns that
// drift upward. One instanced mesh for the kites, one line set for the strings.
import * as THREE from 'three';

const PAPER = ['#d83a2e', '#f2b134', '#2f6fb5', '#2aa37a', '#e86a9a', '#f4f1e6', '#f08a3c', '#3aa6b9'];

export function createKites(scene, { count = 34, half = 190, R = Math.random } = {}) {
  // a diamond kite, its little tail, made of triangles in the XY plane
  const shape = [
    0, 0.75, 0, -0.55, 0.05, 0, 0, -0.65, 0, // left half
    0, 0.75, 0, 0, -0.65, 0, 0.55, 0.05, 0, // right half
    -0.1, -0.65, 0, 0.1, -0.65, 0, 0, -0.95, 0, // tail
    -0.07, -0.98, 0, 0.07, -0.98, 0, 0, -1.25, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(shape, 3));
  g.computeVertexNormals();
  const uNight = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = uNight;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // after dark, paper lanterns: warm light through the coloured paper
        totalEmissiveRadiance += mix(vColor, vec3(1.0, 0.72, 0.38), 0.55) * uNight * 2.2;`);
  };
  const mesh = new THREE.InstancedMesh(g, mat, count);
  mesh.frustumCulled = false;
  const kites = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const ax = (R() - 0.5) * 2 * half, az = (R() - 0.5) * 2 * half;
    kites.push({ ax, az, ay: 9 + R() * 8, h: 24 + R() * 30, ph: R() * 6.28, sp: 0.6 + R() * 0.6, s: 1.3 + R() * 0.8 });
    mesh.setColorAt(i, c.set(PAPER[(R() * PAPER.length) | 0]));
  }
  mesh.instanceColor.needsUpdate = true;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  const strings = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.35 }));
  strings.frustumCulled = false;
  scene.add(mesh, strings);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return {
    update(dt, t, night, rain) {
      uNight.value = night;
      // kites come down in the rain; lanterns rise slowly at night
      const show = Math.max(0, 1 - rain * 1.5);
      mesh.visible = show > 0.02; strings.visible = mesh.visible && night < 0.5;
      const arr = sg.attributes.position.array;
      kites.forEach((k, i) => {
        const tt = t * k.sp + k.ph;
        const lift = night * (8 + 6 * Math.sin(tt * 0.2));
        p.set(k.ax + Math.sin(tt * 0.31) * 9 + Math.sin(tt * 1.7) * 1.2, k.h + lift + Math.sin(tt * 0.83) * 3 + Math.sin(tt * 2.9) * 0.6, k.az + Math.cos(tt * 0.27) * 7);
        // kites tug and swing on their strings; lanterns hang upright
        e.set((1 - night) * (0.5 + Math.sin(tt * 2.1) * 0.25), Math.sin(tt * 0.31) * 0.6 + 1.2, (1 - night) * Math.sin(tt * 1.3) * 0.5);
        q.setFromEuler(e);
        sc.setScalar(k.s * show);
        m.compose(p, q, sc); mesh.setMatrixAt(i, m);
        arr.set([p.x, p.y - 0.6 * k.s, p.z, k.ax, k.ay, k.az], i * 6);
      });
      mesh.instanceMatrix.needsUpdate = true; sg.attributes.position.needsUpdate = true;
    },
  };
}

// "Guide me": walk to someone instead of teleporting.
//
// A soft saffron pillar of light rises over the person you picked and a ring
// pulses at their feet; an arrow on screen points the way (pinned to the edge of
// the screen when they are off to the side or behind you) with the distance left.
// It clears itself when you arrive.
import * as THREE from 'three';

export function createWaypoint(scene, camera, { onArrive } = {}) {
  const uT = { value: 0 }, uA = { value: 0 };
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.25, 46, 24, 1, true).translate(0, 23, 0),
    new THREE.ShaderMaterial({
      // drawn through walls, like a game waypoint, so you can always see where to go
      uniforms: { uT, uA }, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; void main(){ vY = position.y / 46.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT, uA; varying float vY;
        // a saffron column, solid at the base and fading upwards, with bands rising through it
        // (a deep saffron: filmic tone mapping turns bright oranges pale, and pale
        // vanishes against cream walls in golden light)
        void main(){ float a = clamp(pow(1.0 - vY, 1.1) * (0.85 + 0.15 * sin(uT * 3.0 - vY * 30.0)), 0.0, 1.0) * uA;
          gl_FragColor = vec4(mix(vec3(0.85, 0.12, 0.0), vec3(1.0, 0.36, 0.04), vY), a); }`,
    }),
  );
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  // drawn for the first few frames (fully transparent) so its shader compiles at
  // load, not on the frame you ask for directions; hidden after that until needed
  ring.visible = false; beam.frustumCulled = false; beam.renderOrder = 4;
  let warm = 4;
  scene.add(beam, ring);

  const el = document.createElement('div');
  el.id = 'guide'; el.className = 'glass'; el.hidden = true;
  el.innerHTML = '<svg viewBox="0 0 24 24" class="arw"><path d="M12 3l7 16-7-4-7 4z" fill="currentColor"/></svg><div><b></b><span></span></div>';
  document.body.append(el);
  const arw = el.querySelector('.arw'), nm = el.querySelector('b'), ds = el.querySelector('span');

  let target = null;
  const v = new THREE.Vector3();
  return {
    get active() { return !!target; },
    // where: () => ({ x, z, y }) so the beacon follows someone who moves
    set(name, where) { target = { name, where }; nm.textContent = name; el.hidden = false; uA.value = 0; },
    clear() { target = null; el.hidden = true; uA.value = 0; ring.visible = false; },
    update(dt, t, me, W, H) {
      if (warm > 0 && --warm === 0 && !target) beam.visible = false;
      if (!target) return;
      beam.visible = true;
      const p = target.where();
      if (!p) { this.clear(); return; }
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      uT.value = t; uA.value = Math.min(1, uA.value + dt * 2) * Math.min(1, (d - 1.5) / 6);
      ring.visible = true;
      beam.position.set(p.x, p.y || 0, p.z);
      ring.position.set(p.x, (p.y || 0) + 0.06, p.z);
      ring.scale.setScalar(1 + 0.25 * Math.sin(t * 4));
      ring.material.opacity = 0.5 + 0.3 * Math.sin(t * 4);
      ds.textContent = d < 1000 ? `${Math.round(d)} m away` : `${(d / 1000).toFixed(1)} km away`;
      if (d < 3.2) { const n = target.name; this.clear(); onArrive?.(n); return; }
      // screen arrow: over the person when visible, otherwise on the edge pointing at them
      v.set(p.x, (p.y || 0) + 2.6, p.z).project(camera);
      const behind = v.z > 1;
      let x = v.x, y = v.y;
      if (behind) { x = -x; y = -y; }
      const on = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.86;
      let ang;
      if (on) ang = Math.PI; // point down at them
      else {
        const k = 0.88 / Math.max(Math.abs(x), Math.abs(y) / 0.95, 1e-3);
        x *= k; y *= k;
        ang = Math.atan2(x, y);
      }
      el.classList.toggle('edge', !on);
      el.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -50%)`;
      arw.style.transform = `rotate(${ang}rad)`;
    },
  };
}

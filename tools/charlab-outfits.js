// Outfit view for the character lab: /tools/charlab.html?mode=outfits
// Top row: full figures; bottom row: close-ups. Uses the real game module.
import { loadCharacterLib, Character, specFromLook } from '../src/characters.js';

export default async function outfits({ THREE, scene, views, labels }) {
  const lib = await loadCharacterLib();
  const looks = [
    { name: 'Hoodie · male · average', look: { outfit: 'hoodie', hair: 'short', top: '#2f6fb5', bottom: '#24262d', skin: '#a8714a', hairColor: '#16120f', accent: '#ffb81c', build: 'average' } },
    { name: 'Shirt · female · slim', look: { outfit: 'shirt', hair: 'long', top: '#f4f1e6', bottom: '#3b4f7a', skin: '#e2b089', hairColor: '#2e2019', accent: '#e2574c', build: 'slim' } },
    { name: 'Kurta · male · heavy', look: { outfit: 'kurta', hair: 'side', top: '#e8c76a', bottom: '#efe8d8', skin: '#8a5a3b', hairColor: '#16120f', accent: '#b5352a', beard: true, build: 'heavy' } },
    { name: 'T-shirt · female · broad', look: { outfit: 'tee', hair: 'bun', top: '#e2574c', bottom: '#2d3a5c', skin: '#6b4430', hairColor: '#16120f', accent: '#ffb81c', build: 'broad' } },
  ];
  const chars = looks.map((l, i) => {
    const c = new Character(lib, specFromLook(l.look, 'lab' + i));
    c.place(i * 1.6, 0, 0, 0);
    scene.add(c.object);
    return c;
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(2.4, 0, 0); ground.receiveShadow = true;
  scene.add(ground);
  const lab = document.getElementById('labels');
  lab.style.setProperty('--cols', looks.length); lab.style.setProperty('--rows', 2);
  for (let k = 0; k < looks.length * 2; k++) lab.append(document.createElement('div'));
  chars.forEach((c, i) => {
    lab.children[i].innerHTML = `<b>${looks[i].name} · ${c.triangles.toLocaleString()} tris</b>`;
    const full = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    full.position.set(i * 1.6 + 0.9, 1.25, 3.6); full.lookAt(i * 1.6, 0.92, 0);
    const close = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    close.position.set(i * 1.6 + 0.35, 1.62, 1.15); close.lookAt(i * 1.6, 1.45, 0);
    views.push({ cam: full, col: i, row: 0, cols: looks.length }, { cam: close, col: i, row: 1, cols: looks.length });
  });
  // animate: idle for everyone; press W in the lab to make them walk
  let amt = 0, last = performance.now();
  addEventListener('keydown', (e) => { if (e.key === 'w') amt = amt ? 0 : 1; if (e.key === 'g') chars.forEach((c) => { c.greet = c.greet ? 0 : 1; }); });
  const tick = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    chars.forEach((c) => c.update(dt, { speed: amt ? 1.2 : 0, greet: c.greet || 0 }));
    window.__lab?.render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__chars = chars;
}

// Character previews for the character editor (registration, and "Edit character"
// in the city):
//  - createCharacterPreview(): a live 3D view of one character that turns slowly;
//    drag to turn it yourself. One small canvas, only while the editor is open.
//  - createThumbs(): small rendered pictures of characters (a look, a hairstyle, an
//    outfit), drawn one at a time off screen and cached, for the editor's tiles.
// Both use the same character models as the city; the city does no work while the
// editor covers it.
import * as THREE from 'three';
import { makeCharacterAvatar, loadCharacterLib, specFromLook, Character } from '../characters.js';

const none = () => ({ place() {}, hide() {}, dispose() {} });

function stage(scene) {
  scene.add(new THREE.HemisphereLight('#fff4e4', '#2b3b44', 1.6));
  const key = new THREE.DirectionalLight('#ffe2c2', 2.4); key.position.set(2.5, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight('#7fd8ff', 1.2); rim.position.set(-3, 2.5, -2.5); scene.add(rim);
}
function makeRenderer(canvas, alpha = true) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'low-power', preserveDrawingBuffer: false });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  return r;
}

export function createCharacterPreview() {
  const canvas = document.createElement('canvas');
  canvas.className = 'cpv';
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene(); stage(scene);
  // a soft round floor so the character stands on something
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  camera.position.set(0, 1.08, 4.4); camera.lookAt(0, 0.9, 0);

  let avatar = null, lookKey = '', raf = 0, yaw = 0.35, drag = null, last = 0;
  const size = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, pr = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!canvas.isConnected) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!drag) yaw += 0.25 * dt;
    size();
    avatar?.place(0, 0, 0, yaw, 0, 0, now / 1000);
    renderer.render(scene, camera);
  };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) * 0.012; });
  const up = () => { drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  return {
    canvas,
    set(look) {
      const k = JSON.stringify(look);
      if (k === lookKey) return;
      lookKey = k;
      avatar?.dispose();
      avatar = makeCharacterAvatar(scene, look, false, none);
      if (!raf) raf = requestAnimationFrame(loop);
    },
    dispose() { cancelAnimationFrame(raf); raf = 0; avatar?.dispose(); avatar = null; lookKey = ''; renderer.dispose(); renderer.forceContextLoss(); },
  };
}

// framings for the tiles: upper body (a look, an outfit) and head (a hairstyle)
const FRAMES = {
  bust: { pos: [0.55, 1.42, 2.15], at: [0, 1.22, 0], fov: 30 },
  head: { pos: [0.3, 1.6, 1.05], at: [0, 1.53, 0], fov: 32 },
};

export function createThumbs({ width = 168, height = 200 } = {}) {
  const canvas = document.createElement('canvas');
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); stage(scene);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 20);
  const cache = new Map(), waiting = new Map();
  let queue = [], busy = false, dead = false;

  async function pump() {
    if (busy || dead) return;
    busy = true;
    const lib = await loadCharacterLib().catch(() => null);
    while (queue.length && !dead && lib) {
      const { key, look, frame } = queue.shift();
      if (cache.has(key)) continue;
      const ch = new Character(lib, specFromLook({ build: 'average', ...look }, 'thumb'), 'near');
      ch.place(0, 0, 0, 0.3); ch.update(1 / 60);
      scene.add(ch.object);
      const f = FRAMES[frame];
      camera.fov = f.fov; camera.position.set(...f.pos); camera.lookAt(...f.at); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/webp', 0.86);
      ch.dispose();
      cache.set(key, url);
      for (const fn of waiting.get(key) || []) fn(url);
      waiting.delete(key);
      await new Promise((r) => setTimeout(r, 0)); // one at a time, keeping the page responsive
    }
    busy = false;
  }

  return {
    // a picture of this look (cached); onReady fires when it has been drawn
    get(look, frame, onReady) {
      const key = frame + JSON.stringify(look);
      if (cache.has(key)) return cache.get(key);
      if (!waiting.has(key)) { waiting.set(key, []); queue.push({ key, look, frame }); }
      if (onReady) waiting.get(key).push(onReady);
      pump();
      return null;
    },
    // drop requests nobody is waiting for any more (after the choices changed)
    clearQueue() { queue = []; waiting.clear(); },
    dispose() { dead = true; queue = []; waiting.clear(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}

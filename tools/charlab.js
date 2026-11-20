// Dev-only character lab: compares the original Quaternius mesh with our near and far
// LODs, close up on the face and the hands. Open /tools/charlab.html on the dev server.
// ?mode=lod (default) or ?mode=outfits (see characters.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || 'lod';
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fc6d8');
scene.add(new THREE.HemisphereLight('#eaf4ff', '#c9a97c', 1.7));
const sun = new THREE.DirectionalLight('#ffe6c2', 2.3);
sun.position.set(4, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 8, top: 4, bottom: -2 });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(sun);

const loader = new GLTFLoader();
const tex = new THREE.TextureLoader();
const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
const SRC = '/assets/source/ubc/x/' + encodeURIComponent('Universal Base Characters[Standard]') + '/';
const wire = [];
const views = [];

function poseAll(roots, clip, t) {
  for (const r of roots) {
    const m = new THREE.AnimationMixer(r);
    m.clipAction(clip).play();
    m.setTime(t);
  }
}

function count(obj) {
  let n = 0;
  obj.traverse((o) => { if (o.isMesh && o.visible) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return Math.round(n);
}

async function lodMode() {
  const meta = await (await fetch('/characters/atlas.json')).json();
  const [orig, ours, anims] = await Promise.all([
    load(SRC + 'Base%20Characters/Godot%20-%20UE/Superhero_Male_FullBody.gltf'),
    load('/characters/body_male.glb'),
    load('/characters/anims.glb'),
  ]);
  // the original ships with its dark-skin texture; use the light one we built the atlas from
  const light = tex.load(SRC + 'Base%20Characters/Textures/T_Superhero_Male_Ligh.png');
  light.flipY = false; light.colorSpace = THREE.SRGBColorSpace;
  const hairTex = tex.load(SRC + 'Base%20Characters/Textures/T_Hair_1_BaseColor.png');
  hairTex.flipY = false; hairTex.colorSpace = THREE.SRGBColorSpace;
  orig.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/Superhero_Male/.test(o.material.name)) o.material.map = light;
    if (/Hair/.test(o.material.name)) { o.material.map = hairTex; o.material.color.set('#3a2a20'); }
    o.material.needsUpdate = true;
  });
  // original hair, so both sides wear the same style
  const origHair = await load(SRC + 'Hairstyles/Rigged%20to%20Head%20Bone/glTF%20(Godot%20-Unreal)/Hair_SimpleParted.gltf');
  origHair.scene.traverse((o) => { if (o.isMesh) { o.material.map = hairTex; o.material.color.set('#3a2a20'); } });

  const atlas = tex.load('/characters/atlas.webp'), atlasN = tex.load('/characters/atlas_n.webp');
  atlas.flipY = atlasN.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  // the atlas stores detail / average at 50% grey; multiply back by the average colour
  const back = (rgb) => new THREE.Color().setRGB(...rgb.map((c) => c / 255), THREE.SRGBColorSpace).multiplyScalar(1 / new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace).r);
  const mats = {
    body: new THREE.MeshStandardMaterial({ map: atlas, normalMap: atlasN, color: back(meta.average.male), roughness: 0.6 }),
    eyes: new THREE.MeshStandardMaterial({ map: atlas, normalMap: atlasN, roughness: 0.35 }),
    hair: new THREE.MeshStandardMaterial({ map: atlas, normalMap: atlasN, color: back(meta.average.hair1).multiply(new THREE.Color('#3a2a20')), roughness: 0.8, side: THREE.DoubleSide }),
  };
  const build = (lod) => {
    const r = SkeletonUtils.clone(ours.scene);
    r.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const [l, part] = o.name.split('__');
      o.visible = l === lod && (part === 'body' || part === 'eyes' || part === 'brows' || part === 'Hair_SimpleParted');
      o.material = part === 'body' ? mats.body : part === 'eyes' ? mats.eyes : mats.hair;
      o.frustumCulled = false;
    });
    return r;
  };
  const near = build('near'), far = build('far');
  const origRoot = new THREE.Group();
  origRoot.add(orig.scene);
  const oh = origHair.scene; // bind the hair to the original body's skeleton by bone name
  const bones = {}; orig.scene.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  oh.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton = new THREE.Skeleton(o.skeleton.bones.map((b) => bones[b.name]), o.skeleton.boneInverses); o.frustumCulled = false; } });
  origRoot.add(oh);
  orig.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const cols = [['Original (Quaternius)', origRoot], ['Near LOD (ours)', near], ['Far LOD (ours)', far]];
  cols.forEach(([, r], i) => { r.position.x = i * 3; scene.add(r); });
  const idle = anims.animations.find((a) => a.name === 'idle');
  poseAll([orig.scene, near, far], idle, 0.6);
  // the hair of the original is a separate skeleton driven through bone names above
  scene.updateMatrixWorld(true);

  const tri = [count(origRoot), count(near), count(far)];
  const head = new THREE.Vector3(), hand = new THREE.Vector3();
  cols.forEach(([name, r], i) => {
    let H, Hd; r.traverse((o) => { if (o.isBone && o.name === 'Head' && !H) H = o; if (o.isBone && o.name === 'hand_r' && !Hd) Hd = o; });
    H.getWorldPosition(head); Hd.getWorldPosition(hand);
    const c1 = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    c1.position.set(head.x + 0.16, head.y + 0.1, head.z + 0.62); c1.lookAt(head.x, head.y + 0.08, head.z);
    const c2 = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    c2.position.set(hand.x + 0.05, hand.y + 0.12, hand.z + 0.5); c2.lookAt(hand.x, hand.y - 0.03, hand.z);
    views.push({ cam: c1, col: i, row: 0 }, { cam: c2, col: i, row: 1 });
    labels(i, `${name} · ${tri[i].toLocaleString()} triangles (with hair)`);
  });
  // wireframe overlay toggle
  for (const r of [origRoot, near, far]) r.traverse((o) => { if (o.isMesh) wire.push(o); });
}

const lab = document.getElementById('labels');
function labels(i, text) {
  lab.style.setProperty('--cols', 3); lab.style.setProperty('--rows', 2);
  if (!lab.children.length) for (let k = 0; k < 6; k++) lab.append(document.createElement('div'));
  lab.children[i].innerHTML = `<b>${text}</b>`;
}

const btn = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.onclick = f; document.getElementById('bar').append(b); };
btn('Wireframe', () => { const ms = new Set(wire.flatMap((o) => (Array.isArray(o.material) ? o.material : [o.material]))); for (const m of ms) m.wireframe = !m.wireframe; render(); });

function render() {
  const W = innerWidth, H = innerHeight, rh = H / 2;
  for (const v of views) {
    const cw = W / (v.cols || 3), x = v.col * cw, y = H - (v.row + 1) * rh;
    renderer.setViewport(x, y, cw, rh); renderer.setScissor(x, y, cw, rh);
    v.cam.aspect = cw / rh; v.cam.updateProjectionMatrix();
    renderer.render(scene, v.cam);
  }
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); render(); });

if (MODE === 'lod') await lodMode();
else await (await import('./charlab-outfits.js')).default({ THREE, scene, views, labels, wire, load });
THREE.DefaultLoadingManager.onLoad = render;
render();
setTimeout(render, 600);
window.__lab = { render, scene, views };

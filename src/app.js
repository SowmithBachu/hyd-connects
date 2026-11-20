import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import './style.css';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { gsap } from 'gsap';
import { createIcons, createElement, Compass, MapPin, Search, Map as MapIcon, UserPlus, Menu, X, MousePointerClick, Sun, Moon, Radio, Footprints, Pencil, Sparkles, Info, Hand, Camera } from 'lucide';
import { buildWorld } from './city.js';
import { Walkers, Metro, makeAvatar, lookFromSeed, seedOf, SKIN, HAIRCOL, TOPS, SUITS, KURTAS, BOTTOMS, ACCENTS, HAIRSTYLES, OUTFITS } from './cast.js';
import { DISTRICTS, LAKES, PARKS, ROADS, METRO, LANDMARKS, HOOD, CITY, BOUNDS, districtById, nearestDistrict, nearestRoad, resolvePts, rng } from './geo.js';
import { STATUS } from './people.js';
import { CharacterCrowd, makeCharacterAvatar, loadCharacterLib } from './characters.js';
import { deviceTier, hasWebGL2 } from './device.js';
import { createOnboarding, normaliseLinkedIn, normaliseX, normaliseSite } from './onboarding.js';
import { createKites } from './features/kites.js';
import { createWaypoint } from './features/waypoint.js';
import { createPhoto } from './features/photo.js';
import { loadSurfaces, surfaceUniforms, setSurfaceQuality } from './surfaces.js';
import { Live } from './live.js';
import { createPost, QUALITY } from './post.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
const kbd = (k) => el('kbd', '', k);
const icon = (node) => createElement(node);
const xBtn = () => { const b = el('button', 'x'); b.setAttribute('aria-label', 'Close'); b.append(icon(X)); return b; };
const slideIn = (node, from = 24) => gsap.fromTo(node, { x: from, opacity: 0 }, { x: 0, opacity: 1, duration: 0.38, ease: 'power3.out', clearProps: 'transform' });
createIcons({ icons: { Compass, MapPin, Search, Map: MapIcon, UserPlus, Menu, X, MousePointerClick, Footprints, Hand, Camera } });

// ---------------------------------------------------------------- renderer
const canvas = $('#c');
if (!hasWebGL2()) {
  // say so plainly instead of showing a blank page
  $('#loading').innerHTML = '<div class="mark"></div><b>Hyderabad Connect</b><span>This browser cannot show the 3D city (it needs WebGL 2).<br>Please open it in a recent Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.</span>';
  throw new Error('WebGL 2 is not available');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// phones and low-spec laptops start light (and the city is less busy) so play is smooth from the first frame
const device = deviceTier(renderer);
document.body.classList.toggle('lite', device.lite);
document.body.classList.toggle('phone', device.phone);
if (device.phone || matchMedia('(pointer: coarse)').matches) { // touch wording
  const lh = $('#lookHint'); if (lh) lh.lastChild.textContent = 'Drag to look around · pinch to zoom';
}
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // cheaper than PCFSoft, still soft at this map size
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#f2d9b8', 150, 1000);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 3600); // near 0.5: depth precision for thin layers far away
const hemi = new THREE.HemisphereLight('#eaf4ff', '#c9a97c', 1.7);
const sun = new THREE.DirectionalLight('#ffe6c2', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
scene.add(hemi, sun, sun.target);
// soft warm light that follows me, so faces stay readable after dark
const fill = new THREE.PointLight('#ffe6c8', 0, 26, 1.4);
scene.add(fill);
// graphics are always picked from this device's specs (and stepped down if frames run long)
let gate = null; // landing page + registration (set up at boot, below)
let cityWarm = false; // textures, characters and shaders are ready
let swoop = null; // camera move from the landing page flight into the city
let photo = null; // set up once the menus exist (below)
try { localStorage.removeItem('deccan-commons.quality'); localStorage.removeItem('deccan-commons.look'); } catch { /* private mode */ } // old manual settings
const post = createPost(renderer, scene, camera, sun, device.lite ? 'low' : 'high');
post.onLevel = (l) => setSurfaceQuality(l === 'low');
setSurfaceQuality(post.level === 'low');
// every file the city needs is counted, so the landing page can show real progress
let loadFrac = 0;
THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => { loadFrac = loaded / total; gate?.progress(loadFrac); };
const surfacesReady = import.meta.env.DEV && location.search.includes('classic') ? Promise.resolve()
  : loadSurfaces(renderer, scene).catch((e) => console.warn('surface textures failed to load', e));
const sunDir = new THREE.Vector3(-0.55, 0.9, 0.42).normalize();
let shadowHalf = 0;
function aimSun(x, z, half) {
  const snap = half / 512;
  x = Math.round(x / snap) * snap; z = Math.round(z / snap) * snap;
  sun.target.position.set(x, 0, z);
  sun.position.set(x + sunDir.x * 420, sunDir.y * 420, z + sunDir.z * 420);
  if (Math.abs(half - shadowHalf) > shadowHalf * 0.12) {
    shadowHalf = half;
    const c = sun.shadow.camera; c.left = c.bottom = -half; c.right = c.top = half; c.near = 10; c.far = 900; c.updateProjectionMatrix();
  }
}

// sky dome, stars and clouds
const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, low: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying float h; void main(){ vec3 c = mix(low, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.16, 0.75, h)); gl_FragColor = vec4(c, 1.0); }',
}));
sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
const stars = (() => {
  const r = rng(11), p = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { const a = r() * 6.283, y = 0.08 + r() * 0.92, s = Math.sqrt(1 - y * y); p.set([Math.cos(a) * s * 2800, y * 2800, Math.sin(a) * s * 2800], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  m.frustumCulled = false; m.renderOrder = -1; scene.add(m); return m;
})();
const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false, transparent: true, opacity: 0.9 }), 150);
{
  const r = rng(5), d = new THREE.Object3D();
  for (let i = 0; i < 50; i++) {
    const cx = (r() - 0.5) * 3600, cz = (r() - 0.5) * 3600, cy = 230 + r() * 150, s = 30 + r() * 46;
    for (let k = 0; k < 3; k++) { d.position.set(cx + (k - 1) * s * 0.85, cy + (k === 1 ? s * 0.16 : 0), cz + (r() - 0.5) * s * 0.5); d.scale.set(s * (k === 1 ? 1.15 : 0.8), s * (k === 1 ? 0.42 : 0.3), s * 0.62); d.updateMatrix(); clouds.setMatrixAt(i * 3 + k, d.matrix); }
  }
  clouds.frustumCulled = false; scene.add(clouds);
}

let W = 1, H = 1;
const STAGE_SHEET = 0.54; // share of a phone screen the profile editor takes (matches body.stage #signin in style.css)
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  post.setSize(W, H);
  camera.aspect = W / H;
  // portrait phones: a wider lens so the street isn't a narrow slot around your character
  camera.fov = W < H ? 72 : 60;
  // editing my profile: frame my character in the space the editor panel leaves free
  // (beside the panel on wide screens, above the bottom sheet on phones)
  if (document.body.classList.contains('stage')) {
    if (W > 760) { const right = 16 + Math.min(470, W - 32), cx = (right + W) / 2; camera.setViewOffset(W, H, -(cx - W / 2), 0, W, H); }
    else { const free = H * (1 - STAGE_SHEET); camera.setViewOffset(W, H, 0, (H - free) / 2, W, H); }
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------- world
const world = buildWorld(scene, { lite: device.lite });
const walkers = new Walkers(scene, world.roads, device.lite ? 70 : 140, world.groundAt, world.props, world.grid, device.lite ? { visible: 20, near: 4, far: 10 } : {});
const metro = new Metro(scene, world.metroSamples);
const crowd = new CharacterCrowd(scene, 400, { ring: true, near: device.lite ? 6 : 10, far: device.lite ? 14 : 24 });
const selRing = new THREE.Group();
for (const a of [0, Math.PI]) { const m = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.16, 32, 1, a, Math.PI * 0.72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffb81c', side: THREE.DoubleSide })); selRing.add(m); }
selRing.position.y = 0.4; selRing.visible = false; scene.add(selRing);

// ---------------------------------------------------------- time of day
// Live mode follows the real clock in Hyderabad (IST, UTC+5:30).
// the city always follows the real time in Hyderabad (IST): day, afternoon, evening, night
let night = 0;
const istHours = () => { const d = new Date(); return (((d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24) + 24) % 24; };
const C = (h) => new THREE.Color(h);
const PAL = {
  day: { top: C('#3f8fd8'), mid: C('#a6d8f0'), low: C('#f2dcbc'), hemiS: C('#eaf4ff'), hemiG: C('#c9a97c'), sun: C('#ffe6c2') },
  // dusk: deep blue overhead, the warm glow only low on the horizon
  dusk: { top: C('#1c2a5e'), mid: C('#4f5a92'), low: C('#f2a066'), hemiS: C('#c9c4e0'), hemiG: C('#6a5048'), sun: C('#ff9a55') },
  night: { top: C('#08112b'), mid: C('#17264f'), low: C('#2b3866'), hemiS: C('#8090c8'), hemiG: C('#3e3a40'), sun: C('#9fb0e8') },
};
const tmp = new THREE.Color();
const mix3 = (key, dusk, nightW) => tmp.copy(PAL.day[key]).lerp(PAL.dusk[key], dusk).lerp(PAL.night[key], nightW);
const base = { sun: 2.3, hemi: 1.7, env: 0.85, fog: new THREE.Color(), sky: [new THREE.Color(), new THREE.Color(), new THREE.Color()] };
function applyTime(h) {
  const a = ((h - 6) / 12) * Math.PI, e = Math.sin(a);
  night = 1 - smooth(-0.22, 0.06, e);
  const dusk = Math.exp(-((e - 0.04) ** 2) / 0.018) * (1 - night * 0.6);
  skyU.top.value.copy(mix3('top', dusk, night)); skyU.mid.value.copy(mix3('mid', dusk, night)); skyU.low.value.copy(mix3('low', dusk, night));
  scene.fog.color.copy(skyU.low.value);
  scene.background = scene.fog.color;
  hemi.color.copy(mix3('hemiS', dusk, night)); hemi.groundColor.copy(mix3('hemiG', dusk, night));
  hemi.intensity = 1.7 - night * 1.12;
  sun.color.copy(mix3('sun', dusk, night));
  sun.intensity = night > 0.5 ? 0.42 : 2.3 * (1 - night) + 0.2;
  if (night > 0.5) sunDir.set(0.35, 0.85, -0.4).normalize();
  else sunDir.set(-Math.cos(a), Math.max(0.22, e), 0.38).normalize();
  shadowHalf = 0;
  stars.material.opacity = night * 0.9;
  clouds.material.color.copy(tmp.set('#ffffff').lerp(C('#ffb489'), dusk * 0.7).lerp(C('#2a3358'), night));
  world.setNight(night);
  fill.intensity = night * 3.5;
  scene.environmentIntensity = 0.85 * (1 - night) + 0.12;
  Object.assign(base, { sun: sun.intensity, hemi: hemi.intensity, env: scene.environmentIntensity });
  base.fog.copy(scene.fog.color); base.sky[0].copy(skyU.top.value); base.sky[1].copy(skyU.mid.value); base.sky[2].copy(skyU.low.value);
  post.setNight(night);
  const fmt = (x) => { const hh = Math.floor(x), mm = Math.floor((x - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
  const part = h < 5 || h >= 19.5 ? 'Night' : h < 12 ? 'Morning' : h < 16.5 ? 'Afternoon' : 'Evening';
  const clock = $('#clock'); clock.replaceChildren(icon(night > 0.5 ? Moon : Sun), document.createTextNode(fmt(h)), el('small', '', `${part} · IST`));
}
const tickTime = () => applyTime(istHours());

// ---------------------------------------------------------------- people
const labels = $('#labels');
const actors = new Map(); // id -> actor
const freeSlots = [];
let me = null; // my live profile, if signed in
let openId = null; // whose profile card is open
let editing = null; // draft profile while the join panel is open
let everConnected = false;
const live = new Live({
  hello(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, a] of actors) if (a.p.live && !ids.has(id)) removeActor(id);
    // my profile isn't on this server (right now): show me as a guest, but keep my sign-in;
    // a server that is restarting or moving its data must never wipe people's saved logins
    if (live.cred && !ids.has(live.cred.id) && me) { me = null; refreshMe(); }
    for (const p of list) upsert(p, false);
    afterPeopleChange();
  },
  upsert(p) { upsert(p, true); afterPeopleChange(); },
  remove(id) { removeActor(id); afterPeopleChange(); },
  presence(id, on) { const a = actors.get(id); if (a) { a.p.online = on; paintLabel(a); afterPeopleChange(); } },
  status: () => renderStatus(),
});

function spotFor(p) {
  const pl = world.plazas[p.area] || world.plazas.cyber;
  const r = rng(seedOf(p.id));
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2, rad = pl.inner + 2 + r() * (pl.outer - pl.inner - 2);
    const x = pl.x + Math.cos(a) * rad, z = pl.z + Math.sin(a) * rad;
    const crowded = [...actors.values()].some((o) => o.p && o.p.id !== p.id && (o.x - x) ** 2 + (o.z - z) ** 2 < 4.5);
    if (!world.grid.blocked(x, z) && !(world.grid.get(x, z) & 32) && !crowded) return { x, z, yaw: Math.atan2(pl.x - x, pl.z - z) + (r() - 0.5) };
  }
  return { x: pl.x + 3, z: pl.z + 3, yaw: 0 };
}
function paintLabel(a) {
  const p = a.p, st = STATUS[p.status];
  a.lab.className = 'pl' + (a.sel ? ' sel' : '');
  const look = p.look || lookFromSeed(seedOf(p.id));
  const card = el('div', 'card'), ava = el('div', 'ava', initials(p.name)), txt = el('div');
  ava.style.background = `linear-gradient(135deg, ${look.top}, ${look.accent || '#ff7a3d'})`;
  if (p.live && p.online) ava.append(el('i', 'on'));
  txt.append(el('div', 'nm', p.name), el('div', 'rl', [p.role, p.company].filter(Boolean).join(' · ')));
  card.append(ava, txt);
  a.lab.replaceChildren(card);
  if (st) a.lab.append(el('div', 'tag ' + p.status, st.label));
}
let moved = false; // have I walked yet (declared up here: profile events can arrive early)
let registering = null; // name being registered: its broadcast can arrive before our own id does
let pendingCard = null; // a guest asked to meet this person, then went to register
function upsert(p, fresh) {
  if (registering && p.name === registering && Date.now() - (p.joinedAt || 0) < 10000) return;
  if (live.cred && p.id === live.cred.id) {
    if (!me && !moved && !editing) { const pl = world.plazas[p.area]; if (pl) { state.x = cam.tx = pl.x + 8; state.z = cam.tz = pl.z + 12; } } // start in my own neighbourhood
    me = p; refreshMe(); return;
  }
  p = { ...p, live: p.live ?? !p.sample };
  const look = p.look || lookFromSeed(seedOf(p.id));
  const ringCol = STATUS[p.status]?.color;
  let a = actors.get(p.id);
  if (!a) {
    const idx = freeSlots.length ? freeSlots.pop() : crowd.add(look, ringCol);
    const lab = el('div', 'pl'); lab.style.display = 'none';
    lab.addEventListener('click', () => openCard(a.p));
    labels.append(lab);
    a = { idx, lab, shown: false, ph: rng(seedOf(p.id))() * 6 };
    actors.set(p.id, a);
    if (fresh && p.live && Date.now() - (p.joinedAt || 0) < 15000) toast(p);
  }
  const areaChanged = !a.p || a.p.area !== p.area;
  a.p = p;
  crowd.paint(a.idx, look, ringCol);
  if (areaChanged) { Object.assign(a, spotFor(p), { base: undefined }); a.gy = world.groundAt(a.x, a.z); }
  a.base ??= a.yaw;
  paintLabel(a);
  crowd.set(a.idx, a.x, a.gy, a.z, a.yaw); crowd.commit();
  if (openId === p.id) openCard(p);
}
function removeActor(id) {
  const a = actors.get(id); if (!a) return;
  crowd.hide(a.idx); crowd.commit(); freeSlots.push(a.idx);
  a.lab.remove(); actors.delete(id);
  if (openId === id) closeCard();
}
const everyone = () => [...actors.values()].map((a) => a.p);
function afterPeopleChange() {
  const ps = everyone(), on = ps.filter((p) => p.live && p.online).length + (me ? 1 : 0);
  $('#online span').textContent = `${on} online`; $('#online').title = `${ps.length + (me ? 1 : 0)} people on the map`;
  if (!$('#find').hidden) renderFind(false);
}
function toast(p) {
  const t = el('div', 'toast glass'), ic = el('span', 'ic'); ic.append(icon(Sparkles));
  t.append(ic, el('b', '', p.name), document.createTextNode(` just joined in ${districtById[p.area]?.name || 'the city'}`));
  $('#toasts').append(t);
  gsap.fromTo(t, { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(2)' });
  gsap.to(t, { opacity: 0, y: -8, delay: 4, duration: 0.4, onComplete: () => t.remove() });
}
if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
  import('./dev/samples.js').then(({ SAMPLES }) => { for (const p of SAMPLES) upsert({ ...p, live: false }, false); afterPeopleChange(); });
}

// world labels: neighbourhoods (when zoomed out) and landmarks
const places = [
  ...DISTRICTS.map((d) => ({ x: d.x, z: d.z, y: 28, name: d.name, cls: 'dl', far: true })),
  ...LANDMARKS.map((l) => ({ x: l.x, z: l.z, y: l.y + (l.type === 'cyber' ? 31 : l.type === 'thub' ? 15 : 8), name: l.name, cls: 'dl lm' })),
  ...LAKES.concat(PARKS).map((l) => ({ x: l.x, z: l.z, y: 3, name: l.name, cls: 'dl lm' })),
].map((s) => { s.lab = el('div', s.cls, s.name); s.lab.style.display = 'none'; labels.append(s.lab); return s; });

// ------------------------------------------------------------ my avatar
const ARCH = [
  { id: 'designer', name: 'Designer', line: 'Pushes pixels until they behave.', role: 'Product Designer', look: { outfit: 'tee', top: '#e2574c', hair: 'bun', glasses: true, accent: '#ffb81c' }, bg: '#5a2b3a' },
  { id: 'engineer', name: 'Engineer', line: 'Ships at 2 a.m., fixes at 9.', role: 'Software Engineer', look: { outfit: 'hoodie', top: '#2aa6b8', hair: 'short', headphones: true, lanyard: true, accent: '#ffb81c' }, bg: '#1f4a55' },
  { id: 'founder', name: 'Founder', line: 'Pitching, even in the lift.', role: 'Founder', look: { outfit: 'shirt', top: '#f4f1e6', hair: 'side', accent: '#2f6fb5' }, bg: '#2a3350' },
  { id: 'product', name: 'Product', line: 'Has a doc for that.', role: 'Product Manager', look: { outfit: 'kurta', top: '#e8c76a', hair: 'long', accent: '#b5523a' }, bg: '#5a4a1f' },
  { id: 'data', name: 'Data & AI', line: 'Trusts the eval, not the vibe.', role: 'ML Engineer', look: { outfit: 'shirt', top: '#3f6f8a', hair: 'short', glasses: true, beard: true, lanyard: true, accent: '#f4f1e6' }, bg: '#1f3a4a' },
  { id: 'maker', name: 'Maker', line: 'Solders first, reads later.', role: 'Hardware Engineer', look: { outfit: 'tee', top: '#3d7d5a', hair: 'cap', backpack: true, legs: 'shorts', accent: '#e8891a' }, bg: '#24452f' },
  { id: 'student', name: 'Student', line: 'Here for the hackathon biryani.', role: 'Student Developer', look: { outfit: 'hoodie', top: '#f2c230', hair: 'curly', backpack: true, accent: '#2aa6b8' }, bg: '#4a4538' },
  { id: 'investor', name: 'Investor', line: 'Will ask about your moat.', role: 'Investor', look: { outfit: 'suit', top: '#232b3d', hair: 'side', hairColor: '#9a9590', accent: '#e2574c' }, bg: '#1f3555' },
];
const BASE_LOOK = { skin: SKIN[2], hairColor: HAIRCOL[0], bottom: BOTTOMS[0], accent: ACCENTS[1], legs: 'pants', glasses: false, headphones: false, backpack: false, beard: false, lanyard: false };
const lookFor = (id, keep = {}) => ({ ...BASE_LOOK, skin: keep.skin || BASE_LOOK.skin, beard: !!keep.beard, ...ARCH.find((a) => a.id === id).look });
const GHOST = { ...BASE_LOOK, outfit: 'hoodie', top: '#fff', hair: 'short' };

const newAvatar = (look, ghost) => makeCharacterAvatar(scene, look, ghost, () => makeAvatar(scene, look, ghost));
let avatar = newAvatar(GHOST, true);
function setAvatar(look, ghost) { avatar.dispose(); avatar = newAvatar(look, ghost); }
const meLab = el('div', 'pl me'); meLab.style.display = 'none'; labels.append(meLab);
const meO = { lab: meLab, shown: false };

function refreshMe() {
  if (!editing) setAvatar(me ? me.look : GHOST, !me);
  gate?.refresh();
  renderStatus();
  afterPeopleChange();
}
function renderStatus() {
  const s = $('#status'); s.replaceChildren();
  if (live.connected) everConnected = true;
  const who = el('div', 'who'), badge = el('span', 'badge' + (me ? ' live' : '')), txt = el('div');
  badge.append(icon(me ? Radio : Footprints));
  let title, sub;
  if (!live.connected) { title = everConnected ? 'Offline' : 'Connecting'; sub = everConnected ? 'Reconnecting to the live map…' : 'Joining the live map…'; }
  else if (me) { title = 'You are live'; sub = `Everyone can see you in ${districtById[me.area]?.name}`; }
  else { title = 'Exploring as a guest'; sub = 'Register to meet people and stand in your block'; }
  txt.append(el('b', '', title), el('span', '', sub)); who.append(badge, txt);
  const btns = el('div', 'btns'), go = el('button', 'btn primary');
  go.append(icon(me ? Pencil : UserPlus), document.createTextNode(me ? 'Edit profile' : 'Register'), kbd('L'));
  go.onclick = join; btns.append(go);
  s.append(who, btns);
  const dj = document.querySelector('#dock [data-act="join"] span'); if (dj) dj.textContent = me ? 'Profile' : 'Join';
}

// ------------------------------------------------------------ movement
// ------------------------------------------------------------ new features
const kites = createKites(scene, { R: rng(4242), count: device.lite ? 20 : 56, half: 165 });
const guide = createWaypoint(scene, camera, { onArrive: (n) => notify(`You found ${n}. Say hi with E`) });

const startD = districtById[me?.area || 'cyber'];
const state = { x: startD.x - 6, z: startD.z + 7, yaw: Math.PI * 0.8, walk: 0, gy: 0.31, move: 0, vx: 0, vz: 0 };
// the visitor's body for wall checks: a ring of points 0.32 out from the centre
const BODY = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * 6.283) * 0.32, Math.sin((i / 8) * 6.283) * 0.32])];
// yaw/pitch follow tyaw/tpitch with damping, so mouse look glides instead of jumping
const cam = { yaw: 0.6, pitch: 0.2, tyaw: 0.6, tpitch: 0.2, ep: 0.2, dist: 3.6, eff: 3.6, tx: state.x, tz: state.z };
const CAM_MIN = 1.9, CAM_MAX = 320;
const look = { sens: 1, invert: false }; // mouse look
const lookAt = (yaw) => { cam.yaw = cam.tyaw = yaw; };
let fly = null;
function freeSpot(x, z) {
  if (!world.grid.blocked(x, z)) return [x, z];
  for (let r = 2; r < 80; r += 2) for (let a = 0; a < 6.28; a += 0.5) {
    const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (!world.grid.blocked(nx, nz)) return [nx, nz];
  }
  return [x, z];
}
function flyTo(x, z, faceX, faceZ) {
  [x, z] = freeSpot(clamp(x, -780, 780), clamp(z, -780, 780));
  const d = Math.hypot(x - state.x, z - state.z);
  if (d < 1) return;
  fly = { fx: state.x, fz: state.z, tx: x, tz: z, t: 0, dur: clamp(d / 280, 0.6, 2.2), lift: clamp(d * 0.35, 0, 160), face: faceX != null ? Math.atan2(faceX - x, faceZ - z) : null };
}

// ------------------------------------------------------------ profile card
const card = $('#card');
const avatarDot = (p) => { const av = el('div', 'av', initials(p.name)), lk = p.look || lookFromSeed(seedOf(p.id)); av.style.background = `linear-gradient(135deg, ${lk.top}, ${lk.accent || '#ff7a3d'})`; av.style.textShadow = '0 1px 3px rgba(0,0,0,0.6)'; if (p.live && p.online) av.append(el('i', 'on')); return av; };
function openCard(p) {
  openId = p.id; unlock();
  const st = STATUS[p.status], d = districtById[p.area];
  const inn = el('div', 'in');
  const close = xBtn(); close.onclick = closeCard;
  const top = el('div', 'top'), who = el('div');
  who.append(el('h3', '', p.name), el('div', 'role', [p.role, p.company].filter(Boolean).join(' · ')));
  top.append(avatarDot(p), who);
  const tags = el('div', 'tags');
  if (st) { const t = el('span', 'pill ' + p.status); t.append(document.createTextNode(st.label)); tags.append(t); }
  if (d) tags.append(el('span', 'pill area', d.name));
  if (p.live) tags.append(el('span', 'pill live', p.online ? '● Online now' : 'On the map'));
  if (p.sample) tags.append(el('span', 'pill sample', 'Sample profile'));
  inn.append(close, top, tags);
  if (!me) {
    // guests can see who someone is; their profile, links and the guide need registering
    const lock = el('div', 'lock');
    lock.append(el('b', '', `Register to connect with ${p.name.split(' ')[0]}`), el('span', '', 'See their full profile and links, and get guided to them. It takes about a minute.'));
    const reg = el('button', 'btn primary', 'Register'); reg.onclick = () => { pendingCard = p.id; closeCard(); join(); };
    const acts = el('div', 'acts'); acts.append(reg); inn.append(lock, acts);
    card.replaceChildren(inn); if (card.hidden) { card.hidden = false; slideIn(card, -24); } $('#hint').hidden = true;
    for (const a of actors.values()) if (a.sel !== (a.p.id === openId)) { a.sel = a.p.id === openId; paintLabel(a); }
    return;
  }
  if (p.bio) inn.append(el('p', 'bio', p.bio));
  if (p.skills?.length) { const sk = el('div', 'skills'); p.skills.forEach((s) => sk.append(el('span', '', s))); inn.append(sk); }
  const acts = el('div', 'acts');
  const gm = el('button', 'btn primary', 'Guide me');
  gm.onclick = () => {
    guide.set(p.name, () => { const a = actors.get(p.id); return a && { x: a.x, z: a.z, y: a.gy || 0 }; });
    closeCard(); notify(`Follow the light to ${p.name.split(' ')[0]} (G to cancel)`);
  };
  const go = el('button', 'btn', 'Jump there'); go.onclick = () => { guide.clear(); visit(p); };
  acts.append(gm, go);
  const NAMES = { linkedin: 'LinkedIn', x: 'X', site: 'Website' };
  const links = Object.entries(p.links || {}).filter(([, v]) => v).map(([k, v]) => [NAMES[k] || k, v]);
  if (!links.length && p.link) links.push(['Open link', p.link]);
  for (const [label, url] of links) if (/^https?:\/\//i.test(url)) { const a = el('a', 'btn', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; acts.append(a); }
  inn.append(acts);
  card.replaceChildren(inn); if (card.hidden) { card.hidden = false; slideIn(card, -24); } $('#hint').hidden = true;
  for (const a of actors.values()) if (a.sel !== (a.p.id === openId)) { a.sel = a.p.id === openId; paintLabel(a); }
}
function closeCard() { card.hidden = true; $('#hint').hidden = false; openId = null; for (const a of actors.values()) if (a.sel) { a.sel = false; paintLabel(a); } }
function visit(p) {
  const a = actors.get(p.id); if (!a) return;
  const pl = world.plazas[p.area] || world.plazas.cyber;
  const dx = a.x - pl.x, dz = a.z - pl.z, l = Math.hypot(dx, dz) || 1;
  flyTo(a.x - (dx / l) * 3.6, a.z - (dz / l) * 3.6, a.x, a.z);
  openCard(p);
  if (window.innerWidth < 720) $('#find').hidden = true;
}

// ------------------------------------------------------------ find someone
const find = $('#find');
const fs = { q: '', filter: 'all', area: '' };
function renderFind(focus) {
  find.replaceChildren();
  const ph = el('div', 'ph'), h = el('h2', 'd'); h.append('Find ', el('em', '', 'someone'));
  const x = xBtn(); x.onclick = () => (find.hidden = true);
  ph.append(h, x);
  const pb = el('div', 'pb');
  const q = el('input', 'field'); q.type = 'search';
  const qWrap = el('div', 'search'); qWrap.append(icon(Search), q); q.placeholder = 'Name, role, company, skill…'; q.value = fs.q;
  q.oninput = () => { fs.q = q.value; renderRows(); };
  const chips = el('div', 'chips');
  for (const [k, label, dot] of [['all', 'Everyone'], ['online', 'Online now', 'live'], ['open', 'Open to work', 'open'], ['hiring', 'Hiring', 'hiring']]) {
    const b = el('button', fs.filter === k ? 'on' : ''); if (dot) b.append(el('i', 'dot ' + dot)); b.append(label);
    b.onclick = () => { fs.filter = k; renderFind(false); }; chips.append(b);
  }
  const sel = el('select', 'field'); sel.append(new Option('All neighbourhoods', ''));
  for (const d of DISTRICTS) sel.append(new Option(d.name, d.id));
  sel.value = fs.area; sel.onchange = () => { fs.area = sel.value; renderRows(); };
  const count = el('div', 'count'), list = el('ul', 'list');
  pb.append(qWrap, chips, sel, count, list);
  find.append(ph, pb);
  function renderRows() {
    const term = fs.q.trim().toLowerCase();
    const rows = everyone().filter((p) => {
      if (fs.filter === 'online' && !(p.live && p.online)) return false;
      if ((fs.filter === 'open' || fs.filter === 'hiring') && p.status !== fs.filter) return false;
      if (fs.area && p.area !== fs.area) return false;
      if (!term) return true;
      const hay = [p.name, p.role, p.company, p.bio, (p.skills || []).join(' '), districtById[p.area]?.name].join(' ').toLowerCase();
      return term.split(/\s+/).every((t) => hay.includes(t));
    }).sort((a, b) => (b.live && b.online) - (a.live && a.online) || !!b.live - !!a.live || a.name.localeCompare(b.name));
    count.textContent = rows.length + (rows.length === 1 ? ' person' : ' people');
    list.replaceChildren(...rows.map((p) => {
      const li = el('li'), who = el('div', 'who');
      who.append(el('b', '', p.name), el('span', '', [p.role, p.company, districtById[p.area]?.name].filter(Boolean).join(' · ')));
      li.append(avatarDot(p), who);
      if (STATUS[p.status]) li.append(el('span', 'pill ' + p.status, STATUS[p.status].label));
      li.onclick = () => visit(p);
      return li;
    }));
  }
  renderRows();
  if (focus && window.innerWidth > 720) setTimeout(() => q.focus(), 30);
}
const toggleFind = (on = find.hidden) => { find.hidden = !on; if (on) { unlock(); renderFind(true); slideIn(find); } };

// ---------------------------------------------------------- join / edit
const signin = $('#signin');
const stage = { x: 0, z: 0, dx: 0, dz: 1 };
function stageAt(area) {
  const d = districtById[area] || districtById.cyber, pl = world.plazas[d.id];
  let best = null;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, x = pl.x + Math.cos(a) * 9, z = pl.z + Math.sin(a) * 9;
    // the camera sits between me and the centre; keep that line of sight clear
    const clearView = [1.5, 2.5, 3.5, 4.5].every((d) => !world.grid.blocked(x - Math.cos(a) * d, z - Math.sin(a) * d) && world.grid.height(x - Math.cos(a) * d, z - Math.sin(a) * d) < 1);
    if (!world.grid.blocked(x, z) && clearView) { best = { x, z, dx: Math.cos(a), dz: Math.sin(a) }; break; }
  }
  Object.assign(stage, best || { x: pl.x + 6, z: pl.z, dx: 1, dz: 0 });
}
function openSignin() {
  closeCard(); find.hidden = true; unlock();
  const base = me || {};
  editing = {
    arche: base.arche || 'engineer', name: base.name || '', role: base.role || '', company: base.student && base.company === 'Student' ? '' : base.company || '', area: base.area || nearestDistrict(state.x, state.z).district.id,
    student: !!base.student, status: base.status ?? 'open', bio: base.bio || '', skills: (base.skills || []).join(', '), linkedin: base.links?.linkedin || '', x: base.links?.x || '', site: base.links?.site || base.link || '', look: base.look ? { ...base.look } : lookFor('engineer'),
  };
  if (!editing.role) editing.role = ARCH.find((a) => a.id === editing.arche).role;
  stageAt(editing.area);
  document.body.classList.add('stage'); resize();
  setAvatar(editing.look, false);
  renderSignin(); updateMeLab();
  signin.hidden = false; slideIn(signin, -24);
}
function closeSignin() {
  signin.hidden = true; editing = null;
  document.body.classList.remove('stage'); resize();
  state.x = stage.x; state.z = stage.z; cam.tx = state.x; cam.tz = state.z; lookAt(Math.atan2(-stage.dx, -stage.dz) + Math.PI); cam.eff = 4;
  setAvatar(me ? me.look : GHOST, !me);
}
let lookTimer = 0;
const relook = () => { clearTimeout(lookTimer); lookTimer = setTimeout(() => setAvatar(editing.look, false), 30); };
function renderSignin() {
  const e = editing, y = signin.querySelector('.pb')?.scrollTop || 0;
  signin.replaceChildren();
  const ph = el('div', 'ph'), h = el('h2', 'd');
  h.append(me ? 'Edit your ' : 'Put yourself ', el('em', '', me ? 'profile' : 'on the map'));
  h.append(el('span', 'sub', me ? 'Changes show up for everyone straight away.' : 'Everyone walking the city will see your character, name and status, live.'));
  const x = xBtn(); x.onclick = closeSignin;
  ph.append(h, x);
  const pb = el('div', 'pb');
  const lbl = (t) => el('label', 'lbl', t);
  const field = (k, ph_, max, cls = 'field') => { const i = el('input', cls); i.type = 'text'; i.value = e[k]; i.placeholder = ph_; i.maxLength = max; i.oninput = () => { e[k] = i.value; if (k === 'name' || k === 'role') updateMeLab(); }; return i; };

  pb.append(lbl('Pick your look'));
  const tiles = el('div', 'tiles');
  for (const a of ARCH) {
    const t = el('button', 'tile' + (e.arche === a.id ? ' on' : '')); t.style.setProperty('--tb', a.bg);
    const f = el('i', 'fig'); f.style.setProperty('--c', a.look.top); f.style.setProperty('--hc', a.look.hairColor || '#1c1717');
    t.append(f, el('b', '', a.name));
    t.onclick = () => { const was = ARCH.find((x) => x.id === e.arche).role; e.arche = a.id; if (!e.role || e.role === was) e.role = a.role; e.look = lookFor(a.id, e.look); relook(); renderSignin(); updateMeLab(); };
    tiles.append(t);
  }
  const cur = ARCH.find((a) => a.id === e.arche), line = el('div', 'archLine', 'The ' + cur.name); line.append(el('span', '', cur.line));
  pb.append(tiles, line);

  pb.append(lbl('Full name'), field('name', 'Your real name', 48, 'field big'));
  const two = el('div', 'two'), c1 = el('div'), c2 = el('div');
  pb.append(lbl('Where you are'));
  const ws = el('div', 'seg');
  for (const [k, label] of [[false, 'Working at a company'], [true, 'Student']]) {
    const b = el('button', e.student === k ? 'on' : '', label);
    b.onclick = () => { e.student = k; if (k && e.company === 'Student') e.company = ''; renderSignin(); };
    ws.append(b);
  }
  pb.append(ws);
  c1.append(lbl('Role'), field('role', e.student ? 'CS student' : 'Software Engineer', 48));
  c2.append(lbl(e.student ? 'College (optional)' : 'Company'), field('company', e.student ? 'Where you study' : 'Where you work', 48));
  two.append(c1, c2); pb.append(two);

  pb.append(lbl('Status'));
  const st = el('div', 'seg status');
  for (const [k, label] of [['open', 'Open to work'], ['hiring', 'Hiring'], [null, 'Just here']]) {
    const b = el('button', (e.status === k ? 'on ' : '') + (k || ''));
    if (k) b.append(el('i', 'dot ' + k)); b.append(label);
    b.onclick = () => { e.status = k; renderSignin(); updateMeLab(); }; st.append(b);
  }
  pb.append(st);

  pb.append(lbl('Your block in Madhapur'));
  const ar = el('div', 'seg');
  for (const d of DISTRICTS) { const b = el('button', e.area === d.id ? 'on' : '', d.name); b.onclick = () => { e.area = d.id; stageAt(d.id); renderSignin(); }; ar.append(b); }
  pb.append(ar);

  pb.append(lbl('Tagline'), field('bio', 'What are you building, or looking for?', 140));
  pb.append(lbl('Skills'), field('skills', 'React, Figma, Go — comma separated', 90));
  pb.append(lbl('LinkedIn'), field('linkedin', 'linkedin.com/in/your-name', 200), lbl('X (Twitter)'), field('x', '@yourhandle', 200), lbl('Website'), field('site', 'yoursite.com', 200));

  const sw = (title, list, key) => {
    const s = el('div', 'sw');
    for (const c of list) { const b = el('button', e.look[key] === c ? 'on' : ''); b.style.background = c; b.title = title; b.onclick = () => { e.look = { ...e.look, [key]: c }; relook(); renderSignin(); }; s.append(b); }
    pb.append(lbl(title), s);
  };
  sw('Skin', SKIN, 'skin');
  const hs = el('div', 'seg'); for (const hh of HAIRSTYLES) { const b = el('button', e.look.hair === hh ? 'on' : '', hh); b.onclick = () => { e.look = { ...e.look, hair: hh }; relook(); renderSignin(); }; hs.append(b); }
  pb.append(lbl('Hair'), hs);
  sw('Hair colour', HAIRCOL, 'hairColor');
  const set1 = (patch) => { e.look = { ...e.look, ...patch }; relook(); renderSignin(); };
  const segOf = (title, opts, key) => { const g = el('div', 'seg'); for (const [k, n] of opts) { const b = el('button', (e.look[key] || opts[0][0]) === k ? 'on' : '', n); b.onclick = () => set1({ [key]: k }); g.append(b); } pb.append(lbl(title), g); };
  segOf('Outfit', OUTFITS, 'outfit');
  const tops = e.look.outfit === 'suit' ? SUITS : e.look.outfit === 'kurta' ? KURTAS : TOPS;
  sw(e.look.outfit === 'suit' ? 'Suit colour' : e.look.outfit === 'kurta' ? 'Kurta colour' : 'Top colour', tops, 'top');
  if (e.look.outfit !== 'suit' && e.look.outfit !== 'kurta') segOf('Bottoms', [['pants', 'Trousers'], ['shorts', 'Shorts']], 'legs');
  sw('Bottoms colour', BOTTOMS, 'bottom');
  sw(e.look.outfit === 'suit' ? 'Tie colour' : 'Accent colour', ACCENTS, 'accent');
  const ex = el('div', 'seg'); for (const [k, n] of [['glasses', 'Glasses'], ['beard', 'Beard'], ['headphones', 'Headphones'], ['lanyard', 'ID lanyard'], ['backpack', 'Backpack']]) { const b = el('button', e.look[k] ? 'on' : '', n); b.onclick = () => { e.look = { ...e.look, [k]: !e.look[k] }; relook(); renderSignin(); }; ex.append(b); }
  pb.append(lbl('Extras'), ex);
  pb.append(el('div', 'note', 'Sign-in and curator approval come later. For now your profile is tied to this browser and shows to everyone on this server.'));

  const pf = el('div', 'pf'), err = el('span', 'err');
  if (me) { const leave = el('button', 'btn', 'Leave map'); leave.onclick = async () => { await live.leave(); me = null; closeSignin(); refreshMe(); gate.show(-1); }; pf.append(leave); }
  pf.append(err);
  const go = el('button', 'btn primary big'); go.append(me ? 'Save' : 'Go live', kbd('↵'));
  go.onclick = async () => {
    const profile = { name: e.name, role: e.role, student: !!e.student, company: e.company.trim() || (e.student ? 'Student' : ''), area: e.area, status: e.status, bio: e.bio, skills: e.skills.split(',').map((s) => s.trim()).filter(Boolean), links: { linkedin: normaliseLinkedIn(e.linkedin), x: normaliseX(e.x), site: normaliseSite(e.site) }, look: e.look };
    if (profile.name.trim().length < 2) return (err.textContent = 'Add your name.');
    if (profile.role.trim().length < 2) return (err.textContent = 'Add your role.');
    if (!profile.student && profile.company.length < 2) return (err.textContent = 'Add your company, or pick Student.');
    go.disabled = true; err.textContent = '';
    try { me = { ...(await live.save(profile)), arche: e.arche }; closeSignin(); refreshMe(); }
    catch (ex2) { err.textContent = ex2.message; go.disabled = false; }
  };
  pf.append(go);
  signin.append(ph, pb, pf);
  signin.querySelector('.pb').scrollTop = y;
  signin.onkeydown = (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') go.click(); };
}
function updateMeLab() {
  if (!editing) return;
  const st = STATUS[editing.status];
  const card = el('div', 'card'), ava = el('div', 'ava', initials(editing.name || 'You')), txt = el('div');
  ava.style.background = `linear-gradient(135deg, ${editing.look.top}, ${editing.look.accent || '#ff7a3d'})`;
  txt.append(el('div', 'nm', editing.name.trim() || 'Your name'), el('div', 'rl', [editing.role || 'Your role', editing.company].filter(Boolean).join(' · ')));
  card.append(ava, txt);
  meLab.replaceChildren(card);
  if (st) meLab.append(el('div', 'tag ' + editing.status, st.label));
}

// ------------------------------------------------- radar minimap + 3D city map
const mini = $('#mini'), mapC = $('#map'), mctx = mapC.getContext('2d');
const RB = { half: 260, px: 3 }; // the radar's base image: the whole neighbourhood at 3 px per unit
const radarBase = (() => {
  const size = Math.round(RB.half * 2 * RB.px), c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), P = (v) => (v + RB.half) * RB.px, k = RB.px;
  const bg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
  bg.addColorStop(0, '#294a45'); bg.addColorStop(1, '#13262d'); g.fillStyle = bg; g.fillRect(0, 0, size, size);
  const tint = { tech: [58, 140, 200], mixed: [226, 140, 80], residential: [128, 186, 96] };
  for (const d of DISTRICTS) {
    const [r, gg, b] = tint[d.kind], gr = g.createRadialGradient(P(d.x), P(d.z), 0, P(d.x), P(d.z), (d.r + 14) * k);
    gr.addColorStop(0, `rgba(${r},${gg},${b},0.75)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(P(d.x), P(d.z), (d.r + 14) * k, 0, 7); g.fill();
  }
  g.fillStyle = '#4f9a5a'; for (const p of PARKS) { g.beginPath(); g.arc(P(p.x), P(p.z), p.r * k, 0, 7); g.fill(); }
  for (const l of LAKES) {
    g.fillStyle = '#2f8fb0'; g.beginPath(); g.ellipse(P(l.x), P(l.z), (l.rx + 1.5) * k, (l.rz + 1.5) * k, l.rot, 0, 7); g.fill();
    g.fillStyle = '#4fb6d6'; g.beginPath(); g.ellipse(P(l.x), P(l.z), l.rx * k * 0.8, l.rz * k * 0.8, l.rot, 0, 7); g.fill();
  }
  const line = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineJoin = g.lineCap = 'round'; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke(); };
  for (const r of ROADS) { const pts = resolvePts(r.pts); line(pts, (r.w + 5) * k, '#0b1a22'); line(pts, (r.w + 3) * k, '#a99f8c'); line(pts, r.w * k, r.main ? '#ffd27a' : '#efe6d6'); }
  for (const m of METRO) { g.setLineDash([6, 5]); line(resolvePts(m.pts), 2.4 * k, '#5fb3ff'); g.setLineDash([]); }
  g.fillStyle = '#ffa45c'; for (const l of LANDMARKS) { g.beginPath(); g.arc(P(l.x), P(l.z), 3.2 * k, 0, 7); g.fill(); }
  g.font = `700 ${Math.round(7 * k)}px Rajdhani, sans-serif`; g.textAlign = 'center'; g.lineWidth = 5; g.strokeStyle = 'rgba(11,26,34,0.9)'; g.fillStyle = '#ffffff';
  for (const d of DISTRICTS) { const n = d.name.toUpperCase(); g.strokeText(n, P(d.x), P(d.z) - 14 * k); g.fillText(n, P(d.x), P(d.z) - 14 * k); g.fillStyle = '#ff7a3d'; g.beginPath(); g.arc(P(d.x), P(d.z), 4 * k, 0, 7); g.fill(); g.fillStyle = '#ffffff'; }
  return c;
})();
const nMark = el('span', 'n', 'N'); mini.append(nMark);
function sizeRadar() { const px = Math.round(184 * Math.min(window.devicePixelRatio || 1, 2)); if (mapC.width !== px) mapC.width = mapC.height = px; }
// heading-up radar: the map turns with the camera, so "up" is always where I'm looking
function drawRadar() {
  const s = mapC.width, r = s / 2, q = s / 184, zoom = q * 1.25; // 1.25 css px per world unit: about 75 m either way
  mctx.clearRect(0, 0, s, s);
  mctx.save();
  mctx.beginPath(); mctx.arc(r, r, r, 0, 7); mctx.clip();
  mctx.translate(r, r); mctx.rotate(cam.yaw); mctx.scale(zoom / RB.px, zoom / RB.px);
  mctx.translate(-(state.x + RB.half) * RB.px, -(state.z + RB.half) * RB.px);
  mctx.drawImage(radarBase, 0, 0);
  const u = (RB.px / zoom) * q;
  for (const a of actors.values()) {
    if (Math.abs(a.x - state.x) > 70 || Math.abs(a.z - state.z) > 70) continue;
    mctx.fillStyle = STATUS[a.p.status]?.color || '#f6efe4'; mctx.strokeStyle = '#0b1a22'; mctx.lineWidth = 1.5 * u;
    mctx.beginPath(); mctx.arc((a.x + RB.half) * RB.px, (a.z + RB.half) * RB.px, 4 * u, 0, 7); mctx.fill(); mctx.stroke();
  }
  mctx.restore();
  // range rings, and my arrow pointing the way I face relative to the camera
  mctx.strokeStyle = 'rgba(255,255,255,0.12)'; mctx.lineWidth = 1;
  for (const f of [0.33, 0.66]) { mctx.beginPath(); mctx.arc(r, r, r * f, 0, 7); mctx.stroke(); }
  mctx.save(); mctx.translate(r, r); mctx.rotate(Math.PI - state.yaw + cam.yaw);
  mctx.fillStyle = '#ff7a3d'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2 * q;
  mctx.beginPath(); mctx.moveTo(0, -11 * q); mctx.lineTo(8 * q, 8 * q); mctx.lineTo(0, 3 * q); mctx.lineTo(-8 * q, 8 * q); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
  const nr = 80; // the north marker rides the rim
  nMark.style.transform = `translate(${(Math.sin(cam.yaw) * nr).toFixed(1)}px, ${(-Math.cos(cam.yaw) * nr).toFixed(1)}px)`;
  compassSvg.style.transform = `rotate(${((cam.yaw * 180) / Math.PI).toFixed(1)}deg)`;
}
const compassSvg = $('#area .compass svg') || el('i');
mini.addEventListener('click', () => setMap(true));

// 3D city map: fly the camera up into an aerial view you can pan, tilt and zoom; click to travel
const mapUI = $('#mapUI');
let mapMode = false, mapControls = null, mapReady = false;
const ray = new THREE.Raycaster(), ground0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function setMap(on) {
  if (on === mapMode) return;
  mapMode = on; mapReady = false;
  document.body.classList.toggle('mapping', on); mapUI.hidden = !on;
  if (on) {
    unlock(); closeCard(); find.hidden = true; keys.clear();
    if (!mapControls) {
      mapControls = new MapControls(camera, canvas);
      Object.assign(mapControls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, maxPolarAngle: 1.2, minDistance: 35, maxDistance: 560 });
    }
    mapControls.enabled = false;
    const tgt = new THREE.Vector3(state.x * 0.5, 0, state.z * 0.5), from = camera.position.clone();
    const to = new THREE.Vector3(state.x * 0.5 + 70, 250, state.z * 0.5 + 190), look = new THREE.Vector3(cam.tx, 1.6, cam.tz), o = { k: 0 };
    gsap.to(o, {
      k: 1, duration: 1.5, ease: 'power3.inOut',
      onUpdate: () => { camera.position.lerpVectors(from, to, o.k); camera.lookAt(look.clone().lerp(tgt, o.k)); },
      onComplete: () => { mapControls.target.copy(tgt); mapControls.enabled = true; mapControls.update(); mapReady = true; },
    });
    gsap.fromTo('#mapUI .glass', { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, delay: 0.4 });
  } else {
    if (mapControls) mapControls.enabled = false;
    // hand the camera back to the follow rig from where it is, so it glides down
    const off = camera.position.clone().sub(new THREE.Vector3(cam.tx, 0, cam.tz));
    lookAt(Math.atan2(off.x, off.z)); cam.eff = Math.min(300, off.length()); cam.ep = clamp(Math.atan2(off.y, Math.hypot(off.x, off.z)), 0.1, 1.4);
  }
}
$('#mapClose').onclick = () => setMap(false);

// ------------------------------------------------------------------ pause menu
const pauseEl = $('#pause');
let paused = false;
function notify(msg) { const t = el('div', 'toast info glass'), ic = el('span', 'ic'); ic.append(icon(Info)); t.append(ic, el('span', '', msg)); $('#toasts').append(t); gsap.fromTo(t, { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }); gsap.to(t, { opacity: 0, delay: 4, duration: 0.4, onComplete: () => t.remove() }); }
function setPause(on) {
  paused = on; pauseEl.hidden = !on; document.body.classList.toggle('paused', on);
  if (on) { unlock(); keys.clear(); renderPause(); gsap.fromTo('.pz', { scale: 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power2.out' }); }
}
function renderPause() {
  const box = el('div', 'pz glass'), L = el('div', 'pzL'), Rt = el('div', 'pzR');
  L.append(el('small', 'd', `${CITY} · ${HOOD}`), el('h1', 'd', 'Paused'));
  const item = (label, k, fn, primary) => { const b = el('button', 'pzItem d' + (primary ? ' on' : '')); b.append(el('span', '', label), kbd(k)); b.onclick = fn; L.append(b); };
  item('Resume', 'Esc', () => setPause(false), true);
  item(me ? 'Edit my profile' : 'Register to meet people', 'L', () => { setPause(false); join(); });
  const live2 = el('div', 'pzLive'); const ps = everyone(); live2.append(el('i', 'dot live'), document.createTextNode(`${ps.filter((p) => p.live && p.online).length + (me ? 1 : 0)} online · ${ps.length + (me ? 1 : 0)} ${ps.length + (me ? 1 : 0) === 1 ? 'person' : 'people'} on the map`));
  L.append(live2);

  Rt.append(el('h4', 'd', 'Controls'));
  const ctl = el('div', 'ctl');
  // only controls that work on this device: touch gestures on phones and tablets, keys on computers
  const touch = matchMedia('(pointer: coarse)').matches;
  const rows = touch
    ? [['Joystick', 'Walk (push further to run)'], ['Drag', 'Look around'], ['Pinch', 'Camera closer / further'], ['Say hi', 'Tap it near someone to meet them'], ['Photo', 'Photo mode']]
    : [['W A S D', 'Walk (or the arrow keys)'], ['Shift', 'Run'], ['Click', 'Look around (Esc to free the mouse)'], ['Wheel', 'Camera closer / further'], ['E', 'Meet someone nearby'], ['P', 'Photo mode (Space to shoot)'], ['L', me ? 'Edit my profile' : 'Register'], ['Esc', 'Pause']];
  for (const [k, what] of rows) { const r = el('div'); r.append(kbd(k), el('span', '', what)); ctl.append(r); }
  Rt.append(ctl);
  box.append(L, Rt);
  pauseEl.replaceChildren(box);
}
pauseEl.addEventListener('click', (e) => { if (e.target === pauseEl) setPause(false); });
photo = createPhoto({
  post, notify,
  onToggle: (on) => { if (on) { closeCard(); find.hidden = true; } },
});

// ------------------------------------------------------------------- input
const keys = new Set();
const joy = { x: 0, y: 0 };
let near = null;
window.addEventListener('keydown', (e) => {
  if (gate?.open) return;
  if (e.key === 'Escape' && photo.on) { photo.toggle(false); return; }
  if (e.key === 'Escape') { if (paused) setPause(false); else if (editing) closeSignin(); else if (mapMode) setMap(false); else if (!card.hidden) closeCard(); else if (!find.hidden) find.hidden = true; else setPause(true); return; }
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '') || editing || paused) return;
  if (mapMode && e.key.toLowerCase() !== 'm') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'e' && near) openCard(near.p);
  if (k === 'f') { e.preventDefault(); toggleFind(); }
  if (k === 'm') setMap(!mapMode);
  if (k === 'l') join();
  if (k === 'p') photo.toggle();
  if (k === ' ' && photo.on) photo.shoot();
  if (k === 'g' && guide.active) { guide.clear(); notify('Guide cleared'); }
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
$('#prompt').onclick = () => near && openCard(near.p);
$('#dock').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  ({ find: () => toggleFind(), map: () => setMap(!mapMode), join: () => join(), menu: () => setPause(true), photo: () => photo.toggle() })[b.dataset.act]?.();
});

const ptrs = new Map();
let pinch = 0;
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; downAt = [e.clientX, e.clientY, e.pointerType]; });
// a plain click locks the mouse for game-style looking; Esc releases it
canvas.addEventListener('click', (e) => {
  if (mapMode) { // click on the 3D map to travel there
    if (!mapReady || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1), camera);
    if (ray.ray.intersectPlane(ground0, hit)) { setMap(false); flyTo(hit.x, hit.z); }
    return;
  }
  if (!downAt || downAt[2] !== 'mouse' || editing || paused || document.pointerLockElement) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 8) lockPointer();
});
function lockPointer() {
  const raw = () => { try { const r = canvas.requestPointerLock(); r?.catch?.(() => {}); } catch { /* not supported */ } };
  try {
    // unadjustedMovement: raw mouse counts, no OS acceleration (Chrome, Edge)
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r?.catch) r.catch(raw);
  } catch { raw(); }
}
let lockFresh = 0; // the first events after locking can carry a bogus jump
const turn = (dx, dy, k) => {
  cam.tyaw -= dx * k * look.sens;
  cam.tpitch = clamp(cam.tpitch + dy * k * 0.8 * look.sens * (look.invert ? -1 : 1), -0.38, 1.3);
};
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || editing || paused) return;
  if (lockFresh > 0) { lockFresh--; if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return; }
  turn(e.movementX, e.movementY, 0.0024);
});
let quietUnlock = false;
const unlock = () => { if (document.pointerLockElement) { quietUnlock = true; document.exitPointerLock(); } };
document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  if (on) lockFresh = 2;
  document.body.classList.toggle('locked', on);
  if (!on && !quietUnlock && !editing && !paused) setPause(true); // Esc while looking opens the menu, like a game
  quietUnlock = false;
});
const hoverNdc = new THREE.Vector2(9, 9);
canvas.addEventListener('pointermove', (e) => {
  hoverNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const p = ptrs.get(e.pointerId); if (!p || editing || mapMode || document.pointerLockElement) return;
  if (ptrs.size === 1) turn(e.clientX - p[0], e.clientY - p[1], e.pointerType === 'mouse' ? 0.0042 : 0.006);
  p[0] = e.clientX; p[1] = e.clientY;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) cam.dist = clamp(cam.dist * (pinch / d), CAM_MIN, CAM_MAX);
    pinch = d;
  }
});
const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!editing && !mapMode) cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), CAM_MIN, CAM_MAX); }, { passive: false });

const stick = $('#stick'), knob = stick.firstElementChild;
const stickMove = (e) => {
  const r = stick.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  joy.x = x; joy.y = -y; knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
};
stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); stickMove(e); });
stick.addEventListener('pointermove', (e) => { if (stick.hasPointerCapture(e.pointerId)) stickMove(e); });
const stickEnd = () => { joy.x = joy.y = 0; knob.style.transform = ''; };
stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);

// -------------------------------------------------------------------- loop
const v = new THREE.Vector3();
const project = (x, y, z) => { v.set(x, y, z).project(camera); return v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2; };
const put = (lab, s, o = 1) => { lab.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`; lab.style.opacity = o.toFixed(2); };
const show = (o, on) => { if (o.shown !== on) { o.shown = on; o.lab.style.display = on ? '' : 'none'; } };

let autoQ = true;
let last = performance.now(), ema = 16, frames = 0, mapT = 0, timeT = 0, whereKey = '';
const cand = [];
const obstacles = [];
const hoverRay = new THREE.Raycaster(), seg = new THREE.Vector3(), segB = new THREE.Vector3();
// is the mouse over someone? a capsule test along their body, no mesh raycast needed
const hovered = (a) => {
  if (document.pointerLockElement || hoverNdc.x > 2) return false;
  hoverRay.setFromCamera(hoverNdc, camera);
  seg.set(a.x, (a.gy ?? 0) + 0.15, a.z); segB.set(a.x, (a.gy ?? 0) + 1.7, a.z);
  return hoverRay.ray.distanceSqToSegment(seg, segB) < 0.35 * 0.35;
};
function frame(now) {
  requestAnimationFrame(frame);
  const prev = last, dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  surfaceUniforms.uTime.value = t % 1000;
  ema += (dt * 1000 - ema) * 0.05;
  if (++frames % 240 === 0 && ema > 19.5 && !document.hidden && autoQ) { // aim for ~55+ fps: step quality down if frames run long
    const next = post.level === 'high' ? 'medium' : post.level === 'medium' ? 'low' : null;
    if (next) { post.setLevel(next); resize(); notify(`Graphics set to ${QUALITY[next].label} for smoother play`); }
  }
  if (now - timeT > 20000) { timeT = now; tickTime(); }

  let dist, running = false, moving = 0;
  const city = !editing && !mapMode;
  if (mapMode) {
    if (mapReady) mapControls.update();
    dist = camera.position.distanceTo(mapReady ? mapControls.target : new THREE.Vector3(state.x, 0, state.z));
    aimSun(mapReady ? mapControls.target.x : state.x, mapReady ? mapControls.target.z : state.z, 260);
  } else if (editing) {
    // turntable: my character faces the camera while I edit
    const f = Math.min(1, dt * 4);
    state.x += (stage.x - state.x) * f; state.z += (stage.z - state.z) * f;
    state.yaw = Math.atan2(-stage.dx, -stage.dz) + Math.sin(t * 0.6) * 0.45;
    camera.position.set(state.x - stage.dx * 4.1, 1.72, state.z - stage.dz * 4.1);
    camera.lookAt(state.x, 1.18, state.z);
    cam.tx = state.x; cam.tz = state.z; dist = 6;
    aimSun(state.x, state.z, 60);
  } else {
    let lift = 0;
    if (fly) {
      fly.t += Math.min(0.25, (now - prev) / 1000) / fly.dur;
      const k = Math.min(1, fly.t), e = k * k * (3 - 2 * k);
      state.x = fly.fx + (fly.tx - fly.fx) * e; state.z = fly.fz + (fly.tz - fly.fz) * e;
      lift = Math.sin(k * Math.PI) * fly.lift;
      if (k >= 1) { if (fly.face != null) { state.yaw = fly.face; lookAt(fly.face + Math.PI); } fly = null; }
    } else {
      let ix = 0, iy = 0;
      if (!paused) {
        ix = joy.x; iy = joy.y;
        if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
        if (keys.has('d') || keys.has('arrowright')) ix += 1;
        if (keys.has('w') || keys.has('arrowup')) iy += 1;
        if (keys.has('s') || keys.has('arrowdown')) iy -= 1;
      }
      const l = Math.hypot(ix, iy);
      if (l > 1) { ix /= l; iy /= l; }
      running = (keys.has('shift') || Math.hypot(joy.x, joy.y) > 0.92) && l > 0.08; // Shift, or the joystick pushed to its edge
      // ease the velocity towards where the keys point: no instant starts or stops
      const top = running ? 15 : 6, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      const wantX = l > 0.08 ? (cy * ix - sy * iy) * top : 0, wantZ = l > 0.08 ? (-sy * ix - cy * iy) * top : 0;
      const acc = 1 - Math.exp(-(l > 0.08 ? 10 : 14) * dt);
      state.vx += (wantX - state.vx) * acc; state.vz += (wantZ - state.vz) * acc;
      const speed = Math.hypot(state.vx, state.vz);
      if (speed > 0.05) {
        const dx = state.vx * dt, dz = state.vz * dt, g = world.grid;
        const body = (x, z) => BODY.some(([ox, oz]) => g.blocked(x + ox, z + oz));
        if (!body(state.x + dx, state.z)) state.x += dx; else state.vx *= 0.3;
        if (!body(state.x, state.z + dz)) state.z += dz; else state.vz *= 0.3;
        state.x = clamp(state.x, -BOUNDS + 4, BOUNDS - 4); state.z = clamp(state.z, -BOUNDS + 4, BOUNDS - 4);
        // people and props are solid: slide around anyone or anything in the way
        const ox = state.x, oz = state.z;
        const bump = (o, m) => { const ex = state.x - o.x, ez = state.z - o.z, d = Math.hypot(ex, ez); if (d < m && d > 0.0001) { state.x = o.x + (ex / d) * m; state.z = o.z + (ez / d) * m; } };
        for (const a of actors.values()) if (Math.abs(a.x - state.x) < 2 && Math.abs(a.z - state.z) < 2) bump(a, 0.95);
        for (const w of walkers.near(state.x, state.z, 2)) bump(w, 0.95);
        world.props.near(state.x, state.z, (o) => bump(o, o.r + 0.34));
        if (body(state.x, state.z)) { state.x = ox; state.z = oz; }
        let dy = Math.atan2(state.vx, state.vz) - state.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        state.yaw += dy * (1 - Math.exp(-11 * dt));
        state.walk += dt * speed * 1.45; moving = Math.min(1.25, speed / 6);
        if (!moved && l > 0.08) { moved = true; setTimeout(() => $('#hint').classList.add('dim'), 7000); }
      }
    }
    const damp = (k) => 1 - Math.exp(-k * dt);
    let dyaw = cam.tyaw - cam.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    cam.yaw += dyaw * damp(38); cam.pitch += (cam.tpitch - cam.pitch) * damp(38);
    const f = damp(9);
    cam.tx += (state.x - cam.tx) * f; cam.tz += (state.z - cam.tz) * f;
    // keep me in view: tilt over buildings first, then pull in
    const clear = (pitch, d0) => {
      const c = Math.cos(pitch), s = Math.sin(pitch), ax = Math.sin(cam.yaw) * c, az = Math.cos(cam.yaw) * c;
      for (let d = 1; d <= d0 + 0.5; d += 1) {
        const x = cam.tx + ax * d, z = cam.tz + az * d, y = 1.7 + s * d;
        // only cells a building actually stands on (the height map also spills over footpaths)
        if ((world.grid.get(x, z) & 4) && world.grid.height(x, z) + 0.6 > y) return false;
        // tree trunks, carts and pillars too (lamp posts are thin enough to ignore)
        let hitProp = false;
        if (d > 1.5 && y < 4.5) world.props.near(x, z, (o) => { if (o.r >= 0.25 && (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 0.35) ** 2) hitProp = true; });
        if (hitProp) return false;
      }
      return true;
    };
    // close in when something is in the way, before tilting up over it
    let want = cam.dist + lift, wp = cam.pitch;
    for (let k = 0; k < 12 && want > CAM_MIN && !clear(wp, want); k++) want *= 0.82;
    while (wp < 1.2 && !clear(wp, want)) wp += 0.08;
    cam.eff += (want - cam.eff) * Math.min(1, dt * (want < cam.eff ? 14 : 4));
    // a little below zero looks up at the skyline from near the ground
    cam.ep += (wp - cam.ep) * Math.min(1, dt * 12);
    dist = cam.eff;
    const cp = Math.cos(cam.ep), sp_ = Math.sin(cam.ep);
    // over-the-shoulder: the view sits a little to the right of me when close
    const shoulder = 0.55 * clamp((7 - dist) / 4, 0, 1), rx = Math.cos(cam.yaw) * shoulder, rz = -Math.sin(cam.yaw) * shoulder;
    const lookY = state.gy + 1.5 + clamp(dist - 8, 0, 60) * 0.02;
    camera.position.set(cam.tx + rx + Math.sin(cam.yaw) * cp * dist, Math.max(state.gy + 0.35, lookY + 0.15 + sp_ * dist), cam.tz + rz + Math.cos(cam.yaw) * cp * dist);
    camera.lookAt(cam.tx + rx, lookY, cam.tz + rz);
    aimSun(cam.tx, cam.tz, clamp(40 + dist * 1.5, 50, 340));
  }
  scene.fog.near = mapMode ? 520 : 70 + dist * 1.6; scene.fog.far = mapMode ? 1300 : 420 + dist * 3;
  kites.update(dt, t, night, 0);
  guide.update(dt, t, state, W, H);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  fill.position.set(state.x * 0.6 + camera.position.x * 0.4, 5.5, state.z * 0.6 + camera.position.z * 0.4);
  clouds.position.x = ((t * 3) % 400) - 200;

  state.move += (moving - state.move) * (1 - Math.exp(-10 * dt)); // blend between standing and walking
  state.gy += (world.groundAt(state.x, state.z) - state.gy) * Math.min(1, dt * 12); // step smoothly onto kerbs and squares
  avatar.place(state.x, state.gy, state.z, state.yaw, state.walk, state.move, t);

  obstacles.length = 0;
  obstacles.push({ x: state.x, z: state.z });
  for (const a of actors.values()) if (Math.abs(a.x - state.x) < 160 && Math.abs(a.z - state.z) < 160) obstacles.push(a);
  CharacterCrowd.eye.copy(camera.position);
  walkers.update(dt, t, state.x, state.z, city ? 0 : 9, obstacles);
  metro.update(dt, night);

  // people: idle, turn to face me and wave when I come close; float names over the nearest
  near = null; let nd = 25;
  cand.length = 0;
  const reach = clamp(40 + dist * 3, 45, 360);
  for (const a of actors.values()) {
    const dx = state.x - a.x, dz = state.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 < 200 * 200) {
      // turn to face me when I'm within 7 units
      const facing = city && d2 < 49;
      const toMe = Math.atan2(dx, dz);
      let want = facing ? toMe : a.base;
      let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += dy * Math.min(1, dt * 5);
      // wave once, briefly, when I walk right up (within ~4.5 units); again only after I've walked away
      if (city && !fly && d2 < 20 && !a.greeted) { a.greeted = true; a.waveT = 2.4; }
      if (d2 > 144) a.greeted = false;
      a.waveT = Math.max(0, (a.waveT || 0) - dt);
      a.wave = clamp((a.wave || 0) + (a.waveT > 0 ? dt * 4 : -dt * 3), 0, 1);
      let hy = 0; // the head leads the body when someone turns to look at me
      if (facing) { hy = toMe - a.yaw; hy = clamp(Math.atan2(Math.sin(hy), Math.cos(hy)), -0.9, 0.9) || 0.0001; }
      if (!city && d2 < 64) crowd.hide(a.idx);
      else {
        // glow softly when I'm close or the mouse is over them
        const want = city && d2 < 400 && (d2 < 12 || hovered(a)) ? 1 : 0;
        a.hi = (a.hi || 0) + (want - (a.hi || 0)) * Math.min(1, dt * 6);
        crowd.highlight(a.idx, a.hi);
        crowd.set(a.idx, a.x, a.gy ?? 0, a.z, a.yaw, 0, 0, a.wave, t + a.ph, 1, hy);
      }
    }
    if (city && d2 < nd) { nd = d2; near = a; }
    a.d2 = d2;
    if (mapMode || (city && d2 < reach * reach)) cand.push(a); else show(a, false);
  }
  crowd.commit();
  cand.sort((a, b) => a.d2 - b.d2);
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  for (let i = 0; i < cand.length; i++) {
    const a = cand[i], ok = (mapMode || i < 20) && project(a.x, 2.25, a.z);
    show(a, ok);
    if (ok) {
      const cd = Math.hypot(a.x - cx, 2.2 - cy, a.z - cz);
      if (mapMode) put(a.lab, 1, 1); else put(a.lab, clamp(13 / cd, 0.42, 1.05), clamp(1.4 - cd / reach, 0.35, 1));
      a.lab.style.zIndex = a.p.id === openId || a === near ? 5 : String(Math.round(1000 - cd));
    }
  }
  for (const s of places) {
    const d = Math.hypot(s.x - cam.tx, s.z - cam.tz);
    const ok = mapMode ? s.far && project(s.x, 30, s.z) : city && (s.far ? dist > 45 && d < 400 + dist * 2 : d < 140 && dist < 70) && project(s.x, s.y + (s.far ? dist * 0.05 : 0), s.z);
    show(s, ok); if (ok) put(s.lab, mapMode ? 1 : s.far ? clamp(140 / Math.max(dist, 60), 0.6, 1) : 1);
  }
  const okMe = !city && project(state.x, 2.25, state.z);
  show(meO, okMe); if (okMe) put(meLab, 1.05);

  selRing.visible = city && !!near && !fly;
  if (selRing.visible) { selRing.position.set(near.x, (near.gy ?? 0) + 0.06, near.z); selRing.rotation.y = t * 1.6; }
  const pr = $('#prompt');
  if (city && near && !fly && openId !== near.p.id) { if (pr.hidden || pr.dataset.id !== near.p.id) { pr.dataset.id = near.p.id; pr.replaceChildren(kbd('E'), el('span', '', 'Say hi to ' + near.p.name.split(' ')[0])); pr.hidden = false; } }
  else pr.hidden = true;
  document.body.classList.toggle('prompting', !pr.hidden);

  if (city) drawRadar();
  if (city && now - mapT > 120) {
    mapT = now;
    const nr = nearestDistrict(state.x, state.z), rd = nearestRoad(state.x, state.z);
    const chip = nr.ratio < 0.9 ? nr.district.name : rd.dist < 12 ? rd.road.name : 'Near ' + nr.district.name;
    const key = HOOD + '|' + chip;
    if (key !== whereKey) { whereKey = key; const [a, b] = key.split('|'); $('#areaName').textContent = a; $('#spot span').textContent = b; $('#spot').hidden = !b; gsap.fromTo('#areaName', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 }); }
  }
  // the landing page floats over a slow flight around the main junction; on the way in,
  // the camera swoops from that flight down to my shoulder
  if (gate?.landing) {
    const pl = world.plazas[MAIN], a = now * 0.00004 + 2.2, r = device.lite ? 70 : 82;
    camera.position.set(pl.x + Math.cos(a) * r, 30 + Math.sin(now * 0.00011) * 4, pl.z + Math.sin(a) * r);
    camera.lookAt(pl.x - Math.sin(a) * 18, 4, pl.z + Math.cos(a) * 18);
    scene.fog.near = 160; scene.fog.far = 720;
    swoop = { t0: 0, from: camera.position.clone(), q: camera.quaternion.clone() };
  } else if (swoop) {
    swoop.t0 ||= now;
    const k = Math.min(1, (now - swoop.t0) / 1700), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(swoop.from, camera.position, e);
    camera.quaternion.slerpQuaternions(swoop.q, camera.quaternion, e);
    if (k >= 1) swoop = null;
  }
  // a registration form covers everything: no need to draw the city behind it
  if (!(cityWarm && gate?.open && !gate.landing)) post.render(t);
}

// -------------------------------------------------------------------- boot
resize(); sizeRadar(); tickTime(); renderStatus(); afterPeopleChange();
window.addEventListener('resize', sizeRadar);
live.restore().finally(() => live.connect());
requestAnimationFrame(frame);
const MAIN = 'cyber'; // Cyber Towers Circle: the junction everyone gives directions from, where everyone arrives
// Nobody walks into a half-built city: wait for the textures and the characters, put
// the camera where visitors arrive, and compile every shader the first view needs
// (a first frame that compiles them all is a long freeze, worst on phones).
const cityReady = (async () => {
  const slow = new Promise((r) => setTimeout(r, 30000)); // a stalled download must not lock people out
  await Promise.race([Promise.allSettled([surfacesReady, loadCharacterLib()]), slow]);
  await new Promise((r) => setTimeout(r, 60)); // characters are added just after their models arrive
  const pl = world.plazas[MAIN];
  camera.position.set(pl.x + 8, 1.7, pl.z + 15.6); camera.lookAt(pl.x, 1.4, pl.z); camera.updateMatrixWorld();
  // compile every shader the scene uses, then wait for the driver to finish linking them
  // (three's compileAsync trips over a material disposed mid-wait, e.g. my avatar being
  // rebuilt when the server recognises this device, and then never resolves)
  try {
    renderer.compile(scene, camera);
    const until = performance.now() + 10000;
    while (performance.now() < until && !renderer.info.programs.every((pr) => { try { return pr.isReady(); } catch { return true; } })) await new Promise((r) => setTimeout(r, 30));
  } catch (e) { console.warn('shader warm-up failed', e); }
  post.render(0); // upload buffers and textures now, not on entry
  cityWarm = true;
})();

// landing page and registration. Anyone can walk in as a guest; meeting people
// (profiles, links, the guide) needs registering, which guests can do from inside.
const showHud = () => gsap.from(['#area', '#status', '#topRight > *', '#dock', '#mini'], { y: -16, opacity: 0, duration: 0.6, stagger: 0.07, delay: 0.1, ease: 'power3.out', clearProps: 'all' });
// arrive facing the plaza, with nothing (a wall, a lamp post, a tree) between the camera and me
function standAt(area) {
  const pl = world.plazas[area]; if (!pl) return;
  const clear = (x, z) => { if (world.grid.blocked(x, z) || world.grid.height(x, z) > 0.5) return false; let ok = true; world.props.near(x, z, (o) => { if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 0.6) ** 2) ok = false; }); return ok; };
  let best = { x: pl.x + 8, z: pl.z + 12 };
  for (let k = 0; k < 24; k++) {
    const a = 0.98 + (k / 24) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), x = pl.x + dx * 14, z = pl.z + dz * 14;
    if ([0, 1, 2, 3, 4.2].every((d) => clear(x + dx * d, z + dz * d))) { best = { x, z }; break; }
  }
  state.x = cam.tx = best.x; state.z = cam.tz = best.z; state.vx = state.vz = 0; lookAt(Math.atan2(best.x - pl.x, best.z - pl.z));
}
function explore() {
  standAt(MAIN); moved = true; refreshMe(); showHud();
  notify('Walk anywhere you like. Register when you want to meet people');
}
function enterCity(person, fromCity = false) {
  me = { ...(me || {}), ...person };
  moved = true;
  if (!fromCity) { standAt(MAIN); showHud(); }
  refreshMe();
  const first = me.name.split(' ')[0];
  notify(fromCity ? `You're on the map, ${first}. Walk up to anyone and press E to say hi` : `Welcome, ${first}. Walk up to anyone and press E to say hi`);
  // the person they wanted to meet before registering
  const p = pendingCard && actors.get(pendingCard)?.p; pendingCard = null;
  if (p && fromCity) openCard(p);
}
function join() {
  if (me) return openSignin(); // registered: edit in the city
  closeCard(); find.hidden = true; unlock();
  gate.show(0, { inCity: true });
}
gate = createOnboarding({
  archetypes: ARCH, lookFor, skins: SKIN, districts: DISTRICTS, statusColors: { open: STATUS.open.color, hiring: STATUS.hiring.color },
  getMe: () => me,
  save: async (profile, arche) => {
    registering = profile.name;
    try {
      const person = await live.save(profile);
      if (actors.has(person.id)) removeActor(person.id); // never stand next to yourself
      return { ...person, arche };
    } finally { setTimeout(() => { registering = null; }, 3000); }
  },
  onEnter: enterCity,
  onExplore: explore,
  ready: cityReady,
});
// (dev only: /?enter skips the landing page for quick testing)
// the boot screen and the landing page share a background, so the swap is seamless
const unboot = () => { document.documentElement.classList.remove('boot'); $('#loading')?.remove(); };
if (!(import.meta.env.DEV && location.search.includes('enter'))) { gate.show(-1); unboot(); }
else cityReady.then(unboot);
if (import.meta.env.DEV) import('./dev/perf.js').then(({ installPerf }) => installPerf({ renderer, scene, sun, frame }));
if (import.meta.env.DEV) window.__dc = { state, cam, world, flyTo, stage, camera, scene, actors, walkers, crowd, post, sun, QUALITY, device, setAutoQ: (v) => { autoQ = v; }, get fps() { return Math.round(1000 / ema); }, renderer }; // dev-only debug handle

// Post-processing: render -> bloom -> ACES tone map (OutputPass) -> grade -> anti-alias.
//
// Anti-aliasing at every quality level, matched to what the GPU can afford:
//   high   4x MSAA on the scene buffer
//   medium FXAA at 1x pixel ratio (cheap enough for integrated GPUs with shadows on)
//   low    FXAA (a single cheap pass), no bloom, no shadows
// The grade is gentle (near-neutral saturation): colour comes from the materials.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uSat: { value: 1.0 }, uContrast: { value: 1.03 }, uVig: { value: 0.3 },
    uShadow: { value: new THREE.Vector3(-0.006, 0.0, 0.012) }, uHigh: { value: new THREE.Vector3(0.016, 0.008, -0.01) },
    uGrain: { value: 0.014 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVig, uGrain, uTime; uniform vec3 uShadow, uHigh; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col += mix(uShadow, uHigh, smoothstep(0.15, 0.85, l));
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVig * smoothstep(0.18, 0.75, dot(d, d) * 2.2);
      col += (hash(vUv * 1024.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

// dev only: /?classic restores the previous tone mapping and quality presets
const CLASSIC = import.meta.env.DEV && location.search.includes('classic');
export const QUALITY = CLASSIC ? {
  high: { label: 'High', dpr: 2, shadows: 2048, bloom: 0.5, msaa: 4, aa: null },
  medium: { label: 'Medium', dpr: 1.25, shadows: 1024, bloom: 0.5, msaa: 2, aa: null },
  low: { label: 'Low', dpr: 1, shadows: 0, bloom: 0, msaa: 0, aa: null },
} : {
  high: { label: 'High', dpr: 1.5, shadows: 2048, bloom: 0.5, msaa: 4, aa: null },
  medium: { label: 'Medium', dpr: 1, shadows: 1024, bloom: 0, msaa: 0, aa: null, direct: true }, // shadows + native MSAA, no bloom
  // low draws straight to the screen with the browser's own 4x multisampling: the
  // cheapest real anti-aliasing there is (edges stay still instead of crawling)
  low: { label: 'Low', dpr: 1, shadows: 0, bloom: 0, msaa: 0, aa: null, direct: true },
};

// photo-mode looks, applied over the time-of-day grade
export const FILTERS = {
  natural: { label: 'Natural' },
  golden: { label: 'Golden', sat: 1.14, contrast: 1.06, high: [0.06, 0.03, -0.03], shadow: [0.01, -0.005, 0.0], vig: 0.45 },
  cool: { label: 'Cool', sat: 0.82, contrast: 1.06, high: [-0.02, 0.01, 0.035], shadow: [-0.02, 0.0, 0.04], vig: 0.5 },
  noir: { label: 'Noir', sat: 0, contrast: 1.28, high: [0, 0, 0], shadow: [0, 0, 0], vig: 0.62, grain: 0.045 },
  film: { label: 'Film', sat: 0.86, contrast: 0.94, high: [0.05, 0.03, -0.02], shadow: [0.04, 0.02, 0.0], vig: 0.55, grain: 0.05 },
};

export function createPost(renderer, scene, camera, sun, initial = 'high') {
  renderer.toneMapping = CLASSIC ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CLASSIC ? 1.05 : 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let composer = null, bloom = null, grade = null, fxaa = null, level = QUALITY[initial] ? initial : 'high', night = 0, w = 1, h = 1, pr = 1;
  let filter = FILTERS.natural, capture = null;
  const api = { onLevel: null };

  let built = false;
  function build() {
    const q = QUALITY[level];
    built = true;
    composer?.dispose(); composer = null;
    pr = Math.min(window.devicePixelRatio || 1, q.dpr);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    sun.castShadow = q.shadows > 0;
    if (q.shadows && sun.shadow.mapSize.x !== q.shadows) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(q.shadows, q.shadows); }
    // direct levels draw straight to the screen: no half-float buffers at all (some
    // phones cannot render to them); the post chain is made only if photo mode asks
    if (!q.direct) makeComposer();
    setNight(night);
    api.onLevel?.(level);
  }
  function makeComposer() {
    const q = QUALITY[level];
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w * q.bloom || 1, h * q.bloom || 1), 0.5, 0.6, 0.84);
    // UnrealBloomPass always works at half the size it is given; give it less on medium
    const setBloomSize = bloom.setSize.bind(bloom), k = q.bloom ? q.bloom / 0.5 : 1;
    bloom.setSize = (W, H) => setBloomSize(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
    bloom.enabled = q.bloom > 0;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    fxaa = null;
    if (q.aa === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
    else if (q.aa === 'fxaa') { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
    composer.setSize(w, h);
    sizeAA();
    setNight(night);
  }
  function sizeAA() { if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); }
  function setNight(n) {
    night = n;
    if (!bloom) return;
    bloom.strength = 0.1 + n * 0.42; bloom.threshold = 0.95 - n * 0.03; bloom.radius = 0.35;
    const g = grade.uniforms;
    if (CLASSIC) { g.uSat.value = 1.14 + n * 0.08; g.uContrast.value = 1.05 + n * 0.05; g.uVig.value = 0.36 + n * 0.2; g.uShadow.value.set(-0.012, 0.0, 0.02 + n * 0.03); g.uHigh.value.set(0.03, 0.012, -0.018); g.uGrain.value = 0.022; return; }
    g.uSat.value = 1.0 + n * 0.06; g.uContrast.value = 1.03 + n * 0.04; g.uVig.value = 0.3 + n * 0.2;
    g.uShadow.value.set(-0.006, 0.0, 0.012 + n * 0.03);
    g.uHigh.value.set(0.016, 0.008, -0.01); g.uGrain.value = 0.014;
    const f = filter;
    if (f.sat != null) g.uSat.value = f.sat;
    if (f.contrast != null) g.uContrast.value = f.contrast;
    if (f.vig != null) g.uVig.value = f.vig;
    if (f.high) g.uHigh.value.set(...f.high);
    if (f.shadow) g.uShadow.value.set(...f.shadow);
    if (f.grain != null) g.uGrain.value = f.grain;
  }
  return Object.assign(api, {
    get level() { return level; },
    setLevel(l) { if (QUALITY[l] && l !== level) { level = l; build(); } },
    setSize(W, H) { w = Math.max(1, W); h = Math.max(1, H); if (!built) build(); else if (composer) { composer.setSize(w, h); sizeAA(); } },
    setNight,
    setFilter(k) { filter = FILTERS[k] || FILTERS.natural; setNight(night); },
    // the next frame is also saved as a PNG (read straight after it is drawn)
    capture(cb) { capture = cb; },
    render(t) {
      // straight to the canvas (native MSAA) unless a photo look needs the grade pass
      if (QUALITY[level].direct && filter === FILTERS.natural) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
      else {
        if (!composer) makeComposer();
        grade.uniforms.uTime.value = t % 100;
        composer.render();
      }
      if (capture) { const cb = capture; capture = null; renderer.domElement.toBlob(cb, 'image/png'); }
    },
  });
}

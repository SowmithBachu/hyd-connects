// DEVELOPMENT ONLY: frame measurements, used to check changes against the budget
// in the README. In the browser console on the dev server:
//   await __perf.measure(40)
//
// Renders n frames back to back (works even when the tab is hidden and the browser
// throttles requestAnimationFrame) and reports, per frame: CPU time in the frame
// callback, GPU time (EXT_disjoint_timer_query_webgl2, when the GPU exposes it), the
// fps those allow (capped at 60), draw calls and triangles (main pass + shadow pass +
// post), and memory: every texture the scene references, plus the shadow map and
// post-processing buffers.
import * as THREE from 'three';

export function installPerf({ renderer, scene, sun, frame }) {
  const gl = renderer.getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const tick = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  window.__perf = {
    async measure(n = 40) {
      const cpu = [], gpu = [];
      let pending = [];
      const poll = () => {
        pending = pending.filter((q) => {
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q); return false;
        });
      };
      // the app's own loop is already queued; calling frame() directly must not queue more
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      // warm up (shader compiles, uploads), then measure
      for (let i = 0; i < 20; i++) { frame(performance.now()); gl.finish(); await tick(); }
      renderer.info.autoReset = false; renderer.info.reset();
      for (let i = 0; i < n; i++) {
        let q = null;
        if (timer) { q = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, q); }
        const c0 = performance.now();
        frame(performance.now());
        cpu.push(performance.now() - c0);
        if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(q); }
        gl.finish();
        poll();
        await tick();
      }
      window.requestAnimationFrame = raf;
      const calls = renderer.info.render.calls / n, tris = renderer.info.render.triangles / n;
      renderer.info.autoReset = true;
      for (let i = 0; i < 50 && pending.length; i++) { await tick(); poll(); }
      const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[(v.length / 2) | 0] : null; };
      const c = med(cpu), g = med(gpu);
      return {
        cpuMs: +c.toFixed(2), gpuMs: g && +g.toFixed(2), fpsPossible: Math.min(60, Math.round(1000 / Math.max(c, g || 0))),
        drawCalls: Math.round(calls), triangles: Math.round(tris),
        textureMB: +(textureBytes(scene) / 1048576).toFixed(1), targetsMB: +(targetBytes(renderer, sun) / 1048576).toFixed(1),
      };
    },
  };
}

// bytes on the GPU for every texture the scene's materials use (with mipmaps)
function textureBytes(scene) {
  const seen = new Set();
  let bytes = 0;
  const add = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return;
    seen.add(t);
    if (t.isCompressedTexture || t.isCompressedArrayTexture) { for (const m of t.mipmaps || []) bytes += m.data.byteLength; return; }
    const img = t.image, w = img?.width || 0, h = img?.height || 0, depth = img?.depth || 1;
    const per = t.type === THREE.FloatType ? 16 : t.type === THREE.HalfFloatType ? 8 : 4;
    const mips = t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
    bytes += w * h * depth * per * mips;
  };
  const visit = (m) => {
    for (const k in m) if (m[k]?.isTexture) add(m[k]);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) add(u.value);
    if (m.userData?.textures) for (const t of m.userData.textures) add(t);
  };
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(visit);
    if (o.customDepthMaterial) visit(o.customDepthMaterial);
  });
  add(scene.environment); add(scene.background);
  return bytes;
}

// shadow map and the post-processing buffers (MSAA, half-float colour)
function targetBytes(renderer, sun) {
  let bytes = 0;
  const sm = sun?.shadow?.map;
  if (sm) bytes += sm.width * sm.height * 4 * 2; // depth + packed RGBA
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // composer: two half-float RGBA ping-pong buffers, the 4x MSAA buffer, bloom mips (~0.7)
  bytes += size.x * size.y * 8 * (2 + 4 + 0.7);
  return bytes;
}

// What kind of device are we on? Decides the starting quality and how busy the city
// is, so phones and low-spec laptops start smooth instead of starting heavy and
// stepping down while you play.
//
//   phone  touch device with a small screen (phones, small tablets)
//   low    integrated or old GPU, little memory or few CPU cores (most thin laptops)
//   high   everything else (dedicated GPUs, recent Macs)
//
// The live frame-time check in app.js still steps quality down if frames run long.
export function deviceTier(renderer) {
  const nav = navigator, ua = nav.userAgent || '';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width || 9999, screen.height || 9999) < 820;
  const iPadOS = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
  const phone = /Android|iPhone|iPod|Mobile|Silk|Kindle/i.test(ua) || iPadOS || (coarse && small);
  let gpu = '';
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { /* blocked */ }
  const mem = nav.deviceMemory || 8, cores = nav.hardwareConcurrency || 4;
  // integrated graphics and software renderers; Apple silicon is fast enough for high
  const weakGpu = /Intel|HD Graphics|UHD|Iris|Radeon\(TM\) (Vega|Graphics)|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Microsoft Basic/i.test(gpu) && !/Apple/i.test(gpu);
  const tier = phone ? 'phone' : weakGpu || mem <= 4 || cores <= 4 ? 'low' : 'high';
  return { tier, phone, lite: tier !== 'high', gpu };
}

// Can this browser draw the city at all? (WebGL 2 is required: every current
// desktop and mobile browser has it, iOS since Safari 15.)
export function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

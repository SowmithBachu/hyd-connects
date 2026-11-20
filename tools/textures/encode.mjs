// Encode the packed surface layers (tools/textures/pack.py) to KTX2 / Basis Universal.
//
//   node tools/textures/encode.mjs
//
// Colour layers: ETC1S (small download; transcoded to BC7/BC1/ETC on the GPU).
// Detail layers (normal, roughness, AO): UASTC with Zstandard supercompression,
// because ETC1S blocks smear normal maps. Both get full mip chains.
// Also copies the Poly Haven HDRI and the Basis transcoder into public/.
import fs from 'node:fs';
import path from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const IN = path.join(ROOT, 'assets/source/textures/out');
const OUT = path.join(ROOT, 'public/textures');
fs.mkdirSync(OUT, { recursive: true });

// PNG decoding without native modules: Python wrote raw RGBA next to each PNG? No —
// decode here with the tiny PNG reader below (8-bit RGBA, non-interlaced, as Pillow writes).
import zlib from 'node:zlib';
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6) throw new Error('expected 8-bit RGBA'); }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h * 4), bpp = 4, stride = w * 4;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    out.set(cur, y * stride); prev = cur;
  }
  return { data: out, width: w, height: h };
}

const imageDecoder = async (buf) => decodePNG(Buffer.from(buf));
const files = fs.readdirSync(IN).filter((f) => f.endsWith('.png')).sort();
let total = 0;
for (const f of files) {
  const src = new Uint8Array(fs.readFileSync(path.join(IN, f)));
  const isNormal = f.startsWith('n');
  const ktx = await encodeToKTX2(src, isNormal
    ? { isUASTC: true, generateMipmap: true, isNormalMap: false, needSupercompression: true, uastcLDRQualityLevel: 2, imageDecoder }
    : { isUASTC: false, generateMipmap: true, qualityLevel: 160, compressionLevel: 2, isSetKTX2SRGBTransferFunc: true, imageDecoder });
  const out = path.join(OUT, f.replace('.png', '.ktx2'));
  fs.writeFileSync(out, ktx);
  total += ktx.byteLength;
  console.log(f, '->', (ktx.byteLength / 1024).toFixed(0), 'KB');
}
console.log('total', (total / 1024).toFixed(0), 'KB');

// environment map and the transcoder the KTX2 loader needs at runtime
fs.mkdirSync(path.join(ROOT, 'public/env'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'assets/source/textures/hdri/venice_sunset_1k.hdr'), path.join(ROOT, 'public/env/venice_sunset_1k.hdr'));
fs.mkdirSync(path.join(ROOT, 'public/basis'), { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(ROOT, 'node_modules/three/examples/jsm/libs/basis', f), path.join(ROOT, 'public/basis', f));

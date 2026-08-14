'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const SS = 3; // supersampling samples per axis

// ---- tiny color math ----
function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return Math.hypot(dx, dy) - r;
}

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const bgTop = [15, 18, 40];
const bgBot = [26, 24, 74];
const tileTop = [86, 132, 255];
const tileBot = [124, 92, 255];

const AA = 1.5 / SIZE;

function sample(u, v) {
  // vertical gradient background
  let r = lerp(bgTop[0], bgBot[0], v);
  let g = lerp(bgTop[1], bgBot[1], v);
  let b = lerp(bgTop[2], bgBot[2], v);

  // soft radial glow behind the tile
  const gd = Math.hypot(u - 0.5, v - 0.5);
  const glow = Math.max(0, 1 - gd / 0.62);
  r += glow * glow * 26;
  g += glow * glow * 30;
  b += glow * glow * 58;

  // rounded-square tile
  const dTile = sdRoundRect(u, v, 0.5, 0.5, 0.27, 0.27, 0.135);
  const aTile = 1 - smoothstep(-AA, AA, dTile);
  if (aTile > 0) {
    const tr = lerp(tileTop[0], tileBot[0], v);
    const tg = lerp(tileTop[1], tileBot[1], v);
    const tb = lerp(tileTop[2], tileBot[2], v);
    r = lerp(r, tr, aTile);
    g = lerp(g, tg, aTile);
    b = lerp(b, tb, aTile);
  }

  // two white "spark" dots
  const a1 = 1 - smoothstep(-AA, AA, sdCircle(u, v, 0.5, 0.455, 0.098));
  const a2 = 1 - smoothstep(-AA, AA, sdCircle(u, v, 0.628, 0.585, 0.045));
  const aw = Math.max(a1, a2);
  if (aw > 0) {
    r = lerp(r, 255, aw);
    g = lerp(g, 255, aw);
    b = lerp(b, 255, aw);
  }

  return [r, g, b];
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const ssOffsets = [];
for (let i = 0; i < SS; i++) {
  for (let j = 0; j < SS; j++) {
    ssOffsets.push([(i + 0.5) / SS, (j + 0.5) / SS]);
  }
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [ox, oy] of ssOffsets) {
      const c = sample((x + ox) / SIZE, (y + oy) / SIZE);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    const n = ssOffsets.length;
    const idx = (y * SIZE + x) * 4;
    rgba[idx] = Math.round(r / n);
    rgba[idx + 1] = Math.round(g / n);
    rgba[idx + 2] = Math.round(b / n);
    rgba[idx + 3] = 255;
  }
}

// ---- PNG encoding ----
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(w, h, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon_1024.png');
fs.writeFileSync(outPath, encodePNG(SIZE, SIZE, rgba));
console.log('Wrote', outPath);

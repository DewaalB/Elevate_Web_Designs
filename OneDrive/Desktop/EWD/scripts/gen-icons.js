/* One-off generator for the admin PWA's home-screen icons — no image
   libraries available, so this hand-builds minimal PNGs (navy background,
   cyan triangle matching the site's logo mark) using only Node's built-in
   zlib for the compressed image data and a small inline CRC32. */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const NAVY = [0x07, 0x0e, 0x1a];
const CYAN = [0x00, 0xd4, 0xff];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function inTriangle(px, py, size) {
  // Same silhouette as the nav logo: apex top-centre, base near the bottom.
  const ax = size * 0.5, ay = size * 0.10;
  const bx = size * 0.90, by = size * 0.86;
  const cx = size * 0.10, cy = size * 0.86;
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

function buildPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = inTriangle(x + 0.5, y + 0.5, size) ? CYAN : NAVY;
      const off = rowStart + 1 + x * 3;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor (RGB)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'elevatewebdesigns', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[
  ['admin-icon-192.png', 192],
  ['admin-icon-512.png', 512],
  ['apple-touch-icon.png', 180],
].forEach(([name, size]) => {
  fs.writeFileSync(path.join(outDir, name), buildPng(size));
  console.log('wrote', name, size + 'x' + size);
});

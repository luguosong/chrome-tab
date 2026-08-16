// 一次性图标生成器:128x128 RGBA PNG(深色圆角方块 + 天蓝色 ↗,呼应"重定向")。
// 重新生成:node extension/icons/gen-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 128, H = 128;
const px = new Uint8Array(W * H * 4);

function put(x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}

// 圆角矩形 SDF(中心 cx,cy,半宽高 hw/hh,圆角半径 r)
function inRoundedRect(x, y, cx, cy, hw, hh, r) {
  if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) return false;
  const qx = Math.max(Math.abs(x - cx) - (hw - r), 0);
  const qy = Math.max(Math.abs(y - cy) - (hh - r), 0);
  return qx * qx + qy * qy <= r * r;
}

function distToSeg(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const BGC = [11, 18, 32];   // #0b1220,与应用底色一致
const FGC = [56, 189, 248]; // #38bdf8

for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (inRoundedRect(x + 0.5, y + 0.5, 64, 64, 58, 58, 22)) put(x, y, BGC);

// ↗ 箭头 = 斜杠 + 上横杠 + 右竖杠
const T = 7; // 半粗
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const inDiag = distToSeg(x + 0.5, y + 0.5, 40, 88, 76, 52) <= T;
    const inTop = x >= 48 && x <= 88 && y >= 34 && y <= 48;
    const inRight = x >= 74 && x <= 88 && y >= 34 && y <= 74;
    if (inDiag || inTop || inRight) put(x, y, FGC);
  }

// --- PNG 组装 ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter: none
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('./icon128.png', import.meta.url), png);
console.log('written icon128.png,', png.length, 'bytes');

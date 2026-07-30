// 由 penecho-mark.png 生成 Windows 应用图标(ICO 内嵌 PNG)
// electron-builder 要求 ≥256x256:源图 235x233 居中放大到 256x256 透明画布(纯 JS PNG 编解码,零依赖跨平台)
// 跑:node scripts/make-ico.mjs → desktop/assets/icon.ico
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "desktop", "penecho", "public", "penecho-mark.png");
const OUT = path.join(ROOT, "desktop", "assets", "icon.ico");
const TARGET = 256;

// ---------- 最小 PNG 解码(8bit RGBA/RGB、非交错;覆盖图标场景) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("非 PNG");
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || (ihdr.color !== 6 && ihdr.color !== 2) || ihdr.interlace !== 0)
    throw new Error(`仅支持 8bit RGBA/RGB 非交错 PNG,当前 ${JSON.stringify(ihdr)}`);
  const ch = ihdr.color === 6 ? 4 : 3, stride = ihdr.w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(ihdr.w * ihdr.h * 4);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      cur[x] = (line[x] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 0xff;
    }
    for (let x = 0; x < ihdr.w; x++) {
      const s = x * ch, d = (y * ihdr.w + x) * 4;
      px[d] = cur[s]; px[d + 1] = cur[s + 1]; px[d + 2] = cur[s + 2]; px[d + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { w: ihdr.w, h: ihdr.h, px };
}

function encodePng(w, h, px) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 居中放入 TARGET×TARGET 透明画布(最近邻;源较小不拉伸,保持比例)
function fitToTarget(src) {
  const out = Buffer.alloc(TARGET * TARGET * 4);
  const scale = Math.min(TARGET / src.w, TARGET / src.h, 1); // 只缩不放?不——builder 要满 256,源 235 接近 1:1 居中即可
  const w = Math.round(src.w * scale), h = Math.round(src.h * scale);
  const ox = Math.floor((TARGET - w) / 2), oy = Math.floor((TARGET - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(src.w - 1, Math.floor(x / scale)), sy = Math.min(src.h - 1, Math.floor(y / scale));
    const s = (sy * src.w + sx) * 4, d = ((oy + y) * TARGET + (ox + x)) * 4;
    src.px.copy(out, d, s, s + 4);
  }
  return out;
}

// ---------- 主流程 ----------
const srcBuf = fs.readFileSync(SRC);
const decoded = decodePng(srcBuf);
const needFit = decoded.w < TARGET || decoded.h < TARGET;
const png = needFit ? encodePng(TARGET, TARGET, fitToTarget(decoded)) : srcBuf;
const w = needFit ? TARGET : decoded.w, h = needFit ? TARGET : decoded.h;
if (w > 256 || h > 256) throw new Error(`源图 ${w}x${h} 超过 ICO 内嵌上限 256`);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: icon
header.writeUInt16LE(1, 4);      // count: 1

const entry = Buffer.alloc(16);
entry.writeUInt8(w >= 256 ? 0 : w, 0);   // width(256 记 0)
entry.writeUInt8(h >= 256 ? 0 : h, 1);   // height
entry.writeUInt8(0, 2);                  // palette
entry.writeUInt8(0, 3);                  // reserved
entry.writeUInt16LE(1, 4);               // planes
entry.writeUInt16LE(32, 6);              // bit depth
entry.writeUInt32LE(png.length, 8);      // data size
entry.writeUInt32LE(6 + 16, 12);         // data offset

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, entry, png]));
console.log(`icon.ico 生成: ${decoded.w}x${decoded.h}${needFit ? ` → 居中放大 ${w}x${h}` : ""}, ${png.length} bytes → ${path.relative(ROOT, OUT)}`);

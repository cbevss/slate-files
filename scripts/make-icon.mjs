// Draws Slate's app icon (1024x1024 PNG): three rounded panels floating on black,
// the same layout as the main window. Authored in code; no external assets.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const S = 1024;
const px = new Uint8Array(S * S * 4);

// signed distance to a rounded rectangle
function rr(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2 - r, hh = (y1 - y0) / 2 - r;
  const dx = Math.max(Math.abs(x - cx) - hw, 0), dy = Math.max(Math.abs(y - cy) - hh, 0);
  return Math.hypot(dx, dy) - r;
}
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px anti-aliasing

const shapes = [
  // [x0, y0, x1, y1, radius, grey, alpha]
  [0, 0, 1024, 1024, 224, 0, 1],            // squircle-ish black tile
  [176, 236, 360, 788, 40, 0x3a, 1],         // sidebar panel
  [392, 236, 848, 788, 40, 0x2a, 1],         // file list panel
  [440, 300, 800, 336, 18, 0xff, 1],         // selected row, white
  [440, 384, 720, 412, 14, 0x8f, 1],         // rows
  [440, 452, 760, 480, 14, 0x8f, 1],
  [440, 520, 680, 548, 14, 0x8f, 1],
  [440, 588, 740, 616, 14, 0x8f, 1],
  [208, 300, 328, 324, 12, 0x8f, 1],         // sidebar items
  [208, 360, 300, 384, 12, 0x6b, 1],
  [208, 420, 316, 444, 12, 0x6b, 1],
];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [x0, y0, x1, y1, rad, grey, al] of shapes) {
      const c = cover(rr(x + 0.5, y + 0.5, x0, y0, x1, y1, rad)) * al;
      if (c <= 0) continue;
      r = r * (1 - c) + grey * c; g = r; b = r;
      a = a + c * (1 - a);
    }
    const i = (y * S + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(a * 255);
  }
}

// encode PNG
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/source.png", png);
console.log("wrote src-tauri/icons/source.png");

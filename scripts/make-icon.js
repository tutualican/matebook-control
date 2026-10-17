// Basit PNG simge üretici (harici bağımlılık yok). 512x512 RGBA -> build/icon.png
// Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512, R = 112; // boyut, köşe yarıçapı
const cx = S / 2, cy = S / 2;

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// köşe yuvarlatılmış kare içinde mi (yumuşak kenar)
function roundRectAlpha(x, y) {
  const rx = Math.min(x, S - 1 - x), ry = Math.min(y, S - 1 - y);
  if (rx >= R || ry >= R) return 255;
  const dx = R - rx, dy = R - ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= R - 0.5) return 255;
  if (d >= R + 0.5) return 0;
  return Math.round(255 * (R + 0.5 - d));
}

const top = [0x17, 0x17, 0x1e], bot = [0x08, 0x08, 0x0c];
const orange = [0xff, 0x8a, 0x1e], yellow = [0xff, 0xd2, 0x3f], deep = [0xff, 0x5f, 0x00];

const raw = Buffer.alloc(S * (S * 4 + 1));
let p = 0;
for (let y = 0; y < S; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    let r, g, b;
    // taban gradyan
    let col = mix(top, bot, y / S);
    r = col[0]; g = col[1]; b = col[2];

    // turuncu merkez parıltı
    const gd = Math.hypot(x - cx, y - cy) / 300;
    if (gd < 1) {
      const t = (1 - gd) * 0.35;
      r = lerp(r, orange[0], t); g = lerp(g, orange[1], t); b = lerp(b, orange[2], t);
    }

    // elmas (diamond)
    const dx = Math.abs(x - cx) / 170, dy = Math.abs(y - cy) / 150;
    const dd = dx + dy;
    if (dd <= 1.02) {
      const t = Math.max(0, Math.min(1, (dd - 0.98) / 0.04)); // kenar AA
      const f = (x + y) / (2 * S); // çapraz gradyan
      const dcol = mix(yellow, deep, f);
      r = lerp(dcol[0], r, t); g = lerp(dcol[1], g, t); b = lerp(dcol[2], b, t);
    }

    const a = roundRectAlpha(x, y);
    raw[p++] = r & 0xff; raw[p++] = g & 0xff; raw[p++] = b & 0xff; raw[p++] = a;
  }
}

// ---- PNG ----
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon yazıldı: ' + out + ' (' + png.length + ' bayt)');

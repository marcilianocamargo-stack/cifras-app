/* Gera os ícones PNG do app sem depender de bibliotecas.
   Rode com:  node tools/make-icons.mjs                              */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/* ---------- PNG mínimo (RGBA, sem filtro) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bits por canal
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- desenho ---------- */

const BG = [26, 18, 6];         // marrom quase preto
const FG = [240, 165, 61];      // âmbar (mesmo tom do app)

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Cabeça da nota: elipse inclinada. */
function inHead(x, y) {
  const cx = 0.40, cy = 0.695, rx = 0.165, ry = 0.118, a = -0.35;
  const dx = x - cx, dy = y - cy;
  const px = dx * Math.cos(a) + dy * Math.sin(a);
  const py = -dx * Math.sin(a) + dy * Math.cos(a);
  return (px / rx) ** 2 + (py / ry) ** 2 <= 1;
}

const inStem = (x, y) => x >= 0.535 && x <= 0.588 && y >= 0.215 && y <= 0.705;

/** Bandeirola: recorte em meia-lua entre dois círculos. */
function inFlag(x, y) {
  if (x < 0.575 || y < 0.212) return false;
  return inCircle(x, y, 0.55, 0.40, 0.27) && !inCircle(x, y, 0.46, 0.49, 0.27);
}

const inNote = (x, y) => inHead(x, y) || inStem(x, y) || inFlag(x, y);

/** Fundo: quadrado de cantos arredondados (ou tela cheia, no maskable). */
function inBackground(x, y, full) {
  if (full) return true;
  const r = 0.22, lo = r, hi = 1 - r;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function drawIcon(size, { full = false, pad = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3;                                   // supersampling 3x3
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, note = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (inBackground(x, y, full)) bg++;
          // com padding, a nota encolhe para caber na área segura do maskable
          const nx = (x - 0.5) / (1 - pad * 2) + 0.5;
          const ny = (y - 0.5) / (1 - pad * 2) + 0.5;
          if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 && inNote(nx, ny)) note++;
        }
      }
      const total = S * S;
      const aBg = bg / total, aNote = (note / total) * aBg;
      const i = (py * size + px) * 4;
      // cor final = fundo onde não há nota, âmbar onde há
      const mix = aBg === 0 ? [0, 0, 0] : [0, 1, 2].map(c =>
        Math.round((BG[c] * (aBg - aNote) + FG[c] * aNote) / aBg));
      rgba[i] = mix[0]; rgba[i + 1] = mix[1]; rgba[i + 2] = mix[2];
      rgba[i + 3] = Math.round(aBg * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = name => new URL(`../icons/${name}`, import.meta.url);

writeFileSync(out('icon-192.png'), drawIcon(192));
writeFileSync(out('icon-512.png'), drawIcon(512));
writeFileSync(out('icon-maskable-512.png'), drawIcon(512, { full: true, pad: 0.12 }));

console.log('ícones gerados em icons/');

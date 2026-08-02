/**
 * Gera o ícone da StartDigital em PNG (ou ICO) no tamanho pedido.
 * Sem dependências: desenha os pixels e monta o PNG na mão.
 *
 *   /api/icone?s=192        -> PNG 192x192
 *   /api/icone?s=48&f=ico   -> ICO 48x48
 */

const zlib = require('zlib');

/* ---------------------------------------------- desenho */
const AZUL = [0x1f, 0x4a, 0xa8];
const UVA = [0xbd, 0x71, 0xdf];

// raio branco, em coordenadas de um quadro 512x512
// (a escala engorda um tico a forma, para bater com a espessura do logo)
const ESCALA = 1.033;
const RAIO = [
  [256, 96], [256, 200], [472, 200], [256, 416], [256, 312], [40, 312],
].map(([x, y]) => [256 + (x - 256) * ESCALA, 256 + (y - 256) * ESCALA]);

function dentro(x, y) {
  let d = false;
  for (let i = 0, j = RAIO.length - 1; i < RAIO.length; j = i++) {
    const [xi, yi] = RAIO[i];
    const [xj, yj] = RAIO[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

function pixels(n) {
  const AA = 3; // 3x3 amostras por pixel, para a borda não ficar serrilhada
  const buf = Buffer.alloc(n * n * 3 + n); // +n = byte de filtro por linha
  let p = 0;
  for (let ly = 0; ly < n; ly++) {
    buf[p++] = 0; // filtro "none"
    for (let lx = 0; lx < n; lx++) {
      let branco = 0;
      for (let sy = 0; sy < AA; sy++) {
        for (let sx = 0; sx < AA; sx++) {
          const px = ((lx + (sx + 0.5) / AA) / n) * 512;
          const py = ((ly + (sy + 0.5) / AA) / n) * 512;
          if (dentro(px, py)) branco++;
        }
      }
      const a = branco / (AA * AA);
      const t = lx / (n - 1 || 1);
      for (let c = 0; c < 3; c++) {
        const fundo = AZUL[c] + (UVA[c] - AZUL[c]) * t;
        buf[p++] = Math.round(fundo * (1 - a) + 255 * a);
      }
    }
  }
  return buf;
}

/* ---------------------------------------------- PNG */
const TABELA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pedaco(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

function png(n) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;  // 8 bits por canal
  ihdr[9] = 2;  // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(pixels(n), { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------- ICO (embrulha um PNG) */
function ico(n) {
  const img = png(n);
  const cab = Buffer.alloc(22);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2);   // tipo ícone
  cab.writeUInt16LE(1, 4);   // 1 imagem
  cab[6] = n >= 256 ? 0 : n; // largura
  cab[7] = n >= 256 ? 0 : n; // altura
  cab.writeUInt16LE(1, 10);  // planos
  cab.writeUInt16LE(32, 12); // bits
  cab.writeUInt32LE(img.length, 14);
  cab.writeUInt32LE(22, 18); // offset
  return Buffer.concat([cab, img]);
}

/* ---------------------------------------------- rota */
module.exports = (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  let n = parseInt(q.get('s'), 10);
  if (!Number.isFinite(n) || n < 8) n = 512;
  if (n > 512) n = 512;
  const querIco = (q.get('f') || '') === 'ico';

  const corpo = querIco ? ico(Math.min(n, 64)) : png(n);
  res.setHeader('Content-Type', querIco ? 'image/x-icon' : 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', corpo.length);
  res.end(corpo);
};

module.exports.png = png;
module.exports.ico = ico;

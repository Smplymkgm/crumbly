/**
 * Tests de la compresión de comprobantes (js/imagenes.js). Correr con:
 * node tests/imagenes.test.js
 * Node no trae createImageBitmap ni canvas: acá se prueban las piezas puras
 * (decidirResultado, tieneTransparencia) y que comprimirComprobante devuelva
 * el original tal cual cuando no puede comprimir. La compresión de verdad
 * (EXIF, tamaño, legibilidad) se verifica en el navegador.
 */
const assert = require('assert');
const path = require('path');
const CrumblyImagenes = require(path.join(__dirname, '..', 'js', 'imagenes.js'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// Un "archivo" mínimo: lo único que miran estas funciones es size/type/name.
const archivo = (size, type, name) => ({ size, type, name: name || 'x' });

// ImageData falso: data RGBA de w*h píxeles, todos opacos.
function imageData(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}

test('decidirResultado: comprimido más grande → original', () => {
  const o = archivo(1000), c = archivo(1500);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, c), o);
});

test('decidirResultado: comprimido del mismo tamaño → original', () => {
  const o = archivo(1000), c = archivo(1000);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, c), o);
});

test('decidirResultado: comprimido más chico → comprimido', () => {
  const o = archivo(4000000), c = archivo(900000);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, c), c);
});

test('decidirResultado: comprimido null o undefined → original', () => {
  const o = archivo(1000);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, null), o);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, undefined), o);
});

test('decidirResultado: comprimido vacío (0 bytes) → original', () => {
  const o = archivo(1000);
  assert.strictEqual(CrumblyImagenes.decidirResultado(o, archivo(0)), o);
});

test('tieneTransparencia: imagen completamente opaca → false', () => {
  assert.strictEqual(CrumblyImagenes.tieneTransparencia(imageData(300, 200)), false);
});

test('tieneTransparencia: un solo píxel transparente → true (en cualquier lugar)', () => {
  const w = 300, h = 200;
  for (const [x, y] of [[0, 0], [w - 1, h - 1], [137, 91], [1, 0]]) {
    const d = imageData(w, h);
    d.data[(y * w + x) * 4 + 3] = 0;
    assert.strictEqual(CrumblyImagenes.tieneTransparencia(d), true, 'píxel ' + x + ',' + y);
  }
});

test('tieneTransparencia: un píxel semitransparente → true', () => {
  const d = imageData(10, 10);
  d.data[55 * 4 + 3] = 254;
  assert.strictEqual(CrumblyImagenes.tieneTransparencia(d), true);
});

test('tieneTransparencia: sin datos → false (no tira)', () => {
  assert.strictEqual(CrumblyImagenes.tieneTransparencia(null), false);
  assert.strictEqual(CrumblyImagenes.tieneTransparencia({}), false);
});

test('comprimirComprobante: sin createImageBitmap (node) → original tal cual', async () => {
  assert.strictEqual(typeof createImageBitmap, 'undefined');
  const f = archivo(4000000, 'image/jpeg', 'foto.jpg');
  const progreso = [];
  const r = await CrumblyImagenes.comprimirComprobante(f, { onProgreso: p => progreso.push(p) });
  assert.strictEqual(r, f);
});

test('comprimirComprobante: PDF → original tal cual', async () => {
  const f = archivo(3000000, 'application/pdf', 'factura.pdf');
  assert.strictEqual(await CrumblyImagenes.comprimirComprobante(f), f);
});

test('comprimirComprobante: GIF y tipos no imagen → original tal cual', async () => {
  const gif = archivo(500000, 'image/gif', 'a.gif');
  const txt = archivo(10, 'text/plain', 'a.txt');
  const sinTipo = archivo(10, '', 'a');
  assert.strictEqual(await CrumblyImagenes.comprimirComprobante(gif), gif);
  assert.strictEqual(await CrumblyImagenes.comprimirComprobante(txt), txt);
  assert.strictEqual(await CrumblyImagenes.comprimirComprobante(sinTipo), sinTipo);
});

test('comprimirComprobante: archivo null u onProgreso que tira → no tira', async () => {
  assert.strictEqual(await CrumblyImagenes.comprimirComprobante(null), null);
  const f = archivo(4000000, 'image/jpeg', 'foto.jpg');
  const r = await CrumblyImagenes.comprimirComprobante(f, { onProgreso: () => { throw new Error('x'); } });
  assert.strictEqual(r, f);
});

test('comprimirComprobante: createImageBitmap que tira (HEIC en Chrome) → original', async () => {
  global.createImageBitmap = async () => { throw new Error('The source image could not be decoded.'); };
  try {
    const f = archivo(3000000, 'image/heic', 'IMG_0001.HEIC');
    assert.strictEqual(await CrumblyImagenes.comprimirComprobante(f), f);
  } finally {
    delete global.createImageBitmap;
  }
});

test('medidasDestino: lado mayor ≤ 2000, nunca agranda, conserva proporción', () => {
  const m = CrumblyImagenes.medidasDestino;
  assert.deepStrictEqual(m(3024, 4032, 2000), { ancho: 1500, alto: 2000 });
  assert.deepStrictEqual(m(4032, 3024, 2000), { ancho: 2000, alto: 1500 });
  assert.deepStrictEqual(m(800, 600, 2000), { ancho: 800, alto: 600 });
  assert.deepStrictEqual(m(2000, 10, 2000), { ancho: 2000, alto: 10 });
  assert.deepStrictEqual(m(10000, 1, 2000), { ancho: 2000, alto: 1 });
});

test('nombreConExtension: cambia la extensión según el tipo', () => {
  const n = CrumblyImagenes.nombreConExtension;
  assert.strictEqual(n('IMG_1234.HEIC', 'image/jpeg'), 'IMG_1234.jpg');
  assert.strictEqual(n('captura.png', 'image/webp'), 'captura.webp');
  assert.strictEqual(n('captura.png', 'image/png'), 'captura.png');
  assert.strictEqual(n('mi.foto.jpeg', 'image/jpeg'), 'mi.foto.jpg');
  assert.strictEqual(n('sin-extension', 'image/jpeg'), 'sin-extension.jpg');
  assert.strictEqual(n('', 'image/jpeg'), 'comprobante.jpg');
});

test('PERFIL_COMPROBANTE: 2000 px y JPEG 0.85', () => {
  assert.strictEqual(CrumblyImagenes.PERFIL_COMPROBANTE.ladoMax, 2000);
  assert.strictEqual(CrumblyImagenes.PERFIL_COMPROBANTE.calidad, 0.85);
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log('  ok  ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL  ' + name);
      console.log('      ' + e.message);
    }
  }
  console.log('\n== Resumen ==');
  console.log(passed + ' pasaron, ' + failed + ' fallaron');
  process.exit(failed ? 1 : 0);
})();

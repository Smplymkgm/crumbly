/**
 * Tests del cliente de sincronización (js/sync.js). Correr con:
 * node tests/sync.test.js
 * Sin red real — se inyecta un fetch de prueba (js/sync.js acepta fetch
 * como último parámetro exactamente para esto).
 */
const assert = require('assert');
const path = require('path');
const Sync = require(path.join(__dirname, '..', 'js', 'sync.js'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function group(name) { tests.push([null, () => console.log('\n== ' + name + ' ==')]); }

// responses: array consumido en orden, cada uno {status, body}
function mockFetch(responses) {
  const calls = [];
  const fetchFn = (url, opts) => {
    calls.push({ url, opts: opts || {} });
    const r = responses.shift() || { body: { ok: false, error: 'sin más respuestas mockeadas' } };
    return Promise.resolve({
      ok: r.status === undefined || r.status < 400,
      status: r.status || 200,
      json: () => Promise.resolve(r.body)
    });
  };
  fetchFn.calls = calls;
  return fetchFn;
}

group('isConfigured');

test('falso si falta la URL', () => {
  assert.strictEqual(Sync.isConfigured('', 'tok'), false);
});
test('falso si falta el token', () => {
  assert.strictEqual(Sync.isConfigured('https://x', ''), false);
});
test('falso con solo espacios', () => {
  assert.strictEqual(Sync.isConfigured('   ', '   '), false);
});
test('verdadero con ambos presentes', () => {
  assert.strictEqual(Sync.isConfigured('https://x', 'tok'), true);
});

group('ping');

test('manda action=ping y el token por query string, por GET', async () => {
  const f = mockFetch([{ body: { ok: true, ts: '2026-08-17T00:00:00Z' } }]);
  const r = await Sync.ping('https://script.google.com/exec', 'tok123', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.length, 1);
  assert.ok(f.calls[0].url.indexOf('action=ping') !== -1, 'debe incluir action=ping');
  assert.ok(f.calls[0].url.indexOf('token=tok123') !== -1, 'debe incluir el token');
  assert.ok(!f.calls[0].opts.method || f.calls[0].opts.method === 'GET', 'ping es GET, no debe forzar otro método');
});

test('conserva query string existente en la URL (usa & en vez de ?)', () => {
  const f = mockFetch([{ body: { ok: true } }]);
  Sync.ping('https://x.com/exec?ya=1', 'tok', f);
  assert.ok(f.calls[0].url.indexOf('?ya=1&action=ping') !== -1, f.calls[0].url);
});

test('rechaza la promesa si el HTTP no es ok (ej. 500)', async () => {
  const f = mockFetch([{ status: 500, body: {} }]);
  await assert.rejects(() => Sync.ping('https://x', 'tok', f));
});

group('pull');

test('manda action=pull y devuelve el state del backend', async () => {
  const estadoRemoto = { materia: [{ id: 'm1', nombre: 'Harina' }] };
  const f = mockFetch([{ body: { ok: true, state: estadoRemoto } }]);
  const r = await Sync.pull('https://x.com/exec', 'tok', f);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state, estadoRemoto);
  assert.ok(f.calls[0].url.indexOf('action=pull') !== -1);
});

group('U3: getMigrationStatus');

test('manda action=migrationStatus por GET y devuelve ultima+fase', async () => {
  const f = mockFetch([{ body: { ok: true, ultima: { ts: '2026-09-10T00:00:00Z', veredicto: 'OK', reporte: {} }, fase: 'post' } }]);
  const r = await Sync.getMigrationStatus('https://x.com/exec', 'tok', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fase, 'post');
  assert.strictEqual(r.ultima.veredicto, 'OK');
  assert.ok(f.calls[0].url.indexOf('action=migrationStatus') !== -1);
  assert.ok(!f.calls[0].opts.method || f.calls[0].opts.method === 'GET');
});

group('push');

test('usa POST con Content-Type text/plain (evita el preflight de Apps Script)', async () => {
  const f = mockFetch([{ body: { ok: true, ts: '2026-08-17T00:00:00Z' } }]);
  await Sync.push('https://x.com/exec', 'tok', { materia: [] }, f);
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.strictEqual(f.calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('el body es JSON con token, action=push y el state completo', async () => {
  const estado = { materia: [{ id: 'm1' }], ventas: [] };
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok-secreto', estado, f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.token, 'tok-secreto');
  assert.strictEqual(body.action, 'push');
  assert.deepStrictEqual(body.state, estado);
});

test('propaga ok:false del backend (ej. token inválido) sin lanzar', async () => {
  const f = mockFetch([{ body: { ok: false, error: 'token inválido' } }]);
  const r = await Sync.push('https://x.com/exec', 'tok-malo', {}, f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'token inválido');
});

group('uploadFile');

test('usa POST con Content-Type text/plain, igual que push (evita el preflight)', async () => {
  const f = mockFetch([{ body: { ok: true, url: 'https://drive.google.com/x', fileId: 'f1' } }]);
  await Sync.uploadFile('https://x.com/exec', 'tok', 'comprobante.jpg', 'image/jpeg', 'QUJD', f);
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.strictEqual(f.calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('el body es JSON con token, action=uploadComprobante, filename, mimeType y data en base64', async () => {
  const f = mockFetch([{ body: { ok: true, url: 'https://drive.google.com/x' } }]);
  await Sync.uploadFile('https://x.com/exec', 'tok-secreto', 'foto.png', 'image/png', 'QUJD', f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.token, 'tok-secreto');
  assert.strictEqual(body.action, 'uploadComprobante');
  assert.strictEqual(body.filename, 'foto.png');
  assert.strictEqual(body.mimeType, 'image/png');
  assert.strictEqual(body.data, 'QUJD');
});

test('devuelve la url de Drive que responde el backend', async () => {
  const f = mockFetch([{ body: { ok: true, url: 'https://drive.google.com/file/d/abc/view', fileId: 'abc' } }]);
  const r = await Sync.uploadFile('https://x.com/exec', 'tok', 'a.jpg', 'image/jpeg', 'QUJD', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.url, 'https://drive.google.com/file/d/abc/view');
});

test('propaga ok:false del backend (ej. falta filename) sin lanzar', async () => {
  const f = mockFetch([{ body: { ok: false, error: 'falta filename o data' } }]);
  const r = await Sync.uploadFile('https://x.com/exec', 'tok', '', 'image/jpeg', '', f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'falta filename o data');
});

group('U0 (Ronda 4): la alarma mide el CATÁLOGO, no el payload');

// Catálogo de tamaño controlado: el relleno va en `config` (catálogo).
function catalogoDeTamano(chars) {
  return { config: { relleno: 'x'.repeat(Math.max(0, chars - 25)) } }; // '{"config":{"relleno":""}}' ≈ 25
}
// Payload grande pero catálogo chico: el peso va en `ventas` (append-only).
function payloadGrandeCatalogoChico(payloadChars, catalogoChars) {
  return {
    config: { relleno: 'c'.repeat(Math.max(0, catalogoChars - 25)) },
    ventas: [{ id: 'v1', j: 'v'.repeat(Math.max(0, payloadChars)) }]
  };
}

test('getCatalogSizeInfo: nivel "ok" con catálogo por debajo de 40.000', () => {
  const info = Sync.getCatalogSizeInfo(catalogoDeTamano(1000));
  assert.strictEqual(info.nivel, 'ok');
});

test('getCatalogSizeInfo: nivel "advertencia" con catálogo entre 40.000 y 48.000', () => {
  const info = Sync.getCatalogSizeInfo(catalogoDeTamano(42000));
  assert.strictEqual(info.nivel, 'advertencia');
});

test('getCatalogSizeInfo: nivel "bloqueado" con catálogo sobre 48.000', () => {
  const info = Sync.getCatalogSizeInfo(catalogoDeTamano(49000));
  assert.strictEqual(info.nivel, 'bloqueado');
});

test('getCatalogSizeInfo ignora las colecciones append-only al medir', () => {
  const conMuchasVentas = { config: { a: 1 }, ventas: Array.from({ length: 500 }, (_, i) => ({ id: 'v' + i, total: 20000, x: 'y'.repeat(200) })) };
  const info = Sync.getCatalogSizeInfo(conMuchasVentas);
  assert.ok(info.tam < 100, 'el catálogo es solo {config} — las 500 ventas no cuentan; dio ' + info.tam);
  assert.strictEqual(info.nivel, 'ok');
});

test('CRITERIO U0: payload sobre 48.000 pero catálogo en ~20.000 → push() procede, sin advertencia ni bloqueo', async () => {
  const estado = payloadGrandeCatalogoChico(60000, 20000);
  assert.ok(Sync.getTransferSize(estado) > 48000, 'el payload total debe superar 48.000');
  assert.ok(Sync.getCatalogSizeInfo(estado).tam < 22000 && Sync.getCatalogSizeInfo(estado).tam >= 19000, 'el catálogo debe rondar 20.000');
  const f = mockFetch([{ body: { ok: true, ts: '2026-09-10T00:00:00Z' } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.length, 1, 'la petición SÍ se manda — el catálogo está sano');
  assert.strictEqual(r.sizeInfo.nivel, 'ok');
});

test('CRITERIO U0 inverso: catálogo sobre el tope con payload total chico → push() bloquea', async () => {
  const estado = catalogoDeTamano(49000); // solo config, sin ventas — payload ≈ catálogo acá
  const f = mockFetch([{ body: { ok: true } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'PAYLOAD_TOO_LARGE');
  assert.strictEqual(r.sizeInfo.nivel, 'bloqueado');
  assert.strictEqual(f.calls.length, 0, 'no debe haber intentado la petición');
});

test('push() adjunta sizeInfo (catálogo) + sizeInfo.transferencia (payload total) en la respuesta', async () => {
  const estado = payloadGrandeCatalogoChico(30000, 5000);
  const f = mockFetch([{ body: { ok: true, ts: '2026-09-10T00:00:00Z' } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f);
  assert.strictEqual(r.sizeInfo.nivel, 'ok');
  assert.ok(r.sizeInfo.transferencia > r.sizeInfo.tam, 'la transferencia (payload) es mayor que el catálogo');
});

test('getStateBreakdown: marca enCelda=true para el catálogo y false para las append-only', () => {
  const desglose = Sync.getStateBreakdown({ materia: 'x'.repeat(100), ventas: 'x'.repeat(500), config: 'x', lotes: [] });
  const porNombre = Object.fromEntries(desglose.map(d => [d.coleccion, d.enCelda]));
  assert.strictEqual(porNombre.materia, true);
  assert.strictEqual(porNombre.config, true);
  assert.strictEqual(porNombre.ventas, false);
  assert.strictEqual(porNombre.lotes, false);
  assert.strictEqual(desglose[0].coleccion, 'ventas', 'ordenado por tamaño descendente');
});

group('U1 (Ronda 4): el push declara el conjunto completo de ids (knownRecordIds)');

test('push() incluye knownRecordIds por colección cuando el estado ya se sincronizó (config.lastSync)', async () => {
  const estado = {
    config: { lastSync: '2026-09-10T00:00:00Z' },
    ventas: [{ id: 'v1' }, { id: 'v2' }],
    gastos: [{ id: 'g1' }],
    mermas: [], snapshots: [], ajustes: [], lotes: []
  };
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', estado, f, 'dueno@crumbly.co');
  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepStrictEqual(body.knownRecordIds.ventas, ['v1', 'v2']);
  assert.deepStrictEqual(body.knownRecordIds.gastos, ['g1']);
  assert.deepStrictEqual(body.knownRecordIds.mermas, []);
  assert.strictEqual(body.usuario, 'dueno@crumbly.co');
});

test('CRITERIO: push() NO declara knownRecordIds si el estado nunca se sincronizó (evita lápida masiva por estado fresco)', async () => {
  const estadoFresco = { config: { lastSync: null }, ventas: [], gastos: [] };
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', estadoFresco, f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.knownRecordIds, undefined, 'sin lastSync no se declara nada — el backend no puede confundir "vacío" con "borré todo"');
});

test('getSyncSizeHistory: sin localStorage (Node) devuelve un array vacío, nunca revienta', () => {
  assert.deepStrictEqual(Sync.getSyncSizeHistory(), []);
});

// El login (Google y correo+contraseña) se movió por completo a
// js/auth.js — ver tests/auth.test.js. sync.js ya no sabe nada de cómo
// se consigue un token, solo lo transporta (ping/pull/push/uploadFile).

(async () => {
  for (const [name, fn] of tests) {
    if (name === null) { fn(); continue; }
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

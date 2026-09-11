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

group('U0 (Ronda 4): la alarma mide el CATÁLOGO, no el payload — ahora solo en fase post (ver V1 más abajo)');

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

test('CRITERIO U0 (fase post): payload sobre 48.000 pero catálogo en ~20.000 → push() procede, sin advertencia ni bloqueo', async () => {
  const estado = payloadGrandeCatalogoChico(60000, 20000);
  assert.ok(Sync.getTransferSize(estado) > 48000, 'el payload total debe superar 48.000');
  assert.ok(Sync.getCatalogSizeInfo(estado).tam < 22000 && Sync.getCatalogSizeInfo(estado).tam >= 19000, 'el catálogo debe rondar 20.000');
  const f = mockFetch([{ body: { ok: true, ts: '2026-09-10T00:00:00Z' } }]);
  // fase 'post' explícita — este criterio es del U0 original (medir solo
  // el catálogo), que V1 ahora reserva para cuando el backend YA migró.
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f, undefined, undefined, 'post');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.length, 1, 'la petición SÍ se manda — el catálogo está sano');
  assert.strictEqual(r.sizeInfo.nivel, 'ok');
});

test('CRITERIO U0 inverso: catálogo sobre el tope con payload total chico → push() bloquea (en cualquier fase, acá payload≈catálogo)', async () => {
  const estado = catalogoDeTamano(49000); // solo config, sin ventas — payload ≈ catálogo acá
  const f = mockFetch([{ body: { ok: true } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'PAYLOAD_TOO_LARGE');
  assert.strictEqual(r.sizeInfo.nivel, 'bloqueado');
  assert.strictEqual(f.calls.length, 0, 'no debe haber intentado la petición');
});

test('push() adjunta sizeInfo + sizeInfo.transferencia en la respuesta (fase post: tam=catálogo < transferencia)', async () => {
  const estado = payloadGrandeCatalogoChico(30000, 5000);
  const f = mockFetch([{ body: { ok: true, ts: '2026-09-10T00:00:00Z' } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, f, undefined, undefined, 'post');
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

group('V1 (Ronda 5): la alarma no puede quedar ciega entre despliegues');

test('CRITERIO: fase "pre" con catálogo chico y estado grande → advierte (mide el estado completo)', () => {
  const estado = payloadGrandeCatalogoChico(42000, 2000); // catálogo chico, payload en zona de advertencia
  const info = Sync.getAlarmSizeInfo(estado, 'pre');
  assert.strictEqual(info.fase, 'pre');
  assert.strictEqual(info.tam, Sync.getTransferSize(estado), 'en fase pre se mide el estado completo, no el catálogo');
  assert.strictEqual(info.nivel, 'advertencia');
});

test('CRITERIO: fase "post" con la misma forma (catálogo chico, estado grande) → NO advierte (mide solo el catálogo)', () => {
  const estado = payloadGrandeCatalogoChico(42000, 2000);
  const info = Sync.getAlarmSizeInfo(estado, 'post');
  assert.strictEqual(info.fase, 'post');
  assert.strictEqual(info.tam, Sync.getCatalogSizeInfo(estado).tam, 'en fase post se mide solo el catálogo');
  assert.strictEqual(info.nivel, 'ok');
});

test('CRITERIO: fase indeterminable (undefined/null/backend viejo) → se comporta como "pre"', () => {
  const estado = payloadGrandeCatalogoChico(42000, 2000);
  [undefined, null, 'desconocida', ''].forEach(faseIndeterminada => {
    const info = Sync.getAlarmSizeInfo(estado, faseIndeterminada);
    assert.strictEqual(info.fase, 'pre', 'fase=' + faseIndeterminada + ' debe tratarse como pre');
    assert.strictEqual(info.tam, Sync.getTransferSize(estado));
    assert.strictEqual(info.nivel, 'advertencia');
  });
});

// (La otra mitad del criterio — "sin fase conocida, push() mide de más" —
// no se prueba contra el caché en memoria de faseMigracionConocida_
// directamente: ese caché es un singleton de módulo compartido por TODO
// este archivo de pruebas, y depender de que ningún test anterior lo haya
// poblado ya es frágil por diseño. Queda cubierto igual, sin ese riesgo:
// `getAlarmSizeInfo(estado, undefined)` de arriba prueba exactamente esa
// rama, y el test de abajo prueba que push() SÍ lee del caché cuando
// `getMigrationStatus()` lo pobló — juntos cubren la ruta completa.)

test('getMigrationStatus() cachea la fase reportada por el backend — un push posterior (sin override) la usa', async () => {
  const estado = payloadGrandeCatalogoChico(60000, 2000);
  const fStatus = mockFetch([{ body: { ok: true, ultima: null, fase: 'post' } }]);
  const rStatus = await Sync.getMigrationStatus('https://x.com/exec', 'tok', fStatus);
  assert.strictEqual(rStatus.fase, 'post');
  const fPush = mockFetch([{ body: { ok: true } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', estado, fPush); // sin override — debe usar la fase recién cacheada
  assert.strictEqual(r.ok, true, 'con la fase post cacheada, el catálogo chico deja pasar el push');
  assert.strictEqual(r.sizeInfo.fase, 'post');
  // limpieza: el caché de fase es un módulo compartido por todo el
  // archivo de pruebas — se deja de vuelta en 'pre' para no afectar los
  // tests que corren después de este.
  await Sync.getMigrationStatus('https://x.com/exec', 'tok', mockFetch([{ body: { ok: true, ultima: null, fase: 'pre' } }]));
});

group('V0 (Ronda 5): borrados pendientes — lista EXPLÍCITA, nunca por ausencia');

// sync.js guarda los borrados pendientes en localStorage (no existe en
// Node) — mismo patrón que ya usa recordSyncSize_/getSyncSizeHistory, así
// que acá se instala un localStorage falso en memoria solo para este
// grupo, y se desinstala al final (la prueba de más abajo,
// "getSyncSizeHistory: sin localStorage", sigue corriendo sin él).
function instalarLocalStorageFalso_() {
  const store = {};
  global.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
}
function desinstalarLocalStorageFalso_() { delete global.localStorage; }
tests.push([null, instalarLocalStorageFalso_]);

test('marcarBorradoPendiente agrega el id a la colección declarada, sin duplicar si se llama dos veces', () => {
  Sync.marcarBorradoPendiente('gastos', 'g1');
  Sync.marcarBorradoPendiente('gastos', 'g1');
  Sync.marcarBorradoPendiente('gastos', 'g2');
  assert.deepStrictEqual(Sync.getBorradosPendientes(), { gastos: ['g1', 'g2'] });
});

test('CRITERIO: push() manda idsABorrar con exactamente lo declarado — nunca "lo que tengo"', async () => {
  desinstalarLocalStorageFalso_(); instalarLocalStorageFalso_(); // estado limpio para este test
  Sync.marcarBorradoPendiente('ventas', 'v3');
  Sync.marcarBorradoPendiente('gastos', 'g1');
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {}, ventas: [{ id: 'v1' }, { id: 'v2' }] }, f, 'dueno@crumbly.co');
  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepStrictEqual(body.idsABorrar, { ventas: ['v3'], gastos: ['g1'] });
  assert.strictEqual(body.usuario, 'dueno@crumbly.co');
});

test('CRITERIO: push() exitoso limpia SOLO los ids que mandó — no manda idsABorrar si no hay nada pendiente', async () => {
  desinstalarLocalStorageFalso_(); instalarLocalStorageFalso_();
  const fSinPendientes = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, fSinPendientes);
  const bodySinPendientes = JSON.parse(fSinPendientes.calls[0].opts.body);
  assert.strictEqual(bodySinPendientes.idsABorrar, undefined, 'sin nada pendiente, no se manda el campo');

  Sync.marcarBorradoPendiente('mermas', 'm1');
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, f);
  assert.deepStrictEqual(Sync.getBorradosPendientes(), {}, 'push exitoso limpia lo que mandó');
});

test('CRITERIO: un push que falla deja los borrados pendientes — el siguiente los reintenta', async () => {
  desinstalarLocalStorageFalso_(); instalarLocalStorageFalso_();
  Sync.marcarBorradoPendiente('lotes', 'l1');
  const fFalla = mockFetch([{ body: { ok: false, error: 'CATALOG_CONFLICT', code: 'CATALOG_CONFLICT', remoteState: {}, remoteVersion: 1 } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, fFalla, undefined, 0);
  assert.deepStrictEqual(Sync.getBorradosPendientes(), { lotes: ['l1'] }, 'push con ok:false no limpia nada pendiente');

  // el siguiente push (reintento) vuelve a mandar la misma lista
  const fReintento = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, fReintento);
  const body = JSON.parse(fReintento.calls[0].opts.body);
  assert.deepStrictEqual(body.idsABorrar, { lotes: ['l1'] });
  assert.deepStrictEqual(Sync.getBorradosPendientes(), {}, 'y esta vez sí se limpia, porque el push tuvo éxito');
});

tests.push([null, desinstalarLocalStorageFalso_]);

group('U4 (Ronda 4): C2 — push() declara baseCatalogVersion');

test('push() incluye baseCatalogVersion cuando se pasa explícitamente', async () => {
  const f = mockFetch([{ body: { ok: true, catalogVersion: 5 } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, f, undefined, 4);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.baseCatalogVersion, 4);
});

test('push() no manda baseCatalogVersion si no se pasa (compatibilidad con un cliente/llamada vieja)', async () => {
  const f = mockFetch([{ body: { ok: true } }]);
  await Sync.push('https://x.com/exec', 'tok', { config: {} }, f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.baseCatalogVersion, undefined);
});

test('push() propaga CATALOG_CONFLICT del backend (remoteState + remoteVersion) sin lanzar', async () => {
  const f = mockFetch([{ body: { ok: false, error: 'CATALOG_CONFLICT', code: 'CATALOG_CONFLICT', remoteState: { materia: [] }, remoteVersion: 7 } }]);
  const r = await Sync.push('https://x.com/exec', 'tok', { config: {} }, f, undefined, 3);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'CATALOG_CONFLICT');
  assert.strictEqual(r.remoteVersion, 7);
  assert.deepStrictEqual(r.remoteState, { materia: [] });
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

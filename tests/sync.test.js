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

group('login');

test('manda POST con action=login, email y password, sin token (todavía no lo tiene)', async () => {
  const f = mockFetch([{ body: { ok: true, token: 'tok-real-secreto' } }]);
  await Sync.login('https://x.com/exec', 'crumbly@correo.com', 'clave123', f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.action, 'login');
  assert.strictEqual(body.email, 'crumbly@correo.com');
  assert.strictEqual(body.password, 'clave123');
  assert.strictEqual(body.token, undefined);
});

test('devuelve el token real que entrega el backend', async () => {
  const f = mockFetch([{ body: { ok: true, token: 'tok-real-secreto' } }]);
  const r = await Sync.login('https://x.com/exec', 'crumbly@correo.com', 'clave123', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, 'tok-real-secreto');
});

test('propaga ok:false si el correo o la contraseña son incorrectos', async () => {
  const f = mockFetch([{ body: { ok: false, error: 'correo o contraseña incorrectos' } }]);
  const r = await Sync.login('https://x.com/exec', 'otro@correo.com', 'clave-mala', f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'correo o contraseña incorrectos');
});

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

/**
 * Tests de autenticación (js/auth.js). Correr con:
 * node tests/auth.test.js
 * Sin red real — se inyecta un fetch de prueba. localStorage tampoco
 * existe en Node por defecto, así que se inyecta una implementación
 * mínima en memoria antes de requerir el módulo (auth.js la usa igual
 * que la usaría un navegador real).
 */
const assert = require('assert');
const path = require('path');
const authPath = path.join(__dirname, '..', 'js', 'auth.js');

// Falso localStorage en memoria — persiste entre llamadas dentro del
// mismo proceso, igual que el real dentro de una misma pestaña.
function fakeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
}
global.localStorage = fakeLocalStorage();

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function group(name) { tests.push([null, () => console.log('\n== ' + name + ' ==')]); }

function mockFetch(responses) {
  const calls = [];
  const fetchFn = (url, opts) => {
    calls.push({ url, opts: opts || {} });
    const r = responses.shift() || { body: { success: false, error: 'sin más respuestas mockeadas' } };
    return Promise.resolve({
      ok: r.status === undefined || r.status < 400,
      status: r.status || 200,
      json: () => Promise.resolve(r.body)
    });
  };
  fetchFn.calls = calls;
  return fetchFn;
}

// Requiere una instancia FRESCA del módulo — auth.js guarda la sesión en
// una variable de módulo, así que reusar el mismo `require` entre tests
// arrastraría estado de un test a otro (justo lo que restoreSession()
// necesita poder probar: "cerrar y volver a abrir la pestaña").
function freshAuth() {
  delete require.cache[require.resolve(authPath)];
  return require(authPath);
}

const usuarioGoogle = { id: 'sub123', email: 'duena@correo.com', nombre: 'Duena', foto: 'https://x/foto.jpg', rol: 'dueño' };

group('loginGoogle');

test('manda POST con action=authGoogle e idToken', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  await auth.loginGoogle('jwt-de-google', f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.action, 'authGoogle');
  assert.strictEqual(body.idToken, 'jwt-de-google');
});

test('usa POST con Content-Type text/plain (evita el preflight de Apps Script)', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  await auth.loginGoogle('jwt-de-google', f);
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.strictEqual(f.calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('al iniciar sesión, isAuthenticated/getCurrentUser/getToken quedan poblados', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  assert.strictEqual(auth.isAuthenticated(), false);
  await auth.loginGoogle('jwt-de-google', f);
  assert.strictEqual(auth.isAuthenticated(), true);
  assert.deepStrictEqual(auth.getCurrentUser(), usuarioGoogle);
  assert.strictEqual(auth.getToken(), 'tok-sesion-1');
});

test('rechaza la promesa con el error del backend si success:false', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: false, error: 'correo no autorizado' } }]);
  await assert.rejects(() => auth.loginGoogle('jwt-de-otra-cuenta', f), /correo no autorizado/);
  assert.strictEqual(auth.isAuthenticated(), false);
});

group('loginEmail (opcional)');

test('manda POST con action=login, email y password', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-sesion-2' } }]);
  await auth.loginEmail('duena@correo.com', 'clave123', f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.action, 'login');
  assert.strictEqual(body.email, 'duena@correo.com');
  assert.strictEqual(body.password, 'clave123');
});

test('rechaza la promesa si el correo o la contraseña son incorrectos', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: false, error: 'correo o contraseña incorrectos' } }]);
  await assert.rejects(() => auth.loginEmail('otro@correo.com', 'mala', f), /correo o contraseña incorrectos/);
});

group('restoreSession — sobrevive a "cerrar y volver a abrir la pestaña"');

test('una sesión guardada por loginGoogle se recupera con restoreSession() en una instancia nueva', async () => {
  const auth1 = freshAuth();
  const f = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-persistido' } }]);
  await auth1.loginGoogle('jwt-de-google', f);

  const auth2 = freshAuth(); // simula recargar la página: módulo nuevo, localStorage igual
  assert.strictEqual(auth2.isAuthenticated(), false); // todavía no llamó restoreSession()
  auth2.restoreSession();
  assert.strictEqual(auth2.isAuthenticated(), true);
  assert.deepStrictEqual(auth2.getCurrentUser(), usuarioGoogle);
  assert.strictEqual(auth2.getToken(), 'tok-persistido');
});

test('sin sesión guardada, restoreSession() no autentica', () => {
  global.localStorage = fakeLocalStorage(); // limpio, sin nada guardado
  const auth = freshAuth();
  auth.restoreSession();
  assert.strictEqual(auth.isAuthenticated(), false);
  assert.strictEqual(auth.getCurrentUser(), null);
});

group('logout');

test('borra la sesión local y avisa al backend con action=logout+token', async () => {
  global.localStorage = fakeLocalStorage();
  const auth = freshAuth();
  const fLogin = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-a-cerrar' } }]);
  await auth.loginGoogle('jwt-de-google', fLogin);
  assert.strictEqual(auth.isAuthenticated(), true);

  const fLogout = mockFetch([{ body: { ok: true } }]);
  auth.logout(fLogout);
  assert.strictEqual(auth.isAuthenticated(), false);
  assert.strictEqual(auth.getCurrentUser(), null);
  const body = JSON.parse(fLogout.calls[0].opts.body);
  assert.strictEqual(body.action, 'logout');
  assert.strictEqual(body.token, 'tok-a-cerrar');
});

test('tras logout, una instancia nueva ya no encuentra sesión guardada', async () => {
  global.localStorage = fakeLocalStorage();
  const auth1 = freshAuth();
  const fLogin = mockFetch([{ body: { success: true, user: usuarioGoogle, token: 'tok-x' } }]);
  await auth1.loginGoogle('jwt-de-google', fLogin);
  auth1.logout(mockFetch([{ body: { ok: true } }]));

  const auth2 = freshAuth();
  auth2.restoreSession();
  assert.strictEqual(auth2.isAuthenticated(), false);
});

group('getBackendUrl');

test('devuelve una URL fija (no configurable a mano)', () => {
  const auth = freshAuth();
  assert.ok(/^https:\/\/script\.google\.com\//.test(auth.getBackendUrl()));
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

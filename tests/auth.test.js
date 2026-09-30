/**
 * Tests de autenticación (js/auth.js). Correr con:
 * node tests/auth.test.js
 * Sin red real — se inyecta un fetch de prueba (Apps Script) y un
 * cliente de Supabase falso (auth.setSupabase). localStorage tampoco
 * existe en Node por defecto, así que se inyecta una implementación
 * mínima en memoria antes de requerir el módulo (auth.js la usa igual
 * que la usaría un navegador real).
 */
const assert = require('assert');
const nodeCrypto = require('crypto');
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
//
// Por defecto trae inyectado un Supabase falso que acepta el login (el
// correo está en `usuarios` y activo), para que los tests de Apps Script
// de siempre sigan probando solo lo suyo.
function freshAuth(sb) {
  delete require.cache[require.resolve(authPath)];
  const auth = require(authPath);
  auth.setSupabase(sb === undefined ? fakeSupabase() : sb);
  return auth;
}

// Cliente de Supabase falso — solo lo que auth.js usa:
// auth.signInWithIdToken, auth.signOut y
// from('usuarios').select(...).eq('email', x).maybeSingle().
// `usuarios` es la tabla (email → fila); `signInError` simula que
// Supabase rechace el ID token (p.ej. nonce que no coincide).
function fakeSupabase(opts) {
  opts = opts || {};
  const email = opts.email || 'duena@correo.com';
  const usuarios = opts.usuarios || { [email]: { email, nombre: 'Duena', rol: 'admin', activo: true } };
  const calls = { signIn: [], signOut: 0, eq: [] };
  let sesionAbierta = false;
  return {
    calls,
    get sesionAbierta() { return sesionAbierta; },
    auth: {
      signInWithIdToken(creds) {
        calls.signIn.push(creds);
        if (opts.signInError) return Promise.resolve({ data: { user: null, session: null }, error: { message: opts.signInError } });
        sesionAbierta = true;
        return Promise.resolve({ data: { user: { email: email.toUpperCase() }, session: {} }, error: null });
      },
      signOut(opts) {
        calls.signOut++;
        calls.signOutScope = opts && opts.scope;
        sesionAbierta = false;
        return Promise.resolve({ error: null });
      }
    },
    from(tabla) {
      assert.strictEqual(tabla, 'usuarios');
      return {
        select() { return this; },
        eq(col, val) { calls.eq.push([col, val]); this._email = val; return this; },
        maybeSingle() { return Promise.resolve({ data: usuarios[this._email] || null, error: null }); }
      };
    }
  };
}

const loginOk = () => mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);

const usuarioGoogle = { id: 1, email: 'duena@correo.com', nombre: 'Duena', rol: 'admin' };

group('loginGoogle — única forma de entrar');

test('manda POST con action=authGoogle e idToken', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  await auth.loginGoogle('jwt-de-google', f);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(body.action, 'authGoogle');
  assert.strictEqual(body.idToken, 'jwt-de-google');
});

test('usa POST con Content-Type text/plain (evita el preflight de Apps Script)', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  await auth.loginGoogle('jwt-de-google', f);
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.strictEqual(f.calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('al iniciar sesión, isAuthenticated/getCurrentUser/getToken quedan poblados', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-sesion-1' } }]);
  assert.strictEqual(auth.isAuthenticated(), false);
  await auth.loginGoogle('jwt-de-google', f);
  assert.strictEqual(auth.isAuthenticated(), true);
  assert.deepStrictEqual(auth.getCurrentUser(), usuarioGoogle);
  assert.strictEqual(auth.getToken(), 'tok-sesion-1');
});

test('rechaza la promesa con el message del backend si el correo no está en la hoja "usuarios"', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: false, authorized: false, message: 'Usuario no autorizado' } }]);
  await assert.rejects(() => auth.loginGoogle('jwt-de-otra-cuenta', f), /Usuario no autorizado/);
  assert.strictEqual(auth.isAuthenticated(), false);
});

test('rechaza la promesa si el usuario existe pero está desactivado', async () => {
  const auth = freshAuth();
  const f = mockFetch([{ body: { success: false, authorized: false, message: 'Usuario desactivado' } }]);
  await assert.rejects(() => auth.loginGoogle('jwt-de-cuenta-desactivada', f), /Usuario desactivado/);
  assert.strictEqual(auth.isAuthenticated(), false);
});

group('restoreSession — sobrevive a "cerrar y volver a abrir la pestaña"');

test('una sesión guardada por loginGoogle se recupera con restoreSession() en una instancia nueva', async () => {
  const auth1 = freshAuth();
  const f = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-persistido' } }]);
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
  const fLogin = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-a-cerrar' } }]);
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
  const fLogin = mockFetch([{ body: { success: true, authorized: true, user: usuarioGoogle, token: 'tok-x' } }]);
  await auth1.loginGoogle('jwt-de-google', fLogin);
  auth1.logout(mockFetch([{ body: { ok: true } }]));

  const auth2 = freshAuth();
  auth2.restoreSession();
  assert.strictEqual(auth2.isAuthenticated(), false);
});

group('Supabase — signInWithIdToken + nonce');

test('prepareGoogleNonce devuelve el SHA-256 hex del nonce crudo que se le pasa a Supabase', async () => {
  const sb = fakeSupabase();
  const auth = freshAuth(sb);
  const hashed = await auth.prepareGoogleNonce();
  assert.ok(/^[0-9a-f]{64}$/.test(hashed), 'hash en hex de 64 caracteres');
  await auth.loginGoogle('jwt-de-google', loginOk());
  const creds = sb.calls.signIn[0];
  assert.strictEqual(creds.provider, 'google');
  assert.strictEqual(creds.token, 'jwt-de-google');
  assert.ok(creds.nonce && creds.nonce !== hashed, 'a Supabase va el nonce CRUDO, no el hash');
  assert.strictEqual(nodeCrypto.createHash('sha256').update(creds.nonce).digest('hex'), hashed);
});

test('prepareGoogleNonce llamado dos veces (gate + onload) devuelve el mismo hash', async () => {
  const auth = freshAuth();
  const [a, b] = await Promise.all([auth.prepareGoogleNonce(), auth.prepareGoogleNonce()]);
  assert.strictEqual(a, b);
  assert.strictEqual(await auth.prepareGoogleNonce(), a);
});

test('un login fallido NO rota el nonce (el botón sigue con el mismo hash); uno exitoso sí', async () => {
  const auth = freshAuth(fakeSupabase({ usuarios: {} }));
  const h1 = await auth.prepareGoogleNonce();
  await assert.rejects(() => auth.loginGoogle('jwt', loginOk()));
  assert.strictEqual(await auth.prepareGoogleNonce(), h1);
  auth.setSupabase(fakeSupabase());
  await auth.loginGoogle('jwt', loginOk());
  assert.notStrictEqual(await auth.prepareGoogleNonce(), h1);
});

test('busca en `usuarios` el correo en minúsculas', async () => {
  const sb = fakeSupabase();
  const auth = freshAuth(sb);
  await auth.loginGoogle('jwt-de-google', loginOk());
  assert.deepStrictEqual(sb.calls.eq[0], ['email', 'duena@correo.com']);
});

group('Supabase — allow-list `usuarios`');

test('rechaza si el correo no está en `usuarios` de Supabase, cierra esa sesión y no llama a Apps Script', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase({ usuarios: {} });
  const auth = freshAuth(sb);
  const f = loginOk();
  await assert.rejects(() => auth.loginGoogle('jwt-de-otra-cuenta', f), /Usuario no autorizado/);
  assert.strictEqual(sb.calls.signOut, 1);
  assert.strictEqual(sb.sesionAbierta, false);
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(auth.isAuthenticated(), false);
});

test('rechaza si el usuario está con activo=false en Supabase, y cierra esa sesión', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase({ usuarios: { 'duena@correo.com': { email: 'duena@correo.com', activo: false } } });
  const auth = freshAuth(sb);
  await assert.rejects(() => auth.loginGoogle('jwt', loginOk()), /Usuario desactivado/);
  assert.strictEqual(sb.calls.signOut, 1);
  assert.strictEqual(sb.sesionAbierta, false);
  assert.strictEqual(auth.isAuthenticated(), false);
});

group('Los dos backends tienen que aceptar');

test('si Supabase rechaza el ID token, el login falla sin tocar Apps Script ni dejar sesión', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase({ signInError: 'Nonces mismatch' });
  const auth = freshAuth(sb);
  const f = loginOk();
  await assert.rejects(() => auth.loginGoogle('jwt', f), /Supabase: Nonces mismatch/);
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(auth.isAuthenticated(), false);
  assert.strictEqual(freshAuth().restoreSession(), null);
});

test('si Apps Script rechaza después de que Supabase aceptó, se cierra la sesión de Supabase', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase();
  const auth = freshAuth(sb);
  const f = mockFetch([{ body: { success: false, authorized: false, message: 'Usuario no autorizado' } }]);
  await assert.rejects(() => auth.loginGoogle('jwt', f), /Usuario no autorizado/);
  assert.strictEqual(sb.calls.signOut, 1);
  assert.strictEqual(sb.sesionAbierta, false);
  assert.strictEqual(auth.isAuthenticated(), false);
  assert.strictEqual(freshAuth().restoreSession(), null);
});

test('si Apps Script falla por red/HTTP, también se cierra la sesión de Supabase', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase();
  const auth = freshAuth(sb);
  await assert.rejects(() => auth.loginGoogle('jwt', mockFetch([{ status: 500, body: {} }])), /HTTP 500/);
  assert.strictEqual(sb.sesionAbierta, false);
  assert.strictEqual(auth.isAuthenticated(), false);
});

test('sin supabase-js cargado (CDN caído), el login falla con un mensaje claro', async () => {
  const auth = freshAuth(null);
  const f = loginOk();
  await assert.rejects(auth.loginGoogle('jwt', f), /No se pudo cargar Supabase/); // promesa rechazada, no throw síncrono
  assert.strictEqual(f.calls.length, 0);
});

test('logout también cierra la sesión de Supabase', async () => {
  global.localStorage = fakeLocalStorage();
  const sb = fakeSupabase();
  const auth = freshAuth(sb);
  await auth.loginGoogle('jwt', loginOk());
  assert.strictEqual(sb.sesionAbierta, true);
  auth.logout(mockFetch([{ body: { ok: true } }]));
  assert.strictEqual(sb.calls.signOut, 1);
  assert.strictEqual(sb.sesionAbierta, false);
  // 'local': no revoca la sesión de la misma cuenta en otros dispositivos
  assert.strictEqual(sb.calls.signOutScope, 'local');
});

test('logout sin supabase-js cargado no revienta', () => {
  const auth = freshAuth(null);
  auth.logout(mockFetch([]));
  assert.strictEqual(auth.isAuthenticated(), false);
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

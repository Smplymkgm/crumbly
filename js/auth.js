/**
 * Crumbly — autenticación (Google Identity Services + sesión).
 *
 * Herramienta de uso interno: la ÚNICA forma de entrar es con Google, y
 * solo funciona para un correo que el backend ya tenga autorizado en la
 * hoja "usuarios" (sin registro público, sin crear cuenta, sin recuperar
 * contraseña — ver backend/Code.gs). Un login válido devuelve un token
 * de SESIÓN propio de este dispositivo (no un secreto compartido por
 * toda la app) — ver backend/Code.gs § "Sesiones".
 *
 * La sesión vive en su PROPIA llave de localStorage ('crumbly-session'),
 * separada de 'crumbly-state'. A propósito: el token de sesión es un
 * dato de ESTE dispositivo, no un dato del negocio — si viviera dentro
 * de `state.config` terminaría viajando dentro de cada push/pull y
 * quedando guardado en la hoja de cálculo (state_json), y un dispositivo
 * podría sobrescribir la sesión de otro en cada sincronización. Por eso
 * js/core.js y js/sync.js no saben nada de esto: auth.js es el único
 * dueño de la sesión.
 *
 * Transición a Supabase (ver supabase/migrations/0001_init.sql): un
 * login con Google abre DOS sesiones con el mismo ID token de Google, y
 * tienen que salir bien las dos:
 *   1. Supabase Auth (signInWithIdToken) — la sesión nueva. supabase-js
 *      guarda y refresca su propio JWT en localStorage (llave aparte,
 *      sb-…-auth-token); acá solo se abre y se cierra. La tabla
 *      `usuarios` de Supabase es el allow-list: si el correo no está, o
 *      está con activo=false, se cierra la sesión recién abierta y el
 *      login falla.
 *   2. Apps Script (acción authGoogle, la de siempre) — pull/push todavía
 *      corren contra Sheets hasta el corte, y la subida de comprobantes
 *      (CrumblySync.uploadFile) se queda en Apps Script para siempre.
 * Code.gs verifica el token con tokeninfo e ignora el `nonce`; Supabase
 * sí lo exige (ver prepareGoogleNonce).
 *
 * Sin DOM más allá de lo que Google Identity Services necesita para
 * dibujar su propio botón — el resto (restaurar sesión, cerrar sesión)
 * es lógica pura, igual que js/core.js.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.auth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SESSION_KEY = 'crumbly-session';

  // URL fija del backend desplegado — no es secreta (sin una sesión
  // válida, el backend rechaza cualquier pedido, ver Code.gs). Vive acá
  // en vez de en `state.config`: es la misma para todo el mundo, no algo
  // que cada dispositivo configure.
  var BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwh-0SpF-QLYnvq50b2RjM_sKqQTbCuOvkS7Gn6NQUDQDeB-jP1f7G9kkS75-AcVhGxxA/exec';

  // Proyecto de Supabase — la URL y la llave "publishable" son públicas
  // por diseño (van en el cliente); lo que protege los datos es RLS +
  // la tabla `usuarios`, no esta llave.
  var SUPABASE_URL = 'https://inwyianmcpiykohragah.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_Hx8jpaqQy00W51Jx2mSYTA_TtCni105';

  var session = null; // { token, user:{id,email,nombre,rol} } | null  (sesión de Apps Script)
  var supabaseClient = null; // se crea perezosamente en getSupabase(), o se inyecta con setSupabase()
  var noncePromise = null; // Promise<{ raw, hashed }> — uno solo por intento de login, ver prepareGoogleNonce

  function resolveFetch(fetchImpl) {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch !== 'undefined') return fetch;
    throw new Error('fetch no disponible en este entorno');
  }

  // Mismo truco que js/sync.js: Content-Type text/plain evita el
  // preflight OPTIONS que Apps Script no responde bien.
  function postJson_(action, payload, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    var body = Object.assign({ action: action }, payload);
    return f(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // Cliente de supabase-js. En el navegador sale del UMD
  // (window.supabase.createClient, cargado antes que este archivo en
  // index.html); en los tests se inyecta uno falso con setSupabase().
  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    var lib = typeof window !== 'undefined' ? window.supabase : undefined;
    if (!lib || typeof lib.createClient !== 'function') {
      throw new Error('No se pudo cargar Supabase — revisá tu conexión y recargá la página');
    }
    supabaseClient = lib.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  function setSupabase(client) {
    supabaseClient = client || null;
  }

  // Web Crypto: global en navegadores y en Node 19+; en Node 18 sin
  // flag hay que ir a buscarlo al módulo 'crypto'.
  function getCrypto_() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    if (typeof require === 'function') return require('crypto').webcrypto;
    throw new Error('Web Crypto no disponible en este entorno');
  }

  function toHex_(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  function sha256Hex(text) {
    var c = getCrypto_();
    return c.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return toHex_(new Uint8Array(buf));
    });
  }

  // Nonce para Google Identity Services + Supabase (patrón documentado
  // por Supabase para GIS / One Tap): a Google se le da el SHA-256 (hex)
  // de un valor al azar — queda firmado dentro del ID token — y a
  // Supabase el valor crudo, que lo vuelve a hashear y compara. Así un ID
  // token robado de otro lado no sirve para abrir sesión acá.
  //
  // Se genera UNA sola vez y se reusa (misma promesa) hasta el próximo
  // login exitoso: initGoogleSignIn se llama dos veces (desde
  // showLoginGate y desde el onload del script de Google), y si cada
  // llamada generara un nonce distinto, el botón quedaría inicializado
  // con un hash que ya no corresponde al valor crudo guardado acá. Un
  // login fallido NO lo rota — el botón sigue dibujado con el mismo hash
  // y el reintento tiene que poder usarlo.
  function prepareGoogleNonce() {
    if (!noncePromise) {
      var bytes = new Uint8Array(32);
      getCrypto_().getRandomValues(bytes);
      var raw = toHex_(bytes);
      noncePromise = sha256Hex(raw).then(function (hashed) {
        return { raw: raw, hashed: hashed };
      });
    }
    return noncePromise.then(function (n) { return n.hashed; });
  }

  function readStoredSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStoredSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      // localStorage lleno/no disponible — la sesión sigue viva en memoria
      // para esta pestaña; se pedirá login de nuevo al recargar.
    }
  }

  // Carga la sesión guardada (si hay) al abrir la app. Síncrono y
  // offline-first, igual que loadState() en index.html — no espera a la
  // red para decidir si mostrar la app o la pantalla de login.
  function restoreSession() {
    session = readStoredSession();
    return session;
  }

  function isAuthenticated() {
    return !!(session && session.token);
  }

  function getCurrentUser() {
    return session ? session.user : null;
  }

  function getToken() {
    return session ? session.token : null;
  }

  function getBackendUrl() {
    return BACKEND_URL;
  }

  // Si el backend rechaza el login (no autorizado, desactivado, token de
  // Google inválido) responde success:false + authorized:false + message
  // — ver backend/Code.gs § authGoogle_. Nunca crea una sesión en ese caso.
  function applySession_(r) {
    if (!r.success) throw new Error(r.message || 'No se pudo iniciar sesión');
    session = { token: r.token, user: r.user };
    writeStoredSession(session);
    return session.user;
  }

  // Paso 1 del login: abre la sesión de Supabase con el mismo ID token y
  // chequea la tabla `usuarios` (el allow-list). Si el correo no está o
  // está desactivado, cierra la sesión recién abierta antes de fallar —
  // nunca queda una sesión de Supabase de alguien no autorizado.
  function loginSupabase_(idToken) {
    var sb = getSupabase();
    var nonceP = noncePromise ? noncePromise.then(function (n) { return n.raw; }) : Promise.resolve(undefined);
    return nonceP.then(function (rawNonce) {
      var creds = { provider: 'google', token: idToken };
      if (rawNonce) creds.nonce = rawNonce;
      return sb.auth.signInWithIdToken(creds);
    }).then(function (r) {
      if (r.error) throw new Error('No se pudo iniciar sesión en Supabase: ' + r.error.message);
      var email = String((r.data && r.data.user && r.data.user.email) || '').trim().toLowerCase();
      return sb.from('usuarios').select('email,nombre,rol,activo').eq('email', email).maybeSingle()
        .then(function (u) {
          if (u.error) throw new Error('No se pudo verificar el usuario: ' + u.error.message);
          if (!u.data) throw new Error('Usuario no autorizado');
          if (!u.data.activo) throw new Error('Usuario desactivado');
        })
        .catch(function (err) {
          return signOutSupabase_().then(function () { throw err; });
        });
    });
  }

  function signOutSupabase_() {
    try {
      return Promise.resolve(getSupabase().auth.signOut()).catch(function () {});
    } catch (e) {
      return Promise.resolve(); // sin cliente de Supabase no hay nada que cerrar
    }
  }

  // Cambia un ID token de Google (JWT firmado, obtenido en el navegador
  // con Google Identity Services) por una sesión real — en Supabase y en
  // Apps Script, en ese orden (ver encabezado). Los dos lo verifican
  // contra Google y contra su allow-list antes de confiar en él. Si
  // cualquiera de los dos falla, el login falla y no queda sesión en
  // ninguno: si Apps Script rechaza después de que Supabase aceptó, se
  // cierra la de Supabase. Es la ÚNICA forma de entrar — no hay registro
  // ni contraseña propia de la app.
  function loginGoogle(idToken, fetchImpl) {
    // Promise.resolve().then: si supabase-js no cargó, getSupabase() tira —
    // que eso llegue como promesa rechazada, no como excepción síncrona.
    return Promise.resolve().then(function () {
      return loginSupabase_(idToken);
    }).then(function () {
      return postJson_('authGoogle', { idToken: idToken }, fetchImpl)
        .then(applySession_)
        .catch(function (err) {
          return signOutSupabase_().then(function () { throw err; });
        });
    }).then(function (user) {
      noncePromise = null; // el próximo login (tras un logout) arranca con un nonce nuevo
      return user;
    });
  }

  function logout(fetchImpl) {
    var token = getToken();
    session = null;
    writeStoredSession(null);
    if (token) postJson_('logout', { token: token }, fetchImpl).catch(function () {});
    signOutSupabase_();
  }

  return {
    loginGoogle: loginGoogle,
    logout: logout,
    getCurrentUser: getCurrentUser,
    isAuthenticated: isAuthenticated,
    restoreSession: restoreSession,
    getToken: getToken,
    getBackendUrl: getBackendUrl,
    getSupabase: getSupabase,
    setSupabase: setSupabase,
    prepareGoogleNonce: prepareGoogleNonce
  };
});

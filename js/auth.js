/**
 * Crumbly — autenticación (Google Identity Services + sesión).
 *
 * Reemplaza por completo el modelo anterior de un token fijo que había
 * que copiar y pegar a mano. Ahora: Google (o, opcionalmente, correo +
 * contraseña) autentica contra el backend, que devuelve un token de
 * SESIÓN propio de este dispositivo (no un secreto compartido por toda
 * la app) — ver backend/Code.gs § "Sesiones".
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
 * Sin DOM más allá de lo que Google Identity Services necesita para
 * dibujar su propio botón — el resto (login por correo, restaurar
 * sesión, cerrar sesión) es lógica pura, igual que js/core.js.
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

  var session = null; // { token, user:{id,email,nombre,foto,rol} } | null

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

  function applySession_(r) {
    if (!r.success) throw new Error(r.error || 'No se pudo iniciar sesión');
    session = { token: r.token, user: r.user };
    writeStoredSession(session);
    return session.user;
  }

  // Cambia un ID token de Google (JWT firmado, obtenido en el navegador
  // con Google Identity Services) por una sesión real — el backend lo
  // verifica contra Google antes de confiar en él.
  function loginGoogle(idToken, fetchImpl) {
    return postJson_('authGoogle', { idToken: idToken }, fetchImpl).then(applySession_);
  }

  // Camino opcional: correo + contraseña, sin pasar por Google.
  function loginEmail(email, password, fetchImpl) {
    return postJson_('login', { email: email, password: password }, fetchImpl).then(applySession_);
  }

  function logout(fetchImpl) {
    var token = getToken();
    session = null;
    writeStoredSession(null);
    if (token) postJson_('logout', { token: token }, fetchImpl).catch(function () {});
  }

  return {
    loginGoogle: loginGoogle,
    loginEmail: loginEmail,
    logout: logout,
    getCurrentUser: getCurrentUser,
    isAuthenticated: isAuthenticated,
    restoreSession: restoreSession,
    getToken: getToken,
    getBackendUrl: getBackendUrl
  };
});

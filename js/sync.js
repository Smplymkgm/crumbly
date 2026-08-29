/**
 * Crumbly — cliente de sincronización con el backend de Google Sheets
 * (Fase E, HANDOFF.md §12). Sin DOM: solo construye las peticiones y
 * parsea las respuestas. index.html decide cuándo llamarlo y qué hacer
 * con el resultado (igual que js/core.js con la lógica de negocio).
 *
 * `token` en cada función es el token de SESIÓN que entrega js/auth.js
 * tras iniciar sesión (Google o correo+contraseña) — este archivo no
 * sabe nada de cómo se consigue, solo lo transporta. El login en sí vive
 * en auth.js, no acá.
 *
 * POST va con Content-Type: text/plain — Apps Script no responde bien a
 * un preflight OPTIONS, así que se evita a propósito (HANDOFF.md §12.4).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CrumblySync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isConfigured(backendUrl, token) {
    return !!(backendUrl && backendUrl.trim() && token && token.trim());
  }

  function resolveFetch(fetchImpl) {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch !== 'undefined') return fetch;
    throw new Error('fetch no disponible en este entorno');
  }

  function withQuery(url, params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return url + (url.indexOf('?') === -1 ? '?' : '&') + qs;
  }

  function parseResponse(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function ping(backendUrl, token, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    return f(withQuery(backendUrl, { action: 'ping', token: token })).then(parseResponse);
  }

  function pull(backendUrl, token, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    return f(withQuery(backendUrl, { action: 'pull', token: token })).then(parseResponse);
  }

  function push(backendUrl, token, state, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    var body = JSON.stringify({ token: token, action: 'push', state: state });
    return f(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    }).then(parseResponse);
  }

  // Sube un comprobante (foto/PDF de pago) a Drive vía el backend — data
  // ya viene en base64 (index.html la arma con FileReader). Devuelve
  // { ok, url, fileId } — url es lo que se guarda en venta.comprobante /
  // gasto.comprobante en vez de solo el nombre del archivo.
  function uploadFile(backendUrl, token, filename, mimeType, base64Data, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    var body = JSON.stringify({ token: token, action: 'uploadComprobante', filename: filename, mimeType: mimeType, data: base64Data });
    return f(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    }).then(parseResponse);
  }

  return {
    isConfigured: isConfigured,
    ping: ping,
    pull: pull,
    push: push,
    uploadFile: uploadFile
  };
});

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

  // ─── T0: alarma de tamaño de payload (auditoría Ronda 3) ───────────────
  //
  // El modo de falla real: `state_json!A1` tiene un tope de ~50.000
  // caracteres (límite de una celda de Google Sheets). Antes de esta
  // versión, superar el tope hacía que la escritura fallara EN SILENCIO
  // — el usuario seguía operando creyendo que se guardaba. Esto mide el
  // tamaño ANTES de intentar escribir, no después de que falle.
  var TOPE_PAYLOAD_CHARS = 50000;
  var BLOQUEO_PAYLOAD_CHARS = 48000; // por debajo del tope real — margen de seguridad
  var ADVERTENCIA_PAYLOAD_CHARS = 40000;

  function getPayloadSizeInfo(state) {
    var tam = JSON.stringify(state).length;
    var nivel = tam >= BLOQUEO_PAYLOAD_CHARS ? 'bloqueado' : (tam >= ADVERTENCIA_PAYLOAD_CHARS ? 'advertencia' : 'ok');
    return { tam: tam, tope: TOPE_PAYLOAD_CHARS, bloqueo: BLOQUEO_PAYLOAD_CHARS, advertencia: ADVERTENCIA_PAYLOAD_CHARS, pct: tam / TOPE_PAYLOAD_CHARS, nivel: nivel };
  }

  // Desglose por colección de nivel superior — el mismo cálculo que
  // produjo la tabla de la auditoría (`JSON.stringify(state[k]).length`
  // por cada `k`), para que Ajustes pueda mostrarlo sin abrir la consola.
  // Ordenado descendente: lo más pesado primero.
  function getPayloadBreakdown(state) {
    return Object.keys(state || {})
      .map(function (k) { return { coleccion: k, tam: JSON.stringify(state[k]).length }; })
      .sort(function (a, b) { return b.tam - a.tam; });
  }

  // Buffer corto de tendencia (últimos N tamaños de sync EXITOSOS) — en
  // localStorage, nunca en el estado sincronizado (si viviera en `state`
  // viajaría en cada push/pull y terminaría contando contra el mismo
  // tope que se supone que vigila). Sigue el mismo patrón defensivo que
  // ya usa js/auth.js con su propia sesión: probar y tragarse el error si
  // localStorage no existe (Node) o está bloqueado.
  var SIZE_HISTORY_KEY = 'crumbly-sync-size-history';
  var SIZE_HISTORY_MAX = 20;
  function recordSyncSize_(tam) {
    try {
      var raw = localStorage.getItem(SIZE_HISTORY_KEY);
      var hist = raw ? JSON.parse(raw) : [];
      hist.push({ tam: tam, fecha: new Date().toISOString() });
      if (hist.length > SIZE_HISTORY_MAX) hist = hist.slice(hist.length - SIZE_HISTORY_MAX);
      localStorage.setItem(SIZE_HISTORY_KEY, JSON.stringify(hist));
    } catch (e) { /* localStorage no disponible — no es crítico, es solo la tendencia */ }
  }
  function getSyncSizeHistory() {
    try {
      var raw = localStorage.getItem(SIZE_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
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
    // T0: se mide ANTES de mandar nada — sobre el tope de bloqueo, ni
    // siquiera se hace la petición (ahorra el viaje Y evita que el
    // backend tenga que ser la única línea de defensa). Es preferible
    // que el usuario sepa que no se guardó a que crea que sí.
    var sizeInfo = getPayloadSizeInfo(state);
    if (sizeInfo.nivel === 'bloqueado') {
      return Promise.resolve({ ok: false, error: 'PAYLOAD_TOO_LARGE', code: 'PAYLOAD_TOO_LARGE', sizeInfo: sizeInfo });
    }
    var f = resolveFetch(fetchImpl);
    var body = JSON.stringify({ token: token, action: 'push', state: state });
    return f(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    }).then(parseResponse).then(function (res) {
      if (res.ok) recordSyncSize_(sizeInfo.tam);
      res.sizeInfo = sizeInfo;
      return res;
    });
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
    uploadFile: uploadFile,
    getPayloadSizeInfo: getPayloadSizeInfo,
    getPayloadBreakdown: getPayloadBreakdown,
    getSyncSizeHistory: getSyncSizeHistory
  };
});

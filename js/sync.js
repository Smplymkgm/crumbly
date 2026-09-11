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
    module.exports = factory(require('./rowsync.js'));
  } else {
    root.CrumblySync = factory(root.CrumblyRowSync);
  }
})(typeof self !== 'undefined' ? self : this, function (RowSync) {
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

  // ─── U0 (auditoría Ronda 4): la alarma mide el CATÁLOGO, no el payload ──
  //
  // El modo de falla real: `state_json!A1` tiene un tope de ~50.000
  // caracteres (límite de una celda de Google Sheets). T0 (Ronda 3) medía
  // `JSON.stringify(state)` completo — correcto ENTONCES, porque el
  // payload y el contenido de la celda eran la misma cosa.
  //
  // Después de T1 dejan de serlo: el cliente sigue mandando el estado
  // completo con todas las transacciones, pero el backend lo parte en
  // catálogo (celda) + filas (hojas append-only). El payload crece con la
  // operación para siempre; la celda solo guarda el catálogo y se queda
  // estable. Medir el payload contra el tope de la celda bloqueaba la app
  // por un límite que ya no existe (el día que el historial pasara de
  // 48.000, con la celda sana en 30.000).
  //
  // Ahora la advertencia y el bloqueo miran SOLO el catálogo — la parte
  // que de verdad va a la celda (`splitCatalogAndAppend`, la misma
  // función que usa Code.gs). El tamaño de la transferencia se sigue
  // mostrando en Ajustes, pero como información, sin tope.
  var TOPE_PAYLOAD_CHARS = 50000;
  var BLOQUEO_PAYLOAD_CHARS = 48000; // por debajo del tope real — margen de seguridad
  var ADVERTENCIA_PAYLOAD_CHARS = 40000;

  function catalogoDe_(state) {
    if (RowSync && RowSync.splitCatalogAndAppend) return RowSync.splitCatalogAndAppend(state).catalogo;
    return state || {}; // sin RowSync (no debería pasar) — degradar a medir todo, más seguro que reventar
  }

  // Tamaño del CATÁLOGO (lo único que va a la celda) contra el tope real.
  // Esto es lo que dispara advertencia/bloqueo en push().
  function getCatalogSizeInfo(state) {
    var tam = JSON.stringify(catalogoDe_(state)).length;
    var nivel = tam >= BLOQUEO_PAYLOAD_CHARS ? 'bloqueado' : (tam >= ADVERTENCIA_PAYLOAD_CHARS ? 'advertencia' : 'ok');
    return { tam: tam, tope: TOPE_PAYLOAD_CHARS, bloqueo: BLOQUEO_PAYLOAD_CHARS, advertencia: ADVERTENCIA_PAYLOAD_CHARS, pct: tam / TOPE_PAYLOAD_CHARS, nivel: nivel };
  }

  // Tamaño de lo que viaja en el POST (estado completo). Informativo —
  // NO tiene tope de celda. Sigue siendo O(historial completo) en ambas
  // direcciones (ver PROGRESO.md § "Fuera de alcance") — útil para
  // vigilar la transferencia, no una condición de bloqueo.
  function getTransferSize(state) {
    return JSON.stringify(state || {}).length;
  }

  // Desglose por colección de nivel superior, marcando cuáles cuentan
  // contra el tope de la celda (`enCelda: true` = parte del catálogo) y
  // cuáles no (filas append-only). Después de T1 son dos grupos con
  // límites distintos — mezclarlos en una sola tabla fue lo que produjo
  // la confusión de U0. Ordenado descendente: lo más pesado primero.
  function getStateBreakdown(state) {
    var append = (RowSync && RowSync.COLECCIONES_APPEND) || [];
    return Object.keys(state || {})
      .map(function (k) {
        return { coleccion: k, tam: JSON.stringify(state[k]).length, enCelda: append.indexOf(k) === -1 };
      })
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

  // U3: estado de la migración a filas append-only — cuándo corrió por
  // última vez, qué reportó, y si el catálogo actual está pre o post
  // migración. Antes esto solo vivía en Logger.log() del editor de Apps
  // Script; ahora el panel de Ajustes lo puede mostrar.
  function getMigrationStatus(backendUrl, token, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    return f(withQuery(backendUrl, { action: 'migrationStatus', token: token })).then(parseResponse);
  }

  // U1: el cliente declara, por colección append-only, el conjunto
  // COMPLETO de ids que tiene ahora mismo. El backend usa eso para
  // detectar ausencias (borrados) y escribir lápidas. Solo se manda si el
  // estado local es una copia real ya sincronizada (`config.lastSync`) —
  // un estado fresco/vacío (sesión nueva, error de carga) NO declara
  // nada, así que el backend no puede confundir "no tengo nada" con
  // "borré todo".
  function knownRecordIdsDe_(state) {
    if (!state || !state.config || !state.config.lastSync) return null;
    var append = (RowSync && RowSync.COLECCIONES_APPEND) || [];
    var out = {};
    append.forEach(function (nombre) {
      out[nombre] = (state[nombre] || []).map(function (r) { return r && r.id; }).filter(function (id) { return id != null; });
    });
    return out;
  }

  function push(backendUrl, token, state, fetchImpl, usuario, baseCatalogVersion) {
    // U0: se mide el CATÁLOGO ANTES de mandar nada — sobre el tope de
    // bloqueo, ni siquiera se hace la petición. El payload completo puede
    // ser enorme (crece con el historial) y eso ya NO es motivo de
    // bloqueo — solo el catálogo, que es lo que va a la celda.
    var sizeInfo = getCatalogSizeInfo(state);
    sizeInfo.transferencia = getTransferSize(state); // informativo, sin tope
    if (sizeInfo.nivel === 'bloqueado') {
      // Mismo `code` que usa el backend (writeState_) — index.html maneja
      // los dos caminos igual. Ahora "PAYLOAD" = catálogo en ambos lados.
      return Promise.resolve({ ok: false, error: 'PAYLOAD_TOO_LARGE', code: 'PAYLOAD_TOO_LARGE', sizeInfo: sizeInfo });
    }
    var f = resolveFetch(fetchImpl);
    var payload = { token: token, action: 'push', state: state };
    var knownIds = knownRecordIdsDe_(state);
    if (knownIds) payload.knownRecordIds = knownIds; // U1
    if (usuario) payload.usuario = usuario;
    // U4: contra qué versión de catálogo edité — si el backend avanzó
    // desde entonces, devuelve CATALOG_CONFLICT en vez de escribir
    // encima. Sin esto (undefined), sigue last-write-wins de siempre.
    if (baseCatalogVersion !== undefined && baseCatalogVersion !== null) payload.baseCatalogVersion = baseCatalogVersion;
    var body = JSON.stringify(payload);
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
    getMigrationStatus: getMigrationStatus,
    uploadFile: uploadFile,
    getCatalogSizeInfo: getCatalogSizeInfo,
    getTransferSize: getTransferSize,
    getStateBreakdown: getStateBreakdown,
    getSyncSizeHistory: getSyncSizeHistory
  };
});

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

  // Tamaño del CATÁLOGO (lo único que va a la celda DESPUÉS de migrar)
  // contra el tope real. Sigue existiendo tal cual para mostrar el
  // desglose de Ajustes — lo que decide advertencia/bloqueo en push() es
  // `getAlarmSizeInfo`, consciente de la fase (ver V1 más abajo).
  function getCatalogSizeInfo(state) {
    var tam = JSON.stringify(catalogoDe_(state)).length;
    var nivel = tam >= BLOQUEO_PAYLOAD_CHARS ? 'bloqueado' : (tam >= ADVERTENCIA_PAYLOAD_CHARS ? 'advertencia' : 'ok');
    return { tam: tam, tope: TOPE_PAYLOAD_CHARS, bloqueo: BLOQUEO_PAYLOAD_CHARS, advertencia: ADVERTENCIA_PAYLOAD_CHARS, pct: tam / TOPE_PAYLOAD_CHARS, nivel: nivel };
  }

  // ─── V1 (auditoría Ronda 5): la alarma no puede quedar ciega entre
  // despliegues ────────────────────────────────────────────────────────
  //
  // U0 hizo que la alarma mida el catálogo en vez del payload completo —
  // correcto DESPUÉS de que el backend ya migró. El frontend (GitHub
  // Pages) se actualiza con un `git push`; el backend (Apps Script) se
  // despliega a mano — es fácil que el cliente nuevo llegue primero. En
  // esa ventana la celda real TODAVÍA contiene el estado completo (el
  // backend viejo no sabe de catálogo/filas), pero un cliente que mide
  // solo el catálogo vería un número chico y no avisaría — se pierde la
  // protección de T0 justo cuando más hace falta, sin ningún síntoma.
  //
  // La alarma ahora mide según la FASE de la migración, reportada por el
  // propio backend (`migrationStatus`, U3): fase 'post' → catálogo
  // (comportamiento de U0). Fase 'pre', o CUALQUIER fase que no se pudo
  // determinar (backend viejo que no reconoce la acción, sin sesión,
  // error de red) → estado completo, el mismo criterio de T0. Elegido a
  // propósito: medir de más avisa sin razón (falso positivo, molesto);
  // medir de menos deja la app fallando en silencio (el modo de falla
  // real que esta ronda existe para cerrar). Ante la duda, la opción
  // segura es medir de más.
  function getAlarmSizeInfo(state, fase) {
    if (fase === 'post') {
      var info = getCatalogSizeInfo(state);
      info.fase = 'post';
      info.motivo = 'catálogo — la migración ya corrió, la celda solo guarda el catálogo';
      return info;
    }
    var tam = getTransferSize(state);
    var nivel = tam >= BLOQUEO_PAYLOAD_CHARS ? 'bloqueado' : (tam >= ADVERTENCIA_PAYLOAD_CHARS ? 'advertencia' : 'ok');
    return {
      tam: tam, tope: TOPE_PAYLOAD_CHARS, bloqueo: BLOQUEO_PAYLOAD_CHARS, advertencia: ADVERTENCIA_PAYLOAD_CHARS,
      pct: tam / TOPE_PAYLOAD_CHARS, nivel: nivel, fase: 'pre',
      motivo: fase === 'pre'
        ? 'estado completo — la migración todavía no corrió, la celda guarda todo'
        : 'estado completo — no se pudo determinar la fase de la migración, se asume la opción más segura'
    };
  }

  // Fase de la migración, cacheada en memoria (por carga de página, nunca
  // persistida) — se actualiza cada vez que `getMigrationStatus` recibe
  // una respuesta válida del backend (afterLogin_, pullOnLoad, o al abrir
  // Ajustes). Arranca en `null` = "todavía no se sabe", que
  // `getAlarmSizeInfo` trata igual que 'pre'.
  var faseMigracionConocida_ = null;
  function getFaseConocida() { return faseMigracionConocida_; }

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
  //
  // V1: cada respuesta válida (`ok:true`) actualiza la fase cacheada que
  // `push()` usa para decidir qué medir — esta es la única vía por la que
  // ese caché se llena; si nunca se llama (backend viejo que ni siquiera
  // tiene esta acción, sin sesión, sin red), el caché se queda en `null`
  // y `getAlarmSizeInfo` mide como si la fase fuera 'pre'.
  function getMigrationStatus(backendUrl, token, fetchImpl) {
    var f = resolveFetch(fetchImpl);
    return f(withQuery(backendUrl, { action: 'migrationStatus', token: token })).then(parseResponse).then(function (res) {
      if (res && res.ok && res.fase) faseMigracionConocida_ = res.fase;
      return res;
    });
  }

  // ─── V0 (auditoría Ronda 5): borrados pendientes, por dispositivo ──────
  //
  // U1 declaraba el conjunto COMPLETO de ids vivos y dejaba que el backend
  // lapidara por AUSENCIA — con dos dispositivos reales, uno con
  // `lastSync` viejo sincroniza sin haber visto todavía lo que el otro
  // acaba de registrar, y esa ausencia se leía como "lo borré". Ahora el
  // cliente declara exactamente lo que SÍ borró, nunca lo que le falta.
  //
  // `crumbly-borrados-pendientes` en localStorage — nunca en `state`, así
  // que nunca viaja por sync ni cuenta contra el tope de la celda. Mismo
  // espíritu que `crumbly-catalog-base`/`conteoEnProgreso`: metadata de
  // ESTE dispositivo. Forma: { coleccion: [id, id, ...] }.
  var BORRADOS_PENDIENTES_KEY = 'crumbly-borrados-pendientes';

  function getBorradosPendientes() {
    try {
      var raw = localStorage.getItem(BORRADOS_PENDIENTES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function setBorradosPendientes_(obj) {
    try { localStorage.setItem(BORRADOS_PENDIENTES_KEY, JSON.stringify(obj)); } catch (e) { /* no crítico */ }
  }

  // Llamado desde cada flujo de borrado real (eliminarVenta, eliminarGasto,
  // eliminarMerma, eliminarLote, borrado de ajustes) — antes de que el
  // siguiente push mande la lista. Idempotente: agregar el mismo id dos
  // veces no lo duplica.
  function marcarBorradoPendiente(coleccion, id) {
    if (id === undefined || id === null) return;
    var p = getBorradosPendientes();
    if (!p[coleccion]) p[coleccion] = [];
    if (p[coleccion].indexOf(id) === -1) p[coleccion].push(id);
    setBorradosPendientes_(p);
  }

  // Quita de lo pendiente exactamente los ids que ESTE push mandó (no
  // "todo lo pendiente ahora" — algo nuevo pudo agregarse mientras la
  // petición estaba en vuelo). Solo se llama tras un push con `ok:true`;
  // si el push falla, lo pendiente queda intacto y se reintenta solo en
  // el siguiente push (mismo patrón de reintento que ya usa saveState()).
  function limpiarBorradosPendientes_(enviados) {
    var p = getBorradosPendientes();
    Object.keys(enviados || {}).forEach(function (coleccion) {
      if (!p[coleccion] || !enviados[coleccion].length) return;
      var idsEnviados = {};
      enviados[coleccion].forEach(function (id) { idsEnviados[id] = true; });
      p[coleccion] = p[coleccion].filter(function (id) { return !idsEnviados[id]; });
      if (!p[coleccion].length) delete p[coleccion];
    });
    setBorradosPendientes_(p);
  }

  function push(backendUrl, token, state, fetchImpl, usuario, baseCatalogVersion, fase) {
    // U0/V1: se mide ANTES de mandar nada — sobre el tope de bloqueo, ni
    // siquiera se hace la petición. Qué se mide depende de la fase de la
    // migración: catálogo si ya se sabe que el backend migró, estado
    // completo si no se sabe o todavía no migró. `fase` es un override
    // explícito (para pruebas, o un caller que ya la tiene a mano) — el
    // caller real (index.html) no lo manda nunca y usa la fase cacheada
    // por el último `getMigrationStatus()` exitoso de esta sesión.
    var sizeInfo = getAlarmSizeInfo(state, fase !== undefined ? fase : faseMigracionConocida_);
    sizeInfo.transferencia = getTransferSize(state); // informativo, sin tope
    if (sizeInfo.nivel === 'bloqueado') {
      // Mismo `code` que usa el backend (writeState_) — index.html maneja
      // los dos caminos igual. Ahora "PAYLOAD" = catálogo en ambos lados.
      return Promise.resolve({ ok: false, error: 'PAYLOAD_TOO_LARGE', code: 'PAYLOAD_TOO_LARGE', sizeInfo: sizeInfo });
    }
    var f = resolveFetch(fetchImpl);
    var payload = { token: token, action: 'push', state: state };
    // V0: lista EXPLÍCITA de lo que este dispositivo borró de verdad —
    // nunca "lo que tengo" (eso es lo que U1 mandaba y el backend leía
    // por ausencia). Se captura ahora mismo, no dentro del .then — si
    // algo nuevo se borra mientras la petición está en vuelo, ese id
    // sigue pendiente para el próximo push.
    var idsABorrar = getBorradosPendientes();
    if (idsABorrar && Object.keys(idsABorrar).length) payload.idsABorrar = idsABorrar;
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
      if (res.ok) {
        recordSyncSize_(sizeInfo.tam);
        limpiarBorradosPendientes_(idsABorrar); // solo lo que el backend confirmó — un push fallido deja todo pendiente
      }
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
    getAlarmSizeInfo: getAlarmSizeInfo,
    getFaseConocida: getFaseConocida,
    getTransferSize: getTransferSize,
    getStateBreakdown: getStateBreakdown,
    getSyncSizeHistory: getSyncSizeHistory,
    marcarBorradoPendiente: marcarBorradoPendiente,
    getBorradosPendientes: getBorradosPendientes
  };
});

/**
 * Crumbly — lógica pura de la migración a filas append-only (T1,
 * auditoría Ronda 3). Sin DOM, sin Apps Script: mismo patrón dual
 * Node/navegador que js/core.js y js/sync.js.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO POR SEPARADO: la parte que de verdad
 * importa verificar de T1 —qué colecciones van a fila, cómo se decide
 * qué es "nuevo" para no duplicar, cómo se reconstruye el estado desde
 * catálogo+filas, cómo se verifican los conteos de la migración— es
 * lógica pura (sin `SpreadsheetApp`, sin `LockService`). Apps Script
 * (backend/Code.gs) NO se puede correr ni testear en Node, así que esa
 * lógica se probó acá, exhaustivamente, y Code.gs es un PORT A MANO de
 * estas mismas funciones sobre `getRange`/`setValues` reales — mismo
 * comportamiento, sin runtime compartido posible entre Apps Script y
 * Node/navegador. Si algo cambia acá, hay que reflejarlo a mano allá
 * (costo de mantenimiento reconocido, ver PROGRESO.md).
 *
 * `COLECCIONES_APPEND` son las que crecen con la OPERACIÓN del negocio
 * (una fila nueva por venta/gasto/merma/snapshot/ajuste/lote) — el resto
 * del estado ("catálogo": productos, materia, empaques, toppings,
 * preparaciones, clientes, config, schemaVersion) crece con el MENÚ, no
 * con las transacciones, y se queda en la celda JSON.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.CrumblyRowSync = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLECCIONES_APPEND = ['ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes'];

  // Cabecera de una hoja append-only real (Code.gs, `getAppendSheet_`) —
  // única fuente de verdad de la forma esperada, para U2 y para quien
  // arme una hoja nueva a mano.
  var APPEND_HEADER = ['id', 'fecha', 'supersedesId', 'json'];

  // Separa un estado completo en { catalogo, colecciones } — catalogo es
  // exactamente lo que debe quedar en la celda JSON después de la
  // migración; colecciones es lo que debe existir como filas (una por
  // registro) en sus propias hojas. Las 6 colecciones SIEMPRE existen en
  // el resultado (aunque el estado de origen no las tuviera — estado
  // viejo/incompleto), como arrays vacíos, nunca `undefined`.
  function splitCatalogAndAppend(state) {
    var catalogo = {};
    var colecciones = {};
    Object.keys(state || {}).forEach(function (k) {
      if (COLECCIONES_APPEND.indexOf(k) !== -1) colecciones[k] = state[k] || [];
      else catalogo[k] = state[k];
    });
    COLECCIONES_APPEND.forEach(function (k) { if (!colecciones[k]) colecciones[k] = []; });
    return { catalogo: catalogo, colecciones: colecciones };
  }

  // La inversa: reconstruye el estado completo, en la forma que
  // migrateState()/el resto de js/core.js ya esperan, a partir del
  // catálogo (de la celda) y las colecciones (hidratadas desde las
  // filas). Es lo que `readState_()` hace en Code.gs — acá se prueba la
  // parte de ensamblado, sin la lectura real de hojas.
  function mergeState(catalogo, colecciones) {
    var out = Object.assign({}, catalogo);
    COLECCIONES_APPEND.forEach(function (k) { out[k] = (colecciones && colecciones[k]) || []; });
    return out;
  }

  // La decisión de idempotencia, aislada: de una lista de registros
  // candidatos, cuáles NO existen todavía (según sus ids) y por lo tanto
  // hay que agregar. Un reintento, un doble envío, o dos pushes
  // concurrentes con el mismo registro nunca producen una fila de más —
  // esto es lo único que decide eso, en un solo lugar.
  function pickNewRecords(existingIds, records) {
    var existing = {};
    (existingIds || []).forEach(function (id) { existing[id] = true; });
    var nuevos = [];
    (records || []).forEach(function (r) {
      if (!r || r.id === undefined || r.id === null || existing[r.id]) return;
      nuevos.push(r);
      existing[r.id] = true; // por si el mismo id se repite DENTRO del mismo lote entrante
    });
    return nuevos;
  }

  // Verificación de la migración: para cada colección append-only,
  // ¿el conteo de "antes" (blob viejo) coincide con el de "después"
  // (filas ya escritas)? La migración real en Code.gs NUNCA reduce la
  // celda vieja si esto da `ok:false` para cualquier colección.
  function verifyMigrationCounts(oldState, nuevasColecciones) {
    var reporte = {};
    var ok = true;
    COLECCIONES_APPEND.forEach(function (nombre) {
      var antes = ((oldState && oldState[nombre]) || []).length;
      var despues = ((nuevasColecciones && nuevasColecciones[nombre]) || []).length;
      var coincide = antes === despues;
      if (!coincide) ok = false;
      reporte[nombre] = { antes: antes, despues: despues, coincide: coincide };
    });
    return { ok: ok, reporte: reporte };
  }

  // ─── U1 (auditoría Ronda 4): filas de lápida ──────────────────────────
  //
  // `pickNewRecords` solo agrega, nunca quita. Así que borrar un gasto en
  // memoria y sincronizar dejaba la fila en la hoja, y el siguiente pull
  // la traía de vuelta. El arreglo mínimo (sin UI de anulación): cuando un
  // id existe en la hoja pero NO en el conjunto que el cliente declara
  // tener, se escribe una fila de LÁPIDA — mismo id, timestamp, usuario.
  // Fila nueva, nunca se muta ni se borra la original (el punto de
  // append-only es que nada se pierde). La hidratación excluye los ids
  // con lápida.

  function isTombstone(rec) {
    return !!(rec && rec._tombstone === true);
  }

  function makeTombstone(id, fecha, usuario) {
    return { id: id, _tombstone: true, fecha: fecha || new Date().toISOString(), usuario: usuario || '' };
  }

  // De los ids que están como registro VIVO en la hoja, cuáles ya no
  // aparecen en `knownIds` (el conjunto que el cliente declara tener
  // completo) y todavía no tienen lápida.
  //
  // GUARDA CONTRA FALSO POSITIVO: si `knownIds` no es un array, o es un
  // array vacío, NO se lapida nada. Un cliente que manda un estado
  // parcial/recortado/vacío (sesión nueva, error de carga, pull fallido
  // antes del push) no debe producir una lápida masiva del historial. Un
  // registro que sobrevive de más se corrige después; un historial
  // borrado en masa por una lápida espuria, no. (La guarda contra el
  // borrado masivo NO-vacío vive aparte, en `esBorradoMasivoSospechoso`.)
  function pickTombstones(sheetLiveIds, knownIds, tombstonedIds) {
    if (!Array.isArray(knownIds) || knownIds.length === 0) return [];
    var known = {};
    knownIds.forEach(function (id) { known[id] = true; });
    var tomb = {};
    (tombstonedIds || []).forEach(function (id) { tomb[id] = true; });
    return (sheetLiveIds || []).filter(function (id) {
      return id !== undefined && id !== null && !known[id] && !tomb[id];
    });
  }

  // Segunda guarda: aunque el cliente declare un conjunto completo no
  // vacío, si un solo push quisiera lapidar MUCHOS registros a la vez,
  // es casi seguro un error (no seis borrados manuales). Ante la duda, no
  // se escribe ninguna lápida — se corrige en el siguiente sync real.
  // Umbral: más de 10 y más de la mitad de los registros vivos.
  function esBorradoMasivoSospechoso(candidatos, totalVivos) {
    return candidatos > 10 && candidatos > totalVivos * 0.5;
  }

  // De todas las filas parseadas de una hoja (vivas + lápidas), devuelve
  // solo los registros vivos: sin las lápidas y sin los ids lapidados,
  // deduplicado por id. Es lo que `readAppendCollection_` de Code.gs
  // aplica antes de devolver una colección en el pull.
  function hydrateRecords(records) {
    var tombstoned = {};
    (records || []).forEach(function (r) { if (isTombstone(r) && r.id != null) tombstoned[r.id] = true; });
    var out = [];
    var seen = {};
    (records || []).forEach(function (r) {
      if (!r || isTombstone(r) || r.id === undefined || r.id === null) return;
      if (tombstoned[r.id] || seen[r.id]) return;
      seen[r.id] = true;
      out.push(r);
    });
    return out;
  }

  // ─── U2 (auditoría Ronda 4): colisión de nombres de hoja en el Sheet ───
  // real. Antes de T1, `mirrorCollections_` escribía hojas "ventas",
  // "gastos" y "mermas" con columnas PLANAS y legibles (id, fecha, total,
  // ganancia...). Después de T1 esos mismos nombres son la fuente de
  // verdad append-only, formato `[id, fecha, supersedesId, json]`. Si el
  // Sheet real todavía tiene esas hojas en el formato viejo,
  // `migrarAAppendOnly()` appendearía sobre datos con otra estructura —
  // `pickNewRecords`/lectura de columna A leerían basura (un `total`
  // numérico como si fuera un id, por ejemplo), saltándose registros
  // reales, hidratando basura, o las dos cosas, y la migración
  // reportaría que los conteos cuadran porque los está contando mal.
  // Esto no se puede resolver adivinando desde el código — hay que
  // inspeccionar el Sheet real (ver PROGRESO.md § pasos manuales).
  //
  // `validarCabeceraAppend` es la única fuente de verdad de "¿esta hoja
  // ya tiene el formato correcto, está vacía, o es de otra cosa?" —
  // `migrarAAppendOnly()` (Code.gs) la corre para las 6 colecciones ANTES
  // de escribir una sola fila; si cualquiera falla, aborta sin tocar nada.
  // ─── U3 (auditoría Ronda 4): instrumentar la migración ─────────────────
  // La confianza en T1 dependía de una migración manual, de un solo uso,
  // corrida por una persona mirando Logger.log() en el editor de Apps
  // Script — el mismo patrón de falla silenciosa que T0 se construyó para
  // eliminar (el log del editor desaparece; nadie más lo ve). Estas dos
  // funciones son la parte testeable: un reporte estructurado (no solo
  // antes/después/coincide, también cuántas filas se escribieron y un
  // veredicto único) y la detección de en qué fase quedó el catálogo.

  // Junta verifyMigrationCounts (antes/después/coincide) con `agregados`
  // (filas realmente escritas por appendNewRecords_) en un solo reporte
  // por colección, más un veredicto (`OK`/`ABORTADA`) a nivel de toda la
  // migración.
  function buildMigrationReport(oldState, nuevasColecciones, agregados) {
    var v = verifyMigrationCounts(oldState, nuevasColecciones);
    var reporte = {};
    COLECCIONES_APPEND.forEach(function (nombre) {
      reporte[nombre] = Object.assign({}, v.reporte[nombre], { filasEscritas: (agregados && agregados[nombre]) || 0 });
    });
    return { ok: v.ok, veredicto: v.ok ? 'OK' : 'ABORTADA', reporte: reporte };
  }

  // ¿El catálogo (tal cual está en la celda, CRUDO — antes de que
  // readState_ inyecte las colecciones hidratadas) todavía tiene
  // transacciones embebidas? Si alguna de las 6 colecciones append-only
  // aparece ahí como array no vacío, la migración no corrió (o corrió a
  // medias) — 'pre'. Si ninguna aparece, el catálogo ya está reducido —
  // 'post'.
  function faseMigracion(catalogoCrudo) {
    var tieneTx = COLECCIONES_APPEND.some(function (n) {
      return Array.isArray(catalogoCrudo && catalogoCrudo[n]) && catalogoCrudo[n].length > 0;
    });
    return tieneTx ? 'pre' : 'post';
  }

  function esHeaderVacio_(headerRow) {
    return !headerRow || headerRow.length === 0 || headerRow.every(function (c) { return c === '' || c === null || c === undefined; });
  }
  function validarCabeceraAppend(headerRow) {
    if (esHeaderVacio_(headerRow)) return { ok: true, vacia: true };
    var coincide = headerRow.length === APPEND_HEADER.length && APPEND_HEADER.every(function (h, i) { return headerRow[i] === h; });
    if (coincide) return { ok: true, vacia: false };
    return { ok: false, vacia: false, esperado: APPEND_HEADER, encontrado: headerRow };
  }

  // ─── U4 (auditoría Ronda 4): C2 — fusión de catálogo POR REGISTRO ──────
  //
  // T1 resolvió el conflicto entre transacciones concurrentes (cada venta
  // es su propia fila). El catálogo (productos, materia, empaques,
  // toppings, preparaciones, clientes, config) sigue en el blob, y
  // `pullOnLoad` reemplazaba el estado local completo con el remoto —
  // dos personas editando recetas o insumos a la vez perdían trabajo en
  // silencio, y quien perdía no se enteraba. Pasó de verdad: el dueño
  // editando insumos a mano mientras el sistema sincronizaba.
  //
  // Alcance explícitamente LIMITADO (no es un merge automático completo,
  // esa es otra ronda): detectar quién cambió qué desde la última base
  // compartida, combinar lo que no choca, y cuando SÍ choca (el mismo
  // registro cambiado distinto en los dos lados), no decidir sola —
  // conservar la versión local en el resultado (para no perder el
  // trabajo en curso) y reportar el conflicto aparte con las dos
  // versiones, para que el usuario elija.
  //
  // Las colecciones de catálogo que son listas de registros CON id se
  // fusionan registro por registro. El resto (config, schemaVersion) no
  // tiene múltiples registros que fusionar — si el remoto cambió respecto
  // a la base, gana el remoto (nadie más edita "el correo de la marca"
  // desde dos dispositivos a la vez en la práctica); si no, gana lo mío.
  var COLECCIONES_CATALOGO_CON_ID = ['productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes'];

  // Igualdad estructural simple. LIMITACIÓN ACEPTADA: usa JSON.stringify,
  // así que dos objetos con las mismas claves en OTRO orden se verían
  // como "distintos" (falso positivo de cambio, nunca al revés) — en la
  // práctica los registros siempre se construyen con el mismo código
  // (`saveInsumo`, `savePreparacion`...), así que el orden de claves es
  // estable. Documentado en vez de resuelto con una comparación profunda
  // más cara, para no sobre-construir esto (alcance: detectar, no un
  // motor de diffing genérico).
  function catalogRecordsIguales_(a, b) {
    if (a === undefined && b === undefined) return true;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function indexarPorId_(lista) {
    var out = {};
    (lista || []).forEach(function (r) { if (r && r.id !== undefined && r.id !== null) out[r.id] = r; });
    return out;
  }

  // `base`: catálogo tal cual estaba la última vez que este dispositivo
  // se sincronizó con éxito. `mine`: mi copia local ahora (con mis
  // ediciones desde entonces). `remote`: lo que el servidor tiene ahora.
  // Devuelve `{ merged, conflicts }` — `conflicts` es la lista de
  // registros donde los dos lados cambiaron a valores DISTINTOS desde la
  // base (nunca vacía silenciosamente resuelta: el llamador decide qué
  // hacer con cada uno, ver `index.html`).
  function mergeCatalogs(base, mine, remote) {
    base = base || {}; mine = mine || {}; remote = remote || {};
    var merged = {};
    var conflicts = [];
    var todasLasClaves = {};
    Object.keys(base).concat(Object.keys(mine), Object.keys(remote)).forEach(function (k) { todasLasClaves[k] = true; });

    Object.keys(todasLasClaves).forEach(function (coleccion) {
      if (COLECCIONES_CATALOGO_CON_ID.indexOf(coleccion) === -1) {
        var remotoCambio = !catalogRecordsIguales_(remote[coleccion], base[coleccion]);
        merged[coleccion] = remotoCambio ? remote[coleccion] : mine[coleccion];
        return;
      }
      var baseIdx = indexarPorId_(base[coleccion]);
      var mineIdx = indexarPorId_(mine[coleccion]);
      var remoteIdx = indexarPorId_(remote[coleccion]);
      var ids = {};
      Object.keys(baseIdx).concat(Object.keys(mineIdx), Object.keys(remoteIdx)).forEach(function (id) { ids[id] = true; });

      var salida = [];
      Object.keys(ids).forEach(function (id) {
        var b = baseIdx[id], m = mineIdx[id], r = remoteIdx[id];
        var mineChanged = !catalogRecordsIguales_(m, b);
        var remoteChanged = !catalogRecordsIguales_(r, b);
        if (mineChanged && remoteChanged && !catalogRecordsIguales_(m, r)) {
          conflicts.push({ coleccion: coleccion, id: id, base: b || null, mio: m || null, remoto: r || null });
          if (m) salida.push(m); // se conserva lo mío hasta que el usuario decida — nunca se pierde en silencio
          return;
        }
        if (remoteChanged) { if (r) salida.push(r); return; } // solo cambió (o lo agregaron/borraron en) el remoto
        if (mineChanged) { if (m) salida.push(m); return; } // solo cambié yo
        if (m) salida.push(m); // nadie cambió — cualquiera sirve
      });
      merged[coleccion] = salida;
    });

    return { merged: merged, conflicts: conflicts };
  }

  return {
    COLECCIONES_APPEND: COLECCIONES_APPEND,
    APPEND_HEADER: APPEND_HEADER,
    splitCatalogAndAppend: splitCatalogAndAppend,
    mergeState: mergeState,
    pickNewRecords: pickNewRecords,
    verifyMigrationCounts: verifyMigrationCounts,
    isTombstone: isTombstone,
    makeTombstone: makeTombstone,
    pickTombstones: pickTombstones,
    esBorradoMasivoSospechoso: esBorradoMasivoSospechoso,
    hydrateRecords: hydrateRecords,
    validarCabeceraAppend: validarCabeceraAppend,
    buildMigrationReport: buildMigrationReport,
    faseMigracion: faseMigracion,
    COLECCIONES_CATALOGO_CON_ID: COLECCIONES_CATALOGO_CON_ID,
    mergeCatalogs: mergeCatalogs
  };
});

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
  // id existe en la hoja pero ya no en el cliente, se escribe una fila de
  // LÁPIDA — mismo id, timestamp, usuario. Fila nueva, nunca se muta ni se
  // borra la original (el punto de append-only es que nada se pierde). La
  // hidratación excluye los ids con lápida.

  function isTombstone(rec) {
    return !!(rec && rec._tombstone === true);
  }

  function makeTombstone(id, fecha, usuario) {
    return { id: id, _tombstone: true, fecha: fecha || new Date().toISOString(), usuario: usuario || '' };
  }

  // ─── V0 (auditoría Ronda 5): la lápida no puede decidirse por ausencia ──
  //
  // U1 lapidaba por AUSENCIA: "este id está en la hoja pero el cliente no
  // lo declaró en `knownIds` → lo borré". Eso confunde "no lo tengo
  // todavía" (un segundo dispositivo con `lastSync` viejo, que sincroniza
  // cualquier cosa sin haber hecho pull primero) con "lo borré de verdad".
  // Ningún umbral arregla esto — con dos dispositivos reales, tres ventas
  // nuevas del celular bastan para que la tablet (que nunca las vio) las
  // lapide en su siguiente push. Las dos guardas de U1 (`knownIds` no
  // vacío, umbral de borrado masivo) existían para compensar esa señal
  // mal elegida; con la señal correcta no hacen falta y se eliminaron —
  // dejarlas habría mantenido dos caminos de borrado vivos a la vez.
  //
  // La señal correcta: el cliente declara una lista EXPLÍCITA de ids que
  // borró de verdad (ver `js/sync.js`, `marcarBorradoPendiente` — vive en
  // localStorage por dispositivo, nunca en el estado sincronizado). El
  // backend lapida exactamente esos ids y nada más — la ausencia jamás se
  // interpreta. Efecto secundario deseado: una colección se puede vaciar
  // por completo (6 ids explícitos de 6 son 6 ids, no una sospecha).
  function pickExplicitTombstones(sheetLiveIds, idsABorrar, tombstonedIds) {
    if (!Array.isArray(idsABorrar) || idsABorrar.length === 0) return [];
    var live = {};
    (sheetLiveIds || []).forEach(function (id) { live[id] = true; });
    var tomb = {};
    (tombstonedIds || []).forEach(function (id) { tomb[id] = true; });
    var seen = {};
    return idsABorrar.filter(function (id) {
      if (id === undefined || id === null || seen[id]) return false;
      seen[id] = true;
      return !!live[id] && !tomb[id]; // ya lapidado o nunca llegó a existir en la hoja → nada que hacer, idempotente
    });
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
      // ─── V2 (auditoría Ronda 5): schemaVersion — la gestiona la
      // migración, no una persona editando desde dos dispositivos. Gana
      // el mayor de los dos (nunca retrocede), excepción documentada al
      // criterio de conflicto por registro/clave de acá abajo.
      if (coleccion === 'schemaVersion') {
        merged.schemaVersion = Math.max(Number(base.schemaVersion) || 0, Number(mine.schemaVersion) || 0, Number(remote.schemaVersion) || 0);
        return;
      }
      // ─── V2: config — ahí vive configuración contable real
      // (factorPrestacional, la clasificación fijo/variable de gastos).
      // Antes se resolvía entero por último-cambio-remoto-gana porque "no
      // es una lista con id" — pero eso significa que si dos dispositivos
      // tocan DOS CLAVES DISTINTAS de config, una se pierde en silencio
      // sin que nadie se entere: el prime cost y el punto de equilibrio
      // cambian sin rastro. Se aplica la MISMA comparación contra la base
      // que ya usan las listas, pero por clave en vez de por id — dos
      // claves distintas cambiadas sobreviven las dos; la MISMA clave
      // cambiada en los dos lados es un conflicto real, reportado igual
      // que un registro (nunca resuelto por reloj).
      if (coleccion === 'config') {
        var configBase = base.config || {};
        var configMine = mine.config || {};
        var configRemote = remote.config || {};
        var claves = {};
        Object.keys(configBase).concat(Object.keys(configMine), Object.keys(configRemote)).forEach(function (k) { claves[k] = true; });
        var configMerged = {};
        Object.keys(claves).forEach(function (k) {
          var b = configBase[k], m = configMine[k], r = configRemote[k];
          var mineChanged = !catalogRecordsIguales_(m, b);
          var remoteChanged = !catalogRecordsIguales_(r, b);
          if (mineChanged && remoteChanged && !catalogRecordsIguales_(m, r)) {
            conflicts.push({ coleccion: 'config', id: k, base: b === undefined ? null : b, mio: m === undefined ? null : m, remoto: r === undefined ? null : r });
            if (m !== undefined) configMerged[k] = m; // se conserva lo mío hasta que se decida — nunca se pierde en silencio
            return;
          }
          if (remoteChanged) { if (r !== undefined) configMerged[k] = r; return; }
          if (mineChanged) { if (m !== undefined) configMerged[k] = m; return; }
          if (m !== undefined) configMerged[k] = m; // nadie cambió esta clave — cualquiera sirve
        });
        merged.config = configMerged;
        return;
      }
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
    pickExplicitTombstones: pickExplicitTombstones,
    hydrateRecords: hydrateRecords,
    validarCabeceraAppend: validarCabeceraAppend,
    buildMigrationReport: buildMigrationReport,
    faseMigracion: faseMigracion,
    COLECCIONES_CATALOGO_CON_ID: COLECCIONES_CATALOGO_CON_ID,
    mergeCatalogs: mergeCatalogs
  };
});

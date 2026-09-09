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

  return {
    COLECCIONES_APPEND: COLECCIONES_APPEND,
    splitCatalogAndAppend: splitCatalogAndAppend,
    mergeState: mergeState,
    pickNewRecords: pickNewRecords,
    verifyMigrationCounts: verifyMigrationCounts
  };
});

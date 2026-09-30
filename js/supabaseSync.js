/**
 * Crumbly — cliente de sincronización con Supabase (reemplazo del backend
 * en Google Sheets/Apps Script, ver supabase/migrations/0001_init.sql y el
 * plan de migración). Mismo principio que js/sync.js: sin DOM, solo arma
 * las llamadas y devuelve datos — index.html decide cuándo llamarlo.
 *
 * Recibe un `client` ya construido (supabase-js `createClient(url, key)`)
 * en vez de una URL/token sueltos — así los tests inyectan un cliente falso
 * sin red real, mismo espíritu que js/sync.js inyecta `fetchImpl`.
 *
 * A diferencia de js/sync.js, ACÁ NO HAY distinción catálogo/append-only ni
 * alarma de tamaño de celda (U0/V1/X0/T1) — Postgres no tiene ese límite.
 * Las 12 colecciones son simétricas: cada una es una tabla, se lee y se
 * escribe igual.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CrumblySupabaseSync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Mismas 12 colecciones que js/rowsync.js ya conoce (COLECCIONES_APPEND +
  // COLECCIONES_CATALOGO_CON_ID) — una tabla por colección, ver
  // supabase/migrations/0001_init.sql. `config` se maneja aparte (singleton,
  // no es una lista de registros con id).
  var COLECCIONES = [
    'productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes',
    'ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes'
  ];

  function isConfigured(client) {
    return !!client;
  }

  // Lee las 12 tablas (en paralelo) + `config`, reconstruye el mismo `state`
  // que CrumblyCore.migrateState ya espera — cada fila viva (deleted_at is
  // null) aporta su `data` tal cual. El pull nunca trae filas borradas: a
  // diferencia de Sheets (V0: lápidas explícitas, hidratadas y excluidas a
  // mano), acá el filtro es un `where deleted_at is null` que Postgres
  // resuelve solo.
  function pull(client) {
    var lecturas = COLECCIONES.map(function (coleccion) {
      return client.from(coleccion).select('data').is('deleted_at', null)
        .then(function (res) {
          if (res.error) throw new Error(coleccion + ': ' + res.error.message);
          return { coleccion: coleccion, filas: (res.data || []).map(function (r) { return r.data; }) };
        });
    });
    var lecturaConfig = client.from('config').select('data,schema_version').eq('id', 'singleton').maybeSingle()
      .then(function (res) {
        if (res.error) throw new Error('config: ' + res.error.message);
        return res.data || { data: {}, schema_version: undefined };
      });
    return Promise.all(lecturas.concat([lecturaConfig])).then(function (resultados) {
      var lecturaConfigRes = resultados[resultados.length - 1];
      var state = Object.assign({}, lecturaConfigRes.data);
      if (lecturaConfigRes.schema_version !== undefined) state.schemaVersion = lecturaConfigRes.schema_version;
      resultados.slice(0, COLECCIONES.length).forEach(function (r) { state[r.coleccion] = r.filas; });
      return { ok: true, state: state };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  }

  // Escribe cada colección con upsert (por id — Postgres resuelve el
  // conflicto por FILA, no hace falta LockService global ni
  // baseCatalogVersion/CATALOG_CONFLICT de U4 a este nivel: dos
  // dispositivos escribiendo insumos DISTINTOS nunca chocan). La fusión por
  // registro de mergeCatalogs (U4) sigue siendo responsabilidad del
  // cliente ANTES de llamar a push — acá solo se escribe lo que ya se
  // decidió escribir.
  //
  // `idsABorrar`: mismo contrato que js/sync.js (V0) — `{coleccion:
  // [id,...]}` de lo que ESTE dispositivo borró de verdad. Se traduce a un
  // soft-delete real (`deleted_at = now()`), no a una fila de lápida
  // sintética.
  function push(client, state, idsABorrar) {
    var escrituras = COLECCIONES.map(function (coleccion) {
      var filas = (state[coleccion] || []).map(function (registro) {
        return { id: registro.id, data: registro, updated_at: new Date().toISOString() };
      });
      var p = filas.length
        ? client.from(coleccion).upsert(filas).then(function (res) {
            if (res.error) throw new Error(coleccion + ': ' + res.error.message);
          })
        : Promise.resolve();
      var idsABorrarDeEsta = (idsABorrar && idsABorrar[coleccion]) || [];
      if (idsABorrarDeEsta.length) {
        p = p.then(function () {
          return client.from(coleccion).update({ deleted_at: new Date().toISOString() }).in('id', idsABorrarDeEsta);
        }).then(function (res) {
          if (res && res.error) throw new Error(coleccion + ' (borrado): ' + res.error.message);
        });
      }
      return p;
    });
    var configPayload = {};
    Object.keys(state).forEach(function (k) { if (COLECCIONES.indexOf(k) === -1 && k !== 'schemaVersion') configPayload[k] = state[k]; });
    var escrituraConfig = client.from('config').upsert({
      id: 'singleton', data: configPayload, schema_version: state.schemaVersion, updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) throw new Error('config: ' + res.error.message);
    });
    return Promise.all(escrituras.concat([escrituraConfig])).then(function () {
      return { ok: true, ts: new Date().toISOString() };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  }

  return {
    COLECCIONES: COLECCIONES,
    isConfigured: isConfigured,
    pull: pull,
    push: push
  };
});

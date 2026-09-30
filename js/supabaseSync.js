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

  // PostgREST (Supabase) corta cada `select` en "Max rows" filas (1000 por
  // defecto en la configuración del proyecto) SIN avisar — un select plano
  // de `ventas` con 1500 filas devolvía 1000 y el pull reconstruía un
  // historial truncado en silencio. Se pagina con `.range()`, ordenado por
  // id para que las páginas sean estables. Se avanza por lo que
  // efectivamente llegó y se corta recién con una página VACÍA (no con
  // "llegaron menos de PAGINA"): así funciona igual si el proyecto tiene un
  // Max rows menor que PAGINA — a cambio de un round-trip extra por tabla.
  var PAGINA = 1000;
  function leerTabla(client, coleccion, desde, acumuladas) {
    return client.from(coleccion).select('data').is('deleted_at', null).order('id').range(desde, desde + PAGINA - 1)
      .then(function (res) {
        if (res.error) throw new Error(coleccion + ': ' + res.error.message);
        var filas = res.data || [];
        if (!filas.length) return acumuladas;
        return leerTabla(client, coleccion, desde + filas.length, acumuladas.concat(filas.map(function (r) { return r.data; })));
      });
  }

  function leerConfig(client) {
    return client.from('config').select('data,schema_version').eq('id', 'singleton').maybeSingle()
      .then(function (res) {
        if (res.error) throw new Error('config: ' + res.error.message);
        return res.data;
      });
  }

  // Lee las 12 tablas (en paralelo) + `config`, reconstruye el mismo `state`
  // que CrumblyCore.migrateState ya espera — cada fila viva (deleted_at is
  // null) aporta su `data` tal cual. El pull nunca trae filas borradas: a
  // diferencia de Sheets (V0: lápidas explícitas, hidratadas y excluidas a
  // mano), acá el filtro es un `where deleted_at is null` que Postgres
  // resuelve solo.
  function pull(client) {
    var lecturas = COLECCIONES.map(function (coleccion) {
      return leerTabla(client, coleccion, 0, []).then(function (filas) {
        return { coleccion: coleccion, filas: filas };
      });
    });
    var lecturaConfig = leerConfig(client).then(function (fila) {
      return fila || { data: {}, schema_version: undefined };
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

  // JSON con las claves ordenadas — para comparar un registro contra la
  // base sin depender del orden de claves. No es cosmético: Postgres
  // `jsonb` REORDENA las claves al guardar, así que una base guardada
  // desde un pull y el mismo registro armado localmente pueden tener el
  // mismo contenido en otro orden. Con JSON.stringify plano eso contaba
  // como "cambiado" y se volvía a subir la copia local — justo el pisado
  // silencioso de lo que otro dispositivo editó que el push por diferencia
  // existe para evitar.
  function jsonEstable(v) {
    if (Array.isArray(v)) return '[' + v.map(jsonEstable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) {
        return JSON.stringify(k) + ':' + jsonEstable(v[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // Todo lo que no es una de las 12 colecciones ni schemaVersion va a la
  // fila singleton de `config` (hoy: `config` en sí, más cualquier clave
  // suelta que el state traiga).
  function configDeState(state) {
    var payload = {};
    Object.keys(state || {}).forEach(function (k) { if (COLECCIONES.indexOf(k) === -1 && k !== 'schemaVersion') payload[k] = state[k]; });
    return payload;
  }

  // Escribe con upsert (por id — Postgres resuelve el conflicto por FILA,
  // no hace falta LockService global ni baseCatalogVersion/CATALOG_CONFLICT
  // de U4 a este nivel). La fusión por registro de mergeCatalogs (U4) sigue
  // siendo responsabilidad del cliente ANTES de llamar a push — acá solo se
  // escribe lo que ya se decidió escribir.
  //
  // `base`: el state tal cual quedó en la última sincronización exitosa de
  // ESTE dispositivo (mismo concepto que `crumbly-catalog-base`, pero con
  // las 12 colecciones + config). Con base, solo se suben los registros
  // nuevos o cuyo contenido difiere del de la base con el mismo id, y
  // config solo si cambió. Dos razones: (1) costo — sin esto cada push
  // (uno cada ~900ms de edición) reescribía TODAS las ventas de la
  // historia; (2) correctitud — un dispositivo con una copia vieja subía
  // SU versión de registros que nunca tocó, pisando en silencio lo que
  // otro dispositivo editó (el mismo problema de U4). Sin base (undefined)
  // sube todo — lo que necesita la migración única (migrarDesdeState).
  //
  // Un registro que está en la base y ya no está en `state` NO se borra:
  // los borrados se declaran explícitamente en `idsABorrar`, nunca se
  // infieren por ausencia (V0).
  //
  // `idsABorrar`: mismo contrato que js/sync.js (V0) — `{coleccion:
  // [id,...]}` de lo que ESTE dispositivo borró de verdad. Se traduce a un
  // soft-delete real (`deleted_at = now()`), no a una fila de lápida
  // sintética.
  function push(client, state, idsABorrar, base) {
    var ahora = new Date().toISOString();
    var escrituras = COLECCIONES.map(function (coleccion) {
      var enBase = null;
      if (base) {
        enBase = {};
        (base[coleccion] || []).forEach(function (r) { if (r && r.id != null) enBase[r.id] = jsonEstable(r); });
      }
      var filas = (state[coleccion] || []).filter(function (registro) {
        return !enBase || enBase[registro.id] !== jsonEstable(registro);
      }).map(function (registro) {
        return { id: registro.id, data: registro, updated_at: ahora };
      });
      var p = filas.length
        ? client.from(coleccion).upsert(filas).then(function (res) {
            if (res.error) throw new Error(coleccion + ': ' + res.error.message);
          })
        : Promise.resolve();
      var idsABorrarDeEsta = (idsABorrar && idsABorrar[coleccion]) || [];
      if (idsABorrarDeEsta.length) {
        p = p.then(function () {
          return client.from(coleccion).update({ deleted_at: ahora }).in('id', idsABorrarDeEsta);
        }).then(function (res) {
          if (res && res.error) throw new Error(coleccion + ' (borrado): ' + res.error.message);
        });
      }
      return p;
    });
    var configPayload = configDeState(state);
    var configCambio = !base ||
      jsonEstable(configPayload) !== jsonEstable(configDeState(base)) ||
      state.schemaVersion !== base.schemaVersion;
    var escrituraConfig = !configCambio ? Promise.resolve() : client.from('config').upsert({
      id: 'singleton', data: configPayload, schema_version: state.schemaVersion, updated_at: ahora
    }).then(function (res) {
      if (res.error) throw new Error('config: ' + res.error.message);
    });
    return Promise.all(escrituras.concat([escrituraConfig])).then(function () {
      return { ok: true, ts: ahora };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  }

  function contarVivas(client, coleccion) {
    return client.from(coleccion).select('id', { count: 'exact', head: true }).is('deleted_at', null)
      .then(function (res) {
        if (res.error) throw new Error(coleccion + ' (conteo): ' + res.error.message);
        return res.count || 0;
      });
  }
  function contarTodas(client) {
    return Promise.all(COLECCIONES.map(function (c) { return contarVivas(client, c); })).then(function (conteos) {
      var porColeccion = {};
      COLECCIONES.forEach(function (c, i) { porColeccion[c] = conteos[i]; });
      return porColeccion;
    });
  }

  // ─── Migración única Sheets → Supabase (plan, sección 5) ─────────────
  //
  // `state`: el estado real, ya leído del Sheet con el camino de HOY
  // (CrumblySync.pull + migrateState). Lo sube entero (push sin base) y
  // después RE-CUENTA en Supabase cada colección (count exacto, no un
  // select — no lo afecta el tope de Max rows) — mismo patrón que
  // verifyMigrationCounts de T1. `ok` solo si las 12 colecciones coinciden
  // y la fila de config quedó con el mismo schemaVersion (si faltara, el
  // próximo pull devolvería un state sin schemaVersion y migrateState
  // volvería a aplicar la corrección de valuación v9 sobre datos que ya la
  // tienen).
  //
  // Guardas ANTES de escribir nada:
  // - un registro sin id o dos con el mismo id en una colección → aborta
  //   (Postgres rechazaría el upsert de TODA la colección y quedaría una
  //   migración a medias);
  // - Supabase ya tiene filas vivas en alguna colección → aborta, salvo
  //   `opciones.forzar === true`. Para que correrla dos veces por error (o
  //   sobre datos reales ya cargados desde la app) no pise nada.
  function migrarDesdeState(client, state, opciones) {
    var forzar = !!(opciones && opciones.forzar);
    var problemas = [];
    COLECCIONES.forEach(function (c) {
      var vistos = {};
      ((state && state[c]) || []).forEach(function (r, i) {
        if (!r || r.id == null || r.id === '') problemas.push(c + '[' + i + '] no tiene id');
        else if (vistos[r.id]) problemas.push(c + ': id "' + r.id + '" repetido');
        else vistos[r.id] = true;
      });
    });
    if (problemas.length) {
      return Promise.resolve({ ok: false, error: 'Migración cancelada, no se escribió nada — registros con id inválido: ' + problemas.join('; ') });
    }
    return contarTodas(client).then(function (previos) {
      var conDatos = COLECCIONES.filter(function (c) { return previos[c] > 0; });
      if (conDatos.length && !forzar) {
        return {
          ok: false,
          error: 'Migración cancelada, no se escribió nada — Supabase ya tiene datos en: ' +
            conDatos.map(function (c) { return c + ' (' + previos[c] + ')'; }).join(', ') +
            '. Si de verdad querés subir el estado encima, volvé a correrla con { forzar: true }.'
        };
      }
      return push(client, state).then(function (r) {
        if (!r.ok) return { ok: false, error: 'La subida falló (puede haber quedado a medias): ' + r.error };
        return Promise.all([contarTodas(client), leerConfig(client)]).then(function (res) {
          var remotos = res[0], filaConfig = res[1];
          var conteos = {};
          var diferencias = [];
          COLECCIONES.forEach(function (c) {
            conteos[c] = { local: (state[c] || []).length, remoto: remotos[c] };
            if (conteos[c].local !== conteos[c].remoto) diferencias.push({ coleccion: c, local: conteos[c].local, remoto: conteos[c].remoto });
          });
          var versionRemota = filaConfig ? filaConfig.schema_version : null;
          if (versionRemota !== state.schemaVersion) {
            diferencias.push({ coleccion: 'config', local: state.schemaVersion, remoto: versionRemota });
          }
          return { ok: diferencias.length === 0, conteos: conteos, diferencias: diferencias };
        });
      });
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  }

  return {
    COLECCIONES: COLECCIONES,
    isConfigured: isConfigured,
    pull: pull,
    push: push,
    migrarDesdeState: migrarDesdeState
  };
});

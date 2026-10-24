/**
 * Crumbly — almacén de los dos valores GRANDES del dispositivo.
 *
 * 'crumbly-state' (el state completo) y 'crumbly-supabase-base' (la copia
 * de lo último sincronizado) ya no viven en localStorage: en iOS su tope
 * es ~5 MB y entre los dos lo pasaban. Viven en IndexedDB (DB `crumbly`,
 * store `kv`), cuyo tope es mucho mayor. Todo lo demás (sesión, `desde`,
 * preferencias, fecha del respaldo…) sigue en localStorage, son llaves
 * chicas.
 *
 * El resto de la app sigue siendo SINCRÓNICO: init() carga las dos llaves
 * a memoria una vez al abrir; get() lee de memoria; setMany() actualiza la
 * memoria al instante y persiste en segundo plano, en UNA transacción
 * (todas las llaves entran o ninguna: state y base nunca quedan
 * desparejos). Las escrituras van en fila; si se acumulan varias, se
 * escribe solo lo último de cada llave.
 *
 * Primera apertura después de la actualización: lo que haya en
 * localStorage se copia a IndexedDB y, SOLO si esa escritura salió bien,
 * se borra de localStorage (libera el tope).
 *
 * Sin IndexedDB (o si no abre): modo respaldo, todo va a localStorage
 * igual que antes, y setMany tira la excepción de localStorage tal cual
 * para que los caminos de error de siempre sigan andando.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CrumblyAlmacen = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'crumbly';
  var STORE = 'kv';
  var LLAVES = ['crumbly-state', 'crumbly-supabase-base'];

  // `entorno` permite inyectar indexedDB/localStorage/navigator (tests).
  // Sin él se usan los globales del navegador, leídos al llamar init().
  function crear(entorno) {
    entorno = entorno || {};
    function idb() { return 'indexedDB' in entorno ? entorno.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : undefined); }
    function ls() { return 'localStorage' in entorno ? entorno.localStorage : (typeof localStorage !== 'undefined' ? localStorage : undefined); }
    function nav() { return 'navigator' in entorno ? entorno.navigator : (typeof navigator !== 'undefined' ? navigator : undefined); }

    var memoria = new Map();
    var db = null;
    var respaldo = false; // true = sin IndexedDB, todo va a localStorage
    var inicio = null;
    var onErrorCb = null;
    var pendiente = null; // { valores: {llave: string|null}, esperando: [resolve…] }
    var cola = Promise.resolve();
    var iniciado = false;
    var tocadasAntes = {}; // llaves escritas antes de que init terminara: init no las pisa

    function abrir_() {
      return new Promise(function (resolve, reject) {
        var fabrica = idb();
        if (!fabrica || typeof fabrica.open !== 'function') return reject(new Error('IndexedDB no disponible'));
        var req;
        try { req = fabrica.open(DB_NAME, 1); } catch (e) { return reject(e); }
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames || !d.objectStoreNames.contains || !d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        };
        req.onsuccess = function () {
          var d = req.result;
          // Otra pestaña con una versión nueva del esquema: se cierra para no trabarla.
          d.onversionchange = function () { try { d.close(); } catch (e) {} db = null; };
          resolve(d);
        };
        req.onerror = function () { reject(req.error || new Error('No se pudo abrir IndexedDB')); };
        req.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
      });
    }

    function leerTodas_(d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readonly');
        var store = tx.objectStore(STORE);
        var valores = {};
        LLAVES.forEach(function (k) {
          var r = store.get(k);
          r.onsuccess = function () { valores[k] = r.result === undefined ? null : r.result; };
        });
        tx.oncomplete = function () { resolve(valores); };
        tx.onerror = function () { reject(tx.error || new Error('Error leyendo IndexedDB')); };
        tx.onabort = function () { reject(tx.error || new Error('Lectura de IndexedDB abortada')); };
      });
    }

    function escribir_(d, valores) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        Object.keys(valores).forEach(function (k) {
          if (valores[k] === null) store.delete(k);
          else store.put(valores[k], k);
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('Error escribiendo IndexedDB')); };
        tx.onabort = function () { reject(tx.error || new Error('Escritura de IndexedDB abortada')); };
      });
    }

    // iOS a veces cierra la conexión con la app en segundo plano: si la
    // transacción ni siquiera se puede crear, se reabre una vez y se reintenta.
    function escribirConReintento_(valores) {
      var intento = function () { return db ? escribir_(db, valores) : Promise.reject(new Error('IndexedDB cerrado')); };
      var p;
      try { p = intento(); } catch (e) { p = Promise.reject(e); }
      return p.catch(function (err) {
        if (err && err.name === 'QuotaExceededError') throw err;
        return abrir_().then(function (d) { db = d; return escribir_(d, valores); }, function () { throw err; });
      });
    }

    function init() {
      if (inicio) return inicio;
      inicio = abrir_()
        .then(function (d) {
          db = d;
          return leerTodas_(d);
        })
        .then(function (valores) {
          var almacen = ls();
          var migrar = {};
          LLAVES.forEach(function (k) {
            if (tocadasAntes[k]) return;
            var v = valores[k];
            if (v === null || v === undefined) {
              var viejo = null;
              try { viejo = almacen ? almacen.getItem(k) : null; } catch (e) { viejo = null; }
              if (viejo !== null && viejo !== undefined) { v = viejo; migrar[k] = viejo; }
            }
            if (v !== null && v !== undefined) memoria.set(k, String(v));
          });
          var llavesMigradas = Object.keys(migrar);
          if (!llavesMigradas.length) return;
          return escribir_(db, migrar).then(function () {
            llavesMigradas.forEach(function (k) { try { almacen.removeItem(k); } catch (e) {} });
          }, function () {
            // No entró a IndexedDB: se deja en localStorage (sigue en memoria
            // igual); la próxima apertura vuelve a intentar.
          });
        })
        .catch(function () {
          respaldo = true;
          db = null;
          memoria.clear();
        })
        .then(function () {
          iniciado = true;
          try {
            var n = nav();
            if (n && n.storage && n.storage.persist) Promise.resolve(n.storage.persist()).catch(function () {});
          } catch (e) {}
        });
      return inicio;
    }

    function get(k) {
      if (respaldo) {
        var almacen = ls();
        return almacen ? almacen.getItem(k) : null; // tira igual que localStorage (loadState avisa)
      }
      return memoria.has(k) ? memoria.get(k) : null;
    }

    function escribirPendiente_() {
      var lote = pendiente;
      pendiente = null;
      if (!lote) return Promise.resolve();
      return escribirConReintento_(lote.valores).then(function () {
        lote.esperando.forEach(function (r) { r(true); });
      }, function (err) {
        try { if (onErrorCb) onErrorCb(err); } catch (e) {}
        lote.esperando.forEach(function (r) { r(false); });
      });
    }

    // Resuelve true si se guardó, false si falló (después de avisar a onError).
    // Nunca rechaza en modo IndexedDB. En modo respaldo tira sincrónico.
    function setMany(obj) {
      var llaves = Object.keys(obj || {});
      var valores = {};
      llaves.forEach(function (k) { valores[k] = obj[k] === null || obj[k] === undefined ? null : String(obj[k]); });
      if (respaldo) {
        var almacen = ls();
        if (!almacen) throw new Error('Almacenamiento no disponible');
        llaves.forEach(function (k) {
          if (valores[k] === null) almacen.removeItem(k);
          else almacen.setItem(k, valores[k]);
        });
        return Promise.resolve(true);
      }
      llaves.forEach(function (k) {
        if (!iniciado) tocadasAntes[k] = true;
        if (valores[k] === null) memoria.delete(k); else memoria.set(k, valores[k]);
      });
      if (!pendiente) {
        pendiente = { valores: {}, esperando: [] };
        // Antes de init (o mientras abre) la escritura espera a que abra.
        var listo = inicio || Promise.resolve();
        cola = cola.then(function () { return listo; }).then(function () {
          if (respaldo) {
            // init cayó a localStorage después de que se encoló esto.
            var lote = pendiente; pendiente = null;
            try { setMany(lote.valores); lote.esperando.forEach(function (r) { r(true); }); }
            catch (err) { try { if (onErrorCb) onErrorCb(err); } catch (e) {} lote.esperando.forEach(function (r) { r(false); }); }
            return;
          }
          return escribirPendiente_();
        });
      }
      Object.assign(pendiente.valores, valores);
      return new Promise(function (resolve) { pendiente.esperando.push(resolve); });
    }

    function set(k, v) { return setMany(oneKey_(k, v)); }
    function remove(k) { return setMany(oneKey_(k, null)); }
    function oneKey_(k, v) { var o = {}; o[k] = v; return o; }

    function flush() {
      return cola.then(function () { return pendiente ? cola : undefined; }).then(function () {});
    }

    function onError(cb) { onErrorCb = cb; }
    function modo() { return respaldo ? 'localStorage' : (db ? 'indexedDB' : 'sin-iniciar'); }

    return { init: init, get: get, set: set, setMany: setMany, remove: remove, flush: flush, onError: onError, modo: modo, LLAVES: LLAVES };
  }

  var porDefecto = crear();
  porDefecto.crear = crear;
  return porDefecto;
});

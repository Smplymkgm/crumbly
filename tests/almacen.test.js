/**
 * Tests del almacén en IndexedDB (js/almacen.js). Correr con:
 * node tests/almacen.test.js
 * Node no trae IndexedDB: se usa un falso mínimo en memoria (open /
 * transaction / objectStore / get / put / delete / oncomplete / onerror),
 * con transacciones de verdad atómicas (todo o nada), y un falso
 * localStorage. Cada test arma su propio almacén con CrumblyAlmacen.crear.
 */
const assert = require('assert');
const path = require('path');
const CrumblyAlmacen = require(path.join(__dirname, '..', 'js', 'almacen.js'));

function fakeLocalStorage(inicial, opts) {
  const store = Object.assign({}, inicial || {});
  opts = opts || {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (opts.tope && String(v).length > opts.tope) { const e = new Error('lleno'); e.name = 'QuotaExceededError'; throw e; }
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
}

// Falso IndexedDB. `datos` es el contenido "en disco" (por store). Una
// transacción junta sus operaciones y las aplica todas juntas al
// completar; si `falla(op)` devuelve un error para alguna, no aplica
// ninguna y dispara onerror.
function fakeIndexedDB(opts) {
  opts = opts || {};
  const discos = {}; // nombreDB -> { stores: { nombre: Map } }
  const asincrono = (fn) => setTimeout(fn, 0);
  const fabrica = {
    transacciones: 0,
    discos,
    falla: opts.falla || null,
    open(nombre) {
      const req = { result: null, error: null };
      asincrono(() => {
        if (opts.abreMal) { req.error = new Error('open falló'); if (req.onerror) req.onerror(); return; }
        let nueva = false;
        if (!discos[nombre]) { discos[nombre] = { stores: {} }; nueva = true; }
        const disco = discos[nombre];
        const db = {
          objectStoreNames: { contains: (n) => n in disco.stores },
          createObjectStore(n) { disco.stores[n] = new Map(); },
          close() {},
          transaction(storeName, modo) {
            fabrica.transacciones++;
            const ops = [];
            const tx = { error: null, mode: modo };
            tx.objectStore = () => ({
              get(k) {
                const r = {};
                ops.push(() => { r.result = disco.stores[storeName].get(k); if (r.onsuccess) r.onsuccess(); });
                return r;
              },
              put(v, k) { ops.push({ tipo: 'put', k, v }); return {}; },
              delete(k) { ops.push({ tipo: 'delete', k }); return {}; }
            });
            asincrono(() => {
              const escrituras = ops.filter(o => typeof o !== 'function');
              const err = fabrica.falla && escrituras.map(fabrica.falla).find(Boolean);
              if (err) { tx.error = err; if (tx.onerror) tx.onerror(); if (tx.onabort) tx.onabort(); return; }
              ops.forEach(o => {
                if (typeof o === 'function') o();
                else if (o.tipo === 'put') disco.stores[storeName].set(o.k, o.v);
                else disco.stores[storeName].delete(o.k);
              });
              if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
          }
        };
        req.result = db;
        if (nueva && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    kv() { return discos.crumbly ? discos.crumbly.stores.kv : undefined; }
  };
  return fabrica;
}

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function group(name) { tests.push([null, () => console.log('\n== ' + name + ' ==')]); }

group('migración desde localStorage');

test('la primera vez copia state y base a IndexedDB y los borra de localStorage', async () => {
  const ls = fakeLocalStorage({ 'crumbly-state': '{"ventas":[1]}', 'crumbly-supabase-base': '{"b":1}', 'crumbly-session': 'S' });
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: ls, navigator: {} });
  await a.init();
  assert.strictEqual(a.modo(), 'indexedDB');
  assert.strictEqual(a.get('crumbly-state'), '{"ventas":[1]}');
  assert.strictEqual(a.get('crumbly-supabase-base'), '{"b":1}');
  assert.strictEqual(idb.kv().get('crumbly-state'), '{"ventas":[1]}');
  assert.strictEqual(idb.kv().get('crumbly-supabase-base'), '{"b":1}');
  assert.strictEqual(ls.getItem('crumbly-state'), null);
  assert.strictEqual(ls.getItem('crumbly-supabase-base'), null);
  assert.strictEqual(ls.getItem('crumbly-session'), 'S', 'las llaves chicas no se tocan');
});

test('si la escritura de la migración falla, NO se borra de localStorage', async () => {
  const ls = fakeLocalStorage({ 'crumbly-state': 'S1' });
  const quota = new Error('lleno'); quota.name = 'QuotaExceededError';
  const idb = fakeIndexedDB({ falla: () => quota });
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: ls, navigator: {} });
  await a.init();
  assert.strictEqual(a.get('crumbly-state'), 'S1', 'igual queda en memoria');
  assert.strictEqual(ls.getItem('crumbly-state'), 'S1');
});

test('si IndexedDB ya tiene el valor, gana sobre el de localStorage', async () => {
  const idb = fakeIndexedDB();
  const a1 = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a1.init();
  await a1.set('crumbly-state', 'NUEVO');
  const ls = fakeLocalStorage({ 'crumbly-state': 'VIEJO' });
  const a2 = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: ls, navigator: {} });
  await a2.init();
  assert.strictEqual(a2.get('crumbly-state'), 'NUEVO');
});

test('pide almacenamiento persistente (y no le importa la respuesta)', async () => {
  let pedido = 0;
  const nav = { storage: { persist: () => { pedido++; return Promise.reject(new Error('no')); } } };
  const a = CrumblyAlmacen.crear({ indexedDB: fakeIndexedDB(), localStorage: fakeLocalStorage(), navigator: nav });
  await a.init();
  assert.strictEqual(pedido, 1);
});

group('get / set / setMany');

test('get después de set devuelve el valor al instante y queda en disco tras flush', async () => {
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a.init();
  a.set('crumbly-state', 'X');
  assert.strictEqual(a.get('crumbly-state'), 'X', 'sincrónico');
  await a.flush();
  assert.strictEqual(idb.kv().get('crumbly-state'), 'X');
  a.remove('crumbly-state');
  assert.strictEqual(a.get('crumbly-state'), null);
  await a.flush();
  assert.strictEqual(idb.kv().has('crumbly-state'), false);
});

test('setMany escribe todas las llaves en UNA transacción', async () => {
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a.init();
  const antes = idb.transacciones;
  const ok = await a.setMany({ 'crumbly-state': 'S', 'crumbly-supabase-base': 'B' });
  assert.strictEqual(ok, true);
  assert.strictEqual(idb.transacciones - antes, 1);
  assert.strictEqual(idb.kv().get('crumbly-state'), 'S');
  assert.strictEqual(idb.kv().get('crumbly-supabase-base'), 'B');
});

test('setMany es atómico: si una llave falla, no se escribe ninguna', async () => {
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a.init();
  await a.setMany({ 'crumbly-state': 'S0', 'crumbly-supabase-base': 'B0' });
  const quota = new Error('lleno'); quota.name = 'QuotaExceededError';
  idb.falla = (op) => (op.k === 'crumbly-supabase-base' ? quota : null);
  const ok = await a.setMany({ 'crumbly-state': 'S1', 'crumbly-supabase-base': 'B1' });
  assert.strictEqual(ok, false);
  assert.strictEqual(idb.kv().get('crumbly-state'), 'S0', 'el state tampoco entró');
  assert.strictEqual(idb.kv().get('crumbly-supabase-base'), 'B0');
});

test('varias escrituras seguidas se juntan y queda lo último', async () => {
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a.init();
  const antes = idb.transacciones;
  const ps = [];
  for (let i = 0; i < 20; i++) ps.push(a.set('crumbly-state', 'v' + i));
  ps.push(a.setMany({ 'crumbly-supabase-base': 'B', 'crumbly-state': 'final' }));
  const res = await Promise.all(ps);
  assert.ok(res.every(r => r === true));
  assert.ok(idb.transacciones - antes <= 2, 'se juntaron: ' + (idb.transacciones - antes) + ' transacciones');
  assert.strictEqual(idb.kv().get('crumbly-state'), 'final');
  assert.strictEqual(idb.kv().get('crumbly-supabase-base'), 'B');
});

test('un set antes de que termine init no lo pisa lo que había en disco', async () => {
  const idb = fakeIndexedDB();
  const a1 = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a1.init();
  await a1.set('crumbly-state', 'DISCO');
  const a2 = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  const p = a2.init();
  a2.set('crumbly-state', 'TEMPRANO');
  await p;
  assert.strictEqual(a2.get('crumbly-state'), 'TEMPRANO');
  await a2.flush();
  assert.strictEqual(idb.kv().get('crumbly-state'), 'TEMPRANO');
});

group('errores');

test('una transacción que falla llama a onError y resuelve false', async () => {
  const idb = fakeIndexedDB();
  const a = CrumblyAlmacen.crear({ indexedDB: idb, localStorage: fakeLocalStorage(), navigator: {} });
  await a.init();
  const errores = [];
  a.onError(e => errores.push(e));
  const quota = new Error('lleno'); quota.name = 'QuotaExceededError';
  idb.falla = () => quota;
  const ok = await a.set('crumbly-state', 'X');
  assert.strictEqual(ok, false);
  assert.strictEqual(errores.length, 1);
  assert.strictEqual(errores[0].name, 'QuotaExceededError');
  assert.strictEqual(a.get('crumbly-state'), 'X', 'la memoria sigue con el valor nuevo');
  idb.falla = null;
  assert.strictEqual(await a.set('crumbly-state', 'Y'), true, 'se recupera en la siguiente');
  assert.strictEqual(errores.length, 1);
});

group('respaldo en localStorage');

test('sin indexedDB usa localStorage y init resuelve igual', async () => {
  const ls = fakeLocalStorage({ 'crumbly-state': 'LS' });
  const a = CrumblyAlmacen.crear({ indexedDB: undefined, localStorage: ls, navigator: {} });
  await a.init();
  assert.strictEqual(a.modo(), 'localStorage');
  assert.strictEqual(a.get('crumbly-state'), 'LS');
  a.setMany({ 'crumbly-state': 'S', 'crumbly-supabase-base': 'B' });
  assert.strictEqual(ls.getItem('crumbly-state'), 'S', 'escribe sincrónico');
  assert.strictEqual(ls.getItem('crumbly-supabase-base'), 'B');
  a.remove('crumbly-supabase-base');
  assert.strictEqual(ls.getItem('crumbly-supabase-base'), null);
});

test('si open falla, cae a localStorage sin rechazar', async () => {
  const ls = fakeLocalStorage({ 'crumbly-state': 'LS' });
  const a = CrumblyAlmacen.crear({ indexedDB: fakeIndexedDB({ abreMal: true }), localStorage: ls, navigator: {} });
  await a.init();
  assert.strictEqual(a.modo(), 'localStorage');
  assert.strictEqual(a.get('crumbly-state'), 'LS');
  assert.strictEqual(ls.getItem('crumbly-state'), 'LS', 'no se borra nada');
});

test('en respaldo, setMany tira como localStorage (lleno)', async () => {
  const ls = fakeLocalStorage({}, { tope: 10 });
  const a = CrumblyAlmacen.crear({ indexedDB: undefined, localStorage: ls, navigator: {} });
  await a.init();
  assert.throws(() => a.set('crumbly-state', 'x'.repeat(50)), e => e.name === 'QuotaExceededError');
});

(async () => {
  for (const [name, fn] of tests) {
    if (name === null) { fn(); continue; }
    try {
      await fn();
      passed++;
      console.log('  ok  ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL  ' + name);
      console.log('      ' + e.message);
    }
  }
  console.log('\n== Resumen ==');
  console.log(passed + ' pasaron, ' + failed + ' fallaron');
  process.exit(failed ? 1 : 0);
})();

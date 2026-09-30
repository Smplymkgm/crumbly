/**
 * Tests del cliente de sincronización con Supabase (js/supabaseSync.js).
 * Correr con: node tests/supabaseSync.test.js
 * Sin red real — se inyecta un cliente falso que imita la forma mínima de
 * supabase-js que este archivo usa (`.from(tabla).select()/.upsert()/
 * .update()`, encadenable, resuelve a `{data, error}`).
 */
const assert = require('assert');
const path = require('path');
const Sync = require(path.join(__dirname, '..', 'js', 'supabaseSync.js'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function group(name) { tests.push([null, () => console.log('\n== ' + name + ' ==')]); }

// Cliente falso: `tablas` es { nombre: [ {id, data, deleted_at}, ... ] } —
// el estado "real" de cada tabla, mutado por upsert/update como lo haría
// Postgres. Cada método de la cadena registra la llamada en `calls` para
// que los tests puedan inspeccionar qué se pidió.
function fakeClient(tablas) {
  tablas = tablas || {};
  const calls = [];
  function tabla(nombre) {
    if (!tablas[nombre]) tablas[nombre] = [];
    return {
      select: function () {
        calls.push({ tabla: nombre, op: 'select' });
        const builder = {
          is: function (col, val) {
            const filas = tablas[nombre].filter(r => (val === null ? r[col] == null : r[col] === val));
            return Promise.resolve({ data: filas, error: null });
          },
          eq: function (col, val) {
            const filas = tablas[nombre].filter(r => r[col] === val);
            return {
              maybeSingle: function () { return Promise.resolve({ data: filas[0] || null, error: null }); }
            };
          }
        };
        return builder;
      },
      upsert: function (filasNuevas) {
        calls.push({ tabla: nombre, op: 'upsert', filas: filasNuevas });
        const arr = Array.isArray(filasNuevas) ? filasNuevas : [filasNuevas];
        arr.forEach(function (fila) {
          const idx = tablas[nombre].findIndex(r => r.id === fila.id);
          if (idx === -1) tablas[nombre].push(Object.assign({ deleted_at: null }, fila));
          else tablas[nombre][idx] = Object.assign({}, tablas[nombre][idx], fila);
        });
        return Promise.resolve({ data: arr, error: null });
      },
      update: function (cambios) {
        calls.push({ tabla: nombre, op: 'update', cambios: cambios });
        return {
          in: function (col, valores) {
            tablas[nombre].forEach(function (fila) {
              if (valores.indexOf(fila[col]) !== -1) Object.assign(fila, cambios);
            });
            return Promise.resolve({ data: null, error: null });
          }
        };
      }
    };
  }
  return { from: tabla, calls: calls, tablas: tablas };
}

group('pull');

test('reconstruye el state a partir de las 12 tablas + config', async () => {
  const c = fakeClient({
    materia: [{ id: 'm1', data: { id: 'm1', nombre: 'Harina', costo: 5 }, deleted_at: null }],
    config: [{ id: 'singleton', data: { email: 'x@x.com' }, schema_version: 8 }]
  });
  const r = await Sync.pull(c);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state.materia, [{ id: 'm1', nombre: 'Harina', costo: 5 }]);
  assert.strictEqual(r.state.email, 'x@x.com');
  assert.strictEqual(r.state.schemaVersion, 8);
  // las otras 11 colecciones existen como array vacío, nunca undefined
  assert.deepStrictEqual(r.state.ventas, []);
  assert.deepStrictEqual(r.state.productos, []);
});

test('CRITERIO: una fila con deleted_at no vuelve en el pull (soft-delete real, sin lápida sintética)', async () => {
  const c = fakeClient({
    gastos: [
      { id: 'g1', data: { id: 'g1', monto: 100 }, deleted_at: null },
      { id: 'g2', data: { id: 'g2', monto: 200 }, deleted_at: '2026-01-01T00:00:00Z' }
    ]
  });
  const r = await Sync.pull(c);
  assert.strictEqual(r.state.gastos.length, 1);
  assert.strictEqual(r.state.gastos[0].id, 'g1');
});

test('propaga un error de Postgres sin lanzar', async () => {
  const c = fakeClient();
  c.from = function (nombre) {
    return {
      select: function () {
        return {
          is: function () { return Promise.resolve({ data: null, error: { message: 'tabla no existe' } }); },
          eq: function () { return { maybeSingle: function () { return Promise.resolve({ data: null, error: null }); } }; }
        };
      }
    };
  };
  const r = await Sync.pull(c);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('tabla no existe') !== -1);
});

group('push');

test('hace upsert de cada colección no vacía, con el registro completo en `data`', async () => {
  const c = fakeClient();
  const state = { materia: [{ id: 'm1', nombre: 'Harina' }], ventas: [], email: 'x@x.com', schemaVersion: 8 };
  const r = await Sync.push(c, state);
  assert.strictEqual(r.ok, true);
  const upsertMateria = c.calls.find(x => x.tabla === 'materia' && x.op === 'upsert');
  assert.ok(upsertMateria, 'debe hacer upsert de materia');
  assert.strictEqual(upsertMateria.filas[0].id, 'm1');
  assert.deepStrictEqual(upsertMateria.filas[0].data, { id: 'm1', nombre: 'Harina' });
  // ventas está vacío — no hace falta ni siquiera llamar upsert
  assert.ok(!c.calls.find(x => x.tabla === 'ventas' && x.op === 'upsert'));
});

test('CRITERIO: config guarda el resto de las claves sueltas (email, factorPrestacional...) y schemaVersion aparte', async () => {
  const c = fakeClient();
  const state = { materia: [], email: 'x@x.com', factorPrestacional: 1.38, schemaVersion: 8 };
  await Sync.push(c, state);
  const upsertConfig = c.calls.find(x => x.tabla === 'config' && x.op === 'upsert');
  assert.strictEqual(upsertConfig.filas.id, 'singleton');
  assert.deepStrictEqual(upsertConfig.filas.data, { email: 'x@x.com', factorPrestacional: 1.38 });
  assert.strictEqual(upsertConfig.filas.schema_version, 8);
});

test('CRITERIO: idsABorrar hace un soft-delete real (deleted_at) — no un upsert, no una fila de lápida', async () => {
  const c = fakeClient({ gastos: [{ id: 'g1', data: { id: 'g1' }, deleted_at: null }] });
  const r = await Sync.push(c, { gastos: [] }, { gastos: ['g1'] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.tablas.gastos[0].deleted_at !== null, true);
  // sigue existiendo la fila (soft-delete, no un delete real) — el pull la excluye por el filtro, no porque falte
  assert.strictEqual(c.tablas.gastos.length, 1);
});

test('un push sin idsABorrar no borra nada', async () => {
  const c = fakeClient({ gastos: [{ id: 'g1', data: { id: 'g1' }, deleted_at: null }] });
  await Sync.push(c, { gastos: [{ id: 'g1' }] });
  assert.strictEqual(c.tablas.gastos[0].deleted_at, null);
});

test('propaga un error de Postgres en push sin lanzar', async () => {
  const c = fakeClient();
  c.from = function (nombre) {
    return { upsert: function () { return Promise.resolve({ data: null, error: { message: 'RLS violada' } }); } };
  };
  const r = await Sync.push(c, { materia: [{ id: 'm1' }] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('RLS violada') !== -1);
});

group('isConfigured');

test('falso sin cliente, verdadero con cliente', () => {
  assert.strictEqual(Sync.isConfigured(null), false);
  assert.strictEqual(Sync.isConfigured(fakeClient()), true);
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

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
// Postgres. Cada llamada a select/upsert/update se registra en `calls` para
// que los tests puedan inspeccionar qué se pidió. `select` arma una
// consulta encadenable (is/eq/order/range/maybeSingle) que se resuelve al
// hacer `then`, igual que el builder de supabase-js. `maxRows` imita el
// tope "Max rows" de PostgREST (1000 por defecto en Supabase).
function fakeClient(tablas, maxRows) {
  tablas = tablas || {};
  maxRows = maxRows || 1000;
  const calls = [];
  function tabla(nombre) {
    if (!tablas[nombre]) tablas[nombre] = [];
    return {
      select: function (cols, opts) {
        calls.push({ tabla: nombre, op: 'select', cols: cols, opts: opts });
        const filtros = [];
        let orden = null, rango = null;
        function resolver() {
          let filas = tablas[nombre].filter(r => filtros.every(f => f(r)));
          if (opts && opts.head) return { data: null, count: filas.length, error: null };
          if (orden) filas = filas.slice().sort((x, y) => (x[orden] < y[orden] ? -1 : x[orden] > y[orden] ? 1 : 0));
          if (rango) filas = filas.slice(rango[0], rango[1] + 1);
          return { data: filas.slice(0, maxRows), error: null };
        }
        const q = {
          is: function (col, val) { filtros.push(r => (val === null ? r[col] == null : r[col] === val)); return q; },
          eq: function (col, val) { filtros.push(r => r[col] === val); return q; },
          gte: function (col, val) { filtros.push(r => r[col] != null && r[col] >= val); return q; },
          order: function (col) { orden = col; return q; },
          range: function (desde, hasta) { rango = [desde, hasta]; return q; },
          gt: function (col, val) { filtros.push(r => r[col] > val); return q; },
          limit: function (n) { rango = [0, n - 1]; return q; },
          maybeSingle: function () { const r = resolver(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
          then: function (ok, err) { return Promise.resolve(resolver()).then(ok, err); }
        };
        return q;
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

// Filas upserteadas en una tabla (todas las llamadas juntas).
function upserteadas(c, nombre) {
  return c.calls.filter(x => x.tabla === nombre && x.op === 'upsert').reduce((acc, x) => acc.concat(x.filas), []);
}
function filaViva(id, data) { return { id: id, data: data, deleted_at: null }; }

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
        const q = {
          is: function () { return q; }, order: function () { return q; }, range: function () { return q; }, limit: function () { return q; }, gt: function () { return q; },
          then: function (ok) { return Promise.resolve({ data: null, error: { message: 'tabla no existe' } }).then(ok); },
          eq: function () { return { maybeSingle: function () { return Promise.resolve({ data: null, error: null }); } }; }
        };
        return q;
      }
    };
  };
  const r = await Sync.pull(c);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('tabla no existe') !== -1);
});

test('CRITERIO: pagina más allá del tope de Max rows — 2500 ventas vuelven las 2500, no 1000', async () => {
  const ventas = [];
  for (let i = 0; i < 2500; i++) { const id = 'v' + String(i).padStart(5, '0'); ventas.push(filaViva(id, { id: id })); }
  const c = fakeClient({ ventas: ventas });
  const r = await Sync.pull(c);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.ventas.length, 2500);
  assert.strictEqual(new Set(r.state.ventas.map(v => v.id)).size, 2500);
});

test('pagina bien aunque el proyecto tenga un Max rows MENOR que la página pedida', async () => {
  const ventas = [];
  for (let i = 0; i < 1200; i++) { const id = 'v' + String(i).padStart(5, '0'); ventas.push(filaViva(id, { id: id })); }
  const c = fakeClient({ ventas: ventas }, 500);
  const r = await Sync.pull(c);
  assert.strictEqual(r.state.ventas.length, 1200);
});

test('sin fila de config: state sin schemaVersion (migrateState decide), sin romper', async () => {
  const c = fakeClient({ materia: [filaViva('m1', { id: 'm1' })] });
  const r = await Sync.pull(c);
  assert.strictEqual(r.ok, true);
  assert.strictEqual('schemaVersion' in r.state, false);
  assert.strictEqual(r.state.materia.length, 1);
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

group('push con base (solo lo que cambió)');

const BASE = {
  schemaVersion: 9,
  materia: [{ id: 'm1', nombre: 'Harina', costo: 5 }, { id: 'm2', nombre: 'Azúcar', costo: 3 }],
  ventas: [{ id: 'v1', total: 100 }, { id: 'v2', total: 200 }],
  config: { email: 'x@x.com', factorPrestacional: 1.38 }
};
function copia(o) { return JSON.parse(JSON.stringify(o)); }

test('CRITERIO: solo se sube el registro que cambió respecto de la base', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.materia[0].costo = 6;
  const r = await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(r.ok, true);
  const m = upserteadas(c, 'materia');
  assert.deepStrictEqual(m.map(f => f.id), ['m1']);
  assert.strictEqual(m[0].data.costo, 6);
});

test('CRITERIO: un registro que no toqué NO viaja — un dispositivo con copia vieja no pisa lo que editó otro', async () => {
  // En Supabase, otro dispositivo ya cambió m2 a costo 4; este dispositivo
  // todavía tiene la versión de la base (costo 3) y solo editó m1.
  const c = fakeClient({ materia: [filaViva('m1', BASE.materia[0]), filaViva('m2', { id: 'm2', nombre: 'Azúcar', costo: 4 })] });
  const state = copia(BASE);
  state.materia[0].costo = 6;
  await Sync.push(c, state, undefined, BASE);
  assert.ok(!upserteadas(c, 'materia').some(f => f.id === 'm2'));
  assert.strictEqual(c.tablas.materia.find(f => f.id === 'm2').data.costo, 4);
  // ni las ventas de la historia se reescriben
  assert.strictEqual(upserteadas(c, 'ventas').length, 0);
});

test('CRITERIO: un registro nuevo (id que la base no tiene) se sube', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.ventas.push({ id: 'v3', total: 300 });
  await Sync.push(c, state, undefined, BASE);
  assert.deepStrictEqual(upserteadas(c, 'ventas').map(f => f.id), ['v3']);
  assert.strictEqual(upserteadas(c, 'materia').length, 0);
});

test('mismo contenido con las claves en otro orden (jsonb las reordena) NO cuenta como cambio', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.materia[1] = { costo: 3, nombre: 'Azúcar', id: 'm2' };
  await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(upserteadas(c, 'materia').length, 0);
});

test('CRITERIO: un registro que está en la base y ya no en el state lo borré yo → soft-delete (insumo, producto, cliente...)', async () => {
  const c = fakeClient({ materia: [filaViva('m1', BASE.materia[0]), filaViva('m2', BASE.materia[1])] });
  const state = copia(BASE);
  state.materia = state.materia.filter(m => m.id !== 'm2');
  const r = await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(r.ok, true);
  assert.ok(c.tablas.materia.find(f => f.id === 'm2').deleted_at);
  assert.strictEqual(c.tablas.materia.find(f => f.id === 'm1').deleted_at, null);
});

test('CRITERIO: lo que otro dispositivo agregó y yo todavía no bajé (no está en MI base) nunca se borra', async () => {
  const c = fakeClient({ materia: [filaViva('m1', BASE.materia[0]), filaViva('m2', BASE.materia[1]), filaViva('m9', { id: 'm9', nombre: 'Nuevo de otro' })] });
  await Sync.push(c, copia(BASE), undefined, BASE);
  assert.ok(!c.calls.some(x => x.op === 'update'));
  assert.strictEqual(c.tablas.materia.find(f => f.id === 'm9').deleted_at, null);
});

test('CRITERIO: freno — borrar más de la mitad de una colección de golpe (y más de 5) no escribe NADA', async () => {
  const base = copia(BASE);
  base.ventas = Array.from({ length: 10 }, (_, i) => ({ id: 'v' + i, total: i }));
  const state = copia(base);
  state.ventas = state.ventas.slice(0, 2); // 8 de 10 "desaparecen"
  state.materia[0].costo = 99; // y un cambio legítimo que tampoco debe viajar
  const c = fakeClient();
  const r = await Sync.push(c, state, undefined, base);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'BORRADO_MASIVO');
  assert.strictEqual(c.calls.filter(x => x.op !== 'select').length, 0);
});

test('una colección que falta del state (undefined) no se lee como "borré todo"', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  delete state.ventas;
  const r = await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(r.ok, true);
  assert.ok(!c.calls.some(x => x.op === 'update'));
});

test('sin base (migración) no se infiere ningún borrado', async () => {
  const c = fakeClient({ materia: [filaViva('mX', { id: 'mX' })] });
  await Sync.push(c, copia(BASE));
  assert.ok(!c.calls.some(x => x.op === 'update'));
});

test('CRITERIO: sin base, sube todo (lo que necesita la migración única)', async () => {
  const c = fakeClient();
  const r = await Sync.push(c, copia(BASE));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(upserteadas(c, 'materia').map(f => f.id), ['m1', 'm2']);
  assert.deepStrictEqual(upserteadas(c, 'ventas').map(f => f.id), ['v1', 'v2']);
  assert.ok(c.calls.some(x => x.tabla === 'config' && x.op === 'upsert'));
});

test('CRITERIO: config sin cambios respecto de la base no se escribe', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.ventas.push({ id: 'v3', total: 300 });
  await Sync.push(c, state, undefined, BASE);
  assert.ok(!c.calls.some(x => x.tabla === 'config'));
});

test('config con una clave cambiada sí se escribe', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.config.factorPrestacional = 1.5;
  await Sync.push(c, state, undefined, BASE);
  const up = c.calls.find(x => x.tabla === 'config' && x.op === 'upsert');
  assert.ok(up);
  assert.strictEqual(up.filas.data.config.factorPrestacional, 1.5);
});

test('schemaVersion distinto al de la base también escribe config', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.schemaVersion = 10;
  await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(c.calls.find(x => x.tabla === 'config' && x.op === 'upsert').filas.schema_version, 10);
});

test('nada cambió → ninguna escritura, ok:true', async () => {
  const c = fakeClient();
  const r = await Sync.push(c, copia(BASE), undefined, BASE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.calls.length, 0);
});

test('idsABorrar sigue funcionando con base', async () => {
  const c = fakeClient({ ventas: [filaViva('v1', BASE.ventas[0])] });
  const state = copia(BASE);
  state.ventas = state.ventas.filter(v => v.id !== 'v1');
  await Sync.push(c, state, { ventas: ['v1'] }, BASE);
  assert.ok(c.tablas.ventas[0].deleted_at);
});

group('push: auditoría (revivir, config por clave, lo enviado)');

test('CRITERIO: un id que vuelve (reclasificado ida y vuelta) revive su fila — deleted_at: null en el upsert', async () => {
  const c = fakeClient({ materia: [{ id: 'm1', data: BASE.materia[0], deleted_at: '2026-09-30T10:00:00Z' }] });
  const base = copia(BASE); base.materia = [BASE.materia[1]]; // m1 no estaba (se había movido a empaques)
  await Sync.push(c, copia(BASE), undefined, base);
  assert.strictEqual(c.tablas.materia.find(f => f.id === 'm1').deleted_at, null);
});

test('CRITERIO: config se fusiona CLAVE POR CLAVE — no revierte lo que otro dispositivo cambió en otra clave', async () => {
  // En el servidor, otro dispositivo ya cambió factorPrestacional a 1.5.
  const c = fakeClient({ config: [{ id: 'singleton', data: { config: { email: 'x@x.com', factorPrestacional: 1.38 }, otraClave: 'servidor' }, schema_version: 9 }] });
  c.tablas.config[0].data.config.factorPrestacional = 1.5;
  // Este dispositivo cambió SOLO la clave `categoriasComportamiento`.
  const state = copia(BASE);
  state.categoriasComportamiento = { Waffles: 'preparado' };
  const r = await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(r.ok, true);
  const data = c.tablas.config[0].data;
  assert.deepStrictEqual(data.categoriasComportamiento, { Waffles: 'preparado' });
  assert.strictEqual(data.config.factorPrestacional, 1.5, 'no pisó la clave config del otro dispositivo');
  assert.strictEqual(data.otraClave, 'servidor');
  assert.deepStrictEqual(r.config.data, data, 'devuelve la config final para que el caller la adopte');
});

test('schema_version nunca baja: un dispositivo con versión vieja no la retrocede', async () => {
  const c = fakeClient({ config: [{ id: 'singleton', data: {}, schema_version: 11 }] });
  const state = copia(BASE); state.schemaVersion = 10; // distinto de la base (9) → escribe config
  await Sync.push(c, state, undefined, BASE);
  assert.strictEqual(c.tablas.config[0].schema_version, 11);
});

test('devuelve exactamente lo que viajó (enviados y borrados), para parchear la base', async () => {
  const c = fakeClient();
  const state = copia(BASE);
  state.materia[0].costo = 7;
  state.ventas = state.ventas.filter(v => v.id !== 'v2');
  const r = await Sync.push(c, state, undefined, BASE);
  assert.deepStrictEqual(r.enviados.materia.map(x => x.id), ['m1']);
  assert.ok(!r.enviados.ventas);
  assert.deepStrictEqual(r.borrados.ventas, ['v2']);
  assert.strictEqual(r.config, null, 'config sin cambios no viaja');
});

group('pull incremental (pullCambios)');

function filaCon(id, data, updated_at, deleted_at) { return { id, data, updated_at, deleted_at: deleted_at || null }; }

test('pull completo devuelve `hasta` = el updated_at más nuevo (del servidor)', async () => {
  const c = fakeClient({
    materia: [filaCon('m1', { id: 'm1' }, '2026-09-30T10:00:00.000Z')],
    ventas: [filaCon('v1', { id: 'v1' }, '2026-09-30T12:00:00.000Z')]
  });
  const r = await Sync.pull(c);
  assert.strictEqual(r.hasta, '2026-09-30T12:00:00.000Z');
});

test('CRITERIO: solo trae lo cambiado desde `desde` (con margen) — lo viejo no viaja', async () => {
  const c = fakeClient({
    ventas: [
      filaCon('v-vieja', { id: 'v-vieja' }, '2026-09-29T08:00:00.000Z'),
      filaCon('v-nueva', { id: 'v-nueva' }, '2026-09-30T12:00:30.000Z'),
      filaCon('v-margen', { id: 'v-margen' }, '2026-09-30T11:59:30.000Z') // 30 s antes de `desde`: entra por el margen
    ]
  });
  const r = await Sync.pullCambios(c, '2026-09-30T12:00:00.000Z');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.cambios.ventas.map(f => f.id).sort(), ['v-margen', 'v-nueva']);
  assert.strictEqual(r.hasta, '2026-09-30T12:00:30.000Z');
  assert.ok(!r.cambios.materia, 'colecciones sin cambios no aparecen');
});

test('CRITERIO: trae también las filas BORRADAS después de `desde` (así el borrado llega)', async () => {
  const c = fakeClient({ productos: [filaCon('p1', { id: 'p1' }, '2026-09-30T12:05:00.000Z', '2026-09-30T12:05:00.000Z')] });
  const r = await Sync.pullCambios(c, '2026-09-30T12:00:00.000Z');
  assert.strictEqual(r.cambios.productos[0].id, 'p1');
  assert.ok(r.cambios.productos[0].deleted_at);
});

test('sin cambios: `hasta` queda igual a `desde` y config se lee igual', async () => {
  const c = fakeClient({ config: [{ id: 'singleton', data: { config: { email: 'a' } }, schema_version: 10 }] });
  const r = await Sync.pullCambios(c, '2026-09-30T12:00:00.000Z');
  assert.strictEqual(r.hasta, '2026-09-30T12:00:00.000Z');
  assert.deepStrictEqual(r.cambios, {});
  assert.strictEqual(r.config.schema_version, 10);
});

group('migrarDesdeState');

function stateMigracion() {
  return {
    schemaVersion: 9,
    materia: [{ id: 'm1', nombre: 'Harina' }, { id: 'm2', nombre: 'Azúcar' }],
    ventas: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
    gastos: [{ id: 'g1' }],
    config: { email: 'x@x.com' }
  };
}

test('CRITERIO: camino feliz — sube todo, cuenta en Supabase, ok:true sin diferencias', async () => {
  const c = fakeClient();
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.diferencias, []);
  assert.deepStrictEqual(r.conteos.materia, { local: 2, remoto: 2 });
  assert.deepStrictEqual(r.conteos.ventas, { local: 3, remoto: 3 });
  assert.deepStrictEqual(r.conteos.productos, { local: 0, remoto: 0 });
  assert.strictEqual(Object.keys(r.conteos).length, 12);
  // y un pull devuelve lo mismo
  const p = await Sync.pull(c);
  assert.strictEqual(p.state.ventas.length, 3);
  assert.strictEqual(p.state.schemaVersion, 9);
  assert.strictEqual(p.state.config.email, 'x@x.com');
});

test('CRITERIO: si un conteo no coincide → ok:false con la diferencia', async () => {
  const c = fakeClient();
  // un upsert que "pierde" una venta (ej. RLS/trigger que la filtra)
  const fromReal = c.from;
  c.from = function (nombre) {
    const t = fromReal(nombre);
    if (nombre === 'ventas') {
      const upReal = t.upsert;
      t.upsert = filas => upReal(filas.slice(0, filas.length - 1));
    }
    return t;
  };
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diferencias, [{ coleccion: 'ventas', local: 3, remoto: 2 }]);
  assert.deepStrictEqual(r.conteos.materia, { local: 2, remoto: 2 });
});

test('CRITERIO: se niega si Supabase ya tiene filas vivas — y no escribe nada', async () => {
  const c = fakeClient({ gastos: [filaViva('gX', { id: 'gX' })] });
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, false);
  assert.ok(/ya tiene datos/.test(r.error) && /gastos \(1\)/.test(r.error) && /forzar/.test(r.error), r.error);
  assert.ok(!c.calls.some(x => x.op === 'upsert' || x.op === 'update'));
});

test('filas ya borradas (deleted_at) no cuentan como "tiene datos"', async () => {
  const c = fakeClient({ gastos: [{ id: 'gX', data: { id: 'gX' }, deleted_at: '2026-01-01T00:00:00Z' }] });
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('CRITERIO: { forzar: true } la corre igual — y los conteos dicen la verdad', async () => {
  const c = fakeClient({ gastos: [filaViva('gX', { id: 'gX' })] });
  const r = await Sync.migrarDesdeState(c, stateMigracion(), { forzar: true });
  assert.ok(upserteadas(c, 'materia').length === 2);
  // gX ya estaba y no está en el state: 1 local vs 2 remotos — se reporta, no se esconde
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diferencias, [{ coleccion: 'gastos', local: 1, remoto: 2 }]);
});

test('forzar sobre la misma data ya migrada (re-correrla) queda ok', async () => {
  const c = fakeClient();
  await Sync.migrarDesdeState(c, stateMigracion());
  const r = await Sync.migrarDesdeState(c, stateMigracion(), { forzar: true });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('registro sin id o id repetido → cancela antes de escribir nada', async () => {
  const c = fakeClient();
  const s = stateMigracion();
  s.ventas.push({ total: 5 });
  s.materia.push({ id: 'm1', nombre: 'Harina duplicada' });
  const r = await Sync.migrarDesdeState(c, s);
  assert.strictEqual(r.ok, false);
  assert.ok(/ventas\[3\] no tiene id/.test(r.error) && /materia: id "m1" repetido/.test(r.error), r.error);
  assert.strictEqual(c.calls.length, 0);
});

test('si la fila de config no quedó con el schemaVersion → ok:false (el próximo pull re-aplicaría la corrección v9)', async () => {
  const c = fakeClient();
  const fromReal = c.from;
  c.from = function (nombre) {
    const t = fromReal(nombre);
    if (nombre === 'config') t.upsert = () => Promise.resolve({ data: null, error: null }); // "escribe" pero no persiste
    return t;
  };
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diferencias, [{ coleccion: 'config', local: 9, remoto: null }]);
});

test('si la subida falla, ok:false con el error', async () => {
  const c = fakeClient();
  const fromReal = c.from;
  c.from = function (nombre) {
    const t = fromReal(nombre);
    if (nombre === 'ventas') t.upsert = () => Promise.resolve({ data: null, error: { message: 'RLS violada' } });
    return t;
  };
  const r = await Sync.migrarDesdeState(c, stateMigracion());
  assert.strictEqual(r.ok, false);
  assert.ok(/RLS violada/.test(r.error));
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

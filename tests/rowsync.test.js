/**
 * Tests de la lógica pura de la migración append-only (T1, Ronda 3).
 * Correr con: node tests/rowsync.test.js
 *
 * Code.gs (el backend real) no se puede correr ni testear en Node — es
 * Apps Script, y esta ronda prohíbe correr nada contra el Sheet real.
 * Estos tests prueban la lógica que Code.gs porta a mano sobre
 * getRange/setValues reales (ver la nota al principio de js/rowsync.js
 * y la sección de T1 en PROGRESO.md).
 */
const assert = require('assert');
const path = require('path');
const RowSync = require(path.join(__dirname, '..', 'js', 'rowsync.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name);
    console.log('      ' + e.message);
  }
}

console.log('\n== splitCatalogAndAppend / mergeState (round-trip) ==');

function estadoDeEjemplo() {
  return {
    schemaVersion: 10,
    productos: [{ id: 'p1', nombre: 'Waffle' }],
    materia: [{ id: 'm1', nombre: 'Harina' }],
    config: { email: 'a@b.co' },
    ventas: [{ id: 'v1', total: 20000 }, { id: 'v2', total: 15000 }],
    gastos: [{ id: 'g1', monto: 5000 }],
    mermas: [],
    snapshots: [{ id: 's1', tipo: 'conteo' }],
    ajustes: [],
    lotes: [{ id: 'l1', gramosObtenidos: 900 }]
  };
}

test('splitCatalogAndAppend separa catálogo (menú) de colecciones que crecen con la operación', () => {
  const { catalogo, colecciones } = RowSync.splitCatalogAndAppend(estadoDeEjemplo());
  assert.deepStrictEqual(Object.keys(catalogo).sort(), ['config', 'materia', 'productos', 'schemaVersion']);
  assert.deepStrictEqual(Object.keys(colecciones).sort(), ['ajustes', 'gastos', 'lotes', 'mermas', 'snapshots', 'ventas']);
  assert.strictEqual(colecciones.ventas.length, 2);
});

test('splitCatalogAndAppend siempre trae las 6 colecciones, aunque el estado de origen no las tenga (estado viejo)', () => {
  const { colecciones } = RowSync.splitCatalogAndAppend({ productos: [] });
  RowSync.COLECCIONES_APPEND.forEach(nombre => {
    assert.ok(Array.isArray(colecciones[nombre]), nombre + ' debe ser un array, no undefined');
    assert.strictEqual(colecciones[nombre].length, 0);
  });
});

test('CRITERIO: round-trip split -> merge reconstruye el estado ORIGINAL exacto (conteos y totales idénticos)', () => {
  const original = estadoDeEjemplo();
  const { catalogo, colecciones } = RowSync.splitCatalogAndAppend(original);
  const reconstruido = RowSync.mergeState(catalogo, colecciones);
  assert.deepStrictEqual(reconstruido.ventas, original.ventas);
  assert.deepStrictEqual(reconstruido.gastos, original.gastos);
  assert.strictEqual(reconstruido.ventas.reduce((a, v) => a + v.total, 0), 35000);
  assert.strictEqual(reconstruido.productos.length, original.productos.length);
  assert.strictEqual(reconstruido.config.email, original.config.email);
});

console.log('\n== pickNewRecords (idempotencia por id) ==');

test('CRITERIO: agregar una venta produce SOLO esa fila, no reescribe el conjunto', () => {
  const existentes = ['v1', 'v2', 'v3'];
  const entrantes = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }, { id: 'v4' }];
  const nuevos = RowSync.pickNewRecords(existentes, entrantes);
  assert.strictEqual(nuevos.length, 1);
  assert.strictEqual(nuevos[0].id, 'v4');
});

test('CRITERIO: la MISMA venta enviada dos veces deja una sola fila (reintento/doble envío)', () => {
  let existentes = [];
  const venta = { id: 'v1', total: 1000 };
  const primeraVez = RowSync.pickNewRecords(existentes, [venta]);
  assert.strictEqual(primeraVez.length, 1);
  existentes = existentes.concat(primeraVez.map(r => r.id)); // simula que ya se escribió la fila
  const segundaVez = RowSync.pickNewRecords(existentes, [venta]); // el mismo push, reenviado
  assert.strictEqual(segundaVez.length, 0, 'no debe volver a aparecer como "nuevo"');
});

test('pickNewRecords: dos registros con el mismo id en el MISMO lote entrante no duplican (push concurrente/lote raro)', () => {
  const nuevos = RowSync.pickNewRecords([], [{ id: 'v1', total: 100 }, { id: 'v1', total: 100 }]);
  assert.strictEqual(nuevos.length, 1);
});

test('pickNewRecords ignora registros sin id (nunca revienta, nunca los agrega)', () => {
  const nuevos = RowSync.pickNewRecords([], [{ total: 100 }, { id: 'v1', total: 200 }]);
  assert.strictEqual(nuevos.length, 1);
  assert.strictEqual(nuevos[0].id, 'v1');
});

console.log('\n== verifyMigrationCounts (no se toca la celda vieja si algo no cuadra) ==');

test('verifyMigrationCounts: ok:true cuando los conteos coinciden en las 6 colecciones', () => {
  const original = estadoDeEjemplo();
  const r = RowSync.verifyMigrationCounts(original, original);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reporte.ventas.antes, 2);
  assert.strictEqual(r.reporte.ventas.despues, 2);
});

test('CRITERIO: verifyMigrationCounts detecta una colección con menos filas de las que debería y marca ok:false', () => {
  const original = estadoDeEjemplo();
  const migrado = Object.assign({}, original, { ventas: [original.ventas[0]] }); // se "perdió" v2
  const r = RowSync.verifyMigrationCounts(original, migrado);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reporte.ventas.coincide, false);
  assert.strictEqual(r.reporte.gastos.coincide, true); // el resto sigue bien — el reporte es por colección
});

console.log('\n== Escala: el catálogo se mantiene chico aunque la operación crezca ==');

test('CRITERIO DE ESCALA: 500 ventas + 100 gastos + 10 snapshots de conteo — el catálogo queda por debajo de 35.000 caracteres', () => {
  const estado = {
    schemaVersion: 10,
    productos: Array.from({ length: 15 }, (_, i) => ({ id: 'p' + i, nombre: 'Producto ' + i, precio: 20000, categoria: 'Waffles', componentes: [], empaquesUsados: [], empaqueManual: 0 })),
    materia: Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i, nombre: 'Insumo ' + i, cantidad: 1000, costo: 5, minimo: 0 })),
    empaques: Array.from({ length: 18 }, (_, i) => ({ id: 'e' + i, nombre: 'Empaque ' + i, cantidad: 100, costo: 300, minimo: 0 })),
    preparaciones: Array.from({ length: 10 }, (_, i) => ({ id: 'prep' + i, nombre: 'Prep ' + i, modo: 'directo', cantidad: 0, componentes: [] })),
    clientes: [],
    config: { email: 'negocio@crumbly.co', backendUrl: '', backendToken: '', lastSync: null, factorPrestacional: 1.38, comportamientoCategorias: {} },
    // Lo que SÍ crece con la operación — esto es lo que antes vivía en el
    // blob y ahora se migra a filas:
    ventas: Array.from({ length: 500 }, (_, i) => ({
      id: 'v' + i, fecha: '2026-01-01T00:00:00', total: 20000, ganancia: 15000,
      items: [{ productoId: 'p0', nombre: 'Waffle', qty: 1, precio: 20000, costo: 5000, costoAlimento: 4500, costoEmpaque: 500 }],
      consumoReal: { materia: { m0: 100 }, empaques: {}, toppings: {}, preparaciones: {} },
      metodoPago: 'efectivo', comprobante: '', clienteId: null, stockInsuficiente: false
    })),
    gastos: Array.from({ length: 100 }, (_, i) => ({ id: 'g' + i, fecha: '2026-01-01T00:00:00', tipo: 'operativo', categoria: 'Otros', monto: 10000, proveedor: '', descripcion: '', comprobante: '', metodoPago: 'efectivo', montoEfectivo: 0, montoTransferencia: 0 })),
    mermas: [],
    snapshots: Array.from({ length: 10 }, (_, i) => ({
      id: 'snap' + i, fecha: '2026-01-01T00:00:00', tipo: 'conteo', usuarioEmail: 'a@b.co', nota: '',
      lineas: Array.from({ length: 78 }, (_, j) => ({ insumoTipo: 'materia', insumoId: 'm' + j, cantidad: 100, costoUnitario: 5, valor: 500 })),
      noContados: [], bucketsContados: { materia: true, empaques: true, toppings: true, preparaciones: true }, valorTotal: 39000
    })),
    ajustes: [],
    lotes: []
  };

  const { catalogo } = RowSync.splitCatalogAndAppend(estado);
  const tam = JSON.stringify(catalogo).length;
  assert.ok(tam < 35000, 'catálogo debería quedar bajo 35.000 caracteres, dio ' + tam);
  // y la prueba de que el crecimiento se desacopló: las 500 ventas + 100
  // gastos + 10 snapshots NO están en el catálogo en absoluto.
  assert.strictEqual(catalogo.ventas, undefined);
  assert.strictEqual(catalogo.gastos, undefined);
  assert.strictEqual(catalogo.snapshots, undefined);
});

console.log('\n== U1/V0 (Rondas 4-5): filas de lápida (los borrados persisten, EXPLÍCITAMENTE) ==');

test('pickExplicitTombstones: un id declarado EXPLÍCITAMENTE como borrado, y vivo en la hoja → se lapida', () => {
  const r = RowSync.pickExplicitTombstones(['g1', 'g2', 'g3'], ['g2'], []);
  assert.deepStrictEqual(r, ['g2']);
});

test('CRITERIO: doble push con la MISMA lista → NO se lapida dos veces (ya tiene lápida)', () => {
  const r = RowSync.pickExplicitTombstones(['g1', 'g3'], ['g2'], ['g2']);
  assert.deepStrictEqual(r, [], 'g2 ya está lapidado — no vuelve a aparecer como candidato');
});

test('pickExplicitTombstones: lista vacía o sin declarar → no lapida nada', () => {
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(['g1', 'g2', 'g3'], [], []), []);
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(['g1', 'g2'], undefined, []), []);
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(['g1', 'g2'], null, []), []);
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(['g1', 'g2'], 'g1', []), []);
});

test('pickExplicitTombstones: un id declarado que NUNCA existió en la hoja → no hace nada (no inventa una lápida huérfana)', () => {
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(['g1', 'g2'], ['g99'], []), []);
});

test('CRITERIO (V0): dos dispositivos — la tablet, con lastSync viejo, sincroniza un gasto sin haber visto las 3 ventas nuevas del celular → las 3 ventas NO se lapidan (nunca se declararon como borradas)', () => {
  // El celular registró v1, v2, v3 y ya sincronizó — están vivas en la hoja.
  const liveIds = ['v1', 'v2', 'v3'];
  // La tablet nunca las vio (lastSync viejo, sin pull) — su push NO las
  // declara como borradas, porque nunca las borró. idsABorrar solo trae
  // lo que la tablet sí borró (nada, en este escenario).
  const idsABorrarDeLaTablet = { ventas: [] };
  const tomb = RowSync.pickExplicitTombstones(liveIds, idsABorrarDeLaTablet.ventas, []);
  assert.deepStrictEqual(tomb, [], 'ninguna de las 3 ventas se lapida — la ausencia en la declaración de la tablet nunca se interpretó como borrado');
});

test('CRITERIO: borrar 3 de 3 registros deja la colección vacía (ya no hay guarda de "borrado masivo")', () => {
  const liveIds = ['v1', 'v2', 'v3'];
  const tomb = RowSync.pickExplicitTombstones(liveIds, ['v1', 'v2', 'v3'], []);
  assert.deepStrictEqual(tomb.sort(), ['v1', 'v2', 'v3']);
});

test('hydrateRecords: excluye las lápidas y los ids lapidados, conserva el resto', () => {
  const rows = [
    { id: 'g1', monto: 100 },
    { id: 'g2', monto: 200 },
    { id: 'g3', monto: 300 },
    RowSync.makeTombstone('g2', '2026-09-10T00:00:00Z', 'a@b.co')
  ];
  const vivos = RowSync.hydrateRecords(rows);
  assert.deepStrictEqual(vivos.map(r => r.id), ['g1', 'g3']);
});

test('hydrateRecords: deduplica por id (append raro / reintento) quedándose con la primera', () => {
  const rows = [{ id: 'v1', total: 100 }, { id: 'v1', total: 100 }, { id: 'v2', total: 50 }];
  assert.deepStrictEqual(RowSync.hydrateRecords(rows).map(r => r.id), ['v1', 'v2']);
});

test('CRITERIO (ciclo completo): registrar 3, borrar el del medio EXPLÍCITAMENTE, re-hidratar → quedan 2 y el borrado no vuelve', () => {
  // Simula la hoja: 3 filas + el push que declara idsABorrar=[g2]
  let sheetRecords = [{ id: 'g1', m: 1 }, { id: 'g2', m: 2 }, { id: 'g3', m: 3 }];
  const liveIds = sheetRecords.map(r => r.id);
  const tomb = RowSync.pickExplicitTombstones(liveIds, ['g2'], []);
  assert.deepStrictEqual(tomb, ['g2']);
  // el backend agrega la fila de lápida
  tomb.forEach(id => sheetRecords.push(RowSync.makeTombstone(id, '2026-09-10T00:00:00Z', 'a@b.co')));
  // el siguiente pull hidrata
  const trasPull = RowSync.hydrateRecords(sheetRecords);
  assert.deepStrictEqual(trasPull.map(r => r.id), ['g1', 'g3']);
  // y un segundo push con la MISMA lista pendiente (reintento tras una
  // falla, o el cliente todavía no confirmó la limpieza local) no agrega
  // otra lápida
  const liveIds2 = sheetRecords.filter(r => !RowSync.isTombstone(r)).map(r => r.id);
  const tombstonedIds = sheetRecords.filter(r => RowSync.isTombstone(r)).map(r => r.id);
  assert.deepStrictEqual(RowSync.pickExplicitTombstones(liveIds2, ['g2'], tombstonedIds), []);
});

console.log('\n== U2 (Ronda 4): validar la forma de la hoja antes de migrar ==');

test('validarCabeceraAppend: hoja vacía/inexistente (sin cabecera) → ok, se puede crear', () => {
  assert.deepStrictEqual(RowSync.validarCabeceraAppend(null), { ok: true, vacia: true });
  assert.deepStrictEqual(RowSync.validarCabeceraAppend([]), { ok: true, vacia: true });
  assert.deepStrictEqual(RowSync.validarCabeceraAppend(['', '', '', '']), { ok: true, vacia: true });
});

test('validarCabeceraAppend: cabecera exacta del formato nuevo → ok', () => {
  const r = RowSync.validarCabeceraAppend(['id', 'fecha', 'supersedesId', 'json']);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.vacia, false);
});

test('CRITERIO: cabecera del formato VIEJO simulado (mirrorCollections_ pre-T1 de "ventas") → ok:false, identifica lo encontrado', () => {
  const headerViejo = ['id', 'fecha', 'total', 'ganancia', 'stockInsuficiente', 'clienteId'];
  const r = RowSync.validarCabeceraAppend(headerViejo);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.encontrado, headerViejo);
  assert.deepStrictEqual(r.esperado, ['id', 'fecha', 'supersedesId', 'json']);
});

test('validarCabeceraAppend: mismo número de columnas pero un nombre distinto → ok:false', () => {
  const r = RowSync.validarCabeceraAppend(['id', 'fecha', 'anulaId', 'json']);
  assert.strictEqual(r.ok, false);
});

console.log('\n== U3 (Ronda 4): instrumentar la migración (reporte + fase) ==');

test('buildMigrationReport: caso feliz — junta antes/después/coincide con filas escritas, veredicto OK', () => {
  const antes = { ventas: [{ id: 'v1' }, { id: 'v2' }], gastos: [{ id: 'g1' }], mermas: [], snapshots: [], ajustes: [], lotes: [] };
  const nuevas = { ventas: [{ id: 'v1' }, { id: 'v2' }], gastos: [{ id: 'g1' }], mermas: [], snapshots: [], ajustes: [], lotes: [] };
  const agregados = { ventas: 2, gastos: 1, mermas: 0, snapshots: 0, ajustes: 0, lotes: 0 };
  const r = RowSync.buildMigrationReport(antes, nuevas, agregados);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.veredicto, 'OK');
  assert.strictEqual(r.reporte.ventas.filasEscritas, 2);
  assert.strictEqual(r.reporte.ventas.coincide, true);
});

test('CRITERIO: buildMigrationReport — caso abortado (un conteo no coincide) → veredicto ABORTADA', () => {
  const antes = { ventas: [{ id: 'v1' }, { id: 'v2' }], gastos: [], mermas: [], snapshots: [], ajustes: [], lotes: [] };
  const nuevas = { ventas: [{ id: 'v1' }], gastos: [], mermas: [], snapshots: [], ajustes: [], lotes: [] }; // se "perdió" v2
  const r = RowSync.buildMigrationReport(antes, nuevas, { ventas: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.veredicto, 'ABORTADA');
  assert.strictEqual(r.reporte.ventas.coincide, false);
});

test('faseMigracion: catálogo crudo con transacciones embebidas → "pre"', () => {
  assert.strictEqual(RowSync.faseMigracion({ productos: [], ventas: [{ id: 'v1' }] }), 'pre');
});

test('faseMigracion: catálogo crudo sin ninguna colección append-only → "post"', () => {
  assert.strictEqual(RowSync.faseMigracion({ productos: [{ id: 'p1' }], config: {} }), 'post');
});

test('faseMigracion: colecciones append-only presentes pero VACÍAS → "post" (ya migrado, sin filas que perder)', () => {
  assert.strictEqual(RowSync.faseMigracion({ ventas: [], gastos: [], mermas: [], snapshots: [], ajustes: [], lotes: [] }), 'post');
});

console.log('\n== U4 (Ronda 4): C2 — mergeCatalogs (fusión de catálogo por registro) ==');

function catalogoBase() {
  return {
    schemaVersion: 10,
    config: { email: 'negocio@crumbly.co' },
    materia: [
      { id: 'm1', nombre: 'Harina', costo: 5, cantidad: 1000 },
      { id: 'm2', nombre: 'Azúcar', costo: 4, cantidad: 500 }
    ],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 12000 }]
  };
}

test('CRITERIO: dos clientes editando insumos DISTINTOS → los dos cambios sobreviven', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.materia[0] = Object.assign({}, mine.materia[0], { costo: 6 }); // yo edito m1
  const remote = JSON.parse(JSON.stringify(base));
  remote.materia[1] = Object.assign({}, remote.materia[1], { costo: 4.5 }); // otro dispositivo edita m2

  const { merged, conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 0, 'no debería haber ningún conflicto — son insumos distintos');
  const porId = Object.fromEntries(merged.materia.map(m => [m.id, m]));
  assert.strictEqual(porId.m1.costo, 6, 'mi edición de m1 sobrevive');
  assert.strictEqual(porId.m2.costo, 4.5, 'la edición remota de m2 también sobrevive');
});

test('CRITERIO: dos clientes editando el MISMO insumo a valores distintos → se detecta, nada se pierde, el usuario decide', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.materia[0] = Object.assign({}, mine.materia[0], { costo: 6 });
  const remote = JSON.parse(JSON.stringify(base));
  remote.materia[0] = Object.assign({}, remote.materia[0], { costo: 999 }); // el mismo m1, otro valor

  const { merged, conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].coleccion, 'materia');
  assert.strictEqual(conflicts[0].id, 'm1');
  assert.strictEqual(conflicts[0].mio.costo, 6);
  assert.strictEqual(conflicts[0].remoto.costo, 999);
  // nada se pierde en silencio: mi versión queda activa en el merge hasta que se decida
  const m1Fusionado = merged.materia.find(m => m.id === 'm1');
  assert.strictEqual(m1Fusionado.costo, 6);
});

test('el mismo cambio en los dos lados (no un conflicto real) no se reporta como conflicto', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.materia[0] = Object.assign({}, mine.materia[0], { costo: 6 });
  const remote = JSON.parse(JSON.stringify(base));
  remote.materia[0] = Object.assign({}, remote.materia[0], { costo: 6 }); // idéntico

  const { conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 0);
});

test('un insumo nuevo agregado SOLO en el remoto aparece en el merge', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));
  remote.materia.push({ id: 'm3', nombre: 'Mantequilla', costo: 10, cantidad: 200 });

  const { merged, conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 0);
  assert.ok(merged.materia.some(m => m.id === 'm3'));
});

test('un insumo que yo borré, sin que el remoto lo tocara, queda borrado en el merge', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.materia = mine.materia.filter(m => m.id !== 'm2');
  const remote = JSON.parse(JSON.stringify(base));

  const { merged, conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 0);
  assert.ok(!merged.materia.some(m => m.id === 'm2'));
});

test('yo borré un insumo pero el remoto lo editó → conflicto (no se borra en silencio lo que otro acaba de cambiar)', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.materia = mine.materia.filter(m => m.id !== 'm2');
  const remote = JSON.parse(JSON.stringify(base));
  remote.materia[1] = Object.assign({}, remote.materia[1], { costo: 4.5 });

  const { conflicts } = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].id, 'm2');
  assert.strictEqual(conflicts[0].mio, null);
  assert.strictEqual(conflicts[0].remoto.costo, 4.5);
});

test('config (no es una lista con id): si el remoto cambió, gana el remoto; si no, gana lo mío', () => {
  const base = catalogoBase();
  const mine = JSON.parse(JSON.stringify(base));
  mine.config.factorPrestacional = 1.4; // yo cambié algo que el remoto no tocó
  const remote = JSON.parse(JSON.stringify(base));
  remote.config.email = 'nuevo@crumbly.co'; // el remoto cambió otra cosa

  const r1 = RowSync.mergeCatalogs(base, mine, remote);
  assert.strictEqual(r1.merged.config.email, 'nuevo@crumbly.co', 'el remoto cambió config -> gana el remoto');

  const remoteSinCambios = JSON.parse(JSON.stringify(base));
  const r2 = RowSync.mergeCatalogs(base, mine, remoteSinCambios);
  assert.strictEqual(r2.merged.config.factorPrestacional, 1.4, 'el remoto no tocó config -> gana lo mío');
});

console.log('\n== Resumen ==');
console.log(`${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed > 0 ? 1 : 0);

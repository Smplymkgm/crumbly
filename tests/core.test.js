/**
 * Tests de lógica pura (js/core.js). Correr con: node tests/core.test.js
 * Sin dependencias externas — assert nativo de Node.
 */
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'js', 'core.js'));

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

console.log('\n== Períodos (semana empieza LUNES) ==');

test('getDateStart("semana") de un miércoles retrocede al lunes de esa semana', () => {
  // 2026-08-12 es miércoles
  const start = C.getDateStart('semana', '2026-08-12T15:30:00');
  assert.strictEqual(start.getFullYear(), 2026);
  assert.strictEqual(start.getMonth(), 7); // agosto = 7
  assert.strictEqual(start.getDate(), 10); // lunes 10 de agosto de 2026
  assert.strictEqual(start.getHours(), 0);
});

test('getDateStart("semana") de un lunes se queda en el mismo lunes', () => {
  const start = C.getDateStart('semana', '2026-08-10T09:00:00');
  assert.strictEqual(start.getDate(), 10);
});

test('getDateStart("semana") de un domingo retrocede al lunes anterior (no al domingo)', () => {
  // 2026-08-16 es domingo -> debe caer en el lunes 10, no en el mismo domingo
  const start = C.getDateStart('semana', '2026-08-16T09:00:00');
  assert.strictEqual(start.getDate(), 10);
});

test('getDateStart("dia") pone la hora en 00:00', () => {
  const start = C.getDateStart('dia', '2026-08-12T15:30:00');
  assert.strictEqual(start.getHours(), 0);
  assert.strictEqual(start.getDate(), 12);
});

test('getDateStart("mes") va al día 1', () => {
  const start = C.getDateStart('mes', '2026-08-12T15:30:00');
  assert.strictEqual(start.getDate(), 1);
});

console.log('\n== Formato de moneda es-CO ==');

test('formatCOP agrega separador de miles', () => {
  assert.strictEqual(C.formatCOP(22000), '$22.000');
});

test('formatCOP redondea decimales', () => {
  assert.strictEqual(C.formatCOP(9230.35), '$9.230');
});

test('formatCOP maneja negativos', () => {
  assert.strictEqual(C.formatCOP(-500), '-$500');
});

console.log('\n== escapeHtml ==');

test('escapeHtml neutraliza tags', () => {
  assert.strictEqual(C.escapeHtml('<b>hola</b>'), '&lt;b&gt;hola&lt;/b&gt;');
});

test('escapeHtml maneja null/undefined sin lanzar', () => {
  assert.strictEqual(C.escapeHtml(null), '');
  assert.strictEqual(C.escapeHtml(undefined), '');
});

console.log('\n== Costeo de producto (P0-2: siempre en vivo) ==');

function stateBase() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 1000, costo: 5.8, minimo: 100 }],
    empaques: [{ id: 'e1', nombre: 'Caja', unidad: 'unidad', cantidad: 50, costo: 2550, minimo: 10 }],
    toppings: [{ id: 't1', nombre: 'Chocolate', cantidad: 20, costo: 300, precio: 1000, minimo: 5 }],
    productos: [{
      id: 'p1', nombre: 'Waffle', precio: 22000,
      ingredientes: [{ materiaId: 'm1', gramos: 150 }],
      empaquesUsados: [{ empaqueId: 'e1', cantidad: 1 }],
      empaqueManual: 0
    }],
    ventas: []
  });
}

test('150 g de un insumo a $20/g cuesta $3.000 (ejemplo del handoff)', () => {
  const s = C.migrateState({
    materia: [{ id: 'm1', nombre: 'X', cantidad: 1000, costo: 20, minimo: 0 }],
    productos: [{ id: 'p1', nombre: 'Y', precio: 1, ingredientes: [{ materiaId: 'm1', gramos: 150 }] }]
  });
  const costo = C.getCostoProducto(s.productos[0], s);
  assert.strictEqual(costo, 3000);
});

test('getCostoProducto suma materia + empaque + empaque manual', () => {
  const s = stateBase();
  s.productos[0].empaqueManual = 100;
  const costo = C.getCostoProducto(s.productos[0], s);
  // 150g * 5.8 = 870 ; 1 * 2550 = 2550 ; + 100 manual
  assert.strictEqual(costo, 870 + 2550 + 100);
});

test('getCostoProducto cambia al vuelo si cambia el costo del insumo (no queda congelado)', () => {
  const s = stateBase();
  const costoAntes = C.getCostoProducto(s.productos[0], s);
  s.materia[0].costo = 999; // simula una compra que actualizó el precio
  const costoDespues = C.getCostoProducto(s.productos[0], s);
  assert.notStrictEqual(costoAntes, costoDespues);
  assert.strictEqual(costoDespues, 150 * 999 + 2550);
});

console.log('\n== Validación de stock antes de vender (P0-3) ==');

test('sin faltantes cuando el stock alcanza', () => {
  const s = stateBase(); // 1000g harina, receta usa 150g x qty
  const consumo = C.computeSaleConsumption(
    [{ productoId: 'p1', qty: 2, toppings: [] }], [], s
  );
  const faltantes = C.checkStockShortage(consumo, s);
  assert.strictEqual(faltantes.length, 0);
});

test('detecta faltante exacto de materia prima', () => {
  const s = stateBase();
  s.materia[0].cantidad = 80; // hay 80g, la receta pide 150g
  const consumo = C.computeSaleConsumption(
    [{ productoId: 'p1', qty: 1, toppings: [] }], [], s
  );
  const faltantes = C.checkStockShortage(consumo, s);
  assert.strictEqual(faltantes.length, 1);
  assert.strictEqual(faltantes[0].tipo, 'materia');
  assert.strictEqual(faltantes[0].disponible, 80);
  assert.strictEqual(faltantes[0].necesario, 150);
  assert.strictEqual(faltantes[0].faltante, 70);
});

test('topping fantasma con cantidad de plato 0 no genera consumo (P1-5)', () => {
  const s = stateBase();
  const consumo = C.computeSaleConsumption(
    [{ productoId: 'p1', qty: 0, toppings: [{ toppingId: 't1', qty: 1 }] }], [], s
  );
  assert.strictEqual(consumo.toppings.t1, undefined);
});

test('topping suelto sí valida contra stock', () => {
  const s = stateBase();
  s.toppings[0].cantidad = 2;
  const consumo = C.computeSaleConsumption([], [{ toppingId: 't1', qty: 5 }], s);
  const faltantes = C.checkStockShortage(consumo, s);
  assert.strictEqual(faltantes.length, 1);
  assert.strictEqual(faltantes[0].tipo, 'toppings');
  assert.strictEqual(faltantes[0].faltante, 3);
});

console.log('\n== Necesidades de inventario (P1-1: materia + empaque + toppings) ==');

test('calcInventoryNeeds incluye los tres tipos de insumo, no solo materia', () => {
  const s = stateBase();
  const now = new Date('2026-08-12T12:00:00');
  s.ventas.push({
    id: 'v1', fecha: '2026-08-11T12:00:00',
    items: [
      { productoId: 'p1', nombre: 'Waffle', qty: 3, precio: 22000, costo: 100 },
      { toppingId: 't1', nombre: 'Chocolate (topping)', qty: 4, precio: 1000, costo: 300 }
    ],
    total: 70000, ganancia: 1000
  });
  const needs = C.calcInventoryNeeds(s, 7, now);
  const tipos = needs.map(n => n.tipo).sort();
  assert.deepStrictEqual(tipos, ['empaques', 'materia', 'toppings']);
  const toppingNeed = needs.find(n => n.tipo === 'toppings' && n.id === 't1');
  assert.strictEqual(toppingNeed.consumo, 4); // antes: 0, porque no se medía (P1-1)
});

test('ventana móvil de 7 días no depende de la semana calendario (P1-2)', () => {
  const s = stateBase();
  // Lunes 2026-08-10 a las 08:00 — con la semana calendario esto daría
  // consumo=0 porque la "semana" recién empieza. Con ventana móvil de 7 días
  // sí debe capturar ventas del jueves anterior.
  s.ventas.push({
    id: 'v1', fecha: '2026-08-06T12:00:00', // jueves anterior
    items: [{ productoId: 'p1', nombre: 'Waffle', qty: 2, precio: 22000, costo: 100 }],
    total: 44000, ganancia: 1000
  });
  const lunesTemprano = new Date('2026-08-10T08:00:00');
  const needs = C.calcInventoryNeeds(s, 7, lunesTemprano);
  const harinaNeed = needs.find(n => n.tipo === 'materia' && n.id === 'm1');
  assert.ok(harinaNeed.consumo > 0, 'el consumo no debería ser cero un lunes por la mañana');
});

console.log('\n== Migración de esquema (P1-3) ==');

test('migrateState no lanza con estado vacío/null', () => {
  const s = C.migrateState(null);
  assert.deepStrictEqual(s.materia, []);
  assert.deepStrictEqual(s.ventas, []);
  assert.strictEqual(s.schemaVersion, C.SCHEMA_VERSION);
});

test('migrateState no lanza cuando falta "productos" completo (estado parcial/corrupto)', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'X', cantidad: 1, costo: 1 }] });
  assert.deepStrictEqual(s.productos, []);
  assert.deepStrictEqual(s.ventas, []);
  assert.strictEqual(s.materia.length, 1);
});

test('migrateState preserva datos existentes (no destructivo)', () => {
  const raw = {
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 500, costo: 5.8 }],
    ventas: [{ id: 'v1', fecha: '2026-01-01T00:00:00', items: [], total: 100, ganancia: 10 }]
  };
  const s = C.migrateState(raw);
  assert.strictEqual(s.materia[0].nombre, 'Harina');
  assert.strictEqual(s.ventas[0].total, 100);
});

test('migrateState elimina productos[].costo persistido (ya no es snapshot legítimo, P0-2)', () => {
  const s = C.migrateState({
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 22000, costo: 99999, ingredientes: [] }]
  });
  assert.strictEqual(s.productos[0].costo, undefined);
});

test('migrateState agrega empaquesUsados/empaqueManual a productos viejos sin romperlos', () => {
  const s = C.migrateState({
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 22000, ingredientes: [{ materiaId: 'm1', gramos: 10 }], empaque: 500 }]
  });
  assert.deepStrictEqual(s.productos[0].empaquesUsados, []);
  assert.strictEqual(s.productos[0].empaqueManual, 500);
});

console.log('\n== Aplicar / revertir venta (P0-1, P0-3) ==');

test('applyVenta descuenta stock y devuelve la venta con consumoReal', () => {
  const s = stateBase();
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 2, toppings: [] }], [], {});
  assert.strictEqual(s.materia[0].cantidad, 1000 - 150 * 2);
  assert.strictEqual(s.empaques[0].cantidad, 50 - 1 * 2);
  assert.strictEqual(venta.consumoReal.materia.m1, 300);
  assert.strictEqual(venta.consumoReal.empaques.e1, 2);
  assert.strictEqual(s.ventas.length, 1);
});

test('applyVenta con carrito vacío devuelve null y no agrega nada', () => {
  const s = stateBase();
  const venta = C.applyVenta(s, [{ productoId: '', qty: 0, toppings: [] }], [], {});
  assert.strictEqual(venta, null);
  assert.strictEqual(s.ventas.length, 0);
});

test('revertVenta con consumoReal devuelve exactamente lo descontado (caso normal)', () => {
  const s = stateBase();
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  C.revertVenta(s, venta);
  assert.strictEqual(s.materia[0].cantidad, 1000); // vuelve exacto al valor original
  assert.strictEqual(s.empaques[0].cantidad, 50);
  assert.strictEqual(s.ventas.length, 0);
});

test('BUG REAL encontrado en pruebas de navegador: revertir una venta con stock insuficiente NO debe sobrepasar el stock original', () => {
  // Stock insuficiente: solo hay 100g de harina, la receta pide 150g.
  const s = stateBase();
  s.materia[0].cantidad = 100;
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], { stockInsuficiente: true });
  assert.strictEqual(s.materia[0].cantidad, 0); // clampeado, no negativo
  assert.strictEqual(venta.consumoReal.materia.m1, 100); // consumoReal = lo que REALMENTE se quitó, no los 150 teóricos
  C.revertVenta(s, venta);
  // Con la versión rota (revertir sumando la receta completa) esto daría 150.
  assert.strictEqual(s.materia[0].cantidad, 100, 'la reversión no debe exceder el stock que había antes de la venta');
});

test('revertVenta con toppings clampeados también revierte el monto real, no el pedido', () => {
  const s = stateBase();
  s.toppings[0].cantidad = 2; // hay 2, se piden 5 sueltos
  const venta = C.applyVenta(s, [], [{ toppingId: 't1', qty: 5 }], { stockInsuficiente: true });
  assert.strictEqual(s.toppings[0].cantidad, 0);
  assert.strictEqual(venta.consumoReal.toppings.t1, 2);
  C.revertVenta(s, venta);
  assert.strictEqual(s.toppings[0].cantidad, 2); // no 5
});

test('revertVenta sin consumoReal (venta legada) cae de vuelta a la receta actual', () => {
  const s = stateBase();
  const ventaVieja = {
    id: 'vOld', fecha: '2026-01-01T00:00:00',
    items: [{ productoId: 'p1', nombre: 'Waffle', qty: 1, precio: 22000, costo: 100 }],
    total: 22000, ganancia: 100
    // sin consumoReal — simula una venta guardada antes de este cambio
  };
  s.ventas.push(ventaVieja);
  s.materia[0].cantidad = 500;
  C.revertVenta(s, ventaVieja);
  assert.strictEqual(s.materia[0].cantidad, 650); // 500 + 150 (receta actual)
  assert.strictEqual(s.ventas.length, 0);
});

console.log('\n== Dependencias al eliminar insumos (P1-4) ==');

test('findProductosUsandoMateria detecta productos que referencian el insumo', () => {
  const s = stateBase();
  const usados = C.findProductosUsandoMateria(s, 'm1');
  assert.strictEqual(usados.length, 1);
  assert.strictEqual(usados[0].id, 'p1');
});

test('findProductosUsandoMateria no encuentra nada para un insumo sin uso', () => {
  const s = stateBase();
  const usados = C.findProductosUsandoMateria(s, 'no-existe');
  assert.strictEqual(usados.length, 0);
});

test('findProductosUsandoEmpaque detecta productos que referencian el empaque', () => {
  const s = stateBase();
  const usados = C.findProductosUsandoEmpaque(s, 'e1');
  assert.strictEqual(usados.length, 1);
});

console.log('\n== Costo promedio ponderado (compras a distintos proveedores) ==');

test('1000g a $10/g + 2000g a $12/g = $11,333/g (ejemplo del handoff)', () => {
  const nuevo = C.costoPromedioPonderado(10, 1000, 12, 2000);
  assert.ok(Math.abs(nuevo - 11.3333) < 0.001);
});

test('comprar con stock en 0 usa directamente el costo de la compra', () => {
  const nuevo = C.costoPromedioPonderado(999, 0, 12, 500);
  assert.strictEqual(nuevo, 12);
});

console.log('\n== Gastos: clasificación por tipo (HANDOFF §9.1) ==');

function stateConGastos() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 1000, costo: 10, minimo: 100 }],
    empaques: [],
    toppings: [],
    productos: [],
    ventas: [],
    gastos: []
  });
}

test('registrarGasto tipo inventario aumenta stock y actualiza costo (promedio ponderado)', () => {
  const s = stateConGastos();
  const gasto = C.registrarGasto(s, {
    tipo: 'inventario', categoria: 'Materia prima', descripcion: 'Compra harina',
    monto: 24000, proveedor: 'Supermercado A',
    insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000
  });
  // costo compra = 24000/2000 = 12/g ; ponderado con 1000g@10 -> 11.333
  assert.strictEqual(s.materia[0].cantidad, 3000);
  assert.ok(Math.abs(s.materia[0].costo - 11.3333) < 0.001);
  assert.strictEqual(gasto.actualizoCosto, true);
  assert.strictEqual(gasto.costoAntes, 10);
  assert.strictEqual(gasto.cantidadAntes, 1000);
});

test('registrarGasto tipo operativo NO toca ningún insumo', () => {
  const s = stateConGastos();
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 50000, descripcion: 'Instagram Ads' });
  assert.strictEqual(s.materia[0].cantidad, 1000);
  assert.strictEqual(s.materia[0].costo, 10);
  assert.strictEqual(s.gastos.length, 1);
});

test('registrarGasto tipo capex exige vidaUtilMeses', () => {
  const s = stateConGastos();
  assert.throws(() => {
    C.registrarGasto(s, { tipo: 'capex', categoria: 'Equipos de cocina', monto: 1200000, descripcion: 'Waflera' });
  }, /vida útil/);
});

test('registrarGasto tipo capex guarda vidaUtilMeses y no toca insumos', () => {
  const s = stateConGastos();
  const g = C.registrarGasto(s, { tipo: 'capex', categoria: 'Equipos de cocina', monto: 1200000, descripcion: 'Waflera', vidaUtilMeses: 36 });
  assert.strictEqual(g.vidaUtilMeses, 36);
  assert.strictEqual(s.materia[0].cantidad, 1000);
});

test('registrarGasto rechaza monto <= 0', () => {
  const s = stateConGastos();
  assert.throws(() => C.registrarGasto(s, { tipo: 'operativo', categoria: 'Otros', monto: 0 }));
});

console.log('\n== eliminarGasto revierte el snapshot exacto (mismo patrón que revertVenta) ==');

test('eliminarGasto de una compra de inventario devuelve el insumo a su costo/cantidad previos', () => {
  const s = stateConGastos();
  const g1 = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 24000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 });
  // una segunda compra encima, para simular que ya no se puede "adivinar" el estado antes de g1 sin el snapshot
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 50000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  C.eliminarGasto(s, g1.id);
  // el snapshot de g1 se tomó ANTES de que existiera, así que revertir g1
  // vuelve al estado previo a AMBAS compras solamente si se elimina en orden;
  // aquí solo verificamos que usa el snapshot guardado, no un recálculo:
  assert.strictEqual(s.materia[0].costo, 10);
  assert.strictEqual(s.materia[0].cantidad, 1000);
  assert.strictEqual(s.gastos.length, 1);
});

test('eliminarGasto de un gasto operativo simplemente lo quita de la lista', () => {
  const s = stateConGastos();
  const g = C.registrarGasto(s, { tipo: 'operativo', categoria: 'Arriendo', monto: 800000 });
  C.eliminarGasto(s, g.id);
  assert.strictEqual(s.gastos.length, 0);
});

console.log('\n== Depreciación de capex ==');

test('depreciación mensual = monto / vidaUtilMeses (ejemplo del handoff: waflera $1.200.000 a 36 meses)', () => {
  const s = stateConGastos();
  C.registrarGasto(s, {
    tipo: 'capex', categoria: 'Equipos de cocina', monto: 1200000, vidaUtilMeses: 36,
    fecha: '2026-01-01T00:00:00'
  });
  const dep = C.getDepreciacionMensualTotal(s, new Date('2026-02-01T00:00:00'));
  assert.ok(Math.abs(dep - 33333.33) < 1);
});

test('un activo ya totalmente depreciado deja de aportar depreciación', () => {
  const s = stateConGastos();
  C.registrarGasto(s, { tipo: 'capex', categoria: 'Tecnología', monto: 100000, vidaUtilMeses: 2, fecha: '2020-01-01T00:00:00' });
  const dep = C.getDepreciacionMensualTotal(s, new Date('2026-01-01T00:00:00'));
  assert.strictEqual(dep, 0);
});

test('getDepreciacionPeriodo prorratea la depreciación mensual al período', () => {
  const s = stateConGastos();
  C.registrarGasto(s, { tipo: 'capex', categoria: 'Equipos de cocina', monto: 300000, vidaUtilMeses: 1, fecha: '2026-01-01T00:00:00' });
  // depreciación mensual total = 300000
  const mes = C.getDepreciacionPeriodo(s, 'mes', new Date('2026-01-15T00:00:00'));
  const anio = C.getDepreciacionPeriodo(s, 'anio', new Date('2026-01-15T00:00:00'));
  assert.ok(Math.abs(mes - 300000) < 1);
  assert.ok(Math.abs(anio - 300000 * 12) < 1);
});

console.log('\n== Cascada de utilidad (HANDOFF §9.1, §9.5) ==');

test('una compra de inventario NO resta de la utilidad bruta ni neta (ya está en el costo de ventas)', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, ingredientes: [{ materiaId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  // ingresos 20000, costo = 100*10=1000, utilidad bruta = 19000
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 24000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 });
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.utilidadBruta, 19000);
  assert.strictEqual(c.utilidadNeta, 19000); // sin gastos operativos ni depreciación, la compra no restó nada
});

test('un gasto operativo SÍ resta de la utilidad neta pero no de la bruta', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, ingredientes: [{ materiaId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000 });
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.utilidadBruta, 19000);
  assert.strictEqual(c.utilidadNeta, 19000 - 5000);
});

test('flujo de caja SÍ resta compras de inventario, operativos y capex', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, ingredientes: [{ materiaId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 24000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000 });
  C.registrarGasto(s, { tipo: 'capex', categoria: 'Mobiliario', monto: 100000, vidaUtilMeses: 12 });
  const c = C.getCascadaUtilidad(s, 'mes');
  // ingresos 20000 - compras 24000 - operativos 5000 - capex 100000
  assert.strictEqual(c.flujoCaja, 20000 - 24000 - 5000 - 100000);
});

test('gastosOperativosPorCategoria agrupa correctamente para el desglose de reportes', () => {
  const s = stateConGastos();
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000 });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 3000 });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Arriendo', monto: 800000 });
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.gastosOperativosPorCategoria['Publicidad'], 8000);
  assert.strictEqual(c.gastosOperativosPorCategoria['Arriendo'], 800000);
});

console.log('\n== Resumen ==');
console.log(`${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed > 0 ? 1 : 0);

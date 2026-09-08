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

console.log('\n== A2: faltante — vender sin stock ya no pierde el déficit ==');

test('vender sin stock suficiente acumula el déficit en faltante en vez de perderlo', () => {
  const s = stateBase(); // receta: 150g de m1 por unidad
  s.materia[0].cantidad = 50;
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 2, toppings: [] }], [], { stockInsuficiente: true }); // pide 300g
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].faltante, 250);
});

test('una compra posterior salda primero el faltante; el promedio ponderado se calcula sobre la cantidad neta, no sobre lo comprado', () => {
  const s = stateBase();
  s.materia[0].cantidad = 50;
  s.materia[0].costo = 10;
  C.applyVenta(s, [{ productoId: 'p1', qty: 2, toppings: [] }], [], { stockInsuficiente: true }); // faltante 250
  assert.strictEqual(s.materia[0].faltante, 250);
  const gasto = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 12000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  // neto para stock/promedio = 1000 - 250 = 750, a $12/g ; stock previo era 0 -> el promedio pondera con cantidadActual 0, así que da 12 directo
  assert.strictEqual(s.materia[0].cantidad, 750);
  assert.strictEqual(s.materia[0].faltante, 0);
  assert.strictEqual(s.materia[0].costo, 12);
  assert.strictEqual(gasto.faltanteAntes, 250);
});

test('una compra que no alcanza a cubrir todo el faltante no suma nada a cantidad ni toca el costo', () => {
  const s = stateBase();
  s.materia[0].cantidad = 0;
  s.materia[0].faltante = 250;
  s.materia[0].costo = 10;
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 1000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 100 });
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].faltante, 150);
  assert.strictEqual(s.materia[0].costo, 10); // sin compra neta, el costo no se toca
});

test('revertVenta deshace también el faltante que esa venta generó', () => {
  const s = stateBase();
  s.materia[0].cantidad = 50;
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 2, toppings: [] }], [], { stockInsuficiente: true });
  assert.strictEqual(s.materia[0].faltante, 250);
  C.revertVenta(s, venta);
  assert.strictEqual(s.materia[0].cantidad, 50);
  assert.strictEqual(s.materia[0].faltante, 0);
});

test('eliminarGasto restaura también el faltante al snapshot previo a la compra', () => {
  const s = stateBase();
  s.materia[0].cantidad = 0;
  s.materia[0].faltante = 250;
  s.materia[0].costo = 10;
  const g = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 12000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  assert.strictEqual(s.materia[0].faltante, 0);
  C.eliminarGasto(s, g.id);
  assert.strictEqual(s.materia[0].faltante, 250);
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].costo, 10);
});

test('migrateState agrega conteoEnProgreso:{} a un estado viejo', () => {
  const s = C.migrateState({ materia: [] });
  assert.deepStrictEqual(s.conteoEnProgreso, {});
});

test('migrateState conserva un conteoEnProgreso ya existente', () => {
  const s = C.migrateState({ conteoEnProgreso: { 'materia:m1': { cantidad: 900, motivo: 'Robo' } } });
  assert.deepStrictEqual(s.conteoEnProgreso, { 'materia:m1': { cantidad: 900, motivo: 'Robo' } });
});

test('migrateState inicializa faltante:0 en insumos viejos que no lo tenían', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'Harina', cantidad: 100, costo: 5, minimo: 10 }] });
  assert.strictEqual(s.materia[0].faltante, 0);
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

test('registrarGasto guarda comprobante (bug real: se perdía, applyVenta sí lo guardaba)', () => {
  const s = stateConGastos();
  const gasto = C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000, comprobante: 'https://drive.google.com/file/d/abc/view' });
  assert.strictEqual(gasto.comprobante, 'https://drive.google.com/file/d/abc/view');
  assert.strictEqual(s.gastos[0].comprobante, 'https://drive.google.com/file/d/abc/view');
});

test('registrarGasto: metodoPago por defecto es efectivo, sin montos divididos', () => {
  const s = stateConGastos();
  const gasto = C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000 });
  assert.strictEqual(gasto.metodoPago, 'efectivo');
  assert.strictEqual(gasto.montoEfectivo, 0);
  assert.strictEqual(gasto.montoTransferencia, 0);
});

test('registrarGasto: metodoPago dividido guarda ambos montos', () => {
  const s = stateConGastos();
  const gasto = C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000, metodoPago: 'dividido', montoEfectivo: 3000, montoTransferencia: 2000 });
  assert.strictEqual(gasto.metodoPago, 'dividido');
  assert.strictEqual(gasto.montoEfectivo, 3000);
  assert.strictEqual(gasto.montoTransferencia, 2000);
});

test('registrarGasto: montoEfectivo/montoTransferencia se ignoran si metodoPago no es dividido', () => {
  const s = stateConGastos();
  const gasto = C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000, metodoPago: 'transferencia', montoEfectivo: 3000, montoTransferencia: 2000 });
  assert.strictEqual(gasto.metodoPago, 'transferencia');
  assert.strictEqual(gasto.montoEfectivo, 0);
  assert.strictEqual(gasto.montoTransferencia, 0);
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

console.log('\n== A1: recargo +8% de margenVariable retirado de la valuación ==');

function stateConGastosVolatil() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 0, costo: 0, minimo: 100, margenVariable: true }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 20000, empaqueManual: 0, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 50 }], empaquesUsados: [] }]
  });
}

test('registrarGasto ya NO aplica +8%: doce compras seguidas a $10/g dejan el costo en $10,00/g exactos (antes daba $10,80)', () => {
  const s = stateConGastosVolatil();
  for (let i = 0; i < 12; i++) {
    C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 1000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 100 });
  }
  assert.strictEqual(s.materia[0].costo, 10);
  assert.strictEqual(s.gastos[0].margenVariabilidadAplicado, undefined);
});

test('getCostoConVolatilidad muestra el costo con insumos volátiles subidos pct, sin tocar la valuación real', () => {
  const s = stateConGastosVolatil();
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 1000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 100 });
  assert.strictEqual(s.materia[0].costo, 10);
  const costoConAlza = C.getCostoConVolatilidad(s, 'p1', 0.08);
  assert.ok(Math.abs(costoConAlza - 50 * 10.8) < 0.001);
  assert.strictEqual(s.materia[0].costo, 10); // no muta la valuación real
});

console.log('\n== Migración v9: recalcular valuación contaminada por el +8% ==');

test('migrateState v9 recalcula el costo desde el historial de compras (dos compras de 100g a $10/g contaminadas a $10.8)', () => {
  const raw = {
    schemaVersion: 8,
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 200, costo: 10.8, minimo: 100, margenVariable: true }],
    gastos: [
      { id: 'g1', tipo: 'inventario', insumoTipo: 'materia', insumoId: 'm1', monto: 1000, cantidad: 100, costoAntes: 0, cantidadAntes: 0, margenVariabilidadAplicado: 0.08, fecha: '2026-01-01T00:00:00' },
      { id: 'g2', tipo: 'inventario', insumoTipo: 'materia', insumoId: 'm1', monto: 1000, cantidad: 100, costoAntes: 10.8, cantidadAntes: 100, margenVariabilidadAplicado: 0.08, fecha: '2026-01-02T00:00:00' }
    ]
  };
  const s = C.migrateState(raw);
  assert.strictEqual(s.materia[0].costo, 10);
  assert.strictEqual(s.ajustes.length, 1);
  assert.strictEqual(s.ajustes[0].motivo, 'corrección de valuación v9');
  assert.strictEqual(s.ajustes[0].nota, 'recalculado desde historial de compras');
});

test('migrateState v9 deflacta cuando el historial es insuficiente (gasto sin costoAntes/cantidadAntes)', () => {
  const raw = {
    schemaVersion: 8,
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 100, costo: 10.8, minimo: 100, margenVariable: true }],
    gastos: [
      { id: 'g1', tipo: 'inventario', insumoTipo: 'materia', insumoId: 'm1', monto: 1000, cantidad: 100, margenVariabilidadAplicado: 0.08, fecha: '2026-01-01T00:00:00' }
    ]
  };
  const s = C.migrateState(raw);
  assert.ok(Math.abs(s.materia[0].costo - 10) < 0.001);
  assert.strictEqual(s.ajustes[0].nota, 'historial insuficiente, deflactado por factor efectivo');
});

test('migrateState v9 es idempotente: correrla dos veces da el mismo resultado y no duplica el ajuste', () => {
  const raw = {
    schemaVersion: 8,
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 100, costo: 10.8, minimo: 100, margenVariable: true }],
    gastos: [
      { id: 'g1', tipo: 'inventario', insumoTipo: 'materia', insumoId: 'm1', monto: 1000, cantidad: 100, costoAntes: 0, cantidadAntes: 0, margenVariabilidadAplicado: 0.08, fecha: '2026-01-01T00:00:00' }
    ]
  };
  const s1 = C.migrateState(raw);
  const s2 = C.migrateState(s1);
  assert.strictEqual(s1.materia[0].costo, s2.materia[0].costo);
  assert.strictEqual(s2.ajustes.length, 1);
});

test('migrateState v9 no toca insumos sin margenVariabilidadAplicado en su historial de gastos', () => {
  const raw = {
    schemaVersion: 8,
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 100, costo: 10, minimo: 100 }],
    gastos: [{ id: 'g1', tipo: 'inventario', insumoTipo: 'materia', insumoId: 'm1', monto: 1000, cantidad: 100, costoAntes: 0, cantidadAntes: 0, fecha: '2026-01-01T00:00:00' }]
  };
  const s = C.migrateState(raw);
  assert.strictEqual(s.materia[0].costo, 10);
  assert.strictEqual(s.ajustes.length, 0);
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

test('I5: getDepreciacionPeriodo prorratea por días REALMENTE transcurridos, no un factor fijo (antes "mes" daba el mes completo desde el día 1)', () => {
  const s = stateConGastos();
  C.registrarGasto(s, { tipo: 'capex', categoria: 'Equipos de cocina', monto: 900000, vidaUtilMeses: 36, fecha: '2026-01-01T00:00:00' });
  // depreciación mensual total = 25000. Al 15 de junio: "mes" solo cuenta
  // los 14 días transcurridos desde el 1 de junio (antes daba 25000 fijo,
  // el mes completo, sin importar el día). "año" cuenta los 165 días
  // transcurridos desde el 1 de enero (antes daba 25000*12 fijo).
  const ref = new Date('2026-06-15T00:00:00');
  const mes = C.getDepreciacionPeriodo(s, 'mes', ref);
  const anio = C.getDepreciacionPeriodo(s, 'anio', ref);
  assert.ok(Math.abs(mes - 25000 * (14 / 30)) < 1);
  assert.ok(Math.abs(anio - 25000 * (165 / 30)) < 1);
});

console.log('\n== Cascada de utilidad (HANDOFF §9.1, §9.5) ==');

test('una compra de inventario NO resta de la utilidad bruta ni neta (ya está en el costo de ventas)', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  // ingresos 20000, costo = 100*10=1000, utilidad bruta = 19000
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 24000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 });
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.utilidadBruta, 19000);
  assert.strictEqual(c.utilidadNeta, 19000); // sin gastos operativos ni depreciación, la compra no restó nada
});

test('un gasto operativo SÍ resta de la utilidad neta pero no de la bruta', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 5000 });
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.utilidadBruta, 19000);
  assert.strictEqual(c.utilidadNeta, 19000 - 5000);
});

test('flujo de caja SÍ resta compras de inventario, operativos y capex', () => {
  const s = stateConGastos();
  s.productos.push({ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 });
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

console.log('\n== Preparaciones — porcentaje panadero (HANDOFF §10.2) ==');

// Reproduce la masa real de "WAFLE NEW YORK SIN GLUTEN" del spreadsheet,
// con los costos reales de BASE PRECIOS. Verificado a mano contra la hoja:
// 583,44 g totales, $7.269,15, $12,4591/g.
function stateMasaNewYork() {
  return C.migrateState({
    materia: [
      { id: 'harina', nombre: 'Harina de arroz', cantidad: 100000, costo: 5.8, minimo: 0 },
      { id: 'almidon', nombre: 'Almidón agrio', cantidad: 100000, costo: 10.75, minimo: 0 },
      { id: 'azucar', nombre: 'Azúcar', cantidad: 100000, costo: 3.95, minimo: 0 },
      { id: 'huevo', nombre: 'Huevos', cantidad: 100000, costo: 10.2, minimo: 0 },
      { id: 'mantequilla', nombre: 'Mantequilla', cantidad: 100000, costo: 24, minimo: 0 },
      { id: 'polvo', nombre: 'Polvo de hornear', cantidad: 100000, costo: 13.5, minimo: 0 },
      { id: 'leche', nombre: 'Leche líquida', cantidad: 100000, costo: 4.49, minimo: 0 },
      { id: 'sal', nombre: 'Sal', cantidad: 100000, costo: 3.2, minimo: 0 },
      { id: 'quesocrema', nombre: 'Queso crema', cantidad: 100000, costo: 20.25, minimo: 0 }
    ],
    preparaciones: [{
      id: 'masa-ny', nombre: 'Masa de waffles (New York)', modo: 'porcentaje', baseGramos: 100,
      componentes: [
        { tipo: 'materia', refId: 'harina', porcentaje: 1.0 },
        { tipo: 'materia', refId: 'almidon', porcentaje: 0.15 },
        { tipo: 'materia', refId: 'azucar', porcentaje: 0.2 },
        { tipo: 'materia', refId: 'huevo', porcentaje: 0.5 },   // claras
        { tipo: 'materia', refId: 'huevo', porcentaje: 0.36 },  // yemas (mismo insumo, dos líneas — así está en la hoja)
        { tipo: 'materia', refId: 'mantequilla', porcentaje: 0.4 },
        { tipo: 'materia', refId: 'polvo', porcentaje: 0.0134 },
        { tipo: 'materia', refId: 'leche', porcentaje: 1.21 },
        { tipo: 'materia', refId: 'sal', porcentaje: 0.001 },
        { tipo: 'materia', refId: 'quesocrema', porcentaje: 2.0 }
      ]
    }]
  });
}

test('masa New York: 583,44 g totales (suma de porcentajes 5,8344 × 100g base)', () => {
  const s = stateMasaNewYork();
  const c = C.getPreparacionCosto(s, 'masa-ny');
  assert.ok(Math.abs(c.gramosTotal - 583.44) < 0.01);
});

test('masa New York: costo total $7.269,15 (verificado contra la hoja real)', () => {
  const s = stateMasaNewYork();
  const c = C.getPreparacionCosto(s, 'masa-ny');
  assert.ok(Math.abs(c.costoTotal - 7269.15) < 0.5);
});

test('masa New York: costo por gramo $12,4591 (verificado contra la hoja real)', () => {
  const s = stateMasaNewYork();
  const c = C.getPreparacionCosto(s, 'masa-ny');
  assert.ok(Math.abs(c.costoPorGramo - 12.4591) < 0.001);
});

console.log('\n== B3: rendimiento de preparaciones (mermas de cocción/evaporación) ==');

function statePrepConRendimiento(rendimientoPct) {
  return C.migrateState({
    materia: [
      { id: 'harina', nombre: 'Harina', cantidad: 100000, costo: 5, minimo: 0 },
      { id: 'agua', nombre: 'Agua', cantidad: 100000, costo: 0, minimo: 0 }
    ],
    preparaciones: [{
      id: 'masa', nombre: 'Masa', modo: 'directo', rendimientoPct: rendimientoPct,
      componentes: [
        { tipo: 'materia', refId: 'harina', gramos: 600 },
        { tipo: 'materia', refId: 'agua', gramos: 400 }
      ]
    }]
  });
}

test('rendimientoPct 85%: 600g harina a $5 + 400g agua a $0 da $3,53/g (hoy con el bug daba $3,00/g)', () => {
  const s = statePrepConRendimiento(85);
  const c = C.getPreparacionCosto(s, 'masa');
  assert.ok(Math.abs(c.costoPorGramo - 3.5294) < 0.001);
  assert.ok(Math.abs(c.gramosObtenidos - 850) < 0.01);
  // el costo TOTAL de los insumos no cambia con el rendimiento, solo el costo por gramo
  assert.ok(Math.abs(c.costoTotal - 3000) < 0.01);
});

test('rendimientoPct 100 (default) no cambia el comportamiento actual', () => {
  const s = statePrepConRendimiento(100);
  const c = C.getPreparacionCosto(s, 'masa');
  assert.strictEqual(c.costoPorGramo, 3);
  assert.strictEqual(c.gramosObtenidos, 1000);
  assert.strictEqual(c.costoTotal, 3000);
});

test('el consumo teórico expandido (composición por gramo) también usa gramos obtenidos, no insumos', () => {
  const s = statePrepConRendimiento(85);
  const composicion = C.getPreparacionComposicionPorGramo(s, 'masa');
  // 600g de harina repartidos sobre 850g obtenidos, no sobre 1000g de insumos
  assert.ok(Math.abs(composicion.harina - 600 / 850) < 0.0001);
});

test('migrateState pone rendimientoPct:100 en preparaciones viejas que no lo tenían', () => {
  const s = C.migrateState({ preparaciones: [{ id: 'p1', nombre: 'Vieja', modo: 'directo', componentes: [] }] });
  assert.strictEqual(s.preparaciones[0].rendimientoPct, 100);
});

test('savePreparacion guarda rendimientoPct (default 100 si no se manda)', () => {
  const s = C.migrateState({});
  const p1 = C.savePreparacion(s, { nombre: 'Con rendimiento', componentes: [], rendimientoPct: 92 });
  assert.strictEqual(p1.rendimientoPct, 92);
  const p2 = C.savePreparacion(s, { nombre: 'Sin especificar', componentes: [] });
  assert.strictEqual(p2.rendimientoPct, 100);
});

console.log('\n== Preparaciones — modo directo ==');

test('modo directo suma gramos explícitos sin porcentaje panadero', () => {
  const s = C.migrateState({
    materia: [
      { id: 'moras', nombre: 'Moras', cantidad: 10000, costo: 13, minimo: 0 },
      { id: 'fresas', nombre: 'Fresas', cantidad: 10000, costo: 13, minimo: 0 },
      { id: 'azucar', nombre: 'Azúcar', cantidad: 10000, costo: 3.95, minimo: 0 }
    ],
    preparaciones: [{
      id: 'salsa', nombre: 'Salsa de frutos rojos', modo: 'directo', baseGramos: 0,
      componentes: [
        { tipo: 'materia', refId: 'moras', gramos: 500 },
        { tipo: 'materia', refId: 'fresas', gramos: 250 },
        { tipo: 'materia', refId: 'azucar', gramos: 225 }
      ]
    }]
  });
  const c = C.getPreparacionCosto(s, 'salsa');
  assert.strictEqual(c.gramosTotal, 975);
  assert.ok(Math.abs(c.costoTotal - 10638.75) < 0.01); // verificado contra la hoja
  assert.ok(Math.abs(c.costoPorGramo - 10.9115) < 0.001);
});

console.log('\n== Preparaciones anidadas (una preparación usa otra) ==');

function stateAnidada() {
  return C.migrateState({
    materia: [
      { id: 'chocolate', nombre: 'Chocolate', cantidad: 100000, costo: 10, minimo: 0 },
      { id: 'crema', nombre: 'Crema de leche', cantidad: 100000, costo: 4, minimo: 0 },
      { id: 'azucar', nombre: 'Azúcar', cantidad: 100000, costo: 2, minimo: 0 }
    ],
    preparaciones: [
      {
        id: 'ganache', nombre: 'Ganache', modo: 'porcentaje', baseGramos: 200,
        componentes: [
          { tipo: 'materia', refId: 'chocolate', porcentaje: 1.0 },
          { tipo: 'materia', refId: 'crema', porcentaje: 0.2 }
        ]
      },
      {
        id: 'relleno', nombre: 'Relleno completo', modo: 'directo',
        componentes: [
          { tipo: 'preparacion', refId: 'ganache', gramos: 100 },
          { tipo: 'materia', refId: 'azucar', gramos: 20 }
        ]
      }
    ]
  });
}

test('preparación base (ganache): 240 g, $9,00/g', () => {
  const s = stateAnidada();
  const c = C.getPreparacionCosto(s, 'ganache');
  assert.strictEqual(c.gramosTotal, 240);
  assert.ok(Math.abs(c.costoPorGramo - 9.0) < 0.0001);
});

test('preparación anidada (relleno usa ganache): composición se expande a materia cruda', () => {
  const s = stateAnidada();
  const comp = C.getPreparacionComposicionPorGramo(s, 'relleno');
  // 100g de ganache dentro de 120g totales de relleno: choc=83.333g, crema=16.667g, azúcar=20g directo
  assert.ok(Math.abs(comp.chocolate - 83.3333 / 120) < 0.0001);
  assert.ok(Math.abs(comp.crema - 16.6667 / 120) < 0.0001);
  assert.ok(Math.abs(comp.azucar - 20 / 120) < 0.0001);
  const suma = comp.chocolate + comp.crema + comp.azucar;
  assert.ok(Math.abs(suma - 1) < 0.0001, 'la composición por gramo debe sumar 1 (se explica el 100% de cada gramo)');
});

test('preparación anidada (relleno): costo por gramo se deriva de la expansión, no de una fórmula aparte', () => {
  const s = stateAnidada();
  const c = C.getPreparacionCosto(s, 'relleno');
  assert.strictEqual(c.gramosTotal, 120);
  // costoTotal = 100*9.0 (ganache) + 20*2 (azúcar) = 940 ; /120 = 7.8333
  assert.ok(Math.abs(c.costoTotal - 940) < 0.01);
  assert.ok(Math.abs(c.costoPorGramo - 7.8333) < 0.001);
});

console.log('\n== Detección de ciclos (HANDOFF §10.2, §21) ==');

test('rechaza que una preparación se use a sí misma como componente', () => {
  const s = stateAnidada();
  const ciclo = C.wouldCreateCiclo(s, 'ganache', [{ tipo: 'preparacion', refId: 'ganache', porcentaje: 1 }]);
  assert.strictEqual(ciclo, true);
});

test('rechaza un ciclo indirecto (A usa B, B usa A)', () => {
  const s = stateAnidada();
  // 'relleno' ya usa 'ganache'. Intentar que 'ganache' pase a usar 'relleno' cierra el ciclo.
  const ciclo = C.wouldCreateCiclo(s, 'ganache', [{ tipo: 'preparacion', refId: 'relleno', porcentaje: 1 }]);
  assert.strictEqual(ciclo, true);
});

test('rechaza un ciclo de tres niveles (A usa B, B usa C, C usa A)', () => {
  const s = C.migrateState({
    materia: [{ id: 'm1', nombre: 'X', cantidad: 1000, costo: 1, minimo: 0 }],
    preparaciones: [
      { id: 'a', nombre: 'A', modo: 'directo', componentes: [{ tipo: 'preparacion', refId: 'b', gramos: 10 }] },
      { id: 'b', nombre: 'B', modo: 'directo', componentes: [{ tipo: 'preparacion', refId: 'c', gramos: 10 }] },
      { id: 'c', nombre: 'C', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'm1', gramos: 10 }] }
    ]
  });
  // 'c' pasaría a usar 'a' -> a->b->c->a, ciclo de tres niveles
  const ciclo = C.wouldCreateCiclo(s, 'c', [{ tipo: 'preparacion', refId: 'a', gramos: 5 }]);
  assert.strictEqual(ciclo, true);
});

test('no marca ciclo cuando dos preparaciones distintas comparten una sub-preparación (diamante, válido)', () => {
  const s = stateAnidada();
  // Otra preparación nueva que también usa 'ganache' — no es un ciclo, es reutilización legítima.
  const ciclo = C.wouldCreateCiclo(s, 'otra-nueva', [{ tipo: 'preparacion', refId: 'ganache', gramos: 5 }]);
  assert.strictEqual(ciclo, false);
});

test('savePreparacion rechaza guardar si crearía un ciclo', () => {
  const s = stateAnidada();
  assert.throws(() => {
    C.savePreparacion(s, { id: 'ganache', nombre: 'Ganache', modo: 'porcentaje', baseGramos: 200, componentes: [{ tipo: 'preparacion', refId: 'relleno', porcentaje: 1 }] });
  }, /ciclo/i);
});

test('savePreparacion rechaza nombre vacío', () => {
  const s = stateAnidada();
  assert.throws(() => C.savePreparacion(s, { nombre: '  ', modo: 'directo', componentes: [] }));
});

test('savePreparacion crea y luego actualiza correctamente', () => {
  const s = stateAnidada();
  const nueva = C.savePreparacion(s, { nombre: 'Crumble', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'azucar', gramos: 50 }] });
  assert.strictEqual(s.preparaciones.length, 3);
  C.savePreparacion(s, { id: nueva.id, nombre: 'Crumble editado', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'azucar', gramos: 80 }] });
  assert.strictEqual(s.preparaciones.length, 3); // no duplica, actualiza
  assert.strictEqual(s.preparaciones.find(p => p.id === nueva.id).nombre, 'Crumble editado');
});

console.log('\n== Producto con componentes mixtos (materia directa + preparación) ==');

function stateProductoConPreparacion() {
  const s = stateAnidada();
  s.empaques = [{ id: 'e1', nombre: 'Caja', unidad: 'unidad', cantidad: 100, costo: 500, minimo: 0 }];
  s.productos = [{
    id: 'p1', nombre: 'Waffle con ganache', precio: 15000,
    componentes: [
      { tipo: 'preparacion', refId: 'relleno', gramos: 120 },
      { tipo: 'materia', refId: 'azucar', gramos: 10 } // un poco de azúcar directa además del relleno
    ],
    empaquesUsados: [{ empaqueId: 'e1', cantidad: 1 }],
    empaqueManual: 0
  }];
  return s;
}

test('getCostoProducto suma preparación (costo por gramo) + materia directa + empaque', () => {
  const s = stateProductoConPreparacion();
  const costo = C.getCostoProducto(s.productos[0], s);
  // relleno: 120g * 7.8333/g = 940 ; azúcar directa 10*2=20 ; empaque 500
  assert.ok(Math.abs(costo - (940 + 20 + 500)) < 0.01);
});

console.log('\n== Venta que consume una preparación descuenta materia real (no la preparación) ==');

test('applyVenta descuenta la materia cruda expandida, no un stock de "preparación"', () => {
  const s = stateProductoConPreparacion();
  const antes = {
    chocolate: s.materia.find(m => m.id === 'chocolate').cantidad,
    crema: s.materia.find(m => m.id === 'crema').cantidad,
    azucar: s.materia.find(m => m.id === 'azucar').cantidad
  };
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  const despues = {
    chocolate: s.materia.find(m => m.id === 'chocolate').cantidad,
    crema: s.materia.find(m => m.id === 'crema').cantidad,
    azucar: s.materia.find(m => m.id === 'azucar').cantidad
  };
  // componente preparación (120g de relleno) -> 83.333g choc, 16.667g crema, 20g azúcar (del relleno)
  // + 10g azúcar directa del producto = 30g azúcar en total
  assert.ok(Math.abs((antes.chocolate - despues.chocolate) - 83.3333) < 0.01);
  assert.ok(Math.abs((antes.crema - despues.crema) - 16.6667) < 0.01);
  assert.ok(Math.abs((antes.azucar - despues.azucar) - 30) < 0.01);
  assert.ok(Math.abs(venta.consumoReal.materia.chocolate - 83.3333) < 0.01);
});

test('revertVenta a través de una preparación devuelve exactamente la materia cruda descontada', () => {
  const s = stateProductoConPreparacion();
  const antes = {
    chocolate: s.materia.find(m => m.id === 'chocolate').cantidad,
    crema: s.materia.find(m => m.id === 'crema').cantidad,
    azucar: s.materia.find(m => m.id === 'azucar').cantidad
  };
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 2, toppings: [] }], [], {});
  C.revertVenta(s, venta);
  const despues = {
    chocolate: s.materia.find(m => m.id === 'chocolate').cantidad,
    crema: s.materia.find(m => m.id === 'crema').cantidad,
    azucar: s.materia.find(m => m.id === 'azucar').cantidad
  };
  assert.ok(Math.abs(antes.chocolate - despues.chocolate) < 0.0001);
  assert.ok(Math.abs(antes.crema - despues.crema) < 0.0001);
  assert.ok(Math.abs(antes.azucar - despues.azucar) < 0.0001);
});

test('computeSaleConsumption y checkStockShortage detectan faltante de materia usada solo vía preparación', () => {
  const s = stateProductoConPreparacion();
  s.materia.find(m => m.id === 'chocolate').cantidad = 50; // hacen falta 83.333g
  const consumo = C.computeSaleConsumption([{ productoId: 'p1', qty: 1, toppings: [] }], [], s);
  const faltantes = C.checkStockShortage(consumo, s);
  const fChoc = faltantes.find(f => f.id === 'chocolate');
  assert.ok(fChoc, 'debe detectar el faltante de chocolate aunque solo se use dentro de una preparación');
  assert.ok(Math.abs(fChoc.faltante - 33.3333) < 0.01);
});

test('calcInventoryNeeds proyecta consumo de materia usada solo vía preparación', () => {
  const s = stateProductoConPreparacion();
  s.ventas.push({
    id: 'v1', fecha: new Date().toISOString(),
    items: [{ productoId: 'p1', nombre: 'Waffle con ganache', qty: 1, precio: 15000, costo: 1460 }],
    total: 15000, ganancia: 13540
  });
  const needs = C.calcInventoryNeeds(s, 7);
  const chocNeed = needs.find(n => n.id === 'chocolate');
  assert.ok(chocNeed.consumo > 0, 'el consumo de chocolate debe reflejarse aunque solo se use vía una preparación');
});

console.log('\n== Dependencias con preparaciones (P1-4 extendido) ==');

test('findProductosUsandoPreparacion detecta el producto que la referencia', () => {
  const s = stateProductoConPreparacion();
  const usados = C.findProductosUsandoPreparacion(s, 'relleno');
  assert.strictEqual(usados.length, 1);
  assert.strictEqual(usados[0].id, 'p1');
});

test('findPreparacionesUsandoPreparacion detecta relleno usando ganache', () => {
  const s = stateAnidada();
  const usados = C.findPreparacionesUsandoPreparacion(s, 'ganache');
  assert.strictEqual(usados.length, 1);
  assert.strictEqual(usados[0].id, 'relleno');
});

test('findPreparacionesUsandoMateria detecta ganache usando chocolate', () => {
  const s = stateAnidada();
  const usados = C.findPreparacionesUsandoMateria(s, 'chocolate');
  assert.strictEqual(usados.length, 1);
  assert.strictEqual(usados[0].id, 'ganache');
});

console.log('\n== Margen bruto por producto (sin recargo de costos fijos) ==');

function stateMargen() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Insumo', cantidad: 1000, costo: 9822.81, minimo: 0 }],
    productos: [{ id: 'p1', nombre: 'Waffle New York', precio: 22000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 1 }], empaquesUsados: [], empaqueManual: 0 }]
  });
}

test('getMargenProducto: costo, ganancia y margen sobre precio (sin recargo)', () => {
  const s = stateMargen();
  const r = C.getMargenProducto(s.productos[0], s);
  assert.ok(Math.abs(r.costo - 9822.81) < 0.01);
  assert.ok(Math.abs(r.ganancia - (22000 - 9822.81)) < 0.01);
  assert.ok(Math.abs(r.margenPct - ((22000 - 9822.81) / 22000)) < 0.0001);
});

test('el precio de venta es la ENTRADA — cambiar el costo del insumo no lo toca, solo el margen', () => {
  const s = stateMargen();
  const precioAntes = s.productos[0].precio;
  s.materia[0].costo = 25000;
  const r = C.getMargenProducto(s.productos[0], s);
  assert.strictEqual(s.productos[0].precio, precioAntes);
  assert.ok(r.ganancia < 0);
});

test('venta.items[].costo sigue siendo costo del producto, consistente con getMargenProducto', () => {
  const s = stateMargen();
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  assert.ok(Math.abs(venta.items[0].costo - 9822.81) < 0.01);
});

test('la utilidad neta (Fase C) se sigue conociendo por período, no por producto', () => {
  const s = stateMargen();
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.ok(Math.abs(c.utilidadBruta - (22000 - 9822.81)) < 0.01);
});

console.log('\n== Clientes (nombre + teléfono reutilizable) ==');

test('findOrCreateCliente crea un cliente nuevo', () => {
  const s = C.emptyState();
  const id = C.findOrCreateCliente(s, 'Ana', '3001234567');
  assert.strictEqual(s.clientes.length, 1);
  assert.strictEqual(s.clientes[0].nombre, 'Ana');
  assert.strictEqual(s.clientes[0].id, id);
});

test('findOrCreateCliente reutiliza por teléfono en vez de duplicar', () => {
  const s = C.emptyState();
  const id1 = C.findOrCreateCliente(s, 'Ana', '3001234567');
  const id2 = C.findOrCreateCliente(s, 'Ana', '3001234567');
  assert.strictEqual(id1, id2);
  assert.strictEqual(s.clientes.length, 1);
});

test('findOrCreateCliente actualiza el nombre si vino distinto para el mismo teléfono', () => {
  const s = C.emptyState();
  C.findOrCreateCliente(s, 'Ana', '3001234567');
  C.findOrCreateCliente(s, 'Ana María', '3001234567');
  assert.strictEqual(s.clientes.length, 1);
  assert.strictEqual(s.clientes[0].nombre, 'Ana María');
});

test('findOrCreateCliente sin nombre ni teléfono no crea nada', () => {
  const s = C.emptyState();
  const id = C.findOrCreateCliente(s, '', '');
  assert.strictEqual(id, null);
  assert.strictEqual(s.clientes.length, 0);
});

test('applyVenta guarda clienteId cuando se provee', () => {
  const s = stateMargen();
  const clienteId = C.findOrCreateCliente(s, 'Ana', '3001234567');
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], { clienteId });
  assert.strictEqual(venta.clienteId, clienteId);
});

console.log('\n== Ticket promedio ==');

test('getTicketPromedio promedia el total de las ventas', () => {
  const ventas = [{ total: 20000 }, { total: 30000 }, { total: 10000 }];
  assert.strictEqual(C.getTicketPromedio(ventas), 20000);
});

test('getTicketPromedio sin ventas es 0', () => {
  assert.strictEqual(C.getTicketPromedio([]), 0);
});

console.log('\n== Rango de fechas personalizable ==');

test('getVentasByRange incluye solo ventas dentro del rango (inclusive)', () => {
  const ventas = [
    { fecha: '2026-08-01T10:00:00', total: 100 },
    { fecha: '2026-08-05T10:00:00', total: 200 },
    { fecha: '2026-08-10T10:00:00', total: 300 }
  ];
  const enRango = C.getVentasByRange(ventas, '2026-08-01', '2026-08-05');
  assert.strictEqual(enRango.length, 2);
  assert.strictEqual(enRango.reduce((a, v) => a + v.total, 0), 300);
});

test('getCascadaUtilidadRango da el mismo resultado que getCascadaUtilidad para un rango equivalente a "hoy"', () => {
  const s = stateMargen();
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  // Fecha LOCAL de hoy, como la entregaría un <input type="date"> del
  // navegador — usar toISOString() aquí daría la fecha en UTC, que en
  // Colombia (UTC-5) puede ser un día distinto al local.
  const n = new Date();
  const hoy = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  const porPeriodo = C.getCascadaUtilidad(s, 'dia');
  const porRango = C.getCascadaUtilidadRango(s, hoy, hoy);
  assert.ok(Math.abs(porPeriodo.ingresos - porRango.ingresos) < 0.01);
  assert.ok(Math.abs(porPeriodo.utilidadBruta - porRango.utilidadBruta) < 0.01);
});

console.log('\n== A1: margenVariable ya NO recarga la valuación (ver también los tests dedicados arriba) ==');

test('insumo marcado margenVariable: la compra NO aplica ningún recargo (retirado en v9 — antes daba +8%)', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'Cacao', cantidad: 0, costo: 0, minimo: 0, margenVariable: true }] });
  const g = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 10000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  assert.ok(Math.abs(s.materia[0].costo - 10) < 0.001);
  assert.strictEqual(g.margenVariabilidadAplicado, undefined);
});

test('insumo NO marcado margenVariable: idéntico comportamiento, sin recargo', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'Harina', cantidad: 0, costo: 0, minimo: 0 }] });
  const g = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 10000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  assert.ok(Math.abs(s.materia[0].costo - 10) < 0.001);
  assert.strictEqual(g.margenVariabilidadAplicado, undefined);
});

test('eliminarGasto revierte exacto al snapshot previo (independiente de margenVariable)', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'Cacao', cantidad: 500, costo: 20, minimo: 0, margenVariable: true }] });
  const g = C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 10000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000 });
  C.eliminarGasto(s, g.id);
  assert.strictEqual(s.materia[0].costo, 20);
  assert.strictEqual(s.materia[0].cantidad, 500);
});

console.log('\n== Rediseño: insumos unificados y adiciones ==');

test('getInsumosUnificados aplana materia+empaques+toppings con su tipo', () => {
  const s = C.migrateState({
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 100, costo: 1, minimo: 10 }],
    empaques: [{ id: 'e1', nombre: 'Caja', cantidad: 5, costo: 200, minimo: 1 }],
    toppings: [{ id: 't1', nombre: 'Chispas', cantidad: 50, costo: 5, precio: 10, minimo: 5 }]
  });
  const unificados = C.getInsumosUnificados(s);
  assert.strictEqual(unificados.length, 3);
  assert.deepStrictEqual(unificados.map(i => i.tipo).sort(), ['empaques', 'materia', 'toppings']);
  assert.strictEqual(unificados.find(i => i.id === 'm1').unidad, 'g');
});

test('getAdiciones filtra solo los insumos marcados esAdicion, de cualquier tipo', () => {
  const s = C.migrateState({
    materia: [
      { id: 'crema', nombre: 'Crema de leche', cantidad: 1000, costo: 9, minimo: 100, esAdicion: true, precioAdicion: 2000, porcion: 30, nombreAdicion: 'Chantilly' },
      { id: 'harina', nombre: 'Harina', cantidad: 1000, costo: 1, minimo: 100 }
    ],
    toppings: [{ id: 'choco', nombre: 'Chocolate', cantidad: 100, costo: 10, precio: 3000, minimo: 10, esAdicion: true, precioAdicion: 3000, porcion: 20 }]
  });
  const adiciones = C.getAdiciones(s);
  assert.strictEqual(adiciones.length, 2);
  assert.ok(adiciones.every(a => a.esAdicion));
});

test('applyVenta con una adición consume su porción y suma su precio/ganancia', () => {
  const s = C.migrateState({
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 18000, componentes: [], empaquesUsados: [] }],
    materia: [{ id: 'crema', nombre: 'Crema', cantidad: 1000, costo: 9, minimo: 100, esAdicion: true, precioAdicion: 2000, porcion: 30 }]
  });
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 2, adiciones: ['crema'] }], []);
  // 2 unidades × 30g de porción = 60g consumidos
  assert.strictEqual(s.materia[0].cantidad, 940);
  assert.strictEqual(venta.total, 18000 * 2 + 2000 * 2);
  const itemAdicion = venta.items.find(i => i.adicionId === 'crema');
  assert.strictEqual(itemAdicion.qty, 2);
  assert.strictEqual(itemAdicion.costo, 9 * 30); // costo por unidad vendida = porción × costo/g
});

test('revertVenta deshace una venta con adición sin cambios adicionales (usa consumoReal)', () => {
  const s = C.migrateState({
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 18000, componentes: [], empaquesUsados: [] }],
    materia: [{ id: 'crema', nombre: 'Crema', cantidad: 1000, costo: 9, minimo: 100, esAdicion: true, precioAdicion: 2000, porcion: 30 }]
  });
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, adiciones: ['crema'] }], []);
  assert.strictEqual(s.materia[0].cantidad, 970);
  C.revertVenta(s, venta);
  assert.strictEqual(s.materia[0].cantidad, 1000);
});

test('findInsumoConTipo encuentra el insumo y su bucket entre las tres colecciones', () => {
  const s = C.migrateState({ toppings: [{ id: 't1', nombre: 'Chispas', cantidad: 10, costo: 5, precio: 10, minimo: 1 }] });
  const found = C.findInsumoConTipo(s, 't1');
  assert.strictEqual(found.tipo, 'toppings');
  assert.strictEqual(found.item.nombre, 'Chispas');
});

test('getMovimientos combina ventas y gastos ordenados por fecha descendente', () => {
  const ventas = [{ fecha: '2026-08-15T10:00:00', total: 20000 }];
  const gastos = [{ fecha: '2026-08-17T10:00:00', tipo: 'operativo', monto: 5000 }, { fecha: '2026-08-16T10:00:00', tipo: 'inventario', monto: 3000 }];
  const mov = C.getMovimientos(ventas, gastos);
  assert.strictEqual(mov.length, 3);
  assert.strictEqual(mov[0].fecha, '2026-08-17T10:00:00');
  assert.strictEqual(mov[0].signo, '-');
  assert.strictEqual(mov[2].tipo, 'venta');
  assert.strictEqual(mov[2].signo, '+');
});

test('findOrCreateCliente guarda la dirección cuando viene con el cliente nuevo', () => {
  const s = C.migrateState(null);
  const id = C.findOrCreateCliente(s, 'Ana', '3001234567', 'Cra 12 #34-56');
  assert.strictEqual(s.clientes.find(c => c.id === id).direccion, 'Cra 12 #34-56');
});

test('migrateState agrega categoria/esAdicion/comprobante a estados viejos sin romper nada', () => {
  const s = C.migrateState({
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 100, costo: 1, minimo: 10 }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 18000, componentes: [] }],
    ventas: [{ id: 'v1', fecha: '2026-08-01T10:00:00', items: [], total: 0, ganancia: 0 }],
    gastos: [{ id: 'g1', fecha: '2026-08-01T10:00:00', tipo: 'operativo', categoria: 'Aseo', monto: 5000 }],
    clientes: [{ id: 'c1', nombre: 'Ana', telefono: '300' }]
  });
  assert.strictEqual(s.materia[0].categoria, '');
  assert.strictEqual(s.materia[0].esAdicion, false);
  assert.strictEqual(s.productos[0].categoria, '');
  assert.strictEqual(s.ventas[0].metodoPago, 'efectivo');
  assert.strictEqual(s.gastos[0].comprobante, '');
  assert.strictEqual(s.clientes[0].direccion, '');
});

test('getCostoProducto suma un componente tipo empaques o toppings, no solo materia', () => {
  const s = C.migrateState({
    empaques: [{ id: 'vaso', nombre: 'Vaso', cantidad: 100, costo: 250, minimo: 10 }],
    toppings: [{ id: 'choco', nombre: 'Chocolate', cantidad: 100, costo: 10, precio: 3000, minimo: 10 }],
    productos: [{ id: 'p1', nombre: 'Malteada', precio: 15000, componentes: [{ tipo: 'empaques', refId: 'vaso', gramos: 1 }, { tipo: 'toppings', refId: 'choco', gramos: 20 }] }]
  });
  const producto = s.productos[0];
  // 1 vaso × 250 + 20 × 10 (chocolate) = 450
  assert.strictEqual(C.getCostoProducto(producto, s), 450);
});

test('applyVenta descuenta stock de un componente tipo empaques/toppings en la receta', () => {
  const s = C.migrateState({
    empaques: [{ id: 'vaso', nombre: 'Vaso', cantidad: 100, costo: 250, minimo: 10 }],
    productos: [{ id: 'p1', nombre: 'Malteada', precio: 15000, componentes: [{ tipo: 'empaques', refId: 'vaso', gramos: 1 }], empaquesUsados: [] }]
  });
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 3 }], []);
  assert.strictEqual(s.empaques[0].cantidad, 97);
  C.revertVenta(s, venta);
  assert.strictEqual(s.empaques[0].cantidad, 100);
});

test('getIngresosPorDia devuelve 7 días cronológicos con el total correcto por día', () => {
  const ventas = [
    { fecha: '2026-08-17T10:00:00', total: 100 },
    { fecha: '2026-08-17T18:00:00', total: 50 },
    { fecha: '2026-08-15T10:00:00', total: 200 }
  ];
  const dias = C.getIngresosPorDia(ventas, 7, '2026-08-17T20:00:00');
  assert.strictEqual(dias.length, 7);
  assert.strictEqual(dias[6].fecha, '2026-08-17');
  assert.strictEqual(dias[6].total, 150);
  assert.strictEqual(dias[6].esHoy, true);
  const dia15 = dias.find(d => d.fecha === '2026-08-15');
  assert.strictEqual(dia15.total, 200);
});

console.log('\n== Mermas (pérdidas de inventario, nunca movimiento de Caja) ==');

function stateConMermas() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Harina', cantidad: 1000, costo: 10, minimo: 100 }],
    empaques: [{ id: 'vaso', nombre: 'Vaso', cantidad: 50, costo: 250, minimo: 10 }],
    toppings: [{ id: 't1', nombre: 'Chispas', cantidad: 30, costo: 20, precio: 500, minimo: 5 }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [{ empaqueId: 'vaso', cantidad: 1 }], empaqueManual: 0 }],
    ventas: [], gastos: [], mermas: []
  });
}

test('registrarMerma de un insumo directo descuenta su cantidad y calcula el valor con el costo ya existente', () => {
  const s = stateConMermas();
  const merma = C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 3, motivo: 'Vencido' });
  assert.strictEqual(s.materia[0].cantidad, 997);
  assert.strictEqual(merma.costoUnitario, 10);
  assert.strictEqual(merma.valorTotal, 30);
});

test('ejemplo del enunciado: 20 unidades a $5.000, se desechan 3 -> quedan 17 y la merma vale $15.000', () => {
  const s = C.migrateState({ toppings: [{ id: 'salsa', nombre: 'Salsa de la casa', cantidad: 20, costo: 5000, precio: 0, minimo: 1 }] });
  const merma = C.registrarMerma(s, { origenTipo: 'toppings', origenId: 'salsa', cantidad: 3, motivo: 'Dañado' });
  assert.strictEqual(s.toppings[0].cantidad, 17);
  assert.strictEqual(merma.valorTotal, 15000);
});

test('registrarMerma de un producto preparado (BOM) descuenta sus insumos reales, no un stock propio del producto', () => {
  const s = stateConMermas();
  // Waffle: 100g harina + 1 vaso por unidad. Merma de 2 waffles no vendidos.
  const merma = C.registrarMerma(s, { origenTipo: 'producto', origenId: 'p1', cantidad: 2, motivo: 'No vendido' });
  assert.strictEqual(s.materia[0].cantidad, 800); // 1000 - 200g
  assert.strictEqual(s.empaques[0].cantidad, 48); // 50 - 2 vasos
  // costo del waffle = 100*10 (materia) + 1*250 (vaso) = 1250; x2 = 2500
  assert.strictEqual(merma.valorTotal, 2500);
});

test('registrarMerma NUNCA crea un gasto ni una venta — no es un movimiento de Caja', () => {
  const s = stateConMermas();
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 5, motivo: 'Derrame' });
  assert.strictEqual(s.gastos.length, 0);
  assert.strictEqual(s.ventas.length, 0);
});

test('registrarMerma valida cantidad > 0, motivo obligatorio y origen existente', () => {
  const s = stateConMermas();
  assert.throws(() => C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 0, motivo: 'Vencido' }));
  assert.throws(() => C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 1, motivo: '' }));
  assert.throws(() => C.registrarMerma(s, { origenTipo: 'materia', origenId: 'no-existe', cantidad: 1, motivo: 'Vencido' }));
  assert.strictEqual(s.mermas.length, 0);
});

test('registrarMerma clampea a 0 si la cantidad supera el disponible (mismo criterio que applyVenta) y lo marca stockInsuficiente', () => {
  const s = stateConMermas();
  const merma = C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 5000, motivo: 'Vencido', stockInsuficiente: true });
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(merma.stockInsuficiente, true);
  assert.strictEqual(merma.consumoReal.materia['m1'], 1000); // lo que realmente se descontó, no lo pedido
});

test('eliminarMerma revierte exactamente lo descontado (consumoReal), no recalcula desde la receta actual', () => {
  const s = stateConMermas();
  const merma = C.registrarMerma(s, { origenTipo: 'producto', origenId: 'p1', cantidad: 2, motivo: 'Quemado' });
  assert.strictEqual(s.materia[0].cantidad, 800);
  assert.strictEqual(s.empaques[0].cantidad, 48);
  C.eliminarMerma(s, merma.id);
  assert.strictEqual(s.materia[0].cantidad, 1000);
  assert.strictEqual(s.empaques[0].cantidad, 50);
  assert.strictEqual(s.mermas.length, 0);
});

test('eliminarMerma de una merma con stock insuficiente no deja el inventario por encima del real (revierte lo clampeado, no lo pedido)', () => {
  const s = stateConMermas();
  const merma = C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 5000, motivo: 'Vencido' });
  assert.strictEqual(s.materia[0].cantidad, 0);
  C.eliminarMerma(s, merma.id);
  assert.strictEqual(s.materia[0].cantidad, 1000); // vuelve a lo que había, no a 5000
});

test('getCascadaUtilidad resta las mermas de la utilidad neta pero NUNCA del flujo de caja', () => {
  const s = stateConMermas();
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  // ingresos 20000, costo 1250 (100g*10 + 1 vaso*250), utilidad bruta 18750
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 10, motivo: 'Vencido' }); // 10*10 = $100 de merma
  const c = C.getCascadaUtilidad(s, 'mes');
  assert.strictEqual(c.mermas, 100);
  assert.strictEqual(c.utilidadNeta, 18750 - 100);
  assert.strictEqual(c.flujoCaja, 20000); // ninguna merma ni gasto — el flujo de caja no se mueve
});

test('computeCascada con la firma vieja de 3 argumentos (sin mermasValor) sigue funcionando igual que antes', () => {
  const c = C.computeCascada([{ total: 1000, ganancia: 400 }], [], 0);
  assert.strictEqual(c.mermas, 0);
  assert.strictEqual(c.utilidadNeta, 400);
});

test('migrateState agrega mermas:[] a un estado viejo sin romper nada', () => {
  const s = C.migrateState({ materia: [{ id: 'm1', nombre: 'Harina', cantidad: 100, costo: 1, minimo: 10 }] });
  assert.deepStrictEqual(s.mermas, []);
});

test('getValorTotalMermas / agruparMermasPorMotivo / getMermaOrigenNombre / agruparMermasPorOrigen', () => {
  const s = stateConMermas();
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 3, motivo: 'Vencido', fecha: '2026-08-01T10:00:00' });
  C.registrarMerma(s, { origenTipo: 'toppings', origenId: 't1', cantidad: 2, motivo: 'Vencido', fecha: '2026-08-02T10:00:00' });
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 1, motivo: 'Derrame', fecha: '2026-08-03T10:00:00' });
  assert.strictEqual(C.getValorTotalMermas(s.mermas), 30 + 40 + 10);
  const porMotivo = C.agruparMermasPorMotivo(s.mermas);
  assert.strictEqual(porMotivo['Vencido'], 70);
  assert.strictEqual(porMotivo['Derrame'], 10);
  assert.strictEqual(C.getMermaOrigenNombre(s, s.mermas[0]), 'Harina');
  const porOrigen = C.agruparMermasPorOrigen(s, s.mermas);
  assert.strictEqual(porOrigen['Harina'].cantidad, 4);
  assert.strictEqual(porOrigen['Harina'].valor, 40);
});

test('getMermasByPeriod / getMermasByRange filtran por fecha igual que ventas/gastos', () => {
  const s = stateConMermas();
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 1, motivo: 'Vencido', fecha: '2020-01-01T10:00:00' });
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 1, motivo: 'Vencido', fecha: new Date().toISOString() });
  const hoy = C.getMermasByPeriod(s.mermas, 'dia');
  assert.strictEqual(hoy.length, 1);
  const rango = C.getMermasByRange(s.mermas, '2019-12-01', '2020-02-01');
  assert.strictEqual(rango.length, 1);
});

console.log('\n== B1: snapshots de inventario ==');

test('getValorInventario suma cantidad×costo por bucket y en total', () => {
  const s = stateConMermas(); // m1: 1000@10=10000 ; vaso: 50@250=12500 ; t1: 30@20=600
  const v = C.getValorInventario(s);
  assert.strictEqual(v.materia, 10000);
  assert.strictEqual(v.empaques, 12500);
  assert.strictEqual(v.toppings, 600);
  assert.strictEqual(v.total, 23100);
});

test('crearSnapshot tipo sistema incluye los 3 buckets y su valorTotal coincide con getValorInventario', () => {
  const s = stateConMermas();
  const snap = C.crearSnapshot(s, { tipo: 'sistema', usuarioEmail: 'mike@crumbly.co' });
  assert.strictEqual(snap.lineas.length, 3);
  assert.strictEqual(snap.noContados.length, 0);
  assert.strictEqual(snap.valorTotal, C.getValorInventario(s).total);
  assert.strictEqual(s.snapshots.length, 1);
});

test('crearSnapshot tipo conteo parcial NO asume cero en lo no contado: lo lista aparte', () => {
  const s = stateConMermas();
  const snap = C.crearSnapshot(s, {
    tipo: 'conteo', usuarioEmail: 'mike@crumbly.co', nota: 'solo materia prima hoy',
    conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 900 }]
  });
  assert.strictEqual(snap.lineas.length, 1);
  assert.strictEqual(snap.lineas[0].valor, 900 * 10);
  assert.strictEqual(snap.noContados.length, 2);
  const noContadosIds = snap.noContados.map(function (n) { return n.insumoId; }).sort();
  assert.deepStrictEqual(noContadosIds, ['t1', 'vaso']);
  // el valor del snapshot es solo de lo contado, no del inventario completo
  assert.strictEqual(snap.valorTotal, 9000);
});

test('crearSnapshot tipo conteo usa el costo VIGENTE del insumo, no uno inventado', () => {
  const s = stateConMermas();
  s.materia[0].costo = 12.5; // el costo cambió desde el último snapshot
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 800 }] });
  assert.strictEqual(snap.lineas[0].costoUnitario, 12.5);
  assert.strictEqual(snap.lineas[0].valor, 800 * 12.5);
});

test('getSnapshotMasReciente filtra por tipo y por fecha de corte', () => {
  const s = stateConMermas();
  C.crearSnapshot(s, { tipo: 'sistema', fecha: '2026-08-01T08:00:00' });
  C.crearSnapshot(s, { tipo: 'conteo', fecha: '2026-08-15T08:00:00', conteo: [] });
  C.crearSnapshot(s, { tipo: 'sistema', fecha: '2026-08-20T08:00:00' });
  const masRecienteSistema = C.getSnapshotMasReciente(s, '2026-08-31T00:00:00', 'sistema');
  assert.strictEqual(masRecienteSistema.fecha, '2026-08-20T08:00:00');
  const antesDelConteo = C.getSnapshotMasReciente(s, '2026-08-10T00:00:00', 'sistema');
  assert.strictEqual(antesDelConteo.fecha, '2026-08-01T08:00:00');
  const masRecienteConteo = C.getSnapshotMasReciente(s, '2026-08-31T00:00:00', 'conteo');
  assert.strictEqual(masRecienteConteo.tipo, 'conteo');
});

console.log('\n== P0.2 (Ronda 2): las preparaciones (WIP) se pueden contar ==');

function statePrepContable() {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 1000, costo: 5, minimo: 0 }],
    preparaciones: [{ id: 'masa', nombre: 'Masa', modo: 'directo', cantidad: 800, componentes: [{ tipo: 'materia', refId: 'harina', gramos: 100 }] }]
  });
}

test('crearSnapshot tipo conteo incluye una preparación cuando se cuenta explícitamente', () => {
  const s = statePrepContable();
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [{ insumoTipo: 'preparaciones', insumoId: 'masa', cantidad: 750 }] });
  assert.strictEqual(snap.lineas.length, 1);
  assert.strictEqual(snap.lineas[0].insumoTipo, 'preparaciones');
  assert.strictEqual(snap.lineas[0].cantidad, 750);
  assert.strictEqual(snap.lineas[0].costoUnitario, C.getPreparacionCosto(s, 'masa').costoPorGramo);
});

test('bucketsContados: un conteo que NO tocó preparaciones (habiendo preparaciones registradas) marca ese bucket como no contado, no asume cero', () => {
  const s = statePrepContable();
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [] }); // solo entra vacío, como si esa pestaña nunca se abrió
  assert.strictEqual(snap.bucketsContados.preparaciones, false);
  assert.strictEqual(snap.bucketsContados.materia, false); // tampoco se tocó materia (hay 1 insumo registrado)
});

test('bucketsContados: un bucket SIN insumos registrados en el sistema es trivialmente "contado" (no hay nada que contar)', () => {
  const s = C.migrateState({}); // sin preparaciones ni materia
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [] });
  assert.strictEqual(snap.bucketsContados.preparaciones, true);
  assert.strictEqual(snap.bucketsContados.materia, true);
});

test('bucketsContados: contar preparaciones marca ese bucket como contado', () => {
  const s = statePrepContable();
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [{ insumoTipo: 'preparaciones', insumoId: 'masa', cantidad: 750 }] });
  assert.strictEqual(snap.bucketsContados.preparaciones, true);
});

test('bucketsContados: un snapshot tipo sistema siempre marca los 4 buckets como contados', () => {
  const s = statePrepContable();
  const snap = C.crearSnapshot(s, { tipo: 'sistema' });
  assert.deepStrictEqual(snap.bucketsContados, { materia: true, empaques: true, toppings: true, preparaciones: true });
});

test('noContados también funciona para preparaciones: una preparación no incluida en el conteo aparece listada aparte', () => {
  const s = C.migrateState({
    preparaciones: [
      { id: 'masa', nombre: 'Masa', cantidad: 800, componentes: [] },
      { id: 'salsa', nombre: 'Salsa', cantidad: 200, componentes: [] }
    ]
  });
  const snap = C.crearSnapshot(s, { tipo: 'conteo', conteo: [{ insumoTipo: 'preparaciones', insumoId: 'masa', cantidad: 750 }] });
  assert.strictEqual(snap.noContados.length, 1);
  assert.strictEqual(snap.noContados[0].insumoId, 'salsa');
});

console.log('\n== P0.2 (Ronda 2): previsualizarConteo/cerrarConteo también soportan preparaciones ==');

test('previsualizarConteo BUG encontrado y corregido: antes descartaba en silencio una línea de preparación (getInsumoList no la conocía)', () => {
  const s = statePrepContable(); // masa: cantidad 800
  const preview = C.previsualizarConteo(s, [{ insumoTipo: 'preparaciones', insumoId: 'masa', cantidadContada: 750 }]);
  assert.strictEqual(preview.lineas.length, 1); // antes del fix esto era 0 (.filter(Boolean) se comía el null)
  assert.strictEqual(preview.lineas[0].diferencia, -50);
  assert.strictEqual(preview.lineas[0].costoVigente, C.getPreparacionCosto(s, 'masa').costoPorGramo);
});

test('cerrarConteo BUG encontrado y corregido: antes tiraba "Insumo no encontrado" para una línea de preparación', () => {
  const s = statePrepContable();
  const r = C.cerrarConteo(s, { lineas: [{ insumoTipo: 'preparaciones', insumoId: 'masa', cantidadContada: 750, motivo: 'Merma no registrada' }] });
  assert.strictEqual(s.preparaciones[0].cantidad, 750);
  assert.strictEqual(r.ajustes[0].insumoTipo, 'preparaciones');
  assert.strictEqual(r.ajustes[0].cantidadAjuste, -50);
  const costoEsperado = C.getPreparacionCosto(s, 'masa').costoPorGramo;
  assert.strictEqual(r.ajustes[0].valorAjuste, -50 * costoEsperado);
});

console.log('\n== B2: cierre de conteo físico ==');

test('previsualizarConteo calcula diferencia y valor al costo vigente, sin mutar nada', () => {
  const s = stateConMermas(); // m1: 2900 lo cambiamos abajo a mano, costo 10
  s.materia[0].cantidad = 2900;
  const preview = C.previsualizarConteo(s, [{ insumoTipo: 'materia', insumoId: 'm1', cantidadContada: 2100 }]);
  assert.strictEqual(preview.lineas[0].diferencia, -800);
  assert.strictEqual(preview.lineas[0].valor, -8000);
  assert.strictEqual(preview.lineas[0].requiereMotivo, true);
  assert.strictEqual(preview.totalDiferenciaValor, -8000);
  assert.strictEqual(s.materia[0].cantidad, 2900); // no mutó
});

test('cerrarConteo: sistema dice 2900g, se cuenta 2100g -> ajuste de -800g valorizado, motivo y usuario estampados, stock en 2100', () => {
  const s = stateConMermas();
  s.materia[0].cantidad = 2900;
  s.materia[0].costo = 10;
  const r = C.cerrarConteo(s, {
    usuarioEmail: 'mike@crumbly.co', fecha: '2026-09-08T07:00:00',
    lineas: [{ insumoTipo: 'materia', insumoId: 'm1', cantidadContada: 2100, motivo: 'Merma no registrada' }]
  });
  assert.strictEqual(s.materia[0].cantidad, 2100);
  assert.strictEqual(r.ajustes.length, 1);
  assert.strictEqual(r.ajustes[0].cantidadAjuste, -800);
  assert.strictEqual(r.ajustes[0].valorAjuste, -8000);
  assert.strictEqual(r.ajustes[0].usuarioEmail, 'mike@crumbly.co');
  assert.strictEqual(r.ajustes[0].motivo, 'Merma no registrada');
  assert.strictEqual(s.ajustes.length, 1);
  assert.strictEqual(r.snapshot.tipo, 'conteo');
  assert.strictEqual(r.totalDiferenciaValor, -8000);
});

test('cerrarConteo falla si una línea con diferencia no trae motivo, y no aplica NINGUNA línea (todo o nada)', () => {
  const s = stateConMermas();
  s.materia[0].cantidad = 1000;
  s.toppings[0].cantidad = 30;
  assert.throws(() => {
    C.cerrarConteo(s, {
      usuarioEmail: 'mike@crumbly.co',
      lineas: [
        { insumoTipo: 'materia', insumoId: 'm1', cantidadContada: 900, motivo: 'Error de porcionado' },
        { insumoTipo: 'toppings', insumoId: 't1', cantidadContada: 20 } // diferencia sin motivo
      ]
    });
  }, /motivo/);
  // ninguna línea se aplicó, ni siquiera la que sí traía motivo
  assert.strictEqual(s.materia[0].cantidad, 1000);
  assert.strictEqual(s.toppings[0].cantidad, 30);
  assert.strictEqual(s.ajustes.length, 0);
});

test('cerrarConteo sin diferencia no exige motivo y no crea ajuste, pero sí genera el snapshot', () => {
  const s = stateConMermas();
  const r = C.cerrarConteo(s, { lineas: [{ insumoTipo: 'materia', insumoId: 'm1', cantidadContada: s.materia[0].cantidad }] });
  assert.strictEqual(r.ajustes.length, 0);
  assert.strictEqual(r.snapshot.tipo, 'conteo');
});

console.log('\n== B4 (parcial): valorización y producción de preparaciones (WIP) ==');

function statePrepWIP() {
  return C.migrateState({
    materia: [
      { id: 'harina', nombre: 'Harina', cantidad: 100000, costo: 5, minimo: 0 },
      { id: 'agua', nombre: 'Agua', cantidad: 100000, costo: 0, minimo: 0 }
    ],
    preparaciones: [{
      id: 'masa', nombre: 'Masa', modo: 'directo',
      componentes: [
        { tipo: 'materia', refId: 'harina', gramos: 600 },
        { tipo: 'materia', refId: 'agua', gramos: 400 }
      ]
    }]
  });
}

test('getValorInventario incluye el WIP de preparaciones (costo derivado, no un campo costo propio)', () => {
  const s = statePrepWIP();
  s.preparaciones[0].cantidad = 500; // 500g de masa ya producida, costo $3/g (600*5+400*0)/1000
  const v = C.getValorInventario(s);
  assert.strictEqual(v.preparaciones, 1500);
  assert.strictEqual(v.total, v.materia + v.empaques + v.toppings + 1500);
});

test('crearSnapshot tipo sistema incluye una línea por preparación', () => {
  const s = statePrepWIP();
  s.preparaciones[0].cantidad = 500;
  const snap = C.crearSnapshot(s, { tipo: 'sistema' });
  const linea = snap.lineas.find(l => l.insumoTipo === 'preparaciones');
  assert.ok(linea);
  assert.strictEqual(linea.cantidad, 500);
  assert.strictEqual(linea.valor, 1500);
  assert.strictEqual(snap.valorTotal, C.getValorInventario(s).total);
});

test('producirPreparacion: lote de 8x descuenta las materias primas expandidas y acredita lo obtenido al stock', () => {
  const s = statePrepWIP();
  const r = C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 8, gramosObtenidos: 8000 });
  assert.strictEqual(s.materia[0].cantidad, 100000 - 4800); // harina: 600*8
  assert.strictEqual(s.materia[1].cantidad, 100000 - 3200); // agua: 400*8
  assert.strictEqual(s.preparaciones[0].cantidad, 8000);
  assert.strictEqual(r.gramosTeoricos, 8000);
  assert.strictEqual(r.rendimientoObservado, 100); // obtenidos == teóricos, medido en ESTE lote
});

test('P1.3: producirPreparacion ya NO sobreescribe rendimientoPct — el dato medido queda en el lote, no en la receta', () => {
  const s = statePrepWIP();
  s.preparaciones[0].rendimientoPct = 100; // valor configurado por quien administra la receta
  const r = C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 850 }); // 85% medido en este lote
  assert.strictEqual(s.preparaciones[0].cantidad, 850);
  assert.strictEqual(s.preparaciones[0].rendimientoPct, 100, 'rendimientoPct no cambió solo por producir');
  assert.strictEqual(r.rendimientoObservado, 85, 'lo medido queda registrado en el lote');
});

test('producirPreparacion no cambia el valor total del inventario — solo mueve de un bucket a otro', () => {
  const s = statePrepWIP();
  const antes = C.getValorInventario(s).total;
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 8, gramosObtenidos: 8000 });
  const despues = C.getValorInventario(s).total;
  assert.ok(Math.abs(despues - antes) < 0.001);
});

test('producirPreparacion registra faltante (A2) si no alcanza la materia prima, en vez de perder el déficit', () => {
  const s = statePrepWIP();
  s.materia[0].cantidad = 100; // solo 100g de harina, la receta pide 600*multiplicador
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 500 });
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].faltante, 500); // 600 pedidos - 100 disponibles
});

test('savePreparacion preserva `cantidad` (stock de WIP) al editar la receta — no es una propiedad de la receta', () => {
  const s = statePrepWIP();
  s.preparaciones[0].cantidad = 500;
  C.savePreparacion(s, { id: 'masa', nombre: 'Masa', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'harina', gramos: 700 }] });
  assert.strictEqual(s.preparaciones[0].cantidad, 500);
});

test("registrarMerma con origenTipo 'preparacion' descuenta el WIP 1:1 al costo derivado de la preparación", () => {
  const s = statePrepWIP();
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 8, gramosObtenidos: 8000 }); // rendimiento 100, costo $3/g
  const merma = C.registrarMerma(s, { origenTipo: 'preparacion', origenId: 'masa', cantidad: 8000, motivo: 'Vencido' });
  assert.strictEqual(s.preparaciones[0].cantidad, 0);
  assert.strictEqual(merma.costoUnitario, 3);
  assert.strictEqual(merma.valorTotal, 24000);
  C.eliminarMerma(s, merma.id);
  assert.strictEqual(s.preparaciones[0].cantidad, 8000);
});

console.log('\n== C6/I3: los reportes por período tienen cota superior, no solo inferior ==');

test('getVentasByPeriod excluye una venta con fecha futura al consultar un período pasado', () => {
  const ventas = [
    { fecha: '2026-01-10T10:00:00', total: 1000 },
    { fecha: '2026-03-01T10:00:00', total: 2000 } // "futura" respecto al ref de abajo
  ];
  const enero = C.getVentasByPeriod(ventas, 'mes', '2026-01-15T00:00:00');
  assert.strictEqual(enero.length, 1);
  assert.strictEqual(enero[0].total, 1000);
});

test('getGastosByPeriod y getMermasByPeriod también respetan la cota superior de ref', () => {
  const gastos = [{ fecha: '2026-01-10T10:00:00', monto: 500 }, { fecha: '2026-03-01T10:00:00', monto: 999 }];
  const mermas = [{ fecha: '2026-01-10T10:00:00', valorTotal: 300 }, { fecha: '2026-03-01T10:00:00', valorTotal: 999 }];
  assert.strictEqual(C.getGastosByPeriod(gastos, 'mes', '2026-01-15T00:00:00').length, 1);
  assert.strictEqual(C.getMermasByPeriod(mermas, 'mes', '2026-01-15T00:00:00').length, 1);
});

console.log('\n== C6/I3: fecha futura se rechaza en el origen (venta y merma) ==');

test('applyVenta rechaza una fecha futura en vez de dejarla contaminar los reportes', () => {
  const s = stateBase();
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  assert.throws(() => C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], { fecha: manana }), /futura/);
});

test('registrarMerma rechaza una fecha futura', () => {
  const s = stateConMermas();
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  assert.throws(() => C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 1, motivo: 'Vencido', fecha: manana }), /futura/);
});

test('applyVenta/registrarMerma con fecha de HOY (no futura) siguen funcionando normal', () => {
  const s = stateBase();
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], { fecha: new Date().toISOString() });
  assert.ok(venta);
});

console.log('\n== C6/C10: puerta única de dependencias para borrar un insumo ==');

function statePrepConDependencias() {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 1000, costo: 5, minimo: 0 }],
    empaques: [{ id: 'caja', nombre: 'Caja', cantidad: 50, costo: 200, minimo: 0 }],
    toppings: [{ id: 'choco', nombre: 'Chispas', cantidad: 100, costo: 10, precio: 500, minimo: 0 }],
    preparaciones: [{ id: 'masa', nombre: 'Masa', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'harina', gramos: 100 }] }],
    productos: [
      { id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'preparacion', refId: 'masa', gramos: 100 }], empaquesUsados: [{ empaqueId: 'caja', cantidad: 1 }] },
      // C10: un topping usado DIRECTO como componente de receta (no como
      // "topping suelto" ni adición) — antes ningún chequeo lo detectaba.
      { id: 'p2', nombre: 'Waffle con chispas', precio: 21000, componentes: [{ tipo: 'toppings', refId: 'choco', gramos: 20 }], empaquesUsados: [] }
    ]
  });
}

test('findProductosUsandoInsumo detecta un empaque referenciado en empaquesUsados', () => {
  const s = statePrepConDependencias();
  const usado = C.findProductosUsandoInsumo(s, 'caja');
  assert.strictEqual(usado.productos.length, 1);
  assert.strictEqual(usado.productos[0].id, 'p1');
});

test('findProductosUsandoInsumo detecta un TOPPING usado directo como componente de receta (antes invisible)', () => {
  const s = statePrepConDependencias();
  const usado = C.findProductosUsandoInsumo(s, 'choco');
  assert.strictEqual(usado.productos.length, 1);
  assert.strictEqual(usado.productos[0].id, 'p2');
});

test('findProductosUsandoInsumo también detecta una preparación que referencia la materia directo', () => {
  const s = statePrepConDependencias();
  const usado = C.findProductosUsandoInsumo(s, 'harina');
  assert.strictEqual(usado.preparaciones.length, 1);
  assert.strictEqual(usado.preparaciones[0].id, 'masa');
});

test('findProductosUsandoInsumo no encuentra nada para un insumo sin uso', () => {
  const s = statePrepConDependencias();
  const usado = C.findProductosUsandoInsumo(s, 'no-existe');
  assert.strictEqual(usado.productos.length, 0);
  assert.strictEqual(usado.preparaciones.length, 0);
});

console.log('\n== C1: separar costo de alimento y costo de empaque ==');

function stateProductoConEmpaque() {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 100000, costo: 5, minimo: 0 }],
    empaques: [{ id: 'caja', nombre: 'Caja', cantidad: 1000, costo: 300, minimo: 0 }],
    toppings: [{ id: 'choco', nombre: 'Chispas', cantidad: 1000, costo: 10, precio: 500, minimo: 0 }],
    productos: [{
      id: 'p1', nombre: 'Waffle', precio: 20000, empaqueManual: 50,
      componentes: [
        { tipo: 'materia', refId: 'harina', gramos: 150 },   // 750 alimento
        { tipo: 'toppings', refId: 'choco', gramos: 20 },     // 200 alimento (topping ES comida)
        { tipo: 'empaques', refId: 'caja', gramos: 1 }        // 300 empaque (usado como componente, no empaquesUsados)
      ],
      empaquesUsados: [{ empaqueId: 'caja', cantidad: 1 }]    // 300 empaque más, vía el otro camino
    }]
  });
}

test('getCostoProductoDesglosado: costoAlimento + costoEmpaque === costoTotal, y costoTotal === getCostoProducto (sin romper al llamador actual)', () => {
  const s = stateProductoConEmpaque();
  const p = s.productos[0];
  const d = C.getCostoProductoDesglosado(p, s);
  const totalViejo = C.getCostoProducto(p, s);
  assert.ok(Math.abs(d.costoAlimento + d.costoEmpaque - d.costoTotal) < 0.0001);
  assert.ok(Math.abs(d.costoTotal - totalViejo) < 0.0001);
  // alimento: 150*5 (harina) + 20*10 (choco, ES comida) = 950
  assert.strictEqual(d.costoAlimento, 950);
  // empaque: 50 (empaqueManual) + 1*300 (caja como componente) + 1*300 (empaquesUsados) = 650
  assert.strictEqual(d.costoEmpaque, 650);
});

test('getCostoProducto (la función que ya usan applyVenta/registrarMerma) sigue devolviendo el mismo número de siempre, sin cambiar de firma', () => {
  const s = stateProductoConEmpaque();
  assert.strictEqual(C.getCostoProducto(s.productos[0], s), 1600); // 950 + 650
});

test('getFoodCostPct / getPaperCostPct de un período sobre ventas reales', () => {
  const s = stateProductoConEmpaque();
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  // ingresos 20000, costoTotal 1600 -> foodCostPct = 950/20000, paperCostPct = 650/20000
  const food = C.getFoodCostPct(s, 'mes');
  const paper = C.getPaperCostPct(s, 'mes');
  assert.ok(Math.abs(food - 950 / 20000) < 0.0001);
  assert.ok(Math.abs(paper - 650 / 20000) < 0.0001);
  assert.ok(Math.abs((food + paper) - 1600 / 20000) < 0.0001); // suman el food cost % tradicional (todo mezclado)
});

test('un topping suelto o una adición van 100% a alimento (no tienen empaque propio)', () => {
  const s = stateProductoConEmpaque();
  C.applyVenta(s, [], [{ toppingId: 'choco', qty: 5 }], {});
  const food = C.getFoodCostPct(s, 'mes');
  const paper = C.getPaperCostPct(s, 'mes');
  assert.strictEqual(paper, 0);
  assert.ok(food > 0);
});

console.log('\n== P0.3 (Ronda 2): el desglose alimento/empaque se congela en la venta ==');

test('P0.3: cada ítem nuevo trae costoAlimento + costoEmpaque === costo', () => {
  const s = stateProductoConEmpaque();
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});
  const item = venta.items[0];
  assert.ok(item.costoAlimento !== undefined && item.costoEmpaque !== undefined);
  assert.ok(Math.abs(item.costoAlimento + item.costoEmpaque - item.costo) < 0.0001);
});

test('P0.3 — el bug que esto corrige: cambiar el empaque de la receta DESPUÉS de vender no reescribe el food/paper cost % de esa venta', () => {
  const s = stateProductoConEmpaque();
  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], { fecha: '2026-08-05T00:00:00' });
  const foodAntes = C.getFoodCostPct(s, 'mes', '2026-08-15T00:00:00');
  const paperAntes = C.getPaperCostPct(s, 'mes', '2026-08-15T00:00:00');

  // se cambia la caja de $300 a $900 — el "hallazgo raíz en chico" del encargo
  s.empaques[0].costo = 900;

  const foodDespues = C.getFoodCostPct(s, 'mes', '2026-08-15T00:00:00');
  const paperDespues = C.getPaperCostPct(s, 'mes', '2026-08-15T00:00:00');
  assert.strictEqual(foodDespues, foodAntes);
  assert.strictEqual(paperDespues, paperAntes);
});

test('P0.3: toppings/adiciones se congelan 100% como alimento, sin empaque propio', () => {
  const s = stateProductoConEmpaque();
  const venta = C.applyVenta(s, [], [{ toppingId: 'choco', qty: 5 }], {});
  assert.strictEqual(venta.items[0].costoEmpaque, 0);
  assert.strictEqual(venta.items[0].costoAlimento, venta.items[0].costo);
});

test('P0.3: una venta VIEJA sin costoAlimento/costoEmpaque sigue reportando por el fallback, sin romper', () => {
  const s = stateProductoConEmpaque();
  // simula una venta de antes de esta versión: mismo costo total, sin el desglose propio
  s.ventas.push({ id: 'vOld', fecha: '2026-01-15T00:00:00', total: 1600, ganancia: 18400, stockInsuficiente: false, consumoReal: { materia: {}, empaques: {}, toppings: {} }, items: [{ productoId: 'p1', nombre: 'Waffle', qty: 1, precio: 20000, costo: 1600 }] });
  const food = C.getFoodCostPct(s, 'mes', '2026-01-20T00:00:00');
  const paper = C.getPaperCostPct(s, 'mes', '2026-01-20T00:00:00');
  assert.ok(food > 0 && paper > 0); // no revienta, sigue calculando por el fallback proporcional
});

test('migrateState v10: NO rellena costoAlimento/costoEmpaque en ventas viejas (deuda histórica a propósito, nunca se inventa)', () => {
  const s = C.migrateState({
    schemaVersion: 9,
    ventas: [{ id: 'vOld', fecha: '2026-01-01T00:00:00', total: 1600, ganancia: 1000, items: [{ productoId: 'p1', qty: 1, precio: 1600, costo: 600 }] }]
  });
  assert.strictEqual(s.ventas[0].items[0].costoAlimento, undefined);
  assert.strictEqual(s.ventas[0].items[0].costoEmpaque, undefined);
});

console.log('\n== C2: la merma vive DENTRO del costo de ventas, no debajo de la utilidad bruta ==');

test('C2: la merma ahora resta de la utilidad BRUTA (costo de ventas), no solo de la neta', () => {
  const c = C.computeCascada([{ total: 20000, ganancia: 18750 }], [], 0, 100);
  // costoVentas = (20000-18750) + 100 = 1350 ; utilidadBruta = 20000-1350 = 18650
  assert.strictEqual(c.costoVentas, 1350);
  assert.strictEqual(c.utilidadBruta, 18650);
});

test('C2: el margen bruto % baja EXACTAMENTE en la proporción de la merma sobre ingresos', () => {
  const sinMerma = C.computeCascada([{ total: 20000, ganancia: 18750 }], [], 0, 0);
  const conMerma = C.computeCascada([{ total: 20000, ganancia: 18750 }], [], 0, 100);
  const caidaEsperadaPct = (100 / 20000) * 100;
  assert.ok(Math.abs((sinMerma.margenBrutoPct - conMerma.margenBrutoPct) - caidaEsperadaPct) < 0.0001);
});

test('C2: la utilidad NETA final es idéntica a la fórmula vieja (mermas restando debajo de la bruta) — solo cambió dónde aparece la línea', () => {
  const ingresos = 20000, gananciaVentas = 18750, mermasValor = 100, totalOperativos = 500, depreciacion = 50;
  const utilidadNetaVieja = gananciaVentas - totalOperativos - depreciacion - mermasValor; // fórmula pre-C2
  const c = C.computeCascada([{ total: ingresos, ganancia: gananciaVentas }], [{ tipo: 'operativo', categoria: 'Otros', monto: totalOperativos }], depreciacion, mermasValor);
  assert.strictEqual(c.utilidadNeta, utilidadNetaVieja);
});

console.log('\n== C3: costo laboral y prime cost ==');

function stateConNomina() {
  const s = stateBase(); // p1: 22000, receta 150g m1@5.8 + 1 empaque@2550
  s.materia[0].cantidad = 100000;
  return s;
}

test('migrateState pone factorPrestacional:1.38 por defecto (nunca 1.52 hardcodeado)', () => {
  const s = C.migrateState({});
  assert.strictEqual(s.config.factorPrestacional, 1.38);
});

test('emptyState/migrateState(null) — un usuario NUEVO sin estado previo también trae factorPrestacional:1.38 (bug real: el early-return de migrateState no pasaba por el bloque de defaults)', () => {
  assert.strictEqual(C.emptyState().config.factorPrestacional, 1.38);
  assert.strictEqual(C.migrateState(null).config.factorPrestacional, 1.38);
});

test('getCostoLaboral carga la nómina registrada por el factor prestacional configurado', () => {
  const s = stateConNomina();
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Nómina', monto: 1000000, fecha: '2026-01-10T00:00:00' });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Arriendo', monto: 500000, fecha: '2026-01-10T00:00:00' }); // NO es laboral
  const l = C.getCostoLaboral(s, '2026-01-01', '2026-01-31');
  assert.strictEqual(l.nominaRegistrada, 1000000);
  assert.strictEqual(l.factorPrestacional, 1.38);
  assert.ok(Math.abs(l.costoLaboralCargado - 1380000) < 0.01);
});

test('con factorPrestacional 1.0, el costo laboral cargado equivale a la nómina tal como se registra', () => {
  const s = stateConNomina();
  s.config.factorPrestacional = 1.0;
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Nómina', monto: 800000, fecha: '2026-01-10T00:00:00' });
  const l = C.getCostoLaboral(s, '2026-01-01', '2026-01-31');
  assert.strictEqual(l.costoLaboralCargado, l.nominaRegistrada);
});

test('getPrimeCost = (COGS + costo laboral cargado) / ingresos, y se recalcula al cambiar el factor', () => {
  const s = stateConNomina();
  C.applyVenta(s, [{ productoId: 'p1', qty: 10, toppings: [] }], [], { fecha: '2026-01-05T00:00:00' });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Nómina', monto: 1000000, fecha: '2026-01-10T00:00:00' });
  const p1 = C.getPrimeCost(s, '2026-01-01', '2026-01-31');
  assert.ok(Math.abs(p1.primeCostTotal - (p1.cogs + p1.costoLaboral)) < 0.01);
  assert.ok(Math.abs(p1.primeCostPct - (p1.primeCostTotal / p1.ingresos)) < 0.0001);

  s.config.factorPrestacional = 1.0;
  const p2 = C.getPrimeCost(s, '2026-01-01', '2026-01-31');
  assert.ok(p2.primeCostTotal < p1.primeCostTotal); // bajó el factor, baja el prime cost
  assert.strictEqual(p2.costoLaboral, p2.nominaRegistrada);
});

console.log('\n== C4: comportamiento de costo y punto de equilibrio ==');

function stateBreakEven() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Insumo', cantidad: 1000000, costo: 500, minimo: 0 }],
    productos: [{ id: 'p1', nombre: 'Producto', precio: 1000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 1 }], empaquesUsados: [], empaqueManual: 0 }]
  });
}

test('getComportamientoCategoria: sin clasificar es "fijo" por defecto (el atajo tradicional, nunca "variable" sin confirmarlo)', () => {
  const s = stateBreakEven();
  assert.deepStrictEqual(C.getComportamientoCategoria(s, 'Arriendo'), { comportamiento: 'fijo', pctVariable: 0 });
});

test('getCostosFijosYVariables separa fijo/variable/mixto según la config', () => {
  const s = stateBreakEven();
  s.config.comportamientoCategorias = {
    Arriendo: { comportamiento: 'fijo' },
    Publicidad: { comportamiento: 'variable' },
    Servicios: { comportamiento: 'mixto', pctVariable: 0.4 }
  };
  const gastos = [
    { categoria: 'Arriendo', monto: 1000 },
    { categoria: 'Publicidad', monto: 500 },
    { categoria: 'Servicios', monto: 1000 } // 400 variable, 600 fijo
  ];
  const c = C.getCostosFijosYVariables(s, gastos);
  assert.strictEqual(c.fijo, 1000 + 600);
  assert.strictEqual(c.variableMonto, 500 + 400);
});

test('getCMPonderado: CM ponderado por volumen, en pesos y en ratio', () => {
  const s = stateBreakEven();
  C.applyVenta(s, [{ productoId: 'p1', qty: 10, toppings: [] }], [], {}); // CM unitario = 1000-500=500
  const cm = C.getCMPonderado(s, s.ventas);
  assert.strictEqual(cm.cmPromedioPesos, 500);
  assert.strictEqual(cm.cmPromedioRatio, 0.5);
});

test('C4 — OJO: tratar todo lo operativo como fijo NO siempre subestima el punto de equilibrio (verifica la DIRECCIÓN, no una heurística fija)', () => {
  // Fijo real=3000, variable real=1000 (categoría "Publicidad"), sin
  // depreciación. CM ratio bruto = 0.5 (precio 1000, costo 500).
  // Atajo (todo fijo): naive = (3000+1000)/0.5 = 8000.
  function build(qty) {
    const s = stateBreakEven();
    s.config.comportamientoCategorias = { Arriendo: { comportamiento: 'fijo' }, Publicidad: { comportamiento: 'variable' } };
    C.applyVenta(s, [{ productoId: 'p1', qty, toppings: [] }], [], { fecha: '2026-02-10T00:00:00' });
    C.registrarGasto(s, { tipo: 'operativo', categoria: 'Arriendo', monto: 3000, fecha: '2026-02-10T00:00:00' });
    C.registrarGasto(s, { tipo: 'operativo', categoria: 'Publicidad', monto: 1000, fecha: '2026-02-10T00:00:00' });
    return s;
  }
  const naive = 8000; // calculado a mano arriba — el mismo para ambos escenarios

  // Escenario deficitario: ingresos (5000) por debajo del propio break-even correcto.
  const sDeficit = build(5); // 5 unidades × 1000 = 5000 de ingresos
  const beDeficit = C.getBreakEven(sDeficit, '2026-02-01', '2026-02-28');
  assert.ok(5000 < beDeficit.bepContable, 'el escenario debe estar realmente por debajo de SU PROPIO punto de equilibrio');
  assert.ok(naive < beDeficit.bepContable, 'deficitario: el atajo (todo fijo) SUBESTIMA el punto de equilibrio real');

  // Escenario rentable: ingresos (20000) por encima del propio break-even correcto.
  const sRentable = build(20); // 20 unidades × 1000 = 20000 de ingresos
  const beRentable = C.getBreakEven(sRentable, '2026-02-01', '2026-02-28');
  assert.ok(20000 > beRentable.bepContable, 'el escenario debe estar realmente por encima de SU PROPIO punto de equilibrio');
  assert.ok(naive > beRentable.bepContable, 'rentable: el atajo (todo fijo) SOBREESTIMA el punto de equilibrio real');
});

test('getBreakEven: bepCaja usa el capex completo del período (sin depreciación); bepContable usa la depreciación (sin capex)', () => {
  const s = stateBreakEven();
  C.applyVenta(s, [{ productoId: 'p1', qty: 20, toppings: [] }], [], { fecha: '2026-03-10T00:00:00' });
  C.registrarGasto(s, { tipo: 'operativo', categoria: 'Arriendo', monto: 3000, fecha: '2026-03-10T00:00:00' });
  C.registrarGasto(s, { tipo: 'capex', categoria: 'Equipos de cocina', monto: 12000, vidaUtilMeses: 12, fecha: '2026-03-10T00:00:00' });
  const be = C.getBreakEven(s, '2026-03-01', '2026-03-31');
  assert.ok(be.capexPeriodo === 12000);
  assert.ok(be.depreciacion > 0 && be.depreciacion < 12000); // prorrateado, no el capex completo
  assert.notStrictEqual(be.bepCaja, be.bepContable);
});

console.log('\n== C5: Menu Engineering (Kasavana & Smith) ==');

function stateMenuEngineering() {
  return C.migrateState({
    materia: [{ id: 'ins', nombre: 'Insumo', cantidad: 10000000, costo: 1, minimo: 0 }],
    productos: [
      { id: 'x1', nombre: 'Limonada', categoria: 'Bebidas', precio: 1000, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 500 }], empaquesUsados: [], empaqueManual: 0 },
      { id: 'y1', nombre: 'Té frío', categoria: 'Bebidas', precio: 1200, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 600 }], empaquesUsados: [], empaqueManual: 0 },
      { id: 'z1', nombre: 'Torta', categoria: 'Postres', precio: 8000, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 3000 }], empaquesUsados: [], empaqueManual: 0 },
      { id: 'w1', nombre: 'Cheesecake', categoria: 'Postres', precio: 9000, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 3000 }], empaquesUsados: [], empaqueManual: 0 }
    ]
  });
}

test('C5 — un producto barato de alta rotación en SU categoría es "estrella", no "perro", aunque otra categoría tenga CM 10x mayor', () => {
  const s = stateMenuEngineering();
  // Bebidas: x1 CM=500 (mix 20%, baja rotación) ; y1 CM=600 (mix 80%, alta rotación)
  C.applyVenta(s, [{ productoId: 'x1', qty: 20, toppings: [] }], [], {});
  C.applyVenta(s, [{ productoId: 'y1', qty: 80, toppings: [] }], [], {});
  // Postres: z1 CM=5000 (mix 50%) ; w1 CM=6000 (mix 50%) — 10x más rentables en pesos absolutos
  C.applyVenta(s, [{ productoId: 'z1', qty: 5, toppings: [] }], [], {});
  C.applyVenta(s, [{ productoId: 'w1', qty: 5, toppings: [] }], [], {});

  const menu = C.getMenuEngineering(s, s.ventas);
  const porId = Object.fromEntries(menu.map(m => [m.productoId, m]));

  // y1: dentro de Bebidas es popular (80% >> 35%) y rentable (600 >= 550 promedio de su categoría)
  assert.strictEqual(porId.y1.clasificacion, 'estrella');
  // x1: dentro de Bebidas, baja rotación (20% < 35%) y por debajo del promedio de SU categoría -> perro
  assert.strictEqual(porId.x1.clasificacion, 'perro');
  // Postres, mismo patrón pero con cifras 10x mayores
  assert.strictEqual(porId.w1.clasificacion, 'estrella');
  assert.strictEqual(porId.z1.clasificacion, 'caballo de batalla'); // popular pero bajo el promedio de SU categoría
});

test('C5: agrupa por productoId, nunca por nombre — dos productos con el mismo nombre en categorías distintas no se mezclan', () => {
  const s = C.migrateState({
    materia: [{ id: 'ins', nombre: 'Insumo', cantidad: 1000000, costo: 1, minimo: 0 }],
    productos: [
      { id: 'a1', nombre: 'Waffle', categoria: 'Desayuno', precio: 5000, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 },
      { id: 'b1', nombre: 'Waffle', categoria: 'Postres', precio: 9000, componentes: [{ tipo: 'materia', refId: 'ins', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 }
    ]
  });
  C.applyVenta(s, [{ productoId: 'a1', qty: 10, toppings: [] }], [], {});
  C.applyVenta(s, [{ productoId: 'b1', qty: 10, toppings: [] }], [], {});
  const menu = C.getMenuEngineering(s, s.ventas);
  assert.strictEqual(menu.length, 2);
  assert.deepStrictEqual(menu.map(m => m.productoId).sort(), ['a1', 'b1']);
});

test('C5: umbral de popularidad es (1/N) × 0,70 dentro de la categoría', () => {
  const s = stateMenuEngineering();
  C.applyVenta(s, [{ productoId: 'x1', qty: 20, toppings: [] }], [], {});
  C.applyVenta(s, [{ productoId: 'y1', qty: 80, toppings: [] }], [], {});
  const menu = C.getMenuEngineering(s, s.ventas);
  const bebidas = menu.filter(m => m.categoria === 'Bebidas');
  assert.ok(Math.abs(bebidas[0].umbralPopularidad - 0.35) < 0.0001); // (1/2)*0.7
});

console.log('\n== D1: getVarianza (consumo real vs. teórico, snapshots sintéticos) ==');

function stateVarianza() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 3000, costo: 10, minimo: 0 }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 }]
  });
}

test('getVarianza: caso completo (compra + venta teórica + merma) da la varianza correcta sin doble conteo', () => {
  const s = stateVarianza();
  const inicioISO = '2026-09-01T00:00:00';
  const finISO = '2026-09-08T00:00:00';
  C.crearSnapshot(s, { tipo: 'conteo', fecha: inicioISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }] });
  // compra de 1000g a $10/g exactos (no mueve el promedio ponderado)
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 10000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000, fecha: '2026-09-03T00:00:00' });
  // venta: 15 unidades × 100g = 1500g teóricos
  C.applyVenta(s, [{ productoId: 'p1', qty: 15, toppings: [] }], [], { fecha: '2026-09-04T00:00:00' });
  // merma directa de 200g, ya registrada
  C.registrarMerma(s, { origenTipo: 'materia', origenId: 'm1', cantidad: 200, motivo: 'Vencido', fecha: '2026-09-05T00:00:00' });
  // el conteo físico final encuentra 2000g (independiente de lo que el
  // sistema calcule con lo de arriba: 3000+1000-1500-200=2300 — la
  // diferencia de 300g es exactamente la varianza no explicada)
  C.crearSnapshot(s, { tipo: 'conteo', fecha: finISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 }] });

  const v = C.getVarianza(s, inicioISO, finISO);
  assert.strictEqual(v.suficiente, true);
  assert.strictEqual(v.lineas.length, 1);
  const l = v.lineas[0];
  assert.strictEqual(l.consumoReal, 2000); // 3000 + 1000 - 2000
  assert.strictEqual(l.mermaRegistrada, 200);
  assert.strictEqual(l.consumoTeorico, 1500);
  assert.strictEqual(l.varianzaCantidad, 300); // 2000 - 200 - 1500
  assert.strictEqual(l.varianzaValor, 3000); // 300 × $10/g vigente
  assert.ok(Math.abs(l.varianzaPct - 0.2) < 0.0001); // 300/1500
});

test('D1 GUARDA CRÍTICA: con dos snapshots de tipo "sistema" (no "conteo"), la varianza se rehúsa a calcular en vez de dar cero', () => {
  const s = stateVarianza();
  const inicioISO = '2026-09-01T00:00:00';
  const finISO = '2026-09-08T00:00:00';
  C.crearSnapshot(s, { tipo: 'sistema', fecha: inicioISO });
  C.registrarGasto(s, { tipo: 'inventario', categoria: 'Materia prima', monto: 10000, insumoTipo: 'materia', insumoId: 'm1', cantidad: 1000, fecha: '2026-09-03T00:00:00' });
  C.applyVenta(s, [{ productoId: 'p1', qty: 15, toppings: [] }], [], { fecha: '2026-09-04T00:00:00' });
  C.crearSnapshot(s, { tipo: 'sistema', fecha: finISO });

  const v = C.getVarianza(s, inicioISO, finISO);
  assert.strictEqual(v.suficiente, false);
  assert.ok(/sistema/.test(v.motivo));
  assert.strictEqual(v.lineas, undefined); // nunca un número — ni siquiera un array vacío que se pueda confundir con "sin varianza"
});

test('D1: un snapshot inicial de conteo + uno final de sistema también se rehúsa (basta con que UNO sea de sistema)', () => {
  const s = stateVarianza();
  C.crearSnapshot(s, { tipo: 'conteo', fecha: '2026-09-01T00:00:00', conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }] });
  C.crearSnapshot(s, { tipo: 'sistema', fecha: '2026-09-08T00:00:00' });
  const v = C.getVarianza(s, '2026-09-01T00:00:00', '2026-09-08T00:00:00');
  assert.strictEqual(v.suficiente, false);
});

test('D1: sin ningún snapshot en el rango, se rehúsa (no inventa un cero)', () => {
  const s = stateVarianza();
  const v = C.getVarianza(s, '2026-09-01T00:00:00', '2026-09-08T00:00:00');
  assert.strictEqual(v.suficiente, false);
});

test('D1: un insumo que falta en el snapshot inicial (o el final) se excluye del reporte y se lista aparte, nunca en cero', () => {
  const s = stateVarianza();
  s.empaques.push({ id: 'vaso', nombre: 'Vaso', cantidad: 500, costo: 200, minimo: 0 });
  const inicioISO = '2026-09-01T00:00:00', finISO = '2026-09-08T00:00:00';
  // inicial: solo se contó materia, no empaques (conteo parcial, "materia hoy, toppings mañana")
  C.crearSnapshot(s, { tipo: 'conteo', fecha: inicioISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }] });
  // final: ahora sí se cuentan ambos
  C.crearSnapshot(s, { tipo: 'conteo', fecha: finISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }, { insumoTipo: 'empaques', insumoId: 'vaso', cantidad: 480 }] });
  const v = C.getVarianza(s, inicioISO, finISO);
  assert.strictEqual(v.suficiente, true);
  assert.strictEqual(v.lineas.length, 1); // solo materia, que sí está en AMBOS
  assert.strictEqual(v.lineas[0].insumoId, 'm1');
  assert.strictEqual(v.noContados.length, 1);
  assert.strictEqual(v.noContados[0].insumoId, 'vaso');
});

test('D1: las líneas quedan ordenadas por varianza en pesos, descendente', () => {
  const s = C.migrateState({
    materia: [
      { id: 'a', nombre: 'A', cantidad: 100, costo: 1, minimo: 0 },
      { id: 'b', nombre: 'B', cantidad: 100, costo: 100, minimo: 0 }
    ]
  });
  const inicioISO = '2026-09-01T00:00:00', finISO = '2026-09-08T00:00:00';
  C.crearSnapshot(s, { tipo: 'conteo', fecha: inicioISO, conteo: [{ insumoTipo: 'materia', insumoId: 'a', cantidad: 100 }, { insumoTipo: 'materia', insumoId: 'b', cantidad: 100 }] });
  // "a" pierde 50 unidades a $1 = $50 de varianza ; "b" pierde 10 unidades a $100 = $1000 de varianza
  C.crearSnapshot(s, { tipo: 'conteo', fecha: finISO, conteo: [{ insumoTipo: 'materia', insumoId: 'a', cantidad: 50 }, { insumoTipo: 'materia', insumoId: 'b', cantidad: 90 }] });
  const v = C.getVarianza(s, inicioISO, finISO);
  assert.strictEqual(v.lineas[0].insumoId, 'b'); // mayor varianza en pesos primero
  assert.strictEqual(v.lineas[1].insumoId, 'a');
});

console.log('\n== D2: Actual vs Theoretical (food cost real % vs teórico %) ==');

function stateAvT() {
  return C.migrateState({
    materia: [{ id: 'm1', nombre: 'Nutella', cantidad: 3000, costo: 10, minimo: 0 }],
    empaques: [{ id: 'caja', nombre: 'Caja', cantidad: 1000, costo: 5, minimo: 0 }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 2000, componentes: [{ tipo: 'materia', refId: 'm1', gramos: 100 }], empaquesUsados: [{ empaqueId: 'caja', cantidad: 1 }], empaqueManual: 0 }]
  });
}

test('getActualVsTheoretical: real > teórico cuando hay varianza (pérdida no explicada) — diferencia en puntos y en ratio', () => {
  const s = stateAvT();
  const inicioISO = '2026-09-01T00:00:00', finISO = '2026-09-08T00:00:00';
  C.crearSnapshot(s, { tipo: 'conteo', fecha: inicioISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }] });
  // 15 unidades × 2000 = 30000 de ingresos ; teórico: 1500g de nutella ($10/g)=$15000, foodCostTeorico=15000/30000=50%
  C.applyVenta(s, [{ productoId: 'p1', qty: 15, toppings: [] }], [], { fecha: '2026-09-04T00:00:00' });
  // conteo final: solo quedan 1300g -> consumoReal = 3000-1300 = 1700g ($17000), foodCostReal = 17000/30000 ≈ 56.7%
  C.crearSnapshot(s, { tipo: 'conteo', fecha: finISO, conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 1300 }] });

  const avt = C.getActualVsTheoretical(s, inicioISO, finISO);
  assert.strictEqual(avt.suficiente, true);
  assert.ok(Math.abs(avt.foodCostTeoricoPct - 0.5) < 0.0001);
  assert.ok(Math.abs(avt.foodCostRealPct - (17000 / 30000)) < 0.0001);
  assert.ok(avt.diferenciaPuntos > 0); // real por encima del teórico: hay pérdida sin explicar
  assert.ok(Math.abs(avt.diferenciaPuntos - (avt.foodCostRealPct - avt.foodCostTeoricoPct) * 100) < 0.0001);
  assert.ok(Math.abs(avt.diferenciaRatio - (avt.foodCostRealPct - avt.foodCostTeoricoPct) / avt.foodCostTeoricoPct) < 0.0001);
});

test('getActualVsTheoretical hereda la guarda de D1: sin snapshots de conteo suficientes, no calcula nada', () => {
  const s = stateAvT();
  const avt = C.getActualVsTheoretical(s, '2026-09-01T00:00:00', '2026-09-08T00:00:00');
  assert.strictEqual(avt.suficiente, false);
  assert.strictEqual(avt.foodCostRealPct, undefined);
});

test('getActualVsTheoreticalHistorico arma un punto por cada par consecutivo de snapshots de conteo', () => {
  const s = stateAvT();
  C.crearSnapshot(s, { tipo: 'conteo', fecha: '2026-08-01T00:00:00', conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 3000 }] });
  C.applyVenta(s, [{ productoId: 'p1', qty: 5, toppings: [] }], [], { fecha: '2026-08-04T00:00:00' });
  C.crearSnapshot(s, { tipo: 'conteo', fecha: '2026-08-08T00:00:00', conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 2500 }] });
  C.applyVenta(s, [{ productoId: 'p1', qty: 5, toppings: [] }], [], { fecha: '2026-08-10T00:00:00' });
  C.crearSnapshot(s, { tipo: 'conteo', fecha: '2026-08-15T00:00:00', conteo: [{ insumoTipo: 'materia', insumoId: 'm1', cantidad: 2000 }] });

  const serie = C.getActualVsTheoreticalHistorico(s);
  assert.strictEqual(serie.length, 2); // 3 snapshots -> 2 pares consecutivos
  assert.strictEqual(serie[0].inicio, '2026-08-01T00:00:00');
  assert.strictEqual(serie[0].fin, '2026-08-08T00:00:00');
  assert.strictEqual(serie[1].inicio, '2026-08-08T00:00:00');
  assert.strictEqual(serie[1].fin, '2026-08-15T00:00:00');
  serie.forEach(p => assert.strictEqual(p.suficiente, true));
});

console.log('\n== P1.1 (Ronda 2): parámetro de modo en aplicarComponentes ==');

function statePrepStock(cantidadPrep) {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 1000000, costo: 5, minimo: 0 }],
    preparaciones: [{ id: 'masa', nombre: 'Masa', modo: 'directo', cantidad: cantidadPrep, componentes: [{ tipo: 'materia', refId: 'harina', gramos: 100 }] }]
  });
}
function expandirParaTest(s, modo) {
  const consumo = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };
  function add(bucket, id, cant) { consumo[bucket][id] = (consumo[bucket][id] || 0) + cant; }
  C.aplicarComponentes(s, [{ tipo: 'preparacion', refId: 'masa', gramos: 500 }], 1, add, { modo });
  return consumo;
}

test('modo "crudo" (default) siempre expande hasta materia prima, nunca toca el bucket de preparaciones', () => {
  const s = statePrepStock(1000); // hay stock de sobra, pero en modo crudo no importa
  const consumo = expandirParaTest(s, 'crudo');
  assert.strictEqual(consumo.preparaciones.masa, undefined);
  assert.strictEqual(consumo.materia.harina, 500); // 500g pedidos = 5x la receta base (100g) -> 500g de harina
});

test('modo "stock" con stock suficiente descuenta TODO de la preparación, nada de materia prima', () => {
  const s = statePrepStock(1000);
  const consumo = expandirParaTest(s, 'stock');
  assert.strictEqual(consumo.preparaciones.masa, 500);
  assert.strictEqual(consumo.materia.harina, undefined);
});

test('modo "stock" con stock PARCIAL (200g de 500g pedidos) reparte: 200g de la preparación + 300g expandidos a materia prima', () => {
  const s = statePrepStock(200);
  const consumo = expandirParaTest(s, 'stock');
  assert.strictEqual(consumo.preparaciones.masa, 200);
  assert.strictEqual(consumo.materia.harina, 300); // 300g de masa faltantes = 3x100g de harina
});

test('CRITERIO: sin stock de preparación, "crudo" y "stock" dan resultados IDÉNTICOS', () => {
  const s = statePrepStock(0);
  const crudo = expandirParaTest(s, 'crudo');
  const stock = expandirParaTest(s, 'stock');
  assert.deepStrictEqual(crudo.materia, stock.materia);
  assert.strictEqual(stock.preparaciones.masa, undefined);
});

test('CRITERIO: con stock de preparación, "crudo" y "stock" dan resultados DISTINTOS', () => {
  const s = statePrepStock(1000);
  const crudo = expandirParaTest(s, 'crudo');
  const stock = expandirParaTest(s, 'stock');
  assert.notDeepStrictEqual(crudo, stock);
});

test('NO-REGRESIÓN: getConsumptionRolling da exactamente lo mismo con o sin stock de preparación (usa modo "crudo" explícito)', () => {
  const sSinStock = statePrepStock(0);
  const sConStock = statePrepStock(5000);
  const producto = { id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'preparacion', refId: 'masa', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 };
  const venta = { id: 'v1', fecha: '2026-08-01T00:00:00', total: 20000, items: [{ productoId: 'p1', qty: 1, precio: 20000, costo: 500 }] };
  sSinStock.productos = [producto]; sSinStock.ventas = [Object.assign({}, venta)];
  sConStock.productos = [Object.assign({}, producto)]; sConStock.ventas = [Object.assign({}, venta)];

  const consumoSinStock = C.getConsumptionRolling(sSinStock, 30, '2026-08-15T00:00:00');
  const consumoConStock = C.getConsumptionRolling(sConStock, 30, '2026-08-15T00:00:00');
  assert.deepStrictEqual(consumoSinStock, consumoConStock);
  assert.strictEqual(consumoConStock.materia.harina, 100); // siempre expande a materia, tenga o no stock la preparación
});

console.log('\n== P1.2 (Ronda 2): consumo parcial y faltante de preparación ==');

function statePrepVenta(cantidadPrep) {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 100000, costo: 5, minimo: 0 }],
    preparaciones: [{ id: 'masa', nombre: 'Masa', modo: 'directo', cantidad: cantidadPrep, componentes: [{ tipo: 'materia', refId: 'harina', gramos: 100 }] }],
    productos: [{ id: 'p1', nombre: 'Waffle', precio: 20000, componentes: [{ tipo: 'preparacion', refId: 'masa', gramos: 100 }], empaquesUsados: [], empaqueManual: 0 }]
  });
}

test('REGRESIÓN DE P0.1 (ya corregida): producir un lote y vender el producto descuenta la materia prima UNA sola vez', () => {
  const s = statePrepVenta(0);
  const cantidadInicial = s.materia[0].cantidad;
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 100 });
  assert.strictEqual(s.materia[0].cantidad, cantidadInicial - 100);
  assert.strictEqual(s.preparaciones[0].cantidad, 100);

  C.applyVenta(s, [{ productoId: 'p1', qty: 1, toppings: [] }], [], {});

  assert.strictEqual(cantidadInicial - s.materia[0].cantidad, 100, 'la harina se descontó una sola vez, no dos');
  assert.strictEqual(s.preparaciones[0].cantidad, 0, 'el stock de la preparación bajó al venderse');
});

test('CRITERIO: 200g de salsa en stock, venta que pide 500g -> la preparación queda en 0 y la materia prima se descuenta SOLO por los 300g faltantes', () => {
  const s = statePrepVenta(200);
  const harinaAntes = s.materia[0].cantidad;
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 5, toppings: [] }], [], {}); // 5 × 100g = 500g de masa pedidos
  assert.strictEqual(s.preparaciones[0].cantidad, 0);
  assert.strictEqual(harinaAntes - s.materia[0].cantidad, 300); // 3x100g de harina, solo por el resto
  assert.strictEqual(venta.consumoReal.preparaciones.masa, 200);
  assert.strictEqual(venta.consumoReal.materia.harina, 300);
});

test('revertVenta deshace los DOS niveles: repone el stock de la preparación Y la materia prima consumida por el resto', () => {
  const s = statePrepVenta(200);
  const harinaAntes = s.materia[0].cantidad;
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 5, toppings: [] }], [], {});
  C.revertVenta(s, venta);
  assert.strictEqual(s.preparaciones[0].cantidad, 200);
  assert.strictEqual(s.materia[0].cantidad, harinaAntes);
});

test('si tampoco alcanza la materia prima, el excedente va a `faltante` de materia (misma mecánica de A2)', () => {
  const s = statePrepVenta(200);
  s.materia[0].cantidad = 250; // solo alcanza para 2.5x100g, la venta pide 3x100g (el resto tras la preparación)
  const venta = C.applyVenta(s, [{ productoId: 'p1', qty: 5, toppings: [] }], [], { stockInsuficiente: true }); // 500g pedidos: 200 de prep + 300 de materia, pero solo hay 250
  assert.strictEqual(s.preparaciones[0].cantidad, 0);
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].faltante, 50); // 300 pedidos - 250 disponibles
  C.revertVenta(s, venta);
  assert.strictEqual(s.materia[0].faltante, 0);
  assert.strictEqual(s.materia[0].cantidad, 250);
  assert.strictEqual(s.preparaciones[0].cantidad, 200);
});

test('registrarMerma de un producto (origen "producto") también usa modo stock: consume primero la preparación', () => {
  const s = statePrepVenta(200);
  const merma = C.registrarMerma(s, { origenTipo: 'producto', origenId: 'p1', cantidad: 5, motivo: 'Quemado' }); // 500g de masa
  assert.strictEqual(s.preparaciones[0].cantidad, 0);
  assert.strictEqual(merma.consumoReal.preparaciones.masa, 200);
  assert.strictEqual(merma.consumoReal.materia.harina, 300);
  C.eliminarMerma(s, merma.id);
  assert.strictEqual(s.preparaciones[0].cantidad, 200);
});

test('migrateState pone faltante:0 en preparaciones viejas que no lo tenían', () => {
  const s = C.migrateState({ preparaciones: [{ id: 'p1', nombre: 'Vieja', modo: 'directo', componentes: [] }] });
  assert.strictEqual(s.preparaciones[0].faltante, 0);
});

test('savePreparacion preserva `faltante` (no solo `cantidad`) al editar la receta', () => {
  const s = statePrepVenta(200);
  s.preparaciones[0].faltante = 30;
  C.savePreparacion(s, { id: 'masa', nombre: 'Masa', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'harina', gramos: 90 }] });
  assert.strictEqual(s.preparaciones[0].faltante, 30);
});

console.log('\n== P1.3 (Ronda 2): bitácora de lotes ==');

function statePrepLotes() {
  return C.migrateState({
    materia: [{ id: 'harina', nombre: 'Harina', cantidad: 100000, costo: 5, minimo: 0 }],
    preparaciones: [{ id: 'masa', nombre: 'Masa', modo: 'directo', componentes: [{ tipo: 'materia', refId: 'harina', gramos: 100 }] }]
  });
}

test('CRITERIO: producir tres lotes deja tres registros con su consumo real', () => {
  const s = statePrepLotes();
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 100 });
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 95 });
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 90 });
  assert.strictEqual(s.lotes.length, 3);
  s.lotes.forEach(l => assert.strictEqual(l.consumoReal.materia.harina, 100));
  assert.strictEqual(s.preparaciones[0].cantidad, 100 + 95 + 90);
  assert.strictEqual(s.materia[0].cantidad, 100000 - 300);
});

test('CRITERIO: eliminar el lote del MEDIO revierte exactamente su consumo y su stock, sin tocar los otros dos', () => {
  const s = statePrepLotes();
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 100 });
  const l2 = C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 95 });
  C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 90 });

  const harinaAntes = s.materia[0].cantidad;
  const prepAntes = s.preparaciones[0].cantidad;
  C.eliminarLote(s, l2.id);

  assert.strictEqual(s.lotes.length, 2);
  assert.deepStrictEqual(s.lotes.map(l => l.gramosObtenidos), [100, 90]); // los otros dos intactos
  assert.strictEqual(s.materia[0].cantidad, harinaAntes + 100); // repuso exactamente los 100g que consumió el lote 2
  assert.strictEqual(s.preparaciones[0].cantidad, prepAntes - 95); // le quita exactamente los 95g que había acreditado
});

test('CRITERIO: rendimientoPct no cambia solo por producir (ni por eliminar un lote)', () => {
  const s = statePrepLotes();
  s.preparaciones[0].rendimientoPct = 100;
  const l = C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 70 });
  assert.strictEqual(s.preparaciones[0].rendimientoPct, 100);
  C.eliminarLote(s, l.id);
  assert.strictEqual(s.preparaciones[0].rendimientoPct, 100);
});

test('eliminarLote revierte también el faltante que ese lote haya generado', () => {
  const s = statePrepLotes();
  s.materia[0].cantidad = 60; // solo alcanza para 60g de los 100g que pide el lote
  const l = C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: 60 });
  assert.strictEqual(s.materia[0].cantidad, 0);
  assert.strictEqual(s.materia[0].faltante, 40);
  C.eliminarLote(s, l.id);
  assert.strictEqual(s.materia[0].cantidad, 60);
  assert.strictEqual(s.materia[0].faltante, 0);
  assert.strictEqual(s.preparaciones[0].cantidad, 0);
});

test('getPromedioRendimientoObservado: promedio de los últimos 5 lotes, más reciente primero', () => {
  const s = statePrepLotes();
  const fechas = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'];
  const obtenidos = [100, 90, 80, 70, 60, 50]; // rendimientos: 100,90,80,70,60,50 %
  fechas.forEach((f, i) => C.producirPreparacion(s, { preparacionId: 'masa', multiplicador: 1, gramosObtenidos: obtenidos[i], fecha: f + 'T00:00:00' }));
  // los últimos 5 (excluye el primero, 100%): 90,80,70,60,50 -> promedio 70
  const promedio = C.getPromedioRendimientoObservado(s, 'masa', 5);
  assert.ok(Math.abs(promedio - 70) < 0.0001);
});

test('getPromedioRendimientoObservado devuelve null si no hay lotes de esa preparación', () => {
  const s = statePrepLotes();
  assert.strictEqual(C.getPromedioRendimientoObservado(s, 'masa'), null);
});

test('migrateState agrega lotes:[] a un estado viejo sin romper nada', () => {
  const s = C.migrateState({ materia: [] });
  assert.deepStrictEqual(s.lotes, []);
});

console.log('\n== Resumen ==');
console.log(`${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed > 0 ? 1 : 0);

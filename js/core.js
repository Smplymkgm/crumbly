/**
 * Crumbly — lógica de negocio central, sin DOM.
 * Se carga en el navegador como <script src="js/core.js"> (expone window.CrumblyCore)
 * y en Node vía require('./core.js') para tests (tests/core.test.js).
 *
 * Toda fórmula de costeo/inventario/período vive aquí — nunca duplicada inline
 * en index.html. Ver HANDOFF.md §20.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.CrumblyCore = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 7;

  // decisión del 11 ago 2026: insumos de precio volátil llevan un +8% de
  // colchón al registrar su compra, para no subcostear cuando el proveedor
  // sube de precio entre compras. Insumos NO marcados como variables se
  // ajustan por IPC — a partir de 2027, todavía no implementado.
  var MARGEN_VARIABILIDAD_PCT = 0.08;

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ─── Formato ───────────────────────────────────────────────

  function formatCOP(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var sign = v < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(v)).toLocaleString('es-CO');
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Períodos (P1-2, decisión: semana empieza LUNES) ───────

  // 'dia' | 'semana' | 'mes' | 'anio'
  function getDateStart(period, ref) {
    var s = ref ? new Date(ref) : new Date();
    if (period === 'dia') {
      s.setHours(0, 0, 0, 0);
    } else if (period === 'semana') {
      var day = s.getDay(); // 0=domingo..6=sábado
      var diffToMonday = (day + 6) % 7; // lunes=0
      s.setDate(s.getDate() - diffToMonday);
      s.setHours(0, 0, 0, 0);
    } else if (period === 'mes') {
      s.setDate(1);
      s.setHours(0, 0, 0, 0);
    } else if (period === 'anio') {
      s.setMonth(0, 1);
      s.setHours(0, 0, 0, 0);
    }
    return s;
  }

  function getPeriodLabel(period) {
    return { dia: 'Hoy', semana: 'Esta semana', mes: 'Este mes', anio: 'Este año' }[period] || period;
  }

  function getPeriodRangeLabel(period, ref) {
    var start = getDateStart(period, ref);
    var end = ref ? new Date(ref) : new Date();
    var fmt = function (d) { return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); };
    return fmt(start) + ' – ' + fmt(end);
  }

  function getVentasByPeriod(ventas, period, ref) {
    var start = getDateStart(period, ref);
    return (ventas || []).filter(function (v) { return new Date(v.fecha) >= start; });
  }

  // Ventana móvil de N días (por defecto 7) — reemplaza el sesgo de "semana
  // calendario en curso" (P1-2): un lunes por la mañana ya no muestra
  // consumo cero.
  function getVentasRolling(ventas, days, ref) {
    var end = ref ? new Date(ref) : new Date();
    var start = new Date(end);
    start.setDate(start.getDate() - (days || 7));
    return (ventas || []).filter(function (v) {
      var f = new Date(v.fecha);
      return f >= start && f <= end;
    });
  }

  // Ingresos por día de los últimos `days` días (incluye hoy), en orden
  // cronológico — para la gráfica de barras del Dashboard (rediseño). Cada
  // punto trae la fecha local (YYYY-MM-DD) para no repetir el cálculo de
  // huso horario que ya rompió rangeBounds() una vez (ver parseLocalDate).
  var DIAS_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function getIngresosPorDia(ventas, days, ref) {
    var end = ref ? new Date(ref) : new Date();
    var out = [];
    for (var i = (days || 7) - 1; i >= 0; i--) {
      var d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      out.push({ fecha: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), dayLabel: DIAS_LABEL[d.getDay()], total: 0, esHoy: i === 0 });
    }
    var byDate = {};
    out.forEach(function (o) { byDate[o.fecha] = o; });
    (ventas || []).forEach(function (v) {
      var f = new Date(v.fecha);
      var key = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
      if (byDate[key]) byDate[key].total += v.total;
    });
    return out;
  }

  // ─── Estado / migraciones (P1-3) ───────────────────────────

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      materia: [],
      empaques: [],
      toppings: [],
      preparaciones: [],
      productos: [],
      ventas: [],
      gastos: [],
      clientes: [],
      config: { email: '', backendUrl: '', backendToken: '', lastSync: null }
    };
  }

  // Migra un estado crudo (posiblemente de una versión vieja o incompleto)
  // a la forma actual. Nunca lanza, nunca destruye datos existentes:
  // solo agrega lo que falta. Ver HANDOFF.md P1-3.
  function migrateState(raw) {
    var base = emptyState();
    if (!raw || typeof raw !== 'object') return base;

    var s = {
      schemaVersion: SCHEMA_VERSION,
      materia: Array.isArray(raw.materia) ? raw.materia : [],
      empaques: Array.isArray(raw.empaques) ? raw.empaques : [],
      toppings: Array.isArray(raw.toppings) ? raw.toppings : [],
      productos: Array.isArray(raw.productos) ? raw.productos : [],
      ventas: Array.isArray(raw.ventas) ? raw.ventas : [],
      gastos: Array.isArray(raw.gastos) ? raw.gastos : [], // v2 -> v3
      preparaciones: Array.isArray(raw.preparaciones) ? raw.preparaciones : [], // v3 -> v4
      clientes: Array.isArray(raw.clientes) ? raw.clientes : [], // v5 -> v6
      config: (raw.config && typeof raw.config === 'object') ? raw.config : {}
    };
    if (s.config.email === undefined) s.config.email = '';
    // Fase E — backend en Google Sheets (HANDOFF.md §12): config de
    // sincronización, vacía hasta que el usuario despliegue su propio
    // Apps Script y pegue la URL + token (backend/SETUP.md).
    if (s.config.backendUrl === undefined) s.config.backendUrl = '';
    if (s.config.backendToken === undefined) s.config.backendToken = '';
    if (s.config.lastSync === undefined) s.config.lastSync = null;

    // v1 → v2: productos ganan empaquesUsados[] / empaqueManual (heredado
    // del costo manual de empaque de la versión anterior a toppings/empaque).
    // v3 → v4: productos ganan componentes[] (unifica materia + preparaciones,
    // reemplaza ingredientes[{materiaId,gramos}] por componentes[{tipo,refId,gramos}]
    // — ver HANDOFF §10.2). Los ingredientes existentes se migran con tipo:'materia'.
    s.productos = s.productos.map(function (p) {
      var out = Object.assign({}, p);
      if (!Array.isArray(out.componentes)) {
        out.componentes = (Array.isArray(out.ingredientes) ? out.ingredientes : []).map(function (i) {
          return { tipo: 'materia', refId: i.materiaId, gramos: i.gramos };
        });
      }
      delete out.ingredientes;
      if (!Array.isArray(out.empaquesUsados)) out.empaquesUsados = [];
      if (out.empaqueManual === undefined) out.empaqueManual = out.empaque || 0;
      // productos[].costo ya NO se persiste como snapshot (P0-2) — si viene
      // de un estado viejo se ignora; se recalcula siempre en vivo.
      delete out.costo;
      return out;
    });

    s.preparaciones = s.preparaciones.map(function (prep) {
      var out = Object.assign({ modo: 'porcentaje', baseGramos: 0 }, prep);
      if (!Array.isArray(out.componentes)) out.componentes = [];
      return out;
    });

    // v6 → v7: rediseño (DISENO_HANDOFF.md) — categoría libre para filtrar
    // en Inventario, adiciones (insumo vendible como extra en una venta,
    // con su propio precio y porción consumida por unidad vendida), y
    // comprobante de pago en ventas/gastos con método de pago transferencia.
    var conAdiciones = function (defaults) {
      return function (item) {
        var out = Object.assign({ categoria: '', esAdicion: false, precioAdicion: 0, porcion: 0, nombreAdicion: '' }, defaults, item);
        return out;
      };
    };
    s.materia = s.materia.map(conAdiciones({ minimo: 100 }));
    s.empaques = s.empaques.map(conAdiciones({ minimo: 10, unidad: 'unidad' }));
    s.toppings = s.toppings.map(conAdiciones({ minimo: 5 }));

    s.productos = s.productos.map(function (p) {
      return Object.assign({ categoria: '', foto: '' }, p);
    });

    s.clientes = s.clientes.map(function (c) {
      return Object.assign({ direccion: '' }, c);
    });

    s.ventas = s.ventas.map(function (v) {
      var out = Object.assign({ metodoPago: 'efectivo', comprobante: '', adicionesConsumo: {} }, v);
      if (!Array.isArray(out.items)) out.items = [];
      if (out.stockInsuficiente === undefined) out.stockInsuficiente = false;
      return out;
    });

    s.gastos = s.gastos.map(function (g) {
      return Object.assign({ comprobante: '' }, g);
    });

    return s;
  }

  // ─── Preparaciones intermedias (HANDOFF §10.2) ─────────────
  //
  // Modelo: materia prima → preparación → producto, con reutilización entre
  // productos y anidamiento entre preparaciones (una masa puede usar otra
  // preparación como componente). Todo se resuelve con UNA sola función
  // recursiva — getPreparacionComposicionPorGramo — que expande cualquier
  // preparación, sin importar cuán anidada esté, a "cuántos gramos de cada
  // materia prima CRUDA hacen falta por cada gramo de esta preparación".
  // Costeo, consumo de stock al vender y proyección de compras se derivan
  // todos de esa misma expansión — nunca se duplica la fórmula.
  //
  // Porcentaje panadero: gramos(i) = baseGramos × porcentaje(i). Modo
  // 'directo': gramos(i) viene dado directamente, sin básculas relativas.

  function getPreparacion(state, prepId) {
    return (state.preparaciones || []).find(function (x) { return x.id === prepId; });
  }

  function gramosDeComponentePreparacion(prep, c) {
    return prep.modo === 'directo'
      ? (Number(c.gramos) || 0)
      : (Number(prep.baseGramos) || 0) * (Number(c.porcentaje) || 0);
  }

  // Gramos de materia CRUDA por cada gramo de la preparación `prepId`,
  // expandiendo recursivamente cualquier sub-preparación. `_stack` rastrea
  // la cadena de preparaciones en resolución para cortar con un error claro
  // ante un ciclo (A usa B, B usa A) en vez de recursión infinita.
  function getPreparacionComposicionPorGramo(state, prepId, _stack) {
    _stack = _stack || [];
    if (_stack.indexOf(prepId) !== -1) {
      throw new Error('Ciclo detectado en preparaciones: ' + _stack.concat(prepId).join(' → '));
    }
    var prep = getPreparacion(state, prepId);
    if (!prep) return {};
    var stack2 = _stack.concat(prepId);
    var gramosTotal = 0;
    var acumMateria = {};
    (prep.componentes || []).forEach(function (c) {
      var gramos = gramosDeComponentePreparacion(prep, c);
      gramosTotal += gramos;
      if (c.tipo === 'materia') {
        acumMateria[c.refId] = (acumMateria[c.refId] || 0) + gramos;
      } else if (c.tipo === 'preparacion') {
        var sub = getPreparacionComposicionPorGramo(state, c.refId, stack2);
        Object.keys(sub).forEach(function (mid) {
          acumMateria[mid] = (acumMateria[mid] || 0) + sub[mid] * gramos;
        });
      }
    });
    var porGramo = {};
    if (gramosTotal > 0) {
      Object.keys(acumMateria).forEach(function (mid) { porGramo[mid] = acumMateria[mid] / gramosTotal; });
    }
    return porGramo;
  }

  // Costo por gramo de una preparación — se deriva de la composición
  // expandida a materia cruda, no de una fórmula separada (ver nota arriba).
  function getPreparacionCosto(state, prepId) {
    var composicion = getPreparacionComposicionPorGramo(state, prepId); // lanza si hay ciclo
    var costoPorGramo = 0;
    Object.keys(composicion).forEach(function (mid) {
      var m = (state.materia || []).find(function (x) { return x.id === mid; });
      if (m) costoPorGramo += composicion[mid] * (Number(m.costo) || 0);
    });
    var prep = getPreparacion(state, prepId);
    var gramosTotal = 0;
    if (prep) {
      (prep.componentes || []).forEach(function (c) { gramosTotal += gramosDeComponentePreparacion(prep, c); });
    }
    return { costoPorGramo: costoPorGramo, gramosTotal: gramosTotal, costoTotal: costoPorGramo * gramosTotal };
  }

  // Expande `gramos` de un componente (de un producto o de otra
  // preparación) a gramos de materia cruda. tipo 'materia' es el caso base;
  // tipo 'preparacion' recurre a la composición ya expandida.
  function expandGramosAMateria(state, tipo, refId, gramos) {
    var out = {};
    if (tipo === 'materia') {
      out[refId] = (out[refId] || 0) + (Number(gramos) || 0);
    } else if (tipo === 'preparacion') {
      var porGramo = getPreparacionComposicionPorGramo(state, refId);
      Object.keys(porGramo).forEach(function (mid) {
        out[mid] = (out[mid] || 0) + porGramo[mid] * (Number(gramos) || 0);
      });
    }
    return out;
  }

  // Recorre los `componentes` de un producto (materia/preparación/empaques/
  // toppings — rediseño, DISENO_HANDOFF.md) y llama apply(bucket, id,
  // cantidad) por cada insumo hoja involucrado, ya multiplicado por `qty`.
  // Una preparación se expande primero a materia cruda (nunca llega a
  // apply() como 'preparacion'). Único punto que conoce esta expansión —
  // computeSaleConsumption, getConsumptionRolling, applyVenta y el
  // fallback legado de revertVenta lo reusan, en vez de repetirlo 4 veces.
  function aplicarComponentes(state, componentes, qty, apply) {
    (componentes || []).forEach(function (c) {
      var cantidad = (Number(c.gramos) || 0) * qty;
      if (c.tipo === 'empaques' || c.tipo === 'toppings') {
        apply(c.tipo, c.refId, cantidad);
      } else {
        var expandido = expandGramosAMateria(state, c.tipo, c.refId, cantidad);
        Object.keys(expandido).forEach(function (mid) { apply('materia', mid, expandido[mid]); });
      }
    });
  }

  // ¿Guardar `componentes` en la preparación `prepId` (nueva o existente)
  // crearía un ciclo? Chequeo estructural sobre el grafo de preparaciones,
  // independiente del cálculo de costo — se corre ANTES de persistir.
  function preparacionDependeDe(state, prepId, targetId, _visited) {
    _visited = _visited || {};
    if (_visited[prepId]) return false;
    _visited[prepId] = true;
    var prep = getPreparacion(state, prepId);
    if (!prep) return false;
    return (prep.componentes || []).some(function (c) {
      if (c.tipo !== 'preparacion') return false;
      if (c.refId === targetId) return true;
      return preparacionDependeDe(state, c.refId, targetId, _visited);
    });
  }
  function wouldCreateCiclo(state, prepId, componentes) {
    return (componentes || []).some(function (c) {
      if (c.tipo !== 'preparacion') return false;
      if (c.refId === prepId) return true; // auto-referencia directa
      return preparacionDependeDe(state, c.refId, prepId);
    });
  }

  function savePreparacion(state, input) {
    var nombre = (input.nombre || '').trim();
    if (!nombre) throw new Error('El nombre de la preparación es obligatorio');
    var modo = input.modo === 'directo' ? 'directo' : 'porcentaje';
    var componentes = (input.componentes || []).map(function (c) {
      return { tipo: c.tipo, refId: c.refId, porcentaje: Number(c.porcentaje) || 0, gramos: Number(c.gramos) || 0 };
    });
    var id = input.id || genId();
    if (wouldCreateCiclo(state, id, componentes)) {
      throw new Error('Esta combinación crea un ciclo entre preparaciones (una depende de otra que depende de ella).');
    }
    var prep = { id: id, nombre: nombre, modo: modo, baseGramos: Number(input.baseGramos) || 0, componentes: componentes };
    var idx = state.preparaciones.findIndex(function (x) { return x.id === id; });
    if (idx === -1) state.preparaciones.push(prep); else state.preparaciones[idx] = prep;
    return prep;
  }

  function findProductosUsandoPreparacion(state, prepId) {
    return (state.productos || []).filter(function (p) {
      return (p.componentes || []).some(function (c) { return c.tipo === 'preparacion' && c.refId === prepId; });
    });
  }
  function findPreparacionesUsandoPreparacion(state, prepId) {
    return (state.preparaciones || []).filter(function (prep) {
      return (prep.componentes || []).some(function (c) { return c.tipo === 'preparacion' && c.refId === prepId; });
    });
  }
  function findPreparacionesUsandoMateria(state, materiaId) {
    return (state.preparaciones || []).filter(function (prep) {
      return (prep.componentes || []).some(function (c) { return c.tipo === 'materia' && c.refId === materiaId; });
    });
  }

  // ─── Costeo de producto (P0-2: siempre en vivo, nunca cacheado) ───

  // tipo → colección: dónde buscar un componente de receta que no sea
  // materia ni preparación. Rediseño (DISENO_HANDOFF.md): la "Fórmula" de
  // un producto puede referenciar cualquier insumo, no solo materia prima.
  var COLECCION_POR_TIPO = { empaques: 'empaques', toppings: 'toppings' };
  function getCostoProducto(producto, state) {
    if (!producto) return 0;
    var costo = Number(producto.empaqueManual) || 0;
    (producto.componentes || []).forEach(function (c) {
      var gramos = Number(c.gramos) || 0;
      if (c.tipo === 'preparacion') {
        costo += gramos * getPreparacionCosto(state, c.refId).costoPorGramo;
      } else if (COLECCION_POR_TIPO[c.tipo]) {
        var ins = (state[COLECCION_POR_TIPO[c.tipo]] || []).find(function (x) { return x.id === c.refId; });
        if (ins) costo += gramos * (Number(ins.costo) || 0);
      } else {
        var m = (state.materia || []).find(function (x) { return x.id === c.refId; });
        if (m) costo += gramos * (Number(m.costo) || 0);
      }
    });
    (producto.empaquesUsados || []).forEach(function (e) {
      var m = (state.empaques || []).find(function (x) { return x.id === e.empaqueId; });
      if (m) costo += (Number(m.costo) || 0) * (Number(e.cantidad) || 0);
    });
    return costo;
  }

  function getEmpaqueTotalProducto(producto, state) {
    if (!producto) return 0;
    var total = Number(producto.empaqueManual) || 0;
    (producto.empaquesUsados || []).forEach(function (e) {
      var m = (state.empaques || []).find(function (x) { return x.id === e.empaqueId; });
      if (m) total += (Number(m.costo) || 0) * (Number(e.cantidad) || 0);
    });
    return total;
  }

  // ─── Margen bruto por producto ─────────────────────────────
  // ponytail: sin recargo de costos fijos por producto (retirado a
  // petición del usuario el 11 ago 2026). El costo del producto es solo
  // costo variable; la utilidad neta se conoce por período, al cierre,
  // cruzando ventas reales con gastos reales — eso ya existe en
  // getCascadaUtilidad (Fase C), no aquí.
  function getMargenProducto(producto, state) {
    var costo = getCostoProducto(producto, state);
    var precio = Number(producto.precio) || 0;
    var ganancia = precio - costo;
    return { costo: costo, precio: precio, ganancia: ganancia, margenPct: precio > 0 ? ganancia / precio : 0 };
  }

  // ─── Insumos unificados (rediseño, DISENO_HANDOFF.md) ──────────
  // materia/empaques/toppings se mantienen como colecciones separadas (no se
  // fusionan: preservaría menos de lo que rompería — preparaciones referencian
  // materia por id, el backend de Sheets ya las espeja por separado, y los
  // tests existentes asumen esta forma). Esta función solo aplana las tres
  // para pantallas que necesitan verlas juntas (Inventario, selector de
  // fórmula, lista de adiciones).
  var UNIDAD_LABEL = { materia: 'g', empaques: 'unidad', toppings: 'unidad' };
  function getInsumosUnificados(state) {
    var out = [];
    ['materia', 'empaques', 'toppings'].forEach(function (tipo) {
      (state[tipo] || []).forEach(function (item) {
        out.push(Object.assign({ tipo: tipo, unidad: item.unidad || UNIDAD_LABEL[tipo] }, item));
      });
    });
    return out;
  }

  function getAdiciones(state) {
    return getInsumosUnificados(state).filter(function (i) { return i.esAdicion; });
  }

  // ─── Clientes (nombre + teléfono, reutilizable entre ventas) ───
  // El teléfono es la clave de reutilización: si ya existe un cliente con
  // ese teléfono, se reusa (y se actualiza el nombre si vino distinto);
  // si no, se crea. Sin teléfono ni nombre, no hay cliente que registrar
  // (la venta queda sin clienteId, como hoy).
  function findOrCreateCliente(state, nombre, telefono, direccion) {
    nombre = (nombre || '').trim();
    telefono = (telefono || '').trim();
    if (!nombre && !telefono) return null;
    var existente = telefono ? state.clientes.find(function (c) { return c.telefono === telefono; }) : null;
    if (existente) {
      if (nombre) existente.nombre = nombre;
      if (direccion) existente.direccion = direccion;
      return existente.id;
    }
    var nuevo = { id: genId(), nombre: nombre || '(sin nombre)', telefono: telefono, direccion: direccion || '' };
    state.clientes.push(nuevo);
    return nuevo.id;
  }

  function getTicketPromedio(ventas) {
    if (!ventas || !ventas.length) return 0;
    return ventas.reduce(function (a, v) { return a + v.total; }, 0) / ventas.length;
  }

  // ─── Movimientos (Caja) — ventas y gastos de un período, en una sola
  // lista ordenada por fecha descendente, para la pantalla "Caja" del
  // rediseño. No inventa datos nuevos, solo normaliza/combina lo que ya
  // devuelven getVentasByPeriod/getGastosByPeriod.
  function getMovimientos(ventas, gastos) {
    var deVenta = (ventas || []).map(function (v) {
      return { tipo: 'venta', categoria: 'venta', fecha: v.fecha, monto: v.total, signo: '+', ref: v };
    });
    var deGasto = (gastos || []).map(function (g) {
      return { tipo: 'gasto', categoria: g.tipo, fecha: g.fecha, monto: g.monto, signo: '-', ref: g };
    });
    return deVenta.concat(deGasto).sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  }

  // ─── Validación de stock antes de vender (P0-3) ────────────

  // Recibe las líneas del carrito ya resueltas (ver index.html registrarVenta)
  // y devuelve el consumo agregado por insumo, sin mutar nada.
  //   lineas: [{ productoId, qty, toppings: [{toppingId, qty}] }]
  //   toppingsSueltos: [{ toppingId, qty }]
  function computeSaleConsumption(lineas, toppingsSueltos, state) {
    var consumo = { materia: {}, empaques: {}, toppings: {} };
    function add(bucket, id, cant) {
      consumo[bucket][id] = (consumo[bucket][id] || 0) + cant;
    }
    (lineas || []).forEach(function (line) {
      var qty = Number(line.qty) || 0;
      var p = (state.productos || []).find(function (x) { return x.id === line.productoId; });
      if (p && qty > 0) {
        // Cada componente (materia directa, preparación, empaque o topping)
        // se expande hasta insumo hoja antes de sumarlo — así una receta con
        // preparaciones anidadas valida contra el stock real, no un intermedio.
        aplicarComponentes(state, p.componentes, qty, add);
        (p.empaquesUsados || []).forEach(function (e) {
          add('empaques', e.empaqueId, (Number(e.cantidad) || 0) * qty);
        });
      }
      (line.toppings || []).forEach(function (t) {
        var totQty = (Number(t.qty) || 0) * qty;
        if (totQty > 0) add('toppings', t.toppingId, totQty);
      });
      (line.adiciones || []).forEach(function (adId) {
        var found = findInsumoConTipo(state, adId);
        if (found && found.item.esAdicion) add(found.tipo, adId, (Number(found.item.porcion) || 0) * qty);
      });
    });
    (toppingsSueltos || []).forEach(function (t) {
      var q = Number(t.qty) || 0;
      if (q > 0) add('toppings', t.toppingId, q);
    });
    return consumo;
  }

  // Compara el consumo agregado contra el stock disponible y devuelve la
  // lista de faltantes (vacía si alcanza para todo).
  function checkStockShortage(consumo, state) {
    var faltantes = [];
    function check(bucket, list) {
      Object.keys(consumo[bucket]).forEach(function (id) {
        var item = (list || []).find(function (x) { return x.id === id; });
        if (!item) return;
        var necesario = consumo[bucket][id];
        var disponible = Number(item.cantidad) || 0;
        if (necesario > disponible) {
          faltantes.push({
            tipo: bucket,
            id: id,
            nombre: item.nombre,
            disponible: disponible,
            necesario: necesario,
            faltante: necesario - disponible
          });
        }
      });
    }
    check('materia', state.materia);
    check('empaques', state.empaques);
    check('toppings', state.toppings);
    return faltantes;
  }

  // ─── Necesidades de inventario (P1-1: materia + empaque + toppings) ───

  // Consumo real de los últimos `days` días (ventana móvil, P1-2),
  // agregado por tipo+id, recorriendo AMBOS tipos de ítem de venta
  // (productoId y toppingId — antes solo se miraba productoId).
  function getConsumptionRolling(state, days, ref) {
    var ventas = getVentasRolling(state.ventas, days || 7, ref);
    var consumo = { materia: {}, empaques: {}, toppings: {} };
    function add(bucket, id, cant) {
      consumo[bucket][id] = (consumo[bucket][id] || 0) + cant;
    }
    ventas.forEach(function (v) {
      (v.items || []).forEach(function (item) {
        if (item.productoId) {
          var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
          if (p) {
            aplicarComponentes(state, p.componentes, item.qty, add);
            (p.empaquesUsados || []).forEach(function (e) {
              add('empaques', e.empaqueId, (Number(e.cantidad) || 0) * item.qty);
            });
          }
        } else if (item.toppingId) {
          add('toppings', item.toppingId, Number(item.qty) || 0);
        } else if (item.adicionId) {
          var found = findInsumoConTipo(state, item.adicionId);
          if (found) add(found.tipo, item.adicionId, (Number(found.item.porcion) || 0) * (Number(item.qty) || 0));
        }
      });
    });
    return consumo;
  }

  function calcInventoryNeeds(state, days, ref) {
    days = days || 7;
    var consumo = getConsumptionRolling(state, days, ref);
    var out = [];
    function build(bucket, list, unidadLabel) {
      (list || []).forEach(function (m) {
        var consumoTot = consumo[bucket][m.id] || 0;
        var consumoSemanal = consumoTot * (7 / days);
        var semanasRestantes = consumoSemanal > 0 ? m.cantidad / consumoSemanal : Infinity;
        var necesitaComprar = m.cantidad <= m.minimo || semanasRestantes <= 1;
        var sugerido = 0;
        if (necesitaComprar) {
          sugerido = Math.max(consumoSemanal * 2 - m.cantidad, m.minimo * 2 - m.cantidad, 0);
        }
        out.push(Object.assign({}, m, {
          tipo: bucket,
          unidadLabel: unidadLabel || 'g',
          consumo: consumoSemanal,
          semanasRestantes: semanasRestantes,
          necesitaComprar: necesitaComprar,
          sugerido: sugerido
        }));
      });
    }
    build('materia', state.materia, 'g');
    build('empaques', state.empaques, 'und');
    build('toppings', state.toppings, 'und');
    out.sort(function (a, b) { return a.semanasRestantes - b.semanasRestantes; });
    return out;
  }

  // ─── Aplicar / revertir una venta (P0-1, P0-3) ─────────────

  // Aplica una venta al estado: agrega el registro y descuenta stock.
  // Muta `state` directamente. NO valida stock — eso lo hace
  // checkStockShortage() antes, por separado, para poder mostrar el
  // detalle y pedir confirmación al usuario.
  //
  // Guarda en la venta el consumo REAL descontado de cada insumo
  // (post-clamp, nunca negativo) en `venta.consumoReal`. Esto es lo que
  // permite que revertVenta() devuelva exactamente lo que se quitó — si
  // solo se registrara la cantidad "teórica" de la receta, revertir una
  // venta que se vendió con stock insuficiente (clampeado a 0) sumaría de
  // más y dejaría el inventario por encima del valor real.
  // Busca un insumo por id en las tres colecciones (materia/empaques/
  // toppings) — usado por las adiciones del rediseño, que pueden venir de
  // cualquiera de las tres, no solo de toppings.
  function findInsumoConTipo(state, id) {
    var buckets = [['materia', state.materia], ['empaques', state.empaques], ['toppings', state.toppings]];
    for (var i = 0; i < buckets.length; i++) {
      var found = (buckets[i][1] || []).find(function (x) { return x.id === id; });
      if (found) return { item: found, tipo: buckets[i][0], list: buckets[i][1] };
    }
    return null;
  }

  function applyVenta(state, lineas, toppingsSueltos, opts) {
    opts = opts || {};
    const items = [];
    let total = 0, ganancia = 0;
    const consumoReal = { materia: {}, empaques: {}, toppings: {} };

    function deduct(bucket, list, id, cantidad) {
      const m = (list || []).find(function (x) { return x.id === id; });
      if (!m || cantidad <= 0) return;
      const antes = m.cantidad;
      m.cantidad = Math.max(0, m.cantidad - cantidad);
      const real = antes - m.cantidad;
      consumoReal[bucket][id] = (consumoReal[bucket][id] || 0) + real;
    }

    (lineas || []).forEach(function (line) {
      var qty = Number(line.qty) || 0;
      if (line.productoId && qty > 0) {
        var p = (state.productos || []).find(function (x) { return x.id === line.productoId; });
        if (p) {
          var costo = getCostoProducto(p, state);
          items.push({ productoId: p.id, nombre: p.nombre, qty: qty, precio: p.precio, costo: costo });
          total += p.precio * qty;
          ganancia += (p.precio - costo) * qty;
          aplicarComponentes(state, p.componentes, qty, function (bucket, id, cant) { deduct(bucket, state[bucket], id, cant); });
          (p.empaquesUsados || []).forEach(function (e) {
            deduct('empaques', state.empaques, e.empaqueId, (Number(e.cantidad) || 0) * qty);
          });
        }
      }
      (line.toppings || []).forEach(function (t) {
        var totQty = (Number(t.qty) || 0) * qty;
        if (totQty <= 0) return;
        var top = (state.toppings || []).find(function (x) { return x.id === t.toppingId; });
        if (top) {
          items.push({ toppingId: top.id, nombre: top.nombre + ' (topping)', qty: totQty, precio: top.precio, costo: top.costo });
          total += top.precio * totQty;
          ganancia += (top.precio - top.costo) * totQty;
          deduct('toppings', state.toppings, top.id, totQty);
        }
      });
      // Adiciones (rediseño): insumo de cualquier tipo marcado esAdicion,
      // consumido en proporción `porcion` por cada unidad vendida de la línea.
      (line.adiciones || []).forEach(function (adId) {
        var found = findInsumoConTipo(state, adId);
        if (!found || !found.item.esAdicion) return;
        var precio = Number(found.item.precioAdicion) || 0;
        var porcion = Number(found.item.porcion) || 0;
        var costoUnit = (Number(found.item.costo) || 0) * porcion;
        items.push({ adicionId: adId, nombre: (found.item.nombreAdicion || found.item.nombre) + ' (adición)', qty: qty, precio: precio, costo: costoUnit });
        total += precio * qty;
        ganancia += (precio - costoUnit) * qty;
        deduct(found.tipo, found.list, adId, porcion * qty);
      });
    });

    (toppingsSueltos || []).forEach(function (t) {
      var q = Number(t.qty) || 0;
      if (q <= 0) return;
      var top = (state.toppings || []).find(function (x) { return x.id === t.toppingId; });
      if (top) {
        items.push({ toppingId: top.id, nombre: top.nombre + ' (topping suelto)', qty: q, precio: top.precio, costo: top.costo });
        total += top.precio * q;
        ganancia += (top.precio - top.costo) * q;
        deduct('toppings', state.toppings, top.id, q);
      }
    });

    if (!items.length) return null;

    var venta = {
      id: opts.id || genId(),
      fecha: opts.fecha || new Date().toISOString(),
      items: items,
      total: total,
      ganancia: ganancia,
      stockInsuficiente: !!opts.stockInsuficiente,
      consumoReal: consumoReal,
      clienteId: opts.clienteId || null,
      metodoPago: opts.metodoPago || 'efectivo',
      comprobante: opts.comprobante || ''
    };
    state.ventas.push(venta);
    return venta;
  }

  // Revierte exactamente lo que una venta dedujo (usa venta.consumoReal).
  // Para ventas antiguas guardadas antes de que existiera ese campo, cae de
  // vuelta a recalcular desde la receta ACTUAL del producto — aproximado si
  // la receta cambió desde entonces (P0-1, caso documentado en el handoff).
  function revertVenta(state, venta) {
    if (venta.consumoReal) {
      function restore(bucket, list) {
        Object.keys(venta.consumoReal[bucket] || {}).forEach(function (id) {
          var m = (list || []).find(function (x) { return x.id === id; });
          if (m) m.cantidad += venta.consumoReal[bucket][id];
        });
      }
      restore('materia', state.materia);
      restore('empaques', state.empaques);
      restore('toppings', state.toppings);
    } else {
      venta.items.forEach(function (item) {
        if (item.productoId) {
          var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
          if (p) {
            aplicarComponentes(state, p.componentes, item.qty, function (bucket, id, cant) {
              var m = (state[bucket] || []).find(function (x) { return x.id === id; });
              if (m) m.cantidad += cant;
            });
            (p.empaquesUsados || []).forEach(function (e) {
              var m = (state.empaques || []).find(function (x) { return x.id === e.empaqueId; });
              if (m) m.cantidad += (Number(e.cantidad) || 0) * item.qty;
            });
          }
        } else if (item.toppingId) {
          var t = (state.toppings || []).find(function (x) { return x.id === item.toppingId; });
          if (t) t.cantidad += item.qty;
        } else if (item.adicionId) {
          var found = findInsumoConTipo(state, item.adicionId);
          if (found) found.item.cantidad += (Number(found.item.porcion) || 0) * (Number(item.qty) || 0);
        }
      });
    }
    state.ventas = state.ventas.filter(function (v) { return v.id !== venta.id; });
  }

  // ─── Gastos (HANDOFF §9) ────────────────────────────────────

  var GASTO_CATEGORIAS = {
    inventario: ['Materia prima', 'Empaque', 'Toppings'],
    operativo: ['Publicidad', 'Arriendo', 'Servicios', 'Transporte', 'Nómina', 'Aseo', 'Otros'],
    capex: ['Equipos de cocina', 'Mobiliario', 'Tecnología', 'Adecuaciones']
  };

  // Costo promedio ponderado: al comprar más stock a un precio distinto,
  // el costo unitario del insumo se recalcula ponderando por cantidad —
  // no se reemplaza sin más (decisión del handoff, ejemplo verificado:
  // 1000g a $10 + 2000g a $12 -> $11,333/g).
  function costoPromedioPonderado(costoActual, cantidadActual, costoCompra, cantidadCompra) {
    var cantAntes = Number(cantidadActual) || 0;
    var cantCompra = Number(cantidadCompra) || 0;
    if (cantAntes + cantCompra <= 0) return Number(costoCompra) || 0;
    if (cantAntes <= 0) return Number(costoCompra) || 0;
    return ((cantAntes * (Number(costoActual) || 0)) + (cantCompra * (Number(costoCompra) || 0))) / (cantAntes + cantCompra);
  }

  function getInsumoList(state, insumoTipo) {
    if (insumoTipo === 'materia') return state.materia;
    if (insumoTipo === 'empaques') return state.empaques;
    if (insumoTipo === 'toppings') return state.toppings;
    return null;
  }

  // Registra un gasto y, si es de tipo 'inventario', aplica su efecto sobre
  // el insumo: aumenta el stock y actualiza el costo unitario (promedio
  // ponderado). Guarda un snapshot (costoAntes/cantidadAntes) para poder
  // revertirlo con precisión más adelante — mismo patrón que
  // applyVenta/revertVenta con consumoReal (P0-1), por la misma razón: sin
  // el snapshot, deshacer un gasto tendría que adivinar el estado previo.
  //
  // input: { fecha, tipo, categoria, descripcion, monto, proveedor,
  //          insumoTipo, insumoId, cantidad,      // solo tipo 'inventario'
  //          vidaUtilMeses }                       // solo tipo 'capex'
  function registrarGasto(state, input) {
    var monto = Number(input.monto) || 0;
    if (monto <= 0) throw new Error('El monto del gasto debe ser mayor a 0');
    if (!input.tipo || !GASTO_CATEGORIAS[input.tipo]) throw new Error('Tipo de gasto inválido');

    var gasto = {
      id: input.id || genId(),
      fecha: input.fecha || new Date().toISOString(),
      tipo: input.tipo,
      categoria: input.categoria || '',
      descripcion: input.descripcion || '',
      monto: monto,
      proveedor: input.proveedor || ''
    };

    if (input.tipo === 'inventario') {
      var cantidad = Number(input.cantidad) || 0;
      if (cantidad <= 0) throw new Error('La cantidad comprada debe ser mayor a 0');
      var list = getInsumoList(state, input.insumoTipo);
      if (!list) throw new Error('Tipo de insumo inválido');
      var insumo = list.find(function (x) { return x.id === input.insumoId; });
      if (!insumo) throw new Error('Insumo no encontrado');

      gasto.insumoTipo = input.insumoTipo;
      gasto.insumoId = input.insumoId;
      gasto.cantidad = cantidad;
      gasto.costoAntes = insumo.costo;
      gasto.cantidadAntes = insumo.cantidad;

      var costoCompraUnitario = monto / cantidad;
      // Insumo de precio volátil: +8% de colchón sobre el costo de esta
      // compra antes de mezclarlo al promedio ponderado — decisión del
      // 11 ago 2026, para no subcostear cuando el proveedor sube de precio
      // entre una compra y la siguiente.
      if (insumo.margenVariable) {
        costoCompraUnitario *= (1 + MARGEN_VARIABILIDAD_PCT);
        gasto.margenVariabilidadAplicado = MARGEN_VARIABILIDAD_PCT;
      }
      insumo.costo = costoPromedioPonderado(insumo.costo, insumo.cantidad, costoCompraUnitario, cantidad);
      insumo.cantidad = (Number(insumo.cantidad) || 0) + cantidad;
      gasto.actualizoCosto = true;
    } else if (input.tipo === 'capex') {
      var vidaUtilMeses = Number(input.vidaUtilMeses) || 0;
      if (vidaUtilMeses <= 0) throw new Error('La vida útil (meses) debe ser mayor a 0');
      gasto.vidaUtilMeses = vidaUtilMeses;
    }

    state.gastos.push(gasto);
    return gasto;
  }

  // Revierte un gasto: si era de inventario, devuelve el insumo exactamente
  // a su costo/cantidad de antes de la compra (usa el snapshot, no
  // recalcula) — evita el mismo problema de "revertir con la fórmula en
  // vez del dato real" que P0-1 encontró en las ventas.
  function eliminarGasto(state, id) {
    var gasto = state.gastos.find(function (g) { return g.id === id; });
    if (!gasto) return;
    if (gasto.tipo === 'inventario' && gasto.insumoTipo && gasto.insumoId) {
      var list = getInsumoList(state, gasto.insumoTipo);
      var insumo = list && list.find(function (x) { return x.id === gasto.insumoId; });
      if (insumo && gasto.costoAntes !== undefined && gasto.cantidadAntes !== undefined) {
        insumo.costo = gasto.costoAntes;
        insumo.cantidad = gasto.cantidadAntes;
      }
    }
    state.gastos = state.gastos.filter(function (g) { return g.id !== id; });
  }

  function getGastosByPeriod(gastos, period, ref) {
    var start = getDateStart(period, ref);
    return (gastos || []).filter(function (g) { return new Date(g.fecha) >= start; });
  }

  // ─── Rango de fechas personalizable (Reportes) ─────────────
  // `new Date('YYYY-MM-DD')` se interpreta como medianoche UTC — en
  // cualquier huso horario detrás de UTC (Colombia, UTC-5) eso corre la
  // fecha un día hacia atrás en hora local. Se construye la fecha local
  // a mano para que el rango sea exactamente el que se ve en el selector.
  function parseLocalDate(dateStr) {
    var parts = String(dateStr).split('T')[0].split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function rangeBounds(startISO, endISO) {
    var start = parseLocalDate(startISO); start.setHours(0, 0, 0, 0);
    var end = parseLocalDate(endISO); end.setHours(23, 59, 59, 999);
    return { start: start, end: end };
  }
  function getVentasByRange(ventas, startISO, endISO) {
    var b = rangeBounds(startISO, endISO);
    return (ventas || []).filter(function (v) { var f = new Date(v.fecha); return f >= b.start && f <= b.end; });
  }
  function getGastosByRange(gastos, startISO, endISO) {
    var b = rangeBounds(startISO, endISO);
    return (gastos || []).filter(function (g) { var f = new Date(g.fecha); return f >= b.start && f <= b.end; });
  }

  function meses30(desde, hasta) {
    return (hasta.getTime() - desde.getTime()) / (1000 * 60 * 60 * 24 * 30);
  }

  // Depreciación mensual total de todo capex vigente (dentro de su vida
  // útil) a la fecha `ref`. Un mes se aproxima a 30 días — suficiente para
  // este propósito, no hace falta contar calendario exacto.
  function getDepreciacionMensualTotal(state, ref) {
    var now = ref ? new Date(ref) : new Date();
    return (state.gastos || [])
      .filter(function (g) { return g.tipo === 'capex' && g.vidaUtilMeses > 0 && new Date(g.fecha) <= now; })
      .reduce(function (sum, g) {
        var transcurridos = meses30(new Date(g.fecha), now);
        if (transcurridos >= g.vidaUtilMeses) return sum; // ya totalmente depreciado
        return sum + (g.monto / g.vidaUtilMeses);
      }, 0);
  }

  // Depreciación prorrateada al período de reportes seleccionado (día
  // /semana/mes/año), a partir de la depreciación mensual total.
  function getDepreciacionPeriodo(state, period, ref) {
    var mensual = getDepreciacionMensualTotal(state, ref);
    var factor = { dia: 1 / 30, semana: 7 / 30, mes: 1, anio: 12 }[period];
    if (factor === undefined) factor = 1;
    return mensual * factor;
  }
  function getDepreciacionRango(state, startISO, endISO) {
    var b = rangeBounds(startISO, endISO); // ya resuelto a fecha local correcta
    var mensual = getDepreciacionMensualTotal(state, b.end);
    var dias = Math.max(1, (b.end - b.start) / (1000 * 60 * 60 * 24));
    return mensual * (dias / 30);
  }

  function agruparGastosPorCategoria(gastos) {
    var out = {};
    (gastos || []).forEach(function (g) {
      var key = g.categoria || '(sin categoría)';
      out[key] = (out[key] || 0) + g.monto;
    });
    return out;
  }

  // La cascada completa del período: utilidad bruta (ventas - costo de
  // ventas), utilidad neta (bruta - operativos - depreciación) y flujo de
  // caja (ingresos - todo lo que salió de la caja: compras de inventario +
  // operativos + capex). Ver HANDOFF §9.1 — las compras de inventario NO
  // restan de la utilidad porque su costo ya está contado dentro del costo
  // de ventas; restarlas de nuevo aquí sería contarlas dos veces.
  // Cálculo compartido: recibe ventas/gastos YA filtrados (por período o
  // por rango custom) más la depreciación ya prorrateada, y arma la
  // cascada completa. Así getCascadaUtilidad (período) y
  // getCascadaUtilidadRango (fechas custom) nunca duplican la fórmula.
  function computeCascada(ventas, gastos, depreciacion) {
    var ingresos = ventas.reduce(function (a, v) { return a + v.total; }, 0);
    var gananciaVentas = ventas.reduce(function (a, v) { return a + v.ganancia; }, 0);
    var costoVentas = ingresos - gananciaVentas;
    var utilidadBruta = gananciaVentas;

    var operativos = gastos.filter(function (g) { return g.tipo === 'operativo'; });
    var totalOperativos = operativos.reduce(function (a, g) { return a + g.monto; }, 0);
    var utilidadNeta = utilidadBruta - totalOperativos - depreciacion;

    var comprasInventario = gastos.filter(function (g) { return g.tipo === 'inventario'; }).reduce(function (a, g) { return a + g.monto; }, 0);
    var capexPeriodo = gastos.filter(function (g) { return g.tipo === 'capex'; }).reduce(function (a, g) { return a + g.monto; }, 0);
    var flujoCaja = ingresos - comprasInventario - totalOperativos - capexPeriodo;

    return {
      ingresos: ingresos,
      costoVentas: costoVentas,
      utilidadBruta: utilidadBruta,
      margenBrutoPct: ingresos > 0 ? (utilidadBruta / ingresos * 100) : 0,
      gastosOperativosPorCategoria: agruparGastosPorCategoria(operativos),
      totalOperativos: totalOperativos,
      depreciacion: depreciacion,
      utilidadNeta: utilidadNeta,
      margenNetoPct: ingresos > 0 ? (utilidadNeta / ingresos * 100) : 0,
      comprasInventario: comprasInventario,
      capexPeriodo: capexPeriodo,
      flujoCaja: flujoCaja
    };
  }

  function getCascadaUtilidad(state, period, ref) {
    var ventas = getVentasByPeriod(state.ventas, period, ref);
    var gastosPeriodo = getGastosByPeriod(state.gastos, period, ref);
    var depreciacion = getDepreciacionPeriodo(state, period, ref);
    return computeCascada(ventas, gastosPeriodo, depreciacion);
  }

  // Misma cascada, para un rango de fechas elegido a mano (no uno de los
  // períodos fijos Hoy/Semana/Mes/Año) — HANDOFF: "registros... fecha
  // personalizable".
  function getCascadaUtilidadRango(state, startISO, endISO) {
    var ventas = getVentasByRange(state.ventas, startISO, endISO);
    var gastosRango = getGastosByRange(state.gastos, startISO, endISO);
    var depreciacion = getDepreciacionRango(state, startISO, endISO);
    return computeCascada(ventas, gastosRango, depreciacion);
  }

  // ─── Dependencias (P1-4: no romper recetas al borrar un insumo) ───

  // Solo detecta uso DIRECTO en la receta de un producto (tipo:'materia').
  // Si la materia solo se usa dentro de una preparación, el producto no
  // aparece aquí — pero esa preparación sí aparece en
  // findPreparacionesUsandoMateria, y borrar la preparación está bloqueado
  // mientras algún producto la use (findProductosUsandoPreparacion). La
  // cadena de protección se sostiene sin necesidad de expandir aquí.
  function findProductosUsandoMateria(state, materiaId) {
    return (state.productos || []).filter(function (p) {
      return (p.componentes || []).some(function (c) { return c.tipo === 'materia' && c.refId === materiaId; });
    });
  }

  function findProductosUsandoEmpaque(state, empaqueId) {
    return (state.productos || []).filter(function (p) {
      return (p.empaquesUsados || []).some(function (e) { return e.empaqueId === empaqueId; });
    });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    formatCOP: formatCOP,
    escapeHtml: escapeHtml,
    getDateStart: getDateStart,
    getPeriodLabel: getPeriodLabel,
    getPeriodRangeLabel: getPeriodRangeLabel,
    getVentasByPeriod: getVentasByPeriod,
    getVentasRolling: getVentasRolling,
    emptyState: emptyState,
    migrateState: migrateState,
    getCostoProducto: getCostoProducto,
    getEmpaqueTotalProducto: getEmpaqueTotalProducto,
    computeSaleConsumption: computeSaleConsumption,
    checkStockShortage: checkStockShortage,
    applyVenta: applyVenta,
    revertVenta: revertVenta,
    getConsumptionRolling: getConsumptionRolling,
    calcInventoryNeeds: calcInventoryNeeds,
    findProductosUsandoMateria: findProductosUsandoMateria,
    findProductosUsandoEmpaque: findProductosUsandoEmpaque,
    GASTO_CATEGORIAS: GASTO_CATEGORIAS,
    costoPromedioPonderado: costoPromedioPonderado,
    registrarGasto: registrarGasto,
    eliminarGasto: eliminarGasto,
    getGastosByPeriod: getGastosByPeriod,
    getDepreciacionMensualTotal: getDepreciacionMensualTotal,
    getDepreciacionPeriodo: getDepreciacionPeriodo,
    agruparGastosPorCategoria: agruparGastosPorCategoria,
    getCascadaUtilidad: getCascadaUtilidad,
    getPreparacion: getPreparacion,
    getPreparacionComposicionPorGramo: getPreparacionComposicionPorGramo,
    getPreparacionCosto: getPreparacionCosto,
    expandGramosAMateria: expandGramosAMateria,
    wouldCreateCiclo: wouldCreateCiclo,
    savePreparacion: savePreparacion,
    findProductosUsandoPreparacion: findProductosUsandoPreparacion,
    findPreparacionesUsandoPreparacion: findPreparacionesUsandoPreparacion,
    findPreparacionesUsandoMateria: findPreparacionesUsandoMateria,
    getMargenProducto: getMargenProducto,
    getIngresosPorDia: getIngresosPorDia,
    getInsumosUnificados: getInsumosUnificados,
    getAdiciones: getAdiciones,
    getMovimientos: getMovimientos,
    findInsumoConTipo: findInsumoConTipo,
    findOrCreateCliente: findOrCreateCliente,
    getTicketPromedio: getTicketPromedio,
    getVentasByRange: getVentasByRange,
    getGastosByRange: getGastosByRange,
    getDepreciacionRango: getDepreciacionRango,
    getCascadaUtilidadRango: getCascadaUtilidadRango,
    MARGEN_VARIABILIDAD_PCT: MARGEN_VARIABILIDAD_PCT
  };
});

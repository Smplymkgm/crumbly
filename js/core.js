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

  var SCHEMA_VERSION = 2;

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

  // ─── Estado / migraciones (P1-3) ───────────────────────────

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      materia: [],
      empaques: [],
      toppings: [],
      productos: [],
      ventas: [],
      config: { email: '' }
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
      config: (raw.config && typeof raw.config === 'object') ? raw.config : {}
    };
    if (s.config.email === undefined) s.config.email = '';

    // v1 → v2: productos ganan empaquesUsados[] / empaqueManual (heredado
    // del costo manual de empaque de la versión anterior a toppings/empaque).
    s.productos = s.productos.map(function (p) {
      var out = Object.assign({}, p);
      if (!Array.isArray(out.ingredientes)) out.ingredientes = [];
      if (!Array.isArray(out.empaquesUsados)) out.empaquesUsados = [];
      if (out.empaqueManual === undefined) out.empaqueManual = out.empaque || 0;
      // productos[].costo ya NO se persiste como snapshot (P0-2) — si viene
      // de un estado viejo se ignora; se recalcula siempre en vivo.
      delete out.costo;
      return out;
    });

    s.materia = s.materia.map(function (m) { return Object.assign({ minimo: 100 }, m); });
    s.empaques = s.empaques.map(function (e) { return Object.assign({ minimo: 10, unidad: 'unidad' }, e); });
    s.toppings = s.toppings.map(function (t) { return Object.assign({ minimo: 5 }, t); });

    s.ventas = s.ventas.map(function (v) {
      var out = Object.assign({}, v);
      if (!Array.isArray(out.items)) out.items = [];
      if (out.stockInsuficiente === undefined) out.stockInsuficiente = false;
      return out;
    });

    return s;
  }

  // ─── Costeo de producto (P0-2: siempre en vivo, nunca cacheado) ───

  function getCostoProducto(producto, state) {
    if (!producto) return 0;
    var costo = Number(producto.empaqueManual) || 0;
    (producto.ingredientes || []).forEach(function (i) {
      var m = (state.materia || []).find(function (x) { return x.id === i.materiaId; });
      if (m) costo += (Number(m.costo) || 0) * (Number(i.gramos) || 0);
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
        (p.ingredientes || []).forEach(function (i) {
          add('materia', i.materiaId, (Number(i.gramos) || 0) * qty);
        });
        (p.empaquesUsados || []).forEach(function (e) {
          add('empaques', e.empaqueId, (Number(e.cantidad) || 0) * qty);
        });
      }
      (line.toppings || []).forEach(function (t) {
        var totQty = (Number(t.qty) || 0) * qty;
        if (totQty > 0) add('toppings', t.toppingId, totQty);
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
            (p.ingredientes || []).forEach(function (i) {
              add('materia', i.materiaId, (Number(i.gramos) || 0) * item.qty);
            });
            (p.empaquesUsados || []).forEach(function (e) {
              add('empaques', e.empaqueId, (Number(e.cantidad) || 0) * item.qty);
            });
          }
        } else if (item.toppingId) {
          add('toppings', item.toppingId, Number(item.qty) || 0);
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
          (p.ingredientes || []).forEach(function (ing) {
            deduct('materia', state.materia, ing.materiaId, (Number(ing.gramos) || 0) * qty);
          });
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
      id: opts.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      fecha: opts.fecha || new Date().toISOString(),
      items: items,
      total: total,
      ganancia: ganancia,
      stockInsuficiente: !!opts.stockInsuficiente,
      consumoReal: consumoReal
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
            (p.ingredientes || []).forEach(function (ing) {
              var m = (state.materia || []).find(function (x) { return x.id === ing.materiaId; });
              if (m) m.cantidad += (Number(ing.gramos) || 0) * item.qty;
            });
            (p.empaquesUsados || []).forEach(function (e) {
              var m = (state.empaques || []).find(function (x) { return x.id === e.empaqueId; });
              if (m) m.cantidad += (Number(e.cantidad) || 0) * item.qty;
            });
          }
        } else if (item.toppingId) {
          var t = (state.toppings || []).find(function (x) { return x.id === item.toppingId; });
          if (t) t.cantidad += item.qty;
        }
      });
    }
    state.ventas = state.ventas.filter(function (v) { return v.id !== venta.id; });
  }

  // ─── Dependencias (P1-4: no romper recetas al borrar un insumo) ───

  function findProductosUsandoMateria(state, materiaId) {
    return (state.productos || []).filter(function (p) {
      return (p.ingredientes || []).some(function (i) { return i.materiaId === materiaId; });
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
    findProductosUsandoEmpaque: findProductosUsandoEmpaque
  };
});

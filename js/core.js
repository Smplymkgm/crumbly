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

  var SCHEMA_VERSION = 10;

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

  // I3 (auditoría): sin cota superior, una venta con fecha futura (typo
  // al digitar, o reloj de un dispositivo mal puesto) aparecía en
  // CUALQUIER período consultado, pasado o presente — nunca quedaba
  // fuera. `ref` es "hasta cuándo" además de "desde cuándo".
  function getVentasByPeriod(ventas, period, ref) {
    var start = getDateStart(period, ref);
    var end = ref ? new Date(ref) : new Date();
    return (ventas || []).filter(function (v) { var f = new Date(v.fecha); return f >= start && f <= end; });
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
      mermas: [],
      ajustes: [],
      snapshots: [],
      conteoEnProgreso: {},
      lotes: [], // P1.3: bitácora de producción de preparaciones
      clientes: [],
      // factorPrestacional (C3) va también acá, no solo en el bloque de
      // defaults de migrateState más abajo — ese bloque nunca corre para
      // un estado nuevo (raw null/no-objeto), que devuelve ESTE literal
      // directo por el early-return de migrateState. Bug real encontrado
      // al verificar en el navegador: un usuario nuevo (sin estado
      // previo) quedaba con factorPrestacional undefined.
      config: { email: '', backendUrl: '', backendToken: '', lastSync: null, factorPrestacional: 1.38, comportamientoCategorias: {} }
    };
  }

  // Migración v9 (auditoría de costeo, hallazgo raíz): antes de esta
  // versión, registrarGasto() inflaba el costoCompraUnitario de insumos
  // margenVariable un +8% ANTES de mezclarlo al promedio ponderado, así que
  // el costo en libros converge a 1,08x el precio realmente pagado en vez
  // de a la realidad. Recalcula reproduciendo el historial de compras de
  // cada insumo SIN el recargo. No hace falta reconstruir el consumo
  // intermedio (ventas/mermas): cada gasto de inventario ya guardó su
  // propio cantidadAntes/costoAntes reales (P0-1), y el costo unitario solo
  // cambia al comprar, nunca al consumir. Si el primer registro del
  // historial no trae esos snapshots (datos viejos/incompletos), no hay
  // base para reconstruir: se deflacta el costo actual por el factor
  // efectivo, y el cambio queda trazado en state.ajustes (nunca silencioso).
  function recalcularValuacionV9(state) {
    var buckets = [['materia', state.materia], ['empaques', state.empaques], ['toppings', state.toppings]];
    buckets.forEach(function (b) {
      var tipo = b[0], lista = b[1] || [];
      lista.forEach(function (insumo) {
        var historial = (state.gastos || [])
          .filter(function (g) { return g.tipo === 'inventario' && g.insumoTipo === tipo && g.insumoId === insumo.id && g.margenVariabilidadAplicado; })
          .sort(function (a, c) { return new Date(a.fecha) - new Date(c.fecha); });
        if (!historial.length) return;

        var costoAntesCorreccion = insumo.costo;
        var suficiente = isFinite(historial[0].costoAntes) && isFinite(historial[0].cantidadAntes);
        var runningCosto = historial[0].costoAntes;
        if (suficiente) {
          historial.forEach(function (g) {
            var cant = Number(g.cantidad) || 0;
            var monto = Number(g.monto) || 0;
            if (cant <= 0 || monto <= 0 || !isFinite(g.cantidadAntes)) { suficiente = false; return; }
            runningCosto = costoPromedioPonderado(runningCosto, g.cantidadAntes, monto / cant, cant);
          });
        }

        if (suficiente) {
          insumo.costo = runningCosto;
        } else {
          var factor = historial[historial.length - 1].margenVariabilidadAplicado || MARGEN_VARIABILIDAD_PCT;
          insumo.costo = costoAntesCorreccion / (1 + factor);
        }

        state.ajustes.push({
          id: genId(),
          fecha: new Date().toISOString(),
          tipo: 'valuacion',
          insumoTipo: tipo,
          insumoId: insumo.id,
          cantidadAjuste: 0,
          costoAntes: costoAntesCorreccion,
          costoDespues: insumo.costo,
          valorAjuste: (insumo.costo - costoAntesCorreccion) * (Number(insumo.cantidad) || 0),
          motivo: 'corrección de valuación v9',
          usuarioEmail: '',
          nota: suficiente ? 'recalculado desde historial de compras' : 'historial insuficiente, deflactado por factor efectivo'
        });
      });
    });
  }

  // Migra un estado crudo (posiblemente de una versión vieja o incompleto)
  // a la forma actual. Nunca lanza, nunca destruye datos existentes:
  // solo agrega lo que falta. Ver HANDOFF.md P1-3.
  function migrateState(raw) {
    var base = emptyState();
    if (!raw || typeof raw !== 'object') return base;

    // v8 -> v9: se corrige ANTES de sobreescribir schemaVersion más abajo —
    // si el estado que llega ya viene en v9, la corrección de valuación NO
    // se vuelve a aplicar (idempotente por versión, no por recálculo).
    var necesitaCorreccionV9 = (Number(raw.schemaVersion) || 0) < 9;

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
      mermas: Array.isArray(raw.mermas) ? raw.mermas : [], // v7 -> v8
      ajustes: Array.isArray(raw.ajustes) ? raw.ajustes : [], // v8 -> v9
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [], // v8 -> v9 (B1)
      // Conteo físico en curso, sin cerrar (B2): { 'tipo:id': { cantidad,
      // motivo, observaciones } }. Vive en el estado (no en localStorage
      // suelto) para que sobreviva un reload y se sincronice entre
      // dispositivos igual que todo lo demás — es justo lo que hace falta
      // para "contar materia prima hoy, toppings mañana".
      conteoEnProgreso: (raw.conteoEnProgreso && typeof raw.conteoEnProgreso === 'object') ? raw.conteoEnProgreso : {},
      lotes: Array.isArray(raw.lotes) ? raw.lotes : [], // v9 -> v10 (P1.3)
      config: (raw.config && typeof raw.config === 'object') ? raw.config : {}
    };
    if (s.config.email === undefined) s.config.email = '';
    // Fase E — backend en Google Sheets (HANDOFF.md §12): config de
    // sincronización, vacía hasta que el usuario despliegue su propio
    // Apps Script y pegue la URL + token (backend/SETUP.md).
    if (s.config.backendUrl === undefined) s.config.backendUrl = '';
    if (s.config.backendToken === undefined) s.config.backendToken = '';
    if (s.config.lastSync === undefined) s.config.lastSync = null;
    // C3 (auditoría de costeo): NO se hardcodea en 1.52 — con salarios
    // bajo 10 SMMLV aplica la exoneración del art. 114-1 del ET (sin
    // SENA, ICBF ni salud del empleador), así que el factor real casi
    // siempre es menor. 1.38 es un valor por defecto razonable, editable
    // desde Ajustes — nunca se asume que aplica sin que alguien lo
    // confirme para su propia nómina.
    if (s.config.factorPrestacional === undefined) s.config.factorPrestacional = 1.38;
    // C4: comportamiento de costo por categoría operativa — { categoria:
    // { comportamiento: 'fijo'|'variable'|'mixto', pctVariable } }. Vacío
    // por defecto: una categoría sin clasificar se trata como 'fijo' (el
    // atajo tradicional), hasta que alguien la reclasifique a propósito.
    if (!s.config.comportamientoCategorias || typeof s.config.comportamientoCategorias !== 'object') s.config.comportamientoCategorias = {};

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
      var out = Object.assign({ modo: 'porcentaje', baseGramos: 0, rendimientoPct: 100, cantidad: 0, faltante: 0 }, prep); // rendimientoPct: v9 (B3) ; cantidad: v9 (B4, WIP) ; faltante: v10 (P1.2)
      if (!Array.isArray(out.componentes)) out.componentes = [];
      return out;
    });

    // v6 → v7: rediseño (DISENO_HANDOFF.md) — categoría libre para filtrar
    // en Inventario, adiciones (insumo vendible como extra en una venta,
    // con su propio precio y porción consumida por unidad vendida), y
    // comprobante de pago en ventas/gastos con método de pago transferencia.
    var conAdiciones = function (defaults) {
      return function (item) {
        var out = Object.assign({ categoria: '', esAdicion: false, precioAdicion: 0, porcion: 0, nombreAdicion: '', faltante: 0 }, defaults, item); // faltante: v9 (A2)
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
      // v9 -> v10 (P0.3): NO se rellenan `items[].costoAlimento`/
      // `costoEmpaque` en ventas viejas con la proporción de HOY —
      // a propósito. Rellenarlas sería inventar un dato medido que nunca
      // se tomó; se quedan sin los campos y getCostoDesglosadoVentaItem
      // cae a su fallback (proporción vigente, aproximado y documentado
      // como deuda histórica). Así se distingue lo medido de lo estimado
      // en vez de borrar la diferencia.
      return out;
    });

    s.gastos = s.gastos.map(function (g) {
      return Object.assign({ comprobante: '' }, g);
    });

    // v8 -> v9 (auditoría de costeo, hallazgo raíz): quita de la valuación
    // el +8% de margenVariable que registrarGasto aplicaba antes de esta
    // versión (ver recalcularValuacionV9 abajo).
    if (necesitaCorreccionV9) recalcularValuacionV9(s);

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
    // B3 (auditoría de costeo, I1): el costo/consumo se reparte sobre los
    // gramos OBTENIDOS (post-merma de cocción/evaporación), no sobre los
    // gramos de insumos que entraron — si no, toda preparación con
    // rendimiento < 100% queda subcosteada y su consumo teórico expandido
    // sale corto (la varianza de mañana lo leería como faltante fantasma).
    var rendimientoPct = prep.rendimientoPct === undefined ? 100 : Number(prep.rendimientoPct);
    var gramosObtenidos = gramosTotal * (rendimientoPct / 100);
    if (gramosObtenidos > 0) {
      Object.keys(acumMateria).forEach(function (mid) { porGramo[mid] = acumMateria[mid] / gramosObtenidos; });
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
    // gramosObtenidos (B3): base real de reparto. costoTotal se calcula
    // sobre ella, no sobre gramosTotal (insumos) — costoPorGramo ya está
    // en base "por gramo obtenido", así que costoTotal debe conservar el
    // costo real de los insumos sin importar el rendimiento.
    var rendimientoPct = prep && prep.rendimientoPct !== undefined ? Number(prep.rendimientoPct) : 100;
    var gramosObtenidos = gramosTotal * (rendimientoPct / 100);
    return { costoPorGramo: costoPorGramo, gramosTotal: gramosTotal, gramosObtenidos: gramosObtenidos, costoTotal: costoPorGramo * gramosObtenidos };
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
  // Único punto que conoce esta expansión — computeSaleConsumption,
  // getConsumptionRolling, applyVenta, registrarMerma y el fallback
  // legado de revertVenta lo reusan, en vez de repetirlo 5 veces. Sigue
  // siendo el motor único (P1.1): lo único que cambia es `opts.modo`.
  //
  //   modo 'crudo' (default, compatible con el comportamiento de
  //   siempre): una preparación SIEMPRE se expande hasta materia prima,
  //   nunca llega a apply() como 'preparaciones'. Es lo correcto para un
  //   reporte de qué comprar (getConsumptionRolling) — tener salsa hoy no
  //   cambia cuánta materia prima hace falta en 15 días.
  //
  //   modo 'stock': primero descuenta lo que alcance del STOCK YA
  //   PRODUCIDO de la preparación (`apply('preparaciones', id, ...)`), y
  //   solo el resto —lo que ese stock no cubre— se expande a materia
  //   prima cruda, en la MISMA llamada (P1.2: consumo parcial, nunca
  //   todo-o-nada — salió salsa de la nevera Y ADEMÁS se usó materia
  //   prima). Es lo correcto para todo lo que descuenta stock de verdad:
  //   applyVenta, computeSaleConsumption, checkStockShortage,
  //   registrarMerma de un producto.
  //
  // LIMITACIÓN CONOCIDA, documentada a propósito (Ronda 2, opción
  // conservadora): en `computeSaleConsumption` (simulación de PRE-venta,
  // de solo lectura), si el mismo carrito tiene dos líneas DISTINTAS que
  // usan la MISMA preparación, cada línea lee `prep.cantidad` por
  // separado (nunca se muta en la simulación) y ambas pueden creer que
  // el stock completo está disponible — el aviso de faltante podría
  // subestimarse en ese caso puntual. La deducción REAL (applyVenta) no
  // tiene este problema: `apply` sí muta el estado entre líneas, así que
  // la segunda línea ve correctamente lo que ya consumió la primera.
  function aplicarComponentes(state, componentes, qty, apply, opts) {
    var modo = (opts && opts.modo) || 'crudo';
    (componentes || []).forEach(function (c) {
      var cantidad = (Number(c.gramos) || 0) * qty;
      if (c.tipo === 'empaques' || c.tipo === 'toppings') {
        apply(c.tipo, c.refId, cantidad);
      } else if (c.tipo === 'preparacion' && modo === 'stock') {
        var prep = getPreparacion(state, c.refId);
        var disponible = prep ? Math.max(0, Number(prep.cantidad) || 0) : 0;
        var deStock = Math.min(disponible, cantidad);
        var resto = cantidad - deStock;
        if (deStock > 0) apply('preparaciones', c.refId, deStock);
        if (resto > 0) {
          var expandidoResto = expandGramosAMateria(state, c.tipo, c.refId, resto);
          Object.keys(expandidoResto).forEach(function (mid) { apply('materia', mid, expandidoResto[mid]); });
        }
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
    var rendimientoPct = input.rendimientoPct !== undefined ? Number(input.rendimientoPct) : 100;
    var prep = { id: id, nombre: nombre, modo: modo, baseGramos: Number(input.baseGramos) || 0, componentes: componentes, rendimientoPct: rendimientoPct };
    var idx = state.preparaciones.findIndex(function (x) { return x.id === id; });
    if (idx === -1) {
      prep.cantidad = 0;
      prep.faltante = 0;
      state.preparaciones.push(prep);
    } else {
      // B4/P1.2: `cantidad` y `faltante` son stock de WIP (y su deuda),
      // no una propiedad de la receta — editar porcentajes/rendimiento no
      // debe borrarlos (esta asignación reemplaza el objeto completo).
      prep.cantidad = state.preparaciones[idx].cantidad;
      prep.faltante = state.preparaciones[idx].faltante;
      state.preparaciones[idx] = prep;
    }
    return prep;
  }

  // Produce un lote de una preparación (B4, WIP): descuenta las materias
  // primas expandidas (reusa aplicarComponentes — mismo motor que
  // applyVenta/registrarMerma, incluida la recursión si un componente es
  // otra preparación) y acredita los gramos REALMENTE obtenidos al stock
  // de la preparación. rendimientoPct se actualiza con el dato medido de
  // ESTE lote (no un promedio histórico — la fórmula del encargo pide el
  // dato medido, sin especificar un suavizado).
  //
  // input: { preparacionId, multiplicador (tamaño del lote, en "veces la
  //          receta base"), gramosObtenidos (medido), fecha, usuarioEmail }
  // P1.3: produce un lote y lo deja en `state.lotes[]` — bitácora
  // auditable, mismo patrón que ventas/gastos/mermas (consumoReal +
  // faltanteGenerado, revertible con eliminarLote). `rendimientoPct` de
  // la preparación YA NO se sobreescribe acá: es un valor configurado
  // por quien administra la receta, y solo cambia si esa persona lo
  // cambia a propósito — antes, un solo lote mal digitado alteraba en
  // silencio el costeo de todos los productos que usan la preparación.
  // `rendimientoObservado` de ESTE lote queda igual en el registro, para
  // que `getPromedioRendimientoObservado` pueda sugerirlo después.
  function producirPreparacion(state, input) {
    input = input || {};
    var prep = getPreparacion(state, input.preparacionId);
    if (!prep) throw new Error('Preparación no encontrada');
    var multiplicador = Number(input.multiplicador) || 0;
    if (multiplicador <= 0) throw new Error('El tamaño del lote debe ser mayor a 0');
    var gramosObtenidos = Number(input.gramosObtenidos);
    if (!isFinite(gramosObtenidos) || gramosObtenidos <= 0) throw new Error('Los gramos obtenidos deben ser mayores a 0');

    // Cada componente de la receta, resuelto a gramos absolutos para ESTE
    // lote (gramosDeComponentePreparacion ya sabe leer porcentaje/directo).
    var resueltos = (prep.componentes || []).map(function (c) {
      return { tipo: c.tipo, refId: c.refId, gramos: gramosDeComponentePreparacion(prep, c) * multiplicador };
    });
    var gramosTeoricos = resueltos.reduce(function (a, c) { return a + c.gramos; }, 0);

    var consumoReal = { materia: {}, empaques: {}, toppings: {} };
    var faltanteGenerado = { materia: {}, empaques: {}, toppings: {} };
    function deduct(bucket, id, cant) {
      var m = (state[bucket] || []).find(function (x) { return x.id === id; });
      if (!m || cant <= 0) return;
      var antes = m.cantidad;
      var deficit = Math.max(0, cant - antes); // mismo criterio que A2/applyVenta: nunca se pierde el déficit
      m.cantidad = Math.max(0, antes - cant);
      var real = antes - m.cantidad;
      consumoReal[bucket][id] = (consumoReal[bucket][id] || 0) + real;
      if (deficit > 0) {
        m.faltante = (Number(m.faltante) || 0) + deficit;
        faltanteGenerado[bucket][id] = (faltanteGenerado[bucket][id] || 0) + deficit;
      }
    }
    aplicarComponentes(state, resueltos, 1, deduct);

    var rendimientoObservado = gramosTeoricos > 0 ? (gramosObtenidos / gramosTeoricos) * 100 : null;
    prep.cantidad = (Number(prep.cantidad) || 0) + gramosObtenidos;

    // Costo del lote a los costos VIGENTES en este momento (mismo
    // criterio que registrarGasto/registrarMerma: costo al momento de la
    // transacción, no una cifra recalculada después).
    var costoTotal = 0;
    ['materia', 'empaques', 'toppings'].forEach(function (bucket) {
      Object.keys(consumoReal[bucket]).forEach(function (iid) {
        var item = (state[bucket] || []).find(function (x) { return x.id === iid; });
        if (item) costoTotal += consumoReal[bucket][iid] * (Number(item.costo) || 0);
      });
    });

    var lote = {
      id: genId(), preparacionId: prep.id, fecha: input.fecha || new Date().toISOString(),
      usuarioEmail: input.usuarioEmail || '', multiplicador: multiplicador,
      gramosTeoricos: gramosTeoricos, gramosObtenidos: gramosObtenidos,
      rendimientoObservado: rendimientoObservado,
      consumoReal: consumoReal, faltanteGenerado: faltanteGenerado,
      costoTotal: costoTotal
    };
    state.lotes.push(lote);
    return lote;
  }

  // Revierte un lote: repone el consumo real (materia/empaques/toppings),
  // su faltante generado, y el stock que se le había acreditado a la
  // preparación — mismo patrón que eliminarGasto/eliminarMerma. Nunca
  // deja `cantidad` de la preparación negativa (si parte de ese stock ya
  // se vendió/mermó desde entonces, no hay forma de saber con certeza
  // cuánto le corresponde a este lote específico — mismo criterio que
  // revertVenta con `faltante`).
  function eliminarLote(state, id) {
    var lote = (state.lotes || []).find(function (l) { return l.id === id; });
    if (!lote) return;
    function restore(bucket) {
      Object.keys(lote.consumoReal[bucket] || {}).forEach(function (iid) {
        var m = (state[bucket] || []).find(function (x) { return x.id === iid; });
        if (m) m.cantidad += lote.consumoReal[bucket][iid];
      });
    }
    function restoreFaltante(bucket) {
      Object.keys((lote.faltanteGenerado || {})[bucket] || {}).forEach(function (iid) {
        var m = (state[bucket] || []).find(function (x) { return x.id === iid; });
        if (m) m.faltante = Math.max(0, (Number(m.faltante) || 0) - lote.faltanteGenerado[bucket][iid]);
      });
    }
    ['materia', 'empaques', 'toppings'].forEach(restore);
    ['materia', 'empaques', 'toppings'].forEach(restoreFaltante);
    var prep = getPreparacion(state, lote.preparacionId);
    if (prep) prep.cantidad = Math.max(0, (Number(prep.cantidad) || 0) - lote.gramosObtenidos);
    state.lotes = state.lotes.filter(function (l) { return l.id !== id; });
  }

  // Promedio de rendimiento OBSERVADO (medido) de los últimos `n` lotes
  // de una preparación — la sugerencia que la app puede mostrar con un
  // botón para adoptarla; nunca se aplica solo. Ver nota en
  // producirPreparacion sobre por qué rendimientoPct ya no se
  // sobreescribe automáticamente.
  function getPromedioRendimientoObservado(state, preparacionId, n) {
    n = n || 5;
    var lotes = (state.lotes || [])
      .filter(function (l) { return l.preparacionId === preparacionId && l.rendimientoObservado !== null && l.rendimientoObservado !== undefined; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); })
      .slice(0, n);
    if (!lotes.length) return null;
    return lotes.reduce(function (a, l) { return a + l.rendimientoObservado; }, 0) / lotes.length;
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

  // Costo del producto si los insumos de precio volátil (margenVariable)
  // subieran `pct` — escenario informativo (auditoría de costeo, hallazgo
  // raíz de C9/A1: el +8% ya NO se mete en la valuación real). Se reusa
  // getCostoProducto sobre una copia de las listas de insumos con el costo
  // ya subido, en vez de reescribir el recorrido de componentes.
  function getCostoConVolatilidad(state, productoId, pct) {
    var p = (state.productos || []).find(function (x) { return x.id === productoId; });
    if (!p) return 0;
    var factor = 1 + (Number(pct) || 0);
    function bump(list) {
      return (list || []).map(function (i) {
        return i.margenVariable ? Object.assign({}, i, { costo: (Number(i.costo) || 0) * factor }) : i;
      });
    }
    var stateBump = Object.assign({}, state, {
      materia: bump(state.materia),
      empaques: bump(state.empaques),
      toppings: bump(state.toppings)
    });
    return getCostoProducto(p, stateBump);
  }

  // C1 (auditoría de costeo): el empaque hoy va MEZCLADO dentro del costo
  // del plato — Toast y R365 lo reportan como línea aparte ("paper cost").
  // Esta función desglosa exactamente el mismo recorrido que
  // getCostoProducto (misma suma, particionada) — costoAlimento +
  // costoEmpaque === costoTotal, y costoTotal es idéntico a lo que ya
  // devuelve getCostoProducto. Se agrega aparte, sin tocar
  // getCostoProducto ni su firma, para no romper a ninguno de sus
  // llamadores actuales (applyVenta, registrarMerma, getMargenProducto...).
  function getCostoProductoDesglosado(producto, state) {
    if (!producto) return { costoAlimento: 0, costoEmpaque: 0, costoTotal: 0 };
    var costoAlimento = 0;
    var costoEmpaque = Number(producto.empaqueManual) || 0;
    (producto.componentes || []).forEach(function (c) {
      var gramos = Number(c.gramos) || 0;
      if (c.tipo === 'preparacion') {
        costoAlimento += gramos * getPreparacionCosto(state, c.refId).costoPorGramo;
      } else if (c.tipo === 'empaques') {
        var emp = (state.empaques || []).find(function (x) { return x.id === c.refId; });
        if (emp) costoEmpaque += gramos * (Number(emp.costo) || 0);
      } else if (c.tipo === 'toppings') {
        // Un topping es comestible — food cost, no paper cost — aunque
        // esté modelado en la misma colección que empaques a nivel de
        // COLECCION_POR_TIPO.
        var top = (state.toppings || []).find(function (x) { return x.id === c.refId; });
        if (top) costoAlimento += gramos * (Number(top.costo) || 0);
      } else {
        var m = (state.materia || []).find(function (x) { return x.id === c.refId; });
        if (m) costoAlimento += gramos * (Number(m.costo) || 0);
      }
    });
    (producto.empaquesUsados || []).forEach(function (e) {
      var m = (state.empaques || []).find(function (x) { return x.id === e.empaqueId; });
      if (m) costoEmpaque += (Number(m.costo) || 0) * (Number(e.cantidad) || 0);
    });
    return { costoAlimento: costoAlimento, costoEmpaque: costoEmpaque, costoTotal: costoAlimento + costoEmpaque };
  }

  // Desglosa el costo YA CONGELADO de una línea de venta (item.costo,
  // fijado en applyVenta al momento de vender — mismo dato que ya usa
  // computeCascada para el COGS del período) en alimento/empaque,
  // prorrateado según la proporción VIGENTE de la receta actual del
  // producto. No se recalcula el costo total en vivo a propósito: si se
  // hiciera, el food+paper cost del período dejaría de sumar exactamente
  // el mismo COGS que ya reporta Caja/Reportes — sería una tercera cifra
  // de costo de ventas distinta, justo el problema que señala la
  // auditoría en su hallazgo raíz (Sección 0). Un topping suelto o una
  // adición no tienen empaque propio: van 100% a alimento.
  function getCostoDesglosadoVentaItem(item, state) {
    var qty = Number(item.qty) || 0;
    // P0.3: el camino normal es el desglose que la venta ya congeló en
    // el momento de venderse (costoAlimento/costoEmpaque por unidad,
    // igual convención que `costo`). Antes esto recalculaba con la
    // receta VIGENTE — cambiar hoy el empaque de una receta reescribía
    // en silencio el desglose de cada venta pasada de ese producto (el
    // total seguía congelado, pero el split entre alimento/empaque no).
    if (item.costoAlimento !== undefined && item.costoEmpaque !== undefined) {
      return { costoAlimento: item.costoAlimento * qty, costoEmpaque: item.costoEmpaque * qty };
    }
    // Deuda histórica, NO el camino normal: ventas de antes de esta
    // versión no tienen el desglose propio — se estima prorrateando el
    // costo YA CONGELADO con la proporción alimento/empaque VIGENTE de
    // la receta actual (aproximación, documentada, nunca se backfillea).
    var costoTotalItem = (Number(item.costo) || 0) * qty;
    if (item.productoId) {
      var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
      if (p) {
        var d = getCostoProductoDesglosado(p, state);
        if (d.costoTotal > 0) {
          var pctEmpaque = d.costoEmpaque / d.costoTotal;
          return { costoAlimento: costoTotalItem * (1 - pctEmpaque), costoEmpaque: costoTotalItem * pctEmpaque };
        }
      }
    }
    return { costoAlimento: costoTotalItem, costoEmpaque: 0 };
  }

  function costosDesglosadosPeriodo(state, ventasPeriodo) {
    var costoAlimento = 0, costoEmpaque = 0, ingresos = 0;
    (ventasPeriodo || []).forEach(function (v) {
      ingresos += Number(v.total) || 0;
      (v.items || []).forEach(function (item) {
        var d = getCostoDesglosadoVentaItem(item, state);
        costoAlimento += d.costoAlimento;
        costoEmpaque += d.costoEmpaque;
      });
    });
    return { costoAlimento: costoAlimento, costoEmpaque: costoEmpaque, ingresos: ingresos };
  }

  // Food cost % y paper cost % del período — ratio (0-1), igual criterio
  // que margenPct. Ver getCostoDesglosadoVentaItem para de dónde sale el
  // desglose y por qué no recalcula el costo total en vivo.
  function getFoodCostPct(state, period, ref) {
    var d = costosDesglosadosPeriodo(state, getVentasByPeriod(state.ventas, period, ref));
    return d.ingresos > 0 ? d.costoAlimento / d.ingresos : 0;
  }
  function getPaperCostPct(state, period, ref) {
    var d = costosDesglosadosPeriodo(state, getVentasByPeriod(state.ventas, period, ref));
    return d.ingresos > 0 ? d.costoEmpaque / d.ingresos : 0;
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
    var consumo = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };
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
        // P1.2: modo 'stock' — es lo que realmente va a salir del
        // inventario si se confirma la venta (ver limitación conocida de
        // P1.1 sobre dos líneas que compartan la misma preparación).
        aplicarComponentes(state, p.componentes, qty, add, { modo: 'stock' });
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
    check('preparaciones', state.preparaciones); // P1.2 — por construcción nunca marca faltante (aplicarComponentes en modo 'stock' nunca pide más de lo disponible), pero se deja por completitud y consistencia con los demás buckets.
    return faltantes;
  }

  // ─── Necesidades de inventario (P1-1: materia + empaque + toppings) ───

  // Consumo real de los últimos `days` días (ventana móvil, P1-2),
  // agregado por tipo+id, recorriendo AMBOS tipos de ítem de venta
  // (productoId y toppingId — antes solo se miraba productoId).
  // Expande el consumo teórico de un conjunto YA FILTRADO de ventas —
  // compartido por getConsumptionRolling (ventana móvil de N días) y
  // getConsumptionEnRango (D1: rango exacto de fechas, para que la
  // varianza compare el mismo período que el snapshot inicial/final, sin
  // el redondeo a días enteros de la ventana móvil).
  function consumoTeoricoDeVentas(state, ventas) {
    var consumo = { materia: {}, empaques: {}, toppings: {} };
    function add(bucket, id, cant) {
      consumo[bucket][id] = (consumo[bucket][id] || 0) + cant;
    }
    (ventas || []).forEach(function (v) {
      (v.items || []).forEach(function (item) {
        if (item.productoId) {
          var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
          if (p) {
            // P1.1: modo 'crudo' A PROPÓSITO y explícito — este es el
            // reporte de qué comprar. Tener salsa hoy no cambia cuánta
            // materia prima hace falta en 15 días.
            aplicarComponentes(state, p.componentes, item.qty, add, { modo: 'crudo' });
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
  function getConsumptionRolling(state, days, ref) {
    return consumoTeoricoDeVentas(state, getVentasRolling(state.ventas, days || 7, ref));
  }
  // D1: mismo motor, pero sobre un rango exacto [startISO, endISO] — la
  // varianza necesita el consumo teórico del MISMO período que cubren
  // los snapshots, no una ventana de N días redondeados.
  function getConsumptionEnRango(state, startISO, endISO) {
    return consumoTeoricoDeVentas(state, getVentasByRange(state.ventas, startISO, endISO));
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
    validarFechaNoFutura(opts.fecha); // I3
    const items = [];
    let total = 0, ganancia = 0;
    // P1.2: preparaciones es un bucket más de consumoReal/faltanteGenerado
    // — mismo campo, mismo comportamiento que materia/empaques/toppings.
    const consumoReal = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };
    // A2: lo que la venta no alcanzó a descontar por falta de stock ya NO
    // se pierde en el clamp a 0 — se acumula en insumo.faltante (deuda de
    // inventario) y se registra aquí para que revertVenta pueda deshacerla
    // exacta, igual que consumoReal.
    const faltanteGenerado = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };

    function deduct(bucket, list, id, cantidad) {
      const m = (list || []).find(function (x) { return x.id === id; });
      if (!m || cantidad <= 0) return;
      const antes = m.cantidad;
      const deficit = Math.max(0, cantidad - antes);
      m.cantidad = Math.max(0, antes - cantidad);
      const real = antes - m.cantidad;
      consumoReal[bucket][id] = (consumoReal[bucket][id] || 0) + real;
      if (deficit > 0) {
        m.faltante = (Number(m.faltante) || 0) + deficit;
        faltanteGenerado[bucket][id] = (faltanteGenerado[bucket][id] || 0) + deficit;
      }
    }

    (lineas || []).forEach(function (line) {
      var qty = Number(line.qty) || 0;
      if (line.productoId && qty > 0) {
        var p = (state.productos || []).find(function (x) { return x.id === line.productoId; });
        if (p) {
          var costo = getCostoProducto(p, state);
          // P0.3: congela el desglose alimento/empaque AQUÍ, con la
          // receta vigente EN ESTE MOMENTO — no se recalcula después con
          // la receta de otro día (ver getCostoDesglosadoVentaItem).
          var desglose = getCostoProductoDesglosado(p, state);
          items.push({ productoId: p.id, nombre: p.nombre, qty: qty, precio: p.precio, costo: costo, costoAlimento: desglose.costoAlimento, costoEmpaque: desglose.costoEmpaque });
          total += p.precio * qty;
          ganancia += (p.precio - costo) * qty;
          // P1.2: modo 'stock' — descuenta primero lo que alcance del
          // stock ya producido de la preparación; el resto (o todo, si
          // no hay stock) se expande a materia prima. Es lo que
          // realmente sale del inventario.
          aplicarComponentes(state, p.componentes, qty, function (bucket, id, cant) { deduct(bucket, state[bucket], id, cant); }, { modo: 'stock' });
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
          // Un topping es 100% alimento — no tiene empaque propio (mismo criterio que C1).
          items.push({ toppingId: top.id, nombre: top.nombre + ' (topping)', qty: totQty, precio: top.precio, costo: top.costo, costoAlimento: top.costo, costoEmpaque: 0 });
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
        // Una adición tampoco tiene empaque propio.
        items.push({ adicionId: adId, nombre: (found.item.nombreAdicion || found.item.nombre) + ' (adición)', qty: qty, precio: precio, costo: costoUnit, costoAlimento: costoUnit, costoEmpaque: 0 });
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
        items.push({ toppingId: top.id, nombre: top.nombre + ' (topping suelto)', qty: q, precio: top.precio, costo: top.costo, costoAlimento: top.costo, costoEmpaque: 0 });
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
      faltanteGenerado: faltanteGenerado,
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
      restore('preparaciones', state.preparaciones); // P1.2: dos niveles — repone el stock de la preparación tal cual se descontó
      // A2: deshace también el faltante que esta venta haya generado —
      // nunca por debajo de 0 (si ya se saldó parcialmente con una compra
      // posterior antes de revertir, no se puede reconstruir con certeza
      // cuánto de ese pago corresponde a esta venta).
      function restoreFaltante(bucket, list) {
        Object.keys((venta.faltanteGenerado || {})[bucket] || {}).forEach(function (id) {
          var m = (list || []).find(function (x) { return x.id === id; });
          if (m) m.faltante = Math.max(0, (Number(m.faltante) || 0) - venta.faltanteGenerado[bucket][id]);
        });
      }
      restoreFaltante('materia', state.materia);
      restoreFaltante('empaques', state.empaques);
      restoreFaltante('toppings', state.toppings);
      restoreFaltante('preparaciones', state.preparaciones);
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
  // C3: qué categorías de gasto operativo son costo LABORAL — hoy solo
  // "Nómina", pero se deja como lista (no un `=== 'Nómina'` suelto) para
  // que sumar una categoría laboral nueva no obligue a tocar getPrimeCost.
  var GASTO_CATEGORIAS_LABORALES = ['Nómina'];

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

    // metodoPago: mismo campo/valores que ya usa registrarVenta
    // ('efectivo'/'transferencia'), más 'dividido' — a pedido explícito,
    // para un gasto pagado en parte en efectivo y en parte por
    // transferencia. montoEfectivo/montoTransferencia solo se guardan con
    // 'dividido'; no se valida que sumen el monto total (queda a criterio
    // de quien registra, la app solo lo refleja).
    var metodoPago = input.metodoPago || 'efectivo';
    var gasto = {
      id: input.id || genId(),
      fecha: input.fecha || new Date().toISOString(),
      tipo: input.tipo,
      categoria: input.categoria || '',
      descripcion: input.descripcion || '',
      monto: monto,
      proveedor: input.proveedor || '',
      comprobante: input.comprobante || '',
      metodoPago: metodoPago,
      montoEfectivo: metodoPago === 'dividido' ? (Number(input.montoEfectivo) || 0) : 0,
      montoTransferencia: metodoPago === 'dividido' ? (Number(input.montoTransferencia) || 0) : 0
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
      gasto.faltanteAntes = Number(insumo.faltante) || 0;

      // v9 (auditoría de costeo, hallazgo raíz): el costo de inventario es
      // el precio pagado, sin recargo. margenVariable ya NO toca la
      // valuación — solo alimenta getCostoConVolatilidad() como escenario
      // informativo. Antes de v9 esto aplicaba un +8% aquí mismo; retirado.
      var costoCompraUnitario = monto / cantidad;
      // A2: esta compra salda primero la deuda de faltante (ventas que se
      // descontaron de más porque no había stock) — solo lo que sobra
      // después de saldarla entra al promedio ponderado y al stock. Si no
      // sobra nada, el costo NO se toca (comprar 0 neto no es una compra a
      // ningún precio).
      var faltanteActual = gasto.faltanteAntes;
      var saldaFaltante = Math.min(faltanteActual, cantidad);
      var netoParaStock = cantidad - saldaFaltante;
      if (netoParaStock > 0) {
        insumo.costo = costoPromedioPonderado(insumo.costo, insumo.cantidad, costoCompraUnitario, netoParaStock);
      }
      insumo.cantidad = (Number(insumo.cantidad) || 0) + netoParaStock;
      insumo.faltante = faltanteActual - saldaFaltante;
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
        if (gasto.faltanteAntes !== undefined) insumo.faltante = gasto.faltanteAntes; // A2
      }
    }
    state.gastos = state.gastos.filter(function (g) { return g.id !== id; });
  }

  // I3: misma cota superior que getVentasByPeriod, mismo motivo.
  function getGastosByPeriod(gastos, period, ref) {
    var start = getDateStart(period, ref);
    var end = ref ? new Date(ref) : new Date();
    return (gastos || []).filter(function (g) { var f = new Date(g.fecha); return f >= start && f <= end; });
  }

  // ─── Mermas (pérdidas de inventario: vencido, dañado, quemado, error de
  // preparación, contaminado, derrame, rotura, no vendido, etc.) ──────────
  //
  // Una merma es un movimiento de INVENTARIO, nunca de Caja: nunca toca
  // state.ventas ni state.gastos. No existía una tabla genérica de
  // "movimientos de inventario" en el proyecto — se sigue exactamente el
  // mismo patrón que ya usan ventas/gastos (su propio array + una función
  // que aplica y otra que revierte, con un snapshot `consumoReal` para
  // poder deshacer con precisión exacta, igual que P0-1 en applyVenta y el
  // mismo snapshot en registrarGasto/eliminarGasto) en vez de inventar una
  // tabla nueva.
  //
  // El origen de una merma puede ser un insumo con stock propio (materia/
  // empaques/toppings, descuento 1:1) o un producto preparado (receta/BOM):
  // en ese caso se reusa aplicarComponentes — el mismo motor de expansión
  // que ya usan applyVenta/computeSaleConsumption/getConsumptionRolling —
  // para descontar los insumos reales de la receta, sin inventar un
  // segundo sistema de costeo ni un stock propio para "productos".
  var MERMA_MOTIVOS = ['Vencido', 'Dañado', 'Quemado', 'Error de preparación', 'Contaminado', 'Derrame', 'Rotura', 'No vendido', 'Otro'];

  function getMermaOrigenList(state, origenTipo) {
    if (origenTipo === 'materia') return state.materia;
    if (origenTipo === 'empaques') return state.empaques;
    if (origenTipo === 'toppings') return state.toppings;
    if (origenTipo === 'producto') return state.productos;
    if (origenTipo === 'preparacion') return state.preparaciones; // B4 (WIP)
    return null;
  }

  // Registra una merma: valida, calcula el valor con el motor de costeo que
  // ya existe (getCostoProducto para un producto preparado; el costo propio
  // del insumo para materia/empaques/toppings), descuenta el inventario
  // real (clampeado a 0, nunca negativo — mismo criterio que applyVenta) y
  // guarda `consumoReal` para poder revertir exacto. No valida el stock
  // disponible aquí (igual que applyVenta): eso lo hace el llamador antes,
  // por separado, para poder avisar y pedir confirmación sin bloquear el
  // registro — la arquitectura ya contempla esto (P0-3).
  function registrarMerma(state, input) {
    var cantidad = Number(input.cantidad) || 0;
    if (cantidad <= 0) throw new Error('La cantidad de la merma debe ser mayor a 0');
    if (!input.motivo || !String(input.motivo).trim()) throw new Error('El motivo de la merma es obligatorio');
    validarFechaNoFutura(input.fecha); // I3
    var origenTipo = input.origenTipo;
    var list = getMermaOrigenList(state, origenTipo);
    if (!list) throw new Error('Tipo de origen inválido');
    var origen = list.find(function (x) { return x.id === input.origenId; });
    if (!origen) throw new Error('Producto o insumo no encontrado');

    var consumoReal = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };
    // P1.2: mismo mecanismo de faltante que A2 (nunca se pierde el
    // déficit en el clamp a 0) — necesario ahora que una merma de
    // producto puede cascadear preparación → materia prima, igual que
    // una venta.
    var faltanteGenerado = { materia: {}, empaques: {}, toppings: {}, preparaciones: {} };
    function deduct(bucket, id, cant) {
      var l = state[bucket];
      var m = (l || []).find(function (x) { return x.id === id; });
      if (!m || cant <= 0) return;
      var antes = m.cantidad;
      var deficit = Math.max(0, cant - antes);
      m.cantidad = Math.max(0, antes - cant);
      var real = antes - m.cantidad;
      consumoReal[bucket][id] = (consumoReal[bucket][id] || 0) + real;
      if (deficit > 0) {
        m.faltante = (Number(m.faltante) || 0) + deficit;
        faltanteGenerado[bucket][id] = (faltanteGenerado[bucket][id] || 0) + deficit;
      }
    }

    var costoUnitario;
    if (origenTipo === 'producto') {
      costoUnitario = getCostoProducto(origen, state);
      // P1.2: modo 'stock' — se botó el producto terminado, con la
      // preparación que ya tenía adentro (si había stock de sobra).
      aplicarComponentes(state, origen.componentes, cantidad, deduct, { modo: 'stock' });
      (origen.empaquesUsados || []).forEach(function (e) {
        deduct('empaques', e.empaqueId, (Number(e.cantidad) || 0) * cantidad);
      });
    } else if (origenTipo === 'preparacion') {
      // B4: se merma el WIP ya producido (descuento directo 1:1, NO se
      // vuelve a expandir a materia prima — esa materia ya se descontó
      // cuando se produjo el lote). El costo es el de la preparación
      // misma (getPreparacionCosto), que no tiene campo `costo` propio.
      costoUnitario = getPreparacionCosto(state, origen.id).costoPorGramo;
      deduct('preparaciones', origen.id, cantidad);
    } else {
      costoUnitario = Number(origen.costo) || 0;
      deduct(origenTipo, origen.id, cantidad);
    }

    var merma = {
      id: input.id || genId(),
      fecha: input.fecha || new Date().toISOString(),
      origenTipo: origenTipo,
      origenId: origen.id,
      cantidad: cantidad,
      costoUnitario: costoUnitario,
      valorTotal: costoUnitario * cantidad,
      motivo: String(input.motivo).trim(),
      observaciones: input.observaciones || '',
      usuario: input.usuario || '',
      stockInsuficiente: !!input.stockInsuficiente,
      consumoReal: consumoReal,
      faltanteGenerado: faltanteGenerado
    };
    state.mermas.push(merma);
    return merma;
  }

  // Revierte una merma exacta (usa merma.consumoReal) — mismo principio que
  // revertVenta: no recalcula desde la receta/insumo actual (que pudo
  // cambiar desde entonces), restaura justo lo que se descontó.
  function eliminarMerma(state, id) {
    var merma = (state.mermas || []).find(function (m) { return m.id === id; });
    if (!merma) return;
    function restore(bucket) {
      Object.keys(merma.consumoReal[bucket] || {}).forEach(function (iid) {
        var m = (state[bucket] || []).find(function (x) { return x.id === iid; });
        if (m) m.cantidad += merma.consumoReal[bucket][iid];
      });
    }
    restore('materia');
    restore('empaques');
    restore('toppings');
    restore('preparaciones'); // B4 (WIP)
    // P1.2: mismo criterio que revertVenta — deshace el faltante que
    // esta merma haya generado, nunca por debajo de 0.
    function restoreFaltante(bucket) {
      Object.keys((merma.faltanteGenerado || {})[bucket] || {}).forEach(function (iid) {
        var m = (state[bucket] || []).find(function (x) { return x.id === iid; });
        if (m) m.faltante = Math.max(0, (Number(m.faltante) || 0) - merma.faltanteGenerado[bucket][iid]);
      });
    }
    restoreFaltante('materia');
    restoreFaltante('empaques');
    restoreFaltante('toppings');
    restoreFaltante('preparaciones');
    state.mermas = state.mermas.filter(function (m) { return m.id !== id; });
  }

  // I3: misma cota superior que getVentasByPeriod, mismo motivo.
  function getMermasByPeriod(mermas, period, ref) {
    var start = getDateStart(period, ref);
    var end = ref ? new Date(ref) : new Date();
    return (mermas || []).filter(function (m) { var f = new Date(m.fecha); return f >= start && f <= end; });
  }
  function getMermasByRange(mermas, startISO, endISO) {
    var b = rangeBounds(startISO, endISO);
    return (mermas || []).filter(function (m) { var f = new Date(m.fecha); return f >= b.start && f <= b.end; });
  }
  function getValorTotalMermas(mermas) {
    return (mermas || []).reduce(function (a, m) { return a + m.valorTotal; }, 0);
  }
  function agruparMermasPorMotivo(mermas) {
    var out = {};
    (mermas || []).forEach(function (m) {
      var key = m.motivo || '(sin motivo)';
      out[key] = (out[key] || 0) + m.valorTotal;
    });
    return out;
  }
  // Nombre del insumo/producto de origen, resuelto en vivo (no snapshot) —
  // mismo criterio que registrarGasto/insumoId: si el ítem se borró después,
  // se muestra "(eliminado)" en vez de fallar.
  function getMermaOrigenNombre(state, merma) {
    var list = getMermaOrigenList(state, merma.origenTipo);
    var item = list && list.find(function (x) { return x.id === merma.origenId; });
    return item ? item.nombre : '(eliminado)';
  }
  function agruparMermasPorOrigen(state, mermas) {
    var out = {};
    (mermas || []).forEach(function (m) {
      var key = getMermaOrigenNombre(state, m);
      if (!out[key]) out[key] = { cantidad: 0, valor: 0 };
      out[key].cantidad += m.cantidad;
      out[key].valor += m.valorTotal;
    });
    return out;
  }

  // ─── Snapshots de inventario (B1 — conteo físico) ──────────────────
  //
  // Un snapshot agregado (solo el valor total) hace imposible calcular la
  // varianza POR INSUMO después — por eso cada snapshot guarda el detalle
  // línea por línea (insumoTipo/insumoId/cantidad/costoUnitario/valor),
  // nunca solo un número. tipo 'sistema' congela las cantidades que el
  // estado tiene en ese momento (teórico); tipo 'conteo' congela lo que
  // alguien contó físicamente — y puede ser parcial: lo que no se contó se
  // lista aparte en `noContados`, nunca se asume en cero.

  function getValorInventario(state) {
    function valorBucket(list) {
      return (list || []).reduce(function (acc, i) { return acc + (Number(i.cantidad) || 0) * (Number(i.costo) || 0); }, 0);
    }
    var materia = valorBucket(state.materia);
    var empaques = valorBucket(state.empaques);
    var toppings = valorBucket(state.toppings);
    // B4 (parcial: solo valorización): una preparación no tiene `costo`
    // propio como insumo, su costo/gramo se deriva (getPreparacionCosto) —
    // sin este bucket, toda la masa/salsa ya producida y guardada en la
    // nevera el día del conteo queda invisible en el valor de inventario.
    var preparaciones = (state.preparaciones || []).reduce(function (acc, p) {
      return acc + (Number(p.cantidad) || 0) * getPreparacionCosto(state, p.id).costoPorGramo;
    }, 0);
    return { total: materia + empaques + toppings + preparaciones, materia: materia, empaques: empaques, toppings: toppings, preparaciones: preparaciones };
  }

  var SNAPSHOT_BUCKETS = ['materia', 'empaques', 'toppings', 'preparaciones']; // P0.2: preparaciones ya es un bucket contable más

  // input: { tipo: 'sistema'|'conteo', fecha, usuarioEmail, nota,
  //          conteo: [{ insumoTipo, insumoId, cantidad }] }  // solo 'conteo'
  // P0.2 (Ronda 2): el conteo físico también debe poder cubrir el WIP de
  // preparaciones — sin eso, la masa/salsas que están en la nevera el día
  // del conteo quedan fuera del snapshot para siempre y
  // COGS = inicial + compras − final las trata como consumidas, un hueco
  // que no se puede rellenar después. `listaDeBucket`/`costoUnitarioDe`
  // resuelven los 4 buckets contables de forma uniforme (preparaciones no
  // tiene campo `costo` propio — se deriva con getPreparacionCosto, igual
  // que ya hacía el snapshot de sistema).
  function listaDeBucket(state, tipo) {
    return tipo === 'preparaciones' ? state.preparaciones : getInsumoList(state, tipo);
  }
  function costoUnitarioDe(state, tipo, item) {
    return tipo === 'preparaciones' ? getPreparacionCosto(state, item.id).costoPorGramo : (Number(item.costo) || 0);
  }

  function crearSnapshot(state, input) {
    input = input || {};
    var tipo = input.tipo === 'conteo' ? 'conteo' : 'sistema';
    var lineas = [];
    var noContados = [];
    var bucketsContados = {};

    if (tipo === 'sistema') {
      SNAPSHOT_BUCKETS.forEach(function (b) {
        (listaDeBucket(state, b) || []).forEach(function (item) {
          var cantidad = Number(item.cantidad) || 0;
          var costoUnitario = costoUnitarioDe(state, b, item);
          lineas.push({ insumoTipo: b, insumoId: item.id, cantidad: cantidad, costoUnitario: costoUnitario, valor: cantidad * costoUnitario });
        });
        bucketsContados[b] = true; // 'sistema' toma TODO lo que hay, siempre "completo" por definición
      });
    } else {
      var contadosSet = {};
      var bucketsConAlgunaLinea = {};
      (input.conteo || []).forEach(function (c) {
        var lista = listaDeBucket(state, c.insumoTipo);
        var item = lista && lista.find(function (x) { return x.id === c.insumoId; });
        if (!item) return;
        var cantidad = Number(c.cantidad) || 0;
        var costoUnitario = costoUnitarioDe(state, c.insumoTipo, item);
        lineas.push({ insumoTipo: c.insumoTipo, insumoId: c.insumoId, cantidad: cantidad, costoUnitario: costoUnitario, valor: cantidad * costoUnitario });
        contadosSet[c.insumoTipo + ':' + c.insumoId] = true;
        bucketsConAlgunaLinea[c.insumoTipo] = true;
      });
      SNAPSHOT_BUCKETS.forEach(function (b) {
        var lista = listaDeBucket(state, b) || [];
        lista.forEach(function (item) {
          if (!contadosSet[b + ':' + item.id]) noContados.push({ insumoTipo: b, insumoId: item.id });
        });
        // Bucket sin ningún insumo registrado en el sistema: no hay nada
        // que contar, trivialmente completo. Bucket CON insumos pero
        // ninguno tocado en este conteo: el bucket entero se marca sin
        // contar — nunca se asume cero ni "igual al teórico" (P2.1 lo usa
        // para bloquear la varianza cuando falta el WIP).
        bucketsContados[b] = lista.length === 0 || !!bucketsConAlgunaLinea[b];
      });
    }

    var valorTotal = lineas.reduce(function (a, l) { return a + l.valor; }, 0);
    var snap = {
      id: genId(),
      fecha: input.fecha || new Date().toISOString(),
      tipo: tipo,
      usuarioEmail: input.usuarioEmail || '',
      nota: input.nota || '',
      lineas: lineas,
      noContados: noContados,
      bucketsContados: bucketsContados,
      valorTotal: valorTotal
    };
    state.snapshots.push(snap);
    return snap;
  }

  // Snapshot más reciente de `tipo` (si se da) en o antes de `fecha` (si no
  // se da, "ahora"). Usado por D1 para ubicar el snapshot inicial/final de
  // un período de varianza.
  function getSnapshotMasReciente(state, fecha, tipo) {
    var ref = fecha ? new Date(fecha) : new Date();
    var candidatos = (state.snapshots || []).filter(function (sn) {
      return (!tipo || sn.tipo === tipo) && new Date(sn.fecha) <= ref;
    });
    candidatos.sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
    return candidatos[0] || null;
  }

  // ─── Conteo físico (B2) ─────────────────────────────────────────────
  //
  // Motivo de un AJUSTE de conteo — deliberadamente distinto de
  // MERMA_MOTIVOS: una merma es una causa de pérdida ya conocida al
  // momento de perderla; un ajuste de conteo es la explicación de una
  // diferencia encontrada después, con otras causas típicas (incluida
  // "merma no registrada" — la merma que nadie anotó a tiempo).
  var AJUSTE_MOTIVOS = ['Merma no registrada', 'Error de porcionado', 'Error de recepción', 'Robo', 'Error de digitación', 'Otro'];

  // Vista previa de un conteo antes de confirmarlo: por cada línea contada,
  // la diferencia contra el teórico actual, valorizada al costo VIGENTE, y
  // si esa línea va a exigir motivo al cerrar. No muta nada — el conteo
  // puede guardarse parcial varias veces antes de cerrarse.
  function previsualizarConteo(state, lineas) {
    var out = (lineas || []).map(function (l) {
      // P0.2: listaDeBucket/costoUnitarioDe (definidas junto a
      // crearSnapshot) también resuelven 'preparaciones' — antes esto
      // usaba getInsumoList, que no las conoce, así que una línea de
      // preparación se descartaba en silencio (.filter(Boolean) más
      // abajo se comía el null sin avisar).
      var lista = listaDeBucket(state, l.insumoTipo);
      var insumo = lista && lista.find(function (x) { return x.id === l.insumoId; });
      if (!insumo) return null;
      var teorica = Number(insumo.cantidad) || 0;
      var contada = Number(l.cantidadContada) || 0;
      var diferencia = contada - teorica;
      var costoVigente = costoUnitarioDe(state, l.insumoTipo, insumo);
      return {
        insumoTipo: l.insumoTipo, insumoId: l.insumoId, nombre: insumo.nombre,
        teorica: teorica, contada: contada, diferencia: diferencia,
        costoVigente: costoVigente, valor: diferencia * costoVigente,
        requiereMotivo: diferencia !== 0
      };
    }).filter(Boolean);
    var totalDiferenciaValor = out.reduce(function (a, l) { return a + l.valor; }, 0);
    return { lineas: out, totalDiferenciaValor: totalDiferenciaValor };
  }

  // Cierra un conteo: valida TODAS las líneas antes de tocar nada (una
  // línea con diferencia y sin motivo hace fallar el cierre completo, sin
  // aplicar las demás a medias), luego por cada línea con diferencia
  // registra un ajuste trazado (mismo `state.ajustes[]` de la migración
  // v9/A1) y deja `insumo.cantidad` en lo contado. Genera además el
  // snapshot tipo 'conteo' con exactamente lo que se contó en este cierre.
  //
  // input: { usuarioEmail, fecha, nota,
  //          lineas: [{ insumoTipo, insumoId, cantidadContada, motivo, observaciones }] }
  function cerrarConteo(state, input) {
    input = input || {};
    var lineas = input.lineas || [];
    var resueltas = lineas.map(function (l) {
      var lista = listaDeBucket(state, l.insumoTipo); // P0.2: incluye 'preparaciones'
      var insumo = lista && lista.find(function (x) { return x.id === l.insumoId; });
      if (!insumo) throw new Error('Insumo no encontrado en el conteo');
      var teorica = Number(insumo.cantidad) || 0;
      var contada = Number(l.cantidadContada) || 0;
      var diferencia = contada - teorica;
      if (diferencia !== 0 && !(l.motivo && String(l.motivo).trim())) {
        throw new Error('Falta el motivo del ajuste en "' + insumo.nombre + '" (diferencia de ' + diferencia + ')');
      }
      return { insumo: insumo, insumoTipo: l.insumoTipo, insumoId: l.insumoId, teorica: teorica, contada: contada, diferencia: diferencia, motivo: l.motivo, observaciones: l.observaciones || '' };
    });

    var fecha = input.fecha || new Date().toISOString();
    var ajustesCreados = [];
    resueltas.forEach(function (r) {
      if (r.diferencia === 0) return;
      // Una preparación no tiene `.costo` propio — se deriva igual que
      // en crearSnapshot/previsualizarConteo.
      var costoVigente = costoUnitarioDe(state, r.insumoTipo, r.insumo);
      var ajuste = {
        id: genId(), fecha: fecha, tipo: 'conteo',
        insumoTipo: r.insumoTipo, insumoId: r.insumoId,
        cantidadAjuste: r.diferencia, costoAntes: costoVigente, costoDespues: costoVigente,
        valorAjuste: r.diferencia * costoVigente,
        motivo: r.motivo, observaciones: r.observaciones,
        usuarioEmail: input.usuarioEmail || '', nota: input.nota || ''
      };
      state.ajustes.push(ajuste);
      ajustesCreados.push(ajuste);
      r.insumo.cantidad = r.contada;
    });

    var snapshot = crearSnapshot(state, {
      tipo: 'conteo', fecha: fecha, usuarioEmail: input.usuarioEmail, nota: input.nota,
      conteo: resueltas.map(function (r) { return { insumoTipo: r.insumoTipo, insumoId: r.insumoId, cantidad: r.contada }; })
    });

    var totalDiferenciaValor = ajustesCreados.reduce(function (a, j) { return a + j.valorAjuste; }, 0);
    return { snapshot: snapshot, ajustes: ajustesCreados, totalDiferenciaValor: totalDiferenciaValor };
  }

  // ─── Rango de fechas personalizable (Reportes) ─────────────
  // `new Date('YYYY-MM-DD')` se interpreta como medianoche UTC — en
  // cualquier huso horario detrás de UTC (Colombia, UTC-5) eso corre la
  // fecha un día hacia atrás en hora local. Se construye la fecha local
  // a mano para que el rango sea exactamente el que se ve en el selector.
  // I3 (auditoría): una fecha futura en una venta o una merma (typo al
  // digitar, o el reloj de un dispositivo mal puesto) antes no se
  // rechazaba en ningún punto — solo se hacía visible cuando otro
  // reporte sin cota superior (ver I3 arriba) la mostraba donde no
  // debía. Se corta en el origen, no en cada reporte que la lee después.
  function validarFechaNoFutura(fecha) {
    if (!fecha) return;
    if (new Date(fecha).getTime() > Date.now()) throw new Error('La fecha no puede ser futura');
  }
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

  // Depreciación prorrateada al período de reportes seleccionado (día/
  // semana/mes/año). I5 (auditoría): antes usaba factores FIJOS (mes=1,
  // año=12) sin importar cuántos días habían transcurrido realmente del
  // período — el día 1 de un mes mostraba la depreciación del mes
  // COMPLETO, igual que el día 28. Reusa la misma proración por días
  // transcurridos que ya usa correctamente getDepreciacionRango.
  function getDepreciacionPeriodo(state, period, ref) {
    var end = ref ? new Date(ref) : new Date();
    var start = getDateStart(period, ref);
    var mensual = getDepreciacionMensualTotal(state, end);
    var dias = Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
    return mensual * (dias / 30);
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
  //
  // `mermasValor` (opcional, default 0 — por eso no rompe a nadie que
  // llame computeCascada con la firma vieja de 3 argumentos) resta de la
  // utilidad neta: una merma es una pérdida económica real aunque nunca
  // haya movido un peso de la caja. NO se resta de flujoCaja — ese campo
  // es estrictamente efectivo que entró/salió de la caja, y una merma no
  // es una salida de caja (mismo criterio que ya aplica la depreciación,
  // que tampoco toca flujoCaja).
  // C2 (auditoría de costeo): la merma es inventario que se fue sin
  // vender — es costo de ventas por definición, igual que lo que sí se
  // vendió. Antes se restaba DEBAJO de la utilidad bruta (al nivel de
  // gastos operativos), lo que dejaba el food cost/margen bruto
  // estructuralmente por debajo del real. Se mueve dentro del costo de
  // ventas — la utilidad neta final no cambia, solo dónde aparece la
  // línea (verificado con test: idéntica antes/después).
  function computeCascada(ventas, gastos, depreciacion, mermasValor) {
    mermasValor = Number(mermasValor) || 0;
    var ingresos = ventas.reduce(function (a, v) { return a + v.total; }, 0);
    var gananciaVentas = ventas.reduce(function (a, v) { return a + v.ganancia; }, 0);
    var costoVentas = (ingresos - gananciaVentas) + mermasValor;
    var utilidadBruta = ingresos - costoVentas;

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
      mermas: mermasValor,
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
    var mermasValor = getValorTotalMermas(getMermasByPeriod(state.mermas, period, ref));
    return computeCascada(ventas, gastosPeriodo, depreciacion, mermasValor);
  }

  // Misma cascada, para un rango de fechas elegido a mano (no uno de los
  // períodos fijos Hoy/Semana/Mes/Año) — HANDOFF: "registros... fecha
  // personalizable".
  function getCascadaUtilidadRango(state, startISO, endISO) {
    var ventas = getVentasByRange(state.ventas, startISO, endISO);
    var gastosRango = getGastosByRange(state.gastos, startISO, endISO);
    var depreciacion = getDepreciacionRango(state, startISO, endISO);
    var mermasValor = getValorTotalMermas(getMermasByRange(state.mermas, startISO, endISO));
    return computeCascada(ventas, gastosRango, depreciacion, mermasValor);
  }

  // C3 (auditoría de costeo): nómina REGISTRADA (lo que efectivamente se
  // pagó/anotó como gasto) cargada por el factor prestacional configurado
  // — sin ese cargo, comparar el food cost contra el prime cost siempre
  // sale optimista, porque la nómina real de Colombia trae encima
  // prestaciones sociales + seguridad social + parafiscales que nunca
  // aparecen en lo que se anota día a día.
  function getCostoLaboral(state, startISO, endISO) {
    var gastosRango = getGastosByRange(state.gastos, startISO, endISO);
    var factor = (state.config && isFinite(Number(state.config.factorPrestacional))) ? Number(state.config.factorPrestacional) : 1.38;
    var nominaRegistrada = gastosRango
      .filter(function (g) { return g.tipo === 'operativo' && GASTO_CATEGORIAS_LABORALES.indexOf(g.categoria) !== -1; })
      .reduce(function (a, g) { return a + g.monto; }, 0);
    return { nominaRegistrada: nominaRegistrada, factorPrestacional: factor, costoLaboralCargado: nominaRegistrada * factor };
  }

  // Prime cost % = (costo de ventas + costo laboral cargado) / ingresos.
  // Reusa computeCascada para el costo de ventas (mismo COGS que ya
  // reporta Caja/Reportes tras C2, mermas incluidas) — no inventa un
  // segundo cálculo de costo de ventas.
  function getPrimeCost(state, startISO, endISO) {
    var ventas = getVentasByRange(state.ventas, startISO, endISO);
    var ingresos = ventas.reduce(function (a, v) { return a + v.total; }, 0);
    var gastosRango = getGastosByRange(state.gastos, startISO, endISO);
    var mermasValor = getValorTotalMermas(getMermasByRange(state.mermas, startISO, endISO));
    var cogs = computeCascada(ventas, gastosRango, 0, mermasValor).costoVentas;
    var laboral = getCostoLaboral(state, startISO, endISO);
    var primeCostTotal = cogs + laboral.costoLaboralCargado;
    return {
      cogs: cogs,
      nominaRegistrada: laboral.nominaRegistrada,
      factorPrestacional: laboral.factorPrestacional,
      costoLaboral: laboral.costoLaboralCargado,
      ingresos: ingresos,
      primeCostTotal: primeCostTotal,
      primeCostPct: ingresos > 0 ? primeCostTotal / ingresos : 0
    };
  }

  // C4: comportamiento de costo por categoría operativa. Sin clasificar
  // → 'fijo' (el atajo tradicional, nunca se asume 'variable' sin que
  // alguien lo confirme).
  function getComportamientoCategoria(state, categoria) {
    var cfg = (state.config && state.config.comportamientoCategorias) || {};
    var c = cfg[categoria];
    if (!c) return { comportamiento: 'fijo', pctVariable: 0 };
    var pct = Math.min(1, Math.max(0, Number(c.pctVariable) || 0));
    return { comportamiento: c.comportamiento === 'variable' || c.comportamiento === 'mixto' ? c.comportamiento : 'fijo', pctVariable: pct };
  }

  // Separa un conjunto de gastos operativos en su porción fija y su
  // porción variable (monto, en pesos — la porción variable se convierte
  // a ratio-sobre-ingresos en getBreakEven, que es quien conoce los
  // ingresos del período).
  function getCostosFijosYVariables(state, gastosOperativos) {
    var fijo = 0, variableMonto = 0;
    (gastosOperativos || []).forEach(function (g) {
      var c = getComportamientoCategoria(state, g.categoria);
      if (c.comportamiento === 'variable') {
        variableMonto += g.monto;
      } else if (c.comportamiento === 'mixto') {
        variableMonto += g.monto * c.pctVariable;
        fijo += g.monto * (1 - c.pctVariable);
      } else {
        fijo += g.monto;
      }
    });
    return { fijo: fijo, variableMonto: variableMonto };
  }

  // Contribución promedio ponderada por mix (por volumen, no por
  // producto) — reusa item.precio/item.costo ya congelados en cada venta
  // (el mismo dato que ya construye `ganancia`, ver applyVenta): no hay
  // costo fijo prorrateado por producto en este modelo (ver nota en
  // getMargenProducto), así que CM unitario === margen unitario.
  function getCMPonderado(state, ventas) {
    var totalQty = 0, cmTotalPesos = 0, ingresosTotal = 0;
    (ventas || []).forEach(function (v) {
      (v.items || []).forEach(function (item) {
        var qty = Number(item.qty) || 0;
        var cmUnit = (Number(item.precio) || 0) - (Number(item.costo) || 0);
        totalQty += qty;
        cmTotalPesos += cmUnit * qty;
        ingresosTotal += (Number(item.precio) || 0) * qty;
      });
    });
    return {
      cmPromedioPesos: totalQty > 0 ? cmTotalPesos / totalQty : 0,
      cmPromedioRatio: ingresosTotal > 0 ? cmTotalPesos / ingresosTotal : 0,
      cmTotalPesos: cmTotalPesos,
      ingresosTotal: ingresosTotal
    };
  }

  // Punto de equilibrio del período — dos versiones, porque responden
  // preguntas distintas (auditoría de costeo, hallazgo de metodología):
  // - bepContable: con la depreciación dentro de los costos fijos (lo que
  //   diría un estado de resultados).
  // - bepCaja: SIN depreciación (no es salida de caja) pero CON el capex
  //   completo del período (sí lo es) — cuánta plata hay que facturar
  //   para no quedarse sin caja, no para "no perder en libros".
  //
  // El costo operativo 'variable'/'mixto' se convierte a un ratio sobre
  // ingresos del MISMO período (aproximación: asume que ese gasto escaló
  // proporcional a las ventas de este período) y se resta del CM ratio —
  // un gasto variable también reduce lo que queda por cada peso vendido,
  // no es "costo fijo que no se cuenta".
  //
  // OJO (no adivinar la dirección del error): tratar todo lo operativo
  // como fijo NO siempre subestima el punto de equilibrio. Subestima solo
  // cuando el negocio está por debajo de su propio equilibrio (CM ratio <
  // costos operativos/ventas); si es rentable, el atajo SOBREestima. Ver
  // el test con los dos escenarios — no hay ninguna heurística acá que
  // asuma una dirección fija.
  function getBreakEven(state, startISO, endISO) {
    var b = rangeBounds(startISO, endISO);
    var dias = Math.max(1, (b.end - b.start) / (1000 * 60 * 60 * 24));
    var ventas = getVentasByRange(state.ventas, startISO, endISO);
    var gastosRango = getGastosByRange(state.gastos, startISO, endISO);
    var operativos = gastosRango.filter(function (g) { return g.tipo === 'operativo'; });
    var capexPeriodo = gastosRango.filter(function (g) { return g.tipo === 'capex'; }).reduce(function (a, g) { return a + g.monto; }, 0);
    var depreciacion = getDepreciacionRango(state, startISO, endISO);

    var cm = getCMPonderado(state, ventas);
    var clasif = getCostosFijosYVariables(state, operativos);
    var variableOpexRate = cm.ingresosTotal > 0 ? clasif.variableMonto / cm.ingresosTotal : 0;
    var cmRatioAjustado = cm.cmPromedioRatio - variableOpexRate;

    var fijosContable = clasif.fijo + depreciacion;
    var fijosCaja = clasif.fijo + capexPeriodo;
    var bepContable = cmRatioAjustado > 0 ? fijosContable / cmRatioAjustado : Infinity;
    var bepCaja = cmRatioAjustado > 0 ? fijosCaja / cmRatioAjustado : Infinity;

    return {
      cmRatioAjustado: cmRatioAjustado,
      costosFijos: clasif.fijo,
      costosVariablesOperativos: clasif.variableMonto,
      depreciacion: depreciacion,
      capexPeriodo: capexPeriodo,
      bepContable: bepContable,
      bepCaja: bepCaja,
      bepDiarioContable: isFinite(bepContable) ? bepContable / dias : Infinity,
      bepDiarioCaja: isFinite(bepCaja) ? bepCaja / dias : Infinity
    };
  }

  // C5: Menu Engineering — matriz de Kasavana & Smith. Dos cosas que la
  // mayoría implementa mal, y acá no se pueden equivocar:
  // 1. El eje de rentabilidad va en PESOS (CM unitario), nunca en
  //    porcentaje — un producto caro con margen % bajo puede dejar más
  //    plata por unidad que uno barato con margen % alto.
  // 2. El mix (popularidad) y el umbral de rentabilidad se calculan
  //    DENTRO de cada categoría, nunca sobre el menú entero — si no, un
  //    producto barato de alta rotación en su propia categoría (bebidas)
  //    siempre va a perder contra un postre premium y cae en "perro" sin
  //    serlo.
  // Agrupa por productoId, nunca por nombre (dos productos pueden
  // compartir nombre en categorías distintas).
  function getMenuEngineering(state, ventas) {
    var porProducto = {};
    (ventas || []).forEach(function (v) {
      (v.items || []).forEach(function (item) {
        if (!item.productoId) return; // solo productos del menú — toppings sueltos/adiciones no aplican
        var qty = Number(item.qty) || 0;
        var cm = (Number(item.precio) || 0) - (Number(item.costo) || 0);
        var row = porProducto[item.productoId];
        if (!row) {
          var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
          row = porProducto[item.productoId] = {
            productoId: item.productoId,
            nombre: p ? p.nombre : item.nombre,
            categoria: (p && p.categoria) ? p.categoria : '(sin categoría)',
            qty: 0,
            cmTotalPesos: 0
          };
        }
        row.qty += qty;
        row.cmTotalPesos += cm * qty;
      });
    });

    var porCategoria = {};
    // P3.1: ítems planos por categoría (a nivel de línea de venta, no de
    // producto) — es lo que getCMPonderado necesita para calcular el CM
    // ponderado DENTRO de cada categoría, reusando la misma función de
    // C4 en vez de reescribir su fórmula acá.
    var itemsPorCategoria = {};
    (ventas || []).forEach(function (v) {
      (v.items || []).forEach(function (item) {
        if (!item.productoId) return;
        var p = (state.productos || []).find(function (x) { return x.id === item.productoId; });
        var cat = (p && p.categoria) ? p.categoria : '(sin categoría)';
        (itemsPorCategoria[cat] = itemsPorCategoria[cat] || []).push(item);
      });
    });
    Object.keys(porProducto).forEach(function (pid) {
      var row = porProducto[pid];
      row.cmUnitario = row.qty > 0 ? row.cmTotalPesos / row.qty : 0;
      (porCategoria[row.categoria] = porCategoria[row.categoria] || []).push(row);
    });

    var resultado = [];
    Object.keys(porCategoria).forEach(function (categoria) {
      var items = porCategoria[categoria];
      var n = items.length;
      var totalQtyCategoria = items.reduce(function (a, r) { return a + r.qty; }, 0);
      // Umbral de popularidad estándar: (1 / n ítems de la categoría) × 0,70.
      var umbralPopularidad = n > 0 ? (1 / n) * 0.7 : 0;
      // P3.1: umbral de rentabilidad = CM PONDERADO de la categoría (CM
      // total en pesos ÷ unidades totales), reusando getCMPonderado de
      // C4 — no un promedio simple. Un promedio simple es insensible al
      // mix, que es justo lo que la matriz existe para capturar: un
      // producto YA popular puede quedar bajo el ponderado, y esa es
      // exactamente la definición de un caballo de batalla (alta venta,
      // bajo margen) — ponderar no lo protege de caer ahí, lo expone.
      var cmPonderado = getCMPonderado(state, [{ items: itemsPorCategoria[categoria] || [] }]);
      var umbralRentabilidad = cmPonderado.cmPromedioPesos;
      items.forEach(function (r) {
        var mix = totalQtyCategoria > 0 ? r.qty / totalQtyCategoria : 0;
        var esPopular = mix >= umbralPopularidad;
        var esRentable = r.cmUnitario >= umbralRentabilidad;
        var clasificacion = esPopular
          ? (esRentable ? 'estrella' : 'caballo de batalla')
          : (esRentable ? 'enigma' : 'perro');
        resultado.push({
          productoId: r.productoId, nombre: r.nombre, categoria: categoria,
          qty: r.qty, mix: mix, cmUnitario: r.cmUnitario,
          umbralPopularidad: umbralPopularidad, umbralRentabilidad: umbralRentabilidad,
          clasificacion: clasificacion
        });
      });
    });
    return resultado;
  }

  function getLotesByRange(lotes, startISO, endISO) {
    var b = rangeBounds(startISO, endISO);
    return (lotes || []).filter(function (l) { var f = new Date(l.fecha); return f >= b.start && f <= b.end; });
  }

  // P2.1 (Ronda 2): con las ventas consumiendo preparación (P1.2), la
  // varianza de un solo nivel deja de tener sentido — una pérdida de
  // evaporación en cocina y un robo en el mostrador quedaban
  // indistinguibles. Se reestructura en DOS niveles:
  //
  //   Preparaciones:
  //     real     = inicial + producido − final
  //     teórico  = Σ venta.consumoReal.preparaciones del rango (P1.2 ya
  //                lo congela al momento de vender, con el stock REAL de
  //                ese momento — no hay que re-expandir nada)
  //     varianza = real − mermas_preparacion − teórico
  //     → mide sobre-porcionado en el mostrador
  //
  //   Materia prima / empaques / toppings ("materiaPrima"):
  //     real     = inicial + compras − final
  //     teórico  = Σ lote.consumoReal (producir WIP) + Σ venta.consumoReal
  //                (directo, o lo que se cayó de preparación por falta de
  //                stock — P1.2 también lo congela ahí)
  //     varianza = real − mermas − teórico
  //     → mide rendimiento de cocina y pérdida en recepción
  //
  //   Empaques/toppings nunca pasan por una preparación (aplicarComponentes
  //   solo desvía componentes tipo 'preparacion') — viven en el mismo
  //   nivel que materia prima porque su fórmula es idéntica a la de
  //   antes de esta ronda, sin ninguna ambigüedad de "¿de dónde salió?".
  //
  // GUARDAS, todas obligatorias:
  //
  // 1. La de la Ronda 1 se mantiene INTACTA: snapshot inicial o final de
  //    tipo 'sistema' → { suficiente: false }, nunca un número (la
  //    cantidad de sistema se mueve exactamente como
  //    final = inicial + compras − teórico − mermas, así que
  //    inicial + compras − final da teórico + mermas y la varianza sale
  //    CERO por construcción — un cero ahí no significa que no haya
  //    pérdidas, significa que no se midió nada).
  //
  // 2. NUEVA: si el bucket de preparaciones (P0.2) no se contó en el
  //    snapshot inicial o el final, NINGÚN nivel es confiable — ni
  //    siquiera el de materia prima, porque sin saber cuánta salsa quedó
  //    en la nevera no se puede separar lo que se consumió de lo que
  //    sigue ahí. Un snapshot de ANTES de esta ronda ni siquiera tiene
  //    el campo `bucketsContados` — se trata igual que "no contado",
  //    nunca como "sí se contó" por omisión (defensivo a propósito, para
  //    no tener que migrar snapshots viejos).
  //
  // Los insumos que no aparezcan en AMBOS snapshots se excluyen del
  // reporte de su nivel y se listan aparte en `noContados` — nunca se
  // asumen en cero.
  function getVarianza(state, inicioISO, finISO) {
    var snapInicial = getSnapshotMasReciente(state, inicioISO);
    var snapFinal = getSnapshotMasReciente(state, finISO);
    if (!snapInicial || !snapFinal) {
      var faltaSnap = { suficiente: false, motivo: 'Falta un snapshot de conteo en el inicio o el fin del rango — todavía no hay conteo físico registrado ahí.' };
      return { preparaciones: faltaSnap, materiaPrima: faltaSnap };
    }
    if (snapInicial.tipo !== 'conteo' || snapFinal.tipo !== 'conteo') {
      var esSistema = { suficiente: false, motivo: 'El snapshot inicial y/o final es de tipo "sistema", no "conteo": la varianza daría cero por construcción (no porque no haya pérdidas). Hace falta un conteo físico real en ambos extremos del rango.' };
      return { preparaciones: esSistema, materiaPrima: esSistema };
    }
    function prepContado(snap) { return !!(snap.bucketsContados && snap.bucketsContados.preparaciones === true); }
    if (!prepContado(snapInicial) || !prepContado(snapFinal)) {
      var faltaPrep = { suficiente: false, motivo: 'El bucket de preparaciones no se contó en el snapshot inicial y/o final — sin saber cuánta preparación quedó, no se puede separar lo consumido de lo que sigue en la nevera. Ningún nivel de varianza es confiable así.' };
      return { preparaciones: faltaPrep, materiaPrima: faltaPrep };
    }

    function lineasPorKey(snap) {
      var out = {};
      (snap.lineas || []).forEach(function (l) { out[l.insumoTipo + ':' + l.insumoId] = l; });
      return out;
    }
    var inicialPorKey = lineasPorKey(snapInicial);
    var finalPorKey = lineasPorKey(snapFinal);

    var ventasRango = getVentasByRange(state.ventas, inicioISO, finISO);
    var mermasRango = getMermasByRange(state.mermas, inicioISO, finISO);
    var lotesRango = getLotesByRange(state.lotes, inicioISO, finISO);

    var comprasPorKey = {};
    getGastosByRange(state.gastos, inicioISO, finISO)
      .filter(function (g) { return g.tipo === 'inventario' && g.insumoTipo && g.insumoId; })
      .forEach(function (g) {
        var key = g.insumoTipo + ':' + g.insumoId;
        comprasPorKey[key] = (comprasPorKey[key] || 0) + (Number(g.cantidad) || 0);
      });

    // Producido por preparación (lotes del rango).
    var producidoPorPrepId = {};
    lotesRango.forEach(function (l) {
      producidoPorPrepId[l.preparacionId] = (producidoPorPrepId[l.preparacionId] || 0) + (Number(l.gramosObtenidos) || 0);
    });

    // Mermas registradas, por bucket:id — incluye 'preparaciones'.
    var mermaPorKey = {};
    mermasRango.forEach(function (m) {
      ['materia', 'empaques', 'toppings', 'preparaciones'].forEach(function (bucket) {
        Object.keys((m.consumoReal || {})[bucket] || {}).forEach(function (id) {
          var key = bucket + ':' + id;
          mermaPorKey[key] = (mermaPorKey[key] || 0) + m.consumoReal[bucket][id];
        });
      });
    });

    // Teórico de preparaciones = consumoReal.preparaciones de las VENTAS
    // (ya congelado al momento de vender por P1.2 — no se re-expande).
    var teoricoPrepPorId = {};
    ventasRango.forEach(function (v) {
      Object.keys((v.consumoReal || {}).preparaciones || {}).forEach(function (id) {
        teoricoPrepPorId[id] = (teoricoPrepPorId[id] || 0) + v.consumoReal.preparaciones[id];
      });
    });

    // Teórico de materia/empaques/toppings = consumoReal de los LOTES
    // (producir WIP) + consumoReal de las VENTAS (directo, o lo que se
    // cayó de preparación por falta de stock) del rango.
    var teoricoDirectoPorKey = {};
    function sumarTeoricoDirecto(consumoReal) {
      ['materia', 'empaques', 'toppings'].forEach(function (bucket) {
        Object.keys((consumoReal || {})[bucket] || {}).forEach(function (id) {
          var key = bucket + ':' + id;
          teoricoDirectoPorKey[key] = (teoricoDirectoPorKey[key] || 0) + consumoReal[bucket][id];
        });
      });
    }
    lotesRango.forEach(function (l) { sumarTeoricoDirecto(l.consumoReal); });
    ventasRango.forEach(function (v) { sumarTeoricoDirecto(v.consumoReal); });

    function todasLasKeysConPrefijo(prefijo) {
      var out = {};
      Object.keys(inicialPorKey).concat(Object.keys(finalPorKey)).forEach(function (k) {
        if (k.indexOf(prefijo) === 0) out[k] = true;
      });
      return Object.keys(out);
    }

    // ── Nivel preparaciones ──
    var lineasPrep = [], noContadosPrep = [];
    todasLasKeysConPrefijo('preparaciones:').forEach(function (key) {
      var li = inicialPorKey[key], lf = finalPorKey[key];
      if (!li || !lf) {
        var sep = key.indexOf(':');
        noContadosPrep.push({ insumoTipo: key.slice(0, sep), insumoId: key.slice(sep + 1) });
        return;
      }
      var producido = producidoPorPrepId[li.insumoId] || 0;
      var mermaRegistrada = mermaPorKey[key] || 0;
      var teorico = teoricoPrepPorId[li.insumoId] || 0;
      var real = li.cantidad + producido - lf.cantidad;
      var varianzaCantidad = real - mermaRegistrada - teorico;
      lineasPrep.push({
        insumoTipo: 'preparaciones', insumoId: li.insumoId,
        inicial: li.cantidad, producido: producido, final: lf.cantidad,
        real: real, mermaRegistrada: mermaRegistrada, teorico: teorico,
        costoUnitario: lf.costoUnitario,
        varianzaCantidad: varianzaCantidad,
        varianzaValor: varianzaCantidad * lf.costoUnitario,
        varianzaPct: teorico !== 0 ? varianzaCantidad / teorico : null
      });
    });
    lineasPrep.sort(function (a, b) { return b.varianzaValor - a.varianzaValor; });

    // ── Nivel materia prima (+ empaques + toppings) ──
    var lineasMateria = [], noContadosMateria = [];
    ['materia:', 'empaques:', 'toppings:'].forEach(function (prefijo) {
      todasLasKeysConPrefijo(prefijo).forEach(function (key) {
        var li = inicialPorKey[key], lf = finalPorKey[key];
        if (!li || !lf) {
          var sep = key.indexOf(':');
          noContadosMateria.push({ insumoTipo: key.slice(0, sep), insumoId: key.slice(sep + 1) });
          return;
        }
        var compras = comprasPorKey[key] || 0;
        var mermaRegistrada = mermaPorKey[key] || 0;
        var teorico = teoricoDirectoPorKey[key] || 0;
        var real = li.cantidad + compras - lf.cantidad;
        var varianzaCantidad = real - mermaRegistrada - teorico;
        lineasMateria.push({
          insumoTipo: li.insumoTipo, insumoId: li.insumoId,
          inicial: li.cantidad, compras: compras, final: lf.cantidad,
          real: real, mermaRegistrada: mermaRegistrada, teorico: teorico,
          costoUnitario: lf.costoUnitario,
          varianzaCantidad: varianzaCantidad,
          varianzaValor: varianzaCantidad * lf.costoUnitario,
          varianzaPct: teorico !== 0 ? varianzaCantidad / teorico : null
        });
      });
    });
    lineasMateria.sort(function (a, b) { return b.varianzaValor - a.varianzaValor; });

    return {
      preparaciones: { suficiente: true, snapInicialId: snapInicial.id, snapFinalId: snapFinal.id, lineas: lineasPrep, noContados: noContadosPrep },
      materiaPrima: { suficiente: true, snapInicialId: snapInicial.id, snapFinalId: snapFinal.id, lineas: lineasMateria, noContados: noContadosMateria }
    };
  }

  // P2.2: Actual vs Theoretical sobre la varianza CONSOLIDADA de los dos
  // niveles (no sobre uno solo) — food cost REAL % (con lo que de verdad
  // salió del inventario, sumando preparaciones + materia/empaques/
  // toppings) contra food cost TEÓRICO % (con lo que la receta dice que
  // debió salir, según C1). Hereda las guardas nuevas de P2.1: si
  // cualquiera de los dos niveles no es suficiente, tampoco lo es AvT —
  // no tendría sentido consolidar un nivel real con uno que no se pudo
  // medir.
  function getActualVsTheoretical(state, inicioISO, finISO) {
    var varianza = getVarianza(state, inicioISO, finISO);
    if (!varianza.preparaciones.suficiente) return { suficiente: false, motivo: varianza.preparaciones.motivo };
    if (!varianza.materiaPrima.suficiente) return { suficiente: false, motivo: varianza.materiaPrima.motivo };

    var ventas = getVentasByRange(state.ventas, inicioISO, finISO);
    var ingresos = ventas.reduce(function (a, v) { return a + v.total; }, 0);

    // Alimento = materia + toppings + preparaciones (todo lo que no sea
    // empaque es comida, un topping o una salsa preparada incluidos —
    // mismo criterio que C1).
    var costoAlimentoReal = varianza.materiaPrima.lineas
      .filter(function (l) { return l.insumoTipo === 'materia' || l.insumoTipo === 'toppings'; })
      .reduce(function (a, l) { return a + l.real * l.costoUnitario; }, 0)
      + varianza.preparaciones.lineas.reduce(function (a, l) { return a + l.real * l.costoUnitario; }, 0);

    var desgloseTeorico = costosDesglosadosPeriodo(state, ventas);
    var foodCostRealPct = ingresos > 0 ? costoAlimentoReal / ingresos : 0;
    var foodCostTeoricoPct = desgloseTeorico.ingresos > 0 ? desgloseTeorico.costoAlimento / desgloseTeorico.ingresos : 0;

    return {
      suficiente: true,
      ingresos: ingresos,
      costoAlimentoReal: costoAlimentoReal,
      costoAlimentoTeorico: desgloseTeorico.costoAlimento,
      foodCostRealPct: foodCostRealPct,
      foodCostTeoricoPct: foodCostTeoricoPct,
      diferenciaPuntos: (foodCostRealPct - foodCostTeoricoPct) * 100,
      diferenciaRatio: foodCostTeoricoPct !== 0 ? (foodCostRealPct - foodCostTeoricoPct) / foodCostTeoricoPct : null
    };
  }

  // Serie histórica de Actual vs Theoretical: un punto por cada PAR
  // CONSECUTIVO de snapshots de conteo — es la cadencia real de conteos
  // físicos la que define los períodos comparables, no un calendario
  // arbitrario (no tendría snapshots en los bordes). Los períodos sin
  // datos suficientes (par con un 'sistema' de por medio) se incluyen
  // igual, con `suficiente:false`, para que la serie no tenga huecos
  // silenciosos.
  function getActualVsTheoreticalHistorico(state) {
    var snapshotsConteo = (state.snapshots || [])
      .filter(function (sn) { return sn.tipo === 'conteo'; })
      .sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
    var serie = [];
    for (var i = 1; i < snapshotsConteo.length; i++) {
      var inicio = snapshotsConteo[i - 1].fecha;
      var fin = snapshotsConteo[i].fecha;
      var punto = getActualVsTheoretical(state, inicio, fin);
      serie.push(Object.assign({ inicio: inicio, fin: fin }, punto));
    }
    return serie;
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

  // C10 (auditoría): findProductosUsandoMateria/findProductosUsandoEmpaque
  // arriba solo cubren materia en `componentes` y empaque en
  // `empaquesUsados` — el rediseño (DISENO_HANDOFF.md) permite que
  // `componentes` referencie CUALQUIER insumo (empaques o toppings
  // también, no solo materia — ver COLECCION_POR_TIPO en
  // getCostoProducto), y no había ningún chequeo para eso ni para
  // toppings en absoluto. Puerta única para deleteInsumo, sirve para los
  // tres buckets (materia/empaques/toppings): recorre `componentes` SIN
  // filtrar por tipo (cualquier refId que coincida cuenta), más
  // `empaquesUsados`, más las preparaciones que también podrían
  // referenciar el insumo directamente en su propia receta.
  function findProductosUsandoInsumo(state, insumoId) {
    var productos = (state.productos || []).filter(function (p) {
      var enComponentes = (p.componentes || []).some(function (c) { return c.refId === insumoId; });
      var enEmpaquesUsados = (p.empaquesUsados || []).some(function (e) { return e.empaqueId === insumoId; });
      return enComponentes || enEmpaquesUsados;
    });
    var preparaciones = (state.preparaciones || []).filter(function (prep) {
      return (prep.componentes || []).some(function (c) { return c.refId === insumoId; });
    });
    return { productos: productos, preparaciones: preparaciones };
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
    aplicarComponentes: aplicarComponentes,
    getCostoConVolatilidad: getCostoConVolatilidad,
    getCostoProductoDesglosado: getCostoProductoDesglosado,
    getFoodCostPct: getFoodCostPct,
    getPaperCostPct: getPaperCostPct,
    computeSaleConsumption: computeSaleConsumption,
    checkStockShortage: checkStockShortage,
    applyVenta: applyVenta,
    revertVenta: revertVenta,
    getConsumptionRolling: getConsumptionRolling,
    getConsumptionEnRango: getConsumptionEnRango,
    calcInventoryNeeds: calcInventoryNeeds,
    findProductosUsandoMateria: findProductosUsandoMateria,
    findProductosUsandoEmpaque: findProductosUsandoEmpaque,
    findProductosUsandoInsumo: findProductosUsandoInsumo,
    GASTO_CATEGORIAS: GASTO_CATEGORIAS,
    costoPromedioPonderado: costoPromedioPonderado,
    registrarGasto: registrarGasto,
    eliminarGasto: eliminarGasto,
    getGastosByPeriod: getGastosByPeriod,
    MERMA_MOTIVOS: MERMA_MOTIVOS,
    getMermaOrigenList: getMermaOrigenList,
    registrarMerma: registrarMerma,
    eliminarMerma: eliminarMerma,
    getMermasByPeriod: getMermasByPeriod,
    getMermasByRange: getMermasByRange,
    getValorTotalMermas: getValorTotalMermas,
    agruparMermasPorMotivo: agruparMermasPorMotivo,
    getMermaOrigenNombre: getMermaOrigenNombre,
    agruparMermasPorOrigen: agruparMermasPorOrigen,
    getValorInventario: getValorInventario,
    crearSnapshot: crearSnapshot,
    getSnapshotMasReciente: getSnapshotMasReciente,
    AJUSTE_MOTIVOS: AJUSTE_MOTIVOS,
    previsualizarConteo: previsualizarConteo,
    cerrarConteo: cerrarConteo,
    getDepreciacionMensualTotal: getDepreciacionMensualTotal,
    getDepreciacionPeriodo: getDepreciacionPeriodo,
    agruparGastosPorCategoria: agruparGastosPorCategoria,
    computeCascada: computeCascada,
    getCascadaUtilidad: getCascadaUtilidad,
    getPreparacion: getPreparacion,
    getPreparacionComposicionPorGramo: getPreparacionComposicionPorGramo,
    getPreparacionCosto: getPreparacionCosto,
    expandGramosAMateria: expandGramosAMateria,
    wouldCreateCiclo: wouldCreateCiclo,
    savePreparacion: savePreparacion,
    producirPreparacion: producirPreparacion,
    eliminarLote: eliminarLote,
    getPromedioRendimientoObservado: getPromedioRendimientoObservado,
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
    GASTO_CATEGORIAS_LABORALES: GASTO_CATEGORIAS_LABORALES,
    getCostoLaboral: getCostoLaboral,
    getPrimeCost: getPrimeCost,
    getComportamientoCategoria: getComportamientoCategoria,
    getCostosFijosYVariables: getCostosFijosYVariables,
    getCMPonderado: getCMPonderado,
    getBreakEven: getBreakEven,
    getMenuEngineering: getMenuEngineering,
    getLotesByRange: getLotesByRange,
    getVarianza: getVarianza,
    getActualVsTheoretical: getActualVsTheoretical,
    getActualVsTheoreticalHistorico: getActualVsTheoreticalHistorico,
    MARGEN_VARIABILIDAD_PCT: MARGEN_VARIABILIDAD_PCT
  };
});

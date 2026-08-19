/**
 * Crumbly — backend en Google Sheets (Fase E, HANDOFF.md §12).
 *
 * Arquitectura: la app manda el ESTADO COMPLETO (el mismo objeto que hoy
 * vive en localStorage) en cada sincronización. Este script lo guarda tal
 * cual en la hoja "state_json" (una celda, JSON) — esa es la fuente de
 * verdad real y lo único que se necesita para leer/escribir sin perder
 * nada. Además espeja cada colección en su propia hoja plana (materia,
 * productos, ventas, etc.) solo para que puedas mirarlas y armar tus
 * propias tablas dinámicas a mano — esas hojas se reescriben enteras en
 * cada sincronización, no son la fuente de verdad.
 *
 * No hay CRUD fila por fila: cada "push" reemplaza todo. Para el volumen
 * de un negocio de este tamaño es más simple y más difícil de romper que
 * llevar IDs y diffs — si algún día el volumen lo justifica, se cambia
 * aquí sin tocar el resto de la app.
 *
 * Instalación: ver backend/SETUP.md.
 */

var TOKEN_PROPERTY = 'CRUMBLY_TOKEN';
var SHEET_ID_PROPERTY = 'CRUMBLY_SHEET_ID';
var STATE_SHEET = 'state_json';

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!isValidToken_(params.token)) return json_({ ok: false, error: 'token inválido' });

  if (params.action === 'ping') {
    return json_({ ok: true, ts: new Date().toISOString() });
  }
  if (params.action === 'pull') {
    return json_({ ok: true, state: readState_() });
  }
  return json_({ ok: false, error: 'acción desconocida: ' + params.action });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'body inválido (se esperaba JSON)' });
  }
  if (!isValidToken_(body.token)) return json_({ ok: false, error: 'token inválido' });

  if (body.action === 'push') {
    if (!body.state || typeof body.state !== 'object') {
      return json_({ ok: false, error: 'falta state en el body' });
    }
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
    } catch (err) {
      return json_({ ok: false, error: 'ocupado, otro dispositivo está sincronizando — reintenta en unos segundos' });
    }
    try {
      writeState_(body.state);
      return json_({ ok: true, ts: new Date().toISOString() });
    } finally {
      lock.releaseLock();
    }
  }
  return json_({ ok: false, error: 'acción desconocida: ' + body.action });
}

function isValidToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return !!expected && token === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Proyecto independiente (no vinculado a un Sheet específico) — abre por
// ID en vez de depender de SpreadsheetApp.getActiveSpreadsheet(). Así
// funciona igual si el script se creó desde script.google.com en vez de
// Extensiones → Apps Script, y es más robusto en general (sobrevive a
// duplicar el archivo, no depende de "estar dentro" de la hoja).
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY);
  if (!id) throw new Error('Falta CRUMBLY_SHEET_ID en las Propiedades del script — ver backend/SETUP.md');
  return SpreadsheetApp.openById(id);
}

function getOrCreateSheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

// ─── Fuente de verdad ───────────────────────────────────────────

function readState_() {
  var sh = ss_().getSheetByName(STATE_SHEET);
  if (!sh) return null;
  var raw = sh.getRange(1, 1).getValue();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function writeState_(state) {
  var sh = getOrCreateSheet_(STATE_SHEET);
  sh.getRange(1, 1).setValue(JSON.stringify(state));
  sh.getRange(1, 2).setValue(new Date().toISOString());
  mirrorCollections_(state);
}

// ─── Espejo legible (solo para mirar/analizar a mano) ──────────

function writeSheet_(name, headers, rows) {
  var sh = getOrCreateSheet_(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function mirrorCollections_(state) {
  writeSheet_('materia', ['id', 'nombre', 'cantidad', 'costo', 'minimo', 'margenVariable'],
    (state.materia || []).map(function (m) { return [m.id, m.nombre, m.cantidad, m.costo, m.minimo, !!m.margenVariable]; }));

  writeSheet_('empaques', ['id', 'nombre', 'unidad', 'cantidad', 'costo', 'minimo', 'margenVariable'],
    (state.empaques || []).map(function (m) { return [m.id, m.nombre, m.unidad, m.cantidad, m.costo, m.minimo, !!m.margenVariable]; }));

  writeSheet_('toppings', ['id', 'nombre', 'cantidad', 'costo', 'precio', 'minimo', 'margenVariable'],
    (state.toppings || []).map(function (m) { return [m.id, m.nombre, m.cantidad, m.costo, m.precio, m.minimo, !!m.margenVariable]; }));

  writeSheet_('preparaciones', ['id', 'nombre', 'modo', 'baseGramos'],
    (state.preparaciones || []).map(function (p) { return [p.id, p.nombre, p.modo, p.baseGramos]; }));
  writeSheet_('prep_componentes', ['preparacionId', 'tipo', 'refId', 'porcentaje', 'gramos'],
    flatten_(state.preparaciones, 'componentes', function (p, c) { return [p.id, c.tipo, c.refId, c.porcentaje || '', c.gramos || '']; }));

  writeSheet_('productos', ['id', 'nombre', 'precio', 'empaqueManual'],
    (state.productos || []).map(function (p) { return [p.id, p.nombre, p.precio, p.empaqueManual || 0]; }));
  writeSheet_('prod_componentes', ['productoId', 'tipo', 'refId', 'gramos'],
    flatten_(state.productos, 'componentes', function (p, c) { return [p.id, c.tipo, c.refId, c.gramos || '']; }));
  writeSheet_('prod_empaques', ['productoId', 'empaqueId', 'cantidad'],
    flatten_(state.productos, 'empaquesUsados', function (p, e) { return [p.id, e.empaqueId, e.cantidad]; }));

  writeSheet_('clientes', ['id', 'nombre', 'telefono'],
    (state.clientes || []).map(function (c) { return [c.id, c.nombre, c.telefono]; }));

  writeSheet_('ventas', ['id', 'fecha', 'total', 'ganancia', 'stockInsuficiente', 'clienteId'],
    (state.ventas || []).map(function (v) { return [v.id, v.fecha, v.total, v.ganancia, !!v.stockInsuficiente, v.clienteId || '']; }));
  writeSheet_('venta_items', ['ventaId', 'productoId', 'nombre', 'qty', 'precio', 'costo'],
    flatten_(state.ventas, 'items', function (v, i) { return [v.id, i.productoId, i.nombre, i.qty, i.precio, i.costo]; }));

  writeSheet_('gastos', ['id', 'fecha', 'tipo', 'categoria', 'monto', 'proveedor', 'descripcion', 'insumoTipo', 'insumoId', 'cantidad', 'vidaUtilMeses'],
    (state.gastos || []).map(function (g) {
      return [g.id, g.fecha, g.tipo, g.categoria, g.monto, g.proveedor || '', g.descripcion || '', g.insumoTipo || '', g.insumoId || '', g.cantidad || '', g.vidaUtilMeses || ''];
    }));

  // Mermas: movimiento de INVENTARIO, nunca de Caja — no aparece en la hoja
  // "gastos" ni afecta ninguna columna de dinero. Espejo de solo lectura,
  // igual que el resto: la fuente de verdad sigue siendo state_json.
  writeSheet_('mermas', ['id', 'fecha', 'origenTipo', 'origenId', 'cantidad', 'costoUnitario', 'valorTotal', 'motivo', 'observaciones', 'usuario', 'stockInsuficiente'],
    (state.mermas || []).map(function (m) {
      return [m.id, m.fecha, m.origenTipo, m.origenId, m.cantidad, m.costoUnitario, m.valorTotal, m.motivo, m.observaciones || '', m.usuario || '', !!m.stockInsuficiente];
    }));
}

// Aplana coleccion[].campoAnidado[] en filas [padre, ...hijo] usando `mapRow`.
function flatten_(coleccion, campo, mapRow) {
  var out = [];
  (coleccion || []).forEach(function (padre) {
    (padre[campo] || []).forEach(function (hijo) {
      out.push(mapRow(padre, hijo));
    });
  });
  return out;
}

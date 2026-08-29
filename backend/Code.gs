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
 * También sube comprobantes (fotos/PDF de pago) a una carpeta de Drive
 * del dueño del script (acción "uploadComprobante") — no son públicos,
 * el link solo funciona logueado con la cuenta que desplegó el script.
 *
 * Login: dos caminos, a elección de quien entra — "Iniciar sesión con
 * Google" (acción "loginGoogle", verifica el ID token CONTRA GOOGLE) o
 * correo + contraseña corta (acción "login", CRUMBLY_LOGIN_EMAIL /
 * CRUMBLY_LOGIN_PASSWORD). Ambas devuelven el mismo token real una sola
 * vez — el token real nunca vive en el código público.
 *
 * Instalación: ver backend/SETUP.md.
 */

var TOKEN_PROPERTY = 'CRUMBLY_TOKEN';
var LOGIN_EMAIL_PROPERTY = 'CRUMBLY_LOGIN_EMAIL';
var LOGIN_PASSWORD_PROPERTY = 'CRUMBLY_LOGIN_PASSWORD';
var GOOGLE_CLIENT_ID_PROPERTY = 'CRUMBLY_GOOGLE_CLIENT_ID';
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

  // "loginGoogle" y "login" son las únicas acciones que NO piden el token
  // real — son justamente las que lo entregan, a cambio de un login válido
  // (de Google o correo+contraseña). Por eso se resuelven antes del
  // chequeo de token, no después.
  if (body.action === 'loginGoogle') {
    return loginGoogle_(body);
  }
  if (body.action === 'login') {
    return login_(body);
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
  if (body.action === 'uploadComprobante') {
    return uploadComprobante_(body);
  }
  return json_({ ok: false, error: 'acción desconocida: ' + body.action });
}

// ─── Comprobantes (fotos/PDF de pago, ventas y gastos) ─────────────────
// Sube el archivo (base64) a una carpeta de Drive del dueño del script —
// NO se comparte públicamente: el archivo queda visible solo para la
// cuenta de Google que desplegó el script (misma cuenta que ya lee/escribe
// la hoja), igual que cualquier archivo que crees a mano en tu Drive. Si
// quieres compartir uno puntual, hazlo desde Drive normalmente.
var COMPROBANTES_FOLDER = 'Crumbly - Comprobantes';

function uploadComprobante_(body) {
  if (!body.filename || !body.data) {
    return json_({ ok: false, error: 'falta filename o data' });
  }
  try {
    var bytes = Utilities.base64Decode(body.data);
    var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.filename);
    var folder = getOrCreateComprobantesFolder_();
    var file = folder.createFile(blob);
    return json_({ ok: true, url: file.getUrl(), fileId: file.getId() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getOrCreateComprobantesFolder_() {
  var folders = DriveApp.getFoldersByName(COMPROBANTES_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(COMPROBANTES_FOLDER);
}

function isValidToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return !!expected && token === expected;
}

// ─── Login (Google Sign-In → token real) ─────────────────────────────────
// El token real (CRUMBLY_TOKEN) nunca vive en el código público de la app
// — solo acá, en las Propiedades del script. La app obtiene un ID token
// de Google en el navegador (Google Identity Services) y lo manda acá;
// este endpoint lo verifica CONTRA GOOGLE (no confía en el JWT solo por
// decodificarlo) y chequea que el correo sea el autorizado
// (CRUMBLY_LOGIN_EMAIL) antes de devolver el token real UNA vez.
// Configurar CRUMBLY_LOGIN_EMAIL y CRUMBLY_GOOGLE_CLIENT_ID en las
// Propiedades del script — ver backend/SETUP.md.
function loginGoogle_(body) {
  var expectedEmail = PropertiesService.getScriptProperties().getProperty(LOGIN_EMAIL_PROPERTY);
  var clientId = PropertiesService.getScriptProperties().getProperty(GOOGLE_CLIENT_ID_PROPERTY);
  if (!expectedEmail || !clientId) return json_({ ok: false, error: 'falta configurar CRUMBLY_LOGIN_EMAIL o CRUMBLY_GOOGLE_CLIENT_ID' });
  if (!body.idToken) return json_({ ok: false, error: 'falta idToken' });

  var info;
  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken), { muteHttpExceptions: true });
    info = JSON.parse(res.getContentText());
  } catch (err) {
    return json_({ ok: false, error: 'no se pudo verificar el token de Google' });
  }
  // aud debe ser nuestro Client ID (si no, el token es de otra app) y el
  // correo debe venir verificado por Google — así no confiamos en un JWT
  // cualquiera, solo en uno que Google mismo certifica como válido y
  // recién emitido para nuestra app.
  if (!info || info.aud !== clientId) return json_({ ok: false, error: 'token de Google inválido' });
  if (info.email_verified !== 'true' && info.email_verified !== true) return json_({ ok: false, error: 'correo de Google no verificado' });
  if (String(info.email || '').trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return json_({ ok: false, error: 'correo no autorizado' });

  var token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return json_({ ok: true, token: token });
}

// ─── Login (correo + contraseña corta → token real) ─────────────────────
// Camino alternativo a "Iniciar sesión con Google" para cuando no se
// quiere/puede usar esa cuenta en el dispositivo. Configurar
// CRUMBLY_LOGIN_EMAIL y CRUMBLY_LOGIN_PASSWORD en las Propiedades del
// script — ver backend/SETUP.md.
function login_(body) {
  var expectedEmail = PropertiesService.getScriptProperties().getProperty(LOGIN_EMAIL_PROPERTY);
  var expectedPassword = PropertiesService.getScriptProperties().getProperty(LOGIN_PASSWORD_PROPERTY);
  if (!expectedEmail || !expectedPassword) return json_({ ok: false, error: 'falta configurar CRUMBLY_LOGIN_EMAIL o CRUMBLY_LOGIN_PASSWORD' });
  var email = String(body.email || '').trim().toLowerCase();
  if (email !== expectedEmail.trim().toLowerCase()) return json_({ ok: false, error: 'correo o contraseña incorrectos' });
  if (!body.password || body.password !== expectedPassword) return json_({ ok: false, error: 'correo o contraseña incorrectos' });
  var token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return json_({ ok: true, token: token });
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

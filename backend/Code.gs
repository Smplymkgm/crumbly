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
 * Autenticación (29 ago 2026, revisado el mismo día — herramienta de uso
 * interno, sin registro público): la ÚNICA forma de entrar es "Iniciar
 * sesión con Google" (acción "authGoogle"), y solo funciona para un
 * correo que YA esté como fila en la hoja "usuarios" con activo=TRUE —
 * el login NUNCA crea usuarios nuevos. Autorizar a alguien es agregarlo
 * a mano en esa hoja (o correr createUser() desde el editor de Apps
 * Script) — no hay contraseñas propias de la app, ni tokens fijos, ni
 * listas de correos en el frontend: toda la autorización vive acá, en
 * Sheets. Un login válido termina en mintSession_(): un token de SESIÓN
 * aleatorio (no un secreto fijo de la app) que se guarda como una fila
 * nueva en la hoja "sesiones" — cada dispositivo tiene el suyo, cerrar
 * sesión en uno no afecta a los demás. push/pull/uploadComprobante
 * validan ese token de sesión contra esa hoja en cada pedido
 * (isValidSession_).
 *
 * Instalación: ver backend/SETUP.md.
 */

var GOOGLE_CLIENT_ID_PROPERTY = 'CRUMBLY_GOOGLE_CLIENT_ID';
var SHEET_ID_PROPERTY = 'CRUMBLY_SHEET_ID';
var STATE_SHEET = 'state_json';
var USUARIOS_SHEET = 'usuarios';
var SESIONES_SHEET = 'sesiones';
var SESION_DIAS_VALIDEZ = 90;

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!isValidSession_(params.token)) return json_({ ok: false, error: 'sesión inválida — iniciá sesión de nuevo' });

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

  // "authGoogle" es la única acción que NO pide una sesión ya abierta —
  // es justamente la que la abre. "logout" tampoco: solo necesita el
  // token para saber qué sesión cerrar, no que siga siendo válida. Por
  // eso las dos se resuelven antes del chequeo de sesión.
  if (body.action === 'authGoogle') {
    return authGoogle_(body);
  }
  if (body.action === 'logout') {
    return logoutSession_(body);
  }

  if (!isValidSession_(body.token)) return json_({ ok: false, error: 'sesión inválida — iniciá sesión de nuevo' });

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

// ─── Sesiones ───────────────────────────────────────────────────────────
// No hay ningún secreto compartido que copiar y pegar. Cada login exitoso
// con Google crea una fila nueva en "sesiones" con un token aleatorio
// propio de ESE dispositivo — cerrar sesión en uno no afecta a los demás.
// push/pull/uploadComprobante validan ese token en cada pedido.
function isValidSession_(token) {
  if (!token) return false;
  var row = findRowByValue_(getSesionesSheet_(), 0, token);
  if (!row) return false;
  var expira = new Date(row.data[3]);
  return expira.getTime() > Date.now();
}

function mintSession_(email) {
  var sh = getSesionesSheet_();
  var token = Utilities.getUuid() + Utilities.getUuid(); // 2x UUID: más entropía que un solo v4
  var ahora = new Date();
  var expira = new Date(ahora.getTime() + SESION_DIAS_VALIDEZ * 24 * 60 * 60 * 1000);
  sh.appendRow([token, email, ahora.toISOString(), expira.toISOString()]);
  return token;
}

function logoutSession_(body) {
  if (!body.token) return json_({ ok: false, error: 'falta token' });
  var sh = getSesionesSheet_();
  var row = findRowByValue_(sh, 0, body.token);
  if (row) sh.deleteRow(row.row); // no importa si ya no existe/expiró — el resultado que le importa al cliente es el mismo
  return json_({ ok: true });
}

// ─── Login con Google (ID token → sesión) ──────────────────────────────
// Única puerta de entrada — sin registro, sin invitaciones, sin
// contraseñas propias de la app. La app obtiene un ID token de Google en
// el navegador (Google Identity Services) y lo manda acá; este endpoint
// lo verifica CONTRA GOOGLE (no confía en decodificarlo solo) y busca el
// correo en la hoja "usuarios" — si no está ahí, o está pero con
// activo=FALSE, no entra. El login NUNCA crea ni modifica usuarios
// (salvo lastLogin) — autorizar gente es un trabajo manual en Sheets
// (o con createUser(), ver más abajo), nunca algo que dispare la app.
function authGoogle_(body) {
  var clientId = PropertiesService.getScriptProperties().getProperty(GOOGLE_CLIENT_ID_PROPERTY);
  if (!clientId) return json_({ success: false, authorized: false, message: 'falta configurar CRUMBLY_GOOGLE_CLIENT_ID' });
  if (!body.idToken) return json_({ success: false, authorized: false, message: 'falta idToken' });

  var info;
  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken), { muteHttpExceptions: true });
    info = JSON.parse(res.getContentText());
  } catch (err) {
    return json_({ success: false, authorized: false, message: 'no se pudo verificar el token de Google' });
  }
  // aud debe ser nuestro Client ID (si no, el token es de otra app) y el
  // correo debe venir verificado por Google — así no confiamos en un JWT
  // cualquiera, solo en uno que Google mismo certifica como válido y
  // recién emitido para nuestra app.
  if (!info || info.aud !== clientId) return json_({ success: false, authorized: false, message: 'token de Google inválido' });
  if (info.email_verified !== 'true' && info.email_verified !== true) return json_({ success: false, authorized: false, message: 'correo de Google no verificado' });
  var email = String(info.email || '').trim().toLowerCase();

  var row = findUsuarioByEmail_(email);
  if (!row) return json_({ success: false, authorized: false, message: 'Usuario no autorizado' });
  if (!isActivoCell_(row.data[4])) return json_({ success: false, authorized: false, message: 'Usuario desactivado' });

  getUsuariosSheet_().getRange(row.row, 7).setValue(new Date().toISOString()); // lastLogin
  var user = { id: row.data[0], email: row.data[1], nombre: row.data[2], rol: row.data[3] };
  var token = mintSession_(email);
  return json_({ success: true, authorized: true, user: user, token: token });
}

function isActivoCell_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

function findUsuarioByEmail_(email) {
  return findRowByValue_(getUsuariosSheet_(), 1, email);
}

function getUsuariosSheet_() {
  var sh = getOrCreateSheet_(USUARIOS_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['id', 'email', 'nombre', 'rol', 'activo', 'createdAt', 'lastLogin']);
  return sh;
}

// ─── Administración de usuarios — funciones internas ───────────────────
// Sin panel visual todavía, a propósito (ver encabezado del archivo).
// Se corren a mano desde el editor de Apps Script: abrí Code.gs, elegí
// la función en el desplegable de arriba (junto al botón ▷ Ejecutar),
// escribí los parámetros en el panel de "Ejecutar función" si hace
// falta, y ejecutá. Están escritas para que, el día que haya un panel de
// administración real, sea cablearlas a una acción HTTP, no reescribirlas.

// createUser('nueva@correo.com', 'Nombre', 'admin') — rol es opcional,
// por defecto 'admin' (todavía no hay roles operativos distintos, ver
// encabezado del archivo — 'operador' está contemplado en el esquema
// para cuando haga falta, pero hoy todos son 'admin').
function createUser(email, nombre, rol) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('Falta el correo');
  if (findUsuarioByEmail_(email)) throw new Error('Ya existe un usuario con ese correo: ' + email);
  var sh = getUsuariosSheet_();
  var id = sh.getLastRow(); // filas de datos existentes = próximo id correlativo (1, 2, 3…)
  sh.appendRow([id, email, nombre || email, rol || 'admin', true, new Date().toISOString(), '']);
  return { id: id, email: email, nombre: nombre || email, rol: rol || 'admin' };
}

function disableUser(email) {
  setUsuarioActivo_(email, false);
}

function enableUser(email) {
  setUsuarioActivo_(email, true);
}

function setUsuarioActivo_(email, activo) {
  email = String(email || '').trim().toLowerCase();
  var row = findUsuarioByEmail_(email);
  if (!row) throw new Error('No existe un usuario con ese correo: ' + email);
  getUsuariosSheet_().getRange(row.row, 5).setValue(activo);
}

function getSesionesSheet_() {
  var sh = getOrCreateSheet_(SESIONES_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['token', 'email', 'creado', 'expira']);
  return sh;
}

// Escaneo lineal desde la fila 2 (fila 1 = encabezado) — a este volumen
// (un puñado de usuarios/sesiones de un solo negocio) es más simple y
// suficientemente rápido que indexar; si algún día esto crece mucho, se
// cambia acá sin tocar el resto del archivo.
function findRowByValue_(sheet, colIndex, value) {
  if (sheet.getLastRow() < 2) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][colIndex] === value) return { row: i + 2, data: data[i] };
  }
  return null;
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

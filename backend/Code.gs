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
 * Autenticación (29 ago 2026 — reemplaza el token manual por completo):
 * no hay ningún token fijo que copiar y pegar. "Iniciar sesión con
 * Google" (acción "authGoogle") verifica el ID token CONTRA GOOGLE,
 * revisa que el correo esté en CRUMBLY_LOGIN_EMAIL, y busca/crea al
 * usuario en la hoja "usuarios". El camino opcional de correo+contraseña
 * (acción "login", CRUMBLY_LOGIN_PASSWORD) hace lo mismo sin pasar por
 * Google. Ambos caminos terminan en mintSession_(): un token de SESIÓN
 * aleatorio (no un secreto fijo de la app) que se guarda como una fila
 * nueva en la hoja "sesiones" — cada dispositivo tiene el suyo, cerrar
 * sesión en uno no afecta a los demás. push/pull/uploadComprobante
 * validan ese token de sesión contra esa hoja en cada pedido
 * (isValidSession_) en vez de comparar contra un secreto fijo.
 *
 * Instalación: ver backend/SETUP.md.
 */

var LOGIN_EMAIL_PROPERTY = 'CRUMBLY_LOGIN_EMAIL'; // uno o más correos separados por coma
var LOGIN_PASSWORD_PROPERTY = 'CRUMBLY_LOGIN_PASSWORD'; // opcional — camino de correo+contraseña
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

  // "authGoogle" y "login" son las únicas acciones que NO piden una sesión
  // ya abierta — son justamente las que la abren. "logout" tampoco: solo
  // necesita el token para saber qué sesión cerrar, no que siga siendo
  // válida. Por eso las tres se resuelven antes del chequeo de sesión.
  if (body.action === 'authGoogle') {
    return authGoogle_(body);
  }
  if (body.action === 'login') {
    return login_(body);
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

// ─── Sesiones — reemplaza el token fijo por completo ──────────────────
// No hay ningún secreto compartido que copiar y pegar. Cada login exitoso
// (Google o correo+contraseña) crea una fila nueva en "sesiones" con un
// token aleatorio propio de ESE dispositivo — cerrar sesión en uno no
// afecta a los demás, a diferencia de un único CRUMBLY_TOKEN para toda la
// app. push/pull/uploadComprobante validan ese token en cada pedido.
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
// La app obtiene un ID token de Google en el navegador (Google Identity
// Services) y lo manda acá; este endpoint lo verifica CONTRA GOOGLE (no
// confía en decodificarlo solo) y chequea que el correo esté autorizado
// (CRUMBLY_LOGIN_EMAIL, uno o más separados por coma) antes de crear/
// actualizar el usuario y abrir una sesión. Configurar CRUMBLY_LOGIN_EMAIL
// y CRUMBLY_GOOGLE_CLIENT_ID en las Propiedades del script — SETUP.md.
function authGoogle_(body) {
  var clientId = PropertiesService.getScriptProperties().getProperty(GOOGLE_CLIENT_ID_PROPERTY);
  if (!clientId) return json_({ success: false, error: 'falta configurar CRUMBLY_GOOGLE_CLIENT_ID' });
  if (!body.idToken) return json_({ success: false, error: 'falta idToken' });

  var info;
  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken), { muteHttpExceptions: true });
    info = JSON.parse(res.getContentText());
  } catch (err) {
    return json_({ success: false, error: 'no se pudo verificar el token de Google' });
  }
  // aud debe ser nuestro Client ID (si no, el token es de otra app) y el
  // correo debe venir verificado por Google — así no confiamos en un JWT
  // cualquiera, solo en uno que Google mismo certifica como válido y
  // recién emitido para nuestra app.
  if (!info || info.aud !== clientId) return json_({ success: false, error: 'token de Google inválido' });
  if (info.email_verified !== 'true' && info.email_verified !== true) return json_({ success: false, error: 'correo de Google no verificado' });
  var email = String(info.email || '').trim().toLowerCase();
  if (!isEmailAllowed_(email)) return json_({ success: false, error: 'correo no autorizado' });

  var usuario = findOrCreateUsuario_(email, { id: info.sub || '', nombre: info.name || email, foto: info.picture || '' });
  var token = mintSession_(email);
  return json_({ success: true, user: usuario, token: token });
}

// ─── Login con correo + contraseña (opcional) ──────────────────────────
// Camino alternativo a "Iniciar sesión con Google" para cuando no se
// quiere/puede usar esa cuenta en el dispositivo. La contraseña es un
// secreto propio de la app (CRUMBLY_LOGIN_PASSWORD) — nada que ver con
// contraseñas de Google. El correo debe estar en CRUMBLY_LOGIN_EMAIL,
// igual que el camino de Google. Configurar ambas Propiedades del script
// — ver backend/SETUP.md.
function login_(body) {
  var expectedPassword = PropertiesService.getScriptProperties().getProperty(LOGIN_PASSWORD_PROPERTY);
  if (!expectedPassword) return json_({ success: false, error: 'falta configurar CRUMBLY_LOGIN_PASSWORD' });
  var email = String(body.email || '').trim().toLowerCase();
  if (!isEmailAllowed_(email)) return json_({ success: false, error: 'correo o contraseña incorrectos' });
  if (!body.password || body.password !== expectedPassword) return json_({ success: false, error: 'correo o contraseña incorrectos' });

  var usuario = findOrCreateUsuario_(email, { nombre: email });
  var token = mintSession_(email);
  return json_({ success: true, user: usuario, token: token });
}

// ─── Usuarios — quién puede entrar y quién ya entró ────────────────────
// CRUMBLY_LOGIN_EMAIL sostiene la lista de correos autorizados (uno o
// más, separados por coma) — se revisa en CADA login, no solo al crear
// la cuenta, así que sacar un correo de la lista le corta el acceso en
// su próximo intento de iniciar sesión (las sesiones ya abiertas siguen
// vivas hasta que expiren o se cierren a mano — revocación inmediata
// sería el siguiente paso si hace falta).
function isEmailAllowed_(email) {
  var raw = PropertiesService.getScriptProperties().getProperty(LOGIN_EMAIL_PROPERTY);
  if (!raw || !email) return false;
  var permitidos = raw.split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
  return permitidos.indexOf(email) !== -1;
}

// El primer usuario que se registra queda como 'dueño'; los siguientes,
// 'staff'. Es un default automático, no una decisión final — el rol es
// una celda más de la hoja "usuarios" y se puede corregir a mano ahí
// mismo en cualquier momento, igual que cualquier otro dato de este
// backend (no hay pantalla de administración, a propósito: la hoja ya
// es esa pantalla).
function findOrCreateUsuario_(email, datos) {
  var sh = getUsuariosSheet_();
  var row = findRowByValue_(sh, 0, email);
  var ahora = new Date().toISOString();
  if (row) {
    var rol = row.data[4];
    sh.getRange(row.row, 2, 1, 4).setValues([[datos.id || row.data[1], datos.nombre || row.data[2], datos.foto || row.data[3], rol]]);
    sh.getRange(row.row, 6).setValue(ahora);
    return { id: datos.id || row.data[1], email: email, nombre: datos.nombre || row.data[2], foto: datos.foto || row.data[3], rol: rol };
  }
  var esElPrimero = sh.getLastRow() <= 1; // <=1: solo la fila de encabezado, o vacía
  var rolNuevo = esElPrimero ? 'dueño' : 'staff';
  sh.appendRow([email, datos.id || '', datos.nombre || email, datos.foto || '', rolNuevo, ahora]);
  return { id: datos.id || '', email: email, nombre: datos.nombre || email, foto: datos.foto || '', rol: rolNuevo };
}

function getUsuariosSheet_() {
  var sh = getOrCreateSheet_(USUARIOS_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['email', 'id', 'nombre', 'foto', 'rol', 'ultimoAcceso']);
  return sh;
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

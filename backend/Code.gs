/**
 * Crumbly — backend en Google Sheets (Fase E, HANDOFF.md §12).
 *
 * ARQUITECTURA (T1, auditoría Ronda 3 — reemplaza el diseño original de
 * "todo en una celda"): el estado se separa en dos partes.
 *
 *   CATÁLOGO (productos, materia, empaques, toppings, preparaciones,
 *   clientes, config, schemaVersion) — crece con el MENÚ, no con la
 *   operación. Sigue viviendo en una sola celda JSON (hoja "state_json"),
 *   como siempre.
 *
 *   COLECCIONES QUE CRECEN CON LA OPERACIÓN (ventas, gastos, mermas,
 *   snapshots, ajustes, lotes) — una FILA por registro, en su propia
 *   hoja, agregada por `id` de forma idempotente (nunca se duplica, nunca
 *   se reescribe la hoja completa). Es lo que soluciona el problema real:
 *   antes, 761 caracteres por venta contra un tope de celda de ~50.000
 *   dejaban margen para unas 15 ventas — un día de operación — y la
 *   escritura fallaba EN SILENCIO al pasarse (ver T0). Después de esta
 *   migración el catálogo queda chico y estable; la operación puede
 *   crecer sin límite práctico porque cada registro es su propia fila,
 *   no un carácter más en la misma celda.
 *
 * La lógica de qué va a cada lado, y de qué registro es "nuevo" (para no
 * duplicar), está PROBADA en Node — ver `js/rowsync.js` y
 * `tests/rowsync.test.js`. Apps Script no tiene runtime compartido con
 * Node/el navegador, así que lo de acá es un PORT A MANO de esas mismas
 * funciones sobre `getRange`/`setValues` reales — si la lógica cambia en
 * `js/rowsync.js`, hay que reflejarlo acá también (costo de
 * mantenimiento reconocido, ver PROGRESO.md § T1).
 *
 * Modificaciones y anulaciones: por ahora se appendan como una fila
 * NUEVA que referencia el id original en la columna `supersedesId`
 * (columna presente, sin usar todavía — el flujo de anulación en la UI
 * es otra ronda). Ninguna fila existente se muta ni se borra.
 *
 * Los catálogos (materia, productos, etc.) siguen espejándose en hojas
 * planas de solo lectura, igual que antes — `mirrorCollections_` ya NO
 * incluye ventas/gastos/mermas (esos nombres de hoja ahora SON la fuente
 * de verdad append-only, reescribirlos los destruiría).
 *
 * También sube archivos (comprobantes de pago, fotos de producto) a una
 * carpeta de Drive del dueño del script (acción "uploadComprobante",
 * nombre histórico — la usan ambos casos). Cada archivo se comparte
 * como "cualquiera con el link puede ver" (no aparece en búsquedas, no
 * es de acceso público real) — necesario para que una foto de producto
 * se vea en el navegador de CUALQUIER dispositivo con la app abierta,
 * no solo logueado con la cuenta de Google del negocio. Antes los
 * comprobantes no tenían este permiso — se agregó junto con las fotos
 * de producto, mismo mecanismo para los dos.
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
  if (params.action === 'migrationStatus') {
    return json_({ ok: true, ultima: getUltimaMigracion_(), fase: RowSyncFaseMigracion_(leerCatalogoCrudo_()) });
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
      // U1: knownRecordIds (conjunto completo declarado por colección) y
      // usuario (para el rastro de la lápida) — ambos opcionales; un
      // cliente viejo que no los mande simplemente no genera lápidas.
      var resultado = writeState_(body.state, body.knownRecordIds, body.usuario);
      if (!resultado.ok) return json_(resultado); // T0: error tipado (ej. PAYLOAD_TOO_LARGE), nunca ok:true en silencio
      return json_({ ok: true, ts: new Date().toISOString(), lapidas: resultado.lapidas });
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
    // "Cualquiera con el link" — necesario para que las fotos de producto
    // se vean con <img> en cualquier dispositivo/cuenta, no solo logueado
    // como el dueño del script. No sale en búsquedas ni en "Compartidos
    // conmigo" de nadie — hay que tener el link exacto.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // file.getUrl() da la página visor de Drive (HTML, no una imagen) —
    // inútil como src de un <img>. Esta URL de lh3.googleusercontent.com
    // sirve el archivo directo, así que sí funciona como src de <img>
    // (bug real: con getUrl(), las fotos de producto no se mostraban).
    var url = 'https://lh3.googleusercontent.com/d/' + file.getId();
    return json_({ ok: true, url: url, fileId: file.getId() });
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
//
// T1 (auditoría, Ronda 3): "ventas", "gastos", "mermas", "snapshots",
// "ajustes" y "lotes" son ahora hojas APPEND-ONLY — una fila por
// registro, columnas [id, fecha, supersedesId, json]. El resto del
// estado ("catálogo") sigue en la celda `state_json!A1`. Esta constante
// es el ÚNICO lugar que decide qué va a cada lado — mismo valor que
// `COLECCIONES_APPEND` en js/rowsync.js (ver tests/rowsync.test.js).
var APPEND_COLLECTIONS = ['ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes'];

function getAppendSheet_(name) {
  var sh = getOrCreateSheet_(name);
  if (sh.getLastRow() === 0) sh.appendRow(['id', 'fecha', 'supersedesId', 'json']);
  return sh;
}

// Lee todas las filas de una hoja append-only y devuelve los objetos ya
// parseados (una fila corrupta se ignora en vez de romper la carga
// completa — más seguro que dejar toda la sincronización caída por un
// registro raro). Incluye las filas de lápida SIN filtrar — quien
// necesita solo los registros vivos usa `hydrateAppendCollection_`.
function readAppendCollectionRaw_(name) {
  var sh = getAppendSheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    try { out.push(JSON.parse(data[i][3])); } catch (err) { /* fila corrupta — se ignora, no tumba el pull */ }
  }
  return out;
}

// U1: registro de lápida — mismo criterio que `isTombstone` en
// js/rowsync.js (mantener en sync a mano).
function esLapida_(rec) {
  return !!(rec && rec._tombstone === true);
}

// U1: los registros VIVOS de una hoja — sin lápidas, sin ids lapidados,
// deduplicado por id. Port a mano de `hydrateRecords` (js/rowsync.js).
function hydrateAppendCollection_(name) {
  var records = readAppendCollectionRaw_(name);
  var tombstoned = {};
  records.forEach(function (r) { if (esLapida_(r) && r.id != null) tombstoned[r.id] = true; });
  var out = [];
  var seen = {};
  records.forEach(function (r) {
    if (!r || esLapida_(r) || r.id === undefined || r.id === null) return;
    if (tombstoned[r.id] || seen[r.id]) return;
    seen[r.id] = true;
    out.push(r);
  });
  return out;
}

// Compat: el resto del backend pide "la colección" y espera los vivos.
function readAppendCollection_(name) {
  return hydrateAppendCollection_(name);
}

// ESCRITURA POR APPEND — el punto entero de T1. Nunca reescribe la hoja:
// lee los ids ya existentes, decide cuáles de los `records` entrantes son
// nuevos (mismo criterio que `pickNewRecords` en js/rowsync.js, probado
// ahí), y agrega SOLO esos como filas nuevas de una sola vez
// (`setValues` en un rango, no llamada por llamada). Idempotente: un
// reintento, un doble envío, o dos pushes concurrentes con el mismo id
// nunca duplican una fila.
function appendNewRecords_(name, records) {
  var sh = getAppendSheet_(name);
  var lastRow = sh.getLastRow();
  var existingIds = {};
  if (lastRow >= 2) {
    var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) existingIds[ids[i][0]] = true;
  }
  var nuevas = [];
  (records || []).forEach(function (r) {
    if (!r || r.id === undefined || r.id === null || existingIds[r.id]) return;
    nuevas.push([r.id, r.fecha || '', '', JSON.stringify(r)]);
    existingIds[r.id] = true; // por si el mismo id se repite dentro del mismo payload entrante
  });
  if (nuevas.length) sh.getRange(lastRow + 1, 1, nuevas.length, 4).setValues(nuevas);
  return nuevas.length;
}

// U1: escribe filas de lápida para los registros que el cliente ya no
// tiene. Port a mano de `pickTombstones` + `esBorradoMasivoSospechoso`
// (js/rowsync.js — mantener en sync). Nunca muta ni borra filas
// existentes. Devuelve { escritas, omitidas, motivo }.
//
//   knownIds: array de ids que el cliente declara tener para esta
//             colección (conjunto completo). Si no es un array, o está
//             vacío, no se escribe ninguna lápida (ver guarda en
//             rowsync.js). `undefined` = el cliente no declaró nada.
function appendTombstones_(name, knownIds, usuario) {
  if (!Array.isArray(knownIds) || knownIds.length === 0) return { escritas: 0, omitidas: 0, motivo: 'sin conjunto completo declarado' };

  var sh = getAppendSheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { escritas: 0, omitidas: 0 };

  var data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
  var liveIds = [];
  var tombstoned = {};
  for (var i = 0; i < data.length; i++) {
    var rec = null;
    try { rec = JSON.parse(data[i][3]); } catch (err) { continue; }
    if (rec && rec._tombstone === true) { if (rec.id != null) tombstoned[rec.id] = true; }
    else if (rec && rec.id != null) liveIds.push(rec.id);
  }

  var known = {};
  knownIds.forEach(function (id) { known[id] = true; });
  var candidatos = liveIds.filter(function (id) { return !known[id] && !tombstoned[id]; });
  if (!candidatos.length) return { escritas: 0, omitidas: 0 };

  // Guarda contra el borrado masivo (aunque el conjunto declarado no esté vacío).
  if (candidatos.length > 10 && candidatos.length > liveIds.length * 0.5) {
    Logger.log('U1 — lápidas OMITIDAS en "' + name + '": el push quería lapidar ' + candidatos.length + ' de ' + liveIds.length + ' registros vivos (posible error). No se tocó nada.');
    return { escritas: 0, omitidas: candidatos.length, motivo: 'borrado masivo sospechoso' };
  }

  var ahora = new Date().toISOString();
  var filas = candidatos.map(function (id) {
    var lapida = { id: id, _tombstone: true, fecha: ahora, usuario: usuario || '' };
    return [id, ahora, id, JSON.stringify(lapida)]; // col C = id (self-supersede) marca visualmente que es lápida
  });
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, 4).setValues(filas);
  return { escritas: filas.length, omitidas: 0 };
}

function readState_() {
  var sh = ss_().getSheetByName(STATE_SHEET);
  var raw = sh ? sh.getRange(1, 1).getValue() : null;
  var catalogo = {};
  if (raw) {
    try { catalogo = JSON.parse(raw) || {}; } catch (err) { catalogo = {}; }
  }
  var state = catalogo;
  APPEND_COLLECTIONS.forEach(function (nombre) { state[nombre] = readAppendCollection_(nombre); });
  return state;
}

// T0 (auditoría, Ronda 3): el modo de falla real era que esto fallara EN
// SILENCIO al superar el tope de una celda de Sheets (~50.000
// caracteres) — la escritura no cabía, `setValue` la truncaba o la
// rechazaba según el caso, y el cliente recibía `{ok:true}` igual porque
// nada acá lo comprobaba antes. El cliente (js/sync.js) ya bloquea antes
// de mandar la petición, pero esto es la segunda línea de defensa: nunca
// debe existir un camino en el que escribir falle y la respuesta parezca
// exitosa, sin importar qué versión del cliente esté llamando. Después
// de T1 esto valida el CATÁLOGO solamente (lo único que sigue yendo a
// una celda) — se espera que quede muy por debajo del tope siempre.
var PAYLOAD_TOPE_CHARS = 50000;
var PAYLOAD_BLOQUEO_CHARS = 48000;

function writeState_(state, knownRecordIds, usuario) {
  var catalogo = {};
  Object.keys(state || {}).forEach(function (k) {
    if (APPEND_COLLECTIONS.indexOf(k) === -1) catalogo[k] = state[k];
  });
  var json = JSON.stringify(catalogo);
  if (json.length >= PAYLOAD_BLOQUEO_CHARS) {
    return { ok: false, error: 'PAYLOAD_TOO_LARGE', code: 'PAYLOAD_TOO_LARGE', tam: json.length, tope: PAYLOAD_TOPE_CHARS };
  }
  var sh = getOrCreateSheet_(STATE_SHEET);
  sh.getRange(1, 1).setValue(json);
  sh.getRange(1, 2).setValue(new Date().toISOString());

  var agregados = {};
  var lapidas = {};
  APPEND_COLLECTIONS.forEach(function (nombre) {
    agregados[nombre] = appendNewRecords_(nombre, state[nombre]);
    // U1: si el cliente declaró el conjunto completo de esta colección,
    // escribir lápidas para los ids que ya no están.
    var kr = knownRecordIds && knownRecordIds[nombre];
    lapidas[nombre] = appendTombstones_(nombre, kr, usuario).escritas;
  });
  mirrorCollections_(state); // catálogo únicamente ahora — ver nota en mirrorCollections_
  return { ok: true, agregados: agregados, lapidas: lapidas };
}

// ─── U2 (auditoría Ronda 4): validar la FORMA de la hoja antes de migrar
// Antes de T1, `mirrorCollections_` escribía hojas "ventas", "gastos" y
// "mermas" con columnas PLANAS y legibles (id, fecha, total, ganancia...).
// Después de T1 esos mismos nombres son la fuente de verdad append-only,
// formato [id, fecha, supersedesId, json]. Si el Sheet real todavía tiene
// esas hojas en el formato viejo, appendear encima leería la columna A de
// filas viejas como si fueran ids — puede saltarse registros reales,
// hidratar basura, o las dos cosas, y encima reportar que los conteos
// cuadran porque los está contando mal. Esto no se resuelve adivinando:
// se valida la cabecera de cada hoja destino ANTES de escribir una sola
// fila, y si algo no calza, se aborta sin tocar nada. Port a mano de
// `validarCabeceraAppend` (js/rowsync.js — mantener en sync).
var APPEND_HEADER = ['id', 'fecha', 'supersedesId', 'json'];

function esHeaderVacio_(headerRow) {
  if (!headerRow || headerRow.length === 0) return true;
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i] !== '' && headerRow[i] !== null && headerRow[i] !== undefined) return false;
  }
  return true;
}

function validarCabeceraAppend_(headerRow) {
  if (esHeaderVacio_(headerRow)) return { ok: true, vacia: true };
  var coincide = headerRow.length === APPEND_HEADER.length;
  if (coincide) {
    for (var i = 0; i < APPEND_HEADER.length; i++) {
      if (headerRow[i] !== APPEND_HEADER[i]) { coincide = false; break; }
    }
  }
  if (coincide) return { ok: true, vacia: false };
  return { ok: false, vacia: false, esperado: APPEND_HEADER, encontrado: headerRow };
}

// No usa `getOrCreateSheet_` a propósito — validar no debe crear nada.
// Si la hoja no existe, se trata igual que una hoja vacía (ok, se crea
// después, ya validado el resto).
function validarFormaHojaAppend_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  var header = null;
  if (sh && sh.getLastRow() >= 1) {
    header = sh.getRange(1, 1, 1, Math.max(APPEND_HEADER.length, sh.getLastColumn())).getValues()[0];
  }
  var v = validarCabeceraAppend_(header);
  v.hoja = nombre;
  return v;
}

// ─── U3 (auditoría Ronda 4): instrumentar la migración ─────────────────
// La confianza en T1 dependía de una migración manual, de un solo uso,
// corrida por una persona mirando Logger.log() en el editor de Apps
// Script — el mismo patrón de falla silenciosa que T0 se construyó para
// eliminar (ese log desaparece; nadie más lo ve). Cada corrida de
// `migrarAAppendOnly()` — exitosa, abortada por conteos, o abortada por
// formato (U2) — deja una fila permanente acá, y el panel de Ajustes la
// puede mostrar.
var MIGRACION_LOG_SHEET = 'migracion_log';

function getMigracionLogSheet_() {
  var sh = getOrCreateSheet_(MIGRACION_LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['timestamp', 'veredicto', 'reporteJSON']);
  return sh;
}

function registrarMigracionLog_(veredicto, reporteObj) {
  var ts = new Date().toISOString();
  getMigracionLogSheet_().appendRow([ts, veredicto, JSON.stringify(reporteObj || {})]);
  return ts;
}

// La corrida más reciente — lo que expone `migrationStatus` al cliente.
function getUltimaMigracion_() {
  var sh = ss_().getSheetByName(MIGRACION_LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var row = sh.getRange(sh.getLastRow(), 1, 1, 3).getValues()[0];
  var reporte = null;
  try { reporte = JSON.parse(row[2]); } catch (err) { /* fila corrupta — se ignora */ }
  return { ts: row[0], veredicto: row[1], reporte: reporte };
}

// Port a mano de `buildMigrationReport` (js/rowsync.js): junta
// antes/después/coincide con las filas realmente escritas, más un
// veredicto único para toda la corrida.
function buildMigrationReport_(estadoViejo, agregados) {
  var reporte = {};
  var ok = true;
  APPEND_COLLECTIONS.forEach(function (nombre) {
    var antes = (estadoViejo[nombre] || []).length;
    var despues = readAppendCollection_(nombre).length;
    var coincide = antes === despues;
    if (!coincide) ok = false;
    reporte[nombre] = { antes: antes, despues: despues, coincide: coincide, filasEscritas: (agregados && agregados[nombre]) || 0 };
  });
  return { ok: ok, veredicto: ok ? 'OK' : 'ABORTADA', reporte: reporte };
}

// El catálogo tal cual está en la celda, SIN la inyección de colecciones
// hidratadas que hace `readState_` — es lo único que sirve para saber si
// la migración ya corrió (ver `RowSyncFaseMigracion_`).
function leerCatalogoCrudo_() {
  var sh = ss_().getSheetByName(STATE_SHEET);
  var raw = sh ? sh.getRange(1, 1).getValue() : null;
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (err) { return {}; }
}

// Port a mano de `faseMigracion` (js/rowsync.js).
function RowSyncFaseMigracion_(catalogoCrudo) {
  var tieneTx = APPEND_COLLECTIONS.some(function (n) {
    return Array.isArray(catalogoCrudo && catalogoCrudo[n]) && catalogoCrudo[n].length > 0;
  });
  return tieneTx ? 'pre' : 'post';
}

// ─── Migración (T1) — correr UNA VEZ a mano desde el editor de Apps ────
// Script (Extensiones → Apps Script → elegir "migrarAAppendOnly" en el
// desplegable → Ejecutar). A propósito NO está expuesta por HTTP: una
// migración de datos no es algo que deba poder dispararse por accidente
// desde un cliente.
//
// Idempotente: `appendNewRecords_` ya dedupe por id, así que correrla dos
// veces dejando el Sheet en el mismo estado no duplica nada. NUNCA reduce
// la celda vieja (con todo embebido) si los conteos de cualquier
// colección no coinciden ANTES (blob) y DESPUÉS (filas ya escritas) —
// mismo criterio que `verifyMigrationCounts` en js/rowsync.js, probado
// ahí con un caso que falla a propósito.
function migrarAAppendOnly() {
  var sh = ss_().getSheetByName(STATE_SHEET);
  if (!sh) { Logger.log('No existe la hoja ' + STATE_SHEET + ' — nada que migrar.'); return { ok: false, error: 'sin hoja de estado' }; }
  var raw = sh.getRange(1, 1).getValue();
  if (!raw) { Logger.log('La celda de estado está vacía — nada que migrar.'); return { ok: false, error: 'celda vacía' }; }
  var estadoViejo = JSON.parse(raw);

  // U2: validar la FORMA de las 6 hojas destino ANTES de escribir una
  // sola fila. Si cualquiera tiene datos que no son del formato
  // append-only esperado (el caso real: "ventas"/"gastos"/"mermas" con
  // el mirror plano de antes de T1), se aborta sin tocar nada — ni
  // siquiera se crean las que faltan, para que la corrida sea repetible
  // tal cual una vez resuelto el problema a mano en el Sheet.
  var problemas = [];
  APPEND_COLLECTIONS.forEach(function (nombre) {
    var v = validarFormaHojaAppend_(nombre);
    if (!v.ok) problemas.push(v);
  });
  if (problemas.length) {
    Logger.log('MIGRACIÓN ABORTADA — formato de hoja inválido, nada se tocó: ' + JSON.stringify(problemas));
    registrarMigracionLog_('ABORTADA_FORMATO', { problemas: problemas }); // U3: persistido, no solo en el log del editor
    return { ok: false, error: 'FORMATO_HOJA_INVALIDO', problemas: problemas };
  }
  // Formato validado — ahora sí, crear las que faltan/estén vacías con su
  // cabecera explícita (para que la próxima corrida tenga contra qué
  // comparar).
  APPEND_COLLECTIONS.forEach(function (nombre) { getAppendSheet_(nombre); });

  var agregados = {};
  APPEND_COLLECTIONS.forEach(function (nombre) {
    agregados[nombre] = appendNewRecords_(nombre, estadoViejo[nombre]);
  });

  // U3: reporte estructurado — por colección, antes/después/coincide Y
  // cuántas filas se escribieron realmente, más un veredicto único.
  var resultado = buildMigrationReport_(estadoViejo, agregados);

  if (!resultado.ok) {
    Logger.log('MIGRACIÓN ABORTADA — los conteos no coinciden, la celda vieja NO se tocó: ' + JSON.stringify(resultado.reporte));
    registrarMigracionLog_(resultado.veredicto, resultado.reporte);
    return { ok: false, reporte: resultado.reporte, agregados: agregados };
  }

  var catalogo = {};
  Object.keys(estadoViejo).forEach(function (k) {
    if (APPEND_COLLECTIONS.indexOf(k) === -1) catalogo[k] = estadoViejo[k];
  });
  sh.getRange(1, 1).setValue(JSON.stringify(catalogo));
  Logger.log('MIGRACIÓN OK — celda reducida al catálogo: ' + JSON.stringify(resultado.reporte));
  registrarMigracionLog_(resultado.veredicto, resultado.reporte);
  return { ok: true, reporte: resultado.reporte, agregados: agregados };
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

  // T1: "ventas", "gastos" y "mermas" YA NO se espejan acá — esos nombres
  // de hoja ahora SON la fuente de verdad append-only (ver
  // appendNewRecords_ más arriba). `writeSheet_` hace `clearContents()` +
  // reescribe todo; llamarla sobre esas hojas destruiría el historial
  // append-only en cada sincronización, exactamente lo que T1 vino a
  // evitar. Se pierde la vista "plana" (columna por campo) que tenían
  // antes — lo que queda es la fila cruda `[id, fecha, supersedesId,
  // json]`, inspeccionable pero no tan cómoda para una tabla dinámica.
  // Si hace falta esa comodidad de vuelta, se puede armar una hoja de
  // solo lectura derivada del `json` de cada fila en una ronda futura —
  // no se hizo acá por alcance (ver PROGRESO.md § T1).
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

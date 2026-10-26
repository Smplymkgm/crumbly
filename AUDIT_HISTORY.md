# AUDIT HISTORY

Historial permanente de la auditoría de producción. Leer antes de empezar
un ciclo y agregar al final al terminar. Nunca borrar ciclos anteriores.
Especificación: `PRE_LAUNCH_AUDIT.md`. Estado vivo: `AUDIT_STATE.md`.

# AUDIT PRINCIPLES

El objetivo no es un reporte limpio sino una app segura, estable y lista
para producción. Cada ciclo mejora la app, encuentra problemas nuevos o
aumenta la confianza.

---

# CYCLE 0 — INITIALIZATION

Status: COMPLETE · Date: 2026-10-04

Se creó la especificación resumida, este historial y el estado. Mapa:
HTML estático en GitHub Pages (`index.html` ~7.200 líneas con un script
inline, `js/core.js` lógica pura, `js/supabaseSync.js` sync actual,
`js/sync.js` + `js/rowsync.js` respaldo Sheets y subidas a Drive,
`js/auth.js` login Google→Supabase+Apps Script), Supabase (Postgres + RLS
por lista `usuarios` + Realtime), Apps Script (`backend/Code.gs`: sesión,
subidas a Drive, respaldo diario). Sin package.json, sin build, sin lint,
sin typecheck: la verificación es `node tests/*.test.js` + `node --check`
del script inline + prueba en navegador + asesores de Supabase.

---

# AUDIT CYCLE 1

Date: 2026-10-04 · Status: FIXING

## SUMMARY (al abrir el ciclo)
Critical: 0 · High: 9 · Medium: 14 · Low: 9 · Info: varios

Agentes: código muerto/dependencias/arquitectura, seguridad, errores/
rendimiento/configuración/BD; más asesores de Supabase (seguridad y
rendimiento).

## DEAD CODE
Confirmed: `saleRowCount`, `topRowCount`, `soloTopRowCount`,
`getWeekRangeLabel`, `importMenuCrumbly` (+datos), alias CSS `--cream…
--accent`, `.badge-outline`, `.checkbox-box*`, core `getEmpaqueTotalProducto`,
`getConsumptionEnRango`.
Potential (se conservan): `migrarASupabase()` (consola), camino Sheets
(`crumbly-backend='sheets'`), exports de sync.js usados solo por tests.
Removed: ver CHANGES (agente de limpieza).

## DEPENDENCIES
Sin package.json. CDNs: supabase-js `@2` sin fijar (HIGH), jspdf 2.5.1,
jspdf-autotable 3.8.2, phosphor 2.1.1 sin SRI (MEDIUM). GSI sin versión
(Google no lo permite, aceptado). Edge function `asistente` sin desplegar.

## SECURITY
High: XSS por categorías dentro de `onclick="f('${esc(c)}')"` (esc no
protege el contexto de string JS) — **arreglado** (`jsArg`).
Medium: registro abierto en Supabase Auth (email + cualquier Google) y
`usuarios` legible por cualquier autenticado — política arreglada en 0004
(pendiente de correr); desactivar el proveedor Email = acción del dueño.
Sesiones de Apps Script seguían válidas tras desactivar al usuario —
**arreglado**. Carpetas de Drive buscadas por nombre — **arreglado**
(por ID). Subidas sin validar tipo/tamaño — **arreglado**. Comprobantes
públicos con link — HUMAN REVIEW. CDN sin SRI/CSP — en curso.
Low: token en la URL (GET del camino Sheets), `iss` no verificado
(**arreglado**), campos sin escapar (`unidad`, `value=`) — en curso,
inyección de fórmulas en CSV — en curso.
Secretos: ninguno en el repo ni en el historial (185 commits).

## PERFORMANCE
Asesor: 14 políticas RLS con `auth.jwt()` por fila — arreglado en 0004
(pendiente de correr). Sin bucles O(n²); diff de push ~35 ms con 1000
ventas (aceptable). localStorage: estado + base ≈ 2× estado; tope de
Safari ~5 MB se alcanzaría con ~1.500–2.000 ventas (MEDIUM, a futuro).

## ARCHITECTURE
`index.html` gigante con handlers por string sin prueba (HIGH) → smoke
test de handlers en curso. `sync.js` sigue siendo necesario en el camino
Supabase (cola de borrados, subidas, respaldo) — documentado, no se borra.
Total del carrito duplicado entre UI y core (MEDIUM, HUMAN REVIEW).
`normalizarBusqueda_` duplicado — en curso.

## FUNCTIONALITY / DATA SAFETY
High: orden de escritura base/estado (cuota llena → borrados inferidos
falsos), BORRADO_MASIVO sin salida, errores de sync invisibles, sin
camino de restauración y respaldo que puede dejar de guardarse en
silencio — en curso (agente de sync). Medium: realtime no se pone al día
al reconectar, `schedulePush` dentro del try — en curso.

## TESTS
Unit: PASS (516). Integration/E2E: no existen (UI sin pruebas).
Lint/Typecheck/Build: N/A (no hay herramientas; se usa `node --check`).

## CHANGES
- index.html: `jsArg` para categorías en onclick/onchange (6 lugares).
  Razón: XSS. Confianza: CONFIRMED. Verificación: node --check + prueba
  de escape.
- supabase/migrations/0004_rls_initplan.sql: nueva. Razón: asesor de
  rendimiento + fuga de `usuarios`. Confianza: HIGH. Verificación:
  pendiente (la corre el dueño; luego re-correr asesores).
- backend/Code.gs: sesiones exigen usuario activo, `iss`, tipo/tamaño de
  subidas, carpetas por ID. Confianza: HIGH. Verificación: `node --check`;
  efectivo solo tras redesplegar (dueño).

## HUMAN REVIEW REQUIRED
- Desactivar proveedor Email y registros en Supabase Auth (Dashboard).
- Correr 0004 en el SQL Editor y redesplegar Apps Script.
- Comprobantes con link público: pasarlos a privados exige un proxy
  autenticado (cambio de arquitectura).
- Repo público en GitHub (docs con correos personales).
- PWA (manifest + service worker) y monitoreo de errores: funcionalidad
  nueva, decidir.
- Borrar docs viejos sin seguimiento en git (no se borran archivos del
  usuario sin permiso).

- index.html (merge 46f1137): `guardarStateYBase_` (estado antes que
  base; si falla, se olvida la base), `schedulePush` fuera del try,
  recuperación de BORRADO_MASIVO (descarga JSON + confirm + bajada
  completa), punto rojo de sync en el avatar, realtime se pone al día al
  reconectar y no se re-suscribe tras logout, aviso de respaldo viejo,
  `restaurarDesdeRespaldo(json)` de consola. Confianza: HIGH.
  Verificación: tests + navegador con Supabase simulado.
- index.html + js/core.js (merge 4ee606b): borrado el código muerto
  confirmado; `normalizarBusqueda_` = alias de core; supabase-js fijado a
  2.117.2 + SRI en supabase-js, jspdf, autotable y phosphor; `csvCelda_`
  contra inyección de fórmulas; `esc()` en unidades y `value=`; nueva
  `tests/handlers.test.js`. Confianza: CONFIRMED/HIGH. Verificación: 519
  tests, node --check, navegador local y producción (librerías cargan con
  SRI, sin errores de consola).
- E2E local (celular 375 px): categoría con apóstrofo, venta → stock →
  Pedidos → cierre de caja, CSV, sin errores de consola.

## REGRESSIONS
Una: el smoke test nuevo marcó un falso positivo (un `onclick="f(` dentro
de un comentario) — corregido el comentario (dda51f2). Ninguna en la app.

## CYCLE RESULT
IMPROVED. Publicado (dda51f2). Quedan acciones del dueño (0004, Apps
Script, Auth) y revisión humana; ciclo 2 = verificación independiente.

---

# AUDIT CYCLE 2

Date: 2026-10-04 · Status: COMPLETE

## SUMMARY
Critical: 0 · High: 0 nuevos · Medium: 3 nuevos (arreglados) · Low: 3

Verificación independiente (agente que no hizo los cambios) de todos los
commits del ciclo 1, sin asumir que estaban bien.

## VERIFICADO CORRECTO
Orden estado/base, `schedulePush` fuera del try, punto de sync, realtime
sin bucle, `restaurarDesdeRespaldo`, los 6 `jsArg`, filtro `https?://` en
los links de comprobantes, `iss`, sesión con usuario activo,
`carpetaPropia_`, los 4 hashes SRI (recalculados), código muerto sin
referencias, 0004 válida e idempotente y compatible con `auth.js`.

## NUEVOS (MEDIUM, arreglados en 7551c7f)
- `descartarCambiosLocales_` olvidaba la base ANTES de que el pull saliera
  bien: sin red, las ventas siguientes se pisaban. Ahora baja primero y
  solo si sale bien olvida y reemplaza (`aplicarPullCompleto_`).
- iOS: confirmaba el descarte antes de que el archivo se guardara. Ahora
  es en dos toques y el blob vive 60 s.
- Apps Script rechazaba `f.type` vacío (HEIC en Chrome/Windows) y
  `image/jpg`: se deduce por extensión y se amplió la lista.
- LOW: un aviso sin acción tapaba el de BORRADO_MASIVO; carpeta en la
  papelera reutilizada. Arreglados.

## TESTS
Unit: PASS (519) · node --check: PASS (script inline, js/*.js, Code.gs)
E2E manual: recuperación de sync (aviso → descarga → segundo toque; pull
fallido deja la base intacta) PASS.

## CHANGES
FILE: index.html, backend/Code.gs · CHANGE: ver arriba · CONFIDENCE: HIGH
· VERIFICATION: tests + node --check + navegador.

## REGRESSIONS
Ninguna detectada.

## HUMAN REVIEW REQUIRED
Correr 0004; desactivar proveedor Email en Supabase Auth; redesplegar
Apps Script; decidir PWA, monitoreo, comprobantes privados, repo público,
límite de localStorage.

## CYCLE RESULT
READY_FOR_REVIEW — sin CRITICAL/HIGH en código; PRODUCTION_READY queda
bloqueado por las 3 acciones del dueño y un ciclo final después de ellas.

---

# AUDIT CYCLE 3 (pendientes MEDIUM)

Date: 2026-10-24 · Status: COMPLETE

## CHANGES
- PWA (f314ee3): `manifest.webmanifest`, `icons/`, `sw.js` network-first
  (no intercepta Supabase/Google ni `?check=`; CDN fijados cache-first; solo
  borra cachés `crumbly-*`). Verificado: instala, arranca offline, la
  autoactualización sigue funcionando, SRI OK. Confianza: HIGH.
- Monitoreo (7d69e6d): `reportarError_` (onerror + unhandledrejection, máx.
  20/sesión) → tabla `errores` (0005, RLS de usuarios activos). Confianza:
  HIGH. Efectivo cuando el dueño corra 0005.
- README actualizado (describía la app sin backend).
- Además (fuera de la auditoría): descuentos en ventas con tests (8a1a05d,
  91a603f): subtotal/descuento guardados, cortesía no cuenta como costo
  inválido.

## TESTS
Unit: PASS (520) · node --check: PASS (inline, js/*.js, sw.js)

## REMAINING
Acciones del dueño (0004+0005, Auth Email, redesplegar Apps Script) y luego
ciclo final. Siguen en revisión humana: comprobantes públicos, tope de
localStorage, repo público, total del carrito duplicado.

## CYCLE RESULT
IMPROVED

---

# AUDIT CYCLE 4 — ACCIONES DEL DUEÑO (con el navegador)

Date: 2026-10-24 · Status: COMPLETE

- 0004 + 0005 corridas en el SQL Editor. Primer intento con
  `(select auth.jwt() ->> 'email')` dejó el aviso initplan; se reescribió a
  `((select auth.jwt()) ->> 'email')` (265adfc) y se volvió a correr:
  asesor de rendimiento sin initplan (solo 5 INFO de índices sin uso).
  pg_policies verificado.
- Proveedor Email desactivado (verificado por /auth/v1/settings).
- Apps Script: el código nuevo se pegó en "Crumbly Backend" y se publicó
  como versión 6 en la implementación AKfycbwh… (la de la app). Antes
  corría la versión 3 del 29 ago: el respaldo diario (acción `respaldo`) y
  las carpetas por mes nunca habían estado activos. Hay 2 proyectos "sin
  título" de crumbly2026 (3 oct) con código suelto que no usa nadie.
- Almacenamiento: state y base pasaron a IndexedDB (ed90cd5), probado con
  ~35 MB / 26.000 ventas y con migración desde localStorage.

## PENDIENTE PARA PRODUCTION_READY
Que el dueño abra la app en el celular: "Sincronizado", ventas visibles y
archivo del día en "Crumbly - Respaldos" (Drive de crumbly2026). Luego ciclo
final.

---

# AUDIT CYCLE 5 — FINAL (verificación independiente)

Date: 2026-10-24 · Status: COMPLETE

Verificador independiente sobre HEAD 42e9616: 0 CRITICAL, 0 HIGH. 533
tests, node --check OK, producción sirve la versión de HEAD, pg_policies y
asesores OK, sw.js correcto, matemática de descuentos consistente, XSS sin
hallazgos nuevos.

Hallazgos y arreglos (este ciclo):
- MEDIUM: el cursor `desde` se guardaba antes de que IndexedDB confirmara
  state+base → ahora solo tras `guardarStateYBase_` OK.
- LOW: migración mezclaba llaves de IndexedDB y localStorage → solo migra
  si IndexedDB no tiene ninguna.
- LOW: total con centavos (toppings por gramo) y tope del descuento → total
  redondeado a pesos en `applyVenta`, descuento con tope correcto (test).
- LOW: punto de equilibrio ignoraba descuentos → `getCMPonderado` los
  descuenta (test).
- LOW: `errores_insertar` no ataba el email al JWT → corregido y aplicado
  (verificado en pg_policies).

Confirmado por el dueño en el celular: "Sincronizado ✓", ventas visibles,
`respaldo_2026-10-24.json` en Drive (12:38), tabla `errores` vacía.

## CYCLE RESULT
PRODUCTION_READY. Quedan como revisión humana (no bloquean): comprobantes
con link público, repo público, proyectos de Apps Script "sin título"
sueltos en crumbly2026.

---

# CYCLE 6 — HALLAZGOS DE FUNCIONALIDAD (primer día real de operación)

Date: 2026-10-25 · Status: COMPLETE en rama `feat/clientes-imagenes` (sin merge)

Cinco ciclos de auditoría revisaron la maquinaria (sync, seguridad, datos)
pero no recorrieron los flujos del negocio. El dueño operó un día y
encontró dos cosas que ningún ciclo vio:

## C1 · No se capturaban clientes (73e759e)
El teléfono de un cliente nuevo estaba escondido en "Más opciones": en un
día completo no se registró ni un contacto. Ahora: campo Teléfono visible
en Pedido; si existe, "Cliente: X ✓" y se asocia; si no, aparece "Nombre
del cliente" (prellenado con el nombre para llamar). Opcional, nunca
bloquea la venta. Texto de propósito (Ley 1581) al enfocar el campo y en
el (i).
- `normalizarTelefono`: solo dígitos; se quita `57` si quedan 12 dígitos
  (o `057` con 13) → `3001234567`, `300 123 4567`, `+57 300 123 4567` son el
  mismo cliente (test). Otros largos se guardan con su indicativo.
- Nunca dos clientes con el mismo teléfono normalizado (venta y pantalla
  Clientes). Se guarda `telefono` (como se escribió) y `telefonoNorm`.
- Migración `normalizarTelefonosClientes` al arrancar: completa
  `telefonoNorm` y REPORTA grupos con el mismo teléfono en el aviso de
  Clientes; no fusiona nada. En los datos reales solo 1 cliente tiene
  teléfono ("consumidor final"): 0 duplicados.
- No-regresión: venta sin teléfono → `clienteId` null (test).

## C2 · Comprobantes sin comprimir (f57afd2)
`js/imagenes.js`: perfil único de comprobante (lado mayor ≤ 2000 px, JPEG
0,85; con transparencia WebP/PNG), orientación EXIF con
`createImageBitmap(..., {imageOrientation:'from-image'})`, HEIC u otro no
decodificable → se sube el original, nunca más grande que el original
(test). Indicador "Comprimiendo…". `Code.gs` sin cambios (sigue siendo la
defensa). Perfil de foto de producto no construido: las fotos de producto
se quitaron de la app.
Verificado: foto vertical EXIF 6 de 4,07 MB → 339 KB, 1500×2000, derecha,
monto/referencia/fecha/letra chica legibles; HEIC falso → original; PNG
chico → original; PNG transparente 2,84 MB → WebP 924 KB.

## TESTS
563 PASS (core 377, sync 48, supabaseSync 44, rowsync 39, auth 22,
imagenes 17, almacen 13, handlers 3). node --check OK. Navegador a 375 px:
cliente existente con otro formato → asociado sin duplicar; nuevo con
teléfono y nombre → creado y asociado sin perder el carrito; sin teléfono →
venta igual que antes; sin errores de consola.

## CYCLE RESULT
IMPROVED — pendiente merge a main (decisión del dueño).

---

# CYCLE 7 — NOTA EDITABLE + LIMPIEZA DEL ESTADO

Date: 2026-10-25 · Status: COMPLETE en `feat/clientes-imagenes` (sin merge)

## Nota de pedido editable (ae971f9)
`CrumblyCore.editarNotaVenta`: único campo editable de una venta; guarda
`notaEditadaPor`/`notaEditadaEn`. Lápiz o "+ Nota" en Pedidos (tarjetas,
historial de hoy, días anteriores).
- Test: editar la nota de una venta de AYER no cambia total, ganancia,
  ítems, consumo ni la cascada de costeo del período.
- Test de sync: viaja como upsert de la MISMA fila (UPDATE), sin duplicar
  ni soft-delete.
- Navegador: sobrevive al reload; una edición remota aplicada como fila de
  realtime (`{id, data, deleted_at}`) se ve sin recargar; la venta no se
  duplica. (Ojo al simular: `aplicarFila_` espera la fila de Supabase, no la
  venta suelta; pasarla suelta la toma como borrada. No es un bug de la app.)

## Limpieza del estado (pedido del dueño tras revisar el ciclo 6)
AUDIT_STATE.md reescrito: ciclo 7, HIGH sin bloqueadores (las acciones del
dueño pasan a RESUELTOS), MEDIUM 4 reales, LAST ACTIONS / FILES / DATABASE /
PRODUCTION CONFIGURATION / BLOCKERS / NEXT ACTION al día.

## Cambio de criterio de auditoría
`PRE_LAUNCH_AUDIT.md` § Recorrido de flujos de negocio: obligatorio desde
el ciclo 6 (vender, cobrar, pedidos, gastos, cerrar caja, contar
inventario, reabrir), en celular real o a 375 px, y es condición del
criterio de producción.

## TESTS
565 PASS (core 378, sync 48, supabaseSync 45, rowsync 39, auth 22,
imagenes 17, almacen 13, handlers 3).

## CYCLE RESULT
IMPROVED — rama lista para el recorrido de flujos y el merge.

---

# CYCLE 8 — HISTORIAL DE PEDIDOS + SELECTOR DE MES

Date: 2026-10-26 · Status: COMPLETE

## Selector de mes del gráfico (main, cf6c4d0, en producción)
El "Octubre" del gráfico de ingresos era una etiqueta con forma de botón:
el dueño lo tocó y no pasaba nada. Ahora ‹ mes › mueve el gráfico y el
calendario juntos (comparten `calMes`). Mes pasado: completo vs el anterior
completo; mes actual: hasta hoy. Otro hallazgo de uso, no de código.

## Historial de Pedidos (rama, 00fa7a1)
Pestañas "En curso" (por defecto y al entrar, con realtime y sonido) e
"Historial" (filtro con contador: hoy, ayer, 7 días, este mes,
personalizado). Filtra con `getVentasByRange`; el rango sale de
`CrumblyCore.rangoHistorialPedidos` (test). Agrupa por día con cantidad y
total, nota editable.
- En Historial no suena y la lista no se redibuja con pedidos nuevos; aviso
  fijo "N pedidos en curso · Ver la cola".
- Datos: el sync baja colecciones completas (pull completo inicial,
  incremental solo agrega), así que todo dispositivo sincronizado tiene
  todas las ventas. Sin `lastSync` el mensaje es "este dispositivo todavía
  no bajó los datos", distinto de "no hubo pedidos en este período".
- Movimientos usa embudo + panel + contador + Limpiar con una sola fecha;
  el historial usa el mismo patrón con presets de rango.

## TESTS
566 PASS (core 379, sync 48, supabaseSync 45, rowsync 39, auth 22,
imagenes 17, almacen 13, handlers 3). Navegador a 375 px: entrar = cola con
sonido; 7 días = 3 pedidos con totales correctos (excluye uno de hace 10
días); pedido nuevo en Historial no suena ni cambia la lista y sí muestra
el aviso; rango vacío vs no cargado con mensajes distintos; sin errores.

## CYCLE RESULT
IMPROVED — rama lista para el recorrido de flujos y el merge.

---

# CYCLE 9 — RECORRIDO DE FLUJOS (pre-merge) + MERGE

Date: 2026-10-26 · Status: COMPLETE

Recorrido de `PRE_LAUNCH_AUDIT.md` § Recorrido, en navegador a 375 px, con
datos tipo reales (productos con receta, adiciones, insumos, un cliente),
sesión y subidas simuladas (sin tocar Supabase ni Drive):

1. Vender: Waffle + Nutella + Fresas = $31.600 a cliente NUEVO (Laura,
   `telefonoNorm` 3115556677); "+57 (300) 123-4567" reconoce a Ana sin
   duplicar; venta sin cliente con `clienteId` null; stock descontado
   exacto según recetas. PASS
2. Cobrar: 10% de descuento ($24.000 → $21.600) con pago dividido
   10.000 / 11.600; transferencia con foto vertical EXIF 6 de 4,07 MB →
   subió 339 KB, 1500×2000, derecha; estados "Comprimiendo… / Subiendo… /
   ✓". PASS
3. Pedidos: Listo → Entregado → deshacer; nota editada sin tocar el total;
   en Historial un pedido nuevo no suena ni mueve la lista y aparece "6
   pedidos en curso"; "Ver la cola" vuelve y ahí sí suena; total del día
   $113.200 correcto. PASS
4. Gastos: compra Makro de 2 líneas + 2 comprobantes → 2 gastos con el
   mismo grupo y ambos comprobantes, archivos
   `2026-10-26_makro_58000_{1,2}.jpg` de 339 KB, stock sumado. PASS
5. Cierre de caja: ingresos $133.200, gastos −$58.000, efectivo $43.600,
   transferencias $31.600, descuentos −$2.400 = cálculo a mano. PASS
6. Conteo: con una diferencia sin motivo NO cierra ("1 sin motivo",
   correcto); con motivo cierra, stock = contado, 1 snapshot, 3 ajustes,
   sin conteo pendiente. PASS
7. Reabrir: tras reload, mismos datos (ventas, gastos, clientes, stock,
   nota) desde IndexedDB y misma página; sin errores de consola. PASS

Tests: 566 PASS. Resultado: recorrido sin fallas → merge de
`feat/clientes-imagenes` a main aprobado por el dueño ("haz lo que debas").

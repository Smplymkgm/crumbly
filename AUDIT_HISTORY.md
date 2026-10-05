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

# AUDIT STATE

Status: PRODUCTION_READY

Current audit cycle: 5 (final)

Last updated: 2026-10-25

---

# PRODUCTION READINESS

CRITICAL: 0
HIGH: 0 (acciones del dueño hechas y verificadas)
MEDIUM: 5
LOW: 6
INFO: varios

Build: N/A (HTML estático sin build) · `node --check` PASS
Tests: PASS (563 medidos 2026-10-25: core 377, sync 48, supabaseSync 44, rowsync 39, auth 22, imagenes 17, almacen 13, handlers 3)
Lint: N/A (no hay linter) · smoke test de handlers PASS
Typecheck: N/A (JS sin tipos)
Security: ACEPTABLE (0004/0005 aplicadas, Email apagado, Apps Script v6)
Production configuration: VERIFIED (celular sincroniza, respaldo diario en Drive, 0 errores registrados)

---

# CURRENT OBJECTIVE

Producción estable. Rama `feat/clientes-imagenes` (sin merge a main) con
dos hallazgos de funcionalidad del primer día real de operación: captura
de clientes en la venta (C1) y compresión de comprobantes (C2). Revisar y
mergear cuando el dueño lo apruebe.

---

# ACTIVE ISSUES

## CRITICAL
Ninguno.

## HIGH
Ninguno en código. Acciones del dueño (bloquean PRODUCTION_READY):
1. ~~Correr 0004 + 0005~~ → aplicadas 2026-10-24 y verificadas (pg_policies;
   asesor de rendimiento sin avisos de initplan).
2. ~~Desactivar proveedor Email~~ → hecho 2026-10-24 (verificado en
   /auth/v1/settings: email=false, google=true). Registro con Google sigue
   abierto a propósito (empleados nuevos); sin estar en `usuarios` no ven datos.
3. ~~Redesplegar Apps Script~~ → hecho 2026-10-24: "Crumbly Backend",
   implementación "Autenticación con Google" (la URL que usa la app) pasó de
   la versión 3 (29 ago) a la 6. Hallazgo: los redespliegues anteriores
   habían ido a proyectos nuevos sin título, así que el respaldo diario y las
   carpetas por mes nunca habían funcionado. Corrió sin pedir permisos nuevos.

## MEDIUM
- Comprobantes con link público (cualquiera con la URL los ve). Hacerlos
  privados requiere un proxy autenticado — HUMAN_REVIEW_REQUIRED.
- ~~Tope de localStorage~~ → resuelto (ed90cd5): state y base en IndexedDB
  (`js/almacen.js`), escritos juntos en una transacción; migración automática
  desde localStorage; probado con ~35 MB / 26.000 ventas.
- ~~Sin PWA~~ → resuelto (f314ee3): manifest, íconos y `sw.js` network-first
  (no esconde versiones nuevas; arranque offline desde caché).
- ~~Sin monitoreo~~ → resuelto en código (7d69e6d): errores a la tabla
  `errores`; falta correr `0005_errores.sql` (dueño).
- Total del carrito calculado en UI y en core por separado (riesgo de
  redondeo en pago dividido) — HUMAN_REVIEW_REQUIRED (lógica de negocio).
- `index.html` gigante con handlers por string (mitigado por el smoke test).
- Repo público en GitHub (docs con correos personales).

## LOW
- Ids generados sin escapar dentro de onclick (solo los puede poner un
  usuario de la lista o un respaldo restaurado).
- Token de sesión en la URL en los GET del camino Sheets (fallback).
- Hook de versión: `git add index.html` agrega cambios sin preparar del
  mismo archivo; los merges chocan en la marca de versión (trivial).
- Índice `(deleted_at) where deleted_at is null` casi inútil; `(updated_at, id)`
  sería mejor a futuro.
- Edge function `asistente`: dependencias sin versión fija, sin límite por
  usuario (no desplegada).
- Respaldo: cualquier sesión puede reemplazar el del día.

## INFO
Secretos: ninguno en el repo ni en el historial. RLS en las 14 tablas;
anon no ve nada. Sin bucles O(n²). Sin console.log ni localhost.

---

# CONFIRMED DEAD CODE
Eliminado en el ciclo 1 (ver historial). Ninguno pendiente.

# POTENTIALLY UNUSED CODE
`migrarASupabase()` (consola), camino Sheets (`crumbly-backend='sheets'`,
`js/rowsync.js`, partes de `js/sync.js`), exports de sync.js usados solo en
tests. Se conservan hasta retirar Sheets.

# SECURITY FINDINGS
Ver ACTIVE ISSUES. Arreglados: XSS por categorías, sesiones tras
desactivar, `iss`, validación de subidas, carpetas por ID, SRI + versión fija.

# PERFORMANCE FINDINGS
RLS initplan (arreglado en 0004, falta aplicarla). Diff de push ~35 ms con
1000 ventas: aceptable.

# ARCHITECTURE FINDINGS
`sync.js` sigue siendo necesario con Supabase (cola de borrados, subidas,
respaldo): no borrar. Archivo único grande: mitigado con smoke test.

# FUNCTIONALITY FINDINGS
Arreglados: escritura estado/base, BORRADO_MASIVO sin salida, errores de
sync invisibles, realtime sin ponerse al día, respaldo que fallaba en
silencio, restauración (`restaurarDesdeRespaldo` en consola).

# PRODUCTION CONFIGURATION FINDINGS
GitHub Pages `max-age=600` cubierto por la autoactualización. Sin manifest
ni service worker (MEDIUM). HTTPS OK.

---

# TESTING STATUS
Unit tests: PASS (563)
Integration tests: N/A
E2E tests: manual en navegador (venta → stock → Pedidos → cierre; categoría
con apóstrofo; recuperación de sync) PASS
Lint / Typecheck / Build: N/A

---

# LAST ACTIONS
Ciclo 2: verificación independiente sin CRITICAL/HIGH nuevos; arreglados 3
MEDIUM (descarte local seguro en dos pasos, aviso que no se tapa, MIME de
comprobantes por extensión). Publicado `7551c7f`.

# FILES MODIFIED
index.html, js/core.js, backend/Code.gs, tests/handlers.test.js (nuevo),
supabase/migrations/0004_rls_initplan.sql (nuevo), PRE_LAUNCH_AUDIT.md,
AUDIT_STATE.md, AUDIT_HISTORY.md.

# FILES DELETED
Ninguno (solo código muerto dentro de archivos).

# DEPENDENCIES REMOVED / ADDED
Ninguna. supabase-js fijada a 2.117.2 (antes `@2` flotante).

# DATABASE CHANGES
0004 escrita, sin aplicar (la corre el dueño).

# API CHANGES
Apps Script: acción `uploadComprobante` ahora rechaza tipos no
imagen/PDF y > 10 MB (el cliente ya limitaba a 10 MB).

# SECURITY CHANGES
Ver SECURITY FINDINGS.

# HUMAN REVIEW REQUIRED
Las 3 acciones del dueño (HIGH) y los MEDIUM marcados arriba.

# BLOCKERS
Acciones del dueño 1–3.

# NEXT ACTION
1. Leer PRE_LAUNCH_AUDIT.md, este archivo y AUDIT_HISTORY.md.
2. Confirmar con `pg_policies` que 0004 está aplicada y re-correr los
   asesores de Supabase (seguridad y rendimiento).
3. Confirmar que el proveedor Email está desactivado (`/auth/v1/settings`).
4. Ciclo final independiente (no asumir que los arreglos están bien).
5. Si no aparece nada CRITICAL/HIGH → PRODUCTION_READY.

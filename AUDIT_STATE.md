# AUDIT STATE

Status: READY_FOR_REVIEW  (pendiente: acciones del dueño → luego ciclo final)

Current audit cycle: 2

Last updated: 2026-10-04

---

# PRODUCTION READINESS

CRITICAL: 0
HIGH: 0 (en código; quedan 3 acciones del dueño marcadas abajo)
MEDIUM: 7
LOW: 6
INFO: varios

Build: N/A (HTML estático sin build) · `node --check` PASS
Tests: PASS (519: core 363, sync 48, supabaseSync 44, rowsync 39, auth 22, handlers 3)
Lint: N/A (no hay linter) · smoke test de handlers PASS
Typecheck: N/A (JS sin tipos)
Security: ACEPTABLE en código; falta aplicar 0004 + desactivar registro Email
Production configuration: PARCIAL (producción carga con SRI y sin errores de consola; Apps Script sin redesplegar)

---

# CURRENT OBJECTIVE

Que el dueño aplique las 3 acciones pendientes, verificar con los asesores
de Supabase y correr el ciclo final independiente.

---

# ACTIVE ISSUES

## CRITICAL
Ninguno.

## HIGH
Ninguno en código. Acciones del dueño (bloquean PRODUCTION_READY):
1. Correr `supabase/migrations/0004_rls_initplan.sql` en el SQL Editor
   (verificado: todavía no aplicada).
2. Supabase → Authentication → Providers: desactivar **Email** y los
   registros nuevos (cualquiera puede crear una cuenta; no ve datos, pero
   hoy sí ve la lista de usuarios hasta que se aplique 0004).
3. Redesplegar el Apps Script con `backend/Code.gs` (sesiones de usuarios
   desactivados, validación de subidas, carpetas por ID).

## MEDIUM
- Comprobantes con link público (cualquiera con la URL los ve). Hacerlos
  privados requiere un proxy autenticado — HUMAN_REVIEW_REQUIRED.
- localStorage: estado + base ≈ 2× el estado; Safari ~5 MB ≈ 1.500–2.000
  ventas. Plan: guardar solo los últimos N días o pasar a IndexedDB.
- Sin PWA (manifest + service worker): sin arranque offline y Safari puede
  borrar datos a los 7 días si no se instala. Funcionalidad nueva — decidir.
- Sin monitoreo de errores (window.onerror → tabla). Decidir.
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
Unit tests: PASS (519)
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

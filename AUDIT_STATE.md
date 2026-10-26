# AUDIT STATE

Status: PRODUCTION_READY

Current audit cycle: 9

Last updated: 2026-10-26

---

# PRODUCTION READINESS

CRITICAL: 0
HIGH: 0
MEDIUM: 4 (ver ACTIVE ISSUES; ninguno bloquea)
LOW: 6
INFO: varios

Build: N/A (HTML estático sin build) · `node --check` PASS (script inline, js/*.js, sw.js)
Tests: PASS — 566 medidos 2026-10-26 en `feat/clientes-imagenes`:
core 379, sync 48, supabaseSync 45, rowsync 39, auth 22, imagenes 17,
almacen 13, handlers 3. (main: 535)
Lint: N/A (no hay linter) · smoke test de handlers PASS
Typecheck: N/A (JS sin tipos)
Security: ACEPTABLE (RLS 0004/0005 aplicadas y verificadas, proveedor Email
apagado, Apps Script v6, SRI en CDN)
Production configuration: VERIFIED (celular sincroniza, respaldo diario en
Drive desde 2026-10-24, tabla `errores` vacía)

---

# CURRENT OBJECTIVE

Main está en producción y verificado (incluye el arreglo del selector de mes
del gráfico, cf6c4d0). La rama `feat/clientes-imagenes` tiene cuatro cambios
de funcionalidad pedidos tras operar (C1 captura de cliente por teléfono, C2
compresión de comprobantes, nota editable en Pedidos, historial de Pedidos):
esperan el recorrido de flujos y que el dueño apruebe el merge. Desde el ciclo 6, toda auditoría incluye el
recorrido de flujos de negocio (ver `PRE_LAUNCH_AUDIT.md` § Recorrido).

---

# ACTIVE ISSUES

## CRITICAL
Ninguno.

## HIGH
Ninguno.

## MEDIUM
- Comprobantes con link público (cualquiera con la URL los ve). Hacerlos
  privados requiere un proxy autenticado. HUMAN_REVIEW_REQUIRED.
- Total del carrito calculado en UI y en core por separado. Mitigado en el
  ciclo 5 (core redondea el total a pesos) pero sigue duplicado.
  HUMAN_REVIEW_REQUIRED (lógica de negocio).
- `index.html` gigante con handlers por string (mitigado por
  `tests/handlers.test.js`).
- Repo público en GitHub (docs con correos personales). Decisión del dueño.

## LOW
- Ids generados sin escapar dentro de onclick (solo los puede poner un
  usuario de la lista o un respaldo restaurado).
- Token de sesión en la URL en los GET del camino Sheets (fallback).
- Hook de versión: `git add index.html` agrega cambios sin preparar del
  mismo archivo; los merges chocan en la marca de versión (trivial).
- Índices `*_live_idx` sin uso (asesor INFO); `(updated_at, id)` sería mejor.
- Edge function `asistente`: dependencias sin versión fija, sin límite por
  usuario (no desplegada).
- Dos proyectos "Proyecto sin título" sueltos en el Apps Script de
  crumbly2026 (copias del 3 oct que nadie usa). El dueño puede borrarlos.

## RESUELTOS (para no repetir trabajo)
- Acciones del dueño del ciclo 4, hechas y verificadas el 2026-10-24:
  0004+0005 aplicadas (pg_policies, asesor sin initplan), proveedor Email
  apagado (`/auth/v1/settings`: email=false, google=true), Apps Script
  "Crumbly Backend" implementación "Autenticación con Google" en v6.
- Tope de localStorage → IndexedDB (`js/almacen.js`), ciclo 4.
- PWA (manifest, íconos, `sw.js` network-first), ciclo 3.
- Monitoreo de errores (tabla `errores`, 0005 aplicada), ciclos 3–5.

## INFO
Secretos: ninguno en el repo ni en el historial. RLS en las 15 tablas
(incl. `errores`); anon no ve nada. Sin bucles O(n²). Sin console.log ni
localhost.

---

# CONFIRMED DEAD CODE
Ninguno pendiente (eliminado en el ciclo 1; el ciclo 6 quitó el formulario
escondido de cliente nuevo de "Más opciones").

# POTENTIALLY UNUSED CODE
`migrarASupabase()` (consola), camino Sheets (`crumbly-backend='sheets'`,
`js/rowsync.js`, partes de `js/sync.js`), exports de sync.js usados solo en
tests. Se conservan hasta retirar Sheets.

# SECURITY FINDINGS
Sin abiertos fuera de ACTIVE ISSUES. Arreglados: XSS por categorías
(`jsArg`), sesiones tras desactivar, `iss`, validación de subidas, carpetas
por ID, SRI + versión fija, `usuarios` solo la fila propia, `errores` con
email atado al JWT.

# PERFORMANCE FINDINGS
RLS initplan resuelto (0004 aplicada). Diff de push ~35 ms con 1000 ventas.
Registrar venta ~12 ms con 600 ventas del día. IndexedDB probado con ~35 MB.

# ARCHITECTURE FINDINGS
`sync.js` sigue siendo necesario con Supabase (cola de borrados, subidas,
respaldo): no borrar. Archivo único grande: mitigado con smoke test.

# FUNCTIONALITY FINDINGS
Ciclo 6 (flujos reales): captura de cliente escondida (C1) y comprobantes
sin comprimir (C2), resueltos en la rama. Ciclo 7: nota de pedido editable.

# PRODUCTION CONFIGURATION FINDINGS
GitHub Pages `max-age=600` cubierto por la autoactualización y el service
worker network-first. Manifest e íconos presentes. HTTPS OK. Respaldo
diario activo.

---

# TESTING STATUS
Unit tests: PASS (566 en la rama; 535 en main)
Integration tests: N/A
E2E: manual en navegador a 375 px (venta con descuento → stock → Pedidos →
cierre; cliente nuevo / existente / sin teléfono; nota editada + reload +
realtime simulado; compresión de foto vertical EXIF 6; historial de Pedidos:
entrar = cola con sonido, 7 días con totales, sin sonido ni salto de lista,
rango vacío vs datos no cargados) PASS
Recorrido de flujos: PASS 2026-10-26 a 375 px (7 pasos, ver ciclo 9); falta repetirlo en un celular real con la versión publicada
Lint / Typecheck / Build: N/A

---

# LAST ACTIONS
Ciclos 6–8 (2026-10-25/26), en `feat/clientes-imagenes`: C1 captura de
cliente por teléfono normalizado (73e759e), C2 compresión de comprobantes
(f57afd2), nota editable en Pedidos (ae971f9), historial de Pedidos
(00fa7a1). En main: selector de mes del gráfico (cf6c4d0).

# FILES MODIFIED (ciclos 6–7)
index.html, js/core.js, js/imagenes.js (nuevo), sw.js, tests/core.test.js,
tests/supabaseSync.test.js, tests/imagenes.test.js (nuevo),
PRE_LAUNCH_AUDIT.md, AUDIT_STATE.md, AUDIT_HISTORY.md.

# FILES DELETED
Ninguno.

# DEPENDENCIES REMOVED / ADDED
Ninguna (supabase-js fijada a 2.117.2 desde el ciclo 1).

# DATABASE CHANGES
0004 y 0005 aplicadas y verificadas (2026-10-24/25). Ninguna pendiente.

# API CHANGES
Apps Script v6: `uploadComprobante` solo imágenes/PDF ≤ 10 MB; acción
`respaldo` activa. Sin cambios en los ciclos 6–7 (`Code.gs` intacto).

# SECURITY CHANGES
Ver SECURITY FINDINGS.

# HUMAN REVIEW REQUIRED
Los MEDIUM marcados arriba y aprobar el merge de `feat/clientes-imagenes`.

# BLOCKERS
Ninguno.

# NEXT ACTION
1. Leer `PRE_LAUNCH_AUDIT.md`, este archivo y `AUDIT_HISTORY.md`.
2. Antes de mergear `feat/clientes-imagenes`: hacer el RECORRIDO DE FLUJOS
   (`PRE_LAUNCH_AUDIT.md` § Recorrido) en un celular real o a 375 px:
   vender a un cliente nuevo y a uno que vuelve, cobrar con descuento y pago
   dividido, editar la nota en Pedidos, registrar un gasto con foto
   vertical, revisar el historial de Pedidos con un pedido entrando, cerrar
   caja, contar inventario.
3. Si el dueño aprueba: merge a main, publicar, confirmar en producción
   (versión servida, "Sincronizado", respaldo del día, tabla `errores`).
4. Próximo ciclo de auditoría: además de código, el recorrido de flujos
   completo. Un hallazgo como el campo escondido en "Más opciones" solo
   aparece usando la app.

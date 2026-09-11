# Progreso — Ronda 4 (bloqueadores del despliegue de T1 + C2)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md`, `PROGRESO_R2.md`, `PROGRESO_R3.md`. Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA4.md`.

**Esta ronda existe porque T1 (Ronda 3) no se puede desplegar como quedó.** La migración a filas append-only está bien construida y verificada, pero la revisión encontró dos defectos que solo aparecen DESPUÉS del despliegue (U0, U1) más un riesgo en el Sheet real que hay que inspeccionar antes de migrar (U2). Ninguno se detectó en las nueve corridas de verificación de la Ronda 3 porque todas prueban el mismo eje: registrar, recargar, hidratar, reintentar. **El eje que faltó — borrar — es obligatorio en toda verificación de esta ronda.**

Después: U3 (instrumentar la migración), U4 (C2, el último riesgo grande), U5 (cuadrar el conteo de tests).

**Restricciones no negociables de esta ronda:**
- NO se despliega al Apps Script de producción. NO se corre `migrarAAppendOnly()` contra el Sheet real. Esta ronda prepara el despliegue, no lo ejecuta.
- NO se tocan datos reales (costos de insumos, ventas, Sheet).
- U0, U1 y U2 son bloqueadores del despliegue. Van primero, en ese orden, cada uno commiteado y verificado antes del siguiente. Nada de U3 en adelante empieza antes de cerrar los tres.
- Toda verificación incluye el eje "borrar": registrar + borrar + sincronizar, no solo registrar + recargar.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes es la regla — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| U0 · La alarma de T0 mide el catálogo, no el payload | ✅ HECHA |
| U1 · Los borrados persisten (filas de lápida) | PENDIENTE |
| U2 · Validación de forma de hoja antes de migrar | PENDIENTE |
| U3 · Instrumentar la migración | PENDIENTE |
| U4 · C2 — pull que pisa cambios locales | PENDIENTE |
| U5 · Cuadrar el conteo de tests | PENDIENTE |

## Detalle por tarea

### U0 · La alarma mide el catálogo, no el payload — HECHA

- **Problema**: T0 (Ronda 3) medía `JSON.stringify(state)` completo contra el tope de 48.000 de una celda de Sheets. Correcto ENTONCES (payload == contenido de celda). Después de T1 dejan de ser lo mismo: el payload crece con el historial de transacciones para siempre, la celda solo guarda el catálogo. El día que el historial pasara de 48.000, `push()` se negaba a mandar y la app dejaba de guardar — con la celda sana en 30.000. Un modo de falla ruidoso pero igual de bloqueante, disparado por una medición que ya no corresponde a ningún límite real (~12 ventas después de desplegar, con el estado actual de 38.332).
- **`js/sync.js`**:
  - El UMD ahora inyecta `RowSync` (`require('./rowsync.js')` en Node, `root.CrumblyRowSync` en el navegador) — se agregó `<script src="js/rowsync.js">` en `index.html` antes de `js/sync.js`.
  - `getPayloadSizeInfo` → `getCatalogSizeInfo(state)`: mide `splitCatalogAndAppend(state).catalogo` (la misma función que usa Code.gs), no el estado completo. Es lo único que dispara advertencia/bloqueo.
  - `getTransferSize(state)` nueva: tamaño del POST completo. Informativo, SIN tope.
  - `getPayloadBreakdown` → `getStateBreakdown(state)`: cada entrada trae `enCelda: bool` (true = parte del catálogo, cuenta contra el tope; false = fila append-only, no cuenta).
  - `push()` mide el catálogo, no el payload. Adjunta `sizeInfo` (catálogo) + `sizeInfo.transferencia` (payload). El `code` de bloqueo sigue siendo `PAYLOAD_TOO_LARGE` — mismo que usa el backend, `index.html` maneja los dos caminos igual.
- **`backend/Code.gs`**: sin cambios. `writeState_()` ya validaba SOLO el catálogo (`JSON.stringify` de las claves que no son append-only) — la validación del backend ya era correcta.
- **`index.html`**: el panel de Ajustes se partió en dos grupos visualmente separados — "Catálogo — cuenta contra el tope" y "Filas append-only — no cuentan contra el tope" — más una línea de "Transferencia por sincronización (sin tope)". Los mensajes de `pushInBackground` dicen "catálogo" en vez de "estado".
- **Tests** (`tests/sync.test.js`, grupo "U0"): 9 tests, incluidos los dos criterios exactos del encargo — (1) payload de 60.000 con catálogo de 20.000 → `push()` procede, la petición SÍ se manda; (2) catálogo de 49.000 con payload chico → bloquea sin mandar la petición. Suite: `sync.test.js` pasó de 22 a 24 tests (número medido corriendo el archivo). Total de la suite: 290 (auth 10, core 246, rowsync 10, sync 24).
- **Verificado en el navegador** (mock backend local en `localhost:8796`, cero contacto con `script.google.com`): un estado con 400 ventas (payload real 156.172, catálogo 608) → `push()` devuelve `ok:true` y escribe las 400 filas, sin banner ni bloqueo. El inverso — un catálogo inflado a 103.927 con una sola venta → `push()` bloquea con `PAYLOAD_TOO_LARGE`. El panel de Ajustes muestra los dos grupos con `Ventas: 155.491` bajo "no cuentan contra el tope" y el catálogo real (Productos/Materia/Config…) bajo "cuenta contra el tope". Sin errores de consola.
- El eje "borrar" no aplica a U0 (no toca persistencia de registros) — se ejercita a fondo en U1.

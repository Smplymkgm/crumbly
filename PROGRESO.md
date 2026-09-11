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
| U1 · Los borrados persisten (filas de lápida) | ✅ HECHA |
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

### U1 · Los borrados persisten (filas de lápida) — HECHA

- **Problema confirmado**: `pickNewRecords` solo agrega, nunca quita. Borrar un gasto en memoria y sincronizar dejaba la fila en la hoja; el siguiente `pullOnLoad` la traía de vuelta. Las nueve corridas de verificación de T1 (Ronda 3) nunca lo detectaron porque ninguna probó el eje "borrar" — todas registran, recargan, hidratan, reintentan.
- **Diseño (sin UI de anulación — arreglo mínimo para desplegar)**: cuando un id existe en una hoja append-only pero el cliente declara (en el push) que ya no lo tiene, el backend escribe una fila de **lápida** — mismo id, timestamp, usuario, nunca muta ni borra la original. La hidratación excluye los ids con lápida.
- **`js/rowsync.js`** (probado en Node, Code.gs es su port a mano): `isTombstone`, `makeTombstone`, `pickTombstones(sheetLiveIds, knownIds, tombstonedIds)`, `esBorradoMasivoSospechoso(candidatos, totalVivos)`, `hydrateRecords(records)`.
- **Dos guardas contra falso positivo, ambas documentadas y probadas por separado**:
  1. `pickTombstones` devuelve `[]` si `knownIds` no es un array o está vacío — un cliente con un estado parcial/recortado/vacío (sesión nueva, error de carga, pull fallido antes del push) nunca genera una lápida masiva. "Ante la duda, no lápida."
  2. `esBorradoMasivoSospechoso`: aunque el conjunto declarado sea válido y no vacío, si un solo push quisiera lapidar más de 10 registros Y más de la mitad de los vivos de esa colección, se omite todo y se registra un aviso — es casi seguro un error, no N borrados manuales. Umbral elegido para cubrir el escenario real que motivó esta ronda (el dueño borrando seis ventas viejas a mano) sin abrir la puerta a un borrado en bloque.
  3. **Decisión no especificada, documentada**: el cliente (`js/sync.js`, `knownRecordIdsDe_`) solo declara `knownRecordIds` cuando `state.config.lastSync` ya está seteado — un estado recién creado (antes del primer pull) nunca declara nada, así el backend no puede confundir "todavía no tengo datos" con "borré todo el historial".
- **`js/sync.js`**: `push()` gana un 5º parámetro opcional `usuario` (para el rastro de la lápida) y calcula `knownRecordIds` a partir del propio `state` que ya recibe — ninguna otra parte del cliente necesita saber que esto existe.
- **`backend/Code.gs`**: `appendTombstones_(name, knownIds, usuario)` nueva (port a mano de la lógica de arriba); `readAppendCollection_` ahora hidrata (excluye lápidas) — se renombró la lectura cruda a `readAppendCollectionRaw_`; `writeState_` acepta `knownRecordIds`/`usuario` y llama a `appendTombstones_` por colección; `doPost` pasa `body.knownRecordIds`/`body.usuario`. `migrarAAppendOnly()` no cambia (no hay lápidas antes de que exista tráfico real).
- **`index.html`**: `pushInBackground()` pasa el correo del usuario logueado a `push()`. Ningún flujo de borrado (`eliminarVenta`/`eliminarGasto`/`eliminarMerma`/`eliminarLote`) necesitó tocarse — ya llamaban a `saveState()`, que ya dispara el push; la declaración de "conjunto completo" ocurre sola dentro de `push()`.
- **Tests**: 8 nuevos en `tests/rowsync.test.js` (incluye el ciclo completo: registrar 3 → borrar el del medio → hidratar → quedan 2 → segundo push no duplica la lápida) + 2 en `tests/sync.test.js` (push declara `knownRecordIds` solo con `lastSync`; sin `lastSync` no declara nada). Suite completa: **300 tests** (auth 10, core 246, rowsync 18, sync 26) — medido corriendo los cuatro archivos.
- **Verificado en el navegador de punta a punta, con el eje "borrar" en las cuatro colecciones que tienen UI de borrado real** (mock backend local, cero contacto con `script.google.com`): para ventas, gastos, mermas y lotes — registrar 2-3 por la UI/función real, borrar uno con un clic real en el botón de basura (`confirm()` forzado a aceptar, mismo truco de verificación de rondas anteriores), confirmar que el backend ya no lo devuelve en un pull, hacer un **reload completo de la página**, y confirmar que `pullOnLoad()` (con el backend re-apuntado al mock) NO lo trae de vuelta — los reportes (`getGastosByPeriod`, `getVentasByPeriod`) reflejan los conteos correctos. También verificado: doble push con el registro ya ausente escribe 0 lápidas nuevas (idempotencia real, no solo en Node); un push con `gastos:[]` por error no borró los 2 gastos ya existentes en el backend. `ajustes` se probó solo con los tests de Node (sin UI para borrar un ajuste individual) — la lógica es genérica por colección, no hay motivo para que se comporte distinto.

# Progreso — Ronda 3 (sync entra en alcance: alarma de tamaño + migración append-only)

Rama: `auditoria/costeo`. Ronda 1 en `PROGRESO_R1.md`, Ronda 2 en `PROGRESO_R2.md`. Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA3.md`.

**Restricciones de esta ronda, no negociables:**
- Hay una sesión real abierta en producción ahora mismo (el dueño corrigiendo insumos a mano). NO se toca ningún costo de insumo, NO se borra ninguna venta, NO se modifica ningún dato real.
- NO se despliega al Apps Script de producción ni se corre ninguna migración contra el Sheet real. Todo se escribe, prueba y commitea en la rama — el despliegue de T1 es un paso coordinado aparte.
- T0 va commiteada y verificada antes de tocar T1.
- T1 es el cambio más riesgoso hecho en este sistema: si no queda verificado de punta a punta en el navegador (datos reales, reload completo) se revierte y la rama queda en T0.

## Preguntas bloqueantes

(se llenan aquí si aparecen — cero preguntas bloqueantes es la regla de esta ronda: ambigüedad → opción más conservadora, documentada)

## Estado de tareas

| Tarea | Estado |
|---|---|
| T0 · Alarma de tamaño de payload | ✅ HECHA |
| T0.1 · Sacar conteoEnProgreso del estado sincronizado | ✅ HECHA |
| T1 · Migración a filas append-only | ✅ HECHA (verificada, no revertida) |
| T2 · Integridad de insumos | PENDIENTE |
| T2.1 · Reporte de integridad | PENDIENTE |
| T3 · Pantalla de producción de lotes | PENDIENTE |
| T4 · Etiqueta del break-even | PENDIENTE |
| T5 · Aviso previo de faltante en preparaciones | PENDIENTE |

## Detalle por tarea

### T0 · Alarma de tamaño de payload — HECHA

- Archivos: `js/sync.js` (`getPayloadSizeInfo`, `getPayloadBreakdown`, `getSyncSizeHistory`/buffer en localStorage, `push()` rechaza antes de mandar la petición sobre 48.000), `backend/Code.gs` (`writeState_` valida el largo antes de escribir la celda y devuelve `{ok:false, code:'PAYLOAD_TOO_LARGE'}` — nunca `ok:true` en silencio), `index.html` (`pushInBackground` muestra banner persistente — nunca un toast — en advertencia y en bloqueo; panel nuevo en Ajustes con tamaño/%/desglose por colección, calculado al abrir el modal), `tests/sync.test.js` (8 tests nuevos).
- **Verificado en el navegador con los tres niveles reales**: armé un estado sintético (relleno inocuo, no datos del negocio) que cruza los tres umbrales y confirmé — el panel de Ajustes muestra el tamaño/%/desglose correctos en cada nivel; `pushInBackground()` dispara el banner persistente rojo con el número real y el tope, con "Ver detalle en Ajustes" y "Cerrar"; confirmé que sobre el tope de bloqueo la función `push()` **nunca llega a intentar la petición HTTP** (pasé un `fetch` que rechaza a propósito y no se invocó).
- **Limitación reconocida y documentada, no evitable en este entorno**: `backend/Code.gs` no se puede correr ni testear en Node (no hay runtime de Apps Script local), y la regla de esta ronda prohíbe desplegarlo contra el backend real. Se verificó por lectura cuidadosa — la lógica es aritmética simple sobre `.length`, igual que su equivalente ya probado en `js/sync.js` — pero no hay una ejecución real que lo confirme. El cliente ya bloquea antes de llegar ahí, así que el backend es defensa en profundidad, no la única línea.
- **Bug de entorno encontrado y anotado, no del código de la app**: el servidor estático local (`python3 -m http.server`) no manda cabeceras de caché, y el navegador de este entorno cacheaba agresivamente `js/sync.js` entre reloads de la MISMA pestaña — la primera verificación mostraba `CrumblySync.getPayloadSizeInfo is not a function` con el código ya corregido en disco. Se resolvió cambiando el puerto del servidor local en `.claude/launch.json` (8791→8792) para forzar un origen nuevo sin caché. No afecta producción (Apps Script no sirve archivos estáticos así).
- Decisión no especificada: el tope de bloqueo se fijó en 48.000 (no 50.000 exactos) — margen de seguridad explícito para no depender de contar el último carácter exacto que Sheets acepta.

### T0.1 · Sacar conteoEnProgreso del estado sincronizado — HECHA

- Archivo: `index.html` (`stateSinConteoEnProgreso()`, `loadConteoEnProgresoLocal`/`saveConteoEnProgresoLocal`/`restaurarConteoEnProgresoLocal`, localStorage key `crumbly-conteo-en-progreso` aparte de `crumbly-state`; los 4 puntos que escriben `crumbly-state` o llaman `CrumblySync.push` usan la versión sin `conteoEnProgreso`; `afterLogin_`/`pullOnLoad` restauran el conteo local después de reemplazar `state` con datos del servidor). No tocó `js/core.js` — `state.conteoEnProgreso` sigue existiendo tal cual en el objeto en memoria, solo cambió DÓNDE se persiste.
- **Verificado en el navegador con los tres escenarios del criterio**, en este orden: (1) conté un insumo parcialmente, guardé parcial, recargué la página completa — el conteo a medias seguía ahí; (2) simulé un pull de "otro dispositivo" (con un cambio real en otra colección) — el conteo a medias no se tocó, mientras el resto del estado sí se actualizó con lo remoto; (3) cerré el conteo — el snapshot y el ajuste resultantes SÍ aparecen en lo que se sincroniza (`stateSinConteoEnProgreso()`), confirmando que el conteo cerrado sigue siendo estado compartido normal.
- Sin ambigüedad que resolver — el encargo especificaba exactamente qué mover y qué debía seguir igual.

### T1 · Migración a filas append-only — HECHA, VERIFICADA, NO REVERTIDA

**El cambio más riesgoso del sistema hasta ahora. Se decidió mantenerla** (no revertir) porque la verificación de punta a punta pasó limpia en las tres corridas que se hicieron (detalle abajo). Ver la sección "Estado de T1" al final de este archivo para el resumen que pide el cierre del run.

- **Diseño**: se separó el estado en CATÁLOGO (productos, materia, empaques, toppings, preparaciones, clientes, config, schemaVersion — crece con el menú) y 6 COLECCIONES APPEND-ONLY (ventas, gastos, mermas, snapshots, ajustes, lotes — crecen con la operación). El catálogo sigue en `state_json!A1`; cada colección vive en su propia hoja, una fila por registro (`[id, fecha, supersedesId, json]`), agregada de forma idempotente por `id`.
- **Descubrimiento clave que simplificó todo**: el cliente (`js/sync.js`, `index.html`, `js/core.js`) **no necesita ningún cambio**. `push()` ya mandaba el estado completo en el body de un POST (sin límite de 50k ahí — ese límite es de una CELDA, no de un request), y `pull()` ya esperaba un objeto de estado completo de vuelta. Toda la lógica nueva (separar catálogo/colecciones, decidir qué es "nuevo" por id, reconstruir el estado desde filas) vive enteramente en el backend. Esto cumple, y de hecho excede, lo que pedía el encargo ("ninguna función de `js/core.js` debería enterarse") — tampoco se enteraron `js/sync.js` ni `index.html`.
- **Testeable a pesar de ser Apps Script**: se extrajo la lógica pura (sin `SpreadsheetApp`, sin DOM) a `js/rowsync.js` — `splitCatalogAndAppend`, `mergeState`, `pickNewRecords` (la decisión de idempotencia), `verifyMigrationCounts`. Se probó exhaustivamente en Node (`tests/rowsync.test.js`, 10 tests, incluidos los 4 criterios obligatorios del encargo). `backend/Code.gs` es un **port a mano** de esa misma lógica sobre `getRange`/`setValues` reales — comentado explícitamente como tal, con el costo de mantenimiento (mantener las dos copias en sync) reconocido por escrito en ambos archivos.
- `mirrorCollections_` en Code.gs perdió sus escrituras a `ventas`/`venta_items`/`gastos`/`mermas` — esos nombres de hoja ahora SON la fuente de verdad append-only; seguir reescribiéndolos con `clearContents()` habría destruido el historial en cada sync. Se pierde la vista aplanada/legible que tenían antes (ahora es `[id, fecha, supersedesId, json]` crudo) — documentado como trade-off consciente, no un descuido.
- `migrarAAppendOnly()`: función de migración, NO expuesta por HTTP a propósito (se corre a mano desde el editor de Apps Script). Agrega todas las filas desde el blob viejo, verifica conteos ANTES/DESPUÉS por colección, y solo si TODOS coinciden reduce la celda al catálogo — nunca la toca si algo no cuadra. **No se corrió contra ningún Sheet real** (regla de esta ronda) — su lógica de conteo es la misma `verifyMigrationCounts` ya probada en Node.
- **Verificación de punta a punta — SIN tocar el backend real ni el Sheet real**: se construyó un backend LOCAL de prueba (`scratchpad/mock-backend.js`, Node puro, nunca commiteado al repo — es una herramienta de verificación, no parte del producto) que implementa el MISMO contrato HTTP que Code.gs, reusando literalmente `js/rowsync.js` (no una simulación aparte). Contra ese mock, en el navegador real:
  1. Registré una venta, un gasto y una merma **por la UI real** (clics reales en los modales, no solo llamadas a funciones de core).
  2. Confirmé el push exitoso y guardé los números de referencia (ventas, gastos, mermas, cantidad de harina, ingresos, utilidad neta del mes).
  3. Hice un **reload completo de la página** (navegación real del navegador, no solo releer variables).
  4. Confirmé que los datos sobrevivieron vía `localStorage` (coincidencia exacta con la referencia).
  5. Además, **por separado**, vacié el estado en memoria a `emptyState()` (simulando un dispositivo nuevo) y llamé al `pullOnLoad()` real de la app — reconstruyó el estado completo desde CERO filas hidratadas del mock backend, con coincidencia EXACTA con la referencia (ventas, gastos, mermas, cantidad de harina, ingresos, utilidad neta — los seis números iguales).
  6. Confirmé la idempotencia real (no solo en Node): un segundo push idéntico contra el mock backend agregó 0 filas nuevas.
  7. Medí el catálogo real que quedaría en la celda: se mantuvo en cientos/miles de caracteres, totalmente desacoplado de cuántas ventas/gastos/mermas había — igual que predijo el test de escala de Node (500 ventas/100 gastos/10 snapshots → catálogo bajo 35.000).
  8. **Cero contacto con el backend real en todo el proceso** — confirmado revisando el log completo de requests de red del navegador: ninguna llamada a `script.google.com` en ningún momento (`auth.getBackendUrl()` se sobreescribió explícitamente en cada sesión de prueba para apuntar solo al mock local).
  9. Sin errores de consola en ningún punto de las tres corridas.
- **Limitación reconocida**: la verificación fue contra un backend LOCAL que implementa el mismo contrato, no contra Apps Script real — es lo máximo que se puede verificar sin violar la regla de no desplegar ni tocar el Sheet real. El despliegue real de `backend/Code.gs` y la corrida de `migrarAAppendOnly()` contra el Sheet de producción siguen pendientes, como un paso coordinado aparte (con respaldo previo del Sheet), tal como pide el encargo.
- **No se tocó C2** (pullOnLoad pisando cambios locales en catálogos) — sigue vivo, sigue fuera de alcance, para la Ronda 4.
- **Anotación de anulaciones**: la columna `supersedesId` existe en cada fila append-only, siempre vacía por ahora — el formato ya admite una futura fila de corrección que referencie el id original, pero el flujo de anulación en la UI no se implementó (explícitamente fuera de alcance de esta ronda).

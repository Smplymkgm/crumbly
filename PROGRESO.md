# Progreso — Ronda 5 (V0 bloqueador + trazabilidad de costo)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md`, `PROGRESO_R2.md`, `PROGRESO_R3.md`, `PROGRESO_R4.md`. Encargo completo: mensaje del usuario "Misión — Ronda 5" (2026-09-11).

**Esta ronda existe porque el veredicto de la Ronda 4 fue incorrecto: T1 todavía no se podía desplegar.** U1 (Ronda 4) cerró el bug de los borrados que resucitaban, pero lo cerró con un mecanismo — lapidar por AUSENCIA — que reintroduce pérdida de datos entre dispositivos, exactamente lo que las filas append-only existían para eliminar. **V0 es el único bloqueador que queda y lo corrige.**

**Restricciones no negociables de esta ronda:**
- NO se despliega al Apps Script de producción. NO se corre `migrarAAppendOnly()` contra el Sheet real. NO se tocan datos reales.
- V0 es bloqueador del despliegue. Va primero, commiteado y verificado, antes de cualquier otra cosa.
- Toda verificación de V0 se hace con DOS dispositivos (dos orígenes distintos, localStorage separado) — el bug es invisible con uno solo.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| V0 · La lápida no puede decidirse por ausencia | ✅ HECHA |
| V1 · La alarma no puede quedar ciega entre despliegues | pendiente |
| V2 · `config`/`schemaVersion` en la detección de conflicto | pendiente |
| V3 · Trazabilidad del costo y el margen | pendiente |
| V4 · Sincronización incremental | pendiente |

## Detalle por tarea

### V0 · La lápida no puede decidirse por ausencia — HECHA

- **El bug, confirmado con dos dispositivos reales (no hipotético)**: `appendTombstones_` (U1, Ronda 4) lapidaba los ids que estaban en la hoja y que el cliente NO declaraba en `knownRecordIds` — "no lo tengo" se convertía en "lo borré". Escenario real: el celular registra 3 ventas y sincroniza; la tablet, con `lastSync` viejo y sin haber hecho pull, sincroniza cualquier cosa (un gasto) — su `knownRecordIds.ventas` no incluye las 3 ventas del celular porque nunca las vio, así que el backend las lapidaba. Ninguna de las dos guardas de U1 lo atrapaba (el conjunto declarado no estaba vacío, y 3 no superaba el umbral de 10) — el problema era la SEÑAL, no el umbral. Las nueve corridas de la Ronda 3 y las de U1/Ronda 4 nunca lo vieron porque todas probaron con UN solo dispositivo o con dos pestañas del mismo origen (que comparten `localStorage`, no simulan dispositivos reales).
- **El arreglo cambia la señal, no endurece las guardas**: el cliente ahora declara una lista EXPLÍCITA de lo que borró de verdad, nunca lo que tiene. El backend lapida exactamente esos ids y nada más — la ausencia jamás se interpreta.
  - **`js/sync.js`**: nuevo `crumbly-borrados-pendientes` en localStorage (nunca en `state` — mismo espíritu que `crumbly-catalog-base`/`conteoEnProgreso`, metadata de ESTE dispositivo). `marcarBorradoPendiente(coleccion, id)` — llamado desde cada flujo de borrado real. `getBorradosPendientes()`/`limpiarBorradosPendientes_(enviados)`. `push()` manda `idsABorrar` (solo si hay algo pendiente) y limpia SOLO lo que el backend confirmó (`ok:true`) — un push fallido deja todo pendiente, se reintenta solo en el siguiente push (mismo patrón que ya usa `saveState()`/`schedulePush()`).
  - **`js/rowsync.js`**: `pickExplicitTombstones(sheetLiveIds, idsABorrar, tombstonedIds)` reemplaza a `pickTombstones` (por ausencia) — filtra la lista declarada a lo que está vivo en la hoja y no tiene lápida ya (idempotente; un id que nunca llegó a existir en la hoja no genera una lápida huérfana). **Se eliminaron `pickTombstones`, `esBorradoMasivoSospechoso` y la guarda de `config.lastSync`** — existían para compensar la señal equivocada; con la señal correcta no hacen falta, y mantenerlas habría dejado dos caminos de borrado vivos a la vez (regla explícita del encargo).
  - **`backend/Code.gs`**: `appendTombstones_(name, idsABorrar, usuario)` — mismo cambio de señal, port a mano. `writeState_` recibe `idsABorrar` en vez de `knownRecordIds`. `doPost` pasa `body.idsABorrar`.
  - **`index.html`**: `eliminarVenta`, `eliminarGasto`, `eliminarMerma`, `eliminarLoteUI` llaman a `CrumblySync.marcarBorradoPendiente(coleccion, id)` antes de `saveState()`. **No existe una función de borrado individual de ajustes en la UI** (los ajustes se generan solo al cerrar un conteo físico, nunca se borran uno por uno) — no hay nada que cablear ahí; si esa función se agrega en el futuro, debe llamar a `marcarBorradoPendiente('ajustes', id)` con el mismo patrón.
- **Efecto secundario deseado, verificado**: una colección se puede vaciar por completo — ya no hay guarda de "borrado masivo" que lo impida, porque la lista es explícita (3 ids declarados de 3 son 3 ids, no una sospecha).
- **Tests**: `tests/rowsync.test.js` — grupo "U1/V0" reescrito: `pickExplicitTombstones` (id declarado y vivo → se lapida; lista vacía/no declarada → no lapida nada; id declarado que nunca existió en la hoja → no hace nada; reenvío de la misma lista → 0 lápidas nuevas; el criterio exacto de dos dispositivos — la tablet no declara las ventas del celular porque nunca las borró, así que no se lapidan; borrar 3 de 3 vacía la colección). `tests/sync.test.js` — grupo "V0" nuevo: `marcarBorradoPendiente` no duplica; `push()` manda `idsABorrar` con exactamente lo declarado; push exitoso limpia solo lo que mandó y no manda el campo si no hay nada pendiente; un push que falla deja todo pendiente y el siguiente lo reintenta y limpia.
- **Suite completa: 323 tests** (auth 10, core 246, rowsync 35, sync 32) — medido corriendo los cuatro archivos justo antes de escribir esta sección.
- **Verificado en el navegador con DOS dispositivos reales** (`localhost:8800` y `localhost:8801`, cada uno con su propio `localStorage`, contra un mock backend en `localhost:8802` — mismo contrato HTTP que `backend/Code.gs`, actualizado esta ronda para el nuevo campo `idsABorrar`), cero contacto con `script.google.com` en ningún momento:
  1. **El escenario exacto del encargo**: el "celular" registra 3 ventas reales (`CrumblyCore.applyVenta`) y sincroniza — el backend confirma las 3. La "tablet", con `lastSync` fijado a una fecha vieja y SIN haber hecho pull (nunca vio las 3 ventas), registra un gasto real (`CrumblyCore.registrarGasto`) y sincroniza. Tras el push de la tablet, se consultó el backend directamente: **las 3 ventas del celular seguían vivas**, y el gasto de la tablet se agregó sin tocarlas.
  2. **Eje "borrar" en las cuatro colecciones con función de borrado real** (`eliminarVenta`, `eliminarGasto`, `eliminarMerma`, `eliminarLoteUI`, con `confirm()` forzado a aceptar — mismo truco de verificación de rondas anteriores): se borraron las 3 ventas del celular (3 de 3 — la colección quedó vacía, sin ninguna guarda bloqueándolo), su propio gasto, su merma y su lote. Tras el push, el backend confirmó `ventas:0, mermas:0, lotes:0` y `gastos:1` — el único gasto vivo era el de la TABLET, nunca tocado (aislamiento correcto entre lo que cada dispositivo borra).
  3. **Reload completo + pull**: se recargó la página del celular por completo y se volvió a autenticar y hacer pull contra el mismo backend — las 4 colecciones se mantuvieron exactamente como quedaron (nada resucitó).
  4. **Idempotencia real**: se volvió a declarar el mismo id de venta ya lapidado y se reintentó el push — la respuesta del backend confirmó `lapidas.ventas: 0` (cero lápidas nuevas).
  5. **Push fallido deja lo pendiente intacto**: se marcó un borrado y se intentó `push()` contra un backend inalcanzable (falla de red real, `Failed to fetch`) — `getBorradosPendientes()` seguía teniendo el id después de la falla. Un segundo `push()` contra el backend real lo limpió.
  - Cero errores de consola en ninguna de las dos pestañas durante toda la secuencia.

---

## Veredicto parcial (se completa al cerrar el run)

V0 — el único bloqueador de despliegue que señaló esta ronda — está cerrado y verificado con dos dispositivos reales. El veredicto final (con V1-V4 y el estado completo de la suite) se escribe en la sección de cierre, al terminar el resto de las tareas de esta ronda.

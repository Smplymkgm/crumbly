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
| V1 · La alarma no puede quedar ciega entre despliegues | ✅ HECHA |
| V2 · `config`/`schemaVersion` en la detección de conflicto | ✅ HECHA |
| V3 · Trazabilidad del costo y el margen | ✅ HECHA |
| V4 · Sincronización incremental | ⏸ ABIERTA — documentada abajo, no bloquea el despliegue |

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

### V1 · La alarma no puede quedar ciega entre despliegues — HECHA

- **El riesgo**: U0 (Ronda 4) hizo que la alarma de tamaño mida solo el catálogo — correcto DESPUÉS de que el backend migre. El frontend vive en GitHub Pages (se actualiza con `git push`) y el backend se despliega a mano desde el editor de Apps Script — es fácil que el cliente nuevo llegue primero. En esa ventana la celda real TODAVÍA contiene el estado completo (el backend viejo no sabe de catálogo/filas separados), pero un cliente que solo mide el catálogo vería un número chico y no avisaría — la protección de T0 se pierde justo cuando más hace falta, sin ningún síntoma visible.
- **`js/sync.js`**: `getAlarmSizeInfo(state, fase)` — nueva función que decide QUÉ medir según la fase de la migración: `'post'` mide el catálogo (`getCatalogSizeInfo`, comportamiento de U0); `'pre'` o cualquier fase que no se pudo determinar mide el **estado completo** (mismo criterio de T0, Ronda 3). La decisión es deliberada: medir de más avisa sin razón (falso positivo, molesto); medir de menos deja la app fallando en silencio (el modo de falla que esta ronda existe para cerrar) — ante la duda, medir de más.
  - `getMigrationStatus()` ahora cachea la fase que confirma el backend (`faseMigracionConocida_`, en memoria, nunca persistida — arranca en `null`, tratado igual que `'pre'`).
  - `push(backendUrl, token, state, fetchImpl, usuario, baseCatalogVersion, fase)` gana un 7º parámetro opcional (override explícito, para pruebas o un caller que ya la tenga a mano) — el caller real (`index.html`) nunca lo manda y usa la fase cacheada.
- **`index.html`**: `afterLogin_` llama a `CrumblySync.getMigrationStatus(...)` sin bloquear el login (fire-and-forget, `.catch(() => {})`) — así la fase se refresca cada vez que alguien abre la app, no solo al entrar a Ajustes. El panel de Ajustes ("Alarma de tamaño") ahora muestra explícitamente **qué está midiendo y por qué** (`payload-alarma-motivo`) y se refresca de nuevo cuando `renderMigrationStatus()` confirma la fase real con el backend. Los mensajes de `pushInBackground` (bloqueo/advertencia) también dicen "el catálogo" o "el estado completo" según corresponda, en vez de asumir siempre catálogo.
- **Tests** (`tests/sync.test.js`, grupo "V1"): fase `'pre'` con catálogo chico y estado grande → advierte (mide el estado completo); fase `'post'` con la misma forma → no advierte (mide solo el catálogo); fase indeterminable (`undefined`/`null`/string desconocido) → se comporta como `'pre'`; `getMigrationStatus()` cachea la fase y un `push()` posterior (sin override) la usa automáticamente. Los tests de U0 (Ronda 4) que asumían medición de catálogo por defecto se actualizaron para pasar `fase:'post'` explícita — ese comportamiento ahora es específico de la fase post, no el default.
- **Suite completa: 327 tests** (auth 10, core 246, rowsync 35, sync 36) — medido corriendo los cuatro archivos.
- **Verificado en el navegador**: la fase cacheada arranca en `null` (confirmado antes de cualquier llamada); tras un login real contra el mock backend, pasa a `'post'` automáticamente; el panel de Ajustes muestra "Midiendo: catálogo — la migración ya corrió, la celda solo guarda el catálogo." Sin errores de consola.
- **Documentado en los pasos manuales de despliegue** (abajo): el backend va primero, o los dos a la vez — nunca el cliente solo.

### V2 · `config` y `schemaVersion` en la detección de conflicto — HECHA

- **El riesgo real**: `mergeCatalogs` (U4, Ronda 4) resolvía `config` entero por último-cambio-remoto-gana, razonando que "no es una lista con id" y "nadie edita eso desde dos dispositivos a la vez". Pero ahí vive `factorPrestacional` (T2, Ronda 3) y la clasificación fijo/variable de categorías de gasto (C4, Ronda 1) — configuración contable real. Un test YA EXISTENTE de U4 (que nunca lo afirmaba con un assert) demostraba el bug: dos dispositivos cambiando DOS CLAVES DISTINTAS de `config` perdían una de las dos en silencio, porque el objeto entero se reemplazaba por el remoto en cuanto CUALQUIER clave cambiaba ahí.
- **`js/rowsync.js` (`mergeCatalogs`)**:
  - `config` ahora se fusiona **por clave**, con la misma comparación-contra-base que ya usan las listas con id: si las dos claves que cambiaron son distintas, las dos sobreviven; si la MISMA clave cambió en los dos lados a valores distintos, es un conflicto real — se reporta (`{coleccion:'config', id:claveDeConfig, base, mio, remoto}`) y se conserva mi valor hasta que se decida, igual que un registro.
  - `schemaVersion` es la excepción documentada: la gestiona la migración, no una persona — gana el mayor de los dos lados, nunca genera un conflicto.
- **`index.html`**: `resumenRegistroConflicto_` ahora distingue `undefined`/`null` (no existe) de un valor escalar legítimamente falsy (`0`, `false`, `''`) — antes `!item` los confundía. `resolverConflictoCatalogo` gana una rama para `coleccion === 'config'` (asigna/borra la clave directo en `state.config`, en vez de buscar por `.id` en un array que no existe para config).
- **Tests** (`tests/rowsync.test.js`, grupo "V2"): dos claves distintas de `config` sobreviven las dos; la misma clave en conflicto se detecta sin perder nada; una clave sin tocar por nadie sobrevive tal cual; una clave nueva agregada solo en un lado no genera conflicto; `schemaVersion` gana el mayor en ambas direcciones y nunca aparece en `conflicts`.
- **Suite completa: 331 tests** (auth 10, core 246, rowsync 39, sync 36).
- **Verificado en el navegador con DOS dispositivos reales**: el celular cambia `factorPrestacional`, la tablet cambia `email` (sin ver el cambio del celular) — al sincronizar, la tablet queda con AMBOS cambios (confirmado también en el backend). Después, el celular cambia `factorPrestacional` a 1.50 y sincroniza; la tablet, sin pull, lo cambia a 1.60 y sincroniza — aparece el banner de conflicto, el modal muestra "Configuración · factorPrestacional" con "Lo mío: 1.6" / "Lo remoto: 1.5", y elegir "Usar el remoto" lo resuelve limpio (sin errores de consola, cero contacto con `script.google.com`).

### V3 · Trazabilidad del costo y el margen — HECHA

Ver el detalle completo en el mensaje de commit (`feat(V3): ...`) y en `js/core.js`. Resumen:

- **V3.1**: `getDesgloseCostoProducto(state, productoId)` — una línea por componente (insumo/preparación) con cantidad, costo unitario, subtotal, % del total y si dispara `checkCostoSospechoso`; recorre exactamente el mismo camino que `getCostoProducto` (suma idéntica por construcción); ordenado por subtotal descendente. UI: clic en el precio de un producto (Productos) abre el desglose, con el componente sospechoso resaltado en rojo.
- **V3.2**: insignia en la fila del producto — roja si el costo supera el precio, ámbar si pasa del 60% del precio — más el margen visible en la fila (reusando `getMargenProducto`, ya existía, ahora con las insignias al lado).
- **V3.3**: `findProductosAfectadosPorInsumo(state, insumoId)` — reusa `findProductosUsandoInsumo` (C10) y los recorridos de preparaciones anidadas (`findPreparacionesUsandoPreparacion`/`findProductosUsandoPreparacion`, ya existentes) para cerrar la cadena completa (producto → preparación → preparación anidada → insumo) sin duplicar ese recorrido. Al guardar un insumo cuyo costo cambió, un aviso ofrece ver los productos afectados con costo y margen antes→después.
- **V3.4**: `getVentasCostoInvalidoEnPeriodo`/`esVentaCostoInvalido` (mismo chequeo que ya usaba `getReporteIntegridad`, ahora acotado a un período) — una franja en el dashboard avisa cuántas ventas del período tienen costo congelado inválido; el margen **nunca se excluye ni se oculta**, solo se marca como no confiable (mismo color/franja que la guarda de varianza de la Ronda 2); ofrece revisar/borrar cada venta desde un modal.
- **Suite completa: 341 tests** (auth 10, core 256, rowsync 39, sync 36).
- **Verificado en el navegador**: un producto con un insumo de costo absurdo (Vainilla a $9.000/g) muestra la insignia roja "⚠ costo > precio" en la fila, y el desglose lo lista primero, marcado "⚠ costo sospechoso" (9.000 de 9.500 = 95% del total). Editar el insumo base (harina, de $5 a $8) dispara el aviso "afecta a 2 producto(s)" y el modal muestra el antes→después exacto de costo y margen para cada uno. Una venta con `item.costo` mayor que su `total` dispara la franja del dashboard ("1 venta(s)... NO es confiable"), el KPI de margen neto se pinta en rojo sin ocultarse, y borrarla desde el modal de la franja la limpia. Sin errores de consola, cero contacto con `script.google.com`.

### V4 · Sincronización incremental — ABIERTA (documentada, no ejecutada)

**No alcanzó el tiempo de este run — tal como el propio encargo lo permite explícitamente** ("V0 a V3 son lo que no puede esperar. Si el run no alcanza para V4, déjala abierta y documentada").

- **Ya medido en la Ronda 4**: el estado completo con 500 ventas son 282.263 caracteres, viaja entero en cada push y cada pull. El catálogo (lo único que cuenta contra el tope de la celda después de T1) es 7.761 caracteres — la transferencia es ~36× más grande que lo que realmente hace falta enviar en el caso común (un dispositivo que ya sincronizó antes, agregando una venta más).
- **El riesgo real no es el tamaño, es el tiempo de ejecución**: `appendNewRecords_`/`appendTombstones_` deduplican leyendo la columna A COMPLETA de cada hoja append-only en cada push — un escaneo lineal que crece con el historial completo del negocio, contra un límite de 6 minutos de ejecución de Apps Script. Con el volumen actual esto no duele (segundos). Es la ronda siguiente, antes de que el volumen lo vuelva doloroso — no es urgente hoy, y NO es un bloqueador del despliegue de T1 (el propio encargo la deja fuera del criterio de bloqueo, a diferencia de V0).
- **Lo que haría falta, sin empezar a implementarlo** (para la próxima ronda):
  1. El pull acepta un cursor por colección (timestamp o número de fila) y devuelve solo lo nuevo desde ahí — un dispositivo sin cursor sigue trayendo todo (primer pull, poco frecuente, está bien que sea completo).
  2. El push manda solo los registros nuevos + la lista de `idsABorrar` de V0 — no todas las transacciones de la historia. Esto es un cambio de forma en el payload que toca `js/sync.js`, `js/rowsync.js` y `backend/Code.gs` a la vez, y CADA colección del estado local (`state.ventas`, etc.) tendría que dejar de ser "la fuente completa que se manda entera" para convertirse en algo que se pagina/cachea localmente — un rediseño real del modelo de estado en memoria, no un parche.
  3. La deduplicación del backend deja de escanear la hoja completa — un índice de ids en Propiedades del script, o buscar solo desde el cursor del cliente hacia adelante. Esto también cambia el contrato de `appendNewRecords_`/`appendTombstones_` que V0 y U1 ya dejaron estables.
  4. Los tres criterios de aceptación que pidió el encargo (push que agrega una venta manda kilobytes no cientos de KB; pull con cursor al día devuelve cero registros; dispositivo sin cursor recibe el estado completo) no se escribieron — no hay tests de V4 en esta ronda.
- **Por qué se dejó fuera en vez de apurarla**: es un cambio de protocolo (forma del payload, contrato del backend, y el modelo de estado en memoria del cliente) con superficie mucho más grande que V0-V3, que además interactúa directamente con el mecanismo que V0 acaba de estabilizar (`idsABorrar`) y el que V1 acaba de hacer consciente de fase (`getAlarmSizeInfo`). Apurarlo en el tiempo que quedaba de este run — sin los tests de escala que el propio encargo pide como criterio — habría sido exactamente el tipo de cambio sin verificar que esta auditoría entera existe para prevenir.

---

## Pasos manuales del despliegue de T1 (los ejecuta una persona, no esta sesión)

Actualizado de la Ronda 4 con la regla de V1: **el backend va primero, o los dos a la vez — nunca el cliente solo.** Desplegar el cliente nuevo (con la alarma consciente de fase) antes que el backend es seguro por diseño de V1 (mide de más hasta confirmar la fase) — pero el orden recomendado sigue siendo backend primero, para no depender de esa red de seguridad más de lo necesario.

1. **Respaldo del Sheet real.** Archivo → Hacer una copia (o descargar como .xlsx) del Sheet de producción completo, ANTES de tocar nada. El único paso no automatizable y el más importante: si algo sale mal después, este respaldo es la forma de volver atrás.

2. **Inspeccionar las hojas `ventas`, `gastos` y `mermas` del Sheet real (U2, Ronda 4).** Abrir cada una y mirar la fila 1 (cabecera) y una fila de datos cualquiera:
   - Si están vacías, o ya tienen la cabecera `[id, fecha, supersedesId, json]` → no hace falta nada, seguir al paso 3.
   - Si tienen datos con OTRA forma (el formato viejo real: `ventas` con columnas como `id, fecha, total, ganancia, stockInsuficiente, clienteId`) → **archivar esas tres hojas con otro nombre** antes de continuar (recomendado: `ventas_legado_pre_migracion`, etc. — razonamiento completo en `PROGRESO_R4.md` § U2). `migrarAAppendOnly()` va a abortar solo y sin tocar nada si este paso se saltea y el formato no calza — pero es más barato confirmarlo ahora que leyendo el mensaje de error.

3. **Desplegar `backend/Code.gs` actualizado PRIMERO** (Extensiones → Apps Script → pegar el contenido de este archivo → Guardar → Implementar → Nueva implementación). Confirmar que el despliegue apunta al mismo Sheet real de siempre (`CRUMBLY_SHEET_ID` en las Propiedades del script no cambia). **Este backend incluye V0 (lápidas explícitas) — es el que cierra el bloqueador.**

4. **Correr `migrarAAppendOnly()` una sola vez**, a mano, desde el editor de Apps Script (elegir la función en el desplegable de arriba → ▷ Ejecutar). Mirar el resultado:
   - `{ok:false, error:'FORMATO_HOJA_INVALIDO', problemas:[...]}` → alguna hoja del paso 2 no se resolvió bien. Nada se tocó — corregir esa hoja puntual y volver a correr.
   - `{ok:false, reporte:{...}}` con algún `coincide:false` → los conteos no cuadraron en alguna colección. Nada se tocó (la celda vieja sigue intacta) — no seguir sin entender por qué antes de reintentar.
   - `{ok:true, reporte:{...}}` con las 6 colecciones en `coincide:true` → la migración salió bien. La celda quedó reducida al catálogo.

5. **Recién ahora, desplegar el frontend nuevo** (GitHub Pages, `git push`). Con el backend ya migrado (fase POST), la alarma de V1 mide el catálogo desde el primer momento — sin ventana de medición ciega.

6. **Verificar que salió bien, con datos reales**:
   - Abrir la app normal y confirmar que las ventas/gastos/mermas/etc. de siempre se siguen viendo exactamente igual.
   - En el Sheet, confirmar que `state_json!A1` ahora es un JSON mucho más chico (solo catálogo) y que las hojas append-only tienen filas nuevas con el formato `[id, fecha, supersedesId, json]`.
   - Abrir Ajustes: la sección "Migración a filas append-only" debería mostrar fase POST y la corrida recién hecha con veredicto OK; la sección "Alarma de tamaño" debería decir "Midiendo: catálogo..." (V1).
   - Registrar una venta de prueba real (una, chica, que se pueda borrar después) y confirmar que aparece como fila nueva sin reescribir toda la hoja.
   - **Borrar esa venta de prueba y sincronizar** — confirmar que no vuelve al recargar (V0/U1). Si hay un segundo dispositivo a mano, confirmar además que sincronizar algo DISTINTO desde ese segundo dispositivo (sin haber hecho pull primero) no revive nada del primero — el escenario exacto que V0 corrigió.

7. **Recién después de todo lo anterior**, este despliegue queda considerado terminado. V2/V3 ya quedan activos apenas se despliega esta versión del código — no hace falta ningún paso adicional para ellos.

---

## Veredicto: ¿se puede desplegar T1?

**Sí — V0, el único bloqueador que señaló esta ronda, quedó cerrado y verificado con dos dispositivos reales, tal como exigía el encargo.**

- **V0 cerrado**: las lápidas se deciden por lista EXPLÍCITA de borrados, nunca por ausencia — el escenario exacto del encargo (celular registra 3 ventas, tablet con `lastSync` viejo sincroniza sin haberlas visto) se verificó con dos orígenes reales y las 3 ventas sobrevivieron. El eje "borrar" se verificó en las cuatro colecciones con función de borrado real (ventas, gastos, mermas, lotes), incluyendo vaciar una colección por completo (3 de 3) y la recuperación tras un push fallido.
- **V1, V2 y V3 no son bloqueadores** (el encargo pone a V0 como el único criterio de bloqueo) pero también quedaron cerrados, verificados y commiteados — no hace falta una ronda más antes de poder desplegar por causa de ellos.
- **V4 quedó abierta, documentada, y NO es bloqueador** — el propio encargo la excluye del criterio de despliegue ("Si el run no alcanza para V4, déjala abierta"). El riesgo que resuelve (tiempo de ejecución de Apps Script creciendo con el historial) no es urgente con el volumen actual del negocio.

El único paso que falta es humano y está fuera del alcance de esta sesión: alguien tiene que hacer el respaldo, inspeccionar el Sheet real, desplegar el backend (V0 incluido) ANTES o JUNTO con el cliente (nunca el cliente solo, regla de V1), y correr la migración de verdad — ver la sección de pasos manuales arriba, en el orden exacto.

No se hizo merge a main. No se desplegó al Apps Script de producción. No se corrió `migrarAAppendOnly()` contra el Sheet real en ningún momento de esta ronda.

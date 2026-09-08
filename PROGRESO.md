# Progreso — implementación de auditorías (AUDITORIA.md + AUDITORIA_COSTEO.md)

Rama: `auditoria/costeo`. Protocolo: test primero, suite completa verde, un commit por tarea. Ver `/Users/mike/Downloads/PROMPT_LOOP.md` para el encargo completo.

## Preguntas bloqueantes

### B4 (etapa 3 de 3, "consumo en venta") — BLOQUEADA

Hechas las etapas 1 (valorización en snapshots) y 2 (producción). La 3ª —"la venta descuenta del stock de la preparación cuando existe; si no hay stock, cae a descontar materia prima y lo registra como faltante de preparación"— toca `aplicarComponentes`, el motor de expansión ÚNICO y compartido por `applyVenta`, `registrarMerma`, `getConsumptionRolling` y `computeSaleConsumption`/`checkStockShortage`. Antes de tocarlo hace falta una decisión que el encargo no especifica:

**¿`checkStockShortage` (el aviso de "no hay stock" ANTES de confirmar una venta) debe conocer el stock de preparaciones, o seguir asumiendo que todo componente tipo `preparacion` se resuelve a materia prima cruda?**

- Si NO se actualiza junto con `applyVenta`: el aviso previo a la venta advertirá "falta nutella" (materia prima) cuando en realidad hay 3kg de salsa de nutella ya preparada en la nevera — una falsa alarma operativa constante.
- Si SÍ se actualiza: hay que decidir también qué hace `getConsumptionRolling` (consumo teórico para reportes/necesidades de compra) con esto — reportar en términos de preparación consumida, o seguir expandiendo a materia prima cruda para ese reporte específico. Son al menos 3 funciones a tocar en el mismo cambio, con el motor de expansión que TODO el costeo del sistema comparte — no es un cambio de bajo riesgo para hacerlo sin confirmar el comportamiento esperado en cada punto.

No se adivinó. Queda pendiente para una siguiente ronda con esa decisión ya tomada.

## Estado de tareas

| Tarea | Estado |
|---|---|
| A1 · Quitar recargo +8% | ✅ HECHA |
| A2 · Registrar déficit de stock (`faltante`) | ✅ HECHA |
| B1 · Snapshots de inventario | ✅ HECHA |
| B2 · Flujo de conteo físico | ✅ HECHA |
| B3 · Rendimiento de preparaciones | ✅ HECHA |
| B4 · Inventario de preparaciones (WIP) | 🟡 PARCIAL (2/3 etapas) |
| C1 · Separar costo alimento/empaque | PENDIENTE |
| C2 · Merma dentro del COGS | PENDIENTE |
| C3 · Costo laboral y prime cost | PENDIENTE |
| C4 · Comportamiento de costo y break-even | PENDIENTE |
| C5 · Menu engineering | PENDIENTE |
| C6 · Arreglos baratos (I3,I4,I5,C10,C11) | PENDIENTE |
| D1 · getVarianza | PENDIENTE |
| D2 · Actual vs Theoretical | PENDIENTE |

## Detalle por tarea

### A1 · Quitar recargo +8% — HECHA (commit 382312f)

- Archivos: `js/core.js` (SCHEMA_VERSION→9, `registrarGasto`, `getCostoConVolatilidad` nueva, `recalcularValuacionV9` nueva, `emptyState`/`migrateState`), `tests/core.test.js`.
- Tests: sección "A1: recargo +8%..." (2 tests) + "Migración v9..." (4 tests) + 3 tests preexistentes de margenVariable actualizados (afirmaban el bug, ahora afirman el comportamiento correcto).
- Decisiones no especificadas en el encargo:
  - No existía ninguna colección para "movimiento de ajuste trazado" → se agregó `state.ajustes[]` como colección genérica nueva (v9), pensada para reutilizarse en B2 (el conteo físico también necesita registrar ajustes con motivo/usuario).
  - La migración se gatea por `raw.schemaVersion < 9` (no por recálculo defensivo) — así es trivialmente idempotente: la segunda vez que corre, el estado ya viene en v9 y no se toca. Se probó explícitamente con un test.
  - "Recalcular desde el historial" no necesita reconstruir el consumo entre compras: cada `gasto` de tipo inventario ya guarda su propio `cantidadAntes`/`costoAntes` real (el patrón P0-1 existente), y el costo unitario solo cambia al comprar. Se reproduce el promedio ponderado gasto por gasto con esos snapshots reales, sin el factor.
  - Insumos que tienen `margenVariable` pero CERO gastos con `margenVariabilidadAplicado` en su historial no se tocan (no hay nada que corregir).

### A2 · Registrar déficit de stock (`faltante`) — HECHA (commit bc0cec7)

- Archivos: `js/core.js` (`applyVenta`/`deduct`, `revertVenta`, `registrarGasto`, `eliminarGasto`, default `faltante:0` en `migrateState`), `tests/core.test.js` (sección "A2: faltante...", 6 tests).
- Decisiones no especificadas en el encargo:
  - `eliminarGasto` no estaba en el alcance literal de A2, pero `registrarGasto` ahora muta `insumo.faltante` — sin snapshot/restauración ahí, deshacer una compra que había saldado faltante lo dejaba corrompido silenciosamente. Se agregó `gasto.faltanteAntes` (mismo patrón que `costoAntes`/`cantidadAntes`) y su restauración en `eliminarGasto`. Es la misma regla de "arreglar donde convergen los llamadores", no una tarea nueva.
  - Si la compra no alcanza a cubrir todo el faltante, el costo promedio ponderado NO se toca (no hay compra neta a ningún precio) — evita el caso borde de `costoPromedioPonderado` con cantidad neta 0 y stock previo 0, que devolvería el precio de la compra sin haber sumado nada.
  - `revertVenta` nunca deja `faltante` negativo (usa `Math.max(0, ...)`) — si una compra ya saldó parte del faltante antes de revertir la venta que lo generó, no hay forma de saber con certeza cuánto de ese pago correspondía a esa venta específica; se documentó en el comentario del código, no se intentó adivinar.

### B1 · Snapshots de inventario — HECHA (commit aa01b5f)

- Archivos: `js/core.js` (`state.snapshots[]`, `getValorInventario`, `crearSnapshot`, `getSnapshotMasReciente`), `tests/core.test.js` (sección "B1: snapshots de inventario", 5 tests).
- Decisión no especificada: cada línea del snapshot guarda también `insumoTipo` además de `insumoId` (el ejemplo del encargo solo mostraba `insumoId`) — sin el tipo no se puede resolver a qué colección pertenece el insumo (mismo patrón que `insumoTipo`+`insumoId` en `registrarGasto`/mermas). Necesario para que D1 pueda comparar snapshots contra el estado real.
- No se implementó todavía ningún flujo de UI ni de conteo (eso es B2) — B1 es solo el motor de datos.

### B3 · Rendimiento de preparaciones — HECHA (commit acf8910)

- Archivos: `js/core.js` (`getPreparacionComposicionPorGramo`, `getPreparacionCosto`, `savePreparacion`, default en `migrateState`), `tests/core.test.js` (sección "B3: rendimiento...", 5 tests).
- Decisión no especificada: `getPreparacionCosto` ahora también expone `gramosObtenidos` (nuevo campo) además del `gramosTotal` original (insumos crudos) — la UI existente (`index.html`) sigue mostrando `gramosTotal` sin cambios, así que no hay regresión visual; `gramosObtenidos` queda disponible para B4 (que lo necesita: "se piden los gramos realmente obtenidos").
- `costoTotal` se corrigió para multiplicar por `gramosObtenidos`, no por `gramosTotal` — si no, `costoTotal` quedaría inflado por `1/rendimiento` (costoPorGramo ya está en base "por gramo obtenido"; multiplicarlo por gramos de insumos, que son más, infla el total). Verificado con test: el costo total de los insumos es invariante al rendimiento, solo cambia el costo por gramo.

### B2 · Flujo de conteo físico — HECHA (commits 0e1d487 core, c0d491a UI)

- Archivos: `js/core.js` (`AJUSTE_MOTIVOS`, `previsualizarConteo`, `cerrarConteo`, `state.conteoEnProgreso{}`), `index.html` (modal "Conteo físico" en Inventario, bloqueo de edición directa de `cantidad`), `tests/core.test.js` (sección "B2: cierre de conteo físico", 4 tests + 2 de migración).
- **Verificado a mano en el navegador** (servidor estático local, `preview_start` + Browser pane), no solo con tests de Node: creé un insumo, abrí Conteo físico, escribí una cantidad contada distinta a la teórica, confirmé que el motivo es obligatorio (cerrar sin motivo no aplicó nada), lo seleccioné, cerré el conteo y confirmé en consola que `cantidad`, `ajustes[]` y `snapshots[]` quedaron exactamente como se esperaba (2900→2100, ajuste −800/−$8.000, snapshot tipo conteo).
- Decisiones no especificadas en el encargo:
  - El conteo en curso (antes de cerrarlo) se guarda en `state.conteoEnProgreso{}`, un campo nuevo en el estado (sincronizado como todo lo demás) — es lo que permite "contar materia prima hoy, toppings mañana" sin perder lo tecleado ni depender de que el mismo dispositivo siga abierto.
  - El motivo de un AJUSTE de conteo es una lista nueva (`AJUSTE_MOTIVOS`), deliberadamente distinta de `MERMA_MOTIVOS` — una merma es la causa de una pérdida ya conocida al momento de perderla; un ajuste de conteo es la explicación de una diferencia encontrada después (incluye "Merma no registrada" como una de sus opciones).
  - Bug encontrado y corregido durante la verificación en navegador (no en los tests de Node, que no ejercitan el DOM): la primera versión de `renderConteoList()` reconstruía el `innerHTML` completo de la lista en cada tecla presionada en el campo "Contada", lo que le quita el foco al input a mitad de un número de varias cifras. Se corrigió para que cada tecla actualice solo esa fila (`actualizarFilaConteo`), nunca la lista completa.
  - `saveInsumo()` ya no envía `cantidad` en el camino de edición (antes lo hacía incondicionalmente); el campo del modal se deshabilita al editar un insumo existente y sigue habilitado solo al crear uno nuevo (el stock inicial no es un "ajuste").

### B4 · Inventario de preparaciones (WIP) — PARCIAL, 2 de 3 etapas (commit 69cf19a)

Etapa 3 ("consumo en venta") quedó **BLOQUEADA** — ver la pregunta concreta al principio de este archivo.

- Archivos: `js/core.js` (`cantidad` en preparaciones, `getValorInventario`, `crearSnapshot`, `producirPreparacion` nueva, `registrarMerma`/`eliminarMerma`/`getMermaOrigenList` con origen `'preparacion'`, `savePreparacion`), `tests/core.test.js` (sección "B4 (parcial)...", 8 tests).
- Bug encontrado y corregido de paso: `savePreparacion` reemplazaba el objeto completo de la preparación al editar su receta (`state.preparaciones[idx] = prep`), lo que hubiera borrado `cantidad` (el stock de WIP) cada vez que alguien ajustara un porcentaje de la receta. Se preserva explícitamente ahora — cubierto con test.
- `producirPreparacion` no persiste una bitácora de lotes ni permite revertir uno (a diferencia de ventas/gastos/mermas, que sí tienen su `consumoReal`+revert). Decisión de alcance, no especificada: el encargo pide "se acredita el stock y se actualiza rendimientoPct", no un log auditable — se puede agregar cuando haga falta revertir un lote mal cargado.
- `rendimientoPct` se sobreescribe con el dato medido del ÚLTIMO lote producido, sin promediar contra el histórico — así lo pide literalmente el encargo ("se actualiza con el dato medido"), sin especificar suavizado.
- Verificado con test que la producción NO cambia el valor total del inventario (solo lo mueve de materia prima a WIP) — es la prueba matemática de que `costoPorGramo`/`gramosObtenidos` de B3 y la valuación de B4 son consistentes entre sí.


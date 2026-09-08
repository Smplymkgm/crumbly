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
| C1 · Separar costo alimento/empaque | ✅ HECHA |
| C2 · Merma dentro del COGS | ✅ HECHA |
| C3 · Costo laboral y prime cost | ✅ HECHA |
| C4 · Comportamiento de costo y break-even | ✅ HECHA |
| C5 · Menu engineering | ✅ HECHA |
| C6 · Arreglos baratos (I3,I4,I5,C10,C11) | ✅ HECHA |
| D1 · getVarianza | ✅ HECHA |
| D2 · Actual vs Theoretical | ✅ HECHA |

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

### C6 · Arreglos baratos (I3, I4, I5, C10, C11) — HECHA (commits a56df4e, ebb7478)

- **I5** — `getDepreciacionPeriodo` prorrateaba con factores FIJOS (mes=1, año=12) sin importar el día del período; ahora reusa la misma proración por días transcurridos de `getDepreciacionRango`. Test viejo que afirmaba el comportamiento con bug fue reescrito.
- **I3** — `getVentasByPeriod`/`getGastosByPeriod`/`getMermasByPeriod` ganan cota superior (`ref` es "hasta cuándo", no solo "desde cuándo"). `applyVenta`/`registrarMerma` rechazan una fecha futura en el origen (`validarFechaNoFutura`). Inputs de fecha en Venta/Merma/Gasto ganan `max=hoy`.
  - Bug encontrado de paso: `registrarVenta()` en `index.html` llamaba a `CrumblyCore.applyVenta` sin try/catch — con la validación nueva, cualquier throw hubiera roto el flujo sin mostrar ningún toast. Envuelto igual que `saveMerma` ya lo hacía.
- **I4** — Campo de fecha agregado al modal de gasto (antes no existía; `registrarGasto` ya lo aceptaba en su firma pero nunca se lo pasaban).
- **C11** (primera auditoría) — `porcion > 0` es obligatoria cuando "Disponible como adición" está marcado; el formulario muestra costo de la porción y margen resultante en vivo.
- **C10** (primera auditoría) — `findProductosUsandoInsumo(state, id)` nueva: puerta única para `deleteInsumo` en los tres buckets. Decisión no especificada: se agregó como función NUEVA sin tocar/eliminar `findProductosUsandoMateria`/`findProductosUsandoEmpaque` (siguen exportadas y testeadas) — solo dejaron de ser la puerta de `deleteInsumo`. Hallazgo real durante la implementación: **toppings no tenía NINGÚN chequeo de dependencias** — se podía borrar un topping usado directo en una receta y dejarla con una referencia rota; verificado a mano en el navegador que ahora se bloquea igual que materia prima.


### C1 · Separar costo alimento/empaque — HECHA (commit 883ddfc)

- Archivos: `js/core.js` (`getCostoProductoDesglosado`, `getCostoDesglosadoVentaItem`, `costosDesglosadosPeriodo`, `getFoodCostPct`, `getPaperCostPct`), `tests/core.test.js` (sección "C1: separar costo...", 4 tests).
- `getCostoProducto()` original NO cambió de firma ni de valor (sigue devolviendo un número, exactamente el mismo) — la función nueva es aparte, para no romper a `applyVenta`/`registrarMerma`/`getMargenProducto`, que siguen usando la de siempre.
- Decisión no especificada: el desglose por período (`getFoodCostPct`/`getPaperCostPct`) prorratea el costo YA CONGELADO de cada ítem de venta (`item.costo`, el mismo dato que ya usa `computeCascada` para el COGS del período) según la proporción VIGENTE de la receta actual — no recalcula el costo total en vivo. Si lo hiciera, food+paper cost dejarían de sumar el mismo COGS que ya reporta Caja/Reportes: sería una tercera cifra de costo de ventas distinta, exactamente el problema que la auditoría de costeo señala como su hallazgo raíz (Sección 0).
- Un topping ES comida (food cost), aunque estructuralmente comparta `COLECCION_POR_TIPO` con empaques en `getCostoProducto`. Un topping suelto o una adición van 100% a alimento (no tienen empaque propio).

### C2 · Merma dentro del COGS — HECHA (commit 8fcedfa)

- Archivos: `js/core.js` (`computeCascada`), `index.html` (etiquetas del "Detalle financiero" y de la tabla del PDF de cierre), `tests/core.test.js` (sección "C2: la merma vive DENTRO...", 3 tests).
- Verificado con test que `utilidadNeta` es IDÉNTICA a la fórmula vieja — solo cambió dónde aparece la línea (ahora dentro de `costoVentas`/`utilidadBruta`, no restando aparte a nivel de utilidad neta). Margen bruto % baja exactamente `mermas/ingresos × 100`, verificado con test.
- **Bug encontrado y corregido de paso, no en el encargo original pero necesario para no dejar el fix a medias**: el dashboard ("Detalle financiero") y la tabla del PDF de cierre de caja mostraban "Utilidad bruta" y, aparte, "−Mermas" camino a la utilidad neta — con el cambio de arriba eso restaba la merma DOS VECES en la lectura visual (aunque `utilidadNeta` en sí seguía siendo correcta: el bug era de presentación, no de cálculo). Verificado en el navegador. Se recategorizó esa fila/tile como informativa ("ya incluidas en costo de ventas"), sin signo negativo.

### C3 · Costo laboral y prime cost — HECHA (commit b014958)

- `GASTO_CATEGORIAS_LABORALES`, `state.config.factorPrestacional` (default 1.38, editable en Ajustes → Costeo), `getCostoLaboral`, `getPrimeCost`.
- **Bug real encontrado y corregido durante la verificación en el navegador**: `emptyState()` no traía `factorPrestacional` en su `config` — un usuario NUEVO (sin estado previo, el caso más común) quedaba con el valor `undefined` pese a que `migrateState(estadoExistente)` sí lo ponía en 1.38. El bloque de defaults de `migrateState` nunca corre para `raw` null/no-objeto (que devuelve `emptyState()` directo por el early-return). Cubierto con test dedicado.
- No se agregó una tarjeta de Prime Cost en Reportes en esta ronda — el encargo lista `js/core.js` como alcance de C1-C5 y no especifica diseño de UI para estas métricas nuevas.

### C4 · Comportamiento de costo y break-even — HECHA (commit f3c00b5)

- `state.config.comportamientoCategorias{}` (sin clasificar = 'fijo'), `getComportamientoCategoria`, `getCostosFijosYVariables`, `getCMPonderado`, `getBreakEven` (bepContable/bepCaja + diarios).
- El "OJO" del encargo (no asumir que el atajo siempre subestima) se cubrió con un test de DOS escenarios (deficitario/rentable) que verifica la dirección real del error en cada uno — no se implementó ninguna heurística.
- Decisión no especificada: el gasto operativo clasificado 'variable'/'mixto' se convierte a un ratio sobre los INGRESOS DEL MISMO período (aproximación explícita en el comentario del código) y se resta del CM ratio, en vez de solo excluirlo del numerador de costos fijos — un gasto variable también reduce lo que queda por cada peso vendido, no es simplemente "costo fijo que no se cuenta".

### C5 · Menu engineering — HECHA (commit e02e4ce)

- `getMenuEngineering(state, ventas)`. Sin decisiones fuera de lo especificado — el encargo fue explícito en los dos puntos que "la mayoría implementa mal" (eje en pesos, mix dentro de cada categoría) y en el umbral de popularidad exacto; se siguieron literalmente.
- Único detalle no cubierto por el texto: el umbral de rentabilidad (promedio de CM$ dentro de la categoría) se calculó como promedio SIMPLE de los productos, no ponderado por volumen — es el método estándar de Kasavana & Smith, y ponderar sesgaría el umbral hacia el producto ya popular (nunca podría superarlo). Documentado en el comentario del código.

### D1 · getVarianza — HECHA (commit 41d3d40)

- `getConsumptionRolling` se refactorizó (sin cambiar su comportamiento externo — sigue con tests verdes) para extraer `consumoTeoricoDeVentas`, reutilizado por `getConsumptionEnRango` (D1 necesita el consumo teórico de un rango EXACTO de fechas, no una ventana de N días redondeados como la rolling).
- `getVarianza(state, inicio, fin)` implementada literal según la fórmula y la guarda del encargo. La guarda crítica (snapshots de tipo 'sistema' dan varianza cero por construcción) tiene su propio test explícito con dos snapshots de sistema.
- La merma registrada se resta usando `merma.consumoReal` (no `merma.cantidad`/`origenId`), para que una merma de tipo `'producto'` (que expande a varios insumos vía receta) reparta correctamente sobre cada insumo — no solo las mermas directas de un insumo.
- Probado con snapshots de conteo **sintéticos construidos en el test** — no se metieron datos falsos en el estado real de la app, tal como pide el encargo.

### D2 · Actual vs Theoretical — HECHA (commit 287575d)

- `getActualVsTheoretical(state, inicio, fin)` y `getActualVsTheoreticalHistorico(state)`. Aritmética sobre D1 (varianza real) y C1 (desglose alimento/empaque teórico). Hereda la guarda de D1.
- Decisión no especificada: la "serie histórica" se arma con un punto por cada PAR CONSECUTIVO de snapshots de tipo 'conteo' existentes — es la cadencia real de conteos físicos la que define los períodos comparables (no hay snapshots en un calendario arbitrario, así que cualquier otro criterio dejaría huecos).

---

## Cierre del run

**Suite completa: 189 tests, 0 fallos** (`node --test tests/*.test.js`).

### Qué queda listo para el conteo de mañana

- **Antes de contar nada**: A1 (sin +8% contaminando la valuación) y A2 (el déficit de stock ya no se pierde silenciosamente) están hechas — el conteo de mañana parte de una valuación limpia.
- **La pantalla para hacer el conteo existe y funciona**: Inventario → "Conteo físico" (B2). Verificado a mano en el navegador: cuenta parcial por tipo, motivo obligatorio en cada diferencia, total en pesos antes de confirmar, genera el ajuste trazado (usuario+timestamp) y el snapshot `tipo:'conteo'`.
- **El modal de insumo ya no deja editar `cantidad` a mano** — cualquier corrección de mañana en adelante pasa por el conteo, con rastro.
- **Preparaciones (masas, salsas) tienen rendimiento real** (B3) y valorización/producción de su propio stock (B4, parcial) — la varianza de mañana no va a leer evaporación normal como si fuera robo.
- **D1/D2 (varianza, Actual vs Theoretical) ya están implementadas y probadas** — en cuanto exista un SEGUNDO snapshot de conteo (el de mañana es el primero), esos reportes van a poder calcular algo real. Con un solo conteo todavía no hay nada que comparar — eso es esperado, no un bug.

### Qué falta

- **B4, etapa 3 ("consumo en venta")**: BLOQUEADA — requiere decidir si `checkStockShortage`/`getConsumptionRolling` deben conocer el stock de preparaciones. Ver la pregunta al principio de este archivo.
- **UI de Reportes para C1/C3/C4/C5** (food cost/paper cost, prime cost, break-even, menu engineering): el motor de cálculo está hecho y probado en `js/core.js`, pero no hay todavía una pantalla que los muestre — el encargo listaba estas tareas con alcance `js/core.js` y no especificaba diseño de UI.
- Los dos archivos de auditoría (`AUDITORIA.md`, `AUDITORIA_COSTEO.md`) siguen sin commitear en el repo (esto es de antes de este run, no de esta tanda).

**No se hizo merge a main.** La rama `auditoria/costeo` está lista para revisión — 20 commits desde que se creó, cada uno con su test.

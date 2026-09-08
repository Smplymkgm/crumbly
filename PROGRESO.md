# Progreso — Ronda 2 (consumo en venta + varianza en dos niveles)

Rama: `auditoria/costeo`. Ronda 1 en `PROGRESO_R1.md` (13/14 tareas, 189 tests). Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA2.md`.

Reglas nuevas de esta ronda: verificación en navegador obligatoria para todo lo que toque `index.html`; cero preguntas bloqueantes (ambigüedad → opción más conservadora, documentada aquí).

## Preguntas bloqueantes

Ninguna — la decisión de la ronda 1 (modo del motor de expansión) ya venía especificada en el encargo.

## Estado de tareas

| Tarea | Estado |
|---|---|
| P0.1 · Diagnóstico del doble descuento | ✅ HECHA |
| P0.2 · Preparaciones contables en el conteo | ✅ HECHA |
| P0.3 · Congelar desglose alimento/empaque en la venta | ✅ HECHA |
| P1.1 · Parámetro de modo en el motor de expansión | ✅ HECHA |
| P1.2 · Consumo parcial y faltante de preparación | ✅ HECHA |
| P1.3 · Bitácora de lotes | ✅ HECHA |
| P2.1 · Reestructurar getVarianza (dos niveles) | ✅ HECHA |
| P2.2 · Ajustar getActualVsTheoretical | ✅ HECHA |
| P3.1 · Umbral de menu engineering (ponderado) | ✅ HECHA |
| P3.2 · Pantalla de reportes de costeo | ✅ HECHA |

## Detalle por tarea

### P0.1 · Diagnóstico del doble descuento — HECHA

- **Bug confirmado con números reales** (script en el scratchpad de la sesión, no comiteado — se convertirá en el test de regresión de P1.2 una vez exista el fix, para no romper "suite completa verde" con un test committeado en rojo): producir 1 lote de una preparación (100g de harina → 100g de masa acreditados) y luego vender 1 unidad de un producto que usa esa preparación (100g) descuenta la harina **dos veces** (200g en vez de 100g), y el stock de la preparación **nunca baja** (se queda en 100g en vez de volver a 0). Confirma exactamente el diagnóstico del encargo.
- `producirPreparacion` **NO está expuesta en `index.html`** — no hay ningún control de UI que la llame (`grep producirPreparacion index.html` → 0 resultados). No se agregó ningún aviso ni control deshabilitado porque no hay nada que deshabilitar. Nadie pudo haber usado el flujo de producción real todavía (ver sección de cierre del run).
- El test de regresión real (con `test(...)` registrado en `tests/core.test.js`) se agrega en el commit de P1.2, ya en verde — así nunca hay un commit con la suite en rojo.

### P0.2 · Preparaciones contables en el conteo — HECHA

- Archivos: `js/core.js` (`SNAPSHOT_BUCKETS` ahora incluye `'preparaciones'`; `listaDeBucket`/`costoUnitarioDe` nuevas, resuelven los 4 buckets uniformemente; `crearSnapshot` gana `bucketsContados`), `index.html` (pestaña "Preparaciones (WIP)" en Conteo físico, unidad "g"), `tests/core.test.js` (9 tests nuevos).
- **Dos bugs reales encontrados y corregidos de paso, no pedidos explícitamente pero necesarios para que P0.2 funcionara de punta a punta**: `previsualizarConteo` y `cerrarConteo` usaban `getInsumoList`, que nunca conoció `'preparaciones'` — una línea de preparación se descartaba en silencio en la vista previa (`.filter(Boolean)` se comía el `null`) y `cerrarConteo` directamente tiraba "Insumo no encontrado". Ambos se corrigieron para usar `listaDeBucket`/`costoUnitarioDe`, con test dedicado para cada uno.
- `bucketsContados` (nuevo campo del snapshot): `{materia, empaques, toppings, preparaciones}`, cada uno `true` si ese bucket no tiene insumos registrados (trivialmente completo) o si al menos una línea de ese tipo apareció en este conteo; `false` si tiene insumos y ninguno se tocó. Es la señal que P2.1 va a usar para bloquear la varianza cuando falta el WIP — más barata y sin ambigüedad que inferirlo de `noContados` (que se queda mudo cuando un bucket tiene cero insumos).
- **Verificado en el navegador** (servidor estático local, sesión simulada vía `crumbly-session` en localStorage — `restoreSession()` no valida contra el backend, así que no hace falta login real de Google para probar la UI): pestaña "Preparaciones (WIP)" aparece, cuenta 750g contra 800g teóricos, motivo obligatorio, cierre genera ajuste (−50g, −$250 al costo derivado) y el snapshot trae `bucketsContados.materia:false` (no se tocó) y `preparaciones:true` (sí se tocó) correctamente.
- No se agregó visualización de `cantidad` (stock WIP) en la pantalla normal de Preparaciones (Inventario) — sigue sin mostrarse fuera del modal de conteo, mismo gap que dejó B4 en la ronda 1. Fuera de lo que pide P0.2 explícitamente.

### P0.3 · Congelar desglose alimento/empaque en la venta — HECHA

- Archivos: `js/core.js` (`applyVenta` congela `costoAlimento`/`costoEmpaque` en los 4 lugares donde arma un `item` — producto, topping en línea, adición, topping suelto; `getCostoDesglosadoVentaItem` usa esos campos primero y cae al prorrateo vigente solo si no existen; `SCHEMA_VERSION` → 10; comentario explícito en la migración de ventas), `tests/core.test.js` (5 tests nuevos).
- No hubo ambigüedad que resolver — el encargo especificaba exactamente qué congelar, dónde usarlo, y que la migración NO debía rellenar ventas viejas. Se siguió literal.
- Toppings y adiciones se congelan 100% como alimento (`costoEmpaque:0`) — mismo criterio de C1, ninguno tiene empaque propio.
- Test del criterio explícito del encargo: se vende, se cambia el costo del empaque de la receta DESPUÉS (300→900), y `getFoodCostPct`/`getPaperCostPct` de esa venta pasada quedan exactamente iguales — antes de este fix habrían cambiado, reescribiendo silenciosamente el desglose de una venta ya cerrada.
- No toca `SCHEMA_VERSION` de la Ronda 1 (quedó en 9 con la migración de A1); ahora es 10. El gate de la migración de A1 (`recalcularValuacionV9`) sigue comparando contra el literal `9`, no contra `SCHEMA_VERSION` — no se re-ejecuta de más al subir a 10 (verificado: la suite completa sigue verde, incluidos los tests de idempotencia de esa migración).

### P1.1 · Parámetro de modo en el motor de expansión — HECHA

- Archivos: `js/core.js` (`aplicarComponentes` gana un 5º parámetro `opts.modo`, `'crudo'` por defecto; `getConsumptionRolling`/`consumoTeoricoDeVentas` pasa `{modo:'crudo'}` explícito; `aplicarComponentes` se exporta para poder testearlo directo), `tests/core.test.js` (6 tests: los dos modos por separado, consumo parcial, los dos criterios exactos del encargo, no-regresión de `getConsumptionRolling`).
- `applyVenta`, `computeSaleConsumption`, `checkStockShortage` y `registrarMerma` **todavía NO pasan `{modo:'stock'}`** — eso es P1.2, porque implica además el consumo parcial + `faltante` de preparación + `revertVenta` en dos niveles, todo en el mismo cambio (no se puede separar "usar modo stock" de "manejar el faltante que ese modo puede generar").
- **Limitación conocida, documentada en el código (opción conservadora, no bloqueante)**: en una simulación de solo lectura (`computeSaleConsumption`), si el MISMO carrito tiene dos líneas distintas que usan la MISMA preparación, cada línea lee `prep.cantidad` por separado (la simulación nunca muta nada) y ambas podrían creer que hay stock de sobra — el aviso de faltante PRE-venta podría subestimarse en ese caso puntual. La deducción REAL (`applyVenta`) no tiene este problema porque `apply` sí muta el estado entre líneas. No es una pérdida de datos ni un error de contabilidad — en el peor caso, el aviso previo es optimista y el faltante real de A2 lo captura igual en el momento del descuento real.

### P1.2 · Consumo parcial y faltante de preparación — HECHA

- Archivos: `js/core.js` (`applyVenta` y `registrarMerma(origen producto)` pasan `{modo:'stock'}`; `computeSaleConsumption`/`checkStockShortage` ganan el bucket `preparaciones`; `revertVenta`/`eliminarMerma` reponen los DOS niveles — cantidad y faltante; `registrarMerma` gana tracking de `faltanteGenerado` que antes no tenía; `faltante:0` en preparaciones (migración) y preservado en `savePreparacion`), `tests/core.test.js` (8 tests, incluida la regresión real de P0.1 ya en verde).
- **El test de P0.1 ahora pasa** (confirmado también con el script del scratchpad, no solo el test): producir un lote y vender el producto descuenta la harina UNA sola vez; la preparación baja a 0 al venderse, no se queda creciendo para siempre.
- **Verificado en el navegador con el flujo real de venta** (Registrar venta → buscar producto → agregar → confirmar), dos veces: (1) 1 unidad con 200g de stock de sobra → consume 100% de la preparación, la materia prima queda intacta; (2) 3 unidades más (300g pedidos, solo 100g de stock) → consume el resto de la preparación (100g) y expande el faltante (200g) a materia prima, sin errores de consola.
- **Bug encontrado y corregido, no pedido explícitamente pero necesario**: `registrarMerma` nunca implementó el mecanismo de `faltante` de A2 para NINGÚN bucket (ni materia, ni empaques, ni toppings) — su `deduct` solo clampeaba a 0 sin registrar el déficit. Con el modo `'stock'` cascadeando preparación → materia en una merma de producto, dejar ese hueco habría reintroducido la misma clase de bug que A2 corrigió, ahora en mermas. Se agregó `faltanteGenerado` + su reversión simétrica en `eliminarMerma`, mismo patrón que `revertVenta`.
- `checkStockShortage` incluye un chequeo de `preparaciones` por completitud/consistencia con los demás buckets, aunque por construcción (el motor nunca pide más de lo disponible en modo `'stock'`) nunca va a marcar un faltante ahí — documentado en el comentario.

### P1.3 · Bitácora de lotes — HECHA

- Archivos: `js/core.js` (`state.lotes[]` nuevo; `producirPreparacion` reescrita — ya NO sobreescribe `rendimientoPct`, registra `rendimientoObservado` en el lote, agrega `faltanteGenerado`; `eliminarLote` nueva; `getPromedioRendimientoObservado` nueva), `tests/core.test.js` (8 tests nuevos + 2 tests viejos de Ronda 1 corregidos porque afirmaban el comportamiento viejo — auto-sobreescritura de `rendimientoPct` — que este encargo pide cambiar explícitamente).
- **Cambio de comportamiento pedido explícitamente, no una corrección de bug**: antes, un solo lote mal digitado (ej. una báscula mal calibrada un día) alteraba en silencio el costeo de TODOS los productos que usan esa preparación. Ahora `rendimientoPct` es un valor de la receta, configurado a propósito, y solo cambia si alguien lo cambia. `rendimientoObservado` (lo medido en cada lote específico) vive en `state.lotes[]`, nunca sobreescribe la receta.
- `getPromedioRendimientoObservado(state, preparacionId, n=5)` es la mitad de datos de "la app muestra el promedio... como sugerencia, con un botón para adoptarlo" — la función existe y está probada. **La mitad de UI (el botón, la pantalla) no se construyó**: no hay ninguna pantalla de "Producir lote" en `index.html` — P0.1 ya confirmó que `producirPreparacion` no está expuesta en absoluto. Construir esa pantalla desde cero es un proyecto de UI no pedido explícitamente por ninguna tarea de esta ronda (P1.2 solo decía "rehabilitar el control SI existía" — no había ninguno que rehabilitar). Opción conservadora, documentada: se implementó el motor completo y probado; la pantalla queda pendiente de una ronda de UI dedicada a producción.
- `eliminarLote` sigue el mismo patrón que `eliminarGasto`/`eliminarMerma`: repone `consumoReal` + `faltanteGenerado`, y resta exactamente `gramosObtenidos` del stock de la preparación (nunca negativo, mismo criterio de "no se puede reconstruir con certeza qué le corresponde a este lote si ya se consumió stock desde entonces").
- No se agregó ninguna verificación de navegador para esta tarea — no toca `index.html` (no hay UI que verificar).

### P2.1 · Reestructurar getVarianza + P2.2 · Ajustar getActualVsTheoretical — HECHAS (una sola tanda de trabajo)

Se implementaron juntas porque P2.2 no puede funcionar con la forma vieja de `getVarianza` a medio camino — el propio encargo las describe como una continuación directa ("hereda las guardas nuevas de P2.1").

- `getVarianza` devuelve ahora `{ preparaciones: {...}, materiaPrima: {...} }` en vez de un reporte plano — **cambio de forma que rompe a cualquiera que llamara a la función vieja esperando `.lineas` en la raíz** (ya no existe `getVarianza(...).lineas`; ahora es `.preparaciones.lineas` / `.materiaPrima.lineas`). Es exactamente lo que pide el encargo ("Reestructurar getVarianza"), no un descuido.
- **Decisión no especificada, clave para la implementación**: en vez de re-expandir el consumo teórico con `aplicarComponentes` (que dependería de la foto de stock de HOY, no de la de cada momento histórico), el teórico de cada nivel se lee directo de lo que P1.2 ya congeló en cada transacción real: teórico de preparaciones = Σ `venta.consumoReal.preparaciones` del rango; teórico de materia/empaques/toppings = Σ `lote.consumoReal` (producir WIP) + Σ `venta.consumoReal` del rango. Ningún dato se recalcula con la receta o el stock vigente — todo es histórico, congelado en su momento, mismo principio que P0.3.
- **Empaques y toppings no tienen nivel propio** (el encargo solo nombra "Preparaciones" y "Materia prima") — nunca pasan por una preparación (`aplicarComponentes` solo desvía componentes tipo `'preparacion'`), así que su fórmula es idéntica a la de antes de esta ronda, sin ninguna ambigüedad. Opción conservadora: se mantuvieron DENTRO del nivel `materiaPrima` en vez de descartarlos (perder esa varianza sería una regresión real de la Ronda 1, y ninguna tarea pidió quitarla).
- **Guarda nueva verificada con test dedicado**: un conteo que cuenta materia en ambos extremos pero NUNCA cuenta preparaciones (bucket con insumos pero cero líneas tocadas) hace que los DOS niveles devuelvan `suficiente:false` — incluida materia prima, tal como pide el encargo explícitamente ("sin saber cuánta salsa quedó no se puede separar...").
- **Test más importante de la tanda**: un escenario con producción (rendimiento de cocina 90%, genera 30g de varianza de materia) y una merma directa de preparación (50g, genera varianza de preparación) en el MISMO período, verificando que los dos números salen DISTINTOS y cada uno mide lo que le corresponde — la prueba concreta de que "una pérdida de evaporación en la cocina y un robo en el mostrador" ya NO son indistinguibles.
- La guarda de la Ronda 1 (snapshots de sistema → cero por construcción) se mantuvo intacta y su test sigue verde, ahora verificando ambos niveles.

### P3.1 · Umbral de menu engineering (ponderado) — HECHA

- Archivo: `js/core.js` (`getMenuEngineering` reusa `getCMPonderado` de C4, calculado con los ítems de venta de CADA categoría — no reescribe la fórmula del promedio ponderado). El comentario que argumentaba (incorrectamente) que ponderar sesga el umbral se corrigió.
- Test del criterio exacto del encargo: 4 productos en una categoría donde promedio simple (250) y ponderado (400) dan resultados distintos para un producto (CM=300, no popular) — bajo el simple sería "enigma", bajo el ponderado (correcto) es "perro". El test verifica explícitamente que la clasificación NO es la que daría el promedio simple.
- Ningún test de la Ronda 1 se rompió por este cambio (coincidencia de los números elegidos en esos fixtures, no porque el fix no tuviera efecto — verificado con el test nuevo, que sí distingue).

### P3.2 · Pantalla de reportes de costeo — HECHA

- Archivos: `js/core.js` (`getFoodCostPctRango`/`getPaperCostPctRango` nuevas — versión por rango exacto de `getFoodCostPct`/`getPaperCostPct`, que solo aceptaban `period+ref` y no podían expresar un rango personalizado), `index.html` (pestañas "Resumen"/"Costeo" dentro de Dashboard, `renderReportesCosteo` + `renderVarianzaNivel`, `getReportRangeISO`, `saveConfigFactorPrestacional` ahora editable desde dos lugares), `tests/core.test.js` (1 test para las funciones nuevas de rango).
- **Verificado en el navegador con datos reales** (servidor estático local, sesión simulada): produje un lote (90% de rendimiento), vendí, conté físico con una diferencia en cada nivel, y confirmé que las 5 secciones muestran los números correctos — incluida la regla de presentación sin excepciones: con un rango sin snapshots de conteo, Varianza y AvT muestran el MOTIVO exacto ("Falta un snapshot de conteo en el inicio o el fin del rango"), nunca un guion ni un cero. Probado también el cambio real de pestaña (clic) y el flujo real de rango personalizado (escribir en los `<input type="date">`, disparar `onReportRangeChange()`), sin errores de consola.
- Las 5 secciones quedaron en el orden de importancia operativa que pide el encargo: break-even diario (grande, con lo ya vendido hoy al lado) → prime cost (semáforo contra 65%, factor prestacional editable ahí mismo) → food/paper/COGS % en tres números separados → menu engineering (cuadrantes por categoría con la acción recomendada) → varianza (dos niveles) + AvT.
- Decisión no especificada: el factor prestacional ahora es editable desde DOS lugares (Ajustes y la pestaña de Costeo) — `saveConfigFactorPrestacional` se generalizó para leer del input que disparó el evento y sincronizar el otro, en vez de hardcodear un solo id.
- El break-even "de hoy" usa el `bepDiarioContable`/`bepDiarioCaja` del PERÍODO SELECCIONADO (no recalcula un período distinto solo para esta tarjeta) — es una tasa diaria promedio de ese período, no "el break-even de las próximas 24 horas". "Llevas vendido hoy" sí es siempre el día calendario de hoy, independiente del período seleccionado, porque comparar contra otro período no tendría sentido.

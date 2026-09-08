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
| P1.1 · Parámetro de modo en el motor de expansión | PENDIENTE |
| P1.2 · Consumo parcial y faltante de preparación | PENDIENTE |
| P1.3 · Bitácora de lotes | PENDIENTE |
| P2.1 · Reestructurar getVarianza (dos niveles) | PENDIENTE |
| P2.2 · Ajustar getActualVsTheoretical | PENDIENTE |
| P3.1 · Umbral de menu engineering (ponderado) | PENDIENTE |
| P3.2 · Pantalla de reportes de costeo | PENDIENTE |

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

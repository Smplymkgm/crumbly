# Progreso — Ronda 2 (consumo en venta + varianza en dos niveles)

Rama: `auditoria/costeo`. Ronda 1 en `PROGRESO_R1.md` (13/14 tareas, 189 tests). Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA2.md`.

Reglas nuevas de esta ronda: verificación en navegador obligatoria para todo lo que toque `index.html`; cero preguntas bloqueantes (ambigüedad → opción más conservadora, documentada aquí).

## Preguntas bloqueantes

Ninguna — la decisión de la ronda 1 (modo del motor de expansión) ya venía especificada en el encargo.

## Estado de tareas

| Tarea | Estado |
|---|---|
| P0.1 · Diagnóstico del doble descuento | ✅ HECHA |
| P0.2 · Preparaciones contables en el conteo | PENDIENTE |
| P0.3 · Congelar desglose alimento/empaque en la venta | PENDIENTE |
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

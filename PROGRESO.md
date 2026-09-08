# Progreso — implementación de auditorías (AUDITORIA.md + AUDITORIA_COSTEO.md)

Rama: `auditoria/costeo`. Protocolo: test primero, suite completa verde, un commit por tarea. Ver `/Users/mike/Downloads/PROMPT_LOOP.md` para el encargo completo.

## Preguntas bloqueantes

(se llenan aquí a medida que aparecen — vacío por ahora)

## Estado de tareas

| Tarea | Estado |
|---|---|
| A1 · Quitar recargo +8% | ✅ HECHA |
| A2 · Registrar déficit de stock (`faltante`) | PENDIENTE |
| B1 · Snapshots de inventario | PENDIENTE |
| B2 · Flujo de conteo físico | PENDIENTE |
| B3 · Rendimiento de preparaciones | PENDIENTE |
| B4 · Inventario de preparaciones (WIP) | PENDIENTE |
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


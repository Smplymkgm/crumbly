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
| T0 · Alarma de tamaño de payload | PENDIENTE |
| T0.1 · Sacar conteoEnProgreso del estado sincronizado | PENDIENTE |
| T1 · Migración a filas append-only | PENDIENTE |
| T2 · Integridad de insumos | PENDIENTE |
| T2.1 · Reporte de integridad | PENDIENTE |
| T3 · Pantalla de producción de lotes | PENDIENTE |
| T4 · Etiqueta del break-even | PENDIENTE |
| T5 · Aviso previo de faltante en preparaciones | PENDIENTE |

## Detalle por tarea

(se llena a medida que se completa cada una)

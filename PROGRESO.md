# Progreso — Ronda 4 (bloqueadores del despliegue de T1 + C2)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md`, `PROGRESO_R2.md`, `PROGRESO_R3.md`. Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA4.md`.

**Esta ronda existe porque T1 (Ronda 3) no se puede desplegar como quedó.** La migración a filas append-only está bien construida y verificada, pero la revisión encontró dos defectos que solo aparecen DESPUÉS del despliegue (U0, U1) más un riesgo en el Sheet real que hay que inspeccionar antes de migrar (U2). Ninguno se detectó en las nueve corridas de verificación de la Ronda 3 porque todas prueban el mismo eje: registrar, recargar, hidratar, reintentar. **El eje que faltó — borrar — es obligatorio en toda verificación de esta ronda.**

Después: U3 (instrumentar la migración), U4 (C2, el último riesgo grande), U5 (cuadrar el conteo de tests).

**Restricciones no negociables de esta ronda:**
- NO se despliega al Apps Script de producción. NO se corre `migrarAAppendOnly()` contra el Sheet real. Esta ronda prepara el despliegue, no lo ejecuta.
- NO se tocan datos reales (costos de insumos, ventas, Sheet).
- U0, U1 y U2 son bloqueadores del despliegue. Van primero, en ese orden, cada uno commiteado y verificado antes del siguiente. Nada de U3 en adelante empieza antes de cerrar los tres.
- Toda verificación incluye el eje "borrar": registrar + borrar + sincronizar, no solo registrar + recargar.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes es la regla — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| U0 · La alarma de T0 mide el catálogo, no el payload | PENDIENTE |
| U1 · Los borrados persisten (filas de lápida) | PENDIENTE |
| U2 · Validación de forma de hoja antes de migrar | PENDIENTE |
| U3 · Instrumentar la migración | PENDIENTE |
| U4 · C2 — pull que pisa cambios locales | PENDIENTE |
| U5 · Cuadrar el conteo de tests | PENDIENTE |

## Detalle por tarea

(se completa a medida que se cierra cada una)

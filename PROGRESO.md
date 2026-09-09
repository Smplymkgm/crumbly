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
| T0 · Alarma de tamaño de payload | ✅ HECHA |
| T0.1 · Sacar conteoEnProgreso del estado sincronizado | PENDIENTE |
| T1 · Migración a filas append-only | PENDIENTE |
| T2 · Integridad de insumos | PENDIENTE |
| T2.1 · Reporte de integridad | PENDIENTE |
| T3 · Pantalla de producción de lotes | PENDIENTE |
| T4 · Etiqueta del break-even | PENDIENTE |
| T5 · Aviso previo de faltante en preparaciones | PENDIENTE |

## Detalle por tarea

### T0 · Alarma de tamaño de payload — HECHA

- Archivos: `js/sync.js` (`getPayloadSizeInfo`, `getPayloadBreakdown`, `getSyncSizeHistory`/buffer en localStorage, `push()` rechaza antes de mandar la petición sobre 48.000), `backend/Code.gs` (`writeState_` valida el largo antes de escribir la celda y devuelve `{ok:false, code:'PAYLOAD_TOO_LARGE'}` — nunca `ok:true` en silencio), `index.html` (`pushInBackground` muestra banner persistente — nunca un toast — en advertencia y en bloqueo; panel nuevo en Ajustes con tamaño/%/desglose por colección, calculado al abrir el modal), `tests/sync.test.js` (8 tests nuevos).
- **Verificado en el navegador con los tres niveles reales**: armé un estado sintético (relleno inocuo, no datos del negocio) que cruza los tres umbrales y confirmé — el panel de Ajustes muestra el tamaño/%/desglose correctos en cada nivel; `pushInBackground()` dispara el banner persistente rojo con el número real y el tope, con "Ver detalle en Ajustes" y "Cerrar"; confirmé que sobre el tope de bloqueo la función `push()` **nunca llega a intentar la petición HTTP** (pasé un `fetch` que rechaza a propósito y no se invocó).
- **Limitación reconocida y documentada, no evitable en este entorno**: `backend/Code.gs` no se puede correr ni testear en Node (no hay runtime de Apps Script local), y la regla de esta ronda prohíbe desplegarlo contra el backend real. Se verificó por lectura cuidadosa — la lógica es aritmética simple sobre `.length`, igual que su equivalente ya probado en `js/sync.js` — pero no hay una ejecución real que lo confirme. El cliente ya bloquea antes de llegar ahí, así que el backend es defensa en profundidad, no la única línea.
- **Bug de entorno encontrado y anotado, no del código de la app**: el servidor estático local (`python3 -m http.server`) no manda cabeceras de caché, y el navegador de este entorno cacheaba agresivamente `js/sync.js` entre reloads de la MISMA pestaña — la primera verificación mostraba `CrumblySync.getPayloadSizeInfo is not a function` con el código ya corregido en disco. Se resolvió cambiando el puerto del servidor local en `.claude/launch.json` (8791→8792) para forzar un origen nuevo sin caché. No afecta producción (Apps Script no sirve archivos estáticos así).
- Decisión no especificada: el tope de bloqueo se fijó en 48.000 (no 50.000 exactos) — margen de seguridad explícito para no depender de contar el último carácter exacto que Sheets acepta.

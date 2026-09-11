# Progreso — Ronda 6 (X0/X1 bloqueadores + interfaz)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md` a `PROGRESO_R5.md`. Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA6.md`.

**V0 (Ronda 5) quedó bien resuelto** — las lápidas por lista explícita se verificaron en los escenarios de borde correctos y la señal es la adecuada. **Pero el veredicto de despliegue de la Ronda 5 fue prematuro: V1 introdujo un bloqueo de sincronización que se dispara solo, en cada carga de página.** X0 lo corrige y es el único bloqueador que queda hasta que se cierre.

Después: X1 (un camino de borrado que puede haber quedado sin cablear), X2 (sincronización incremental, la V4 que quedó abierta en la Ronda 5) y el bloque W (interfaz, pedido directamente por el dueño usando la app en su celular).

**Restricciones no negociables de esta ronda:**
- No se despliega al Apps Script de producción. No se corre `migrarAAppendOnly()` contra el Sheet real. No se tocan datos reales.
- X0 y X1 son bloqueadores del despliegue de T1. Van primero, en ese orden, cada uno commiteado y verificado antes del siguiente.
- Cada tarea se documenta en `PROGRESO.md` de forma que se sostenga sola — sin remitir al mensaje de commit ni al repo.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| X0 · La alarma de V1 bloquea los push en cada carga de página | ✅ HECHA |
| X1 · El borrado de V3.4 puede no estar cableado | pendiente |
| X2 · Sincronización incremental | pendiente |
| W1 · Escala tipográfica | pendiente |
| W2 · Header con respiro | pendiente |
| W3 · Los tres botones del header | pendiente |
| W4 · No regresiones | pendiente |

## Detalle por tarea

### X0 · La alarma de V1 bloquea los push en cada carga de página — HECHA

**El bug, con números reales.** V1 (Ronda 5) hizo que la alarma de tamaño midiera el estado completo (no solo el catálogo) mientras la fase de la migración no se supiera con certeza — razonando "ante la duda, medir de más, porque medir de menos falla en silencio". El razonamiento era correcto pero la conclusión se pasó de largo: V1 trataba "fase sin confirmar" exactamente IGUAL que "fase pre confirmada" — así que medir de más también **bloqueaba** de más.

`afterLogin_` consulta la fase al backend SIN bloquear el login (fire-and-forget), así que hay una ventana real en **cada carga de página** — no solo entre despliegues — en la que la fase todavía no se sabe. En esa ventana, con el catálogo real rondando los 27.000 caracteres y cada venta hidratada pesando unos 761:

```
27.000 + 761 × 28 ventas = 48.308  → supera el tope de bloqueo de 48.000
```

A partir de la venta 28, cada carga de página abría una ventana en la que `push()` se negaba a mandar — banner rojo de bloqueo — hasta que la fase se confirmara. Y empeora con el historial, justo lo que T1 desacopló. Medir de más para **advertir** está bien. Bloquear sobre una fase que no se sabe es un falso positivo que impide operar — y acá el falso positivo no es molesto: es una app que no guarda.

**El arreglo, en `js/sync.js`:**

- **La fase CONFIRMADA ahora se persiste en `localStorage`** (`crumbly-fase-migracion-confirmada`) — por dispositivo, nunca en el estado sincronizado, mismo patrón que `crumbly-catalog-base`/`conteoEnProgreso`/`crumbly-borrados-pendientes`. `getFaseConocida()` lee directo de `localStorage` en cada llamada — sin ninguna variable en memoria intermedia — así que un reload real la encuentra tal cual quedó, sin ningún paso de inicialización y sin la ventana de "vuelve a `null`" que tenía V1. Antes vivía en una variable de módulo (`faseMigracionConocida_`) que efectivamente se reseteaba en cada carga de página — la causa raíz exacta del bug.
- **`getAlarmSizeInfo(state, fase)` ahora distingue TRES casos, no dos:**
  - `fase === 'post'` → mide el catálogo (sin cambios, comportamiento de U0/V1).
  - `fase === 'pre'` (CONFIRMADA por el backend) → mide el estado completo, y el bloqueo real SÍ procede si supera el tope — es la fase real del backend, no una adivinanza.
  - Cualquier otra cosa (`undefined`, `null`, string desconocido) → **fase SIN CONFIRMAR**. Sigue midiendo el estado completo (conservador para el número que se muestra), pero el nivel **nunca pasa de `'advertencia'`** — el campo `fase` de la respuesta es `'sin_confirmar'`, un tercer valor explícito, no `'pre'` disfrazado.
- **`push()` ya no puede bloquear sobre una fase sin confirmar**, porque `getAlarmSizeInfo` nunca le devuelve `nivel:'bloqueado'` en ese caso — no hizo falta tocar la lógica de `push()` que decide bloquear (`if (sizeInfo.nivel === 'bloqueado') return...`), el cambio está enteramente en qué nivel calcula `getAlarmSizeInfo`.
- **El backend sigue siendo la defensa real, sin cambios**: `writeState_()` en `backend/Code.gs` valida el largo del catálogo en CADA escritura, sin importar qué haya medido el cliente. El bloqueo del cliente es una comodidad para no gastar una petición en vano — nunca la última línea, y por diseño no puede ser más estricto que una verdad que todavía no se confirmó.
- **`index.html`**: el panel de Ajustes ("Alarma de tamaño") ahora muestra una línea de estado explícita con los tres casos — 🟢 confirmada POST, 🟡 confirmada PRE, ⚪ SIN CONFIRMAR (con la aclaración "advierte, nunca bloquea"). Antes la fase sin confirmar se mostraba mezclada con "pre" sin distinción.

**Tests** (`tests/sync.test.js`, grupo "V1 (Ronda 5) / X0 (Ronda 6)"): fase `'pre'` confirmada con estado grande → advierte; fase `'pre'` confirmada SOBRE el tope → sí bloquea (criterio nuevo de X0, antes no existía un test que confirmara que la fase confirmada real todavía bloquea de verdad); fase `'post'` sin cambios; fase SIN CONFIRMAR (`undefined`/`null`/string desconocido) con estado MUY por encima del tope → advierte, el nivel nunca llega a `'bloqueado'`; `push()` con fase sin confirmar y estado sobre el tope → la petición SÍ se manda; `getMigrationStatus()` persiste la fase y un `push()` posterior la usa; **criterio de persistencia entre reloads** — se fuerza una instancia NUEVA del módulo `sync.js` (limpiando el caché de `require`, la simulación más cercana a un reload real en Node) y se confirma que ve la fase ya persistida sin volver a `null`. Un test de U0 (Ronda 4) que asumía bloqueo por defecto sin fase se actualizó para pasar `fase:'post'` explícita — ese comportamiento ahora es específico de una fase confirmada, no el default.

**Suite completa: 344 tests** (auth 10, core 256, rowsync 39, sync 39) — medido corriendo los cuatro archivos.

**Verificado en el navegador** (mock backend local en `localhost:8802`, cero contacto con `script.google.com`):
1. Se reprodujo el bug exacto: un estado de 50.189 caracteres (catálogo ~27.000 + 30 ventas de ~750c/u) con la fase SIN confirmar (`getFaseConocida()` recién arrancado en `null`) — `getAlarmSizeInfo` reportó `nivel:'advertencia'`, `fase:'sin_confirmar'`, y `push()` **mandó la petición igual** (`ok:true`) — el mock backend la aceptó porque su catálogo real (27.000) está bajo el tope, confirmando que la protección real seguía intacta del lado del backend.
2. Se confirmó la fase con `getMigrationStatus()` (`fase:'post'`, quedó en `localStorage`).
3. **Reload completo de la página** — inmediatamente después, sin llamar a nada, `CrumblySync.getFaseConocida()` ya devolvía `'post'` directo de `localStorage`. La ventana de incertidumbre no se reabrió.
4. El panel de Ajustes mostró "🟢 Fase confirmada: POST-migración" tras el login; al borrar la fase persistida a mano y volver a renderizar, mostró "⚪ Fase SIN CONFIRMAR — advierte, nunca bloquea" con el color de advertencia correcto.
- Sin errores de consola en ningún paso.

---

## Veredicto parcial (se completa al cerrar el run)

X0 — el bloqueador de despliegue que señaló esta ronda — está cerrado y verificado. X1 sigue pendiente; hasta que cierre, T1 sigue sin poder desplegarse (regla de esta ronda: X0 y X1 son los dos criterios de bloqueo). El veredicto final se escribe en la sección de cierre.

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
| X1 · El borrado de V3.4 puede no estar cableado | ✅ HECHA |
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

### X1 · El borrado de V3.4 puede no estar cableado — HECHA

**Inventario completo de caminos de borrado append-only** (ventas, gastos, mermas, snapshots, ajustes, lotes) — se recorrió `index.html` y `js/core.js` buscando toda reasignación de esas seis colecciones (`grep` de `state.<coleccion> =`, `.filter(`, `.splice(`):

| Colección | Camino(s) de borrado en la UI | ¿Cableado con `marcarBorradoPendiente`? |
|---|---|---|
| `ventas` | `eliminarVenta(id)` (botón en Caja, **y el mismo botón reusado en el modal de V3.4** — `renderVentasCostoInvalido_`) | Sí, indirectamente — las dos entradas llaman a la MISMA función |
| `gastos` | `eliminarGasto(id)` (botón en Caja) | Sí |
| `mermas` | `eliminarMerma(id)` (botón en Inventario → Mermas) | Sí |
| `lotes` | `eliminarLoteUI(id)` (botón en Producción de lotes) | Sí |
| `snapshots` | **Ninguno** — un snapshot se crea al cerrar un conteo físico (T0.1/B2), nunca se borra individualmente desde la UI | N/A — no hay nada que cablear hoy |
| `ajustes` | **Ninguno** — un ajuste se crea automáticamente al cerrar un conteo con diferencia, nunca se borra individualmente | N/A — no hay nada que cablear hoy |

**El resultado del inventario, con el repo tal como quedó al cierre de la Ronda 5: el modal de V3.4 NO era en realidad un camino sin cablear** — su botón de borrar llama a `eliminarVenta(v.id)`, la misma función que ya declaraba el pendiente desde V0. La preocupación del encargo era válida como RIESGO (era perfectamente posible que se hubiera escrito con una función nueva) pero, verificado el código real, no era un bug presente. Aun así, la guarda estructural de abajo se construyó igual — el riesgo de que el PRÓXIMO camino de borrado sí lo olvide seguía intacto y es lo que el encargo pide cerrar de raíz.

**La guarda estructural — dos mitades, una en cada capa:**

- **`js/core.js` no puede llamar a `marcarBorradoPendiente`** (vive en `js/sync.js`, usa `localStorage`) — core.js es deliberadamente libre de DOM/localStorage, es la regla no negociable de "lógica de negocio testeable sin DOM" que sostiene toda esta auditoría. Así que la mitad de la guarda que SÍ puede vivir en core.js es esta: se agregó `quitarRegistro_(state, coleccion, id)`, la ÚNICA función que reasigna una colección append-only en todo el archivo. `eliminarLote`, `revertVenta` (la usa `eliminarVenta`), `eliminarGasto` y `eliminarMerma` —las cuatro funciones que antes tenían su propio `state.X = state.X.filter(...)` — ahora llaman a esta única función en vez de reimplementar el filtro cada una.
  - **Test** (`tests/core.test.js`, grupo "X1"): un test lee el código FUENTE de `core.js` y falla si aparece cualquier reasignación inline de una colección append-only fuera de `quitarRegistro_` — si alguien agrega un quinto camino de borrado con su propio `.filter()` suelto, este test lo atrapa antes que cualquier otra cosa. Un segundo test confirma que las cuatro funciones públicas siguen quitando el registro correcto de su colección.
- **`index.html` no puede declarar un borrado sin pasar por un único punto**: se agregó `borrarConSync_(coleccion, id, aplicarEnCore)` — la única función que llama a `CrumblySync.marcarBorradoPendiente`. Aplica la mutación en `state` (delegando al `CrumblyCore.eliminarX`/`revertVenta` correspondiente), declara el pendiente, y guarda — las tres cosas pegadas, en ese orden, sin forma de tener una sin las otras. `eliminarVenta`, `eliminarGasto`, `eliminarMerma` y `eliminarLoteUI` se reescribieron para pasar por acá en vez de llamar a `CrumblySync.marcarBorradoPendiente` cada una por su cuenta (que es exactamente el patrón que un camino nuevo puede olvidar).
  - **Test** (`tests/sync.test.js`, grupo "X1"): un test lee el código fuente de `index.html` y falla si `marcarBorradoPendiente(` aparece más de una vez, o si esa única aparición no está dentro de `borrarConSync_`. Un segundo test (el inventario de la tabla de arriba, convertido en test) confirma que las cuatro funciones de borrado conocidas llaman a `borrarConSync_` con la colección correcta — si `eliminarVenta` alguna vez deja de llamar a `borrarConSync_('ventas', ...)`, este test lo atrapa.
- **Por qué esto es "estructural" y no solo "recordar llamar a la función correcta"**: antes, un desarrollador que agregara un sexto camino de borrado (por ejemplo, borrar un snapshot) tenía que ACORDARSE de llamar a `marcarBorradoPendiente` — un paso fácil de omitir, que es justo lo que este encargo sospechaba que había pasado. Ahora, agregar ese camino sin pasar por `borrarConSync_`/`quitarRegistro_` hace fallar un test inmediatamente, en la próxima corrida de la suite — el olvido se vuelve imposible de que pase desapercibido, aunque técnicamente todavía sea posible escribir el código incorrecto (no hay una barrera de lenguaje/tipo que lo impida, solo un test que lo detecta rápido y barato).

**Suite completa: 348 tests** (auth 10, core 258, rowsync 39, sync 41) — medido corriendo los cuatro archivos.

**Verificado en el navegador con el ciclo completo borrar → push → pull → reload, en las cuatro colecciones con función de borrado real** (mock backend local en `localhost:8802`, cero contacto con `script.google.com`): se registró una venta, un gasto, una merma y un lote reales (`CrumblyCore.applyVenta`/`registrarGasto`/`registrarMerma`/`producirPreparacion`), se sincronizaron, y se borraron los cuatro con sus botones reales (`eliminarVenta`/`eliminarGasto`/`eliminarMerma`/`eliminarLoteUI`, `confirm()` forzado a aceptar) — los cuatro quedaron declarados en `getBorradosPendientes()` automáticamente. Tras el push, el backend confirmó las cuatro colecciones en 0 registros vivos. Se hizo un **reload completo de la página** y un pull fresco contra el mismo backend — las cuatro colecciones se mantuvieron en 0, nada resucitó. Sin errores de consola.

---

## Veredicto parcial (se completa al cerrar el run)

X0 y X1 — los dos bloqueadores de despliegue de esta ronda — están cerrados y verificados. Quedan X2 (sincronización incremental, no bloqueadora) y el bloque W (interfaz, tampoco bloqueador) — el veredicto final, con el estado de esas tareas, se escribe en la sección de cierre.

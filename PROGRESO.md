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
| X2 · Sincronización incremental | ⏸ ABIERTA — documentada abajo, no bloquea el despliegue |
| W1 · Escala tipográfica | ✅ HECHA |
| W2 · Header con respiro | ✅ HECHA |
| W3 · Los tres botones del header | ✅ HECHA |
| W4 · No regresiones | ✅ HECHA |

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

### X2 · Sincronización incremental — ABIERTA (documentada, no ejecutada)

**No alcanzó el tiempo de este run — tal como el propio encargo lo permite explícitamente** ("Si no alcanza el run, déjala abierta con lo avanzado documentado — igual que hizo la ronda 5, que fue la decisión correcta"). El análisis de la Ronda 5 (`PROGRESO_R5.md` § V4) sigue siendo el punto de partida correcto y no cambió: el riesgo real no es el tamaño del payload sino el tiempo de ejecución — `appendNewRecords_`/`appendTombstones_` deduplican leyendo la columna A completa de cada hoja en cada push, un escaneo lineal que crece con todo el historial del negocio, contra el límite de 6 minutos de Apps Script.

Lo único nuevo que esta ronda agrega al análisis: **la superficie de riesgo creció con V0 y X0.** Cualquier rediseño del payload (pull con cursor, push incremental) tiene que convivir con dos contratos que ya están estables y verificados:
- `idsABorrar` (V0) — la lista explícita de borrados va DENTRO del mismo payload de push que X2 quiere hacer incremental. Si el push deja de mandar "todos los registros nuevos desde el cursor" y pasa a mandar algo distinto, `idsABorrar` tiene que seguir viajando igual (son cosas independientes: qué se agrega vs. qué se borra) — mezclarlas mal reabriría el bug de V0.
- `getAlarmSizeInfo`/fase (V1/X0) — mide el estado completo O el catálogo según la fase. Si "estado completo" deja de significar "toda la historia" y pasa a significar "lo nuevo desde el cursor", la medición en fase `pre`/`sin_confirmar` deja de ser conservadora (mediría de menos, exactamente el modo de falla que X0 acaba de cerrar).

**Regla que deja esta ronda para la que implemente X2**: los tests de V0 (`tests/sync.test.js` grupo "V0", `tests/rowsync.test.js` grupo "U1/V0") y de X0 (`tests/sync.test.js` grupo "V1 (Ronda 5) / X0 (Ronda 6)") tienen que seguir pasando **sin modificarse** — si hace falta tocarlos, es la señal de que el contrato se rompió y hay que entender por qué antes de seguir (criterio textual del encargo). No se tocó ninguno de los dos grupos en esta ronda salvo lo que X0 ya cambió por su cuenta (documentado en su propia sección arriba).

No se escribió ningún código de X2 esta ronda — ni el cursor en el pull, ni el índice de ids en Propiedades del script, ni el cambio del modelo de estado en memoria (colecciones que se paginan/cachean en vez de mandarse enteras) que el propio análisis de la Ronda 5 ya identificó como el verdadero tamaño del cambio. Queda para la próxima ronda, con el mismo punto de partida.

---

## Bloque W — Interfaz (pedido directo del dueño, uso en celular)

### W1 · Escala tipográfica — HECHA

**Inventario ANTES** (medido con `grep -o "font-size:\s*[0-9]*px"` sobre todo `index.html`, estilo y HTML inline juntos — 174 apariciones en 14 tamaños distintos, elegidos caso por caso):

| px | veces | px | veces | px | veces | px | veces |
|---|---|---|---|---|---|---|---|
| 9  | 1  | 13 | 17 | 17 | 2 | 22 | 2 |
| 10 | 6  | 14 | 9  | 18 | 2 | 26 | 1 |
| 11 | 37 | 15 | 16 | 20 | 9 | 28 | 1 |
| 12 | 61 |    |    |    |   |    |   |

Y `font-weight`: 94 apariciones en 3 valores (500 × 16, 600 × 69, 700 × 8, más una condicional `${d.esHoy ? 700 : 500}` en el calendario del dashboard).

**La escala, en `:root` (mobile-first) + un único `@media (min-width:861px)`** — el mismo breakpoint que ya usaba el resto del CSS para el cambio sidebar/dashboard, no uno nuevo:

```
--fs-display: 28px / 36px    --fs-h1: 22px / 28px    --fs-h2: 18px / 20px
--fs-h3: 16px / 17px         --fs-body: 15px          --fs-sm: 13px
--fs-xs: 11px                --fw-regular: 400 · --fw-medium: 500 · --fw-bold: 600
--lh-tight: 1.2 (display/títulos) · --lh-body: 1.5 (cuerpo, aplicado en `body{}`)
```

**Cómo se hizo la conversión** (documentado porque no fue 1:1 — el propio encargo pide "ajusta la escala si el inventario muestra que algo no encaja, documenta el cambio"):
1. **Mapeo por valor** para las 174 apariciones: cada tamaño literal se reemplazó por el token más cercano (9/10/11→xs, 12/13→sm, 14/15→body, 16/17→h3, 18/20→h2, 22→h1, 26/28→display) — un script sobre el archivo completo, no 174 ediciones manuales. El piso de 11px (`--fs-xs`) absorbe los 7 casos que estaban en 9-10px (insignias y unidades que rompían la regla de "nunca menos de 11px").
2. **Correcciones semánticas explícitas** sobre ese mapeo, donde el uso real no coincidía con el valor más cercano — la tabla del encargo nombra el rol, no el píxel:
   - `.item-name` (nombre de producto/fila): el valor más cercano a 14px daba `body`, pero la tabla nombra esto como ejemplo de `--fs-h3` — corregido.
   - `.field-label`, `.modal-field label` (etiquetas de campo): 11px mapeaba a `xs`, pero la tabla dice "etiquetas de campo" es `--fs-sm` — corregido.
   - `.field`, `.modal-field input/select`, `.ing-row input/select` (valores de formulario): 12px mapeaba a `sm`, pero la tabla dice "valores de formulario" es `--fs-body` — corregido (el texto que se escribe en un campo ahora es más grande y legible, cambio deliberado).
   - `.header-greeting`/`.header-date`, `.card-title`, `.page-title`, `.modal-title`: corregidos a `--fs-h1`/`--fs-h2` según la tabla ("título de sección" / "título de tarjeta o modal"), no al valor más cercano — ver también W2.
   - `.badge`/`.badge-outline`/`.kpi-label` ya caían en `--fs-xs` por valor Y por rol ("insignias", "metadatos") — sin corrección necesaria.
3. **Un solo `--fs-display` por pantalla, verificado**: el único candidato real en toda la app es `#costeo-bep-diario` (break-even diario, pestaña Costeo) — que ya estaba en 28px, el único valor de esa magnitud en las 174 apariciones. Los KPI del dashboard (4 tarjetas iguales) y las 6 cifras de "Cierre de caja" NO son `display` — son varias cifras iguales compitiendo, así que quedaron en `--fs-h2`/`--fs-body` respectivamente. Se eliminaron dos overrides de `font-size` por media query específicos de `.kpi-value` (uno en el layout compacto de 560px, otro en el dashboard de escritorio) que quedaron redundantes una vez que el propio token ya varía con el ancho — el encargo pide "un solo media query sobre las variables, no repitiendo reglas por componente".
4. **font-weight**: 500→`--fw-medium`, 600 y 700→`--fw-bold` (600 era ya el peso "bold" dominante de la app — 700 se normalizó a 600, una diferencia visual menor en los 8 casos que lo usaban, documentada en vez de mantener un cuarto token que el encargo no pedía).

**Bug encontrado de paso, corregido** (`applyUsuarioHeader_`): sin `nombre` (login por correo, no Google), `(user.nombre || user.email).split(' ')[0]` no encuentra ningún espacio en un correo y devuelve el correo COMPLETO como saludo — a `--fs-h1` (más grande que el `16px` de antes) esto desbordaba el header y se montaba sobre los tres botones. Corregido para usar la parte antes de la `@` cuando no hay nombre, y se agregó `overflow:hidden;text-overflow:ellipsis` a `.header-greeting`/`.header-date` como defensa adicional (cualquier nombre/fecha larga trunca con `…` en vez de desbordar, sin importar el ancho de pantalla).

**Suite completa: 348 tests** — sin cambios respecto a X1 (W1 es CSS/presentación, no lógica de negocio; ningún test nuevo aplica).

**Verificado en el navegador en 375px (móvil) y ancho de escritorio**: cero `font-size`/`font-weight` literales en todo `index.html` (confirmado con el mismo `grep` del inventario, cuenta en 0); un saludo largo ("Hola, cel…") y la fecha larga truncan con elipsis en vez de desbordar; una cifra en pesos grande ($128.450.000) no desborda ninguna tarjeta KPI ni el bloque de "Punto de equilibrio" en ninguno de los dos anchos — la cifra más larga que rompe contenedores angostos, verificada a propósito. Sin errores de consola.

### W2 · Header con respiro — HECHA

- **44px de área táctil mínima** en los tres botones (`.icon-btn`, `.avatar-ink`) — antes 34px. En escritorio bajan a 36px (un solo `@media (min-width:861px)`, no una regla por componente) — con mouse no hace falta el mismo mínimo que con el pulgar.
- **Espacio real entre los tres**: `gap` de `.header-right` de 10px a 14px en móvil (10px se mantiene en escritorio, donde los botones ya son más chicos y están más juntos por diseño).
- **Jerarquía saludo/fecha**: `.header-greeting` en `--fs-h1` (bold), `.header-date` en `--fs-sm` (color `--muted`) — exactamente la instrucción del encargo, no dos líneas del mismo peso.
- **Padding vertical**: de `16px 26px` (escritorio) que también se usaba en móvil a `18px` base + `calc(18px + env(safe-area-inset-top))` en el padding-top — el header ya no queda pegado al reloj/notch del sistema. En escritorio, un `@media (min-width:861px)` lo vuelve a bajar a `14px 26px` (más bajo y más ancho, como pide el encargo).
- Se eliminó un override de `.app-header{padding:12px 16px}` en el media query móvil viejo que habría pisado el padding nuevo (incluyendo el `safe-area-inset`) — quedaba de antes de este cambio y ya no correspondía.

**Verificado en el navegador en 375px**: los tres botones se ven claramente separados (no "un bloque"), cada uno mide 44×44px, nada tocando los bordes de la pantalla. En escritorio, header más bajo y compacto, botones de 36px.

### W3 · Los tres botones del header, con funciones distintas — HECHA

Los tres abrían exactamente lo mismo (`modal-ajustes`). Ahora cada uno abre algo distinto — todo el contenido ya existía, construido y verificado en rondas 3 a 5; esta tarea fue de organización y acceso.

**W3.1 · Engranaje → Ajustes.** Reorganizado en dos grupos visuales separados por un encabezado en mayúsculas:
- **Configuración**: Factor prestacional (ya existía, `cfg-factor-prestacional`) + **Clasificación fijo/variable de categorías de gasto (C4, ronda 1) — nueva pantalla**, no existía ninguna UI para editar `state.config.comportamientoCategorias` antes de esta ronda, solo el cálculo (`getComportamientoCategoria`/`getCostosFijosYVariables`). Las 7 categorías operativas (`CrumblyCore.GASTO_CATEGORIAS.operativo`) se listan con un selector Fijo/Variable/Mixto y, si es Mixto, un % — escribe directamente `state.config.comportamientoCategorias[categoria]`, el mismo campo que C4 ya lee; ninguna fórmula de costeo se tocó. + Correo de la marca (ya existía).
- **Diagnóstico del sistema**: Alarma de tamaño (con los tres estados de X0), Estado de la migración (U3), Reporte de integridad (T2.1) — sin cambios de contenido, solo el encabezado de grupo y el orden.
- La sección "Sincronización" (correo de sesión, estado del último sync, cerrar sesión) se MOVIÓ de acá al modal de Sesión — repetirla en los dos lugares no aportaba nada.

**W3.2 · Campana → Centro de alertas (`abrirCentroAlertas`, nuevo).** No existía — el punto rojo estaba siempre encendido sin ningún modal detrás, la app prometía algo que no cumplía. Reúne (`getAlertasCentro_`, NO recalcula nada nuevo) señales de: `getReporteIntegridad` (sin unidad, costo fuera de rango, stock con costo cero, stock negativo/faltante, ventas costo>total, productos costo>precio), `getVentasCostoInvalidoEnPeriodo`/V3.4 (vía el mismo reporte), la alarma de tamaño de X0, el conteo en progreso de T0.1 (`state.conteoEnProgreso`), los conflictos de catálogo de U4/V2 (`conflictosCatalogoPendientes`), y los borrados pendientes de V0 (`getBorradosPendientes`). Ordenadas por gravedad real, con una escala fija (1 = vender bajo costo o sincronización bloqueada, hasta 9 = borrados sin confirmar) — nunca por tipo de origen. Cada alerta trae su propia acción de navegación (`accion: () => {...}`) que cierra el modal, navega a la pantalla correcta, y abre exactamente el modal/registro que hay que corregir (`openModalProducto`, `openInsumoModal`, el modal de ventas inválidas de V3.4, el de conflictos de catálogo, o `openModalConteo`). El punto (`#alertas-punto`) se actualiza desde `refreshAll()` (`actualizarPuntoAlertas`) — aparece y desaparece según haya alertas reales, nunca queda encendido a secas. Sin botones de "arreglar todo": cada fila es un enlace a donde se corrige a mano, mismo principio que el reporte de integridad.
  - **Limitación aceptada, documentada** (ponytail): el borrado pendiente sin confirmar no tiene timestamp propio — cualquier borrado pendiente cuenta como alerta, sin medir "cuánto lleva". En la práctica se limpia en ~1 segundo (el siguiente push), así que el falso positivo transitorio es raro; cablear un "hace cuánto" solo para este caso no se justificaba.
- **W3.3 · Avatar → Sesión (`modal-sesion`, nuevo).** Correo de sesión, estado del último sync, cerrar sesión — el contenido que antes vivía en la sección "Sincronización" de Ajustes, movido tal cual (los mismos elementos `#ajustes-usuario`/`#sync-status` siguen actualizándose por el mismo código de siempre, solo cambiaron de contenedor). El botón menos usado de los tres — no se le agregó nada más, tal como pedía el encargo.

**Suite completa: 348 tests** — sin cambios (W3 es reorganización de UI + una pantalla de configuración nueva que solo lee/escribe un campo de config ya existente, sin lógica nueva que testear en Node).

**Verificado en el navegador**: los tres botones abren tres modales distintos (`modal-ajustes`, `modal-alertas`, `modal-sesion`), confirmado clic por clic. Se creó un producto vendiendo bajo costo y un insumo con costo sospechoso — el punto rojo se encendió, el centro de alertas mostró primero "Waffle Roto se vende BAJO COSTO" y después el insumo (severidad correcta), y hacer clic en la primera alerta cerró el modal, navegó a Productos, y abrió el modal de edición de ESE producto. Al borrar el producto y el insumo, el punto se apagó solo. La clasificación fijo/variable escribe y persiste correctamente (`Transporte` → Mixto 40% verificado contra `getComportamientoCategoria`). Sin errores de consola.

### W4 · No regresiones — HECHA

Recorrido completo en 375px y escritorio: Dashboard (resumen + Costeo), Caja, Inventario (los cuatro buckets: materia, empaques, toppings, preparaciones), Productos (incluido el desglose de costo de V3.1), Clientes, conteo físico, y los tres modales del header. Ninguna pantalla quedó con texto desbordado, cortado o solapado — el único desborde real que apareció (el saludo del header con un correo largo) se encontró y se corrigió como parte de W1/W2, no se dejó pasar. Una cifra en pesos de 9 cifras ($128.450.000) se probó a propósito en los KPI del dashboard y en el bloque de Costeo, en los dos anchos, sin romper ningún contenedor. Los flujos verificados en rondas anteriores (registrar venta, desglose de costo, franja de V3.4, alarma de tamaño con sus tres estados) siguen funcionando igual — ninguna función de cálculo se modificó en todo el bloque W.

---

## Riesgo conocido, fuera de alcance (anotado para que no se descubra dos veces)

**Las transacciones son append-only y autoritativas, pero el inventario vive en el catálogo, que se fusiona.** Si un dispositivo borra un gasto (revirtiendo el inventario que ese gasto había movido) y otro dispositivo había editado ese MISMO insumo mientras tanto, se genera un conflicto de catálogo (U4/V2) — y si la persona elige "Mantener el mío" en ese conflicto, la reversión de inventario que el borrado del gasto quería aplicar se descarta, mientras que la lápida del gasto (V0) queda firme igual (son mecanismos independientes: la lápida vive en la hoja append-only, el inventario vive en el catálogo fusionado). El resultado es un inventario que no refleja exactamente lo que las transacciones dicen que debería, sin que nada lo señale como error.

**No es urgente**: el conteo físico (T0.1) corrige cualquier desviación de inventario por diseño — es precisamente su función, y ya existe. No se propone ningún arreglo en esta ronda. Se anota acá para que la próxima auditoría (o esta misma, más adelante) no lo vuelva a descubrir de cero.

---

## Pasos manuales del despliegue de T1 (los ejecuta una persona, no esta sesión)

Actualizado de la Ronda 5 con lo que cambió X0: la alarma del cliente ya NO bloquea sobre una fase sin confirmar (antes sí, ese era el bug de X0) — así que el orden backend-antes-que-cliente es ahora una buena práctica, no una red de seguridad de la que depender. Sigue siendo el orden recomendado.

1. **Respaldo del Sheet real.** Archivo → Hacer una copia (o descargar como .xlsx) del Sheet de producción completo, ANTES de tocar nada. El único paso no automatizable y el más importante: si algo sale mal después, este respaldo es la forma de volver atrás.

2. **Inspeccionar las hojas `ventas`, `gastos` y `mermas` del Sheet real (U2, Ronda 4).** Abrir cada una y mirar la fila 1 (cabecera) y una fila de datos cualquiera:
   - Si están vacías, o ya tienen la cabecera `[id, fecha, supersedesId, json]` → no hace falta nada, seguir al paso 3.
   - Si tienen datos con OTRA forma (el formato viejo real: `ventas` con columnas como `id, fecha, total, ganancia, stockInsuficiente, clienteId`) → **archivar esas tres hojas con otro nombre** antes de continuar (recomendado: `ventas_legado_pre_migracion`, etc. — razonamiento completo en `PROGRESO_R4.md` § U2). `migrarAAppendOnly()` va a abortar solo y sin tocar nada si este paso se saltea y el formato no calza — pero es más barato confirmarlo ahora que leyendo el mensaje de error.

3. **Desplegar `backend/Code.gs` actualizado PRIMERO** (Extensiones → Apps Script → pegar el contenido de este archivo → Guardar → Implementar → Nueva implementación). Confirmar que el despliegue apunta al mismo Sheet real de siempre (`CRUMBLY_SHEET_ID` en las Propiedades del script no cambia). **Este backend incluye V0 (lápidas explícitas por lista, sin la guarda de ausencia) — es el que cierra el bloqueador original.**

4. **Correr `migrarAAppendOnly()` una sola vez**, a mano, desde el editor de Apps Script (elegir la función en el desplegable de arriba → ▷ Ejecutar). Mirar el resultado:
   - `{ok:false, error:'FORMATO_HOJA_INVALIDO', problemas:[...]}` → alguna hoja del paso 2 no se resolvió bien. Nada se tocó — corregir esa hoja puntual y volver a correr.
   - `{ok:false, reporte:{...}}` con algún `coincide:false` → los conteos no cuadraron en alguna colección. Nada se tocó (la celda vieja sigue intacta) — no seguir sin entender por qué antes de reintentar.
   - `{ok:true, reporte:{...}}` con las 6 colecciones en `coincide:true` → la migración salió bien. La celda quedó reducida al catálogo.

5. **Recién ahora, desplegar el frontend nuevo** (GitHub Pages, `git push`). Este frontend incluye X0 y X1 — la alarma no bloquea más sobre una fase sin confirmar, y todo borrado append-only pasa por la guarda estructural.

6. **Verificar que salió bien, con datos reales**:
   - Abrir la app normal y confirmar que las ventas/gastos/mermas/etc. de siempre se siguen viendo exactamente igual.
   - En el Sheet, confirmar que `state_json!A1` ahora es un JSON mucho más chico (solo catálogo) y que las hojas append-only tienen filas nuevas con el formato `[id, fecha, supersedesId, json]`.
   - Abrir Ajustes → Diagnóstico del sistema: "Migración a filas append-only" debería mostrar fase POST y la corrida recién hecha con veredicto OK; "Alarma de tamaño" debería mostrar **🟢 Fase confirmada: POST-migración** (los tres estados de X0 — si en cambio muestra "⚪ Fase SIN CONFIRMAR", revisar que el backend nuevo esté de verdad desplegado y que la sesión tenga acceso a `migrationStatus`).
   - Registrar una venta de prueba real (una, chica, que se pueda borrar después) y confirmar que aparece como fila nueva sin reescribir toda la hoja.
   - **Borrar esa venta de prueba y sincronizar** — confirmar que no vuelve al recargar (V0/X1). Si hay un segundo dispositivo a mano, confirmar además que sincronizar algo DISTINTO desde ese segundo dispositivo (sin haber hecho pull primero) no revive nada del primero — el escenario exacto que V0 corrigió y X1 dejó imposible de romper de nuevo por accidente.
   - Abrir los tres botones del header (engranaje, campana, avatar) y confirmar que cada uno muestra algo distinto (W3) — si el centro de alertas muestra alguna alerta real (costo sospechoso, producto bajo costo, etc.), es información real del negocio, no un bug de este despliegue.

7. **Recién después de todo lo anterior**, este despliegue queda considerado terminado. X2 (sincronización incremental) sigue abierta y no bloquea nada de lo anterior — es trabajo de una ronda futura, sobre el mismo payload que este despliegue ya deja funcionando.

---

## Veredicto: ¿se puede desplegar T1?

**Sí — X0 y X1, los dos bloqueadores que señaló esta ronda, quedaron cerrados y verificados, cada uno por separado, en el orden que exigía el encargo.**

- **X0 cerrado**: la fase de la migración se persiste confirmada en `localStorage` (no en una variable de módulo que se perdía en cada carga de página) y la alarma de tamaño solo bloquea con esa fase confirmada — sin confirmar, advierte pero el push siempre procede. Verificado reproduciendo el bug exacto (un estado de 50.189 caracteres sin fase confirmada dejó pasar el push) y confirmando que un reload real no reabre la ventana de incertidumbre.
- **X1 cerrado**: inventario completo de los seis caminos de borrado append-only — cuatro con función de borrado real (ventas, gastos, mermas, lotes), dos sin ninguna (snapshots, ajustes, nada que cablear). Guarda estructural en dos mitades (`quitarRegistro_` en core.js, `borrarConSync_` en index.html) respaldada por dos tests que leen el código fuente y fallan si algún camino nuevo se salta la única función de cada lado. Verificado con el ciclo completo borrar → push → pull → reload en las cuatro colecciones reales.
- **X2 quedó abierta, documentada, y NO es bloqueador** — el propio encargo la excluye del criterio de despliegue, igual que hizo con V4 en la Ronda 5. El riesgo que resuelve (tiempo de ejecución de Apps Script creciendo con el historial) no es urgente con el volumen actual del negocio, y los contratos de V0/X0 que tendría que respetar quedaron documentados para la ronda que la retome.
- **El bloque W (interfaz) no era bloqueador** (el encargo no lo menciona como criterio de despliegue) pero también quedó cerrado, verificado en dos anchos de pantalla, y no tocó ninguna lógica de negocio ni fórmula de costeo — puede desplegarse en el mismo `git push` que X0/X1 sin ningún paso adicional.

El único paso que falta es humano y está fuera del alcance de esta sesión: alguien tiene que hacer el respaldo, inspeccionar el Sheet real, desplegar el backend (X0/X1 del lado del cliente no dependen de esto, pero V0/U2 sí) y correr la migración de verdad — ver la sección de pasos manuales arriba, en el orden exacto.

No se hizo merge a main. No se desplegó al Apps Script de producción. No se corrió `migrarAAppendOnly()` contra el Sheet real en ningún momento de esta ronda.

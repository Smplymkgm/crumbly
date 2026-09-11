# Progreso — Ronda 7 (Y0 factor 100 + interfaz)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md` a `PROGRESO_R6.md`. Encargo completo: `/Users/mike/Downloads/PROMPT_RONDA7.md`.

**X0 y X1 (Ronda 6) quedaron bien cerrados. T1 se puede desplegar** — el despliegue es un paso humano, aparte de estas sesiones.

Esta ronda tiene dos orígenes distintos: **Y0**, un bug de cálculo real encontrado depurando producción a mano en la consola (el primero que toca el motor de cálculo en siete rondas), y el **bloque Z**, interfaz pedida directamente por el dueño usando la app en su celular.

**Restricciones no negociables de esta ronda:**
- No se despliega al Apps Script de producción. No se corre `migrarAAppendOnly()` contra el Sheet real. No se tocan datos reales — el dueño está corrigiendo recetas a mano en la app mientras esta sesión trabaja.
- Y0 va primero, commiteado y verificado, antes de cualquier otra cosa.
- X2 (sincronización incremental) sigue fuera de alcance — dos rondas abierta y documentada, no se retoma en esta.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| Y0 · Factor 100 en el modo porcentaje | ✅ HECHA |
| Y1 · Pantalla de aportes (qué componente rompe un producto) | ✅ HECHA |
| Z1 · Filtros colapsables | ✅ HECHA |
| Z2 · Buscador en Inventario | ✅ HECHA |
| Z3 · Preparaciones como cuarto botón de tipo | ✅ HECHA |
| Z4 · Preparaciones editables desde su lista | ✅ HECHA |
| Z5 · Cerrar modales al tocar fuera | ✅ HECHA |
| Z6 · No regresiones | ✅ HECHA |

## Detalle por tarea

### Y0 · Factor 100 en el modo porcentaje — HECHA

**El bug, exacto**: `gramosDeComponentePreparacion(prep, c)` — la función que resuelve cuántos gramos representa un componente de una preparación en modo `'porcentaje'` — calculaba `baseGramos × porcentaje` sin dividir por 100. Porcentaje panadero real: 100% de la base = `baseGramos` gramos, no `baseGramos × 100`. Medido contra la preparación real "Malteada frutos rojos" (`baseGramos: 200`, porcentajes 200/110/50/60, que suman 420%): el bug daba `gramosTotal: 84.000`; el correcto es `200 × 420 / 100 = 840`. Factor 100 exacto, en toda la escala absoluta.

**Por qué sobrevivió a seis rondas de auditoría — la parte que importa**: el error infla los gramos de CADA componente y el `gramosTotal` en el mismo factor. La composición por gramo (`gramos del componente / gramosTotal`, que es lo que de verdad alimenta el costeo de productos) es un COCIENTE entre dos cantidades igualmente infladas — el 100 se cancela ahí, y el costo por gramo sale exacto de todas formas. Verificado en producción antes de tocar nada: dos versiones de la misma receta (una en modo porcentaje dando 84.000g, otra en modo directo dando 440g) devolvían **$10,4454/g las dos** — el mismo costo por gramo, pase lo que pase con la escala absoluta. Todas las auditorías anteriores (costeo, margen, food cost) pasan por ese cociente, nunca por una cantidad absoluta — por eso nunca lo vieron.

**El arreglo — una sola línea, en `js/core.js`**:
```js
function gramosDeComponentePreparacion(prep, c) {
  return prep.modo === 'directo'
    ? (Number(c.gramos) || 0)
    : (Number(prep.baseGramos) || 0) * (Number(c.porcentaje) || 0) / 100;  // ← la división que faltaba
}
```

**Ninguna migración de datos** — tal como exigía el encargo. Los porcentajes guardados (200, 110, 50, 60...) están bien tal como están; lo que estaba mal era el cálculo que los leía. Dividir por 100 en la lectura hace que esos mismos números guardados produzcan el resultado correcto — no se tocó ni un solo registro de `state.preparaciones`.

**Inventario de qué heredaba el bug** (las cinco funciones que el encargo pidió revisar — `gramosDeComponentePreparacion` tiene exactamente 4 llamadores en todo `core.js`, verificado con `grep`):

| Función | ¿Heredaba el bug? | Por qué |
|---|---|---|
| `getPreparacionComposicionPorGramo` | **No** — el resultado final (composición por gramo) ya era correcto | Usa `gramosDeComponentePreparacion` tanto para `gramosTotal` como para el gramaje de cada componente — los dos escalan igual, y el cociente que devuelve (`porGramo`) se queda invariante. Esto es lo que costoPorGramo consume, y por eso nunca se vio el bug en ningún costeo. |
| `getPreparacionCosto` | **Sí, parcialmente** — `gramosTotal`/`gramosObtenidos`/`costoTotal` SÍ estaban inflados 100×; `costoPorGramo` NO (viene de la función de arriba) | Recalcula `gramosTotal` una SEGUNDA vez, de forma independiente (línea aparte, no reusa la composición), con la misma llamada rota. Con el arreglo, las cuatro cifras que devuelve quedan correctas — `costoPorGramo` no cambia de valor, las otras tres sí. |
| `producirPreparacion` (T3, ronda 3) | **Sí, directo** — este es el que de verdad mueve inventario | Construye `resueltos[].gramos` llamando a `gramosDeComponentePreparacion(prep, c) * multiplicador` sin ningún cociente que cancele nada — el 100× pasaba derecho al descuento real de materia prima y al crédito de stock WIP. |
| `getConsumoTeoricoLote` (la vista previa de producción) | **Sí, directo** — misma construcción que `producirPreparacion`, línea por línea | Mismo patrón exacto: `gramosDeComponentePreparacion(prep, c) * multiplicador`, sin cociente. La vista previa mostraba 84.000g donde debía mostrar 840 — y si alguien hubiera confiado en ese número para escribir "gramos obtenidos", el bug se habría propagado al dato medido también. |
| `aplicarComponentes` | **No** | No llama a `gramosDeComponentePreparacion` en absoluto — opera sobre gramos YA resueltos (`c.gramos`, siempre un valor absoluto literal, nunca un porcentaje) que le pasan sus llamadores. Cuando un componente de PRODUCTO es de tipo `preparacion`, expande vía `expandGramosAMateria` → `getPreparacionComposicionPorGramo` (la función de arriba, que ya era correcta). |
| `getConsumptionRolling` | **No** | Vía `consumoTeoricoDeVentas` → `aplicarComponentes(..., {modo:'crudo'})` sobre los `componentes` de un PRODUCTO (que siempre tienen `.gramos` literal, nunca modo porcentaje — el modo porcentaje es un concepto exclusivo de preparaciones) — mismo camino correcto que el punto anterior. |

**Bug de copia encontrado de paso, corregido**: el texto de ayuda del modal de preparación decía "el componente que sea el 100% va con porcentaje 1" (notación de fracción) y el placeholder de cada componente decía "% (ej: 0.2)". Pero en producción el 100% real quedó guardado como 200/110/50/60 — números de porcentaje completos, no fracciones: quien llenó la receta escribió lo natural para un campo llamado "porcentaje", no lo que decía el texto. Antes del arreglo, el cálculo no dividía por nada, así que arrastraba lo que fuera que se guardara sin corregirlo — con números de porcentaje completos, esa falta de división es exactamente el factor 100 de este bug. Corregidos el cálculo y el texto juntos, para que los dos coincidan con cómo se usa el campo de verdad (era necesario: dejar el texto viejo pidiendo fracciones, con el cálculo ya corregido, habría producido un TERCER resultado erróneo — 100× demasiado chico — para cualquiera que sí siguiera esa instrucción).

**Cuántas preparaciones reales están en modo porcentaje**: el propio encargo lo da medido — 8 de las 9 preparaciones de producción están en modo `directo` (no afectadas). La única en modo `porcentaje` es "Malteada frutos rojos", la preparación que originó este hallazgo — 1 de 9, y esa una SÍ estaba afectada (100% de las preparaciones en modo porcentaje que existen, afectadas). No se pudo verificar contando directamente sobre el estado real (esta sesión no toca datos reales, por regla) — la cifra es la que trae el propio encargo.

**Tests** (`tests/core.test.js`, grupo "Y0"): la receta EXACTA de producción (`baseGramos:200`, porcentajes 200/110/50/60) → `gramosTotal: 840`; el costo por gramo NO cambia con el arreglo (comparado con el valor calculado a mano, y la composición por gramo sigue sumando 1); producir un lote con multiplicador 1 descuenta 400g de leche y 220g de fresa (no 40.000/22.000); `getConsumoTeoricoLote` (la vista previa) también da 840g; **no-regresión explícita en modo directo** — una preparación directa da el mismo `gramosTotal`/`costoPorGramo`/vista previa antes y después (no se tocó esa rama, y este test lo prueba en vez de asumirlo). Dos tests YA EXISTENTES de rondas anteriores (`masa New York`, `ganache`) fallaron al aplicar el arreglo — sus fixtures declaraban `porcentaje` como FRACCIÓN (1.0, 0.15, 0.36...), una convención que solo "funcionaba" porque cancelaba el mismo bug que esta ronda corrige. Se corrigieron los fixtures a la escala real (100, 15, 36...) — los valores esperados (583,44g, $7.269,15, 240g) no cambiaron, porque siempre fueron los números correctos; solo estaba mal la escala del dato de entrada del test, no la expectativa.

**Suite completa: 353 tests** (auth 10, core 263, rowsync 39, sync 41) — medido corriendo los cuatro archivos.

**Verificado en el navegador** (mock backend local en `localhost:8802`, cero contacto con `script.google.com`): se creó la preparación real "Malteada frutos rojos" (`baseGramos:200`, componentes 200/110/50/60) — la lista de Preparaciones mostró **"840g totales"** (no 84.000). Se abrió "Producir lote" con tamaño de lote 1: la vista previa mostró **"Gramos teóricos de la receta: 840.00 g"** y el desglose correcto (Leche 400ml, Fresa 220g, Azúcar 100g, Hielo 120g — 200/110/50/60% de 200g). Se produjo el lote de verdad con la función real de la UI (`producirLoteUI`): la materia prima se descontó exactamente 400g de leche y 220g de fresa — la escala real de inventario, no la inflada. Sin errores de consola.

---

## Veredicto sobre Y0: ¿queda cerrado, y es seguro usar producción de lotes y contar WIP?

**Sí — el factor 100 quedó cerrado en las dos funciones que lo heredaban de verdad (`producirPreparacion`, `getConsumoTeoricoLote`) y en las cifras de `getPreparacionCosto` que lo heredaban parcialmente (`gramosTotal`/`gramosObtenidos`/`costoTotal` — no `costoPorGramo`, que ya era correcto). Las dos funciones que NO lo heredaban (`getPreparacionComposicionPorGramo`, y por transitividad `aplicarComponentes`/`getConsumptionRolling`) se confirmaron sin cambios de comportamiento — el costo por gramo es idéntico antes y después, con test explícito.**

- **La producción de lotes ya es segura de usar** para preparaciones en modo porcentaje: la vista previa y el descuento real de materia prima ahora coinciden con la receta real (840g, no 84.000g), verificado en el navegador con la función real de producción.
- **El conteo físico de WIP ya es seguro de hacer** para preparaciones en modo porcentaje: el teórico contra el que se compararía un conteo (`gramosTotal`/`getConsumoTeoricoLote`) ya no está inflado 100× — antes de este arreglo, cualquier varianza de preparaciones habría sido matemáticamente sin sentido para la única preparación en modo porcentaje ("Malteada frutos rojos").
- **El modo directo (8 de las 9 preparaciones reales) nunca estuvo roto y sigue sin tocarse** — confirmado con un test de no-regresión dedicado, no solo por inspección del diff.
- **No bloqueaba el despliegue de T1 y no corrompió ninguna venta registrada** — tal como adelantaba el propio encargo: el costeo de productos, el margen y el food cost pasan por el cociente que cancela el bug, nunca por la cantidad absoluta.

Con esto, el conteo físico de preparaciones (WIP) queda habilitado para usarse con confianza — era la condición que ponía el encargo antes de dar por cerrado Y0.

### Y1 · Pantalla de aportes: qué componente rompe un producto — HECHA

**El problema real que originó esta tarea**: todo el diagnóstico que encontró los problemas reales de costeo de esta auditoría (Leche cargada a $3.550/g — el precio de la caja completa, no el costo por gramo; Crema de leche al doble; cuatro gramajes de dedo repetido) se hizo corriendo un script a mano en la consola del navegador, después de que ninguna de las guardas construidas en seis rondas lo hubiera detectado. Por qué: `checkCostoSospechoso` compara un insumo contra la mediana de los insumos de SU MISMA `unidad` — Leche, declarada en su propia unidad, nunca se comparó contra insumos en gramos, así que jamás pareció "fuera de rango". Y `getReporteIntegridad`/las insignias de V3.2 dicen que un producto cuesta más de lo que se vende, pero nunca dicen CUÁL componente es el culpable — hay que ir a mirar la receta a mano.

**La señal que sí funciona**: el aporte del componente al costo, comparado contra el PRECIO DE VENTA del producto — no contra la mediana del inventario, no contra la unidad declarada. Es exactamente el criterio que el script de la consola aplicaba a mano.

- **`getAportesComponentes(state, productoId)`** (`js/core.js`) — envuelve `getDesgloseCostoProducto` (V3.1), **reusando el mismo recorrido en vez de duplicarlo** (tal como exigía el encargo): agrega `aporteAbsoluto` (alias de `subtotal`) y `pctDelPrecio` (aporte ÷ precio de venta del producto, `null` si el producto no tiene precio — nunca división por cero). Para componentes de tipo preparación, el costo unitario ya salía de `getPreparacionCosto` dentro de `getDesgloseCostoProducto` — no hizo falta tocar nada ahí.
- **`getProductosConAporteAnomalo(state, umbral=0.5)`** — recorre TODOS los productos y devuelve, por cada uno, los componentes cuyo `pctDelPrecio` supera el umbral (50% por defecto). Es el script de la consola, convertido en función — ordenado por el peor aporte primero, excluye productos sin precio de venta (el % no tiene contra qué compararse ahí).
- **Integración con el desglose de V3.1** (`abrirDesgloseCosto`, `index.html`): la función ahora usa `getAportesComponentes` en vez de `getDesgloseCostoProducto` directamente (mismos datos, con el campo nuevo) — cada línea muestra su % del precio de venta además del % del costo total que ya mostraba, y las líneas que superan el umbral (50%) se resaltan igual que las de costo sospechoso.
- **Integración con el centro de alertas (W3.2, Ronda 6)**: `textoAporteCulpable_(productoId, nombre, fallback)` — nueva función que busca el componente con mayor aporte (ya viene ordenado) y arma el texto de la alerta con su nombre y aporte, en vez de solo nombrar el producto. La alerta de "producto por debajo del costo" pasó de `"Waffle caramel" se vende BAJO COSTO — costo $710.500, precio $20.000` a `Waffle caramel: Leche aporta $710.000 (3550% del precio)` — verificado exacto contra el ejemplo del encargo. **Se agregó además una categoría de alerta que no existía**: "costo mayor al 60% del precio" (el mismo umbral que ya usaba la insignia ámbar de V3.2 en Productos, pero que hasta esta ronda solo era una insignia visual — no generaba ninguna alerta, había que ir a Productos a verla).
- **Acceso desde el reporte de integridad de Ajustes**: nueva fila "Componentes que aportan más del 50% del precio de venta (Y1)" en `renderReporteIntegridad`, listando `getProductosConAporteAnomalo(state)` del menú completo de una sola vez — la versión de pantalla del script, tal como pedía el encargo.

**Tests** (`tests/core.test.js`, grupo "Y1"): la suma de los aportes coincide EXACTAMENTE con `getCostoProducto` (mismo criterio que V3.1); `pctDelPrecio` es el aporte sobre el PRECIO, no sobre el costo total (a propósito distinto de `pctDelTotal` de V3.1 — test que compara los dos denominadores contra el mismo fixture); un componente que aporta más del 100% del precio de venta se señala y se nombra correctamente (`lineas[0].nombre`, heredado del orden descendente de V3.1); producto sin precio de venta da `pctDelPrecio: null` en todas las líneas, nunca `NaN`/`Infinity`; `getProductosConAporteAnomalo` encuentra el componente anómalo con el producto y el % correctos; respeta un umbral explícito y excluye productos sin precio.

**Suite completa: 359 tests** (auth 10, core 269, rowsync 39, sync 41) — medido corriendo los cuatro archivos.

**Verificado en el navegador** (mock backend local en `localhost:8802`, cero contacto con `script.google.com`): se creó "Waffle caramel" (precio $20.000) con Leche a $3.550/ml (200 unidades → $710.000) y Harina normal — el modal de desglose de V3.1 mostró la línea de Leche resaltada en rojo con **"3550% del precio ⚠"** (Harina, normal, "3% del precio" sin resaltar); el centro de alertas mostró exactamente **"Waffle caramel: Leche aporta $710.000 (3.550% del precio)"**, y hacer clic en la alerta navegó a Productos y abrió el modal de edición de ESE producto; Ajustes → Reporte de integridad mostró la nueva fila "Componentes que aportan más del 50% del precio de venta (Y1)" con la misma línea. Sin errores de consola.

---

## Bloque Z — Interfaz, segunda tanda (pedido directo del dueño, uso en celular)

Mismas reglas que el bloque W (Ronda 6): ninguna lógica de negocio ni fórmula de costeo/margen/varianza se tocó en todo este bloque — todos los cambios son de `index.html` (markup + funciones de UI), salvo donde se indica lo contrario.

### Z1 · Filtros colapsables — HECHA

- **Movimientos (Caja) ya tenía el patrón correcto** (botón embudo + contador de filtros activos, panel colapsado por defecto) — no se tocó, sirvió de referencia.
- **Inventario no lo tenía**: tipo y categoría estaban siempre desplegados, dos filas completas antes de ver el primer insumo. Ahora: un botón embudo + `#inv-filtros-activos` (mismo patrón visual que Caja) despliega/colapsa `#inv-filtro-panel` (tipo + categoría + buscador), colapsado por defecto (`invFiltroPanelOpen = false`). El contador de filtros activos (`toggleInventarioFiltros`/`renderInventario`) se calcula sin necesidad de abrir el panel — cuenta tipo≠todos, categoría≠todos (solo si aplica) y búsqueda no vacía.
- **"Las categorías, también desplegables" — un segundo nivel de colapso**, separado del panel general, en los DOS lugares que la mostraban siempre:
  - Inventario: la fila "Categoría" dentro del panel de filtros tiene su propio toggle (`toggleInventarioCategoriaPanel`, caret que rota) — las categorías (10 en el estado real) solo se ven si alguien las despliega a propósito.
  - El modal de editar insumo: `#ins-categorias-chips` (las mismas 10 categorías) pasó de mostrarse siempre a un botón "Ver categorías existentes ⌄" colapsado por defecto — se recolapsa cada vez que el modal se abre, sin importar cómo quedó la vez anterior.
- El selector de categoría del modal de PRODUCTOS no se tocó — el encargo solo nombra Inventario y el modal de insumo como los dos lugares con el problema (categorías de producto son unas pocas, no diez).

### Z2 · Buscador en Inventario — HECHA

- Campo de búsqueda por nombre (`#inv-buscador`, `setInventarioBusqueda`) en la cabecera de Inventario, filtra en vivo (`oninput`) — se combina con los filtros de tipo/categoría existentes (`renderInventario` aplica los tres `.filter()` en cadena), no los reemplaza. Cuenta como un filtro activo más para el contador de Z1.
- Aplica igual a la vista de insumos y a la de preparaciones (Z3) — ambas ramas de `renderInventario` filtran por `nombre.toLowerCase().includes(busq)`.
- Resultado vacío: mensaje explícito con el término buscado ('Ningún insumo coincide con "…"' / 'Ninguna preparación coincide con "…"'), no una lista en blanco sin explicación.

### Z3 · Preparaciones como cuarto botón de tipo — HECHA

- **Preparaciones** es ahora un valor más de `insInventarioTipo` (`'preparaciones'`), listado en `inv-chips-tipo` al mismo nivel que Todos/Materia prima/Empaque/Toppings — ya no hay que desplazarse hasta el final de la página para llegar a ellas.
- Cuando este tipo está activo: la fila de categoría se oculta (una preparación no tiene `categoria` — es una sub-receta, no un insumo con receta de compra), y el botón de acción de la cabecera cambia de "Agregar insumo" a "Agregar preparación" (`setInventarioTipo` reescribe el texto y el `onclick` del botón).
- Respeta el buscador de Z2 (por nombre) — el filtro de categoría no aplica a este tipo, tal como pide el encargo ("que respete... y el filtro de categoría": respetarlo acá significa no ofrecerlo donde no tiene sentido, no forzarlo).
- **La sección separada "Preparaciones" (con su propia card y botón "Agregar preparación") se eliminó** — quedaba duplicada con el nuevo tipo unificado, y mantener las dos habría dejado dos lugares con la misma información pudiendo desincronizarse. `renderPreparaciones()` (con sus seis llamadores existentes — guardar/borrar preparación, producir/eliminar lote) se convirtió en un alias de una línea que llama a `renderInventario()`: ningún llamador existente necesitó cambiar.

### Z4 · Preparaciones editables desde su lista — HECHA

- Cada fila de preparación (dentro del tipo "Preparaciones" de la lista unificada) abre `openModalPreparacion(id)` al tocar la fila completa — mismo patrón que las filas de insumos (`cursor:pointer`, caret `›` a la derecha). Los botones de acción propios de la fila (producir lote, eliminar) siguen funcionando por separado, con `event.stopPropagation()` para que tocarlos no dispare TAMBIÉN la apertura del modal de edición.
- El stock WIP (`cantidad`) ya se mostraba en la fila desde T3 (Ronda 3) — confirmado que sigue apareciendo, sin cambios en ese dato.
- El `gramosTotal` de la fila ya muestra el valor corregido por Y0 (840g, no 84.000g) — automático, sin tocar la fila: viene de `getPreparacionCosto`, que Y0 corrigió en su fuente.

### Z5 · Cerrar modales al tocar fuera — HECHA

- **Un solo manejador**, delegado en `document`, para TODOS los modales de la app — no una copia por modal. Se dispara solo cuando `e.target` es el propio `.modal-overlay` (el fondo oscuro) y no un descendiente — un clic dentro de `.modal` nunca cierra nada, porque el target ahí es un hijo, no el overlay.
- **Excepciones, tal como exigía el encargo** — piden confirmación (nunca cierran directo):
  - `modal-conteo` (conteo físico en progreso).
  - `modal-insumo`, solo si hay cambios sin guardar — se compara un snapshot de los campos tomado al abrir el modal (`snapshotInsumoModal_`/`hayCambiosSinGuardarInsumo_`) contra el estado actual; si no cambió nada, cierra directo sin preguntar.
  - `modal-venta`, solo si el carrito tiene algo (`ventaCart.length`).
  - `modal-conflictos-catalogo`: **nunca** se cierra por toque fuera, ni con confirmación — hay que resolver cada conflicto o usar la X. No tiene un "cancelar" que tenga sentido (los conflictos no desaparecen si se ignoran).
- La X se deja exactamente donde estaba en los seis casos — sigue cerrando sin condiciones.

### Z6 · No regresiones — HECHA

Recorrido completo en 375px y escritorio: Dashboard (Resumen y Costeo, con una cifra de 9 dígitos para probar overflow), Caja con sus filtros (sin cambios, sirvieron de referencia para Z1), Inventario con los cinco botones de tipo + buscador + filtros colapsados, Productos con el desglose de V3.1 y los aportes de Y1, Clientes, conteo físico (abierto, con la guarda de Z5 probada), producción de lotes (probado en Y0 y de nuevo acá vía la fila de preparación), y los tres modales del header de W3 (Ajustes/Alertas/Sesión). Se confirmó explícitamente que el cierre por toque fuera NO se dispara en ninguno de los cuatro modales con datos sin guardar (los cuatro probados uno por uno, con y sin cambios reales) y que sí cierra normalmente en un modal sin ese riesgo (Ajustes). Sin errores de consola en ningún paso, cero contacto con `script.google.com`.

**Suite completa: 359 tests** (auth 10, core 269, rowsync 39, sync 41) — sin cambios respecto a Y1: todo el bloque Z es interfaz (markup + funciones de `index.html`), sin lógica nueva que testear en Node.

---

## Cierre del run

**Suite completa, medida corriendo los cuatro archivos justo antes de escribir esta sección: 359 tests.**

| Archivo | Tests |
|---|---|
| `tests/auth.test.js` | 10 |
| `tests/core.test.js` | 269 |
| `tests/rowsync.test.js` | 39 |
| `tests/sync.test.js` | 41 |
| **Total** | **359** |

Todas las tareas de esta ronda (Y0, Y1, Z1–Z6) quedaron cerradas, verificadas en el navegador donde correspondía, y commiteadas por separado. El veredicto sobre Y0 — el único criterio de esta ronda que condiciona si el conteo físico de WIP puede hacerse con confianza — está en la sección de Y0 arriba: **sí, cerrado en las funciones que lo heredaban, con no-regresión confirmada en modo directo.**

No se hizo merge a main. No se desplegó al Apps Script de producción. No se corrió `migrarAAppendOnly()` contra el Sheet real en ningún momento de esta ronda. Ningún dato real se tocó — el dueño siguió corrigiendo recetas a mano en la app mientras esta sesión trabajaba, tal como advertía el encargo.

# Progreso — Ronda 9 (B0 corrección de A3 + B1 guarda + B2 flujo en la app)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md` a `PROGRESO_R8.md`.

**A0, A1, A2 y A3 (Ronda 8) quedaron cerrados.** Pero la Ronda 8 entregó capacidad y diagnóstico dejando el trabajo real en manos del dueño, y ese reparto no funcionaba: eran 4 pares de duplicados y 5 reclasificaciones, cada una con recetas detrás, hechas de una en una desde un modal — exactamente el tipo de tarea repetitiva donde un error rompe un costeo en silencio.

Esta ronda cierra el hueco: primero un supuesto de A3 que no se cumplía en los datos reales (B0), después la guarda que ese hallazgo exponía como necesaria (B1), y por último el flujo que hace el trabajo dentro de la app en vez de dejarlo como deber (B2).

**Restricciones de esta ronda:**
- No se desplegó al Apps Script de producción. No se corrió ninguna migración contra el Sheet real. Todo se probó contra el mock del backend y con estados de prueba construidos a mano, replicando la estructura real descrita en la misión — nunca con datos reales.
- B0 se hizo primero (invalida un supuesto sobre el que B1 y B2 se construyen).
- X2 (sincronización incremental) sigue fuera de alcance — cinco rondas abierta y documentada.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| B0 · Los empaques entran a las recetas por dos caminos | ✅ HECHA |
| B1 · Guarda contra el costeo en cero | ✅ HECHA |
| B2 · Hacer el trabajo dentro de la app (B2.1/B2.2/B2.3) | ✅ HECHA |

## Detalle por tarea

### B0 · Los empaques entran a las recetas por dos caminos, no uno — HECHA

**El supuesto de A3 que no se cumplía**: A3 (Ronda 8) afirmó que "una preparación no puede referenciar un componente `tipo:'empaques'`, así que los 5 casos reales están todos referenciados directo en un producto". La primera mitad es correcta — sigue siéndolo. La segunda no: un producto tiene DOS estructuras distintas para meter un empaque en su receta — `producto.componentes[]` con `tipo:'empaques'`, y `producto.empaquesUsados[]` (`{empaqueId, cantidad}`, sin campo `tipo` propio). Los dos apuntan a `state.empaques`. A1 (Ronda 8) excluyó `empaquesUsados` del recorrido de reclasificación a propósito, razonándolo bien, pero sin evaluar la consecuencia: un insumo reclasificado que también tuviera una entrada ahí quedaba con esa referencia apuntando a una colección donde el insumo ya no está — costo $0 en silencio, el modo de falla exacto que A1 documentó como riesgo latente.

**Inventario de los dos caminos** (sobre un estado de prueba que replica la estructura real descrita en la misión — nunca se leyó ni se tocó el Sheet real):

| Camino | Estructura | Ejemplo de la misión |
|---|---|---|
| `producto.componentes[]` con `tipo:'empaques'` | `{ tipo, refId, gramos }` | Croissants, en Waffle New York, Waffle London, Belga London, Croffle Brasil, Croffle New York, Croffle London |
| `producto.empaquesUsados[]` | `{ empaqueId, cantidad }` | Cajas, stickers |
| Los dos a la vez, en el mismo producto | — | Waffle Brasil (cajas y stickers en `empaquesUsados`, además componentes con `tipo:'empaques'`) |

**El arreglo, en `moverInsumoDeTipo` (js/core.js)**:
- `empaquesUsados` no tiene su propio `tipo` — moverlo no es reescribir un campo, es CONVERTIR la entrada: `{empaqueId, cantidad}` → `{tipo:tipoNuevo, refId, gramos:cantidad}`, y sacarla de `empaquesUsados`. Mecánico y exacto: `cantidad` en `empaquesUsados` se escala por `qty` vendida exactamente igual que `gramos` en `componentes` (confirmado leyendo `computeSaleConsumption` y `getCostoProducto` — las dos usan `campo * qty`), así que el costo total no se mueve ni un peso.
- **Guarda nueva, más general de lo que B0 pedía textualmente**: una preparación SOLO puede resolver componentes `tipo:'materia'`/`'preparacion'` (`getPreparacionComposicionPorGramo` no tiene ninguna rama para `'empaques'`/`'toppings'`). Si el insumo movido está referenciado dentro de una preparación y el tipo nuevo no es `'materia'`, esa referencia no se puede reescribir con ninguna certeza — es una restricción ESTRUCTURAL, no un desajuste transitorio. Se detecta ANTES de mutar nada (extraída a `detectarBloqueosMoverInsumo_`, reusada también por B2) y bloquea el movimiento COMPLETO, devolviendo qué preparación lo impide. La dirección real de A3/B2 (empaques→materia) nunca se bloquea por esta guarda — solo materia→empaques/toppings puede chocar con ella.
- Cambia la firma de retorno de `moverInsumoDeTipo`: de `boolean` a `{ok, bloqueos}`. Actualizados el caller en `index.html` (avisa qué lo bloqueó, sin perder el resto de los campos editados) y los tests de A1 que asumían el booleano viejo.

### B1 · Guarda contra el costeo en cero — HECHA

A1 documentó el riesgo, B0 lo confirmó real: `getCostoProducto`/`getCostoProductoDesglosado`/`aplicarComponentes` buscan el insumo en la colección que dice el `tipo` del componente, no donde vive de verdad. Un desajuste devuelve **$0 sin ningún aviso**.

`getReferenciasRotas(state)` recorre `componentes` de productos y preparaciones, más `empaquesUsados[]`, y por cada `refId` que no resuelve en la colección esperada busca en las OTRAS colecciones de insumo antes de reportar — distingue:
- **Desajuste de tipo**: el insumo existe, en otro bucket ("Croissants está en materia pero la receta lo busca en empaques") — el modo de falla exacto de B0.
- **Referencia borrada**: no existe en ninguna colección.

**No cambia el valor que devuelven las funciones de costeo** — un componente roto sigue aportando 0, tal cual (verificado con un test explícito: detectar el problema no altera lo que `getCostoProducto` devuelve). Solo detecta y reporta, aparte, integrado al reporte de integridad y al Centro de Alertas (severidad alta, mismo nivel que el desajuste de A2).

### B2 · Hacer el trabajo dentro de la app — HECHA

**B2.1 (lotes)**: desde el reporte de integridad, checkbox por ingrediente que A3 detectó + botón "Reclasificar seleccionados a materia prima". Abre una vista previa (simulada sobre una COPIA del estado, nunca el real) mostrando, por insumo, el desglose alimento/empaque de cada producto afectado, antes y después — el costo total marcado explícito como "✓ sin cambio". Todo o nada: si algún id del lote no se puede mover con certeza (bloqueado por la guarda de B0, o una selección desactualizada que ya no existe en empaques), NINGUNO se aplica hasta excluirlo.

**B2.2 (duplicados)**: botón "Resolver" por par detectado por A2. Abre un modal con los dos insumos lado a lado — nombre, costo, usos, stock — y la persona elige cuál conservar. **Nunca se decide por código**: el que tiene el dato correcto no es deducible (en los tres casos reales de la Ronda 8 es el huérfano, pero es una coincidencia de cómo se corrigió, no una regla). Vista previa obligatoria antes de repuntar — a diferencia del lote, el costo **sí** cambia (es el punto), así que se muestra explícito antes de confirmar. Después de repuntar, ofrece borrar el insumo que quedó huérfano como paso APARTE y explícito (nunca automático) — reusa la misma guarda de `deleteInsumo` (factorizada en `intentarEliminarInsumo_`), que ahora deja borrarlo porque el repunte ya movió todas sus referencias.

**B2.3 (confirmar el efecto)**: las dos operaciones terminan mostrando un resumen de qué cambió (insumos movidos, productos afectados, costo antes/después) en un modal, sin salir de la pantalla de Ajustes.

**La preparación duplicada (Malteada frutos rojos, porcentaje contra directo) queda fuera de este flujo, como anticipaba la misión.** Es una preparación, no un insumo — `getInsumosDuplicadosYHuerfanos` (A2) solo empareja dentro de `getInsumosUnificados` (materia/empaques/toppings), nunca preparaciones, así que ese caso nunca entra al flujo de B2.2 para empezar. No se forzó ninguna extensión — se documenta acá como el único caso que sigue siendo trabajo manual (ver más abajo).

## Bugs/hallazgos encontrados en el camino

- **Al construir B2.1**: la primera versión de `aplicarLoteReclasificacion` solo revisaba el bloqueo estructural de B0 (`detectarBloqueosMoverInsumo_`) antes de aplicar, pero NO revisaba si el insumo seguía existiendo en `empaques` — una selección desactualizada (por ejemplo, dos llamadas superpuestas, o el reporte abierto desde antes de otro cambio) se habría intentado mover igual, y solo habría fallado silenciosamente contra `moverInsumoDeTipo` sin que el resto del lote se detuviera — exactamente la violación de "todo o nada" que la misión pedía evitar. Se corrigió agregando la verificación de existencia al mismo pre-chequeo, antes de mutar cualquier cosa. Encontrado escribiendo el test del caso bloqueado, no reportado por el usuario.
- **Reconfirmado (no nuevo, ya documentado en R8 § A1)**: la reclasificación por bucket depende de que el `tipo` de cada componente de receta se mantenga sincronizado con dónde vive realmente el insumo — B0/B1 son las dos mitades de blindar esa dependencia (B0 corrigiendo el otro camino de referencia, B1 detectando cuando algo se desincroniza de todas formas).

## Lo que el dueño tiene que hacer a mano

**Con esta ronda, decidir y confirmar los 9 casos de la Ronda 8 ya se puede hacer dentro de la app** (Ajustes → reporte de integridad), no editando registros uno por uno:
- Las **5 reclasificaciones de A3** (Huevos, Huevos x30, Banano, Croissants, Belga preparados): marcar los que corresponda en "Ingredientes cargados como empaque" y tocar "Reclasificar seleccionados a materia prima" — una sola operación, con vista previa del efecto antes de confirmar.
- Los **3 pares de duplicados de insumos** (Mantequilla/Mantequilla D1, Crema de leche/Crema de leche 1lt, Huevos/Huevos x30): tocar "Resolver" en cada par, elegir cuál conservar viendo costo/usos/stock de los dos, confirmar el repunte viendo el cambio de costo real, y decidir si borrar el huérfano.

**Queda un solo caso que sigue siendo trabajo manual, tal como anticipaba la misión**: la **preparación duplicada** (Malteada frutos rojos, modo porcentaje contra modo directo). No es un insumo — es una preparación, y A2/B2 no las cubren (A2 nunca las empareja, B2 se construye sobre lo que A2 detecta). Es un solo caso: revisar las dos preparaciones en Preparaciones, decidir cuál es la vigente, y repuntar a mano los productos que usan la que se descarta (mismo patrón que B2.2, pero sin la herramienta — la receta tiene pocos componentes y un producto la usa, según lo descrito en la misión).

## Cierre del run

**Tests: 397, medidos ahora, 0 fallas.**

| Archivo | Tests |
|---|---|
| `tests/core.test.js` | 302 |
| `tests/sync.test.js` | 46 |
| `tests/rowsync.test.js` | 39 |
| `tests/auth.test.js` | 10 |
| **Total** | **397** |

**Commits de esta ronda** (uno por tarea, sobre `auditoria/costeo`):
1. `docs: cierre de Ronda 8 — renombrar PROGRESO.md a PROGRESO_R8.md`
2. `fix(B0): los empaques entran a las recetas por dos caminos, no uno`
3. `feat(B1): guarda contra el costeo en cero`
4. `feat(B2): hacer el trabajo dentro de la app — lotes y repunte de duplicados`

**Confirmado**: no se hizo merge a main. No se desplegó al Apps Script de producción. No se corrió ninguna migración contra el Sheet real — todo el trabajo de esta ronda es local (Node + navegador contra estados de prueba, nunca `script.google.com`).

**X2 (sincronización incremental) sigue abierta** — cinco rondas ya, sin retomarse en esta. El punto de partida sigue siendo `PROGRESO_R5.md` § V4 / `PROGRESO_R6.md` § X2.

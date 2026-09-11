# Progreso — Ronda 8 (A0 seguridad + A1/A2/A3 costeo real)

Rama: `auditoria/costeo`. Rondas anteriores: `PROGRESO_R1.md` a `PROGRESO_R7.md`.

**Y0 y el bloque Z (Ronda 7) quedaron cerrados. El costeo de productos está limpio por primera vez**: los márgenes reales del menú van de 41% a 76%, sin ningún componente aportando más de la mitad del precio de venta.

Esta ronda sale de inspeccionar el Sheet de producción real durante la preparación del despliegue de T1. Tres hallazgos nuevos (A1, A2, A3), ninguno visto en ninguna auditoría anterior, más un cuarto de seguridad (A0) encontrado aparte, revisando qué viaja en el estado sincronizado.

**Restricciones de esta ronda:**
- No se desplegó al Apps Script de producción. No se corrió `migrarAAppendOnly()` ni ninguna otra migración contra el Sheet real. No se tocó ningún dato real — el dueño está en medio del despliegue de T1 y editando insumos a mano.
- A0 se hizo primero (único con implicación de seguridad).
- X2 (sincronización incremental) sigue fuera de alcance — cuatro rondas abierta y documentada (`PROGRESO_R5.md` § V4, `PROGRESO_R6.md` § X2). No se retomó en esta.
- No merge a main.

## Preguntas bloqueantes

(cero preguntas bloqueantes — ambigüedad → opción más conservadora, documentada acá)

## Estado de tareas

| Tarea | Estado |
|---|---|
| A0 · El token del backend viaja en el estado sincronizado | ✅ HECHA |
| A1 · Cambiar el tipo de un insumo sin romper las recetas | ✅ HECHA |
| A2 · Detectar insumos duplicados y huérfanos | ✅ HECHA |
| A3 · Ingredientes clasificados como empaque rompen el food cost | ✅ HECHA |

## Detalle por tarea

### A0 · El token del backend viaja en el estado sincronizado — HECHA

**El hallazgo**: `state.config.backendUrl`/`backendToken` viajaban en cada push/pull y quedaban en texto plano en `state_json` — confirmado abriendo el respaldo real de producción, el token estaba ahí, completo. `config` es catálogo: se sincroniza siempre, y cualquiera con acceso al documento (o a un export/backup) podía leerlo.

**Investigación antes de tocar nada** (`IMPLEMENTATION_STATUS.md` línea 310, `HANDOFF.md` línea 889): los dos campos son legado de ANTES de esta serie de auditorías — una refactorización histórica previa ya movió la autenticación real a `js/auth.js`, con su propia llave de `localStorage` (`crumbly-session`) y una URL fija (`BACKEND_URL`, hardcodeada, no secreta — el backend rechaza cualquier pedido sin sesión válida). Ningún código actual lee ni escribe `config.backendUrl`/`backendToken`. Aun así, la exposición en texto plano es real independientemente de si algo los usa hoy — se corrigió por eso, no porque hiciera falta probar que alguien los explota.

**Decisión — archivar, no solo borrar**: el mismo patrón que ya usan `crumbly-catalog-base` (U4), `conteoEnProgreso` (T0.1), `crumbly-borrados-pendientes` (V0) y `crumbly-fase-migracion-confirmada` (X0) — device-local, nunca sincronizado. Nueva llave: `crumbly-backend-credenciales-legado`.

- `js/core.js`: `emptyState()` ya no crea los dos campos. `migrateState()` los **borra activamente** si un estado viejo los trae — la única migración de toda esta serie que borra en vez de agregar (el resto de `migrateState` sigue siendo no-destructivo a propósito).
- `js/sync.js`: `archivarCredencialesLegado(rawState)` — la mitad que sí puede tocar `localStorage` — copia el valor ANTES de que `migrateState` lo borre. Idempotente: si ya hay algo archivado, no lo pisa. `getBackendTokenGuardado(state)`/`getBackendUrlGuardada(state)`: leen `localStorage` primero, caen a `state.config` si está vacío — requisito explícito de la misión para el **caso de despliegue mixto**: un dispositivo con el cliente nuevo que recibe un pull de uno con el cliente viejo (que todavía escribiera en `config`) no se queda sin poder autenticarse.
- `index.html`: los 4 call sites de `CrumblyCore.migrateState()` (dentro de `loadState`, `afterLogin_`, y las dos ramas de `pullOnLoad`) pasan ahora por un único helper `migrarState_()` que archiva antes de migrar — ningún camino puede saltearse el archivado.
- **No cambió el mecanismo de autenticación real** — `auth.js`/`crumbly-session` sigue exactamente igual. Esto solo saca el campo legado que quedaba expuesto en el catálogo.

**Qué queda en `state.config` después de A0, y por qué cada cosa es sana para sincronizar**:

| Campo | Por qué es negocio, no credencial |
|---|---|
| `email` | Correo de contacto del negocio — información, no un secreto de autenticación |
| `lastSync` | Timestamp informativo de la última sincronización — no autoriza nada |
| `factorPrestacional` | Multiplicador de costo laboral (1.38) — configuración de negocio, la misma para todos los dispositivos |
| `comportamientoCategorias` | Preferencias de UI por categoría — configuración de negocio, tiene sentido que viaje igual en todos los dispositivos |

Se revisó el resto de `state.config` explícitamente — no hay ningún otro campo (`schemaVersion` vive aparte, en el nivel raíz del estado, no dentro de `config`).

**Verificación en navegador** (mock del backend, nunca `script.google.com`): un estado con el token legado en `config` se migra al cargar — el token queda archivado en `localStorage` y desaparece de `config` (confirmado tanto en memoria como en lo persistido tras el siguiente `saveState()`); login, pull y push contra el mock funcionan igual; logout/login funcionan igual; un push posterior no incluye el token en el payload.

### A1 · Cambiar el tipo de un insumo sin romper las recetas — HECHA

**El problema real**: el modal de insumo decía "no se puede cambiar después de creado — si lo cargaste en la categoría equivocada, borralo y volvé a crearlo". Borrar+recrear genera un `id` nuevo; las recetas guardan `refId`. Encontrado ya pasado **4 veces** en el Sheet real: Mantequilla/Mantequilla D1, Crema de leche/Crema de leche 1lt, Huevos/Huevos x30, Malteada frutos rojos porcentaje/directo — en los tres primeros, la que las recetas usan de verdad tiene el dato malo, y la corregida quedó huérfana sin que nadie lo note (el costeo sigue leyendo la vieja).

**El detalle que no era obvio**: no alcanza con mover el registro entre `state.materia`/`state.empaques`. Cada componente de receta (de un producto O de una preparación) guarda su PROPIO `tipo`, y `getCostoProducto`/`getCostoProductoDesglosado`/`aplicarComponentes` decidien en qué colección buscar el insumo según ESE campo — no según dónde vive el registro. Si solo se moviera el registro, cada receta que lo usa seguiría mirando la colección vieja, no encontraría el insumo, y su costo caería a **$0 en silencio**. `moverInsumoDeTipo` (js/core.js) hace las dos mitades: mueve el registro Y reescribe el `tipo` de cada componente que lo referencia (productos y preparaciones, anidamiento incluido).

**Alcance, decidido conservador**:
- Solo materia ↔ empaques desde este modal — convertir HACIA topping sigue sin poder elegirse (esa opción ya estaba deshabilitada antes de A1: los toppings se crean desde el menú, un límite preexistente que esta tarea no tocó).
- `producto.empaquesUsados[]` queda fuera del recorrido de reclasificación a propósito: esa colección no tiene su propio campo `tipo` (la colección misma ya implica "esto es empaque"), y convertir uno de esos a materia requeriría reestructurar la entrada (de `empaquesUsados` a `componentes`) — ningún caso real de esta ronda lo necesita.
- **No se reclasificó ningún insumo real** — esta tarea entrega la capacidad. Qué mover es decisión del dueño (ver "Lo que el dueño tiene que hacer a mano" más abajo).

### A2 · Detectar insumos duplicados y huérfanos — HECHA

Convierte el patrón de A1 en diagnóstico. `getInsumosDuplicadosYHuerfanos(state)`:

- **Duplicados**: insumos de nombre similar (uno es prefijo normalizado del otro — minúsculas, sin acentos) en el MISMO bucket, ids distintos. Cubre los 4 casos reales de A1. Severidad **alta** cuando exactamente uno de los dos está en uso (la señal exacta de "se corrigió creando uno nuevo, el costeo sigue leyendo el viejo") — **media** cuando los dos están en uso, o los dos huérfanos.
- **Huérfanos sin gemelo**: severidad **baja** — no es un error en sí (podría ser un insumo recién cargado, sin receta todavía), solo información.
- **Sin ninguna acción automática** — nada se fusiona ni se corrige solo. Un auto-merge que adivina mal rompe recetas en silencio, exactamente el problema que esto expone.

Integrado al reporte de integridad (Ajustes) con costos y usos lado a lado, y a la alerta del Centro de Alertas — pero **solo** los pares de severidad alta llegan a la campana; media/baja quedan en el reporte, sin la misma urgencia.

**Falso positivo conocido y documentado**: dos insumos genuinamente distintos donde uno es prefijo casual del otro (ej. "Sal" y "Salsa de tomate") — se reportan igual como par; la decisión de si son o no el mismo insumo la toma la persona, esto nunca fusiona nada solo.

### A3 · Ingredientes clasificados como empaque rompen el food cost — HECHA

**El caso real**: `state.empaques` tiene 5 insumos que no son empaque — Huevos, Huevos x30, Banano, Croissants, Belga preparados — consumidos por recetas con `tipo:'empaques'`. Peor caso: Croissant a $3.600/unidad, el componente más caro de cualquier croffle, contando como paper cost — de los $7.857 que cuesta un Croffle Brasil, $3.600 reportan como empaque. El costo TOTAL del producto sigue correcto; solo el reparto alimento/empaque — la métrica exacta que C1 construyó para compararse contra el benchmark de la industria (Toast/Restaurant365), con una brecha medida de 4.28 puntos — sale invertido.

**La regla, sin lista de excepciones por nombre** (un parche que falla con el próximo insumo mal cargado — la regla tiene que mirar una señal real del insumo, no su nombre):

1. **`esAdicion` + `precioAdicion` > 0**: algo que se le vende al cliente aparte, con precio propio, no es packaging por definición.
2. **Categoría de comida conocida**: `Lacteos`/`Lácteos`, `Fruta fresca`, `Harinas preparadas` — las categorías de comida reales encontradas en el estado real esta ronda. Punto de partida, no exhaustiva.

**Falsos positivos documentados**:
- Un empaque real cuya categoría coincide por accidente con la lista (alguien categoriza mal una caja como "Fruta fresca" sin querer).
- Un insumo `esAdicion`+`precioAdicion` que SÍ es empaque real (ej. una bolsa reutilizable que se cobra aparte al cliente) — borde plausible, sin caso real encontrado esta ronda.
- La lista de categorías de comida es la encontrada hoy, no cerrada — una categoría de comida nueva que no esté en la lista no se detecta por esa señal (sí podría detectarse por `esAdicion`, si aplica).

**Verificación pedida por la misión — `getFoodCostPct`/`getPaperCostPct` ya siguen la clasificación real, nada que unificar**: las dos derivan de `costosDesglosadosPeriodo` → `getCostoDesglosadoVentaItem` → `getCostoProductoDesglosado` — un solo criterio, el mismo que decide alimento/empaque por el `tipo` del componente. No hay un segundo criterio independiente en ningún lado de la cadena.

**Reporta el aporte en pesos y % del precio por producto afectado** — uso DIRECTO nada más: una preparación no puede referenciar un componente `tipo:'empaques'` en absoluto (`getPreparacionComposicionPorGramo` solo resuelve `'materia'`/`'preparacion'`), así que la cadena indirecta vía preparación (C10/V3.3) no aplica a este caso — los 5 casos reales están todos referenciados directo en un producto.

**No se reclasificó ningún insumo real** — A3 detecta, A1 corrige (mueve sin romper recetas). La decisión de mover cada uno es del dueño.

## Bugs/hallazgos encontrados en el camino (no eran el objetivo original de la tarea)

- **A1 → el hallazgo de fondo**: `getCostoProducto`/`getCostoProductoDesglosado`/`aplicarComponentes` dependen del `tipo` DECLARADO en cada componente de receta, no de dónde vive realmente el insumo referenciado. Esto significa que, HOY, si algún componente ya tuviera un `tipo` que no coincide con el bucket real de su `refId` (algo que no debería poder pasar con el flujo normal de la app, pero que un estado corrupto o editado a mano SÍ podría producir), su costo caería a $0 en silencio — sin ningún aviso. No se encontró ningún caso real de esto en la ronda; se documenta como riesgo latente de la arquitectura actual, expuesto al construir A1 (que depende exactamente de esta consistencia para mover un insumo de forma segura).

## Lo que el dueño tiene que hacer a mano

Esta ronda entrega **capacidad y diagnóstico** — ninguna decisión de datos se tomó por él. Con A1 ya disponible en el modal de insumo (Inventario → tocar el insumo → cambiar "Tipo de insumo"):

**1. Duplicados a resolver (A2, reporte de integridad → "Insumos con nombre similar")** — de los 4 casos ya conocidos por A1:
   - Mantequilla / Mantequilla D1
   - Crema de leche / Crema de leche 1lt
   - Huevos / Huevos x30
   - Malteada frutos rojos porcentaje / directo

   Por cada par: revisar cuál tiene el dato correcto, decidir si conviene mover las recetas de la huérfana hacia la que está en uso (o al revés) y borrar la que sobra — A2 solo AVISA, no fusiona nada.

**2. Ingredientes a reclasificar de empaques a materia (A3, reporte de integridad → "Ingredientes cargados como empaque")**:
   - Huevos
   - Huevos x30
   - Banano
   - Croissants
   - Belga preparados

   Para cada uno: abrir el insumo en Inventario, cambiar "Tipo de insumo" de Empaque a Materia prima (A1 se encarga de que las recetas sigan funcionando igual — el costo total de cada producto no cambia, solo el reparto interno alimento/empaque). El caso de mayor impacto es Croissant: $3.600 por unidad, hoy contando 100% como paper cost.

## Cierre del run

**Tests: 382, medidos ahora, 0 fallas.**

| Archivo | Tests |
|---|---|
| `tests/core.test.js` | 287 |
| `tests/sync.test.js` | 46 |
| `tests/rowsync.test.js` | 39 |
| `tests/auth.test.js` | 10 |
| **Total** | **382** |

**Commits de esta ronda** (uno por tarea, sobre `auditoria/costeo`):
1. `docs: cierre de Ronda 7 — renombrar PROGRESO.md a PROGRESO_R7.md`
2. `fix(A0): el token del backend no viaja más en el estado sincronizado`
3. `feat(A1): cambiar el tipo de un insumo sin romper las recetas`
4. `feat(A2): detectar insumos duplicados y huérfanos`
5. `feat(A3): detectar ingredientes clasificados como empaque`

**Confirmado**: no se hizo merge a main. No se desplegó al Apps Script de producción. No se corrió ninguna migración contra el Sheet real — todo el trabajo de esta ronda es local (Node + navegador contra un mock del backend, nunca `script.google.com`).

**X2 (sincronización incremental) sigue abierta** — cuatro rondas ya, sin retomarse en esta. El punto de partida sigue siendo `PROGRESO_R5.md` § V4 / `PROGRESO_R6.md` § X2.

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
| Y1 · Pantalla de aportes (qué componente rompe un producto) | pendiente |
| Z1 · Filtros colapsables | pendiente |
| Z2 · Buscador en Inventario | pendiente |
| Z3 · Preparaciones como cuarto botón de tipo | pendiente |
| Z4 · Preparaciones editables desde su lista | pendiente |
| Z5 · Cerrar modales al tocar fuera | pendiente |
| Z6 · No regresiones | pendiente |

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

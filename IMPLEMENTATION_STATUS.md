# Estado de implementación — Crumbly

> Última corrida: 2026-08-17. Actualizar en el mismo commit que el cambio que describe — no marcar DONE sin haber probado.

## Fase actual

**Fases A, B, C, D1 y D2 completas y verificadas.** D2 se simplificó a pedido el mismo día: se construyó y verificó el recargo de costos fijos por producto, y luego se retiró — el modelo vigente es costo + margen bruto por producto; la utilidad neta se conoce al cierre de cada período (ya existía en Fase C, sin cambios). Ver sección "D2 — revisión" abajo. Después de D2 se hizo una ronda adicional (17 ago 2026, ver sección "Ronda POS — clientes, ticket promedio, rango personalizable, cierre de caja, margen de variabilidad" abajo): login retirado, clientes reutilizables, ticket promedio, rango de fechas personalizable en Reportes, cierre de caja diario (solo reporte) y margen de variabilidad del 8% en insumos de precio volátil. Repo en GitHub: [github.com/Smplymkgm/crumbly](https://github.com/Smplymkgm/crumbly) (privado). Fase D3 (domicilios): pospuesta a pedido, no bien definida aún. Fase D4 (migración del spreadsheet): no iniciada. **Fase E (backend en Google Sheets): código y tests completos (ver sección propia abajo), falta que el usuario despliegue `backend/Code.gs` bajo el correo de Crumbly — `backend/SETUP.md`.**

## Qué se hizo

### Fase A — Consolidación (local)
- `crumbly 2.html` → `index.html` (la copia vieja `crumbly.html` sigue en Descargas, no se tocó ni se borró — es tuya, no mía).
- Estructura de carpetas: `js/`, `tests/`, `docs/`, `backend/`.
- `js/core.js`: toda la lógica de negocio (períodos, costeo, validación de stock, aplicar/revertir venta, necesidades de inventario, migración de esquema) extraída a un módulo sin DOM, cargable en browser y en Node.
- `README.md`, `.gitignore`.
- `git init` + commit local, luego **confirmado por ti**: repo remoto privado creado y con push — [github.com/Smplymkgm/crumbly](https://github.com/Smplymkgm/crumbly).

### Fase B — Bugs críticos e importantes

Todos corregidos **y verificados en un navegador real** (no solo con tests unitarios) — login, crear insumos/producto, vender con y sin stock suficiente, eliminar venta, dashboard, reportes, PDF, CSV, consola sin errores.

| ID | Estado | Verificación |
|---|---|---|
| P0-1 | ✅ DONE | `CrumblyCore.applyVenta`/`revertVenta`. Probado: vender → eliminar → stock vuelve exacto. |
| P0-2 | ✅ DONE | `producto.costo` ya no se persiste; `getCostoProducto()` calcula en vivo. Test: cambiar costo de insumo cambia el costo del producto sin reabrir/regrabar. |
| P0-3 | ✅ DONE | `computeSaleConsumption` + `checkStockShortage` antes de vender; `confirm()` con detalle exacto; venta queda marcada `stockInsuficiente`. |
| P0-4 | ✅ DONE | `saveState()` ahora captura el error y muestra un banner persistente (no un toast que desaparece) con botón de exportar respaldo. Probado simulando `QuotaExceededError`. |
| P0-5 | 📋 Diferido a Fase E | Requiere backend — fuera de alcance de Fase B por diseño (ver roadmap). |
| P1-1 | ✅ DONE | `calcInventoryNeeds` cubre materia + empaques + toppings. El PDF ya no dice "Inventario completo" mostrando solo materia prima. |
| P1-2 | ✅ DONE | Ventana móvil de 7 días (`getConsumptionRolling`) en vez de semana calendario. |
| P1-3 | ✅ DONE | `schemaVersion` + `migrateState()` explícito, no destructivo, con tests de estado parcial/corrupto. |
| P1-4 | ✅ DONE | Borrar materia/empaque referenciado por un producto se bloquea y nombra el producto. Probado en navegador. |
| P1-5 | ✅ DONE | Topping con cantidad de plato 0 ya no se registra como ítem fantasma. Probado en navegador. |
| P2-1 | ✅ DONE | `setReportPeriod` acota `querySelectorAll` a `el.parentElement`. Probado: cambiar período en Reportes no apaga tabs de Insumos. |
| P2-2 | ✅ DONE | `escapeHtml()` aplicado a todos los nombres interpolados en `innerHTML` (materia, empaque, toppings, productos, ventas, reportes, opciones de `<select>`). |
| P2-3 | ✅ DONE | `formatCOP()` (es-CO, separador de miles) en toda la UI y en los PDF. |
| P2-4 | ✅ DONE | Barras de costo con `Math.min(100, Math.max(0, ...))`. |
| P2-5 | ✅ DONE | `doLogout()` resetea la navegación al dashboard. |
| P2-6 | ✅ DONE | Botón "Resetear datos de prueba" en Reportes, doble `confirm()`. Probado: 2 confirmaciones, estado queda vacío. |
| P2-7 | ✅ Aceptado, sin cambio | Dependencia de CDN (jsPDF) — decisión: mantenerla, es la opción más segura por ahora (no reinventar sin necesidad). |
| P2-8 | ✅ DONE | `insumosTab` (variable sin uso) eliminada. |
| P2-9 | ✅ Resuelto por decisión | CSV con coma — Google Sheets (el backend elegido) lo importa sin problema. Sin cambio de código necesario. |
| P2-10 | 📋 Diferido a Fase D | Desglose de empaque línea por línea en el PDF — depende del rediseño de recibo de la fase de costeo. |

### Bug real encontrado durante la verificación en navegador (no estaba en el HANDOFF)

Al implementar P0-1, la primera versión revertía el stock usando la receta actual del producto (`gramos_receta × qty`). Eso es correcto en el caso normal, pero **si la venta se había registrado con stock insuficiente** (P0-3, el usuario elige continuar), el descuento real había quedado clampeado a lo que había disponible — no a lo que la receta pedía. Revertir con la receta completa sobrepasaba el stock original.

**Ejemplo real que lo destapó:** 100 g de harina disponibles, receta pide 150 g. Se vende igual (aceptando el aviso). Stock queda en 0 (no en -50). Al eliminar la venta, la versión rota devolvía 150 g → stock final 150, cuando debía volver a 100.

**Fix:** `applyVenta()` ahora guarda `venta.consumoReal` — el descuento *real* (post-clamp) por insumo — y `revertVenta()` usa ese registro en vez de recalcular desde la receta. Para ventas antiguas sin ese campo (antes de este cambio), cae de vuelta a la receta actual, documentado como aproximado. Test que reproduce exactamente este caso: `tests/core.test.js` → *"BUG REAL encontrado en pruebas de navegador..."*.

### Fase C — Módulo de gastos (HANDOFF §9)

Implementado en `js/core.js` (`registrarGasto`, `eliminarGasto`, `costoPromedioPonderado`, `getGastosByPeriod`, `getDepreciacionMensualTotal`/`getDepreciacionPeriodo`, `getCascadaUtilidad`) y en la UI (`index.html`: modal de gasto con campos condicionales por tipo, pestaña "Gastos" dentro de Reportes, tarjeta de utilidad neta en el dashboard, desglose en el PDF de ventas, `exportGastosCSV`).

| Pieza | Estado | Verificación |
|---|---|---|
| Clasificación inventario/operativo/capex | ✅ DONE | Compra de inventario no resta de la utilidad (ya está en costo de ventas), sí de la caja, sí aumenta stock. Operativo resta de ambas. Capex se deprecia, no resta de golpe. Probado en navegador y en tests. |
| Compra de inventario actualiza costo y stock | ✅ DONE | Costo promedio ponderado (`costoPromedioPonderado`) — ejemplo del handoff verificado exacto: 1000g@$10 + 2000g@$12 = $11,333/g. Probado en navegador: costo y stock del insumo se actualizan al guardar el gasto. |
| `eliminarGasto` revierte con precisión | ✅ DONE | Usa snapshot `costoAntes`/`cantidadAntes` (mismo patrón que `consumoReal` en ventas) — no recalcula, no adivina. Probado en navegador con dos compras encima. |
| Depreciación de capex | ✅ DONE | `monto / vidaUtilMeses`, prorrateada al período de reportes; un activo ya depreciado deja de aportar. Ejemplo del handoff verificado (waflera $1.200.000 a 36 meses → $33.333/mes). |
| Cascada utilidad bruta → neta → flujo de caja | ✅ DONE | Card "Utilidad neta y flujo de caja" en Reportes, tarjeta en el dashboard, sección en el PDF. Verificado que una compra de inventario no reduce la utilidad (bruta ni neta) pero sí el flujo de caja. |
| Pestaña "Gastos" dentro de Reportes (no 6ª pestaña de nav) | ✅ DONE | Decisión ya tomada en el handoff — implementada tal cual. |
| `exportGastosCSV` | ✅ DONE | Probado en navegador, no lanza error. |

### Bug real encontrado durante la verificación en navegador (Fase C)

`saveGasto()` y `eliminarGasto()` refrescaban la lista de gastos y el dashboard, pero **no la tarjeta de cascada de utilidad en la pestaña "Resumen"** — quedaba mostrando `-$0` en gastos operativos y depreciación hasta que el usuario cambiaba de pestaña y volvía. Los números eran correctos (verificado llamando `getCascadaUtilidad` directamente), el problema era solo que la UI no se refrescaba sola.

**Fix:** ambas funciones ahora llaman `renderCascadaUtilidad()` explícitamente. Verificado en navegador: registrar un gasto operativo y uno de capex actualiza la tarjeta de inmediato, sin cambiar de pestaña.

### Fase D1 — Preparaciones intermedias (HANDOFF §10.2-§10.3)

El cambio arquitectónico más grande del plan: antes la app modelaba `materia prima → producto`; ahora modela `materia prima → preparación → producto`, con preparaciones reutilizables y anidables. Motor en `js/core.js`, UI en `index.html` (4ª pestaña "Preparaciones" dentro de Insumos, modal de producto con componentes mixtos).

| Pieza | Estado | Verificación |
|---|---|---|
| Porcentaje panadero (`gramos = baseGramos × porcentaje`) | ✅ DONE | Masa de waffle New York reproducida con los 9 insumos y costos reales del handoff: **583,44 g, $7.269,15, $12,4591/g — exacto contra la hoja**, verificado tanto en `tests/core.test.js` como en el navegador (formulario real, `savePreparacionUI`). |
| Modo directo (gramos explícitos, sin porcentaje) | ✅ DONE | Salsa de frutos rojos (moras+fresas+azúcar): 975 g, $10.638,75, $10,9115/g — exacto contra la hoja. |
| Preparaciones anidadas (una preparación usa otra) | ✅ DONE | Caso sintético de dos niveles verificado a mano (ganache 240g/$9,00 dentro de relleno 120g/$7,8333); la composición por gramo suma exactamente 1 (se explica el 100% de cada gramo). |
| Detección de ciclos (directos e indirectos) | ✅ DONE | Auto-referencia, ciclo A↔B, ciclo de 3 niveles A→B→C→A, y el caso "diamante" (dos preparaciones distintas comparten una sub-preparación) correctamente NO marcado como ciclo. Probado también desde el formulario real: `savePreparacionUI()` rechaza con el modal abierto, sin corromper el estado. |
| `getCostoProducto` con componentes mixtos | ✅ DONE | Producto = preparación + materia directa + empaque, verificado exacto. |
| Venta descuenta materia real a través de una preparación | ✅ DONE | Vender 1 unidad de un producto que usa 190g de una preparación de 583,44g descontó cada materia prima cruda en la proporción correcta (190/583,44 = 32,57% del lote) — verificado con los 9 insumos reales, diferencia 0 contra el cálculo de referencia. |
| `revertVenta` a través de una preparación | ✅ DONE | Reversión exacta, mismo patrón `consumoReal` que P0-1 — no depende de la receta actual. |
| `calcInventoryNeeds`/`checkStockShortage` ven materia usada solo vía preparación | ✅ DONE | Un insumo usado exclusivamente dentro de una preparación (nunca referenciado directo por el producto) sí aparece en faltantes y en proyección de compras. |
| Migración `ingredientes` → `componentes` (schemaVersion 3→4) | ✅ DONE | No destructiva — probada con un estado v3 crudo (con `ingredientes`, sin `preparaciones`); migra limpio y el costo calculado coincide. |
| Bloqueo de borrado extendido a preparaciones | ✅ DONE | No se puede borrar una preparación usada por un producto o por otra preparación; no se puede borrar una materia usada por una preparación (aunque ningún producto la referencie directo). Los 4 casos probados en el navegador con el mensaje real que ve el usuario. |

### Bugs reales encontrados durante la verificación en navegador (Fase D1)

1. **Costo por gramo de preparación mostrado redondeado a entero.** `calcPrepCosto()` y `renderPreparaciones()` usaban `fmt()` (formato de moneda, pensado para montos totales) sobre un costo por gramo — `$12.4591` se mostraba como `$12`. Con productos que usan cientos de gramos, ese redondeo equivale a varios pesos de error real. Fix: mostrar con 4 decimales (`toFixed(4)`), igual que ya hacía la lista de materia prima con `toFixed(3)`.
2. **`addEmpRow()` no recalculaba el costo del producto al agregar la fila.** A diferencia de `addIngRow()` (que sí recalcula), agregar una fila de empaque dejaba el costo mostrado desactualizado hasta que el usuario tocaba el select o el input de esa fila. Bug preexistente a D1 (no introducido por este cambio), detectado porque el script de verificación seteaba valores por JS sin disparar `change`. Fix: `addEmpRow()` ahora llama `calcProdCost()` al insertar la fila.

Ninguno de los dos afectaba los cálculos guardados — ambos eran de visualización/refresco. Los números persistidos (`state`) siempre fueron correctos; se confirmó comparando contra `CrumblyCore.getPreparacionCosto()`/`getCostoProducto()` llamados directamente.

### Fase D2 — Costo final, markup, margen y cobertura (HANDOFF §10.4-§10.5)

Costo final = costo variable × (1 + % costos fijos). El precio de venta sigue siendo la ENTRADA (no cambia solo); ganancia, markup y margen se derivan. Motor en `js/core.js` (`getRentabilidadProducto`, `getPrecioObjetivo`, `getCoberturaCostosFijos`), UI en `index.html` (ficha de producto con desglose completo, card "Parámetros de costeo" y "Cobertura del recargo" en Reportes).

| Pieza | Estado | Verificación |
|---|---|---|
| Costo final con recargo global (30%) | ✅ DONE | Waffle New York reproducido exacto vía el modal real: costo variable $9.822,81 → costo final $12.769,65 (redondeo de display a $12.770). |
| Markup sobre costo vs. margen sobre precio, separados | ✅ DONE | 72,3% / 42,0% — exacto contra la tabla del handoff. Etiquetados distinto en la UI (§10.4: "no confundirlas"). |
| El precio de venta no cambia solo | ✅ DONE | Subir el costo de un insumo de $9.822,81 a $15.000 dejó el precio en $22.000 sin tocar; la ganancia bajó de forma visible ($9.230 → $2.500) para que el usuario decida. Probado en navegador. |
| Override de `%` por producto | ✅ DONE | Producto con 50% en vez del 30% global: costo final y markup recalculados correctamente (49,3%), guardado y persistido. |
| Calculadora de precio objetivo | ✅ DONE | "70% de markup" → sugiere $25.048 sobre un costo final con override 50%; confirmado que `producto.precio` no se modificó solo. |
| Cobertura del recargo vs. costos fijos reales | ✅ DONE | Con $520.000 de gastos operativos reales y 30% de recargo sobre $98.228 de costoVentas: cobertura 6%, mensaje "te faltó 94%, el recargo debería estar cerca del 529%" — verificado con la aritmética exacta, en dos escenarios (superávit y déficit). |
| Cambiar el `%` global recalcula en vivo | ✅ DONE | Cambiar de 30% a 50% en la card de Reportes actualizó la cobertura inmediatamente sin recargar. |
| Migración `schemaVersion` 4→5 (`parametros`) | ✅ DONE | Estado v4 sin `parametros` migra agregando `costosFijosPct: 0.30`, no destructivo. |
| **Regresión: el recargo no se filtra a la contabilidad real** | ✅ DONE | Test explícito + verificación en navegador: `venta.items[].costo` sigue siendo costo variable puro (no costo final), y `getCascadaUtilidad` (utilidad bruta de Fase C) no cambia por la existencia del recargo. El recargo es una herramienta de precios, no un cambio de COGS. |

**Decisión tomada:** `costosFijos[]` (colección de costos fijos recurrentes planificada originalmente) no se implementó — es redundante con los gastos operativos de Fase C, que ya cubren "costos fijos reales del período". Ver `HANDOFF.md` §3.2 para el razonamiento completo. Tampoco se implementó `parametros.unidadesMetaMes`: pertenecía a un enfoque de prorrateo por volumen que la fórmula final (recargo como % del costo variable) no usa.

No se encontraron bugs nuevos durante la verificación en navegador de esta fase (a diferencia de B, C y D1, que sí destaparon uno cada una).

### D2 — revisión (mismo día): recargo de costos fijos retirado

Después de verificar lo de arriba, se pidió explícitamente **quitar el recargo de costos fijos de la fórmula por producto**. No fue por un error — los cálculos de arriba eran correctos — fue una decisión de diseño: el negocio prefiere conocer la utilidad neta real al cierre de cada período (cruzando gastos reales con ventas reales, Fase C) en vez de estimarla por producto con un `%` global.

**Se eliminó de `js/core.js`:** `getRentabilidadProducto`, `getPrecioObjetivo`, `getCoberturaCostosFijos`, `parametros.costosFijosPct`, `producto.costosFijosPct`. **Se agregó:** `getMargenProducto` (costo, ganancia, margen bruto — sin recargo). **De la UI:** desglose costo-final/markup/margen/calculadora en la ficha de producto → vuelve a costo + margen bruto; cards "Parámetros de costeo" y "Cobertura del recargo" en Reportes → eliminadas; sección de cobertura en el PDF → eliminada.

**Sin cambios:** `getCostoProducto` (el costo variable, ya verificado correcto), la cascada de utilidad de Fase C (`getCascadaUtilidad`, la card "Utilidad neta y flujo de caja" en Reportes) — esa sigue siendo el mecanismo de "cierre" que el negocio quiere usar.

Tests D2 reescritos: de 13 tests (costo final/markup/cobertura) a 4 tests (`getMargenProducto`, precio no se mueve solo, consistencia con el snapshot de venta, utilidad neta sigue siendo por período). Verificado en navegador con servidor local (`.claude/launch.json`, no versionado): ficha de producto y lista de productos muestran solo costo + margen bruto, sin rastro de las cards retiradas, PDF/CSV sin errores.

### Ronda POS — clientes, ticket promedio, rango personalizable, cierre de caja, margen de variabilidad (17 de agosto de 2026)

A pedido explícito, tras compartir una minuta de reunión (`Asesoria_crumbly.pdf`) y comparar contra sistemas POS de restaurante. Motor en `js/core.js`, UI en `index.html`.

| Pieza | Estado | Verificación |
|---|---|---|
| Login retirado por completo | ✅ DONE | `#login-screen`, `USERS`, `doLogin`/`doLogout` y CSS asociado eliminados; `#app` visible directo. `refreshAll()` se llama al iniciar. Verificado: la app abre directo en el dashboard, sin pantalla de login. |
| Clientes reutilizables (nombre + teléfono) | ✅ DONE | `findOrCreateCliente(state, nombre, telefono)` — mismo teléfono reutiliza el cliente y actualiza el nombre si vino distinto. Card "Cliente (opcional)" en Ventas, con `<datalist>` de teléfonos conocidos que autocompleta el nombre. Probado en navegador: venta con cliente nuevo aparece en el historial con su nombre; venta repetida con el mismo teléfono no crea un cliente duplicado. |
| Ticket promedio | ✅ DONE | `getTicketPromedio(ventas)`. Card en Reportes junto al conteo de ventas del período. Probado: 1 venta de $22.000 → ticket promedio $22.000. |
| Rango de fechas personalizable | ✅ DONE | Quinta pestaña "Personalizado" en Reportes + dos `<input type="date">`. `getVentasByRange`/`getGastosByRange`/`getCascadaUtilidadRango` reutilizan `rangeBounds`/`computeCascada` (sin duplicar fórmulas de período). Alimenta resumen, gastos, PDF, CSV y correo vía wrappers `getReportVentas/Gastos/Cascada/Label/RangeLabel` en `index.html`. Probado: rango con la fecha de hoy da los mismos números que la pestaña "Hoy". |
| Cierre de caja diario (solo reporte) | ✅ DONE | Card fija "Cierre de caja del día" en Reportes, siempre sobre `'dia'` — independiente del selector de período/rango de arriba (decisión explícita: "solo un reporte del día", sin bloqueo de datos). Ventas, unidades, ingresos, gastos, utilidad neta y ticket promedio del día + botón de PDF (`generateCierreCajaPDF`). Probado en navegador: card y PDF sin errores de consola, números consistentes con `getCascadaUtilidad(state,'dia')`. |
| Margen de variabilidad 8% en insumos de precio volátil | ✅ DONE | Checkbox "Precio variable" en materia/empaque/topping (`margenVariable`). Al comprar (`registrarGasto`), el costo unitario de esa compra se multiplica ×1,08 (`MARGEN_VARIABILIDAD_PCT`) antes de entrar al promedio ponderado; los insumos sin el checkbox no cambian. Probado en navegador: insumo a $0,02/g marcado, compra igual cantidad → costo pasa a $0,0208/g (promedio ponderado entre $0,02 stock viejo y $0,0216 = $0,02×1,08 de la compra nueva) — coincide exacto con el cálculo esperado. Reversión del gasto (`eliminarGasto`) restaura el costo/cantidad exactos aun con el margen aplicado. |

**Explícitamente pospuesto, no construido en esta ronda:** Fase D3 (domicilios — el modelo aún no está bien definido en el negocio); ajuste por IPC para insumos de precio estable (el usuario pidió aplicarlo recién el próximo año).

**Bug real encontrado y corregido durante esta ronda:** `new Date('YYYY-MM-DD')` parsea como medianoche UTC; combinado con `.setHours()` (hora local) desplazaba la fecha un día hacia atrás en zonas horarias detrás de UTC (Colombia, UTC-5) — afectaba `rangeBounds()` y `getDepreciacionRango()`. El test de rango personalizable que reprodujo el caso también usaba `toISOString()` para "hoy" (UTC) y tuvo que corregirse igual. Fix: `parseLocalDate()`, que arma la fecha desde sus componentes Y/M/D en vez de parsear el string completo con el constructor de `Date`.

Verificado en navegador con servidor local (`.claude/launch.json`, no versionado, `http://localhost:8791` — `file://` no es confiable para cargar `js/core.js` en este entorno de preview). Datos de prueba creados y limpiados manualmente al terminar; no quedaron en el estado real de la app.

### Fase E — Backend en Google Sheets, primera pasada (17 de agosto de 2026)

A pedido explícito, en paralelo al rediseño visual. Código y tests completos; **despliegue pendiente del usuario** (`backend/SETUP.md`) — ver `HANDOFF.md` §12 para el porqué (no puedo crear cuentas de Google ni iniciar sesión por él).

| Pieza | Estado | Verificación |
|---|---|---|
| `backend/Code.gs` (Apps Script: `doGet`/`doPost`, token, `LockService`, estado completo + espejo por colección) | ✅ DONE, sin desplegar | No ejecutable sin una hoja real — revisado a mano contra la especificación de `HANDOFF.md` §12.3-§12.4. Queda pendiente de verificación en vivo cuando el usuario lo despliegue. |
| `js/sync.js` (`ping`/`pull`/`push`, sin DOM) | ✅ DONE | 11/11 tests con `fetch` simulado (`tests/sync.test.js`): query string correcto en `ping`/`pull`, `POST` con `Content-Type: text/plain` y body `{token, action, state}` en `push`, propaga `ok:false` del backend sin lanzar, rechaza en HTTP no-2xx. |
| UI "Sincronización (Google Sheets)" en Reportes | ✅ DONE | Probado en navegador con `fetch` interceptado (sin backend real): "Probar conexión" → "Conectado ✓"; "Sincronizar ahora" → sube el estado completo y fija `lastSync`. |
| Auto-sync tras cada `saveState()`, con debounce | ✅ DONE | Solo se activa después del primer "Sincronizar ahora" manual (evita subir datos a medio configurar). Probado: guardar un insumo nuevo dispara exactamente **un** push automático 900ms después, con el insumo correcto adentro. |
| `pull` en segundo plano al cargar la app | ✅ DONE, sin verificar contra un backend real | Solo se intenta si ya hubo una sincronización antes (`lastSync` existe); si falla o no hay red, la app sigue con lo que ya tenía en `localStorage` — no bloquea el arranque. |
| Migración de `state.config` (`backendUrl`, `backendToken`, `lastSync`) | ✅ DONE | `emptyState()` y `migrateState()` en `js/core.js`, mismo patrón que `config.email`. No requirió bump de `schemaVersion` (campo opcional con default, igual que el email). |

**Decisión de implementación:** el backend guarda y devuelve el `state` completo como un solo JSON (`push`/`pull` de todo, no CRUD por fila) — ver el porqué en `HANDOFF.md` §12.3. Las hojas por colección (`materia`, `ventas`, etc.) son un espejo de solo lectura para inspección manual, no la fuente de verdad.

**No construido en esta pasada, a propósito:** resolución de conflictos entre dispositivos (gana la última sincronización), reintentos automáticos si el push falla por falta de red (queda para cuando alguien lo sincronice manualmente o en la siguiente mutación exitosa), y por supuesto el despliegue real — eso es un paso manual de ~10 minutos que le corresponde al usuario (`backend/SETUP.md`).

## Tests

```
node tests/core.test.js
node tests/sync.test.js
```

**`core.test.js`: 87/87 pasan.** Cobertura Fase B (33 tests): conversión de períodos (semana en lunes), formato de moneda, escape de HTML, costeo de producto en vivo, validación de stock, necesidades de inventario (3 tipos de insumo, ventana móvil), migración de esquema (no destructiva, tolera estado parcial/corrupto/null), aplicar/revertir venta (caso normal, stock insuficiente, toppings clampeados, venta legada sin `consumoReal`), dependencias al eliminar insumos. Cobertura Fase C (16 tests): costo promedio ponderado, clasificación de gastos por tipo, reversión con snapshot exacto, depreciación de capex, cascada de utilidad, agrupación por categoría. Cobertura Fase D1 (22 tests): porcentaje panadero con números reales del handoff, modo directo, anidamiento, ciclos (4 variantes), producto con componentes mixtos, venta/reversión a través de una preparación, dependencias extendidas. Cobertura Fase D2, versión vigente (4 tests): `getMargenProducto` con costo real, el precio no se mueve solo al subir un costo, el snapshot de venta es consistente, la utilidad neta se sigue conociendo por período. Cobertura ronda POS (12 tests): clientes (5), ticket promedio (2), rango de fechas personalizable (2), margen de variabilidad 8% (3).

**`sync.test.js`: 11/11 pasan.** Cliente de sincronización con `fetch` simulado — ver tabla de Fase E arriba.

No hay suite de UI automatizada — la verificación de pantallas se hizo manualmente en el navegador (ver tablas de arriba, incluyendo uso de los formularios/modales reales, no solo llamadas directas a `core.js`) porque el proyecto no tiene un test runner de browser configurado. Si se quiere esa cobertura permanente, es trabajo nuevo, no incluido aquí.

## Siguiente en el roadmap

1. **Desplegar el backend de Fase E** (`backend/SETUP.md`) — único paso que le corresponde al usuario, ~10 minutos bajo el correo de Crumbly. Una vez desplegado, verificar en vivo (probar conexión, sincronizar, abrir la app en otro dispositivo) y actualizar esta tabla.
2. **Fase D3 — Domicilios por zona** (`HANDOFF.md` §10.6): pospuesta a pedido explícito — el modelo de domicilios aún no está bien definido en el negocio. Retomar cuando haya decisión sobre zonas/tarifas.
3. **Fase D4 — Migrar los datos del spreadsheet**, con las correcciones de `HANDOFF.md` §11 y las 4 decisiones de costeo ya tomadas (recargo 30%, masa de harina de arroz, empaques diferenciados $2.550/$1.650). Ya no hay nada que la bloquee.
4. **Ajuste por IPC** para insumos de precio estable — pospuesto explícitamente al próximo año.
5. **Rediseño visual** (`DISENO_HANDOFF.md`) — en curso por el usuario con otra herramienta; integrar los mockups sobre la lógica actual cuando estén listos.

El roadmap del handoff las ordena así a propósito (D2 depende de D1 + C, ambas ya completas; ver nota en `HANDOFF.md` §7).

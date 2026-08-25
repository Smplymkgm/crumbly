# Estado de implementación — Crumbly

> Última corrida: 2026-08-19. Actualizar en el mismo commit que el cambio que describe — no marcar DONE sin haber probado.

## Fase actual

**Fases A, B, C, D1 y D2 completas y verificadas.** D2 se simplificó a pedido el mismo día: se construyó y verificó el recargo de costos fijos por producto, y luego se retiró — el modelo vigente es costo + margen bruto por producto; la utilidad neta se conoce al cierre de cada período (ya existía en Fase C, sin cambios). Ver sección "D2 — revisión" abajo. Después de D2 se hizo una ronda adicional (17 ago 2026, ver sección "Ronda POS — clientes, ticket promedio, rango personalizable, cierre de caja, margen de variabilidad" abajo): login retirado, clientes reutilizables, ticket promedio, rango de fechas personalizable en Reportes, cierre de caja diario (solo reporte) y margen de variabilidad del 8% en insumos de precio volátil. Repo en GitHub: [github.com/Smplymkgm/crumbly](https://github.com/Smplymkgm/crumbly) (privado). Fase D3 (domicilios): pospuesta a pedido, no bien definida aún. Fase D4 (migración del spreadsheet): no iniciada. **Fase E (backend en Google Sheets): DESPLEGADO Y VERIFICADO en producción** el 18 ago 2026 (ver sección propia abajo). **Rediseño visual (`DISENO_HANDOFF.md`): completo y verificado en navegador** el 18 ago 2026 (ver sección propia abajo) — `index.html` reconstruido con el nuevo shell/5 pantallas/modales, probado extremo a extremo (crear insumo → crear producto con fórmula → registrar venta → descuento de stock → dashboard/caja actualizados → cliente). App publicada en [smplymkgm.github.io/crumbly](https://smplymkgm.github.io/crumbly/) (repo pasado a público para poder usar GitHub Pages gratis — sin secretos en el código, el token/Sheet ID viven en las Script Properties de Apps Script). **Mermas (Inventario → Mermas): completo y verificado** el 19 ago 2026 (ver sección propia abajo) — movimiento de inventario, nunca de caja.

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

A pedido explícito, en paralelo al rediseño visual. **Desplegado y verificado en producción el 18 ago 2026** — `ping`, `push` y `pull` probados con `curl` y con `fetch()` real desde el navegador contra la URL real. Ver `HANDOFF.md` §12 para el detalle del despliegue (incluye una nota técnica: el flujo "Extensiones → Apps Script" falló en este entorno, se resolvió con un proyecto independiente que abre la hoja por ID).

| Pieza | Estado | Verificación |
|---|---|---|
| `backend/Code.gs` (Apps Script: `doGet`/`doPost`, token, `LockService`, estado completo + espejo por colección) | ✅ DONE, sin desplegar | No ejecutable sin una hoja real — revisado a mano contra la especificación de `HANDOFF.md` §12.3-§12.4. Queda pendiente de verificación en vivo cuando el usuario lo despliegue. |
| `js/sync.js` (`ping`/`pull`/`push`, sin DOM) | ✅ DONE | 11/11 tests con `fetch` simulado (`tests/sync.test.js`): query string correcto en `ping`/`pull`, `POST` con `Content-Type: text/plain` y body `{token, action, state}` en `push`, propaga `ok:false` del backend sin lanzar, rechaza en HTTP no-2xx. |
| UI "Sincronización (Google Sheets)" en Reportes | ✅ DONE | Probado en navegador con `fetch` interceptado (sin backend real): "Probar conexión" → "Conectado ✓"; "Sincronizar ahora" → sube el estado completo y fija `lastSync`. |
| Auto-sync tras cada `saveState()`, con debounce | ✅ DONE | Solo se activa después del primer "Sincronizar ahora" manual (evita subir datos a medio configurar). Probado: guardar un insumo nuevo dispara exactamente **un** push automático 900ms después, con el insumo correcto adentro. |
| `pull` en segundo plano al cargar la app | ✅ DONE, verificado contra el backend real | Solo se intenta si ya hubo una sincronización antes (`lastSync` existe); si falla o no hay red, la app sigue con lo que ya tenía en `localStorage` — no bloquea el arranque. |
| Migración de `state.config` (`backendUrl`, `backendToken`, `lastSync`) | ✅ DONE | `emptyState()` y `migrateState()` en `js/core.js`, mismo patrón que `config.email`. No requirió bump de `schemaVersion` (campo opcional con default, igual que el email). |
| **Despliegue real** (Sheet + Apps Script bajo `crumbly2026@gmail.com`) | ✅ DONE — 18 ago 2026 | `ping`/`push`/`pull` probados con `curl` y con `fetch()` real desde el navegador contra la URL en producción. Ver `HANDOFF.md` §12 para el detalle (incluye la nota técnica del proyecto independiente por `CRUMBLY_SHEET_ID`). |

**Decisión de implementación:** el backend guarda y devuelve el `state` completo como un solo JSON (`push`/`pull` de todo, no CRUD por fila) — ver el porqué en `HANDOFF.md` §12.3. Las hojas por colección (`materia`, `ventas`, etc.) son un espejo de solo lectura para inspección manual, no la fuente de verdad.

**No construido a propósito:** resolución de conflictos entre dispositivos (gana la última sincronización), reintentos automáticos si el push falla por falta de red (queda para cuando alguien lo sincronice manualmente o en la siguiente mutación exitosa).

### Rediseño visual — base de datos y lógica (18 de agosto de 2026)

A partir de `DISENO_HANDOFF.md` (handoff de alta fidelidad recibido del usuario: 5 pantallas — Dashboard, Caja, Inventario, Productos, Clientes — + 3 modales, paleta blanco/negro/gris, sidebar colapsable). Antes de tocar `index.html` se extendió `js/core.js` (schemaVersion 6→7), todo aditivo:

| Pieza | Estado | Verificación |
|---|---|---|
| Campos nuevos: `categoria` (insumos/productos), adiciones (`esAdicion`/`precioAdicion`/`porcion`/`nombreAdicion` en cualquier insumo), `metodoPago`/`comprobante` (ventas), `comprobante` (gastos), `direccion` (clientes) | ✅ DONE | `migrateState` los rellena con default en estados viejos sin romper nada — 97/97 tests siguen pasando. |
| `applyVenta` consume adiciones de **cualquier** tipo de insumo (antes solo toppings podían agregarse a una línea) | ✅ DONE | Reutiliza el mismo snapshot `consumoReal` — `revertVenta` no necesitó cambios. Probado: vender con adición → descuenta `porcion × qty` del insumo correcto; revertir → restaura exacto. |
| `componentes` de un producto (la "Fórmula") ahora puede referenciar empaques/toppings, no solo materia prima | ✅ DONE | `getCostoProducto` y el descuento de stock se generalizaron vía un helper nuevo (`aplicarComponentes`) que unificó 4 sitios que antes repetían la misma expansión materia/preparación por separado — se corrigió el hueco (empaques/toppings no eran válidos como ingrediente de receta) al mismo tiempo que se eliminaba la duplicación. |
| `getInsumosUnificados`/`getAdiciones`/`getMovimientos` (helpers nuevos) | ✅ DONE | Para las pantallas Inventario/Productos/Caja del rediseño. Materia/empaques/toppings **no se fusionaron** internamente — solo se aplanan para las pantallas que necesitan verlos juntos; así preparaciones, tests existentes y el backend de Sheets (que ya espeja las 3 colecciones por separado) no se rompen. |

**Decisión de implementación:** el modal único de "insumo" del diseño (con selector "tipo de medición": gramos/mililitros/kilogramos/unidad) se mapea internamente a solo 2 colecciones — gramos/mililitros/kilogramos → `materia` (mililitros tratado ≈ gramos para costeo, aproximación conocida), unidad → `empaques`. El usuario nunca ve esta distinción interna; es puramente de implementación, para reusar el motor de costeo ya probado en vez de construir uno nuevo por tipo de medición.

### Rediseño visual — reconstrucción de `index.html` (18 de agosto de 2026)

A partir del prototipo de alta fidelidad `design_handoff_crumbly_dashboard/` (`.dc.html` + `README.md`) que el usuario compartió tras terminar el diseño externo. Reconstrucción completa del front-end reutilizando el 100% de `js/core.js` (ningún cambio de lógica de negocio en esta ronda, solo la extendida en la sección anterior).

| Pieza | Estado | Verificación |
|---|---|---|
| Shell nuevo (sidebar colapsable en escritorio, overlay+hamburguesa en móvil, header con fecha/ajustes/notificaciones) | ✅ DONE | Probado en navegador a 1280px (sidebar fija) y 375px (overlay táctil vía `openMobileMenu`/`closeMobileMenu`) — breakpoint 860px del diseño. |
| 5 pantallas (Dashboard, Caja, Inventario, Productos, Clientes) | ✅ DONE | Cada una probada con datos reales creados en la sesión: insumo → producto con fórmula → venta → cliente. Navegación (`navTo`) confirmada entre las 5. |
| Modal único de Insumo (reemplaza los 3 modales viejos de materia/empaque/topping) | ✅ DONE | Crear, ver categoría como chip de filtro dinámico, descuento de stock verificado tras una venta (5.000g → 4.900g exacto). |
| Modal de Producto con Fórmula (insumos/empaques como ingrediente de receta) + foto | ✅ DONE | Costo, ganancia y margen bruto recalculados en vivo mientras se edita — verificado con números reales (100g×$10/g = $1.000 costo, precio $5.000 → margen 80%). |
| Modal de Venta (carrito, adiciones, cliente autocompletable, método de pago) | ✅ DONE | Venta completa probada: buscar producto por nombre exacto, agregar al carrito, confirmar → aparece en Movimientos, KPIs y gráfico del Dashboard, donut "Más vendidos" y stock del insumo se actualizan sin recargar. |
| Modal de Cliente (CRUD directo, no solo desde una venta) | ✅ DONE | Crear cliente con nombre+teléfono, aparece en la lista. |
| Modal de Ajustes (agrupa PDF/CSV/sync/correo/reset, antes desperdigados) | ✅ DONE | Los 8 controles (reporte inventario, 3 CSV, URL+token+probar+sincronizar, correo, reset) presentes y con los `onclick` correctos. |
| Dashboard: KPIs, gráfico de barras (CSS puro), donut "Más vendidos" (conic-gradient), Cierre de caja, Inventario bajo | ✅ DONE | Verificado con una venta real: 1 venta, $5.000 total, margen neto $4.000 (= venta − costo), barra del día correcta, donut 100% al único producto vendido. |

**Bug real encontrado y corregido durante la verificación en navegador:** el botón "Nuevo producto" llamaba `onclick="openProductoModal()"`, pero la función real se llama `openModalProducto()` — typo introducido durante la reescritura, invisible hasta hacer clic (no rompía la carga de la página, solo el botón). Se detectó de inmediato al probar el flujo de creación de producto (consola: `ReferenceError: openProductoModal is not defined`). Fix de una línea en [index.html:332](index.html:332). Sweep posterior con `grep` de todos los `onclick="fn("` contra las funciones definidas — no aparecieron más casos.

**Código muerto eliminado en el mismo pase** (detectado con un sweep de `getElementById` contra los `id` existentes en el HTML): `renderInventoryNeeds()` y `renderCascadaUtilidad()` — ambas ya no tenían el elemento DOM que rellenaban (`#r-inventario-needs` no existe en el nuevo shell) y no se llamaban desde ningún lado. `calcInventoryNeeds()` y `getCascadaUtilidad()` (el cálculo, no el render) se conservan — se siguen usando en el PDF.

**Reducciones funcionales de esta ronda, no pedidas explícitamente:** las 3 quedaron restauradas el 23 ago 2026 a pedido del usuario — ver sección propia abajo.

### Mermas — Inventario → Mermas (19 de agosto de 2026)

A pedido explícito: registrar pérdidas de inventario (vencido, dañado, quemado, error de preparación, contaminado, derrame, rotura, no vendido) sin que toquen Caja. Requisito explícito del usuario, verificado con el ejemplo exacto del enunciado.

**Decisión de arquitectura:** no existía una tabla genérica de "movimientos de inventario" — el patrón ya establecido es que cada tipo de evento económico es su propio array en `state` (`ventas`, `gastos`) con su función `aplicar`/`revertir` y un snapshot para reversión exacta (`consumoReal` en ventas, `costoAntes`/`cantidadAntes` en gastos). Se agregó `state.mermas` siguiendo exactamente ese mismo patrón — no una tabla nueva de "movimientos" genéricos, que habría sido una estructura no usada por nada más en el proyecto.

| Pieza | Estado | Verificación |
|---|---|---|
| `CrumblyCore.registrarMerma`/`eliminarMerma` (js/core.js) | ✅ DONE | El origen puede ser un insumo con stock propio (materia/empaques/toppings, descuento directo) o un producto preparado — en ese caso se reusa `aplicarComponentes` (el mismo motor de expansión de receta que ya usan `applyVenta`/`computeSaleConsumption`), sin inventar un segundo sistema de costeo ni un stock propio para "productos". Snapshot `consumoReal` igual que `applyVenta` (P0-1) para revertir exacto, incluso si la merma se registró con stock insuficiente (clampeado a 0). |
| Nunca toca Caja | ✅ DONE | `registrarMerma`/`eliminarMerma` nunca leen ni escriben `state.gastos` ni `state.ventas`. `CrumblyCore.getMovimientos` (Caja) no las incluye — no hizo falta excluirlas, simplemente no se agregaron ahí. Test explícito + verificado en navegador: registrar 2 mermas ($15.000 y $3.600) dejó `Caja` en "Sin movimientos". |
| Ejemplo del enunciado (Salsa de la casa: 20 u a $5.000, merma de 3 → 17 u, $15.000) | ✅ DONE | Reproducido exacto, en test y en navegador. |
| Mermas en la cascada de rentabilidad (`computeCascada`) | ✅ DONE | `mermasValor` (4º parámetro opcional, default 0 — no rompe la firma vieja) resta de `utilidadNeta` pero NUNCA de `flujoCaja`, mismo criterio que ya usa la depreciación (pérdida real pero no-cash). Verificado: venta $5.000 + merma $18.600 → utilidad neta -$15.400, flujo de caja se queda en $5.000 intacto. |
| UI: Inventario → Mermas (stats, por motivo, últimas mermas, modal) | ✅ DONE | Período (Semana/Mes/Año/Todas), 3 stats compactas (registros, valor perdido, motivo principal), lista "por motivo" y "últimas mermas" con botón eliminar. Modal con origen (tipo + insumo/producto), cantidad, costo unitario y valor total calculados en vivo, motivo (`CrumblyCore.MERMA_MOTIVOS`), observaciones, registrado por (sin sistema de login existente — texto libre, no se inventó autenticación). Aviso de stock insuficiente igual que al vender (P0-3), no bloquea. |
| Reporte de mermas (PDF nuevo) + mermas en los 2 reportes PDF existentes | ✅ DONE | `generateMermasReportPDF()` (resumen, por motivo, por producto/insumo, detalle) con los mismos helpers minimalistas del resto (`pdfHeader`/`pdfMinimalTable`). Reporte de ventas: nueva columna "Mermas" en la tabla de cascada. Reporte de inventario: nueva sección "Mermas (últimos 7 días)" por motivo. |
| Reversión no deja el inventario inconsistente | ✅ DONE | Test + navegador: eliminar una merma de un producto (BOM) devuelve exactamente los gramos/unidades de cada insumo que se habían descontado — no recalcula desde la receta actual. Eliminar una merma que se había clampeado por falta de stock devuelve solo lo que realmente se quitó, no lo pedido. |
| `state.mermas` (schemaVersion 7→8) | ✅ DONE | Migración aditiva y no destructiva, mismo patrón que `clientes` (v5→v6). Sincroniza automáticamente con el backend (Fase E) porque `push`/`pull` mandan el `state` completo — se agregó además una hoja espejo `mermas` en `backend/Code.gs` para consistencia con el resto de colecciones (de solo lectura; **requiere que el usuario vuelva a pegar/desplegar el script actualizado**, igual que los cambios anteriores al backend). |

**No se tocó:** ningún flujo de venta, compra o caja existente — `registrarMerma`/`eliminarMerma` son funciones nuevas que no modifican `applyVenta`, `revertVenta`, `registrarGasto` ni `eliminarGasto`.

### Restauración de 3 funciones caídas en el rediseño (23 de agosto de 2026)

A pedido explícito del usuario, tras confirmarle qué había quedado pendiente de la reconstrucción de `index.html`.

| Pieza | Estado | Verificación |
|---|---|---|
| "Vender un topping suelto" en el modal de Venta | ✅ DONE | Sección plegable ("Vender un topping suelto (sin producto)") con su propio selector+cantidad, agrega una línea de carrito con `toppingId` en vez de `productoId`. `registrarVenta` separa `ventaCart` en `lineas`/`toppingsSueltos` antes de llamar a `CrumblyCore.applyVenta` — ese soporte ya existía en core.js desde antes del rediseño (`toppingsSueltos` nunca se tocó), solo faltaba la UI. Verificado en navegador: 3 chispas de chocolate sueltas descontaron stock (100→97) y crearon una venta con `items:[{toppingId,...}]`, `total:$3.000`, `ganancia:$2.940`. |
| Card "Necesidades de compra (semana)" | ✅ DONE | Sección plegable nueva en Inventario (mismo patrón que "Inventario bajo" del Dashboard), usa `calcInventoryNeeds()` ya existente — ningún cálculo nuevo. Verificado: insumo con stock bajo mostró "Comprar 95und" con el badge de conteo correcto. |
| Cards "Utilidad neta y flujo de caja" + "Productos más rentables" | ✅ DONE | Card plegable "Detalle financiero del período" en el Dashboard (colapsada por defecto — solo calcula mientras está abierta, para no tocar de nuevo el "sin scroll"). Reusa `getReportCascada()`/`getReportVentas()` (ya atados a los pills de período existentes) y un helper nuevo `getProductosMasRentables(ventas)` extraído del reporte PDF de ventas (antes calculado inline ahí, ahora se usa desde los dos lugares — ninguna fórmula duplicada). Verificado con una venta real: Utilidad bruta $6.400, Gastos operativos -$5.000, Utilidad neta $1.400 y Flujo de caja $5.000 — coincide exacto con la card "Cierre de caja — hoy" de al lado. |
| Ajuste fino de espaciado del Dashboard | ✅ DONE | Agregar la card colapsada de detalle financiero metía 11px de scroll de más a 1280×700. Se recortó un poco más el padding/gap ya comprimido en la ronda anterior (`gap` 12→10px, `.card` padding 13→11px, `app-content` padding-bottom 16→10px) — verificado sin scrollbar de nuevo hasta 1280×650. |

**No se tocó:** ningún cálculo de `js/core.js` — las 3 restauraciones son puramente de `index.html` (UI + wiring), reusando funciones que ya existían (`applyVenta`, `calcInventoryNeeds`, `getCascadaUtilidad`) sin modificarlas.

### Importar menú Crumbly 2026 (23 de agosto de 2026)

El usuario compartió el PDF del menú (`Menu crumbly.pdf`, no versionado en el repo). Se decidió con 3 preguntas explícitas antes de tocar datos, para no fabricar costos/recetas que el menú no trae:

- **12 waffles** (New York/Brasil/London/Caramel × Waffle de arroz/Belga/Croffle) — se cargan con nombre y precio de venta exactos del menú, **sin fórmula** (el PDF no trae gramos ni costos — inventar una habría violado P0-2, "el costo nunca se fabrica"). Nombres desambiguados con el tipo de base entre paréntesis (`"New York (Waffle)"`, `"New York (Croffle)"`, etc.) porque el buscador de producto en el modal de Venta hace match exacto por nombre — 3 productos llamados "New York" a secas habrían colisionado.
- **"Arma tu Crumbly"** ($25k base + elegir base/2 toppings/2 frutas/1 salsa con recargos): **omitido a pedido del usuario** — es un producto configurable, la app no tiene un flujo de "elige N de M" en el modal de Producto. Pendiente si se quiere esa función más adelante.
- **28 complementos a la carta** (9 salsas, 9 toppings, 7 frutas, 3 bases sueltas) — se cargan como `toppings` vendibles (mismo mecanismo de "vender un topping suelto" restaurado en esta misma ronda) con el precio de venta del menú y **costo $0** (el menú no trae costo, solo precio al cliente) — a completar por el usuario en cada uno.

**Decisión de UX:** no se pudo escribir esto directamente en los datos reales del usuario — la app vive en `localStorage` del navegador de su celular/laptop, al que este entorno no tiene acceso. Se agregó un botón **"Importar menú Crumbly 2026"** en Ajustes → `importMenuCrumbly()` — el usuario lo activa una vez desde su propio dispositivo. Es idempotente (deduplica por nombre exacto): tocarlo dos veces no duplica nada, verificado en test manual (12/28 → 12/28 tras un segundo click).

Verificado en navegador: los 12 productos aparecen con sus chips de categoría (Waffle/Waffle Belga/Croffle) y margen 100% (costo $0, esperado sin fórmula); los 28 complementos aparecen en Inventario con sus chips (Salsas/Toppings/Frutas/Base); una venta mixta (1 waffle + 1 Nutella suelta) generó correctamente el aviso de stock insuficiente (Nutella en 0 existencia) y, confirmado, registró ambos ítems con el total/ganancia correctos.

**Dos correcciones sobre la marcha, mismo día:**

1. Un primer intento marcó los 28 complementos como "adición" (`esAdicion:true`) para que aparecieran como chips seleccionables sobre un producto. El usuario mostró una captura: eso llenaba el modal de Venta con una pared de 28 chips debajo de "Agregar producto", visible incluso antes de elegir nada. Se revirtió — `importMenuCrumbly()` ahora los deja `esAdicion:false` (y corrige en el lugar los que ya se hubieran marcado mal en un import anterior, sin duplicar).
2. El usuario reportó en su navegador real que la lista de productos no aparecía y que los complementos tampoco aparecían ahí. Causa: el buscador de "Agregar producto" usaba `<input list="datalist">` nativo — el mismo problema de confiabilidad en navegadores móviles que ya se había encontrado y corregido para el campo Categoría (commit `0e0fc2c`) pero no se había aplicado aquí. Se reemplazó por un buscador propio (`getVentaBuscables()` + `onVentaBuscarInput()`/`selectVentaBuscado()`): un solo campo de texto que filtra en vivo sobre productos **y** toppings/complementos juntos, mostrando los resultados en una lista propia (no nativa) debajo del campo. Esto también resolvió el pedido de que un complemento "simplemente se agregue como un producto más a la factura" — se eliminó el flujo separado y colapsado de "Vender un topping suelto", ahora unificado en la misma búsqueda. Verificado en navegador de escritorio y en viewport móvil (375px): la búsqueda "croffle" devuelve los 4 waffles Croffle y el complemento "Croffle (base)" en la misma lista.

### Comprobantes reales en Google Drive (24 de agosto de 2026)

El usuario preguntó si el campo "Comprobante" (Venta con transferencia, Gasto) ya subía el archivo a Drive. Respuesta honesta tras revisar el código: no — `onComprobanteChange` solo guardaba el **nombre** del archivo como texto; la foto/PDF nunca se subía a ningún lado, se descartaba al seleccionarla. El usuario pidió construirlo.

| Pieza | Estado | Verificación |
|---|---|---|
| `backend/Code.gs`: acción `uploadComprobante` | ✅ DONE | Recibe `{filename, mimeType, data}` (base64), decodifica con `Utilities.base64Decode`, crea el archivo en una carpeta "Crumbly - Comprobantes" de Drive (la crea si no existe) y devuelve `{ok, url, fileId}`. El archivo **no se comparte públicamente** — solo lo puede abrir la cuenta de Google que desplegó el script, igual que cualquier archivo que crees a mano ahí. **Requiere que el usuario redespliegue** (pegar el `Code.gs` actualizado + nueva versión) — primera vez va a pedir autorizar un permiso nuevo (Drive, antes solo Sheets). Nota agregada en `backend/SETUP.md`. |
| `js/sync.js`: `uploadFile()` | ✅ DONE | Mismo patrón que `push`/`pull` (POST con `Content-Type: text/plain` para evitar el preflight de Apps Script). 4 tests nuevos con `fetch` mockeado — no depende de red real. |
| `index.html`: `onComprobanteChange` async | ✅ DONE | Lee el archivo con `FileReader` → base64 → `CrumblySync.uploadFile`. Si la sincronización no está configurada, cae de vuelta al comportamiento anterior (solo el nombre) con un aviso — no bloquea registrar la venta/gasto. Límite de 10MB con aviso. `venta.comprobante`/`gasto.comprobante` pasan de guardar el nombre del archivo a guardar la URL de Drive. |
| Ver el comprobante después de guardado | ✅ DONE | Nuevo ícono "Ver comprobante" (link, se abre en pestaña nueva) en cada fila de Movimientos en Caja — antes el campo se guardaba pero no se mostraba en ningún lado. Solo aparece si `comprobante` es una URL real (no un nombre de archivo suelto de antes de este cambio). |
| **Bug real encontrado de paso**: `CrumblyCore.registrarGasto` nunca guardaba `comprobante` | ✅ FIXED | `applyVenta` sí lo hacía; `registrarGasto` armaba el objeto `gasto` sin ese campo — se perdía silenciosamente incluso antes de este cambio (afectaba también el nombre de archivo de la versión vieja). Test nuevo (`registrarGasto guarda comprobante`) para que no se vuelva a caer. |

Verificado en navegador con `CrumblySync.uploadFile` mockeado (sin depender del backend real desplegado): sube y guarda la URL, cae de vuelta a solo-nombre sin backend configurado, rechaza archivos >10MB, y el ícono "Ver comprobante" aparece en Caja con el link correcto.

**Pendiente del lado del usuario:** repegar `backend/Code.gs` en Apps Script y crear una nueva versión de la implementación (mismo proceso ya documentado en `backend/SETUP.md`) — sin eso, la app sigue guardando solo el nombre del archivo (cae al fallback, no rompe nada, pero no sube nada a Drive hasta que se redespliegue). **✅ Hecho por el usuario el mismo día** (Versión 2, 25 ago 2026, verificado con captura de "Se actualizó correctamente la implementación").

### Link de configuración de un solo toque (25 de agosto de 2026)

Al verificar el punto anterior, el usuario tuvo que configurar `Ajustes → Sincronización` a mano (URL + token, copiando entre dos pestañas) y preguntó por qué no queda guardado en un solo lugar para todos los dispositivos. Se le explicó la razón real (la config de conexión no puede vivir *dentro* del backend al que sirve para conectarse — problema de bootstrapping inherente a cualquier app sin login centralizado) y, a su pedido de simplificarlo (ofreció incluso construir un login completo si hacía falta), se implementó una alternativa mucho más liviana:

| Pieza | Estado | Verificación |
|---|---|---|
| `DEFAULT_BACKEND_URL` fija en `index.html` | ✅ DONE | La URL del deployment no es secreta (sin el token, el backend siempre responde "token inválido") — vive en el código público, así un dispositivo nuevo ya no necesita que se la copien. |
| Link mágico `?token=...` | ✅ DONE | `applySetupLinkIfPresent()`, llamado al cargar la app: si hay `?token=` en la URL, guarda `backendUrl` (el fijo) + `backendToken` (del link), limpia el token de la barra de direcciones/historial (`history.replaceState`) y hace un `pull` inmediato para traer los datos reales — todo con un solo toque, sin tocar Ajustes a mano. Documentado en `backend/SETUP.md` § "Conectar un dispositivo nuevo con un solo link". |

Se decidió explícitamente **no** construir un sistema de login completo (usuario/contraseña con servidor propio) — sería mucho más trabajo y superficie de ataque nueva (guardar contraseñas) para resolver el mismo problema que ya resuelve el link de un toque, en una app de 1-2 dispositivos. Verificado en navegador con `CrumblySync.pull` mockeado: el link configura, limpia la URL, trae los datos remotos y llena los campos de Ajustes correctamente.

## Tests

```
node tests/core.test.js
node tests/sync.test.js
```

**`core.test.js`: 111/111 pasan** (13 nuevos de mermas: registrar sobre insumo directo, ejemplo exacto del enunciado, registrar sobre producto vía BOM, nunca crea gasto/venta, validaciones, clamp por stock insuficiente + flag, reversión exacta incluyendo el caso clampeado, mermas en la cascada sin afectar flujo de caja, compatibilidad de `computeCascada` con su firma vieja de 3 argumentos, migración, agrupadores por motivo/origen, filtros por período/rango). Cobertura Fase B (33 tests): conversión de períodos (semana en lunes), formato de moneda, escape de HTML, costeo de producto en vivo, validación de stock, necesidades de inventario (3 tipos de insumo, ventana móvil), migración de esquema (no destructiva, tolera estado parcial/corrupto/null), aplicar/revertir venta (caso normal, stock insuficiente, toppings clampeados, venta legada sin `consumoReal`), dependencias al eliminar insumos. Cobertura Fase C (16 tests): costo promedio ponderado, clasificación de gastos por tipo, reversión con snapshot exacto, depreciación de capex, cascada de utilidad, agrupación por categoría. Cobertura Fase D1 (22 tests): porcentaje panadero con números reales del handoff, modo directo, anidamiento, ciclos (4 variantes), producto con componentes mixtos, venta/reversión a través de una preparación, dependencias extendidas. Cobertura Fase D2, versión vigente (4 tests): `getMargenProducto` con costo real, el precio no se mueve solo al subir un costo, el snapshot de venta es consistente, la utilidad neta se sigue conociendo por período. Cobertura ronda POS (12 tests): clientes (5), ticket promedio (2), rango de fechas personalizable (2), margen de variabilidad 8% (3). Cobertura rediseño — base de datos (11 tests): insumos unificados, adiciones (filtrado, consumo en `applyVenta`, reversión), `findInsumoConTipo`, `getMovimientos`, dirección de cliente, migración de campos nuevos, componentes tipo empaques/toppings en la receta y en `applyVenta`, `getIngresosPorDia`.

**`sync.test.js`: 11/11 pasan.** Cliente de sincronización con `fetch` simulado — ver tabla de Fase E arriba.

No hay suite de UI automatizada — la verificación de las 5 pantallas y sus modales se hizo manualmente en el navegador con datos reales (crear insumo → producto → venta → cliente, ver tabla de la reconstrucción de `index.html` arriba) porque el proyecto no tiene un test runner de browser configurado. Si se quiere esa cobertura permanente, es trabajo nuevo, no incluido aquí.

## Siguiente en el roadmap

1. ~~Desplegar el backend de Fase E~~ — ✅ hecho y verificado el 18 ago 2026.
2. ~~Rediseño visual~~ — ✅ hecho y verificado en navegador el 18 ago 2026. Pendiente: decidir con el usuario las 3 reducciones funcionales listadas arriba (utilidad neta / productos rentables / necesidades de compra sin card en pantalla; venta de topping suelto retirada).
3. **Fase D3 — Domicilios por zona** (`HANDOFF.md` §10.6): pospuesta a pedido explícito — el modelo de domicilios aún no está bien definido en el negocio. Retomar cuando haya decisión sobre zonas/tarifas.
4. **Fase D4 — Migrar los datos del spreadsheet**, con las correcciones de `HANDOFF.md` §11 y las 4 decisiones de costeo ya tomadas (recargo 30%, masa de harina de arroz, empaques diferenciados $2.550/$1.650). Ya no hay nada que la bloquee.
5. **Ajuste por IPC** para insumos de precio estable — pospuesto explícitamente al próximo año.

El roadmap del handoff las ordena así a propósito (D2 depende de D1 + C, ambas ya completas; ver nota en `HANDOFF.md` §7).

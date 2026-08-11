# Estado de implementación — Crumbly

> Última corrida: 2026-08-11. Actualizar en el mismo commit que el cambio que describe — no marcar DONE sin haber probado.

## Fase actual

**Fase B completa y verificada.** Fase A completa a nivel local (repo, estructura, tests) — **falta tu confirmación explícita para crear el repo remoto y hacer push** (ver §"Pendiente de confirmación" abajo). Fases C, D, E: no iniciadas — siguiente en el roadmap del `HANDOFF.md`.

## Qué se hizo

### Fase A — Consolidación (local)
- `crumbly 2.html` → `index.html` (la copia vieja `crumbly.html` sigue en Descargas, no se tocó ni se borró — es tuya, no mía).
- Estructura de carpetas: `js/`, `tests/`, `docs/`, `backend/`.
- `js/core.js`: toda la lógica de negocio (períodos, costeo, validación de stock, aplicar/revertir venta, necesidades de inventario, migración de esquema) extraída a un módulo sin DOM, cargable en browser y en Node.
- `README.md`, `.gitignore`.
- `git init` + commit local. **NO se creó repo remoto ni se hizo push** — es una acción visible/compartida que requiere tu confirmación explícita (ver abajo).

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

## Tests

```
node tests/core.test.js
```

**33/33 pasan.** Cobertura: conversión de períodos (semana en lunes), formato de moneda, escape de HTML, costeo de producto en vivo, validación de stock, necesidades de inventario (3 tipos de insumo, ventana móvil), migración de esquema (no destructiva, tolera estado parcial/corrupto/null), aplicar/revertir venta (caso normal, stock insuficiente, toppings clampeados, venta legada sin `consumoReal`), dependencias al eliminar insumos.

No hay suite de UI automatizada — la verificación de pantallas se hizo manualmente en el navegador (ver tabla de arriba) porque el proyecto no tiene un test runner de browser configurado. Si se quiere esa cobertura permanente, es trabajo nuevo, no incluido aquí.

## Pendiente de confirmación (no autónomo por diseño)

- **Crear el repo remoto en GitHub y hacer push.** Es una acción que publica código y depende de tu cuenta/autenticación (`gh auth`). El comando queda listo en `HANDOFF.md` §8.2 — dime "dale" y lo ejecuto, o hazlo tú.
- **Repo público o privado.** Recomendación del handoff: privado. Sin tu confirmación, no se ha creado ninguno.

## Siguiente en el roadmap

1. **Fase C — Módulo de gastos** (`HANDOFF.md` §9): inventario/operativo/capex, cascada de utilidad bruta → neta → flujo de caja.
2. **Fase D1 — Preparaciones intermedias**: el cambio arquitectónico grande (masa, salsas, porcentaje panadero, detección de ciclos).
3. **Fase D2-D4 — Costeo completo y migración del spreadsheet** con las correcciones de `HANDOFF.md` §11.
4. **Fase E — Backend en Google Sheets.**

No se ha empezado ninguna de estas — el roadmap del handoff las ordena así a propósito (D depende de B+C; ver nota en `HANDOFF.md` §7).

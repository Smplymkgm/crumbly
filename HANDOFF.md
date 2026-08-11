# Crumbly — Handoff técnico y roadmap

> **Última actualización:** 10 de agosto de 2026
> **Archivo de la app:** `crumbly 2.html` (1394 líneas) → renombrar a `index.html`. Ver §1.
> **Archivo de costeo:** `COSTOS WAFFLES.xlsx` (22 hojas). Analizado en §10.
> **Decisión de esta sesión:** se arreglan todos los bugs conocidos y se migra el modelo de costeo del spreadsheet a la app, con backend en Google Sheets. Sin IVA, sin canales de venta por aplicación. Todas las decisiones de costeo tomadas — la migración está desbloqueada (§13).

---

## Índice

- [§0. Resumen ejecutivo](#0-resumen-ejecutivo)
- [§1. Estado de los archivos](#1-estado-de-los-archivos)
- [§2. Qué hace la app hoy](#2-qué-hace-la-app-hoy)
- [§3. Modelo de datos](#3-modelo-de-datos)
- [§4. Mapa de funciones](#4-mapa-de-funciones)
- [§5. Reglas de negocio implícitas](#5-reglas-de-negocio-implícitas)
- [§6. Bugs de la app](#6-bugs-de-la-app)
- [§7. Roadmap](#7-roadmap)
- [§8. Fase A — GitHub](#8-fase-a--github)
- [§9. Fase C — Módulo de gastos](#9-fase-c--módulo-de-gastos)
- [§10. Fase D — Modelo de costeo (el spreadsheet)](#10-fase-d--modelo-de-costeo-el-spreadsheet)
- [§11. Errores encontrados en el spreadsheet](#11-errores-encontrados-en-el-spreadsheet)
- [§12. Fase E — Backend en Google Sheets](#12-fase-e--backend-en-google-sheets)
- [§13. Decisiones abiertas](#13-decisiones-abiertas)
- [§14. Cómo retomar](#14-cómo-retomar)

---

## §0. Resumen ejecutivo

Crumbly es una app de una sola página para gestionar insumos, productos, ventas y reportes de un negocio de waffles y obleas. Corre en el navegador, guarda en `localStorage`, sin servidor.

En paralelo existe `COSTOS WAFFLES.xlsx`, donde vive el **verdadero modelo de costeo del negocio**: recetas con porcentaje panadero, sub-preparaciones reutilizables y recargo por costos fijos. La app no sabe nada de eso — su "costo por unidad" es una versión simplificada y sin costos fijos.

**El objetivo de este plan es que el spreadsheet deje de ser necesario:** que todo lo que hoy calculas a mano en Excel lo calcule la app, con los datos vivos de tu inventario y tus ventas reales.

**Hallazgos principales de esta sesión:**

1. **El spreadsheet tiene errores de fórmula** (§11). Al menos uno te está haciendo subcostear un producto en **$484 por unidad**. Detalle y corrección en §11.
2. **Falta un concepto entero en la app: las preparaciones intermedias** (masa, salsas, crumble, caramelo). El spreadsheet las calcula con porcentaje panadero y las reutiliza entre productos. Es el cambio arquitectónico más grande del plan (§10.2).
3. **Los "costos fijos" del spreadsheet no son costos fijos**, son un recargo porcentual sobre el costo variable. Sirve para poner precios, no para saber si ganas plata. La app puede hacer las dos cosas y contrastarlas (§10.5).
4. **La fórmula va invertida respecto al Excel.** En las hojas el margen es el parámetro y el precio se calcula; en la operación real el precio se decide y el margen es la consecuencia. La app usa el segundo sentido (§10.4).
5. Los 19 bugs de la app (§6) quedan todos en alcance.

**Fuera de alcance (decidido el 10 de agosto de 2026):** no se maneja IVA — el negocio no lo cobra sobre sus ventas. Tampoco se modelan canales de venta por aplicación (Rappi y similares): todavía no operan ahí. Toda la lógica de comisiones, IVA sobre comisión y precio diferenciado por canal que existe en el spreadsheet **no se migra**. Ver §11.10 si eso cambia más adelante.

---

## §1. Estado de los archivos

| Archivo | Estado | Acción |
|---|---|---|
| `crumbly.html` (949 líneas) | **Obsoleto.** Sin empaque, toppings, año, CSV ni correo. | Borrar |
| `crumbly 2.html` (1394 líneas) | **Versión buena.** | Renombrar a `index.html` y versionar |
| `Handoff 2.md` | Superado por este documento | Archivar |
| `COSTOS WAFFLES.xlsx` | **Fuente de verdad del costeo.** Se migra a la app (§10) | Conservar como referencia histórica |

El espacio en `crumbly 2.html` rompe URLs y comandos si no se escapa — razón adicional para renombrarlo ya.

**Credenciales:** `admin` / `crumbly2024`, hardcodeadas en la línea 492 y **visibles en pantalla** en la línea 136. Ver §8.4.

---

## §2. Qué hace la app hoy

Cinco pantallas con navegación inferior fija.

### 2.1 Inicio
Ventas de hoy (con unidades), ganancia de hoy (con % de margen), ventas de la semana y del mes. Top 5 más vendidos de la semana. Alertas de todo insumo con `cantidad <= minimo`, cubriendo los tres tipos.

### 2.2 Insumos
Tres pestañas con CRUD completo:

| Pestaña | Campos | Unidad |
|---|---|---|
| Materia prima | nombre, cantidad, costo por gramo, mínimo | gramos |
| Empaque | nombre, unidad (texto libre), cantidad, precio unitario, mínimo | libre |
| Toppings | nombre, cantidad, costo, precio de venta suelto, mínimo | unidades |

### 2.3 Productos
Receta = ingredientes (materia × gramos) + empaques (empaque × cantidad) + costo manual de empaque. Costo y ganancia se calculan en vivo al editar.

### 2.4 Ventas
Líneas de `producto × cantidad`, cada una con toppings propios (que se multiplican por la cantidad de la línea), más toppings sueltos. Al registrar descuenta stock de los tres tipos de insumo.

### 2.5 Reportes
Períodos Hoy/Semana/Mes/Año. Ingresos, ganancias, barras de ingresos vs costos, productos más rentables, necesidades de compra semanal. Exporta PDF de ventas, PDF de inventario, CSV de ventas, CSV de inventario. Campo de correo de marca con `mailto:`.

---

## §3. Modelo de datos

### 3.1 Estado actual

En `localStorage['crumbly-state']`:

```js
state = {
  materia:   [{ id, nombre, cantidad /*g*/, costo /*$/g*/, minimo }],
  empaques:  [{ id, nombre, unidad, cantidad, costo, minimo }],
  toppings:  [{ id, nombre, cantidad, costo, precio, minimo }],
  productos: [{
    id, nombre, precio,
    ingredientes:   [{ materiaId, gramos }],
    empaquesUsados: [{ empaqueId, cantidad }],
    empaqueManual, empaque /*derivado*/, costo /*snapshot — bug P0-2*/
  }],
  ventas: [{
    id, fecha /*ISO*/,
    items: [{ productoId | toppingId, nombre, qty, precio, costo }],  // snapshots
    total, ganancia
  }],
  config: { email }
}
```

### 3.2 Estado objetivo

Colecciones nuevas, en el orden en que se introducen:

```js
// Fase B — sin cambios de esquema, solo se elimina productos[].costo (P0-2)

// Fase C — gastos (§9)
gastos: [{
  id, fecha, tipo /*'inventario'|'operativo'|'capex'*/, categoria,
  descripcion, monto, proveedor,
  insumoTipo, insumoId, cantidad, actualizoCosto,   // solo tipo 'inventario'
  vidaUtilMeses                                      // solo tipo 'capex'
}]

// Fase D — costeo (§10)
preparaciones: [{
  id, nombre,
  modo,              // 'porcentaje' | 'directo'
  baseGramos,        // gramos del ingrediente al 100% (modo porcentaje)
  componentes: [{
    tipo,            // 'materia' | 'preparacion'
    refId,
    porcentaje,      // modo porcentaje — fracción del base (1.0 = 100 %)
    gramos           // modo directo
  }]
  // derivados en runtime: gramosTotal, costoTotal, costoPorGramo
}]

costosFijos: [{ id, nombre, monto, periodicidad /*'mensual'|'quincenal'|'anual'*/, activo }]

zonasDomicilio: [{ id, nombre, tiempoAprox, precio, barrios: [] }]

parametros: {
  costosFijosPct,      // 0.30 — global, confirmado
  unidadesMetaMes      // para el prorrateo real de costos fijos (§10.5)
}
// NO hay margenPct: el margen es derivado, no parámetro. Ver §10.4.

// productos gana:
productos: [{
  ...,
  componentes: [{ tipo /*'materia'|'preparacion'*/, refId, gramos }],
  costosFijosPct       // opcional, override del global
  // precio ya existe y es la ENTRADA; ganancia y margen se derivan
}]
```

### 3.3 Reglas del modelo

- **Los ítems de venta son snapshots** (`nombre`, `precio`, `costo` al momento de vender). Es correcto y **no se debe romper**: el histórico no puede alterarse cuando cambian los precios.
- **`productos[].costo` no es un snapshot legítimo**, es un caché que nunca se invalida. Se elimina en la fase B (P0-2) y se sustituye por cálculo en vivo.
- **Un ítem de venta es producto XOR topping**, distinguido por qué ID trae. Toda lógica que recorra `venta.items` debe manejar ambos casos — hoy `calcInventoryNeeds()` solo maneja `productoId` (P1-1).
- **Falta `schemaVersion`.** Las migraciones se hacen por detección de campos ausentes (P1-3). Con las colecciones nuevas esto se vuelve insostenible: hay que versionar.

---

## §4. Mapa de funciones

Todo el JS está en un `<script>` al final (líneas 491-1391).

| Bloque | Funciones | Líneas |
|---|---|---|
| Estado | `loadState`, `saveState`, `uid`, `showToast` | 502-524 |
| Auth | `doLogin`, `doLogout` | 526-549 |
| Navegación | `navTo`, `setInsumosTab` | 551-559, 621 |
| Materia prima | `openModalMateria`, `saveMateria`, `deleteMateria`, `renderMateria` | 562-618 |
| Toppings | `openModalTopping`, `saveTopping`, `deleteTopping`, `renderTopping` | 632-690 |
| Empaque | `openModalEmpaque`, `saveEmpaque`, `deleteEmpaque`, `renderEmpaque` | 693-752 |
| Producto — filas | `addIngRow`, `removeIngRow`, `getIngRowData`, `addEmpRow`, `removeEmpRow`, `getEmpRowData` | 782-831 |
| Producto — CRUD | `openModalProducto`, `calcProdCost`, `saveProducto`, `deleteProducto`, `renderProductos` | 757-899 |
| Ventas — UI | `populateSaleSelects`, `populateToppingSelects`, `toppingOptsHtml`, `addSaleRow`, `removeSaleRow` | 902-938 |
| Ventas — toppings | `addToppingToRow`, `getRowToppings`, `addToppingSoloRow`, `getSoloToppings` | 939-974 |
| Ventas — registro | `updateSaleTotal`, `registrarVenta`, `renderVentasHistorial` | 975-1078 |
| Períodos | `getDateStart`, `getPeriodLabel`, `getPeriodRangeLabel`, `getVentasByPeriod` | 1081-1101 |
| Dashboard | `renderDashboard` | 1102 |
| Reportes | `setReportPeriod`, `renderReportes` | 1138-1169 |
| Inventario | `calcInventoryNeeds`, `renderInventoryNeeds` | 1172-1207 |
| PDF | `generateSalesReportPDF`, `generateInventoryReportPDF` | 1211-1337 |
| CSV / correo | `saveConfigEmail`, `downloadCSV`, `exportVentasCSV`, `exportInventarioCSV`, `shareReportByEmail` | 1340-1382 |
| Utilidades | `closeModal`, `refreshAll` | 1384-1388 |

**Dependencias CDN:** `jspdf@2.5.1`, `jspdf-autotable@3.8.2`, Google Fonts. Sin internet no hay PDFs.

---

## §5. Reglas de negocio implícitas

Lo que el código decide sin que esté escrito en ninguna parte:

1. **La semana empieza el domingo** (`s.getDay()`, línea 1084). Se cambiará a lunes.
2. **Los períodos son "hasta hoy", no cerrados.** "Semana" = desde el domingo pasado hasta ahora.
3. **El consumo semanal se mide sobre la semana en curso**, que empieza en cero cada domingo. Los lunes las proyecciones son inútiles (P1-2).
4. **Un topping en un plato se cobra a su precio suelto.** Para toppings incluidos sin costo al cliente: `precio = 0`; el stock se descuenta igual y el costo sí resta de la ganancia, que es correcto.
5. **Vender no valida stock** (P0-3).
6. **Eliminar un insumo no toca las recetas que lo usan** (P1-4).
7. **El costo del producto es solo costo variable** — sin costos fijos, sin mano de obra, sin merma. Se corrige en §10.

---

## §6. Bugs de la app

Todos en alcance. Los IDs son estables — úsalos para referirte a ellos entre sesiones.

### P0 — Críticos

| ID | Bug | Dónde | Fix |
|---|---|---|---|
| **P0-1** | **No se puede deshacer ni editar una venta.** Un registro equivocado queda para siempre y ya descontó stock de tres tipos de insumo. | `registrarVenta()` línea 997 | Botón eliminar en "Últimas ventas" que revierta el stock. Si la receta cambió desde la venta, la reversión es aproximada — avisarlo en la UI. |
| **P0-2** | **El costo de los productos queda congelado.** Cambias el precio de un ingrediente y todos los productos siguen con el margen viejo hasta que los reabras y guardes uno por uno. | `saveProducto()` línea 867, `renderProductos()` línea 884 | Eliminar `productos[].costo` persistido; calcular al vuelo con `getCostoProducto(p)`. Las ventas ya guardan su propio snapshot. |
| **P0-3** | **Se vende sin stock, sin aviso.** Cuatro `Math.max(0, ...)` clampean a cero en silencio. | líneas 1012, 1016, 1027, 1037 | Validar consumo total contra stock antes de confirmar; `confirm()` con el faltante detallado y opción de seguir. |
| **P0-4** | **`saveState()` falla en silencio.** Al topar los ~5 MB de `localStorage`, las ventas dejan de guardarse sin ningún indicio hasta que recargues. | línea 516, `catch(e){}` | Toast de error persistente + exportación de emergencia. Se resuelve de raíz en la fase E. |
| **P0-5** | **Sin respaldo, un solo navegador.** | arquitectura | Fase E (§12). |

### P1 — Importantes

| ID | Bug | Dónde | Fix |
|---|---|---|---|
| **P1-1** | **El reporte de inventario ignora empaque y toppings.** Solo recorre `state.materia`, y busca por `item.productoId`, así que los ítems de topping se saltan siempre. Consecuencias: la tarjeta "Necesidades de compra" nunca avisa que se acaban las cajas; el PDF titula **"Inventario completo"** una tabla que solo tiene materia prima; el consumo de toppings no se mide en ningún lado. | `calcInventoryNeeds()` líneas 1172, 1176 | Generalizar a los tres arrays y a ambos tipos de ítem. |
| **P1-2** | **"Semanas restantes" sesgado.** El consumo se mide sobre la semana calendario en curso. | línea 1173 | Ventana móvil de 7 días; idealmente promediar 2-4 semanas. |
| **P1-3** | **Migración de esquema incompleta.** `state.productos.forEach(...)` sin verificar que exista; `materia` y `ventas` sin protección. | líneas 502-514 | `schemaVersion` + migraciones explícitas. Obligatorio antes de la fase D. |
| **P1-4** | **Eliminar un insumo rompe las recetas.** Quedan IDs huérfanos; el costo baja en silencio al reeditar. | líneas 596, 668, 729 | Avisar cuántos productos lo usan; o marcar inactivo en vez de borrar. |
| **P1-5** | **Toppings fantasma con cantidad 0.** Si el campo de cantidad del plato queda vacío pero la línea ya tiene un topping, se registra `"Chocolate (topping) x0"`. | líneas 1020-1029 | `if (totQty > 0)` antes del `push`. |

### P2 — Menores

| ID | Problema | Dónde | Fix |
|---|---|---|---|
| P2-1 | Las pestañas de Insumos se apagan al cambiar el período en Reportes (`querySelectorAll('.tab-btn')` es global y ambos grupos comparten la clase). | línea 1140 | `el.parentElement.querySelectorAll('.tab-btn')` |
| P2-2 | Nombres sin escapar en todos los `innerHTML`. | render* | función `esc()` |
| P2-3 | Montos sin separador de miles (`$5000`). | global | `toLocaleString('es-CO')` |
| P2-4 | La barra de costos se desborda del 100 % con margen negativo. | línea 1155 | `Math.min(100, ...)` |
| P2-5 | `doLogout()` no vuelve al dashboard. | línea 544 | reset de navegación |
| P2-6 | Sin botón de resetear datos de prueba. | — | botón con doble confirmación |
| P2-7 | Dependencia de CDN: sin internet no hay PDFs ni tipografía. | líneas 489-490 | inlinear o aceptar |
| P2-8 | `insumosTab` se asigna y nunca se lee. | línea 500 | borrar |
| P2-9 | CSV con coma; Excel es-CO espera `;`. Sheets lo maneja bien. | línea 1348 | documentar o hacer configurable |
| P2-10 | El desglose de empaque no aparece línea por línea en el PDF. | — | — |

---

## §7. Roadmap

| Fase | Qué | Depende de | Esfuerzo |
|---|---|---|---|
| **A** | Consolidar en GitHub (§8) | — | Bajo |
| **B** | Arreglar P0-1…P0-3, P1-3, P1-5 | A | Medio |
| **C** | Módulo de gastos (§9) | B | Medio |
| **D1** | Preparaciones intermedias + costeo por porcentaje panadero (§10.2, §10.3) | B, P1-3 | **Alto** |
| **D2** | Costos fijos, margen, precio objetivo (§10.4, §10.5) | D1, C | Medio |
| **D3** | Domicilios por zona (§10.6) | D1 | Bajo |
| **D4** | Migrar los datos del spreadsheet, con los errores corregidos (§11) | D1-D3 | Medio |
| **E** | Backend en Google Sheets (§12) | D | Alto |
| **F** | Resto de P1 y P2 | — | Bajo cada uno |

**Nota de orden:** D1 es la pieza que sostiene todo lo demás del costeo — sin preparaciones no se puede representar ni una sola de tus recetas reales. P1-3 (versionado de esquema) hay que hacerlo **antes** de D1, porque D1 agrega cuatro colecciones nuevas y sin migraciones explícitas cada cambio arriesga los datos existentes.

---

## §8. Fase A — GitHub

### 8.1 Estructura

```
crumbly/
├── index.html          # antes "crumbly 2.html"
├── README.md
├── HANDOFF.md          # este documento
├── docs/
│   ├── costeo.md       # §10 ampliado: fórmulas y ejemplos verificados
│   └── migracion.md    # mapeo hoja → producto, con correcciones (§11)
├── backend/
│   └── Codigo.gs       # Apps Script (fase E)
└── .gitignore
```

### 8.2 Puesta en marcha

```bash
mkdir -p ~/crumbly && cd ~/crumbly
git init
cp ~/Downloads/"crumbly 2.html" index.html
git add -A
git commit -m "Crumbly: versión inicial con empaque, toppings, CSV y correo"
gh repo create crumbly --private --source=. --push
```

### 8.3 GitHub Pages

Settings → Pages → Source `main` / root. Queda en `https://<usuario>.github.io/crumbly/`.

Ventajas: URL estable, se guarda en la pantalla de inicio del teléfono, se actualiza con un `git push`, y el `fetch` a Apps Script funciona (desde `file://` no).

**Cuidado — el `localStorage` está atado al origen.** Los datos del archivo local **no aparecen** en la URL de Pages. Antes de migrar:

```js
copy(localStorage.getItem('crumbly-state'))          // consola del navegador viejo
localStorage.setItem('crumbly-state', '<pegar>')     // consola del nuevo origen
```

### 8.4 Seguridad

Con repo público, la contraseña queda a la vista de cualquiera — y ya está impresa en la pantalla de login (línea 136). Hoy el riesgo es bajo porque los datos son locales de cada navegador. **Eso cambia en la fase E:** en cuanto haya backend compartido, ese login decorativo pasa a ser la única puerta a tus datos reales, y el token del Apps Script quedaría también en el código fuente.

**Repo privado.** No es negociable si se va a conectar el Sheet.

---

## §9. Fase C — Módulo de gastos

### 9.1 El problema contable, primero

Hoy la app calcula `ganancia = ingresos − costo de los insumos consumidos`. Ese costo ya está contabilizado en cada venta.

Si además registras *"compré 5 kg de harina por $40.000"* como gasto que resta de la utilidad, **restas la harina dos veces**: una al comprarla y otra al venderla dentro de un waffle. Las semanas de mucha compra parecerían pérdidas.

La solución es clasificar cada gasto por **cómo afecta los números**:

| Tipo | Qué es | ¿Resta de la utilidad? | ¿Resta de la caja? | ¿Aumenta stock? |
|---|---|---|---|---|
| `inventario` | Materia prima, empaque, toppings | **No** — ya está en el costo de ventas | Sí | **Sí** |
| `operativo` | Publicidad, arriendo, servicios, transporte, nómina | Sí | Sí | No |
| `capex` | Waflera, nevera, mobiliario, tecnología | No de golpe — se deprecia (§10.7) | Sí, el mes de compra | No |

Resultado — tres cifras distintas y todas verdaderas:

```
Utilidad bruta = Ingresos − Costo de ventas
Utilidad neta  = Utilidad bruta − Gastos operativos − Depreciación
Flujo de caja  = Ingresos − (compras de inventario + gastos operativos + capex)
```

La primera dice si el negocio es rentable; la tercera dice si te alcanza la plata este mes. En un negocio pequeño la tercera manda en el día a día, pero solo la primera dice si el modelo funciona.

### 9.2 Beneficio lateral: comprar recarga el stock

Hoy la única forma de reponer inventario es editar el número a mano, sin rastro de lo que pagaste. Con el módulo de gastos, registrar una compra `inventario`:

1. Suma la cantidad al stock del insumo.
2. **Actualiza el costo unitario** con lo que realmente pagaste (`monto / cantidad`).
3. Deja el gasto con fecha y proveedor.

El punto 2 es clave: junto con el fix de P0-2, hace que **los costos se mantengan al día solos**. Es exactamente lo que hoy haces a mano en la hoja `BASE PRECIOS` — donde cada celda es un `=23900/1000` que actualizas cuando cambia el precio del proveedor.

### 9.3 Categorías

| Tipo | Categorías |
|---|---|
| `inventario` | Materia prima, Empaque, Toppings |
| `operativo` | Publicidad, Arriendo, Servicios, Transporte, Nómina, Aseo, Otros |
| `capex` | Equipos de cocina, Mobiliario, Tecnología, Adecuaciones |

Las tres que pediste quedan cubiertas: compra de materia prima → `inventario`, publicidad → `operativo`, implementos → `capex`.

### 9.4 Interfaz

**Gastos como pestaña dentro de Reportes** (no como sexta pestaña de la barra inferior: cinco ya aprietan en pantalla pequeña, y los gastos se registran pocas veces por semana).

- Botón "+ Registrar gasto" con formulario que cambia según el tipo: `inventario` muestra selector de insumo y cantidad; `capex` muestra vida útil.
- Lista del período agrupada por categoría, con editar y eliminar.
- Totales por tipo arriba.

### 9.5 Cambios en Reportes

Cascada completa del período:

```
Ingresos                    $ XXX
− Costo de ventas           $ XXX
= Utilidad bruta            $ XXX   (XX %)

− Gastos operativos         $ XXX
    Publicidad              $ XXX
    Arriendo                $ XXX
− Depreciación              $ XXX
= Utilidad neta             $ XXX   (XX %)

Flujo de caja               $ XXX
```

Más: `exportGastosCSV()`, desglose de gastos en el PDF, y una tarjeta de utilidad neta del mes en el dashboard.

---

## §10. Fase D — Modelo de costeo (el spreadsheet)

Todo esto sale de `COSTOS WAFFLES.xlsx`, 22 hojas: 1 de precios base, 15 de productos, 1 de armado libre, 4 de batidos, 1 de domicilios.

### 10.1 Estructura del spreadsheet

| Hoja | Rol |
|---|---|
| `BASE PRECIOS` | 55 insumos con costo por gramo, cada uno como `=precio_paquete/gramos_paquete` |
| 15 hojas de producto | Una por receta: waffles sin gluten, belgas, croffles, batidos |
| `ARMA TU CRUMBLY` | Armado libre: base + salsas + frutas + toppings, con precio de venta por componente (la columna de precio para apps se ignora en la migración) |
| `DOMICILIOS` | 3 zonas por tiempo de recorrido: $4.000 / $6.000 / $8.000, con listado de barrios y zonas fuera de cobertura |
| `Hoja1` | Waffle de caramelo salado — hoja de producto sin renombrar |

### 10.2 Preparaciones intermedias — el concepto que falta en la app

Es el cambio más importante. Hoy la app modela `materia prima → producto`. El spreadsheet modela **`materia prima → preparación → producto`**, y las preparaciones se reutilizan entre productos.

Ejemplo real, hoja `WAFLE NEW YORK SIN GLUTEN`:

- **Masa de waffles** (columnas F-J): 10 ingredientes en porcentaje panadero → 583,44 g totales, $7.269,15 → **$12,46 por gramo**
- **Salsa de frutos rojos** (columnas F-J, fila 17+): moras + fresas + azúcar → 975 g, $10.638,75 → **$10,91 por gramo**
- **El producto** usa 190 g de masa y 60 g de salsa, más helado, crema, fresas, frambuesas y arándanos directos.

Y esa misma salsa se referencia desde `ARMA TU CRUMBLY` (`='WAFLE NEW YORK SIN GLUTEN'!J24`). Hoy eso es una referencia entre celdas, frágil (§11, E10); en la app sería una relación real.

**Porcentaje panadero:** un ingrediente es el 100 % (la harina) y los demás se expresan como fracción de él.

```
gramos(i)      = baseGramos × porcentaje(i)
costoTotal     = Σ gramos(i) × costoPorGramo(i)
gramosTotal    = Σ gramos(i)
costoPorGramo  = costoTotal / gramosTotal      ← lo que consume el producto
```

Verificado contra la hoja: base 100 g de harina, suma de porcentajes 5,8344 → 583,44 g; costo $7.269,15; costo por gramo $12,46. ✓

**Preparaciones anidadas:** una preparación puede usar otra. La app debe detectar ciclos (A usa B, B usa A) y rechazarlos al guardar.

### 10.3 Costo del producto

```
costoComponentes = Σ (gramos × costoPorGramo)     // materia directa y preparaciones
costoEmpaque     = Σ (cantidad × costoUnitario)
costoVariable    = costoComponentes + costoEmpaque
```

Es lo que la app ya hace, extendido para aceptar preparaciones como componente.

### 10.4 Recargo de costos fijos, precio y margen

**Confirmado el 10 de agosto de 2026 — el flujo va al revés de como está en el spreadsheet.** En las hojas, el margen es un parámetro y el precio se calcula a partir de él. En la operación real es al contrario: **el precio de venta lo deciden ustedes**, y el margen es la consecuencia.

Por eso la app invierte la fórmula:

```
costoFinal = costoVariable × (1 + 0,30)          ← recargo de costos fijos, global

precioVenta                                       ← ENTRADA, decisión del negocio

ganancia     = precioVenta − costoFinal
markupPct    = ganancia / costoFinal              ← "margen" en el lenguaje de las hojas
margenPct    = ganancia / precioVenta             ← margen contable, sobre precio
```

**El recargo de costos fijos es 30 % global**, igual para todos los productos, con posibilidad de override puntual si alguna línea lo justifica.

Ejemplo con todas las decisiones aplicadas (`WAFLE NEW YORK SIN GLUTEN`, ya con E1 y E2 corregidos y el empaque nuevo):

| Concepto | Valor |
|---|---|
| Costo componentes | $7.272,81 |
| + Empaque waffle | $2.550,00 |
| = Costo variable | $9.822,81 |
| Costos fijos (30 %) | $2.946,84 |
| = **Costo final** | **$12.769,65** |
| **Precio de venta** (decisión) | **$22.000,00** |
| = **Ganancia por unidad** | **$9.230,35** |
| Markup sobre costo | 72,3 % |
| Margen sobre precio | 42,0 % |

**Las dos cifras de "margen" hay que mostrarlas etiquetadas y separadas.** El 72,3 % es sobre el costo (lo que las hojas llaman "margen") y el 42,0 % es sobre el precio (el margen contable). Son el mismo dinero expresado sobre bases distintas, y confundirlas al negociar un precio o comparar productos lleva a decisiones equivocadas.

**Precio objetivo — de fórmula principal a calculadora auxiliar.** Como el precio ya no se deriva, la fórmula `costoFinal × (1 + markup)` deja de ser el centro del modelo. Vale la pena conservarla como herramienta de consulta: *"para lograr 70 % de markup en este producto tendrías que cobrar $21.708"*. Útil al fijar el precio de un producto nuevo o al revisar precios tras una subida de insumos, pero no es lo que manda.

**Consecuencia práctica:** cuando suba el costo de un insumo, la app no cambiará ningún precio — mostrará que el margen de los productos afectados bajó, y tú decides si subes el precio o absorbes el golpe. Eso es exactamente lo que hoy no puedes ver hasta que reabres las hojas una por una.

### 10.5 Costos fijos reales vs. el recargo del 30 %

Esto merece atención porque es donde el spreadsheet y la contabilidad se separan.

El "30 % de costos fijos" **no es una asignación de costos fijos** — es un recargo proporcional al costo variable. Por definición un costo fijo no cambia con el volumen, pero este sí: si vendes el doble, el "costo fijo" recaudado se duplica. Además un producto caro carga más arriendo que uno barato, sin ninguna razón operativa.

Como **herramienta de fijación de precios es perfectamente válida** y es la que ya usas. El problema es que no te dice si el recargo alcanza para pagar el arriendo real.

**La app puede tener las dos vistas y contrastarlas**, que es el verdadero valor de migrar esto:

```
Recargo recuperado en el período = Σ (costoVariable(venta) × costosFijosPct)
Costos fijos reales del período  = Σ costos fijos + depreciación   ← de §9

Cobertura = recuperado / reales
```

Y un mensaje directo: *"Con el 30 % actual recuperaste $1.240.000 este mes. Tus costos fijos reales fueron $1.680.000. Te faltó un 26 % — el recargo debería estar cerca del 38 %."*

Eso convierte un número heredado en una decisión con evidencia. Ninguna hoja de cálculo te lo puede decir, porque requiere cruzar recetas con ventas reales y con gastos registrados — las tres cosas que la app va a tener juntas.

### 10.6 Domicilios

Tres zonas por tiempo de recorrido:

| Zona | Tiempo | Precio | Barrios |
|---|---|---|---|
| 1 | 5-10 min | $4.000 | Buenos Aires, Caicedo, La Milagrosa, El Salvador, Alejandro Echavarría, Miraflores, Bomboná |
| 2 | 10-15 min | $6.000 | Boston, Prado Centro, Villa Hermosa, San Diego, Centro, Loreto |
| 3 | 15-20 min | $8.000 | Manila, Castropol, Ciudad del Río, Poblado bajo, Belén Fátima, Los Colores |

Fuera de cobertura: Envigado, Sabaneta, Itagüí, Robledo, Castilla, Aranjuez, Bello. Sin entregas de más de 20 minutos.

En la app: `zonasDomicilio` como catálogo y una línea opcional de domicilio en la venta. **Decisión pendiente:** ¿el domicilio es ingreso con costo asociado (pagas al mensajero) o un pasante que no debería contar como venta? Afecta el margen reportado (§13).

### 10.7 Depreciación de implementos

Un `capex` no resta de golpe:

```
depreciacionMensual = monto / vidaUtilMeses
```

Una waflera de $1.200.000 a 36 meses aporta $33.333/mes a los costos fijos reales, no $1.200.000 en el mes de compra. Referencias: cocina 36-60 meses, mobiliario 60-120, tecnología 24-36.

### 10.8 Qué gana la app frente al spreadsheet

| Hoy en Excel | En la app |
|---|---|
| Actualizas `BASE PRECIOS` a mano cuando cambia un precio | Se actualiza solo al registrar la compra (§9.2) |
| Referencias entre celdas que se rompen al insertar filas | Relaciones por ID |
| El costo asume que compraste al precio de la última vez que editaste | El costo refleja lo que realmente pagaste |
| Precio objetivo calculado sobre un volumen supuesto | Contrastado contra ventas reales (§10.5) |
| Sin conexión con el inventario | El costeo y el stock son el mismo dato |
| Un error de fórmula pasa desapercibido por meses (§11) | La fórmula está en un solo lugar, probada |

---

## §11. Errores encontrados en el spreadsheet

Trece. Los primeros tienen impacto en dinero.

### E1 · Suma en vez de multiplicación — **cuesta plata**

Varias celdas usan `=SUM(B:C)` sobre `gramos` y `costo por gramo`, **sumando** en vez de multiplicar.

`WAFLE NEW YORK SIN GLUTEN`, fila 18 (Frambuesas):

```
D18 = SUM(B18:C18) = 6 + 160,48 = $166,48        ← actual
      B18 × C18    = 6 × 160,48 = $962,88        ← correcto
```

También en: `ARMA TU CRUMBLY` D13 (kiwi) y D15 (banano); `WAFFLE BELGA FRUTOS ROJOS` J5, J6, J8, J9, J10, J11, D11, D17 — en esa hoja **casi toda la masa está mal calculada**, solo J4 usa la multiplicación correcta.

### E2 · Referencia a la fila equivocada — **cuesta plata**

`WAFLE NEW YORK SIN GLUTEN` fila 17 (Fresas): `D17 = B18*C18` — usa los valores de la fila 18 en vez de la 17. Error clásico de arrastre.

```
D17 = B18 × C18 = 6 × 160,48  = $962,88          ← actual
      B17 × C17 = 50 × 13     = $650,00          ← correcto
```

**Impacto combinado de E1 + E2 en ese producto:**

| | Actual | Correcto |
|---|---|---|
| Fresas + Frambuesas | $1.129,36 | $1.612,88 |
| Costo producto | $6.789,29 | $7.272,81 |
| Costo total | $9.589,29 | $10.072,81 |
| Costo final (+30 %) | $12.466,07 | $13.094,65 |
| Precio objetivo (+70 %) | $21.192,32 | **$22.260,91** |

**Estás subcosteando ese waffle en $483,52 por unidad**, y el precio objetivo real está $1.068 por encima del calculado. Lo vendes a $22.000 — o sea que estás justo en el límite, no por encima como parece en la hoja.

### E3 · La ganancia se calcula sobre el precio objetivo, no sobre el real

En todas las hojas de producto, la ganancia (`D29 = D27 × D28`) se calcula sobre el **precio objetivo**, no sobre el precio que realmente cobras.

En New York el precio objetivo es $21.192,32 pero vendes a $22.000, así que la ganancia real por unidad es $9.533,93 y no los $8.726,25 que muestra la hoja — **$807,68 más de lo que crees**.

En la app esto se resuelve solo: se muestran las dos cifras separadas y etiquetadas — *ganancia objetivo* (la que buscas al fijar el precio) y *ganancia real* (la del precio vigente), con la desviación entre ambas.

*(Nota: `D31 = 22000` no tiene etiqueta en la columna B; asumo que es el precio real de tienda. Confírmalo — decisión 8 de §13.)*

### E4 · Costo por gramo mal calculado

`WAFFLE BELGA FRUTOS ROJOS` J13, rotulado "Total costo gramo": `=SUM(J4:J11)` — devuelve el costo **total**, sin dividir por los gramos. Debería ser `J12/H12`. Y `I12 = SUM(I4:I11)` suma costos por gramo entre sí, lo cual no significa nada.

### E5 · Precios hardcodeados que se desincronizan

Las hojas de belgas y croffles escriben los costos a mano (`5,51`, `4,0`, `11,33`, `24`, `14`, `4,9`) en vez de referenciar `BASE PRECIOS`. Y ya están desactualizados: la harina de trigo en `BASE PRECIOS` es `=10300/2500 = $4,12 por gramo`, no `$5,51`. **Esas hojas cuestan con precios viejos.**

### E6 · Costo de empaque inconsistente — **resuelto**

El spreadsheet tenía cuatro valores distintos: $3.000 en `BASE PRECIOS` B53, $2.800 hardcodeado en waffles sin gluten y en `ARMA TU CRUMBLY`, $1.372 en batidos, y solo `Hoja1` usaba la referencia.

**Son dos empaques distintos y ninguno de los valores del Excel está vigente.** En la app se registran como dos ítems separados en la pestaña Empaque:

| Empaque | Costo unitario | Se usa en |
|---|---|---|
| Empaque waffle | **$2.550** | Waffles y croffles |
| Empaque malteada | **$1.650** | Batidos y malteadas |

Todos los productos migrados apuntan al empaque que les corresponde. Ningún valor de empaque queda hardcodeado.

### E7 · Porcentajes de costos fijos y margen sin criterio — **resuelto**

30 % / 35 % / 40 % de costos fijos y 40 % / 49,1 % / 60 % / 70 % / 126 % de margen, sin razón registrada.

**Resuelto:** el recargo de costos fijos es **30 % global**. El margen deja de ser parámetro — el precio de venta es la entrada y el margen se deriva de él (§10.4). Las variaciones entre hojas eran consecuencia de despejar el margen a mano para llegar a un precio ya decidido; invertir la fórmula elimina el problema de raíz.

### E8 · Referencias entre hojas frágiles

`ARMA TU CRUMBLY` depende de celdas concretas de otras hojas: `'WAFLE BRASIL SIN GLUTEN'!J43`, `'WAFFLE BELGA FRUTOS ROJOS'!C20`, `'WAFLE BRASIL SIN GLUTEN'!J32`, `'WAFLE DE CARAMELO'!J26`. **Insertar una sola fila en cualquiera de esas hojas rompe el cálculo en silencio** — sin error visible, solo un número equivocado.

### E9 · Celdas rotas o vacías

- `WAFLE NEW YORK` D22 `=+C22` y D23 `=+C23` apuntan a celdas vacías → la fila "Caja" siempre suma $0.
- `Hoja1` B23 contiene el texto `1qaz` (tecleo accidental).
- `BASE PRECIOS`: `NUTELLA CASERA` y `PIMIENTA GUAYABA` sin costo; celdas huérfanas en E90, F92, F96.
- `WAFFLE BELGA FRUTOS ROJOS` C15 (helado) = 0 → el helado no cuesta nada en ese producto.

### E10 · Columna de masa duplicada y sin usar — **resuelto**

`WAFLE NEW YORK` tiene dos masas: columnas F-J (harina de arroz + almidón agrio, sin gluten) y columnas L-P (harina de trigo). El producto solo usa la primera; la segunda se calcula y se ignora. Mismo patrón en las demás hojas sin gluten.

**Vigente: la de harina de arroz**, columnas F-J — que es además la que los productos ya consumen. La de harina de trigo (columnas L-P) no se migra.

| | Masa vigente (arroz) | Descartada (trigo) |
|---|---|---|
| Harina | **Arroz, $5,80 por gramo** (`BASE PRECIOS` B24) | Trigo, $4,12 por gramo (B23) |
| Almidón agrio | Sí | No |
| **Costo de la masa terminada** | **$12,46 por gramo** | $8,11 por gramo |

> **Aclaración — son dos cifras distintas y ambas están en pesos por gramo:**
>
> - **$5,80 por gramo** es el costo de la **harina de arroz** como insumo suelto.
> - **$12,46 por gramo** es el costo de la **masa ya preparada**, que además de harina lleva azúcar, claras, yemas, mantequilla, queso crema, leche, polvo de hornear, sal y almidón agrio.
>
> Lo que consume el producto es el segundo. En pesos concretos: el waffle usa 190 g de masa = **$2.367 por unidad** (celda `D9` de la hoja).
>
> **Nota de notación en este documento:** la coma separa decimales y el punto separa miles, como es habitual en Colombia. `$12,46` son doce pesos con cuarenta y seis centavos; `$12.460` serían doce mil cuatrocientos sesenta.

### E11 · `Hoja1` sin nombre

Es el waffle de caramelo salado, un producto activo, en una hoja llamada `Hoja1`. Fácil de borrar por accidente.

### E12 · ~~Comisión de Rappi inconsistente~~ — no aplica

25 % en waffles sin gluten, 23 % en belgas, croffles y armado libre. **Sin efecto:** no se opera por aplicaciones. Ver §11.10.

### E13 · ~~IVA~~ — no aplica

**Resuelto el 10 de agosto de 2026:** el negocio no cobra IVA sobre sus ventas. El único IVA del spreadsheet es el que Rappi aplica sobre su propia comisión, y ese canal no está activo. No se modela IVA en ninguna parte de la app.

### §11.10 · Si algún día entran a aplicaciones de domicilio

Las columnas de precio para apps existen en `ARMA TU CRUMBLY` (33 componentes con doble precio) y en cada hoja de producto (`V.RAPPI`, `C.RAPPI`, `I.RAPPI`, `RECIBO`, `DIFERENCIA RAPPI Y TIENDA`). **Nada de eso se migra ahora.** Si el negocio entra a una plataforma más adelante, el modelo a implementar es:

```
comision      = precioCanal × comisionPct
ivaComision   = comision × ivaComisionPct
recibo        = precioCanal × (1 − comisionPct × (1 + ivaComisionPct))
gananciaCanal = recibo − costoFinal
```

Verificado contra la hoja de New York: $32.000 × 25 % = $8.000 de comisión, IVA 19 % sobre la comisión = $1.520, recibo $22.480. ✓ Requiere agregar una colección `canales` y `preciosCanal` por producto y por topping.

**Ojo si eso pasa:** las hojas comparan la ganancia de Rappi (calculada sobre precio real) contra la de tienda (calculada sobre precio objetivo) — ver E3. Comparadas correctamente, la ventaja de Rappi en New York era de $480 por unidad, no de $1.288 como dice la hoja. El error de método sobreestima la plataforma en un 168 %.

### Plan de corrección

No se corrige el Excel. **Los datos se migran a la app ya corregidos** (fase D4) y se documenta en `docs/migracion.md` qué cambió respecto a la hoja original, para que los precios nuevos no aparezcan sin explicación.

**Ya no hay decisiones pendientes que bloqueen la migración:** E6, E7 y E10 quedaron resueltos el 10 de agosto de 2026 (§13).

---

## §12. Fase E — Backend en Google Sheets

### 12.1 Aclaración

**Adobe no tiene producto de hojas de cálculo.** Asumo Google Sheets, que además es coherente con el `.xlsx` que ya manejas y con lo que venía discutiéndose. Si querías otra cosa, §12.5 cubre alternativas; la arquitectura no cambia, solo el adaptador.

### 12.2 Qué resuelve

Los datos dejan de vivir en un solo navegador (P0-5), se acaba el límite de 5 MB y el fallo silencioso (P0-4), puedes registrar ventas desde el celular y ver reportes desde el computador, y — lo más relevante dado tu flujo actual — **puedes seguir mirando y corrigiendo los datos crudos en una hoja**, y montar tus propias tablas dinámicas encima.

### 12.3 Arquitectura

```
index.html (GitHub Pages)
      │  fetch() — JSON sobre HTTPS
      ▼
Google Apps Script Web App (doGet / doPost)
      │
      ▼
Google Sheet — una hoja por colección
   ├── materia
   ├── empaques
   ├── toppings
   ├── preparaciones
   ├── prep_componentes     (normalizada)
   ├── productos
   ├── prod_componentes     (normalizada)
   ├── ventas
   ├── venta_items          (normalizada)
   ├── gastos
   ├── costos_fijos
   ├── zonas_domicilio
   └── config
```

**`localStorage` como caché, Sheets como fuente de verdad.** La app sigue funcionando sin conexión y sincroniza cuando hay red. Importa de verdad si vas a registrar ventas en un punto con señal irregular; la alternativa (leer y escribir directo en cada operación) es más simple pero deja la app inutilizable sin internet, lo cual es inaceptable para un punto de venta.

### 12.4 Detalles técnicos que muerden

- **CORS.** Apps Script no responde a `OPTIONS`. Los `POST` deben ir con `Content-Type: text/plain` para evitar el preflight, y parsear con `JSON.parse(e.postData.contents)`. Con `application/json` el navegador bloquea la petición.
- **Autenticación.** Publicado como "cualquiera puede acceder", la URL **es** la credencial. Mínimo: token compartido validado en el script. Ese token queda en el código fuente del HTML → repo privado (§8.4).
- **Concurrencia.** Dos dispositivos escribiendo a la vez se pisan. Usar `LockService` en toda escritura.
- **Cuotas.** Hay límites diarios de ejecución. Para tu volumen no es problema, pero no sincronices en cada tecla: agrupa y escribe al confirmar.
- **Modelo de escritura.** `append` para ventas y gastos (solo crecen); reescritura por hoja para insumos, productos y preparaciones (pocos y editables).
- **Normalización.** `ventas[].items[]`, `productos[].componentes[]` y `preparaciones[].componentes[]` son arrays anidados y una hoja es plana. Guardarlos como JSON en una celda es simple pero deja el Sheet inservible para fórmulas. **Como el objetivo es que puedas seguir analizando en Sheets, hay que normalizar en hojas aparte.**

### 12.5 Alternativas

| Opción | A favor | En contra |
|---|---|---|
| **Google Sheets + Apps Script** | Gratis, ya usas hojas, datos inspeccionables a mano | Hay que mantener el script; concurrencia frágil |
| **Airtable** | API real, tipos, permisos, relaciones | Plan gratis limitado; menos flexible para fórmulas propias |
| **Supabase** | Base de datos de verdad, auth incluida | Ya no es "una hoja"; más curva |
| **Excel / OneDrive** | Si tu flujo vive en Microsoft | La API de Graph es bastante más incómoda |

Si el requisito es *"quiero ver y tocar mis datos en una hoja"*, Sheets es correcto. Si es *"que no se pierdan"*, Supabase es técnicamente mejor y el CSV ya cubre mirarlos en una hoja cuando haga falta.

### 12.6 Lo que un backend NO resuelve

- **Correo automático con PDF adjunto** desde el navegador: sigue sin poderse. *Pero* con Apps Script sí — `MailApp.sendEmail()` generando el PDF del lado del servidor. Es la vía si eso te importa.
- **Sincronización en vivo bidireccional** (editar el Sheet a mano y que la app se entere al instante): requiere polling o webhooks; posible, pero suma complejidad.

---

## §13. Decisiones abiertas

### Resueltas

| Pregunta | Decisión (10 ago 2026) |
|---|---|
| ¿IVA sobre las ventas? | **No.** El negocio no lo cobra. El único IVA del spreadsheet es el de la comisión de Rappi, y ese canal no está activo. No se modela IVA. |
| ¿Precios por canal / plataformas de domicilio? | **Fuera de alcance.** Todavía no operan en aplicaciones. Ver §11.10 si cambia. |
| ¿Recargo de costos fijos? (E7) | **30 % global**, con override por producto disponible pero sin usar por defecto. |
| ¿Qué margen? (E7) | **Ninguno como parámetro.** El precio de venta es la entrada; ganancia y margen se derivan (§10.4). |
| ¿Cuál masa sin gluten? (E10) | **La de harina de arroz.** El insumo cuesta $5,80 por gramo; la masa terminada, $12,46 por gramo. La de trigo no se migra. |
| ¿Cuánto cuesta el empaque? (E6) | **Dos empaques distintos:** waffle **$2.550**, malteada **$1.650**. |

**Con esto, la migración de datos (fase D4) queda desbloqueada.**

### Pendientes

Ninguna bloquea el arranque; todas tienen recomendación y pueden decidirse sobre la marcha.

| # | Pregunta | Bloquea | Recomendación |
|---|---|---|---|
| 1 | **¿El domicilio es ingreso o pasante?** ¿Le pagas a un mensajero? | §10.6 | Ingreso con su costo asociado, para ver si la zona 3 se sostiene |
| 2 | **Al comprar insumos, ¿el costo se reemplaza o se promedia** con el stock existente? | §9.2 | Promedio ponderado; reemplazo si prefieres simplicidad |
| 3 | **¿Repo público o privado?** | §8.4 | **Privado** |
| 4 | **`D31 = 22000` sin etiqueta** — ¿es el precio real de tienda del New York? (E3) | Verificación de E3 | — |
| 5 | ¿La semana empieza **lunes**? | P1-2 | Lunes |
| 6 | ¿Cuántas personas usarán la app a la vez? | Concurrencia (§12.4) | — |

---

## §14. Cómo retomar

1. Trabaja sobre el repo, nunca sobre copias en Descargas (§1).
2. `HANDOFF.md` vive en el repo y se actualiza en el mismo commit que el cambio que describe.
3. Los IDs son estables entre sesiones: `P0-2` para bugs de la app, `E3` para errores del spreadsheet.
4. Para una sesión nueva basta abrir el repo: `index.html` y `HANDOFF.md` son todo el contexto.

### Estado de las cuatro peticiones

| # | Petición | Estado |
|---|---|---|
| 1 | Documento estructurado y completo | ✅ Este archivo |
| 2 | GitHub + backend en spreadsheet | 📋 Especificado (§8, §12) — falta confirmar Google Sheets |
| 3 | Reporte de ventas y gastos | 📋 Especificado (§9) — listo para implementar |
| 4 | Fórmulas de costos fijos, costo por producto y ganancias | ✅ Extraídas, verificadas y con todas las decisiones tomadas (§10) + errores documentados (§11) |

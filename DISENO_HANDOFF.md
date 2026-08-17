# Crumbly — Handoff de rediseño visual

> Este documento es solo para **diseño** (layout, componentes, paleta, responsive). La lógica de negocio (fórmulas, cálculos, datos) ya existe y funciona — casi todo lo pedido aquí es reorganizar cómo se ve, no qué hace. Las dos excepciones están marcadas al final en "Esto no es solo diseño".

---

## 1. Qué es Crumbly hoy

App de una sola página (`index.html`, HTML/CSS/JS sin framework) para un negocio de waffles/obleas: inventario, productos, ventas tipo POS, clientes, gastos y reportes. Corre en el navegador, guarda en `localStorage`.

**Diseño actual:** mobile-first, ancho fijo máx. 480px, paleta clara cálida (crema/beige/café), navegación inferior fija de 5 íconos, tarjetas blancas con borde beige. Funcional pero sin vista de escritorio real y sin gráficas.

**Paleta actual** (por si se quiere conservar la identidad de marca dentro del nuevo layout):
```
--cream: #F5EFE6   --beige: #E8DDD0   --warm: #D4C4B0
--brown: #8B6F5E   --dark:  #4A3728   --accent: #C4956A
--text:  #3D2B1F   --muted: #7A6358   --white: #FDFAF7
--danger:#C45A4A   --success: #5A8C6B
```
Tipografías: `Playfair Display` (serif, títulos) + `DM Sans` (texto).

---

## 2. Referencias de diseño (adjuntas)

Tres capturas de referencia, todas en **modo oscuro**, estilo dashboard SaaS:

1. **Taskplus (onboarding)** — sidebar izquierdo con íconos + texto, tarjeta de progreso circular, tarjetas de acción con CTA, sección "Learn" con miniaturas.
2. **Dashboard e-commerce (KPIs + gráficas)** — saludo personalizado con fecha ("Hello, Barbara! — Today, Mon 22 Nov"), fila de tarjetas KPI con cifra grande + badge de variación %, gráfica de barras de ingresos, donut chart de categorías, sidebar de íconos angosto a la izquierda.
3. **Mismo dashboard, vista recortada** — confirma el patrón de barra superior: buscador, fecha, campana de notificación, avatar.

**Tomar de las referencias:** sidebar colapsable, tarjetas KPI con cifra grande + variación, gráfica de barras + donut, barra superior con fecha/mes visible, densidad de información alta pero limpia.

**Decisión abierta para quien diseñe:** ¿pasar Crumbly a modo oscuro completo (como las referencias) o aplicar este mismo patrón de layout sobre la paleta cálida actual de Crumbly (crema/café), en modo claro? Cualquiera de las dos es válida — lo importante es el patrón de organización (sidebar + KPIs + gráficas + fecha visible), no copiar el color literal si no encaja con la marca.

---

## 3. Requisitos generales

- **Responsive real:** una sola experiencia que funcione en escritorio y en móvil — no dos apps separadas. En escritorio, sidebar fijo colapsable (ícono ⇄ ícono+texto). En móvil, el sidebar se oculta y se accede por menú/hamburguesa, o se conserva algo similar a la navegación inferior actual — lo que se vea mejor en el patrón de referencia, pero **todas las pantallas y funciones deben existir en ambos tamaños**, nada exclusivo de escritorio.
- **Sidebar colapsable:** expandir/contraer con un clic, tal como en las referencias (ícono de flecha arriba a la derecha del logo).
- **Fecha visible en todo momento**, con énfasis en el **mes** actual — igual que "Today, Mon 22 Nov" en la referencia. Es importante porque casi todos los reportes son mensuales.
- **4 secciones principales en el nav:** Dashboard, Inventario, Productos, Clientes. (Ventas ya no es una pantalla aparte de registro — ver nota en Dashboard/Productos más abajo sobre dónde vive el registro de venta en el nuevo layout; si se mantiene como pantalla propia también está bien, es decisión de layout.)

---

## 4. Pantalla por pantalla

### 4.1 Dashboard

Es la pantalla de inicio. Debe tener:

- **Saludo + fecha**, con selector de período: Hoy / Semana / Mes / Año / **Personalizado** (rango desde–hasta con date pickers) — ya existe como lógica, solo hay que darle una UI a la altura de la referencia (dropdown o pastillas, no 5 botones apretados como hoy).
- **4 tarjetas KPI** (fila superior, como la referencia):
  - **Número de ventas** — conteo de ventas del período.
  - **Total vendido** — suma de ingresos del período.
  - **Promedio de venta** — ticket promedio (ingresos ÷ número de ventas).
  - **Margen neto** — ganancia después del costo del producto (ingresos − costo de los productos vendidos, *antes* de gastos operativos — ojo, esto es lo que hoy la app llama "utilidad bruta"; ver nota en el apéndice §6 para no confundir con "utilidad neta", que sí resta gastos operativos y depreciación).
- **Gráfica de ingresos** por período (barras, como la referencia) — usa las ventas del rango seleccionado agrupadas por día.
- **Productos más rentables / más vendidos** — puede ser el donut de la referencia (por categoría/producto) o una lista con barra, lo que se vea mejor; el dato ya existe (ganancia por producto, unidades vendidas).
- **Cierre de caja del día** — tarjeta con ventas, unidades, ingresos, gastos, utilidad neta y ticket promedio *del día actual*, independiente del selector de período de arriba (es un reporte fijo del día, no bloquea nada).
- **Botón "Descargar reporte (PDF)"** visible y accesible — ya existe la generación del PDF, solo necesita un lugar claro en el nuevo layout.
- **Alertas de inventario bajo** — lista compacta, puede ir en una tarjeta lateral o en un panel colapsable, no necesita tanto protagonismo como hoy.

### 4.2 Inventario

Todo insumo (materia prima, empaque, topping) en un mismo lugar, con:

- Nombre del insumo.
- **Tipo de medición**, seleccionable al crear el insumo: **gramos / mililitros / kilogramos / unidad**. El costo y la cantidad disponible se muestran en la unidad elegida (ej. "$0,05/g" o "$3.200/kg" o "12 unidades").
- Cantidad disponible — se actualiza automáticamente con cada venta (ya es el comportamiento actual, debe conservarse) y con cada compra/gasto registrado.
- Costo por unidad de medición.
- Checkbox **"Precio variable"** (margen de variabilidad del 8%) — ya existe, debe seguir presente al crear/editar el insumo.
- Alerta de stock mínimo.
- Vista tipo tabla en escritorio (columnas: nombre, tipo, cantidad, costo, estado) y tarjetas/lista en móvil.
- CRUD completo: agregar, editar, eliminar (con el mismo resguardo actual de no dejar eliminar un insumo que un producto está usando).

### 4.3 Productos

- Agregar, editar, eliminar productos.
- Al crear/editar un producto, la receta se arma **seleccionando insumos del Inventario** (no escribiéndolos de nuevo) — este vínculo ya existe hoy (componentes de receta apuntan a insumos por id), solo hay que darle una UI más clara: buscador/selector de insumo + cantidad en la unidad de ese insumo.
- Mostrar costo calculado en vivo (suma de insumos de la receta + empaque) y margen bruto (precio de venta − costo), igual que hoy.
- Vista tipo tabla en escritorio, tarjetas en móvil.

### 4.4 Clientes

- Nombre y número de contacto (los dos campos que ya se capturan hoy al registrar una venta).
- **Casillas para documento de identidad y correo electrónico** — vacías/opcionales por ahora (todavía no se factura), pero deben existir en el formulario para no tener que rediseñar cuando se active facturación.
- Lista de clientes con búsqueda. Mostrar, si se quiere, cuántas compras tiene cada cliente y su ticket promedio — es un dato que ya se puede calcular, pero no es obligatorio para esta primera versión del rediseño.

---

## 5. Esto no es solo diseño

Dos cosas que pediste no existen todavía en la lógica de la app — si las quieres para el rediseño, avísame y las construyo aparte (no las resuelve un rediseño visual):

1. **Tipo de medición seleccionable por insumo (g/ml/kg/unidad).** Hoy la materia prima siempre está en gramos, el topping siempre en unidades, y el empaque tiene una unidad de texto libre pero sin conversión real. Para que el inventario funcione como lo describes (selector de medición + costo por esa medición) hay que generalizar el modelo de insumo. Es un cambio de datos, no de pantalla.
2. **Campos de documento y correo en cliente.** El objeto cliente hoy solo guarda nombre y teléfono. Agregar los dos campos nuevos es simple, pero es un cambio en `core.js`, no en el diseño.

Puedo hacer ambos ahora si quieres, en paralelo a que tú trabajas el rediseño visual — no se pisan.

---

## 6. Apéndice — modelo de datos actual (para que el diseño no invente campos)

```js
materia:   { id, nombre, cantidad, costo, minimo, margenVariable }       // costo = $/gramo
empaques:  { id, nombre, unidad, cantidad, costo, minimo, margenVariable } // costo = $/unidad (texto libre hoy)
toppings:  { id, nombre, cantidad, costo, precio, minimo, margenVariable } // costo y precio = $/unidad
productos: { id, nombre, precio, componentes: [{ tipo: 'materia'|'preparacion', refId, gramos }], empaquesUsados: [{ empaqueId, cantidad }] }
clientes:  { id, nombre, telefono }
ventas:    { id, fecha, items: [{ productoId, nombre, qty, precio, costo }], total, ganancia, clienteId, consumoReal }
gastos:    { id, fecha, tipo: 'inventario'|'operativo'|'capex', categoria, monto, descripcion, insumoId?, cantidad?, vidaUtilMeses? }
```

Funciones ya disponibles y probadas (no hay que recalcular nada, solo mostrarlo):
`getTicketPromedio`, `getCascadaUtilidad` / `getCascadaUtilidadRango` (ingresos, utilidad bruta, gastos operativos, depreciación, utilidad neta, flujo de caja), `getVentasByPeriod` / `getVentasByRange`, `calcInventoryNeeds`, `getMargenProducto`.

---

## 7. Prompt listo para pegar en la herramienta de diseño

```
Rediseña la interfaz de "Crumbly", una app de punto de venta e inventario
para un negocio de waffles/obleas. Es responsive: debe verse y funcionar
igual de bien en escritorio y en móvil, no son dos apps distintas.

Estilo de referencia (adjunto 3 capturas): dashboard SaaS con sidebar
izquierdo colapsable (ícono + texto, se contrae a solo íconos), barra
superior con fecha del día resaltando el mes actual, tarjetas KPI con
cifra grande y badge de variación, gráfica de barras de ingresos, donut
chart de categorías/productos.

Estructura de navegación (sidebar): Dashboard, Inventario, Productos,
Clientes.

DASHBOARD:
- Selector de período: Hoy / Semana / Mes / Año / Personalizado (rango
  de fechas desde-hasta).
- 4 tarjetas KPI: número de ventas, total vendido, promedio de venta
  (ticket promedio), margen neto (ganancia después del costo del
  producto, antes de gastos operativos).
- Gráfica de barras de ingresos del período, por día.
- Productos más rentables / más vendidos (donut o lista con barra).
- Tarjeta "Cierre de caja del día" (fija en el día actual, separada del
  selector de período de arriba): ventas, unidades, ingresos, gastos,
  utilidad neta, ticket promedio del día.
- Botón para descargar reporte en PDF.
- Espacio para alertas de inventario bajo (compacto, no protagonista).

INVENTARIO:
- Lista/tabla de insumos (materia prima, empaque, topping unificados).
- Cada insumo: nombre, tipo de medición (selector: gramos / mililitros /
  kilogramos / unidad), cantidad disponible en esa medición, costo por
  esa medición, checkbox "Precio variable" (margen de variabilidad),
  alerta de stock mínimo.
- CRUD completo (agregar, editar, eliminar).
- Tabla en escritorio, tarjetas en móvil.

PRODUCTOS:
- CRUD completo.
- Receta armada seleccionando insumos ya existentes del Inventario
  (buscador/selector + cantidad), no texto libre.
- Costo calculado en vivo y margen bruto (precio − costo).
- Tabla en escritorio, tarjetas en móvil.

CLIENTES:
- Nombre y teléfono (obligatorios).
- Documento de identidad y correo electrónico (opcionales, para
  facturación futura — dejar las casillas aunque hoy no se usen).
- Lista con búsqueda.

Requisitos transversales:
- Sidebar colapsable en escritorio (expandir/contraer con un clic).
- En móvil, el mismo set de funciones debe estar accesible (sidebar
  como menú/hamburguesa, o navegación inferior — lo que funcione mejor
  con este patrón visual).
- Fecha del día visible siempre, con énfasis en el mes actual.
- Paleta: [decide aquí si quieres modo oscuro como la referencia, o la
  paleta cálida cremosa/café actual de Crumbly aplicada al mismo
  patrón de layout — adjunto los tokens de color actuales si aplica].
```

---

**Siguiente paso:** cuando tengas los mockups/HTML de Claude Design, tráelos y los integro sobre la lógica actual de `index.html`/`js/core.js` — la lógica no cambia, solo la capa visual.

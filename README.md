# Crumbly

App de una sola página para gestionar insumos, productos, ventas y reportes de un negocio de waffles y obleas. Corre 100% en el navegador — sin backend (por ahora, ver `HANDOFF.md` §12).

## Uso local

Abre `index.html` directamente en el navegador. Sin login — la app entra directo al dashboard.

## Estructura

```
index.html       # la app completa (UI + lógica de pantalla)
js/core.js       # lógica de negocio pura, sin DOM — costeo, períodos,
                  # validación de stock, aplicar/revertir venta
tests/           # tests de core.js — node tests/core.test.js
HANDOFF.md       # especificación, roadmap, bugs, decisiones tomadas
```

## Tests

```bash
node tests/core.test.js
```

Corre todos los tests de la lógica de negocio (costeo, períodos, validación de stock, reversión de venta, migración de esquema). No requiere navegador ni dependencias externas.

## Estado del proyecto

Ver `HANDOFF.md` — es la fuente de verdad de qué está hecho, qué falta y qué se decidió en cada sesión. `IMPLEMENTATION_STATUS.md` trae el detalle bug-por-bug de la última corrida.

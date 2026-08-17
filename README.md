# Crumbly

App de una sola página para gestionar insumos, productos, ventas y reportes de un negocio de waffles y obleas. Corre 100% en el navegador — sin backend (por ahora, ver `HANDOFF.md` §12).

## Uso local

Abre `index.html` directamente en el navegador. Sin login — la app entra directo al dashboard.

## Estructura

```
index.html       # la app completa (UI + lógica de pantalla)
js/core.js       # lógica de negocio pura, sin DOM — costeo, períodos,
                  # validación de stock, aplicar/revertir venta
js/sync.js       # cliente de sincronización con el backend (Fase E)
backend/Code.gs  # Apps Script — backend en Google Sheets (ver backend/SETUP.md)
tests/           # tests — node tests/core.test.js, node tests/sync.test.js
HANDOFF.md       # especificación, roadmap, bugs, decisiones tomadas
```

## Backend (Google Sheets, opcional)

Por defecto la app guarda todo en `localStorage` del navegador. Si quieres que los datos vivan en una hoja de Google (y funcionen desde varios dispositivos), sigue `backend/SETUP.md` — despliegas tu propio Apps Script bajo tu cuenta de Google, pegas la URL y un token en Reportes → "Sincronización", y listo. Sin eso configurado, la app sigue funcionando exactamente igual que hoy, solo local.

## Tests

```bash
node tests/core.test.js
node tests/sync.test.js
```

El primero corre todos los tests de la lógica de negocio (costeo, períodos, validación de stock, reversión de venta, migración de esquema). El segundo prueba el cliente de sincronización con un `fetch` simulado (sin red real). Ninguno requiere navegador ni dependencias externas.

## Estado del proyecto

Ver `HANDOFF.md` — es la fuente de verdad de qué está hecho, qué falta y qué se decidió en cada sesión. `IMPLEMENTATION_STATUS.md` trae el detalle bug-por-bug de la última corrida.

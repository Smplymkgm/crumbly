# Crumbly

App web para manejar un negocio de waffles: caja (ventas con descuentos,
pedidos en tiempo real), inventario, recetas y costeo, gastos con
comprobantes, clientes y reportes. Publicada en GitHub Pages:
https://smplymkgm.github.io/crumbly/

## Cómo está armada

```
index.html        # la app completa (UI + script inline)
js/core.js        # lógica de negocio pura (costeo, ventas, stock, períodos) — con tests
js/supabaseSync.js# sincronización con Supabase (push por diferencias, pull incremental)
js/auth.js        # login con Google → Supabase (+ sesión de Apps Script)
js/almacen.js     # state y base de Supabase en IndexedDB (sin el tope de ~5 MB de
                  #   localStorage); el resto de llaves chicas sigue en localStorage
js/sync.js        # subidas a Drive y respaldo diario vía Apps Script; además el
js/rowsync.js     #   camino viejo a Google Sheets (solo emergencia: localStorage
                  #   'crumbly-backend' = 'sheets')
backend/Code.gs   # Apps Script: sesión, comprobantes a Drive, respaldo diario
supabase/migrations/  # esquema, RLS, realtime, triggers (se corren en el SQL Editor)
tests/            # node tests/<x>.test.js
```

- **Datos:** Supabase (Postgres). Cada colección es una tabla `id + data jsonb`
  con RLS: solo los correos activos de la tabla `usuarios` leen o escriben.
- **Respaldo:** una copia diaria del estado completo en Drive
  ("Crumbly - Respaldos"). Para restaurar: `restaurarDesdeRespaldo(json)` en
  la consola (ver el comentario en `index.html`).
- **Versiones:** `.githooks/pre-commit` sella `app-version` en cada commit
  (`git config core.hooksPath .githooks` una vez por clon) y la app se
  recarga sola cuando hay una versión nueva publicada.

## Tests

```bash
for f in tests/*.test.js; do node "$f"; done
```

Sin dependencias ni navegador. `tests/handlers.test.js` revisa que cada
`onclick`/`oninput` de `index.html` llame a una función que existe.

## Auditoría

Estado de la auditoría pre-lanzamiento: `AUDIT_STATE.md` (vivo) y
`AUDIT_HISTORY.md` (historial).

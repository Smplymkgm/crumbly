# Desplegar el backend de Crumbly en Google Sheets

Esto lo tienes que hacer tú, con la sesión de Google del **correo de Crumbly** abierta en el navegador — no puedo iniciar sesión ni crear cuentas de Google por ti (por seguridad, ningún asistente automatizado debería poder hacerlo). Son ~10 minutos, una sola vez.

Todo el código ya está listo en `backend/Code.gs`. Aquí solo copias y pegas.

---

## 1. Crear la hoja

1. Con la sesión del correo de Crumbly abierta, ve a [sheets.google.com](https://sheets.google.com) → **Hoja de cálculo en blanco**.
2. Nómbrala **"Crumbly — Datos"** (o el nombre que prefieras, no importa para el funcionamiento).
3. Copia el **ID de la hoja** de la URL — la parte entre `/d/` y `/edit`, ej. en
   `https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit` el ID es `1AbCdEfGhIjKlMnOp`. Lo necesitas en el paso 3.

## 2. Crear el proyecto de Apps Script

*(Nota: si "Extensiones → Apps Script" desde dentro de la hoja no carga — a veces falla el redireccionamiento entre cuentas — usa este camino directo, funciona igual de bien.)*

1. Ve a [script.google.com/home/my](https://script.google.com/home/my) con la sesión de Crumbly.
2. **Nuevo proyecto**.
3. Borra el contenido de `Code.gs` que aparece por defecto (la función `myFunction()` de ejemplo).
4. Abre `backend/Code.gs` de este repo, copia todo el archivo, y pégalo.
5. Arriba a la izquierda, dale un nombre al proyecto, por ejemplo "Crumbly Backend".
6. Guarda (ícono de disco o `Ctrl+S` / `Cmd+S`).

## 3. Configurar el token y el ID de la hoja

El token es la única contraseña que protege tus datos — sin él, nadie puede leer ni escribir en la hoja aunque encuentre la URL. El ID le dice al script sobre qué hoja trabajar (este proyecto no vive "dentro" de la hoja, así que hay que decírselo).

1. En el editor de Apps Script, ve a **Configuración del proyecto** (ícono de engranaje, panel izquierdo).
2. Baja hasta **Propiedades del script** → **Añadir propiedad del script**. Agrega dos:
   - Propiedad: `CRUMBLY_TOKEN` — Valor: **inventa una cadena larga y aleatoria** (ej. genera una en [1password.com/password-generator](https://1password.com/password-generator/), 32+ caracteres). Guárdala en un lugar seguro — es la que vas a pegar en la app en el paso 5.
   - Propiedad: `CRUMBLY_SHEET_ID` — Valor: el ID que copiaste en el paso 1.3.
3. Guarda.

## 4. Desplegar como aplicación web

1. Arriba a la derecha, botón **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Configuración:
   - **Ejecutar como:** Yo (tu correo de Crumbly).
   - **Quién tiene acceso:** Cualquier usuario.

   *(Esto no expone tus datos a cualquiera — sin el token del paso 3, cualquier petición a la URL responde "token inválido". Es el modelo que ya está documentado en `HANDOFF.md` §12.4.)*
4. **Implementar**. Google puede pedirte autorizar permisos (acceso a la hoja) — es tu propio script actuando sobre tu propia hoja, es seguro autorizarlo.
5. Copia la **URL de la aplicación web** que te da al terminar (algo como `https://script.google.com/macros/s/AKfycb.../exec`). Esa URL + el token del paso 3 son los dos datos que vas a pegar en Crumbly.

## 5. Conectar la app

1. Abre Crumbly en el navegador → **Reportes** → tarjeta **"Sincronización (Google Sheets)"**.
2. Pega la URL del paso 4 y el token del paso 3.
3. Botón **"Probar conexión"** — debería decir "Conectado ✓".
4. Botón **"Sincronizar ahora"** — sube tus datos actuales a la hoja por primera vez.

A partir de aquí, cada cambio que hagas en la app (venta, gasto, insumo nuevo, etc.) se sube solo a la hoja en segundo plano. Si abres la app en otro dispositivo con la misma URL y token, al cargar trae los datos más recientes de la hoja.

---

## Si algo falla

- **"token inválido"** — revisa que copiaste el token exacto (sin espacios) en ambos lados (Script Properties y la app).
- **"Probar conexión" no responde / error de red** — vuelve a Implementar → Administrar implementaciones y confirma que "Quién tiene acceso" quedó en "Cualquier usuario", no "Solo yo".
- **Cambiaste el código de `Code.gs` después de desplegar** — tienes que crear una **nueva versión** de la implementación (Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar). Guardar el archivo en el editor no actualiza la URL ya publicada.
- **Actualizaste a la versión que sube comprobantes a Drive** — la primera vez que se ejecute te va a pedir autorizar un permiso nuevo (acceso a Drive, antes solo pedía Sheets). Es normal — vuelve a pasar por el flujo de "Implementar" y acepta el nuevo permiso, es tu propio script actuando sobre tu propio Drive.
- **Quieres ver tus datos "a mano"** — vuelve a la hoja de cálculo, vas a tener pestañas `materia`, `productos`, `ventas`, etc., que se reescriben en cada sincronización solo para que las mires o armes tablas dinámicas encima. La pestaña `state_json` es la que la app realmente usa — no la edites a mano, cualquier cambio ahí se pierde en la siguiente sincronización desde la app.

## Qué NO hace esto todavía

- No hay corrección de conflictos si dos personas cambian el mismo dato al mismo tiempo desde dos dispositivos sin red entre sí — gana la última sincronización que llegue. Para el tamaño de este negocio no debería ser un problema real, pero queda anotado (`HANDOFF.md` §12.4).
- No hay copia de seguridad automática con versiones — si quieres un respaldo puntual, **Archivo → Ver historial de versiones** en el propio Sheet de Google ya te sirve, gratis, sin código adicional.

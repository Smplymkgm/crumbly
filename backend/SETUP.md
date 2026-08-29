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

## 3. Configurar el ID de la hoja

No hay ningún token fijo que inventar ni copiar a mano — la app entra únicamente con Google, y el backend le entrega una sesión propia de ese dispositivo. Quién tiene permiso para entrar NO se configura acá como propiedad — vive en una hoja (§3.2), para que autorizar o desautorizar a alguien sea editar una celda, no tocar código.

1. En el editor de Apps Script, ve a **Configuración del proyecto** (ícono de engranaje, panel izquierdo).
2. Baja hasta **Propiedades del script** → **Añadir propiedad del script**. Agrega una (falta una segunda, `CRUMBLY_GOOGLE_CLIENT_ID`, que se agrega en el paso 3.1 más abajo — necesitas crearla primero en Google Cloud Console):
   - Propiedad: `CRUMBLY_SHEET_ID` — Valor: el ID que copiaste en el paso 1.3.
3. Guarda (vas a volver a este panel en el paso 3.1 para agregar `CRUMBLY_GOOGLE_CLIENT_ID`).

### 3.1 Crear el Client ID de Google (para "Acceder con Google")

Esto es aparte del script — se hace en [Google Cloud Console](https://console.cloud.google.com/), con la cuenta de Google de Crumbly.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com/) → crea un proyecto nuevo (o usa uno existente) — el nombre no importa, ej. "Crumbly".
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo **Externo**, nombre de la app "Crumbly", tu correo como correo de soporte. Guardar. (No hace falta publicarla — queda en modo "Prueba", que alcanza para un equipo chico; en ese modo agregá en **Usuarios de prueba** el correo de cada persona que va a usar la app con Google — sin eso, Google le va a rechazar el login aunque después esté bien autorizada en la hoja `usuarios`. Máximo 100 personas en modo Prueba, de sobra para este caso.)
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**. Tipo de aplicación: **Aplicación web**.
4. En **Orígenes de JavaScript autorizados**, agrega: `https://smplymkgm.github.io` (sin `/crumbly` al final, sin barra).
5. Crear. Copia el **Client ID** que te muestra (termina en `.apps.googleusercontent.com`) — **no es secreto**, va a vivir directamente en el código de la app.
6. Volvé al editor de Apps Script → Propiedades del script → agrega:
   - Propiedad: `CRUMBLY_GOOGLE_CLIENT_ID` — Valor: el Client ID que acabas de copiar.
7. Abre `index.html` de este repo, busca la línea `const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID...'` y reemplázala por el mismo Client ID. Guarda y vuelve a publicar en GitHub Pages (`git add`, `commit`, `push` — o pídemelo a mí, yo puedo hacer esa parte).

### 3.2 Autorizar a quién puede entrar

No hay contraseñas, ni registro, ni "olvidé mi clave" — la única puerta es Google, y solo entra alguien cuyo correo ya esté como fila en la hoja `usuarios`, con `activo` en `TRUE`. Esa hoja la crea sola el script la primera vez que alguien intenta iniciar sesión (vacía, ver §5) — para agregar a la primera persona, tenés dos caminos:

**A mano en la hoja (más simple):** abrí la hoja de cálculo → pestaña `usuarios` → agregá una fila: `id` (un número, 1 para el primero, 2 para el siguiente…), `email` (el correo de Google exacto), `nombre`, `rol` (por ahora siempre `admin` — ver `Code.gs`), `activo` (`TRUE`), `createdAt` (la fecha de hoy, o dejalo vacío), `lastLogin` (vacío, se llena solo). Ejemplo:

| id | email | nombre | rol | activo | createdAt | lastLogin |
|---|---|---|---|---|---|---|
| 1 | admin@crumbly.com | Maicol | admin | TRUE | | |
| 2 | angie@crumbly.com | Angie | admin | TRUE | | |

**Desde el editor de Apps Script (equivalente, un poco más prolijo):** abrí `backend/Code.gs` en el editor, elegí `createUser` en el desplegable de funciones (arriba, junto al botón ▷ Ejecutar), y ejecutalo — te va a pedir los parámetros la primera vez (`email`, `nombre`, `rol` opcional). También existen `disableUser('correo@...')` y `enableUser('correo@...')` para cortar o devolver el acceso sin borrar el historial de esa persona.

Cualquiera de los dos caminos es igual de válido — la hoja **es** el panel de administración, hoy sin interfaz visual (a propósito, ver el encabezado de `Code.gs`).

## 4. Desplegar como aplicación web

1. Arriba a la derecha, botón **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Configuración:
   - **Ejecutar como:** Yo (tu correo de Crumbly).
   - **Quién tiene acceso:** Cualquier usuario.

   *(Esto no expone tus datos a cualquiera — sin una sesión válida, cualquier petición a la URL responde "sesión inválida". Es el modelo que ya está documentado en `HANDOFF.md` §12.4.)*
4. **Implementar**. Google puede pedirte autorizar permisos (acceso a la hoja) — es tu propio script actuando sobre tu propia hoja, es seguro autorizarlo.
5. Copia la **URL de la aplicación web** que te da al terminar (algo como `https://script.google.com/macros/s/AKfycb.../exec`). Si es distinta a la que ya está escrita en `index.html` (`BACKEND_URL` en `js/auth.js`) y `js/auth.js`, avisame — hay que actualizarla ahí también.

## 5. Conectar la app

La app pide iniciar sesión al abrirla por primera vez en cada dispositivo — no hace falta copiar nada técnico a mano, y solo funciona para alguien ya autorizado en el paso 3.2.

1. Abre Crumbly en el navegador. Va a mostrar una pantalla de bienvenida con un solo botón.
2. Toca **Acceder con Google** y elegí la cuenta autorizada.
3. Trae todos tus datos y queda conectado en ese dispositivo para siempre (no vuelve a pedirlo, salvo que cierres sesión desde Ajustes). Cada dispositivo tiene su propia sesión — cerrar sesión en uno no afecta a los demás.

A partir de aquí, cada cambio que hagas en la app (venta, gasto, insumo nuevo, etc.) se sube solo a la hoja en segundo plano.

**Dos hojas nuevas que el script crea solas:**
- `usuarios` — quién puede entrar (§3.2). El login nunca escribe acá salvo `lastLogin`, en cada acceso exitoso.
- `sesiones` — una fila por sesión activa (dispositivo). Borrar una fila acá a mano cierra esa sesión igual que "Cerrar sesión" desde la app, por si alguna vez perdés un dispositivo y querés revocarlo sin esperar a que expire sola (90 días).

---

## Si algo falla

- **"Usuario no autorizado"** — el correo con el que se intentó entrar no tiene fila en la hoja `usuarios`. Agregalo (§3.2).
- **"Usuario desactivado"** — tiene fila, pero `activo` está en `FALSE`. Corré `enableUser('correo@...')` desde el editor de Apps Script, o cambiá la celda a mano.
- **Google rechaza el login antes de llegar a la app** ("acceso bloqueado", "esta app no está verificada" y no deja seguir) — falta agregar ese correo en **Usuarios de prueba** de la pantalla de consentimiento de OAuth en Cloud Console (§3.1, paso 2). Es un chequeo de Google, previo y aparte de la hoja `usuarios`.
- **"sesión inválida — iniciá sesión de nuevo"** (al sincronizar) — la sesión de este dispositivo expiró (90 días) o fue cerrada (a mano, desde Ajustes, o borrando la fila en la hoja `sesiones`). Volvé a iniciar sesión.
- **"token de Google inválido"** — el `Client ID` de `index.html` (`GOOGLE_CLIENT_ID`) no coincide con `CRUMBLY_GOOGLE_CLIENT_ID` en Script Properties, o el origen (`https://smplymkgm.github.io`) no está en "Orígenes de JavaScript autorizados" de las credenciales OAuth en Cloud Console.
- **El botón de Google no aparece** — revisa la consola del navegador; puede ser que `accounts.google.com/gsi/client` no cargó (bloqueador de anuncios, sin red) — reintentá con la página recargada.
- **"Probar conexión" no responde / error de red** — vuelve a Implementar → Administrar implementaciones y confirma que "Quién tiene acceso" quedó en "Cualquier usuario", no "Solo yo".
- **Cambiaste el código de `Code.gs` después de desplegar** — tienes que crear una **nueva versión** de la implementación (Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar). Guardar el archivo en el editor no actualiza la URL ya publicada.
- **Actualizaste a la versión que sube comprobantes a Drive** — la primera vez que se ejecute te va a pedir autorizar un permiso nuevo (acceso a Drive, antes solo pedía Sheets). Es normal — vuelve a pasar por el flujo de "Implementar" y acepta el nuevo permiso, es tu propio script actuando sobre tu propio Drive.
- **Quieres ver tus datos "a mano"** — vuelve a la hoja de cálculo, vas a tener pestañas `materia`, `productos`, `ventas`, etc., que se reescriben en cada sincronización solo para que las mires o armes tablas dinámicas encima. La pestaña `state_json` es la que la app realmente usa — no la edites a mano, cualquier cambio ahí se pierde en la siguiente sincronización desde la app. `usuarios` y `sesiones` son las únicas dos pestañas que sí podés editar a mano con seguridad (para autorizar/desautorizar a alguien o revocar un dispositivo).

## Qué NO hace esto todavía

- No hay corrección de conflictos si dos personas cambian el mismo dato al mismo tiempo desde dos dispositivos sin red entre sí — gana la última sincronización que llegue. Para el tamaño de este negocio no debería ser un problema real, pero queda anotado (`HANDOFF.md` §12.4).
- No hay copia de seguridad automática con versiones — si quieres un respaldo puntual, **Archivo → Ver historial de versiones** en el propio Sheet de Google ya te sirve, gratis, sin código adicional.

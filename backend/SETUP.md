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

## 3. Configurar quién puede entrar y el ID de la hoja

No hay ningún token fijo que inventar ni copiar a mano — la app entra con Google (o, opcional, correo+contraseña) y el backend le entrega una sesión propia de ese dispositivo. Lo único que configurás acá es **quién** tiene permiso, y a qué hoja conectarse.

1. En el editor de Apps Script, ve a **Configuración del proyecto** (ícono de engranaje, panel izquierdo).
2. Baja hasta **Propiedades del script** → **Añadir propiedad del script**. Agrega tres (falta una cuarta, `CRUMBLY_GOOGLE_CLIENT_ID`, que se agrega en el paso 3.1 más abajo — necesitas crearla primero en Google Cloud Console):
   - Propiedad: `CRUMBLY_LOGIN_EMAIL` — Valor: el correo (o los correos, **separados por coma**) que pueden entrar a la app — ej. `duena@gmail.com, empleado@gmail.com`. Si van a usar el botón de Google, tienen que ser cuentas de Google reales. Se revisa en cada login, no solo la primera vez — sacar un correo de la lista le corta el acceso en su próximo intento.
   - Propiedad: `CRUMBLY_LOGIN_PASSWORD` — Valor: **una contraseña corta y fácil de recordar/escribir**, opcional, solo para el login alternativo por correo+contraseña (sin pasar por Google) — se empareja con el **primer** correo de la lista de arriba.
   - Propiedad: `CRUMBLY_SHEET_ID` — Valor: el ID que copiaste en el paso 1.3.
3. Guarda (vas a volver a este panel en el paso 3.1 para agregar `CRUMBLY_GOOGLE_CLIENT_ID`).

**Quién es quién, una vez que entran:** la primera persona que inicia sesión alguna vez queda automáticamente como `dueño`; las siguientes, como `staff`. No hay pantalla de administración — la hoja `usuarios` que el script crea sola (ver §5) **es** esa pantalla: el rol es una celda más, se corrige a mano ahí mismo cuando haga falta.

### 3.1 Crear el Client ID de Google (para "Iniciar sesión con Google")

Esto es aparte del script — se hace en [Google Cloud Console](https://console.cloud.google.com/), con la misma cuenta de Google que pusiste en `CRUMBLY_LOGIN_EMAIL`.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com/) → crea un proyecto nuevo (o usa uno existente) — el nombre no importa, ej. "Crumbly".
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo **Externo**, nombre de la app "Crumbly", tu correo como correo de soporte. Guardar. (Como uso es solo para tu propia cuenta, no hace falta publicarla — queda en modo "Prueba", que ya te alcanza; en ese modo agrega tu correo en **Usuarios de prueba**.)
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**. Tipo de aplicación: **Aplicación web**.
4. En **Orígenes de JavaScript autorizados**, agrega: `https://smplymkgm.github.io` (sin `/crumbly` al final, sin barra).
5. Crear. Copia el **Client ID** que te muestra (termina en `.apps.googleusercontent.com`) — **no es secreto**, va a vivir directamente en el código de la app.
6. Volvé al editor de Apps Script → Propiedades del script → agrega:
   - Propiedad: `CRUMBLY_GOOGLE_CLIENT_ID` — Valor: el Client ID que acabas de copiar.
7. Abre `index.html` de este repo, busca la línea `const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID...'` y reemplázala por el mismo Client ID. Guarda y vuelve a publicar en GitHub Pages (`git add`, `commit`, `push` — o pídemelo a mí, yo puedo hacer esa parte).

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

La app pide iniciar sesión al abrirla por primera vez en cada dispositivo — no hace falta copiar nada técnico a mano. Dos formas, elegí la que prefieras:

1. Abre Crumbly en el navegador. Va a mostrar una pantalla de bienvenida.
2. **Con Google:** toca **Acceder con Google** y elegí la cuenta que pusiste en `CRUMBLY_LOGIN_EMAIL`. **Con correo y contraseña:** toca "Continuar con correo" y escribí el correo + la contraseña del paso 3.
3. Trae todos tus datos y queda conectado en ese dispositivo para siempre (no vuelve a pedirlo, salvo que cierres sesión desde Ajustes). Cada dispositivo tiene su propia sesión — cerrar sesión en uno no afecta a los demás.

A partir de aquí, cada cambio que hagas en la app (venta, gasto, insumo nuevo, etc.) se sube solo a la hoja en segundo plano.

**Dos hojas nuevas que el script crea solo, la primera vez que alguien inicia sesión:**
- `usuarios` — una fila por persona que entró alguna vez: correo, nombre, foto, **rol** (editable a mano) y último acceso.
- `sesiones` — una fila por sesión activa (dispositivo). Borrar una fila acá a mano cierra esa sesión igual que "Cerrar sesión" desde la app, por si alguna vez perdés un dispositivo y querés revocarlo sin esperar a que expire sola (90 días).

---

## Si algo falla

- **"sesión inválida — iniciá sesión de nuevo"** — la sesión de este dispositivo expiró (90 días) o fue cerrada (a mano, desde Ajustes, o borrando la fila en la hoja `sesiones`). Volvé a iniciar sesión.
- **"correo no autorizado"** (Google o correo+contraseña) — el correo no está en `CRUMBLY_LOGIN_EMAIL`. Revisá que estén escritos igual (no distingue mayúsculas/minúsculas, pero sí todo lo demás — sin espacios de más alrededor de las comas).
- **"token de Google inválido"** — el `Client ID` de `index.html` (`GOOGLE_CLIENT_ID`) no coincide con `CRUMBLY_GOOGLE_CLIENT_ID` en Script Properties, o el origen (`https://smplymkgm.github.io`) no está en "Orígenes de JavaScript autorizados" de las credenciales OAuth en Cloud Console.
- **El botón de Google no aparece** — revisa la consola del navegador; si `accounts.google.com/gsi/client` no cargó (bloqueador de anuncios, sin red), usa "Continuar con correo" mientras tanto.
- **"Correo o contraseña incorrectos"** — revisa que `CRUMBLY_LOGIN_EMAIL`/`CRUMBLY_LOGIN_PASSWORD` estén bien escritos en Script Properties.
- **"Probar conexión" no responde / error de red** — vuelve a Implementar → Administrar implementaciones y confirma que "Quién tiene acceso" quedó en "Cualquier usuario", no "Solo yo".
- **Cambiaste el código de `Code.gs` después de desplegar** — tienes que crear una **nueva versión** de la implementación (Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar). Guardar el archivo en el editor no actualiza la URL ya publicada.
- **Actualizaste a la versión que sube comprobantes a Drive** — la primera vez que se ejecute te va a pedir autorizar un permiso nuevo (acceso a Drive, antes solo pedía Sheets). Es normal — vuelve a pasar por el flujo de "Implementar" y acepta el nuevo permiso, es tu propio script actuando sobre tu propio Drive.
- **Quieres ver tus datos "a mano"** — vuelve a la hoja de cálculo, vas a tener pestañas `materia`, `productos`, `ventas`, etc., que se reescriben en cada sincronización solo para que las mires o armes tablas dinámicas encima. La pestaña `state_json` es la que la app realmente usa — no la edites a mano, cualquier cambio ahí se pierde en la siguiente sincronización desde la app. `usuarios` y `sesiones` son las únicas dos pestañas que sí podés editar a mano con seguridad (para corregir un rol o revocar un dispositivo).

## Qué NO hace esto todavía

- No hay corrección de conflictos si dos personas cambian el mismo dato al mismo tiempo desde dos dispositivos sin red entre sí — gana la última sincronización que llegue. Para el tamaño de este negocio no debería ser un problema real, pero queda anotado (`HANDOFF.md` §12.4).
- No hay copia de seguridad automática con versiones — si quieres un respaldo puntual, **Archivo → Ver historial de versiones** en el propio Sheet de Google ya te sirve, gratis, sin código adicional.

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
2. Baja hasta **Propiedades del script** → **Añadir propiedad del script**. Agrega cuatro (falta una quinta, `CRUMBLY_GOOGLE_CLIENT_ID`, que se agrega en el paso 3.1 más abajo — necesitas crearla primero en Google Cloud Console):
   - Propiedad: `CRUMBLY_TOKEN` — Valor: **inventa una cadena larga y aleatoria** (ej. genera una en [1password.com/password-generator](https://1password.com/password-generator/), 32+ caracteres). Este es el secreto real que protege tus datos — no se escribe a mano en ningún dispositivo, la app lo obtiene sola al iniciar sesión (Google o correo+contraseña, ver abajo).
   - Propiedad: `CRUMBLY_LOGIN_EMAIL` — Valor: el correo con el que vas a iniciar sesión en la app. Si vas a usar el botón de Google, tiene que ser una cuenta de Google real (la misma que aparece al tocar "Iniciar sesión con Google"). Solo ese correo puede entrar, por cualquiera de los dos caminos.
   - Propiedad: `CRUMBLY_LOGIN_PASSWORD` — Valor: **una contraseña corta y fácil de recordar/escribir**, para el login alternativo por correo+contraseña (sin pasar por Google). Distinta del token de arriba — si alguien la adivina, solo puede iniciar sesión, no saltarse el paso y usar el token real directamente.
   - Propiedad: `CRUMBLY_SHEET_ID` — Valor: el ID que copiaste en el paso 1.3.
3. Guarda (vas a volver a este panel en el paso 3.1 para agregar `CRUMBLY_GOOGLE_CLIENT_ID`).

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

   *(Esto no expone tus datos a cualquiera — sin el token del paso 3, cualquier petición a la URL responde "token inválido". Es el modelo que ya está documentado en `HANDOFF.md` §12.4.)*
4. **Implementar**. Google puede pedirte autorizar permisos (acceso a la hoja) — es tu propio script actuando sobre tu propia hoja, es seguro autorizarlo.
5. Copia la **URL de la aplicación web** que te da al terminar (algo como `https://script.google.com/macros/s/AKfycb.../exec`). Esa URL + el token del paso 3 son los dos datos que vas a pegar en Crumbly.

## 5. Conectar la app

La app pide iniciar sesión al abrirla por primera vez en cada dispositivo — no hace falta copiar la URL ni el token técnico a mano. Dos formas, elegí la que prefieras:

1. Abre Crumbly en el navegador. Va a mostrar una pantalla de login.
2. **Con Google:** toca **Iniciar sesión con Google** y elige la cuenta que pusiste en `CRUMBLY_LOGIN_EMAIL`. **Con correo y contraseña:** escribe el correo y la contraseña del paso 3, y toca **Ingresar**.
3. Trae todos tus datos y queda conectado en ese dispositivo para siempre (no vuelve a pedirlo, salvo que cierres sesión desde Ajustes).

A partir de aquí, cada cambio que hagas en la app (venta, gasto, insumo nuevo, etc.) se sube solo a la hoja en segundo plano.

### Si ninguno de los dos logins funciona todavía

Si todavía no configuraste las Propiedades del script (paso 3/3.1), o hay algún problema con ambos, la pantalla de login tiene un enlace **"¿Problemas para entrar?"** que despliega los campos técnicos (URL + token real del paso 3/4) como último recurso — funciona igual de bien, solo que hay que copiar y pegar a mano.

### Conectar un dispositivo nuevo con un link (alternativa al login)

También existe un link de un solo uso que hace lo mismo que el login pero con el token real en vez de la contraseña — útil si por alguna razón no querés usar correo/contraseña en un dispositivo puntual:

```
https://smplymkgm.github.io/crumbly/?token=TU_TOKEN_REAL_AQUI
```

Abrilo en el dispositivo nuevo — configura la sincronización y trae todos los datos automáticamente. El token desaparece de la barra de direcciones apenas se usa (no queda en el historial del navegador). Guardalo en un lugar privado — funciona como una contraseña.

---

## Si algo falla

- **"token inválido"** — revisa que copiaste el token exacto (sin espacios) en ambos lados (Script Properties y la app).
- **"correo no autorizado"** al iniciar sesión con Google — iniciaste con una cuenta de Google distinta a la que pusiste en `CRUMBLY_LOGIN_EMAIL`. Revisa que estén escritos igual (no distingue mayúsculas/minúsculas).
- **"token de Google inválido"** — el `Client ID` de `index.html` (`GOOGLE_CLIENT_ID`) no coincide con `CRUMBLY_GOOGLE_CLIENT_ID` en Script Properties, o el origen (`https://smplymkgm.github.io`) no está en "Orígenes de JavaScript autorizados" de las credenciales OAuth en Cloud Console.
- **El botón de Google no aparece** — revisa la consola del navegador; si `accounts.google.com/gsi/client` no cargó (bloqueador de anuncios, sin red), usa el login con correo+contraseña mientras tanto.
- **"Correo o contraseña incorrectos"** al iniciar sesión sin Google — revisa que `CRUMBLY_LOGIN_EMAIL`/`CRUMBLY_LOGIN_PASSWORD` estén bien escritos en Script Properties (sin espacios de más).
- **"Probar conexión" no responde / error de red** — vuelve a Implementar → Administrar implementaciones y confirma que "Quién tiene acceso" quedó en "Cualquier usuario", no "Solo yo".
- **Cambiaste el código de `Code.gs` después de desplegar** — tienes que crear una **nueva versión** de la implementación (Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar). Guardar el archivo en el editor no actualiza la URL ya publicada.
- **Actualizaste a la versión que sube comprobantes a Drive** — la primera vez que se ejecute te va a pedir autorizar un permiso nuevo (acceso a Drive, antes solo pedía Sheets). Es normal — vuelve a pasar por el flujo de "Implementar" y acepta el nuevo permiso, es tu propio script actuando sobre tu propio Drive.
- **Quieres ver tus datos "a mano"** — vuelve a la hoja de cálculo, vas a tener pestañas `materia`, `productos`, `ventas`, etc., que se reescriben en cada sincronización solo para que las mires o armes tablas dinámicas encima. La pestaña `state_json` es la que la app realmente usa — no la edites a mano, cualquier cambio ahí se pierde en la siguiente sincronización desde la app.

## Qué NO hace esto todavía

- No hay corrección de conflictos si dos personas cambian el mismo dato al mismo tiempo desde dos dispositivos sin red entre sí — gana la última sincronización que llegue. Para el tamaño de este negocio no debería ser un problema real, pero queda anotado (`HANDOFF.md` §12.4).
- No hay copia de seguridad automática con versiones — si quieres un respaldo puntual, **Archivo → Ver historial de versiones** en el propio Sheet de Google ya te sirve, gratis, sin código adicional.

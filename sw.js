/* Service worker de Crumbly (PWA mínima).
 *
 * Estrategia NETWORK-FIRST para el HTML y el JS propio: la app ya se
 * actualiza sola (revisarVersionNueva_ en index.html compara app-version
 * contra la red), así que este SW nunca debe esconder un deploy nuevo. La
 * caché solo se usa cuando no hay red o la red tarda más de 4 s (kiosco y
 * eventos con mala señal). Por eso un SW viejo no puede dejar pegado un
 * HTML viejo: siempre se pregunta primero a la red.
 *
 * Al cambiar este archivo, subir CACHE (crumbly-v2, …): activate borra las
 * cachés crumbly-* anteriores.
 */
const CACHE = 'crumbly-v2';
const TIMEOUT_MS = 4000;
const SCOPE = self.registration.scope; // p. ej. https://smplymkgm.github.io/crumbly/

// Archivos de CDN con la versión fija en la URL: nunca cambian, así que van
// cache-first. Tienen SRI + crossorigin, así que solo se guardan respuestas
// CORS (una opaca rompería el SRI); se devuelven tal cual.
const CDN_FIJOS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/',
];

// Se guardan al instalar para que el primer arranque sin red ya funcione
// (la primera visita carga todo antes de que el SW exista).
const PRECACHE_PROPIOS = [
  './', 'js/core.js', 'js/rowsync.js', 'js/sync.js', 'js/supabaseSync.js', 'js/auth.js', 'js/almacen.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const PRECACHE_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
  'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/Phosphor.woff2',
];

// Clave de caché sin ?v=… ni #: así js/core.js?v=X y ?v=Y comparten una sola
// copia (la última que llegó de la red) y la caché no crece con cada deploy.
const sinQuery = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const guardable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Best effort: si algo falla (sin red), el SW se instala igual.
    await Promise.allSettled([
      ...PRECACHE_PROPIOS.map(async (p) => {
        const url = new URL(p, SCOPE).href;
        const res = await fetch(url, { cache: 'no-cache' });
        if (guardable(res)) await cache.put(sinQuery(url), res);
      }),
      ...PRECACHE_CDN.map(async (url) => {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok && res.type === 'cors') await cache.put(url, res);
      }),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Solo las crumbly-*: el origen github.io se comparte con otros repos.
    for (const k of await caches.keys()) {
      if (k.startsWith('crumbly-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST y demás: nunca se tocan
  // revisarVersionNueva_ pide ?check=… con cache:'no-store': directo a la red.
  if (req.cache === 'no-store' || req.cache === 'only-if-cached') return;
  const url = new URL(req.url);
  if (url.searchParams.has('check')) return;

  if (url.origin === self.location.origin) {
    if (!req.url.startsWith(SCOPE)) return; // otros repos del mismo github.io
    if (req.mode === 'navigate') return event.respondWith(redPrimero(event, req, true));
    const p = url.pathname;
    if (p.endsWith('.js') || p.endsWith('.webmanifest') || p.startsWith(new URL('icons/', SCOPE).pathname)) {
      return event.respondWith(redPrimero(event, req, false));
    }
    return;
  }
  if (CDN_FIJOS.some((pre) => req.url.startsWith(pre))) return event.respondWith(cachePrimero(event, req));
  // Todo lo demás (Supabase, Google, …) va a la red sin respondWith.
});

// Red primero con timeout; la copia de la caché solo si la red falla o tarda.
async function redPrimero(event, req, esNavegacion) {
  const clave = sinQuery(req.url);
  const red = fetch(req);
  // Guarda una copia de lo que llegó (aunque ya se haya servido la caché
  // por timeout). Se registra antes del await de abajo: clona primero.
  event.waitUntil(red.then((res) => {
    if (!guardable(res)) return;
    const copia = res.clone();
    return caches.open(CACHE).then((c) => c.put(clave, copia));
  }).catch(() => {}));

  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(r, TIMEOUT_MS); });
  try {
    const res = await Promise.race([red, timeout]);
    if (res) return res; // la red contestó a tiempo
  } catch (e) { /* sin red */ } finally { clearTimeout(timer); }

  const cache = await caches.open(CACHE);
  const copia = (await cache.match(clave)) ||
    (esNavegacion && ((await cache.match(SCOPE)) || (await cache.match(SCOPE + 'index.html'))));
  return copia || red; // sin copia: se espera a la red (o falla como sin SW)
}

async function cachePrimero(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'cors') {
    const copia = res.clone();
    event.waitUntil(cache.put(req.url, copia));
  }
  return res;
}

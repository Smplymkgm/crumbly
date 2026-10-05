/**
 * Smoke test de los manejadores inline de index.html (onclick, oninput,
 * onchange…, también los que se arman dentro de template strings). Correr con:
 * node tests/handlers.test.js
 * Verifica que cada función llamada al inicio de una sentencia del
 * manejador esté definida en el nivel superior del <script> inline (o en
 * js/*.js, o sea un global del navegador). Así un renombre o un borrado de
 * código muerto no deja un botón que tira ReferenceError al tocarlo.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name);
    console.log('      ' + e.message);
  }
}

// El <script> inline (sin src) — el único bloque `<script>` sin atributos.
const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

// Nombres definidos en el nivel superior del script inline.
const definidos = new Set();
for (const m of inline.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)) definidos.add(m[1]);
for (const m of inline.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) definidos.add(m[1]);
for (const m of inline.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) definidos.add(m[1]);

// Globales que exponen js/*.js (UMD: `root.X = …`).
const jsGlobales = new Set();
for (const f of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  for (const m of src.matchAll(/\broot\.([A-Za-z_$][\w$]*)\s*=/g)) jsGlobales.add(m[1]);
}

// Globales del navegador y de las librerías por CDN.
const navegador = new Set([
  'document', 'event', 'this', 'window', 'history', 'location', 'localStorage',
  'sessionStorage', 'navigator', 'confirm', 'alert', 'prompt', 'console',
  'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'Number', 'String',
  'Math', 'JSON', 'Object', 'Array', 'parseFloat', 'parseInt', 'encodeURIComponent',
  'open', 'print', 'scrollTo', 'supabase', 'jspdf', 'google'
]);

// Llamadas al inicio de cada sentencia de cada manejador inline.
// `on[a-z]+="…"` cubre el HTML estático y los template strings del JS.
const llamadas = new Map(); // nombre -> primeras líneas donde aparece
const lineaDe = idx => html.slice(0, idx).split('\n').length;
let manejadores = 0;
for (const m of html.matchAll(/\son([a-z]+)="([^"]*)"/g)) {
  manejadores++;
  const cuerpo = m[2];
  for (const sentencia of cuerpo.split(';')) {
    const c = sentencia.trim().match(/^(?:return\s+)?([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*\s*\(/);
    if (!c) continue;
    const nombre = c[1];
    if (['if', 'return', 'typeof', 'function'].includes(nombre)) continue;
    if (!llamadas.has(nombre)) llamadas.set(nombre, []);
    const lineas = llamadas.get(nombre);
    if (lineas.length < 3) lineas.push(lineaDe(m.index));
  }
}

console.log('\n== Manejadores inline ==');

test('se encontró el script inline y sus definiciones', () => {
  assert.ok(inline.length > 1000, 'no se encontró el <script> inline');
  assert.ok(definidos.has('navTo'), 'navTo debería estar definida');
  assert.ok(definidos.size > 100, 'muy pocas definiciones: ' + definidos.size);
});

test('se encontraron manejadores inline', () => {
  assert.ok(manejadores > 50, 'muy pocos manejadores: ' + manejadores);
  assert.ok(llamadas.size > 30, 'muy pocas funciones llamadas: ' + llamadas.size);
});

test('toda función llamada desde un manejador inline está definida', () => {
  const faltan = [...llamadas.entries()]
    .filter(([n]) => !definidos.has(n) && !jsGlobales.has(n) && !navegador.has(n))
    .map(([n, lineas]) => n + ' (index.html:' + lineas.join(',') + ')');
  assert.deepStrictEqual(faltan, [], 'sin definir: ' + faltan.join(', '));
});

console.log('\n== Resumen ==');
console.log(passed + ' pasaron, ' + failed + ' fallaron');
process.exit(failed ? 1 : 0);

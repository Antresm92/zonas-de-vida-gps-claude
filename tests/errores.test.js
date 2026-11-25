'use strict';
/* Registro de errores y tiempo de arranque (2.34.0): se guarda solo en el teléfono, sin coordenadas, con tamaño limitado y sin
   romper nunca la app. */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../www/js/errores.js');

// Un almacenamiento de mentira, como localStorage
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const T0 = Date.UTC(2026, 10, 25, 21, 0);

test('registro: la clave es nueva y no toca las de los datos (zvg.v1.state, zvg.v1.flags…)', () => {
  assert.equal(E.KEY, 'zvg.v1.diagnostico');
  assert.ok(!['zvg.v1.state', 'zvg.v1.memory', 'zvg.v1.flags', 'zvg.v1.author'].includes(E.KEY));
});

test('registro: sin coordenadas ni parámetros de direcciones web; los archivos de la app quedan cortos', () => {
  assert.equal(E.scrub('falló en 4.60123,-74.08001 y en 4,6012 -74,0801'), 'falló en #,# y en # #');
  assert.equal(E.scrub('https://api.open-meteo.com/v1/forecast?latitude=4.6&longitude=-74.08'), 'https://api.open-meteo.com/v1/forecast?…');
  assert.equal(E.scrub('at render (https://localhost/js/app.js:1234:56)'), 'at render (js/app.js:1234:56)');
  assert.equal(E.scrub('at x (http://127.0.0.1:8080/vendor/leaflet/leaflet.js:5:9)'), 'at x (vendor/leaflet/leaflet.js:5:9)');
  assert.equal(E.scrub('versión 2.34.0, línea 1234'), 'versión 2.34.0, línea 1234', 'versiones y números enteros no se tocan');
  const r = E.record({ error: new TypeError('No se pudo leer 4.601234 en ' + 'https://x.org/a?lat=4.6012'), file: 'https://localhost/js/app.js', line: 10, col: 5, version: '2.34.0', now: T0 });
  assert.equal(r.m, 'TypeError: No se pudo leer # en https://x.org/a?…');
  assert.equal(r.d, 'app.js:10:5');
  assert.equal(r.v, '2.34.0'); assert.equal(r.k, 'error'); assert.equal(r.n, 1);
  assert.equal(r.t, '2026-11-25T21:00:00Z');
  assert.doesNotMatch(r.s, /4\.6012|https:\/\/localhost/, 'la pila tampoco lleva coordenadas ni el origen');
});

test('registro: mensajes del navegador, cadenas lanzadas y promesas sin motivo', () => {
  assert.equal(E.record({ message: 'Uncaught ReferenceError: x is not defined' }).m, 'ReferenceError: x is not defined');
  assert.equal(E.record({ message: 'Uncaught (in promise) Error: boom' }).m, 'Error: boom');
  assert.equal(E.record({ error: 'boom' }).m, 'boom', 'alguien lanzó un texto');
  assert.equal(E.record({ kind: 'promesa', message: '' }).m, 'Error sin descripción');
  assert.equal(E.record({ kind: 'promesa', message: 'x' }).k, 'promesa');
  assert.equal(E.record({ message: 'a\nb\tc' }).m, 'a b c', 'en una sola línea');
  assert.ok(E.record({ message: 'x'.repeat(1000) }).m.length <= 300);
});

test('registro: un error repetido suma veces y pasa al final; máximo 50 filas', () => {
  let d = null;
  for (let i = 0; i < 3; i++) d = E.add(d, E.record({ message: 'A', file: 'js/app.js', line: 1, version: '2.34.0', now: T0 + i }));
  d = E.add(d, E.record({ message: 'B', version: '2.34.0', now: T0 + 10 }));
  d = E.add(d, E.record({ message: 'A', file: 'js/app.js', line: 1, version: '2.34.0', now: T0 + 20 }));
  assert.deepEqual(d.errores.map((e) => [e.m, e.n]), [['B', 1], ['A', 4]]);
  d = E.add(d, E.record({ message: 'A', file: 'js/app.js', line: 1, version: '2.35.0', now: T0 + 30 }));
  assert.equal(d.errores.length, 3, 'en otra versión es otra fila');
  for (let i = 0; i < 80; i++) d = E.add(d, E.record({ message: 'E' + i, now: T0 + 100 + i }));
  assert.equal(d.errores.length, E.MAX_ERR);
  assert.equal(d.errores[d.errores.length - 1].m, 'E79', 'quedan los más recientes');
});

test('registro: tiempo de arranque, últimos 10, con promedio', () => {
  let d = null;
  for (const ms of [900, 1100, -5, NaN, 700000]) d = E.addStartup(d, ms, '2.34.0', T0);
  assert.deepEqual(d.arranques.map((a) => a.ms), [900, 1100], 'lo imposible no se guarda');
  for (let i = 0; i < 15; i++) d = E.addStartup(d, 500 + i, '2.34.0', T0);
  assert.equal(d.arranques.length, E.MAX_START);
  const s = E.summary(d);
  assert.equal(s.ultimo, 514); assert.equal(s.promedio, Math.round((505 + 514) / 2)); assert.equal(s.arranques, 10);
  assert.equal(E.seconds(812), '0,8 s'); assert.equal(E.seconds(1460), '1,5 s');
});

test('registro: lo guardado con otra forma (dañado o de otra versión) se limpia sin romper', () => {
  const raw = { errores: [{ m: 'ok', n: 3, t: '2026-11-25T21:00:00Z', v: '2.34.0' }, { m: '' }, null, 'x', { m: 'n raro', n: -4, t: 'ayer' }], arranques: [{ ms: 800 }, { ms: 'rápido' }, { ms: -1 }], otra: 1 };
  const d = E.clean(raw);
  assert.deepEqual(Object.keys(d), ['v', 'errores', 'arranques']);
  assert.deepEqual(d.errores.map((e) => [e.m, e.n, e.t]), [['ok', 3, '2026-11-25T21:00:00Z'], ['n raro', 1, '']]);
  assert.deepEqual(d.arranques.map((a) => a.ms), [800]);
  for (const bad of [null, undefined, 5, 'texto', [], { errores: 'no' }]) assert.deepEqual(E.clean(bad), { v: 1, errores: [], arranques: [] });
});

test('registro: guardar, leer y borrar; sin almacenamiento o con uno que falla, la app sigue', () => {
  const st = memStore();
  assert.deepEqual(E.load(st), { v: 1, errores: [], arranques: [] });
  assert.equal(E.save(st, E.addStartup(null, 800, '2.34.0', T0)), true);
  assert.equal(E.load(st).arranques[0].ms, 800);
  st.setItem(E.KEY, '{dañado');
  assert.deepEqual(E.load(st).errores, [], 'JSON dañado: registro vacío, sin error');
  assert.equal(E.clear(st), true); assert.equal(st.getItem(E.KEY), null);
  const roto = { getItem() { throw new Error('no'); }, setItem() { throw new Error('lleno'); }, removeItem() { throw new Error('no'); } };
  assert.deepEqual(E.load(roto).errores, []); assert.equal(E.save(roto, {}), false); assert.equal(E.clear(roto), false);
  assert.equal(E.save(null, {}), false);
});

test('registro: escucha los errores del navegador, sin bucles y con tope por sesión', () => {
  const st = memStore(), handlers = {};
  const win = { localStorage: st, addEventListener: (t, f) => { handlers[t] = f; } };
  E.setVersion('2.34.0');
  E.install(win);
  handlers.error({ message: 'Uncaught TypeError: x', filename: 'https://localhost/js/app.js', lineno: 3, colno: 7, error: new TypeError('x') });
  handlers.error({ target: { nodeType: 1, tagName: 'IMG' }, message: '' });              // una imagen que no cargó: no es un error del código
  handlers.unhandledrejection({ reason: new Error('sin red') });
  handlers.unhandledrejection({ reason: 'texto' });
  const d = E.load(st);
  assert.deepEqual(d.errores.map((e) => [e.k, e.m, e.v]), [['error', 'TypeError: x', '2.34.0'], ['promesa', 'sin red', '2.34.0'], ['promesa', 'texto', '2.34.0']]);
  assert.equal(d.errores[0].d, 'app.js:3:7');
  for (let i = 0; i < 300; i++) handlers.error({ message: 'otro ' + i });
  assert.ok(E.load(st).errores.length <= E.MAX_ERR);
  const total = E.load(st).errores.reduce((s, e) => s + e.n, 0);
  assert.ok(total <= E.MAX_SESSION, 'como mucho ' + E.MAX_SESSION + ' por sesión (anotó ' + total + ')');
});

test('registro: el texto para compartir dice qué es, sin el modelo del teléfono ni coordenadas', () => {
  let d = E.addStartup(null, 812, '2.34.0', T0);
  d = E.addStartup(d, 1010, '2.34.0', T0 + 1);
  d = E.add(d, E.record({ message: 'falló 4.60123', file: 'js/ui-mapa.js', line: 4, version: '2.34.0', now: T0 }));
  d = E.add(d, E.record({ message: 'falló 4.60123', file: 'js/ui-mapa.js', line: 4, version: '2.34.0', now: T0 + 5 }));
  const ua = 'Mozilla/5.0 (Linux; Android 14; SM-A325M Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.39 Mobile Safari/537.36';
  const t = E.text(d, { ua, version: '2.34.0', now: T0 });
  assert.match(t, /^Registro de errores · Don Florentino SIG\nVersión: 2\.34\.0 · Android 14 · Chrome 131\n/);
  assert.match(t, /No incluye puntos ni coordenadas/);
  assert.match(t, /Arranque \(últimas 2 veces, de la más vieja a la más reciente\): 0,8 s · 1,0 s\. Promedio: 0,9 s\./);
  assert.match(t, /1\. \d{4}-\d{2}-\d{2} \d{2}:\d{2} · versión 2\.34\.0 · 2 veces\n   falló #\n   en ui-mapa\.js:4/);
  assert.doesNotMatch(t, /SM-A325M|4\.60123/);
  assert.match(E.text(null, {}), /Arranque: sin datos todavía\.\n\nErrores: ninguno\./);
  assert.match(E.text(E.addStartup(null, 700, '2.34.0', T0), {}), /Arranque: 0,7 s \(medido una vez\)\./);
  assert.equal(E.device(''), 'desconocido');
});

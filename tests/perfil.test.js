'use strict';
/* Perfil del relieve: cuentas, avisos honestos sobre el GPS y dibujo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Perfil = require('../www/js/perfil.js');
const Geo = require('../www/js/geo.js');

// Cinco puntos como los de la captura de referencia: sube, baja y vuelve a subir
const P = [
  { name: 'P1', lat: 4.85639, lon: -74.91717, alt: 389, altSrc: 'gps' },
  { name: 'P2', lat: 4.85400, lon: -74.91950, alt: 420, altSrc: 'gps' },
  { name: 'P3', lat: 4.85600, lon: -74.92150, alt: 370, altSrc: 'gps' },
  { name: 'P4', lat: 4.85900, lon: -74.92100, alt: 317, altSrc: 'gps' },
  { name: 'P5', lat: 4.86000, lon: -74.91700, alt: 370, altSrc: 'gps' }
];
const dist = (a, b) => Geo.distance(a.lat, a.lon, b.lat, b.lon);

test('build: distancia acumulada, más alto y más bajo, ascenso y descenso', () => {
  const m = Perfil.build(P);
  assert.equal(m.ok, true);
  assert.equal(m.items.length, 5);
  assert.equal(m.items[0].dist, 0);
  const total = [0, 1, 2, 3].reduce((s, i) => s + dist(P[i], P[i + 1]), 0);
  assert.ok(Math.abs(m.total - total) < 1e-6);
  assert.ok(Math.abs(m.items[2].dist - (dist(P[0], P[1]) + dist(P[1], P[2]))) < 1e-6);
  assert.equal(m.high.name, 'P2'); assert.equal(m.low.name, 'P4');
  assert.equal(m.relief, 103);
  assert.equal(m.ascent, 31 + 53);        // 389→420 y 317→370
  assert.equal(m.descent, 50 + 53);       // 420→370 y 370→317
  assert.equal(m.missing, 0);
  assert.deepEqual(m.srcCounts, { gps: 5 });
});

test('build: el tramo más inclinado es el de mayor pendiente, no el de mayor desnivel', () => {
  const m = Perfil.build([
    { name: 'A', lat: 4.0, lon: -74.0, alt: 1000, altSrc: 'manual' },
    { name: 'B', lat: 4.0, lon: -73.99, alt: 1010, altSrc: 'manual' },     // ~1,1 km, +10 m → 0,9 %
    { name: 'C', lat: 4.0, lon: -73.9899, alt: 1060, altSrc: 'manual' }    // ~11 m, +50 m → muy inclinado
  ]);
  assert.equal(m.steepest.from, 'B'); assert.equal(m.steepest.to, 'C');
  assert.ok(m.steepest.pct > 100);
});

test('build: un punto sin altitud no se dibuja pero su distancia cuenta', () => {
  const pts = [P[0], { name: 'P2', lat: P[1].lat, lon: P[1].lon }, P[2], P[3]];
  const m = Perfil.build(pts);
  assert.equal(m.items.length, 3);
  assert.equal(m.missing, 1);
  const hasta = dist(pts[0], pts[1]) + dist(pts[1], pts[2]);
  assert.ok(Math.abs(m.items[1].dist - hasta) < 1e-6);
  assert.match(m.notes.join(' '), /1 punto sin altitud no aparece/);
});

test('build: si el primer punto no tiene altitud, el perfil empieza en el primero que sí la tiene', () => {
  const m = Perfil.build([{ name: 'X0', lat: 4.6, lon: -74.1 }, P[0], P[1]]);
  assert.equal(m.items[0].name, 'P1');                         // el primero con altitud, no el X0 sin altitud
  assert.equal(m.items[0].dist, 0);
  assert.equal(m.items.length, 2);
  assert.ok(Math.abs(m.total - dist(P[0], P[1])) < 1e-6);
});

test('build: nombre por defecto con la posición real en la lista', () => {
  const m = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100 }, { lat: 4.7, lon: -74.1, alt: 120 }]);
  assert.deepEqual(m.items.map((i) => i.name), ['P1', 'P2']);
});

test('build: sin al menos 2 altitudes o sin recorrido no hay perfil y dice por qué', () => {
  const uno = Perfil.build([P[0], { lat: 4.7, lon: -74.1 }]);
  assert.equal(uno.ok, false); assert.match(uno.reason, /al menos 2 puntos con altitud/); assert.equal(uno.missing, 1);
  assert.equal(Perfil.build([]).ok, false);
  assert.equal(Perfil.build().ok, false);
  const igual = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100 }, { lat: 4.6, lon: -74.1, alt: 120 }]);
  assert.equal(igual.ok, false); assert.match(igual.reason, /mismo lugar/);
});

test('build: ignora puntos con coordenadas rotas', () => {
  const m = Perfil.build([P[0], { name: 'X', lat: NaN, lon: -74, alt: 5 }, { name: 'Y', lat: 95, lon: 0, alt: 5 }, null, P[1]]);
  assert.equal(m.items.length, 2);
  assert.equal(m.missing, 0);
});

test('build: avisos sobre la altitud del GPS, el poco desnivel y la mezcla de fuentes', () => {
  const uno = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100, altSrc: 'gps' }, { lat: 4.7, lon: -74.1, alt: 400, altSrc: 'manual' }]);
  assert.match(uno.notes[0], /^1 altitud fue tomada con el GPS/);
  assert.equal(uno.notes.some((n) => /ruido del GPS/.test(n)), false);          // 300 m de desnivel: no es ruido
  assert.match(uno.notes.join(' '), /varias fuentes \(GPS, a mano\)/);

  const plano = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100, altSrc: 'gps' }, { lat: 4.7, lon: -74.1, alt: 108, altSrc: 'gps' }, { lat: 4.8, lon: -74.1, alt: 103, altSrc: 'gps' }]);
  assert.match(plano.notes[0], /^3 altitudes fueron tomadas/);
  assert.match(plano.notes[1], /\(8 m\) es del orden de ese error/);
  assert.equal(plano.notes.length, 2);

  const sinGps = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100, altSrc: 'internet' }, { lat: 4.7, lon: -74.1, alt: 104, altSrc: 'internet' }]);
  assert.deepEqual(sinGps.notes, []);                // sin GPS y con una sola fuente, no hay nada que advertir
});

test('build: fuente desconocida o ausente se llama «a mano»; archivo e internet tienen nombre propio', () => {
  assert.equal(Perfil.srcLabel('gps'), 'GPS');
  assert.equal(Perfil.srcLabel('internet'), 'internet');
  assert.equal(Perfil.srcLabel('archivo'), 'archivo');
  assert.equal(Perfil.srcLabel('manual'), 'a mano');
  assert.equal(Perfil.srcLabel('toString'), 'a mano');      // no confunde nombres heredados de Object
  assert.equal(Perfil.srcLabel(undefined), 'a mano');
  const m = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 100 }, { lat: 4.7, lon: -74.1, alt: 400 }]);
  assert.equal(m.items[0].src, 'manual'); assert.equal(m.items[0].srcLabel, 'a mano');
});

test('rows: datos para la tabla del informe', () => {
  const rows = Perfil.rows(Perfil.build(P));
  assert.deepEqual(rows.map((r) => r[0]), ['Punto más alto', 'Punto más bajo', 'Desnivel entre ambos', 'Ascenso acumulado', 'Descenso acumulado', 'Longitud del recorrido', 'Tramo más inclinado']);
  assert.equal(rows[0][1], 'P2 · 420 m');
  assert.equal(rows[1][1], 'P4 · 317 m');
  assert.equal(rows[2][1], '103 m');
  assert.match(rows[5][1], /m$/);
  assert.match(rows[6][1], /^P\d → P\d · \d+ %$/);
  assert.deepEqual(Perfil.rows({ ok: false }), []);
  assert.deepEqual(Perfil.rows(null), []);
});

test('niceStep: el paso redondo más pequeño que alcanza', () => {
  assert.equal(Perfil.niceStep(0.4), 1);
  assert.equal(Perfil.niceStep(23), 25);
  assert.equal(Perfil.niceStep(33), 50);
  assert.equal(Perfil.niceStep(100), 100);
  assert.equal(Perfil.niceStep(99999), 5000);
});

test('svg: sin datos devuelve un dibujo vacío', () => {
  assert.match(Perfil.svg({ ok: false }), /Perfil del relieve sin datos/);
  assert.match(Perfil.svg(null), /<svg/);
});

test('svg: ejes, cotas «P2 · 420 m», inicio, fin y distancia total', () => {
  const m = Perfil.build(P);
  const s = Perfil.svg(m);
  assert.match(s, /^<svg [^>]*viewBox="0 0 640 340"/);
  assert.match(s, />Altitud \(m\)</);
  assert.match(s, />Inicio</);
  assert.ok(s.includes('Fin · ' + require('../www/js/fmt.js').dist(m.total)));
  assert.match(s, />Distancia acumulada del recorrido</);
  for (const n of ['P1 · 389 m', 'P2 · 420 m', 'P3 · 370 m', 'P4 · 317 m', 'P5 · 370 m']) assert.ok(s.includes('>' + n + '<'), n);
  assert.equal((s.match(/<circle /g) || []).length, 5);
  // los valores del eje son múltiplos redondos y rodean a todos los puntos
  const ticks = [...s.matchAll(/text-anchor="end" fill="#5B6F61">(\d+) m</g)].map((x) => Number(x[1]));
  assert.ok(ticks.length >= 3);
  assert.ok(ticks[0] <= 317 && ticks[ticks.length - 1] >= 420, JSON.stringify(ticks));
  const pasos = new Set(ticks.slice(1).map((t, i) => t - ticks[i]));
  assert.equal(pasos.size, 1, 'el eje avanza de a un paso fijo: ' + JSON.stringify(ticks));
  const paso = [...pasos][0];
  assert.equal(Perfil.niceStep(paso), paso, 'el paso es un número redondo');
  ticks.forEach((t) => assert.equal(t % paso, 0));
});

test('svg: color, tamaño e identificador se pueden elegir y un color malo se cambia por el verde de la app', () => {
  const m = Perfil.build(P);
  const a = Perfil.svg(m, { color: '#112233', width: 800, height: 400, id: 'x1' });
  assert.match(a, /viewBox="0 0 800 400"/); assert.match(a, /id="x1-fill"/); assert.match(a, /stroke="#112233"/);
  const b = Perfil.svg(m, { color: 'rojo"><script>' });
  assert.match(b, /stroke="#2F8F4E"/); assert.doesNotMatch(b, /<script/);
  const c = Perfil.svg(m, { id: 'a"><script>' });
  assert.doesNotMatch(c, /<script/);
});

test('svg: los nombres de los puntos se escriben como texto, nunca como código', () => {
  const m = Perfil.build([{ name: '<img src=x onerror=alert(1)>', lat: 4.6, lon: -74.1, alt: 100 }, { name: 'B&B', lat: 4.7, lon: -74.1, alt: 300 }]);
  const s = Perfil.svg(m);
  assert.doesNotMatch(s, /<img/);
  assert.match(s, /&lt;img src=x onerror=alert\(1\)&gt; · 100 m/);
  assert.match(s, /B&amp;B · 300 m/);
});

test('svg: rótulos cercanos se alternan arriba y abajo y los de los bordes no se salen del dibujo', () => {
  // cuatro puntos muy juntos al inicio y uno lejos
  const m = Perfil.build([
    { name: 'A', lat: 4.6000, lon: -74.1, alt: 100 }, { name: 'B', lat: 4.6001, lon: -74.1, alt: 105 },
    { name: 'C', lat: 4.6002, lon: -74.1, alt: 102 }, { name: 'D', lat: 4.6003, lon: -74.1, alt: 108 },
    { name: 'E', lat: 4.7, lon: -74.1, alt: 300 }
  ]);
  const s = Perfil.svg(m);
  const y = (name) => Number(new RegExp('<text x="[\\d.]+" y="([\\d.]+)"[^>]*>' + name + ' ·').exec(s)[1]);
  const cy = (i) => Number([...s.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)][i][1]);
  assert.equal(y('A'), Math.round((cy(0) - 10) * 10) / 10);       // el primero va arriba
  assert.equal(Math.round((y('B') - cy(1)) * 10) / 10, 19);       // el segundo, pegado al primero, va abajo
  assert.equal(Math.round((y('C') - cy(2)) * 10) / 10, -10);      // el tercero vuelve arriba
  assert.match(s, /text-anchor="start"[^>]*>A ·/);                // en el borde izquierdo el texto crece hacia la derecha
  assert.match(s, /text-anchor="end"[^>]*>E ·/);                  // y en el derecho, hacia la izquierda
});

test('svg: con más de 10 puntos solo se rotulan el primero, el último, el más alto y el más bajo', () => {
  const pts = [];
  for (let i = 0; i < 14; i++) pts.push({ name: 'Q' + i, lat: 4.6 + i * 0.001, lon: -74.1, alt: 1000 + (i === 5 ? 80 : i === 9 ? -40 : i) });
  const m = Perfil.build(pts);
  const s = Perfil.svg(m);
  assert.equal((s.match(/<circle /g) || []).length, 14);
  const labels = [...s.matchAll(/>(Q\d+) · /g)].map((x) => x[1]);
  assert.deepEqual(labels.sort(), ['Q0', 'Q13', 'Q5', 'Q9'].sort());
});

test('svg: perfil plano (todas las altitudes iguales) también se dibuja', () => {
  const m = Perfil.build([{ lat: 4.6, lon: -74.1, alt: 500 }, { lat: 4.7, lon: -74.1, alt: 500 }]);
  const s = Perfil.svg(m);
  assert.match(s, /500 m/);
  assert.doesNotMatch(s, /NaN|Infinity/);
  const ticks = [...s.matchAll(/text-anchor="end" fill="#5B6F61">(\d+) m</g)].map((x) => Number(x[1]));
  assert.ok(ticks[0] < 500 && ticks[ticks.length - 1] > 500);
});

test('svg: nunca escribe NaN ni Infinity en ningún caso', () => {
  for (const pts of [P, [P[0], P[1]], [{ lat: 4.6, lon: -74.1, alt: -50 }, { lat: 4.6, lon: -74.0, alt: 6000 }]]) {
    assert.doesNotMatch(Perfil.svg(Perfil.build(pts)), /NaN|Infinity|undefined/);
  }
});

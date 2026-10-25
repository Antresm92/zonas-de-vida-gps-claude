'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WL = require('../www/js/walter-lieth.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` esperado ${b} ± ${tol}, obtenido ${a}`);
const flat = (v) => new Array(12).fill(v);

test('compute: rechaza datos incompletos o inválidos', () => {
  assert.equal(WL.compute([1, 2], flat(10)).ok, false);
  assert.equal(WL.compute(flat(20), flat(NaN)).ok, false);
  assert.equal(WL.compute(flat(20), flat(-5)).ok, false);
  assert.equal(WL.compute(null, null).ok, false);
});

test('compute: mes seco cuando P < 2T (estricto) y déficit acumulado', () => {
  const T = flat(20), P = flat(100);
  P[0] = 30; P[1] = 40; P[2] = 10;       // 2T = 40: enero y marzo secos; febrero (P = 2T) no
  const d = WL.compute(T, P);
  assert.deepEqual(d.dryMonths, [0, 2]);
  assert.equal(d.deficit, 10 + 30);
  near(d.tMean, 20, 1e-9); near(d.pSum, 100 * 9 + 80, 1e-9);
  assert.equal(d.noDry, false); assert.equal(d.allDry, false);
});

test('compute: el período seco es circular (diciembre sigue a enero)', () => {
  const T = flat(20), P = flat(100);
  P[10] = 5; P[11] = 5; P[0] = 5; P[1] = 5; P[6] = 5;
  const d = WL.compute(T, P);
  assert.deepEqual(d.runs.map((r) => [r.start, r.end, r.length]).sort((a, b) => b[2] - a[2]), [[10, 1, 4], [6, 6, 1]]);
  assert.equal(d.longestRun.length, 4);
  assert.match(WL.summary(d).join(' '), /noviembre a febrero \(4 meses\)/);
});

test('compute: todos secos, ninguno seco y meses bajo cero', () => {
  const all = WL.compute(flat(25), flat(10));
  assert.equal(all.allDry, true); assert.equal(all.runs[0].length, 12);
  assert.match(WL.summary(all).join(' '), /Todos los meses son secos/);
  const none = WL.compute(flat(10), flat(80));
  assert.equal(none.noDry, true); assert.deepEqual(none.runs, []);
  assert.match(WL.summary(none).join(' '), /Ningún mes es seco/);
  const cold = WL.compute(flat(-3), flat(20));
  assert.deepEqual(cold.dryMonths, []);                  // 2T < 0 ≤ P: nunca es "seco"
  assert.match(WL.summary(cold).join(' '), /bajo 0 °C/);
});

test('yOfP: P/2 hasta 100 mm y escala ÷10 por encima', () => {
  assert.equal(WL.yOfP(0), 0); assert.equal(WL.yOfP(60), 30); assert.equal(WL.yOfP(100), 50);
  assert.equal(WL.yOfP(200), 55); assert.equal(WL.yOfP(300), 60);
});

// Área de las zonas de relleno = integral numérica de |T − yP| (incluye el cruce en 100 mm y los cruces T = P/2)
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
function numeric(d) {
  let s = 0; const N = 4000;
  for (let i = 0; i < 11; i++) for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N;
    const T = d.months[i].T + (d.months[i + 1].T - d.months[i].T) * t, P = d.months[i].P + (d.months[i + 1].P - d.months[i].P) * t;
    s += Math.abs(T - WL.yOfP(P)) / N;
  }
  return s;
}
test('regions: las zonas cubren exactamente el espacio entre las dos curvas', () => {
  const casos = [
    [[14, 14.2, 14.5, 14.6, 14.4, 14, 13.8, 13.9, 14.1, 14.3, 14.2, 14], [60, 90, 140, 190, 170, 80, 40, 35, 70, 190, 210, 120]],
    [flat(26), [10, 20, 55, 130, 250, 400, 120, 90, 60, 150, 30, 5]],
    [[22, 23, 24, 24, 23, 22, 21, 21, 22, 22, 22, 22], [160, 110, 95, 105, 300, 90, 20, 15, 80, 140, 170, 190]],
    [flat(5), flat(100)]
  ];
  casos.forEach(([T, P], k) => {
    const d = WL.compute(T, P);
    const rs = WL.regions(d);
    const total = rs.reduce((a, r) => a + polyArea(r.pts), 0);
    near(total, numeric(d), 0.01 * Math.max(1, numeric(d)) , 'caso ' + k);
    rs.forEach((r) => { assert.ok(['dry', 'humid', 'super'].includes(r.kind)); assert.equal(r.pts.length, 4); });
  });
});

test('regions: el cruce está donde T = P/2 y la zona seca queda sobre la curva de lluvia', () => {
  const T = flat(20), P = flat(60);
  P[0] = 30; P[1] = 50;                                   // 2T = 40: cruza a mitad del tramo enero–febrero
  const d = WL.compute(T, P);
  const rs = WL.regions(d).filter((r) => r.pts[0].x < 1 && r.pts[1].x <= 1);
  const dry = rs.filter((r) => r.kind === 'dry'), hum = rs.filter((r) => r.kind === 'humid');
  assert.equal(dry.length, 1); assert.equal(hum.length, 1);
  near(dry[0].pts[1].x, 0.5, 1e-9); near(hum[0].pts[0].x, 0.5, 1e-9);
  assert.ok(dry[0].pts[0].y < dry[0].pts[3].y, 'seco: la lluvia (abajo) por debajo de T (arriba)');
});

test('regions: sobre 100 mm aparece la zona sólida entre la línea de 100 mm y la curva', () => {
  const d = WL.compute(flat(15), [50, 90, 110, 200, 300, 150, 80, 60, 40, 95, 120, 70]);
  const sup = WL.regions(d).filter((r) => r.kind === 'super');
  assert.ok(sup.length >= 3);
  sup.forEach((r) => { near(r.pts[0].y, 50, 1e-9); assert.ok(r.pts[3].y >= 50 - 1e-9); });
  assert.deepEqual(d.superhumidMonths, [2, 3, 4, 5, 10]);
});

test('svg: dibuja la figura con rellenos, meses, leyenda y texto alternativo', () => {
  const d = WL.compute([14, 14.2, 14.5, 14.6, 14.4, 14, 13.8, 13.9, 14.1, 14.3, 14.2, 14], [60, 90, 140, 190, 170, 20, 10, 15, 70, 190, 210, 120]);
  const s = WL.svg(d, { title: 'Finca <Ejemplo>', subtitle: 'Altitud 1.310 m' });
  assert.match(s, /^<svg [^>]*role="img"/);
  assert.match(s, /aria-label="Diagrama de Walter-Lieth\./);
  assert.match(s, /Finca &lt;Ejemplo&gt;/);
  assert.ok(!/Finca <Ejemplo>/.test(s), 'el título se escapa');
  ['Ene', 'Jun', 'Dic'].forEach((m) => assert.ok(s.includes('>' + m + '<')));
  assert.match(s, /url\(#wl-dry\)/); assert.match(s, /url\(#wl-hum\)/);
  assert.match(s, /Período seco/); assert.match(s, /P &gt; 100 mm/);
  assert.equal((s.match(/<polyline/g) || []).length, 2);
  assert.equal(WL.svg({ ok: false }), '');
  assert.ok(WL.svg(d, { id: 'x1' }).includes('id="x1-dry"'));
  const sinMucha = WL.svg(WL.compute(flat(20), flat(50)));
  assert.ok(!/escala ÷10/.test(sinMucha), 'sin más de 100 mm no hay escala comprimida');
  assert.ok(!/NaN|undefined/.test(s));
});

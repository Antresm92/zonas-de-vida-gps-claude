'use strict';
/* Ajustar a los linderos (2.21.0): recorte de polígonos y ajuste de un área a su finca y a sus vecinos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const Recorte = require('../www/js/recorte.js');
const Predio = require('../www/js/predio.js');

const LAT = 4.6, LON = -74.08, FR = Geo.localFrame([{ lat: LAT, lon: LON }]);
// Punto a (x, y) metros del origen
const P = (x, y, extra) => Object.assign(Geo.fromXY(FR, { x, y }), extra || {});
const rect = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const m2 = (pts) => Geo.polygonArea(pts);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b);
const xy = (p) => { const q = Geo.toXY(FR, p); return Math.round(q.x) + ',' + Math.round(q.y); };

test('clip «and»: lo que queda dentro de la finca; los puntos propios que siguen son los mismos objetos', () => {
  const A = rect(50, 20, 150, 80).map((p, i) => Object.assign(p, { id: 'a' + i, name: 'P' + (i + 1), alt: 1000 + 100 * i }));
  const F = rect(0, 0, 100, 100);
  const r = Recorte.clip(A, F, 'and');
  assert.equal(r.changed, true); assert.equal(r.pieces.length, 1); assert.equal(r.holes, 0);
  const g = r.pieces[0];
  assert.deepEqual(g.map(xy).sort(), ['100,20', '100,80', '50,20', '50,80']);
  near(m2(g), 50 * 60, 3, 'área');
  assert.ok(g.includes(A[0]) && g.includes(A[3]), 'P1 y P4 siguen siendo los mismos');
  assert.ok(!g.includes(A[1]) && !g.includes(A[2]), 'P2 y P3 quedaban fuera');
  const nuevos = g.filter((p) => !A.includes(p));
  assert.equal(nuevos.length, 2);
  // altitud interpolada sobre el lado propio: entre P1 (1000) y P2 (1100) a la mitad → 1050; entre P3 (1200) y P4 (1300) → 1250
  assert.deepEqual(nuevos.map((p) => p.alt).sort(), [1050, 1250]);
  assert.ok(nuevos.every((p) => p.id === undefined && p.name === undefined));
});

test('clip «not»: lo que queda fuera del vecino es una L; si no se tocan o solo comparten un lado, no cambia nada', () => {
  const A = rect(0, 0, 100, 100), B = rect(50, 50, 150, 150);
  const r = Recorte.clip(A, B, 'not');
  assert.equal(r.pieces.length, 1);
  assert.deepEqual(r.pieces[0].map(xy).sort(), ['0,0', '0,100', '100,0', '100,50', '50,100', '50,50']);
  near(m2(r.pieces[0]), 7500, 5);
  const lejos = Recorte.clip(A, rect(300, 300, 400, 400), 'not');
  assert.equal(lejos.changed, false); assert.deepEqual(lejos.pieces[0].map(xy), A.map(xy));
  const lado = Recorte.clip(A, rect(100, 0, 200, 100), 'not');
  assert.equal(lado.changed, false, 'compartir un lado no es montarse');
  const esquina = Recorte.clip(A, rect(100, 100, 200, 200), 'not');
  assert.equal(esquina.changed, false, 'ni compartir una esquina');
  assert.equal(Recorte.clip(A, rect(100, 0, 200, 100), 'and').pieces.length, 0, 'dentro del vecino de al lado no queda nada');
});

test('clip: vecino metido por completo deja un hueco; vecino que parte en dos deja dos pedazos; iguales no dejan nada', () => {
  const A = rect(0, 0, 100, 100);
  const hueco = Recorte.clip(A, rect(40, 40, 60, 60), 'not');
  assert.equal(hueco.holes, 1); assert.equal(hueco.pieces.length, 1);
  const dos = Recorte.clip(A, rect(40, -10, 60, 110), 'not');
  assert.equal(dos.pieces.length, 2); assert.equal(dos.holes, 0);
  near(m2(dos.pieces[0]) + m2(dos.pieces[1]), 8000, 6);
  const igual = Recorte.clip(A, rect(0, 0, 100, 100), 'not');
  assert.equal(igual.pieces.length, 0); assert.equal(igual.changed, true);
  assert.equal(Recorte.clip(A, rect(0, 0, 100, 100), 'and').changed, false, 'iguales: dentro queda todo');
  assert.deepEqual(Recorte.clip([P(0, 0), P(1, 1)], A, 'and'), { pieces: [], holes: 0, changed: false });
  assert.deepEqual(Recorte.clip(null, A, 'and'), { pieces: [], holes: 0, changed: false });
});

test('adjust: recorta a la finca y al vecino, conserva el sentido del recorrido y empieza en el punto propio más antiguo', () => {
  const F = rect(0, 0, 200, 200), caf = rect(20, 20, 100, 100);
  // el bosque (en sentido de las agujas del reloj) se monta sobre el cafetal y se sale de la finca por la derecha
  const bos = [P(60, 60), P(60, 160), P(260, 160), P(260, 60)].map((p, i) => Object.assign(p, { id: 'b' + i, name: 'P' + (i + 1) }));
  const r = Recorte.adjust(bos, F, [{ name: 'Cafetal', points: caf }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.points.map(xy), ['60,160', '200,160', '200,60', '100,60', '100,100', '60,100']);
  assert.equal(r.points[0], bos[1], 'P1 quedó dentro del cafetal: se empieza en P2, el más antiguo que sigue');
  assert.equal(r.removed, 3); assert.equal(r.added, 5); assert.equal(r.dropped, 0); assert.deepEqual(r.skipped, []);
  near(r.m2Before, 200 * 100, 20); near(r.m2After, 140 * 100 - 40 * 40, 20);
  // después del ajuste ya no hay avisos
  assert.equal(Geo.sticksOut(r.points, F), false);
  assert.equal(Geo.polygonsOverlap(r.points, caf), false);
  // el mismo en sentido contrario da el recorrido al revés
  const r2 = Recorte.adjust(bos.slice().reverse(), F, [{ name: 'Cafetal', points: caf }]);
  assert.deepEqual(r2.points.map(xy).slice(1).reverse().concat(r2.points.map(xy)[0]).sort(), r.points.map(xy).sort());
  assert.equal(Geo.polygonArea(r2.points) > 0, true);
});

test('adjust: explica cuando no hay nada que ajustar o no se puede', () => {
  const F = rect(0, 0, 200, 200), A = rect(20, 20, 80, 80);
  assert.match(Recorte.adjust(A, F, []).reason, /ya respeta los linderos/);
  assert.match(Recorte.adjust(A, null, [{ name: 'X', points: rect(80, 20, 120, 80) }]).reason, /ya respeta/);
  assert.match(Recorte.adjust(rect(300, 300, 350, 350), F, []).reason, /por fuera de la finca/);
  assert.match(Recorte.adjust(A, F, [{ name: 'Grande', points: rect(10, 10, 90, 90) }]).reason, /por completo dentro de otro/);
  const dentro = Recorte.adjust(A, F, [{ name: 'Casa', points: rect(40, 40, 50, 50) }]);
  assert.equal(dentro.ok, false); assert.match(dentro.reason, /«Casa» está por completo dentro/); assert.deepEqual(dentro.skipped, ['Casa']);
  assert.match(Recorte.adjust([P(0, 0), P(1, 1)], F, []).reason, /3 puntos/);
  assert.match(Recorte.adjust([P(0, 0), P(50, 0), P(100, 0)], F, []).reason, /no tiene área/);
  assert.match(Recorte.adjust(null).reason, /3 puntos/);
});

test('adjust: si el vecino lo parte en dos se conserva el pedazo más grande y se dice cuántos se descartaron; un vecino metido se salta pero los demás se descuentan', () => {
  const A = rect(0, 0, 100, 100);
  const r = Recorte.adjust(A, null, [{ name: 'Camino', points: rect(60, -10, 70, 110) }]);
  assert.equal(r.ok, true); assert.equal(r.dropped, 1);
  near(r.m2After, 60 * 100, 5, 'queda el pedazo de la izquierda');
  const s = Recorte.adjust(A, null, [{ name: 'Casa', points: rect(10, 10, 20, 20) }, { name: 'Vecino', points: rect(80, 0, 180, 100) }]);
  assert.equal(s.ok, true); assert.deepEqual(s.skipped, ['Casa']); near(s.m2After, 8000, 5);
});

test('rename: los nombres propios se conservan; los automáticos y los nuevos se numeran seguidos', () => {
  const r = Recorte.rename([{ id: 1, name: 'P7' }, { lat: 1, lon: 2 }, { id: 2, name: 'Portada' }, { id: 3, name: 'P2' }, { id: 4, name: '' }]);
  assert.deepEqual(r.points.map((p) => p.name), ['P1', 'P2', 'Portada', 'P3', 'P4']);
  assert.equal(r.next, 5);
  assert.equal(r.points[1].lat, 1);
  assert.deepEqual(Recorte.rename(null), { points: [], next: 1 });
});

test('conflicts: con qué choca un polígono (se sale de su finca, se monta sobre vecinos); finca y área no chocan', () => {
  const lots = [
    { id: 'f', name: 'Finca', kind: 'finca', points: rect(0, 0, 200, 200) },
    { id: 'c', name: 'Cafetal', kind: 'area', parent: 'f', points: rect(20, 20, 100, 100) },
    { id: 'b', name: 'Bosque', kind: 'area', parent: 'f', points: rect(60, 60, 260, 160) },
    { id: 'p', name: 'Potrero', kind: 'area', parent: 'f', points: rect(120, 10, 180, 50) },
    { id: 'v', name: 'Vacío', points: [] }
  ];
  const c = Predio.conflicts(lots, 'b');
  assert.equal(c.finca.id, 'f'); assert.deepEqual(c.others.map((o) => o.id), ['c']);
  assert.match(c.text, /^«Bosque» se sale de la finca «Finca» y se monta sobre «Cafetal»\.$/);
  const k = Predio.conflicts(lots, 'c');
  assert.equal(k.finca, null); assert.deepEqual(k.others.map((o) => o.id), ['b']);
  assert.equal(k.text, '«Cafetal» se monta sobre «Bosque».');
  assert.equal(Predio.conflicts(lots, 'p'), null);
  assert.equal(Predio.conflicts(lots, 'f'), null, 'la finca no choca con sus áreas');
  assert.equal(Predio.conflicts(lots, 'v'), null); assert.equal(Predio.conflicts(lots, 'no'), null); assert.equal(Predio.conflicts(null, 'b'), null);
  assert.equal(Predio.conflictKey(c), 'F:f|c'); assert.equal(Predio.conflictKey(null), '');
});

test('recorte al azar: el resultado coincide punto por punto con «dentro de A y dentro (o fuera) de B»', () => {
  let seed = 20261112;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const star = (cx, cy, r, n) => { const out = [], off = rnd() * 6.28; for (let i = 0; i < n; i++) { const a = off + i / n * 6.283, rr = r * (0.35 + 0.65 * rnd()); out.push(P(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); } return rnd() < 0.5 ? out.reverse() : out; };
  const g = () => Math.round((rnd() - 0.5) * 12) * 50;
  const box = () => { let x0 = g(), x1 = g(), y0 = g(), y1 = g(); if (x0 === x1) x1 += 50; if (y0 === y1) y1 += 50; return rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)); };
  const inside = (p, r) => { let inn = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inn = !inn; } return inn; };
  let multi = 0;
  for (let t = 0; t < 400; t++) {
    const grid = t % 4 === 3;                    // uno de cada cuatro: rectángulos en cuadrícula (lados y esquinas compartidos)
    const A = grid ? box() : star(0, 0, 300, 3 + Math.floor(rnd() * 9)), B = grid ? box() : star((rnd() - 0.5) * 500, (rnd() - 0.5) * 500, 100 + rnd() * 300, 3 + Math.floor(rnd() * 9));
    const and = Recorte.clip(A, B, 'and'), not = Recorte.clip(A, B, 'not');
    assert.ok(!and.bad && !not.bad, 'caso ' + t);
    if (and.pieces.length > 1 || not.pieces.length > 1) multi++;
    let err = 0;
    for (let s = 0; s < 300; s++) {
      const p = P((rnd() - 0.5) * 800 + 0.37, (rnd() - 0.5) * 800 + 0.41), ia = inside(p, A), ib = inside(p, B);
      if (and.pieces.some((r) => inside(p, r)) !== (ia && ib)) err++;
      if (!not.holes && not.pieces.some((r) => inside(p, r)) !== (ia && !ib)) err++;
    }
    assert.ok(err <= 1, 'caso ' + t + ': ' + err + ' puntos mal clasificados');
    // las áreas cuadran: lo de dentro más lo de fuera es todo A
    if (!not.holes) near(and.pieces.reduce((s, r) => s + m2(r), 0) + not.pieces.reduce((s, r) => s + m2(r), 0), m2(A), Math.max(4, m2(A) * 1e-4), 'caso ' + t + ' áreas');
  }
  assert.ok(multi > 20, 'el azar incluye casos con varios pedazos: ' + multi);
});

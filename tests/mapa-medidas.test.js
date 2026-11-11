'use strict';
/* mapa.js — medidas sobre el mapa (lados, resumen, medir), caminar el lindero y el toque simple sobre un punto. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Mapa = require('../www/js/mapa.js');
const Geo = require('../www/js/geo.js');

const P = (name, lat, lon, extra) => Object.assign({ id: 'id-' + name, name, lat, lon }, extra || {});
const cuadro = [P('P1', 4.6, -74.08), P('P2', 4.6, -74.079), P('P3', 4.601, -74.079), P('P4', 4.601, -74.08)];

test('haversine, bearing y compass: distancias y rumbos de referencia', () => {
  assert.ok(Math.abs(Mapa.haversine(0, 0, 0, 1) - 111195) < 5);
  assert.equal(Mapa.haversine(4.6, -74, 4.6, -74), 0);
  assert.ok(Math.abs(Mapa.haversine(4.6, -74.08, 4.601, -74.08) - Geo.haversine(4.6, -74.08, 4.601, -74.08)) < 0.5);
  assert.ok(Math.abs(Mapa.bearing(0, 0, 1, 0) - 0) < 1e-9);
  assert.ok(Math.abs(Mapa.bearing(0, 0, 0, 1) - 90) < 1e-9);
  assert.ok(Math.abs(Mapa.bearing(0, 0, -1, 0) - 180) < 1e-9);
  assert.ok(Math.abs(Mapa.bearing(0, 0, 0, -1) - 270) < 1e-9);
  assert.deepEqual([0, 44, 90, 135, 180, 225, 270, 315, 359, 360, -45, 405].map(Mapa.compass),
    ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste', 'norte', 'norte', 'noroeste', 'noreste']);
  assert.equal(Mapa.compass(22), 'norte');
  assert.equal(Mapa.compass(23), 'noreste');
  assert.equal(Mapa.compass(NaN), '');
  assert.equal(Mapa.compass(), '');
});

test('sides: un lado por cada par de puntos seguidos; cerrado, el último vuelve al primero', () => {
  const s = Mapa.sides(cuadro, true);
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((x) => x.after), [0, 1, 2, 3]);
  assert.deepEqual(s[0].a, [4.6, -74.08]);
  assert.deepEqual(s[0].b, [4.6, -74.079]);
  assert.ok(Math.abs(s[0].mid[0] - 4.6) < 1e-12 && Math.abs(s[0].mid[1] - -74.0795) < 1e-12);
  assert.deepEqual(s[3].b, [4.6, -74.08]);                       // el último lado cierra con el primero
  assert.ok(Math.abs(s[0].meters - 110.8) < 0.5);
  assert.equal(s[0].text, '111 m');
  assert.equal(s[1].text, '111 m');
  const abierto = Mapa.sides(cuadro, false);
  assert.equal(abierto.length, 3);
  assert.equal(Mapa.sides(cuadro.slice(0, 2), true).length, 1);  // dos puntos: un solo lado aunque se pida cerrado
  assert.equal(Mapa.sides(cuadro.slice(0, 2), false).length, 1);
  assert.deepEqual(Mapa.sides(cuadro.slice(0, 1), true), []);
  assert.deepEqual(Mapa.sides([], true), []);
  assert.deepEqual(Mapa.sides(null, true), []);
  // los puntos sin coordenadas válidas no cuentan
  assert.equal(Mapa.sides([cuadro[0], { lat: 'x', lon: 1 }, cuadro[1], cuadro[2]], true).length, 3);
});

test('sides: usa la distancia y el formato de la app si se le dan; lados largos en km', () => {
  const s = Mapa.sides(cuadro, true, () => 1234.5, (m) => 'D' + m);
  assert.equal(s[0].meters, 1234.5);
  assert.equal(s[0].text, 'D1234.5');
  assert.equal(Mapa.sides([P('a', 0, 0), P('b', 0, 1)], false)[0].text, '111.2 km');
  assert.equal(Mapa.sides([P('a', 0, 0), P('b', 0, 0.00898)], false)[0].text, '999 m');
});

test('shapes: lleva los lados cuando el polígono está activo y ninguno cuando está inactivo o hay menos de 2 puntos', () => {
  const s = Mapa.shapes({ points: cuadro }, { dist: Geo.distance, fmtDist: (m) => Math.round(m) + ' metros' });
  assert.equal(s.sides.length, 4);
  assert.match(s.sides[0].text, /^11[01] metros$/);
  assert.equal(Mapa.shapes({ points: cuadro.slice(0, 2) }).sides.length, 1);
  assert.deepEqual(Mapa.shapes({ points: cuadro }, { polyActive: false }).sides, []);
  assert.deepEqual(Mapa.shapes({ points: cuadro.slice(0, 1) }).sides, []);
  assert.deepEqual(Mapa.shapes({}).sides, []);
});

test('sideShows: el rótulo pide 64 px de lado y el «+» 96 px', () => {
  assert.deepEqual(Mapa.sideShows(63.9), { label: false, plus: false });
  assert.deepEqual(Mapa.sideShows(64), { label: true, plus: false });
  assert.deepEqual(Mapa.sideShows(95.9), { label: true, plus: false });
  assert.deepEqual(Mapa.sideShows(96), { label: true, plus: true });
  assert.deepEqual(Mapa.sideShows(NaN), { label: false, plus: false });
  assert.deepEqual(Mapa.sideShows(), { label: false, plus: false });
  assert.equal(Mapa.SIDE_LABEL_MIN_PX, 64);
  assert.equal(Mapa.SIDE_PLUS_MIN_PX, 96);
});

test('summaryText: dice lo que falta con 1 y 2 puntos y da área y perímetro desde 3', () => {
  assert.equal(Mapa.summaryText(0, '', ''), '');
  assert.equal(Mapa.summaryText(-1), '');
  assert.equal(Mapa.summaryText(undefined), '');
  assert.equal(Mapa.summaryText(1, '', ''), '1 punto · faltan 2');
  assert.equal(Mapa.summaryText(2, '', '88 m'), '88 m · 2 puntos · falta 1');
  assert.equal(Mapa.summaryText(2, '', ''), '2 puntos · falta 1');
  assert.equal(Mapa.summaryText(4, '0,84 ha', '365 m'), '0,84 ha · 365 m · 4 puntos');
  // con los lados cruzados el área no sirve: se avisa en su lugar (solo desde 3 puntos, que es cuando puede pasar)
  assert.equal(Mapa.summaryText(4, '0,0000 ha', '1,56 km', true), 'Los lados se cruzan · toca para ordenar');
  assert.equal(Mapa.summaryText(2, '', '88 m', true), '88 m · 2 puntos · falta 1');
  assert.equal(Mapa.summaryText(4, '0,84 ha', '365 m', false), '0,84 ha · 365 m · 4 puntos');
  assert.equal(Mapa.summaryText(3, '', ''), '3 puntos');
  assert.equal(Mapa.summaryText(3, '1 ha', ''), '1 ha · 3 puntos');
});

test('relText: dónde queda un punto respecto a la posición del GPS', () => {
  const yo = { lat: 4.6, lon: -74.08 };
  assert.match(Mapa.relText(yo, { lat: 4.601, lon: -74.08 }), /^a 111 m de ti, hacia el norte$/);
  assert.match(Mapa.relText(yo, { lat: 4.5995, lon: -74.0795 }), /^a 7\d m de ti, hacia el sureste$/);
  assert.equal(Mapa.relText(yo, { lat: 4.60000001, lon: -74.08 }), 'estás sobre este punto');
  assert.equal(Mapa.relText(yo, { lat: 4.601, lon: -74.08 }, (m) => 'X'), 'a X de ti, hacia el norte');
  assert.equal(Mapa.relText(null, yo), '');
  assert.equal(Mapa.relText(yo, null), '');
  assert.equal(Mapa.relText({ lat: 91, lon: 0 }, yo), '');
});

test('medir: pide dos lugares, da distancia y rumbo, y el tercer toque empieza otra medida', () => {
  assert.match(Mapa.measureText([]), /toca dos lugares/);
  assert.match(Mapa.measureText(null), /toca dos lugares/);
  assert.match(Mapa.measureText([{ lat: 4.6, lon: -74.08 }]), /segundo lugar/);
  assert.equal(Mapa.measureText([{ lat: 4.6, lon: -74.08 }, { lat: 4.601, lon: -74.08 }]), '111 m · rumbo 0° (norte)');
  assert.equal(Mapa.measureText([{ lat: 4.6, lon: -74.08 }, { lat: 4.6, lon: -74.079 }]), '111 m · rumbo 90° (este)');
  assert.equal(Mapa.measureText([{ lat: 4.6, lon: -74.08 }, { lat: 4.6, lon: -74.079 }], (m) => 'F'), 'F · rumbo 90° (este)');
  assert.equal(Mapa.measureText([{ lat: 0.001, lon: 0 }, { lat: 0, lon: -0.0000001 }]).includes('rumbo 180°'), true);
  assert.match(Mapa.measureText([{ lat: 0, lon: 0 }, { lat: 1, lon: -0.000001 }]), /rumbo 0° \(norte\)/);   // 359,99° se escribe 0°, no 360°
  let m = Mapa.measureAdd([], { lat: 1, lon: 2 });
  assert.deepEqual(m, [{ lat: 1, lon: 2 }]);
  m = Mapa.measureAdd(m, { lat: 3, lon: 4, extra: 1 });
  assert.deepEqual(m, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
  assert.deepEqual(Mapa.measureAdd(m, { lat: 5, lon: 6 }), [{ lat: 5, lon: 6 }]);
  assert.deepEqual(Mapa.measureAdd(m, { lat: 'no', lon: 6 }), m);
  assert.deepEqual(Mapa.measureAdd(null, { lat: 5, lon: 6 }), [{ lat: 5, lon: 6 }]);
  assert.deepEqual(Mapa.measureAdd(null, null), []);
});

test('caminar el lindero: deja un punto cada tantos metros y no acepta lecturas malas', () => {
  assert.deepEqual(Mapa.TRACK_STEPS, [5, 10, 20, 50]);
  assert.equal(Mapa.trackStep(20), 20);
  assert.equal(Mapa.trackStep('5'), 5);
  assert.equal(Mapa.trackStep(7), 10);
  assert.equal(Mapa.trackStep(), 10);
  const a = { lat: 4.6, lon: -74.08 };
  const at = (m, acc) => ({ lat: 4.6 + m / 111195, lon: -74.08, acc });
  assert.equal(Mapa.trackDecision(null, at(0, 5), 10), 'add');             // la primera lectura buena deja el primer punto
  assert.equal(Mapa.trackDecision(a, at(9.5, 5), 10), 'near');
  assert.equal(Mapa.trackDecision(a, at(10.1, 5), 10), 'add');
  assert.equal(Mapa.trackDecision(a, at(10.1, 5), 20), 'near');
  assert.equal(Mapa.trackDecision(a, at(5.1, 5), 5), 'add');
  assert.equal(Mapa.trackDecision(a, at(30, 20.1), 10), 'imprecise');      // por defecto se aceptan hasta ±20 m
  assert.equal(Mapa.trackDecision(a, at(30, 20), 10), 'add');
  assert.equal(Mapa.trackDecision(a, at(30, 6), 10, 5), 'imprecise');      // con la precisión mínima de la app
  assert.equal(Mapa.trackDecision(a, at(30, 5), 10, 5), 'add');
  assert.equal(Mapa.trackDecision(a, at(30, 15), 10, 0), 'add');           // «Sin límite» en la app: vale el tope por defecto
  assert.equal(Mapa.trackDecision(a, at(30, null), 10), 'add');            // sin dato de precisión se acepta
  assert.equal(Mapa.trackDecision(a, { lat: 'x', lon: 1 }, 10), 'invalid');
  assert.equal(Mapa.trackDecision(a, null, 10), 'invalid');
  assert.equal(Mapa.trackDecision(a, at(12, 5), 999), 'add');              // un paso no válido usa 10 m
});

test('caminar el lindero: el texto dice cuántos puntos van y por qué está esperando', () => {
  assert.equal(Mapa.trackText({ added: 0, step: 10, last: 'none' }), 'Caminando el lindero: 0 puntos · uno cada 10 m · esperando la primera lectura del GPS');
  assert.equal(Mapa.trackText({ added: 1, step: 5 }), 'Caminando el lindero: 1 punto · uno cada 5 m');
  assert.equal(Mapa.trackText({ added: 7, step: 20, last: 'imprecise' }), 'Caminando el lindero: 7 puntos · uno cada 20 m · esperando mejor señal del GPS');
  assert.equal(Mapa.trackText({ added: 2, step: 20, last: 'near' }), 'Caminando el lindero: 2 puntos · uno cada 20 m');
  assert.equal(Mapa.trackText(), 'Caminando el lindero: 0 puntos · uno cada 10 m');
});

test('herramientas de la franja de abajo: mira, medir y caminar', () => {
  assert.deepEqual(Mapa.TOOLS, ['mira', 'medir', 'caminar', 'ir']);
  assert.equal(Mapa.toolId('ir'), 'ir');
  assert.equal(Mapa.toolId('medir'), 'medir');
  assert.equal(Mapa.toolId('otra'), '');
  assert.equal(Mapa.toolId(), '');
});

test('gesto sobre un punto: un toque corto avisa por onTap (si se pide) y el segundo, por onDouble', () => {
  let now = 1000; const log = [];
  const g = Mapa.pointGesture({ setTimer: () => 1, clearTimer: () => {}, now: () => now,
    onHold: () => log.push('hold'), onMove: () => log.push('move'), onDrop: () => log.push('drop'), onAbort: () => log.push('abort'),
    onDouble: (id) => log.push('double ' + id), onTap: (id) => log.push('tap ' + id) });
  g.down('a', 10, 10); g.up(10, 10);
  assert.deepEqual(log, ['tap a']);
  now += 200; g.down('a', 11, 10); g.up(11, 10);
  assert.deepEqual(log, ['tap a', 'double a']);
  now += 2000; g.down('b', 50, 50); g.up(50, 50);
  assert.deepEqual(log, ['tap a', 'double a', 'tap b']);
  // sin onTap no se rompe nada
  const g2 = Mapa.pointGesture({ setTimer: () => 1, clearTimer: () => {}, now: () => 1, onHold() {}, onMove() {}, onDrop() {}, onAbort() {}, onDouble() {} });
  g2.down('a', 1, 1); g2.up(1, 1);
  assert.equal(g2.state(), '');
});

test('orden del recorrido: cada punto del mapa lleva su puesto (1, 2, 3…)', () => {
  assert.deepEqual(Mapa.shapes({ points: cuadro }).points.map((m) => m.order), [1, 2, 3, 4]);
  assert.deepEqual(Mapa.shapes({ points: [cuadro[2], cuadro[0]] }).points.map((m) => [m.name, m.order]), [['P3', 1], ['P1', 2]]);
});

test('moveInOrder: pasa un punto un puesto antes o después sin tocar la lista original; en los extremos no hace nada', () => {
  const ids = (l) => l.map((q) => q.name).join(' ');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P3', -1)), 'P1 P3 P2 P4');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P3', 1)), 'P1 P2 P4 P3');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P3', -5)), 'P1 P3 P2 P4');     // siempre un solo puesto
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P1', -1)), 'P1 P2 P3 P4');     // el primero no puede ir antes
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P4', 1)), 'P1 P2 P3 P4');      // ni el último después
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P1', 1)), 'P2 P1 P3 P4');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P4', -1)), 'P1 P2 P4 P3');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'no-existe', 1)), 'P1 P2 P3 P4');
  assert.equal(ids(Mapa.moveInOrder(cuadro, 'id-P2', 0)), 'P1 P2 P3 P4');
  assert.equal(ids(cuadro), 'P1 P2 P3 P4');
  assert.notEqual(Mapa.moveInOrder(cuadro, 'id-P2', 1), cuadro);
  assert.deepEqual(Mapa.moveInOrder(null, 'x', 1), []);
  // ir y volver deja todo como estaba
  assert.equal(ids(Mapa.moveInOrder(Mapa.moveInOrder(cuadro, 'id-P2', 1), 'id-P2', -1)), 'P1 P2 P3 P4');
});

test('orderOf: puesto del punto en el recorrido y si es el primero o el último', () => {
  assert.deepEqual(Mapa.orderOf(cuadro, 'id-P1'), { pos: 1, n: 4, first: true, last: false });
  assert.deepEqual(Mapa.orderOf(cuadro, 'id-P3'), { pos: 3, n: 4, first: false, last: false });
  assert.deepEqual(Mapa.orderOf(cuadro, 'id-P4'), { pos: 4, n: 4, first: false, last: true });
  assert.deepEqual(Mapa.orderOf([cuadro[0]], 'id-P1'), { pos: 1, n: 1, first: true, last: true });
  assert.equal(Mapa.orderOf(cuadro, 'otro'), null);
  assert.equal(Mapa.orderOf(null, 'otro'), null);
});

test('rectsOverlap: dos rectángulos de pantalla se pisan solo si comparten área (tocarse por el borde no cuenta)', () => {
  const r = (left, top, right, bottom) => ({ left, top, right, bottom });
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(5, 5, 15, 15)), true);
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(2, 2, 4, 4)), true);       // uno dentro del otro
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(10, 0, 20, 10)), false);   // pegados por un lado
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(0, 10, 10, 20)), false);
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(11, 0, 20, 10)), false);
  assert.equal(Mapa.rectsOverlap(r(0, 0, 10, 10), r(0, 11, 10, 20)), false);
  assert.equal(Mapa.rectsOverlap(r(5, 5, 15, 15), r(0, 0, 10, 10)), true);     // en el otro orden
  assert.equal(Mapa.rectsOverlap(r(20, 0, 30, 10), r(0, 0, 10, 10)), false);
  assert.equal(Mapa.rectsOverlap(r(0, 20, 10, 30), r(0, 0, 10, 10)), false);
  assert.equal(Mapa.rectsOverlap(null, r(0, 0, 1, 1)), false);
  assert.equal(Mapa.rectsOverlap(r(0, 0, 1, 1), undefined), false);
});

test('navInfo: guía hasta un punto con distancia y rumbo, avisa al llegar (5 m) y espera si no hay lectura', () => {
  const pt = { name: 'P3', lat: 4.601, lon: -74.08 };
  let n = Mapa.navInfo({ lat: 4.6, lon: -74.08 }, pt);
  assert.equal(n.text, 'P3: a 111 m, hacia el norte');
  assert.equal(n.arrived, false);
  assert.ok(Math.abs(n.bearing) < 1e-6);
  assert.ok(Math.abs(n.meters - 111.2) < 0.5);
  n = Mapa.navInfo({ lat: 4.601, lon: -74.079 }, pt, (m) => 'X');
  assert.equal(n.text, 'P3: a X, hacia el oeste');
  assert.ok(Math.abs(n.bearing - 270) < 0.01);
  const m = 1 / 111195;
  n = Mapa.navInfo({ lat: 4.601 - 4.9 * m, lon: -74.08 }, pt);
  assert.deepEqual([n.text, n.arrived, n.bearing], ['Llegaste a P3 (a 5 m).', true, null]);
  assert.equal(Mapa.navInfo({ lat: 4.601 - 5.2 * m, lon: -74.08 }, pt).arrived, false);
  assert.equal(Mapa.navInfo({ lat: 4.601 - 3 * m, lon: -74.08 }, pt, (x) => x.toFixed(2) + ' m').text, 'Llegaste a P3 (a 3 m).');   // al llegar, metros enteros aunque la app use decimales
  assert.equal(Mapa.ARRIVE_M, 5);
  n = Mapa.navInfo(null, pt);
  assert.deepEqual(n, { text: 'P3: esperando la posición del GPS…', arrived: false, bearing: null, meters: null });
  assert.equal(Mapa.navInfo({ lat: 4.6, lon: -74.08 }, { lat: 4.601, lon: -74.08 }).text, 'el punto: a 111 m, hacia el norte');
  assert.equal(Mapa.navInfo({ lat: 4.6, lon: -74.08 }, null), null);
  assert.equal(Mapa.navInfo({ lat: 4.6, lon: -74.08 }, { name: 'x', lat: 'no', lon: 1 }), null);
});

test('sidePlacement: el rótulo va en su sitio, al otro costado si pisa un nombre, u oculto si en los dos pisa', () => {
  let miradas = 0;
  assert.equal(Mapa.sidePlacement(false, () => { miradas++; return true; }), 'base');
  assert.equal(miradas, 0, 'si en su sitio no pisa, no se prueba el otro costado');
  assert.equal(Mapa.sidePlacement(true, () => { miradas++; return false; }), 'alt');
  assert.equal(Mapa.sidePlacement(true, () => { miradas++; return true; }), 'off');
  assert.equal(miradas, 2);
});

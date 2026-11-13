'use strict';
/* 2.20.0 — croquis enfocado en el polígono del que habla cada reporte (los demás, tenues), croquis general sin puntos
 * resaltados y orden de jerarquía (cada finca seguida de sus áreas). */
const test = require('node:test');
const assert = require('node:assert');
const Predio = require('../www/js/predio.js');
const Diagram = require('../www/js/diagram.js');
const Mapa = require('../www/js/mapa.js');
const Satelite = require('../www/js/satelite.js');
const Report = require('../www/js/report.js');

const sq = (lat, lon, d, pre) => [[0, 0], [0, d], [d, d], [d, 0]].map((q, i) => ({ name: (pre || 'P') + (i + 1), lat: lat + q[0], lon: lon + q[1] }));
const OWN = sq(4.6, -74.08, 0.001);                       // un lote de unos 110 m de lado
const FAR = { id: 'lote-b', lot: true, name: 'Vecino', kind: 'polygon', color: '#8D6E63', visible: true, points: sq(4.62, -74.05, 0.002, 'V') };   // otro, a más de 3 km
const IMP = { id: 'capa', name: 'Importada', kind: 'polygon', color: '#2980B9', visible: true, points: sq(4.6005, -74.0795, 0.0002, 'I') };
// ancho (en unidades del dibujo) que ocupa la figura principal: la que lleva el trazo de 2.4
function mainWidth(svg) {
  const d = /<path d="([^"]+) Z" fill="[^"]+" stroke="[^"]+" stroke-width="2\.4"/.exec(svg)[1];
  const xs = d.split(/[ML]/).filter(Boolean).map((t) => parseFloat(t.trim().split(' ')[0]));
  return Math.max(...xs) - Math.min(...xs);
}

test('Predio.ordered: cada finca seguida de sus áreas; al final lo que no tiene finca, en su orden', () => {
  const lots = [
    { id: 'a1', name: 'Cafetal', kind: 'area', parent: 'f2' }, { id: 'l1', name: 'Lote viejo' }, { id: 'f1', name: 'La Uno', kind: 'finca' },
    { id: 'a2', name: 'Potrero', kind: 'area', parent: 'f1' }, { id: 'f2', name: 'La Dos', kind: 'finca' }, { id: 'a3', name: 'Suelta', kind: 'area' },
    { id: 'a4', name: 'Bosque', kind: 'area', parent: 'f1' }, { id: 'a5', name: 'Huérfana', kind: 'area', parent: 'no-existe' }
  ];
  assert.deepEqual(Predio.ordered(lots).map((l) => l.id), ['f1', 'a2', 'a4', 'f2', 'a1', 'l1', 'a3', 'a5']);
  assert.equal(Predio.ordered(lots).length, lots.length, 'no se pierde ni se repite ninguno');
  assert.deepEqual(Predio.ordered([{ id: 'x' }, null, { id: 'y' }]).map((l) => l.id), ['x', 'y']);
  assert.deepEqual(Predio.ordered(null), []);
});

test('Croquis: con «focus» el dibujo se ajusta al polígono propio y los demás del proyecto quedan tenues', () => {
  const plain = Diagram.polygonSVG(OWN, { width: 560, height: 380, layers: [FAR] });
  const foc = Diagram.polygonSVG(OWN, { width: 560, height: 380, layers: [FAR], focus: true });
  assert.ok(mainWidth(plain) < 40, 'sin enfoque el lote queda diminuto: ' + mainWidth(plain));
  assert.ok(mainWidth(foc) > 205, 'con enfoque ocupa buena parte del dibujo: ' + mainWidth(foc));
  assert.ok(mainWidth(foc) < 245, 'y deja un margen para ver a los vecinos: ' + mainWidth(foc));
  assert.equal((foc.match(/class="ctx"/g) || []).length, 1);
  assert.match(foc, /class="ctx"[^>]*stroke-opacity="0\.45" stroke-width="1\.3"/);
  assert.doesNotMatch(plain, /class="ctx"/);
  assert.equal((foc.match(/>P\d<\/text>/g) || []).length, 4, 'los puntos del propio siguen con su nombre');
  assert.doesNotMatch(foc, />V1</, 'los del vecino no llevan puntos');
});

test('Croquis: el enfoque no cambia nada si no hay otros polígonos del proyecto, y las capas importadas sí cuentan', () => {
  const o = { width: 560, height: 380, layers: [IMP] };
  const strip = (s) => s.replace(/dots-[0-9a-f]+-\d+/g, 'dots');
  assert.equal(strip(Diagram.polygonSVG(OWN, Object.assign({ focus: true }, o))), strip(Diagram.polygonSVG(OWN, o)));
  const farImp = Object.assign({}, FAR, { lot: false });
  const withImp = Diagram.polygonSVG(OWN, { width: 560, height: 380, layers: [farImp, FAR], focus: true });
  assert.ok(mainWidth(withImp) < 40, 'una capa importada lejana sí agranda el encuadre');
  assert.equal((withImp.match(/class="ctx"/g) || []).length, 1, 'y solo el otro polígono del proyecto va tenue');
});

test('Croquis: con menos de 2 puntos propios no hay qué enfocar', () => {
  const one = Diagram.polygonSVG(OWN.slice(0, 1), { width: 560, height: 380, layers: [FAR], focus: true });
  assert.doesNotMatch(one, /class="ctx"/);
  const line = Object.assign({}, FAR, { kind: 'line', points: FAR.points.slice(0, 2) }), dots = Object.assign({}, FAR, { kind: 'points', points: FAR.points.slice(0, 1) });
  const s = Diagram.polygonSVG(OWN, { width: 560, height: 380, layers: [line, dots], focus: true });
  assert.equal((s.match(/class="ctx"/g) || []).length, 2, 'líneas y puntos sueltos de otros polígonos también van tenues');
});

test('Mapa.extent: «skipLots» deja fuera los demás polígonos del proyecto', () => {
  const all = Mapa.extent(OWN, [FAR, IMP]), own = Mapa.extent(OWN, [FAR, IMP], true);
  assert.ok(all.north > 4.62 && all.east > -74.05);
  assert.deepEqual(own, { south: 4.6, west: -74.08, north: 4.601, east: -74.079 });
  assert.deepEqual(Mapa.extent([], [FAR], true), null);
});

test('Croquis satelital: con «focus» la imagen se acerca al polígono propio y los vecinos se dibujan tenues', () => {
  const plain = Satelite.plan(OWN, [FAR], { kind: 'satelite' }), foc = Satelite.plan(OWN, [FAR], { kind: 'satelite', focus: true });
  assert.equal(plain.focus, false); assert.equal(foc.focus, true);
  assert.ok(foc.z >= plain.z + 3, 'zoom ' + plain.z + ' → ' + foc.z);
  const c = foc.project(4.6005, -74.0795);
  assert.ok(Math.abs(c.x - foc.width / 2) < 2 && Math.abs(c.y - foc.height / 2) < 2, 'centrado en el polígono propio');
  const near = Object.assign({}, FAR, { points: sq(4.6002, -74.0798, 0.0003, 'V') });
  const ov = Satelite.overlay(foc, { points: OWN, layers: [near, IMP] });
  assert.equal((ov.match(/class="ctx"/g) || []).length, 1);
  assert.match(ov, /class="ctx"[^>]*fill-opacity="0\.08"/);
  assert.equal((ov.match(/fill-opacity="0\.22"/g) || []).length, 1, 'la capa importada se dibuja como siempre');
  assert.doesNotMatch(Satelite.overlay(plain, { points: OWN, layers: [near] }), /class="ctx"/);
  // con un solo punto propio no se enfoca: se ve todo
  assert.equal(Satelite.plan(OWN.slice(0, 1), [FAR], { focus: true }).focus, false);
  const l2 = Object.assign({}, near, { kind: 'line', points: near.points.slice(0, 2) }), p1 = Object.assign({}, near, { kind: 'points', points: near.points.slice(0, 1) });
  assert.equal((Satelite.overlay(foc, { points: OWN, layers: [l2, p1] }).match(/class="ctx"/g) || []).length, 2);
});

test('Croquis general: las fincas van debajo y ningún polígono lleva sus puntos resaltados', () => {
  const part = (name, pts, color, kind) => ({ project: { name: 'P', lotName: name, points: pts, mainColor: color, lotMeta: { kind: kind || '' }, dots: kind === 'area' }, a: {}, o: {} });
  const ov = Report.overview([part('Cafetal', sq(4.6002, -74.0798, 0.0003), '#8D6E63', 'area'), part('La Finca', OWN, '#2F8F4E', 'finca'), part('Lote', sq(4.61, -74.07, 0.001), '#C0392B')]);
  assert.deepEqual(ov.items, [['#2F8F4E', 'La Finca'], ['#8D6E63', 'Cafetal'], ['#C0392B', 'Lote']]);
  assert.doesNotMatch(ov.svg, />P1</);
  assert.equal((ov.svg.match(/<circle /g) || []).filter((c) => !/pattern/.test(c)).length, 2, 'solo los círculos de la trama de puntos');
  assert.ok(ov.svg.indexOf('#2F8F4E') < ov.svg.lastIndexOf('#C0392B'));
  assert.equal((ov.svg.match(/stroke-width="2\.2"/g) || []).length, 3);
});

test('Reporte de un polígono: su croquis va enfocado', () => {
  const html = Report.html({ name: 'P', lotName: 'Uno', points: OWN, layers: [FAR], mainColor: '#2F8F4E' }, { n: 4, points: OWN, warnings: [], center: { lat: 4.6005, lon: -74.0795 } }, {});
  assert.match(html, /<h2>Croquis<\/h2>/);
  assert.equal((html.match(/class="ctx"/g) || []).length, 1);
});

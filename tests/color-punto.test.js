'use strict';
/* Color propio de cada punto (el que se elige en su ficha): tiene que verse en todos los sitios donde el punto se dibuja o se lista.
 * Un punto sin color propio usa el de los puntos del proyecto (o, en el croquis satelital, el naranja de siempre). */
const test = require('node:test');
const assert = require('node:assert/strict');
const Satelite = require('../www/js/satelite.js');
const Perfil = require('../www/js/perfil.js');
const Report = require('../www/js/report.js');
const Gis = require('../www/js/gis.js');
const Diagram = require('../www/js/diagram.js');
const Mapa = require('../www/js/mapa.js');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');

const PUNTOS = [
  { id: 'a', name: 'P1', lat: 4.6000, lon: -74.0800, alt: 1800, color: '#C0392B' },
  { id: 'b', name: 'P2', lat: 4.6000, lon: -74.0770, alt: 1850 },
  { id: 'c', name: 'P3', lat: 4.6030, lon: -74.0770, alt: 1900, color: '#2980B9' },
  { id: 'd', name: 'P4', lat: 4.6030, lon: -74.0800, alt: 1950, color: 'rojo' }
];

/* ---------- croquis satelital y topográfico ---------- */
test('satelital/topográfico: cada punto con color propio se pinta con él; los demás, con el naranja de siempre', () => {
  const s = Satelite.overlay(Satelite.plan(PUNTOS, []), { points: PUNTOS });
  assert.equal((s.match(/r="6\.5" fill="#C0392B"/g) || []).length, 1);
  assert.equal((s.match(/r="6\.5" fill="#2980B9"/g) || []).length, 1);
  assert.equal((s.match(/r="6\.5" fill="#F57C00"/g) || []).length, 2, 'P2 sin color y P4 con un color que no sirve');
  const t = Satelite.overlay(Satelite.plan(PUNTOS, [], { kind: 'topo' }), { points: PUNTOS });
  assert.equal((t.match(/r="6\.5" fill="#C0392B"/g) || []).length, 1);
});

test('satelital: la huella cambia cuando cambia el color de un punto (el croquis ya preparado deja de servir), no con un color inválido', () => {
  const base = { id: 'p', points: PUNTOS.map((p) => Object.assign({}, p)), layers: [] };
  const sig = Satelite.signature(base);
  const otro = JSON.parse(JSON.stringify(base)); otro.points[1].color = '#16A085';
  assert.notEqual(Satelite.signature(otro), sig);
  const cambiado = JSON.parse(JSON.stringify(base)); cambiado.points[0].color = '#000000';
  assert.notEqual(Satelite.signature(cambiado), sig);
  const quitado = JSON.parse(JSON.stringify(base)); delete quitado.points[0].color;
  assert.notEqual(Satelite.signature(quitado), sig);
  const basura = JSON.parse(JSON.stringify(base)); basura.points[3].color = 'verde';          // ya era inválido: se dibuja igual
  assert.equal(Satelite.signature(basura), sig);
});

/* ---------- perfil ---------- */
test('perfil: el círculo de cada punto lleva su color propio y la línea sigue con el del proyecto', () => {
  const m = Perfil.build(PUNTOS);
  assert.deepEqual(m.items.map((i) => i.color), ['#C0392B', null, '#2980B9', null]);
  const s = Perfil.svg(m, { color: '#8E44AD', id: 'x' });
  assert.equal((s.match(/r="4\.6" fill="#fff" stroke="#C0392B"/g) || []).length, 1);
  assert.equal((s.match(/r="4\.6" fill="#fff" stroke="#2980B9"/g) || []).length, 1);
  assert.equal((s.match(/r="4\.6" fill="#fff" stroke="#8E44AD"/g) || []).length, 2);
  assert.match(s, /fill="none" stroke="#8E44AD" stroke-width="2\.6"/, 'la línea del perfil conserva el color del proyecto');
});

/* ---------- reporte ---------- */
function reporte(over) {
  const project = Object.assign({ name: 'Finca', points: PUNTOS, climate: { pManual: 1100 }, layers: [], mainColor: '#2F8F4E' }, over || {});
  const a = A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() });
  return Report.html(project, a, { date: Date.UTC(2026, 10, 1, 12) });
}

test('reporte: la tabla de puntos pone delante de cada nombre un punto con su color (el propio o el del proyecto)', () => {
  const h = reporte();
  const tabla = h.slice(h.indexOf('<h2>Puntos</h2>'), h.indexOf('</table>', h.indexOf('<h2>Puntos</h2>')));
  assert.match(tabla, /<th><span class="dot" style="background:#C0392B"><\/span>P1<\/th>/);
  assert.match(tabla, /<th><span class="dot" style="background:#2F8F4E"><\/span>P2<\/th>/);
  assert.match(tabla, /<th><span class="dot" style="background:#2980B9"><\/span>P3<\/th>/);
  assert.match(tabla, /<th><span class="dot" style="background:#2F8F4E"><\/span>P4<\/th>/, 'un color inválido usa el del proyecto');
  assert.match(h, /\.dot\{[^}]*print-color-adjust:exact/, 'el color también sale al imprimir');
});

test('reporte: sin color del proyecto, o con uno roto, el punto sin color propio sale en el verde de siempre; y el nombre no se mete como código', () => {
  const raros = [{ name: '<i>x</i>', lat: 4.6, lon: -74.1 }, { name: 'Y', lat: 4.7, lon: -74.1 }, { name: 'Z', lat: 4.7, lon: -74.2 }];
  const h = reporte({ points: raros, mainColor: 'azul' });
  assert.equal((h.match(/<span class="dot" style="background:#2F8F4E"><\/span>/g) || []).length, 3);
  assert.match(h, /<\/span>&lt;i&gt;x&lt;\/i&gt;<\/th>/);
  assert.equal(Report.dot({ color: '#112233' }, {}), '<span class="dot" style="background:#112233"></span>');
  assert.equal(Report.dot({}, {}), '<span class="dot" style="background:#2F8F4E"></span>');
});

test('reporte: el Croquis y el perfil del reporte llevan el color propio de los puntos', () => {
  const h = reporte();
  assert.match(h, /r="4\.6" fill="#fff" stroke="#C0392B"/, 'perfil');
  assert.match(h, /r="5" fill="#C0392B" stroke="#C0392B"/, 'croquis: el primer punto va relleno');
  assert.match(h, /r="5" fill="#fff" stroke="#2980B9"/, 'croquis: los demás, con aro');
});

/* ---------- Croquis (la pestaña Polígono) ---------- */
test('croquis: el punto con color propio se dibuja con él, el resto con el del proyecto', () => {
  const s = Diagram.polygonSVG(PUNTOS, { color: '#2F8F4E' });
  assert.match(s, /#C0392B/);
  assert.match(s, /#2980B9/);
});

/* ---------- mapa ---------- */
test('mapa: shapes da a cada punto su color propio o el del proyecto', () => {
  const sh = Mapa.shapes({ mainColor: '#2F8F4E', points: PUNTOS, layers: [] }, {});
  assert.deepEqual(sh.points.map((p) => p.color), ['#C0392B', '#2F8F4E', '#2980B9', '#2F8F4E']);
});

/* ---------- KML y GeoJSON ---------- */
const MODELO = { name: 'Finca', points: PUNTOS, layers: [], mainColor: '#2F8F4E', date: Date.UTC(2026, 10, 1) };

test('KML: cada color propio distinto tiene su estilo y su vértice lo usa; los demás usan el principal', () => {
  const kml = Gis.toKML(MODELO);
  assert.match(kml, /<Style id="puntoC0392B"><IconStyle><color>ff2B39C0<\/color>/, 'rojo #C0392B → ff2B39C0');
  assert.match(kml, /<Style id="punto2980B9"><IconStyle><color>ffB98029<\/color>/, 'azul #2980B9 → ffB98029');
  const vert = (n) => kml.match(new RegExp('<Placemark><name>' + n + '</name>(?:<description>[^<]*</description>)?<styleUrl>#([^<]+)</styleUrl><Point>'))[1];
  assert.equal(vert('P1'), 'puntoC0392B');
  assert.equal(vert('P2'), 'principal');
  assert.equal(vert('P3'), 'punto2980B9');
  assert.equal(vert('P4'), 'principal', 'color inválido: el del proyecto');
  assert.equal((kml.match(/<Style id="punto/g) || []).length, 2, 'un estilo por color distinto');
  assert.match(kml, /<Placemark><name>Finca<\/name><styleUrl>#principal<\/styleUrl><Polygon>/, 'el polígono sigue con el color del proyecto');
});

test('KML: dos puntos con el mismo color comparten estilo; si el color propio es igual al del proyecto no hace falta uno nuevo; sigue siendo un KML que se puede leer', () => {
  const pts = [
    { name: 'A', lat: 5, lon: -75, color: '#c0392b' }, { name: 'B', lat: 5, lon: -74.9, color: '#C0392B' },
    { name: 'C', lat: 5.1, lon: -74.9, color: '#2f8f4e' }
  ];
  const kml = Gis.toKML({ name: 'x', points: pts, mainColor: '#2F8F4E' });
  assert.equal((kml.match(/<Style id="punto/g) || []).length, 1);
  assert.match(kml, /<name>C<\/name><styleUrl>#principal<\/styleUrl>/);
  assert.equal(Gis.parseText(kml).features.length > 0, true);
  assert.equal(Gis.parseText(Gis.toKML(MODELO)).features.filter((f) => f.type === 'point').length, 4);
});

test('GeoJSON: cada vértice trae su color propio o, si no lo tiene, el del proyecto', () => {
  const gj = JSON.parse(Gis.toGeoJSON(MODELO));
  const color = (n) => gj.features.find((f) => f.properties.tipo === 'vertice' && f.properties.name === n).properties.color;
  assert.equal(color('P1'), '#C0392B');
  assert.equal(color('P2'), '#2F8F4E');
  assert.equal(color('P3'), '#2980B9');
  assert.equal(color('P4'), '#2F8F4E');
  assert.equal(gj.features.find((f) => f.properties.tipo === 'poligono').properties.color, '#2F8F4E');
});

test('GPX y CSV no llevan color (no existe en esos formatos) y siguen igual', () => {
  assert.doesNotMatch(Gis.toGPX(MODELO), /C0392B|color/i);
  assert.doesNotMatch(Gis.toCSV(PUNTOS), /C0392B|color/i);
});

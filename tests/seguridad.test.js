'use strict';
/* Auditoría de seguridad (2.33.0): lo que escribe la persona o trae un archivo importado (nombres, notas, capas, autor)
   nunca se convierte en código. Cada texto lleva una «carga» de prueba que, si no se escapara, crearía una etiqueta o un
   atributo nuevo. Las pantallas se prueban en el navegador (recorrido 34); aquí, los archivos que la app genera. */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const Report = require('../www/js/report.js');
const Diagram = require('../www/js/diagram.js');
const Gis = require('../www/js/gis.js');

const X = '<img src=x onerror=alert(1)>';                // etiqueta nueva
const Q = '"><svg onload=alert(2)>';                      // salir de un atributo con comillas dobles
const S = "'><script>alert(3)</script>";                  // comillas simples y <script>
const ALL = [X, Q, S];
// Ninguna de las cargas puede aparecer tal cual: eso significaría que el navegador la leería como HTML
function sinCargas(txt, donde) {
  for (const c of ALL) assert.ok(!txt.includes(c), donde + ': la carga «' + c + '» aparece sin escapar');
  assert.doesNotMatch(txt, /<img src=x|<svg onload|<script>alert/, donde);
}
const PUNTOS = [
  { name: X, note: Q, lat: 4.60, lon: -74.10, alt: 1800 }, { name: Q, lat: 4.60, lon: -74.09, alt: 2400 },
  { name: S, lat: 4.61, lon: -74.09, alt: 3000 }, { name: 'P4', lat: 4.61, lon: -74.10, alt: 2500 }
];

function build() {
  const project = { name: X + Q, lotName: S, lotMeta: { kind: 'area', cat: Q }, points: PUNTOS, climate: { pManual: 1100, tManual: 14 },
    layers: [{ id: 'c1', name: X, kind: 'polygon', color: '#E53935', visible: true, file: Q + '.kml', points: PUNTOS.slice(0, 3) }], mainColor: '#2F8F4E' };
  const a = A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() });
  return { project, a };
}
const O = { author: { name: X, org: Q }, date: Date.UTC(2026, 10, 25, 15),
  usos: { rows: [[X, Q], ['Limitantes (mapa del IGAC)', S]], note: X, fuente: Q }, catastro: [['Número predial', X]] };

test('reporte HTML: nombres, notas, capas, autor y filas con código salen como texto', () => {
  const { project, a } = build();
  const h = Report.html(project, a, O);
  sinCargas(h, 'Report.html');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'el nombre se ve como texto');
  assert.ok(h.includes('&quot;&gt;&lt;svg onload=alert(2)&gt;'));
  const all = Report.htmlAll({ name: X }, [{ project, a, o: O }, { project: Object.assign({}, project, { lotName: Q }), a, o: O }], O);
  sinCargas(all, 'Report.htmlAll');
});

test('reporte HTML: lleva una política de seguridad que no deja correr scripts ni cargar nada de afuera', () => {
  const { project, a } = build();
  for (const h of [Report.html(project, a, O), Report.htmlAll({ name: 'P' }, [{ project, a, o: O }], O)]) {
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(h);
    assert.ok(m, 'tiene CSP');
    assert.ok(h.indexOf(m[0]) < h.indexOf('<title>'), 'la CSP va antes de cualquier contenido');
    assert.equal(m[1], Report.REPORT_CSP);
    assert.match(m[1], /default-src 'none'/);          // sin scripts (ni en línea ni de afuera), sin conexiones, sin marcos
    assert.match(m[1], /img-src data:/);               // solo las imágenes que van dentro del archivo
    assert.doesNotMatch(m[1], /script-src|unsafe-eval|https?:/);
    assert.doesNotMatch(h, /<script/i, 'el reporte no trae scripts propios');
  }
});

test('reporte en texto: no es HTML, pero tampoco pierde el nombre', () => {
  const { project, a } = build();
  assert.ok(Report.text(project, a, O).includes(X));
});

test('croquis (SVG): nombres y colores no rompen atributos', () => {
  const svg = Diagram.polygonSVG(PUNTOS, { width: 400, height: 300, color: '#2F8F4E', showNames: true,
    layers: [{ name: Q, kind: 'polygon', color: '#E53935" onload="alert(4)', visible: true, points: PUNTOS.slice(0, 3) }] });
  sinCargas(svg, 'Diagram.polygonSVG');
  assert.doesNotMatch(svg, /" onload="alert\(4\)/, 'un color con comillas no abre un atributo nuevo');
  sinCargas(Diagram.legendHTML([['#E53935', X], ['#2F8F4E', Q]]), 'Diagram.legendHTML');
});

test('archivos exportados (KML, GPX, GeoJSON): los nombres van escapados o como dato', () => {
  const model = { name: X, points: PUNTOS, mainColor: '#2F8F4E', layers: [{ name: Q, kind: 'polygon', color: '#E53935', points: PUNTOS.slice(0, 3) }] };
  const kml = Gis.toKML(model), gpx = Gis.toGPX(model);
  sinCargas(kml, 'KML'); sinCargas(gpx, 'GPX');
  assert.ok(kml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  // y se leen de vuelta igual: lo escapado es el mismo texto
  const back = Gis.parseText(kml, 'x.kml');
  assert.ok(back.features.some((f) => f.name === X), 'el nombre vuelve idéntico al importar');
  const gj = JSON.parse(Gis.toGeoJSON(model));
  assert.equal(gj.features.find((f) => f.geometry.type === 'Point').properties.name, X, 'en GeoJSON el nombre es un dato, no HTML');
});

test('CSV: un nombre que empieza como fórmula no se ejecuta en Excel', () => {
  const csv = Gis.toCSV([{ name: '=HYPERLINK("http://x","clic")', lat: 4.6, lon: -74.1 }, { name: '+1+1', lat: 4.61, lon: -74.1 }, { name: '@SUM(A1)', lat: 4.61, lon: -74.09 }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"",""clic"")"'));
  assert.ok(csv.includes("'+1+1")); assert.ok(csv.includes("'@SUM(A1)"));
});

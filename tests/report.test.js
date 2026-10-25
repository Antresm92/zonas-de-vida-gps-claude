'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const Report = require('../www/js/report.js');
const WL = require('../www/js/walter-lieth.js');

const DATE = Date.UTC(2026, 5, 15, 12);
const PUNTOS = [
  { name: 'P1', lat: 4.60, lon: -74.10, alt: 1800 }, { name: 'P2', lat: 4.60, lon: -74.09, alt: 2400 },
  { name: 'P3', lat: 4.61, lon: -74.09, alt: 3000 }, { name: 'P4', lat: 4.61, lon: -74.10, alt: 2500 }
];
const T = [13, 13.5, 14, 14.2, 14.3, 13.8, 13.2, 13.4, 13.9, 14, 14, 13.5];
const P = [40, 60, 100, 150, 120, 60, 40, 45, 90, 160, 140, 70];

function build(over) {
  const project = Object.assign({ name: 'Finca La Esperanza', points: PUNTOS, climate: { pManual: 1100 }, layers: [], mainColor: '#2F8F4E' }, over || {});
  const a = A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() });
  return { project, a };
}
function walter() {
  const d = WL.compute(T, P);
  return { svg: WL.svg(d, { id: 'wlx' }), lines: WL.summary(d), source: 'Datos de NASA POWER.' };
}

test('rows: datos clave con su origen', () => {
  const { project, a } = build();
  const rows = Report.rows(project, a);
  const labels = rows.map((r) => r[0]);
  assert.deepEqual(labels, ['Altitud', 'Temperatura media anual', 'Biotemperatura', 'Precipitación anual', 'Evapotranspiración potencial', 'Relación ETP / precipitación']);
  assert.match(rows[0][1], /^2425 m \(.*4 puntos\)$/);
  assert.match(rows[1][1], /estimada con latitud y altitud/);
  assert.match(rows[3][1], /^1100 mm \(ingresada por el usuario\)$/);
});

test('rows: sin altitud ni clima no inventa filas', () => {
  const { project, a } = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }], climate: {} });
  assert.deepEqual(Report.rows(project, a), []);
});

test('text: informe completo con zona, datos, áreas, alternativas, zonas por punto y capas', () => {
  const layers = [{ id: 'l1', name: 'Lote vecino', kind: 'polygon', color: '#E67E22', visible: true, points: [{ lat: 4.62, lon: -74.1 }, { lat: 4.62, lon: -74.09 }, { lat: 4.63, lon: -74.09 }], file: 'vecino.kml' },
    { id: 'l2', name: 'Pozo', kind: 'points', color: '#8E44AD', visible: true, points: [{ lat: 4.6, lon: -74.1 }] }];
  const { project, a } = build({ layers });
  const t = Report.text(project, a, { date: DATE, walter: walter() });
  assert.match(t, /^INFORME DE ZONA DE VIDA \(HOLDRIDGE\)\nFinca La Esperanza · 15 de junio de 2026/);
  assert.match(t, /Zona de vida: Bosque húmedo montano bajo \(bh-MB\)/);
  assert.match(t, /Región latitudinal: /); assert.match(t, /Piso altitudinal: /); assert.match(t, /Provincia de humedad: /);
  assert.match(t, /Precipitación anual: 1100 mm/);
  assert.match(t, /Área: .* ha = .* m² = .* fanegadas/);
  assert.match(t, /Perímetro: /); assert.match(t, /Centro: 4\.6/);
  assert.match(t, /también podría ser: .*\(bh-PM\)/);
  assert.match(t, /Por altitud de cada punto:\n {2}P1 \(1800 m\): .*\(bh-PM\)/);
  assert.match(t, /Diagrama de Walter-Lieth \(datos mensuales\):\n {2}Temperatura media 13,7 °C/);
  assert.match(t, /P1: 4\.60000, -74\.10000, 1800 m/);
  assert.match(t, /Capas importadas \(no cuentan para el área ni la zona de vida\):\n {2}Lote vecino: 3 puntos \(vecino\.kml\)\n {2}Pozo: 1 punto\n/);
  assert.match(t, /Calidad de los datos: Orientativa/);
  assert.match(t, /Aviso: Los puntos van de 1800 a 3000 m/);
  assert.ok(t.endsWith(Report.DISCLAIMER));
});

test('text: sin precipitación el resultado queda incompleto y lo dice', () => {
  const { project, a } = build({ climate: {} });
  const t = Report.text(project, a, { date: DATE });
  assert.match(t, /Resultado incompleto: falta la precipitación anual\./);
  assert.match(t, /Región latitudinal: .* · Piso altitudinal: /);
  assert.doesNotMatch(t, /Zona de vida:/);
  assert.doesNotMatch(t, /Walter/);
});

test('text: sin altitud ni temperatura no hay zona y la fecha por defecto es hoy', () => {
  const { project, a } = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }, { name: 'P2', lat: 4.7, lon: -74.1 }], climate: {} });
  const t = Report.text(project, a);
  assert.match(t, /Resultado incompleto: falta la altitud o la temperatura\./);
  assert.match(t, /P2: 4\.70000, -74\.10000\n/);                       // sin altitud no agrega « m»
  assert.doesNotMatch(t, /Área:/);
  assert.match(t, /\d{4}/);                                            // lleva alguna fecha
});

test('text: un solo punto no habla de perímetro y respeta nombres vacíos', () => {
  const { project, a } = build({ points: [{ lat: 4.6, lon: -74.1, alt: 2000 }], climate: { pManual: 900 } });
  const t = Report.text(project, a, { date: DATE });
  assert.doesNotMatch(t, /Perímetro/);
  assert.match(t, /P1: 4\.60000, -74\.10000, 2000 m/);
});

test('html: página completa con zona, tablas, diagramas y capas', () => {
  const layers = [{ id: 'l1', name: 'Lote <vecino>', kind: 'polygon', color: '#E67E22', visible: true, points: [{ lat: 4.62, lon: -74.1 }, { lat: 4.62, lon: -74.09 }, { lat: 4.63, lon: -74.09 }] }];
  const { project, a } = build({ name: 'Finca <script>alert(1)</script> & Cía', layers });
  const h = Report.html(project, a, { date: DATE, walter: walter() });
  assert.match(h, /^<!doctype html><html lang="es">/);
  assert.doesNotMatch(h, /<script>alert/);                              // el nombre se escapa
  assert.match(h, /Finca &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Cía/);
  assert.match(h, /Lote &lt;vecino&gt;/);
  assert.match(h, /<title>Informe de zona de vida · /);
  assert.match(h, /class="zn">Bosque húmedo montano bajo</);
  assert.match(h, />bh-MB</);                                           // símbolo en el hexágono
  assert.match(h, /<h2>Datos del clima<\/h2><table>.*Precipitación anual/s);
  assert.match(h, /<h2>Terreno<\/h2>/); assert.match(h, /<h2>Puntos<\/h2>/);
  assert.match(h, /el punto también podría caer en: .*bh-PM/);
  assert.match(h, /<h2>Zonas según la altitud de cada punto<\/h2>/);
  assert.match(h, /<h2>Calidad de los datos<\/h2><p>Orientativa/);
  assert.match(h, /<h2>Diagrama de Walter-Lieth<\/h2>.*<svg.*id|wlx-dry/s);
  assert.match(h, /Datos de NASA POWER\./);
  assert.match(h, /<h2 class="diag">Diagrama de Holdridge<\/h2><svg/);
  assert.match(h, /class="legend"/);                                    // leyenda de colores de las capas
  assert.ok(h.includes(Report.DISCLAIMER));
  assert.ok(h.endsWith('</body></html>'));
});

test('html: sin precipitación o sin altitud avisa que el resultado está incompleto', () => {
  let { project, a } = build({ climate: {} });
  let h = Report.html(project, a, { date: DATE });
  assert.match(h, /<div class="note">Resultado incompleto: falta la precipitación anual\.<\/div>/);
  assert.doesNotMatch(h, /Diagrama de Holdridge/);
  assert.doesNotMatch(h, /Walter/);
  ({ project, a } = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }], climate: {} }));
  h = Report.html(project, a);
  assert.match(h, /falta la altitud o la temperatura\./);
  assert.doesNotMatch(h, /<h2>Terreno<\/h2><table><tr><th>Área/);        // un punto no tiene área
});

test('html: zona única sin alternativas ni zonas por punto, y avisos propios', () => {
  const { project, a } = build({ points: [{ name: 'A', lat: 4.6, lon: -74.1, alt: 2640 }, { name: 'B', lat: 4.601, lon: -74.1, alt: 2650 }, { name: 'C', lat: 4.601, lon: -74.099, alt: 2660 }],
    climate: { tManual: 14, pManual: 1000 } });
  const h = Report.html(project, a, { date: DATE });
  assert.doesNotMatch(h, /Zonas según la altitud/);
  assert.match(h, /Con el margen de error de los datos|también podría caer en/);
  assert.match(h, /Con datos ingresados por el usuario/);
});

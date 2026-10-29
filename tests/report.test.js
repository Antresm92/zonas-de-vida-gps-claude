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

/* ---------- Perfil del relieve y croquis satelital en el informe ---------- */
test('html: el perfil del relieve va justo después del croquis, con tabla y avisos del GPS', () => {
  const pts = PUNTOS.map((p) => Object.assign({}, p, { altSrc: 'gps' }));
  const { project, a } = build({ points: pts });
  const h = Report.html(project, a, { date: DATE });
  const iCroquis = h.indexOf('aria-label="Plano del polígono"');
  const iPerfil = h.indexOf('<h2>Perfil del relieve</h2>');
  const iZonas = h.indexOf('<h2>Zonas según la altitud de cada punto</h2>');
  assert.ok(iCroquis > 0 && iPerfil > iCroquis && iZonas > iPerfil, 'orden: croquis, perfil, zonas');
  assert.match(h, /aria-label="Perfil del relieve: altitud de los puntos contra la distancia acumulada"/);
  assert.match(h, /<th>Punto más alto<\/th><td>P3 · 3000 m<\/td>/);
  assert.match(h, /<th>Punto más bajo<\/th><td>P1 · 1800 m<\/td>/);
  assert.match(h, /<th>Desnivel entre ambos<\/th><td>1200 m<\/td>/);
  assert.match(h, /4 altitudes fueron tomadas con el GPS del teléfono/);
  assert.match(h, /no se consultó internet/);
  assert.match(h, /id="perfil-informe-fill"/);
});

test('html: el perfil usa el color del proyecto y no mete nombres como código', () => {
  const pts = [{ name: '<b>x</b>', lat: 4.6, lon: -74.1, alt: 100 }, { name: 'Y', lat: 4.7, lon: -74.1, alt: 300 }];
  const { project, a } = build({ points: pts, mainColor: '#8E44AD' });
  const h = Report.html(project, a, { date: DATE });
  assert.match(h, /stroke="#8E44AD" stroke-width="2.6"/);
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt; · 100 m/);
});

test('html: con puntos pero sin altitudes el perfil explica qué falta en vez de desaparecer', () => {
  const { project, a } = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }, { name: 'P2', lat: 4.7, lon: -74.1 }], climate: {} });
  const h = Report.html(project, a, { date: DATE });
  assert.match(h, /<h2>Perfil del relieve<\/h2><div class="note">Se necesitan al menos 2 puntos con altitud/);
});

test('html: un solo punto no trae croquis, ni perfil, ni croquis satelital', () => {
  const { project, a } = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 2000 }], climate: { pManual: 900 } });
  const h = Report.html(project, a, { date: DATE, satellite: { svg: '<svg></svg>', caption: 'x' } });
  assert.doesNotMatch(h, /Perfil del relieve|Croquis satelital/);
});

test('html: croquis satelital entre el croquis y el perfil, con su atribución', () => {
  const { project, a } = build();
  const sat = { svg: '<svg id="sat-demo"></svg>', caption: 'Imagen satelital: Esri <y> Maxar.' };
  const h = Report.html(project, a, { date: DATE, satellite: sat });
  const iCroquis = h.indexOf('aria-label="Plano del polígono"');
  const iSat = h.indexOf('<h2>Croquis satelital</h2>');
  const iPerfil = h.indexOf('<h2>Perfil del relieve</h2>');
  assert.ok(iCroquis > 0 && iSat > iCroquis && iPerfil > iSat, 'orden: croquis, satelital, perfil');
  assert.match(h, /<svg id="sat-demo"><\/svg><\/div><p class="small">Imagen satelital: Esri &lt;y&gt; Maxar\.<\/p>/);
});

test('html: si el croquis satelital no se pudo preparar, el informe lo dice con el motivo y sigue', () => {
  const { project, a } = build();
  const h1 = Report.html(project, a, { date: DATE, satellite: { unavailable: 'no hay conexión a internet <ahora>' } });
  assert.match(h1, /<h2>Croquis satelital<\/h2><div class="note">No se pudo preparar el croquis satelital: no hay conexión a internet &lt;ahora&gt;<\/div>/);
  assert.match(h1, /<h2>Perfil del relieve<\/h2>/);
  const h2 = Report.html(project, a, { date: DATE, satellite: {} });
  assert.match(h2, /No se pudo preparar el croquis satelital\.<\/div>/);
  const h3 = Report.html(project, a, { date: DATE, satellite: { svg: '<svg></svg>' } });
  assert.match(h3, /<p class="small"><\/p>/);                         // sin pie de imagen no escribe «undefined»
  assert.doesNotMatch(h3, /undefined/);
});

test('html: croquis topográfico justo después del satelital y antes del perfil, con su atribución', () => {
  const { project, a } = build();
  const sat = { svg: '<svg id="sat-demo"></svg>', caption: 'Satelital.' };
  const topo = { svg: '<svg id="topo-demo"></svg>', caption: 'Mapa topográfico de OpenTopoMap <CC-BY-SA>.' };
  const h = Report.html(project, a, { date: DATE, satellite: sat, topo });
  const iCroquis = h.indexOf('aria-label="Plano del polígono"'), iSat = h.indexOf('<h2>Croquis satelital</h2>');
  const iTopo = h.indexOf('<h2>Croquis topográfico</h2>'), iPerfil = h.indexOf('<h2>Perfil del relieve</h2>');
  assert.ok(iCroquis > 0 && iSat > iCroquis && iTopo > iSat && iPerfil > iTopo, 'orden: croquis, satelital, topográfico, perfil');
  assert.match(h, /<svg id="topo-demo"><\/svg><\/div><p class="small">Mapa topográfico de OpenTopoMap &lt;CC-BY-SA&gt;\.<\/p>/);
});

test('html: el croquis topográfico puede aparecer solo, o fallar sin afectar al satelital ni al perfil', () => {
  const { project, a } = build();
  const solo = Report.html(project, a, { date: DATE, topo: { svg: '<svg id="t"></svg>', caption: 'x' } });
  assert.match(solo, /<h2>Croquis topográfico<\/h2>/); assert.doesNotMatch(solo, /Croquis satelital/);
  const mixto = Report.html(project, a, { date: DATE, satellite: { svg: '<svg id="s"></svg>', caption: 'x' }, topo: { unavailable: 'el servicio de imágenes no permite guardarlas dentro del informe' } });
  assert.match(mixto, /<svg id="s"><\/svg>/);
  assert.match(mixto, /<h2>Croquis topográfico<\/h2><div class="note">No se pudo preparar el croquis topográfico: el servicio de imágenes no permite guardarlas dentro del informe<\/div>/);
  assert.match(mixto, /<h2>Perfil del relieve<\/h2>/);
  assert.match(Report.html(project, a, { date: DATE, topo: {} }), /No se pudo preparar el croquis topográfico\.<\/div>/);
  assert.doesNotMatch(Report.html(project, a, { date: DATE, topo: { svg: '<svg></svg>' } }), /undefined/);
});

test('html: un solo punto no trae croquis topográfico, y si no se pidió no aparece la sección', () => {
  const uno = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 2000 }], climate: { pManual: 900 } });
  assert.doesNotMatch(Report.html(uno.project, uno.a, { date: DATE, topo: { svg: '<svg></svg>', caption: 'x' } }), /Croquis topográfico/);
  const { project, a } = build();
  assert.doesNotMatch(Report.html(project, a, { date: DATE }), /Croquis topográfico/);
});

test('html: si no se pidió el croquis satelital, no aparece la sección', () => {
  const { project, a } = build();
  assert.doesNotMatch(Report.html(project, a, { date: DATE }), /Croquis satelital/);
});

test('text: el resumen incluye el desnivel entre puntos solo si hay al menos 2 altitudes', () => {
  const { project, a } = build();
  assert.match(Report.text(project, a, { date: DATE }), /Desnivel entre puntos: 1200 m \(más alto P3, 3000 m; más bajo P1, 1800 m\)/);
  const una = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 2000 }, { name: 'P2', lat: 4.7, lon: -74.1 }] });
  assert.doesNotMatch(Report.text(una.project, una.a, { date: DATE }), /Desnivel/);
});

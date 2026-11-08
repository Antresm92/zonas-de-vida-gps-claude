/* Correcciones de la auditoría interna (v2.7.2): lo que se exporta no puede ejecutarse como fórmula ni dejar un archivo XML inválido.
 *  - CSV: un nombre que empieza por = + - @ (o tabulador o retorno) lo abren Excel y Sheets como fórmula → lleva un apóstrofo delante.
 *  - KML y GPX: XML 1.0 no admite los caracteres de control, ni siquiera escritos como &#1; → se quitan al escribir. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Gis = require('../www/js/gis.js');
const Xml = require('../www/js/xml.js');

const pt = (name, i) => ({ name, lat: 4.6 + (i || 0) * 0.001, lon: -74.1 + (i || 0) * 0.001 });
const filas = (csv) => csv.slice(1).split('\r\n').filter(Boolean).slice(1);          // sin el BOM, sin el encabezado y sin la línea final vacía
const nombre = (fila, sep) => fila.split(sep)[0];

/* ---------- CSV ---------- */

test('CSV: los nombres que empiezan por = + - @ tabulador o retorno llevan un apóstrofo delante (estilos es y std)', () => {
  const casos = ['=HYPERLINK("http://x","clic")', '+1+1', '-5', '@SUM(1)', '=1+1', '\tcmd', '\rcmd'];
  for (const [style, sep] of [['es', ';'], ['std', ',']]) {
    for (const n of casos) {
      const fila = filas(Gis.toCSV([pt(n)], { style }))[0];
      const esperado = /[";,\r\n]/.test("'" + n) ? '"' + ("'" + n).replace(/"/g, '""') + '"' : "'" + n;
      assert.ok(fila.startsWith(esperado + sep), style + ' ' + JSON.stringify(n) + ' → ' + JSON.stringify(fila));
    }
  }
});

test('CSV: el apóstrofo va antes de las comillas de la celda, de modo que el campo sigue siendo una sola celda', () => {
  const [fila] = filas(Gis.toCSV([pt('=A;B, "x"')], { style: 'es' }));
  assert.ok(fila.startsWith(`"'=A;B, ""x""";`), fila);
  assert.equal(fila.split(';').length, 6 + 1, 'el «;» del nombre queda dentro de las comillas');       // seis columnas + el «;» interno del nombre
});

test('CSV: un nombre normal no cambia, ni uno con esos símbolos en medio, ni uno que ya empieza por apóstrofo', () => {
  for (const n of ['Lote 1', 'a=1', 'a+b', 'x-y', 'correo@sitio', "'=ya", '0', '_x', '#1', '%', ' =1']) {
    const fila = filas(Gis.toCSV([pt(n)], { style: 'std' }))[0];
    assert.equal(nombre(fila, ','), n, JSON.stringify(n));
  }
});

test('CSV: las columnas numéricas no se tocan (la longitud negativa no recibe apóstrofo) y sin nombre se usa P1, P2…', () => {
  const csv = Gis.toCSV([{ lat: 4.6, lon: -74.1, alt: -3 }, { lat: 4.7, lon: -74.2 }, { lat: 4.8, lon: -74.3, name: '' }], { style: 'std' });
  const f = filas(csv);
  assert.equal(f[0].split(',').slice(0, 4).join('|'), 'P1|4.6000000|-74.1000000|-3.0');
  assert.equal(nombre(f[1], ','), 'P2');
  assert.equal(nombre(f[2], ','), 'P3');
  assert.ok(!csv.includes("'-"), 'ningún número lleva apóstrofo');
});

/* ---------- XML ---------- */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

test('Xml.escape: quita los caracteres que XML 1.0 no admite y conserva los permitidos', () => {
  const invalidos = ['\u0000', '\u0001', '\u0007', '\u0008', '\u000B', '\u000C', '\u000E', '\u0010', '\u001F', '\uFFFE', '\uFFFF'];
  for (const c of invalidos) assert.equal(Xml.escape('a' + c + 'b'), 'ab', 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  for (const c of ['\u0009', '\u000A', '\u000D', ' ', '\u007F', '\u0080', 'ñ', 'á', ' ', '\uFFFD', '😀']) assert.equal(Xml.escape('a' + c + 'b'), 'a' + c + 'b', JSON.stringify(c));
});

test('Xml.escape: sigue escapando & < > " y quita los de control en el mismo texto, y los números y el vacío siguen igual', () => {
  assert.equal(Xml.escape('a\u0001<b>&"c"\u001f'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  assert.equal(Xml.escape(42), '42');
  assert.equal(Xml.escape(undefined), '');
  assert.equal(Xml.escape('\u0000'), '');
});

test('KML y GPX: un nombre con caracteres de control sale sin ellos y el archivo se lee de vuelta', () => {
  const feo = 'Lote\u0001A\u0000B\u001F\u000B fin';
  const model = { name: feo, date: Date.UTC(2026, 10, 7), mainColor: '#FF0000', points: [pt(feo, 0), pt('b', 1), pt('c', 2)], layers: [] };
  const kml = Gis.toKML(model), gpx = Gis.toGPX(model);
  assert.ok(!CONTROL.test(kml), 'KML sin caracteres de control');
  assert.ok(!CONTROL.test(gpx), 'GPX sin caracteres de control');
  assert.ok(kml.includes('LoteAB fin'));
  assert.ok(gpx.includes('LoteAB fin'));
  assert.doesNotThrow(() => Xml.parse(kml));
  assert.doesNotThrow(() => Xml.parse(gpx));
  const back = Gis.parseText(kml);
  assert.ok(back.features.some((f) => f.name && f.name.startsWith('LoteAB')), 'el nombre limpio vuelve al importar');
});

test('GeoJSON: JSON.stringify ya escapa los caracteres de control, el archivo sigue siendo JSON válido', () => {
  const feo = 'x\u0001y';
  const model = { name: feo, date: Date.UTC(2026, 10, 7), mainColor: '#FF0000', points: [pt(feo, 0), pt('b', 1), pt('c', 2)], layers: [] };
  const txt = Gis.toGeoJSON(model);
  assert.doesNotThrow(() => JSON.parse(txt));
  assert.ok(!CONTROL.test(txt));
});

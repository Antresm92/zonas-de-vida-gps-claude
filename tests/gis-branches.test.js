'use strict';
/* Casos límite de gis.js: archivos dañados, formas raras de KML/GeoJSON/GPX, límites de tamaño y capas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Gis = require('../www/js/gis.js');
const { makeZip } = require('./helpers/zipbuild.js');

const kml = (inner) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">${inner}</kml>`;
const sq = '-74.1,4.6,0 -74.0,4.6,0 -74.0,4.7,0 -74.1,4.7,0 -74.1,4.6,0';
const poly = (name, coords = sq) => `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
const gj = (o) => JSON.stringify(o);

test('KML: Folder como contenedor, carpetas anidadas, vínculos de red y Placemark suelto', () => {
  const r = Gis.parseText(kml(`<Folder><name>Mi carpeta</name><Folder>${poly('A')}</Folder><NetworkLink><Link><href>http://x</href></Link></NetworkLink></Folder>`));
  assert.equal(r.name, 'Mi carpeta'); assert.equal(r.features.length, 1);
  assert.ok(r.warnings.some((w) => /NetworkLink/.test(w)));
  const sin = Gis.parseText(kml(poly('Suelto')));
  assert.equal(sin.name, ''); assert.equal(sin.features[0].name, 'Suelto');
});

test('KML: coordenadas mal escritas se cuentan y se omiten; espacios después de la coma se aceptan', () => {
  const r = Gis.parseText(kml(poly('P', '-74.1, 4.6, 0 -74.0,4.6,0 x -74.0,4.7 ,5 7 -74.1,4.7')));
  assert.equal(r.features[0].coords.length, 4);
  assert.ok(r.warnings.some((w) => /omitieron 2 coordenada/.test(w)));
  assert.throws(() => Gis.parseText(kml('<Placemark><name>V</name><Point><coordinates> </coordinates></Point></Placemark>')), /No encontré/);
});

test('KML: polígono sin borde exterior, con 2 puntos (queda como línea) y con huecos pequeños', () => {
  const sinBorde = kml('<Placemark><name>X</name><Polygon></Polygon></Placemark>' + poly('Bueno'));
  const a = Gis.parseText(sinBorde);
  assert.equal(a.features.length, 1); assert.ok(a.warnings.some((w) => /menos de 3 puntos/.test(w)));
  const dos = Gis.parseText(kml(poly('Dos', '-74.1,4.6,0 -74.0,4.6,0 -74.1,4.6,0')));
  assert.equal(dos.features[0].type, 'line');
  const hueco = Gis.parseText(kml(`<Placemark><name>H</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${sq}</coordinates></LinearRing></outerBoundaryIs>` +
    '<innerBoundaryIs><LinearRing><coordinates>-74.09,4.61,0 -74.08,4.61,0 -74.09,4.61,0</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>'));
  assert.equal(hueco.features[0].holes.length, 0);
});

test('KML: gx:Track con y sin altitud, y línea de un solo punto se omite con aviso', () => {
  const t = Gis.parseText(kml('<Placemark><name>T</name><gx:Track xmlns:gx="http://www.google.com/kml/ext/2.2"><gx:coord>-74.1 4.6 2500</gx:coord><gx:coord>-74.0 4.6</gx:coord></gx:Track></Placemark>'));
  assert.equal(t.features[0].type, 'line'); assert.equal(t.features[0].coords[0].alt, 2500); assert.equal(t.features[0].coords[1].alt, null);
  const uno = Gis.parseText(kml('<Placemark><name>L</name><LineString><coordinates>-74.1,4.6,0</coordinates></LineString></Placemark>' + poly('Ok')));
  assert.ok(uno.warnings.some((w) => /menos de 2 puntos/.test(w)));
});

test('KML: raíz con otro nombre en mayúsculas se rechaza con un mensaje claro', () => {
  assert.throws(() => Gis.parseText('<KML><Document/></KML>'), /no es un KML/);
  assert.throws(() => Gis.parseText('<GPX version="1.1"><wpt lat="1" lon="1"/></GPX>'), /no es un GPX/);
});

test('GeoJSON: todos los tipos de geometría, nombres desde propiedades y nombre de la colección', () => {
  const r = Gis.parseText(gj({ type: 'FeatureCollection', name: 'Mi colección', features: [
    { type: 'Feature', properties: { name: '  ', Nombre: 'Segundo' }, geometry: { type: 'MultiPoint', coordinates: [[-74.1, 4.6, 100], [-74.0, 4.7]] } },
    { type: 'Feature', properties: { id: 7 }, geometry: { type: 'MultiLineString', coordinates: [[[-74.1, 4.6], [-74.0, 4.6]], [[-74.1, 4.7], [-74.0, 4.7]]] } },
    { type: 'Feature', properties: null, geometry: { type: 'MultiPolygon', coordinates: [[[[-74.1, 4.6], [-74.0, 4.6], [-74.0, 4.7], [-74.1, 4.6]]], []] } },
    { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [-74.2, 4.8] }, null] } },
    { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection' } },
    { type: 'Feature', properties: {}, geometry: { type: 'Rareza', coordinates: [] } },
    { type: 'Feature', properties: {}, geometry: null },
    'no soy una característica', null
  ] }));
  assert.equal(r.name, 'Mi colección');
  const por = (t) => r.features.filter((f) => f.type === t);
  assert.equal(por('point').length, 3); assert.equal(por('line').length, 2); assert.equal(por('polygon').length, 1);
  assert.equal(por('point')[0].name, 'Segundo'); assert.equal(por('line')[0].name, '7');
  assert.ok(r.warnings.some((w) => /Rareza/.test(w)));
});

test('GeoJSON: posiciones dañadas, anillos vacíos y geometría que no es objeto', () => {
  const r = Gis.parseText(gj({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-74.1, 4.6], 'x', [1], ['a', 'b'], [-74.0, 4.6, 'alto'], 5] } }));
  assert.equal(r.features[0].coords.length, 2); assert.equal(r.features[0].coords[1].alt, null);
  assert.ok(r.warnings.some((w) => /omitieron 4 coordenada/.test(w)));
  assert.throws(() => Gis.parseText(gj({ type: 'Polygon', coordinates: [] })), /No encontré/);
  assert.throws(() => Gis.parseText(gj({ type: 'Polygon', coordinates: 'no' })), /No encontré/);
  assert.throws(() => Gis.parseText(gj({ type: 'Feature', geometry: 'texto' })), /No encontré/);
  assert.throws(() => Gis.parseText(gj({ type: 'LineString', coordinates: 'no' })), /No encontré/);
  assert.throws(() => Gis.parseText(gj({ type: 'FeatureCollection' })), /No encontré/);
});

test('GeoJSON: coordenadas planas (MAGNA-SIRGAS) se explican; JSON inválido o ajeno también', () => {
  assert.throws(() => Gis.parseText(gj({ type: 'Polygon', coordinates: [[[1000000, 1000000], [1000100, 1000000], [1000100, 1000100], [1000000, 1000000]]] })), /MAGNA-SIRGAS/);
  assert.throws(() => Gis.parseText('{"type": "Polygon", '), /no es un JSON válido/);
  assert.throws(() => Gis.parseText('[1, 2, 3]'), /No reconozco este JSON/);
  assert.throws(() => Gis.parseText('{"hola": 1}'), /No reconozco este JSON/);
  assert.throws(() => Gis.parseText('{"type": "Otra"}'), /No reconozco este JSON/);
  for (const raw of [{ projects: [] }, { state: { projects: [] } }, { app: 'zonas-de-vida-gps' }]) {
    try { Gis.parseText(gj(raw)); assert.fail('debía fallar'); } catch (e) { assert.equal(e.code, 'backup'); }
  }
});

test('GPX: sin coordenadas válidas, recorrido abierto, recorrido cerrado muy fino y metadatos', () => {
  const gpx = (inner) => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Mi GPX</name></metadata>${inner}</gpx>`;
  const abierto = Gis.parseText(gpx('<trk><name>Camino</name><trkseg><trkpt lat="4.6" lon="-74.1"><ele>2500</ele></trkpt><trkpt lat="4.61" lon="-74.1"/><trkpt lat="4.62" lon="-74.1"/><trkpt lat="4.63" lon="-74.1"/></trkseg></trk>'));
  assert.equal(abierto.name, 'Mi GPX'); assert.equal(abierto.features[0].type, 'line'); assert.equal(abierto.features[0].coords[0].alt, 2500);
  // ida y vuelta por el mismo camino: vuelve al inicio pero no encierra área → sigue siendo línea
  const fino = Gis.parseText(gpx('<rte><name>Ida y vuelta</name><rtept lat="4.6" lon="-74.1"/><rtept lat="4.61" lon="-74.1"/><rtept lat="4.62" lon="-74.1"/><rtept lat="4.61" lon="-74.1"/><rtept lat="4.6" lon="-74.1"/></rte>'));
  assert.equal(fino.features[0].type, 'line');
  assert.throws(() => Gis.parseText(gpx('<wpt lat="999" lon="999"/>')), /No encontré|grados/);
  const sinMeta = Gis.parseText('<gpx><wpt lat="4.6" lon="-74.1"><name>Pozo</name></wpt></gpx>');
  assert.equal(sinMeta.name, ''); assert.equal(sinMeta.features[0].name, 'Pozo');
});

test('tamaños y codificaciones: archivo enorme, vacío, UTF-16 de extremo grande, ZIP sin KML', () => {
  const enorme = 'a'.repeat(Gis.LIMITS.bytes + 1);
  assert.throws(() => Gis.parseText(enorme), /demasiado grande/);
  assert.throws(() => Gis.parseBytes(new Uint8Array(Gis.LIMITS.bytes + 1)), /demasiado grande/);
  assert.throws(() => Gis.parseBytes(new Uint8Array(0)), /vacío/);
  assert.throws(() => Gis.parseBytes(null), /vacío/);
  assert.throws(() => Gis.parseText('texto cualquiera'), /No reconozco/);
  assert.throws(() => Gis.parseText('<html><body/></html>'), /no es un KML ni un GPX/);
  assert.throws(() => Gis.parseText(undefined), /No reconozco/);
  const texto = kml(poly('Be'));
  const be = new Uint8Array(2 + texto.length * 2); be[0] = 0xFE; be[1] = 0xFF;
  for (let i = 0; i < texto.length; i++) { be[2 + 2 * i] = texto.charCodeAt(i) >> 8; be[3 + 2 * i] = texto.charCodeAt(i) & 255; }
  assert.equal(Gis.parseBytes(be).features[0].name, 'Be');
  assert.throws(() => Gis.parseBytes(new Uint8Array(makeZip([{ name: 'leeme.txt', data: 'hola' }]))), /ningún archivo .kml/);
  const otro = Gis.parseBytes(new Uint8Array(makeZip([{ name: 'carpeta/otro.KML', data: kml(poly('EnZip')) }])));
  assert.equal(otro.format, 'kmz'); assert.equal(otro.features[0].name, 'EnZip');
});

test('demasiados vértices: se corta con un mensaje claro', () => {
  const n = Gis.LIMITS.vertices + 1, coords = [];
  for (let i = 0; i < n; i++) coords.push([-74 + (i % 1000) * 1e-5, 4 + Math.floor(i / 1000) * 1e-5]);
  assert.throws(() => Gis.parseText(gj({ type: 'LineString', coordinates: coords })), /demasiados puntos/);
});

test('capas: sin opciones, nombres de reserva, huecos, un solo punto con nombre y límite de elementos', () => {
  const feats = [
    { type: 'polygon', name: '', coords: [{ lat: 4, lon: -74 }, { lat: 4, lon: -73.9 }, { lat: 4.1, lon: -73.9 }], holes: [[{ lat: 4.01, lon: -73.99, alt: 5 }, { lat: 4.01, lon: -73.98 }, { lat: 4.02, lon: -73.98 }]] },
    { type: 'line', name: '', coords: [{ lat: 4, lon: -74 }, { lat: 4.1, lon: -74 }] }
  ];
  const a = Gis.toLayers(feats);
  assert.equal(a[0].name, 'Polígono importado'); assert.equal(a[1].name, 'Línea importada'); assert.equal(a[0].holes.length, 1); assert.equal(a[0].file, '');
  const b = Gis.toLayers(feats, { file: 'finca.kml.kml', startAt: 3, ts: 5, uid: () => 'x' });
  assert.equal(b[0].name, 'finca'); assert.equal(b[0].color, Gis.PALETTE[3]); assert.equal(b[0].id, 'x'); assert.equal(b[0].ts, 5);
  const uno = Gis.toLayers([{ type: 'point', name: 'Pozo', coords: [{ lat: 4, lon: -74, alt: 3 }] }]);
  assert.equal(uno[0].name, 'Pozo'); assert.equal(uno[0].points[0].name, 'Pozo'); assert.equal(uno[0].points[0].alt, 3);
  const varios = Gis.toLayers([{ type: 'point', name: '', coords: [{ lat: 4, lon: -74 }] }, { type: 'point', name: '', coords: [{ lat: 4.1, lon: -74 }] }], { file: 'pozos.geojson' });
  assert.equal(varios[0].name, 'pozos (puntos)'); assert.equal(varios[0].points.length, 2); assert.equal(varios[0].points[0].name, undefined);
  assert.equal(Gis.toLayers([{ type: 'point', name: '', coords: [{ lat: 4, lon: -74 }] }])[0].name, 'Puntos importados');
  const muchos = []; for (let i = 0; i < Gis.LIMITS.layers + 1; i++) muchos.push(feats[1]);
  assert.throws(() => Gis.toLayers(muchos), /el máximo es/);
});

test('resumen: con más de 3000 vértices usa una muestra para el centro y cuenta líneas y puntos', () => {
  const big = []; for (let i = 0; i < 4000; i++) big.push({ lat: 4 + (i % 100) * 1e-4, lon: -74 + Math.floor(i / 100) * 1e-4 });
  const s = Gis.summarize([{ type: 'line', name: 'L', coords: big }, { type: 'point', name: 'P', coords: [{ lat: 4, lon: -74 }] }]);
  assert.equal(s.lines, 1); assert.equal(s.points, 1); assert.equal(s.vertices, 4001); assert.ok(s.center.lat > 4);
  assert.equal(Gis.summarize([]).center, null);
});

test('pointsFromLayer: con y sin altitud, y con identificador propio', () => {
  const pts = Gis.pointsFromLayer({ points: [{ lat: 4, lon: -74, alt: 100, name: 'Uno' }, { lat: 4.1, lon: -74 }] });
  assert.equal(pts[0].name, 'Uno'); assert.equal(pts[0].altSrc, 'archivo'); assert.equal(pts[1].name, 'P2'); assert.equal(pts[1].altSrc, null);
  const ids = Gis.pointsFromLayer({ points: [{ lat: 1, lon: 1 }], ts: 9 }, () => 'z');
  assert.equal(ids[0].id, 'z'); assert.equal(ids[0].ts, 9);
});

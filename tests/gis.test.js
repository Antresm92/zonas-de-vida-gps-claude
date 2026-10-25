'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const Gis = require('../www/js/gis.js');
const { makeZip } = require('./helpers/zipbuild.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);

// Estructura igual a la que guarda Google Earth Pro (LookAt, StyleMap, Region, coordenadas con tabs y altitud 0), con datos inventados
const GE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
	<name>Lote de prueba.json</name>
	<atom:link rel="app" href="https://www.google.com/earth/about/versions/#earth-pro" title="Google Earth Pro 7.3.7.1327"></atom:link>
	<StyleMap id="msn"><Pair><key>normal</key><styleUrl>#sn</styleUrl></Pair></StyleMap>
	<Style id="sn"><LineStyle><color>40ffffff</color><width>9</width></LineStyle><PolyStyle><color>8cffaa55</color></PolyStyle></Style>
	<Placemark>
		<LookAt><longitude>-74.9995</longitude><latitude>5.0005</latitude><altitude>0</altitude><gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode></LookAt>
		<styleUrl>#msn</styleUrl>
		<Region><LatLonAltBox><north>5.001</north><south>5.0</south><east>-74.999</east><west>-75.0</west></LatLonAltBox></Region>
		<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>
			-75.0,5.0,0 -74.999,5.0,0 -74.999,5.001,0
			-75.0,5.001,0 -75.0,5.0,0
		</coordinates></LinearRing></outerBoundaryIs></Polygon>
	</Placemark>
</Document>
</kml>`;

test('importar KML de Google Earth: polígono, cierre repetido y altitudes en 0 ignoradas', () => {
  const r = Gis.parseText(GE_KML);
  assert.equal(r.format, 'kml');
  assert.equal(r.name, 'Lote de prueba.json');
  assert.equal(r.features.length, 1);
  const f = r.features[0];
  assert.equal(f.type, 'polygon');
  assert.equal(f.coords.length, 4);                                  // sin el punto de cierre repetido
  assert.deepEqual(f.coords[2], { lat: 5.001, lon: -74.999, alt: null });
  assert.ok(r.warnings.some((w) => /todas 0/.test(w)), 'avisa que las altitudes eran 0');
  const s = Gis.summarize(r.features);
  close(s.areaM2, Geo.polygonArea(f.coords), 1e-6);
  assert.ok(s.areaM2 > 12000 && s.areaM2 < 12500);
  close(s.center.lat, 5.0005, 1e-4);
});

test('importar KMZ (zip con doc.kml) da lo mismo que el KML', () => {
  const kmz = makeZip([{ name: 'doc.kml', data: GE_KML }, { name: 'files/icon.png', data: Buffer.from([1, 2, 3]), method: 0 }]);
  const r = Gis.parseBytes(kmz);
  assert.equal(r.format, 'kmz');
  assert.deepEqual(r.features, Gis.parseText(GE_KML).features);
  const sinDoc = makeZip([{ name: 'otro/mapa.KML', data: GE_KML }]);
  assert.equal(Gis.parseBytes(sinDoc).features.length, 1);
  assert.throws(() => Gis.parseBytes(makeZip([{ name: 'a.txt', data: 'x' }])), /no contiene ningún archivo .kml/);
});

test('importar KML: puntos, líneas, MultiGeometry, huecos, gx:Track y altitudes reales', () => {
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
    <Folder><name>Carpeta</name>
      <Placemark><name>Casa &amp; bodega</name><Point><altitudeMode>absolute</altitudeMode><coordinates>-75.0005, 5.0005, 1234.5</coordinates></Point></Placemark>
      <Placemark><name>Camino</name><LineString><coordinates>-75.0,5.0,1200 -75.001,5.002,1210</coordinates></LineString></Placemark>
      <Placemark><name>Lotes</name><MultiGeometry>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>-75,5,0 -74.99,5,0 -74.99,5.01,0 -75,5.01,0 -75,5,0</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>-74.996,5.004,0 -74.994,5.004,0 -74.994,5.006,0 -74.996,5.006,0 -74.996,5.004,0</coordinates></LinearRing></innerBoundaryIs></Polygon>
        <Point><coordinates>-74.995,5.005</coordinates></Point>
      </MultiGeometry></Placemark>
      <Placemark><name>Recorrido</name><gx:Track><gx:coord>-75.0 5.0 1500</gx:coord><gx:coord>-75.001 5.001 1510</gx:coord></gx:Track></Placemark>
      <Placemark><name>Relativo</name><Point><altitudeMode>relativeToGround</altitudeMode><coordinates>-75,5,30</coordinates></Point></Placemark>
    </Folder>
    <NetworkLink><Link><href>http://x</href></Link></NetworkLink>
  </Document></kml>`;
  const r = Gis.parseText(kml);
  const by = (n) => r.features.filter((f) => f.name === n);
  assert.equal(by('Casa & bodega')[0].coords[0].alt, 1234.5);
  assert.equal(by('Camino')[0].type, 'line');
  assert.equal(by('Camino')[0].coords[1].alt, 1210);               // altitudeMode ausente: se aceptan alturas distintas de 0
  const lotes = by('Lotes');
  assert.equal(lotes.length, 2);
  assert.equal(lotes[0].type, 'polygon');
  assert.equal(lotes[0].holes.length, 1);
  assert.equal(lotes[0].holes[0].length, 4);
  assert.equal(lotes[1].type, 'point');
  assert.equal(by('Recorrido')[0].coords[1].alt, 1510);
  assert.equal(by('Relativo')[0].coords[0].alt, null);
  assert.ok(r.warnings.some((w) => /relativas al suelo/.test(w)));
  assert.ok(r.warnings.some((w) => /NetworkLink/.test(w)));
});

test('importar KML: errores claros', () => {
  assert.throws(() => Gis.parseText('<kml><Document></Document></kml>'), /No encontré polígonos/);
  assert.throws(() => Gis.parseText('<kml><Document><Placemark><Point><coordinates>800000,1000000,0</coordinates></Point></Placemark></Document></kml>'), /no están en grados/);
  assert.throws(() => Gis.parseText('<hola/>'), /no es un KML ni un GPX/);
  assert.throws(() => Gis.parseText('<kml><Document>'), /XML no válido/);
  assert.throws(() => Gis.parseText('texto cualquiera'), /No reconozco/);
  assert.throws(() => Gis.parseBytes(new Uint8Array(0)), /vacío/);
  const mix = Gis.parseText('<kml><Document><Placemark><name>a</name><LineString><coordinates>-75,5 -75.1,5.1 900,9000</coordinates></LineString></Placemark></Document></kml>');
  assert.equal(mix.features[0].coords.length, 2);
  assert.ok(mix.warnings.some((w) => /fuera de rango/.test(w)));
});

/* ---------- GeoJSON ---------- */
const GJ = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { NUMERO_PREDIAL: '251260001000000010123000000000', area: 3 },
      geometry: { type: 'Polygon', coordinates: [[[-75, 5], [-75, 5.001], [-74.999, 5.001], [-74.999, 5], [-75, 5]]] } },     // horario
    { type: 'Feature', properties: { nombre: 'Potreros' }, geometry: { type: 'MultiPolygon', coordinates: [
      [[[-75, 5.01], [-74.99, 5.01], [-74.99, 5.02], [-75, 5.02], [-75, 5.01]]],
      [[[-75, 5.03], [-74.99, 5.03], [-74.99, 5.04], [-75, 5.04], [-75, 5.03]], [[-74.996, 5.034], [-74.994, 5.034], [-74.994, 5.036], [-74.996, 5.036], [-74.996, 5.034]]]] } },
    { type: 'Feature', properties: { name: 'Pozo' }, geometry: { type: 'Point', coordinates: [-74.9995, 5.0005, 2411.2] } },
    { type: 'Feature', properties: null, geometry: { type: 'LineString', coordinates: [[-75, 5, 0], [-75.01, 5.01, 0]] } }
  ]
};

test('importar GeoJSON: polígonos (cualquier orientación), multipolígonos con huecos, puntos y líneas', () => {
  const r = Gis.parseText(JSON.stringify(GJ));
  assert.equal(r.format, 'geojson');
  const polys = r.features.filter((f) => f.type === 'polygon');
  assert.equal(polys.length, 3);
  assert.equal(polys[0].name, '251260001000000010123000000000');
  assert.equal(polys[0].coords.length, 4);
  assert.equal(polys[1].name, 'Potreros');
  assert.equal(polys[2].holes.length, 1);
  const pozo = r.features.find((f) => f.name === 'Pozo');
  assert.equal(pozo.coords[0].alt, 2411.2);
  const linea = r.features.find((f) => f.type === 'line');
  assert.equal(linea.coords[0].alt, null);                          // altitudes 0 ignoradas
});

test('importar GeoJSON: geometría suelta, Feature único y errores', () => {
  assert.equal(Gis.parseText('{"type":"Point","coordinates":[-75,5]}').features[0].type, 'point');
  assert.equal(Gis.parseText(JSON.stringify(GJ.features[0])).features.length, 1);
  assert.throws(() => Gis.parseText('{"type":"FeatureCollection","features":[]}'), /No encontré/);
  assert.throws(() => Gis.parseText('{"hola":1}'), /No reconozco este JSON como GeoJSON/);
  assert.throws(() => Gis.parseText('{ roto'), /JSON válido/);
  assert.throws(() => Gis.parseText('{"type":"Polygon","coordinates":[[[500000,1000000],[500100,1000000],[500100,1000100],[500000,1000000]]]}'), /no están en grados/);
});

test('importar un JSON que es copia de seguridad avisa con código backup', () => {
  try { Gis.parseText('{"app":"zonas-de-vida-gps","projects":[]}'); assert.fail('debía fallar'); }
  catch (e) { assert.equal(e.code, 'backup'); assert.match(e.message, /copia de seguridad/); }
});

test('importar archivo en UTF-16 con BOM y UTF-8 con BOM', () => {
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(GE_KML, 'utf16le')]);
  assert.equal(Gis.parseBytes(new Uint8Array(u16)).features.length, 1);
  const u8 = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(JSON.stringify(GJ), 'utf8')]);
  assert.equal(Gis.parseBytes(new Uint8Array(u8)).features.length, 5);
});

/* ---------- GPX ---------- */
const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Salida</name></metadata>
<wpt lat="5.0005" lon="-75.0005"><ele>1500.5</ele><name>Mojón 1</name></wpt>
<rte><name>Ruta</name><rtept lat="5" lon="-75"/><rtept lat="5.01" lon="-75"/></rte>
<trk><name>Perímetro</name><trkseg>
 <trkpt lat="5.0000" lon="-75.0000"><ele>1000</ele></trkpt><trkpt lat="5.0000" lon="-74.9990"><ele>1001</ele></trkpt>
 <trkpt lat="5.0010" lon="-74.9990"><ele>1002</ele></trkpt><trkpt lat="5.0010" lon="-75.0000"><ele>1003</ele></trkpt>
 <trkpt lat="5.00001" lon="-75.0000"><ele>1000</ele></trkpt></trkseg></trk>
<trk><name>Ida y vuelta</name><trkseg>
 <trkpt lat="5" lon="-75"/><trkpt lat="5.001" lon="-75"/><trkpt lat="5.002" lon="-75"/><trkpt lat="5.001" lon="-75.00001"/><trkpt lat="5.00001" lon="-75"/></trkseg></trk>
</gpx>`;

test('importar GPX: waypoints, rutas, y un recorrido cerrado se toma como polígono', () => {
  const r = Gis.parseText(GPX);
  assert.equal(r.format, 'gpx');
  assert.equal(r.name, 'Salida');
  const wp = r.features.find((f) => f.type === 'point');
  assert.deepEqual(wp.coords[0], { lat: 5.0005, lon: -75.0005, alt: 1500.5 });
  assert.equal(wp.name, 'Mojón 1');
  assert.equal(r.features.find((f) => f.name === 'Ruta').type, 'line');
  const per = r.features.find((f) => f.name === 'Perímetro');
  assert.equal(per.type, 'polygon');
  assert.equal(per.coords.length, 4);                              // se quitó el punto que cerraba el recorrido
  assert.equal(per.coords[2].alt, 1002);
  assert.equal(r.features.find((f) => f.name === 'Ida y vuelta').type, 'line');   // sin área: sigue siendo línea
  assert.throws(() => Gis.parseText('<gpx><trk><trkseg></trkseg></trk></gpx>'), /No encontré/);
});

/* ---------- Capas ---------- */
test('capas: colores de la paleta, puntos agrupados y nombre del archivo', () => {
  const r = Gis.parseText(JSON.stringify(GJ));
  let n = 0;
  const layers = Gis.toLayers(r.features, { file: 'Finca.geojson', startAt: 1, uid: () => 'id' + (++n), ts: 5 });
  assert.equal(layers.length, 5);                                   // 3 polígonos + 1 línea + 1 capa de puntos
  assert.equal(layers[0].color, Gis.PALETTE[1]);
  assert.equal(layers[1].color, Gis.PALETTE[2]);
  assert.ok(layers.every((l) => l.color !== Gis.MAIN_COLOR));
  assert.deepEqual(layers.map((l) => l.kind), ['polygon', 'polygon', 'polygon', 'line', 'points']);
  assert.equal(layers[2].holes.length, 1);
  assert.equal(layers[3].name, 'Finca');                            // sin nombre propio: usa el del archivo
  assert.equal(layers[4].name, 'Pozo');
  assert.equal(layers[0].file, 'Finca.geojson');
  assert.equal(layers[0].id, 'id1');
  assert.ok(layers.every((l) => l.visible === true));
});

test('capas: puntos de proyecto a partir de una capa', () => {
  const layer = { points: [{ lat: 5, lon: -75, alt: 1000 }, { lat: 5.1, lon: -75, alt: null, name: 'Mojón' }], ts: 9 };
  let k = 0;
  const pts = Gis.pointsFromLayer(layer, () => 'p' + (++k));
  assert.equal(pts[0].name, 'P1'); assert.equal(pts[0].altSrc, 'archivo'); assert.equal(pts[0].alt, 1000);
  assert.equal(pts[1].name, 'Mojón'); assert.equal(pts[1].altSrc, null); assert.equal(pts[1].alt, null);
  assert.equal(pts[1].id, 'p2');
});

/* ---------- Exportación ---------- */
const PTS = [
  { name: 'P1', lat: 5.0, lon: -75.0, alt: 1000.4, altSrc: 'gps', acc: 4.6 },
  { name: 'P2', lat: 5.0, lon: -74.999, alt: 1002, altSrc: 'manual' },
  { name: 'P3 <norte> & "sur"', lat: 5.001, lon: -74.999, alt: null },
  { name: 'P4', lat: 5.001, lon: -75.0 }
];
const LAYERS = [
  { id: 'a', name: 'Colindante', kind: 'polygon', color: '#E67E22', visible: true, points: [{ lat: 5.002, lon: -75.0, alt: null }, { lat: 5.002, lon: -74.999, alt: null }, { lat: 5.003, lon: -74.999, alt: null }] },
  { id: 'b', name: 'Oculta', kind: 'polygon', color: '#8E44AD', visible: false, points: [{ lat: 6, lon: -75 }, { lat: 6, lon: -74.9 }, { lat: 6.1, lon: -74.9 }] },
  { id: 'c', name: 'Mojones', kind: 'points', color: '#2980B9', visible: true, points: [{ lat: 5.0005, lon: -74.9995, alt: 1001, name: 'M1' }, { lat: 5.0006, lon: -74.9996, alt: null }] },
  { id: 'd', name: 'Camino', kind: 'line', color: '#C0392B', visible: true, points: [{ lat: 5, lon: -75 }, { lat: 5.01, lon: -75.01 }] }
];
const MODEL = { name: 'Finca "La Esperanza" & Cía', points: PTS, layers: LAYERS, mainColor: '#2F8F4E', date: Date.UTC(2026, 9, 22) };

test('exportar KML: se puede volver a leer, con colores KML (aabbggrr) y sin capas ocultas', () => {
  const kml = Gis.toKML(MODEL);
  assert.match(kml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(kml.includes('<name>Finca &quot;La Esperanza&quot; &amp; Cía</name>'));
  assert.ok(kml.includes('P3 &lt;norte&gt; &amp; &quot;sur&quot;'));
  assert.ok(kml.includes('<color>ff227EE6</color>'), 'naranja #E67E22 → ff227EE6');
  assert.ok(kml.includes('<color>ff4E8F2F</color>'), 'verde #2F8F4E → ff4E8F2F');
  assert.ok(!kml.includes('Oculta'));
  const back = Gis.parseText(kml);
  const poly = back.features.find((f) => f.type === 'polygon' && f.name.startsWith('Finca'));
  assert.equal(poly.coords.length, 4);
  poly.coords.forEach((c, i) => { close(c.lat, PTS[i].lat, 1e-7); close(c.lon, PTS[i].lon, 1e-7); });
  assert.equal(back.features.filter((f) => f.type === 'point').length, 4 + 2);
  assert.ok(back.features.some((f) => f.name === 'Colindante' && f.type === 'polygon'));
  assert.ok(back.features.some((f) => f.name === 'Camino' && f.type === 'line'));
  assert.equal(back.features.find((f) => f.name === 'P1').coords[0].alt, 1000.4);
});

test('exportar KML: un solo punto o dos puntos, y proyecto vacío', () => {
  assert.equal(Gis.parseText(Gis.toKML({ name: 'x', points: PTS.slice(0, 2) })).features.filter((f) => f.type === 'line').length, 1);
  assert.equal(Gis.parseText(Gis.toKML({ name: 'x', points: PTS.slice(0, 1) })).features.length, 1);
  assert.ok(Gis.toKML({ name: 'vacío', points: [] }).includes('</kml>'));
});

test('exportar GeoJSON: anillo cerrado, exterior antihorario y huecos horarios (RFC 7946)', () => {
  const gj = JSON.parse(Gis.toGeoJSON(MODEL));
  assert.equal(gj.type, 'FeatureCollection');
  const poly = gj.features.find((f) => f.geometry.type === 'Polygon' && f.properties.tipo === 'poligono' && f.properties.name.startsWith('Finca'));
  const ring = poly.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.equal(ring.length, 5);
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(a > 0, 'antihorario');
  close(poly.properties.area_m2, Geo.polygonArea(PTS), 0.1);
  assert.equal(poly.properties.vertices, 4);
  assert.equal(poly.properties.color, '#2F8F4E');
  assert.equal(gj.features.filter((f) => f.properties.tipo === 'vertice').length, 4);
  assert.deepEqual(gj.features.find((f) => f.properties.name === 'P1').geometry.coordinates, [-75, 5, 1000.4]);
  assert.equal(gj.features.find((f) => f.properties.name === 'P1').properties.precision_m, 4.6);
  assert.ok(!JSON.stringify(gj).includes('Oculta'));
  // un polígono horario de entrada sale antihorario, y un hueco sale horario
  const hole = { id: 'h', name: 'Con hueco', kind: 'polygon', color: '#8E44AD', visible: true,
    points: [{ lat: 5, lon: -75 }, { lat: 5.01, lon: -75 }, { lat: 5.01, lon: -74.99 }, { lat: 5, lon: -74.99 }],
    holes: [[{ lat: 5.004, lon: -74.996 }, { lat: 5.004, lon: -74.994 }, { lat: 5.006, lon: -74.994 }, { lat: 5.006, lon: -74.996 }]] };
  const g2 = JSON.parse(Gis.toGeoJSON({ name: 'h', points: [], layers: [hole] }));
  const rings = g2.features[0].geometry.coordinates;
  const sa = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s; };
  assert.ok(sa(rings[0]) > 0, 'exterior antihorario');
  assert.ok(sa(rings[1]) < 0, 'hueco horario');
  const back = Gis.parseText(Gis.toGeoJSON({ name: 'h', points: [], layers: [hole] }));
  assert.equal(back.features[0].holes.length, 1);
});

test('exportar GPX: waypoints y recorrido cerrado que se vuelve a leer como polígono', () => {
  const gpx = Gis.toGPX(MODEL);
  assert.match(gpx, /<gpx version="1.1" creator="Zonas de Vida" xmlns="http:\/\/www.topografix.com\/GPX\/1\/1">/);
  assert.ok(gpx.includes('<name>P3 &lt;norte&gt; &amp; &quot;sur&quot;</name>'));
  assert.ok(gpx.indexOf('<wpt') < gpx.indexOf('<trk>'), 'primero wpt y después trk');
  assert.ok(gpx.includes('<ele>1000.4</ele><name>P1</name>'), 'ele va antes que name');
  const back = Gis.parseText(gpx);
  const per = back.features.find((f) => f.type === 'polygon' && f.name.startsWith('Finca'));
  assert.equal(per.coords.length, 4);
  assert.ok(back.features.some((f) => f.type === 'point' && f.name === 'M1'));
  assert.ok(back.features.some((f) => f.type === 'line' && f.name === 'Camino'));
});

test('exportar CSV: estilo Excel en español (; y coma decimal) y estándar, con rumbo y distancia', () => {
  const sq = [{ name: 'A', lat: 5, lon: -75, alt: 1000 }, { name: 'B', lat: 5, lon: -74.999, alt: 1001.26 }, { name: 'C', lat: 5.001, lon: -74.999 }, { name: 'D, "x"', lat: 5.001, lon: -75 }];
  const es = Gis.toCSV(sq);
  assert.equal(es.charCodeAt(0), 0xFEFF);
  const lines = es.slice(1).split('\r\n');
  assert.equal(lines[0], 'Punto;Latitud;Longitud;Altitud;Rumbo;Distancia al vértice siguiente');
  const a = lines[1].split(';');
  assert.deepEqual(a.slice(0, 4), ['A', '5,0000000', '-75,0000000', '1000,0']);
  close(parseFloat(a[4].replace(',', '.')), 90, 0.2);                  // de A a B: hacia el este
  close(parseFloat(a[5].replace(',', '.')), Geo.distance(5, -75, 5, -74.999), 0.01);
  const c = lines[3].split(';');
  assert.equal(c[3], '');                                              // sin altitud: celda vacía
  close(parseFloat(c[4].replace(',', '.')), 270, 0.2);
  const d = lines[4];
  assert.ok(d.startsWith('"D, ""x""";'), 'comillas en nombres con coma');
  close(parseFloat(d.split(';').pop().replace(',', '.')), Geo.distance(5.001, -75, 5, -75), 0.01);   // último → primero
  assert.equal(lines[5], '');                                          // termina con salto de línea
  const std = Gis.toCSV(sq, { style: 'std' }).slice(1).split('\r\n');
  assert.equal(std[0], 'Punto,Latitud,Longitud,Altitud,Rumbo,Distancia al vértice siguiente');
  assert.equal(std[1].split(',').slice(0, 4).join('|'), 'A|5.0000000|-75.0000000|1000.0');
  // sin polígono: la última fila no tiene rumbo ni distancia
  const two = Gis.toCSV(sq.slice(0, 2), { style: 'std' }).slice(1).split('\r\n');
  assert.equal(two[2].split(',').slice(4).join('|'), '|');
  assert.equal(Gis.toCSV([]).slice(1).split('\r\n').length, 2);
});

test('sniff: reconoce el formato por el contenido', () => {
  assert.equal(Gis.sniff('﻿  {"a":1}'), 'json');
  assert.equal(Gis.sniff('<?xml version="1.0"?><!-- x --><kml/>'), 'kml');
  assert.equal(Gis.sniff('<gpx version="1.1"/>'), 'gpx');
  assert.equal(Gis.sniff('<html></html>'), 'xml');
  assert.equal(Gis.sniff('a,b,c'), 'unknown');
});

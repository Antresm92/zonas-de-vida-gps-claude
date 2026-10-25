'use strict';
/* Pruebas de valores límite y casos que la prueba de fallos provocados (mutaciones) mostró sin cubrir:
 * justo en el borde de un rango, valores por defecto, latitudes altas y ajustes guardados. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const Fmt = require('../www/js/fmt.js');
const H = require('../www/js/holdridge.js');
const Climate = require('../www/js/climate.js');
const Analysis = require('../www/js/analysis.js');
const Gis = require('../www/js/gis.js');
const Gps = require('../www/js/gps.js');
const Store = require('../www/js/store.js');
const Backup = require('../www/js/backup.js');
const WL = require('../www/js/walter-lieth.js');
const Report = require('../www/js/report.js');
const IO = require('../www/js/io.js');
const Diagram = require('../www/js/diagram.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` esperado ${b} ± ${tol}, obtenido ${a}`);

/* ---------- Geometría ---------- */
test('rumbo inicial a latitudes medias y altas (referencia con otro método: vectores en la esfera)', () => {
  // Con la fórmula del rumbo mal escrita, los casos sobre el ecuador o sobre un meridiano pasan igual: aquí no.
  near(Geo.bearing(45, 0, 45, 1), 89.6464, 1e-3);
  near(Geo.bearing(60, 10, 60, 12), 89.1340, 1e-3);
  near(Geo.bearing(-30, 20, -29, 22), 60.6189, 1e-3);
  near(Geo.bearing(4.6097, -74.0817, 4.6101, -74.0809), 63.3606, 1e-3);
  near(Geo.bearing(10, -75, 11, -74), 44.4262, 1e-3);
});

/* ---------- Temperatura estimada ---------- */
test('temperatura al nivel del mar: sobre 40° de latitud baja 0,62 °C por cada grado más', () => {
  near(Climate.seaLevelTemp(40), Climate.T0_EQUATOR - 0.009 * 1600, 1e-9);
  near(Climate.seaLevelTemp(41), Climate.seaLevelTemp(40) - 0.62, 1e-9);
  near(Climate.seaLevelTemp(50), 7.6, 1e-9);
  near(Climate.seaLevelTemp(-50), 7.6, 1e-9);                       // el hemisferio sur es simétrico
  near(Climate.seaLevelTemp(0), Climate.T0_EQUATOR, 1e-9);
});

test('resolve: sin memoria (o con la memoria vacía) estima la temperatura y no consulta nada', () => {
  const a = Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2600 });
  assert.equal(a.TSrc, 'estimada'); assert.ok(isFinite(a.T)); assert.equal(a.P, null);
  const vacia = { count: 0, near() { throw new Error('no debía consultarse'); } };
  const b = Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2600 }, { memory: vacia });
  assert.equal(b.TSrc, 'estimada'); assert.equal(b.T, a.T);
});

test('importar CSV: latitud 90 y longitud 180 valen; un poco más, no', () => {
  const r = Climate.parseCSV('lat,lon,temp\n90,180,10\n-90,-180,11\n90.5,0,12\n0,180.5,13\n');
  assert.equal(r.records.length, 2);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Línea 4/);
});

/* ---------- Formato ---------- */
test('distancias y áreas justo en el cambio de unidad o de decimales', () => {
  assert.equal(Fmt.dist(999), '999 m');
  assert.equal(Fmt.dist(1000), '1,00 km');
  assert.equal(Fmt.area(Geo.areaUnits(10000), 'ha'), '1,00 ha');           // 1 ha exacta: 2 decimales, no 4
  assert.equal(Fmt.area(Geo.areaUnits(9999), 'ha'), '0,9999 ha');
  assert.equal(Fmt.area(Geo.areaUnits(1e6), 'km2'), '1,00 km²');
  assert.equal(Fmt.area(Geo.areaUnits(6400), 'fanegadas'), '1,00 fanegadas');
  assert.equal(Fmt.area(Geo.areaUnits(6000), 'fanegadas'), '0,938 fanegadas');
});

/* ---------- Holdridge ---------- */
test('avisa cuando la temperatura anual sale de 0–30 °C, por arriba o por abajo, y no si hay 12 meses', () => {
  assert.match(H.classify({ T: -5, P: 1000 }).warnings.join(' '), /fuera de 0–30/);
  assert.match(H.classify({ T: 35, P: 1000 }).warnings.join(' '), /fuera de 0–30/);
  assert.doesNotMatch(H.classify({ T: 15, P: 1000 }).warnings.join(' '), /fuera de 0–30/);
  const meses = [-2, -1, 0, 1, 2, 3, 3, 2, 1, 0, -1, -2];
  assert.doesNotMatch(H.classify({ T: -5, monthlyT: meses, P: 1000 }).warnings.join(' '), /fuera de 0–30/);
});

/* ---------- Análisis ---------- */
test('aviso de varios pisos térmicos: más de 150 m de diferencia, no 150 exactos', () => {
  const proyecto = (altMax) => ({ climate: { tManual: 14, pManual: 1200 }, points: [
    { id: 'a', name: 'A', lat: 4.60, lon: -74.10, alt: 2600 }, { id: 'b', name: 'B', lat: 4.61, lon: -74.10, alt: altMax }, { id: 'c', name: 'C', lat: 4.61, lon: -74.09, alt: 2650 }] });
  assert.doesNotMatch(Analysis.analyze(proyecto(2750), {}).warnings.join(' '), /varios pisos/);
  assert.match(Analysis.analyze(proyecto(2751), {}).warnings.join(' '), /varios pisos/);
});

/* ---------- CSV ---------- */
test('CSV: con 3 puntos el último se une con el primero; con 2 solo hay un lado', () => {
  const p = (n, lat, lon) => ({ name: n, lat, lon, alt: null });
  const filas = (t) => t.replace(/^﻿/, '').trim().split('\r\n').slice(1).map((f) => f.split(','));
  const tres = filas(Gis.toCSV([p('A', 4.6, -74.1), p('B', 4.6, -74.09), p('C', 4.61, -74.09)], { style: 'std' }));
  assert.ok(tres[2][4] !== '' && tres[2][5] !== '', 'el tercer vértice debe tener rumbo y distancia hacia el primero');
  near(parseFloat(tres[2][5]), Geo.distance(4.61, -74.09, 4.6, -74.1), 0.01);
  const dos = filas(Gis.toCSV([p('A', 4.6, -74.1), p('B', 4.6, -74.09)], { style: 'std' }));
  assert.ok(dos[0][5] !== ''); assert.equal(dos[1][4], ''); assert.equal(dos[1][5], '');
});

/* ---------- GPS ---------- */
test('sample: por defecto termina con 4 lecturas buenas, sin esperar todo el tiempo', async () => {
  let n = 0, timer, cb;
  const geo = { watchPosition(ok) { cb = ok; timer = setInterval(() => cb({ coords: { latitude: 4.6, longitude: -74.08, altitude: 2640, accuracy: 3, altitudeAccuracy: 5 }, timestamp: Date.now() }) || n++, 30); return 1; }, clearWatch() { clearInterval(timer); } };
  const t0 = Date.now();
  const r = await Gps.sample({ seconds: 5, geo });
  assert.equal(r.n, 4);
  assert.ok(Date.now() - t0 < 2000, 'no debía esperar los 5 s completos');
});

/* ---------- Ajustes guardados ---------- */
test('loadState: «sin límite» (0) y las demás precisiones válidas se conservan; una inválida vuelve al valor por defecto', () => {
  const con = (minAcc) => {
    const data = { 'zvg.v1.state': JSON.stringify({ projects: [{ id: 'a', name: 'x', points: [], climate: {} }], currentId: 'a', settings: { minAcc } }) };
    Store.setBackend({ getItem: (k) => (k in data ? data[k] : null), setItem() {} });
    return Store.loadState().settings.minAcc;
  };
  assert.equal(con(0), 0);
  [3, 5, 10, 20].forEach((m) => assert.equal(con(m), m));
  assert.equal(con(7), 10);
  assert.equal(con('mucho'), 10);
  Store.setBackend(null);
});

/* ---------- Copia de seguridad ---------- */
function copia(proj, memoria) {
  const b = Backup.create({ projects: [proj], currentId: proj.id, settings: { areaUnit: 'ha', minAcc: 5, csvStyle: 'es' } }, memoria || []);
  return JSON.parse(JSON.stringify(b));
}
const base = () => ({ id: 'p1', name: 'Finca', created: 1000, nextPoint: 2, mainColor: '#2F8F4E', climate: {}, layers: [],
  points: [{ id: 'a', name: 'P1', lat: 4.6, lon: -74.1, alt: -1000, altGps: null, altSrc: 'manual', acc: null, altAcc: null, src: 'manual', ts: 1 }] });

test('copia: la altitud vale justo en el límite (−1000 m) y no un poco más allá', () => {
  const ok = Backup.validate(copia(base()), { uid: () => 'u' });
  assert.equal(ok.data.projects[0].points[0].alt, -1000);
  const p = base(); p.points[0].alt = -1000.5;
  const mal = Backup.validate(copia(p), { uid: () => 'u' });
  assert.equal(mal.data.projects[0].points[0].alt, null);
  const q = base(); q.points[0].alt = 12000;
  assert.equal(Backup.validate(copia(q), { uid: () => 'u' }).data.projects[0].points[0].alt, 12000);
});

test('copia: solo los polígonos conservan agujeros', () => {
  const anillo = [{ lat: 4.6, lon: -74.1, alt: null }, { lat: 4.6, lon: -74.09, alt: null }, { lat: 4.61, lon: -74.09, alt: null }];
  const agujero = [[{ lat: 4.601, lon: -74.099, alt: null }, { lat: 4.601, lon: -74.098, alt: null }, { lat: 4.602, lon: -74.098, alt: null }]];
  const p = base();
  p.layers = [{ id: 'l1', name: 'Poligono', kind: 'polygon', color: '#E67E22', visible: true, points: anillo, holes: agujero, file: '', ts: 1 },
              { id: 'l2', name: 'Linea', kind: 'line', color: '#8E44AD', visible: true, points: anillo, holes: agujero, file: '', ts: 1 }];
  const r = Backup.validate(copia(p), { uid: () => 'u' });
  const [pol, lin] = r.data.projects[0].layers;
  assert.equal(pol.holes.length, 1);
  assert.equal(lin.holes, undefined);
});

test('restaurar sumando: datos de clima con la misma latitud pero otra longitud son lugares distintos', () => {
  const mem = (lon) => ({ lat: 4.6, lon, T: 14, P: 1000, src: 'internet' });
  const actual = { state: { projects: [base()], currentId: 'p1', settings: {} }, memory: [mem(-74.0)] };
  const r = Backup.validate(copia(base(), [mem(-75.0), mem(-74.0)]), { uid: () => 'u' });
  const res = Backup.apply(actual, r.data, 'merge', { uid: () => 'nuevo' });
  assert.equal(res.memory.length, 2);                                   // el repetido (-74.0) no se duplica; el otro sí se suma
  assert.deepEqual(res.memory.map((m) => m.lon).sort((a, b) => a - b), [-75, -74]);
});

/* ---------- Walter-Lieth ---------- */
test('dibujo: el eje de temperatura sube hasta la decena siguiente al máximo', () => {
  const T = new Array(12).fill(26), P = new Array(12).fill(52);
  const svg = WL.svg(WL.compute(T, P), {});
  assert.match(svg, />30<\/text>/);
});

test('rellenos: la lluvia cruza los 100 mm a mitad de camino entre 80 y 120 mm', () => {
  const T = new Array(12).fill(30), P = new Array(12).fill(120); P[0] = 80;
  const zonas = WL.regions(WL.compute(T, P));
  const pts = [].concat(...zonas.map((z) => z.pts));
  assert.ok(pts.some((q) => Math.abs(q.x - 0.5) < 1e-9 && Math.abs(q.y - 50) < 1e-9), 'debe haber un vértice en x = 0,5 y = 50');
});

/* ---------- Informe ---------- */
test('informe: «n puntos» de altitud solo si son 2 o más; zonas por punto solo si hay más de una distinta', () => {
  const proyecto = { name: 'F', points: [], layers: [] };
  const alt = (n) => ({ alt: { value: 2600, srcLabel: 'GPS', n }, climate: {}, result: null });
  assert.ok(!/1 puntos/.test(Report.rows(proyecto, alt(1))[0][1]));
  assert.match(Report.rows(proyecto, alt(2))[0][1], /2 puntos/);
  const zonas = (k) => ({ result: null, climate: {}, n: 0, warnings: [], vertexZones: [{ name: 'P1', alt: 2000, zone: 'bosque húmedo', symbol: 'bh-MB' }],
    distinctZones: new Array(k).fill({ symbol: 'x', name: 'x' }) });
  assert.doesNotMatch(Report.text(proyecto, zonas(1)), /Por altitud de cada punto/);
  assert.match(Report.text(proyecto, zonas(2)), /Por altitud de cada punto/);
  assert.doesNotMatch(Report.html(proyecto, zonas(1)), /Zonas según la altitud/);
  assert.match(Report.html(proyecto, zonas(2)), /Zonas según la altitud/);
});

test('informe: un proyecto sin nombre no escribe «null» ni «undefined»', () => {
  const a = { result: null, climate: {}, n: 0, warnings: [] };
  const html = Report.html({ name: null, points: [], layers: [] }, a);
  assert.match(html, /<title>Informe de zona de vida · <\/title>/);
  assert.doesNotMatch(html, /null|undefined/);
});

/* ---------- Archivos ---------- */
test('guardar sin indicar el tipo de archivo: usa texto plano', async () => {
  let blob = null;
  const doc = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  IO.setEnv({ document: doc, URL: { createObjectURL: (b) => { blob = b; return 'blob:x'; }, revokeObjectURL() {} }, navigator: {} });
  await IO.saveText('a.txt', undefined, 'hola');
  assert.equal(blob.type, 'text/plain');
  let compartido = null;
  IO.setEnv({ navigator: { canShare: () => true, share: async (d) => { compartido = d; } } });
  await IO.saveText('a.txt', undefined, 'hola');
  assert.equal(compartido.files[0].type, 'text/plain');
  IO.setEnv(null);
});

/* ---------- Diagrama: zoom ---------- */
function nodo() {
  const listeners = {};
  return { children: [], style: {}, attrs: {}, clientWidth: 400, clientHeight: 300, _html: '',
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    emit(t, ev) { (listeners[t] || []).forEach((f) => f(ev)); },
    setPointerCapture() {}, getBoundingClientRect() { return { left: 10, top: 20, width: 400, height: 300 }; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; } };
}
test('diagrama: la rueda acerca hacia el punto señalado (ese punto no se mueve)', () => {
  globalThis.document = { createElementNS: () => nodo() };
  const el = nodo();
  const view = Diagram.mount(el, {});
  const svg = el.children[0];
  view.fit();
  const sx = 200, sy = 150;                                       // posición dentro del dibujo (clientX = sx + left)
  const mundo = () => ({ x: (sx - view.state.tx) / view.state.s, y: (sy - view.state.ty) / view.state.s });
  const antes = mundo(), s0 = view.state.s;
  svg.emit('wheel', { pointerId: 1, clientX: sx + 10, clientY: sy + 20, deltaY: -100, preventDefault() {} });
  assert.ok(view.state.s > s0);
  const despues = mundo();
  near(despues.x, antes.x, 1e-6); near(despues.y, antes.y, 1e-6);
});

/* ---------- Más bordes (segunda vuelta de la prueba de fallos provocados) ---------- */
test('Holdridge: la lluvia extrema avisa que cae fuera del diagrama y la normal no', () => {
  assert.match(H.classify({ T: 24, P: 30000 }).warnings.join(' '), /fuera del diagrama/);
  assert.match(H.classify({ T: 10, P: 20000 }).warnings.join(' '), /fuera del diagrama/);
  assert.doesNotMatch(H.classify({ T: 24, P: 500 }).warnings.join(' '), /fuera del diagrama/);
  assert.doesNotMatch(H.classify({ T: 24, P: 50 }).warnings.join(' '), /fuera del diagrama/);
});

test('Walter-Lieth: las curvas avanzan de enero a diciembre sin devolverse al cruzar los 100 mm', () => {
  const T = new Array(12).fill(30), P = new Array(12).fill(120);
  P[0] = 80; P[5] = 60; P[6] = 140;                                // cruces de 100 mm entre ene-feb, may-jun y jun-jul
  const svg = WL.svg(WL.compute(T, P), {});
  const leer = (txt) => txt.split(' ').map((s) => s.split(',').map(Number));
  // Las dos curvas (lluvia primero, luego temperatura) son líneas abiertas: x solo puede crecer.
  const lineas = [...svg.matchAll(/<polyline points="([^"]+)"/g)].map((m) => leer(m[1]));
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].length, 12 + 3, 'la lluvia lleva un vértice extra en cada cruce de 100 mm');
  assert.equal(lineas[1].length, 12);
  lineas.forEach((l) => l.forEach((q, i) => { if (i) assert.ok(q[0] >= l[i - 1][0] - 1e-9, `x retrocede: ${l[i - 1][0]} → ${q[0]}`); }));
  // Los rellenos son polígonos cerrados (van y vuelven), pero nunca salen del tramo de enero a diciembre.
  const xMin = lineas[1][0][0], xMax = lineas[1][11][0];
  const rellenos = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => leer(m[1]));
  assert.ok(rellenos.length >= 3);
  rellenos.forEach((poly) => poly.forEach((q) => assert.ok(q[0] >= xMin - 1e-9 && q[0] <= xMax + 1e-9, `relleno fuera del rango: ${q[0]}`)));
});

test('XML: un texto nulo o indefinido se trata como vacío', () => {
  const Xml = require('../www/js/xml.js');
  assert.throws(() => Xml.parse(null), /no tiene elementos/);
  assert.throws(() => Xml.parse(undefined), /no tiene elementos/);
  assert.throws(() => Xml.parse(''), /no tiene elementos/);
});

/* ---------- Tercera vuelta: bordes que seguían sin probarse ---------- */
test('Holdridge: pasando el límite de humedad (r < -4) cae fuera del diagrama aunque su hexágono exista', () => {
  const dentro = H.classify({ T: 15, P: 13500 });
  assert.equal(dentro.inDiagram, true);
  assert.equal(dentro.warnings.some((w) => /fuera del diagrama/.test(w)), false);
  const fuera = H.classify({ T: 15, P: 14500 });
  assert.ok(fuera.point.r < -4);
  assert.equal(fuera.inDiagram, false);
  assert.ok(fuera.warnings.some((w) => /fuera del diagrama/.test(w)));
});

test('Fmt.area: los decimales cambian justo en 1 y en 100 de cada unidad', () => {
  const u = (o) => Object.assign({ ha: 5, m2: 5, km2: 5, fanegadas: 5 }, o);
  assert.equal(Fmt.area(u({ ha: 0.9999 }), 'ha'), '0,9999 ha');
  assert.equal(Fmt.area(u({ ha: 1 }), 'ha'), '1,00 ha');
  assert.equal(Fmt.area(u({ ha: 99.99 }), 'ha'), '99,99 ha');
  assert.equal(Fmt.area(u({ ha: 100 }), 'ha'), '100,0 ha');
  assert.equal(Fmt.area(u({ km2: 0.99 }), 'km2'), '0,9900 km²');
  assert.equal(Fmt.area(u({ km2: 1 }), 'km2'), '1,00 km²');
  assert.equal(Fmt.area(u({ fanegadas: 0.999 }), 'fanegadas'), '0,999 fanegadas');
  assert.equal(Fmt.area(u({ fanegadas: 1 }), 'fanegadas'), '1,00 fanegadas');
  assert.equal(Fmt.area(u({ fanegadas: 99.99 }), 'fanegadas'), '99,99 fanegadas');
  assert.equal(Fmt.area(u({ fanegadas: 100 }), 'fanegadas'), '100,0 fanegadas');
});

test('Walter-Lieth: la escala de lluvia llega hasta el mes más lluvioso (marcas de 200 y 300 mm)', () => {
  const T = new Array(12).fill(14), P = [40, 60, 120, 300, 280, 90, 50, 45, 70, 150, 260, 100];
  const marcas = [...WL.svg(WL.compute(T, P), {}).matchAll(/>(\d+)<\/text>/g)].map((m) => m[1]);
  ['100', '200', '300'].forEach((mm) => assert.ok(marcas.includes(mm), 'falta la marca de ' + mm + ' mm'));
  assert.ok(!marcas.includes('400'));
  const poca = [...WL.svg(WL.compute(T, new Array(12).fill(60)), {}).matchAll(/>(\d+)<\/text>/g)].map((m) => m[1]);
  assert.ok(!poca.includes('200'));
});

test('KML: gx:MultiTrack trae cada recorrido como una línea', () => {
  const k = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Ruta</name><gx:MultiTrack xmlns:gx="http://www.google.com/kml/ext/2.2">' +
    '<gx:Track><gx:coord>-74.1 4.6 2500</gx:coord><gx:coord>-74.0 4.6</gx:coord></gx:Track>' +
    '<gx:Track><gx:coord>-73.9 4.5</gx:coord><gx:coord>-73.8 4.5</gx:coord></gx:Track></gx:MultiTrack></Placemark></kml>';
  const r = Gis.parseText(k);
  assert.equal(r.features.length, 2);
  r.features.forEach((f) => { assert.equal(f.type, 'line'); assert.equal(f.coords.length, 2); });
  assert.equal(r.features[1].coords[0].lon, -73.9);
});

'use strict';
/* 2.15.0 — varios lotes por proyecto: cómo se guardan, la copia de seguridad, el reporte de todo el proyecto, el CSV, el Shapefile y el mapa. */
const test = require('node:test');
const assert = require('node:assert');
const Store = require('../www/js/store.js');
const Fotos = require('../www/js/fotos.js');
const Backup = require('../www/js/backup.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Analysis = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const Gis = require('../www/js/gis.js');
const Shp = require('../www/js/shp.js');
const Mapa = require('../www/js/mapa.js');
const Geo = require('../www/js/geo.js');

function backend() {
  const mem = {};
  Store.setBackend({ getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } });
  return mem;
}
const A = [{ id: 'a1', name: 'P1', lat: 4.60, lon: -74.08, alt: 2600 }, { id: 'a2', name: 'P2', lat: 4.60, lon: -74.07, alt: 2650 }, { id: 'a3', name: 'P3', lat: 4.61, lon: -74.075, alt: 2700 }];
const B = [{ id: 'b1', name: 'P1', lat: 4.62, lon: -74.08, alt: 1800 }, { id: 'b2', name: 'P2', lat: 4.62, lon: -74.07, alt: 1810 }, { id: 'b3', name: 'P3', lat: 4.63, lon: -74.075, alt: 1830 }, { id: 'b4', name: 'P4', lat: 4.63, lon: -74.08, alt: 1820 }];

/* ---------- Guardado ---------- */
test('lotes: un proyecto nuevo trae un «Lote 1» y sus atajos leen y escriben en el lote elegido', () => {
  backend();
  const p = Store.newProject('Finca');
  assert.equal(p.lots.length, 1); assert.equal(p.lots[0].name, 'Predio'); assert.equal(p.lots[0].kind, 'finca'); assert.equal(p.lotId, p.lots[0].id);
  assert.deepEqual(p.points, []); assert.equal(p.nextPoint, 1); assert.equal(p.mainColor, Store.MAIN_COLOR); assert.deepEqual(p.climate, {});
  p.points = A.slice(); p.nextPoint = 4; p.climate.pManual = 1200; p.mainColor = '#8E44AD'; p.weatherNow = { T: 20 };
  assert.equal(p.lots[0].points.length, 3); assert.equal(p.lots[0].nextPoint, 4); assert.equal(p.lots[0].climate.pManual, 1200);
  assert.equal(p.lots[0].mainColor, '#8E44AD'); assert.deepEqual(p.lots[0].weatherNow, { T: 20 });
  p.weatherNow = undefined;                                       // así se quita el clima actual
  assert.equal('weatherNow' in p.lots[0], false);
  // otro lote: los atajos pasan a ser los suyos y el primero no cambia
  const l2 = Store.newLot('Cafetal', '#E67E22');
  p.lots.push(l2); p.lotId = l2.id;
  assert.deepEqual(p.points, []); assert.equal(p.mainColor, '#E67E22');
  p.points = B.slice();
  assert.equal(p.lots[0].points.length, 3); assert.equal(p.lots[1].points.length, 4);
  assert.equal(Store.activeLot(p), l2);
  p.lotId = 'no-existe';
  assert.equal(Store.activeLot(p), p.lots[0], 'un lote elegido que no existe cae en el primero');
});

test('lotes: al guardar solo va la lista de lotes (los atajos no se guardan dos veces) y al abrir se recupera igual', () => {
  const mem = backend();
  const st = Store.defaultState(), p = st.projects[0];
  p.points = A.slice(); p.climate = { pManual: 900 };
  p.lots.push(Object.assign(Store.newLot('Dos', '#2980B9'), { points: B.slice(), nextPoint: 5 }));
  p.lotId = p.lots[1].id;
  Store.saveState(st);
  const raw = JSON.parse(mem['zvg.v1.state']).projects[0];
  assert.deepEqual(Object.keys(raw).sort(), ['created', 'id', 'layers', 'lotId', 'lots', 'name']);
  assert.equal(raw.lots.length, 2);
  const again = Store.loadState().projects[0];
  assert.equal(again.lotId, p.lots[1].id); assert.equal(again.points.length, 4); assert.equal(again.nextPoint, 5);
  assert.equal(again.lots[0].climate.pManual, 900); assert.equal(again.lots[0].points.length, 3);
  assert.equal(Store.lotify(again), again, 'poner los atajos dos veces no hace nada');
  assert.equal(again.points.length, 4);
});

test('lotes: un proyecto de una versión anterior pasa a tener un «Lote 1» con todo lo que tenía', () => {
  const mem = backend();
  mem['zvg.v1.state'] = JSON.stringify({ v: 1, currentId: 'p1', settings: {}, projects: [
    { id: 'p1', name: 'Viejo', created: 5, points: A, climate: { tManual: 18 }, nextPoint: 9, layers: [{ id: 'c', name: 'Capa', points: [] }], mainColor: '#C0392B', weatherNow: { T: 21 } },
    { id: 'p2', name: 'Roto', points: 'x', climate: null, mainColor: 'rojo', weatherNow: 7 }, 'basura', null] });
  const s = Store.loadState();
  assert.equal(s.projects.length, 2);
  const p = s.projects[0];
  assert.equal(p.lots.length, 1); assert.equal(p.lots[0].id, 'p1-l1'); assert.equal(p.lots[0].name, 'Predio'); assert.equal(p.lots[0].kind, 'finca');      // 2.22.0: el único polígono pasa a ser el predio
  assert.equal(p.points.length, 3); assert.equal(p.climate.tManual, 18); assert.equal(p.nextPoint, 9); assert.equal(p.mainColor, '#C0392B'); assert.deepEqual(p.weatherNow, { T: 21 });
  assert.equal(p.layers.length, 1); assert.equal(p.name, 'Viejo');
  const q = s.projects[1];
  assert.deepEqual(q.points, []); assert.deepEqual(q.climate, {}); assert.equal(q.mainColor, Store.MAIN_COLOR); assert.equal(q.weatherNow, undefined); assert.equal(q.nextPoint, 1);
  // y lo que se guarda después ya no trae los datos arriba
  Store.saveState(s);
  assert.equal('points' in JSON.parse(mem['zvg.v1.state']).projects[0], false);
});

test('lotes: toLots limpia nombres, colores, ids repetidos y corta en el máximo', () => {
  const p = Store.toLots({ id: 'x', lotId: 'b', lots: [{ id: 'a', name: '  Uno\n dos ', mainColor: 'azul', points: null }, { id: 'a', name: '', points: A }, 5, null, { id: 'b', name: 'z'.repeat(90) }] });
  assert.equal(p.lots.length, 3);
  assert.equal(p.lots[0].name, 'Uno dos'); assert.equal(p.lots[0].mainColor, Store.MAIN_COLOR); assert.deepEqual(p.lots[0].points, []);
  assert.equal(p.lots[1].name, 'Lote 2'); assert.notEqual(p.lots[1].id, 'a', 'un id repetido se cambia'); assert.equal(p.lots[1].nextPoint, 4);
  assert.equal(p.lots[2].name.length, Store.LOT_NAME_MAX); assert.equal(p.lotId, 'b');
  const many = Store.toLots({ id: 'm', lots: Array.from({ length: 50 }, (_, i) => ({ id: 'l' + i })) });
  assert.equal(many.lots.length, Store.LOT_MAX); assert.equal(many.lotId, 'l0');
  assert.equal(Store.toLots({ id: 'v', lots: [] }).lots[0].id, 'v-l1', 'una lista vacía se trata como proyecto sin lotes');
  assert.equal(Store.lotName('', 2), 'Lote 3'); assert.equal(Store.newLot('', 'x').mainColor, Store.MAIN_COLOR);
});

test('fotos: las de todos los lotes cuentan como usadas', () => {
  const id1 = Fotos.newId(), id2 = Fotos.newId();
  const p = Store.newProject('F');
  p.points = [{ lat: 1, lon: 1, photos: [{ id: id1 }] }];
  p.lots.push(Object.assign(Store.newLot('Dos'), { points: [{ lat: 2, lon: 2, photos: [{ id: id2 }, { id: id1 }] }] }));
  assert.deepEqual(Fotos.usedIds([p]).sort(), [id1, id2].sort());
  assert.deepEqual(Fotos.usedIds([JSON.parse(JSON.stringify(p))]).sort(), [id1, id2].sort(), 'también con el proyecto tal como se guarda');
  assert.deepEqual(Fotos.usedIds([{ points: [{ photos: [{ id: id1 }] }] }]), [id1], 'y con la forma anterior');
});

/* ---------- Copia de seguridad ---------- */
test('copia de seguridad: los lotes van y vuelven completos; una copia anterior sigue sirviendo', () => {
  backend();
  const st = Store.defaultState(), p = st.projects[0];
  const T = (x) => Object.assign({ ts: 1700000000000 }, x);          // con fecha, como los guarda la app
  p.name = 'Florecer'; p.points = A.map(T); p.climate = { pManual: 1500 };
  const l2 = Object.assign(Store.newLot('Cafetal <b>', '#E67E22'), { points: B.map(T), nextPoint: 5, climate: { tManual: 19 } });
  p.lots.push(l2); p.lotId = l2.id;
  const b = Backup.create(st, [], { now: 0 });
  assert.equal(b.summary.points, 7); assert.equal(b.state.projects[0].lots.length, 2); assert.equal('points' in b.state.projects[0], false);
  const v = Backup.validate(JSON.parse(Backup.stringify(b)), { uid: Store.uid });
  assert.deepEqual(v.errors, []);
  const q = v.data.projects[0];
  assert.equal(q.lots.length, 2); assert.equal(q.lotId, l2.id); assert.equal(q.lots[1].name, 'Cafetal <b>'); assert.equal(q.lots[1].mainColor, '#E67E22');
  assert.equal(q.lots[0].points.length, 3); assert.equal(q.lots[1].points.length, 4); assert.equal(q.lots[1].climate.tManual, 19); assert.equal(q.lots[0].climate.pManual, 1500);
  assert.equal(v.summary.points, 7); assert.equal('points' in q, false);
  // restaurar dos veces la misma copia no duplica el proyecto (así se comparan en la app: lo guardado contra lo que trae la copia)
  const first = Backup.apply({ state: JSON.parse(JSON.stringify(Store.defaultState())), memory: [] }, v.data, 'replace', { uid: Store.uid });
  const live = { projects: first.state.projects.map(Store.lotify), currentId: first.state.currentId, settings: first.state.settings };
  const v2 = Backup.validate(JSON.parse(Backup.stringify(b)), { uid: Store.uid });
  const r = Backup.apply({ state: JSON.parse(JSON.stringify(live)), memory: [] }, v2.data, 'merge', { uid: Store.uid });
  assert.equal(r.state.projects.length, 1); assert.equal(r.added, 0);
  // una copia anterior a la 2.15.0 (sin lotes) se lee igual que antes y luego pasa a un lote
  const old = Backup.validate({ app: Backup.APP, format: Backup.FORMAT, state: { projects: [{ id: 'v1', name: 'Viejo', points: A, climate: {}, layers: [] }], currentId: 'v1', settings: {} }, memory: [] }, { uid: Store.uid });
  assert.deepEqual(old.errors, []);
  assert.equal(old.data.projects[0].points.length, 3); assert.equal('lots' in old.data.projects[0], false);
  const conv = Store.toLots(old.data.projects[0]);
  assert.equal(conv.lots[0].id, 'v1-l1'); assert.equal(conv.lots[0].points.length, 3);
});

test('copia de seguridad: lotes dañados o con trampa no entran tal cual', () => {
  const lots = [null, 'x', { id: '<script>', name: '=cmd', points: [{ lat: 99, lon: 0 }, { lat: 4, lon: -74 }], mainColor: 'javascript:1', climate: { pManual: -5 }, weatherNow: 'x' }, { id: 'ok', name: 'Bueno', points: [] }, { id: 'ok', points: [] }];
  const v = Backup.validate({ app: Backup.APP, format: Backup.FORMAT, state: { projects: [{ id: 'p', name: 'P', lots: lots, lotId: 'ok' }], currentId: 'p', settings: {} }, memory: [] }, { uid: () => 'u' + Math.random().toString(36).slice(2) });
  assert.deepEqual(v.errors, []);
  const q = v.data.projects[0];
  assert.equal(q.lots.length, 3);
  assert.match(q.lots[0].id, /^u/); assert.equal(q.lots[0].points.length, 1); assert.equal(q.lots[0].mainColor, Gis.MAIN_COLOR); assert.deepEqual(q.lots[0].climate, {}); assert.equal('weatherNow' in q.lots[0], false);
  assert.equal(q.lots[1].id, 'ok'); assert.notEqual(q.lots[2].id, 'ok'); assert.equal(q.lots[2].name, 'Lote 5');
  assert.equal(q.lotId, 'ok');
  // sin ningún lote legible queda uno vacío; con demasiados se cortan
  const none = Backup.validate({ app: Backup.APP, format: Backup.FORMAT, state: { projects: [{ id: 'p', name: 'P', lots: [1, 2] }], currentId: 'p', settings: {} }, memory: [] }, { uid: Store.uid });
  assert.equal(none.data.projects[0].lots.length, 1); assert.deepEqual(none.data.projects[0].lots[0].points, []);
  const many = Backup.validate({ app: Backup.APP, format: Backup.FORMAT, state: { projects: [{ id: 'p', name: 'P', lots: Array.from({ length: 80 }, () => ({ points: [] })) }], currentId: 'p', settings: {} }, memory: [] }, { uid: Store.uid });
  assert.equal(many.data.projects[0].lots.length, Backup.LIMITS.lots);
});

/* ---------- Reporte de todo el proyecto ---------- */
function part(name, lotName, points, climate, color) {
  const project = { name, lotName, points, climate, layers: [], mainColor: color };
  return { project, a: Analysis.analyze({ points, climate }, { memory: new Climate.Memory() }), o: { date: Date.UTC(2026, 10, 12, 15) } };
}
const PARTS = () => [part('Florecer', 'Lote 1', A, { pManual: 1500 }, '#2F8F4E'), part('Florecer', 'Cafetal <b>', B, { pManual: 1500 }, '#E67E22'), part('Florecer', 'Vacío', [{ name: 'P1', lat: 4.7, lon: -74 }], {}, 'x')];

test('reporte: el encabezado de un lote dice cuál es', () => {
  assert.deepEqual(Report.headLines({ name: 'Florecer', lotName: 'Lote 2' }, { date: Date.UTC(2026, 0, 2, 15) }), ['Proyecto: Florecer', 'Lote: Lote 2', 'Fecha: 2 de enero de 2026']);
  assert.equal(Report.headLines({ name: 'F', lotName: '  ' }, {}).length, 2);
  const pt = PARTS()[1];
  assert.match(Report.html(pt.project, pt.a, pt.o), /Lote: Cafetal &lt;b&gt;/);
  assert.match(Report.html(Object.assign({}, pt.project, { layers: [{ id: 'l', name: 'Lote 1', kind: 'polygon', color: '#2F8F4E', visible: true, points: A }] }), pt.a, pt.o), />Cafetal &lt;b&gt;</, 'la leyenda nombra el lote en vez de «Mis puntos»');
});

test('reporte de todo el proyecto: resumen con áreas, zonas y total', () => {
  const s = Report.summary(PARTS());
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.rows.map((r) => r.name), ['Lote 1', 'Cafetal <b>', 'Vacío']);
  assert.match(s.rows[0].area, /^61,\d\d ha$/); assert.equal(s.rows[0].alt, '2650 m'); assert.match(s.rows[0].zone, /\(.+\)$/);
  assert.equal(s.rows[2].area, '—'); assert.equal(s.rows[2].alt, '—'); assert.equal(s.rows[2].zone, 'incompleto'); assert.equal(s.rows[2].color, '#2F8F4E');
  assert.equal(s.closed, 2);
  assert.ok(Math.abs(s.total - (Geo.polygonArea(A) + Geo.polygonArea(B))) < 0.01);
  assert.match(s.totalText, /^\d+,\d+ ha · \d+,\d+ fanegadas$/);
  assert.match(s.note, /^3 lotes \(2 con polígono cerrado\) · [12] zonas? de vida$/);
  assert.equal(Report.summary([]).totalText, '—');
  assert.equal(Report.summary(null).rows.length, 0);
  assert.match(Report.summary([PARTS()[0]]).note, /^1 lote · 1 zona de vida$/);
});

test('reporte de todo el proyecto (HTML): resumen primero, luego cada lote, sin nombres internos repetidos', () => {
  const h = Report.htmlAll({ name: 'Florecer' }, PARTS(), { author: { name: 'Ana' } });
  assert.match(h, /^<!doctype html>/);
  const iSum = h.indexOf('Resumen del proyecto'), i1 = h.indexOf('<h1 class="lt">Lote: Lote 1</h1>'), i2 = h.indexOf('<h1 class="lt">Lote: Cafetal &lt;b&gt;</h1>'), i3 = h.indexOf('<h1 class="lt">Lote: Vacío</h1>');
  assert.ok(iSum > 0 && i1 > iSum && i2 > i1 && i3 > i2, 'orden');
  assert.equal(h.split('<header class="head">').length - 1, 1, 'un solo encabezado');
  assert.match(h, /Proyecto: Florecer<\/p><p class="sub hl">Elaborado por: Ana/);
  assert.doesNotMatch(h.slice(0, i1), /class="sub hl">Lote:/);
  assert.match(h, /<tr class="tot"><td>Total<\/td><td>\d+,\d+ ha · /);
  assert.equal(h.split('Clasificación bioclimática orientativa').length - 1, 1, 'la advertencia va una sola vez');
  assert.equal(h.split('<h2>Datos del clima</h2>').length - 1, 3);
  // ningún id repetido en toda la página
  const ids = (h.match(/\bid="[^"]+"/g) || []);
  assert.ok(ids.length >= 2, 'hay dibujos con nombre interno: ' + ids.length);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  assert.match(h, /id="perfil-reporte-fill-L1"/); assert.match(h, /url\(#perfil-reporte-fill-L2\)/);
  assert.equal(Report.reid('<a id="x" href="#x" fill="url(#x)">', '-9'), '<a id="x-9" href="#x-9" fill="url(#x-9)">');
});

test('reporte de todo el proyecto (texto y PDF)', () => {
  const parts = PARTS();
  const t = Report.textAll({ name: 'Florecer' }, parts, {}).split('\n');
  assert.equal(t[0], 'REPORTE DE ZONA DE VIDA (HOLDRIDGE)'); assert.equal(t[1], 'Proyecto: Florecer');
  assert.ok(t.includes('RESUMEN DEL PROYECTO'));
  assert.ok(t.some((l) => /^ {2}Lote 1: 61,\d\d ha · 2650 m · /.test(l)));
  assert.ok(t.some((l) => /^ {2}Total: /.test(l)));
  assert.equal(t.filter((l) => /^———  LOTE: /.test(l)).length, 3);
  assert.equal(t.filter((l) => l === 'REPORTE DE ZONA DE VIDA (HOLDRIDGE)').length, 1);
  assert.equal(t.filter((l) => /^Clasificación bioclimática orientativa/.test(l)).length, 1);
  assert.equal(t.filter((l) => /^Puntos:/.test(l)).length, 3);
  // PDF
  const sk = ReportPdf.sketchesAll(parts);
  assert.ok(sk.some((s) => s.key === '1:croquis') && sk.some((s) => s.key === '2:perfil') && sk.some((s) => s.key === '2:holdridge'));
  assert.ok(!sk.some((s) => /^3:croquis/.test(s.key)), 'un lote con un punto no tiene croquis');
  const img = { bytes: Fotos.fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==') };
  const bl = ReportPdf.blocksAll({ name: 'Florecer' }, parts, {}, { '1:croquis': img });
  assert.equal(bl[0].t, 'head'); assert.deepEqual(bl[0].lines.slice(0, 1), ['Proyecto: Florecer']);
  assert.equal(bl[1].text, 'Resumen del proyecto');
  assert.equal(bl[2].rows.length, 4); assert.equal(bl[2].rows[3][0], 'Total'); assert.equal(bl[2].rows[1][2], '#E67E22');
  assert.equal(bl.filter((b) => b.t === 'head').length, 1);
  bl.forEach((b, i) => { if (b.t === 'h1') assert.equal(bl[i - 1].t, 'pagebreak', 'cada lote empieza en hoja nueva'); });
  assert.deepEqual(bl.filter((b) => b.t === 'h1').map((b) => b.text), ['Lote: Lote 1', 'Lote: Cafetal <b>', 'Lote: Vacío']);
  assert.equal(bl.filter((b) => b.t === 'p' && b.text === Report.DISCLAIMER).length, 1);
  // la imagen del croquis del lote 1 entra; la del lote 2 (que no llegó) queda como aviso
  assert.equal(bl.filter((b) => b.t === 'image' && b.img === img).length, 1);
  assert.ok(bl.some((b) => b.t === 'note' && /No se pudo dibujar el croquis/.test(b.text)));
  const pdf = ReportPdf.buildAll({ name: 'Florecer' }, parts, {}, {});
  assert.equal(new TextDecoder('latin1').decode(pdf.subarray(0, 5)), '%PDF-');
  // el reporte de un solo lote sigue llevando su encabezado y su advertencia
  const one = ReportPdf.blocks(parts[0].project, parts[0].a, parts[0].o, {});
  assert.equal(one[0].t, 'head'); assert.ok(one[0].lines.includes('Lote: Lote 1')); assert.equal(one[one.length - 1].text, Report.DISCLAIMER);
});

/* ---------- Exportar ---------- */
test('CSV con varios lotes: columna «Lote» y rumbo y distancia dentro de cada lote', () => {
  const csv = Gis.toCSV(null, { style: 'std', lots: [{ name: 'Lote 1', points: A }, { name: '=Cafetal, sur', points: B }, { name: 'Vacío', points: [] }] }).slice(1).split('\r\n');
  assert.equal(csv[0], 'Lote,Punto,Latitud,Longitud,Altitud,Rumbo,Distancia al vértice siguiente,Este (Origen Nacional),Norte (Origen Nacional)');
  assert.equal(csv.length, 1 + 3 + 4 + 1);
  assert.match(csv[1], /^Lote 1,P1,4\.6000000,-74\.0800000,2600\.0,/);
  // el último punto del lote 1 cierra con el primero del lote 1 (no con el siguiente lote)
  const d3 = parseFloat(csv[3].split(',')[6]);
  assert.ok(Math.abs(d3 - Geo.distance(4.61, -74.075, 4.60, -74.08)) < 0.01, d3);
  assert.match(csv[4], /^"'=Cafetal, sur",P1,/, 'el nombre del lote también se protege de fórmulas');
  // sin lotes queda igual que antes
  assert.equal(Gis.toCSV(A, { style: 'std' }).slice(1).split('\r\n')[0].split(',')[0], 'Punto');
  assert.match(Gis.toCSV(null, { lots: [{ points: A }] }).slice(1).split('\r\n')[1], /^Lote 1;P1;/);
});

test('Shapefile con varios lotes: una figura por lote y la columna LOTE', () => {
  const f = Object.fromEntries(Shp.files({ name: 'Florecer', base: 'f', lots: [{ name: 'Lote 1', points: A }, { name: 'Cafetal ñ', points: B }, { name: 'Dos', points: B.slice(0, 2) }, { name: 'Nada', points: [] }] }).map((x) => [x.name, x.bytes]));
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  // puntos: 3 + 4 + 2
  assert.equal(dv(f['f_puntos.dbf']).getUint32(4, true), 9);
  assert.equal((f['f_puntos.shx'].length - 100) / 8, 9);
  // polígonos: solo los dos lotes cerrados
  assert.equal(dv(f['f_poligono.dbf']).getUint32(4, true), 2);
  assert.equal((f['f_poligono.shx'].length - 100) / 8, 2);
  const txt = new TextDecoder().decode(f['f_poligono.dbf']);
  assert.match(txt, /LOTE/); assert.match(txt, /Cafetal ñ/); assert.match(txt, /Florecer/);
  assert.match(new TextDecoder().decode(f['f_puntos.dbf']), /Dos/);
  // el índice del segundo polígono apunta a su registro
  const shp = f['f_poligono.shp'], off2 = dv(f['f_poligono.shx']).getInt32(108, false) * 2;
  assert.equal(dv(shp).getInt32(off2, false), 2); assert.equal(dv(shp).getInt32(off2 + 8, true), 5);
  assert.equal(dv(shp).getInt32(off2 + 8 + 40, true), 5, 'cuatro vértices más el de cierre');
  assert.equal(dv(shp).getInt32(24, false) * 2, shp.length);
  // sin lotes queda como antes (sin columna LOTE)
  assert.doesNotMatch(new TextDecoder().decode(Shp.files({ base: 'x', points: A })[2].bytes), /LOTE/);
  assert.throws(() => Shp.files({ lots: [{ name: 'a', points: [] }] }), /No hay puntos/);
});

/* ---------- Mapa ---------- */
test('mapa: los otros lotes llevan su nombre y su área, y un toque dentro de uno dice cuál es', () => {
  const layers = [{ id: 'capa', name: 'Importada', kind: 'polygon', color: '#111111', visible: true, points: A },
    { id: 'lote-2', lotId: 'L2', lot: true, name: 'Cafetal', kind: 'polygon', color: '#E67E22', visible: true, points: B, areaText: '12,3 ha' },
    { id: 'lote-3', lotId: 'L3', lot: true, name: 'Dos', kind: 'line', color: '#8E44AD', visible: true, points: B.slice(0, 2) }];
  const sh = Mapa.shapes({ points: [], layers }, {});
  assert.equal(sh.layers[0].lot, undefined);
  assert.equal(sh.layers[1].lot, true); assert.equal(sh.layers[1].lotId, 'L2'); assert.equal(sh.layers[1].label, 'Cafetal · 12,3 ha');
  assert.ok(Math.abs(sh.layers[1].at[0] - 4.625) < 1e-9 && Math.abs(sh.layers[1].at[1] - (-74.07625)) < 1e-9);
  assert.equal(sh.layers[2].label, 'Dos');
  assert.equal(Mapa.lotAt({ lat: 4.625, lon: -74.076 }, layers), 'L2');
  assert.equal(Mapa.lotAt({ lat: 4.605, lon: -74.075 }, layers), null, 'una capa importada no es un lote');
  assert.equal(Mapa.lotAt({ lat: 4.62, lon: -74.075 }, [layers[2]]), null, 'un lote sin polígono no se elige tocando');
  assert.equal(Mapa.lotAt({ lat: 5, lon: -74 }, layers), null);
  assert.equal(Mapa.lotAt(null, layers), null); assert.equal(Mapa.lotAt({ lat: 'x', lon: 1 }, layers), null); assert.equal(Mapa.lotAt({ lat: 4.625, lon: -74.076 }, null), null);
});

/* ---------- Croquis general del resumen ---------- */
test('croquis general: todos los lotes en un dibujo, cada uno con su color; sin lotes dibujables no hay', () => {
  const ov = Report.overview(PARTS());
  assert.deepEqual(ov.items, [['#2F8F4E', 'Lote 1'], ['#E67E22', 'Cafetal <b>'], ['#2F8F4E', 'Vacío']]);     // un color inválido pasa al verde de siempre
  assert.match(ov.svg, /^<svg/);
  assert.ok(ov.svg.indexOf('#E67E22') > 0, 'el segundo lote va con su color');
  assert.equal(Report.overview([part('F', 'Solo', [{ name: 'P1', lat: 4, lon: -74 }], {}, '#123456')]), null);
  assert.equal(Report.overview([]), null); assert.equal(Report.overview(null), null);
  // un lote sin puntos no entra; uno de 2 puntos va como línea
  const two = Report.overview([part('F', 'Sin puntos', [], {}, '#111111'), part('F', 'Línea', A.slice(0, 2), {}, '#222222')]);
  assert.deepEqual(two.items, [['#222222', 'Línea']]);
  const h = Report.htmlAll({ name: 'Florecer' }, PARTS(), {});
  assert.ok(h.indexOf('<h2>Croquis general</h2>') > h.indexOf('<h2>Resumen del proyecto</h2>') && h.indexOf('<h2>Croquis general</h2>') < h.indexOf('<h1 class="lt">'));
  assert.match(h, /<div class="legend"><span><span class="dot" style="background:#2F8F4E"><\/span>Lote 1<\/span> <span><span class="dot" style="background:#E67E22"><\/span>Cafetal &lt;b&gt;<\/span>/);
  const ids = h.match(/\bid="[^"]+"/g) || [];
  assert.equal(new Set(ids).size, ids.length);
  // PDF: la gráfica general se pide con la clave «0:general» y, si llega, va con su leyenda; si no, avisa
  assert.equal(ReportPdf.sketchesAll(PARTS())[0].key, '0:general');
  const sin = ReportPdf.blocksAll({ name: 'Florecer' }, PARTS(), {}, {});
  assert.ok(sin.some((b) => b.t === 'note' && /croquis general/.test(b.text)));
  const con = ReportPdf.blocksAll({ name: 'Florecer' }, PARTS(), {}, { '0:general': { bytes: new Uint8Array([0xFF, 0xD8, 0xFF]), w: 10, h: 10 } });
  const i = con.findIndex((b) => b.t === 'h2' && b.text === 'Croquis general');
  assert.equal(con[i + 1].t, 'image'); assert.equal(con[i + 2].t, 'legend'); assert.equal(con[i + 2].items.length, 3);
  assert.equal(ReportPdf.sketchesAll([part('F', 'Solo', [{ name: 'P1', lat: 4, lon: -74 }], {}, '#123456')]).some((s) => s.key === '0:general'), false);
});

test('copia de seguridad: el formato sube a 2; una copia de formato 1 (sin lotes) se sigue leyendo y una de formato 3 se rechaza', () => {
  assert.equal(Backup.FORMAT, 2);
  const vieja = Backup.validate({ app: Backup.APP, format: 1, state: { projects: [{ id: 'p', name: 'P', points: [{ lat: 4, lon: -74 }], climate: { pManual: 900 } }], currentId: 'p', settings: {} }, memory: [] }, { uid: Store.uid });
  assert.deepEqual(vieja.errors, []);
  assert.equal(vieja.data.projects[0].points.length, 1); assert.equal(vieja.data.projects[0].climate.pManual, 900);
  const l = Store.toLots(vieja.data.projects[0]).lots;
  assert.equal(l.length, 1); assert.equal(l[0].id, 'p-l1'); assert.equal(l[0].points.length, 1);
  const nueva = Backup.validate({ app: Backup.APP, format: 3, state: { projects: [{ id: 'p', name: 'P', lots: [] }] } }, { uid: Store.uid });
  assert.match(nueva.errors[0], /versión más nueva/);
});

/* ---------- Lotes que se montan uno sobre otro (2.15.1) ---------- */
// Cuadrado de `lado` metros con la esquina suroeste a (x, y) metros de un origen cerca de Bogotá
function sq(x, y, lado) {
  const fr = Geo.localFrame([{ lat: 4.6, lon: -74.08 }]);
  return [[x, y], [x + lado, y], [x + lado, y + lado], [x, y + lado]].map(([a, b]) => Geo.fromXY(fr, { x: a, y: b }));
}
test('montaje: detecta lotes que comparten superficie y no confunde los que solo comparten un lindero', () => {
  const base = sq(0, 0, 100);
  const si = [['se cruzan', sq(50, 50, 100)], ['uno dentro de otro', sq(20, 20, 30)], ['iguales', sq(0, 0, 100)], ['el otro lo contiene', sq(-50, -50, 300)],
    ['montado 2 m', sq(98, 0, 100)], ['en cruz, sin vértices dentro', [[-50, 40], [150, 40], [150, 60], [-50, 60]].map(([a, b]) => Geo.fromXY(Geo.localFrame([{ lat: 4.6, lon: -74.08 }]), { x: a, y: b }))]];
  for (const [n, o] of si) { assert.equal(Geo.polygonsOverlap(base, o), true, n); assert.equal(Geo.polygonsOverlap(o, base), true, n + ' (al revés)'); }
  const no = [['lindero compartido', sq(100, 0, 100)], ['solo una esquina', sq(100, 100, 50)], ['separados', sq(300, 0, 100)], ['lindero con 30 cm de error del GPS', sq(99.7, 0, 100)],
    ['lindero compartido más corto', sq(100, 20, 40)], ['menos de 3 puntos', sq(10, 10, 20).slice(0, 2)], ['nada', null]];
  for (const [n, o] of no) { assert.equal(Geo.polygonsOverlap(base, o), false, n); assert.equal(Geo.polygonsOverlap(o, base), false, n + ' (al revés)'); }
  // en sentido contrario de marcado da lo mismo
  assert.equal(Geo.polygonsOverlap(base.slice().reverse(), sq(50, 50, 100)), true);
  assert.equal(Geo.polygonsOverlap(base.slice().reverse(), sq(100, 0, 100).reverse()), false);
});

test('montaje: parejas y aviso; aparece en el resumen del reporte (HTML, texto y PDF) y no aparece si no hay', () => {
  const lots = [{ name: 'A', points: sq(0, 0, 100) }, { name: 'B <b>', points: sq(50, 50, 100) }, { name: 'C', points: sq(400, 0, 50) }, { name: 'D', points: sq(120, 120, 10) }, { name: 'vacío', points: [] }];
  assert.deepEqual(Geo.overlaps(lots), [[0, 1], [1, 3]]);
  assert.equal(Geo.overlapText(lots), 'Hay lotes que se montan uno sobre otro: «A» y «B <b>»; «B <b>» y «D». Revisa los linderos: el total del proyecto cuenta esa parte dos veces.');
  assert.equal(Geo.overlapText([lots[0], lots[2]]), ''); assert.equal(Geo.overlapText([]), ''); assert.equal(Geo.overlapText(null), '');
  assert.deepEqual(Geo.overlaps([lots[0], null, undefined, lots[1]]), [[0, 3]]);
  const cinco = [0, 1, 2, 3, 4].map((i) => ({ name: 'L' + i, points: sq(i * 10, 0, 100) }));
  assert.match(Geo.overlapText(cinco), /«L0» y «L1»; «L0» y «L2»; «L0» y «L3» y 7 más\./);
  const pts = (q) => q.map((p, i) => ({ name: 'P' + (i + 1), lat: p.lat, lon: p.lon, alt: 1000 }));
  const parts = [part('F', 'A', pts(sq(0, 0, 100)), { pManual: 1200 }, '#2F8F4E'), part('F', 'B <b>', pts(sq(50, 50, 100)), { pManual: 1200 }, '#E67E22')];
  assert.match(Report.summary(parts).overlap, /^Hay lotes que se montan/);
  const h = Report.htmlAll({ name: 'F' }, parts, {});
  assert.match(h, /<p class="small"><b>Atención:<\/b> Hay lotes que se montan uno sobre otro: «A» y «B &lt;b&gt;»\./);
  assert.match(Report.textAll({ name: 'F' }, parts, {}), /\n  Atención: Hay lotes que se montan uno sobre otro: «A» y «B <b>»\./);
  assert.ok(ReportPdf.blocksAll({ name: 'F' }, parts, {}, {}).some((b) => b.t === 'note' && /^Atención: Hay lotes que se montan/.test(b.text)));
  const bien = PARTS();
  assert.equal(Report.summary(bien).overlap, '');
  assert.doesNotMatch(Report.htmlAll({ name: 'F' }, bien, {}), /Atención/);
  assert.doesNotMatch(Report.textAll({ name: 'F' }, bien, {}), /Atención/);
  assert.ok(!ReportPdf.blocksAll({ name: 'F' }, bien, {}, {}).some((b) => b.t === 'note' && /^Atención/.test(b.text)));
});

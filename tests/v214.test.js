'use strict';
/* 2.14.0 — coordenadas planas de Colombia (Origen Nacional), pendiente del terreno, Shapefile y autor del reporte. */
const test = require('node:test');
const assert = require('node:assert');
const Geo = require('../www/js/geo.js');
const Fmt = require('../www/js/fmt.js');
const Perfil = require('../www/js/perfil.js');
const Shp = require('../www/js/shp.js');
const Zip = require('../www/js/zip.js');
const Store = require('../www/js/store.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Analysis = require('../www/js/analysis.js');

/* ---------- Origen Nacional (EPSG:9377) ---------- */
// Valores de referencia calculados con proj4 2.22.0 (una implementación independiente) con +proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80
const REF = [[4, -73, 5000000, 2000000], [4.6, -74.08, 4880248.4541, 2066385.7615], [10.4, -75.5, 4726380.7339, 2708306.0383], [1.2, -77.28, 4523591.5733, 1691005.8816],
  [-4.2, -69.94, 5339617.9998, 1093336.088], [12.58, -81.7, 4052053.3534, 2963947.971], [6.25, -75.56, 4716838.6976, 2249302.3491], [11.5, -72.9, 5010901.2007, 2828808.3062],
  [3.45, -76.53, 4607815.3524, 1939957.9412], [7.9, -67.5, 5606903.2298, 2434955.7526]];

test('Origen Nacional: coincide con proj4 a menos de 1 mm en todo el país (de Leticia a San Andrés)', () => {
  for (const [lat, lon, e, n] of REF) {
    const o = Geo.origenNacional(lat, lon);
    assert.ok(Math.abs(o.e - e) < 0.001, `E en ${lat}, ${lon}: ${o.e} vs ${e}`);
    assert.ok(Math.abs(o.n - n) < 0.001, `N en ${lat}, ${lon}: ${o.n} vs ${n}`);
  }
});

test('Origen Nacional: fuera de Colombia o con datos malos no hay coordenadas planas', () => {
  for (const [lat, lon] of [[40.4, -3.7], [-12, -77], [4.6, -60], [17, -75], [-5, -70], [4.6, -85], [NaN, -74], [4.6, Infinity], ['4.6', -74], [null, null]]) {
    assert.equal(Geo.origenNacional(lat, lon), null, `${lat}, ${lon}`);
  }
  // los bordes de la caja sí cuentan
  assert.ok(Geo.origenNacional(-4.5, -66.8));
  assert.ok(Geo.origenNacional(16.5, -84.8));
  assert.equal(Geo.inColombia(4.6, -74.08), true);
});

test('Origen Nacional: un metro en el terreno es casi un metro en el plano (factor de escala cerca del origen)', () => {
  const a = Geo.origenNacional(4.6, -74.08), b = Geo.origenNacional(4.6, -74.07);
  const plano = Math.hypot(b.e - a.e, b.n - a.n), real = Geo.distance(4.6, -74.08, 4.6, -74.07);
  assert.ok(Math.abs(plano / real - 1) < 0.001, plano / real);
});

test('Fmt.plana: texto con separador de miles, y vacío fuera de Colombia', () => {
  assert.equal(Fmt.plana(4.6, -74.08), 'E 4.880.248 m · N 2.066.386 m');
  assert.equal(Fmt.plana(40.4, -3.7), '');
  assert.match(Fmt.PLANA_NOTE, /EPSG:9377/);
});

/* ---------- Pendiente ---------- */
// Plano inclinado conocido: sube `pct` % hacia el rumbo `toward` (grados)
function plane(pct, toward, n) {
  const fr = Geo.localFrame([{ lat: 5, lon: -75 }]);
  const pts = [];
  const ux = Math.sin(toward * Math.PI / 180), uy = Math.cos(toward * Math.PI / 180);
  const xy = [[0, 0], [120, 10], [90, 140], [-30, 100], [60, 60], [-50, -40]].slice(0, n || 4);
  xy.forEach(([x, y], i) => { const ll = Geo.fromXY(fr, { x, y }); pts.push({ name: 'P' + (i + 1), lat: ll.lat, lon: ll.lon, alt: 1000 + (x * ux + y * uy) * pct / 100 }); });
  return pts;
}

test('pendiente: recupera la inclinación y hacia dónde baja un plano conocido', () => {
  for (const [pct, toward, wind] of [[10, 90, 'el oeste'], [30, 0, 'el sur'], [5, 225, 'el noreste'], [60, 135, 'el noroeste']]) {
    const s = Perfil.slope(plane(pct, toward, 5));
    assert.ok(Math.abs(s.pct - pct) < 0.05, `${pct}: ${s.pct}`);
    assert.ok(Math.abs(s.deg - Math.atan(pct / 100) * 180 / Math.PI) < 0.05);
    assert.ok(Math.abs(((s.aspect - (toward + 180) % 360) + 540) % 360 - 180) < 0.5, `rumbo ${s.aspect}`);
    assert.equal(s.wind, wind);
    assert.equal(s.n, 5);
  }
});

test('pendiente: sin 3 puntos con altitud o con puntos en línea no hay plano', () => {
  const p = plane(10, 90, 4);
  assert.equal(Perfil.slope(p.slice(0, 2)), null);
  assert.equal(Perfil.slope([p[0], p[1], { lat: p[2].lat, lon: p[2].lon }]), null);       // el tercero sin altitud
  assert.equal(Perfil.slope([{ lat: 5, lon: -75, alt: 1 }, { lat: 5, lon: -74.999, alt: 2 }, { lat: 5, lon: -74.998, alt: 3 }]), null);   // en línea este-oeste
  assert.equal(Perfil.slope([{ lat: 5, lon: -75, alt: 1 }, { lat: 5.001, lon: -75, alt: 2 }, { lat: 5.002, lon: -75, alt: 3 }]), null);   // en línea norte-sur
  assert.equal(Perfil.slope([{ lat: 5, lon: -75, alt: 1 }, { lat: 5.001, lon: -74.999, alt: 2 }, { lat: 5.002, lon: -74.998, alt: 3 }]), null);   // en diagonal
  assert.equal(Perfil.slope(null), null);
  const flat = Perfil.slope(plane(0, 0, 4));
  assert.equal(flat.pct, 0); assert.equal(flat.aspect, null); assert.equal(flat.wind, null);
  assert.deepEqual(Perfil.slopeRows(flat)[0], ['Pendiente media del terreno', '0,0 % (0,0°)']);
  assert.deepEqual(Perfil.slopeRows(null), []);
});

test('pendiente: clases del IGAC en sus límites', () => {
  const casos = [[0, 'a'], [2.99, 'a'], [3, 'b'], [6.9, 'b'], [7, 'c'], [12, 'd'], [24.9, 'd'], [25, 'e'], [50, 'f'], [74.9, 'f'], [75, 'g'], [300, 'g']];
  for (const [pct, code] of casos) assert.equal(Perfil.slopeClass(pct).code, code, String(pct));
  assert.deepEqual(Perfil.slopeClass(1), { code: 'a', name: 'ligeramente plano', range: '0–3 %' });
  assert.deepEqual(Perfil.slopeClass(80), { code: 'g', name: 'muy escarpado', range: 'más de 75 %' });
  assert.equal(Perfil.SLOPE_CLASSES.length, 7);
});

test('pendiente: va al principio de la tabla del perfil y con su aviso', () => {
  const m = Perfil.build(plane(18, 90, 5));
  const r = Perfil.rows(m);
  assert.equal(r[0][0], 'Pendiente media del terreno');
  assert.match(r[0][1], /^18 % \(10,2°\) · baja hacia el oeste$/);
  assert.equal(r[1][1], 'd · fuertemente inclinado (12–25 %)');
  assert.ok(m.notes.some((n) => /ajustar un plano a los 5 puntos/.test(n)));
  // con un número de un dígito lleva un decimal
  assert.match(Perfil.rows(Perfil.build(plane(4, 0, 4)))[0][1], /^4,0 % /);
  // con 2 puntos hay perfil pero no pendiente
  const two = Perfil.build(plane(18, 90, 2));
  assert.equal(two.ok, true); assert.equal(two.slope, null);
  assert.equal(Perfil.rows(two)[0][0], 'Punto más alto');
});

/* ---------- Shapefile ---------- */
// Lector mínimo para comprobar la estructura (el resultado también se verificó con la librería «shapefile» de npm)
function readShp(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = { code: dv.getInt32(0, false), words: dv.getInt32(24, false), version: dv.getInt32(28, true), type: dv.getInt32(32, true), box: [36, 44, 52, 60].map((o) => dv.getFloat64(o, true)), recs: [] };
  let off = 100;
  while (off < b.length) {
    const num = dv.getInt32(off, false), len = dv.getInt32(off + 4, false) * 2, t = dv.getInt32(off + 8, true);
    if (t === 1) out.recs.push({ num, type: t, x: dv.getFloat64(off + 12, true), y: dv.getFloat64(off + 20, true) });
    else {
      const parts = dv.getInt32(off + 44, true), np = dv.getInt32(off + 48, true), pts = [];
      for (let i = 0; i < np; i++) pts.push([dv.getFloat64(off + 56 + 16 * i, true), dv.getFloat64(off + 64 + 16 * i, true)]);
      out.recs.push({ num, type: t, parts, pts });
    }
    off += 8 + len;
  }
  out.end = off;
  return out;
}
function readDbf(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(4, true), head = dv.getUint16(8, true), rec = dv.getUint16(10, true), fields = [];
  for (let o = 32; b[o] !== 0x0D; o += 32) {
    let name = ''; for (let k = 0; k < 11 && b[o + k]; k++) name += String.fromCharCode(b[o + k]);
    fields.push({ name, type: String.fromCharCode(b[o + 11]), len: b[o + 16], dec: b[o + 17] });
  }
  const dec = new TextDecoder(), rows = [];
  for (let i = 0; i < n; i++) {
    let q = head + i * rec + 1; const row = {};
    fields.forEach((f) => { const s = dec.decode(b.subarray(q, q + f.len)).trim(); row[f.name] = f.type === 'N' ? (s === '' ? null : Number(s)) : s; q += f.len; });
    rows.push(row);
  }
  return { n, head, rec, fields, rows, size: b.length, eof: b[b.length - 1], version: b[0] };
}
const PTS = [{ name: 'Ñandú', lat: 4.6, lon: -74.08, alt: 2600 }, { name: 'B', lat: 4.6, lon: -74.07 }, { name: 'C', lat: 4.61, lon: -74.075, alt: 2650.5 }];

test('Shapefile: puntos y polígono, cada uno con sus cinco archivos', () => {
  const f = Shp.files({ name: 'Finca', base: 'finca', points: PTS }, Date.UTC(2026, 10, 11));
  assert.deepEqual(f.map((x) => x.name), ['finca_puntos.shp', 'finca_puntos.shx', 'finca_puntos.dbf', 'finca_puntos.prj', 'finca_puntos.cpg',
    'finca_poligono.shp', 'finca_poligono.shx', 'finca_poligono.dbf', 'finca_poligono.prj', 'finca_poligono.cpg']);
  const by = Object.fromEntries(f.map((x) => [x.name, x.bytes]));
  const s = readShp(by['finca_puntos.shp']);
  assert.equal(s.code, 9994); assert.equal(s.version, 1000); assert.equal(s.type, 1);
  assert.equal(s.words * 2, by['finca_puntos.shp'].length); assert.equal(s.end, by['finca_puntos.shp'].length);
  assert.deepEqual(s.box, [-74.08, 4.6, -74.07, 4.61]);
  assert.deepEqual(s.recs.map((r) => [r.num, r.x, r.y]), [[1, -74.08, 4.6], [2, -74.07, 4.6], [3, -74.075, 4.61]]);
  // índice: desplazamiento y largo de cada registro
  const x = by['finca_puntos.shx'], dx = new DataView(x.buffer, x.byteOffset);
  assert.equal(x.length, 100 + 8 * 3); assert.equal(dx.getInt32(24, false) * 2, x.length);
  assert.deepEqual([0, 1, 2].map((i) => [dx.getInt32(100 + 8 * i, false), dx.getInt32(104 + 8 * i, false)]), [[50, 10], [64, 10], [78, 10]]);
  // tabla
  const d = readDbf(by['finca_puntos.dbf']);
  assert.equal(d.version, 3); assert.equal(d.eof, 0x1A); assert.equal(d.n, 3); assert.equal(d.size, d.head + d.rec * 3 + 1);
  assert.deepEqual(d.fields.map((q) => q.name), ['NOMBRE', 'ORDEN', 'LATITUD', 'LONGITUD', 'ALTITUD_M', 'ESTE_ON', 'NORTE_ON']);
  assert.deepEqual(d.rows[0], { NOMBRE: 'Ñandú', ORDEN: 1, LATITUD: 4.6, LONGITUD: -74.08, ALTITUD_M: 2600, ESTE_ON: 4880248.45, NORTE_ON: 2066385.76 });
  assert.equal(d.rows[1].ALTITUD_M, null);
  assert.equal(new TextDecoder().decode(by['finca_puntos.cpg']), 'UTF-8');
  assert.match(new TextDecoder().decode(by['finca_puntos.prj']), /^GEOGCS\["GCS_WGS_1984"/);
});

test('Shapefile: el polígono va cerrado, en el sentido de las agujas del reloj, con área y perímetro', () => {
  const f = Shp.files({ name: 'Lote «1»', base: 'l', points: PTS });
  const by = Object.fromEntries(f.map((x) => [x.name, x.bytes]));
  const s = readShp(by['l_poligono.shp']);
  assert.equal(s.type, 5); assert.equal(s.recs.length, 1); assert.equal(s.recs[0].parts, 1);
  const pts = s.recs[0].pts;
  assert.equal(pts.length, 4); assert.deepEqual(pts[0], pts[3]);
  assert.ok(Shp.signedArea(pts.slice(0, 3).map(([lon, lat]) => ({ lon, lat }))) < 0, 'sentido de las agujas del reloj');
  const d = readDbf(by['l_poligono.dbf']).rows[0];
  const m2 = Geo.polygonArea(PTS);
  assert.equal(d.NOMBRE, 'Lote «1»'); assert.equal(d.VERTICES, 3);
  assert.ok(Math.abs(d.AREA_M2 - m2) < 0.06); assert.ok(Math.abs(d.AREA_HA - m2 / 10000) < 0.0001);
  assert.ok(Math.abs(d.PERIM_M - Geo.perimeter(PTS, true)) < 0.006);
  // si el usuario los marcó al revés, se voltean; la lista original no se toca
  const rev = PTS.slice().reverse();
  const r2 = readShp(Object.fromEntries(Shp.files({ base: 'r', points: rev }).map((x) => [x.name, x.bytes]))['r_poligono.shp']).recs[0].pts;
  assert.ok(Shp.signedArea(r2.slice(0, 3).map(([lon, lat]) => ({ lon, lat }))) < 0);
  assert.equal(rev[0].name, 'C');
  assert.equal(Shp.ring(rev).length, 4);
});

test('Shapefile: con menos de 3 puntos solo van los puntos; sin puntos válidos, error', () => {
  assert.equal(Shp.files({ base: 'b', points: PTS.slice(0, 2) }).length, 5);
  assert.throws(() => Shp.files({ points: [] }), /No hay puntos/);
  assert.throws(() => Shp.files({ points: [{ lat: 95, lon: 0 }, { lat: 'x', lon: 1 }] }), /No hay puntos/);
  assert.throws(() => Shp.files(null), /No hay puntos/);
  assert.equal(Shp.files({ points: PTS.slice(0, 1) })[0].name, 'terreno_puntos.shp');   // nombre por defecto
});

test('Shapefile: textos largos se cortan sin partir letras y los números que no caben quedan vacíos', () => {
  const long = 'ñ'.repeat(60);                                   // 120 bytes en UTF-8
  const c = Shp.clip(long, 81);
  assert.equal(c.length, 80); assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(c), 'ñ'.repeat(40));
  assert.equal(Shp.clip('abc', 10).length, 3);
  const d = readDbf(Shp.dbf([{ name: 'N', type: 'N', len: 4, dec: 1 }, { name: 'T', type: 'C', len: 3 }], [[123.45, null], [1.25, 'abcdef'], [NaN, 'x']], 0));
  assert.deepEqual(d.rows, [{ N: null, T: '' }, { N: 1.3, T: 'abc' }, { N: null, T: 'x' }]);
  // fuera de Colombia no hay planas
  const r = readDbf(Object.fromEntries(Shp.files({ base: 'm', points: [{ name: 'Madrid', lat: 40.4, lon: -3.7 }] }).map((x) => [x.name, x.bytes]))['m_puntos.dbf']).rows[0];
  assert.equal(r.ESTE_ON, null); assert.equal(r.NORTE_ON, null); assert.equal(r.NOMBRE, 'Madrid');
  // un punto sin nombre recibe el de su orden
  assert.equal(readDbf(Object.fromEntries(Shp.files({ base: 'x', points: [{ lat: 4.6, lon: -74 }] }).map((x) => [x.name, x.bytes]))['x_puntos.dbf']).rows[0].NOMBRE, 'P1');
});

test('Shapefile: el .zip trae todos los archivos y se puede abrir', () => {
  const z = Shp.zip({ name: 'F', base: 'f', points: PTS }, Date.UTC(2026, 10, 11));
  assert.equal(Zip.isZip(z), true);
  const names = Zip.entries(z).map((e) => e.name).sort();
  assert.equal(names.length, 10);
  assert.ok(names.includes('f_poligono.dbf') && names.includes('f_puntos.shp'));
});

/* ---------- Autor del reporte ---------- */
const LOGO = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('autor: se guarda limpio, aparte del estado, y descarta logos que no son JPEG', () => {
  const mem = {};
  Store.setBackend({ getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } });
  assert.deepEqual(Store.loadAuthor(), { name: '', org: '', logo: '' });
  assert.equal(Store.saveAuthor({ name: '  Ana\n Pérez\t', org: 'x'.repeat(200), logo: LOGO, extra: 1 }).ok, true);
  assert.deepEqual(Store.loadAuthor(), { name: 'Ana Pérez', org: 'x'.repeat(80), logo: LOGO });
  assert.ok('zvg.v1.author' in mem); assert.ok(!('zvg.v1.state' in mem));
  for (const bad of ['iVBORw0KGgo=', '/9j/<script>', '/9j/' + 'A'.repeat(Store.LOGO_MAX), 'data:image/jpeg;base64,' + LOGO, 42, '/9j/A']) {
    assert.equal(Store.cleanAuthor({ logo: bad }).logo, '', String(bad).slice(0, 20));
  }
  assert.deepEqual(Store.cleanAuthor(null), { name: '', org: '', logo: '' });
  assert.deepEqual(Store.cleanAuthor([1]), { name: '', org: '', logo: '' });
  assert.equal(Store.cleanAuthor({ name: 5 }).name, '');
  mem['zvg.v1.author'] = '{roto';
  assert.equal(Store.loadAuthor().name, 'Ana Pérez');                 // guardado dañado: usa la copia en memoria, como el resto del almacén
  Store.setBackend({ getItem: () => '{"name":["x"],"logo":"/9j/"}', setItem() {}, removeItem() {} });
  assert.deepEqual(Store.loadAuthor(), { name: '', org: '', logo: '/9j/' });
});

const Climate = require('../www/js/climate.js');
function analyze(project) { return Analysis.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() }); }
function sample() {
  const project = { name: 'Finca', points: [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 1800 }, { name: 'P2', lat: 4.6, lon: -74.09, alt: 1810 }, { name: 'P3', lat: 4.61, lon: -74.095, alt: 1830 }], climate: { pManual: 1500 }, layers: [] };
  return { project, a: analyze(project) };
}

test('autor: sale en el encabezado del reporte HTML, del texto y del PDF', () => {
  const { project, a } = sample();
  const o = { date: Date.UTC(2026, 10, 11, 15), author: { name: 'Ana <b>Pérez</b>', org: 'Cía & Hnos', logo: LOGO } };
  const h = Report.html(project, a, o);
  assert.match(h, /<img class="logo" src="data:image\/jpeg;base64,\/9j\/4AAQ[^"]*" alt="Logo de Cía &amp; Hnos">/);
  assert.match(h, /<p class="sub author">Elaborado por: Ana &lt;b&gt;Pérez&lt;\/b&gt; · Cía &amp; Hnos<\/p>/);
  assert.ok(h.indexOf('class="logo"') < h.indexOf('<h1>'));
  assert.match(Report.text(project, a, o).split('\n')[2], /^Elaborado por: Ana <b>Pérez<\/b> · Cía & Hnos$/);
  const bl = ReportPdf.blocks(project, a, o, {});
  assert.equal(bl[0].t, 'image'); assert.equal(bl[0].maxW, 120); assert.equal(bl[0].maxH, 60);
  assert.equal(bl[0].img.bytes[0], 0xFF);
  assert.equal(bl[1].t, 'h1');
  assert.match(bl[2].text, /\nElaborado por: Ana <b>Pérez<\/b> · Cía & Hnos$/);
  const pdf = ReportPdf.build(project, a, o, {});
  assert.equal(new TextDecoder('latin1').decode(pdf.subarray(0, 5)), '%PDF-');
  assert.match(new TextDecoder('latin1').decode(pdf), /\/Subtype \/Image/);
});

test('autor: sin autor el reporte queda como antes; con solo el logo o solo la entidad también funciona', () => {
  const { project, a } = sample();
  const h = Report.html(project, a, { date: 0 });
  assert.doesNotMatch(h, /class="logo"|Elaborado por/);
  assert.doesNotMatch(Report.text(project, a, {}), /Elaborado por/);
  assert.equal(ReportPdf.blocks(project, a, {}, {})[0].t, 'h1');
  assert.deepEqual(Report.authorOf({ author: { org: 'IGAC' } }), { name: '', org: 'IGAC', logo: '', line: 'Elaborado por: IGAC' });
  const solo = Report.html(project, a, { author: { logo: LOGO } });
  assert.match(solo, /alt="Logo"/); assert.doesNotMatch(solo, /Elaborado por/);
  // un logo que no es JPEG en base64 no entra al HTML (no se puede inyectar nada por ahí)
  assert.equal(Report.authorOf({ author: { logo: '/9j/" onerror="alert(1)' } }).logo, '');
  assert.equal(Report.authorOf({ author: { logo: 'iVBOR' } }).logo, '');
  assert.equal(Report.authorOf(null).line, '');
});

test('reportes: las coordenadas planas solo se explican si alguna aplica', () => {
  const { project, a } = sample();
  assert.match(Report.html(project, a, {}), /EPSG:9377/);
  const fuera = { name: 'Madrid', points: [{ name: 'M', lat: 40.4, lon: -3.7 }], climate: {}, layers: [] };
  const af = analyze(fuera);
  assert.doesNotMatch(Report.html(fuera, af, {}), /EPSG:9377|E \d/);
  assert.equal(Report.anyPlana(fuera, af), false);
  assert.ok(ReportPdf.blocks(project, a, {}, {}).some((b) => b.t === 'p' && /EPSG:9377/.test(b.text)));
  assert.ok(!ReportPdf.blocks(fuera, af, {}, {}).some((b) => b.t === 'p' && /EPSG:9377/.test(b.text || '')));
});

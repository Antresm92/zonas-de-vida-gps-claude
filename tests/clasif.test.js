'use strict';
/* 2.18.0 — otras clasificaciones del clima: Caldas-Lang (IDEAM, nota técnica 2025-003), De Martonne y Köppen-Geiger; secciones opcionales del reporte. */
const test = require('node:test');
const assert = require('node:assert');
const Clasif = require('../www/js/clasif.js');
const Analysis = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');

test('Caldas (IDEAM): el piso térmico sale de la temperatura media, con los límites de la tabla oficial', () => {
  const casos = [[30, 'Cálido'], [24.01, 'Cálido'], [24, 'Templado'], [18.01, 'Templado'], [18, 'Frío'], [12.01, 'Frío'], [12, 'Muy frío'], [6.01, 'Muy frío'],
    [6, 'Extremadamente frío'], [1.5, 'Extremadamente frío'], [1.49, 'Nival'], [0, 'Nival'], [-5, 'Nival']];
  for (const [T, name] of casos) assert.equal(Clasif.piso(T).name, name, String(T));
  assert.deepEqual(Clasif.PISOS.map((p) => [p.id, p.alt]), [['C', '0 a 800 m'], ['T', '800 a 1800 m'], ['F', '1800 a 2800 m'], ['Mf', '2800 a 3500 m'], ['Ef', '3500 a 4500 m'], ['Nv', 'más de 4500 m']]);
  assert.equal(Clasif.piso(null), null); assert.equal(Clasif.piso('20'), null); assert.equal(Clasif.piso(NaN), null);
});

test('Lang modificada (IDEAM): nueve clases de humedad por lluvia ÷ temperatura', () => {
  const casos = [[0, 'desértico'], [19.9, 'desértico'], [20, 'árido'], [39.9, 'árido'], [40, 'semiárido'], [60, 'ligeramente húmedo'], [79.9, 'ligeramente húmedo'], [80, 'semihúmedo'],
    [100, 'húmedo'], [120, 'muy húmedo'], [159.9, 'muy húmedo'], [160, 'superhúmedo'], [299.9, 'superhúmedo'], [300, 'extremadamente húmedo'], [5000, 'extremadamente húmedo']];
  for (const [f, name] of casos) { const l = Clasif.lang(10, f * 10); assert.equal(l.cls.name, name, String(f)); assert.ok(Math.abs(l.factor - f) < 1e-9); }
  assert.deepEqual(Clasif.LANG.map((l) => l.id), ['D', 'A', 'Sa', 'Lh', 'Sh', 'H', 'Mh', 'SHm', 'Eh']);
  for (const bad of [[0, 1000], [-3, 1000], [20, -1], [null, 1000], [20, null], [20, NaN]]) assert.equal(Clasif.lang(bad[0], bad[1]), null, JSON.stringify(bad));
  assert.equal(Clasif.PISOS.length * Clasif.LANG.length, 54, 'los 54 tipos de clima de la nota técnica');
});

test('Caldas-Lang: nombre y símbolo; sin lluvia queda solo el piso; sin temperatura no hay nada', () => {
  assert.deepEqual([Clasif.caldasLang(23, 1544).name, Clasif.caldasLang(23, 1544).symbol], ['Templado ligeramente húmedo', 'TLh']);
  assert.deepEqual([Clasif.caldasLang(27, 3500).name, Clasif.caldasLang(27, 3500).symbol], ['Cálido muy húmedo', 'CMh']);
  assert.deepEqual([Clasif.caldasLang(13.5, 1000).name, Clasif.caldasLang(13.5, 1000).symbol], ['Frío ligeramente húmedo', 'FLh']);
  assert.equal(Clasif.caldasLang(28, 300).symbol, 'CD'); assert.equal(Clasif.caldasLang(8, 2800).symbol, 'MfEh');
  const sinLluvia = Clasif.caldasLang(23, null);
  assert.deepEqual([sinLluvia.name, sinLluvia.symbol, sinLluvia.lang, sinLluvia.factor], ['Templado', 'T', null, null]);
  assert.equal(Clasif.caldasLang(-2, 500).name, 'Nival', 'bajo cero el factor de Lang no aplica');
  assert.equal(Clasif.caldasLang(null, 1000), null);
});

test('De Martonne: lluvia ÷ (temperatura + 10) y sus seis zonas', () => {
  const casos = [[4.9, 'Desierto (hiperárido)'], [5, 'Semidesierto (árido)'], [10, 'Semiárido'], [19.9, 'Semiárido'], [20, 'Subhúmedo'], [30, 'Húmedo'], [59.9, 'Húmedo'], [60, 'Perhúmedo']];
  for (const [ia, name] of casos) assert.equal(Clasif.martonne(10, ia * 20).name, name, String(ia));
  assert.ok(Math.abs(Clasif.martonne(23, 1544).index - 46.7879) < 0.001);
  assert.equal(Clasif.martonne(-10, 500), null); assert.equal(Clasif.martonne(20, -5), null); assert.equal(Clasif.martonne(null, 500), null); assert.equal(Clasif.martonne(20, null), null);
  assert.equal(Clasif.martonne(-5, 100).name, 'Subhúmedo');
});

test('Köppen-Geiger: clases esperadas con climas conocidos', () => {
  const k = (T, P, lat) => Clasif.koppen(Array.isArray(T) ? T : Array(12).fill(T), Array.isArray(P) ? P : Array(12).fill(P), lat === undefined ? 4 : lat);
  assert.equal(k(27, 250).code, 'Af');                                                   // selva: ningún mes bajo 60 mm
  assert.equal(k(27, [40, 60, 150, 300, 350, 300, 300, 300, 300, 300, 200, 80]).code, 'Am');   // monzónico: mes seco de 40 mm con 2680 mm al año
  assert.equal(k(27, [5, 5, 10, 150, 300, 300, 300, 300, 300, 200, 50, 5]).code, 'Aw');        // sabana con estación seca
  assert.equal(k(28, 20).code, 'BWh'); assert.equal(k(28, 45).code, 'BSh');              // 240 mm: desierto; 540 mm: estepa cálida
  assert.equal(k(12, 12).code, 'BWk'); assert.equal(k(12, 25).code, 'BSk');
  assert.equal(k(13.5, 80).code, 'Cfb');                                                 // altiplano tipo Bogotá
  assert.equal(k([20, 20, 21, 22, 23, 23, 23, 23, 22, 21, 20, 17], 100).code, 'Cfa');
  assert.equal(k([8, 8, 9, 9, 10.5, 10.5, 9, 9, 9, 8, 8, 8], 100).code, 'Cfc');
  assert.equal(k([12, 13, 15, 17, 20, 23, 24, 24, 21, 17, 14, 12], [80, 70, 60, 50, 30, 10, 5, 5, 30, 70, 90, 90], 40).code, 'Csa');   // mediterráneo, hemisferio norte
  assert.equal(k([24, 24, 21, 17, 14, 12, 12, 13, 15, 17, 20, 23], [5, 5, 30, 70, 90, 90, 80, 70, 60, 50, 30, 10], -35).code, 'Csa');  // el mismo, en el sur (verano de octubre a marzo)
  assert.equal(k([10, 12, 16, 20, 23, 24, 24, 24, 22, 18, 14, 11], [5, 8, 15, 40, 120, 250, 300, 280, 150, 40, 10, 5], 25).code, 'Cwa');
  assert.equal(k(6, 80).code, 'ET'); assert.equal(k(-3, 30).code, 'EF');                 // páramo alto y nieves
  assert.equal(k([-10, -8, -2, 5, 12, 17, 19, 18, 12, 5, -2, -8], 50, 55).code, 'Dfb');
  const r = k([23, 23.2, 23.4, 23.1, 23, 22.8, 22.9, 23.1, 23, 22.7, 22.6, 22.8], [60, 80, 130, 210, 190, 90, 60, 70, 130, 230, 200, 94]);
  assert.equal(r.code, 'Af'); assert.equal(r.name, 'Tropical de selva (lluvioso todo el año)');
  assert.ok(Math.abs(r.MAP - 1544) < 1e-9); assert.equal(r.Tcold, 22.6); assert.equal(r.Thot, 23.4); assert.equal(r.Pdry, 60);
  assert.equal(Clasif.koppen(Array(12).fill(27), Array(12).fill(0), 4).code, 'BWh', 'sin lluvia: desierto');
  // datos incompletos o malos
  assert.equal(Clasif.koppen(Array(11).fill(20), Array(12).fill(50), 4), null); assert.equal(Clasif.koppen(null, null, 4), null);
  assert.equal(Clasif.koppen(Array(12).fill(20), Array(12).fill(-1), 4), null);
  assert.equal(Clasif.koppen(Array(12).fill(20), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, NaN], 4), null);
  assert.equal(Clasif.koppen(Array(12).fill(27), Array(12).fill(250)).code, 'Af', 'sin latitud se toma el hemisferio norte');
  for (const c of Object.keys(Clasif.KOPPEN)) assert.ok(Clasif.KOPPEN[c].length > 5);
});

test('filas para el reporte: cada método con su resultado y su explicación; Köppen avisa si faltan los 12 meses', () => {
  const c = Clasif.all({ T: 23, P: 1544, alt: 929, lat: 4.9 });
  const r = Clasif.rows(c);
  assert.deepEqual(r.map((x) => [x[0], x[1]]), [['Caldas-Lang (IDEAM)', 'Templado ligeramente húmedo (TLh)'], ['Índice de aridez de De Martonne', '46,8 · Húmedo'], ['Köppen-Geiger', 'Sin calcular']]);
  assert.equal(r[0][2], 'Piso térmico templado: temperatura media de 18 a 24 °C (altitud de referencia: 800 a 1800 m). Factor de Lang (lluvia ÷ temperatura) = 67: ligeramente húmedo.');
  assert.match(r[2][2], /12 meses/);
  const sinP = Clasif.rows(Clasif.all({ T: 23, P: null }));
  assert.equal(sinP[0][1], 'Templado (T)'); assert.match(sinP[0][2], /Falta la lluvia anual/); assert.equal(sinP.length, 2, 'sin lluvia no hay Martonne');
  assert.deepEqual(Clasif.rows(Clasif.all({})), []); assert.deepEqual(Clasif.rows(null), []); assert.deepEqual(Clasif.rows(Clasif.all(null)), []);
  const bog = Clasif.rows(Clasif.all({ T: 13.5, P: 960, monthlyT: Array(12).fill(13.5), monthlyP: Array(12).fill(80), lat: 4.6 }));
  assert.equal(bog[2][1], 'Cfb · Templado sin estación seca, verano suave');
  assert.match(bog[2][2], /En la montaña tropical Köppen llama «templado» a climas frescos/);
  assert.doesNotMatch(Clasif.rows(Clasif.all({ T: 27, P: 3000, monthlyT: Array(12).fill(27), monthlyP: Array(12).fill(250) }))[2][2], /montaña tropical/);
  assert.equal(Clasif.all({ alt: 'x' }).alt, null);
});

const mk = (extra) => {
  const project = Object.assign({ name: 'Finca', points: [[4.9303, -74.954, 832], [4.9297, -74.95, 900], [4.935, -74.952, 1056]].map((q, i) => ({ name: 'P' + (i + 1), lat: q[0], lon: q[1], alt: q[2] })),
    climate: { tManual: 23, pManual: 1544 }, layers: [] }, extra || {});
  return { project, a: Analysis.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() }) };
};

test('análisis y reporte: las clasificaciones salen del mismo clima y van en el HTML, el PDF y el resumen', () => {
  const { project, a } = mk();
  assert.equal(a.clasif.caldas.symbol, 'TLh'); assert.equal(a.clasif.koppen, null); assert.equal(a.clasif.alt, a.alt.value);
  const h = Report.html(project, a, {});
  assert.match(h, /<h2>Otras clasificaciones del clima<\/h2><table><tr><th>Caldas-Lang \(IDEAM\)<\/th><td><b>Templado ligeramente húmedo \(TLh\)<\/b><br><span class="small">Piso térmico templado/);
  assert.ok(h.indexOf('Otras clasificaciones del clima') > h.indexOf('<h2>Datos del clima</h2>') && h.indexOf('Otras clasificaciones del clima') < h.indexOf('<h2>Terreno</h2>'));
  assert.match(h, /Holdridge separa los pisos por biotemperatura y Caldas por temperatura media/);
  const t = Report.text(project, a, {});
  assert.match(t, /\nOtras clasificaciones del clima:\n  Caldas-Lang \(IDEAM\): Templado ligeramente húmedo \(TLh\)\n  Índice de aridez de De Martonne: 46,8 · Húmedo\n/);
  const bl = ReportPdf.blocks(project, a, {}, {});
  const i = bl.findIndex((b) => b.t === 'h2' && b.text === 'Otras clasificaciones del clima');
  assert.ok(i > 0); assert.equal(bl[i + 1].t, 'table'); assert.deepEqual(bl[i + 1].rows[0], ['Caldas-Lang (IDEAM)', 'Templado ligeramente húmedo (TLh)']);
  // con los 12 meses, Köppen
  const m = mk({ climate: { monthlyManual: { T: Array(12).fill(27), P: Array(12).fill(250) } } });
  assert.equal(m.a.clasif.koppen.code, 'Af'); assert.equal(m.a.clasif.caldas.symbol, 'CH');
  // sin temperatura ni altitud no hay sección
  const vacio = { name: 'X', points: [{ name: 'P1', lat: 4.9, lon: -74.9 }], climate: {}, layers: [] };
  const av = Analysis.analyze({ points: vacio.points, climate: {} }, { memory: new Climate.Memory() });
  assert.doesNotMatch(Report.html(vacio, av, {}), /Otras clasificaciones/); assert.deepEqual(Report.clasifRows(av), []); assert.deepEqual(Report.clasifRows(null), []);
});

test('secciones opcionales: lo desmarcado no sale en el HTML, el PDF ni el resumen; lo esencial va siempre', () => {
  const { project, a } = mk();
  project.weatherNow = { T: 22.8, ts: Date.UTC(2026, 10, 12, 5), lat: 4.93, lon: -74.95, source: 'Open-Meteo' };
  const o = { walter: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', lines: ['x'], source: 'S.' }, satellite: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', caption: 'c' }, topo: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', caption: 'c' } };
  const todas = Report.SECTIONS.map((s) => s[0]);
  assert.deepEqual(todas, ['clasif', 'actual', 'fotos', 'zonas', 'perfil', 'sat', 'topo', 'walter', 'holdridge']);
  const h2 = (h) => (h.match(/<h2[^>]*>[^<]*<\/h2>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
  const full = h2(Report.html(project, a, o));
  for (const t of ['Otras clasificaciones del clima', 'Clima actual', 'Perfil del relieve', 'Croquis satelital', 'Croquis topográfico', 'Diagrama de Walter-Lieth', 'Diagrama de Holdridge']) assert.ok(full.includes(t), t);
  const skip = {}; todas.forEach((k) => { skip[k] = true; });
  const min = h2(Report.html(project, a, Object.assign({ skip }, o)));
  assert.deepEqual(min, ['Datos del clima', 'Terreno', 'Puntos', 'Croquis', 'Calidad de los datos']);
  // una sola desmarcada quita solo esa
  for (const [k, t] of Report.SECTIONS) {
    if (k === 'fotos' || k === 'zonas') continue;                   // en este ejemplo no hay fotos ni varias zonas
    const uno = h2(Report.html(project, a, Object.assign({ skip: { [k]: true } }, o)));
    assert.equal(uno.includes(t), false, t); assert.equal(uno.length, full.length - 1, t);
  }
  // solo `true` quita: otros valores no
  assert.equal(h2(Report.html(project, a, Object.assign({ skip: { clasif: 'no', actual: 0, perfil: null } }, o))).length, full.length);
  assert.equal(Report.skips({ skip: { x: true } }, 'x'), true); assert.equal(Report.skips({}, 'x'), false); assert.equal(Report.skips(null, 'x'), false);
  // PDF: mismas secciones, y las gráficas desmarcadas ni se preparan
  const titulos = (bl) => bl.filter((b) => b.t === 'h2').map((b) => b.text);
  const imgs = { satelital: { bytes: new Uint8Array([0xFF, 0xD8, 0xFF]) }, topo: { bytes: new Uint8Array([0xFF, 0xD8, 0xFF]) } };
  assert.deepEqual(titulos(ReportPdf.blocks(project, a, Object.assign({ skip }, o), imgs)), ['Datos del clima', 'Terreno', 'Puntos', 'Croquis', 'Calidad de los datos']);
  assert.ok(titulos(ReportPdf.blocks(project, a, o, imgs)).includes('Croquis satelital'));
  assert.deepEqual(ReportPdf.sketches(project, a, Object.assign({ skip }, o)).map((s) => s.key), ['croquis']);
  assert.deepEqual(ReportPdf.sketches(project, a, o).map((s) => s.key), ['croquis', 'satelital', 'topo', 'perfil', 'walter', 'holdridge']);
  // resumen de texto
  const t = Report.text(project, a, { skip: { clasif: true, actual: true } });
  assert.doesNotMatch(t, /Otras clasificaciones|Clima actual/);
  assert.match(Report.text(project, a, {}), /Clima actual \(/);
});

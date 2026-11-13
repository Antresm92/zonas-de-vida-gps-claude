'use strict';
/* 2.17.0 — fincas y áreas: jerarquía, cuentas sin contar dos veces, avisos, guardado, copia, reporte, croquis y exportados. */
const test = require('node:test');
const assert = require('node:assert');
const Geo = require('../www/js/geo.js');
const Predio = require('../www/js/predio.js');
const Store = require('../www/js/store.js');
const Backup = require('../www/js/backup.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Diagram = require('../www/js/diagram.js');
const Mapa = require('../www/js/mapa.js');
const Gis = require('../www/js/gis.js');
const Shp = require('../www/js/shp.js');
const Analysis = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');

const FR = Geo.localFrame([{ lat: 4.6, lon: -74.08 }]);
const sq = (x, y, lado, alt) => [[x, y], [x + lado, y], [x + lado, y + lado], [x, y + lado]].map(([a, b], i) => Object.assign({ name: 'P' + (i + 1) }, Geo.fromXY(FR, { x: a, y: b }), alt === undefined ? {} : { alt }));
const LOTS = () => [
  { id: 'f1', name: 'La Esperanza', kind: 'finca', locked: true, points: sq(0, 0, 1000, 1000), mainColor: '#2F8F4E' },
  { id: 'a1', name: 'Potrero 1', kind: 'area', cat: 'Potrero', parent: 'f1', points: sq(100, 100, 200, 1000), mainColor: '#8BC34A' },
  { id: 'a2', name: 'Cacaotera', kind: 'area', cat: 'Cacaotera', parent: 'f1', points: sq(500, 500, 300, 300), mainColor: '#8E44AD' },
  { id: 'l1', name: 'Lote viejo', points: sq(2000, 0, 100, 500), mainColor: '#2980B9' },
  { id: 'a3', name: 'Suelta', kind: 'area', points: sq(3000, 0, 100), mainColor: '#F1C40F' },
  { id: 'f2', name: 'Finca 2', kind: 'finca', points: sq(0, 3000, 500), mainColor: '#2F8F4E' }
];

test('tipos: finca, área con su título y lote; color de cada tipo', () => {
  const l = LOTS();
  assert.deepEqual(l.map(Predio.kindLabel), ['Predio', 'Potrero', 'Cacaotera', 'Lote', 'Lote', 'Predio']);
  assert.equal(Predio.catColor('cafetal'), '#8D6E63'); assert.equal(Predio.catColor(' Potrero '), '#8BC34A');
  assert.equal(Predio.catColor('Cacaotera'), '#8E44AD'); assert.equal(Predio.catColor(''), '#8E44AD'); assert.equal(Predio.catColor(null), '#8E44AD');
  assert.deepEqual(Predio.CATS.map((c) => c[0]), ['Potrero', 'Cafetal', 'Cultivo', 'Vertiente', 'Bosque', 'Otra']);
  assert.equal(Predio.kindLabel(null), 'Lote');
  assert.deepEqual(Predio.fincas(l).map((f) => f.id), ['f1', 'f2']); assert.deepEqual(Predio.fincas(null), []);
});

test('a qué finca pertenece un área: solo vale una finca que exista; la sugerida es la que contiene el lugar', () => {
  const l = LOTS();
  assert.equal(Predio.parentOf(l[1], l).id, 'f1');
  assert.equal(Predio.parentOf(l[4], l), null); assert.equal(Predio.parentOf(l[0], l), null); assert.equal(Predio.parentOf(l[3], l), null);
  assert.equal(Predio.parentOf({ kind: 'area', parent: 'no-existe' }, l), null);
  assert.equal(Predio.parentOf({ kind: 'area', parent: 'l1' }, l), null, 'un lote no es finca');
  assert.equal(Predio.parentOf({ kind: 'area', parent: 'f1' }, null), null);
  assert.deepEqual(Predio.children(l[0], l).map((x) => x.id), ['a1', 'a2']);
  const dentro2 = Geo.fromXY(FR, { x: 100, y: 3100 }), dentro1 = Geo.fromXY(FR, { x: 900, y: 900 }), fuera = Geo.fromXY(FR, { x: 5000, y: 5000 });
  assert.equal(Predio.guessParent(l, dentro2, 'f1').id, 'f2', 'gana la finca que contiene el lugar');
  assert.equal(Predio.guessParent(l, dentro1, 'f2').id, 'f1');
  assert.equal(Predio.guessParent(l, fuera, 'f2').id, 'f2', 'si no cae en ninguna, la que se estaba viendo');
  assert.equal(Predio.guessParent(l, fuera, ''), null, 'con varias fincas y sin pista, ninguna');
  assert.equal(Predio.guessParent(l.slice(0, 2), null, '').id, 'f1', 'con una sola finca, esa');
  assert.equal(Predio.guessParent(l.slice(3, 5), dentro1, 'x'), null, 'sin fincas, ninguna');
  assert.equal(Predio.contains({ points: sq(0, 0, 10).slice(0, 2) }, dentro1), false); assert.equal(Predio.contains(l[0], null), false);
  assert.deepEqual(Predio.centroid([]), null); assert.deepEqual(Predio.centroid([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, null, { lat: 'x' }]), { lat: 2, lon: 3 });
});

test('cuentas: los lotes que están dentro de un predio no se suman otra vez; por finca, lo usado y lo que queda', () => {
  const l = LOTS(), a = Predio.account(l), ha = (m) => Math.round(m / 100) / 100;
  // total = finca 1 (100 ha) + lote viejo (1) + área suelta (1) + finca 2 (25)
  assert.equal(ha(a.total), 127); assert.equal(a.closed, 4);
  assert.deepEqual(a.rows.map((r) => [r.label, r.parent ? r.parent.id : '', r.pct === null ? null : Math.round(r.pct)]), [['Predio', '', null], ['Potrero', 'f1', 4], ['Cacaotera', 'f1', 9], ['Lote', '', null], ['Lote', '', null], ['Predio', '', null]]);
  assert.deepEqual(a.fincas.map((f) => [f.lot.id, f.n, ha(f.used), ha(f.free), f.over]), [['f1', 2, 13, 87, false], ['f2', 0, 0, 25, false]]);
  // áreas que suman más que la finca: se dice, y lo que queda no baja de cero
  const lleno = [{ id: 'f', kind: 'finca', points: sq(0, 0, 100) }, { id: 'a', kind: 'area', parent: 'f', points: sq(0, 0, 100) }, { id: 'b', kind: 'area', parent: 'f', points: sq(0, 0, 60) }];
  const al = Predio.account(lleno).fincas[0];
  assert.equal(al.over, true); assert.equal(al.free, 0);
  // una finca sin cerrar no cuenta ni da porcentaje
  const abierta = [{ id: 'f', kind: 'finca', points: sq(0, 0, 100).slice(0, 2) }, { id: 'a', kind: 'area', parent: 'f', points: sq(0, 0, 50) }];
  const ab = Predio.account(abierta);
  assert.equal(ab.rows[1].pct, null); assert.equal(ab.closed, 0); assert.equal(ab.fincas[0].free, 0);
  assert.deepEqual(Predio.account(null), { total: 0, closed: 0, rows: [], fincas: [] });
  assert.equal(Predio.m2({ points: [] }), 0); assert.equal(Predio.m2(null), 0);
});

test('avisos: un área que se sale de su finca informa y deja continuar; finca y área no «se montan»; lo demás sí', () => {
  assert.deepEqual(Predio.warnings(LOTS()), []);
  const l = LOTS();
  l[2].points = sq(900, 500, 300);                       // la cacaotera se sale 200 m por el este
  assert.deepEqual(Predio.warnings(l), ['«Cacaotera» se sale del predio «La Esperanza». Puedes dejarlo así, pero recuerda que esa parte queda por fuera de los límites del predio.']);
  l[1].points = sq(950, 450, 200);                       // y el potrero se monta sobre ella
  const w = Predio.warnings(l);
  assert.equal(w.length, 2);
  assert.match(w[0], /^«Potrero 1» se sale del predio «La Esperanza»; «Cacaotera» se sale del predio «La Esperanza»\./);
  assert.equal(w[1], 'Hay polígonos que se montan uno sobre otro: «Potrero 1» y «Cacaotera». Revisa los linderos: el total del proyecto cuenta esa parte dos veces.');
  // un lote de los de siempre metido en la finca sí se monta (se cuenta dos veces); dos fincas montadas también
  const m = LOTS(); m[3].points = sq(100, 600, 100); m[5].points = sq(900, 900, 500);
  assert.match(Predio.warnings(m)[0], /«La Esperanza» y «Lote viejo»; «La Esperanza» y «Finca 2»\./);
  // un área que comparte el lindero de la finca no se sale; una de otra finca metida aquí no es error
  const b = LOTS(); b[1].points = sq(0, 0, 200); b[4].points = sq(600, 100, 100);
  assert.deepEqual(Predio.warnings(b), []);
  // más de tres: se resume; sin tipos habla de «lotes» (como en la 2.15.1)
  const muchos = [{ id: 'f', name: 'F', kind: 'finca', points: sq(0, 0, 100) }].concat([1, 2, 3, 4, 5].map((i) => ({ id: 'a' + i, name: 'A' + i, kind: 'area', parent: 'f', points: sq(90 + i * 200, 0, 50) })));
  assert.match(Predio.warnings(muchos)[0], /^«A1» se sale del predio «F»; «A2» se sale del predio «F»; «A3» se sale del predio «F» y 2 más\./);
  assert.match(Predio.warnings([{ name: 'A', points: sq(0, 0, 100) }, { name: 'B', points: sq(50, 50, 100) }, null])[0], /^Hay lotes que se montan uno sobre otro: «A» y «B»\./);
  assert.deepEqual(Predio.warnings(null), []);
  // Geo.sticksOut: borde con tolerancia, datos incompletos
  assert.equal(Geo.sticksOut(sq(0, 0, 100), sq(0, 0, 100)), false);
  assert.equal(Geo.sticksOut(sq(-0.3, 0, 50), sq(0, 0, 100)), false, '30 cm por fuera es error de GPS');
  assert.equal(Geo.sticksOut(sq(-2, 0, 50), sq(0, 0, 100)), true);
  assert.equal(Geo.sticksOut(sq(0, 0, 100), sq(10, 10, 50)), true, 'el que contiene se sale del contenido');
  assert.equal(Geo.sticksOut(sq(0, 0, 10).slice(0, 2), sq(0, 0, 100)), false); assert.equal(Geo.sticksOut(null, sq(0, 0, 100)), false);
  // sale solo por la mitad de un lado (los vértices están dentro de una finca en forma de L)
  const L = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]].map(([x, y]) => Geo.fromXY(FR, { x, y }));
  const tri = [[10, 90], [90, 10], [10, 10]].map(([x, y]) => Geo.fromXY(FR, { x, y }));
  assert.equal(Geo.sticksOut(tri, L), true);
});

test('guardado: el tipo, el título, la finca y el bloqueo se limpian al cargar', () => {
  const p = Store.toLots({ id: 'p', name: 'P', lotId: 'a1', lots: [
    { id: 'f1', name: 'F', kind: 'finca', locked: true, cat: 'no aplica', parent: 'x', points: [] },
    { id: 'a1', name: 'A', kind: 'area', cat: '  Mi   cacaotera\n ' + 'x'.repeat(60), parent: 'f1', locked: true, points: [] },
    { id: 'a2', name: 'B', kind: 'area', parent: 'no-existe', cat: 7, points: [] },
    { id: 'a3', name: 'C', kind: 'area', parent: 'a1', points: [] },
    { id: 'l', name: 'L', kind: 'otra-cosa', cat: 'x', parent: 'f1', locked: true, points: [] },
    { id: 'f2', name: 'F2', kind: 'finca', locked: 'sí', points: [] }] });
  const [f1, a1, a2, a3, l, f2] = p.lots;
  assert.deepEqual([f1.kind, f1.locked, f1.cat, f1.parent], ['finca', true, undefined, undefined]);
  assert.equal(a1.kind, 'area'); assert.equal(a1.parent, 'f1'); assert.equal(a1.locked, undefined);
  assert.equal(a1.cat.length, Store.CAT_MAX); assert.match(a1.cat, /^Mi cacaotera x+$/);
  assert.deepEqual([a2.parent, a2.cat], [undefined, undefined], 'una finca que no existe no vale');
  assert.equal(a3.parent, undefined, 'un área no cuelga de otra área');
  assert.deepEqual([l.kind, l.cat, l.parent, l.locked], ['area', undefined, undefined, undefined], 'un tipo desconocido queda como lote suelto');
  assert.equal(f2.locked, undefined, 'solo true bloquea');
  // 2.22.0: un proyecto de antes con un solo lote → ese lote es el predio; con varios lotes sin predio → todos quedan como lotes sueltos
  const viejo = Store.toLots({ id: 'q', name: 'Q', lots: [{ id: 'x', name: 'Lote 1', points: [] }] }).lots[0];
  assert.deepEqual([viejo.kind, viejo.name, 'locked' in viejo], ['finca', 'Predio', false]);
  assert.equal(Store.toLots({ id: 'q', name: 'Q', lots: [{ id: 'x', name: 'La Vega', points: [] }] }).lots[0].name, 'La Vega', 'un nombre propio se conserva');
  const varios = Store.toLots({ id: 'q', name: 'Q', lots: [{ id: 'x', name: 'Lote 1', points: [] }, { id: 'y', name: 'Lote 2', points: [] }] }).lots;
  assert.deepEqual(varios.map((v) => v.kind + ':' + v.name), ['area:Lote 1', 'area:Lote 2']);
  const conPredio = Store.toLots({ id: 'q', name: 'Q', lots: [{ id: 'x', name: 'Lote 1', points: [] }, { id: 'f', name: 'F', kind: 'finca', points: [] }] }).lots;
  assert.deepEqual(conPredio.map((v) => v.kind), ['area', 'finca']);
});

test('copia de seguridad: lleva tipo, título y bloqueo; el área sigue en su finca aunque cambien los identificadores', () => {
  const uid = (() => { let n = 0; return () => 'n' + (++n); })();
  const mk = (lots) => Backup.validate({ app: Backup.APP, format: Backup.FORMAT, state: { projects: [{ id: 'p', name: 'P', lots, lotId: 'a' }], currentId: 'p', settings: {} }, memory: [] }, { uid });
  const r = mk([{ id: 'id con espacios', name: 'F', kind: 'finca', locked: true, points: [] }, { id: 'a', name: 'A', kind: 'area', cat: '<b>Cacao</b>', parent: 'id con espacios', points: [] },
    { id: 'b', name: 'B', kind: 'area', parent: 'a', cat: 'x'.repeat(99), points: [] }, { id: 'c', name: 'C', kind: 'area', parent: 'c', points: [] }, { id: 'd', name: 'D', kind: 'raro', locked: true, cat: 'x', points: [] }]);
  assert.deepEqual(r.errors, []);
  const [f, a, b, c, d] = r.data.projects[0].lots;
  assert.notEqual(f.id, 'id con espacios'); assert.equal(f.kind, 'finca'); assert.equal(f.locked, true);
  assert.equal(a.parent, f.id, 'apunta al id nuevo de su finca'); assert.equal(a.cat, '<b>Cacao</b>');
  assert.equal(b.parent, undefined, 'la «finca» que se pide es un área'); assert.equal(b.cat.length, 30);
  assert.equal(c.parent, undefined, 'no puede ser su propia finca');
  assert.deepEqual([d.kind, d.locked, d.cat], ['area', undefined, undefined]);      // 2.22.0: sin tipo válido queda como lote
  // y pasa por el almacén sin perderse
  const lots = Store.toLots(r.data.projects[0]).lots;
  assert.equal(lots[1].parent, lots[0].id); assert.equal(lots[0].locked, true);
});

test('mapa y croquis: las áreas llevan relleno de puntos; la finca y los lotes, liso', () => {
  const l = LOTS();
  const sh = Mapa.shapes({ points: l[1].points, mainColor: '#8BC34A', dots: true, locked: false,
    layers: [{ id: 'x', lot: true, lotId: 'f1', name: 'La Esperanza', kind: 'polygon', color: '#2F8F4E', visible: true, points: l[0].points },
      { id: 'y', lot: true, lotId: 'a2', dots: true, name: 'Cacaotera', kind: 'polygon', color: '#8E44AD', visible: true, points: l[2].points },
      { id: 'z', name: 'Importada', kind: 'polygon', color: '#111111', visible: true, points: l[3].points, dots: true }] }, {});
  assert.equal(sh.dots, true); assert.equal(sh.locked, false);
  assert.deepEqual(sh.layers.map((x) => !!x.dots), [false, true, false], 'una capa importada nunca lleva puntos');
  assert.equal(Mapa.shapes({ points: l[0].points, locked: true }, {}).locked, true); assert.equal(Mapa.shapes({ points: [] }, {}).dots, false);
  const svg = Diagram.polygonSVG(l[0].points, { color: '#2F8F4E', layers: [{ kind: 'polygon', color: '#8E44AD', visible: true, points: l[2].points, dots: true }, { kind: 'polygon', color: '#8BC34A', visible: true, points: l[1].points, dots: true },
    { kind: 'polygon', color: '#8E44AD', visible: true, points: l[4].points, dots: true }, { kind: 'polygon', color: 'malo', visible: true, points: l[3].points }] });
  assert.equal((svg.match(/<pattern /g) || []).length, 2, 'una trama por color');
  const ids = svg.match(/<pattern id="(dots-[0-9a-f]{6}-\d+)"/g).map((x) => x.slice(13, -1));
  for (const id of ids) assert.ok(svg.includes('fill="url(#' + id + ')"'), id);
  assert.match(svg, /^<svg[^>]*><defs><pattern/);
  assert.match(svg, / Z" fill="rgba\(47,143,78,0\.2\)"/, 'la finca, lisa');
  const propio = Diagram.polygonSVG(l[1].points, { color: '#8BC34A', dots: true });
  assert.match(propio, / Z" fill="url\(#dots-8bc34a-\d+\)" stroke="#8BC34A"/);
  assert.doesNotMatch(Diagram.polygonSVG(l[1].points, { color: '#8BC34A', dots: true, bad: true }), /<pattern/, 'con lados cruzados manda el aviso rojo');
  assert.doesNotMatch(Diagram.polygonSVG(l[1].points, { color: '#8BC34A' }), /<pattern|<defs>/);
  // dos planos en la misma página no repiten el nombre de la trama
  const otro = Diagram.polygonSVG(l[1].points, { color: '#8BC34A', dots: true });
  assert.notEqual(/id="(dots-[^"]+)"/.exec(propio)[1], /id="(dots-[^"]+)"/.exec(otro)[1]);
  assert.match(Diagram.polygonSVG(l[1].points, { color: 'verde', dots: true }), /<pattern id="dots-/);
});

const analyze = (points, climate) => Analysis.analyze({ points, climate }, { memory: new Climate.Memory() });
function parts() {
  const l = LOTS(), name = (id) => l.find((x) => x.id === id).name;
  return l.slice(0, 4).map((x) => ({ project: { name: 'Florecer', lotName: x.name, points: x.points, climate: { pManual: 1500 }, layers: [], mainColor: x.mainColor, dots: x.kind === 'area',
    lotMeta: { id: x.id, kind: x.kind || '', cat: x.cat || '', parent: x.parent || '', parentName: x.parent ? name(x.parent) : '' } }, a: analyze(x.points, { pManual: 1500 }), o: {} }));
}

test('reporte: cada polígono con su tipo, el porcentaje de la finca y el total sin contar dos veces', () => {
  const P = parts(), s = Report.summary(P);
  assert.equal(s.kinds, true);
  assert.deepEqual(s.rows.map((r) => r.tipo), ['Predio', 'Potrero · en «La Esperanza»', 'Cacaotera · en «La Esperanza»', '']);
  assert.match(s.rows[1].area, /^4,00 ha \(4,0 % del predio\)$/); assert.match(s.rows[0].area, /^100,0 ha$|^100,00 ha$|^100 ha$/);
  assert.match(s.totalText, /^101[,\d]* ha · /);                       // finca (100) + lote viejo (1); las áreas no se suman
  assert.equal(s.note, '4 polígonos · 2 zonas de vida · los lotes que están dentro de un predio no se suman otra vez');
  assert.deepEqual(s.fincas, ['La Esperanza: 2 lotes, 13,00 ha (13,0 %) · sin asignar 87,00 ha']);
  assert.equal(s.overlap, '');
  assert.deepEqual(P.map((p) => Report.lotTitle(p.project)), ['Predio: La Esperanza', 'Potrero: Potrero 1 (en «La Esperanza»)', 'Cacaotera: Cacaotera (en «La Esperanza»)', 'Lote: Lote viejo']);
  assert.equal(Report.kindText({}), ''); assert.equal(Report.kindText(null), ''); assert.equal(Report.kindText({ lotMeta: { kind: 'area' } }), 'Lote');
  assert.equal(Report.lotTitle({ name: 'X', lotMeta: { kind: 'area' } }), 'Lote: X');
  const h = Report.htmlAll({ name: 'Florecer' }, P, {});
  assert.match(h, /<th>Polígono<\/th>/);
  assert.match(h, /Potrero 1 <span class="small">· Potrero · en «La Esperanza»<\/span><\/td><td>4,00 ha \(4,0 % del predio\)<\/td>/);
  assert.match(h, /<p class="small">La Esperanza: 2 lotes, 13,00 ha \(13,0 %\) · sin asignar 87,00 ha\.<\/p>/);
  assert.match(h, /<h1 class="lt">Potrero: Potrero 1 \(en «La Esperanza»\)<\/h1>/);
  assert.match(h, /<pattern id="dots-8bc34a-\d+-L2"/, 'el croquis del área lleva puntos y un nombre propio en la página');
  const ids = h.match(/\bid="[^"]+"/g) || [];
  assert.equal(new Set(ids).size, ids.length);
  const t = Report.textAll({ name: 'Florecer' }, P, {});
  assert.match(t, /\n  Potrero 1 \[Potrero · en «La Esperanza»\]: 4,00 ha \(4,0 % del predio\) · /);
  assert.match(t, /\n  La Esperanza: 2 lotes, 13,00 ha \(13,0 %\) · sin asignar 87,00 ha\.\n/);
  const bl = ReportPdf.blocksAll({ name: 'Florecer' }, P, {}, {});
  assert.ok(bl.some((b) => b.t === 'table' && b.rows[1][0] === 'Potrero 1 · Potrero · en «La Esperanza»'));
  assert.ok(bl.some((b) => b.t === 'p' && /^La Esperanza: 2 lotes/.test(b.text)));
  assert.ok(bl.some((b) => b.t === 'h1' && b.text === 'Predio: La Esperanza'));
  assert.equal(new TextDecoder('latin1').decode(ReportPdf.buildAll({ name: 'Florecer' }, P, {}, {}).subarray(0, 5)), '%PDF-');
  // un área que se sale: el aviso va en el resumen
  const Q = parts(); Q[2].project.points = sq(900, 500, 300, 300); Q[2].a = analyze(Q[2].project.points, { pManual: 1500 });
  assert.match(Report.htmlAll({ name: 'F' }, Q, {}), /<b>Atención:<\/b> «Cacaotera» se sale del predio «La Esperanza»\./);
  // sin fincas ni áreas, el resumen dice «lotes», como antes
  const sin = parts().slice(3).concat(parts().slice(3));
  sin.forEach((p) => { delete p.project.lotMeta; });
  const ss = Report.summary(sin);
  assert.equal(ss.kinds, false); assert.match(ss.note, /^2 lotes · /); assert.deepEqual(ss.fincas, []);
  assert.match(Report.htmlAll({ name: 'F' }, sin, {}), /<th>Lote<\/th>/);
});

test('exportar: con fincas y áreas, el CSV y el Shapefile traen la columna de tipo; sin ellas quedan como antes', () => {
  const l = LOTS();
  const lots = [{ name: 'La Esperanza', tipo: 'Finca', points: l[0].points }, { name: 'Potrero 1', tipo: 'Potrero de La Esperanza', points: l[1].points }, { name: 'Lote viejo', points: l[3].points }];
  const csv = Gis.toCSV([], { style: 'es', lots }).replace(/^﻿/, '').split('\r\n');
  assert.match(csv[0], /^Lote;Tipo;Punto;Latitud;/);
  assert.match(csv[1], /^La Esperanza;Finca;P1;/); assert.match(csv[5], /^Potrero 1;Potrero de La Esperanza;P1;/); assert.match(csv[9], /^Lote viejo;Lote;P1;/);
  const viejo = Gis.toCSV([], { style: 'es', lots: lots.map((x) => ({ name: x.name, points: x.points })) }).replace(/^﻿/, '').split('\r\n');
  assert.match(viejo[0], /^Lote;Punto;Latitud;/);
  const campos = (b) => { const out = []; for (let o = 32; b[o] !== 0x0D; o += 32) { let n = ''; for (let k = 0; k < 11 && b[o + k]; k++) n += String.fromCharCode(b[o + k]); out.push(n); } return out; };
  const by = (m) => Object.fromEntries(Shp.files(m, 0).map((x) => [x.name, x.bytes]));
  const con = by({ name: 'F', base: 'f', lots });
  assert.deepEqual(campos(con['f_poligono.dbf']).slice(0, 3), ['LOTE', 'TIPO', 'NOMBRE']);
  assert.deepEqual(campos(con['f_puntos.dbf']).slice(0, 3), ['LOTE', 'TIPO', 'NOMBRE']);
  const txt = new TextDecoder().decode(con['f_poligono.dbf']);
  assert.ok(txt.includes('Potrero de La Esperanza') && txt.includes('Finca') && /Lote viejo +Lote /.test(txt));
  const sin = by({ name: 'F', base: 'f', lots: lots.map((x) => ({ name: x.name, points: x.points })) });
  assert.deepEqual(campos(sin['f_poligono.dbf']).slice(0, 2), ['LOTE', 'NOMBRE']);
});

test('adopt (2.22.0): un lote sin predio cuyo centro cae dentro de un predio pasa a pertenecerle; los demás no cambian', () => {
  const sq = (la, lo, d) => [{ lat: la, lon: lo }, { lat: la, lon: lo + d }, { lat: la + d, lon: lo + d }, { lat: la + d, lon: lo }];
  const lots = [
    { id: 'f', name: 'F', kind: 'finca', points: sq(4.6, -74.08, 0.01) },
    { id: 'in', name: 'Dentro', kind: 'area', points: sq(4.602, -74.078, 0.002) },
    { id: 'out', name: 'Fuera', kind: 'area', points: sq(4.7, -74.2, 0.002) },
    { id: 'ya', name: 'Ya', kind: 'area', parent: 'f', points: sq(4.604, -74.076, 0.001) },
    { id: 'v', name: 'Vacío', kind: 'area', points: [] },
    { id: 'f2', name: 'Abierto', kind: 'finca', points: sq(4.7, -74.2, 0.01).slice(0, 2) }
  ];
  assert.equal(Predio.adopt(lots), 1);
  assert.deepEqual(lots.map((l) => l.parent), [undefined, 'f', undefined, 'f', undefined, undefined]);
  assert.equal(Predio.adopt(lots), 0, 'la segunda vez no cambia nada');
  assert.equal(Predio.adopt(null), 0);
});

'use strict';
/* 2.34.3 — tarjeta profesional y firma (foto o dibujada con el dedo) al final del reporte. */
const test = require('node:test');
const assert = require('node:assert');
const Store = require('../www/js/store.js');
const Fotos = require('../www/js/fotos.js');
const Firma = require('../www/js/firma.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Analysis = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');

// JPEG de 1 × 1 píxel, en base64
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function analyze(points, climate) { return Analysis.analyze({ points, climate }, { memory: new Climate.Memory() }); }
function sample(lotName) {
  const points = [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 1800 }, { name: 'P2', lat: 4.6, lon: -74.09, alt: 1810 }, { name: 'P3', lat: 4.61, lon: -74.095, alt: 1830 }];
  const project = { name: 'Finca', lotName, points, climate: { pManual: 1500 }, layers: [], mainColor: '#2F8F4E' };
  return { project, a: analyze(points, project.climate) };
}
const FIRMADO = { date: Date.UTC(2026, 10, 25, 15), author: { name: 'Ana <b>Pérez</b>', org: 'Cía & Hnos', card: '25202-123 <i>', sign: JPG } };

test('2.34.3 autor: guarda la tarjeta profesional limpia y la firma solo si es JPEG; lo guardado antes se lee igual', () => {
  Store.setBackend({ getItem: () => JSON.stringify({ name: 'Ana', org: 'Finca', logo: JPG }), setItem() {}, removeItem() {} });     // de la 2.34.2 o antes
  assert.deepEqual(Store.loadAuthor(), { name: 'Ana', org: 'Finca', logo: JPG, card: '', sign: '' });
  const c = Store.cleanAuthor({ card: '  25202-123456\n CND\t', sign: JPG });
  assert.equal(c.card, '25202-123456 CND');
  assert.equal(c.sign, JPG);
  assert.equal(Store.cleanAuthor({ card: 'x'.repeat(100) }).card.length, Store.CARD_MAX);
  assert.equal(Store.cleanAuthor({ card: 12345 }).card, '');
  for (const bad of ['iVBORw0KGgo=', '/9j/<script>', '/9j/" onerror="x', '/9j/' + 'A'.repeat(Store.SIGN_MAX), 'data:image/jpeg;base64,' + JPG, 42, '/9j/A', null]) {
    assert.equal(Store.cleanAuthor({ sign: bad }).sign, '', String(bad).slice(0, 20));
  }
  const mem = {};
  Store.setBackend({ getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } });
  assert.equal(Store.saveAuthor({ name: 'Ana', card: '123', sign: JPG }).ok, true);
  assert.deepEqual(JSON.parse(mem['zvg.v1.author']), { name: 'Ana', org: '', logo: '', card: '123', sign: JPG }, 'en la misma clave de siempre');
  assert.ok(!('zvg.v1.state' in mem), 'aparte del estado: no va en la copia de seguridad');
});

test('2.34.3 foto de la firma: el papel queda blanco aunque tenga sombra, la tinta negra, y después se recorta a la firma', () => {
  const w = 200, h = 100, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, paper = 150 + Math.round(70 * x / (w - 1));              // papel con sombra: de 150 a 220 de brillo
      const ink = (y >= 45 && y <= 50 && x >= 60 && x <= 140) || (x >= 60 && x <= 65 && y >= 30 && y <= 70);
      const v = ink ? 40 : paper;
      d[i] = v; d[i + 1] = v; d[i + 2] = Math.min(255, v + 12); d[i + 3] = 255;
    }
  }
  assert.equal(Fotos.inkLevels(d, w, h), d);
  const at = (x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
  for (const [x, y] of [[0, 0], [w - 1, h - 1], [100, 85], [10, 50], [190, 10], [100, 53], [67, 60]]) assert.deepEqual(at(x, y), [255, 255, 255], 'papel en ' + x + ',' + y);
  for (const [x, y] of [[100, 47], [61, 46], [139, 50], [62, 31], [64, 69]]) assert.deepEqual(at(x, y), [0, 0, 0], 'tinta en ' + x + ',' + y);
  const box = Fotos.trimBox(d, w, h);
  assert.ok(box.x <= 60 && box.x + box.w - 1 >= 140 && box.y <= 30 && box.y + box.h - 1 >= 70, JSON.stringify(box));
  assert.ok(box.w < 100 && box.h < 60, 'se recorta cerca de la firma: ' + JSON.stringify(box));
  const u = new Uint8ClampedArray(16 * 16 * 4).fill(180);
  Fotos.inkLevels(u, 16, 16);
  assert.ok(u.every((v) => v === 255), 'un papel parejo queda todo blanco');
  assert.equal(Fotos.inkLevels(null, 2, 2), null);
  const corto = new Uint8ClampedArray(8);
  assert.equal(Fotos.inkLevels(corto, 4, 4), corto, 'datos que no alcanzan: no se toca nada');
});

test('2.34.3 firma dibujada: un toque no es firma; lo dibujado se recorta con margen y se agranda sin pasar de 600 × 240', () => {
  assert.equal(Firma.bounds([]), null);
  assert.equal(Firma.isEmpty([]), true);
  assert.equal(Firma.isEmpty([[{ x: 10, y: 10 }]]), true, 'un toque');
  assert.equal(Firma.isEmpty([[{ x: 10, y: 10 }, { x: 30, y: 10 }]]), true, 'un rayón de 20 píxeles');
  const s = [[{ x: 20, y: 40 }, { x: 120, y: 60 }, { x: 220, y: 30 }], [{ x: 100, y: 90 }, { x: 140, y: 100 }]];
  assert.deepEqual(Firma.bounds(s), { x0: 20, y0: 30, x1: 220, y1: 100 });
  assert.ok(Math.abs(Firma.length(s) - (Math.hypot(100, 20) + Math.hypot(100, 30) + Math.hypot(40, 10))) < 1e-9);
  assert.equal(Firma.isEmpty(s), false);
  const o = Firma.outSize(Firma.bounds(s), 12, 600, 240), k = Math.min(600 / 224, 240 / 94);       // 224 × 94 con el margen
  assert.deepEqual([o.w, o.h], [Math.round(224 * k), Math.round(94 * k)]);
  assert.ok(o.w <= Firma.MAX_W && o.h <= Firma.MAX_H && o.k > 1, 'se agranda: los trazos no pierden calidad');
  const alta = Firma.outSize({ x0: 0, y0: 0, x1: 100, y1: 300 }, 0, 600, 240);
  assert.deepEqual([alta.w, alta.h], [80, 240]);
});

test('2.34.3 reporte: la firma va al final, una sola vez, con nombre, tarjeta, entidad y el aviso de que no es firma digital', () => {
  const { project, a } = sample();
  const h = Report.html(project, a, FIRMADO);
  const i = h.indexOf('<section class="firma">');
  assert.ok(i > 0 && i < h.indexOf(Report.DISCLAIMER), 'antes de la advertencia final');
  assert.equal(h.split('<section class="firma">').length, 2, 'una sola vez');
  assert.match(h, /<section class="firma"><h2>Firma<\/h2><img class="firma-img" src="data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+" alt="Firma"><div class="firma-raya"><\/div><p class="firma-l"><b>Ana &lt;b&gt;Pérez&lt;\/b&gt;<\/b><\/p><p class="firma-l">Tarjeta profesional N\.º 25202-123 &lt;i&gt;<\/p><p class="firma-l">Cía &amp; Hnos<\/p><p class="small">Firma en imagen\. No es una firma digital \(Ley 527 de 1999\): no se puede verificar, cualquiera que reciba el reporte podría copiarla y, si alguien lo cambia, la firma sigue igual\.<\/p><\/section>/);
  assert.match(h, /\.firma\{margin-top:32px;break-inside:avoid/);
  const t = Report.text(project, a, FIRMADO).split('\n'), k = t.indexOf('Firma:');
  assert.deepEqual(t.slice(k - 1, k + 4), ['', 'Firma:', '  Ana <b>Pérez</b>', '  Tarjeta profesional N.º 25202-123 <i>', '  Cía & Hnos']);
  assert.equal(t[k + 4], '  La imagen de la firma va en el PDF y en el HTML. ' + Report.SIGN_NOTE);
  assert.deepEqual(t.slice(-2), ['', Report.DISCLAIMER]);
  const bl = ReportPdf.blocks(project, a, FIRMADO, {}), j = bl.findIndex((b) => b.t === 'sign');
  assert.ok(j > 0);
  assert.deepEqual(bl[j - 1], { t: 'h2', text: 'Firma' });
  assert.equal(bl[j].img.bytes[0], 0xFF);
  assert.deepEqual(bl[j].lines, ['Ana <b>Pérez</b>', 'Tarjeta profesional N.º 25202-123 <i>', 'Cía & Hnos']);
  assert.deepEqual(bl[j + 1], { t: 'p', small: true, text: Report.SIGN_NOTE });
  assert.equal(bl.filter((b) => b.t === 'sign').length, 1);
  assert.equal(bl[bl.length - 1].text, Report.DISCLAIMER);
  const pdf = new TextDecoder('latin1').decode(ReportPdf.build(project, a, FIRMADO, {}));
  assert.equal(pdf.slice(0, 5), '%PDF-');
  assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 1, 'la firma es la única imagen (sin logo)');
});

test('2.34.3 reporte de todo el proyecto: la firma va una sola vez, después del último lote (HTML, texto y PDF)', () => {
  const p1 = sample('Lote 1'), p2 = sample('Lote 2');
  const parts = [{ project: p1.project, a: p1.a, o: FIRMADO }, { project: p2.project, a: p2.a, o: FIRMADO }];
  const h = Report.htmlAll({ name: 'Finca' }, parts, FIRMADO);
  assert.equal(h.split('<section class="firma">').length, 2);
  assert.ok(h.indexOf('<section class="firma">') > h.lastIndexOf('<section class="lote">'));
  const t = Report.textAll({ name: 'Finca' }, parts, FIRMADO);
  assert.equal(t.split('\nFirma:\n').length, 2, 'una sola vez en el texto');
  assert.ok(t.indexOf('\nFirma:\n') > t.lastIndexOf('LOTE: Lote 2'));
  const B = ReportPdf.blocksAll({ name: 'Finca' }, parts, FIRMADO, {});
  assert.equal(B.filter((b) => b.t === 'sign').length, 1);
  assert.ok(B.findIndex((b) => b.t === 'sign') > B.map((b) => b.t).lastIndexOf('h1'));
  assert.equal(B[B.length - 1].text, Report.DISCLAIMER);
});

test('2.34.3 reporte: con la tarjeta y sin firma queda la raya para firmar a mano, sin aviso; sin tarjeta ni firma no hay bloque', () => {
  const { project, a } = sample();
  const o = { author: { name: 'Ana', card: '123' } };
  assert.match(Report.html(project, a, o), /<section class="firma"><h2>Firma<\/h2><div class="firma-sin"><\/div><div class="firma-raya"><\/div><p class="firma-l"><b>Ana<\/b><\/p><p class="firma-l">Tarjeta profesional N\.º 123<\/p><\/section>/);
  assert.doesNotMatch(Report.html(project, a, o), /Ley 527/);
  const t = Report.text(project, a, o).split('\n'), k = t.indexOf('Firma:');
  assert.deepEqual(t.slice(k, k + 3), ['Firma:', '  Ana', '  Tarjeta profesional N.º 123']);
  assert.doesNotMatch(Report.text(project, a, o), /La imagen de la firma/);
  const bl = ReportPdf.blocks(project, a, o, {}), sg = bl.find((b) => b.t === 'sign');
  assert.equal(sg.img, null);
  assert.deepEqual(sg.lines, ['Ana', 'Tarjeta profesional N.º 123']);
  assert.ok(!bl.some((b) => b.text === Report.SIGN_NOTE));
  const pdf = new TextDecoder('latin1').decode(ReportPdf.build(project, a, o, {}));
  assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 0);
  for (const oo of [{}, { author: { name: 'Ana', org: 'X', logo: JPG } }, { author: { sign: '/9j/" onerror="x' } }, { author: { card: '   ' } }]) {
    assert.equal(Report.signOf(oo), null, JSON.stringify(oo).slice(0, 60));
    assert.doesNotMatch(Report.html(project, a, oo), /class="firma"/);
    assert.doesNotMatch(Report.text(project, a, oo), /^Firma:$/m);
    assert.ok(!ReportPdf.blocks(project, a, oo, {}).some((b) => b.t === 'sign'));
  }
});

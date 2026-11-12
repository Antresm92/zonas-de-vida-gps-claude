'use strict';
/* Reporte en PDF: qué gráficas pide, cómo se convierten a imagen, qué bloques arma y que el PDF final sea válido y diga lo mismo que el HTML. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Pdf = require('../www/js/pdf.js');
const WL = require('../www/js/walter-lieth.js');
const J = require('./helpers/jpegs.js');

const DATE = Date.UTC(2026, 10, 6, 12);
const PUNTOS = [
  { name: 'P1', lat: 4.60, lon: -74.10, alt: 1800, color: '#D8353C' }, { name: 'P2', lat: 4.60, lon: -74.09, alt: 2400 },
  { name: 'P3', lat: 4.61, lon: -74.09, alt: 3000 }, { name: 'P4', lat: 4.61, lon: -74.10, alt: 2500 }
];
const T = [13, 13.5, 14, 14.2, 14.3, 13.8, 13.2, 13.4, 13.9, 14, 14, 13.5];
const P = [40, 60, 100, 150, 120, 60, 40, 45, 90, 160, 140, 70];
const b64 = (u8) => Buffer.from(u8).toString('base64');
const JPEG_URL = (u8) => 'data:image/jpeg;base64,' + b64(u8);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%"><rect width="400" height="200" fill="#2F8F4E"/></svg>';

function build(over) {
  const project = Object.assign({ name: 'Finca La Esperanza', points: PUNTOS, climate: { pManual: 1100 }, layers: [], mainColor: '#2F8F4E' }, over || {});
  const a = A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() });
  return { project, a };
}
function walter() {
  const d = WL.compute(T, P);
  return { svg: WL.svg(d, { id: 'wlx' }), lines: WL.summary(d), source: 'Datos de NASA POWER.' };
}
const ALL = (images) => Object.assign({ croquis: { bytes: J.RGB }, satelital: { bytes: J.RGB }, topo: { bytes: J.GRAY }, perfil: { bytes: J.RGB }, walter: { bytes: J.RGB }, holdridge: { bytes: J.RGB } }, images || {});
const types = (bl) => bl.map((b) => b.t);
const h2s = (bl) => bl.filter((b) => b.t === 'h2').map((b) => b.text);

/* ---------- Gráficas que hay que convertir ---------- */
test('sketches: con 2 o más puntos pide croquis, perfil, Walter-Lieth y Holdridge; los mapas y el diagrama con más píxeles', () => {
  const { project, a } = build();
  const list = ReportPdf.sketches(project, a, { walter: walter(), satellite: { svg: SVG }, topo: { svg: SVG } });
  assert.deepEqual(list.map((s) => s.key), ['croquis', 'satelital', 'topo', 'perfil', 'walter', 'holdridge']);
  list.forEach((s) => assert.match(s.svg, /^<svg /));
  assert.equal(list.find((s) => s.key === 'satelital').px, 1600);
  assert.equal(list.find((s) => s.key === 'topo').px, 1600);
  assert.equal(list.find((s) => s.key === 'holdridge').px, 2800);
  assert.equal(list.find((s) => s.key === 'croquis').px, undefined);
});
test('sketches: sin lo que no hay no pide nada de más', () => {
  const { project, a } = build();
  assert.deepEqual(ReportPdf.sketches(project, a, {}).map((s) => s.key), ['croquis', 'perfil', 'holdridge']);
  assert.deepEqual(ReportPdf.sketches(project, a).map((s) => s.key), ['croquis', 'perfil', 'holdridge']);
  assert.deepEqual(ReportPdf.sketches(project, a, { satellite: { unavailable: 'sin internet' }, topo: {} }).map((s) => s.key), ['croquis', 'perfil', 'holdridge']);
  const solo = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1, alt: 1800 }] });
  assert.deepEqual(ReportPdf.sketches(solo.project, solo.a, {}).map((s) => s.key), ['holdridge']);
  const sinAlt = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }, { name: 'P2', lat: 4.61, lon: -74.1 }, { name: 'P3', lat: 4.61, lon: -74.09 }], climate: {} });
  assert.deepEqual(ReportPdf.sketches(sinAlt.project, sinAlt.a, {}).map((s) => s.key), ['croquis']);
});

/* ---------- SVG → JPEG ---------- */
test('svgSize y sized: tamaño del viewBox y ancho/alto en píxeles', () => {
  assert.deepEqual(ReportPdf.svgSize(SVG), { w: 400, h: 200 });
  assert.deepEqual(ReportPdf.svgSize('<svg viewBox="-5 -5 120.5,60.25" height="10">'), { w: 120.5, h: 60.25 });
  assert.equal(ReportPdf.svgSize('<svg width="10" height="10"></svg>'), null);
  assert.equal(ReportPdf.svgSize('<svg viewBox="0 0 0 5"></svg>'), null);
  assert.equal(ReportPdf.svgSize('no es un svg'), null);
  assert.equal(ReportPdf.svgSize(null), null);
  const s = ReportPdf.sized(SVG, 800, 400);
  assert.match(s, /^<svg width="800" height="400" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 400 200"><rect/);
  assert.doesNotMatch(s, /100%/);
  assert.match(ReportPdf.sized('<svg viewBox="0 0 4 2" height="9">x</svg>', 40, 20), /^<svg width="40" height="20" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 4 2">x<\/svg>$/);
});

// Navegador de mentira: Image carga lo que se le pida, el lienzo devuelve un «blob» con los bytes que se elijan
function fakeEnv(o) {
  o = o || {};
  const log = { created: [], revoked: [], fills: 0, draws: [], toBlobs: [] };
  const bytes = o.bytes || J.RGB;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  class Img { set src(v) { this._src = v; setTimeout(() => { if (o.imgError) this.onerror(); else this.onload(); }, 0); } }
  function canvas() {
    const c = { width: 0, height: 0 };
    c.getContext = () => (o.noCtx ? null : {
      fillStyle: '',
      fillRect() { log.fills++; },
      drawImage(img, x, y, w, h) { log.draws.push([w, h]); if (o.drawThrows) throw new Error('lienzo'); }
    });
    c.toBlob = (cb, type, q) => { log.toBlobs.push([c.width, c.height, type, q]); cb(o.noBlob ? null : { arrayBuffer: () => Promise.resolve(buffer) }); };
    return c;
  }
  return {
    log,
    Image: Img,
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts.type; } },
    URL: { createObjectURL(b) { log.created.push(b); return 'blob:x' + log.created.length; }, revokeObjectURL(u) { log.revoked.push(u); if (o.revokeThrows) throw new Error('no'); } },
    document: { createElement: canvas }
  };
}

test('rasterize: dibuja el SVG en un lienzo blanco al ancho pedido y devuelve los bytes del JPEG', async () => {
  const env = fakeEnv();
  const r = await ReportPdf.rasterize(SVG, 800, env);
  assert.equal(r.w, 48); assert.equal(r.h, 32);                        // lo que mide el JPEG de mentira
  assert.deepEqual([...r.bytes.subarray(0, 2)], [0xFF, 0xD8]);
  assert.deepEqual(env.log.draws, [[800, 400]]);                       // alto según el viewBox 400 × 200
  assert.deepEqual(env.log.toBlobs, [[800, 400, 'image/jpeg', 0.92]]);
  assert.equal(env.log.fills, 1);
  assert.equal(env.log.created.length, 1);
  assert.equal(env.log.created[0].type, 'image/svg+xml;charset=utf-8');
  assert.match(env.log.created[0].parts[0], /width="800" height="400"/);
  assert.deepEqual(env.log.revoked, ['blob:x1']);
  // sin ancho pedido usa el de siempre
  const e2 = fakeEnv();
  await ReportPdf.rasterize(SVG, undefined, e2);
  assert.equal(e2.log.draws[0][0], ReportPdf.PX);
});
test('rasterize: cada falla deja un error claro y suelta el archivo temporal', async () => {
  await assert.rejects(ReportPdf.rasterize('<svg width="3"></svg>', 100, fakeEnv()), /no tiene tamaño/);
  const e1 = fakeEnv({ imgError: true });
  await assert.rejects(ReportPdf.rasterize(SVG, 100, e1), /No se pudo dibujar un gráfico/);
  assert.equal(e1.log.revoked.length, 1);
  const e2 = fakeEnv({ noCtx: true });
  await assert.rejects(ReportPdf.rasterize(SVG, 100, e2), /no puede preparar los gráficos/);
  assert.equal(e2.log.revoked.length, 1);
  await assert.rejects(ReportPdf.rasterize(SVG, 100, fakeEnv({ drawThrows: true })), /lienzo/);
  const e3 = fakeEnv({ noBlob: true });
  await assert.rejects(ReportPdf.rasterize(SVG, 100, e3), /No se pudo preparar un gráfico/);
  assert.equal(e3.log.revoked.length, 1);
  await assert.rejects(ReportPdf.rasterize(SVG, 100, fakeEnv({ bytes: new Uint8Array([1, 2, 3, 4]) })), /No se pudo preparar un gráfico/);
  await assert.rejects(ReportPdf.rasterize(SVG, 100, fakeEnv({ bytes: J.CMYK })), /No se pudo preparar un gráfico/);
  // que soltar el archivo falle no estorba
  const r = await ReportPdf.rasterize(SVG, 100, fakeEnv({ revokeThrows: true }));
  assert.equal(r.w, 48);
});
test('rasterizeAll: lo que falla queda sin imagen y lo demás sigue', async () => {
  let n = 0;
  const env = fakeEnv();
  const orig = env.document.createElement;
  env.document.createElement = () => { const c = orig(); if (++n === 2) c.getContext = () => null; return c; };
  const images = await ReportPdf.rasterizeAll([{ key: 'a', svg: SVG }, { key: 'b', svg: SVG }, { key: 'c', svg: SVG, px: 321 }, { key: 'd', svg: 'nada' }], 500, env);
  assert.deepEqual(Object.keys(images).sort(), ['a', 'c']);
  assert.deepEqual(env.log.draws.map((d) => d[0]), [500, 321]);        // la que pide sus píxeles los usa
  assert.deepEqual(await ReportPdf.rasterizeAll([], 500, env), {});
});

/* ---------- Bloques ---------- */
test('blocks: reporte completo, con todas las secciones del HTML y en su orden', () => {
  const { project, a } = build({ weatherNow: { T: 18.2, code: 2, wind: 7.2, pressure: 760, humidity: 71, sunrise: '05:44', sunset: '17:41', at: DATE },
    layers: [{ id: 'l1', name: 'Lote vecino', kind: 'polygon', color: '#E67E22', visible: true, points: [{ lat: 4.62, lon: -74.1 }, { lat: 4.62, lon: -74.09 }, { lat: 4.63, lon: -74.09 }] }] });
  const o = { date: DATE, walter: walter(), satellite: { svg: SVG, caption: 'Imagen de Esri.' }, topo: { svg: SVG, caption: 'Mapa topográfico.' } };
  const bl = ReportPdf.blocks(project, a, o, ALL());
  assert.deepEqual(h2s(bl), ['Datos del clima', 'Clima actual', 'Terreno', 'Puntos', 'Croquis', 'Croquis satelital', 'Croquis topográfico', 'Perfil del relieve',
    'Zonas según la altitud de cada punto', 'Calidad de los datos', 'Diagrama de Walter-Lieth', 'Diagrama de Holdridge']);
  assert.equal(bl[0].text, 'Reporte de zona de vida');
  assert.match(bl[1].text, /^Finca La Esperanza · .*2026/);
  assert.equal(bl[2].t, 'zone');
  assert.match(bl[2].name, /Bosque/);
  assert.match(bl[2].detail, /Región latitudinal: .* · Piso altitudinal: .*Provincia de humedad/);
  // puntos con su color (el propio o el del proyecto) y la altitud
  const puntos = bl[bl.findIndex((b) => b.text === 'Puntos') + 1];
  assert.equal(puntos.t, 'table');
  assert.deepEqual(puntos.rows.map((r) => r[2]), ['#D8353C', '#2F8F4E', '#2F8F4E', '#2F8F4E']);
  assert.match(puntos.rows[0][1], /^4\.60000, -74\.10000 · 1800 m · E 4\.878\.031 m · N 2\.066\.389 m$/);
  // la leyenda aparece porque hay una capa importada
  const leyenda = bl.find((b) => b.t === 'legend');
  assert.deepEqual(leyenda.items, [['#2F8F4E', 'Mis puntos'], ['#E67E22', 'Lote vecino']]);
  // clima actual con su nota; los croquis con su imagen y su leyenda
  const clima = bl.findIndex((b) => b.text === 'Clima actual');
  assert.equal(bl[clima + 1].rows.length, 7);
  assert.match(bl[clima + 2].text, /Actualizado: .* · Open-Meteo\. Condiciones del momento/);
  const sat = bl[bl.findIndex((b) => b.text === 'Croquis satelital') + 1];
  assert.deepEqual([sat.t, sat.caption], ['image', 'Imagen de Esri.']);
  // el diagrama de Holdridge va en hoja aparte y el descargo cierra el documento
  const iH = bl.findIndex((b) => b.text === 'Diagrama de Holdridge');
  assert.equal(bl[iH - 1].t, 'pagebreak');
  assert.equal(bl[bl.length - 1].text, Report.DISCLAIMER);
  assert.equal(bl.filter((b) => b.t === 'image').length, 6);
});

test('blocks: sin imágenes dice que no se pudo dibujar, y los croquis no preparados dicen por qué', () => {
  const { project, a } = build();
  const bl = ReportPdf.blocks(project, a, { date: DATE, walter: walter(), satellite: { unavailable: 'Sin conexión.' }, topo: { svg: SVG } });
  const notas = bl.filter((b) => b.t === 'note').map((b) => b.text);
  assert.ok(notas.includes('No se pudo preparar el croquis satelital: Sin conexión.'));
  assert.ok(notas.includes('No se pudo dibujar el croquis topográfico en el PDF.'));
  assert.ok(notas.includes('No se pudo dibujar el croquis en el PDF.'));
  assert.ok(notas.includes('No se pudo dibujar el perfil del relieve en el PDF.'));
  assert.ok(notas.includes('No se pudo dibujar el diagrama de Walter-Lieth en el PDF.'));
  assert.ok(notas.includes('No se pudo dibujar el diagrama de Holdridge en el PDF.'));
  const sin = ReportPdf.blocks(project, a, { date: DATE, satellite: {} }, {});
  assert.ok(sin.some((b) => b.t === 'note' && b.text === 'No se pudo preparar el croquis satelital.'));
  // una imagen sin bytes cuenta como que no hay
  assert.ok(ReportPdf.blocks(project, a, { date: DATE }, { croquis: {} }).some((b) => b.text === 'No se pudo dibujar el croquis en el PDF.'));
});

test('blocks: resultado incompleto, un solo punto, sin puntos y sin datos del clima', () => {
  const parcial = build({ climate: {} });
  const b1 = ReportPdf.blocks(parcial.project, parcial.a, { date: DATE }, {});
  assert.ok(b1.some((b) => b.t === 'note' && /^Resultado incompleto: falta la precipitación anual\.$/.test(b.text)));
  assert.equal(b1.some((b) => b.t === 'zone'), false);
  const vacio = build({ points: [], climate: {} });
  const b2 = ReportPdf.blocks(vacio.project, vacio.a, { date: DATE }, {});
  assert.ok(b2.some((b) => b.t === 'note' && /falta la altitud o la temperatura/.test(b.text)));
  assert.deepEqual(h2s(b2), []);                                          // sin puntos no hay terreno, ni puntos, ni clima
  const uno = build({ points: [{ name: '', lat: 4.6, lon: -74.1, alt: 1800 }] });
  const b3 = ReportPdf.blocks(uno.project, uno.a, { date: DATE }, {});
  assert.deepEqual(h2s(b3).filter((h) => /Croquis|Perfil/.test(h)), []);
  const tabla = b3[b3.findIndex((b) => b.text === 'Puntos') + 1];
  assert.equal(tabla.rows[0][0], 'P1');                                    // sin nombre: P1
  assert.equal(b3.find((b) => b.text === 'Terreno') && b3[b3.findIndex((b) => b.text === 'Terreno') + 1].rows.some((r) => r[0] === 'Perímetro'), false);
});

test('blocks: perfil sin altitudes, avisos del análisis y notas de la temperatura', () => {
  const sinAlt = build({ points: [{ name: 'P1', lat: 4.6, lon: -74.1 }, { name: 'P2', lat: 4.61, lon: -74.1 }, { name: 'P3', lat: 4.61, lon: -74.09 }] });
  const bl = ReportPdf.blocks(sinAlt.project, sinAlt.a, { date: DATE }, ALL());
  const i = bl.findIndex((b) => b.text === 'Perfil del relieve');
  assert.equal(bl[i + 1].t, 'note');                                       // el motivo que da Perfil
  const bad = build({ points: [{ name: 'A', lat: 4.6, lon: -74.1, alt: 100 }, { name: 'B', lat: 4.61, lon: -74.09, alt: 120 }, { name: 'C', lat: 4.6, lon: -74.09, alt: 110 }, { name: 'D', lat: 4.61, lon: -74.1, alt: 130 }] });
  const b2 = ReportPdf.blocks(bad.project, bad.a, { date: DATE }, ALL());
  assert.ok(b2.some((b) => b.t === 'h2' && b.text === 'Calidad de los datos'));
  assert.ok(b2.some((b) => b.t === 'note' && /se cruzan/.test(b.text)));   // el aviso del polígono cruzado sale como recuadro
});

test('blocks: fotos por punto, con la principal primero; las que faltan o no son JPEG no se dibujan', () => {
  const pts = [
    { name: 'Alto', lat: 4.60, lon: -74.10, alt: 1800, photos: [{ id: 'f1' }, { id: 'f2' }, { id: 'nofoto' }, { id: 'png' }, { id: 'raro' }, null, {}] },
    { name: '', lat: 4.60, lon: -74.09, alt: 2400, photos: [{ id: 'f3' }], color: '#8E44AD' },
    { name: 'Sin fotos', lat: 4.61, lon: -74.09, alt: 3000, photos: [] },
    { name: 'Raras', lat: 4.61, lon: -74.10, alt: 2500, photos: [{ id: 'png' }] },
    { name: 'Otro', lat: 4.62, lon: -74.10, alt: 2500 }
  ];
  const { project, a } = build({ points: pts });
  const map = { f1: JPEG_URL(J.RGB), f2: JPEG_URL(J.GRAY), f3: JPEG_URL(J.RGB), png: 'data:image/png;base64,AAAA', raro: JPEG_URL(J.RGB).slice(0, -1) + '!', cmyk: JPEG_URL(J.CMYK) };
  const bl = ReportPdf.blocks(project, a, { date: DATE, photos: map }, {});
  const i = bl.findIndex((b) => b.text === 'Fotos de los puntos');
  assert.ok(i > 0);
  assert.deepEqual(types(bl.slice(i, i + 5)), ['h2', 'h3', 'gallery', 'h3', 'gallery']);
  assert.equal(bl[i + 1].text, 'Alto');
  assert.deepEqual(bl[i + 2].items.map((x) => x.caption), ['Principal', 'Foto 2']);
  assert.ok(bl[i + 2].items.every((x) => x.img.bytes instanceof Uint8Array));
  assert.equal(bl[i + 3].text, 'P2');
  assert.equal(bl[i + 3].color, '#8E44AD');
  assert.match(bl[i + 5].text, /^Fotos reducidas para este reporte/);
  // sin mapa de fotos o con uno que no sirve no sale la sección
  const none = ReportPdf.blocks(project, a, { date: DATE }, {});
  assert.equal(none.some((b) => b.text === 'Fotos de los puntos'), false);
  const raro = ReportPdf.blocks(project, a, { date: DATE, photos: { f1: JPEG_URL(J.CMYK), f3: 5 } }, {});
  assert.equal(raro.some((b) => b.text === 'Fotos de los puntos'), false);
});

/* ---------- El PDF ---------- */
test('build: PDF válido con el contenido del reporte y los metadatos del proyecto', () => {
  const { project, a } = build({ weatherNow: { T: 18.2, code: 2, at: DATE } });
  const pdf = ReportPdf.build(project, a, { date: DATE, walter: walter(), photos: { f1: JPEG_URL(J.RGB) }, satellite: { svg: SVG, caption: 'Imagen satelital.' } }, ALL());
  const s = Buffer.from(pdf).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.match(s, /\/CreationDate \(D:20261106120000Z\)/);
  assert.ok(s.toUpperCase().includes('<FEFF'), 'metadatos en UTF-16');
  assert.ok((s.match(/\/Subtype \/Image /g) || []).length >= 1);
  const texto = (s.match(/<([0-9a-f]+)> Tj/g) || []).map((t) => Buffer.from(/<([0-9a-f]+)>/.exec(t)[1], 'hex').toString('latin1')).join('\n');
  assert.match(texto, /Reporte de zona de vida/);
  assert.match(texto, /Finca La Esperanza/);
  assert.match(texto, /Clima actual/);
  assert.match(texto, /Diagrama de Holdridge/);
  assert.match(texto, /Clasificaci.n bioclim.tica orientativa/);
  assert.match(texto, /P.gina 1 de \d/);
  // sin opciones ni imágenes también arma un PDF
  assert.ok(ReportPdf.build(project, a).length > 1000);
  assert.ok(ReportPdf.build(project, a, undefined, undefined).length > 1000);
});

function tiene(cmd) { return spawnSync('which', [cmd]).status === 0; }
test('herramientas externas: qpdf lo da por válido y pdftotext lee los mismos datos que el HTML', { skip: !(tiene('qpdf') && tiene('pdftotext')) }, () => {
  const { project, a } = build({ weatherNow: { T: 18.2, code: 2, wind: 7.2, pressure: 760, humidity: 71, sunrise: '05:44', sunset: '17:41', at: DATE } });
  const o = { date: DATE, walter: walter(), photos: { f1: JPEG_URL(J.RGB) }, satellite: { svg: SVG, caption: 'Imagen satelital.' } };
  project.points = project.points.map((p, i) => i === 0 ? Object.assign({}, p, { photos: [{ id: 'f1' }] }) : p);
  const pdf = ReportPdf.build(project, A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() }), o, ALL());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpdf-'));
  const f = path.join(dir, 'r.pdf');
  fs.writeFileSync(f, pdf);
  const q = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' });
  assert.equal(q.status, 0, q.stdout + q.stderr);
  assert.doesNotMatch(q.stdout + q.stderr, /WARNING/);
  const t = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
  Report.rows(project, a).forEach((r) => assert.ok(t.replace(/\s+/g, ' ').includes(r[0]), 'falta «' + r[0] + '»'));
  assert.match(t, /Finca La Esperanza/);
  assert.match(t, /Fotos de los puntos/);
  assert.match(t, /Principal/);
  assert.match(t, /Imagen satelital\./);
  assert.match(t, /Condici.n\s+Parcialmente nublado|Condici.n\s+\S/);
  assert.match(t, /Mes seco/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('blocks: la nota del margen de error, la fila del área y el perímetro traen sus números completos', () => {
  const { project, a } = build();
  const bl = ReportPdf.blocks(project, a, { date: DATE }, ALL());
  const nota = bl.find((b) => b.t === 'p' && /^Con el margen de error de los datos/.test(b.text));
  assert.ok(nota, 'hay zonas vecinas posibles');
  assert.match(nota.text, /^Con el margen de error de los datos \(±\d+(,\d)? °C y ±\d+ % en precipitación, supuestos\) el punto también podría caer en: .+ \([a-z]+-[A-Za-z]+\)(; .+)*\.$/);
  const t = bl[bl.findIndex((b) => b.text === 'Terreno') + 1].rows;
  assert.match(t[0][1], /^[\d.,]+ ha · [\d.,]+ m² · [\d.,]+ fanegadas$/);
  assert.deepEqual(t.map((r) => r[0]), ['Área', 'Perímetro', 'Centro']);
  assert.match(t[1][1], /^[\d.,]+ (m|km)$/);
  assert.equal(/NaN|undefined/.test(JSON.stringify(bl)), false);
});

test('blocks: con exactamente 2 puntos ya hay croquis, perfil y perímetro; con 1 no', () => {
  const dos = build({ points: PUNTOS.slice(0, 2) });
  const b2 = ReportPdf.blocks(dos.project, dos.a, { date: DATE }, ALL());
  assert.ok(h2s(b2).includes('Croquis') && h2s(b2).includes('Perfil del relieve'));
  assert.ok(b2[b2.findIndex((b) => b.text === 'Terreno') + 1].rows.some((r) => r[0] === 'Perímetro'));
  const uno = build({ points: PUNTOS.slice(0, 1) });
  const b1 = ReportPdf.blocks(uno.project, uno.a, { date: DATE }, ALL());
  assert.equal(h2s(b1).includes('Croquis') || h2s(b1).includes('Perfil del relieve'), false);
});

test('blocks: el color de «Mis puntos» en la leyenda es el del proyecto si es válido y el verde de siempre si no', () => {
  const colorDe = (mainColor) => { const { project, a } = build({ mainColor, layers: [{ id: 'l1', name: 'Lote', kind: 'polygon', color: '#E67E22', visible: true, points: [{ lat: 4.62, lon: -74.1 }, { lat: 4.62, lon: -74.09 }, { lat: 4.63, lon: -74.09 }] }] }); return ReportPdf.blocks(project, a, { date: DATE }, ALL()).find((b) => b.t === 'legend').items[0]; };
  assert.deepEqual(colorDe('#3366CC'), ['#3366CC', 'Mis puntos']);
  assert.deepEqual(colorDe('rojo'), ['#2F8F4E', 'Mis puntos']);
  assert.deepEqual(colorDe(undefined), ['#2F8F4E', 'Mis puntos']);
  assert.deepEqual(colorDe(''), ['#2F8F4E', 'Mis puntos']);
});

test('blocks: «Calidad de los datos» lleva la frase de calidad y las notas de la temperatura; el diagrama de Holdridge trae el nombre de cada punto', () => {
  const { project, a } = build();
  const bl = ReportPdf.blocks(project, a, { date: DATE }, ALL());
  const i = bl.findIndex((b) => b.text === 'Calidad de los datos');
  assert.ok(i > 0);
  assert.deepEqual([bl[i + 1].t, bl[i + 1].text], ['p', Report.QUALITY[a.quality]]);
  assert.ok(a.climate.notes.length >= 1);
  a.climate.notes.forEach((n) => assert.ok(bl.some((b) => b.t === 'p' && b.small && b.text === n), 'falta la nota: ' + n));
  const nombres = PUNTOS.map((p) => p.name);
  const svg = ReportPdf.sketches(project, a, {}).find((s) => s.key === 'holdridge').svg;
  nombres.forEach((n) => assert.ok(svg.includes('>' + n + '<') || svg.includes(n), 'el diagrama no trae «' + n + '»'));
});
test('svgSize: un viewBox con ancho o alto cero no sirve', () => {
  const con = (vb) => ReportPdf.svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '"></svg>');
  assert.deepEqual(con('0 0 400 200'), { w: 400, h: 200 });
  assert.equal(con('0 0 0 200'), null);
  assert.equal(con('0 0 400 0'), null);
});

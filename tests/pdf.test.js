'use strict';
/* Escritor de PDF: texto en CP1252, anchos de Helvetica, JPEG, estructura del archivo (tabla de referencias exacta) y páginas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Pdf = require('../www/js/pdf.js');
const J = require('./helpers/jpegs.js');

const latin = (u8) => Buffer.from(u8).toString('latin1');

// Lee un PDF de los que escribe este módulo: devuelve las páginas y comprueba que cada referencia apunte donde dice
function inspect(bytes) {
  const s = latin(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'), 'cabecera');
  assert.ok(s.endsWith('%%EOF\n'), 'final');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1]);
  assert.equal(s.slice(start, start + 4), 'xref', 'startxref apunta a la tabla');
  const m = /xref\n0 (\d+)\n/.exec(s.slice(start));
  const count = Number(m[1]);
  const lines = s.slice(start + m[0].length).split('\n').slice(0, count);
  assert.equal(lines[0], '0000000000 65535 f ');
  for (let n = 1; n < count; n++) {
    const off = Number(lines[n].slice(0, 10));
    assert.equal(s.slice(off, off + (n + ' 0 obj\n').length), n + ' 0 obj\n', 'objeto ' + n + ' en su posición');
  }
  assert.equal(Number(/\/Size (\d+)/.exec(s.slice(start))[1]), count);
  // ningún número del dibujo salió mal (una cuenta con un dato que falta deja «NaN» o «undefined» en el texto del contenido)
  [...s.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g)].forEach((m) => { const mal = /.{0,40}(NaN|undefined|Infinity).{0,20}/.exec(m[1]); assert.ok(!mal, 'números inválidos en el dibujo: ' + (mal && mal[0])); });
  const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(s)[1]);
  assert.equal((s.match(/\/Type \/Page /g) || []).length, pages);
  return { s, pages, count };
}
const pageText = (s) => (s.match(/<([0-9a-f]+)> Tj/g) || []).map((t) => Buffer.from(/<([0-9a-f]+)>/.exec(t)[1], 'hex').toString('latin1'));

/* ---------- Texto ---------- */
test('norm: tildes y ñ se conservan; lo que CP1252 no tiene se cambia por algo parecido', () => {
  assert.equal(Pdf.norm('Camión ñandú ¿qué? ¡sí! 25 °C ± 3 · µ'), 'Camión ñandú ¿qué? ¡sí! 25 °C ± 3 · µ');
  assert.equal(Pdf.norm('a ≥ b ≤ c → d ← e ↔ f − g ≈ h ≠ i'), 'a >= b <= c -> d <- e <-> f - g ~ h != i');
  assert.equal(Pdf.norm('✓ ✗ ∞ ′ ″ ⁄ ‑'), 'si no inf. \' " / -');
  assert.equal(Pdf.norm('x\u2009y\u202fz'), 'x y z');
});
test('norm: comillas, rayas, euro y puntos suspensivos usan sus códigos de Windows', () => {
  const s = Pdf.norm('“a” ‘b’ – — … • € ™ Š š Œ œ Ž ž Ÿ ‚ ƒ „ † ‡ ˆ ‰ ‹ › ˜');
  const codes = [...s].map((c) => c.charCodeAt(0));
  [0x93, 0x94, 0x91, 0x92, 0x96, 0x97, 0x85, 0x95, 0x80, 0x99, 0x8A, 0x9A, 0x8C, 0x9C, 0x8E, 0x9E, 0x9F, 0x82, 0x83, 0x84, 0x86, 0x87, 0x88, 0x89, 0x8B, 0x9B, 0x98]
    .forEach((c) => assert.ok(codes.includes(c), 'falta 0x' + c.toString(16)));
  assert.ok(codes.every((c) => c <= 255));
});
test('norm: lo desconocido queda como «?», lo invisible se quita y las letras raras pierden el acento', () => {
  assert.equal(Pdf.norm('ok 😀 ok'), 'ok ? ok');
  assert.equal(Pdf.norm('ā ē ő'), 'a e o');
  assert.equal(Pdf.norm('中'), '?');
  assert.equal(Pdf.norm('a\u200Bb\uFEFFc\r\td\u0001e\u0085f'), 'abc def');
  assert.equal(Pdf.norm('uno\ndos'), 'uno\ndos');
  assert.equal(Pdf.norm(null), '');
  assert.equal(Pdf.norm(undefined), '');
  assert.equal(Pdf.norm(12.5), '12.5');
});

test('anchos: valores del AFM de Helvetica (regular y negrita)', () => {
  assert.equal(Pdf.widthOf('Hola', 10, false), 20.56);             // 722 + 556 + 222 + 556
  assert.equal(Pdf.widthOf('Hola', 10, true), 21.67);              // 722 + 611 + 278 + 556
  assert.equal(Pdf.widthOf(' ', 1000, false), 278);
  assert.equal(Pdf.glyphWidth(0x41, false), 667);
  assert.equal(Pdf.glyphWidth(0x7E, true), 584);
  // las vocales con tilde miden igual que la letra sin ella; ñ igual que n
  assert.equal(Pdf.glyphWidth('á'.charCodeAt(0), false), Pdf.glyphWidth(97, false));
  assert.equal(Pdf.glyphWidth('é'.charCodeAt(0), true), Pdf.glyphWidth(101, true));
  assert.equal(Pdf.glyphWidth('ñ'.charCodeAt(0), false), Pdf.glyphWidth(110, false));
  assert.equal(Pdf.glyphWidth('Ñ'.charCodeAt(0), true), Pdf.glyphWidth(78, true));
  assert.equal(Pdf.glyphWidth('í'.charCodeAt(0), false), 278);     // ì í î ï miden 278
  assert.equal(Pdf.glyphWidth('Í'.charCodeAt(0), false), 278);
  assert.equal(Pdf.glyphWidth('ü'.charCodeAt(0), true), Pdf.glyphWidth(117, true));
  // letras con ancho propio, símbolos y los códigos 0x80..0x9F
  assert.equal(Pdf.glyphWidth('æ'.charCodeAt(0), false), 889);
  assert.equal(Pdf.glyphWidth('×'.charCodeAt(0), false), 584);
  assert.equal(Pdf.glyphWidth('ß'.charCodeAt(0), true), 611);
  assert.equal(Pdf.glyphWidth('°'.charCodeAt(0), false), 400);
  assert.equal(Pdf.glyphWidth('¿'.charCodeAt(0), true), 611);
  assert.equal(Pdf.glyphWidth('µ'.charCodeAt(0), true), 611);
  assert.equal(Pdf.glyphWidth(0x97, false), 1000);
  assert.equal(Pdf.glyphWidth(0x93, true), 500);
  assert.equal(Pdf.glyphWidth(0x81, false), 556);                  // sin dato: un ancho medio
  assert.equal(Pdf.glyphWidth(5, false), 556);
});

test('wrap: parte en líneas que caben, respeta \\n y parte palabras más anchas que la línea', () => {
  const max = 100;
  const lines = Pdf.wrap('uno dos tres cuatro cinco seis siete ocho nueve diez', 10, false, max);
  assert.ok(lines.length > 2);
  lines.forEach((l) => assert.ok(Pdf.widthOf(l, 10, false) <= max, l));
  assert.equal(lines.join(' '), 'uno dos tres cuatro cinco seis siete ocho nueve diez');
  assert.deepEqual(Pdf.wrap('a\n\nb', 10, false, 100), ['a', '', 'b']);
  assert.deepEqual(Pdf.wrap('', 10, false, 100), ['']);
  assert.deepEqual(Pdf.wrap('   ', 10, false, 100), ['']);
  const long = Pdf.wrap('x' + 'abcdefghij'.repeat(6) + ' fin', 10, false, 80);
  long.forEach((l) => assert.ok(Pdf.widthOf(l, 10, false) <= 80 + 1e-9, l));
  assert.equal(long.join('').replace(/ /g, ''), 'x' + 'abcdefghij'.repeat(6) + 'fin');
  // un solo carácter más ancho que la línea no se queda en un ciclo
  assert.deepEqual(Pdf.wrap('W', 10, false, 1), ['W']);
});

/* ---------- JPEG ---------- */
test('jpegInfo: mide color y gris; rechaza lo que no se puede incrustar', () => {
  assert.deepEqual(Pdf.jpegInfo(J.RGB), { bits: 8, w: 48, h: 32, comps: 3 });
  assert.deepEqual(Pdf.jpegInfo(J.GRAY), { bits: 8, w: 16, h: 16, comps: 1 });
  assert.equal(Pdf.jpegInfo(J.CMYK), null);                        // 4 componentes
  assert.equal(Pdf.jpegInfo(null), null);
  assert.equal(Pdf.jpegInfo(new Uint8Array([1, 2, 3])), null);
  assert.equal(Pdf.jpegInfo(new Uint8Array(40)), null);            // no empieza con FFD8
  assert.equal(Pdf.jpegInfo(J.RGB.subarray(0, 30)), null);         // cortado antes del marcador de tamaño
  // marcadores de relleno (FF FF) y sin longitud (D0..D7, 01) antes del tamaño
  const sof = [0xFF, 0xC0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const raro = new Uint8Array([0xFF, 0xD8, 0xFF, 0xFF, 0xFF, 0xD0, 0xFF, 0x01, 0x00, ...sof, 0, 0, 0]);
  assert.deepEqual(Pdf.jpegInfo(raro), { bits: 8, w: 30, h: 20, comps: 3 });
  // un trozo con longitud absurda (< 2) corta la búsqueda; un tamaño en cero o de 12 bits no sirve
  assert.equal(Pdf.jpegInfo(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(Pdf.jpegInfo(new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 12, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11])), null);
  assert.equal(Pdf.jpegInfo(new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, 0, 0, 0, 30, 3, 1, 0x22, 0, 2, 0x11])), null);
  // bytes sueltos entre marcadores se saltan
  const suelto = new Uint8Array([0xFF, 0xD8, 7, 7, 7, 0xFF, 0xC2, 0, 17, 8, 0, 5, 0, 9, 3, 1, 0x22, 0, 2, 0x11]);
  assert.deepEqual(Pdf.jpegInfo(suelto), { bits: 8, w: 9, h: 5, comps: 3 });
});

/* ---------- Archivo ---------- */
const TODO = [
  { t: 'h1', text: 'Reporte de zona de vida' },
  { t: 'sub', text: 'Finca El Roble · 3 de nov de 2026' },
  { t: 'zone', symbol: 'bh-PM', name: 'Bosque húmedo Premontano', detail: 'Región latitudinal: Tropical · Piso altitudinal: Premontano' },
  { t: 'h2', text: 'Datos del clima' },
  { t: 'table', rows: [['Altitud', '1.250 m (GPS)'], ['Temperatura media anual', '21,4 °C (estimada)', '#D8353C'], ['Texto largo', 'palabra '.repeat(40)]] },
  { t: 'note', text: 'Resultado incompleto: falta la precipitación anual.' },
  { t: 'p', text: 'Un párrafo normal con ñ y tildes.' },
  { t: 'p', text: 'Una nota pequeña.', small: true },
  { t: 'h3', text: 'P1', color: '#2F8F4E' },
  { t: 'h3', text: 'Sin punto' },
  { t: 'list', items: ['Primero', 'Segundo con un texto bastante largo que tiene que pasar a una segunda línea porque no cabe en el ancho de la hoja A4'] },
  { t: 'image', img: { bytes: J.RGB, w: 48, h: 32 }, maxW: 300, caption: 'Croquis' },
  { t: 'gallery', items: [{ img: { bytes: J.RGB }, caption: 'Principal' }, { img: { bytes: J.GRAY }, caption: 'Foto 2' }, { img: { bytes: J.RGB } }, { img: { bytes: J.RGB }, caption: 'Foto 4' }] },
  { t: 'spacer', h: 20 },
  { t: 'spacer' },
  { t: 'pagebreak' },
  { t: 'h2', text: 'Segunda hoja' }
];

test('build: estructura válida, tabla de referencias exacta y contenido', () => {
  const pdf = Pdf.build(TODO, { title: 'Reporte · Ñandú', author: 'Zonas de Vida', subject: 'Holdridge', date: Date.UTC(2026, 10, 3, 12, 30, 5), footer: 'Reporte de zona de vida · Finca El Roble' });
  assert.ok(pdf instanceof Uint8Array);
  const { s, pages } = inspect(pdf);
  assert.ok(pages >= 2);
  assert.match(s, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(s, /\/BaseFont \/Helvetica-Bold /);
  assert.match(s, /\/CreationDate \(D:20261103123005Z\)/);
  assert.match(s, /\/Lang \(es\)/);
  assert.equal((s.match(/\/Subtype \/Image /g) || []).length, 2);      // RGB (usada varias veces) y gris
  assert.match(s, /\/ColorSpace \/DeviceGray/);
  assert.match(s, /\/ColorSpace \/DeviceRGB/);
  assert.match(s, /\/Filter \/DCTDecode/);
  // el título va en UTF-16 con su ñ
  assert.ok(s.includes('<FEFF0052006500700'));
  assert.ok(s.toUpperCase().includes('00D1'));                           // Ñ
  const t = pageText(s).join('|');
  assert.match(t, /Reporte de zona de vida/);
  assert.match(t, /Bosque h.medo Premontano/);
  assert.match(t, new RegExp('P.gina 1 de ' + pages));
  assert.match(t, new RegExp('P.gina ' + pages + ' de ' + pages));
  assert.match(t, /Segunda hoja/);
});

test('build: datos que no son una lista o bloques raros no rompen nada', () => {
  [undefined, null, 'x', {}, [], [null, 3, 'x', { t: 'desconocido' }, { t: 'p' }]].forEach((b) => {
    const r = inspect(Pdf.build(b));
    assert.equal(r.pages, 1);
  });
  inspect(Pdf.build([{ t: 'pagebreak' }, { t: 'pagebreak' }]));           // en una hoja vacía no agrega hojas
  assert.equal(inspect(Pdf.build([{ t: 'pagebreak' }])).pages, 1);
});

test('build: mucho texto pasa a varias hojas, sin dejar títulos solos al final y con pie «Página n de N»', () => {
  const blocks = [{ t: 'h1', text: 'Largo' }];
  for (let i = 0; i < 40; i++) blocks.push({ t: 'p', text: 'Renglón número ' + i + '. ' + 'texto '.repeat(60) });
  const r = inspect(Pdf.build(blocks, { footer: 'x'.repeat(200) }));
  assert.ok(r.pages >= 3, 'páginas: ' + r.pages);
  for (let k = 1; k <= r.pages; k++) assert.ok(pageText(r.s).some((x) => x === 'Página ' + k + ' de ' + r.pages));
  // un título que no cabe con algo debajo pasa a la hoja siguiente
  const b2 = [{ t: 'spacer', h: 700 }, { t: 'h2', text: 'Título al final' }, { t: 'p', text: 'detalle' }];
  const r2 = inspect(Pdf.build(b2));
  assert.equal(r2.pages, 2);
  // una tabla larga pasa de hoja fila por fila
  const rows = []; for (let i = 0; i < 90; i++) rows.push(['Fila ' + i, 'valor ' + i, i % 2 ? '#2F8F4E' : null]);
  assert.ok(inspect(Pdf.build([{ t: 'table', rows }])).pages >= 2);
  // una lista y una galería largas también
  const items = []; for (let i = 0; i < 80; i++) items.push('Elemento ' + i);
  assert.ok(inspect(Pdf.build([{ t: 'list', items }])).pages >= 2);
  const g = []; for (let i = 0; i < 30; i++) g.push({ img: { bytes: J.RGB }, caption: 'F' + i });
  assert.ok(inspect(Pdf.build([{ t: 'gallery', items: g, per: 2 }])).pages >= 2);
});

test('build: un aviso largo puede pasar de hoja y sigue dibujando su recuadro', () => {
  const r = inspect(Pdf.build([{ t: 'spacer', h: 760 }, { t: 'note', text: 'aviso '.repeat(120) }]));
  assert.ok(r.pages >= 2);
  assert.match(r.s, /0\.95 0\.96 0\.94 rg/);                              // el fondo del aviso
});

test('build: una imagen más alta que la hoja se achica; una que no es JPEG usable deja un aviso', () => {
  const alta = Pdf.build([{ t: 'image', img: { bytes: J.GRAY }, maxW: 5000, caption: 'cuadrada' }]);
  inspect(alta);
  const malo = Pdf.build([{ t: 'image', img: { bytes: J.CMYK } }, { t: 'image' }, { t: 'image', img: { bytes: new Uint8Array([1, 2, 3]) } }, { t: 'gallery', items: [{ img: { bytes: J.CMYK } }, null, {}] }, { t: 'gallery' }]);
  const r = inspect(malo);
  assert.equal((r.s.match(/\/Subtype \/Image /g) || []).length, 0);
  assert.equal(pageText(r.s).filter((x) => /No se pudo incluir esta imagen/.test(x)).length, 3);
  // una imagen muy alta y angosta se limita por altura
  const alto = new Uint8Array(J.RGB);
  alto[0x9E] = 0;                                                         // (no se usa: solo para que la copia exista)
  inspect(Pdf.build([{ t: 'image', img: { bytes: alto } }]));
});

test('build: las fechas no válidas usan la hora actual y los metadatos vacíos no rompen', () => {
  const a = latin(Pdf.build([], { date: NaN }));
  assert.match(a, /\/CreationDate \(D:\d{14}Z\)/);
  const b = latin(Pdf.build([], { title: null, author: undefined, subject: '' }));
  assert.match(b, /\/Title <FEFF>/);
  assert.match(b, /\/Creator <FEFF/);
});

test('build: el color del punto se acepta con o sin formato válido', () => {
  const r = inspect(Pdf.build([{ t: 'table', rows: [['a', 'b', '#112233'], ['c', 'd', 'rojo']] }, { t: 'h3', text: 'x', color: 'azul' }]));
  assert.match(r.s, /0\.07 0\.13 0\.2 rg/);                                // #112233
});

/* ---------- Leyenda, títulos con su imagen y avisos largos ---------- */
const contenidos = (s) => [...s.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]);
const textoDe = (c) => (c.match(/<([0-9a-f]+)> Tj/g) || []).map((t) => Buffer.from(/<([0-9a-f]+)>/.exec(t)[1], 'hex').toString('latin1'));
// Un «JPEG» que solo trae la cabecera con el tamaño (el escritor no decodifica nada): sirve para imágenes de formas raras
function cabecera(w, h) { return new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]); }

test('legend: cuadritos de color con su nombre; si no caben en el renglón pasan al siguiente', () => {
  const items = [['#2F8F4E', 'Mis puntos'], ['#E67E22', 'Lote vecino con un nombre bastante largo'], ['#8E44AD', 'Pozo'], ['rojo', 'Otra capa con nombre largo para ocupar el ancho'], ['#112233', 'Última capa de la leyenda']];
  const r = inspect(Pdf.build([{ t: 'legend', items }, { t: 'legend' }]));
  const t = pageText(r.s);
  items.forEach((it) => assert.ok(t.includes(it[1]), it[1]));
  const ys = [...r.s.matchAll(/ ([\d.]+) Td </g)].map((m) => Number(m[1]));
  assert.ok(new Set(ys).size >= 3, 'más de un renglón');                // dos renglones de leyenda + el pie
  assert.match(r.s, /0\.18 0\.56 0\.31 rg 48 /);                         // el cuadrito verde del primero
});

test('títulos: un título no se queda solo al final de la hoja; pasa con su imagen o sus fotos', () => {
  const con = (bloques) => { const r = inspect(Pdf.build(bloques)); return { r, hojas: contenidos(r.s).map(textoDe) }; };
  // imagen alta que no cabe en lo que queda de la hoja 1: el título se va con ella
  const a = con([{ t: 'spacer', h: 560 }, { t: 'h2', text: 'Con imagen' }, { t: 'image', img: { bytes: J.RGB }, maxW: 460, caption: 'Leyenda de la imagen' }]);
  assert.equal(a.r.pages, 2);
  assert.ok(!a.hojas[0].includes('Con imagen'));
  assert.ok(a.hojas[1].includes('Con imagen') && a.hojas[1].includes('Leyenda de la imagen'));
  // si cabe, se queda donde está
  const b = con([{ t: 'h2', text: 'Cabe' }, { t: 'image', img: { bytes: J.RGB }, maxW: 200 }]);
  assert.equal(b.r.pages, 1);
  // título de un punto con sus fotos
  const c = con([{ t: 'spacer', h: 640 }, { t: 'h3', text: 'Punto Uno' }, { t: 'gallery', items: [{ img: { bytes: J.RGB }, caption: 'Principal' }, { img: { bytes: J.GRAY } }], per: 2 }]);
  assert.equal(c.r.pages, 2);
  assert.ok(c.hojas[1].includes('Punto Uno'));
  // seguido de otra cosa (o de imágenes/fotos que no sirven) solo pide el mínimo
  const d = con([{ t: 'spacer', h: 560 }, { t: 'h2', text: 'Con texto' }, { t: 'p', text: 'x' }, { t: 'h2', text: 'Con imagen mala' }, { t: 'image', img: { bytes: J.CMYK } }, { t: 'h3', text: 'Fotos malas' }, { t: 'gallery', items: [{ img: { bytes: J.CMYK } }, null] }]);
  assert.ok(d.hojas[0].includes('Con texto'));
  assert.equal(inspect(Pdf.build([{ t: 'h2', text: 'x' }, { t: 'gallery' }])).pages, 1);
});

test('imágenes: una muy alta se limita por la altura de la hoja y las fotos siguen un orden estable', () => {
  const alta = inspect(Pdf.build([{ t: 'image', img: { bytes: cabecera(10, 100) }, caption: 'larga' }]));
  const cm = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im1 Do Q/.exec(alta.s);
  assert.ok(Number(cm[2]) <= Pdf.PAGE.h - Pdf.MARGINS.t - Pdf.MARGINS.b, 'cabe en la hoja');
  assert.ok(Number(cm[1]) < 100);                                          // se achicó también en ancho para conservar la forma
  assert.ok(Math.abs(Number(cm[1]) / Number(cm[2]) - 0.1) < 0.001);
  // la misma imagen usada dos veces se incrusta una sola vez
  const bytes = J.RGB;
  const dos = inspect(Pdf.build([{ t: 'image', img: { bytes } }, { t: 'image', img: { bytes } }]));
  assert.equal((dos.s.match(/\/Subtype \/Image /g) || []).length, 1);
});

test('avisos: uno largo que empieza en una hoja con espacio sigue en la otra sin perder renglones', () => {
  const texto = Array.from({ length: 40 }, (_, i) => 'renglon' + i + ' ' + 'palabra '.repeat(11)).join('\n');
  const r = inspect(Pdf.build([{ t: 'spacer', h: 450 }, { t: 'note', text: texto }]));
  assert.equal(r.pages, 2);
  const t = pageText(r.s).join('\n');
  for (let i = 0; i < 40; i++) assert.ok(t.includes('renglon' + i + ' '), 'falta el renglón ' + i);
});

/* ---------- Con herramientas reales de PDF (si están instaladas en este equipo) ---------- */
function tiene(cmd) { return spawnSync('which', [cmd]).status === 0; }

test('herramientas externas: qpdf lo da por válido y pdftotext lee el texto', { skip: !(tiene('qpdf') && tiene('pdftotext')) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
  const f = path.join(dir, 'r.pdf');
  fs.writeFileSync(f, Pdf.build(TODO, { title: 'Reporte', footer: 'Pie' }));
  const q = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' });
  assert.equal(q.status, 0, q.stdout + q.stderr);
  assert.doesNotMatch(q.stdout + q.stderr, /WARNING/);               // qpdf sale con 3 si solo hubo avisos
  const t = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
  assert.match(t, /Bosque húmedo Premontano/);
  assert.match(t, /Temperatura media anual\s+21,4 °C \(estimada\)/);
  assert.match(t, /Página 1 de \d/);
  assert.match(t, /Segunda hoja/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- Posiciones y bordes (se revisan las operaciones de dibujo del PDF, no solo el texto) ---------- */
const M = Pdf.MARGINS, W = Pdf.PAGE.w - M.l - M.r;
const textos = (s) => [...s.matchAll(/BT \/F(\d) ([\d.]+) Tf [\d. ]+ rg ([\d.-]+) ([\d.-]+) Td <([0-9a-f]+)> Tj ET/g)].map((m) => ({ bold: m[1] === '2', size: Number(m[2]), x: Number(m[3]), y: Number(m[4]), t: Buffer.from(m[5], 'hex').toString('latin1') }));
const imagenesEn = (s) => [...s.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.-]+) ([\d.-]+) cm \/Im(\d+) Do Q/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]), n: Number(m[5]) }));

test('wrap: una palabra o frase que mide justo el ancho cabe en un solo renglón', () => {
  const t = 'hola mundo';
  assert.deepEqual(Pdf.wrap(t, 10, false, Pdf.widthOf(t, 10, false)), [t]);
  assert.equal(Pdf.wrap(t, 10, false, Pdf.widthOf(t, 10, false) - 0.5).length, 2);
});
test('anchos: la primera letra acentuada (À, código 0xC0) mide lo mismo que la A y se escribe con su código', () => {
  assert.equal(Pdf.glyphWidth(0xC0, false), Pdf.glyphWidth(65, false));
  assert.equal(Pdf.glyphWidth(0xC0, true), Pdf.glyphWidth(65, true));
  assert.deepEqual(pageText(inspect(Pdf.build([{ t: 'p', text: 'À' }])).s).slice(0, 1), ['À']);
});
test('galería: la segunda foto de un renglón va a la derecha de la primera, a la misma altura, y su leyenda queda debajo', () => {
  const { s } = inspect(Pdf.build([{ t: 'gallery', per: 2, items: [{ img: { bytes: J.RGB }, caption: 'Uno' }, { img: { bytes: J.GRAY }, caption: 'Dos' }] }]));
  const im = imagenesEn(s), cw = (W - 10) / 2;
  assert.equal(im.length, 2);
  assert.ok(Math.abs(im[0].x - M.l) < 0.01);
  assert.ok(Math.abs(im[1].x - (M.l + cw + 10)) < 0.01, 'x de la segunda: ' + im[1].x);
  assert.ok(Math.abs((im[0].y + im[0].h) - (im[1].y + im[1].h)) < 0.01, 'las dos fotos arrancan a la misma altura');
  const leyendas = textos(s).filter((t) => t.t === 'Uno' || t.t === 'Dos');
  assert.equal(leyendas.length, 2);
  leyendas.forEach((l, i) => assert.ok(l.y + 8.5 * 0.92 <= im[i].y - 1, 'la leyenda va debajo de su foto, sin tocarla'));
  assert.ok(Math.abs(leyendas[1].x - im[1].x) < 0.01, 'la leyenda empieza donde empieza su foto');
});
test('imagen: la siguiente cosa empieza 6 puntos debajo de la imagen, sin encimarse', () => {
  const { s } = inspect(Pdf.build([{ t: 'image', img: { bytes: J.RGB }, maxW: 200 }, { t: 'image', img: { bytes: J.GRAY }, maxW: 200 }]));
  const [a, b] = imagenesEn(s);
  assert.ok(Math.abs((a.y - (b.y + b.h)) - 6) < 0.01, 'separación: ' + (a.y - (b.y + b.h)));
});
test('tabla: el cuadrito de color queda a la altura de su texto y la etiqueta se corre a su derecha', () => {
  const { s } = inspect(Pdf.build([{ t: 'table', rows: [['Con color', 'valor', '#D8353C'], ['Sin color', 'otro']] }]));
  const t = textos(s), etiqueta = t.find((x) => x.t === 'Con color'), sin = t.find((x) => x.t === 'Sin color');
  assert.ok(Math.abs(etiqueta.x - (M.l + 14)) < 0.01, 'la etiqueta se corre 14 puntos');
  assert.ok(Math.abs(sin.x - M.l) < 0.01);
  const dot = /0\.5 w 0\.3 0\.3 0\.3 RG ([\d.]+) ([\d.]+) m /.exec(s);
  const cy = Number(dot[2]);                                               // el punto del círculo más a la derecha: su altura es la del centro
  assert.ok(cy > etiqueta.y && cy < etiqueta.y + 10, 'el cuadrito (' + cy + ') queda sobre la línea del texto (' + etiqueta.y + ')');
  assert.ok(Math.abs(Number(dot[1]) - (M.l + 5 + 3.6)) < 0.01);
});
test('círculo (cuadrito de color): cuatro curvas de Bézier que siguen la circunferencia', () => {
  const { s } = inspect(Pdf.build([{ t: 'h3', text: 'Con color', color: '#2F8F4E' }]));
  const texto = /0\.3 0\.3 0\.3 RG ([^B]+) B/.exec(s)[1].trim().split(' ');
  const cx = M.l + 4, r = 3.6, k = 0.5523 * r, cy = Number(texto[1]);
  const esperado = [cx + r, cy, 'm', cx + r, cy + k, cx + k, cy + r, cx, cy + r, 'c', cx - k, cy + r, cx - r, cy + k, cx - r, cy, 'c', cx - r, cy - k, cx - k, cy - r, cx, cy - r, 'c', cx + k, cy - r, cx + r, cy - k, cx + r, cy, 'c'];
  assert.equal(texto.length, esperado.length);
  texto.forEach((v, i) => { if (typeof esperado[i] === 'string') assert.equal(v, esperado[i]); else assert.ok(Math.abs(Number(v) - esperado[i]) < 0.01, 'valor ' + i + ': ' + v + ' ≠ ' + esperado[i]); });
});
test('título con color: el texto no pasa del margen derecho aunque sea largo', () => {
  const largo = Array.from({ length: 40 }, (_, i) => 'palabra' + i).join(' ');
  const { s } = inspect(Pdf.build([{ t: 'h3', text: largo, color: '#2F8F4E' }]));
  const t = textos(s).filter((x) => /palabra/.test(x.t));
  assert.ok(t.length >= 2);
  t.forEach((x) => { assert.ok(Math.abs(x.x - (M.l + 13)) < 0.01); assert.ok(x.x + Pdf.widthOf(x.t, 11.5, true) <= Pdf.PAGE.w - M.r + 0.01, 'se sale por la derecha: ' + x.t); });
});
test('aviso: el recuadro rodea su texto (no queda arriba ni abajo de él)', () => {
  const { s } = inspect(Pdf.build([{ t: 'note', text: 'Un aviso corto' }]));
  const re = [...s.matchAll(/ ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
  const t = textos(s).find((x) => x.t === 'Un aviso corto');
  assert.ok(re.length >= 1);
  const caja = re[re.length - 1];
  assert.ok(t.y >= caja.y && t.y + 10 <= caja.y + caja.h, 'texto en y=' + t.y + ', caja ' + caja.y + '–' + (caja.y + caja.h));
  assert.ok(caja.y > 0 && caja.y + caja.h < Pdf.PAGE.h - M.t + 20);
});
test('zona de vida: el hexágono rodea al símbolo y el texto va a su derecha', () => {
  const { s } = inspect(Pdf.build([{ t: 'zone', symbol: 'bh-MB', name: 'Bosque húmedo montano bajo', detail: 'Región latitudinal: Templada cálida' }]));
  const hex = /2 w ([^h]+)h B/.exec(s)[1].trim().split(' ');
  const ys = [], xs = [];
  for (let i = 0; i + 2 < hex.length + 1; i += 3) { xs.push(Number(hex[i])); ys.push(Number(hex[i + 1])); }
  const sym = textos(s).find((x) => x.t === 'bh-MB'), nombre = textos(s).find((x) => /^Bosque/.test(x.t));
  assert.equal(xs.length, 6);
  assert.ok(sym.y > Math.min(...ys) && sym.y < Math.max(...ys), 'el símbolo va dentro del hexágono');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 55 && Math.max(...ys) < Pdf.PAGE.h - M.t + 1 && Math.min(...ys) > Pdf.PAGE.h - M.t - 70);
  assert.ok(nombre.x > Math.max(...xs), 'el nombre va a la derecha del hexágono');
});
test('pie de página: la raya queda arriba del texto del pie', () => {
  const { s } = inspect(Pdf.build([{ t: 'p', text: 'x' }], { footer: 'Mi reporte' }));
  const todas = [...s.matchAll(/0\.6 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)];
  const pie = textos(s).find((x) => x.t === 'Mi reporte');
  const y = Number(todas[todas.length - 1][2]);
  assert.ok(y - pie.y >= 8 && y - pie.y < 20, 'raya en ' + y + ', pie en ' + pie.y);
});

test('norm: la tilde «~» (último código ASCII imprimible) se conserva', () => {
  assert.equal(Pdf.norm('a~b'), 'a~b');
  assert.equal(Pdf.norm('\x7f'), '');
});
test('jpegInfo: un segmento vacío (largo 2) antes del cuadro no impide leerlo; uno de largo 0 o 1 sí', () => {
  const sof = [0xFF, 0xC0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const con = (...seg) => new Uint8Array([0xFF, 0xD8].concat(...seg, sof, [0xFF, 0xD9]));
  assert.deepEqual(Pdf.jpegInfo(con([0xFF, 0xE0, 0, 2])), { bits: 8, h: 20, w: 30, comps: 3 });
  assert.equal(Pdf.jpegInfo(con([0xFF, 0xE0, 0, 1])), null);
  assert.equal(Pdf.jpegInfo(con([0xFF, 0xE0, 0, 0])), null);
});
test('zona de vida: el texto va a la derecha del hexágono sin pasar el margen, centrado en su altura, y lo siguiente queda separado', () => {
  const largo = Array.from({ length: 30 }, (_, i) => 'detalle' + i).join(' ');
  const { s } = inspect(Pdf.build([{ t: 'zone', symbol: 'bh-MB', name: 'Bosque húmedo montano bajo de la región andina', detail: largo }, { t: 'p', text: 'Siguiente' }]));
  const hex = /2 w ([^h]+)h B/.exec(s)[1].trim().split(' ').map(Number), ys = [hex[1], hex[4], hex[7], hex[10], hex[13], hex[16]];
  const t = textos(s), nombre = t.find((x) => /^Bosque/.test(x.t)), sig = t.find((x) => x.t === 'Siguiente');
  t.filter((x) => /^(Bosque|detalle)/.test(x.t)).forEach((x) => assert.ok(x.x + Pdf.widthOf(x.t, x.size, x.bold) <= Pdf.PAGE.w - M.r + 0.01, 'se sale por la derecha: ' + x.t));
  assert.ok(sig.y + 10.5 * 0.92 <= Math.min(...ys) - 8 + 0.01, 'lo siguiente queda al menos 8 puntos debajo del hexágono');
  const corto = inspect(Pdf.build([{ t: 'zone', symbol: 'x', name: 'Corto', detail: 'uno' }, { t: 'p', text: 'Después' }])).s;
  const h2 = /2 w ([^h]+)h B/.exec(corto)[1].trim().split(' ').map(Number), y2 = [h2[1], h2[4], h2[7], h2[10], h2[13], h2[16]];
  const n2 = textos(corto).find((x) => x.t === 'Corto'), d2 = textos(corto).find((x) => x.t === 'Después');
  assert.ok(n2.y > Math.min(...y2) && n2.y < Math.max(...y2), 'el nombre corto queda dentro de la altura del hexágono');
  assert.ok(d2.y + 10.5 * 0.92 <= Math.min(...y2) - 8 + 0.01, 'con un texto corto, lo siguiente también queda debajo del hexágono');
});
test('páginas: pase lo que pase, nada se dibuja debajo del margen inferior (se prueban todos los espacios restantes posibles)', () => {
  const pie = (x) => x.size === 8 && /^(Página|Pie)/.test(x.t);
  const bloques = [
    [{ t: 'zone', symbol: 'bh-MB', name: 'Bosque', detail: 'detalle' }],
    [{ t: 'image', img: { bytes: J.RGB }, maxW: 120, caption: 'Pie de la imagen' }],
    [{ t: 'gallery', per: 2, items: [{ img: { bytes: J.RGB }, caption: 'Uno' }, { img: { bytes: J.GRAY }, caption: 'Dos' }] }],
    [{ t: 'table', rows: [['Fila', 'valor', '#2F8F4E']] }],
    [{ t: 'note', text: 'Un aviso corto' }]
  ];
  bloques.forEach((b) => {
    for (let h = 0; h <= Pdf.PAGE.h - M.t - M.b; h += 3) {
      const r = inspect(Pdf.build([{ t: 'spacer', h }].concat(b), { footer: 'Pie' }));
      const hojas = [...r.s.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]);
      hojas.forEach((c) => {
        textos(c).filter((x) => !pie(x)).forEach((x) => assert.ok(x.y >= M.b - 0.01, b[0].t + ' con espacio ' + h + ': «' + x.t + '» en y=' + x.y));
        imagenesEn(c).forEach((im) => assert.ok(im.y >= M.b - 0.01, b[0].t + ' con espacio ' + h + ': imagen en y=' + im.y));
        [...c.matchAll(/2 w ([^h]+)h B/g)].forEach((m) => { const v = m[1].trim().split(' ').map(Number); [v[1], v[4], v[7], v[10], v[13], v[16]].forEach((y) => assert.ok(y >= M.b - 0.01, 'hexágono fuera de la hoja con espacio ' + h)); });
      });
    }
  });
});
test('pie de página: la raya es horizontal', () => {
  const { s } = inspect(Pdf.build([{ t: 'p', text: 'x' }], { footer: 'Mi reporte' }));
  const l = [...s.matchAll(/0\.6 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)].pop();
  assert.equal(l[2], l[4]);
});

test('rayas: la de los títulos y la de las tablas van de margen a margen y son horizontales', () => {
  const { s } = inspect(Pdf.build([{ t: 'h2', text: 'Título' }, { t: 'table', rows: [['a', 'b']] }]));
  const rayas = [...s.matchAll(/([\d.]+) w (-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g)].map((m) => ({ w: Number(m[1]), x1: Number(m[2]), y1: Number(m[3]), x2: Number(m[4]), y2: Number(m[5]) }));
  const titulo = rayas.find((r) => r.w === 1.2), fila = rayas.find((r) => r.w === 0.6 && r.y1 < Pdf.PAGE.h - 100);
  [titulo, fila].forEach((r) => { assert.ok(r, 'falta la raya'); assert.ok(Math.abs(r.x1 - M.l) < 0.01 && Math.abs(r.x2 - (M.l + W)) < 0.01); assert.equal(r.y1, r.y2); });
  const t = textos(s).find((x) => x.t === 'Título');
  assert.ok(titulo.y1 < t.y && t.y - titulo.y1 < 12, 'la raya va justo debajo del título');
  assert.ok(fila.y1 < textos(s).find((x) => x.t === 'a').y, 'la raya de la fila va debajo de su texto');
});
test('títulos con imagen: con cualquier espacio restante, el título y su imagen (con su leyenda) quedan en la misma hoja', () => {
  const imagenes = [{ bytes: J.RGB }, { bytes: cabecera(10, 100) }, { bytes: cabecera(100, 10) }];
  imagenes.forEach((img) => {
    for (let h = 0; h <= Pdf.PAGE.h - M.t - M.b; h += 3) {
      const r = inspect(Pdf.build([{ t: 'spacer', h }, { t: 'h2', text: 'Mi título' }, { t: 'image', img, maxW: 400, caption: 'Pie de la imagen' }]));
      const hojas = contenidos(r.s);
      const hT = hojas.findIndex((c) => textos(c).some((x) => x.t === 'Mi título')), hI = hojas.findIndex((c) => imagenesEn(c).length), hC = hojas.findIndex((c) => textos(c).some((x) => x.t === 'Pie de la imagen'));
      assert.equal(hT, hI, 'título e imagen en hojas distintas con espacio ' + h);
      assert.equal(hC, hI, 'imagen y leyenda en hojas distintas con espacio ' + h);
    }
  });
});

test('jpegInfo: lo que no es un JPEG (nada, vacío, texto o un tamaño que no alcanza) da null sin fallar', () => {
  [null, undefined, new Uint8Array(0), new Uint8Array([0xFF, 0xD8, 0xFF]), new Uint8Array(40), Buffer.from('esto no es un jpeg, es texto largo'), 'texto'].forEach((b) => assert.equal(Pdf.jpegInfo(b), null));
});
test('aviso: el recuadro deja un margen de 6 puntos arriba y abajo del texto', () => {
  const { s } = inspect(Pdf.build([{ t: 'note', text: 'Una sola línea' }]));
  const caja = [...s.matchAll(/ ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map((m) => ({ y: Number(m[2]), h: Number(m[4]) })).pop();
  assert.ok(caja.h >= 14 + 6 + 6 - 0.01, 'alto del recuadro: ' + caja.h);
});
test('imágenes: el espacio de color es gris o RGB según la imagen, y un JPEG de ancho o alto cero no se incrusta', () => {
  const g = inspect(Pdf.build([{ t: 'image', img: { bytes: J.GRAY } }])).s, c = inspect(Pdf.build([{ t: 'image', img: { bytes: J.RGB } }])).s;
  assert.match(g, /\/ColorSpace \/DeviceGray/);
  assert.doesNotMatch(g, /\/DeviceRGB/);
  assert.match(c, /\/ColorSpace \/DeviceRGB/);
  assert.doesNotMatch(c, /\/DeviceGray/);
  assert.match(g, /\/BitsPerComponent 8/);
  assert.match(g, /\/Filter \/DCTDecode/);
  assert.equal(Pdf.jpegInfo(cabecera(0, 10)), null);
  assert.equal(Pdf.jpegInfo(cabecera(10, 0)), null);
  assert.ok(Pdf.jpegInfo(cabecera(1, 1)));
});
test('leyenda: el cuadrito de color queda junto a su nombre y el siguiente elemento empieza después de su texto', () => {
  const { s } = inspect(Pdf.build([{ t: 'legend', items: [['#2F8F4E', 'Mis puntos'], ['#E67E22', 'Lote']] }]));
  const cuadros = [...s.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg ([\d.-]+) ([\d.-]+) 8 8 re f/g)].map((m) => ({ x: Number(m[4]), y: Number(m[5]) }));
  const t = textos(s).filter((x) => x.t === 'Mis puntos' || x.t === 'Lote');
  assert.equal(cuadros.length, 2);
  cuadros.forEach((q, i) => {
    assert.ok(Math.abs(t[i].x - (q.x + 12)) < 0.01, 'el nombre va 12 puntos a la derecha del cuadrito');
    assert.ok(q.y <= t[i].y && q.y + 8 >= t[i].y + 6, 'el cuadrito acompaña a su texto: cuadro ' + q.y + '–' + (q.y + 8) + ', texto ' + t[i].y);
  });
  assert.ok(cuadros[1].x >= t[0].x + Pdf.widthOf('Mis puntos', 9, false) + 10, 'el segundo elemento no pisa al primero');
});
test('avisos: un aviso de hasta unas pocas líneas no se parte entre dos hojas (pasa entero a la siguiente)', () => {
  const texto = Array.from({ length: 45 }, (_, i) => 'palabra' + i).join(' ');           // 3 o 4 renglones
  for (let h = 0; h <= Pdf.PAGE.h - M.t - M.b; h += 3) {
    const hojas = contenidos(inspect(Pdf.build([{ t: 'spacer', h }, { t: 'note', text: texto }])).s);
    const donde = hojas.map((c) => textos(c).filter((x) => /palabra/.test(x.t)).length).filter(Boolean);
    assert.equal(donde.length, 1, 'el aviso quedó partido en ' + donde.length + ' hojas con espacio ' + h);
  }
});

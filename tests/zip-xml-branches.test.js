'use strict';
/* Archivos dañados: ZIP/KMZ y XML mal formados deben fallar con un mensaje claro y nunca colgar ni dar datos a medias. */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const Zip = require('../www/js/zip.js');
const Xml = require('../www/js/xml.js');
const { makeZip } = require('./helpers/zipbuild.js');

/* ---------- Escritor de bits para armar flujos "deflate" a mano ---------- */
function writer() {
  const bytes = []; let cur = 0, n = 0;
  const put = (b) => { cur |= b << n; if (++n === 8) { bytes.push(cur); cur = 0; n = 0; } };
  return {
    bits(v, len) { for (let i = 0; i < len; i++) put((v >> i) & 1); },            // campos numéricos: el bit menos significativo primero
    huff(code, len) { for (let i = len - 1; i >= 0; i--) put((code >> i) & 1); },  // códigos de Huffman: el bit más significativo primero
    done() { if (n) bytes.push(cur); return new Uint8Array(bytes); }
  };
}
const lit = (w, v) => (v < 144 ? w.huff(0x30 + v, 8) : w.huff(0x190 + v - 144, 9));
const bad = /dañado/;

test('deflate: bloque de tipo no válido y bloque "stored" con longitudes que no cuadran', () => {
  assert.throws(() => Zip.inflate(Uint8Array.from([0x07])), bad);
  assert.throws(() => Zip.inflate(Uint8Array.from([0x01, 0x05, 0x00, 0x00, 0x00])), bad);
  assert.throws(() => Zip.inflate(Uint8Array.from([0x01, 0x05, 0x00, 0xFA, 0xFF, 1, 2])), /incompleto/);
  assert.throws(() => Zip.inflate(Uint8Array.from([0x01, 0x05, 0x00])), /incompleto/);
  assert.throws(() => Zip.inflate(Uint8Array.from([0x03])), /incompleto/);
  assert.deepEqual(Array.from(Zip.inflate(Uint8Array.from([0x01, 0x02, 0x00, 0xFD, 0xFF, 7, 8]))), [7, 8]);
});

test('deflate: símbolos de longitud y distancia fuera de rango, y distancia mayor que lo ya escrito', () => {
  let w = writer(); w.bits(1, 1); w.bits(1, 2); w.huff(0xC6, 8);                    // símbolo 286: no existe
  assert.throws(() => Zip.inflate(w.done()), bad);
  w = writer(); w.bits(1, 1); w.bits(1, 2); lit(w, 97); w.huff(1, 7); w.huff(30, 5); w.huff(0xFFFF, 16); // distancia 30: no existe
  assert.throws(() => Zip.inflate(w.done()), bad);
  w = writer(); w.bits(1, 1); w.bits(1, 2); w.huff(1, 7); w.huff(0, 5);              // copiar hacia atrás sin nada escrito
  assert.throws(() => Zip.inflate(w.done()), bad);
  w = writer(); w.bits(1, 1); w.bits(1, 2); lit(w, 97); w.huff(1, 7); w.huff(0, 5); w.huff(0, 7);   // 'a' + copia de 3 + fin
  assert.equal(Buffer.from(Zip.inflate(w.done())).toString(), 'aaaa');
});

test('deflate dinámico: tamaños de tablas imposibles y repeticiones mal usadas', () => {
  let w = writer(); w.bits(1, 1); w.bits(2, 2); w.bits(31, 5); w.bits(0, 5); w.bits(0, 4);   // 288 símbolos de longitud
  assert.throws(() => Zip.inflate(w.done()), bad);
  const cabecera = () => { const x = writer(); x.bits(1, 1); x.bits(2, 2); x.bits(0, 5); x.bits(0, 5); x.bits(0, 4); for (let i = 0; i < 4; i++) x.bits(2, 3); return x; };
  w = cabecera(); w.huff(1, 2);                                                       // símbolo 16 ("repetir el anterior") sin anterior
  assert.throws(() => Zip.inflate(w.done()), bad);
  w = cabecera(); w.huff(3, 2); w.bits(127, 7); w.huff(3, 2); w.bits(127, 7);        // 138 + 138 > 258 longitudes
  assert.throws(() => Zip.inflate(w.done()), bad);
  w = cabecera(); w.huff(2, 2); w.bits(7, 3); w.huff(3, 2);                           // símbolo 17 y luego 18 sin datos
  assert.throws(() => Zip.inflate(w.done()), /incompleto|dañado/);
});

test('deflate: el límite de tamaño frena archivos que se expanden demasiado', () => {
  const comp = zlib.deflateRawSync(Buffer.alloc(100000));
  assert.throws(() => Zip.inflate(comp, 1000), /demasiado grande/);
  assert.equal(Zip.inflate(comp, 200000).length, 100000);
  const stored = zlib.deflateRawSync(Buffer.alloc(100000, 7), { level: 0 });
  assert.throws(() => Zip.inflate(stored, 5000), /demasiado grande/);
});

test('zip: cabeceras dañadas, ZIP64, demasiadas entradas y archivos truncados', () => {
  assert.throws(() => Zip.entries(null), /ZIP\/KMZ válido/);
  assert.throws(() => Zip.entries(new Uint8Array(10)), /ZIP\/KMZ válido/);
  assert.throws(() => Zip.entries(new Uint8Array(60)), /ZIP\/KMZ válido/);
  const eocd = (total, off) => { const b = Buffer.alloc(22); b.writeUInt32LE(0x06054B50, 0); b.writeUInt16LE(total, 8); b.writeUInt16LE(total, 10); b.writeUInt32LE(off >>> 0, 16); return new Uint8Array(b); };
  assert.throws(() => Zip.entries(eocd(0xFFFF, 0)), /ZIP64/);
  assert.throws(() => Zip.entries(eocd(3, 0xFFFFFFFF)), /ZIP64/);
  assert.throws(() => Zip.entries(eocd(6000, 0)), /demasiados elementos/);
  assert.throws(() => Zip.entries(eocd(1, 0)), /ZIP está dañado/);
  assert.deepEqual(Zip.entries(eocd(0, 0)), []);
  const z = makeZip([{ name: 'a.txt', data: 'hola' }]);
  const rota = z.slice(); rota[z.length - 22 - 46 - 5] = 0;                        // firma del directorio central
  assert.throws(() => Zip.entries(rota), /ZIP está dañado/);
});

test('zip: extraer con contraseña, cabecera local mala, datos truncados, método raro y verificaciones', () => {
  const z = makeZip([{ name: 'a.txt', data: 'hola mundo, hola mundo' }]);
  const [e] = Zip.entries(z);
  assert.equal(Buffer.from(Zip.extract(z, e)).toString(), 'hola mundo, hola mundo');
  assert.throws(() => Zip.extract(z, Object.assign({}, e, { flags: 1 })), /contraseña/);
  const sinLocal = z.slice(); sinLocal[0] = 0;
  assert.throws(() => Zip.extract(sinLocal, e), /ZIP está dañado/);
  assert.throws(() => Zip.extract(z, Object.assign({}, e, { offset: z.length - 10 })), /ZIP está dañado/);
  assert.throws(() => Zip.extract(z, Object.assign({}, e, { csize: 1e6 })), /incompleto/);
  assert.throws(() => Zip.extract(z, Object.assign({}, e, { method: 12 })), /no soportado \(12\)/);
  assert.throws(() => Zip.extract(z, Object.assign({}, e, { size: e.size + 1 })), /tamaño no coincide/);
  assert.throws(() => Zip.extract(z, e, 5), /demasiado grande/);
  const crcMalo = makeZip([{ name: 'a.txt', data: 'hola' }], { badCrc: true });
  assert.throws(() => Zip.extract(crcMalo, Zip.entries(crcMalo)[0]), /verificación/);
  const sinComprimir = makeZip([{ name: 'b.txt', data: 'sin comprimir', method: 0 }]);
  assert.equal(Buffer.from(Zip.extract(sinComprimir, Zip.entries(sinComprimir)[0])).toString(), 'sin comprimir');
});

test('zip: nombres en UTF-8 y en latin1, carpetas, isZip y utf8 sin TextDecoder', () => {
  const z = makeZip([{ name: 'ñandú/', data: '', method: 0, utf8: true }, { name: 'ñandú/doc.kml', data: '<kml/>', utf8: true }]);
  const es = Zip.entries(z);
  assert.equal(es[0].dir, true); assert.equal(es[1].name, 'ñandú/doc.kml'); assert.equal(es[1].dir, false);
  assert.equal(Zip.isZip(z), true);
  assert.equal(Zip.isZip(null), false); assert.equal(Zip.isZip(Uint8Array.from([0x50, 0x4B])), false);
  assert.equal(Zip.isZip(Uint8Array.from([0x50, 0x4B, 5, 6])), true); assert.equal(Zip.isZip(Uint8Array.from([0x50, 0x4B, 7, 8])), false);
  assert.equal(Zip.isZip(Uint8Array.from([0x51, 0x4B, 3, 4])), false);
  const saved = globalThis.TextDecoder;
  globalThis.TextDecoder = undefined;
  try {
    assert.equal(Zip.utf8(Buffer.from('hola ñ')), 'hola ñ');
    assert.equal(Zip.utf8(Uint8Array.from([0x68, 0xFF, 0xFE])), 'hÿþ');
  } finally { globalThis.TextDecoder = saved; }
});

test('xml: etiquetas, atributos y comillas mal formados dan un error con la posición', () => {
  const casos = [
    ['<?xml version="1.0"', /instrucción sin cerrar/], ['<a><!-- sin cerrar', /comentario sin cerrar/], ['<a><![CDATA[x', /CDATA sin cerrar/],
    ['<!DOCTYPE a [', /declaración sin cerrar/], ['<a></a', /etiqueta sin cerrar/], ['<a', /etiqueta sin cerrar/], ['<a b="1"', /etiqueta sin cerrar/],
    ['<>', /sin nombre/], ['<a/x>', /inesperado/], ['<a b>', /sin valor/], ['<a b', /sin valor|sin cerrar/], ['<a b=1>', /sin comillas/], ['<a b="1>', /comillas sin cerrar/],
    ['<a></b>', /se esperaba <\/a>/], ['</a>', /se esperaba <\/…>/], ['<a><b></a>', /se esperaba <\/b>/], ['<a>', /falta cerrar <a>/], ['solo texto', /no tiene elementos/], ['', /no tiene elementos/]
  ];
  casos.forEach(([src, re]) => assert.throws(() => Xml.parse(src), re, src));
  assert.throws(() => Xml.parse(null), /no tiene elementos/);
  assert.throws(() => Xml.parse('<a>'.repeat(300)), /demasiado anidado/);
});

test('xml: espacios alrededor del igual, texto suelto, entidades inválidas y ayudas con nodos nulos', () => {
  const r = Xml.parse('texto antes <a  b = "1"  c=\'dos\' >uno &apos;x&apos; &#xD800; &#1114112; &#0; &desconocida;</a> texto final');
  assert.equal(r.attrs.b, '1'); assert.equal(r.attrs.c, 'dos');
  assert.match(Xml.text(r), /^uno 'x'/); assert.ok(Xml.text(r).includes('&desconocida;'));
  const conCola = Xml.parse('<a>hola</a>');
  assert.equal(Xml.text(conCola), 'hola');
  const sinCierre = Xml.parse('<a><b>x</b></a>trailing');
  assert.equal(Xml.text(Xml.child(sinCierre, 'b')), 'x');
  assert.equal(Xml.child(null, 'x'), null); assert.deepEqual(Xml.kids(null, 'x'), []); assert.equal(Xml.text(null), '');
  assert.equal(Xml.child(sinCierre, 'nada'), null); assert.equal(Xml.find(sinCierre, 'b').length, 1);
  assert.equal(Xml.escape(null), ''); assert.equal(Xml.escape('a<b>&"c'), 'a&lt;b&gt;&amp;&quot;c');
  assert.equal(Xml.decode('sin entidades'), 'sin entidades');
});

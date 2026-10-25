'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const Xml = require('../www/js/xml.js');
const Zip = require('../www/js/zip.js');
const { makeZip } = require('./helpers/zipbuild.js');

/* ---------- XML ---------- */
test('xml: lee elementos, atributos, texto y quita prefijos de espacio de nombres', () => {
  const r = Xml.parse('<?xml version="1.0"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">' +
    '<Document><name>Finca</name><gx:altitudeMode>absolute</gx:altitudeMode><Point id=\'a\' gx:x="1"/></Document></kml>');
  assert.equal(r.name, 'kml');
  const doc = Xml.child(r, 'Document');
  assert.equal(Xml.text(Xml.child(doc, 'name')), 'Finca');
  assert.equal(Xml.text(Xml.child(doc, 'altitudeMode')), 'absolute');
  const pt = Xml.child(doc, 'Point');
  assert.equal(pt.attrs.id, 'a');
  assert.equal(pt.attrs.x, '1');
  assert.equal(pt.children.length, 0);
});

test('xml: entidades, CDATA, comentarios y BOM', () => {
  const r = Xml.parse('﻿<a><!-- nota --><b>1 &lt; 2 &amp; 3 &#65;&#x42;</b><c><![CDATA[<no> & &amp;]]></c></a>');
  assert.equal(Xml.text(Xml.child(r, 'b')), '1 < 2 & 3 AB');
  assert.equal(Xml.text(Xml.child(r, 'c')), '<no> & &amp;');
});

test('xml: no expande entidades propias (DOCTYPE se ignora)', () => {
  const r = Xml.parse('<!DOCTYPE a [<!ENTITY x "AAAAAAAAAA"><!ENTITY y "&x;&x;&x;&x;">]><a>&y;</a>');
  assert.equal(Xml.text(r), '&y;');      // la entidad desconocida queda como texto, sin expandirse
});

test('xml: find, kids y texto de varios nodos', () => {
  const r = Xml.parse('<k><f><p><n>1</n></p><p><n>2</n></p></f><p><n>3</n></p></k>');
  assert.equal(Xml.find(r, 'p').length, 3);
  assert.equal(Xml.kids(r, 'p').length, 1);
  assert.deepEqual(Xml.find(r, 'n').map(Xml.text), ['1', '2', '3']);
});

test('xml: errores claros en archivos mal formados', () => {
  assert.throws(() => Xml.parse('<a><b></a>'), /se esperaba <\/b>/);
  assert.throws(() => Xml.parse('<a><b>'), /falta cerrar/);
  assert.throws(() => Xml.parse(''), /no tiene elementos/);
  assert.throws(() => Xml.parse('<a x=1></a>'), /sin comillas/);
  assert.throws(() => Xml.parse('<a><!-- sin fin</a>'), /comentario sin cerrar/);
  assert.throws(() => Xml.parse('<a>' + '<b>'.repeat(300) + '</b>'.repeat(300) + '</a>'), /demasiado anidado/);
});

test('xml: escape para escribir', () => {
  assert.equal(Xml.escape('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  assert.equal(Xml.escape(null), '');
});

/* ---------- Inflate ---------- */
function rnd(n, seed) { let s = seed; const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; b[i] = s >>> 24; } return b; }

test('zip.inflate: coincide con zlib en datos de todo tipo y nivel', () => {
  const samples = [
    Buffer.alloc(0), Buffer.from('a'), Buffer.from('hola mundo '.repeat(1000)),
    rnd(5000, 7), Buffer.concat([rnd(3000, 3), Buffer.alloc(20000, 65), rnd(1000, 9)]),
    Buffer.from(Array.from({ length: 4000 }, (_, i) => `-74.${String(95000 + i * 7).padStart(6, '0')},4.${String(92000 + i * 3).padStart(6, '0')},0 `).join(''))
  ];
  samples.forEach((raw, k) => {
    [0, 1, 6, 9].forEach((level) => {
      const out = Zip.inflate(new Uint8Array(zlib.deflateRawSync(raw, { level })));
      assert.ok(Buffer.from(out).equals(raw), 'muestra ' + k + ' nivel ' + level);
    });
    const fixed = zlib.deflateRawSync(raw, { strategy: zlib.constants.Z_FIXED });
    assert.ok(Buffer.from(Zip.inflate(new Uint8Array(fixed))).equals(raw), 'fijo ' + k);
  });
});

test('zip.inflate: datos cortados o dañados dan error, no cuelgan', () => {
  const comp = zlib.deflateRawSync(Buffer.from('texto repetido '.repeat(500)));
  assert.throws(() => Zip.inflate(new Uint8Array(comp.subarray(0, comp.length - 5))), /incompleto|dañado/);
  assert.throws(() => Zip.inflate(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])), /dañado|incompleto/);
});

test('zip.inflate: respeta el límite de tamaño (bomba zip)', () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(5 * 1024 * 1024, 0));
  assert.ok(bomb.length < 10000);
  assert.throws(() => Zip.inflate(new Uint8Array(bomb), 1024 * 1024), /demasiado grande/);
});

test('zip.crc32: valor conocido', () => {
  assert.equal(Zip.crc32(new Uint8Array(Buffer.from('123456789'))), 0xCBF43926);
});

/* ---------- ZIP ---------- */
test('zip: lista y extrae entradas comprimidas y sin comprimir', () => {
  const kml = '<kml><Document><name>Ñandú ✓</name></Document></kml>';
  const z = makeZip([{ name: 'doc.kml', data: kml }, { name: 'files/a.txt', data: 'hola', method: 0 }, { name: 'carpeta/', data: '', method: 0 }]);
  assert.ok(Zip.isZip(z));
  const es = Zip.entries(z);
  assert.deepEqual(es.map((e) => e.name), ['doc.kml', 'files/a.txt', 'carpeta/']);
  assert.equal(es[2].dir, true);
  assert.equal(Zip.utf8(Zip.extract(z, es[0])), kml);
  assert.equal(Zip.utf8(Zip.extract(z, es[1])), 'hola');
});

test('zip: nombres UTF-8 con la marca correspondiente', () => {
  const z = makeZip([{ name: 'ñandú.kml', data: '<a/>', utf8: true }]);
  assert.equal(Zip.entries(z)[0].name, 'ñandú.kml');
});

test('zip: detecta archivos dañados, con contraseña o que no son ZIP', () => {
  const z = makeZip([{ name: 'doc.kml', data: '<kml/>'.repeat(50) }], { badCrc: true });
  assert.throws(() => Zip.extract(z, Zip.entries(z)[0]), /dañado/);
  const enc = makeZip([{ name: 'doc.kml', data: 'x', encrypted: true }]);
  assert.throws(() => Zip.extract(enc, Zip.entries(enc)[0]), /contraseña/);
  assert.throws(() => Zip.entries(new Uint8Array(Buffer.from('esto no es un zip, solo texto largo largo largo'))), /no es un archivo ZIP/i);
  assert.equal(Zip.isZip(new Uint8Array(Buffer.from('<kml>'))), false);
  const cut = makeZip([{ name: 'doc.kml', data: 'abc'.repeat(100) }]);
  assert.throws(() => Zip.entries(cut.subarray(0, cut.length - 30)), /no es un archivo ZIP|dañado/i);
});

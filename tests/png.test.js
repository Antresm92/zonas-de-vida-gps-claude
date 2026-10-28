'use strict';
/* El PNG de mentira que usan las pruebas del mapa debe ser un PNG válido. */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { solidPng, crc32 } = require('./helpers/png.js');

test('crc32: valor conocido de la especificación', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('solidPng: firma, cabecera y píxeles del color pedido', () => {
  const png = solidPng(10, 20, 30, 255, 8);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 8);
  assert.equal(png.readUInt32BE(20), 8);
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  // cada trozo trae un CRC correcto
  let pos = 8, idat = null, seen = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.subarray(pos + 4, pos + 8).toString('ascii');
    const body = png.subarray(pos + 4, pos + 8 + len);
    assert.equal(png.readUInt32BE(pos + 8 + len), crc32(body), 'CRC de ' + type);
    if (type === 'IDAT') idat = png.subarray(pos + 8, pos + 8 + len);
    seen.push(type); pos += 12 + len;
  }
  assert.deepEqual(seen, ['IHDR', 'IDAT', 'IEND']);
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, 8 * (1 + 8 * 4));
  assert.deepEqual([...raw.subarray(0, 5)], [0, 10, 20, 30, 255]);
});

test('solidPng: por defecto mide 256 × 256, el tamaño de un mosaico', () => {
  assert.equal(solidPng(0, 0, 0, 0).readUInt32BE(16), 256);
});

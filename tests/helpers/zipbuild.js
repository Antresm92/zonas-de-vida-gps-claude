/* Ayuda para las pruebas: arma archivos ZIP (como un .kmz) con el zlib de Node. No se incluye en la app. */
'use strict';
const zlib = require('zlib');
const { crc32 } = require('../../www/js/zip.js');

function le16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function le32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

// files: [{ name, data: Buffer|string, method: 0|8 (por defecto 8), utf8: bool }]
function makeZip(files, opts) {
  opts = opts || {};
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach((f) => {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const method = f.method === 0 ? 0 : 8;
    const comp = method === 0 ? raw : zlib.deflateRawSync(raw, { level: f.level === undefined ? 6 : f.level });
    const name = Buffer.from(f.name, f.utf8 ? 'utf8' : 'latin1');
    const crc = opts.badCrc ? 12345 : crc32(raw);
    const flags = (f.utf8 ? 0x800 : 0) | (f.encrypted ? 1 : 0);
    const local = Buffer.concat([le32(0x04034B50), le16(20), le16(flags), le16(method), le16(0), le16(0x21), le32(crc), le32(comp.length), le32(raw.length), le16(name.length), le16(0), name, comp]);
    const central = Buffer.concat([le32(0x02014B50), le16(20), le16(20), le16(flags), le16(method), le16(0), le16(0x21), le32(crc), le32(comp.length), le32(raw.length), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name]);
    locals.push(local); centrals.push(central);
    offset += local.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([le32(0x06054B50), le16(0), le16(0), le16(files.length), le16(files.length), le32(cd.length), le32(offset), le16(0)]);
  return new Uint8Array(Buffer.concat(locals.concat([cd, eocd])));
}

module.exports = { makeZip };

/* zip.js — lector de archivos ZIP (los .kmz de Google Earth son ZIP). Sin dependencias.
 * La descompresión (deflate) está escrita aquí, así no depende de que el WebView del teléfono tenga
 * DecompressionStream. Verifica el CRC-32 y limita el tamaño descomprimido (protección contra "bombas zip"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Zip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_OUT = 64 * 1024 * 1024;       // tamaño máximo descomprimido por entrada
  var MAX_ENTRIES = 5000;

  /* ---------- CRC-32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- Inflate (RFC 1951) ---------- */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function build(lengths, n) {
    var count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < n; i++) if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
    return { count: count, symbol: symbol };
  }

  var FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED = { lit: build(l, 288), dist: build(d, 30) };
    return FIXED;
  }

  function inflate(src, maxOut) {
    maxOut = maxOut || MAX_OUT;
    var pos = 0, bitBuf = 0, bitCnt = 0;
    var out = new Uint8Array(Math.min(Math.max(4096, src.length * 4), maxOut)), op = 0;

    function bits(n) {
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error('El archivo comprimido está incompleto.');
        bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
      }
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n; bitCnt -= n;
      return v;
    }
    function decodeSym(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var cnt = h.count[len];
        if (code - cnt < first) return h.symbol[index + (code - first)];
        index += cnt; first += cnt; first <<= 1; code <<= 1;
      }
      throw new Error('El archivo comprimido está dañado.');
    }
    function ensure(extra) {
      if (op + extra <= out.length) return;
      if (op + extra > maxOut) throw new Error('El archivo descomprimido es demasiado grande.');
      var nl = Math.min(Math.max(out.length * 2, op + extra), maxOut);
      var no = new Uint8Array(nl);
      no.set(out.subarray(0, op));
      out = no;
    }
    function codes(lit, dist) {
      for (;;) {
        var sym = decodeSym(lit);
        if (sym < 256) { ensure(1); out[op++] = sym; }
        else if (sym === 256) return;
        else {
          sym -= 257;
          if (sym >= 29) throw new Error('El archivo comprimido está dañado.');
          var len = LBASE[sym] + bits(LEXT[sym]);
          var ds = decodeSym(dist);
          if (ds >= 30) throw new Error('El archivo comprimido está dañado.');
          var d = DBASE[ds] + bits(DEXT[ds]);
          if (d > op) throw new Error('El archivo comprimido está dañado.');
          ensure(len);
          for (var k = 0; k < len; k++) { out[op] = out[op - d]; op++; }
        }
      }
    }

    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;                       // alinear al byte
        if (pos + 4 > src.length) throw new Error('El archivo comprimido está incompleto.');
        var len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
        if ((len ^ 0xFFFF) !== nlen) throw new Error('El archivo comprimido está dañado.');
        pos += 4;
        if (pos + len > src.length) throw new Error('El archivo comprimido está incompleto.');
        ensure(len);
        out.set(src.subarray(pos, pos + len), op);
        op += len; pos += len;
      } else if (type === 1) {
        var f = fixedTables();
        codes(f.lit, f.dist);
      } else if (type === 2) {
        var nlen2 = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, i;
        if (nlen2 > 286 || ndist > 30) throw new Error('El archivo comprimido está dañado.');
        var lengths = new Uint8Array(320);
        for (i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = bits(3);
        var clh = build(lengths.subarray(0, 19), 19);
        var idx = 0, all = new Uint8Array(nlen2 + ndist);
        while (idx < nlen2 + ndist) {
          var s = decodeSym(clh);
          if (s < 16) all[idx++] = s;
          else {
            var prev = 0, rep;
            if (s === 16) { if (idx === 0) throw new Error('El archivo comprimido está dañado.'); prev = all[idx - 1]; rep = 3 + bits(2); }
            else if (s === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (idx + rep > nlen2 + ndist) throw new Error('El archivo comprimido está dañado.');
            while (rep--) all[idx++] = prev;
          }
        }
        codes(build(all.subarray(0, nlen2), nlen2), build(all.subarray(nlen2), ndist));
      } else throw new Error('El archivo comprimido está dañado.');
    } while (!last);
    return out.subarray(0, op);
  }

  /* ---------- Lectura del ZIP ---------- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function latin1(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }

  function isZip(bytes) { return !!bytes && bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 3 || bytes[2] === 5); }

  // Lista de entradas: [{ name, method, csize, size, crc, offset, flags, dir }]
  function entries(bytes) {
    if (!bytes || bytes.length < 22) throw new Error('No es un archivo ZIP/KMZ válido.');
    var eocd = -1, min = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= min; i--) if (u32(bytes, i) === 0x06054B50) { eocd = i; break; }
    if (eocd < 0) throw new Error('No es un archivo ZIP/KMZ válido.');
    var total = u16(bytes, eocd + 10), cdOff = u32(bytes, eocd + 16);
    if (total === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('Este ZIP es demasiado grande (ZIP64) y no se puede leer.');
    if (total > MAX_ENTRIES) throw new Error('El archivo trae demasiados elementos.');
    var p = cdOff, list = [];
    for (var k = 0; k < total; k++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014B50) throw new Error('El archivo ZIP está dañado.');
      var flags = u16(bytes, p + 8), nlen = u16(bytes, p + 28), elen = u16(bytes, p + 30), clen = u16(bytes, p + 32);
      var nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
      var name = (flags & 0x800) ? utf8(nameBytes) : latin1(nameBytes);
      list.push({ name: name, flags: flags, method: u16(bytes, p + 10), crc: u32(bytes, p + 16), csize: u32(bytes, p + 20),
                  size: u32(bytes, p + 24), offset: u32(bytes, p + 42), dir: name.charAt(name.length - 1) === '/' });
      p += 46 + nlen + elen + clen;
    }
    return list;
  }

  // Contenido (Uint8Array) de una entrada
  function extract(bytes, entry, maxOut) {
    if (entry.flags & 1) throw new Error('El archivo está protegido con contraseña.');
    var o = entry.offset;
    if (o + 30 > bytes.length || u32(bytes, o) !== 0x04034B50) throw new Error('El archivo ZIP está dañado.');
    var start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
    if (start + entry.csize > bytes.length) throw new Error('El archivo ZIP está incompleto.');
    var data = bytes.subarray(start, start + entry.csize), out;
    if (entry.method === 0) out = data;
    else if (entry.method === 8) {
      if (entry.size > (maxOut || MAX_OUT)) throw new Error('El archivo descomprimido es demasiado grande.');
      out = inflate(data, maxOut);
    } else throw new Error('Este ZIP usa un método de compresión no soportado (' + entry.method + ').');
    if (out.length !== entry.size) throw new Error('El archivo ZIP está dañado (tamaño no coincide).');
    if (crc32(out) !== entry.crc) throw new Error('El archivo ZIP está dañado (falló la verificación).');
    return out;
  }

  return { entries: entries, extract: extract, inflate: inflate, crc32: crc32, isZip: isZip, utf8: utf8 };
});

/* shp.js — exporta el terreno como Shapefile (el formato que piden ArcGIS, QGIS y muchas entidades).
 *
 * Un «shapefile» son varios archivos con el mismo nombre: .shp (las figuras), .shx (el índice), .dbf (la tabla de datos),
 * .prj (el sistema de coordenadas) y .cpg (en qué codificación está el texto). Aquí se arman dos:
 *   <nombre>_puntos    → un punto por cada punto del terreno, con nombre, orden, latitud, longitud, altitud y planas
 *   <nombre>_poligono  → el lindero (solo si hay 3 puntos o más), con nombre, área y perímetro
 * Las coordenadas van en grados WGS84 (EPSG:4326), tal como las guarda la app; así sirve dentro y fuera de Colombia.
 *   files(model) → [{ name, bytes }]      model = { name, base, points }
 *   zip(model, now) → bytes de un .zip con todos los archivos (QGIS abre el .zip directamente)
 * Formato: ESRI Shapefile Technical Description (1998) y dBASE III para el .dbf.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./zip.js'));
  else root.Shp = factory(root.Geo, root.Zip);
})(typeof self !== 'undefined' ? self : this, function (Geo, Zip) {
  'use strict';

  var PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  var POINT = 1, POLYGON = 5;
  var MAX_NAME = 80;                  // bytes del campo de texto NOMBRE

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }
  function utf8(s) { return new TextEncoder().encode(String(s)); }

  /* ---------- .shp y .shx ---------- */
  function header(dv, type, words, box) {
    dv.setInt32(0, 9994, false);            // código de archivo (los 5 enteros siguientes quedan en 0)
    dv.setInt32(24, words, false);          // largo del archivo en palabras de 16 bits
    dv.setInt32(28, 1000, true);            // versión
    dv.setInt32(32, type, true);
    dv.setFloat64(36, box[0], true); dv.setFloat64(44, box[1], true); dv.setFloat64(52, box[2], true); dv.setFloat64(60, box[3], true);
    // Z y M (68..99) quedan en 0: las figuras no llevan altura ni medida
  }
  function bbox(pts) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    pts.forEach(function (p) { b[0] = Math.min(b[0], p.lon); b[1] = Math.min(b[1], p.lat); b[2] = Math.max(b[2], p.lon); b[3] = Math.max(b[3], p.lat); });
    return pts.length ? b : [0, 0, 0, 0];
  }
  // contents: un Uint8Array por figura (sin el encabezado del registro). Devuelve { shp, shx }
  function shapeFiles(type, contents, box) {
    var size = 100, n = contents.length;
    contents.forEach(function (c) { size += 8 + c.length; });
    var shp = new Uint8Array(size), shx = new Uint8Array(100 + 8 * n);
    var dv = new DataView(shp.buffer), dx = new DataView(shx.buffer), off = 100;
    header(dv, type, size / 2, box); header(dx, type, shx.length / 2, box);
    contents.forEach(function (c, i) {
      dv.setInt32(off, i + 1, false); dv.setInt32(off + 4, c.length / 2, false);
      shp.set(c, off + 8);
      dx.setInt32(100 + 8 * i, off / 2, false); dx.setInt32(104 + 8 * i, c.length / 2, false);
      off += 8 + c.length;
    });
    return { shp: shp, shx: shx };
  }
  function pointContent(p) {
    var c = new Uint8Array(20), dv = new DataView(c.buffer);
    dv.setInt32(0, POINT, true); dv.setFloat64(4, p.lon, true); dv.setFloat64(12, p.lat, true);
    return c;
  }
  // Área con signo en el plano lon/lat: negativa = sentido de las agujas del reloj
  function signedArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; s += a.lon * b.lat - b.lon * a.lat; }
    return s / 2;
  }
  // Anillo exterior de un polígono: cerrado (el primero se repite al final) y en el sentido de las agujas del reloj, como pide el formato
  function ring(pts) {
    var r = signedArea(pts) > 0 ? pts.slice().reverse() : pts.slice();
    r.push(r[0]);
    return r;
  }
  function polygonContent(pts) {
    var r = ring(pts), b = bbox(pts), c = new Uint8Array(44 + 4 + 16 * r.length), dv = new DataView(c.buffer);
    dv.setInt32(0, POLYGON, true);
    dv.setFloat64(4, b[0], true); dv.setFloat64(12, b[1], true); dv.setFloat64(20, b[2], true); dv.setFloat64(28, b[3], true);
    dv.setInt32(36, 1, true); dv.setInt32(40, r.length, true); dv.setInt32(44, 0, true);     // una sola parte, que empieza en el punto 0
    r.forEach(function (p, i) { dv.setFloat64(48 + 16 * i, p.lon, true); dv.setFloat64(56 + 16 * i, p.lat, true); });
    return c;
  }

  /* ---------- .dbf ---------- */
  // Texto recortado a `max` bytes UTF-8 sin partir una letra por la mitad
  function clip(s, max) {
    var b = utf8(s);
    if (b.length <= max) return b;
    var end = max;
    while (end > 0 && (b[end] & 0xC0) === 0x80) end--;      // no cortar dentro de un carácter de varios bytes
    return b.subarray(0, end);
  }
  function numText(v, len, dec) {
    if (!isNum(v)) return '';
    var s = v.toFixed(dec);
    return s.length > len ? '' : s;
  }
  // fields: [{ name, type: 'C'|'N', len, dec }]; rows: una lista de valores por registro, en el orden de los campos
  function dbf(fields, rows, now) {
    var recLen = 1, headLen = 32 + 32 * fields.length + 1;
    fields.forEach(function (f) { recLen += f.len; });
    var out = new Uint8Array(headLen + recLen * rows.length + 1), dv = new DataView(out.buffer), d = new Date(typeof now === 'number' ? now : Date.now());
    out[0] = 0x03; out[1] = d.getFullYear() - 1900; out[2] = d.getMonth() + 1; out[3] = d.getDate();
    dv.setUint32(4, rows.length, true); dv.setUint16(8, headLen, true); dv.setUint16(10, recLen, true);
    fields.forEach(function (f, i) {
      var o = 32 + 32 * i;
      for (var k = 0; k < f.name.length && k < 10; k++) out[o + k] = f.name.charCodeAt(k);
      out[o + 11] = f.type.charCodeAt(0); out[o + 16] = f.len; out[o + 17] = f.dec || 0;
    });
    out[headLen - 1] = 0x0D;
    var p = headLen;
    rows.forEach(function (r) {
      out[p] = 0x20;                                          // registro vigente (no borrado)
      var q = p + 1;
      fields.forEach(function (f, i) {
        var k;
        for (k = 0; k < f.len; k++) out[q + k] = 0x20;
        if (f.type === 'C') out.set(clip(r[i] === null || r[i] === undefined ? '' : r[i], f.len), q);          // texto: a la izquierda
        else { var t = numText(r[i], f.len, f.dec || 0); for (k = 0; k < t.length; k++) out[q + f.len - t.length + k] = t.charCodeAt(k); }   // número: a la derecha
        q += f.len;
      });
      p += recLen;
    });
    out[p] = 0x1A;
    return out;
  }

  /* ---------- Los archivos del terreno ---------- */
  var POINT_FIELDS = [
    { name: 'NOMBRE', type: 'C', len: MAX_NAME }, { name: 'ORDEN', type: 'N', len: 6 },
    { name: 'LATITUD', type: 'N', len: 12, dec: 7 }, { name: 'LONGITUD', type: 'N', len: 13, dec: 7 }, { name: 'ALTITUD_M', type: 'N', len: 9, dec: 1 },
    { name: 'ESTE_ON', type: 'N', len: 13, dec: 2 }, { name: 'NORTE_ON', type: 'N', len: 13, dec: 2 }
  ];
  var POLY_FIELDS = [
    { name: 'NOMBRE', type: 'C', len: MAX_NAME }, { name: 'AREA_HA', type: 'N', len: 16, dec: 4 }, { name: 'AREA_M2', type: 'N', len: 16, dec: 1 },
    { name: 'PERIM_M', type: 'N', len: 14, dec: 2 }, { name: 'VERTICES', type: 'N', len: 6 }
  ];
  function set(base, parts, table) {
    return [
      { name: base + '.shp', bytes: parts.shp }, { name: base + '.shx', bytes: parts.shx }, { name: base + '.dbf', bytes: table },
      { name: base + '.prj', bytes: utf8(PRJ) }, { name: base + '.cpg', bytes: utf8('UTF-8') }
    ];
  }
  // model.lots = [{ name, points }] (2.15.0): todos los lotes en las mismas dos capas, con una columna LOTE. Sin lots: un solo terreno (model.points).
  function files(model, now) {
    model = model || {};
    var multi = Array.isArray(model.lots);
    var lots = (multi ? model.lots : [{ name: model.name, points: model.points }]).map(function (l) {
      return { name: (l && l.name) || '', tipo: (l && l.tipo) || '', pts: ((l && l.points) || []).filter(validLL) };
    }).filter(function (l) { return l.pts.length; });
    var all = [];
    lots.forEach(function (l) { all = all.concat(l.pts); });
    if (!all.length) throw new Error('No hay puntos para exportar.');
    var base = String(model.base || 'terreno'), box = bbox(all), LOTE = { name: 'LOTE', type: 'C', len: 40 };
    var tipos = multi && lots.some(function (l) { return l.tipo; }), PRE = tipos ? [LOTE, { name: 'TIPO', type: 'C', len: 60 }] : [LOTE];      // con fincas y áreas (2.17.0): columna TIPO
    function pre(l) { return tipos ? [l.name, l.tipo || 'Lote'] : [l.name]; }
    var prow = [], contents = [];
    lots.forEach(function (l) {
      l.pts.forEach(function (p, i) {
        var on = Geo.origenNacional(p.lat, p.lon);
        var r = [p.name || ('P' + (i + 1)), i + 1, p.lat, p.lon, isNum(p.alt) ? p.alt : null, on ? on.e : null, on ? on.n : null];
        prow.push(multi ? pre(l).concat(r) : r);
        contents.push(pointContent(p));
      });
    });
    var out = set(base + '_puntos', shapeFiles(POINT, contents, box), dbf(multi ? PRE.concat(POINT_FIELDS) : POINT_FIELDS, prow, now));
    var polys = lots.filter(function (l) { return l.pts.length >= 3; });
    if (polys.length) {
      var pall = [];
      polys.forEach(function (l) { pall = pall.concat(l.pts); });
      out = out.concat(set(base + '_poligono', shapeFiles(POLYGON, polys.map(function (l) { return polygonContent(l.pts); }), bbox(pall)),
        dbf(multi ? PRE.concat(POLY_FIELDS) : POLY_FIELDS, polys.map(function (l) {
          var m2 = Geo.polygonArea(l.pts), r = [(multi ? model.name : l.name) || 'Terreno', m2 / 10000, m2, Geo.perimeter(l.pts, true), l.pts.length];
          return multi ? pre(l).concat(r) : r;
        }), now)));
    }
    return out;
  }
  function zip(model, now) { return Zip.create(files(model, now), now); }

  return { files: files, zip: zip, dbf: dbf, ring: ring, signedArea: signedArea, clip: clip, PRJ: PRJ, POINT_FIELDS: POINT_FIELDS, POLY_FIELDS: POLY_FIELDS };
});

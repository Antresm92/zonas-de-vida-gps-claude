/* geo.js — coordenadas, distancias y áreas sobre el elipsoide WGS84.
 * Funciona en el navegador (window.Geo) y en Node (require) sin dependencias. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var A = 6378137.0;                 // semieje mayor WGS84 (m)
  var F = 1 / 298.257223563;         // aplanamiento
  var B = A * (1 - F);               // semieje menor
  var E2 = F * (2 - F);              // excentricidad al cuadrado
  var E = Math.sqrt(E2);
  var FANEGADA_M2 = 6400;            // fanegada colombiana (80 m x 80 m)

  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }

  /* ---------- Lectura de coordenadas ---------- */

  // Convierte texto a grados decimales. axis: 'lat' | 'lon'.
  // Acepta: 4.6097  |  -74,0817  |  4°36'35.2"N  |  74 4 54 W  |  N 4 36 35  |  74°04'54"O
  function parseAngle(input, axis) {
    if (input === null || input === undefined) return { error: 'Vacío' };
    if (typeof input === 'number') {
      return finish(input, axis);
    }
    var s = String(input).trim().toUpperCase();
    if (!s) return { error: 'Vacío' };

    var letters = s.match(/[NSEWO]/g) || [];
    if (letters.length > 1) return { error: 'Demasiadas letras de hemisferio' };
    var hemi = letters[0] || null;
    if (hemi) {
      if (axis === 'lat' && hemi !== 'N' && hemi !== 'S') return { error: 'La latitud usa N o S' };
      if (axis === 'lon' && hemi !== 'E' && hemi !== 'W' && hemi !== 'O') return { error: 'La longitud usa E, W u O' };
    }
    var rest = s.replace(/[NSEWO]/g, ' ');
    var negLead = /^\s*-/.test(rest) || /^\s*−/.test(rest);
    rest = rest.replace(/[°º˚'’′"″”“‘]/g, ' ').replace(/−/g, '-');
    var nums = rest.match(/[-+]?\d+(?:[.,]\d+)?|[-+]?[.,]\d+/g);
    if (!nums) return { error: 'No hay números' };
    // Restos no numéricos (aparte de separadores) => error
    var leftover = rest.replace(/[-+]?\d+(?:[.,]\d+)?|[-+]?[.,]\d+/g, '').replace(/[\s:_]/g, '');
    if (leftover) return { error: 'Caracteres no válidos: ' + leftover.charAt(0) };
    if (nums.length > 3) return { error: 'Formato no reconocido' };

    var vals = nums.map(function (n) { return parseFloat(n.replace(',', '.')); });
    if (vals.some(function (v) { return !isFinite(v); })) return { error: 'Número no válido' };
    var d = Math.abs(vals[0]);
    var m = vals.length > 1 ? vals[1] : 0;
    var sec = vals.length > 2 ? vals[2] : 0;
    if (vals.length > 1 && (m < 0 || m >= 60)) return { error: 'Los minutos deben estar entre 0 y 59' };
    if (vals.length > 2 && (sec < 0 || sec >= 60)) return { error: 'Los segundos deben estar entre 0 y 59.99' };
    if (vals.length > 1 && d !== Math.floor(d)) return { error: 'Con minutos, los grados deben ser enteros' };
    if (vals.length > 2 && m !== Math.floor(m)) return { error: 'Con segundos, los minutos deben ser enteros' };
    var v = d + m / 60 + sec / 3600;
    var neg = negLead || vals[0] < 0 || hemi === 'S' || hemi === 'W' || hemi === 'O';
    return finish(neg ? -v : v, axis);
  }

  function finish(v, axis) {
    if (!isFinite(v)) return { error: 'Número no válido' };
    var lim = axis === 'lat' ? 90 : 180;
    if (Math.abs(v) > lim) return { error: (axis === 'lat' ? 'Latitud' : 'Longitud') + ' fuera de rango (±' + lim + ')' };
    return { value: v };
  }

  // Lee un par "lat, lon" en muchos formatos. Devuelve {lat, lon} o {error}.
  function parsePair(input) {
    var s = String(input || '').trim();
    if (!s) return { error: 'Vacío' };
    var up = s.toUpperCase();
    var idx = [];
    var re = /[NSEWO]/g, m;
    while ((m = re.exec(up))) idx.push({ i: m.index, c: m[0] });
    var a, b;
    if (idx.length === 2) {
      var first = idx[0], second = idx[1];
      var digitsBefore = /\d/.test(s.slice(0, first.i));
      if (digitsBefore) { a = s.slice(0, first.i + 1); b = s.slice(first.i + 1); }
      else { a = s.slice(0, second.i); b = s.slice(second.i); }
    } else if (idx.length === 0 || idx.length === 1) {
      if (s.indexOf(';') >= 0) {
        var p = s.split(';'); a = p[0]; b = p.slice(1).join(';');
      } else {
        var commas = (s.match(/,/g) || []).length;
        if (commas === 1 && (/\./.test(s) || /,\s/.test(s))) {
          var q = s.split(','); a = q[0]; b = q[1];
        } else {
          var t = s.split(/\s+/);
          if (t.length === 2) { a = t[0]; b = t[1]; }
          else if (commas === 1) { var q2 = s.split(','); a = q2[0]; b = q2[1]; }
          else return { error: 'No pude separar latitud y longitud' };
        }
      }
    } else return { error: 'Formato no reconocido' };

    // quita separadores sobrantes (coma, punto y coma, espacios) en los extremos de cada parte
    a = a.replace(/^[\s,;]+|[\s,;]+$/g, '');
    b = b.replace(/^[\s,;]+|[\s,;]+$/g, '');
    var ra, rb;
    var aLetter = (a.toUpperCase().match(/[NSEWO]/) || [])[0];
    var bLetter = (b.toUpperCase().match(/[NSEWO]/) || [])[0];
    var aIsLon = aLetter && /[EWO]/.test(aLetter);
    var bIsLat = bLetter && /[NS]/.test(bLetter);
    if (aIsLon || bIsLat) { var tmp = a; a = b; b = tmp; }
    ra = parseAngle(a, 'lat');
    if (ra.error) return { error: 'Latitud: ' + ra.error };
    rb = parseAngle(b, 'lon');
    if (rb.error) return { error: 'Longitud: ' + rb.error };
    return { lat: ra.value, lon: rb.value };
  }

  /* ---------- Formato ---------- */

  function toDMS(v, axis, secDecimals) {
    var sd = secDecimals === undefined ? 2 : secDecimals;
    var hemi = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    var x = Math.abs(v);
    var d = Math.floor(x);
    var mFull = (x - d) * 60;
    var m = Math.floor(mFull);
    var s = (mFull - m) * 60;
    var sr = Number(s.toFixed(sd));
    if (sr >= 60) { sr = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + '° ' + pad2(m) + "' " + (sr < 10 ? '0' : '') + sr.toFixed(sd) + '" ' + hemi;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDec(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }

  /* ---------- Distancias ---------- */

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371008.8;
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Problema inverso de Vincenty sobre WGS84 (metros). Respaldo: haversine.
  function distance(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) return 0;
    var L = rad(lon2 - lon1);
    var U1 = Math.atan((1 - F) * Math.tan(rad(lat1)));
    var U2 = Math.atan((1 - F) * Math.tan(rad(lat2)));
    var sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    var sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    var lambda = L, lambdaP, iter = 0;
    var sinSigma, cosSigma, sigma, sinAlpha, cos2Alpha, cos2SigmaM, C;
    do {
      var sinL = Math.sin(lambda), cosL = Math.cos(lambda);
      sinSigma = Math.sqrt((cosU2 * sinL) * (cosU2 * sinL) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosL) * (cosU1 * sinU2 - sinU1 * cosU2 * cosL));
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = cosU1 * cosU2 * sinL / sinSigma;
      cos2Alpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cos2Alpha !== 0 ? cosSigma - 2 * sinU1 * sinU2 / cos2Alpha : 0;
      C = F / 16 * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
      lambdaP = lambda;
      lambda = L + (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iter < 200);
    if (iter >= 200) return haversine(lat1, lon1, lat2, lon2);
    var uSq = cos2Alpha * (A * A - B * B) / (B * B);
    var K1 = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    var K2 = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    var dSigma = K2 * sinSigma * (cos2SigmaM + K2 / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
      K2 / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    return B * K1 * (sigma - dSigma);
  }

  /* ---------- Área ---------- */

  // q(φ) de la latitud autálica (Snyder, ec. 3-12)
  function qOf(phi) {
    var s = Math.sin(phi);
    return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
  }
  var QP = qOf(Math.PI / 2);
  var RQ = A * Math.sqrt(QP / 2);      // radio de la esfera de igual área (6371007.18 m)

  // Área (m²) de un polígono [{lat, lon}, ...] sobre el elipsoide.
  // Método de igual área: latitud autálica + integral de contorno (Chamberlain–Duquette).
  // Es exacto para el elipsoide cuando los lados siguen paralelos y meridianos; para lados
  // oblicuos la diferencia con una geodésica es despreciable en parcelas y fincas
  // (milésimas de por ciento). No sirve para polígonos que encierran un polo.
  function polygonArea(pts) {
    var n = pts.length;
    if (n < 3) return 0;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var p1 = pts[i], p2 = pts[(i + 1) % n];
      var dl = rad(p2.lon - p1.lon);
      while (dl > Math.PI) dl -= 2 * Math.PI;
      while (dl < -Math.PI) dl += 2 * Math.PI;
      var s1 = qOf(rad(p1.lat)) / QP;
      var s2 = qOf(rad(p2.lat)) / QP;
      sum += dl * (2 + s1 + s2);
    }
    return Math.abs(sum) * RQ * RQ / 2;
  }

  function perimeter(pts, closed) {
    var n = pts.length;
    if (n < 2) return 0;
    var total = 0;
    for (var i = 0; i < n - 1; i++) total += distance(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
    if (closed !== false && n > 2) total += distance(pts[n - 1].lat, pts[n - 1].lon, pts[0].lat, pts[0].lon);
    return total;
  }

  function areaUnits(m2) {
    return { m2: m2, ha: m2 / 10000, km2: m2 / 1e6, fanegadas: m2 / FANEGADA_M2 };
  }

  /* ---------- Plano local (para dibujar, centroide e intersecciones) ---------- */

  function localFrame(pts) {
    var lat0 = 0, lon0 = 0;
    pts.forEach(function (p) { lat0 += p.lat; lon0 += p.lon; });
    lat0 /= pts.length; lon0 /= pts.length;
    // radios de curvatura en lat0
    var s = Math.sin(rad(lat0));
    var w = Math.sqrt(1 - E2 * s * s);
    var M = A * (1 - E2) / (w * w * w);
    var N = A / w;
    return { lat0: lat0, lon0: lon0, kx: N * Math.cos(rad(lat0)) * Math.PI / 180, ky: M * Math.PI / 180 };
  }
  function toXY(frame, p) {
    return { x: (p.lon - frame.lon0) * frame.kx, y: (p.lat - frame.lat0) * frame.ky };
  }
  function fromXY(frame, xy) {
    return { lat: frame.lat0 + xy.y / frame.ky, lon: frame.lon0 + xy.x / frame.kx };
  }

  function centroid(pts) {
    if (!pts.length) return null;
    if (pts.length < 3) {
      var la = 0, lo = 0;
      pts.forEach(function (p) { la += p.lat; lo += p.lon; });
      return { lat: la / pts.length, lon: lo / pts.length };
    }
    var fr = localFrame(pts);
    var xy = pts.map(function (p) { return toXY(fr, p); });
    var a2 = 0, cx = 0, cy = 0;
    for (var i = 0; i < xy.length; i++) {
      var p = xy[i], q = xy[(i + 1) % xy.length];
      var cr = p.x * q.y - q.x * p.y;
      a2 += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    }
    if (Math.abs(a2) < 1e-9) {
      var mx = 0, my = 0;
      xy.forEach(function (p) { mx += p.x; my += p.y; });
      return fromXY(fr, { x: mx / xy.length, y: my / xy.length });
    }
    return fromXY(fr, { x: cx / (3 * a2), y: cy / (3 * a2) });
  }

  function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
  function segCross(p1, p2, p3, p4) {
    var d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  // true si los lados del polígono se cruzan entre sí (orden de vértices equivocado)
  function selfIntersects(pts) {
    var n = pts.length;
    if (n < 4) return false;
    var fr = localFrame(pts);
    var xy = pts.map(function (p) { return toXY(fr, p); });
    for (var i = 0; i < n; i++) {
      var a1 = xy[i], a2 = xy[(i + 1) % n];
      for (var j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        var b1 = xy[j], b2 = xy[(j + 1) % n];
        if (segCross(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  // Devuelve los índices de los puntos ordenados por ángulo alrededor de su centro
  // (arregla el orden cuando los vértices se tomaron "saltando").
  function angularOrder(pts) {
    var fr = localFrame(pts);
    var xy = pts.map(function (p, i) { var q = toXY(fr, p); q.i = i; return q; });
    xy.sort(function (a, b) { return Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x); });
    return xy.map(function (q) { return q.i; });
  }

  // Rumbo inicial (grados 0-360) de p1 a p2
  function bearing(lat1, lon1, lat2, lon2) {
    var y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    var x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  return {
    parseAngle: parseAngle, parsePair: parsePair, toDMS: toDMS, fmtDec: fmtDec,
    distance: distance, haversine: haversine, polygonArea: polygonArea, perimeter: perimeter,
    areaUnits: areaUnits, centroid: centroid, localFrame: localFrame, toXY: toXY, fromXY: fromXY,
    selfIntersects: selfIntersects, angularOrder: angularOrder, bearing: bearing,
    FANEGADA_M2: FANEGADA_M2, RQ: RQ
  };
});

/* holdridge.js — clasificación de zonas de vida de Holdridge.
 *
 * Geometría (coincide con el diagrama triangular clásico):
 *   U = log2(P / 125)         P   = precipitación anual (mm)
 *   V = log2(ETP / 125)       ETP = BT * 58.93 (mm)  -> las líneas de BT son horizontales
 *   r = log2(ETP / P) = V - U (relación de evapotranspiración potencial, en octavas)
 * Posición en el plano: X = 2U - V, Y = sqrt(3) V (unidades de media celda hexagonal).
 * Los hexágonos (celdas de Voronoi de una red triangular) tienen centro en
 *   V = k entero (k = 0..4)  y  U = m + 0.5, es decir r = k - U semientero.
 * Funciona en el navegador (window.Holdridge) y en Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Holdridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PET_FACTOR = 58.93;
  var P0 = 125;
  var SQRT3 = Math.sqrt(3);
  var FROST_V = 3;                  // línea de escarcha: ETP = 1000 mm (BT ≈ 17 °C)
  var BT_FROST = 125 * Math.pow(2, FROST_V) / PET_FACTOR;   // 16.97 °C

  // Límites del triángulo del diagrama
  var U_MIN = -3;                   // P = 15.625 mm
  var R_MIN = -4;                   // PER = 0.0625
  var V_MAX = 4;                    // ETP = 2000 mm

  /* ---------- Provincias de humedad (por relación ETP/P) ---------- */
  var HUMIDITY = [
    { id: 'desecado',     name: 'Desecado',     range: 'más de 32',     minR: 5 },
    { id: 'superarido',   name: 'Superárido',   range: '16 – 32',       minR: 4 },
    { id: 'perarido',     name: 'Perárido',     range: '8 – 16',        minR: 3 },
    { id: 'arido',        name: 'Árido',        range: '4 – 8',         minR: 2 },
    { id: 'semiarido',    name: 'Semiárido',    range: '2 – 4',         minR: 1 },
    { id: 'subhumedo',    name: 'Subhúmedo',    range: '1 – 2',         minR: 0 },
    { id: 'humedo',       name: 'Húmedo',       range: '0,5 – 1',       minR: -1 },
    { id: 'perhumedo',    name: 'Perhúmedo',    range: '0,25 – 0,5',    minR: -2 },
    { id: 'superhumedo',  name: 'Superhúmedo',  range: '0,125 – 0,25',  minR: -3 },
    { id: 'semisaturado', name: 'Semisaturado', range: '0,0625 – 0,125', minR: -4 },
    { id: 'saturado',     name: 'Saturado',     range: 'menos de 0,0625', minR: -Infinity }
  ];

  function humidityProvince(per) {
    if (!(per > 0) || !isFinite(per)) return null;
    var r = Math.log2(per);
    for (var i = 0; i < HUMIDITY.length; i++) if (r >= HUMIDITY[i].minR) return HUMIDITY[i];
    return HUMIDITY[HUMIDITY.length - 1];
  }

  /* ---------- Franjas térmicas (regiones latitudinales / pisos altitudinales) ---------- */
  // Límites por biotemperatura (°C)
  var BANDS = [
    { id: 'polar',     region: 'Polar',          belt: 'Nival',               suffix: 'N',  btMin: 0,    btMax: 1.5 },
    { id: 'subpolar',  region: 'Subpolar',       belt: 'Alpino (andino)',     suffix: 'A',  btMin: 1.5,  btMax: 3 },
    { id: 'boreal',    region: 'Boreal',         belt: 'Subalpino (subandino)', suffix: 'SA', btMin: 3,  btMax: 6 },
    { id: 'tfria',     region: 'Templada fría',  belt: 'Montano',             suffix: 'M',  btMin: 6,    btMax: 12 },
    { id: 'tcalida',   region: 'Templada cálida', belt: 'Montano bajo',       suffix: 'MB', btMin: 12,   btMax: BT_FROST },
    { id: 'subtrop',   region: 'Subtropical',    belt: 'Premontano',          suffix: 'PM', btMin: BT_FROST, btMax: 24 },
    { id: 'tropical',  region: 'Tropical',       belt: 'Basal',               suffix: 'T',  btMin: 24,   btMax: Infinity }
  ];
  var BAND_BY_ID = {};
  BANDS.forEach(function (b) { BAND_BY_ID[b.id] = b; });

  function thermalBand(bt) {
    for (var i = BANDS.length - 1; i >= 0; i--) if (bt >= BANDS[i].btMin) return BANDS[i];
    return BANDS[0];
  }

  // Adjetivo del piso para el nombre completo de la zona de vida
  var BELT_WORD = { A: 'alpino', SA: 'subalpino', M: 'montano', MB: 'montano bajo', PM: 'premontano', T: 'tropical' };

  var ABBR = {
    'Desierto': 'd', 'Matorral desértico': 'md', 'Monte espinoso': 'me', 'Estepa espinosa': 'ee', 'Estepa': 'e',
    'Bosque muy seco': 'bms', 'Bosque seco': 'bs', 'Bosque húmedo': 'bh', 'Bosque muy húmedo': 'bmh', 'Bosque pluvial': 'bp',
    'Páramo húmedo': 'ph', 'Páramo muy húmedo': 'pmh', 'Páramo pluvial': 'pp',
    'Tundra seca': 'ts', 'Tundra húmeda': 'th', 'Tundra muy húmeda': 'tmh', 'Tundra pluvial': 'tp'
  };

  /* ---------- Tabla de hexágonos del diagrama ---------- */
  // fila k -> lista de [r, nombre] (r = centro de la provincia de humedad, en octavas de ETP/P)
  // La fila 3 está partida por la línea de escarcha: [r, nombre_templada_cálida, nombre_subtropical]
  var TABLE = {
    0: [[0.5, 'Tundra seca'], [-0.5, 'Tundra húmeda'], [-1.5, 'Tundra muy húmeda'], [-2.5, 'Tundra pluvial']],
    1: [[1.5, 'Desierto'], [0.5, 'Matorral desértico'], [-0.5, 'Páramo húmedo'], [-1.5, 'Páramo muy húmedo'],
        [-2.5, 'Páramo pluvial'], [-3.5, 'Páramo pluvial']],
    2: [[3.5, 'Desierto'], [2.5, 'Desierto'], [1.5, 'Matorral desértico'], [0.5, 'Estepa'], [-0.5, 'Bosque húmedo'],
        [-1.5, 'Bosque muy húmedo'], [-2.5, 'Bosque pluvial'], [-3.5, 'Bosque pluvial']],
    3: [[5.5, 'Desierto'], [4.5, 'Desierto'], [3.5, 'Desierto'], [2.5, 'Matorral desértico'],
        [1.5, 'Estepa espinosa', 'Monte espinoso'], [0.5, 'Bosque seco'], [-0.5, 'Bosque húmedo'],
        [-1.5, 'Bosque muy húmedo'], [-2.5, 'Bosque pluvial'], [-3.5, 'Bosque pluvial']],
    4: [[4.5, 'Desierto'], [3.5, 'Matorral desértico'], [2.5, 'Monte espinoso'], [1.5, 'Bosque muy seco'],
        [0.5, 'Bosque seco'], [-0.5, 'Bosque húmedo'], [-1.5, 'Bosque muy húmedo'], [-2.5, 'Bosque pluvial']]
  };

  var HEXES = [];
  Object.keys(TABLE).forEach(function (ks) {
    var k = +ks;
    TABLE[k].forEach(function (e) {
      var r = e[0];
      var U = k - r;                         // centro en U (m + 0.5)
      HEXES.push({
        k: k, r: r, U: U, cx: 2 * U - k, cy: SQRT3 * k,
        names: e.length === 3 ? [e[1], e[2]] : [e[1]]
      });
    });
  });

  function bandFor(k, V) {
    switch (k) {
      case 0: return BAND_BY_ID.subpolar;
      case 1: return BAND_BY_ID.boreal;
      case 2: return BAND_BY_ID.tfria;
      case 3: return V < FROST_V ? BAND_BY_ID.tcalida : BAND_BY_ID.subtrop;
      default: return BAND_BY_ID.tropical;
    }
  }

  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function upperFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function zoneFor(hex, V) {
    var band = bandFor(hex.k, V);
    var lower = hex.k === 3 && band.id === 'subtrop';
    var base = hex.names.length === 2 ? hex.names[lower ? 1 : 0] : hex.names[0];
    var symbol = ABBR[base] + '-' + band.suffix;
    return {
      base: base,
      name: base + ' ' + BELT_WORD[band.suffix],
      symbol: symbol,
      band: band
    };
  }

  /* ---------- Biotemperatura y ETP ---------- */
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

  // Con la media anual: se limita a [0, 30]. Con 12 medias mensuales: promedio de los
  // meses entre 0 y 30 °C (los demás cuentan como 0, según Holdridge).
  function biotemperature(annualT, monthlyT) {
    if (monthlyT && monthlyT.length === 12 && monthlyT.every(function (t) { return typeof t === 'number' && isFinite(t); })) {
      var s = 0;
      monthlyT.forEach(function (t) { s += (t >= 0 && t <= 30) ? t : 0; });
      return s / 12;
    }
    if (typeof annualT !== 'number' || !isFinite(annualT)) return null;
    return clamp(annualT, 0, 30);
  }

  function petFromBT(bt) { return bt * PET_FACTOR; }

  /* ---------- Posición en el diagrama y hexágono ---------- */
  function toDiagram(P, PET) {
    var U = Math.log2(P / P0), V = Math.log2(PET / P0);
    return { U: U, V: V, X: 2 * U - V, Y: SQRT3 * V, r: V - U };
  }

  function inTriangle(pt) {
    return pt.U >= U_MIN - 1e-9 && pt.r >= R_MIN - 1e-9 && pt.V <= V_MAX + 1e-9;
  }

  function nearestHex(pt) {
    var list = HEXES.map(function (h) {
      return { hex: h, d: Math.hypot(pt.X - h.cx, pt.Y - h.cy) };
    }).sort(function (a, b) { return a.d - b.d; });
    // ¿El hexágono teórico de la red cae dentro del diagrama? (si no, se usó el más cercano)
    var best = null;
    for (var k = Math.round(pt.V) - 1; k <= Math.round(pt.V) + 1; k++) {
      var m0 = Math.round((pt.X + k - 1) / 2);
      for (var m = m0 - 1; m <= m0 + 1; m++) {
        var d = Math.hypot(pt.X - (2 * m + 1 - k), pt.Y - SQRT3 * k);
        if (!best || d < best.d) best = { k: k, r: k - (m + 0.5), d: d };
      }
    }
    var exact = HEXES.some(function (h) { return h.k === best.k && Math.abs(h.r - best.r) < 1e-9; });
    var first = list[0], second = list[1];
    // distancia (en unidades del diagrama) hasta el límite con el segundo hexágono
    var D = Math.hypot(first.hex.cx - second.hex.cx, first.hex.cy - second.hex.cy);
    var margin = (second.d * second.d - first.d * first.d) / (2 * D);
    return { hex: first.hex, second: second.hex, margin: margin, exact: exact };
  }

  /* ---------- Clasificación ---------- */
  // datos: { T: media anual °C, monthlyT: [12] opcional, P: mm/año }
  function classify(d) {
    var out = { ok: false, warnings: [], complete: false };
    var bt = biotemperature(d.T, d.monthlyT);
    if (bt === null) {
      out.error = 'Falta la temperatura media anual.';
      return out;
    }
    out.bt = bt;
    out.pet = petFromBT(bt);
    out.band = thermalBand(bt);
    out.region = out.band.region;
    out.belt = out.band.belt;
    if (typeof d.T === 'number' && (d.T < 0 || d.T > 30) && !(d.monthlyT && d.monthlyT.length === 12)) {
      out.warnings.push('La temperatura media anual (' + d.T.toFixed(1) + ' °C) está fuera de 0–30 °C; la biotemperatura se limitó a ese rango.');
    }

    var P = d.P;
    if (typeof P !== 'number' || !isFinite(P) || P <= 0) {
      out.error = 'Falta la precipitación anual.';
      out.partial = true;       // ya se conoce región y piso por BT
      return out;
    }
    out.p = P;

    if (bt < 1.5) {
      out.ok = true; out.complete = true;
      out.per = out.pet / P;
      out.humidity = out.pet > 0 ? humidityProvince(out.per) : null;
      out.zone = { base: 'Nival', name: 'Nival (polar)', symbol: 'N', band: BAND_BY_ID.polar };
      out.hex = null;
      out.inDiagram = false;
      out.point = null;
      out.warnings.push('Biotemperatura menor de 1,5 °C: región polar / piso nival (nieves perpetuas). El diagrama no tiene hexágono aquí.');
      return out;
    }

    out.per = out.pet / P;
    out.humidity = humidityProvince(out.per);
    var pt = toDiagram(P, out.pet);
    out.point = pt;
    var near = nearestHex(pt);
    var zone = zoneFor(near.hex, pt.V);
    out.zone = zone;
    out.region = zone.band.region;
    out.belt = zone.band.belt;
    out.band = zone.band;
    out.hex = near.hex;
    out.margin = near.margin;
    out.inDiagram = inTriangle(pt) && near.exact;
    if (!out.inDiagram) {
      out.warnings.push('Los valores caen fuera del diagrama (clima extremo); se asignó la zona de vida más cercana.');
    }
    // Aviso cuando el piso por biotemperatura difiere del piso del hexágono (celdas que cruzan una línea)
    var byBT = out.band === thermalBand(bt) ? null : thermalBand(bt);
    if (byBT) out.btBand = byBT;
    out.ok = true; out.complete = true;
    return out;
  }

  /* ---------- Sensibilidad: cuánto debe cambiar un dato para cambiar de zona ---------- */
  // Devuelve el menor cambio (en °C de temperatura media, o en % de precipitación)
  // que hace que la zona de vida sea otra. null si no cambia dentro del rango explorado.
  function sensitivity(d) {
    var base = classify(d);
    if (!base.ok || !base.zone) return null;
    function shiftT(s) {
      var q = { P: d.P, T: typeof d.T === 'number' ? d.T + s : d.T };
      if (d.monthlyT && d.monthlyT.length === 12) q.monthlyT = d.monthlyT.map(function (t) { return t + s; });
      return q;
    }
    function differs(q) { var c = classify(q); return c.ok && c.zone && c.zone.symbol !== base.zone.symbol; }
    var out = { tUp: null, tDown: null, pUp: null, pDown: null };
    var i, s;
    for (i = 1; i <= 100; i++) { s = i * 0.1; if (out.tUp === null && differs(shiftT(s))) out.tUp = +s.toFixed(1); if (out.tDown === null && differs(shiftT(-s))) out.tDown = +s.toFixed(1); }
    for (i = 1; i <= 120; i++) {
      var f = Math.pow(1.02, i);
      if (out.pUp === null && differs({ T: d.T, monthlyT: d.monthlyT, P: d.P * f })) out.pUp = Math.round((f - 1) * 100);
      if (out.pDown === null && differs({ T: d.T, monthlyT: d.monthlyT, P: d.P / f })) out.pDown = Math.round((1 - 1 / f) * 100);
    }
    return out;
  }

  /* ---------- Datos para dibujar el diagrama ---------- */
  function fmtNum(x) {
    if (x >= 1000) return String(Math.round(x));
    if (x >= 100) return String(Math.round(x * 10) / 10).replace('.', ',');
    return String(+x.toPrecision(5)).replace('.', ',');
  }

  function diagramData() {
    // vértices: ápice (U=-3, r=-4 -> V=-7), base izquierda (U=-3, V=4), base derecha (r=-4, V=4 -> U=8)
    var apex = { U: U_MIN, V: R_MIN + U_MIN };
    var bl = { U: U_MIN, V: V_MAX };
    var br = { U: V_MAX - R_MIN, V: V_MAX };
    function xy(p) { return { X: 2 * p.U - p.V, Y: SQRT3 * p.V }; }
    var triangle = [xy(apex), xy(bl), xy(br)];

    var pLines = [], perLines = [], btLines = [], i;
    for (i = U_MIN; i <= V_MAX - R_MIN; i++) {         // U de -3 a 8
      pLines.push({ U: i, label: fmtNum(P0 * Math.pow(2, i)), a: xy({ U: i, V: i + R_MIN }), b: xy({ U: i, V: V_MAX }) });
    }
    for (i = R_MIN; i <= 7; i++) {                     // r de -4 a 7
      var vStart = i + U_MIN;                          // en el borde izquierdo
      perLines.push({ r: i, label: fmtNum(Math.pow(2, i)), a: xy({ U: U_MIN, V: vStart }), b: xy({ U: V_MAX - i, V: V_MAX }) });
    }
    [1.5, 3, 6, 12, 24].forEach(function (bt) {
      var V = Math.log2(bt * PET_FACTOR / P0);
      btLines.push({ bt: bt, V: V, pet: bt * PET_FACTOR, a: xy({ U: U_MIN, V: V }), b: xy({ U: V - R_MIN, V: V }) });
    });
    var frost = (function () {
      var V = FROST_V;
      return { V: V, bt: BT_FROST, a: xy({ U: U_MIN, V: V }), b: xy({ U: V - R_MIN, V: V }) };
    })();
    return { triangle: triangle, hexes: HEXES, pLines: pLines, perLines: perLines, btLines: btLines, frost: frost,
             sqrt3: SQRT3, hexR: 2 / SQRT3 };
  }

  // Zona y nombre para un hexágono de la tabla (usado al dibujar etiquetas)
  function hexLabels(hex) {
    if (hex.k === 3) {
      // la fila de 17 °C está partida por la línea de escarcha: mitad superior = montano bajo,
      // mitad inferior = premontano (con el mismo nombre si el hexágono no cambia de nombre)
      var up = hex.names[0], down = hex.names[hex.names.length === 2 ? 1 : 0];
      return [
        { name: up, symbol: ABBR[up] + '-MB', half: 'up' },
        { name: down, symbol: ABBR[down] + '-PM', half: 'down' }
      ];
    }
    var k = hex.k;
    var suffix = k === 0 ? 'A' : k === 1 ? 'SA' : k === 2 ? 'M' : 'T';
    return [{ name: hex.names[0], symbol: ABBR[hex.names[0]] + '-' + suffix, half: 'full' }];
  }

  return {
    PET_FACTOR: PET_FACTOR, P0: P0, BT_FROST: BT_FROST, FROST_V: FROST_V,
    HUMIDITY: HUMIDITY, BANDS: BANDS, HEXES: HEXES, TABLE: TABLE,
    humidityProvince: humidityProvince, thermalBand: thermalBand,
    biotemperature: biotemperature, petFromBT: petFromBT,
    toDiagram: toDiagram, inTriangle: inTriangle, classify: classify, sensitivity: sensitivity,
    diagramData: diagramData, hexLabels: hexLabels, ABBR: ABBR, BELT_WORD: BELT_WORD,
    upperFirst: upperFirst, lowerFirst: lowerFirst
  };
});

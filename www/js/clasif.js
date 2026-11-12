/* clasif.js — otras clasificaciones del clima (2.18.0), además de la zona de vida de Holdridge. Lógica pura, sin pantalla.
 *
 *   caldasLang(T, P)                  → piso térmico de Caldas + humedad de Lang, como los usa el IDEAM
 *   martonne(T, P)                    → índice de aridez de De Martonne
 *   koppen(monthlyT, monthlyP, lat)   → clasificación de Köppen-Geiger (necesita los 12 meses)
 *   all({ T, P, alt, monthlyT, monthlyP, lat }) → las tres juntas;  rows(c) → filas para una tabla
 *
 * Fuentes:
 *   · Caldas-Lang: IDEAM, Nota técnica NT_IDEAM-2025-003 «Actualización de la clasificación climática de Caldas-Lang».
 *     Pisos térmicos por TEMPERATURA media anual (Tabla 1; la altitud es solo de referencia) y factor de Lang P/T en su
 *     versión modificada de 9 clases (Tabla 5). 6 pisos × 9 clases = 54 tipos de clima.
 *   · De Martonne (1926): Ia = P / (T + 10), con las seis zonas de uso común.
 *   · Köppen-Geiger: criterios de Peel, Finlayson y McMahon (2007), «Updated world map of the Köppen-Geiger climate classification».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Clasif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ok12(a) { return Array.isArray(a) && a.length === 12 && a.every(isNum); }
  function d(x, n) { return x.toFixed(n).replace('.', ','); }

  /* ---------- Caldas-Lang (IDEAM) ---------- */
  // Piso térmico: temperatura media anual mayor que tMin (°C). Las altitudes son las de referencia de la tabla del IDEAM.
  var PISOS = [
    { id: 'C',  name: 'Cálido',              tMin: 24,        range: 'más de 24 °C',  alt: '0 a 800 m' },
    { id: 'T',  name: 'Templado',            tMin: 18,        range: '18 a 24 °C',    alt: '800 a 1800 m' },
    { id: 'F',  name: 'Frío',                tMin: 12,        range: '12 a 18 °C',    alt: '1800 a 2800 m' },
    { id: 'Mf', name: 'Muy frío',            tMin: 6,         range: '6 a 12 °C',     alt: '2800 a 3500 m' },
    { id: 'Ef', name: 'Extremadamente frío', tMin: 1.5,       range: '1,5 a 6 °C',    alt: '3500 a 4500 m' },
    { id: 'Nv', name: 'Nival',               tMin: -Infinity, range: 'menos de 1,5 °C', alt: 'más de 4500 m' }
  ];
  // Factor de Lang (P/T), versión modificada del IDEAM: la clase va hasta `max` (sin incluirlo)
  var LANG = [
    { id: 'D',   name: 'desértico',             max: 20 },  { id: 'A',  name: 'árido',       max: 40 },  { id: 'Sa', name: 'semiárido',   max: 60 },
    { id: 'Lh',  name: 'ligeramente húmedo',    max: 80 },  { id: 'Sh', name: 'semihúmedo',  max: 100 }, { id: 'H',  name: 'húmedo',      max: 120 },
    { id: 'Mh',  name: 'muy húmedo',            max: 160 }, { id: 'SHm', name: 'superhúmedo', max: 300 }, { id: 'Eh', name: 'extremadamente húmedo', max: Infinity }
  ];
  function piso(T) {
    if (!isNum(T)) return null;
    // el límite pertenece al piso de abajo en temperatura («18 a 24» es templado; cálido es «más de 24»); el nival es «menos de 1,5»
    for (var i = 0; i < PISOS.length - 1; i++) if (i === PISOS.length - 2 ? T >= PISOS[i].tMin : T > PISOS[i].tMin) return PISOS[i];
    return PISOS[PISOS.length - 1];
  }
  function lang(T, P) {
    if (!isNum(T) || !isNum(P) || P < 0 || T <= 0) return null;       // con 0 °C o menos el cociente no tiene sentido
    var f = P / T;
    for (var i = 0; i < LANG.length; i++) if (f < LANG[i].max) return { factor: f, cls: LANG[i] };
    return null;
  }
  // { piso, lang (o null), factor, name: «Templado semihúmedo», symbol: «TSh» } o null sin temperatura
  function caldasLang(T, P) {
    var p = piso(T);
    if (!p) return null;
    var l = lang(T, P);
    return { piso: p, lang: l ? l.cls : null, factor: l ? l.factor : null, name: p.name + (l ? ' ' + l.cls.name : ''), symbol: p.id + (l ? l.cls.id : '') };
  }

  /* ---------- De Martonne ---------- */
  var MARTONNE = [[5, 'Desierto (hiperárido)'], [10, 'Semidesierto (árido)'], [20, 'Semiárido'], [30, 'Subhúmedo'], [60, 'Húmedo'], [Infinity, 'Perhúmedo']];
  function martonne(T, P) {
    if (!isNum(T) || !isNum(P) || P < 0 || T <= -10) return null;
    var ia = P / (T + 10);
    for (var i = 0; i < MARTONNE.length; i++) if (ia < MARTONNE[i][0]) return { index: ia, name: MARTONNE[i][1] };
    return null;
  }

  /* ---------- Köppen-Geiger ---------- */
  var KOPPEN = {
    Af: 'Tropical de selva (lluvioso todo el año)', Am: 'Tropical monzónico', Aw: 'Tropical de sabana (con estación seca)',
    BWh: 'Desierto cálido', BWk: 'Desierto frío', BSh: 'Estepa cálida (semiárido cálido)', BSk: 'Estepa fría (semiárido frío)',
    Csa: 'Templado con verano seco y caluroso', Csb: 'Templado con verano seco y suave', Csc: 'Templado con verano seco y fresco',
    Cwa: 'Templado con invierno seco y verano caluroso', Cwb: 'Templado con invierno seco y verano suave', Cwc: 'Templado con invierno seco y verano fresco',
    Cfa: 'Templado sin estación seca, verano caluroso', Cfb: 'Templado sin estación seca, verano suave', Cfc: 'Templado sin estación seca, verano fresco',
    ET: 'Tundra (de alta montaña en el trópico)', EF: 'Hielo perpetuo'
  };
  function koppen(mT, mP, lat) {
    if (!ok12(mT) || !ok12(mP) || mP.some(function (p) { return p < 0; })) return null;
    var MAT = 0, MAP = 0, Thot = -Infinity, Tcold = Infinity, Pdry = Infinity, n10 = 0, i;
    for (i = 0; i < 12; i++) { MAT += mT[i] / 12; MAP += mP[i]; Thot = Math.max(Thot, mT[i]); Tcold = Math.min(Tcold, mT[i]); Pdry = Math.min(Pdry, mP[i]); if (mT[i] > 10) n10++; }
    // «verano»: abril a septiembre en el hemisferio norte, octubre a marzo en el sur
    var north = !(isNum(lat) && lat < 0), S = [], W = [];
    for (i = 0; i < 12; i++) ((i >= 3 && i <= 8) === north ? S : W).push(mP[i]);
    var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    var Ps = sum(S), Pw = sum(W), Psdry = Math.min.apply(null, S), Pwdry = Math.min.apply(null, W), Pswet = Math.max.apply(null, S), Pwwet = Math.max.apply(null, W);
    var Pth = MAP > 0 && Pw >= 0.7 * MAP ? 2 * MAT : MAP > 0 && Ps >= 0.7 * MAP ? 2 * MAT + 28 : 2 * MAT + 14;
    var code;
    if (MAP < 10 * Pth) code = 'B' + (MAP < 5 * Pth ? 'W' : 'S') + (MAT >= 18 ? 'h' : 'k');
    else if (Tcold >= 18) code = Pdry >= 60 ? 'Af' : Pdry >= 100 - MAP / 25 ? 'Am' : 'Aw';
    else if (Thot <= 10) code = Thot > 0 ? 'ET' : 'EF';
    else {
      var first = Tcold > 0 ? 'C' : 'D';
      var second = Psdry < 40 && Psdry < Pwwet / 3 ? 's' : Pwdry < Pswet / 10 ? 'w' : 'f';
      var third = Thot >= 22 ? 'a' : n10 >= 4 ? 'b' : first === 'D' && Tcold < -38 ? 'd' : 'c';
      code = first + second + third;
    }
    return { code: code, name: KOPPEN[code] || (code.charAt(0) === 'D' ? 'Continental frío' : code), MAT: MAT, MAP: MAP, Thot: Thot, Tcold: Tcold, Pdry: Pdry };
  }

  /* ---------- Todas juntas ---------- */
  // v: { T, P, alt, monthlyT, monthlyP, lat }. Devuelve { caldas, martonne, koppen } (cada una puede ser null si faltan datos).
  function all(v) {
    v = v || {};
    return { caldas: caldasLang(v.T, v.P), martonne: martonne(v.T, v.P), koppen: koppen(v.monthlyT, v.monthlyP, v.lat), alt: isNum(v.alt) ? v.alt : null };
  }
  // Filas para una tabla: [nombre del método, resultado, explicación corta]. Solo los métodos que se pudieron calcular;
  // del de Köppen, si faltan los datos mensuales, una fila que lo dice.
  function rows(c) {
    var out = [];
    if (!c) return out;
    if (c.caldas) {
      var k = c.caldas;
      out.push(['Caldas-Lang (IDEAM)', k.name + ' (' + k.symbol + ')',
        'Piso térmico ' + k.piso.name.toLowerCase() + ': temperatura media de ' + k.piso.range + ' (altitud de referencia: ' + k.piso.alt + ').' +
        (k.lang ? ' Factor de Lang (lluvia ÷ temperatura) = ' + d(k.factor, 0) + ': ' + k.lang.name + '.' : ' Falta la lluvia anual para la humedad (factor de Lang).')]);
    }
    if (c.martonne) out.push(['Índice de aridez de De Martonne', d(c.martonne.index, 1) + ' · ' + c.martonne.name, 'Lluvia anual ÷ (temperatura + 10). Menos de 20 indica falta de agua buena parte del año.']);
    if (c.koppen) {
      out.push(['Köppen-Geiger', c.koppen.code + ' · ' + c.koppen.name,
        'Mes más frío ' + d(c.koppen.Tcold, 1) + ' °C, mes más caliente ' + d(c.koppen.Thot, 1) + ' °C, mes más seco ' + d(c.koppen.Pdry, 0) + ' mm.' +
        (c.koppen.code.charAt(0) === 'C' && c.caldas && c.caldas.piso.id !== 'C' ? ' En la montaña tropical Köppen llama «templado» a climas frescos sin estaciones de temperatura.' : '')]);
    } else if (c.caldas) out.push(['Köppen-Geiger', 'Sin calcular', 'Necesita la temperatura y la lluvia de los 12 meses: complétalas con internet o escríbelas en Información.']);
    return out;
  }
  var NOTE = 'Holdridge separa los pisos por biotemperatura y Caldas por temperatura media, con límites distintos (17 y 24 °C frente a 18 y 24 °C): cerca de un límite pueden dar pisos diferentes sin que sea un error.';

  return { caldasLang: caldasLang, piso: piso, lang: lang, martonne: martonne, koppen: koppen, all: all, rows: rows, PISOS: PISOS, LANG: LANG, MARTONNE: MARTONNE, KOPPEN: KOPPEN, NOTE: NOTE };
});

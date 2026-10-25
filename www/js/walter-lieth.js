/* walter-lieth.js — diagrama ombrotérmico de Walter-Lieth (temperatura y lluvia mensuales).
 *
 * Regla del diagrama: la escala de lluvia es el doble que la de temperatura (1 °C ↔ 2 mm, es decir P = 2T).
 *   · mes SECO:    la curva de lluvia queda por debajo de la de temperatura (P < 2T)  → puntos naranja
 *   · mes HÚMEDO:  la lluvia queda por encima (P > 2T)                                → rayas azules
 *   · P > 100 mm:  la escala se comprime 10 veces (1 °C ↔ 20 mm) y se rellena sólido  → azul oscuro
 * No tiene dependencias: sirve en el navegador (window.WalterLieth) y en Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WalterLieth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var COL = { T: '#C42D34', P: '#1F3FBF', dry: '#E39B2B', humid: '#1F3FBF', ink: '#14301F', soft: '#5B6F61', grid: '#D6DED8', bg: '#FFFFFF' };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ok12(a) { return Array.isArray(a) && a.length === 12 && a.every(isNum); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function f0(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function r2(v) { return Math.round(v * 100) / 100; }

  // Posición vertical de una lluvia P (mm) en "unidades de temperatura": P/2 hasta 100 mm y, por encima, 1 unidad cada 20 mm
  function yOfP(P) { return P <= 100 ? P / 2 : 50 + (P - 100) / 20; }

  function compute(T, P) {
    if (!ok12(T) || !ok12(P)) return { ok: false, reason: 'Se necesitan 12 valores de temperatura y 12 de precipitación (uno por mes).' };
    if (P.some(function (v) { return v < 0; })) return { ok: false, reason: 'La precipitación mensual no puede ser negativa.' };
    var months = [], dry = [], deficit = 0, sumT = 0, sumP = 0;
    for (var i = 0; i < 12; i++) {
      var t2 = 2 * T[i], isDry = P[i] < t2;
      months.push({ i: i, name: NAMES[i], short: SHORT[i], T: T[i], P: P[i], t2: t2, dry: isDry, superhumid: P[i] > 100 });
      if (isDry) { dry.push(i); deficit += t2 - P[i]; }
      sumT += T[i]; sumP += P[i];
    }
    // Períodos secos seguidos (el año es circular: diciembre sigue a enero)
    var runs = [];
    if (dry.length === 12) runs.push({ start: 0, end: 11, length: 12 });
    else if (dry.length) {
      var s0 = 0;
      while (months[s0].dry) s0++;                       // primer mes no seco
      var cur = null;
      for (var k = 1; k <= 12; k++) {
        var idx = (s0 + k) % 12;
        if (months[idx].dry) { if (!cur) cur = { start: idx, end: idx, length: 1 }; else { cur.end = idx; cur.length++; } }
        else if (cur) { runs.push(cur); cur = null; }
      }
      if (cur) runs.push(cur);
    }
    var longest = runs.reduce(function (a, r) { return !a || r.length > a.length ? r : a; }, null);
    return {
      ok: true, months: months, tMean: sumT / 12, pSum: sumP,
      tMin: Math.min.apply(null, T), tMax: Math.max.apply(null, T), pMax: Math.max.apply(null, P),
      dryMonths: dry, runs: runs, longestRun: longest, deficit: deficit,
      allDry: dry.length === 12, noDry: dry.length === 0, superhumidMonths: months.filter(function (m) { return m.superhumid; }).map(function (m) { return m.i; })
    };
  }

  // Zonas de relleno en coordenadas del diagrama: x = mes (0 = enero … 11 = diciembre), y = unidades de temperatura.
  // Entre dos meses las curvas son rectas; se corta en los cruces (P = 100 mm y T = P/2) para que los límites sean exactos.
  function regions(d) {
    var T = d.months.map(function (m) { return m.T; }), P = d.months.map(function (m) { return m.P; });
    var out = [];
    for (var i = 0; i < 11; i++) {
      var p0 = P[i], p1 = P[i + 1], t0 = T[i], t1 = T[i + 1];
      var cuts = [0, 1];
      if ((p0 - 100) * (p1 - 100) < 0) cuts.push((100 - p0) / (p1 - p0));
      cuts.sort(function (a, b) { return a - b; });
      var ts = [cuts[0]];
      for (var c = 1; c < cuts.length; c++) {
        var a = cuts[c - 1], b = cuts[c];
        var fa = lerp(t0, t1, a) - yOfP(lerp(p0, p1, a)), fb = lerp(t0, t1, b) - yOfP(lerp(p0, p1, b));
        if (fa * fb < 0) ts.push(a + (b - a) * fa / (fa - fb));
        ts.push(b);
      }
      for (var j = 1; j < ts.length; j++) {
        var ta = ts[j - 1], tb = ts[j];
        if (tb - ta < 1e-12) continue;
        var tm = (ta + tb) / 2;
        function at(t) { return { x: i + t, T: lerp(t0, t1, t), y: yOfP(lerp(p0, p1, t)) }; }
        var A = at(ta), B = at(tb), M = at(tm);
        function poly(kind, loA, loB, hiA, hiB) {
          out.push({ kind: kind, pts: [{ x: A.x, y: loA }, { x: B.x, y: loB }, { x: B.x, y: hiB }, { x: A.x, y: hiA }] });
        }
        if (M.y <= 50 + 1e-9) {
          if (M.T > M.y) poly('dry', A.y, B.y, A.T, B.T);
          else poly('humid', A.T, B.T, A.y, B.y);
        } else {
          poly('humid', A.T, B.T, 50, 50);
          poly('super', 50, 50, A.y, B.y);
        }
      }
    }
    return out;
  }

  function summary(d) {
    if (!d || !d.ok) return [];
    var L = [];
    L.push('Temperatura media ' + f1(d.tMean) + ' °C · precipitación anual ' + f0(d.pSum) + ' mm.');
    if (d.allDry) L.push('Todos los meses son secos (la lluvia queda por debajo de 2T todo el año).');
    else if (d.noDry) L.push('Ningún mes es seco: la lluvia supera 2T durante todo el año.');
    else {
      d.runs.forEach(function (r) {
        L.push('Período seco: ' + (r.length === 1 ? NAMES[r.start] : NAMES[r.start] + ' a ' + NAMES[r.end]) + ' (' + r.length + (r.length === 1 ? ' mes' : ' meses') + ').');
      });
      L.push('Déficit acumulado en los meses secos: ' + f0(d.deficit) + ' mm (suma de 2T − P).');
    }
    if (d.superhumidMonths.length) L.push('Meses con más de 100 mm: ' + d.superhumidMonths.length + '.');
    if (d.tMin < 0) L.push('Hay meses con temperatura media bajo 0 °C.');
    return L;
  }

  /* ---------- Dibujo ---------- */
  // o: { title, subtitle, id, width, height }
  function svg(d, o) {
    o = o || {};
    if (!d || !d.ok) return '';
    var id = o.id || 'wl';
    var W = 560, H = 440, Lm = 52, Rm = 58, Tm = 62, Bm = 74;
    var pw = W - Lm - Rm, ph = H - Tm - Bm;
    var tLo = Math.min(0, Math.floor(d.tMin / 10) * 10);
    var yMaxP = yOfP(d.pMax);
    var yTop = Math.max(Math.ceil(Math.max(d.tMax, Math.min(d.pMax, 100) / 2) / 10) * 10, d.pMax > 100 ? Math.ceil(yMaxP / 5) * 5 : 0, 20);
    function X(x) { return Lm + pw * (x + 0.5) / 12; }
    function Y(y) { return Tm + ph * (1 - (y - tLo) / (yTop - tLo)); }
    function pt(x, y) { return r2(X(x)) + ',' + r2(Y(y)); }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + (o.width || '100%') + '" role="img" aria-label="' +
      esc('Diagrama de Walter-Lieth. ' + summary(d).join(' ')) + '" font-family="system-ui, -apple-system, Roboto, sans-serif">';
    s += '<defs>' +
      '<pattern id="' + id + '-dry" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="' + COL.dry + '"/><circle cx="4.5" cy="4.5" r="1.1" fill="' + COL.dry + '"/></pattern>' +
      '<pattern id="' + id + '-hum" width="5" height="8" patternUnits="userSpaceOnUse"><line x1="2.5" y1="0" x2="2.5" y2="8" stroke="' + COL.humid + '" stroke-width="1.2"/></pattern></defs>';
    s += '<rect width="' + W + '" height="' + H + '" rx="10" fill="' + COL.bg + '"/>';
    if (o.title) s += '<text x="' + Lm + '" y="24" font-size="16" font-weight="700" fill="' + COL.ink + '">' + esc(o.title) + '</text>';
    if (o.subtitle) s += '<text x="' + Lm + '" y="42" font-size="12.5" fill="' + COL.soft + '">' + esc(o.subtitle) + '</text>';

    // Rejilla y escalas (izquierda °C, derecha mm)
    var yMaxTick = Math.min(yTop, 50);
    for (var yy = tLo; yy <= yMaxTick + 1e-9; yy += 10) {
      s += '<line x1="' + Lm + '" y1="' + r2(Y(yy)) + '" x2="' + (W - Rm) + '" y2="' + r2(Y(yy)) + '" stroke="' + (yy === 0 ? COL.soft : COL.grid) + '" stroke-width="' + (yy === 0 ? 1.4 : 1) + '"/>';
      s += '<text x="' + (Lm - 7) + '" y="' + r2(Y(yy) + 4) + '" font-size="11.5" text-anchor="end" fill="' + COL.T + '">' + yy + '</text>';
      if (yy >= 0) s += '<text x="' + (W - Rm + 7) + '" y="' + r2(Y(yy) + 4) + '" font-size="11.5" fill="' + COL.P + '">' + (yy * 2) + '</text>';
    }
    if (d.pMax > 100) {
      s += '<line x1="' + Lm + '" y1="' + r2(Y(50)) + '" x2="' + (W - Rm) + '" y2="' + r2(Y(50)) + '" stroke="' + COL.P + '" stroke-width="1" stroke-dasharray="5 4"/>';
      for (var mm = 200; yOfP(mm) <= yTop + 1e-9; mm += 100) {
        s += '<line x1="' + (W - Rm) + '" y1="' + r2(Y(yOfP(mm))) + '" x2="' + (W - Rm + 4) + '" y2="' + r2(Y(yOfP(mm))) + '" stroke="' + COL.P + '"/>';
        s += '<text x="' + (W - Rm + 7) + '" y="' + r2(Y(yOfP(mm)) + 4) + '" font-size="11.5" fill="' + COL.P + '">' + mm + '</text>';
      }
      s += '<text x="' + (W - Rm - 4) + '" y="' + r2(Y(yTop) + 12) + '" font-size="10.5" text-anchor="end" fill="' + COL.P + '">sobre 100 mm: escala ÷10</text>';
    }
    s += '<text x="' + (Lm - 7) + '" y="' + (Tm - 12) + '" font-size="12" font-weight="700" text-anchor="end" fill="' + COL.T + '">°C</text>';
    s += '<text x="' + (W - Rm + 7) + '" y="' + (Tm - 12) + '" font-size="12" font-weight="700" fill="' + COL.P + '">mm</text>';

    // Rellenos
    regions(d).forEach(function (r) {
      var fill = r.kind === 'dry' ? 'url(#' + id + '-dry)' : r.kind === 'humid' ? 'url(#' + id + '-hum)' : COL.humid;
      s += '<polygon points="' + r.pts.map(function (p) { return pt(p.x, p.y); }).join(' ') + '" fill="' + fill + '"' + (r.kind === 'super' ? ' fill-opacity="0.75"' : '') + '/>';
    });

    // Curvas (la de lluvia lleva un vértice extra donde cruza 100 mm)
    var tl = [], pl = [];
    for (var i = 0; i < 12; i++) {
      tl.push(pt(i, d.months[i].T));
      pl.push(pt(i, yOfP(d.months[i].P)));
      if (i < 11) {
        var p0 = d.months[i].P, p1 = d.months[i + 1].P;
        if ((p0 - 100) * (p1 - 100) < 0) pl.push(pt(i + (100 - p0) / (p1 - p0), 50));
      }
    }
    s += '<polyline points="' + pl.join(' ') + '" fill="none" stroke="' + COL.P + '" stroke-width="2.4" stroke-linejoin="round"/>';
    s += '<polyline points="' + tl.join(' ') + '" fill="none" stroke="' + COL.T + '" stroke-width="2.4" stroke-linejoin="round"/>';
    for (var q = 0; q < 12; q++) {
      s += '<circle cx="' + r2(X(q)) + '" cy="' + r2(Y(yOfP(d.months[q].P))) + '" r="3" fill="' + COL.P + '"/>';
      s += '<circle cx="' + r2(X(q)) + '" cy="' + r2(Y(d.months[q].T)) + '" r="3" fill="' + COL.T + '"/>';
    }

    // Marco y meses
    s += '<rect x="' + Lm + '" y="' + Tm + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="' + COL.soft + '" stroke-width="1.2"/>';
    for (var m = 0; m < 12; m++) {
      s += '<text x="' + r2(X(m)) + '" y="' + r2(Y(tLo) + 17) + '" font-size="11.5" text-anchor="middle" fill="' + COL.ink + '">' + SHORT[m] + '</text>';
    }

    // Leyenda
    var ly = H - 30, lx = Lm;
    s += '<rect x="' + lx + '" y="' + (ly - 9) + '" width="16" height="11" fill="url(#' + id + '-dry)" stroke="' + COL.dry + '"/><text x="' + (lx + 22) + '" y="' + ly + '" font-size="11.5" fill="' + COL.ink + '">Período seco (P &lt; 2T)</text>';
    lx += 150;
    s += '<rect x="' + lx + '" y="' + (ly - 9) + '" width="16" height="11" fill="url(#' + id + '-hum)" stroke="' + COL.humid + '"/><text x="' + (lx + 22) + '" y="' + ly + '" font-size="11.5" fill="' + COL.ink + '">Período húmedo (P &gt; 2T)</text>';
    lx += 172;
    if (d.superhumidMonths.length) s += '<rect x="' + lx + '" y="' + (ly - 9) + '" width="16" height="11" fill="' + COL.humid + '" fill-opacity="0.75"/><text x="' + (lx + 22) + '" y="' + ly + '" font-size="11.5" fill="' + COL.ink + '">P &gt; 100 mm</text>';
    s += '<g transform="translate(' + Lm + ' ' + (H - 12) + ')"><line x1="0" y1="-4" x2="16" y2="-4" stroke="' + COL.T + '" stroke-width="2.4"/><text x="22" y="0" font-size="11.5" fill="' + COL.ink + '">Temperatura media mensual</text>' +
      '<line x1="190" y1="-4" x2="206" y2="-4" stroke="' + COL.P + '" stroke-width="2.4"/><text x="212" y="0" font-size="11.5" fill="' + COL.ink + '">Precipitación mensual</text></g>';
    return s + '</svg>';
  }

  return { compute: compute, regions: regions, svg: svg, summary: summary, yOfP: yOfP, NAMES: NAMES, SHORT: SHORT };
});

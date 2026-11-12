/* analysis.js — une geometría, altitud, clima y clasificación para un proyecto.
 *
 * proyecto = { points: [{lat, lon, alt, altSrc}], climate: {tManual, pManual, altOverride, online} }
 * La altitud del punto de análisis sale, en este orden, de:
 *   1. altOverride (corrección manual del análisis)
 *   2. promedio de la altitud de los puntos (GPS, escrita a mano o de internet)
 *   3. elevación obtenida de internet para el centro */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./holdridge.js'), require('./climate.js'));
  else root.Analysis = factory(root.Geo, root.Holdridge, root.Climate);
})(typeof self !== 'undefined' ? self : this, function (Geo, H, Climate) {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validPoint(p) { return p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }

  // Margen de error supuesto según el origen del dato (no es una medición: es un criterio)
  var T_MARGIN = { manual: 0.5, online: 1.5, onlineSinCorregir: 3, memoria: 1.5 };
  var P_MARGIN = { manual: 0.10, online: 0.30, memoria: 0.35 };

  var SRC_LABEL = { gps: 'GPS', manual: 'escrita a mano', internet: 'internet' };

  function altitudeOf(points, climate) {
    var withAlt = points.filter(function (p) { return isNum(p.alt); });
    var res = { value: null, src: null, srcLabel: null, n: 0, min: null, max: null, fromPoints: 0 };
    if (climate && isNum(climate.altOverride)) {
      res.value = climate.altOverride; res.src = 'manual'; res.srcLabel = 'corregida a mano para el análisis';
    } else if (withAlt.length) {
      var s = 0;
      withAlt.forEach(function (p) { s += p.alt; });
      res.value = s / withAlt.length;
      var srcs = {};
      withAlt.forEach(function (p) { srcs[p.altSrc || 'manual'] = true; });
      var keys = Object.keys(srcs);
      res.src = keys.length === 1 ? keys[0] : 'mixta';
      res.srcLabel = keys.length === 1 ? SRC_LABEL[keys[0]] || keys[0] : 'varias fuentes';
    } else if (climate && climate.online && isNum(climate.online.elevation)) {
      res.value = climate.online.elevation; res.src = 'internet'; res.srcLabel = 'internet';
    }
    res.n = withAlt.length;
    if (withAlt.length) {
      res.min = Math.min.apply(null, withAlt.map(function (p) { return p.alt; }));
      res.max = Math.max.apply(null, withAlt.map(function (p) { return p.alt; }));
    }
    return res;
  }

  function marginsFor(resolved) {
    var tm = null, pm = null;
    if (resolved.TSrc === 'manual') tm = T_MARGIN.manual;
    else if (resolved.TSrc === 'online') tm = resolved.notes.some(function (n) { return /SIN corregir/.test(n); }) ? T_MARGIN.onlineSinCorregir : T_MARGIN.online;
    else if (resolved.TSrc === 'memoria') tm = T_MARGIN.memoria;
    else if (resolved.TSrc === 'estimada') tm = null;   // se completa con la latitud
    if (resolved.PSrc) pm = P_MARGIN[resolved.PSrc] || P_MARGIN.online;
    return { t: tm, p: pm };
  }

  // Zonas de vida posibles al mover T y P dentro de su margen (la principal queda fuera)
  function neighbours(T, monthlyT, P, tMargin, pMargin, mainSymbol) {
    var seen = {}, list = [];
    var steps = 6;
    for (var i = 0; i <= steps; i++) {
      var dT = -tMargin + (2 * tMargin) * i / steps;
      var pFactors = [1 / (1 + pMargin), 1, 1 + pMargin];
      for (var j = 0; j < pFactors.length; j++) {
        var c = H.classify({
          T: T + dT,
          monthlyT: monthlyT ? monthlyT.map(function (t) { return t + dT; }) : null,
          P: P * pFactors[j]
        });
        if (!c.ok || !c.zone) continue;
        var sym = c.zone.symbol;
        if (sym === mainSymbol) continue;
        if (!seen[sym]) { seen[sym] = { symbol: sym, name: c.zone.name, hits: 0 }; list.push(seen[sym]); }
        seen[sym].hits++;
      }
    }
    list.sort(function (a, b) { return b.hits - a.hits; });
    return list;
  }

  var RANK = { manual: 3, online: 2, memoria: 2, estimada: 1 };

  function analyze(project, ctx) {
    ctx = ctx || {};
    var climate = project.climate || {};
    var points = (project.points || []).filter(validPoint);
    var out = { n: points.length, empty: points.length === 0, warnings: [] };
    if (out.empty) return out;

    out.polygon = points.length >= 3;
    out.center = Geo.centroid(points);

    // Geometría
    if (out.polygon) {
      out.selfIntersects = Geo.selfIntersects(points);
      if (out.selfIntersects) out.warnings.push('Los lados del polígono se cruzan: el orden de los puntos no sigue el contorno. El área puede estar mal.');
      out.areaM2 = Geo.polygonArea(points);
      out.area = Geo.areaUnits(out.areaM2);
    }
    out.perimeter = points.length >= 2 ? Geo.perimeter(points, out.polygon) : 0;

    // Altitud
    out.alt = altitudeOf(points, climate);
    out.info = [];            // notas que explican, sin ser avisos (2.17.1)

    // Clima
    var online = climate.online || null;
    var resolved = Climate.resolve({
      lat: out.center.lat, lon: out.center.lon, alt: out.alt.value,
      tManual: isNum(climate.tManual) ? climate.tManual : null,
      pManual: isNum(climate.pManual) ? climate.pManual : null,
      monthlyManual: climate.monthlyManual || null,
      online: online
    }, { memory: ctx.memory, radiusKm: ctx.radiusKm });
    out.climate = resolved;

    if (resolved.T === null) {
      out.result = null;
      out.needs = 'altitud';
      return out;
    }

    var res = H.classify({ T: resolved.T, monthlyT: resolved.monthlyT, P: resolved.P });
    out.result = res;
    res.warnings.forEach(function (w) { out.warnings.push(w); });
    if (resolved.P === null) { out.needs = 'precipitacion'; }
    altSpan(out, resolved);

    // Calidad de los datos: manda el eslabón más débil
    var rT = RANK[resolved.TSrc] || 1;
    var rP = resolved.PSrc ? (RANK[resolved.PSrc] || 1) : 0;
    out.quality = resolved.P === null ? 0 : Math.min(rT, rP);

    // Zonas vecinas posibles
    if (res.ok && res.zone && resolved.P !== null) {
      var m = marginsFor(resolved);
      var tM = m.t !== null ? m.t : Climate.estimateUncertainty(out.center.lat);
      var pM = m.p !== null ? m.p : 0.3;
      out.margins = { t: tM, p: pM };
      out.alternatives = res.zone.symbol === 'N' ? [] :
        neighbours(resolved.T, resolved.monthlyT, resolved.P, tM, pM, res.zone.symbol);
    }

    // Zonas por vértice (misma lluvia, temperatura ajustada con el gradiente)
    out.vertexZones = [];
    if (res.ok && resolved.P !== null && out.alt.value !== null && out.alt.n >= 2 && out.alt.max - out.alt.min >= 100) {
      var seen = {};
      points.forEach(function (p, i) {
        if (!isNum(p.alt)) return;
        var shift = Climate.LAPSE * (out.alt.value - p.alt);
        var c = H.classify({
          T: resolved.T + shift,
          monthlyT: resolved.monthlyT ? resolved.monthlyT.map(function (t) { return t + shift; }) : null,
          P: resolved.P
        });
        if (!c.ok || !c.zone) return;
        out.vertexZones.push({ index: i, name: p.name || ('P' + (i + 1)), alt: p.alt, symbol: c.zone.symbol, zone: c.zone.name, T: resolved.T + shift, point: c.point });
        seen[c.zone.symbol] = c.zone.name;
      });
      out.distinctZones = Object.keys(seen).map(function (s) { return { symbol: s, name: seen[s] }; });
      if (out.distinctZones.length > 1) {
        out.warnings.push('Según la altitud de cada punto, el terreno toca ' + out.distinctZones.length + ' zonas de vida (con la misma precipitación).');
      }
    }
    return out;
  }

  /* ---------- ¿El terreno cambia de piso altitudinal? (2.17.1) ----------
   * Antes se avisaba «varios pisos térmicos» con solo pasar de 150 m de diferencia, sin mirar la temperatura. Ahora se calcula:
   * en el sistema de Holdridge los pisos altitudinales los separa la BIOTEMPERATURA (1,5 · 3 · 6 · 12 · ≈17 y 24 °C), no la altitud.
   * Se lleva la temperatura del centro al punto más bajo y al más alto con el gradiente de la app (Climate.LAPSE, 0,53 °C por cada
   * 100 m) y se mira en qué piso cae cada extremo. Solo si son distintos se avisa, y se dice a qué altitud queda el límite.
   * Con menos de 100 m de diferencia no se dice nada. Deja el cálculo en out.altSpan.
   */
  var SPAN_MIN = 100;
  function d1(x) { return x.toFixed(1).replace('.', ','); }
  function listY(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]; }
  function bandRange(b) { return b.btMax === Infinity ? 'más de ' + d1(b.btMin).replace(',0', '') + ' °C' : d1(b.btMin).replace(',0', '') + ' a ' + d1(b.btMax).replace(',0', '') + ' °C'; }
  function altSpan(out, resolved) {
    var al = out.alt;
    if (!al || al.min === null || al.max === null || al.value === null || !isNum(resolved.T)) return;
    var diff = al.max - al.min;
    if (diff < SPAN_MIN) return;
    function at(alt) {
      var shift = Climate.LAPSE * (al.value - alt);
      var bt = H.biotemperature(resolved.T + shift, resolved.monthlyT ? resolved.monthlyT.map(function (t) { return t + shift; }) : null);
      return { bt: bt, band: H.thermalBand(bt) };
    }
    var lo = at(al.min), hi = at(al.max);            // abajo hace más calor que arriba
    if (!lo.band || !hi.band) return;
    var head = 'Los puntos van de ' + Math.round(al.min) + ' a ' + Math.round(al.max) + ' m (' + Math.round(diff) + ' m de diferencia). Con un gradiente de ' +
      (Climate.LAPSE * 100).toFixed(2).replace('.', ',') + ' °C por cada 100 m, la biotemperatura va de ' + d1(hi.bt) + ' °C arriba a ' + d1(lo.bt) + ' °C abajo';
    var span = { min: al.min, max: al.max, diff: diff, btLow: lo.bt, btHigh: hi.bt, belts: [lo.band.belt], limits: [], same: lo.band === hi.band };
    if (span.same) {
      out.info.push(head + ': todo el terreno queda en el piso ' + lo.band.belt + ' de Holdridge (' + bandRange(lo.band) + '), así que el resultado del centro lo representa.');
    } else {
      // los pisos que hay entre el extremo de abajo y el de arriba, y a qué altitud cae cada límite
      var i0 = H.BANDS.indexOf(hi.band), i1 = H.BANDS.indexOf(lo.band), belts = [], limits = [];
      for (var i = i1; i >= i0; i--) {
        belts.push(H.BANDS[i].belt);
        if (i > i0) limits.push({ bt: H.BANDS[i].btMin, alt: al.min + (lo.bt - H.BANDS[i].btMin) / Climate.LAPSE });
      }
      span.belts = belts; span.limits = limits;
      out.warnings.push(head + ' y cruza ' + (limits.length === 1 ? 'el límite' : 'los límites') + ' de ' +
        listY(limits.map(function (l) { return d1(l.bt).replace(',0', '') + ' °C (cerca de los ' + Math.round(l.alt / 10) * 10 + ' m)'; })) +
        ': el terreno toca ' + belts.length + ' pisos altitudinales de Holdridge (de abajo hacia arriba: ' + listY(belts) + '). El resultado del centro es solo una referencia.');
    }
    out.altSpan = span;
  }

  return { altSpan: altSpan, SPAN_MIN: SPAN_MIN, analyze: analyze, altitudeOf: altitudeOf, T_MARGIN: T_MARGIN, P_MARGIN: P_MARGIN };
});

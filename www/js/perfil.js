/* perfil.js — perfil del relieve: la altitud de los puntos contra la distancia acumulada entre ellos.
 * Usa solo las altitudes que ya están guardadas (no consulta internet) y dice de dónde viene cada una.
 * build() hace las cuentas y svg() dibuja; sirve en el navegador (window.Perfil) y en Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./fmt.js'));
  else root.Perfil = factory(root.Geo, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (Geo, Fmt) {
  'use strict';

  var COL = { ink: '#14301F', soft: '#5B6F61', grid: '#D6DED8', halo: '#FFFFFF' };
  var SRC_LABEL = { gps: 'GPS', manual: 'a mano', internet: 'internet', archivo: 'archivo' };
  var STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  var GPS_QUIET_RELIEF = 20;      // por debajo de este desnivel (m) un perfil hecho con GPS puede ser solo ruido

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function srcLabel(src) { return Object.prototype.hasOwnProperty.call(SRC_LABEL, src) ? SRC_LABEL[src] : 'a mano'; }

  // Cuentas del perfil. Los puntos se recorren en el orden de la lista (sin volver al primero).
  // Devuelve { ok:false, reason } o { ok:true, items, total, ... }.
  function build(points) {
    var pts = (points || []).filter(validLL);
    var items = [], missing = 0, dist = 0, prev = null;
    pts.forEach(function (p, i) {
      if (prev) dist += Geo.distance(prev.lat, prev.lon, p.lat, p.lon);
      prev = p;
      if (!isNum(p.alt)) { missing++; return; }
      var src = p.altSrc || 'manual';
      items.push({ name: p.name || ('P' + (i + 1)), alt: p.alt, src: src, srcLabel: srcLabel(src), dist: dist });
    });
    if (items.length < 2) return { ok: false, reason: 'Se necesitan al menos 2 puntos con altitud para dibujar el perfil.', missing: missing };
    var first = items[0].dist;
    items.forEach(function (it) { it.dist -= first; });          // el perfil empieza en el primer punto que tiene altitud
    var total = items[items.length - 1].dist;
    if (!(total > 0)) return { ok: false, reason: 'Los puntos con altitud están en el mismo lugar: no hay recorrido que dibujar.', missing: missing };

    var hi = items[0], lo = items[0], up = 0, down = 0, steep = null, srcCounts = {};
    items.forEach(function (it, i) {
      if (it.alt > hi.alt) hi = it;
      if (it.alt < lo.alt) lo = it;
      srcCounts[it.src] = (srcCounts[it.src] || 0) + 1;
      if (i) {
        var q = items[i - 1], d = it.alt - q.alt, run = it.dist - q.dist;
        if (d > 0) up += d; else down -= d;
        if (run > 0) {
          var pct = Math.abs(d) / run * 100;
          if (!steep || pct > steep.pct) steep = { pct: pct, from: q.name, to: it.name };
        }
      }
    });
    var relief = hi.alt - lo.alt;
    var m = { ok: true, items: items, total: total, missing: missing, high: hi, low: lo, relief: relief, ascent: up, descent: down, steepest: steep, srcCounts: srcCounts, notes: [] };

    var gps = srcCounts.gps || 0, kinds = Object.keys(srcCounts).length;
    if (gps) m.notes.push(gps + (gps === 1 ? ' altitud fue tomada' : ' altitudes fueron tomadas') + ' con el GPS del teléfono, que suele tener un error de varios metros (a veces decenas).');
    if (gps && relief < GPS_QUIET_RELIEF) m.notes.push('La diferencia entre el punto más alto y el más bajo (' + Fmt.num(relief, 0) + ' m) es del orden de ese error: el perfil podría mostrar ruido del GPS y no el relieve real.');
    if (kinds > 1) m.notes.push('Las altitudes vienen de varias fuentes (' + Object.keys(srcCounts).map(srcLabel).join(', ') + '): pueden no ser comparables entre sí.');
    if (missing) m.notes.push(missing + (missing === 1 ? ' punto sin altitud no aparece' : ' puntos sin altitud no aparecen') + ' en el perfil.');
    return m;
  }

  // Datos para una tabla: [etiqueta, valor]
  function rows(m) {
    if (!m || !m.ok) return [];
    // build() solo da ok si el recorrido mide más de 0 m, así que siempre hay un tramo más inclinado
    return [
      ['Punto más alto', m.high.name + ' · ' + Fmt.num(m.high.alt, 0) + ' m'],
      ['Punto más bajo', m.low.name + ' · ' + Fmt.num(m.low.alt, 0) + ' m'],
      ['Desnivel entre ambos', Fmt.num(m.relief, 0) + ' m'],
      ['Ascenso acumulado', Fmt.num(m.ascent, 0) + ' m'],
      ['Descenso acumulado', Fmt.num(m.descent, 0) + ' m'],
      ['Longitud del recorrido', Fmt.dist(m.total)],
      ['Tramo más inclinado', m.steepest.from + ' → ' + m.steepest.to + ' · ' + Fmt.num(m.steepest.pct, 0) + ' %']
    ];
  }

  function niceStep(range) {
    var best = STEPS[STEPS.length - 1];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= range) { best = STEPS[i]; break; }
    return best;
  }

  // Dibujo del perfil. o: { width, height, color, id }
  function svg(m, o) {
    o = o || {};
    var W = o.width || 640, H = o.height || 340, id = esc(o.id || 'pf');
    var color = /^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : '#2F8F4E';
    if (!m || !m.ok) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Perfil del relieve sin datos"></svg>';
    var L = 58, R = 30, T = 36, B = 58;
    var pw = W - L - R, ph = H - T - B;

    // Eje vertical: de un múltiplo redondo por debajo del mínimo a uno por encima del máximo, con un margen
    var lo = m.low.alt, hi = m.high.alt, span = hi - lo;
    var pad = Math.max(span * 0.12, 3);
    var step = niceStep((span + 2 * pad) / 4);
    var y0 = Math.floor((lo - pad) / step) * step, y1 = Math.ceil((hi + pad) / step) * step;
    if (y1 === y0) y1 = y0 + step;
    function X(d) { return L + d / m.total * pw; }
    function Y(a) { return T + (1 - (a - y0) / (y1 - y0)) * ph; }

    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Perfil del relieve: altitud de los puntos contra la distancia acumulada" font-family="system-ui, -apple-system, Roboto, sans-serif">';
    s += '<defs><linearGradient id="' + id + '-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.38"/><stop offset="1" stop-color="' + color + '" stop-opacity="0.04"/></linearGradient></defs>';
    // Cuadrícula y valores del eje
    for (var v = y0; v <= y1; v += step) {
      var gy = Y(v);
      s += '<line x1="' + L + '" y1="' + r1(gy) + '" x2="' + (W - R) + '" y2="' + r1(gy) + '" stroke="' + COL.grid + '" stroke-width="1"/>';
      s += '<text x="' + (L - 8) + '" y="' + r1(gy + 4) + '" font-size="11" text-anchor="end" fill="' + COL.soft + '">' + esc(Fmt.num(v, 0)) + ' m</text>';
    }
    s += '<text transform="translate(14 ' + r1(T + ph / 2) + ') rotate(-90)" font-size="11.5" text-anchor="middle" fill="' + COL.ink + '">Altitud (m)</text>';
    // Área y línea
    var line = m.items.map(function (it, i) { return (i ? 'L' : 'M') + r1(X(it.dist)) + ' ' + r1(Y(it.alt)); }).join(' ');
    var base = r1(Y(y0));
    s += '<path d="' + line + ' L' + r1(X(m.total)) + ' ' + base + ' L' + r1(X(0)) + ' ' + base + ' Z" fill="url(#' + id + '-fill)"/>';
    s += '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>';
    // Puntos y cotas. Con muchos puntos solo se rotulan el primero, el último, el más alto y el más bajo.
    var many = m.items.length > 10, prevX = -Infinity, flip = false;
    m.items.forEach(function (it, i) {
      var cx = X(it.dist), cy = Y(it.alt);
      s += '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="4.6" fill="#fff" stroke="' + color + '" stroke-width="2.4"/>';
      if (many && it !== m.high && it !== m.low && i !== 0 && i !== m.items.length - 1) return;
      flip = cx - prevX < 78 ? !flip : false;           // si el rótulo anterior queda cerca, este va debajo del punto
      prevX = cx;
      var anchor = cx > W - R - 56 ? 'end' : cx < L + 40 ? 'start' : 'middle';
      var ly = flip ? cy + 19 : cy - 10;
      s += '<text x="' + r1(cx) + '" y="' + r1(ly) + '" font-size="11.5" font-weight="600" text-anchor="' + anchor + '" fill="' + COL.ink + '" paint-order="stroke" stroke="' + COL.halo + '" stroke-width="3.4">' + esc(it.name) + ' · ' + esc(Fmt.num(it.alt, 0)) + ' m</text>';
    });
    // Eje horizontal
    var by = T + ph;
    s += '<line x1="' + L + '" y1="' + by + '" x2="' + (W - R) + '" y2="' + by + '" stroke="' + COL.soft + '" stroke-width="1.4"/>';
    s += '<text x="' + L + '" y="' + (by + 18) + '" font-size="11" fill="' + COL.soft + '">Inicio</text>';
    s += '<text x="' + (W - R) + '" y="' + (by + 18) + '" font-size="11" text-anchor="end" fill="' + COL.soft + '">Fin · ' + esc(Fmt.dist(m.total)) + '</text>';
    s += '<text x="' + r1(L + pw / 2) + '" y="' + (by + 40) + '" font-size="11.5" text-anchor="middle" fill="' + COL.ink + '">Distancia acumulada del recorrido</text>';
    return s + '</svg>';
  }

  return { build: build, rows: rows, svg: svg, niceStep: niceStep, srcLabel: srcLabel, COL: COL, GPS_QUIET_RELIEF: GPS_QUIET_RELIEF };
});

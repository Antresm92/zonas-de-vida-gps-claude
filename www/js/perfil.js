/* perfil.js — perfil del relieve: la altitud de los puntos contra la distancia acumulada entre ellos.
 * Usa solo las altitudes que ya están guardadas (no consulta internet) y dice de dónde viene cada una.
 * build() hace las cuentas y svg() dibuja; sirve en el navegador (window.Perfil) y en Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./fmt.js'));
  else root.Perfil = factory(root.Geo, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (Geo, Fmt) {
  'use strict';

  var COL = { ink: '#14301F', soft: '#5B6F61', grid: '#D6DED8', halo: '#FFFFFF' };
  var SRC_LABEL = { gps: 'GPS', manual: 'a mano', internet: 'internet', archivo: 'archivo', sindato: 'sin dato' };
  var STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var GPS_QUIET_RELIEF = 20;      // por debajo de este desnivel (m) un perfil hecho con GPS puede ser solo ruido

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function r1(v) { return Math.round(v * 10) / 10; }
  // 2.34.1: una altitud sin origen guardado dice «sin dato» (antes se suponía «a mano»)
  function srcLabel(src) { return Object.prototype.hasOwnProperty.call(SRC_LABEL, src) ? SRC_LABEL[src] : 'sin dato'; }

  // Cuentas del perfil. Los puntos se recorren en el orden de la lista (sin volver al primero).
  // Devuelve { ok:false, reason } o { ok:true, items, total, ... }.
  // opts: { level: 1 | 2 } — el margen de la pendiente (68 % o 95 %, 2.35.0)
  function build(points, opts) {
    var pts = (points || []).filter(validLL);
    var items = [], missing = 0, dist = 0, prev = null;
    pts.forEach(function (p, i) {
      if (prev) dist += Geo.distance(prev.lat, prev.lon, p.lat, p.lon);
      prev = p;
      if (!isNum(p.alt)) { missing++; return; }
      var src = Object.prototype.hasOwnProperty.call(SRC_LABEL, p.altSrc) ? p.altSrc : 'sindato';
      items.push({ name: p.name || ('P' + (i + 1)), alt: p.alt, src: src, srcLabel: srcLabel(src), dist: dist, color: HEX.test(p.color || '') ? p.color : null });
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
    var info = slopeInfo(pts, opts), sl = info.ok ? info : null;
    var m = { ok: true, slope: sl, slopeInfo: info, items: items, total: total, missing: missing, high: hi, low: lo, relief: relief, ascent: up, descent: down, steepest: steep, srcCounts: srcCounts, notes: [] };

    var gps = srcCounts.gps || 0, kinds = Object.keys(srcCounts).length;
    if (gps) m.notes.push(gps + (gps === 1 ? ' altitud fue tomada' : ' altitudes fueron tomadas') + ' con el GPS del teléfono, que suele tener un error de varios metros (a veces decenas).');
    if (gps && relief < GPS_QUIET_RELIEF) m.notes.push('La diferencia entre el punto más alto y el más bajo (' + Fmt.num(relief, 0) + ' m) es del orden de ese error: el perfil podría mostrar ruido del GPS y no el relieve real.');
    if (kinds > 1) m.notes.push('Las altitudes vienen de varias fuentes (' + Object.keys(srcCounts).map(srcLabel).join(', ') + '): pueden no ser comparables entre sí.');
    if (sl) {
      m.notes.push('La pendiente media sale de ajustar un plano a los ' + sl.n + ' puntos con altitudes ' + SRC_PHRASE[sl.src] + (sl.marginKnown ? ', con su margen al ' + (sl.level === 1 ? '68' : '95') + ' %' : '; su margen es desconocido porque no se sabe con qué precisión se midieron') + ': es una aproximación y no reemplaza un levantamiento topográfico.');
      if (sl.excluded.length) m.notes.push('Para la pendiente no se usaron ' + sl.excluded.map(function (e) { return e.name + ' (' + SRC_PHRASE[e.src] + ')'; }).join(', ') + ', para no mezclar altitudes con distinta referencia.');
      if (sl.surface) m.notes.push('Las altitudes de internet son de la superficie del terreno, con árboles y construcciones: en un lote con árboles la pendiente puede ser la de las copas.');
      if (sl.uncertain) m.notes.push('Con su margen, la pendiente puede estar en ' + sl.classes.length + ' clases del IGAC: mídela en campo (Información › Usos recomendados › Evaluar el terreno).');
    } else if (info.reason) m.notes.push(info.reason);
    if (missing) m.notes.push(missing + (missing === 1 ? ' punto sin altitud no aparece' : ' puntos sin altitud no aparecen') + ' en el perfil.');
    return m;
  }

  /* ---------- Pendiente media del terreno ---------- */
  // Clases de pendiente que usa el IGAC en sus levantamientos de suelos y geomorfología (letra, límite superior en %, nombre)
  var SLOPE_CLASSES = [
    ['a', 3, 'ligeramente plano'], ['b', 7, 'ligeramente inclinado'], ['c', 12, 'moderadamente inclinado'], ['d', 25, 'fuertemente inclinado'],
    ['e', 50, 'moderadamente escarpado'], ['f', 75, 'escarpado'], ['g', Infinity, 'muy escarpado']
  ];
  var WINDS = ['el norte', 'el noreste', 'el este', 'el sureste', 'el sur', 'el suroeste', 'el oeste', 'el noroeste'];
  function slopeClass(pct) {
    for (var i = 0; i < SLOPE_CLASSES.length; i++) if (pct < SLOPE_CLASSES[i][1]) break;
    var c = SLOPE_CLASSES[Math.min(i, SLOPE_CLASSES.length - 1)], from = i ? SLOPE_CLASSES[i - 1][1] : 0;
    return { code: c[0], name: c[2], range: c[1] === Infinity ? 'más de ' + from + ' %' : from + '–' + c[1] + ' %' };
  }
  function wind(brg) { return WINDS[Math.round((((brg % 360) + 360) % 360) / 45) % 8]; }
  // Ajusta un plano (mínimos cuadrados) a los puntos dados (todos con altitud). Devuelve { a, b, sxx, syy, sxy, n } o null si
  // hay menos de 3 o si están casi en línea recta (un plano no queda definido).
  function fitPlane(pts) {
    if (pts.length < 3) return null;
    var fr = Geo.localFrame(pts), xy = pts.map(function (p) { return Geo.toXY(fr, p); }), n = pts.length;
    var mx = 0, my = 0, mz = 0;
    xy.forEach(function (q, i) { mx += q.x; my += q.y; mz += pts[i].alt; });
    mx /= n; my /= n; mz /= n;
    var sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    xy.forEach(function (q, i) {
      var dx = q.x - mx, dy = q.y - my, dz = pts[i].alt - mz;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz;
    });
    var det = sxx * syy - sxy * sxy;
    if (!(sxx > 0 && syy > 0) || det < 0.01 * sxx * syy) return null;       // en línea recta (o casi)
    var a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det;   // subida por metro hacia el este y hacia el norte
    var span = 0;
    xy.forEach(function (q, i) { for (var j = i + 1; j < n; j++) span = Math.max(span, Math.hypot(q.x - xy[j].x, q.y - xy[j].y)); });
    return { a: a, b: b, sxx: sxx, syy: syy, sxy: sxy, n: n, span: span };
  }
  function planeResult(f) {
    var g = Math.sqrt(f.a * f.a + f.b * f.b), pct = g * 100;
    var aspect = g > 0 ? (Math.atan2(-f.a, -f.b) * 180 / Math.PI + 360) % 360 : null;   // hacia dónde baja el terreno
    return { pct: pct, deg: Math.atan(g) * 180 / Math.PI, aspect: aspect, wind: aspect === null ? null : wind(aspect), cls: slopeClass(pct), n: f.n };
  }

  /* ---------- Pendiente con su margen (2.35.0) ----------
   * 1. Una sola fuente de altitud: la del grupo con más puntos (empate: a mano, GPS, internet, archivo, sin dato). Mezcladas,
   *    la diferencia de referencia se vuelve desnivel: en Android el GPS da la altura sobre el elipsoide y la de internet es
   *    sobre el nivel del mar.
   * 2. Margen: con un error vertical σz igual en los puntos usados, la covarianza de las dos componentes del plano es
   *    σz² (XᵀX)⁻¹ (H. P. Gavin, «Generalized Linear Least Squares and Error Analysis», Duke University, ec. 18), y el de la
   *    pendiente sale por propagación de primer orden (ec. 3). Casi plano (pendiente menor que dos veces el eje largo de esa
   *    covarianza): se usa el eje largo, más prudente. Supone errores independientes: si se parecen, el margen real es
   *    menor, porque un error igual en todos los puntos no cambia la pendiente.
   *    σz: GPS = promedio cuadrático de la precisión vertical guardada (Android la da al 68 %, ~1 desviación); internet =
   *    4 / 1,645 ≈ 2,4 m (Copernicus GLO-90: error vertical menor de 4 m al 90 %); a mano, archivo o sin dato = desconocido.
   * 3. Nivel: 1 desviación (68 %) o 2 (95 %), lo elige la persona en Preferencias (viene 95 %). Si pendiente ± margen cruza
   *    un límite de las clases (3, 7, 12, 25, 50 o 75 %), la clase es incierta.
   * 4. Internet en un lote de menos de 270 m (3 celdas del modelo de 90 m): no se calcula. */
  var SRC_ORDER = ['manual', 'gps', 'internet', 'archivo', 'sindato'];
  var DEM_SIGMA = 4 / 1.645, DEM_MIN_SPAN = 270;
  var SRC_PHRASE = { gps: 'del GPS', internet: 'de internet', manual: 'escritas a mano', archivo: 'de un archivo', sindato: 'sin dato de origen' };
  function srcOf(p) { return Object.prototype.hasOwnProperty.call(SRC_LABEL, p.altSrc) ? p.altSrc : 'sindato'; }
  // Las clases que toca el rango [lo, hi]; un límite cuenta solo si queda estrictamente adentro
  function classesIn(lo, hi) {
    var out = [], from = 0;
    SLOPE_CLASSES.forEach(function (c) {
      var to = c[1];
      if (hi > from && lo < to) out.push({ code: c[0], name: c[2], range: to === Infinity ? 'más de ' + from + ' %' : from + '–' + to + ' %', from: from, to: to });
      from = to;
    });
    if (!out.length) out.push(slopeClass(lo));
    return out;
  }
  // { ok:true, pct, deg, aspect, wind, cls, n, src, excluded, sigma, margin, level, low, high, classes, uncertain, marginKnown, surface }
  // o { ok:false, reason, mixed?, small? } (sin reason cuando no hay 3 puntos con altitud o están en línea, como antes)
  function slopeInfo(points, opts) {
    var level = opts && opts.level === 1 ? 1 : 2;
    var list = points || [], all = list.filter(function (p) { return validLL(p) && isNum(p.alt); });
    if (all.length < 3) return { ok: false, reason: null };
    var groups = {};
    all.forEach(function (p) { var s = srcOf(p); (groups[s] = groups[s] || []).push(p); });
    var src = Object.keys(groups).sort(function (x, y) { return groups[y].length - groups[x].length || SRC_ORDER.indexOf(x) - SRC_ORDER.indexOf(y); })[0];
    var use = groups[src], nameOf = function (p) { return p.name || ('P' + (list.indexOf(p) + 1)); };
    var excluded = all.filter(function (p) { return srcOf(p) !== src; }).map(function (p) { return { name: nameOf(p), src: srcOf(p) }; });
    if (use.length < 3) {
      return { ok: false, mixed: true, reason: 'Las altitudes vienen de fuentes distintas (' + Object.keys(groups).map(function (k) { return groups[k].length + ' ' + SRC_PHRASE[k]; }).join(', ') +
        '): para la pendiente hacen falta 3 de la misma fuente, porque mezcladas la diferencia de referencia se vuelve desnivel.' };
    }
    var f = fitPlane(use);
    if (!f) return { ok: false, reason: null };
    if (src === 'internet' && f.span < DEM_MIN_SPAN) {
      return { ok: false, small: true, reason: 'Las altitudes son de internet, de un modelo con celdas de 90 m, y los puntos están a menos de 270 m entre sí: con ellas no sale la pendiente. Usa el GPS o mídela en campo.' };
    }
    var out = planeResult(f);
    out.ok = true; out.src = src; out.excluded = excluded; out.level = level; out.surface = src === 'internet';
    var sz = null;
    if (src === 'gps') {
      var acc = use.map(function (p) { return p.altAcc; }).filter(function (v) { return isNum(v) && v > 0; });
      if (acc.length) sz = Math.sqrt(acc.reduce(function (s, v) { return s + v * v; }, 0) / acc.length);
    } else if (src === 'internet') sz = DEM_SIGMA;
    out.marginKnown = sz !== null;
    out.sigma = null; out.margin = null; out.low = null; out.high = null; out.classes = [out.cls]; out.uncertain = false;
    if (sz !== null) {
      var det = f.sxx * f.syy - f.sxy * f.sxy, k = sz * sz / det;
      var caa = k * f.syy, cbb = k * f.sxx, cab = -k * f.sxy;                // covarianza de las componentes (Gavin, ec. 18)
      var lmax = (caa + cbb) / 2 + Math.sqrt(Math.pow((caa - cbb) / 2, 2) + cab * cab), g = out.pct / 100;
      var s = g >= 2 * Math.sqrt(lmax) ? Math.sqrt((f.a * f.a * caa + 2 * f.a * f.b * cab + f.b * f.b * cbb) / (g * g)) : Math.sqrt(lmax);   // ec. 3, o el eje largo
      out.sigma = s * 100; out.margin = level * out.sigma;
      out.low = Math.max(0, out.pct - out.margin); out.high = out.pct + out.margin;
      out.classes = classesIn(out.low, out.high); out.uncertain = out.classes.length > 1;
    }
    return out;
  }
  // La pendiente de siempre (para quien solo necesita el número): null si no se puede calcular
  function slope(points, opts) {
    var s = slopeInfo(points, opts);
    return s.ok ? s : null;
  }
  // «3–7, 7–12 o 12–25 %»
  function rangesText(classes) {
    var r = classes.map(function (c) { return c.range.replace(/ %$/, ''); });
    return (r.length > 1 ? r.slice(0, -1).join(', ') + ' o ' + r[r.length - 1] : r[0]) + ' %';
  }
  function pctText(v) { return Fmt.num(v, v < 10 ? 1 : 0); }
  function levelText(sl) { return (sl.level === 1 ? '68' : '95') + ' %'; }
  // La pendiente en palabras: «14,2 % ± 9,1 %» (slopeShort) y con el nivel, «14,2 % ± 9,1 % (95 %)»; «11 %» si el margen no se
  // conoce. Con margen va con un decimal (dos si el margen es menor de 0,1), para que se vea si cruza un límite de clase: con
  // enteros, «10 % ± 2 %» parecería no pasar de 12 aunque sea 10,4 ± 2,0.
  function slopeShort(sl) {
    if (!sl.marginKnown) return pctText(sl.pct) + ' %';
    var d = sl.margin < 0.1 ? 2 : 1;
    return Fmt.num(sl.pct, d) + ' % ± ' + Fmt.num(sl.margin, d) + ' %';
  }
  function slopeText(sl) { return slopeShort(sl) + (sl.marginKnown ? ' (' + levelText(sl) + ')' : ''); }
  function slopeRows(sl, info) {
    if (!sl) return info && info.reason ? [['Pendiente media del terreno', 'no se calcula: ' + info.reason]] : [];
    var flat = sl.pct < 0.5, known = sl.marginKnown !== false && sl.margin !== undefined && sl.margin !== null;
    var rows = [
      ['Pendiente media del terreno', slopeText(sl) + ' · ' + Fmt.num(sl.deg, 1) + '°' + (flat || !sl.wind ? '' : ' · baja hacia ' + sl.wind) +
        (known || sl.src === undefined ? '' : ' · margen desconocido (altitudes ' + SRC_PHRASE[sl.src] + ')')],
      ['Clase de pendiente (IGAC)', sl.uncertain ? 'incierta: puede ser ' + rangesText(sl.classes) : sl.cls.code + ' · ' + sl.cls.name + ' (' + sl.cls.range + ')']
    ];
    if ((sl.excluded && sl.excluded.length) || sl.surface) {
      rows.push(['Altitudes usadas para la pendiente', sl.n + ' ' + SRC_PHRASE[sl.src] + (sl.surface ? ' (superficie del terreno, con árboles y construcciones)' : '') +
        (sl.excluded && sl.excluded.length ? '; no se usaron ' + sl.excluded.map(function (e) { return e.name + ' (' + SRC_PHRASE[e.src] + ')'; }).join(', ') : '')]);
    }
    return rows;
  }

  // Datos para una tabla: [etiqueta, valor]
  function rows(m) {
    if (!m || !m.ok) return [];
    // build() solo da ok si el recorrido mide más de 0 m, así que siempre hay un tramo más inclinado
    return slopeRows(m.slope, m.slopeInfo).concat([
      ['Punto más alto', m.high.name + ' · ' + Fmt.num(m.high.alt, 0) + ' m'],
      ['Punto más bajo', m.low.name + ' · ' + Fmt.num(m.low.alt, 0) + ' m'],
      ['Desnivel entre ambos', Fmt.num(m.relief, 0) + ' m'],
      ['Ascenso acumulado', Fmt.num(m.ascent, 0) + ' m'],
      ['Descenso acumulado', Fmt.num(m.descent, 0) + ' m'],
      ['Longitud del recorrido', Fmt.dist(m.total)],
      ['Tramo más inclinado', m.steepest.from + ' → ' + m.steepest.to + ' · ' + Fmt.num(m.steepest.pct, 0) + ' %']
    ]);
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
    var color = HEX.test(o.color || '') ? o.color : '#2F8F4E';
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
      s += '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="4.6" fill="#fff" stroke="' + (it.color || color) + '" stroke-width="2.4"/>';   // el color propio del punto, si lo tiene
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

  return { build: build, rows: rows, svg: svg, niceStep: niceStep, slope: slope, slopeInfo: slopeInfo, slopeText: slopeText, slopeShort: slopeShort, levelText: levelText, rangesText: rangesText, classesIn: classesIn, SRC_PHRASE: SRC_PHRASE, DEM_SIGMA: DEM_SIGMA, DEM_MIN_SPAN: DEM_MIN_SPAN, slopeClass: slopeClass, slopeRows: slopeRows, SLOPE_CLASSES: SLOPE_CLASSES, srcLabel: srcLabel, COL: COL, GPS_QUIET_RELIEF: GPS_QUIET_RELIEF };
});

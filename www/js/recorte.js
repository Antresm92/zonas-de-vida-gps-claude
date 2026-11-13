/* recorte.js — ajustar un polígono a sus linderos (2.21.0). Lógica pura, sin pantalla.
 *
 * Cuando un área nueva se monta sobre otra o se sale de su finca, la app puede recortarla para que su borde siga el de la
 * vecina y el de la finca. Aquí está la geometría:
 *   clip(A, B, op)                 → { pieces: [anillo…], holes: n, changed }   op: 'and' (lo de A que está dentro de B) o 'not' (lo de A que está fuera de B)
 *   adjust(points, finca, others)  → { ok, points, pieces, dropped, skipped, removed, added, m2Before, m2After, reason }
 *
 * Método: se parten los lados de los dos polígonos en todos los puntos donde se tocan o se cruzan; cada trozo se clasifica
 * (dentro o fuera del otro, o sobre un lado compartido) y con los trozos que sirven se vuelven a armar los anillos. Así los
 * linderos compartidos y las esquinas pegadas, que son lo normal entre lotes vecinos, no necesitan trato especial.
 * Todo se calcula en un plano local en metros (Geo.localFrame), suficiente para predios de pocos kilómetros.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.Recorte = factory(root.Geo);
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  var EPS = 0.02;            // metros: dos puntos más cerca que esto son el mismo
  var MIN_M2 = 1;            // un pedazo más pequeño que esto es una astilla del cálculo, no un terreno
  var AUTO = /^P(\d+)$/;
  var FAIL = 'No se pudo calcular el ajuste con estos linderos (hay puntos casi encima de un lado). Mueve un poco el punto o deja el polígono como está.';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function okp(p) { return !!p && isNum(p.lat) && isNum(p.lon); }
  function sarea(r) { var s = 0; for (var i = 0; i < r.length; i++) { var a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  // Distancia de p al segmento ab y en qué parte del segmento cae (t entre 0 y 1)
  function onSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { t: t, d: dist(p, { x: a.x + t * dx, y: a.y + t * dy }) };
  }
  // Cruce de los segmentos ab y cd (no paralelos): { x, y, t } con t = posición sobre ab, o null
  function cross(a, b, c, d) {
    var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    var t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + t * rx, y: a.y + t * ry, t: t };
  }
  function inside(p, r) {
    var inn = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var a = r[i], b = r[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inn = !inn;
    }
    return inn;
  }
  // Sin puntos repetidos seguidos y en sentido contrario a las agujas del reloj. Devuelve null si no queda un polígono.
  function tidy(r) {
    var out = [];
    r.forEach(function (p) { if (!out.length || dist(out[out.length - 1], p) > EPS) out.push(p); });
    while (out.length > 1 && dist(out[0], out[out.length - 1]) <= EPS) out.pop();
    if (out.length < 3 || Math.abs(sarea(out)) < MIN_M2) return null;
    return sarea(out) < 0 ? out.reverse() : out;
  }

  /* ---------- Recorte en el plano ---------- */
  // A y B: anillos de { x, y, src?, alt? }. Devuelve { rings: [[nodo…]…] (positivos = pedazos, negativos = huecos), changed } o null si algo no cuadra.
  function boolXY(A, B, op) {
    var nodes = [];
    function id(p, extra) {
      for (var i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= EPS) { if (extra && extra.src && !nodes[i].src) nodes[i].src = extra.src; return i; }
      nodes.push({ x: p.x, y: p.y, src: extra && extra.src || null, alt: extra && isNum(extra.alt) ? extra.alt : null });
      return nodes.length - 1;
    }
    A.forEach(function (p) { id(p, { src: p.src, alt: p.alt }); });
    B.forEach(function (p) { id(p, { alt: p.alt }); });
    function split(P, Q) {
      var edges = [];
      P.forEach(function (a, i) {
        var b = P[(i + 1) % P.length], cuts = [{ t: 0, id: id(a) }, { t: 1, id: id(b) }];
        function alt(t) { return isNum(a.alt) && isNum(b.alt) ? a.alt + t * (b.alt - a.alt) : null; }
        Q.forEach(function (c, j) {
          var s = onSeg(c, a, b);
          if (s.d <= EPS) cuts.push({ t: s.t, id: id(c) });
          var x = cross(a, b, c, Q[(j + 1) % Q.length]);
          if (x) cuts.push({ t: x.t, id: id(x, { alt: alt(x.t) }) });
        });
        cuts.sort(function (m, n) { return m.t - n.t; });
        for (var k = 1; k < cuts.length; k++) if (cuts[k].id !== cuts[k - 1].id) edges.push([cuts[k - 1].id, cuts[k].id]);
      });
      return edges;
    }
    var ea = split(A, B), eb = split(B, A), inB = {}, inA = {};
    eb.forEach(function (e) { inB[e[0] + '>' + e[1]] = true; });
    ea.forEach(function (e) { inA[e[0] + '>' + e[1]] = true; });
    function mid(e) { return { x: (nodes[e[0]].x + nodes[e[1]].x) / 2, y: (nodes[e[0]].y + nodes[e[1]].y) / 2 }; }
    var keep = [], changed = false;
    ea.forEach(function (e) {
      var same = inB[e[0] + '>' + e[1]], opp = inB[e[1] + '>' + e[0]];
      var take = same ? op === 'and' : opp ? op === 'not' : inside(mid(e), B) === (op === 'and');
      if (take) keep.push({ u: e[0], v: e[1] }); else changed = true;
    });
    eb.forEach(function (e) {
      if (inA[e[0] + '>' + e[1]] || inA[e[1] + '>' + e[0]]) return;                  // lado compartido: ya lo decidió A
      if (!inside(mid(e), A)) return;
      keep.push(op === 'and' ? { u: e[0], v: e[1] } : { u: e[1], v: e[0] });
      changed = true;
    });
    // Se arman los anillos: en cada esquina se sigue por el trozo que más gira a la izquierda (el interior va a la izquierda)
    var from = {};
    keep.forEach(function (e) { (from[e.u] = from[e.u] || []).push(e); });
    var rings = [];
    for (var s = 0; s < keep.length; s++) {
      if (keep[s].used) continue;
      var ring = [], e = keep[s], guard = 0;
      while (e && !e.used && guard++ <= keep.length) {
        e.used = true; ring.push(e.u);
        if (e.v === keep[s].u) break;
        var best = null, bestA = -Infinity, dx = nodes[e.v].x - nodes[e.u].x, dy = nodes[e.v].y - nodes[e.u].y;
        (from[e.v] || []).forEach(function (c) {
          if (c.used) return;
          var cx = nodes[c.v].x - nodes[c.u].x, cy = nodes[c.v].y - nodes[c.u].y;
          var ang = Math.atan2(dx * cy - dy * cx, dx * cx + dy * cy);
          if (c.v === e.u) ang = -Math.PI;                                              // devolverse es la última opción
          if (ang > bestA) { bestA = ang; best = c; }
        });
        if (!best) return null;                                                          // un trozo sin continuación: no se arriesga un resultado torcido
        e = best;
      }
      rings.push(ring.map(function (k) { return nodes[k]; }));
    }
    return { rings: rings, changed: changed };
  }

  /* ---------- En coordenadas ---------- */
  function ringXY(fr, pts, keepSrc) {
    return pts.filter(okp).map(function (p) { var q = Geo.toXY(fr, p); q.alt = isNum(p.alt) ? p.alt : null; if (keepSrc) q.src = p; return q; });
  }
  function clipXY(A, B, op) {
    var a = tidy(A), b = tidy(B);
    if (!a) return { pieces: [], holes: 0, changed: false, bad: true };
    if (!b) return { pieces: [a], holes: 0, changed: false };
    var r = boolXY(a, b, op);
    if (!r) return { pieces: [a], holes: 0, changed: false, bad: true };
    if (!r.changed) return { pieces: [a], holes: 0, changed: false };
    var pieces = [], holes = 0;
    r.rings.forEach(function (g) { var s = sarea(g); if (s >= MIN_M2) pieces.push(g); else if (s <= -MIN_M2) holes++; });
    return { pieces: pieces, holes: holes, changed: true };
  }
  function toLL(fr, ring) {
    return ring.map(function (n) {
      if (n.src) return n.src;
      var ll = Geo.fromXY(fr, n), p = { lat: ll.lat, lon: ll.lon };
      if (isNum(n.alt)) p.alt = Math.round(n.alt * 10) / 10;
      return p;
    });
  }
  // Lo de A dentro de B ('and') o fuera de B ('not'). Los puntos de A que sobreviven son los mismos objetos; los nuevos traen lat, lon y alt (si se pudo).
  function clip(A, B, op) {
    var a = (A || []).filter(okp), b = (B || []).filter(okp);
    if (a.length < 3) return { pieces: [], holes: 0, changed: false };
    var fr = Geo.localFrame(a.concat(b));
    var r = clipXY(ringXY(fr, a, true), ringXY(fr, b, false), op === 'not' ? 'not' : 'and');
    return { pieces: r.pieces.map(function (g) { return toLL(fr, g); }), holes: r.holes, changed: r.changed, bad: !!r.bad };
  }

  /* ---------- Ajustar un polígono a sus linderos ---------- */
  // points: el polígono que se ajusta. finca: los puntos de su finca (o null). others: [{ name, points }] vecinos que no debe pisar.
  // Devuelve { ok: true, points, dropped (pedazos sueltos que se descartaron), skipped (vecinos que no se pudieron descontar),
  //            removed (puntos propios que ya no están), added (puntos nuevos), m2Before, m2After }
  //       o  { ok: false, reason }.
  function adjust(points, finca, others) {
    var own = (points || []).filter(okp);
    if (own.length < 3) return { ok: false, reason: 'Hacen falta 3 puntos o más para ajustar el polígono.' };
    var all = own.slice();
    if (finca) all = all.concat(finca.filter(okp));
    (others || []).forEach(function (o) { all = all.concat((o.points || []).filter(okp)); });
    var fr = Geo.localFrame(all), start = tidy(ringXY(fr, own, true));
    if (!start) return { ok: false, reason: 'El polígono no tiene área: revisa sus puntos.' };
    var cw = sarea(ringXY(fr, own, false)) < 0, cur = [start], skipped = [], changed = false, failed = false, m2Before = sarea(start);
    if (finca && finca.filter(okp).length >= 3) {
      var F = ringXY(fr, finca, false), next = [];
      cur.forEach(function (c) { var r = clipXY(c, F, 'and'); if (r.bad) { failed = true; return; } if (r.changed) changed = true; next = next.concat(r.pieces); });
      if (failed) return { ok: false, reason: FAIL };
      cur = next;
      if (!cur.length) return { ok: false, reason: 'El polígono queda por fuera del predio: no hay nada que conservar dentro de sus límites.' };
    }
    (others || []).forEach(function (o) {
      var O = ringXY(fr, o.points || [], false), next = [], skip = false;
      if (O.length < 3) return;
      cur.forEach(function (c) {
        var r = clipXY(c, O, 'not');
        if (r.bad) { failed = true; return; }
        if (r.holes) { skip = true; next.push(c); return; }                    // quedaría un hueco (el vecino está metido por completo): no se toca
        if (r.changed) changed = true;
        next = next.concat(r.pieces);
      });
      if (skip && skipped.indexOf(o.name) < 0) skipped.push(o.name);
      cur = next;
    });
    if (failed) return { ok: false, reason: FAIL };
    if (!cur.length) return { ok: false, reason: 'El polígono queda por completo dentro de otro: al ajustarlo no quedaría nada.' };
    if (!changed) return { ok: false, reason: skipped.length ? '«' + skipped[0] + '» está por completo dentro de este polígono: no se puede descontar sin dejar un hueco.' : 'El polígono ya respeta los linderos: no hay nada que ajustar.', skipped: skipped };
    cur.sort(function (a, b) { return sarea(b) - sarea(a); });
    var ring = toLL(fr, cur[0]);
    if (cw) ring.reverse();                                                             // se conserva el sentido en que se caminó
    // empieza en el punto propio más antiguo que sobrevive, para que la numeración se parezca a la de antes
    var first = -1, bestIdx = Infinity;
    ring.forEach(function (p, i) { var k = own.indexOf(p); if (k >= 0 && k < bestIdx) { bestIdx = k; first = i; } });
    if (first > 0) ring = ring.slice(first).concat(ring.slice(0, first));
    var kept = ring.filter(function (p) { return own.indexOf(p) >= 0; }).length;
    return { ok: true, points: ring, dropped: cur.length - 1, skipped: skipped, removed: own.length - kept, added: ring.length - kept, m2Before: m2Before, m2After: sarea(cur[0]) };
  }

  // Nombres después del ajuste: los puntos con nombre propio lo conservan; los automáticos (P1, P2…) y los nuevos se numeran
  // seguidos en el orden del lindero. Devuelve { points (copias con nombre), next }.
  function rename(points) {
    var k = 0;
    var out = (points || []).map(function (p) {
      var c = {}; Object.keys(p).forEach(function (key) { c[key] = p[key]; });
      if (typeof p.name === 'string' && p.name && !AUTO.test(p.name)) return c;
      k++; c.name = 'P' + k;
      return c;
    });
    return { points: out, next: k + 1 };
  }

  return { clip: clip, adjust: adjust, rename: rename, EPS: EPS, MIN_M2: MIN_M2 };
});

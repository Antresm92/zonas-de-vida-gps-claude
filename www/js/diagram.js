/* diagram.js — dibujo SVG del diagrama de Holdridge y del polígono de la finca.
 * Unidades del diagrama: X = 2U - V, Y = raíz(3)·V (ver holdridge.js). 1 unidad = S px de "mundo". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./holdridge.js'), require('./geo.js'));
  else root.Diagram = factory(root.Holdridge, root.Geo);
})(typeof self !== 'undefined' ? self : this, function (H, Geo) {
  'use strict';

  var S = 60;                         // px de mundo por unidad
  var SQ3 = Math.sqrt(3);
  var R = 2 / SQ3;                    // radio del hexágono (centro a vértice)
  var COL = { grid: '#D8353C', hex: '#2F8F4E', hexFill: 'rgba(47,143,78,0.22)', bt: '#1F3FBF', ink: '#14301F', soft: '#5B6F61',
              paper: '#FFFFFF', point: '#D8353C' };
  var X_MIN = -17, X_MAX = 19;        // ancho de las líneas de biotemperatura (en unidades)

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function f(n) { return (Math.round(n * 100) / 100).toString(); }
  function px(X) { return X * S; }
  function py(Y) { return Y * S; }

  function hexPoints(cx, cy) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = (30 + 60 * i) * Math.PI / 180;
      pts.push(f(px(cx + R * Math.cos(a))) + ',' + f(py(cy + R * Math.sin(a))));
    }
    return pts.join(' ');
  }

  // "Bosque muy húmedo" -> ["Bosque muy", "Húmedo"]; una palabra -> una línea
  function twoLines(name) {
    var w = name.split(' ');
    if (w.length === 1) return [name];
    var last = w.pop();
    return [w.join(' '), last.charAt(0).toUpperCase() + last.slice(1)];
  }

  function textLines(lines, x, y, size, color, weight, lh) {
    lh = lh || size * 1.15;
    var y0 = y - (lines.length - 1) * lh / 2;
    var out = '<text x="' + f(x) + '" text-anchor="middle" font-size="' + size + '" fill="' + color + '"' + (weight ? ' font-weight="' + weight + '"' : '') + '>';
    lines.forEach(function (l, i) { out += '<tspan x="' + f(x) + '" y="' + f(y0 + i * lh) + '">' + esc(l) + '</tspan>'; });
    return out + '</text>';
  }

  /* ---------- Contenido fijo del diagrama (en coordenadas de mundo) ---------- */
  function gridMarkup() {
    var d = H.diagramData();
    var out = '';
    // triángulo y rejilla roja
    d.pLines.forEach(function (l) {
      out += '<line x1="' + f(px(l.a.X)) + '" y1="' + f(py(l.a.Y)) + '" x2="' + f(px(l.b.X)) + '" y2="' + f(py(l.b.Y)) + '" stroke="' + COL.grid + '" stroke-width="1.1"/>';
    });
    d.perLines.forEach(function (l) {
      out += '<line x1="' + f(px(l.a.X)) + '" y1="' + f(py(l.a.Y)) + '" x2="' + f(px(l.b.X)) + '" y2="' + f(py(l.b.Y)) + '" stroke="' + COL.grid + '" stroke-width="1.1"/>';
    });
    var t = d.triangle;
    out += '<polygon points="' + t.map(function (p) { return f(px(p.X)) + ',' + f(py(p.Y)); }).join(' ') + '" fill="none" stroke="' + COL.grid + '" stroke-width="1.6"/>';
    // marcas: precipitación (borde derecho) y relación ETP/P (borde izquierdo)
    d.pLines.forEach(function (l) {
      out += '<text x="' + f(px(l.a.X) + 8) + '" y="' + f(py(l.a.Y) + 4) + '" font-size="11" fill="' + COL.grid + '">' + esc(l.label) + '</text>';
    });
    d.perLines.forEach(function (l) {
      out += '<text x="' + f(px(l.a.X) - 8) + '" y="' + f(py(l.a.Y) + 4) + '" font-size="11" fill="' + COL.grid + '" text-anchor="end">' + esc(l.label) + '</text>';
    });
    // etiquetas de ejes sobre los bordes
    return out;
  }

  function hexesMarkup(activeKey) {
    var out = '';
    H.HEXES.forEach(function (h) {
      var key = h.k + '/' + h.r;
      var active = key === activeKey;
      out += '<polygon points="' + hexPoints(h.cx, h.cy) + '" fill="' + (active ? COL.hexFill : 'none') + '" stroke="' + COL.hex + '" stroke-width="' + (active ? 3 : 1.4) + '"' + (active ? ' class="hx-active"' : '') + '/>';
    });
    H.HEXES.forEach(function (h) {
      var labs = H.hexLabels(h);
      labs.forEach(function (lb) {
        var lines = twoLines(lb.name);
        var cx = px(h.cx), cy = py(h.cy);
        if (lb.half === 'full') {
          out += textLines(lines, cx, cy - 6, 12.5, COL.ink, 500, 14);
          out += '<text x="' + f(cx) + '" y="' + f(cy + 19) + '" text-anchor="middle" font-size="10.5" fill="' + COL.soft + '">' + esc(lb.symbol) + '</text>';
        } else {
          var yc = cy + (lb.half === 'up' ? -27 : 27);
          out += textLines(lines, cx, yc, 11, COL.ink, 500, 12);
        }
      });
    });
    return out;
  }

  function bandLinesMarkup() {
    var d = H.diagramData();
    var out = '';
    d.btLines.forEach(function (l) {
      out += '<line x1="' + px(X_MIN) + '" y1="' + f(py(l.a.Y)) + '" x2="' + px(X_MAX) + '" y2="' + f(py(l.a.Y)) + '" stroke="' + COL.bt + '" stroke-width="1.5"/>';
    });
    var fr = d.frost;
    out += '<line x1="' + f(px(fr.a.X)) + '" y1="' + f(py(fr.a.Y)) + '" x2="' + f(px(fr.b.X)) + '" y2="' + f(py(fr.b.Y)) + '" stroke="' + COL.bt + '" stroke-width="2.4" stroke-dasharray="9 6"/>';
    return out;
  }

  // Proyección de un punto {lat,lon,...}: p = resultado de classify().point
  function markerMarkup(p, label, big) {
    if (!p) return '';
    var x = px(p.X), y = py(p.Y), r = big ? 9 : 4.5;
    // anillo con halo blanco: deja leer el nombre del hexágono que hay debajo
    var out = '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + r + '" fill="none" stroke="#fff" stroke-width="' + (big ? 7 : 5) + '"/>';
    out += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + r + '" fill="none" stroke="' + COL.point + '" stroke-width="' + (big ? 3 : 2.2) + '"/>';
    out += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + (big ? 2.6 : 1.8) + '" fill="' + COL.point + '"/>';
    if (label) out += '<text x="' + f(x + r + 6) + '" y="' + f(y - r) + '" font-size="11" font-weight="600" fill="' + COL.point + '" paint-order="stroke" stroke="#fff" stroke-width="3">' + esc(label) + '</text>';
    return out;
  }

  function humidityMarkup() {
    var out = '';
    H.HUMIDITY.slice(0, 10).forEach(function (hp, i) {
      var rc = 5.5 - i;                          // centro de la provincia en octavas
      var X = 4 - 2 * rc, Y = 4 * SQ3 + 0.7;
      out += '<text x="' + f(px(X)) + '" y="' + f(py(Y)) + '" text-anchor="middle" font-size="9.5" fill="' + COL.grid + '">' + esc(hp.name.toUpperCase()) + '</text>';
    });
    out += '<text x="' + f(px(1)) + '" y="' + f(py(4 * SQ3 + 1.65)) + '" text-anchor="middle" font-size="15" fill="' + COL.grid + '">Provincias de humedad</text>';
    return out;
  }

  // Etiquetas laterales (regiones latitudinales / pisos altitudinales) en coordenadas de mundo
  function sideLabelsMarkup() {
    var d = H.diagramData();
    var ys = d.btLines.map(function (l) { return l.a.Y; });             // Y de 1,5 / 3 / 6 / 12 / 24 °C
    var frostY = d.frost.a.Y;
    var bottom = 4.5 * SQ3;
    var bands = [
      { y0: ys[0] - 1.6, y1: ys[0], left: 'POLAR', right: 'NIVAL' },
      { y0: ys[0], y1: ys[1], left: 'SUBPOLAR', right: ['ALPINO', 'ANDINO'] },
      { y0: ys[1], y1: ys[2], left: 'BOREAL', right: ['SUB ALPINO', 'SUB ANDINO'] },
      { y0: ys[2], y1: ys[3], left: 'TEMPLADA FRIA', right: 'MONTANO' },
      { y0: ys[3], y1: frostY, left: 'TEMPLADA CALIDA', right: 'MONTANO BAJO' },
      { y0: frostY, y1: ys[4], left: 'SUB TROPICAL', right: 'PRE MONTANO' },
      { y0: ys[4], y1: bottom, left: 'TROPICAL', right: 'PISO BASAL' }
    ];
    var out = '';
    bands.forEach(function (b) {
      var my = py((b.y0 + b.y1) / 2);
      out += '<text x="' + px(X_MIN + 0.3) + '" y="' + f(my + 4) + '" font-size="12" fill="' + COL.ink + '">' + esc(b.left) + '</text>';
      var r = Array.isArray(b.right) ? b.right : [b.right];
      r.forEach(function (t, i) {
        out += '<text x="' + px(X_MAX - 0.3) + '" y="' + f(my + 4 + (i - (r.length - 1) / 2) * 14) + '" font-size="12" fill="' + COL.ink + '" text-anchor="end">' + esc(t) + '</text>';
      });
    });
    d.btLines.forEach(function (l) {
      var bt = l.bt;
      out += '<text x="' + px(X_MIN + 0.3) + '" y="' + f(py(l.a.Y) - 5) + '" font-size="13" fill="' + COL.bt + '">' + esc(String(bt).replace('.', ',')) + '°</text>';
      out += '<text x="' + px(X_MAX - 0.3) + '" y="' + f(py(l.a.Y) - 5) + '" font-size="13" fill="' + COL.bt + '" text-anchor="end">' + esc(String(Math.round(l.pet * 100) / 100).replace('.', ',')) + '</text>';
    });
    out += '<text x="' + px(X_MIN + 0.3) + '" y="' + f(py(4.5 * SQ3 + 0.3)) + '" font-size="13" fill="' + COL.bt + '">48°</text>';
    out += '<text x="' + px(X_MAX - 0.3) + '" y="' + f(py(4.5 * SQ3 + 0.3)) + '" font-size="13" fill="' + COL.bt + '" text-anchor="end">2828,64</text>';
    out += '<text x="' + px(X_MIN + 0.3) + '" y="' + f(py(d.frost.a.Y) - 6) + '" font-size="11" fill="' + COL.bt + '">Línea de escarcha (≈17 °C)</text>';
    return out;
  }

  function worldMarkup(o) {
    o = o || {};
    var out = '<g font-family="system-ui, -apple-system, Roboto, \'Segoe UI\', sans-serif">';
    out += gridMarkup();
    out += hexesMarkup(o.hex ? o.hex.k + '/' + o.hex.r : null);
    out += bandLinesMarkup();
    out += humidityMarkup();
    // rótulos de los ejes, fuera de los bordes inclinados del triángulo
    out += '<text x="' + f(px(-4.6)) + '" y="' + f(py(-6.2)) + '" font-size="16" fill="' + COL.grid + '" transform="rotate(-60 ' + f(px(-4.6)) + ' ' + f(py(-6.2)) + ')" text-anchor="middle">Relación de evapotranspiración potencial</text>';
    out += '<text x="' + f(px(5.6)) + '" y="' + f(py(-6.2)) + '" font-size="16" fill="' + COL.grid + '" transform="rotate(60 ' + f(px(5.6)) + ' ' + f(py(-6.2)) + ')" text-anchor="middle">Precipitación total por año (mm)</text>';
    (o.vertices || []).forEach(function (v) { out += markerMarkup(v.point, v.name, false); });
    if (o.point) out += markerMarkup(o.point, null, true);
    return out + '</g>';
  }

  /* ---------- Versión estática completa (informe) ---------- */
  function staticSVG(o) {
    o = o || {};
    var x0 = px(X_MIN - 0.2), x1 = px(X_MAX + 0.2);
    var y0 = py(-7 * SQ3 - 1.4), y1 = py(4 * SQ3 + 2.1);
    var w = x1 - x0, h = y1 - y0;
    var world = worldMarkup(o) + '<g font-family="system-ui, -apple-system, Roboto, \'Segoe UI\', sans-serif">' + sideLabelsMarkup() + '</g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [f(x0), f(y0), f(w), f(h)].join(' ') + '" width="' + (o.width || 1100) + '" role="img" aria-label="Diagrama bioclimático de Holdridge">' +
      '<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(w) + '" height="' + f(h) + '" fill="#fff"/>' + world + '</svg>';
  }

  /* ---------- Versión interactiva (zoom y arrastre) ---------- */
  function mount(el, o) {
    o = o || {};
    var NS = 'http://www.w3.org/2000/svg';
    el.innerHTML = '';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Diagrama de Holdridge. Arrastra para moverte y pellizca para acercar.');
    svg.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;background:#fff;user-select:none;-webkit-user-select:none';
    var world = document.createElementNS(NS, 'g');
    var overlay = document.createElementNS(NS, 'g');
    svg.appendChild(world); svg.appendChild(overlay);
    el.appendChild(svg);

    var st = { s: 1, tx: 0, ty: 0, W: el.clientWidth || 360, H: el.clientHeight || 300 };
    var data = {};
    var bounds = { x0: px(-12), x1: px(14), y0: py(-1.9), y1: py(4 * SQ3 + 2) };
    var minS = 0.2, maxS = 2.6;

    function apply() {
      world.setAttribute('transform', 'translate(' + f(st.tx) + ' ' + f(st.ty) + ') scale(' + st.s.toFixed(4) + ')');
      drawOverlay();
    }

    function drawOverlay() {
      var d = H.diagramData();
      var ys = d.btLines.map(function (l) { return l.a.Y; });
      var bands = [
        [ys[0] - 1.6, ys[0], 'Polar', 'Nival'], [ys[0], ys[1], 'Subpolar', 'Alpino'], [ys[1], ys[2], 'Boreal', 'Subalpino'],
        [ys[2], ys[3], 'Templada fría', 'Montano'], [ys[3], d.frost.a.Y, 'Templada cálida', 'Montano bajo'],
        [d.frost.a.Y, ys[4], 'Subtropical', 'Premontano'], [ys[4], 4.5 * SQ3, 'Tropical', 'Basal']
      ];
      var out = '';
      function sy(Y) { return st.ty + py(Y) * st.s; }
      bands.forEach(function (b) {
        // Etiqueta pegada al borde superior de la franja (justo debajo de la línea de temperatura):
        // así no cae sobre los nombres de las celdas, que están al centro de cada franja.
        var top = sy(b[0]), bot = sy(b[1]);
        var y = Math.min(Math.max(top + 13, 13), bot - 11);
        if (bot < 24 || top > st.H - 24 || y < 11 || y > st.H - 11) return;
        out += pill(6, y, b[2], 'start') + pill(st.W - 6, y, b[3], 'end');
      });
      d.btLines.forEach(function (l) {
        var y = sy(l.a.Y);
        if (y < 8 || y > st.H - 6) return;
        out += '<line x1="0" x2="' + st.W + '" y1="' + f(y) + '" y2="' + f(y) + '" stroke="' + COL.bt + '" stroke-opacity="0.0"/>';
        out += '<text x="6" y="' + f(y - 4) + '" font-size="11" font-weight="600" fill="' + COL.bt + '" paint-order="stroke" stroke="#fff" stroke-width="3">' + String(l.bt).replace('.', ',') + ' °C</text>';
        out += '<text x="' + (st.W - 6) + '" y="' + f(y - 4) + '" font-size="10" fill="' + COL.bt + '" text-anchor="end" paint-order="stroke" stroke="#fff" stroke-width="3">' + String(Math.round(l.pet)).replace('.', ',') + ' mm</text>';
      });
      overlay.innerHTML = '<g font-family="system-ui, -apple-system, Roboto, sans-serif">' + out + '</g>';
    }
    function pill(x, y, text, anchor) {
      var w = text.length * 6.2 + 10;
      var rx = anchor === 'start' ? x : x - w;
      return '<rect x="' + f(rx) + '" y="' + f(y - 9) + '" width="' + f(w) + '" height="18" rx="9" fill="#F2F5EF" fill-opacity="0.92" stroke="#C9D3CB" stroke-width="0.8"/>' +
        '<text x="' + f(rx + w / 2) + '" y="' + f(y + 4) + '" font-size="10.5" fill="' + COL.ink + '" text-anchor="middle">' + esc(text) + '</text>';
    }

    function clampView() {
      // evita perder el diagrama: al menos una parte debe seguir a la vista
      var cx = (st.W / 2 - st.tx) / st.s, cy = (st.H / 2 - st.ty) / st.s;
      var nx = Math.min(bounds.x1, Math.max(bounds.x0, cx)), ny = Math.min(bounds.y1, Math.max(bounds.y0, cy));
      if (nx !== cx) st.tx = st.W / 2 - nx * st.s;
      if (ny !== cy) st.ty = st.H / 2 - ny * st.s;
    }

    function zoomAt(sx, sy, factor) {
      var ns = Math.min(maxS, Math.max(minS, st.s * factor));
      var k = ns / st.s;
      st.tx = sx - (sx - st.tx) * k; st.ty = sy - (sy - st.ty) * k; st.s = ns;
      clampView(); apply();
    }

    function focus(p, scale) {
      st.W = el.clientWidth || st.W; st.H = el.clientHeight || st.H;
      st.s = scale || Math.min(maxS, Math.max(minS, st.W / (3.8 * 2 * S)));
      st.tx = st.W / 2 - px(p.X) * st.s;
      st.ty = st.H / 2 - py(p.Y) * st.s;
      apply();
    }
    function fit() {
      st.W = el.clientWidth || st.W; st.H = el.clientHeight || st.H;
      var bw = px(X_MAX - X_MIN) , bh = bounds.y1 - py(-1.9);
      var hexLeft = px(-9.6), hexRight = px(11.4);
      st.s = Math.min(st.W / (hexRight - hexLeft), st.H / bh);
      st.tx = -hexLeft * st.s + (st.W - (hexRight - hexLeft) * st.s) / 2;
      st.ty = -py(-1.9) * st.s + (st.H - bh * st.s) / 2;
      apply();
    }

    function setData(d) {
      data = d || {};
      world.innerHTML = worldMarkup(data);
      if (data.point) focus(data.point); else fit();
    }

    // Gestos
    var pointers = {}, lastDist = 0, lastMid = null;
    svg.addEventListener('pointerdown', function (e) {
      svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; lastDist = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    });
    svg.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      var rect = svg.getBoundingClientRect();
      if (ids.length === 1) {
        st.tx += e.clientX - p.x; st.ty += e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        clampView(); apply();
      } else if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (lastDist > 0) {
          st.tx += mid.x - lastMid.x; st.ty += mid.y - lastMid.y;
          zoomAt(mid.x - rect.left, mid.y - rect.top, dist / lastDist);
        }
        lastDist = dist; lastMid = mid;
      }
    });
    function up(e) { delete pointers[e.pointerId]; lastDist = 0; lastMid = null; }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        var nw = el.clientWidth, nh = el.clientHeight;
        if (!nw || !nh) return;
        st.tx += (nw - st.W) / 2; st.ty += (nh - st.H) / 2; st.W = nw; st.H = nh; apply();
      }).observe(el);
    }

    return {
      setData: setData, fit: fit,
      zoomIn: function () { zoomAt(st.W / 2, st.H / 2, 1.4); },
      zoomOut: function () { zoomAt(st.W / 2, st.H / 2, 1 / 1.4); },
      focusPoint: function () { if (data.point) focus(data.point); else fit(); },
      state: st
    };
  }

  /* ---------- Plano del polígono ---------- */
  function niceLength(maxM) {
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    var best = steps[0];
    steps.forEach(function (s) { if (s <= maxM) best = s; });
    return best;
  }
  function fmtLen(m) { return m >= 1000 ? (m / 1000).toString().replace('.', ',') + ' km' : m + ' m'; }

  function hexA(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(47,143,78,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Leyenda de colores (HTML) para las capas: se usa debajo del plano en la app y en el informe
  function legendHTML(layers, mainColor, mainName, hasMain) {
    var items = [];
    if (hasMain) items.push([mainColor || COL.hex, mainName || 'Mis puntos']);
    (layers || []).forEach(function (l) { if (l && l.visible !== false && l.points && l.points.length) items.push([l.color, l.name]); });
    if (items.length < 2) return '';
    return '<ul class="legend" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 2px 0;padding:0;list-style:none;font-size:14px">' + items.map(function (it) {
      return '<li><i style="display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;background:' + esc(it[0]) + '"></i>' + esc(it[1]) + '</li>';
    }).join('') + '</ul>';
  }

  // Dibuja puntos y polígono sin mapa de fondo, con el norte arriba. closed: unir último con primero.
  // o.layers: capas importadas [{points, kind, color, visible, holes}] que se dibujan debajo; o.color: color de los puntos propios
  function polygonSVG(points, o) {
    o = o || {};
    var W = o.width || 360, Hh = o.height || 300, pad = 34;
    var okp = function (p) { return p && isFinite(p.lat) && isFinite(p.lon); };
    var pts = points.filter(okp);
    var n = pts.length;
    var lay = (o.layers || []).filter(function (l) { return l && l.visible !== false && l.points && l.points.filter(okp).length; });
    var mainCol = o.color || COL.hex;
    if (!n && !lay.length) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Hh + '"></svg>';
    var all = pts.slice();
    lay.forEach(function (l) { all = all.concat(l.points.filter(okp)); });
    var fr = Geo.localFrame(all);
    var xy = pts.map(function (p) { return Geo.toXY(fr, p); });
    var xyAll = all.map(function (p) { return Geo.toXY(fr, p); });
    var minX = Math.min.apply(null, xyAll.map(function (p) { return p.x; })), maxX = Math.max.apply(null, xyAll.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, xyAll.map(function (p) { return p.y; })), maxY = Math.max.apply(null, xyAll.map(function (p) { return p.y; }));
    var spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    var sc = Math.min((W - 2 * pad) / spanX, (Hh - 2 * pad) / spanY);
    var offX = (W - spanX * sc) / 2, offY = (Hh - spanY * sc) / 2;
    function X(x) { return offX + (x - minX) * sc; }
    function Y(y) { return Hh - (offY + (y - minY) * sc); }
    function pathOf(arr, close) { return arr.map(function (p, i) { return (i ? 'L' : 'M') + f(X(p.x)) + ' ' + f(Y(p.y)); }).join(' ') + (close ? ' Z' : ''); }
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Hh + '" width="' + (o.svgWidth || '100%') + '" role="img" aria-label="Plano del polígono" font-family="system-ui, -apple-system, Roboto, sans-serif">';
    // cuadrícula suave
    var gridM = niceLength(Math.max(spanX, spanY) / 4);
    for (var gx = Math.ceil(minX / gridM) * gridM; gx <= maxX; gx += gridM) out += '<line x1="' + f(X(gx)) + '" y1="0" x2="' + f(X(gx)) + '" y2="' + Hh + '" stroke="#9FB1A4" stroke-opacity="0.3" stroke-width="1"/>';
    for (var gy = Math.ceil(minY / gridM) * gridM; gy <= maxY; gy += gridM) out += '<line x1="0" y1="' + f(Y(gy)) + '" x2="' + W + '" y2="' + f(Y(gy)) + '" stroke="#9FB1A4" stroke-opacity="0.3" stroke-width="1"/>';
    // capas importadas (debajo de los puntos propios)
    lay.forEach(function (l) {
      var q = l.points.filter(okp).map(function (p) { return Geo.toXY(fr, p); });
      if (l.kind === 'polygon' && q.length >= 3) {
        var d = pathOf(q, true);
        (l.holes || []).forEach(function (h) { var hq = h.filter(okp).map(function (p) { return Geo.toXY(fr, p); }); if (hq.length >= 3) d += ' ' + pathOf(hq, true); });
        out += '<path d="' + d + '" fill-rule="evenodd" fill="' + hexA(l.color, 0.2) + '" stroke="' + esc(l.color) + '" stroke-width="2.2" stroke-linejoin="round"/>';
      } else if ((l.kind === 'line' || l.kind === 'polygon') && q.length >= 2) {
        out += '<path d="' + pathOf(q, false) + '" fill="none" stroke="' + esc(l.color) + '" stroke-width="2.2" stroke-dasharray="6 4" stroke-linejoin="round"/>';
      } else {
        q.forEach(function (p) { out += '<circle cx="' + f(X(p.x)) + '" cy="' + f(Y(p.y)) + '" r="4.5" fill="' + esc(l.color) + '" stroke="#fff" stroke-width="1.3"/>'; });
      }
    });
    var path = xy.map(function (p, i) { return (i ? 'L' : 'M') + f(X(p.x)) + ' ' + f(Y(p.y)); }).join(' ');
    if (n >= 3) out += '<path d="' + path + ' Z" fill="' + (o.bad ? 'rgba(216,53,60,0.14)' : hexA(mainCol, 0.2)) + '" stroke="' + (o.bad ? COL.grid : esc(mainCol)) + '" stroke-width="2.4" stroke-linejoin="round"/>';
    else if (n === 2) out += '<path d="' + path + '" fill="none" stroke="' + esc(mainCol) + '" stroke-width="2.4"/>';
    // rótulos de lado
    if (n >= 2 && n <= 12 && o.sideLabels !== false) {
      var segs = n >= 3 ? n : n - 1;
      for (var i = 0; i < segs; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        var d2 = Geo.distance(a.lat, a.lon, b.lat, b.lon);
        var mx = (X(xy[i].x) + X(xy[(i + 1) % n].x)) / 2, my = (Y(xy[i].y) + Y(xy[(i + 1) % n].y)) / 2;
        out += '<text x="' + f(mx) + '" y="' + f(my - 5) + '" font-size="10.5" text-anchor="middle" fill="' + COL.soft + '" paint-order="stroke" stroke="#F2F5EF" stroke-width="3">' + (d2 >= 1000 ? (d2 / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(d2) + ' m') + '</text>';
      }
    }
    var showNames = n <= 40;
    xy.forEach(function (p, i) {
      var label = pts[i].name || ('P' + (i + 1));
      out += '<circle cx="' + f(X(p.x)) + '" cy="' + f(Y(p.y)) + '" r="5" fill="' + (i === 0 ? esc(mainCol) : '#fff') + '" stroke="' + esc(mainCol) + '" stroke-width="2"/>';
      if (showNames) out += '<text x="' + f(X(p.x) + 8) + '" y="' + f(Y(p.y) - 8) + '" font-size="12" font-weight="600" fill="' + COL.ink + '" paint-order="stroke" stroke="#F2F5EF" stroke-width="3">' + esc(label) + '</text>';
    });
    // centro
    if (o.center && n >= 2) {
      var c = Geo.toXY(fr, o.center);
      out += '<circle cx="' + f(X(c.x)) + '" cy="' + f(Y(c.y)) + '" r="4" fill="' + COL.point + '"/><circle cx="' + f(X(c.x)) + '" cy="' + f(Y(c.y)) + '" r="9" fill="none" stroke="' + COL.point + '" stroke-width="1.4"/>';
    }
    // barra de escala
    var barM = niceLength(Math.max(spanX, spanY) * 0.35), barPx = barM * sc;
    out += '<g transform="translate(14 ' + (Hh - 16) + ')"><line x1="0" y1="0" x2="' + f(barPx) + '" y2="0" stroke="' + COL.ink + '" stroke-width="2.5"/><line x1="0" y1="-4" x2="0" y2="4" stroke="' + COL.ink + '" stroke-width="2"/><line x1="' + f(barPx) + '" y1="-4" x2="' + f(barPx) + '" y2="4" stroke="' + COL.ink + '" stroke-width="2"/><text x="' + f(barPx / 2) + '" y="-7" font-size="11" text-anchor="middle" fill="' + COL.ink + '">' + fmtLen(barM) + '</text></g>';
    // norte
    out += '<g transform="translate(' + (W - 22) + ' 26)"><path d="M0 -14 L7 8 L0 3 L-7 8 Z" fill="' + COL.ink + '"/><text y="22" font-size="11" text-anchor="middle" fill="' + COL.ink + '" font-weight="600">N</text></g>';
    return out + '</svg>';
  }

  return { staticSVG: staticSVG, mount: mount, polygonSVG: polygonSVG, legendHTML: legendHTML, worldMarkup: worldMarkup, COL: COL, S: S };
});

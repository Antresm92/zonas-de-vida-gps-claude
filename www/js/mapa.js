/* mapa.js — lógica del mapa del polígono, sin pantalla: capas base, qué se dibuja y avisos.
 * Todo lo que se puede probar sin navegador está aquí; mapview.js solo lo dibuja con Leaflet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mapa = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

  // Capas base. «calles» muestra las calles y los nombres; «satelite» muestra imágenes del terreno.
  var BASES = {
    calles: {
      id: 'calles', label: 'Calles',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    },
    satelite: {
      id: 'satelite', label: 'Satélite',
      url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
      attribution: 'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }
  };
  // Capa topográfica de OpenTopoMap: curvas de nivel y relieve sombreado (datos SRTM y OpenStreetMap). Sus mosaicos llegan hasta el nivel 17;
  // con más zoom se amplían (maxNativeZoom) en vez de quedar en blanco.
  BASES.topo = {
    id: 'topo', label: 'Topográfico',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 19, maxNativeZoom: 17,
    attribution: 'Datos: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, SRTM | Estilo: &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)'
  };
  // Calles y nombres que se pueden poner encima del satélite (vista híbrida)
  var REFERENCE = [
    { id: 'transporte', url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 },
    { id: 'lugares', url: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 }
  ];

  var LABEL_MIN_ZOOM = 15;           // con menos zoom no se escriben los nombres, para que no se amontonen
  var COLOMBIA = { lat: 4.57, lon: -74.3, zoom: 5 };   // vista inicial cuando todavía no hay nada que mostrar
  var TILE_ERRORS_BEFORE_NOTICE = 3;

  // Gestos del mapa (menú ⋮). Mantener pulsado un punto HOLD_MS (sin moverse más de HOLD_SLOP_PX) lo «levanta» para arrastrarlo;
  // dos toques cortos seguidos (≤ DOUBLE_TAP_MS y a ≤ DOUBLE_TAP_SLOP_PX uno del otro) abren su ficha.
  var MODES = ['add', 'move'];                // add: «Ingresar puntos» · move: «Posición manual»
  var HOLD_MS = 1000, HOLD_SLOP_PX = 10,        // HOLD_MS: tiempo fijo para levantar un punto (ya no se ajusta)
 DOUBLE_TAP_MS = 350, DOUBLE_TAP_SLOP_PX = 24, TAP_SLOP_PX = 8;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  // El color propio de un punto (el que se elige en su ficha); si no tiene uno válido, el de los puntos del proyecto
  function pointColor(q, dflt) { return q && typeof q.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.color) ? q.color : dflt; }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }

  function baseId(id) { return Object.prototype.hasOwnProperty.call(BASES, id) ? id : 'calles'; }

  // «P3 · 386 m»: nombre y altitud (si hay). fmt: cómo escribir el número (por defecto, entero).
  function pointLabel(pt, fmt) {
    var name = pt && pt.name ? String(pt.name) : '';
    if (!pt || !isNum(pt.alt)) return name;
    var n = typeof fmt === 'function' ? fmt(pt.alt) : String(Math.round(pt.alt));
    return (name ? name + ' · ' : '') + n + ' m';
  }

  // Último punto marcado: el de fecha más reciente; si no hay fechas, el último de la lista.
  function lastPoint(points) {
    var best = null, bestTs = -Infinity;
    (points || []).forEach(function (p) {
      if (!validLL(p)) return;
      var ts = isNum(p.ts) ? p.ts : -Infinity;
      if (best === null || ts >= bestTs) { best = p; bestTs = ts; }
    });
    return best;
  }

  function visibleLayers(layers) {
    return (layers || []).filter(function (l) { return l && l.visible !== false && Array.isArray(l.points) && l.points.some(validLL); });
  }

  function ring(points) {
    return (points || []).filter(validLL).map(function (p) { return [p.lat, p.lon]; });
  }

  // Cuadro que contiene todo lo que se dibuja: { south, west, north, east } o null si no hay nada.
  function extent(points, layers) {
    var s = Infinity, w = Infinity, n = -Infinity, e = -Infinity, any = false;
    function add(p) {
      if (!validLL(p)) return;
      any = true;
      if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
      if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon;
    }
    (points || []).forEach(add);
    visibleLayers(layers).forEach(function (l) { l.points.forEach(add); });
    return any ? { south: s, west: w, north: n, east: e } : null;
  }

  // Lo que se dibuja en el mapa para un proyecto.
  //  opts.polyActive: ¿se unen los puntos en un polígono?   opts.bad: los lados se cruzan   opts.fmt: cómo escribir la altitud
  function shapes(project, opts) {
    opts = opts || {};
    var p = project || {}, pts = (p.points || []).filter(validLL), color = p.mainColor || '#2F8F4E';
    var out = { color: color, polygon: null, points: [], layers: [] };
    if (opts.polyActive !== false && pts.length >= 2) {
      out.polygon = { latlngs: ring(pts), closed: pts.length >= 3, bad: !!opts.bad };
    }
    out.points = pts.map(function (q, i) {
      return { id: q.id, name: q.name || ('P' + (i + 1)), label: pointLabel(q, opts.fmt) || ('P' + (i + 1)), lat: q.lat, lon: q.lon, color: pointColor(q, color) };
    });
    out.layers = visibleLayers(p.layers).map(function (l) {
      var kind = l.kind === 'polygon' || l.kind === 'line' ? l.kind : 'points';
      var o = { id: l.id, name: l.name || '', kind: kind, color: l.color || '#2980B9', latlngs: ring(l.points), holes: [] };
      if (kind === 'polygon' && Array.isArray(l.holes)) o.holes = l.holes.map(ring).filter(function (h) { return h.length >= 3; });
      return o;
    });
    return out;
  }

  function labelsVisible(zoom) { return isNum(zoom) && zoom >= LABEL_MIN_ZOOM; }

  // Texto de aviso cuando el mapa de fondo no puede cargar. state: { online, errors }. '' si no hace falta avisar.
  function tileNotice(state) {
    state = state || {};
    if (state.online === false) return 'Sin conexión: el mapa de fondo no se puede cargar. Tus puntos y el polígono se ven igual.';
    if ((state.errors || 0) >= TILE_ERRORS_BEFORE_NOTICE) return 'El mapa de fondo no está cargando. Revisa tu conexión; tus puntos y el polígono se ven igual.';
    return '';
  }

  // Posición del GPS lista para dibujar, o null si no sirve.
  function fixShape(fix) {
    if (!validLL(fix)) return null;
    return { lat: fix.lat, lon: fix.lon, acc: isNum(fix.acc) && fix.acc > 0 ? fix.acc : null };
  }

  /* ---------- Modos del mapa y gestos ---------- */
  function modeId(m) { return MODES.indexOf(m) >= 0 ? m : ''; }
  // Solo una casilla a la vez: tocar la que ya está activa la apaga; tocar la otra pasa a esa.
  function toggleMode(current, wanted) { var w = modeId(wanted); return !w || w === modeId(current) ? '' : w; }
  // Aviso corto del modo activo: va sobre el mapa y no debe tapar mucho (los puntos de debajo se siguen pudiendo tocar)
  function modeText(mode) {
    if (mode === 'add') return 'Ingresar puntos: toca el mapa.';
    if (mode === 'move') return 'Posición manual: mantén pulsado un punto ' + HOLD_MS / 1000 + ' s.';
    return '';
  }

  function pxDist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  // ¿Este toque repite al anterior (muy seguido y casi en el mismo sitio)? a y b: { x, y, t } con t en milisegundos.
  function isRepeatTap(a, b) { return !!a && !!b && b.t - a.t <= DOUBLE_TAP_MS && pxDist(a, b) <= DOUBLE_TAP_SLOP_PX; }

  // Los mismos puntos, con las coordenadas del que tiene ese id cambiadas (para ver el área y el perímetro mientras se arrastra).
  function withMoved(points, id, lat, lon) {
    return (points || []).map(function (p) { return p && p.id === id ? Object.assign({}, p, { lat: lat, lon: lon }) : p; });
  }

  // Gestos sobre un punto con «Posición manual». Es una máquina de estados sin pantalla ni reloj propios: el tiempo llega por
  // o.setTimer(fn, ms) / o.clearTimer(id) / o.now() (así se prueba en Node) y los avisos salen por o.onHold, o.onMove, o.onDrop, o.onAbort y o.onDouble.
  //  · mantener pulsado HOLD_MS sin moverse más de HOLD_SLOP_PX → el punto queda «levantado» (onHold); desde ahí cada movimiento llega a onMove y al soltar, a onDrop;
  //  · moverse más de HOLD_SLOP_PX antes de que pase el tiempo → se abandona (el dedo estaba arrastrando el mapa);
  //  · dos toques cortos seguidos sobre el mismo punto → onDouble.
  function pointGesture(o) {
    var cur = null, last = null, timer = null;
    function stopTimer() { if (timer !== null) { o.clearTimer(timer); timer = null; } }
    return {
      down: function (id, x, y) {
        if (cur) return;
        cur = { id: id, x: x, y: y, px: x, py: y, lifted: false, moved: false };
        timer = o.setTimer(function () { timer = null; cur.lifted = true; o.onHold(cur.id, cur.px, cur.py); }, HOLD_MS);
      },
      move: function (x, y) {
        if (!cur) return;
        cur.px = x; cur.py = y;
        if (cur.lifted) { cur.moved = true; o.onMove(cur.id, x, y); return; }
        if (pxDist({ x: x, y: y }, cur) > HOLD_SLOP_PX) { stopTimer(); cur = null; last = null; }
      },
      up: function (x, y) {
        if (!cur) return;
        var c = cur; cur = null; stopTimer();
        if (c.lifted) { last = null; o.onDrop(c.id, x, y, c.moved); return; }
        var tap = { id: c.id, x: x, y: y, t: o.now() };
        if (last && last.id === c.id && isRepeatTap(last, tap)) { last = null; o.onDouble(c.id); }
        else last = tap;
      },
      cancel: function () {
        stopTimer();
        var c = cur; cur = null; last = null;
        if (c && c.lifted) o.onAbort(c.id);
      },
      state: function () { return !cur ? '' : cur.lifted ? 'lifted' : 'press'; }
    };
  }

  return {
    MODES: MODES, HOLD_MS: HOLD_MS, HOLD_SLOP_PX: HOLD_SLOP_PX, TAP_SLOP_PX: TAP_SLOP_PX, DOUBLE_TAP_MS: DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX: DOUBLE_TAP_SLOP_PX,
    pointColor: pointColor, modeId: modeId, toggleMode: toggleMode, modeText: modeText, isRepeatTap: isRepeatTap, withMoved: withMoved, pointGesture: pointGesture,
    BASES: BASES, REFERENCE: REFERENCE, LABEL_MIN_ZOOM: LABEL_MIN_ZOOM, COLOMBIA: COLOMBIA, TILE_ERRORS_BEFORE_NOTICE: TILE_ERRORS_BEFORE_NOTICE,
    baseId: baseId, pointLabel: pointLabel, lastPoint: lastPoint, visibleLayers: visibleLayers, extent: extent, shapes: shapes,
    labelsVisible: labelsVisible, tileNotice: tileNotice, fixShape: fixShape
  };
});

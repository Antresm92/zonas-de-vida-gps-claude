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

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
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
      return { id: q.id, name: q.name || ('P' + (i + 1)), label: pointLabel(q, opts.fmt) || ('P' + (i + 1)), lat: q.lat, lon: q.lon, color: color };
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

  return {
    BASES: BASES, REFERENCE: REFERENCE, LABEL_MIN_ZOOM: LABEL_MIN_ZOOM, COLOMBIA: COLOMBIA, TILE_ERRORS_BEFORE_NOTICE: TILE_ERRORS_BEFORE_NOTICE,
    baseId: baseId, pointLabel: pointLabel, lastPoint: lastPoint, visibleLayers: visibleLayers, extent: extent, shapes: shapes,
    labelsVisible: labelsVisible, tileNotice: tileNotice, fixShape: fixShape
  };
});

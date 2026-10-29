/* satelite.js — croquis con imagen de fondo para el informe: el satelital (imágenes de Esri) y el topográfico (OpenTopoMap), cada uno con el polígono,
 * los nombres, las medidas de los lados, el norte y la escala. El nombre del archivo viene de la primera versión, que solo tenía el satelital.
 * La imagen se baja una vez (necesita internet), se arma en un lienzo y se guarda dentro del informe como imagen JPEG en base 64, igual que hace
 * la otra app: el informe se ve igual sin conexión. plan() y overlay() son cuentas y dibujo puros (se prueban en Node); render() baja los
 * mosaicos y solo funciona en el navegador (se le pueden pasar piezas de mentira para probarlo). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./fmt.js'), require('./mapa.js'));
  else root.Satelite = factory(root.Geo, root.Fmt, root.Mapa);
})(typeof self !== 'undefined' ? self : this, function (Geo, Fmt, Mapa) {
  'use strict';

  var TILE = 256, WIDTH = 768, HEIGHT = 512;     // la imagen mide 3 × 2 mosaicos: se piden 12 como máximo
  var PAD = 70;                                  // margen entre lo dibujado y el borde de la imagen (px)
  var MAX_ZOOM = 18, MIN_ZOOM = 3;
  var TIMEOUT_MS = 20000;
  var RES0 = 2 * Math.PI * 6378137 / TILE;       // metros por píxel en el ecuador con zoom 0
  var STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  var YELLOW = '#FFD60A', ORANGE = '#F57C00', RED = '#E53935', INK = '#0E2418';
  var ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics y la comunidad de usuarios GIS';
  var CAPTION = 'Imagen satelital de Esri (fuentes: ' + ATTRIBUTION + '), guardada dentro de este informe para uso personal o interno. ' +
    'Puede tener meses o años de antigüedad y, en zonas rurales, menos detalle. Incluye norte y escala.';
  var TOPO_ATTRIBUTION = 'OpenStreetMap contributors, SRTM y OpenTopoMap (CC-BY-SA)';
  var TOPO_CAPTION = 'Mapa topográfico de OpenTopoMap (datos de OpenStreetMap contributors y SRTM; estilo de OpenTopoMap, licencia CC-BY-SA), ' +
    'guardado dentro de este informe. Se puede compartir citando la fuente y con la misma licencia. ' +
    'Las curvas de nivel salen de datos SRTM y son aproximadas: no son las altitudes de tus puntos GPS. Incluye norte y escala.';
  // Las dos versiones: de qué capa del mapa salen los mosaicos, hasta qué nivel de zoom existen y qué texto lleva cada una
  var KINDS = {
    satelite: { id: 'satelite', base: 'satelite', maxZoom: 18, attribution: ATTRIBUTION, caption: CAPTION,
      credit: '© Esri, Maxar, Earthstar Geographics', aria: 'Croquis satelital del polígono con sus puntos, medidas, norte y escala' },
    topo: { id: 'topo', base: 'topo', maxZoom: 17, attribution: TOPO_ATTRIBUTION, caption: TOPO_CAPTION,
      credit: '© OpenStreetMap contributors, SRTM | OpenTopoMap (CC-BY-SA)', aria: 'Croquis topográfico del polígono con sus puntos, medidas, norte y escala' }
  };
  function kindOf(k) { return Object.prototype.hasOwnProperty.call(KINDS, k) ? k : 'satelite'; }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(n) { return String(Math.round(n * 10) / 10); }
  function color(c, fallback) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback; }

  // Proyección web Mercator en píxeles del mapa completo para un zoom dado
  function worldX(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function worldY(lat, z) {
    var la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * TILE * Math.pow(2, z);
  }

  function niceLength(maxM) {
    var best = STEPS[0];
    STEPS.forEach(function (s) { if (s <= maxM) best = s; });
    return best;
  }

  // Qué mosaicos hacen falta y dónde cae cada punto en la imagen. opts.kind: 'satelite' (por defecto) o 'topo'. opts.maxZoom: para pruebas.
  function plan(points, layers, opts) {
    opts = opts || {};
    var kind = kindOf(opts.kind), cfg = KINDS[kind];
    var maxZ = opts.maxZoom || cfg.maxZoom;
    var ext = Mapa.extent(points, layers);
    if (!ext) return { ok: false, reason: 'no hay puntos para dibujar' };
    // Se busca el zoom más alto en que todo cabe dentro de la imagen, dejando margen
    var w0 = worldX(ext.east, 0) - worldX(ext.west, 0), h0 = worldY(ext.south, 0) - worldY(ext.north, 0);
    var z = maxZ;
    if (w0 > 0 || h0 > 0) {
      var zw = w0 > 0 ? Math.log((WIDTH - 2 * PAD) / w0) / Math.LN2 : Infinity;
      var zh = h0 > 0 ? Math.log((HEIGHT - 2 * PAD) / h0) / Math.LN2 : Infinity;
      z = Math.min(maxZ, Math.floor(Math.min(zw, zh)));
    }
    z = Math.max(MIN_ZOOM, z);
    var n = Math.pow(2, z);
    var left = (worldX(ext.west, z) + worldX(ext.east, z)) / 2 - WIDTH / 2;
    var top = (worldY(ext.north, z) + worldY(ext.south, z)) / 2 - HEIGHT / 2;
    var tiles = [];
    for (var ty = Math.floor(top / TILE); ty <= Math.floor((top + HEIGHT - 1) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;                       // más arriba del polo norte o más abajo del sur no hay mapa
      for (var tx = Math.floor(left / TILE); tx <= Math.floor((left + WIDTH - 1) / TILE); tx++) {
        var x = ((tx % n) + n) % n;                          // el mapa da la vuelta al mundo
        tiles.push({ x: x, y: ty, z: z, dx: tx * TILE - left, dy: ty * TILE - top,
          url: Mapa.BASES[cfg.base].url.replace('{z}', z).replace('{y}', ty).replace('{x}', x) });
      }
    }
    var midLat = (ext.north + ext.south) / 2;
    return {
      ok: true, kind: kind, z: z, width: WIDTH, height: HEIGHT, tiles: tiles,
      mpp: RES0 * Math.cos(midLat * Math.PI / 180) / n,       // metros por píxel de la imagen
      project: function (lat, lon) { return { x: worldX(lon, z) - left, y: worldY(lat, z) - top }; }
    };
  }

  // Lo que se dibuja encima de la imagen: capas importadas, polígono, lados, puntos, centro, norte, escala y atribución.
  // o: { points, layers, center, bad }
  function overlay(pl, o) {
    o = o || {};
    var pts = (o.points || []).filter(validLL), n = pts.length;
    var xy = pts.map(function (p) { return pl.project(p.lat, p.lon); });
    function pathOf(q, close) { return q.map(function (p, i) { return (i ? 'L' : 'M') + f(p.x) + ' ' + f(p.y); }).join(' ') + (close ? ' Z' : ''); }
    var s = '';
    Mapa.visibleLayers(o.layers).forEach(function (l) {
      var q = l.points.filter(validLL).map(function (p) { return pl.project(p.lat, p.lon); }), col = color(l.color, '#2980B9');
      if (l.kind === 'polygon' && q.length >= 3) {
        var d = pathOf(q, true);
        (l.holes || []).forEach(function (h) { var hq = h.filter(validLL).map(function (p) { return pl.project(p.lat, p.lon); }); if (hq.length >= 3) d += ' ' + pathOf(hq, true); });
        s += '<path d="' + d + '" fill-rule="evenodd" fill="' + col + '" fill-opacity="0.22" stroke="#fff" stroke-opacity="0.9" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="' + d + '" fill-rule="evenodd" fill="none" stroke="' + col + '" stroke-width="2.6" stroke-linejoin="round"/>';
      } else if ((l.kind === 'line' || l.kind === 'polygon') && q.length >= 2) {
        s += '<path d="' + pathOf(q, false) + '" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="' + pathOf(q, false) + '" fill="none" stroke="' + col + '" stroke-width="2.6" stroke-dasharray="7 5" stroke-linejoin="round"/>';
      } else {
        q.forEach(function (p) { s += '<circle cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="5.5" fill="' + col + '" stroke="#fff" stroke-width="2"/>'; });
      }
    });
    var line = o.bad ? '#FF5A5A' : YELLOW;
    if (n >= 2) {
      var d2 = pathOf(xy, n >= 3);
      s += '<path d="' + d2 + '" fill="none" stroke="' + INK + '" stroke-opacity="0.55" stroke-width="6.5" stroke-linejoin="round"/>';
      s += '<path d="' + d2 + '" fill="' + (n >= 3 ? line : 'none') + '" fill-opacity="0.13" stroke="' + line + '" stroke-width="3.2" stroke-linejoin="round"/>';
    }
    if (n >= 2 && n <= 12) {
      var segs = n >= 3 ? n : n - 1;
      for (var i = 0; i < segs; i++) {
        var a = pts[i], b = pts[(i + 1) % n], A = xy[i], B = xy[(i + 1) % n];
        s += '<text x="' + f((A.x + B.x) / 2) + '" y="' + f((A.y + B.y) / 2 - 7) + '" font-size="13" font-weight="700" text-anchor="middle" fill="#fff" paint-order="stroke" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round">' +
          esc(Fmt.dist(Geo.distance(a.lat, a.lon, b.lat, b.lon))) + '</text>';
      }
    }
    if (o.center && validLL(o.center) && n >= 2) {
      var c = pl.project(o.center.lat, o.center.lon);
      s += '<circle cx="' + f(c.x) + '" cy="' + f(c.y) + '" r="4.5" fill="' + RED + '" stroke="#fff" stroke-width="1.6"/><circle cx="' + f(c.x) + '" cy="' + f(c.y) + '" r="10" fill="none" stroke="' + RED + '" stroke-width="2.4"/>';
    }
    var named = n <= 40;
    pts.forEach(function (p, i) {
      s += '<circle cx="' + f(xy[i].x) + '" cy="' + f(xy[i].y) + '" r="6.5" fill="' + ORANGE + '" stroke="#fff" stroke-width="2.2"/>';
      if (named) s += '<text x="' + f(xy[i].x + 10) + '" y="' + f(xy[i].y - 9) + '" font-size="14" font-weight="700" fill="#fff" paint-order="stroke" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round">' + esc(p.name || ('P' + (i + 1))) + '</text>';
    });
    // Norte (arriba a la derecha) y escala (abajo a la izquierda)
    s += '<g transform="translate(' + (pl.width - 30) + ' 38)"><path d="M0 -20 L10 12 L0 5 L-10 12 Z" fill="#fff" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/><text y="32" font-size="14" font-weight="700" text-anchor="middle" fill="#fff" paint-order="stroke" stroke="' + INK + '" stroke-width="4">N</text></g>';
    var barM = niceLength(pl.width * 0.28 * pl.mpp), barPx = barM / pl.mpp;
    s += '<g transform="translate(18 ' + (pl.height - 30) + ')"><line x1="0" y1="0" x2="' + f(barPx) + '" y2="0" stroke="' + INK + '" stroke-width="7" stroke-linecap="round"/><line x1="0" y1="0" x2="' + f(barPx) + '" y2="0" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>' +
      '<text x="' + f(barPx / 2) + '" y="-10" font-size="13" font-weight="700" text-anchor="middle" fill="#fff" paint-order="stroke" stroke="' + INK + '" stroke-width="4">' + esc(barM >= 1000 ? (barM / 1000) + ' km' : barM + ' m') + '</text></g>';
    s += '<text x="' + (pl.width - 8) + '" y="' + (pl.height - 8) + '" font-size="11" text-anchor="end" fill="#fff" paint-order="stroke" stroke="' + INK + '" stroke-width="3.2" stroke-linejoin="round">' + esc(KINDS[kindOf(pl.kind)].credit) + '</text>';
    return s;
  }

  // Dibujo final: la imagen (JPEG en base 64) y encima lo dibujado. Si lo recibido no es una imagen JPEG en base 64, no dibuja nada.
  function svg(pl, dataUri, o) {
    if (!pl || !pl.ok || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUri || '')) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + pl.width + ' ' + pl.height + '" width="100%" role="img" aria-label="' + esc(KINDS[kindOf(pl.kind)].aria) + '" font-family="system-ui, -apple-system, Roboto, sans-serif">' +
      '<image href="' + dataUri + '" x="0" y="0" width="' + pl.width + '" height="' + pl.height + '"/>' + overlay(pl, o) + '</svg>';
  }

  // Huella de lo que se dibuja: si cambia, el croquis ya preparado deja de servir
  function signature(project) {
    var p = project || {};
    return JSON.stringify([p.id, (p.points || []).filter(validLL).map(function (q) { return [q.lat, q.lon, q.name || '']; }),
      Mapa.visibleLayers(p.layers).map(function (l) { return [l.id, l.kind, l.color, l.points.length]; })]);
  }

  /* ---------- Descarga (solo navegador) ---------- */
  function loadTile(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';                    // sin este permiso del servidor no se pueden leer los píxeles para guardar la imagen
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('mosaico')); };
      img.src = url;
    });
  }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Baja los mosaicos y arma la imagen. Resuelve con 'data:image/jpeg;base64,…' o rechaza con un Error cuyo mensaje explica el motivo.
  // deps (para pruebas): { loadTile(url), makeCanvas(w, h), timeoutMs }
  function render(pl, deps) {
    deps = deps || {};
    var load = deps.loadTile || loadTile, mk = deps.makeCanvas || makeCanvas, limit = deps.timeoutMs || TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var canvas = mk(pl.width, pl.height), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#C8D4C0'; ctx.fillRect(0, 0, pl.width, pl.height);
      var total = pl.tiles.length, done = 0, failed = 0, over = false;
      var timer = setTimeout(function () { if (!over) { over = true; reject(new Error('tardó demasiado en descargar las imágenes')); } }, limit);
      pl.tiles.forEach(function (t) {
        load(t.url).then(function (img) { ctx.drawImage(img, Math.round(t.dx), Math.round(t.dy), TILE, TILE); }, function () { failed++; }).then(function () {
          if (++done < total || over) return;
          over = true; clearTimeout(timer);
          if (failed === total) return reject(new Error('no se pudieron descargar las imágenes: revisa la conexión a internet; si la tienes, el servicio de imágenes puede estar caído o no permitir guardarlas en el informe'));
          if (failed) return reject(new Error('no se pudieron descargar ' + failed + ' de ' + total + ' imágenes'));
          try { resolve(canvas.toDataURL('image/jpeg', 0.82)); }
          catch (e) { reject(new Error('el servicio de imágenes no permite guardarlas dentro del informe')); }
        });
      });
    });
  }

  return { plan: plan, overlay: overlay, svg: svg, render: render, signature: signature, niceLength: niceLength,
           worldX: worldX, worldY: worldY, KINDS: KINDS, kindOf: kindOf, CAPTION: CAPTION, ATTRIBUTION: ATTRIBUTION, WIDTH: WIDTH, HEIGHT: HEIGHT, TILE: TILE, MAX_ZOOM: MAX_ZOOM, MIN_ZOOM: MIN_ZOOM };
});

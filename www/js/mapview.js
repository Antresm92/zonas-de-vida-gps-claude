/* mapview.js — dibuja el mapa con Leaflet (que va incluido en la app, no se baja de internet).
 * Una sola instancia vive todo el tiempo: la pestaña la coloca en su sitio cada vez que se vuelve a pintar,
 * así el mapa conserva el encuadre y el zoom. Los nombres de los puntos se escriben con textContent
 * (nunca como HTML), porque los puede poner el usuario o venir de un archivo importado. */
(function (root, factory) {
  root.MapView = factory(root);
})(typeof self !== 'undefined' ? self : this, function (w) {
  'use strict';
  var L = w.L, Mapa = w.Mapa;

  function create(options) {
    options = options || {};
    var doc = w.document;
    var el = doc.createElement('div');
    el.className = 'mapa-leaflet';
    var map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true, zoomSnap: 1, worldCopyJump: true })
      .setView([Mapa.COLOMBIA.lat, Mapa.COLOMBIA.lon], Mapa.COLOMBIA.zoom);
    map.attributionControl.setPrefix('Leaflet');   // sin enlace: tocarlo dentro de la app no debe sacar al usuario de ella

    var baseLayer = null, refLayers = [];
    var state = { base: 'calles', reference: false, errors: 0, loaded: 0 };
    var drawn = L.layerGroup().addTo(map);
    var fixGroup = L.layerGroup().addTo(map);
    var model = { markers: [], polygon: null, layers: [], fix: null };

    function status() { if (typeof options.onStatus === 'function') options.onStatus({ errors: state.errors, loaded: state.loaded }); }
    function watchTiles(layer) {
      layer.on('tileerror', function () { state.errors++; status(); });
      layer.on('tileload', function () { state.loaded++; if (state.errors) { state.errors = 0; status(); } });
      return layer;
    }
    function tileLayer(def) {
      return watchTiles(L.tileLayer(def.url, { maxZoom: def.maxZoom, attribution: def.attribution || '', crossOrigin: false }));
    }

    function setBase(id, reference) {
      id = Mapa.baseId(id);
      reference = id === 'satelite' && !!reference;
      if (baseLayer && state.base === id && state.reference === reference) return;
      if (!baseLayer || state.base !== id) {
        if (baseLayer) map.removeLayer(baseLayer);
        baseLayer = tileLayer(Mapa.BASES[id]).addTo(map);
        baseLayer.bringToBack();
        state.errors = 0;
      }
      refLayers.forEach(function (l) { map.removeLayer(l); });
      refLayers = [];
      if (reference) refLayers = Mapa.REFERENCE.map(function (d) { return tileLayer(d).addTo(map); });
      state.base = id; state.reference = reference;
      status();
    }

    function markerIcon(m) {
      var root = doc.createElement('div');
      var dot = doc.createElement('span'), lab = doc.createElement('span');
      dot.className = 'mk-dot'; dot.style.background = m.color;
      lab.className = 'mk-lab'; lab.textContent = m.label;
      root.appendChild(dot); root.appendChild(lab);
      return L.divIcon({ className: 'mk', html: root, iconSize: [0, 0] });
    }

    function draw(shapes) {
      drawn.clearLayers();
      model = { markers: [], polygon: null, layers: [], fix: model.fix };
      shapes.layers.forEach(function (l) {
        var style = { color: l.color, weight: 3, opacity: 0.95, interactive: false };
        if (l.kind === 'polygon' && l.latlngs.length >= 3) {
          L.polygon([l.latlngs].concat(l.holes), { color: l.color, weight: 3, fillColor: l.color, fillOpacity: 0.18, interactive: false }).addTo(drawn);
        } else if (l.kind === 'line' && l.latlngs.length >= 2) {
          L.polyline(l.latlngs, style).addTo(drawn);
        } else if (l.kind === 'points') {
          l.latlngs.forEach(function (ll) { L.circleMarker(ll, { radius: 6, color: '#FFFFFF', weight: 2, fillColor: l.color, fillOpacity: 1, interactive: false }).addTo(drawn); });
        }
        model.layers.push({ id: l.id, kind: l.kind, color: l.color, vertices: l.latlngs.length });
      });
      if (shapes.polygon) {
        var bad = shapes.polygon.bad, col = bad ? '#C42D34' : shapes.color;
        if (shapes.polygon.closed) L.polygon(shapes.polygon.latlngs, { color: col, weight: 3, fillColor: col, fillOpacity: bad ? 0.14 : 0.2, interactive: false }).addTo(drawn);
        else L.polyline(shapes.polygon.latlngs, { color: col, weight: 3, interactive: false }).addTo(drawn);
        model.polygon = { vertices: shapes.polygon.latlngs.length, closed: shapes.polygon.closed, bad: bad, color: col };
      }
      shapes.points.forEach(function (m) {
        L.marker([m.lat, m.lon], { icon: markerIcon(m), interactive: false, keyboard: false }).addTo(drawn);
        model.markers.push({ id: m.id, label: m.label, lat: m.lat, lon: m.lon, color: m.color });
      });
      syncLabels();
    }

    function syncLabels() { el.classList.toggle('labels-off', !Mapa.labelsVisible(map.getZoom())); }
    map.on('zoomend', syncLabels);

    // Leaflet ignora en silencio cualquier cambio de vista que llegue mientras anima un zoom (el de los botones + y −, o el de pellizcar).
    // Para que «Último punto», «Mi posición» o un nuevo encuadre no se pierdan, se esperan a que termine esa animación.
    function whenIdle(fn) { if (map._animatingZoom) map.once('zoomend', fn); else fn(); }

    // insets.bottom: alto del borde de abajo que está tapado por las herramientas
    function fit(ext, insets) {
      whenIdle(function () {
        if (!ext) { map.setView([Mapa.COLOMBIA.lat, Mapa.COLOMBIA.lon], Mapa.COLOMBIA.zoom, { animate: false }); return; }
        if (ext.south === ext.north && ext.west === ext.east) { map.setView([ext.south, ext.west], 17, { animate: false }); return; }
        // Se deja más margen abajo y a la derecha: abajo a la izquierda están las herramientas y a la derecha caben los nombres de los puntos
        var sz = map.getSize();
        var bottom = insets && isFinite(insets.bottom) ? insets.bottom : 185;
        map.fitBounds([[ext.south, ext.west], [ext.north, ext.east]], { animate: false, maxZoom: 18,
          paddingTopLeft: [40, 40], paddingBottomRight: [Math.min(110, Math.round(sz.x * 0.28)), Math.min(bottom, Math.round(sz.y * 0.5))] });
      });
    }

    function showFix(fix) {
      fixGroup.clearLayers();
      var f = Mapa.fixShape(fix);
      model.fix = f;
      if (!f) return;
      if (f.acc) L.circle([f.lat, f.lon], { radius: f.acc, color: '#1F3FBF', weight: 1, fillColor: '#1F3FBF', fillOpacity: 0.12, interactive: false }).addTo(fixGroup);
      L.circleMarker([f.lat, f.lon], { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1F3FBF', fillOpacity: 1, interactive: false }).addTo(fixGroup);
    }

    function flyTo(lat, lon, zoom) {
      whenIdle(function () {
        var z = Math.max(map.getZoom(), zoom || 17);
        map.setView([lat, lon], Math.min(z, 19), { animate: false });
      });
    }

    return {
      el: el,
      attach: function (host) { if (el.parentNode !== host) host.appendChild(el); map.invalidateSize(); syncLabels(); },
      setBase: setBase, draw: draw, fit: fit, showFix: showFix, flyTo: flyTo,
      zoom: function () { return map.getZoom(); },
      refresh: function () { map.invalidateSize(); },
      info: function () {
        var c = map.getCenter();
        return { base: state.base, reference: state.reference, zoom: map.getZoom(), center: { lat: c.lat, lon: c.lng }, errors: state.errors, loaded: state.loaded,
                 markers: model.markers.slice(), polygon: model.polygon, layers: model.layers.slice(), fix: model.fix,
                 labelsOn: !el.classList.contains('labels-off'), attribution: (el.querySelector('.leaflet-control-attribution') || {}).textContent || '' };
      }
    };
  }

  return { create: create };
});

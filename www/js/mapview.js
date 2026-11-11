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
    // Los botones + y − van arriba a la derecha: arriba a la izquierda está el menú ⋮ del mapa.
    var map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true, zoomSnap: 1, worldCopyJump: true })
      .setView([Mapa.COLOMBIA.lat, Mapa.COLOMBIA.lon], Mapa.COLOMBIA.zoom);
    // Con el dedo un toque nunca es perfectamente quieto, y con los 3 px que trae Leaflet muchos toques contarían como arrastre y no crearían el punto.
    // Leaflet no pasa su opción clickTolerance al arrastre del mapa, así que se sube en su Draggable (si esa pieza no existe, queda el valor de Leaflet).
    if (map.dragging && map.dragging._draggable && map.dragging._draggable.options) map.dragging._draggable.options.clickTolerance = Mapa.TAP_SLOP_PX;
    L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 90 }).addTo(map);   // escala gráfica, solo en metros
    map.attributionControl.setPrefix('Leaflet');   // sin enlace: tocarlo dentro de la app no debe sacar al usuario de ella

    var baseLayer = null, refLayers = [];
    var state = { base: 'calles', reference: false, errors: 0, loaded: 0 };
    var drawn = L.layerGroup().addTo(map);
    var fixGroup = L.layerGroup().addTo(map);
    var measureGroup = L.layerGroup().addTo(map);
    var sideRefs = [], selId = null, lastFix = null, measurePts = [];
    var model = { markers: [], polygon: null, layers: [], fix: null };
    var mode = '';                 // '' · 'add' (Ingresar puntos) · 'move' (Posición manual)
    var lastShapes = null, pending = null, refs = {}, polyLayer = null, drag = null, pid = null, lastTap = null;

    function status() { if (typeof options.onStatus === 'function') options.onStatus({ errors: state.errors, loaded: state.loaded }); }
    // Más avisos: onPointTap(id) (toque simple sobre un punto) · onMapClick(ll) (toque en el mapa sin «Ingresar puntos») · onInsert(after, ll) («+» de un lado)
    //  · onUserPan() (la persona arrastró el mapa) · onView() (la vista cambió)
    // Avisos hacia la app: onTap(ll) · onPointDouble(id) · onPointDrag(id, ll|null, { y, h }) · onPointDrop(id, ll)   (y: dónde está el punto en la pantalla del mapa; h: su alto)
    function emit(name, a, b, c) { return typeof options[name] === 'function' ? options[name](a, b, c) : undefined; }
    function watchTiles(layer) {
      layer.on('tileerror', function () { state.errors++; status(); });
      layer.on('tileload', function () { state.loaded++; if (state.errors) { state.errors = 0; status(); } });
      return layer;
    }
    function tileLayer(def) {
      var opts = { maxZoom: def.maxZoom, attribution: def.attribution || '', crossOrigin: false };
      if (def.maxNativeZoom) opts.maxNativeZoom = def.maxNativeZoom;
      return watchTiles(L.tileLayer(def.url, opts));
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

    // hit: con «Posición manual» el punto lleva una zona de toque de 44 px (el punto dibujado mide 16), para poder agarrarlo con el dedo
    // Sin ningún modo, el punto también tiene zona de toque (mk-tap): un toque lo selecciona. Con «Ingresar puntos» no la tiene: el toque crea un punto.
    function markerIcon(m, hit) {
      var root = doc.createElement('div');
      var dot = doc.createElement('span'), lab = doc.createElement('span');
      dot.className = 'mk-dot'; dot.style.background = m.color;
      if (m.order) dot.textContent = String(m.order);          // puesto en el recorrido: se ve aunque los nombres estén ocultos
      lab.className = 'mk-lab'; lab.textContent = m.label;
      root.appendChild(dot); root.appendChild(lab);
      if (hit) {
        var zone = doc.createElement('span');
        zone.className = hit; zone.setAttribute('data-id', m.id);
        root.appendChild(zone);
      }
      return L.divIcon({ className: 'mk' + (m.id === selId ? ' mk-sel' : ''), html: root, iconSize: [0, 0] });
    }
    // Rótulo de un lado: su longitud y, con «Posición manual», un «+» para insertar un punto ahí
    function sideIcon(sd, plus) {
      var root = doc.createElement('div'), len = doc.createElement('span');
      len.className = 'mk-len'; len.textContent = sd.text;
      root.appendChild(len);
      if (plus) {
        var b = doc.createElement('span');
        b.className = 'mk-plus'; b.textContent = '+'; b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Insertar un punto en este lado');
        root.appendChild(b);
      }
      return L.divIcon({ className: 'mk mk-side', html: root, iconSize: [0, 0] });
    }
    // Los rótulos de los lados solo se ven cuando el lado mide lo suficiente en pantalla (si no, taparían los puntos)
    function syncSides() {
      sideRefs.forEach(function (r) {
        var node = r.marker.getElement();
        if (!node) return;
        var show = Mapa.sideShows(map.latLngToContainerPoint(r.a).distanceTo(map.latLngToContainerPoint(r.b)));
        r.label = show.label; r.plus = show.plus && r.hasPlus;
        node.classList.toggle('side-off', !show.label);
        node.classList.toggle('plus-off', !show.plus);
      });
    }

    function draw(shapes) {
      if (drag) { pending = shapes; return; }     // con un punto en el aire no se redibuja: se espera a que lo suelte
      lastShapes = shapes; pending = null;
      drawn.clearLayers();
      refs = {}; polyLayer = null; sideRefs = [];
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
        if (shapes.polygon.closed) polyLayer = L.polygon(shapes.polygon.latlngs, { color: col, weight: 3, fillColor: col, fillOpacity: bad ? 0.14 : 0.2, interactive: false }).addTo(drawn);
        else polyLayer = L.polyline(shapes.polygon.latlngs, { color: col, weight: 3, interactive: false }).addTo(drawn);
        model.polygon = { vertices: shapes.polygon.latlngs.length, closed: shapes.polygon.closed, bad: bad, color: col };
      }
      (shapes.sides || []).forEach(function (sd) {
        var plus = mode === 'move';
        var sm = L.marker(sd.mid, { icon: sideIcon(sd, plus), interactive: plus, keyboard: false, zIndexOffset: -500 }).addTo(drawn);
        if (plus) sm.on('click', function () { if (!sm.getElement().classList.contains('plus-off')) emit('onInsert', sd.after, { lat: sd.mid[0], lon: sd.mid[1] }); });
        sideRefs.push({ marker: sm, a: L.latLng(sd.a), b: L.latLng(sd.b), text: sd.text, hasPlus: plus, label: false, plus: false });
      });
      if (selId && !shapes.points.some(function (m) { return m.id === selId; })) selId = null;
      shapes.points.forEach(function (m, i) {
        var mk = L.marker([m.lat, m.lon], { icon: markerIcon(m, mode === 'move' ? 'mk-hit' : mode === '' ? 'mk-tap' : ''), interactive: mode !== 'add', keyboard: false }).addTo(drawn);
        if (mode === '') mk.on('click', function () { emit('onPointTap', m.id); });
        refs[m.id] = { marker: mk, index: i };
        model.markers.push({ id: m.id, label: m.label, lat: m.lat, lon: m.lon, color: m.color, order: m.order });
      });
      syncLabels(); syncSides(); drawLink();
    }

    /* ---------- Modos del menú ⋮ ---------- */
    // «Ingresar puntos»: un toque en el mapa crea un punto. Dos toques casi seguidos y casi en el mismo sitio cuentan como uno
    // (un doble toque sin querer no debe dejar dos puntos pegados).
    map.on('click', function (e) {
      if (mode !== 'add') { var c = e.latlng.wrap(); emit('onMapClick', { lat: c.lat, lon: c.lng }); return; }
      var tap = { x: e.containerPoint.x, y: e.containerPoint.y, t: Date.now() };
      if (Mapa.isRepeatTap(lastTap, tap)) { lastTap = tap; return; }
      var ll = e.latlng.wrap();
      // Si la app solo usó el toque para cerrar la lista (devuelve false), no cuenta como el primero de un doble toque
      if (emit('onTap', { lat: ll.lat, lon: ll.lng }) !== false) lastTap = tap;
    });

    // «Posición manual»: mantener pulsado un punto lo levanta y se arrastra; dos toques abren su ficha. La máquina de gestos está en mapa.js.
    function container(x, y) { var r = el.getBoundingClientRect(); return L.point(x - r.left, y - r.top); }
    function ringWith(id, ll) {
      var ring = lastShapes.polygon.latlngs.slice();
      ring[refs[id].index] = [ll.lat, ll.lng];
      return ring;
    }
    function endDrag() {
      drag = null;
      map.dragging.enable();
      el.classList.remove('dragging');
      emit('onPointDrag', null, null);
      if (pending) draw(pending);
    }
    var gopts = {
      setTimer: function (fn, ms) { return w.setTimeout(fn, ms); }, clearTimer: function (t) { w.clearTimeout(t); }, now: function () { return Date.now(); },
      onHold: function (id, x, y) {
        var ref = refs[id];
        var here = container(x, y), at = map.latLngToContainerPoint(ref.marker.getLatLng());
        drag = { dx: at.x - here.x, dy: at.y - here.y, from: ref.marker.getLatLng(), ll: ref.marker.getLatLng() };
        map.dragging.disable();
        clearPress();
        ref.marker.getElement().classList.add('mk-lifted');
        el.classList.add('dragging');
        if (typeof w.navigator.vibrate === 'function') w.navigator.vibrate(25);    // un toque breve avisa que el punto ya se puede arrastrar
      },
      onMove: function (id, x, y) {
        var p = container(x, y), at = L.point(p.x + drag.dx, p.y + drag.dy), ll = map.containerPointToLatLng(at);
        drag.ll = ll;
        refs[id].marker.setLatLng(ll);
        var live = emit('onPointDrag', id, { lat: ll.lat, lon: ll.lng }, { y: at.y, h: map.getSize().y });
        if (polyLayer) {
          polyLayer.setLatLngs(ringWith(id, ll));
          if (live) polyLayer.setStyle({ color: live.bad ? '#C42D34' : lastShapes.color, fillColor: live.bad ? '#C42D34' : lastShapes.color });
        }
      },
      onDrop: function (id, x, y, moved) {
        var ll = drag.ll;
        refs[id].marker.getElement().classList.remove('mk-lifted');
        endDrag();                                            // se sale del modo «en el aire» antes de avisar, para que la app pueda redibujar
        if (moved) emit('onPointDrop', id, { lat: ll.lat, lon: ll.lng });
      },
      onAbort: function (id) {
        refs[id].marker.setLatLng(drag.from);
        refs[id].marker.getElement().classList.remove('mk-lifted');
        if (polyLayer) polyLayer.setLatLngs(ringWith(id, drag.from));
        endDrag();
      },
      onDouble: function (id) { emit('onPointDouble', id); },
      onTap: function (id) { emit('onPointTap', id); }
    };
    var gesture = Mapa.pointGesture(gopts);
    // Mientras se mantiene pulsado, un anillo crece alrededor del punto durante todo el tiempo de espera (CSS), para que se vea que algo está pasando
    var pressed = null;
    function clearPress() { if (pressed) { pressed.classList.remove('mk-press'); pressed = null; } }
    function markPress(id) {
      var ref = refs[id], node = ref && ref.marker.getElement();
      if (!node) return;
      node.style.setProperty('--hold', Mapa.HOLD_MS + 'ms');
      node.classList.add('mk-press'); pressed = node;
    }
    el.addEventListener('pointerdown', function (e) {
      if (mode !== 'move' || pid !== null || !e.isPrimary || e.button > 0) return;
      var hit = e.target.closest('.mk-hit');
      if (!hit) return;
      pid = e.pointerId;
      gesture.down(hit.getAttribute('data-id'), e.clientX, e.clientY);
      markPress(hit.getAttribute('data-id'));
      el.setPointerCapture(pid);
    });
    el.addEventListener('pointermove', function (e) { if (e.pointerId === pid) { gesture.move(e.clientX, e.clientY); if (gesture.state() !== 'press') clearPress(); } });
    el.addEventListener('pointerup', function (e) { if (e.pointerId === pid) { pid = null; clearPress(); gesture.up(e.clientX, e.clientY); } });
    el.addEventListener('pointercancel', function (e) { if (e.pointerId === pid) { pid = null; clearPress(); gesture.cancel(); } });
    // Al mantener pulsado, el sistema suele abrir su menú de copiar/seleccionar: aquí no se quiere
    el.addEventListener('contextmenu', function (e) { if (mode === 'move') e.preventDefault(); });

    function setMode(m) {
      m = Mapa.modeId(m);
      if (m === mode) return;
      gesture.cancel(); pid = null; clearPress();
      mode = m; lastTap = null;
      el.classList.toggle('mode-add', m === 'add');
      el.classList.toggle('mode-move', m === 'move');
      if (m) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();   // el doble toque se usa para otra cosa (o se confunde con crear un punto)
      if (lastShapes) draw(lastShapes);                      // los puntos pasan a poderse tocar (o dejan de poder)
    }

    function syncLabels() { el.classList.toggle('labels-off', !Mapa.labelsVisible(map.getZoom())); }
    map.on('zoomend', function () { syncLabels(); syncSides(); });
    map.on('dragstart', function () { emit('onUserPan'); });
    map.on('move', function () { emit('onView'); });

    // Leaflet ignora en silencio cualquier cambio de vista que llegue mientras anima un zoom (el de los botones + y −, o el de pellizcar).
    // Para que «Último punto», «Mi posición» o un nuevo encuadre no se pierdan, se esperan a que termine esa animación.
    function whenIdle(fn) { if (map._animatingZoom) map.once('zoomend', fn); else fn(); }

    // insets.bottom: alto del borde de abajo que está tapado por las herramientas
    function fit(ext, insets) {
      whenIdle(function () {
        if (!ext) { map.setView([Mapa.COLOMBIA.lat, Mapa.COLOMBIA.lon], Mapa.COLOMBIA.zoom, { animate: false }); return; }
        if (ext.south === ext.north && ext.west === ext.east) { map.setView([ext.south, ext.west], 17, { animate: false }); return; }
        // Se deja más margen abajo y a la derecha: abajo está la barra de herramientas y a la derecha caben los nombres de los puntos; a la izquierda queda libre la columna de botones
        var sz = map.getSize();
        var bottom = insets && isFinite(insets.bottom) ? insets.bottom : 185;
        map.fitBounds([[ext.south, ext.west], [ext.north, ext.east]], { animate: false, maxZoom: 18,
          paddingTopLeft: [66, 70], paddingBottomRight: [Math.min(120, Math.round(sz.x * 0.3)), Math.min(bottom, Math.round(sz.y * 0.5))] });
      });
    }

    // Punto seleccionado: un anillo alrededor y, si hay posición del GPS, una línea punteada desde donde está la persona
    var linkLine = null;
    function drawLink() {
      if (linkLine) { map.removeLayer(linkLine); linkLine = null; }
      var ref = selId && refs[selId];
      if (ref && lastFix) linkLine = L.polyline([[lastFix.lat, lastFix.lon], ref.marker.getLatLng()], { color: '#1F3FBF', weight: 2, dashArray: '6 6', interactive: false }).addTo(map);
    }
    function select(id) {
      if (selId && refs[selId] && refs[selId].marker.getElement()) refs[selId].marker.getElement().classList.remove('mk-sel');
      selId = id && refs[id] ? id : null;
      if (selId && refs[selId].marker.getElement()) refs[selId].marker.getElement().classList.add('mk-sel');
      drawLink();
    }
    // Medir distancia: hasta dos lugares unidos por una línea
    function setMeasure(pts) {
      measurePts = (pts || []).slice(0, 2);
      measureGroup.clearLayers();
      if (measurePts.length === 2) L.polyline(measurePts.map(function (q) { return [q.lat, q.lon]; }), { color: '#B4530A', weight: 4, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(measureGroup);
      measurePts.forEach(function (q) { L.circleMarker([q.lat, q.lon], { radius: 7, color: '#FFFFFF', weight: 3, fillColor: '#B4530A', fillOpacity: 1, interactive: false }).addTo(measureGroup); });
    }

    function showFix(fix) {
      fixGroup.clearLayers();
      var f = Mapa.fixShape(fix);
      model.fix = f; lastFix = f;
      drawLink();
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
      setBase: setBase, draw: draw, fit: fit, showFix: showFix, flyTo: flyTo, setMode: setMode, select: select, setMeasure: setMeasure,
      center: function () { var c = map.getCenter().wrap(); return { lat: c.lat, lon: c.lng }; },
      zoom: function () { return map.getZoom(); },
      refresh: function () { map.invalidateSize(); },
      info: function () {
        var c = map.getCenter();
        return { mode: mode, gesture: gesture.state(), lifted: drag ? { lat: drag.ll.lat, lon: drag.ll.lng } : null, base: state.base, reference: state.reference, zoom: map.getZoom(), center: { lat: c.lat, lon: c.lng }, errors: state.errors, loaded: state.loaded,
                 markers: model.markers.slice(), polygon: model.polygon, layers: model.layers.slice(), fix: model.fix,
                 selected: selId, link: !!linkLine, measure: measurePts.length, scale: (el.querySelector('.leaflet-control-scale-line') || {}).textContent || '',
                 sides: sideRefs.map(function (r) { return { text: r.text, label: r.label, plus: r.plus }; }),
                 labelsOn: !el.classList.contains('labels-off'), attribution: (el.querySelector('.leaflet-control-attribution') || {}).textContent || '' };
      }
    };
  }

  return { create: create };
});

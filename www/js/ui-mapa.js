/* El mapa del polígono (separado de app.js en 2.28.0, sin cambiar lo que hace).
 * La vista Mapa de Polígono: dibujarlo (mapview.js con Leaflet), el menú ⋮ (ingresar puntos, posición manual, insertar y
 * reordenar), tocar, arrastrar y pegar puntos a los linderos, deshacer, «Ajustar a los linderos» (recorte.js), lo que va
 * encima (resumen, capas, pantalla completa, tarjeta del punto, avisos) y las herramientas de abajo (medir, mira y caminar
 * el lindero con el GPS).
 * Usa lo que app.js le pasa al llamarla: S y ui (el estado), $, proj, lot, view, viewLayers, lotLayers, multi, analysis,
 * esc, isNum, toast, openSheet, closeSheet, save, renderTab, addPoint, pointById, relocate, gpsStart, openEdit, openMapGuide
 * y, de los lotes (js/ui-lotes.js), hugeInfo, lockStop y pickLot. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.mapa = function (ctx) {
    var S = ctx.S, ui = ctx.ui, $ = ctx['$'], addPoint = ctx.addPoint, analysis = ctx.analysis, closeSheet = ctx.closeSheet, esc = ctx.esc, gpsStart = ctx.gpsStart, hugeInfo = ctx.hugeInfo, isNum = ctx.isNum, lockStop = ctx.lockStop, lot = ctx.lot, lotLayers = ctx.lotLayers, multi = ctx.multi, openEdit = ctx.openEdit, openMapGuide = ctx.openMapGuide, igacLayerHtml = ctx.igacLayerHtml, igacSync = ctx.igacSync, openSheet = ctx.openSheet, pickLot = ctx.pickLot, pointById = ctx.pointById, proj = ctx.proj, relocate = ctx.relocate, renderTab = ctx.renderTab, save = ctx.save, toast = ctx.toast, view = ctx.view, viewLayers = ctx.viewLayers;
    var Fmt = window.Fmt, Geo = window.Geo, MapView = window.MapView, Mapa = window.Mapa, Store = window.Store;

    /* ---------- Polígono: vista Mapa ---------- */
    // Calles o satélite, el polígono con sus puntos y cuatro herramientas. El dibujo lo hace mapview.js (Leaflet).
    var ICONS = {
      poly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
      last: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 5h11l-2.5 4 2.5 4H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
      mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
      more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="19" r="2.2" fill="currentColor"/></svg>',
      loc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      layers: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
      fit: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M12 9l3 2.2-1.1 3.6h-3.8L9 11.2z"/></svg>',
      full: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M4 4l6 6M15 4h5v5M20 4l-6 6M9 20H4v-5M4 20l6-6M15 20h5v-5M20 20l-6-6"/></svg>',
      measure: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/></svg>',
      plus: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>'
    };
    function mapaHtml() {
      var p = proj(), h = '';
      h += '<div id="mapBox" class="mapbox' + (ui.mapFull ? ' full' : '') + ' haslots' + '"><div id="mapHost" class="maphost"></div>';
      h += mapMenuHtml();
      var lk = lot();
      h += '<button id="mapNewPoly" class="mapnew" data-act="lotNewMap" aria-label="Crear polígono: un predio o un lote">＋ Polígono</button>';
      h += '<div class="maptop"><button id="mapSum" class="mapsum" data-act="mapSumTap" hidden></button>' +
        (lk.locked ? '<button id="mapLock" class="maplock" data-act="mapUnlock">🔒 Lindero de «' + esc(lk.name) + '» bloqueado · <u>Editar</u></button>' : '') + '<div id="mapNotice" class="mapnotice" role="status" hidden></div>' +
        '<div id="mapMode" class="mapmode" hidden><span id="mapModeTxt" role="status"></span><button data-act="mapMode" data-mode="">Salir</button></div>' +
        // 2.23.4: aviso de linderos, solo mientras el polígono elegido se sale de su predio o se monta sobre otro
        '<div id="mapHuge" class="mapmode mapconf" hidden><span id="mapHugeTxt" role="status"></span><button data-act="hugePoint">Ver punto</button></div>' +
        '<div id="mapConflict" class="mapmode mapconf" hidden><span id="mapConfTxt" role="status"></span><button data-act="adjustAsk">Ajustar</button></div></div>' +
        '<div id="mapLive" class="maplive" hidden></div>';
      if (ui.sampling) {
        h += '<div class="mapprog" role="status"><div class="prog"><i id="mapProgBar"></i></div><p class="small" id="mapProgTxt">Esperando la primera lectura del GPS…</p><button class="btn btn-danger" data-act="cancelMark">Cancelar</button></div>';
      }
      // Columna izquierda, bajo el menú ⋮: capas, ver todo el terreno y pantalla completa
      h += '<div class="mapside"><button class="mapbtn" data-act="mapLayers" aria-label="Capas del mapa" aria-haspopup="true" aria-expanded="false" aria-controls="mapLayersPanel">' + ICONS.layers + '</button>' +
        '<button class="mapbtn" data-act="mapFit" aria-label="Ver todo el terreno">' + ICONS.fit + '</button>' +
        '<button class="mapbtn" data-act="mapFull" aria-label="Pantalla completa" aria-pressed="' + ui.mapFull + '">' + ICONS.full + '</button>' +
        '<button class="mapbtn" id="mapUndoBtn" data-act="mapUndo" aria-label="Deshacer" disabled><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h9.5a6 6 0 0 1 0 12H9"/></svg></button></div>';
      h += '<div id="mapLayersPanel" class="maplayers" role="group" aria-label="Capa base" hidden><b>Capa base</b>';
      ['calles', 'satelite', 'topo'].forEach(function (id) {
        h += '<button data-act="mapBase" data-b="' + id + '" aria-pressed="' + (ui.mapBase === id) + '">' + esc(Mapa.BASES[id].label) + '</button>';
      });
      if (ui.mapBase === 'satelite') h += '<button class="chipbtn" data-act="mapRef" aria-pressed="' + ui.mapRef + '">Calles y nombres sobre el satélite</button>';
      h += '<b>Ver</b><button class="chipbtn" data-act="mapNames" aria-pressed="' + !!ui.mapNames + '">Nombres de los puntos</button>';   // 2.32.1: apagados por defecto
      h += igacLayerHtml();                       // «Capacidad de uso (IGAC)» encima de la base (2.31.0)
      h += '</div>';
      h += '<div class="mapcross" aria-hidden="true"></div>';
      h += '<div id="mapCard" class="mapcard" hidden></div>';
      h += '<div id="mapToolBar" class="maptoolbar" hidden></div>';
      h += '<div class="maptools" role="group" aria-label="Herramientas del mapa">' +
        '<button class="maptool" data-act="mapPoly" aria-pressed="' + ui.polyActive + '">' + ICONS.poly + '<span>' + (ui.polyActive ? 'Polígono activo' : 'Polígono inactivo') + '</span></button>' +
        '<button class="maptool" data-act="mapLast">' + ICONS.last + '<span>Último punto</span></button>' +
        '<button class="maptool" data-act="mapMeasure">' + ICONS.measure + '<span>Medir distancia</span></button>' +
        '<button class="maptool" data-act="mapMore">' + ICONS.plus + '<span>Más opciones</span></button>' +
        '<button class="maptool main" data-act="mapMark"' + (ui.sampling ? ' disabled' : '') + '>' + ICONS.mark + '<span>Marcar punto</span></button></div>';
      h += '<button class="maploc" data-act="mapMyPos" aria-label="Centrar el mapa en mi posición y seguirla" aria-pressed="' + ui.follow + '">' + ICONS.loc + '</button></div>';
      if (!p.points.length && !Mapa.visibleLayers(viewLayers(p)).length) h += '<div class="tip">Todavía no hay puntos. Pulsa «Marcar punto» para guardar tu posición con el GPS, o agrégalos en la pestaña Puntos.</div>';
      return h;
    }
    // Menú ⋮ (arriba a la izquierda): dos casillas de las que solo una puede estar activa. El estado (ui.mapMode, ui.mapMenu) lo pinta syncMapMenu().
    function mapMenuHtml() {
      return '<div class="mapmenu"><button class="mapkebab" data-act="mapMenu" aria-label="Menú del mapa" aria-haspopup="true" aria-expanded="false" aria-controls="mapMenuPanel">' + ICONS.more + '</button>' +
        '<div id="mapMenuPanel" class="mapmenu-panel" role="group" aria-label="Qué hacer al tocar el mapa" hidden>' +
        '<label class="mapopt"><input type="checkbox" data-act="mapMode" data-mode="add"><span><b>Ingresar puntos</b><small>Toca el mapa para crear un punto</small></span></label>' +
        '<label class="mapopt"><input type="checkbox" data-act="mapMode" data-mode="move"><span><b>Posición manual</b><small>Mantén pulsado un punto para moverlo; tócalo dos veces para abrir su ficha</small></span></label>' +
        '</div></div>';
    }
    function mapModeText() {
      var t = Mapa.modeText(ui.mapMode);
      return t && ui.mapMode === 'move' && !proj().points.length ? t + ' Todavía no hay puntos que mover.' : t;
    }
    function syncMapMenu() {
      var kebab = $('.mapkebab'), panel = $('#mapMenuPanel'), banner = $('#mapMode');
      if (!kebab) return;
      kebab.setAttribute('aria-expanded', String(ui.mapMenu));
      kebab.classList.toggle('on', !!ui.mapMode);
      panel.hidden = !ui.mapMenu;
      Array.prototype.forEach.call(panel.querySelectorAll('input[data-mode]'), function (i) { i.checked = i.getAttribute('data-mode') === ui.mapMode; });
      var t = mapModeText();
      banner.hidden = !t;
      $('#mapModeTxt').textContent = t;
    }
    function setMapMode(m) {
      if (m && ui.mapTool) setMapTool('');       // un modo del menú ⋮ y una herramienta de abajo no conviven
      ui.mapMode = m; ui.mapMenu = false; ui.mapLayers = false;
      if (ui.map) ui.map.setMode(m);
      syncMapMenu(); syncMapChrome();
    }
    // «Ingresar puntos»: un toque crea el punto al instante, sin altitud, y el mapa no se mueve (la persona está mirando justo ahí).
    function closeMapPanels() {
      if (!ui.mapMenu && !ui.mapLayers) return false;
      ui.mapMenu = false; ui.mapLayers = false; syncMapMenu(); syncMapChrome();
      return true;
    }
    function onMapTap(ll) {
      if (closeMapPanels()) return false;   // con una lista abierta, un toque en el mapa solo la cierra (false: no se creó nada)
      addManualAt(ll);
    }
    // Crea un punto a mano en ese lugar (toque con «Ingresar puntos», la mira o el «+» de un lado). after: posición tras la que se inserta; sin ella va al final.
    // Si el punto queda muy cerca de la esquina de otro lote, se pega a ella (así los dos lotes comparten el lindero exacto).
    // Se apaga en Herramientas › Preferencias. Devuelve la esquina ({ lat, lon, alt, name, lot }) o null.
    function snapFor(ll) {
      var p = proj();
      if (!multi(p) || Store.loadFlag('lotSnap') === false || !ui.map) return null;
      var z = ui.map.info().zoom;
      return Mapa.snapVertex(ll, lotLayers(p), Mapa.snapRadius(z, ll.lat));
    }
    function snapNote(sn) { return sn ? ' Quedó pegado a ' + sn.name + ' de «' + sn.lot + '».' : ''; }
    function addManualAt(ll, after) {
      if (lockStop()) return;
      var p = proj(), prevNext = p.nextPoint, sn = snapFor(ll);
      undoMark(isNum(after) ? 'insertar un punto' : 'crear un punto');
      var np = sn ? { lat: sn.lat, lon: sn.lon, src: 'manual' } : { lat: ll.lat, lon: ll.lon, src: 'manual' };
      if (sn && isNum(sn.alt)) { np.alt = sn.alt; np.altSrc = 'manual'; }      // la esquina compartida trae su altitud
      var pt = addPoint(np), sinAlt = isNum(pt.alt) ? '' : ' (sin altitud)';
      var msg = pt.name + ' creado' + sinAlt + '.' + snapNote(sn);
      var before = null;
      if (isNum(after) && after >= 0 && after < p.points.length - 1) {
        var a = p.points[after], b = p.points[(after + 1) % (p.points.length - 1)], an = a.name, bn = b.name;
        p.points.pop();
        // el nuevo toma el número que sigue al de antes y los demás suben uno: los nombres siguen el recorrido (2.17.2)
        before = { names: p.points.map(function (q) { return q.name; }), next: prevNext };
        var r = Mapa.insertRenumber(p.points, after, pt);
        r.renamed.forEach(function (x) { var q = pointById(x.id); if (q) q.name = x.to; });
        pt.name = r.point.name;
        p.points.splice(after + 1, 0, pt); p.nextPoint = Math.max(r.next, 1); save();
        msg = pt.name + ' insertado entre ' + an + ' y ' + bn + sinAlt + '.' + (r.renamed.length ? ' Los que siguen subieron un número (' + r.renamed[0].from + ' ahora es ' + r.renamed[0].to + ').' : '') + snapNote(sn);
      }
      ui.mapFitKey = mapKey();
      renderTab('area');
      toast(msg, { action: 'Deshacer', fn: function () {
        var i = p.points.indexOf(pt);
        if (i < 0) return;
        p.points.splice(i, 1);
        if (before) { p.points.forEach(function (q, k) { if (before.names[k] !== undefined) q.name = before.names[k]; }); p.nextPoint = before.next; }   // los nombres vuelven a ser los de antes
        else if (p.nextPoint === prevNext + 1) p.nextPoint = prevNext;   // el siguiente punto vuelve a llamarse como habría sido
        save(); renderTab(ui.tab);
      } });
      adjustCheck();
    }
    // Al soltar un punto arrastrado con «Posición manual»: queda donde se soltó y «Deshacer» lo devuelve (con su origen y su precisión de GPS de antes).
    function onPointDrop(id, ll) {
      var pt = pointById(id);
      if (!pt || Geo.haversine(pt.lat, pt.lon, ll.lat, ll.lon) < 0.5) return;
      if (lockStop()) { renderTab('area'); return; }
      var before = { lat: pt.lat, lon: pt.lon, src: pt.src, acc: pt.acc }, sn = snapFor(ll);
      undoMark('mover ' + pt.name);
      relocate(pt, sn ? sn.lat : ll.lat, sn ? sn.lon : ll.lon);
      ui.mapFitKey = mapKey();
      save(); renderTab('area');
      toast(pt.name + ' movido.' + snapNote(sn), { action: 'Deshacer', fn: function () {
        var q = pointById(id);
        if (!q) return;
        q.lat = before.lat; q.lon = before.lon; q.src = before.src; q.acc = before.acc;
        save(); renderTab(ui.tab);
      } });
      adjustCheck();
    }
    // Mientras se arrastra un punto: área, perímetro y aviso de lados cruzados al instante. Devuelve si el polígono quedaría mal.
    function onPointDrag(id, ll, pos) {
      var el = $('#mapLive'), banner = $('#mapMode');
      if (!el) return;
      if (!ll) { el.hidden = true; banner.hidden = !mapModeText(); return; }
      banner.hidden = true;      // mientras se arrastra, el aviso del modo cede su sitio a las medidas en vivo
      var pts = Mapa.withMoved(proj().points, id, ll.lat, ll.lon), unit = S.settings.areaUnit || 'ha';
      if (ui.mapSel) { ui.mapSel = null; syncMapCard(); }   // la tarjeta taparía las medidas mientras se arrastra
      var bad = Geo.selfIntersects(pts);
      var moved = pointById(id);
      el.textContent = 'Moviendo ' + (moved ? moved.name : '') + ' · ' + (pts.length >= 3 ? 'Área ' + Fmt.area(Geo.areaUnits(Geo.polygonArea(pts)), unit) + ' · Perímetro ' + Fmt.dist(Geo.perimeter(pts, true)) : 'Distancia ' + Fmt.dist(Geo.perimeter(pts, false))) +
        (bad ? ' · los lados se cruzan' : '');
      // Las medidas van arriba, salvo que el punto esté en la mitad de arriba: entonces van abajo, para no taparlo
      el.className = 'maplive' + (bad ? ' bad' : '') + (pos && pos.y < pos.h / 2 ? ' low' : '');
      el.hidden = false;
      return { bad: bad };
    }

    // Alto que tapan las herramientas de abajo (más su separación del borde): el encuadre deja ese espacio libre para que no cubran los puntos
    // Alto del borde de abajo que tapan las herramientas: la barra y, encima de ella a la derecha, el botón de «Mi posición»
    // (2.23.2: con la fila de lotes siempre arriba, el mapa es más bajo en teléfonos pequeños y los nombres de la derecha quedaban bajo ese botón)
    function toolsInset() {
      var t = $('.maptools'), box = $('#mapBox'), loc = $('.maploc'), h = t ? t.offsetHeight + 44 : 100;
      if (box && loc && loc.offsetHeight) h = Math.max(h, Math.round(box.getBoundingClientRect().bottom - loc.getBoundingClientRect().top + 8));
      return h;
    }
    // Alto del borde de arriba que tapan los botones: la franja de arriba y, a la derecha, «＋ Polígono» (para que no tape el nombre de un punto)
    function toolsTop() {
      var box = $('#mapBox'), nb = $('.mapnew'), h = 70;
      if (box && nb && nb.offsetHeight) h = Math.max(h, Math.round(nb.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 8));
      return h;
    }
    // El mapa se encuadra solo al cambiar de proyecto, al llegar los primeros datos o cuando cambia cuántos lotes tienen puntos
    // (así un lote nuevo entra en la vista); elegir otro lote no lo mueve.
    function mapKey() {
      var p = proj(), n = p.lots.filter(function (l) { return l.points.length; }).length;
      return p.id + ':' + (Mapa.extent(p.points, viewLayers(p)) ? 'con-datos' : 'vacio') + (n > 1 ? ':' + n : '');
    }
    function mountMap() {
      var host = $('#mapHost');
      if (!host) return;
      if (!window.L) { host.textContent = 'El mapa no se pudo cargar en este dispositivo.'; return; }
      var p = proj(), a = analysis();
      if (ui.mapModeFor !== p.id) {              // otro proyecto: se empieza sin ningún modo activo, sin herramienta y sin punto elegido
        ui.mapMode = ''; ui.mapMenu = false; ui.mapLayers = false; ui.mapSel = null; ui.mapModeFor = p.id;
        if (ui.mapTool && !(ui.track && ui.track.pid === p.id)) setMapTool('');
      }
      if (!ui.map) ui.map = MapView.create({ onStatus: onTileStatus, onTap: onMapTap, onPointDrag: onPointDrag, onPointDrop: onPointDrop, onPointDouble: openEdit,
        onPointTap: onPointTap, onMapClick: onMapClick, onInsert: function (after, ll) { addManualAt(ll, after); }, onUserPan: onUserPan, onView: onMapView });
      ui.map.attach(host);
      ui.map.setMode(ui.mapMode);
      ui.map.setBase(ui.mapBase, ui.mapRef);
      ui.map.setNames(ui.mapNames);
      igacSync();
      ui.map.draw(Mapa.shapes(view(p), { polyActive: ui.polyActive, bad: !!a.selfIntersects, fmt: function (n) { return Fmt.num(n, 0); }, dist: Geo.distance, fmtDist: Fmt.dist }));
      ui.map.setMeasure(ui.mapTool === 'medir' ? ui.measure : [], ui.measureClosed);
      var key = mapKey();
      if (ui.mapFitKey !== key) { ui.map.fit(Mapa.extent(p.points, viewLayers(p)), { bottom: toolsInset(), top: toolsTop() }); ui.mapFitKey = key; }   // solo al cambiar de proyecto o al llegar los primeros datos
      ui.map.showFix(ui.gpsOn ? ui.fix : null);
      updateMapNotice();
      syncMapMenu(); syncMapChrome();
      if (!ui.sheetOpen && Store.loadFlag('mapGuide') !== true) { Store.saveFlag('mapGuide', true); openMapGuide(); }   // la primera vez se explica el mapa
    }
    function onTileStatus(st) { ui.tileErrors = st.errors; updateMapNotice(); }
    function updateMapNotice() {
      var el = $('#mapNotice');
      if (!el) return;
      var t = Mapa.tileNotice({ online: navigator.onLine, errors: ui.tileErrors });
      el.textContent = t; el.hidden = !t;
    }
    function onMapFix(fix) {
      if (!ui.map) return;
      ui.map.showFix(fix);
      var seen = ui.tab === 'area' && ui.polyView === 'mapa';
      if (ui.mapFollow && seen) { ui.mapFollow = false; ui.map.flyTo(fix.lat, fix.lon, 17); }
      else if (ui.follow && seen) ui.map.flyTo(fix.lat, fix.lon, 1);       // siguiendo la posición: el mapa se mueve con la persona sin cambiar el zoom
      if (seen) { syncMapCard(true); if (ui.mapTool === 'caminar' || ui.mapTool === 'ir') syncMapTool(); }
    }
    function goLastPoint() {
      var pt = Mapa.lastPoint(proj().points);
      if (!pt) { toast('Todavía no hay puntos marcados en este proyecto.'); return; }
      ui.follow = false; syncMapChrome();
      if (ui.map) ui.map.flyTo(pt.lat, pt.lon, 18);
      toast('Último punto: ' + (pt.name || 'sin nombre') + '.');
    }
    // «Mi posición»: centra el mapa donde está la persona y lo deja siguiéndola hasta que arrastre el mapa
    function goMyPosition() {
      if (!ui.gpsOn) { gpsStart(); if (!ui.gpsOn) return; }
      ui.follow = true; syncMapChrome();
      if (ui.fix) { if (ui.map) { ui.map.showFix(ui.fix); ui.map.flyTo(ui.fix.lat, ui.fix.lon, 17); } }
      else { ui.mapFollow = true; toast('Buscando tu posición…'); }
    }
    /* ---------- Mapa: deshacer el último cambio ---------- */
    // Antes de cada cambio en los puntos se guarda cómo estaban; el botón de la columna izquierda vuelve al estado anterior, paso a paso.
    function pointsJson() { var p = proj(); return JSON.stringify({ points: p.points, nextPoint: p.nextPoint }); }
    function undoKey() { var p = proj(); return p.id + ':' + p.lotId; }
    function undoMark(label) { ui.mapUndo.push(undoKey(), label, pointsJson()); }
    function mapUndo() {
      var p = proj(), last = ui.track ? null : ui.mapUndo.pop(undoKey(), pointsJson());
      if (!last) { syncMapChrome(); return; }
      var st = JSON.parse(last.json);
      p.points = st.points; p.nextPoint = st.nextPoint;
      ui.mapFitKey = mapKey();
      save(); renderTab(ui.tab);
      toast('Se deshizo: ' + last.label + '.');
    }
    /* ---------- Ajustar a los linderos (2.21.0) ----------
     * Cuando el polígono elegido se sale de su finca o se monta sobre otro, la app pregunta una vez: «Ajustar a los linderos»
     * (lo recorta para que su borde siga el de la finca y el de los vecinos) o «Dejar sobrepuesto» (queda como está, con el aviso).
     * La pregunta sale al crear o mover un punto y solo cuando el choque es nuevo; el botón de «Polígono» la abre cuando se quiera. */
    function adjustPlan(me) {
      var P = proj(), c;
      me = me || lot(); c = Predio.conflicts(P.lots, me.id);
      if (!c) return null;
      return { c: c, r: Recorte.adjust(me.points, c.finca ? c.finca.points : null, c.others.map(function (o) { return { name: o.name, points: o.points }; })) };
    }
    function adjustNotes(r) {
      return (r.dropped ? ' Al recortarlo queda partido: se conserva el pedazo más grande y ' + (r.dropped === 1 ? 'el otro se descarta' : 'los otros ' + r.dropped + ' se descartan') + '.' : '') +
        (r.skipped.length ? ' «' + r.skipped.join('», «') + '» está por completo dentro de este polígono y no se descuenta (quedaría un hueco).' : '');
    }
    function adjustSheet() {
      var pl = adjustPlan();
      if (!pl) { toast('Este polígono ya respeta los linderos: no hay nada que ajustar.'); return; }
      var r = pl.r, ha = function (m2) { return Fmt.area(Geo.areaUnits(m2), 'ha'); };
      var h = '<p class="lead" id="adjWhat">' + esc(pl.c.text) + '</p>';
      if (r.ok) {
        h += '<p id="adjPlan">Si lo ajustas, su borde sigue ' + (pl.c.finca ? 'el del predio' : '') + (pl.c.finca && pl.c.others.length ? ' y ' : '') + (pl.c.others.length ? (pl.c.others.length === 1 ? 'el de su vecino' : 'el de sus vecinos') : '') +
          ': queda de <b>' + esc(ha(r.m2After)) + '</b> (hoy ' + esc(ha(r.m2Before)) + '). ' +
          (r.added ? 'Se ' + (r.added === 1 ? 'agrega 1 punto' : 'agregan ' + r.added + ' puntos') + ' en el lindero' : 'No se agregan puntos') +
          (r.removed ? ' y se ' + (r.removed === 1 ? 'quita 1 que quedaba' : 'quitan ' + r.removed + ' que quedaban') + ' por fuera o encima' : '') + '; los puntos se numeran de nuevo.' + esc(adjustNotes(r)) + '</p>' +
          '<div class="btns"><button class="btn btn-primary" data-act="adjustDo">Ajustar a los linderos</button><button class="btn" data-act="adjustKeep">Dejar sobrepuesto</button></div>' +
          '<p class="small muted" style="margin-top:12px">Si lo dejas sobrepuesto, la app lo sigue avisando en «Polígono» y en el reporte, y puedes ajustarlo después desde «Polígono». El ajuste se puede deshacer.</p>';
      } else {
        h += '<div class="note" id="adjNo">' + esc(r.reason) + '</div><div class="btns" style="margin-top:12px"><button class="btn" data-act="adjustKeep">Dejar como está</button></div>';
      }
      openSheet('Linderos', h);
    }
    // Después de crear o mover un punto: pregunta si el choque es nuevo (no insiste con el mismo)
    function adjustCheck() {
      var P = proj(), me = lot();
      if (ui.track || ui.sharing || !multi(P) || me.locked) return;
      var c = Predio.conflicts(P.lots, me.id), k = undoKey();
      ui.adjSeen = ui.adjSeen || {};
      if (!c) { delete ui.adjSeen[k]; return; }
      var key = Predio.conflictKey(c);
      if (ui.adjSeen[k] === key) return;
      ui.adjSeen[k] = key;
      // si se está cerrando otra hoja (la de escribir coordenadas), se espera a que termine para que no se lleve esta por delante
      var tries = 0;
      (function go() {
        if (ui.sheetOpen && tries++ < 40) { setTimeout(go, 25); return; }
        if (!ui.sheetOpen && undoKey() === k && Predio.conflicts(proj().lots, lot().id)) adjustSheet();
      })();
    }
    function adjustDo() {
      closeSheet();
      if (lockStop()) return;
      var pl = adjustPlan();
      if (!pl) return;
      if (!pl.r.ok) { toast(pl.r.reason, { err: true }); return; }
      var me = lot(), r = pl.r, before = { points: me.points, next: me.nextPoint };
      undoMark('ajustar a los linderos');
      adjustApply(me, r);
      if (ui.adjSeen) delete ui.adjSeen[undoKey()];
      ui.mapSel = null; ui.mapFitKey = mapKey();
      save(); renderTab(ui.tab);
      toast('«' + me.name + '» ajustado a los linderos: ' + Fmt.area(Geo.areaUnits(r.m2After), 'ha') + '.' + adjustNotes(r), { action: 'Deshacer', fn: function () {
        me.points = before.points; me.nextPoint = before.next; ui.mapFitKey = mapKey();
        save(); renderTab(ui.tab);
      } });
    }
    // Pone en el polígono el resultado del recorte: los puntos propios que siguen, los nuevos del lindero y la numeración
    function adjustApply(me, r) {
      var rn = Recorte.rename(r.points);
      me.points = rn.points.map(function (q) {
        if (q.id) return q;
        return { id: Store.uid(), name: q.name, lat: q.lat, lon: q.lon, alt: isNum(q.alt) ? q.alt : null, altGps: null, altSrc: isNum(q.alt) ? 'manual' : null, acc: null, altAcc: null, src: 'manual', ts: Date.now() };
      });
      me.nextPoint = rn.next;
    }
    // 2.23.0: después de importar varios lotes, los que se salen de su predio o se montan sobre otro se listan para elegir cuáles ajustar
    function adjustManyAsk(made) {
      var P = proj(), list = made.map(function (l) { return { l: l, c: Predio.conflicts(P.lots, l.id) }; }).filter(function (x) { return x.c; });
      if (!list.length) return;
      var tries = 0;
      (function go() {
        if (ui.sheetOpen && tries++ < 40) { setTimeout(go, 25); return; }
        if (ui.sheetOpen) return;
        ui.adjMany = list.map(function (x) { return x.l.id; });
        openSheet('Linderos', '<p class="lead" id="adjWhat">' + (list.length === 1 ? 'Un lote importado se sale de su predio o se monta sobre otro polígono.' : list.length + ' de los lotes importados se salen de su predio o se montan sobre otro polígono.') + '</p>' +
          '<p class="small muted" style="margin:0 0 6px">Deja marcados los que quieres ajustar a los linderos (se recortan para seguir el borde del predio y de sus vecinos); los demás quedan sobrepuestos, con el aviso.</p>' +
          '<div id="adjList">' + list.map(function (x) {
            return '<label class="repfin adjpick"><input type="checkbox" data-id="' + esc(x.l.id) + '" checked><span>' + esc(x.l.name) + ' <small class="muted">· ' + esc(x.c.text.replace('«' + x.l.name + '» ', '')) + '</small></span></label>';
          }).join('') + '</div>' +
          '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="adjustMany">Ajustar los marcados</button><button class="btn" data-act="adjustKeep">Dejar todos sobrepuestos</button></div>' +
          '<p class="small muted" style="margin-top:12px">Los que dejes así se pueden ajustar después, uno por uno, desde «Polígono» o «Más opciones» del mapa. El ajuste se puede deshacer.</p>');
      })();
    }
    function adjustMany() {
      var P = proj(), ids = [].filter.call(document.querySelectorAll('#adjList input'), function (i) { return i.checked; }).map(function (i) { return i.getAttribute('data-id'); });
      closeSheet();
      if (!ids.length) { toast('No marcaste ninguno: todos quedan sobrepuestos.'); return; }
      var before = [], done = 0, fails = [];
      ids.forEach(function (id) {
        var me = P.lots.filter(function (x) { return x.id === id; })[0], pl = me && adjustPlan(me);
        if (!me) return;
        if (!pl) { done++; return; }                     // ya quedó bien al ajustar a un vecino
        if (!pl.r.ok) { fails.push(me.name); return; }
        before.push({ l: me, points: me.points, next: me.nextPoint });
        adjustApply(me, pl.r); done++;
      });
      ui.mapSel = null; ui.mapFitKey = mapKey();
      save(); renderTab(ui.tab);
      toast((done === 1 ? '1 lote ajustado' : done + ' lotes ajustados') + ' a los linderos.' + (fails.length ? ' No se pudo con «' + fails.join('», «') + '»: quedan sobrepuestos.' : ''), before.length ? { action: 'Deshacer', fn: function () {
        before.forEach(function (b) { b.l.points = b.points; b.l.nextPoint = b.next; });
        ui.mapFitKey = mapKey(); save(); renderTab(ui.tab);
      } } : {});
    }
    function onUserPan() { if (ui.follow) { ui.follow = false; syncMapChrome(); } }
    function onMapView() { if (ui.mapTool === 'mira') { var el = $('#mapAimLL'); if (el && ui.map) { var c = ui.map.center(); el.textContent = Fmt.latlon(c.lat, c.lon); } } }

    /* ---------- Mapa: lo que va encima (resumen, capas, pantalla completa, tarjeta del punto, herramientas) ---------- */
    function mapSummary() {
      var a = analysis();
      if (a.empty) return '';
      return Mapa.summaryText(a.n, a.polygon ? Fmt.area(a.area, S.settings.areaUnit || 'ha') : '', a.n >= 2 ? Fmt.dist(a.perimeter) : '', !!a.selfIntersects);
    }
    function syncMapChrome() {
      var box = $('#mapBox');
      if (!box) return;
      var sum = $('#mapSum'), t = mapSummary();
      var crossed = !!analysis().selfIntersects;
      sum.textContent = t; sum.hidden = !t;
      sum.classList.toggle('crossed', crossed);            // con los lados cruzados el resumen es un botón que ordena los puntos
      sum.setAttribute('aria-label', crossed ? 'Los lados se cruzan. Ordenar los puntos alrededor del centro' : 'Área, perímetro y número de puntos: ' + t);
      $('#mapLayersPanel').hidden = !ui.mapLayers;
      $('[data-act="mapLayers"]').setAttribute('aria-expanded', String(ui.mapLayers));
      $('[data-act="mapFull"]').setAttribute('aria-pressed', String(ui.mapFull));
      $('.maploc').setAttribute('aria-pressed', String(ui.follow));
      box.classList.toggle('full', ui.mapFull);
      var ub = $('#mapUndoBtn'), last = ui.track ? null : ui.mapUndo.peek(undoKey(), pointsJson());   // caminando el lindero no se deshace paso a paso: el recorrido se deshace entero al terminar
      ub.disabled = !last;
      ub.setAttribute('aria-label', last ? 'Deshacer: ' + last.label : 'Deshacer (no hay cambios que deshacer)');
      var cb = $('#mapConflict');
      if (cb) {
        var cf = multi() && !lot().locked && !ui.track && !ui.mapTool ? Predio.conflicts(proj().lots, lot().id) : null;
        cb.hidden = !cf;
        if (cf) $('#mapConfTxt').textContent = '⚠ ' + cf.text.replace(/^«[^»]*» /, '').replace(/^./, function (x) { return x.toUpperCase(); });
      }
      var hb = $('#mapHuge'), hg = hugeInfo();
      if (hb) { hb.hidden = !hg || !!ui.mapTool; if (hg) $('#mapHugeTxt').textContent = '⚠ Área fuera de lo normal: ¿un punto mal escrito?'; }
      // «＋ Polígono» baja si los avisos de arriba (modo y linderos) llegan hasta él
      var nb = $('.mapnew'), mt = $('.maptop');
      if (nb && mt) nb.style.top = Math.max(118, mt.offsetTop + mt.offsetHeight + 8) + 'px';
      syncMapCard(); syncMapTool();
    }
    function applyMapFull(on) {
      ui.mapFull = !!on;
      syncMapChrome();
      if (ui.map) ui.map.refresh();
    }
    function toggleMapFull() {
      if (!ui.mapFull) { try { history.pushState({ mapfull: true }, ''); } catch (e) { /* nada */ } applyMapFull(true); return; }
      if (history.state && history.state.mapfull) history.back(); else applyMapFull(false);   // el botón Atrás del teléfono también sale
    }
    function fitAll() {
      var p = proj(), ext = Mapa.extent(p.points, viewLayers(p));
      if (!ext) { toast('Todavía no hay puntos ni capas que mostrar.'); return; }
      ui.follow = false; syncMapChrome();
      if (ui.map) ui.map.fit(ext, { bottom: toolsInset(), top: toolsTop() });
    }

    // Tarjeta del punto elegido (un toque sobre él). relOnly: solo se actualiza la línea de la distancia (llega con cada lectura del GPS).
    function syncMapCard(relOnly) {
      var el = $('#mapCard'), box = $('#mapBox');
      if (!el) return;
      var pt = ui.mapSel ? pointById(ui.mapSel) : null;
      if (!pt) {
        if (relOnly) return;
        ui.mapSel = null; el.hidden = true; el.innerHTML = ''; box.classList.remove('has-card');
        if (ui.map) ui.map.select(ui.mapTool === 'ir' ? ui.navId : null);   // yendo hacia un punto, sigue marcado y unido con la posición
        return;
      }
      var rel = ui.gpsOn ? Mapa.relText(ui.fix, pt, Fmt.dist) : '';
      if (relOnly) { var r = $('#mapCardRel'); if (r) { r.textContent = rel; r.hidden = !rel; } return; }
      var ord = Mapa.orderOf(proj().points, pt.id);
      var src = pt.src === 'gps' ? 'GPS' + (isNum(pt.acc) ? ' ±' + Math.round(pt.acc) + ' m' : '') : 'a mano';
      // Arriba a la derecha: el puesto del punto en el recorrido y dos flechas para pasarlo antes o después (así la tarjeta no crece y tapa menos mapa)
      el.innerHTML = '<button class="mapcard-x" data-act="mapCardClose" aria-label="Cerrar la tarjeta del punto">×</button>' +
        '<div class="mapcard-order" role="group" aria-label="Orden en el recorrido">' +
        // Las flechas solo funcionan con la casilla marcada (2.17.2): así un toque por descuido no cambia el orden. Viene desmarcada cada vez
        // que se abre la app y, una vez marcada, vale para todos los polígonos hasta que se desmarque.
        '<label class="mapcard-ordchk"><input type="checkbox" id="mapOrderOn" data-act="mapOrderToggle"' + (ui.orderEdit ? ' checked' : '') + ' aria-label="Permitir cambiar el orden de los puntos con las flechas"><span>Orden</span></label>' +
        '<button data-act="mapCardOrder" data-d="-1" aria-label="Antes: pasar este punto un puesto antes en el recorrido"' + (ord.first || !ui.orderEdit ? ' disabled' : '') + '>◀</button>' +
        '<span id="mapCardOrder">' + ord.pos + ' de ' + ord.n + '</span>' +
        '<button data-act="mapCardOrder" data-d="1" aria-label="Después: pasar este punto un puesto después en el recorrido"' + (ord.last || !ui.orderEdit ? ' disabled' : '') + '>▶</button></div>' +
        '<b class="mapcard-name"><i style="background:' + Mapa.pointColor(pt, proj().mainColor) + '"></i>' + esc(pt.name) + '</b>' +
        '<p class="small">' + (isNum(pt.alt) ? 'Altitud ' + Fmt.num(pt.alt, 0) + ' m' : 'Sin altitud') + ' · ' + src + ' · ' + esc(Fmt.latlon(pt.lat, pt.lon)) + '</p>' +
        '<p class="small mapcard-rel" id="mapCardRel"' + (rel ? '' : ' hidden') + '>' + esc(rel) + '</p>' +
        '<div class="mapcard-btns"><button class="btn btn-primary" data-act="editPoint" data-id="' + esc(pt.id) + '">Abrir ficha</button>' +
        '<button class="btn" data-act="mapCardMove">Mover</button><button class="btn" data-act="mapCardGo">Ir al punto</button>' +
        '<button class="btn mapcard-del" data-act="askDelete" data-id="' + esc(pt.id) + '" aria-label="Eliminar ' + esc(pt.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button></div>';
      el.hidden = false; box.classList.add('has-card');
      if (ui.map) ui.map.select(pt.id);
    }
    // «Ir al punto»: con el GPS encendido guía hasta él (distancia, rumbo y flecha, con cada lectura); sin GPS solo centra el mapa en el punto
    function goToPoint(pt) {
      if (!ui.gpsOn) {
        ui.follow = false; syncMapChrome();
        if (ui.map) ui.map.flyTo(pt.lat, pt.lon, 18);
        toast('Mapa centrado en ' + pt.name + '. Enciende el GPS para que te guíe hasta él.');
        return;
      }
      ui.navId = pt.id; ui.follow = false; ui.mapSel = null;      // el destino se fija antes de abrir la franja, que lo necesita para dibujarse
      if (ui.mapTool === 'ir') syncMapChrome(); else setMapTool('ir');
      navFit();
    }
    // Encuadra a la persona y al punto al que va (o solo el punto, si todavía no hay lectura)
    function navFit() {
      var pt = ui.navId ? pointById(ui.navId) : null;
      if (!pt || !ui.map) return;
      ui.follow = false; syncMapChrome();
      if (ui.fix) ui.map.fit(Mapa.extent([{ lat: ui.fix.lat, lon: ui.fix.lon }, pt], []), { bottom: 170 });
      else ui.map.flyTo(pt.lat, pt.lon, 18);
    }
    function onPointTap(id) {
      closeMapPanels();
      var pt = pointById(id);
      if (!pt) return;
      if (ui.mapTool === 'medir') { addMeasure({ lat: pt.lat, lon: pt.lon }); return; }
      if (ui.mapTool) return;
      ui.mapSel = ui.mapSel === id ? null : id;          // tocar otra vez el mismo punto cierra su tarjeta
      syncMapCard();
    }
    function onMapClick(ll) {
      if (closeMapPanels()) return;
      if (ui.mapTool === 'medir') { addMeasure(ll); return; }
      if (ui.mapSel) { ui.mapSel = null; syncMapCard(); return; }
      if (!ui.mapMode && !ui.track) { var other = Mapa.lotAt(ll, lotLayers(proj())); if (other) pickLot(other); }   // tocar otro lote lo elige
    }

    /* ---------- Mapa: herramientas de la franja de abajo (medir, mira y caminar el lindero) ---------- */
    function setMapTool(t) {
      t = Mapa.toolId(t);
      if (t === ui.mapTool) return;
      if (ui.track) finishTrack();
      if (t && ui.mapMode) setMapMode('');
      ui.mapTool = t; ui.measure = []; ui.measureClosed = false; ui.mapSel = null; ui.mapMenu = false; ui.mapLayers = false;
      if (t !== 'ir') ui.navId = null;
      if (ui.map) ui.map.setMeasure([]);
      syncMapMenu(); syncMapChrome();
    }
    function addMeasure(ll) {
      ui.measure = Mapa.measureAdd(ui.measure, ll);
      drawMeasure();
    }
    function drawMeasure() {
      if (ui.measure.length < 3) ui.measureClosed = false;
      if (ui.map) ui.map.setMeasure(ui.measure, ui.measureClosed);
      syncMapTool();
    }
    function syncMapTool() {
      var bar = $('#mapToolBar'), box = $('#mapBox');
      if (!bar) return;
      var t = ui.mapTool, h = '';
      Mapa.TOOLS.forEach(function (k) { box.classList.toggle('tool-' + k, k === t); });
      $('.maptools').hidden = !!t;
      bar.hidden = !t;
      if (t === 'mira') {
        var c = ui.map ? ui.map.center() : null;
        h = '<p>Mueve el mapa hasta dejar la cruz en el lugar. <b id="mapAimLL">' + (c ? esc(Fmt.latlon(c.lat, c.lon)) : '') + '</b></p>' +
          '<div class="mtb-btns"><button class="btn btn-primary" data-act="mapAimAdd">Agregar aquí</button><button class="btn" data-act="mapToolEnd">Terminar</button></div>';
      } else if (t === 'medir') {
        h = '<p id="mapMeasureTxt">' + esc(Mapa.measureText(ui.measure, Fmt.dist, { closed: ui.measureClosed, area: Geo.polygonArea, fmtArea: function (m2) { return Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit || 'ha'); } })) + '</p>' +
          '<div class="mtb-btns"><button class="btn" data-act="mapMeasureBack"' + (ui.measure.length ? '' : ' disabled') + '>Quitar último</button>' +
          '<button class="btn" data-act="mapMeasureClose" aria-pressed="' + ui.measureClosed + '"' + (ui.measure.length >= 3 ? '' : ' disabled') + '>' + (ui.measureClosed ? 'Abrir figura' : 'Cerrar figura') + '</button><button class="btn btn-primary" data-act="mapToolEnd">Terminar</button></div>';
      } else if (t === 'ir') {
        var target = ui.navId ? pointById(ui.navId) : null, nav = Mapa.navInfo(ui.fix, target, Fmt.dist);
        if (!nav) { setMapTool(''); return; }        // el punto ya no existe
        h = '<p class="navline" id="mapNavTxt"><span class="navarrow' + (nav.arrived ? ' arrived' : '') + '" aria-hidden="true"' + (isNum(nav.bearing) ? ' style="transform:rotate(' + Math.round(nav.bearing) + 'deg)"' : '') + '>' +
          (nav.arrived ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5M5.5 11.5L12 5l6.5 6.5"/></svg>') +
          '</span><span>' + esc(nav.text) + '</span></p>' +
          '<div class="mtb-btns"><button class="btn" data-act="mapNavFit">Ver los dos</button><button class="btn btn-primary" data-act="mapToolEnd">Terminar</button></div>';
      } else if (t === 'caminar') {
        var tr = ui.track || {};
        h = '<p id="mapTrackTxt">' + esc(Mapa.trackText({ added: (tr.ids || []).length, step: tr.step, last: tr.last })) + (ui.fix && isNum(ui.fix.acc) ? ' · GPS ±' + Math.round(ui.fix.acc) + ' m' : '') + '</p>' +
          '<div class="mtb-btns"><button class="btn btn-primary" data-act="mapToolEnd">Terminar recorrido</button></div>';
      }
      if (bar.innerHTML !== h) bar.innerHTML = h;
    }
    // Caminar el lindero: con cada lectura buena del GPS que esté a «step» metros del último punto, se deja uno nuevo
    function startTrack(step) {
      if (!ui.gpsOn) gpsStart();
      if (!ui.gpsOn) return;
      setMapTool('caminar');
      undoMark('caminar el lindero');
      ui.track = { pid: proj().id, step: Mapa.trackStep(step), ids: [], last: 'none', lastPt: null, prevNext: proj().nextPoint };
      ui.follow = true;
      wakeLock(true);
      if (ui.fix) trackFix(ui.fix);
      syncMapChrome();
      toast('Camina por el borde del terreno. Deja la pantalla encendida y la app abierta.');
    }
    function trackFix(fix) {
      var t = ui.track;
      if (!t) return;
      if (t.pid !== proj().id) { finishTrack(); return; }      // se cambió de proyecto: el recorrido se cierra
      if (ui.sampling) return;
      t.last = Mapa.trackDecision(t.lastPt, fix, t.step, S.settings.minAcc);
      if (t.last !== 'add') return;
      var pt = addPoint({ lat: fix.lat, lon: fix.lon, alt: fix.alt, altGps: fix.alt, altSrc: isNum(fix.alt) ? 'gps' : null, acc: fix.acc, altAcc: fix.altAcc, src: 'gps' });
      t.ids.push(pt.id); t.lastPt = { lat: fix.lat, lon: fix.lon };
      if (ui.tab === 'puntos' || ui.tab === 'area') renderTab(ui.tab);
    }
    function finishTrack() {
      var t = ui.track;
      if (!t) return;
      ui.track = null; ui.mapTool = '';
      wakeLock(false);
      syncMapChrome();
      var n = t.ids.length, pid = t.pid;
      if (!n) { toast('Recorrido terminado sin puntos: el GPS no dio ninguna lectura que sirviera.'); return; }
      toast('Recorrido terminado: ' + n + (n === 1 ? ' punto.' : ' puntos.'), { action: 'Deshacer', fn: function () {
        var p = S.projects.filter(function (x) { return x.id === pid; })[0];
        if (!p) return;
        p.points = p.points.filter(function (q) { return t.ids.indexOf(q.id) < 0; });
        if (p.nextPoint === t.prevNext + n) p.nextPoint = t.prevNext;
        save(); renderTab(ui.tab);
      } });
    }
    // Mientras se camina el lindero se pide que la pantalla no se apague (si el teléfono lo permite; si no, no pasa nada)
    function wakeLock(on) {
      try {
        if (!on) { if (ui.wake) { ui.wake.release(); ui.wake = null; } return; }
        if (navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen').then(function (l) { if (ui.track) ui.wake = l; else l.release(); }, function () { /* sin permiso: se sigue igual */ });
        }
      } catch (e) { /* nada */ }
    }
    function openMapMore() {
      var opts = Mapa.TRACK_STEPS.map(function (m) { return '<option value="' + m + '"' + (m === Mapa.TRACK_STEP_DEFAULT ? ' selected' : '') + '>Un punto cada ' + m + ' m</option>'; }).join('');
      var cf = multi() && !lot().locked ? Predio.conflicts(proj().lots, lot().id) : null;
      openSheet('Más opciones del mapa',
        (cf ? '<h3 class="sub">Ajustar a los linderos</h3><p class="small muted" id="moreAdj">' + esc(cf.text) + ' Puedes recortarlo para que su borde siga el del predio y el de sus vecinos, o dejarlo así.</p>' +
          '<div class="btns" style="margin-bottom:18px"><button class="btn btn-primary" data-act="adjustAsk">Ajustar a los linderos</button></div>' : '') +
        '<h3 class="sub">Crear polígono</h3><p class="small muted">Un predio (el terreno completo) o un lote dentro de él: potrero, cafetal, cultivo… Queda elegido y listo para marcar sus puntos tocando el mapa.</p>' +
        '<div class="btns"><button class="btn btn-primary" data-act="lotNewMap">Crear polígono</button></div>' +
        '<h3 class="sub" style="margin-top:18px">Agregar con mira</h3><p class="small muted">Una cruz queda fija en el centro: mueves el mapa hasta el lugar exacto y pulsas «Agregar aquí». Es más preciso que tocar con el dedo.</p>' +
        '<div class="btns"><button class="btn btn-primary" data-act="mapAim">Agregar con mira</button></div>' +
        '<h3 class="sub" style="margin-top:18px">Caminar el lindero</h3><p class="small muted">Recorres el borde del terreno y el GPS va dejando los puntos en orden. Deja la pantalla encendida y la app abierta; al terminar puedes deshacer todo el recorrido.</p>' +
        '<label class="f"><span>Distancia entre puntos</span><select id="trackStep">' + opts + '</select></label>' +
        '<div class="btns"><button class="btn btn-primary" data-act="mapWalk">Empezar a caminar</button></div>' +
        '<h3 class="sub" style="margin-top:18px">Ordenar los puntos</h3><p class="small muted">El polígono une los puntos en su orden (el número dentro de cada punto). Esto los acomoda solos alrededor del centro del terreno y se puede deshacer. En terrenos con entrantes (forma de L o de U) puede equivocarse: ahí toca un punto y usa las flechas ◀ y ▶ de su tarjeta para pasarlo antes o después.</p>' +
        '<div class="btns"><button class="btn" data-act="mapReorder">Ordenar los puntos</button></div>' +
        '<h3 class="sub" style="margin-top:18px">Ayuda</h3><div class="btns"><button class="btn" data-act="mapGuide">Cómo usar el mapa</button></div>');
    }

    return { addManualAt: addManualAt, adjustCheck: adjustCheck, adjustDo: adjustDo, adjustMany: adjustMany, adjustManyAsk: adjustManyAsk, adjustSheet: adjustSheet, applyMapFull: applyMapFull, drawMeasure: drawMeasure, finishTrack: finishTrack, fitAll: fitAll, goLastPoint: goLastPoint, goMyPosition: goMyPosition, goToPoint: goToPoint, mapKey: mapKey, mapUndo: mapUndo, mapaHtml: mapaHtml, mountMap: mountMap, navFit: navFit, onMapFix: onMapFix, openMapMore: openMapMore, setMapMode: setMapMode, setMapTool: setMapTool, startTrack: startTrack, syncMapCard: syncMapCard, syncMapChrome: syncMapChrome, syncMapMenu: syncMapMenu, toggleMapFull: toggleMapFull, toolsInset: toolsInset, toolsTop: toolsTop, trackFix: trackFix, undoMark: undoMark, updateMapNotice: updateMapNotice };
  };
})();

/* app.js — interfaz de Zonas de Vida. Todo funciona sin conexión; internet solo completa datos. */
(function () {
  'use strict';

  var Geo = window.Geo, H = window.Holdridge, Climate = window.Climate, A = window.Analysis, Fmt = window.Fmt,
      Gps = window.Gps, Store = window.Store, Diagram = window.Diagram, Report = window.Report,
      Gis = window.Gis, Backup = window.Backup, IO = window.IO, WL = window.WalterLieth, Mapa = window.Mapa, MapView = window.MapView, Satelite = window.Satelite, Perfil = window.Perfil, Fotos = window.Fotos, Zip = window.Zip, Units = window.Units;
  var APP_VERSION = '2.31.0';

  var S = Store.loadState();
  // 2.22.0: la primera vez, los lotes de antes que están dentro de un predio pasan a pertenecerle
  if (!Store.loadFlag('adopt222')) { if (S.projects.reduce(function (n, P) { return n + Predio.adopt(P.lots); }, 0)) Store.saveState(S); Store.saveFlag('adopt222', true); }
  var hadSaved = Store.hasSavedState();      // ¿había datos guardados al abrir? (solo entonces se limpian las fotos sin uso)
  var MEM = new Climate.Memory();
  MEM.add(Store.loadMemory());
  var ui = { tab: 'puntos', gpsOn: false, fix: null, stopWatch: null, sampling: null, fetching: false, diagram: null, sheetOpen: false, undo: null, wasOn: false, gpsAsked: false, gpsAsking: false,
             imp: null, restore: null, edit: null,
             polyView: 'croquis', polyActive: true, mapBase: Mapa.baseId(Store.loadFlag('mapBase')), mapRef: Store.loadFlag('mapRef') === true, mapIgac: Store.loadFlag('mapIgac') === true,
             map: null, mapFollow: false, mapFitKey: null, tileErrors: 0, mapMode: '', mapMenu: false, mapModeFor: null,
             unfolded: {}, mapSel: null, navId: null, mapLayers: false, mapFull: false, follow: false, mapTool: '', measure: [], measureClosed: false, mapUndo: Mapa.undoStack(20), track: null, wake: null,
             croq: { satelite: { img: null, busy: false, error: null }, topo: { img: null, busy: false, error: null } }, sharing: false, nowBusy: false, nowError: '', photoBusy: false, restoring: false,
             conv: null, convMem: {}, tool: null, wx: null, wxToken: 0, toolGpsKind: '' };

  /* ---------- Utilidades ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function proj() { return S.projects.filter(function (p) { return p.id === S.currentId; })[0] || S.projects[0]; }
  /* ---------- Lotes (2.15.0) ----------
   * proj().points, .climate, .mainColor… son siempre los del lote elegido (ver store.js). Los demás lotes del proyecto se dibujan
   * como si fueran capas: así salen en el mapa, en el croquis y en el reporte sin tocar cómo se dibuja cada cosa. */
  function lot() { return Store.activeLot(proj()); }
  function multi(p) { return (p || proj()).lots.length > 1; }
  function lotLayers(p) {
    var cur = Store.activeLot(p);
    // las fincas van primero: así las áreas se dibujan encima de su finca
    return p.lots.filter(function (l) { return l !== cur && l.points.length; }).sort(function (a, b) { return (Predio.isFinca(b) ? 1 : 0) - (Predio.isFinca(a) ? 1 : 0); }).map(function (l) {
      return { id: 'lote-' + l.id, lotId: l.id, lot: true, dots: Predio.isArea(l), name: l.name, kind: l.points.length >= 3 ? 'polygon' : l.points.length === 2 ? 'line' : 'points', color: l.mainColor, visible: true, points: l.points,
        areaText: l.points.length >= 3 ? Fmt.area(Geo.areaUnits(Geo.polygonArea(l.points)), S.settings.areaUnit) : '' };
    });
  }
  function viewLayers(p) { p = p || proj(); return p.layers.concat(lotLayers(p)); }
  // Lo que se dibuja y se reporta del lote elegido: sus puntos y su clima, con las capas importadas y los demás lotes como capas
  function view(p) {
    p = p || proj();
    var l = Store.activeLot(p);
    var par = Predio.parentOf(l, p.lots);
    var v = { id: p.id + ':' + l.id, name: p.name, lotName: multi(p) ? l.name : '', points: l.points, climate: l.climate, layers: viewLayers(p), mainColor: l.mainColor, nextPoint: l.nextPoint,
      dots: Predio.isArea(l), locked: !!l.locked, lotMeta: { id: l.id, kind: l.kind || '', cat: l.cat || '', parent: par ? par.id : '', parentName: par ? par.name : '' } };
    if (l.weatherNow) v.weatherNow = l.weatherNow;
    return v;
  }
  function ownLabel() { return multi() ? lot().name : 'Mis puntos'; }
  function lotArea(l) { return l.points.length >= 3 ? Geo.polygonArea(l.points) : 0; }
  function save() { var r = Store.saveState(S); if (!r.ok) toast(r.error, { err: true }); }
  function saveMemory() { var r = Store.saveMemory(MEM.all()); if (!r.ok) toast(r.error, { err: true }); }

  /* ---------- Fotos de los puntos (2.5.0) ---------- */
  // Cada punto guarda solo la lista (point.photos); la imagen está en el teléfono (IndexedDB) y se pide por su id.
  var photoStore = Fotos.createStore((function () { try { return window.indexedDB || null; } catch (e) { return null; } })());
  var photoUrls = Fotos.createUrls(photoStore, window.URL, window.Blob);
  function sizeText(b) { return b < 1048576 ? Fmt.num(b / 1024, 0) + ' KB' : Fmt.num(b / 1048576, 1) + ' MB'; }      // 180 KB, 2,4 MB
  function photosOf(pt) { return Array.isArray(pt && pt.photos) ? pt.photos : []; }
  function hydratePhotos(root) {         // pone la imagen guardada en cada <img data-photo="id"> (la lectura es asíncrona)
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('img[data-photo]'), function (img) {
      if (img.getAttribute('src')) return;
      photoUrls.get(img.getAttribute('data-photo')).then(function (u) { if (u) img.src = u; else img.classList.add('nofoto'); }, function () { img.classList.add('nofoto'); });
    });
  }
  function photoStrip(pt) {               // tira de miniaturas en la lista de Puntos (la primera es la principal)
    var list = photosOf(pt);
    if (!list.length) return '';
    return '<span class="pstrip" role="img" aria-label="' + list.length + (list.length === 1 ? ' foto' : ' fotos') + '">' + list.map(function (f) { return '<img data-photo="' + esc(f.id) + '" alt="">'; }).join('') + '</span>';
  }
  function photosBody(pt) {               // la sección «Fotos» de la ficha
    var list = photosOf(pt), full = list.length >= Fotos.MAX_PER_POINT, off = full || ui.photoBusy ? ' disabled' : '';
    var h = '<span class="flabel">Fotos (' + list.length + ' de ' + Fotos.MAX_PER_POINT + ')</span>';
    if (list.length) {
      h += '<div class="pgrid">';
      list.forEach(function (f, i) {
        h += '<div class="pcard"><button class="pimg" data-act="photoView" data-fid="' + esc(f.id) + '" aria-label="Ver la foto ' + (i + 1) + ' en grande"><img data-photo="' + esc(f.id) + '" alt="Foto ' + (i + 1) + ' de ' + esc(pt.name) + '"></button>' +
          (i === 0 ? '<span class="pbadge">Principal</span>' : '') + '<div class="pbtns">' +
          (i === 0 ? '' : '<button class="chipbtn" data-act="photoMain" data-pid="' + esc(pt.id) + '" data-fid="' + esc(f.id) + '">Hacer principal</button>') +
          '<button class="chipbtn" data-act="photoDel" data-pid="' + esc(pt.id) + '" data-fid="' + esc(f.id) + '">Quitar</button></div></div>';
      });
      h += '</div>';
    }
    h += '<div class="btns"><button class="btn" data-act="photoCam" data-pid="' + esc(pt.id) + '"' + off + '>Tomar foto</button><button class="btn" data-act="photoGal" data-pid="' + esc(pt.id) + '"' + off + '>Galería</button></div>';
    return h + '<span class="hint">' + (ui.photoBusy ? 'Guardando la foto…' : full ? 'Este punto ya tiene ' + Fotos.MAX_PER_POINT + ' fotos. Quita una para agregar otra.' :
      'Las fotos se guardan al instante en este teléfono, sin esperar a «Guardar cambios». Se reducen a 1280 px y no conservan la ubicación del archivo original. La primera es la principal.') + '</span>';
  }
  function refreshPhotos(pid) {           // vuelve a dibujar solo las fotos de la ficha abierta (el resto del formulario no se toca)
    var el = $('#fPhotosWrap'), pt = pointById(pid);
    if (!el || !pt || !ui.edit || ui.edit.id !== pid) return;
    el.innerHTML = photosBody(pt);
    hydratePhotos(el);
  }
  function addPhotos(files) {
    var pid = ui.photoFor, pt = pid && pointById(pid), list = Array.prototype.slice.call(files || [], 0);
    if (!pt || !list.length || ui.photoBusy) return;
    var room = Fotos.MAX_PER_POINT - photosOf(pt).length;
    if (room <= 0) { toast('Este punto ya tiene ' + Fotos.MAX_PER_POINT + ' fotos. Quita una para agregar otra.', { err: true }); return; }
    var extra = Math.max(0, list.length - room);
    list = list.slice(0, room);
    ui.photoBusy = true; refreshPhotos(pid);
    var ok = 0, errors = [];
    list.reduce(function (chain, file) {
      return chain.then(function () {
        return Fotos.shrink(file, {}, window).then(function (r) {
          var fid = Fotos.newId();
          return photoStore.put(fid, r.bytes).then(function () {
            var cur = pointById(pid);          // el punto pudo eliminarse mientras tanto
            if (!cur) return;
            cur.photos = photosOf(cur).concat([{ id: fid, w: r.w, h: r.h, n: r.bytes.length, at: Date.now() }]);
            ok++; save();
          });
        }).catch(function (e) { errors.push(e && e.message || String(e)); });
      });
    }, Promise.resolve()).then(function () {
      ui.photoBusy = false; refreshPhotos(pid); renderTab(ui.tab);
      if (errors.length) toast('No se pudo guardar la foto: ' + errors[0] + (ok ? ' (las demás sí se guardaron)' : ''), { err: true });
      else toast((ok === 1 ? 'Foto guardada.' : ok + ' fotos guardadas.') + (extra ? ' Solo caben ' + Fotos.MAX_PER_POINT + ' por punto: se omitieron ' + extra + '.' : ''));
    });
  }
  function photoIndex(pt, fid) { return photosOf(pt).map(function (f) { return f.id; }).indexOf(fid); }
  function photoMain(pid, fid) {
    var pt = pointById(pid), i = pt ? photoIndex(pt, fid) : -1;
    if (i < 1) return;
    pt.photos.unshift(pt.photos.splice(i, 1)[0]);
    save(); refreshPhotos(pid); renderTab(ui.tab); toast('Ahora es la foto principal.');
  }
  function photoDel(pid, fid) {
    var pt = pointById(pid), i = pt ? photoIndex(pt, fid) : -1;
    if (i < 0) return;
    var f = pt.photos.splice(i, 1)[0];
    if (!pt.photos.length) delete pt.photos;
    save(); refreshPhotos(pid); renderTab(ui.tab);
    toast('Foto quitada.', { action: 'Deshacer', fn: function () {
      var cur = pointById(pid); if (!cur) return;
      cur.photos = photosOf(cur); cur.photos.splice(Math.min(i, cur.photos.length), 0, f);
      save(); refreshPhotos(pid); renderTab(ui.tab);
    } });
  }
  function openPhoto(fid) {
    photoUrls.get(fid).then(function (u) {
      if (!u) { toast('No se encontró esa foto en este teléfono.', { err: true }); return; }
      var old = $('#lightbox'); if (old) old.remove();
      var el = document.createElement('div'), img = document.createElement('img'), b = document.createElement('button');
      el.id = 'lightbox'; el.className = 'lightbox'; el.setAttribute('data-act', 'photoClose'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Foto en grande. Toca para cerrar.');
      img.src = u; img.alt = 'Foto en grande';
      b.className = 'lbclose'; b.setAttribute('data-act', 'photoClose'); b.setAttribute('aria-label', 'Cerrar la foto'); b.textContent = '×';
      el.appendChild(img); el.appendChild(b); document.body.appendChild(el);
      try { history.pushState({ lightbox: true }, ''); } catch (e) { /* nada */ }
    }, function () { toast('No se pudo abrir la foto.', { err: true }); });
  }
  function closePhoto() {
    var el = $('#lightbox');
    if (!el) return;
    if (history.state && history.state.lightbox) history.back(); else el.remove();
  }
  // Las fotos de un proyecto para el reporte compartido: cada una se vuelve a reducir (900 px) para que el archivo no pese demasiado. { id: 'data:image/jpeg;base64,…' }
  function reportPhotos(p) {
    var out = {};
    return Fotos.usedIds([p]).reduce(function (chain, id) {
      return chain.then(function () {
        return photoStore.get(id).then(function (bytes) {
          if (!bytes) return;
          return Fotos.shrink(new Blob([bytes], { type: 'image/jpeg' }), { max: Fotos.REPORT_SIDE, quality: Fotos.REPORT_QUALITY }, window)
            .then(function (r) { return r.bytes; }, function () { return bytes; })
            .then(function (b) { out[id] = 'data:image/jpeg;base64,' + IO.toBase64(b); });
        }, function () { /* esa foto no se pudo leer: el reporte sale sin ella */ });
      });
    }, Promise.resolve()).then(function () { return out; });
  }
  // Los bytes de varias fotos guardadas: { id: Uint8Array }; las que no se encuentren no aparecen
  function readPhotoBytes(ids) {
    var out = {};
    return ids.reduce(function (chain, id) {
      return chain.then(function () { return photoStore.get(id).then(function (b) { if (b) out[id] = b; }, function () { /* no se pudo leer */ }); });
    }, Promise.resolve()).then(function () { return out; });
  }

  // Número escrito por el usuario: acepta coma o punto decimal. {empty} | {error} | {value}
  function parseNum(t) {
    var s = String(t === null || t === undefined ? '' : t).trim();
    if (!s) return { empty: true };
    s = s.replace(',', '.');
    if (!/^[-+]?\d+(\.\d+)?$/.test(s) && !/^[-+]?\.\d+$/.test(s)) return { error: 'Escribe solo un número, por ejemplo 14,5' };
    return { value: parseFloat(s) };
  }

  var toastTimer;
  function toast(msg, o) {
    o = o || {};
    var el = $('#toast');
    el.className = 'toast' + (o.err ? ' err' : '');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (o.action ? '<button data-act="toastAction">' + esc(o.action) + '</button>' : '');
    el.hidden = false;
    ui.toastFn = o.fn || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, o.err ? 7000 : 4500);
  }

  /* ---------- Ventana de progreso («Elaborando el reporte…») ----------
   * Sale al instante, tapa la pantalla (nadie toca otra cosa ni cree que la app se colgó) y cuenta en qué etapa va. Se queda al menos
   * BUSY_MIN_MS para no parpadear cuando todo es muy rápido, y pasados BUSY_SLOW_MS ofrece ocultarla por si algo tarda de más. */
  var BUSY_MIN_MS = 500, BUSY_SLOW_MS = 30000;
  var busy = { on: false, since: 0, slowT: 0 };
  function busyShow(title, detail) {
    clearTimeout(busy.slowT);
    $('#busyTitle').textContent = title;
    $('#busyDetail').textContent = detail || '';
    $('#busyNote').textContent = 'Esto toma unos segundos. Por favor no cierres la app.';
    $('#busyHide').hidden = true;
    $('#busy').hidden = false;
    busy.on = true; busy.since = Date.now();
    busy.slowT = setTimeout(function () {
      $('#busyNote').textContent = 'Está tardando más de lo normal (con muchas fotos puede demorar). Puedes seguir esperando.';
      $('#busyHide').hidden = false;
    }, BUSY_SLOW_MS);
    try { $('#busyCard').focus(); } catch (e) { /* nada */ }
  }
  function busyStep(detail) { if (busy.on) $('#busyDetail').textContent = detail; }
  function busyHide() {
    clearTimeout(busy.slowT);
    busy.on = false;
    $('#busy').hidden = true;
  }
  // Promesa que se cumple cuando la ventana ya estuvo visible el tiempo mínimo
  function busyMin() {
    var left = busy.on ? BUSY_MIN_MS - (Date.now() - busy.since) : 0;
    return left > 0 ? new Promise(function (r) { setTimeout(r, left); }) : Promise.resolve();
  }
  // Espera a que el navegador pinte lo último (la ventana y su texto) antes de seguir con trabajo pesado; sin pintar (app en segundo plano) sigue a los 100 ms
  function busyPaint() {
    return new Promise(function (resolve) {
      var done = false;
      function go() { if (!done) { done = true; resolve(); } }
      setTimeout(go, 100);
      if (window.requestAnimationFrame) window.requestAnimationFrame(function () { setTimeout(go, 0); });
    });
  }
  // Muestra la ventana, hace el trabajo y la quita siempre al terminar (bien o mal, antes de que salga el aviso de error)
  function busyRun(title, detail, work) {
    busyShow(title, detail);
    return busyPaint().then(work).then(function (r) { busyHide(); return r; }, function (e) { busyHide(); throw e; });
  }

  function analysisInput() {
    var p = proj();
    var c = Object.assign({}, p.climate);
    ui.staleOnline = false;
    if (c.online && isNum(c.online.lat) && p.points.length) {
      var ctr = Geo.centroid(p.points);
      if (Geo.haversine(ctr.lat, ctr.lon, c.online.lat, c.online.lon) > 20000) { c.online = null; ui.staleOnline = true; }
    }
    return { points: p.points, climate: c };
  }
  function analysis() { return A.analyze(analysisInput(), { memory: MEM, radiusKm: 25 }); }

  /* ---------- Hojas (ventanas desde abajo) ---------- */
  function openSheet(title, body, onMount) {
    var el = $('#sheet');
    el.innerHTML = '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheet-head"><h2>' + esc(title) + '</h2><button data-act="closeSheet" aria-label="Cerrar">×</button></div><div class="sheet-body">' + body + '</div></div>';
    el.hidden = false;
    if (!ui.sheetOpen) { try { history.pushState({ sheet: true }, ''); } catch (e) { /* nada */ } }
    ui.sheetOpen = true;
    if (onMount) onMount(el);
    var first = el.querySelector('input,textarea');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) { /* nada */ } }, 60);
  }
  function hideSheet() { var el = $('#sheet'); el.hidden = true; el.innerHTML = ''; ui.sheetOpen = false; ui.gpsAsking = false; ui.conv = null; ui.tool = null; ui.toolGpsKind = ''; }
  function closeSheet() {
    if (!ui.sheetOpen) return;
    if (history.state && history.state.sheet) history.back(); else hideSheet();
  }
  window.addEventListener('popstate', function () { var lb = $('#lightbox'); if (lb) { lb.remove(); return; } if (ui.sheetOpen) { hideSheet(); return; } if (ui.mapFull) applyMapFull(false); });
  document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; if ($('#lightbox')) closePhoto(); else if (ui.sheetOpen) closeSheet(); });

  /* ---------- GPS ---------- */
  function setChip(cls, text) {
    var c = $('#gpsChip');
    c.className = 'chip chip-' + cls;
    $('#gpsChipText').textContent = text;
  }
  function updateChips() {
    if (!ui.gpsOn) setChip('off', 'GPS apagado');
    else if (!ui.fix) setChip('warn', 'Buscando señal…');
    else {
      var acc = ui.fix.acc;
      if (!isNum(acc)) setChip('warn', 'GPS activo');
      else setChip(acc <= 10 ? 'ok' : acc <= 30 ? 'warn' : 'bad', '±' + Math.round(acc) + ' m');
    }
    $('#netChip').hidden = navigator.onLine !== false;
  }
  function updateReadout() {
    var f = ui.fix, set = function (id, t) { var e = $('#' + id); if (e) e.innerHTML = t; };
    set('rLat', f ? Fmt.coord(f.lat) + '°' : '—');
    set('rLon', f ? Fmt.coord(f.lon) + '°' : '—');
    set('rAlt', f && isNum(f.alt) ? Fmt.num(f.alt, 0) + ' <small>m</small>' : (f ? '<small>sin dato</small>' : '—'));
    set('rAcc', f && isNum(f.acc) ? '±' + Fmt.num(f.acc, 0) + ' <small>m</small>' : '—');
    precisionBanner();
  }
  // Aviso en vivo: compara la precisión actual del GPS con el mínimo que eligió la persona
  function precisionBanner() {
    var el = $('#precBanner');
    if (!el) return;
    var min = S.settings.minAcc, f = ui.gpsOn ? ui.fix : null;
    var st = Gps.precisionState(f && f.acc, min);
    var t = f ? Gps.precisionText(f.acc, min) : '';
    el.className = st.level === 'bad' ? 'warn' : st.level === 'ok' ? 'okmsg' : '';
    el.textContent = t;
    el.hidden = !t;
  }
  function gpsStart() {
    if (!Gps.available()) { toast('Este dispositivo no permite leer el GPS. Puedes escribir las coordenadas.', { err: true }); return; }
    ui.gpsOn = true; ui.fix = null; ui.gpsAsked = false; updateChips();
    ui.stopWatch = Gps.watch(function (fix) { ui.fix = fix; updateReadout(); updateChips(); trackFix(fix); onMapFix(fix); onToolFix(); }, function (e) {
      if (e && e.code === 1) gpsStop();                                            // sin permiso no hay nada que seguir leyendo
      if (Gps.isOff(e, !!ui.fix) && askNoGps(e)) return;                         // GPS apagado o sin permiso: pregunta «¿Usar sin GPS?»
      toast(Gps.explain(e), { err: true });
    });
    if (ui.tab === 'puntos') renderTab('puntos');
  }
  function gpsStop() {
    if (ui.stopWatch) ui.stopWatch();
    ui.stopWatch = null; ui.gpsOn = false; ui.fix = null; ui.mapFollow = false; ui.follow = false; updateChips();
    if (ui.track) finishTrack();                                                   // sin GPS no se puede seguir caminando el lindero
    if (ui.mapTool === 'ir') setMapTool('');                                       // ni guiar hasta un punto
    syncMapChrome();
    if (ui.map) ui.map.showFix(null);
    if (ui.tab === 'puntos') renderTab('puntos');
    if (ui.wx) ui.wx.wait = false;
    renderGpsTool(); renderWeatherTool();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && ui.gpsOn && !ui.sampling && !ui.track) { ui.wasOn = true; gpsStop(); }   // caminando el lindero el GPS no se apaga
    else if (!document.hidden && ui.wasOn) { ui.wasOn = false; gpsStart(); }
  });

  // Si la precisión actual es peor que el mínimo elegido, primero se avisa y la persona decide (no se bloquea nada).
  function markPoint(force) {
    if (ui.sampling) return;
    var min = S.settings.minAcc;
    if (force !== true && Gps.precisionState(ui.fix && ui.fix.acc, min).worse) { confirmLowPrecision(); return; }
    var secs = 10, ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var st = { start: Date.now(), n: 0, acc: null, secs: secs, ac: ac, cancelled: false };
    ui.sampling = st;
    renderTab('puntos');
    if (ui.tab === 'area') renderTab('area');
    var timer = setInterval(updateProgress, 200);
    Gps.sample({ seconds: secs, goodAcc: min > 0 ? Math.min(5, min) : 5, minSamples: 4, signal: ac ? ac.signal : undefined,
      onProgress: function (s, n) { st.n = n; st.acc = s.acc; } })
      .then(function (r) {
        if (st.cancelled) return;
        undoMark('marcar un punto con el GPS');
        var pt = addPoint({ lat: r.lat, lon: r.lon, alt: r.alt, altGps: r.alt, altSrc: isNum(r.alt) ? 'gps' : null, acc: r.acc, altAcc: r.altAcc, src: 'gps' });
        adjustCheck();
        var base = pt.name + ' guardado' + (isNum(r.acc) ? ' (±' + Math.round(r.acc) + ' m, ' + r.n + ' lecturas)' : '');
        if (Gps.precisionState(r.acc, min).worse) {
          toast(base + '. Aviso: la precisión quedó peor que tu mínimo (±' + min + ' m); este punto no es el más preciso.', { action: 'Quitarlo', fn: function () { removePoint(pt.id); } });
        } else {
          toast(base + (isNum(r.alt) ? '' : '. El GPS no dio altitud: escríbela o complétala con internet.'));
        }
      })
      .catch(function (e) { if (!st.cancelled && !askNoGps(e)) toast(Gps.explain(e), { err: true }); })   // sin ninguna lectura a tiempo: el GPS está apagado o sin señal
      .then(function () { clearInterval(timer); ui.sampling = null; if (ui.tab === 'puntos' || ui.tab === 'area') renderTab(ui.tab); });
  }
  function updateProgress() {
    var st = ui.sampling; if (!st) return;
    var pct = Math.min(100, (Date.now() - st.start) / (st.secs * 1000) * 100);
    var msg = st.n ? 'Promediando lecturas: ' + st.n + (isNum(st.acc) ? ' · mejor precisión ±' + Math.round(st.acc) + ' m' : '') : 'Esperando la primera lectura del GPS…';
    [['#progBar', '#progTxt'], ['#mapProgBar', '#mapProgTxt']].forEach(function (ids) {
      var bar = $(ids[0]), txt = $(ids[1]);
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = msg;
    });
  }
  function cancelMark() {
    var st = ui.sampling; if (!st) return;
    st.cancelled = true;
    if (st.ac) st.ac.abort();
  }
  function confirmLowPrecision() {
    var f = ui.fix;
    openSheet('La precisión del GPS es baja',
      '<div class="warn">' + esc(Gps.precisionText(f.acc, S.settings.minAcc)) + '</div>' +
      '<p class="small muted">Suele mejorar si sales a un lugar abierto, lejos de edificios y árboles, y esperas unos segundos. Si marcas igual, el punto se guarda con su precisión real y queda señalado en la lista.</p>' +
      '<div class="btns"><button class="btn btn-primary" data-act="closeSheet">Esperar</button><button class="btn" data-act="markAnyway">Marcar igual</button></div>');
  }
  // GPS apagado o sin permiso: pregunta si se sigue sin GPS. Devuelve true si el aviso quedó en pantalla (o ya lo estaba)
  // y false si quien llama debe avisar con el mensaje de siempre: ya se preguntó con este encendido del GPS (una sola vez,
  // para no insistir) o hay otra ventana abierta que no se debe pisar (puede tener datos escritos).
  function askNoGps(err) {
    if (ui.gpsAsking) return true;
    if (ui.gpsAsked || ui.sheetOpen) return false;
    var n = Gps.offNotice(err);
    ui.gpsAsked = true;
    openSheet('¿Usar sin GPS?',
      '<div class="warn">' + esc(n.main) + '</div>' +
      '<p class="small muted">' + esc(n.yes) + ' ' + esc(n.no) + '</p>' +
      '<div class="btns"><button class="btn btn-primary" data-act="noGpsYes">Sí</button><button class="btn" data-act="closeSheet">No</button></div>');
    ui.gpsAsking = true;
    return true;
  }
  function useWithoutGps() {
    cancelMark();
    gpsStop();
    closeSheet();
    toast('Sin GPS: toca el mapa o escribe las coordenadas a mano.');
  }
  function removePoint(id) {
    var p = proj(), i = p.points.map(function (x) { return x.id; }).indexOf(id);
    if (i < 0) return;
    p.points.splice(i, 1);
    save(); renderTab(ui.tab);
  }

  /* ---------- Puntos ---------- */
  function addPoint(d) {
    var p = proj();
    var pt = {
      id: Store.uid(), name: d.name || ('P' + p.nextPoint), lat: d.lat, lon: d.lon,
      alt: isNum(d.alt) ? d.alt : null, altGps: isNum(d.altGps) ? d.altGps : null, altSrc: isNum(d.alt) ? (d.altSrc || 'manual') : null,
      acc: isNum(d.acc) ? d.acc : null, altAcc: isNum(d.altAcc) ? d.altAcc : null, src: d.src || 'manual', ts: Date.now()
    };
    p.nextPoint++;
    p.points.push(pt);
    save();
    return pt;
  }
  function pointById(id) { return proj().points.filter(function (p) { return p.id === id; })[0]; }

  function altChip(p) {
    if (!isNum(p.alt)) return '<span class="alt alt-none">sin altitud</span>';
    var lab = p.altSrc === 'gps' ? 'GPS' : p.altSrc === 'internet' ? 'internet' : 'a mano';
    return '<span class="alt alt-' + (p.altSrc || 'manual') + '">' + Fmt.num(p.alt, 0) + ' m · ' + lab + '</span>';
  }

  function tabPuntos() {
    var p = proj(), h = '';
    var sampling = ui.sampling;
    // Arriba, las formas de agregar un punto; la posición del GPS solo ocupa lugar cuando el GPS está encendido
    h += '<div class="block"><h2>Agregar un punto</h2>';
    if (sampling) {
      h += '<div class="prog"><i id="progBar"></i></div><p class="small muted" id="progTxt">Esperando la primera lectura del GPS…</p>';
      h += '<div class="btns"><button class="btn btn-danger" data-act="cancelMark">Cancelar</button></div>';
    } else {
      h += '<div class="addgrid">' + (ui.gpsOn ? '<button class="btn btn-primary" data-act="mark">Marcar punto aquí</button>' : '<button class="btn btn-primary" data-act="gpsOn">Activar GPS</button>') +
        '<button class="btn" data-act="addCoords">Escribir coordenadas</button><button class="btn" data-act="addBulk">Pegar varias coordenadas</button><button class="btn" data-act="importFile">Importar archivo</button></div>';
    }
    h += '<div class="readout"' + (ui.gpsOn || sampling ? '' : ' hidden') + '><div><span class="k">Latitud</span><span class="v" id="rLat">—</span></div><div><span class="k">Longitud</span><span class="v" id="rLon">—</span></div>' +
         '<div><span class="k">Altitud</span><span class="v" id="rAlt">—</span></div><div><span class="k">Precisión</span><span class="v" id="rAcc">—</span></div></div>' +
         '<div id="precBanner" hidden></div>';
    if (!sampling && ui.gpsOn) h += '<p class="small muted">Quédate quieto unos 10 segundos: se promedian las lecturas para mejorar la posición y la altitud. <button class="link" data-act="gpsOff">Apagar GPS</button></p>';
    else if (!sampling) h += '<p class="small muted">Con el GPS activo, la altitud del punto se toma sola y la puedes corregir a mano.</p>';
    h += '<label class="f f-inline"><span>Precisión mínima del GPS</span><select data-setting="minAcc" title="Si el GPS está menos preciso que esto, la app te avisa antes de marcar y tú decides. No bloquea nada.">' +
      [[0, 'Sin límite'], [3, '±3 m (muy exigente)'], [5, '±5 m'], [10, '±10 m'], [20, '±20 m (campo difícil)']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === S.settings.minAcc ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>';
    h += '</div>';

    h += '<div class="block"><h2>Puntos' + (p.points.length ? '<span class="count">' + p.points.length + '</span>' : '') + '</h2>';
    if (!p.points.length) {
      h += '<div class="empty"><b>Aún no hay puntos</b>Marca tu primer punto con el GPS o escribe unas coordenadas. Con 3 o más puntos se calcula el área.</div>';
    } else {
      h += '<ul class="list">';
      p.points.forEach(function (pt) {
        var low = Gps.precisionState(pt.acc, S.settings.minAcc).worse;
        h += '<li><button class="row pt" data-act="editPoint" data-id="' + esc(pt.id) + '" style="--pc:' + Mapa.pointColor(pt, p.mainColor) + '"><span class="pname">' + esc(pt.name) + '</span>' +
          '<span class="pcoord">' + Fmt.latlon(pt.lat, pt.lon) + (isNum(pt.acc) ? '<span class="psub' + (low ? ' low' : '') + '">precisión ±' + Math.round(pt.acc) + ' m' + (low ? ' · menos preciso que tu mínimo' : '') + '</span>' : '<span class="psub">' + (pt.src === 'gps' ? 'GPS' : pt.src === 'archivo' ? 'de un archivo' : 'escrito a mano') + '</span>') + photoStrip(pt) + '</span>' +
          altChip(pt) + '</button></li>';
      });
      h += '</ul>';
    }
    h += '</div>';
    h += layersBlock();
    return h;
  }

  /* ---------- Capas importadas y colores ---------- */
  var KIND_TXT = { polygon: 'Polígono', line: 'Línea', points: 'Puntos' };
  function layerSub(l) {
    var n = l.points.length;
    if (l.kind === 'polygon' && n >= 3) return 'Polígono · ' + n + ' vértices · ' + Fmt.area(Geo.areaUnits(Geo.polygonArea(l.points)), 'ha');
    if (l.kind === 'line' && n >= 2) return 'Línea · ' + n + ' puntos · ' + Fmt.dist(Geo.perimeter(l.points, false));
    return (KIND_TXT[l.kind] || 'Capa') + ' · ' + n + (n === 1 ? ' punto' : ' puntos');
  }
  function swatch(color, act, id, label) {
    return '<button class="swatch" style="background:' + esc(color) + '" data-act="' + act + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + ' aria-label="' + esc(label) + '"></button>';
  }
  function layersBlock() {
    var p = proj();
    var h = '<div class="block"><h2>Colores y capas' + (p.layers.length ? '<span class="count">' + p.layers.length + '</span>' : '') + '</h2>';
    if (p.layers.length) h += '<p class="small muted">Tus puntos se usan para el área y la zona de vida. Lo importado queda en capas de otro color, sin mezclarse con ellos.</p>';
    h += '<ul class="layers"><li class="layer">' + swatch(p.mainColor, 'editMain', '', 'Cambiar el color de mis puntos') +
      '<div class="lname"><b>Mis puntos</b><span class="psub">' + p.points.length + (p.points.length === 1 ? ' punto' : ' puntos') + '</span></div></li>';
    p.layers.forEach(function (l) {
      h += '<li class="layer' + (l.visible === false ? ' off' : '') + '">' + swatch(l.color, 'editLayer', l.id, 'Editar ' + l.name) +
        '<div class="lname"><b>' + esc(l.name) + '</b><span class="psub">' + esc(layerSub(l)) + (l.file ? ' · ' + esc(l.file) : '') + '</span></div>' +
        '<button class="mini" data-act="toggleLayer" data-id="' + esc(l.id) + '" aria-pressed="' + (l.visible !== false) + '" aria-label="' + (l.visible === false ? 'Mostrar ' : 'Ocultar ') + esc(l.name) + '">' + (l.visible === false ? 'Oculta' : 'Visible') + '</button>' +
        '<button class="mini" data-act="editLayer" data-id="' + esc(l.id) + '">Editar</button></li>';
    });
    h += '</ul>';
    if (!p.layers.length) h += '<p class="small muted">Aún no hay capas. Usa «Importar archivo» para traer un polígono de Google Earth (KML o KMZ), un GeoJSON o un GPX.</p>';
    return h + '</div>';
  }
  function layerById(id) { return proj().layers.filter(function (l) { return l.id === id; })[0]; }

  // used (opcional): { '#RRGGBB': 'nombre de quien ya lo usa' } → esos colores llevan una marca y lo dicen al lector de pantalla
  function colorPalette(current, used) {
    used = used || {};
    return '<div class="palette" role="group" aria-label="Color">' + LOT_COLORS.map(function (c) {
      var who = used[c.toUpperCase()];
      return '<button class="sw' + (who ? ' used' : '') + '" style="background:' + c + '" data-act="pickColor" data-color="' + c + '" aria-pressed="' + (c.toLowerCase() === String(current).toLowerCase()) +
        '" aria-label="Color ' + c + (who ? ' (ya lo usa «' + esc(who) + '»)' : '') + '"></button>';
    }).join('') + '</div>';
  }
  /* ---------- Predios y lotes: fila, lista, ficha, importar directo y borrar (en js/ui-lotes.js desde 2.28.0) ---------- */
  var Lotes = window.ZV.lotes({ S: S, ui: ui, '$': $, adjustManyAsk: function () { return adjustManyAsk.apply(null, arguments); }, closeSheet: closeSheet, colorPalette: colorPalette, esc: esc, finishTrack: function () { return finishTrack.apply(null, arguments); }, hideSheet: hideSheet, isNum: isNum, layerById: layerById, layerSub: layerSub, lot: lot, lotArea: lotArea, mapKey: function () { return mapKey.apply(null, arguments); }, openSheet: openSheet, proj: proj, renderTab: renderTab, save: save, setMapMode: function () { return setMapMode.apply(null, arguments); }, setMapTool: function () { return setMapTool.apply(null, arguments); }, showTab: showTab, syncMapCard: function () { return syncMapCard.apply(null, arguments); }, toast: toast, toolsInset: function () { return toolsInset.apply(null, arguments); }, toolsTop: function () { return toolsTop.apply(null, arguments); } });
  var LOCKED_ACTS = Lotes.LOCKED_ACTS, LOT_COLORS = Lotes.LOT_COLORS, deleteLayer = Lotes.deleteLayer, editLayer = Lotes.editLayer, editMain = Lotes.editMain, fincaLines = Lotes.fincaLines, hasLots = Lotes.hasLots, hugeInfo = Lotes.hugeInfo, hugePoint = Lotes.hugePoint, hugeTip = Lotes.hugeTip, layerToLot = Lotes.layerToLot, layerToMain = Lotes.layerToMain, lockStop = Lotes.lockStop, lotDelete = Lotes.lotDelete, lotDeleteAsk = Lotes.lotDeleteAsk, lotDeleteBox = Lotes.lotDeleteBox, lotFileRead = Lotes.lotFileRead, lotForm = Lotes.lotForm, lotFormRead = Lotes.lotFormRead, lotFormRefresh = Lotes.lotFormRefresh, lotImport = Lotes.lotImport, lotReset = Lotes.lotReset, lotSave = Lotes.lotSave, lotSetCat = Lotes.lotSetCat, lotSetKind = Lotes.lotSetKind, lotsBar = Lotes.lotsBar, openLots = Lotes.openLots, pickColor = Lotes.pickColor, pickLot = Lotes.pickLot, pointColorDefault = Lotes.pointColorDefault, restoreSnapshot = Lotes.restoreSnapshot, saveEdit2 = Lotes.saveEdit2, setLock = Lotes.setLock, snapshot = Lotes.snapshot, toggleLayer = Lotes.toggleLayer;

  /* ---------- Importar archivos SIG (KML, KMZ, GeoJSON, GPX) ---------- */
  function importGis(file) {
    IO.readBytes(file).then(function (bytes) {
      var res = Gis.parseBytes(bytes);
      if (!res.features.length) throw new Error('El archivo no tiene polígonos, líneas ni puntos.');
      ui.imp = { res: res, file: file.name || 'archivo' };
      showImportSheet();
    }).catch(function (e) { toast('No se pudo importar: ' + (e && e.message || e), { err: true }); });
  }
  function importSummaryText(sum) {
    var bits = [];
    if (sum.polygons) bits.push(sum.polygons + (sum.polygons === 1 ? ' polígono' : ' polígonos'));
    if (sum.lines) bits.push(sum.lines + (sum.lines === 1 ? ' línea' : ' líneas'));
    if (sum.points) bits.push(sum.points + (sum.points === 1 ? ' punto' : ' puntos'));
    var t = bits.join(', ') + ' · ' + sum.vertices + ' vértices';
    if (sum.areaM2 > 0) t += ' · ' + Fmt.area(Geo.areaUnits(sum.areaM2), 'ha');
    return t;
  }
  function showImportSheet() {
    var imp = ui.imp, p = proj();
    if (!imp) return;
    var sum = Gis.summarize(imp.res.features), has = p.points.length > 0;
    var h = '<p class="lead"><b>' + esc(imp.file) + '</b> (' + esc(String(imp.res.format).toUpperCase()) + ')<br>' + esc(importSummaryText(sum)) + '</p>';
    if (sum.items.length > 1 && sum.items.length <= 8) {
      h += '<ul class="chiplist">' + sum.items.map(function (it) { return '<li>' + esc(it.name || KIND_TXT[it.type === 'point' ? 'points' : it.type]) + '</li>'; }).join('') + '</ul>';
    }
    (imp.res.warnings || []).forEach(function (w) { h += '<p class="small muted" style="margin:4px 0">• ' + esc(w) + '</p>'; });
    if (has) {
      h += '<div class="warn"><b>Este proyecto ya tiene ' + p.points.length + (p.points.length === 1 ? ' punto' : ' puntos') + '.</b> Lo que importes se agrega como una capa aparte, con otro color: no cambia tu área ni tu zona de vida. Podrás cambiarle el color y el nombre, o usarla como polígono del proyecto.</div>';
      h += '<div class="btns"><button class="btn btn-primary" data-act="importLayer">Agregar como capa nueva</button><button class="btn btn-danger" data-act="importMain">Reemplazar mis puntos</button><button class="btn" data-act="importNew">Crear proyecto nuevo</button></div>';
    } else {
      h += '<p class="small muted">Este proyecto está vacío: puedes usar lo importado como tu polígono (se calcula el área y la zona de vida) o dejarlo solo como capa de referencia.</p>';
      h += '<div class="btns"><button class="btn btn-primary" data-act="importMain">Usar como polígono del proyecto</button><button class="btn" data-act="importLayer">Solo como capa</button></div>';
    }
    openSheet('Importar archivo', h);
  }
  function newLayersFromImport(p) {
    var imp = ui.imp;
    return Gis.toLayers(imp.res.features, { file: imp.file, startAt: p.layers.length, uid: Store.uid });
  }
  // Para usar como polígono principal: el polígono más grande; si no hay, la primera línea; si no, los puntos
  function pickMainLayer(layers) {
    var best = null, bestA = -1;
    layers.forEach(function (l) { if (l.kind === 'polygon' && l.points.length >= 3) { var a = Geo.polygonArea(l.points); if (a > bestA) { bestA = a; best = l; } } });
    return best || layers.filter(function (l) { return l.kind === 'line'; })[0] || layers[0];
  }
  function finishImport(msg, undoFn) {
    ui.imp = null;
    save(); closeSheet(); renderTab(ui.tab);
    toast(msg, undoFn ? { action: 'Deshacer', fn: undoFn } : undefined);
  }
  function importLayer() {
    if (!ui.imp) return;
    var p = proj(), s = snapshot(p), nl;
    try { nl = newLayersFromImport(p); } catch (e) { toast(e.message, { err: true }); return; }
    p.layers = p.layers.concat(nl);
    finishImport(nl.length + (nl.length === 1 ? ' capa agregada' : ' capas agregadas') + ' al proyecto.', function () { restoreSnapshot(p, s); });
  }
  function applyMain(p, nl) {
    var main = pickMainLayer(nl);
    p.points = Gis.pointsFromLayer(main, Store.uid);
    p.nextPoint = p.points.length + 1;
    p.layers = p.layers.concat(nl.filter(function (l) { return l !== main; }));
    return main;
  }
  function importMain() {
    if (!ui.imp) return;
    var p = proj(), s = snapshot(p), nl;
    try { nl = newLayersFromImport(p); } catch (e) { toast(e.message, { err: true }); return; }
    var main = applyMain(p, nl);
    finishImport('«' + main.name + '» es ahora el polígono del proyecto' + (s.points.length ? '; tus puntos anteriores se reemplazaron.' : '.'), s.points.length ? function () { restoreSnapshot(p, s); } : null);
  }
  function importNew() {
    if (!ui.imp) return;
    var base = ui.imp.file.replace(/\.[^.]+$/, '').replace(/\.(kml|json|geojson|gpx)$/i, '') || 'Importado';
    var np = Store.newProject(base.slice(0, 60)), prev = S.currentId, nl;
    try { nl = newLayersFromImport(np); } catch (e) { toast(e.message, { err: true }); return; }
    applyMain(np, nl);
    S.projects.push(np); S.currentId = np.id;
    ui.imp = null; save(); closeSheet(); renderAll();
    toast('Proyecto «' + np.name + '» creado con lo importado.', { action: 'Deshacer', fn: function () { S.projects = S.projects.filter(function (x) { return x.id !== np.id; }); S.currentId = prev; save(); renderAll(); } });
  }

  /* ---------- Exportar (en js/ui-exportar.js desde 2.24.0) ---------- */
  var Exportar = window.ZV.exportar({ S: S, ui: ui, proj: proj, multi: multi, esc: esc, lotArea: lotArea, toast: toast,
    openSheet: openSheet, closeSheet: closeSheet, renderTab: renderTab, viewLayers: viewLayers });
  var exportBlock = Exportar.exportBlock, exportAs = Exportar.exportAs, openExpPick = Exportar.openExpPick, expPickDone = Exportar.expPickDone;

  function coordFormBody(pt) {
    var isEdit = !!pt;
    var h = '';
    if (isEdit) h += '<label class="f"><span>Nombre</span><input type="text" id="fName" value="' + esc(pt.name) + '" autocomplete="off"></label>';
    h += '<label class="f"><span>Coordenadas</span><input type="text" id="fCoord" value="' + (isEdit ? esc(Fmt.latlon(pt.lat, pt.lon, 6)) : '') + '" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="4.6097, -74.0817">' +
      '<span class="hint">Latitud y longitud en grados decimales (4.6097, -74.0817) o en grados, minutos y segundos (4°36\'35"N 74°04\'54"W).</span></label>';
    h += '<div class="preview" id="fPrev"></div>';
    h += '<label class="f"><span>Altitud en metros (opcional)</span><input type="text" id="fAlt" inputmode="decimal" value="' + (isEdit && isNum(pt.alt) ? esc(Fmt.num(pt.alt, 0)) : '') + '" autocomplete="off" placeholder="2640">' +
      '<span class="hint" id="fAltHint">' + (isEdit ? altHint(pt) : 'Si la dejas vacía puedes completarla después con internet, o escribirla cuando la sepas.') + '</span></label>';
    if (!isEdit && ui.gpsOn && ui.fix && isNum(ui.fix.alt)) h += '<button class="btn btn-block" style="margin-bottom:14px" data-act="altFromGps">Estoy en este punto: usar la altitud del GPS (' + Fmt.num(ui.fix.alt, 0) + ' m)</button>';
    if (isEdit && isNum(pt.altGps) && pt.alt !== pt.altGps) h += '<button class="btn btn-block" style="margin-bottom:14px" data-act="restoreGps" data-id="' + esc(pt.id) + '">Restaurar altitud del GPS (' + Fmt.num(pt.altGps, 0) + ' m)</button>';
    if (!isEdit) h += '<label class="f"><span>Nombre (opcional)</span><input type="text" id="fName" autocomplete="off" placeholder="P' + proj().nextPoint + '"></label>';
    if (isEdit) {
      // Color propio y leyenda (una nota que solo se ve en esta ficha) y los datos con los que se guardó el punto
      h += '<div class="f"><span style="display:block;margin-bottom:6px;font-weight:650">Color del punto</span>' + colorPalette(pt.color || '') +
        '<button class="chipbtn" data-act="pointColorDefault" aria-pressed="' + !pt.color + '">Usar el color de mis puntos</button></div>';
      h += '<label class="f"><span>Leyenda (opcional)</span><textarea id="fNote" maxlength="' + NOTE_MAX + '" rows="3" style="min-height:84px" placeholder="Por ejemplo: esquina junto al roble">' + esc(pt.note || '') + '</textarea>' +
        '<span class="hint">Una nota para ti. Solo se ve en esta ficha: no se dibuja en el mapa ni sale en el reporte.</span></label>';
      h += '<div class="f" id="fPhotosWrap">' + photosBody(pt) + '</div>';
      h += pointInfo(pt);
      h += '<div class="btns"><button class="btn btn-primary" data-act="saveEdit" data-id="' + esc(pt.id) + '">Guardar cambios</button><button class="btn btn-danger" data-act="askDelete" data-id="' + esc(pt.id) + '">Eliminar punto</button></div>';
    } else {
      h += '<div class="btns"><button class="btn btn-primary" data-act="saveNew" data-more="0">Guardar punto</button><button class="btn" data-act="saveNew" data-more="1">Guardar y añadir otro</button></div>';
    }
    return h;
  }
  var NOTE_MAX = 300;
  var SRC_TXT = { gps: 'GPS', archivo: 'archivo importado', manual: 'a mano' };
  // Otros datos del punto, solo para leer
  function pointInfo(pt) {
    var rows = [['Origen de la posición', SRC_TXT[pt.src] || SRC_TXT.manual]];
    if (isNum(pt.acc)) rows.push(['Precisión del GPS', '±' + Math.round(pt.acc) + ' m']);
    if (isNum(pt.altGps)) rows.push(['Altitud del GPS', Fmt.num(pt.altGps, 0) + ' m' + (isNum(pt.altAcc) ? ' (±' + Math.round(pt.altAcc) + ' m)' : '')]);
    var when = isNum(pt.ts) ? Fmt.dateTime(pt.ts) : '';
    if (when) rows.push(['Guardado', when]);
    return '<h3 class="sub">Otros datos</h3><dl class="kv" style="margin-bottom:14px">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
  }
  function altHint(pt) {
    if (!isNum(pt.alt)) return 'Sin altitud. Escríbela o complétala con internet desde la pestaña Información.';
    if (pt.altSrc === 'gps') return 'Altitud tomada del GPS' + (isNum(pt.altAcc) ? ' (±' + Math.round(pt.altAcc) + ' m)' : '') + '. Puedes corregirla escribiendo otro valor.';
    if (pt.altSrc === 'internet') return 'Altitud obtenida de internet (modelo digital de elevación). Puedes corregirla.';
    return 'Altitud escrita a mano.';
  }

  function bindCoordPreview() {
    var inp = $('#fCoord'), prev = $('#fPrev');
    function upd() {
      var v = inp.value.trim();
      if (!v) { prev.textContent = ''; prev.className = 'preview'; return; }
      var r = Geo.parsePair(v);
      if (r.error) { prev.textContent = r.error; prev.className = 'preview err'; }
      else { var pl = Fmt.plana(r.lat, r.lon); prev.textContent = Geo.toDMS(r.lat, 'lat', 1) + '   ' + Geo.toDMS(r.lon, 'lon', 1) + (pl ? '\nPlanas (Origen Nacional): ' + pl : ''); prev.className = 'preview'; }
    }
    inp.addEventListener('input', upd); upd();
  }

  function openAdd() {
    openSheet('Escribir coordenadas', coordFormBody(null), bindCoordPreview);
  }
  function saveNew(more) {
    var r = Geo.parsePair($('#fCoord').value);
    if (r.error) { toast(r.error === 'Vacío' ? 'Escribe las coordenadas.' : r.error, { err: true }); return; }
    var a = parseNum($('#fAlt').value);
    if (a.error) { toast('Altitud: ' + a.error, { err: true }); return; }
    var name = $('#fName').value.trim();
    var pt = addPoint({ lat: r.lat, lon: r.lon, alt: a.value, altSrc: 'manual', name: name || undefined, src: 'manual' });
    toast(pt.name + ' guardado.');
    if (more) { hideSheet(); ui.sheetOpen = false; openAdd(); } else closeSheet();
    renderTab(ui.tab);
    if (!more) adjustCheck();
  }
  function openEdit(id) {
    var pt = pointById(id); if (!pt) return;
    ui.edit = { kind: 'point', id: id, color: pt.color || '' };
    openSheet('Ficha de ' + pt.name, coordFormBody(pt), function (el) { bindCoordPreview(); hydratePhotos(el); });
  }
  // Cambiar la posición de un punto: si se movió de verdad (≥ 0,5 m) ya no es la que midió el GPS, así que pasa a ser «a mano» y sin precisión de GPS.
  function relocate(pt, lat, lon) {
    var moved = Geo.haversine(pt.lat, pt.lon, lat, lon) >= 0.5;
    pt.lat = lat; pt.lon = lon;
    if (moved) { pt.src = 'manual'; pt.acc = null; }
    return moved;
  }
  function saveEdit(id) {
    var pt = pointById(id); if (!pt) return;
    var r = Geo.parsePair($('#fCoord').value);
    if (r.error) { toast(r.error, { err: true }); return; }
    var a = parseNum($('#fAlt').value);
    if (a.error) { toast('Altitud: ' + a.error, { err: true }); return; }
    pt.name = $('#fName').value.trim() || pt.name;
    relocate(pt, r.lat, r.lon);
    var e = ui.edit && ui.edit.kind === 'point' && ui.edit.id === id ? ui.edit : null;
    if (e) { if (e.color) pt.color = e.color; else delete pt.color; }
    var note = $('#fNote') ? $('#fNote').value.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX).trim() : '';
    if (note) pt.note = note; else delete pt.note;
    if (a.empty) { pt.alt = null; pt.altSrc = null; }
    // El campo muestra la altitud sin decimales (2639) y la guardada puede ser 2639,4: solo cuenta como
    // corrección a mano si el valor escrito cambia de verdad (≥ 0,5 m). Así renombrar un punto no la toca.
    else if (!isNum(pt.alt) || Math.abs(a.value - pt.alt) >= 0.5) { pt.alt = a.value; pt.altSrc = 'manual'; }
    save(); closeSheet(); renderTab(ui.tab); toast('Cambios guardados.');
  }
  function askDelete(id) {
    var pt = pointById(id); if (!pt) return;
    hideSheet();
    openSheet('¿Eliminar ' + pt.name + '?', '<p>Se quita este punto del proyecto. Las demás coordenadas no cambian.</p><div class="btns"><button class="btn btn-danger" data-act="doDelete" data-id="' + esc(id) + '">Eliminar</button><button class="btn" data-act="closeSheet">Conservar</button></div>');
  }
  function doDelete(id) {
    var p = proj(), i = p.points.map(function (x) { return x.id; }).indexOf(id);
    if (i < 0) return;
    undoMark('eliminar ' + p.points[i].name);
    var removed = p.points.splice(i, 1)[0];
    save(); closeSheet(); renderTab(ui.tab);
    toast(removed.name + ' eliminado.', { action: 'Deshacer', fn: function () { p.points.splice(i, 0, removed); save(); renderTab(ui.tab); } });
  }

  function openBulk() {
    openSheet('Pegar varias coordenadas',
      '<p class="lead">Una por línea: <b>latitud, longitud</b> y, si la tienes, <b>| altitud</b>.</p>' +
      '<pre class="code">4.6097, -74.0817 | 2640\n4.6101, -74.0809 | 2655\n4°36\'35"N 74°04\'54"W</pre>' +
      '<label class="f"><span>Lista de puntos</span><textarea id="bulk" spellcheck="false" autocapitalize="characters"></textarea></label>' +
      '<div class="preview" id="bulkPrev"></div>' +
      '<div class="btns"><button class="btn btn-primary" data-act="saveBulk">Agregar puntos</button></div>',
      function () { $('#bulk').addEventListener('input', function () { var r = parseBulk($('#bulk').value); $('#bulkPrev').className = 'preview' + (r.errors.length ? ' err' : ''); $('#bulkPrev').textContent = r.items.length ? r.items.length + ' punto(s) válidos' + (r.errors.length ? ' · ' + r.errors[0] : '') : (r.errors[0] || ''); }); });
  }
  function parseBulk(text) {
    var items = [], errors = [];
    String(text).split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var parts = line.split('|');
      var pair = Geo.parsePair(parts[0]);
      if (pair.error) { errors.push('Línea ' + (i + 1) + ': ' + pair.error); return; }
      var alt = null;
      if (parts[1] !== undefined && parts[1].trim() !== '') {
        var a = parseNum(parts[1]);
        if (a.error) { errors.push('Línea ' + (i + 1) + ': altitud no válida'); return; }
        alt = a.value;
      }
      items.push({ lat: pair.lat, lon: pair.lon, alt: alt, name: parts[2] ? parts[2].trim() : undefined });
    });
    return { items: items, errors: errors };
  }
  function saveBulk() {
    var r = parseBulk($('#bulk').value);
    if (!r.items.length) { toast(r.errors[0] || 'Escribe al menos una coordenada.', { err: true }); return; }
    if (r.errors.length) { toast(r.errors[0] + '. Corrígela y vuelve a intentar: no se agregó nada.', { err: true }); return; }
    r.items.forEach(function (it) { addPoint({ lat: it.lat, lon: it.lon, alt: it.alt, altSrc: 'manual', name: it.name, src: 'manual' }); });
    closeSheet(); renderTab(ui.tab); toast(r.items.length + ' punto(s) agregados.');
  }

  /* ---------- Polígono (Croquis y Mapa) ---------- */
  function tabArea() {
    // En la vista Mapa no va el título: ese alto se le deja al mapa (la pestaña y el selector ya dicen dónde se está)
    var h = (ui.polyView === 'mapa' ? '<h2 class="sr-only">Polígono del terreno: mapa</h2>' : '<h2 class="pagetitle">Polígono del terreno</h2>') + '<div class="seg" role="group" aria-label="Vista del polígono">';
    [['croquis', 'Croquis'], ['mapa', 'Mapa']].forEach(function (v) {
      h += '<button data-act="polyView" data-v="' + v[0] + '" aria-pressed="' + (ui.polyView === v[0]) + '">' + v[1] + '</button>';
    });
    return h + '</div>' + (ui.polyView === 'mapa' ? mapaHtml() : croquisHtml());
  }
  function croquisHtml() {
    var p = proj(), a = analysis(), h = '';
    var VL = viewLayers(p), shown = VL.filter(function (l) { return l.visible !== false && l.points.length; });
    if (a.empty) {
      if (!shown.length) return '<div class="empty"><b>Sin puntos todavía</b>Agrega al menos 3 puntos en la pestaña Puntos para calcular un área.</div>';
      // 2.23.3: con otros polígonos ya marcados, lo que falta son los puntos de este (no es un proyecto «solo de capas»)
      h += p.lots.some(function (x) { return x.points.length; }) ?
        '<div class="tip" id="lotEmptyTip">«' + esc(lot().name) + '» todavía no tiene puntos. Márcalos en el mapa, con el GPS o escribiendo coordenadas.</div>' :
        '<div class="tip">Tu proyecto no tiene puntos propios, solo capas importadas. Para calcular el área y la zona de vida, abre una capa en la pestaña Puntos y elige «Usar como polígono del proyecto».</div>';
      h += '<div class="plot">' + Diagram.polygonSVG([], { layers: VL, color: p.mainColor }) + '</div>' + Diagram.legendHTML(VL, p.mainColor, ownLabel(), false);
      return h + exportBlock();
    }
    var unit = S.settings.areaUnit || 'ha';
    var plotOpts = { center: a.center, layers: VL, color: p.mainColor, dots: Predio.isArea(lot()) };
    var legend = Diagram.legendHTML(VL, p.mainColor, ownLabel(), true);
    if (!a.polygon) {
      h += '<div class="tip">Hay ' + a.n + ' punto' + (a.n > 1 ? 's' : '') + '. Con 3 o más se calcula el área.</div>';
      h += '<div class="plot">' + Diagram.polygonSVG(p.points, plotOpts) + '</div>' + legend;
      if (a.n === 2) h += '<dl class="kv" style="margin-top:12px"><div><dt>Distancia entre los dos puntos</dt><dd>' + Fmt.dist(a.perimeter) + '</dd></div></dl>';
      return h + exportBlock();
    }
    h += '<div class="block"><span class="big">' + Fmt.area(a.area, unit).replace(/ (\S+)$/, ' <small>$1</small>') + '</span>';
    h += '<div class="seg" role="group" aria-label="Unidad del área" style="margin-top:12px">';
    ['ha', 'm2', 'km2', 'fanegadas'].forEach(function (u) { h += '<button data-act="unit" data-u="' + u + '" aria-pressed="' + (u === unit) + '">' + Fmt.UNITS[u].label + '</button>'; });
    h += '</div>';
    if (a.selfIntersects) {
      h += '<div class="warn"><b>Los lados se cruzan.</b> Los puntos no siguen el contorno en orden, y el área puede estar mal. <div class="btns"><button class="btn btn-block" data-act="reorder">Ordenar los puntos alrededor del centro</button></div></div>';
    }
    h += '<div class="plot">' + Diagram.polygonSVG(p.points, { center: a.center, bad: a.selfIntersects, layers: VL, color: p.mainColor, dots: Predio.isArea(lot()) }) + '</div>' + legend;
    h += '<p class="small muted">Los puntos se unen en el orden en que están en la lista y el último se une con el primero. El círculo rojo es el centro.</p></div>';

    h += '<div class="block"><h2>Medidas</h2><dl class="kv">';
    ['ha', 'm2', 'km2', 'fanegadas'].forEach(function (u) { h += '<div><dt>' + Fmt.UNITS[u].long + '</dt><dd>' + Fmt.area(a.area, u) + '</dd></div>'; });
    h += '<div><dt>Perímetro</dt><dd>' + Fmt.dist(a.perimeter) + '</dd></div>';
    h += '<div><dt>Vértices</dt><dd>' + a.n + '</dd></div>';
    if (multi(p)) {
      var acc0 = Predio.account(p.lots), tot = acc0.total, nc = acc0.closed;      // las áreas que están dentro de una finca no se suman otra vez
      h += '<div><dt>Total del proyecto (' + nc + (nc === 1 ? ' lote cerrado' : ' lotes cerrados') + ')</dt><dd id="areaTotal">' + Fmt.area(Geo.areaUnits(tot), unit) + '</dd></div>';
    }
    h += '<div><dt>Centro</dt><dd>' + Fmt.latlon(a.center.lat, a.center.lon) + '</dd></div>';
    var cpl = Fmt.plana(a.center.lat, a.center.lon);
    if (cpl) h += '<div><dt>Centro en planas (Origen Nacional)</dt><dd id="areaPlana">' + esc(cpl) + '</dd></div>';
    if (a.alt.min !== null && a.alt.n > 1) h += '<div><dt>Altitud de los puntos</dt><dd>' + Fmt.num(a.alt.min, 0) + ' a ' + Fmt.num(a.alt.max, 0) + ' m</dd></div>';
    var ovl = multi(p) ? Predio.warnings(p.lots) : [];
    h += '</dl>' + (multi(p) ? fincaLines(Predio.account(p.lots)) : '') + hugeTip() + (ovl.length ? '<div class="tip" id="areaOverlap">' + ovl.map(esc).join('<br>') + '</div>' : '') +
      (multi(p) && !lot().locked && Predio.conflicts(p.lots, p.lotId) ? '<div class="btns" style="margin:8px 0"><button class="btn" data-act="adjustAsk" id="adjBtn">Ajustar «' + esc(lot().name) + '» a los linderos</button></div>' : '') + '<p class="small muted">Área calculada sobre el elipsoide WGS84. La precisión depende de la de las coordenadas: con GPS de teléfono (±5 m) una finca pequeña puede variar varios por ciento.</p></div>';

    h += '<div class="block"><h2>Lados</h2><dl class="kv">';
    var pts = p.points, n = pts.length;
    for (var i = 0; i < n; i++) {
      var b = pts[i], c = pts[(i + 1) % n];
      h += '<div><dt>' + esc(b.name) + ' → ' + esc(c.name) + '</dt><dd>' + Fmt.dist(Geo.distance(b.lat, b.lon, c.lat, c.lon)) + ' · rumbo ' + Math.round(Geo.bearing(b.lat, b.lon, c.lat, c.lon)) + '°</dd></div>';
    }
    h += '</dl></div>';
    return h + exportBlock();
  }
  function reorder() {
    var p = proj();
    if (p.points.length < 3) { toast('Hacen falta al menos 3 puntos para ordenarlos.'); return; }
    var before = p.points.slice();
    undoMark('ordenar los puntos');
    var order = Geo.angularOrder(p.points);
    p.points = order.map(function (i) { return before[i]; });
    save(); renderTab('area');
    toast('Puntos reordenados.', { action: 'Deshacer', fn: function () { p.points = before; save(); renderTab('area'); } });
  }

  /* ---------- Polígono: vista Mapa (en js/ui-mapa.js desde 2.28.0) ---------- */
  var MapaUI = window.ZV.mapa({ S: S, ui: ui, '$': $, addPoint: addPoint, analysis: analysis, closeSheet: closeSheet, esc: esc, gpsStart: gpsStart, hugeInfo: hugeInfo, isNum: isNum, lockStop: lockStop, lot: lot, lotLayers: lotLayers, multi: multi, openEdit: openEdit, openMapGuide: function () { return openMapGuide.apply(null, arguments); }, igacLayerHtml: function () { return IgacUI.layerHtml(); }, igacSync: function () { return IgacUI.sync(); }, openSheet: openSheet, pickLot: pickLot, pointById: pointById, proj: proj, relocate: relocate, renderTab: renderTab, save: save, toast: toast, view: view, viewLayers: viewLayers });
  var addManualAt = MapaUI.addManualAt, adjustCheck = MapaUI.adjustCheck, adjustDo = MapaUI.adjustDo, adjustMany = MapaUI.adjustMany, adjustManyAsk = MapaUI.adjustManyAsk, adjustSheet = MapaUI.adjustSheet, applyMapFull = MapaUI.applyMapFull, drawMeasure = MapaUI.drawMeasure, finishTrack = MapaUI.finishTrack, fitAll = MapaUI.fitAll, goLastPoint = MapaUI.goLastPoint, goMyPosition = MapaUI.goMyPosition, goToPoint = MapaUI.goToPoint, mapKey = MapaUI.mapKey, mapUndo = MapaUI.mapUndo, mapaHtml = MapaUI.mapaHtml, mountMap = MapaUI.mountMap, navFit = MapaUI.navFit, onMapFix = MapaUI.onMapFix, openMapMore = MapaUI.openMapMore, setMapMode = MapaUI.setMapMode, setMapTool = MapaUI.setMapTool, startTrack = MapaUI.startTrack, syncMapCard = MapaUI.syncMapCard, syncMapChrome = MapaUI.syncMapChrome, syncMapMenu = MapaUI.syncMapMenu, toggleMapFull = MapaUI.toggleMapFull, toolsInset = MapaUI.toolsInset, toolsTop = MapaUI.toolsTop, trackFix = MapaUI.trackFix, undoMark = MapaUI.undoMark, updateMapNotice = MapaUI.updateMapNotice;

  /* ---------- Clima ---------- */
  function srcBadge(src) {
    var map = { manual: ['alt-manual', 'a mano'], online: ['alt-internet', 'internet'], memoria: ['alt-internet', 'memoria'], estimada: ['alt-none', 'estimada'], gps: ['alt-gps', 'GPS'], internet: ['alt-internet', 'internet'], mixta: ['alt-gps', 'varias fuentes'] };
    var m = map[src] || ['alt-none', src || ''];
    return '<span class="alt ' + m[0] + '">' + m[1] + '</span>';
  }
  function numField(field, label, value, hint, ph) {
    return '<label class="f"><span>' + esc(label) + '</span><div class="field-row"><input type="text" inputmode="decimal" data-field="' + field + '" value="' + (isNum(value) ? esc(Fmt.num(value, field === 'tManual' ? 1 : 0)) : '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' +
      (isNum(value) ? '<button class="btn btn-quiet" data-act="clearField" data-field="' + field + '">Quitar</button>' : '') + '</div></label><details class="why"><summary>¿Qué escribo aquí?</summary><span class="hint">' + hint + '</span></details>';
  }

  function tabClima() {
    var a = analysis(), p = proj(), c = p.climate, h = '';
    if (a.empty) return '<div class="empty"><b>Sin puntos todavía</b>Agrega un punto en la pestaña Puntos para ver o completar el clima.</div>';
    var cl = a.climate;

    // Lo primero, lo que más ahorra trabajo: traer los datos de internet (y elegir varios, copiar o limpiar)
    h += Completar.block(a);

    h += '<div class="block"><h2>Altitud</h2>';
    if (a.alt.value !== null) {
      h += '<span class="big">' + Fmt.num(a.alt.value, 0) + ' <small>m</small></span> ' + srcBadge(a.alt.src);
      h += '<p class="small muted">' + (a.alt.src === 'manual' && isNum(c.altOverride) ? 'Corregida a mano para el análisis.' : a.alt.n > 1 ? 'Promedio de ' + a.alt.n + ' puntos (de ' + Fmt.num(a.alt.min, 0) + ' a ' + Fmt.num(a.alt.max, 0) + ' m).' : 'Del punto marcado.') + '</p>';
    } else {
      h += '<div class="tip">Ningún punto tiene altitud. Sin ella no se puede estimar la temperatura: márcalo con el GPS, escríbela aquí o complétala con internet.</div>';
    }
    h += numField('altOverride', 'Corregir la altitud del análisis (m)', c.altOverride, 'Úsala si conoces la altitud real, por ejemplo de un mapa topográfico o de un altímetro. Reemplaza el promedio de los puntos.', 'ej. 2640');
    h += '</div>';

    h += '<div class="block"><h2>Temperatura media anual</h2>';
    if (isNum(cl.T)) {
      h += '<span class="big">' + Fmt.num(cl.T, 1) + ' <small>°C</small></span> ' + srcBadge(cl.TSrc);
    } else h += '<p class="muted">Aún no hay temperatura.</p>';
    h += numField('tManual', 'Escribir la temperatura medida (°C)', c.tManual, 'Si tienes un dato medido (estación, IDEAM, finca vecina) escríbelo: manda sobre cualquier estimación.', 'ej. 14,5');
    h += '</div>';

    h += '<div class="block' + (isNum(cl.P) ? '' : ' need') + '"><h2>Precipitación anual' + (isNum(cl.P) ? '' : '<span class="needtag">falta</span>') + '</h2>';
    if (isNum(cl.P)) h += '<span class="big">' + Fmt.num(cl.P, 0) + ' <small>mm</small></span> ' + srcBadge(cl.PSrc);
    else h += '<div class="tip">La precipitación no se estima: cambia mucho de un valle a otro. Escríbela, importa un archivo de datos o complétala con internet.</div>';
    h += numField('pManual', 'Escribir la precipitación media anual (mm)', c.pManual, 'Suma de la lluvia de un año típico. Si tienes registros de varios años, usa el promedio.', 'ej. 1200');
    h += '</div>';

    (cl.notes || []).concat(a.warnings || []).forEach(function (n) { h += '<p class="small muted" style="margin:4px 0">• ' + esc(n) + '</p>'; });

    h += walterBlock(a);
    h += UsosUI.block(a);

    h += '<div class="block"><h2>Datos guardados en este equipo</h2>';
    h += '<p class="lead">' + (MEM.count ? MEM.count + ' registro' + (MEM.count > 1 ? 's' : '') + ' de clima. Se usan sin conexión para puntos a menos de 25 km.' : 'Todavía no hay datos. Importa un archivo CSV con estaciones o celdas de clima, o completa con internet una vez.') + '</p>';
    h += '<div class="btns"><button class="btn" data-act="importCsv">Importar archivo CSV</button>' + (MEM.count ? '<button class="btn btn-danger" data-act="askClearMem">Borrar datos</button>' : '') + '</div>';
    h += '<details class="help"><summary>Formato del archivo CSV</summary><p class="small">Una fila por lugar. Columnas: <b>lat</b>, <b>lon</b> y <b>temp</b> (°C, media anual) y/o <b>prec</b> (mm por año); opcional <b>alt</b> (m) y <b>nombre</b>. Acepta coma, punto y coma o tabulador, y decimales con punto o coma. También reconoce bio1 y bio12 de WorldClim.</p><pre class="code">lat,lon,alt,temp,prec,nombre\n4.61,-74.08,2640,14.1,1013,Bogotá\n6.25,-75.57,1495,22.0,1600,Medellín</pre></details></div>';
    return h;
  }

  /* ---------- Diagrama de Walter-Lieth ---------- */
  var MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Temperatura y lluvia de los 12 meses (escritos a mano o de internet) → modelo del diagrama, o null si faltan datos
  function walterModel(a) {
    var cl = a && a.climate;
    if (!cl || !cl.chartT || !cl.chartP) return null;
    var d = WL.compute(cl.chartT, cl.chartP);
    if (!d.ok) return null;
    var p = proj(), on = p.climate.online;
    var net = (on && on.source) || 'internet';
    var tTxt = cl.chartSrc.T === 'manual' ? 'temperatura escrita por ti' : 'temperatura de ' + net + ' (ajustada por altitud)';
    var pTxt = cl.chartSrc.P === 'manual' ? 'lluvia escrita por ti' : 'lluvia de ' + net;
    var sub = 'T media ' + Fmt.num(d.tMean, 1) + ' °C · P anual ' + Fmt.grouped(d.pSum, 0) + ' mm' + (a.alt && isNum(a.alt.value) ? ' · ' + Fmt.num(a.alt.value, 0) + ' m' : '');
    return { d: d, svg: WL.svg(d, { title: p.name, subtitle: sub, id: 'wl' }), lines: WL.summary(d), source: 'Datos mensuales: ' + tTxt + ' y ' + pTxt + '.' };
  }
  function walterBlock(a) {
    var m = walterModel(a), c = proj().climate, h = '<div class="block"><h2>Diagrama de Walter-Lieth</h2>';
    if (m) {
      h += '<div class="plot">' + m.svg + '</div><ul class="wlsum">' + m.lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      h += '<p class="small muted">' + esc(m.source) + ' Un mes es seco cuando la lluvia (mm) queda por debajo del doble de la temperatura media (°C).</p>';
      h += '<div class="btns"><button class="btn" data-act="wlSave">Guardar diagrama (SVG)</button><button class="btn" data-act="monthly">' + (c.monthlyManual ? 'Cambiar los 12 meses' : 'Escribir los 12 meses') + '</button></div>';
    } else {
      var cl = a.climate, noT = !cl.chartT, noP = !cl.chartP;
      h += '<p class="lead">Muestra mes a mes cuándo hay sequía y cuándo sobra la lluvia. Necesita la temperatura y la lluvia de los 12 meses.</p>';
      h += '<div class="tip">Falta ' + (noT && noP ? 'la temperatura y la lluvia mensuales' : noT ? 'la temperatura mensual' : 'la lluvia mensual') + '. El botón «Completar con internet» (más abajo) las trae, o puedes escribir los 12 meses.</div>';
      h += '<div class="btns"><button class="btn" data-act="monthly">Escribir los 12 meses</button></div>';
    }
    return h + '</div>';
  }
  function saveWalterSvg() {
    var m = walterModel(analysis());
    if (!m) { toast('Todavía no hay datos mensuales para dibujar el diagrama.', { err: true }); return; }
    var name = IO.slug(proj().name + ' walter-lieth', 'svg');
    IO.saveText(name, 'image/svg+xml', '<?xml version="1.0" encoding="UTF-8"?>\n' + m.svg, { title: 'Diagrama de Walter-Lieth', dialogTitle: 'Guardar diagrama' }).then(function (r) {
      if (r.how === 'download') toast('Diagrama descargado: ' + name);
    }).catch(function (e) { toast('No se pudo guardar el diagrama: ' + (e && e.message || e), { err: true }); });
  }
  function openMonthly() {
    var mm = proj().climate.monthlyManual || {}, T = mm.T || [], P = mm.P || [];
    var h = '<p class="lead">Escribe la temperatura media (°C) y la lluvia total (mm) de cada mes, de una estación cercana o de tus registros. Cada columna debe quedar completa o vacía.</p><div class="mgrid"><span></span><b>°C</b><b>mm</b>';
    MONTHS_ES.forEach(function (n, i) {
      h += '<span>' + n + '</span><input type="text" inputmode="decimal" data-mt="' + i + '" aria-label="Temperatura de ' + n.toLowerCase() + '" value="' + (isNum(T[i]) ? esc(Fmt.num(T[i], 1)) : '') + '" autocomplete="off">' +
        '<input type="text" inputmode="decimal" data-mp="' + i + '" aria-label="Lluvia de ' + n.toLowerCase() + '" value="' + (isNum(P[i]) ? esc(Fmt.num(P[i], 1)) : '') + '" autocomplete="off">';
    });
    h += '</div><p class="small muted">Con los 12 meses escritos, la temperatura y la lluvia anuales se calculan solas, a menos que escribas la anual aparte.</p>';
    h += '<div class="btns"><button class="btn btn-primary" data-act="saveMonthly">Guardar</button>' + (proj().climate.monthlyManual ? '<button class="btn btn-danger" data-act="clearMonthly">Borrar los meses escritos</button>' : '') + '</div>';
    openSheet('Los 12 meses', h);
  }
  function readSeries(attr, lo, hi, label) {
    var vals = [], filled = 0;
    for (var i = 0; i < 12; i++) {
      var r = parseNum($('[' + attr + '="' + i + '"]').value);
      if (r.error) return { error: label + ' de ' + MONTHS_ES[i].toLowerCase() + ': ' + r.error };
      if (r.empty) { vals.push(null); continue; }
      if (r.value < lo || r.value > hi) return { error: label + ' de ' + MONTHS_ES[i].toLowerCase() + ' debe estar entre ' + lo + ' y ' + hi + '.' };
      vals.push(r.value); filled++;
    }
    if (filled && filled < 12) return { error: label + ': faltan ' + (12 - filled) + ' mes(es). Completa los 12 o deja la columna vacía.' };
    return { values: filled ? vals : null };
  }
  function saveMonthly() {
    var t = readSeries('data-mt', -40, 45, 'Temperatura');
    if (t.error) { toast(t.error, { err: true }); return; }
    var pr = readSeries('data-mp', 0, 3000, 'Lluvia');
    if (pr.error) { toast(pr.error, { err: true }); return; }
    var c = proj().climate;
    if (!t.values && !pr.values) delete c.monthlyManual; else c.monthlyManual = { T: t.values, P: pr.values };
    save(); closeSheet(); renderTab(ui.tab);
    toast(c.monthlyManual ? 'Meses guardados.' : 'No escribiste ningún mes.');
  }
  function clearMonthly() { delete proj().climate.monthlyManual; save(); closeSheet(); renderTab(ui.tab); toast('Meses borrados.'); }

  function commitField(el) {
    var field = el.getAttribute('data-field'), c = proj().climate;
    var r = parseNum(el.value);
    if (r.error) { toast(r.error, { err: true }); return; }
    if (r.empty) delete c[field];
    else {
      if (field === 'pManual' && r.value <= 0) { toast('La precipitación debe ser mayor que cero.', { err: true }); return; }
      if (field === 'pManual' && r.value > 15000) { toast('Más de 15.000 mm al año es muy raro: revisa que estén en milímetros por año.', { err: true }); }
      if (field === 'tManual' && (r.value < -40 || r.value > 45)) { toast('La temperatura debe estar entre -40 y 45 °C.', { err: true }); return; }
      if (field === 'altOverride' && (r.value < -450 || r.value > 9000)) { toast('La altitud debe estar entre -450 y 9000 m.', { err: true }); return; }
      c[field] = r.value;
    }
    save(); renderTab('clima');
  }

  /* ---------- Completar, copiar y limpiar la información (en js/ui-completar.js desde 2.25.0) ---------- */
  var Completar = window.ZV.completar({ S: S, ui: ui, MEM: MEM, proj: proj, lot: lot, multi: multi, esc: esc, toast: toast,
    openSheet: openSheet, closeSheet: closeSheet, renderTab: renderTab, save: save, saveMemory: saveMemory });

  function importCsv(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var r = Climate.parseCSV(String(fr.result));
      if (r.records.length) { MEM.add(r.records); saveMemory(); }
      var h = r.records.length ? '<div class="okmsg"><b>' + r.records.length + ' registro' + (r.records.length > 1 ? 's' : '') + ' guardado' + (r.records.length > 1 ? 's' : '') + '.</b> Ya se pueden usar sin conexión.</div>' : '<div class="warn"><b>No se guardó nada.</b></div>';
      r.errors.slice(0, 6).forEach(function (e) { h += '<p class="small">• ' + esc(e) + '</p>'; });
      r.notes.forEach(function (e) { h += '<p class="small muted">• ' + esc(e) + '</p>'; });
      h += '<div class="btns"><button class="btn btn-primary" data-act="closeSheet">Listo</button></div>';
      openSheet('Importar datos', h);
      renderTab(ui.tab);
    };
    fr.onerror = function () { toast('No se pudo leer el archivo.', { err: true }); };
    fr.readAsText(file);
  }

  /* ---------- Usos recomendados (en js/ui-usos.js desde 2.29.0) ---------- */
  var IgacUI = window.ZV.igac({ ui: ui, proj: proj, lot: lot, analysis: analysis, esc: esc, toast: toast, save: save, renderTab: renderTab, '$': $ });
  var UsosUI = window.ZV.usos({ ui: ui, lot: lot, analysis: analysis, lotArea: lotArea, esc: esc, toast: toast, openSheet: openSheet, closeSheet: closeSheet, save: save, renderTab: renderTab,
    igacBlock: IgacUI.blockHtml, igacRows: IgacUI.reportRows });

  /* ---------- Reporte (en js/ui-reporte.js desde 2.26.0) ---------- */
  var Reporte = window.ZV.reporte({ S: S, ui: ui, busy: busy, '$': $, analysis: analysis, busyHide: busyHide, busyMin: busyMin, busyPaint: busyPaint, busyRun: busyRun, busyStep: busyStep, closeSheet: closeSheet, esc: esc, foldReport: foldReport, isNum: isNum, multi: multi, openSheet: openSheet, photosOf: photosOf, proj: proj, reportPhotos: reportPhotos, save: save, sizeText: sizeText, toast: toast, view: view, walterModel: walterModel, usosReport: UsosUI.reportModel, conclusionReport: UsosUI.conclusionModel });
  var tabInforme = Reporte.tabInforme, mountDiagram = Reporte.mountDiagram, shareReport = Reporte.shareReport, shareReportPdf = Reporte.shareReportPdf, shareReportHtml = Reporte.shareReportHtml, copySummary = Reporte.copySummary, copyText = Reporte.copyText, fetchNow = Reporte.fetchNow, croqPrepareClick = Reporte.croqPrepareClick, repRead = Reporte.repRead, repWhatHtml = Reporte.repWhatHtml;

  /* ---------- Proyectos ---------- */
  function openProjects() {
    var h = '<ul class="list">';
    S.projects.forEach(function (p) {
      h += '<li><button class="row" style="grid-template-columns:1fr auto" data-act="pickProject" data-id="' + esc(p.id) + '"><span><span class="pname">' + esc(p.name) + '</span><span class="psub">' + projSub(p) + '</span></span>' + (p.id === S.currentId ? '<span class="alt alt-gps">actual</span>' : '') + '</button></li>';
    });
    h += '</ul><div class="btns"><button class="btn btn-primary" data-act="newProject">Nuevo proyecto</button><button class="btn" data-act="renameProject">Cambiar nombre</button>' + (S.projects.length > 1 ? '<button class="btn btn-danger" data-act="askDeleteProject">Eliminar este proyecto</button>' : '') + '</div>';
    h += '<h3 class="sub">Copia de seguridad</h3><p class="small muted">Guarda todos tus proyectos, puntos, capas, datos de clima y ajustes en un archivo, para no perderlos si cambias de teléfono o desinstalas la app. Elige el formato:</p>';
    var np = 0, nb = 0;
    S.projects.forEach(function (p) { p.points.forEach(function (pt) { photosOf(pt).forEach(function (f) { np++; nb += isNum(f.n) ? f.n : 0; }); }); });
    h += '<div class="btns"><button class="btn" data-act="backupZip">Copia completa (.zip)</button><button class="btn" data-act="backupJson">Copia liviana (.json)</button>' +
      '<button class="btn" data-act="backupJsonFotos"' + (np ? '' : ' disabled') + '>Copia pesada (.json con fotos)</button></div>';
    h += '<p class="small muted"><b>.zip</b>: la copia completa para esta app; <b>incluye las fotos</b> de los puntos. ' +
      '<b>.json liviano</b>: <b>sin fotos</b>; sirve para llevar tus proyectos a otros dispositivos (cabe en un correo o en un chat). ' +
      '<b>.json pesado</b>: el mismo .json <b>con las fotos dentro</b>, para llevar también las fotos a otros dispositivos; ' + (np ? 'hoy pesaría unos ' + sizeText(nb * 4 / 3) + ' (' + np + (np === 1 ? ' foto' : ' fotos') + ', y el texto ocupa un tercio más que la imagen)' : 'todavía no hay fotos que incluir') + '. «Restaurar» entiende los tres.</p>';
    h += '<div class="btns"><button class="btn" data-act="backupPick">Restaurar copia…</button></div>';
    h += '<p class="small muted" style="margin-top:14px">Zonas de Vida versión ' + APP_VERSION + '</p>';
    openSheet('Proyectos', h);
  }

  /* ---------- Copia de seguridad ---------- */
  // Tres formas de guardar la copia (el usuario elige):
  //   'zip'       → copia completa para esta app: copia.json + fotos/<id>.jpg (siempre es un .zip, aunque todavía no haya fotos)
  //   'json'      → copia liviana, SIN fotos (es el formato de siempre): sirve para llevar los proyectos a otros dispositivos
  //   'jsonfotos' → copia pesada: el mismo .json con las fotos dentro, como texto base64 (se arma entera en memoria: tiene un tope de peso)
  function backupExport(kind) {
    var zip = kind === 'zip', heavy = kind === 'jsonfotos';
    var all = Fotos.usedIds(S.projects), ids = zip || heavy ? all : [];
    if (heavy && !all.length) { toast('Todavía no hay fotos en tus puntos. Usa la copia liviana (.json) o la completa (.zip).', { err: true }); return; }
    (ids.length ? readPhotoBytes(ids) : Promise.resolve({})).then(function (got) {
      var total = 0;
      Object.keys(got).forEach(function (id) { total += got[id].length; });
      if (heavy && total > Backup.LIMITS.jsonPhotoBytes) {
        toast('Las fotos suman ' + sizeText(total) + ': son demasiadas para meterlas en un .json (el tope es ' + sizeText(Backup.LIMITS.jsonPhotoBytes) + '). Usa la copia completa (.zip).', { err: true });
        return;
      }
      var b = Backup.create(S, MEM.all(), { appVersion: APP_VERSION, hasPhoto: function (id) { return Object.prototype.hasOwnProperty.call(got, id); } });   // sin fotos leídas, la copia no lleva ninguna
      var used = Fotos.usedIds(b.state.projects), lost = ids.length - used.length;
      var withPhotos = used.map(function (id) { return { id: id, bytes: got[id] }; });
      var note = zip || heavy ? (used.length ? ' Incluye ' + used.length + (used.length === 1 ? ' foto.' : ' fotos.') : '') + (lost ? ' ' + lost + (lost === 1 ? ' foto no se encontró en este teléfono y no entró.' : ' fotos no se encontraron en este teléfono y no entraron.') : '')
        : (all.length ? ' No incluye las ' + all.length + (all.length === 1 ? ' foto' : ' fotos') + ' de tus puntos: para guardarlas usa la copia completa (.zip) o la pesada (.json con fotos).' : '');
      var name = Backup.fileName(null, zip ? 'zip' : 'json', heavy ? 'fotos' : null);
      var meta = { title: 'Copia de seguridad de Zonas de Vida', dialogTitle: 'Guardar copia de seguridad' };
      var saving = zip ? IO.saveBytes(name, 'application/zip', Backup.toZip(b, withPhotos), meta)
        : heavy ? IO.saveBytes(name, 'application/json', new TextEncoder().encode(Backup.stringify(Backup.attachPhotos(b, withPhotos))), meta)   // por trozos: un archivo de decenas de MB no cabe en un solo mensaje al sistema
        : IO.saveText(name, 'application/json', Backup.stringify(b), meta);
      return saving.then(function (r) {
        var size = heavy ? ' (pesa unos ' + sizeText(total * 4 / 3) + ')' : '';
        if (r.how === 'download') toast('Copia descargada: ' + name + size + '. Guárdala en un lugar seguro.' + note);
        else if (r.how === 'share') toast('Copia lista: ' + name + size + '. Elige dónde guardarla (Drive, correo, archivos…).' + note);
      });
    }).catch(function (e) { toast('No se pudo crear la copia: ' + (e && e.message || e), { err: true }); });
  }
  function restoreFile(file) {
    IO.readBytes(file).then(function (bytes) {
      var raw, photos, skipped = 0;
      if (Zip.isZip(bytes)) { var z = Backup.readZip(bytes); raw = z.raw; photos = z.photos; skipped = z.skipped; }
      else {
        try { raw = JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')); } catch (e) { throw new Error('El archivo no es una copia de seguridad (no se pudo leer el JSON).'); }
        var pj = Backup.photosFromJson(raw);        // el .json pesado trae las fotos dentro; el liviano no trae ninguna
        photos = pj.photos; skipped = pj.skipped;
        if (raw && typeof raw === 'object') delete raw.photos;      // ya están decodificadas: se suelta el texto para liberar memoria
      }
      var v = Backup.validate(raw, { uid: Store.uid, photos: photos });
      if (!v.ok) { openSheet('No se puede restaurar', '<div class="warn">' + v.errors.map(esc).join('<br>') + '</div><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>'); return; }
      if (skipped) v.warnings.push(skipped + (skipped === 1 ? ' foto del archivo no se pudo leer y se omitió.' : ' fotos del archivo no se pudieron leer y se omitieron.'));
      v.photoBytes = photos || {};
      ui.restore = v;
      showRestoreSheet();
    }).catch(function (e) { toast('No se pudo leer la copia: ' + (e && e.message || e), { err: true }); });
  }
  function showRestoreSheet() {
    var v = ui.restore;
    if (!v) return;
    var sm = v.summary;
    var h = '<p class="lead">' + (v.created ? 'Copia del ' + esc(Fmt.date(v.created)) + ': ' : 'Contiene: ') + sm.projects + (sm.projects === 1 ? ' proyecto' : ' proyectos') + ', ' + sm.points + (sm.points === 1 ? ' punto' : ' puntos') +
      (sm.layers ? ', ' + sm.layers + (sm.layers === 1 ? ' capa' : ' capas') : '') + (sm.photos ? ', ' + sm.photos + (sm.photos === 1 ? ' foto' : ' fotos') : '') + (sm.memory ? ' y ' + sm.memory + ' datos de clima' : '') + '.</p>';
    v.warnings.forEach(function (w) { h += '<p class="small muted" style="margin:4px 0">• ' + esc(w) + '</p>'; });
    var mine = Fotos.usedIds(S.projects).length;
    if (mine) h += '<div class="tip">Ahora tienes ' + mine + (mine === 1 ? ' foto' : ' fotos') + ' en tus proyectos. «Reemplazar todo» borra de este teléfono las que no vengan en la copia' + (sm.photos ? '' : ' (esta copia no trae fotos)') + '; «Sumar» no borra ninguna.</div>';
    h += '<p class="small">Ahora tienes ' + S.projects.length + (S.projects.length === 1 ? ' proyecto' : ' proyectos') + '. ¿Cómo quieres restaurar?</p>';
    h += '<div class="btns"><button class="btn btn-primary" data-act="restoreMerge">Sumar a mis proyectos</button><button class="btn btn-danger" data-act="restoreReplace">Reemplazar todo</button></div>';
    h += '<p class="small muted">«Sumar» conserva lo que ya tienes y agrega los proyectos de la copia (si uno ya existe igual, no se repite). «Reemplazar» borra lo actual y deja solo la copia; podrás deshacerlo unos segundos.</p>';
    openSheet('Restaurar copia de seguridad', h);
  }
  function doRestore(mode) {
    var v = ui.restore;
    if (!v || ui.restoring) return;
    var ids = Fotos.usedIds(v.data.projects);
    if (!ids.length) { finishRestore(mode, v); return; }
    // primero las imágenes (en el teléfono); si ya hay otra foto con el mismo id, la de la copia se guarda con un id nuevo
    ui.restoring = true;
    Fotos.importAll(photoStore, ids.map(function (id) { return { id: id, bytes: v.photoBytes[id] }; })).then(function (r) {
      v.data.projects.forEach(function (p) { (Array.isArray(p.lots) ? p.lots : [p]).forEach(function (g) { g.points.forEach(function (pt) { photosOf(pt).forEach(function (f) { if (r.map[f.id]) f.id = r.map[f.id]; }); }); }); });
      ui.restoring = false;
      finishRestore(mode, v);
    }).catch(function (e) { ui.restoring = false; toast('No se pudieron guardar las fotos de la copia: ' + (e && e.message || e), { err: true }); });
  }
  function finishRestore(mode, v) {
    var before = JSON.parse(JSON.stringify({ state: S, memory: MEM.all() }));
    v.data.projects.forEach(Store.toLots);                 // una copia anterior a la 2.15.0 trae cada proyecto sin lotes: pasa a tener un «Lote 1»
    var r = Backup.apply({ state: JSON.parse(JSON.stringify(S)), memory: MEM.all() }, v.data, mode, { uid: Store.uid });
    S.projects = r.state.projects.map(Store.lotify); S.currentId = r.state.currentId; S.settings = Object.assign({}, S.settings, mode === 'merge' ? {} : r.state.settings);
    S.projects.forEach(function (P) { Predio.adopt(P.lots); });      // una copia de antes de la 2.22.0: sus lotes sueltos entran a su predio
    MEM.clear(); MEM.add(r.memory);
    ui.restore = null;
    save(); saveMemory(); closeSheet(); renderAll();
    toast(mode === 'merge' ? r.added + (r.added === 1 ? ' proyecto agregado' : ' proyectos agregados') + (r.skipped ? ' · ' + r.skipped + ' ya estaban' : '') + '.' : 'Copia restaurada: ' + r.added + (r.added === 1 ? ' proyecto.' : ' proyectos.'),
      { action: 'Deshacer', fn: function () { S.projects = before.state.projects.map(Store.lotify); S.currentId = before.state.currentId; S.settings = before.state.settings; MEM.clear(); MEM.add(before.memory); save(); saveMemory(); renderAll(); } });
  }
  function projSub(p) {
    var n = 0;
    p.lots.forEach(function (l) { n += l.points.length; });
    return n + (n === 1 ? ' punto' : ' puntos') + (p.lots.length > 1 ? ' · ' + p.lots.length + ' lotes' : '');
  }
  function nameForm(title, value, act) {
    hideSheet();
    openSheet(title, '<label class="f"><span>Nombre del proyecto</span><input type="text" id="pName" value="' + esc(value) + '" autocomplete="off" maxlength="60"></label><div class="btns"><button class="btn btn-primary" data-act="' + act + '">Guardar</button></div>');
  }

  /* ---------- Los tres pasos: qué está listo y qué falta ---------- */
  // Estado de cada paso para el proyecto actual. state: 'ok' (listo), 'now' (el siguiente por hacer) o 'wait'.
  function stepsModel() {
    var a = analysis(), n = proj().points.length, r = a.result;
    var s1 = { tab: 'puntos', title: 'Puntos', sub: n ? n + (n === 1 ? ' punto' : ' puntos') : 'sin puntos', ok: n > 0 };
    var s2 = { tab: 'clima', title: 'Información', sub: !n ? 'pendiente' : !r ? 'falta la altitud' : !r.ok ? 'falta la lluvia' : 'completo', ok: !!(n && r && r.ok) };
    var s3 = { tab: 'informe', title: 'Reporte', sub: s2.ok ? 'listo' : 'pendiente', ok: s2.ok };
    var steps = [s1, s2, s3], next = !s1.ok ? 0 : !s2.ok ? 1 : 2;
    steps.forEach(function (s, i) { s.state = i === next ? 'now' : s.ok ? 'ok' : 'wait'; });
    return steps;
  }
  function stepsHtml() {
    return '<div class="steps" role="group" aria-label="Pasos para llegar al reporte">' + stepsModel().map(function (s, i) {
      return '<button class="step ' + s.state + '" data-act="step" data-tab="' + s.tab + '"' + (s.state === 'now' ? ' aria-current="step"' : '') + '><b>' + (i + 1) + ' · ' + s.title + (s.state === 'ok' ? ' ✓' : '') + '</b><small>' + esc(s.sub) + '</small></button>';
    }).join('') + '</div>';
  }
  // La franja va arriba en Puntos, Información, Reporte y el croquis de Polígono (en el mapa no: ese alto es del mapa)
  function hasSteps(t) { return t === 'puntos' || t === 'clima' || t === 'informe' || (t === 'area' && ui.polyView !== 'mapa'); }

  /* ---------- Ayudas (en js/ayudas.js desde 2.24.0) ---------- */
  var Ayudas = window.ZV.ayudas({ esc: esc, openSheet: openSheet, APP_VERSION: APP_VERSION });
  var WHATS_NEW_ID = Ayudas.WHATS_NEW_ID, openMapGuide = Ayudas.openMapGuide,
    openWhatsNew = Ayudas.openWhatsNew, openAppGuide = Ayudas.openAppGuide, openUses = Ayudas.openUses, openLicenses = Ayudas.openLicenses;
  // Exportar vive en Polígono › Croquis: desde el Reporte se salta hasta ahí
  /* ---------- Herramientas, crédito y autor del reporte (en js/ui-herramientas.js desde 2.27.0) ---------- */
  var Herr = window.ZV.herramientas({ S: S, ui: ui, busy: busy, '$': $, APP_VERSION: APP_VERSION, WHATS_NEW_ID: WHATS_NEW_ID, analysis: analysis, closeSheet: closeSheet, esc: esc, isNum: isNum, openSheet: openSheet, proj: proj, renderTab: renderTab, toast: toast });
  var tabHerramientas = Herr.tabHerramientas, openAuthor = Herr.openAuthor, readAuthorInputs = Herr.readAuthorInputs, refreshAuthor = Herr.refreshAuthor, saveAuthor = Herr.saveAuthor, setAuthorLogo = Herr.setAuthorLogo, onToolFix = Herr.onToolFix, openConverter = Herr.openConverter, openGpsTool = Herr.openGpsTool, openWeatherTool = Herr.openWeatherTool, renderConverter = Herr.renderConverter, renderGpsTool = Herr.renderGpsTool, renderWeatherTool = Herr.renderWeatherTool, weatherFetch = Herr.weatherFetch;

  function goExport() {
    ui.polyView = 'croquis'; setMapMode(''); leaveMap();
    showTab('area');
    var el = $('#exportBlock');
    if (el && el.scrollIntoView) el.scrollIntoView();
  }
  // Reporte: cada sección se abre al tocar su título (salvo que se prefiera todo abierto). Las dos primeras quedan siempre abiertas.
  function toggleFold(key) {
    ui.unfolded[key] = !ui.unfolded[key];
    renderTab('informe');             // se vuelve a dibujar: el diagrama y los croquis necesitan su tamaño real para montarse
  }
  function foldReport() {
    var tab = $('#tab-informe'), all = Store.loadFlag('reportOpen') === true;
    if (!tab) return;
    tab.classList.toggle('folds', !all);
    var keyOf = {};
    Report.SECTIONS.forEach(function (x) { keyOf[x[1]] = x[0]; });
    [].slice.call(tab.querySelectorAll('.block')).forEach(function (b) {
      var h2 = b.querySelector('h2');
      if (h2 && !h2.hasAttribute('data-key')) h2.setAttribute('data-key', h2.firstChild ? h2.firstChild.textContent : '');
      var key = h2 ? h2.getAttribute('data-key') : '';
      // casilla a la izquierda del título: marcada = la sección va en el reporte que se comparte (2.18.0)
      if (h2 && keyOf[key] && !h2.querySelector('.repchk')) {
        var c = document.createElement('input');
        c.type = 'checkbox'; c.className = 'repchk'; c.setAttribute('data-rep', keyOf[key]); c.checked = Store.loadFlag('rep_' + keyOf[key]) !== false;
        c.setAttribute('aria-label', 'Incluir «' + key + '» en el reporte');
        h2.insertBefore(c, h2.firstChild); h2.classList.add('haschk');
      }
      if (!h2 || all || key === 'Datos usados') { b.classList.remove('folded'); return; }
      var open = !!ui.unfolded[key];
      b.classList.toggle('folded', !open);
      h2.setAttribute('role', 'button'); h2.setAttribute('tabindex', '0'); h2.setAttribute('aria-expanded', String(open)); h2.setAttribute('data-fold', key);
    });
  }

  /* ---------- Pestañas ---------- */
  var TABS = { puntos: tabPuntos, area: tabArea, clima: tabClima, informe: tabInforme, herramientas: tabHerramientas };
  function renderTab(t) {
    var el = $('#tab-' + t);
    if (!el) return;
    var sy = window.scrollY;
    el.innerHTML = (hasLots(t) ? lotsBar() : '') + (hasSteps(t) ? stepsHtml() : '') + TABS[t]();
    syncLotsBar(el, t);
    hydratePhotos(el);
    if (t === 'puntos') { updateReadout(); updateProgress(); }
    if (t === 'area') { mountMap(); updateProgress(); }
    if (t === 'informe') { foldReport(); mountDiagram(); }
    window.scrollTo(0, sy);
  }
  // 2.25.0: la fila de polígonos se desliza sola hasta el elegido al cambiar de polígono, de pestaña o de vista. Si la persona la
  // desliza a mano, se respeta dónde la dejó mientras siga en el mismo polígono y la misma pantalla (cada dibujo la vuelve a crear).
  function syncLotsBar(el, t) {
    var bar = el.querySelector('.lots');
    if (!bar) return;
    var p = proj(), key = p.id + '|' + p.lotId + '|' + t + '|' + (t === 'area' ? ui.polyView : '');
    if (ui.lotsKey === key && typeof ui.lotsLeft === 'number') bar.scrollLeft = ui.lotsLeft;
    else {
      var on = bar.querySelector('[aria-pressed="true"]');
      if (on && bar.getBoundingClientRect) {
        var br = bar.getBoundingClientRect(), or = on.getBoundingClientRect();
        if (br.width) bar.scrollLeft = Math.max(0, bar.scrollLeft + or.left - br.left - (br.width - or.width) / 2);
      }
    }
    ui.lotsKey = key; ui.lotsLeft = bar.scrollLeft;
    bar.addEventListener('scroll', function () { ui.lotsLeft = bar.scrollLeft; }, { passive: true });
  }
  // Al salir del mapa se sueltan la mira y la medida (caminar el lindero sigue, porque depende del GPS y no de la pantalla)
  function leaveMap() {
    if (ui.mapTool && ui.mapTool !== 'caminar') setMapTool('');
    ui.mapSel = null; ui.mapLayers = false; ui.mapFull = false;
  }
  function showTab(t) {
    if (t !== 'area') { setMapMode(''); leaveMap(); }          // el modo del mapa solo vale mientras se está viendo el mapa
    ui.tab = t;
    ['puntos', 'area', 'clima', 'informe', 'herramientas'].forEach(function (k) {
      $('#tab-' + k).hidden = k !== t;
      var b = $('#nav-' + k);
      if (k === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderTab(t);
    window.scrollTo(0, 0);
  }
  function renderAll() { $('#projName').textContent = proj().name; updateChips(); renderTab(ui.tab); }

  /* ---------- Eventos ---------- */
  var ACTIONS = {
    tab: function (t) { showTab(t.getAttribute('data-tab')); },
    step: function (t) { showTab(t.getAttribute('data-tab')); },
    appGuide: function () { hideSheet(); ui.sheetOpen = false; openAppGuide(); }, whatsNew: openWhatsNew, usesGuide: openUses, licenses: openLicenses, goExport: goExport,
    convert: function (t) { openConverter(t.getAttribute('data-tool')); }, cvCopy: function (t) { copyText(t.getAttribute('data-t'), 'Copiado: ' + t.getAttribute('data-t')); },
    toolGps: openGpsTool, toolGpsOn: function () { gpsStart(); renderGpsTool(); }, toolGpsOff: gpsStop,
    toolGpsCopy: function () { if (ui.fix) copyText(Fmt.latlon(ui.fix.lat, ui.fix.lon), 'Coordenadas copiadas.'); },
    toolWeather: openWeatherTool,
    toolWxGps: function () {
      if (!ui.wx || ui.wx.busy || ui.wx.wait) return;
      if (ui.gpsOn && ui.fix) { weatherFetch('gps'); return; }
      ui.wx.wait = true; ui.wx.error = '';
      if (!ui.gpsOn) gpsStart();
      if (!ui.gpsOn) ui.wx.wait = false;                                           // este equipo no deja leer el GPS (gpsStart ya avisó)
      renderWeatherTool();
    },
    toolWxCenter: function () { weatherFetch('center'); },
    projects: openProjects,
    polyView: function (t) { ui.polyView = t.getAttribute('data-v') === 'mapa' ? 'mapa' : 'croquis'; if (ui.polyView !== 'mapa') { setMapMode(''); leaveMap(); } renderTab('area'); },
    mapBase: function (t) { ui.mapBase = Mapa.baseId(t.getAttribute('data-b')); Store.saveFlag('mapBase', ui.mapBase); renderTab('area'); },
    mapRef: function () { ui.mapRef = !ui.mapRef; Store.saveFlag('mapRef', ui.mapRef); renderTab('area'); },
    mapPoly: function () { ui.polyActive = !ui.polyActive; renderTab('area'); },
    mapLast: goLastPoint,
    pointColorDefault: pointColorDefault,
    mapMenu: function () { ui.mapMenu = !ui.mapMenu; ui.mapLayers = false; syncMapMenu(); syncMapChrome(); },
    mapLayers: function () { ui.mapLayers = !ui.mapLayers; ui.mapMenu = false; syncMapMenu(); syncMapChrome(); },
    mapFit: fitAll, mapFull: toggleMapFull,
    mapCardClose: function () { ui.mapSel = null; syncMapCard(); },
    mapCardGo: function () { var pt = ui.mapSel && pointById(ui.mapSel); if (pt) goToPoint(pt); },
    mapNavFit: navFit,
    mapSumTap: function () { if (analysis().selfIntersects) reorder(); },
    mapCardMove: function () { var pt = ui.mapSel && pointById(ui.mapSel); setMapMode('move'); if (pt) toast('Mantén pulsado ' + pt.name + ' ' + Mapa.HOLD_MS / 1000 + ' s y arrástralo.'); },
    mapMeasure: function () { setMapTool(ui.mapTool === 'medir' ? '' : 'medir'); },
    mapMeasureBack: function () { ui.measure = ui.measure.slice(0, -1); drawMeasure(); },
    mapMeasureClose: function () { ui.measureClosed = !ui.measureClosed && ui.measure.length >= 3; drawMeasure(); },
    mapUndo: mapUndo,
    mapMore: openMapMore, mapGuide: openMapGuide,
    mapOrderToggle: function (t) { ui.orderEdit = !!t.checked; syncMapCard(); },
    mapCardOrder: function (t) {
      var p = proj(), d = Number(t.getAttribute('data-d'));
      if (!ui.mapSel || !ui.orderEdit) return;
      undoMark('cambiar el orden de ' + pointById(ui.mapSel).name);
      p.points = Mapa.moveInOrder(p.points, ui.mapSel, d); save();
      renderTab('area');                        // el polígono y los números se redibujan; la tarjeta sigue abierta en el mismo punto
    },
    mapReorder: function () { closeSheet(); reorder(); },
    mapAim: function () { closeSheet(); setMapTool('mira'); },
    mapAimAdd: function () { if (ui.map) addManualAt(ui.map.center()); },
    mapWalk: function () { var step = $('#trackStep') ? $('#trackStep').value : null; closeSheet(); startTrack(step); },
    mapToolEnd: function () { setMapTool(''); },
    mapMode: function (t) {
      var was = ui.mapMode;
      setMapMode(Mapa.toggleMode(ui.mapMode, t.getAttribute('data-mode')));
      // 2.23.4: al terminar de marcar («Salir»), si el polígono quedó encimado o fuera de su predio, se pregunta una vez más
      if (was === 'add' && !ui.mapMode && multi() && !lot().locked && Predio.conflicts(proj().lots, lot().id)) adjustSheet();
    },
    mapMark: function () { if (!ui.gpsOn) gpsStart(); markPoint(); },
    mapMyPos: goMyPosition,
    gpsOn: gpsStart, gpsOff: gpsStop, noGpsYes: useWithoutGps, mark: markPoint, cancelMark: cancelMark,
    addCoords: openAdd, addBulk: openBulk, saveBulk: saveBulk,
    saveNew: function (t) { saveNew(t.getAttribute('data-more') === '1'); },
    editPoint: function (t) { openEdit(t.getAttribute('data-id')); },
    saveEdit: function (t) { saveEdit(t.getAttribute('data-id')); },
    askDelete: function (t) { askDelete(t.getAttribute('data-id')); },
    doDelete: function (t) { doDelete(t.getAttribute('data-id')); },
    closeSheet: closeSheet,
    altFromGps: function () { if (ui.fix && isNum(ui.fix.alt)) { $('#fAlt').value = Fmt.num(ui.fix.alt, 0); $('#fAltHint').textContent = 'Altitud del GPS. Solo úsala si estás parado en este punto.'; } },
    restoreGps: function (t) { var pt = pointById(t.getAttribute('data-id')); if (pt && isNum(pt.altGps)) { pt.alt = pt.altGps; pt.altSrc = 'gps'; save(); closeSheet(); renderTab(ui.tab); toast('Altitud del GPS restaurada.'); } },
    unit: function (t) { S.settings.areaUnit = t.getAttribute('data-u'); save(); renderTab('area'); },
    reorder: reorder,
    clearField: function (t) { delete proj().climate[t.getAttribute('data-field')]; save(); renderTab('clima'); },
    fetchOnline: Completar.fetchOnline, fetchPick: Completar.openFetchPick, fetchPickAll: Completar.fetchPickAll, fetchPickGo: Completar.fetchPickGo,
    usosEdit: UsosUI.openEdit, usosSave: UsosUI.saveEdit, usosClear: UsosUI.clearEdit, usosEstUse: UsosUI.estUse, usosFuente: UsosUI.openFuente, cultivosOpen: UsosUI.openCultivos,
    igacConsult: function () { IgacUI.consult(); }, igacQuitar: function () { IgacUI.quitar(); }, mapIgac: function () { IgacUI.toggle(); }, igacDownload: function () { IgacUI.download(); }, igacBorrar: function () { IgacUI.borrar(); },
    cleanAsk: Completar.openClean, cleanDo: Completar.cleanDo, cleanUndo: Completar.cleanUndo,
    importCsv: function () { $('#csvFile').click(); },
    askClearMem: function () { openSheet('¿Borrar los datos guardados?', '<p>Se borran los ' + MEM.count + ' registros de clima de este equipo. Tus puntos y proyectos no cambian.</p><div class="btns"><button class="btn btn-danger" data-act="doClearMem">Borrar</button><button class="btn" data-act="closeSheet">Conservar</button></div>'); },
    doClearMem: function () { MEM.clear(); saveMemory(); closeSheet(); renderTab(ui.tab); toast('Datos borrados.'); },
    share: shareReport, shareReportPdf: shareReportPdf, shareReportHtml: shareReportHtml, busyHide: busyHide, copy: copySummary, fetchNow: fetchNow,
    photoCam: function (t) { ui.photoFor = t.getAttribute('data-pid'); $('#photoCam').click(); },
    photoGal: function (t) { ui.photoFor = t.getAttribute('data-pid'); $('#photoGal').click(); },
    photoView: function (t) { openPhoto(t.getAttribute('data-fid')); },
    photoClose: closePhoto,
    photoMain: function (t) { photoMain(t.getAttribute('data-pid'), t.getAttribute('data-fid')); },
    photoDel: function (t) { photoDel(t.getAttribute('data-pid'), t.getAttribute('data-fid')); },
    satPrepare: function () { croqPrepareClick('satelite'); }, topoPrepare: function () { croqPrepareClick('topo'); },
    dZoomIn: function () { ui.diagram && ui.diagram.zoomIn(); }, dZoomOut: function () { ui.diagram && ui.diagram.zoomOut(); },
    dCenter: function () { ui.diagram && ui.diagram.focusPoint(); }, dFit: function () { ui.diagram && ui.diagram.fit(); },
    pickProject: function (t) { S.currentId = t.getAttribute('data-id'); save(); closeSheet(); renderAll(); },
    newProject: function () { nameForm('Nuevo proyecto', '', 'saveNewProject'); },
    saveNewProject: function () { var n = $('#pName').value.trim() || 'Proyecto sin nombre'; var p = Store.newProject(n); S.projects.push(p); S.currentId = p.id; save(); closeSheet(); renderAll(); toast('Proyecto creado.'); },
    renameProject: function () { nameForm('Cambiar nombre', proj().name, 'saveRename'); },
    saveRename: function () { var n = $('#pName').value.trim(); if (n) { proj().name = n; save(); } closeSheet(); renderAll(); },
    askDeleteProject: function () { hideSheet(); openSheet('¿Eliminar "' + proj().name + '"?', '<p>Se borran sus ' + proj().points.length + ' puntos y los datos de clima que escribiste. No se puede deshacer.</p><div class="btns"><button class="btn btn-danger" data-act="doDeleteProject">Eliminar</button><button class="btn" data-act="closeSheet">Conservar</button></div>'); },
    doDeleteProject: function () { var id = S.currentId; S.projects = S.projects.filter(function (p) { return p.id !== id; }); S.currentId = S.projects[0].id; save(); closeSheet(); renderAll(); toast('Proyecto eliminado.'); },
    markAnyway: function () { closeSheet(); markPoint(true); },
    importFile: function () { $('#gisFile').click(); },
    importLayer: importLayer, importMain: importMain, importNew: importNew,
    editMain: editMain, editLayer: function (t) { editLayer(t.getAttribute('data-id')); }, pickColor: pickColor, saveEdit2: saveEdit2,
    toggleLayer: function (t) { toggleLayer(t.getAttribute('data-id')); },
    deleteLayer: function (t) { deleteLayer(t.getAttribute('data-id')); },
    layerToMain: function (t) { layerToMain(t.getAttribute('data-id')); },
    export: function (t) { exportAs(t.getAttribute('data-fmt')); },
    lotPick: function (t) { var id = t.getAttribute('data-id'); if (id === proj().lotId) openLots(); else pickLot(id); },
    lotPickClose: function (t) { var ch = pickLot(t.getAttribute('data-id'), true); closeSheet(); if (ch) { renderTab(ui.tab); toast('Lote elegido: ' + lot().name + '.' + (ui.lockNote || '')); } },
    adjustAsk: function () { adjustSheet(); }, adjustDo: function () { adjustDo(); }, adjustKeep: function () { closeSheet(); },
    repScope: function (t) { repRead(); ui.repScope = t.getAttribute('data-s'); var el = $('#repWhat'); if (el) el.innerHTML = repWhatHtml(); },
    lotAdd: function () { lotForm(''); }, predioAdd: function () { lotForm('', 'predio'); },
    lotMode: function (t) { var e = ui.edit; if (!e || e.kind !== 'lot') return; lotFormRead(); e.mode = t.getAttribute('data-m'); lotFormRefresh(); },
    lotFile: function () { lotFormRead(); $('#polyFile').click(); }, lotImport: lotImport, adjustMany: adjustMany,
    expOne: function (t) { Exportar.pickOnly(t.getAttribute('data-id')); closeSheet(); goExport(); },
    expScope: Exportar.expScope, expPickOpen: openExpPick, expPickDone: expPickDone,
    expPickAll: Exportar.expPickAll, lotEdit: function (t) { lotForm(t.getAttribute('data-id')); }, lotSave: lotSave,
    lotNewMap: function () { closeSheet(); lotForm('', 'map'); },
    mapUnlock: function () { setLock(lot(), false); },
    layerToFinca: function (t) { layerToLot(t.getAttribute('data-id'), 'finca'); }, layerToArea: function (t) { layerToLot(t.getAttribute('data-id'), 'area'); },
    lotKind: function (t) { lotSetKind(t.getAttribute('data-k')); }, lotCat: function (t) { lotSetCat(t.getAttribute('data-c')); },
    lotLock: function (t) { var id = t.getAttribute('data-id'), l = proj().lots.filter(function (x) { return x.id === id; })[0]; if (l) { closeSheet(); setLock(l, !l.locked); } },
    lotDelete: function (t) { lotDelete(t.getAttribute('data-id')); }, lotReset: function (t) { lotReset(t.getAttribute('data-id')); },
    lotDeleteAsk: function (t) { lotDeleteAsk(t.getAttribute('data-id')); }, lotDeleteNo: function () { var p = proj(), e = ui.edit, l = e && p.lots.filter(function (x) { return x.id === e.id; })[0], b = $('#lotDelBox'); if (b && l) b.outerHTML = lotDeleteBox(l, p); },
    hugePoint: function () { hugePoint(); }, climateToAll: Completar.climateToAll,
    authorEdit: function () { openAuthor(false); },
    authorLogo: function () { readAuthorInputs(); $('#logoFile').click(); },
    authorLogoDel: function () { ui.authorDraft.logo = ''; refreshAuthor(); },
    authorSave: function () { saveAuthor(); },
    csvStyle: function (t) { S.settings.csvStyle = t.getAttribute('data-s'); save(); renderTab(ui.tab); },
    wlSave: saveWalterSvg, monthly: openMonthly, saveMonthly: saveMonthly, clearMonthly: clearMonthly,
    backupZip: function () { backupExport('zip'); }, backupJson: function () { backupExport('json'); }, backupJsonFotos: function () { backupExport('jsonfotos'); }, backupPick: function () { $('#backupFile').click(); },
    restoreMerge: function () { doRestore('merge'); }, restoreReplace: function () { doRestore('replace'); },
    toastAction: function () { var fn = ui.toastFn; $('#toast').hidden = true; if (fn) fn(); }
  };
  document.addEventListener('click', function (e) {
    if (ui.mapMenu && !e.target.closest('.mapmenu')) { ui.mapMenu = false; syncMapMenu(); }   // un toque fuera de la lista la cierra
    if (e.target.matches && e.target.matches('.repchk')) return;        // la casilla de una sección no la abre ni la cierra
    var fold = e.target.closest('h2[data-fold]');
    if (fold && $('#tab-informe').classList.contains('folds')) { toggleFold(fold.getAttribute('data-fold')); return; }
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var name = t.getAttribute('data-act'), fn = ACTIONS[name];
    if (fn && LOCKED_ACTS[name] && lockStop()) return;        // el lindero de la finca está bloqueado
    if (fn) fn(t, e);
  });
  document.addEventListener('change', function (e) {
    if (!e.target.matches) return;
    if (e.target.matches('[data-field]')) commitField(e.target);
    else if (e.target.matches('[data-flag]')) Store.saveFlag(e.target.getAttribute('data-flag'), !!e.target.checked);
    else if (e.target.matches('[data-rep]')) {
      var on = !!e.target.checked;
      Store.saveFlag('rep_' + e.target.getAttribute('data-rep'), on);
      toast(on ? 'Esta sección irá en el reporte.' : 'Esta sección no irá en el reporte que compartas.');
    }
    else if (e.target.matches('[data-setting]')) {
      S.settings[e.target.getAttribute('data-setting')] = parseInt(e.target.value, 10);
      save(); precisionBanner();
      if (ui.tab === 'puntos') renderTab('puntos');
    }
  });
  document.addEventListener('input', function (e) {
    if (!e.target.matches || !e.target.matches('[data-conv]') || !ui.conv) return;
    var m = ui.convMem[ui.conv];
    if (e.target.getAttribute('data-conv') === 'val') m.text = e.target.value; else m.unit = e.target.value;
    renderConverter();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.mapMenu) { ui.mapMenu = false; syncMapMenu(); }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-field]')) e.target.blur();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('h2[data-fold]') && $('#tab-informe').classList.contains('folds')) { e.preventDefault(); toggleFold(e.target.getAttribute('data-fold')); }
  });
  $('#csvFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) importCsv(f);
    e.target.value = '';
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-ext]');
    if (!a) return;
    if (navigator.onLine === false) { e.preventDefault(); toast('Necesitas internet para abrir ' + a.textContent.trim() + '.', { err: true }); return; }
    // En el teléfono, ir a la dirección hace que Android la abra con la app de la red o con el navegador (no dentro de Zonas de Vida)
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) { e.preventDefault(); window.location.href = a.href; }
  });
  $('#polyFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) lotFileRead(f);
    e.target.value = '';
  });
  $('#gisFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) importGis(f);
    e.target.value = '';
  });
  ['photoCam', 'photoGal'].forEach(function (id) {
    $('#' + id).addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || [], 0);      // se copian antes de vaciar el selector
      e.target.value = '';
      if (files.length) addPhotos(files);
    });
  });
  $('#logoFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) setAuthorLogo(f);
  });
  $('#backupFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) restoreFile(f);
    e.target.value = '';
  });
  window.addEventListener('online', function () { updateChips(); updateMapNotice(); if (ui.tab === 'clima') renderTab('clima'); });
  window.addEventListener('offline', function () { updateChips(); updateMapNotice(); if (ui.tab === 'clima') renderTab('clima'); });

  /* ---------- Inicio ---------- */
  renderAll();
  // La primera vez se explican los tres pasos; quien actualiza ve una vez «Qué hay de nuevo» (2.23.5)
  if (Store.loadFlag('appGuide') !== true) { Store.saveFlag('appGuide', true); Store.saveFlag('whatsNew', WHATS_NEW_ID); openAppGuide(); }
  else if (Store.loadFlag('whatsNew') !== WHATS_NEW_ID) { Store.saveFlag('whatsNew', WHATS_NEW_ID); openWhatsNew(); }
  // Al abrir se borran del teléfono las imágenes que ya ningún punto usa (fotos quitadas, puntos o proyectos eliminados). No se hace sin datos guardados.
  if (hadSaved) Fotos.sweep(photoStore, Fotos.usedIds(S.projects)).catch(function () { /* sin almacén de fotos: nada que limpiar */ });
  var native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin trabajo en segundo plano: la app sigue igual */ });
  }
  // Para pruebas automáticas
  window.__app = { S: S, MEM: MEM, ui: ui, analysis: analysis, showTab: showTab, version: APP_VERSION };
})();

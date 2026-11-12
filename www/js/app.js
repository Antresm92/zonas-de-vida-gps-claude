/* app.js — interfaz de Zonas de Vida. Todo funciona sin conexión; internet solo completa datos. */
(function () {
  'use strict';

  var Geo = window.Geo, H = window.Holdridge, Climate = window.Climate, A = window.Analysis, Fmt = window.Fmt,
      Gps = window.Gps, Store = window.Store, Diagram = window.Diagram, Report = window.Report,
      Gis = window.Gis, Backup = window.Backup, IO = window.IO, WL = window.WalterLieth, Mapa = window.Mapa, MapView = window.MapView, Satelite = window.Satelite, Perfil = window.Perfil, Fotos = window.Fotos, Zip = window.Zip, Units = window.Units;
  var APP_VERSION = '2.15.0';

  var S = Store.loadState();
  var hadSaved = Store.hasSavedState();      // ¿había datos guardados al abrir? (solo entonces se limpian las fotos sin uso)
  var MEM = new Climate.Memory();
  MEM.add(Store.loadMemory());
  var ui = { tab: 'puntos', gpsOn: false, fix: null, stopWatch: null, sampling: null, fetching: false, diagram: null, sheetOpen: false, undo: null, wasOn: false, gpsAsked: false, gpsAsking: false,
             imp: null, restore: null, edit: null,
             polyView: 'croquis', polyActive: true, mapBase: Mapa.baseId(Store.loadFlag('mapBase')), mapRef: Store.loadFlag('mapRef') === true,
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
    return p.lots.filter(function (l) { return l !== cur && l.points.length; }).map(function (l) {
      return { id: 'lote-' + l.id, lotId: l.id, lot: true, name: l.name, kind: l.points.length >= 3 ? 'polygon' : l.points.length === 2 ? 'line' : 'points', color: l.mainColor, visible: true, points: l.points,
        areaText: l.points.length >= 3 ? Fmt.area(Geo.areaUnits(Geo.polygonArea(l.points)), S.settings.areaUnit) : '' };
    });
  }
  function viewLayers(p) { p = p || proj(); return p.layers.concat(lotLayers(p)); }
  // Lo que se dibuja y se reporta del lote elegido: sus puntos y su clima, con las capas importadas y los demás lotes como capas
  function view(p) {
    p = p || proj();
    var l = Store.activeLot(p);
    var v = { id: p.id + ':' + l.id, name: p.name, lotName: multi(p) ? l.name : '', points: l.points, climate: l.climate, layers: viewLayers(p), mainColor: l.mainColor, nextPoint: l.nextPoint };
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

  function colorPalette(current) {
    return '<div class="palette" role="group" aria-label="Color">' + Gis.COLORS.map(function (c) {
      return '<button class="sw" style="background:' + c + '" data-act="pickColor" data-color="' + c + '" aria-pressed="' + (c.toLowerCase() === String(current).toLowerCase()) + '" aria-label="Color ' + c + '"></button>';
    }).join('') + '</div>';
  }
  /* ---------- Lotes (2.15.0): la fila de lotes, la lista y sus acciones ---------- */
  var LOT_COLORS = Gis.COLORS;      // los mismos colores de la paleta, para que el elegido quede marcado
  function lotSub(l) {
    var m2 = lotArea(l), n = l.points.length;
    return (m2 ? Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit) + ' · ' : '') + n + (n === 1 ? ' punto' : ' puntos') + (!m2 && n ? ' · falta cerrar el polígono' : '');
  }
  function lotsBar() {
    var p = proj(), cur = lot(), h = '<div class="lots" role="group" aria-label="Lotes del proyecto">';
    p.lots.forEach(function (l) {
      var m2 = lotArea(l);
      h += '<button class="lotchip" data-act="lotPick" data-id="' + esc(l.id) + '" aria-pressed="' + (l === cur) + '"><i style="background:' + esc(l.mainColor) + '"></i>' + esc(l.name) +
        (m2 ? ' <small>· ' + esc(Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit)) + '</small>' : '') + '</button>';
    });
    if (p.lots.length < Store.LOT_MAX) h += '<button class="lotchip add" data-act="lotAdd" aria-label="Agregar un lote al proyecto">＋ Lote</button>';
    return h + '</div>';
  }
  // La fila va en Puntos, Información, Reporte y el croquis; en el mapa solo si hay más de un lote (para dejarle el alto al mapa)
  function hasLots(t) { return t === 'puntos' || t === 'clima' || t === 'informe' || (t === 'area' && (ui.polyView !== 'mapa' || multi())); }
  function pickLot(id, quiet) {
    var p = proj();
    if (p.lotId === id || !p.lots.some(function (l) { return l.id === id; })) return false;
    if (ui.track) finishTrack();
    if (ui.mapTool) setMapTool('');
    p.lotId = id;
    ui.mapSel = null; ui.navId = null; ui.unfolded = {};
    save();
    if (!quiet) { renderTab(ui.tab); toast('Lote elegido: ' + lot().name + '.'); }
    return true;
  }
  function openLots() {
    var p = proj(), cur = lot(), total = 0, closed = 0, h = '';
    p.lots.forEach(function (l) {
      var m2 = lotArea(l);
      if (m2) { total += m2; closed++; }
      h += '<div class="lotrow' + (l === cur ? ' on' : '') + '"><i style="background:' + esc(l.mainColor) + '"></i>' +
        '<button class="lotpick" data-act="lotPickClose" data-id="' + esc(l.id) + '"><b>' + esc(l.name) + '</b><small>' + esc(lotSub(l)) + '</small></button>' +
        '<button class="lotmore" data-act="lotEdit" data-id="' + esc(l.id) + '" aria-label="Editar ' + esc(l.name) + ': nombre, color o eliminar">⋮</button></div>';
    });
    h += '<p class="small muted" id="lotTotal">' + (closed ? 'Total del proyecto: <b>' + esc(Fmt.area(Geo.areaUnits(total), S.settings.areaUnit)) + '</b> en ' + closed + (closed === 1 ? ' lote cerrado' : ' lotes cerrados') + '.' : 'Todavía no hay ningún lote con polígono cerrado.') +
      ' Cada lote tiene sus propios puntos, su clima y su zona de vida.</p>';
    if (p.lots.length < Store.LOT_MAX) h += '<div class="btns"><button class="btn btn-primary" data-act="lotAdd">＋ Agregar lote</button></div>';
    hideSheet();
    openSheet('Lotes de ' + p.name, h);
  }
  function lotForm(id) {
    var p = proj(), l = id ? p.lots.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !l) return;
    var used = {}, color = l ? l.mainColor : '';
    p.lots.forEach(function (x) { used[x.mainColor.toUpperCase()] = true; });
    if (!l) color = LOT_COLORS.filter(function (c) { return !used[c]; })[0] || LOT_COLORS[p.lots.length % LOT_COLORS.length];   // el primer color que ningún lote usa
    ui.edit = { kind: 'lot', id: id || '', color: color };
    hideSheet();
    openSheet(l ? 'Editar lote' : 'Nuevo lote',
      '<label class="f"><span>Nombre del lote</span><input type="text" id="lotName" value="' + esc(l ? l.name : 'Lote ' + (p.lots.length + 1)) + '" maxlength="' + Store.LOT_NAME_MAX + '" autocomplete="off"></label>' +
      '<div class="f"><span style="display:block;margin-bottom:6px;font-weight:650">Color</span>' + colorPalette(color) + '</div>' +
      (l ? '<p class="small muted">' + esc(lotSub(l)) + '</p>' : '<p class="small muted">El lote nuevo empieza vacío y queda elegido: los puntos que marques después se guardan en él.</p>') +
      '<div class="btns"><button class="btn btn-primary" data-act="lotSave">' + (l ? 'Guardar' : 'Crear lote') + '</button>' +
      (l && p.lots.length > 1 ? '<button class="btn btn-danger" data-act="lotDelete" data-id="' + esc(l.id) + '">Eliminar lote</button>' : '') + '</div>');
  }
  function lotSave() {
    var e = ui.edit, p = proj();
    if (!e || e.kind !== 'lot') return;
    var name = Store.lotName($('#lotName') ? $('#lotName').value : '', p.lots.length);
    if (e.id) {
      var l = p.lots.filter(function (x) { return x.id === e.id; })[0];
      if (!l) return;
      l.name = name; l.mainColor = e.color;
      save(); closeSheet(); renderTab(ui.tab); toast('Lote guardado.');
      return;
    }
    if (p.lots.length >= Store.LOT_MAX) { toast('Un proyecto admite hasta ' + Store.LOT_MAX + ' lotes.', { err: true }); return; }
    var nl = Store.newLot(name, e.color), prev = p.lotId;
    p.lots.push(nl);
    pickLot(nl.id, true);
    save(); closeSheet(); renderTab(ui.tab);
    toast('«' + nl.name + '» creado y elegido.', { action: 'Deshacer', fn: function () {
      if (nl.points.length) { toast('El lote ya tiene puntos: elimínalo desde la lista de lotes.', { err: true }); return; }
      p.lots = p.lots.filter(function (x) { return x !== nl; }); p.lotId = prev; save(); renderTab(ui.tab);
    } });
  }
  function lotDelete(id) {
    var p = proj(), i = -1;
    p.lots.forEach(function (x, k) { if (x.id === id) i = k; });
    if (i < 0 || p.lots.length < 2) return;
    var gone = p.lots[i], prev = p.lotId;
    if (ui.track) finishTrack();
    p.lots.splice(i, 1);
    if (prev === gone.id) { p.lotId = p.lots[Math.max(0, i - 1)].id; ui.mapSel = null; ui.navId = null; }
    save(); closeSheet(); renderTab(ui.tab);
    toast('«' + gone.name + '» eliminado' + (gone.points.length ? ' con sus ' + gone.points.length + ' puntos' : '') + '.', { action: 'Deshacer', fn: function () {
      if (p.lots.indexOf(gone) >= 0 || S.projects.indexOf(p) < 0) return;
      p.lots.splice(Math.min(i, p.lots.length), 0, gone); p.lotId = prev; save(); renderTab(ui.tab);
    } });
  }
  // Copia el clima del lote elegido a los demás (la altitud escrita a mano no se copia: cada lote tiene la suya)
  function climateToAll() {
    var p = proj(), cur = lot(), n = 0, before = p.lots.map(function (l) { return JSON.stringify(l.climate); });
    p.lots.forEach(function (l) {
      if (l === cur) return;
      var c = JSON.parse(JSON.stringify(cur.climate)), own = l.climate.altOverride;
      delete c.altOverride;
      if (own !== undefined) c.altOverride = own;
      l.climate = c; n++;
    });
    save(); renderTab(ui.tab);
    toast('Clima copiado a ' + n + (n === 1 ? ' lote' : ' lotes') + '. La temperatura de cada uno se ajusta con su altitud.', { action: 'Deshacer', fn: function () {
      p.lots.forEach(function (l, k) { if (before[k] !== undefined) l.climate = JSON.parse(before[k]); }); save(); renderTab(ui.tab);
    } });
  }

  function editMain() {
    var p = proj();
    ui.edit = { kind: 'main', color: p.mainColor };
    openSheet('Color de mis puntos', '<p class="lead">Es el color con el que se dibujan tus puntos y tu polígono en los planos, en Google Earth (al exportar) y en el reporte.</p>' + colorPalette(p.mainColor) +
      '<div class="btns"><button class="btn btn-primary" data-act="saveEdit2">Guardar</button></div>');
  }
  function editLayer(id) {
    var l = layerById(id); if (!l) return;
    ui.edit = { kind: 'layer', id: id, color: l.color };
    openSheet('Editar capa',
      '<label class="f"><span>Nombre</span><input type="text" id="lName" value="' + esc(l.name) + '" maxlength="80" autocomplete="off"></label>' +
      '<div class="f"><span style="display:block;margin-bottom:6px;font-weight:650">Color</span>' + colorPalette(l.color) + '</div>' +
      '<p class="small muted">' + esc(layerSub(l)) + (l.file ? ' · archivo ' + esc(l.file) : '') + '</p>' +
      '<div class="btns"><button class="btn btn-primary" data-act="saveEdit2">Guardar</button>' +
      (l.kind !== 'points' || l.points.length ? '<button class="btn" data-act="layerToMain" data-id="' + esc(id) + '">Usar como polígono del proyecto</button>' : '') +
      '<button class="btn btn-danger" data-act="deleteLayer" data-id="' + esc(id) + '">Eliminar capa</button></div>');
  }
  function pickColor(t) {
    if (!ui.edit) return;
    ui.edit.color = t.getAttribute('data-color');
    Array.prototype.forEach.call(document.querySelectorAll('#sheet .sw'), function (b) { b.setAttribute('aria-pressed', String(b === t)); });
    var dflt = $('#sheet [data-act="pointColorDefault"]');
    if (dflt) dflt.setAttribute('aria-pressed', 'false');
  }
  function pointColorDefault() {
    if (!ui.edit) return;
    ui.edit.color = '';
    Array.prototype.forEach.call(document.querySelectorAll('#sheet .sw'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    var dflt = $('#sheet [data-act="pointColorDefault"]');
    if (dflt) dflt.setAttribute('aria-pressed', 'true');
  }
  function saveEdit2() {
    var e = ui.edit, p = proj();
    if (!e) return;
    if (e.kind === 'lot') { lotSave(); return; }
    if (e.kind === 'main') p.mainColor = e.color;
    else {
      var l = layerById(e.id); if (!l) return;
      var nm = $('#lName') ? $('#lName').value.replace(/\s+/g, ' ').trim() : '';
      if (nm) l.name = nm.slice(0, 80);
      l.color = e.color;
    }
    ui.edit = null; save(); closeSheet(); renderTab(ui.tab);
  }
  function toggleLayer(id) { var l = layerById(id); if (!l) return; l.visible = l.visible === false; save(); renderTab(ui.tab); }
  function snapshot(p) { return { points: p.points, layers: p.layers, nextPoint: p.nextPoint }; }
  function restoreSnapshot(p, s) { p.points = s.points; p.layers = s.layers; p.nextPoint = s.nextPoint; save(); renderTab(ui.tab); }
  function deleteLayer(id) {
    var p = proj(), s = snapshot(p), l = layerById(id);
    if (!l) return;
    p.layers = p.layers.filter(function (x) { return x.id !== id; });
    save(); closeSheet(); renderTab(ui.tab);
    toast('Capa «' + l.name + '» eliminada.', { action: 'Deshacer', fn: function () { restoreSnapshot(p, s); } });
  }
  // La capa pasa a ser el polígono del proyecto; tus puntos de antes se guardan como capa (no se pierde nada)
  function layerToMain(id) {
    var p = proj(), l = layerById(id);
    if (!l) return;
    var s = snapshot(p), old = p.points;
    var newPts = Gis.pointsFromLayer(l, Store.uid);
    var layers = p.layers.filter(function (x) { return x.id !== id; });
    if (old.length) {
      layers.push({ id: Store.uid(), name: 'Mis puntos anteriores', kind: old.length >= 3 ? 'polygon' : old.length === 1 ? 'points' : 'line', color: l.color, visible: true,
        points: old.map(function (q) { var o = { lat: q.lat, lon: q.lon, alt: isNum(q.alt) ? q.alt : null }; if (q.name) o.name = q.name; return o; }), file: '', ts: Date.now() });
    }
    p.points = newPts; p.layers = layers; p.nextPoint = newPts.length + 1;
    save(); closeSheet(); renderTab(ui.tab);
    toast('«' + l.name + '» es ahora el polígono del proyecto.' + (old.length ? ' Tus puntos anteriores quedaron como capa.' : ''), { action: 'Deshacer', fn: function () { restoreSnapshot(p, s); } });
  }

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

  /* ---------- Exportar (KML, GeoJSON, GPX, CSV) ---------- */
  var EXPORTS = {
    kml: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', label: 'KML', sub: 'Google Earth' },
    geojson: { ext: 'geojson', mime: 'application/geo+json', label: 'GeoJSON', sub: 'QGIS, web' },
    gpx: { ext: 'gpx', mime: 'application/gpx+xml', label: 'GPX', sub: 'GPS de mano' },
    csv: { ext: 'csv', mime: 'text/csv', label: 'CSV', sub: 'Excel' },
    shp: { ext: 'zip', mime: 'application/zip', label: 'Shapefile', sub: 'ArcGIS, QGIS' }
  };
  function exportBlock() {
    var h = '<div class="block" id="exportBlock"><h2>Exportar</h2><p class="lead">Para abrir tu terreno en Google Earth, QGIS, ArcGIS, Excel o un GPS.</p><div class="expgrid">';
    Object.keys(EXPORTS).forEach(function (k) { h += '<button class="btn" data-act="export" data-fmt="' + k + '">' + EXPORTS[k].label + '<small>' + EXPORTS[k].sub + '</small></button>'; });
    h += '</div><div class="seg" role="group" aria-label="Formato del CSV" style="margin-top:12px">';
    [['es', 'CSV para Excel en español'], ['std', 'CSV estándar']].forEach(function (o) { h += '<button data-act="csvStyle" data-s="' + o[0] + '" aria-pressed="' + (S.settings.csvStyle === o[0]) + '">' + o[1] + '</button>'; });
    h += '</div><p class="small muted">KML, GeoJSON y GPX llevan tus puntos y las capas visibles. El CSV trae solo tus puntos: Punto, Latitud, Longitud, Altitud, Rumbo, Distancia al vértice siguiente y las coordenadas planas Este y Norte (Origen Nacional), ' + (S.settings.csvStyle === 'es' ? 'separado por «;» y con coma decimal' : 'separado por «,» y con punto decimal') + '. El Shapefile es un .zip con dos capas, tus puntos y el polígono, en grados WGS84.</p></div>';
    return h;
  }
  function exportLots(p) { return p.lots.filter(function (l) { return l.points.length; }).map(function (l) { return { name: l.name, points: l.points }; }); }
  function exportAs(fmt) {
    var p = proj(), spec = EXPORTS[fmt];
    if (!spec) return;
    if (fmt === 'shp') { exportShp(p, spec); return; }
    var any = p.lots.some(function (l) { return l.points.length; });
    if (!any && !(fmt !== 'csv' && p.layers.some(function (l) { return l.visible !== false; }))) { toast('Todavía no hay puntos para exportar.', { err: true }); return; }
    // Con varios lotes van todos: el elegido como polígono principal y los demás como capas con su nombre; en el CSV, con una columna «Lote»
    var model = { name: p.name, points: p.points, layers: viewLayers(p), mainColor: p.mainColor, date: Date.now() }, text;
    try {
      text = fmt === 'kml' ? Gis.toKML(model) : fmt === 'geojson' ? Gis.toGeoJSON(model) : fmt === 'gpx' ? Gis.toGPX(model) :
        Gis.toCSV(p.points, multi(p) ? { style: S.settings.csvStyle, lots: exportLots(p) } : { style: S.settings.csvStyle });
    } catch (e) { toast('No se pudo preparar el archivo: ' + (e && e.message || e), { err: true }); return; }
    var name = IO.slug(p.name, spec.ext);
    IO.saveText(name, spec.mime, text, { title: p.name + ' (' + spec.label + ')', dialogTitle: 'Exportar ' + spec.label }).then(function (r) {
      if (r.how === 'download') toast('Archivo descargado: ' + name);
      else if (r.how === 'share') toast('Archivo listo: ' + name);
    }).catch(function (e) { toast('No se pudo guardar el archivo: ' + (e && e.message || e), { err: true }); });
  }

  // El Shapefile son varios archivos: se entregan juntos en un .zip (QGIS y ArcGIS lo abren así)
  function exportShp(p, spec) {
    if (!p.lots.some(function (l) { return l.points.length; })) { toast('Todavía no hay puntos para exportar.', { err: true }); return; }
    var name = IO.slug(p.name) + '-shapefile.zip', bytes, m = { name: p.name, base: IO.slug(p.name).replace(/-/g, '_') };
    if (multi(p)) m.lots = exportLots(p); else m.points = p.points;
    try { bytes = Shp.zip(m, Date.now()); }
    catch (e) { toast('No se pudo preparar el archivo: ' + (e && e.message || e), { err: true }); return; }
    IO.saveBytes(name, spec.mime, bytes, { title: p.name + ' (' + spec.label + ')', dialogTitle: 'Exportar ' + spec.label }).then(function (r) {
      if (r.how === 'download') toast('Archivo descargado: ' + name);
      else if (r.how === 'share') toast('Archivo listo: ' + name);
    }).catch(function (e) { toast('No se pudo guardar el archivo: ' + (e && e.message || e), { err: true }); });
  }

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
      h += '<div class="tip">Tu proyecto no tiene puntos propios, solo capas importadas. Para calcular el área y la zona de vida, abre una capa en la pestaña Puntos y elige «Usar como polígono del proyecto».</div>';
      h += '<div class="plot">' + Diagram.polygonSVG([], { layers: VL, color: p.mainColor }) + '</div>' + Diagram.legendHTML(VL, p.mainColor, ownLabel(), false);
      return h + exportBlock();
    }
    var unit = S.settings.areaUnit || 'ha';
    var plotOpts = { center: a.center, layers: VL, color: p.mainColor };
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
    h += '<div class="plot">' + Diagram.polygonSVG(p.points, { center: a.center, bad: a.selfIntersects, layers: VL, color: p.mainColor }) + '</div>' + legend;
    h += '<p class="small muted">Los puntos se unen en el orden en que están en la lista y el último se une con el primero. El círculo rojo es el centro.</p></div>';

    h += '<div class="block"><h2>Medidas</h2><dl class="kv">';
    ['ha', 'm2', 'km2', 'fanegadas'].forEach(function (u) { h += '<div><dt>' + Fmt.UNITS[u].long + '</dt><dd>' + Fmt.area(a.area, u) + '</dd></div>'; });
    h += '<div><dt>Perímetro</dt><dd>' + Fmt.dist(a.perimeter) + '</dd></div>';
    h += '<div><dt>Vértices</dt><dd>' + a.n + '</dd></div>';
    if (multi(p)) {
      var tot = 0, nc = 0;
      p.lots.forEach(function (l) { var m2 = lotArea(l); if (m2) { tot += m2; nc++; } });
      h += '<div><dt>Total del proyecto (' + nc + (nc === 1 ? ' lote cerrado' : ' lotes cerrados') + ')</dt><dd id="areaTotal">' + Fmt.area(Geo.areaUnits(tot), unit) + '</dd></div>';
    }
    h += '<div><dt>Centro</dt><dd>' + Fmt.latlon(a.center.lat, a.center.lon) + '</dd></div>';
    var cpl = Fmt.plana(a.center.lat, a.center.lon);
    if (cpl) h += '<div><dt>Centro en planas (Origen Nacional)</dt><dd id="areaPlana">' + esc(cpl) + '</dd></div>';
    if (a.alt.min !== null && a.alt.n > 1) h += '<div><dt>Altitud de los puntos</dt><dd>' + Fmt.num(a.alt.min, 0) + ' a ' + Fmt.num(a.alt.max, 0) + ' m</dd></div>';
    h += '</dl><p class="small muted">Área calculada sobre el elipsoide WGS84. La precisión depende de la de las coordenadas: con GPS de teléfono (±5 m) una finca pequeña puede variar varios por ciento.</p></div>';

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
    h += '<div id="mapBox" class="mapbox' + (ui.mapFull ? ' full' : '') + (multi() ? ' haslots' : '') + '"><div id="mapHost" class="maphost"></div>';
    h += mapMenuHtml();
    h += '<div class="maptop"><button id="mapSum" class="mapsum" data-act="mapSumTap" hidden></button><div id="mapNotice" class="mapnotice" role="status" hidden></div>' +
      '<div id="mapMode" class="mapmode" hidden><span id="mapModeTxt" role="status"></span><button data-act="mapMode" data-mode="">Salir</button></div></div>' +
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
  function addManualAt(ll, after) {
    var p = proj(), prevNext = p.nextPoint;
    undoMark(isNum(after) ? 'insertar un punto' : 'crear un punto');
    var pt = addPoint({ lat: ll.lat, lon: ll.lon, src: 'manual' });
    var msg = pt.name + ' creado (sin altitud).';
    if (isNum(after) && after >= 0 && after < p.points.length - 1) {
      var a = p.points[after], b = p.points[(after + 1) % (p.points.length - 1)];
      p.points.pop(); p.points.splice(after + 1, 0, pt); save();
      msg = pt.name + ' insertado entre ' + a.name + ' y ' + b.name + ' (sin altitud).';
    }
    ui.mapFitKey = mapKey();
    renderTab('area');
    toast(msg, { action: 'Deshacer', fn: function () {
      var i = p.points.indexOf(pt);
      if (i < 0) return;
      p.points.splice(i, 1);
      if (p.nextPoint === prevNext + 1) p.nextPoint = prevNext;   // el siguiente punto vuelve a llamarse como habría sido
      save(); renderTab(ui.tab);
    } });
  }
  // Al soltar un punto arrastrado con «Posición manual»: queda donde se soltó y «Deshacer» lo devuelve (con su origen y su precisión de GPS de antes).
  function onPointDrop(id, ll) {
    var pt = pointById(id);
    if (!pt || Geo.haversine(pt.lat, pt.lon, ll.lat, ll.lon) < 0.5) return;
    var before = { lat: pt.lat, lon: pt.lon, src: pt.src, acc: pt.acc };
    undoMark('mover ' + pt.name);
    relocate(pt, ll.lat, ll.lon);
    ui.mapFitKey = mapKey();
    save(); renderTab('area');
    toast(pt.name + ' movido.', { action: 'Deshacer', fn: function () {
      var q = pointById(id);
      if (!q) return;
      q.lat = before.lat; q.lon = before.lon; q.src = before.src; q.acc = before.acc;
      save(); renderTab(ui.tab);
    } });
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
  function toolsInset() { var t = $('.maptools'); return t ? t.offsetHeight + 44 : 100; }
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
    ui.map.draw(Mapa.shapes(view(p), { polyActive: ui.polyActive, bad: !!a.selfIntersects, fmt: function (n) { return Fmt.num(n, 0); }, dist: Geo.distance, fmtDist: Fmt.dist }));
    ui.map.setMeasure(ui.mapTool === 'medir' ? ui.measure : [], ui.measureClosed);
    var key = mapKey();
    if (ui.mapFitKey !== key) { ui.map.fit(Mapa.extent(p.points, viewLayers(p)), { bottom: toolsInset() }); ui.mapFitKey = key; }   // solo al cambiar de proyecto o al llegar los primeros datos
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
    if (ui.map) ui.map.fit(ext, { bottom: toolsInset() });
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
      '<button data-act="mapCardOrder" data-d="-1" aria-label="Antes: pasar este punto un puesto antes en el recorrido"' + (ord.first ? ' disabled' : '') + '>◀</button>' +
      '<span id="mapCardOrder">' + ord.pos + ' de ' + ord.n + '</span>' +
      '<button data-act="mapCardOrder" data-d="1" aria-label="Después: pasar este punto un puesto después en el recorrido"' + (ord.last ? ' disabled' : '') + '>▶</button></div>' +
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
    openSheet('Más opciones del mapa',
      '<h3 class="sub">Agregar con mira</h3><p class="small muted">Una cruz queda fija en el centro: mueves el mapa hasta el lugar exacto y pulsas «Agregar aquí». Es más preciso que tocar con el dedo.</p>' +
      '<div class="btns"><button class="btn btn-primary" data-act="mapAim">Agregar con mira</button></div>' +
      '<h3 class="sub" style="margin-top:18px">Caminar el lindero</h3><p class="small muted">Recorres el borde del terreno y el GPS va dejando los puntos en orden. Deja la pantalla encendida y la app abierta; al terminar puedes deshacer todo el recorrido.</p>' +
      '<label class="f"><span>Distancia entre puntos</span><select id="trackStep">' + opts + '</select></label>' +
      '<div class="btns"><button class="btn btn-primary" data-act="mapWalk">Empezar a caminar</button></div>' +
      '<h3 class="sub" style="margin-top:18px">Ordenar los puntos</h3><p class="small muted">El polígono une los puntos en su orden (el número dentro de cada punto). Esto los acomoda solos alrededor del centro del terreno y se puede deshacer. En terrenos con entrantes (forma de L o de U) puede equivocarse: ahí toca un punto y usa las flechas ◀ y ▶ de su tarjeta para pasarlo antes o después.</p>' +
      '<div class="btns"><button class="btn" data-act="mapReorder">Ordenar los puntos</button></div>' +
      '<h3 class="sub" style="margin-top:18px">Ayuda</h3><div class="btns"><button class="btn" data-act="mapGuide">Cómo usar el mapa</button></div>');
  }
  function openMapGuide() {
    var rows = [
      ['Toca un punto', 'para ver sus datos, abrir su ficha, moverlo, eliminarlo, cambiar su puesto en el recorrido o ir hasta él (con el GPS encendido te guía con una flecha y los metros que faltan). El número dentro de cada punto es su orden.'],
      ['Menú ⋮', '«Ingresar puntos» crea un punto donde toques. «Posición manual» deja mover un punto manteniéndolo pulsado e insertar uno nuevo con el «+» de cada lado.'],
      ['Botones de la izquierda', 'bajo el menú ⋮: cambiar la capa (calles, satélite o topográfico), ver todo el terreno, pantalla completa y deshacer el último cambio (mover, crear, insertar, borrar u ordenar puntos), paso a paso. A la derecha, acercar y alejar.'],
      ['Mi posición', 'el botón redondo de abajo centra el mapa donde estás y te sigue hasta que muevas el mapa.'],
      ['Barra de abajo', 'mostrar u ocultar el polígono, ir al último punto, medir (varios tramos seguidos; al cerrar la figura da el área), más opciones (mira y caminar el lindero) y marcar un punto con el GPS.'],
      ['Arriba', 'el área, el perímetro y el número de puntos se actualizan solos.']
    ];
    openSheet('Cómo usar el mapa', '<dl class="guide">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<p class="small muted">Puedes volver a ver esta ayuda en «Más opciones».</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
  }

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

    // Lo primero, lo que más ahorra trabajo: traer los datos de internet
    h += '<div class="block"><h2>Completar con internet</h2>';
    h += '<p class="lead">Trae la altitud de cada punto sin altitud y el clima de la zona, mes por mes (NASA POWER y, si no responde, Open-Meteo). Lo que traes queda guardado en el equipo para usarlo sin conexión.</p>';
    if (ui.staleOnline) h += '<div class="tip">Los datos de internet guardados son de otro lugar; vuelve a completarlos.</div>';
    if (c.online && !ui.staleOnline) h += '<p class="small muted">Última descarga: ' + esc(Fmt.date(c.online.date)) + (c.online.source ? ' · ' + esc(c.online.source) : '') + '.</p>';
    var offline = navigator.onLine === false;
    h += '<button class="btn btn-primary btn-block" data-act="fetchOnline"' + (ui.fetching ? ' disabled' : '') + '>' + (ui.fetching ? 'Consultando…' : 'Completar con internet') + '</button>';
    if (offline) h += '<p class="small muted">Ahora no hay conexión. Tus puntos quedan guardados; completa cuando tengas internet.</p>';
    if (multi()) h += '<button class="btn btn-block" style="margin-top:10px" data-act="climateToAll">Usar este clima en todos los lotes</button><p class="small muted">Cada lote guarda su propio clima, tomado desde su centro. La lluvia de internet viene en cuadros de unos 50 km, así que en una misma finca suele ser igual; la temperatura cambia con la altitud de cada lote.</p>';
    h += '</div>';


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

  function fetchOnline() {
    var a = analysis();
    if (a.empty || ui.fetching) return;
    if (navigator.onLine === false) { toast('Sin conexión. Tus puntos quedan guardados; completa cuando tengas internet.', { err: true }); return; }
    var p = proj(), c = p.climate;
    var need = p.points.filter(function (pt) { return !isNum(pt.alt); });
    ui.fetching = true; renderTab('clima');
    Climate.fetchOnline(a.center.lat, a.center.lon, null, { points: need.map(function (pt) { return { lat: pt.lat, lon: pt.lon }; }) })
      .then(function (res) {
        ui.fetching = false;
        var did = [];
        if (res.pointElevations && need.length) {
          var k = 0;
          need.forEach(function (pt, i) { var e = res.pointElevations[i]; if (isNum(e)) { pt.alt = e; pt.altSrc = 'internet'; k++; } });
          if (k) did.push('altitud de ' + k + ' punto' + (k > 1 ? 's' : ''));
        }
        if (res.climate || isNum(res.elevation)) {
          var rc = res.climate, yrs = rc && rc.years ? ' ' + rc.years[0] + '–' + rc.years[1] : '';
          c.online = { T: rc ? rc.T : null, P: rc ? rc.P : null, monthlyT: rc ? rc.monthlyT : null, monthlyP: rc ? rc.monthlyP : null,
                       elevCell: rc ? rc.elevCell : null, elevation: res.elevation, date: Date.now(), lat: a.center.lat, lon: a.center.lon,
                       source: rc ? (rc.source || 'NASA POWER') + yrs : null };
        }
        if (res.climate) {
          did.push('clima de la zona');
          MEM.add([{ lat: a.center.lat, lon: a.center.lon, alt: res.climate.elevCell, T: res.climate.T, P: res.climate.P, src: 'internet', date: Date.now() }]);
          saveMemory();
        }
        save();
        if (did.length) toast('Listo: ' + did.join(' y ') + '.' + (res.notes && res.notes.length ? ' ' + res.notes[0] : '') + (res.errors.length ? ' Algo no se pudo traer: ' + res.errors[0] : ''));
        else toast('No se pudo consultar internet. ' + (res.errors[0] || '') + ' Puedes escribir los datos a mano.', { err: true });
        renderTab(ui.tab);
      })
      .catch(function (e) { ui.fetching = false; toast('No se pudo consultar internet: ' + (e && e.message || e), { err: true }); renderTab(ui.tab); });
  }

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

  /* ---------- Reporte ---------- */
  function hexBadge(sym) {
    return '<svg class="hexbadge" viewBox="0 0 92 104" role="img" aria-label="Símbolo ' + esc(sym) + '"><polygon points="46,3 89,27.5 89,76.5 46,101 3,76.5 3,27.5" fill="var(--green-soft)" stroke="var(--green)" stroke-width="4"/>' +
      '<text x="46" y="' + (sym.length > 5 ? 58 : 60) + '" text-anchor="middle" font-size="' + (sym.length > 5 ? 22 : 27) + '" font-weight="800" fill="var(--ink)" font-family="system-ui,sans-serif">' + esc(sym) + '</text></svg>';
  }

  function tabInforme() {
    var p = proj(), a = analysis(), h = '';
    if (a.empty) return '<div class="empty"><b>Sin puntos todavía</b>Agrega un punto en la pestaña Puntos para generar el reporte.</div>';
    var r = a.result;
    if (!r) {
      h += '<div class="tip"><b>Falta la altitud.</b> Sin ella no se puede estimar la temperatura.</div><div class="btns"><button class="btn btn-primary" data-act="tab" data-tab="clima">Ir a Información</button></div>';
      return h + '<div class="block" id="nowBlock" style="margin-top:18px">' + nowBlock() + '</div>' + photosBlock();
    }
    if (!r.ok) {
      h += '<div class="result"><div></div><div><h3>Resultado incompleto</h3><p>Región latitudinal: ' + esc(r.region) + ' · Piso altitudinal: ' + esc(r.belt) + '</p></div></div>';
      h += '<div class="tip"><b>Falta la precipitación anual.</b> Escríbela, importa un archivo de datos o complétala con internet para ubicar el punto en el diagrama.</div><div class="btns"><button class="btn btn-primary" data-act="tab" data-tab="clima">Ir a Información</button></div>';
      return h + '<div class="block" id="nowBlock" style="margin-top:18px">' + nowBlock() + '</div>' + photosBlock();
    }
    h += '<div class="result">' + hexBadge(r.zone.symbol) + '<div><h3>' + esc(r.zone.name) + '</h3><p>Región latitudinal: ' + esc(r.region) + '<br>Piso altitudinal: ' + esc(r.belt) + (r.humidity ? '<br>Provincia de humedad: ' + esc(r.humidity.name) : '') + '</p></div></div>';
    (a.warnings || []).forEach(function (w) { h += '<div class="warn">' + esc(w) + '</div>'; });
    if (a.alternatives && a.alternatives.length) {
      h += '<p class="small" style="margin:10px 0 0"><b>Podría caer también en</b> (con un margen de ±' + Fmt.num(a.margins.t, 1) + ' °C y ±' + Fmt.num(a.margins.p * 100, 0) + ' % de lluvia, supuestos según el origen de los datos):</p><ul class="chiplist">';
      a.alternatives.forEach(function (z) { h += '<li>' + esc(z.name) + ' (' + esc(z.symbol) + ')</li>'; });
      h += '</ul>';
    } else {
      h += '<p class="small muted" style="margin:10px 0 0">Con el margen de error de los datos, la zona no cambia.</p>';
    }

    h += '<div class="block" style="margin-top:18px"><h2>Datos usados</h2><dl class="kv">';
    Report.rows(p, a).forEach(function (x) { h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
    if (a.area) h += '<div><dt>Área</dt><dd>' + Fmt.area(a.area, S.settings.areaUnit || 'ha') + '</dd></div>';
    h += '</dl><p class="small muted">' + esc(Report.QUALITY[a.quality]) + '</p></div>';
    h += '<div class="block" id="nowBlock">' + nowBlock() + '</div>' + photosBlock();

    if (a.vertexZones && a.vertexZones.length && a.distinctZones && a.distinctZones.length > 1) {
      h += '<div class="block"><h2>Zonas según la altitud de cada punto</h2><dl class="kv">';
      a.vertexZones.forEach(function (v) { h += '<div><dt>' + esc(v.name) + ' · ' + Fmt.num(v.alt, 0) + ' m</dt><dd>' + esc(v.zone) + ' (' + esc(v.symbol) + ')</dd></div>'; });
      h += '</dl><p class="small muted">Misma precipitación en todos los puntos; la temperatura cambia con la altitud.</p></div>';
    }

    if (p.points.length >= 2) {
      h += perfilBlock();
      CROQ_KINDS.forEach(function (k) { h += '<div class="block" id="' + CROQ[k].block + '">' + croqBlock(k) + '</div>'; });
    }

    h += '<div class="block"><h2>Diagrama de Holdridge</h2><div class="diagram-wrap"><div id="diag" style="width:100%;height:100%"></div></div>' +
      '<div class="diagram-tools"><button data-act="dZoomOut" aria-label="Alejar">−</button><button data-act="dZoomIn" aria-label="Acercar">+</button><button class="txt" data-act="dCenter" aria-label="Centrar en el punto">Mi punto</button><button class="txt" data-act="dFit" aria-label="Ver todo el diagrama">Ver todo</button></div>' +
      '<p class="small muted">Arrastra para moverte y pellizca para acercar. El anillo rojo es el punto analizado y el hexágono verde, su zona de vida.</p></div>';

    h += '<div class="block"><h2>Más opciones</h2><div class="btns"><button class="btn" data-act="copy">Copiar resumen</button><button class="btn" data-act="goExport">Exportar el terreno (KML, GeoJSON, GPX, CSV)</button></div>' +
      '<p class="small muted" style="margin-top:12px">' + esc(Report.DISCLAIMER) + '</p></div>';
    // Siempre a la vista, pegado sobre la barra de pestañas
    return h + '<div class="sharebar"><button class="btn btn-primary btn-block" data-act="share">Compartir reporte</button></div>';
  }
  /* ---------- Reporte: fotos de los puntos ---------- */
  function photosBlock() {
    var p = proj(), c = Fotos.countAll(p.points);
    if (!p.points.length) return '';
    var h = '<div class="block"><h2>Fotos de los puntos</h2>';
    if (!c.photos) return h + '<p class="small muted">Ningún punto tiene foto todavía. Abre la ficha de un punto (doble toque en el mapa con «Posición manual», o toca el punto en la lista) y usa «Tomar foto» o «Galería». Se pueden hasta ' + Fotos.MAX_PER_POINT + ' por punto.</p></div>';
    var bytes = 0;
    p.points.forEach(function (pt) { photosOf(pt).forEach(function (f) { bytes += isNum(f.n) ? f.n : 0; }); });
    h += '<p>' + c.photos + (c.photos === 1 ? ' foto' : ' fotos') + ' en ' + c.points + (c.points === 1 ? ' punto' : ' puntos') + ' de ' + p.points.length + (bytes ? ' · unos ' + sizeText(bytes) + ' en este teléfono' : '') + '.</p>';
    h += '<div class="pgrid pgrid-sm">';
    p.points.forEach(function (pt, i) {
      var list = photosOf(pt);
      if (list.length) h += '<div class="pcard"><img data-photo="' + esc(list[0].id) + '" alt="Foto principal de ' + esc(pt.name) + '"><span class="pcap">' + esc(pt.name) + (list.length > 1 ? ' · ' + list.length : '') + '</span></div>';
    });
    h += '</div>';
    if (c.without) h += '<div class="tip">' + (c.without === 1 ? '1 punto no tiene foto: ' : c.without + ' puntos no tienen foto: ') + esc(p.points.filter(function (pt) { return !photosOf(pt).length; }).map(function (pt) { return pt.name; }).slice(0, 8).join(', ')) + (c.without > 8 ? '…' : '') + '.</div>';
    return h + '<p class="small muted">Las fotos salen en el reporte compartido (reducidas para que el archivo no pese demasiado) y en la copia de seguridad.</p></div>';
  }

  /* ---------- Reporte: clima actual (Open-Meteo) ---------- */
  // Es el clima del momento en el centro de los puntos. Se guarda en el proyecto, sale en el reporte compartido y no entra en el cálculo de Holdridge.
  function nowBlock() {
    var p = proj(), a = analysis(), w = p.weatherNow, rows = Report.currentRows(w), h = '<h2>Clima actual</h2>';
    if (rows.length) {
      h += '<div class="nowcard"><p class="nowname">' + esc(p.name) + '</p><p class="small muted">' + (isNum(w.lat) && isNum(w.lon) ? esc(Fmt.latlon(w.lat, w.lon)) : '') + '</p>';
      if (isNum(w.T)) h += '<p class="nowtemp">' + esc(Fmt.num(w.T, 1)) + ' °C</p>';
      h += '<dl class="kv">';
      rows.forEach(function (x) { if (x[0] !== 'Temperatura') h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
      h += '</dl><p class="small muted">' + esc(Report.currentStamp(w)) + ' · se incluirá en el reporte.</p>';
      if (!a.empty && isNum(w.lat) && isNum(w.lon) && Geo.distance(a.center.lat, a.center.lon, w.lat, w.lon) > 500) h += '<div class="tip">Tus puntos están en otro sitio que cuando consultaste (más de 500 m). Actualiza el clima actual para este lugar.</div>';
      h += '</div>';
    }
    if (ui.nowError) h += '<div class="warn">No se pudo consultar el clima actual: ' + esc(ui.nowError) + '. Revisa la conexión a internet e inténtalo otra vez.</div>';
    h += '<div class="btns"><button class="btn' + (rows.length ? '' : ' btn-primary') + '" data-act="fetchNow"' + (ui.nowBusy ? ' disabled' : '') + '>' +
      (ui.nowBusy ? 'Consultando…' : rows.length ? 'Actualizar clima actual' : 'Consultar clima actual') + '</button></div>';
    return h + '<p class="small muted">Con internet, trae la temperatura, la condición, el viento, la presión, la humedad y las horas de amanecer y atardecer de este momento en el centro de tus puntos (Open-Meteo). ' +
      'No es el promedio de varios años y no cambia el cálculo de la zona de vida.</p>';
  }
  function refreshNow() { var el = $('#nowBlock'); if (el) { el.innerHTML = nowBlock(); foldReport(); } }
  function fetchNow() {
    var a = analysis();
    if (a.empty || ui.nowBusy) return;
    if (navigator.onLine === false) { toast('Sin conexión. El clima actual se consulta con internet.', { err: true }); return; }
    var p = proj(), c = a.center;
    ui.nowBusy = true; ui.nowError = ''; refreshNow();
    Climate.fetchCurrent(c.lat, c.lon, null, {}).then(function (r) {
      ui.nowBusy = false;
      if (r.ok) {
        p.weatherNow = Object.assign({ lat: c.lat, lon: c.lon }, r.data);
        save(); ui.nowError = '';
        toast('Clima actual consultado y agregado al reporte.');
      } else {
        ui.nowError = r.error;
        toast('No se pudo consultar el clima actual.', { err: true });
      }
      refreshNow();
    });
  }

  /* ---------- Reporte: perfil del relieve y croquis con imagen de fondo ---------- */
  function perfilBlock() {
    var p = proj(), m = Perfil.build(p.points), h = '<div class="block"><h2>Perfil del relieve</h2>';
    if (!m.ok) return h + '<p class="small muted">' + esc(m.reason) + '</p></div>';
    h += '<div class="plot">' + Perfil.svg(m, { color: p.mainColor, id: 'perfil-app' }) + '</div><dl class="kv" style="margin-top:12px">';
    Perfil.rows(m).forEach(function (x) { h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
    h += '</dl>';
    m.notes.forEach(function (n) { h += '<div class="tip">' + esc(n) + '</div>'; });
    return h + '<p class="small muted">Altitud de cada punto contra la distancia acumulada entre ellos, en el orden de la lista y sin volver al primero. Usa las altitudes guardadas; no consulta internet.</p></div>';
  }
  // Hay dos croquis con imagen de fondo: el satelital (Esri) y el topográfico (OpenTopoMap). Cada uno guarda su imagen, su aviso de error y si está bajando.
  // El croquis ya preparado solo sirve mientras no cambien los puntos ni las capas visibles.
  var CROQ_KINDS = ['satelite', 'topo'];
  var CROQ = {
    satelite: { block: 'satBlock', act: 'satPrepare', title: 'Croquis satelital', noun: 'satelital', busy: 'Descargando la imagen satelital…',
      note: 'Se baja una sola vez, con internet, y queda guardado dentro del reporte que compartes (imagen de Esri, para uso personal o interno). Sin internet, el reporte sale sin esta sección.' },
    topo: { block: 'topoBlock', act: 'topoPrepare', title: 'Croquis topográfico', noun: 'topográfico', busy: 'Descargando la imagen topográfica…',
      note: 'Se baja una sola vez, con internet, y queda guardado dentro del reporte que compartes (mapa de OpenTopoMap con datos de OpenStreetMap y SRTM, licencia CC-BY-SA). Las curvas de nivel son aproximadas. Sin internet, el reporte sale sin esta sección.' }
  };
  // Además del último croquis preparado se recuerdan los de otros lotes (hasta 12 por tipo), para no bajarlos otra vez al cambiar de lote
  function croqCurrent(kind) {
    var c = ui.croq[kind], sig = Satelite.signature(view());
    if (c.img && c.img.sig === sig) return c.img;
    return c.cache && Object.prototype.hasOwnProperty.call(c.cache, sig) ? c.cache[sig] : null;
  }
  function croqKeep(kind, img) {
    var c = ui.croq[kind];
    c.img = img;
    c.cache = c.cache || {}; c.order = c.order || [];
    if (!Object.prototype.hasOwnProperty.call(c.cache, img.sig)) c.order.push(img.sig);
    c.cache[img.sig] = img;
    while (c.order.length > 12) delete c.cache[c.order.shift()];
  }
  function croqBlock(kind) {
    var cfg = CROQ[kind], c = ui.croq[kind], s = croqCurrent(kind), err = c.error && c.error.sig === Satelite.signature(view()) ? c.error.msg : '';
    var h = '<h2>' + cfg.title + '</h2>';
    if (c.busy) h += '<p class="small" role="status">' + cfg.busy + '</p>';
    else if (s) h += '<div class="plot">' + s.svg + '</div><p class="small muted">' + esc(Satelite.KINDS[kind].caption) + '</p>';
    else if (err) h += '<div class="warn">No se pudo preparar el croquis ' + cfg.noun + ': ' + esc(err) + '.</div>';
    h += '<div class="btns"><button class="btn" data-act="' + cfg.act + '"' + (c.busy ? ' disabled' : '') + '>' + (s ? 'Volver a preparar' : 'Preparar croquis ' + cfg.noun) + '</button></div>';
    return h + '<p class="small muted">' + cfg.note + '</p>';
  }
  function refreshCroqBlock(kind) { var el = $('#' + CROQ[kind].block); if (el) { el.innerHTML = croqBlock(kind); foldReport(); } }
  // Resuelve siempre con { svg, caption } o { unavailable: motivo }; nunca rechaza. force: volver a bajar aunque ya esté preparado.
  function prepareCroquis(kind, force) {
    var p = view(), a = analysis(), sig = Satelite.signature(p), cur = croqCurrent(kind), c = ui.croq[kind], caption = Satelite.KINDS[kind].caption;
    if (cur && !force) return Promise.resolve({ svg: cur.svg, caption: caption });
    function fail(msg) { c.error = { sig: sig, msg: msg }; c.busy = false; refreshCroqBlock(kind); return { unavailable: msg }; }
    if (navigator.onLine === false) return Promise.resolve(fail('no hay conexión a internet en este momento'));
    var pl = Satelite.plan(p.points, p.layers, { kind: kind });
    if (!pl.ok) return Promise.resolve(fail(pl.reason));
    c.busy = true; c.error = null; refreshCroqBlock(kind);
    return Satelite.render(pl).then(function (uri) {
      var svg = Satelite.svg(pl, uri, { points: p.points, layers: p.layers, center: a.center, bad: !!a.selfIntersects });
      if (!svg) return fail('la imagen recibida no es válida');
      croqKeep(kind, { sig: sig, svg: svg }); c.busy = false; refreshCroqBlock(kind);
      return { svg: svg, caption: caption };
    }, function (e) { return fail(e && e.message || 'error desconocido'); });
  }
  function croqPrepareClick(kind) {
    prepareCroquis(kind, true).then(function (r) { toast(r.svg ? 'Croquis ' + CROQ[kind].noun + ' listo.' : 'No se pudo preparar el croquis ' + CROQ[kind].noun + '.', { err: !r.svg }); });
  }

  function mountDiagram() {
    var el = $('#diag');
    if (!el) { ui.diagram = null; return; }
    var a = analysis();
    if (!a.result || !a.result.ok) return;
    ui.diagram = Diagram.mount(el, {});
    ui.diagram.setData({ hex: a.result.hex, point: a.result.point,
      vertices: (a.vertexZones || []).map(function (v) { return { point: v.point, name: v.name }; }) });
  }

  function reportOpts(a) {
    var w = walterModel(a);
    return { walter: w ? { svg: w.svg, lines: w.lines, source: w.source } : null, author: Store.loadAuthor() };
  }
  // «Compartir reporte» pregunta el formato: HTML (se abre en cualquier navegador) o PDF (hoja A4 lista para imprimir)
  function shareReport() {
    if (ui.sharing) return;
    openSheet('Compartir reporte',
      (multi() ? '<p class="lead">¿Qué va en el reporte?</p><div class="seg" role="group" aria-label="Qué lotes van en el reporte" id="repScope" style="margin-bottom:6px">' +
        '<button data-act="repScope" data-s="all" aria-pressed="' + (ui.repAll !== false) + '">Todo el proyecto</button><button data-act="repScope" data-s="one" aria-pressed="' + (ui.repAll === false) + '">Solo «' + esc(lot().name) + '»</button></div>' +
        '<p class="small muted" style="margin-bottom:14px">«Todo el proyecto» trae primero el resumen de los lotes (área, altitud y zona de vida de cada uno, y el total) y después el reporte completo de cada lote que tenga puntos.</p>' : '') +
      '<p class="lead">¿En qué formato quieres el reporte?</p>' +
      '<div class="btns"><button class="btn btn-primary" data-act="shareReportPdf">PDF (hoja A4)</button><button class="btn" data-act="shareReportHtml">HTML</button></div>' +
      '<p class="small muted" style="margin-top:12px"><b>PDF:</b> una hoja A4 lista para imprimir o enviar; se ve igual en cualquier teléfono. <b>HTML:</b> una página web con los gráficos que se acerca bien en pantalla.</p>');
  }
  // Prepara lo que los dos formatos comparten (croquis satelital y topográfico, fotos); entrega { p, a, o, name base }
  // Lo del lote elegido: resuelve con { project, a, o }
  function preparePart() {
    var p = view(), a = analysis();
    var kinds = a.n >= 2 ? CROQ_KINDS : [];
    var need = kinds.filter(function (k) { return !croqCurrent(k); });
    if (need.length && navigator.onLine !== false) busyStep((need.length > 1 ? 'Preparando los croquis satelital y topográfico' : 'Preparando el croquis ' + CROQ[need[0]].noun) + (p.lotName ? ' de «' + p.lotName + '»' : ' para el reporte') + '…');
    else if (Fotos.countAll(p.points).photos) busyStep('Preparando las fotos' + (p.lotName ? ' de «' + p.lotName + '»' : ' para el reporte') + '…');
    return Promise.all([Promise.all(kinds.map(function (k) { return prepareCroquis(k, false); })), reportPhotos(p)]).then(function (all) {
      var res = all[0];
      var o = reportOpts(a); o.satellite = res[0] || null; o.topo = res[1] || null; o.photos = all[1];
      return { project: p, a: a, o: o };
    });
  }
  // Reúne las partes del reporte y llama a build(parts, P). P es el proyecto cuando el reporte es de todos los lotes; si no, null.
  // Para el reporte de todo el proyecto se pasa por cada lote con puntos, uno tras otro (se elige por un momento y al final se vuelve al que estaba).
  function prepareReport(build) {
    var P = proj(), home = P.lotId, all = multi(P) && ui.repAll !== false;
    var ids = all ? P.lots.filter(function (l) { return l.points.length; }).map(function (l) { return l.id; }) : [home];
    if (!ids.length) ids = [home];
    var parts = [];
    ui.sharing = true;
    function back() { P.lotId = home; ui.sharing = false; CROQ_KINDS.forEach(refreshCroqBlock); }
    return ids.reduce(function (chain, id) {
      return chain.then(function () { P.lotId = id; return preparePart(); }).then(function (pt) { parts.push(pt); });
    }, Promise.resolve()).then(function () {
      back();
      return build(parts, parts.length > 1 ? P : null);
    }, function (e) { back(); throw e; });
  }
  function reportName(parts, P, ext) { return IO.slug('reporte zona de vida ' + proj().name + (!P && parts[0].project.lotName ? ' ' + parts[0].project.lotName : ''), ext); }
  function shareReportPdf() {
    if (ui.sharing || busy.on) return;
    closeSheet();
    var name = '';
    busyRun('Elaborando el reporte en PDF', 'Reuniendo los datos del reporte…', function () {
      return prepareReport(function (parts, P) {
        var p = parts[0].project, a = parts[0].a, o = parts[0].o, oAll = { author: o.author };
        name = reportName(parts, P, 'pdf');
        busyStep('Dibujando los gráficos…');                                // los croquis y las fotos ya están: falta dibujar las gráficas en imágenes y armar la hoja
        return ReportPdf.rasterizeAll(P ? ReportPdf.sketchesAll(parts) : ReportPdf.sketches(p, a, o), ReportPdf.PX, window).then(function (images) {
          busyStep('Armando las hojas del PDF…');
          return busyPaint().then(function () {
            var bytes = P ? ReportPdf.buildAll(P, parts, oAll, images) : ReportPdf.build(p, a, o, images);
            busyStep('Guardando el archivo…');
            return busyMin().then(function () {
              return IO.saveBytes(name, 'application/pdf', bytes, { title: 'Reporte de zona de vida', text: P ? Report.textAll(P, parts, oAll) : Report.text(p, a, o), dialogTitle: 'Compartir reporte', onReady: busyHide });
            });
          });
        });
      });
    }).then(function (r) {
      if (r.how === 'download') toast('Reporte descargado: ' + name);
    }).catch(function (e) { toast('No se pudo preparar el PDF: ' + (e && e.message || e), { err: true }); });
  }
  function shareReportHtml() {
    if (ui.sharing || busy.on) return;
    closeSheet();
    var name = '';
    busyRun('Elaborando el reporte en HTML', 'Reuniendo los datos del reporte…', function () {
      return prepareReport(function (parts, P) {
        var p = parts[0].project, a = parts[0].a, o = parts[0].o, oAll = { author: o.author };
        name = reportName(parts, P, 'html');
        busyStep('Armando la página del reporte…');
        var html = P ? Report.htmlAll(P, parts, oAll) : Report.html(p, a, o);
        return busyMin().then(function () {
          return IO.saveText(name, 'text/html', html, { title: 'Reporte de zona de vida', text: P ? Report.textAll(P, parts, oAll) : Report.text(p, a, o), dialogTitle: 'Compartir reporte', onReady: busyHide });
        });
      });
    }).then(function (r) {
      if (r.how === 'download') toast('Reporte descargado: ' + name);
    }).catch(function (e) { toast('No se pudo compartir: ' + (e && e.message || e), { err: true }); });
  }
  // Copia un texto al portapapeles (con el método de respaldo si el navegador no lo permite) y avisa con okMsg
  function copyText(t, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* nada */ }
      ta.remove(); toast(ok ? okMsg : 'No se pudo copiar.', { err: !ok });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast(okMsg); }, fallback);
    else fallback();
  }
  function copySummary() {
    var a = analysis();
    copyText(Report.text(view(), a, reportOpts(a)), 'Resumen copiado.');
  }

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

  /* ---------- Herramientas (2.7.0): conversor de unidades, clima actual y GPS en vivo ---------- */
  var TOOL_ICON = {
    area: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    distancia: '<path d="M4 16L16 4l4 4L8 20z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
    temperatura: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
    clima: '<path d="M7 15.5a4 4 0 0 1-.6-7.9 5.5 5.5 0 0 1 10.6 1A3.5 3.5 0 0 1 17 15.5z"/><path d="M8.5 18.5l-.8 2M12.5 18.5l-.8 2M16.5 18.5l-.8 2"/>',
    gps: '<path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/>'
  };
  function toolCard(act, key, title, sub) {
    return '<button class="tcard" data-act="' + act + '" data-tool="' + key + '"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + TOOL_ICON[key] + '</svg><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>';
  }
  function tabHerramientas() {
    var p = proj(), h = '<h2 class="tt">Herramientas</h2>';
    h += '<h3 class="sub">Conversor de unidades</h3><div class="tgrid tgrid3">';
    Units.CATEGORIES.forEach(function (c) { h += toolCard('convert', c.id, c.name); });
    h += '</div><h3 class="sub">Utilidades de campo</h3><div class="tgrid">' + toolCard('toolWeather', 'clima', 'Clima', 'Condiciones actuales') + toolCard('toolGps', 'gps', 'GPS', 'Coordenadas y precisión') + '</div>';
    h += '<h3 class="sub">Proyectos y copias</h3><div class="menu">' +
      menuRow('projects', 'Proyectos', S.projects.length + (S.projects.length === 1 ? ' proyecto' : ' proyectos') + ' · actual: ' + p.name) +
      menuRow('projects', 'Copia de seguridad y restaurar', '.zip recomendado') + '</div>';
    var au = Store.loadAuthor(), auSub = [au.name, au.org, au.logo ? 'con logo' : ''].filter(Boolean).join(' · ');
    h += '<h3 class="sub">Reporte</h3><div class="menu">' + menuRow('authorEdit', 'Encabezado del reporte', auSub || 'Autor, entidad y logo') + '</div>';
    h += '<h3 class="sub">Preferencias</h3><div class="menu"><label class="menurow"><span><b>Reporte con todas las secciones abiertas</b><small>Si no, cada sección se abre al tocar su título.</small></span>' +
      '<input type="checkbox" data-flag="reportOpen"' + (Store.loadFlag('reportOpen') === true ? ' checked' : '') + '></label></div>';
    h += '<h3 class="sub">Ayuda</h3><div class="menu">' + menuRow('appGuide', 'Cómo usar la app', 'Los tres pasos') + menuRow('mapGuide', 'Cómo usar el mapa', '') +
      menuRow('licenses', 'Fuentes y licencias', 'Mapas y datos de clima') + '</div>';
    h += '<p class="small muted" style="margin-top:14px">Zonas de Vida · versión ' + APP_VERSION + '. Funciona sin internet, salvo los mapas y los datos de clima.</p>';
    return h;
  }
  /* ---------- Autor y logo del reporte (2.14.0) ---------- */
  function authorBody() {
    var au = ui.authorDraft;
    return '<p class="lead">Arriba del reporte (PDF, HTML y resumen) sale: Proyecto, Elaborado por y la fecha; el logo va a la derecha. Se guardan en este teléfono; no van en la copia de seguridad.</p>' +
      '<label class="f"><span>Nombre de quien elabora</span><input type="text" id="auName" maxlength="' + Store.AUTHOR_MAX + '" value="' + esc(au.name) + '" autocomplete="name" placeholder="Ej.: Ana Pérez, ingeniera forestal"></label>' +
      '<label class="f"><span>Entidad o empresa (opcional)</span><input type="text" id="auOrg" maxlength="' + Store.AUTHOR_MAX + '" value="' + esc(au.org) + '" autocomplete="organization" placeholder="Ej.: Finca La Esperanza"></label>' +
      '<div class="f f-logo"><span class="f-label">Logo (opcional)</span><div class="logobox" id="auLogo">' + (au.logo ? '<img src="data:image/jpeg;base64,' + au.logo + '" alt="Logo elegido">' : '<span class="small muted">Sin logo</span>') + '</div>' +
      '<div class="btns"><button class="btn" data-act="authorLogo">' + (au.logo ? 'Cambiar logo' : 'Elegir logo') + '</button>' + (au.logo ? '<button class="btn" data-act="authorLogoDel">Quitar logo</button>' : '') + '</div>' +
      '<span class="f-hint">Se reduce a 400 píxeles y se guarda como JPEG (lo transparente queda blanco).</span></div>' +
      '<div class="btns"><button class="btn btn-primary" data-act="authorSave">Guardar</button></div>';
  }
  function openAuthor(keep) {
    if (!keep) ui.authorDraft = Store.loadAuthor();
    openSheet('Encabezado del reporte', authorBody());
  }
  function readAuthorInputs() {
    var n = $('#auName'), o = $('#auOrg');
    if (n) ui.authorDraft.name = n.value;
    if (o) ui.authorDraft.org = o.value;
  }
  function refreshAuthor() {          // vuelve a dibujar la hoja sin perder lo escrito
    readAuthorInputs();
    var body = $('#sheet .sheet-body');
    if (body) body.innerHTML = authorBody();
  }
  function setAuthorLogo(file) {
    if (!ui.authorDraft) return;
    Fotos.shrink(file, { max: 400, quality: 0.86 }).then(function (r) {
      var b64 = Fotos.toBase64(r.bytes);
      if (b64.length > Store.LOGO_MAX) throw new Error('El logo sigue siendo muy pesado; prueba con una imagen más sencilla.');
      ui.authorDraft.logo = b64;
      refreshAuthor();
    }).catch(function (e) { toast('No se pudo usar esa imagen: ' + (e && e.message || e), { err: true }); });
  }
  function saveAuthor() {
    readAuthorInputs();
    var r = Store.saveAuthor(ui.authorDraft);
    if (!r.ok) { toast(r.error, { err: true }); return; }
    closeSheet();
    toast('Encabezado del reporte guardado.');
    if (ui.tab === 'herramientas') renderTab('herramientas');
  }

  function menuRow(act, title, sub) {
    return '<button class="menurow" data-act="' + act + '"><span><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><i aria-hidden="true">›</i></button>';
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

  /* ---------- Ayuda y licencias ---------- */
  function openAppGuide() {
    var rows = [
      ['1 · Puntos', 'Marca los linderos del terreno con el GPS, escribe sus coordenadas o importa un archivo. Con un punto ya hay zona de vida; con tres o más, también el área.'],
      ['2 · Información', 'Pulsa «Completar con internet» para traer la altitud, la temperatura y la lluvia. Si tienes datos medidos, escríbelos: mandan sobre lo estimado. Sin la lluvia no hay zona de vida.'],
      ['3 · Reporte', 'En «Reporte» está la zona de vida de Holdridge con su diagrama, el perfil del relieve y los croquis. Compártelo en PDF o HTML.'],
      ['Polígono', 'El croquis con las medidas y, en «Mapa», el terreno sobre calles, satélite o topográfico: ahí también se crean, mueven y ordenan los puntos.'],
      ['Arriba', 'La franja de tres pasos dice qué está listo y qué falta. Tócala para ir a ese paso.']
    ];
    openSheet('Cómo usar la app', '<dl class="guide">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<p class="small muted">Puedes volver a ver esta ayuda en «Herramientas».</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
  }
  function openLicenses() {
    var rows = [
      ['Mapa de calles', '© colaboradores de OpenStreetMap, licencia ODbL. openstreetmap.org/copyright'],
      ['Imágenes de satélite y nombres', 'Esri World Imagery y capas de referencia. Fuente: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG.'],
      ['Mapa topográfico', '© OpenTopoMap (CC-BY-SA), con datos de OpenStreetMap y SRTM.'],
      ['Clima de la zona', 'NASA POWER (NASA Langley Research Center) y Open-Meteo (CC BY 4.0).'],
      ['Clima actual', 'Open-Meteo (CC BY 4.0).'],
      ['Mapa en pantalla', 'Leaflet (licencia BSD de 2 cláusulas).'],
      ['Zonas de vida', 'Sistema de clasificación de L. R. Holdridge (1967). El resultado es orientativo.']
    ];
    openSheet('Fuentes y licencias', '<dl class="guide">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<p class="small muted">Los mapas y el clima se piden a esos servicios solo cuando hay internet; la app no envía tus puntos a ningún otro lugar.</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Cerrar</button></div>');
  }
  // Exportar vive en Polígono › Croquis: desde el Reporte se salta hasta ahí
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
    [].slice.call(tab.querySelectorAll('.block')).forEach(function (b) {
      var h2 = b.querySelector('h2'), key = h2 ? h2.firstChild && h2.firstChild.textContent : '';
      if (!h2 || all || key === 'Datos usados') { b.classList.remove('folded'); return; }
      var open = !!ui.unfolded[key];
      b.classList.toggle('folded', !open);
      h2.setAttribute('role', 'button'); h2.setAttribute('tabindex', '0'); h2.setAttribute('aria-expanded', String(open)); h2.setAttribute('data-fold', key);
    });
  }

  // Conversor: se escribe un valor en una unidad y se ven todas las demás a la vez. Lo escrito y la unidad se recuerdan mientras la app está abierta.
  function openConverter(catId) {
    var cat = Units.category(catId);
    if (!cat) return;
    var m = ui.convMem[catId] || (ui.convMem[catId] = { unit: cat.def, text: '1' });
    var opts = cat.units.map(function (u) { return '<option value="' + u.id + '"' + (u.id === m.unit ? ' selected' : '') + '>' + esc(u.name + ' (' + u.sym + ')') + '</option>'; }).join('');
    openSheet(cat.name, '<label class="f"><span>Valor</span><input type="text" inputmode="decimal" id="cvVal" data-conv="val" value="' + esc(m.text) + '" autocomplete="off"></label>' +
      '<label class="f"><span>Está en</span><select id="cvUnit" data-conv="unit">' + opts + '</select></label>' +
      '<div id="cvRes" aria-live="polite"></div><p class="small muted">Toca un resultado para copiarlo. El punto o la coma sirven como decimal (1,5 o 1.5). Funciona sin internet.</p>',
      function () { ui.conv = catId; renderConverter(); setTimeout(function () { var i = $('#cvVal'); if (i) { i.focus(); i.select(); } }, 80); });
  }
  function renderConverter() {
    var el = $('#cvRes'), cat = Units.category(ui.conv), m = ui.conv && ui.convMem[ui.conv];
    if (!el || !cat || !m) return;
    var v = Units.parse(m.text), r;
    if (v === null) r = { ok: false, error: m.text.trim() ? 'No se entiende ese número. Escríbelo así: 1234,5' : 'Escribe un número para convertir.' };
    else r = Units.convert(cat.id, v, m.unit);
    if (!r.ok) { el.innerHTML = '<div class="tip">' + esc(r.error) + '</div>'; return; }
    el.innerHTML = '<div class="cvlist">' + r.rows.map(function (x) {
      return '<button class="cvrow' + (x.id === m.unit ? ' cvfrom' : '') + '" data-act="cvCopy" data-t="' + esc(x.text + ' ' + x.sym) + '"><span class="cvn">' + esc(x.name) + '</span><b>' + esc(x.text) + ' <small>' + esc(x.sym) + '</small></b></button>';
    }).join('') + '</div>';
  }

  // GPS en vivo: coordenadas, altitud y precisión. Los números se cambian en su sitio (sin volver a dibujar los botones) para que un toque no se pierda.
  function openGpsTool() {
    openSheet('GPS', '<div id="toolBody"></div>', function () { ui.tool = 'gps'; ui.toolGpsKind = ''; renderGpsTool(); });
  }
  function gpsToolKind() { return !ui.gpsOn ? 'off' : ui.fix ? 'fix' : 'search'; }
  function fillGpsNumbers() {
    var f = ui.fix, set = function (id, t) { var e = $('#' + id); if (e) e.innerHTML = t; };
    if (!f) return;
    set('tgLat', Fmt.coord(f.lat) + '°'); set('tgLon', Fmt.coord(f.lon) + '°');
    set('tgAlt', isNum(f.alt) ? Fmt.num(f.alt, 0) + ' <small>m</small>' : '<small>sin dato</small>');
    set('tgAcc', isNum(f.acc) ? '±' + Fmt.num(f.acc, 0) + ' <small>m</small>' : '—');
    var pl = Fmt.plana(f.lat, f.lon);
    set('tgDms', esc(Fmt.dms(f.lat, f.lon)) + (pl ? '<br><span id="tgPlana">Planas (Origen Nacional): ' + esc(pl) + '</span>' : ''));
  }
  function renderGpsTool() {
    var el = $('#toolBody');
    if (!el || ui.tool !== 'gps') return;
    var kind = gpsToolKind();
    if (kind === ui.toolGpsKind) { if (kind === 'fix') fillGpsNumbers(); return; }   // misma pantalla: solo cambian los números
    ui.toolGpsKind = kind;
    var h = '';
    if (kind === 'off') h = '<div class="tip">El GPS está apagado. Enciéndelo para ver dónde estás.</div><div class="btns"><button class="btn btn-primary" data-act="toolGpsOn">Encender GPS</button></div>';
    else if (kind === 'search') h = '<div class="tip">Buscando señal… sal a un lugar abierto y espera unos segundos.</div><div class="btns"><button class="btn" data-act="toolGpsOff">Apagar GPS</button></div>';
    else {
      h = '<div class="readout"><div><span class="k">Latitud</span><span class="v" id="tgLat"></span></div><div><span class="k">Longitud</span><span class="v" id="tgLon"></span></div>' +
        '<div><span class="k">Altitud</span><span class="v" id="tgAlt"></span></div><div><span class="k">Precisión</span><span class="v" id="tgAcc"></span></div></div>' +
        '<p class="small muted" id="tgDms" style="margin:8px 0 0"></p>' +
        '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="toolGpsCopy">Copiar coordenadas</button><button class="btn" data-act="toolGpsOff">Apagar GPS</button></div>' +
        '<p class="small muted" style="margin-top:12px">La altitud del GPS suele errar entre 10 y 30 m; la precisión es el error probable de la posición. El GPS sigue encendido hasta que lo apagues aquí o en Puntos.</p>';
    }
    el.innerHTML = h;
    if (kind === 'fix') fillGpsNumbers();
  }

  // Clima actual donde estás (Open-Meteo): usa la posición del GPS o, si prefieres, el centro de los puntos del proyecto. No se guarda en el proyecto.
  function openWeatherTool() {
    var token = ++ui.wxToken;
    openSheet('Clima actual', '<div id="toolBody"></div>', function () {
      ui.tool = 'clima'; ui.wx = { token: token, busy: false, error: '', data: null, from: null, wait: false };
      if (navigator.onLine !== false && ui.gpsOn && ui.fix) weatherFetch('gps'); else renderWeatherTool();
    });
  }
  function weatherSource(kind) {
    if (kind === 'gps') return ui.gpsOn && ui.fix ? { kind: 'gps', lat: ui.fix.lat, lon: ui.fix.lon, acc: ui.fix.acc } : null;
    var a = analysis();
    return a.empty ? null : { kind: 'center', lat: a.center.lat, lon: a.center.lon };
  }
  function weatherFetch(kind) {
    var w = ui.wx, src = weatherSource(kind);
    if (!w || w.busy || !src) return;
    if (navigator.onLine === false) { toast('Sin conexión. El clima actual se consulta con internet.', { err: true }); renderWeatherTool(); return; }
    w.busy = true; w.error = ''; w.wait = false; w.from = src; renderWeatherTool();
    Climate.fetchCurrent(src.lat, src.lon, null, {}).then(function (r) {
      if (ui.wx !== w) return;                                                    // se cerró o se abrió otra vez mientras llegaba
      w.busy = false;
      if (r.ok) w.data = Object.assign({ lat: src.lat, lon: src.lon }, r.data); else w.error = r.error;
      renderWeatherTool();
    });
  }
  function renderWeatherTool() {
    var el = $('#toolBody'), w = ui.wx;
    if (!el || ui.tool !== 'clima' || !w) return;
    var rows = Report.currentRows(w.data), h = '', hasFix = ui.gpsOn && ui.fix, a = analysis();
    if (navigator.onLine === false) h += '<div class="tip">Sin conexión. El clima actual se consulta con internet.</div>';
    if (w.busy) h += '<p class="muted">Consultando el clima…</p>';
    else if (w.wait) h += '<p class="muted">Buscando tu posición con el GPS…</p>';
    if (w.error) h += '<div class="warn">No se pudo consultar el clima actual: ' + esc(w.error) + '. Revisa la conexión a internet e inténtalo otra vez.</div>';
    if (rows.length) {
      h += '<div class="nowcard"><p class="nowname">' + (w.from && w.from.kind === 'gps' ? 'Tu posición' : esc(proj().name)) + '</p><p class="small muted">' + esc(Fmt.latlon(w.data.lat, w.data.lon)) +
        (w.from && w.from.kind === 'gps' && isNum(w.from.acc) ? ' · GPS ±' + esc(Fmt.num(w.from.acc, 0)) + ' m' : w.from && w.from.kind === 'center' ? ' · centro de los puntos' : '') + '</p>';
      if (isNum(w.data.T)) h += '<p class="nowtemp">' + esc(Fmt.num(w.data.T, 1)) + ' °C</p>';
      h += '<dl class="kv">';
      rows.forEach(function (x) { if (x[0] !== 'Temperatura') h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
      h += '</dl><p class="small muted">' + esc(Report.currentStamp(w.data)) + '</p></div>';
    }
    var busy = w.busy || w.wait, off = navigator.onLine === false;
    h += '<div class="btns">';
    h += '<button class="btn' + (rows.length ? '' : ' btn-primary') + '" data-act="toolWxGps"' + (busy || off ? ' disabled' : '') + '>' + (rows.length && w.from && w.from.kind === 'gps' ? 'Actualizar' : hasFix ? 'Usar mi posición' : 'Usar mi GPS') + '</button>';
    if (!a.empty) h += '<button class="btn" data-act="toolWxCenter"' + (busy || off ? ' disabled' : '') + '>Usar el centro de mis puntos</button>';
    h += '</div><p class="small muted" style="margin-top:12px">Son las condiciones de este momento en el lugar elegido (Open-Meteo): no el promedio de varios años, no se guardan en el proyecto y no cambian la zona de vida. Para incluirlas en el reporte usa «Consultar clima actual» en la pestaña Reporte.</p>';
    el.innerHTML = h;
  }
  // Llegó una lectura del GPS: se refresca la herramienta abierta y, si el clima esperaba la posición, se consulta
  function onToolFix() {
    if (ui.tool === 'gps') renderGpsTool();
    else if (ui.tool === 'clima' && ui.wx && ui.wx.wait && ui.fix) weatherFetch('gps');
    else if (ui.tool === 'clima') renderWeatherTool();
  }

  /* ---------- Pestañas ---------- */
  var TABS = { puntos: tabPuntos, area: tabArea, clima: tabClima, informe: tabInforme, herramientas: tabHerramientas };
  function renderTab(t) {
    var el = $('#tab-' + t);
    if (!el) return;
    var sy = window.scrollY;
    el.innerHTML = (hasLots(t) ? lotsBar() : '') + (hasSteps(t) ? stepsHtml() : '') + TABS[t]();
    hydratePhotos(el);
    if (t === 'puntos') { updateReadout(); updateProgress(); }
    if (t === 'area') { mountMap(); updateProgress(); }
    if (t === 'informe') { foldReport(); mountDiagram(); }
    window.scrollTo(0, sy);
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
    appGuide: openAppGuide, licenses: openLicenses, goExport: goExport,
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
    mapCardOrder: function (t) {
      var p = proj(), d = Number(t.getAttribute('data-d'));
      if (!ui.mapSel) return;
      undoMark('cambiar el orden de ' + pointById(ui.mapSel).name);
      p.points = Mapa.moveInOrder(p.points, ui.mapSel, d); save();
      renderTab('area');                        // el polígono y los números se redibujan; la tarjeta sigue abierta en el mismo punto
    },
    mapReorder: function () { closeSheet(); reorder(); },
    mapAim: function () { closeSheet(); setMapTool('mira'); },
    mapAimAdd: function () { if (ui.map) addManualAt(ui.map.center()); },
    mapWalk: function () { var step = $('#trackStep') ? $('#trackStep').value : null; closeSheet(); startTrack(step); },
    mapToolEnd: function () { setMapTool(''); },
    mapMode: function (t) { setMapMode(Mapa.toggleMode(ui.mapMode, t.getAttribute('data-mode'))); },
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
    fetchOnline: fetchOnline,
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
    lotPickClose: function (t) { var ch = pickLot(t.getAttribute('data-id'), true); closeSheet(); if (ch) { renderTab(ui.tab); toast('Lote elegido: ' + lot().name + '.'); } },
    repScope: function (t) { ui.repAll = t.getAttribute('data-s') !== 'one'; Array.prototype.forEach.call(document.querySelectorAll('#repScope button'), function (b) { b.setAttribute('aria-pressed', String(b === t)); }); },
    lotAdd: function () { lotForm(''); }, lotEdit: function (t) { lotForm(t.getAttribute('data-id')); }, lotSave: lotSave,
    lotDelete: function (t) { lotDelete(t.getAttribute('data-id')); }, climateToAll: climateToAll,
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
    var fold = e.target.closest('h2[data-fold]');
    if (fold && $('#tab-informe').classList.contains('folds')) { toggleFold(fold.getAttribute('data-fold')); return; }
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var fn = ACTIONS[t.getAttribute('data-act')];
    if (fn) fn(t, e);
  });
  document.addEventListener('change', function (e) {
    if (!e.target.matches) return;
    if (e.target.matches('[data-field]')) commitField(e.target);
    else if (e.target.matches('[data-flag]')) Store.saveFlag(e.target.getAttribute('data-flag'), !!e.target.checked);
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
  if (Store.loadFlag('appGuide') !== true) { Store.saveFlag('appGuide', true); openAppGuide(); }   // la primera vez se explican los tres pasos
  // Al abrir se borran del teléfono las imágenes que ya ningún punto usa (fotos quitadas, puntos o proyectos eliminados). No se hace sin datos guardados.
  if (hadSaved) Fotos.sweep(photoStore, Fotos.usedIds(S.projects)).catch(function () { /* sin almacén de fotos: nada que limpiar */ });
  var native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin trabajo en segundo plano: la app sigue igual */ });
  }
  // Para pruebas automáticas
  window.__app = { S: S, MEM: MEM, ui: ui, analysis: analysis, showTab: showTab, version: APP_VERSION };
})();

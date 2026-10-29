/* app.js — interfaz de Zonas de Vida. Todo funciona sin conexión; internet solo completa datos. */
(function () {
  'use strict';

  var Geo = window.Geo, H = window.Holdridge, Climate = window.Climate, A = window.Analysis, Fmt = window.Fmt,
      Gps = window.Gps, Store = window.Store, Diagram = window.Diagram, Report = window.Report,
      Gis = window.Gis, Backup = window.Backup, IO = window.IO, WL = window.WalterLieth, Mapa = window.Mapa, MapView = window.MapView, Satelite = window.Satelite, Perfil = window.Perfil;
  var APP_VERSION = '2.2.0';

  var S = Store.loadState();
  var MEM = new Climate.Memory();
  MEM.add(Store.loadMemory());
  var ui = { tab: 'puntos', gpsOn: false, fix: null, stopWatch: null, sampling: null, fetching: false, diagram: null, sheetOpen: false, undo: null, wasOn: false,
             imp: null, restore: null, edit: null,
             polyView: 'croquis', polyActive: true, mapBase: Mapa.baseId(Store.loadFlag('mapBase')), mapRef: Store.loadFlag('mapRef') === true,
             map: null, mapFollow: false, mapFitKey: null, tileErrors: 0,
             sat: null, satBusy: false, satError: null, sharing: false };

  /* ---------- Utilidades ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function proj() { return S.projects.filter(function (p) { return p.id === S.currentId; })[0] || S.projects[0]; }
  function save() { var r = Store.saveState(S); if (!r.ok) toast(r.error, { err: true }); }
  function saveMemory() { var r = Store.saveMemory(MEM.all()); if (!r.ok) toast(r.error, { err: true }); }

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
  function hideSheet() { var el = $('#sheet'); el.hidden = true; el.innerHTML = ''; ui.sheetOpen = false; }
  function closeSheet() {
    if (!ui.sheetOpen) return;
    if (history.state && history.state.sheet) history.back(); else hideSheet();
  }
  window.addEventListener('popstate', function () { if (ui.sheetOpen) hideSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.sheetOpen) closeSheet(); });

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
    ui.gpsOn = true; ui.fix = null; updateChips();
    ui.stopWatch = Gps.watch(function (fix) { ui.fix = fix; updateReadout(); updateChips(); onMapFix(fix); }, function (e) {
      toast(Gps.explain(e), { err: true });
      if (e && e.code === 1) gpsStop();
    });
    if (ui.tab === 'puntos') renderTab('puntos');
  }
  function gpsStop() {
    if (ui.stopWatch) ui.stopWatch();
    ui.stopWatch = null; ui.gpsOn = false; ui.fix = null; ui.mapFollow = false; updateChips();
    if (ui.map) ui.map.showFix(null);
    if (ui.tab === 'puntos') renderTab('puntos');
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && ui.gpsOn && !ui.sampling) { ui.wasOn = true; gpsStop(); }
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
        var pt = addPoint({ lat: r.lat, lon: r.lon, alt: r.alt, altGps: r.alt, altSrc: isNum(r.alt) ? 'gps' : null, acc: r.acc, altAcc: r.altAcc, src: 'gps' });
        var base = pt.name + ' guardado' + (isNum(r.acc) ? ' (±' + Math.round(r.acc) + ' m, ' + r.n + ' lecturas)' : '');
        if (Gps.precisionState(r.acc, min).worse) {
          toast(base + '. Aviso: la precisión quedó peor que tu mínimo (±' + min + ' m); este punto no es el más preciso.', { action: 'Quitarlo', fn: function () { removePoint(pt.id); } });
        } else {
          toast(base + (isNum(r.alt) ? '' : '. El GPS no dio altitud: escríbela o complétala con internet.'));
        }
      })
      .catch(function (e) { if (!st.cancelled) toast(Gps.explain(e), { err: true }); })
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
    h += '<div class="block"><h2>Posición actual</h2>';
    h += '<div class="readout"><div><span class="k">Latitud</span><span class="v" id="rLat">—</span></div><div><span class="k">Longitud</span><span class="v" id="rLon">—</span></div>' +
         '<div><span class="k">Altitud</span><span class="v" id="rAlt">—</span></div><div><span class="k">Precisión</span><span class="v" id="rAcc">—</span></div></div>' +
         '<div id="precBanner" hidden></div>';
    if (sampling) {
      h += '<div class="prog"><i id="progBar"></i></div><p class="small muted" id="progTxt">Esperando la primera lectura del GPS…</p>';
      h += '<div class="btns"><button class="btn btn-danger" data-act="cancelMark">Cancelar</button></div>';
    } else if (!ui.gpsOn) {
      h += '<div class="btns"><button class="btn btn-primary" data-act="gpsOn">Activar GPS</button><button class="btn" data-act="addCoords">Escribir coordenadas</button></div>';
      h += '<p class="small muted">Con el GPS activo, la altitud del punto se toma sola y la puedes corregir a mano.</p>';
    } else {
      h += '<div class="btns"><button class="btn btn-primary" data-act="mark">Marcar punto aquí</button><button class="btn" data-act="addCoords">Escribir coordenadas</button></div>';
      h += '<p class="small muted">Quédate quieto unos 10 segundos: se promedian las lecturas para mejorar la posición y la altitud. <button class="link" data-act="gpsOff">Apagar GPS</button></p>';
    }
    h += '<label class="f" style="margin:12px 0 0"><span>Precisión mínima para marcar puntos</span><select data-setting="minAcc">' +
      [[0, 'Sin límite'], [3, '±3 m (muy exigente)'], [5, '±5 m'], [10, '±10 m'], [20, '±20 m (campo difícil)']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === S.settings.minAcc ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select><span class="hint">Si el GPS está menos preciso que esto, la app te avisa antes de marcar y tú decides. No bloquea nada.</span></label>';
    h += '</div>';

    h += '<div class="block"><h2>Puntos' + (p.points.length ? '<span class="count">' + p.points.length + '</span>' : '') + '</h2>';
    if (!p.points.length) {
      h += '<div class="empty"><b>Aún no hay puntos</b>Marca tu primer punto con el GPS o escribe unas coordenadas. Con 3 o más puntos se calcula el área.</div>';
    } else {
      h += '<ul class="list">';
      p.points.forEach(function (pt) {
        var low = Gps.precisionState(pt.acc, S.settings.minAcc).worse;
        h += '<li><button class="row" data-act="editPoint" data-id="' + esc(pt.id) + '"><span class="pname">' + esc(pt.name) + '</span>' +
          '<span class="pcoord">' + Fmt.latlon(pt.lat, pt.lon) + (isNum(pt.acc) ? '<span class="psub' + (low ? ' low' : '') + '">precisión ±' + Math.round(pt.acc) + ' m' + (low ? ' · menos preciso que tu mínimo' : '') + '</span>' : '<span class="psub">' + (pt.src === 'gps' ? 'GPS' : pt.src === 'archivo' ? 'de un archivo' : 'escrito a mano') + '</span>') + '</span>' +
          altChip(pt) + '</button></li>';
      });
      h += '</ul>';
    }
    h += '<div class="btns"><button class="btn" data-act="addBulk">Pegar varias coordenadas</button><button class="btn" data-act="importFile">Importar archivo</button></div></div>';
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
    h += '<p class="lead">Tus puntos se usan para el área y la zona de vida. Lo que importes queda en capas de otro color, sin mezclarse con ellos.</p>';
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
  function editMain() {
    var p = proj();
    ui.edit = { kind: 'main', color: p.mainColor };
    openSheet('Color de mis puntos', '<p class="lead">Es el color con el que se dibujan tus puntos y tu polígono en los planos, en Google Earth (al exportar) y en el informe.</p>' + colorPalette(p.mainColor) +
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
  }
  function saveEdit2() {
    var e = ui.edit, p = proj();
    if (!e) return;
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
    csv: { ext: 'csv', mime: 'text/csv', label: 'CSV', sub: 'Excel' }
  };
  function exportBlock() {
    var h = '<div class="block"><h2>Exportar</h2><p class="lead">Para abrir tu terreno en Google Earth, QGIS, Excel o un GPS.</p><div class="expgrid">';
    Object.keys(EXPORTS).forEach(function (k) { h += '<button class="btn" data-act="export" data-fmt="' + k + '">' + EXPORTS[k].label + '<small>' + EXPORTS[k].sub + '</small></button>'; });
    h += '</div><div class="seg" role="group" aria-label="Formato del CSV" style="margin-top:12px">';
    [['es', 'CSV para Excel en español'], ['std', 'CSV estándar']].forEach(function (o) { h += '<button data-act="csvStyle" data-s="' + o[0] + '" aria-pressed="' + (S.settings.csvStyle === o[0]) + '">' + o[1] + '</button>'; });
    h += '</div><p class="small muted">KML, GeoJSON y GPX llevan tus puntos y las capas visibles. El CSV trae solo tus puntos: Punto, Latitud, Longitud, Altitud, Rumbo y Distancia al vértice siguiente (' + (S.settings.csvStyle === 'es' ? 'separado por «;» y con coma decimal' : 'separado por «,» y con punto decimal') + ').</p></div>';
    return h;
  }
  function exportAs(fmt) {
    var p = proj(), spec = EXPORTS[fmt];
    if (!spec) return;
    if (!p.points.length && !(fmt !== 'csv' && p.layers.some(function (l) { return l.visible !== false; }))) { toast('Todavía no hay puntos para exportar.', { err: true }); return; }
    var model = { name: p.name, points: p.points, layers: p.layers, mainColor: p.mainColor, date: Date.now() }, text;
    try {
      text = fmt === 'kml' ? Gis.toKML(model) : fmt === 'geojson' ? Gis.toGeoJSON(model) : fmt === 'gpx' ? Gis.toGPX(model) : Gis.toCSV(p.points, { style: S.settings.csvStyle });
    } catch (e) { toast('No se pudo preparar el archivo: ' + (e && e.message || e), { err: true }); return; }
    var name = IO.slug(p.name, spec.ext);
    IO.saveText(name, spec.mime, text, { title: p.name + ' (' + spec.label + ')', dialogTitle: 'Exportar ' + spec.label }).then(function (r) {
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
      h += '<div class="btns"><button class="btn btn-primary" data-act="saveEdit" data-id="' + esc(pt.id) + '">Guardar cambios</button><button class="btn btn-danger" data-act="askDelete" data-id="' + esc(pt.id) + '">Eliminar punto</button></div>';
    } else {
      h += '<div class="btns"><button class="btn btn-primary" data-act="saveNew" data-more="0">Guardar punto</button><button class="btn" data-act="saveNew" data-more="1">Guardar y añadir otro</button></div>';
    }
    return h;
  }
  function altHint(pt) {
    if (!isNum(pt.alt)) return 'Sin altitud. Escríbela o complétala con internet desde la pestaña Clima.';
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
      else { prev.textContent = Geo.toDMS(r.lat, 'lat', 1) + '   ' + Geo.toDMS(r.lon, 'lon', 1); prev.className = 'preview'; }
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
    openSheet('Editar ' + pt.name, coordFormBody(pt), bindCoordPreview);
  }
  function saveEdit(id) {
    var pt = pointById(id); if (!pt) return;
    var r = Geo.parsePair($('#fCoord').value);
    if (r.error) { toast(r.error, { err: true }); return; }
    var a = parseNum($('#fAlt').value);
    if (a.error) { toast('Altitud: ' + a.error, { err: true }); return; }
    pt.name = $('#fName').value.trim() || pt.name;
    pt.lat = r.lat; pt.lon = r.lon;
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
    var h = '<h2 class="pagetitle">Polígono del terreno</h2><div class="seg" role="group" aria-label="Vista del polígono">';
    [['croquis', 'Croquis'], ['mapa', 'Mapa']].forEach(function (v) {
      h += '<button data-act="polyView" data-v="' + v[0] + '" aria-pressed="' + (ui.polyView === v[0]) + '">' + v[1] + '</button>';
    });
    return h + '</div>' + (ui.polyView === 'mapa' ? mapaHtml() : croquisHtml());
  }
  function croquisHtml() {
    var p = proj(), a = analysis(), h = '';
    var shown = p.layers.filter(function (l) { return l.visible !== false && l.points.length; });
    if (a.empty) {
      if (!shown.length) return '<div class="empty"><b>Sin puntos todavía</b>Agrega al menos 3 puntos en la pestaña Puntos para calcular un área.</div>';
      h += '<div class="tip">Tu proyecto no tiene puntos propios, solo capas importadas. Para calcular el área y la zona de vida, abre una capa en la pestaña Puntos y elige «Usar como polígono del proyecto».</div>';
      h += '<div class="plot">' + Diagram.polygonSVG([], { layers: p.layers, color: p.mainColor }) + '</div>' + Diagram.legendHTML(p.layers, p.mainColor, 'Mis puntos', false);
      return h + exportBlock();
    }
    var unit = S.settings.areaUnit || 'ha';
    var plotOpts = { center: a.center, layers: p.layers, color: p.mainColor };
    var legend = Diagram.legendHTML(p.layers, p.mainColor, 'Mis puntos', true);
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
    h += '<div class="plot">' + Diagram.polygonSVG(p.points, { center: a.center, bad: a.selfIntersects, layers: p.layers, color: p.mainColor }) + '</div>' + legend;
    h += '<p class="small muted">Los puntos se unen en el orden en que están en la lista y el último se une con el primero. El círculo rojo es el centro.</p></div>';

    h += '<div class="block"><h2>Medidas</h2><dl class="kv">';
    ['ha', 'm2', 'km2', 'fanegadas'].forEach(function (u) { h += '<div><dt>' + Fmt.UNITS[u].long + '</dt><dd>' + Fmt.area(a.area, u) + '</dd></div>'; });
    h += '<div><dt>Perímetro</dt><dd>' + Fmt.dist(a.perimeter) + '</dd></div>';
    h += '<div><dt>Vértices</dt><dd>' + a.n + '</dd></div>';
    h += '<div><dt>Centro</dt><dd>' + Fmt.latlon(a.center.lat, a.center.lon) + '</dd></div>';
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
    var before = p.points.slice();
    var order = Geo.angularOrder(p.points);
    p.points = order.map(function (i) { return before[i]; });
    save(); renderTab('area');
    toast('Puntos reordenados.', { action: 'Deshacer', fn: function () { p.points = before; save(); renderTab('area'); } });
  }

  /* ---------- Polígono: vista Mapa ---------- */
  // Calles o satélite, el polígono con sus puntos y cuatro herramientas. El dibujo lo hace mapview.js (Leaflet).
  var ICONS = {
    poly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    last: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
    loc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  function mapaHtml() {
    var p = proj(), h = '';
    h += '<div class="maprow"><span class="small muted">Capa base</span><div class="seg" role="group" aria-label="Capa base">';
    ['calles', 'satelite', 'topo'].forEach(function (id) {
      h += '<button data-act="mapBase" data-b="' + id + '" aria-pressed="' + (ui.mapBase === id) + '">' + esc(Mapa.BASES[id].label) + '</button>';
    });
    h += '</div></div>';
    if (ui.mapBase === 'satelite') h += '<button class="chipbtn" data-act="mapRef" aria-pressed="' + ui.mapRef + '">Calles y nombres sobre el satélite</button>';
    h += '<div class="mapbox' + (ui.mapBase === 'satelite' ? ' with-chip' : '') + '"><div id="mapHost" class="maphost"></div>';
    h += '<div id="mapNotice" class="mapnotice" role="status" hidden></div>';
    if (ui.sampling) {
      h += '<div class="mapprog" role="status"><div class="prog"><i id="mapProgBar"></i></div><p class="small" id="mapProgTxt">Esperando la primera lectura del GPS…</p><button class="btn btn-danger" data-act="cancelMark">Cancelar</button></div>';
    }
    h += '<div class="maptools" role="group" aria-label="Herramientas del mapa">' +
      '<button class="maptool" data-act="mapPoly" aria-pressed="' + ui.polyActive + '">' + ICONS.poly + '<span>' + (ui.polyActive ? 'Polígono activo' : 'Polígono inactivo') + '</span></button>' +
      '<button class="maptool" data-act="mapLast">' + ICONS.last + '<span>Último punto</span></button>' +
      '<button class="maptool" data-act="mapMark"' + (ui.sampling ? ' disabled' : '') + '>' + ICONS.mark + '<span>Marcar punto</span></button></div>';
    h += '<button class="maploc" data-act="mapMyPos" aria-label="Centrar el mapa en mi posición">' + ICONS.loc + '</button></div>';
    if (!p.points.length && !Mapa.visibleLayers(p.layers).length) h += '<div class="tip">Todavía no hay puntos. Pulsa «Marcar punto» para guardar tu posición con el GPS, o agrégalos en la pestaña Puntos.</div>';
    h += '<p class="small muted">«Marcar punto» guarda tu posición con el GPS, promediando lecturas, igual que en la pestaña Puntos. «Último punto» te lleva al último que marcaste. El botón de la derecha centra el mapa donde estás.</p>';
    return h;
  }
  // Alto que tapan las herramientas de abajo (más su separación del borde): el encuadre deja ese espacio libre para que no cubran los puntos
  function toolsInset() { var t = $('.maptools'); return t ? t.offsetHeight + 44 : 100; }
  function mapKey() { var p = proj(); return p.id + ':' + (Mapa.extent(p.points, p.layers) ? 'con-datos' : 'vacio'); }
  function mountMap() {
    var host = $('#mapHost');
    if (!host) return;
    if (!window.L) { host.textContent = 'El mapa no se pudo cargar en este dispositivo.'; return; }
    var p = proj(), a = analysis();
    if (!ui.map) ui.map = MapView.create({ onStatus: onTileStatus });
    ui.map.attach(host);
    ui.map.setBase(ui.mapBase, ui.mapRef);
    ui.map.draw(Mapa.shapes(p, { polyActive: ui.polyActive, bad: !!a.selfIntersects, fmt: function (n) { return Fmt.num(n, 0); } }));
    var key = mapKey();
    if (ui.mapFitKey !== key) { ui.map.fit(Mapa.extent(p.points, p.layers), { bottom: toolsInset() }); ui.mapFitKey = key; }   // solo al cambiar de proyecto o al llegar los primeros datos
    ui.map.showFix(ui.gpsOn ? ui.fix : null);
    updateMapNotice();
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
    if (ui.mapFollow && ui.tab === 'area' && ui.polyView === 'mapa') { ui.mapFollow = false; ui.map.flyTo(fix.lat, fix.lon, 17); }
  }
  function goLastPoint() {
    var pt = Mapa.lastPoint(proj().points);
    if (!pt) { toast('Todavía no hay puntos marcados en este proyecto.'); return; }
    if (ui.map) ui.map.flyTo(pt.lat, pt.lon, 18);
    toast('Último punto: ' + (pt.name || 'sin nombre') + '.');
  }
  function goMyPosition() {
    if (!ui.gpsOn) { gpsStart(); if (!ui.gpsOn) return; }
    if (ui.fix) { if (ui.map) { ui.map.showFix(ui.fix); ui.map.flyTo(ui.fix.lat, ui.fix.lon, 17); } }
    else { ui.mapFollow = true; toast('Buscando tu posición…'); }
  }

  /* ---------- Clima ---------- */
  function srcBadge(src) {
    var map = { manual: ['alt-manual', 'a mano'], online: ['alt-internet', 'internet'], memoria: ['alt-internet', 'memoria'], estimada: ['alt-none', 'estimada'], gps: ['alt-gps', 'GPS'], internet: ['alt-internet', 'internet'], mixta: ['alt-gps', 'varias fuentes'] };
    var m = map[src] || ['alt-none', src || ''];
    return '<span class="alt ' + m[0] + '">' + m[1] + '</span>';
  }
  function numField(field, label, value, hint, ph) {
    return '<label class="f"><span>' + esc(label) + '</span><div class="field-row"><input type="text" inputmode="decimal" data-field="' + field + '" value="' + (isNum(value) ? esc(Fmt.num(value, field === 'tManual' ? 1 : 0)) : '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' +
      (isNum(value) ? '<button class="btn btn-quiet" data-act="clearField" data-field="' + field + '">Quitar</button>' : '') + '</div><span class="hint">' + hint + '</span></label>';
  }

  function tabClima() {
    var a = analysis(), p = proj(), c = p.climate, h = '';
    if (a.empty) return '<div class="empty"><b>Sin puntos todavía</b>Agrega un punto en la pestaña Puntos para ver o completar el clima.</div>';
    var cl = a.climate;

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

    h += '<div class="block"><h2>Precipitación anual</h2>';
    if (isNum(cl.P)) h += '<span class="big">' + Fmt.num(cl.P, 0) + ' <small>mm</small></span> ' + srcBadge(cl.PSrc);
    else h += '<div class="tip">La precipitación no se estima: cambia mucho de un valle a otro. Escríbela, importa un archivo de datos o complétala con internet.</div>';
    h += numField('pManual', 'Escribir la precipitación media anual (mm)', c.pManual, 'Suma de la lluvia de un año típico. Si tienes registros de varios años, usa el promedio.', 'ej. 1200');
    h += '</div>';

    (cl.notes || []).concat(a.warnings || []).forEach(function (n) { h += '<p class="small muted" style="margin:4px 0">• ' + esc(n) + '</p>'; });

    h += walterBlock(a);

    h += '<div class="block" style="margin-top:20px"><h2>Completar con internet</h2>';
    h += '<p class="lead">Trae la altitud de cada punto sin altitud y el clima de la zona, mes por mes (NASA POWER y, si no responde, Open-Meteo). Lo que traes queda guardado en el equipo para usarlo sin conexión.</p>';
    if (ui.staleOnline) h += '<div class="tip">Los datos de internet guardados son de otro lugar; vuelve a completarlos.</div>';
    if (c.online && !ui.staleOnline) h += '<p class="small muted">Última descarga: ' + esc(Fmt.date(c.online.date)) + (c.online.source ? ' · ' + esc(c.online.source) : '') + '.</p>';
    var offline = navigator.onLine === false;
    h += '<button class="btn btn-primary btn-block" data-act="fetchOnline"' + (ui.fetching ? ' disabled' : '') + '>' + (ui.fetching ? 'Consultando…' : 'Completar con internet') + '</button>';
    if (offline) h += '<p class="small muted">Ahora no hay conexión. Tus puntos quedan guardados; completa cuando tengas internet.</p>';
    h += '</div>';

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

  /* ---------- Informe ---------- */
  function hexBadge(sym) {
    return '<svg class="hexbadge" viewBox="0 0 92 104" role="img" aria-label="Símbolo ' + esc(sym) + '"><polygon points="46,3 89,27.5 89,76.5 46,101 3,76.5 3,27.5" fill="var(--green-soft)" stroke="var(--green)" stroke-width="4"/>' +
      '<text x="46" y="' + (sym.length > 5 ? 58 : 60) + '" text-anchor="middle" font-size="' + (sym.length > 5 ? 22 : 27) + '" font-weight="800" fill="var(--ink)" font-family="system-ui,sans-serif">' + esc(sym) + '</text></svg>';
  }

  function tabInforme() {
    var p = proj(), a = analysis(), h = '';
    if (a.empty) return '<div class="empty"><b>Sin puntos todavía</b>Agrega un punto en la pestaña Puntos para generar el informe.</div>';
    var r = a.result;
    if (!r) {
      h += '<div class="tip"><b>Falta la altitud.</b> Sin ella no se puede estimar la temperatura.</div><div class="btns"><button class="btn btn-primary" data-act="tab" data-tab="clima">Ir a Clima</button></div>';
      return h;
    }
    if (!r.ok) {
      h += '<div class="result"><div></div><div><h3>Resultado incompleto</h3><p>Región latitudinal: ' + esc(r.region) + ' · Piso altitudinal: ' + esc(r.belt) + '</p></div></div>';
      h += '<div class="tip"><b>Falta la precipitación anual.</b> Escríbela, importa un archivo de datos o complétala con internet para ubicar el punto en el diagrama.</div><div class="btns"><button class="btn btn-primary" data-act="tab" data-tab="clima">Ir a Clima</button></div>';
      return h;
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

    if (a.vertexZones && a.vertexZones.length && a.distinctZones && a.distinctZones.length > 1) {
      h += '<div class="block"><h2>Zonas según la altitud de cada punto</h2><dl class="kv">';
      a.vertexZones.forEach(function (v) { h += '<div><dt>' + esc(v.name) + ' · ' + Fmt.num(v.alt, 0) + ' m</dt><dd>' + esc(v.zone) + ' (' + esc(v.symbol) + ')</dd></div>'; });
      h += '</dl><p class="small muted">Misma precipitación en todos los puntos; la temperatura cambia con la altitud.</p></div>';
    }

    if (p.points.length >= 2) h += perfilBlock() + '<div class="block" id="satBlock">' + satelliteBlock() + '</div>';

    h += '<div class="block"><h2>Diagrama de Holdridge</h2><div class="diagram-wrap"><div id="diag" style="width:100%;height:100%"></div></div>' +
      '<div class="diagram-tools"><button data-act="dZoomOut" aria-label="Alejar">−</button><button data-act="dZoomIn" aria-label="Acercar">+</button><button class="txt" data-act="dCenter" aria-label="Centrar en el punto">Mi punto</button><button class="txt" data-act="dFit" aria-label="Ver todo el diagrama">Ver todo</button></div>' +
      '<p class="small muted">Arrastra para moverte y pellizca para acercar. El anillo rojo es el punto analizado y el hexágono verde, su zona de vida.</p></div>';

    h += '<div class="block"><h2>Compartir</h2><div class="btns"><button class="btn btn-primary" data-act="share">Compartir informe</button><button class="btn" data-act="copy">Copiar resumen</button></div>' +
      '<p class="small muted" style="margin-top:12px">' + esc(Report.DISCLAIMER) + '</p></div>';
    return h + exportBlock();
  }
  /* ---------- Informe: perfil del relieve y croquis satelital ---------- */
  function perfilBlock() {
    var p = proj(), m = Perfil.build(p.points), h = '<div class="block"><h2>Perfil del relieve</h2>';
    if (!m.ok) return h + '<p class="small muted">' + esc(m.reason) + '</p></div>';
    h += '<div class="plot">' + Perfil.svg(m, { color: p.mainColor, id: 'perfil-app' }) + '</div><dl class="kv" style="margin-top:12px">';
    Perfil.rows(m).forEach(function (x) { h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
    h += '</dl>';
    m.notes.forEach(function (n) { h += '<div class="tip">' + esc(n) + '</div>'; });
    return h + '<p class="small muted">Altitud de cada punto contra la distancia acumulada entre ellos, en el orden de la lista y sin volver al primero. Usa las altitudes guardadas; no consulta internet.</p></div>';
  }
  // El croquis ya preparado solo sirve mientras no cambien los puntos ni las capas visibles
  function satCurrent() { return ui.sat && ui.sat.sig === Satelite.signature(proj()) ? ui.sat : null; }
  function satelliteBlock() {
    var s = satCurrent(), err = ui.satError && ui.satError.sig === Satelite.signature(proj()) ? ui.satError.msg : '';
    var h = '<h2>Croquis satelital</h2>';
    if (ui.satBusy) h += '<p class="small" role="status">Descargando la imagen satelital…</p>';
    else if (s) h += '<div class="plot">' + s.svg + '</div><p class="small muted">' + esc(Satelite.CAPTION) + '</p>';
    else if (err) h += '<div class="warn">No se pudo preparar el croquis satelital: ' + esc(err) + '.</div>';
    h += '<div class="btns"><button class="btn" data-act="satPrepare"' + (ui.satBusy ? ' disabled' : '') + '>' + (s ? 'Volver a preparar' : 'Preparar croquis satelital') + '</button></div>';
    return h + '<p class="small muted">Se baja una sola vez, con internet, y queda guardado dentro del informe que compartes (imagen de Esri, para uso personal o interno). Sin internet, el informe sale sin esta sección.</p>';
  }
  function refreshSatBlock() { var el = $('#satBlock'); if (el) el.innerHTML = satelliteBlock(); }
  // Resuelve siempre con { svg, caption } o { unavailable: motivo }; nunca rechaza. force: volver a bajar aunque ya esté preparado.
  function prepareSatellite(force) {
    var p = proj(), a = analysis(), sig = Satelite.signature(p), cur = satCurrent();
    if (cur && !force) return Promise.resolve({ svg: cur.svg, caption: Satelite.CAPTION });
    function fail(msg) { ui.satError = { sig: sig, msg: msg }; ui.satBusy = false; refreshSatBlock(); return { unavailable: msg }; }
    if (navigator.onLine === false) return Promise.resolve(fail('no hay conexión a internet en este momento'));
    var pl = Satelite.plan(p.points, p.layers);
    if (!pl.ok) return Promise.resolve(fail(pl.reason));
    ui.satBusy = true; ui.satError = null; refreshSatBlock();
    return Satelite.render(pl).then(function (uri) {
      var svg = Satelite.svg(pl, uri, { points: p.points, layers: p.layers, center: a.center, bad: !!a.selfIntersects });
      if (!svg) return fail('la imagen recibida no es válida');
      ui.sat = { sig: sig, svg: svg }; ui.satBusy = false; refreshSatBlock();
      return { svg: svg, caption: Satelite.CAPTION };
    }, function (e) { return fail(e && e.message || 'error desconocido'); });
  }
  function satPrepareClick() {
    prepareSatellite(true).then(function (r) { toast(r.svg ? 'Croquis satelital listo.' : 'No se pudo preparar el croquis satelital.', { err: !r.svg }); });
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
    return { walter: w ? { svg: w.svg, lines: w.lines, source: w.source } : null };
  }
  function shareReport() {
    if (ui.sharing) return;
    var p = proj(), a = analysis(), name = IO.slug('informe zona de vida ' + p.name, 'html');
    ui.sharing = true;
    if (a.n >= 2 && !satCurrent() && navigator.onLine !== false) toast('Preparando el croquis satelital para el informe…');
    (a.n >= 2 ? prepareSatellite(false) : Promise.resolve(null)).then(function (sat) {
      var o = reportOpts(a); o.satellite = sat;
      return IO.saveText(name, 'text/html', Report.html(p, a, o), { title: 'Informe de zona de vida', text: Report.text(p, a, o), dialogTitle: 'Compartir informe' });
    }).then(function (r) {
      ui.sharing = false;
      if (r.how === 'download') toast('Informe descargado: ' + name);
    }).catch(function (e) { ui.sharing = false; toast('No se pudo compartir: ' + (e && e.message || e), { err: true }); });
  }
  function copySummary() {
    var a = analysis(), t = Report.text(proj(), a, reportOpts(a));
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* nada */ }
      ta.remove(); toast(ok ? 'Resumen copiado.' : 'No se pudo copiar.', { err: !ok });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Resumen copiado.'); }, fallback);
    else fallback();
  }

  /* ---------- Proyectos ---------- */
  function openProjects() {
    var h = '<ul class="list">';
    S.projects.forEach(function (p) {
      h += '<li><button class="row" style="grid-template-columns:1fr auto" data-act="pickProject" data-id="' + esc(p.id) + '"><span><span class="pname">' + esc(p.name) + '</span><span class="psub">' + p.points.length + ' punto' + (p.points.length === 1 ? '' : 's') + '</span></span>' + (p.id === S.currentId ? '<span class="alt alt-gps">actual</span>' : '') + '</button></li>';
    });
    h += '</ul><div class="btns"><button class="btn btn-primary" data-act="newProject">Nuevo proyecto</button><button class="btn" data-act="renameProject">Cambiar nombre</button>' + (S.projects.length > 1 ? '<button class="btn btn-danger" data-act="askDeleteProject">Eliminar este proyecto</button>' : '') + '</div>';
    h += '<h3 class="sub">Copia de seguridad</h3><p class="small muted">Guarda todos tus proyectos, puntos, capas, datos de clima y ajustes en un archivo, para no perderlos si cambias de teléfono o desinstalas la app.</p>';
    h += '<div class="btns"><button class="btn" data-act="backupExport">Exportar copia de seguridad</button><button class="btn" data-act="backupPick">Restaurar copia…</button></div>';
    h += '<p class="small muted" style="margin-top:14px">Zonas de Vida versión ' + APP_VERSION + '</p>';
    openSheet('Proyectos', h);
  }

  /* ---------- Copia de seguridad ---------- */
  function backupExport() {
    var b = Backup.create(S, MEM.all(), { appVersion: APP_VERSION }), name = Backup.fileName();
    IO.saveText(name, 'application/json', Backup.stringify(b), { title: 'Copia de seguridad de Zonas de Vida', dialogTitle: 'Guardar copia de seguridad' }).then(function (r) {
      if (r.how === 'download') toast('Copia descargada: ' + name + '. Guárdala en un lugar seguro.');
      else if (r.how === 'share') toast('Copia lista: ' + name + '. Elige dónde guardarla (Drive, correo, archivos…).');
    }).catch(function (e) { toast('No se pudo crear la copia: ' + (e && e.message || e), { err: true }); });
  }
  function restoreFile(file) {
    IO.readText(file).then(function (text) {
      var raw;
      try { raw = JSON.parse(text); } catch (e) { throw new Error('El archivo no es una copia de seguridad (no se pudo leer el JSON).'); }
      var v = Backup.validate(raw, { uid: Store.uid });
      if (!v.ok) { openSheet('No se puede restaurar', '<div class="warn">' + v.errors.map(esc).join('<br>') + '</div><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>'); return; }
      ui.restore = v;
      showRestoreSheet();
    }).catch(function (e) { toast('No se pudo leer la copia: ' + (e && e.message || e), { err: true }); });
  }
  function showRestoreSheet() {
    var v = ui.restore;
    if (!v) return;
    var sm = v.summary;
    var h = '<p class="lead">' + (v.created ? 'Copia del ' + esc(Fmt.date(v.created)) + ': ' : 'Contiene: ') + sm.projects + (sm.projects === 1 ? ' proyecto' : ' proyectos') + ', ' + sm.points + (sm.points === 1 ? ' punto' : ' puntos') +
      (sm.layers ? ', ' + sm.layers + (sm.layers === 1 ? ' capa' : ' capas') : '') + (sm.memory ? ' y ' + sm.memory + ' datos de clima' : '') + '.</p>';
    v.warnings.forEach(function (w) { h += '<p class="small muted" style="margin:4px 0">• ' + esc(w) + '</p>'; });
    h += '<p class="small">Ahora tienes ' + S.projects.length + (S.projects.length === 1 ? ' proyecto' : ' proyectos') + '. ¿Cómo quieres restaurar?</p>';
    h += '<div class="btns"><button class="btn btn-primary" data-act="restoreMerge">Sumar a mis proyectos</button><button class="btn btn-danger" data-act="restoreReplace">Reemplazar todo</button></div>';
    h += '<p class="small muted">«Sumar» conserva lo que ya tienes y agrega los proyectos de la copia (si uno ya existe igual, no se repite). «Reemplazar» borra lo actual y deja solo la copia; podrás deshacerlo unos segundos.</p>';
    openSheet('Restaurar copia de seguridad', h);
  }
  function doRestore(mode) {
    var v = ui.restore;
    if (!v) return;
    var before = JSON.parse(JSON.stringify({ state: S, memory: MEM.all() }));
    var r = Backup.apply({ state: S, memory: MEM.all() }, v.data, mode, { uid: Store.uid });
    S.projects = r.state.projects; S.currentId = r.state.currentId; S.settings = Object.assign({}, S.settings, mode === 'merge' ? {} : r.state.settings);
    MEM.clear(); MEM.add(r.memory);
    ui.restore = null;
    save(); saveMemory(); closeSheet(); renderAll();
    toast(mode === 'merge' ? r.added + (r.added === 1 ? ' proyecto agregado' : ' proyectos agregados') + (r.skipped ? ' · ' + r.skipped + ' ya estaban' : '') + '.' : 'Copia restaurada: ' + r.added + (r.added === 1 ? ' proyecto.' : ' proyectos.'),
      { action: 'Deshacer', fn: function () { S.projects = before.state.projects; S.currentId = before.state.currentId; S.settings = before.state.settings; MEM.clear(); MEM.add(before.memory); save(); saveMemory(); renderAll(); } });
  }
  function nameForm(title, value, act) {
    hideSheet();
    openSheet(title, '<label class="f"><span>Nombre del proyecto</span><input type="text" id="pName" value="' + esc(value) + '" autocomplete="off" maxlength="60"></label><div class="btns"><button class="btn btn-primary" data-act="' + act + '">Guardar</button></div>');
  }

  /* ---------- Pestañas ---------- */
  var TABS = { puntos: tabPuntos, area: tabArea, clima: tabClima, informe: tabInforme };
  function renderTab(t) {
    var el = $('#tab-' + t);
    if (!el) return;
    var sy = window.scrollY;
    el.innerHTML = TABS[t]();
    if (t === 'puntos') { updateReadout(); updateProgress(); }
    if (t === 'area') { mountMap(); updateProgress(); }
    if (t === 'informe') mountDiagram();
    window.scrollTo(0, sy);
  }
  function showTab(t) {
    ui.tab = t;
    ['puntos', 'area', 'clima', 'informe'].forEach(function (k) {
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
    projects: openProjects,
    polyView: function (t) { ui.polyView = t.getAttribute('data-v') === 'mapa' ? 'mapa' : 'croquis'; renderTab('area'); },
    mapBase: function (t) { ui.mapBase = Mapa.baseId(t.getAttribute('data-b')); Store.saveFlag('mapBase', ui.mapBase); renderTab('area'); },
    mapRef: function () { ui.mapRef = !ui.mapRef; Store.saveFlag('mapRef', ui.mapRef); renderTab('area'); },
    mapPoly: function () { ui.polyActive = !ui.polyActive; renderTab('area'); },
    mapLast: goLastPoint,
    mapMark: function () { if (!ui.gpsOn) gpsStart(); markPoint(); },
    mapMyPos: goMyPosition,
    gpsOn: gpsStart, gpsOff: gpsStop, mark: markPoint, cancelMark: cancelMark,
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
    share: shareReport, copy: copySummary, satPrepare: satPrepareClick,
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
    csvStyle: function (t) { S.settings.csvStyle = t.getAttribute('data-s'); save(); renderTab(ui.tab); },
    wlSave: saveWalterSvg, monthly: openMonthly, saveMonthly: saveMonthly, clearMonthly: clearMonthly,
    backupExport: backupExport, backupPick: function () { $('#backupFile').click(); },
    restoreMerge: function () { doRestore('merge'); }, restoreReplace: function () { doRestore('replace'); },
    toastAction: function () { var fn = ui.toastFn; $('#toast').hidden = true; if (fn) fn(); }
  };
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var fn = ACTIONS[t.getAttribute('data-act')];
    if (fn) fn(t, e);
  });
  document.addEventListener('change', function (e) {
    if (!e.target.matches) return;
    if (e.target.matches('[data-field]')) commitField(e.target);
    else if (e.target.matches('[data-setting]')) {
      S.settings[e.target.getAttribute('data-setting')] = parseInt(e.target.value, 10);
      save(); precisionBanner();
      if (ui.tab === 'puntos') renderTab('puntos');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-field]')) e.target.blur();
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
  $('#backupFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) restoreFile(f);
    e.target.value = '';
  });
  window.addEventListener('online', function () { updateChips(); updateMapNotice(); if (ui.tab === 'clima') renderTab('clima'); });
  window.addEventListener('offline', function () { updateChips(); updateMapNotice(); if (ui.tab === 'clima') renderTab('clima'); });

  /* ---------- Inicio ---------- */
  renderAll();
  var native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin trabajo en segundo plano: la app sigue igual */ });
  }
  // Para pruebas automáticas
  window.__app = { S: S, MEM: MEM, ui: ui, analysis: analysis, showTab: showTab, version: APP_VERSION };
})();

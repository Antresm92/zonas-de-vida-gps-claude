/* El reporte (separado de app.js en 2.26.0, sin cambiar lo que hace).
 * Arma la pestaña Reporte: resumen, zona de vida y diagrama de Holdridge, clima y Walter-Lieth, fotos, clima actual,
 * perfil del relieve y croquis satelital y topográfico, qué polígonos van (Completo, Global o Específico) y la entrega
 * en HTML o PDF con la ventana «Elaborando el reporte…». Los cálculos y dibujos los hacen report.js, diagram.js,
 * perfil.js, satelite.js y pdf.js; aquí se decide qué se muestra y en qué orden.
 * Usa lo que app.js le pasa al llamarla: S y ui (el estado), busy y sus funciones (la ventana de espera), $, analysis,
 * view, proj, multi, esc, isNum, toast, openSheet, closeSheet, save, foldReport, photosOf, reportPhotos, sizeText y walterModel. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.reporte = function (ctx) {
    var usosReport = ctx.usosReport, S = ctx.S, ui = ctx.ui, busy = ctx.busy, $ = ctx['$'], analysis = ctx.analysis, busyHide = ctx.busyHide, busyMin = ctx.busyMin, busyPaint = ctx.busyPaint, busyRun = ctx.busyRun, busyStep = ctx.busyStep, closeSheet = ctx.closeSheet, esc = ctx.esc, foldReport = ctx.foldReport, isNum = ctx.isNum, multi = ctx.multi, openSheet = ctx.openSheet, photosOf = ctx.photosOf, proj = ctx.proj, reportPhotos = ctx.reportPhotos, save = ctx.save, sizeText = ctx.sizeText, toast = ctx.toast, view = ctx.view, walterModel = ctx.walterModel;
    var Climate = window.Climate, Diagram = window.Diagram, Fmt = window.Fmt, Fotos = window.Fotos, Geo = window.Geo, IO = window.IO,
      Perfil = window.Perfil, Report = window.Report, Satelite = window.Satelite, Store = window.Store;

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
      (a.info || []).forEach(function (w) { h += '<div class="tip infonote">' + esc(w) + '</div>'; });
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
      var cr = Report.clasifRows(a);
      if (cr.length) {
        h += '<div class="block" id="clasifBlock"><h2>Otras clasificaciones del clima</h2><dl class="kv clasif">';
        cr.forEach(function (x) { h += '<div><dt>' + esc(x[0]) + '</dt><dd><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></dd></div>'; });
        h += '</dl><p class="small muted">' + esc(Report.CLASIF_NOTE) + '</p></div>';
      }
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

      h += '<div class="block"><h2>Más opciones</h2><label class="repline"><input type="checkbox" class="repchk" data-rep="walter"' + (Store.loadFlag('rep_walter') !== false ? ' checked' : '') + '><span>Incluir el diagrama de Walter-Lieth en el reporte (cuando hay datos de los 12 meses)</span></label><p class="small muted" id="repHelp">Las casillas a la izquierda de cada sección deciden qué va en el reporte que compartes. Lo esencial (zona de vida, datos del clima, terreno, puntos y croquis) va siempre.</p><div class="btns"><button class="btn" data-act="copy">Copiar resumen</button><button class="btn" data-act="goExport">Exportar el terreno (KML, GeoJSON, GPX, CSV)</button></div>' +
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
      var pl = Satelite.plan(p.points, p.layers, { kind: kind, focus: true });
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

    // Secciones que la persona desmarcó en la pestaña Reporte (2.18.0): { clave: true }. Por defecto van todas.
    function repSkip() {
      var s = {};
      Report.SECTIONS.forEach(function (x) { if (Store.loadFlag('rep_' + x[0]) === false) s[x[0]] = true; });
      return s;
    }
    function reportOpts(a) {
      var w = walterModel(a);
      var sk = repSkip();
      return { walter: w ? { svg: w.svg, lines: w.lines, source: w.source } : null, author: Store.loadAuthor(), skip: sk, usos: sk.usos ? null : usosReport(a) };
    }
    /* ---------- Qué polígonos van en el reporte (2.20.0) ----------
     *   all    «Completo»: el resumen y luego cada polígono, en orden de jerarquía (cada finca seguida de sus áreas)
     *   fincas «Global»: solo las fincas marcadas (aparece si el proyecto tiene alguna finca con puntos)
     *   one    «Específico»: un solo polígono, el que se elija en la lista */
    function repLots(P) { return Predio.ordered((P || proj()).lots).filter(function (l) { return l.points.length; }); }
    function repFincas(P) { return repLots(P).filter(Predio.isFinca); }
    function repScopeNow(P) {
      P = P || proj();
      if (!multi(P)) return 'one';
      var s = ui.repScope || 'all';
      return s === 'fincas' && !repFincas(P).length ? 'all' : s;
    }
    // Los polígonos que van en el reporte, en orden. Lista vacía = no hay nada elegido.
    function repIds(P) {
      P = P || proj();
      var s = repScopeNow(P), off = ui.repOff || {};
      if (s === 'all') { var all = repLots(P).map(function (l) { return l.id; }); return all.length ? all : [P.lotId]; }
      if (s === 'fincas') return repFincas(P).filter(function (f) { return !off[f.id]; }).map(function (f) { return f.id; });
      return [P.lots.some(function (l) { return l.id === ui.repOne; }) ? ui.repOne : P.lotId];
    }
    function repWhatHtml() {
      var P = proj(), s = repScopeNow(P), fs = repFincas(P), off = ui.repOff || {};
      var one = P.lots.some(function (l) { return l.id === ui.repOne; }) ? ui.repOne : P.lotId;
      function b(k, label) { return '<button data-act="repScope" data-s="' + k + '" aria-pressed="' + (s === k) + '">' + label + '</button>'; }
      var h = '<div class="seg" role="group" aria-label="Qué polígonos van en el reporte" id="repScope" style="margin-bottom:6px">' + b('all', 'Completo') + (fs.length ? b('fincas', 'Global') : '') + b('one', 'Específico') + '</div>';
      if (s === 'fincas') {
        h += '<div class="reppick" id="repFincas">' + fs.map(function (f) {
          return '<label class="repfin"><input type="checkbox" data-finca="' + esc(f.id) + '"' + (off[f.id] ? '' : ' checked') + '><span class="dot" style="background:' + esc(f.mainColor || Predio.FINCA_COLOR) + '"></span>' + esc(f.name) + '</label>';
        }).join('') + '</div><p class="small muted" style="margin-bottom:14px">«Global» trae solo ' + (fs.length > 1 ? 'los predios marcados: el resumen de todos y luego el reporte de cada uno' : 'el predio') + ', sin el detalle de sus lotes.</p>';
      } else if (s === 'one') {
        h += '<div class="reppick"><label class="small" for="repOne">Polígono</label><select id="repOne">' + Predio.ordered(P.lots).map(function (l) {
          return '<option value="' + esc(l.id) + '"' + (l.id === one ? ' selected' : '') + '>' + (Predio.parentOf(l, P.lots) ? '   · ' : '') + esc(Predio.kindLabel(l) + ': ' + l.name) + (l.points.length ? '' : ' (sin puntos)') + '</option>';
        }).join('') + '</select></div><p class="small muted" style="margin-bottom:14px">«Específico» trae el reporte completo de ese polígono, con su croquis enfocado y sus puntos.</p>';
      } else {
        h += '<p class="small muted" style="margin-bottom:14px">«Completo» trae primero el resumen del proyecto (área, altitud y zona de vida de cada polígono, y el total) y después el reporte de cada uno que tenga puntos, en orden: cada predio seguido de sus lotes.</p>';
      }
      return h;
    }
    // Guarda lo marcado en la hoja (las fincas y el polígono elegido) antes de cerrarla o de volver a dibujarla
    function repRead() {
      var sel = $('#repOne');
      if (sel) ui.repOne = sel.value;
      var boxes = document.querySelectorAll('#repFincas input[data-finca]');
      if (boxes.length) { ui.repOff = {}; Array.prototype.forEach.call(boxes, function (c) { if (!c.checked) ui.repOff[c.getAttribute('data-finca')] = true; }); }
    }
    // true si se puede seguir; si no hay nada que reportar lo dice y deja la hoja abierta
    function repReady() {
      repRead();
      if (repIds().length) return true;
      toast('Marca al menos un predio para el reporte.', { err: true });
      return false;
    }
    // «Compartir reporte» pregunta el formato: HTML (se abre en cualquier navegador) o PDF (hoja A4 lista para imprimir)
    function shareReport() {
      if (ui.sharing) return;
      openSheet('Compartir reporte',
        (multi() ? '<p class="lead">¿Qué va en el reporte?</p><div id="repWhat">' + repWhatHtml() + '</div>' : '') +
        '<p class="lead">¿En qué formato quieres el reporte?</p>' +
        '<div class="btns"><button class="btn btn-primary" data-act="shareReportPdf">PDF (hoja A4)</button><button class="btn" data-act="shareReportHtml">HTML</button></div>' +
        '<p class="small muted" style="margin-top:12px"><b>PDF:</b> una hoja A4 lista para imprimir o enviar; se ve igual en cualquier teléfono. <b>HTML:</b> una página web con los gráficos que se acerca bien en pantalla.</p>');
    }
    // Prepara lo que los dos formatos comparten (croquis satelital y topográfico, fotos); entrega { p, a, o, name base }
    // Lo del lote elegido: resuelve con { project, a, o }
    function preparePart() {
      var p = view(), a = analysis();
      var sk = repSkip(), skipOf = { satelital: 'sat', topo: 'topo' };
      var kinds = a.n >= 2 ? CROQ_KINDS.filter(function (k) { return !sk[skipOf[k] || k]; }) : [];      // un croquis desmarcado ni siquiera se prepara
      var need = kinds.filter(function (k) { return !croqCurrent(k); });
      if (need.length && navigator.onLine !== false) busyStep((need.length > 1 ? 'Preparando los croquis satelital y topográfico' : 'Preparando el croquis ' + CROQ[need[0]].noun) + (p.lotName ? ' de «' + p.lotName + '»' : ' para el reporte') + '…');
      else if (Fotos.countAll(p.points).photos) busyStep('Preparando las fotos' + (p.lotName ? ' de «' + p.lotName + '»' : ' para el reporte') + '…');
      return Promise.all([Promise.all(kinds.map(function (k) { return prepareCroquis(k, false); })), sk.fotos ? Promise.resolve({}) : reportPhotos(p)]).then(function (all) {
        var res = all[0], by = {};
        kinds.forEach(function (k, i) { by[k] = res[i] || null; });
        var o = reportOpts(a); o.satellite = by[CROQ_KINDS[0]] || null; o.topo = by[CROQ_KINDS[1]] || null; o.photos = all[1];
        return { project: p, a: a, o: o };
      });
    }
    // Reúne las partes del reporte y llama a build(parts, P). P es el proyecto cuando el reporte es de todos los lotes; si no, null.
    // Para el reporte de todo el proyecto se pasa por cada lote con puntos, uno tras otro (se elige por un momento y al final se vuelve al que estaba).
    function prepareReport(build) {
      var P = proj(), home = P.lotId, ids = repIds(P);
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
    function reportName(parts, P, ext) { return IO.slug('reporte zona de vida ' + proj().name + (!P && parts[0].project.lotName ? ' ' + parts[0].project.lotName : P && repScopeNow() === 'fincas' ? ' fincas' : ''), ext); }
    function shareReportPdf() {
      if (ui.sharing || busy.on || !repReady()) return;
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
      if (ui.sharing || busy.on || !repReady()) return;
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

    return { tabInforme: tabInforme, mountDiagram: mountDiagram, shareReport: shareReport, shareReportPdf: shareReportPdf, shareReportHtml: shareReportHtml, copySummary: copySummary, copyText: copyText, fetchNow: fetchNow, croqPrepareClick: croqPrepareClick, repRead: repRead, repWhatHtml: repWhatHtml };
  };
})();

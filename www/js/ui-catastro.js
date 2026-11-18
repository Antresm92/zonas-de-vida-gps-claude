/* El número predial y el lindero catastral (2.32.0), en la pestaña Polígono (vista Croquis), bloque «Catastro».
 *  A. Archivo (estable): el GeoJSON que se descarga en Colombia en Mapas se importa como cualquier archivo; la app lee su
 *     número predial (gis.js + catastro.js) y lo guarda en el polígono.
 *  B. «Traer el lindero catastral» (puede fallar): consulta el servicio interno de Colombia en Mapas por número predial o por
 *     un punto, y crea un predio con ese lindero o guarda solo el número. Si falla, la hoja explica el camino A paso a paso.
 * La lógica está en catastro.js. Usa lo que app.js le pasa: ui, proj, lot, analysis, esc, toast, openSheet, closeSheet, save,
 * renderTab, pickLot, $. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.catastro = function (ctx) {
    var ui = ctx.ui, proj = ctx.proj, lot = ctx.lot, analysis = ctx.analysis, esc = ctx.esc, toast = ctx.toast, openSheet = ctx.openSheet,
      closeSheet = ctx.closeSheet, save = ctx.save, renderTab = ctx.renderTab, pickLot = ctx.pickLot, $ = ctx['$'];
    var Catastro = window.Catastro, Fmt = window.Fmt, Geo = window.Geo, Store = window.Store;
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function fecha(t) { var d = new Date(t); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear(); }
    function isNum(x) { return typeof x === 'number' && isFinite(x); }
    var FUENTE_TXT = { archivo: 'del archivo de Colombia en Mapas', consulta: 'consultado en Colombia en Mapas', manual: 'escrito a mano' };
    function areaM2(l) { return l && l.points && l.points.length >= 3 ? Geo.polygonArea(l.points) : null; }
    function haTxt(m2) { return Fmt.area(Geo.areaUnits(m2), 'ha'); }

    /* ---------- El bloque «Catastro» del Croquis ---------- */
    function blockHtml() {
      var l = lot(), g = l.predial, h = '<div class="block" id="catBlock"><h2>Catastro</h2>';
      if (g) {
        h += '<dl class="kv" id="catDatos"><div><dt>Número predial</dt><dd>' + esc(Catastro.legible(g.numero)) + '</dd></div>' +
          (g.anterior ? '<div><dt>Número predial anterior</dt><dd>' + esc(g.anterior) + '</dd></div>' : '') +
          (g.municipio ? '<div><dt>Municipio</dt><dd>' + esc(g.municipio) + '</dd></div>' : '') +
          (isNum(g.areaM2) ? '<div><dt>Área catastral</dt><dd>' + esc(haTxt(g.areaM2)) + '</dd></div>' : '') + '</dl>';
        var cmp = Catastro.compara(g.areaM2, areaM2(l));
        if (cmp) h += '<p class="small" id="catCompara">' + esc(cmp.txt) + '</p>';
        h += '<p class="small muted" id="catFuente">Dato ' + esc(FUENTE_TXT[g.fuente] || 'guardado') + (g.at ? ' el ' + fecha(g.at) : '') + '. ' + esc(Catastro.AVISO) + '</p>';
        h += '<div class="btns"><button class="btn" data-act="catOpen" id="catBtn">Traer el lindero catastral</button><button class="btn" data-act="catQuitar">Quitar el número</button></div>';
      } else {
        h += '<p class="small muted" id="catVacio">El número predial y el lindero del catastro del IGAC. Impórtalos con el archivo que se descarga en Colombia en Mapas, o tráelos desde aquí.</p>' +
          '<button class="btn btn-block" data-act="catOpen" id="catBtn">Traer el lindero catastral</button>';
      }
      return h + '</div>';
    }
    function quitar() {
      var l = lot(), before = l.predial;
      if (!before) return;
      delete l.predial; save(); renderTab(ui.tab);
      toast('Número predial quitado de «' + l.name + '».', { action: 'Deshacer', fn: function () { l.predial = before; save(); renderTab(ui.tab); } });
    }

    /* ---------- La hoja «Lindero catastral» ---------- */
    function pasosA() {
      return '<details class="help" id="catPasosA"><summary>Si falla: hazlo con el archivo (siempre funciona)</summary><ol class="small">' +
        '<li>Abre <a href="' + Catastro.PORTAL + '" target="_blank" rel="noopener noreferrer" data-ext="1">colombiaenmapas.gov.co</a>.</li>' +
        '<li>Entra a la consulta catastral y busca tu predio por número predial o tocándolo en el mapa.</li>' +
        '<li>En el resultado, pulsa «Descargar GeoJSON».</li>' +
        '<li>En esta app: Puntos › «Importar archivo» (o ＋ Predio › «Importar archivo») y elige ese archivo. El número predial queda guardado en el polígono.</li></ol></details>';
    }
    function resultHtml() {
      var r = ui.catRes;
      if (!r) return '';
      if (r.busy) return '<p class="small muted" id="catEstado">Consultando Colombia en Mapas…</p>';
      if (r.error) return '<div class="warn" id="catError"><b>No se pudo traer el lindero.</b> ' + esc(r.error) + ' Prueba de nuevo más tarde, o usa el archivo (abajo).</div>';
      if (!r.data) return '<div class="tip" id="catNada">Colombia en Mapas no tiene información catastral ' + esc(r.donde) + '. En algunos municipios el catastro lo lleva otro gestor (por ejemplo Bogotá, Antioquia, Medellín o Cali): consúltalo en su portal.</div>';
      var d = r.data, ring = Catastro.mainRing(d), l = lot(), h = '<div class="tip" id="catResultado"><dl class="kv">' +
        (d.numero ? '<div><dt>Número predial</dt><dd>' + esc(Catastro.legible(d.numero)) + '</dd></div>' : '') +
        (d.municipio ? '<div><dt>Municipio</dt><dd>' + esc(d.municipio) + '</dd></div>' : '') +
        (isNum(d.areaM2) ? '<div><dt>Área catastral</dt><dd>' + esc(haTxt(d.areaM2)) + '</dd></div>' : '') +
        (ring ? '<div><dt>Lindero</dt><dd>' + ring.length + ' vértices' + (d.rings.length > 1 ? ' (y ' + (d.rings.length - 1) + (d.rings.length === 2 ? ' parte más' : ' partes más') + ', que no se usan)' : '') + '</dd></div>' : '') + '</dl>';
      var cmp = Catastro.compara(d.areaM2, areaM2(l));
      if (cmp) h += '<p class="small">Frente a «' + esc(l.name) + '»: ' + esc(cmp.txt) + '</p>';
      h += '</div><div class="btns">' + (ring ? '<button class="btn btn-primary" data-act="catCrear" id="catCrearBtn">Crear un predio con este lindero</button>' : '') +
        (d.numero ? '<button class="btn" data-act="catGuardarNum">Guardar solo el número en «' + esc(l.name) + '»</button>' : '') + '</div>';
      return h;
    }
    function sheetBody() {
      var a = analysis(), l = lot(), g = l.predial, h = '';
      h += '<div class="warn" id="catAviso"><b>Puede fallar.</b> Esta búsqueda usa el servicio interno de Colombia en Mapas (IGAC), que no está publicado para otras apps: puede cambiar o dejar de funcionar sin aviso. Si falla, usa el archivo (abajo).</div>';
      h += '<label class="f"><span>Número predial</span><input type="text" id="catNum" inputmode="numeric" autocomplete="off" maxlength="40" value="' + esc(ui.catNum !== undefined ? ui.catNum : (g ? g.numero : '')) + '" placeholder="30 dígitos (o el anterior, de 20)">' +
        '<span class="hint">Está en el recibo del impuesto predial o en el certificado catastral.</span></label>';
      h += '<div class="btns"><button class="btn btn-primary" data-act="catBuscarNum">Buscar por número predial</button><button class="btn" data-act="catGuardarManual">Guardar el número sin consultar</button></div>';
      var pts = [];
      if (a && a.center && isNum(a.center.lat)) pts.push('<button class="btn" data-act="catBuscarCentro">Buscar en el centro de «' + esc(l.name) + '»</button>');
      if (ui.gpsOn && ui.fix && isNum(ui.fix.lat)) pts.push('<button class="btn" data-act="catBuscarGps">Buscar donde estoy (GPS)</button>');
      if (pts.length) h += '<p class="small muted" style="margin:10px 0 4px">O busca el predio que está en un punto:</p><div class="btns">' + pts.join('') + '</div>';
      h += '<div id="catRes">' + resultHtml() + '</div>' + pasosA();
      h += '<p class="small muted">' + esc(Catastro.AVISO) + ' Solo se guardan el número predial, el municipio, el área y el lindero; la dirección y el avalúo que trae la consulta se descartan.</p>';
      return h;
    }
    function open() { ui.catRes = null; ui.catNum = undefined; openSheet('Lindero catastral', sheetBody()); }
    function refresh() { var el = $('#catRes'); if (el) el.innerHTML = resultHtml(); }
    function readNum() { var el = $('#catNum'); ui.catNum = el ? el.value : ''; return Catastro.numero(ui.catNum); }

    function post(body, ms) {
      if (typeof fetch === 'undefined') return Promise.reject(new Error('sin red'));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
      return fetch(Catastro.SERVICE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body + '&t=' + Date.now(), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (timer) clearTimeout(timer); if (!r.ok) throw new Error('el servicio respondió ' + r.status + '.'); return r.json(); },
          function (e) { if (timer) clearTimeout(timer); throw e; });
    }
    function buscar(body, donde) {
      if (ui.catRes && ui.catRes.busy) return;
      ui.catRes = { busy: true }; refresh();
      post(body, 25000).then(function (j) {
        var r = Catastro.parse(j);
        ui.catRes = r.ok ? { data: r.data, donde: donde } : { error: 'El servicio respondió con un error (' + r.error + ').' };
        refresh();
      }, function (e) {
        ui.catRes = { error: e && e.name === 'AbortError' ? 'Colombia en Mapas no respondió a tiempo.' : 'Sin conexión o el servicio no está disponible.' };
        refresh();
      });
    }
    function buscarNum() {
      var n = readNum();
      if (!n) { toast('El número predial tiene 30 dígitos (o 20 el anterior). Revísalo.', { err: true }); return; }
      buscar(Catastro.bodyNumero(n), 'para ese número');
    }
    function buscarPunto(lat, lon, donde) { readNum(); buscar(Catastro.bodyXY(lat, lon), donde); }
    function buscarCentro() { var a = analysis(); if (a && a.center) buscarPunto(a.center.lat, a.center.lon, 'en el centro de «' + lot().name + '»'); }
    function buscarGps() { if (ui.fix) buscarPunto(ui.fix.lat, ui.fix.lon, 'donde estás'); }

    function setPredial(l, g) {
      var before = l.predial;
      var c = Catastro.clean(g);
      if (c) l.predial = c; else delete l.predial;
      return function () { if (before) l.predial = before; else delete l.predial; };
    }
    function guardarManual() {
      var n = readNum(), l = lot();
      if (!n) { toast('El número predial tiene 30 dígitos (o 20 el anterior). Revísalo.', { err: true }); return; }
      var undo = setPredial(l, { numero: n, fuente: 'manual', at: Date.now() });
      save(); closeSheet(); renderTab(ui.tab);
      toast('Número predial guardado en «' + l.name + '».', { action: 'Deshacer', fn: function () { undo(); save(); renderTab(ui.tab); } });
    }
    function guardarNum() {
      var d = ui.catRes && ui.catRes.data, l = lot();
      if (!d || !d.numero) return;
      var undo = setPredial(l, Object.assign({}, d, { fuente: 'consulta', at: Date.now() }));
      save(); closeSheet(); renderTab(ui.tab);
      toast('Número predial guardado en «' + l.name + '».', { action: 'Deshacer', fn: function () { undo(); save(); renderTab(ui.tab); } });
    }
    // Crea un predio (finca, con el lindero bloqueado) con el lindero catastral. Si el proyecto solo tiene un polígono vacío, lo usa.
    function crear() {
      var d = ui.catRes && ui.catRes.data, ring = Catastro.mainRing(d), p = proj();
      if (!ring) return;
      var empty = p.lots.length === 1 && !p.lots[0].points.length ? p.lots[0] : null;
      if (!empty && p.lots.length >= Store.LOT_MAX) { toast('Un proyecto admite hasta ' + Store.LOT_MAX + ' lotes.', { err: true }); return; }
      var lotsBefore = p.lots.slice(), prev = p.lotId, emptyBefore = empty ? JSON.stringify(empty) : null;
      var name = Store.lotName('Predio ' + (d.municipio ? d.municipio.split(',')[0] : 'catastral'), p.lots.length);
      var pts = window.Gis.pointsFromLayer({ points: ring.map(function (q) { return { lat: q.lat, lon: q.lon, alt: null }; }), ts: Date.now() }, Store.uid);
      var nl = empty || Store.newLot(name, window.Predio ? window.Predio.FINCA_COLOR : undefined);
      nl.name = name; nl.kind = 'finca'; nl.points = pts; nl.nextPoint = pts.length + 1; nl.locked = true;
      delete nl.parent; delete nl.cat;
      setPredial(nl, Object.assign({}, d, { fuente: 'consulta', at: Date.now() }));
      if (!empty) p.lots.push(nl);
      ui.mapFitKey = null;
      if (empty) { p.lotId = nl.id; save(); } else pickLot(nl.id, true);
      save(); closeSheet(); renderTab(ui.tab);
      toast('«' + nl.name + '» creado con el lindero catastral (' + pts.length + ' puntos, sin altitud: usa «Completar con internet»).', { action: 'Deshacer', fn: function () {
        if (empty) { var o = JSON.parse(emptyBefore); Object.keys(empty).forEach(function (k) { delete empty[k]; }); Object.assign(empty, o); }
        else p.lots = lotsBefore;
        p.lotId = prev; ui.mapFitKey = null; save(); renderTab(ui.tab);
      } });
    }

    // Filas para el reporte (sección «Terreno»)
    function reportRows() {
      var g = lot().predial;
      if (!g) return [];
      var rows = [['Número predial', Catastro.legible(g.numero) + (g.municipio ? ' · ' + g.municipio : '')]];
      if (isNum(g.areaM2)) {
        var cmp = Catastro.compara(g.areaM2, areaM2(lot()));
        rows.push(['Área catastral (referencia)', haTxt(g.areaM2) + (cmp ? ' · ' + cmp.txt : '')]);
      }
      return rows;
    }
    // Al importar un archivo: guarda en el polígono el número predial que trae (camino A). Devuelve con qué deshacerlo.
    function fromImport(l, pr) {
      if (!pr) return function () {};
      return setPredial(l, Object.assign({}, pr, { fuente: 'archivo', at: Date.now() }));
    }

    return { blockHtml: blockHtml, quitar: quitar, open: open, buscarNum: buscarNum, buscarCentro: buscarCentro, buscarGps: buscarGps,
      guardarManual: guardarManual, guardarNum: guardarNum, crear: crear, reportRows: reportRows, fromImport: fromImport };
  };
})();

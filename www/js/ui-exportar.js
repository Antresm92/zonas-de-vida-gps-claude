/* Exportar el terreno a otros programas (separado de app.js en 2.24.0, sin cambiar lo que hace).
 * Arma el bloque «Exportar» de Polígono › Croquis (KML, GeoJSON, GPX, CSV y Shapefile), la lista «Elegir polígonos»
 * y los archivos que salen. Los formatos los escriben gis.js y shp.js; io.js entrega el archivo (descarga o compartir).
 * Usa lo que app.js le pasa al llamarla: S (el estado guardado), ui (el estado de la pantalla), proj (el proyecto
 * abierto), multi (si hay varios polígonos), esc, lotArea, toast, openSheet, closeSheet, renderTab y viewLayers. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.exportar = function (ctx) {
    var S = ctx.S, ui = ctx.ui, proj = ctx.proj, multi = ctx.multi, esc = ctx.esc, lotArea = ctx.lotArea, toast = ctx.toast,
      openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, renderTab = ctx.renderTab, viewLayers = ctx.viewLayers;
    var Geo = window.Geo, Fmt = window.Fmt, Gis = window.Gis, IO = window.IO, Predio = window.Predio, Shp = window.Shp;

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
      h += '</div>';
      // 2.23.6: con varios polígonos, «Todo el proyecto» o «Elegir polígonos ▾» (una lista con casillas para escoger cuáles salen en el archivo)
      if (multi()) {
        var sel = expPicked();
        h += '<div class="seg" role="group" aria-label="Qué exportar" id="expScope" style="margin-top:12px">' +
          '<button data-act="expScope" data-s="all" aria-pressed="' + !ui.expPick + '">Todo el proyecto</button>' +
          '<button data-act="expPickOpen" aria-pressed="' + !!ui.expPick + '" aria-haspopup="true">' + (ui.expPick && sel.length ? 'Elegidos (' + sel.length + ') ▾' : 'Elegir polígonos ▾') + '</button></div>';
        if (ui.expPick && sel.length) h += '<p class="small" id="expSelTxt" style="margin:6px 0 0">Se ' + (sel.length === 1 ? 'exportará' : 'exportarán') + ': ' + esc(sel.map(function (l) { return l.name; }).join(', ')) + '.</p>';
      }
      h += '<div class="seg" role="group" aria-label="Formato del CSV" style="margin-top:12px">';
      [['es', 'CSV para Excel en español'], ['std', 'CSV estándar']].forEach(function (o) { h += '<button data-act="csvStyle" data-s="' + o[0] + '" aria-pressed="' + (S.settings.csvStyle === o[0]) + '">' + o[1] + '</button>'; });
      h += '</div><p class="small muted">' + (multi() ? 'Con «Elegir polígonos» marcas cuáles salen en el archivo (con uno solo, el archivo lleva su nombre: sirve para llevarlo como lote a otro proyecto). ' : '') + 'KML, GeoJSON y GPX llevan tus puntos y las capas visibles. El CSV trae solo tus puntos: Punto, Latitud, Longitud, Altitud, Rumbo, Distancia al vértice siguiente y las coordenadas planas Este y Norte (Origen Nacional), ' + (S.settings.csvStyle === 'es' ? 'separado por «;» y con coma decimal' : 'separado por «,» y con punto decimal') + '. El Shapefile es un .zip con dos capas, tus puntos y el polígono, en grados WGS84.</p></div>';
      return h;
    }
    // Los polígonos marcados en «Elegir polígonos» que existen y tienen puntos, en el orden de la jerarquía (cada predio y luego sus lotes)
    function expPicked() {
      var p = proj(), ids = ui.expSelProj === p.id ? (ui.expSel || []) : [];
      return Predio.ordered(p.lots).filter(function (l) { return ids.indexOf(l.id) >= 0 && l.points.length; });
    }
    function openExpPick() {
      var p = proj(), ids = ui.expSelProj === p.id ? (ui.expSel || []) : [];
      var rows = Predio.ordered(p.lots).filter(function (l) { return l.points.length; });
      if (!rows.length) { toast('Todavía no hay polígonos con puntos para exportar.', { err: true }); return; }
      openSheet('Qué polígonos exportar', '<p class="small muted" style="margin-top:0">Marca los que quieres en el archivo. Al marcar un predio se marcan también sus lotes; luego puedes quitar los que no quieras.</p>' +
        '<div id="expList">' + rows.map(function (l) {
          var par = Predio.parentOf(l, p.lots), m2 = lotArea(l);
          return '<label class="repfin expick' + (par ? ' sub' : '') + '"><input type="checkbox" data-id="' + esc(l.id) + '"' + (Predio.isFinca(l) ? ' data-finca="1"' : '') + (par ? ' data-parent="' + esc(par.id) + '"' : '') + (ids.indexOf(l.id) >= 0 ? ' checked' : '') + '>' +
            '<span>' + (Predio.isFinca(l) ? '<b>' + esc(l.name) + '</b>' : esc(l.name)) + ' <small class="muted">· ' + esc(Predio.kindLabel(l)) + (m2 ? ' · ' + esc(Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit)) : '') + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="btns" style="margin-top:10px"><button class="btn" data-act="expPickAll" data-v="1">Marcar todos</button><button class="btn" data-act="expPickAll" data-v="0">Ninguno</button></div>' +
        '<div class="btns"><button class="btn btn-primary" data-act="expPickDone">Listo</button></div>');
    }
    function expPickDone() {
      var ids = [].filter.call(document.querySelectorAll('#expList input'), function (i) { return i.checked; }).map(function (i) { return i.getAttribute('data-id'); });
      ui.expSel = ids; ui.expSelProj = proj().id; ui.expPick = ids.length > 0;
      closeSheet(); renderTab(ui.tab);
      if (!ids.length) toast('No marcaste ninguno: se exportará todo el proyecto.');
    }
    // Un polígono como capa del archivo exportado (con su nombre y su color)
    function lotAsLayer(l) {
      return { id: 'lote-' + l.id, name: l.name, kind: l.points.length >= 3 ? 'polygon' : l.points.length === 2 ? 'line' : 'points', color: l.mainColor, visible: true, points: l.points };
    }
    function exportLots(p, only) { return p.lots.filter(function (l) { return l.points.length && (!only || only.indexOf(l) >= 0); }).map(function (l) { var par = Predio.parentOf(l, p.lots), o = { name: l.name, points: l.points };
      if (l.kind) o.tipo = Predio.kindLabel(l) + (par ? ' de ' + par.name : '');      // «Finca», «Potrero de La Esperanza»…
      return o; }); }
    function exportAs(fmt) {
      var p = proj(), spec = EXPORTS[fmt];
      if (!spec) return;
      var pick = multi(p) && !!ui.expPick ? expPicked() : null;
      if (pick && !pick.length) { ui.expPick = false; pick = null; }
      var one = pick && pick.length === 1, me = one ? pick[0] : null, many = pick && pick.length > 1 ? pick : null;
      if (fmt === 'shp') { exportShp(p, spec, me, many); return; }
      var any = p.lots.some(function (l) { return l.points.length; });
      if (!any && !(fmt !== 'csv' && p.layers.some(function (l) { return l.visible !== false; }))) { toast('Todavía no hay puntos para exportar.', { err: true }); return; }
      // Con varios lotes van todos: el elegido como polígono principal y los demás como capas con su nombre; en el CSV, con una columna «Lote»
      var title = one ? p.name + ' ' + me.name : many ? p.name + ' seleccion' : p.name;
      // varios elegidos: el primero como polígono principal y los demás como capas, como en «Todo el proyecto» pero sin los que no se marcaron
      var model = one ? { name: me.name, points: me.points, layers: [], mainColor: me.mainColor, date: Date.now() } :
        many ? { name: many[0].name, points: many[0].points, layers: many.slice(1).map(lotAsLayer), mainColor: many[0].mainColor, date: Date.now() } :
        { name: p.name, points: p.points, layers: viewLayers(p), mainColor: p.mainColor, date: Date.now() }, text;
      try {
        text = fmt === 'kml' ? Gis.toKML(model) : fmt === 'geojson' ? Gis.toGeoJSON(model) : fmt === 'gpx' ? Gis.toGPX(model) :
          Gis.toCSV(one ? me.points : p.points, many ? { style: S.settings.csvStyle, lots: exportLots(p, many) } : multi(p) && !one ? { style: S.settings.csvStyle, lots: exportLots(p) } : { style: S.settings.csvStyle });
      } catch (e) { toast('No se pudo preparar el archivo: ' + (e && e.message || e), { err: true }); return; }
      var name = IO.slug(title, spec.ext);
      IO.saveText(name, spec.mime, text, { title: title + ' (' + spec.label + ')', dialogTitle: 'Exportar ' + spec.label }).then(function (r) {
        if (r.how === 'download') toast('Archivo descargado: ' + name);
        else if (r.how === 'share') toast('Archivo listo: ' + name);
      }).catch(function (e) { toast('No se pudo guardar el archivo: ' + (e && e.message || e), { err: true }); });
    }

    // El Shapefile son varios archivos: se entregan juntos en un .zip (QGIS y ArcGIS lo abren así)
    function exportShp(p, spec, only, many) {
      if (!p.lots.some(function (l) { return l.points.length; })) { toast('Todavía no hay puntos para exportar.', { err: true }); return; }
      var title = only ? p.name + ' ' + only.name : many ? p.name + ' seleccion' : p.name;
      var name = IO.slug(title) + '-shapefile.zip', bytes, m = { name: only ? only.name : p.name, base: IO.slug(title).replace(/-/g, '_') };
      if (only) m.points = only.points; else if (many) m.lots = exportLots(p, many); else if (multi(p)) m.lots = exportLots(p); else m.points = p.points;
      try { bytes = Shp.zip(m, Date.now()); }
      catch (e) { toast('No se pudo preparar el archivo: ' + (e && e.message || e), { err: true }); return; }
      IO.saveBytes(name, spec.mime, bytes, { title: p.name + ' (' + spec.label + ')', dialogTitle: 'Exportar ' + spec.label }).then(function (r) {
        if (r.how === 'download') toast('Archivo descargado: ' + name);
        else if (r.how === 'share') toast('Archivo listo: ' + name);
      }).catch(function (e) { toast('No se pudo guardar el archivo: ' + (e && e.message || e), { err: true }); });
    }

    // Botones de la hoja: «Todo el proyecto» y «Marcar todos» / «Ninguno»
    function expScope() { ui.expPick = false; renderTab(ui.tab); }
    function expPickAll(t) { var v = t.getAttribute('data-v') === '1'; [].forEach.call(document.querySelectorAll('#expList input'), function (i) { i.checked = v; }); }
    // «Qué polígonos exportar»: marcar o desmarcar un predio hace lo mismo con sus lotes (después se pueden cambiar uno por uno)
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.matches || !t.matches('#expList input[data-finca]')) return;
      [].forEach.call(document.querySelectorAll('#expList input[data-parent="' + t.getAttribute('data-id') + '"]'), function (i) { i.checked = t.checked; });
    });

    return { exportBlock: exportBlock, exportAs: exportAs, openExpPick: openExpPick, expPickDone: expPickDone, expScope: expScope, expPickAll: expPickAll };
  };
})();

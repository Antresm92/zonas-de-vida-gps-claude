/* El mapa de capacidad de uso del IGAC en la app (2.31.0).
 *  1. «Según el mapa del IGAC», dentro de «Usos recomendados» (Información): consulta el mapa oficial en el centro del
 *     polígono y guarda la respuesta en el polígono (lot.igac), para verla sin conexión y llevarla al reporte.
 *  2. La capa «Capacidad de uso (IGAC)» del mapa (botón de capas): con internet se ven las baldosas del IGAC; con
 *     «Guardar para usar sin conexión» se descargan los polígonos de la zona del predio (IndexedDB), que se dibujan en el
 *     teléfono cuando no hay conexión y sirven también para la consulta del punto 1.
 * La lógica está en igac.js; aquí solo la pantalla, las descargas y lo guardado.
 * Usa lo que app.js le pasa al llamarla: ui, proj, lot, analysis, esc, toast, save, renderTab, $. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.igac = function (ctx) {
    var ui = ctx.ui, proj = ctx.proj, lot = ctx.lot, analysis = ctx.analysis, esc = ctx.esc, toast = ctx.toast, save = ctx.save,
      renderTab = ctx.renderTab, $ = ctx['$'];
    var Igac = window.Igac, Fmt = window.Fmt, Store = window.Store;
    var ATTR = 'Capacidad de uso: IGAC (CC BY 4.0)';
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function fecha(t) { var d = new Date(t); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear(); }
    function isNum(x) { return typeof x === 'number' && isFinite(x); }

    /* ---------- Lo descargado (IndexedDB, una zona por proyecto) ---------- */
    var DB_NAME = 'zvg.v1.igac', STORE = 'zonas', mem = {}, loaded = {}, dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve) {
        try {
          if (typeof indexedDB === 'undefined') return resolve(null);
          var rq = indexedDB.open(DB_NAME, 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
          rq.onsuccess = function () { resolve(rq.result); };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        if (!d) return null;
        return new Promise(function (resolve) {
          try {
            var t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
            t.oncomplete = function () { resolve(r && 'result' in r ? r.result : true); };
            t.onerror = t.onabort = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    }
    function valid(rec) { return rec && typeof rec === 'object' && rec.cache && Array.isArray(rec.cache.features) && isNum(rec.at); }
    function load(pid) {
      if (loaded[pid]) return Promise.resolve(mem[pid] || null);
      return tx('readonly', function (s) { return s.get(pid); }).then(function (rec) {
        loaded[pid] = true;
        if (valid(rec) && !mem[pid]) mem[pid] = rec;
        return mem[pid] || null;
      });
    }
    function put(rec) { mem[rec.id] = rec; loaded[rec.id] = true; return tx('readwrite', function (s) { return s.put(rec); }); }
    function del(pid) { delete mem[pid]; loaded[pid] = true; return tx('readwrite', function (s) { return s['delete'](pid); }); }
    function cached() { return mem[proj().id] || null; }

    function get(url, ms) {
      if (typeof fetch === 'undefined') return Promise.reject(new Error('sin red'));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
      return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (e) { if (timer) clearTimeout(timer); throw e; });
    }

    /* ---------- 1. «Según el mapa del IGAC» ---------- */
    function consult() {
      var l = lot(), a = analysis(), c = a && a.center;
      if (!c || !isNum(c.lat)) { toast('Marca primero un punto del polígono.', { err: true }); return; }
      if (ui.igacBusy) return;
      ui.igacBusy = true; renderTab(ui.tab);
      var lid = l.id;
      function done(data, src) {
        ui.igacBusy = false;
        var target = proj().lots.filter(function (x) { return x.id === lid; })[0];
        if (!target) { renderTab(ui.tab); return; }
        if (!data) { renderTab(ui.tab); toast('El mapa del IGAC no tiene datos en este punto (fuera de Colombia o sin estudio de suelos).', { err: true }); return; }
        var before = target.igac ? JSON.stringify(target.igac) : null;
        target.igac = Igac.clean(Object.assign({}, data, { lat: c.lat, lon: c.lon, at: Date.now(), src: src }));
        save(); renderTab(ui.tab);
        toast(src === 'guardado' ? 'Consultado en lo guardado sin conexión.' : 'Consulta del mapa del IGAC guardada.', { action: 'Deshacer', fn: function () {
          if (before) target.igac = JSON.parse(before); else delete target.igac; save(); renderTab(ui.tab);
        } });
      }
      function offline(why) {
        return load(proj().id).then(function (rec) {
          var hit = rec ? Igac.classAt(rec.cache, c.lat, c.lon) : null;
          if (hit) return done(hit, 'guardado');
          ui.igacBusy = false; renderTab(ui.tab);
          toast('No se pudo consultar el mapa del IGAC (' + why + '). Necesita internet, o la zona guardada desde el botón de capas del mapa.', { err: true });
        });
      }
      get(Igac.pointUrl(c.lat, c.lon), 20000).then(function (j) {
        var r = Igac.parse(j);
        if (!r.ok) return offline(r.error);
        done(r.data, 'internet');
      }, function (e) { offline(e && e.name === 'AbortError' ? 'no respondió a tiempo' : 'sin conexión'); });
    }
    function quitar() {
      var l = lot(), before = l.igac ? JSON.stringify(l.igac) : null;
      if (!before) return;
      delete l.igac; save(); renderTab(ui.tab);
      toast('Consulta del IGAC quitada.', { action: 'Deshacer', fn: function () { l.igac = JSON.parse(before); save(); renderTab(ui.tab); } });
    }
    function claseTxt(g) { return g.clase !== null ? 'Clase ' + g.clase : g.especial; }
    // Lo que va dentro del bloque «Usos recomendados». claseApp: la clase que calcula la app (o null). ref(n): botón de la fuente.
    function blockHtml(l, claseApp, ref) {
      var g = l.igac, h = '<div class="igacbox" id="igacBox"><h3 class="sub">Según el mapa del IGAC</h3>';
      if (ui.igacBusy) return h + '<p class="small muted" id="igacEstado">Consultando el mapa del IGAC…</p></div>';
      if (!g) {
        return h + '<p class="small muted" id="igacEstado">El mapa oficial de capacidad de uso del IGAC, en el centro del polígono. Necesita internet (o la zona guardada desde el botón de capas del mapa). ' + ref(4) + '</p>' +
          '<button class="btn btn-block" data-act="igacConsult" id="igacBtn">Consultar el mapa del IGAC</button></div>';
      }
      h += '<div class="usoclase" id="igacClase"><span class="big">' + esc(claseTxt(g)) + '</span>' + (g.clase !== null ? ' <span class="usosub">subclase ' + esc(g.codigo) + (g.ucp && g.ucp !== g.codigo ? ' · unidad ' + esc(g.ucp) : '') + '</span>' : '') + '</div>';
      var cmp = Igac.compara(g, claseApp);
      if (cmp) h += '<p class="small" id="igacCompara"><b>' + (cmp.igual ? 'Coincide' : 'No coincide') + ':</b> ' + esc(cmp.txt) + '</p>';
      var letr = Igac.letras(g.codigo).filter(function (x) { return x.length > 1; });
      h += '<dl class="guide" id="igacDatos">' +
        (letr.length ? '<div><dt>Subclase</dt><dd>' + esc(letr.join(', ')) + '</dd></div>' : '') +
        (g.limitantes ? '<div><dt>Limitantes</dt><dd>' + esc(g.limitantes) + '</dd></div>' : '') +
        (g.usos ? '<div><dt>Usos recomendados</dt><dd>' + esc(g.usos) + '</dd></div>' : '') + '</dl>';
      if (g.practicas) h += '<details class="help"><summary>Prácticas de manejo (IGAC)</summary><p class="small" id="igacPracticas">' + esc(g.practicas) + '</p></details>';
      h += '<p class="small muted" id="igacEstudio">' + (g.estudio ? esc(g.estudio) + '. ' : '') + (g.escala ? 'Escala ' + esc(g.escala) + (g.anio ? ', ' + esc(g.anio) : '') + '. ' : '') +
        (g.at ? 'Consultado el ' + fecha(g.at) + (g.src === 'guardado' ? ' en lo guardado sin conexión' : '') : '') +
        (isNum(g.lat) ? ' en ' + esc(Fmt.latlon(g.lat, g.lon)) : '') + '. ' + ref(4) + '</p>';
      h += '<div class="btns"><button class="btn" data-act="igacConsult" id="igacBtn">Volver a consultar</button><button class="btn" data-act="igacQuitar">Quitar</button></div>';
      return h + '</div>';
    }
    // Filas para el reporte (sección «Usos recomendados»)
    function reportRows(l) {
      var g = l && l.igac;
      if (!g) return [];
      var rows = [['Según el mapa del IGAC', claseTxt(g) + (g.clase !== null ? ' · subclase ' + g.codigo + (g.ucp && g.ucp !== g.codigo ? ' (unidad ' + g.ucp + ')' : '') : '')]];
      if (g.limitantes) rows.push(['Limitantes (mapa del IGAC)', g.limitantes]);
      if (g.usos) rows.push(['Usos recomendados (mapa del IGAC)', g.usos]);
      if (g.practicas) rows.push(['Prácticas de manejo (mapa del IGAC)', g.practicas]);
      var est = [g.estudio, g.escala ? 'escala ' + g.escala : '', g.anio, g.at ? 'consultado el ' + fecha(g.at) : ''].filter(Boolean).join(', ');
      if (est) rows.push(['Estudio del IGAC', est]);
      return rows;
    }

    /* ---------- 2. La capa del mapa ---------- */
    function predioPoints() {
      var pts = [];
      proj().lots.forEach(function (l) { l.points.forEach(function (q) { pts.push(q); }); });
      return pts;
    }
    function online() { return (typeof navigator === 'undefined' || navigator.onLine !== false) && !ui.igacFail; }
    function shapesOf(rec) {
      var out = [];
      rec.cache.features.forEach(function (f) {
        var color = Igac.colorOf(f.a);
        f.p.forEach(function (rs) { out.push({ color: color, rings: rs.map(function (r) { return r.map(function (q) { return [q[1], q[0]]; }); }) }); });
      });
      return out;
    }
    function sync() {
      if (!ui.map || !ui.map.setOverlay) return;
      var p = proj();
      if (!ui.mapIgac) { ui.map.setOverlay(null); return; }
      if (!loaded[p.id]) { load(p.id).then(function () { sync(); syncPanel(); }); }
      var rec = mem[p.id];
      if (online()) {
        ui.map.setOverlay({ key: 'igac-tiles', tileUrl: Igac.tileUrl, opacity: 0.55, attribution: ATTR, onError: function (n) {
          if (n >= 4 && !ui.igacFail) { ui.igacFail = true; sync(); syncPanel(); }
        } });
      } else if (rec) ui.map.setOverlay({ key: 'igac-guardado:' + p.id + ':' + rec.at, shapes: shapesOf(rec), attribution: ATTR });
      else ui.map.setOverlay(null);
    }
    var LEYENDA = [['1', 'Clase 1'], ['2', 'Clase 2'], ['3', 'Clase 3'], ['4', 'Clase 4'], ['5', 'Clase 5'], ['6', 'Clase 6'], ['7', 'Clase 7'], ['8', 'Clase 8'], ['CA', 'Agua'], ['ZU', 'Urbana'], ['otro', 'Otros']];
    function panelHtml() {
      var rec = cached(), h = '';
      if (!ui.mapIgac) return '';
      h += '<p class="small" id="igacVer">' + (online() ? 'Viendo el mapa del IGAC en línea.' : rec ? 'Sin conexión: viendo la zona guardada.' : 'Sin conexión y sin la zona guardada: la capa no se puede ver.') + '</p>';
      if (ui.igacDownloading) h += '<p class="small muted" id="igacGuardado">Descargando la zona del predio…</p>';
      else if (rec) {
        h += '<p class="small muted" id="igacGuardado">Guardada para usar sin conexión: ' + rec.n + (rec.n === 1 ? ' polígono' : ' polígonos') + ', ' + fecha(rec.at) + '.' + (rec.parcial ? ' Incompleta: la zona es muy grande.' : '') + '</p>' +
          '<div class="btns"><button class="chipbtn" data-act="igacDownload">Actualizar</button><button class="chipbtn" data-act="igacBorrar">Borrar lo guardado</button></div>';
      } else h += '<button class="chipbtn" data-act="igacDownload" id="igacDownloadBtn">Guardar la zona del predio para usar sin conexión</button>';
      h += '<div class="igacley" aria-label="Leyenda: clases de capacidad de uso">' + LEYENDA.map(function (x) {
        return '<span><i style="background:' + Igac.COLORS[x[0]] + '"></i>' + x[1] + '</span>';
      }).join('') + '</div><p class="small muted" style="margin:4px 0 0">Fuente: IGAC (CC BY 4.0). Mapa regional: no reemplaza el estudio del predio.</p>';
      return h;
    }
    function syncPanel() { var el = $('#igacPanel'); if (el) el.innerHTML = panelHtml(); }
    function layerHtml() {
      return '<b>Encima</b><button class="chipbtn" data-act="mapIgac" aria-pressed="' + !!ui.mapIgac + '">Capacidad de uso (IGAC)</button><div id="igacPanel">' + panelHtml() + '</div>';
    }
    function toggle() {
      ui.mapIgac = !ui.mapIgac; ui.igacFail = false;
      Store.saveFlag('mapIgac', ui.mapIgac);
      var b = document.querySelector('[data-act="mapIgac"]');
      if (b) b.setAttribute('aria-pressed', String(ui.mapIgac));
      sync(); syncPanel();
    }
    function download() {
      var p = proj(), b = Igac.bboxOf(predioPoints());
      if (!b) { toast('Marca primero los puntos del predio: se guarda la zona alrededor de ellos.', { err: true }); return; }
      if (b.big) { toast('La zona del proyecto es demasiado grande para guardarla (más de unos 27 km de lado).', { err: true }); return; }
      if (ui.igacDownloading) return;
      ui.igacDownloading = true; syncPanel();
      var pid = p.id;
      get(Igac.bboxUrl(b), 60000).then(function (j) {
        var s = Igac.slim(j);
        if (!s) throw new Error('respuesta no válida');
        if (!s.features.length) { ui.igacDownloading = false; syncPanel(); toast('El mapa del IGAC no tiene datos en la zona del predio.', { err: true }); return; }
        var rec = { id: pid, at: Date.now(), bbox: b, n: s.features.length, parcial: s.parcial, cache: s };
        return put(rec).then(function (ok) {
          ui.igacDownloading = false; sync(); syncPanel();
          toast(ok ? 'Guardados ' + rec.n + ' polígonos del mapa del IGAC para usar sin conexión.' : 'Se descargó, pero el teléfono no dejó guardarlo: solo sirve hasta cerrar la app.', ok ? {} : { err: true });
        });
      }).catch(function (e) {
        ui.igacDownloading = false; syncPanel();
        toast('No se pudo descargar el mapa del IGAC (' + (e && e.name === 'AbortError' ? 'no respondió a tiempo' : 'sin conexión') + ').', { err: true });
      });
    }
    function borrar() {
      var p = proj(), rec = mem[p.id];
      if (!rec) return;
      del(p.id).then(function () {
        sync(); syncPanel();
        toast('Zona guardada del IGAC borrada.', { action: 'Deshacer', fn: function () { put(rec).then(function () { sync(); syncPanel(); }); } });
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', function () { ui.igacFail = false; sync(); syncPanel(); });
      window.addEventListener('offline', function () { sync(); syncPanel(); });
    }

    return { consult: consult, quitar: quitar, blockHtml: blockHtml, reportRows: reportRows, sync: sync, layerHtml: layerHtml, toggle: toggle, download: download, borrar: borrar,
      _mem: mem, _load: load };
  };
})();

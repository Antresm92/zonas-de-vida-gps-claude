/* Completar, copiar y limpiar la información de los polígonos (2.25.0), en la pestaña Información.
 * · «Completar con internet»: trae la altitud de los puntos que no la tienen y el clima del polígono elegido, desde su centro.
 * · «Elegir polígonos ▾»: lo mismo para los polígonos que se marquen en una lista (abre sin nada marcado), uno por uno,
 *   mostrando el avance y al final un resumen de cuáles quedaron listos y cuáles no.
 * · «Usar este clima en todos los polígonos»: copia el clima del elegido a los demás sin pisar lo que cada uno tenga escrito a mano.
 * · «Limpiar información ▾»: en los polígonos que se marquen, borra lo que se elija (clima de internet o a mano, altitudes por su origen) y,
 *   si se pide, vuelve a completar con internet. Todo se puede deshacer.
 * Regla de siempre: lo escrito a mano manda; internet solo llena lo que falta. La lógica de qué tiene y qué se borra está en datos.js.
 * Usa lo que app.js le pasa al llamarla: S, ui, MEM, proj, lot, multi, esc, toast, openSheet, closeSheet, renderTab, save y saveMemory. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.completar = function (ctx) {
    var ui = ctx.ui, MEM = ctx.MEM, proj = ctx.proj, lot = ctx.lot, multi = ctx.multi, esc = ctx.esc, toast = ctx.toast,
      openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, renderTab = ctx.renderTab, save = ctx.save, saveMemory = ctx.saveMemory;
    var A = window.Analysis, Climate = window.Climate, Fmt = window.Fmt, Predio = window.Predio, Datos = window.Datos;
    function isNum(x) { return typeof x === 'number' && isFinite(x); }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    /* ---------- Traer de internet lo de un polígono ---------- */
    // Devuelve una promesa con { did: ['altitud de 3 puntos', 'clima de la zona'], notes, errors }. No dibuja ni avisa: eso lo hace quien la llama.
    function fetchLot(l) {
      var a = A.analyze({ points: l.points, climate: {} }, {});
      if (a.empty) return Promise.resolve({ did: [], notes: [], errors: ['no tiene puntos'] });
      var c = l.climate || (l.climate = {}), need = l.points.filter(function (pt) { return !isNum(pt.alt); });
      return Climate.fetchOnline(a.center.lat, a.center.lon, null, { points: need.map(function (pt) { return { lat: pt.lat, lon: pt.lon }; }) })
        .then(function (res) {
          var did = [];
          if (res.pointElevations && need.length) {
            var k = 0;
            need.forEach(function (pt, i) { var e = res.pointElevations[i]; if (isNum(e)) { pt.alt = e; pt.altSrc = 'internet'; k++; } });
            if (k) did.push('altitud de ' + plural(k, 'punto', 'puntos'));
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
          return { did: did, notes: res.notes || [], errors: res.errors || [] };
        });
    }
    // El polígono elegido (el botón de siempre)
    function fetchOnline(after) {
      var l = lot();
      if (!l.points.length || ui.fetching) return;
      if (navigator.onLine === false) { toast('Sin conexión. Tus puntos quedan guardados; completa cuando tengas internet.', { err: true }); return; }
      ui.fetching = true; renderTab('clima');
      fetchLot(l).then(function (r) {
        ui.fetching = false;
        var opt = after ? { action: 'Deshacer', fn: after } : undefined;
        if (r.did.length) toast('Listo: ' + r.did.join(' y ') + '.' + (r.notes.length ? ' ' + r.notes[0] : '') + (r.errors.length ? ' Algo no se pudo traer: ' + r.errors[0] : ''), opt);
        else toast('No se pudo consultar internet. ' + (r.errors[0] || '') + ' Puedes escribir los datos a mano.', Object.assign({ err: true }, opt || {}));
        renderTab(ui.tab);
      }).catch(function (e) { ui.fetching = false; toast('No se pudo consultar internet: ' + (e && e.message || e), { err: true }); renderTab(ui.tab); });
    }

    /* ---------- Varios polígonos: la lista ---------- */
    // Fecha corta para las listas («15 nov 2026»), en negrita para que resalte
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function shortDate(ts) { var d = new Date(ts); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear(); }
    function statusHtml(s) {
      var bits = [];
      if (s.noAlt) bits.push(esc(plural(s.noAlt, 'punto sin altitud', 'puntos sin altitud')));
      if (s.online) bits.push('descargado <b>' + esc(shortDate(s.onlineDate)) + '</b>');
      else if (s.manual) bits.push('clima escrito a mano');
      else bits.push('sin clima');
      return bits.join(' · ');
    }
    // La misma lista para Completar y Limpiar: cada predio con sus lotes debajo y su estado; marcar un predio marca sus lotes
    function polyList(id, rows, p) {
      return '<div id="' + id + '">' + rows.map(function (l) {
        var par = Predio.parentOf(l, p.lots);
        return '<label class="repfin expick' + (par ? ' sub' : '') + '"><input type="checkbox" data-id="' + esc(l.id) + '"' + (Predio.isFinca(l) ? ' data-finca="1"' : '') + (par ? ' data-parent="' + esc(par.id) + '"' : '') + '>' +
          '<span>' + (Predio.isFinca(l) ? '<b>' + esc(l.name) + '</b>' : esc(l.name)) + ' <small class="muted">· ' + statusHtml(Datos.status(l)) + '</small></span></label>';
      }).join('') + '</div>';
    }
    function checkedIds(sel) { return [].filter.call(document.querySelectorAll(sel + ' input'), function (i) { return i.checked; }).map(function (i) { return i.getAttribute('data-id'); }); }
    function openFetchPick() {
      var p = proj(), rows = Predio.ordered(p.lots).filter(function (l) { return l.points.length; });
      if (!rows.length) { toast('Todavía no hay polígonos con puntos.', { err: true }); return; }
      openSheet('Qué polígonos completar', '<p class="small muted" style="margin-top:0">Marca los que quieres completar con internet. Cada uno se consulta desde su centro y solo se llena lo que le falta: lo que escribiste a mano no cambia. Al marcar un predio se marcan también sus lotes.</p>' +
        polyList('fetchList', rows, p) +
        '<div class="btns" style="margin-top:10px"><button class="btn" data-act="fetchPickAll" data-v="1">Marcar todos</button><button class="btn" data-act="fetchPickAll" data-v="0">Ninguno</button></div>' +
        '<div class="btns"><button class="btn btn-primary" data-act="fetchPickGo">Completar los marcados</button></div>');
    }
    function fetchPickAll(t) {
      var v = t.getAttribute('data-v') === '1', box = t.getAttribute('data-list') || 'fetchList';
      [].forEach.call(document.querySelectorAll('#' + box + ' input'), function (i) { i.checked = v; });
      if (box === 'cleanPolys') cleanCounts();
    }
    // Al marcar o desmarcar un predio, lo mismo con sus lotes (después se pueden cambiar uno por uno), como en Exportar
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.matches) return;
      if (t.matches('#fetchList input[data-finca], #cleanPolys input[data-finca]')) {
        var box = t.closest('#fetchList') ? '#fetchList' : '#cleanPolys';
        [].forEach.call(document.querySelectorAll(box + ' input[data-parent="' + t.getAttribute('data-id') + '"]'), function (i) { i.checked = t.checked; });
      }
      if (t.matches('#cleanPolys input')) cleanCounts();
    });
    function fetchPickGo() {
      var p = proj(), ids = checkedIds('#fetchList');
      if (!ids.length) { toast('No marcaste ningún polígono.', { err: true }); return; }
      if (navigator.onLine === false) { toast('Sin conexión. Completa cuando tengas internet.', { err: true }); return; }
      if (ui.fetching) return;
      closeSheet();
      runFetch(Predio.ordered(p.lots).filter(function (l) { return ids.indexOf(l.id) >= 0 && l.points.length; }));
    }
    // Completa los polígonos de la lista uno por uno (así no se satura el servicio) y el avance se ve en el botón.
    // «undo», si viene de «Limpiar y completar», se ofrece en el resumen para devolver todo como estaba.
    function runFetch(list, undo) {
      var out = [];
      ui.fetching = true;
      function step(i) {
        if (i >= list.length) { ui.fetching = false; ui.fetchProg = ''; renderTab(ui.tab); fetchSummary(out, undo); return; }
        var l = list[i];
        if (navigator.onLine === false) { for (var k = i; k < list.length; k++) out.push({ l: list[k], err: 'no se consultó: se perdió la conexión' }); step(list.length); return; }
        ui.fetchProg = 'Completando ' + (i + 1) + ' de ' + list.length + ': ' + l.name;
        renderTab(ui.tab);
        fetchLot(l).then(function (r) {
          out.push(r.did.length ? { l: l, did: r.did, note: r.errors.length ? 'algo no se pudo traer: ' + r.errors[0] : '' } : { l: l, err: r.errors[0] || 'internet no respondió' });
          step(i + 1);
        }).catch(function (e) { out.push({ l: l, err: String(e && e.message || e) }); step(i + 1); });
      }
      step(0);
    }
    var lastUndo = null;
    function fetchSummary(out, undo) {
      var ok = out.filter(function (o) { return !o.err; }).length, bad = out.length - ok;
      lastUndo = undo || null;
      openSheet('Resultado', (undo ? '<p class="small muted" style="margin-top:0">La información que marcaste se borró antes de completar.</p>' : '') +
        '<p class="lead" id="fetchSum">' + (bad ? plural(ok, 'polígono completado', 'polígonos completados') + ' y ' + plural(bad, 'con problema', 'con problemas') + '.' : (ok === 1 ? 'El polígono quedó completado.' : 'Los ' + ok + ' polígonos quedaron completados.')) + '</p>' +
        '<dl class="guide" id="fetchRes">' + out.map(function (o) {
          return '<div><dt>' + (o.err ? '✗ ' : '✓ ') + esc(o.l.name) + '</dt><dd>' + esc(o.err ? o.err + '. Puedes volver a intentarlo.' : o.did.join(' y ') + (o.note ? '; ' + o.note : '') + '.') + '</dd></div>';
        }).join('') + '</dl>' +
        '<div class="btns">' + (bad ? '<button class="btn" data-act="fetchPick">Volver a la lista</button>' : '') + (undo ? '<button class="btn" data-act="cleanUndo">Deshacer la limpieza</button>' : '') + '<button class="btn btn-primary" data-act="closeSheet">Listo</button></div>');
    }

    /* ---------- Copiar el clima a los demás ---------- */
    function climateToAll() {
      var p = proj(), cur = lot(), full = 0, kept = 0, before = p.lots.map(function (l) { return JSON.stringify(l.climate); });
      p.lots.forEach(function (l) {
        if (l === cur) return;
        if (Datos.copyClimate(cur, l) === 'kept') kept++; else full++;
      });
      save(); renderTab(ui.tab);
      toast('Clima copiado a ' + plural(full + kept, 'polígono', 'polígonos') + (kept ? (kept === 1 ? '; 1 conservó sus datos escritos a mano' : '; ' + kept + ' conservaron sus datos escritos a mano') : '') + '. La temperatura de cada uno se ajusta con su altitud.', { action: 'Deshacer', fn: function () {
        p.lots.forEach(function (l, k) { if (before[k] !== undefined) l.climate = JSON.parse(before[k]); }); save(); renderTab(ui.tab);
      } });
    }

    /* ---------- Limpiar la información de un polígono ---------- */
    var CLEAN_ROWS = [
      ['online', 'Clima traído de internet', 'Temperatura, lluvia y meses de NASA POWER u Open-Meteo.'],
      ['manual', 'Clima escrito a mano', 'La temperatura, la lluvia y los 12 meses que escribiste.'],
      ['altOverride', 'Altitud corregida a mano', 'La corrección que pusiste para el análisis.'],
      ['altInternet', 'Altitud de los puntos (internet)', 'La que trajo «Completar con internet».'],
      ['altManual', 'Altitud de los puntos (a mano)', 'La que escribiste en cada punto.'],
      ['altGps', 'Altitud de los puntos (GPS)', 'Es tu medida en campo; internet da un valor aproximado. Si la borras, en la ficha de cada punto queda «Restaurar altitud del GPS».']
    ];
    function hasClean(l) { var n = Datos.counts(l); return Datos.PARTS.some(function (k) { return n[k] > 0; }); }
    function isPts(k) { return k.indexOf('alt') === 0 && k !== 'altOverride'; }
    // «Limpiar información ▾»: arriba, de qué polígonos (sin nada marcado); abajo, qué borrar, con lo que suman los marcados
    function openClean() {
      var p = proj(), rows = Predio.ordered(p.lots).filter(hasClean);
      if (!rows.length) { toast('Ningún polígono tiene información que limpiar.'); return; }
      openSheet('Limpiar información', '<p class="small muted" style="margin-top:0">Los puntos, su ubicación, nombres, fotos y colores no cambian, y después puedes deshacerlo.</p>' +
        '<h3 class="sub">1 · De qué polígonos</h3>' + polyList('cleanPolys', rows, p) +
        '<div class="btns" style="margin-top:10px"><button class="btn" data-act="fetchPickAll" data-list="cleanPolys" data-v="1">Marcar todos</button><button class="btn" data-act="fetchPickAll" data-list="cleanPolys" data-v="0">Ninguno</button></div>' +
        '<h3 class="sub">2 · Qué borrar</h3><p class="small muted" id="cleanHint"></p>' +
        '<div id="cleanList">' + CLEAN_ROWS.map(function (r) {
          return '<label class="repfin expick' + (r[0] === 'altGps' ? ' warnrow' : '') + '" data-row="' + r[0] + '"><input type="checkbox" data-part="' + r[0] + '" disabled>' +
            '<span><b>' + esc(r[1]) + '</b><br><small class="muted">' + esc(r[2]) + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="cleanDo" data-then="fetch">Limpiar y completar con internet</button></div>' +
        '<div class="btns"><button class="btn" data-act="cleanDo">Solo limpiar</button><button class="btn" data-act="closeSheet">Cancelar</button></div>');
      cleanCounts();
    }
    // Suma lo que tienen los polígonos marcados; lo que ninguno tiene queda gris y sin marcar
    function cleanCounts() {
      var p = proj(), ids = checkedIds('#cleanPolys'), tot = {}, polys = {};
      Datos.PARTS.forEach(function (k) { tot[k] = 0; polys[k] = 0; });
      p.lots.forEach(function (l) {
        if (ids.indexOf(l.id) < 0) return;
        var n = Datos.counts(l);
        Datos.PARTS.forEach(function (k) { if (n[k] > 0) { tot[k] += n[k]; polys[k]++; } });
      });
      var hint = document.getElementById('cleanHint');
      if (hint) hint.textContent = ids.length ? 'Lo que suman los ' + (ids.length === 1 ? 'polígono marcado' : ids.length + ' polígonos marcados') + '. Lo que ninguno tiene sale en gris.' : 'Primero marca los polígonos arriba.';
      CLEAN_ROWS.forEach(function (r) {
        var lab = document.querySelector('#cleanList [data-row="' + r[0] + '"]');
        if (!lab) return;
        var k = r[0], inp = lab.querySelector('input'), on = tot[k] > 0, q = '';
        if (on) q = isPts(k) ? ': ' + plural(tot[k], 'punto', 'puntos') + (ids.length > 1 ? ' en ' + plural(polys[k], 'polígono', 'polígonos') : '') : (ids.length > 1 ? ': ' + plural(polys[k], 'polígono', 'polígonos') : '');
        lab.querySelector('b').textContent = r[1] + q;
        inp.disabled = !on;
        if (!on) inp.checked = false;
        lab.classList.toggle('off', !on);
      });
    }
    function cleanDo(t) {
      var p = proj(), ids = checkedIds('#cleanPolys'), what = {}, any = false;
      if (!ids.length) { toast('Primero marca de qué polígonos.', { err: true }); return; }
      [].forEach.call(document.querySelectorAll('#cleanList input'), function (i) { if (i.checked && !i.disabled) { what[i.getAttribute('data-part')] = true; any = true; } });
      if (!any) { toast('No marcaste nada para borrar.', { err: true }); return; }
      var list = Predio.ordered(p.lots).filter(function (l) { return ids.indexOf(l.id) >= 0; });
      // una copia de lo que había en cada polígono, para un solo «Deshacer»
      var snaps = list.map(function (l) { return { l: l, s: JSON.stringify({ c: l.climate, a: l.points.map(function (pt) { return [pt.alt, pt.altSrc, pt.altGps]; }) }) }; });
      var undo = function () {
        snaps.forEach(function (x) {
          var s = JSON.parse(x.s);
          x.l.climate = s.c || {};
          x.l.points.forEach(function (pt, i) {
            var v = s.a[i]; if (!v) return;
            ['alt', 'altSrc', 'altGps'].forEach(function (k, j) { if (v[j] === undefined || v[j] === null) delete pt[k]; else pt[k] = v[j]; });
          });
        });
        save(); renderTab(ui.tab);
      };
      list.forEach(function (l) { Datos.clean(l, what); });
      save(); closeSheet(); renderTab(ui.tab);
      var who = list.length === 1 ? '«' + list[0].name + '»' : plural(list.length, 'polígono', 'polígonos');
      if (t && t.getAttribute('data-then') === 'fetch') {
        if (navigator.onLine === false) { toast('Información borrada de ' + who + '. Ahora no hay conexión: completa con internet cuando la tengas.', { action: 'Deshacer', fn: undo }); return; }
        if (ui.fetching) { toast('Información borrada de ' + who + '. Ya hay una consulta en curso: completa cuando termine.', { action: 'Deshacer', fn: undo }); return; }
        toast('Información borrada de ' + who + '. Completando con internet…', { action: 'Deshacer', fn: undo });
        runFetch(list.filter(function (l) { return l.points.length; }), undo);
        return;
      }
      toast('Información borrada de ' + who + '. Puedes completarla con internet o escribirla a mano.', { action: 'Deshacer', fn: undo });
    }
    function cleanUndo() {
      if (lastUndo) { lastUndo(); lastUndo = null; toast('Listo: todo quedó como estaba antes de limpiar.'); }
      closeSheet();
    }

    // El bloque «Completar con internet» de la pestaña Información
    function block(a) {
      var p = proj(), c = p.climate, h = '<div class="block" id="fetchBlock"><h2>Completar con internet</h2>';
      h += '<p class="lead">Trae la altitud de cada punto sin altitud y el clima de la zona, mes por mes (NASA POWER y, si no responde, Open-Meteo). Lo que escribes a mano siempre manda: internet solo llena lo que falta. Lo que traes queda guardado en el equipo para usarlo sin conexión.</p>';
      if (ui.staleOnline) h += '<div class="tip">Los datos de internet guardados son de otro lugar; vuelve a completarlos.</div>';
      if (c.online && !ui.staleOnline) h += '<p class="small muted">Última descarga: ' + esc(Fmt.date(c.online.date)) + (c.online.source ? ' · ' + esc(c.online.source) : '') + '.</p>';
      var offline = navigator.onLine === false;
      h += '<button class="btn btn-primary btn-block" data-act="fetchOnline"' + (ui.fetching ? ' disabled' : '') + '>' + (ui.fetching ? esc(ui.fetchProg || 'Consultando…') : 'Completar con internet') + '</button>';
      if (multi()) h += '<button class="btn btn-block" style="margin-top:10px" data-act="fetchPick"' + (ui.fetching ? ' disabled' : '') + ' aria-haspopup="true">Elegir polígonos ▾</button>';
      if (offline) h += '<p class="small muted">Ahora no hay conexión. Tus puntos quedan guardados; completa cuando tengas internet.</p>';
      if (multi()) h += '<button class="btn btn-block" style="margin-top:10px" data-act="climateToAll">Usar este clima en todos los polígonos</button><p class="small muted">Cada polígono guarda su propio clima, tomado desde su centro. Al copiarlo, los que tienen datos escritos a mano los conservan. La lluvia de internet viene en cuadros de unos 50 km, así que en un mismo predio suele ser igual; la temperatura cambia con la altitud de cada polígono.</p>';
      if (proj().lots.some(hasClean)) h += '<button class="btn btn-block" style="margin-top:10px" data-act="cleanAsk" id="cleanBtn" aria-haspopup="true">Limpiar información ▾</button>';
      return h + '</div>';
    }

    return { block: block, fetchOnline: function () { fetchOnline(); }, openFetchPick: openFetchPick, fetchPickAll: fetchPickAll, fetchPickGo: fetchPickGo,
      climateToAll: climateToAll, openClean: openClean, cleanDo: cleanDo, cleanUndo: cleanUndo };
  };
})();

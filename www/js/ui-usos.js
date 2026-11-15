/* «Usos recomendados» 🌱 en la pestaña Información (2.29.0).
 * Muestra la clase de capacidad de uso del polígono elegido según el IGAC, qué la limita y los usos de esa clase, con lo
 * que la app calcula (pendiente, piso térmico, humedad) y lo que la persona evalúa en campo y en laboratorio (hoja
 * «Evaluar el terreno», con «No sé» en todo). Cada dato lleva su número de fuente, que abre la cita con su enlace.
 * Desde 2.30.0 también «Cultivos a evaluar ▾» (cultivos.js, con los requerimientos de ECOCROP de la FAO) y el modelo de la
 * sección final del reporte «Conclusión y recomendaciones».
 * La lógica está en usos.js, capacidad.js y cultivos.js; aquí solo se dibuja y se guarda lot.terreno.
 * Usa lo que app.js le pasa al llamarla: ui, lot, analysis, lotArea, esc, toast, openSheet, closeSheet, save y renderTab. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.usos = function (ctx) {
    var ui = ctx.ui, lot = ctx.lot, analysis = ctx.analysis, esc = ctx.esc, toast = ctx.toast,
      openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, save = ctx.save, renderTab = ctx.renderTab, lotArea = ctx.lotArea;
    var Usos = window.Usos, Capacidad = window.Capacidad, Cultivos = window.Cultivos, Fmt = window.Fmt;

    function monthlyOf(a) { var cl = a && a.climate; return cl && cl.chartT && cl.chartP ? { T: cl.chartT, P: cl.chartP } : null; }
    function modelFor(l, a) { return Usos.model(l.points, a, l.terreno, monthlyOf(a)); }
    // Cultivos a evaluar del polígono, con el clima del análisis y la clase del IGAC
    function cultivosOf(l, a, m) {
      m = m || modelFor(l, a);
      var cl = a && a.climate;
      return Cultivos.evaluar({ T: cl ? cl.T : null, P: cl ? cl.P : null, clase: m.eval.clase, terreno: m.terreno });
    }
    // Meses secos según Walter-Lieth (lluvia menor que el doble de la temperatura), si hay serie mes por mes
    function secosOf(a) {
      var mo = monthlyOf(a); if (!mo) return null;
      var n = 0; for (var i = 0; i < 12; i++) if (mo.P[i] < 2 * mo.T[i]) n++;
      return n;
    }
    function ref(n) { return '<button type="button" class="srcref" data-act="usosFuente" aria-label="Ver la fuente ' + n + '">[' + n + ']</button>'; }

    // El bloque de Información
    function block(a) {
      var l = lot(), m = modelFor(l, a), e = m.eval, au = m.auto, h = '<div class="block" id="usosBlock"><h2><span aria-hidden="true">🌱</span> Usos recomendados</h2>';
      if (e.clase !== null) {
        h += '<div class="usoclase"><span class="big">Clase ' + e.clase + '</span> <span class="usosub">subclase ' + esc(e.subclase) + '</span></div>';
        h += '<p class="lead" id="usosTxt">' + esc(e.usos.txt) + ' ' + ref(1) + '</p>';
        if (e.limita.length) h += '<p class="small" id="usosLimita"><b>La limita:</b> ' + esc(e.limita.map(function (x) { return x.name + ' (' + Usos.catName(x.key, x.cat) + ')'; }).join('; ')) + '.</p>';
        if (e.posibleClase5) h += '<div class="tip">Terreno casi plano donde limita el exceso de agua: podría ser <b>clase 5</b>. Revísalo en campo.</div>';
      } else {
        h += '<p class="muted">Todavía no hay datos para la clase: hacen falta la pendiente (3 puntos con altitud), la temperatura o la evaluación del terreno.</p>';
      }
      h += '<p class="small" id="usosCuenta"><b>Evaluación: ' + e.conocidas + ' de ' + e.total + ' datos.</b>' + (e.conocidas && e.provisional ? ' Provisional: lo que falta puede bajar la clase.' : '') + '</p>';
      h += '<dl class="guide" id="usosAuto">' +
        '<div><dt>Pendiente</dt><dd>' + (au.pendiente ? esc(Fmt.num(au.pendiente.pct, au.pendiente.pct < 10 ? 1 : 0) + ' % (' + Usos.catName('pendiente', au.pendiente.cat) + '), de ' + au.pendiente.n + ' puntos con altitud') : 'falta: se necesitan 3 puntos con altitud que no estén en línea') + '</dd></div>' +
        '<div><dt>Piso térmico</dt><dd>' + (au.piso ? esc(Usos.catName('piso', au.piso.cat) + ' (' + Fmt.num(au.piso.T, 1) + ' °C)') : 'falta la temperatura') + '</dd></div>' +
        '<div><dt>Humedad del clima</dt><dd>' + (au.humedad ? esc(Usos.catName('humedad', au.humedad.cat) + ' (ETP/P ' + Fmt.num(au.humedad.ratio, 2) + ')') : 'falta la precipitación') + '</dd></div></dl>';
      var nT = Object.keys(m.terreno).filter(function (k) { return k !== 'lluviasEst'; }).length;
      h += '<button class="btn btn-block" data-act="usosEdit" id="usosEditBtn" style="margin-top:8px">' + (nT ? 'Evaluación del terreno (' + nT + ' respuestas) ▾' : 'Evaluar el terreno ▾') + '</button>';
      var cu = cultivosOf(l, a, m);
      if (cu) h += '<button class="btn btn-block" data-act="cultivosOpen" id="cultivosBtn" style="margin-top:10px" aria-haspopup="true">Cultivos a evaluar (' + cu.grupos.optimo.length + ' óptimos, ' + cu.grupos.posible.length + ' posibles) ▾</button>';
      h += '<p class="small muted" style="margin-top:10px">' + esc(Usos.NOTE) + ' ' + ref(1) + '</p>';
      return h + '</div>';
    }

    // La hoja para evaluar: campo y laboratorio, con «No sé»
    function field(v, cur) {
      return '<label class="f"><span>' + esc(v.name) + '</span><select data-var="' + v.key + '"><option value="">No sé</option>' +
        v.cats.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (cur === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>';
    }
    function openEdit() {
      var l = lot(), a = analysis(), m = modelFor(l, a), t = m.terreno, est = m.lluviasEst;
      var group = function (g) { return Capacidad.VARS.filter(function (v) { return v.group === g && v.key !== 'lluvias'; }).map(function (v) { return field(v, t[v.key]); }).join(''); };
      var lluv = Capacidad.VARS.filter(function (v) { return v.key === 'lluvias'; })[0];
      var h = '<p class="small muted" style="margin-top:0">De «' + esc(l.name) + '». Elige lo que observas; si no lo sabes, deja «No sé». Las opciones son las del instructivo del IGAC ' + ref(1) + '.</p>';
      h += '<h3 class="sub">Lo que ves en campo</h3>' + group('campo');
      h += '<label class="f"><span>' + esc(lluv.name) + '</span><select data-var="lluvias" id="usosLluvias"><option value="">No sé</option>' +
        lluv.cats.map(function (c) { return '<option value="' + c[0] + '"' + (t.lluvias === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>';
      if (est) {
        h += '<div class="tip" id="usosEst"><b>Estimación de la app</b> ' + ref(2) + ': ' + esc(est.text) + '. ' +
          (est.cat ? 'Corresponde a «' + esc(Usos.catName('lluvias', est.cat)) + '».' : 'Puede ser «' + esc(Usos.catName('lluvias', est.options[0])) + '» o «' + esc(Usos.catName('lluvias', est.options[1])) + '». ' + esc(est.ask)) +
          ' Lo que tú observes en campo manda.' +
          '<div class="btns" style="margin-top:8px">' + est.options.map(function (o) { return '<button class="btn" data-act="usosEstUse" data-v="' + o + '">Usar ' + (est.options.length > 1 ? 'opción ' + o : 'la estimación') + '</button>'; }).join('') + '</div></div>';
      }
      h += '<h3 class="sub">Del laboratorio</h3><p class="small muted">Cópialos del análisis de suelos, si lo tienes.</p>' + group('lab');
      h += '<details class="help"><summary>Lo calcula la app</summary><p class="small">La pendiente, el piso térmico y la humedad del clima salen de tus puntos y del clima. Si en campo ves algo distinto, puedes corregirlos aquí:</p>' + group('app') + '</details>';
      h += '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="usosSave">Guardar</button><button class="btn" data-act="closeSheet">Cancelar</button></div>';
      if (Object.keys(t).length) h += '<div class="btns"><button class="btn btn-danger" data-act="usosClear">Borrar las respuestas</button></div>';
      ui.usosEstPick = false;
      openSheet('Evaluar el terreno', h);
    }
    // «Usar la estimación»: la marca en la lista (se guarda con «Guardar» y queda anotada como estimada)
    function estUse(t) {
      var s = document.getElementById('usosLluvias');
      if (!s) return;
      s.value = t.getAttribute('data-v'); ui.usosEstPick = s.value;
      toast('Marcada la opción ' + s.value + ' de la estimación. Revísala y toca «Guardar».');
    }
    function saveEdit() {
      var l = lot(), a = analysis(), auto = Usos.auto(l.points, a), out = {};
      [].forEach.call(document.querySelectorAll('#sheet select[data-var]'), function (s) {
        var k = s.getAttribute('data-var');
        if (!s.value) return;
        if ((k === 'pendiente' || k === 'piso' || k === 'humedad') && auto[k] && auto[k].cat === s.value) return;   // igual a lo calculado: no se guarda
        out[k] = s.value;
      });
      if (out.lluvias && ui.usosEstPick === out.lluvias) out.lluviasEst = true;
      var before = l.terreno ? JSON.stringify(l.terreno) : null, c = Usos.clean(out);
      if (c) l.terreno = c; else delete l.terreno;
      save(); closeSheet(); renderTab(ui.tab);
      toast('Evaluación guardada.', { action: 'Deshacer', fn: function () { if (before) l.terreno = JSON.parse(before); else delete l.terreno; save(); renderTab(ui.tab); } });
    }
    function clearEdit() {
      var l = lot(), before = l.terreno ? JSON.stringify(l.terreno) : null;
      delete l.terreno; save(); closeSheet(); renderTab(ui.tab);
      toast('Respuestas borradas.', { action: 'Deshacer', fn: function () { if (before) { l.terreno = JSON.parse(before); save(); renderTab(ui.tab); } } });
    }
    // Las fuentes: [1] IGAC (con su enlace) y [2] el criterio de mes seco de Walter-Lieth (estimación de las lluvias)
    function openFuente() {
      var F = Capacidad.FUENTE;
      openSheet('Fuentes de «Usos recomendados»', '<dl class="guide" id="usosFuentes">' +
        '<div><dt>[1] IGAC</dt><dd>' + esc(F.cita) + ' Clases 1 a 8: Tablas 1–8 (pp. 3–14); el limitante más severo decide la clase (pp. 33–34). <a href="' + F.url + '" target="_blank" rel="noopener noreferrer" data-ext="1">Abrir el instructivo (PDF)</a></dd></div>' +
        '<div><dt>[2] Estimación de las lluvias</dt><dd>Regla de la app, no del IGAC: un mes es seco cuando la lluvia (mm) es menor que el doble de la temperatura (°C), criterio del climodiagrama de H. Walter y H. Lieth; un semestre con al menos un mes seco tiene «deficiencias». El exceso de agua no se estima. Lo que observes en campo manda.</dd></div>' +
        '<div><dt>[3] Cultivos a evaluar</dt><dd>' + esc(Cultivos.FUENTES[3]) + ' Rangos de temperatura y lluvia de ' + Cultivos.total + ' cultivos sembrados en Colombia, copiados sin cambios; el nombre en Colombia y el tipo los puso la app. La correspondencia entre la clase del IGAC y el tipo de cultivo es una lectura de la app de la frase de usos de cada clase. <a href="https://www.fao.org/geospatial/data-and-tools/data-portals/ecocrop/en" target="_blank" rel="noopener noreferrer" data-ext="1">ECOCROP (FAO)</a> · <a href="https://github.com/cropmodels/Recocrop" target="_blank" rel="noopener noreferrer" data-ext="1">Recocrop</a></dd></div>' +
        '</dl><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
    }
    // La hoja «Cultivos a evaluar»: grupos plegables, cada cultivo con su tipo, su aptitud por clima y qué lo limita
    var GRUPOS = [['optimo', 'Óptimos', 'Clima dentro de su rango óptimo y la clase de tierra los admite.'],
      ['posible', 'Posibles con limitaciones', 'Se pueden evaluar, cuidando lo que los limita.'],
      ['marginal', 'Marginales', 'El clima está cerca del límite del cultivo.'],
      ['no', 'No recomendados', 'Fuera del rango de clima del cultivo o excluidos por la clase de tierra.']];
    function openCultivos() {
      var l = lot(), a = analysis(), cu = cultivosOf(l, a);
      if (!cu) { toast('Faltan la temperatura y la lluvia para evaluar cultivos.', { err: true }); return; }
      var h = '<p class="small muted" style="margin-top:0">De «' + esc(l.name) + '», con ' + esc(Fmt.num(a.climate.T, 1)) + ' °C y ' + esc(Fmt.num(a.climate.P, 0)) + ' mm al año' +
        (cu.conClase ? ' y la clase de tierra del IGAC ' + ref(1) : ' (sin clase de tierra: falta evaluarla)') + '. Requerimientos de ' + cu.total + ' cultivos ' + ref(3) + '.</p>';
      GRUPOS.forEach(function (g, i) {
        var list = cu.grupos[g[0]];
        h += '<details class="help cultgrp" data-grupo="' + g[0] + '"' + (i === 0 ? ' open' : '') + '><summary>' + g[1] + ' (' + list.length + ')</summary><p class="small muted">' + g[2] + '</p>' +
          (list.length ? '<ul class="cultlist">' + list.map(function (c) {
            return '<li><b>' + esc(c.es) + '</b> <small class="muted">· ' + esc(c.tipoTxt) + ' · clima ' + Math.round(c.clima * 100) + ' %</small>' +
              (c.lim.length ? '<br><small>' + esc(c.lim.join('; ')) + '</small>' : '') + '</li>';
          }).join('') + '</ul>' : '<p class="small">Ninguno.</p>') + '</details>';
      });
      h += '<p class="small muted">' + esc(Cultivos.NOTA) + '</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>';
      openSheet('Cultivos a evaluar', h);
    }
    // Para el reporte: «Conclusión y recomendaciones» del polígono elegido
    function conclusionModel(a) {
      var l = lot(), m = modelFor(l, a), e = m.eval, cu = cultivosOf(l, a, m), r = a && a.result, cl = a && a.climate;
      var lab = Capacidad.VARS.some(function (v) { return v.group === 'lab' && m.terreno[v.key]; });
      var k = Cultivos.conclusion({ nombre: l.name, ha: lotArea(l) ? lotArea(l) / 10000 : null, zona: r && r.ok ? r.zone.name + ' (' + r.zone.symbol + ')' : null, T: cl ? cl.T : null, P: cl ? cl.P : null,
        secos: secosOf(a), clase: e.clase, subclase: e.subclase, limita: e.limita.map(function (x) { return x.name; }), provisional: e.provisional, faltan: e.total - e.conocidas,
        pendiente: m.auto.pendiente ? m.auto.pendiente.pct : null, humedad: m.datos.humedad, lab: lab, cultivos: cu });
      if (!k) return null;
      return { parrafo: k.parrafo, recomendaciones: k.recomendaciones.map(function (x) { return x.t + (x.f ? ' [' + x.f + ']' : ''); }),
        optimos: cu ? cu.grupos.optimo.map(function (c) { return c.es; }) : [],
        posibles: cu ? cu.grupos.posible.slice(0, 12).map(function (c) { return [c.es, c.lim.join('; ')]; }) : [],
        masPosibles: cu ? Math.max(0, cu.grupos.posible.length - 12) : 0,
        nota: Cultivos.NOTA, fuentes: [1, 2, 3].map(function (n) { return '[' + n + '] ' + Cultivos.FUENTES[n]; }) };
    }
    // Para el reporte: filas y nota del polígono elegido
    function reportModel(a) {
      var m = modelFor(lot(), a), rows = Usos.reportRows(m);
      return rows.length ? { rows: rows, note: Usos.NOTE, fuente: m.fuente.cita + ' ' + m.fuente.url } : null;
    }

    return { block: block, openEdit: openEdit, estUse: estUse, saveEdit: saveEdit, clearEdit: clearEdit, openFuente: openFuente, reportModel: reportModel,
      openCultivos: openCultivos, conclusionModel: conclusionModel };
  };
})();

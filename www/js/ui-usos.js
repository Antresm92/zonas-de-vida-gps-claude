/* «Usos recomendados» 🌱 en la pestaña Información (2.29.0).
 * Muestra la clase de capacidad de uso del polígono elegido según el IGAC, qué la limita y los usos de esa clase, con lo
 * que la app calcula (pendiente, piso térmico, humedad) y lo que la persona evalúa en campo y en laboratorio (hoja
 * «Evaluar el terreno», con «No sé» en todo). Cada dato lleva su número de fuente, que abre la cita con su enlace.
 * La lógica está en usos.js y capacidad.js; aquí solo se dibuja y se guarda lot.terreno.
 * Usa lo que app.js le pasa al llamarla: ui, lot, analysis, esc, toast, openSheet, closeSheet, save y renderTab. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.usos = function (ctx) {
    var ui = ctx.ui, lot = ctx.lot, analysis = ctx.analysis, esc = ctx.esc, toast = ctx.toast,
      openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, save = ctx.save, renderTab = ctx.renderTab;
    var Usos = window.Usos, Capacidad = window.Capacidad, Fmt = window.Fmt;

    function monthlyOf(a) { var cl = a && a.climate; return cl && cl.chartT && cl.chartP ? { T: cl.chartT, P: cl.chartP } : null; }
    function modelFor(l, a) { return Usos.model(l.points, a, l.terreno, monthlyOf(a)); }
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
        '</dl><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
    }
    // Para el reporte: filas y nota del polígono elegido
    function reportModel(a) {
      var m = modelFor(lot(), a), rows = Usos.reportRows(m);
      return rows.length ? { rows: rows, note: Usos.NOTE, fuente: m.fuente.cita + ' ' + m.fuente.url } : null;
    }

    return { block: block, openEdit: openEdit, estUse: estUse, saveEdit: saveEdit, clearEdit: clearEdit, openFuente: openFuente, reportModel: reportModel };
  };
})();

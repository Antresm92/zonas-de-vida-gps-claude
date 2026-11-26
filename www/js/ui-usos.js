/* «Usos recomendados» 🌱 en la pestaña Información (2.29.0).
 * Muestra la clase de capacidad de uso del polígono elegido según el IGAC, qué la limita y los usos de esa clase, con lo
 * que la app calcula (pendiente, piso térmico, humedad) y lo que la persona evalúa en campo y en laboratorio (hoja
 * «Evaluar el terreno», con «No sé» en todo). Cada dato lleva su número de fuente, que abre la cita con su enlace.
 * Desde 2.31.0, «Según el mapa del IGAC» (ui-igac.js) dentro del bloque y en el reporte.
 * Desde 2.30.0 también «Cultivos a evaluar ▾» (cultivos.js, con los requerimientos de ECOCROP de la FAO) y el modelo de la
 * sección final del reporte «Conclusión y recomendaciones».
 * La lógica está en usos.js, capacidad.js y cultivos.js; aquí solo se dibuja y se guarda lot.terreno.
 * Usa lo que app.js le pasa al llamarla: ui, lot, analysis, lotArea, esc, toast, openSheet, closeSheet, save y renderTab. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.usos = function (ctx) {
    var ui = ctx.ui, lot = ctx.lot, analysis = ctx.analysis, esc = ctx.esc, toast = ctx.toast,
      openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, save = ctx.save, renderTab = ctx.renderTab, lotArea = ctx.lotArea,
      igacBlock = ctx.igacBlock, igacRows = ctx.igacRows;
    var Usos = window.Usos, Capacidad = window.Capacidad, Cultivos = window.Cultivos, Fmt = window.Fmt, Perfil = window.Perfil, Store = window.Store;
    // 2.35.0: el margen de la pendiente que eligió la persona en Preferencias: 1 desviación (68 %) o 2 (95 %, viene así)
    function slopeLevel() { return Store && Store.loadFlag('pendiente68') === true ? 1 : 2; }

    function monthlyOf(a) { var cl = a && a.climate; return cl && cl.chartT && cl.chartP ? { T: cl.chartT, P: cl.chartP } : null; }
    function modelFor(l, a) { return Usos.model(l.points, a, l.terreno, monthlyOf(a), { level: slopeLevel() }); }
    // La fila «Pendiente» (2.35.0): medida en campo, o calculada con su margen, incierta o sin margen; y si hace falta medirla
    function slopeDd(m) {
      var au = m.auto, p = au.pendiente, md = m.medida, txt;
      if (md) txt = 'medida en campo: ' + (md.pct !== null ? Fmt.num(md.pct, md.pct % 1 ? 1 : 0) + ' % (' + Usos.catName('pendiente', md.cat) + ')' : Usos.catName('pendiente', md.cat)) + (p ? ' · calculada: ' + Perfil.slopeText(p.sl) : '');
      else if (p) txt = Perfil.slopeShort(p.sl) + ' (' + (p.uncertain ? 'incierta: ' + Perfil.rangesText(p.sl.classes) : Usos.catName('pendiente', p.cat)) + '), de ' + p.n +
        ' puntos con altitudes ' + Perfil.SRC_PHRASE[p.sl.src] + (p.sl.marginKnown ? ', margen al ' + Perfil.levelText(p.sl) : ', margen desconocido') +
        (p.sl.excluded.length ? ' · no se usaron ' + p.sl.excluded.map(function (e) { return e.name; }).join(', ') : '');
      else if (au.pendienteNo) txt = 'no se calcula: ' + au.pendienteNo;
      else txt = 'falta: se necesitan 3 puntos con altitud que no estén en línea';
      return esc(txt);
    }
    function needsMeasure(m) { var p = m.auto.pendiente; return !m.medida && (!p || p.uncertain || !p.sl.marginKnown); }
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
      h += '<p class="small" id="usosCuenta"><b>Evaluación: ' + e.conocidas + ' de ' + e.total + ' datos.</b>' + (e.conocidas && e.provisional ? ' Provisional: lo que falta puede bajar la clase.' : '') +
        (m.conPendiente && m.conPendiente.length ? ' Con la pendiente, que es incierta, sería ' + esc(Usos.clasesText(m.conPendiente)) + '.' : '') + '</p>';
      h += '<dl class="guide" id="usosAuto">' +
        '<div><dt>Pendiente</dt><dd id="usosPend">' + slopeDd(m) + '</dd></div>' +
        '<div><dt>Piso térmico</dt><dd>' + (au.piso ? esc(Usos.catName('piso', au.piso.cat) + ' (' + Fmt.num(au.piso.T, 1) + ' °C)') : 'falta la temperatura') + '</dd></div>' +
        '<div><dt>Humedad del clima</dt><dd>' + (au.humedad ? esc(Usos.catName('humedad', au.humedad.cat) + ' (ETP/P ' + Fmt.num(au.humedad.ratio, 2) + ')') : 'falta la precipitación') + '</dd></div></dl>';
      if (needsMeasure(m)) h += '<button class="btn btn-block" data-act="usosSlopePick" id="usosSlopeBtn" style="margin-top:8px">Elegir la pendiente medida</button>';
      var nT = Object.keys(m.terreno).filter(function (k) { return k !== 'lluviasEst' && k !== 'pendientePct'; }).length;
      h += '<button class="btn btn-block" data-act="usosEdit" id="usosEditBtn" style="margin-top:8px">' + (nT ? 'Evaluación del terreno (' + nT + (nT === 1 ? ' respuesta' : ' respuestas') + ') ▾' : 'Evaluar el terreno ▾') + '</button>';
      h += igacBlock(l, e.clase, ref);                      // «Según el mapa del IGAC» (2.31.0)
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
    // focus === true: se abre desde «Elegir la pendiente medida», con «Lo calcula la app» desplegado y un aviso (2.35.0)
    function openEdit(focus) {
      focus = focus === true;
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
      var pa = m.auto.pendiente, why = !pa ? 'La app no pudo calcular la pendiente.' : pa.uncertain ? 'La pendiente calculada no alcanza para decidir la clase.' : !pa.sl.marginKnown ? 'La pendiente calculada no tiene un margen conocido.' : '';
      var appFields = Capacidad.VARS.filter(function (v) { return v.group === 'app'; }).map(function (v) {
        return field(v, t[v.key]) + (v.key !== 'pendiente' ? '' : '<label class="f"><span>Pendiente medida, en % (opcional)</span><input type="text" inputmode="decimal" id="usosSlopePct" maxlength="6" value="' +
          esc(t.pendientePct ? String(t.pendientePct).replace('.', ',') : '') + '" placeholder="Ej.: 16"></label><p class="small muted" style="margin-top:-4px">Si escribes el número, manda sobre el rango de arriba.</p>');
      }).join('');
      h += '<details class="help" id="usosAppDet"' + (focus ? ' open' : '') + '><summary>Lo calcula la app</summary>' +
        (focus ? '<div class="tip" id="usosSlopeTip">' + (why ? why + ' ' : '') + 'Si mediste la pendiente en campo, con un clinómetro o un nivel, elige su rango o escribe el valor: manda sobre la calculada.</div>' : '') +
        '<p class="small">La pendiente, el piso térmico y la humedad del clima salen de tus puntos y del clima. Si en campo ves algo distinto, puedes corregirlos aquí:</p>' + appFields + '</details>';
      h += '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="usosSave">Guardar</button><button class="btn" data-act="closeSheet">Cancelar</button></div>';
      if (Object.keys(t).length) h += '<div class="btns"><button class="btn btn-danger" data-act="usosClear">Borrar las respuestas</button></div>';
      ui.usosEstPick = false;
      openSheet('Evaluar el terreno', h);
      var det = focus && document.getElementById('usosAppDet');
      if (det && det.scrollIntoView) det.scrollIntoView({ block: 'start' });
    }
    function openSlopePick() { openEdit(true); }
    // «Usar la estimación»: la marca en la lista (se guarda con «Guardar» y queda anotada como estimada)
    function estUse(t) {
      var s = document.getElementById('usosLluvias');
      if (!s) return;
      s.value = t.getAttribute('data-v'); ui.usosEstPick = s.value;
      toast('Marcada la opción ' + s.value + ' de la estimación. Revísala y toca «Guardar».');
    }
    function saveEdit() {
      var l = lot(), a = analysis(), auto = Usos.auto(l.points, a, { level: slopeLevel() }), out = {};
      [].forEach.call(document.querySelectorAll('#sheet select[data-var]'), function (s) {
        var k = s.getAttribute('data-var');
        if (!s.value) return;
        if ((k === 'piso' || k === 'humedad') && auto[k] && auto[k].cat === s.value) return;   // igual a lo calculado: no se guarda
        // 2.35.0: la pendiente elegida sí se guarda aunque coincida con la calculada: es una medida de campo y el reporte lo dice
        out[k] = s.value;
      });
      // 2.35.0: la pendiente medida como número manda sobre el rango y pone el rango que le corresponde
      var pin = document.getElementById('usosSlopePct'), ptxt = pin ? pin.value.trim() : '';
      if (ptxt) {
        var stored = Usos.pctToStore(ptxt);
        if (stored === null) { toast('La pendiente medida debe ser un número entre 0 y 300 %.', { err: true }); return; }
        out.pendientePct = stored; out.pendiente = Capacidad.pendienteCat(parseFloat(stored));
      }
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
        '<div><dt>[4] Mapa del IGAC</dt><dd>' + esc(window.Igac.FUENTE.cita) + ' Es un mapa regional: cada polígono dice de qué estudio, escala y año sale; lo que se evalúa en el predio es más detallado. <a href="' + window.Igac.FUENTE.portal + '" target="_blank" rel="noopener noreferrer" data-ext="1">Datos abiertos del IGAC</a> · <a href="' + window.Igac.FUENTE.licencia + '" target="_blank" rel="noopener noreferrer" data-ext="1">Resolución 616 de 2020</a></dd></div>' +
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
        pendiente: Usos.slopePct(m), pendienteRango: m.medida && m.medida.pct === null ? { cat: m.medida.cat, txt: Usos.catName('pendiente', m.medida.cat) } : null,
        pendienteIncierta: m.conPendiente && m.conPendiente.some(function (k) { return k !== e.clase; }) ? Usos.clasesText(m.conPendiente) : null,
        humedad: m.datos.humedad, lab: lab, cultivos: cu });
      if (!k) return null;
      return { parrafo: k.parrafo, recomendaciones: k.recomendaciones.map(function (x) { return x.t + (x.f ? ' [' + x.f + ']' : ''); }),
        optimos: cu ? cu.grupos.optimo.map(function (c) { return c.es; }) : [],
        posibles: cu ? cu.grupos.posible.slice(0, 12).map(function (c) { return [c.es, c.lim.join('; ')]; }) : [],
        masPosibles: cu ? Math.max(0, cu.grupos.posible.length - 12) : 0,
        nota: Cultivos.NOTA, fuentes: [1, 2, 3].map(function (n) { return '[' + n + '] ' + Cultivos.FUENTES[n]; }) };
    }
    // Para el reporte: filas y nota del polígono elegido
    function reportModel(a) {
      var l = lot(), m = modelFor(l, a), ig = igacRows(l), rows = Usos.reportRows(m).concat(ig);
      var fuente = m.fuente.cita + ' ' + m.fuente.url + (ig.length ? ' Mapa: ' + window.Igac.FUENTE.cita + ' ' + window.Igac.FUENTE.url : '');
      return rows.length ? { rows: rows, note: Usos.NOTE, fuente: fuente } : null;
    }

    return { block: block, openEdit: openEdit, openSlopePick: openSlopePick, estUse: estUse, saveEdit: saveEdit, clearEdit: clearEdit, openFuente: openFuente, reportModel: reportModel,
      openCultivos: openCultivos, conclusionModel: conclusionModel };
  };
})();

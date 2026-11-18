/* El número predial (2.32.0), en la pestaña Polígono (vista Croquis), bloque «Catastro».
 *  - El lindero catastral entra con el archivo que se descarga en Colombia en Mapas: se importa como cualquier archivo y la
 *    app lee su número predial (gis.js + catastro.js) y lo guarda en el polígono. La hoja explica el paso a paso.
 *  - El número también se puede escribir a mano.
 * La app no consulta el catastro por su cuenta. La lógica está en catastro.js. Usa lo que app.js le pasa: ui, lot, esc,
 * toast, openSheet, closeSheet, save, renderTab, $. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.catastro = function (ctx) {
    var ui = ctx.ui, lot = ctx.lot, esc = ctx.esc, toast = ctx.toast, openSheet = ctx.openSheet, closeSheet = ctx.closeSheet, save = ctx.save,
      renderTab = ctx.renderTab, $ = ctx['$'];
    var Catastro = window.Catastro;
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function fecha(t) { var d = new Date(t); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear(); }
    var FUENTE_TXT = { archivo: 'del archivo de Colombia en Mapas', manual: 'escrito a mano' };

    /* ---------- El bloque «Catastro» del Croquis ---------- */
    function blockHtml() {
      var l = lot(), g = l.predial, h = '<div class="block" id="catBlock"><h2>Catastro</h2>';
      if (g) {
        h += '<dl class="kv" id="catDatos"><div><dt>Número predial</dt><dd>' + esc(Catastro.legible(g.numero)) + '</dd></div>' +
          (g.anterior ? '<div><dt>Número predial anterior</dt><dd>' + esc(g.anterior) + '</dd></div>' : '') +
          (g.municipio ? '<div><dt>Municipio</dt><dd>' + esc(g.municipio) + '</dd></div>' : '') + '</dl>';
        h += '<p class="small muted" id="catFuente">Dato ' + esc(FUENTE_TXT[g.fuente] || 'guardado') + (g.at ? ' el ' + fecha(g.at) : '') + '. ' + esc(Catastro.AVISO) + '</p>';
        h += '<div class="btns"><button class="btn" data-act="catOpen" id="catBtn">Cambiar el número predial</button><button class="btn" data-act="catQuitar">Quitar el número</button></div>';
      } else {
        h += '<p class="small muted" id="catVacio">El número predial y el lindero del catastro del IGAC: se traen con el archivo que se descarga en Colombia en Mapas, o el número se escribe a mano.</p>' +
          '<button class="btn btn-block" data-act="catOpen" id="catBtn">Número predial y lindero catastral</button>';
      }
      return h + '</div>';
    }
    function quitar() {
      var l = lot(), before = l.predial;
      if (!before) return;
      delete l.predial; save(); renderTab(ui.tab);
      toast('Número predial quitado de «' + l.name + '».', { action: 'Deshacer', fn: function () { l.predial = before; save(); renderTab(ui.tab); } });
    }

    /* ---------- La hoja «Número predial y lindero» ---------- */
    function sheetBody() {
      var g = lot().predial, h = '';
      h += '<h3 class="sub">Traer el lindero catastral</h3><ol class="small" id="catPasosA">' +
        '<li>Abre <a href="' + Catastro.PORTAL + '" target="_blank" rel="noopener noreferrer" data-ext="1">colombiaenmapas.gov.co</a>.</li>' +
        '<li>Entra a la consulta catastral y busca tu predio por número predial o tocándolo en el mapa.</li>' +
        '<li>En el resultado, pulsa «Descargar GeoJSON».</li>' +
        '<li>En esta app: Puntos › «Importar archivo» (o ＋ Predio › «Importar archivo») y elige ese archivo. El lindero entra como polígono y su número predial queda guardado en él.</li></ol>';
      h += '<h3 class="sub">O escribe solo el número</h3>' +
        '<label class="f"><span>Número predial</span><input type="text" id="catNum" inputmode="numeric" autocomplete="off" maxlength="40" value="' + esc(g ? g.numero : '') + '" placeholder="30 dígitos (o el anterior, de 20)">' +
        '<span class="hint">Está en el recibo del impuesto predial o en el certificado catastral.</span></label>' +
        '<button class="btn btn-primary btn-block" data-act="catGuardarManual">Guardar el número</button>';
      h += '<p class="small muted">' + esc(Catastro.AVISO) + ' La app solo guarda el número predial y el municipio; la dirección que trae el archivo se descarta. No es una aplicación oficial del IGAC.</p>';
      return h;
    }
    function open() { openSheet('Número predial y lindero', sheetBody()); }
    function guardarManual() {
      var el = $('#catNum'), n = Catastro.numero(el ? el.value : ''), l = lot();
      if (!n) { toast('El número predial tiene 30 dígitos (o 20 el anterior). Revísalo.', { err: true }); return; }
      var undo = setPredial(l, { numero: n, fuente: 'manual', at: Date.now() });
      save(); closeSheet(); renderTab(ui.tab);
      toast('Número predial guardado en «' + l.name + '».', { action: 'Deshacer', fn: function () { undo(); save(); renderTab(ui.tab); } });
    }
    function setPredial(l, g) {
      var before = l.predial, c = Catastro.clean(g);
      if (c) l.predial = c; else delete l.predial;
      return function () { if (before) l.predial = before; else delete l.predial; };
    }

    // Fila para el reporte (sección «Terreno»)
    function reportRows() {
      var g = lot().predial;
      return g ? [['Número predial', Catastro.legible(g.numero) + (g.municipio ? ' · ' + g.municipio : '')]] : [];
    }
    // Al importar un archivo: guarda en el polígono el número predial que trae. Devuelve con qué deshacerlo.
    function fromImport(l, pr) {
      if (!pr) return function () {};
      return setPredial(l, Object.assign({}, pr, { fuente: 'archivo', at: Date.now() }));
    }

    return { blockHtml: blockHtml, quitar: quitar, open: open, guardarManual: guardarManual, reportRows: reportRows, fromImport: fromImport };
  };
})();

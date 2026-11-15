/* Predios y lotes (separado de app.js en 2.28.0, sin cambiar lo que hace).
 * La fila de polígonos de arriba, la lista «Lotes de…», la ficha «Editar predio/lote» (nombre, tipo, color, candado,
 * dibujar o importar, exportar y borrar), los predios con sus lotes y lo que se sale o se monta, importar polígonos de un
 * archivo directo como predios o lotes, y el aviso de áreas enormes. La geometría la hacen predio.js, recorte.js y mapa.js.
 * Usa lo que app.js le pasa al llamarla: S y ui (el estado), $, proj, lot, lotArea, esc, isNum, toast, openSheet, closeSheet,
 * hideSheet, save, renderTab, showTab, colorPalette, layerById, layerSub y, del mapa (js/ui-mapa.js), adjustManyAsk,
 * finishTrack, mapKey, setMapMode, setMapTool, syncMapCard, toolsInset y toolsTop (se llaman cuando se usan, porque el mapa
 * se arma después). */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.lotes = function (ctx) {
    var S = ctx.S, ui = ctx.ui, $ = ctx['$'], adjustManyAsk = ctx.adjustManyAsk, closeSheet = ctx.closeSheet, colorPalette = ctx.colorPalette, esc = ctx.esc, finishTrack = ctx.finishTrack, hideSheet = ctx.hideSheet, isNum = ctx.isNum, layerById = ctx.layerById, layerSub = ctx.layerSub, lot = ctx.lot, lotArea = ctx.lotArea, mapKey = ctx.mapKey, openSheet = ctx.openSheet, proj = ctx.proj, renderTab = ctx.renderTab, save = ctx.save, setMapMode = ctx.setMapMode, setMapTool = ctx.setMapTool, showTab = ctx.showTab, syncMapCard = ctx.syncMapCard, toast = ctx.toast, toolsInset = ctx.toolsInset, toolsTop = ctx.toolsTop;
    var Fmt = window.Fmt, Geo = window.Geo, Gis = window.Gis, IO = window.IO, Mapa = window.Mapa, Store = window.Store;

    /* ---------- Lotes (2.15.0): la fila de lotes, la lista y sus acciones ---------- */
    // Color que se propone para un predio nuevo: el verde de siempre o, si ya lo usa otro polígono (un segundo predio), el primero libre
    // El «Predio» vacío con que arranca un proyecto: un lugar reservado que el primer predio de verdad reemplaza (2.22.0)
    function isPlaceholder(x, p) {
      return Predio.isFinca(x) && x.name === 'Predio' && !x.points.length && !Object.keys(x.climate || {}).length && !Predio.children(x, p.lots).length;
    }
    function fincaColor() {
      var used = {}, p = proj();
      p.lots.forEach(function (x) { if (!isPlaceholder(x, p)) used[x.mainColor.toUpperCase()] = true; });
      if (!used[Predio.FINCA_COLOR.toUpperCase()]) return Predio.FINCA_COLOR;
      return LOT_COLORS.filter(function (c) { return !used[c.toUpperCase()]; })[0] || Predio.FINCA_COLOR;
    }
    // 25 colores para predios y lotes (2.23.0): los 10 de siempre y 15 más, escogidos para distinguirse entre sí, sobre la imagen satelital y con el relleno de puntos
    // 2.23.4: 30 colores (5 filas parejas de 6); los 5 últimos son tonos claros que completan la paleta sin repetir los de antes
    var LOT_COLORS = Gis.COLORS.concat(['#00ACC1', '#5E35B1', '#AD1457', '#F4511E', '#7CB342', '#1565C0', '#FDD835', '#6D4C41', '#FF8A65', '#9E9D24', '#B39DDB', '#78909C', '#004D40', '#FFB300', '#3949AB',
      '#4FC3F7', '#81C784', '#F48FB1', '#CE93D8', '#A1887F']);      // los mismos colores de la paleta, para que el elegido quede marcado
    function lotSub(l) {
      var m2 = lotArea(l), n = l.points.length;
      var base = (m2 ? Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit) + ' · ' : '') + n + (n === 1 ? ' punto' : ' puntos') + (!m2 && n ? ' · falta cerrar el polígono' : '');
      if (!l.kind) return base;
      // finca o área (2.17.0): su tipo, la finca a la que pertenece y qué parte de ella ocupa
      var par = Predio.parentOf(l, proj().lots), pm = par ? lotArea(par) : 0;
      return Predio.kindLabel(l) + (l.locked ? ' · lindero bloqueado' : '') + (par ? ' · en «' + par.name + '»' + (m2 && pm ? ' (' + Fmt.num(m2 / pm * 100, 1) + ' %)' : '') : '') + ' · ' + base;
    }
    /* ---------- Fincas y áreas (2.17.0) ---------- */
    // Si el lindero de la finca elegida está bloqueado, avisa (con «Desbloquear») y devuelve true: quien llama no debe cambiar los puntos
    function lockStop() {
      var l = lot();
      if (!l.locked) return false;
      toast('El lindero del predio «' + l.name + '» está bloqueado para que no cambie por descuido.', { action: 'Desbloquear', fn: function () { setLock(l, false); } });
      return true;
    }
    function setLock(l, on) {
      if (on) { l.locked = true; if (l === lot()) { if (ui.track) finishTrack(); if (ui.mapMode) setMapMode(''); if (ui.mapTool === 'mira' || ui.mapTool === 'caminar') setMapTool(''); } }
      else delete l.locked;
      save(); renderTab(ui.tab);
      toast(on ? 'Lindero de «' + l.name + '» bloqueado.' : 'Lindero de «' + l.name + '» desbloqueado: ya puedes editarlo.');
    }
    // Acciones que cambian los puntos del polígono elegido: con el lindero bloqueado no se ejecutan
    var LOCKED_ACTS = { mapAimAdd: 1, mapWalk: 1, mapMark: 1, mark: 1, markAnyway: 1, addCoords: 1, addBulk: 1, saveBulk: 1, saveNew: 1, saveEdit: 1, askDelete: 1, doDelete: 1,
      mapCardOrder: 1, mapReorder: 1, mapSumTap: 1, mapCardMove: 1, mapUndo: 1, layerToMain: 1, mapMode: 1, mapAim: 1 };
    function lotsBar() {
      var p = proj(), cur = lot(), h = '<div class="lots" role="group" aria-label="Lotes del proyecto">';
      Predio.ordered(p.lots).forEach(function (l) {      // cada predio seguido de sus lotes
        var m2 = lotArea(l);
        h += '<button class="lotchip' + (Predio.isArea(l) && Predio.parentOf(l, p.lots) ? ' sub' : '') + '" data-act="lotPick" data-id="' + esc(l.id) + '" aria-pressed="' + (l === cur) + '"><i' + (Predio.isArea(l) ? ' class="dots"' : '') + ' style="background-color:' + esc(l.mainColor) + '"></i>' + esc(l.name) +
          (l.locked ? ' <span class="lk" aria-label="lindero bloqueado">🔒</span>' : '') +
          (m2 ? ' <small>· ' + esc(Fmt.area(Geo.areaUnits(m2), S.settings.areaUnit)) + '</small>' : '') + '</button>';
      });
      // 2.23.0: «＋ Lote» crea (o importa) un lote dentro del predio elegido; «＋ Predio», otro predio. Siempre a la mano, también con el proyecto vacío
      if (p.lots.length < Store.LOT_MAX) h += '<button class="lotchip add" data-act="lotAdd" aria-label="Agregar un lote al predio elegido">＋ Lote</button>' +
        '<button class="lotchip add" data-act="predioAdd" aria-label="Agregar un predio al proyecto">＋ Predio</button>';
      return h + '</div>';
    }
    // La fila va en Puntos, Información, Reporte y el croquis; en el mapa solo si hay más de un lote (para dejarle el alto al mapa)
    // 2.23.2: la fila va siempre, también en el mapa con un solo polígono, para que «＋ Lote» y «＋ Predio» estén a la mano desde el comienzo
    function hasLots(t) { return t === 'puntos' || t === 'clima' || t === 'informe' || t === 'area'; }
    function pickLot(id, quiet) {
      var p = proj();
      if (p.lotId === id || !p.lots.some(function (l) { return l.id === id; })) return false;
      if (ui.track) finishTrack();
      if (ui.mapTool) setMapTool('');
      var was = lot();
      ui.lockNote = '';
      if (Predio.isFinca(was) && was.points.length >= 3 && !was.locked) { was.locked = true; ui.lockNote = ' El lindero de «' + was.name + '» quedó bloqueado.'; }   // al salir de una finca, su lindero se protege solo
      p.lotId = id;
      if (lot().locked && ui.mapMode) setMapMode('');
      ui.mapSel = null; ui.navId = null; ui.unfolded = {};
      save();
      if (!quiet) { renderTab(ui.tab); toast('Lote elegido: ' + lot().name + '.' + ui.lockNote); }
      return true;
    }
    // Por cada finca: cuántas áreas tiene, cuánto ocupan y cuánto queda sin asignar
    function fincaLines(acc) {
      var u = S.settings.areaUnit, h = '';
      acc.fincas.forEach(function (f) {
        if (!f.m2) return;
        h += '<p class="small fincaline"><b>' + esc(f.lot.name) + '</b>: ' + (f.n ? f.n + (f.n === 1 ? ' lote' : ' lotes') + ', ' + esc(Fmt.area(Geo.areaUnits(f.used), u)) + ' (' + Fmt.num(f.used / f.m2 * 100, 1) + ' %) · sin asignar ' +
          esc(Fmt.area(Geo.areaUnits(f.free), u)) : 'todavía sin lotes') + (f.over ? ' · los lotes suman más que el predio' : '') + '.</p>';
      });
      return h;
    }
    function openLots() {
      var p = proj(), cur = lot(), acc = Predio.account(p.lots), total = acc.total, closed = acc.closed, h = '';
      p.lots.forEach(function (l) {
        h += '<div class="lotrow' + (l === cur ? ' on' : '') + (Predio.parentOf(l, p.lots) ? ' child' : '') + '"><i' + (Predio.isArea(l) ? ' class="dots"' : '') + ' style="background-color:' + esc(l.mainColor) + '"></i>' +
          '<button class="lotpick" data-act="lotPickClose" data-id="' + esc(l.id) + '"><b>' + esc(l.name) + '</b><small>' + esc(lotSub(l)) + '</small></button>' +
          '<button class="lotmore" data-act="lotEdit" data-id="' + esc(l.id) + '" aria-label="Editar ' + esc(l.name) + ': nombre, color o eliminar">⋮</button></div>';
      });
      var kinds = p.lots.some(function (l) { return !!l.kind; });
      h += '<p class="small muted" id="lotTotal">' + (closed ? 'Total del proyecto: <b>' + esc(Fmt.area(Geo.areaUnits(total), S.settings.areaUnit)) + '</b>' +
        (kinds ? '. Los lotes que están dentro de un predio no se suman otra vez.' : ' en ' + closed + (closed === 1 ? ' lote cerrado' : ' lotes cerrados') + '.') : 'Todavía no hay ningún lote con polígono cerrado.') +
        ' Cada ' + (kinds ? 'polígono' : 'lote') + ' tiene sus propios puntos, su clima y su zona de vida.</p>';
      h += fincaLines(acc);
      var ovl = Predio.warnings(p.lots);
      if (ovl.length) h += '<div class="tip" id="lotOverlap">' + ovl.map(esc).join('<br>') + '</div>';
      if (p.lots.length < Store.LOT_MAX) h += '<div class="btns"><button class="btn btn-primary" data-act="lotAdd">＋ Agregar lote</button><button class="btn" data-act="predioAdd">＋ Agregar predio</button></div>';
      hideSheet();
      openSheet('Lotes de ' + p.name, h);
    }
    // from: '' (desde «＋ Lote»: propone un lote como siempre) o 'map' (desde «Crear polígono»: propone finca, o área si ya hay finca)
    function lotForm(id, from) {
      var p = proj(), l = id ? p.lots.filter(function (x) { return x.id === id; })[0] : null;
      if (id && !l) return;
      var used = {}, color = l ? l.mainColor : '';
      p.lots.forEach(function (x) { used[x.mainColor.toUpperCase()] = true; });
      if (!l) color = LOT_COLORS.filter(function (c) { return !used[c]; })[0] || LOT_COLORS[p.lots.length % LOT_COLORS.length];   // el primer color que ningún lote usa
      // 2.23.0: «＋ Lote» siempre es un lote y «＋ Predio» siempre un predio; solo «＋ Polígono» (mapa) deja elegir, y propone primero el predio
      var k = l ? (l.kind || 'area') : from === 'predio' ? 'finca' : from === 'map' ? (Predio.fincas(p.lots).some(function (f) { return f.points.length; }) ? 'area' : 'finca') : 'area';
      var near = ui.map && from === 'map' ? ui.map.center() : null, cur = lot();
      var gp = l ? Predio.parentOf(l, p.lots) : Predio.guessParent(p.lots, near, Predio.isFinca(cur) ? cur.id : cur.parent);
      ui.edit = { kind: 'lot', id: id || '', color: color, k: k, cat: l && l.cat || '', parent: gp ? gp.id : '', name: l ? l.name : '', auto: !l,
        pickKind: !!l || from === 'map', mode: 'draw', imp: null, title: l ? (k === 'finca' ? 'Editar predio' : 'Editar lote') : from === 'map' ? 'Crear polígono' : from === 'predio' ? 'Nuevo predio' : 'Nuevo lote' };
      if (!l) { ui.edit.name = lotDefaultName(); if (k === 'area') ui.edit.color = Predio.catColor(ui.edit.cat); if (k === 'finca') ui.edit.color = fincaColor(); }
      hideSheet();
      openSheet(ui.edit.title, lotFormBody());
    }
    // Nombre que se propone mientras la persona no escriba el suyo: «Lote 3», «Finca», «Potrero 2»…
    function lotDefaultName() {
      var p = proj(), e = ui.edit, base = e.k === 'finca' ? 'Predio' : (e.cat || 'Lote');
      if (!e.k) return 'Lote ' + (p.lots.length + 1);
      var n = p.lots.filter(function (x) { return x.kind === e.k && !isPlaceholder(x, p) && (e.k === 'finca' || (x.cat || 'Lote') === base); }).length;
      return n ? base + ' ' + (n + 1) : base;
    }
    function lotFormBody() {
      var p = proj(), e = ui.edit, l = e.id ? p.lots.filter(function (x) { return x.id === e.id; })[0] : null, fs = Predio.fincas(p.lots).filter(function (f) { return f !== l; });
      var others = {};
      p.lots.forEach(function (x) { if (x !== l && !(!e.id && e.k === 'finca' && isPlaceholder(x, p))) others[x.mainColor.toUpperCase()] = x.name; });      // colores de los demás (el predio vacío del comienzo no cuenta: el nuevo lo reemplaza)
      // 2.23.5: un polígono vacío (recién creado o el «Predio» del comienzo) ofrece lo mismo que al crearlo: dibujarlo o traerlo de un archivo
      var empty = !l || !l.points.length, file = empty && e.mode === 'file';
      // al crear: dos caminos, dibujarlo o traerlo de un archivo
      var h = !empty ? '' : '<div class="seg" role="group" aria-label="Cómo crearlo" id="lotMode" style="margin-bottom:14px">' +
        [['draw', 'Dibujar'], ['file', 'Importar archivo']].map(function (o) { return '<button data-act="lotMode" data-m="' + o[0] + '" aria-pressed="' + (e.mode === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
      h += '<div class="f">' + (e.pickKind ? '<span class="f-label2">¿Qué vas a delimitar?</span><div class="seg" role="group" aria-label="Tipo de polígono" id="lotKind">' +
        [['finca', 'Predio'], ['area', 'Lote']].map(function (o) { return '<button data-act="lotKind" data-k="' + o[0] + '" aria-pressed="' + (e.k === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>' : '') +
        '<span class="f-hint" id="lotKindHint">' + (e.k === 'finca' ? 'El predio: el terreno completo. Su lindero se bloquea solo cuando pasas a otro polígono, para que no cambie por descuido.' :
          'Una parte de trabajo dentro del predio: potrero, cafetal, cultivo… Se dibuja con relleno de puntos y no cambia el lindero del predio.') + '</span></div>';
      if (e.k === 'area') {
        h += '<div class="f"><span class="f-label2">Tipo de lote</span><div class="cats" role="group" aria-label="Tipo de lote">' +
          Predio.CATS.map(function (c) { return '<button class="cat" data-act="lotCat" data-c="' + esc(c[0]) + '" aria-pressed="' + (e.cat.toLowerCase() === c[0].toLowerCase()) + '">' + esc(c[0]) + '</button>'; }).join('') + '</div>' +
          '<input type="text" id="lotCat" value="' + esc(e.cat) + '" maxlength="' + Store.CAT_MAX + '" autocomplete="off" placeholder="O escribe el tuyo: Cacaotera, Casa…" aria-label="Tipo de lote, con tus palabras"></div>';
        h += fs.length ? '<label class="f"><span>Pertenece al predio</span><select id="lotParent"><option value="">Ninguno (lote suelto)</option>' +
          fs.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === e.parent ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select></label>' :
          '<p class="small muted" id="lotNoFinca">Todavía no hay un predio en este proyecto: el lote queda suelto. Cuando crees el predio podrás asignárselo aquí.</p>';
      }
      if (file) return h + lotFileBody();
      h += '<label class="f"><span>Nombre</span><input type="text" id="lotName" value="' + esc(e.name) + '" maxlength="' + Store.LOT_NAME_MAX + '" autocomplete="off"></label>' +
        '<div class="f"><span style="display:block;margin-bottom:6px;font-weight:650">Color</span>' + colorPalette(e.color, others) +
        (Object.keys(others).length ? '<span class="f-hint" id="lotColorHint">Los colores con un punto blanco ya los usa otro lote.</span>' : '') + '</div>' +
        (!empty ? '<p class="small muted">' + esc(lotSub(l)) + '</p>' : '<p class="small muted" id="lotDrawHint">' + (l ? 'Al guardarlo' : 'Al crearlo') + ' se abre el mapa para que marques sus puntos tocándolo. Si prefieres caminar el lindero con el GPS o escribir coordenadas, toca «Salir» y hazlo desde Puntos.</p>');
      if (l && !empty && l.kind === 'finca' && e.k === 'finca') h += '<div class="btns"><button class="btn" data-act="lotLock" data-id="' + esc(l.id) + '">' + (l.locked ? '🔓 Desbloquear el lindero para editarlo' : '🔒 Bloquear el lindero') + '</button></div>';
      return h + '<div class="btns"><button class="btn btn-primary" data-act="lotSave">' + (!l ? 'Crear y dibujar en el mapa' : empty ? 'Guardar y dibujar en el mapa' : 'Guardar') + '</button>' +
        '</div>' + (l && !empty ? '<div class="btns" id="lotExpBox"><button class="btn" data-act="expOne" data-id="' + esc(l.id) + '">Exportar polígono</button></div>' : '') + lotDeleteBox(l, p);
    }
    /* ---------- Importar polígonos de un archivo directamente como predios o lotes (2.23.0) ---------- */
    // La parte de la hoja para «Importar archivo»: elegir el archivo y, cuando ya se leyó, marcar cuáles de sus polígonos entran
    function lotFileBody() {
      var e = ui.edit, what = e.k === 'finca' ? 'predio' : 'lote';
      if (e.id) {
        // un polígono que ya existe (vacío) se llena con UN polígono del archivo
        if (!e.imp) return '<p class="small muted" id="lotFileHint">Archivos KML, KMZ, GeoJSON o GPX. Los puntos de un polígono del archivo pasan a «' + esc(e.name) + '»' +
          (e.k === 'finca' ? ', con el lindero bloqueado' : '') + '. Si el archivo trae varios, eliges cuál. Para traer varios a la vez, usa «＋ Lote» o «＋ Predio».</p>' +
          '<div class="btns"><button class="btn btn-primary" data-act="lotFile">Elegir archivo…</button></div>';
        return '<p class="lead" id="lotFileName" style="margin-bottom:6px"><b>' + esc(e.imp.file) + '</b> · ' + e.imp.polys.length + (e.imp.polys.length === 1 ? ' polígono' : ' polígonos') + '</p>' +
          (e.imp.polys.length > 1 ? '<p class="small muted" style="margin:0 0 6px">Elige el que corresponde a «' + esc(e.name) + '».</p>' : '') +
          '<div id="lotPolys">' + e.imp.polys.map(function (x, i) {
            return '<label class="repfin impoly"><input type="radio" name="lotPoly" data-i="' + i + '"' + (x.on ? ' checked' : '') + '><span>' + esc(x.name) + ' <small class="muted">· ' +
              esc(Fmt.area(Geo.areaUnits(Geo.polygonArea(x.points)), S.settings.areaUnit)) + ' · ' + x.points.length + ' puntos</small></span></label>';
          }).join('') + '</div>' +
          '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="lotImport" id="lotImportBtn">Usar este polígono</button><button class="btn" data-act="lotFile">Elegir otro archivo</button></div>';
      }
      if (!e.imp) {
        return '<p class="small muted" id="lotFileHint">Archivos KML, KMZ, GeoJSON o GPX. Cada polígono del archivo entra como ' + what + ', con el nombre y los puntos que trae' +
          (e.k === 'area' ? '; si cae dentro de otro predio, queda en ese' : ', con el lindero bloqueado') + '. Si trae varios, podrás elegir cuáles.</p>' +
          '<div class="btns"><button class="btn btn-primary" data-act="lotFile">Elegir archivo…</button></div>';
      }
      var n = e.imp.polys.filter(function (x) { return x.on; }).length;
      return '<p class="lead" id="lotFileName" style="margin-bottom:6px"><b>' + esc(e.imp.file) + '</b> · ' + e.imp.polys.length + (e.imp.polys.length === 1 ? ' polígono' : ' polígonos') + '</p>' +
        (e.imp.polys.length > 1 ? '<p class="small muted" style="margin:0 0 6px">Deja marcados los que quieres traer.</p>' : '') +
        '<div id="lotPolys">' + e.imp.polys.map(function (x, i) {
          return '<label class="repfin impoly"><input type="checkbox" data-i="' + i + '"' + (x.on ? ' checked' : '') + '><span>' + esc(x.name) + ' <small class="muted">· ' +
            esc(Fmt.area(Geo.areaUnits(Geo.polygonArea(x.points)), S.settings.areaUnit)) + ' · ' + x.points.length + ' puntos</small></span></label>';
        }).join('') + '</div>' +
        '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="lotImport" id="lotImportBtn">Importar como ' + (n === 1 ? what : what === 'predio' ? 'predios' : 'lotes') + '</button>' +
        '<button class="btn" data-act="lotFile">Elegir otro archivo</button></div>';
    }
    function lotFileRead(file) {
      var e = ui.edit;
      if (!e || e.kind !== 'lot') return;
      IO.readBytes(file).then(function (bytes) {
        var res = Gis.parseBytes(bytes);
        var polys = Gis.toLayers(res.features, { file: file.name || 'archivo', uid: Store.uid }).filter(function (l) { return l.kind === 'polygon' && l.points.length >= 3; });
        if (!polys.length) throw new Error('el archivo no trae polígonos (solo líneas o puntos). Para verlo como capa, impórtalo desde «Puntos».');
        if (ui.edit !== e) return;
        lotFormRead();
        e.imp = { file: file.name || 'archivo', polys: polys.map(function (l, i) { return { name: l.name, points: l.points, on: !e.id || i === 0 }; }) };      // para un polígono que ya existe se elige uno: el primero, de entrada
        lotFormRefresh();
      }).catch(function (err) { toast('No se pudo importar: ' + (err && err.message || err), { err: true }); });
    }
    function lotImport() {
      var e = ui.edit, p = proj();
      if (!e || e.kind !== 'lot' || !e.imp) return;
      lotFormRead();
      if (e.id) { lotFill(e); return; }
      var sel = e.imp.polys.filter(function (x) { return x.on; }), finca = e.k === 'finca';
      if (!sel.length) { toast('Marca al menos un polígono para importar.', { err: true }); return; }
      var ph = finca ? p.lots.filter(function (x) { return isPlaceholder(x, p); })[0] : null;
      var room = Store.LOT_MAX - p.lots.length + (ph ? 1 : 0), left = Math.max(0, sel.length - room);
      if (room <= 0) { toast('Un proyecto admite hasta ' + Store.LOT_MAX + ' lotes.', { err: true }); return; }
      sel = sel.slice(0, room);
      var lotsBefore = p.lots.slice(), prev = p.lotId, wasLocked = lot().locked, used = {}, made = [];
      p.lots.forEach(function (x) { if (!isPlaceholder(x, p)) used[x.mainColor.toUpperCase()] = true; });
      function freeColor(first) {
        var c = first && !used[first.toUpperCase()] ? first : LOT_COLORS.filter(function (x) { return !used[x.toUpperCase()]; })[0] || LOT_COLORS[(p.lots.length + made.length) % LOT_COLORS.length];
        used[c.toUpperCase()] = true;
        return c;
      }
      var fs = Predio.fincas(p.lots).filter(function (f) { return f.points.length >= 3; });
      sel.forEach(function (s) {
        var nl = Store.newLot(Store.lotName(s.name, p.lots.length), finca ? freeColor(Predio.FINCA_COLOR) : e.cat ? Predio.catColor(e.cat) : freeColor());
        nl.kind = e.k; nl.points = Gis.pointsFromLayer({ points: s.points, ts: Date.now() }, Store.uid); nl.nextPoint = nl.points.length + 1;
        if (finca) nl.locked = true;                       // viene de un archivo: su lindero queda protegido desde el principio
        else {
          if (e.cat) nl.cat = e.cat;
          var c = Predio.centroid(nl.points), hit = fs.filter(function (f) { return Predio.contains(f, c); })[0], par = hit ? hit.id : e.parent;      // el predio donde cae; si no cae en ninguno, el elegido
          if (par) nl.parent = par;
        }
        if (ph) { p.lots.splice(p.lots.indexOf(ph), 1, nl); ph = null; } else p.lots.push(nl);
        made.push(nl);
      });
      ui.lockNote = '';
      if (p.lots.some(function (x) { return x.id === p.lotId; })) pickLot(made[0].id, true);
      else { p.lotId = made[0].id; ui.mapSel = null; ui.navId = null; ui.unfolded = {}; }
      var note = ui.lockNote || '', prevLot = lotsBefore.filter(function (x) { return x.id === prev; })[0];
      ui.mapFitKey = null;
      save(); closeSheet(); renderTab(ui.tab);
      toast((made.length === 1 ? '«' + made[0].name + '» importado como ' + (finca ? 'predio' : 'lote') : made.length + ' polígonos importados como ' + (finca ? 'predios' : 'lotes')) +
        (finca ? ', con el lindero bloqueado.' : '.') + (left ? ' No cupieron ' + left + ': un proyecto admite hasta ' + Store.LOT_MAX + '.' : '') + note, { action: 'Deshacer', fn: function () {
        p.lots = lotsBefore; p.lotId = prev;
        if (prevLot && note && !wasLocked) delete prevLot.locked;
        ui.mapFitKey = null; save(); renderTab(ui.tab);
      } });
      if (!finca) adjustManyAsk(made);
    }
    // Lee lo escrito y vuelve a dibujar la hoja (al cambiar el tipo o la categoría), sin perder nada
    // Lleva a Polígono › Mapa, encuadra el predio del lote (para dibujar dentro de él) y deja activo «Ingresar puntos»
    function goDraw(l) {
      var p = proj(), par = Predio.parentOf(l, p.lots);
      ui.polyView = 'mapa';
      if (ui.tab !== 'area') showTab('area'); else renderTab('area');
      if (!ui.map) return;
      var ext = par && par.points.length ? Mapa.extent(par.points, []) : ui.fix ? Mapa.extent([{ lat: ui.fix.lat, lon: ui.fix.lon }], []) : null;
      if (ext) { ui.follow = false; ui.map.fit(ext, { bottom: toolsInset(), top: toolsTop() }); }
      ui.mapFitKey = mapKey();
      setMapMode('add');
    }
    // Un polígono que ya existe y está vacío toma los puntos del polígono elegido del archivo (2.23.5)
    function lotFill(e) {
      var p = proj(), l = p.lots.filter(function (x) { return x.id === e.id; })[0], s = e.imp.polys.filter(function (x) { return x.on; })[0];
      if (!l) return;
      if (!s) { toast('Elige un polígono del archivo.', { err: true }); return; }
      if (l.points.length) { toast('«' + l.name + '» ya tiene puntos: para traer otro polígono usa «＋ Lote» o «＋ Predio».', { err: true }); return; }
      var before = { name: l.name, color: l.mainColor, kind: l.kind, cat: l.cat, parent: l.parent, locked: l.locked, next: l.nextPoint };
      // el nombre del archivo reemplaza solo a un nombre de los que pone la app («Predio», «Lote 2»…), nunca a uno escrito a mano
      var auto = /^(Predio|Lote)( \d+)?$/.test(l.name);
      l.mainColor = e.color; lotApplyMeta(l, e);
      if (auto) l.name = Store.lotName(s.name, p.lots.length);
      l.points = Gis.pointsFromLayer({ points: s.points, ts: Date.now() }, Store.uid); l.nextPoint = l.points.length + 1;
      if (Predio.isFinca(l)) l.locked = true;
      else if (!l.parent) {
        var c = Predio.centroid(l.points), hit = Predio.fincas(p.lots).filter(function (f) { return f !== l && f.points.length >= 3 && Predio.contains(f, c); })[0];
        if (hit) l.parent = hit.id;
      }
      if (p.lotId !== l.id) pickLot(l.id, true);
      ui.mapFitKey = null;
      save(); closeSheet(); renderTab(ui.tab);
      toast('«' + l.name + '» tomó los ' + l.points.length + ' puntos de «' + s.name + '»' + (Predio.isFinca(l) ? ', con el lindero bloqueado.' : '.'), { action: 'Deshacer', fn: function () {
        l.points = []; l.nextPoint = before.next; l.name = before.name; l.mainColor = before.color;
        ['kind', 'cat', 'parent', 'locked'].forEach(function (k) { if (before[k] === undefined) delete l[k]; else l[k] = before[k]; });
        ui.mapFitKey = null; save(); renderTab(ui.tab);
      } });
      if (Predio.isArea(l)) adjustManyAsk([l]);
    }
    function lotFormRead() {
      var e = ui.edit, n = $('#lotName'), c = $('#lotCat'), s = $('#lotParent');
      if (e.imp && document.querySelector('#lotPolys input')) [].forEach.call(document.querySelectorAll('#lotPolys input'), function (i) { var x = e.imp.polys[+i.getAttribute('data-i')]; if (x) x.on = i.checked; });
      if (n) { if (n.value !== e.name) e.auto = false; e.name = n.value; }
      if (c) e.cat = c.value.replace(/\s+/g, ' ').trim().slice(0, Store.CAT_MAX);
      if (s) e.parent = s.value;
    }
    function lotFormRefresh() {
      var e = ui.edit;
      if (e.auto) e.name = lotDefaultName();
      var body = $('#sheet .sheet-body');
      if (body) body.innerHTML = lotFormBody();
      if (e.id) { e.title = e.k === 'finca' ? 'Editar predio' : 'Editar lote'; var t = $('#sheet h2'); if (t) t.textContent = e.title; }
    }
    function lotSetKind(k) {
      var e = ui.edit;
      if (!e || e.kind !== 'lot') return;
      lotFormRead();
      e.k = k;
      if (!e.id) e.color = k === 'finca' ? fincaColor() : Predio.catColor(e.cat);
      lotFormRefresh();
    }
    function lotSetCat(c) {
      var e = ui.edit;
      if (!e || e.kind !== 'lot') return;
      lotFormRead();
      e.cat = c;
      if (!e.id) e.color = Predio.catColor(c);
      lotFormRefresh();
    }
    function lotApplyMeta(l, e) {
      if (e.k) l.kind = e.k; else delete l.kind;
      if (e.k === 'area' && e.cat) l.cat = e.cat; else delete l.cat;
      if (e.k === 'area' && e.parent) l.parent = e.parent; else delete l.parent;
      if (e.k !== 'finca') { delete l.locked; proj().lots.forEach(function (x) { if (x.parent === l.id) delete x.parent; }); }      // si deja de ser finca, sus áreas quedan sueltas
    }
    function lotSave() {
      var e = ui.edit, p = proj();
      if (!e || e.kind !== 'lot') return;
      lotFormRead();
      if (e.auto && !e.id) e.name = lotDefaultName();          // si no escribió un nombre, toma el del tipo («Cacaotera», «Potrero 2»…)
      var name = Store.lotName(e.name, p.lots.length);
      if (e.id) {
        var l = p.lots.filter(function (x) { return x.id === e.id; })[0];
        if (!l) return;
        l.name = name; l.mainColor = e.color; lotApplyMeta(l, e);
        if (!l.points.length) {      // 2.23.5: un polígono vacío se guarda y se va a dibujar
          save(); closeSheet();
          if (p.lotId !== l.id) pickLot(l.id, true);
          goDraw(l);
          var par = Predio.parentOf(l, p.lots);
          toast('Toca el mapa para marcar los puntos de «' + l.name + '»' + (par ? ' dentro de «' + par.name + '»' : '') + '.');
          return;
        }
        save(); closeSheet(); renderTab(ui.tab); toast((Predio.isFinca(l) ? 'Predio' : 'Lote') + ' guardado.');
        return;
      }
      if (p.lots.length >= Store.LOT_MAX) { toast('Un proyecto admite hasta ' + Store.LOT_MAX + ' lotes.', { err: true }); return; }
      var nl = Store.newLot(name, e.color), prev = p.lotId, wasLocked = lot().locked, lotsBefore = p.lots.slice();
      lotApplyMeta(nl, e);
      // 2.22.0: el «Predio» vacío con que arranca el proyecto es solo un lugar reservado: al crear el predio de verdad lo reemplaza
      var ph = Predio.isFinca(nl) ? p.lots.filter(function (x) { return isPlaceholder(x, p); })[0] : null;
      if (ph) { p.lots.splice(p.lots.indexOf(ph), 1, nl); p.lotId = nl.id; ui.lockNote = ''; ui.mapSel = null; ui.navId = null; ui.unfolded = {}; }
      else { p.lots.push(nl); pickLot(nl.id, true); }
      var note = ui.lockNote || '', prevLot = p.lots.filter(function (x) { return x.id === prev; })[0];
      save(); closeSheet();
      goDraw(nl);      // 2.23.3: desde cualquier botón o pestaña, «Dibujar» lleva al mapa listo para marcar tocando
      var par = Predio.parentOf(nl, p.lots);
      toast('«' + nl.name + '» creado.' + note + ' Toca el mapa para marcar sus puntos' + (par ? ' dentro de «' + par.name + '»' : '') + '.', { action: 'Deshacer', fn: function () {
        if (nl.points.length) { toast('El lote ya tiene puntos: elimínalo desde la lista de lotes.', { err: true }); return; }
        p.lots = lotsBefore; p.lotId = prev;
        if (prevLot && note && !wasLocked) delete prevLot.locked;
        if (ui.mapMode === 'add') setMapMode('');
        save(); renderTab(ui.tab);
      } });
    }
    // 2.23.7: el botón para quitar el polígono. Con varios, «Eliminar predio/lote»; si es el único, «Borrar sus puntos y empezar de nuevo»
    // (un proyecto no puede quedar sin polígonos). Los dos piden confirmación y se pueden deshacer.
    // 2.23.7: un polígono de tamaño fuera de lo normal casi siempre tiene un punto con la coordenada mal escrita
    function hugeInfo() {
      var l = lot(), m2 = lotArea(l);
      if (!m2 || m2 / 10000 <= Mapa.HUGE_HA) return null;
      var i = Mapa.outlier(l.points);
      return { m2: m2, text: Fmt.area(Geo.areaUnits(m2), 'ha'), point: i >= 0 ? l.points[i] : null };
    }
    function hugeTip() {
      var hg = hugeInfo();
      if (!hg) return '';
      return '<div class="tip" id="areaHuge">«' + esc(lot().name) + '» mide ' + esc(hg.text) + ', un tamaño fuera de lo normal para un predio. Casi siempre es un punto con una coordenada mal escrita' +
        (hg.point ? ': el que más se aleja de los demás es <b>' + esc(hg.point.name || 'sin nombre') + '</b> (' + esc(Fmt.coord(hg.point.lat)) + ', ' + esc(Fmt.coord(hg.point.lon)) + ').' : '.') +
        ' Corrígelo en Puntos, o bórralo y márcalo de nuevo.</div>';
    }
    function hugePoint() {
      var hg = hugeInfo();
      if (!hg || !hg.point || !ui.map) return;
      ui.follow = false; ui.map.flyTo(hg.point.lat, hg.point.lon, 12);
      ui.mapSel = hg.point.id; syncMapCard();
    }
    function lotDeleteBox(l, p) {
      if (!l || (p.lots.length < 2 && !l.points.length)) return '';
      var only = p.lots.length < 2, what = Predio.isFinca(l) ? 'predio' : 'lote';
      return '<div class="btns" id="lotDelBox"><button class="btn btn-danger" data-act="lotDeleteAsk" data-id="' + esc(l.id) + '">' +
        (only ? 'Borrar sus puntos y empezar de nuevo' : 'Eliminar ' + what) + '</button></div>';
    }
    function lotDeleteAsk(id) {
      var p = proj(), l = p.lots.filter(function (x) { return x.id === id; })[0], box = $('#lotDelBox');
      if (!l || !box) return;
      var only = p.lots.length < 2, kids = Predio.isFinca(l) ? Predio.children(l, p.lots).length : 0, n = l.points.length;
      box.innerHTML = '<p class="note" id="lotDelAsk" style="width:100%;margin:0 0 8px">' + (only ?
        '¿Borrar los ' + n + ' puntos de «' + esc(l.name) + '» (con sus fotos) y su clima? El predio queda vacío, listo para dibujarlo o importarlo de nuevo.' :
        '¿Eliminar «' + esc(l.name) + '»' + (n ? ' con sus ' + n + ' puntos y sus fotos' : '') + '?' + (kids ? (kids === 1 ? ' Su lote queda suelto' : ' Sus ' + kids + ' lotes quedan sueltos') + ', sin predio.' : '')) + ' Después puedes deshacerlo.</p>' +
        '<button class="btn btn-danger" data-act="' + (only ? 'lotReset' : 'lotDelete') + '" data-id="' + esc(l.id) + '">' + (only ? 'Sí, borrar los puntos' : 'Sí, eliminar') + '</button>' +
        '<button class="btn" data-act="lotDeleteNo">Cancelar</button>';
      if (box.scrollIntoView) box.scrollIntoView({ block: 'end' });
    }
    function lotReset(id) {
      var p = proj(), l = p.lots.filter(function (x) { return x.id === id; })[0];
      if (!l || !l.points.length) return;
      if (ui.track) finishTrack();
      var before = { points: l.points, next: l.nextPoint, climate: l.climate, weatherNow: l.weatherNow, locked: l.locked };
      l.points = []; l.nextPoint = 1; l.climate = {}; delete l.weatherNow; delete l.locked;
      ui.mapSel = null; ui.navId = null; ui.mapFitKey = null;
      save(); closeSheet(); renderTab(ui.tab);
      toast('«' + l.name + '» quedó vacío: ' + before.points.length + ' puntos borrados. Ya puedes dibujarlo o importarlo de nuevo.', { action: 'Deshacer', fn: function () {
        l.points = before.points; l.nextPoint = before.next; l.climate = before.climate;
        if (before.weatherNow) l.weatherNow = before.weatherNow;
        if (before.locked) l.locked = true;
        ui.mapFitKey = null; save(); renderTab(ui.tab);
      } });
    }
    function lotDelete(id) {
      var p = proj(), i = -1;
      p.lots.forEach(function (x, k) { if (x.id === id) i = k; });
      if (i < 0 || p.lots.length < 2) return;
      var gone = p.lots[i], prev = p.lotId;
      if (ui.track) finishTrack();
      p.lots.splice(i, 1);
      if (prev === gone.id) { p.lotId = p.lots[Math.max(0, i - 1)].id; ui.mapSel = null; ui.navId = null; }
      save(); closeSheet(); renderTab(ui.tab);
      toast('«' + gone.name + '» eliminado' + (gone.points.length ? ' con sus ' + gone.points.length + ' puntos' : '') + '.', { action: 'Deshacer', fn: function () {
        if (p.lots.indexOf(gone) >= 0 || S.projects.indexOf(p) < 0) return;
        p.lots.splice(Math.min(i, p.lots.length), 0, gone); p.lotId = prev; save(); renderTab(ui.tab);
      } });
    }
    function editMain() {
      var p = proj();
      ui.edit = { kind: 'main', color: p.mainColor };
      openSheet('Color de mis puntos', '<p class="lead">Es el color con el que se dibujan tus puntos y tu polígono en los planos, en Google Earth (al exportar) y en el reporte.</p>' + colorPalette(p.mainColor) +
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
        (l.kind === 'polygon' ? '<button class="btn" data-act="layerToFinca" data-id="' + esc(id) + '">Crear un predio con esta capa</button><button class="btn" data-act="layerToArea" data-id="' + esc(id) + '">Crear un lote con esta capa</button>' : '') +
        '<button class="btn btn-danger" data-act="deleteLayer" data-id="' + esc(id) + '">Eliminar capa</button></div>');
    }
    function pickColor(t) {
      if (!ui.edit) return;
      ui.edit.color = t.getAttribute('data-color');
      Array.prototype.forEach.call(document.querySelectorAll('#sheet .sw'), function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      var dflt = $('#sheet [data-act="pointColorDefault"]');
      if (dflt) dflt.setAttribute('aria-pressed', 'false');
    }
    function pointColorDefault() {
      if (!ui.edit) return;
      ui.edit.color = '';
      Array.prototype.forEach.call(document.querySelectorAll('#sheet .sw'), function (b) { b.setAttribute('aria-pressed', 'false'); });
      var dflt = $('#sheet [data-act="pointColorDefault"]');
      if (dflt) dflt.setAttribute('aria-pressed', 'true');
    }
    function saveEdit2() {
      var e = ui.edit, p = proj();
      if (!e) return;
      if (e.kind === 'lot') { lotSave(); return; }
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
    // Crea una finca o un área nueva con la figura de una capa importada (2.17.0). No toca los polígonos que ya existen;
    // la capa se oculta (sigue en la lista) y «Deshacer» deja todo como estaba.
    function layerToLot(id, kind) {
      var p = proj(), l = layerById(id);
      if (!l || l.kind !== 'polygon') return;
      if (p.lots.length >= Store.LOT_MAX) { toast('Un proyecto admite hasta ' + Store.LOT_MAX + ' lotes.', { err: true }); return; }
      var pts = Gis.pointsFromLayer(l, Store.uid), prev = p.lotId, wasVisible = l.visible !== false;
      var nl = Store.newLot(Store.lotName(l.name, p.lots.length), kind === 'finca' ? Predio.FINCA_COLOR : (/^#[0-9a-fA-F]{6}$/.test(l.color || '') ? l.color : Predio.catColor('')));
      nl.kind = kind; nl.points = pts; nl.nextPoint = pts.length + 1;
      if (kind === 'area') { var f = Predio.guessParent(p.lots, Predio.centroid(pts), Predio.isFinca(lot()) ? lot().id : lot().parent); if (f) nl.parent = f.id; }
      var lotsBefore = p.lots.slice(), ph = kind === 'finca' ? p.lots.filter(function (x) { return isPlaceholder(x, p); })[0] : null;
      l.visible = false;
      if (ph) { p.lots.splice(p.lots.indexOf(ph), 1, nl); p.lotId = nl.id; ui.lockNote = ''; ui.mapSel = null; ui.navId = null; ui.unfolded = {}; }      // reemplaza al «Predio» vacío del comienzo
      else { p.lots.push(nl); pickLot(nl.id, true); }
      var note = ui.lockNote || '', prevLot = p.lots.filter(function (x) { return x.id === prev; })[0], wasLocked = prevLot && prevLot.locked && !note;
      if (kind === 'finca') nl.locked = true;                // viene de un archivo: su lindero queda protegido desde el principio
      ui.mapFitKey = null;
      save(); closeSheet(); renderTab(ui.tab);
      toast('«' + nl.name + '» creado como ' + (kind === 'finca' ? 'predio, con el lindero bloqueado' : 'lote' + (nl.parent ? ' de «' + Predio.parentOf(nl, p.lots).name + '»' : '')) + '. La capa quedó oculta.' + note, { action: 'Deshacer', fn: function () {
        p.lots = lotsBefore; p.lotId = prev; l.visible = wasVisible;
        if (prevLot && note && !wasLocked) delete prevLot.locked;
        save(); renderTab(ui.tab);
      } });
    }
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

    return { LOCKED_ACTS: LOCKED_ACTS, LOT_COLORS: LOT_COLORS, deleteLayer: deleteLayer, editLayer: editLayer, editMain: editMain, fincaLines: fincaLines, hasLots: hasLots, hugeInfo: hugeInfo, hugePoint: hugePoint, hugeTip: hugeTip, layerToLot: layerToLot, layerToMain: layerToMain, lockStop: lockStop, lotDelete: lotDelete, lotDeleteAsk: lotDeleteAsk, lotDeleteBox: lotDeleteBox, lotFileRead: lotFileRead, lotForm: lotForm, lotFormRead: lotFormRead, lotFormRefresh: lotFormRefresh, lotImport: lotImport, lotReset: lotReset, lotSave: lotSave, lotSetCat: lotSetCat, lotSetKind: lotSetKind, lotsBar: lotsBar, openLots: openLots, pickColor: pickColor, pickLot: pickLot, pointColorDefault: pointColorDefault, restoreSnapshot: restoreSnapshot, saveEdit2: saveEdit2, setLock: setLock, snapshot: snapshot, toggleLayer: toggleLayer };
  };
})();

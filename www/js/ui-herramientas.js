/* Herramientas, crédito y autor del reporte (separado de app.js en 2.27.0, sin cambiar lo que hace).
 * Arma la pestaña Herramientas (tarjetas, menú de ayudas y copia de seguridad, crédito «Un proyecto de Campesino Urbano»
 * con sus redes), la hoja del autor y el logo del reporte, y las tres herramientas: el conversor de unidades de campo
 * (units.js), el clima actual (Open-Meteo, por climate.js) y la lectura del GPS en vivo.
 * Usa lo que app.js le pasa al llamarla: S y ui (el estado), busy, $, APP_VERSION, WHATS_NEW_ID, analysis, proj, esc, isNum,
 * toast, openSheet, closeSheet y renderTab. */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.herramientas = function (ctx) {
    var S = ctx.S, ui = ctx.ui, busy = ctx.busy, $ = ctx['$'], APP_VERSION = ctx.APP_VERSION, WHATS_NEW_ID = ctx.WHATS_NEW_ID, analysis = ctx.analysis, closeSheet = ctx.closeSheet, esc = ctx.esc, isNum = ctx.isNum, openSheet = ctx.openSheet, proj = ctx.proj, renderTab = ctx.renderTab, toast = ctx.toast;
    var Climate = window.Climate, Fmt = window.Fmt, Fotos = window.Fotos, Firma = window.Firma, Report = window.Report, Store = window.Store, Units = window.Units, Errores = window.Errores, IO = window.IO;

    /* ---------- Herramientas (2.7.0): conversor de unidades, clima actual y GPS en vivo ---------- */
    var TOOL_ICON = {
      area: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
      distancia: '<path d="M4 16L16 4l4 4L8 20z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
      temperatura: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
      clima: '<path d="M7 15.5a4 4 0 0 1-.6-7.9 5.5 5.5 0 0 1 10.6 1A3.5 3.5 0 0 1 17 15.5z"/><path d="M8.5 18.5l-.8 2M12.5 18.5l-.8 2M16.5 18.5l-.8 2"/>',
      gps: '<path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/>'
    };
    function toolCard(act, key, title, sub) {
      return '<button class="tcard" data-act="' + act + '" data-tool="' + key + '"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + TOOL_ICON[key] + '</svg><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>';
    }
    function tabHerramientas() {
      var p = proj(), h = '<h2 class="tt">Herramientas</h2>';
      h += '<h3 class="sub">Conversor de unidades</h3><div class="tgrid tgrid3">';
      Units.CATEGORIES.forEach(function (c) { h += toolCard('convert', c.id, c.name); });
      h += '</div><h3 class="sub">Utilidades de campo</h3><div class="tgrid">' + toolCard('toolWeather', 'clima', 'Clima', 'Condiciones actuales') + toolCard('toolGps', 'gps', 'GPS', 'Coordenadas y precisión') + '</div>';
      h += '<h3 class="sub">Proyectos y copias</h3><div class="menu">' +
        menuRow('projects', 'Proyectos', S.projects.length + (S.projects.length === 1 ? ' proyecto' : ' proyectos') + ' · actual: ' + p.name) +
        menuRow('projects', 'Copia de seguridad y restaurar', '.zip recomendado') + '</div>';
      var au = Store.loadAuthor(), auSub = [au.name, au.org, au.logo ? 'con logo' : '', au.sign ? 'con firma' : ''].filter(Boolean).join(' · ');
      h += '<h3 class="sub">Reporte</h3><div class="menu">' + menuRow('authorEdit', 'Encabezado del reporte', auSub || 'Autor, entidad, logo y firma') + '</div>';
      h += '<h3 class="sub">Preferencias</h3><div class="menu"><label class="menurow"><span><b>Alto contraste</b><small>Negro sobre blanco y bordes marcados, para leer al sol. Solo cambia los colores.</small></span>' +
        '<input type="checkbox" data-flag="altoContraste"' + (Store.loadFlag('altoContraste') === true ? ' checked' : '') + '></label>' +
        '<label class="menurow"><span><b>Reporte con todas las secciones abiertas</b><small>Si no, cada sección se abre al tocar su título.</small></span>' +
        '<input type="checkbox" data-flag="reportOpen"' + (Store.loadFlag('reportOpen') === true ? ' checked' : '') + '></label>' +
        '<label class="menurow"><span><b>Pegar puntos a las esquinas de otros polígonos</b><small>Al marcar o mover un punto en el mapa muy cerca de la esquina de otro predio o lote, queda exactamente sobre ella.</small></span>' +
        '<input type="checkbox" data-flag="lotSnap"' + (Store.loadFlag('lotSnap') === false ? '' : ' checked') + '></label></div>' + gpsMethodGroup() + slopeMarginGroup();
      h += '<h3 class="sub">Ayuda</h3><div class="menu">' + menuRow('appGuide', 'Cómo usar la app', 'Los tres pasos y todo lo demás') + menuRow('whatsNew', 'Qué hay de nuevo', 'Lo nuevo de la versión ' + WHATS_NEW_ID) + menuRow('usesGuide', 'Para qué sirve la app', 'Usos por área y hasta dónde llega') + menuRow('mapGuide', 'Cómo usar el mapa', 'Puntos, polígonos, predios y lotes') +
        menuRow('licenses', 'Fuentes y licencias', 'Mapas y datos de clima') + menuRow('diag', 'Registro de errores', diagSub()) + '</div>';
      h += '<p class="small muted" style="margin-top:14px">Don Florentino SIG · versión ' + APP_VERSION + '. Funciona sin internet, salvo los mapas y los datos de clima.</p>';
      return h + creditHtml();
    }
    /* ---------- Registro de errores y tiempo de arranque (2.34.0, errores.js) ----------
     * Se guarda solo en el teléfono y nunca se envía solo: sale únicamente si la persona lo comparte desde aquí. */
    function diagStore() { try { return window.localStorage; } catch (e) { return null; } }
    function diagSub() {
      if (!Errores) return 'No disponible';
      var s = Errores.summary(Errores.load(diagStore()));
      return (s.errores ? s.errores + (s.errores === 1 ? ' error anotado' : ' errores anotados') : 'Sin errores') + (s.ultimo !== null ? ' · abrió en ' + Errores.seconds(s.ultimo) : '');
    }
    function openDiag(confirmClear) {
      if (!Errores) { toast('El registro de errores no está disponible.', { err: true }); return; }
      var d = Errores.load(diagStore()), s = Errores.summary(d), vacio = !d.errores.length && !d.arranques.length;
      var h = '<p class="lead">Si algo falla, la app lo anota aquí para que puedas enviárselo a quien la mantiene. Se guarda solo en este teléfono y <b>nunca se envía solo</b>: sale únicamente si tú lo compartes. No guarda tus puntos ni coordenadas.</p>';
      h += '<dl class="kv"><div><dt>Tiempo de arranque</dt><dd id="diagArranque">' + (s.ultimo !== null ? 'Última vez: ' + Errores.seconds(s.ultimo) + (s.arranques > 1 ? ' · promedio de ' + s.arranques + ': ' + Errores.seconds(s.promedio) : '') : 'Sin datos todavía') + '</dd></div>' +
        '<div><dt>Errores anotados</dt><dd id="diagCuenta">' + (s.errores ? s.errores + (s.veces > s.errores ? ' (' + s.veces + ' veces)' : '') : 'Ninguno') + '</dd></div></dl>';
      if (d.errores.length) {
        h += '<ul class="errlist" id="diagLista">' + d.errores.slice().reverse().slice(0, 20).map(function (e) {
          return '<li><b>' + esc(e.m) + '</b><small>' + esc(Errores.day(e.t)) + ' · versión ' + esc(e.v || '?') + (e.n > 1 ? ' · ' + e.n + ' veces' : '') + (e.d ? ' · ' + esc(e.d) : '') + '</small></li>';
        }).join('') + '</ul>';
        if (d.errores.length > 20) h += '<p class="small muted">Aquí se ven los 20 más recientes; al compartir van todos.</p>';
      }
      h += '<div class="btns"><button class="btn btn-primary" data-act="diagShare">Compartir el registro</button>' +
        (confirmClear ? '<button class="btn btn-danger" data-act="diagClearYes">Sí, borrar el registro</button>' : '<button class="btn" data-act="diagClear"' + (vacio ? ' disabled' : '') + '>Borrar el registro</button>') + '</div>';
      openSheet('Registro de errores', h);
    }
    function shareDiag() {
      if (!Errores) return;
      var txt = Errores.text(Errores.load(diagStore()), { version: APP_VERSION, ua: navigator.userAgent, now: Date.now() });
      var name = 'don-florentino-sig-registro-' + Errores.day(new Date().toISOString()).slice(0, 10) + '.txt';
      IO.saveText(name, 'text/plain', txt, { title: 'Registro de errores de Don Florentino SIG', text: 'Registro de errores de Don Florentino SIG (versión ' + APP_VERSION + ').', dialogTitle: 'Compartir el registro' }).then(function (r) {
        if (r.how === 'download') toast('Archivo descargado: ' + name);
        else if (r.how === 'share') toast('Registro listo para enviar.');
      }).catch(function (e) { toast('No se pudo preparar el registro: ' + (e && e.message || e), { err: true }); });
    }
    function clearDiag() {
      if (!Errores) return;
      Errores.clear(diagStore());
      closeSheet();
      toast('Registro borrado.');
      if (ui.tab === 'herramientas') renderTab('herramientas');
    }
    /* ---------- Crédito y redes de Campesino Urbano (2.23.1) ----------
     * Los iconos son dibujos sencillos propios (cámara, personas, globo de chat, nota musical), no los logotipos de las marcas;
     * el nombre de cada red va escrito debajo. Los enlaces abren la red en su app o en el navegador del teléfono, no dentro de la app. */
    var SOCIAL = [
      ['Instagram', 'https://www.instagram.com/campesinourbano', '<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="4"/><path d="M8 6l1.5-2.5h5L16 6"/>'],
      ['Facebook', 'https://www.facebook.com/share/1EyHNmXiXm/', '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .2 5.5 2.4 5.5 5.8"/>'],
      ['WhatsApp', 'https://wa.me/message/L5XIHRLB5CYNI1', '<path d="M4 18.5l1.2-3.6A8 8 0 1 1 8.6 18z"/><path d="M9 10.5h6M9 13.5h4"/>'],
      ['TikTok', 'https://www.tiktok.com/@campesinourbano', '<path d="M10 17.5V5l9-2v12"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>']
    ];
    function creditHtml() {
      return '<div class="credit" id="credit"><p>Un proyecto de <b>Campesino Urbano</b></p><div class="social" role="group" aria-label="Redes de Campesino Urbano">' +
        SOCIAL.map(function (s) {
          return '<a class="soc" href="' + s[1] + '" target="_blank" rel="noopener noreferrer" data-ext="1" aria-label="' + s[0] + ' de Campesino Urbano">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true">' + s[2] + '</svg><span>' + s[0] + '</span></a>';
        }).join('') + '</div></div>';
    }
    /* ---------- Autor y logo del reporte (2.14.0); tarjeta profesional y firma (2.34.3) ---------- */
    function authorBody() {
      var au = ui.authorDraft;
      return '<p class="lead">Arriba del reporte (PDF, HTML y resumen) sale: Proyecto, Elaborado por y la fecha; el logo va a la derecha. Al final va la firma, con tu nombre y tu tarjeta profesional. Se guardan en este teléfono; no van en la copia de seguridad.</p>' +
        '<label class="f"><span>Nombre de quien elabora</span><input type="text" id="auName" maxlength="' + Store.AUTHOR_MAX + '" value="' + esc(au.name) + '" autocomplete="name" placeholder="Ej.: Ana Pérez, ingeniera forestal"></label>' +
        '<label class="f"><span>Entidad o empresa (opcional)</span><input type="text" id="auOrg" maxlength="' + Store.AUTHOR_MAX + '" value="' + esc(au.org) + '" autocomplete="organization" placeholder="Ej.: Finca La Esperanza"></label>' +
        '<label class="f"><span>Tarjeta profesional (opcional)</span><input type="text" id="auCard" maxlength="' + Store.CARD_MAX + '" value="' + esc(au.card) + '" autocomplete="off" placeholder="Número de tu tarjeta profesional"></label>' +
        '<div class="f f-logo"><span class="f-label">Logo (opcional)</span><div class="logobox" id="auLogo">' + (au.logo ? '<img src="data:image/jpeg;base64,' + au.logo + '" alt="Logo elegido">' : '<span class="small muted">Sin logo</span>') + '</div>' +
        '<div class="btns"><button class="btn" data-act="authorLogo">' + (au.logo ? 'Cambiar logo' : 'Elegir logo') + '</button>' + (au.logo ? '<button class="btn" data-act="authorLogoDel">Quitar logo</button>' : '') + '</div>' +
        '<span class="f-hint">Se recortan los bordes de un solo color, se reduce a 400 píxeles y se guarda como JPEG (lo transparente queda blanco).</span></div>' +
        '<div class="f f-logo f-sign"><span class="f-label">Firma (opcional)</span><div class="logobox signbox" id="auSign">' + (au.sign ? '<img src="data:image/jpeg;base64,' + au.sign + '" alt="Firma elegida">' : '<span class="small muted">Sin firma</span>') + '</div>' +
        '<div class="btns"><button class="btn" data-act="authorSignPhoto">' + (au.sign ? 'Otra foto' : 'Subir foto') + '</button><button class="btn" data-act="authorSignDraw">Dibujar</button>' + (au.sign ? '<button class="btn" data-act="authorSignDel">Quitar firma</button>' : '') + '</div>' +
        '<span class="f-hint">Foto: firma en papel blanco con tinta oscura y tómale la foto de cerca, que el papel llene la foto, con buena luz y sin sombras; la app deja el fondo blanco y recorta los bordes. O dibújala con el dedo. Es una imagen, no una firma digital certificada, y el reporte lo dice.</span></div>' +
        '<div class="btns"><button class="btn btn-primary" data-act="authorSave">Guardar</button></div>';
    }
    function openAuthor(keep) {
      if (!keep) ui.authorDraft = Store.loadAuthor();
      openSheet('Encabezado del reporte', authorBody());
    }
    function readAuthorInputs() {
      var n = $('#auName'), o = $('#auOrg'), t = $('#auCard');
      if (n) ui.authorDraft.name = n.value;
      if (o) ui.authorDraft.org = o.value;
      if (t) ui.authorDraft.card = t.value;
    }
    function refreshAuthor() {          // vuelve a dibujar la hoja sin perder lo escrito
      readAuthorInputs();
      var body = $('#sheet .sheet-body');
      if (body) body.innerHTML = authorBody();
    }
    function setAuthorLogo(file) {
      if (!ui.authorDraft) return;
      Fotos.shrink(file, { max: 400, quality: 0.86, trim: true }).then(function (r) {
        var b64 = Fotos.toBase64(r.bytes);
        if (b64.length > Store.LOGO_MAX) throw new Error('El logo sigue siendo muy pesado; prueba con una imagen más sencilla.');
        ui.authorDraft.logo = b64;
        refreshAuthor();
        if (r.trimmed) toast('Se recortaron los bordes lisos del logo.');
      }).catch(function (e) { toast('No se pudo usar esa imagen: ' + (e && e.message || e), { err: true }); });
    }
    // Firma en foto (2.34.3): papel blanco y tinta oscura (Fotos.inkLevels), bordes recortados y a 600 píxeles como mucho
    function setAuthorSign(file) {
      if (!ui.authorDraft) return;
      Fotos.shrink(file, { max: 600, quality: 0.9, trim: true, ink: true }).then(function (r) {
        var b64 = Fotos.toBase64(r.bytes);
        if (b64.length > Store.SIGN_MAX) throw new Error('La firma sigue siendo muy pesada; prueba con una foto más de cerca.');
        ui.authorDraft.sign = b64;
        refreshAuthor();
      }).catch(function (e) { toast('No se pudo usar esa imagen: ' + (e && e.message || e), { err: true }); });
    }
    // Firma dibujada con el dedo (2.34.3): otra hoja con el recuadro; «Usar esta firma» o «Cancelar» vuelven al encabezado sin perder lo escrito
    function openSignPad() {
      if (!ui.authorDraft) return;
      readAuthorInputs();
      openSheet('Dibujar la firma', '<p class="lead">Firma con el dedo dentro del recuadro, como en papel. Si no queda bien, «Borrar» y otra vez.</p>' +
        '<canvas class="signpad" id="signPad" role="img" aria-label="Recuadro para firmar con el dedo"></canvas>' +
        '<div class="btns"><button class="btn" data-act="signPadClear">Borrar</button><button class="btn" data-act="signPadBack">Cancelar</button><button class="btn btn-primary" data-act="signPadUse" id="signUse" disabled>Usar esta firma</button></div>');
      var c = $('#signPad');
      ui.signPad = c && Firma ? Firma.pad(c, function (empty) { var b = $('#signUse'); if (b) b.disabled = empty; }) : null;
    }
    function useSignPad() {
      var p = ui.signPad;
      if (!p || !ui.authorDraft) return;
      p.toJpeg(document).then(function (bytes) {
        var b64 = Fotos.toBase64(bytes);
        if (b64.length > Store.SIGN_MAX) throw new Error('La firma quedó muy pesada.');
        ui.authorDraft.sign = b64; ui.signPad = null;
        openAuthor(true);
      }).catch(function (e) { toast(e && e.message || String(e), { err: true }); });
    }
    function closeSignPad() { ui.signPad = null; openAuthor(true); }
    function saveAuthor() {
      readAuthorInputs();
      var r = Store.saveAuthor(ui.authorDraft);
      if (!r.ok) { toast(r.error, { err: true }); return; }
      closeSheet();
      toast('Encabezado del reporte guardado.');
      if (ui.tab === 'herramientas') renderTab('herramientas');
    }

    /* 2.34.5: los dos métodos para promediar el GPS, juntos en un recuadro y cada uno con su explicación; se elige uno y
     * viene elegido el ponderado. Se guarda en la misma preferencia de la 2.34.2 (gpsSimple: true = el método anterior),
     * así quien ya había elegido el anterior lo sigue teniendo. */
    function gpsMethodGroup() {
      var simple = Store.loadFlag('gpsSimple') === true;
      function opt(v, on, title, sub) {
        return '<label class="menurow"><span><b>' + title + '</b><small>' + sub + '</small></span>' +
          '<input type="radio" name="gpsMetodo" data-flag-radio="gpsSimple" value="' + v + '"' + (on ? ' checked' : '') + '></label>';
      }
      return '<div class="menu menu-sub" role="radiogroup" aria-labelledby="gpsMetT"><div class="menuhead" id="gpsMetT"><b>Promedio del GPS al marcar un punto</b><small>Elige uno. Los puntos ya guardados no cambian.</small></div>' +
        opt('1', simple, 'Promedio simple (método anterior)', 'Todas las lecturas pesan igual. El punto guarda la precisión de la mejor lectura, que suele prometer más de lo real.') +
        opt('0', !simple, 'Promedio ponderado (recomendado)', 'Las lecturas más precisas pesan más (cada una pesa 1 ÷ precisión²). El punto guarda la precisión promedio de las lecturas. Viene elegido.') + '</div>';
    }
    /* 2.35.0: el margen que decide si la clase de pendiente del IGAC sale firme o incierta. Dos opciones, cada una con lo que
     * quiere decir su porcentaje; la persona elige la que más se ajusta a su necesidad. Viene 95 % (pendiente68 sin marcar). */
    function slopeMarginGroup() {
      var m68 = Store.loadFlag('pendiente68') === true;
      function opt(v, on, title, sub) {
        return '<label class="menurow"><span><b>' + title + '</b><small>' + sub + '</small></span>' +
          '<input type="radio" name="pendMargen" data-flag-radio="pendiente68" value="' + v + '"' + (on ? ' checked' : '') + '></label>';
      }
      return '<div class="menu menu-sub" role="radiogroup" aria-labelledby="pendMarT"><div class="menuhead" id="pendMarT"><b>Margen de la pendiente</b><small>Decide cuándo la clase de pendiente del IGAC sale firme o incierta. Elige el que más se ajuste a tu necesidad.</small></div>' +
        opt('1', m68, '68 % (una desviación)', '68 % quiere decir que la pendiente real cae dentro del margen dos de cada tres veces. El margen es más angosto: menos lotes salen inciertos, pero una clase firme es menos segura.') +
        opt('0', !m68, '95 % (dos desviaciones, recomendado)', '95 % quiere decir que la pendiente real cae dentro del margen 19 de cada 20 veces. El margen es el doble de ancho: más lotes piden la medida en campo, pero una clase firme es muy confiable. Viene elegido.') + '</div>';
    }
    function menuRow(act, title, sub) {
      return '<button class="menurow" data-act="' + act + '"><span><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><i aria-hidden="true">›</i></button>';
    }

    /* ---------- Las tres herramientas: conversor, GPS en vivo y clima actual ---------- */
    // Conversor: se escribe un valor en una unidad y se ven todas las demás a la vez. Lo escrito y la unidad se recuerdan mientras la app está abierta.
    function openConverter(catId) {
      var cat = Units.category(catId);
      if (!cat) return;
      var m = ui.convMem[catId] || (ui.convMem[catId] = { unit: cat.def, text: '1' });
      var opts = cat.units.map(function (u) { return '<option value="' + u.id + '"' + (u.id === m.unit ? ' selected' : '') + '>' + esc(u.name + ' (' + u.sym + ')') + '</option>'; }).join('');
      openSheet(cat.name, '<label class="f"><span>Valor</span><input type="text" inputmode="decimal" id="cvVal" data-conv="val" value="' + esc(m.text) + '" autocomplete="off"></label>' +
        '<label class="f"><span>Está en</span><select id="cvUnit" data-conv="unit">' + opts + '</select></label>' +
        '<div id="cvRes" aria-live="polite"></div><p class="small muted">Toca un resultado para copiarlo. El punto o la coma sirven como decimal (1,5 o 1.5). Funciona sin internet.</p>',
        function () { ui.conv = catId; renderConverter(); setTimeout(function () { var i = $('#cvVal'); if (i) { i.focus(); i.select(); } }, 80); });
    }
    function renderConverter() {
      var el = $('#cvRes'), cat = Units.category(ui.conv), m = ui.conv && ui.convMem[ui.conv];
      if (!el || !cat || !m) return;
      var v = Units.parse(m.text), r;
      if (v === null) r = { ok: false, error: m.text.trim() ? 'No se entiende ese número. Escríbelo así: 1234,5' : 'Escribe un número para convertir.' };
      else r = Units.convert(cat.id, v, m.unit);
      if (!r.ok) { el.innerHTML = '<div class="tip">' + esc(r.error) + '</div>'; return; }
      el.innerHTML = '<div class="cvlist">' + r.rows.map(function (x) {
        return '<button class="cvrow' + (x.id === m.unit ? ' cvfrom' : '') + '" data-act="cvCopy" data-t="' + esc(x.text + ' ' + x.sym) + '"><span class="cvn">' + esc(x.name) + '</span><b>' + esc(x.text) + ' <small>' + esc(x.sym) + '</small></b></button>';
      }).join('') + '</div>';
    }

    // GPS en vivo: coordenadas, altitud y precisión. Los números se cambian en su sitio (sin volver a dibujar los botones) para que un toque no se pierda.
    function openGpsTool() {
      openSheet('GPS', '<div id="toolBody"></div>', function () { ui.tool = 'gps'; ui.toolGpsKind = ''; renderGpsTool(); });
    }
    function gpsToolKind() { return !ui.gpsOn ? 'off' : ui.fix ? 'fix' : 'search'; }
    function fillGpsNumbers() {
      var f = ui.fix, set = function (id, t) { var e = $('#' + id); if (e) e.innerHTML = t; };
      if (!f) return;
      set('tgLat', Fmt.coord(f.lat) + '°'); set('tgLon', Fmt.coord(f.lon) + '°');
      set('tgAlt', isNum(f.alt) ? Fmt.num(f.alt, 0) + ' <small>m</small>' : '<small>sin dato</small>');
      set('tgAcc', isNum(f.acc) ? '±' + Fmt.num(f.acc, 0) + ' <small>m</small>' : '—');
      var pl = Fmt.plana(f.lat, f.lon);
      set('tgDms', esc(Fmt.dms(f.lat, f.lon)) + (pl ? '<br><span id="tgPlana">Planas (Origen Nacional): ' + esc(pl) + '</span>' : ''));
    }
    function renderGpsTool() {
      var el = $('#toolBody');
      if (!el || ui.tool !== 'gps') return;
      var kind = gpsToolKind();
      if (kind === ui.toolGpsKind) { if (kind === 'fix') fillGpsNumbers(); return; }   // misma pantalla: solo cambian los números
      ui.toolGpsKind = kind;
      var h = '';
      if (kind === 'off') h = '<div class="tip">El GPS está apagado. Enciéndelo para ver dónde estás.</div><div class="btns"><button class="btn btn-primary" data-act="toolGpsOn">Encender GPS</button></div>';
      else if (kind === 'search') h = '<div class="tip">Buscando señal… sal a un lugar abierto y espera unos segundos.</div><div class="btns"><button class="btn" data-act="toolGpsOff">Apagar GPS</button></div>';
      else {
        h = '<div class="readout"><div><span class="k">Latitud</span><span class="v" id="tgLat"></span></div><div><span class="k">Longitud</span><span class="v" id="tgLon"></span></div>' +
          '<div><span class="k">Altitud</span><span class="v" id="tgAlt"></span></div><div><span class="k">Precisión</span><span class="v" id="tgAcc"></span></div></div>' +
          '<p class="small muted" id="tgDms" style="margin:8px 0 0"></p>' +
          '<div class="btns" style="margin-top:12px"><button class="btn btn-primary" data-act="toolGpsCopy">Copiar coordenadas</button><button class="btn" data-act="toolGpsOff">Apagar GPS</button></div>' +
          '<p class="small muted" style="margin-top:12px">La altitud del GPS suele errar entre 10 y 30 m; la precisión es el error probable de la posición. El GPS sigue encendido hasta que lo apagues aquí o en Puntos.</p>';
      }
      el.innerHTML = h;
      if (kind === 'fix') fillGpsNumbers();
    }

    // Clima actual donde estás (Open-Meteo): usa la posición del GPS o, si prefieres, el centro de los puntos del proyecto. No se guarda en el proyecto.
    function openWeatherTool() {
      var token = ++ui.wxToken;
      openSheet('Clima actual', '<div id="toolBody"></div>', function () {
        ui.tool = 'clima'; ui.wx = { token: token, busy: false, error: '', data: null, from: null, wait: false };
        if (navigator.onLine !== false && ui.gpsOn && ui.fix) weatherFetch('gps'); else renderWeatherTool();
      });
    }
    function weatherSource(kind) {
      if (kind === 'gps') return ui.gpsOn && ui.fix ? { kind: 'gps', lat: ui.fix.lat, lon: ui.fix.lon, acc: ui.fix.acc } : null;
      var a = analysis();
      return a.empty ? null : { kind: 'center', lat: a.center.lat, lon: a.center.lon };
    }
    function weatherFetch(kind) {
      var w = ui.wx, src = weatherSource(kind);
      if (!w || w.busy || !src) return;
      if (navigator.onLine === false) { toast('Sin conexión. El clima actual se consulta con internet.', { err: true }); renderWeatherTool(); return; }
      w.busy = true; w.error = ''; w.wait = false; w.from = src; renderWeatherTool();
      Climate.fetchCurrent(src.lat, src.lon, null, {}).then(function (r) {
        if (ui.wx !== w) return;                                                    // se cerró o se abrió otra vez mientras llegaba
        w.busy = false;
        if (r.ok) w.data = Object.assign({ lat: src.lat, lon: src.lon }, r.data); else w.error = r.error;
        renderWeatherTool();
      });
    }
    function renderWeatherTool() {
      var el = $('#toolBody'), w = ui.wx;
      if (!el || ui.tool !== 'clima' || !w) return;
      var rows = Report.currentRows(w.data), h = '', hasFix = ui.gpsOn && ui.fix, a = analysis();
      if (navigator.onLine === false) h += '<div class="tip">Sin conexión. El clima actual se consulta con internet.</div>';
      if (w.busy) h += '<p class="muted">Consultando el clima…</p>';
      else if (w.wait) h += '<p class="muted">Buscando tu posición con el GPS…</p>';
      if (w.error) h += '<div class="warn">No se pudo consultar el clima actual: ' + esc(w.error) + '. Revisa la conexión a internet e inténtalo otra vez.</div>';
      if (rows.length) {
        h += '<div class="nowcard"><p class="nowname">' + (w.from && w.from.kind === 'gps' ? 'Tu posición' : esc(proj().name)) + '</p><p class="small muted">' + esc(Fmt.latlon(w.data.lat, w.data.lon)) +
          (w.from && w.from.kind === 'gps' && isNum(w.from.acc) ? ' · GPS ±' + esc(Fmt.num(w.from.acc, 0)) + ' m' : w.from && w.from.kind === 'center' ? ' · centro de los puntos' : '') + '</p>';
        if (isNum(w.data.T)) h += '<p class="nowtemp">' + esc(Fmt.num(w.data.T, 1)) + ' °C</p>';
        h += '<dl class="kv">';
        rows.forEach(function (x) { if (x[0] !== 'Temperatura') h += '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; });
        h += '</dl><p class="small muted">' + esc(Report.currentStamp(w.data)) + '</p></div>';
      }
      var busy = w.busy || w.wait, off = navigator.onLine === false;
      h += '<div class="btns">';
      h += '<button class="btn' + (rows.length ? '' : ' btn-primary') + '" data-act="toolWxGps"' + (busy || off ? ' disabled' : '') + '>' + (rows.length && w.from && w.from.kind === 'gps' ? 'Actualizar' : hasFix ? 'Usar mi posición' : 'Usar mi GPS') + '</button>';
      if (!a.empty) h += '<button class="btn" data-act="toolWxCenter"' + (busy || off ? ' disabled' : '') + '>Usar el centro de mis puntos</button>';
      h += '</div><p class="small muted" style="margin-top:12px">Son las condiciones de este momento en el lugar elegido (Open-Meteo): no el promedio de varios años, no se guardan en el proyecto y no cambian la zona de vida. Para incluirlas en el reporte usa «Consultar clima actual» en la pestaña Reporte.</p>';
      el.innerHTML = h;
    }
    // Llegó una lectura del GPS: se refresca la herramienta abierta y, si el clima esperaba la posición, se consulta
    function onToolFix() {
      if (ui.tool === 'gps') renderGpsTool();
      else if (ui.tool === 'clima' && ui.wx && ui.wx.wait && ui.fix) weatherFetch('gps');
      else if (ui.tool === 'clima') renderWeatherTool();
    }

    return { openDiag: openDiag, shareDiag: shareDiag, clearDiag: clearDiag, tabHerramientas: tabHerramientas, openAuthor: openAuthor, readAuthorInputs: readAuthorInputs, refreshAuthor: refreshAuthor, saveAuthor: saveAuthor, setAuthorLogo: setAuthorLogo, setAuthorSign: setAuthorSign, openSignPad: openSignPad, useSignPad: useSignPad, closeSignPad: closeSignPad, onToolFix: onToolFix, openConverter: openConverter, openGpsTool: openGpsTool, openWeatherTool: openWeatherTool, renderConverter: renderConverter, renderGpsTool: renderGpsTool, renderWeatherTool: renderWeatherTool, weatherFetch: weatherFetch };
  };
})();

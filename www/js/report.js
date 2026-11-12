/* report.js — reporte de zona de vida: texto plano y página HTML autocontenida (con el diagrama). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fmt.js'), require('./geo.js'), require('./diagram.js'), require('./perfil.js'), require('./climate.js'), require('./predio.js'), require('./clasif.js'));
  else root.Report = factory(root.Fmt, root.Geo, root.Diagram, root.Perfil, root.Climate, root.Predio, root.Clasif);
})(typeof self !== 'undefined' ? self : this, function (Fmt, Geo, Diagram, Perfil, Climate, Predio, Clasif) {
  'use strict';

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  var SRC_T = { manual: 'ingresada por el usuario', online: 'de internet (NASA POWER, ajustada por altitud)', memoria: 'de datos guardados en el equipo', estimada: 'estimada con latitud y altitud' };
  var SRC_P = { manual: 'ingresada por el usuario', online: 'de internet (NASA POWER, rejilla de ~50 km)', memoria: 'de datos guardados en el equipo' };
  var QUALITY = {
    0: 'Incompleto: falta la precipitación.',
    1: 'Orientativa: la temperatura se estimó con latitud y altitud.',
    2: 'Aproximada: usa datos de internet o guardados, no medidos en el sitio.',
    3: 'Con datos ingresados por el usuario (su calidad depende de la fuente que usó).'
  };
  var DISCLAIMER = 'Clasificación bioclimática orientativa según el sistema de Holdridge. No reemplaza un estudio de campo ni datos de una estación meteorológica cercana.';

  // Filas de datos clave: [etiqueta, valor]
  function rows(project, a) {
    var out = [];
    var r = a.result, c = a.climate || {};
    if (a.alt && isNum(a.alt.value)) out.push(['Altitud', Fmt.num(a.alt.value, 0) + ' m (' + a.alt.srcLabel + (a.alt.n > 1 ? ', ' + a.alt.n + ' puntos' : '') + ')']);
    if (isNum(c.T)) out.push(['Temperatura media anual', Fmt.num(c.T, 1) + ' °C (' + (SRC_T[c.TSrc] || c.TSrc) + ')']);
    if (r && isNum(r.bt)) out.push(['Biotemperatura', Fmt.num(r.bt, 1) + ' °C']);
    if (isNum(c.P)) out.push(['Precipitación anual', Fmt.num(c.P, 0) + ' mm (' + (SRC_P[c.PSrc] || c.PSrc) + ')']);
    if (r && isNum(r.pet)) out.push(['Evapotranspiración potencial', Fmt.num(r.pet, 0) + ' mm/año']);
    if (r && isNum(r.per)) out.push(['Relación ETP / precipitación', Fmt.num(r.per, 2)]);
    return out;
  }

  // Clima actual consultado (Open-Meteo), como filas [etiqueta, valor]. Lo que falte o no sea un número no se escribe.
  function currentRows(w) {
    var out = [];
    if (!w || typeof w !== 'object') return out;
    if (isNum(w.T)) out.push(['Temperatura', Fmt.num(w.T, 1) + ' °C']);
    if (isNum(w.code)) out.push(['Condición', Climate.weatherText(w.code)]);
    if (isNum(w.wind)) out.push(['Viento', Fmt.num(w.wind, 1) + ' km/h']);
    if (isNum(w.pressure)) out.push(['Presión', Fmt.num(w.pressure, 0) + ' hPa']);
    if (isNum(w.humidity)) out.push(['Humedad', Fmt.num(w.humidity, 0) + ' %']);
    if (typeof w.sunrise === 'string' && w.sunrise) out.push(['Amanecer', w.sunrise]);
    if (typeof w.sunset === 'string' && w.sunset) out.push(['Atardecer', w.sunset]);
    return out;
  }
  var CURRENT_NOTE = 'Condiciones del momento de la consulta (no el promedio de varios años); no entran en el cálculo de la zona de vida.';
  // «Actualizado: 28 oct 2026, 14:03 · Open-Meteo»
  function currentStamp(w) { return 'Actualizado: ' + (isNum(w && w.at) ? Fmt.dateTime(w.at) : 'fecha desconocida') + ' · Open-Meteo'; }

  function text(project, a, o) {
    o = o || {};
    var L = [];
    L.push('REPORTE DE ZONA DE VIDA (HOLDRIDGE)');
    headLines(project, o).forEach(function (x) { L.push(x); });
    L.push('');
    var r = a.result;
    if (r && r.ok) {
      L.push('Zona de vida: ' + r.zone.name + ' (' + r.zone.symbol + ')');
      L.push('Región latitudinal: ' + r.region);
      L.push('Piso altitudinal: ' + r.belt);
      if (r.humidity) L.push('Provincia de humedad: ' + r.humidity.name);
    } else if (r && r.partial) {
      L.push('Resultado incompleto: falta la precipitación anual.');
      L.push('Región latitudinal: ' + r.region + ' · Piso altitudinal: ' + r.belt);
    } else {
      L.push('Resultado incompleto: falta la altitud o la temperatura.');
    }
    L.push('');
    rows(project, a).forEach(function (x) { L.push(x[0] + ': ' + x[1]); });
    if (a.area) { L.push('Área: ' + Fmt.area(a.area, 'ha') + ' = ' + Fmt.area(a.area, 'm2') + ' = ' + Fmt.area(a.area, 'fanegadas')); }
    if (a.n >= 2) L.push('Perímetro: ' + Fmt.dist(a.perimeter));
    if (a.center) L.push('Centro: ' + Fmt.latlon(a.center.lat, a.center.lon) + withPlana(a.center));
    var pf = Perfil.build(project.points);
    if (pf.ok) L.push('Desnivel entre puntos: ' + Fmt.num(pf.relief, 0) + ' m (más alto ' + pf.high.name + ', ' + Fmt.num(pf.high.alt, 0) + ' m; más bajo ' + pf.low.name + ', ' + Fmt.num(pf.low.alt, 0) + ' m)');
    if (a.alternatives && a.alternatives.length) {
      L.push('');
      L.push('Con el margen de error de los datos también podría ser: ' + a.alternatives.map(function (z) { return z.name + ' (' + z.symbol + ')'; }).join('; '));
    }
    if (a.vertexZones && a.vertexZones.length && a.distinctZones && a.distinctZones.length > 1) {
      L.push('');
      L.push('Por altitud de cada punto:');
      a.vertexZones.forEach(function (v) { L.push('  ' + v.name + ' (' + Fmt.num(v.alt, 0) + ' m): ' + v.zone + ' (' + v.symbol + ')'); });
    }
    if (o.walter && o.walter.lines && o.walter.lines.length) {
      L.push('');
      L.push('Diagrama de Walter-Lieth (datos mensuales):');
      o.walter.lines.forEach(function (x) { L.push('  ' + x); });
    }
    var cur = skips(o, 'actual') ? [] : currentRows(project.weatherNow);
    if (cur.length) {
      L.push('');
      L.push('Clima actual (' + currentStamp(project.weatherNow) + '):');
      cur.forEach(function (x) { L.push('  ' + x[0] + ': ' + x[1]); });
      L.push('  ' + CURRENT_NOTE);
    }
    L.push('');
    L.push('Puntos:');
    project.points.forEach(function (p, i) {
      var nf = Array.isArray(p.photos) ? p.photos.length : 0;
      L.push('  ' + (p.name || 'P' + (i + 1)) + ': ' + Fmt.latlon(p.lat, p.lon) + (isNum(p.alt) ? ', ' + Fmt.num(p.alt, 0) + ' m' : '') + withPlana(p) + (nf ? ' · ' + nf + (nf === 1 ? ' foto' : ' fotos') : ''));
    });
    if (project.layers && project.layers.length) {
      L.push('');
      L.push('Capas importadas (no cuentan para el área ni la zona de vida):');
      project.layers.forEach(function (l) { L.push('  ' + l.name + ': ' + l.points.length + (l.points.length === 1 ? ' punto' : ' puntos') + (l.file ? ' (' + l.file + ')' : '')); });
    }
    var cr = skips(o, 'clasif') ? [] : clasifRows(a);
    if (cr.length) { L.push(''); L.push('Otras clasificaciones del clima:'); cr.forEach(function (x) { L.push('  ' + x[0] + ': ' + x[1]); }); }
    if (a.quality !== undefined) { L.push(''); L.push('Calidad de los datos: ' + QUALITY[a.quality]); }
    (a.warnings || []).forEach(function (w) { L.push('Aviso: ' + w); });
    (a.info || []).forEach(function (w) { L.push('Nota: ' + w); });
    L.push('');
    L.push(DISCLAIMER);
    return L.join('\n');
  }

  var CSS = 'body{font:16px/1.5 system-ui,-apple-system,Roboto,Segoe UI,sans-serif;color:#14301F;background:#fff;margin:0;padding:24px;max-width:1180px;margin-inline:auto}' +
    '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:0 0 16px}.head h1{margin:0 0 6px}.sub.hl{margin:0}.logo{display:block;flex:none;max-width:180px;max-height:100px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;border-bottom:2px solid #2F8F4E;padding-bottom:4px}.sub{color:#5B6F61;margin:0 0 16px}' +
    '.zone{display:flex;gap:16px;align-items:center;margin:12px 0}.hex{width:92px;height:104px;flex:none}.zn{font-size:24px;font-weight:700;line-height:1.2}.zs{color:#5B6F61}' +
    'table{border-collapse:collapse;width:100%;max-width:760px}td,th{padding:6px 10px;border-bottom:1px solid #D6DED8;text-align:left;vertical-align:top}th{color:#5B6F61;font-weight:500;width:42%}' +
    '.note{background:#F2F5EF;border-left:4px solid #D8353C;padding:8px 12px;margin:8px 0}.small{color:#5B6F61;font-size:14px}svg{max-width:100%;height:auto}' +
    '.dot{display:inline-block;width:.75em;height:.75em;border-radius:50%;margin-right:.5em;border:1px solid rgba(0,0,0,.35);-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.gal{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 14px}.gal figure{margin:0;width:260px;max-width:100%;break-inside:avoid}.gal img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #D6DED8}.gal figcaption{font-size:13px;color:#5B6F61}h3.ptitle{font-size:16px;margin:14px 0 4px}' +
    '.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:14px}table.sum th{width:auto;font-weight:600}table.sum td:first-child{font-weight:600}table.sum .tot td{font-weight:700;border-top:2px solid #14301F}h1.lt{margin:36px 0 10px;padding-top:14px;border-top:3px solid #14301F}@media (max-width:480px){.logo{max-width:96px;max-height:72px}}@media print{body{padding:0}h2{break-after:avoid}.diag{break-before:page}}';

  // Punto de color delante del nombre: el color propio del punto (su ficha) o el de los puntos del proyecto
  // Coordenadas planas (Origen Nacional) de un punto, para añadir a su línea; '' fuera de Colombia
  function withPlana(p) { var s = p ? Fmt.plana(p.lat, p.lon) : ''; return s ? ' · ' + s : ''; }
  function planaHtml(p) { var s = p ? Fmt.plana(p.lat, p.lon) : ''; return s ? '<br><span class="small">' + esc(s) + '</span>' : ''; }
  function anyPlana(project, a) {
    return !!((a && a.center && Fmt.plana(a.center.lat, a.center.lon)) || (project.points || []).some(function (p) { return !!Fmt.plana(p.lat, p.lon); }));
  }
  // Autor del reporte (o.author = { name, org, logo }): la línea «Elaborado por …» y el logo en base64; vacíos si no hay
  function authorOf(o) {
    var a = o && o.author || {}, name = typeof a.name === 'string' ? a.name.trim() : '', org = typeof a.org === 'string' ? a.org.trim() : '';
    var logo = typeof a.logo === 'string' && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(a.logo) ? a.logo : '';
    var who = [name, org].filter(Boolean).join(' · ');
    return { name: name, org: org, logo: logo, line: who ? 'Elaborado por: ' + who : '' };
  }
  // Las líneas del encabezado, en orden: proyecto, quién lo elabora y fecha (2.14.1)
  function headLines(project, o) {
    var name = typeof project.name === 'string' || typeof project.name === 'number' ? String(project.name).trim() : '';
    var L = name ? ['Proyecto: ' + name] : [], au = authorOf(o);
    var lote = typeof project.lotName === 'string' ? project.lotName.trim() : '';
    if (lote) L.push(lotTitle(project));
    if (au.line) L.push(au.line);
    L.push('Fecha: ' + Fmt.date(o && o.date || Date.now()));
    return L;
  }
  /* ---------- Reporte de todo el proyecto (2.15.0): resumen de los lotes y luego el reporte de cada uno ---------- */
  // parts: [{ project (el lote como proyecto: name, lotName, points, layers, mainColor…), a, o }]
  var HEX = /^#[0-9a-fA-F]{6}$/;
  // «Finca», «Potrero · en «La Esperanza»» … o '' si es un lote de los de siempre (2.17.0)
  function kindText(project) {
    var m = project && project.lotMeta;
    if (!m || !m.kind) return '';
    return m.kind === 'finca' ? 'Finca' : (m.cat || 'Área') + (m.parentName ? ' · en «' + m.parentName + '»' : '');
  }
  // Título de un polígono en el reporte: «Lote: X», «Finca: X» o «Potrero: X (en «Finca»)»
  function lotTitle(project) {
    var m = project.lotMeta || {}, name = project.lotName || project.name;
    return (m.kind === 'finca' ? 'Finca' : m.kind === 'area' ? (m.cat || 'Área') : 'Lote') + ': ' + name + (m.kind === 'area' && m.parentName ? ' (en «' + m.parentName + '»)' : '');
  }
  function summary(parts) {
    parts = parts || [];
    var rows = [], zones = {};
    // los mismos datos que usa la app para no contar dos veces un área que está dentro de su finca
    var lots = parts.map(function (pt, i) {
      var m = pt.project.lotMeta || {};
      return { id: m.id || 'p' + i, name: pt.project.lotName || pt.project.name, kind: m.kind || undefined, cat: m.cat || undefined, parent: m.parent || undefined, points: pt.project.points || [] };
    });
    var acc = Predio.account(lots), kinds = lots.some(function (l) { return !!l.kind; });
    parts.forEach(function (pt, i) {
      var a = pt.a, r = a.result, m2 = a.area ? a.area.m2 : 0, row = acc.rows[i];
      if (r && r.ok) zones[r.zone.symbol] = r.zone.name;
      rows.push({ name: pt.project.lotName || pt.project.name, color: HEX.test(pt.project.mainColor || '') ? pt.project.mainColor : '#2F8F4E', n: a.n || 0,
        tipo: kindText(pt.project), dots: !!pt.project.dots,
        area: m2 > 0 ? Fmt.area(a.area, 'ha') + (row && row.pct !== null ? ' (' + Fmt.num(row.pct, 1) + ' % de la finca)' : '') : '—', alt: a.alt && isNum(a.alt.value) ? Fmt.num(a.alt.value, 0) + ' m' : '—',
        zone: r && r.ok ? r.zone.name + ' (' + r.zone.symbol + ')' : 'incompleto' });
    });
    var nz = Object.keys(zones).length, total = acc.total, closed = acc.closed, nClosed = lots.filter(function (l) { return l.points.length >= 3; }).length;
    var word = kinds ? ['polígono', 'polígonos'] : ['lote', 'lotes'];
    var fincas = acc.fincas.filter(function (f) { return f.m2 > 0; }).map(function (f) {
      return f.lot.name + ': ' + (f.n ? f.n + (f.n === 1 ? ' área' : ' áreas') + ', ' + Fmt.area(Geo.areaUnits(f.used), 'ha') + ' (' + Fmt.num(f.used / f.m2 * 100, 1) + ' %) · sin asignar ' + Fmt.area(Geo.areaUnits(f.free), 'ha') : 'sin áreas');
    });
    return { rows: rows, total: total, closed: closed, zones: nz, overlap: Predio.warnings(lots).join(' '), kinds: kinds, fincas: fincas,
      totalText: (closed ? Fmt.area(Geo.areaUnits(total), 'ha') + ' · ' + Fmt.area(Geo.areaUnits(total), 'fanegadas') : '—'),
      note: rows.length + ' ' + word[rows.length === 1 ? 0 : 1] + (nClosed < rows.length ? ' (' + nClosed + ' con polígono cerrado)' : '') + ' · ' + nz + (nz === 1 ? ' zona de vida' : ' zonas de vida') +
        (kinds && closed < nClosed ? ' · las áreas que están dentro de una finca no se suman otra vez' : '') };
  }
  // Croquis general: todos los lotes en un solo dibujo, cada uno con su color. Devuelve { svg, items: [[color, nombre]…] } o null
  // si ningún lote tiene al menos 2 puntos. El primero con puntos va como figura principal y los demás como capas.
  function overview(parts) {
    var ok = (parts || []).filter(function (pt) { return pt && pt.project && (pt.project.points || []).length >= 1; });
    if (!ok.some(function (pt) { return pt.project.points.length >= 2; })) return null;
    function color(pt) { return HEX.test(pt.project.mainColor || '') ? pt.project.mainColor : '#2F8F4E'; }
    function name(pt) { return pt.project.lotName || pt.project.name || 'Lote'; }
    var main = ok[0], layers = ok.slice(1).map(function (pt) {
      var n = pt.project.points.length;
      return { name: name(pt), kind: n >= 3 ? 'polygon' : n === 2 ? 'line' : 'points', color: color(pt), visible: true, points: pt.project.points, dots: !!pt.project.dots };
    });
    return { svg: Diagram.polygonSVG(main.project.points, { width: 560, height: 380, layers: layers, color: color(main), dots: !!main.project.dots }),
      items: [[color(main), name(main)]].concat(layers.map(function (l) { return [l.color, l.name]; })) };
  }
  // Cada lote lleva sus propios dibujos: para que no choquen dentro de una misma página, se le cambia el nombre interno a cada uno
  function reid(html, sfx) {
    return html.replace(/\bid="([^"]+)"/g, 'id="$1' + sfx + '"').replace(/url\(#([^)]+)\)/g, 'url(#$1' + sfx + ')').replace(/href="#([^"]+)"/g, 'href="#$1' + sfx + '"');
  }
  function htmlAll(project, parts, o) {
    o = o || {};
    var s = summary(parts), h = docOpen(project.name) + headHtml({ name: project.name }, o);
    h += '<h2>Resumen del proyecto</h2><table class="sum"><tr><th>' + (s.kinds ? 'Polígono' : 'Lote') + '</th><th>Área</th><th>Altitud</th><th>Zona de vida</th></tr>';
    s.rows.forEach(function (x) { h += '<tr><td><span class="dot" style="background:' + x.color + '"></span>' + esc(x.name) + (x.tipo ? ' <span class="small">· ' + esc(x.tipo) + '</span>' : '') + '</td><td>' + esc(x.area) + '</td><td>' + esc(x.alt) + '</td><td>' + esc(x.zone) + '</td></tr>'; });
    h += '<tr class="tot"><td>Total</td><td>' + esc(s.totalText) + '</td><td colspan="2">' + esc(s.note) + '</td></tr></table>';
    s.fincas.forEach(function (f) { h += '<p class="small">' + esc(f) + '.</p>'; });
    if (s.overlap) h += '<p class="small"><b>Atención:</b> ' + esc(s.overlap) + '</p>';
    var ov = overview(parts);
    if (ov) h += '<h2>Croquis general</h2><div style="max-width:560px;margin-top:12px">' + reid(ov.svg, '-G') + '<div class="legend">' + ov.items.map(function (it) { return '<span><span class="dot" style="background:' + it[0] + '"></span>' + esc(it[1]) + '</span>'; }).join(' ') + '</div></div>';
    parts.forEach(function (pt, i) {
      h += '<section class="lote"><h1 class="lt">' + esc(lotTitle(pt.project)) + '</h1>' + reid(bodyHtml(pt.project, pt.a, pt.o), '-L' + (i + 1)) + '</section>';
    });
    return h + '<p class="small" style="margin-top:28px">' + esc(DISCLAIMER) + '</p></body></html>';
  }
  function textAll(project, parts, o) {
    var s = summary(parts), L = ['REPORTE DE ZONA DE VIDA (HOLDRIDGE)'];
    headLines({ name: project.name }, o).forEach(function (x) { L.push(x); });
    L.push(''); L.push('RESUMEN DEL PROYECTO');
    s.rows.forEach(function (x) { L.push('  ' + x.name + (x.tipo ? ' [' + x.tipo + ']' : '') + ': ' + x.area + ' · ' + x.alt + ' · ' + x.zone); });
    L.push('  Total: ' + s.totalText + ' · ' + s.note);
    s.fincas.forEach(function (f) { L.push('  ' + f + '.'); });
    if (s.overlap) L.push('  Atención: ' + s.overlap);
    parts.forEach(function (pt) {
      var t = text(pt.project, pt.a, pt.o).split('\n');
      L.push(''); L.push('———  LOTE: ' + (pt.project.lotName || pt.project.name) + '  ———');
      var from = t.indexOf('');                         // sin el título ni el encabezado, que ya van arriba
      L = L.concat(t.slice(from + 1, t.length - 2));    // ni la advertencia final, que va una sola vez
    });
    L.push(''); L.push(DISCLAIMER);
    return L.join('\n');
  }

  function dot(p, project) {
    var c = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : /^#[0-9a-fA-F]{6}$/.test(project.mainColor || '') ? project.mainColor : '#2F8F4E';
    return '<span class="dot" style="background:' + c + '"></span>';
  }

  function hexBadge(sym) {
    return '<svg class="hex" viewBox="0 0 92 104" role="img" aria-label="' + esc(sym) + '"><polygon points="46,2 90,27 90,77 46,102 2,77 2,27" fill="rgba(47,143,78,.18)" stroke="#2F8F4E" stroke-width="4"/>' +
      '<text x="46" y="60" text-anchor="middle" font-size="26" font-weight="700" fill="#14301F" font-family="system-ui,sans-serif">' + esc(sym) + '</text></svg>';
  }

  // Croquis con imagen de fondo (satelital o topográfico). d = { svg, caption } si se pudo preparar, { unavailable: 'motivo' } si no, o nada si no se pidió
  function sketchHtml(title, noun, d) {
    if (!d) return '';
    var h = '<h2>' + title + '</h2>';
    if (d.svg) return h + '<div style="max-width:760px">' + d.svg + '</div><p class="small">' + esc(d.caption || '') + '</p>';
    return h + '<div class="note">No se pudo preparar el ' + noun + (d.unavailable ? ': ' + esc(d.unavailable) : '.') + '</div>';
  }

  // Fotos de los puntos. o.photos = { id: 'data:image/jpeg;base64,…' } con las imágenes ya preparadas; la que falte no se dibuja.
  function photosHtml(project, o) {
    var map = o && o.photos;
    if (!map || typeof map !== 'object') return '';
    var h = '', any = false;
    project.points.forEach(function (p, i) {
      var name = p.name || 'P' + (i + 1);
      var list = (Array.isArray(p.photos) ? p.photos : []).filter(function (f) { return f && typeof map[f.id] === 'string' && map[f.id].indexOf('data:image/jpeg;base64,') === 0; });
      if (!list.length) return;
      if (!any) { h += '<h2>Fotos de los puntos</h2>'; any = true; }
      h += '<h3 class="ptitle">' + dot(p, project) + esc(name) + '</h3><div class="gal">';
      list.forEach(function (f, k) {
        h += '<figure><img src="' + esc(map[f.id]) + '" alt="Foto ' + (k + 1) + ' de ' + esc(name) + '"><figcaption>' + (k === 0 ? 'Principal' : 'Foto ' + (k + 1)) + '</figcaption></figure>';
      });
      h += '</div>';
    });
    return any ? h + '<p class="small">Fotos reducidas para este reporte. En el teléfono y en la copia de seguridad quedan con más calidad (hasta 1280 px).</p>' : '';
  }

  // Perfil del relieve con lo que está guardado en el proyecto (no consulta internet)
  function profileHtml(project) {
    var m = Perfil.build(project.points);
    var h = '<h2>Perfil del relieve</h2>';
    if (!m.ok) return h + '<div class="note">' + esc(m.reason) + '</div>';
    h += '<div style="max-width:700px">' + Perfil.svg(m, { color: project.mainColor, id: 'perfil-reporte' }) + '</div><table>';
    Perfil.rows(m).forEach(function (x) { h += '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; });
    h += '</table>';
    m.notes.forEach(function (n) { h += '<div class="note">' + esc(n) + '</div>'; });
    return h + '<p class="small">Altitud de cada punto contra la distancia acumulada entre ellos, en el orden de la lista y sin volver al primero. Se usaron las altitudes guardadas; no se consultó internet.</p>';
  }

  function docOpen(title) {
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte de zona de vida · ' + esc(title) + '</title><style>' + CSS + '</style></head><body>';
  }
  function headHtml(project, o) {
    var au = authorOf(o);
    var h = '<header class="head"><div><h1>Reporte de zona de vida</h1>' + headLines(project, o).map(function (x) { return '<p class="sub hl">' + esc(x) + '</p>'; }).join('') + '</div>';
    if (au.logo) h += '<img class="logo" src="data:image/jpeg;base64,' + au.logo + '" alt="Logo' + (au.org ? ' de ' + esc(au.org) : '') + '">';
    return h + '</header>';
  }
  // Todo lo que va debajo del encabezado: resultado, clima, terreno, puntos, croquis, perfil, fotos, calidad y diagramas
  /* ---------- Secciones que la persona puede dejar fuera del reporte (2.18.0) ----------
   * o.skip = { clave: true }. Lo esencial (zona de vida, datos del clima, terreno, puntos, croquis y calidad) va siempre. */
  var SECTIONS = [['clasif', 'Otras clasificaciones del clima'], ['actual', 'Clima actual'], ['fotos', 'Fotos de los puntos'], ['zonas', 'Zonas según la altitud de cada punto'],
    ['perfil', 'Perfil del relieve'], ['sat', 'Croquis satelital'], ['topo', 'Croquis topográfico'], ['walter', 'Diagrama de Walter-Lieth'], ['holdridge', 'Diagrama de Holdridge']];
  function skips(o, key) { return !!(o && o.skip && o.skip[key] === true); }
  function clasifRows(a) { return a && a.clasif ? Clasif.rows(a.clasif) : []; }
  function bodyHtml(project, a, o) {
    o = o || {};
    var r = a.result, h = '';
    if (r && r.ok) {
      h += '<div class="zone">' + hexBadge(r.zone.symbol) + '<div><div class="zn">' + esc(r.zone.name) + '</div><div class="zs">Región latitudinal: ' + esc(r.region) + ' · Piso altitudinal: ' + esc(r.belt) + (r.humidity ? ' · Provincia de humedad: ' + esc(r.humidity.name) : '') + '</div></div></div>';
    } else {
      h += '<div class="note">Resultado incompleto: ' + (r && r.partial ? 'falta la precipitación anual.' : 'falta la altitud o la temperatura.') + '</div>';
    }
    h += '<h2>Datos del clima</h2><table>';
    rows(project, a).forEach(function (x) { h += '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; });
    h += '</table>';
    if (a.alternatives && a.alternatives.length) {
      h += '<p class="small">Con el margen de error de los datos (±' + Fmt.num(a.margins.t, 1) + ' °C y ±' + Fmt.num(a.margins.p * 100, 0) + ' % en precipitación, supuestos) el punto también podría caer en: ' +
        a.alternatives.map(function (z) { return esc(z.name) + ' (' + esc(z.symbol) + ')'; }).join('; ') + '.</p>';
    }
    var cr = skips(o, 'clasif') ? [] : clasifRows(a);
    if (cr.length) {
      h += '<h2>Otras clasificaciones del clima</h2><table>';
      cr.forEach(function (x) { h += '<tr><th>' + esc(x[0]) + '</th><td><b>' + esc(x[1]) + '</b><br><span class="small">' + esc(x[2]) + '</span></td></tr>'; });
      h += '</table><p class="small">' + esc(Clasif.NOTE) + '</p>';
    }
    var cur = skips(o, 'actual') ? [] : currentRows(project.weatherNow);
    if (cur.length) {
      h += '<h2>Clima actual</h2><table>';
      cur.forEach(function (x) { h += '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; });
      h += '</table><p class="small">' + esc(currentStamp(project.weatherNow)) + '. ' + esc(CURRENT_NOTE) + '</p>';
    }
    if (a.n) {
      h += '<h2>Terreno</h2><table>';
      if (a.area) h += '<tr><th>Área</th><td>' + esc(Fmt.area(a.area, 'ha')) + ' · ' + esc(Fmt.area(a.area, 'm2')) + ' · ' + esc(Fmt.area(a.area, 'fanegadas')) + '</td></tr>';
      if (a.n >= 2) h += '<tr><th>Perímetro</th><td>' + esc(Fmt.dist(a.perimeter)) + '</td></tr>';
      h += '<tr><th>Centro</th><td>' + esc(Fmt.latlon(a.center.lat, a.center.lon)) + planaHtml(a.center) + '</td></tr></table>';
      h += '<h2>Puntos</h2><table>';
      project.points.forEach(function (p, i) {
        h += '<tr><th>' + dot(p, project) + esc(p.name || 'P' + (i + 1)) + '</th><td>' + esc(Fmt.latlon(p.lat, p.lon)) + (isNum(p.alt) ? ' · ' + esc(Fmt.num(p.alt, 0)) + ' m' : '') + planaHtml(p) + '</td></tr>';
      });
      h += '</table>' + (anyPlana(project, a) ? '<p class="small">' + esc(Fmt.PLANA_NOTE) + '</p>' : '');
      if (a.n >= 2) h += '<h2>Croquis</h2><div style="max-width:560px;margin-top:12px">' + Diagram.polygonSVG(project.points, { width: 560, height: 380, center: a.center, bad: a.selfIntersects, dots: !!project.dots, layers: project.layers, color: project.mainColor }) + Diagram.legendHTML(project.layers, project.mainColor, project.lotName || 'Mis puntos', true) + '</div>';
      if (a.n >= 2) h += (skips(o, 'sat') ? '' : sketchHtml('Croquis satelital', 'croquis satelital', o.satellite)) + (skips(o, 'topo') ? '' : sketchHtml('Croquis topográfico', 'croquis topográfico', o.topo)) + (skips(o, 'perfil') ? '' : profileHtml(project));
    }
    if (!skips(o, 'fotos')) h += photosHtml(project, o);
    if (!skips(o, 'zonas') && a.vertexZones && a.vertexZones.length && a.distinctZones && a.distinctZones.length > 1) {
      h += '<h2>Zonas según la altitud de cada punto</h2><table>';
      a.vertexZones.forEach(function (v) { h += '<tr><th>' + esc(v.name) + ' (' + esc(Fmt.num(v.alt, 0)) + ' m)</th><td>' + esc(v.zone) + ' (' + esc(v.symbol) + ')</td></tr>'; });
      h += '</table><p class="small">Se usa la misma precipitación para todos los puntos; la temperatura se ajusta con la altitud.</p>';
    }
    if (a.quality !== undefined || (a.warnings && a.warnings.length) || (a.info && a.info.length)) {
      h += '<h2>Calidad de los datos</h2>';
      if (a.quality !== undefined) h += '<p>' + esc(QUALITY[a.quality]) + '</p>';
      (a.warnings || []).forEach(function (w) { h += '<div class="note">' + esc(w) + '</div>'; });
      (a.info || []).forEach(function (w) { h += '<p class="small">' + esc(w) + '</p>'; });
      ((a.climate && a.climate.notes) || []).forEach(function (n) { h += '<p class="small">' + esc(n) + '</p>'; });
    }
    if (!skips(o, 'walter') && o.walter && o.walter.svg) {
      h += '<h2>Diagrama de Walter-Lieth</h2><div style="max-width:620px">' + o.walter.svg + '</div><ul>' +
        (o.walter.lines || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '<p class="small">' + esc(o.walter.source || '') + ' Mes seco: la lluvia mensual (mm) es menor que el doble de la temperatura media mensual (°C).</p>';
    }
    if (!skips(o, 'holdridge') && r && r.ok) {
      h += '<h2 class="diag">Diagrama de Holdridge</h2>' + Diagram.staticSVG({ hex: r.hex, point: r.point, vertices: (a.vertexZones || []).map(function (v) { return { point: v.point, name: v.name }; }), width: 1100 });
      h += '<p class="small">El anillo rojo marca la posición del punto de análisis; el hexágono resaltado es su zona de vida.</p>';
    }
    return h;
  }
  function html(project, a, o) {
    o = o || {};
    return docOpen(project.name) + headHtml(project, o) + bodyHtml(project, a, o) + '<p class="small" style="margin-top:28px">' + esc(DISCLAIMER) + '</p></body></html>';

  }

  return { CLASIF_NOTE: Clasif.NOTE, SECTIONS: SECTIONS, skips: skips, clasifRows: clasifRows, lotTitle: lotTitle, kindText: kindText, overview: overview, summary: summary, htmlAll: htmlAll, textAll: textAll, bodyHtml: bodyHtml, reid: reid, headLines: headLines, authorOf: authorOf, withPlana: withPlana, anyPlana: anyPlana, text: text, html: html, rows: rows, dot: dot, currentRows: currentRows, currentStamp: currentStamp, CURRENT_NOTE: CURRENT_NOTE, QUALITY: QUALITY, DISCLAIMER: DISCLAIMER, SRC_T: SRC_T, SRC_P: SRC_P };
});

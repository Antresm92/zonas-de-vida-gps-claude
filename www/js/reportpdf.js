/* reportpdf.js — el reporte de zona de vida en PDF (hoja A4).
 *
 * Tiene el mismo contenido y el mismo orden que el reporte HTML (Report.html), pero armado con bloques para pdf.js.
 * Las gráficas (croquis, perfil, Walter-Lieth, Holdridge, croquis satelital y topográfico) son SVG: la app las convierte a JPEG
 * con rasterize() antes de armar el PDF, porque un PDF sencillo no sabe dibujar SVG. Las fotos ya son JPEG.
 *   sketches(project, a, o)         → [{ key, svg }] qué gráficas hay que convertir
 *   build(project, a, o, images)    → bytes del PDF; images = { key: { bytes (JPEG) } }
 * o es lo mismo que recibe Report.html: { walter, satellite, topo, photos, date }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pdf.js'), require('./report.js'), require('./fmt.js'), require('./diagram.js'), require('./perfil.js'), require('./fotos.js'));
  else root.ReportPdf = factory(root.Pdf, root.Report, root.Fmt, root.Diagram, root.Perfil, root.Fotos);
})(typeof self !== 'undefined' ? self : this, function (Pdf, Report, Fmt, Diagram, Perfil, Fotos) {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var JPEG_URL = 'data:image/jpeg;base64,';

  // Ancho en píxeles con que se convierte cada gráfica (a 150 puntos por pulgada alcanza para una hoja A4)
  var PX = 1300;
  var PX_MAP = 1600, PX_BIG = 2800;                  // los mapas (fotografía) y el diagrama de Holdridge (letra muy chica) se convierten con más píxeles para poder acercarlos

  function pointColor(p, project) { return HEX.test(p.color || '') ? p.color : HEX.test(project.mainColor || '') ? project.mainColor : '#2F8F4E'; }

  /* ---------- Las gráficas que hay que convertir a imagen ---------- */
  function perfilModel(project) { return Perfil.build(project.points); }

  function sketches(project, a, o) {
    o = o || {};
    var out = [], r = a.result;
    if (a.n >= 2) {
      out.push({ key: 'croquis', svg: Diagram.polygonSVG(project.points, { width: 560, height: 380, center: a.center, bad: a.selfIntersects, dots: !!project.dots, layers: project.layers, color: project.mainColor, focus: true }) });
      if (!Report.skips(o, 'sat') && o.satellite && o.satellite.svg) out.push({ key: 'satelital', svg: o.satellite.svg, px: PX_MAP });
      if (!Report.skips(o, 'topo') && o.topo && o.topo.svg) out.push({ key: 'topo', svg: o.topo.svg, px: PX_MAP });
      var m = perfilModel(project);
      if (!Report.skips(o, 'perfil') && m.ok) out.push({ key: 'perfil', svg: Perfil.svg(m, { color: project.mainColor, id: 'perfil-reporte' }) });
    }
    if (!Report.skips(o, 'walter') && o.walter && o.walter.svg) out.push({ key: 'walter', svg: o.walter.svg });
    if (!Report.skips(o, 'holdridge') && r && r.ok) out.push({ key: 'holdridge', svg: Diagram.staticSVG({ hex: r.hex, point: r.point, vertices: (a.vertexZones || []).map(function (v) { return { point: v.point, name: v.name }; }), width: 1100 }), px: PX_BIG });
    return out;
  }

  /* ---------- De SVG a JPEG (en la app: usa el navegador) ---------- */
  // Tamaño natural de un SVG, de su viewBox; null si no lo tiene
  function svgSize(svg) {
    var tag = /<svg\b[^>]*>/.exec(String(svg || ''));
    if (!tag) return null;
    var vb = /\bviewBox\s*=\s*"\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(tag[0]);
    if (!vb) return null;
    var w = parseFloat(vb[3]), h = parseFloat(vb[4]);
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }
  // El mismo SVG con ancho y alto en píxeles (los que traía, como «100 %», no sirven para dibujarlo fuera de una página)
  function sized(svg, w, h) {
    return String(svg).replace(/<svg\b[^>]*>/, function (tag) {
      tag = tag.replace(/\s(width|height)\s*=\s*"[^"]*"/g, '');
      if (!/\sxmlns\s*=/.test(tag)) tag = tag.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      return tag.replace('<svg', '<svg width="' + w + '" height="' + h + '"');
    });
  }

  // svg → { bytes (JPEG), w, h }. env trae lo del navegador (Image, Blob, URL, document); las pruebas ponen uno de mentira.
  function rasterize(svg, px, env) {
    env = env || root;
    var size = svgSize(svg);
    if (!size) return Promise.reject(new Error('El gráfico no tiene tamaño.'));
    var w = Math.round(px || PX), h = Math.max(1, Math.round(w * size.h / size.w));
    return new Promise(function (resolve, reject) {
      var img = new env.Image(), url;
      function done() { try { env.URL.revokeObjectURL(url); } catch (e) { /* nada */ } }
      img.onload = function () {
        try {
          var canvas = env.document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Este dispositivo no puede preparar los gráficos.');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);            // JPEG no tiene transparencia: el fondo queda blanco
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) { done(); if (blob) resolve(blob); else reject(new Error('No se pudo preparar un gráfico del reporte.')); }, 'image/jpeg', 0.92);
        } catch (e) { done(); reject(e); }
      };
      img.onerror = function () { done(); reject(new Error('No se pudo dibujar un gráfico del reporte.')); };
      url = env.URL.createObjectURL(new env.Blob([sized(svg, w, h)], { type: 'image/svg+xml;charset=utf-8' }));
      img.src = url;
    }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
      var bytes = new Uint8Array(buf), info = Pdf.jpegInfo(bytes);
      if (!info) throw new Error('No se pudo preparar un gráfico del reporte.');
      return { bytes: bytes, w: info.w, h: info.h };
    });
  }

  // Convierte todas las gráficas; una que falle no tumba el reporte: queda sin imagen y el PDF dice que no se pudo dibujar
  function rasterizeAll(list, px, env) {
    var images = {};
    return Promise.all(list.map(function (s) {
      return rasterize(s.svg, s.px || px, env).then(function (img) { images[s.key] = img; }, function () { /* sin imagen */ });
    })).then(function () { return images; });
  }

  /* ---------- Los bloques del documento ---------- */
  function photoBytes(map, id) {
    var u = map && map[id];
    if (typeof u !== 'string' || u.indexOf(JPEG_URL) !== 0) return null;
    return Fotos.fromBase64(u.slice(JPEG_URL.length));
  }

  function blocks(project, a, o, images) {
    o = o || {}; images = images || {};
    var B = [], r = a.result;
    function pic(key, maxW, noun) {                           // una gráfica: su imagen, o el aviso de que no se pudo
      if (images[key] && images[key].bytes) B.push({ t: 'image', img: images[key], maxW: maxW });
      else B.push({ t: 'note', text: 'No se pudo dibujar ' + noun + ' en el PDF.' });
    }
    var au = Report.authorOf(o), logo = au.logo ? Fotos.fromBase64(au.logo) : null;
    if (!o.noHead) B.push({ t: 'head', title: 'Reporte de zona de vida', lines: Report.headLines(project, o), logo: logo ? { bytes: logo } : null, logoW: 130, logoH: 80 });
    if (r && r.ok) {
      B.push({ t: 'zone', symbol: r.zone.symbol, name: r.zone.name, detail: 'Región latitudinal: ' + r.region + ' · Piso altitudinal: ' + r.belt + (r.humidity ? ' · Provincia de humedad: ' + r.humidity.name : '') });
    } else {
      B.push({ t: 'note', text: 'Resultado incompleto: ' + (r && r.partial ? 'falta la precipitación anual.' : 'falta la altitud o la temperatura.') });
    }
    var rows = Report.rows(project, a);
    if (rows.length) { B.push({ t: 'h2', text: 'Datos del clima' }); B.push({ t: 'table', rows: rows }); }
    if (a.alternatives && a.alternatives.length) {
      B.push({ t: 'p', small: true, text: 'Con el margen de error de los datos (±' + Fmt.num(a.margins.t, 1) + ' °C y ±' + Fmt.num(a.margins.p * 100, 0) + ' % en precipitación, supuestos) el punto también podría caer en: ' +
        a.alternatives.map(function (z) { return z.name + ' (' + z.symbol + ')'; }).join('; ') + '.' });
    }
    var skip = function (k) { return Report.skips(o, k); };
    var cr = skip('clasif') ? [] : Report.clasifRows(a);
    if (cr.length) {
      B.push({ t: 'h2', text: 'Otras clasificaciones del clima' });
      B.push({ t: 'table', rows: cr.map(function (x) { return [x[0], x[1]]; }) });
      cr.forEach(function (x) { B.push({ t: 'p', small: true, text: x[0] + ': ' + x[2] }); });
      B.push({ t: 'p', small: true, text: Report.CLASIF_NOTE });
    }
    var cur = skip('actual') ? [] : Report.currentRows(project.weatherNow);
    if (cur.length) {
      B.push({ t: 'h2', text: 'Clima actual' });
      B.push({ t: 'table', rows: cur });
      B.push({ t: 'p', small: true, text: Report.currentStamp(project.weatherNow) + '. ' + Report.CURRENT_NOTE });
    }
    if (a.n) {
      var land = [];
      if (a.area) land.push(['Área', Fmt.area(a.area, 'ha') + ' · ' + Fmt.area(a.area, 'm2') + ' · ' + Fmt.area(a.area, 'fanegadas')]);
      if (a.n >= 2) land.push(['Perímetro', Fmt.dist(a.perimeter)]);
      land.push(['Centro', Fmt.latlon(a.center.lat, a.center.lon) + Report.withPlana(a.center)]);
      B.push({ t: 'h2', text: 'Terreno' }); B.push({ t: 'table', rows: land });
      B.push({ t: 'h2', text: 'Puntos' });
      B.push({ t: 'table', rows: project.points.map(function (p, i) { return [p.name || 'P' + (i + 1), Fmt.latlon(p.lat, p.lon) + (isNum(p.alt) ? ' · ' + Fmt.num(p.alt, 0) + ' m' : '') + Report.withPlana(p), pointColor(p, project)]; }) });
      if (Report.anyPlana(project, a)) B.push({ t: 'p', small: true, text: Fmt.PLANA_NOTE });
      if (a.n >= 2) {
        B.push({ t: 'h2', text: 'Croquis' });
        pic('croquis', 400, 'el croquis');
        var items = [[project.mainColor && HEX.test(project.mainColor) ? project.mainColor : '#2F8F4E', project.lotName || 'Mis puntos']];
        (project.layers || []).forEach(function (l) { if (l && l.visible !== false && l.points && l.points.length) items.push([l.color, l.name]); });
        if (items.length >= 2) B.push({ t: 'legend', items: items });
        [['Croquis satelital', 'croquis satelital', 'satelital', o.satellite], ['Croquis topográfico', 'croquis topográfico', 'topo', o.topo]].forEach(function (s) {
          var d = s[3];
          if (!d || skip(s[2] === 'satelital' ? 'sat' : 'topo')) return;
          B.push({ t: 'h2', text: s[0] });
          if (d.svg && images[s[2]] && images[s[2]].bytes) B.push({ t: 'image', img: images[s[2]], maxW: 470, caption: d.caption || '' });
          else if (d.svg) B.push({ t: 'note', text: 'No se pudo dibujar el ' + s[1] + ' en el PDF.' });
          else B.push({ t: 'note', text: 'No se pudo preparar el ' + s[1] + (d.unavailable ? ': ' + d.unavailable : '.') });
        });
        var m = perfilModel(project);
        if (skip('perfil')) m = null;
        if (m) B.push({ t: 'h2', text: 'Perfil del relieve' });
        if (!m) { /* sección quitada del reporte */ }
        else if (!m.ok) B.push({ t: 'note', text: m.reason });
        else {
          pic('perfil', 440, 'el perfil del relieve');
          B.push({ t: 'table', rows: Perfil.rows(m) });
          m.notes.forEach(function (n) { B.push({ t: 'note', text: n }); });
          B.push({ t: 'p', small: true, text: 'Altitud de cada punto contra la distancia acumulada entre ellos, en el orden de la lista y sin volver al primero. Se usaron las altitudes guardadas; no se consultó internet.' });
        }
      }
    }
    // Fotos de los puntos: las que no estén (o no sean JPEG usables) no se dibujan
    var any = false;
    (skip('fotos') ? [] : project.points).forEach(function (p, i) {
      var name = p.name || 'P' + (i + 1), list = [];
      (Array.isArray(p.photos) ? p.photos : []).forEach(function (f) {
        var bytes = f && photoBytes(o.photos, f.id);
        if (bytes && Pdf.jpegInfo(bytes)) list.push({ img: { bytes: bytes }, caption: list.length === 0 ? 'Principal' : 'Foto ' + (list.length + 1) });
      });
      if (!list.length) return;
      if (!any) { B.push({ t: 'h2', text: 'Fotos de los puntos' }); any = true; }
      B.push({ t: 'h3', text: name, color: pointColor(p, project) });
      B.push({ t: 'gallery', items: list, per: 3 });
    });
    if (any) B.push({ t: 'p', small: true, text: 'Fotos reducidas para este reporte. En el teléfono y en la copia de seguridad quedan con más calidad (hasta 1280 px).' });
    if (!skip('zonas') && a.vertexZones && a.vertexZones.length && a.distinctZones && a.distinctZones.length > 1) {
      B.push({ t: 'h2', text: 'Zonas según la altitud de cada punto' });
      B.push({ t: 'table', rows: a.vertexZones.map(function (v) { return [v.name + ' (' + Fmt.num(v.alt, 0) + ' m)', v.zone + ' (' + v.symbol + ')']; }) });
      B.push({ t: 'p', small: true, text: 'Se usa la misma precipitación para todos los puntos; la temperatura se ajusta con la altitud.' });
    }
    if (a.quality !== undefined || (a.warnings && a.warnings.length) || (a.info && a.info.length)) {
      B.push({ t: 'h2', text: 'Calidad de los datos' });
      if (a.quality !== undefined) B.push({ t: 'p', text: Report.QUALITY[a.quality] });
      (a.warnings || []).forEach(function (w) { B.push({ t: 'note', text: w }); });
      (a.info || []).forEach(function (w) { B.push({ t: 'p', small: true, text: w }); });
      ((a.climate && a.climate.notes) || []).forEach(function (n) { B.push({ t: 'p', small: true, text: n }); });
    }
    if (!skip('walter') && o.walter && o.walter.svg) {
      B.push({ t: 'h2', text: 'Diagrama de Walter-Lieth' });
      pic('walter', 470, 'el diagrama de Walter-Lieth');
      B.push({ t: 'list', items: o.walter.lines || [] });
      B.push({ t: 'p', small: true, text: (o.walter.source || '') + ' Mes seco: la lluvia mensual (mm) es menor que el doble de la temperatura media mensual (°C).' });
    }
    if (!skip('holdridge') && r && r.ok) {
      B.push({ t: 'pagebreak' });
      B.push({ t: 'h2', text: 'Diagrama de Holdridge' });
      pic('holdridge', 520, 'el diagrama de Holdridge');
      B.push({ t: 'p', small: true, text: 'El anillo rojo marca la posición del punto de análisis; el hexágono resaltado es su zona de vida.' });
    }
    B.push({ t: 'spacer', h: 10 });
    if (!o.noHead) B.push({ t: 'p', small: true, text: Report.DISCLAIMER });      // en el reporte de todo el proyecto va una sola vez, al final
    return B;
  }

  /* ---------- Reporte de todo el proyecto (2.15.0) ---------- */
  // Las gráficas de todos los lotes; la clave de cada una lleva delante el número del lote («2:croquis»)
  function sketchesAll(parts) {
    var out = [], ov = Report.overview(parts);
    if (ov) out.push({ key: '0:general', svg: ov.svg });
    (parts || []).forEach(function (pt, i) { sketches(pt.project, pt.a, pt.o).forEach(function (s) { out.push({ key: (i + 1) + ':' + s.key, svg: s.svg, px: s.px }); }); });
    return out;
  }
  function blocksAll(project, parts, o, images) {
    o = o || {}; images = images || {};
    var au = Report.authorOf(o), logo = au.logo ? Fotos.fromBase64(au.logo) : null, s = Report.summary(parts);
    var B = [{ t: 'head', title: 'Reporte de zona de vida', lines: Report.headLines({ name: project.name }, o), logo: logo ? { bytes: logo } : null, logoW: 130, logoH: 80 }];
    B.push({ t: 'h2', text: 'Resumen del proyecto' });
    B.push({ t: 'table', rows: s.rows.map(function (x) { return [x.name + (x.tipo ? ' · ' + x.tipo : ''), x.area + ' · ' + x.alt + ' · ' + x.zone, x.color]; }).concat([['Total', s.totalText + ' · ' + s.note]]) });
    s.fincas.forEach(function (f) { B.push({ t: 'p', small: true, text: f + '.' }); });
    if (s.overlap) B.push({ t: 'note', text: 'Atención: ' + s.overlap });
    var ov = Report.overview(parts);
    if (ov) {
      B.push({ t: 'h2', text: 'Croquis general' });
      if (images['0:general'] && images['0:general'].bytes) { B.push({ t: 'image', img: images['0:general'], maxW: 400 }); B.push({ t: 'legend', items: ov.items }); }
      else B.push({ t: 'note', text: 'No se pudo dibujar el croquis general en el PDF.' });
    }
    parts.forEach(function (pt, i) {
      var own = {}, pre = (i + 1) + ':';
      Object.keys(images).forEach(function (k) { if (k.indexOf(pre) === 0) own[k.slice(pre.length)] = images[k]; });
      var po = {};
      Object.keys(pt.o || {}).forEach(function (k) { po[k] = pt.o[k]; });
      po.noHead = true;
      B.push({ t: 'pagebreak' });
      B.push({ t: 'h1', text: Report.lotTitle(pt.project) });
      B = B.concat(blocks(pt.project, pt.a, po, own));
    });
    B.push({ t: 'p', small: true, text: Report.DISCLAIMER });
    return B;
  }
  function buildAll(project, parts, o, images) {
    o = o || {};
    return Pdf.build(blocksAll(project, parts, o, images), {
      title: 'Reporte de zona de vida · ' + project.name, subject: 'Clasificación bioclimática de Holdridge', author: '', creator: 'Zonas de Vida',
      date: o.date || Date.now(), footer: 'Reporte de zona de vida · ' + project.name
    });
  }

  function build(project, a, o, images) {
    o = o || {};
    var date = o.date || Date.now();
    return Pdf.build(blocks(project, a, o, images), {
      title: 'Reporte de zona de vida · ' + project.name,
      subject: 'Clasificación bioclimática de Holdridge',
      author: '',
      creator: 'Zonas de Vida',
      date: date,
      footer: 'Reporte de zona de vida · ' + project.name
    });
  }

  return { sketchesAll: sketchesAll, blocksAll: blocksAll, buildAll: buildAll, sketches: sketches, blocks: blocks, build: build, rasterize: rasterize, rasterizeAll: rasterizeAll, svgSize: svgSize, sized: sized, PX: PX };
});

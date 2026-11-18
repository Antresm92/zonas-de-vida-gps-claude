/* igac.js — el mapa oficial de capacidad de uso de las tierras del IGAC (2.31.0). Lógica pura, sin pantalla.
 *
 * Servicio: «Capacidad de uso de las tierras multiescalar» del Instituto Geográfico Agustín Codazzi (IGAC), capa 0
 * (CUT_Multiescalar_2024). Junta estudios a escala 1:100.000, 1:25.000 y 1:10.000; cada polígono dice de qué estudio,
 * escala y año sale. Se usa de tres maneras:
 *   1. Consulta en un punto (pointUrl → parse): clase, subclase, unidad, limitantes, usos recomendados y prácticas de manejo.
 *   2. Imagen del mapa por baldosas (tileUrl), para dibujarla sobre el mapa de la app cuando hay internet.
 *   3. Descarga de los polígonos alrededor del predio (bboxUrl → slim), para verlos y consultarlos sin conexión (classAt).
 * Los datos del IGAC son abiertos (Resolución 616 de 2020: licencia CC BY 4.0); se cita «Fuente: IGAC».
 * La clase viene a veces en números romanos (estudios antiguos) y a veces con un código que no es clase (CA cuerpo de agua,
 * ZU zona urbana…): se pasa todo a número de 1 a 8 o a «especial» con su nombre.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Igac = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SERVICE = 'https://mapas2.igac.gov.co/server/rest/services/agrologia/capacidaddeusodelastierrasmultiescalar/MapServer';
  var FIELDS = ['Clase', 'Subclase', 'UCP', 'Limitantes', 'URecomendados', 'PManejo', 'Estudio', 'Escala', 'Año', 'Clase_Multiescalar'];
  var FUENTE = {
    cita: 'Instituto Geográfico Agustín Codazzi (IGAC). Capacidad de uso de las tierras, mapa multiescalar (escalas 1:100.000, 1:25.000 y 1:10.000). Datos abiertos, licencia CC BY 4.0 (Resolución 616 de 2020).',
    url: SERVICE,
    corta: 'Fuente: IGAC, capacidad de uso de las tierras (CC BY 4.0)',
    licencia: 'https://vlex.com.co/vid/resolucion-numero-616-2020-846199912',     // «…se adopta la licencia Creative Commons CC-BY 4.0» (título de la resolución)
    portal: 'https://www.igac.gov.co/datos-abiertos/datos-abiertos-geoespaciales'
  };
  var MAX_BBOX_DEG = 0.25;          // lado máximo de la zona que se descarga (≈ 27 km)
  var PAD_DEG = 0.003;              // margen alrededor del predio (≈ 330 m)
  var OFFSET = 0.0002;              // simplificación de los bordes al descargar (≈ 20 m)
  var MAX_TXT = 700;

  // Colores del propio mapa del IGAC (su leyenda), por clase
  // (la clase 1 no aparece en el mapa ni en su leyenda; su color lo puso la app)
  var COLORS = { 1: '#38a800', 2: '#ffff73', 3: '#ff0000', 4: '#00a8e6', 5: '#a3ff73', 6: '#ffab00', 7: '#734d00', 8: '#ab66cc',
    CA: '#97dbf2', ZU: '#ffbebe', otro: '#b2b2b2' };
  var ESPECIAL = { CA: 'Cuerpo de agua', ZU: 'Zona urbana', MC: 'Misceláneo (no agrícola)', MR: 'Misceláneo rocoso', ES: 'Sin clasificar (especial)',
    PN: 'Parque Nacional (sin estudio)', 'Sin estudio': 'Sin estudio de suelos', 'N/A': 'Sin dato' };
  var LETRAS = { p: 'pendiente', e: 'erosión', h: 'humedad en exceso', s: 'suelo', c: 'clima' };   // IGAC IN-GAG-PC05-02, p. 15
  var ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function txt(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
  }

  // '6', 'VI', 'VIpc' → 6; 'CA', 'ZU', 'Sin estudio'… → null
  function claseNum(v) {
    var s = txt(v, 20);
    if (/^[1-8]$/.test(s)) return +s;
    var m = /^(VIII|VII|VI|IV|V|III|II|I)(?![IVX])/.exec(s);
    return m ? ROMAN[m[1]] : null;
  }
  // Lee los atributos de un polígono del IGAC y los deja en la forma de la app
  function fromAttributes(at) {
    if (!at || typeof at !== 'object') return null;
    var clase = claseNum(at.Clase_Multiescalar);
    if (clase === null) clase = claseNum(at.Clase);
    var raw = txt(at.Clase_Multiescalar || at.Clase, 20), sub = txt(at.Subclase, 12).replace(/^(VIII|VII|VI|IV|V|III|II|I|[1-8])/, '');
    var out = { clase: clase, codigo: clase !== null ? clase + (/^[a-z]{1,5}$/.test(sub) ? sub : '') : raw, ucp: txt(at.UCP, 20),
      limitantes: txt(at.Limitantes, MAX_TXT), usos: txt(at.URecomendados, MAX_TXT), practicas: txt(at.PManejo, MAX_TXT),
      estudio: txt(at.Estudio, 200), escala: txt(at.Escala, 20), anio: txt(at['Año'], 8) };
    if (clase === null) out.especial = ESPECIAL[raw] || (raw ? 'Sin clase agrológica (' + raw + ')' : 'Sin dato');
    return out;
  }
  // La respuesta de la consulta en un punto ({ features: [{ attributes }] }); si hay varias, la de escala más detallada
  function parse(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'Respuesta vacía del IGAC' };
    if (json.error) return { ok: false, error: 'El IGAC respondió con un error' + (json.error.message ? ': ' + txt(json.error.message, 120) : '') };
    var fs = Array.isArray(json.features) ? json.features : [];
    if (!fs.length) return { ok: true, data: null };           // fuera de Colombia o sin estudio en ese punto
    var best = null, bestDen = Infinity;
    fs.forEach(function (f) {
      var a = f && (f.attributes || f.properties), d = a ? denominador(a.Escala) : Infinity;
      if (a && (best === null || d < bestDen)) { best = a; bestDen = d; }
    });
    return { ok: true, data: fromAttributes(best) };
  }
  function denominador(esc) { var m = /1\s*:\s*([\d.]+)/.exec(String(esc || '')); return m ? +m[1].replace(/\./g, '') : Infinity; }
  function letras(codigo) {
    var m = /^[1-8]([a-z]+)$/.exec(codigo || '');
    return m ? m[1].split('').map(function (c) { return LETRAS[c] || c; }) : [];
  }

  /* ---------- Direcciones del servicio ---------- */
  function q(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function pointUrl(lat, lon) {
    return SERVICE + '/0/query?' + q({ geometry: lon.toFixed(6) + ',' + lat.toFixed(6), geometryType: 'esriGeometryPoint', inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects', outFields: FIELDS.join(','), returnGeometry: 'false', f: 'json' });
  }
  // Zona que se descarga: los puntos con un margen; null si no hay puntos o si es demasiado grande
  function bboxOf(points, pad) {
    pad = isNum(pad) ? pad : PAD_DEG;
    var s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
    (points || []).forEach(function (p) {
      if (!p || !isNum(p.lat) || !isNum(p.lon)) return;
      s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    });
    if (s === Infinity) return null;
    var b = { s: +(s - pad).toFixed(6), w: +(w - pad).toFixed(6), n: +(n + pad).toFixed(6), e: +(e + pad).toFixed(6) };
    b.big = b.n - b.s > MAX_BBOX_DEG || b.e - b.w > MAX_BBOX_DEG;
    return b;
  }
  function bboxUrl(b) {
    return SERVICE + '/0/query?' + q({ geometry: [b.w, b.s, b.e, b.n].join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, outSR: 4326,
      spatialRel: 'esriSpatialRelIntersects', outFields: FIELDS.join(','), returnGeometry: 'true', geometryPrecision: 5, maxAllowableOffset: OFFSET, f: 'geojson' });
  }
  // Baldosa x, y, z (Web Mercator) → imagen del mapa del IGAC de 256 × 256 px
  var R = 6378137, HALF = Math.PI * R;
  function tileBbox(x, y, z) {
    var size = 2 * HALF / Math.pow(2, z);
    return [-HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size];
  }
  function tileUrl(x, y, z) {
    var b = tileBbox(x, y, z).map(function (v) { return v.toFixed(2); });
    return SERVICE + '/export?' + q({ bbox: b.join(','), bboxSR: 3857, imageSR: 3857, size: '256,256', format: 'png32', transparent: 'true', layers: 'show:0', f: 'image' });
  }

  /* ---------- Lo descargado para usar sin conexión ---------- */
  function ring(r) {
    if (!Array.isArray(r)) return null;
    var out = [];
    for (var i = 0; i < r.length && i < 20000; i++) {
      var c = r[i];
      if (Array.isArray(c) && isNum(c[0]) && isNum(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) out.push([+c[0].toFixed(5), +c[1].toFixed(5)]);
    }
    return out.length >= 4 ? out : null;
  }
  function polys(g) {
    if (!g || typeof g !== 'object') return null;
    var list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!Array.isArray(list)) return null;
    var out = [];
    list.forEach(function (p) {
      if (!Array.isArray(p)) return;
      var rs = p.map(ring).filter(Boolean);
      if (rs.length) out.push(rs);
    });
    return out.length ? out : null;
  }
  // GeoJSON del IGAC → { features: [{ p: [[anillos]], a: atributos de la app }], parcial }. Solo lo que la app usa, con 5 decimales.
  function slim(gj) {
    if (!gj || typeof gj !== 'object' || !Array.isArray(gj.features)) return null;
    var fs = [];
    gj.features.slice(0, 3000).forEach(function (f) {
      var p = f && polys(f.geometry), a = f && fromAttributes(f.properties);
      if (p && a) fs.push({ p: p, a: a });
    });
    return { features: fs, parcial: !!(gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit)) };
  }
  function inRing(lat, lon, r) {
    var inside = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // El polígono descargado que contiene el punto (con huecos), o null
  function classAt(cache, lat, lon) {
    if (!cache || !Array.isArray(cache.features)) return null;
    var hit = null, den = Infinity;
    cache.features.forEach(function (f) {
      var inside = f.p.some(function (rs) { return inRing(lat, lon, rs[0]) && !rs.slice(1).some(function (h) { return inRing(lat, lon, h); }); });
      var d = denominador(f.a.escala);
      if (inside && d < den) { hit = f.a; den = d; }
    });
    return hit;
  }
  function colorOf(a) {
    if (!a) return COLORS.otro;
    if (a.clase !== null && a.clase !== undefined) return COLORS[a.clase] || COLORS.otro;
    return COLORS[a.codigo] || COLORS.otro;
  }
  // Las clases que aparecen en lo descargado, para la leyenda
  function legend(cache) {
    var seen = {}, out = [];
    (cache && cache.features || []).forEach(function (f) {
      var k = f.a.clase !== null ? String(f.a.clase) : f.a.codigo;
      if (seen[k]) return; seen[k] = true;
      out.push({ k: k, color: colorOf(f.a), label: f.a.clase !== null ? 'Clase ' + f.a.clase : f.a.especial });
    });
    return out.sort(function (a, b) { return (+a.k || 99) - (+b.k || 99) || String(a.k).localeCompare(String(b.k)); });
  }

  /* ---------- Lo que se guarda en el polígono (lot.igac) ---------- */
  var SAFE = ['codigo', 'ucp', 'limitantes', 'usos', 'practicas', 'estudio', 'escala', 'anio', 'especial'];
  function clean(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    var out = {}, c = g.clase;
    out.clase = isNum(c) && c >= 1 && c <= 8 && Math.floor(c) === c ? c : null;
    SAFE.forEach(function (k) { var v = txt(g[k], k === 'estudio' ? 200 : MAX_TXT); if (v) out[k] = v; });
    if (!out.codigo) return null;
    if (out.clase === null && !out.especial) out.especial = 'Sin dato';
    if (out.clase !== null) delete out.especial;
    if (isNum(g.lat) && Math.abs(g.lat) <= 90 && isNum(g.lon) && Math.abs(g.lon) <= 180) { out.lat = +g.lat.toFixed(6); out.lon = +g.lon.toFixed(6); }
    if (isNum(g.at) && g.at > 0 && g.at < 8.64e15) out.at = g.at;
    if (g.src === 'guardado') out.src = 'guardado';
    return out;
  }
  // Comparación con la clase que calcula la app (capacidad.js)
  function compara(igac, claseApp) {
    if (!igac || igac.clase === null || !isNum(claseApp)) return null;
    if (igac.clase === claseApp) return { igual: true, txt: 'Coincide con tu evaluación.' };
    return { igual: false, txt: 'Tu evaluación da clase ' + claseApp + (claseApp > igac.clase ? ' (más restrictiva)' : ' (menos restrictiva)') +
      '. El mapa del IGAC es regional; lo que mides en el predio es más detallado. Revísalo en campo.' };
  }

  return { SERVICE: SERVICE, FUENTE: FUENTE, COLORS: COLORS, ESPECIAL: ESPECIAL, LETRAS: LETRAS, MAX_BBOX_DEG: MAX_BBOX_DEG,
    claseNum: claseNum, fromAttributes: fromAttributes, parse: parse, letras: letras, pointUrl: pointUrl, bboxOf: bboxOf, bboxUrl: bboxUrl,
    tileBbox: tileBbox, tileUrl: tileUrl, slim: slim, classAt: classAt, colorOf: colorOf, legend: legend, clean: clean, compara: compara };
});

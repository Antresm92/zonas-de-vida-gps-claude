/* catastro.js — el número predial y el lindero catastral de un predio (2.32.0). Lógica pura, sin pantalla.
 *
 * Dos caminos:
 *   A. Archivo: en Colombia en Mapas (colombiaenmapas.gov.co, IGAC) se consulta el predio y se descarga como GeoJSON. Al
 *      importarlo, la app lee «Numero predial» y «Municipio» de sus propiedades (fromProps).
 *   B. Consulta directa: el mismo servicio que usa Colombia en Mapas por dentro (servicioscem.igac.gov.co/Geovisor/catastral),
 *      por coordenada o por número predial. NO es un servicio publicado ni documentado: puede cambiar o dejar de responder
 *      sin aviso; por eso la app siempre ofrece el camino A.
 * De la respuesta solo se guardan el número predial (y el anterior), el municipio, el área de terreno y el lindero. La
 * dirección, el avalúo y las construcciones se descartan aquí mismo: nunca llegan a la app.
 * Colombia en Mapas advierte que sus datos «no permiten el cálculo de áreas oficiales ni la definición en materia de límites».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catastro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SERVICE = 'https://servicioscem.igac.gov.co/Geovisor/catastral';
  var PORTAL = 'https://www.colombiaenmapas.gov.co/';
  var AVISO = 'Colombia en Mapas (IGAC) advierte que estos datos no permiten el cálculo de áreas oficiales ni la definición en materia de límites.';
  var MAX_VERT = 5000;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function txt(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) : s;
  }
  // Número predial: solo dígitos; el nacional tiene 30 y el anterior 20. Otra cosa → ''.
  function numero(v) {
    var d = String(v === null || v === undefined ? '' : v).replace(/[\s.\-]/g, '');
    return /^\d{30}$/.test(d) || /^\d{20}$/.test(d) ? d : '';
  }
  // 30 dígitos en grupos, para leerlo: 50 573 00 02 0000 0008 0046 000000000 (departamento, municipio, zona, sector, …)
  function legible(n) {
    if (!/^\d{30}$/.test(n || '')) return n || '';
    return [n.slice(0, 2), n.slice(2, 5), n.slice(5, 7), n.slice(7, 9), n.slice(9, 13), n.slice(13, 17), n.slice(17, 21), n.slice(21)].join(' ');
  }

  /* ---------- A. El GeoJSON descargado de Colombia en Mapas ---------- */
  var NUM_KEYS = ['Numero predial', 'Número predial', 'numero_predial', 'NUMERO_PREDIAL', 'numPredial', 'CODIGO', 'codigo'];
  var ANT_KEYS = ['Numero predial anterior', 'Número predial anterior', 'NUMERO_PREDIAL_ANTERIOR', 'numPredialAnterior', 'CODIGO_ANTERIOR'];
  var MUN_KEYS = ['Municipio', 'municipio', 'MUNICIPIO'];
  function pick(p, keys) { for (var i = 0; i < keys.length; i++) if (p[keys[i]] !== undefined && p[keys[i]] !== null && p[keys[i]] !== '') return p[keys[i]]; return ''; }
  // Propiedades de un polígono importado → { numero, anterior?, municipio? } o null (si no trae un número predial válido)
  function fromProps(p) {
    if (!p || typeof p !== 'object') return null;
    var n = numero(pick(p, NUM_KEYS));
    if (!n) return null;
    var out = { numero: n }, ant = numero(pick(p, ANT_KEYS)), mun = txt(pick(p, MUN_KEYS), 80);
    if (ant && ant !== n) out.anterior = ant;
    if (mun) out.municipio = mun;
    return out;
  }

  /* ---------- B. La consulta directa ---------- */
  function q(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function bodyXY(lat, lon) { return q({ cmd: 'query_xy', x: lon.toFixed(7), y: lat.toFixed(7), token: '' }); }
  function bodyNumero(n) { return q({ cmd: 'query_codigo', query: n, token: '' }); }
  function rings(geom) {
    var rs = geom && (geom.rings || (geom.type === 'Polygon' ? geom.coordinates : null));
    if (!Array.isArray(rs)) return [];
    var out = [], total = 0;
    rs.forEach(function (r) {
      if (!Array.isArray(r)) return;
      var pts = [];
      r.forEach(function (c) {
        if (total >= MAX_VERT || !Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return;
        pts.push({ lat: +c[1].toFixed(7), lon: +c[0].toFixed(7) }); total++;
      });
      if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) pts.pop();
      if (pts.length >= 3) out.push(pts);
    });
    return out;
  }
  // { status, response: { unidad, predio, terreno } } → { ok, data } (data null = sin información catastral en ese sitio)
  function parse(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'respuesta vacía' };
    if (json.status === false && /no se encontr/i.test(String(json.message || ''))) return { ok: true, data: null };     // «No se encontró información asociada.»
    if (json.status === false || json.error) return { ok: false, error: txt(json.message || (json.error && json.error.message) || 'el servicio respondió con un error', 120) };
    var r = json.response || json;
    var t = r && r.terreno && Array.isArray(r.terreno.features) && r.terreno.features[0], p = r && r.predio, u = r && r.unidad;
    if (!t && !p) return { ok: true, data: null };
    var at = (t && t.attributes) || {}, rs = rings(t && t.geometry);
    var n = numero(at.CODIGO) || numero(p && p.numPredial);
    if (!n && !rs.length) return { ok: true, data: null };
    var d = { numero: n, rings: rs };
    var ant = numero(at.CODIGO_ANTERIOR) || numero(p && p.numPredialAnterior);
    if (ant && ant !== n) d.anterior = ant;
    var mun = txt(u && (u.NOMBRE_COMPLETO || u.NOMBRE), 80);
    if (mun) d.municipio = mun;
    var area = p && isNum(p.areaTerreno) && p.areaTerreno > 0 ? p.areaTerreno : null;
    if (area !== null) d.areaM2 = Math.round(area * 100) / 100;
    if (isNum(at.Shape__Area) && at.Shape__Area > 0) d.areaMapaM2 = Math.round(at.Shape__Area * 100) / 100;
    return { ok: true, data: d };            // nada de dirección, avalúo ni construcciones
  }
  // El lindero más grande como lista de puntos (los demás anillos son huecos o partes sueltas; se avisa cuántos hay)
  function mainRing(d) {
    if (!d || !d.rings || !d.rings.length) return null;
    return d.rings.slice().sort(function (a, b) { return b.length - a.length; })[0];
  }

  /* ---------- Lo que se guarda en el polígono (lot.predial) ---------- */
  function clean(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    var n = numero(g.numero);
    if (!n) return null;
    var out = { numero: n }, ant = numero(g.anterior), mun = txt(g.municipio, 80);
    if (ant && ant !== n) out.anterior = ant;
    if (mun) out.municipio = mun;
    if (isNum(g.areaM2) && g.areaM2 > 0 && g.areaM2 < 1e12) out.areaM2 = Math.round(g.areaM2 * 100) / 100;
    if (g.fuente === 'archivo' || g.fuente === 'consulta' || g.fuente === 'manual') out.fuente = g.fuente;
    if (isNum(g.at) && g.at > 0 && g.at < 8.64e15) out.at = g.at;
    return out;
  }
  // Área catastral frente a la medida en la app (m²): texto para el usuario, o null
  function compara(catM2, medidaM2) {
    if (!isNum(catM2) || catM2 <= 0 || !isNum(medidaM2) || medidaM2 <= 0) return null;
    var dif = (medidaM2 - catM2) / catM2 * 100, abs = Math.abs(dif);
    var f = function (x) { return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); };
    return { dif: dif, txt: abs < 0.05 ? 'Igual al área catastral.' : 'La medida es ' + f(abs) + ' % ' + (dif > 0 ? 'mayor' : 'menor') + ' que el área catastral.' };
  }

  return { SERVICE: SERVICE, PORTAL: PORTAL, AVISO: AVISO, numero: numero, legible: legible, fromProps: fromProps, bodyXY: bodyXY, bodyNumero: bodyNumero,
    parse: parse, mainRing: mainRing, clean: clean, compara: compara };
});

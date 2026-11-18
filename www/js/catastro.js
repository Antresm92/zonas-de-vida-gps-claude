/* catastro.js — el número predial de un predio (2.32.0). Lógica pura, sin pantalla.
 *
 * El lindero catastral entra por archivo: en Colombia en Mapas (colombiaenmapas.gov.co, IGAC) se consulta el predio y se
 * descarga como GeoJSON; al importarlo, la app lee «Numero predial» y «Municipio» de sus propiedades (fromProps). El número
 * también se puede escribir a mano. La app no consulta el catastro por su cuenta.
 * Solo se guardan el número predial (y el anterior) y el municipio: la dirección que trae el archivo se descarta aquí mismo.
 * Colombia en Mapas advierte que sus datos «no permiten el cálculo de áreas oficiales ni la definición en materia de límites».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catastro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PORTAL = 'https://www.colombiaenmapas.gov.co/';
  var AVISO = 'Colombia en Mapas (IGAC) advierte que estos datos no permiten el cálculo de áreas oficiales ni la definición en materia de límites.';

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
  // 30 dígitos en grupos, para leerlo
  function legible(n) {
    if (!/^\d{30}$/.test(n || '')) return n || '';
    return [n.slice(0, 2), n.slice(2, 5), n.slice(5, 7), n.slice(7, 9), n.slice(9, 13), n.slice(13, 17), n.slice(17, 21), n.slice(21)].join(' ');
  }

  /* ---------- El GeoJSON descargado de Colombia en Mapas ---------- */
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

  /* ---------- Lo que se guarda en el polígono (lot.predial) ---------- */
  function clean(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    var n = numero(g.numero);
    if (!n) return null;
    var out = { numero: n }, ant = numero(g.anterior), mun = txt(g.municipio, 80);
    if (ant && ant !== n) out.anterior = ant;
    if (mun) out.municipio = mun;
    if (g.fuente === 'archivo' || g.fuente === 'manual') out.fuente = g.fuente;
    if (isNum(g.at) && g.at > 0 && g.at < 8.64e15) out.at = g.at;
    return out;
  }

  return { PORTAL: PORTAL, AVISO: AVISO, numero: numero, legible: legible, fromProps: fromProps, clean: clean };
});

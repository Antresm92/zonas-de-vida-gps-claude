/* cultivos.js — «Cultivos a evaluar» y «Conclusión y recomendaciones» (2.30.0). Lógica pura, sin pantalla.
 *
 * 1. Aptitud por clima (método ECOCROP: Hackett, 1991; implementación de R. J. Hijmans): para la temperatura media anual y
 *    la lluvia anual del polígono, cada cultivo recibe 1 dentro de su rango óptimo, 0 fuera de su rango absoluto y un valor
 *    proporcional entre los dos. La aptitud por clima es la menor de las dos (el factor que más limita). Si en «Evaluar el
 *    terreno» se dijo que hiela y el cultivo muere a 0 °C o más, queda limitado por heladas.
 * 2. Aptitud por tierra: los usos de la clase de capacidad de uso del IGAC (capacidad.js). La correspondencia entre cada
 *    clase y cada tipo de cultivo es una lectura de la app de la frase de usos del IGAC (está en CLASE_TIPOS, con su razón).
 * 3. Resultado: «Óptimo» (clima ≥ 0,8 y la clase lo admite), «Posible con limitaciones» (clima ≥ 0,4, o la clase lo admite
 *    con restricciones), «Marginal» (clima por encima de 0 pero bajo) y «No recomendado» (fuera del rango del cultivo o
 *    excluido por la clase).
 * Todo es orientativo: no tiene en cuenta el suelo que no se evaluó, el agua de riego, las plagas ni el mercado.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cultivos-datos.js'));
  else root.Cultivos = factory(root.CultivosDatos);
})(typeof self !== 'undefined' ? self : this, function (DATOS) {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  var TIPOS = { T: 'Transitorio', H: 'Hortaliza', S: 'Semiperenne', P: 'Perenne', A: 'Aromática o especia', G: 'Pasto o forraje', F: 'Forestal' };

  // Qué tipos admite cada clase del IGAC: 'si' sin restricción, 'lim' con restricciones, ausente = no.
  // Lectura de la frase de usos de cada clase (IGAC IN-GAG-PC05-02, pp. 3–14).
  var CLASE_TIPOS = {
    1: { si: 'THSPAGF', razon: 'admite una amplia diversidad de cultivos' },
    2: { si: 'THSPAGF', razon: 'admite cultivos transitorios, semiperennes y perennes' },
    3: { si: 'SPAGF', lim: 'TH', razon: 'admite agricultura con prácticas de conservación' },
    4: { si: 'GF', lim: 'SPA', razon: 'es para ganadería con buenos pastos y agroforestería' },
    5: { lim: 'THSPAG', razon: 'solo admite agricultura y ganadería estacional, por el exceso de agua' },
    6: { si: 'SP', lim: 'GF', razon: 'solo admite algunos cultivos semiperennes o perennes y ganadería extensiva' },
    7: { si: 'F', razon: 'es de aptitud forestal con carácter protector' },
    8: { razon: 'es para conservación o recuperación' }
  };

  function suit(v, r) {
    if (!isNum(v)) return null;
    if (v <= r[0] || v >= r[3]) return 0;
    if (v < r[1]) return (v - r[0]) / (r[1] - r[0]);
    if (v > r[2]) return (r[3] - v) / (r[3] - r[2]);
    return 1;
  }
  function hiela(terreno) { return !!terreno && ['1-2', '3-10', '10+'].indexOf(terreno.heladas) >= 0; }

  // Un cultivo frente al polígono. datos: { T, P, clase, terreno }
  function evalua(row, d) {
    var c = { es: row[0], sci: row[1], eco: row[2], tipo: row[3], tipoTxt: TIPOS[row[3]], T: row[4], P: row[5], k: row[6] };
    var st = suit(d.T, c.T), sp = suit(d.P, c.P), lim = [];
    if (st === null || sp === null) { c.clima = null; c.cat = null; return c; }
    c.clima = Math.min(st, sp);
    if (st < 1) lim.push(d.T < c.T[1] ? 'temperatura baja (' + c.T[1] + '–' + c.T[2] + ' °C es lo óptimo)' : 'temperatura alta (' + c.T[1] + '–' + c.T[2] + ' °C es lo óptimo)');
    if (sp < 1) lim.push(d.P < c.P[1] ? 'poca lluvia (' + c.P[1] + '–' + c.P[2] + ' mm/año es lo óptimo; con riego puede mejorar)' : 'mucha lluvia (' + c.P[1] + '–' + c.P[2] + ' mm/año es lo óptimo)');
    if (hiela(d.terreno) && isNum(c.k) && c.k >= 0) { c.clima = Math.min(c.clima, 0.3); lim.push('heladas (muere desde ' + c.k + ' °C)'); }
    var cl = isNum(d.clase) ? CLASE_TIPOS[d.clase] : null, tierra = 'si';
    if (cl) {
      tierra = (cl.si || '').indexOf(c.tipo) >= 0 ? 'si' : (cl.lim || '').indexOf(c.tipo) >= 0 ? 'lim' : 'no';
      if (tierra !== 'si') lim.push('la clase ' + d.clase + ' ' + cl.razon);
    }
    c.tierra = tierra; c.lim = lim;
    c.cat = tierra === 'no' || c.clima === 0 ? 'no' : c.clima >= 0.8 && tierra === 'si' ? 'optimo' : c.clima >= 0.4 ? 'posible' : 'marginal';
    return c;
  }
  var ORDEN = { optimo: 0, posible: 1, marginal: 2, no: 3 };
  function evaluar(d) {
    d = d || {};
    if (!isNum(d.T) || !isNum(d.P)) return null;
    var all = DATOS.map(function (r) { return evalua(r, d); });
    all.sort(function (a, b) { return ORDEN[a.cat] - ORDEN[b.cat] || b.clima - a.clima || a.es.localeCompare(b.es, 'es'); });
    var g = { optimo: [], posible: [], marginal: [], no: [] };
    all.forEach(function (c) { g[c.cat].push(c); });
    return { todos: all, grupos: g, total: all.length, conClase: isNum(d.clase) };
  }

  // Conclusión y recomendaciones del polígono. m: { nombre, ha, zona, T, P, secos (meses secos), clase, subclase, limita (nombres),
  // provisional, faltan (n), usos, pendiente (%), humedad (categoría IGAC), lab (si hay datos de laboratorio), cultivos (evaluar()) }
  function conclusion(m) {
    if (!m || !isNum(m.T) || !isNum(m.P)) return null;
    var f = function (x, n) { return Number(x).toFixed(n).replace('.', ','); };
    var p = 'El polígono «' + m.nombre + '»' + (isNum(m.ha) ? ' (' + f(m.ha, 2) + ' ha)' : '') + (m.zona ? ' está en la zona de vida ' + m.zona + ' (Holdridge)' : '') +
      ', con ' + f(m.T, 1) + ' °C de temperatura media y ' + Math.round(m.P) + ' mm de lluvia al año' +
      (isNum(m.secos) ? (m.secos ? ' y ' + m.secos + (m.secos === 1 ? ' mes seco' : ' meses secos') + ' (Walter-Lieth)' : ', sin meses secos (Walter-Lieth)') : '') + '.';
    if (isNum(m.clase)) p += ' Según el IGAC, su clase de capacidad de uso es ' + m.subclase + (m.limita && m.limita.length ? ', limitada por ' + m.limita.join(', ').toLowerCase() : '') + (m.provisional ? ' (provisional: faltan ' + m.faltan + ' datos)' : '') + '.';
    var cu = m.cultivos, top = cu ? cu.grupos.optimo.slice(0, 8).map(function (c) { return c.es; }) : [];
    if (cu) p += top.length ? ' Por clima y tierra, los cultivos con mejor aptitud son: ' + top.join(', ') + (cu.grupos.optimo.length > 8 ? ' y otros ' + (cu.grupos.optimo.length - 8) : '') + '.' :
      cu.grupos.posible.length ? ' Ningún cultivo de la lista queda óptimo; ' + cu.grupos.posible.length + ' son posibles con limitaciones.' : ' Ningún cultivo de la lista queda apto con estos datos.';
    var R = [];
    if (isNum(m.clase) && m.clase >= 7) R.push({ t: m.clase === 8 ? 'Destinar el polígono a conservación o recuperación de la vegetación natural.' : 'Mantener o establecer bosque protector; el IGAC excluye la ganadería en esta clase.', f: 1 });
    else if (isNum(m.pendiente) && m.pendiente > 25) R.push({ t: 'Con ' + Math.round(m.pendiente) + ' % de pendiente, preferir cultivos permanentes densos, agroforestería o pastos con cobertura permanente, y evitar dejar el suelo desnudo.', f: 1 });
    else if (isNum(m.pendiente) && m.pendiente > 7) R.push({ t: 'Con ' + Math.round(m.pendiente) + ' % de pendiente, sembrar con prácticas de conservación de suelos (por ejemplo, siembra en contorno y coberturas).', f: 1 });
    if (isNum(m.secos) && m.secos > 0) R.push({ t: 'Prever riego, cosecha de agua o cultivos tolerantes a la sequía para ' + (m.secos === 1 ? 'el mes seco' : 'los ' + m.secos + ' meses secos') + '.', f: 2 });
    if (m.humedad === 'muyhumedo' || m.humedad === 'pluvial') R.push({ t: 'El clima es ' + (m.humedad === 'pluvial' ? 'pluvial' : 'muy húmedo') + ': revisar el drenaje y preferir cultivos que toleren el exceso de humedad.', f: 1 });
    if (m.provisional) R.push({ t: 'Completar la evaluación del terreno (' + m.faltan + ' datos sin responder): lo que falta puede bajar la clase.', f: 1 });
    if (!m.lab) R.push({ t: 'Hacer un análisis de suelos (fertilidad, pH, aluminio y sales) antes de decidir la siembra.', f: 1 });
    if (cu && cu.grupos.posible.some(function (c) { return /poca lluvia/.test(c.lim.join(' ')); })) R.push({ t: 'Algunos cultivos quedan limitados solo por poca lluvia: con riego podrían mejorar.', f: 3 });
    R.push({ t: 'Validar estos resultados con un profesional del agro y con el mercado local antes de invertir.', f: 0 });
    return { parrafo: p, recomendaciones: R };
  }

  var FUENTES = {
    1: 'IGAC, «Clasificación de las tierras por su capacidad de uso», instructivo IN-GAG-PC05-02 (2021).',
    2: 'Criterio de mes seco del climodiagrama de Walter y Lieth: la lluvia (mm) es menor que el doble de la temperatura (°C).',
    3: 'FAO, base de datos ECOCROP, según el paquete Recocrop (Hijmans y Manners, 2025); método de Hackett (1991).'
  };
  var NOTA = 'Estimación hecha con los datos del reporte. No reemplaza la visita de un profesional, el análisis de suelos ni el estudio de mercado.';

  return { TIPOS: TIPOS, CLASE_TIPOS: CLASE_TIPOS, suit: suit, evalua: evalua, evaluar: evaluar, conclusion: conclusion, FUENTES: FUENTES, NOTA: NOTA, total: DATOS.length };
});

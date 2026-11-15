/* usos.js — «Usos recomendados» (2.29.0): junta lo que la app ya calcula con lo que la persona evalúa en campo y en
 * laboratorio, y pide la clase a capacidad.js (IGAC). Lógica pura, sin pantalla.
 *
 * Lo que pone la app (grupo «app»):
 *   · pendiente: la pendiente media del polígono (perfil.js ajusta un plano a los puntos con altitud);
 *   · piso térmico: la temperatura media anual que usa el análisis (IGAC, Tabla 28);
 *   · humedad: la relación ETP/P del diagrama de Holdridge (IGAC, Tabla 31).
 * Lo de campo y laboratorio se guarda en el polígono como lot.terreno = { erosion: 'ligera', … } (sin clave = «No sé»).
 * Lo escrito en campo manda: si la persona ya contestó algo que la app también calcula, se usa lo de la persona.
 *
 * Distribución de las lluvias (IGAC, Tabla 30, p. 31, descriptiva): se pregunta en campo. La app solo PROPONE una
 * estimación con la lluvia y la temperatura mes por mes, con una regla propia y explícita (no es del IGAC):
 *   · un mes es seco cuando la lluvia (mm) es menor que el doble de la temperatura (°C): criterio del climodiagrama de
 *     H. Walter y H. Lieth, el mismo que ya usa el diagrama de Walter-Lieth de la app;
 *   · un semestre (enero–junio, julio–diciembre) tiene «deficiencias» si tiene al menos un mes seco; si no, es «suficiente»;
 *   · dos semestres suficientes → opción 1; uno con deficiencias → opción 2 o 3 (depende de si necesita riego: lo decide
 *     la persona); los dos con deficiencias → opción 6 u 8 (depende de si permite cultivos: lo decide la persona);
 *   · el exceso de agua no se estima (depende del drenaje del terreno), así que las opciones 4, 5 y 7 solo se eligen en campo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./capacidad.js'), require('./perfil.js'));
  else root.Usos = factory(root.Capacidad, root.Perfil);
})(typeof self !== 'undefined' ? self : this, function (Capacidad, Perfil) {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  var KEYS = Capacidad.VARS.map(function (v) { return v.key; });
  var KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{1,19}$/, VAL_RE = /^[a-zA-Z0-9.+<>-]{1,16}$/;

  // Lo guardado en un polígono, limpio: solo claves conocidas con una categoría que exista (y la marca de estimación)
  function clean(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    var out = {}, n = 0;
    KEYS.forEach(function (k) {
      var v = t[k];
      if (typeof v === 'string' && VAL_RE.test(v) && Capacidad.best(k, v) !== null) { out[k] = v; n++; }
    });
    if (out.lluvias && t.lluviasEst === true) out.lluviasEst = true;
    return n ? out : null;
  }
  // Para copias de seguridad de otras versiones: misma forma, sin conocer las categorías (no se pierde nada si cambian)
  function looseClean(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    var out = {}, n = 0;
    Object.keys(t).slice(0, 40).forEach(function (k) {
      if (!KEY_RE.test(k)) return;
      if (typeof t[k] === 'string' && VAL_RE.test(t[k])) { out[k] = t[k]; n++; }
      else if (k === 'lluviasEst' && t[k] === true) out[k] = true;
    });
    return n ? out : null;
  }

  // Estimación de la distribución de las lluvias (regla explicada arriba)
  var SEM = [[0, 6, 'enero–junio'], [6, 12, 'julio–diciembre']];
  function lluviasEstimate(monthlyT, monthlyP) {
    if (!Array.isArray(monthlyT) || !Array.isArray(monthlyP) || monthlyT.length !== 12 || monthlyP.length !== 12) return null;
    if (!monthlyT.every(isNum) || !monthlyP.every(isNum)) return null;
    var sems = SEM.map(function (s) {
      var dry = [];
      for (var m = s[0]; m < s[1]; m++) if (monthlyP[m] < 2 * monthlyT[m]) dry.push(m);
      return { name: s[2], dry: dry.length, months: dry, ok: dry.length === 0 };
    });
    var bad = sems.filter(function (s) { return !s.ok; }).length;
    var opts = bad === 0 ? ['1'] : bad === 1 ? ['2', '3'] : ['6', '8'];
    var txt = sems.map(function (s) { return s.name + ': ' + (s.ok ? 'sin meses secos' : s.dry + (s.dry === 1 ? ' mes seco' : ' meses secos')); }).join(' · ');
    return { semestres: sems, options: opts, cat: opts.length === 1 ? opts[0] : null, text: txt,
      ask: bad === 1 ? '¿Ese semestre necesita riego para cultivar?' : bad === 2 ? '¿Permite algunos cultivos sin riego?' : '' };
  }

  // Lo que pone la app, a partir del análisis del polígono (a) y sus puntos
  function auto(points, a) {
    var out = { pendiente: null, piso: null, humedad: null };
    var sl = Perfil.slope(points || []);
    if (sl && isNum(sl.pct)) out.pendiente = { pct: sl.pct, cat: Capacidad.pendienteCat(sl.pct), n: sl.n };
    var T = a && a.climate ? a.climate.T : null;
    if (isNum(T)) out.piso = { T: T, cat: Capacidad.pisoCat(T) };
    var r = a && a.result;
    if (r && r.ok && isNum(r.per)) out.humedad = { ratio: r.per, cat: Capacidad.humedadCat(r.per) };
    return out;
  }

  function catName(key, cat) {
    var v = Capacidad.VARS.filter(function (x) { return x.key === key; })[0];
    var c = v && v.cats.filter(function (x) { return x[0] === cat; })[0];
    return c ? c[1] : '';
  }

  // Todo junto para la pantalla y el reporte
  function model(points, a, terreno, monthly) {
    var au = auto(points, a), t = clean(terreno) || {}, datos = {};
    ['pendiente', 'piso', 'humedad'].forEach(function (k) { if (au[k] && au[k].cat) datos[k] = au[k].cat; });
    Object.keys(t).forEach(function (k) { if (k !== 'lluviasEst') datos[k] = t[k]; });      // lo de campo manda
    var ev = Capacidad.evaluar(datos);
    var est = monthly ? lluviasEstimate(monthly.T, monthly.P) : null;
    return { auto: au, terreno: t, datos: datos, eval: ev, lluviasEst: est, fuente: Capacidad.FUENTE };
  }

  // Filas para el reporte: [etiqueta, valor]
  function reportRows(m) {
    if (!m || !m.eval || m.eval.clase === null) return [];
    var e = m.eval, rows = [['Clase de capacidad de uso', 'Clase ' + e.clase + ' · subclase ' + e.subclase]];
    rows.push(['Usos según el IGAC', e.usos.txt + ' (' + e.usos.pag + ')']);
    if (e.limita.length) rows.push(['La limita', e.limita.map(function (x) { return x.name + ': ' + catName(x.key, x.cat); }).join('; ')]);
    rows.push(['Datos evaluados', e.conocidas + ' de ' + e.total + (e.provisional ? ' (provisional: puede bajar con lo que falta)' : '')]);
    if (e.posibleClase5) rows.push(['Revisar en campo', 'Posible clase 5: terreno casi plano con exceso de agua.']);
    if (m.terreno && m.terreno.lluviasEst) rows.push(['Distribución de las lluvias', catName('lluvias', m.terreno.lluvias) + ' (estimada con la lluvia mes por mes)']);
    return rows;
  }
  var NOTE = 'Clase según la metodología del IGAC con los datos evaluados; lo que no se ha evaluado (suelo, heladas, inundaciones…) puede bajarla. Es orientativa y no reemplaza un estudio de suelos.';

  return { clean: clean, looseClean: looseClean, lluviasEstimate: lluviasEstimate, auto: auto, model: model, reportRows: reportRows, catName: catName, NOTE: NOTE };
});

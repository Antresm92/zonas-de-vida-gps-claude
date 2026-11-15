/* datos.js — la información de cada polígono (2.25.0). Lógica pura, sin pantalla.
 *
 * Un polígono guarda dos clases de datos para su análisis:
 *   · la altitud de cada punto, con su origen (altSrc): 'gps' (medida en campo), 'manual' (escrita a mano) o 'internet';
 *   · su clima (climate): lo escrito a mano (tManual, pManual, monthlyManual y la altitud corregida altOverride)
 *     y lo traído de internet (online), que se guarda aparte.
 * La regla de la app es que lo escrito a mano manda: internet solo llena lo que falta.
 * Aquí se cuenta qué tiene cada polígono (status), se borra lo que la persona elija (clean) y se copia el clima de un
 * polígono a otro sin pisar lo escrito a mano (copyClimate). Lo usa js/ui-completar.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Datos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  var MANUAL = ['tManual', 'pManual', 'monthlyManual'];      // el clima escrito a mano
  // Lo que se puede limpiar, en el orden en que sale en la hoja
  var PARTS = ['online', 'manual', 'altOverride', 'altInternet', 'altManual', 'altGps'];

  function src(pt) { return pt.altSrc || 'manual'; }     // un punto con altitud y sin origen guardado es de antes: se tomó como escrita
  function hasManualClimate(c) { return !!c && MANUAL.some(function (k) { return c[k] !== undefined && c[k] !== null; }); }

  // Qué tiene un polígono: cuántos puntos, cuántos sin altitud y de dónde viene la de los demás, y qué clima guarda
  function status(l) {
    var pts = (l && l.points) || [], c = (l && l.climate) || {};
    var s = { points: pts.length, noAlt: 0, altGps: 0, altManual: 0, altInternet: 0,
      online: !!c.online, onlineDate: c.online && isNum(c.online.date) ? c.online.date : null,
      manual: hasManualClimate(c), altOverride: isNum(c.altOverride) };
    pts.forEach(function (pt) {
      if (!isNum(pt.alt)) { s.noAlt++; return; }
      var k = src(pt);
      if (k === 'gps') s.altGps++; else if (k === 'internet') s.altInternet++; else s.altManual++;
    });
    // le falta algo que internet puede traer: puntos sin altitud o clima sin descargar (y sin datos a mano que lo reemplacen)
    s.missing = s.points > 0 && (s.noAlt > 0 || (!s.online && !(isNum(c.tManual) && isNum(c.pManual))));
    return s;
  }
  // Cuánto hay de cada parte que se puede limpiar (0 = nada que borrar)
  function counts(l) {
    var s = status(l);
    return { online: s.online ? 1 : 0, manual: s.manual ? 1 : 0, altOverride: s.altOverride ? 1 : 0,
      altInternet: s.altInternet, altManual: s.altManual, altGps: s.altGps };
  }

  // Borra lo marcado en «what» ({ online: true, altGps: true… }). Devuelve cuánto se borró de cada parte.
  // La altitud del GPS que se borra queda guardada en altGps (si la app la tenía), así que «Restaurar altitud del GPS» la recupera.
  function clean(l, what) {
    what = what || {};
    var c = l.climate || (l.climate = {}), done = { online: 0, manual: 0, altOverride: 0, altInternet: 0, altManual: 0, altGps: 0 };
    if (what.online && c.online) { delete c.online; done.online = 1; }
    if (what.manual && hasManualClimate(c)) { MANUAL.forEach(function (k) { delete c[k]; }); done.manual = 1; }
    if (what.altOverride && c.altOverride !== undefined) { delete c.altOverride; done.altOverride = 1; }
    (l.points || []).forEach(function (pt) {
      if (!isNum(pt.alt)) return;
      var k = src(pt), part = k === 'gps' ? 'altGps' : k === 'internet' ? 'altInternet' : 'altManual';
      if (!what[part]) return;
      if (k === 'gps' && !isNum(pt.altGps)) pt.altGps = pt.alt;
      delete pt.alt; delete pt.altSrc; done[part]++;
    });
    done.total = PARTS.reduce(function (t, k) { return t + done[k]; }, 0);
    return done;
  }

  function copy(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  // Copia el clima de «from» a «to». Si «to» no tiene clima escrito a mano, recibe todo (como siempre: 'full');
  // si lo tiene, conserva lo suyo y solo recibe lo de internet, que llena lo que le falte ('kept').
  // La altitud corregida a mano de «to» nunca se pisa (cada polígono tiene la suya).
  function copyClimate(from, to) {
    var fc = (from && from.climate) || {}, tc = to.climate || {}, own = hasManualClimate(tc), n = {};
    Object.keys(fc).forEach(function (k) {
      if (k === 'altOverride') return;
      if (own && MANUAL.indexOf(k) >= 0) return;
      n[k] = copy(fc[k]);
    });
    if (own) MANUAL.forEach(function (k) { if (tc[k] !== undefined) n[k] = copy(tc[k]); });
    if (tc.altOverride !== undefined) n.altOverride = tc.altOverride;
    to.climate = n;
    return own ? 'kept' : 'full';
  }

  return { MANUAL: MANUAL, PARTS: PARTS, hasManualClimate: hasManualClimate, status: status, counts: counts, clean: clean, copyClimate: copyClimate };
});

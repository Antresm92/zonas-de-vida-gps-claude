/* fmt.js — formato de números y coordenadas para pantalla e informes (es-CO). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.Fmt = factory(root.Geo);
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  // Número con coma decimal y sin separador de miles (2640, 14,1)
  function num(n, d) {
    if (!isNum(n)) return '—';
    d = d === undefined ? 1 : d;
    return n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
  }
  // Con separador de miles (para áreas: 10.000 m²)
  function grouped(n, d) {
    if (!isNum(n)) return '—';
    d = d === undefined ? 0 : d;
    return n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
  }
  // Coordenada decimal con punto (para copiar a otras apps de mapas)
  function coord(v, d) { return isNum(v) ? v.toFixed(d === undefined ? 5 : d) : '—'; }
  function latlon(lat, lon, d) { return coord(lat, d) + ', ' + coord(lon, d); }
  function dms(lat, lon) { return Geo.toDMS(lat, 'lat', 1) + '  ' + Geo.toDMS(lon, 'lon', 1); }

  function dist(m) {
    if (!isNum(m)) return '—';
    if (m >= 10000) return grouped(m / 1000, 2) + ' km';
    if (m >= 1000) return num(m / 1000, 2) + ' km';
    return num(m, m < 10 ? 2 : m < 100 ? 1 : 0) + ' m';
  }

  // Área con la cantidad de decimales que importa en cada unidad
  var UNITS = {
    ha: { label: 'ha', long: 'hectáreas', get: function (u) { return u.ha; }, d: function (v) { return v < 1 ? 4 : v < 100 ? 2 : 1; } },
    m2: { label: 'm²', long: 'metros cuadrados', get: function (u) { return u.m2; }, d: function () { return 0; }, group: true },
    km2: { label: 'km²', long: 'kilómetros cuadrados', get: function (u) { return u.km2; }, d: function (v) { return v < 1 ? 4 : 2; } },
    fanegadas: { label: 'fanegadas', long: 'fanegadas (6.400 m²)', get: function (u) { return u.fanegadas; }, d: function (v) { return v < 1 ? 3 : v < 100 ? 2 : 1; } }
  };
  function area(units, key) {
    var u = UNITS[key] || UNITS.ha;
    var v = u.get(units);
    var d = u.d(v);
    return (u.group ? grouped(v, d) : num(v, d)) + ' ' + u.label;
  }

  function date(ts) {
    var d = new Date(ts);
    if (!isFinite(d.getTime())) return '';
    try { return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }

  return { num: num, grouped: grouped, coord: coord, latlon: latlon, dms: dms, dist: dist, area: area, date: date, UNITS: UNITS };
});

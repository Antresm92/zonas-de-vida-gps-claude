'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Fmt = require('../www/js/fmt.js');
const Geo = require('../www/js/geo.js');

test('num: coma decimal, sin separador de miles y guion si no es número', () => {
  assert.equal(Fmt.num(14.123, 1), '14,1');
  assert.equal(Fmt.num(2640.4, 0), '2640');
  assert.equal(Fmt.num(12345.678, 2), '12345,68');
  assert.equal(Fmt.num(7), '7,0');                       // sin decimales pedidos: uno
  for (const malo of [NaN, Infinity, null, undefined, '5']) assert.equal(Fmt.num(malo, 1), '—');
});

test('grouped: separador de miles con punto', () => {
  assert.equal(Fmt.grouped(10000), '10.000');
  assert.equal(Fmt.grouped(1234567.891, 1), '1.234.567,9');
  assert.equal(Fmt.grouped(undefined), '—');
});

test('coord / latlon / dms', () => {
  assert.equal(Fmt.coord(4.609712345), '4.60971');
  assert.equal(Fmt.coord(-74.08175, 2), '-74.08');
  assert.equal(Fmt.coord(null), '—');
  assert.equal(Fmt.latlon(4.6097, -74.0817), '4.60970, -74.08170');
  assert.equal(Fmt.latlon(4.6097, -74.0817, 6), '4.609700, -74.081700');
  const d = Fmt.dms(4.6097, -74.0817);
  assert.match(d, /°/); assert.match(d, /N/); assert.match(d, /W/);
});

test('dist: metros, kilómetros y miles de kilómetros', () => {
  assert.equal(Fmt.dist(5), '5,00 m');
  assert.equal(Fmt.dist(50), '50,0 m');
  assert.equal(Fmt.dist(500), '500 m');
  assert.equal(Fmt.dist(1500), '1,50 km');
  assert.equal(Fmt.dist(25000), '25,00 km');
  assert.equal(Fmt.dist(1234567), '1.234,57 km');
  assert.equal(Fmt.dist(NaN), '—');
});

test('area: cada unidad con los decimales que importan', () => {
  const u = Geo.areaUnits(216517.1);                     // finca de ejemplo (~21,65 ha)
  assert.equal(Fmt.area(u, 'ha'), '21,65 ha');
  assert.equal(Fmt.area(u, 'm2'), '216.517 m²');
  assert.equal(Fmt.area(u, 'km2'), '0,2165 km²');
  assert.equal(Fmt.area(u, 'fanegadas'), '33,83 fanegadas');
  assert.equal(Fmt.area(u, 'desconocida'), '21,65 ha');   // cae a hectáreas
  assert.equal(Fmt.area(Geo.areaUnits(5000), 'ha'), '0,5000 ha');
  assert.equal(Fmt.area(Geo.areaUnits(5000), 'fanegadas'), '0,781 fanegadas');
  assert.equal(Fmt.area(Geo.areaUnits(5e6), 'ha'), '500,0 ha');
  assert.equal(Fmt.area(Geo.areaUnits(5e6), 'km2'), '5,00 km²');
  assert.equal(Fmt.area(Geo.areaUnits(5e6), 'fanegadas'), '781,3 fanegadas');
});

test('date: fecha larga en español y vacío si no es fecha', () => {
  assert.match(Fmt.date(Date.UTC(2026, 5, 15, 12)), /15 de junio de 2026/);
  assert.equal(Fmt.date(NaN), '');
  assert.equal(Fmt.date('no es fecha'), '');
});

'use strict';
/* Casos límite del análisis: orígenes mezclados de altitud, márgenes según el origen del clima, zona nival y proyectos vacíos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');

const vacia = new Climate.Memory();
const linea = (alts, srcs) => alts.map((a, i) => ({ lat: 4.6 + i * 0.001, lon: -74.1, alt: a, altSrc: srcs ? srcs[i] : 'gps', name: i % 2 ? undefined : 'N' + i }));

test('altitud: una sola fuente la nombra; varias se llaman "varias fuentes"; sin puntos con altitud usa la de internet', () => {
  const una = A.altitudeOf(linea([2600, 2650], ['gps', 'gps']), {});
  assert.equal(una.src, 'gps'); assert.equal(una.srcLabel, 'GPS'); assert.equal(una.n, 2);
  const mixta = A.altitudeOf(linea([2600, 2650, 2700], ['gps', 'manual', 'internet']), {});
  assert.equal(mixta.src, 'mixta'); assert.equal(mixta.srcLabel, 'varias fuentes');
  const rara = A.altitudeOf([{ lat: 1, lon: 1, alt: 100, altSrc: 'archivo' }, { lat: 1, lon: 1, alt: 110 }], {});
  assert.equal(rara.src, 'mixta');
  const archivo = A.altitudeOf([{ lat: 1, lon: 1, alt: 100, altSrc: 'archivo' }], {});
  assert.equal(archivo.srcLabel, 'archivo');
  const sinSrc = A.altitudeOf([{ lat: 1, lon: 1, alt: 100 }], {});
  assert.equal(sinSrc.src, 'manual'); assert.equal(sinSrc.srcLabel, 'escrita a mano');
  const net = A.altitudeOf([{ lat: 1, lon: 1 }], { online: { elevation: 2300 } });
  assert.equal(net.value, 2300); assert.equal(net.src, 'internet'); assert.equal(net.min, null);
  const over = A.altitudeOf(linea([2600]), { altOverride: 2000 });
  assert.equal(over.value, 2000); assert.equal(over.src, 'manual');
  assert.equal(A.altitudeOf([], null).value, null);
});

test('análisis: sin puntos, con propiedades ausentes o con puntos no válidos queda vacío', () => {
  assert.equal(A.analyze({}, {}).empty, true);
  assert.equal(A.analyze({ points: [{ lat: 'x', lon: 1 }, null, { lat: 95, lon: 0 }] }).empty, true);
  assert.equal(A.analyze({ points: [] }, undefined).n, 0);
});

test('márgenes de error según el origen del clima: internet corregido, sin corregir y memoria', () => {
  const online = { T: 15, P: 1200, monthlyT: new Array(12).fill(15), monthlyP: null, elevCell: 2000, elevation: 2600, lat: 4.6, lon: -74.1 };
  const corregido = A.analyze({ points: linea([2600]), climate: { online } }, { memory: vacia });
  assert.deepEqual(corregido.margins, { t: A.T_MARGIN.online, p: A.P_MARGIN.online });
  assert.ok(corregido.alternatives.length > 0);
  const sinCorregir = A.analyze({ points: linea([2600]), climate: { online: Object.assign({}, online, { elevCell: null }) } }, { memory: vacia });
  assert.equal(sinCorregir.margins.t, A.T_MARGIN.onlineSinCorregir);
  const mem = new Climate.Memory(); mem.add([{ lat: 4.6, lon: -74.1, T: 15, P: 1500, alt: 2000 }]);
  const deMemoria = A.analyze({ points: linea([2600]) }, { memory: mem });
  assert.deepEqual(deMemoria.margins, { t: A.T_MARGIN.memoria, p: A.P_MARGIN.memoria }); assert.equal(deMemoria.quality, 2);
  const manual = A.analyze({ points: linea([2600]), climate: { tManual: 14, pManual: 1200 } }, { memory: vacia });
  assert.deepEqual(manual.margins, { t: A.T_MARGIN.manual, p: A.P_MARGIN.manual }); assert.equal(manual.quality, 3);
  const estimada = A.analyze({ points: linea([2600]), climate: { pManual: 1200 } }, { memory: vacia });
  assert.equal(estimada.climate.TSrc, 'estimada'); assert.equal(estimada.margins.t, Climate.estimateUncertainty(4.6)); assert.equal(estimada.quality, 1);
});

test('zona nival: no se ofrecen zonas vecinas; sin lluvia queda incompleto y pide la precipitación', () => {
  const nival = A.analyze({ points: linea([5200, 5200, 5200]), climate: { pManual: 800 } }, { memory: vacia });
  assert.equal(nival.result.zone.symbol, 'N'); assert.deepEqual(nival.alternatives, []);
  const sinP = A.analyze({ points: linea([2600, 2700]) }, { memory: vacia });
  assert.equal(sinP.needs, 'precipitacion'); assert.equal(sinP.result.partial, true); assert.equal(sinP.quality, 0);
  const sinAlt = A.analyze({ points: [{ lat: 4.6, lon: -74.1 }, { lat: 4.7, lon: -74.1 }, { lat: 4.7, lon: -74.2 }] }, { memory: vacia });
  assert.equal(sinAlt.needs, 'altitud'); assert.equal(sinAlt.result, null);
});

test('zonas por vértice: salta los puntos sin altitud, pone nombre de reserva y avisa si cambian de zona', () => {
  const r = A.analyze({ points: [{ lat: 4.6, lon: -74.1, alt: 3000, name: 'Alto' }, { lat: 4.601, lon: -74.1, alt: 200 }, { lat: 4.602, lon: -74.1 }],
    climate: { tManual: 15, pManual: 1500 } }, { memory: vacia });
  assert.deepEqual(r.vertexZones.map((v) => v.name), ['Alto', 'P2']);
  assert.equal(r.distinctZones.length, 2);
  assert.ok(r.warnings.some((w) => /toca 2 zonas/.test(w)));
  const conMeses = A.analyze({ points: [{ lat: 4.6, lon: -74.1, alt: 3000 }, { lat: 4.601, lon: -74.1, alt: 2000 }, { lat: 4.602, lon: -74.1, alt: 1000 }],
    climate: { monthlyManual: { T: new Array(12).fill(15), P: new Array(12).fill(100) } } }, { memory: vacia });
  assert.ok(conMeses.vertexZones.length >= 2); assert.equal(conMeses.climate.monthlyT.length, 12);
  assert.ok(A.analyze({ points: linea([2000, 2050]), climate: { tManual: 15, pManual: 1500 } }, { memory: vacia }).vertexZones.length === 0, 'menos de 100 m de diferencia: no se separan');
});

test('un punto o dos puntos: no hay polígono, el perímetro es la distancia', () => {
  const uno = A.analyze({ points: linea([2600]) }, { memory: vacia });
  assert.equal(uno.polygon, false); assert.equal(uno.perimeter, 0); assert.equal(uno.area, undefined);
  const dos = A.analyze({ points: linea([2600, 2610]) }, { memory: vacia });
  assert.ok(dos.perimeter > 100);
});

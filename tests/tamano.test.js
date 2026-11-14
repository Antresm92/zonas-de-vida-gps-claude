'use strict';
/* Tamaño fuera de lo normal (2.23.7): el punto que más se aleja de los demás. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Mapa = require('../www/js/mapa.js');

test('outlier: encuentra el punto con la coordenada mal escrita aunque arrastre el promedio', () => {
  const pts = [{ lat: 4.600, lon: -74.080 }, { lat: 4.600, lon: -74.070 }, { lat: 4.610, lon: -74.070 }, { lat: 46.10, lon: -74.080 }, { lat: 4.610, lon: -74.080 }];   // al cuarto le sobra un dígito
  assert.equal(Mapa.outlier(pts), 3);
  // un dígito de menos en la longitud
  assert.equal(Mapa.outlier([{ lat: 4.6, lon: -74.08 }, { lat: 4.6, lon: -7.407 }, { lat: 4.61, lon: -74.07 }]), 1);
  // con dos puntos, cualquiera de los dos está «lejos»: devuelve uno válido
  assert.ok([0, 1].includes(Mapa.outlier([{ lat: 4.6, lon: -74.08 }, { lat: 4.7, lon: -74.08 }])));
  // sin puntos suficientes o con datos rotos
  assert.equal(Mapa.outlier([]), -1); assert.equal(Mapa.outlier([{ lat: 4.6, lon: -74.08 }]), -1); assert.equal(Mapa.outlier(null), -1);
  assert.equal(Mapa.outlier([{ lat: 4.6, lon: -74.08 }, null, { lat: NaN, lon: 0 }, { lat: 10, lon: -74.08 }, { lat: 4.61, lon: -74.08 }]), 3, 'los puntos rotos se saltan');
  assert.equal(Mapa.HUGE_HA, 50000);
});

'use strict';
/* La información de cada polígono (2.25.0): qué tiene, limpiar lo que se elija y copiar el clima sin pisar lo escrito a mano. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Datos = require('../www/js/datos.js');

function lote() {
  return {
    id: 'a', name: 'Potrero',
    points: [
      { id: '1', lat: 4.6, lon: -74.08, alt: 2600, altSrc: 'gps' },
      { id: '2', lat: 4.61, lon: -74.08, alt: 2610, altSrc: 'internet' },
      { id: '3', lat: 4.61, lon: -74.07, alt: 2620, altSrc: 'manual' },
      { id: '4', lat: 4.6, lon: -74.07, alt: 2630 },          // de una versión vieja: sin origen guardado → escrita
      { id: '5', lat: 4.605, lon: -74.075 }                    // sin altitud
    ],
    climate: { tManual: 14.5, online: { T: 15, P: 1200, date: 1763190000000 }, altOverride: 2640 }
  };
}

test('status: cuenta los puntos sin altitud y de dónde viene la de los demás, y qué clima guarda', () => {
  const s = Datos.status(lote());
  assert.equal(s.points, 5); assert.equal(s.noAlt, 1);
  assert.equal(s.altGps, 1); assert.equal(s.altInternet, 1); assert.equal(s.altManual, 2);
  assert.equal(s.online, true); assert.equal(s.onlineDate, 1763190000000);
  assert.equal(s.manual, true); assert.equal(s.altOverride, true);
  assert.equal(s.missing, true, 'le falta la altitud de un punto');
  const vacio = Datos.status({ points: [], climate: {} });
  assert.equal(vacio.points, 0); assert.equal(vacio.missing, false);
  const listo = Datos.status({ points: [{ lat: 1, lon: 1, alt: 100, altSrc: 'gps' }], climate: { online: { T: 1, P: 1, date: 1 } } });
  assert.equal(listo.missing, false);
  const aMano = Datos.status({ points: [{ lat: 1, lon: 1, alt: 100 }], climate: { tManual: 20, pManual: 1500 } });
  assert.equal(aMano.missing, false, 'con temperatura y lluvia escritas no le falta clima');
  assert.equal(Datos.status({ points: [{ lat: 1, lon: 1, alt: 100 }], climate: {} }).missing, true, 'sin clima le falta');
  assert.equal(Datos.status(null).points, 0);
});

test('counts: cuánto hay de cada parte que se puede limpiar', () => {
  assert.deepEqual(Datos.counts(lote()), { online: 1, manual: 1, altOverride: 1, altInternet: 1, altManual: 2, altGps: 1 });
  assert.deepEqual(Datos.counts({ points: [], climate: {} }), { online: 0, manual: 0, altOverride: 0, altInternet: 0, altManual: 0, altGps: 0 });
  assert.equal(Datos.hasManualClimate({ monthlyManual: { T: [], P: null } }), true);
  assert.equal(Datos.hasManualClimate({ online: {} }), false);
  assert.equal(Datos.hasManualClimate(null), false);
});

test('clean: borra solo lo marcado y deja el resto', () => {
  const l = lote();
  const d = Datos.clean(l, { online: true, altInternet: true });
  assert.equal(d.online, 1); assert.equal(d.altInternet, 1); assert.equal(d.total, 2);
  assert.equal(l.climate.online, undefined);
  assert.equal(l.climate.tManual, 14.5, 'lo escrito a mano queda');
  assert.equal(l.climate.altOverride, 2640);
  assert.equal(l.points[1].alt, undefined); assert.equal(l.points[1].altSrc, undefined);
  assert.equal(l.points[0].alt, 2600, 'la del GPS queda'); assert.equal(l.points[2].alt, 2620);
  assert.equal(l.points.length, 5, 'los puntos no se borran');
  assert.equal(l.points[1].lat, 4.61, 'ni su ubicación');
});

test('clean: lo escrito a mano, la altitud corregida y las altitudes a mano y del GPS', () => {
  const l = lote();
  l.climate.pManual = 1300; l.climate.monthlyManual = { T: [1], P: null };
  const d = Datos.clean(l, { manual: true, altOverride: true, altManual: true, altGps: true });
  assert.equal(d.manual, 1); assert.equal(d.altOverride, 1); assert.equal(d.altManual, 2); assert.equal(d.altGps, 1); assert.equal(d.total, 5);
  assert.deepEqual(Object.keys(l.climate), ['online'], 'solo queda lo de internet');
  assert.equal(l.points[0].alt, undefined);
  assert.equal(l.points[0].altGps, 2600, 'la medida del GPS queda guardada para «Restaurar altitud del GPS»');
  assert.equal(l.points[1].alt, 2610, 'la de internet queda');
  assert.equal(l.points[3].alt, undefined, 'la de una versión vieja cuenta como escrita');
});

test('clean: lo que no hay no se cuenta, y un polígono sin clima no falla', () => {
  const l = { points: [{ lat: 1, lon: 1, alt: 5, altSrc: 'gps', altGps: 7 }] };
  const d = Datos.clean(l, { online: true, manual: true, altOverride: true, altGps: true });
  assert.equal(d.total, 1); assert.equal(d.online, 0);
  assert.equal(l.points[0].altGps, 7, 'si ya tenía la del GPS guardada, no se cambia');
  assert.deepEqual(l.climate, {});
  assert.equal(Datos.clean({ points: [], climate: {} }).total, 0, 'sin nada marcado no borra nada');
});

test('copyClimate: sin datos a mano recibe todo, menos la altitud corregida', () => {
  const from = { climate: { tManual: 14.5, pManual: 1200, online: { T: 15, P: 1100 }, altOverride: 2640 } };
  const to = { climate: {} };
  assert.equal(Datos.copyClimate(from, to), 'full');
  assert.deepEqual(to.climate, { tManual: 14.5, pManual: 1200, online: { T: 15, P: 1100 } });
  to.climate.online.T = 99;
  assert.equal(from.climate.online.T, 15, 'es una copia, no el mismo objeto');
  const conAlt = { climate: { altOverride: 1800 } };
  Datos.copyClimate(from, conAlt);
  assert.equal(conAlt.climate.altOverride, 1800, 'su altitud corregida se conserva');
});

test('copyClimate: con datos a mano los conserva y solo recibe lo de internet', () => {
  const from = { climate: { tManual: 14.5, pManual: 1200, monthlyManual: { T: [1], P: [2] }, online: { T: 15, P: 1100 } } };
  const to = { climate: { pManual: 2000, online: { T: 30, P: 10 }, altOverride: 900 } };
  assert.equal(Datos.copyClimate(from, to), 'kept');
  assert.equal(to.climate.pManual, 2000, 'su lluvia escrita queda');
  assert.equal(to.climate.tManual, undefined, 'no recibe la temperatura escrita del otro');
  assert.equal(to.climate.monthlyManual, undefined);
  assert.deepEqual(to.climate.online, { T: 15, P: 1100 }, 'recibe lo de internet, que llena lo que le falta');
  assert.equal(to.climate.altOverride, 900);
  const sinClima = { climate: { tManual: 10 } };
  assert.equal(Datos.copyClimate({}, sinClima), 'kept');
  assert.deepEqual(sinClima.climate, { tManual: 10 });
  const nada = {};
  assert.equal(Datos.copyClimate({ climate: { online: { T: 1 } } }, nada), 'full');
  assert.deepEqual(nada.climate, { online: { T: 1 } });
});

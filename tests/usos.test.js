'use strict';
/* «Usos recomendados» (2.29.0): lo que pone la app, lo de campo que manda, la estimación de las lluvias, el reporte y que la
   evaluación se guarde y viaje en la copia de seguridad. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Usos = require('../www/js/usos.js');
const Backup = require('../www/js/backup.js');

// Un plano que sube 30 m cada 100 m hacia el norte (30 %)
function rampa() {
  const pts = [];
  for (const [dx, dy] of [[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]]) pts.push({ lat: 5 + dy / 111320, lon: -75 + dx / 110900, alt: 1500 + 0.3 * dy });
  return pts;
}
const aTemplado = { climate: { T: 21 }, result: { ok: true, per: 0.7 } };

test('lo que pone la app: pendiente, piso térmico y humedad', () => {
  const au = Usos.auto(rampa(), aTemplado);
  assert.ok(Math.abs(au.pendiente.pct - 30) < 1, au.pendiente.pct); assert.equal(au.pendiente.cat, '25-50'); assert.equal(au.pendiente.n, 5);
  assert.deepEqual(au.piso, { T: 21, cat: 'templado' });
  assert.deepEqual(au.humedad, { ratio: 0.7, cat: 'humedo' });
  const nada = Usos.auto([{ lat: 5, lon: -75 }], {});
  assert.deepEqual(nada, { pendiente: null, piso: null, humedad: null, pendienteNo: null });
  assert.equal(Usos.auto(rampa(), { climate: { T: 21 }, result: { ok: false } }).humedad, null);
});

test('la clase con lo de la app y lo de campo; lo de campo manda', () => {
  let m = Usos.model(rampa(), aTemplado, null, null);
  assert.equal(m.eval.clase, 6); assert.equal(m.eval.subclase, '6p'); assert.equal(m.eval.conocidas, 3);
  m = Usos.model(rampa(), aTemplado, { erosion: 'severa' }, null);
  assert.equal(m.eval.subclase, '7e');
  m = Usos.model(rampa(), aTemplado, { pendiente: '7-12' }, null);
  assert.equal(m.datos.pendiente, '7-12', 'la pendiente medida en campo reemplaza la calculada');
  assert.equal(m.eval.clase, 3);
  m = Usos.model([], {}, { inventada: 'x', erosion: 'nada' }, null);
  assert.equal(m.eval.clase, null, 'lo que no existe no cuenta');
});

test('clean y looseClean: solo claves y categorías válidas; la marca de estimación solo con lluvias', () => {
  assert.deepEqual(Usos.clean({ erosion: 'ligera', lluvias: '2', lluviasEst: true, x: 'y', drenaje: '<script>' }), { erosion: 'ligera', lluvias: '2', lluviasEst: true });
  assert.deepEqual(Usos.clean({ erosion: 'ligera', lluviasEst: true }), { erosion: 'ligera' });
  assert.equal(Usos.clean({}), null); assert.equal(Usos.clean([]), null); assert.equal(Usos.clean('x'), null);
  assert.deepEqual(Usos.looseClean({ nuevaVariable: 'cat-1', 'mal clave': 'x', erosion: 'a b', lluviasEst: true }), { nuevaVariable: 'cat-1', lluviasEst: true });
  assert.equal(Usos.looseClean(null), null);
});

test('estimación de las lluvias: mes seco si P < 2T; por semestres; el exceso no se estima', () => {
  const T = Array(12).fill(20);
  let e = Usos.lluviasEstimate(T, Array(12).fill(150));
  assert.equal(e.cat, '1'); assert.deepEqual(e.options, ['1']); assert.equal(e.text, 'enero–junio: sin meses secos · julio–diciembre: sin meses secos'); assert.equal(e.ask, '');
  const P = Array(12).fill(150); P[1] = 30; P[2] = 39.9;                    // febrero y marzo secos (menos de 40 mm con 20 °C)
  e = Usos.lluviasEstimate(T, P);
  assert.equal(e.cat, null); assert.deepEqual(e.options, ['2', '3']); assert.deepEqual(e.semestres[0].months, [1, 2]);
  assert.match(e.text, /^enero–junio: 2 meses secos · julio–diciembre: sin meses secos$/); assert.match(e.ask, /riego/);
  P[8] = 10;
  e = Usos.lluviasEstimate(T, P);
  assert.deepEqual(e.options, ['6', '8']); assert.match(e.text, /julio–diciembre: 1 mes seco/); assert.match(e.ask, /cultivos/);
  const borde = Array(12).fill(40);
  assert.equal(Usos.lluviasEstimate(T, borde).cat, '1', 'P igual a 2T no es seco');
  assert.equal(Usos.lluviasEstimate(T.slice(0, 11), P), null); assert.equal(Usos.lluviasEstimate(null, P), null);
  assert.equal(Usos.lluviasEstimate(T, P.map((x, i) => (i ? x : NaN))), null);
  const m = Usos.model(rampa(), aTemplado, null, { T, P: Array(12).fill(150) });
  assert.equal(m.lluviasEst.cat, '1');
});

test('filas del reporte: clase, usos con página, qué limita, cuántos datos y la estimación anotada', () => {
  let m = Usos.model(rampa(), aTemplado, { lluvias: '1', lluviasEst: true }, null);
  const r = Usos.reportRows(m);
  assert.deepEqual(r[0], ['Clase de capacidad de uso', 'Clase 6 · subclase 6p']);
  assert.match(r[1][1], /semiperennes o perennes.*\(pp\. 10–11\)$/);
  assert.deepEqual(r[2], ['La limita', 'Pendiente: 25–50 %']);
  assert.deepEqual(r[3], ['Datos evaluados', '4 de 21 (provisional: puede bajar con lo que falta)']);
  assert.deepEqual(r[4], ['Pendiente para la clase', '30 %, calculada con altitudes sin dato de origen (margen desconocido)'], '2.35.0');
  assert.deepEqual(r[5], ['Distribución de las lluvias', 'Suficientes los dos semestres (estimada con la lluvia mes por mes)']);
  m = Usos.model([{ lat: 5, lon: -75 }], {}, { pendiente: '0-3', drenaje: 'muypobre' }, null);
  assert.ok(Usos.reportRows(m).some((x) => x[0] === 'Revisar en campo'));
  assert.deepEqual(Usos.reportRows(Usos.model([], {}, null, null)), []);
  assert.deepEqual(Usos.reportRows(null), []);
  assert.equal(Usos.catName('erosion', 'ligera'), 'Ligera'); assert.equal(Usos.catName('x', 'y'), '');
  assert.match(Usos.NOTE, /no reemplaza un estudio de suelos/);
});

test('la evaluación del terreno viaja en la copia de seguridad (y lo que no tiene forma se descarta)', () => {
  const state = { version: 1, currentId: 'p1', projects: [{ id: 'p1', name: 'Finca', created: 1, layers: [], lotId: 'l1',
    lots: [{ id: 'l1', name: 'Predio', kind: 'finca', points: [], climate: {}, nextPoint: 1, mainColor: '#2F8F4E', terreno: { erosion: 'ligera', lluvias: '2', lluviasEst: true, 'x y': 'z', fertilidad: { a: 1 } } }] }] };
  const res = Backup.validate(JSON.parse(Backup.stringify(Backup.create(state, []))), {});
  assert.equal(res.ok, true, res.errors.join(' '));
  const l = res.data.projects[0].lots[0];
  assert.deepEqual(l.terreno, { erosion: 'ligera', lluvias: '2', lluviasEst: true });
});

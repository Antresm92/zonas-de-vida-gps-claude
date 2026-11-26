'use strict';
/* 2.35.1 — la altura del GPS pasa al nivel del mar con el geoide EGM2008 (geoide.js): los valores contra la malla completa de
   2,5' y contra otro modelo de otra fuente (EGM96), el paso de los puntos nuevos y de los de antes (una sola vez y reversible),
   la copia de seguridad, el almacenamiento y lo que dice el reporte. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Geoide = require('../www/js/geoide.js');
const Store = require('../www/js/store.js');
const Backup = require('../www/js/backup.js');
const Report = require('../www/js/report.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg ? msg + ': ' : '') + a + ' ≠ ' + b);
function fakeStorage(init) {
  const data = Object.assign({}, init);
  return { data, getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
// [lugar, lat, lon, N interpolada en la malla de 2,5' de us_nga_egm08_25.tif (PROJ-data), N de EGM96 (egm96-universal, malla de 15' de la NGA)]
const LUGARES = [['Bogotá', 4.711, -74.072, 22.42, 21.53], ['Medellín', 6.244, -75.581, 24.00, 23.94], ['Cali', 3.452, -76.532, 27.38, 26.89],
  ['Barranquilla', 10.964, -74.796, -7.65, -8.80], ['Pasto', 1.214, -77.281, 28.37, 26.66], ['Leticia', -4.215, -69.940, 18.09, 18.40],
  ['San Andrés', 12.584, -81.701, 3.23, 2.57], ['Villavicencio', 4.142, -73.627, 16.39, 14.89], ['Puerto Carreño', 6.189, -67.486, -9.64, -9.88],
  ['Tumaco', 1.807, -78.764, 14.83, 14.20]];

test('la malla de 5\' da lo mismo que la de 2,5\' de EGM2008 (a 0,1 m) y se parece a EGM96, otro modelo de otra fuente (a 2 m)', () => {
  for (const [n, lat, lon, e08, e96] of LUGARES) {
    const v = Geoide.undulation(lat, lon);
    near(v, e08, 0.1, n + ' contra EGM2008 de 2,5\'');
    near(v, e96, 2, n + ' contra EGM96');
  }
  assert.equal(Geoide.undulation(4.711, -74.072), 22.41, 'redondeada al centímetro');
});

test('fuera de la caja de Colombia, o sin coordenadas, no hay geoide; los bordes sí', () => {
  for (const [lat, lon] of [[14.001, -74], [-5.001, -70], [4, -82.001], [4, -65.999], [40.4, -3.7]]) assert.equal(Geoide.undulation(lat, lon), null, lat + ', ' + lon);
  for (const v of [[null, -74], [4, undefined], ['4', -74], [NaN, -74]]) assert.equal(Geoide.undulation(v[0], v[1]), null);
  for (const [lat, lon] of [[14, -82], [-5, -66], [14, -66], [-5, -82]]) assert.equal(typeof Geoide.undulation(lat, lon), 'number', lat + ', ' + lon);
  assert.deepEqual(Geoide.BOX, { latS: -5, latN: 14, lonW: -82, lonE: -66 });
});

test('la altura del GPS pasa al nivel del mar: altitud = altura sobre el elipsoide − N; fuera, se queda; en iPhone ya viene así', () => {
  const g = Geoide.fromDevice(4.711, -74.072, 2672.41);
  assert.equal(g.ref, 'egm2008'); assert.equal(g.n, 22.41); near(g.alt, 2650, 1e-9);
  assert.deepEqual(Geoide.fromDevice(10.964, -74.796, 10).ref, 'egm2008');
  near(Geoide.fromDevice(10.964, -74.796, 10).alt, 17.67, 1e-9, 'donde el geoide está bajo el elipsoide, la altitud sube');
  assert.deepEqual(Geoide.fromDevice(40.4, -3.7, 700), { alt: 700, ref: 'elipsoide' });
  assert.equal(Geoide.fromDevice(4.7, -74.1, null), null); assert.equal(Geoide.fromDevice(4.7, -74.1, undefined), null);
  assert.equal(Geoide.isApple(), false);
  try {
    Geoide.setApple(true);
    assert.deepEqual(Geoide.fromDevice(4.711, -74.072, 2650), { alt: 2650, ref: 'mar' });
  } finally { Geoide.setApple(false); }
});

// Un punto como los guardaba la app antes de la 2.35.1
const viejo = (extra) => Object.assign({ id: 'a', name: 'P1', lat: 4.711, lon: -74.072, alt: 2672.41, altGps: 2672.41, altSrc: 'gps', acc: 4, altAcc: 9, src: 'gps', ts: 1 }, extra);

test('los puntos de antes pasan al nivel del mar una sola vez; los que no son del GPS no se tocan; y se puede deshacer', () => {
  const pts = [viejo(), viejo({ id: 'b', alt: 2600, altSrc: 'manual' }), viejo({ id: 'c', altGps: null, alt: 2610, altSrc: 'internet' }),
    viejo({ id: 'd', altGps: null, alt: 2620, altSrc: 'archivo', src: 'archivo' }), viejo({ id: 'e', lat: 40.4, lon: -3.7, alt: 700, altGps: 700 }),
    viejo({ id: 'f', altGps: null, alt: null, altSrc: null })];
  const antes = JSON.parse(JSON.stringify(pts));
  assert.equal(Geoide.migrate(pts), 2, 'el del GPS y la altitud del GPS guardada del que se escribió a mano');
  near(pts[0].alt, 2650, 1e-9); near(pts[0].altGps, 2650, 1e-9); assert.equal(pts[0].altN, 22.41); assert.equal(pts[0].altRef, 'egm2008');
  assert.equal(pts[1].alt, 2600, 'la escrita a mano se queda'); near(pts[1].altGps, 2650, 1e-9, 'la del GPS guardada para restaurarla sí pasa');
  assert.deepEqual(pts[2], antes[2]); assert.deepEqual(pts[3], antes[3]); assert.deepEqual(pts[5], antes[5]);
  assert.equal(pts[4].alt, 700); assert.equal(pts[4].altRef, 'elipsoide'); assert.equal(pts[4].altN, undefined);
  const una = JSON.stringify(pts);
  assert.equal(Geoide.migrate(pts), 0); assert.equal(JSON.stringify(pts), una, 'una segunda vez no cambia nada');
  assert.equal(Geoide.revert(pts), 2);
  pts.forEach((p, i) => {
    for (const k of Object.keys(antes[i])) {
      if (typeof antes[i][k] === 'number') near(p[k], antes[i][k], 1e-9, p.id + '.' + k); else assert.deepEqual(p[k], antes[i][k], p.id + '.' + k);
    }
    assert.equal(p.altN, undefined); assert.equal(p.altRef, undefined);
  });
  assert.equal(Geoide.migrate(null), 0); assert.equal(Geoide.migrate([null, 3, 'x']), 0);
  try {
    Geoide.setApple(true);
    const p = [viejo()];
    assert.equal(Geoide.migrate(p), 0); assert.equal(p[0].alt, 2672.41); assert.equal(p[0].altRef, 'mar', 'en iPhone los de antes ya eran sobre el nivel del mar');
  } finally { Geoide.setApple(false); }
});

test('al cargar los proyectos guardados, los puntos de antes pasan una sola vez, aunque se guarde y se vuelva a cargar', () => {
  const st = { projects: [{ id: 'p1', name: 'Finca', lots: [{ id: 'l1', name: 'Predio', kind: 'finca', points: [viejo()], climate: {} }], lotId: 'l1', layers: [] }], currentId: 'p1' };
  const disco = fakeStorage({ 'zvg.v1.state': JSON.stringify(st) });
  try {
    Store.setBackend(disco);
    let s = Store.loadState();
    let pt = s.projects[0].lots[0].points[0];
    near(pt.alt, 2650, 1e-9); assert.equal(pt.altRef, 'egm2008'); assert.equal(pt.altN, 22.41);
    Store.saveState(s);
    s = Store.loadState();
    pt = s.projects[0].lots[0].points[0];
    near(pt.alt, 2650, 1e-9, 'no se resta dos veces'); assert.equal(pt.altRef, 'egm2008');
  } finally { Store.setBackend(null); }
});

test('la copia de seguridad lleva cómo quedó la altitud: al restaurarla no se corrige dos veces; una copia de antes se corrige una vez', () => {
  const state = (pts) => ({ version: 1, currentId: 'p1', projects: [{ id: 'p1', name: 'Finca', created: 1, layers: [], lotId: 'l1',
    lots: [{ id: 'l1', name: 'Predio', kind: 'finca', points: pts, climate: {}, nextPoint: 2, mainColor: '#2F8F4E' }] }] });
  const ida = (pts) => Backup.validate(JSON.parse(Backup.stringify(Backup.create(state(pts), []))), {});
  const nuevo = viejo(); Geoide.migrate([nuevo]);
  let res = ida([nuevo]);
  assert.equal(res.ok, true, res.errors.join(' '));
  let p = res.data.projects[0].lots[0].points[0];
  assert.equal(p.altRef, 'egm2008'); assert.equal(p.altN, 22.41); near(p.alt, 2650, 1e-9);
  res.data.projects.forEach(Store.toLots);                   // como al restaurar (app.js, finishRestore)
  near(res.data.projects[0].lots[0].points[0].alt, 2650, 1e-9, 'no se resta dos veces');
  res = ida([viejo()]);
  p = res.data.projects[0].lots[0].points[0];
  assert.equal(p.altRef, undefined); near(p.alt, 2672.41, 1e-9);
  res.data.projects.forEach(Store.toLots);
  p = res.data.projects[0].lots[0].points[0];
  near(p.alt, 2650, 1e-9, 'la copia de antes se corrige al restaurarla'); assert.equal(p.altRef, 'egm2008');
  // marcas que no sirven o en un punto sin altitud del GPS: no se copian
  res = ida([viejo({ altRef: 'luna', altN: 22 }), viejo({ id: 'b', altGps: null, alt: 2600, altSrc: 'manual', altRef: 'egm2008', altN: 22 })]);
  assert.equal(res.data.projects[0].lots[0].points[0].altRef, undefined);
  assert.equal(res.data.projects[0].lots[0].points[1].altRef, undefined);
  res = ida([viejo({ altRef: 'egm2008', altN: 'mucho' })]);
  assert.equal(res.data.projects[0].lots[0].points[0].altRef, 'egm2008', 'sin altN válido igual queda marcado: ya está en el nivel del mar');
  assert.equal(res.data.projects[0].lots[0].points[0].altN, undefined);
});

test('el reporte dice cómo pasaron las altitudes del GPS al nivel del mar', () => {
  const pts = [viejo(), viejo({ id: 'b', lat: 4.6, lon: -74.08 }), viejo({ id: 'c', altSrc: 'manual', alt: 2600 })];
  Geoide.migrate(pts);
  assert.equal(Report.originSummary(pts), '3 con GPS (±4 m). Altitud: 2 del GPS (±9 m; al nivel del mar con el geoide EGM2008: −23,2 a −22,4 m) y 1 a mano.');
  const uno = [viejo()]; Geoide.migrate(uno);
  assert.match(Report.originSummary(uno), /Altitud: 1 del GPS \(±9 m; al nivel del mar con el geoide EGM2008: −22,4 m\)\.$/);
  const bajo = [viejo({ lat: 10.964, lon: -74.796 })]; Geoide.migrate(bajo);
  assert.match(Report.originSummary(bajo), /EGM2008: \+7,7 m\)\.$/, 'donde el geoide está bajo el elipsoide se suma');
  const fuera = [viejo({ lat: 40.4, lon: -3.7 }), viejo({ id: 'b', altRef: 'mar' })]; Geoide.migrate(fuera);
  assert.match(Report.originSummary(fuera), /Altitud: 2 del GPS \(±9 m; 1 ya venía sobre el nivel del mar; 1 sobre el elipsoide, fuera de la zona del geoide\)\.$/);
  assert.match(Report.originSummary([viejo()]), /Altitud: 1 del GPS \(±9 m\)\.$/, 'un punto sin marca (antes de cargarlo) no dice nada');
});

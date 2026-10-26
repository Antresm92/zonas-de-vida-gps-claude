'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../www/js/store.js');

function fakeStorage(init) {
  const data = Object.assign({}, init);
  return { data, getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('defaultState: un proyecto vacío con los ajustes por defecto', () => {
  Store.setBackend(null);
  const s = Store.defaultState();
  assert.equal(s.projects.length, 1);
  assert.equal(s.currentId, s.projects[0].id);
  assert.deepEqual(s.projects[0].points, []);
  assert.deepEqual(s.projects[0].layers, []);
  assert.equal(s.projects[0].mainColor, Store.MAIN_COLOR);
  assert.deepEqual(s.settings, { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' });
});

test('newProject: nombre por defecto y ids distintos', () => {
  assert.equal(Store.newProject().name, 'Proyecto sin nombre');
  const a = Store.newProject('Finca'), b = Store.newProject('Finca');
  assert.equal(a.name, 'Finca');
  assert.notEqual(a.id, b.id);
  assert.equal(a.nextPoint, 1);
  assert.notEqual(Store.uid(), Store.uid());
});

test('loadState: sin datos, con JSON dañado o sin proyectos devuelve el estado inicial', () => {
  Store.setBackend(fakeStorage());
  assert.equal(Store.loadState().projects.length, 1);
  Store.setBackend(fakeStorage({ 'zvg.v1.state': '{esto no es json' }));
  assert.equal(Store.loadState().projects[0].name, 'Mi primer proyecto');
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify({ projects: [] }) }));
  assert.equal(Store.loadState().projects[0].name, 'Mi primer proyecto');
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify('texto') }));
  assert.equal(Store.loadState().projects.length, 1);
});

test('loadState: completa y corrige proyectos guardados con versiones anteriores', () => {
  const raw = {
    v: 1, currentId: 'no-existe',
    projects: [
      { id: 'a', name: 'Vieja', points: 'mal' },                                    // sin climate/nextPoint/layers
      { id: 'b', name: 'Con capas', points: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }, { lat: 2, lon: 3 }], climate: { pManual: 900 },
        layers: [null, { name: 'sin puntos' }, { id: 'l1', points: [{ lat: 1, lon: 1 }] }], mainColor: 'verde' },
      { id: 'c', name: 'Color bueno', mainColor: '#AABBCC' }
    ],
    settings: { areaUnit: 'm2', minAcc: 7, csvStyle: 'raro' }
  };
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify(raw) }));
  const s = Store.loadState();
  assert.equal(s.currentId, 'a');                                                      // el actual no existía: toma el primero
  const [a, b, c] = s.projects;
  assert.deepEqual(a.points, []); assert.deepEqual(a.climate, {}); assert.equal(a.nextPoint, 1); assert.deepEqual(a.layers, []);
  assert.equal(b.nextPoint, 4); assert.deepEqual(b.climate, { pManual: 900 });
  assert.equal(b.layers.length, 1); assert.equal(b.layers[0].id, 'l1');
  assert.equal(b.mainColor, Store.MAIN_COLOR);
  assert.equal(c.mainColor, '#AABBCC');
  assert.deepEqual(s.settings, { areaUnit: 'm2', minAcc: 10, csvStyle: 'es' });       // minAcc y csvStyle no válidos vuelven al valor por defecto
});

test('loadState: conserva ajustes válidos', () => {
  const raw = { projects: [{ id: 'a', name: 'X', points: [] }], currentId: 'a', settings: { areaUnit: 'fanegadas', minAcc: 3, csvStyle: 'std' } };
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify(raw) }));
  assert.deepEqual(Store.loadState().settings, { areaUnit: 'fanegadas', minAcc: 3, csvStyle: 'std' });
});

test('saveState / loadState: ida y vuelta', () => {
  const st = fakeStorage();
  Store.setBackend(st);
  const s = Store.defaultState();
  s.projects[0].points.push({ id: 'p1', name: 'P1', lat: 4.6, lon: -74.08 });
  assert.deepEqual(Store.saveState(s), { ok: true });
  assert.ok(st.data['zvg.v1.state']);
  const back = Store.loadState();
  assert.equal(back.projects[0].points[0].name, 'P1');
});

test('saveState: avisa si no hay espacio, si falla o si no hay dónde guardar; los datos siguen en memoria', () => {
  const s = Store.defaultState();
  s.projects[0].name = 'En memoria';
  Store.setBackend({ getItem: () => null, setItem: () => { const e = new Error('lleno'); e.name = 'QuotaExceededError'; throw e; } });
  assert.deepEqual(Store.saveState(s), { ok: false, error: 'Sin espacio para guardar.' });
  assert.equal(Store.loadState().projects[0].name, 'En memoria');                       // el respaldo en memoria responde
  Store.setBackend({ getItem: () => null, setItem: () => { throw new Error('otro'); } });
  assert.deepEqual(Store.saveState(s), { ok: false, error: 'No se pudo guardar en el dispositivo.' });
  Store.setBackend(null);
  const r = Store.saveState(s);
  assert.equal(r.ok, false); assert.match(r.error, /no permite guardar/);
});

test('lectura: si el almacenamiento lanza error, se usa lo guardado en memoria', () => {
  Store.setBackend({ getItem: () => { throw new Error('bloqueado'); }, setItem: () => {} });
  assert.deepEqual(Store.loadMemory(), []);
  Store.saveMemory([{ lat: 1, lon: 2, T: 10 }]);                                        // setItem no guarda, pero la memoria sí
  assert.equal(Store.loadMemory()[0].T, 10);
});

test('saveMemory / loadMemory: solo acepta listas', () => {
  const st = fakeStorage();
  Store.setBackend(st);
  assert.deepEqual(Store.loadMemory(), []);
  assert.deepEqual(Store.saveMemory([{ lat: 4.6, lon: -74.08, T: 14, P: 1000 }]), { ok: true });
  assert.equal(Store.loadMemory()[0].T, 14);
  st.data['zvg.v1.memory'] = JSON.stringify({ no: 'lista' });
  assert.deepEqual(Store.loadMemory(), []);
});

test('sin setBackend: usa el localStorage del navegador si existe, y funciona en memoria si no', () => {
  const ruta = require.resolve('../www/js/store.js');
  const fake = fakeStorage();
  globalThis.localStorage = fake;
  try {
    delete require.cache[ruta];
    const S1 = require('../www/js/store.js');
    assert.deepEqual(S1.saveState(S1.defaultState()), { ok: true });
    assert.ok(fake.data['zvg.v1.state'], 'debe guardar en el localStorage');
    assert.equal(S1.loadState().projects.length, 1);
  } finally { delete globalThis.localStorage; delete require.cache[ruta]; }
  const S2 = require('../www/js/store.js');                                // sin localStorage (Node): solo en memoria
  const r = S2.saveState(S2.defaultState());
  assert.equal(r.ok, false);
  assert.match(r.error, /no permite guardar/);
  assert.equal(S2.loadState().projects.length, 1);
  delete require.cache[ruta];
});

test('marcas del equipo: se guardan, se leen y no se mezclan con los proyectos', () => {
  const st = fakeStorage();
  Store.setBackend(st);
  assert.equal(Store.loadFlag('webNoteAt'), null);
  assert.deepEqual(Store.saveFlag('webNoteAt', 1234), { ok: true });
  assert.deepEqual(Store.saveFlag('otra', 'x'), { ok: true });
  assert.equal(Store.loadFlag('webNoteAt'), 1234);
  assert.equal(Store.loadFlag('otra'), 'x');
  assert.equal(Store.loadFlag('nunca'), null);
  assert.equal(Store.loadFlag('toString'), null, 'no lee propiedades heredadas');
  assert.equal(st.getItem('zvg.v1.state'), null, 'no toca los proyectos');
  assert.deepEqual(JSON.parse(st.getItem('zvg.v1.flags')), { webNoteAt: 1234, otra: 'x' });
});

test('marcas del equipo: un contenido dañado se ignora y se reemplaza', () => {
  for (const bad of ['[1,2]', '"texto"', '5', 'null', '{no json']) {
    const st = fakeStorage({ 'zvg.v1.flags': bad });
    Store.setBackend(st);
    assert.equal(Store.loadFlag('webNoteAt'), null, bad);
    assert.deepEqual(Store.saveFlag('webNoteAt', 7), { ok: true });
    assert.equal(Store.loadFlag('webNoteAt'), 7, bad);
  }
});

test('marcas del equipo: si no hay dónde guardar, avisa pero la sesión sigue recordándola', () => {
  Store.setBackend(null);
  const r = Store.saveFlag('webNoteAt', 99);
  assert.equal(r.ok, false);
  assert.match(r.error, /no permite guardar/);
  assert.equal(Store.loadFlag('webNoteAt'), 99);
});

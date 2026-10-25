'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Backup = require('../www/js/backup.js');

let n = 0;
const uid = () => 'u' + (++n);
const NOW = Date.UTC(2026, 9, 22, 15, 0, 0);

function sampleState() {
  return {
    v: 1, currentId: 'p2',
    settings: { areaUnit: 'fanegadas', minAcc: 5, csvStyle: 'std' },
    projects: [
      { id: 'p1', name: 'Finca Ejemplo', created: 1000, nextPoint: 4, mainColor: '#2F8F4E',
        points: [
          { id: 'a1', name: 'P1', lat: 4.93, lon: -74.45, alt: 1310.4, altGps: 1310.4, altSrc: 'gps', acc: 4.2, altAcc: 9, src: 'gps', ts: 5 },
          { id: 'a2', name: 'P2', lat: 4.931, lon: -74.45, alt: null, altGps: null, altSrc: null, acc: null, altAcc: null, src: 'manual', ts: 6, lowAcc: true },
          { id: 'a3', name: 'P3', lat: 4.931, lon: -74.449, alt: 1300, altGps: null, altSrc: 'internet', acc: null, altAcc: null, src: 'manual', ts: 7 }
        ],
        climate: { tManual: 21.5, pManual: 1800, online: { T: 22, P: 1750, monthlyT: [22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22], monthlyP: [100, 100, 150, 200, 200, 120, 100, 100, 150, 200, 200, 130],
          elevCell: 1500, elevation: 1310, date: 99, lat: 4.93, lon: -74.45, source: 'NASA POWER' }, monthlyManual: { T: [20, null, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], P: null } },
        layers: [{ id: 'l1', name: 'Colindante', kind: 'polygon', color: '#E67E22', visible: false, file: 'vecino.kml', ts: 3,
          points: [{ lat: 4.94, lon: -74.45, alt: null }, { lat: 4.94, lon: -74.44, alt: null }, { lat: 4.95, lon: -74.44, alt: 1200, name: 'esq' }],
          holes: [[{ lat: 4.941, lon: -74.449, alt: null }, { lat: 4.941, lon: -74.448, alt: null }, { lat: 4.942, lon: -74.448, alt: null }]] }] },
      { id: 'p2', name: 'Otro', created: 2000, nextPoint: 1, points: [], climate: {}, layers: [], mainColor: '#2F8F4E' }
    ]
  };
}
const MEMORY = [{ lat: 4.6, lon: -74.08, T: 14.1, P: 1013, alt: 2640, src: 'paquete', name: 'Bogotá' }, { lat: 6.25, lon: -75.57, T: 22, P: null, alt: null, src: 'internet', date: 5 }];

test('copia: crear → texto → leer → validar devuelve lo mismo', () => {
  const b = Backup.create(sampleState(), MEMORY, { now: NOW, appVersion: '2.0.0' });
  assert.equal(b.app, 'zonas-de-vida-gps');
  assert.equal(b.format, 1);
  assert.deepEqual(b.summary, { projects: 2, points: 3, layers: 1 });
  assert.equal(b.created, '2026-10-22T15:00:00.000Z');
  const res = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.data.projects, sampleState().projects);
  assert.equal(res.data.currentId, 'p2');
  assert.deepEqual(res.data.settings, { areaUnit: 'fanegadas', minAcc: 5, csvStyle: 'std' });
  assert.equal(res.data.memory.length, 2);
  assert.equal(res.data.memory[0].name, 'Bogotá');
  assert.deepEqual(res.summary, { projects: 2, points: 3, layers: 1, memory: 2 });
  assert.equal(res.created, Date.parse('2026-10-22T15:00:00.000Z'));
});

test('copia: no modifica el estado original al crearla', () => {
  const st = sampleState();
  const b = Backup.create(st, MEMORY);
  b.state.projects[0].points[0].lat = 0;
  assert.equal(st.projects[0].points[0].lat, 4.93);
});

test('copia: nombre de archivo con la fecha', () => {
  assert.equal(Backup.fileName(new Date(2026, 9, 3, 12).getTime()), 'zonas-de-vida-copia-2026-10-03.json');
});

test('validar: rechaza lo que no es una copia de seguridad', () => {
  const bad = (x, re) => { const r = Backup.validate(x, { uid }); assert.equal(r.ok, false); assert.match(r.errors[0], re); assert.equal(r.data, null); };
  bad(null, /formato de una copia/);
  bad([], /formato de una copia/);
  bad('texto', /formato de una copia/);
  bad({ projects: [] }, /no es una copia de seguridad de Zonas de Vida/);
  bad({ app: 'otra-app', format: 1 }, /no es una copia/);
  bad({ app: 'zonas-de-vida-gps' }, /versión de formato/);
  bad({ app: 'zonas-de-vida-gps', format: 99, state: { projects: [] } }, /versión más nueva/);
  bad({ app: 'zonas-de-vida-gps', format: 1 }, /lista de proyectos/);
  bad({ app: 'zonas-de-vida-gps', format: 1, state: { projects: [] } }, /ningún proyecto/);
  bad({ app: 'zonas-de-vida-gps', format: 1, state: { projects: [5, null, 'x'] } }, /Ningún proyecto/);
});

test('validar: descarta lo dañado, corrige lo corregible y avisa', () => {
  const b = Backup.create(sampleState(), MEMORY);
  const p = b.state.projects[0];
  p.points.push({ id: 'zz', name: 'malo', lat: 95, lon: 0 }, { name: 'sin lat' }, 'basura', { id: 'a1', name: 'repetido', lat: 1, lon: 1 });
  p.points[0].alt = 99999;                       // fuera de rango → sin altitud
  p.points[0].altSrc = 'inventada';
  p.points[1].name = '  Nombre\u0000 muy\n  largo ' + 'x'.repeat(200);
  p.layers.push({ id: 'l2', name: 'vacía', kind: 'polygon', points: [{ lat: 1, lon: 1 }] }, { nombre: 'sin puntos' }, 'x');
  p.layers[0].points.push({ lat: 'a', lon: 1 });
  p.climate.tManual = 90; p.climate.pManual = -4; p.climate.altOverride = 'x';
  p.climate.online.monthlyT = [1, 2, 3];
  b.memory.push({ lat: 4, lon: 200, T: 5 }, { lat: 4, lon: 5 }, null);
  b.state.currentId = 'no-existe';
  b.state.settings = { areaUnit: 'acres', minAcc: 7, csvStyle: 'x' };
  const r = Backup.validate(b, { uid, now: NOW });
  assert.equal(r.ok, true);
  const q = r.data.projects[0];
  assert.equal(q.points.length, 4);                                          // 3 buenos + el de id repetido (con id nuevo)
  assert.equal(q.points[0].alt, null);
  assert.equal(q.points[0].altSrc, null);
  assert.ok(q.points[1].name.length <= 80 && !/[\u0000\n]/.test(q.points[1].name) && q.points[1].name.startsWith('Nombre muy largo'));
  assert.equal(new Set(q.points.map((x) => x.id)).size, 4, 'ids únicos');
  assert.equal(q.layers.length, 1);
  assert.equal(q.layers[0].points.length, 3);
  assert.deepEqual(q.climate.tManual, undefined);
  assert.deepEqual(q.climate.pManual, undefined);
  assert.equal(q.climate.online.monthlyT, null);
  assert.equal(q.climate.online.monthlyP.length, 12);
  assert.equal(r.data.currentId, 'p1');                                       // el actual no existía: el primero
  assert.deepEqual(r.data.settings, { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' });
  assert.equal(r.data.memory.length, 2);
  assert.ok(r.warnings.some((w) => /punto\(s\) con coordenadas no válidas/.test(w)));
  assert.ok(r.warnings.some((w) => /capa\(s\)/.test(w)));
  assert.ok(r.warnings.some((w) => /identificador/.test(w)));
  assert.ok(r.warnings.some((w) => /dato\(s\) de clima/.test(w)));
});

test('validar: campos desconocidos y claves peligrosas no pasan', () => {
  const raw = JSON.parse('{"app":"zonas-de-vida-gps","format":1,"__proto__":{"x":1},"state":{"projects":[{"id":"a","name":"n","points":[{"id":"q","lat":1,"lon":2,"__proto__":{"polluted":true},"constructor":{"prototype":{"p2":1}},"extra":"no"}],"climate":{"__proto__":{"polluted":true},"tManual":10,"otro":5},"hack":"x","layers":[]}]}}');
  const r = Backup.validate(raw, { uid, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).p2, undefined);
  const p = r.data.projects[0];
  assert.deepEqual(Object.keys(p).sort(), ['climate', 'created', 'id', 'layers', 'mainColor', 'name', 'nextPoint', 'points']);
  assert.deepEqual(p.climate, { tManual: 10 });
  assert.equal(p.points[0].extra, undefined);
  assert.equal(p.points[0].name, 'P1');
  assert.equal(p.nextPoint, 2);
});

test('validar: respeta los límites de tamaño', () => {
  const many = [];
  for (let i = 0; i < Backup.LIMITS.projects + 1; i++) many.push({ id: 'x' + i, name: 'p', points: [] });
  const r = Backup.validate({ app: 'zonas-de-vida-gps', format: 1, state: { projects: many } }, { uid });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /demasiados proyectos/);
  const big = { id: 'b', name: 'b', points: [], layers: [{ id: 'L', name: 'grande', kind: 'points', points: Array.from({ length: Backup.LIMITS.layerPoints + 500 }, (_, i) => ({ lat: 1 + (i % 100) / 1000, lon: 2 })) }] };
  const r2 = Backup.validate({ app: 'zonas-de-vida-gps', format: 1, state: { projects: [big] } }, { uid });
  assert.equal(r2.ok, true);
  assert.equal(r2.data.projects[0].layers[0].points.length, Backup.LIMITS.layerPoints);
  assert.ok(r2.warnings.some((w) => /muy grandes/.test(w)));
});

test('restaurar reemplazando: queda exactamente lo de la copia', () => {
  const v = Backup.validate(Backup.create(sampleState(), MEMORY), { uid, now: NOW });
  const current = { state: { v: 1, currentId: 'zzz', settings: { areaUnit: 'ha' }, projects: [{ id: 'zzz', name: 'Actual', points: [], climate: {}, layers: [] }] }, memory: [{ lat: 1, lon: 1, T: 1, P: 1, src: 'x' }] };
  const out = Backup.apply(current, v.data, 'replace');
  assert.deepEqual(out.state.projects.map((p) => p.id), ['p1', 'p2']);
  assert.equal(out.state.currentId, 'p2');
  assert.equal(out.state.settings.minAcc, 5);
  assert.equal(out.memory.length, 2);
  assert.equal(out.added, 2);
});

test('restaurar sumando: conserva lo actual, evita duplicados exactos y renombra choques', () => {
  const v = Backup.validate(Backup.create(sampleState(), MEMORY), { uid, now: NOW });
  const mine = sampleState();
  mine.projects[1].name = 'Mi versión distinta';        // mismo id p2, contenido distinto
  mine.currentId = 'p1';
  mine.settings = { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' };
  const current = { state: mine, memory: [MEMORY[0]] };
  const out = Backup.apply(current, v.data, 'merge', { uid });
  assert.equal(out.skipped, 1);                          // p1 idéntico: ya estaba
  assert.equal(out.added, 1);
  assert.equal(out.renamed, 1);
  assert.equal(out.state.projects.length, 3);
  assert.deepEqual(out.state.projects.slice(0, 2).map((p) => p.id), ['p1', 'p2']);
  const nuevo = out.state.projects[2];
  assert.notEqual(nuevo.id, 'p2');
  assert.equal(nuevo.name, 'Otro (restaurado)');
  assert.equal(out.state.currentId, 'p1');
  assert.equal(out.state.settings.minAcc, 10);           // al sumar no se tocan los ajustes
  assert.equal(out.memory.length, 2);                    // el dato repetido no se duplica
  assert.equal(current.state.projects.length, 2, 'no modifica el estado de entrada');
});

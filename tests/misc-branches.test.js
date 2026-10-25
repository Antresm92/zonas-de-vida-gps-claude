'use strict';
/* Casos límite de geo, copia de seguridad, informe e io: entradas raras que no deben romper nada. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const Backup = require('../www/js/backup.js');
const Report = require('../www/js/report.js');
const A = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');
const IO = require('../www/js/io.js');

/* ---------- geo ---------- */
test('geo: lectura de ángulos y pares con formatos raros o imposibles', () => {
  assert.equal(Geo.parseAngle(null).error, 'Vacío');
  assert.equal(Geo.parseAngle(undefined, 'lat').error, 'Vacío');
  assert.equal(Geo.parseAngle(NaN).error, 'Número no válido');
  assert.equal(Geo.parseAngle(95, 'lat').error, 'Latitud fuera de rango (±90)');
  assert.equal(Geo.parseAngle(4.5).value, 4.5);
  assert.equal(Geo.parseAngle('   ').error, 'Vacío');
  assert.equal(Geo.parseAngle('1 N S').error, 'Demasiadas letras de hemisferio');
  assert.equal(Geo.parseAngle('4 5 6 7').error, 'Formato no reconocido');
  assert.equal(Geo.parseAngle('4.5 30 N', 'lat').error, 'Con minutos, los grados deben ser enteros');
  assert.equal(Geo.parseAngle('4 30.5 10').error, 'Con segundos, los minutos deben ser enteros');
  assert.equal(Geo.parseAngle('9'.repeat(400)).error, 'Número no válido');
  assert.equal(Geo.parseAngle('4 70').error, 'Los minutos deben estar entre 0 y 59');
  assert.equal(Geo.parseAngle('4 30 70').error, 'Los segundos deben estar entre 0 y 59.99');
  assert.equal(Geo.parseAngle('4 N', 'lon').error, 'La longitud usa E, W u O');
  assert.equal(Geo.parseAngle('4 E', 'lat').error, 'La latitud usa N o S');
  assert.match(Geo.parseAngle('4 ñ 5').error, /Caracteres no válidos/);
  assert.equal(Geo.parsePair('4,5').lat, 4);
  assert.equal(Geo.parsePair('N 4 E 5 W').error, 'Formato no reconocido');
  assert.equal(Geo.parsePair('1,2,3').error, 'No pude separar latitud y longitud');
  assert.equal(Geo.parsePair(null).error, 'Vacío');
  assert.deepEqual(Geo.parsePair('4.5;-74.1'), { lat: 4.5, lon: -74.1 });
});

test('geo: grados-minutos-segundos con decimales por defecto, hemisferios y casos sin área', () => {
  assert.equal(Geo.toDMS(-4.5, 'lat'), '4° 30\' 00.00" S');
  assert.equal(Geo.toDMS(-74.1, 'lon', 0), '74° 06\' 00" W');
  assert.equal(Geo.toDMS(4.5, 'lon'), '4° 30\' 00.00" E');
  assert.equal(Geo.toDMS(0, 'lat', 1), '0° 00\' 00.0" N');
  assert.equal(Geo.distance(4, -74, 4, -74), 0);
  const casiAntipodas = Geo.distance(0, 0, 0.5, 179.7);
  assert.ok(Math.abs(casiAntipodas - Geo.haversine(0, 0, 0.5, 179.7)) < 60000, 'si Vincenty no converge se usa la fórmula esférica');
  assert.equal(Geo.polygonArea([]), 0);
  assert.equal(Geo.polygonArea([{ lat: 1, lon: 1 }]), 0);
  assert.equal(Geo.perimeter([{ lat: 1, lon: 1 }], false), 0);
  assert.equal(Geo.centroid([]), null);
});

/* ---------- copia de seguridad ---------- */
const LIMPIO = () => ({ app: 'zonas-de-vida-gps', format: 1, created: new Date(0).toISOString(), state: { projects: [], currentId: 'x', settings: {} }, memory: [] });

test('copia: crear con datos incompletos y nombre de archivo con ceros a la izquierda', () => {
  const b = Backup.create({}, null);
  assert.deepEqual(b.state.projects, []); assert.deepEqual(b.memory, []); assert.deepEqual(b.state.settings, {});
  assert.equal(b.summary.projects, 0);
  assert.equal(Backup.fileName(new Date(2026, 0, 5).getTime()), 'zonas-de-vida-copia-2026-01-05.json');
  assert.match(Backup.fileName(), /^zonas-de-vida-copia-\d{4}-\d{2}-\d{2}\.json$/);
  const con = Backup.create({ projects: [{ id: 'a', points: [{ lat: 1, lon: 1 }] }, { id: 'b' }], currentId: 'a' }, [{ lat: 1, lon: 1, T: 1 }], { now: 0, appVersion: '2' });
  assert.deepEqual(con.summary, { projects: 2, points: 1, layers: 0 }); assert.equal(con.appVersion, '2');
});

test('copia: proyectos sin listas, capas pequeñas, huecos dañados y clima parcial', () => {
  const raw = LIMPIO();
  raw.state.projects = [
    { id: 'p1', name: 'Sin listas' },
    { id: 'p2', name: 'Con capas', points: [{ lat: 1, lon: 1 }], layers: [
      { id: 'l1', kind: 'polygon', points: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] },
      { id: 'l2', kind: 'line', points: [{ lat: 1, lon: 1 }] },
      { id: 'l3', kind: 'points', points: [{ lat: 1, lon: 1, name: 'Pozo' }] },
      { id: 'l4', kind: 'polygon', color: '#123456', points: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }], holes: ['no', [{ lat: 1.1, lon: 1.1 }], [{ lat: 1.1, lon: 1.1 }, { lat: 1.1, lon: 1.2 }, { lat: 1.2, lon: 1.2 }]] },
      { id: 'l5', kind: 'polygon', points: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }], holes: [['x']] },
      { id: 'l6', points: 'no' }
    ], climate: { altOverride: 2500, online: { monthlyT: new Array(12).fill(10) }, monthlyManual: { T: new Array(12).fill(null), P: new Array(12).fill(null) } } },
    { id: 'p3', climate: { online: { T: null, P: null }, monthlyManual: { T: new Array(12).fill(10), P: new Array(12).fill(null) } } },
    'no soy un proyecto'
  ];
  const r = Backup.validate(raw, { uid: (() => { let n = 0; return () => 'u' + (++n); })() });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /1 proyecto\(s\) dañado/.test(w)));
  const [p1, p2, p3] = r.data.projects;
  assert.deepEqual(p1.points, []); assert.deepEqual(p1.layers, []);
  assert.deepEqual(p2.layers.map((l) => l.id), ['l3', 'l4', 'l5']);
  assert.equal(p2.layers[1].holes.length, 1); assert.equal(p2.layers[2].holes, undefined);
  assert.equal(p2.layers[0].points[0].name, 'Pozo');
  assert.equal(p2.climate.altOverride, 2500); assert.ok(p2.climate.online.monthlyT); assert.equal(p2.climate.monthlyManual, undefined);
  assert.equal(p3.climate.online, undefined); assert.ok(p3.climate.monthlyManual.T);
});

test('copia: restaurar sin memoria previa y proyectos con valores indefinidos', () => {
  const data = Backup.validate(Object.assign(LIMPIO(), { state: { projects: [{ id: 'a', name: 'A', points: [{ lat: 1, lon: 1 }] }], currentId: 'a', settings: {} }, memory: [{ lat: 1, lon: 1, T: 5 }] })).data;
  const sinMem = Backup.apply({ state: { projects: [{ id: 'b', name: 'B', points: [], climate: {}, layers: [], x: undefined, y: [undefined] }], currentId: 'b', settings: {} } }, data, 'merge');
  assert.equal(sinMem.state.projects.length, 2); assert.equal(sinMem.memory.length, 1);
  const mismo = Backup.apply({ state: { projects: data.projects.map((p) => Object.assign({}, p, { extra: undefined, lista: [undefined] })), currentId: 'a', settings: {} }, memory: [] }, data, 'merge');
  assert.equal(mismo.skipped, 0);
});

test('copia: validar sin opciones, con proyectos de más y con identificadores repetidos', () => {
  const raw = LIMPIO();
  raw.state.projects = [{ id: 'a', name: 'Uno' }, { id: 'a', name: 'Dos' }, { id: 'ñ ñ', name: 'Tres' }];
  const r = Backup.validate(raw);
  assert.equal(r.ok, true); assert.equal(new Set(r.data.projects.map((p) => p.id)).size, 3);
  assert.ok(r.warnings.some((w) => /identificador/.test(w)));
  assert.equal(Backup.validate(null).ok, false);
  assert.equal(Backup.validate([]).ok, false);
  const largo = LIMPIO(); largo.state.projects = new Array(Backup.LIMITS.projects + 1).fill({ id: 'z' });
  assert.match(Backup.validate(largo).errors[0], /demasiados proyectos/);
});

/* ---------- informe ---------- */
const PUNTOS = [{ lat: 4.6, lon: -74.1, alt: 2500 }, { lat: 4.61, lon: -74.1 }, { lat: 4.61, lon: -74.09, alt: 2600, name: 'Esquina' }];

test('informe: orígenes desconocidos, sin avisos, sin notas, sin zonas por vértice y sin provincia de humedad', () => {
  const project = { name: 'X', points: PUNTOS, climate: { pManual: 1100 } };
  const a = A.analyze(project, { memory: new Climate.Memory() });
  a.climate.TSrc = 'rara'; a.climate.PSrc = 'otra';
  assert.ok(Report.rows(project, a).some((r) => /\(rara\)/.test(r[1]) || /\(otra\)/.test(r[1])));
  delete a.warnings; delete a.climate.notes; delete a.vertexZones; a.result.humidity = null;
  const t = Report.text(project, a); const h = Report.html(project, a);
  assert.ok(t.includes('Zona de vida')); assert.ok(h.includes('<svg'));
  assert.ok(!h.includes('Provincia de humedad'));
  assert.ok(Report.rows(project, Object.assign({}, a, { climate: undefined })).every((r) => !/Temperatura/.test(r[0])));
  assert.ok(h.includes('P1') && h.includes('Esquina'));
  const conWalter = Report.html(project, a, { walter: { svg: '<svg></svg>' } });
  assert.ok(conWalter.includes('Diagrama de Walter-Lieth'));
  const sinLineas = Report.text(project, a, { walter: { lines: [] } });
  assert.ok(!sinLineas.includes('Walter-Lieth'));
});

/* ---------- io ---------- */
test('io: detecta cancelaciones del menú de compartir con errores de formas distintas', async () => {
  const llamadas = [];
  const share = (err) => ({ Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async () => ({ uri: 'file:///x' }) },
    Share: { share: async () => { throw err; } } } } });
  for (const [err, how] of [[{ name: 'AbortError' }, 'cancel'], [new Error('Share canceled'), 'cancel'], ['usuario canceló', 'cancel'], [null, 'error'], [new Error('disco lleno'), 'error']]) {
    IO.setEnv(share(err));
    if (how === 'cancel') assert.equal((await IO.saveText('a.txt', 'text/plain', 'x')).how, 'cancel');
    else await assert.rejects(IO.saveText('a.txt', 'text/plain', 'x'));
    llamadas.push(how);
  }
  IO.setEnv(null);
  assert.equal(llamadas.length, 5);
});

'use strict';
/* Fotos en la copia de seguridad (.zip), copia liviana (.json), creación de ZIP, guardado de bytes y reporte con fotos (2.5.0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const Zip = require('../www/js/zip.js');
const Fotos = require('../www/js/fotos.js');
const Backup = require('../www/js/backup.js');
const Store = require('../www/js/store.js');
const IO = require('../www/js/io.js');
const Report = require('../www/js/report.js');
const Climate = require('../www/js/climate.js');
const A = require('../www/js/analysis.js');
const { makeZip } = require('./helpers/zipbuild.js');

const NOW = Date.UTC(2026, 10, 1, 15, 0, 0);
let n = 0;
const uid = () => 'u' + (++n);
const jpeg = (...extra) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0].concat(extra));

function estado() {
  return {
    v: 1, currentId: 'p1', settings: { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' },
    projects: [{ id: 'p1', name: 'Finca', created: 1000, nextPoint: 4, mainColor: '#2F8F4E', layers: [], climate: {},
      points: [
        { id: 'a', name: 'P1', lat: 4.6, lon: -74.1, alt: 1800, src: 'gps', photos: [{ id: 'f1', w: 1280, h: 960, n: 4, at: 1 }, { id: 'f2', w: 960, h: 1280, n: 5, at: 2 }] },
        { id: 'b', name: 'P2', lat: 4.6, lon: -74.09, alt: 2400, src: 'manual', photos: [{ id: 'f3', w: 640, h: 480, n: 6, at: 3 }] },
        { id: 'c', name: 'P3', lat: 4.61, lon: -74.09, alt: 3000, src: 'manual' }
      ] }]
  };
}
const BYTES = { f1: jpeg(1), f2: jpeg(2, 2), f3: jpeg(3, 3, 3) };
const todas = (id) => Object.prototype.hasOwnProperty.call(BYTES, id);

/* ---------- Crear ZIP ---------- */
test('zip.create: lo que se guarda se lee igual (nombres con tildes, bytes y verificación CRC)', () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]), b = new Uint8Array(0), c = new Uint8Array(70000).map((_, i) => i % 251);
  const z = Zip.create([{ name: 'copia.json', bytes: a }, { name: 'fotos/ñandú-é.jpg', bytes: b }, { name: 'grande.bin', bytes: c }], NOW);
  assert.equal(Zip.isZip(z), true);
  const list = Zip.entries(z);
  assert.deepEqual(list.map((e) => e.name), ['copia.json', 'fotos/ñandú-é.jpg', 'grande.bin']);
  assert.deepEqual(list.map((e) => e.method), [0, 0, 0], 'sin compresión: el JPEG ya viene comprimido');
  assert.deepEqual(Array.from(Zip.extract(z, list[0])), [1, 2, 3, 4, 5]);
  assert.equal(Zip.extract(z, list[1]).length, 0);
  assert.equal(Buffer.compare(Buffer.from(Zip.extract(z, list[2])), Buffer.from(c)), 0);
});

test('zip.create: lo abre un lector de ZIP de verdad (el zip que se lleva el usuario no es un formato propio)', () => {
  const z = Zip.create([{ name: 'copia.json', bytes: new TextEncoder().encode('{"a":1}') }]);
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), 'x.zip');
  fs.writeFileSync(f, z);
  const py = cp.spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(z.read("copia.json").decode())', f], { encoding: 'utf8' });
  if (py.error || py.status !== 0) return;                  // sin python3 en este equipo: ya lo prueba la lectura propia
  assert.equal(py.stdout.trim(), 'None\n{"a":1}');
});

test('zip.create: fechas fuera del rango de ZIP (1980–2107) y sin fecha no rompen nada', () => {
  for (const when of [0, 8e12, undefined, NOW]) {
    const z = Zip.create([{ name: 'a', bytes: new Uint8Array([9]) }], when);
    assert.deepEqual(Array.from(Zip.extract(z, Zip.entries(z)[0])), [9]);
  }
});

test('zip.create: lo que no sirve da un error claro', () => {
  assert.throws(() => Zip.create('no'), /Demasiados archivos/);
  assert.throws(() => Zip.create(new Array(65535)), /Demasiados archivos/);
  assert.throws(() => Zip.create([{ name: '', bytes: new Uint8Array(1) }]), /no válido/);
  assert.throws(() => Zip.create([{ name: 'a', bytes: [1, 2] }]), /no válido/);
  assert.throws(() => Zip.create([{ name: 'x'.repeat(70000), bytes: new Uint8Array(1) }]), /no válido/);
  assert.deepEqual(Zip.entries(Zip.create([])), [], 'un ZIP vacío es válido');
});

/* ---------- Copia liviana (.json): nunca lleva fotos ---------- */
test('create: sin fotos disponibles (copia liviana) no deja ninguna en los puntos y lo dice el resumen', () => {
  const b = Backup.create(estado(), [], { now: NOW, hasPhoto: () => false });
  assert.deepEqual(b.summary, { projects: 1, points: 3, layers: 0, photos: 0 });
  b.state.projects[0].points.forEach((p) => assert.equal('photos' in p, false));
  assert.doesNotMatch(Backup.stringify(b), /"photos":\[|"id":"f\d"/);
  const r = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW });
  assert.equal(r.ok, true); assert.deepEqual(r.warnings, []);
  assert.equal(Fotos.usedIds(r.data.projects).length, 0);
});

test('create: solo van las fotos cuya imagen se pudo leer; el estado original no se toca', () => {
  const st = estado();
  const b = Backup.create(st, [], { now: NOW, hasPhoto: (id) => id !== 'f2' });
  assert.deepEqual(b.state.projects[0].points[0].photos.map((f) => f.id), ['f1']);
  assert.deepEqual(b.state.projects[0].points[1].photos.map((f) => f.id), ['f3']);
  assert.equal(b.summary.photos, 2);
  assert.equal(st.projects[0].points[0].photos.length, 2, 'el estado de la app sigue con sus dos fotos');
  const b2 = Backup.create(st, [], { now: NOW, hasPhoto: (id) => id === 'f3' });
  assert.equal('photos' in b2.state.projects[0].points[0], false, 'un punto sin ninguna foto legible no deja la lista vacía');
  const b3 = Backup.create(st, [], { now: NOW });
  assert.equal(b3.summary.photos, 3, 'sin hasPhoto no se filtra nada');
});

test('fileName: .json por defecto y .zip cuando se pide', () => {
  const d = new Date(2026, 10, 2, 12).getTime();
  assert.equal(Backup.fileName(d), 'zonas-de-vida-copia-2026-11-02.json');
  assert.equal(Backup.fileName(d, 'zip'), 'zonas-de-vida-copia-2026-11-02.zip');
  assert.equal(Backup.fileName(d, 'json'), 'zonas-de-vida-copia-2026-11-02.json');
  assert.equal(Backup.fileName(d, 'otra'), 'zonas-de-vida-copia-2026-11-02.json');
  assert.equal(Backup.fileName(d, 'json', 'fotos'), 'zonas-de-vida-copia-fotos-2026-11-02.json', 'el .json pesado se distingue por el nombre');
  assert.equal(Backup.fileName(d, 'json', 'otra cosa'), 'zonas-de-vida-copia-2026-11-02.json');
});

/* ---------- Copia completa (.zip): ida y vuelta ---------- */
test('copia .zip: crear → leer → validar devuelve los proyectos y las imágenes', () => {
  const b = Backup.create(estado(), [], { now: NOW, hasPhoto: todas });
  const zip = Backup.toZip(b, Object.keys(BYTES).map((id) => ({ id, bytes: BYTES[id] })), NOW);
  assert.equal(Zip.isZip(zip), true);
  assert.deepEqual(Zip.entries(zip).map((e) => e.name).sort(), ['copia.json', 'fotos/f1.jpg', 'fotos/f2.jpg', 'fotos/f3.jpg']);
  const z = Backup.readZip(zip);
  assert.equal(z.skipped, 0);
  assert.deepEqual(Object.keys(z.photos).sort(), ['f1', 'f2', 'f3']);
  assert.deepEqual(Array.from(z.photos.f2), [0xFF, 0xD8, 0xFF, 0xE0, 2, 2]);
  const v = Backup.validate(z.raw, { uid, now: NOW, photos: z.photos });
  assert.equal(v.ok, true, v.errors.join('; ')); assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.summary, { projects: 1, points: 3, layers: 0, photos: 3, memory: 0 });
  assert.deepEqual(v.data.projects[0].points[0].photos, [{ id: 'f1', w: 1280, h: 960, n: 4, at: 1 }, { id: 'f2', w: 960, h: 1280, n: 5, at: 2 }]);
});

test('copia .zip sin ninguna foto: sigue siendo un ZIP válido con solo copia.json', () => {
  const b = Backup.create(estado(), [], { now: NOW, hasPhoto: () => false });
  const zip = Backup.toZip(b, [], NOW), z = Backup.readZip(zip);
  assert.deepEqual(Zip.entries(zip).map((e) => e.name), ['copia.json']);
  assert.deepEqual(z.photos, {}); assert.equal(Backup.validate(z.raw, { uid, now: NOW, photos: z.photos }).ok, true);
});

test('leer ZIP: lo que no es una copia da un mensaje claro', () => {
  assert.throws(() => Backup.readZip(new Uint8Array(100)), /No se pudo leer el ZIP/);
  assert.throws(() => Backup.readZip(Zip.create([{ name: 'otra.txt', bytes: new Uint8Array(1) }])), /falta copia\.json/);
  assert.throws(() => Backup.readZip(Zip.create([{ name: 'copia.json', bytes: new TextEncoder().encode('{no es json') }])), /No se pudo leer copia\.json/);
  const dentro = makeZip([{ name: 'copia.json', data: '{"a":1}' }]);       // comprimido con deflate: también se lee
  assert.deepEqual(Backup.readZip(new Uint8Array(dentro)).raw, { a: 1 });
});

test('leer ZIP: una foto mala no detiene la lectura; se cuenta como omitida', () => {
  const grande = new Uint8Array(Fotos.MAX_PHOTO + 1); grande.set([0xFF, 0xD8, 0xFF]);
  const buenas = [{ name: 'copia.json', bytes: new TextEncoder().encode('{}') }, { name: 'fotos/ok.jpg', bytes: jpeg(7) }];
  const malas = [
    { name: 'fotos/png.jpg', bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1]) },   // no es JPEG
    { name: 'fotos/grande.jpg', bytes: grande },                                     // pesa demasiado
    { name: 'fotos/ok.jpg', bytes: jpeg(8) }                                         // repetida
  ];
  const ignoradas = [{ name: 'fotos/a b.jpg', bytes: jpeg(1) }, { name: 'otra/x.jpg', bytes: jpeg(1) }, { name: 'fotos/x.png', bytes: jpeg(1) }, { name: 'fotos/', bytes: new Uint8Array(0) }];
  const z = Backup.readZip(Zip.create(buenas.concat(malas, ignoradas)));
  assert.deepEqual(Object.keys(z.photos), ['ok']);
  assert.deepEqual(Array.from(z.photos.ok), Array.from(jpeg(7)), 'se queda con la primera');
  assert.equal(z.skipped, 3, 'las tres malas se cuentan; los nombres ajenos se ignoran sin contarlos');
});

test('leer ZIP: una foto dañada (falla la verificación) se omite', () => {
  const zip = Zip.create([{ name: 'copia.json', bytes: new TextEncoder().encode('{}') }, { name: 'fotos/a.jpg', bytes: jpeg(1, 2, 3, 4) }]);
  const e = Zip.entries(zip).find((x) => x.name === 'fotos/a.jpg');
  zip[e.offset + 30 + 'fotos/a.jpg'.length + 5] ^= 0xFF;                         // un byte cambiado dentro de la foto
  const z = Backup.readZip(zip);
  assert.deepEqual(z.photos, {}); assert.equal(z.skipped, 1);
});

test('leer ZIP: los límites de cantidad y de peso total protegen la memoria', () => {
  const L = Backup.LIMITS, old = { photos: L.photos, photoBytes: L.photoBytes };
  try {
    const zip = Zip.create([{ name: 'copia.json', bytes: new TextEncoder().encode('{}') }, { name: 'fotos/a.jpg', bytes: jpeg(1) }, { name: 'fotos/b.jpg', bytes: jpeg(2) }, { name: 'fotos/c.jpg', bytes: jpeg(3) }]);
    L.photos = 2;
    let z = Backup.readZip(zip);
    assert.equal(Object.keys(z.photos).length, 2); assert.equal(z.skipped, 1);
    L.photos = old.photos; L.photoBytes = 10;                                      // cada foto pesa 5 bytes: caben dos
    z = Backup.readZip(zip);
    assert.equal(Object.keys(z.photos).length, 2); assert.equal(z.skipped, 1);
  } finally { L.photos = old.photos; L.photoBytes = old.photoBytes; }
});

/* ---------- Validar fotos ---------- */
test('validar: solo cuentan las fotos cuya imagen viene dentro del archivo, y avisa de las que faltan', () => {
  const b = Backup.create(estado(), [], { now: NOW });                    // la lista dice 3 fotos
  let v = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW, photos: { f1: jpeg(1) } });
  assert.deepEqual(v.data.projects[0].points[0].photos.map((f) => f.id), ['f1']);
  assert.equal('photos' in v.data.projects[0].points[1], false);
  assert.equal(v.summary.photos, 1);
  assert.ok(v.warnings.some((w) => /^2 fotos no venían en el archivo y se omitieron\.$/.test(w)), v.warnings.join('|'));
  v = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW, photos: { f1: jpeg(1), f2: jpeg(2) } });
  assert.ok(v.warnings.some((w) => /^1 foto no venía en el archivo y se omitió\.$/.test(w)));
  v = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW });          // un .json con listas de fotos: ninguna imagen
  assert.equal(v.summary.photos, 0); assert.equal(Fotos.usedIds(v.data.projects).length, 0);
  v = Backup.validate(JSON.parse(Backup.stringify(b)), { uid, now: NOW, photos: { f1: jpeg(1), f2: jpeg(2), f3: jpeg(3) } });
  assert.deepEqual(v.warnings, []);
});

test('validar: la lista de fotos de un archivo manipulado se limpia (ids, números, cantidad)', () => {
  const b = Backup.create(estado(), [], { now: NOW });
  b.state.projects[0].points[0].photos = [{ id: '../x', w: 1 }, { id: 'ok', w: 'x', h: -1, n: 1e12, at: 'ayer', extra: 1 }, { id: 'ok' }, 'raro', null,
    { id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }, { id: 'a5' }];
  const all = { ok: jpeg(), a1: jpeg(), a2: jpeg(), a3: jpeg(), a4: jpeg(), a5: jpeg() };
  const v = Backup.validate(b, { uid, now: NOW, photos: all });
  const l = v.data.projects[0].points[0].photos;
  assert.equal(l.length, Fotos.MAX_PER_POINT);
  assert.deepEqual(l[0], { id: 'ok', w: null, h: null, n: null, at: null });
  assert.deepEqual(Object.keys(l[0]).sort(), ['at', 'h', 'id', 'n', 'w']);
});

/* ---------- Clima actual en la copia ---------- */
test('validar: el clima actual guardado en el proyecto se limpia y solo conserva lo que sirve', () => {
  const buena = { lat: 4.6, lon: -74.1, T: 24.3, humidity: 87, pressure: 1013, wind: 5.4, code: 1, sunrise: '05:44', sunset: '17:42', obs: '2026-10-28T14:00', at: NOW, source: 'cualquiera' };
  const caso = (w) => { const b = Backup.create(estado(), [], { now: NOW }); b.state.projects[0].weatherNow = w; return Backup.validate(b, { uid, now: NOW }); };
  assert.deepEqual(caso(buena).data.projects[0].weatherNow, Object.assign({}, buena, { source: 'Open-Meteo' }));
  const rara = caso({ lat: 100, lon: 'x', T: 99, humidity: 101, pressure: 5, wind: -1, code: 1.5, sunrise: '25:00', sunset: 'tarde', obs: 'hoy', at: -5 }).data.projects[0];
  assert.equal('weatherNow' in rara, false, 'si nada sirve, no se guarda');
  const parcial = caso({ T: 20, code: 100, sunrise: '06:05', obs: '2026-10-28T14:00' }).data.projects[0].weatherNow;
  assert.equal(parcial.T, 20); assert.equal(parcial.code, null); assert.equal(parcial.sunrise, '06:05'); assert.equal(parcial.humidity, null);
  for (const w of [null, 5, 'x', [1]]) assert.equal('weatherNow' in caso(w).data.projects[0], false);
});

/* ---------- Guardar y leer bytes ---------- */
test('toBase64: trozos grandes dan el mismo texto que Buffer', () => {
  const big = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
  IO.setEnv({ btoa: globalThis.btoa });
  assert.equal(IO.toBase64(big), Buffer.from(big).toString('base64'));
  assert.equal(IO.toBase64(new Uint8Array(0)), '');
  IO.setEnv({});                                                      // sin btoa propio usa el global
  assert.equal(IO.toBase64(new Uint8Array([104, 105])), 'aGk=');
  IO.setEnv(null);
});

function nativo(opts) {
  opts = opts || {};
  const calls = { write: [], append: [], share: null };
  const env = { Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async (a) => { calls.write.push(a); return { uri: 'file:///cache/' + a.path }; }, appendFile: async (a) => { calls.append.push(a); if (opts.appendFalla) throw new Error('disco lleno'); } },
    Share: { share: async (a) => { calls.share = a; if (opts.share) return opts.share(a); } }
  } } };
  return { env, calls };
}

test('saveBytes en la app: un archivo chico se escribe de una vez y se comparte', async () => {
  const { env, calls } = nativo(); IO.setEnv(env);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const r = await IO.saveBytes('copia.zip', 'application/zip', bytes, { title: 'Copia', dialogTitle: 'Guardar' });
  assert.deepEqual(r, { how: 'share', name: 'copia.zip' });
  assert.deepEqual(calls.write, [{ path: 'copia.zip', data: Buffer.from(bytes).toString('base64'), directory: 'CACHE' }]);
  assert.equal(calls.append.length, 0);
  assert.deepEqual(calls.share, { title: 'Copia', text: '', url: 'file:///cache/copia.zip', dialogTitle: 'Guardar' });
  IO.setEnv(null);
});

test('saveBytes en la app: un archivo grande se escribe por trozos de 1,5 MB, en orden, y quedan completos', async () => {
  const { env, calls } = nativo(); IO.setEnv(env);
  const CH = 1572864, size = CH * 2 + 1000, bytes = new Uint8Array(size).map((_, i) => (i * 31) % 256);
  const r = await IO.saveBytes('g.zip', 'application/zip', bytes);
  assert.equal(r.how, 'share');
  assert.equal(calls.write.length, 1); assert.equal(calls.append.length, 2);
  const back = Buffer.concat([calls.write[0].data].concat(calls.append.map((a) => a.data)).map((s) => Buffer.from(s, 'base64')));
  assert.equal(back.length, size); assert.equal(Buffer.compare(back, Buffer.from(bytes)), 0);
  assert.equal(calls.share.dialogTitle, 'Compartir archivo');
  IO.setEnv(null);
});

test('saveBytes en la app: cancelar el menú Compartir no es un error; otro fallo sí lo es', async () => {
  let t = nativo({ share: () => { throw new Error('Share canceled'); } }); IO.setEnv(t.env);
  assert.deepEqual(await IO.saveBytes('a.zip', 'application/zip', new Uint8Array(3)), { how: 'cancel', name: 'a.zip' });
  t = nativo({ appendFalla: true }); IO.setEnv(t.env);
  await assert.rejects(IO.saveBytes('a.zip', 'application/zip', new Uint8Array(1572864 + 5)), /disco lleno/);
  assert.equal(t.calls.share, null, 'si no se pudo escribir completo, no se comparte un archivo a medias');
  IO.setEnv(null);
});

test('saveBytes en el navegador: menú de compartir, cancelación, caída a la descarga y descarga directa', async () => {
  let shared = null;
  IO.setEnv({ navigator: { canShare: () => true, share: async (d) => { shared = d; } } });
  assert.deepEqual(await IO.saveBytes('c.zip', 'application/zip', new Uint8Array([1, 2]), { title: 'Copia', text: 'hola' }), { how: 'share', name: 'c.zip' });
  assert.equal(shared.files[0].name, 'c.zip'); assert.equal(shared.files[0].type, 'application/zip'); assert.equal(shared.files[0].size, 2);
  const log = { clicked: 0, revoked: [] };
  const doc = { createElement: () => ({ click() { log.clicked++; }, remove() {} }), body: { appendChild() {} } };
  const url = { createObjectURL: () => 'blob:z', revokeObjectURL: (u) => log.revoked.push(u) };
  IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } } });
  assert.deepEqual(await IO.saveBytes('c.zip', 'application/zip', new Uint8Array(1)), { how: 'cancel', name: 'c.zip' });
  assert.equal(log.clicked, 0);
  IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { throw new Error('falló'); } } });
  assert.deepEqual(await IO.saveBytes('c.zip', undefined, new Uint8Array(1)), { how: 'download', name: 'c.zip' });
  IO.setEnv({ document: doc, URL: url, navigator: {} });
  assert.deepEqual(await IO.saveBytes('c.zip', 'application/zip', new Uint8Array(1)), { how: 'download', name: 'c.zip' });
  assert.equal(log.clicked, 2);
  const File = globalThis.File;
  globalThis.File = function () { throw new Error('sin File'); };
  try { IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true } }); assert.equal((await IO.saveBytes('c.zip', 'application/zip', new Uint8Array(1))).how, 'download'); }
  finally { globalThis.File = File; IO.setEnv(null); }
});

/* ---------- Datos guardados en el teléfono ---------- */
function fakeStorage(init) {
  const data = Object.assign({}, init);
  return { data, getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
test('loadState: limpia las listas de fotos y el clima actual guardados en los proyectos', () => {
  const raw = { projects: [{ id: 'a', name: 'X', weatherNow: { T: 20 }, points: [
    { id: 'p1', lat: 1, lon: 1, name: 'P1', photos: [{ id: 'f1', w: 10, h: 10 }, { id: '¡mal!' }, 'x'] },
    { id: 'p2', lat: 1, lon: 1, name: 'P2', photos: [{ id: '¡mal!' }] },
    { id: 'p3', lat: 1, lon: 1, name: 'P3', photos: 'no' },
    { id: 'p4', lat: 1, lon: 1, name: 'P4' }] },
  { id: 'b', name: 'Y', weatherNow: [1, 2], points: [] }, { id: 'c', name: 'Z', weatherNow: 'x', points: [] }], currentId: 'a' };
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify(raw) }));
  const s = Store.loadState(), a = s.projects[0];
  assert.deepEqual(a.points[0].photos, [{ id: 'f1', w: 10, h: 10, n: null, at: null }]);
  for (const i of [1, 2, 3]) assert.equal('photos' in a.points[i], false, 'P' + (i + 1));
  assert.deepEqual(a.weatherNow, { T: 20 });
  assert.equal('weatherNow' in s.projects[1].lots[0], false); assert.equal('weatherNow' in s.projects[2].lots[0], false);
});

test('hasSavedState: distingue datos guardados de verdad del primer arranque', () => {
  Store.setBackend(fakeStorage());
  assert.equal(Store.hasSavedState(), false);
  Store.setBackend(fakeStorage({ 'zvg.v1.state': '{roto' })); assert.equal(Store.hasSavedState(), false);
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify({ projects: [] }) })); assert.equal(Store.hasSavedState(), false);
  Store.setBackend(fakeStorage({ 'zvg.v1.state': JSON.stringify({ projects: [{ id: 'a' }] }) })); assert.equal(Store.hasSavedState(), true);
  Store.setBackend(null);
});

/* ---------- Reporte con fotos ---------- */
const PUNTOS = [{ name: 'P1', lat: 4.60, lon: -74.10, alt: 1800 }, { name: 'P2', lat: 4.60, lon: -74.09, alt: 2400, color: '#D8353C' }, { name: 'P3', lat: 4.61, lon: -74.09, alt: 3000 }];
function proyecto(puntos) {
  const project = { name: 'Finca <La> Esperanza', points: puntos, climate: { pManual: 1100 }, layers: [], mainColor: '#2F8F4E' };
  return { project, a: A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() }) };
}
const DATA = 'data:image/jpeg;base64,/9j/4AAQ';

test('reporte: las fotos salen por punto, con la principal primero y el color del punto', () => {
  const pts = PUNTOS.map((p) => Object.assign({}, p));
  pts[0].photos = [{ id: 'f1' }, { id: 'f2' }]; pts[1].photos = [{ id: 'f3' }];
  const x = proyecto(pts);
  const h = Report.html(x.project, x.a, { date: NOW, photos: { f1: DATA, f2: DATA + 'AA', f3: DATA + 'BB' } });
  assert.match(h, /<h2>Fotos de los puntos<\/h2>/);
  assert.equal((h.match(/<img src="data:image\/jpeg/g) || []).length, 3);
  assert.match(h, /<figcaption>Principal<\/figcaption>/); assert.match(h, /<figcaption>Foto 2<\/figcaption>/);
  assert.match(h, /alt="Foto 1 de P1"/);
  assert.match(h, /<span class="dot" style="background:#D8353C"><\/span>P2/, 'P2 con su color propio');
  assert.match(h, /<span class="dot" style="background:#2F8F4E"><\/span>P1/, 'P1 con el color de los puntos del proyecto');
  assert.match(h, /Fotos reducidas para este reporte/);
  assert.ok(h.indexOf('Fotos de los puntos') > h.indexOf('<h2>Puntos</h2>'));
});

test('reporte: sin imágenes preparadas, o con una que no es JPEG en data:, no se dibuja nada de fotos', () => {
  const pts = PUNTOS.map((p) => Object.assign({}, p)); pts[0].photos = [{ id: 'f1' }];
  const x = proyecto(pts);
  for (const photos of [undefined, null, 'x', {}, { f1: 'https://malo.example/a.jpg' }, { f1: 'data:text/html;base64,PHNjcmlwdD4=' }, { f1: 5 }]) {
    assert.doesNotMatch(Report.html(x.project, x.a, { date: NOW, photos }), /Fotos de los puntos|<figure>/, JSON.stringify(photos));
  }
  const sin = proyecto(PUNTOS);
  assert.doesNotMatch(Report.html(sin.project, sin.a, { date: NOW, photos: { f1: DATA } }), /Fotos de los puntos/);
});

test('reporte: el texto de los puntos dice cuántas fotos tiene cada uno y el color propio usa solo #RRGGBB', () => {
  const pts = PUNTOS.map((p) => Object.assign({}, p)); pts[0].photos = [{ id: 'a' }]; pts[2].photos = [{ id: 'a' }, { id: 'b' }]; pts[2].color = 'rojo';
  const x = proyecto(pts);
  const t = Report.text(x.project, x.a, { date: NOW });
  assert.match(t, /P1: .* · 1 foto\n/); assert.match(t, /P3: .* · 2 fotos/); assert.doesNotMatch(t, /P2: .*foto/);
  assert.equal(Report.dot({ color: 'rojo' }, { mainColor: 'azul' }), '<span class="dot" style="background:#2F8F4E"></span>', 'sin colores válidos, el verde de siempre');
  assert.equal(Report.dot({}, { mainColor: '#112233' }), '<span class="dot" style="background:#112233"></span>');
});

/* ---------- Copia .json pesada: fotos dentro del JSON ---------- */
test('.json pesado: crear → texto → leer → validar devuelve los proyectos y las imágenes idénticas', () => {
  const b = Backup.attachPhotos(Backup.create(estado(), [], { now: NOW, hasPhoto: todas }), Object.keys(BYTES).map((id) => ({ id, bytes: BYTES[id] })));
  const texto = Backup.stringify(b);
  assert.deepEqual(Object.keys(JSON.parse(texto)).pop(), 'photos', 'las fotos van al final: lo legible queda primero');
  const raw = JSON.parse(texto);
  const pj = Backup.photosFromJson(raw);
  assert.equal(pj.skipped, 0);
  assert.deepEqual(Object.keys(pj.photos).sort(), ['f1', 'f2', 'f3']);
  for (const id of Object.keys(BYTES)) assert.deepEqual(Array.from(pj.photos[id]), Array.from(BYTES[id]));
  const v = Backup.validate(raw, { uid, now: NOW, photos: pj.photos });
  assert.equal(v.ok, true, v.errors.join('; ')); assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.summary, { projects: 1, points: 3, layers: 0, photos: 3, memory: 0 });
  assert.equal(v.data.projects[0].points[0].photos.length, 2);
  assert.equal('photos' in v.data, false, 'las imágenes no se cuelan en los datos del estado');
});

test('.json pesado: el estado de la app no cambia y el .json liviano nunca lleva la clave «photos»', () => {
  const st = estado();
  const liviano = Backup.create(st, [], { now: NOW, hasPhoto: () => false });
  assert.equal('photos' in liviano, false);
  const antes = JSON.stringify(st);
  Backup.attachPhotos(Backup.create(st, [], { now: NOW, hasPhoto: todas }), [{ id: 'f1', bytes: BYTES.f1 }]);
  assert.equal(JSON.stringify(st), antes);
  assert.deepEqual(Backup.attachPhotos({}, null).photos, {}, 'sin fotos: un mapa vacío');
});

test('.json liviano o sin la clave: no hay fotos que leer y no es un error', () => {
  for (const raw of [{}, { photos: null }, { photos: [] }, { photos: 'x' }, null, undefined, 5, [1], 'x']) assert.deepEqual(Backup.photosFromJson(raw), { photos: {}, skipped: 0 }, JSON.stringify(raw));
});

test('.json pesado: una foto mala no detiene la lectura; se cuenta como omitida', () => {
  const grande = Fotos.toBase64(Object.assign(new Uint8Array(Fotos.MAX_PHOTO + 1), { 0: 0xFF, 1: 0xD8, 2: 0xFF }));
  const r = Backup.photosFromJson({ photos: {
    ok: Fotos.toBase64(jpeg(1)),
    'id malo!': Fotos.toBase64(jpeg(2)),            // id no válido
    __proto__x: 5,                                  // no es texto
    sinBase64: 'esto no es base64!',
    png: Fotos.toBase64(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2])),   // no es JPEG
    grande                                          // pesa demasiado
  } });
  assert.deepEqual(Object.keys(r.photos), ['ok']);
  assert.equal(r.skipped, 5);
  const proto = JSON.parse('{"photos":{"__proto__":"' + Fotos.toBase64(jpeg(1)) + '"}}');
  const p = Backup.photosFromJson(proto);
  assert.deepEqual(Object.keys(p.photos), []); assert.equal(p.skipped, 1);
  assert.equal(Object.getPrototypeOf(p.photos), Object.prototype, 'un id «__proto__» no cambia el objeto');
});

test('.json pesado: los límites de cantidad y de peso total protegen la memoria', () => {
  const L = Backup.LIMITS, old = { photos: L.photos, photoBytes: L.photoBytes };
  const raw = { photos: { a: Fotos.toBase64(jpeg(1)), b: Fotos.toBase64(jpeg(2)), c: Fotos.toBase64(jpeg(3)) } };
  try {
    L.photos = 2; let r = Backup.photosFromJson(raw);
    assert.equal(Object.keys(r.photos).length, 2); assert.equal(r.skipped, 1);
    L.photos = old.photos; L.photoBytes = 12; r = Backup.photosFromJson(raw);          // cada foto pesa 5 bytes (8 letras de base64): caben dos
    assert.equal(Object.keys(r.photos).length, 2); assert.equal(r.skipped, 1);
  } finally { L.photos = old.photos; L.photoBytes = old.photoBytes; }
  assert.equal(Backup.LIMITS.jsonPhotoBytes, 40 * 1024 * 1024, 'tope de fotos dentro de un .json');
});

test('.json pesado: validar sin las imágenes (un .json pesado al que le quitaron «photos») avisa y deja los puntos', () => {
  const b = Backup.attachPhotos(Backup.create(estado(), [], { now: NOW, hasPhoto: todas }), Object.keys(BYTES).map((id) => ({ id, bytes: BYTES[id] })));
  const raw = JSON.parse(Backup.stringify(b)); delete raw.photos;
  const v = Backup.validate(raw, { uid, now: NOW, photos: Backup.photosFromJson(raw).photos });
  assert.equal(v.ok, true); assert.equal(v.summary.points, 3); assert.equal(v.summary.photos, 0);
  assert.ok(v.warnings.some((w) => /3 fotos no venían en el archivo y se omitieron/.test(w)));
});

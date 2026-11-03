'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Fotos = require('../www/js/fotos.js');

/* ---------- Ayudas: un navegador de mentira (imagen, canvas, IndexedDB) ---------- */
const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);

// Entorno mínimo para shrink(). opts: { w, h, bitmap: 'ok'|'sinOpciones'|'falla'|'no', ctx: false, blob: null|'png'|'grande', closeSpy }
function fakeEnv(opts) {
  opts = opts || {};
  const log = { draws: [], closed: 0, canvas: null, urls: { made: 0, revoked: 0 }, cibCalls: [] };
  const bytesOut = opts.blob === 'png' ? new Uint8Array([0x89, 0x50, 0x4E, 0x47]) : JPEG;
  const env = {
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const cv = {
          width: 0, height: 0,
          getContext() { return opts.ctx === false ? null : { fillStyle: '', fillRect() {}, drawImage(src, x, y, w, h) { log.draws.push({ src, w, h }); } }; },
          toBlob(cb, type, q) {
            log.type = type; log.quality = q;
            if (opts.blob === null) { cb(null); return; }
            cb({ arrayBuffer: () => Promise.resolve(opts.blob === 'grande' ? (() => { const g = new Uint8Array(Fotos.MAX_PHOTO + 1); g.set(JPEG); return g.buffer; })() : bytesOut.buffer.slice(bytesOut.byteOffset, bytesOut.byteOffset + bytesOut.byteLength)) });
          }
        };
        log.canvas = cv;
        return cv;
      }
    },
    URL: { createObjectURL() { log.urls.made++; return 'blob:x'; }, revokeObjectURL() { log.urls.revoked++; } },
    Image: function () {
      const img = this;
      Object.defineProperty(img, 'src', { set() { setTimeout(() => (opts.imgError ? img.onerror() : img.onload()), 0); } });
      img.naturalWidth = opts.w === undefined ? 4000 : opts.w; img.naturalHeight = opts.h === undefined ? 3000 : opts.h;
    }
  };
  const bm = () => ({ width: opts.w === undefined ? 4000 : opts.w, height: opts.h === undefined ? 3000 : opts.h, close() { log.closed++; } });
  if (opts.bitmap !== 'no') {
    env.createImageBitmap = function (file, o) {
      log.cibCalls.push(o);
      if (opts.bitmap === 'falla') return Promise.reject(new Error('no'));
      if (opts.bitmap === 'sinOpciones' && o) return Promise.reject(new Error('opciones no válidas'));
      return Promise.resolve(bm());
    };
  }
  return { env, log };
}
const file = (size, type) => ({ size: size === undefined ? 1000 : size, type: type === undefined ? 'image/jpeg' : type });

/* ---------- Medidas y listas ---------- */
test('fit: reduce al lado mayor sin agrandar nunca y conserva la proporción', () => {
  assert.deepEqual(Fotos.fit(4000, 3000, 1280), { w: 1280, h: 960 });
  assert.deepEqual(Fotos.fit(3000, 4000, 1280), { w: 960, h: 1280 });
  assert.deepEqual(Fotos.fit(800, 600, 1280), { w: 800, h: 600 }, 'no se agranda');
  assert.deepEqual(Fotos.fit(1280, 1280, 1280), { w: 1280, h: 1280 });
  assert.deepEqual(Fotos.fit(20000, 10, 1280), { w: 1280, h: 1 }, 'nunca queda en 0 px');
  assert.deepEqual(Fotos.fit(0, 0, 1280), { w: 0, h: 0 });
});

test('isId / isJpeg / newId', () => {
  for (const ok of ['a', 'f1k2', 'A_b-9', 'x'.repeat(40)]) assert.equal(Fotos.isId(ok), true, ok);
  for (const mal of ['', 'x'.repeat(41), 'a b', 'a/b', '../x', 7, null, undefined, 'a.jpg', '__proto__']) assert.equal(Fotos.isId(mal), false, String(mal));
  assert.equal(Fotos.isId('constructor'), true, 'un nombre común sí es un id válido (se guarda como propiedad propia)');
  assert.equal(Fotos.isJpeg(JPEG), true);
  assert.equal(Fotos.isJpeg(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), false);
  assert.equal(Fotos.isJpeg(new Uint8Array([0xFF, 0xD8])), false, 'muy corto');
  assert.equal(Fotos.isJpeg(null), false);
  const a = Fotos.newId(), b = Fotos.newId();
  assert.equal(Fotos.isId(a), true);
  assert.notEqual(a, b);
});

test('cleanList: solo ids válidos y distintos, números en rango, como máximo 5', () => {
  const l = Fotos.cleanList([
    { id: 'a', w: 1280, h: 960, n: 5000, at: 1700000000000, extra: 'x' },
    { id: 'a', w: 1, h: 1 },                    // repetida
    { id: 'b c' },                              // id no válido
    null, 7, 'x', { },                          // basura
    { id: 'c', w: 1.5, h: -3, n: 'x', at: -1 }, // números fuera de rango → null
    { id: 'd', w: 99999, h: 0, n: Fotos.MAX_PHOTO + 1, at: 9e15 },
    { id: 'e' }, { id: 'f' }, { id: 'g' }
  ]);
  assert.deepEqual(l[0], { id: 'a', w: 1280, h: 960, n: 5000, at: 1700000000000 });
  assert.deepEqual(l[1], { id: 'c', w: null, h: null, n: null, at: null });
  assert.deepEqual(l[2], { id: 'd', w: null, h: null, n: null, at: null });
  assert.equal(l.length, Fotos.MAX_PER_POINT);
  assert.deepEqual(l.map((f) => f.id), ['a', 'c', 'd', 'e', 'f']);
  assert.deepEqual(Fotos.cleanList('no'), []);
  assert.deepEqual(Fotos.cleanList(undefined), []);
});

test('cleanList con has(): solo cuentan las fotos cuya imagen existe', () => {
  const l = Fotos.cleanList([{ id: 'a' }, { id: 'b' }, { id: 'c' }], (id) => id !== 'b');
  assert.deepEqual(l.map((f) => f.id), ['a', 'c']);
});

test('usedIds y countAll', () => {
  const projects = [
    { points: [{ photos: [{ id: 'a' }, { id: 'b' }] }, { photos: [{ id: 'a' }] }, { }, { photos: 'no' }, { photos: [null, { id: 'mal id' }, { id: 'c' }] }] },
    { points: [{ photos: [{ id: 'd' }] }] },
    { }, null
  ].filter(Boolean);
  assert.deepEqual(Fotos.usedIds(projects), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Fotos.usedIds(null), []);
  assert.deepEqual(Fotos.usedIds([{ }]), []);
  assert.deepEqual(Fotos.countAll([{ photos: [1, 2] }, { }, { photos: [1] }]), { photos: 3, points: 2, without: 1 });
  assert.deepEqual(Fotos.countAll([]), { photos: 0, points: 0, without: 0 });
  assert.deepEqual(Fotos.countAll(undefined), { photos: 0, points: 0, without: 0 });
});

/* ---------- Reducir la imagen ---------- */
test('shrink: una foto grande sale como JPEG de 1280 px, con la orientación del teléfono y sin transparencia', async () => {
  const { env, log } = fakeEnv({ w: 4000, h: 3000 });
  const r = await Fotos.shrink(file(3e6), {}, env);
  assert.equal(r.w, 1280); assert.equal(r.h, 960);
  assert.equal(Fotos.isJpeg(r.bytes), true);
  assert.equal(log.canvas.width, 1280); assert.equal(log.canvas.height, 960);
  assert.equal(log.type, 'image/jpeg'); assert.equal(log.quality, Fotos.QUALITY);
  assert.deepEqual(log.cibCalls[0], { imageOrientation: 'from-image' }, 'pide respetar la orientación (si no, las fotos de lado saldrían giradas)');
  assert.equal(log.draws.length, 1);
  assert.equal(log.closed, 1, 'libera la imagen');
});

test('shrink: usa el tamaño y la calidad que se le piden (el reporte compartido pesa menos)', async () => {
  const { env, log } = fakeEnv({ w: 1280, h: 960 });
  const r = await Fotos.shrink(file(), { max: Fotos.REPORT_SIDE, quality: Fotos.REPORT_QUALITY }, env);
  assert.equal(r.w, 900); assert.equal(r.h, 675);
  assert.equal(log.quality, 0.75);
});

test('shrink: una foto pequeña no se agranda', async () => {
  const { env } = fakeEnv({ w: 640, h: 480 });
  const r = await Fotos.shrink(file(), {}, env);
  assert.deepEqual([r.w, r.h], [640, 480]);
});

test('shrink: si el navegador no acepta las opciones de orientación, lo vuelve a intentar sin ellas', async () => {
  const { env, log } = fakeEnv({ bitmap: 'sinOpciones' });
  const r = await Fotos.shrink(file(), {}, env);
  assert.equal(r.w, 1280);
  assert.equal(log.cibCalls.length, 2);
  assert.equal(log.cibCalls[1], undefined);
});

test('shrink: si createImageBitmap falla o no existe, abre la imagen con <img> y libera la dirección temporal', async () => {
  for (const bitmap of ['falla', 'no']) {
    const { env, log } = fakeEnv({ bitmap });
    const r = await Fotos.shrink(file(), {}, env);
    assert.equal(r.w, 1280, bitmap);
    assert.equal(log.urls.made, 1); assert.equal(log.urls.revoked, 1);
    assert.equal(log.closed, 0, 'una <img> no se cierra');
  }
});

test('shrink: si la imagen no se puede abrir de ninguna manera, da un error claro', async () => {
  const { env, log } = fakeEnv({ bitmap: 'no', imgError: true });
  await assert.rejects(Fotos.shrink(file(), {}, env), /No se pudo leer la imagen/);
  assert.equal(log.urls.revoked, 1);
});

test('shrink: rechaza lo que no sirve, con mensajes en español', async () => {
  const { env } = fakeEnv();
  await assert.rejects(Fotos.shrink(null, {}, env), /No llegó ninguna imagen/);
  await assert.rejects(Fotos.shrink({}, {}, env), /No llegó ninguna imagen/);
  await assert.rejects(Fotos.shrink(file(0), {}, env), /vacío/);
  await assert.rejects(Fotos.shrink(file(Fotos.MAX_INPUT + 1), {}, env), /demasiado grande/);
  await assert.rejects(Fotos.shrink(file(100, 'application/pdf'), {}, env), /no es una imagen/);
  assert.ok(await Fotos.shrink(file(100, ''), {}, env), 'sin tipo declarado se intenta igual');
});

test('shrink: una imagen sin tamaño, sin canvas, sin blob, que no sale en JPEG o que pesa demasiado, falla con su mensaje', async () => {
  let t = fakeEnv({ w: 0, h: 0 });
  await assert.rejects(Fotos.shrink(file(), {}, t.env), /no tiene tamaño/);
  assert.equal(t.log.closed, 1);
  t = fakeEnv({ ctx: false });
  await assert.rejects(Fotos.shrink(file(), {}, t.env), /no puede preparar la foto/);
  assert.equal(t.log.closed, 1);
  t = fakeEnv({ blob: null });
  await assert.rejects(Fotos.shrink(file(), {}, t.env), /No se pudo preparar la foto/);
  t = fakeEnv({ blob: 'png' });
  await assert.rejects(Fotos.shrink(file(), {}, t.env), /No se pudo preparar la foto/);
  t = fakeEnv({ blob: 'grande' });
  await assert.rejects(Fotos.shrink(file(), {}, t.env), /sigue siendo demasiado grande/);
});

/* ---------- Guardar en el teléfono (IndexedDB) ---------- */
// IndexedDB de mentira: guarda en un Map y responde en el turno siguiente, como el de verdad.
function fakeIDB(opts) {
  opts = opts || {};
  const data = new Map();
  let created = false, opens = 0;
  const later = (fn) => setTimeout(fn, 0);
  return {
    data, opens: () => opens,
    open(name, version) {
      opens++;
      assert.equal(name, 'zvg.v1.photos'); assert.equal(version, 1);
      if (opts.openThrows && opens === 1) throw new Error('bloqueado');
      const req = {};
      const db = {
        objectStoreNames: { contains: () => created },
        createObjectStore(n, o) { assert.equal(n, 'fotos'); assert.deepEqual(o, { keyPath: 'id' }); created = true; },
        transaction(storeName, mode) {
          assert.equal(storeName, 'fotos'); assert.ok(mode === 'readonly' || mode === 'readwrite');
          if (opts.txThrows) throw new Error('sin transacción');
          const tx = {};
          const done = (result) => { const r = { result }; later(() => { if (opts.txError) tx.onerror(); else if (opts.txAbort) tx.onabort(); else tx.oncomplete(); }); return r; };
          tx.objectStore = () => ({
            put(rec) { data.set(rec.id, rec); return done(rec.id); },
            get(id) { return done(data.get(id)); },
            delete(id) { data.delete(id); return done(undefined); },
            getAllKeys() { return done(Array.from(data.keys()).concat(opts.badKey ? ['no válida!'] : [])); }
          });
          return tx;
        }
      };
      later(() => {
        if (opts.openError && opens === 1) { req.error = null; req.onerror(); return; }
        req.result = db;
        if (!created && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess();
      });
      return req;
    }
  };
}

test('almacén de fotos: guarda, lee, lista y borra; lo leído es una copia', async () => {
  const idb = fakeIDB(), st = Fotos.createStore(idb);
  const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 9, 8, 7]);
  assert.equal(await st.put('a1', bytes), undefined);
  bytes[3] = 0;                                              // cambiar el original no cambia lo guardado
  const got = await st.get('a1');
  assert.deepEqual(Array.from(got), [0xFF, 0xD8, 0xFF, 9, 8, 7]);
  assert.equal(idb.data.get('a1').type, 'image/jpeg'); assert.equal(idb.data.get('a1').n, 6);
  assert.equal(await st.get('no-hay'), null);
  await st.put('b2', JPEG);
  assert.deepEqual((await st.keys()).sort(), ['a1', 'b2']);
  assert.equal(await st.del('a1'), undefined);
  assert.deepEqual(await st.keys(), ['b2']);
  assert.equal(idb.opens(), 1, 'la base se abre una sola vez');
});

test('almacén de fotos: solo devuelve ids válidos al listar', async () => {
  const st = Fotos.createStore(fakeIDB({ badKey: true }));
  await st.put('ok', JPEG);
  assert.deepEqual(await st.keys(), ['ok']);
});

test('almacén de fotos: sin IndexedDB, o si falla, da un error claro y la próxima vez vuelve a intentar', async () => {
  await assert.rejects(Fotos.createStore(null).put('a', JPEG), /no permite guardar fotos/);
  const st = Fotos.createStore(fakeIDB({ openThrows: true }));
  await assert.rejects(st.get('a'), /bloqueado/);
  assert.equal(await st.get('a'), null, 'el segundo intento abre bien');
  const st2 = Fotos.createStore(fakeIDB({ openError: true }));
  await assert.rejects(st2.get('a'), /No se pudo abrir el almacén de fotos/);
  assert.equal(await st2.get('a'), null);
});

test('almacén de fotos: errores de la transacción', async () => {
  await assert.rejects(Fotos.createStore(fakeIDB({ txThrows: true })).put('a', JPEG), /sin transacción/);
  await assert.rejects(Fotos.createStore(fakeIDB({ txError: true })).put('a', JPEG), /No se pudo guardar la foto/);
  await assert.rejects(Fotos.createStore(fakeIDB({ txAbort: true })).put('a', JPEG), /No se pudo guardar la foto/);
});

test('sweep: borra las imágenes que ningún punto usa y deja las demás', async () => {
  const st = Fotos.createStore(fakeIDB());
  for (const id of ['a', 'b', 'c']) await st.put(id, JPEG);
  assert.equal(await Fotos.sweep(st, ['b']), 2);
  assert.deepEqual(await st.keys(), ['b']);
  assert.equal(await Fotos.sweep(st, ['b']), 0);
});

/* ---------- Restaurar fotos de una copia ---------- */
test('importAll: guarda las nuevas, reutiliza las iguales y nunca pisa una foto distinta con el mismo id', async () => {
  const st = Fotos.createStore(fakeIDB());
  const mia = new Uint8Array([0xFF, 0xD8, 0xFF, 1]), otra = new Uint8Array([0xFF, 0xD8, 0xFF, 2]);
  await st.put('x', mia); await st.put('y', mia);
  let n = 0;
  const r = await Fotos.importAll(st, [
    { id: 'x', bytes: mia },       // ya está y es la misma
    { id: 'y', bytes: otra },      // mismo id, otra imagen → id nuevo
    { id: 'z', bytes: otra }       // nueva
  ], () => 'nuevo' + (++n));
  assert.deepEqual(r.map, { x: 'x', y: 'nuevo1', z: 'z' });
  assert.equal(r.written, 2);
  assert.deepEqual(Array.from(await st.get('y')), Array.from(mia), 'la mía sigue igual');
  assert.deepEqual(Array.from(await st.get('nuevo1')), Array.from(otra));
  assert.deepEqual((await Fotos.importAll(st, [])).map, {});
});

test('importAll: sin generador propio inventa ids válidos', async () => {
  const st = Fotos.createStore(fakeIDB());
  await st.put('x', new Uint8Array([0xFF, 0xD8, 0xFF, 1]));
  const r = await Fotos.importAll(st, [{ id: 'x', bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 2, 2]) }]);
  assert.notEqual(r.map.x, 'x'); assert.equal(Fotos.isId(r.map.x), true);
  assert.deepEqual(Array.from(await st.get('x')), [0xFF, 0xD8, 0xFF, 1]);
});

/* ---------- Direcciones temporales para mostrar las imágenes ---------- */
function fakeUrlApi() {
  const made = [], revoked = [];
  return { made, revoked, createObjectURL(b) { made.push(b); return 'blob:' + made.length; }, revokeObjectURL(u) { revoked.push(u); } };
}
class FakeBlob { constructor(parts, o) { this.parts = parts; this.type = o.type; } }

test('createUrls: pide cada imagen una vez y reutiliza la dirección', async () => {
  const st = Fotos.createStore(fakeIDB()); await st.put('a', JPEG);
  const api = fakeUrlApi(), u = Fotos.createUrls(st, api, FakeBlob);
  const [x, y] = await Promise.all([u.get('a'), u.get('a')]);
  assert.equal(x, 'blob:1'); assert.equal(y, 'blob:1');
  assert.equal(await u.get('a'), 'blob:1');
  assert.equal(api.made.length, 1);
  assert.equal(api.made[0].type, 'image/jpeg');
});

test('createUrls: una imagen que no está no deja nada guardado y se puede pedir otra vez', async () => {
  const st = Fotos.createStore(fakeIDB()), api = fakeUrlApi(), u = Fotos.createUrls(st, api, FakeBlob);
  assert.equal(await u.get('luego'), null);
  await st.put('luego', JPEG);
  assert.equal(await u.get('luego'), 'blob:1');
});

test('createUrls: si el almacén falla, el error llega y la próxima vez se vuelve a intentar', async () => {
  const idb = fakeIDB({ openError: true }), st = Fotos.createStore(idb), api = fakeUrlApi(), u = Fotos.createUrls(st, api, FakeBlob);
  await assert.rejects(u.get('a'), /almacén/);
  assert.equal(await u.get('a'), null);
});

test('createUrls: revoke y clear liberan las direcciones', async () => {
  const st = Fotos.createStore(fakeIDB()); await st.put('a', JPEG); await st.put('b', JPEG);
  const api = fakeUrlApi(), u = Fotos.createUrls(st, api, FakeBlob);
  await u.get('a'); await u.get('b');
  u.revoke('a'); u.revoke('no-existe');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(api.revoked, ['blob:1']);
  u.clear();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(api.revoked.sort(), ['blob:1', 'blob:2']);
  assert.equal(await u.get('a'), 'blob:3', 'después de liberar se vuelve a crear');
});

/* ---------- Base64 (copia .json con fotos) ---------- */
test('toBase64 / fromBase64: ida y vuelta, también con fotos grandes (por trozos) y vacías', () => {
  const grande = new Uint8Array(200000).map((_, i) => (i * 13 + 5) % 256);
  assert.equal(Fotos.toBase64(grande), Buffer.from(grande).toString('base64'));
  assert.equal(Buffer.compare(Buffer.from(Fotos.fromBase64(Fotos.toBase64(grande))), Buffer.from(grande)), 0);
  assert.equal(Fotos.toBase64(new Uint8Array(0)), '');
  assert.equal(Fotos.fromBase64('').length, 0);
  assert.deepEqual(Array.from(Fotos.fromBase64('/9j/4A==')), [0xFF, 0xD8, 0xFF, 0xE0]);
});

test('fromBase64: lo que no es base64 válido da null y no lanza', () => {
  for (const mal of ['abc', 'ab!d', 'ab=d', '====', 'a b c d', 5, null, undefined, {}, '/9j/4A=', 'ñññð']) assert.equal(Fotos.fromBase64(mal), null, String(mal));
});

test('toBase64 / fromBase64: sin btoa ni atob en el equipo, avisa o devuelve null', () => {
  const b = globalThis.btoa, a = globalThis.atob;
  try {
    delete globalThis.btoa; delete globalThis.atob;
    assert.throws(() => Fotos.toBase64(new Uint8Array([1])), /no puede convertir la foto/);
    assert.equal(Fotos.fromBase64('AAAA'), null);
  } finally { globalThis.btoa = b; globalThis.atob = a; }
});

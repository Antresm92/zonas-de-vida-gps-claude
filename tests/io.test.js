'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IO = require('../www/js/io.js');

test.afterEach(() => IO.setEnv(null));

test('slug: nombre de archivo seguro, sin tildes ni símbolos', () => {
  assert.equal(IO.slug('Informe Zona de Vida – Finca Año', 'html'), 'informe-zona-de-vida-finca-ano.html');
  assert.equal(IO.slug('  ¡¡Mi finca!!  '), 'mi-finca');
  assert.equal(IO.slug(''), 'archivo');
  assert.equal(IO.slug(null, 'kml'), 'archivo.kml');
  assert.equal(IO.slug('a'.repeat(100)).length, 60);
});

test('capPlugin: solo existe dentro de la app de Android', () => {
  IO.setEnv({});
  assert.equal(IO.capPlugin('Share'), null);
  IO.setEnv({ Capacitor: { isNativePlatform: () => false } });
  assert.equal(IO.capPlugin('Share'), null);
  const share = { id: 'share' };
  IO.setEnv({ Capacitor: { isNativePlatform: () => true, Plugins: { Share: share } } });
  assert.equal(IO.capPlugin('Share'), share);
  IO.setEnv({ Capacitor: { isNativePlatform: () => true, registerPlugin: (n) => ({ registrado: n }) } });
  assert.deepEqual(IO.capPlugin('Filesystem'), { registrado: 'Filesystem' });
  IO.setEnv({ Capacitor: { isNativePlatform: () => true, registerPlugin: () => { throw new Error('no'); } } });
  assert.equal(IO.capPlugin('Filesystem'), null);
  IO.setEnv({ Capacitor: { isNativePlatform: () => true } });
  assert.equal(IO.capPlugin('Filesystem'), null);
});

function nativeEnv(shareImpl) {
  const calls = { write: null, share: null };
  const env = { Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async (a) => { calls.write = a; return { uri: 'file:///cache/' + a.path }; } },
    Share: { share: async (a) => { calls.share = a; if (shareImpl) return shareImpl(a); } }
  } } };
  return { env, calls };
}

test('saveText en la app: escribe en la carpeta temporal y abre el menú Compartir', async () => {
  const { env, calls } = nativeEnv();
  IO.setEnv(env);
  const r = await IO.saveText('finca.kml', 'application/vnd.google-earth.kml+xml', '<kml/>', { title: 'Finca', text: 'Mi finca', dialogTitle: 'Enviar' });
  assert.deepEqual(r, { how: 'share', name: 'finca.kml' });
  assert.deepEqual(calls.write, { path: 'finca.kml', data: '<kml/>', directory: 'CACHE', encoding: 'utf8' });
  assert.deepEqual(calls.share, { title: 'Finca', text: 'Mi finca', url: 'file:///cache/finca.kml', dialogTitle: 'Enviar' });
});

test('saveText en la app: valores por defecto, cancelación y errores reales', async () => {
  let n = nativeEnv();
  IO.setEnv(n.env);
  await IO.saveText('a.txt', 'text/plain', 'x');
  assert.deepEqual(n.calls.share, { title: 'a.txt', text: '', url: 'file:///cache/a.txt', dialogTitle: 'Compartir archivo' });
  n = nativeEnv(() => { throw new Error('Share canceled'); });
  IO.setEnv(n.env);
  assert.deepEqual(await IO.saveText('a.txt', 'text/plain', 'x'), { how: 'cancel', name: 'a.txt' });
  n = nativeEnv(() => { throw new Error('disco lleno'); });
  IO.setEnv(n.env);
  await assert.rejects(IO.saveText('a.txt', 'text/plain', 'x'), /disco lleno/);
});

function fakeDoc() {
  const log = { clicked: 0, appended: 0, removed: 0, a: null, revoked: [] };
  const doc = { createElement: () => { const a = { click: () => { log.clicked++; }, remove: () => { log.removed++; } }; log.a = a; return a; }, body: { appendChild: () => { log.appended++; } } };
  const url = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => log.revoked.push(u) };
  return { doc, url, log };
}

test('saveText en el navegador sin menú de compartir: descarga el archivo', async () => {
  const { doc, url, log } = fakeDoc();
  IO.setEnv({ document: doc, URL: url, navigator: {} });
  const r = await IO.saveText('datos.csv', 'text/csv', 'a;b');
  assert.deepEqual(r, { how: 'download', name: 'datos.csv' });
  assert.equal(log.a.href, 'blob:fake'); assert.equal(log.a.download, 'datos.csv');
  assert.equal(log.clicked, 1); assert.equal(log.appended, 1); assert.equal(log.removed, 1);
});

test('saveText en el navegador: usa el menú de compartir si admite archivos', async () => {
  let shared = null;
  IO.setEnv({ navigator: { canShare: () => true, share: async (d) => { shared = d; } } });
  const r = await IO.saveText('x.json', 'application/json', '{}', { title: 'Copia', text: 'hola' });
  assert.deepEqual(r, { how: 'share', name: 'x.json' });
  assert.equal(shared.files[0].name, 'x.json'); assert.equal(shared.title, 'Copia'); assert.equal(shared.text, 'hola');
});

test('saveText en el navegador: cancelar no descarga; otro error sí cae a la descarga', async () => {
  const { doc, url, log } = fakeDoc();
  IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } } });
  assert.deepEqual(await IO.saveText('x.json', 'application/json', '{}'), { how: 'cancel', name: 'x.json' });
  assert.equal(log.clicked, 0);
  IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { throw new Error('falló'); } } });
  assert.deepEqual(await IO.saveText('x.json', undefined, '{}'), { how: 'download', name: 'x.json' });
  assert.equal(log.clicked, 1);
});

test('saveText: si el navegador no sabe crear archivos (File), descarga', async () => {
  const { doc, url } = fakeDoc();
  const File = globalThis.File;
  globalThis.File = function () { throw new Error('sin File'); };
  try {
    IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { throw new Error('no debía llamarse'); } } });
    assert.equal((await IO.saveText('x.txt', 'text/plain', 'x')).how, 'download');
  } finally { globalThis.File = File; }
});

test('readBytes / readText: bytes del archivo, quita la marca BOM y entiende tildes', async () => {
  const texto = '﻿altitud: 2640 m — año';
  const file = { arrayBuffer: async () => new TextEncoder().encode(texto).buffer };
  const bytes = await IO.readBytes(file);
  assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length, new TextEncoder().encode(texto).length);
  assert.equal(await IO.readText(file), 'altitud: 2640 m — año');
});

test('readBytes: con FileReader cuando el archivo no tiene arrayBuffer, y error de lectura', async () => {
  const FR = globalThis.FileReader;
  try {
    globalThis.FileReader = class { readAsArrayBuffer() { this.result = new Uint8Array([104, 105]).buffer; this.onload(); } };
    assert.deepEqual(Array.from(await IO.readBytes({})), [104, 105]);
    assert.equal(await IO.readText({}), 'hi');
    globalThis.FileReader = class { readAsArrayBuffer() { this.onerror(); } };
    await assert.rejects(IO.readBytes({}), /No se pudo leer el archivo/);
  } finally { if (FR) globalThis.FileReader = FR; else delete globalThis.FileReader; }
});

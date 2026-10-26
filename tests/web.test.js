'use strict';
/* Avisos de la versión web y almacenamiento persistente. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Web = require('../www/js/web.js');

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 26, 12);
const web = (o) => Object.assign({ native: false, secure: true, geolocation: true }, o);

test('isWeb: dentro del APK no es web; en un navegador sí', () => {
  assert.equal(Web.isWeb({ native: true }), false);
  assert.equal(Web.isWeb({ native: false }), true);
  assert.equal(Web.isWeb({}), true);
  assert.equal(Web.isWeb(), true);
});

test('notes: en el APK no hay avisos', () => {
  assert.deepEqual(Web.notes({ native: true, secure: false, geolocation: false }), []);
});

test('notes: en la web siempre avisa que los datos viven en este navegador', () => {
  const n = Web.notes(web());
  assert.equal(n.length, 1);
  assert.equal(n[0].level, 'info');
  assert.match(n[0].text, /solo en este navegador/);
  assert.match(n[0].text, /copias de seguridad/);
  assert.ok(n[0].text.length < 260, 'corto: en el teléfono no debe tapar la pantalla');
});

test('notes: sin HTTPS y sin GPS agrega avisos de problema', () => {
  const sinHttps = Web.notes(web({ secure: false }));
  assert.deepEqual(sinHttps.map((x) => x.level), ['info', 'warn']);
  assert.match(sinHttps[1].text, /https:\/\//);
  const sinGps = Web.notes(web({ geolocation: false }));
  assert.deepEqual(sinGps.map((x) => x.level), ['info', 'warn']);
  assert.match(sinGps[1].title, /no ofrece GPS/);
  assert.equal(Web.notes(web({ secure: false, geolocation: false })).length, 3);
});

test('notes: si el entorno no dice nada de HTTPS o GPS no se inventan problemas', () => {
  assert.equal(Web.notes({ native: false }).length, 1);
});

test('banner: en el APK no muestra nada', () => {
  assert.equal(Web.banner({ native: true }, null, NOW), null);
});

test('banner: la primera vez muestra el aviso y se puede cerrar', () => {
  const b = Web.banner(web(), null, NOW);
  assert.equal(b.notes.length, 1);
  assert.equal(b.canDismiss, true);
});

test('banner: cerrado hace menos de 7 días no vuelve; a los 7 días sí', () => {
  assert.equal(Web.banner(web(), NOW - 1000, NOW), null);
  assert.equal(Web.banner(web(), NOW - 6 * DAY, NOW), null);
  assert.equal(Web.banner(web(), NOW - 7 * DAY, NOW).canDismiss, true, 'justo a los 7 días vuelve');
  assert.equal(Web.banner(web(), NOW - 30 * DAY, NOW).canDismiss, true);
  assert.equal(Web.REMIND_MS, 7 * DAY);
});

test('banner: una marca inválida o del futuro (reloj cambiado) se ignora', () => {
  for (const bad of ['ayer', NaN, Infinity, undefined, {}, NOW + DAY]) {
    assert.equal(Web.banner(web(), bad, NOW).canDismiss, true, String(bad));
  }
});

test('banner: los problemas (sin HTTPS, sin GPS) se siguen mostrando aunque se haya cerrado el aviso', () => {
  const b = Web.banner(web({ secure: false }), NOW - 1000, NOW);
  assert.deepEqual(b.notes.map((x) => x.level), ['warn']);
  assert.equal(b.canDismiss, false);
  const c = Web.banner(web({ secure: false, geolocation: false }), NOW - 1000, NOW);
  assert.equal(c.notes.length, 2);
});

test('storageNote: dice dónde viven los datos y, si el navegador lo informa, si están protegidos', () => {
  const base = Web.storageNote(null);
  assert.match(base, /viven en este navegador/);
  assert.doesNotMatch(base, /protegido|limpiar/);
  assert.match(Web.storageNote(true), /protegido contra la limpieza automática/);
  assert.match(Web.storageNote(false), /podría limpiar estos datos/);
  assert.equal(Web.storageNote(undefined), base);
});

test('requestPersist: en el APK, sin almacenamiento o sin la función, no hace nada', async () => {
  const st = { persist: () => { throw new Error('no debía llamarse'); } };
  assert.equal(await Web.requestPersist({ native: true, storage: st }), null);
  assert.equal(await Web.requestPersist({ native: false }), null);
  assert.equal(await Web.requestPersist({ native: false, storage: {} }), null);
  assert.equal(await Web.requestPersist(), null);
});

test('requestPersist: si ya estaba protegido no vuelve a pedirlo', async () => {
  let asked = 0;
  const st = { persisted: async () => true, persist: async () => { asked++; return true; } };
  assert.equal(await Web.requestPersist(web({ storage: st })), true);
  assert.equal(asked, 0);
});

test('requestPersist: lo pide y devuelve lo que contesta el navegador', async () => {
  assert.equal(await Web.requestPersist(web({ storage: { persisted: async () => false, persist: async () => true } })), true);
  assert.equal(await Web.requestPersist(web({ storage: { persisted: async () => false, persist: async () => false } })), false);
  assert.equal(await Web.requestPersist(web({ storage: { persist: () => true } })), true, 'sin persisted() también lo pide');
});

test('requestPersist: si el navegador falla, devuelve null y no rompe la app', async () => {
  assert.equal(await Web.requestPersist(web({ storage: { persisted: async () => false, persist: async () => { throw new Error('no'); } } })), null);
  assert.equal(await Web.requestPersist(web({ storage: { persisted: async () => { throw new Error('no'); }, persist: async () => true } })), null);
  assert.equal(await Web.requestPersist(web({ storage: { persisted: () => { throw new Error('síncrono'); }, persist: async () => true } })), null);
});

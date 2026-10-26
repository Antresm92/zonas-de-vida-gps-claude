'use strict';
/* scripts/preparar-web.js — la carpeta que se publica en GitHub Pages. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const P = require('../scripts/preparar-web.js');

const WWW = path.join(__dirname, '..', 'www');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
const quiet = (fn) => { const l = console.log, e = console.error; console.log = console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };

test('stampSw: cambia solo el nombre de la memoria offline', () => {
  const src = "const CACHE = 'zonas-de-vida-v3';\nconst FILES = ['a'];\n";
  const out = P.stampSw(src, 'abc1234');
  assert.equal(out, "const CACHE = 'zonas-de-vida-web-abc1234';\nconst FILES = ['a'];\n");
});

test('stampSw: rechaza etiquetas peligrosas o vacías', () => {
  for (const bad of ['', "a'b", 'a b', '../x', 'x'.repeat(41), null, undefined, 'á']) {
    assert.throws(() => P.stampSw("const CACHE = 'x';", bad), /Etiqueta no válida/, String(bad));
  }
  assert.doesNotThrow(() => P.stampSw("const CACHE = 'x';", 'v1.2_3-b'));
});

test('stampSw: si sw.js no tiene la línea del caché, falla con un mensaje claro', () => {
  assert.throws(() => P.stampSw('nada', 'abc'), /No se encontró/);
});

test('el sw.js real de la app se puede estampar', () => {
  const real = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
  const out = P.stampSw(real, 'deadbee');
  assert.match(out, /const CACHE = 'zonas-de-vida-web-deadbee';/);
  assert.equal(out.split('\n').length, real.split('\n').length);
});

test('prepare: copia toda la app, estampa el caché y no toca www', () => {
  const out = path.join(tmp(), 'sitio');
  const before = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
  const files = P.prepare(WWW, out, 'abc1234');
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/web.js', 'icons/icon-192.png', '.nojekyll']) assert.ok(files.includes(f), 'falta ' + f);
  assert.match(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'), /zonas-de-vida-web-abc1234/);
  assert.equal(fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8'), before, 'www no cambia');
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), fs.readFileSync(path.join(WWW, 'index.html'), 'utf8'));
  assert.ok(!files.some((f) => /^(tests|android|node_modules|scripts)\//.test(f)), 'solo se publica www');
});

test('prepare: vuelve a vaciar la carpeta de salida (no quedan archivos viejos)', () => {
  const out = path.join(tmp(), 'sitio');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'viejo.txt'), 'x');
  const files = P.prepare(WWW, out, 'abc');
  assert.ok(!files.includes('viejo.txt'));
  assert.ok(!fs.existsSync(path.join(out, 'viejo.txt')));
});

test('prepare: una etiqueta mala falla ANTES de borrar la salida', () => {
  const out = path.join(tmp(), 'sitio');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'viejo.txt'), 'x');
  assert.throws(() => P.prepare(WWW, out, 'mala etiqueta'), /Etiqueta/);
  assert.ok(fs.existsSync(path.join(out, 'viejo.txt')));
});

test('prepare: exige un index.html y no deja que la salida esté dentro de la app', () => {
  const vacia = tmp();
  assert.throws(() => P.prepare(vacia, path.join(tmp(), 's'), 'abc'), /No hay index\.html/);
  assert.throws(() => P.prepare(WWW, path.join(WWW, 'salida'), 'abc'), /no puede estar dentro/);
  assert.throws(() => P.prepare(WWW, WWW, 'abc'), /no puede estar dentro/);
  assert.throws(() => P.prepare(WWW, path.join(WWW, '..'), 'abc'), /no puede estar dentro|contener/);
  assert.ok(!fs.existsSync(path.join(WWW, 'salida')));
});

test('prepare: ignora lo que no es archivo ni carpeta (enlaces rotos)', () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(src, 'sw.js'), "const CACHE = 'x';");
  try { fs.symlinkSync('/no/existe', path.join(src, 'roto')); } catch (e) { return; }
  const files = P.prepare(src, path.join(tmp(), 's'), 'abc');
  assert.deepEqual(files, ['.nojekyll', 'index.html', 'sw.js']);
});

test('main: sin argumentos explica el uso; con argumentos prepara el sitio', () => {
  assert.equal(quiet(() => P.main([])), 2);
  assert.equal(quiet(() => P.main(['--salida', path.join(tmp(), 's')])), 2);
  assert.equal(quiet(() => P.main(['--etiqueta'])), 2);
  const out = path.join(tmp(), 's');
  assert.equal(quiet(() => P.main(['--salida', out, '--etiqueta', 'abc1234'])), 0);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.equal(quiet(() => P.main(['--salida', path.join(tmp(), 's2'), '--etiqueta', 'mala etiqueta'])), 1);
});

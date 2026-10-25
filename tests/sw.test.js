'use strict';
/* El service worker debe guardar TODO lo que la app necesita para abrir sin internet. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const WWW = path.join(__dirname, '..', 'www');
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
const files = (/const FILES = \[([\s\S]*?)\];/.exec(sw)[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));

test('sw.js: guarda cada script y hoja de estilos que usa index.html', () => {
  const used = [];
  html.replace(/<script[^>]+src="([^"]+)"/g, (m, s) => used.push(s));
  html.replace(/<link[^>]+href="([^"]+)"/g, (m, s) => used.push(s));
  assert.ok(used.length >= 18, 'se esperaban los scripts y estilos de la app');
  used.forEach((u) => assert.ok(files.includes(u), 'falta en sw.js: ' + u));
});

test('sw.js: todos los archivos que lista existen', () => {
  files.filter((f) => f !== './').forEach((f) => assert.ok(fs.existsSync(path.join(WWW, f)), 'no existe: ' + f));
});

test('sw.js: cada script de www/js está en index.html y en la memoria offline', () => {
  fs.readdirSync(path.join(WWW, 'js')).filter((f) => f.endsWith('.js')).forEach((f) => {
    assert.ok(html.includes('src="js/' + f + '"'), 'index.html no carga js/' + f);
    assert.ok(files.includes('js/' + f), 'sw.js no guarda js/' + f);
  });
});

test('sw.js: la versión de la memoria offline cambia con cada versión de la app', () => {
  const v = /const CACHE = 'zonas-de-vida-v(\d+)'/.exec(sw);
  assert.ok(v && +v[1] >= 2, 'sube el número de CACHE cuando cambian los archivos');
});

test('sw.js: solo guarda archivos propios; las consultas a internet pasan directo', () => {
  assert.match(sw, /url\.origin !== location\.origin\) return/);
  assert.match(sw, /e\.request\.method !== 'GET'\) return/);
});

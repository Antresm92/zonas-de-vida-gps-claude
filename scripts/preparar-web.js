#!/usr/bin/env node
'use strict';
/* preparar-web.js — deja lista la carpeta que se publica como página web (GitHub Pages).
 *
 *   node scripts/preparar-web.js --salida _sitio --etiqueta abc1234
 *
 * Copia `www/` a la carpeta de salida y cambia el nombre de la memoria offline (service worker)
 * por uno único para cada publicación. Sin eso, quien ya abrió la página seguiría viendo la versión
 * vieja porque el service worker guarda los archivos. No modifica `www/` ni el APK. */
const fs = require('fs');
const path = require('path');

const CACHE_RE = /const CACHE = '[^']*';/;
const TAG_RE = /^[A-Za-z0-9._-]{1,40}$/;

// Devuelve el texto de sw.js con el nombre de la memoria offline cambiado por uno propio de esta publicación.
function stampSw(source, tag) {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) throw new Error('Etiqueta no válida: usa solo letras, números, punto, guion y guion bajo (hasta 40).');
  if (!CACHE_RE.test(source)) throw new Error("No se encontró la línea « const CACHE = '…'; » en sw.js.");
  return source.replace(CACHE_RE, "const CACHE = 'zonas-de-vida-web-" + tag + "';");
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (e) {
    var a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
  });
}

// from: carpeta de la app (www). to: carpeta de salida (se vacía antes). Devuelve la lista de archivos copiados.
function prepare(from, to, tag) {
  var src = path.resolve(from), dst = path.resolve(to);
  if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('No hay index.html en ' + src);
  if (dst === src || dst.startsWith(src + path.sep) || src.startsWith(dst + path.sep)) throw new Error('La carpeta de salida no puede estar dentro de la app ni contenerla.');
  var stamped = stampSw(fs.readFileSync(path.join(src, 'sw.js'), 'utf8'), tag);   // falla antes de borrar nada
  fs.rmSync(dst, { recursive: true, force: true });
  copyDir(src, dst);
  fs.writeFileSync(path.join(dst, 'sw.js'), stamped);
  fs.writeFileSync(path.join(dst, '.nojekyll'), '');
  return (function walk(d, base) {
    return fs.readdirSync(d, { withFileTypes: true }).reduce(function (acc, e) {
      return acc.concat(e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).split(path.sep).join('/')]);
    }, []);
  })(dst, dst).sort();
}

function arg(argv, name) {
  var i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  var out = arg(argv, 'salida'), tag = arg(argv, 'etiqueta');
  if (!out || !tag) { console.error('Uso: node scripts/preparar-web.js --salida <carpeta> --etiqueta <texto>'); return 2; }
  try {
    var files = prepare(path.join(__dirname, '..', 'www'), out, tag);
    console.log('Sitio listo en ' + out + ' (' + files.length + ' archivos, memoria offline «zonas-de-vida-web-' + tag + '»).');
    return 0;
  } catch (e) {
    console.error('Error: ' + e.message);
    return 1;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { stampSw: stampSw, prepare: prepare, main: main, CACHE_RE: CACHE_RE, TAG_RE: TAG_RE };

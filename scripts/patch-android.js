#!/usr/bin/env node
/* Prepara el proyecto Android que crea "cap add android":
 *   1. permisos de ubicación (GPS) en el manifiesto y la consulta de la cámara (fotos),
 *   2. versión (versionCode y versionName desde package.json) y firma de publicación del build.gradle,
 *   3. ícono de la app (todas las densidades + ícono adaptativo),
 *   4. el nombre corto bajo el ícono (2.34.4).
 * Se puede ejecutar varias veces: no duplica nada. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

function fail(msg) { console.error('patch-android: ' + msg); process.exit(1); }

if (!fs.existsSync(manifestPath)) fail('no existe ' + manifestPath + '. Ejecuta antes: npx cap add android');

/* ---------- 1. Permisos ---------- */
let xml = fs.readFileSync(manifestPath, 'utf8');
const wanted = [
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />'
];
const missing = wanted.filter((line) => !xml.includes(line.match(/android:name="([^"]+)"/)[1]));
if (missing.length) {
  if (!/<application[\s>]/.test(xml)) fail('el manifiesto no tiene <application>');
  xml = xml.replace(/^[ \t]*<application([\s>])/m, (m, c) => '    ' + missing.join('\n    ') + '\n\n    <application' + c);
  fs.writeFileSync(manifestPath, xml);
  console.log('patch-android: permisos agregados (' + missing.length + ')');
} else {
  console.log('patch-android: los permisos ya estaban');
}

/* ---------- 1b. Cámara (fotos de los puntos) ----------
 * «Tomar foto» abre la cámara del sistema desde un selector de archivos (<input capture>). Desde Android 11 la app solo puede
 * ver qué aplicaciones hacen de cámara si el manifiesto lo declara en <queries>. No se pide el permiso CAMERA a propósito:
 * la foto la toma la app de cámara del teléfono, no esta app. */
xml = fs.readFileSync(manifestPath, 'utf8');
if (!/android\.media\.action\.IMAGE_CAPTURE/.test(xml)) {
  const queries = '    <queries>\n        <intent>\n            <action android:name="android.media.action.IMAGE_CAPTURE" />\n        </intent>\n    </queries>\n\n';
  if (!/<application[\s>]/.test(xml)) fail('el manifiesto no tiene <application>');
  xml = /<queries[\s>]/.test(xml)
    ? xml.replace(/<queries([\s>])/, (m, c) => '<queries' + c).replace(/(<queries[^>]*>)/, '$1\n        <intent>\n            <action android:name="android.media.action.IMAGE_CAPTURE" />\n        </intent>')
    : xml.replace(/^[ \t]*<application([\s>])/m, (m, c) => queries + '    <application' + c);
  fs.writeFileSync(manifestPath, xml);
  console.log('patch-android: consulta de la cámara agregada');
} else {
  console.log('patch-android: la consulta de la cámara ya estaba');
}

/* ---------- 1c. Versión y firma de publicación (build.gradle) ----------
 * versionCode y versionName salen de la versión de package.json (la plantilla los deja en 1 y "1.0").
 * La firma del .aab se lee de variables de entorno; sin ellas no cambia nada. Ver scripts/version-android.js. */
const V = require('./version-android.js');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (!fs.existsSync(gradlePath)) fail('no existe ' + gradlePath);
let gradle = fs.readFileSync(gradlePath, 'utf8');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
try {
  const v = V.patchVersion(gradle, pkgVersion);
  const s = V.patchSigning(v.text);
  fs.writeFileSync(gradlePath, s.text);
  console.log('patch-android: versión ' + v.name + ' → versionCode ' + v.code + (s.changed ? '; firma de publicación preparada' : '; la firma de publicación ya estaba'));
} catch (err) { fail(err.message); }

/* ---------- 1d. Nombre bajo el ícono (2.34.4) ----------
 * El nombre de la app es «Don Florentino SIG» y así sale en Ajustes, en los permisos y dentro de la app (app_name). En la
 * pantalla de inicio se cortaba con «…», así que la actividad que abre el ícono (title_activity_main) lleva el nombre corto:
 * el short_name del manifiesto web (www/manifest.webmanifest), para que el nombre corto se escriba en un solo lugar. */
const stringsPath = path.join(res, 'values', 'strings.xml');
let shortName = '';
try { shortName = JSON.parse(fs.readFileSync(path.join(root, 'www', 'manifest.webmanifest'), 'utf8')).short_name; } catch (e) { /* abajo se avisa */ }
if (typeof shortName !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} .-]{0,29}$/u.test(shortName)) fail('www/manifest.webmanifest no tiene un short_name válido (letras, números, espacios, punto o guion; hasta 30)');
if (!fs.existsSync(stringsPath)) fail('no existe ' + stringsPath);
if (!/<activity[^>]*android:label="@string\/title_activity_main"/.test(fs.readFileSync(manifestPath, 'utf8'))) fail('la actividad principal no usa @string/title_activity_main: no se puede poner el nombre corto bajo el ícono');
const strings = fs.readFileSync(stringsPath, 'utf8'), LABEL = /(<string name="title_activity_main">)[^<]*(<\/string>)/;
if (!LABEL.test(strings)) fail('strings.xml no tiene title_activity_main');
const withShort = strings.replace(LABEL, (m, open, close) => open + shortName + close);
if (withShort !== strings) { fs.writeFileSync(stringsPath, withShort); console.log('patch-android: bajo el ícono dice «' + shortName + '»'); }
else console.log('patch-android: el nombre bajo el ícono ya estaba');

/* ---------- 2. Ícono ---------- */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
const iconSrc = path.join(root, 'android-res');
if (fs.existsSync(iconSrc) && fs.existsSync(res)) {
  copyDir(iconSrc, res);
  fs.mkdirSync(path.join(res, 'values'), { recursive: true });
  fs.writeFileSync(path.join(res, 'values', 'zv_colors.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="zv_icon_bg">#14301F</color>\n</resources>\n');
  const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '    <background android:drawable="@color/zv_icon_bg"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
  fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
  console.log('patch-android: ícono instalado');
} else {
  console.log('patch-android: se omite el ícono (no hay android-res o res)');
}

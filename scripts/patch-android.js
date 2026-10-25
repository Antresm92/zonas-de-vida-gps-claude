#!/usr/bin/env node
/* Prepara el proyecto Android que crea "cap add android":
 *   1. permisos de ubicación (GPS) en el manifiesto,
 *   2. ícono de la app (todas las densidades + ícono adaptativo).
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

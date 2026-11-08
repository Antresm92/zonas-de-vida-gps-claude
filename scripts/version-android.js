'use strict';
/* Funciones puras (solo texto) que usa scripts/patch-android.js para dejar listo el android/app/build.gradle que crea "cap add android":
 *   - versionCode y versionName salen de la versión de package.json (la plantilla de Capacitor siempre los deja en 1 y "1.0"):
 *     Google Play exige que versionCode suba en cada publicación, y quien instala el APK ve la versión real en Ajustes de Android.
 *   - la firma de publicación (.aab): lee la llave de variables de entorno, así la llave nunca está en el repositorio.
 *     Si las variables no existen (cualquier compilación normal) no se firma nada y todo sigue como antes. */

const MAX_VERSION_CODE = 2100000000;               // tope que admite Android

// 2.8.0 → 20800 · 2.7.2 → 20702 · 10.20.30 → 102030. Sube siempre que sube la versión, mientras la versión menor y el parche sean de 0 a 99.
function versionCodeOf(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version === null || version === undefined ? '' : version).trim());
  if (!m) throw new Error('versión no válida (se espera mayor.menor.parche): «' + version + '»');
  const major = +m[1], minor = +m[2], patch = +m[3];
  if (minor > 99 || patch > 99) throw new Error('la versión menor y el parche deben ir de 0 a 99 para que versionCode no se repita: «' + version + '»');
  const code = major * 10000 + minor * 100 + patch;
  if (code < 1 || code > MAX_VERSION_CODE) throw new Error('versionCode fuera de rango (1 a ' + MAX_VERSION_CODE + '): ' + code);
  return code;
}

// Cambia versionCode y versionName del build.gradle. Falla si no los encuentra: es preferible que la compilación se detenga a que salga con la versión 1.
function patchVersion(gradle, version) {
  const code = versionCodeOf(version);
  const name = String(version).trim();
  let hayCode = false, hayName = false;
  const text = String(gradle)
    .replace(/(\bversionCode\s*=?\s*)\d+/, (m, p) => { hayCode = true; return p + code; })
    .replace(/(\bversionName\s*=?\s*)(["'])[^"'\n]*\2/, (m, p, q) => { hayName = true; return p + q + name + q; });
  if (!hayCode) throw new Error('no se encontró versionCode en build.gradle');
  if (!hayName) throw new Error('no se encontró versionName en build.gradle');
  return { text, code, name };
}

const SIGNING_BLOCK = [
  '    // Firma de publicación (.aab para Google Play): la llave llega por variables de entorno; sin ellas no se firma nada.',
  '    signingConfigs {',
  '        release {',
  "            def ksPath = System.getenv('ANDROID_KEYSTORE_PATH')",
  '            if (ksPath) {',
  '                storeFile file(ksPath)',
  "                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')",
  "                keyAlias System.getenv('ANDROID_KEY_ALIAS')",
  "                keyPassword System.getenv('ANDROID_KEY_PASSWORD')",
  '            }',
  '        }',
  '    }',
  ''
].join('\n');

// Agrega el bloque signingConfigs antes de buildTypes y usa esa firma en «release» solo si hay llave. No duplica nada si ya estaba.
function patchSigning(gradle) {
  let text = String(gradle);
  if (text.includes('ANDROID_KEYSTORE_PATH')) return { text, changed: false };
  const at = text.search(/^[ \t]*buildTypes\s*\{/m);
  if (at < 0) throw new Error('no se encontró buildTypes en build.gradle');
  let head = text.slice(0, at), tail = text.slice(at);
  // «release» se busca solo dentro de buildTypes (el bloque signingConfigs que se agrega también tiene un «release»)
  if (!/^[ \t]*release\s*\{/m.test(tail)) throw new Error('no se encontró el tipo release en build.gradle');
  tail = tail.replace(/^([ \t]*)release\s*\{[ \t]*\r?\n/m, (m, sp) => m + sp + "    if (System.getenv('ANDROID_KEYSTORE_PATH')) { signingConfig signingConfigs.release }\n");
  return { text: head + SIGNING_BLOCK + tail, changed: true };
}

module.exports = { versionCodeOf, patchVersion, patchSigning, MAX_VERSION_CODE };

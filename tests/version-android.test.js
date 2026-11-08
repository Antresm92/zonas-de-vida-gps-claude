/* scripts/version-android.js y scripts/patch-android.js (v2.8.0): la versión de Android sale de package.json y la firma de publicación
 * se lee de variables de entorno. Se prueba con el texto de la plantilla de Capacitor 8 y con un proyecto de mentira en una carpeta temporal. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const V = require('../scripts/version-android.js');

// Fragmento de android/app/build.gradle tal como lo crea «cap add android» con Capacitor 8
const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "co.zonasdevida.app"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "co.zonasdevida.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
`;

/* ---------- versionCode ---------- */

test('versionCodeOf: mayor×10000 + menor×100 + parche', () => {
  const casos = { '2.8.0': 20800, '2.7.2': 20702, '2.7.1': 20701, '1.0.0': 10000, '0.0.1': 1, '10.20.30': 102030, '2.99.99': 29999, '2.8.0-beta.1': 20800, '2.8.0+build5': 20800, ' 2.8.0 ': 20800 };
  for (const [v, code] of Object.entries(casos)) assert.equal(V.versionCodeOf(v), code, v);
});

test('versionCodeOf: sube siempre que sube la versión', () => {
  const orden = ['0.0.1', '0.1.0', '1.0.0', '2.7.1', '2.7.2', '2.8.0', '2.8.1', '2.9.0', '2.99.99', '3.0.0'];
  const codes = orden.map(V.versionCodeOf);
  codes.slice(1).forEach((c, i) => assert.ok(c > codes[i], orden[i] + ' → ' + orden[i + 1]));
});

test('versionCodeOf: rechaza lo que no es mayor.menor.parche y lo que haría repetir el número', () => {
  for (const malo of ['', 'x', '2.8', '2.8.x', 'v2.8.0', '2..0', '-1.0.0', null, undefined, '2.100.0', '2.0.100', '0.0.0'])
    assert.throws(() => V.versionCodeOf(malo), /versión|versionCode/, String(malo));
  assert.throws(() => V.versionCodeOf('999999.0.0'), /fuera de rango/);
  assert.equal(V.versionCodeOf('210000.0.0'), 2100000000);
});

/* ---------- build.gradle: versión ---------- */

test('patchVersion: reemplaza versionCode y versionName y deja el resto igual', () => {
  const r = V.patchVersion(GRADLE, '2.8.0');
  assert.equal(r.code, 20800);
  assert.equal(r.name, '2.8.0');
  assert.ok(r.text.includes('versionCode 20800\n'));
  assert.ok(r.text.includes('versionName "2.8.0"\n'));
  assert.equal(r.text, GRADLE.replace('versionCode 1', 'versionCode 20800').replace('versionName "1.0"', 'versionName "2.8.0"'));
});

test('patchVersion: entiende la forma con «=» y las comillas simples, y es idempotente', () => {
  const alt = GRADLE.replace('versionCode 1', 'versionCode = 1').replace('versionName "1.0"', "versionName = '1.0'");
  const r = V.patchVersion(alt, '2.8.1');
  assert.ok(r.text.includes('versionCode = 20801'));
  assert.ok(r.text.includes("versionName = '2.8.1'"));
  assert.equal(V.patchVersion(r.text, '2.8.1').text, r.text, 'aplicarlo dos veces no cambia nada');
  assert.equal(V.patchVersion(V.patchVersion(GRADLE, '2.8.0').text, '2.9.0').code, 20900, 'sobre un archivo ya parchado, vale la versión nueva');
  assert.equal(V.patchVersion(GRADLE, ' 2.8.0 ').name, '2.8.0', 'el nombre va sin espacios');
  assert.equal(V.patchVersion(GRADLE, '2.8.0-beta.1').name, '2.8.0-beta.1', 'el nombre conserva la etiqueta, el código no');
  assert.equal(V.patchVersion(GRADLE, '2.8.0-beta.1').code, 20800);
});

test('patchVersion: si falta versionCode o versionName, falla (la compilación no debe salir con la versión 1)', () => {
  assert.throws(() => V.patchVersion(GRADLE.replace('versionCode 1\n', ''), '2.8.0'), /versionCode/);
  assert.throws(() => V.patchVersion(GRADLE.replace('versionName "1.0"\n', ''), '2.8.0'), /versionName/);
  assert.throws(() => V.patchVersion('', '2.8.0'), /versionCode/);
  assert.throws(() => V.patchVersion(GRADLE, 'x'), /versión no válida/);
});

/* ---------- build.gradle: firma de publicación ---------- */

test('patchSigning: agrega signingConfigs antes de buildTypes y firma «release» solo si hay llave', () => {
  const r = V.patchSigning(GRADLE);
  assert.equal(r.changed, true);
  for (const v of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.ok(r.text.includes(v), v);
  assert.ok(r.text.indexOf('signingConfigs {') < r.text.indexOf('buildTypes {'), 'signingConfigs va antes de buildTypes');
  for (const linea of ['storeFile file(ksPath)', "storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')", "keyAlias System.getenv('ANDROID_KEY_ALIAS')", "keyPassword System.getenv('ANDROID_KEY_PASSWORD')"])
    assert.ok(r.text.includes(linea), 'la firma configura: ' + linea);
  assert.match(r.text, /release \{\n\s+if \(System\.getenv\('ANDROID_KEYSTORE_PATH'\)\) \{ signingConfig signingConfigs\.release \}\n\s+minifyEnabled false/);
  assert.ok(r.text.includes("applicationId \"co.zonasdevida.app\""), 'lo demás sigue igual');
  assert.equal((r.text.match(/buildTypes \{/g) || []).length, 1);
  assert.equal((r.text.match(/signingConfigs \{/g) || []).length, 1);
});

test('patchSigning: no duplica nada si ya estaba, y falla si el archivo no tiene buildTypes o release', () => {
  const una = V.patchSigning(GRADLE);
  const dos = V.patchSigning(una.text);
  assert.equal(dos.changed, false);
  assert.equal(dos.text, una.text);
  assert.throws(() => V.patchSigning(GRADLE.replace('buildTypes {', 'tipos {')), /buildTypes/);
  assert.throws(() => V.patchSigning(GRADLE.replace('release {', 'otro {')), /release/);
});

/* ---------- patch-android.js completo, en un proyecto de mentira ---------- */

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher">
    </application>

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

function proyecto(gradle, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zv-patch-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['patch-android.js', 'version-android.js']) fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(dir, 'scripts', f));
  fs.mkdirSync(path.join(dir, 'android', 'app', 'src', 'main'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  fs.writeFileSync(path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), MANIFEST);
  if (gradle !== null) fs.writeFileSync(path.join(dir, 'android', 'app', 'build.gradle'), gradle);
  return dir;
}
const correr = (dir) => cp.spawnSync(process.execPath, [path.join(dir, 'scripts', 'patch-android.js')], { encoding: 'utf8' });

test('patch-android.js: pone la versión de package.json y deja la firma lista, y se puede correr dos veces', () => {
  const dir = proyecto(GRADLE, '2.8.0');
  try {
    const r1 = correr(dir);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /versión 2\.8\.0 → versionCode 20800; firma de publicación preparada/);
    const g1 = fs.readFileSync(path.join(dir, 'android', 'app', 'build.gradle'), 'utf8');
    assert.ok(g1.includes('versionCode 20800') && g1.includes('versionName "2.8.0"') && g1.includes('ANDROID_KEYSTORE_PATH'));
    const r2 = correr(dir);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /la firma de publicación ya estaba/);
    assert.equal(fs.readFileSync(path.join(dir, 'android', 'app', 'build.gradle'), 'utf8'), g1, 'segunda vuelta sin cambios');
    assert.match(fs.readFileSync(path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8'), /ACCESS_FINE_LOCATION/, 'los permisos de GPS siguen agregándose');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('patch-android.js: si el build.gradle no existe o no tiene versión, termina con error y lo dice', () => {
  let dir = proyecto(null, '2.8.0');
  try {
    const r = correr(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /patch-android: no existe .*build\.gradle/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  dir = proyecto(GRADLE.replace('versionCode 1\n', ''), '2.8.0');
  try {
    const r = correr(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /patch-android: no se encontró versionCode/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  dir = proyecto(GRADLE, 'ocho');
  try {
    const r = correr(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /versión no válida/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

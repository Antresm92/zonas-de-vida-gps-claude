/* Guardias sobre el flujo de GitHub (.github/workflows/android.yml) y la configuración del paquete (v2.7.2 y v2.8.0).
 * No ejecutan el flujo: leen su texto para que nadie quite sin querer algo que la auditoría pidió o que Google Play exige. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const V = require('../scripts/version-android.js');

const pasos = wf.split(/\n(?=      - )/);                       // cada paso del flujo, en orden
const paso = (re) => pasos.find((p) => re.test(p));
const lineas = (txt) => txt.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // sin comentarios

test('flujo: las dependencias se instalan con npm ci (versiones exactas del archivo de bloqueo), no con npm install', () => {
  assert.match(lineas(wf), /run: npm ci\b/);
  assert.doesNotMatch(lineas(wf), /npm install/);
});

test('flujo: las pruebas corren antes de crear el proyecto Android y el parche (versión, firma, permisos) antes de compilar', () => {
  const i = (re) => wf.search(re);
  assert.ok(i(/run: npm test/) < i(/run: npm ci/), 'pruebas antes de instalar');
  assert.ok(i(/run: npm ci/) < i(/npx cap add android/));
  assert.ok(i(/npx cap add android/) < i(/node scripts\/patch-android\.js/));
  assert.ok(i(/node scripts\/patch-android\.js/) < i(/npx cap sync android/));
  assert.ok(i(/npx cap sync android/) < i(/gradlew assembleDebug/));
  assert.ok(i(/node scripts\/patch-android\.js/) < i(/gradlew bundleRelease/));
});

test('flujo: el APK de prueba sigue firmado con la clave fija, para que se instale encima del anterior', () => {
  assert.match(wf, /cp scripts\/debug\.keystore ~\/\.android\/debug\.keystore/);
  assert.match(wf, /gradlew assembleDebug/);
  assert.match(wf, /name: zonas-de-vida-apk/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'debug.keystore')));
});

test('flujo: el .aab solo se compila si hay llave, y lee la llave de los secretos con los mismos nombres que usa build.gradle', () => {
  const llave = paso(/id: llave/);
  assert.ok(llave && /secrets\.ANDROID_KEYSTORE_BASE64/.test(llave) && /hay=true/.test(llave) && /hay=false/.test(llave));
  const aab = paso(/gradlew bundleRelease/);
  assert.match(aab, /if: steps\.llave\.outputs\.hay == 'true'/);
  for (const s of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.match(aab, new RegExp('secrets\\.' + s), s);
  const gradle = V.patchSigning('android {\n    buildTypes {\n        release {\n        }\n    }\n}\n').text;
  for (const v of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    assert.ok(gradle.includes(v), 'build.gradle lee ' + v);
    assert.ok(aab.includes(v), 'el paso del .aab entrega ' + v);
  }
  assert.match(aab, /rm -f "\$RUNNER_TEMP\/upload\.jks"/, 'la llave descifrada se borra al terminar');
  assert.match(paso(/Guardar el paquete de publicación/), /if: steps\.llave\.outputs\.hay == 'true'/);
});

test('flujo: ningún paso imprime los secretos en el registro', () => {
  assert.doesNotMatch(lineas(wf), /echo[^\n]*\$\{\{\s*secrets\./);
  // el único «echo» de una variable secreta es el que la pasa a base64 para recrear el archivo de la llave
  const secretos = lineas(wf).split('\n').filter((l) => /echo/.test(l) && /\$\{?(KS|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD|ANDROID_KEY_ALIAS)\b/.test(l));
  assert.equal(secretos.length, 1);
  assert.match(secretos[0], /echo "\$KS" \| base64 --decode > /);
});

test('flujo: comprueba que versionCode no se quedó en 1', () => {
  assert.match(paso(/Mostrar versión/), /versionCode 1\$.*exit 1/);
});

test('paquete: Capacitor 8 (Android 16, API 36) en todas las piezas y archivo de bloqueo al día', () => {
  for (const d of ['@capacitor/android', '@capacitor/core', '@capacitor/filesystem', '@capacitor/share']) assert.match(pkg.dependencies[d], /^\^8\./, d);
  assert.match(pkg.devDependencies['@capacitor/cli'], /^\^8\./);
  assert.equal(lock.packages[''].version, pkg.version, 'la versión del archivo de bloqueo coincide con package.json');
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const n of ['core', 'android', 'cli']) assert.match(lock.packages['node_modules/@capacitor/' + n].version, /^8\./, n);
  for (const [k, v] of Object.entries(lock.packages)) if (k) assert.match(v.resolved, /^https:\/\/registry\.npmjs\.org\//, k + ' viene del registro oficial de npm');
  for (const [k, v] of Object.entries(lock.packages)) if (k) assert.match(v.integrity, /^sha512-/, k + ' tiene huella');
});

test('paquete: package.json tiene una versión que se convierte en versionCode', () => {
  assert.ok(V.versionCodeOf(pkg.version) > 20702, 'mayor que el de la 2.7.2, ya publicada como APK');
});

test('.gitignore: las llaves de publicación no se suben, pero la clave de prueba fija sí está en el repositorio', () => {
  assert.match(gitignore, /^\*\.jks$/m);
  assert.match(gitignore, /^\*\.keystore$/m);
  assert.match(gitignore, /^!scripts\/debug\.keystore$/m);
});

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
  assert.match(wf, /name: don-florentino-sig-prueba-apk/);
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

test('la app se identifica ante los servidores de mapas (política de OpenStreetMap, 2.32.0; nombre nuevo en la 2.33.0)', () => {
  // OpenStreetMap bloquea el tráfico con identificación genérica: el WebView añade el nombre de la app y una dirección de contacto
  const cfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'capacitor.config.json'), 'utf8'));
  assert.equal(cfg.appendUserAgent, 'DonFlorentinoSIG (+https://github.com/Antresm92/don-florentino-sig-claude)');
  assert.equal(cfg.overrideUserAgent, undefined, 'no reemplazar la identificación del WebView, solo añadir');
});

test('2.33.0: la app se llama «Don Florentino SIG» y tiene identificador propio', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(cfg.appId, 'co.donflorentino.sig');
  assert.equal(cfg.appName, 'Don Florentino SIG');
  assert.equal(pkg.name, 'don-florentino-sig');
  assert.equal(lock.name, 'don-florentino-sig'); assert.equal(lock.packages[''].name, 'don-florentino-sig');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'www', 'manifest.webmanifest'), 'utf8'));
  assert.equal(man.name, 'Don Florentino SIG'); assert.equal(man.short_name, 'Florentino SIG', '2.34.4: el nombre corto, el que va bajo el ícono');
  assert.match(fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8'), /<title>Don Florentino SIG<\/title>/);
});

test('2.33.0: el APK de prueba y el paquete de Google Play tienen nombres que no se confunden', () => {
  const sin = lineas(wf);
  assert.match(sin, /app-debug\.apk don-florentino-sig-prueba\.apk/);
  assert.match(sin, /name: don-florentino-sig-prueba-apk\n\s+path: don-florentino-sig-prueba\.apk/);
  assert.match(sin, /app-release\.aab \.\.\/don-florentino-sig-google-play\.aab/);
  assert.match(sin, /name: don-florentino-sig-google-play-aab\n\s+path: don-florentino-sig-google-play\.aab/);
  assert.doesNotMatch(sin, /zonas-de-vida/, 'sin el nombre anterior');
  assert.doesNotMatch(sin, /prueba[^\n]*\.aab|google-play[^\n]*\.apk/, 'el .apk es el de prueba y el .aab el de la tienda, nunca al revés');
});

test('2.33.0: el .aab se revisa (no lleva la llave de prueba) DESPUÉS de compilarlo y ANTES de guardarlo', () => {
  const g = paso(/check-aab-key\.js/);
  assert.ok(g, 'existe el paso de la guardia');
  assert.match(g, /if: steps\.llave\.outputs\.hay == 'true'/);
  assert.match(g, /run: node scripts\/check-aab-key\.js don-florentino-sig-google-play\.aab scripts\/debug\.keystore/);
  assert.doesNotMatch(g, /continue-on-error/, 'si falla, el flujo se detiene');
  const i = (re) => pasos.findIndex((p) => re.test(p));
  assert.ok(i(/gradlew bundleRelease/) < i(/check-aab-key\.js/));
  assert.ok(i(/check-aab-key\.js/) < i(/Guardar el paquete de publicación/));
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'check-aab-key.js')));
});

test('2.34.4: la compilación comprueba que bajo el ícono quede el nombre corto y en Ajustes el completo, después de copiar la web', () => {
  const sin = lineas(wf);
  const i = sin.indexOf('name: Comprobar el nombre bajo el ícono'), sync = sin.indexOf('run: npx cap sync android'), apk = sin.indexOf('name: Compilar el APK');
  assert.ok(i > sync && i < apk, 'entre «cap sync» y la compilación');
  assert.ok(sin.includes(`grep -q '<string name="title_activity_main">Florentino SIG</string>' android/app/src/main/res/values/strings.xml`));
  assert.ok(sin.includes(`grep -q '<string name="app_name">Don Florentino SIG</string>' android/app/src/main/res/values/strings.xml`));
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'www', 'manifest.webmanifest'), 'utf8'));
  assert.ok(sin.includes('>' + man.short_name + '</string>'), 'la comprobación usa el mismo nombre corto del manifiesto web');
});

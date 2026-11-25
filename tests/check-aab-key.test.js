'use strict';
/* Guardia de publicación (2.33.0): el .aab de Google Play nunca va firmado con la llave de PRUEBA (scripts/debug.keystore,
   pública). La parte de lógica se prueba siempre; la prueba completa firma paquetes de verdad con jarsigner y se salta si el
   equipo no tiene Java (en GitHub sí lo tiene: el flujo instala Java antes de las pruebas). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const G = require('../scripts/check-aab-key.js');
const Zip = require('../www/js/zip.js');

const H = (c) => Array.from({ length: 32 }, () => c).join(':');    // huella con formato de keytool: «AA:AA:…» (32 bytes)
const SALIDA = 'Signer #1:\n\nCertificate #1:\nOwner: CN=Android Debug, O=Android, C=US\nCertificate fingerprints:\n\t SHA1: 11:22\n\t SHA256: ' + H('AB') + '\nSignature algorithm name: SHA256withRSA\n';

test('guardia del .aab: lee la huella SHA-256 tal como la imprime keytool', () => {
  assert.equal(G.sha256Of(SALIDA), 'ab'.repeat(32));
  assert.equal(G.sha256Of('Certificate fingerprints:\n SHA-256: ' + H('0f')), '0f'.repeat(32));
  assert.equal(G.sha256Of('jar is unsigned.'), '', 'sin firma, sin huella');
  assert.equal(G.sha256Of('SHA256: AB:CD'), '', 'una huella incompleta no cuenta');
  assert.equal(G.norm('AB:cd:Ef'), 'abcdef');
  assert.equal(G.norm(null), '');
});

test('guardia del .aab: solo deja pasar un paquete firmado con una llave distinta a la de prueba', () => {
  const prueba = 'ab'.repeat(32), carga = 'cd'.repeat(32);
  assert.equal(G.decide(carga, prueba).ok, true);
  assert.match(G.decide(carga, prueba).msg, /distinta a la de prueba/);
  const igual = G.decide(H('AB'), prueba);                         // mismo valor escrito de otra forma: también se detecta
  assert.equal(igual.ok, false); assert.match(igual.msg, /llave de PRUEBA/);
  assert.equal(G.decide('', prueba).ok, false); assert.match(G.decide('', prueba).msg, /no está firmado/);
  assert.equal(G.decide(carga, '').ok, false, 'sin la huella de la llave de prueba no se puede comprobar: se detiene');
  assert.equal(G.decide('abcd', prueba).ok, false);
});

const hayJava = ['keytool', 'jarsigner'].every((t) => !cp.spawnSync(t, ['-help'], { encoding: 'utf8' }).error);

test('guardia del .aab con paquetes de verdad: sin firma y con la llave de prueba se detiene; con otra llave pasa', { skip: hayJava ? false : 'no hay Java (keytool/jarsigner) en este equipo' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-'));
  try {
    const bytes = Zip.create([{ name: 'base/manifest/AndroidManifest.xml', bytes: new TextEncoder().encode('<manifest/>') }], Date.UTC(2026, 10, 25));
    const nuevo = (n) => { const f = path.join(dir, n); fs.writeFileSync(f, bytes); return f; };
    const run = (cmd, args) => { const r = cp.spawnSync(cmd, ['-J-Duser.language=en'].concat(args), { encoding: 'utf8' }); assert.equal(r.status, 0, cmd + ': ' + r.stderr); };

    const sinFirma = nuevo('sin-firma.aab');
    const r0 = G.check(sinFirma);
    assert.equal(r0.ok, false); assert.match(r0.msg, /no está firmado/);

    const conPrueba = nuevo('prueba.aab');
    run('jarsigner', ['-keystore', G.DEBUG_KEYSTORE, '-storepass', 'android', conPrueba, 'androiddebugkey']);
    const r1 = G.check(conPrueba);
    assert.equal(r1.ok, false, 'firmado con la llave de prueba: no se publica'); assert.match(r1.msg, /llave de PRUEBA/);

    const ks = path.join(dir, 'carga.jks'), conCarga = nuevo('carga.aab');
    run('keytool', ['-genkeypair', '-keystore', ks, '-storepass', 'clave-de-prueba', '-keypass', 'clave-de-prueba', '-alias', 'carga', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Llave de carga de prueba']);
    run('jarsigner', ['-keystore', ks, '-storepass', 'clave-de-prueba', conCarga, 'carga']);
    const r2 = G.check(conCarga);
    assert.equal(r2.ok, true, r2.msg);

    assert.match(G.check(path.join(dir, 'no-existe.aab')).msg, /No se encontró el archivo/);

    // y como programa: código 1 cuando se detiene (así el paso de GitHub falla y el .aab no se guarda), 0 cuando pasa
    const cli = (f) => cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-aab-key.js'), f], { encoding: 'utf8' });
    assert.equal(cli(conPrueba).status, 1);
    assert.match(cli(conPrueba).stderr, /::error::El \.aab está firmado con la llave de PRUEBA/);
    assert.equal(cli(conCarga).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

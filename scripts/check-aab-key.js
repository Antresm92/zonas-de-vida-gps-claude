#!/usr/bin/env node
/* Guardia de publicación (2.33.0).
 * El paquete para Google Play (.aab) NUNCA puede ir firmado con la llave de PRUEBA (scripts/debug.keystore): esa llave es
 * pública (está en el repositorio, para que cada APK de prueba se instale encima del anterior). Si el .aab de la tienda
 * llevara esa llave, cualquiera podría firmar una «actualización» falsa de la app.
 *
 * Compara la huella SHA-256 del certificado del .aab con la de la llave de prueba y se detiene (código 1) si:
 *   - el .aab no está firmado, o
 *   - está firmado con la llave de prueba, o
 *   - no se pudo leer alguna de las dos huellas.
 *
 * Uso: node scripts/check-aab-key.js <archivo.aab> [llave-de-prueba.keystore]
 * Necesita keytool (viene con Java). No imprime ninguna contraseña: la de la llave de prueba es la pública de Android («android»). */
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEBUG_KEYSTORE = path.join(__dirname, 'debug.keystore');
const DEBUG_PASS = 'android';                       // contraseña estándar (y pública) de las llaves de depuración de Android

// «AB:CD:…» o «abcd…» → «abcd…» (solo hexadecimal, en minúsculas)
function norm(fp) { return String(fp === null || fp === undefined ? '' : fp).replace(/[^0-9a-f]/gi, '').toLowerCase(); }

// keytool imprime las huellas como «SHA256: AB:CD:…» (en todos los idiomas la etiqueta es la misma). Devuelve la primera.
function sha256Of(text) {
  const m = /SHA-?256:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){31})/i.exec(String(text || ''));
  return m ? norm(m[1]) : '';
}

function decide(aabFp, debugFp) {
  const a = norm(aabFp), d = norm(debugFp);
  if (d.length !== 64) return { ok: false, msg: 'No se pudo leer la huella de la llave de prueba: no se puede comprobar el .aab.' };
  if (!a) return { ok: false, msg: 'El .aab no está firmado: Google Play no lo acepta. Revisa los secretos ANDROID_* (README, «Publicar en Google Play»).' };
  if (a.length !== 64) return { ok: false, msg: 'La huella del .aab no tiene el formato esperado.' };
  if (a === d) return { ok: false, msg: 'El .aab está firmado con la llave de PRUEBA, que es pública. No se publica: usa tu llave de carga (secretos ANDROID_*).' };
  return { ok: true, msg: 'El .aab está firmado con una llave distinta a la de prueba (huella ' + a.slice(0, 8) + '…' + a.slice(-8) + ').' };
}

function keytool(args) {
  // -J-Duser.language=en: mismo formato de salida en cualquier equipo
  const r = cp.spawnSync('keytool', ['-J-Duser.language=en'].concat(args), { encoding: 'utf8' });
  if (r.error) throw new Error('No se encontró keytool (viene con Java): ' + r.error.message);
  return (r.stdout || '') + '\n' + (r.stderr || '');
}

function check(aabPath, keystorePath) {
  if (!fs.existsSync(aabPath)) return { ok: false, msg: 'No se encontró el archivo .aab: ' + aabPath };
  const debugOut = keytool(['-list', '-v', '-keystore', keystorePath || DEBUG_KEYSTORE, '-storepass', DEBUG_PASS]);
  const aabOut = keytool(['-printcert', '-jarfile', aabPath]);
  return decide(sha256Of(aabOut), sha256Of(debugOut));
}

if (require.main === module) {
  const aab = process.argv[2], ks = process.argv[3];
  if (!aab) { console.error('Uso: node scripts/check-aab-key.js <archivo.aab> [llave-de-prueba.keystore]'); process.exit(2); }
  let r;
  try { r = check(aab, ks); } catch (e) { r = { ok: false, msg: e.message }; }
  if (r.ok) console.log('✓ ' + r.msg);
  else console.error('::error::' + r.msg);
  process.exit(r.ok ? 0 : 1);
}

module.exports = { norm, sha256Of, decide, check, DEBUG_KEYSTORE };

'use strict';
/* Las hojas de ayuda se arman sin errores y ninguna fila queda vacía o rota (2.29.1: una coma faltante
   convertía la última fila de «Hasta dónde llega» en un acceso a una propiedad y rompía la hoja). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'ayudas.js'), 'utf8'), ctx);
  const sheets = [];
  const A = ctx.window.ZV.ayudas({ esc: (s) => String(s), openSheet: (t, h) => sheets.push([t, h]), APP_VERSION: '9.9.9' });
  return { A, sheets };
}

test('cada hoja de ayuda se arma y no deja filas vacías ni «undefined»', () => {
  const { A, sheets } = load();
  ['openMapGuide', 'openAppGuide', 'openUses', 'openWhatsNew', 'openLicenses'].forEach((f) => A[f]());
  assert.equal(sheets.length, 5);
  for (const [t, h] of sheets) {
    assert.doesNotMatch(h, /undefined|<dt><\/dt>|<dd><\/dd>/, t);
    const dts = (h.match(/<dt>/g) || []).length, dds = (h.match(/<dd>/g) || []).length;
    assert.ok(dts > 2 && dts === dds, t + ': ' + dts + ' títulos y ' + dds + ' textos');
  }
  assert.match(A.WHATS_NEW_ID, /^\d+\.\d+$/);
});

test('la ayuda explica «Usos recomendados» donde corresponde', () => {
  const { A, sheets } = load();
  A.openAppGuide(); A.openUses(); A.openLicenses();
  assert.match(sheets[0][1], /Usos recomendados y evaluar el terreno/);
  assert.match(sheets[1][1], /capacidad de uso del IGAC/); assert.match(sheets[1][1], /No reemplaza un estudio de suelos/);
  assert.match(sheets[2][1], /IN-GAG-PC05-02/);
  assert.match(sheets[0][1], /Cultivos a evaluar y conclusión/); assert.match(sheets[1][1], /Conclusión y recomendaciones/);
  assert.match(sheets[1][1], /no una orden de siembra/); assert.match(sheets[2][1], /ECOCROP/);
});

test('la ayuda explica el mapa del IGAC (2.31.0) en las cinco hojas', () => {
  const { A, sheets } = load();
  A.openMapGuide(); A.openAppGuide(); A.openUses(); A.openWhatsNew(); A.openLicenses();
  assert.match(sheets[0][1], /Capacidad de uso \(IGAC\).*Guardar la zona del predio para usar sin conexión.*Es un mapa regional/s);
  assert.match(sheets[1][1], /Según el mapa del IGAC.*Consultar el mapa del IGAC/s);
  assert.match(sheets[2][1], /Según el mapa del IGAC/); assert.match(sheets[2][1], /algunos polígonos de estudios antiguos marcados «IV» salen con el color de la clase 6/);
  assert.match(sheets[3][1], /Según el mapa del IGAC.*Capa «Capacidad de uso \(IGAC\)»/s);
  assert.match(sheets[4][1], /mapa multiescalar.*CC BY 4\.0 \(Resolución 616 de 2020\)/s);
  assert.equal(A.WHATS_NEW_ID, '2.31');
});

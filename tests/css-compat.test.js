'use strict';
// Vigila que el CSS siga funcionando en los WebView viejos que Capacitor 8 deja instalar (desde Chromium 60).
// Medido con la emulación de la versión 2.9.1: sin esto, antes de Chromium 87 la barra de pestañas quedaba fuera
// de la pantalla (`inset`), antes de la 79 el mapa medía 2 px (`clamp()`) y antes de la 69 el contenido se metía
// bajo el encabezado (`env()`). Regla: cada declaración con una función moderna lleva antes, en la misma regla,
// otra declaración de la misma propiedad que un navegador viejo sí entienda.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODERNA = /\b(env|clamp|min|max)\(/;

// Reglas sin reglas dentro (también las que están dentro de @media y @keyframes), con sus declaraciones en orden.
function bloques(css) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(limpio))) {
    const decls = [];
    let actual = '', nivel = 0;
    for (const c of m[2] + ';') {
      if (c === '(') nivel++;
      if (c === ')') nivel--;
      if (c === ';' && nivel === 0) {
        const i = actual.indexOf(':');
        if (i > 0) decls.push({ prop: actual.slice(0, i).trim().toLowerCase(), valor: actual.slice(i + 1).trim() });
        actual = '';
      } else actual += c;
    }
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

// Lista de problemas encontrados (vacía si todo está bien).
function problemas(css) {
  const lista = [];
  for (const b of bloques(css)) {
    b.decls.forEach((d, i) => {
      if (d.prop === 'inset') lista.push(`${b.selector}: «inset» abreviado (Chromium 87); usa top, right, bottom y left`);
      if (!MODERNA.test(d.valor)) return;
      const antes = b.decls.slice(0, i).some((x) => x.prop === d.prop && !MODERNA.test(x.valor));
      if (!antes) lista.push(`${b.selector}: «${d.prop}: ${d.valor}» no tiene antes un respaldo de la misma propiedad`);
    });
  }
  return lista;
}

test('app.css: nada de «inset» abreviado y toda función moderna (env, clamp, min, max) con su respaldo antes', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'app.css'), 'utf8');
  assert.deepEqual(problemas(css), []);
});

test('app.css: los respaldos son los que hacen falta (se cuentan para que nadie los quite sin querer)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'app.css'), 'utf8');
  const decls = bloques(css).flatMap((b) => b.decls);
  assert.equal(decls.filter((d) => /\benv\(/.test(d.valor)).length, 12);   // encabezado ×2, contenido, pestañas ×2, ventana, aviso ×2, visor ×2 el mapa a pantalla completa y «Compartir» del reporte
  assert.equal(decls.filter((d) => /\bclamp\(/.test(d.valor)).length, 0);   // la altura del mapa ya no usa clamp()
  assert.equal(decls.filter((d) => /\bmax\(/.test(d.valor)).length, 2);     // altura del mapa: vh y dvh
  assert.equal(decls.filter((d) => /\bmin\(/.test(d.valor)).length, 1);     // ancho del menú ⋮
});

test('app.css: el mapa conserva su altura y su mínimo aunque el navegador no sepa max()', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'app.css'), 'utf8');
  const mapa = bloques(css).find((b) => b.selector === '.mapbox');
  const valor = (p) => mapa.decls.find((d) => d.prop === p).valor;
  assert.equal(valor('min-height'), '340px');
  assert.match(valor('height'), /^calc\(100vh - 236px\)$/);                // la primera, la que entiende un navegador viejo
  // a pantalla completa el mínimo no debe estorbar
  const full = bloques(css).find((b) => b.selector === '.mapbox.full');
  assert.equal(full.decls.find((d) => d.prop === 'height').valor, 'auto');
});

test('app.css: los cuadros de color miden 44 px, como el resto de lo que se toca', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'app.css'), 'utf8');
  const sw = bloques(css).find((b) => b.selector === '.swatch');
  assert.equal(sw.decls.find((d) => d.prop === 'width').valor, '44px');
  assert.equal(sw.decls.find((d) => d.prop === 'height').valor, '44px');
});

// El vigilante también tiene que fallar cuando debe
test('vigilante: detecta el inset abreviado, la función sin respaldo y el respaldo puesto después', () => {
  assert.deepEqual(problemas('.a { position: fixed; top: 0; height: calc(1px + env(safe-area-inset-top)); }').length, 1);
  assert.match(problemas('.a { inset: 0; }')[0], /inset/);
  assert.equal(problemas('.a { height: 10px; height: clamp(1px, 2px, 3px); }').length, 0);
  assert.equal(problemas('.a { height: clamp(1px, 2px, 3px); height: 10px; }').length, 1);                 // el respaldo va antes, no después
  assert.equal(problemas('.a { height: clamp(1px, 2px, 3px); height: clamp(1px, 3px, 4px); }').length, 2);  // dos modernas no se respaldan entre sí
  assert.equal(problemas('.a { width: 5px; height: min(1px, 2px); }').length, 1);                           // el respaldo es de otra propiedad
  assert.equal(problemas('.a { grid-template-columns: repeat(auto-fill, minmax(1px, 1fr)); box-shadow: inset 0 0 0 2px red; }').length, 0);  // minmax e inset del sombreado no cuentan
  assert.equal(problemas('@media (min-width: 1px) { .a { width: 1px; width: max(1px, 2px); } }').length, 0);
  assert.equal(problemas('@media (min-width: 1px) { .a { width: max(1px, 2px); } }').length, 1);
});

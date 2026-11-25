'use strict';
/* Alto contraste (2.34.0): los colores del modo cumplen 7:1 (texto) y 3:1 (bordes y controles), los niveles de las pautas WCAG 2
   (criterios 1.4.6 y 1.4.11). El recorrido 35 mide además el contraste real de cada texto en pantalla. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'app.css'), 'utf8');
function lum(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.replace('#', '').substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function vars(block) { const v = {}; block.replace(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g, (m, k, c) => { v[k] = c; }); return v; }

test('contraste: la fórmula de WCAG da los valores conocidos', () => {
  assert.equal(ratio('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(ratio('#777777', '#FFFFFF').toFixed(2), '4.48');
});

test('alto contraste: cada color de texto sobre su fondo llega a 7:1, y los bordes a 3:1', () => {
  const m = /:root\.alto-contraste, :root\.alto-contraste:not\(\[data-theme="light"\]\) \{([^}]+)\}/.exec(css);
  assert.ok(m, 'existe el bloque de alto contraste, que también manda sobre el modo oscuro');
  const v = vars(m[1]);
  const texto = [['ink', 'paper'], ['ink', 'surface'], ['ink-soft', 'paper'], ['ink-soft', 'surface'], ['muted', 'paper'],
    ['blue', 'surface'], ['blue', 'blue-soft'], ['on-blue', 'blue'], ['green', 'surface'], ['green', 'green-soft'],
    ['red', 'surface'], ['red', 'red-soft'], ['amber', 'surface'], ['amber', 'amber-soft'], ['ink', 'green-soft'], ['ink', 'amber-soft'], ['ink', 'red-soft'], ['ink', 'blue-soft']];
  for (const [a, b] of texto) {
    assert.ok(v[a] && v[b], 'faltan --' + a + ' o --' + b);
    const r = ratio(v[a], v[b]);
    assert.ok(r >= 7, '--' + a + ' sobre --' + b + ': ' + r.toFixed(2) + ':1');
  }
  assert.ok(ratio(v.line, v.surface) >= 3, 'los bordes se distinguen: ' + ratio(v.line, v.surface).toFixed(2));
  assert.match(m[1], /color-scheme: light/);
  // los colores fijos del modo (barra de arriba, avisos) también
  for (const [a, b] of [['#FFFFFF', '#000000'], ['#FFE14D', '#000000'], ['#FFFFFF', '#7A1D22'], ['#000000', '#FFE14D']]) assert.ok(ratio(a, b) >= 7, a + ' sobre ' + b);
  // los textos de los dibujos (sobre blanco) pasan a tonos oscuros del mismo color
  const svgFills = [...css.matchAll(/\.alto-contraste svg text\[fill="(#[0-9A-F]{6})"\][^{]*\{ fill: (#[0-9A-F]{6}); \}/g)];
  assert.ok(svgFills.length >= 4, 'cambios de color de los textos de los dibujos');
  for (const [, , nuevo] of svgFills) assert.ok(ratio(nuevo, '#FFFFFF') >= 7, nuevo + ' sobre blanco: ' + ratio(nuevo, '#FFFFFF').toFixed(2));
  const js = ['diagram.js', 'perfil.js', 'walter-lieth.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'www', 'js', f), 'utf8')).join('\n');
  for (const c of ['#5B6F61', '#D8353C', '#C42D34', '#2F8F4E', '#1F3FBF']) {
    if (js.includes("'" + c + "'")) assert.match(css, new RegExp('\\.alto-contraste svg text\\[fill="' + c + '"\\]'), 'el color ' + c + ' de los dibujos tiene su tono oscuro');
  }
});

test('alto contraste: no cambia el tamaño ni el lugar de nada (solo colores, bordes y subrayados)', () => {
  const reglas = css.slice(css.indexOf('/* ---------- Alto contraste (2.34.0)'), css.indexOf('/* ---------- Registro de errores (2.34.0)'));
  assert.ok(reglas.length > 500);
  const props = [...reglas.matchAll(/([a-z-]+)\s*:\s*[^;{}]+;/g)].map((x) => x[1]).filter((p) => !p.startsWith('--'));
  // ni el grosor de los bordes: un borde más grueso correría el contenido (los bordes marcados van con box-shadow)
  const permitidas = new Set(['color', 'fill', 'background', 'border-color', 'border-top-color', 'border-style', 'box-shadow', 'outline', 'outline-offset', 'text-decoration', 'text-underline-offset', 'opacity', 'color-scheme']);
  for (const p of props) assert.ok(permitidas.has(p), 'propiedad que movería algo: ' + p);
});

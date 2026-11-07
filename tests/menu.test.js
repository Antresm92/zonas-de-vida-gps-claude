'use strict';
/* Menú inferior: nombres que ve la persona y orden. Los identificadores internos (data-tab) no cambian. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const nav = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'));
const botones = [...nav.matchAll(/<button id="nav-(\w+)" data-act="tab" data-tab="(\w+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)]
  .map((m) => ({ id: m[1], tab: m[2], etiqueta: m[3] }));

test('menú inferior: Puntos, Polígono, Información, Reporte y Herramientas, en ese orden', () => {
  assert.deepEqual(botones.map((b) => b.etiqueta), ['Puntos', 'Polígono', 'Información', 'Reporte', 'Herramientas']);
});

test('menú inferior: cada botón abre su sección (los identificadores internos se conservan)', () => {
  assert.deepEqual(botones.map((b) => b.tab), ['puntos', 'area', 'clima', 'informe', 'herramientas']);
  for (const b of botones) {
    assert.equal(b.id, b.tab);
    assert.match(html, new RegExp('<section class="tab" id="tab-' + b.tab + '" aria-labelledby="nav-' + b.tab + '"'));
  }
});

test('menú inferior: ya no quedan los nombres viejos «Clima» e «Informe» como etiqueta', () => {
  assert.doesNotMatch(nav, /<span>(Clima|Informe)<\/span>/);
});

test('textos de la app: el reporte y la pestaña de información se llaman con su nombre nuevo', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'app.js'), 'utf8');
  assert.match(app, /Compartir reporte/);
  assert.match(app, /Ir a Información/);
  assert.match(app, /desde la pestaña Información/);
  assert.doesNotMatch(app, /Compartir informe|Ir a Clima|pestaña Clima|Informe descargado/);
});

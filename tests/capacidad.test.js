'use strict';
/* Clase de capacidad de uso según el IGAC (IN-GAG-PC05-02, 2021). Borrador: la tabla se verifica contra el PDF antes de usarla en la app. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/capacidad.js');

// Para cada clase, un terreno con TODAS las variables en el peor valor que esa clase todavía admite (Tablas 1–8)
// debe dar justo esa clase; así se comprueba cada columna de la tabla.
function peorQueAdmite(clase) {
  const d = {};
  for (const v of C.VARS) {
    const ok = v.cats.filter((c) => c[2] <= clase);
    if (ok.length) d[v.key] = ok[ok.length - 1][0];
  }
  return d;
}

test('cada variable trae su letra de subclase, su fuente y categorías con una clase válida', () => {
  assert.equal(C.VARS.length, 21);
  for (const v of C.VARS) {
    assert.match(v.letter, /^[pehsc]$/, v.key);
    assert.ok(v.src.length > 5, v.key);
    assert.ok(['app', 'campo', 'lab'].includes(v.group), v.key);
    for (const c of v.cats) assert.ok([1, 2, 3, 4, 6, 7, 8].includes(c[2]), v.key + ' ' + c[0] + ': la clase 5 no se asigna sola');
    // las categorías van de mejor a peor
    for (let i = 1; i < v.cats.length; i++) assert.ok(v.cats[i][2] >= v.cats[i - 1][2], v.key + ' en orden');
  }
  assert.match(C.FUENTE.url, /^https:\/\/igac\.gov\.co\/.*capacidad_de_uso\.pdf$/);
});

test('todo en el mejor valor: clase 1; todo en el peor que admite cada clase: esa clase', () => {
  const r1 = C.evaluar(peorQueAdmite(1));
  assert.equal(r1.clase, 1); assert.equal(r1.subclase, '1'); assert.deepEqual(r1.limita, []);
  for (const k of [2, 3, 4, 6, 7, 8]) assert.equal(C.evaluar(peorQueAdmite(k)).clase, k, 'clase ' + k);
});

test('el limitante más severo decide; la subclase lleva las letras de lo que limita, en orden p e h s c', () => {
  let r = C.evaluar({ pendiente: '25-50', piso: 'templado', humedad: 'humedo' });
  assert.equal(r.clase, 6); assert.equal(r.subclase, '6p');
  assert.deepEqual(r.limita.map((x) => x.key), ['pendiente']);
  assert.match(r.usos.txt, /semiperennes o perennes/);
  r = C.evaluar({ pendiente: '12-25', erosion: 'moderada', profundidad: '25-50', heladas: 'no' });
  assert.equal(r.subclase, '4pes');
  r = C.evaluar({ pendiente: '0-3', afloramiento: '25-50', humedad: 'pluvial' });
  assert.equal(r.subclase, '6sc');
});

test('lo que no se sabe no se usa y el resultado queda provisional', () => {
  const r = C.evaluar({ pendiente: '7-12' });
  assert.equal(r.clase, 3); assert.equal(r.conocidas, 1); assert.equal(r.total, 21); assert.equal(r.provisional, true);
  const nada = C.evaluar({});
  assert.equal(nada.clase, null); assert.equal(nada.subclase, null); assert.equal(nada.usos, null);
  assert.equal(C.evaluar({ pendiente: 'inventada' }).clase, null, 'una categoría que no existe no cuenta');
  assert.equal(C.evaluar(peorQueAdmite(1)).provisional, false, 'con las 21 variables ya no es provisional');
});

test('posible clase 5: casi plano y lo que limita es solo el exceso de agua', () => {
  let r = C.evaluar({ pendiente: '0-3', inundFrec: 'muyfrecuente', drenaje: 'bien' });
  assert.equal(r.posibleClase5, true);
  r = C.evaluar({ pendiente: '12-25', drenaje: 'muypobre' });
  assert.equal(r.posibleClase5, false, 'con pendiente no');
  r = C.evaluar({ pendiente: '0-3', drenaje: 'muypobre', afloramiento: '25-50' });
  assert.equal(r.posibleClase5, false, 'si también limita el suelo, no');
});

test('pendiente, piso térmico (Tabla 28) y humedad (relación ETP/P) desde lo que calcula la app', () => {
  assert.deepEqual([0, 3, 3.1, 7, 12, 25, 25.5, 50, 75, 80].map(C.pendienteCat), ['0-3', '0-3', '3-7', '3-7', '7-12', '12-25', '25-50', '25-50', '50-75', '75+']);
  assert.equal(C.pendienteCat(-1), null); assert.equal(C.pendienteCat(NaN), null);
  assert.deepEqual([27, 24, 21, 18, 15, 12, 10, 8, 5, 4, 2, 1].map(C.pisoCat),
    ['calido', 'templado', 'templado', 'templado', 'frio', 'frio', 'muyfrio', 'muyfrio', 'extfrio', 'extfrio', 'subnival', 'nival']);
  assert.equal(C.pisoCat(undefined), null);
  assert.deepEqual([0.2, 0.3, 0.7, 1.5, 3, 5, 9].map(C.humedadCat), ['pluvial', 'muyhumedo', 'humedo', 'seco', 'muyseco', 'semiarido', 'arido']);
  assert.equal(C.humedadCat(0), null);
});

test('los usos de las ocho clases citan su página', () => {
  for (let k = 1; k <= 8; k++) { assert.match(C.USOS[k].pag, /^pp\. \d+–\d+$/); assert.ok(C.USOS[k].txt.length > 20); }
  assert.equal(C.best('drenaje', 'modexcesivo'), 4); assert.equal(C.best('nada', 'x'), null);
});

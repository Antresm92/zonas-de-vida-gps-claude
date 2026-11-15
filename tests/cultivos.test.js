'use strict';
/* «Cultivos a evaluar» y «Conclusión y recomendaciones» (2.30.0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/cultivos.js');
const DATOS = require('../www/js/cultivos-datos.js');

test('los datos: 127 cultivos completos, con tipo válido y rangos en orden', () => {
  assert.equal(DATOS.length, 127); assert.equal(C.total, 127);
  const nombres = new Set();
  for (const r of DATOS) {
    assert.equal(r.length, 7, r[0]);
    assert.ok(!nombres.has(r[0]), 'repetido: ' + r[0]); nombres.add(r[0]);
    assert.ok('THSPAGF'.includes(r[3]) && r[3].length === 1, r[0]);
    for (const k of [4, 5]) {
      assert.equal(r[k].length, 4, r[0]);
      assert.ok(r[k].every(Number.isFinite), r[0]);
      assert.ok(r[k][0] <= r[k][1] && r[k][1] <= r[k][2] && r[k][2] <= r[k][3], r[0] + ' rango en orden');
    }
  }
  for (const n of ['Café', 'Cacao', 'Plátano', 'Papa', 'Yuca', 'Maíz', 'Mora', 'Lulo', 'Kikuyo', 'Pino pátula']) assert.ok(nombres.has(n), n);
  // un valor copiado de la fuente, para notar si alguien lo cambia sin querer
  assert.deepEqual(DATOS.find((r) => r[0] === 'Café').slice(4), [[10, 14, 28, 34], [750, 1400, 2300, 4200], 0]);
});

test('aptitud de una variable: 1 en el óptimo, 0 fuera del rango y proporcional en medio', () => {
  const r = [10, 14, 28, 34];
  assert.equal(C.suit(20, r), 1); assert.equal(C.suit(14, r), 1); assert.equal(C.suit(28, r), 1);
  assert.equal(C.suit(10, r), 0); assert.equal(C.suit(35, r), 0);
  assert.equal(C.suit(12, r), 0.5); assert.equal(C.suit(31, r), 0.5);
  assert.equal(C.suit(undefined, r), null);
});

test('café a 21 °C y 1800 mm, clase 2: óptimo; con heladas, marginal; en clase 7, no recomendado', () => {
  const cafe = DATOS.find((r) => r[0] === 'Café');
  let c = C.evalua(cafe, { T: 21, P: 1800, clase: 2 });
  assert.equal(c.cat, 'optimo'); assert.equal(c.clima, 1); assert.deepEqual(c.lim, []);
  c = C.evalua(cafe, { T: 21, P: 1800, clase: 2, terreno: { heladas: '3-10' } });
  assert.equal(c.cat, 'marginal'); assert.match(c.lim.join(), /heladas \(muere desde 0 °C\)/);
  c = C.evalua(cafe, { T: 21, P: 1800, clase: 7 });
  assert.equal(c.cat, 'no'); assert.match(c.lim.join(), /la clase 7 es de aptitud forestal/);
  c = C.evalua(cafe, { T: 21, P: 1200, clase: 6 });
  assert.equal(c.cat, 'posible'); assert.match(c.lim.join(), /poca lluvia \(1400–2300 mm\/año es lo óptimo; con riego puede mejorar\)/);
  c = C.evalua(cafe, { T: 12, P: 1800 });
  assert.equal(c.cat, 'posible'); assert.match(c.lim.join(), /temperatura baja/); assert.equal(c.tierra, 'si', 'sin clase no filtra por tierra');
  assert.equal(C.evalua(cafe, { T: 40, P: 1800 }).cat, 'no');
  assert.equal(C.evalua(cafe, { P: 1800 }).cat, null);
});

test('las clases filtran por tipo según la frase de usos del IGAC', () => {
  const papa = DATOS.find((r) => r[0] === 'Papa'), pino = DATOS.find((r) => r[0] === 'Pino pátula'), kik = DATOS.find((r) => r[0] === 'Kikuyo');
  assert.equal(C.evalua(papa, { T: 15, P: 700, clase: 6 }).cat, 'no', 'transitorio en clase 6');
  assert.equal(C.evalua(papa, { T: 15, P: 700, clase: 3 }).tierra, 'lim');
  assert.equal(C.evalua(pino, { T: 18, P: 1500, clase: 7 }).cat, 'optimo');
  assert.equal(C.evalua(kik, { T: 16, P: 1000, clase: 4 }).cat, 'optimo');
  assert.equal(C.evalua(kik, { T: 16, P: 1000, clase: 8 }).cat, 'no');
  for (let k = 1; k <= 8; k++) assert.ok(C.CLASE_TIPOS[k].razon.length > 10);
});

test('evaluar ordena: óptimos primero (mejor clima), luego posibles, marginales y no recomendados', () => {
  const r = C.evaluar({ T: 21, P: 1800, clase: 2 });
  assert.equal(r.total, 127); assert.equal(r.conClase, true);
  const cats = r.todos.map((c) => c.cat), orden = ['optimo', 'posible', 'marginal', 'no'];
  for (let i = 1; i < cats.length; i++) assert.ok(orden.indexOf(cats[i]) >= orden.indexOf(cats[i - 1]));
  assert.ok(r.grupos.optimo.some((c) => c.es === 'Café'));
  assert.ok(r.grupos.optimo.length > 5 && r.grupos.no.length > 5);
  assert.equal(C.evaluar({ T: 21 }), null);
});

test('conclusión: párrafo con los datos y recomendaciones con su fuente', () => {
  const cultivos = C.evaluar({ T: 21, P: 1800, clase: 6 });
  const k = C.conclusion({ nombre: 'Potrero', ha: 1.29, zona: 'bosque húmedo premontano (bh-PM)', T: 21, P: 1800, secos: 2, clase: 6, subclase: '6p', limita: ['Pendiente'],
    provisional: true, faltan: 18, pendiente: 35, humedad: 'humedo', lab: false, cultivos });
  assert.match(k.parrafo, /^El polígono «Potrero» \(1,29 ha\) está en la zona de vida bosque húmedo premontano \(bh-PM\) \(Holdridge\), con 21,0 °C de temperatura media y 1800 mm de lluvia al año y 2 meses secos \(Walter-Lieth\)\. Según el IGAC, su clase de capacidad de uso es 6p, limitada por pendiente \(provisional: faltan 18 datos\)\. Por clima y tierra, los cultivos con mejor aptitud son: /);
  const t = k.recomendaciones.map((x) => x.t).join(' | ');
  assert.match(t, /Con 35 % de pendiente, preferir cultivos permanentes densos/);
  assert.match(t, /Prever riego, cosecha de agua o cultivos tolerantes a la sequía para los 2 meses secos/);
  assert.match(t, /Completar la evaluación del terreno \(18 datos/);
  assert.match(t, /Hacer un análisis de suelos/);
  assert.match(t, /Validar estos resultados con un profesional/);
  for (const r of k.recomendaciones) assert.ok([0, 1, 2, 3].includes(r.f));
  const bosque = C.conclusion({ nombre: 'B', T: 18, P: 2000, clase: 7, subclase: '7p', lab: true, secos: 0 });
  assert.match(bosque.parrafo, /sin meses secos/); assert.match(bosque.recomendaciones[0].t, /bosque protector/);
  assert.match(C.conclusion({ nombre: 'C', T: 18, P: 2000, clase: 8, subclase: '8s', lab: true }).recomendaciones[0].t, /conservación/);
  assert.match(C.conclusion({ nombre: 'D', T: 18, P: 2000, pendiente: 10, lab: true }).recomendaciones[0].t, /prácticas de conservación de suelos/);
  assert.match(C.conclusion({ nombre: 'E', T: 18, P: 5000, humedad: 'pluvial', lab: true }).recomendaciones[0].t, /pluvial/);
  assert.equal(C.conclusion({ nombre: 'F' }), null); assert.equal(C.conclusion(null), null);
  assert.match(C.NOTA, /No reemplaza la visita de un profesional/);
  assert.match(C.FUENTES[3], /ECOCROP/);
});

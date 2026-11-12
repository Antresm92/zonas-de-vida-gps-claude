'use strict';
/* Conversor de unidades (2.7.0): factores exactos, entrada con coma o punto, formato para mostrar y la temperatura (que no es una proporción). */
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../www/js/units.js');

const val = (cat, v, from, to) => U.convert(cat, v, from).rows.find((r) => r.id === to).value;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-12 + 1e-15, (msg || '') + ' ' + a + ' ≠ ' + b);

test('categorías: las tres magnitudes de campo en el orden de las tarjetas, con unidades únicas y su unidad inicial', () => {
  assert.deepEqual(U.CATEGORIES.map((c) => c.id), ['area', 'distancia', 'temperatura']);
  assert.deepEqual(U.CATEGORIES.map((c) => c.name), ['Área', 'Distancia', 'Temperatura']);
  for (const c of U.CATEGORIES) {
    const ids = c.units.map((u) => u.id);
    assert.equal(new Set(ids).size, ids.length, c.id + ': ids repetidos');
    assert.ok(U.unit(c, c.def), c.id + ': la unidad inicial existe');
    assert.equal(c.units[0].id, c.def, c.id + ': la unidad inicial va primero');
    c.units.forEach((u) => { assert.ok(u.name && u.sym, 'nombre y símbolo de ' + u.id); assert.ok(u.f > 0 || typeof u.toBase === 'function'); });
  }
  assert.equal(U.category('area').name, 'Área');
  assert.equal(U.category('nada'), null);
  // lo que no es de un levantamiento de campo se quitó en la 2.13
  for (const id of ['peso', 'volumen', 'energia', 'velocidad', 'potencia']) { assert.equal(U.category(id), null); assert.equal(U.convert(id, 1, 'kg').ok, false); }
  assert.equal(U.unit(U.category('area'), 'xx'), null);
});

test('área: hectárea, fanegada (6.400 m², la del reporte), acre, pie cuadrado y milla cuadrada', () => {
  near(val('area', 1, 'ha', 'm2'), 10000);
  near(val('area', 1, 'km2', 'ha'), 100);
  near(val('area', 1, 'fanegada', 'm2'), 6400);
  near(val('area', 1, 'fanegada', 'ha'), 0.64);
  near(val('area', 1, 'acre', 'm2'), 4046.8564224);
  near(val('area', 1, 'acre', 'ft2'), 43560);
  near(val('area', 1, 'mi2', 'acre'), 640);
  near(val('area', 1, 'yd2', 'ft2'), 9);
  near(val('area', 1, 'ft2', 'in2'), 144);
  near(val('area', 1, 'm2', 'cm2'), 10000);
});
test('distancia: pulgada, pie, yarda, milla y milla náutica con sus definiciones exactas', () => {
  near(val('distancia', 1, 'mi', 'km'), 1.609344);
  near(val('distancia', 1, 'ft', 'm'), 0.3048);
  near(val('distancia', 1, 'ft', 'in'), 12);
  near(val('distancia', 1, 'yd', 'ft'), 3);
  near(val('distancia', 1, 'mi', 'ft'), 5280);
  near(val('distancia', 1, 'nmi', 'm'), 1852);
  near(val('distancia', 1, 'km', 'mm'), 1e6);
  near(val('distancia', 250, 'cm', 'm'), 2.5);
});
test('convertir ida y vuelta devuelve el mismo valor en todas las magnitudes y unidades', () => {
  for (const c of U.CATEGORIES) {
    for (const a of c.units) {
      const r = U.convert(c.id, 123.456, a.id);
      assert.equal(r.ok, true);
      assert.equal(r.rows.length, c.units.length);
      assert.equal(r.rows.find((x) => x.id === a.id).value === undefined, false);
      for (const b of c.units) {
        const ab = r.rows.find((x) => x.id === b.id).value;
        const back = U.convert(c.id, ab, b.id).rows.find((x) => x.id === a.id).value;
        near(back, 123.456, c.id + ' ' + a.id + '→' + b.id + '→' + a.id);
      }
      near(r.rows.find((x) => x.id === a.id).value, 123.456, 'la unidad de origen conserva el valor');
    }
  }
});
test('convertir: cero, negativos y la fila de cada unidad trae nombre, símbolo y texto', () => {
  const r = U.convert('area', 0, 'ha');
  assert.ok(r.rows.every((x) => x.value === 0 && x.text === '0'));
  const n = U.convert('distancia', -5, 'km');
  near(n.rows.find((x) => x.id === 'm').value, -5000);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['id', 'name', 'sym', 'text', 'value']);
  assert.equal(U.convert('area', 1, 'ha').rows.find((x) => x.id === 'm2').text, '10.000');
});

test('temperatura: Celsius, Fahrenheit, kelvin y Rankine', () => {
  near(val('temperatura', 100, 'c', 'f'), 212);
  near(val('temperatura', 100, 'c', 'k'), 373.15);
  near(val('temperatura', 100, 'c', 'r'), 671.67);
  near(val('temperatura', 32, 'f', 'c'), 0);
  near(val('temperatura', -40, 'f', 'c'), -40);
  near(val('temperatura', -40, 'c', 'f'), -40);
  near(val('temperatura', 0, 'k', 'c'), -273.15);
  near(val('temperatura', 0, 'k', 'f'), -459.67);
  near(val('temperatura', 491.67, 'r', 'c'), 0);
  near(val('temperatura', 14.8, 'c', 'f'), 58.64);
  const k0 = U.convert('temperatura', 0, 'k').rows;
  assert.equal(k0.find((x) => x.id === 'r').value, 0);
});
test('temperatura: menos que el cero absoluto no existe y se dice; justo el cero absoluto sí', () => {
  for (const [v, u] of [[-273.16, 'c'], [-459.68, 'f'], [-1, 'k'], [-1, 'r']]) {
    const r = U.convert('temperatura', v, u);
    assert.equal(r.ok, false, v + ' ' + u);
    assert.match(r.error, /cero absoluto/);
  }
  assert.equal(U.convert('temperatura', -273.15, 'c').ok, true);
  assert.equal(U.convert('temperatura', -459.67, 'f').ok, true);
  assert.equal(U.convert('temperatura', 0, 'r').ok, true);
  // otras magnitudes sí aceptan negativos (una distancia negativa es un desplazamiento)
  assert.equal(U.convert('distancia', -1, 'm').ok, true);
});

test('convertir: el ruido de punto flotante se limpia solo en temperatura; en las demás magnitudes los valores diminutos se conservan', () => {
  // 1 cm² son 1e-10 km²: no se redondea a cero (solo la temperatura limpia lo que queda por debajo de 1e-9)
  const area = U.convert('area', 1, 'cm2').rows;
  assert.equal(area.find((x) => x.id === 'km2').text, '1e-10');
  assert.equal(area.find((x) => x.id === 'km2').value, 1e-10);
  // temperatura: una diferencia de 1e-12 con respecto al cero es ruido de la resta y se muestra 0; 0,001 °C sí es un valor real
  const ruido = U.convert('temperatura', 1e-12, 'c').rows.find((x) => x.id === 'c');
  assert.equal(ruido.value, 0);
  assert.equal(ruido.text, '0');
  assert.equal(U.convert('temperatura', 0.001, 'c').rows.find((x) => x.id === 'c').text, '0,001');
});

test('convertir: entradas que no se pueden convertir dan un mensaje y no filas', () => {
  assert.deepEqual(U.convert('nada', 1, 'm'), { ok: false, error: 'Magnitud desconocida.' });
  assert.deepEqual(U.convert('area', 1, 'xx'), { ok: false, error: 'Unidad desconocida.' });
  for (const malo of [NaN, Infinity, null, undefined, '5']) assert.deepEqual(U.convert('area', malo, 'm2'), { ok: false, error: 'Escribe un número.' });
  assert.deepEqual(U.convert('area', 1e308, 'mi2'), { ok: false, error: 'El número es demasiado grande.' });
});

test('parse: coma o punto decimal, separador de miles, signo y exponente', () => {
  const casos = [['1234,5', 1234.5], ['1234.5', 1234.5], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['3.5', 3.5], ['3,5', 3.5], ['.5', 0.5], ['5.', 5], ['7', 7], ['0', 0],
    ['1.234.567', 1234567], ['1,234,567', 1234567], ['1.234', 1.234], ['1,234', 1.234], ['-12,5', -12.5], ['+3', 3], ['1e3', 1000], ['2,5e-3', 0.0025], ['1E2', 100],
    [' 12 345 ', 12345], ['12 345', 12345], ["12'345", 12345], [42, 42]];
  for (const [t, v] of casos) assert.equal(U.parse(t), v, 'parse(' + JSON.stringify(t) + ')');
});
test('parse: lo que no es un número da null (varios decimales, grupos mal formados, letras, vacío)', () => {
  for (const t of ['', ' ', '.', ',', 'abc', '1,2,3', '1.5.3', '1.234,5,6', '--1', '1,5.2,1', '12a', '1e', 'e5', '1..2', '1,,2', '1.2345.678', '12.34.567', '.1.234', NaN, Infinity, null, undefined, {}, [], true])
    assert.equal(U.parse(t), null, 'parse(' + JSON.stringify(t) + ')');
  assert.equal(U.parse('1,234.56.7'), null);
  assert.equal(U.parse('1.234,56,7'), null);
  assert.equal(U.parse('1e999'), null);
});

test('format: 7 cifras, coma decimal, punto de miles desde 5 cifras y notación científica en los extremos', () => {
  const casos = [[0, '0'], [1, '1'], [-0.5, '-0,5'], [100, '100'], [1234, '1234'], [12345, '12.345'], [12345.678, '12.345,68'], [99999.99, '99.999,99'], [1234567.891, '1.234.568'],
    [0.1 + 0.2, '0,3'], [0.000012345678, '0,00001234568'], [1e-6, '0,000001'], [1e-7, '1e-7'], [1.5e-9, '1,5e-9'], [1.5e20, '1,5e20'], [-2.5e17, '-2,5e17'], [1e15, '1e15'],
    [123456789012345, '123.456.800.000.000'], [-1234567, '-1.234.567'], [0.5, '0,5'], [4046.8564224, '4046,856'], [10000, '10.000'], [6.02214076e23, '6,022141e23']];
  for (const [v, t] of casos) assert.equal(U.format(v), t, 'format(' + v + ')');
  for (const malo of [NaN, Infinity, -Infinity, null, undefined, '5']) assert.equal(U.format(malo), '—');
});
test('format y parse son compatibles: lo que se muestra se puede volver a escribir', () => {
  for (const v of [12345.68, 0.5, 1234567, 0.000001, 99999.99, 4046.856, 7]) near(U.parse(U.format(v)), v, 'v=' + v);
});

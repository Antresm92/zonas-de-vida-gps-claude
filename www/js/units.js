/* units.js — conversor de unidades de la pestaña «Herramientas» (2.7.0). Funciona sin internet.
 *
 * Ocho magnitudes: área, distancia, peso, volumen, energía, temperatura, velocidad y potencia. Cada una guarda sus unidades con el factor
 * exacto respecto de una unidad base (las definiciones oficiales: pie = 0,3048 m, libra = 0,45359237 kg, galón US = 3,785411784 L, caloría
 * termoquímica = 4,184 J, etc.); la temperatura usa fórmulas porque no es una proporción. Se escribe un valor en una unidad y se obtiene
 * en todas las demás a la vez.
 *
 * Unidades regionales: solo se incluye la fanegada (6.400 m², la misma que usa el reporte). La cuadra, la plaza o el almud cambian de tamaño según
 * la región, y la «libra» comercial de Colombia (500 g) no es la libra internacional, así que no se incluyen para no dar un número equivocado. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Units = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  // Unidad proporcional: f = cuántas unidades base vale una de esta
  function lin(id, name, sym, f) { return { id: id, name: name, sym: sym, f: f }; }

  var AREA = [
    lin('m2', 'metro cuadrado', 'm²', 1),
    lin('ha', 'hectárea', 'ha', 10000),
    lin('km2', 'kilómetro cuadrado', 'km²', 1e6),
    lin('fanegada', 'fanegada (6.400 m²)', 'fanegada', 6400),
    lin('cm2', 'centímetro cuadrado', 'cm²', 1e-4),
    lin('acre', 'acre', 'ac', 4046.8564224),
    lin('ft2', 'pie cuadrado', 'ft²', 0.09290304),
    lin('in2', 'pulgada cuadrada', 'in²', 0.00064516),
    lin('yd2', 'yarda cuadrada', 'yd²', 0.83612736),
    lin('mi2', 'milla cuadrada', 'mi²', 2589988.110336)
  ];
  var DISTANCIA = [
    lin('m', 'metro', 'm', 1),
    lin('km', 'kilómetro', 'km', 1000),
    lin('cm', 'centímetro', 'cm', 0.01),
    lin('mm', 'milímetro', 'mm', 0.001),
    lin('in', 'pulgada', 'in', 0.0254),
    lin('ft', 'pie', 'ft', 0.3048),
    lin('yd', 'yarda', 'yd', 0.9144),
    lin('mi', 'milla', 'mi', 1609.344),
    lin('nmi', 'milla náutica', 'nmi', 1852)
  ];
  // Temperatura: la base es el kelvin; cada unidad sabe pasar de y a kelvin
  var TEMPERATURA = [
    { id: 'c', name: 'grado Celsius', sym: '°C', toBase: function (v) { return v + 273.15; }, fromBase: function (k) { return k - 273.15; } },
    { id: 'f', name: 'grado Fahrenheit', sym: '°F', toBase: function (v) { return (v - 32) * 5 / 9 + 273.15; }, fromBase: function (k) { return (k - 273.15) * 9 / 5 + 32; } },
    { id: 'k', name: 'kelvin', sym: 'K', toBase: function (v) { return v; }, fromBase: function (k) { return k; } },
    { id: 'r', name: 'grado Rankine', sym: '°R', toBase: function (v) { return v * 5 / 9; }, fromBase: function (k) { return k * 9 / 5; } }
  ];

  // Las tres tarjetas, en el orden en que salen en la pantalla. «def» es la unidad con que abre el conversor.
  // (Hasta la 2.12 había también peso, volumen, energía, velocidad y potencia; se quitaron por no ser de un levantamiento de campo.)
  var CATEGORIES = [
    { id: 'area', name: 'Área', def: 'm2', units: AREA },
    { id: 'distancia', name: 'Distancia', def: 'm', units: DISTANCIA },
    { id: 'temperatura', name: 'Temperatura', def: 'c', units: TEMPERATURA }
  ];

  function category(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return null;
  }
  function unit(cat, id) {
    for (var i = 0; i < cat.units.length; i++) if (cat.units[i].id === id) return cat.units[i];
    return null;
  }

  // Lo que escribe la persona → número, o null si no se entiende. Acepta coma o punto decimal y separador de miles:
  // «1.234,5», «1,234.5», «1234,5», «3.5», «1.234.567», «-12,5», «1e3». Un solo punto o una sola coma se toman como decimal («1.234» vale 1,234);
  // varios solo valen como separador de miles si los grupos son de tres cifras («1.234.567», no «1.5.3»).
  function parse(text) {
    if (typeof text === 'number') return isNum(text) ? text : null;
    if (typeof text !== 'string') return null;
    var s = text.replace(/[\s\u00a0\u202f']/g, '');
    var m = /^([+-]?)([\d.,]*\d[\d.,]*)([eE][+-]?\d+)?$/.exec(s);
    if (!m) return null;
    var sign = m[1] === '-' ? '-' : '', body = m[2], exp = m[3] || '', num;
    var dots = (body.match(/\./g) || []).length, commas = (body.match(/,/g) || []).length;
    if (dots && commas) {
      var dec = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',', mil = dec === '.' ? ',' : '.', cut = body.lastIndexOf(dec);
      var ent = body.slice(0, cut), frac = body.slice(cut + 1);
      if (!grouped(ent, mil)) return null;
      num = ent.split(mil).join('') + '.' + frac;
    } else if (dots > 1 || commas > 1) {
      var sep = dots ? '.' : ',';
      if (!grouped(body, sep)) return null;
      num = body.split(sep).join('');
    } else num = body.replace(',', '.');
    var v = parseFloat(sign + num + exp);
    return isNum(v) ? v : null;
  }
  // «1.234.567» con ese separador: primer grupo de 1 a 3 cifras y los demás de exactamente 3
  function grouped(s, sep) { return new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(s); }

  // Número para mostrar: 7 cifras significativas, coma decimal y punto de miles (desde 5 cifras enteras); notación científica en lo muy grande o muy pequeño.
  function format(v) {
    if (!isNum(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a >= 1e15 || a < 1e-6) {
      var e = v.toExponential(6).split('e'), mant = e[0].replace(/\.?0+$/, '').replace('.', ',');
      return mant + 'e' + String(parseInt(e[1], 10));
    }
    var n = Number(v.toPrecision(7)), s = String(n), neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.'), ent = parts[0];
    if (ent.length >= 5) ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + ent + (parts[1] ? ',' + parts[1] : '');
  }

  // Valor en una unidad → el mismo valor en todas las de la magnitud. { ok, rows: [{ id, name, sym, value, text }] } o { ok: false, error }
  function convert(catId, value, unitId) {
    var cat = category(catId);
    if (!cat) return { ok: false, error: 'Magnitud desconocida.' };
    var from = unit(cat, unitId);
    if (!from) return { ok: false, error: 'Unidad desconocida.' };
    if (!isNum(value)) return { ok: false, error: 'Escribe un número.' };
    var base = from.f !== undefined ? value * from.f : from.toBase(value);
    if (!isNum(base)) return { ok: false, error: 'El número es demasiado grande.' };
    if (cat.id === 'temperatura' && base < -1e-9) return { ok: false, error: 'Es menos que el cero absoluto (−273,15 °C): no existe esa temperatura.' };
    var rows = cat.units.map(function (u) {
      var x = u.f !== undefined ? base / u.f : u.fromBase(base);
      if (cat.id === 'temperatura' && Math.abs(x) < 1e-9) x = 0;                      // 273,15 − 273,15 deja ruido de punto flotante
      return { id: u.id, name: u.name, sym: u.sym, value: x, text: format(x) };
    });
    return { ok: true, rows: rows };
  }

  return { CATEGORIES: CATEGORIES, category: category, unit: unit, parse: parse, format: format, convert: convert };
});

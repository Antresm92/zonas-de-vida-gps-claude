'use strict';
/* mapa.js — lo que se puede comprobar del mapa sin pantalla: capas, qué se dibuja, avisos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Mapa = require('../www/js/mapa.js');

const P = (name, lat, lon, extra) => Object.assign({ id: 'id-' + name, name, lat, lon }, extra || {});

test('capas base: calles (OpenStreetMap) y satélite (Esri), cada una con su atribución', () => {
  assert.deepEqual(Object.keys(Mapa.BASES).sort(), ['calles', 'satelite']);
  assert.match(Mapa.BASES.calles.url, /^https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  assert.match(Mapa.BASES.satelite.url, /^https:\/\/server\.arcgisonline\.com\/.*World_Imagery.*\/\{z\}\/\{y\}\/\{x\}$/);
  assert.match(Mapa.BASES.calles.attribution, /OpenStreetMap/);
  assert.match(Mapa.BASES.satelite.attribution, /Esri/);
  assert.ok(Mapa.BASES.calles.attribution.includes('rel="noopener noreferrer"'), 'los enlaces no deben abrirse dentro de la app');
  Object.values(Mapa.BASES).forEach((b) => assert.ok(b.maxZoom >= 18));
});

test('capas de referencia: calles y nombres para ponerlos sobre el satélite', () => {
  assert.equal(Mapa.REFERENCE.length, 2);
  Mapa.REFERENCE.forEach((r) => assert.match(r.url, /^https:\/\/server\.arcgisonline\.com\/.*Reference.*\/\{z\}\/\{y\}\/\{x\}$/));
});

test('baseId: solo acepta capas conocidas; lo demás vuelve a «calles»', () => {
  assert.equal(Mapa.baseId('satelite'), 'satelite');
  assert.equal(Mapa.baseId('calles'), 'calles');
  for (const mala of ['', 'toString', '__proto__', 'hibrido', null, undefined, 5, {}]) assert.equal(Mapa.baseId(mala), 'calles', String(mala));
});

test('pointLabel: nombre y altitud; sin altitud solo el nombre', () => {
  assert.equal(Mapa.pointLabel({ name: 'P3', alt: 386.4 }), 'P3 · 386 m');
  assert.equal(Mapa.pointLabel({ name: 'P3', alt: 386.6 }), 'P3 · 387 m');
  assert.equal(Mapa.pointLabel({ name: 'P3', alt: null }), 'P3');
  assert.equal(Mapa.pointLabel({ name: 'P3' }), 'P3');
  assert.equal(Mapa.pointLabel({ alt: 12 }), '12 m');
  assert.equal(Mapa.pointLabel({ name: 'A', alt: 1234 }, (n) => String(n).replace(/(\d)(\d{3})$/, '$1.$2')), 'A · 1.234 m');
  assert.equal(Mapa.pointLabel(null), '');
  assert.equal(Mapa.pointLabel({ name: 'Z', alt: NaN }), 'Z');
});

test('lastPoint: el de fecha más reciente; sin fechas, el último de la lista', () => {
  assert.equal(Mapa.lastPoint([]), null);
  assert.equal(Mapa.lastPoint(null), null);
  assert.equal(Mapa.lastPoint([P('A', 1, 1, { ts: 10 }), P('B', 2, 2, { ts: 30 }), P('C', 3, 3, { ts: 20 })]).name, 'B');
  assert.equal(Mapa.lastPoint([P('A', 1, 1), P('B', 2, 2), P('C', 3, 3)]).name, 'C');
  assert.equal(Mapa.lastPoint([P('A', 1, 1, { ts: 5 }), P('B', 2, 2)]).name, 'A', 'un punto con fecha gana a uno sin fecha (no se sabe cuándo se marcó)');
  assert.equal(Mapa.lastPoint([P('A', 1, 1), P('B', 2, 2, { ts: 5 })]).name, 'B');
  assert.equal(Mapa.lastPoint([P('A', 1, 1, { ts: 7 }), P('B', 2, 2, { ts: 7 })]).name, 'B', 'con la misma fecha, el último de la lista');
  assert.equal(Mapa.lastPoint([P('A', 1, 1, { ts: 5 }), P('X', 999, 1, { ts: 99 })]).name, 'A', 'ignora puntos con coordenadas imposibles');
  assert.equal(Mapa.lastPoint([P('X', NaN, 1)]), null);
});

test('visibleLayers: solo capas visibles y con algún punto válido', () => {
  const L = [
    { id: 'a', points: [P('1', 1, 1)] },
    { id: 'b', visible: false, points: [P('1', 1, 1)] },
    { id: 'c', visible: true, points: [] },
    { id: 'd', points: [P('x', 200, 0)] },
    { id: 'e', points: 'no es lista' },
    null
  ];
  assert.deepEqual(Mapa.visibleLayers(L).map((l) => l.id), ['a']);
  assert.deepEqual(Mapa.visibleLayers(undefined), []);
});

test('extent: cuadro que contiene los puntos y las capas visibles', () => {
  assert.equal(Mapa.extent([], []), null);
  assert.equal(Mapa.extent(null, null), null);
  assert.deepEqual(Mapa.extent([P('A', 4.9, -74.5), P('B', 4.95, -74.4)], []), { south: 4.9, west: -74.5, north: 4.95, east: -74.4 });
  const capas = [{ id: 'x', points: [P('1', 5.2, -74.0)] }, { id: 'y', visible: false, points: [P('1', 9, -70)] }];
  assert.deepEqual(Mapa.extent([P('A', 4.9, -74.5)], capas), { south: 4.9, west: -74.5, north: 5.2, east: -74 });
  assert.deepEqual(Mapa.extent([], capas), { south: 5.2, west: -74, north: 5.2, east: -74 }, 'una capa sola también cuenta');
  assert.equal(Mapa.extent([P('A', 95, 0), P('B', 0, 181), P('C', NaN, 0)], []), null, 'ignora coordenadas imposibles');
});

test('shapes: 3 o más puntos forman un polígono cerrado; 2, una línea; menos, nada', () => {
  const tres = { mainColor: '#112233', points: [P('P1', 4.9, -74.5, { alt: 100 }), P('P2', 4.9, -74.4), P('P3', 4.95, -74.45, { alt: 120.4 })] };
  const s = Mapa.shapes(tres);
  assert.equal(s.color, '#112233');
  assert.deepEqual(s.polygon, { latlngs: [[4.9, -74.5], [4.9, -74.4], [4.95, -74.45]], closed: true, bad: false });
  assert.deepEqual(s.points.map((m) => m.label), ['P1 · 100 m', 'P2', 'P3 · 120 m']);
  assert.ok(s.points.every((m) => m.color === '#112233'));
  assert.equal(Mapa.shapes({ points: tres.points.slice(0, 2) }).polygon.closed, false);
  assert.equal(Mapa.shapes({ points: tres.points.slice(0, 1) }).polygon, null);
  assert.equal(Mapa.shapes({ points: [] }).polygon, null);
  assert.equal(Mapa.shapes({}).color, '#2F8F4E', 'color por defecto del proyecto');
  assert.equal(Mapa.shapes(null).points.length, 0);
});

test('shapes: «Polígono activo» apagado deja los puntos pero no los une', () => {
  const p = { points: [P('P1', 1, 1), P('P2', 1, 2), P('P3', 2, 2)] };
  const off = Mapa.shapes(p, { polyActive: false });
  assert.equal(off.polygon, null);
  assert.equal(off.points.length, 3);
  assert.ok(Mapa.shapes(p, { polyActive: true }).polygon);
  assert.ok(Mapa.shapes(p, {}).polygon, 'por defecto está activo');
});

test('shapes: lados que se cruzan se marcan; los puntos sin nombre reciben «P#»', () => {
  const p = { points: [P('', 1, 1), P(undefined, 2, 2), P('', 1, 2), P('', 2, 1)] };
  const s = Mapa.shapes(p, { bad: true });
  assert.equal(s.polygon.bad, true);
  assert.deepEqual(s.points.map((m) => m.name), ['P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(s.points.map((m) => m.label), ['P1', 'P2', 'P3', 'P4']);
});

test('shapes: los puntos con coordenadas imposibles no se dibujan ni cuentan para el polígono', () => {
  const p = { points: [P('A', 1, 1), P('B', 'x', 2), P('C', 1, 2), P('D', 2, 2), P('E', 91, 0)] };
  const s = Mapa.shapes(p);
  assert.equal(s.points.length, 3);
  assert.equal(s.polygon.latlngs.length, 3);
});

test('shapes: capas importadas con su color y su tipo (puntos, línea, polígono con huecos)', () => {
  const sq = (k) => [P('1', k, k), P('2', k, k + 1), P('3', k + 1, k + 1), P('4', k + 1, k)];
  const p = {
    points: [],
    layers: [
      { id: 'pol', name: 'Lote', kind: 'polygon', color: '#FF0000', points: sq(0), holes: [sq(0.2).slice(0, 3).map((q) => q), [P('a', 0, 0)]] },
      { id: 'lin', kind: 'line', color: '#00FF00', points: sq(5).slice(0, 2) },
      { id: 'pts', name: 'Árboles', kind: 'point', points: sq(8) },
      { id: 'otro', kind: 'raro', color: '#0000FF', points: sq(9).slice(0, 1) },
      { id: 'oculta', visible: false, kind: 'line', points: sq(7) }
    ]
  };
  const s = Mapa.shapes(p);
  assert.deepEqual(s.layers.map((l) => l.id), ['pol', 'lin', 'pts', 'otro']);
  assert.deepEqual(s.layers.map((l) => l.kind), ['polygon', 'line', 'points', 'points']);
  assert.equal(s.layers[0].color, '#FF0000');
  assert.equal(s.layers[0].holes.length, 1, 'un hueco con menos de 3 vértices se descarta');
  assert.equal(s.layers[2].color, '#2980B9', 'color por defecto de las capas');
  assert.equal(s.layers[0].latlngs.length, 4);
  assert.equal(s.layers[1].name, '');
});

test('shapes: los huecos solo se usan en capas de tipo polígono y deben ser una lista', () => {
  const sq = [P('1', 0, 0), P('2', 0, 1), P('3', 1, 1)];
  const s = Mapa.shapes({ layers: [{ id: 'a', kind: 'polygon', points: sq, holes: 'no' }, { id: 'b', kind: 'line', points: sq, holes: [sq] }] });
  assert.deepEqual(s.layers[0].holes, []);
  assert.deepEqual(s.layers[1].holes, []);
});

test('labelsVisible: los nombres aparecen solo con suficiente zoom', () => {
  assert.equal(Mapa.labelsVisible(Mapa.LABEL_MIN_ZOOM - 1), false);
  assert.equal(Mapa.labelsVisible(Mapa.LABEL_MIN_ZOOM), true);
  assert.equal(Mapa.labelsVisible(19), true);
  assert.equal(Mapa.labelsVisible(NaN), false);
  assert.equal(Mapa.labelsVisible(undefined), false);
});

test('tileNotice: avisa sin conexión o cuando fallan varios mosaicos; si todo va bien, calla', () => {
  assert.equal(Mapa.tileNotice({ online: true, errors: 0 }), '');
  assert.equal(Mapa.tileNotice({ online: true, errors: Mapa.TILE_ERRORS_BEFORE_NOTICE - 1 }), '');
  assert.match(Mapa.tileNotice({ online: true, errors: Mapa.TILE_ERRORS_BEFORE_NOTICE }), /no está cargando/);
  assert.match(Mapa.tileNotice({ online: false, errors: 0 }), /Sin conexión/);
  assert.match(Mapa.tileNotice({ online: false, errors: 9 }), /Tus puntos y el polígono se ven igual/);
  assert.equal(Mapa.tileNotice(), '');
  assert.equal(Mapa.tileNotice({}), '');
});

test('fixShape: posición del GPS lista para dibujar', () => {
  assert.deepEqual(Mapa.fixShape({ lat: 4.9, lon: -74.4, acc: 6.5 }), { lat: 4.9, lon: -74.4, acc: 6.5 });
  assert.deepEqual(Mapa.fixShape({ lat: 4.9, lon: -74.4 }), { lat: 4.9, lon: -74.4, acc: null });
  assert.equal(Mapa.fixShape({ lat: 4.9, lon: -74.4, acc: 0 }).acc, null);
  assert.equal(Mapa.fixShape({ lat: 4.9, lon: -74.4, acc: -3 }).acc, null);
  assert.equal(Mapa.fixShape({ lat: 4.9, lon: -74.4, acc: NaN }).acc, null);
  for (const mala of [null, undefined, {}, { lat: 100, lon: 0 }, { lat: 0, lon: 190 }, { lat: '4', lon: 5 }]) assert.equal(Mapa.fixShape(mala), null);
});

test('vista inicial: Colombia, a una escala que muestra todo el país', () => {
  assert.ok(Mapa.COLOMBIA.lat > -5 && Mapa.COLOMBIA.lat < 14);
  assert.ok(Mapa.COLOMBIA.lon > -80 && Mapa.COLOMBIA.lon < -66);
  assert.ok(Mapa.COLOMBIA.zoom >= 4 && Mapa.COLOMBIA.zoom <= 6);
});

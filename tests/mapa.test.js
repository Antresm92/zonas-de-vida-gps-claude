'use strict';
/* mapa.js — lo que se puede comprobar del mapa sin pantalla: capas, qué se dibuja, avisos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Mapa = require('../www/js/mapa.js');

const P = (name, lat, lon, extra) => Object.assign({ id: 'id-' + name, name, lat, lon }, extra || {});

test('capas base: calles (OpenStreetMap), satélite (Esri) y topográfico (OpenTopoMap), cada una con su atribución', () => {
  assert.deepEqual(Object.keys(Mapa.BASES).sort(), ['calles', 'satelite', 'topo']);
  assert.match(Mapa.BASES.calles.url, /^https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  assert.match(Mapa.BASES.satelite.url, /^https:\/\/server\.arcgisonline\.com\/.*World_Imagery.*\/\{z\}\/\{y\}\/\{x\}$/);
  assert.match(Mapa.BASES.topo.url, /^https:\/\/tile\.opentopomap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  assert.match(Mapa.BASES.calles.attribution, /OpenStreetMap/);
  assert.match(Mapa.BASES.satelite.attribution, /Esri/);
  assert.match(Mapa.BASES.topo.attribution, /OpenStreetMap.*SRTM.*OpenTopoMap.*CC-BY-SA/);
  Object.values(Mapa.BASES).forEach((b) => {
    assert.equal(b.label.length > 0, true);
    assert.equal(b.id, Object.keys(Mapa.BASES).find((k) => Mapa.BASES[k] === b));
    for (const a of b.attribution.match(/<a [^>]*>/g) || []) assert.ok(a.includes('rel="noopener noreferrer"') && a.includes('target="_blank"'), 'los enlaces no deben abrirse dentro de la app: ' + a);
    assert.ok(b.maxZoom >= 18);
  });
  // OpenTopoMap solo tiene mosaicos hasta el nivel 17: con más zoom se amplía el último en vez de pedir mosaicos que no existen
  assert.equal(Mapa.BASES.topo.maxNativeZoom, 17);
  assert.ok(Mapa.BASES.topo.maxZoom > Mapa.BASES.topo.maxNativeZoom);
});

test('capas de referencia: calles y nombres para ponerlos sobre el satélite', () => {
  assert.equal(Mapa.REFERENCE.length, 2);
  Mapa.REFERENCE.forEach((r) => assert.match(r.url, /^https:\/\/server\.arcgisonline\.com\/.*Reference.*\/\{z\}\/\{y\}\/\{x\}$/));
});

test('baseId: solo acepta capas conocidas; lo demás vuelve a «calles»', () => {
  assert.equal(Mapa.baseId('satelite'), 'satelite');
  assert.equal(Mapa.baseId('topo'), 'topo');
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

/* ---------- Menú ⋮ del mapa: modos y gestos ---------- */
test('modos: solo uno activo a la vez; tocar el activo lo apaga; lo desconocido apaga todo', () => {
  assert.deepEqual(Mapa.MODES, ['add', 'move']);
  assert.equal(Mapa.toggleMode('', 'add'), 'add');
  assert.equal(Mapa.toggleMode('', 'move'), 'move');
  assert.equal(Mapa.toggleMode('add', 'add'), '');
  assert.equal(Mapa.toggleMode('move', 'move'), '');
  assert.equal(Mapa.toggleMode('add', 'move'), 'move');   // al activar la otra, la primera se apaga
  assert.equal(Mapa.toggleMode('move', 'add'), 'add');
  for (const raro of [undefined, null, '', 'otro', 5, {}]) {
    assert.equal(Mapa.toggleMode('add', raro), '');
    assert.equal(Mapa.toggleMode(raro, 'move'), 'move');
    assert.equal(Mapa.modeId(raro), '');
  }
});

test('tiempo para mantener pulsado: 1 s por defecto; solo 1, 1,5 y 2 s; el texto lo dice en palabras', () => {
  assert.equal(Mapa.HOLD_MS, 1000);
  assert.deepEqual(Mapa.HOLD_CHOICES, [1000, 1500, 2000]);
  assert.equal(Mapa.holdMs(1500), 1500);
  for (const raro of [undefined, null, 0, 300, 5000, '1000', NaN]) assert.equal(Mapa.holdMs(raro), 1000);
  assert.equal(Mapa.holdLabel(1000), '1 segundo');
  assert.equal(Mapa.holdLabel(1500), '1,5 segundos');
  assert.equal(Mapa.holdLabel(2000), '2 segundos');
  assert.equal(Mapa.holdLabel('x'), '1 segundo');
});

test('texto del aviso de cada modo; sin modo no hay aviso', () => {
  assert.equal(Mapa.modeText('add'), 'Ingresar puntos: toca el mapa.');
  assert.equal(Mapa.modeText('move'), 'Posición manual: mantén pulsado un punto 1 s.');
  assert.equal(Mapa.modeText('move', 1500), 'Posición manual: mantén pulsado un punto 1,5 s.');
  assert.equal(Mapa.modeText('move', 2000), 'Posición manual: mantén pulsado un punto 2 s.');
  assert.equal(Mapa.modeText('move', 123), 'Posición manual: mantén pulsado un punto 1 s.', 'un tiempo inválido vuelve a 1 s');
  assert.ok(Mapa.modeText('move').length <= 50 && Mapa.modeText('add').length <= 50, 'el aviso es corto: no tapa el mapa');
  assert.equal(Mapa.modeText(''), '');
  assert.equal(Mapa.modeText('otro'), '');
});

test('toque repetido: muy seguido y casi en el mismo sitio; con tiempo o distancia de más ya no lo es', () => {
  const t = (x, y, ms) => ({ x, y, t: ms });
  assert.equal(Mapa.isRepeatTap(t(10, 10, 0), t(12, 11, 200)), true);
  assert.equal(Mapa.isRepeatTap(t(10, 10, 0), t(10, 10, Mapa.DOUBLE_TAP_MS)), true);          // justo en el límite
  assert.equal(Mapa.isRepeatTap(t(10, 10, 0), t(10, 10, Mapa.DOUBLE_TAP_MS + 1)), false);
  assert.equal(Mapa.isRepeatTap(t(0, 0, 0), t(Mapa.DOUBLE_TAP_SLOP_PX, 0, 100)), true);
  assert.equal(Mapa.isRepeatTap(t(0, 0, 0), t(Mapa.DOUBLE_TAP_SLOP_PX + 1, 0, 100)), false);
  assert.equal(Mapa.isRepeatTap(null, t(0, 0, 0)), false);
  assert.equal(Mapa.isRepeatTap(t(0, 0, 0), undefined), false);
});

test('withMoved: cambia solo las coordenadas del punto indicado, sin tocar la lista original', () => {
  const pts = [P('A', 4, -74), P('B', 4.1, -74.1), P('C', 4.2, -74.2)];
  const out = Mapa.withMoved(pts, 'id-B', 5, -75);
  assert.deepEqual(out.map((p) => [p.name, p.lat, p.lon]), [['A', 4, -74], ['B', 5, -75], ['C', 4.2, -74.2]]);
  assert.equal(pts[1].lat, 4.1);                        // el original queda igual
  assert.notEqual(out[1], pts[1]);
  assert.equal(out[0], pts[0]);                         // los demás son los mismos objetos
  assert.deepEqual(Mapa.withMoved(pts, 'no-existe', 1, 1), pts);
  assert.deepEqual(Mapa.withMoved(undefined, 'x', 1, 1), []);
  assert.deepEqual(Mapa.withMoved([null, P('A', 1, 1)], 'id-A', 2, 2).map((p) => p && p.lat), [null, 2]);
});

/* Reloj y avisos falsos para probar los gestos sin pantalla */
function gestoDePrueba(extra) {
  const r = { now: 0, timers: [], eventos: [] };
  const g = Mapa.pointGesture(Object.assign({
    holdMs: 1000,
    setTimer: (fn, ms) => { const t = { fn, at: r.now + ms, on: true }; r.timers.push(t); return t; },
    clearTimer: (t) => { t.on = false; },
    now: () => r.now,
    onHold: (id, x, y) => r.eventos.push(['hold', id, x, y]),
    onMove: (id, x, y) => r.eventos.push(['move', id, x, y]),
    onDrop: (id, x, y, moved) => r.eventos.push(['drop', id, x, y, moved]),
    onAbort: (id) => r.eventos.push(['abort', id]),
    onDouble: (id) => r.eventos.push(['double', id])
  }, extra || {}));
  r.avanzar = (ms) => { r.now += ms; r.timers.filter((t) => t.on && t.at <= r.now).forEach((t) => { t.on = false; t.fn(); }); };
  r.g = g;
  return r;
}

test('gesto: mantener pulsado 1 s levanta el punto; arrastrar avisa cada movimiento; soltar lo deja caer', () => {
  const r = gestoDePrueba();
  r.g.down('A', 100, 100);
  assert.equal(r.g.state(), 'press');
  r.avanzar(999);
  assert.deepEqual(r.eventos, []);                      // todavía no
  r.g.move(103, 102);                                   // un temblor dentro del margen no lo cancela
  r.avanzar(1);
  assert.deepEqual(r.eventos, [['hold', 'A', 103, 102]]);
  assert.equal(r.g.state(), 'lifted');
  r.g.move(150, 140); r.g.move(160, 150);
  r.g.up(160, 150);
  assert.deepEqual(r.eventos.slice(1), [['move', 'A', 150, 140], ['move', 'A', 160, 150], ['drop', 'A', 160, 150, true]]);
  assert.equal(r.g.state(), '');
});

test('gesto: levantar y soltar sin mover avisa «soltado» sin movimiento', () => {
  const r = gestoDePrueba();
  r.g.down('A', 5, 5); r.avanzar(1000); r.g.up(5, 5);
  assert.deepEqual(r.eventos, [['hold', 'A', 5, 5], ['drop', 'A', 5, 5, false]]);
});

test('gesto: moverse más de 10 px antes del tiempo lo abandona (era un arrastre del mapa) y nada se dispara', () => {
  const r = gestoDePrueba();
  r.g.down('A', 100, 100);
  r.g.move(100 + Mapa.HOLD_SLOP_PX, 100);               // justo en el margen: sigue
  assert.equal(r.g.state(), 'press');
  r.g.move(100 + Mapa.HOLD_SLOP_PX + 1, 100);           // se pasó
  assert.equal(r.g.state(), '');
  r.avanzar(5000);
  r.g.move(300, 300); r.g.up(300, 300);
  assert.deepEqual(r.eventos, []);
  assert.equal(r.timers[0].on, false, 'el reloj quedó apagado');
});

test('gesto: soltar antes del tiempo es un toque; dos toques seguidos al mismo punto abren la ficha', () => {
  const r = gestoDePrueba();
  r.g.down('A', 50, 50); r.avanzar(80); r.g.up(50, 50);
  assert.deepEqual(r.eventos, []);                      // un toque solo no hace nada
  r.avanzar(150);
  r.g.down('A', 52, 51); r.avanzar(60); r.g.up(52, 51);
  assert.deepEqual(r.eventos, [['double', 'A']]);
  assert.equal(r.timers.every((t) => !t.on), true, 'ningún reloj queda pendiente');
  // un tercer toque no es otro doble: hace falta pareja nueva
  r.avanzar(100); r.g.down('A', 52, 51); r.avanzar(30); r.g.up(52, 51);
  assert.equal(r.eventos.length, 1);
  r.avanzar(100); r.g.down('A', 52, 51); r.avanzar(30); r.g.up(52, 51);
  assert.deepEqual(r.eventos, [['double', 'A'], ['double', 'A']]);
});

test('gesto: no es doble toque si pasó mucho tiempo, si son puntos distintos o si el segundo toque cae lejos', () => {
  let r = gestoDePrueba();
  r.g.down('A', 50, 50); r.avanzar(50); r.g.up(50, 50);
  r.avanzar(Mapa.DOUBLE_TAP_MS + 10);
  r.g.down('A', 50, 50); r.avanzar(50); r.g.up(50, 50);
  assert.deepEqual(r.eventos, []);

  r = gestoDePrueba();
  r.g.down('A', 50, 50); r.avanzar(50); r.g.up(50, 50);
  r.g.down('B', 50, 50); r.avanzar(50); r.g.up(50, 50);   // otro punto
  assert.deepEqual(r.eventos, []);

  r = gestoDePrueba();
  r.g.down('A', 50, 50); r.avanzar(50); r.g.up(50, 50);
  r.g.down('A', 50 + Mapa.DOUBLE_TAP_SLOP_PX + 5, 50); r.avanzar(50); r.g.up(50 + Mapa.DOUBLE_TAP_SLOP_PX + 5, 50);
  assert.deepEqual(r.eventos, []);
});

test('gesto: un arrastre o una espera larga entre dos toques cancela la pareja', () => {
  const r = gestoDePrueba();
  r.g.down('A', 50, 50); r.avanzar(50); r.g.up(50, 50);          // primer toque
  r.g.down('A', 50, 50); r.avanzar(1000); r.g.move(70, 70); r.g.up(70, 70);   // lo levantó y lo movió
  r.g.down('A', 50, 50); r.avanzar(40); r.g.up(50, 50);          // este toque ya no forma pareja con el primero
  assert.deepEqual(r.eventos.filter((e) => e[0] === 'double'), []);
});

test('gesto: cancelar (cambio de modo, interrupción del sistema) suelta lo levantado con aviso y apaga el reloj', () => {
  let r = gestoDePrueba();
  r.g.down('A', 5, 5); r.avanzar(1000); r.g.move(9, 9);
  r.g.cancel();
  assert.deepEqual(r.eventos.slice(-1), [['abort', 'A']]);
  assert.equal(r.g.state(), '');
  r.g.move(50, 50); r.g.up(50, 50);                              // ya no hay nada en curso
  assert.equal(r.eventos.length, 3);

  r = gestoDePrueba();
  r.g.down('A', 5, 5);                                           // todavía sin levantar
  r.g.cancel();
  r.avanzar(5000);
  assert.deepEqual(r.eventos, []);                               // el reloj no llegó a dispararse
  r.g.cancel();                                                  // cancelar sin nada en curso no falla
});

test('gesto: un segundo dedo (otro down mientras hay uno en curso) se ignora; moves y ups sin down no hacen nada', () => {
  const r = gestoDePrueba();
  r.g.move(1, 1); r.g.up(1, 1);
  r.g.down('A', 5, 5);
  r.g.down('B', 90, 90);                                         // ignorado
  r.avanzar(1000);
  assert.deepEqual(r.eventos, [['hold', 'A', 5, 5]]);
  assert.equal(r.timers.length, 1);
});

test('gesto: el tiempo que se pide es el elegido (1,5 s) y uno inválido vuelve a 1 s', () => {
  let r = gestoDePrueba({ holdMs: 1500 });
  r.g.down('A', 0, 0); r.avanzar(1499); assert.deepEqual(r.eventos, []); r.avanzar(1);
  assert.equal(r.eventos.length, 1);
  r = gestoDePrueba({ holdMs: 42 });
  r.g.down('A', 0, 0); r.avanzar(999); assert.deepEqual(r.eventos, []); r.avanzar(1);
  assert.equal(r.eventos.length, 1);
});

test('color de un punto: el suyo si es #RRGGBB; si no, el de los puntos del proyecto', () => {
  assert.equal(Mapa.pointColor({ color: '#1abc9c' }, '#2F8F4E'), '#1abc9c');
  assert.equal(Mapa.pointColor({ color: '#ABCDEF' }, '#2F8F4E'), '#ABCDEF');
  for (const c of ['rojo', '#FFF', '#12345G', '', 7, null, undefined, {}]) assert.equal(Mapa.pointColor({ color: c }, '#2F8F4E'), '#2F8F4E', String(c));
  assert.equal(Mapa.pointColor(null, '#2F8F4E'), '#2F8F4E');
  assert.equal(Mapa.pointColor(undefined, '#2F8F4E'), '#2F8F4E');
});

test('shapes: cada punto se dibuja con su color propio y los demás con el del proyecto', () => {
  const proj = { mainColor: '#2F8F4E', points: [P('A', 4.6, -74.1, { color: '#C0392B' }), P('B', 4.6, -74.09), P('C', 4.61, -74.09, { color: 'nada' })], layers: [] };
  const s = Mapa.shapes(proj);
  assert.deepEqual(s.points.map((q) => q.color), ['#C0392B', '#2F8F4E', '#2F8F4E']);
  assert.equal(s.color, '#2F8F4E', 'el color del polígono sigue siendo el del proyecto');
});

test('el tiempo para levantar un punto que guarda la app y el que entiende el mapa son los mismos', () => {
  const Store = require('../www/js/store.js');
  assert.deepEqual(Store.HOLD_MS, Mapa.HOLD_CHOICES);
  assert.equal(Store.defaultState().settings.holdMs, Mapa.HOLD_MS);
});

test('tolerancia del toque: más que los 3 px que trae Leaflet, para un dedo, y menos que lo que mueve un arrastre de verdad', () => {
  assert.ok(Mapa.TAP_SLOP_PX > 3 && Mapa.TAP_SLOP_PX <= Mapa.HOLD_SLOP_PX);
});

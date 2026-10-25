'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Diagram = require('../www/js/diagram.js');
const H = require('../www/js/holdridge.js');

const SQUARE = [{ name: 'A', lat: 4.600, lon: -74.100 }, { name: 'B', lat: 4.600, lon: -74.098 }, { name: 'C', lat: 4.602, lon: -74.098 }, { name: 'D', lat: 4.602, lon: -74.100 }];
const count = (s, re) => (s.match(re) || []).length;

test('polygonSVG: sin puntos devuelve un lienzo vacío', () => {
  const s = Diagram.polygonSVG([]);
  assert.match(s, /^<svg [^>]*viewBox="0 0 360 300"><\/svg>$/);
  assert.equal(Diagram.polygonSVG([{ lat: NaN, lon: 1 }]).includes('<path'), false);
});

test('polygonSVG: polígono con vértices, nombres, medidas de lado, escala, norte y centro', () => {
  const s = Diagram.polygonSVG(SQUARE, { center: { lat: 4.601, lon: -74.099 } });
  assert.match(s, /role="img" aria-label="Plano del polígono"/);
  assert.equal(count(s, / Z" fill="rgba/g), 1);                          // un solo polígono cerrado
  ['A', 'B', 'C', 'D'].forEach((n) => assert.ok(s.includes('>' + n + '</text>'), 'falta ' + n));
  assert.equal(count(s, /\d+ m<\/text>/g), 4 + 1);                       // 4 lados + barra de escala
  assert.match(s, />N<\/text>/);
  assert.match(s, /r="9" fill="none"/);                                  // anillo del centro
  assert.ok(s.includes('rgba(47,143,78,0.2)'));                          // relleno verde por defecto
});

test('polygonSVG: color propio, avisos de lados cruzados, dos puntos y rótulos opcionales', () => {
  const rojo = Diagram.polygonSVG(SQUARE, { bad: true, color: '#112233' });
  assert.ok(rojo.includes('rgba(216,53,60,0.14)'));
  assert.ok(rojo.includes('stroke="#D8353C"'));
  const azul = Diagram.polygonSVG(SQUARE, { color: '#112233', sideLabels: false, svgWidth: 300 });
  assert.ok(azul.includes('rgba(17,34,51,0.2)'));
  assert.ok(azul.includes('width="300"'));
  assert.equal(count(azul, /\d+ m<\/text>/g), 1);                        // solo la barra de escala
  const linea = Diagram.polygonSVG(SQUARE.slice(0, 2), { center: { lat: 4.6, lon: -74.099 } });
  assert.equal(count(linea, / Z" fill="rgba/g), 0);
  assert.match(linea, /fill="none" stroke="#2F8F4E" stroke-width="2.4"/);
  assert.equal(count(linea, /\d+ m<\/text>/g), 1 + 1);                   // 1 lado + escala
  const color_malo = Diagram.polygonSVG(SQUARE, { color: 'verde' });
  assert.ok(color_malo.includes('rgba(47,143,78,0.2)'));                 // un color no válido vuelve al verde
});

test('polygonSVG: lados en kilómetros y sin nombres con muchos puntos', () => {
  const largo = [{ lat: 4.0, lon: -74.0 }, { lat: 4.0, lon: -73.9 }, { lat: 4.1, lon: -73.9 }];
  assert.match(Diagram.polygonSVG(largo), /\d+,\d\d km<\/text>/);
  const muchos = [];
  for (let i = 0; i < 45; i++) muchos.push({ lat: 4.6 + 0.001 * Math.cos(i / 45 * 6.2832), lon: -74.1 + 0.001 * Math.sin(i / 45 * 6.2832) });
  const s = Diagram.polygonSVG(muchos);
  assert.equal(count(s, />P\d+<\/text>/g), 0);                           // sin rótulos de punto
  assert.equal(count(s, /<circle/g), 45);
});

test('polygonSVG: capas importadas (polígono con huecos, línea, puntos y ocultas)', () => {
  const cuad = (la, lo, d) => [{ lat: la, lon: lo }, { lat: la, lon: lo + d }, { lat: la + d, lon: lo + d }, { lat: la + d, lon: lo }];
  const layers = [
    { kind: 'polygon', color: '#E67E22', visible: true, points: cuad(4.6, -74.095, 0.004), holes: [cuad(4.601, -74.094, 0.001), [{ lat: 1, lon: 1 }]] },
    { kind: 'line', color: '#8E44AD', points: [{ lat: 4.6, lon: -74.1 }, { lat: 4.61, lon: -74.09 }] },
    { kind: 'polygon', color: '#2980B9', points: [{ lat: 4.6, lon: -74.1 }, { lat: 4.61, lon: -74.09 }] },   // «polígono» de 2 puntos: se dibuja como línea
    { kind: 'points', color: '#C0392B', points: [{ lat: 4.605, lon: -74.1 }, { lat: 4.606, lon: -74.1 }, { lat: NaN, lon: 0 }] },
    { kind: 'polygon', color: '#34495E', visible: false, points: cuad(4.7, -74.0, 0.01) },
    null, { kind: 'points', color: '#000000', points: [] }
  ];
  const s = Diagram.polygonSVG(SQUARE, { layers });
  assert.match(s, /fill-rule="evenodd" fill="rgba\(230,126,34,0.2\)"/);
  assert.equal(count(s, /stroke-dasharray="6 4"/g), 2);                 // la línea y el «polígono» de 2 puntos
  assert.equal(count(s, /r="4.5" fill="#C0392B"/g), 2);                 // 2 puntos válidos
  assert.equal(s.includes('#34495E'), false);                           // la capa oculta no se dibuja
  const solo = Diagram.polygonSVG([], { layers: [layers[3]] });          // solo capas, sin puntos propios
  assert.equal(count(solo, /r="4.5"/g), 2);
  assert.equal(Diagram.polygonSVG([], { layers: [layers[4]] }), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 300"></svg>');
});

test('legendHTML: solo aparece cuando hay al menos dos colores y escapa los nombres', () => {
  const capa = { name: 'Lote <1>', color: '#E67E22', points: [{ lat: 1, lon: 1 }] };
  assert.equal(Diagram.legendHTML([], '#2F8F4E', 'Mis puntos', true), '');
  assert.equal(Diagram.legendHTML([capa], '#2F8F4E', 'Mis puntos', false), '');
  const l = Diagram.legendHTML([capa, { name: 'Oculta', color: '#000000', visible: false, points: [{ lat: 1, lon: 1 }] }, { name: 'Vacía', color: '#111111', points: [] }, null], '#2F8F4E', 'Finca', true);
  assert.match(l, /^<ul class="legend"/);
  assert.equal(count(l, /<li>/g), 2);
  assert.ok(l.includes('Lote &lt;1&gt;') && l.includes('Finca') && l.includes('#E67E22'));
  assert.ok(Diagram.legendHTML([capa], undefined, undefined, true).includes('Mis puntos'));
});

test('staticSVG: diagrama completo con y sin punto de análisis', () => {
  const sin = Diagram.staticSVG();
  assert.match(sin, /^<svg [^>]*aria-label="Diagrama bioclimático de Holdridge"/);
  assert.ok(sin.includes('width="1100"'));
  const r = H.classify({ T: 14, P: 1100 });
  const con = Diagram.staticSVG({ hex: r.hex, point: r.point, vertices: [{ point: r.point, name: 'P1' }], width: 800 });
  assert.ok(con.includes('width="800"'));
  assert.ok(con.length > sin.length);
  assert.equal(con.includes('NaN'), false);
  assert.equal(sin.includes('undefined'), false);
  assert.ok(Diagram.worldMarkup({}).length > 1000);
  assert.equal(typeof Diagram.S, 'number'); assert.ok(Diagram.COL.hex);
});

/* ---------- Versión interactiva con un DOM de mentira ---------- */
function fakeNode() {
  const listeners = {};
  const n = { children: [], style: {}, attrs: {}, clientWidth: 400, clientHeight: 300, _html: '',
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    emit(t, ev) { (listeners[t] || []).forEach((f) => f(ev)); },
    setPointerCapture() { this.captured = true; }, getBoundingClientRect() { return { left: 10, top: 20, width: 400, height: 300 }; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; } };
  return n;
}
function mountFake() {
  globalThis.document = { createElementNS: () => fakeNode() };
  const el = fakeNode();
  const view = Diagram.mount(el, {});
  return { el, view, svg: el.children[0], world: el.children[0].children[0], overlay: el.children[0].children[1] };
}
const ev = (o) => Object.assign({ pointerId: 1, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; } }, o);

test('mount: arma el SVG, dibuja el diagrama y las franjas de temperatura', () => {
  const { view, svg, world, overlay } = mountFake();
  assert.equal(svg.attrs.role, 'img');
  assert.match(svg.attrs['aria-label'], /Diagrama de Holdridge/);
  view.setData({});                                                       // sin punto: ve el diagrama completo
  assert.ok(world.innerHTML.length > 1000);
  assert.match(overlay.innerHTML, /°C<\/text>/);
  assert.match(overlay.innerHTML, /Tropical|Subtropical/);
  const r = H.classify({ T: 14, P: 1100 });
  view.setData({ point: r.point, hex: r.hex });
  const afterFocus = { s: view.state.s, tx: view.state.tx, ty: view.state.ty };
  view.fit();
  assert.notDeepEqual({ s: view.state.s, tx: view.state.tx, ty: view.state.ty }, afterFocus);
  view.focusPoint();
  assert.deepEqual({ s: view.state.s, tx: view.state.tx, ty: view.state.ty }, afterFocus);
  view.setData(null);
  view.focusPoint();                                                      // sin punto: vuelve a ver todo
});

test('mount: zoom con botones y rueda, con límites', () => {
  const { view, svg } = mountFake();
  view.fit();
  const s0 = view.state.s;
  view.zoomIn(); assert.ok(view.state.s > s0);
  view.zoomOut(); view.zoomOut(); assert.ok(view.state.s < s0);
  for (let i = 0; i < 30; i++) view.zoomIn();
  assert.ok(view.state.s <= 2.6 + 1e-9);
  for (let i = 0; i < 60; i++) view.zoomOut();
  assert.ok(view.state.s >= 0.2 - 1e-9);
  const e = ev({ clientX: 200, clientY: 150, deltaY: -100 });
  const s1 = view.state.s;
  svg.emit('wheel', e); assert.ok(e.prevented); assert.ok(view.state.s > s1);
  const s2 = view.state.s;
  svg.emit('wheel', ev({ clientX: 200, clientY: 150, deltaY: 100 })); assert.ok(view.state.s < s2);
});

test('mount: arrastrar con un dedo mueve la vista y no deja perder el diagrama', () => {
  const { view, svg } = mountFake();
  view.fit();
  svg.emit('pointermove', ev({ clientX: 5, clientY: 5 }));                // sin tocar antes: se ignora
  const tx0 = view.state.tx;
  svg.emit('pointerdown', ev({ clientX: 100, clientY: 100 })); assert.ok(svg.captured);
  svg.emit('pointermove', ev({ clientX: 140, clientY: 130 }));
  assert.ok(Math.abs(view.state.tx - (tx0 + 40)) < 1e-6, 'se movió 40 px a la derecha');
  svg.emit('pointermove', ev({ clientX: 100000, clientY: -100000 }));     // arrastre exagerado: el diagrama sigue a la vista
  const st = view.state, cx = (st.W / 2 - st.tx) / st.s, cy = (st.H / 2 - st.ty) / st.s;
  assert.ok(cx >= -720 - 1e-6 && cx <= 840 + 1e-6, 'el centro de la pantalla sigue dentro del diagrama (x)');
  assert.ok(cy >= -114 - 1e-6 && cy <= 60 * (4 * Math.sqrt(3) + 2) + 1e-6, 'el centro de la pantalla sigue dentro del diagrama (y)');
  svg.emit('pointerup', ev());
  const tx1 = view.state.tx;
  svg.emit('pointermove', ev({ clientX: 50, clientY: 50 }));              // soltó: ya no mueve
  assert.equal(view.state.tx, tx1);
});

test('mount: pellizcar con dos dedos acerca y aleja', () => {
  const { view, svg } = mountFake();
  view.fit();
  svg.emit('pointerdown', ev({ pointerId: 1, clientX: 150, clientY: 150 }));
  svg.emit('pointerdown', ev({ pointerId: 2, clientX: 250, clientY: 150 }));
  const s0 = view.state.s;
  svg.emit('pointermove', ev({ pointerId: 2, clientX: 350, clientY: 150 }));   // separa los dedos
  assert.ok(view.state.s > s0);
  const s1 = view.state.s;
  svg.emit('pointermove', ev({ pointerId: 2, clientX: 200, clientY: 150 }));   // los junta
  assert.ok(view.state.s < s1);
  svg.emit('pointercancel', ev({ pointerId: 2 }));
  svg.emit('pointercancel', ev({ pointerId: 1 }));
});

test('mount: se adapta al cambio de tamaño de la pantalla', () => {
  let cb = null;
  globalThis.ResizeObserver = class { constructor(f) { cb = f; } observe() {} };
  try {
    const { el, view } = mountFake();
    view.fit();
    const tx0 = view.state.tx;
    el.clientWidth = 600; el.clientHeight = 400;
    cb();
    assert.equal(view.state.W, 600); assert.equal(view.state.H, 400);
    assert.equal(view.state.tx, tx0 + 100);
    el.clientWidth = 0;
    cb();                                                                 // tamaño cero: no hace nada
    assert.equal(view.state.W, 600);
  } finally { delete globalThis.ResizeObserver; }
});

test('mount: "Ver todo" deja el diagrama entero dentro de la pantalla y lo más grande posible', () => {
  const { view } = mountFake();                                           // pantalla de 400 × 300
  view.fit();
  const ancho = (11.4 - -9.6) * Diagram.S * view.state.s;                 // ancho de los hexágonos en pantalla
  assert.ok(ancho <= 400 + 1e-6, 'se sale por los lados: ' + ancho);
  assert.ok(ancho > 200, 'quedó demasiado pequeño: ' + ancho);
  assert.ok(view.state.tx > -1e-6 && view.state.tx + 0 < 400);
});

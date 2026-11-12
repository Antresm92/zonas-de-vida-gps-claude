'use strict';
/* 2.16.0 — pegar puntos a las esquinas de otros lotes y recortar los bordes lisos del logo. */
const test = require('node:test');
const assert = require('node:assert');
const Mapa = require('../www/js/mapa.js');
const Geo = require('../www/js/geo.js');
const Fotos = require('../www/js/fotos.js');

/* ---------- Pegado a esquinas ---------- */
const FR = Geo.localFrame([{ lat: 4.6, lon: -74.08 }]);
const at = (x, y, extra) => Object.assign(Geo.fromXY(FR, { x, y }), extra || {});
const LAYERS = [
  { lot: true, name: 'Lote 1', points: [at(0, 0, { name: 'P1', alt: 2600 }), at(100, 0, { name: 'P2' }), at(100, 100, { alt: 2650 })] },
  { lot: true, name: 'Cafetal', points: [at(103, 0, { name: 'C1' })] },
  { name: 'Capa importada', points: [at(50, 50, { name: 'X' })] },                 // no es un lote: no atrae
  null, { lot: true, name: 'roto', points: [{ lat: 'x', lon: 1 }, null] }
];

test('pegado: toma la esquina más cercana de otro lote dentro del radio, con su nombre, su lote y su altitud', () => {
  const s = Mapa.snapVertex(at(2, 1), LAYERS, 5);
  assert.equal(s.name, 'P1'); assert.equal(s.lot, 'Lote 1'); assert.equal(s.alt, 2600);
  assert.deepEqual([s.lat, s.lon], [LAYERS[0].points[0].lat, LAYERS[0].points[0].lon]);
  assert.ok(Math.abs(s.dist - Math.hypot(2, 1)) < 0.01);
  // entre dos esquinas cercanas gana la que está más cerca; sin altitud devuelve null; sin nombre, su orden
  assert.equal(Mapa.snapVertex(at(102, 0), LAYERS, 5).name, 'C1');
  assert.equal(Mapa.snapVertex(at(101, 0), LAYERS, 5).name, 'P2');
  assert.equal(Mapa.snapVertex(at(101, 0), LAYERS, 5).alt, null);
  assert.equal(Mapa.snapVertex(at(100, 99), LAYERS, 5).name, 'P3');
});

test('pegado: fuera del radio, cerca de una capa importada o con datos malos no se pega', () => {
  assert.equal(Mapa.snapVertex(at(6, 0), LAYERS, 5), null);
  assert.ok(Mapa.snapVertex(at(4.9, 0), LAYERS, 5));
  assert.equal(Mapa.snapVertex(at(50, 50), LAYERS, 5), null, 'una capa importada no atrae');
  for (const [ll, layers, r] of [[null, LAYERS, 5], [{ lat: 'a', lon: 1 }, LAYERS, 5], [at(0, 0), LAYERS, 0], [at(0, 0), LAYERS, NaN], [at(0, 0), null, 5], [at(0, 0), [], 5]]) {
    assert.equal(Mapa.snapVertex(ll, layers, r), null);
  }
});

test('pegado: el radio son 14 píxeles del mapa, entre 0,5 m y 10 m', () => {
  // en el ecuador, a zoom 0, un píxel mide 156.543 m; cada nivel de zoom lo parte en dos
  assert.ok(Math.abs(Mapa.metersPerPixel(0, 0) - 156543.03392) < 1e-6);
  assert.ok(Math.abs(Mapa.metersPerPixel(18, 0) - 156543.03392 / 262144) < 1e-9);
  assert.ok(Math.abs(Mapa.metersPerPixel(18, 60) / Mapa.metersPerPixel(18, 0) - 0.5) < 1e-9);
  const mpp19 = Mapa.metersPerPixel(19, 4.6);
  assert.ok(Math.abs(Mapa.snapRadius(19, 4.6) - 14 * mpp19) < 1e-9);      // ≈ 4,2 m
  assert.equal(Mapa.snapRadius(12, 4.6), 10, 'con el mapa lejos no pasa de 10 m');
  assert.equal(Mapa.snapRadius(17, 4.6), 10);
  assert.equal(Mapa.snapRadius(24, 4.6), 0.5, 'muy cerca no baja de medio metro');
  assert.equal(Mapa.snapRadius(null, 4.6), 0); assert.equal(Mapa.snapRadius(18, NaN), 0);
  assert.equal(Mapa.SNAP_PX, 14); assert.equal(Mapa.SNAP_MAX_M, 10);
});

/* ---------- Recorte de bordes del logo ---------- */
// Imagen w × h de un color, con un rectángulo de otro color; devuelve los píxeles RGBA
function img(w, h, bg, rects) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([bg[0], bg[1], bg[2], 255], i * 4);
  (rects || []).forEach(([x, y, rw, rh, c]) => { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) d.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4); });
  return d;
}
const W = [255, 255, 255], K = [0, 0, 0], G = [30, 120, 60];

test('recorte: quita el borde liso alrededor del dibujo y deja un margen pequeño', () => {
  const b = Fotos.trimBox(img(200, 400, W, [[60, 150, 80, 100, G]]), 200, 400);
  assert.deepEqual(b, { x: 57, y: 147, w: 86, h: 106 });           // 80 × 100 más 3 píxeles (3 % del lado mayor) por cada lado
  // borde negro (como las franjas de una captura de pantalla)
  assert.deepEqual(Fotos.trimBox(img(100, 300, K, [[0, 100, 100, 100, G]]), 100, 300), { x: 0, y: 97, w: 100, h: 106 });
  // el margen no se sale de la imagen
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[0, 0, 100, 50, G]]), 100, 100), { x: 0, y: 0, w: 100, h: 100 }, 'las esquinas no son iguales: no hay borde liso');
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[1, 40, 60, 20, G]]), 100, 100), { x: 0, y: 38, w: 63, h: 24 });
});

test('recorte: tolera el ruido del JPEG y unos pocos píxeles sueltos en el borde', () => {
  const d = img(200, 200, W, [[50, 50, 100, 100, G]]);
  for (let i = 0; i < 200 * 200; i += 7) { d[i * 4] -= 12; d[i * 4 + 1] -= 9; }       // ruido leve en toda la imagen
  d.set([255, 0, 0, 255], (10 * 200 + 10) * 4);                                        // un píxel suelto en el borde
  assert.deepEqual(Fotos.trimBox(d, 200, 200), { x: 47, y: 47, w: 106, h: 106 });
  // con tolerancia 0 el ruido ya no se considera borde
  assert.deepEqual(Fotos.trimBox(d, 200, 200, 0), { x: 0, y: 0, w: 200, h: 200 });
});

test('recorte: no toca la imagen si no hay borde liso, si es de un solo color, si casi no hay qué quitar o si queda casi nada', () => {
  const full = (w, h) => ({ x: 0, y: 0, w, h });
  assert.deepEqual(Fotos.trimBox(img(100, 100, W), 100, 100), full(100, 100), 'un solo color');
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[0, 0, 100, 100, G]]), 100, 100), full(100, 100));
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[1, 1, 98, 98, G]]), 100, 100), full(100, 100), 'menos de 4 % de recorte');
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[50, 50, 4, 4, G]]), 100, 100), full(100, 100), 'lo que queda es menor que 8 píxeles');
  assert.deepEqual(Fotos.trimBox(img(100, 100, W, [[99, 0, 1, 1, K], [20, 20, 60, 60, G]]), 100, 100), full(100, 100), 'una esquina distinta');
  assert.deepEqual(Fotos.trimBox(img(8, 8, W), 8, 8), full(8, 8)); assert.deepEqual(Fotos.trimBox(null, 50, 50), full(50, 50));
  assert.deepEqual(Fotos.trimBox(new Uint8ClampedArray(10), 50, 50), full(50, 50), 'faltan píxeles');
});

/* ---------- Insertar un punto entre dos y renumerar (2.17.2) ---------- */
test('insertar entre dos puntos: el nuevo toma el número que sigue y los demás suben uno; la forma no cambia', () => {
  const P = (n) => n.map((x, i) => ({ id: 'i' + i, name: x, lat: 4 + i, lon: -74 - i, alt: 100 + i }));
  const names = (r) => r.points.map((p) => p.name).join(' ');
  const base = P(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']), copia = JSON.stringify(base);
  const r = Mapa.insertRenumber(base, 3, { id: 'n', name: 'P8', lat: 9, lon: 9 });
  assert.equal(names(r), 'P1 P2 P3 P4 P5 P6 P7 P8'); assert.equal(r.next, 9);
  assert.deepEqual(r.points.map((p) => p.id), ['i0', 'i1', 'i2', 'i3', 'n', 'i4', 'i5', 'i6']);
  assert.deepEqual(r.renamed, [{ id: 'i4', from: 'P5', to: 'P6' }, { id: 'i5', from: 'P6', to: 'P7' }, { id: 'i6', from: 'P7', to: 'P8' }]);
  assert.deepEqual(r.points.filter((p) => p.id !== 'n').map((p) => [p.lat, p.lon, p.alt]), base.map((p) => [p.lat, p.lon, p.alt]), 'las coordenadas no cambian');
  assert.equal(JSON.stringify(base), copia, 'la lista original no se toca');
  assert.equal(r.point.id, 'n'); assert.equal(r.point.lat, 9);
  // entre el 1 y el 2
  assert.equal(names(Mapa.insertRenumber(P(['P1', 'P2', 'P3']), 0, { id: 'n' })), 'P1 P2 P3 P4');
  // después del último no hay nada que subir
  const fin = Mapa.insertRenumber(P(['P1', 'P2', 'P3']), 2, { id: 'n' });
  assert.equal(names(fin), 'P1 P2 P3 P4'); assert.deepEqual(fin.renamed, []); assert.equal(fin.next, 5);
  // los nombres puestos por la persona no se tocan; el número sale del último automático hacia atrás
  const mix = Mapa.insertRenumber(P(['P1', 'Portada', 'P3', 'P7']), 1, { id: 'n' });
  assert.equal(names(mix), 'P1 Portada P2 P4 P8'); assert.equal(mix.next, 9);
  const sin = Mapa.insertRenumber(P(['Portón', 'Quebrada', 'Cerca']), 0, { id: 'n' });
  assert.equal(names(sin), 'Portón P1 Quebrada Cerca'); assert.equal(sin.next, 2);
  // con huecos en la numeración (se borró el P3): suben los de número igual o mayor, y no quedan dos iguales
  const hueco = Mapa.insertRenumber(P(['P1', 'P2', 'P4', 'P5']), 1, { id: 'n' });
  assert.equal(names(hueco), 'P1 P2 P3 P5 P6');
  const rep = Mapa.insertRenumber(P(['P5', 'P1', 'P2']), 1, { id: 'n' });       // orden cambiado a mano: el P5 va primero
  assert.equal(names(rep), 'P6 P1 P2 P3'); assert.equal(new Set(rep.points.map((p) => p.name)).size, 4);
  // datos raros: índice fuera de rango va al final; lista vacía; nombres que parecen automáticos pero no lo son
  assert.equal(names(Mapa.insertRenumber(P(['P1', 'P2']), 99, { id: 'n' })), 'P1 P2 P3');
  assert.equal(names(Mapa.insertRenumber([], 0, { id: 'n' })), 'P1'); assert.equal(names(Mapa.insertRenumber(null, null, null)), 'P1');
  assert.equal(names(Mapa.insertRenumber(P(['P01x', 'p2', 'P 3', 'P2']), 3, { id: 'n' })), 'P01x p2 P 3 P2 P3');
  assert.equal(Mapa.autoNum({ name: 'P12' }), 12); assert.equal(Mapa.autoNum({ name: 'P' }), null); assert.equal(Mapa.autoNum(null), null); assert.equal(Mapa.autoNum({ name: 7 }), null);
});

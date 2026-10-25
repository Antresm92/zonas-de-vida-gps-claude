'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const H = require('../www/js/holdridge.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` esperado ${b} ± ${tol}, obtenido ${a}`);

/* ---------- Lectura de coordenadas ---------- */
test('parseAngle: decimales, coma decimal y hemisferios', () => {
  assert.equal(Geo.parseAngle('4.6097', 'lat').value, 4.6097);
  assert.equal(Geo.parseAngle('-74,0817', 'lon').value, -74.0817);
  assert.equal(Geo.parseAngle('4.6097 S', 'lat').value, -4.6097);
  near(Geo.parseAngle('74 4 54 W', 'lon').value, -(74 + 4 / 60 + 54 / 3600), 1e-9);
  near(Geo.parseAngle("74°04'54\"O", 'lon').value, -(74 + 4 / 60 + 54 / 3600), 1e-9);
  near(Geo.parseAngle('4°36\'35.2"N', 'lat').value, 4 + 36 / 60 + 35.2 / 3600, 1e-9);
  near(Geo.parseAngle('N 4 36 35', 'lat').value, 4 + 36 / 60 + 35 / 3600, 1e-9);
});
test('parseAngle: errores', () => {
  assert.ok(Geo.parseAngle('91', 'lat').error);
  assert.ok(Geo.parseAngle('181', 'lon').error);
  assert.ok(Geo.parseAngle('4 75 0', 'lat').error);          // minutos >= 60
  assert.ok(Geo.parseAngle('4 30 61', 'lat').error);         // segundos >= 60
  assert.ok(Geo.parseAngle('4 N', 'lon').error);             // N no vale para longitud
  assert.ok(Geo.parseAngle('abc', 'lat').error);
  assert.ok(Geo.parseAngle('', 'lat').error);
  assert.ok(Geo.parseAngle('4.5 x', 'lat').error);
});
test('parsePair: formatos habituales', () => {
  let r = Geo.parsePair('4.6097, -74.0817');
  assert.deepEqual([r.lat, r.lon], [4.6097, -74.0817]);
  r = Geo.parsePair('4.6097 -74.0817');
  assert.deepEqual([r.lat, r.lon], [4.6097, -74.0817]);
  r = Geo.parsePair('4,6097; -74,0817');
  assert.deepEqual([r.lat, r.lon], [4.6097, -74.0817]);
  r = Geo.parsePair('4,6097 -74,0817');
  assert.deepEqual([r.lat, r.lon], [4.6097, -74.0817]);
  r = Geo.parsePair('4°36\'35.2"N 74°04\'54"W');
  near(r.lat, 4.609778, 1e-5); near(r.lon, -74.081667, 1e-5);
  r = Geo.parsePair('N 4 36 35.2 W 74 4 54');
  near(r.lat, 4.609778, 1e-5); near(r.lon, -74.081667, 1e-5);
  r = Geo.parsePair('74°04\'54"O, 4°36\'35.2"N');           // invertido
  near(r.lat, 4.609778, 1e-5); near(r.lon, -74.081667, 1e-5);
  assert.ok(Geo.parsePair('hola').error);
  assert.ok(Geo.parsePair('95, 10').error);
});
test('toDMS', () => {
  assert.equal(Geo.toDMS(4.609778, 'lat', 1), '4° 36\' 35.2" N');
  assert.equal(Geo.toDMS(-74.081667, 'lon', 0), '74° 04\' 54" W');
  assert.equal(Geo.toDMS(10.9999999, 'lat', 2), '11° 00\' 00.00" N');   // redondeo sin 60"
});

/* ---------- Distancias ---------- */
test('Vincenty: caso de referencia Flinders Peak – Buninyong', () => {
  const dms = (d, m, s) => d + m / 60 + s / 3600;
  const d = Geo.distance(-dms(37, 57, 3.72030), dms(144, 25, 29.52440), -dms(37, 39, 10.15610), dms(143, 55, 35.38390));
  near(d, 54972.271, 0.05);
});
test('Distancias en el ecuador', () => {
  near(Geo.distance(0, 0, 0, 1), 111319.49, 0.05);
  near(Geo.distance(0, 0, 1, 0), 110574.39, 0.1);
  assert.equal(Geo.distance(4.6, -74, 4.6, -74), 0);
});

/* ---------- Área ---------- */
// Integral numérica independiente del área de un rectángulo lat/lon sobre WGS84
function rectAreaNumeric(lat1, lat2, dlonDeg) {
  const a = 6378137, e2 = 0.00669437999014983;
  const f = (phi) => a * a * (1 - e2) * Math.cos(phi) / Math.pow(1 - e2 * Math.sin(phi) ** 2, 2);
  const n = 2000; const h = (lat2 - lat1) * Math.PI / 180 / n;
  let s = f(lat1 * Math.PI / 180) + f(lat2 * Math.PI / 180);
  for (let i = 1; i < n; i++) s += f(lat1 * Math.PI / 180 + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3 * dlonDeg * Math.PI / 180;
}
test('Área: rectángulos lat/lon frente a integración numérica', () => {
  [[0, 1, 1], [4.5, 4.6, 0.1], [4.6, 4.601, 0.001], [-33, -32, 2], [60, 61, 1]].forEach(([la1, la2, dl]) => {
    const poly = [{ lat: la1, lon: 10 }, { lat: la1, lon: 10 + dl }, { lat: la2, lon: 10 + dl }, { lat: la2, lon: 10 }];
    const got = Geo.polygonArea(poly);
    const ref = rectAreaNumeric(la1, la2, dl);
    near(got / ref, 1, 1e-9, `rect ${la1},${la2},${dl}`);
  });
});
test('Área: cuadrado de 100 m x 100 m ≈ 1 ha', () => {
  const fr = Geo.localFrame([{ lat: 4.6, lon: -74 }]);
  const c = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => Geo.fromXY(fr, { x, y }));
  near(Geo.polygonArea(c), 10000, 5);                        // 0,05 %
  near(Geo.perimeter(c), 400, 0.5);
  near(Geo.areaUnits(10000).fanegadas, 1.5625, 1e-9);
});
test('Área: independiente del sentido y del vértice inicial', () => {
  const p = [{ lat: 4.60, lon: -74.10 }, { lat: 4.60, lon: -74.08 }, { lat: 4.62, lon: -74.07 }, { lat: 4.63, lon: -74.09 }];
  const a = Geo.polygonArea(p);
  near(Geo.polygonArea(p.slice().reverse()) / a, 1, 1e-12);
  near(Geo.polygonArea(p.slice(2).concat(p.slice(0, 2))) / a, 1, 1e-12);
});

/* ---------- Topología ---------- */
test('Autointersección y reordenamiento', () => {
  const sq = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }, { lat: 0.01, lon: 0 }];
  assert.equal(Geo.selfIntersects(sq), false);
  const bow = [sq[0], sq[2], sq[1], sq[3]];
  assert.equal(Geo.selfIntersects(bow), true);
  const order = Geo.angularOrder(bow);
  assert.equal(Geo.selfIntersects(order.map(i => bow[i])), false);
  near(Geo.polygonArea(order.map(i => bow[i])), Geo.polygonArea(sq), 1);
});
test('Centroide de un cuadrado', () => {
  const sq = [{ lat: 4, lon: -74 }, { lat: 4, lon: -73.99 }, { lat: 4.01, lon: -73.99 }, { lat: 4.01, lon: -74 }];
  const c = Geo.centroid(sq);
  near(c.lat, 4.005, 1e-6); near(c.lon, -73.995, 1e-6);
});

/* ---------- Holdridge ---------- */
test('Constantes del diagrama (eje derecho de la captura)', () => {
  [[1.5, 88.395], [3, 176.79], [6, 353.58], [12, 707.16], [24, 1414.32], [48, 2828.64]].forEach(([bt, pet]) =>
    near(H.petFromBT(bt), pet, 0.005));
  near(H.BT_FROST, 16.97, 0.01);
});
test('Hay 36 hexágonos y la geometría coincide con la captura (píxeles)', () => {
  assert.equal(H.HEXES.length, 36);
  // x = 1401 + 60.3 (X-3); y = 1262 + 104.4 (k-4)
  const px = (h) => [1401 + 60.3 * (h.cx - 3), 1262 + 104.4 * (h.k - 4)];
  const find = (k, r) => H.HEXES.find(h => h.k === k && h.r === r);
  [[0, 0.5, 1160, 840], [0, -2.5, 1523, 840], [1, 1.5, 1100, 946], [1, -3.5, 1703, 946],
   [2, 3.5, 918, 1051], [2, -3.5, 1764, 1051], [3, 5.5, 737, 1155], [3, -3.5, 1824, 1155],
   [4, 4.5, 918, 1260], [4, 0.5, 1401, 1260], [4, -2.5, 1764, 1260]].forEach(([k, r, ex, ey]) => {
    const [x, y] = px(find(k, r));
    near(x, ex, 3, `x de (${k},${r})`); near(y, ey, 8, `y de (${k},${r})`);
  });
});
test('Provincias de humedad', () => {
  const id = (per) => H.humidityProvince(per).id;
  assert.equal(id(40), 'desecado');
  assert.equal(id(20), 'superarido');
  assert.equal(id(1.5), 'subhumedo');
  assert.equal(id(1), 'subhumedo');          // límite inferior inclusivo en 2^0
  assert.equal(id(0.99), 'humedo');
  assert.equal(id(0.3), 'perhumedo');
  assert.equal(id(0.2), 'superhumedo');
  assert.equal(id(0.1), 'semisaturado');
  assert.equal(id(0.05), 'saturado');
});
test('Biotemperatura', () => {
  assert.equal(H.biotemperature(14), 14);
  assert.equal(H.biotemperature(-3), 0);
  assert.equal(H.biotemperature(33), 30);
  assert.equal(H.biotemperature(null), null);
  const m = [-4, -2, 1, 4, 8, 12, 14, 13, 9, 4, 0, -3];            // meses < 0 cuentan 0
  near(H.biotemperature(5, m), (1 + 4 + 8 + 12 + 14 + 13 + 9 + 4 + 0) / 12, 1e-12);
  near(H.biotemperature(30, [31, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]), (29 + 30 * 10) / 12, 1e-12);   // 31 > 30 => 0
});
test('Casos conocidos de Colombia', () => {
  const z = (T, P) => H.classify({ T, P }).zone.symbol;
  assert.equal(z(14, 1000), 'bh-MB');       // sabana de Bogotá
  assert.equal(z(22, 1600), 'bh-PM');       // valle de Aburrá / zona cafetera
  assert.equal(z(27, 8000), 'bp-T');        // Chocó
  assert.equal(z(28, 1400), 'bs-T');        // valle cálido seco
  assert.equal(z(8, 1500), 'bmh-M');
  assert.equal(z(28, 300), 'me-T');         // árido cálido (PER 5,5)
  assert.equal(z(28, 130), 'md-T');         // perárido cálido (PER 12,7)
  assert.equal(z(5, 1200), 'pp-SA');        // páramo pluvial (PER 0,25)
  assert.equal(z(5, 450), 'ph-SA');         // páramo húmedo (PER 0,65)
  assert.equal(z(2, 170), 'th-A');          // tundra húmeda (PER 0,69)
  assert.equal(z(2, 800), 'tp-A');          // tundra pluvial (PER 0,15)
});
test('Nombre completo, región y piso', () => {
  const r = H.classify({ T: 22, P: 1600 });
  assert.equal(r.zone.name, 'Bosque húmedo premontano');
  assert.equal(r.region, 'Subtropical');
  assert.equal(r.belt, 'Premontano');
  assert.equal(r.humidity.name, 'Húmedo');
  near(r.bt, 22, 1e-12); near(r.pet, 22 * 58.93, 1e-9); near(r.per, 22 * 58.93 / 1600, 1e-12);
  assert.ok(r.inDiagram);
  const b = H.classify({ T: 14, P: 1000 });
  assert.equal(b.zone.name, 'Bosque húmedo montano bajo');
  assert.equal(b.region, 'Templada cálida');
});
test('La línea de escarcha divide la fila de 17 °C', () => {
  const lo = H.classify({ T: 16, P: 1600 }).zone.symbol;
  const hi = H.classify({ T: 18, P: 1600 }).zone.symbol;
  assert.ok(lo.endsWith('-MB'), lo);
  assert.ok(hi.endsWith('-PM'), hi);
  assert.equal(H.classify({ T: 16, P: 314 }).zone.base, 'Estepa espinosa');
  assert.equal(H.classify({ T: 18.5, P: 340 }).zone.base, 'Monte espinoso');
  assert.equal(H.classify({ T: 16, P: 600 }).zone.base, 'Bosque seco');      // PER 1,57
});
test('Casos límite: nival, extremos y datos incompletos', () => {
  const n = H.classify({ T: 0.5, P: 700 });
  assert.equal(n.zone.symbol, 'N'); assert.equal(n.region, 'Polar');
  const wet = H.classify({ T: 27, P: 30000 });
  assert.equal(wet.inDiagram, false); assert.ok(wet.zone.symbol);
  const dry = H.classify({ T: 28, P: 5 });
  assert.equal(dry.inDiagram, false); assert.equal(dry.humidity.id, 'desecado');
  const sinP = H.classify({ T: 14 });
  assert.equal(sinP.ok, false); assert.equal(sinP.partial, true); assert.equal(sinP.region, 'Templada cálida');
  assert.equal(H.classify({ P: 1000 }).ok, false);
});
test('Todos los hexágonos son alcanzables: el centro de cada uno devuelve su propia zona', () => {
  H.HEXES.forEach(h => {
    const U = h.U, V = h.k;
    const P = 125 * Math.pow(2, U), PET = 125 * Math.pow(2, V);
    const T = PET / 58.93;
    if (T > 30) return;                                       // fuera del rango de BT (solo la fila 4 hasta 30 °C)
    const r = H.classify({ T: T + (h.k === 3 ? 0.001 : 0), P });
    assert.equal(r.hex.k, h.k, `fila de ${h.k}/${h.r}`);
    near(r.hex.r, h.r, 1e-9, `r de ${h.k}/${h.r}`);
  });
});
test('Una zona cercana al borde varía de forma continua (simetría de la red)', () => {
  // Misma relación ETP/P en filas distintas conserva la provincia de humedad
  const a = H.classify({ T: 28, P: 1650 });      // PER 1.0
  const b = H.classify({ T: 10, P: 589.3 });     // PER 1.0
  assert.equal(a.humidity.id, b.humidity.id);
});

test('Los bordes de los hexágonos son verticales: provincia de humedad y hexágono pueden diferir', () => {
  // T=28 °C, P=450 mm -> PER 3,67 (semiárido) pero X = 2U-V = -0,02 < 0, o sea el hexágono de Monte espinoso
  const r = H.classify({ T: 28, P: 450 });
  assert.equal(r.humidity.id, 'semiarido');
  assert.equal(r.zone.symbol, 'me-T');
  // Un poco más húmedo (P=520) cruza el borde vertical y pasa a Bosque muy seco
  assert.equal(H.classify({ T: 28, P: 520 }).zone.symbol, 'bms-T');
});

test('Las etiquetas de la tabla coinciden con las de la captura (nombre por posición en píxeles)', () => {
  const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const at = (x, y) => {
    let best = null;
    H.HEXES.forEach(h => {
      const hx = 1401 + 60.3 * (h.cx - 3), hy = 1262 + 104.4 * (h.k - 4);
      const d = (hx - x) ** 2 + (hy - y) ** 2;
      if (!best || d < best.d) best = { h, d };
    });
    return best.h;
  };
  const shot = [
    [1160, 840, 'tundra seca'], [1281, 840, 'tundra humeda'], [1401, 840, 'tundra muy humeda'], [1523, 840, 'tundra pluvial'],
    [1100, 946, 'desierto'], [1220, 946, 'matorral desertico'], [1340, 946, 'paramo humedo'], [1461, 946, 'paramo muy humedo'],
    [1583, 946, 'paramo pluvial'], [1703, 946, 'paramo pluvial'],
    [918, 1051, 'desierto'], [1038, 1051, 'desierto'], [1159, 1051, 'matorral desertico'], [1281, 1051, 'estepa'],
    [1401, 1051, 'bosque humedo'], [1523, 1051, 'bosque muy humedo'], [1643, 1051, 'bosque pluvial'], [1764, 1051, 'bosque pluvial'],
    [1099, 1129, 'matorral desertico'], [1341, 1129, 'bosque seco'], [1461, 1129, 'bosque humedo'], [1703, 1129, 'bosque pluvial'],
    [737, 1129, 'desierto'], [978, 1129, 'desierto'],
    [918, 1260, 'desierto'], [1038, 1260, 'matorral desertico'], [1159, 1260, 'monte espinoso'], [1280, 1260, 'bosque muy seco'],
    [1401, 1260, 'bosque seco'], [1522, 1260, 'bosque humedo'], [1643, 1260, 'bosque muy humedo'], [1764, 1260, 'bosque pluvial']
  ];
  shot.forEach(([x, y, name]) => {
    const h = at(x, y);
    assert.ok(h.names.some(n => strip(n) === name), `(${x},${y}) esperado ${name}, tabla: ${h.names.join('/')}`);
  });
  // mitades de la fila de la línea de escarcha
  const h = at(1220, 1155);
  assert.deepEqual(h.names, ['Estepa espinosa', 'Monte espinoso']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');

const A = 6378137.0, F = 1 / 298.257223563, E2 = F * (2 - F);
const rad = (d) => d * Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtenido ${a} (tol ${tol})`);

// ---------- Integración numérica independiente del área en el elipsoide ----------
// Recorre la latitud y suma (ancho del polígono en longitud) × (dA/dφdλ = M·N·cosφ).
// Los lados del polígono son rectos en el plano lat/lon.
function areaByQuadrature(pts, steps = 40000) {
  const lats = pts.map((p) => p.lat);
  const lo = Math.min(...lats), hi = Math.max(...lats);
  const n = pts.length;
  const width = (lat) => {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a.lat <= lat && b.lat > lat) || (b.lat <= lat && a.lat > lat)) {
        xs.push(a.lon + (lat - a.lat) / (b.lat - a.lat) * (b.lon - a.lon));
      }
    }
    xs.sort((x, y) => x - y);
    let w = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) w += xs[i + 1] - xs[i];
    return rad(w);
  };
  let sum = 0;
  const h = (hi - lo) / steps;
  for (let i = 0; i < steps; i++) {
    const lat = lo + (i + 0.5) * h;          // regla del punto medio
    const phi = rad(lat), s = Math.sin(phi);
    const dens = A * A * (1 - E2) * Math.cos(phi) / Math.pow(1 - E2 * s * s, 2);
    sum += width(lat) * dens * rad(h);
  }
  return sum;
}

test('distancia de Vincenty: caso de referencia Flinders Peak – Buninyong', () => {
  const dms = (d, m, s) => d + m / 60 + s / 3600;
  const d = Geo.distance(-dms(37, 57, 3.7203), dms(144, 25, 29.5244), -dms(37, 39, 10.1561), dms(143, 55, 35.3839));
  near(d, 54972.271, 0.01, 'Vincenty');
});

test('distancia: un grado de longitud en el ecuador ≈ 111 319,49 m', () => {
  near(Geo.distance(0, 0, 0, 1), 111319.49, 0.05);
});

test('distancia: un grado de latitud en el ecuador ≈ 110 574,39 m', () => {
  near(Geo.distance(0, 0, 1, 0), 110574.39, 0.1);
});

test('área: rectángulo de 1°×1° en el ecuador contra integración numérica', () => {
  const sq = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }];
  const ref = areaByQuadrature(sq);
  const got = Geo.polygonArea(sq);
  assert.ok(Math.abs(got - ref) / ref < 1e-7, `ref ${ref} vs ${got}`);
  assert.ok(got > 1.22e10 && got < 1.24e10, 'orden de magnitud (≈12 300 km²)');
});

test('área: parcela irregular cerca de Bogotá contra integración numérica', () => {
  const poly = [
    { lat: 4.600, lon: -74.100 }, { lat: 4.600, lon: -74.050 },
    { lat: 4.650, lon: -74.040 }, { lat: 4.630, lon: -74.110 }];
  const ref = areaByQuadrature(poly);
  const got = Geo.polygonArea(poly);
  assert.ok(Math.abs(got - ref) / ref < 1e-6, `ref ${ref} vs ${got}`);
});

// Divide cada lado en tramos rectos en lat/lon para que el modelo de lado de la fórmula
// (trapecio en sen φ) coincida con el de la integración (recta en lat/lon).
function densify(pts, k = 200) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (let j = 0; j < k; j++) out.push({ lat: a.lat + (b.lat - a.lat) * j / k, lon: a.lon + (b.lon - a.lon) * j / k });
  }
  return out;
}

test('área: a 60° N y a 35° S coincide con la integración numérica cuando los lados se densifican', () => {
  [[60, 10], [-35, -58]].forEach(([la, lo]) => {
    const poly = [
      { lat: la, lon: lo }, { lat: la + 0.02, lon: lo + 0.01 },
      { lat: la + 0.05, lon: lo + 0.05 }, { lat: la + 0.01, lon: lo + 0.06 }, { lat: la - 0.01, lon: lo + 0.03 }];
    const ref = areaByQuadrature(poly);
    const dense = Geo.polygonArea(densify(poly));
    assert.ok(Math.abs(dense - ref) / ref < 1e-7, `${la}: ref ${ref} vs densificado ${dense}`);
    // Con los pocos vértices del usuario, la diferencia viene solo del modelo de lado (recto en lat/lon vs. trapecio)
    // y es de unas pocas partes por 10 000 en una parcela de unos 3 km: no afecta a un resultado en hectáreas.
    const raw = Geo.polygonArea(poly);
    assert.ok(Math.abs(raw - ref) / ref < 2e-4, `${la}: ref ${ref} vs ${raw}`);
  });
});

test('área: no depende del sentido, del punto inicial ni de repetir el primer punto', () => {
  const poly = [
    { lat: 4.60, lon: -74.10 }, { lat: 4.60, lon: -74.05 }, { lat: 4.65, lon: -74.04 }, { lat: 4.63, lon: -74.11 }];
  const a = Geo.polygonArea(poly);
  const rel = (x) => Math.abs(x - a) / a;
  assert.ok(rel(Geo.polygonArea(poly.slice().reverse())) < 1e-10);
  assert.ok(rel(Geo.polygonArea([poly[2], poly[3], poly[0], poly[1]])) < 1e-10);
  assert.ok(rel(Geo.polygonArea(poly.concat([poly[0]]))) < 1e-10);
});

test('área: cruce del antimeridiano (±180°)', () => {
  const east = [{ lat: 0, lon: 179.5 }, { lat: 0, lon: 180 }, { lat: 1, lon: 180 }, { lat: 1, lon: 179.5 }];
  const across = [{ lat: 0, lon: 179.75 }, { lat: 0, lon: -179.75 }, { lat: 1, lon: -179.75 }, { lat: 1, lon: 179.75 }];
  near(Geo.polygonArea(across), Geo.polygonArea(east), Geo.polygonArea(east) * 1e-9);
});

test('área: menos de 3 puntos es 0; unidades y fanegada de 6 400 m²', () => {
  assert.equal(Geo.polygonArea([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]), 0);
  const u = Geo.areaUnits(64000);
  near(u.fanegadas, 10, 1e-9); near(u.ha, 6.4, 1e-9); near(u.km2, 0.064, 1e-12);
});

test('perímetro de un cuadrado de ~1 km', () => {
  const d = 0.009;                         // ≈ 1 km
  const sq = [{ lat: 4, lon: -74 }, { lat: 4, lon: -74 + d }, { lat: 4 + d, lon: -74 + d }, { lat: 4 + d, lon: -74 }];
  const p = Geo.perimeter(sq, true);
  assert.ok(p > 3900 && p < 4100, String(p));
  assert.ok(Geo.perimeter(sq, false) < p);
});

test('lectura de coordenadas: decimales, comas decimales, DMS, hemisferios', () => {
  const ok = (txt, lat, lon, tol = 1e-5) => {
    const r = Geo.parsePair(txt);
    assert.ok(!r.error, `${txt} -> ${r.error}`);
    near(r.lat, lat, tol, txt); near(r.lon, lon, tol, txt);
  };
  ok('4.6097, -74.0817', 4.6097, -74.0817);
  ok('4.6097 -74.0817', 4.6097, -74.0817);
  ok('4,6097 -74,0817', 4.6097, -74.0817);
  ok('4,6097; -74,0817', 4.6097, -74.0817);
  ok('4.6097N 74.0817W', 4.6097, -74.0817);
  ok('4°36\'35.2"N 74°04\'54"W', 4 + 36 / 60 + 35.2 / 3600, -(74 + 4 / 60 + 54 / 3600));
  ok('4 36 35.2 N, 74 4 54 O', 4 + 36 / 60 + 35.2 / 3600, -(74 + 4 / 60 + 54 / 3600));
  ok('N 4 36 35 W 74 4 54', 4 + 36 / 60 + 35 / 3600, -(74 + 4 / 60 + 54 / 3600));
  ok('74°04\'54"W 4°36\'35"N', 4 + 36 / 60 + 35 / 3600, -(74 + 4 / 60 + 54 / 3600));   // orden invertido
  ok('-12.5, 130', -12.5, 130);
  ok('12.5S 130E', -12.5, 130);
});

test('lectura de coordenadas: errores claros', () => {
  const bad = (txt) => assert.ok(Geo.parsePair(txt).error, `debía fallar: ${txt}`);
  bad(''); bad('hola'); bad('95, 10'); bad('10, 200'); bad('4°75\'00"N 74W'); bad('4.5'); bad('4.5 abc 7');
  assert.ok(Geo.parseAngle('91', 'lat').error);
  assert.ok(Geo.parseAngle('4 W', 'lat').error);     // W no es de latitud
  assert.equal(Geo.parseAngle('  -74,5 ', 'lon').value, -74.5);
});

test('formato DMS redondea bien los 60"', () => {
  assert.equal(Geo.toDMS(4.999999999, 'lat', 2), "5° 00' 00.00\" N");
  assert.equal(Geo.toDMS(-74.0817, 'lon', 1), "74° 04' 54.1\" W");
});

test('lados que se cruzan se detectan y el orden angular lo corrige', () => {
  const bow = [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 1 }];   // moño
  assert.equal(Geo.selfIntersects(bow), true);
  const fixed = Geo.angularOrder(bow).map((i) => bow[i]);
  assert.equal(Geo.selfIntersects(fixed), false);
  near(Geo.polygonArea(fixed), Geo.polygonArea([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }]), 1);
  assert.equal(Geo.selfIntersects([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }]), false);
});

test('centroide de un rectángulo es su centro', () => {
  const c = Geo.centroid([{ lat: 4, lon: -75 }, { lat: 4, lon: -74 }, { lat: 5, lon: -74 }, { lat: 5, lon: -75 }]);
  near(c.lat, 4.5, 1e-4); near(c.lon, -74.5, 1e-4);
});

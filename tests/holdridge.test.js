const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../www/js/holdridge.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtenido ${a}`);

test('escala del diagrama: BT × 58,93 = ETP, igual que la gráfica de referencia', () => {
  near(H.petFromBT(24), 1414.32, 0.01);
  near(H.petFromBT(48), 2828.64, 0.01);
  near(H.petFromBT(1.5), 88.395, 0.001);
  const d = H.diagramData();
  const by = {}; d.btLines.forEach((l) => { by[l.bt] = l; });
  // Las líneas de 1,5·3·6·12·24 °C caen a media octava de los centros de fila (V = k + 0,5)
  [[1.5, -0.5], [3, 0.5], [6, 1.5], [12, 2.5], [24, 3.5]].forEach(([bt, v]) => near(by[bt].V, v, 0.001, 'V de ' + bt + '°'));
  near(d.frost.V, 3, 1e-12);                        // línea de escarcha = ETP 1000 mm
  near(d.frost.bt, 16.97, 0.01);
});

test('el diagrama tiene los 36 hexágonos de la referencia y la fila basal coincide con las provincias de humedad', () => {
  assert.equal(H.HEXES.length, 4 + 6 + 8 + 10 + 8);
  const row4 = H.HEXES.filter((h) => h.k === 4).sort((a, b) => b.r - a.r);
  const provs = row4.map((h) => H.humidityProvince(Math.pow(2, h.r)).id);
  assert.deepEqual(provs, ['superarido', 'perarido', 'arido', 'semiarido', 'subhumedo', 'humedo', 'perhumedo', 'superhumedo']);
  assert.deepEqual(row4.map((h) => h.names[0]), [
    'Desierto', 'Matorral desértico', 'Monte espinoso', 'Bosque muy seco', 'Bosque seco', 'Bosque húmedo', 'Bosque muy húmedo', 'Bosque pluvial']);
});

test('provincias de humedad: límites en potencias de 2', () => {
  const id = (per) => H.humidityProvince(per).id;
  assert.equal(id(32), 'desecado'); assert.equal(id(31.9), 'superarido');
  assert.equal(id(16), 'superarido'); assert.equal(id(8), 'perarido'); assert.equal(id(4), 'arido');
  assert.equal(id(2), 'semiarido'); assert.equal(id(1), 'subhumedo'); assert.equal(id(0.999), 'humedo');
  assert.equal(id(0.5), 'humedo'); assert.equal(id(0.25), 'perhumedo'); assert.equal(id(0.125), 'superhumedo');
  assert.equal(id(0.0625), 'semisaturado'); assert.equal(id(0.06), 'saturado');
  assert.equal(H.humidityProvince(0), null);
});

test('biotemperatura: media anual acotada a 0–30 y regla mensual de Holdridge', () => {
  assert.equal(H.biotemperature(-3), 0);
  assert.equal(H.biotemperature(35), 30);
  assert.equal(H.biotemperature(14.2), 14.2);
  assert.equal(H.biotemperature(null), null);
  // meses fuera de 0–30 cuentan como 0
  const m = [-10, -5, 2, 6, 10, 14, 16, 15, 11, 5, -2, -8];
  near(H.biotemperature(5, m), (2 + 6 + 10 + 14 + 16 + 15 + 11 + 5) / 12, 1e-12);
});

test('ciudades colombianas: coinciden con la clasificación de Holdridge citada para cada una', () => {
  const sym = (T, P) => H.classify({ T, P }).zone.symbol;
  assert.equal(sym(14, 1000), 'bh-MB');       // Bogotá
  assert.equal(sym(22, 1650), 'bh-PM');       // Medellín
  assert.equal(sym(27.5, 500), 'bms-T');      // Santa Marta
  assert.equal(sym(26, 2800), 'bh-T');        // Amazonía (Leticia)
  assert.equal(sym(4.5, 1000), 'pmh-SA');     // páramo
  assert.equal(sym(27, 8000), 'bp-T');        // Chocó (Quibdó)
});

test('cada hexágono se reconoce a sí mismo (ida y vuelta T,P → hexágono)', () => {
  H.HEXES.forEach((h) => {
    const variants = h.names.length === 2 ? [3 - 0.15, 3 + 0.15] : [h.k === 4 ? 3.75 : h.k];
    variants.forEach((V) => {
      // punto con el mismo X del centro y la V dada
      const U = (h.cx + V) / 2;
      const T = 125 * Math.pow(2, V) / H.PET_FACTOR, P = 125 * Math.pow(2, U);
      const c = H.classify({ T, P });
      assert.ok(c.ok && c.hex, JSON.stringify(h));
      assert.equal(c.hex.k, h.k, `fila de ${h.k}/${h.r}`);
      near(c.hex.r, h.r, 1e-9, `columna ${h.k}/${h.r}`);
      assert.equal(c.inDiagram, true);
    });
  });
});

test('línea de escarcha: bajo 16,97 °C templada cálida/montano bajo; sobre ese valor subtropical/premontano', () => {
  const lo = H.classify({ T: 16.9, P: 1500 }), hi = H.classify({ T: 17.05, P: 1500 });
  assert.equal(lo.zone.symbol, 'bh-MB'); assert.equal(lo.region, 'Templada cálida'); assert.equal(lo.belt, 'Montano bajo');
  assert.equal(hi.zone.symbol, 'bh-PM'); assert.equal(hi.region, 'Subtropical'); assert.equal(hi.belt, 'Premontano');
  // en la columna "estepa espinosa / monte espinoso"
  assert.equal(H.classify({ T: 16, P: 125 * Math.pow(2, 1.5) }).zone.base, 'Estepa espinosa');
  assert.equal(H.classify({ T: 18, P: 125 * Math.pow(2, 1.5) }).zone.base, 'Monte espinoso');
});

test('regiones latitudinales / pisos por biotemperatura', () => {
  const band = (t) => H.thermalBand(t).region;
  assert.equal(band(1), 'Polar'); assert.equal(band(2), 'Subpolar'); assert.equal(band(4), 'Boreal');
  assert.equal(band(9), 'Templada fría'); assert.equal(band(15), 'Templada cálida');
  assert.equal(band(20), 'Subtropical'); assert.equal(band(28), 'Tropical');
});

test('biotemperatura < 1,5 °C: nival, sin hexágono; sin precipitación: resultado parcial', () => {
  const n = H.classify({ T: 0.5, P: 400 });
  assert.equal(n.zone.symbol, 'N'); assert.equal(n.hex, null); assert.ok(n.warnings.length);
  const p = H.classify({ T: 14 });
  assert.equal(p.ok, false); assert.equal(p.partial, true); assert.equal(p.band.region, 'Templada cálida');
  assert.equal(H.classify({}).ok, false);
});

test('clima extremo fuera del diagrama usa el hexágono más cercano y avisa', () => {
  const c = H.classify({ T: 10, P: 20 });          // 20 mm/año a 10 °C
  assert.equal(c.ok, true); assert.equal(c.inDiagram, false); assert.ok(c.warnings.some((w) => /fuera del diagrama/.test(w)));
  assert.equal(c.zone.base, 'Desierto');
});

test('sensibilidad: un punto pegado al límite cambia con muy poco; uno central, con mucho', () => {
  const border = H.sensitivity({ T: 24.05, P: 950 });
  const center = H.sensitivity({ T: 27.5, P: 125 * Math.pow(2, 3.5) });
  // el cambio mínimo, en la dirección que sea, es pequeño cerca del borde (≤ 10 % de lluvia o ≤ 1,5 °C)
  const pMin = Math.min(border.pUp === null ? 999 : border.pUp, border.pDown === null ? 999 : border.pDown);
  const tMin = Math.min(border.tUp === null ? 999 : border.tUp, border.tDown === null ? 999 : border.tDown);
  assert.ok(pMin <= 10 || tMin <= 1.5, JSON.stringify(border));
  assert.ok((center.pUp || 999) > 20 && (center.pDown || 999) > 20, JSON.stringify(center));   // medio hexágono = 41 % arriba, 29 % abajo
});

test('el margen al límite es mayor en el centro de un hexágono que en el borde', () => {
  const cen = H.classify({ T: 27.5, P: 125 * Math.pow(2, 3.5) }).margin;
  const bor = H.classify({ T: 24.05, P: 950 }).margin;
  assert.ok(cen > bor, `${cen} vs ${bor}`);
});

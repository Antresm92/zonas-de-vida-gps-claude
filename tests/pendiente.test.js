'use strict';
/* 2.35.0 — pendiente honesta: una sola fuente de altitud, el margen por mínimos cuadrados (Gavin, ec. 18 y 3), la clase
   incierta al 68 o al 95 %, los lotes pequeños con altitud de internet, la pendiente medida en campo (rango o número) y lo que
   dicen la clase, la conclusión, la copia de seguridad y el reporte. Los casos de margen se calculan a mano en el comentario. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../www/js/geo.js');
const Perfil = require('../www/js/perfil.js');
const Usos = require('../www/js/usos.js');
const Cultivos = require('../www/js/cultivos.js');
const Backup = require('../www/js/backup.js');
const Report = require('../www/js/report.js');
const ReportPdf = require('../www/js/reportpdf.js');
const Analysis = require('../www/js/analysis.js');
const Climate = require('../www/js/climate.js');

const F0 = Geo.localFrame([{ lat: 5, lon: -75 }]);
// Un punto x metros al este e y al norte de (5, −75)
function at(x, y, alt, extra) { const ll = Geo.fromXY(F0, { x, y }); return Object.assign({ lat: ll.lat, lon: ll.lon, alt }, extra); }
// Las 4 esquinas de un rectángulo centrado de w m (este-oeste) por h m (norte-sur) que sube ge hacia el este y gn hacia el norte
function rect(w, h, ge, gn, extra) {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y], i) => at(x, y, 1500 + ge * x + gn * y, Object.assign({ name: 'P' + (i + 1) }, extra)));
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg ? msg + ': ' : '') + a + ' ≠ ' + b);
const aT = { climate: { T: 21 }, result: { ok: true, per: 0.7 } };      // templado y húmedo: por sí solos, clase 1

test('una sola fuente: el grupo con más puntos, empate en el orden de la app, los de afuera con su nombre', () => {
  const gps = rect(100, 100, 0, 0.3, { altSrc: 'gps', altAcc: 2 });
  let s = Perfil.slopeInfo(gps.concat([at(0, 0, 1400, { name: 'Casa', altSrc: 'manual' })]));
  assert.equal(s.ok, true); assert.equal(s.src, 'gps'); assert.equal(s.n, 4);
  assert.deepEqual(s.excluded, [{ name: 'Casa', src: 'manual' }]);
  near(s.pct, 30, 1e-6, 'la altitud a mano, 100 m más abajo, no tuerce la pendiente');
  // empate 3 y 3: manda el orden de la app (a mano, GPS, internet, archivo, sin dato)
  const tri = (dx, src, L) => [[0, 0], [L || 100, 0], [0, L || 100]].map(([x, y], i) => at(x + dx, y, 1500 + 0.1 * y, { name: src + i, altSrc: src }));
  s = Perfil.slopeInfo(tri(0, 'gps').concat(tri(300, 'manual')));
  assert.equal(s.src, 'manual'); assert.deepEqual(s.excluded.map((e) => e.name), ['gps0', 'gps1', 'gps2']);
  assert.equal(Perfil.slopeInfo(tri(0, 'sindato').concat(tri(300, 'archivo'))).src, 'archivo');
  assert.equal(Perfil.slopeInfo(tri(0, 'archivo', 400).concat(tri(900, 'internet', 400))).src, 'internet');
  // 2 y 2: no hay pendiente y se dice por qué
  const dos = rect(100, 100, 0, 0.1, {}).map((p, i) => Object.assign(p, { altSrc: i < 2 ? 'gps' : 'manual' }));
  s = Perfil.slopeInfo(dos);
  assert.equal(s.ok, false); assert.equal(s.mixed, true);
  assert.match(s.reason, /^Las altitudes vienen de fuentes distintas \(2 del GPS, 2 escritas a mano\): para la pendiente hacen falta 3 de la misma fuente/);
  assert.equal(Perfil.slope(dos), null);
  // sin nombre, el punto se nombra por su lugar en la lista
  s = Perfil.slopeInfo(gps.map(({ name, ...p }) => p).concat([at(0, 0, 1400, { altSrc: 'internet' })]));
  assert.deepEqual(s.excluded, [{ name: 'P5', src: 'internet' }]);
  // menos de 3 puntos con altitud o en línea: sin pendiente y sin motivo que mostrar (como antes)
  assert.deepEqual(Perfil.slopeInfo(gps.slice(0, 2)), { ok: false, reason: null });
  assert.deepEqual(Perfil.slopeInfo([at(0, 0, 1, {}), at(50, 0, 2, {}), at(100, 0, 3, {})]), { ok: false, reason: null });
});

test('margen: un cuadrado de 100 m con σz = 10 m da ±10 puntos (σ = σz ÷ lado), y se dobla al 95 %', () => {
  // esquinas a ±50 m: Σx² = Σy² = 4 · 50² = 10 000 m² y Σxy = 0 → var(b) = σz² ÷ 10 000 → σ = 10 ÷ 100 = 0,1 = 10 puntos
  let s = Perfil.slopeInfo(rect(100, 100, 0, 0.3, { altSrc: 'gps', altAcc: 10 }));
  near(s.sigma, 10, 1e-6); near(s.margin, 20, 1e-6); assert.equal(s.level, 2); assert.equal(s.marginKnown, true);
  near(s.low, 10, 1e-6); near(s.high, 50, 1e-6);
  s = Perfil.slopeInfo(rect(100, 100, 0, 0.3, { altSrc: 'gps', altAcc: 10 }), { level: 1 });
  near(s.margin, 10, 1e-6); assert.equal(s.level, 1);
  // el error de las altitudes del GPS es el promedio cuadrático de las precisiones guardadas: √((1 + 1 + 1 + 9) ÷ 4) = √3
  const pts = rect(100, 100, 0, 0.3, { altSrc: 'gps' });
  [1, 1, 1, 3].forEach((v, i) => { pts[i].altAcc = v; });
  near(Perfil.slopeInfo(pts).sigma, Math.sqrt(3), 1e-6);
  // los puntos del GPS sin precisión vertical no cuentan para el promedio
  pts[3].altAcc = null;
  near(Perfil.slopeInfo(pts).sigma, 1, 1e-6);
});

test('margen: depende de la dirección (ec. 3) y, casi plano, usa el eje largo de la covarianza', () => {
  // 200 × 100 m: Σx² = 4 · 100² = 40 000 y Σy² = 4 · 50² = 10 000; con σz = 2 m, σ hacia el norte = 2 ÷ 100 y hacia el este = 2 ÷ 200
  const norte = Perfil.slopeInfo(rect(200, 100, 0, 0.2, { altSrc: 'gps', altAcc: 2 }));
  const este = Perfil.slopeInfo(rect(200, 100, 0.2, 0, { altSrc: 'gps', altAcc: 2 }));
  near(norte.pct, 20, 1e-6); near(este.pct, 20, 1e-6);
  near(norte.sigma, 2, 1e-6, 'hacia el norte'); near(este.sigma, 1, 1e-6, 'hacia el este');
  // 2 % hacia el este es menos que dos veces el eje largo (2 %): se usa el eje largo (2), no la ec. 3 (que daría 1)
  near(Perfil.slopeInfo(rect(200, 100, 0.02, 0, { altSrc: 'gps', altAcc: 2 })).sigma, 2, 1e-6);
  const plano = Perfil.slopeInfo(rect(200, 100, 0, 0, { altSrc: 'gps', altAcc: 1 }));
  near(plano.pct, 0, 1e-9); near(plano.sigma, 1, 1e-6); assert.equal(plano.low, 0, 'la pendiente no baja de 0');
  assert.deepEqual(plano.classes.map((c) => c.code), ['a']); assert.equal(plano.uncertain, false);
});

test('clase incierta justo a cada lado de 3, 7, 12, 25, 50 y 75 %, firme lejos de ellos, con las dos opciones del margen', () => {
  const CODES = 'abcdefg';
  [3, 7, 12, 25, 50, 75].forEach((B, i) => {
    for (const side of [-1, 1]) {
      // σ = 0,4 puntos: al 68 % (± 0,4) no llega al límite que está a 0,5; al 95 % (± 0,8) lo cruza
      const pts = rect(100, 100, 0, (B + side * 0.5) / 100, { altSrc: 'gps', altAcc: 0.4 });
      const s68 = Perfil.slopeInfo(pts, { level: 1 }), s95 = Perfil.slopeInfo(pts, { level: 2 });
      near(s68.sigma, 0.4, 1e-6);
      assert.equal(s68.uncertain, false, (B + side * 0.5) + ' % al 68 %');
      assert.deepEqual(s68.classes.map((c) => c.code), [CODES[side < 0 ? i : i + 1]]);
      assert.equal(s95.uncertain, true, (B + side * 0.5) + ' % al 95 %');
      assert.deepEqual(s95.classes.map((c) => c.code), [CODES[i], CODES[i + 1]]);
    }
  });
  const lejos = Perfil.slopeInfo(rect(100, 100, 0, 0.18, { altSrc: 'gps', altAcc: 1.25 }));   // 18 % ± 2,5 (95 %): 15,5–20,5
  assert.equal(lejos.uncertain, false); assert.equal(lejos.cls.code, 'd');
  // un límite cuenta solo si queda estrictamente adentro
  const codes = (lo, hi) => Perfil.classesIn(lo, hi).map((c) => c.code);
  assert.deepEqual(codes(9, 12), ['c']); assert.deepEqual(codes(12, 13), ['d']); assert.deepEqual(codes(2.9, 7.1), ['a', 'b', 'c']);
  assert.deepEqual(codes(0, 0), ['a']); assert.deepEqual(codes(80, 90), ['g']);
  assert.equal(Perfil.rangesText(Perfil.classesIn(2.9, 7.1)), '0–3, 3–7 o 7–12 %');
  assert.equal(Perfil.rangesText(Perfil.classesIn(70, 80)), '50–75 o más de 75 %');
});

test('internet: en un lote de menos de 270 m no hay pendiente; en uno grande, con el error de GLO-90 y el aviso de la superficie', () => {
  let s = Perfil.slopeInfo(rect(100, 100, 0, 0.2, { altSrc: 'internet' }));
  assert.equal(s.ok, false); assert.equal(s.small, true);
  assert.match(s.reason, /celdas de 90 m.*a menos de 270 m entre sí/);
  assert.equal(Perfil.slopeInfo(rect(190, 190, 0, 0.2, { altSrc: 'internet' })).small, true, 'la diagonal mide 269 m');
  s = Perfil.slopeInfo(rect(400, 400, 0, 0.2, { altSrc: 'internet' }));
  assert.equal(s.ok, true); assert.equal(s.surface, true);
  near(s.sigma, 100 * (4 / 1.645) / 400, 1e-6, 'σz = 4 ÷ 1,645 m (GLO-90: menos de 4 m al 90 %) sobre 400 m');
  near(Perfil.DEM_SIGMA, 2.4316, 1e-4); assert.equal(Perfil.DEM_MIN_SPAN, 270);
  // el GPS no tiene ese límite: un lote pequeño sí da pendiente
  assert.equal(Perfil.slopeInfo(rect(100, 100, 0, 0.2, { altSrc: 'gps', altAcc: 1 })).ok, true);
});

test('altitudes a mano, de un archivo, sin dato o del GPS sin precisión: la pendiente sale con «margen desconocido»', () => {
  for (const src of ['manual', 'archivo', undefined]) {
    const s = Perfil.slopeInfo(rect(100, 100, 0, 0.11, src ? { altSrc: src } : {}));
    assert.equal(s.ok, true); assert.equal(s.marginKnown, false); assert.equal(s.margin, null); assert.equal(s.uncertain, false);
    assert.equal(s.src, src || 'sindato');
    assert.equal(Perfil.slopeText(s), '11 %');
    assert.deepEqual(s.classes.map((c) => c.code), ['c']);
  }
  const sinAcc = Perfil.slopeInfo(rect(100, 100, 0, 0.11, { altSrc: 'gps' }));
  assert.equal(sinAcc.marginKnown, false, 'GPS sin precisión vertical guardada');
  assert.deepEqual(Perfil.slopeRows(sinAcc)[0], ['Pendiente media del terreno', '11 % · 6,3° · baja hacia el sur · margen desconocido (altitudes del GPS)']);
});

test('proyectos viejos: puntos sin origen ni precisión dan la misma pendiente de antes, sin margen', () => {
  const s = Perfil.slope(rect(100, 100, 0, 0.18, {}));
  near(s.pct, 18, 1e-6); near(s.deg, Math.atan(0.18) * 180 / Math.PI, 1e-9);
  assert.equal(s.cls.code, 'd'); assert.equal(s.n, 4); assert.equal(s.wind, 'el sur'); assert.equal(s.marginKnown, false);
});

test('textos: el margen con un decimal y su nivel, la clase incierta con sus rangos y las altitudes usadas', () => {
  const pts = rect(100, 100, 0, 0.104, { altSrc: 'gps', altAcc: 1.2 });
  const s95 = Perfil.slopeInfo(pts), s68 = Perfil.slopeInfo(pts, { level: 1 });
  assert.equal(Perfil.slopeText(s95), '10,4 % ± 2,4 % (95 %)');
  assert.equal(Perfil.slopeShort(s68), '10,4 % ± 1,2 %'); assert.equal(Perfil.levelText(s68), '68 %');
  assert.deepEqual(Perfil.slopeRows(s95), [['Pendiente media del terreno', '10,4 % ± 2,4 % (95 %) · 5,9° · baja hacia el sur'], ['Clase de pendiente (IGAC)', 'incierta: puede ser 7–12 o 12–25 %']]);
  assert.deepEqual(Perfil.slopeRows(s68)[1], ['Clase de pendiente (IGAC)', 'c · moderadamente inclinado (7–12 %)']);
  // margen menor de 0,1: dos decimales, para que no salga «± 0,0 %»
  assert.match(Perfil.slopeText(Perfil.slopeInfo(rect(6000, 6000, 0, 0.3, { altSrc: 'internet' }))), /^30,00 % ± 0,0\d % \(95 %\)$/);
  // con puntos por fuera o con internet: la fila «Altitudes usadas para la pendiente»
  const mix = Perfil.slopeInfo(pts.concat([at(0, 0, 1400, { name: 'Casa', altSrc: 'manual' })]));
  assert.deepEqual(Perfil.slopeRows(mix)[2], ['Altitudes usadas para la pendiente', '4 del GPS; no se usaron Casa (escritas a mano)']);
  assert.deepEqual(Perfil.slopeRows(Perfil.slopeInfo(rect(400, 400, 0, 0.2, { altSrc: 'internet' })))[2],
    ['Altitudes usadas para la pendiente', '4 de internet (superficie del terreno, con árboles y construcciones)']);
  assert.equal(Perfil.slopeRows(s95).length, 2, 'sin puntos por fuera ni internet, no hay fila de más');
  // sin pendiente con motivo: una fila que lo dice; sin motivo, nada
  assert.match(Perfil.slopeRows(null, Perfil.slopeInfo(rect(100, 100, 0, 0.2, { altSrc: 'internet' })))[0][1], /^no se calcula: Las altitudes son de internet/);
  assert.deepEqual(Perfil.slopeRows(null, Perfil.slopeInfo([])), []);
});

test('el perfil trae los avisos: el margen con su nivel, los puntos por fuera, la superficie, la clase incierta y el motivo', () => {
  const pts = rect(100, 100, 0, 0.104, { altSrc: 'gps', altAcc: 1.2 });
  let m = Perfil.build(pts);
  assert.ok(m.notes.some((n) => /ajustar un plano a los 4 puntos con altitudes del GPS, con su margen al 95 %/.test(n)), m.notes.join(' | '));
  assert.ok(m.notes.some((n) => /puede estar en 2 clases del IGAC: mídela en campo/.test(n)));
  m = Perfil.build(pts, { level: 1 });
  assert.ok(m.notes.some((n) => /con su margen al 68 %/.test(n))); assert.ok(!m.notes.some((n) => /clases del IGAC/.test(n)));
  m = Perfil.build(pts.concat([at(0, 0, 1400, { name: 'Casa', altSrc: 'manual' })]));
  assert.ok(m.notes.includes('Para la pendiente no se usaron Casa (escritas a mano), para no mezclar altitudes medidas de forma distinta.'));
  m = Perfil.build(rect(100, 100, 0, 0.2, { altSrc: 'manual' }));
  assert.ok(m.notes.some((n) => /su margen es desconocido porque no se sabe con qué precisión se midieron/.test(n)));
  m = Perfil.build(rect(400, 400, 0, 0.2, { altSrc: 'internet' }));
  assert.ok(m.notes.some((n) => /^Las altitudes de internet son de la superficie del terreno/.test(n)));
  m = Perfil.build(rect(100, 100, 0, 0.2, { altSrc: 'internet' }));
  assert.equal(m.ok, true); assert.equal(m.slope, null); assert.ok(m.notes.some((n) => /^Las altitudes son de internet/.test(n)));
  assert.equal(Perfil.rows(m)[0][0], 'Pendiente media del terreno');
});

test('la pendiente medida como número: con coma o punto, se guarda con punto, de 0 a 300 %', () => {
  assert.equal(Usos.pctToStore('16'), '16'); assert.equal(Usos.pctToStore('16,5'), '16.5'); assert.equal(Usos.pctToStore(' 9.25 '), '9.3');
  assert.equal(Usos.pctToStore('0'), '0'); assert.equal(Usos.pctToStore('300'), '300');
  for (const bad of ['', 'abc', '-3', '301', '1e2', '16,5,1', '16.', '.5', null, undefined]) assert.equal(Usos.pctToStore(bad), null, String(bad));
  assert.equal(Usos.measuredPct('16.5'), 16.5); assert.equal(Usos.measuredPct('16'), 16);
  for (const bad of ['16,5', '16.55', 16, '400', '', null]) assert.equal(Usos.measuredPct(bad), null, String(bad));
});

test('lo de campo manda: el número sobre el rango (y pone el suyo), el rango sobre la calculada; los dos salen marcados así', () => {
  assert.deepEqual(Usos.clean({ pendientePct: '16.5' }), { pendientePct: '16.5' });
  for (const bad of ['16,5', 16, '999']) assert.equal(Usos.clean({ pendientePct: bad }), null, String(bad));
  const pts = rect(100, 100, 0, 0.104, { altSrc: 'gps', altAcc: 1.2 });
  let m = Usos.model(pts, aT, { pendiente: '0-3', pendientePct: '16' }, null);
  assert.deepEqual(m.medida, { pct: 16, cat: '12-25' }); assert.equal(m.datos.pendiente, '12-25'); assert.equal(m.eval.clase, 4);
  assert.equal(Usos.slopeForClassText(m), '16 %, medida en campo (12–25 %); calculada: 10,4 % ± 2,4 % (95 %)');
  assert.equal(Usos.slopePct(m), 16); assert.equal(m.conPendiente, null);
  assert.ok(Usos.reportRows(m).some((r) => r[0] === 'Pendiente para la clase' && /medida en campo/.test(r[1])));
  m = Usos.model(pts, aT, { pendiente: '7-12' }, null);
  assert.deepEqual(m.medida, { pct: null, cat: '7-12' }); assert.equal(m.eval.clase, 3);
  assert.equal(Usos.slopeForClassText(m), '7–12 %, medida en campo; calculada: 10,4 % ± 2,4 % (95 %)');
  assert.equal(Usos.slopePct(m), null, 'un rango no es un número');
  // con decimales y sin pendiente calculada
  m = Usos.model([], {}, { pendientePct: '9.5' }, null);
  assert.equal(Usos.slopeForClassText(m), '9,5 %, medida en campo (7–12 %)');
});

test('la pendiente incierta no entra a la clase: cuenta como «No sé», queda provisional y se dice qué clase daría', () => {
  const pts = rect(100, 100, 0, 0.104, { altSrc: 'gps', altAcc: 1.2 });
  const m = Usos.model(pts, aT, null, null);
  assert.equal(m.auto.pendiente.uncertain, true); assert.equal(m.auto.pendiente.cat, null);
  assert.equal(m.datos.pendiente, undefined); assert.equal(m.eval.provisional, true); assert.equal(m.eval.clase, 1);
  assert.deepEqual(m.conPendiente, [3, 4], 'con 7–12 % sería clase 3 y con 12–25 %, clase 4: nunca 1');
  assert.equal(Usos.slopePct(m), null);
  assert.equal(Usos.slopeForClassText(m), 'incierta: 10,4 % ± 2,4 % (95 %), puede ser 7–12 o 12–25 %; no entra a la clase hasta medirla en campo (con ella sería clase 3 o 4)');
  // al 68 % la misma pendiente es firme y entra a la clase
  const m68 = Usos.model(pts, aT, null, null, { level: 1 });
  assert.equal(m68.datos.pendiente, '7-12'); assert.equal(m68.eval.clase, 3); assert.equal(m68.conPendiente, null);
  assert.equal(Usos.slopeForClassText(m68), '10,4 % ± 1,2 % (68 %), calculada (7–12 %)');
  assert.equal(Usos.slopePct(m68), m68.auto.pendiente.pct);
  // con altitudes a mano: entra a la clase, con su aviso
  const mm = Usos.model(rect(100, 100, 0, 0.3, { altSrc: 'manual' }), aT, null, null);
  assert.equal(mm.datos.pendiente, '25-50'); assert.equal(Usos.slopeForClassText(mm), '30 %, calculada con altitudes escritas a mano (margen desconocido)');
  assert.equal(Usos.clasesText([3]), 'clase 3'); assert.equal(Usos.clasesText([3, 4, 6]), 'clase 3, 4 o 6');
});

test('sin pendiente: con motivo, el reporte lo dice; sin motivo, nada', () => {
  const m = Usos.model(rect(100, 100, 0, 0.2, { altSrc: 'internet' }), aT, null, null);
  assert.equal(m.auto.pendiente, null); assert.match(m.auto.pendienteNo, /^Las altitudes son de internet/);
  assert.match(Usos.slopeForClassText(m), /^no se calcula: Las altitudes son de internet/);
  assert.equal(Usos.slopeForClassText(Usos.model([], {}, null, null)), '');
  assert.equal(Usos.reportRows(Usos.model([], aT, null, null)).some((r) => r[0] === 'Pendiente para la clase'), false);
});

test('la conclusión: con la pendiente medida solo como rango usa el rango; incierta, pide medirla en campo', () => {
  const base = { nombre: 'Lote', T: 21, P: 1800, clase: 3, subclase: '3p', limita: [], provisional: false, faltan: 0, lab: true };
  const t = (m) => Cultivos.conclusion(Object.assign({}, base, m)).recomendaciones.map((r) => r.t);
  assert.ok(t({ pendiente: 30 }).some((x) => /^Con 30 % de pendiente, preferir cultivos permanentes/.test(x)));
  assert.ok(t({ pendiente: null, pendienteRango: { cat: '25-50', txt: '25–50 %' } }).some((x) => /^Con 25–50 % de pendiente, preferir cultivos permanentes/.test(x)));
  assert.ok(t({ pendiente: null, pendienteRango: { cat: '7-12', txt: '7–12 %' } }).some((x) => /^Con 7–12 % de pendiente, sembrar con prácticas de conservación/.test(x)));
  assert.ok(!t({ pendiente: null, pendienteRango: { cat: '0-3', txt: '0–3 %' } }).some((x) => /de pendiente/.test(x)));
  assert.ok(t({ pendiente: 9, pendienteRango: { cat: '25-50', txt: '25–50 %' } }).some((x) => /^Con 9 % de pendiente, sembrar/.test(x)), 'el número manda');
  assert.ok(t({ pendiente: null, pendienteIncierta: 'clase 3 o 4' }).includes('Medir la pendiente en campo, con un clinómetro o un nivel: la calculada es incierta y con ella sería clase 3 o 4.'));
  assert.ok(!t({ pendiente: 30 }).some((x) => /^Medir la pendiente/.test(x)));
});

test('la pendiente medida viaja en la copia de seguridad', () => {
  const state = { version: 1, currentId: 'p1', projects: [{ id: 'p1', name: 'Finca', created: 1, layers: [], lotId: 'l1',
    lots: [{ id: 'l1', name: 'Predio', kind: 'finca', points: [], climate: {}, nextPoint: 1, mainColor: '#2F8F4E', terreno: { pendiente: '12-25', pendientePct: '16.5' } }] }] };
  const res = Backup.validate(JSON.parse(Backup.stringify(Backup.create(state, []))), {});
  assert.equal(res.ok, true, res.errors.join(' '));
  assert.deepEqual(res.data.projects[0].lots[0].terreno, { pendiente: '12-25', pendientePct: '16.5' });
});

test('el reporte dice con qué margen salió la clase: HTML y PDF, al 95 % (viene así) o al 68 %', () => {
  const project = { name: 'Finca', points: rect(100, 100, 0, 0.104, { altSrc: 'gps', altAcc: 1.2 }), climate: { tManual: 21, pManual: 1800 } };
  const a = Analysis.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() });
  let h = Report.html(project, a, {});
  assert.match(h, /<th>Pendiente media del terreno<\/th><td>10,4 % ± 2,4 % \(95 %\) · 5,9° · baja hacia el sur<\/td>/);
  assert.match(h, /<th>Clase de pendiente \(IGAC\)<\/th><td>incierta: puede ser 7–12 o 12–25 %<\/td>/);
  h = Report.html(project, a, { slopeLevel: 1 });
  assert.match(h, /<th>Pendiente media del terreno<\/th><td>10,4 % ± 1,2 % \(68 %\)/);
  assert.match(h, /<th>Clase de pendiente \(IGAC\)<\/th><td>c · moderadamente inclinado \(7–12 %\)<\/td>/);
  const filasPdf = (o) => ReportPdf.blocks(project, a, o, {}).filter((b) => b.t === 'table').flatMap((b) => b.rows);
  assert.ok(filasPdf({ slopeLevel: 1 }).some((r) => r[0] === 'Pendiente media del terreno' && /± 1,2 % \(68 %\)/.test(r[1])));
  assert.ok(filasPdf({}).some((r) => r[0] === 'Clase de pendiente (IGAC)' && r[1] === 'incierta: puede ser 7–12 o 12–25 %'));
});

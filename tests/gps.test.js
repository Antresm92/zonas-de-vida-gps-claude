'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Gps = require('../www/js/gps.js');

// GPS de mentira: emite lecturas cada "every" ms con la precisión que diga accAt(i)
function fakeGeo(accAt, every) {
  let timer = null, n = 0, cb = null;
  return {
    watchPosition(ok) { cb = ok; timer = setInterval(() => { cb({ coords: { latitude: 4.6 + n * 1e-7, longitude: -74.08, altitude: 2640, accuracy: accAt(n), altitudeAccuracy: 8 }, timestamp: Date.now() }); n++; }, every); return 1; },
    clearWatch() { clearInterval(timer); },
    get count() { return n; }
  };
}

test('precisionState: sin límite, sin lectura, cumple y no cumple', () => {
  assert.equal(Gps.precisionState(12, 0).level, 'off');
  assert.equal(Gps.precisionState(12, null).level, 'off');
  assert.equal(Gps.precisionState(null, 5).level, 'none');
  assert.equal(Gps.precisionState(4.9, 5).level, 'ok');
  assert.equal(Gps.precisionState(5, 5).level, 'ok');
  const bad = Gps.precisionState(12, 5);
  assert.equal(bad.level, 'bad'); assert.equal(bad.worse, true); assert.equal(bad.over, 7);
});

test('precisionText: avisa que el punto no será el más preciso solo cuando no cumple', () => {
  assert.match(Gps.precisionText(12, 5), /±12 m.*±5 m.*no será el más preciso/);
  assert.match(Gps.precisionText(3, 5), /suficiente/);
  assert.equal(Gps.precisionText(12, 0), '');
  assert.equal(Gps.precisionText(null, 5), '');
});

test('sample: termina antes si ya logra la precisión buena', async () => {
  const geo = fakeGeo((i) => 9 - i * 2, 50);              // 9, 7, 5, 3 …
  const t0 = Date.now();
  const r = await Gps.sample({ geo, seconds: 5, goodAcc: 5, minSamples: 4 });
  assert.ok(Date.now() - t0 < 2500, 'no debía esperar los 5 s');
  assert.ok(r.acc <= 5);
  assert.ok(r.total >= 4);
});

test('sample con precisión objetivo: sigue esperando pasado el tiempo y entrega lo mejor que logró', async () => {
  const geo = fakeGeo(() => 8, 100);                       // siempre ±8 m, nunca llega a 5
  const t0 = Date.now();
  const r = await Gps.sample({ geo, seconds: 1, goodAcc: 1, minSamples: 4, targetAcc: 5, maxSeconds: 2.2 });
  const dt = Date.now() - t0;
  assert.ok(dt >= 2000 && dt < 3500, 'esperó hasta el máximo (' + dt + ' ms)');
  assert.equal(r.acc, 8);
  assert.equal(Gps.precisionState(r.acc, 5).level, 'bad');
});

test('sample con precisión objetivo: si se logra a tiempo, no espera de más', async () => {
  const geo = fakeGeo((i) => (i < 6 ? 9 : 4), 100);       // mejora a ±4 m en la lectura 7 (~0,6 s)
  const t0 = Date.now();
  const r = await Gps.sample({ geo, seconds: 1, goodAcc: 1, minSamples: 4, targetAcc: 5, maxSeconds: 6 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.acc, 4);
});

/* ---------- Mensajes, disponibilidad y promedio ---------- */
test('explain: un mensaje claro para cada tipo de error', () => {
  assert.match(Gps.explain({ code: 1 }), /Sin permiso de ubicación/);
  assert.match(Gps.explain({ code: 2 }), /No hay señal de GPS/);
  assert.match(Gps.explain({ code: 3 }), /no responde.*ubicación del teléfono esté activada.*lugar abierto/);
  assert.equal(Gps.explain(new Error('algo raro')), 'No se pudo leer el GPS: algo raro');
  assert.equal(Gps.explain(null), 'No se pudo leer el GPS.');
});

test('isOff: permiso negado (1), posición no disponible (2) o tardó demasiado (3) sin ninguna lectura cuentan como GPS apagado', () => {
  assert.equal(Gps.isOff({ code: 1 }), true);
  assert.equal(Gps.isOff({ code: 2 }), true);
  assert.equal(Gps.isOff({ code: 3 }), true);            // tardó demasiado sin ninguna lectura: así responde Android con la ubicación apagada
  assert.equal(Gps.isOff({ code: 3 }, false), true);
  assert.equal(Gps.isOff({ code: 3 }, true), false);     // ya hubo lecturas: pérdida de señal pasajera, solo se avisa
  assert.equal(Gps.isOff({ code: 2 }, true), true);
  assert.equal(Gps.isOff({ code: 1 }, true), true);
  assert.equal(Gps.isOff(new Error('Tiempo agotado')), false);
  assert.equal(Gps.isOff(null), false);
  assert.equal(Gps.isOff(undefined), false);
});

test('offNotice: el aviso «¿Usar sin GPS?» explica el motivo y lo que hace cada respuesta', () => {
  const perm = Gps.offNotice({ code: 1 });
  assert.equal(perm.kind, 'permiso');
  assert.equal(perm.main, Gps.explain({ code: 1 }));     // el mismo texto que ya se mostraba: cómo dar el permiso
  assert.match(perm.main, /Ajustes del teléfono/);
  assert.match(perm.no, /el GPS queda apagado/);
  for (const e of [{ code: 2 }, new Error('Tiempo agotado sin lecturas del GPS.'), null]) {
    const n = Gps.offNotice(e);
    assert.equal(n.kind, 'senal');
    assert.match(n.main, /apagado o no llega su señal/);
    assert.match(n.main, /Ajustes > Ubicación/);
    assert.match(n.no, /sigue buscando la señal/);
  }
  assert.match(perm.yes, /sigues sin GPS/);
  assert.equal(Gps.offNotice({ code: 2 }).yes, perm.yes);   // «Sí» significa lo mismo en los dos casos
});

test('available: hay GPS solo si el equipo lo expone', () => {
  assert.equal(Gps.available({}), true);
  assert.equal(Gps.available(null), false);              // en Node no existe navigator.geolocation
});

test('combine: sin lecturas no hay resultado; descarta las muy imprecisas; altitud por mediana', () => {
  assert.equal(Gps.combine([]), null);
  const base = { lon: -74.08, altAcc: 10 };
  const r = Gps.combine([
    Object.assign({ lat: 4.6000, alt: 2600, acc: 5 }, base), Object.assign({ lat: 4.6002, alt: 2640, acc: 6 }, base),
    Object.assign({ lat: 4.7000, alt: 9000, acc: 80 }, base),                 // lectura mala: se descarta
    Object.assign({ lat: 4.6001, alt: 2620, acc: 5.5 }, Object.assign({}, base, { altAcc: 7 }))
  ]);
  assert.equal(r.n, 3); assert.equal(r.total, 4);
  assert.equal(r.alt, 2620);                                                    // mediana de 2600, 2620, 2640
  // 2.34.2: promedio ponderado (peso 1/precisión²) y la precisión es el promedio de las usadas (5, 6 y 5,5; altitud 10, 10 y 7)
  const w = [1 / 25, 1 / 36, 1 / 30.25];
  assert.ok(Math.abs(r.lat - (4.6000 * w[0] + 4.6002 * w[1] + 4.6001 * w[2]) / (w[0] + w[1] + w[2])) < 1e-12);
  assert.ok(Math.abs(r.acc - 5.5) < 1e-12); assert.ok(Math.abs(r.altAcc - 9) < 1e-12);
  assert.equal(r.method, 'ponderado');
  // el método anterior (opcional en Preferencias) queda igual que siempre: todas pesan igual y la precisión es la de la mejor
  const viejo = Gps.combine([
    Object.assign({ lat: 4.6000, alt: 2600, acc: 5 }, base), Object.assign({ lat: 4.6002, alt: 2640, acc: 6 }, base),
    Object.assign({ lat: 4.7000, alt: 9000, acc: 80 }, base),
    Object.assign({ lat: 4.6001, alt: 2620, acc: 5.5 }, Object.assign({}, base, { altAcc: 7 }))
  ], 'simple');
  assert.ok(Math.abs(viejo.lat - 4.6001) < 1e-9);
  assert.equal(viejo.acc, 5); assert.equal(viejo.altAcc, 7); assert.equal(viejo.alt, 2620); assert.equal(viejo.n, 3); assert.equal(viejo.method, 'simple');
  const par = Gps.combine([{ lat: 1, lon: 1, alt: 100, acc: 5 }, { lat: 1, lon: 1, alt: 110, acc: 5 }]);
  assert.equal(par.alt, 105);                                                   // cantidad par: promedio de los dos del medio
  const sinDatos = Gps.combine([{ lat: 1, lon: 1, alt: null, acc: null }, { lat: 3, lon: 3, alt: null, acc: null }]);
  assert.equal(sinDatos.alt, null); assert.equal(sinDatos.acc, null); assert.equal(sinDatos.altAcc, null);
  assert.equal(sinDatos.lat, 2);                                                // sin precisión: se promedian todas
});

/* ---------- watch ---------- */
test('watch: entrega lecturas ya ordenadas, reenvía errores y se puede detener', () => {
  const sent = { cb: null, err: null, cleared: null, opts: null };
  const geo = { watchPosition(ok, bad, opts) { sent.cb = ok; sent.err = bad; sent.opts = opts; return 7; }, clearWatch(id) { sent.cleared = id; } };
  const fixes = [], errors = [];
  const stop = Gps.watch((f) => fixes.push(f), (e) => errors.push(e), geo);
  assert.equal(sent.opts.enableHighAccuracy, true);
  sent.cb({ coords: { latitude: 4.6, longitude: -74.08, altitude: 2640, accuracy: 7, altitudeAccuracy: 9 }, timestamp: 123 });
  sent.cb({ coords: { latitude: 4.7, longitude: -74.1, altitude: null, accuracy: NaN } });
  assert.deepEqual(fixes[0], { lat: 4.6, lon: -74.08, alt: 2640, acc: 7, altAcc: 9, ts: 123 });
  assert.equal(fixes[1].alt, null); assert.equal(fixes[1].acc, null); assert.equal(fixes[1].altAcc, null);
  assert.ok(isFinite(fixes[1].ts));
  sent.err({ code: 2 });
  assert.deepEqual(errors, [{ code: 2 }]);
  stop();
  assert.equal(sent.cleared, 7);
});

test('watch: sin GPS avisa el error y devuelve una función que no hace nada; clearWatch con error se ignora', () => {
  let err = null;
  const stop = Gps.watch(() => {}, (e) => { err = e; }, null);
  assert.match(err.message, /no tiene GPS accesible/);
  assert.doesNotThrow(stop);
  Gps.watch(() => {}, undefined, null);                                       // sin función de error tampoco falla
  const geo = { watchPosition: () => 1, clearWatch() { throw new Error('ya estaba detenido'); } };
  const stop2 = Gps.watch(() => {}, null, geo);
  assert.doesNotThrow(stop2);
  const sinError = { watchPosition(ok, bad) { bad({ code: 3 }); return 1; }, clearWatch() {} };
  assert.doesNotThrow(() => Gps.watch(() => {}, undefined, sinError));
});

/* ---------- sample: casos de error ---------- */
function scripted(steps) {                      // steps: lista de { at: ms, pos } o { at, err }
  let timers = [];
  return {
    watchPosition(ok, bad) { steps.forEach((s) => timers.push(setTimeout(() => (s.err ? bad(s.err) : ok(s.pos)), s.at))); return 1; },
    clearWatch() { timers.forEach(clearTimeout); timers = []; }
  };
}
const pos = (lat, acc) => ({ coords: { latitude: lat, longitude: -74.08, altitude: 2600, accuracy: acc, altitudeAccuracy: 5 }, timestamp: Date.now() });

test('sample: sin permiso termina de inmediato con ese error', async () => {
  const geo = scripted([{ at: 20, err: { code: 1 } }]);
  await assert.rejects(Gps.sample({ geo, seconds: 5 }), (e) => e.code === 1);
});

test('sample: un error de espera sin lecturas no la corta; sin ninguna lectura al final falla', async () => {
  const geo = scripted([{ at: 20, err: { code: 3 } }, { at: 40, err: { code: 2 } }]);
  await assert.rejects(Gps.sample({ geo, seconds: 1 }), /Tiempo agotado sin lecturas/);
});

test('sample: sin GPS rechaza; ignora lecturas sin coordenadas y avisa el avance', async () => {
  await assert.rejects(Gps.sample({ geo: null }), /no tiene GPS accesible/);
  await assert.rejects(Gps.sample(), /no tiene GPS accesible/);
  const progress = [];
  const geo = scripted([{ at: 10, pos: { coords: { latitude: NaN, longitude: NaN, accuracy: 3 } } }, { at: 30, pos: pos(4.6, 12) }, { at: 50, pos: pos(4.6, 11) }]);
  const r = await Gps.sample({ geo, seconds: 1, onProgress: (s, n) => progress.push([s.acc, n]) });
  assert.deepEqual(progress, [[12, 1], [11, 2]]);                              // la lectura sin coordenadas no cuenta
  assert.equal(r.n, 2); assert.equal(r.acc, 11.5, 'precisión promedio de 12 y 11 (2.34.2)'); assert.equal(r.method, 'ponderado');
  const geo2 = scripted([{ at: 30, pos: pos(4.6, 12) }, { at: 50, pos: pos(4.6, 11) }]);
  const v = await Gps.sample({ geo: geo2, seconds: 1, method: 'simple' });
  assert.equal(v.acc, 11, 'con el método anterior, la de la mejor'); assert.equal(v.method, 'simple');
});

test('sample: cancelar con la señal entrega lo leído, o falla si aún no hay nada', async () => {
  const geo = scripted([{ at: 20, pos: pos(4.6, 9) }]);
  const ac = new AbortController();
  const p = Gps.sample({ geo, seconds: 5, signal: ac.signal });
  setTimeout(() => ac.abort(), 120);
  const r = await p;
  assert.equal(r.n, 1);
  const vacio = new AbortController();
  const q = Gps.sample({ geo: scripted([]), seconds: 5, signal: vacio.signal });
  setTimeout(() => vacio.abort(), 20);
  await assert.rejects(q, /Cancelado/);
});

/* ---------- 2.34.2: promedio ponderado ---------- */
// Desplazamiento hacia el este, en metros, desde -74.08 a la latitud 4.6
const ESTE = (m) => -74.08 + m / (111320 * Math.cos(4.6 * Math.PI / 180));
const metros = (lon) => (lon + 74.08) * 111320 * Math.cos(4.6 * Math.PI / 180);

test('promedio ponderado: el ejemplo de la propuesta (±3, ±4 y ±4,5 m, a 0, 2 y 4 m al este)', () => {
  const lect = [{ lat: 4.6, lon: ESTE(0), acc: 3 }, { lat: 4.6, lon: ESTE(2), acc: 4 }, { lat: 4.6, lon: ESTE(4), acc: 4.5 }];
  const r = Gps.combine(lect);
  assert.ok(Math.abs(metros(r.lon) - 1.4464) < 0.001, 'más cerca de la lectura más precisa: ' + metros(r.lon));
  assert.ok(Math.abs(r.acc - 3.8333) < 0.001, 'precisión guardada: el promedio, ±4 m');
  const s = Gps.combine(lect, 'simple');
  assert.ok(Math.abs(metros(s.lon) - 2) < 0.001); assert.equal(s.acc, 3, 'antes: la de la mejor lectura');
});

test('promedio ponderado: una lectura de ±2 m pesa 4 veces lo que una de ±4 m', () => {
  const r = Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 2 }, { lat: 4.6, lon: ESTE(10), acc: 4 }]);
  assert.ok(Math.abs(metros(r.lon) - 2) < 0.001, '10 × 1/(4+1) = 2 m');
  // y el descarte de siempre sigue: con la mejor en ±4 m, una de ±8 m (más de 1,6 veces y de 3 m peor) no entra
  const d = Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 4 }, { lat: 4.6, lon: ESTE(10), acc: 8 }]);
  assert.equal(d.n, 1); assert.equal(d.total, 2); assert.ok(Math.abs(metros(d.lon)) < 0.001);
});

test('promedio ponderado: la dispersión dice cuánto se mueven las lecturas; una sola lectura no se mueve', () => {
  const quietas = Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 4 }, { lat: 4.6, lon: ESTE(0), acc: 4 }]);
  assert.ok(quietas.spread < 1e-6);
  const moviendo = Gps.combine([{ lat: 4.6, lon: ESTE(-3), acc: 4 }, { lat: 4.6, lon: ESTE(3), acc: 4 }]);
  assert.ok(Math.abs(moviendo.spread - 3) < 0.01, 'a 3 m del promedio cada una: ' + moviendo.spread);
  assert.equal(Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 4 }]).spread, 0);
});

test('promedio ponderado: una lectura sin precisión pesa como la peor conocida; sin ninguna, todas igual', () => {
  const r = Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 4 }, { lat: 4.6, lon: ESTE(6), acc: null }, { lat: 4.6, lon: ESTE(3), acc: 5 }]);
  const w = [1 / 16, 1 / 25, 1 / 25];
  assert.ok(Math.abs(metros(r.lon) - (0 * w[0] + 6 * w[1] + 3 * w[2]) / (w[0] + w[1] + w[2])) < 0.001);
  assert.ok(Math.abs(r.acc - 4.5) < 1e-12, 'el promedio de las que sí tienen precisión');
  const sin = Gps.combine([{ lat: 4.6, lon: ESTE(0) }, { lat: 4.6, lon: ESTE(4) }]);
  assert.ok(Math.abs(metros(sin.lon) - 2) < 0.001); assert.equal(sin.acc, null);
  const cero = Gps.combine([{ lat: 4.6, lon: ESTE(0), acc: 0 }, { lat: 4.6, lon: ESTE(1), acc: 0.05 }]);
  assert.ok(isFinite(cero.lat) && isFinite(cero.lon), 'una precisión de 0 no divide entre 0');
});

test('promedio ponderado: no se rompe cerca de ±180° de longitud', () => {
  const r = Gps.combine([{ lat: 0, lon: 179.9999, acc: 5 }, { lat: 0, lon: -179.9999, acc: 5 }]);
  assert.ok(Math.abs(Math.abs(r.lon) - 180) < 1e-9, String(r.lon));
  assert.equal(Gps.wrap180(190), -170); assert.equal(Gps.wrap180(-190), 170); assert.equal(Gps.wrap180(10), 10);
});

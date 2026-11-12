'use strict';
/* «Clima actual» (Open-Meteo): lectura de la respuesta, consulta con tiempo límite, guardado en el proyecto, copia de seguridad y reporte.
 * La consulta real a internet no se puede probar desde aquí: se usan respuestas simuladas con la forma que documenta Open-Meteo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Climate = require('../www/js/climate.js');
const Report = require('../www/js/report.js');
const Backup = require('../www/js/backup.js');
const Store = require('../www/js/store.js');
const A = require('../www/js/analysis.js');

const NOW = Date.UTC(2026, 9, 28, 19, 3);   // 28 oct 2026, 14:03 en Colombia
const RESP = {
  latitude: 4.6, longitude: -74.1, timezone: 'America/Bogota',
  current: { time: '2026-10-28T14:00', interval: 900, temperature_2m: 24.3, relative_humidity_2m: 87, weather_code: 1, pressure_msl: 1013.2, wind_speed_10m: 5.4 },
  daily: { time: ['2026-10-28'], sunrise: ['2026-10-28T05:44'], sunset: ['2026-10-28T17:42'] }
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const respuesta = (json, ok = true, status = 200) => () => Promise.resolve({ ok, status, json: () => Promise.resolve(json) });

/* ---------- lectura ---------- */
test('parseCurrent: lee temperatura, condición, viento, presión, humedad, amanecer y atardecer', () => {
  const w = Climate.parseCurrent(RESP, NOW);
  assert.deepEqual(w, { T: 24.3, humidity: 87, pressure: 1013.2, wind: 5.4, code: 1, sunrise: '05:44', sunset: '17:42', obs: '2026-10-28T14:00', at: NOW, source: 'Open-Meteo' });
});

test('parseCurrent: sin hora de consulta usa la de ahora; lo que falte queda en null; amanecer y atardecer pueden no venir (polos)', () => {
  const j = clone(RESP); delete j.daily; delete j.current.time; delete j.current.pressure_msl;
  const antes = Date.now();
  const w = Climate.parseCurrent(j);
  assert.ok(w.at >= antes && w.at <= Date.now());
  assert.equal(w.sunrise, null); assert.equal(w.sunset, null); assert.equal(w.obs, null); assert.equal(w.pressure, null);
  assert.equal(w.T, 24.3);
  const polar = clone(RESP); polar.daily = { sunrise: [null], sunset: [] };
  const p = Climate.parseCurrent(polar, NOW);
  assert.equal(p.sunrise, null); assert.equal(p.sunset, null);
});

test('parseCurrent: descarta lo que esté fuera de rango o no sea número, sin tumbar lo demás', () => {
  const j = clone(RESP);
  Object.assign(j.current, { temperature_2m: 300, relative_humidity_2m: 140, pressure_msl: 'mucha', wind_speed_10m: -3, weather_code: 3.5 });
  j.daily = { sunrise: ['mañana'], sunset: ['2026-10-28T25:99'] };
  assert.throws(() => Climate.parseCurrent(j, NOW), /no devolvió datos válidos/);
  j.current.relative_humidity_2m = 0;                       // 0 % es un valor válido
  const w = Climate.parseCurrent(j, NOW);
  assert.equal(w.humidity, 0);
  assert.equal(w.T, null); assert.equal(w.pressure, null); assert.equal(w.wind, null); assert.equal(w.code, null);
  assert.equal(w.sunrise, null); assert.equal(w.sunset, null);
});

test('parseCurrent: respuestas que no sirven fallan con un mensaje claro', () => {
  for (const malo of [null, undefined, 5, 'x', {}, { current: null }, { current: 7 }, { current: {} }]) {
    assert.throws(() => Climate.parseCurrent(malo, NOW), /Open-Meteo no devolvió/, JSON.stringify(malo));
  }
});

test('weatherText: códigos del tiempo en palabras; uno desconocido no inventa nada', () => {
  assert.equal(Climate.weatherText(0), 'Despejado');
  assert.equal(Climate.weatherText(1), 'Mayormente despejado');
  assert.equal(Climate.weatherText(3), 'Nublado');
  assert.equal(Climate.weatherText(63), 'Lluvia moderada');
  assert.equal(Climate.weatherText(95), 'Tormenta eléctrica');
  for (const raro of [4, 100, -1, null, undefined, 'x', NaN, '1']) assert.equal(Climate.weatherText(raro), 'Condición no reconocida', String(raro));
});

/* ---------- consulta ---------- */
test('fetchCurrent: pide a Open-Meteo el clima actual con las variables y el amanecer del día en la hora local', async () => {
  let pedida = null;
  const r = await Climate.fetchCurrent(4.6015, -74.0785, (u) => { pedida = u; return respuesta(RESP)(); }, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.data.T, 24.3);
  const u = new URL(pedida);
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '4.60150');
  assert.equal(u.searchParams.get('longitude'), '-74.07850');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,relative_humidity_2m,weather_code,pressure_msl,wind_speed_10m');
  assert.equal(u.searchParams.get('daily'), 'sunrise,sunset');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(u.searchParams.get('forecast_days'), '1');
});

test('fetchCurrent: nunca rechaza; dice por qué falló (HTTP, red, respuesta rota, coordenadas, sin red, tiempo)', async () => {
  assert.deepEqual(await Climate.fetchCurrent(4.6, -74.1, respuesta({}, false, 429)), { ok: false, error: 'HTTP 429' });
  assert.deepEqual(await Climate.fetchCurrent(4.6, -74.1, () => Promise.reject(new Error('Failed to fetch'))), { ok: false, error: 'Failed to fetch' });
  const rota = await Climate.fetchCurrent(4.6, -74.1, respuesta({ current: {} }));
  assert.equal(rota.ok, false); assert.match(rota.error, /Open-Meteo no devolvió/);
  assert.deepEqual(await Climate.fetchCurrent(95, 0, respuesta(RESP)), { ok: false, error: 'Las coordenadas no son válidas.' });
  assert.deepEqual(await Climate.fetchCurrent(NaN, 0, respuesta(RESP)), { ok: false, error: 'Las coordenadas no son válidas.' });
  assert.deepEqual(await Climate.fetchCurrent(0, 181, respuesta(RESP)), { ok: false, error: 'Las coordenadas no son válidas.' });
  const sinFetch = global.fetch; delete global.fetch;
  try { assert.deepEqual(await Climate.fetchCurrent(4.6, -74.1, null), { ok: false, error: 'Este dispositivo no puede hacer consultas de red.' }); }
  finally { if (sinFetch) global.fetch = sinFetch; }
  // sin respuesta a tiempo: se corta
  const lento = (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))); });
  assert.deepEqual(await Climate.fetchCurrent(4.6, -74.1, lento, { timeoutMs: 20 }), { ok: false, error: 'tardó demasiado en responder' });
});

/* ---------- filas, texto y reporte ---------- */
const W = { lat: 4.6015, lon: -74.0785, T: 24.3, humidity: 87, pressure: 1013.2, wind: 5.4, code: 1, sunrise: '05:44', sunset: '17:42', obs: '2026-10-28T14:00', at: NOW, source: 'Open-Meteo' };

test('currentRows: las siete filas con coma decimal y unidades; las que faltan no aparecen', () => {
  assert.deepEqual(Report.currentRows(W), [['Temperatura', '24,3 °C'], ['Condición', 'Mayormente despejado'], ['Viento', '5,4 km/h'], ['Presión', '1013 hPa'],
    ['Humedad', '87 %'], ['Amanecer', '05:44'], ['Atardecer', '17:42']]);
  assert.deepEqual(Report.currentRows({ T: 20, humidity: 50 }), [['Temperatura', '20,0 °C'], ['Humedad', '50 %']]);
  assert.deepEqual(Report.currentRows({ code: 999 }), [['Condición', 'Condición no reconocida']]);
  for (const nada of [null, undefined, {}, 5, 'x']) assert.deepEqual(Report.currentRows(nada), []);
  assert.deepEqual(Report.currentRows({ T: 'x', wind: NaN, sunrise: 5, sunset: '' }), []);
});

test('currentStamp: dice cuándo se consultó y de dónde salió', () => {
  assert.match(Report.currentStamp(W), /^Actualizado: .*2026.* · Open-Meteo$/);
  assert.equal(Report.currentStamp({}), 'Actualizado: fecha desconocida · Open-Meteo');
  assert.equal(Report.currentStamp(null), 'Actualizado: fecha desconocida · Open-Meteo');
});

const PUNTOS = [{ name: 'P1', lat: 4.60, lon: -74.10, alt: 1800 }, { name: 'P2', lat: 4.60, lon: -74.09, alt: 2400 }, { name: 'P3', lat: 4.61, lon: -74.09, alt: 3000 }];
function analizar(extra) {
  const project = Object.assign({ name: 'Finca', points: PUNTOS, climate: { pManual: 1100 }, layers: [], mainColor: '#2F8F4E' }, extra || {});
  return { project, a: A.analyze({ points: project.points, climate: project.climate }, { memory: new Climate.Memory() }) };
}

test('reporte (HTML): el clima actual aparece con su aviso de que no entra en el cálculo; sin consulta no aparece nada', () => {
  const con = analizar({ weatherNow: W });
  const h = Report.html(con.project, con.a, { date: NOW });
  assert.match(h, /<h2>Clima actual<\/h2><table>/);
  assert.match(h, /<tr><th>Temperatura<\/th><td>24,3 °C<\/td><\/tr>/);
  assert.match(h, /<tr><th>Condición<\/th><td>Mayormente despejado<\/td><\/tr>/);
  assert.match(h, /<tr><th>Atardecer<\/th><td>17:42<\/td><\/tr>/);
  assert.match(h, /Actualizado: [^<]*· Open-Meteo\. Condiciones del momento de la consulta[^<]*no entran en el cálculo de la zona de vida\./);
  assert.ok(h.indexOf('<h2>Clima actual</h2>') > h.indexOf('<h2>Datos del clima</h2>') && h.indexOf('<h2>Clima actual</h2>') < h.indexOf('<h2>Terreno</h2>'));
  const sin = analizar();
  assert.doesNotMatch(Report.html(sin.project, sin.a, { date: NOW }), /Clima actual/);
  const vacio = analizar({ weatherNow: {} });
  assert.doesNotMatch(Report.html(vacio.project, vacio.a, { date: NOW }), /Clima actual/);
});

test('reporte (HTML): un texto dentro de los datos no se cuela como código', () => {
  const x = analizar({ weatherNow: Object.assign({}, W, { sunrise: '<b>5</b>' }) });
  const h = Report.html(x.project, x.a, { date: NOW });
  assert.doesNotMatch(h, /<b>5<\/b>/);
  assert.match(h, /&lt;b&gt;5&lt;\/b&gt;/);
});

test('reporte (texto para copiar): lleva el clima actual antes de los puntos, o nada si no se consultó', () => {
  const con = analizar({ weatherNow: W });
  const t = Report.text(con.project, con.a, { date: NOW });
  assert.match(t, /Clima actual \(Actualizado: [^)]*Open-Meteo\):\n {2}Temperatura: 24,3 °C\n {2}Condición: Mayormente despejado\n {2}Viento: 5,4 km\/h\n {2}Presión: 1013 hPa\n {2}Humedad: 87 %\n {2}Amanecer: 05:44\n {2}Atardecer: 17:42\n {2}Condiciones del momento/);
  assert.ok(t.indexOf('Clima actual') < t.indexOf('Puntos:'));
  const sin = analizar();
  assert.doesNotMatch(Report.text(sin.project, sin.a, { date: NOW }), /Clima actual/);
});

/* ---------- guardado y copia de seguridad ---------- */
function estado(weatherNow) {
  const p = { id: 'p1', name: 'Finca', created: 1000, nextPoint: 4, mainColor: '#2F8F4E', points: PUNTOS.map((q, i) => Object.assign({ id: 'q' + i }, q)), climate: {}, layers: [] };
  if (weatherNow !== undefined) p.weatherNow = weatherNow;
  return { v: 1, currentId: 'p1', settings: { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' }, projects: [p] };
}
const opts = { uid: (() => { let n = 0; return () => 'u' + (++n); })(), now: NOW };

test('copia de seguridad: el clima actual viaja y vuelve igual; un proyecto sin consulta no gana el campo', () => {
  const b = Backup.create(estado(W), []);
  const r = Backup.validate(b, opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.projects[0].weatherNow, W);
  const sin = Backup.validate(Backup.create(estado(), []), opts);
  assert.equal('weatherNow' in sin.data.projects[0], false);
});

test('copia de seguridad: un clima actual manipulado se limpia (rangos, tipos, horas, fuente fija) o se descarta', () => {
  const sucio = { lat: 4.6, lon: -74.1, T: 999, humidity: 87, pressure: 'x', wind: -4, code: 1.5, sunrise: '5:44', sunset: '17:42', obs: 'ayer', at: -5, source: '<script>', extra: 'x' };
  const w = Backup.validate(Backup.create(estado(sucio), []), opts).data.projects[0].weatherNow;
  assert.deepEqual(w, { lat: 4.6, lon: -74.1, T: null, humidity: 87, pressure: null, wind: null, code: null, sunrise: null, sunset: '17:42', obs: null, at: null, source: 'Open-Meteo' });
  for (const malo of [null, 5, 'x', [], {}, { T: 999 }, { code: 'x', sunrise: '09:00' }]) {
    const r = Backup.validate(Backup.create(estado(malo), []), opts);
    assert.equal('weatherNow' in r.data.projects[0], false, JSON.stringify(malo));
  }
});

test('guardado en el equipo: un clima actual con forma rara se descarta al abrir; uno normal se conserva', () => {
  const memoria = {};
  Store.setBackend({ getItem: (k) => (k in memoria ? memoria[k] : null), setItem: (k, v) => { memoria[k] = v; }, removeItem: (k) => { delete memoria[k]; } });
  const e = estado(W); e.projects.push(Object.assign(clone(e.projects[0]), { id: 'p2', weatherNow: 'roto' }), Object.assign(clone(e.projects[0]), { id: 'p3', weatherNow: [1] }));
  Store.saveState(e);
  const s = Store.loadState();
  assert.deepEqual(s.projects[0].weatherNow, W);
  assert.equal('weatherNow' in s.projects[1].lots[0], false);                  // desde la 2.15.0 los datos están en el lote del proyecto
  assert.equal('weatherNow' in s.projects[2].lots[0], false);
  assert.equal('weatherNow' in Store.newProject('x').lots[0], false, 'un proyecto nuevo no trae clima actual');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Climate = require('../www/js/climate.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` esperado ${b} ± ${tol}, obtenido ${a}`);
const MESES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DIAS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TT = [14, 14.2, 14.5, 14.6, 14.4, 14, 13.8, 13.9, 14.1, 14.3, 14.2, 14];
const PD = [2, 3, 4.5, 6, 5.5, 2.5, 1.5, 1.4, 2.8, 6, 6.5, 4];       // mm/día
const PM = PD.map((v, i) => v * DIAS[i]);

function nasaClasico() {
  const T2M = { ANN: 14.15 }, P = { ANN: 3.8 };
  MESES.forEach((m, i) => { T2M[m] = TT[i]; P[m] = PD[i]; });
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.1, 4.6, 2543] }, properties: { parameter: { T2M, PRECTOTCORR: P } } };
}
function nasaNuevo() {
  return { normals: [
    { parameter: 'T2M', units: 'C', annual: 14.15, months: TT.map((v, i) => ({ month: i + 1, value: v })) },
    { parameter: 'PRECTOTCORR', units: 'mm/day', annual: 3.8, months: PD.map((v, i) => ({ month: MESES[i], value: v })) }
  ], elevation: 2543 };
}

test('parsePower: formato clásico trae T y P mensuales', () => {
  const r = Climate.parsePower(nasaClasico());
  near(r.T, 14.15, 1e-9); assert.deepEqual(r.monthlyT, TT);
  r.monthlyP.forEach((v, i) => near(v, PM[i], 1e-9));
  near(r.P, PM.reduce((a, b) => a + b, 0), 1e-6);
  assert.equal(r.elevCell, 2543); assert.equal(r.source, 'NASA POWER');
});

test('parsePower: formato nuevo (normals/months) da lo mismo', () => {
  const a = Climate.parsePower(nasaClasico()), b = Climate.parsePower(nasaNuevo());
  assert.deepEqual(b.monthlyT, a.monthlyT);
  b.monthlyP.forEach((v, i) => near(v, a.monthlyP[i], 1e-9));
  assert.equal(b.elevCell, 2543);
});

test('parsePower: meses con -999 no inventan datos; queda el anual', () => {
  const j = nasaClasico();
  j.properties.parameter.PRECTOTCORR.MAR = -999;
  const r = Climate.parsePower(j);
  assert.equal(r.monthlyP, null);
  near(r.P, 3.8 * 365.25, 1e-6);
  j.properties.parameter.T2M.JUN = -999;
  const r2 = Climate.parsePower(j);
  assert.equal(r2.monthlyT, null); near(r2.T, 14.15, 1e-9);
  assert.throws(() => Climate.parsePower({ normals: [] }), /inesperada/);
});

// Serie diaria de varios años para Open-Meteo
function diario(y0, y1, usarMedia = true) {
  const time = [], mean = [], max = [], min = [], prec = [];
  for (let y = y0; y <= y1; y++) for (let m = 0; m < 12; m++) {
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      time.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      mean.push(TT[m]); max.push(TT[m] + 4); min.push(TT[m] - 4); prec.push(PM[m] / dim);
    }
  }
  const daily = usarMedia ? { time, temperature_2m_mean: mean, precipitation_sum: prec } : { time, temperature_2m_max: max, temperature_2m_min: min, precipitation_sum: prec };
  return { elevation: 2650, daily };
}

test('parseOpenMeteo: promedia por mes y suma la lluvia mensual', () => {
  const r = Climate.parseOpenMeteo(diario(2015, 2024));
  r.monthlyT.forEach((v, i) => near(v, TT[i], 1e-9));
  assert.equal(r.elevCell, 2650); assert.deepEqual(r.years, [2015, 2024]);
  assert.equal(r.monthlyP.length, 12);
  r.monthlyP.forEach((v, i) => near(v, PM[i], 1e-6));
  near(r.P, r.monthlyP.reduce((a, b) => a + b, 0), 1e-9);
  const r2 = Climate.parseOpenMeteo(diario(2015, 2024, false));      // sin media: usa (máx + mín) / 2
  r2.monthlyT.forEach((v, i) => near(v, TT[i], 1e-9));
  assert.throws(() => Climate.parseOpenMeteo({}), /inesperada/);
  assert.throws(() => Climate.parseOpenMeteo({ daily: { time: ['2020-01-01'] } }), /no devolvió/);
});

test('parseOpenMeteo: un año con huecos grandes no cuenta; faltas pequeñas se escalan', () => {
  const j = diario(2020, 2023);
  // 2021: se borran 10 días de febrero → ese febrero no cuenta; en 2022 se borran 2 días de marzo → se escala
  j.daily.time.forEach((t, i) => { if (/^2021-02-(0[1-9]|10)$/.test(t)) j.daily.precipitation_sum[i] = null; if (/^2022-03-0[12]$/.test(t)) j.daily.precipitation_sum[i] = null; });
  const base = Climate.parseOpenMeteo(diario(2020, 2023));
  const r = Climate.parseOpenMeteo(j);
  near(r.monthlyP[1], base.monthlyP[1], 1e-6, 'febrero igual: el año incompleto se descarta');
  near(r.monthlyP[2], base.monthlyP[2], 1e-6, 'marzo igual: se escala por los 2 días que faltan');
});

function fakeFetch(handlers, calls) {
  return (url) => {
    calls.push(url);
    for (const [pat, fn] of handlers) if (url.includes(pat)) return fn(url);
    return Promise.reject(new Error('sin ruta'));
  };
}
const ok = (data) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
const fail = (code) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) });

test('fetchOnline: NASA completo → no consulta el respaldo', async () => {
  const calls = [];
  const f = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => ok(nasaClasico())]], calls);
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.equal(r.climate.source, 'NASA POWER'); assert.equal(r.errors.length, 0); assert.deepEqual(r.notes, []);
  assert.ok(!calls.some((u) => u.includes('archive-api')));
});

test('fetchOnline: NASA falla → usa Open-Meteo con los últimos 10 años completos', async () => {
  const calls = [];
  const f = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => fail(503)], ['archive-api', () => ok(diario(2015, 2024))]], calls);
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.match(r.climate.source, /Open-Meteo/); assert.equal(r.climate.monthlyT.length, 12); assert.equal(r.climate.monthlyP.length, 12);
  assert.equal(r.errors.length, 0);
  assert.match(r.notes[0], /NASA POWER no respondió.*HTTP 503.*Open-Meteo/);
  const u = calls.find((x) => x.includes('archive-api'));
  assert.match(u, /start_date=2015-01-01&end_date=2024-12-31/);
  assert.match(u, /daily=temperature_2m_mean,precipitation_sum/);
});

test('fetchOnline: NASA trae solo el anual → el respaldo completa los 12 meses', async () => {
  const j = nasaClasico(); j.properties.parameter.PRECTOTCORR.MAR = -999;
  const f = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => ok(j)], ['archive-api', () => ok(diario(2015, 2024))]], []);
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.match(r.climate.source, /Open-Meteo/); assert.match(r.notes[0], /no trajo los 12 meses/);
});

test('fetchOnline: Open-Meteo no acepta "mean" → reintenta con máx y mín', async () => {
  const calls = [];
  const f = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => fail(500)],
    ['archive-api', (u) => (u.includes('temperature_2m_mean') ? fail(400) : ok(diario(2015, 2024, false)))]], calls);
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.match(r.climate.source, /Open-Meteo/);
  assert.equal(calls.filter((x) => x.includes('archive-api')).length, 2);
});

test('fetchOnline: si todo falla queda un error claro y la altitud sigue llegando', async () => {
  const f = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => fail(500)], ['archive-api', () => fail(429)]], []);
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.equal(r.climate, null); assert.equal(r.elevation, 2600);
  assert.match(r.errors[0], /Clima: NASA POWER: HTTP 500.*Open-Meteo: HTTP 429/);
});

/* ---------- resolve con datos mensuales ---------- */
const base = { lat: 4.6, lon: -74.1, alt: 2640 };
test('resolve: 12 meses escritos a mano dan T media, P anual y series del diagrama', () => {
  const r = Climate.resolve({ ...base, monthlyManual: { T: TT, P: PM } });
  near(r.T, TT.reduce((a, b) => a + b, 0) / 12, 1e-9); assert.equal(r.TSrc, 'manual');
  near(r.P, PM.reduce((a, b) => a + b, 0), 1e-6); assert.equal(r.PSrc, 'manual');
  assert.deepEqual(r.chartT, TT); assert.deepEqual(r.chartP, PM); assert.deepEqual(r.monthlyT, TT);
  assert.deepEqual(r.chartSrc, { T: 'manual', P: 'manual' });
});

test('resolve: con meses incompletos no se usan (hay que escribir los 12)', () => {
  const T = TT.slice(); T[3] = null;
  const r = Climate.resolve({ ...base, monthlyManual: { T, P: null } });
  assert.equal(r.chartT, null); assert.equal(r.chartP, null); assert.equal(r.TSrc, 'estimada'); assert.equal(r.P, null);
});

test('resolve: el valor anual escrito manda sobre el promedio mensual y se avisa la diferencia', () => {
  const r = Climate.resolve({ ...base, tManual: 18, pManual: 2500, monthlyManual: { T: TT, P: PM } });
  assert.equal(r.T, 18); assert.equal(r.P, 2500);
  assert.ok(r.notes.some((n) => /temperatura anual que escribiste/.test(n)));
  assert.ok(r.notes.some((n) => /precipitación anual que escribiste/.test(n)));
  assert.deepEqual(r.chartT, TT);
  const r2 = Climate.resolve({ ...base, tManual: 14.2, pManual: Math.round(PM.reduce((a, b) => a + b, 0)), monthlyManual: { T: TT, P: PM } });
  assert.ok(!r2.notes.some((n) => /que escribiste/.test(n)), 'sin aviso si coinciden');
});

test('resolve: series de internet; la temperatura mensual se corrige por altitud como la anual', () => {
  const on = { T: 14.15, P: 1387, monthlyT: TT, monthlyP: PM, elevCell: 2543 };
  const r = Climate.resolve({ ...base, alt: 2000, online: on });
  const corr = -Climate.LAPSE * (2000 - 2543);
  r.chartT.forEach((v, i) => near(v, TT[i] + corr, 1e-9));
  assert.deepEqual(r.chartP, PM); assert.deepEqual(r.chartSrc, { T: 'online', P: 'online' });
  near(r.T, 14.15 + corr, 1e-9);
  // con T escrita a mano, el diagrama conserva los meses de internet
  const r2 = Climate.resolve({ ...base, alt: 2000, tManual: 20, online: on });
  assert.equal(r2.T, 20); r2.chartT.forEach((v, i) => near(v, TT[i] + corr, 1e-9));
  // los meses escritos mandan sobre los de internet
  const r3 = Climate.resolve({ ...base, alt: 2000, online: on, monthlyManual: { T: TT.map((t) => t + 1), P: PM.map((p) => p * 2) } });
  assert.deepEqual(r3.chartSrc, { T: 'manual', P: 'manual' });
});

test('resolve: sin datos mensuales las series quedan vacías', () => {
  const r = Climate.resolve({ ...base, online: { T: 14, P: 1000, monthlyT: null, elevCell: 2600 } });
  assert.equal(r.chartT, null); assert.equal(r.chartP, null);
});

// Error real que dejó pasar la versión 1: sin pasar una función "fetch" propia se usaba una variable inexistente
// y «Completar con internet» se quedaba pegado. Aquí se usa el fetch global, como hace la app.
test('fetchOnline: sin función propia usa el fetch global del navegador', async () => {
  const guardado = globalThis.fetch, calls = [];
  globalThis.fetch = fakeFetch([['v1/elevation', () => ok({ elevation: [2600] })], ['power.larc', () => ok(nasaClasico())]], calls);
  try {
    const r = await Climate.fetchOnline(4.6, -74.1, null, { timeoutMs: 500, year: 2025 });
    assert.equal(r.climate.source, 'NASA POWER'); assert.equal(r.errors.length, 0);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = guardado; }
});

test('fetchOnline: sin fetch disponible avisa en vez de fallar', async () => {
  const guardado = globalThis.fetch;
  delete globalThis.fetch;
  try {
    const r = await Climate.fetchOnline(4.6, -74.1, null, {});
    assert.match(r.errors[0], /no puede hacer consultas de red/);
  } finally { globalThis.fetch = guardado; }
});

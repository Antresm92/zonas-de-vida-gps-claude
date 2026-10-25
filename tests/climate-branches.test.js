'use strict';
/* Casos límite de climate.js: datos incompletos, archivos raros, respuestas de internet con formas distintas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Climate = require('../www/js/climate.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` esperado ${b} ± ${tol}, obtenido ${a}`);
const TT = [14, 14.2, 14.5, 14.6, 14.4, 14, 13.8, 13.9, 14.1, 14.3, 14.2, 14];
const PD = [2, 3, 4.5, 6, 5.5, 2.5, 1.5, 1.4, 2.8, 6, 6.5, 4];

test('temperatura a nivel del mar: dentro y fuera de los 40° de latitud, e incertidumbre por latitud', () => {
  near(Climate.seaLevelTemp(0), Climate.T0_EQUATOR, 1e-9);
  assert.ok(Climate.seaLevelTemp(10) < Climate.seaLevelTemp(0));
  assert.ok(Climate.seaLevelTemp(55) < Climate.seaLevelTemp(40));
  assert.equal(Climate.estimateUncertainty(5), 2);
  assert.equal(Climate.estimateUncertainty(-30), 4);
  assert.equal(Climate.estimateT(null, 100), null);
  assert.equal(Climate.estimateT(4, undefined), null);
});

test('Memory: ignora registros sin coordenadas o sin temperatura ni lluvia, y acepta una lista vacía', () => {
  const m = new Climate.Memory();
  m.add();
  m.add([{ lat: 'x', lon: 1, T: 10 }, { lat: 4, lon: -74 }, { lat: 4, lon: -74, T: null, P: null }, null && {}].filter(Boolean));
  assert.equal(m.count, 0);
  m.add([{ lat: 4, lon: -74, P: 900 }]);
  assert.equal(m.count, 1);
  assert.equal(m.all().length, 1);
  m.clear();
  assert.equal(m.count, 0);
  assert.deepEqual(m.near(4, -74, 25), []);
});

test('resolve con memoria: registros solo con lluvia no dan temperatura, y solo con temperatura no dan lluvia', () => {
  const soloP = new Climate.Memory(); soloP.add([{ lat: 4.6, lon: -74.1, P: 1200 }]);
  const a = Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2600 }, { memory: soloP });
  assert.equal(a.PSrc, 'memoria'); assert.equal(a.TSrc, 'estimada');
  const soloT = new Climate.Memory(); soloT.add([{ lat: 4.6, lon: -74.1, T: 14 }]);
  const b = Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2600 }, { memory: soloT });
  assert.equal(b.TSrc, 'memoria'); assert.equal(b.P, null);
  assert.match(b.notes.join(' '), /Falta la precipitación/);
});

test('resolve con memoria: la temperatura se ajusta por altitud solo si se conocen las dos altitudes', () => {
  const m = new Climate.Memory();
  m.add([{ lat: 4.6, lon: -74.1, T: 20, alt: 1000 }]);
  const con = Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2000 }, { memory: m });
  near(con.T, 20 - Climate.LAPSE * 1000, 1e-9); assert.match(con.notes.join(' '), /ajustada por altitud/);
  const sinPunto = Climate.resolve({ lat: 4.6, lon: -74.1, alt: null }, { memory: m });
  near(sinPunto.T, 20, 1e-9); assert.match(sinPunto.notes.join(' '), /sin ajuste por altitud/);
  const m2 = new Climate.Memory(); m2.add([{ lat: 4.6, lon: -74.1, T: 20 }]);
  near(Climate.resolve({ lat: 4.6, lon: -74.1, alt: 2000 }, { memory: m2 }).T, 20, 1e-9);
});

test('resolve sin altitud ni datos: avisa que falta la altitud', () => {
  const r = Climate.resolve({ lat: 4.6, lon: -74.1, alt: null }, {});
  assert.equal(r.T, null); assert.match(r.notes.join(' '), /Falta la altitud/);
});

test('resolve: temperatura de internet sin altitud no se corrige y lo dice', () => {
  const r = Climate.resolve({ lat: 4.6, lon: -74.1, alt: null, online: { T: 15, elevCell: 2500, monthlyT: TT } }, {});
  near(r.T, 15, 1e-9); assert.match(r.notes.join(' '), /SIN corregir/); assert.equal(r.monthlyT.length, 12);
});

test('parseCSV: archivo vacío, sin columnas útiles o con celdas vacías', () => {
  assert.match(Climate.parseCSV(null).errors[0], /vacío/);
  assert.match(Climate.parseCSV('lat,lon\n').errors[0], /vacío/);
  assert.match(Climate.parseCSV('a,b,temp\n1,2,3').errors[0], /latitud y longitud/);
  assert.match(Climate.parseCSV('lat,lon,alt\n4,-74,100').errors[0], /temperatura ni de precipitación/);
  const r = Climate.parseCSV('﻿lat,lon,temp,prec,nombre\n4.6,-74.1,NA,1000,\n4.7,-74.2,-999,,Solo nombre\n4.8,-74.3,14,abc,Ok');
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].name, ''); assert.equal(r.records[0].T, null); assert.equal(r.records[0].P, 1000);
  assert.equal(r.records[1].T, 14); assert.equal(r.records[1].P, null);
});

test('parseCSV: avisa de temperaturas y lluvias fuera de rango, y de filas con coordenadas malas', () => {
  const r = Climate.parseCSV('lat;lon;temp;prec\n4,6;-74,1;80;1000\n4,7;-74,2;14;20000\n95;-74;10;100\nx;1;10;100');
  assert.equal(r.records.length, 2);
  assert.ok(r.notes.some((n) => /temperatura fuera/.test(n)));
  assert.ok(r.notes.some((n) => /precipitación fuera/.test(n)));
  assert.equal(r.errors.length, 2);
});

test('parseCSV: bio1 en décimas de grado se divide entre 10; bio1 normal no se toca', () => {
  const a = Climate.parseCSV('lat,lon,bio1,bio12\n4,-74,141,1000\n5,-74,200,900');
  near(a.records[0].T, 14.1, 1e-9); assert.match(a.notes.join(' '), /décimas/);
  const b = Climate.parseCSV('lat,lon,bio1,bio12\n4,-74,14.1,1000');
  near(b.records[0].T, 14.1, 1e-9); assert.deepEqual(b.notes, []);
});

// Meses con las formas que puede traer una respuesta de NASA POWER
const normals = (e) => ({ normals: [e, { parameter: 'T2M', annual: 14, months: TT.map((v, i) => ({ month: i + 1, value: v })) }] });

test('parsePower: nombres de mes en español, números en texto y meses fuera de rango', () => {
  const nombres = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const r = Climate.parsePower(normals({ parameter: 'PRECTOTCORR', units: 'mm/day', annual: 3.8, months: PD.map((v, i) => ({ name: nombres[i], value: v })) }));
  assert.equal(r.monthlyP.length, 12); near(r.monthlyP[0], PD[0] * 31, 1e-9);
  const txt = Climate.parsePower(normals({ parameter: 'PRECTOTCORR', annual: 3.8, months: PD.map((v, i) => ({ month: String(i + 1), value: v })) }));
  assert.equal(txt.monthlyP.length, 12);
  const raro = Climate.parsePower(normals({ parameter: 'PRECTOTCORR', annual: 3.8, months: PD.map((v, i) => ({ month: i === 0 ? 13 : i === 1 ? '0' : i === 2 ? 'xyz' : i === 3 ? null : i + 1, value: v })) }));
  assert.equal(raro.monthlyP, null); near(raro.P, 3.8 * 365.25, 1e-6);
});

test('parsePower: meses como objeto, como lista simple, con "ann" y bajo properties o data', () => {
  const obj = {}; ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].forEach((m, i) => { obj[m] = PD[i]; });
  const a = Climate.parsePower({ properties: { normals: [{ parameter: 'T2M', ann: 14, months: TT }, { parameter: 'PRECTOTCORR', units: 'mm/month', ann: 100, months: obj }] } });
  near(a.T, 14, 1e-9); near(a.monthlyP[0], PD[0], 1e-9, 'si ya viene por mes no se multiplica');
  const b = Climate.parsePower({ data: { normals: [{ parameter: 'T2M', months: obj }] }, elevation: 1234 });
  assert.equal(b.elevCell, 1234); near(b.T, PD.reduce((x, y) => x + y, 0) / 12, 1e-9, 'sin anual se promedian los meses');
  const c = Climate.parsePower({ normals: [null, { months: [] }, { parameter: 'T2M', annual: 12 }], properties: { elevation: 77 } });
  near(c.T, 12, 1e-9); assert.equal(c.monthlyT, null); assert.equal(c.elevCell, 77);
});

test('parsePower: lluvia mensual por mes (mm/month) y solo anual; parámetros nulos no rompen', () => {
  const j = { properties: { parameter: { T2M: { ANN: 15 }, PRECTOTCORR: { ANN: 100 }, EXTRA: null } } };
  const sinUnidad = Climate.parsePower(j);
  near(sinUnidad.P, 100 * 365.25, 1e-6); assert.equal(sinUnidad.monthlyT, null);
  const mm = Climate.parsePower({ normals: [{ parameter: 'T2M', annual: 15 }, { parameter: 'PRECTOTCORR', units: 'mm/month', annual: 100 }] });
  near(mm.P, 1200, 1e-9);
  assert.throws(() => Climate.parsePower({ normals: [{ parameter: 'T2M', annual: -999 }] }), /no devolvió datos/);
  assert.throws(() => Climate.parsePower(null), /inesperada/);
});

test('parseOpenMeteo: sin temperatura media usa máx/mín; fechas raras y huecos se ignoran; errores claros', () => {
  const time = [], tx = [], tn = [], pr = [];
  for (let y = 2020; y <= 2021; y++) for (let m = 0; m < 12; m++) {
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) { time.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`); tx.push(20); tn.push(10); pr.push(3); }
  }
  tx[0] = null; time.push('no-es-fecha'); tx.push(20); tn.push(10); pr.push(3);
  const r = Climate.parseOpenMeteo({ daily: { time, temperature_2m_max: tx, temperature_2m_min: tn, precipitation_sum: pr } });
  near(r.T, 15, 1e-9); assert.equal(r.elevCell, null); assert.deepEqual(r.years, [2020, 2021]);
  const soloLluvia = Climate.parseOpenMeteo({ daily: { time, precipitation_sum: pr } });
  assert.equal(soloLluvia.monthlyT, null); assert.ok(soloLluvia.P > 1000);
  assert.throws(() => Climate.parseOpenMeteo({ daily: { time } }), /ni lluvia/);
  assert.throws(() => Climate.parseOpenMeteo({}), /inesperada/);
  assert.throws(() => Climate.parseOpenMeteo({ daily: { time: ['2020-01-01'], temperature_2m_mean: [5], precipitation_sum: [1] } }), /suficientes/);
});

test('fetchOnline: sin AbortController se consulta igual (sin tiempo límite)', async () => {
  const saved = globalThis.AbortController;
  globalThis.AbortController = undefined;
  try {
    const f = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('elevation') ? { elevation: [2600] } : { normals: [
      { parameter: 'T2M', annual: 14, months: TT }, { parameter: 'PRECTOTCORR', units: 'mm/day', annual: 3.8, months: PD }] }) });
    const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500 });
    assert.equal(r.climate.monthlyT.length, 12); assert.equal(r.elevation, 2600);
  } finally { globalThis.AbortController = saved; }
});

test('fetchOnline: sin altitud de la consulta de elevación y respuesta de elevación vacía', async () => {
  const f = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('elevation') ? { elevation: [] } : { normals: [
    { parameter: 'T2M', annual: 14, months: TT }, { parameter: 'PRECTOTCORR', units: 'mm/day', annual: 3.8, months: PD }] }) });
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, points: [{ lat: 4.6, lon: -74.1 }] });
  assert.equal(r.elevation, null); assert.match(r.errors[0], /Altitud/);
});

test('fetchOnline: el respaldo también se queda corto → se conserva lo de NASA', async () => {
  const j = { normals: [{ parameter: 'T2M', annual: 14 }, { parameter: 'PRECTOTCORR', units: 'mm/day', annual: 3.8 }] };
  const corto = { daily: { time: ['2020-01-01'], temperature_2m_mean: [5], precipitation_sum: [1] }, elevation: 10 };
  const f = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('elevation') ? { elevation: [2600] } : url.includes('archive-api') ? corto : j) });
  const r = await Climate.fetchOnline(4.6, -74.1, f, { timeoutMs: 500, year: 2025 });
  assert.equal(r.climate.source, 'NASA POWER'); near(r.climate.T, 14, 1e-9);
  assert.match(r.notes.join(' '), /no traen los 12 meses/);
});

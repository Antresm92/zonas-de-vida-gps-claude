'use strict';
/* Recorrido 3 — pestaña Clima: datos escritos a mano, 12 meses, diagrama de Walter-Lieth y datos de internet (simulados). */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, state, toastText, waitToast, sheetOpen, sheetTitle, waitSheetClosed, addPointManual, download, setFile, fx, errors, shot } = c;
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const month = async (T, P) => {
    for (let i = 0; i < 12; i++) {
      await fill('[data-mt="' + i + '"]', T[i] === null ? '' : String(T[i]).replace('.', ','));
      await fill('[data-mp="' + i + '"]', P[i] === null ? '' : String(P[i]));
    }
  };
  const TT = fx.T;
  const PP = [10, 12, 30, 60, 80, 20, 10, 8, 40, 120, 70, 20];

  // Internet simulado: cada servicio puede responder bien, con el otro formato o fallar
  const mock = { nasa: 'classic', om: 'ok', elev: 'ok', hits: { nasa: 0, om: 0, elev: 0 } };
  const CORS = { 'access-control-allow-origin': '*' };
  const json = (body) => ({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api.open-meteo.com/v1/elevation**', (r) => {
    mock.hits.elev++;
    if (mock.elev === 'fail') return r.fulfill({ status: 500, headers: CORS, body: 'x' });
    const n = new URL(r.request().url()).searchParams.get('latitude').split(',').length;
    r.fulfill(json({ elevation: Array.from({ length: n }, (_, i) => 2600 + i * 10) }));
  });
  await page.route('**/power.larc.nasa.gov/**', (r) => {
    mock.hits.nasa++;
    if (mock.nasa === 'fail') return r.fulfill({ status: 503, headers: CORS, body: 'busy' });
    const u = new URL(r.request().url()), lat = +u.searchParams.get('latitude'), lon = +u.searchParams.get('longitude');
    r.fulfill(json(mock.nasa === 'normals' ? fx.powerNormals(lat, lon) : fx.powerClassic(lat, lon)));
  });
  await page.route('**/archive-api.open-meteo.com/**', (r) => {
    mock.hits.om++;
    if (mock.om === 'fail') return r.fulfill({ status: 500, headers: CORS, body: 'x' });
    r.fulfill(json(fx.openMeteoArchive()));
  });
  const threePoints = async (alt) => {
    for (const p of ['4.9300, -74.4600', '4.9300, -74.4580', '4.9320, -74.4590']) await addPointManual(p, alt);
  };

  await step('Sin datos: pide la altitud, la temperatura y la lluvia, y no inventa la precipitación', async () => {
    await fresh();
    await threePoints();
    await tab('clima');
    assert.match(await text('#tab-clima'), /Ningún punto tiene altitud/);
    assert.match(await text('#tab-clima'), /La precipitación no se estima/);
    assert.match(await text('#tab-clima'), /Falta la temperatura y la lluvia mensuales/);
    // Un solo botón «Completar con internet» (el de la sección de abajo); el aviso solo ofrece escribir los 12 meses
    assert.equal(await page.locator('#tab-clima [data-act="fetchOnline"]').count(), 1);
    assert.equal(await page.locator('#tab-clima [data-act="monthly"]').count(), 1);
    await tab('informe');
    assert.match(await text('#tab-informe'), /Falta la altitud/);
    await page.click('[data-act="tab"][data-tab="clima"]');
    await shot('20-clima-vacio');
    await page.locator('#tab-clima .tip', { hasText: 'Falta la temperatura' }).scrollIntoViewIfNeeded();
    await shot('20b-walter-lieth-sin-datos');
  });

  await step('Escribir altitud, temperatura y precipitación a mano, con validación', async () => {
    await field('altOverride', '2640');
    assert.equal((await proj()).climate.altOverride, 2640);
    assert.match(await text('#tab-clima'), /Corregida a mano/);
    await field('altOverride', '99999');
    assert.match(await toastText(), /entre -450 y 9000/);
    await field('tManual', 'abc');
    assert.match(await toastText(), /Escribe solo un número/);
    await field('tManual', '80');
    assert.match(await toastText(), /entre -40 y 45/);
    await field('tManual', '14,5');
    assert.equal((await proj()).climate.tManual, 14.5);
    assert.match(await text('#tab-clima'), /14,5/);
    await field('pManual', '0');
    assert.match(await toastText(), /mayor que cero/);
    await field('pManual', '20000');
    assert.match(await toastText(), /Más de 15\.000 mm/);
    await field('pManual', '1200');
    assert.equal((await proj()).climate.pManual, 1200);
    await tab('informe');
    assert.match(await text('#tab-informe'), /Bosque|bosque|Páramo|páramo|Monte|monte/);
    await tab('clima');
    await page.click('[data-act="clearField"][data-field="pManual"]');
    assert.equal((await proj()).climate.pManual, undefined);
    await field('pManual', '1200');
    await field('altOverride', '');
    assert.equal((await proj()).climate.altOverride, undefined);
  });

  await step('Los 12 meses a mano: valida, dibuja Walter-Lieth y marca los meses secos', async () => {
    await act('monthly');
    assert.equal(await sheetTitle(), 'Los 12 meses');
    await month(TT.map((v, i) => i < 5 ? v : null), PP.map((v, i) => i < 5 ? v : null));
    await act('saveMonthly');
    assert.match(await toastText(), /faltan 7 mes/);
    await fill('[data-mt="5"]', 'x');
    await act('saveMonthly');
    assert.match(await toastText(), /Escribe solo un número/);
    await month(TT, PP);
    await fill('[data-mp="2"]', '99999');
    await act('saveMonthly');
    assert.match(await toastText(), /entre 0 y 3000/);
    await fill('[data-mt="3"]', '99');
    await fill('[data-mp="2"]', '30');
    await act('saveMonthly');
    assert.match(await toastText(), /entre -40 y 45/);
    await fill('[data-mt="3"]', '14');
    await act('saveMonthly'); await waitSheetClosed();
    const mm = (await proj()).climate.monthlyManual;
    assert.equal(mm.T.length, 12); assert.equal(mm.P.length, 12);
    assert.equal(await page.locator('#tab-clima .plot svg').count(), 1);
    const sum = await page.evaluate(() => [...document.querySelectorAll('.wlsum li')].map((l) => l.textContent));
    assert.ok(sum.some((l) => /Período seco/.test(l)), 'indica los períodos secos: ' + sum.join(' | '));
    assert.ok(sum.some((l) => /Meses con más de 100 mm: 1/.test(l)), 'cuenta el mes con más de 100 mm: ' + sum.join(' | '));
    assert.match(await text('#tab-clima'), /lluvia escrita por ti/);
    assert.match(await text('#tab-clima'), /no coincide con el promedio de tus 12 meses/);
    await shot('21-walter-lieth-a-mano');
  });

  await step('Guardar el diagrama como archivo SVG', async () => {
    const f = await download(() => page.click('[data-act="wlSave"]'));
    assert.match(f.name, /walter-lieth\.svg$/);
    assert.match(f.text, /^<\?xml/);
    assert.match(f.text, /<svg[^>]+viewBox/);
    assert.match(f.text, /Walter-Lieth/);
  });

  await step('Cambiar y borrar los meses escritos', async () => {
    await act('monthly');
    assert.equal(await page.inputValue('[data-mt="0"]'), '13,1');
    await fill('[data-mt="0"]', '13,5');
    await act('saveMonthly'); await waitSheetClosed();
    assert.equal((await proj()).climate.monthlyManual.T[0], 13.5);
    await act('monthly');
    await act('clearMonthly'); await waitSheetClosed();
    assert.equal((await proj()).climate.monthlyManual, undefined);
    assert.match(await text('#tab-clima'), /Falta la temperatura y la lluvia mensuales/);
    await act('monthly');
    await month(Array(12).fill(null), Array(12).fill(null));
    await act('saveMonthly'); await waitSheetClosed();
    assert.match(await toastText(), /No escribiste ningún mes/);
  });

  await step('Completar con internet (NASA POWER, formato clásico): altitud de cada punto, 12 meses y diagrama', async () => {
    await fresh();
    await threePoints();
    await tab('clima');
    await page.locator('[data-act="fetchOnline"]').first().click();
    await waitToast(/Listo: altitud de 3 puntos y clima de la zona/);
    const p = await proj();
    assert.ok(p.points.every((q) => q.altSrc === 'internet' && q.alt >= 2600));
    assert.equal(p.climate.online.monthlyT.length, 12);
    assert.equal(p.climate.online.monthlyP.length, 12);
    near(p.climate.online.P, fx.PD.reduce((s, v, i) => s + v * [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i], 0), 40, 'lluvia anual');
    assert.match(p.climate.online.source, /NASA POWER/);
    assert.equal((await page.evaluate(() => window.__app.MEM.count)), 1);
    assert.equal(await page.locator('#tab-clima .plot svg').count(), 1);
    assert.match(await text('#tab-clima'), /lluvia de NASA POWER/);
    assert.match(await text('#tab-clima'), /Última descarga/);
    await shot('22-walter-lieth-internet');
    await tab('informe');
    assert.match(await text('#tab-informe .result h3'), /\S/);
  });

  await step('NASA POWER con el formato nuevo («normals»): también se lee', async () => {
    mock.nasa = 'normals';
    await fresh();
    await threePoints(2610);
    await tab('clima');
    await page.locator('[data-act="fetchOnline"]').first().click();
    await waitToast(/Listo: clima de la zona/);
    const o = (await proj()).climate.online;
    assert.equal(o.monthlyP.length, 12);
    near(o.T, 13.55, 0.01, 'temperatura anual');
    assert.equal(await page.locator('#tab-clima .plot svg').count(), 1);
  });

  await step('Si NASA POWER no responde usa Open-Meteo (años recientes) y lo dice', async () => {
    mock.nasa = 'fail';
    await fresh();
    await threePoints(2610);
    await tab('clima');
    await page.locator('[data-act="fetchOnline"]').first().click();
    await waitToast(/Listo: clima de la zona/, 15000);
    const o = (await proj()).climate.online;
    assert.match(o.source, /Open-Meteo/);
    assert.equal(o.monthlyT.length, 12);
    assert.match(await toastText(), /NASA POWER no respondió/);
    assert.equal(await page.locator('#tab-clima .plot svg').count(), 1);
    assert.match(await text('#tab-clima'), /lluvia de Open-Meteo/);
  });

  await step('Si nada responde: explica que no se pudo y sugiere escribir los datos', async () => {
    mock.om = 'fail'; mock.elev = 'fail';
    await fresh();
    await threePoints(2610);
    await tab('clima');
    await page.locator('[data-act="fetchOnline"]').first().click();
    await waitToast(/No se pudo consultar internet/, 15000);
    assert.equal((await proj()).climate.online, undefined);
    assert.match(await toastText(), /escribir los datos a mano/);
    mock.nasa = 'classic'; mock.om = 'ok'; mock.elev = 'ok';
  });

  await step('Sin conexión: avisa y no intenta consultar', async () => {
    await fresh();
    await threePoints(2610);
    await tab('clima');
    const hits = mock.hits.nasa;
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    assert.equal(await page.locator('#netChip:not([hidden])').count(), 1);
    assert.match(await text('#tab-clima'), /Ahora no hay conexión/);
    await page.locator('[data-act="fetchOnline"]').first().click();
    assert.match(await toastText(), /Sin conexión/);
    assert.equal(mock.hits.nasa, hits);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.equal(await page.locator('#netChip:not([hidden])').count(), 0);
  });

  await step('Datos de internet de otro lugar se descartan y se avisa', async () => {
    await page.locator('[data-act="fetchOnline"]').first().click();
    await waitToast(/Listo/);
    await page.evaluate(() => { const S = window.__app.S, p = S.projects.find((x) => x.id === S.currentId); p.climate.online.lat += 1; });
    await tab('area'); await tab('clima');
    assert.match(await text('#tab-clima'), /son de otro lugar/);
  });

  await step('Importar datos de clima en CSV: se guardan en el equipo y se usan sin conexión', async () => {
    await fresh();
    await threePoints(1700);
    await tab('clima');
    await setFile('#csvFile', 'clima.csv', 'lat,lon,alt,temp,prec,nombre\n4.93,-74.46,1700,19,1500,Finca\n4.5,-74.1,2600,13,1000,Otra\nmal,mal,1,2,3,X');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await text('#sheet'), /2 registros guardados/);
    assert.match(await text('#sheet'), /Línea 4/);
    await act('closeSheet'); await waitSheetClosed();
    assert.equal(await page.evaluate(() => window.__app.MEM.count), 2);
    assert.match(await text('#tab-clima'), /2 registros de clima/);
    const cl = await page.evaluate(() => window.__app.analysis().climate);
    assert.equal(cl.PSrc, 'memoria');
    near(cl.P, 1500, 1, 'lluvia de la memoria');
    await setFile('#csvFile', 'malo.csv', 'a,b\n1,2');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await text('#sheet'), /No se guardó nada/);
    await act('closeSheet'); await waitSheetClosed();
    await act('askClearMem');
    await act('doClearMem'); await waitSheetClosed();
    assert.equal(await page.evaluate(() => window.__app.MEM.count), 0);
    assert.match(await text('#tab-clima'), /Todavía no hay datos/);
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
};

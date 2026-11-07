'use strict';
const Backup = require('../../www/js/backup.js');
/* Recorrido 11 — versión 2.5.0: color propio del punto en todas partes y «Clima actual» (Open-Meteo, respuestas simuladas). */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, state, toastText, waitToast, waitSheetClosed, addPointManual, download, errors, shot, tiles } = c;
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const rgb = (hex) => page.evaluate((h) => { const d = document.createElement('i'); d.style.color = h; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; }, hex);

  /* ---------- color propio en todo ---------- */
  const seed = async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await tab('clima'); await field('pManual', '1200');
  };
  let rojo = null;
  const pintar = async (n) => {                       // elige un color en la ficha del punto n de la lista
    await tab('puntos');
    await page.click('[data-act="editPoint"] >> nth=' + n); await page.waitForSelector('#sheet #fNote');
    const colores = await page.$$eval('#sheet .palette .sw', (els) => els.map((e) => e.getAttribute('data-color')));
    rojo = colores[1];
    await page.click('#sheet .palette .sw[data-color="' + rojo + '"]');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
  };

  await step('Lista de Puntos: cada fila lleva una franja con el color del punto; sin color propio, la del color de los puntos del proyecto', async () => {
    await seed();
    await pintar(0);
    await tab('puntos');
    const bordes = await page.$$eval('#tab-puntos .row.pt', (els) => els.map((e) => getComputedStyle(e).borderLeftColor));
    assert.equal(bordes.length, 3);
    assert.equal(bordes[0], await rgb(rojo), 'el primero, con su color');
    assert.equal(bordes[1], await rgb('#2F8F4E'), 'los demás, con el de los puntos del proyecto');
    assert.equal(bordes[2], await rgb('#2F8F4E'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('#tab-puntos .row:not(.pt)').length), 0);
    await shot('110-lista-con-color');
  });

  await step('Reporte: el perfil, el croquis satelital y el topográfico dibujan el punto con su color propio', async () => {
    await tab('informe');
    const perfil = await page.$$eval('#tab-informe svg[aria-label^="Perfil del relieve"] circle[r="4.6"]', (els) => els.map((e) => e.getAttribute('stroke')));
    assert.equal(perfil[0], rojo, 'perfil: el primer punto');
    assert.equal(perfil[1], '#2F8F4E');
    tiles.reset();
    await act('satPrepare'); await page.waitForSelector('#satBlock svg image', { state: 'attached', timeout: 8000 });
    const sat = await page.$$eval('#satBlock svg circle[r="6.5"]', (els) => els.map((e) => e.getAttribute('fill')));
    assert.deepEqual(sat, [rojo, '#F57C00', '#F57C00']);
    await act('topoPrepare'); await page.waitForSelector('#topoBlock svg image', { state: 'attached', timeout: 8000 });
    const topo = await page.$$eval('#topoBlock svg circle[r="6.5"]', (els) => els.map((e) => e.getAttribute('fill')));
    assert.deepEqual(topo, [rojo, '#F57C00', '#F57C00']);
    await shot('111-reporte-color');
  });

  await step('Cambiar el color de un punto deja sin vigencia el croquis ya preparado (hay que volver a prepararlo)', async () => {
    await tab('puntos');
    await page.click('[data-act="editPoint"] >> nth=1'); await page.waitForSelector('#sheet #fNote');
    const colores = await page.$$eval('#sheet .palette .sw', (els) => els.map((e) => e.getAttribute('data-color')));
    await page.click('#sheet .palette .sw[data-color="' + colores[2] + '"]');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    await tab('informe');
    assert.equal(await text('[data-act="satPrepare"]'), 'Preparar croquis satelital', 'ya no sirve la imagen anterior');
    assert.equal(await page.locator('#satBlock svg').count(), 0);
  });

  await step('Reporte compartido y KML/GeoJSON: el punto con color propio sale con él', async () => {
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, new RegExp('<span class="dot" style="background:' + rojo + '"></span>Abajo'));
    assert.match(f.text, /<span class="dot" style="background:#2F8F4E"><\/span>Arriba/);
    assert.match(f.text, new RegExp('<circle[^>]*stroke="' + rojo + '"'), 'el perfil del reporte');
    const kml = (await download(() => page.click('#tab-informe [data-act="export"][data-fmt="kml"]'))).text;
    assert.match(kml, new RegExp('<Style id="punto' + rojo.slice(1).toUpperCase() + '"><IconStyle>'));
    const gj = JSON.parse((await download(() => page.click('#tab-informe [data-act="export"][data-fmt="geojson"]'))).text);
    assert.equal(gj.features.find((x) => x.properties.name === 'Abajo' && x.properties.tipo === 'vertice').properties.color, rojo);
    assert.equal(gj.features.find((x) => x.properties.name === 'Arriba' && x.properties.tipo === 'vertice').properties.color, '#2F8F4E');
  });

  /* ---------- Clima actual ---------- */
  const mock = { mode: 'ok', hits: 0, urls: [] };
  const CORS = { 'access-control-allow-origin': '*' };
  const RESP = (t) => ({ latitude: 4.6, longitude: -74.1, timezone: 'America/Bogota',
    current: { time: '2026-10-28T14:00', interval: 900, temperature_2m: t, relative_humidity_2m: 87, weather_code: 1, pressure_msl: 1013.2, wind_speed_10m: 5.4 },
    daily: { time: ['2026-10-28'], sunrise: ['2026-10-28T05:44'], sunset: ['2026-10-28T17:42'] } });
  await page.route('**/api.open-meteo.com/v1/forecast**', (r) => {
    mock.hits++; mock.urls.push(r.request().url());
    if (mock.mode === 'fail') return r.fulfill({ status: 503, headers: CORS, body: 'busy' });
    if (mock.mode === 'basura') return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ current: {} }) });
    r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(RESP(mock.mode === 'otra' ? 18.2 : 24.3)) });
  });
  const nowText = () => text('#nowBlock');

  await step('Clima actual: el bloque está en Reporte, entre «Datos usados» y lo siguiente, con botón «Consultar clima actual» y la aclaración de que no entra en Holdridge', async () => {
    await seed();
    await tab('informe');
    const h2 = await page.$$eval('#tab-informe .block h2', (els) => els.map((e) => e.textContent));
    assert.ok(h2.indexOf('Clima actual') === h2.indexOf('Datos usados') + 1, JSON.stringify(h2));
    assert.equal(await text('#nowBlock [data-act="fetchNow"]'), 'Consultar clima actual');
    assert.match(await nowText(), /no es el promedio de varios años y no cambia el cálculo de la zona de vida/i);
    assert.equal(await page.locator('#nowBlock .nowcard').count(), 0, 'sin consulta no hay tarjeta');
    assert.equal(mock.hits, 0, 'no consulta nada por sí solo');
  });

  await step('Consultar clima actual: pide a Open-Meteo el centro de los puntos y muestra temperatura, condición, viento, presión, humedad, amanecer y atardecer', async () => {
    await act('fetchNow');
    await waitToast(/Clima actual consultado y agregado al reporte/);
    assert.equal(mock.hits, 1);
    const u = new URL(mock.urls[0]);
    const p = await proj();
    assert.ok(Math.abs(+u.searchParams.get('latitude') - 4.6030) < 0.01 && Math.abs(+u.searchParams.get('longitude') + 74.0750) < 0.01, 'centro de los puntos: ' + u.search);
    assert.equal(u.searchParams.get('current'), 'temperature_2m,relative_humidity_2m,weather_code,pressure_msl,wind_speed_10m');
    assert.equal(u.searchParams.get('daily'), 'sunrise,sunset');
    const t = await nowText();
    assert.match(t, new RegExp(p.name));
    assert.match(t, /24,3 °C/); assert.match(t, /Condición\s*Mayormente despejado/); assert.match(t, /Viento\s*5,4 km\/h/); assert.match(t, /Presión\s*1013 hPa/);
    assert.match(t, /Humedad\s*87 %/); assert.match(t, /Amanecer\s*05:44/); assert.match(t, /Atardecer\s*17:42/);
    assert.match(t, /Actualizado: .*· Open-Meteo · se incluirá en el reporte/);
    assert.equal(await text('#nowBlock [data-act="fetchNow"]'), 'Actualizar clima actual');
    assert.equal(await page.locator('#nowBlock .tip').count(), 0, 'sin aviso de lugar cambiado');
    const w = p.weatherNow;
    assert.equal(w.T, 24.3); assert.equal(w.code, 1); assert.equal(w.source, 'Open-Meteo'); assert.ok(w.at > 0 && Math.abs(w.lat - 4.603) < 0.01);
    assert.equal(await page.locator('#nowBlock [data-act="fetchNow"]').isDisabled(), false);
    await shot('112-clima-actual');
  });

  await step('El clima actual se queda guardado al recargar y «Actualizar» lo cambia por el nuevo', async () => {
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await tab('informe');
    assert.match(await nowText(), /24,3 °C/);
    mock.mode = 'otra';
    await act('fetchNow'); await waitToast(/Clima actual consultado/);
    assert.match(await nowText(), /18,2 °C/); assert.doesNotMatch(await nowText(), /24,3/);
    assert.equal((await proj()).weatherNow.T, 18.2);
    mock.mode = 'ok';
  });

  await step('Si los puntos cambian de sitio, avisa que el clima actual es de otro lugar y pide actualizarlo', async () => {
    await tab('puntos');
    await addPointManual('4.7000, -74.0000', 1500, 'Lejos');
    await tab('informe');
    assert.match(await text('#nowBlock .tip'), /otro sitio.*Actualiza el clima actual/);
    await act('fetchNow'); await waitToast(/Clima actual consultado/);
    assert.equal(await page.locator('#nowBlock .tip').count(), 0);
  });

  await step('Reporte compartido y copia de seguridad llevan el clima actual', async () => {
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /<h2>Clima actual<\/h2><table>/);
    assert.match(f.text, /<tr><th>Temperatura<\/th><td>24,3 °C<\/td><\/tr>/);
    assert.match(f.text, /Condiciones del momento de la consulta/);
    await act('projects');
    const b = await download(() => page.click('[data-act="backupJson"]'));
    const raw = JSON.parse(b.text);
    assert.equal(raw.state.projects[0].weatherNow.T, 24.3, 'la copia lleva el clima actual');
    assert.equal(raw.state.projects[0].weatherNow.source, 'Open-Meteo');
    assert.equal(Backup.validate(raw).ok, true);
    assert.equal(Backup.validate(raw).data.projects[0].weatherNow.sunset, '17:42', 'y al restaurar se conserva');
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Falla de Open-Meteo o respuesta rota: avisa sin borrar lo que ya había', async () => {
    await tab('informe');
    mock.mode = 'fail';
    await act('fetchNow');
    await waitToast(/No se pudo consultar el clima actual/);
    assert.match(await text('#nowBlock .warn'), /No se pudo consultar el clima actual: HTTP 503\. Revisa la conexión/);
    assert.match(await nowText(), /24,3 °C/, 'sigue la consulta anterior');
    mock.mode = 'basura';
    await act('fetchNow');
    await page.waitForFunction(() => /Open-Meteo no devolvió/.test(document.querySelector('#nowBlock .warn') ? document.querySelector('#nowBlock .warn').textContent : ''));
    assert.equal((await proj()).weatherNow.T, 24.3);
    mock.mode = 'ok';
    await act('fetchNow'); await waitToast(/Clima actual consultado/);
    assert.equal(await page.locator('#nowBlock .warn').count(), 0, 'al funcionar se quita el aviso de error');
  });

  await step('Sin conexión: avisa y no hace la consulta', async () => {
    const antes = mock.hits;
    await context.setOffline(true);
    await act('fetchNow');
    await waitToast(/Sin conexión\. El clima actual se consulta con internet/);
    assert.equal(mock.hits, antes);
    await context.setOffline(false);
  });

  await step('Sin altitud o sin precipitación el bloque «Clima actual» también está en Reporte', async () => {
    await fresh();
    await addPointManual('4.9300, -74.4600');
    await tab('informe');
    assert.match(await text('#tab-informe'), /Falta la altitud/);
    assert.equal(await text('#nowBlock [data-act="fetchNow"]'), 'Consultar clima actual');
    await act('fetchNow'); await waitToast(/Clima actual consultado/);
    assert.match(await nowText(), /24,3 °C/);
    await tab('puntos');
    await page.click('[data-act="editPoint"] >> nth=0'); await page.waitForSelector('#sheet #fNote');
    await fill('#fAlt', '2600');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    await tab('informe');
    assert.match(await text('#tab-informe'), /Falta la precipitación anual/);
    assert.match(await nowText(), /24,3 °C/, 'la consulta guardada se ve también aquí');
  });

  await step('Proyecto sin puntos: no hay reporte ni botón; y nada de esto dejó errores en la consola', async () => {
    await fresh();
    await tab('informe');
    assert.equal(await page.locator('#nowBlock').count(), 0);
    assert.match(await text('#tab-informe'), /Sin puntos todavía/);
    assert.deepEqual(errors, []);
  });
};

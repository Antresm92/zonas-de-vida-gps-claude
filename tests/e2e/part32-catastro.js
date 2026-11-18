'use strict';
/* Recorrido 32 — versión 2.32.0: el número predial. El lindero catastral entra con el GeoJSON que se descarga en Colombia
   en Mapas («Importar archivo»), y el número también se puede escribir a mano. La app no consulta el catastro por su cuenta.
   El número y el lindero son inventados; el archivo trae una dirección para comprobar que no se guarda. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, waitSheetClosed, sheetTitle, waitToast, errors, shot, download, setFile, state } = c;
  const lots = async () => (await state()).projects[0].lots;
  const NUM = '505730002000000080046000000000', LEG = '50 573 00 02 0000 0008 0046 000000000';
  const SQ = [[-72.501, 4.199], [-72.499, 4.199], [-72.499, 4.201], [-72.501, 4.201], [-72.501, 4.199]];
  // la misma forma que arma Colombia en Mapas al pulsar «Descargar GeoJSON»
  const FC = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'Numero predial': NUM, 'Numero predial anterior': '50573000200080046000', Municipio: 'Puerto López, Meta', Direccion: 'FINCA DE PRUEBA VDA X' }, geometry: { type: 'Polygon', coordinates: [SQ] } }] };
  const requests = [];
  page.on('request', (r) => { if (/servicioscem|Geovisor/.test(r.url())) requests.push(r.url()); });
  const croquis = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]'); await page.waitForSelector('#catBlock'); };

  await step('Bloque «Catastro» en Polígono: la hoja explica cómo traer el lindero con el archivo de Colombia en Mapas', async () => {
    await fresh();
    await croquis();
    assert.match(await text('#catVacio'), /se traen con el archivo que se descarga en Colombia en Mapas, o el número se escribe a mano/);
    await page.click('#catBtn');
    assert.equal(await sheetTitle(), 'Número predial y lindero');
    assert.match(await text('#catPasosA'), /colombiaenmapas\.gov\.co.*consulta catastral.*Descargar GeoJSON.*Importar archivo/s);
    assert.equal(await page.getAttribute('#catPasosA a[data-ext]', 'href'), 'https://www.colombiaenmapas.gov.co/');
    assert.match(await text('#sheet'), /No es una aplicación oficial del IGAC/);
    assert.equal(await page.locator('#sheet [data-act^="catBuscar"], #sheet [data-act="catCrear"]').count(), 0, 'sin consulta directa');
    await shot('v232-catastro-hoja');
  });

  await step('Escribir el número: valida los 30 (o 20) dígitos, lo guarda, «Quitar» y «Deshacer»', async () => {
    await croquis(); await page.click('#catBtn');
    await page.fill('#catNum', '12345');
    await act('catGuardarManual');
    await waitToast(/^El número predial tiene 30 dígitos/);
    await page.fill('#catNum', LEG);
    await act('catGuardarManual'); await waitSheetClosed();
    await waitToast(/^Número predial guardado en «Predio»\.Deshacer$/);
    assert.deepEqual([(await lots())[0].predial.numero, (await lots())[0].predial.fuente], [NUM, 'manual']);
    assert.match(await text('#catDatos'), new RegExp('Número predial' + LEG));
    assert.match(await text('#catFuente'), /^Dato escrito a mano el \d+ \w{3} \d{4}\. Colombia en Mapas \(IGAC\) advierte/);
    await page.click('#catBlock [data-act="catQuitar"]');
    await waitToast(/^Número predial quitado de «Predio»\.Deshacer$/);
    assert.equal((await lots())[0].predial, undefined);
    await page.click('#toast button');
    assert.equal((await lots())[0].predial.numero, NUM);
  });

  await step('El GeoJSON descargado de Colombia en Mapas entra con su número predial y sin la dirección', async () => {
    await fresh();
    await tab('puntos');
    await setFile('#gisFile', NUM + '.json', JSON.stringify(FC), 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importMain'); await waitSheetClosed();
    await waitToast(new RegExp('^«' + NUM + '» es ahora el polígono del proyecto\\. Número predial guardado\\.'));
    const l = (await lots())[0];
    assert.equal(l.points.length, 4);
    assert.deepEqual([l.predial.numero, l.predial.anterior, l.predial.municipio, l.predial.fuente], [NUM, '50573000200080046000', 'Puerto López, Meta', 'archivo']);
    assert.ok(!/FINCA/.test(JSON.stringify(await state())), 'la dirección no se guarda');
    await croquis();
    assert.match(await text('#catDatos'), new RegExp('Número predial' + LEG + 'Número predial anterior50573000200080046000MunicipioPuerto López, Meta'));
    assert.match(await text('#catFuente'), /^Dato del archivo de Colombia en Mapas el /);
    await page.locator('#catBlock').scrollIntoViewIfNeeded(); await shot('v232-catastro-bloque');
  });

  await step('Sale en el reporte, en «Terreno», y queda guardado al volver a abrir la app', async () => {
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.points.forEach((q) => { q.alt = 300; q.altSrc = 'manual'; }); l.climate.tManual = 26; l.climate.pManual = 2500; });
    await tab('informe');
    await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const sec = f.text.slice(f.text.indexOf('<h2>Terreno</h2>'), f.text.indexOf('<h2>Puntos</h2>'));
    assert.match(sec, new RegExp('<th>Número predial</th><td>' + LEG + ' · Puerto López, Meta</td>'));
    assert.ok(!/FINCA/.test(f.text));
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal((await lots())[0].predial.numero, NUM);
  });

  await step('Versión 2.32: la app no consultó el catastro por su cuenta y no hubo errores de JavaScript', async () => {
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  });
};

'use strict';
/* Recorrido 32 — versión 2.32.0: número predial y lindero catastral, por los dos caminos.
   A: el GeoJSON que se descarga en Colombia en Mapas, importado con «Importar archivo».
   B: «Traer el lindero catastral» (servicio interno de Colombia en Mapas, aquí de mentira con la forma del real), que puede fallar.
   El número, el lindero y los valores son inventados; la respuesta trae dirección y avalúo para comprobar que no se guardan. */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, sheetTitle, waitToast, errors, shot, download, setFile, state } = c;
  const forgetNoise = () => { const keep = errors.filter((e) => !/Failed to load resource/.test(e)); errors.length = 0; keep.forEach((e) => errors.push(e)); };
  const lots = async () => (await state()).projects[0].lots;
  const NUM = '505730002000000080046000000000', LEG = '50 573 00 02 0000 0008 0046 000000000';
  // un cuadrado de unos 222 × 222 m (≈ 4,9 ha) en el Meta
  const SQ = [[-72.501, 4.199], [-72.499, 4.199], [-72.499, 4.201], [-72.501, 4.201], [-72.501, 4.199]];
  const RESP = { status: true, response: {
    unidad: { TIPO: 'MUNI', CODIGO: '50573', NOMBRE_COMPLETO: 'Puerto López, Meta', NOMBRE: 'Puerto López' },
    predio: { numPredial: NUM, numPredialAnterior: '', areaTerreno: 50000, areaConstruccion: 120, avaluo: 987654321, direccion: 'FINCA DE PRUEBA VDA X', codDestino: 'L', construcciones: [{}] },
    terreno: { geometryType: 'esriGeometryPolygon', spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: 1, CODIGO: NUM, CODIGO_ANTERIOR: '' }, geometry: { rings: [SQ] } }] } } };
  const net = { mode: 'ok', bodies: [] };
  await context.route(/^https:\/\/servicioscem\.igac\.gov\.co\//, (route) => {
    net.bodies.push(route.request().postData() || '');
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (net.mode === 'down') return route.abort('failed');
    if (net.mode === 'nada') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: false, message: 'No se encontro información asociada.' }), headers: cors });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESP), headers: cors });
  });
  const croquis = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]'); await page.waitForSelector('#catBlock'); };

  await step('Bloque «Catastro» en Polígono; la hoja avisa que la búsqueda puede fallar y explica el camino del archivo', async () => {
    await fresh();
    await croquis();
    assert.match(await text('#catVacio'), /Impórtalos con el archivo que se descarga en Colombia en Mapas/);
    await page.click('#catBtn');
    assert.equal(await sheetTitle(), 'Lindero catastral');
    assert.match(await text('#catAviso'), /^Puede fallar\. Esta búsqueda usa el servicio interno de Colombia en Mapas \(IGAC\).*sin aviso/);
    await page.click('#catPasosA summary');
    assert.match(await text('#catPasosA'), /colombiaenmapas\.gov\.co.*Descargar GeoJSON.*Importar archivo/s);
    assert.equal(await page.getAttribute('#catPasosA a[data-ext]', 'href'), 'https://www.colombiaenmapas.gov.co/');
    await page.fill('#catNum', '12345');
    await act('catBuscarNum');
    await waitToast(/^El número predial tiene 30 dígitos/);
    assert.equal(net.bodies.length, 0, 'con un número mal escrito no consulta');
  });

  await step('Buscar por número: muestra el predio y crea un predio con su lindero (bloqueado), sin dirección ni avalúo; «Deshacer»', async () => {
    await croquis(); await page.click('#catBtn');
    await page.fill('#catNum', LEG);
    await act('catBuscarNum');
    await page.waitForSelector('#catResultado');
    assert.equal(net.bodies[0], 'cmd=query_codigo&query=' + NUM + '&token=&t=' + net.bodies[0].split('&t=')[1]);
    const r = await text('#catResultado');
    assert.match(r, new RegExp('Número predial' + LEG + '.*MunicipioPuerto López, Meta.*Área catastral5,00 ha.*Lindero4 vértices'));
    assert.ok(!/FINCA|987654321/.test(await text('#sheet')), 'ni dirección ni avalúo en pantalla');
    await shot('v232-catastro-resultado');
    await page.click('#catCrearBtn'); await waitSheetClosed();
    await waitToast(/^«Predio Puerto López» creado con el lindero catastral \(4 puntos, sin altitud: usa «Completar con internet»\)\.Deshacer$/);
    let L = await lots();
    assert.equal(L.length, 1, 'usó el polígono vacío del comienzo');
    assert.deepEqual([L[0].name, L[0].kind, L[0].locked, L[0].points.length], ['Predio Puerto López', 'finca', true, 4]);
    assert.equal(L[0].predial.numero, NUM); assert.equal(L[0].predial.fuente, 'consulta'); assert.equal(L[0].predial.areaM2, 50000);
    assert.ok(!/FINCA|987654321/.test(JSON.stringify(await state())), 'ni dirección ni avalúo guardados');
    await page.click('#toast button');
    L = await lots();
    assert.equal(L.length, 1); assert.equal(L[0].points.length, 0); assert.equal(L[0].predial, undefined);
  });

  await step('Con el predio creado, el bloque muestra el número y compara el área; sale en el reporte, en «Terreno»', async () => {
    await page.click('#catBtn'); await page.fill('#catNum', NUM); await act('catBuscarNum');
    await page.waitForSelector('#catCrearBtn'); await page.click('#catCrearBtn'); await waitSheetClosed();
    await croquis();
    assert.match(await text('#catDatos'), new RegExp('Número predial' + LEG + 'MunicipioPuerto López, MetaÁrea catastral5,00 ha'));
    assert.match(await text('#catCompara'), /^La medida es \d+,\d % (mayor|menor) que el área catastral\.$/);
    assert.match(await text('#catFuente'), /^Dato consultado en Colombia en Mapas el \d+ \w{3} \d{4}\. Colombia en Mapas \(IGAC\) advierte/);
    await page.locator('#catBlock').scrollIntoViewIfNeeded(); await shot('v232-catastro-bloque');
    // para el reporte hacen falta la altitud y el clima (el lindero catastral no trae altitud)
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.points.forEach((q) => { q.alt = 300; q.altSrc = 'manual'; }); l.climate.tManual = 26; l.climate.pManual = 2500; });
    await tab('informe');
    await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const sec = f.text.slice(f.text.indexOf('<h2>Terreno</h2>'), f.text.indexOf('<h2>Puntos</h2>'));
    assert.match(sec, new RegExp('<th>Número predial</th><td>' + LEG + ' · Puerto López, Meta</td>'));
    assert.match(sec, /<th>Área catastral \(referencia\)<\/th><td>5,00 ha · La medida es/);
    assert.ok(!/FINCA|987654321/.test(f.text));
  });

  await step('Si el servicio falla, lo dice y ofrece el archivo; donde no hay datos, lo explica', async () => {
    await croquis();
    net.mode = 'down';
    await page.click('#catBtn'); await act('catBuscarNum');
    await page.waitForSelector('#catError');
    assert.match(await text('#catError'), /^No se pudo traer el lindero\. Sin conexión o el servicio no está disponible\. Prueba de nuevo más tarde, o usa el archivo/);
    assert.equal(await page.locator('#catPasosA').count(), 1);
    net.mode = 'nada';
    await act('catBuscarCentro');
    await page.waitForSelector('#catNada');
    assert.match(await text('#catNada'), /^Colombia en Mapas no tiene información catastral en el centro de «Predio Puerto López»\. En algunos municipios el catastro lo lleva otro gestor/);
    assert.match(net.bodies[net.bodies.length - 1], /^cmd=query_xy&x=-72\.5\d+&y=4\.\d+&token=/);
    net.mode = 'ok';
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
    forgetNoise();
  });

  await step('Escribir el número sin consultar; «Quitar el número» y «Deshacer»', async () => {
    await croquis();
    await page.click('#catBlock [data-act="catQuitar"]');
    await waitToast(/^Número predial quitado de «Predio Puerto López»\.Deshacer$/);
    assert.equal((await lots())[0].predial, undefined);
    await page.click('#toast button');
    assert.equal((await lots())[0].predial.numero, NUM);
    await page.click('#catBtn'); await page.fill('#catNum', '50573000200080046000');
    await act('catGuardarManual'); await waitSheetClosed();
    await waitToast(/^Número predial guardado en «Predio Puerto López»\./);
    assert.deepEqual([(await lots())[0].predial.numero, (await lots())[0].predial.fuente], ['50573000200080046000', 'manual']);
    assert.match(await text('#catFuente'), /^Dato escrito a mano/);
  });

  await step('Camino A: el GeoJSON descargado de Colombia en Mapas entra con su número predial', async () => {
    await fresh();
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'Numero predial': NUM, Municipio: 'Puerto López, Meta', Direccion: 'FINCA DE PRUEBA VDA X' }, geometry: { type: 'Polygon', coordinates: [SQ] } }] };
    await tab('puntos');
    await setFile('#gisFile', NUM + '.json', JSON.stringify(fc), 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importMain'); await waitSheetClosed();
    await waitToast(new RegExp('^«' + NUM + '» es ahora el polígono del proyecto\\. Número predial guardado\\.'));
    const l = (await lots())[0];
    assert.equal(l.points.length, 4);
    assert.deepEqual(l.predial && [l.predial.numero, l.predial.municipio, l.predial.fuente], [NUM, 'Puerto López, Meta', 'archivo']);
    assert.ok(!/FINCA/.test(JSON.stringify(await state())));
    await croquis();
    assert.match(await text('#catFuente'), /^Dato del archivo de Colombia en Mapas el /);
  });

  await step('Lo guardado sigue ahí al volver a abrir la app', async () => {
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal((await lots())[0].predial.numero, NUM);
  });

  await step('Versión 2.32: sin errores de JavaScript en la consola', async () => {
    forgetNoise();
    assert.deepEqual(errors, []);
  });
};

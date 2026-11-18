'use strict';
/* Recorrido 31 — versión 2.31.0: el mapa de capacidad de uso del IGAC. «Según el mapa del IGAC» en Usos recomendados
   (consulta, guardado, reporte) y la capa «Capacidad de uso (IGAC)» del mapa (en línea, guardada y sin conexión).
   El servicio del IGAC es de mentira (mismas respuestas que el real, tomadas el 18 nov 2026 en (4,20; −72,50)). */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, sheetTitle, waitToast, errors, shot, download } = c;
  // las descargas que fallan a propósito dejan «Failed to load resource» en la consola: no son errores de la app
  const forgetNoise = () => { const keep = errors.filter((e) => !/Failed to load resource/.test(e)); errors.length = 0; keep.forEach((e) => errors.push(e)); };
  const { solidPng } = require('../helpers/png.js');
  const lot0 = async () => page.evaluate(() => window.__app.S.projects[0].lots[0]);
  const info = () => page.evaluate(() => { const m = window.__app.ui.map; return m ? m.info() : null; });
  const waitFor = async (fn, what, ms) => {
    const t0 = Date.now(); let v = null;
    while (Date.now() - t0 < (ms || 6000)) { v = await fn(); if (v) return v; await page.waitForTimeout(60); }
    throw new Error('No llegó: ' + what);
  };

  const META = { Clase: '6', Subclase: 's', UCP: '6s-2', Limitantes: 'Saturación de aluminio (>90%), profundidad efectiva muy superficial y texturas finas',
    URecomendados: 'Cultivos transitorios, semipermanentes y permanentes adaptados a la alta saturación de aluminio', PManejo: 'Variedades resistentes a los altos contenidos de aluminio; enmiendas y fertilización',
    Estudio: 'Estudio semidetallado de suelos del Meta', Escala: '1:25.000', 'Año': '2017', Clase_Multiescalar: '6' };
  const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const GJ = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQ(-72.51, 4.19, -72.49, 4.21)] }, properties: META },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQ(-72.49, 4.19, -72.47, 4.21)] }, properties: { Clase: 'VII', Subclase: 'p', UCP: 'VIIp', Clase_Multiescalar: '7', Escala: '1:100.000' } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[SQ(-72.53, 4.19, -72.51, 4.20)], [SQ(-72.53, 4.20, -72.51, 4.21)]] }, properties: { Clase: 'CA', Clase_Multiescalar: 'CA', Escala: '1:25.000' } }
  ] };
  const net = { down: false, tilesDown: false, point: 0, bbox: 0, tiles: 0 };
  const png = solidPng(255, 171, 0, 255, 256);
  await context.route(/^https:\/\/mapas2\.igac\.gov\.co\//, (route) => {
    const u = route.request().url(), cors = { 'Access-Control-Allow-Origin': '*' };
    if (/\/export\?/.test(u)) { net.tiles++; return net.tilesDown ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: cors }); }
    if (net.down) return route.abort('failed');
    if (/f=geojson/.test(u)) { net.bbox++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GJ), headers: cors }); }
    net.point++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: [{ attributes: META }] }), headers: cors });
  });

  await step('«Según el mapa del IGAC»: consulta el centro del polígono, lo guarda y lo compara con la evaluación de la app', async () => {
    await fresh();
    // un plano de 30 % de pendiente en el Meta (4,20; −72,50): la app da clase 6 por pendiente
    for (const [ll, alt] of [['4.1996, -72.5004', 300], ['4.1996, -72.4995', 300], ['4.2005, -72.4995', 330], ['4.2005, -72.5004', 330]]) await addPointManual(ll, alt);
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.climate.tManual = 26; l.climate.pManual = 2500; });
    await tab('clima');
    assert.match(await text('#igacBox h3'), /^Según el mapa del IGAC$/);
    assert.match(await text('#igacEstado'), /Necesita internet/);
    await page.click('#igacBtn');
    await page.waitForSelector('#igacClase');
    assert.equal(net.point, 1);
    assert.match(await text('#igacClase'), /^Clase 6 subclase 6s · unidad 6s-2$/);
    assert.match(await text('#igacCompara'), /^Coincide: Coincide con tu evaluación\.$/);
    assert.match(await text('#igacDatos'), /Subclasesuelo.*LimitantesSaturación de aluminio.*Usos recomendadosCultivos transitorios/);
    assert.match(await text('#igacEstudio'), /^Estudio semidetallado de suelos del Meta\. Escala 1:25\.000, 2017\. Consultado el \d+ \w{3} \d{4} en .*\. \[4\]$/);
    await waitToast(/^Consulta del mapa del IGAC guardada\.Deshacer$/);
    const g = (await lot0()).igac;
    assert.deepEqual([g.clase, g.codigo, g.ucp, g.escala, g.anio], [6, '6s', '6s-2', '1:25.000', '2017']);
    assert.ok(Math.abs(g.lat - 4.20005) < 0.001 && Math.abs(g.lon + 72.49995) < 0.001, 'en el centro del polígono');
    await page.locator('#igacBox').scrollIntoViewIfNeeded(); await shot('v231-igac-consulta');
  });

  await step('Si la evaluación de la app es otra, lo dice; «Quitar» y «Deshacer»; la fuente [4] tiene la cita y la licencia', async () => {
    await page.evaluate(() => { window.__app.S.projects[0].lots[0].terreno = { erosion: 'severa' }; window.__app.showTab('clima'); });
    assert.match(await text('#igacCompara'), /^No coincide: Tu evaluación da clase 7 \(más restrictiva\)\. El mapa del IGAC es regional/);
    await page.evaluate(() => { delete window.__app.S.projects[0].lots[0].terreno; window.__app.showTab('clima'); });
    await page.click('#igacBox [data-act="igacQuitar"]');
    assert.equal((await lot0()).igac, undefined);
    assert.ok(await page.$('#igacBtn'));
    await page.click('#toast button');
    assert.equal((await lot0()).igac.codigo, '6s');
    await page.click('#igacBox [data-act="usosFuente"]');
    assert.equal(await sheetTitle(), 'Fuentes de «Usos recomendados»');
    assert.match(await text('#usosFuentes'), /\[4\] Mapa del IGAC.*multiescalar.*CC BY 4\.0 \(Resolución 616 de 2020\)/);
    const hrefs = await page.$$eval('#usosFuentes a[data-ext]', (a) => a.map((x) => x.href));
    assert.ok(hrefs.includes('https://www.igac.gov.co/datos-abiertos/datos-abiertos-geoespaciales'));
    assert.ok(hrefs.includes('https://vlex.com.co/vid/resolucion-numero-616-2020-846199912'));
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('Queda guardado al volver a abrir la app y sale en el reporte, en «Usos recomendados»', async () => {
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal((await lot0()).igac.codigo, '6s');
    await tab('informe');
    await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const h = f.text, i = h.indexOf('<h2>Usos recomendados</h2>'), sec = h.slice(i, h.indexOf('<h2>Puntos</h2>'));
    assert.ok(i > 0);
    assert.match(sec, /<th>Según el mapa del IGAC<\/th><td>Clase 6 · subclase 6s \(unidad 6s-2\)<\/td>/);
    assert.match(sec, /<th>Limitantes \(mapa del IGAC\)<\/th><td>Saturación de aluminio \(&gt;90%\)/);
    assert.match(sec, /<th>Prácticas de manejo \(mapa del IGAC\)<\/th>/);
    assert.match(sec, /<th>Estudio del IGAC<\/th><td>Estudio semidetallado de suelos del Meta, escala 1:25\.000, 2017, consultado el /);
    assert.match(sec, /Mapa: Instituto Geográfico Agustín Codazzi \(IGAC\)\. Capacidad de uso de las tierras, mapa multiescalar/);
  });

  const openMap = async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
  };
  const openLayers = async () => { if (await page.evaluate(() => document.querySelector('#mapLayersPanel').hidden)) await act('mapLayers'); };

  await step('Capa «Capacidad de uso (IGAC)»: con internet pide las baldosas del IGAC y las pone encima, con su fuente', async () => {
    await openMap(); await openLayers();
    assert.equal(await page.getAttribute('[data-act="mapIgac"]', 'aria-pressed'), 'false');
    assert.equal(await text('#igacPanel'), '');
    await page.click('[data-act="mapIgac"]');
    assert.equal(await page.getAttribute('[data-act="mapIgac"]', 'aria-pressed'), 'true');
    const i = await waitFor(async () => { const x = await info(); return x.overlay.kind === 'tiles' && x.overlay.loaded > 0 ? x : null; }, 'baldosas del IGAC');
    assert.ok(net.tiles > 0);
    assert.match(i.attribution, /Capacidad de uso: IGAC \(CC BY 4\.0\)/);
    assert.match(await text('#igacVer'), /^Viendo el mapa del IGAC en línea\.$/);
    assert.match(await text('#igacPanel'), /Clase 1.*Clase 8.*Agua.*Urbana.*Fuente: IGAC \(CC BY 4\.0\)\. Mapa regional.*No es una app oficial del IGAC\.$/);
    assert.equal(await page.evaluate(() => window.__app.ui.mapIgac), true);
    await shot('v231-igac-capa');
  });

  await step('«Guardar la zona del predio»: descarga los polígonos alrededor y los guarda en el teléfono', async () => {
    await page.click('#igacDownloadBtn');
    await waitToast(/^Guardados 3 polígonos del mapa del IGAC para usar sin conexión\.$/);
    assert.equal(net.bbox, 1);
    assert.match(await text('#igacGuardado'), /^Guardada para usar sin conexión: 3 polígonos, \d+ \w{3} \d{4}\.$/);
  });

  await step('Sin conexión: dibuja lo guardado con los colores del IGAC; al volver la conexión, de nuevo en línea', async () => {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const i = await waitFor(async () => { const x = await info(); return x.overlay.kind === 'shapes' ? x : null; }, 'lo guardado');
    assert.equal(i.overlay.shapes, 4, '3 polígonos, uno de ellos en dos partes');
    assert.match(await text('#igacVer'), /^Sin conexión: viendo la zona guardada\.$/);
    await shot('v231-igac-sin-conexion');
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(async () => (await info()).overlay.kind === 'tiles', 'en línea otra vez');
  });

  await step('Si las baldosas del IGAC no cargan, usa lo guardado', async () => {
    net.tilesDown = true;
    await page.evaluate(() => window.__app.ui.map.flyTo(4.33, -72.33, 16));   // otra zona: baldosas nuevas, que fallan
    await waitFor(async () => (await info()).overlay.kind === 'shapes', 'cambio a lo guardado', 10000);
    assert.equal(await page.evaluate(() => window.__app.ui.igacFail), true);
    net.tilesDown = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(async () => (await info()).overlay.kind === 'tiles', 'vuelve a intentar en línea');
    await page.evaluate(() => { window.__app.ui.mapFitKey = null; window.__app.showTab('area'); });
    forgetNoise();
  });

  await step('Sin internet, la consulta del polígono sale de lo guardado; sin nada guardado, avisa', async () => {
    net.down = true;
    await tab('clima');
    await page.click('#igacBtn');
    await waitToast(/^Consultado en lo guardado sin conexión\.Deshacer$/);
    const g = (await lot0()).igac;
    assert.equal(g.src, 'guardado'); assert.equal(g.codigo, '6s');
    assert.match(await text('#igacEstudio'), /en lo guardado sin conexión/);
    // borrar lo guardado (se puede deshacer) y consultar: sin internet ni zona guardada, avisa y no cambia lo que había
    await openMap(); await openLayers();
    await page.click('#igacPanel [data-act="igacBorrar"]');
    await waitToast(/^Zona guardada del IGAC borrada\.Deshacer$/);
    await waitFor(async () => /Guardar la zona del predio/.test(await text('#igacPanel')), 'sin zona guardada');
    await tab('clima');
    await page.click('#igacBtn');
    await waitToast(/^No se pudo consultar el mapa del IGAC \(sin conexión\)\. Necesita internet, o la zona guardada/);
    assert.equal((await lot0()).igac.src, 'guardado');
    net.down = false;
    forgetNoise();
  });

  await step('Lo guardado y la capa encendida siguen ahí al volver a abrir la app', async () => {
    await openMap(); await openLayers();
    await page.click('#igacDownloadBtn');
    await waitToast(/^Guardados 3 polígonos/);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await openMap(); await openLayers();
    assert.equal(await page.getAttribute('[data-act="mapIgac"]', 'aria-pressed'), 'true');
    await waitFor(async () => /Guardada para usar sin conexión: 3 polígonos/.test(await text('#igacPanel')), 'lo guardado tras reabrir');
    await page.click('[data-act="mapIgac"]');
    await waitFor(async () => (await info()).overlay.kind === '', 'capa apagada');
    assert.equal(await text('#igacPanel'), '');
  });

  await step('Versión 2.31: sin errores de JavaScript en la consola', async () => {
    forgetNoise();
    assert.deepEqual(errors, []);
  });
};

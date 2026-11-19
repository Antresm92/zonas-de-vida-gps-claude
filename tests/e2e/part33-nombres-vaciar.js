'use strict';
/* Recorrido 33 — versión 2.32.1: (1) los nombres de los puntos en el mapa vienen apagados y se encienden en el botón de capas
   («Ver › Nombres de los puntos»); los círculos con el número siguen a la vista. (2) Vaciar el único polígono lo deja como un
   predio nuevo: nombre «Predio», color de la app y sin clima, evaluación del terreno, consulta del IGAC ni número predial. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, waitToast, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const openEdit = async () => { await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]'); await page.click('#sheet .lotrow:nth-child(1) .lotmore'); };
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const shownNames = () => page.$$eval('.mk-lab', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
  const openMap = async () => {
    await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    await page.waitForFunction(() => window.__app.ui.map && window.__app.ui.map.info().zoom >= 15, null, { timeout: 8000 });
  };
  const openLayers = async () => { if (await page.evaluate(() => document.querySelector('#mapLayersPanel').hidden)) await act('mapLayers'); };

  await step('Los nombres de los puntos vienen apagados en el mapa; los números siguen a la vista', async () => {
    await fresh({ mapNames: undefined });                       // como viene la app
    for (const ll of ['4.6000, -74.0800', '4.6000, -74.0790', '4.6010, -74.0790']) await addPointManual(ll, 2600);
    await openMap();
    assert.equal((await info()).namesOn, false);
    assert.equal(await shownNames(), 0);
    assert.deepEqual(await page.$$eval('.mk-dot', (d) => d.map((x) => x.textContent)), ['1', '2', '3']);
    await openLayers();
    assert.equal(await page.getAttribute('[data-act="mapNames"]', 'aria-pressed'), 'false');
    await shot('v2321-nombres-apagados');
  });

  await step('«Nombres de los puntos» los enciende y la app lo recuerda; se vuelven a apagar', async () => {
    await page.click('[data-act="mapNames"]');
    assert.equal(await page.getAttribute('[data-act="mapNames"]', 'aria-pressed'), 'true');
    assert.equal((await info()).namesOn, true);
    assert.equal(await shownNames(), 3);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await openMap();
    assert.equal((await info()).namesOn, true, 'sigue encendido al volver a abrir');
    assert.equal(await shownNames(), 3);
    await openLayers();
    await page.click('[data-act="mapNames"]');
    assert.equal(await shownNames(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags')).mapNames), false);
  });

  await step('Vaciar el único polígono lo deja como un predio nuevo; «Deshacer» devuelve todo', async () => {
    // un polígono importado con nombre, color y datos guardados
    await page.evaluate(() => {
      const l = window.__app.S.projects[0].lots[0];
      l.name = 'FincaFLORO'; l.mainColor = '#8E44AD'; l.locked = true; l.climate.tManual = 20;
      l.terreno = { erosion: 'ligera' }; l.igac = { clase: 6, codigo: '6s' }; l.predial = { numero: '505730002000000080046000000000', fuente: 'manual' };
      window.__app.showTab('area');
    });
    await page.click('[data-act="polyView"][data-v="croquis"]');
    await openEdit();
    assert.equal(await text('#lotDelBox'), 'Vaciar y empezar de nuevo');
    await page.click('#lotDelBox [data-act="lotDeleteAsk"]');
    assert.match(await text('#lotDelAsk'), /^¿Vaciar «FincaFLORO»\? Se borran sus 3 puntos \(con sus fotos\), su clima, la evaluación del terreno, la consulta del IGAC y el número predial\. Queda como un predio nuevo, «Predio»/);
    await page.click('#lotDelBox [data-act="lotReset"]'); await waitSheetClosed();
    await waitToast(/^«FincaFLORO» quedó vacío, como un predio nuevo: 3 puntos borrados\. Ya puedes dibujarlo o importarlo de nuevo\.Deshacer$/);
    const l = (await lots())[0];
    assert.deepEqual(Object.keys(l).sort(), ['climate', 'id', 'kind', 'mainColor', 'name', 'nextPoint', 'points']);
    assert.deepEqual([l.name, l.kind, l.points.length, l.nextPoint, JSON.stringify(l.climate)], ['Predio', 'finca', 0, 1, '{}']);
    assert.match(await text('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]'), /^Predio$/);
    await page.click('#toast button');
    const b = (await lots())[0];
    assert.deepEqual([b.name, b.mainColor, b.locked, b.points.length, b.climate.tManual, b.terreno.erosion, b.igac.codigo, b.predial.numero],
      ['FincaFLORO', '#8E44AD', true, 3, 20, 'ligera', '6s', '505730002000000080046000000000']);
  });

  await step('Un predio nuevo y vacío no ofrece vaciarlo; con solo el nombre cambiado, sí', async () => {
    await openEdit(); await page.click('#lotDelBox [data-act="lotDeleteAsk"]'); await page.click('#lotDelBox [data-act="lotReset"]'); await waitSheetClosed();
    await openEdit();
    assert.equal(await page.locator('#lotDelBox').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await page.evaluate(() => { window.__app.S.projects[0].lots[0].name = 'Otro nombre'; window.__app.showTab('area'); });
    await openEdit();
    assert.equal(await text('#lotDelBox'), 'Vaciar y empezar de nuevo');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Versión 2.32.1: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

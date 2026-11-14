'use strict';
/* Recorrido 25 — versión 2.23.3: «Crear y dibujar en el mapa». Desde cualquier botón y cualquier pestaña, crear un predio o un lote
   con «Dibujar» lleva a Polígono › Mapa, encuadra su predio y deja activo «Ingresar puntos». */
module.exports = async function (c) {
  const { page, assert, step, fresh, rawAct, tab, text, fill, addPointManual, waitSheetClosed, toastText, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const where = () => page.evaluate(() => { const u = window.__app.ui; return u.tab + '/' + u.polyView + '/' + (u.mapMode || '-'); });
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const inside = (ll, b) => ll.lat >= b.s - 1e-9 && ll.lat <= b.n + 1e-9 && ll.lon >= b.w - 1e-9 && ll.lon <= b.e + 1e-9;

  await step('Desde Puntos, «＋ Lote» › «Crear y dibujar en el mapa» lleva al mapa con «Ingresar puntos» y el predio encuadrado', async () => {
    await fresh();
    for (const ll of ['4.600, -74.080', '4.600, -74.070', '4.610, -74.070', '4.610, -74.080']) await addPointManual(ll, 1000);
    assert.equal(await where(), 'puntos/croquis/-');
    await page.click('section.tab:not([hidden]) [data-act="lotAdd"]');
    assert.equal(await text('[data-act="lotSave"]'), 'Crear y dibujar en el mapa');
    assert.match(await text('#lotDrawHint'), /^Al crearlo se abre el mapa para que marques sus puntos tocándolo\. Si prefieres caminar el lindero con el GPS o escribir coordenadas, toca «Salir» y hazlo desde Puntos\.$/);
    await page.click('#sheet .cats [data-c="Cafetal"]');
    await rawAct('lotSave'); await waitSheetClosed();
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    assert.equal(await where(), 'area/mapa/add');
    assert.match(await toastText(), /^«Cafetal» creado\. El lindero de «Predio» quedó bloqueado\. Toca el mapa para marcar sus puntos dentro de «Predio»\.Deshacer$/);
    assert.match(await text('#mapMode'), /Ingresar puntos: toca el mapa/);
    // el encuadre muestra el predio completo
    const i = await info(), b = i.bounds;
    for (const ll of [{ lat: 4.600, lon: -74.080 }, { lat: 4.610, lon: -74.070 }]) assert.ok(inside(ll, b), 'el predio se ve completo');
    assert.ok(b.n - b.s < 0.05, 'y de cerca, no el país entero: ' + JSON.stringify(b));
    await shot('v2233-dibujar-lote');
    // tocar el mapa marca el punto en el lote nuevo
    const box = await page.locator('#mapHost .mapa-leaflet').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await c.waitToast(/^P1 creado/);
    const ls = await lots();
    assert.equal(ls[1].name, 'Cafetal'); assert.equal(ls[1].points.length, 1); assert.equal(ls[0].points.length, 4, 'el predio no cambia');
  });

  await step('Desde Información y desde Reporte, y con «＋ Predio», también lleva al mapa; «Salir» deja de marcar', async () => {
    for (const t of ['clima', 'informe']) {
      await tab(t);
      await page.click('section.tab:not([hidden]) [data-act="lotAdd"]'); await fill('#lotName', 'Desde ' + t);
      await rawAct('lotSave'); await waitSheetClosed();
      assert.equal(await where(), 'area/mapa/add', t);
    }
    await tab('herramientas'); await tab('puntos');
    await page.click('section.tab:not([hidden]) [data-act="predioAdd"]'); await fill('#lotName', 'La Vega');
    assert.equal(await text('[data-act="lotSave"]'), 'Crear y dibujar en el mapa');
    await rawAct('lotSave'); await waitSheetClosed();
    assert.equal(await where(), 'area/mapa/add');
    assert.match(await toastText(), /^«La Vega» creado\.( El lindero de «[^»]+» quedó bloqueado\.)? Toca el mapa para marcar sus puntos\.Deshacer$/);
    await page.click('#mapMode button');
    assert.equal(await where(), 'area/mapa/-');
  });

  await step('«Deshacer» quita el lote si sigue vacío y deja de marcar; editar un lote no lleva al mapa', async () => {
    await tab('puntos');
    const n = (await lots()).length;
    await page.click('section.tab:not([hidden]) [data-act="lotAdd"]'); await fill('#lotName', 'Borrar');
    await rawAct('lotSave'); await waitSheetClosed();
    assert.equal((await lots()).length, n + 1);
    await page.click('#toast button');
    assert.equal((await lots()).length, n);
    assert.equal(await where(), 'area/mapa/-');
    // editar (desde la lista) guarda sin moverse
    await tab('puntos');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow:has-text("Cafetal") [data-act="lotEdit"]');
    assert.equal(await text('[data-act="lotSave"]'), 'Guardar');
    await rawAct('lotSave'); await waitSheetClosed();
    assert.equal((await where()).split('/')[0], 'puntos');
  });

  await step('Un lote recién creado y vacío lo dice en el croquis (ya no habla de «capas importadas»); sin errores', async () => {
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    await page.click('section.tab:not([hidden]) .lots .lotchip:has-text("Desde clima")');
    assert.equal(await text('#lotEmptyTip'), '«Desde clima» todavía no tiene puntos. Márcalos en el mapa, con el GPS o escribiendo coordenadas.');
    assert.doesNotMatch(await text('#tab-area'), /solo capas importadas/);
    assert.deepEqual(errors, []);
  });
};

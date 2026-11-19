'use strict';
/* Recorrido 27 — versión 2.23.7: borrar o vaciar un polígono (con confirmación y «Deshacer») y aviso de tamaño fuera de lo normal. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, sheetTitle, toastText, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const openEdit = async (n) => { await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]'); await page.click('#sheet .lotrow:nth-child(' + (n || 1) + ') .lotmore'); };

  await step('Un solo polígono con un punto mal escrito: el croquis y el mapa avisan del tamaño y señalan el punto', async () => {
    await fresh();
    await addPointManual('4.600, -74.080', 1000); await addPointManual('4.600, -74.070', 1000);
    await addPointManual('46.10, -74.070', 1000);                       // un dígito de más en la latitud
    await addPointManual('4.610, -74.080', 1000);
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.match(await text('#areaHuge'), /^«Predio» mide [\d.,]+ ha, un tamaño fuera de lo normal para un predio\. Casi siempre es un punto con una coordenada mal escrita: el que más se aleja de los demás es P3 \(46\.10000, -74\.07000\)\. Corrígelo en Puntos, o bórralo y márcalo de nuevo\.$/);
    await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    assert.match(await text('#mapHuge'), /^⚠ Área fuera de lo normal: ¿un punto mal escrito\?Ver punto$/);
    await page.click('#mapHuge button');
    assert.equal(await text('.mapcard-name'), 'P3', 'abre la tarjeta del punto sospechoso, para moverlo o eliminarlo');
    await shot('v2237-aviso-tamano');
  });

  await step('Si es el único polígono: «Vaciar y empezar de nuevo», con confirmación; «Deshacer» lo devuelve', async () => {
    await page.click('[data-act="polyView"][data-v="croquis"]');
    await openEdit();
    assert.equal(await sheetTitle(), 'Editar predio');
    assert.equal(await text('#lotDelBox'), 'Vaciar y empezar de nuevo');
    await page.click('#lotDelBox [data-act="lotDeleteAsk"]');
    assert.match(await text('#lotDelAsk'), /^¿Vaciar «Predio»\? Se borran sus 4 puntos \(con sus fotos\), su clima, la evaluación del terreno, la consulta del IGAC y el número predial\. Queda como un predio nuevo, «Predio», listo para dibujarlo o importarlo\. Después puedes deshacerlo\.$/);
    await shot('v2237-confirmar');
    await page.click('#lotDelBox [data-act="lotDeleteNo"]');                 // «Cancelar» vuelve al botón sin borrar nada
    assert.equal(await text('#lotDelBox'), 'Vaciar y empezar de nuevo');
    assert.equal((await lots())[0].points.length, 4);
    await page.click('#lotDelBox [data-act="lotDeleteAsk"]'); await page.click('#lotDelBox [data-act="lotReset"]'); await waitSheetClosed();
    assert.equal(await toastText(), '«Predio» quedó vacío, como un predio nuevo: 4 puntos borrados. Ya puedes dibujarlo o importarlo de nuevo.Deshacer');
    let ls = await lots();
    assert.deepEqual([ls.length, ls[0].name, ls[0].points.length, ls[0].nextPoint], [1, 'Predio', 0, 1]);
    assert.equal(await page.locator('#areaHuge').count(), 0);
    await page.click('#toast button');
    ls = await lots();
    assert.equal(ls[0].points.length, 4); assert.equal(ls[0].points[2].lat, 46.1);
    // vacío y único: no hay nada que borrar
    await openEdit(); await page.click('#lotDelBox [data-act="lotDeleteAsk"]'); await page.click('#lotDelBox [data-act="lotReset"]'); await waitSheetClosed();
    await openEdit();
    assert.equal(await page.locator('#lotDelBox').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Con varios polígonos: «Eliminar predio» o «Eliminar lote» según el tipo, con confirmación que avisa de los lotes que quedan sueltos', async () => {
    await fresh();
    for (const ll of ['4.600, -74.080', '4.600, -74.070', '4.610, -74.070', '4.610, -74.080']) await addPointManual(ll, 1000);
    await page.click('section.tab:not([hidden]) [data-act="lotAdd"]'); await c.fill('#lotName', 'Cafetal'); await act('lotSave'); await waitSheetClosed();
    for (const ll of ['4.602, -74.078', '4.602, -74.076', '4.604, -74.077']) await addPointManual(ll, 1000);
    await openEdit(2);
    assert.equal(await text('#lotDelBox'), 'Eliminar lote');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await openEdit(1);
    assert.equal(await text('#lotDelBox'), 'Eliminar predio');
    await page.click('#lotDelBox [data-act="lotDeleteAsk"]');
    assert.equal(await text('#lotDelAsk'), '¿Eliminar «Predio» con sus 4 puntos y sus fotos? Su lote queda suelto, sin predio. Después puedes deshacerlo.');
    await page.click('#lotDelBox [data-act="lotDelete"]'); await waitSheetClosed();
    assert.match(await toastText(), /^«Predio» eliminado con sus 4 puntos\./);
    assert.deepEqual((await lots()).map((l) => l.name), ['Cafetal']);
    await page.click('#toast button');
    assert.deepEqual((await lots()).map((l) => l.name), ['Predio', 'Cafetal']);
    assert.deepEqual(errors, []);
  });
};

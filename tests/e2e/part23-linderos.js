'use strict';
/* Recorrido 23 — versión 2.21.0: ajustar a los linderos. Cuando un área se monta sobre otra o se sale de su finca, la app
   pregunta «Ajustar a los linderos» o «Dejar sobrepuesto»; el ajuste recorta el área y se puede deshacer. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, waitSheetClosed, sheetTitle, toastText, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const openMap = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' }); };
  const nuevo = async (kind, name, parent) => {
    await openMap(); await act('lotNewMap');
    await page.click('#lotKind button:has-text("' + kind + '")');
    if (parent) await page.selectOption('#lotParent', parent);
    await fill('#lotName', name);
    await act('lotSave'); await waitSheetClosed();
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await tab('puntos');
  };
  // Agrega un punto que hace chocar el polígono: en vez de cerrarse, la hoja pasa a ser la de «Linderos»
  const addChoca = async (coords) => {
    await act('addCoords'); await fill('#fCoord', coords); await fill('#fAlt', '1000');
    await page.click('[data-act="saveNew"][data-more="0"]');
    await page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Linderos'; });
  };
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const toWorld = (lat, lon, z) => { const k = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * k, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * k }; };
  const tapMap = async (lat, lon) => {
    const i = await info(), b = await page.locator('#mapHost .mapa-leaflet').boundingBox(), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom);
    await page.mouse.click(b.x + b.width / 2 + q.x - o.x, b.y + b.height / 2 + q.y - o.y);
  };
  const croquis = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]'); };
  const sq = (lat, lon, dLat, dLon) => [[lat, lon], [lat, lon + dLon], [lat + dLat, lon + dLon], [lat + dLat, lon]];
  const D = 0.0018;                    // ≈ 200 m
  let finca, cafetal, bosque;

  await step('Se arma una finca con un cafetal dentro: mientras nada choca no se pregunta nada', async () => {
    await fresh();
    await nuevo('Predio', 'La Esperanza');
    for (const [la, lo] of sq(4.6, -74.08, D, D)) await addPointManual(la + ', ' + lo, 1000);
    finca = (await lots())[0].id;
    await nuevo('Lote', 'Cafetal', finca);
    for (const [la, lo] of sq(4.6002, -74.0798, D / 2, D / 2)) await addPointManual(la + ', ' + lo, 1000);
    cafetal = (await lots())[1].id;
    await croquis();
    assert.equal(await page.locator('#areaOverlap').count(), 0);
    assert.equal(await page.locator('#adjBtn').count(), 0, 'sin choque no hay botón de ajustar');
  });

  await step('El bosque se monta sobre el cafetal y se sale del predio: al tercer punto la app pregunta y muestra cómo quedaría', async () => {
    await nuevo('Lote', 'Bosque', finca);
    // un rectángulo que empieza dentro del cafetal y se sale del predio por el oriente
    const pts = [[4.6006, -74.0794], [4.6006, -74.0775], [4.6014, -74.0775], [4.6014, -74.0794]];
    await addPointManual(pts[0].join(', '), 1000); await addPointManual(pts[1].join(', '), 1000);
    await addChoca(pts[2].join(', '));
    assert.equal(await sheetTitle(), 'Linderos');
    assert.equal(await text('#adjWhat'), '«Bosque» se sale del predio «La Esperanza» y se monta sobre «Cafetal».');
    assert.match(await text('#adjPlan'), /su borde sigue el del predio y el de su vecino: queda de [\d,]+ ha \(hoy [\d,]+ ha\)\. Se agregan \d+ puntos en el lindero y se quita\w* \d+ que quedaba\w* por fuera o encima; los puntos se numeran de nuevo\./);
    assert.deepEqual(await page.$$eval('#sheet .btns button', (b) => b.map((x) => x.textContent)), ['Ajustar a los linderos', 'Dejar sobrepuesto']);
    await shot('v221-pregunta');
    await act('adjustKeep'); await waitSheetClosed();
    bosque = (await lots())[2].id;
    assert.equal((await lots())[2].points.length, 3, '«Dejar sobrepuesto» no cambia nada');
  });

  await step('«Dejar sobrepuesto»: no vuelve a preguntar por el mismo choque, pero el aviso y el botón quedan en «Polígono»', async () => {
    await addPointManual('4.6014, -74.0794', 1000);                    // el cuarto punto: mismo choque, no pregunta (la hoja se cierra)
    assert.equal((await lots())[2].points.length, 4);
    await croquis();
    assert.match(await text('#areaOverlap'), /«Bosque» se sale del predio «La Esperanza»/);
    assert.match(await text('#areaOverlap'), /«Cafetal» y «Bosque»/);
    assert.equal(await text('#adjBtn'), 'Ajustar «Bosque» a los linderos');
    const b = await page.locator('#adjBtn').boundingBox(); assert.ok(b.height >= 44, 'botón cómodo de tocar');
    // en el mapa está en «Más opciones», y solo mientras hay choque
    await openMap(); await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await text('#moreAdj'), /^«Bosque» se sale del predio «La Esperanza» y se monta sobre «Cafetal»\. Puedes recortarlo/);
    await page.click('#sheet [data-act="adjustAsk"]');
    assert.equal(await sheetTitle(), 'Linderos');
    await act('adjustKeep'); await waitSheetClosed();
    await croquis();
  });

  await step('«Ajustar a los linderos»: el bosque queda dentro de la finca y pegado al cafetal, sin avisos; los puntos se numeran de nuevo', async () => {
    const antes = (await lots())[2].points;
    await act('adjustAsk');
    assert.equal(await sheetTitle(), 'Linderos');
    await act('adjustDo'); await waitSheetClosed();
    assert.match(await toastText(), /^«Bosque» ajustado a los linderos: [\d,]+ ha\./);
    const ls = await lots(), pts = ls[2].points;
    assert.equal(pts.length, 6, 'una L: 6 esquinas');
    assert.deepEqual(pts.map((p) => p.name), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    assert.equal(new Set(pts.map((p) => p.id)).size, 6, 'cada punto con su identificador');
    const este = -74.08 + D;
    assert.ok(pts.every((p) => p.lon <= este + 1e-7), 'ningún punto pasa del lindero oriental de la finca');
    assert.equal(pts.filter((p) => Math.abs(p.lon - este) < 1e-7).length, 2, 'dos puntos nuevos sobre el lindero de la finca');
    assert.ok(pts.every((p) => typeof p.lat === 'number' && p.alt === 1000), 'los nuevos traen altitud (interpolada entre vecinos)');
    assert.ok(antes.filter((a) => pts.some((p) => p.id === a.id)).length >= 1, 'los puntos propios que seguían dentro se conservan');
    assert.equal(ls[0].points.length, 4); assert.equal(ls[1].points.length, 4, 'la finca y el cafetal no cambian');
    assert.equal(await page.locator('#areaOverlap').count(), 0, 'ya no hay avisos');
    assert.equal(await page.locator('#adjBtn').count(), 0);
    await openMap(); await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await page.locator('#moreAdj').count(), 0, 'sin choque, «Más opciones» no lo ofrece');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await croquis();
    await shot('v221-ajustado');
  });

  await step('«Deshacer» devuelve el polígono como estaba (con el botón del mapa o con el del aviso), y se puede volver a ajustar', async () => {
    await openMap();
    await page.click('#mapUndoBtn');
    assert.match(await toastText(), /Se deshizo: ajustar a los linderos/);
    let pts = (await lots())[2].points;
    assert.equal(pts.length, 4);
    assert.deepEqual(pts.map((p) => p.name), ['P1', 'P2', 'P3', 'P4']);
    await croquis();
    assert.equal(await page.locator('#adjBtn').count(), 1);
    await act('adjustAsk'); await act('adjustDo'); await waitSheetClosed();
    assert.equal((await lots())[2].points.length, 6);
    await page.click('#toast button');
    pts = (await lots())[2].points;
    assert.equal(pts.length, 4);
    assert.deepEqual(pts.map((p) => p.name), ['P1', 'P2', 'P3', 'P4']);
    await act('adjustAsk'); await act('adjustDo'); await waitSheetClosed();
    assert.equal((await lots())[2].points.length, 6);
  });

  await step('Tocando el mapa pasa lo mismo: al marcar un punto fuera de la finca pregunta, y al ajustar el área queda dentro', async () => {
    await openMap(); await act('lotNewMap');
    await page.click('#lotKind button:has-text("Lote")'); await page.selectOption('#lotParent', finca); await fill('#lotName', 'Potrero');
    await act('lotSave'); await waitSheetClosed();
    for (const [la, lo] of [[4.6001, -74.0788], [4.6001, -74.0784]]) { await tapMap(la, lo); await c.waitToast(/creado/); await page.waitForTimeout(350); }
    assert.equal(await c.sheetOpen(), false, 'dos puntos dentro de la finca: no pregunta');
    await tapMap(4.6004, -74.0779);                                      // unos 30 m al oriente del lindero de la finca
    await page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Linderos'; });
    assert.equal(await text('#adjWhat'), '«Potrero» se sale del predio «La Esperanza».');
    assert.match(await text('#adjPlan'), /su borde sigue el del predio: queda de/);
    await act('adjustDo'); await waitSheetClosed();
    const pts = (await lots())[3].points, este = -74.08 + D;
    assert.equal(pts.length, 4, 'el triángulo recortado por el lindero queda de 4 esquinas');
    assert.ok(pts.every((p) => p.lon <= este + 1e-7));
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await croquis();
    assert.equal(await page.locator('#areaOverlap').count(), 0);
  });

  await step('Cuando no se puede ajustar lo explica: un vecino metido por completo dejaría un hueco', async () => {
    await nuevo('Lote', 'Casa', finca);
    // tres puntos dentro del cafetal: la casa queda por completo dentro de él
    await addPointManual('4.6004, -74.0796', 1000); await addPointManual('4.6004, -74.0795', 1000);
    await addChoca('4.6005, -74.0795');
    assert.equal(await text('#adjWhat'), '«Casa» se monta sobre «Cafetal».');
    assert.match(await text('#adjNo'), /queda por completo dentro de otro/);
    assert.deepEqual(await page.$$eval('#sheet .btns button', (b) => b.map((x) => x.textContent)), ['Dejar como está']);
    await act('adjustKeep'); await waitSheetClosed();
    // desde el cafetal: la casa está metida dentro y no se puede descontar
    await page.click('section.tab:not([hidden]) .lots .lotchip:has-text("Cafetal")');
    await croquis();
    await act('adjustAsk');
    assert.match(await text('#adjNo'), /«Casa» está por completo dentro de este polígono/);
    await act('adjustKeep'); await waitSheetClosed();
    assert.equal((await lots())[1].points.length, 4);
  });

  await step('Un proyecto de un solo lote nunca pregunta; sin errores de JavaScript', async () => {
    await fresh();
    await addPointManual('4.60, -74.08', 2600); await addPointManual('4.60, -74.07', 2650); await addPointManual('4.61, -74.075', 2700);
    await croquis();
    assert.equal(await page.locator('#adjBtn').count(), 0);
    assert.deepEqual(errors, []);
  });
};

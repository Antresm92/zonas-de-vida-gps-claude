'use strict';
/* Recorrido 26 — versión 2.23.4: dos predios dibujados tocando el mapa. La app pregunta al encimarse, muestra un aviso con «Ajustar»
   dentro del mapa mientras siguen encimados, vuelve a preguntar al tocar «Salir» y la paleta tiene 30 colores. */
module.exports = async function (c) {
  const { page, assert, step, fresh, rawAct, text, fill, addPointManual, waitSheetClosed, sheetTitle, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const toWorld = (lat, lon, z) => { const k = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * k, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * k }; };
  const tapMap = async (lat, lon) => {
    const i = await info(), b = await page.locator('#mapHost .mapa-leaflet').boundingBox(), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom);
    await page.mouse.click(b.x + b.width / 2 + q.x - o.x, b.y + b.height / 2 + q.y - o.y);
  };
  const act = (n) => page.click('#sheet [data-act="' + n + '"]');
  const linderos = () => page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Linderos' && !document.querySelector('#sheet').hidden; });
  const banner = () => page.evaluate(() => { const b = document.querySelector('#mapConflict'); return b && !b.hidden ? b.textContent : null; });

  await step('Dos predios tocando el mapa: al encimarse pregunta; con «Dejar sobrepuesto» queda un aviso con «Ajustar» dentro del mapa', async () => {
    await fresh();
    // el primer predio, de unos 1,1 km de lado, marcado con coordenadas
    for (const ll of ['4.600, -74.080', '4.600, -74.070', '4.610, -74.070', '4.610, -74.080']) await addPointManual(ll, 1000);
    // el segundo predio, dibujado tocando el mapa, se mete unos 300 m en el primero
    await page.click('section.tab:not([hidden]) [data-act="predioAdd"]');
    await fill('#lotName', 'Vecino');
    assert.equal(await page.locator('#sheet .palette .sw').count(), 30, 'paleta de 30 colores');
    await rawAct('lotSave'); await waitSheetClosed();
    assert.equal((await page.evaluate(() => window.__app.ui.mapMode)), 'add');
    await page.evaluate(() => { const u = window.__app.ui; u.map.fit({ south: 4.592, north: 4.612, west: -74.084, east: -74.060 }, { bottom: 140, top: 160 }); });
    await page.waitForTimeout(300);
    await tapMap(4.6020, -74.0730); await c.waitToast(/^P1 creado/); await page.waitForTimeout(350);
    await tapMap(4.6020, -74.0640); await c.waitToast(/^P2 creado/); await page.waitForTimeout(350);
    assert.equal(await banner(), null, 'con dos puntos todavía no hay polígono: no hay aviso');
    await tapMap(4.5940, -74.0640);
    await linderos();
    assert.equal(await text('#adjWhat'), '«Vecino» se monta sobre «Predio».');
    await act('adjustKeep'); await waitSheetClosed();
    assert.equal(await banner(), '⚠ Se monta sobre «Predio».Ajustar');
    const b = await page.locator('#mapConflict').boundingBox(), nb = await page.locator('.mapnew').boundingBox();
    assert.ok(nb.y >= b.y + b.height, '«＋ Polígono» baja para no tapar el aviso');
    await shot('v2234-aviso-linderos');
  });

  await step('«Salir» con el predio todavía encimado vuelve a preguntar; «Ajustar» del aviso lo deja pegado al vecino y el aviso desaparece', async () => {
    await page.click('#mapMode button');
    await linderos();
    assert.equal(await page.evaluate(() => window.__app.ui.mapMode), '');
    await act('adjustKeep'); await waitSheetClosed();
    assert.match(await banner(), /Se monta sobre «Predio»/);
    await page.click('#mapConflict button');
    await linderos();
    assert.match(await text('#adjPlan'), /su borde sigue el de su vecino/);
    await act('adjustDo'); await waitSheetClosed();
    assert.equal(await banner(), null, 'resuelto: el aviso se va solo');
    const ls = await lots();
    const v = ls.find((l) => l.name === 'Vecino');
    // el triángulo recortado sigue el lindero del predio: hay puntos nuevos justo sobre su borde oriental (lon −74,070) y sur (lat 4,600)
    assert.ok(v.points.some((p) => Math.abs(p.lon + 74.07) < 1e-7) && v.points.some((p) => Math.abs(p.lat - 4.6) < 1e-7), JSON.stringify(v.points.map((p) => [p.lat, p.lon])));
    assert.equal(ls[0].points.length, 4, 'el primer predio no cambia');
    assert.equal(await page.evaluate(() => { const s = window.__app.S, l = s.projects[0].lots; return window.Predio.conflicts(l, l[1].id); }), null);
    // «Salir» sin choque no pregunta
    await page.click('[data-act="mapMenu"], .mapkebab');
    await page.click('#mapMenuPanel input[data-mode="add"]');
    await page.click('#mapMode button');
    assert.equal(await c.sheetOpen(), false);
    assert.deepEqual(errors, []);
  });

};

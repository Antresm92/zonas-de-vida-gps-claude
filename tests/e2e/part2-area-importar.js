'use strict';
/* Recorrido 2 — Área, importar KML/KMZ/GeoJSON/GPX como capas de colores y exportar KML/GeoJSON/GPX/CSV. */
const Geo = require('../../www/js/geo.js');
const Gis = require('../../www/js/gis.js');

module.exports = async function (c) {
  const { page, assert, step, fresh, act, fill, tab, text, proj, state, toastText, waitToast, sheetOpen, sheetTitle, waitSheetClosed, addPointManual, download, setFile, fx, errors, shot } = c;
  const fincaArea = Geo.polygonArea(fx.FINCA);
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  const newProj = async (name) => {
    await act('projects'); await act('newProject'); await fill('#pName', name); await act('saveNewProject'); await waitSheetClosed();
    await tab('puntos');
  };
  const importFile = async (name, data, mime) => { await setFile('#gisFile', name, data, mime); await page.waitForSelector('#sheet:not([hidden])'); };

  await step('Área con 3 puntos: calcula, cambia de unidad y dibuja el polígono', async () => {
    await fresh();
    const pts = [[4.6000, -74.0800], [4.6000, -74.0700], [4.6090, -74.0750]];
    for (const [la, lo] of pts) await addPointManual(la + ', ' + lo, 2600);
    await tab('area');
    const m2 = await page.evaluate(() => window.__app.analysis().area.m2);
    near(m2, Geo.polygonArea(pts.map(([lat, lon]) => ({ lat, lon }))), 0.5, 'área m²');
    assert.match(await text('#tab-area .big'), /ha/);
    await page.click('[data-act="unit"][data-u="m2"]');
    assert.match(await text('#tab-area .big'), /m²/);
    assert.equal((await state()).settings.areaUnit, 'm2');
    await page.click('[data-act="unit"][data-u="fanegadas"]');
    assert.match(await text('#tab-area .big'), /fanegadas/);
    await page.click('[data-act="unit"][data-u="km2"]');
    assert.match(await text('#tab-area .big'), /km²/);
    await page.click('[data-act="unit"][data-u="ha"]');
    assert.equal(await page.locator('#tab-area .plot svg').count(), 1);
    assert.match(await text('#tab-area'), /Lados/);
    assert.match(await text('#tab-area'), /rumbo/);
  });

  await step('Con 1 o 2 puntos avisa que faltan para el área', async () => {
    await newProj('Dos puntos');
    await addPointManual('4.60, -74.08');
    await tab('area');
    assert.match(await text('#tab-area'), /Hay 1 punto\. Con 3 o más/);
    await tab('puntos');
    await addPointManual('4.61, -74.08');
    await tab('area');
    assert.match(await text('#tab-area'), /Distancia entre los dos puntos/);
    await tab('clima');
    assert.match(await text('#tab-clima'), /Altitud/);
  });

  await step('Lados que se cruzan: avisa, ordena los puntos y permite deshacer', async () => {
    await newProj('Lazo');
    for (const p of ['4.60, -74.08', '4.61, -74.07', '4.60, -74.07', '4.61, -74.08']) await addPointManual(p, 2600);
    await tab('area');
    assert.match(await text('#tab-area'), /Los lados se cruzan/);
    await act('reorder');
    assert.equal(await page.locator('#tab-area .warn').count(), 0);
    await page.click('[data-act="toastAction"]');
    assert.match(await text('#tab-area'), /Los lados se cruzan/);
  });

  await step('Importar un KMZ de Google Earth en un proyecto vacío: se vuelve el polígono y calcula el área', async () => {
    await fresh();
    await importFile('FincaEjemplo.json.kmz', fx.fincaKmz());
    assert.equal(await sheetTitle(), 'Importar archivo');
    assert.match(await text('#sheet'), /FincaEjemplo\.json\.kmz/);
    assert.match(await text('#sheet'), /1 polígono · 28 vértices/);
    assert.match(await text('#sheet'), /Usar como polígono del proyecto/);
    await shot('10-importar-kmz');
    await act('importMain');
    await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 28);
    assert.equal(p.layers.length, 0);
    assert.equal(p.points[0].src, 'archivo');
    const m2 = await page.evaluate(() => window.__app.analysis().area.m2);
    near(m2, fincaArea, 1, 'área de la finca');
    assert.match(await toastText(), /«Finca Ejemplo» es ahora el polígono/);
  });

  await step('Importar otro archivo en un proyecto con puntos: advierte y lo agrega como capa de otro color', async () => {
    await importFile('vecino.kml', fx.vecinoKml());
    assert.match(await text('#sheet'), /Este proyecto ya tiene 28 puntos/);
    assert.equal(await page.locator('#sheet [data-act="importLayer"]').count(), 1);
    assert.equal(await page.locator('#sheet [data-act="importMain"]').count(), 1);
    assert.equal(await page.locator('#sheet [data-act="importNew"]').count(), 1);
    await shot('11-importar-con-advertencia');
    await act('importLayer');
    await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 28, 'los puntos propios no cambian');
    assert.equal(p.layers.length, 2);
    assert.deepEqual(p.layers.map((l) => l.kind).sort(), ['points', 'polygon']);
    assert.notEqual(p.layers[0].color.toLowerCase(), p.mainColor.toLowerCase());
    assert.match(await text('#tab-puntos'), /Colores y capas/);
    assert.match(await text('#tab-puntos'), /Lote vecino/);
    const m2 = await page.evaluate(() => window.__app.analysis().area.m2);
    near(m2, fincaArea, 1, 'el área sigue siendo la de los puntos propios');
    await tab('area');
    const svg = await page.evaluate(() => document.querySelector('#tab-area .plot').innerHTML.toLowerCase());
    assert.ok(svg.includes((await proj()).layers[0].color.toLowerCase()), 'la capa se dibuja con su color');
    assert.ok(svg.includes((await proj()).mainColor.toLowerCase()), 'los puntos propios con el suyo');
    await shot('12-area-con-capas');
  });

  await step('Cambiar nombre y color de una capa, ocultarla y mostrarla', async () => {
    await tab('puntos');
    const id = (await proj()).layers.find((l) => l.kind === 'polygon').id;
    await page.click('.swatch[data-act="editLayer"][data-id="' + id + '"]');
    assert.equal(await sheetTitle(), 'Editar capa');
    await fill('#lName', '  Vecino   del   norte ');
    await page.click('#sheet .sw[data-color="#2980B9"]');
    assert.equal(await page.getAttribute('#sheet .sw[data-color="#2980B9"]', 'aria-pressed'), 'true');
    await act('saveEdit2'); await waitSheetClosed();
    let l = (await proj()).layers.find((x) => x.id === id);
    assert.equal(l.name, 'Vecino del norte');
    assert.equal(l.color, '#2980B9');
    await page.click('.mini[data-act="toggleLayer"][data-id="' + id + '"]');
    assert.equal((await proj()).layers.find((x) => x.id === id).visible, false);
    assert.match(await text('#tab-puntos'), /Oculta/);
    await tab('area');
    assert.ok(!(await page.evaluate(() => document.querySelector('#tab-area .plot').innerHTML)).includes('#2980B9'), 'oculta no se dibuja');
    await tab('puntos');
    await page.click('.mini[data-act="toggleLayer"][data-id="' + id + '"]');
    assert.equal((await proj()).layers.find((x) => x.id === id).visible, true);
  });

  await step('Cambiar el color de «Mis puntos»', async () => {
    await page.click('.swatch[data-act="editMain"]');
    assert.equal(await sheetTitle(), 'Color de mis puntos');
    await page.click('#sheet .sw[data-color="#8E44AD"]');
    await act('saveEdit2'); await waitSheetClosed();
    assert.equal((await proj()).mainColor, '#8E44AD');
  });

  await step('Usar una capa como polígono del proyecto: lo anterior queda como capa y se puede deshacer', async () => {
    const before = await proj();
    const lay = before.layers.find((l) => l.kind === 'polygon');
    await page.click('.swatch[data-act="editLayer"][data-id="' + lay.id + '"]');
    await act('layerToMain'); await waitSheetClosed();
    let p = await proj();
    assert.equal(p.points.length, 28);
    near(Geo.polygonArea(p.points), Geo.polygonArea(lay.points), 1, 'nuevo polígono');
    assert.ok(p.layers.some((l) => l.name === 'Mis puntos anteriores' && l.points.length === 28));
    assert.ok(!p.layers.some((l) => l.id === lay.id));
    await page.click('[data-act="toastAction"]');
    p = await proj();
    near(Geo.polygonArea(p.points), fincaArea, 1, 'vuelve el polígono anterior');
    assert.ok(p.layers.some((l) => l.id === lay.id));
  });

  await step('Eliminar una capa y deshacer', async () => {
    const pts = (await proj()).layers.find((l) => l.kind === 'points');
    await page.click('.swatch[data-act="editLayer"][data-id="' + pts.id + '"]');
    await act('deleteLayer'); await waitSheetClosed();
    assert.equal((await proj()).layers.length, 1);
    assert.match(await toastText(), /eliminada/);
    await page.click('[data-act="toastAction"]');
    assert.equal((await proj()).layers.length, 2);
  });

  await step('Importar GeoJSON con polígono, línea y punto: tres capas con colores distintos', async () => {
    await importFile('lotes.geojson', fx.geojson());
    assert.match(await text('#sheet'), /1 polígono, 1 línea, 1 punto/);
    await act('importLayer'); await waitSheetClosed();
    const p = await proj();
    assert.equal(p.layers.length, 5);
    const added = p.layers.slice(2);
    assert.deepEqual(added.map((l) => l.kind).sort(), ['line', 'points', 'polygon']);
    assert.equal(new Set(p.layers.map((l) => l.color.toLowerCase())).size >= 4, true);
    assert.equal(await page.locator('li.layer').count(), 6);
    await page.click('[data-act="toastAction"]');
    assert.equal((await proj()).layers.length, 2);
  });

  await step('Reemplazar mis puntos con lo importado (con advertencia) y deshacer', async () => {
    await importFile('recorrido.gpx', fx.gpx());
    assert.match(await text('#sheet'), /1 polígono · 4 vértices/);      // un recorrido cerrado (el último punto = el primero) es un polígono
    await act('importMain'); await waitSheetClosed();
    let p = await proj();
    assert.equal(p.points.length, 4);
    assert.match(await toastText(), /tus puntos anteriores se reemplazaron/);
    await page.click('[data-act="toastAction"]');
    p = await proj();
    assert.equal(p.points.length, 28);
  });

  await step('Importar creando un proyecto nuevo y deshacerlo', async () => {
    const nProj = (await state()).projects.length;
    await importFile('Finca Norte.kmz', fx.fincaKmz());
    await act('importNew'); await waitSheetClosed();
    const s = await state();
    assert.equal(s.projects.length, nProj + 1);
    assert.equal((await proj()).name, 'Finca Norte');
    assert.equal((await proj()).points.length, 28);
    assert.equal(await text('#projName'), 'Finca Norte');
    await page.click('[data-act="toastAction"]');
    assert.equal((await state()).projects.length, nProj);
    assert.notEqual(await text('#projName'), 'Finca Norte');
  });

  await step('Archivos que no sirven: avisa claro y no cambia nada', async () => {
    const before = JSON.stringify(await proj());
    await setFile('#gisFile', 'notas.txt', 'esto es solo texto', 'text/plain');
    await waitToast(/No se pudo importar/);
    await setFile('#gisFile', 'vacio.geojson', JSON.stringify({ type: 'FeatureCollection', features: [] }), 'application/json');
    await waitToast(/no tiene polígonos, líneas ni puntos|No se pudo importar/);
    await setFile('#gisFile', 'roto.kml', '<kml><Document><Placemark>', 'application/xml');
    await waitToast(/No se pudo importar/);
    assert.equal(JSON.stringify(await proj()), before);
  });

  await step('Importar GeoJSON solo como capa en un proyecto vacío (sin puntos propios)', async () => {
    await newProj('Solo capas');
    await importFile('lotes.geojson', fx.geojson());
    assert.match(await text('#sheet'), /Este proyecto está vacío/);
    await act('importLayer'); await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 0);
    assert.equal(p.layers.length, 3);
    await tab('area');
    assert.match(await text('#tab-area'), /solo capas importadas/);
    assert.match(await text('#tab-area'), /Exportar/);
    await act('export', '[data-fmt="csv"]');
    assert.match(await toastText(), /Todavía no hay puntos/);
    await tab('clima');
    assert.match(await text('#tab-clima'), /Sin puntos todavía/);
  });

  await step('Exportar KML: se abre de vuelta y conserva el área, los colores y las capas', async () => {
    await fresh();
    await importFile('FincaEjemplo.json.kmz', fx.fincaKmz());
    await act('importMain'); await waitSheetClosed();
    await importFile('vecino.kml', fx.vecinoKml());
    await act('importLayer'); await waitSheetClosed();
    await tab('area');
    const f = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.match(f.name, /\.kml$/);
    const res = Gis.parseText(f.text);
    const polys = res.features.filter((x) => x.type === 'polygon');
    assert.equal(polys.length, 2);
    near(Geo.polygonArea(polys[0].coords), fincaArea, 1, 'área del KML exportado');
    assert.ok(/2F8F4E/i.test(f.text.replace(/#/g, '')) || /ff4e8f2f/i.test(f.text), 'color principal');
    assert.match(await toastText(), /descargado/);
  });

  await step('Exportar GeoJSON y GPX', async () => {
    const g = await download(() => page.click('[data-act="export"][data-fmt="geojson"]'));
    assert.match(g.name, /\.geojson$/);
    const j = JSON.parse(g.text);
    assert.equal(j.type, 'FeatureCollection');
    assert.ok(j.features.length >= 2);
    const gp = await download(() => page.click('[data-act="export"][data-fmt="gpx"]'));
    assert.match(gp.name, /\.gpx$/);
    const r = Gis.parseText(gp.text);
    assert.ok(r.features.length >= 1);
    assert.match(gp.text, /<gpx/);
  });

  await step('Exportar CSV: Punto, Latitud, Longitud, Altitud, Rumbo, Distancia (Excel en español y estándar)', async () => {
    const es = await download(() => page.click('[data-act="export"][data-fmt="csv"]'));
    assert.match(es.name, /\.csv$/);
    assert.equal(es.text.charCodeAt(0), 0xFEFF);
    const lines = es.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(lines[0], 'Punto;Latitud;Longitud;Altitud;Rumbo;Distancia al vértice siguiente');
    assert.equal(lines.length, 29);
    assert.match(lines[1], /^P1;4,\d{7};-74,\d{7};/);
    await page.click('[data-act="csvStyle"][data-s="std"]');
    assert.equal((await state()).settings.csvStyle, 'std');
    const std = await download(() => page.click('[data-act="export"][data-fmt="csv"]'));
    const l2 = std.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(l2[0], 'Punto,Latitud,Longitud,Altitud,Rumbo,Distancia al vértice siguiente');
    assert.match(l2[1], /^P1,4\.\d{7},-74\.\d{7},/);
    // suma de distancias = perímetro
    const sum = l2.slice(1).reduce((s, l) => s + parseFloat(l.split(',').pop()), 0);
    const per = await page.evaluate(() => window.__app.analysis().perimeter);
    near(sum, per, 1, 'suma de distancias del CSV');
    await page.click('[data-act="csvStyle"][data-s="es"]');
  });

  await step('Exportar también desde la pestaña Informe', async () => {
    await page.evaluate(() => { const p = window.__app.S.projects.find((x) => x.id === window.__app.S.currentId); p.climate.pManual = 1200; p.climate.altOverride = 2600; });
    await tab('informe');
    assert.ok(await page.locator('#tab-informe [data-act="export"]').count() >= 4);
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

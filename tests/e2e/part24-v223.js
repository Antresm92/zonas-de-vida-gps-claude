'use strict';
const Zip = require('../../www/js/zip.js');
/* Recorrido 24 — versión 2.23.0: «＋ Lote» y «＋ Predio» en la fila de arriba, importar polígonos de un archivo directamente como
   predios o lotes (eligiendo cuáles), elegir cuáles de los importados se ajustan a los linderos, exportar solo el polígono elegido
   y la paleta de 25 colores. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, download, waitSheetClosed, sheetTitle, toastText, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const chips = () => page.$$eval('section.tab:not([hidden]) .lots .lotchip', (b) => b.map((x) => x.textContent.replace(/ · [\d.,]+ ha/, '').trim() + (x.getAttribute('aria-pressed') === 'true' ? ' *' : '')));
  const sq = (la, lo, d) => [[la, lo], [la, lo + d], [la + d, lo + d], [la + d, lo]];
  const kml = (items) => '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>' + items.map(([name, pts, line]) =>
    '<Placemark><name>' + name + '</name>' + (line ? '<LineString><coordinates>' : '<Polygon><outerBoundaryIs><LinearRing><coordinates>') +
    pts.concat(line ? [] : [pts[0]]).map(([la, lo]) => lo + ',' + la + ',900').join(' ') +
    (line ? '</coordinates></LineString>' : '</coordinates></LinearRing></outerBoundaryIs></Polygon>') + '</Placemark>').join('') + '</Document></kml>';
  const file = (name, items) => ({ name, mimeType: 'application/vnd.google-earth.kml+xml', buffer: Buffer.from(kml(items)) });
  const conflicts = (id) => page.evaluate((i) => { const c = window.Predio.conflicts(window.__app.S.projects[0].lots, i); return c ? c.text : null; }, id);
  const croquis = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]'); };

  await step('Fila de arriba: «＋ Lote» y «＋ Predio» están siempre, también con el proyecto vacío; cada uno abre su hoja con dos caminos', async () => {
    await fresh();
    assert.deepEqual(await chips(), ['Predio *', '＋ Lote', '＋ Predio']);
    await act('predioAdd');
    assert.equal(await sheetTitle(), 'Nuevo predio');
    assert.deepEqual(await page.$$eval('#lotMode button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['Dibujar:true', 'Importar archivo:false']);
    assert.equal(await page.locator('#lotKind').count(), 0, '«＋ Predio» no pregunta el tipo');
    assert.equal(await page.locator('#sheet .palette .sw').count(), 25, 'paleta de 25 colores');
    assert.equal(new Set(await page.$$eval('#sheet .palette .sw', (b) => b.map((x) => x.getAttribute('data-color').toUpperCase()))).size, 25, 'sin colores repetidos');
    const sw = await page.locator('#sheet .palette .sw').first().boundingBox(); assert.ok(sw.width >= 40 && sw.height >= 40, 'colores cómodos de tocar');
    await shot('v223-nuevo-predio');
    await page.click('#lotMode [data-m="file"]');
    assert.match(await text('#lotFileHint'), /Cada polígono del archivo entra como predio, con el nombre y los puntos que trae, con el lindero bloqueado/);
    assert.equal(await page.locator('#lotName').count(), 0, 'al importar no se pide nombre ni color: vienen del archivo');
  });

  await step('«＋ Predio» › Importar archivo: el polígono entra directo como predio (sin pasar por las capas) y reemplaza al predio vacío', async () => {
    await act('predioAdd'); await page.click('#lotMode [data-m="file"]');
    await page.setInputFiles('#polyFile', file('la-vega.kml', [['La Vega', sq(4.60, -74.08, 0.01)], ['Camino', [[4.6, -74.08], [4.61, -74.07]], true]]));
    await page.waitForSelector('#lotPolys');
    assert.equal(await text('#lotFileName'), 'la-vega.kml · 1 polígono');
    assert.match(await text('#lotPolys'), /^La Vega · [\d.,]+ ha · 4 puntos$/);
    assert.equal(await text('#lotImportBtn'), 'Importar como predio');
    await act('lotImport'); await waitSheetClosed();
    assert.equal(await toastText(), '«La Vega» importado como predio, con el lindero bloqueado.Deshacer');
    const ls = await lots();
    assert.equal(ls.length, 1, 'reemplazó al «Predio» vacío');
    assert.deepEqual([ls[0].name, ls[0].kind, ls[0].locked, ls[0].points.length, ls[0].points[0].alt, ls[0].mainColor], ['La Vega', 'finca', true, 4, 900, '#2F8F4E']);
    assert.equal((await state()).projects[0].layers.length, 0, 'no quedó ninguna capa');
    assert.deepEqual(await chips(), ['La Vega 🔒 *', '＋ Lote', '＋ Predio']);
  });

  await step('«＋ Lote» › Importar archivo con varios polígonos: se listan, se elige cuáles y entran como lotes del predio; luego se elige cuáles ajustar a los linderos', async () => {
    await act('lotAdd');
    assert.equal(await sheetTitle(), 'Nuevo lote');
    assert.equal(await page.locator('#lotKind').count(), 0, '«＋ Lote» no pregunta el tipo');
    assert.equal(await page.inputValue('#lotParent'), (await lots())[0].id, 'ya viene asignado al predio');
    await page.click('#lotMode [data-m="file"]');
    await page.setInputFiles('#polyFile', file('lotes.kml', [
      ['Cafetal', sq(4.602, -74.078, 0.002)], ['Bosque', sq(4.603, -74.077, 0.003)],          // el bosque se monta sobre el cafetal
      ['Potrero', sq(4.608, -74.072, 0.004)],                                                  // el potrero se sale del predio por el nororiente
      ['Casa', sq(4.601, -74.074, 0.001)]
    ]));
    await page.waitForSelector('#lotPolys');
    assert.equal(await text('#lotFileName'), 'lotes.kml · 4 polígonos');
    assert.deepEqual(await page.$$eval('#lotPolys .impoly', (l) => l.map((x) => x.textContent.replace(/ · .*/, '') + ':' + x.querySelector('input').checked)), ['Cafetal:true', 'Bosque:true', 'Potrero:true', 'Casa:true']);
    const b = await page.locator('#lotPolys .impoly').first().boundingBox(); assert.ok(b.height >= 44, 'casilla cómoda de tocar');
    await page.click('#lotPolys .impoly:nth-child(4) input');                                  // la casa no
    await shot('v223-elegir-poligonos');
    assert.equal(await text('#lotImportBtn'), 'Importar como lotes');
    await act('lotImport');
    await page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Linderos'; });
    let ls = await lots();
    assert.deepEqual(ls.map((l) => l.name + ':' + l.kind), ['La Vega:finca', 'Cafetal:area', 'Bosque:area', 'Potrero:area']);
    assert.ok(ls.slice(1).every((l) => l.parent === ls[0].id && l.points.length === 4 && !l.locked));
    assert.equal(new Set(ls.map((l) => l.mainColor)).size, 4, 'cada uno con un color distinto');
    assert.equal((await state()).projects[0].lotId, ls[1].id, 'queda elegido el primero importado');
    // después de importar, la app lista los lotes que chocan y deja elegir cuáles ajustar a los linderos
    assert.equal(await text('#adjWhat'), '3 de los lotes importados se salen de su predio o se montan sobre otro polígono.');
    assert.deepEqual(await page.$$eval('#adjList .adjpick', (l) => l.map((x) => x.textContent + ':' + x.querySelector('input').checked)),
      ['Cafetal · se monta sobre «Bosque».:true', 'Bosque · se monta sobre «Cafetal».:true', 'Potrero · se sale del predio «La Vega».:true']);
    assert.deepEqual(await page.$$eval('#sheet .btns button', (x) => x.map((e) => e.textContent)), ['Ajustar los marcados', 'Dejar todos sobrepuestos']);
    await shot('v223-cuales-ajustar');
    await page.click('#adjList .adjpick:nth-child(3) input');                                  // el potrero se deja como está
    await act('adjustMany'); await waitSheetClosed();
    assert.equal(await toastText(), '2 lotes ajustados a los linderos.Deshacer');
    ls = await lots();
    assert.equal(await conflicts(ls[1].id), null); assert.equal(await conflicts(ls[2].id), null);
    assert.equal(await conflicts(ls[3].id), '«Potrero» se sale del predio «La Vega».', 'el que no se marcó sigue igual');
    assert.equal(ls[1].points.length, 6, 'el cafetal se recortó contra el bosque (una L)'); assert.equal(ls[2].points.length, 4); assert.equal(ls[3].points.length, 4);
    assert.deepEqual(await chips(), ['La Vega 🔒', 'Cafetal *', 'Bosque', 'Potrero', '＋ Lote', '＋ Predio']);
    await page.click('#toast button');
    ls = await lots();
    assert.equal(ls[1].points.length, 4, '«Deshacer» devuelve los linderos importados');
    assert.match(await conflicts(ls[1].id), /se monta sobre «Bosque»/);
  });

  await step('Sin marcar ninguno no ajusta nada; un archivo sin polígonos lo dice; «Deshacer» quita lo importado', async () => {
    await act('lotAdd'); await page.click('#lotMode [data-m="file"]');
    await page.setInputFiles('#polyFile', file('camino.kml', [['Camino', [[4.6, -74.08], [4.61, -74.07]], true]]));
    assert.match(await toastText(), /^No se pudo importar: el archivo no trae polígonos/);
    assert.equal(await page.locator('#lotPolys').count(), 0);
    await page.setInputFiles('#polyFile', file('casa.kml', [['Casa', sq(4.601, -74.074, 0.001)], ['Huerta', sq(4.6065, -74.079, 0.001)]]));
    await page.waitForSelector('#lotPolys');
    await page.click('#lotPolys .impoly:nth-child(1) input'); await page.click('#lotPolys .impoly:nth-child(2) input');
    await act('lotImport');
    assert.match(await toastText(), /Marca al menos un polígono/);
    await page.click('#lotPolys .impoly:nth-child(1) input');
    assert.equal(await text('#lotImportBtn'), 'Importar como lotes');
    await act('lotImport'); await waitSheetClosed();
    assert.equal(await toastText(), '«Casa» importado como lote.Deshacer');
    assert.equal(await c.sheetOpen(), false, 'la casa no choca con nada: no pregunta');
    assert.equal((await lots()).length, 5);
    await page.click('#toast button');
    assert.equal((await lots()).length, 4);
    assert.match((await chips())[1], /^Cafetal \*$/, 'vuelve a quedar elegido el de antes');
  });

  await step('Exportar solo el polígono elegido: un archivo aparte con su nombre, en KML, CSV y Shapefile', async () => {
    await croquis();
    assert.deepEqual(await page.$$eval('#expScope button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['Todo el proyecto:true', 'Solo «Cafetal»:false']);
    const todo = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.equal(todo.name, 'mi-primer-proyecto.kml'); assert.equal(todo.text.split('<Polygon>').length - 1, 4);
    await page.click('#expScope [data-s="one"]');
    assert.deepEqual(await page.$$eval('#expScope button', (b) => b.map((x) => x.getAttribute('aria-pressed'))), ['false', 'true']);
    const uno = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.equal(uno.name, 'mi-primer-proyecto-cafetal.kml');
    assert.equal(uno.text.split('<Polygon>').length - 1, 1); assert.match(uno.text, /<name>Cafetal<\/name>/); assert.doesNotMatch(uno.text, /Bosque|La Vega/);
    const csv = await download(() => page.click('[data-act="export"][data-fmt="csv"]'));
    assert.equal(csv.name, 'mi-primer-proyecto-cafetal.csv');
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(lines[0], /^Punto;Latitud;/); assert.equal(lines.length, 5);
    const shp = await download(() => page.click('[data-act="export"][data-fmt="shp"]'));
    assert.equal(shp.name, 'mi-primer-proyecto-cafetal-shapefile.zip');
    assert.ok(Zip.entries(shp.bytes).some((e) => e.name === 'mi_primer_proyecto_cafetal_poligono.shp'));
    await shot('v223-exportar-uno');
    // ida y vuelta: lo exportado se importa como lote en un proyecto nuevo
    await fresh();
    await act('lotAdd'); await page.click('#lotMode [data-m="file"]');
    await page.setInputFiles('#polyFile', { name: uno.name, mimeType: 'application/vnd.google-earth.kml+xml', buffer: Buffer.from(uno.text) });
    await page.waitForSelector('#lotPolys');
    assert.match(await text('#lotPolys'), /^Cafetal · [\d.,]+ ha · 4 puntos$/);
    await act('lotImport'); await waitSheetClosed();
    const ls = await lots();
    assert.deepEqual(ls.map((l) => l.name + ':' + l.kind + ':' + l.points.length), ['Predio:finca:0', 'Cafetal:area:4']);
    assert.equal(ls[1].parent, ls[0].id, 'queda asignado al predio aunque todavía no tenga puntos');
    await croquis();
    assert.equal(await page.locator('#expScope').count(), 1);
  });

  await step('«＋ Polígono» del mapa conserva la elección Predio o Lote y también ofrece importar; con un solo polígono no hay selector de exportar', async () => {
    await fresh();
    await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    await act('lotNewMap');
    assert.equal(await sheetTitle(), 'Crear polígono');
    assert.deepEqual(await page.$$eval('#lotKind button', (x) => x.map((e) => e.textContent + ':' + e.getAttribute('aria-pressed'))), ['Predio:true', 'Lote:false']);
    assert.deepEqual(await page.$$eval('#lotMode button', (b) => b.map((x) => x.textContent)), ['Dibujar', 'Importar archivo']);
    await page.click('#lotMode [data-m="file"]'); await page.click('#lotKind [data-k="area"]');
    assert.match(await text('#lotFileHint'), /entra como lote/);
    assert.deepEqual(await page.$$eval('#lotMode button', (b) => b.map((x) => x.getAttribute('aria-pressed'))), ['false', 'true'], 'cambiar el tipo no pierde el camino elegido');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await croquis();
    assert.equal(await page.locator('#expScope').count(), 0);
    assert.deepEqual(errors, []);
  });
};

'use strict';
const Zip = require('../../www/js/zip.js');
const { solidPng } = require('../helpers/png.js');
/* Recorrido 17 — versión 2.14.0: coordenadas planas de Colombia (Origen Nacional), pendiente del terreno, Shapefile y autor y logo del reporte. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, download, waitSheetClosed, sheetTitle, toastText, errors, shot } = c;
  const tres = async () => {
    await addPointManual('4.60, -74.08', 2600, 'Portada');
    await addPointManual('4.60, -74.07', 2650);
    await addPointManual('4.61, -74.075', 2700);
    await tab('clima'); await fill('[data-field="pManual"]', '1200'); await page.press('[data-field="pManual"]', 'Enter');   // con lluvia el reporte queda completo
  };

  await step('Coordenadas planas: se ven al escribir un punto y en el centro del polígono', async () => {
    await fresh();
    await act('addCoords'); await fill('#fCoord', '4.6, -74.08');
    assert.match(await text('#fPrev'), /Planas \(Origen Nacional\): E 4\.880\.248 m · N 2\.066\.386 m/);
    await fill('#fCoord', '40.4, -3.7');                                // fuera de Colombia no se muestran
    assert.doesNotMatch(await text('#fPrev'), /Planas/);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await tres();
    await tab('area');
    assert.match(await text('#areaPlana'), /^E 4\.\d{3}\.\d{3} m · N 2\.\d{3}\.\d{3} m$/);
    await shot('v214-planas');
  });

  await step('Pendiente: el perfil del relieve trae la pendiente media y su clase del IGAC', async () => {
    await tab('informe');
    const kv = await page.$$eval('#tab-informe dl.kv dt', (d) => d.map((x) => x.textContent));
    const i = kv.indexOf('Pendiente media del terreno');
    assert.ok(i >= 0, 'dt: ' + kv.join(' | '));
    assert.equal(kv[i + 1], 'Clase de pendiente (IGAC)');
    const dd = await page.$$eval('#tab-informe dl.kv dd', (d) => d.map((x) => x.textContent));
    assert.equal(dd[i], '8,1 % (4,7°) · baja hacia el suroeste');       // sube 50 m al este y 75 m al norte en ~1,1 km: cae hacia el suroeste
    assert.equal(dd[i + 1], 'c · moderadamente inclinado (7–12 %)');
    const tips = await page.$$eval('#tab-informe .tip', (d) => d.map((x) => x.textContent));
    assert.ok(tips.some((t) => /ajustar un plano a los 3 puntos/.test(t)), 'avisos: ' + tips.join(' | '));
  });

  await step('Shapefile: el botón descarga un .zip con las capas de puntos y polígono', async () => {
    await tab('area');
    const f = await download(() => page.click('[data-act="export"][data-fmt="shp"]'));
    assert.equal(f.name, 'mi-primer-proyecto-shapefile.zip');
    assert.equal(Zip.isZip(f.bytes), true);
    const names = Zip.entries(f.bytes).map((e) => e.name).sort();
    assert.deepEqual(names, ['mi_primer_proyecto_poligono.cpg', 'mi_primer_proyecto_poligono.dbf', 'mi_primer_proyecto_poligono.prj', 'mi_primer_proyecto_poligono.shp', 'mi_primer_proyecto_poligono.shx',
      'mi_primer_proyecto_puntos.cpg', 'mi_primer_proyecto_puntos.dbf', 'mi_primer_proyecto_puntos.prj', 'mi_primer_proyecto_puntos.shp', 'mi_primer_proyecto_puntos.shx']);
    assert.match(await toastText(), /Archivo descargado: mi-primer-proyecto-shapefile\.zip/);
    assert.match(await text('#exportBlock'), /Shapefile.*ArcGIS, QGIS/s);
    // sin puntos avisa en vez de descargar
    await fresh(); await tab('area');
    if (await page.locator('[data-act="export"][data-fmt="shp"]').count()) {
      await page.click('[data-act="export"][data-fmt="shp"]');
      assert.match(await toastText(), /Todavía no hay puntos/);
    }
  });

  await step('Autor y logo: se configuran en Herramientas y salen en el reporte', async () => {
    await fresh(); await tres();
    await tab('herramientas');
    assert.match(await text('[data-act="authorEdit"]'), /Autor, entidad y logo/);
    await act('authorEdit');
    assert.equal(await sheetTitle(), 'Encabezado del reporte');
    await fill('#auName', 'Ana Pérez');
    await fill('#auOrg', 'Finca <La Esperanza>');
    await page.setInputFiles('#logoFile', { name: 'logo.png', mimeType: 'image/png', buffer: solidPng(30, 120, 60, 255, 900) });
    await page.waitForSelector('#auLogo img');
    assert.equal(await page.inputValue('#auName'), 'Ana Pérez', 'lo escrito no se pierde al elegir el logo');
    const w = await page.$eval('#auLogo img', (i) => i.naturalWidth);
    assert.equal(w, 400, 'el logo se reduce a 400 px');
    await shot('v214-autor');
    await act('authorSave'); await waitSheetClosed();
    assert.match(await toastText(), /Encabezado del reporte guardado/);
    assert.match(await text('[data-act="authorEdit"]'), /Ana Pérez · Finca <La Esperanza> · con logo/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.author')));
    assert.equal(saved.name, 'Ana Pérez'); assert.match(saved.logo, /^\/9j\//);
    await tab('informe');
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /<p class="sub hl">Proyecto: Mi primer proyecto<\/p><p class="sub hl">Elaborado por: Ana Pérez · Finca &lt;La Esperanza&gt;<\/p><p class="sub hl">Fecha: [^<]+<\/p><\/div><img class="logo" src="data:image\/jpeg;base64,\/9j\//);   // el logo a la derecha del título
    assert.match(f.text, /Elaborado por: Ana Pérez · Finca &lt;La Esperanza&gt;/);
    assert.match(f.text, /Pendiente media del terreno/);
    assert.match(f.text, /EPSG:9377/);
    const pdf = await download(() => c.compartir('Pdf'));
    assert.match(pdf.name, /\.pdf$/);
    assert.match(Buffer.from(pdf.bytes).toString('latin1'), /\/Subtype \/Image/);
  });

  await step('Autor y logo: quitar el logo y cancelar no guarda nada; un archivo que no es imagen avisa', async () => {
    await tab('herramientas');
    await act('authorEdit');
    await page.click('[data-act="authorLogoDel"]');
    assert.equal(await page.locator('#auLogo img').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    assert.match((await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.author')))).logo, /^\/9j\//, 'sin «Guardar» el logo sigue');
    await act('authorEdit');
    await page.setInputFiles('#logoFile', { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
    assert.match(await toastText(), /No se pudo usar esa imagen/);
    await page.click('[data-act="authorLogoDel"]');
    await fill('#auName', ''); await fill('#auOrg', '');
    await act('authorSave'); await waitSheetClosed();
    assert.match(await text('[data-act="authorEdit"]'), /Autor, entidad y logo/);
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

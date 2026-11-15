'use strict';
/* Recorrido 29 — versión 2.29.0: «Usos recomendados» 🌱 en Información (clase de capacidad de uso del IGAC), la hoja
   «Evaluar el terreno», la estimación de las lluvias, las fuentes con su enlace, que se guarde y que salga en el reporte. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, sheetTitle, toastText, state, errors, shot, download } = c;
  const lot0 = async () => { const s = await state(); return s.projects[0].lots[0]; };
  const pick = (k, v) => page.selectOption('#sheet select[data-var="' + k + '"]', v);

  await step('Información muestra «Usos recomendados»: con pendiente, piso térmico y humedad ya da la clase (6p) y dice qué la limita', async () => {
    await fresh();
    // un plano que sube 30 m cada 100 m hacia el norte: 30 % de pendiente
    for (const [ll, alt] of [['5.0000, -75.0000', 1500], ['5.0000, -74.9991', 1500], ['5.0009, -74.9991', 1530], ['5.0009, -75.0000', 1530]]) await addPointManual(ll, alt);
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.climate.tManual = 21; l.climate.pManual = 1800; });
    await tab('clima');
    assert.match(await text('#usosBlock h2'), /Usos recomendados$/);
    assert.match(await text('#usosBlock .usoclase'), /^Clase 6 subclase 6p$/);
    assert.match(await text('#usosTxt'), /^Solo algunos cultivos semiperennes o perennes.*\[1\]$/);
    assert.equal(await text('#usosLimita'), 'La limita: Pendiente (25–50 %).');
    assert.equal(await text('#usosCuenta'), 'Evaluación: 3 de 21 datos. Provisional: lo que falta puede bajar la clase.');
    const auto = await page.$$eval('#usosAuto dd', (d) => d.map((x) => x.textContent));
    assert.match(auto[0], /^30 % \(25–50 %\), de 4 puntos con altitud$/);
    assert.equal(auto[1], 'Templado (21,0 °C)');
    assert.match(auto[2], /^Húmedo \(ETP\/P 0,\d\d\)$/);
    assert.match(await text('#usosBlock'), /no reemplaza un estudio de suelos/);
    await page.locator('#usosBlock').scrollIntoViewIfNeeded(); await shot('v229-usos');
  });

  await step('[1] abre la fuente con la cita del IGAC y su enlace; [2] explica la regla de la estimación', async () => {
    await page.click('#usosTxt [data-act="usosFuente"]');
    assert.equal(await sheetTitle(), 'Fuentes de «Usos recomendados»');
    assert.match(await text('#usosFuentes'), /IN-GAG-PC05-02.*el limitante más severo decide la clase \(pp\. 33–34\)/);
    assert.equal(await page.getAttribute('#usosFuentes a[data-ext]', 'href'), 'https://igac.gov.co/sites/default/files/listadomaestro/in-gag-pc05-02_clasificacion_de_las_tierras_por_su_capacidad_de_uso.pdf');
    assert.match(await text('#usosFuentes'), /Regla de la app, no del IGAC: un mes es seco cuando la lluvia \(mm\) es menor que el doble de la temperatura/);
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('«Evaluar el terreno»: todo en «No sé»; lo de campo baja la clase (7e) y «Deshacer» lo devuelve', async () => {
    await page.click('#usosEditBtn');
    assert.equal(await sheetTitle(), 'Evaluar el terreno');
    const vals = await page.$$eval('#sheet select[data-var]', (s) => s.map((x) => x.value));
    assert.equal(vals.length, 21); assert.ok(vals.every((v) => v === ''), 'todo empieza en «No sé»');
    assert.equal(await page.locator('#usosEst').count(), 0, 'sin la lluvia mes por mes no hay estimación');
    await pick('erosion', 'severa'); await pick('fertilidad', 'media');
    await page.click('#sheet [data-act="usosSave"]'); await waitSheetClosed();
    assert.match(await toastText(), /^Evaluación guardada\.Deshacer$/);
    assert.match(await text('#usosBlock .usoclase'), /^Clase 7 subclase 7e$/);
    assert.equal(await text('#usosLimita'), 'La limita: Erosión (Severa).');
    assert.match(await text('#usosCuenta'), /^Evaluación: 5 de 21 datos\./);
    assert.deepEqual((await lot0()).terreno, { erosion: 'severa', fertilidad: 'media' });
    assert.equal(await text('#usosEditBtn'), 'Evaluación del terreno (2 respuestas) ▾');
    await page.click('#toast button');
    assert.match(await text('#usosBlock .usoclase'), /^Clase 6 subclase 6p$/);
    assert.equal((await lot0()).terreno, undefined);
  });

  await step('Lluvias: con la lluvia mes por mes la app propone una estimación; «Usar la estimación» la marca y queda anotada', async () => {
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.climate.monthlyManual = { T: Array(12).fill(21), P: Array(12).fill(150) }; });
    await page.evaluate(() => window.__app.showTab('clima'));
    await page.click('#usosEditBtn');
    assert.match(await text('#usosEst'), /^Estimación de la app \[2\]: enero–junio: sin meses secos · julio–diciembre: sin meses secos\. Corresponde a «Suficientes los dos semestres»\. Lo que tú observes en campo manda\./);
    await page.click('#usosEst [data-act="usosEstUse"]');
    assert.equal(await page.inputValue('#usosLluvias'), '1');
    await pick('erosion', 'ligera');
    await shot('v229-evaluar');
    await page.click('#sheet [data-act="usosSave"]'); await waitSheetClosed();
    assert.deepEqual((await lot0()).terreno, { erosion: 'ligera', lluvias: '1', lluviasEst: true });
    assert.match(await text('#usosBlock .usoclase'), /^Clase 6 subclase 6p$/, 'erosión ligera y lluvias suficientes no cambian la clase');
    // si la persona cambia a mano la opción de la estimación, ya no queda como estimada
    await page.click('#usosEditBtn');
    await page.click('#usosEst [data-act="usosEstUse"]'); await pick('lluvias', '2');
    await page.click('#sheet [data-act="usosSave"]'); await waitSheetClosed();
    assert.deepEqual((await lot0()).terreno, { erosion: 'ligera', lluvias: '2' });
  });

  await step('Lo calculado se puede corregir en campo; «Borrar las respuestas» las quita y se puede deshacer', async () => {
    await page.click('#usosEditBtn');
    await page.click('#sheet details.help summary');
    await pick('pendiente', '7-12');
    await page.click('#sheet [data-act="usosSave"]'); await waitSheetClosed();
    assert.match(await text('#usosBlock .usoclase'), /^Clase 3 subclase 3p$/, 'con la pendiente medida en campo (7–12 %)');
    await page.click('#usosEditBtn');
    await page.click('#sheet [data-act="usosClear"]'); await waitSheetClosed();
    assert.match(await toastText(), /^Respuestas borradas\.Deshacer$/);
    assert.equal((await lot0()).terreno, undefined);
    await page.click('#toast button');
    assert.deepEqual((await lot0()).terreno, { erosion: 'ligera', lluvias: '2', pendiente: '7-12' });
  });

  await step('La evaluación queda guardada al volver a abrir la app y sale en el reporte, con su nota y la fuente', async () => {
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.deepEqual((await lot0()).terreno, { erosion: 'ligera', lluvias: '2', pendiente: '7-12' });
    await tab('informe');
    await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const h = f.text, i = h.indexOf('<h2>Usos recomendados</h2>');
    assert.ok(i > h.indexOf('<h2>Terreno</h2>') && i < h.indexOf('<h2>Puntos</h2>'), 'va entre Terreno y Puntos');
    const sec = h.slice(i, h.indexOf('<h2>Puntos</h2>'));
    assert.match(sec, /<th>Clase de capacidad de uso<\/th><td>Clase 3 · subclase 3p<\/td>/);
    assert.match(sec, /<th>La limita<\/th><td>Pendiente: 7–12 %<\/td>/);
    assert.match(sec, /no reemplaza un estudio de suelos\. Fuente: Instituto Geográfico Agustín Codazzi \(IGAC\)\..*capacidad_de_uso\.pdf/);
  });

  await step('Versión 2.29: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

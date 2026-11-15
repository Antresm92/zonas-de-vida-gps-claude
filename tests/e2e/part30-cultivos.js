'use strict';
/* Recorrido 30 — versión 2.30.0: «Cultivos a evaluar» en Usos recomendados y «Conclusión y recomendaciones» al final del
   reporte de cada polígono. */
module.exports = async function (c) {
  const { page, assert, step, fresh, tab, text, addPointManual, waitSheetClosed, sheetTitle, errors, shot, download } = c;

  await step('«Cultivos a evaluar ▾»: con clima y clase de tierra, agrupa 127 cultivos y dice qué los limita', async () => {
    await fresh();
    for (const [ll, alt] of [['5.0000, -75.0000', 1500], ['5.0000, -74.9991', 1500], ['5.0009, -74.9991', 1530], ['5.0009, -75.0000', 1530]]) await addPointManual(ll, alt);
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.climate.tManual = 21; l.climate.pManual = 1800; l.climate.monthlyManual = { T: Array(12).fill(21), P: [30, 30, 150, 200, 200, 150, 150, 150, 200, 250, 200, 150] }; });
    await tab('clima');
    assert.match(await text('#cultivosBtn'), /^Cultivos a evaluar \(\d+ óptimos, \d+ posibles\) ▾$/);
    await page.click('#cultivosBtn');
    assert.equal(await sheetTitle(), 'Cultivos a evaluar');
    const grupos = await page.$$eval('#sheet .cultgrp summary', (s) => s.map((x) => x.textContent));
    assert.equal(grupos.length, 4);
    const n = grupos.map((g) => +g.match(/\((\d+)\)$/)[1]);
    assert.equal(n.reduce((a, b) => a + b, 0), 127, 'los cuatro grupos suman los 127 cultivos');
    assert.match(grupos[0], /^Óptimos \(\d+\)$/); assert.match(grupos[3], /^No recomendados \(\d+\)$/);
    // clase 6 por pendiente (30 %): el café (perenne) puede quedar óptimo; la papa (transitoria) no se recomienda
    const opt = await page.$$eval('#sheet .cultgrp[data-grupo="optimo"] li b', (b) => b.map((x) => x.textContent));
    assert.ok(opt.includes('Café'), 'el café queda óptimo a 21 °C y 1800 mm');
    const no = await page.$eval('#sheet .cultgrp[data-grupo="no"]', (d) => d.textContent);
    assert.match(no, /Papa · Transitorio · clima \d+ %.*la clase 6 solo admite algunos cultivos semiperennes o perennes/);
    assert.match(await text('#sheet'), /No reemplaza la visita de un profesional/);
    await shot('v230-cultivos');
    await page.click('#sheet [data-act="usosFuente"][aria-label="Ver la fuente 3"]');
    assert.match(await text('#usosFuentes'), /\[3\] Cultivos a evaluar.*ECOCROP/);
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('El reporte termina cada polígono con «Conclusión y recomendaciones»', async () => {
    await tab('informe');
    await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const h = f.text, i = h.indexOf('<h2>Conclusión y recomendaciones</h2>');
    assert.ok(i > 0 && i > h.indexOf('Diagrama de Holdridge'), 'va al final');
    const sec = h.slice(i);
    assert.match(sec, /<p>El polígono «Predio» \(\d+,\d\d ha\) está en la zona de vida .* \(Holdridge\), con 21,0 °C de temperatura media y 1800 mm de lluvia al año y 2 meses secos \(Walter-Lieth\)\. Según el IGAC, su clase de capacidad de uso es 6p, limitada por pendiente \(provisional: faltan 18 datos\)\./);
    assert.match(sec, /<li>Con 30 % de pendiente, preferir cultivos permanentes densos.*\[1\]<\/li>/);
    assert.match(sec, /<li>Prever riego, cosecha de agua o cultivos tolerantes a la sequía para los 2 meses secos\. \[2\]<\/li>/);
    assert.match(sec, /<h3>Cultivos a evaluar<\/h3><p><b>Óptimos por clima y tierra:<\/b> [^<]*Café/);
    assert.match(sec, /<div class="note">Estimación hecha con los datos del reporte\. No reemplaza la visita de un profesional/);
    assert.match(sec, /\[3\] FAO, base de datos ECOCROP/);
  });

  await step('Versión 2.30: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

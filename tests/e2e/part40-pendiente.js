'use strict';
/* Recorrido 40 — versión 2.35.0: la pendiente con su margen.
   Un lote de 100 × 100 m que sube 10,4 m cada 100 m hacia el norte, con 4 puntos del GPS de ±1,2 m en la altitud: la pendiente
   es 10,4 % con una desviación de 1,2 puntos. Al 95 % (viene así, ± 2,4) puede ser 7–12 o 12–25 %: sale «incierta», no entra
   a la clase y la app pide medirla; al 68 % (± 1,2) sale firme, 7–12 %. Se revisan Preferencias, Información, la hoja que se
   abre sola, el número medido que manda, el reporte en la app, HTML y PDF con el nivel, un lote pequeño con altitudes de
   internet y un lote con fuentes mezcladas. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Geo = require('../../www/js/geo.js');

module.exports = async function (c) {
  const { page, assert, step, fresh, tab, text, fill, sheetTitle, waitSheetClosed, toastText, download, compartir, state, shot, shots, errors } = c;
  const F0 = Geo.localFrame([{ lat: 5, lon: -75 }]);
  // Las 4 esquinas, con la altitud del GPS (y su precisión) o de internet, guardadas como las guarda la app
  const esquinas = (src) => [[-50, -50], [50, -50], [50, 50], [-50, 50]].map(([x, y], i) => {
    const alt = 1500 + 0.104 * y, ll = Geo.fromXY(F0, { x, y });
    return { id: src + i, name: 'G' + (i + 1), lat: ll.lat, lon: ll.lon, alt, altGps: src === 'gps' ? alt : null, altSrc: src, acc: 3,
      altAcc: src === 'gps' ? 1.2 : null, src: src === 'gps' ? 'gps' : 'manual', ts: Date.now(), ...(src === 'gps' ? { altRef: 'egm2008', altN: 21 } : {}) };   // 2.35.1: ya al nivel del mar
  });
  const poner = (pts) => page.evaluate((p) => {
    const l = window.__app.S.projects[0].lots[0];
    l.points.length = 0; p.forEach((x) => l.points.push(x));
    l.climate.tManual = 21; l.climate.pManual = 1800;
    window.Store.saveState(window.__app.S);
    window.__app.showTab('clima');
  }, pts);
  const lot0 = async () => (await state()).projects[0].lots[0];
  const pend = () => text('#usosPend');
  const perfil = async () => {
    const dt = await page.$$eval('#tab-informe dl.kv dt', (d) => d.map((x) => x.textContent));
    const dd = await page.$$eval('#tab-informe dl.kv dd', (d) => d.map((x) => x.textContent));
    const out = {}; dt.forEach((k, i) => { if (/pendiente/i.test(k)) out[k] = dd[i]; });
    return out;
  };
  const textoPdf = (f, nombre) => {
    const file = path.join(shots, nombre); fs.writeFileSync(file, Buffer.from(f.bytes));
    return spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
  };
  const hayPdftotext = spawnSync('which', ['pdftotext']).status === 0;

  await step('Preferencias: «Margen de la pendiente» con las dos opciones y lo que quiere decir cada porcentaje; viene 95 %', async () => {
    await fresh();
    await tab('herramientas');
    const grupo = page.locator('#tab-herramientas [role="radiogroup"][aria-labelledby="pendMarT"]');
    assert.equal(await grupo.count(), 1);
    assert.equal(await text('#pendMarT'), 'Margen de la pendienteDecide cuándo la clase de pendiente del IGAC sale firme o incierta. Elige el que más se ajuste a tu necesidad.');
    const filas = await grupo.locator('.menurow').evaluateAll((els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent, e.querySelector('input').type, e.querySelector('input').checked]));
    assert.deepEqual(filas, [
      ['68 % (una desviación)', '68 % quiere decir que la pendiente real cae dentro del margen dos de cada tres veces. El margen es más angosto: menos lotes salen inciertos, pero una clase firme es menos segura.', 'radio', false],
      ['95 % (dos desviaciones, recomendado)', '95 % quiere decir que la pendiente real cae dentro del margen 19 de cada 20 veces. El margen es el doble de ancho: más lotes piden la medida en campo, pero una clase firme es muy confiable. Viene elegido.', 'radio', true]
    ]);
    assert.deepEqual(await page.$$eval('#tab-herramientas [role="radiogroup"]', (g) => g.map((x) => x.getAttribute('aria-labelledby'))), ['gpsMetT', 'pendMarT'], 'debajo del promedio del GPS');
    assert.equal(await page.evaluate(() => window.Store.loadFlag('pendiente68')), null, 'nada guardado: vale 95 %');
    await page.locator('#pendMarT').scrollIntoViewIfNeeded(); await shot('v2350-margen');
  });

  await step('Al 95 %: con el GPS la pendiente sale «incierta» (7–12 o 12–25 %), no entra a la clase, dice qué clase daría y pide medirla', async () => {
    await poner(esquinas('gps'));
    assert.equal(await pend(), '10,4 % ± 2,4 % (incierta: 7–12 o 12–25 %), de 4 puntos con altitudes del GPS, margen al 95 %');
    assert.match(await text('#usosBlock .usoclase'), /^Clase 1 subclase 1$/, 'sin la pendiente, con lo demás');
    assert.equal(await text('#usosCuenta'), 'Evaluación: 2 de 21 datos. Provisional: lo que falta puede bajar la clase. Con la pendiente, que es incierta, sería clase 3 o 4.');
    assert.equal(await text('#usosSlopeBtn'), 'Elegir la pendiente medida');
    await page.locator('#usosBlock').scrollIntoViewIfNeeded(); await shot('v2350-incierta');
  });

  await step('«Elegir la pendiente medida» abre «Lo calcula la app» con un aviso; un número que no sirve se avisa; el número manda sobre el rango', async () => {
    await page.click('#usosSlopeBtn');
    assert.equal(await sheetTitle(), 'Evaluar el terreno');
    assert.equal(await page.getAttribute('#usosAppDet', 'open'), '', 'ya desplegado');
    assert.equal(await text('#usosSlopeTip'), 'La pendiente calculada no alcanza para decidir la clase. Si mediste la pendiente en campo, con un clinómetro o un nivel, elige su rango o escribe el valor: manda sobre la calculada.');
    assert.equal(await page.locator('#usosSlopePct').isVisible(), true);
    assert.equal(await page.getAttribute('#usosSlopePct', 'inputmode'), 'decimal');
    await shot('v2350-medida');
    await fill('#usosSlopePct', 'abc');
    await page.click('#sheet [data-act="usosSave"]');
    assert.match(await toastText(), /^La pendiente medida debe ser un número entre 0 y 300 %\./);
    assert.equal(await sheetTitle(), 'Evaluar el terreno', 'la hoja sigue abierta');
    assert.equal((await lot0()).terreno, undefined, 'no se guardó nada');
    await page.selectOption('#sheet select[data-var="pendiente"]', '25-50');
    await fill('#usosSlopePct', '9,5');
    await page.click('#sheet [data-act="usosSave"]'); await waitSheetClosed();
    assert.deepEqual((await lot0()).terreno, { pendiente: '7-12', pendientePct: '9.5' }, 'el número pone su rango (7–12 %) sobre el elegido');
    assert.equal(await pend(), 'medida en campo: 9,5 % (7–12 %) · calculada: 10,4 % ± 2,4 % (95 %)');
    assert.match(await text('#usosBlock .usoclase'), /^Clase 3 subclase 3p$/);
    assert.equal(await page.locator('#usosSlopeBtn').count(), 0, 'ya no hace falta');
    assert.equal(await text('#usosEditBtn'), 'Evaluación del terreno (1 respuesta) ▾');
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.deepEqual((await lot0()).terreno, { pendiente: '7-12', pendientePct: '9.5' }, 'queda guardada');
    await tab('clima'); await page.click('#usosEditBtn');
    assert.equal(await page.inputValue('#usosSlopePct'), '9,5');
    assert.equal(await page.getAttribute('#usosAppDet', 'open'), null, 'desde «Evaluar el terreno» sigue plegado, como antes');
    assert.equal(await page.locator('#usosSlopeTip').count(), 0);
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
  });

  await step('Reporte HTML y PDF: la pendiente medida, la calculada con su margen y el nivel con que salió la clase', async () => {
    await tab('informe');
    const f = await download(() => compartir('Html'));
    assert.match(f.text, /<th>Pendiente para la clase<\/th><td>9,5 %, medida en campo \(7–12 %\); calculada: 10,4 % ± 2,4 % \(95 %\)<\/td>/);
    assert.match(f.text, /<th>Pendiente media del terreno<\/th><td>10,4 % ± 2,4 % \(95 %\) · 5,9° · baja hacia el sur<\/td>/);
    assert.match(f.text, /<th>Clase de pendiente \(IGAC\)<\/th><td>incierta: puede ser 7–12 o 12–25 %<\/td>/);
    assert.match(f.text, /Con 10 % de pendiente, sembrar con prácticas de conservación/, 'la conclusión usa la medida');
    const pdf = await download(() => compartir('Pdf'));
    assert.equal(Buffer.from(pdf.bytes.slice(0, 5)).toString('latin1'), '%PDF-');
    if (hayPdftotext) {
      const t = textoPdf(pdf, 'v2350-pendiente.pdf');
      assert.ok(t.includes('± 2,4 % (95 %)'), 'el margen con su nivel en el PDF');
      assert.ok(t.includes('medida en campo'), 'la medida en el PDF');
      assert.ok(t.includes('incierta: puede ser 7–12 o 12–25 %'), 'la clase incierta en el PDF');
    }
  });

  await step('Al 68 %: la misma pendiente sale firme (7–12 %) y entra a la clase; la app y el reporte dicen «(68 %)»; se recuerda', async () => {
    await tab('clima'); await page.click('#usosEditBtn'); await page.click('#sheet [data-act="usosClear"]'); await waitSheetClosed();
    assert.equal((await lot0()).terreno, undefined);
    await tab('herramientas');
    await page.locator('input[name="pendMargen"][value="1"]').check();
    assert.equal(await page.evaluate(() => window.Store.loadFlag('pendiente68')), true);
    assert.equal(await page.locator('input[name="pendMargen"][value="0"]').isChecked(), false, 'solo uno a la vez');
    await tab('clima');
    assert.equal(await pend(), '10,4 % ± 1,2 % (7–12 %), de 4 puntos con altitudes del GPS, margen al 68 %');
    assert.match(await text('#usosBlock .usoclase'), /^Clase 3 subclase 3p$/);
    assert.equal(await text('#usosCuenta'), 'Evaluación: 3 de 21 datos. Provisional: lo que falta puede bajar la clase.');
    assert.equal(await page.locator('#usosSlopeBtn').count(), 0);
    await tab('informe');
    assert.deepEqual(await perfil(), { 'Pendiente media del terreno': '10,4 % ± 1,2 % (68 %) · 5,9° · baja hacia el sur', 'Clase de pendiente (IGAC)': 'c · moderadamente inclinado (7–12 %)' });
    const f = await download(() => compartir('Html'));
    assert.match(f.text, /<th>Pendiente para la clase<\/th><td>10,4 % ± 1,2 % \(68 %\), calculada \(7–12 %\)<\/td>/);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await tab('herramientas');
    assert.equal(await page.locator('input[name="pendMargen"][value="1"]').isChecked(), true, 'se recuerda al volver a abrir');
    await page.locator('input[name="pendMargen"][value="0"]').check();
    assert.equal(await page.evaluate(() => window.Store.loadFlag('pendiente68')), false);
  });

  await step('Internet en un lote de menos de 270 m: no se calcula, dice por qué y ofrece poner la medida', async () => {
    await poner(esquinas('internet'));
    const motivo = 'Las altitudes son de internet, de un modelo con celdas de 90 m, y los puntos están a menos de 270 m entre sí: con ellas no sale la pendiente. Usa el GPS o mídela en campo.';
    assert.equal(await pend(), 'no se calcula: ' + motivo);
    await page.click('#usosSlopeBtn');
    assert.match(await text('#usosSlopeTip'), /^La app no pudo calcular la pendiente\. Si mediste la pendiente en campo/);
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
    await tab('informe');
    assert.deepEqual(await perfil(), { 'Pendiente media del terreno': 'no se calcula: ' + motivo });
  });

  await step('Fuentes mezcladas: la pendiente sale de la fuente con más puntos y nombra el que dejó por fuera', async () => {
    const ll = Geo.fromXY(F0, { x: 0, y: 0 });
    await poner(esquinas('gps').concat([{ id: 'm1', name: 'Casa', lat: ll.lat, lon: ll.lon, alt: 1450, altSrc: 'manual', src: 'manual', ts: Date.now() }]));
    assert.equal(await pend(), '10,4 % ± 2,4 % (incierta: 7–12 o 12–25 %), de 4 puntos con altitudes del GPS, margen al 95 % · no se usaron Casa');
    await tab('informe');
    const p = await perfil();
    assert.equal(p['Pendiente media del terreno'], '10,4 % ± 2,4 % (95 %) · 5,9° · baja hacia el sur', 'la casa, 50 m más abajo, no tuerce la pendiente');
    assert.equal(p['Altitudes usadas para la pendiente'], '4 del GPS; no se usaron Casa (escritas a mano)');
    const tips = await page.$$eval('#tab-informe .tip', (d) => d.map((x) => x.textContent));
    assert.ok(tips.some((t) => t.includes('Para la pendiente no se usaron Casa (escritas a mano), para no mezclar altitudes medidas de forma distinta.')), tips.join(' | '));
    await shot('v2350-mezcla');
  });

  await step('Versión 2.35: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

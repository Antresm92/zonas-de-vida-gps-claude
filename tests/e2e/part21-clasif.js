'use strict';
/* Recorrido 21 — versión 2.18.0: otras clasificaciones del clima (Caldas-Lang del IDEAM, De Martonne y Köppen-Geiger) y casillas
   para elegir qué secciones van en el reporte. */
module.exports = async function (c) {
  const { page, assert, step, fresh, tab, text, fill, addPointManual, download, toastText, errors, shot } = c;
  const seed = async () => {
    await fresh();
    for (const [ll, alt] of [['4.9303, -74.9540', 832], ['4.9297, -74.9500', 900], ['4.9350, -74.9520', 1056]]) await addPointManual(ll, alt);
    await tab('clima');
    await fill('[data-field="tManual"]', '23'); await page.press('[data-field="tManual"]', 'Enter');
    await fill('[data-field="pManual"]', '1544'); await page.press('[data-field="pManual"]', 'Enter');
    await tab('informe');
  };
  const chk = (k) => '#tab-informe .repchk[data-rep="' + k + '"]';
  const html = async () => (await download(() => c.compartir('Html'))).text;

  await step('Reporte: sale «Otras clasificaciones del clima» con Caldas-Lang (IDEAM) y De Martonne; Köppen pide los 12 meses', async () => {
    await seed();
    const dt = await page.$$eval('#clasifBlock dt', (d) => d.map((x) => x.textContent));
    assert.deepEqual(dt, ['Caldas-Lang (IDEAM)', 'Índice de aridez de De Martonne', 'Köppen-Geiger']);
    const dd = await page.$$eval('#clasifBlock dd b', (d) => d.map((x) => x.textContent));
    // 23 °C → templado (18 a 24 °C); 1544 ÷ 23 = 67 → ligeramente húmedo; 1544 ÷ 33 = 46,8 → húmedo
    assert.deepEqual(dd, ['Templado ligeramente húmedo (TLh)', '46,8 · Húmedo', 'Sin calcular']);
    assert.match(await text('#clasifBlock'), /Factor de Lang \(lluvia ÷ temperatura\) = 67: ligeramente húmedo\./);
    assert.match(await text('#clasifBlock'), /Necesita la temperatura y la lluvia de los 12 meses/);
    assert.match(await text('#clasifBlock'), /Holdridge separa los pisos por biotemperatura y Caldas por temperatura media/);
    // la nota de la 2.17.1: 224 m de diferencia no cambian de piso
    assert.match(await text('#tab-informe .infonote'), /todo el terreno queda en el piso Premontano de Holdridge \(17 a 24 °C\)/);
    assert.equal(await page.locator('#tab-informe .warn', { hasText: 'pisos' }).count(), 0);
    await shot('v218-clasificaciones');
  });

  await step('Casillas: cada sección plegable trae la suya a la izquierda, todas marcadas; tocarla no abre ni cierra la sección', async () => {
    const keys = await page.$$eval('#tab-informe .repchk', (b) => b.map((x) => x.getAttribute('data-rep') + ':' + x.checked));
    assert.deepEqual(keys, ['clasif:true', 'actual:true', 'fotos:true', 'perfil:true', 'sat:true', 'topo:true', 'holdridge:true', 'walter:true']);
    // a la izquierda del título, y del tamaño de un dedo con su fila
    const pos = await page.$eval(chk('perfil'), (e) => { const r = e.getBoundingClientRect(), h = e.parentElement.getBoundingClientRect(); return { left: r.left - h.left, w: r.width, hh: h.height, first: e.parentElement.firstElementChild === e }; });
    assert.ok(pos.first && pos.left < 30, JSON.stringify(pos)); assert.ok(pos.w >= 24 && pos.hh >= 44, JSON.stringify(pos));
    const folded = () => page.$eval(chk('perfil'), (e) => e.closest('.block').classList.contains('folded'));
    const antes = await folded();
    await page.click(chk('perfil'));
    assert.equal(await folded(), antes, 'la casilla no pliega ni despliega');
    assert.equal(await toastText(), 'Esta sección no irá en el reporte que compartas.');
    assert.equal(await page.isChecked(chk('perfil')), false);
    await page.click(chk('perfil'));
    assert.equal(await toastText(), 'Esta sección irá en el reporte.');
    // el título sigue abriendo la sección
    // con las secciones plegadas (lo normal en el teléfono), el título sigue abriendo la sección y la casilla queda a la izquierda de la fila
    await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('zvg.v1.flags')); f.reportOpen = false; localStorage.setItem('zvg.v1.flags', JSON.stringify(f)); });
    await page.reload(); await page.waitForSelector('#tab-puntos'); await tab('informe');
    assert.equal(await folded(), true);
    await page.click(chk('sat'));
    assert.equal(await page.$eval(chk('sat'), (e) => e.closest('.block').classList.contains('folded')), true, 'plegada: la casilla tampoco la abre');
    await page.click(chk('sat'));
    await page.click('#tab-informe h2[data-fold="Perfil del relieve"]');
    assert.equal(await folded(), false);
    const fila = await page.$eval(chk('holdridge'), (e) => { const r = e.getBoundingClientRect(), h = e.parentElement.getBoundingClientRect(); return { left: r.left - h.left, hh: h.height }; });
    assert.ok(fila.left < 30 && fila.hh >= 44, JSON.stringify(fila));
    assert.match(await text('#repHelp'), /deciden qué va en el reporte/);
    await shot('v218-casillas');
    await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('zvg.v1.flags')); f.reportOpen = true; localStorage.setItem('zvg.v1.flags', JSON.stringify(f)); });
    await page.reload(); await page.waitForSelector('#tab-puntos'); await tab('informe');
  });

  await step('Reporte compartido: con todo marcado van todas las secciones; al desmarcar, esas no salen (HTML, PDF y resumen) y la elección se recuerda', async () => {
    const todo = await html();
    for (const t of ['Otras clasificaciones del clima', 'Perfil del relieve', 'Croquis satelital', 'Croquis topográfico', 'Diagrama de Holdridge', 'Datos del clima', 'Terreno', 'Puntos', 'Croquis'])
      assert.ok(todo.includes('>' + t + '</h2>'), 'falta ' + t);
    assert.match(todo, /<th>Caldas-Lang \(IDEAM\)<\/th><td><b>Templado ligeramente húmedo \(TLh\)<\/b>/);
    for (const k of ['clasif', 'perfil', 'sat', 'topo', 'holdridge']) await page.click(chk(k));
    const menos = await html();
    for (const t of ['Otras clasificaciones del clima', 'Perfil del relieve', 'Croquis satelital', 'Croquis topográfico', 'Diagrama de Holdridge'])
      assert.ok(!menos.includes('>' + t + '</h2>'), 'sobra ' + t);
    for (const t of ['Datos del clima', 'Terreno', 'Puntos', 'Croquis', 'Calidad de los datos']) assert.ok(menos.includes('>' + t + '</h2>'), 'lo esencial va siempre: ' + t);
    assert.doesNotMatch(menos, /Caldas-Lang/);
    const pdf = await download(() => c.compartir('Pdf'));
    assert.ok(pdf.bytes.length < 400000 && Buffer.from(pdf.bytes).toString('latin1').slice(0, 5) === '%PDF-');
    // se recuerda al volver a abrir la app
    await page.reload(); await page.waitForSelector('#tab-puntos'); await tab('informe');
    assert.deepEqual(await page.$$eval('#tab-informe .repchk', (b) => b.filter((x) => !x.checked).map((x) => x.getAttribute('data-rep'))), ['clasif', 'perfil', 'sat', 'topo', 'holdridge']);
    for (const k of ['clasif', 'perfil', 'sat', 'topo', 'holdridge']) await page.click(chk(k));
    assert.equal(await page.$$eval('#tab-informe .repchk', (b) => b.every((x) => x.checked)), true);
  });

  await step('Köppen-Geiger: con los 12 meses de temperatura y lluvia da su clase', async () => {
    await page.evaluate(() => {
      const p = window.__app.S.projects[0];
      p.climate = { monthlyManual: { T: [23, 23.2, 23.4, 23.1, 23, 22.8, 22.9, 23.1, 23, 22.7, 22.6, 22.8], P: [60, 80, 130, 210, 190, 90, 60, 70, 130, 230, 200, 94] } };
      window.__app.showTab('informe');
    });
    const dd = await page.$$eval('#clasifBlock dd b', (d) => d.map((x) => x.textContent));
    assert.equal(dd[2], 'Af · Tropical de selva (lluvioso todo el año)');
    assert.match(await text('#clasifBlock'), /Mes más frío 22,6 °C, mes más caliente 23,4 °C, mes más seco 60 mm\./);
    const h = await html();
    assert.match(h, /<th>Köppen-Geiger<\/th><td><b>Af · Tropical de selva/);
  });

  await step('Clasificaciones y casillas: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

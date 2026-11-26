'use strict';
/* Recorrido 38 — versión 2.34.2: promedio ponderado del GPS y precisión honesta.
   Con el GPS de mentira se mandan las mismas lecturas dos veces: con el método nuevo (cada lectura pesa 1/precisión² y se guarda
   la precisión promedio) y con el anterior, que queda como opción en Preferencias (todas pesan igual y se guarda la de la mejor).
   Se revisa lo que se ve mientras mide, lo que se guarda, la lista, la ficha, el reporte y que moverlo a mano lo vuelva «a mano». */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, proj, waitToast, waitSheetClosed, gpsPush, download, compartir, shot } = c;
  const mLon = 111320 * Math.cos(4.6 * Math.PI / 180);
  const este = (m) => -74.08 + m / mLon;
  const metros = (lon) => (lon + 74.08) * mLon;
  // Cuatro lecturas (la cuarta cumple la parada temprana: ±5 m o mejor con 4 lecturas): a 0, 2, 4 y 2 m al este
  const LECT = [[0, 3], [2, 4], [4, 4.5], [2, 4]].map(([m, acc]) => ({ lat: 4.6, lon: este(m), alt: 2600 + m, acc }));
  const w = LECT.map((l) => 1 / (l.acc * l.acc)), sw = w.reduce((s, x) => s + x, 0);
  const ESPERADO = { m: LECT.reduce((s, l, i) => s + w[i] * metros(l.lon), 0) / sw, acc: LECT.reduce((s, l) => s + l.acc, 0) / 4 };

  const marcar = async (vivo) => {
    await gpsPush(LECT[0]);
    await act('mark');
    await gpsPush(LECT[0]); await gpsPush(LECT[1]); await gpsPush(LECT[2]);
    await page.waitForFunction(() => /3 lecturas/.test((document.querySelector('#progTxt') || {}).textContent || ''));
    if (vivo) vivo(await text('#progTxt'));
    await gpsPush(LECT[3]);
    await waitToast(/guardado/);
    const p = await proj();
    return p.points[p.points.length - 1];
  };

  await step('Promedio ponderado: en vivo muestra la precisión promedio y cuánto se mueven las lecturas; guarda lo ponderado', async () => {
    await fresh();
    await act('gpsOn');
    let vivo = '';
    const pt = await marcar((t) => { vivo = t; });
    assert.match(vivo, /^Promediando: 3 lecturas · precisión promedio ±4 m · se mueven ±\d+,\d m$/, vivo);
    assert.equal(pt.src, 'gps'); assert.equal(pt.gpsN, 4); assert.equal(pt.gpsMet, 'ponderado');
    assert.ok(Math.abs(metros(pt.lon) - ESPERADO.m) < 0.01, 'posición ponderada: ' + metros(pt.lon).toFixed(3) + ' m (esperado ' + ESPERADO.m.toFixed(3) + ')');
    assert.ok(Math.abs(pt.acc - ESPERADO.acc) < 1e-9, 'precisión promedio (3, 4, 4,5 y 4): ' + pt.acc);
    assert.equal(pt.alt, 2602, 'altitud: la mediana, como antes');
    assert.match(await c.toastText(), /guardado \(±4 m, promedio ponderado de 4 lecturas\)/);
    // lista y ficha
    const fila = await page.locator('#tab-puntos .row.pt').last().textContent();
    assert.match(fila, /precisión ±4 m · 4 lecturas/);
    await page.locator('[data-act="editPoint"]').last().click();
    assert.match(await text('#sheet'), /Lecturas del GPS\s*4, promedio ponderado \(± promedio de las lecturas\)/);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await shot('v2342-promedio');
  });

  await step('Método anterior (opción en Preferencias): mismas lecturas, todas pesan igual y guarda la precisión de la mejor', async () => {
    await tab('herramientas');
    assert.match(await text('#tab-herramientas'), /Marcar con el método anterior\s*Promedio simple: todas las lecturas pesan igual y el punto guarda la precisión de la mejor, que es más optimista que la real\. Viene apagado/);
    const chk = page.locator('input[data-flag="gpsSimple"]');
    assert.equal(await chk.isChecked(), false, 'viene apagado');
    await chk.check();
    await tab('puntos');
    let vivo = '';
    const pt = await marcar((t) => { vivo = t; });
    assert.match(vivo, /^Promediando \(método anterior\): 3 lecturas · mejor precisión ±3 m · se mueven ±\d+,\d m$/, vivo);
    assert.equal(pt.gpsN, 4); assert.equal(pt.gpsMet, 'simple');
    assert.ok(Math.abs(metros(pt.lon) - 2) < 0.01, 'promedio simple: 2 m');
    assert.equal(pt.acc, 3, 'la de la mejor lectura');
    assert.match(await page.locator('#tab-puntos .row.pt').last().textContent(), /precisión ±3 m \(la mejor de 4 lecturas\)/);
    await tab('herramientas');
    await page.locator('input[data-flag="gpsSimple"]').uncheck();
    await tab('puntos');
  });

  await step('El reporte dice el método de cada punto; moverlo a mano lo vuelve «a mano» y ya no habla de lecturas', async () => {
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots[0]; l.climate.pManual = 1300; window.Store.saveState(window.__app.S); });
    await tab('informe');
    const h = await download(() => compartir('Html'));
    assert.ok(h.text.includes('GPS ±4 m · promedio ponderado de 4 lecturas'), 'punto con el método nuevo');
    assert.ok(h.text.includes('GPS ±3 m · promedio simple de 4 lecturas (± de la mejor)'), 'punto con el método anterior');
    await tab('puntos');
    // mover el último a mano desde su ficha: deja de ser una medición del GPS
    const antes = (await proj()).points.slice(-1)[0];
    await page.locator('[data-act="editPoint"]').last().click();
    await fill('#fCoord', '4.6003, -74.0797');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    const movido = (await proj()).points.slice(-1)[0];
    assert.equal(movido.src, 'manual'); assert.equal(movido.acc, null);
    assert.equal(movido.gpsN, undefined); assert.equal(movido.gpsMet, undefined);
    assert.equal(antes.gpsMet, 'simple');
  });
};

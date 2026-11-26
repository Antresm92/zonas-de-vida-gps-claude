'use strict';
/* Recorrido 41 — versión 2.35.1: la altitud del GPS, al nivel del mar.
   El GPS da la altura sobre el elipsoide WGS84; la app le resta la altura del geoide EGM2008 del lugar (geoide.js). En Bogotá
   (4,711; −74,072) el geoide está 22,41 m sobre el elipsoide: 2672,41 m del GPS son 2650 m sobre el nivel del mar. En
   Barranquilla está 7,67 m por debajo (se suma) y fuera de Colombia no se corrige. Se revisan el punto marcado y su ficha, la
   lectura en vivo, Herramientas › GPS, «usar la altitud del GPS» en un punto escrito a mano, un proyecto de antes que se
   corrige una sola vez al abrir la app, y el resumen del reporte. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, gpsPush, waitToast, waitSheetClosed, sheetTitle, download, compartir, state, shot, errors } = c;
  const lot0 = async () => (await state()).projects[0].lots[0];
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' ' + a + ' ≠ ' + b);
  // Marca un punto con el GPS quieto en ese lugar (cuatro lecturas iguales cumplen la parada temprana)
  const marcar = async (lat, lon, alt) => {
    const r = { lat, lon, alt, acc: 3, altAcc: 8 };
    await gpsPush(r);
    await act('mark');
    await gpsPush(r, 4);
    await waitToast(/guardado \(±3 m/);
    const pts = (await lot0()).points;
    return pts[pts.length - 1];
  };
  const ficha = async (id) => {
    await page.click('#tab-puntos [data-act="editPoint"][data-id="' + id + '"]');
    const kv = await page.$$eval('#sheet dl.kv div', (d) => d.map((x) => [x.querySelector('dt').textContent, x.querySelector('dd').textContent]));
    const hint = await text('#fAltHint');
    return { kv: Object.fromEntries(kv), hint };
  };
  const cerrar = async () => { await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed(); };

  await step('Bogotá: la altura del GPS se guarda sobre el nivel del mar (− 22,41 m del geoide) y la ficha dice cuánto se restó', async () => {
    await fresh();
    await tab('puntos'); await act('gpsOn');
    const pt = await marcar(4.711, -74.072, 2672.41);
    assert.equal(pt.altSrc, 'gps'); assert.equal(pt.altRef, 'egm2008'); assert.equal(pt.altN, 22.41);
    near(pt.alt, 2650, 'altitud'); near(pt.altGps, 2650, 'la del GPS que se restaura');
    assert.equal((await text('#rAlt')).trim(), '2650 m', 'la lectura en vivo también');
    const f = await ficha(pt.id);
    assert.equal(f.kv['Altitud del GPS'], '2650 m (±8 m)');
    assert.equal(f.kv['Paso al nivel del mar'], 'se restaron 22,4 m (geoide EGM2008)');
    assert.equal(f.hint, 'Altitud tomada del GPS (±8 m), sobre el nivel del mar. Puedes corregirla escribiendo otro valor.');
    await shot('v2351-ficha');
    await cerrar();
  });

  await step('Donde el geoide está bajo el elipsoide se suma (Barranquilla); fuera de Colombia no se corrige y la ficha lo dice', async () => {
    await fresh();
    await tab('puntos'); await act('gpsOn');
    let pt = await marcar(10.964, -74.796, 10);
    assert.equal(pt.altN, -7.67); near(pt.alt, 17.67, 'Barranquilla');
    let f = await ficha(pt.id);
    assert.equal(f.kv['Paso al nivel del mar'], 'se sumaron 7,7 m (geoide EGM2008)');
    await cerrar();
    await fresh();
    await tab('puntos'); await act('gpsOn');
    pt = await marcar(40.4168, -3.7038, 667);
    assert.equal(pt.altRef, 'elipsoide'); assert.equal(pt.altN, undefined); assert.equal(pt.alt, 667, 'Madrid: sin corregir');
    f = await ficha(pt.id);
    assert.equal(f.kv['Paso al nivel del mar'], 'no se hizo: el punto está fuera de la zona del geoide (Colombia); la altitud es sobre el elipsoide');
    assert.equal(f.hint, 'Altitud tomada del GPS (±8 m), sobre el elipsoide (fuera de la zona del geoide). Puedes corregirla escribiendo otro valor.');
    await cerrar();
  });

  await step('Herramientas › GPS y «usar la altitud del GPS» en un punto escrito a mano: la altitud ya sobre el nivel del mar', async () => {
    await fresh();
    await tab('puntos'); await act('gpsOn');
    await gpsPush({ lat: 4.711, lon: -74.072, alt: 2672.41, acc: 4, altAcc: 8 });
    await tab('herramientas'); await act('toolGps');
    await page.waitForSelector('#toolBody .readout');
    assert.equal((await text('#tgAlt')).trim(), '2650 m');
    assert.match(await text('#toolBody'), /La altitud ya está pasada al nivel del mar \(geoide EGM2008\)/);
    await act('closeSheet'); await waitSheetClosed();
    await tab('puntos'); await act('addCoords');
    assert.equal(await text('#sheet [data-act="altFromGps"]'), 'Estoy en este punto: usar la altitud del GPS (2650 m)');
    await act('altFromGps');
    assert.equal(await page.inputValue('#fAlt'), '2650');
    assert.equal(await text('#fAltHint'), 'Altitud del GPS, sobre el nivel del mar. Solo úsala si estás parado en este punto.');
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Un proyecto de antes: al abrir la app, la altura del GPS pasa al nivel del mar una sola vez; las demás no se tocan', async () => {
    await fresh();
    await page.evaluate(() => {
      const l = window.__app.S.projects[0].lots[0];
      l.points.push({ id: 'g1', name: 'Mojón', lat: 4.711, lon: -74.072, alt: 2672.41, altGps: 2672.41, altSrc: 'gps', acc: 3, altAcc: 8, src: 'gps', ts: Date.now() });
      l.points.push({ id: 'm1', name: 'Escrito', lat: 4.7115, lon: -74.0715, alt: 2655, altGps: 2680.41, altSrc: 'manual', acc: 3, altAcc: 8, src: 'gps', ts: Date.now() });
      l.points.push({ id: 'i1', name: 'Internet', lat: 4.712, lon: -74.072, alt: 2651, altSrc: 'internet', src: 'manual', ts: Date.now() });
      l.climate.tManual = 14; l.climate.pManual = 1000;
      window.Store.saveState(window.__app.S);           // así guardaba la app los puntos hasta la 2.35.0
    });
    await page.reload(); await page.waitForFunction(() => !!window.__app);
    let p = (await lot0()).points;
    const by = (id) => p.find((x) => x.id === id);
    near(by('g1').alt, 2650, 'GPS'); near(by('g1').altGps, 2650); assert.equal(by('g1').altRef, 'egm2008'); assert.equal(by('g1').altN, 22.41);
    assert.equal(by('m1').alt, 2655, 'la escrita a mano se queda'); near(by('m1').altGps, 2680.41 - Number(by('m1').altN), 'la del GPS guardada sí pasa');
    assert.equal(by('i1').alt, 2651); assert.equal(by('i1').altRef, undefined, 'la de internet no se toca');
    await page.reload(); await page.waitForFunction(() => !!window.__app);
    p = (await lot0()).points;
    near(by('g1').alt, 2650, 'una segunda vez no resta otra vez');
    await tab('puntos');
    const f = await ficha('m1');
    assert.equal(await page.locator('#sheet [data-act="restoreGps"]').textContent(), 'Restaurar altitud del GPS (2658 m)');
    assert.equal(f.kv['Paso al nivel del mar'], 'se restaron 22,4 m (geoide EGM2008)');
    await cerrar();
  });

  await step('El reporte dice cómo pasaron al nivel del mar las altitudes del GPS', async () => {
    await tab('informe');
    const h = await download(() => compartir('Html'));
    assert.match(h.text, /<tr><th>Origen de los puntos<\/th><td>2 con GPS \(±3 m\) y 1 a mano\. Altitud: 1 del GPS \(±8 m; al nivel del mar con el geoide EGM2008: −22,4 m\), 1 a mano y 1 de internet\.<\/td><\/tr>/);
    await shot('v2351-reporte');
  });

  await step('Versión 2.35.1: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

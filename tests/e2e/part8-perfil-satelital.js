'use strict';
/* Recorrido 8 — Informe: perfil del relieve (sin internet) y croquis satelital (se baja una vez y queda dentro del informe).
 * Los mosaicos de Esri son de mentira (harness.mockTiles): se comprueba qué pide la app y qué guarda, no el aspecto de las imágenes reales. */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, toastText, waitToast, addPointManual, download, errors, shot, tiles } = c;
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const ESRI = /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/;
  const block = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
  const satReady = () => page.waitForSelector('#satBlock svg image', { state: 'attached', timeout: 8000 });
  const satWarn = async () => { await page.waitForSelector('#satBlock .warn', { timeout: 8000 }); return text('#satBlock .warn'); };
  const flat = (s) => String(s).replace(/\s+/g, ' ');
  const openReport = async (html, name) => {
    const p2 = await context.newPage();
    const errs = [], reqs = [];
    p2.on('pageerror', (e) => errs.push(e.message));
    p2.on('request', (r) => { if (!/^(data|about|blob):/.test(r.url())) reqs.push(r.url()); });
    await p2.setViewportSize({ width: 800, height: 1100 });
    await p2.setContent(html);
    if (name) await p2.screenshot({ path: c.shots + '/' + name + '.png', fullPage: true });
    await p2.close();
    assert.deepEqual(errs, []);
    assert.deepEqual(reqs, [], 'el informe no pide nada a internet al abrirse');
  };
  const iPos = (h, s) => h.indexOf(s);

  await step('Informe: el perfil del relieve y el croquis satelital aparecen con ≥ 2 puntos; con 1 solo no', async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await tab('clima'); await field('pManual', '1200');
    await tab('informe');
    assert.doesNotMatch(await text('#tab-informe'), /Perfil del relieve|Croquis satelital/);
    assert.equal(await page.locator('#satBlock').count(), 0);
    await tab('puntos');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    tiles.reset();                                                           // lo pedido antes (por otros recorridos) no cuenta
    await tab('informe');
    const t = await text('#tab-informe');
    assert.match(t, /Perfil del relieve/); assert.match(t, /Croquis satelital/);
    assert.equal(await page.locator('#tab-informe .block svg[aria-label^="Perfil del relieve"]').count(), 1);
    assert.match(await text('#tab-informe'), /Punto más alto\s*Arriba · 3500 m/);
    assert.match(await text('#tab-informe'), /Punto más bajo\s*Abajo · 1300 m/);
    assert.match(await text('#tab-informe'), /Desnivel entre ambos\s*2200 m/);
    assert.match(await text('#tab-informe'), /no consulta internet/);
    // las cotas de la gráfica llevan el nombre y la altitud
    const cotas = await page.$$eval('svg[aria-label^="Perfil del relieve"] text', (els) => els.map((e) => e.textContent));
    for (const k of ['Abajo · 1300 m', 'Medio · 2640 m', 'Arriba · 3500 m', 'Altitud (m)', 'Distancia acumulada del recorrido']) assert.ok(cotas.includes(k), 'falta «' + k + '» en ' + JSON.stringify(cotas));
    // orden: Datos usados → perfil → croquis satelital → diagrama de Holdridge
    const o = await page.$$eval('#tab-informe .block h2', (els) => els.map((e) => e.textContent));
    assert.ok(o.indexOf('Perfil del relieve') > o.indexOf('Datos usados') && o.indexOf('Croquis satelital') > o.indexOf('Perfil del relieve') && o.indexOf('Diagrama de Holdridge') > o.indexOf('Croquis satelital'), JSON.stringify(o));
    assert.equal(await text('[data-act="satPrepare"]'), 'Preparar croquis satelital');
    assert.equal(tiles.count(ESRI), 0, 'no se baja nada hasta que se pide');
    await shot('80-informe-perfil');
  });

  await step('Perfil: avisos cuando falta una altitud, y explicación cuando no alcanzan las altitudes', async () => {
    await tab('puntos');
    await addPointManual('4.6100, -74.0800');                                // sin altitud
    await tab('informe');
    assert.match(await text('#tab-informe'), /1 punto sin altitud no aparece en el perfil/);
    assert.equal(await page.locator('svg[aria-label^="Perfil del relieve"] circle').count(), 3, 'solo se dibujan los 3 puntos con altitud');
    // dos puntos sin altitud propia: la altitud la da el usuario en Clima y el perfil dice qué le falta
    await fresh();
    await addPointManual('4.6000, -74.0800'); await addPointManual('4.6000, -74.0700');
    await tab('clima'); await field('pManual', '1200'); await field('altOverride', '2640');
    await tab('informe');
    assert.match(await text('#tab-informe'), /Se necesitan al menos 2 puntos con altitud/);
    assert.equal(await page.locator('svg[aria-label^="Perfil del relieve"]').count(), 0);
  });

  await step('Croquis satelital: se baja una vez, queda dentro del informe y muestra su atribución', async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await tab('clima'); await field('pManual', '1200');
    await tab('informe');
    tiles.reset();
    await act('satPrepare');
    await satReady();
    const pedidos = tiles.urls.filter((u) => ESRI.test(u));
    assert.ok(pedidos.length >= 6 && pedidos.length <= 12, 'mosaicos pedidos: ' + pedidos.length);
    assert.equal(new Set(pedidos).size, pedidos.length, 'no repite mosaicos');
    assert.equal(new Set(pedidos.map((u) => ESRI.exec(u)[1])).size, 1, 'todos del mismo nivel de zoom');
    assert.equal(tiles.count(/openstreetmap|opentopomap/), 0, 'solo Esri');
    const img = await page.$eval('#satBlock svg image', (e) => e.getAttribute('href'));
    assert.match(img, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{200,}$/, 'la imagen queda guardada dentro, no enlazada');
    const g = await page.evaluate(() => { const s = document.querySelector('#satBlock svg'), r = s.getBoundingClientRect(); return { vb: s.getAttribute('viewBox'), w: r.width, h: r.height, vw: document.documentElement.clientWidth, left: r.left, right: r.right }; });
    assert.equal(g.vb, '0 0 768 512');
    assert.ok(g.left >= 0 && g.right <= g.vw + 0.5, 'cabe en el ancho de la pantalla: ' + JSON.stringify(g));
    assert.ok(Math.abs(g.h / g.w - 512 / 768) < 0.01, 'conserva la proporción');
    const labels = await page.$$eval('#satBlock svg text', (els) => els.map((e) => e.textContent));
    for (const k of ['Abajo', 'Medio', 'Arriba', 'N', '© Esri, Maxar, Earthstar Geographics']) assert.ok(labels.includes(k), 'falta «' + k + '»: ' + JSON.stringify(labels));
    assert.ok(labels.some((l) => /^\d+ m$|^\d,\d+ km$/.test(l)), 'lados con su distancia');
    assert.match(flat(await block('#satBlock')), /Imagen satelital de Esri \(fuentes: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios GIS\)/);
    assert.match(flat(await block('#satBlock')), /uso personal o interno/);
    assert.equal(await text('[data-act="satPrepare"]'), 'Volver a preparar');
    assert.match(await toastText(), /Croquis satelital listo/);
    await shot('81-informe-satelital');
  });

  await step('Compartir con el croquis ya preparado: no vuelve a bajar nada y el informe trae croquis, satelital y perfil en ese orden', async () => {
    tiles.reset();
    const f = await download(() => page.click('[data-act="share"]'));
    assert.equal(tiles.urls.length, 0, 'usa la imagen ya guardada');
    const h = f.text;
    const iCroquis = iPos(h, 'aria-label="Plano del polígono"'), iSat = iPos(h, '<h2>Croquis satelital</h2>'), iPerfil = iPos(h, '<h2>Perfil del relieve</h2>');
    assert.ok(iCroquis > 0 && iSat > iCroquis && iPerfil > iSat, 'orden: croquis, satelital, perfil');
    assert.match(h, /<image href="data:image\/jpeg;base64,/);
    assert.match(h, /Imagen satelital de Esri/);
    assert.match(h, /Perfil del relieve: altitud de los puntos contra la distancia acumulada/);
    assert.ok(!/<script/i.test(h));
    await openReport(h, '82-informe-html-satelital-perfil');
  });

  await step('Si cambia un punto, el croquis preparado deja de servir; al compartir se prepara solo, y dos toques seguidos a «Compartir» generan un solo informe', async () => {
    await tab('puntos');
    await page.locator('[data-act="editPoint"]').first().click();
    await fill('#fName', 'Mojón');
    await page.click('[data-act="saveEdit"]'); await c.waitSheetClosed();
    await tab('informe');
    assert.equal(await page.locator('#satBlock svg image').count(), 0, 'el croquis viejo ya no se muestra');
    assert.equal(await text('[data-act="satPrepare"]'), 'Preparar croquis satelital');
    tiles.reset();
    let descargas = 0;
    const count = () => { descargas++; };
    page.on('download', count);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { const b = document.querySelector('[data-act="share"]'); b.click(); b.click(); })]);
    assert.match(await toastText(), /Preparando el croquis satelital|Informe descargado/);
    const html = require('fs').readFileSync(await dl.path(), 'utf8');
    await page.waitForTimeout(400);
    page.off('download', count);
    assert.equal(descargas, 1, 'un solo informe');
    assert.ok(tiles.count(ESRI) >= 6, 'se bajó la imagen nueva');
    assert.match(html, />Mojón</, 'la imagen nueva ya lleva el nombre cambiado');
    assert.match(html, /<image href="data:image\/jpeg;base64,/);
    assert.equal(await page.locator('#satBlock svg image').count(), 1, 'y queda lista en la pestaña');
  });

  await step('Si el servicio de imágenes falla: el bloque lo explica y el informe se comparte igual, sin el croquis; al recuperarse se quita el aviso', async () => {
    // Otro lugar: el navegador guarda en memoria las imágenes ya bajadas con el mismo enlace y no volvería a pedirlas
    await fresh();
    await addPointManual('6.2000, -75.5800', 1500, 'Abajo');
    await addPointManual('6.2000, -75.5700', 1700, 'Medio');
    await addPointManual('6.2090, -75.5750', 1900, 'Arriba');
    await tab('clima'); await field('pManual', '1800');
    await tab('informe');
    tiles.fail(true);
    await act('satPrepare');
    const w = flat(await satWarn());
    assert.match(w, /No se pudo preparar el croquis satelital: no se pudieron descargar las imágenes: revisa la conexión a internet/);
    assert.match(w, /no permitir guardarlas/);
    assert.match(await toastText(), /No se pudo preparar el croquis satelital/);
    assert.equal(await page.locator('#satBlock svg image').count(), 0, 'no deja una imagen a medias');
    const f = await download(() => page.click('[data-act="share"]'));
    assert.match(f.text, /<h2>Croquis satelital<\/h2><div class="note">No se pudo preparar el croquis satelital: no se pudieron descargar las imágenes/);
    assert.match(f.text, /<h2>Perfil del relieve<\/h2>/);
    assert.doesNotMatch(f.text, /<image href/);
    await openReport(f.text, '83-informe-sin-satelital');
    tiles.fail(false);
    await act('satPrepare');
    await satReady();
    assert.equal(await page.locator('#satBlock .warn').count(), 0, 'al recuperarse se quita el aviso');
    errors.length = 0;                                                        // los mosaicos que fallaron a propósito dejan avisos en la consola
  });

  await step('Sin internet: no intenta descargar, lo dice, y el informe sale con el perfil y la razón', async () => {
    await act('satPrepare');                                                  // deja preparado un croquis para comprobar que «sin internet» no lo borra
    await satReady();
    await tab('puntos');
    await page.locator('[data-act="editPoint"]').first().click();
    await fill('#fName', 'Mojón 2');
    await page.click('[data-act="saveEdit"]'); await c.waitSheetClosed();
    await tab('informe');
    await context.setOffline(true);
    try {
      tiles.reset();
      await act('satPrepare');
      assert.match(flat(await satWarn()), /No se pudo preparar el croquis satelital: no hay conexión a internet en este momento/);
      const f = await download(() => page.click('[data-act="share"]'));
      assert.equal(tiles.urls.length, 0, 'sin internet no pide nada');
      assert.match(f.text, /<div class="note">No se pudo preparar el croquis satelital: no hay conexión a internet en este momento<\/div>/);
      assert.match(f.text, /<h2>Perfil del relieve<\/h2>/);
      assert.match(f.text, /Plano del polígono/);
    } finally { await context.setOffline(false); }
    await act('satPrepare');
    await satReady();
  });

  await step('Perfil con altitudes del GPS poco distintas: avisa que podría ser ruido del GPS', async () => {
    await fresh();
    await act('gpsOn');
    const marcar = async (lat, lon, alt) => {
      await c.gpsPush({ lat, lon, alt, acc: 3 });
      await act('mark');
      await c.gpsPush({ lat: lat + 0.000001, lon, alt, acc: 3 }, 5);
      await waitToast(/guardado \(±3 m/, 14000);
    };
    await marcar(4.6000, -74.0800, 2639);
    await marcar(4.6000, -74.0790, 2644);
    await marcar(4.6009, -74.0795, 2641);
    await act('gpsOff');
    await tab('clima'); await field('pManual', '1200');
    await tab('informe');
    const t = flat(await text('#tab-informe'));
    assert.match(t, /3 altitudes fueron tomadas con el GPS del teléfono, que suele tener un error de varios metros/);
    assert.match(t, /es del orden de ese error: el perfil podría mostrar ruido del GPS y no el relieve real/);
    const f = await download(() => page.click('[data-act="share"]'));
    assert.match(f.text, /podría mostrar ruido del GPS/);
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

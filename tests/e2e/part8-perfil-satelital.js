'use strict';
/* Recorrido 8 — Informe: perfil del relieve (sin internet) y croquis satelital y topográfico (se bajan una vez y quedan dentro del informe).
 * Los mosaicos de Esri y de OpenTopoMap son de mentira (harness.mockTiles): se comprueba qué pide la app y qué guarda, no el aspecto de las imágenes reales. */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, toastText, waitToast, addPointManual, download, errors, shot, tiles } = c;
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const ESRI = /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/;
  const block = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
  const TOPO = /^https:\/\/tile\.opentopomap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/;
  const satReady = () => page.waitForSelector('#satBlock svg image', { state: 'attached', timeout: 8000 });
  const satWarn = async () => { await page.waitForSelector('#satBlock .warn', { timeout: 8000 }); return text('#satBlock .warn'); };
  const topoReady = () => page.waitForSelector('#topoBlock svg image', { state: 'attached', timeout: 8000 });
  const topoWarn = async () => { await page.waitForSelector('#topoBlock .warn', { timeout: 8000 }); return text('#topoBlock .warn'); };
  // Los avisos duran poco y el siguiente tapa al anterior: se anotan todos los que aparecen para poder comprobar el de «Preparando…»
  const watchToasts = () => page.evaluate(() => {
    window.__toasts = [];
    const el = document.querySelector('#toast');
    new MutationObserver(() => { if (!el.hidden && el.textContent) window.__toasts.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  const seenToasts = () => page.evaluate(() => window.__toasts.slice());
  const nImages = (h) => (h.match(/<image href="data:image\/jpeg;base64,/g) || []).length;
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
    assert.doesNotMatch(await text('#tab-informe'), /Perfil del relieve|Croquis satelital|Croquis topográfico/);
    assert.equal(await page.locator('#satBlock').count(), 0);
    assert.equal(await page.locator('#topoBlock').count(), 0);
    await tab('puntos');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    tiles.reset();                                                           // lo pedido antes (por otros recorridos) no cuenta
    await tab('informe');
    const t = await text('#tab-informe');
    assert.match(t, /Perfil del relieve/); assert.match(t, /Croquis satelital/); assert.match(t, /Croquis topográfico/);
    assert.equal(await page.locator('#tab-informe .block svg[aria-label^="Perfil del relieve"]').count(), 1);
    assert.match(await text('#tab-informe'), /Punto más alto\s*Arriba · 3500 m/);
    assert.match(await text('#tab-informe'), /Punto más bajo\s*Abajo · 1300 m/);
    assert.match(await text('#tab-informe'), /Desnivel entre ambos\s*2200 m/);
    assert.match(await text('#tab-informe'), /no consulta internet/);
    // las cotas de la gráfica llevan el nombre y la altitud
    const cotas = await page.$$eval('svg[aria-label^="Perfil del relieve"] text', (els) => els.map((e) => e.textContent));
    for (const k of ['Abajo · 1300 m', 'Medio · 2640 m', 'Arriba · 3500 m', 'Altitud (m)', 'Distancia acumulada del recorrido']) assert.ok(cotas.includes(k), 'falta «' + k + '» en ' + JSON.stringify(cotas));
    // orden: Datos usados → perfil → croquis satelital → croquis topográfico (debajo del satelital) → diagrama de Holdridge
    const o = await page.$$eval('#tab-informe .block h2', (els) => els.map((e) => e.textContent));
    assert.ok(o.indexOf('Perfil del relieve') > o.indexOf('Datos usados') && o.indexOf('Croquis satelital') > o.indexOf('Perfil del relieve') && o.indexOf('Croquis topográfico') > o.indexOf('Croquis satelital') && o.indexOf('Diagrama de Holdridge') > o.indexOf('Croquis topográfico'), JSON.stringify(o));
    assert.equal(await text('[data-act="satPrepare"]'), 'Preparar croquis satelital');
    assert.equal(await text('[data-act="topoPrepare"]'), 'Preparar croquis topográfico');
    const g = await page.evaluate(() => { const a = document.querySelector('#satBlock').getBoundingClientRect(), b = document.querySelector('#topoBlock').getBoundingClientRect(); return { satBottom: a.bottom, topoTop: b.top }; });
    assert.ok(g.topoTop >= g.satBottom - 1, 'el bloque topográfico queda debajo del satelital');
    assert.match(flat(await block('#topoBlock')), /OpenTopoMap con datos de OpenStreetMap y SRTM, licencia CC-BY-SA/);
    assert.equal(tiles.count(ESRI), 0, 'no se baja nada hasta que se pide');
    assert.equal(tiles.count(TOPO), 0, 'ni del topográfico');
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

  await step('Croquis topográfico: se baja de OpenTopoMap una vez (sin pasar del nivel 17), queda dentro del informe y muestra su atribución', async () => {
    tiles.reset();
    await act('topoPrepare');
    await topoReady();
    const pedidos = tiles.urls.filter((u) => TOPO.test(u));
    assert.ok(pedidos.length >= 4 && pedidos.length <= 12, 'mosaicos pedidos: ' + pedidos.length);
    assert.equal(new Set(pedidos).size, pedidos.length, 'no repite mosaicos');
    const niveles = new Set(pedidos.map((u) => Number(TOPO.exec(u)[1])));
    assert.equal(niveles.size, 1, 'todos del mismo nivel de zoom');
    assert.ok([...niveles][0] <= 17, 'OpenTopoMap no tiene mosaicos de más del nivel 17: ' + [...niveles]);
    assert.equal(tiles.count(ESRI), 0, 'no toca Esri'); assert.equal(tiles.count(/openstreetmap\.org/), 0, 'ni OpenStreetMap');
    const img = await page.$eval('#topoBlock svg image', (e) => e.getAttribute('href'));
    assert.match(img, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{200,}$/, 'la imagen queda guardada dentro, no enlazada');
    const g = await page.evaluate(() => { const s = document.querySelector('#topoBlock svg'), r = s.getBoundingClientRect(); return { vb: s.getAttribute('viewBox'), w: r.width, h: r.height, vw: document.documentElement.clientWidth, left: r.left, right: r.right, label: s.getAttribute('aria-label') }; });
    assert.equal(g.vb, '0 0 768 512');
    assert.ok(g.left >= 0 && g.right <= g.vw + 0.5, 'cabe en el ancho de la pantalla: ' + JSON.stringify(g));
    assert.match(g.label, /^Croquis topográfico del polígono/);
    const labels = await page.$$eval('#topoBlock svg text', (els) => els.map((e) => e.textContent));
    for (const k of ['Abajo', 'Medio', 'Arriba', 'N', '© OpenStreetMap contributors, SRTM | OpenTopoMap (CC-BY-SA)']) assert.ok(labels.includes(k), 'falta «' + k + '»: ' + JSON.stringify(labels));
    assert.ok(labels.some((l) => /^\d+ m$|^\d,\d+ km$/.test(l)), 'lados con su distancia');
    const b = flat(await block('#topoBlock'));
    assert.match(b, /Mapa topográfico de OpenTopoMap \(datos de OpenStreetMap contributors y SRTM; estilo de OpenTopoMap, licencia CC-BY-SA\)/);
    assert.match(b, /no son las altitudes de tus puntos/);
    assert.equal(await text('#topoBlock [data-act="topoPrepare"]'), 'Volver a preparar');
    assert.equal(await text('#satBlock [data-act="satPrepare"]'), 'Volver a preparar', 'el satelital no se toca');
    assert.match(await toastText(), /Croquis topográfico listo/);
    await shot('84-informe-topografico');
  });

  await step('Compartir con los dos croquis ya preparados: no vuelve a bajar nada y el informe trae croquis, satelital, topográfico y perfil en ese orden', async () => {
    tiles.reset();
    const f = await download(() => page.click('[data-act="share"]'));
    assert.equal(tiles.urls.length, 0, 'usa la imagen ya guardada');
    const h = f.text;
    const iCroquis = iPos(h, 'aria-label="Plano del polígono"'), iSat = iPos(h, '<h2>Croquis satelital</h2>'), iTopo = iPos(h, '<h2>Croquis topográfico</h2>'), iPerfil = iPos(h, '<h2>Perfil del relieve</h2>');
    assert.ok(iCroquis > 0 && iSat > iCroquis && iTopo > iSat && iPerfil > iTopo, 'orden: croquis, satelital, topográfico, perfil');
    assert.equal(nImages(h), 2, 'las dos imágenes van dentro del archivo');
    assert.match(h, /Imagen satelital de Esri/);
    assert.match(h, /Mapa topográfico de OpenTopoMap/);
    assert.match(h, /© OpenStreetMap contributors, SRTM \| OpenTopoMap \(CC-BY-SA\)/);
    assert.match(h, /Perfil del relieve: altitud de los puntos contra la distancia acumulada/);
    assert.ok(!/<script/i.test(h));
    await openReport(h, '82-informe-html-satelital-topografico-perfil');
  });

  await step('Si cambia un punto, el croquis preparado deja de servir; al compartir se prepara solo, y dos toques seguidos a «Compartir» generan un solo informe', async () => {
    await tab('puntos');
    await page.locator('[data-act="editPoint"]').first().click();
    await fill('#fName', 'Mojón');
    await page.click('[data-act="saveEdit"]'); await c.waitSheetClosed();
    await tab('informe');
    assert.equal(await page.locator('#satBlock svg image').count(), 0, 'el croquis viejo ya no se muestra');
    assert.equal(await page.locator('#topoBlock svg image').count(), 0, 'el topográfico viejo tampoco');
    assert.equal(await text('[data-act="satPrepare"]'), 'Preparar croquis satelital');
    assert.equal(await text('[data-act="topoPrepare"]'), 'Preparar croquis topográfico');
    tiles.reset();
    await watchToasts();
    let descargas = 0;
    const count = () => { descargas++; };
    page.on('download', count);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { const b = document.querySelector('[data-act="share"]'); b.click(); b.click(); })]);
    assert.ok((await seenToasts()).some((t) => /^Preparando los croquis satelital y topográfico para el informe…$/.test(t)), 'avisa que prepara los dos: ' + JSON.stringify(await seenToasts()));
    const html = require('fs').readFileSync(await dl.path(), 'utf8');
    await page.waitForTimeout(400);
    page.off('download', count);
    assert.equal(descargas, 1, 'un solo informe');
    assert.ok(tiles.count(ESRI) >= 6, 'se bajó la imagen satelital nueva');
    assert.ok(tiles.count(TOPO) >= 4, 'y la topográfica nueva');
    const iS = iPos(html, '<h2>Croquis satelital</h2>'), iT = iPos(html, '<h2>Croquis topográfico</h2>'), iP = iPos(html, '<h2>Perfil del relieve</h2>');
    assert.ok(iS > 0 && iT > iS && iP > iT);
    assert.match(html.slice(iS, iT), />Mojón</, 'la imagen satelital nueva ya lleva el nombre cambiado');
    assert.match(html.slice(iT, iP), />Mojón</, 'la topográfica nueva también');
    assert.equal(nImages(html), 2);
    assert.equal(await page.locator('#satBlock svg image').count(), 1, 'y quedan listas en la pestaña');
    assert.equal(await page.locator('#topoBlock svg image').count(), 1);
  });

  await step('Si el servicio de imágenes falla: los bloques lo explican y el informe se comparte igual, sin los croquis; al recuperarse se quitan los avisos', async () => {
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
    await act('topoPrepare');
    const wt = flat(await topoWarn());
    assert.match(wt, /No se pudo preparar el croquis topográfico: no se pudieron descargar las imágenes: revisa la conexión a internet/);
    assert.match(await toastText(), /No se pudo preparar el croquis topográfico/);
    assert.equal(await page.locator('#topoBlock svg image').count(), 0);
    const f = await download(() => page.click('[data-act="share"]'));
    assert.match(f.text, /<h2>Croquis satelital<\/h2><div class="note">No se pudo preparar el croquis satelital: no se pudieron descargar las imágenes/);
    assert.match(f.text, /<h2>Croquis topográfico<\/h2><div class="note">No se pudo preparar el croquis topográfico: no se pudieron descargar las imágenes/);
    assert.match(f.text, /<h2>Perfil del relieve<\/h2>/);
    assert.doesNotMatch(f.text, /<image href/);
    await openReport(f.text, '83-informe-sin-croquis-de-imagen');
    tiles.fail(false);
    await act('satPrepare');
    await satReady();
    await act('topoPrepare');
    await topoReady();
    assert.equal(await page.locator('#satBlock .warn').count(), 0, 'al recuperarse se quita el aviso');
    assert.equal(await page.locator('#topoBlock .warn').count(), 0, 'y también el del topográfico');
    errors.length = 0;                                                        // los mosaicos que fallaron a propósito dejan avisos en la consola
  });

  await step('Si solo falla OpenTopoMap: el croquis satelital sale bien, el topográfico explica por qué falta, y se pueden preparar por separado', async () => {
    await fresh();                                                            // otro lugar otra vez: nada guardado en la memoria del navegador
    await addPointManual('7.1000, -73.1200', 900, 'Abajo');
    await addPointManual('7.1000, -73.1100', 1100, 'Medio');
    await addPointManual('7.1090, -73.1150', 1300, 'Arriba');
    await tab('clima'); await field('pManual', '1800');
    await tab('informe');
    tiles.fail(/opentopomap/);
    tiles.reset();
    const f = await download(() => page.click('[data-act="share"]'));
    assert.equal(nImages(f.text), 1, 'solo la imagen satelital quedó dentro');
    assert.match(f.text, /<h2>Croquis satelital<\/h2><div style="max-width:760px"><svg/);
    assert.match(f.text, /<h2>Croquis topográfico<\/h2><div class="note">No se pudo preparar el croquis topográfico: no se pudieron descargar las imágenes/);
    assert.ok(tiles.count(ESRI) >= 4 && tiles.count(TOPO) >= 4, 'intentó las dos fuentes');
    await page.waitForSelector('#satBlock svg image', { state: 'attached' });
    assert.equal(await page.locator('#satBlock .warn').count(), 0, 'el satelital no tiene aviso');
    assert.match(flat(await topoWarn()), /No se pudo preparar el croquis topográfico/);
    // al volver el servicio, compartir de nuevo prepara solo el topográfico (el satelital ya está) y lo dice así
    tiles.fail(false); tiles.reset();
    await watchToasts();
    const g = await download(() => page.click('[data-act="share"]'));
    assert.ok((await seenToasts()).some((t) => /^Preparando el croquis topográfico para el informe…$/.test(t)), 'avisa que prepara solo el topográfico: ' + JSON.stringify(await seenToasts()));
    assert.equal(tiles.count(ESRI), 0, 'no volvió a bajar el satelital');
    assert.ok(tiles.count(TOPO) >= 4);
    assert.equal(nImages(g.text), 2, 'ahora el informe trae las dos imágenes');
    await topoReady();
    assert.equal(await page.locator('#topoBlock .warn').count(), 0);
    errors.length = 0;
  });

  await step('Sin internet: no intenta descargar, lo dice, y el informe sale con el perfil y la razón', async () => {
    await act('satPrepare');                                                  // deja preparados los croquis para comprobar que «sin internet» no los borra
    await satReady();
    await act('topoPrepare');
    await topoReady();
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
      await act('topoPrepare');
      assert.match(flat(await topoWarn()), /No se pudo preparar el croquis topográfico: no hay conexión a internet en este momento/);
      const f = await download(() => page.click('[data-act="share"]'));
      assert.equal(tiles.urls.length, 0, 'sin internet no pide nada');
      assert.match(f.text, /<div class="note">No se pudo preparar el croquis satelital: no hay conexión a internet en este momento<\/div>/);
      assert.match(f.text, /<div class="note">No se pudo preparar el croquis topográfico: no hay conexión a internet en este momento<\/div>/);
      assert.match(f.text, /<h2>Perfil del relieve<\/h2>/);
      assert.match(f.text, /Plano del polígono/);
    } finally { await context.setOffline(false); }
    await act('satPrepare');
    await satReady();
    await act('topoPrepare');
    await topoReady();
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

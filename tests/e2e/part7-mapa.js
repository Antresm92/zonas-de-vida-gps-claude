'use strict';
/* Recorrido 7 — Polígono › Mapa: capas base, puntos con nombre y altitud, polígono, capas importadas, GPS y avisos sin conexión.
 * Los mosaicos del mapa son de mentira (harness.mockTiles): se comprueba lo que la app pide y dibuja, no el aspecto de los servidores reales. */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, state, toastText, waitToast, waitSheetClosed, sheetTitle, addPointManual, setFile, gpsPush, fx, errors, shot, tiles } = c;

  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  const info = () => page.evaluate(() => { const m = window.__app.ui.map; return m ? m.info() : null; });
  const waitInfo = async (pred, ms, what) => {
    const t0 = Date.now(); let i = null;
    while (Date.now() - t0 < (ms || 5000)) { i = await info(); if (i && pred(i)) return i; await page.waitForTimeout(50); }
    throw new Error('El mapa no llegó al estado esperado' + (what ? ' (' + what + ')' : '') + ': ' + JSON.stringify(i));
  };
  const openMap = async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });   // los paneles de Leaflet miden 0 × 0: nunca «visibles» para Playwright
  };
  // Los botones + y − de Leaflet ignoran los toques que llegan mientras anima el zoom: se pulsa uno y se espera el resultado
  const zoomBy = async (btn, times) => {
    for (let k = 0; k < times; k++) {
      const want = (await info()).zoom + (btn === 'in' ? 1 : -1);
      let ok = false;
      for (let tries = 0; tries < 6 && !ok; tries++) {
        await page.click('.leaflet-control-zoom-' + btn);
        ok = await waitInfo((x) => x.zoom === want, 800, 'zoom ' + btn).then(() => true, () => false);
      }
      assert.ok(ok, 'el botón de zoom ' + btn + ' no llegó al nivel ' + want);
    }
  };
  const labels = () => page.$$eval('.mk-lab', (els) => els.map((e) => e.textContent));
  const notice = () => page.evaluate(() => { const n = document.querySelector('#mapNotice'); return !n || n.hidden ? '' : n.textContent; });
  const pressed = (sel) => page.getAttribute(sel, 'aria-pressed');
  // Cuántos píxeles tiene pintados el lienzo donde Leaflet dibuja polígonos y líneas (los puntos con nombre son elementos de la página)
  const painted = () => page.evaluate(() => {
    const cv = document.querySelector('.mapa-leaflet canvas');
    if (!cv) return 0;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  const waitPainted = async (pred, what) => {
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < 4000) { n = await painted(); if (pred(n)) return n; await page.waitForTimeout(50); }
    throw new Error('Lienzo del mapa: ' + what + ' (píxeles pintados: ' + n + ')');
  };
  const seed = async () => { await fresh(); for (const p of ['4.60, -74.08', '4.60, -74.07', '4.61, -74.075']) await addPointManual(p, 2600); };
  const flags = () => page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags') || '{}'));
  // Los mosaicos que fallan a propósito dejan avisos «Failed to load resource» en la consola del navegador: esos no son errores de la app
  const forgetTileNoise = () => { const keep = errors.filter((e) => !/Failed to load resource/.test(e)); errors.length = 0; keep.forEach((e) => errors.push(e)); };

  await step('Pestaña «Polígono»: título, Croquis por defecto y botón para ver el Mapa', async () => {
    await fresh();
    assert.match(await text('#nav-area'), /Polígono/);
    assert.doesNotMatch(await text('#nav-area'), /Área/);
    await tab('area');
    assert.equal(await text('#tab-area .pagetitle'), 'Polígono del terreno');
    assert.equal(await pressed('[data-act="polyView"][data-v="croquis"]'), 'true');
    assert.equal(await pressed('[data-act="polyView"][data-v="mapa"]'), 'false');
    assert.equal(await page.locator('.mapa-leaflet').count(), 0, 'el mapa no se arma hasta que se pide');
    assert.match(await text('#tab-area'), /Sin puntos todavía/);
  });

  await step('Mapa con «Calles»: puntos con nombre y altitud, polígono cerrado y atribución de OpenStreetMap', async () => {
    await seed();
    tiles.reset();
    await openMap();
    const i = await waitInfo((x) => x.loaded > 0, 5000, 'mosaicos cargados');
    assert.equal(i.base, 'calles');
    assert.equal(i.reference, false);
    assert.deepEqual(i.markers.map((m) => m.label), ['P1 · 2600 m', 'P2 · 2600 m', 'P3 · 2600 m']);
    assert.deepEqual(i.polygon, { vertices: 3, closed: true, bad: false, color: '#2F8F4E' });
    assert.ok(i.zoom >= 13 && i.zoom <= 16, 'encuadra los tres puntos, zoom ' + i.zoom);
    near(i.center.lat, 4.6050, 0.012, 'centro lat'); near(i.center.lon, -74.075, 0.006, 'centro lon');
    assert.deepEqual(await labels(), ['P1 · 2600 m', 'P2 · 2600 m', 'P3 · 2600 m']);
    assert.match(i.attribution, /OpenStreetMap/);
    assert.match(i.attribution, /Leaflet/);
    const hrefs = await page.$$eval('.leaflet-control-attribution a', (as) => as.map((a) => a.getAttribute('href') + '|' + a.getAttribute('rel')));
    assert.deepEqual(hrefs, ['https://www.openstreetmap.org/copyright|noopener noreferrer'], 'solo el enlace de OSM, y sin sacar a la persona de la app');
    assert.ok(tiles.count(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/) > 0, 'pide mosaicos de OpenStreetMap');
    assert.equal(tiles.count(/arcgisonline/), 0, 'con «Calles» no toca Esri');
    assert.equal(await page.locator('[data-act="mapRef"]').count(), 0, 'el botón de calles sobre el satélite solo sale con el satélite');
    assert.equal(await notice(), '');
    assert.ok(await painted() > 1000, 'el polígono se pinta');
    await shot('70-mapa-calles');
  });

  await step('Pantalla de teléfono: el mapa cabe sin bajar la página y el encuadre deja ver los nombres completos sin que las herramientas los tapen', async () => {
    const geometry = () => page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const box = r(document.querySelector('.mapa-leaflet'));
      const tools = [...document.querySelectorAll('.maptool, .maploc')].map(r);
      const nav = document.querySelector('nav').getBoundingClientRect().top;
      const marks = [...document.querySelectorAll('.mk-dot, .mk-lab')].map(r);
      return { box, tools, nav, marks, h: box.b - box.t };
    });
    const inside = (a, b) => a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1;
    const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const check = async (label) => {
      const g = await geometry();
      assert.ok(g.h >= 296, label + ': el mapa mide ' + g.h);   // 300 px menos el borde
      for (const t of g.tools) assert.ok(t.b <= g.nav, label + ': una herramienta queda detrás de la barra de abajo');
      assert.equal(g.marks.length, 6);
      for (const m of g.marks) {
        assert.ok(m.r > m.l && m.b > m.t, label + ': un nombre o punto no se está mostrando');
        assert.ok(inside(m, g.box), label + ': un nombre o punto se sale del mapa ' + JSON.stringify(m) + ' en ' + JSON.stringify(g.box));
        for (const t of g.tools) assert.ok(!overlap(m, t), label + ': una herramienta tapa un nombre o punto');
      }
    };
    // un terreno de unos 330 m de lado: el encuadre llega a zoom 16 y los nombres se muestran
    await fresh();
    for (const p of ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0785']) await addPointManual(p, 2600);
    await openMap();
    await waitInfo((x) => x.markers.length === 3 && x.zoom >= 15, 3000, 'terreno pequeño');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await check('Calles, 390 × 844');
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => { window.__app.ui.mapFitKey = null; window.__app.showTab('area'); });
    await waitInfo((x) => x.markers.length === 3, 3000, 'otra vez con tres puntos');
    await page.waitForTimeout(300);
    await check('Calles, 360 × 640');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.__app.ui.mapFitKey = null; window.__app.showTab('area'); });
    await page.waitForTimeout(300);
    await check('Calles, vuelta a 390 × 844');
  });

  await step('Satélite y «Calles y nombres sobre el satélite»: pide solo lo que corresponde y se acuerda de la elección', async () => {
    tiles.reset();
    await page.click('[data-act="mapBase"][data-b="satelite"]');
    let i = await waitInfo((x) => x.base === 'satelite' && x.loaded > 0, 5000, 'satélite');
    assert.equal(i.reference, false);
    assert.ok(tiles.count(/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/) > 0, 'pide imágenes del satélite');
    assert.equal(tiles.count(/Reference\//), 0, 'sin la capa de nombres todavía');
    assert.match(i.attribution, /Esri/);
    assert.equal(await pressed('[data-act="mapBase"][data-b="satelite"]'), 'true');
    assert.equal(await pressed('[data-act="mapRef"]'), 'false');
    assert.deepEqual(i.markers.length, 3, 'los puntos siguen sobre el satélite');
    tiles.reset();
    await page.click('[data-act="mapRef"]');
    i = await waitInfo((x) => x.reference === true, 5000, 'capa de nombres');
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-pane img').length > 0);
    for (let k = 0; k < 40 && !(tiles.count(/World_Transportation/) && tiles.count(/World_Boundaries_and_Places/)); k++) await page.waitForTimeout(50);
    assert.ok(tiles.count(/Reference\/World_Transportation\/MapServer\/tile\/\d+\/\d+\/\d+$/) > 0, 'pide las calles');
    assert.ok(tiles.count(/Reference\/World_Boundaries_and_Places\/MapServer\/tile\/\d+\/\d+\/\d+$/) > 0, 'pide los nombres');
    assert.equal(await pressed('[data-act="mapRef"]'), 'true');
    assert.deepEqual(await flags(), { mapBase: 'satelite', mapRef: true });
    await shot('71-mapa-satelite-nombres');
    // al reabrir la app se conserva la elección (queda en el equipo, no en la copia de seguridad)
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await openMap();
    i = await waitInfo((x) => x.base === 'satelite' && x.reference === true, 5000, 'elección guardada');
    assert.equal(await pressed('[data-act="mapBase"][data-b="satelite"]'), 'true');
    // volver a «Calles» quita el botón y la capa de nombres, pero recuerda que estaba activada
    await page.click('[data-act="mapBase"][data-b="calles"]');
    i = await waitInfo((x) => x.base === 'calles', 5000, 'calles');
    assert.equal(i.reference, false);
    assert.equal(await page.locator('[data-act="mapRef"]').count(), 0);
    assert.deepEqual(await flags(), { mapBase: 'calles', mapRef: true });
    await page.click('[data-act="mapBase"][data-b="satelite"]');
    i = await waitInfo((x) => x.base === 'satelite' && x.reference === true, 5000, 'satélite con nombres otra vez');
    await page.click('[data-act="mapRef"]');
    i = await waitInfo((x) => x.reference === false, 5000, 'sin nombres');
    assert.deepEqual(await flags(), { mapBase: 'satelite', mapRef: false });
    const backup = await page.evaluate(() => { try { return JSON.stringify(window.Backup && window.Backup.build ? window.Backup.build(window.__app.S, window.__app.MEM) : ''); } catch (e) { return ''; } });
    assert.doesNotMatch(backup, /mapBase|satelite/, 'la capa elegida no entra en la copia de seguridad');
  });

  await step('«Polígono activo»: oculta y vuelve a mostrar la figura sin quitar los puntos', async () => {
    await page.click('[data-act="mapBase"][data-b="calles"]');
    await waitInfo((x) => x.base === 'calles', 5000, 'calles');
    assert.equal(await text('[data-act="mapPoly"]'), 'Polígono activo');
    assert.equal(await pressed('[data-act="mapPoly"]'), 'true');
    const on = await waitPainted((n) => n > 1000, 'polígono visible');
    await page.click('[data-act="mapPoly"]');
    let i = await waitInfo((x) => x.polygon === null, 3000, 'polígono apagado');
    assert.equal(i.markers.length, 3, 'los puntos se quedan');
    assert.equal(await text('[data-act="mapPoly"]'), 'Polígono inactivo');
    assert.equal(await pressed('[data-act="mapPoly"]'), 'false');
    await waitPainted((n) => n < on / 4, 'figura borrada');
    await shot('72-poligono-inactivo');
    await page.click('[data-act="mapPoly"]');
    i = await waitInfo((x) => x.polygon !== null, 3000, 'polígono encendido');
    assert.equal(i.polygon.closed, true);
    assert.equal(await text('[data-act="mapPoly"]'), 'Polígono activo');
    await waitPainted((n) => n > 1000, 'polígono otra vez');
  });

  await step('El mapa conserva su encuadre al cambiar de pestaña y al tocar herramientas', async () => {
    await page.evaluate(() => window.__app.ui.map.flyTo(4.7, -74.2, 16));
    const a = await waitInfo((x) => Math.abs(x.center.lat - 4.7) < 1e-4, 3000, 'movido');
    await tab('puntos'); await tab('area');
    let b = await info();
    near(b.center.lat, a.center.lat, 1e-4, 'lat tras cambiar de pestaña'); near(b.center.lon, a.center.lon, 1e-4, 'lon'); assert.equal(b.zoom, a.zoom);
    await page.click('[data-act="mapPoly"]'); await page.click('[data-act="mapPoly"]');
    b = await info();
    near(b.center.lat, 4.7, 1e-4, 'no se re-encuadra al tocar el polígono'); assert.equal(b.zoom, a.zoom);
    // Croquis y Mapa se pueden alternar sin perder nada
    await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.match(await text('#tab-area .big'), /ha/);
    assert.equal(await page.locator('.mapa-leaflet').count(), 0, 'el mapa sale de la página en el Croquis');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet');
    b = await info();
    near(b.center.lat, 4.7, 1e-4, 'el mapa vuelve donde estaba'); assert.equal(b.markers.length, 3);
  });

  await step('Un cambio de vista que llega mientras anima el zoom no se pierde', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.markers.length === 3, 3000, 'tres puntos');
    // se pulsa «+» y, cuando la animación ya va en marcha (dos cuadros después), llega un cambio de vista de la app
    const animating = await page.evaluate(() => new Promise((done) => {
      document.querySelector('.leaflet-control-zoom-in').click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const on = document.querySelector('.leaflet-map-pane').classList.contains('leaflet-zoom-anim');
        window.__app.ui.map.flyTo(4.9, -74.4, 16);
        done(on);
      }));
    }));
    assert.equal(animating, true, 'la prueba tiene que caer dentro de la animación');
    const i = await waitInfo((x) => Math.abs(x.center.lat - 4.9) < 1e-4 && Math.abs(x.center.lon + 74.4) < 1e-4, 3000, 'llegó al destino');
    assert.ok(i.zoom >= 16);
    await act('mapLast');                                                           // y las herramientas siguen respondiendo
    await waitInfo((x) => Math.abs(x.center.lat - 4.61) < 1e-4, 3000, 'último punto');
  });

  await step('Nombres de los puntos: aparecen con zoom cercano y nunca se interpretan como HTML', async () => {
    await seed();
    await addPointManual('4.605, -74.072', 2610, '<img src=x onerror="window.__xss=1">');
    await openMap();
    let i = await waitInfo((x) => x.markers.length === 4, 5000, 'cuatro puntos');
    assert.equal(await page.locator('.mk-lab img').count(), 0, 'el nombre se escribe como texto');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.ok((await labels()).includes('<img src=x onerror="window.__xss=1"> · 2610 m'));
    await page.evaluate(() => window.__app.ui.map.flyTo(4.6, -74.075, 17));
    i = await waitInfo((x) => x.zoom >= 17, 3000, 'zoom cercano');
    assert.equal(i.labelsOn, true);
    await page.evaluate(() => { const m = window.__app.ui.map; m.flyTo(4.6, -74.075, 12); });
    // flyTo nunca aleja: el zoom se mantiene y los nombres siguen visibles
    assert.ok((await info()).zoom >= 17);
    await zoomBy('out', 3);
    // Leaflet cambia el zoom al empezar la animación y avisa «zoomend» 0,25 s después: los nombres se esconden entonces
    i = await waitInfo((x) => x.zoom === 14 && x.labelsOn === false, 5000, 'con poco zoom los nombres se esconden para no amontonarse');
    assert.equal(await page.locator('.mapa-leaflet.labels-off').count(), 1);
    await zoomBy('in', 1);
    i = await waitInfo((x) => x.zoom === 15 && x.labelsOn === true, 5000, 'con zoom 15 los nombres vuelven');
    assert.equal(await page.locator('.mapa-leaflet.labels-off').count(), 0);
  });

  await step('Sin puntos: mapa de Colombia con una guía; con 1 solo punto se acerca a él; con 2 es una línea', async () => {
    await fresh();
    await openMap();
    let i = await waitInfo((x) => x.zoom === 5, 3000, 'vista inicial');
    near(i.center.lat, 4.57, 0.1, 'Colombia lat'); near(i.center.lon, -74.3, 0.1, 'Colombia lon');
    assert.equal(i.markers.length, 0); assert.equal(i.polygon, null);
    assert.match(await text('#tab-area'), /Todavía no hay puntos\. Pulsa «Marcar punto»/);
    await act('mapLast');
    assert.match(await toastText(), /Todavía no hay puntos marcados en este proyecto/);
    await tab('puntos');
    await addPointManual('6.2442, -75.5812', 1495);
    await tab('area');
    i = await waitInfo((x) => x.markers.length === 1 && x.zoom === 17, 3000, 'un punto');
    near(i.center.lat, 6.2442, 1e-4, 'centra en el primer punto'); near(i.center.lon, -75.5812, 1e-4);
    assert.equal(i.polygon, null, 'un punto solo no hace figura');
    assert.equal(await page.locator('#tab-area .tip:not([hidden])').count(), 0, 'la guía desaparece cuando ya hay puntos');
    await tab('puntos');
    await addPointManual('6.2452, -75.5802', 1500);
    await tab('area');
    i = await waitInfo((x) => x.markers.length === 2 && x.polygon !== null, 3000, 'dos puntos');
    assert.deepEqual(i.polygon, { vertices: 2, closed: false, bad: false, color: '#2F8F4E' }, 'dos puntos se unen con una línea');
  });

  await step('Lados que se cruzan: el polígono se pinta en rojo', async () => {
    await fresh();
    for (const p of ['4.60, -74.08', '4.61, -74.07', '4.60, -74.07', '4.61, -74.08']) await addPointManual(p, 2600);
    await openMap();
    const i = await waitInfo((x) => x.polygon !== null, 3000, 'polígono');
    assert.deepEqual(i.polygon, { vertices: 4, closed: true, bad: true, color: '#C42D34' });
    await shot('73-lados-cruzados');
  });

  await step('«Último punto»: centra el mapa en el más reciente y avisa su nombre', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.markers.length === 3, 3000, 'tres puntos');
    await page.evaluate(() => window.__app.ui.map.flyTo(4.9, -74.4, 12));
    await waitInfo((x) => Math.abs(x.center.lat - 4.9) < 1e-4, 3000, 'lejos');
    await act('mapLast');
    assert.match(await toastText(), /^Último punto: P3\.$/);
    const i = await waitInfo((x) => Math.abs(x.center.lat - 4.61) < 1e-4, 3000, 'en el último punto');
    near(i.center.lon, -74.075, 1e-4, 'lon'); assert.ok(i.zoom >= 18, 'zoom ' + i.zoom);
  });

  await step('«Marcar punto» desde el mapa: enciende el GPS, muestra el avance, guarda y dibuja el punto', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.markers.length === 3, 3000, 'tres puntos');
    assert.equal(await page.evaluate(() => window.__app.ui.gpsOn), false);
    await act('mapMark');
    assert.equal(await page.evaluate(() => window.__app.ui.gpsOn), true, 'enciende el GPS por la persona');
    assert.equal(await page.locator('#mapProgBar').count(), 1);
    assert.match(await text('#mapProgTxt'), /Esperando la primera lectura/);
    assert.equal(await page.locator('[data-act="mapMark"]').isDisabled(), true, 'no se puede marcar dos veces a la vez');
    await gpsPush({ lat: 4.6050, lon: -74.0750, alt: 2639.4, acc: 3 });
    await page.waitForFunction(() => /Promediando lecturas: 1 · mejor precisión ±3 m/.test((document.querySelector('#mapProgTxt') || {}).textContent || ''));
    await shot('74-marcando-punto');
    await gpsPush({ lat: 4.6050, lon: -74.0750, alt: 2639.4, acc: 3 }, 4);
    await waitToast(/P4 guardado \(±3 m/, 14000);
    const p = await proj();
    assert.equal(p.points.length, 4);
    assert.equal(p.points[3].src, 'gps');
    near(p.points[3].lat, 4.6050, 1e-4, 'lat guardada');
    const i = await waitInfo((x) => x.markers.length === 4, 3000, 'punto nuevo en el mapa');
    assert.equal(i.markers[3].label, 'P4 · 2639 m');
    assert.equal(await page.locator('#mapProgBar').count(), 0, 'la barra de avance desaparece');
    assert.equal(await page.locator('[data-act="mapMark"]').isDisabled(), false);
    assert.ok(i.fix && i.fix.acc === 3, 'se ve la posición del GPS en el mapa');
  });

  await step('«Marcar punto» con precisión baja: pregunta, deja esperar o marcar igual y permite quitarlo', async () => {
    await tab('puntos');
    await page.selectOption('[data-setting="minAcc"]', '3');
    await tab('area');
    await gpsPush({ lat: 4.6050, lon: -74.0750, alt: 2639.4, acc: 12 });
    await act('mapMark');
    assert.equal(await sheetTitle(), 'La precisión del GPS es baja');
    assert.equal(await page.locator('#mapProgBar').count(), 0, 'todavía no empezó a marcar');
    await page.click('#sheet [data-act="closeSheet"].btn'); await waitSheetClosed();
    assert.equal((await proj()).points.length, 4, 'esperar no guarda nada');
    await act('mapMark');
    await act('markAnyway'); await waitSheetClosed();
    assert.equal(await page.locator('#mapProgBar').count(), 1);
    await gpsPush({ lat: 4.6050, lon: -74.0750, alt: 2639.4, acc: 12 }, 4);
    await waitToast(/este punto no es el más preciso/, 14000);
    assert.equal((await proj()).points.length, 5);
    await waitInfo((x) => x.markers.length === 5, 3000, 'quinto punto');
    await page.click('[data-act="toastAction"]');
    assert.equal((await proj()).points.length, 4);
    await waitInfo((x) => x.markers.length === 4, 3000, 'punto quitado');
  });

  await step('«Cancelar» durante el marcado no guarda nada', async () => {
    await seed();
    await openMap();
    await act('mapMark');
    await gpsPush({ lat: 4.6050, lon: -74.0750, alt: 2639.4, acc: 3 }, 2);
    await page.click('#tab-area [data-act="cancelMark"]');
    await page.waitForSelector('#mapProgBar', { state: 'detached' });
    assert.equal((await proj()).points.length, 3);
  });

  await step('«Mi posición»: enciende el GPS, centra en la primera lectura y después ya no persigue a la persona', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.markers.length === 3, 3000, 'tres puntos');
    await act('mapMyPos');
    assert.equal(await page.evaluate(() => window.__app.ui.gpsOn), true);
    assert.match(await toastText(), /Buscando tu posición/);
    await gpsPush({ lat: 6.2442, lon: -75.5812, alt: 1495, acc: 15 });
    let i = await waitInfo((x) => x.fix && Math.abs(x.center.lat - 6.2442) < 1e-4, 3000, 'centrado en la primera lectura');
    near(i.center.lon, -75.5812, 1e-4, 'lon'); assert.ok(i.zoom >= 17); assert.equal(i.fix.acc, 15);
    await shot('75-mi-posicion');
    // una lectura posterior mueve el punto azul, pero no el mapa
    await gpsPush({ lat: 6.3000, lon: -75.6000, alt: 1495, acc: 15 });
    i = await waitInfo((x) => x.fix && Math.abs(x.fix.lat - 6.3) < 1e-6, 3000, 'punto azul movido');
    near(i.center.lat, 6.2442, 1e-4, 'el mapa se queda quieto');
    // al pulsar de nuevo, vuelve a la lectura más reciente
    await act('mapMyPos');
    i = await waitInfo((x) => Math.abs(x.center.lat - 6.3) < 1e-4, 3000, 'vuelve a la persona');
    near(i.center.lon, -75.6, 1e-4, 'lon');
    // sin GPS, el punto azul desaparece del mapa
    await tab('puntos'); await act('gpsOff'); await tab('area');
    i = await waitInfo((x) => x.fix === null, 3000, 'sin posición');
  });

  await step('«Mi posición» con el GPS apagado y una lectura ya disponible: centra de inmediato', async () => {
    await tab('puntos'); await act('gpsOn');
    await gpsPush({ lat: 4.7, lon: -74.2, alt: 2500, acc: 6 });
    await tab('area');
    await page.evaluate(() => window.__app.ui.map.flyTo(4.0, -73.0, 12));
    await waitInfo((x) => Math.abs(x.center.lat - 4.0) < 1e-4, 3000, 'lejos');
    await act('mapMyPos');
    const i = await waitInfo((x) => Math.abs(x.center.lat - 4.7) < 1e-4, 3000, 'centrado');
    near(i.center.lon, -74.2, 1e-4, 'lon');
    await tab('puntos'); await act('gpsOff');
  });

  await step('Capas importadas: se dibujan con su color y se ocultan desde Puntos', async () => {
    await seed();
    await setFile('#gisFile', 'lotes.geojson', fx.geojson());
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importLayer'); await waitSheetClosed();
    const layers = (await proj()).layers;
    assert.equal(layers.length, 3);
    await openMap();
    let i = await waitInfo((x) => x.layers.length === 3, 3000, 'tres capas');
    assert.deepEqual(i.layers.map((l) => l.kind).sort(), ['line', 'points', 'polygon']);
    for (const l of i.layers) assert.equal(l.color, layers.find((x) => x.id === l.id).color, 'color de la capa ' + l.kind);
    assert.equal(i.markers.length, 3, 'los puntos propios se dibujan aparte');
    // acerca el mapa a las capas para ver que están dibujadas
    await page.evaluate(() => { const p = window.__app.S.projects.find((x) => x.id === window.__app.S.currentId); window.__app.ui.map.fit(window.Mapa.extent([], p.layers)); });
    await waitPainted((n) => n > 1000, 'capas pintadas');
    await shot('76-capas-importadas');
    const poly = i.layers.find((l) => l.kind === 'polygon');
    await tab('puntos');
    await page.click('[data-act="toggleLayer"][data-id="' + poly.id + '"]');
    await tab('area');
    i = await waitInfo((x) => x.layers.length === 2, 3000, 'capa oculta');
    assert.equal(i.layers.some((l) => l.kind === 'polygon'), false);
    await tab('puntos');
    await page.click('[data-act="toggleLayer"][data-id="' + poly.id + '"]');
    await tab('area');
    await waitInfo((x) => x.layers.length === 3, 3000, 'capa visible otra vez');
  });

  await step('Cada proyecto tiene su vista: al cambiar a uno vacío el mapa vuelve a Colombia', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.markers.length === 3 && x.zoom >= 14, 3000, 'proyecto con puntos');
    await act('projects'); await act('newProject'); await fill('#pName', 'Terreno vacío'); await act('saveNewProject'); await waitSheetClosed();
    await tab('area');
    const i = await waitInfo((x) => x.markers.length === 0 && x.zoom === 5, 3000, 'proyecto vacío');
    near(i.center.lat, 4.57, 0.1, 'lat');
    assert.match(await text('#tab-area'), /Todavía no hay puntos/);
  });

  await step('Mosaicos que no cargan: avisa que el fondo falla, sin esconder los puntos, y se quita solo al recuperarse', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.loaded > 0, 5000, 'mosaicos');
    tiles.fail(true);
    await page.click('[data-act="mapBase"][data-b="satelite"]');
    await page.waitForFunction(() => { const n = document.querySelector('#mapNotice'); return n && !n.hidden && /no está cargando/.test(n.textContent); }, null, { timeout: 8000 });
    assert.match(await notice(), /Tus puntos y el polígono se ven igual|tus puntos y el polígono se ven igual/);
    let i = await info();
    assert.ok(i.errors >= 3);
    assert.equal(i.markers.length, 3);
    await shot('77-fondo-no-carga');
    tiles.fail(false);
    await page.evaluate(() => window.__app.ui.map.flyTo(4.9, -74.5, 16));
    await page.waitForFunction(() => { const n = document.querySelector('#mapNotice'); return n && n.hidden; }, null, { timeout: 8000 });
    assert.equal((await info()).errors, 0);
    forgetTileNoise();
  });

  await step('Sin conexión: el mapa avisa, los puntos y el polígono siguen visibles, y al volver internet el aviso se va', async () => {
    await seed();
    await openMap();
    await waitInfo((x) => x.loaded > 0, 5000, 'mosaicos');
    tiles.fail(true);
    await context.setOffline(true);
    await page.waitForFunction(() => { const n = document.querySelector('#mapNotice'); return n && !n.hidden && /Sin conexión/.test(n.textContent); }, null, { timeout: 5000 });
    assert.equal(await page.locator('#netChip:not([hidden])').count(), 1);
    let i = await info();
    assert.equal(i.markers.length, 3);
    assert.equal(i.polygon.closed, true);
    await shot('78-mapa-sin-conexion');
    tiles.fail(false);
    await context.setOffline(false);
    await page.evaluate(() => window.__app.ui.map.flyTo(4.95, -74.45, 16));
    await page.waitForFunction(() => { const n = document.querySelector('#mapNotice'); return n && n.hidden; }, null, { timeout: 8000 });
    forgetTileNoise();
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

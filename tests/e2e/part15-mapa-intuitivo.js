'use strict';
/* Recorrido 15 — Polígono › Mapa (2.10.0): medidas a la vista, lados rotulados, tarjeta del punto, «+» para insertar, capas en un botón,
 * ver todo, pantalla completa, medir, mira, caminar el lindero y la ayuda de primera vez. Los mosaicos son de mentira (harness.mockTiles). */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, proj, toastText, waitToast, waitSheetClosed, sheetOpen, sheetTitle, addPointManual, gpsPush, errors, shot, url } = c;

  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const ui = () => page.evaluate(() => { const u = window.__app.ui; return { mode: u.mapMode, tool: u.mapTool, sel: u.mapSel, layers: u.mapLayers, full: u.mapFull, follow: u.follow, measure: u.measure, track: u.track ? { n: u.track.ids.length, last: u.track.last, step: u.track.step } : null, gpsOn: u.gpsOn }; });
  const openMap = async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
  };
  // Un terreno de unos 330 m de lado: el encuadre queda en zoom 16 y los lados miden más de 96 px
  const TERRENO = ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0785'];
  const seed = async () => { await fresh(); for (const p of TERRENO) await addPointManual(p, 2600); await openMap(); await waitInfo((x) => x.markers.length === 3 && x.zoom >= 15, 'terreno dibujado'); await page.waitForTimeout(300); };
  const waitInfo = async (pred, what) => { const t0 = Date.now(); let i; while (Date.now() - t0 < 4000) { i = await info(); if (i && pred(i)) return i; await page.waitForTimeout(50); } throw new Error('El mapa no llegó a: ' + what + ' ' + JSON.stringify(i).slice(0, 300)); };
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const pressed = (sel) => page.getAttribute(sel, 'aria-pressed');
  const box = (sel) => page.locator(sel).first().boundingBox();
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  const toWorld = (lat, lon, z) => { const k = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * k, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k }; };
  // Dónde cae en la pantalla un lugar del mapa
  const xyOf = async (lat, lon) => { const i = await info(), b = await box('#mapHost .mapa-leaflet'), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom); return { x: b.x + b.width / 2 + q.x - o.x, y: b.y + b.height / 2 + q.y - o.y }; };
  const tapPoint = async (name) => { const p = (await proj()).points.find((q) => q.name === name), xy = await xyOf(p.lat, p.lon); await page.mouse.click(xy.x, xy.y); return p; };
  const tapMap = async (dx, dy) => { const b = await box('#mapHost .mapa-leaflet'); await page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy); };
  const pts = async () => (await proj()).points;
  const names = async () => (await pts()).map((p) => p.name);
  const pickMode = async (mode) => { if (!(await visible('#mapMenuPanel'))) await page.click('.mapkebab'); await page.click('#mapMenuPanel input[data-mode="' + mode + '"]'); };
  const undo = () => page.click('#toast button');
  // Leaflet ignora el botón − mientras anima el zoom: se pulsa, se espera y, si no bajó, se repite
  const zoomOut = async (times) => {
    for (let k = 0; k < times; k++) {
      const z = (await info()).zoom;
      for (let t = 0; t < 6 && (await info()).zoom === z; t++) { await page.click('.leaflet-control-zoom-out'); await page.waitForTimeout(400); }
      assert.equal((await info()).zoom, z - 1, 'alejar un nivel');
    }
  };

  await step('El mapa ocupa la pantalla: sin título encima, con el resumen de área, perímetro y puntos, la escala y cinco herramientas en una fila', async () => {
    await seed();
    assert.equal(await page.locator('#tab-area .pagetitle').count(), 0, 'en la vista Mapa no va el título grande');
    assert.equal(await text('#tab-area h2.sr-only'), 'Polígono del terreno: mapa');
    const mb = await box('.mapbox'), nav = await box('nav');
    // 2.23.2: la fila de predios y lotes va siempre encima del mapa, así que el mapa mide unos 54 px menos que antes (554 en vez de 608)
    assert.ok(mb.height >= 540, 'el mapa mide ' + mb.height + ' px de alto en un teléfono de 844 (' + await page.evaluate(() => document.querySelector('.mapbox').className + ' · ventana ' + innerHeight + ' · lotes ' + window.__app.S.projects.map((p) => p.lots.length).join(',') + ' · barra ' + !!document.querySelector('#tab-area #lotsBar')) + ')');
    assert.ok(mb.y + mb.height <= nav.y, 'y no queda detrás de la barra de pestañas');
    assert.match(await text('#mapSum'), /^\d+,\d+ ha · [\d,]+ k?m · 3 puntos$/);
    assert.ok((await box('#mapSum')).height <= 34, 'el resumen cabe en una línea');
    assert.match((await info()).scale, /^\d+ m$/);
    assert.deepEqual(await page.$$eval('.maptools .maptool', (b) => b.map((x) => x.textContent)), ['Polígono activo', 'Último punto', 'Medir distancia', 'Más opciones', 'Marcar punto']);
    const tb = await page.$$eval('.maptools .maptool', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.top), r.height >= 44 && r.width >= 44, x.scrollWidth <= x.clientWidth + 1]; }));
    assert.ok(tb.every((t) => t[0] === tb[0][0]), 'todas en la misma fila');
    assert.ok(tb.every((t) => t[1]), 'se pueden tocar con el dedo');
    assert.ok(tb.every((t) => t[2]), 'ningún texto se corta');
    assert.deepEqual(await page.$$eval('.mapside .mapbtn', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Capas del mapa', 'Ver todo el terreno', 'Pantalla completa', 'Deshacer (no hay cambios que deshacer)']);
    await shot('150-mapa-nuevo');
  });

  await step('El resumen dice lo que falta con 1 y 2 puntos y no aparece sin puntos', async () => {
    await fresh(); await openMap();
    assert.equal(await visible('#mapSum'), false);
    await tab('puntos'); await addPointManual(TERRENO[0], 2600); await openMap();
    assert.equal(await text('#mapSum'), '1 punto · faltan 2');
    await tab('puntos'); await addPointManual(TERRENO[1], 2600); await openMap();
    assert.match(await text('#mapSum'), /^33\d m · 2 puntos · falta 1$/);
  });

  await step('Lados: cada uno lleva su longitud; al alejar el mapa los rótulos se quitan solos y con el polígono inactivo no hay', async () => {
    await seed();
    let i = await info();
    assert.equal(i.sides.length, 3);
    assert.ok(i.sides.every((s) => /^3\d\d m$/.test(s.text)), JSON.stringify(i.sides));
    assert.ok(i.sides.every((s) => s.label === true), 'con el terreno encuadrado se ven los tres');
    assert.ok(i.sides.every((s) => s.plus === false), 'el «+» solo sale con «Posición manual»');
    assert.equal(await page.locator('.mk-plus').count(), 0);
    assert.deepEqual((await page.$$eval('.mk-side:not(.side-off) .mk-len', (e) => e.map((x) => x.textContent))).sort(), i.sides.map((s) => s.text).sort());
    await zoomOut(4);
    i = await info();
    assert.ok(i.sides.every((s) => s.label === false), 'de lejos no se rotulan: ' + JSON.stringify(i.sides));
    assert.equal(await page.locator('.mk-side').count(), 0, 'y no quedan en la página');
    await act('mapPoly');
    assert.equal((await info()).sides.length, 0);
    await act('mapPoly');
    assert.equal((await info()).sides.length, 3);
  });

  await step('Tocar un punto, sin activar ningún modo, lo selecciona y abre su tarjeta; otro toque, el mapa o la × la cierran', async () => {
    await seed();
    assert.equal(await visible('#mapCard'), false);
    assert.equal(await page.locator('.mk-tap').count(), 3, 'los puntos se pueden tocar');
    assert.equal(await page.locator('.mk-hit').count(), 0, 'pero no agarrar: eso sigue siendo de «Posición manual»');
    const p2 = await tapPoint('P2');
    await page.waitForSelector('#mapCard:not([hidden])');
    assert.equal(await text('.mapcard-name'), 'P2');
    assert.match(await text('#mapCard'), /Altitud 2600 m · a mano · 4\.60000, -74\.07700/);
    assert.equal(await visible('#mapCardRel'), false, 'sin GPS no hay distancia');
    let u = await ui();
    assert.equal(u.sel, p2.id); assert.equal(u.mode, '');
    assert.equal((await info()).selected, p2.id);
    assert.equal(await page.locator('.mk.mk-sel').count(), 1);
    assert.deepEqual(await page.$$eval('.mapcard-btns .btn', (b) => b.map((x) => x.textContent)), ['Abrir ficha', 'Mover', 'Ir al punto', '']);   // el último es el de eliminar (solo icono)
    await shot('151-tarjeta-del-punto');
    // 2.23.2: con la fila de lotes encima, el mapa es más bajo y la tarjeta tapa los puntos de abajo: el «otro punto» es P3, que queda arriba
    const p1 = await tapPoint('P3');                                       // otro punto: la tarjeta cambia
    assert.equal(await text('.mapcard-name'), 'P3');
    assert.equal((await info()).selected, p1.id);
    await tapPoint('P3');                                                  // el mismo: se cierra
    assert.equal(await visible('#mapCard'), false);
    assert.equal((await info()).selected, null);
    assert.equal(await page.locator('.mk.mk-sel').count(), 0);
    await tapPoint('P3'); assert.equal(await visible('#mapCard'), true);
    await tapMap(0, 10);                                                   // un toque en el mapa la cierra y no crea nada
    assert.equal(await visible('#mapCard'), false);
    assert.equal((await pts()).length, 3);
    await tapPoint('P3'); await act('mapCardClose');
    assert.equal(await visible('#mapCard'), false);
  });

  await step('Tarjeta del punto: con GPS dice a qué distancia y hacia dónde queda, y lo une con la posición; «Ir al punto», «Abrir ficha» y «Mover»', async () => {
    await seed();
    await tab('puntos'); await act('gpsOn'); await gpsPush({ lat: 4.6000, lon: -74.0785, alt: 2600, acc: 5 }); await openMap();
    const p3 = await tapPoint('P3');
    await page.waitForSelector('#mapCard:not([hidden])');
    assert.match(await text('#mapCardRel'), /^a (29\d|30\d) m de ti, hacia el norte$/);
    assert.equal((await info()).link, true, 'línea punteada desde la posición');
    await gpsPush({ lat: 4.6027, lon: -74.0800, alt: 2600, acc: 5 });      // la persona se mueve: la distancia se actualiza sola
    await page.waitForFunction(() => /hacia el este$/.test(document.querySelector('#mapCardRel').textContent));
    assert.match(await text('#mapCardRel'), /^a 16\d m de ti, hacia el este$/);
    await page.click('#mapCard [data-act="editPoint"]');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await sheetTitle(), /P3/);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await act('mapCardMove');
    assert.equal((await ui()).mode, 'move');
    await waitToast(/^Mantén pulsado P3 1 s y arrástralo\.$/);
    assert.equal(await page.locator('.mk-hit').count(), 3);
    await tab('puntos'); await act('gpsOff');
  });

  await step('«+» en la mitad de un lado (con «Posición manual»): inserta un punto entre los dos y «Deshacer» lo quita', async () => {
    await seed();
    await pickMode('move');
    let i = await waitInfo((x) => x.mode === 'move' && x.sides.length === 3, 'posición manual');
    assert.ok(i.sides.every((s) => s.plus === true), JSON.stringify(i.sides));
    assert.equal(await page.locator('.mk-side:not(.plus-off) .mk-plus').count(), 3);
    const pb = await box('.mk-plus');
    assert.ok(pb.width >= 26 && pb.height >= 26);
    await shot('152-insertar-punto');
    const a = (await pts())[0], b = (await pts())[1], m = await xyOf((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
    const antes = await pts();
    await page.mouse.click(m.x, m.y);
    // el nuevo toma el número que sigue (P2) y los demás suben uno: los nombres siguen el recorrido y la forma no cambia (2.17.2)
    await waitToast(/^P2 insertado entre P1 y P2 \(sin altitud\)\. Los que siguen subieron un número \(P2 ahora es P3\)\.Deshacer$/);
    assert.deepEqual(await names(), ['P1', 'P2', 'P3', 'P4']);
    const despues = await pts();
    assert.deepEqual([despues[0], despues[2], despues[3]].map((q) => [q.id, q.lat, q.lon]), antes.map((q) => [q.id, q.lat, q.lon]), 'los puntos de antes siguen en su sitio, solo cambió el nombre');
    assert.equal((await c.state()).projects[0].nextPoint, 5);
    const p4 = (await pts())[1];
    near(p4.lat, 4.6, 1e-9, 'lat'); near(p4.lon, -74.0785, 1e-9, 'lon');
    assert.equal(p4.src, 'manual'); assert.ok(p4.alt == null, 'sin altitud');
    assert.equal((await info()).sides.length, 4);
    assert.match(await text('#mapSum'), /· 4 puntos$/);
    await undo();
    assert.deepEqual(await names(), ['P1', 'P2', 'P3']);
    assert.deepEqual((await pts()).map((q) => q.id), antes.map((q) => q.id), 'al deshacer, cada punto recupera su nombre');
    // el último lado (de P3 a P1) inserta al final de la lista
    const c3 = (await pts())[2], m2 = await xyOf((c3.lat + a.lat) / 2, (c3.lon + a.lon) / 2);
    await page.mouse.click(m2.x, m2.y);
    await waitToast(/^P4 insertado entre P3 y P1/);
    assert.deepEqual(await names(), ['P1', 'P2', 'P3', 'P4']);
    // de lejos el «+» se quita: no se inserta nada por accidente
    await zoomOut(3);
    assert.equal(await page.locator('.mk-side:not(.plus-off) .mk-plus').count(), 0);
  });

  await step('Capas en un botón: el panel trae las tres capas, un toque en el mapa lo cierra y con «Ingresar puntos» ese toque no crea nada', async () => {
    await seed();
    assert.equal(await visible('#mapLayersPanel'), false);
    assert.equal(await page.locator('.maprow').count(), 0, 'ya no hay fila de capas fuera del mapa');
    await act('mapLayers');
    assert.equal(await visible('#mapLayersPanel'), true);
    assert.equal(await page.getAttribute('[data-act="mapLayers"]', 'aria-expanded'), 'true');
    assert.deepEqual(await page.$$eval('#mapLayersPanel button', (b) => b.map((x) => x.textContent + '|' + x.getAttribute('aria-pressed'))), ['Calles|true', 'Satélite|false', 'Topográfico|false']);
    await shot('153-capas');
    await page.click('[data-act="mapBase"][data-b="satelite"]');
    await waitInfo((x) => x.base === 'satelite', 'satélite');
    assert.equal(await visible('#mapLayersPanel'), true, 'sigue abierto para poder activar los nombres');
    assert.equal(await page.locator('#mapLayersPanel [data-act="mapRef"]').count(), 1);
    await tapMap(0, 130);
    assert.equal(await visible('#mapLayersPanel'), false);
    await act('mapLayers');                                                // el menú ⋮ y las capas no se abren a la vez
    await page.click('.mapkebab');
    assert.equal(await visible('#mapLayersPanel'), false);
    assert.equal(await visible('#mapMenuPanel'), true);
    await page.click('#mapMenuPanel input[data-mode="add"]');
    await act('mapLayers');
    await tapMap(0, 130);
    assert.equal(await visible('#mapLayersPanel'), false);
    assert.equal((await pts()).length, 3, 'el toque solo cerró el panel');
    await act('mapLayers'); await page.click('[data-act="mapBase"][data-b="calles"]'); await act('mapLayers');
  });

  await step('«Ver todo el terreno» vuelve a encuadrarlo desde cualquier lugar; sin nada que mostrar, lo dice', async () => {
    await seed();
    const antes = await info();
    await page.evaluate(() => window.__app.ui.map.flyTo(5.5, -73.0, 9));
    await waitInfo((x) => Math.abs(x.center.lat - 5.5) < 1e-3, 'lejos');
    await act('mapFit');
    const i = await waitInfo((x) => x.zoom === antes.zoom && Math.abs(x.center.lat - antes.center.lat) < 1e-4, 'encuadrado otra vez');
    near(i.center.lon, antes.center.lon, 1e-4, 'lon');
    await fresh(); await openMap();
    await act('mapFit');
    await waitToast(/^Todavía no hay puntos ni capas que mostrar\.$/);
  });

  await step('Pantalla completa: el mapa tapa el encabezado y las pestañas; se sale con el mismo botón o con «Atrás»', async () => {
    await seed();
    const vp = page.viewportSize();
    await act('mapFull');
    let b = await box('.mapbox');
    assert.deepEqual([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], [0, 0, vp.width, vp.height]);
    assert.equal(await pressed('[data-act="mapFull"]'), 'true');
    const tapado = await page.evaluate(() => { const hit = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('.mapbox'); }; return [hit('header'), hit('nav')]; });
    assert.deepEqual(tapado, [true, true]);
    const i = await info();
    assert.ok(i.markers.length === 3);
    await shot('154-pantalla-completa');
    await tapPoint('P1');                                                  // todo sigue funcionando a pantalla completa
    assert.equal(await visible('#mapCard'), true);
    await act('mapCardClose');
    await act('mapMore');                                                  // una ventana sale encima del mapa, y «Atrás» cierra primero la ventana
    await page.waitForSelector('#sheet:not([hidden])');
    await page.goBack(); await waitSheetClosed();
    assert.equal((await ui()).full, true);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.mapbox').classList.contains('full'));
    b = await box('.mapbox');
    assert.ok(b.y > 100 && b.height < vp.height - 150, 'vuelve a su sitio');
    assert.equal(await pressed('[data-act="mapFull"]'), 'false');
    await act('mapFull'); assert.equal((await ui()).full, true);
    await act('mapFull');
    await page.waitForFunction(() => !document.querySelector('.mapbox').classList.contains('full'));
    assert.equal((await ui()).full, false);
    assert.equal(await page.evaluate(() => !!(history.state && history.state.mapfull)), false);
  });

  await step('Medir: dos toques dan metros y rumbo sin crear puntos; los siguientes suman tramos; «Cerrar figura» da el área; tocar un punto mide desde él', async () => {
    await seed();
    await act('mapMeasure');
    assert.equal((await ui()).tool, 'medir');
    assert.equal(await visible('.maptools'), false, 'la franja de la herramienta ocupa el lugar de la barra');
    assert.equal(await text('#mapMeasureTxt'), 'Medir: toca lugares del mapa (o puntos) para sumar tramos.');
    assert.deepEqual(await page.$$eval('#mapToolBar .btn', (b) => b.map((x) => x.textContent + '|' + x.disabled)), ['Quitar último|true', 'Cerrar figura|true', 'Terminar|false']);
    // 2.23.2: los toques van 40 px arriba del centro, donde no hay nombres de puntos (el terreno quedó más abajo en el mapa)
    await tapMap(-60, -40);
    assert.equal(await text('#mapMeasureTxt'), 'Medir: toca el siguiente lugar.');
    await tapMap(60, -40);
    assert.match(await text('#mapMeasureTxt'), /^\d+ m · rumbo 90° \(este\)$/);
    const i = await info();
    assert.equal(i.measure, 2);
    const esperado = 120 * 40075016.686 * Math.cos(4.6 * Math.PI / 180) / (256 * Math.pow(2, i.zoom));   // 120 px a ese zoom
    near(parseFloat(await text('#mapMeasureTxt')), esperado, 2, 'distancia');
    assert.equal((await pts()).length, 3, 'medir no crea puntos');
    await shot('155-medir');
    assert.equal(await page.isDisabled('[data-act="mapMeasureClose"]'), true, 'con dos lugares no hay figura que cerrar');
    await tapMap(60, 20);                                                  // el tercer toque suma un tramo (60 px hacia abajo)
    assert.equal((await ui()).measure.length, 3);
    const mpp = esperado / 120;                                            // metros por píxel
    let t = await text('#mapMeasureTxt');
    assert.match(t, /^\d+ m en 2 tramos$/);
    near(parseFloat(t), 180 * mpp, 3, 'suma de los dos tramos');
    await act('mapMeasureClose');                                          // cerrar: un triángulo rectángulo de 120 × 60 px
    t = await text('#mapMeasureTxt');
    assert.match(t, /^Área [\d,]+ ha · perímetro \d+ m$/);
    near(parseFloat(t.replace('Área ', '').replace(',', '.')) * 10000, 0.5 * 120 * 60 * mpp * mpp, 0.02 * 0.5 * 120 * 60 * mpp * mpp, 'área del triángulo');
    near(parseFloat(t.split('perímetro ')[1]), (120 + 60 + Math.hypot(120, 60)) * mpp, 4, 'perímetro');
    assert.equal((await info()).measureClosed, true);
    assert.equal(await page.getAttribute('[data-act="mapMeasureClose"]', 'aria-pressed'), 'true');
    assert.equal(await text('[data-act="mapMeasureClose"]'), 'Abrir figura');
    await shot('162-medir-area');
    await act('mapMeasureClose');                                          // abrir de nuevo
    assert.match(await text('#mapMeasureTxt'), /^\d+ m en 2 tramos$/);
    assert.equal((await info()).measureClosed, false);
    await act('mapMeasureClose'); await act('mapMeasureBack');             // con menos de 3 lugares deja de estar cerrada
    assert.equal((await ui()).measure.length, 2); assert.equal((await info()).measureClosed, false);
    assert.match(await text('#mapMeasureTxt'), /rumbo 90° \(este\)$/);
    const p2 = await tapPoint('P2');                                       // sobre un punto: se toma su coordenada exacta
    const m = (await ui()).measure;
    assert.equal(m.length, 3); assert.equal(m[2].lat, p2.lat); assert.equal(m[2].lon, p2.lon);
    assert.equal((await info()).measureClosed, false, 'al volver a tener 3 lugares no se cierra sola');
    assert.match(await text('#mapMeasureTxt'), / en 2 tramos$/);
    assert.equal(await text('[data-act="mapMeasureClose"]'), 'Cerrar figura');
    assert.equal(await visible('#mapCard'), false, 'midiendo no se abre la tarjeta');
    assert.equal((await pts()).length, 3, 'medir no crea puntos');
    await act('mapMeasureBack'); await act('mapMeasureBack'); await act('mapMeasureBack');
    assert.equal((await ui()).measure.length, 0); assert.equal((await info()).measure, 0);
    assert.equal(await page.isDisabled('[data-act="mapMeasureBack"]'), true);
    await tapMap(-40, 0); await tapMap(40, 0);
    await act('mapToolEnd');
    assert.equal((await ui()).tool, ''); assert.equal((await info()).measure, 0);
    assert.equal(await visible('.maptools'), true);
    await act('mapMeasure'); await pickMode('add');                        // elegir un modo del menú ⋮ suelta la herramienta
    assert.deepEqual([(await ui()).tool, (await ui()).mode], ['', 'add']);
    await act('mapMeasure');                                               // y al revés
    assert.deepEqual([(await ui()).tool, (await ui()).mode], ['medir', '']);
    await act('mapToolEnd');
  });

  await step('Agregar con mira: la cruz queda en el centro, se mueve el mapa y «Agregar aquí» crea el punto justo ahí', async () => {
    await seed();
    await act('mapMore');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Más opciones del mapa');
    await act('mapAim'); await waitSheetClosed();
    assert.equal((await ui()).tool, 'mira');
    assert.equal(await visible('.mapcross'), true);
    const cb = await box('.mapcross'), mb = await box('#mapHost .mapa-leaflet');
    near(cb.x + cb.width / 2, mb.x + mb.width / 2, 1.5, 'cruz centrada (x)'); near(cb.y + cb.height / 2, mb.y + mb.height / 2, 1.5, 'cruz centrada (y)');
    let i = await info();
    assert.equal(await text('#mapAimLL'), i.center.lat.toFixed(5) + ', ' + i.center.lon.toFixed(5));
    // mover el mapa cambia las coordenadas de la mira
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down();
    await page.mouse.move(mb.x + mb.width / 2 - 70, mb.y + mb.height / 2 - 50, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(400);
    i = await info();
    assert.equal(await text('#mapAimLL'), i.center.lat.toFixed(5) + ', ' + i.center.lon.toFixed(5));
    assert.equal((await pts()).length, 3, 'arrastrar no crea nada');
    await shot('156-mira');
    await act('mapAimAdd');
    await waitToast(/^P4 creado \(sin altitud\)\.Deshacer$/);
    const p4 = (await pts())[3];
    near(p4.lat, i.center.lat, 1e-9, 'lat'); near(p4.lon, i.center.lon, 1e-9, 'lon');
    assert.equal((await ui()).tool, 'mira', 'sigue lista para otro punto');
    assert.equal(await visible('.mapcross'), true);
    await undo();
    assert.equal((await pts()).length, 3);
    await act('mapToolEnd');
    assert.equal(await visible('.mapcross'), false);
    assert.equal(await visible('.maptools'), true);
  });

  await step('Caminar el lindero: el GPS deja un punto cada 10 m, espera si la señal es mala, el mapa sigue a la persona y «Deshacer» quita todo el recorrido', async () => {
    await fresh(); await openMap();
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    assert.deepEqual(await page.$$eval('#trackStep option', (o) => o.map((x) => x.value + (x.selected ? '*' : ''))), ['5', '10*', '20', '50']);
    await act('mapWalk'); await waitSheetClosed();
    let u = await ui();
    assert.equal(u.gpsOn, true, 'enciende el GPS'); assert.equal(u.tool, 'caminar'); assert.equal(u.follow, true);
    assert.deepEqual(u.track, { n: 0, last: 'none', step: 10 });
    assert.equal(await text('#mapTrackTxt'), 'Caminando el lindero: 0 puntos · uno cada 10 m · esperando la primera lectura del GPS');
    await waitToast(/^Camina por el borde del terreno/);
    const m = 1 / 111195;                                                  // un metro en grados de latitud
    await gpsPush({ lat: 4.6, lon: -74.08, alt: 2600, acc: 4 });
    assert.equal((await pts()).length, 1, 'la primera lectura buena deja el primer punto');
    assert.match(await text('#mapTrackTxt'), /^Caminando el lindero: 1 punto · uno cada 10 m · GPS ±4 m$/);
    await gpsPush({ lat: 4.6 + 6 * m, lon: -74.08, alt: 2601, acc: 4 });
    assert.equal((await pts()).length, 1, 'a 6 m todavía no');
    await gpsPush({ lat: 4.6 + 11 * m, lon: -74.08, alt: 2602, acc: 4 });
    assert.equal((await pts()).length, 2);
    await gpsPush({ lat: 4.6 + 40 * m, lon: -74.08, alt: 2603, acc: 45 });
    assert.equal((await pts()).length, 2, 'una lectura de ±45 m no se usa');
    assert.match(await text('#mapTrackTxt'), /esperando mejor señal del GPS · GPS ±45 m$/);
    await gpsPush({ lat: 4.6 + 22 * m, lon: -74.08, alt: 2604, acc: 6 });
    let p = await pts();
    assert.equal(p.length, 3);
    assert.deepEqual(p.map((q) => q.name), ['P1', 'P2', 'P3']);
    assert.deepEqual(p.map((q) => [q.src, q.alt, q.acc]), [['gps', 2600, 4], ['gps', 2602, 4], ['gps', 2604, 6]]);
    const i = await waitInfo((x) => Math.abs(x.center.lat - (4.6 + 22 * m)) < 1e-5, 'el mapa sigue a la persona');
    assert.equal(i.markers.length, 3);
    assert.match(await text('#mapSum'), /· 3 puntos$/);
    await shot('157-caminar-lindero');
    await tab('puntos');                                                   // en otra pestaña el recorrido sigue
    await gpsPush({ lat: 4.6 + 35 * m, lon: -74.08, alt: 2605, acc: 6 });
    assert.equal((await pts()).length, 4);
    assert.equal(await page.locator('#tab-puntos .prow, #tab-puntos [data-act="editPoint"]').count() > 0, true);
    await openMap();
    assert.equal((await ui()).tool, 'caminar');
    assert.equal(await visible('#mapToolBar'), true);
    await act('mapToolEnd');
    await waitToast(/^Recorrido terminado: 4 puntos\.Deshacer$/);
    u = await ui();
    assert.equal(u.tool, ''); assert.equal(u.track, null); assert.equal(u.gpsOn, true, 'el GPS queda encendido');
    await gpsPush({ lat: 4.6 + 60 * m, lon: -74.08, alt: 2606, acc: 6 });
    assert.equal((await pts()).length, 4, 'terminado, ya no deja puntos');
    await undo();
    assert.equal((await pts()).length, 0);
    assert.equal((await proj()).nextPoint, 1, 'y la numeración vuelve a empezar');
  });

  await step('Caminar el lindero: apagar el GPS cierra el recorrido; sin ninguna lectura útil lo dice; otro paso entre puntos', async () => {
    await fresh(); await openMap();
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    await page.selectOption('#trackStep', '20');
    await act('mapWalk'); await waitSheetClosed();
    assert.equal((await ui()).track.step, 20);
    const m = 1 / 111195;
    await gpsPush({ lat: 4.6, lon: -74.08, alt: 2600, acc: 4 });
    await gpsPush({ lat: 4.6 + 15 * m, lon: -74.08, alt: 2600, acc: 4 });
    assert.equal((await pts()).length, 1, 'a 15 m todavía no, con un punto cada 20 m');
    await gpsPush({ lat: 4.6 + 21 * m, lon: -74.08, alt: 2600, acc: 4 });
    assert.equal((await pts()).length, 2);
    await tab('puntos'); await act('gpsOff');
    await waitToast(/^Recorrido terminado: 2 puntos\.Deshacer$/);
    assert.equal((await ui()).track, null); assert.equal((await ui()).tool, '');
    await openMap();
    assert.equal(await visible('.maptools'), true);
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])'); await act('mapWalk'); await waitSheetClosed();
    await act('mapToolEnd');
    await waitToast(/^Recorrido terminado sin puntos/);
    assert.equal((await pts()).length, 2);
    await tab('puntos'); await act('gpsOff');
  });

  await step('Orden del recorrido: cada punto lleva su número; «Antes» y «Después» en la tarjeta lo cambian a mano y «Ordenar los puntos» los acomoda solos', async () => {
    // cuatro esquinas de un cuadro, guardadas cruzadas: P1 y P2 abajo, P3 arriba a la izquierda y P4 arriba a la derecha (los lados se cruzan)
    await fresh();
    for (const p of ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0800', '4.6027, -74.0770']) await addPointManual(p, 2600);
    await openMap(); await waitInfo((x) => x.markers.length === 4 && x.zoom >= 15, 'cuadro'); await page.waitForTimeout(300);
    assert.deepEqual((await info()).markers.map((m) => m.order), [1, 2, 3, 4]);
    assert.deepEqual(await page.$$eval('.mk-dot', (d) => d.map((x) => x.textContent)), ['1', '2', '3', '4']);
    assert.equal((await info()).polygon.bad, true, 'guardados así, los lados se cruzan');
    const p3 = await tapPoint('P3');
    await page.waitForSelector('#mapCard:not([hidden])');
    assert.equal(await text('#mapCardOrder'), '3 de 4');
    // la casilla «Orden» viene desmarcada: las flechas no hacen nada hasta marcarla (2.17.2)
    assert.equal(await page.isChecked('#mapOrderOn'), false);
    assert.deepEqual(await page.$$eval('[data-act="mapCardOrder"]', (b) => b.map((x) => x.disabled)), [true, true]);
    const antesOrden = (await c.state()).projects[0].points.map((q) => q.name).join(' ');
    await page.evaluate(() => document.querySelector('[data-act="mapCardOrder"][data-d="1"]').click());
    assert.equal((await c.state()).projects[0].points.map((q) => q.name).join(' '), antesOrden, 'sin la casilla, el orden no cambia');
    await page.check('#mapOrderOn');
    assert.equal(await page.isChecked('#mapOrderOn'), true, 'la casilla sigue marcada al redibujar la tarjeta');
    assert.deepEqual(await page.$$eval('[data-act="mapCardOrder"]', (b) => b.map((x) => x.textContent + '|' + x.disabled)), ['◀|false', '▶|false']);
    await shot('159-orden-de-los-puntos');
    await page.click('[data-act="mapCardOrder"][data-d="1"]');            // P3 pasa al final: P1 P2 P4 P3, que sí sigue el borde
    assert.deepEqual(await names(), ['P1', 'P2', 'P4', 'P3']);
    assert.equal(await text('#mapCardOrder'), '4 de 4');
    assert.equal(await page.isDisabled('[data-act="mapCardOrder"][data-d="1"]'), true, 'el último no puede ir después');
    assert.equal((await ui()).sel, p3.id, 'la tarjeta sigue en el mismo punto');
    assert.equal((await info()).selected, p3.id);
    let i = await info();
    assert.equal(i.polygon.bad, false, 'ya no se cruzan');
    assert.deepEqual(i.markers.map((m) => m.label.split(' ')[0] + ':' + m.order), ['P1:1', 'P2:2', 'P4:3', 'P3:4']);
    await page.click('[data-act="mapCardOrder"][data-d="-1"]'); await page.click('[data-act="mapCardOrder"][data-d="-1"]'); await page.click('[data-act="mapCardOrder"][data-d="-1"]');
    assert.deepEqual(await names(), ['P3', 'P1', 'P2', 'P4']);
    assert.equal(await page.isDisabled('[data-act="mapCardOrder"][data-d="-1"]'), true, 'el primero no puede ir antes');
    assert.equal(await text('#mapCardOrder'), '1 de 4');
    await page.click('[data-act="mapCardOrder"][data-d="1"]');            // P1 P3 P2 P4: otra vez cruzados
    assert.equal(await text('#mapCardOrder'), '2 de 4');
    await page.reload(); await page.waitForSelector('#tab-puntos');       // el orden queda guardado
    assert.deepEqual(await names(), ['P1', 'P3', 'P2', 'P4']);
    await openMap(); await waitInfo((x) => x.markers.length === 4, 'cuadro');
    // ordenar solos, desde «Más opciones»
    assert.equal((await info()).polygon.bad, true);
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    await act('mapReorder'); await waitSheetClosed();
    await waitToast(/^Puntos reordenados\.Deshacer$/);
    assert.equal((await info()).polygon.bad, false, 'ordenados alrededor del centro no se cruzan');
    assert.deepEqual((await names()).slice().sort(), ['P1', 'P2', 'P3', 'P4']);
    await undo();
    assert.deepEqual(await names(), ['P1', 'P3', 'P2', 'P4']);
    // con menos de 3 puntos no hay nada que ordenar
    await fresh(); await addPointManual('4.6, -74.08', 2600); await openMap();
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    await act('mapReorder'); await waitSheetClosed();
    await waitToast(/^Hacen falta al menos 3 puntos para ordenarlos\.$/);
  });

  await step('«Ir al punto» con el GPS encendido guía hasta él: distancia, rumbo y flecha con cada lectura, y avisa al llegar', async () => {
    await seed();
    await tab('puntos'); await act('gpsOn'); await gpsPush({ lat: 4.6000, lon: -74.0785, alt: 2600, acc: 5 }); await openMap();
    const p3 = await tapPoint('P3');
    await page.waitForSelector('#mapCard:not([hidden])');
    await act('mapCardGo');
    let u = await ui();
    assert.equal(u.tool, 'ir'); assert.equal(u.sel, null);
    assert.equal(await visible('#mapCard'), false, 'la tarjeta deja su lugar a la guía');
    assert.equal(await visible('.maptools'), false);
    assert.match(await text('#mapNavTxt'), /^P3: a (29\d|30\d) m, hacia el norte$/);
    assert.equal(await page.getAttribute('.navarrow', 'style'), 'transform:rotate(0deg)');
    let i = await info();
    assert.equal(i.selected, p3.id, 'el punto sigue marcado'); assert.equal(i.link, true, 'y unido con la posición');
    await shot('160-ir-al-punto');
    await gpsPush({ lat: 4.6027, lon: -74.0800, alt: 2600, acc: 5 });      // la persona camina: ahora el punto queda al este
    await page.waitForFunction(() => /hacia el este$/.test(document.querySelector('#mapNavTxt').textContent));
    assert.match(await text('#mapNavTxt'), /^P3: a 16\d m, hacia el este$/);
    assert.equal(await page.getAttribute('.navarrow', 'style'), 'transform:rotate(90deg)');
    await page.evaluate(() => window.__app.ui.map.flyTo(5.5, -73, 9));     // «Ver los dos» vuelve a encuadrar a la persona y al punto
    await waitInfo((x) => Math.abs(x.center.lat - 5.5) < 1e-3, 'lejos');
    await act('mapNavFit');
    i = await waitInfo((x) => Math.abs(x.center.lat - 4.6027) < 2e-3 && x.zoom >= 15, 'los dos a la vista');
    await gpsPush({ lat: 4.6027 + 3 / 111195, lon: -74.0785, alt: 2600, acc: 5 });
    await page.waitForFunction(() => /^Llegaste/.test(document.querySelector('#mapNavTxt').textContent));
    assert.equal(await text('#mapNavTxt'), 'Llegaste a P3 (a 3 m).');
    assert.equal(await page.locator('.navarrow.arrived').count(), 1);
    await act('mapToolEnd');
    u = await ui();
    assert.equal(u.tool, ''); assert.equal((await info()).selected, null);
    assert.equal(await visible('.maptools'), true);
    // apagar el GPS termina la guía
    await act('mapFit'); await page.waitForTimeout(500);                  // el terreno completo otra vez a la vista
    await tapPoint('P1'); await page.waitForSelector('#mapCard:not([hidden])'); await act('mapCardGo');
    assert.equal((await ui()).tool, 'ir');
    await tab('puntos'); await act('gpsOff'); await openMap();
    assert.equal((await ui()).tool, '');
    // quedarse sin permiso de ubicación estando en el mapa también la termina
    await tab('puntos'); await act('gpsOn'); await gpsPush({ lat: 4.6000, lon: -74.0785, alt: 2600, acc: 5 }); await openMap();
    await act('mapFit'); await page.waitForTimeout(500);
    await tapPoint('P1'); await page.waitForSelector('#mapCard:not([hidden])'); await act('mapCardGo');
    assert.equal((await ui()).tool, 'ir');
    await page.evaluate(() => window.__gps.error(1, 'denegado'));
    await page.waitForSelector('#sheet:not([hidden])');                    // «¿Usar sin GPS?»
    assert.deepEqual([(await ui()).tool, (await ui()).gpsOn], ['', false]);
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
    assert.equal(await visible('.maptools'), true);
    // sin GPS, «Ir al punto» solo centra el mapa y dice cómo activar la guía
    await act('mapFit'); await page.waitForTimeout(500);
    const p2 = await tapPoint('P2'); await page.waitForSelector('#mapCard:not([hidden])'); await act('mapCardGo');
    await waitToast(/^Mapa centrado en P2\. Enciende el GPS para que te guíe hasta él\.$/);
    i = await waitInfo((x) => Math.abs(x.center.lat - p2.lat) < 1e-5 && x.zoom >= 18, 'centrado en P2');
    near(i.center.lon, p2.lon, 1e-5, 'lon');
    assert.equal((await ui()).tool, ''); assert.equal(await visible('#mapCard'), true, 'la tarjeta sigue abierta');
  });

  await step('Eliminar desde la tarjeta del punto: pide confirmación, quita el punto, cierra la tarjeta y se puede deshacer', async () => {
    await seed();
    const p2 = await tapPoint('P2');
    await page.waitForSelector('#mapCard:not([hidden])');
    assert.equal(await page.getAttribute('.mapcard-del', 'aria-label'), 'Eliminar P2');
    const db = await box('.mapcard-del'); assert.ok(db.width >= 44 && db.height >= 44);
    await page.click('.mapcard-del');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), '¿Eliminar P2?');
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();   // «Conservar»: no pasa nada
    assert.deepEqual(await names(), ['P1', 'P2', 'P3']);
    assert.equal(await visible('#mapCard'), true);
    await page.click('.mapcard-del'); await page.waitForSelector('#sheet:not([hidden])');
    await page.click('#sheet [data-act="doDelete"]'); await waitSheetClosed();
    await waitToast(/^P2 eliminado\.Deshacer$/);
    assert.deepEqual(await names(), ['P1', 'P3']);
    assert.equal(await visible('#mapCard'), false, 'la tarjeta se cierra sola');
    assert.equal((await ui()).sel, null);
    assert.match(await text('#mapSum'), /· 2 puntos · falta 1$/);
    await undo();
    assert.deepEqual(await names(), ['P1', 'P2', 'P3']);
    assert.equal((await pts())[1].id, p2.id, 'vuelve a su puesto');
  });

  await step('Lados cruzados: el resumen lo avisa en vez de dar un área que no sirve, y al tocarlo ordena los puntos', async () => {
    await fresh();
    for (const p of ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0800', '4.6027, -74.0770']) await addPointManual(p, 2600);
    await openMap(); await waitInfo((x) => x.markers.length === 4 && x.zoom >= 15, 'cuadro'); await page.waitForTimeout(300);
    assert.equal(await text('#mapSum'), 'Los lados se cruzan · toca para ordenar');
    assert.equal(await page.locator('#mapSum.crossed').count(), 1);
    assert.ok((await box('#mapSum')).height >= 44, 'se puede tocar con el dedo');
    await shot('161-lados-cruzados');
    await page.click('#mapSum');
    await waitToast(/^Puntos reordenados\.Deshacer$/);
    assert.equal((await info()).polygon.bad, false);
    assert.match(await text('#mapSum'), /^\d+,\d+ ha · [\d,]+ k?m · 4 puntos$/);
    assert.equal(await page.locator('#mapSum.crossed').count(), 0);
    const antes = await names();
    await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 8000 });
    await page.evaluate(() => document.querySelector('#mapSum').click());  // sin cruce, activar el resumen (por teclado, por ejemplo) no hace nada
    assert.deepEqual(await names(), antes);
    assert.equal(await toastText(), '', 'ni reordena ni avisa');
  });

  await step('El rótulo de un lado no tapa el nombre de un punto: se pasa al otro costado de la línea o se oculta', async () => {
    await seed();
    const pisa = () => page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const marks = [...document.querySelectorAll('.mk-lab, .mk-dot')].map(r).filter((b) => b.width > 0);
      return [...document.querySelectorAll('.mk-side:not(.side-off) .mk-len')].map(r).filter((l) => marks.some((m) => hit(l, m))).length;
    });
    assert.equal(await pisa(), 0, 'con el terreno encuadrado');
    // un punto nuevo muy cerca de la mitad del lado de abajo: su nombre cae justo donde iba el rótulo de ese lado
    await tab('puntos'); await addPointManual('4.60003, -74.07885', 2600); await openMap();
    await waitInfo((x) => x.markers.length === 4, 'cuatro puntos'); await page.waitForTimeout(300);
    assert.equal(await pisa(), 0, 'ningún rótulo visible pisa un nombre');
    const i = await info();
    assert.ok(i.sides.some((s) => s.alt || !s.label), 'al menos un rótulo se corrió o se ocultó: ' + JSON.stringify(i.sides));
    for (let k = 0; k < 2; k++) { await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(500); }
    assert.equal(await pisa(), 0, 'tampoco al acercar');
    await pickMode('move');
    await page.waitForTimeout(200);
    assert.equal(await pisa(), 0, 'ni con «Posición manual»');
  });

  await step('Botón fijo de deshacer: vuelve paso a paso sobre crear, insertar, mover, ordenar y eliminar, aunque el aviso «Deshacer» ya no esté', async () => {
    await seed();
    const estado = async () => (await pts()).map((p) => p.name + '@' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5)).join(' ');
    const label = () => page.getAttribute('#mapUndoBtn', 'aria-label');
    const inicial = await estado();
    assert.equal(await page.isDisabled('#mapUndoBtn'), true, 'sin cambios no hay nada que deshacer');
    assert.equal(await label(), 'Deshacer (no hay cambios que deshacer)');
    const ub = await box('#mapUndoBtn'); assert.ok(ub.width >= 44 && ub.height >= 44);
    // 1) insertar con el «+»   2) ordenar con la flecha   3) eliminar   4) crear con «Ingresar puntos»
    await pickMode('move');
    const a = (await pts())[0], b = (await pts())[1], mid = await xyOf((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
    await page.mouse.click(mid.x, mid.y);
    await waitToast(/^P2 insertado entre P1 y P2/);
    const e1 = await estado();
    assert.equal(await page.isDisabled('#mapUndoBtn'), false);
    assert.equal(await label(), 'Deshacer: insertar un punto');
    await page.click('#mapMode [data-act="mapMode"]');                    // salir de «Posición manual»
    await tapPoint('P3'); await page.waitForSelector('#mapCard:not([hidden])');
    if (!(await page.isChecked('#mapOrderOn'))) await page.check('#mapOrderOn');
    await page.click('[data-act="mapCardOrder"][data-d="-1"]');
    const e2 = await estado();
    assert.equal(await label(), 'Deshacer: cambiar el orden de P3');
    await page.click('.mapcard-del'); await page.waitForSelector('#sheet:not([hidden])');
    await page.click('#sheet [data-act="doDelete"]'); await waitSheetClosed();
    const e3 = await estado();
    assert.equal(await label(), 'Deshacer: eliminar P3');
    await pickMode('add'); await tapMap(0, 150);
    await waitToast(/^P5 creado/);
    assert.equal(await label(), 'Deshacer: crear un punto');
    await page.click('#mapMode [data-act="mapMode"]');
    await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 9000 });   // el aviso con «Deshacer» ya se fue
    await shot('163-boton-deshacer');
    // hacia atrás, un paso por toque
    await act('mapUndo'); await waitToast(/^Se deshizo: crear un punto\.$/);
    assert.equal(await estado(), e3); assert.equal((await proj()).nextPoint, 5, 'la numeración también vuelve');
    await act('mapUndo'); await waitToast(/^Se deshizo: eliminar P3\.$/);
    assert.equal(await estado(), e2);
    await act('mapUndo'); await waitToast(/^Se deshizo: cambiar el orden de P3\.$/);
    assert.equal(await estado(), e1);
    await act('mapUndo'); await waitToast(/^Se deshizo: insertar un punto\.$/);
    assert.equal(await estado(), inicial); assert.equal((await proj()).nextPoint, 4);
    assert.equal(await page.isDisabled('#mapUndoBtn'), true);
    assert.equal((await info()).markers.length, 3, 'el mapa se redibuja');
    // si ya se deshizo desde el aviso, el botón no repite ese paso
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])'); await act('mapAim'); await waitSheetClosed();
    await act('mapAimAdd'); await waitToast(/^P4 creado/);
    assert.equal(await page.isDisabled('#mapUndoBtn'), false);
    await undo();                                                          // «Deshacer» del aviso
    assert.equal(await estado(), inicial);
    assert.equal(await page.isDisabled('#mapUndoBtn'), true, 'ya no queda nada que deshacer');
    await act('mapToolEnd');
    // mover un punto (mantenerlo pulsado con «Posición manual») también se deshace con el botón
    await pickMode('move');
    const q = (await pts())[1], qxy = await xyOf(q.lat, q.lon);
    await page.mouse.move(qxy.x, qxy.y); await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.move(qxy.x + 40, qxy.y + 30, { steps: 6 }); await page.mouse.up();
    await waitToast(/^P2 movido\./);
    assert.notEqual(await estado(), inicial);
    assert.equal(await label(), 'Deshacer: mover P2');
    await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 9000 });
    await act('mapUndo'); await waitToast(/^Se deshizo: mover P2\.$/);
    assert.equal(await estado(), inicial);
    const q2 = (await pts())[1];
    assert.deepEqual([q2.src, q2.alt], [q.src, q.alt], 'vuelve con sus datos de antes');
    await page.click('#mapMode [data-act="mapMode"]');
    // ordenar los puntos también se deshace con el botón
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])'); await act('mapReorder'); await waitSheetClosed();
    await waitToast(/^Puntos reordenados/);
    if ((await estado()) !== inicial) { assert.equal(await label(), 'Deshacer: ordenar los puntos'); await act('mapUndo'); assert.equal(await estado(), inicial); }
  });

  await step('Deshacer con el GPS: un punto marcado se deshace con el botón; caminando el lindero el botón espera y al terminar deshace el recorrido entero', async () => {
    await fresh(); await openMap();
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])'); await act('mapWalk'); await waitSheetClosed();
    const m = 1 / 111195;
    await gpsPush({ lat: 4.6, lon: -74.08, alt: 2600, acc: 4 });
    await gpsPush({ lat: 4.6 + 12 * m, lon: -74.08, alt: 2600, acc: 4 });
    await gpsPush({ lat: 4.6 + 24 * m, lon: -74.08, alt: 2600, acc: 4 });
    assert.equal((await pts()).length, 3);
    assert.equal(await page.isDisabled('#mapUndoBtn'), true, 'caminando no se deshace paso a paso');
    await act('mapToolEnd'); await waitToast(/^Recorrido terminado: 3 puntos/);
    assert.equal(await page.isDisabled('#mapUndoBtn'), false);
    assert.equal(await page.getAttribute('#mapUndoBtn', 'aria-label'), 'Deshacer: caminar el lindero');
    await act('mapUndo'); await waitToast(/^Se deshizo: caminar el lindero\.$/);
    assert.equal((await pts()).length, 0); assert.equal((await proj()).nextPoint, 1);
    assert.equal(await page.isDisabled('#mapUndoBtn'), true);
    await tab('puntos'); await act('gpsOff');
  });

  await step('Ayuda de primera vez: sale sola la primera vez que se abre el mapa, no vuelve a salir y se puede abrir desde «Más opciones»', async () => {
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('zvg.v1.flags', JSON.stringify({ appGuide: true })); });   // la ayuda general de la app se prueba en el recorrido 16
    await page.goto(url); await page.waitForSelector('#tab-puntos');
    await openMap();
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Cómo usar el mapa');
    assert.deepEqual(await page.$$eval('.guide dt', (d) => d.map((x) => x.textContent)), ['Toca un punto', 'Arriba', 'Botones de la izquierda', 'Mi posición', 'Marcar punto', 'Menú ⋮', 'Insertar entre dos', 'Cambiar el orden', 'Más opciones', '＋ Polígono', 'Elegir otro', 'Cómo se ven', 'Candado 🔒', 'Linderos compartidos', '＋ Lote y ＋ Predio', 'Ajustar a los linderos', 'Medir distancia']);
    await shot('158-ayuda-del-mapa');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags')).mapGuide), true);
    await tab('puntos'); await openMap();
    assert.equal(await sheetOpen(), false, 'la segunda vez no sale');
    await page.reload(); await page.waitForSelector('#tab-puntos'); await openMap();
    assert.equal(await sheetOpen(), false, 'ni al volver a abrir la app');
    await act('mapMore'); await page.waitForSelector('#sheet:not([hidden])');
    await act('mapGuide');
    assert.equal(await sheetTitle(), 'Cómo usar el mapa');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('Mapa nuevo: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

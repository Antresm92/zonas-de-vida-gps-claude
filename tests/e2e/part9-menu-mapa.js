'use strict';
/* Recorrido 9 — Polígono › Mapa › menú ⋮: casillas «Ingresar puntos» y «Posición manual» (solo una activa) y creación de puntos tocando el mapa.
 * Los mosaicos del mapa son de mentira (harness.mockTiles). Con el ratón se prueban los mismos eventos de puntero que manda un dedo. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, fill, tab, text, state, proj, toastText, waitToast, waitSheetClosed, addPointManual, errors, shot } = c;

  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const ui = () => page.evaluate(() => ({ mode: window.__app.ui.mapMode, menu: window.__app.ui.mapMenu }));
  const openMap = async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
  };
  const seed = async () => { await fresh(); for (const p of ['4.60, -74.08', '4.60, -74.07', '4.61, -74.075']) await addPointManual(p, 2600); await openMap(); };
  const box = (sel) => page.locator(sel).first().boundingBox();
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const checks = () => page.$$eval('#mapMenuPanel input[type="checkbox"]', (els) => els.map((e) => [e.getAttribute('data-mode'), e.checked]));
  const bannerText = async () => ((await visible('#mapMode')) ? await text('#mapModeTxt') : '');
  const openMenu = async () => { if (!(await visible('#mapMenuPanel'))) await page.click('.mapkebab'); await page.waitForSelector('#mapMenuPanel', { state: 'visible' }); };
  const pick = async (mode) => { await openMenu(); await page.click('#mapMenuPanel input[data-mode="' + mode + '"]'); };
  const hits = () => page.locator('.mk-hit').count();
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  // Mercator de Leaflet (mosaicos de 256 px): de un punto a píxeles del mundo y de vuelta, para saber dónde cae un toque
  const toWorld = (lat, lon, z) => { const k = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * k, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k }; };
  const fromWorld = (x, y, z) => { const k = 256 * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / k; return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: x / k * 360 - 180 }; };
  // Dónde está, en coordenadas, el punto de la pantalla que queda a (dx, dy) píxeles del centro del mapa
  const atOffset = (i, dx, dy) => { const m = toWorld(i.center.lat, i.center.lon, i.zoom); return fromWorld(m.x + dx, m.y + dy, i.zoom); };
  const centerXY = async () => { const b = await box('#mapHost .mapa-leaflet'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const tap = async (dx, dy) => { const o = await centerXY(); await page.mouse.click(o.x + dx, o.y + dy); return { x: o.x + dx, y: o.y + dy }; };
  const pts = async () => (await proj()).points;

  await step('Menú ⋮: tres puntos en vertical arriba a la izquierda del mapa; la lista trae dos casillas sin marcar y se cierra sola', async () => {
    await seed();
    const mb = await box('.mapbox'), kb = await box('.mapkebab');
    near(kb.x - mb.x, 10, 4, 'separación izquierda'); near(kb.y - mb.y, 10, 4, 'separación de arriba');
    assert.ok(kb.width >= 44 && kb.height >= 44, 'se puede tocar con el dedo: ' + kb.width + '×' + kb.height);
    const dots = await page.$$eval('.mapkebab svg circle', (els) => els.map((e) => [+e.getAttribute('cx'), +e.getAttribute('cy')]));
    assert.equal(dots.length, 3, 'tres puntos');
    assert.ok(dots.every((d) => d[0] === dots[0][0]) && dots[0][1] < dots[1][1] && dots[1][1] < dots[2][1], 'en vertical: ' + JSON.stringify(dots));
    assert.equal(await page.getAttribute('.mapkebab', 'aria-label'), 'Menú del mapa');
    assert.equal(await page.getAttribute('.mapkebab', 'aria-expanded'), 'false');
    // los botones + y − pasaron a la derecha
    const z = await box('.leaflet-control-zoom');
    assert.ok(z.x > mb.x + mb.width / 2 && z.x + z.width >= mb.x + mb.width - 20, 'zoom arriba a la derecha');
    assert.equal(await visible('#mapMenuPanel'), false, 'la lista empieza cerrada');
    await page.click('.mapkebab');
    assert.equal(await visible('#mapMenuPanel'), true);
    assert.equal(await page.getAttribute('.mapkebab', 'aria-expanded'), 'true');
    assert.deepEqual(await checks(), [['add', false], ['move', false]]);
    const labels = await page.$$eval('#mapMenuPanel .mapopt b', (els) => els.map((e) => e.textContent));
    assert.deepEqual(labels, ['Ingresar puntos', 'Posición manual']);
    for (const o of await page.$$('#mapMenuPanel .mapopt')) assert.ok((await o.boundingBox()).height >= 48, 'cada opción se toca bien');
    await shot('90-menu-mapa-abierto');
    await page.keyboard.press('Escape');
    assert.equal(await visible('#mapMenuPanel'), false, 'Escape cierra la lista');
    await page.click('.mapkebab'); await page.click('.mapkebab');
    assert.equal(await visible('#mapMenuPanel'), false, 'el botón alterna');
    assert.deepEqual(await ui(), { mode: '', menu: false });
    // un toque fuera de la lista también la cierra, sin hacer nada más
    const antes = (await pts()).length;
    await page.click('.mapkebab');
    await tap(60, -20);
    assert.equal(await visible('#mapMenuPanel'), false);
    assert.equal((await pts()).length, antes);
  });

  await step('Casillas: solo una activa a la vez; al elegir una la lista se cierra y un aviso dice qué modo está activo', async () => {
    await seed();
    await pick('add');
    assert.deepEqual(await ui(), { mode: 'add', menu: false });
    assert.equal(await visible('#mapMenuPanel'), false);
    assert.equal(await bannerText(), 'Ingresar puntos: toca el mapa.');
    assert.equal(await page.evaluate(() => document.querySelector('.mapkebab').classList.contains('on')), true, 'el botón se marca activo');
    assert.equal((await info()).mode, 'add');
    await openMenu();
    assert.deepEqual(await checks(), [['add', true], ['move', false]]);
    await page.click('#mapMenuPanel input[data-mode="move"]');          // elegir la otra apaga la primera
    assert.deepEqual(await ui(), { mode: 'move', menu: false });
    assert.equal(await bannerText(), 'Posición manual: mantén pulsado un punto 1 s.');
    await openMenu();
    assert.deepEqual(await checks(), [['add', false], ['move', true]]);
    await page.click('#mapMenuPanel input[data-mode="move"]');          // tocar la activa la apaga
    assert.deepEqual(await ui(), { mode: '', menu: false });
    assert.equal(await visible('#mapMode'), false, 'sin modo no hay aviso');
    assert.equal(await page.evaluate(() => document.querySelector('.mapkebab').classList.contains('on')), false);
    assert.equal((await info()).mode, '');
    // tocar el texto de la opción (no solo la casilla) también la activa, y con el teclado también
    await openMenu(); await page.click('#mapMenuPanel .mapopt:has-text("Ingresar puntos")');
    assert.equal((await ui()).mode, 'add');
    await openMenu(); await page.focus('#mapMenuPanel input[data-mode="move"]'); await page.keyboard.press('Space');
    assert.equal((await ui()).mode, 'move');
    // el botón «Salir» del aviso apaga el modo
    await page.click('#mapMode button');
    assert.deepEqual(await ui(), { mode: '', menu: false });
    assert.equal(await visible('#mapMode'), false);
    // con «Posición manual» y sin puntos, el aviso lo dice
    await fresh(); await openMap(); await pick('move');
    assert.match(await bannerText(), /Todavía no hay puntos que mover\.$/);
    await shot('91-modo-posicion-manual-sin-puntos');
  });

  await step('Los puntos solo se pueden agarrar con «Posición manual»; el doble toque no acerca el mapa mientras hay un modo activo y vuelve a hacerlo al apagarlo', async () => {
    await seed();
    assert.equal(await hits(), 0, 'sin modo, los puntos no son tocables');
    await pick('add');
    assert.equal(await hits(), 0, 'con «Ingresar puntos» tampoco');
    await pick('move');
    assert.equal(await hits(), 3, 'con «Posición manual» cada punto lleva su zona de toque');
    const z = await page.$$eval('.mk-hit', (els) => els.map((e) => [e.offsetWidth, e.offsetHeight]));
    assert.ok(z.every(([w, h]) => w >= 44 && h >= 44), 'zona de toque de 44 px: ' + JSON.stringify(z));
    const ids = await page.$$eval('.mk-hit', (els) => els.map((e) => e.getAttribute('data-id')));
    assert.deepEqual(ids.slice().sort(), (await pts()).map((p) => p.id).sort());
    const z0 = (await info()).zoom;
    const o = await centerXY();
    await page.mouse.dblclick(o.x + 90, o.y + 60);
    await page.waitForTimeout(500);
    assert.equal((await info()).zoom, z0, 'el doble toque no acerca con un modo activo');
    // el menú del sistema que aparece al mantener pulsado se bloquea solo con «Posición manual»
    const ctx = () => page.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('.mapa-leaflet').dispatchEvent(ev); return ev.defaultPrevented; });
    assert.equal(await ctx(), true);
    await page.click('#mapMode button');
    assert.equal(await ctx(), false);
    assert.equal(await hits(), 0, 'al apagar el modo los puntos dejan de ser tocables');
    await page.mouse.dblclick(o.x + 90, o.y + 60);
    await page.waitForFunction((z1) => window.__app.ui.map.info().zoom === z1 + 1, z0, { timeout: 3000 });
  });

  await step('Ingresar puntos: un toque crea el punto al instante, sin altitud, en el sitio tocado y sin mover el mapa; «Deshacer» lo quita', async () => {
    await seed();
    await pick('add');
    const antes = await info(), n0 = (await pts()).length, next0 = (await proj()).nextPoint;
    assert.equal(n0, 3);
    const donde = atOffset(antes, 70, -35);
    await tap(70, -35);
    await waitToast(/^P4 creado \(sin altitud\)\.Deshacer$/);
    const ps = await pts(), nuevo = ps[ps.length - 1];
    assert.equal(ps.length, 4);
    assert.equal(nuevo.name, 'P4');
    const px = 360 / (256 * Math.pow(2, antes.zoom));          // lo que mide un píxel de pantalla en grados; el ratón entrega píxeles enteros, así que se admite hasta uno y medio
    near(nuevo.lat, donde.lat, 1.5 * px, 'latitud tocada'); near(nuevo.lon, donde.lon, 1.5 * px, 'longitud tocada');
    assert.equal(nuevo.alt, null); assert.equal(nuevo.altSrc, null); assert.equal(nuevo.acc, null); assert.equal(nuevo.src, 'manual');
    assert.equal((await proj()).nextPoint, next0 + 1);
    const despues = await info();
    assert.equal(despues.zoom, antes.zoom, 'el zoom no cambia');
    near(despues.center.lat, antes.center.lat, px, 'centro'); near(despues.center.lon, antes.center.lon, px, 'centro');   // menos de un píxel: Leaflet redondea al recolocar el mapa
    assert.equal(despues.markers.length, 4, 'el punto se dibuja');
    assert.deepEqual(despues.polygon && [despues.polygon.vertices, despues.polygon.closed], [4, true], 'y entra al polígono');
    assert.equal((await ui()).mode, 'add', 'el modo sigue activo para seguir tocando');
    assert.equal(await bannerText(), 'Ingresar puntos: toca el mapa.');
    await shot('92-ingresar-puntos');
    // Deshacer: se quita y el siguiente vuelve a llamarse P4
    await page.click('#toast button');
    assert.equal((await pts()).length, 3);
    assert.equal((await proj()).nextPoint, next0);
    assert.equal((await info()).markers.length, 3);
    await tap(70, -35);
    assert.equal((await pts()).pop().name, 'P4');
    // aparece en la lista de Puntos, sin altitud
    await tab('puntos');
    assert.match(await text('#tab-puntos .list'), /P4[\s\S]*sin altitud/);
    await openMap();
  });

  await step('Ingresar puntos: dos toques casi seguidos en el mismo sitio cuentan como uno; en sitios lejanos o con tiempo de por medio, como dos; un arrastre no crea nada', async () => {
    await seed();
    await pick('add');
    const z0 = (await info()).zoom, o = await centerXY();
    await page.mouse.dblclick(o.x - 80, o.y + 40);
    await page.waitForTimeout(450);
    assert.equal((await pts()).length, 4, 'el doble toque deja un solo punto');
    assert.equal((await info()).zoom, z0, 'y no acerca el mapa');
    await page.mouse.click(o.x + 50, o.y - 60); await page.mouse.click(o.x + 50 + 120, o.y - 60);   // seguidos pero lejos: son dos puntos
    assert.equal((await pts()).length, 6);
    await page.mouse.click(o.x - 80, o.y + 40);                                                     // el mismo sitio, pero ya pasó tiempo
    await page.waitForTimeout(450);
    await page.mouse.click(o.x - 80, o.y + 40);
    assert.equal((await pts()).length, 8, 'con tiempo entre un toque y otro son dos');
    // arrastrar el mapa (hasta con 6 px de temblor) no crea nada y sí lo mueve
    const c0 = (await info()).center, n = (await pts()).length;
    await page.mouse.move(o.x + 10, o.y + 100); await page.mouse.down();
    await page.mouse.move(o.x + 80, o.y + 130, { steps: 6 }); await page.mouse.up();
    assert.equal((await pts()).length, n, 'un arrastre no crea puntos');
    assert.ok(Math.abs((await info()).center.lon - c0.lon) > 1e-5, 'y el mapa sí se movió');
    // un toque con 5 px de temblor sigue siendo un toque (tolerancia pensada para el dedo)
    await page.mouse.move(o.x - 100, o.y - 90); await page.mouse.down(); await page.mouse.move(o.x - 96, o.y - 87); await page.mouse.up();   // lejos de la columna de botones de la izquierda
    assert.equal((await pts()).length, n + 1);
  });

  await step('Ingresar puntos con la lista abierta: el toque en el mapa solo la cierra; sin puntos el mapa no salta a otro sitio al crear el primero', async () => {
    await fresh(); await openMap();
    await pick('add');
    const antes = await info();
    assert.equal(antes.zoom, 5, 'empieza en Colombia');
    await page.click('.mapkebab');                       // lista abierta
    await tap(40, 30);
    assert.equal((await pts()).length, 0, 'el primer toque solo cerró la lista');
    assert.equal(await visible('#mapMenuPanel'), false);
    await tap(40, 30);
    assert.equal((await pts()).length, 1);
    assert.equal((await pts())[0].name, 'P1');
    const despues = await info();
    assert.equal(despues.zoom, 5, 'no se acercó al primer punto');
    const px5 = 360 / (256 * 32);
    near(despues.center.lat, antes.center.lat, px5); near(despues.center.lon, antes.center.lon, px5);
    assert.equal(despues.markers.length, 1);
    // el punto quedó guardado de verdad
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal((await pts()).length, 1);
  });

  await step('El modo se apaga solo al salir del mapa, al cambiar de pestaña o de proyecto; sigue activo si solo se redibuja', async () => {
    await seed();
    await pick('add');
    await page.click('[data-act="mapPoly"]');            // redibuja el mapa: el modo sigue
    assert.equal((await ui()).mode, 'add');
    assert.deepEqual(await checks().catch(() => null), null === 1 ? null : await checks());
    await openMenu();
    assert.deepEqual(await checks(), [['add', true], ['move', false]], 'la casilla se ve marcada tras redibujar');
    assert.match(await bannerText(), /^Ingresar puntos/);
    await page.keyboard.press('Escape');
    await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.equal((await ui()).mode, '', 'al pasar a Croquis se apaga');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    assert.equal(await visible('#mapMode'), false);
    await pick('move');
    await tab('puntos'); assert.equal((await ui()).mode, '', 'al cambiar de pestaña se apaga');
    await tab('area');
    assert.equal(await visible('#mapMode'), false);
    assert.equal((await info()).mode, '');
    await pick('add');
    await act('projects'); await act('newProject'); await fill('#pName', 'Otro lote'); await act('saveNewProject'); await waitSheetClosed();
    assert.equal((await ui()).mode, '', 'al cambiar de proyecto se apaga');
    assert.equal(await visible('#mapMode'), false);
    assert.equal((await info()).mode, '');
  });
};

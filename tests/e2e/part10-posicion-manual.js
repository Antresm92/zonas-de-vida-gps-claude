'use strict';
/* Recorrido 10 — Polígono › Mapa › «Posición manual»: mantener pulsado un punto para levantarlo y arrastrarlo, doble toque para abrir su ficha
 * (nombre, coordenadas, altitud, color, leyenda y otros datos) y el tiempo de espera elegido en los ajustes.
 * Los mosaicos del mapa son de mentira (harness.mockTiles). Con el ratón se prueban los mismos eventos de puntero que manda un dedo, y un paso
 * usa toques táctiles de verdad de Chromium (Input.dispatchTouchEvent). */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, fill, tab, text, proj, waitToast, toastText, sheetOpen, sheetTitle, waitSheetClosed, addPointManual, shot } = c;

  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const ui = () => page.evaluate(() => ({ mode: window.__app.ui.mapMode, menu: window.__app.ui.mapMenu }));
  const openMap = async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
  };
  const seed = async (coords) => {
    await fresh();
    for (const p of coords || ['4.600, -74.080', '4.600, -74.070', '4.610, -74.070', '4.610, -74.080']) await addPointManual(p, 2600);
    await openMap();
  };
  const box = (sel) => page.locator(sel).first().boundingBox();
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const openMenu = async () => { if (!(await visible('#mapMenuPanel'))) await page.click('.mapkebab'); await page.waitForSelector('#mapMenuPanel', { state: 'visible' }); };
  const pick = async (mode) => { await openMenu(); await page.click('#mapMenuPanel input[data-mode="' + mode + '"]'); };
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' y fue ' + a);
  const toWorld = (lat, lon, z) => { const k = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * k, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k }; };
  const fromWorld = (x, y, z) => { const k = 256 * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / k; return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: x / k * 360 - 180 }; };
  const centerXY = async () => { const b = await box('#mapHost .mapa-leaflet'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // Dónde cae en la pantalla un punto del mundo, y a qué coordenadas corresponde un sitio de la pantalla
  const screenOf = async (lat, lon) => { const i = await info(), c0 = toWorld(i.center.lat, i.center.lon, i.zoom), w = toWorld(lat, lon, i.zoom), o = await centerXY(); return { x: o.x + (w.x - c0.x), y: o.y + (w.y - c0.y) }; };
  const coordsAt = async (x, y) => { const i = await info(), c0 = toWorld(i.center.lat, i.center.lon, i.zoom), o = await centerXY(); return fromWorld(c0.x + (x - o.x), c0.y + (y - o.y), i.zoom); };
  const pts = async () => (await proj()).points;
  const hitXY = async (id) => { const b = await box('.mk-hit[data-id="' + id + '"]'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const gesture = async () => (await info()).gesture;
  const liveText = async () => ((await visible('#mapLive')) ? await text('#mapLive') : '');
  const px = (z) => 360 / (256 * Math.pow(2, z));       // lo que mide un píxel de pantalla, en grados (el ratón entrega píxeles enteros)
  // Mantener pulsado hasta que el punto queda levantado; devuelve cuánto tardó
  const lift = async (id, ms) => {
    const at = await hitXY(id);
    await page.mouse.move(at.x, at.y); const t0 = Date.now(); await page.mouse.down();
    await page.waitForFunction(() => window.__app.ui.map.info().gesture === 'lifted', null, { timeout: (ms || 1000) + 2000 });
    return { at, took: Date.now() - t0 };
  };

  await step('Mantener pulsado un punto con «Posición manual»: aparece el anillo, a 1 s queda levantado y el mapa no se mueve; al soltar sin mover no cambia nada', async () => {
    await seed();
    await pick('move');
    const [p1] = await pts(), antes = await info();
    const at = await hitXY(p1.id);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    await page.waitForTimeout(350);
    assert.equal(await gesture(), 'press', 'todavía no pasó el tiempo');
    assert.equal(await page.evaluate((id) => document.querySelector('.mk-hit[data-id="' + id + '"]').closest('.mk').classList.contains('mk-press'), p1.id), true, 'el anillo de espera se ve');
    assert.equal(await page.evaluate((id) => getComputedStyle(document.querySelector('.mk-hit[data-id="' + id + '"]').closest('.mk')).getPropertyValue('--hold'), p1.id), '1000ms');
    const t0 = Date.now();
    await page.waitForFunction(() => window.__app.ui.map.info().gesture === 'lifted', null, { timeout: 3000 });
    const espera = Date.now() - t0 + 350;
    assert.ok(espera >= 900 && espera <= 1800, 'quedó levantado tras ' + espera + ' ms');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-lifted')), true, 'el punto se ve levantado');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-press')), false, 'el anillo se quita al levantarlo');
    assert.equal(await page.evaluate(() => document.querySelector('.mapa-leaflet').classList.contains('dragging')), true);
    await shot('93-punto-levantado');
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await gesture(), '');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-lifted')), false, 'al soltar ya no está levantado');
    assert.equal(await visible('#mapLive'), false);
    const despues = (await pts())[0];
    assert.equal(despues.lat, p1.lat); assert.equal(despues.lon, p1.lon, 'sin moverlo no cambia de sitio');
    assert.equal(/movido/.test(await toastText()), false, 'ni avisa que se movió');
    const i2 = await info();
    near(i2.center.lat, antes.center.lat, px(antes.zoom)); near(i2.center.lon, antes.center.lon, px(antes.zoom), 'el mapa no se movió');
  });

  await step('Arrastrar un punto levantado: el área y el perímetro cambian en vivo; al soltar queda donde se soltó (a mano, sin precisión de GPS) y «Deshacer» lo devuelve', async () => {
    await seed();
    // el primer punto viene del GPS, con precisión
    await page.evaluate(() => { const s = window.__app.S, p = s.projects.find((x) => x.id === s.currentId); p.points[0].src = 'gps'; p.points[0].acc = 4.2; });
    await tab('puntos'); await openMap(); await pick('move');
    const before = await pts(), p1 = before[0], i0 = await info();
    const { at } = await lift(p1.id);
    const dx = 45, dy = -40;
    await page.mouse.move(at.x + dx / 3, at.y + dy / 3, { steps: 3 });
    await page.mouse.move(at.x + dx, at.y + dy, { steps: 5 });
    const live = await liveText();
    assert.match(live, /^Moviendo P1 · Área [\d.,]+ (ha|m²|km²|fanegadas) · Perímetro [\d.,]+ (m|km)$/, live);
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('bad')), false, 'sin lados cruzados no es rojo');
    assert.equal(await visible('#mapMode'), false, 'mientras se arrastra, el aviso del modo cede su sitio');
    // 2.23.2: el encuadre cambió (la fila de lotes va siempre encima): se mira en qué mitad quedó el punto y se comprueba que las medidas vayan en la otra
    const mb = await page.locator('#mapHost .mapa-leaflet').boundingBox(), arriba = at.y + dy < mb.y + mb.height / 2;
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('low')), arriba, arriba ? 'el punto quedó en la mitad de arriba: las medidas van abajo' : 'el punto quedó en la mitad de abajo: las medidas van arriba');
    const caja = await box('#mapLive'), dedo = { x: at.x + dx, y: at.y + dy };
    assert.equal(dedo.x >= caja.x && dedo.x <= caja.x + caja.width && dedo.y >= caja.y && dedo.y <= caja.y + caja.height, false, 'las medidas no tapan el punto');
    // en vivo el punto sigue al dedo y la lista todavía tiene el sitio de antes
    const durante = (await info()).lifted;
    const donde = await coordsAt(at.x + dx, at.y + dy);
    near(durante.lat, donde.lat, 1.5 * px(i0.zoom), 'latitud en vivo'); near(durante.lon, donde.lon, 1.5 * px(i0.zoom), 'longitud en vivo');
    assert.equal((await pts())[0].lat, p1.lat, 'hasta soltar, no se guarda');
    // si algo pide redibujar el mapa con el punto en el aire, se espera a que lo suelte: el punto sigue levantado y siguiéndolo
    await page.evaluate(() => { const st = window.__app.S, pr = st.projects.find((x) => x.id === st.currentId); window.__app.ui.map.draw(window.Mapa.shapes(pr, { polyActive: true })); });
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-lifted')), true, 'un redibujo no suelta el punto');
    assert.equal(await gesture(), 'lifted');
    await page.mouse.move(at.x + dx + 2, at.y + dy + 2);
    const siguiendo = (await info()).lifted;
    near(siguiendo.lat, (await coordsAt(at.x + dx + 2, at.y + dy + 2)).lat, 1.5 * px(i0.zoom), 'sigue al dedo después del redibujo');
    await page.mouse.move(at.x + dx, at.y + dy);
    await shot('94-arrastrando-punto');
    await page.mouse.up();
    await waitToast(/^P1 movido\.Deshacer$/);
    const after = await pts();
    near(after[0].lat, donde.lat, 1.5 * px(i0.zoom), 'latitud guardada'); near(after[0].lon, donde.lon, 1.5 * px(i0.zoom), 'longitud guardada');
    assert.equal(after[0].src, 'manual', 'ya no es una posición de GPS');
    assert.equal(after[0].acc, null);
    assert.equal(after[0].alt, 2600, 'la altitud no cambia'); assert.equal(after[0].name, 'P1');
    for (let k = 1; k < 4; k++) { assert.equal(after[k].lat, before[k].lat); assert.equal(after[k].lon, before[k].lon); }
    assert.equal(await visible('#mapLive'), false, 'el aviso en vivo se apaga');
    assert.equal(await visible('#mapMode'), true, 'y vuelve el del modo');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-lifted')), false);
    const i1 = await info();
    assert.equal(i1.zoom, i0.zoom);
    near(i1.center.lat, i0.center.lat, px(i0.zoom)); near(i1.center.lon, i0.center.lon, px(i0.zoom), 'el mapa se quedó donde estaba');
    near(i1.markers.find((m) => m.id === p1.id).lat, after[0].lat, 1e-9, 'el mapa dibuja el punto donde quedó');
    assert.equal((await ui()).mode, 'move', 'el modo sigue activo');
    assert.equal(await hitXY(p1.id).then((q) => Math.round(q.x) > 0), true, 'y el punto se puede volver a agarrar');
    await page.click('#toast button');
    const undone = (await pts())[0];
    assert.equal(undone.lat, p1.lat); assert.equal(undone.lon, p1.lon);
    assert.equal(undone.src, 'gps'); assert.equal(undone.acc, 4.2, 'Deshacer devuelve también su origen y su precisión');
    near((await info()).markers.find((m) => m.id === p1.id).lat, p1.lat, 1e-9);
    // la lista de Puntos cuenta la verdad
    await page.click('#toast button').catch(() => {});
    await tab('puntos');
    assert.match(await text('#tab-puntos .list'), /precisión ±4 m/);
  });

  await step('Arrastrar un vértice hasta cruzar los lados: el aviso en vivo se pone rojo y dice que se cruzan; la lista y el Croquis lo confirman al soltar', async () => {
    await seed();
    await pick('move');
    const ps = await pts(), i0 = await info();
    const from = await hitXY(ps[0].id);
    const target = await screenOf(4.615, -74.075);     // por encima del lado superior: P1 pasa al otro lado y la figura se cruza
    await lift(ps[0].id);
    await page.mouse.move(target.x, target.y, { steps: 10 });
    const live = await liveText();
    assert.match(live, /· los lados se cruzan$/, live);
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('bad')), true);
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('low')), true, 'el punto está arriba: las medidas pasan abajo');
    const caja = await box('#mapLive');
    assert.equal(target.x >= caja.x && target.x <= caja.x + caja.width && target.y >= caja.y && target.y <= caja.y + caja.height, false, 'las medidas no tapan el punto');
    await shot('95-arrastre-con-lados-cruzados');
    await page.mouse.up();
    await waitToast(/^P1 movido/);
    assert.equal((await info()).polygon.bad, true, 'el polígono se dibuja en rojo');
    await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.match(await text('#tab-area'), /Los lados se cruzan/);
    assert.ok(Math.abs(from.x - target.x) + Math.abs(from.y - target.y) > 20);
    assert.equal(i0.markers.length, 4);
  });

  await step('Las medidas en vivo van arriba si el punto está en la mitad de abajo del mapa y abajo si está arriba: nunca lo tapan', async () => {
    await seed();
    await pick('move');
    const ps = await pts();
    const bajo = await screenOf(4.595, -74.075), alto = await screenOf(4.614, -74.075);
    const mapa = await box('#mapHost .mapa-leaflet');
    assert.ok(bajo.y > mapa.y + mapa.height / 2 && alto.y < mapa.y + mapa.height / 2, 'los dos sitios están en mitades distintas');
    const tapa = async (q) => { const b = await box('#mapLive'); return q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + b.height; };
    await lift(ps[0].id);
    await page.mouse.move(bajo.x, bajo.y, { steps: 6 });
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('low')), false, 'abajo: medidas arriba');
    assert.equal(await tapa(bajo), false);
    await page.mouse.move(alto.x, alto.y, { steps: 6 });
    assert.equal(await page.evaluate(() => document.querySelector('#mapLive').classList.contains('low')), true, 'arriba: medidas abajo');
    assert.equal(await tapa(alto), false);
    const pie = await box('#mapLive'), mp = await box('.mapbox');
    assert.ok(pie.y + pie.height <= mp.y + mp.height, 'queda dentro del mapa');
    await page.mouse.up();
  });

  await step('Soltar o moverse antes del tiempo no levanta nada: un toque corto no mueve el punto y si el dedo se desliza (más de 10 px) es el mapa el que se arrastra', async () => {
    await seed();
    await pick('move');
    const [p1] = await pts(), i0 = await info();
    const at = await hitXY(p1.id);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    assert.equal(await gesture(), '');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-press')), false, 'el anillo se apaga al soltar');
    assert.equal((await pts())[0].lat, p1.lat);
    // deslizar el dedo antes de que pase el tiempo: se abandona el gesto del punto y el mapa sí se desplaza
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    await page.mouse.move(at.x + 40, at.y + 25, { steps: 6 });
    assert.equal(await gesture(), '', 'el gesto del punto se abandonó');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-press')), false);
    await page.waitForTimeout(1300);
    assert.equal(await gesture(), '', 'y pasado el tiempo no se levanta');
    await page.mouse.up();
    assert.equal((await pts())[0].lat, p1.lat); assert.equal((await pts())[0].lon, p1.lon);
    const i1 = await info();
    assert.ok(Math.abs(i1.center.lon - i0.center.lon) > 3 * px(i0.zoom), 'el mapa se desplazó');
    // un temblor de 6 px sí cuenta como mantener pulsado
    const at2 = await hitXY(p1.id);
    await page.mouse.move(at2.x, at2.y); await page.mouse.down(); await page.mouse.move(at2.x + 4, at2.y + 4);
    await page.waitForFunction(() => window.__app.ui.map.info().gesture === 'lifted', null, { timeout: 3000 });
    await page.mouse.up();
  });

  await step('Cambiar de pestaña con un punto en el aire lo devuelve a su sitio, sin guardar nada ni dejar el aviso en vivo', async () => {
    await seed();
    await pick('move');
    const ps = await pts(), i0 = await info();
    const { at } = await lift(ps[1].id);
    await page.mouse.move(at.x - 50, at.y + 40, { steps: 4 });
    assert.match(await liveText(), /^Moviendo P2/);
    await page.evaluate(() => window.__app.showTab('puntos'));
    await page.mouse.up();
    assert.deepEqual((await pts()).map((p) => [p.lat, p.lon]), ps.map((p) => [p.lat, p.lon]), 'nada se guardó');
    assert.equal(/movido/.test(await toastText()), false);
    await openMap();
    assert.equal(await visible('#mapLive'), false);
    assert.equal((await info()).mode, '');
    assert.equal(await page.evaluate(() => !!document.querySelector('.mk-lifted')), false);
    assert.equal(i0.markers.length, 4);
  });

  await step('Doble toque sobre un punto con «Posición manual» abre su ficha; un solo toque, no; el doble toque no acerca el mapa', async () => {
    await seed();
    await pick('move');
    const [p1, p2] = await pts(), z0 = (await info()).zoom;
    const at = await hitXY(p1.id);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    assert.equal(await sheetOpen(), false, 'un toque no abre nada');
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(() => !document.querySelector('#sheet').hidden, null, { timeout: 2000 });
    assert.equal(await sheetTitle(), 'Ficha de P1');
    assert.equal((await info()).zoom, z0, 'no acercó el mapa');
    // dos toques a puntos distintos no son un doble toque
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    const b = await hitXY(p2.id);
    await page.mouse.click(at.x, at.y); await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(500);
    assert.equal(await sheetOpen(), false);
    // dos toques con tiempo de por medio, tampoco
    await page.mouse.click(at.x, at.y); await page.waitForTimeout(600); await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    assert.equal(await sheetOpen(), false);
    // en «Ingresar puntos» o sin modo, los puntos no se pueden tocar
    await pick('add');
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(400);
    assert.equal(await sheetOpen(), false);
  });

  await step('La ficha del punto trae nombre, coordenadas, altitud, color, leyenda y otros datos; se abre igual desde la lista de Puntos', async () => {
    await seed();
    await page.evaluate(() => { const s = window.__app.S, p = s.projects.find((x) => x.id === s.currentId); Object.assign(p.points[0], { src: 'gps', acc: 4.2, altGps: 2598, altAcc: 7, altSrc: 'gps' }); });
    await tab('puntos'); await openMap(); await pick('move');
    const [p1] = await pts(), at = await hitXY(p1.id);
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForSelector('#sheet #fName');
    assert.equal(await sheetTitle(), 'Ficha de P1');
    assert.equal(await page.inputValue('#fName'), 'P1');
    assert.match(await page.inputValue('#fCoord'), /^4\.6/);
    assert.equal(await page.inputValue('#fAlt'), '2600');
    assert.equal(await page.locator('#sheet .palette .sw').count() >= 6, true, 'paleta de colores');
    assert.equal(await page.locator('#sheet .palette .sw[aria-pressed="true"]').count(), 0, 'sin color propio no hay ninguno marcado');
    assert.equal(await page.getAttribute('#sheet [data-act="pointColorDefault"]', 'aria-pressed'), 'true', '«Usar el color de mis puntos» marcado');
    assert.equal(await page.inputValue('#fNote'), '');
    assert.equal(await page.getAttribute('#fNote', 'maxlength'), '300');
    const hint = await text('#fNote + .hint');
    assert.match(hint, /Solo se ve en esta ficha: no se dibuja en el mapa/);
    const info2 = await page.$$eval('#sheet h3.sub + dl.kv > div', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(await text('#sheet h3.sub'), 'Otros datos');
    assert.match(info2[0], /^Origen de la posición\s*GPS$/);
    assert.match(info2[1], /^Precisión del GPS\s*±4 m$/);
    assert.match(info2[2], /^Altitud del GPS\s*2598 m \(±7 m\)$/);
    assert.match(info2[3], /^Guardado\s*.*20\d\d/);
    await shot('96-ficha-del-punto');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    // el mismo formulario desde la lista de Puntos
    await tab('puntos'); await page.click('[data-act="editPoint"] >> nth=0');
    await page.waitForSelector('#sheet #fNote');
    assert.equal(await sheetTitle(), 'Ficha de P1');
    // un punto escrito a mano no tiene precisión ni altitud de GPS: esas filas no salen
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await page.click('[data-act="editPoint"] >> nth=1');
    await page.waitForSelector('#sheet #fNote');
    const filas = await page.$$eval('#sheet h3.sub + dl.kv dt', (els) => els.map((e) => e.textContent));
    assert.deepEqual(filas.slice(0, 1), ['Origen de la posición']);
    assert.equal(filas.includes('Precisión del GPS'), false);
    assert.equal(filas.includes('Altitud del GPS'), false);
    assert.equal(await text('#sheet h3.sub + dl.kv dd'), 'a mano');
  });

  await step('Color y leyenda: se eligen en la ficha, el punto cambia de color en el mapa y en el Croquis, la leyenda no se dibuja, y se pueden quitar', async () => {
    await seed();
    await pick('move');
    const [p1] = await pts(), at = await hitXY(p1.id);
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForSelector('#sheet #fNote');
    const colores = await page.$$eval('#sheet .palette .sw', (els) => els.map((e) => e.getAttribute('data-color')));
    const rojo = colores[1];
    await page.click('#sheet .palette .sw[data-color="' + rojo + '"]');
    assert.equal(await page.getAttribute('#sheet .palette .sw[data-color="' + rojo + '"]', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('#sheet [data-act="pointColorDefault"]', 'aria-pressed'), 'false');
    await page.fill('#fNote', 'Esquina junto al roble\ncon vista al río');
    await page.click('[data-act="saveEdit"]');
    await waitSheetClosed();
    await waitToast(/Cambios guardados/);
    const guardado = (await pts())[0];
    assert.equal(guardado.color, rojo);
    assert.equal(guardado.note, 'Esquina junto al roble\ncon vista al río');
    const m = (await info()).markers;
    assert.equal(m[0].color, rojo, 'el punto se dibuja con su color');
    assert.notEqual(m[1].color, rojo, 'los demás conservan el de los puntos del proyecto');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.mk-dot')).backgroundColor), await page.evaluate((c2) => { const d = document.createElement('i'); d.style.color = c2; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; }, rojo));
    assert.doesNotMatch(await text('#mapHost'), /roble|vista al río/, 'la leyenda no se dibuja en el mapa');
    assert.equal((await ui()).mode, 'move', 'el modo sigue activo');
    await shot('97-punto-con-color');
    // el Croquis lo dibuja igual
    await page.click('[data-act="polyView"][data-v="croquis"]');
    const strokes = await page.$$eval('#tab-area .plot svg circle[r="5"]', (els) => els.map((e) => e.getAttribute('stroke')));
    assert.equal(strokes[0], rojo); assert.equal(strokes.slice(1).every((s) => s !== rojo), true);
    assert.doesNotMatch(await text('#tab-area .plot'), /roble/);
    // sobrevive a cerrar y abrir la app
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal((await pts())[0].color, rojo); assert.equal((await pts())[0].note, 'Esquina junto al roble\ncon vista al río');
    // reabrir muestra lo guardado; «Usar el color de mis puntos» y una leyenda vacía lo quitan
    await tab('puntos'); await page.click('[data-act="editPoint"] >> nth=0');
    await page.waitForSelector('#sheet #fNote');
    assert.equal(await page.getAttribute('#sheet .palette .sw[data-color="' + rojo + '"]', 'aria-pressed'), 'true');
    assert.equal(await page.inputValue('#fNote'), 'Esquina junto al roble\ncon vista al río');
    await page.click('#sheet [data-act="pointColorDefault"]');
    assert.equal(await page.locator('#sheet .palette .sw[aria-pressed="true"]').count(), 0);
    assert.equal(await page.getAttribute('#sheet [data-act="pointColorDefault"]', 'aria-pressed'), 'true');
    await page.fill('#fNote', '   ');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    const limpio = (await pts())[0];
    assert.equal('color' in limpio, false); assert.equal('note' in limpio, false);
    // cambiar solo el color no toca la posición ni el origen: renombrar un punto de GPS conserva su precisión
    await page.evaluate(() => { const s = window.__app.S, p = s.projects.find((x) => x.id === s.currentId); Object.assign(p.points[1], { src: 'gps', acc: 5.5 }); });
    await page.click('[data-act="editPoint"] >> nth=1'); await page.waitForSelector('#sheet #fNote');
    await page.fill('#fName', 'Esquina 2');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    const p2 = (await pts())[1];
    assert.equal(p2.name, 'Esquina 2'); assert.equal(p2.src, 'gps'); assert.equal(p2.acc, 5.5, 'sin cambiar la posición se conserva la precisión del GPS');
    // corregir las coordenadas a mano (más de medio metro) sí la vuelve «a mano»
    await page.click('[data-act="editPoint"] >> nth=1'); await page.waitForSelector('#sheet #fNote');
    await page.fill('#fCoord', '4.60100, -74.07000');
    await page.click('[data-act="saveEdit"]'); await waitSheetClosed();
    const p2b = (await pts())[1];
    assert.equal(p2b.src, 'manual'); assert.equal(p2b.acc, null);
  });

  await step('Sin ajuste de tiempo: ya no hay selector, el aviso dice 1 s, a 0,6 s todavía no está levantado y a 1 s sí; un ajuste viejo guardado se descarta', async () => {
    await seed();
    assert.equal(await page.$('[data-setting="holdMs"]'), null, 'el selector «Tiempo para levantar un punto» ya no existe');
    assert.equal(await page.evaluate(() => /Tiempo para levantar/.test(document.body.textContent)), false);
    await pick('move');
    assert.equal(await text('#mapModeTxt'), 'Posición manual: mantén pulsado un punto 1 s.');
    const [p1] = await pts(), at = await hitXY(p1.id);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    await page.waitForTimeout(600);
    assert.equal(await gesture(), 'press', 'a 0,6 s todavía no');
    assert.equal(await page.evaluate((id) => getComputedStyle(document.querySelector('.mk-hit[data-id="' + id + '"]').closest('.mk')).getPropertyValue('--hold'), p1.id), '1000ms', 'el anillo dura 1 s');
    await page.waitForFunction(() => window.__app.ui.map.info().gesture === 'lifted', null, { timeout: 2000 });
    await page.mouse.up();
    // un estado guardado por la 2.4.0 con holdMs: se abre sin problema y el ajuste se descarta
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('zvg.v1.state')); s.settings.holdMs = 2000; localStorage.setItem('zvg.v1.state', JSON.stringify(s)); });
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal('holdMs' in (await c.state()).settings, false, 'el ajuste viejo no se conserva');
    await openMap();
    assert.equal(await page.$('[data-setting="holdMs"]'), null);
  });

  await step('Con el dedo (toques táctiles reales): mantener pulsado y arrastrar mueve el punto; doble toque abre la ficha; un toque en el mapa no hace nada', async () => {
    await seed();
    await pick('move');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await page.evaluate(() => { window.__pt = []; document.addEventListener('pointerdown', (e) => window.__pt.push(e.pointerType), true); });
    try {
      const ps = await pts(), i0 = await info(), p1 = ps[0];
      const at = await hitXY(p1.id);
      await touch('touchStart', at.x, at.y);
      await page.waitForFunction(() => window.__app.ui.map.info().gesture === 'lifted', null, { timeout: 3000 });
      assert.equal((await page.evaluate(() => window.__pt))[0], 'touch', 'el sistema mandó un toque, no el ratón');
      for (let k = 1; k <= 6; k++) await touch('touchMove', at.x + k * 8, at.y + k * 5);
      assert.match(await liveText(), /^Moviendo P1 · Área/);
      await touch('touchEnd');
      await waitToast(/^P1 movido\.Deshacer$/);
      const moved = (await pts())[0], donde = await coordsAt(at.x + 48, at.y + 30);
      near(moved.lat, donde.lat, 2 * px(i0.zoom), 'latitud'); near(moved.lon, donde.lon, 2 * px(i0.zoom), 'longitud');
      const i1 = await info();
      near(i1.center.lon, i0.center.lon, px(i0.zoom), 'el mapa no se movió con el dedo del punto');
      // doble toque con el dedo → ficha
      const at2 = await hitXY(ps[2].id);
      await touch('touchStart', at2.x, at2.y); await touch('touchEnd'); await page.waitForTimeout(120);
      await touch('touchStart', at2.x, at2.y); await touch('touchEnd');
      await page.waitForFunction(() => !document.querySelector('#sheet').hidden, null, { timeout: 2000 });
      assert.equal(await sheetTitle(), 'Ficha de P3');
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
  });
};

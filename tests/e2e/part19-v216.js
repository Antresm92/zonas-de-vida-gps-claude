'use strict';
const { solidPng } = require('../helpers/png.js');
const zlib = require('zlib');
/* Recorrido 19 — versión 2.16.0: pegar puntos a las esquinas de otros lotes, colores ya usados en la paleta y recorte de los bordes del logo. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, waitSheetClosed, waitToast, toastText, state, errors, shot } = c;
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const box = (sel) => page.locator(sel).first().boundingBox();
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const toWorld = (lat, lon, z) => { const s = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }; };
  const xyOf = async (lat, lon) => { const i = await info(), b = await box('#mapHost .mapa-leaflet'), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom); return { x: b.x + b.width / 2 + q.x - o.x, y: b.y + b.height / 2 + q.y - o.y }; };
  const openMap = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' }); };
  const pick = async (mode) => { if (!(await visible('#mapMenuPanel'))) await page.click('.mapkebab'); await page.waitForSelector('#mapMenuPanel', { state: 'visible' }); await page.click('#mapMenuPanel input[data-mode="' + mode + '"]'); if (await visible('#mapMenuPanel')) await page.click('.mapkebab'); await page.waitForTimeout(350); };   // se cierra la lista: con ella abierta el primer toque en el mapa solo la cierra
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const fly = async (lat, lon, z) => { await page.evaluate(([a, b, zz]) => window.__app.ui.map.flyTo(a, b, zz), [lat, lon, z]); await page.waitForFunction((zz) => window.__app.ui.map.info().zoom === zz, z); await page.waitForTimeout(250); };
  // 2.22.0: el vecino es otro predio (dos predios que comparten lindero); un lote iría dentro del predio
  const newLot = async (name) => { await act('predioAdd'); await fill('#lotName', name); await act('lotSave'); await waitSheetClosed(); };
  // Predio al oeste; el lote «Vecino» se marcará al este, compartiendo el lado P2–P3 del Predio
  const L1 = [['4.6000, -74.0800', 2600], ['4.6000, -74.0700', 2650], ['4.6100, -74.0700', 2700]];
  const base = async () => {
    await fresh();
    for (const [ll, alt] of L1) await addPointManual(ll, alt);
    await newLot('Vecino');
    await openMap();
  };

  await step('Al tocar el mapa muy cerca de la esquina de otro lote, el punto nuevo queda exactamente sobre ella y toma su altitud', async () => {
    await base();
    await fly(4.6, -74.07, 19);
    await pick('add');
    const near = await xyOf(4.6, -74.07);
    await page.mouse.click(near.x + 9, near.y - 6);                       // a unos 11 píxeles de la esquina P2 del Predio
    await waitToast(/^P1 creado\. Quedó pegado a P2 de «Predio»\./);
    let v = (await lots())[1].points;
    assert.equal(v.length, 1);
    assert.deepEqual([v[0].lat, v[0].lon, v[0].alt, v[0].altSrc, v[0].src], [4.6, -74.07, 2650, 'manual', 'manual']);
    await shot('v216-pegado');
    // más lejos (unos 40 píxeles) no se pega: queda donde se tocó y sin altitud
    await page.waitForTimeout(450);
    await page.mouse.click(near.x + 40, near.y - 10);
    await waitToast(/^P2 creado \(sin altitud\)\./);
    v = (await lots())[1].points;
    assert.equal(v.length, 2); assert.notEqual(v[1].lon, -74.07); assert.equal(v[1].alt, null);
    assert.ok(Math.abs(v[1].lon + 74.07) > 0.00003 && Math.abs(v[1].lon + 74.07) < 0.0003);
    // «Deshacer» quita el punto pegado como cualquier otro
    await page.click('#toast button');
    assert.equal((await lots())[1].points.length, 1);
  });

  await step('Al mover un punto y soltarlo cerca de la esquina de otro lote también se pega; los dos lotes vecinos no cuentan como montados', async () => {
    const far = await xyOf(4.60008, -74.06985);
    await page.waitForTimeout(450);
    await page.mouse.click(far.x, far.y);                                 // un punto lejos de toda esquina (unos 30 px)
    await waitToast(/^P2 creado \(sin altitud\)\./);
    await pick('move');
    const id = (await lots())[1].points[1].id;
    const from = await box('.mk-hit[data-id="' + id + '"]');
    const corner = await xyOf(4.6, -74.07);
    // se suelta a unos 8 px de la esquina… que ya tiene encima el P1 del Vecino; da igual: se pega a la esquina del Predio
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.waitForSelector('.mk-lifted', { state: 'attached' });      // hay que mantenerlo pulsado un segundo para levantarlo
    await page.mouse.move(corner.x + 30, corner.y + 30, { steps: 5 });
    await page.mouse.move(corner.x + 6, corner.y + 5, { steps: 5 }); await page.mouse.up();
    await waitToast(/^P2 movido\. Quedó pegado a P2 de «Predio»\./);
    let v = (await lots())[1].points;
    assert.deepEqual([v[1].lat, v[1].lon], [4.6, -74.07]);
    await page.click('#toast button');                                    // deshacer: vuelve a donde estaba
    v = (await lots())[1].points;
    assert.ok(Math.abs(v[1].lat - 4.60008) < 0.00003, String(v[1].lat));
    // se arma el lote vecino con el lindero compartido completo (P2 y P3 del Predio) más una esquina propia
    await pick('move');                                                   // apaga «Posición manual»
    await fly(4.61, -74.07, 19);
    await pick('add');
    const c3 = await xyOf(4.61, -74.07);
    await page.mouse.click(c3.x - 7, c3.y + 7);
    await waitToast(/Quedó pegado a P3 de «Predio»\./);
    v = (await lots())[1].points;
    assert.deepEqual([v[v.length - 1].lat, v[v.length - 1].lon, v[v.length - 1].alt], [4.61, -74.07, 2700]);
  });

  await step('Se puede apagar en Herramientas › Preferencias: entonces el punto queda donde se tocó', async () => {
    await tab('herramientas');
    const sel = '[data-flag="lotSnap"]';
    assert.equal(await page.isChecked(sel), true, 'viene encendido');
    assert.match(await text('label.menurow:has(' + sel + ')'), /Pegar puntos a las esquinas de otros polígonos/);
    await page.click(sel);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags')).lotSnap), false);
    await openMap();
    await fly(4.6, -74.08, 19);
    if (!(await page.evaluate(() => window.__app.ui.mapMode === 'add'))) await pick('add');
    const p1 = await xyOf(4.6, -74.08);
    await page.mouse.click(p1.x + 8, p1.y - 5);
    await waitToast(/creado \(sin altitud\)\./);
    const v = (await lots())[1].points, last = v[v.length - 1];
    assert.notEqual(last.lon, -74.08); assert.equal(last.alt, null);
    await c.dejarSobrepuesto();                                         // 2.21.0: sin pegarse, el punto deja al Vecino montado sobre el Predio; pregunta y se deja así
    await page.click('#toast button');
    await tab('herramientas'); await page.click(sel);
    assert.equal(await page.isChecked(sel), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags')).lotSnap), true);
  });

  await step('Con un solo lote no hay a qué pegarse: marcar en el mapa funciona como siempre', async () => {
    await fresh();
    for (const [ll, alt] of L1) await addPointManual(ll, alt);
    await openMap(); await fly(4.6, -74.07, 19); await pick('add');
    const near = await xyOf(4.6, -74.07);
    await page.mouse.click(near.x + 60, near.y - 40);
    await waitToast(/^P4 creado \(sin altitud\)\./);
  });

  await step('Paleta del lote: los colores que ya usa otro lote van marcados (y lo dicen); se pueden elegir igual', async () => {
    await base();
    await tab('puntos');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow.on .lotmore');
    const used = await page.$$eval('#sheet .palette .sw.used', (b) => b.map((x) => [x.getAttribute('data-color'), x.getAttribute('aria-label')]));
    const l = await lots();
    assert.deepEqual(used, [[l[0].mainColor, 'Color ' + l[0].mainColor + ' (ya lo usa «Predio»)']]);
    assert.equal(await page.$eval('#sheet .palette .sw[aria-pressed="true"]', (b) => b.classList.contains('used')), false, 'el propio color no va marcado');
    assert.equal(await text('#lotColorHint'), 'Los colores con un punto blanco ya los usa otro lote.');
    const dot = await page.$eval('#sheet .palette .sw.used', (b) => { const s = getComputedStyle(b, '::after'); return [s.width, s.backgroundColor]; });
    assert.deepEqual(dot, ['12px', 'rgb(255, 255, 255)']);
    await shot('v216-colores-en-uso');
    await page.click('#sheet .palette .sw.used');                         // no se prohíbe
    await act('lotSave'); await waitSheetClosed();
    const l2 = await lots();
    assert.equal(l2[1].mainColor, l2[0].mainColor);
    // con un solo lote no hay marcas ni nota
    await fresh();
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow .lotmore');
    assert.equal(await page.locator('#sheet .palette .sw.used').count(), 0);
    assert.equal(await page.locator('#lotColorHint').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Logo: se recortan solos los bordes de un solo color; un logo sin bordes queda igual', async () => {
    await fresh(); await tab('herramientas'); await act('authorEdit');
    // imagen de 300 × 900: franjas negras arriba y abajo y un dibujo verde de 300 × 300 en el medio
    const w = 300, h = 900, raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); raw[o] = 0; for (let x = 0; x < w; x++) { const g = y >= 300 && y < 600; raw[o + 1 + x * 3] = g ? 30 : 0; raw[o + 2 + x * 3] = g ? 140 : 0; raw[o + 3 + x * 3] = g ? 60 : 0; } }
    const crc = (b) => { let c, r = 0xFFFFFFFF; for (let n = 0; n < b.length; n++) { c = (r ^ b[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return (r ^ 0xFFFFFFFF) >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    await page.setInputFiles('#logoFile', { name: 'captura.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#auLogo img');
    assert.match(await toastText(), /^Se recortaron los bordes lisos del logo\.$/);
    const size = await page.$eval('#auLogo img', (i) => [i.naturalWidth, i.naturalHeight]);
    assert.equal(size[0], 300, 'el ancho se conserva');
    assert.ok(size[1] >= 300 && size[1] <= 330, 'de 900 de alto pasa a poco más de 300: ' + size[1]);
    assert.match(await text('#sheet'), /Se recortan los bordes de un solo color/);
    await shot('v216-logo-recortado');
    // un logo de un solo color (sin bordes que quitar) queda entero y no dice nada
    await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 12000 });
    await page.setInputFiles('#logoFile', { name: 'logo.png', mimeType: 'image/png', buffer: solidPng(30, 120, 60, 255, 500) });
    await page.waitForFunction(() => { const i = document.querySelector('#auLogo img'); return i && i.naturalWidth === 400 && i.naturalHeight === 400; });
    assert.equal(await page.evaluate(() => document.querySelector('#toast').hidden), true);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('2.16.0: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

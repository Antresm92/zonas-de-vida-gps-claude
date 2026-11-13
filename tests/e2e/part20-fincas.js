'use strict';
/* Recorrido 20 — versión 2.17.0: fincas y áreas. «Crear polígono» desde el mapa, tipos de área con título propio, lindero de la finca
   bloqueado, cuentas sin contar dos veces, avisos, relleno de puntos y capas importadas como finca o área. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, download, waitSheetClosed, waitToast, sheetTitle, toastText, state, errors, shot } = c;
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const box = (sel) => page.locator(sel).first().boundingBox();
  const toWorld = (lat, lon, z) => { const s = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }; };
  const xyOf = async (lat, lon) => { const i = await info(), b = await box('#mapHost .mapa-leaflet'), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom); return { x: b.x + b.width / 2 + q.x - o.x, y: b.y + b.height / 2 + q.y - o.y }; };
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const openMap = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' }); };
  const chips = () => page.$$eval('section.tab:not([hidden]) .lots .lotchip', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-pressed') === 'true' ? ' *' : '')));
  const tapMap = async (lat, lon) => { const q = await xyOf(lat, lon); await page.mouse.click(q.x, q.y); };
  // Finca: un cuadrado de ~1,1 km. Las áreas van adentro.
  const FINCA = [[4.600, -74.080], [4.600, -74.070], [4.610, -74.070], [4.610, -74.080]];

  await step('Mapa vacío: «＋ Polígono» está a la vista y propone crear la finca; al crearla queda lista para marcar tocando el mapa', async () => {
    await fresh(); await openMap();
    const b = await box('#mapNewPoly'); assert.ok(b && b.width >= 44 && b.height >= 44, 'botón visible y tocable');
    await act('lotNewMap');
    assert.equal(await sheetTitle(), 'Crear polígono');
    assert.deepEqual(await page.$$eval('#lotKind button', (x) => x.map((e) => e.textContent + ':' + e.getAttribute('aria-pressed'))), ['Lote:false', 'Finca:true', 'Área:false']);
    assert.equal(await page.inputValue('#lotName'), 'Finca');
    await fill('#lotName', 'La Esperanza');
    await act('lotSave'); await waitSheetClosed();
    assert.match(await toastText(), /^«La Esperanza» creado y elegido\. Toca el mapa para marcar sus puntos\./);
    assert.equal((await info()).mode, 'add');
    const l = (await lots())[1];
    assert.equal(l.kind, 'finca'); assert.equal(l.mainColor, '#2F8F4E');
    // el lote vacío de siempre sigue ahí, sin cambios
    assert.equal((await lots())[0].kind, undefined);
  });

  await step('Finca: se marcan sus puntos; al pasar a otro polígono su lindero se bloquea solo y ya no se puede cambiar por descuido', async () => {
    await page.click('[data-act="mapMode"][data-mode="add"], #mapMode [data-act="mapToolEnd"], .mapmode button').catch(() => {});
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await tab('puntos');
    for (const [la, lo] of FINCA) await addPointManual(la + ', ' + lo, 1000);
    assert.match((await chips())[1], /^La Esperanza · \d+,\d+ ha \*$/);
    await openMap();
    await act('lotNewMap');
    assert.deepEqual(await page.$$eval('#lotKind button', (x) => x.map((e) => e.getAttribute('aria-pressed'))), ['false', 'false', 'true'], 'con una finca, propone un área');
    assert.equal(await page.inputValue('#lotParent'), (await lots())[1].id, 'y la asigna a la finca');
    await page.click('.cat[data-c="Potrero"]');
    assert.equal(await page.inputValue('#lotName'), 'Potrero'); assert.equal(await page.inputValue('#lotCat'), 'Potrero');
    await act('lotSave'); await waitSheetClosed();
    assert.match(await toastText(), /^«Potrero» creado y elegido\. El lindero de «La Esperanza» quedó bloqueado\. Toca el mapa/);
    let ls = await lots();
    assert.equal(ls[1].locked, true);
    assert.deepEqual([ls[2].kind, ls[2].cat, ls[2].parent, ls[2].mainColor], ['area', 'Potrero', ls[1].id, '#8BC34A']);
    // el área se marca tocando el mapa, dentro de la finca
    await page.waitForTimeout(400);
    for (const [la, lo] of [[4.602, -74.078], [4.602, -74.075], [4.605, -74.075], [4.605, -74.078]]) { await tapMap(la, lo); await waitToast(/creado/); await page.waitForTimeout(350); }
    ls = await lots();
    assert.equal(ls[2].points.length, 4); assert.equal(ls[1].points.length, 4, 'la finca no cambió');
    // volver a la finca: está bloqueada
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await page.click('section.tab:not([hidden]) .lots .lotchip:nth-child(2)');
    assert.match(await text('#mapLock'), /Lindero de «La Esperanza» bloqueado/);
    assert.match((await chips())[1], /🔒/);
    await act('mapMark');
    assert.match(await toastText(), /^El lindero de la finca «La Esperanza» está bloqueado/);
    await tab('puntos'); await act('addCoords');
    assert.match(await toastText(), /está bloqueado/);
    assert.equal((await lots())[1].points.length, 4);
    await shot('v217-finca-bloqueada');
  });

  await step('Mapa: la finca con relleno liso y el área con relleno de puntos; «Editar» desbloquea el lindero', async () => {
    await openMap();
    await page.waitForFunction(() => window.__app.ui.map.info().layers.some((l) => l.lot && l.dots));
    let i = await info();
    assert.equal(i.polygon.dots, false); assert.equal(i.polygon.locked, true);
    assert.deepEqual(i.layers.filter((l) => l.lot).map((l) => [l.label.replace(/ · .*/, ''), l.dots]), [['Potrero', true]]);
    await page.evaluate(() => window.__app.ui.map.flyTo(4.6035, -74.0765, 16)); await page.waitForFunction(() => window.__app.ui.map.info().zoom === 16); await page.waitForTimeout(500);
    await shot('v217-mapa-finca-area');
    await page.click('section.tab:not([hidden]) .lots .lotchip:nth-child(3)');       // el potrero elegido: él con puntos, la finca lisa
    await page.waitForFunction(() => window.__app.ui.map.info().polygon && window.__app.ui.map.info().polygon.dots);
    i = await info();
    assert.deepEqual(i.layers.filter((l) => l.lot).map((l) => l.dots), [false]);
    assert.equal(await page.locator('#mapLock').count(), 0);
    await page.click('section.tab:not([hidden]) .lots .lotchip:nth-child(2)');
    await page.click('#mapLock');
    assert.match(await toastText(), /^Lindero de «La Esperanza» desbloqueado/);
    assert.equal((await lots())[1].locked, undefined);
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');   // se vuelve a bloquear desde su ficha
    await page.click('#sheet .lotrow.on .lotmore');
    await act('lotLock');
    assert.match(await toastText(), /^Lindero de «La Esperanza» bloqueado\.$/);
  });

  await step('Tipo con título propio («Cacaotera»); un área que se sale de la finca avisa y se puede dejar así', async () => {
    await act('lotNewMap');
    await fill('#lotCat', 'Cacaotera');
    await page.click('#lotKindHint');                                    // suelta el campo
    await act('lotSave'); await waitSheetClosed();
    let ls = await lots();
    assert.deepEqual([ls[3].name, ls[3].cat, ls[3].kind], ['Cacaotera', 'Cacaotera', 'area']);
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await tab('puntos');
    // se sale ~200 m por el este; 2.21.0: al tercer punto (ya hay polígono y se sale) pregunta, y se deja así; con el cuarto no vuelve a preguntar
    for (const ll of ['4.607, -74.074', '4.607, -74.068', '4.609, -74.068']) await addPointManual(ll, 1000);
    await c.dejarSobrepuesto();
    await addPointManual('4.609, -74.074', 1000);
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    assert.equal(await sheetTitle(), 'Lotes de Mi primer proyecto');
    assert.equal(await text('#lotOverlap'), '«Cacaotera» se sale de la finca «La Esperanza». Puedes dejarlo así, pero recuerda que esa parte queda por fuera de los límites del predio.');
    const rows = await page.$$eval('#sheet .lotrow', (r) => r.map((x) => x.querySelector('.lotpick').textContent.replace(/\s+/g, ' ').trim() + (x.classList.contains('child') ? ' ↳' : '')));
    assert.match(rows[1], /^La EsperanzaFinca · lindero bloqueado · \d+,\d+ ha · 4 puntos$/);
    assert.match(rows[2], /^PotreroPotrero · en «La Esperanza» \(\d+,\d %\) · \d+,\d+ ha · 4 puntos ↳$/);
    assert.match(rows[3], /^CacaoteraCacaotera · en «La Esperanza» \(\d+,\d %\) · .* ↳$/);
    // el total es el de la finca: las áreas que están dentro no se suman otra vez
    const st = await state(), F = st.projects[0].lots[1];
    const ha = await page.evaluate((pts) => window.Geo.polygonArea(pts) / 10000, F.points);
    const num = (t) => parseFloat(t.replace(/\./g, '').replace(',', '.'));
    assert.ok(Math.abs(num(await text('#lotTotal b')) - ha) < 0.06, await text('#lotTotal b') + ' vs ' + ha);
    assert.match(await text('#sheet .fincaline'), /^La Esperanza: 2 áreas, \d+,\d+ ha \(\d+,\d %\) · sin asignar \d+,\d+ ha\.$/);
    assert.equal(await page.locator('#sheet .lotrow i.dots').count(), 2, 'las áreas llevan la muestra de puntos');
    await shot('v217-lista-fincas');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Croquis y reporte: áreas con puntos, cada polígono con su tipo y el resumen sin sumar dos veces', async () => {
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.ok(await page.locator('#tab-area .plot svg pattern').count() >= 1, 'el croquis usa la trama de puntos');
    assert.match(await text('#areaOverlap'), /se sale de la finca/);
    for (let k = 2; k <= 4; k++) {
      await page.click('section.tab:not([hidden]) .lots .lotchip:nth-child(' + k + ')');
      await tab('clima'); await fill('[data-field="pManual"]', '1500'); await page.press('[data-field="pManual"]', 'Enter');
    }
    await tab('informe'); await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    const h = f.text;
    assert.match(h, /<th>Polígono<\/th>/);
    assert.match(h, /La Esperanza <span class="small">· Finca<\/span>/);
    assert.match(h, /Potrero <span class="small">· Potrero · en «La Esperanza»<\/span><\/td><td>\d+,\d+ ha \(\d+,\d % de la finca\)/);
    assert.deepEqual(h.match(/<h1 class="lt">[^<]*<\/h1>/g), ['<h1 class="lt">Finca: La Esperanza</h1>', '<h1 class="lt">Potrero: Potrero (en «La Esperanza»)</h1>', '<h1 class="lt">Cacaotera: Cacaotera (en «La Esperanza»)</h1>']);
    assert.match(h, /las áreas que están dentro de una finca no se suman otra vez/);
    assert.match(h, /<b>Atención:<\/b> «Cacaotera» se sale de la finca/);
    assert.match(h, /<pattern id="dots-/);
    const ids = h.match(/\bid="[^"]+"/g) || [];
    assert.equal(new Set(ids).size, ids.length, 'sin nombres internos repetidos');
    const pdf = await download(() => c.compartir('Pdf'));
    assert.equal(Buffer.from(pdf.bytes).toString('latin1').slice(0, 5), '%PDF-');
  });

  await step('Varias fincas en un proyecto: el área nueva propone la finca que se está viendo y el total suma las dos fincas', async () => {
    await tab('puntos');
    await act('lotAdd');
    assert.equal(await sheetTitle(), 'Nuevo lote');
    assert.deepEqual(await page.$$eval('#lotKind button', (x) => x.map((e) => e.getAttribute('aria-pressed'))), ['true', 'false', 'false'], '«＋ Lote» sigue proponiendo un lote, como siempre');
    await page.click('#lotKind [data-k="finca"]');
    assert.equal(await page.inputValue('#lotName'), 'Finca 2');
    await act('lotSave'); await waitSheetClosed();
    for (const ll of ['4.620, -74.080', '4.620, -74.075', '4.625, -74.075', '4.625, -74.080']) await addPointManual(ll, 300);
    await act('lotAdd'); await page.click('#lotKind [data-k="area"]');
    const ls0 = await lots();
    assert.equal(await page.inputValue('#lotParent'), ls0[4].id, 'propone la finca desde la que se crea');
    assert.deepEqual(await page.$$eval('#lotParent option', (o) => o.map((x) => x.textContent)), ['Ninguna (área suelta)', 'La Esperanza', 'Finca 2']);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    const a = await page.evaluate(() => { const g = window.Geo, l = window.__app.S.projects[0].lots; return (g.polygonArea(l[1].points) + g.polygonArea(l[4].points)) / 10000; });
    const tt = await text('#lotTotal b');
    assert.ok(Math.abs(parseFloat(tt.replace(/\./g, '').replace(',', '.')) - a) < 0.06, tt + ' vs ' + a);
    assert.equal(await page.locator('#sheet .fincaline').count(), 2);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Al cerrar y abrir la app, las fincas, sus áreas y el bloqueo siguen ahí; la copia de seguridad los lleva', async () => {
    const antes = await lots();
    await act('projects');
    const copia = await download(() => page.click('[data-act="backupJson"]'));
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    const raw = JSON.parse(copia.text).state.projects[0].lots;
    assert.deepEqual(raw.map((l) => [l.name, l.kind || '', l.cat || '', l.locked === true]), [['Lote 1', '', '', false], ['La Esperanza', 'finca', '', true], ['Potrero', 'area', 'Potrero', false], ['Cacaotera', 'area', 'Cacaotera', false], ['Finca 2', 'finca', '', false]]);
    assert.equal(raw[2].parent, raw[1].id);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.deepEqual(await lots(), antes);
  });

  await step('Capa importada: se puede crear con ella una finca (con el lindero ya bloqueado) o un área de la finca que la contiene; se deshace', async () => {
    await fresh();
    await page.evaluate(() => {
      const p = window.__app.S.projects[0], sq = (la, lo, d) => [[la, lo], [la, lo + d], [la + d, lo + d], [la + d, lo]].map(([a, b], i) => ({ name: 'V' + (i + 1), lat: a, lon: b, alt: 800 }));
      p.layers.push({ id: 'capa-finca', name: 'Predio importado', kind: 'polygon', color: '#C0392B', visible: true, points: sq(4.6, -74.08, 0.01), file: 'predio.kml', ts: 1 });
      p.layers.push({ id: 'capa-area', name: 'Cafetal viejo', kind: 'polygon', color: '#8D6E63', visible: true, points: sq(4.602, -74.078, 0.003), file: 'predio.kml', ts: 1 });
      window.__app.showTab('puntos');
    });
    await page.click('[data-act="editLayer"][data-id="capa-finca"]');
    await page.click('[data-act="layerToFinca"]'); await waitSheetClosed();
    assert.equal(await toastText(), '«Predio importado» creada como finca, con el lindero bloqueado. La capa quedó oculta.Deshacer');
    let ls = await lots();
    assert.deepEqual([ls[1].name, ls[1].kind, ls[1].locked, ls[1].points.length, ls[1].points[0].alt], ['Predio importado', 'finca', true, 4, 800]);
    assert.equal(ls[0].points.length, 0, 'el lote que había no se toca');
    let st = await state();
    assert.equal(st.projects[0].layers[0].visible, false); assert.equal(st.projects[0].layers.length, 2, 'la capa sigue en la lista');
    await page.click('[data-act="editLayer"][data-id="capa-area"]');
    await page.click('[data-act="layerToArea"]'); await waitSheetClosed();
    assert.equal(await toastText(), '«Cafetal viejo» creada como área de «Predio importado». La capa quedó oculta.Deshacer');
    ls = await lots();
    assert.deepEqual([ls[2].kind, ls[2].parent, ls[2].mainColor], ['area', ls[1].id, '#8D6E63']);
    await page.click('#toast button');
    ls = await lots(); st = await state();
    assert.equal(ls.length, 2); assert.equal(st.projects[0].layers[1].visible, true); assert.equal(st.projects[0].lotId, ls[1].id);
    // una capa de línea no ofrece estas opciones
    await page.evaluate(() => { const p = window.__app.S.projects[0]; p.layers.push({ id: 'capa-linea', name: 'Camino', kind: 'line', color: '#111111', visible: true, points: [{ lat: 4.6, lon: -74.08 }, { lat: 4.61, lon: -74.07 }], file: '', ts: 1 }); window.__app.showTab('puntos'); });
    await page.click('[data-act="editLayer"][data-id="capa-linea"]');
    assert.equal(await page.locator('#sheet [data-act="layerToFinca"], #sheet [data-act="layerToArea"]').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    // exportar: el CSV trae el tipo
    await page.click('[data-act="editLayer"][data-id="capa-area"]'); await page.click('[data-act="layerToArea"]'); await waitSheetClosed();
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    const csv = await download(() => page.click('[data-act="export"][data-fmt="csv"]'));
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(lines[0], /^Lote;Tipo;Punto;/);
    assert.match(lines[1], /^Predio importado;Finca;V1;/); assert.match(lines[5], /^Cafetal viejo;Cafetal viejo de Predio importado;|^Cafetal viejo;Área de Predio importado;/);
  });

  await step('Fincas y áreas: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

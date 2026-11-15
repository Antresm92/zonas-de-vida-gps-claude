'use strict';
/* Recorrido 28 — versión 2.25.0: «Exportar polígono» desde Editar, la fila de polígonos que muestra el elegido, completar varios
   polígonos con internet, copiar el clima sin pisar lo escrito a mano y limpiar la información de un polígono. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, addPointManual, waitSheetClosed, sheetTitle, toastText, waitToast, state, errors, shot, fx } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const byName = async (n) => (await lots()).find((l) => l.name === n);
  const chip = (n) => 'section.tab:not([hidden]) .lots .lotchip[data-id="' + n + '"]';
  const pick = async (id) => { await page.click(chip(id)); };
  // ¿Se ve el polígono elegido dentro de la fila (sin quedar cortado por los bordes)?
  const chipVisible = () => page.evaluate(() => {
    const bar = document.querySelector('section.tab:not([hidden]) .lots'), on = bar.querySelector('[aria-pressed="true"]');
    const b = bar.getBoundingClientRect(), o = on.getBoundingClientRect();
    return { left: bar.scrollLeft, inside: o.left >= b.left - 1 && o.right <= b.right + 1 };
  });

  // Internet simulado, como en el recorrido 3
  const mock = { fail: false, hits: 0 };
  const CORS = { 'access-control-allow-origin': '*' };
  const json = (body) => ({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api.open-meteo.com/v1/elevation**', (r) => {
    if (mock.fail) return r.fulfill({ status: 500, headers: CORS, body: 'x' });
    const n = new URL(r.request().url()).searchParams.get('latitude').split(',').length;
    r.fulfill(json({ elevation: Array.from({ length: n }, (_, i) => 1500 + i * 10) }));
  });
  await page.route('**/power.larc.nasa.gov/**', (r) => {
    mock.hits++;
    if (mock.fail) return r.fulfill({ status: 503, headers: CORS, body: 'busy' });
    const u = new URL(r.request().url());
    r.fulfill(json(fx.powerClassic(+u.searchParams.get('latitude'), +u.searchParams.get('longitude'))));
  });
  await page.route('**/archive-api.open-meteo.com/**', (r) => {
    if (mock.fail) return r.fulfill({ status: 500, headers: CORS, body: 'x' });
    r.fulfill(json(fx.openMeteoArchive()));
  });

  await step('Proyecto con un predio y siete lotes: la fila de arriba se desliza sola hasta el polígono elegido', async () => {
    await fresh();
    for (const p of ['5.000, -75.000', '5.000, -74.990', '5.010, -74.990', '5.010, -75.000']) await addPointManual(p);
    // los lotes se agregan directo en los datos guardados (crearlos uno por uno ya lo prueban otros recorridos)
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('zvg.v1.state')), p = s.projects[0], f = p.lots[0];
      f.name = 'Predio'; f.climate = { tManual: 20 };
      const names = ['Lote A', 'Lote B', 'Lote C', 'Lote D', 'Lote E', 'Lote F', 'Lote G'];
      names.forEach((n, i) => {
        const y = 5.001 + i * 0.001;
        p.lots.push({ id: 'l' + i, name: n, kind: 'area', cat: 'Potrero', parent: f.id, mainColor: '#2B6CB0', nextPoint: 4, climate: i === 0 ? { pManual: 999 } : {},
          points: [{ id: 'p' + i + 'a', name: 'P1', lat: y, lon: -74.999 }, { id: 'p' + i + 'b', name: 'P2', lat: y, lon: -74.998 }, { id: 'p' + i + 'c', name: 'P3', lat: y + 0.0005, lon: -74.998 }] });
      });
      localStorage.setItem('zvg.v1.state', JSON.stringify(s));
    });
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await tab('clima');
    assert.equal((await chipVisible()).left, 0, 'con el predio elegido la fila empieza al comienzo');
    await pick('l6');                                      // el último: «Lote G»
    let v = await chipVisible();
    assert.ok(v.left > 0 && v.inside, 'la fila se deslizó y «Lote G» se ve completo');
    await tab('puntos');
    assert.ok((await chipVisible()).inside, 'al cambiar de pestaña sigue a la vista');
    await tab('area');
    assert.ok((await chipVisible()).inside, 'también en Polígono');
    // si la persona la desliza a mano, se respeta mientras siga en el mismo polígono y la misma pantalla
    await tab('clima');
    await page.evaluate(() => { const b = document.querySelector('#tab-clima .lots'); b.scrollLeft = 0; b.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => window.__app.showTab('clima'));
    assert.equal((await chipVisible()).left, 0, 'un nuevo dibujo de la misma pantalla no la mueve');
    await shot('v225-fila-elegido');
  });

  await step('«Elegir polígonos ▾» en Información: abre sin nada marcado, con el estado de cada uno; el predio marca sus lotes', async () => {
    assert.equal(await text('#fetchBlock [data-act="fetchPick"]'), 'Elegir polígonos ▾');
    assert.equal(await text('#fetchBlock [data-act="climateToAll"]'), 'Usar este clima en todos los polígonos');
    await act('fetchPick');
    assert.equal(await sheetTitle(), 'Qué polígonos completar');
    assert.equal(await page.locator('#fetchList input').count(), 8);
    assert.equal(await page.locator('#fetchList input:checked').count(), 0, 'abre sin nada marcado');
    const rows = await page.$$eval('#fetchList label', (l) => l.map((x) => x.textContent.trim()));
    assert.equal(rows[0], 'Predio · 4 puntos sin altitud · clima escrito a mano');
    assert.equal(rows[1], 'Lote A · 3 puntos sin altitud · clima escrito a mano');
    assert.equal(rows[2], 'Lote B · 3 puntos sin altitud · sin clima');
    await page.click('#fetchList input[data-finca]');
    assert.equal(await page.locator('#fetchList input:checked').count(), 8, 'al marcar el predio se marcan sus lotes');
    await page.click('#fetchList input[data-id="l6"]');      // se quita «Lote G»
    await page.click('#sheet [data-act="fetchPickAll"][data-v="0"]');
    assert.equal(await page.locator('#fetchList input:checked').count(), 0, '«Ninguno»');
    await page.click('#sheet [data-act="fetchPickGo"]');
    assert.match(await toastText(), /^No marcaste ningún polígono\./);
    await page.click('#sheet [data-act="fetchPickAll"][data-v="1"]');
    await page.click('#fetchList input[data-id="l6"]');
    await shot('v225-elegir-poligonos');
  });

  await step('«Completar los marcados»: uno por uno, con el avance en el botón y un resumen; lo escrito a mano no cambia', async () => {
    mock.hits = 0;
    await act('fetchPick');
    await page.click('#sheet [data-act="fetchPickAll"][data-v="1"]'); await page.click('#fetchList input[data-id="l6"]');
    await page.click('#sheet [data-act="fetchPickGo"]');
    await page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Resultado'; }, null, { timeout: 30000 });
    assert.equal(await text('#fetchSum'), 'Los 7 polígonos quedaron completados.');
    const res = await page.$$eval('#fetchRes dt', (d) => d.map((x) => x.textContent));
    assert.deepEqual(res, ['✓ Predio', '✓ Lote A', '✓ Lote B', '✓ Lote C', '✓ Lote D', '✓ Lote E', '✓ Lote F']);
    assert.match(await text('#fetchRes dd'), /^altitud de 4 puntos y clima de la zona\.$/);
    assert.equal(mock.hits, 7, 'una consulta por polígono');
    await shot('v225-resultado');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
    const ls = await lots();
    for (const l of ls.slice(0, 7)) {
      assert.ok(l.climate.online && l.climate.online.monthlyP.length === 12, l.name + ' tiene su clima');
      assert.ok(l.points.every((q) => q.altSrc === 'internet' && q.alt >= 1500), l.name + ' tiene la altitud de sus puntos');
    }
    assert.equal(ls[7].climate.online, undefined, '«Lote G» no se marcó');
    assert.equal(ls[0].climate.tManual, 20, 'la temperatura escrita a mano del predio queda');
    assert.equal(ls[1].climate.pManual, 999, 'y la lluvia escrita del Lote A');
    assert.equal(await page.evaluate(() => window.__app.ui.fetching), false);
    // el predio sigue usando su temperatura escrita a mano
    await pick(ls[0].id);
    assert.match(await text('#tab-clima'), /Temperatura media anual20[,.]0 °C ?a mano/);
  });

  await step('Si internet falla, el resumen dice cuál quedó mal y ofrece volver a la lista', async () => {
    mock.fail = true;
    await act('fetchPick');
    await page.click('#fetchList input[data-id="l6"]');
    await page.click('#sheet [data-act="fetchPickGo"]');
    await page.waitForFunction(() => { const h = document.querySelector('#sheet h2'); return h && h.textContent === 'Resultado'; }, null, { timeout: 30000 });
    assert.equal(await text('#fetchSum'), '0 polígonos completados y 1 con problema.');
    assert.match(await text('#fetchRes dt'), /^✗ Lote G$/);
    assert.match(await text('#fetchRes dd'), /Puedes volver a intentarlo\.$/);
    await page.click('#sheet [data-act="fetchPick"]');
    assert.equal(await sheetTitle(), 'Qué polígonos completar');
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
    mock.fail = false;
  });

  await step('«Usar este clima en todos los polígonos»: los que tienen datos escritos a mano los conservan; «Deshacer» lo devuelve', async () => {
    await act('climateToAll');      // desde el predio (temperatura escrita: 20 °C)
    assert.match(await toastText(), /^Clima copiado a 7 polígonos; 1 conservó sus datos escritos a mano\. La temperatura de cada uno se ajusta con su altitud\.Deshacer$/);
    let a = await byName('Lote A'), b = await byName('Lote B'), g = await byName('Lote G');
    assert.equal(a.climate.pManual, 999); assert.equal(a.climate.tManual, undefined, 'el Lote A no recibe la temperatura escrita del predio');
    assert.equal(b.climate.tManual, 20, 'el Lote B, sin datos a mano, recibe todo');
    assert.ok(g.climate.online, 'el Lote G recibe el clima de internet');
    await page.click('#toast button');
    b = await byName('Lote B'); g = await byName('Lote G');
    assert.equal(b.climate.tManual, undefined); assert.equal(g.climate.online, undefined);
    await act('climateToAll');
  });

  await step('«Limpiar información del polígono»: casillas sin marcar; la del GPS con su advertencia; «Solo limpiar» y «Deshacer»', async () => {
    await pick('l1');      // Lote B
    await page.evaluate(() => { const l = window.__app.S.projects[0].lots.find((x) => x.id === 'l1'); l.points[0].altSrc = 'gps'; });
    await page.evaluate(() => window.__app.showTab('clima'));
    assert.equal(await text('#cleanBtn'), 'Limpiar información del polígono');
    await page.click('#cleanBtn');
    assert.equal(await sheetTitle(), 'Limpiar información');
    const rows = await page.$$eval('#cleanList label b', (l) => l.map((x) => x.textContent));
    assert.deepEqual(rows, ['Clima traído de internet', 'Clima escrito a mano', 'Altitud de los puntos (internet): 2 puntos', 'Altitud de los puntos (GPS): 1 punto']);
    assert.equal(await page.locator('#cleanList input:checked').count(), 0, 'nada viene marcado');
    assert.equal(await page.locator('#cleanList .warnrow input[data-part="altGps"]').count(), 1);
    assert.match(await text('#cleanList .warnrow'), /Es tu medida en campo/);
    await shot('v225-limpiar');
    await page.click('#sheet [data-act="cleanDo"]:not([data-then])');
    assert.match(await toastText(), /^No marcaste nada para borrar\./);
    await page.click('#cleanList input[data-part="online"]'); await page.click('#cleanList input[data-part="altInternet"]');
    await page.click('#sheet [data-act="cleanDo"]:not([data-then])'); await waitSheetClosed();
    assert.match(await toastText(), /^Información borrada de «Lote B»\. Puedes completarla con internet o escribirla a mano\.Deshacer$/);
    let b = await byName('Lote B');
    assert.equal(b.climate.online, undefined); assert.equal(b.climate.tManual, 20, 'lo escrito a mano queda');
    assert.deepEqual(b.points.map((q) => q.alt === undefined), [false, true, true], 'la del GPS queda; las de internet se borran');
    assert.equal(b.points.length, 3, 'los puntos no se borran');
    await page.click('#toast button');
    b = await byName('Lote B');
    assert.ok(b.climate.online); assert.ok(b.points.every((q) => typeof q.alt === 'number'));
    assert.equal(b.points[1].altSrc, 'internet');
  });

  await step('«Limpiar y completar con internet»: borra lo marcado y lo trae de nuevo; un solo «Deshacer» lo devuelve todo', async () => {
    await page.click('#cleanBtn');
    await page.click('#cleanList input[data-part="manual"]'); await page.click('#cleanList input[data-part="altGps"]');
    await page.click('#sheet [data-act="cleanDo"][data-then="fetch"]'); await waitSheetClosed();
    await waitToast(/^Listo: altitud de 1 punto y clima de la zona\..*Deshacer$/);
    let b = await byName('Lote B');
    assert.equal(b.climate.tManual, undefined, 'el clima escrito a mano se borró');
    assert.equal(b.points[0].altSrc, 'internet'); assert.equal(typeof b.points[0].altGps, 'number', 'la medida del GPS queda guardada para restaurarla');
    await page.click('#toast button');
    b = await byName('Lote B');
    assert.equal(b.climate.tManual, 20); assert.equal(b.points[0].altSrc, 'gps');
  });

  await step('«Exportar polígono» en la hoja Editar: lleva a Exportar con ese polígono ya marcado', async () => {
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow:nth-child(4) .lotmore');            // Lote C
    assert.equal(await sheetTitle(), 'Editar lote');
    assert.equal(await text('#lotExpBox'), 'Exportar polígono');
    await page.click('#lotExpBox [data-act="expOne"]'); await waitSheetClosed();
    assert.equal(await page.evaluate(() => window.__app.ui.tab + '/' + window.__app.ui.polyView), 'area/croquis');
    assert.equal(await text('#expSelTxt'), 'Se exportará: Lote C.');
    assert.equal(await text('#expScope [data-act="expPickOpen"]'), 'Elegidos (1) ▾');
    await shot('v225-exportar-poligono');
    // un polígono vacío no lo ofrece (no tiene nada que exportar)
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet [data-act="lotAdd"]');
    assert.equal(await page.locator('#lotExpBox').count(), 0);
    await page.click('#sheet [data-act="closeSheet"]'); await waitSheetClosed();
    // y la ayuda del mapa lo explica
    await page.evaluate(() => window.__app.showTab('area'));
    await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    await act('mapMore'); await page.click('#sheet [data-act="mapGuide"]');
    assert.match(await text('#sheet'), /Exportar un polígono.*«Exportar polígono» te lleva a Exportar con él ya marcado/);
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('Versión 2.25.0: sin errores de JavaScript en la consola', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // las consultas que fallan a propósito dejan «Failed to load resource» en la consola: no son errores de la app
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
};

'use strict';
const Zip = require('../../www/js/zip.js');
/* Recorrido 18 — versión 2.15.0: varios lotes por proyecto (cada uno con sus puntos, su polígono, su clima y su zona de vida). */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, download, waitSheetClosed, waitToast, sheetTitle, toastText, state, errors, shot } = c;
  const info = () => page.evaluate(() => window.__app.ui.map.info());
  const box = (sel) => page.locator(sel).first().boundingBox();
  const toWorld = (lat, lon, z) => { const s = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }; };
  const xyOf = async (lat, lon) => { const i = await info(), b = await box('#mapHost .mapa-leaflet'), o = toWorld(i.center.lat, i.center.lon, i.zoom), q = toWorld(lat, lon, i.zoom); return { x: b.x + b.width / 2 + q.x - o.x, y: b.y + b.height / 2 + q.y - o.y }; };
  const chips = () => page.$$eval('section.tab:not([hidden]) .lots .lotchip', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-pressed') === 'true' ? ' *' : '')));
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const rain = async (mm) => { await tab('clima'); await fill('[data-field="pManual"]', String(mm)); await page.press('[data-field="pManual"]', 'Enter'); };
  const newLot = async (name) => {
    await act('lotAdd'); assert.equal(await sheetTitle(), 'Nuevo lote');
    await page.selectOption('#lotParent', '');                          // 2.22.0: un lote suelto (sin predio), para que sea independiente como en estas pruebas
    if (name) await fill('#lotName', name);
    await act('lotSave'); await waitSheetClosed();
  };
  // Predio: un triángulo al oeste. Cafetal: otro al este, sin tocarse.
  const L1 = [['4.6000, -74.0800', 2600], ['4.6000, -74.0700', 2650], ['4.6100, -74.0750', 2700]];
  const L2 = [['4.6000, -74.0600', 1800], ['4.6000, -74.0500', 1820], ['4.6100, -74.0550', 1850]];
  const dosLotes = async () => {
    await fresh();
    for (const [ll, alt] of L1) await addPointManual(ll, alt);
    await rain(1200);
    await tab('puntos'); await newLot('Cafetal');
    for (const [ll, alt] of L2) await addPointManual(ll, alt);
  };

  await step('Con un solo lote: la fila muestra «Predio» y «＋ Lote» en Puntos, Información y Reporte, y también en el mapa (2.23.2), con el mapa un poco más bajo para que quepa', async () => {
    await fresh();
    assert.deepEqual(await chips(), ['Predio *', '＋ Lote', '＋ Predio']);
    for (const [ll, alt] of L1) await addPointManual(ll, alt);
    assert.match((await chips())[0], /^Predio · \d+,\d+ ha \*$/);
    for (const t of ['clima', 'informe']) { await tab(t); assert.equal(await page.locator('#tab-' + t + ' .lots').count(), 1, t); }
    await tab('area');
    assert.equal(await page.locator('#tab-area .lots').count(), 1, 'en el croquis sí va');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    assert.equal(await page.locator('#tab-area .lots').count(), 1, 'en el mapa también va, aunque haya un solo polígono');
    assert.equal(await page.locator('.mapbox.haslots').count(), 1);
    assert.deepEqual((await chips()).slice(-2), ['＋ Lote', '＋ Predio']);
    const bar = await page.locator('#tab-area .lots').boundingBox(), map = await page.locator('#mapBox').boundingBox(), nav = await page.locator('nav.tabs, #tabs, .tabbar').first().boundingBox();
    assert.ok(bar.y + bar.height <= map.y, 'la fila va encima del mapa, sin taparlo');
    if (nav) assert.ok(map.y + map.height <= nav.y + 1, 'el mapa cabe completo encima de la barra de pestañas');
  });

  await step('Crear un lote: empieza vacío, queda elegido y los puntos nuevos se guardan en él; «Deshacer» lo quita si sigue vacío', async () => {
    await tab('puntos');
    await newLot('');
    assert.match(await toastText(), /^«Lote» creado\. El lindero de «Predio» quedó bloqueado\./);
    assert.deepEqual((await chips()).map((x) => x.replace(/ · [\d,]+ ha/, '')), ['Predio 🔒', 'Lote *', '＋ Lote', '＋ Predio']);
    assert.equal(await page.locator('#tab-puntos [data-act="editPoint"]').count(), 0, 'el lote nuevo no tiene puntos');
    await page.click('#toast button');                                    // deshacer
    assert.deepEqual((await chips()).map((x) => x.replace(/ · [\d,]+ ha/, '')), ['Predio *', '＋ Lote', '＋ Predio']);
    assert.equal((await lots()).length, 1);
    await newLot('Cafetal');
    for (const [ll, alt] of L2) await addPointManual(ll, alt);
    const ls = await lots();
    assert.deepEqual(ls.map((l) => [l.name, l.points.length]), [['Predio', 3], ['Cafetal', 3]]);
    assert.deepEqual(ls[1].points.map((p) => p.name), ['P1', 'P2', 'P3'], 'cada lote numera sus puntos desde P1');
    assert.notEqual(ls[0].mainColor, ls[1].mainColor, 'el lote nuevo recibe un color distinto');
    await shot('v215-puntos-dos-lotes');
  });

  await step('Elegir otro lote cambia los puntos, el área y el clima que se ven; el guardado no repite los datos', async () => {
    await page.click('section.tab:not([hidden]) .lots .lotchip:not([aria-pressed="true"]):not(.add)');
    assert.match(await toastText(), /^Lote elegido: Predio\.$/);
    assert.match((await chips())[0], /\*$/);
    await tab('clima');
    assert.equal(await page.inputValue('[data-field="pManual"]'), '', 'el Predio todavía no tiene lluvia');
    await fill('[data-field="pManual"]', '1200'); await page.press('[data-field="pManual"]', 'Enter');
    await page.click('section.tab:not([hidden]) .lots .lotchip:not([aria-pressed="true"]):not(.add)');
    assert.equal(await page.inputValue('[data-field="pManual"]'), '', 'la lluvia del Predio no pasó al Cafetal');
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.state')).projects[0]);
    assert.deepEqual(Object.keys(raw).sort(), ['created', 'id', 'layers', 'lotId', 'lots', 'name']);
    assert.equal(raw.lots[0].climate.pManual, 1200); assert.equal(raw.lots[1].climate.pManual, undefined);
    assert.equal(raw.lotId, raw.lots[1].id);
  });

  await step('«Usar este clima en todos los lotes» copia la lluvia y se puede deshacer; cada lote conserva su altitud', async () => {
    await page.click('section.tab:not([hidden]) .lots .lotchip:not([aria-pressed="true"]):not(.add)');       // Predio (el que tiene la lluvia)
    await tab('clima');
    await act('climateToAll');
    assert.match(await toastText(), /^Clima copiado a 1 lote\./);
    assert.deepEqual((await lots()).map((l) => l.climate.pManual), [1200, 1200]);
    await page.click('#toast button');
    assert.deepEqual((await lots()).map((l) => l.climate.pManual), [1200, undefined]);
    await act('climateToAll');
    await tab('informe');
    const z1 = await text('#tab-informe .zona-nombre, #tab-informe .zname, #tab-informe .result h3, #tab-informe');
    await page.click('section.tab:not([hidden]) .lots .lotchip:not([aria-pressed="true"]):not(.add)');       // Cafetal: 800 m más abajo
    const z2 = await text('#tab-informe');
    assert.match(z1, /2[\.,]?650 m|2650/); assert.match(z2, /1[\.,]?82\d m|182\d/);       // cada lote reporta su propia altitud
    assert.notEqual(z1, z2);
  });

  await step('Lista de lotes: área, puntos y total del proyecto; desde ahí se elige, se renombra y se cambia el color', async () => {
    await tab('puntos');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');                 // tocar el lote elegido abre la lista
    assert.equal(await sheetTitle(), 'Lotes de Mi primer proyecto');
    const rows = await page.$$eval('#sheet .lotrow', (r) => r.map((x) => x.querySelector('.lotpick').textContent.replace(/\s+/g, ' ').trim() + (x.classList.contains('on') ? ' *' : '')));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^PredioPredio · lindero bloqueado · \d+,\d+ ha · 3 puntos( \*)?$/); assert.match(rows[1], /^CafetalLote · \d+,\d+ ha · 3 puntos( \*)?$/);
    assert.equal(rows.filter((r) => / \*$/.test(r)).length, 1, 'uno solo marcado como elegido');
    assert.match(await text('#lotTotal'), /^Total del proyecto: \d+,\d+ ha\. Los lotes que están dentro de un predio no se suman otra vez\./);
    const bb = await page.$eval('#sheet .lotmore', (e) => { const c = getComputedStyle(e); return { width: parseFloat(c.width), height: parseFloat(c.height) }; });   // tamaño real, sin la animación de la hoja
    assert.ok(bb.width >= 44 && bb.height >= 44, 'el botón ⋮ se puede tocar con el dedo: ' + JSON.stringify(bb));
    await shot('v215-lista-lotes');
    await page.click('#sheet .lotrow:nth-child(1) .lotmore');
    assert.equal(await sheetTitle(), 'Editar predio');      // 2.23.5: el título dice qué es
    await fill('#lotName', '  Potrero   <b>norte</b> ');
    await page.click('#sheet .palette .sw[data-color="#2980B9"]');
    await act('lotSave'); await waitSheetClosed();
    assert.match(await toastText(), /^(Lote|Predio) guardado\.$/);
    const ls = await lots();
    assert.equal(ls[0].name, 'Potrero <b>norte</b>'); assert.equal(ls[0].mainColor, '#2980B9');
    assert.equal(await page.locator('section.tab:not([hidden]) .lots b').count(), 0, 'el nombre se muestra como texto');
    assert.match((await chips())[0], /^Potrero <b>norte<\/b> (🔒 )?· /);
    // elegir desde la lista
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow:nth-child(1) .lotpick'); await waitSheetClosed();
    assert.match(await toastText(), /^Lote elegido: Potrero <b>norte<\/b>\.$/);
  });

  await step('Mapa: se ven todos los lotes, el otro con su nombre y su área; tocar dentro de otro lote lo elige', async () => {
    await tab('area');
    if (await page.locator('[data-act="polyView"][data-v="mapa"][aria-pressed="false"]').count()) await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet');
    assert.equal(await page.locator('#tab-area .lots').count(), 1, 'con varios lotes la fila también va en el mapa');
    assert.equal(await page.locator('.mapbox.haslots').count(), 1);
    await page.waitForFunction(() => window.__app.ui.map.info().layers.some((l) => l.lot));
    const i = await info();
    const other = i.layers.filter((l) => l.lot);
    assert.equal(other.length, 1); assert.match(other[0].label, /^Cafetal · \d+,\d+ ha$/); assert.equal(other[0].kind, 'polygon');
    assert.equal(i.markers.length, 3, 'solo los puntos del lote elegido se pueden tocar y mover');
    assert.match(await text('.mk-lot-tag'), /^Cafetal · /);
    await shot('v215-mapa-lotes');
    const inside = await xyOf(4.6030, -74.0550);
    await page.mouse.click(inside.x, inside.y);
    await waitToast(/^Lote elegido: Cafetal\.$/);
    await page.waitForFunction(() => window.__app.ui.map.info().layers.some((l) => l.lot && /^Potrero/.test(l.label)));
    // un toque fuera de todos los lotes no cambia nada
    const out = await xyOf(4.6090, -74.0650);
    await page.mouse.click(out.x, out.y);
    assert.match((await chips())[1], /^Cafetal · .* \*$/);
    // el croquis lleva los dos lotes y el total del proyecto
    await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.match(await text('#areaTotal'), /^\d+,\d+ ha$/);
    assert.match(await text('#tab-area'), /Total del proyecto \(2 lotes cerrados\)/);
    assert.match(await text('#tab-area .legend, #tab-area .leg, #tab-area'), /Potrero <b>norte<\/b>/);
  });

  await step('Reporte de todo el proyecto: resumen primero y luego cada lote; «Solo este lote» da el reporte del lote elegido', async () => {
    await tab('informe');
    await page.click('[data-act="share"]');
    assert.deepEqual(await page.$$eval('#repScope button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['Completo:true', 'Global:false', 'Específico:false']);
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(f.name, 'reporte-zona-de-vida-mi-primer-proyecto.html');
    const h = f.text;
    assert.ok(h.indexOf('<h2>Resumen del proyecto</h2>') > 0 && h.indexOf('<h2>Resumen del proyecto</h2>') < h.indexOf('<h1 class="lt">'), 'el resumen va antes de los lotes');
    assert.deepEqual(h.match(/<h1 class="lt">[^<]*(?:&lt;[^<]*)*<\/h1>/g), ['<h1 class="lt">Predio: Potrero &lt;b&gt;norte&lt;/b&gt;</h1>', '<h1 class="lt">Lote: Cafetal</h1>']);
    assert.match(h, /<tr class="tot"><td>Total<\/td><td>\d+,\d+ ha · [\d,]+ fanegadas<\/td><td colspan="\d">2 polígonos · \d zonas? de vida[^<]*<\/td>/);
    assert.equal(h.split('<h2>Datos del clima</h2>').length - 1, 2, 'el reporte completo de cada lote');
    assert.ok(h.indexOf('<h2>Croquis general</h2>') > 0 && h.indexOf('<h2>Croquis general</h2>') < h.indexOf('<h1 class="lt">'), 'croquis general con todos los lotes, en el resumen');
    assert.equal(h.split('Proyecto: Mi primer proyecto').length - 1, 1, 'un solo encabezado');
    const ids = h.match(/\bid="[^"]+"/g) || [];
    assert.equal(new Set(ids).size, ids.length, 'ningún nombre interno repetido entre los dibujos de los lotes');
    assert.doesNotMatch(h, /<b>norte/);
    assert.equal((await state()).projects[0].lotId, (await lots())[1].id, 'al terminar sigue elegido el mismo lote');
    // PDF de todo el proyecto
    const pdf = await download(() => c.compartir('Pdf'));
    assert.equal(pdf.name, 'reporte-zona-de-vida-mi-primer-proyecto.pdf');
    const ptxt = Buffer.from(pdf.bytes).toString('latin1');
    assert.equal(ptxt.slice(0, 5), '%PDF-');
    // solo el lote elegido
    await page.click('[data-act="share"]');
    await page.click('#repScope [data-s="one"]');
    const one = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(one.name, 'reporte-zona-de-vida-mi-primer-proyecto-cafetal.html');
    assert.match(one.text, /<p class="sub hl">Proyecto: Mi primer proyecto<\/p><p class="sub hl">Lote: Cafetal<\/p>/);
    assert.doesNotMatch(one.text, /Resumen del proyecto|class="lt"/);
    assert.ok(Buffer.byteLength(pdf.bytes) > 2000);
  });

  await step('Exportar: el CSV trae la columna «Lote», el Shapefile una figura por lote y el KML los dos polígonos', async () => {
    await tab('area');
    const csv = await download(() => page.click('[data-act="export"][data-fmt="csv"]'));
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(lines[0], /^Lote;Tipo;Punto;Latitud;/);      // 2.22.0: siempre hay predio y lotes, así que la columna «Tipo» va siempre
    assert.equal(lines.length, 7);
    assert.deepEqual(lines.slice(1).map((l) => l.split(';')[0]), ['Potrero <b>norte</b>', 'Potrero <b>norte</b>', 'Potrero <b>norte</b>', 'Cafetal', 'Cafetal', 'Cafetal']);
    const shp = await download(() => page.click('[data-act="export"][data-fmt="shp"]'));
    const ent = Object.fromEntries(Zip.entries(shp.bytes).map((e) => [e.name, e]));
    assert.ok(ent['mi_primer_proyecto_poligono.shp'] && ent['mi_primer_proyecto_puntos.dbf']);
    const kml = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.equal(kml.text.split('<Polygon>').length - 1, 2);
    assert.match(kml.text, /Potrero &lt;b&gt;norte&lt;\/b&gt;/);
  });

  await step('Eliminar un lote: se va con sus puntos, «Deshacer» lo devuelve, y el último lote no se puede eliminar', async () => {
    await tab('puntos');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow.on .lotmore');
    await act('lotDelete'); await waitSheetClosed();
    assert.match(await toastText(), /^«Cafetal» eliminado con sus 3 puntos\./);
    assert.deepEqual((await lots()).map((l) => l.name), ['Potrero <b>norte</b>']);
    assert.match((await chips())[0], /^Potrero .* \*$/);
    await page.click('#toast button');
    assert.deepEqual((await lots()).map((l) => [l.name, l.points.length]), [['Potrero <b>norte</b>', 3], ['Cafetal', 3]]);
    assert.match((await chips())[1], /^Cafetal · .* \*$/, 'vuelve a quedar elegido');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow.on .lotmore');
    await act('lotDelete'); await waitSheetClosed();
    await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 12000 });
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await page.click('#sheet .lotrow .lotmore');
    assert.equal(await page.locator('#sheet [data-act="lotDelete"]').count(), 0, 'con un solo lote no hay «Eliminar lote»');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Al cerrar y abrir la app los lotes siguen ahí; la copia de seguridad los lleva y los devuelve', async () => {
    await dosLotes();
    const antes = await lots();
    await act('projects');
    const copia = await download(() => page.click('[data-act="backupJson"]'));
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    const raw = JSON.parse(copia.text);
    assert.deepEqual(raw.state.projects[0].lots.map((l) => [l.name, l.points.length]), [['Predio', 3], ['Cafetal', 3]]);
    assert.equal('points' in raw.state.projects[0], false);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.deepEqual(await lots(), antes);
    assert.deepEqual((await chips()).map((x) => x.replace(/ · [\d,]+ ha/, '')), ['Predio 🔒', 'Cafetal *', '＋ Lote', '＋ Predio']);
    await shot('v215-reabierta');
  });

  await step('Lotes que se montan: avisa en la lista de lotes, en Polígono y en el reporte; si solo están al lado, no avisa', async () => {
    // viene de dos lotes separados (Predio y Cafetal): sin aviso
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]');
    assert.equal(await page.locator('#areaOverlap').count(), 0);
    await tab('puntos');
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    assert.equal(await page.locator('#lotOverlap').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    // un tercer lote metido encima del Cafetal (2.22.0: un lote sobre el predio no es montarse; sobre otro lote sí)
    await newLot('Encima');
    for (const ll of ['4.6010, -74.0580', '4.6010, -74.0520', '4.6080, -74.0550']) await addPointManual(ll, 2600);
    await c.dejarSobrepuesto();                                         // 2.21.0: al tercer punto pregunta; se deja como está
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    assert.equal(await text('#lotOverlap'), 'Hay polígonos que se montan uno sobre otro: «Cafetal» y «Encima». Revisa los linderos: el total del proyecto cuenta esa parte dos veces.');
    await shot('v2151-montados');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await tab('area');
    assert.match(await text('#areaOverlap'), /«Cafetal» y «Encima»/);
    await rain(1200);
    await tab('informe'); await page.click('[data-act="share"]');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.match(f.text, /<b>Atención:<\/b> Hay polígonos que se montan uno sobre otro: «Cafetal» y «Encima»\./);
  });

  await step('Lotes: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

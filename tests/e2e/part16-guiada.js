'use strict';
/* Recorrido 16 — Versión guiada (2.13): franja de tres pasos, Puntos con las formas de agregar arriba, Información con internet primero,
 * Reporte con secciones que se abren al tocar y «Compartir» fijo, Herramientas con tres conversores, preferencias, ayuda y licencias. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, gpsPush, sheetTitle, sheetOpen, waitSheetClosed, errors, shot, url } = c;
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const pasos = (t) => page.$$eval('#tab-' + t + ' .steps .step', (b) => b.map((x) => x.textContent + '|' + x.className.replace('step ', '')));
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const flag = (k, v) => page.evaluate(([k, v]) => { const f = JSON.parse(localStorage.getItem('zvg.v1.flags') || '{}'); if (v === undefined) delete f[k]; else f[k] = v; localStorage.setItem('zvg.v1.flags', JSON.stringify(f)); }, [k, v]);

  await step('Franja de tres pasos: dice qué está listo y qué falta en Puntos, Información, Reporte y el croquis, y lleva al paso al tocarla', async () => {
    await fresh();
    assert.deepEqual(await pasos('puntos'), ['1 · Puntossin puntos|now', '2 · Informaciónpendiente|wait', '3 · Reportependiente|wait']);
    await addPointManual('4.6000, -74.0800');                              // un punto sin altitud
    assert.deepEqual(await pasos('puntos'), ['1 · Puntos ✓1 punto|ok', '2 · Informaciónfalta la altitud|now', '3 · Reportependiente|wait']);
    await page.click('#tab-puntos .step.now');                             // lleva a Información
    assert.equal(await page.getAttribute('#nav-clima', 'aria-current'), 'page');
    await field('altOverride', '2600');
    assert.deepEqual(await pasos('clima'), ['1 · Puntos ✓1 punto|ok', '2 · Informaciónfalta la lluvia|now', '3 · Reportependiente|wait']);
    await field('pManual', '1200');
    assert.deepEqual(await pasos('clima'), ['1 · Puntos ✓1 punto|ok', '2 · Información ✓completo|ok', '3 · Reportelisto|now']);
    assert.equal(await page.getAttribute('#tab-clima .step.now', 'aria-current'), 'step');
    await page.click('#tab-clima .step.now');
    assert.equal(await page.getAttribute('#nav-informe', 'aria-current'), 'page');
    assert.equal((await pasos('informe')).length, 3);
    await tab('area');
    assert.equal((await pasos('area')).length, 3, 'en el croquis también');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    assert.equal(await page.locator('#tab-area .steps').count(), 0, 'en el mapa no: ese alto es del mapa');
    await tab('herramientas');
    assert.equal(await page.locator('#tab-herramientas .steps').count(), 0);
    await tab('puntos');
    const tam = await page.$$eval('#tab-puntos .step', (e) => e.map((x) => { const r = x.getBoundingClientRect(); return r.height >= 44 && x.scrollWidth <= x.clientWidth + 1; }));
    assert.ok(tam.every(Boolean), 'se pueden tocar y no se cortan');
    await shot('170-pasos');
  });

  await step('Puntos: las cuatro formas de agregar van arriba y juntas; la posición solo ocupa lugar con el GPS encendido; la lista queda a la vista', async () => {
    await fresh();
    assert.deepEqual(await page.$$eval('#tab-puntos .addgrid .btn', (b) => b.map((x) => x.textContent)), ['Activar GPS', 'Escribir coordenadas', 'Pegar varias coordenadas', 'Importar archivo']);
    assert.equal(await visible('#tab-puntos .readout'), false, 'con el GPS apagado no hay cuadro vacío');
    assert.equal(await text('#rLat'), '—');
    for (const p of ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0785']) await addPointManual(p, 2600);
    const lista = await page.locator('#tab-puntos .list').boundingBox();
    assert.ok(lista.y < page.viewportSize().height - 150, 'la lista de puntos se ve sin desplazar la pantalla (empieza en ' + Math.round(lista.y) + ' px)');
    const sel = await page.locator('#tab-puntos select[data-setting="minAcc"]').boundingBox();
    assert.ok(sel.height >= 44);
    assert.equal(await page.locator('#tab-puntos .hint').count(), 0, 'sin párrafos de explicación fijos');
    await act('gpsOn'); await gpsPush({ lat: 4.6, lon: -74.08, alt: 2600, acc: 5 });
    assert.equal(await visible('#tab-puntos .readout'), true);
    assert.deepEqual(await page.$$eval('#tab-puntos .addgrid .btn', (b) => b.map((x) => x.textContent)), ['Marcar punto aquí', 'Escribir coordenadas', 'Pegar varias coordenadas', 'Importar archivo']);
    assert.match(await text('#rAcc'), /5/);
    await shot('171-puntos');
    await act('gpsOff');
    assert.equal(await visible('#tab-puntos .readout'), false);
  });

  await step('Información: «Completar con internet» va primero, lo que falta se marca y las explicaciones se abren al tocar', async () => {
    await fresh(); await addPointManual('4.6000, -74.0800', 2600);
    await tab('clima');
    const orden = await page.$$eval('#tab-clima h2', (h) => h.map((x) => x.firstChild.textContent));
    assert.deepEqual(orden.slice(0, 4), ['Completar con internet', 'Altitud', 'Temperatura media anual', 'Precipitación anual']);
    const bt = await page.locator('#tab-clima [data-act="fetchOnline"]').boundingBox();
    assert.ok(bt.y < 420, 'el botón de internet se ve al entrar (está en ' + Math.round(bt.y) + ' px)');
    assert.equal(await page.locator('#tab-clima .block.need').count(), 1);
    assert.match(await text('#tab-clima .block.need h2'), /^Precipitación anualfalta$/);
    assert.equal(await page.locator('#tab-clima details.why').count(), 3);
    assert.equal(await page.locator('#tab-clima details.why[open]').count(), 0, 'las explicaciones empiezan cerradas');
    assert.equal(await page.locator('#tab-clima details.why .hint').first().isVisible(), false);
    await page.locator('#tab-clima details.why summary').first().click();
    assert.equal(await page.locator('#tab-clima details.why .hint').first().isVisible(), true);
    await shot('172-informacion');
    await field('pManual', '1200');
    assert.equal(await page.locator('#tab-clima .block.need').count(), 0, 'con la lluvia escrita ya no falta nada');
    assert.equal(await page.locator('#tab-clima .needtag').count(), 0);
  });

  await step('Reporte: las secciones se abren al tocar su título y «Compartir reporte» queda siempre a la vista', async () => {
    await fresh();
    await flag('reportOpen');                                              // como lo ve una persona: sin la preferencia de todo abierto
    await page.reload(); await page.waitForSelector('#tab-puntos');
    for (const p of ['4.6000, -74.0800', '4.6000, -74.0770', '4.6027, -74.0785']) await addPointManual(p, 2600);
    await tab('clima'); await field('pManual', '1200'); await tab('informe');
    const estado = () => page.$$eval('#tab-informe .block', (b) => b.map((x) => { const h = x.querySelector('h2'); return h ? (h.getAttribute('data-key') || h.firstChild.textContent) + ':' + (x.classList.contains('folded') ? 'cerrada' : 'abierta') : null; }).filter(Boolean));
    assert.deepEqual(await estado(), ['Datos usados:abierta', 'Otras clasificaciones del clima:cerrada', 'Clima actual:cerrada', 'Fotos de los puntos:cerrada', 'Perfil del relieve:cerrada', 'Croquis satelital:cerrada', 'Croquis topográfico:cerrada', 'Diagrama de Holdridge:cerrada', 'Más opciones:cerrada']);
    assert.equal(await page.locator('#tab-informe .result').isVisible(), true, 'el resultado siempre arriba');
    const alto = await page.evaluate(() => document.querySelector('#tab-informe').getBoundingClientRect().height);
    assert.ok(alto < 1500, 'el reporte plegado mide ' + Math.round(alto) + ' px (desplegado pasaba de 3.300)');
    // compartir, a la vista sin desplazar
    const sb = await page.locator('#tab-informe .sharebar [data-act="share"]').boundingBox(), nav = await page.locator('nav').boundingBox();
    assert.ok(sb.y + sb.height <= nav.y + 1 && sb.y > 0, 'el botón está sobre la barra de pestañas');
    await shot('173-reporte-plegado');
    // abrir el diagrama: se dibuja con su tamaño
    assert.equal(await page.locator('#diag').isVisible(), false);
    await page.click('#tab-informe h2[data-fold="Diagrama de Holdridge"]');
    assert.equal(await page.getAttribute('#tab-informe h2[data-fold="Diagrama de Holdridge"]', 'aria-expanded'), 'true');
    await page.waitForSelector('#diag svg');
    const d = await page.locator('#diag').boundingBox();
    assert.ok(d.width > 200 && d.height > 200, 'el diagrama tiene tamaño');
    await page.click('[data-act="dZoomIn"]');                              // y sus botones funcionan
    assert.deepEqual((await estado()).filter((x) => /abierta/.test(x)), ['Datos usados:abierta', 'Diagrama de Holdridge:abierta']);
    // con el teclado
    await page.focus('#tab-informe h2[data-fold="Perfil del relieve"]'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#tab-informe .block:not(.folded) h2[data-fold="Perfil del relieve"]').count(), 1);
    await page.click('#tab-informe h2[data-fold="Perfil del relieve"]');   // otro toque la cierra
    assert.equal(await page.locator('#tab-informe .block.folded h2[data-fold="Perfil del relieve"]').count(), 1);
    // lo abierto se recuerda al cambiar de pestaña
    await tab('puntos'); await tab('informe');
    assert.deepEqual((await estado()).filter((x) => /abierta/.test(x)), ['Datos usados:abierta', 'Diagrama de Holdridge:abierta']);
    // el clima actual se actualiza dentro de su sección sin perder el plegado
    await page.click('#tab-informe h2[data-fold="Clima actual"]');
    assert.equal(await page.locator('#nowBlock [data-act="fetchNow"]').isVisible(), true);
    assert.equal(await page.locator('#tab-informe h2[data-fold="Croquis satelital"]').count(), 1);
  });

  await step('Preferencia «Reporte con todas las secciones abiertas» (Herramientas): al marcarla el reporte sale desplegado, como antes', async () => {
    await tab('herramientas');
    assert.equal(await page.isChecked('[data-flag="reportOpen"]'), false);
    await page.check('[data-flag="reportOpen"]');
    await tab('informe');
    assert.equal(await page.locator('#tab-informe .block.folded').count(), 0);
    assert.equal(await page.locator('#tab-informe.folds').count(), 0);
    assert.equal(await page.locator('#diag').isVisible(), true);
    await page.reload(); await page.waitForSelector('#tab-puntos');       // se recuerda
    await tab('herramientas');
    assert.equal(await page.isChecked('[data-flag="reportOpen"]'), true);
    await page.uncheck('[data-flag="reportOpen"]');
    await tab('informe');
    assert.ok(await page.locator('#tab-informe .block.folded').count() >= 6);
  });

  await step('Herramientas: tres conversores de campo, proyectos y copias, ayuda, licencias y la versión', async () => {
    await fresh(); await tab('herramientas');
    assert.deepEqual(await page.$$eval('#tab-herramientas h3', (h) => h.map((x) => x.textContent)), ['Conversor de unidades', 'Utilidades de campo', 'Proyectos y copias', 'Reporte', 'Preferencias', 'Ayuda']);
    assert.deepEqual(await page.$$eval('.tcard[data-act="convert"] b', (b) => b.map((x) => x.textContent)), ['Área', 'Distancia', 'Temperatura']);
    const fila = await page.$$eval('.tcard[data-act="convert"]', (b) => b.map((x) => Math.round(x.getBoundingClientRect().top)));
    assert.ok(fila.every((y) => y === fila[0]), 'los tres en una fila');
    assert.deepEqual(await page.$$eval('#tab-herramientas .menurow b', (b) => b.map((x) => x.textContent)), ['Proyectos', 'Copia de seguridad y restaurar', 'Encabezado del reporte', 'Reporte con todas las secciones abiertas', 'Pegar puntos a las esquinas de otros lotes', 'Cómo usar la app', 'Cómo usar el mapa', 'Fuentes y licencias']);
    assert.match(await text('#tab-herramientas'), /Zonas de Vida · versión \d+\.\d+\.\d+\./);
    await shot('174-herramientas');
    await page.click('#tab-herramientas .menurow[data-act="projects"] >> nth=0');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Proyectos');
    assert.match(await text('#sheet'), /Copia de seguridad/);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await act('licenses'); await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Fuentes y licencias');
    const lic = await text('#sheet');
    for (const t of ['OpenStreetMap', 'ODbL', 'Esri', 'OpenTopoMap', 'CC-BY-SA', 'NASA POWER', 'Open-Meteo', 'Leaflet', 'Holdridge']) assert.ok(lic.includes(t), 'falta ' + t);
    await shot('175-licencias');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
    await act('mapGuide'); await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Cómo usar el mapa');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
    await act('appGuide'); await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Cómo usar la app');
    assert.deepEqual(await page.$$eval('.guide dt', (d) => d.map((x) => x.textContent)), ['1 · Puntos', '2 · Información', '3 · Reporte', 'Polígono', 'Arriba']);
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
  });

  await step('Ayuda de primera vez de la app: sale sola al abrirla por primera vez y no vuelve a salir', async () => {
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(url); await page.waitForSelector('#tab-puntos');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Cómo usar la app');
    await shot('176-ayuda-de-la-app');
    await page.click('#sheet .btn-primary'); await waitSheetClosed();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.flags')).appGuide), true);
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(), false);
  });

  await step('Versión guiada: sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

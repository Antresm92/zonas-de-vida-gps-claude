'use strict';
/* Recorrido 22 — versión 2.20.0: croquis enfocado en el polígono de cada reporte (los demás, tenues) y qué va en el reporte:
   «Completo» (en orden de jerarquía), «Global» (solo las fincas marcadas) y «Específico» (un polígono). */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, download, waitSheetClosed, toastText, state, errors, shot } = c;
  const lots = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).lots; };
  const openMap = async () => { await tab('area'); await page.click('[data-act="polyView"][data-v="mapa"]'); await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' }); };
  const sq = (lat, lon, d) => [[lat, lon], [lat, lon + d], [lat + d, lon + d], [lat + d, lon]];
  const nuevo = async (kind, name, pts, parent) => {
    await openMap(); await act('lotNewMap');
    await page.click('#lotKind button:has-text("' + kind + '")');
    if (parent) await page.selectOption('#lotParent', parent);
    await fill('#lotName', name);
    await act('lotSave'); await waitSheetClosed();
    await page.evaluate(() => window.__app.ui.map.setMode(''));
    await tab('puntos');
    for (const [la, lo] of pts) await addPointManual(la + ', ' + lo, 1000);
  };
  const rain = async () => { await tab('clima'); await fill('[data-field="pManual"]', '1500'); await page.press('[data-field="pManual"]', 'Enter'); };
  const scope = () => page.$$eval('#repScope button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed')));
  const titles = (h) => (h.match(/<h1 class="lt">[^<]*<\/h1>/g) || []).map((t) => t.replace(/<[^>]+>/g, ''));
  const ctx = (h) => (h.match(/class="ctx"/g) || []).length;

  await step('Se arman dos fincas y un área (creada al final, dentro de la primera)', async () => {
    await fresh();
    await nuevo('Predio', 'La Esperanza', sq(4.600, -74.080, 0.010));
    await nuevo('Predio', 'El Retiro', sq(4.630, -74.040, 0.004));
    const esperanza = (await lots())[0].id;
    await nuevo('Lote', 'Cafetal', sq(4.602, -74.078, 0.002), esperanza);
    const ls = await lots();
    assert.deepEqual(ls.map((l) => (l.kind || 'lote') + ':' + l.points.length), ['finca:4', 'finca:4', 'area:4']);
    assert.equal(ls[2].parent, esperanza);
    await rain();                                                       // con lluvia el reporte del área queda completo y aparece «Compartir reporte»
  });

  await step('«Completo»: va en orden de jerarquía y el croquis de cada polígono se enfoca en él, con los demás tenues', async () => {
    await tab('informe');
    await page.click('[data-act="share"]');
    assert.deepEqual(await scope(), ['Completo:true', 'Global:false', 'Específico:false']);
    assert.match(await text('#repWhat'), /cada predio seguido de sus lotes/);
    await shot('v220-completo');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(f.name, 'reporte-zona-de-vida-mi-primer-proyecto.html');
    const h = f.text;
    assert.deepEqual(titles(h), ['Predio: La Esperanza', 'Lote: Cafetal (en «La Esperanza»)', 'Predio: El Retiro']);
    const gen = h.slice(h.indexOf('<h2>Croquis general</h2>'), h.indexOf('<section class="lote">'));
    assert.equal(ctx(gen), 0, 'en el croquis general nadie va tenue');
    assert.doesNotMatch(gen, />P1</, 'ni lleva puntos resaltados');
    const secs = h.split('<section class="lote">').slice(1);
    assert.equal(secs.length, 3);
    secs.forEach((s, i) => {
      const cro = s.slice(s.indexOf('<h2>Croquis</h2>'), s.indexOf('</svg>', s.indexOf('<h2>Croquis</h2>')));
      assert.equal(ctx(cro), 2, 'polígono ' + (i + 1) + ': los otros dos van tenues');
      assert.equal((cro.match(/>P[1-4]<\/text>/g) || []).length, 4, 'polígono ' + (i + 1) + ': solo sus 4 puntos llevan nombre');
    });
    // el cafetal (220 m) ocupa buena parte de su croquis aunque la otra finca esté a más de 4 km
    const caf = secs[1], d = /<path d="([^"]+) Z" fill="url\(#dots[^"]+\)" stroke="[^"]+" stroke-width="2\.4"/.exec(caf);
    assert.ok(d, 'el cafetal lleva su relleno de puntos');
    const xs = d[1].split(/[ML]/).filter(Boolean).map((t) => parseFloat(t.trim().split(' ')[0]));
    assert.ok(Math.max(...xs) - Math.min(...xs) > 200, 'ancho del cafetal en su croquis: ' + (Math.max(...xs) - Math.min(...xs)));
  });

  await step('«Global»: solo las fincas marcadas; con una sola sale su reporte y sin ninguna avisa', async () => {
    await page.click('[data-act="share"]');
    await page.click('#repScope [data-s="fincas"]');
    assert.deepEqual(await scope(), ['Completo:false', 'Global:true', 'Específico:false']);
    assert.deepEqual(await page.$$eval('#repFincas .repfin', (l) => l.map((x) => x.textContent + ':' + x.querySelector('input').checked)), ['La Esperanza:true', 'El Retiro:true']);
    const b = await page.locator('#repFincas .repfin').first().boundingBox(); assert.ok(b.height >= 44, 'casilla cómoda de tocar');
    await shot('v220-global');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(f.name, 'reporte-zona-de-vida-mi-primer-proyecto-fincas.html');
    assert.deepEqual(titles(f.text), ['Predio: La Esperanza', 'Predio: El Retiro']);
    assert.match(f.text, /<td colspan="2">2 polígonos · /);
    assert.doesNotMatch(f.text.slice(0, f.text.indexOf('<section class="lote">')), /Cafetal/, 'el resumen no nombra las áreas');
    // se recuerda la elección; se desmarca una
    await page.click('[data-act="share"]');
    assert.deepEqual(await scope(), ['Completo:false', 'Global:true', 'Específico:false']);
    await page.click('#repFincas .repfin:nth-child(2) input');
    const one = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(one.name, 'reporte-zona-de-vida-mi-primer-proyecto-la-esperanza.html');
    assert.doesNotMatch(one.text, /Resumen del proyecto|class="lt"/);
    assert.match(one.text, /<p class="sub hl">Finca: La Esperanza<\/p>|La Esperanza/);
    // ninguna marcada
    await page.click('[data-act="share"]');
    assert.deepEqual(await page.$$eval('#repFincas input', (i) => i.map((x) => x.checked)), [true, false], 'lo desmarcado se recuerda');
    await page.click('#repFincas .repfin:nth-child(1) input');
    await page.click('[data-act="shareReportHtml"]');
    assert.match(await toastText(), /Marca al menos un predio/);
    assert.equal(await page.locator('#repScope').count(), 1, 'la hoja sigue abierta');
    await page.click('#repFincas .repfin:nth-child(1) input'); await page.click('#repFincas .repfin:nth-child(2) input');
    const pdf = await download(() => page.click('[data-act="shareReportPdf"]'));
    assert.equal(pdf.name, 'reporte-zona-de-vida-mi-primer-proyecto-fincas.pdf');
    assert.equal(Buffer.from(pdf.bytes).toString('latin1').slice(0, 5), '%PDF-');
  });

  await step('«Específico»: se elige cualquier polígono de la lista, en orden de jerarquía, sin cambiar el que está elegido', async () => {
    const before = (await state()).projects[0].lotId;
    await page.click('[data-act="share"]');
    await page.click('#repScope [data-s="one"]');
    const opts = await page.$$eval('#repOne option', (o) => o.map((x) => x.textContent.trim() + (x.selected ? ' *' : '')));
    assert.deepEqual(opts.slice(0, 3), ['Predio: La Esperanza', '· Lote: Cafetal *', 'Predio: El Retiro']);
    assert.equal(opts.length, 3);
    await page.selectOption('#repOne', (await lots())[1].id);
    await shot('v220-especifico');
    const f = await download(() => page.click('[data-act="shareReportHtml"]'));
    assert.equal(f.name, 'reporte-zona-de-vida-mi-primer-proyecto-el-retiro.html');
    assert.doesNotMatch(f.text, /Resumen del proyecto|class="lt"/);
    assert.equal(ctx(f.text.slice(f.text.indexOf('<h2>Croquis</h2>'), f.text.indexOf('</svg>', f.text.indexOf('<h2>Croquis</h2>')))), 2);
    assert.equal((await state()).projects[0].lotId, before, 'sigue elegido el mismo polígono');
    // la elección se recuerda al volver a abrir y al cambiar de pestaña de la hoja
    await page.click('[data-act="share"]');
    assert.equal(await page.inputValue('#repOne'), (await lots())[1].id);
    await page.click('#repScope [data-s="all"]'); await page.click('#repScope [data-s="one"]');
    assert.equal(await page.inputValue('#repOne'), (await lots())[1].id);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Un proyecto sin fincas no ofrece «Global»; con un solo lote no se pregunta nada', async () => {
    await fresh();
    await addPointManual('4.60, -74.08', 2600); await addPointManual('4.60, -74.07', 2650); await addPointManual('4.61, -74.075', 2700);
    await rain();
    await tab('informe'); await page.click('[data-act="share"]');
    assert.equal(await page.locator('#repScope').count(), 0);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

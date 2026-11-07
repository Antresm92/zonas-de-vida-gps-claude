'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { solidPng } = require('../helpers/png.js');
/* Recorrido 13 — versión 2.6.0 (y 2.7.1: ventana «Elaborando el reporte…»): «Compartir reporte» pregunta el formato y el PDF (hoja A4) sale con el mismo contenido que el HTML:
 * título, zona de vida, datos, clima, terreno, puntos, croquis (normal, satelital y topográfico), perfil, fotos y diagrama de Holdridge.
 * Los PDF descargados se guardan en la carpeta de capturas y, si el equipo tiene qpdf y poppler, se validan con ellos. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, waitToast, waitSheetClosed, addPointManual, download, shot, shots, sheetTitle, sheetOpen, compartir, context } = c;

  /* ---------- Ayudas ---------- */
  const tiene = (cmd) => spawnSync('which', [cmd]).status === 0;
  const HERRAMIENTAS = tiene('qpdf') && tiene('pdftotext') && tiene('pdfinfo');
  const guardar = (nombre, bytes) => { const f = path.join(shots, nombre + '.pdf'); fs.writeFileSync(f, Buffer.from(bytes)); return f; };
  const info = (f) => { const t = spawnSync('pdfinfo', [f], { encoding: 'utf8' }).stdout; return { pages: Number(/Pages:\s+(\d+)/.exec(t)[1]), size: /Page size:\s+(.*)/.exec(t)[1], title: /Title:\s+(.*)/.exec(t)[1] }; };
  const texto = (f) => spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout.replace(/[ \t]+/g, ' ');
  const valido = (f) => { const q = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' }); return { ok: q.status === 0 && !/WARNING/.test(q.stdout + q.stderr), out: q.stdout + q.stderr }; };
  const imagenes = (bytes) => (Buffer.from(bytes).toString('latin1').match(/\/Subtype \/Image /g) || []).length;
  // La ventana de progreso cambia de texto sin parar: se anota cada «título · detalle» que aparece mientras está visible (hay que volver a anotarlos después de cada recarga)
  const watchBusy = () => page.evaluate(() => {
    window.__busy = [];
    const el = document.querySelector('#busy');
    const anota = () => { if (!el.hidden) window.__busy.push(document.querySelector('#busyTitle').textContent + ' · ' + document.querySelector('#busyDetail').textContent); };
    new MutationObserver(anota).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  const seenBusy = () => page.evaluate(() => (window.__busy || []).slice());
  const pdf = () => download(() => compartir('Pdf'));
  const preparar = async () => {
    await fresh();
    await watchBusy();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await tab('clima');
    await page.fill('[data-field="pManual"]', '1800'); await page.press('[data-field="pManual"]', 'Enter');
    await page.waitForTimeout(300);
    await tab('informe');
  };
  const conPhoto = async () => {
    await tab('puntos');
    await page.click('[data-act="editPoint"] >> nth=0');
    await page.waitForSelector('#sheet #fPhotosWrap');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('photoGal')]);
    await chooser.setFiles({ name: 'cielo.png', mimeType: 'image/png', buffer: solidPng(40, 120, 200, 255, 1500) });
    await waitToast(/Foto guardada/, 10000);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await tab('informe');
  };
  let primero = null, f1 = null;

  /* ---------- La hoja de formato ---------- */
  await step('«Compartir reporte» abre una hoja que pregunta el formato (PDF o HTML); cerrarla sin elegir no descarga nada', async () => {
    await preparar();
    let n = 0; const cuenta = () => { n++; }; page.on('download', cuenta);
    try {
      await act('share');
      assert.equal(await sheetTitle(), 'Compartir reporte');
      const t = await text('#sheet');
      assert.match(t, /¿En qué formato quieres el reporte\?/);
      assert.equal(await page.locator('#sheet [data-act="shareReportPdf"]').innerText(), 'PDF (hoja A4)');
      assert.equal(await page.locator('#sheet [data-act="shareReportHtml"]').innerText(), 'HTML');
      assert.match(await page.getAttribute('#sheet [data-act="shareReportPdf"]', 'class'), /btn-primary/, 'el PDF es la opción principal');
      assert.match(t, /PDF: una hoja A4 lista para imprimir o enviar/);
      await shot('130-compartir-formato');
      await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
      await page.waitForTimeout(600);
      assert.equal(n, 0, 'no se descargó nada');
    } finally { page.off('download', cuenta); }
  });

  /* ---------- El PDF ---------- */
  await step('Elegir PDF: se descarga un PDF A4 con nombre del proyecto, la hoja se cierra y avisa que lo prepara', async () => {
    await preparar();
    f1 = await pdf();
    assert.equal(f1.name, 'reporte-zona-de-vida-mi-primer-proyecto.pdf');
    assert.equal(String.fromCharCode(...f1.bytes.subarray(0, 8)), '%PDF-1.4');
    assert.equal(String.fromCharCode(...f1.bytes.subarray(f1.bytes.length - 6)), '%%EOF\n');
    await waitSheetClosed();
    const etapas = await seenBusy();
    ['Elaborando el reporte en PDF · Dibujando los gráficos…', 'Elaborando el reporte en PDF · Armando las hojas del PDF…', 'Elaborando el reporte en PDF · Guardando el archivo…']
      .forEach((e) => assert.ok(etapas.includes(e), 'falta la etapa «' + e + '»: ' + JSON.stringify(etapas)));
    assert.ok(etapas.indexOf('Elaborando el reporte en PDF · Dibujando los gráficos…') < etapas.indexOf('Elaborando el reporte en PDF · Armando las hojas del PDF…'), 'las etapas salen en orden');
    assert.equal(await page.locator('#busy').isHidden(), true, 'la ventana de progreso se quitó al terminar');
    await waitToast(/^Reporte descargado: reporte-zona-de-vida-mi-primer-proyecto\.pdf$/, 10000);
    primero = guardar('131-reporte-3-puntos', f1.bytes);
    // croquis, satelital, topográfico, perfil y Holdridge son imágenes dentro del PDF
    assert.ok(imagenes(f1.bytes) >= 5, 'imágenes en el PDF: ' + imagenes(f1.bytes));
  });

  await step('El PDF es válido (qpdf), de hoja A4, y trae las mismas secciones y datos que el reporte HTML', async () => {
    if (!HERRAMIENTAS) { console.log('    (sin qpdf/poppler en este equipo: se omite la revisión con herramientas externas)'); return; }
    const v = valido(primero);
    assert.ok(v.ok, v.out);
    const i = info(primero);
    assert.match(i.size, /595\.28 x 841\.89 pts \(A4\)/);
    assert.match(i.title, /^Reporte de zona de vida · Mi primer proyecto$/);
    assert.ok(i.pages >= 3 && i.pages <= 8, 'hojas: ' + i.pages);
    const t = texto(primero);
    ['Reporte de zona de vida', 'Mi primer proyecto', 'Datos del clima', 'Altitud', 'Precipitación anual 1800 mm (ingresada por el usuario)', 'Terreno', 'Área', 'Perímetro',
      'Puntos', 'Abajo', 'Medio', 'Arriba', 'Croquis', 'Croquis satelital', 'Croquis topográfico', 'Perfil del relieve', 'Punto más alto', 'Diagrama de Holdridge',
      'Clasificación bioclimática orientativa', 'Página 1 de ' + i.pages, 'Página ' + i.pages + ' de ' + i.pages].forEach((s) => assert.ok(t.includes(s), 'falta «' + s + '» en el PDF'));
    assert.match(t, /Bosque|Páramo|Selva|Monte|Estepa|Desierto/, 'dice la zona de vida');
    assert.match(t, /Región latitudinal: .* Piso altitudinal: /);
  });

  await step('Con las mismas gráficas: ninguna sección de gráfica quedó en blanco ni cortada (se revisa la imagen de cada hoja)', async () => {
    if (!HERRAMIENTAS || !tiene('pdftoppm')) return;
    const dir = path.join(shots, 'pdf-hojas'); fs.mkdirSync(dir, { recursive: true });
    spawnSync('pdftoppm', ['-r', '40', '-gray', '-png', primero, path.join(dir, 'h')]);
    const hojas = fs.readdirSync(dir).filter((x) => /^h-\d+\.png$/.test(x));
    assert.equal(hojas.length, info(primero).pages);
    hojas.forEach((h) => assert.ok(fs.statSync(path.join(dir, h)).size > 1500, h + ' no debería estar en blanco'));
  });

  await step('Doble toque en «PDF» solo descarga un PDF', async () => {
    await preparar();
    let n = 0; const cuenta = () => { n++; }; page.on('download', cuenta);
    try {
      await act('share');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { const b = document.querySelector('[data-act="shareReportPdf"]'); b.click(); b.click(); })]);
      assert.match(dl.suggestedFilename(), /\.pdf$/);
      await page.waitForTimeout(1500);
      assert.equal(n, 1);
    } finally { page.off('download', cuenta); }
  });

  /* ---------- Fotos ---------- */
  await step('Con una foto en un punto, el PDF la lleva en «Fotos de los puntos» con su título y su leyenda', async () => {
    await preparar();
    await conPhoto();
    const f = await pdf();
    const antes = imagenes(f1.bytes);
    assert.equal(imagenes(f.bytes), antes + 1, 'una imagen más que sin foto');
    const ruta = guardar('132-reporte-con-foto', f.bytes);
    if (HERRAMIENTAS) {
      assert.ok(valido(ruta).ok);
      const t = texto(ruta);
      assert.match(t, /Fotos de los puntos/);
      assert.match(t, /Abajo/);
      assert.match(t, /Principal/);
      assert.match(t, /Fotos reducidas para este reporte/);
    }
  });

  /* ---------- Casos difíciles ---------- */
  await step('Con un solo punto, el PDF no trae croquis ni perfil (igual que el HTML) pero sí datos y diagrama', async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Único');
    await tab('clima');
    await page.fill('[data-field="pManual"]', '1800'); await page.press('[data-field="pManual"]', 'Enter');
    await page.waitForTimeout(300);
    await tab('informe');
    const f = await pdf();
    const ruta = guardar('133-reporte-un-punto', f.bytes);
    assert.equal(imagenes(f.bytes), 1, 'solo el diagrama de Holdridge');
    if (HERRAMIENTAS) {
      assert.ok(valido(ruta).ok);
      const t = texto(ruta);
      assert.match(t, /Único/);
      assert.match(t, /Diagrama de Holdridge/);
      assert.doesNotMatch(t, /Croquis satelital|Perfil del relieve/);
    }
  });

  await step('Sin internet el PDF se hace igual: avisa que el croquis satelital no se pudo preparar y trae todo lo demás', async () => {
    await preparar();
    await context.setOffline(true);
    try {
      const f = await pdf();
      const ruta = guardar('134-reporte-sin-internet', f.bytes);
      if (HERRAMIENTAS) {
        assert.ok(valido(ruta).ok);
        const t = texto(ruta);
        assert.match(t, /No se pudo preparar el croquis satelital/);
        assert.match(t, /No se pudo preparar el croquis topográfico/);
        assert.match(t, /Perfil del relieve/);
        assert.match(t, /Diagrama de Holdridge/);
      }
      assert.ok(imagenes(f.bytes) >= 3, 'croquis, perfil y Holdridge sí van');
    } finally { await context.setOffline(false); }
  });

  await step('Si el navegador no puede dibujar las gráficas, el PDF sale con avisos en su lugar y no se cae', async () => {
    await preparar();
    await page.evaluate(() => { window.__Image = window.Image; window.Image = class { set src(v) { setTimeout(() => { if (this.onerror) this.onerror(new Error('x')); }, 0); } }; });
    try {
      const f = await pdf();
      const ruta = guardar('135-reporte-sin-graficas', f.bytes);
      assert.equal(imagenes(f.bytes), 0, 'ninguna gráfica se pudo convertir');
      if (HERRAMIENTAS) {
        assert.ok(valido(ruta).ok);
        const t = texto(ruta);
        assert.match(t, /No se pudo dibujar el croquis en el PDF/);
        assert.match(t, /No se pudo dibujar el perfil del relieve en el PDF/);
        assert.match(t, /No se pudo dibujar el diagrama de Holdridge en el PDF/);
        assert.match(t, /Datos del clima/);
        assert.match(t, /Abajo/);
      }
    } finally { await page.evaluate(() => { window.Image = window.__Image; }); }
  });

  await step('Si no se puede guardar o compartir el archivo, avisa con el motivo y se puede volver a intentar', async () => {
    await preparar();
    await page.evaluate(() => { window.__saveBytes = window.IO.saveBytes; window.IO.saveBytes = () => Promise.reject(new Error('disco lleno')); });
    try {
      await act('share'); await act('shareReportPdf');
      await waitToast(/^No se pudo preparar el PDF: disco lleno$/, 15000);
      assert.equal(await page.locator('#busy').isHidden(), true, 'con el error, la ventana de progreso ya no está tapando el aviso');
    } finally { await page.evaluate(() => { window.IO.saveBytes = window.__saveBytes; }); }
    const f = await pdf();                                                  // y después funciona
    assert.equal(String.fromCharCode(...f.bytes.subarray(0, 5)), '%PDF-');
  });

  /* ---------- Ventana de progreso (2.7.1) ---------- */
  // Detiene el dibujo de las gráficas del PDF hasta que el recorrido lo suelta, para poder mirar la ventana con calma
  const retener = () => page.evaluate(() => {
    const orig = window.ReportPdf.rasterizeAll;
    window.__rasterOrig = orig;
    window.ReportPdf.rasterizeAll = function () { const args = arguments; return new Promise((r) => { window.__soltar = () => r(orig.apply(window.ReportPdf, args)); }); };
  });
  const soltar = () => page.evaluate(() => window.__soltar());
  const restaurar = () => page.evaluate(() => { if (window.__rasterOrig) window.ReportPdf.rasterizeAll = window.__rasterOrig; if (window.__setTimeoutOrig) window.setTimeout = window.__setTimeoutOrig; });
  const etapa = (t) => page.waitForFunction((x) => document.querySelector('#busyDetail').textContent === x, t, { timeout: 8000 });

  await step('Mientras se elabora el PDF se ve «Elaborando el reporte en PDF» con su ruedita, cubre toda la pantalla y no deja tocar lo de abajo', async () => {
    await preparar();
    await retener();
    try {
      await act('share'); await act('shareReportPdf');
      await page.waitForSelector('#busy:not([hidden])', { timeout: 3000 });
      await etapa('Dibujando los gráficos…');
      assert.equal(await text('#busyTitle'), 'Elaborando el reporte en PDF');
      assert.equal(await text('#busyNote'), 'Esto toma unos segundos. Por favor no cierres la app.');
      assert.equal(await page.getAttribute('#busy', 'role'), 'alertdialog');
      assert.equal(await page.getAttribute('#busy', 'aria-modal'), 'true');
      assert.equal(await page.locator('#busyHide').isHidden(), true, 'el botón de ocultar solo sale si tarda de más');
      const vp = page.viewportSize(), box = await page.locator('#busy').boundingBox();
      assert.ok(Math.abs(box.width - vp.width) < 1 && Math.abs(box.height - vp.height) < 1, 'cubre toda la pantalla: ' + JSON.stringify(box));
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.busy-spin')).animationName), 'busy-spin', 'la ruedita gira');
      // lo de abajo no recibe toques: el botón «Herramientas» queda tapado y tocarlo no cambia de pestaña
      const nav = await page.locator('#nav-herramientas').boundingBox();
      assert.equal(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y).closest('#busy'), { x: nav.x + nav.width / 2, y: nav.y + nav.height / 2 }), true);
      await page.mouse.click(nav.x + nav.width / 2, nav.y + nav.height / 2);
      assert.equal(await page.locator('#tab-herramientas').isHidden(), true, 'el toque no llegó a la barra de abajo');
      await shot('136-elaborando-reporte');
      const f = await download(() => soltar());
      assert.equal(String.fromCharCode(...f.bytes.subarray(0, 5)), '%PDF-');
      assert.equal(await page.locator('#busy').isHidden(), true, 'al terminar, la ventana se quita');
    } finally { await restaurar(); }
  });

  await step('Si tarda de más, la ventana lo dice y deja ocultar el aviso; el reporte sigue y se entrega igual', async () => {
    await preparar();
    await retener();
    // el aviso de «tarda de más» sale a los 30 s; aquí se acorta a 0,3 s solo para esta prueba
    await page.evaluate(() => { window.__setTimeoutOrig = window.setTimeout; const st = window.setTimeout; window.setTimeout = function (f, ms) { return st.apply(window, [f, ms === 30000 ? 300 : ms].concat([].slice.call(arguments, 2))); }; });
    try {
      await act('share'); await act('shareReportPdf');
      await etapa('Dibujando los gráficos…');
      await page.waitForSelector('#busyHide:not([hidden])', { timeout: 4000 });
      assert.match(await text('#busyNote'), /^Está tardando más de lo normal/);
      await page.click('#busyHide');
      assert.equal(await page.locator('#busy').isHidden(), true, 'ocultó el aviso');
      const f = await download(() => soltar());                                  // el trabajo no se canceló: el PDF sale igual
      assert.equal(String.fromCharCode(...f.bytes.subarray(0, 5)), '%PDF-');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#busy').isHidden(), true);
    } finally { await restaurar(); }
  });

  await step('La ventana no parpadea (aunque todo sea rápido se queda más de medio segundo) y se quita antes de entregar el archivo', async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Único');                    // sin croquis ni fotos: no hay nada lento
    await tab('clima');
    await page.fill('[data-field="pManual"]', '1800'); await page.press('[data-field="pManual"]', 'Enter');
    await page.waitForTimeout(300);
    await tab('informe');
    await page.evaluate(() => {
      window.__busyT = [];
      const el = document.querySelector('#busy');
      new MutationObserver(() => window.__busyT.push({ hidden: el.hidden, t: performance.now() })).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      window.__clickOrig = HTMLAnchorElement.prototype.click; window.__ocultoAlEntregar = null;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__ocultoAlEntregar = document.querySelector('#busy').hidden; return window.__clickOrig.apply(this, arguments); };
    });
    try {
      const f = await download(() => compartir('Html'));
      assert.match(f.name, /\.html$/);
      await page.waitForTimeout(200);
      const t = await page.evaluate(() => window.__busyT);
      const vis = t.find((x) => !x.hidden), oculto = t.filter((x) => x.hidden).pop();
      assert.ok(vis && oculto, 'se mostró y se quitó: ' + JSON.stringify(t));
      assert.ok(oculto.t - vis.t >= 450, 'se quedó visible ' + Math.round(oculto.t - vis.t) + ' ms');
      assert.equal(await page.evaluate(() => window.__ocultoAlEntregar), true, 'la ventana ya estaba quitada cuando se entregó el archivo');
    } finally { await page.evaluate(() => { if (window.__clickOrig) HTMLAnchorElement.prototype.click = window.__clickOrig; }); }
  });

  await step('La opción HTML de la misma hoja sigue entregando el reporte HTML con sus gráficos', async () => {
    await preparar();
    const f = await download(() => compartir('Html'));
    assert.match(f.name, /\.html$/);
    assert.match(f.text, /^<!doctype html>/);
    assert.match(f.text, /Diagrama de Holdridge/);
    assert.equal(await sheetOpen(), false);
  });
};

'use strict';
const { rgbaPng } = require('../helpers/png.js');
/* Recorrido 39 — versión 2.34.3: tarjeta profesional y firma al final del reporte, en foto (el papel queda blanco y se
 * recorta) o dibujada con el dedo (ratón y toques táctiles de verdad de Chromium). Una firma en imagen no es una firma
 * digital: el reporte lo dice debajo. La firma y la tarjeta no van en la copia de seguridad. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, addPointManual, download, waitSheetClosed, sheetTitle, errors, shot } = c;
  const tres = async () => {
    await addPointManual('4.60, -74.08', 2600, 'Portada');
    await addPointManual('4.60, -74.07', 2650);
    await addPointManual('4.61, -74.075', 2700);
    await tab('clima'); await fill('[data-field="pManual"]', '1200'); await page.press('[data-field="pManual"]', 'Enter');
  };
  // Foto de una firma en papel con sombra: el papel va de gris (izquierda) a casi blanco, la tinta es azul oscura
  const fotoFirma = () => rgbaPng(480, 240, (x, y) => {
    const paper = 150 + Math.round(70 * x / 479);
    const ink = (x > 80 && x < 400 && Math.abs(y - (120 + 40 * Math.sin(x / 30))) < 4) || (x > 100 && x < 108 && y > 70 && y < 170);
    return ink ? [30, 40, 110, 255] : [paper, paper, paper + 8, 255];
  });
  // Lo que quedó guardado: tamaño, esquinas (lo más oscuro de los tres canales) y cuánta tinta
  const mirar = (b64) => page.evaluate(async (b) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 90) dark++;
    const px = (X, Y) => { const i = (Y * cv.width + X) * 4; return Math.min(d[i], d[i + 1], d[i + 2]); };
    return { w: cv.width, h: cv.height, n: d.length / 4, dark, corners: [px(0, 0), px(cv.width - 1, 0), px(0, cv.height - 1), px(cv.width - 1, cv.height - 1)], gris: px(2, Math.floor(cv.height / 2)) };
  }, b64);
  const guardado = () => page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.author')));
  const imagenesPdf = (bytes) => Buffer.from(bytes).toString('latin1');
  let firmaFoto = null;

  await step('Tarjeta y firma en foto: el papel con sombra queda blanco, se recorta a la firma y sale al final del reporte con su aviso', async () => {
    await fresh(); await tres();
    await tab('herramientas');
    assert.match(await text('[data-act="authorEdit"]'), /Autor, entidad, logo y firma/);
    await act('authorEdit');
    assert.equal(await sheetTitle(), 'Encabezado del reporte');
    assert.match(await text('#auSign'), /Sin firma/);
    await fill('#auName', 'Ana Pérez');
    await fill('#auCard', '25202-123456 <b>');
    await page.setInputFiles('#signFile', { name: 'firma.png', mimeType: 'image/png', buffer: fotoFirma() });
    await page.waitForSelector('#auSign img');
    assert.equal(await page.inputValue('#auName'), 'Ana Pérez', 'lo escrito no se pierde al subir la foto');
    assert.equal(await page.inputValue('#auCard'), '25202-123456 <b>');
    assert.equal(await page.locator('[data-act="authorSignDel"]').count(), 1);
    await shot('v2343-firma-foto');
    await act('authorSave'); await waitSheetClosed();
    assert.match(await text('[data-act="authorEdit"]'), /Ana Pérez · con firma/);
    const g = await guardado();
    assert.equal(g.card, '25202-123456 <b>');
    assert.match(g.sign, /^\/9j\//);
    firmaFoto = await mirar(g.sign);
    assert.ok(firmaFoto.w < 400 && firmaFoto.h < 150, 'recortada a la firma (la foto era de 480 × 240): ' + firmaFoto.w + ' × ' + firmaFoto.h);
    assert.ok(firmaFoto.corners.every((v) => v >= 245) && firmaFoto.gris >= 245, 'el papel quedó blanco, también donde había sombra: ' + firmaFoto.corners + ' / ' + firmaFoto.gris);
    assert.ok(firmaFoto.dark > firmaFoto.n * 0.02, 'y la tinta, oscura: ' + firmaFoto.dark + ' de ' + firmaFoto.n);
    await tab('informe');
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /<section class="firma"><h2>Firma<\/h2><img class="firma-img" src="data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+" alt="Firma"><div class="firma-raya"><\/div><p class="firma-l"><b>Ana Pérez<\/b><\/p><p class="firma-l">Tarjeta profesional N\.º 25202-123456 &lt;b&gt;<\/p><p class="small">Firma en imagen\. No es una firma digital \(Ley 527 de 1999\): no se puede verificar, cualquiera que reciba el reporte podría copiarla y, si alguien lo cambia, la firma sigue igual\.<\/p><\/section>/);
    assert.ok(f.text.indexOf('<section class="firma">') < f.text.lastIndexOf('Clasificación bioclimática orientativa'), 'antes de la advertencia final');
    const pdf = await download(() => c.compartir('Pdf'));
    assert.ok(imagenesPdf(pdf.bytes).includes('/Width ' + firmaFoto.w + ' /Height ' + firmaFoto.h + ' '), 'la firma va en el PDF');
    await tab('herramientas'); await act('projects');
    const b = await download(() => page.click('[data-act="backupJson"]'));
    assert.ok(!b.text.includes(g.sign.slice(4, 80)) && !b.text.includes('25202-123456'), 'la firma y la tarjeta no van en la copia de seguridad');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Firma con el dedo: un toque no basta; se dibuja, se borra, se vuelve a dibujar y se usa sin perder lo escrito; «Cancelar» no cambia nada', async () => {
    await tab('herramientas'); await act('authorEdit');
    await fill('#auName', 'Ana María Pérez');                                     // sin guardar todavía
    await act('authorSignDraw');
    assert.equal(await sheetTitle(), 'Dibujar la firma');
    assert.equal(await page.locator('#signUse').isDisabled(), true);
    const box = await page.locator('#signPad').boundingBox();
    const trazo = async (pts) => {
      await page.mouse.move(box.x + pts[0][0], box.y + pts[0][1]); await page.mouse.down();
      for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 5 });
      await page.mouse.up();
    };
    await page.mouse.click(box.x + 40, box.y + 40);
    assert.equal(await page.locator('#signUse').isDisabled(), true, 'un toque no es una firma');
    await trazo([[30, 120], [80, 60], [130, 140], [180, 70], [230, 130]]);
    assert.equal(await page.locator('#signUse').isDisabled(), false);
    await act('signPadClear');
    assert.equal(await page.locator('#signUse').isDisabled(), true, '«Borrar» deja el recuadro vacío');
    await trazo([[30, 120], [80, 60], [130, 140], [180, 70], [230, 130]]);
    await trazo([[40, 150], [220, 150]]);
    await shot('v2343-firma-dedo');
    await act('signPadUse');
    await page.waitForSelector('#auSign img');
    assert.equal(await sheetTitle(), 'Encabezado del reporte');
    assert.equal(await page.inputValue('#auName'), 'Ana María Pérez', 'lo escrito no se pierde al dibujar');
    assert.equal(await page.inputValue('#auCard'), '25202-123456 <b>');
    const dibujada = await page.$eval('#auSign img', (i) => i.src.slice('data:image/jpeg;base64,'.length));
    const m = await mirar(dibujada);
    assert.ok(m.w <= 600 && m.h <= 240 && (m.w === 600 || m.h === 240), 'agrandada hasta el tope sin pasarlo: ' + m.w + ' × ' + m.h);
    assert.ok(m.corners.every((v) => v >= 245), 'fondo blanco: ' + m.corners);
    assert.ok(m.dark > m.n * 0.01, 'con tinta: ' + m.dark + ' de ' + m.n);
    await act('authorSignDraw');
    await trazo([[20, 20], [200, 100]]);
    await act('signPadBack');
    assert.equal(await sheetTitle(), 'Encabezado del reporte');
    assert.equal(await page.$eval('#auSign img', (i) => i.src.slice('data:image/jpeg;base64,'.length)), dibujada, '«Cancelar» deja la firma que había');
    await act('authorSave'); await waitSheetClosed();
    const g = await guardado();
    assert.equal(g.sign, dibujada); assert.equal(g.name, 'Ana María Pérez');
  });

  await step('Firma con el dedo, con toques táctiles de verdad: el trazo se dibuja y la hoja no se mueve', async () => {
    await tab('herramientas'); await act('authorEdit'); await act('authorSignDraw');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    try {
      const bx = await page.locator('#signPad').boundingBox();
      await page.evaluate(() => { window.__pt = []; document.addEventListener('pointerdown', (e) => window.__pt.push(e.pointerType), true); });
      const antes = await page.evaluate(() => [document.scrollingElement.scrollTop, (document.querySelector('#sheet .sheet-body') || {}).scrollTop || 0]);
      await touch('touchStart', bx.x + 30, bx.y + 100);
      for (let k = 1; k <= 12; k++) await touch('touchMove', bx.x + 30 + k * 16, bx.y + 100 + (k % 2 ? -30 : 30));
      await touch('touchEnd');
      assert.equal((await page.evaluate(() => window.__pt))[0], 'touch', 'el sistema mandó un toque, no el ratón');
      assert.equal(await page.locator('#signUse').isDisabled(), false, 'con el dedo también se firma');
      assert.deepEqual(await page.evaluate(() => [document.scrollingElement.scrollTop, (document.querySelector('#sheet .sheet-body') || {}).scrollTop || 0]), antes, 'firmar no desplaza la hoja');
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
    await act('signPadBack');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Solo la tarjeta: queda la raya para firmar a mano y sin aviso; sin tarjeta ni firma no hay bloque de firma', async () => {
    await tab('herramientas'); await act('authorEdit');
    await page.click('[data-act="authorSignDel"]');
    assert.match(await text('#auSign'), /Sin firma/);
    await act('authorSave'); await waitSheetClosed();
    assert.doesNotMatch(await text('[data-act="authorEdit"]'), /con firma/);
    await tab('informe');
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /<section class="firma"><h2>Firma<\/h2><div class="firma-sin"><\/div><div class="firma-raya"><\/div><p class="firma-l"><b>Ana María Pérez<\/b><\/p><p class="firma-l">Tarjeta profesional N\.º 25202-123456 &lt;b&gt;<\/p><\/section>/);
    assert.doesNotMatch(f.text, /Ley 527/);
    await tab('herramientas'); await act('authorEdit');
    await fill('#auCard', '');
    await act('authorSave'); await waitSheetClosed();
    await tab('informe');
    const g = await download(() => c.compartir('Html'));
    assert.doesNotMatch(g.text, /class="firma"/);
    assert.match(g.text, /Elaborado por: Ana María Pérez/, 'el encabezado sigue igual');
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

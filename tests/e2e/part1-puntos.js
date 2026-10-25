'use strict';
/* Recorrido 1 — pestaña Puntos: coordenadas a mano, listas pegadas, GPS simulado y precisión mínima. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, fill, text, proj, state, toastText, waitToast, sheetOpen, sheetTitle, waitSheetClosed, gpsPush, addPointManual, errors, shot } = c;

  await step('Primer arranque: proyecto vacío, 4 pestañas y GPS apagado', async () => {
    await fresh();
    assert.match(await text('#projName'), /Mi primer proyecto/);
    assert.equal(await page.locator('.tabs button').count(), 4);
    assert.match(await text('#gpsChipText'), /GPS apagado/);
    assert.match(await text('#tab-puntos'), /Aún no hay puntos/);
    assert.equal((await state()).settings.minAcc, 10);
    await shot('01-puntos-vacio');
  });

  await step('Escribir coordenadas: vista previa en grados y guardado con altitud', async () => {
    await act('addCoords');
    await fill('#fCoord', '4.6097, -74.0817');
    assert.match(await text('#fPrev'), /4° 36'/);
    await fill('#fAlt', '2640');
    await fill('#fName', 'Esquina 1');
    await page.click('[data-act="saveNew"][data-more="0"]');
    await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 1);
    assert.equal(p.points[0].name, 'Esquina 1');
    assert.equal(p.points[0].alt, 2640);
    assert.equal(p.points[0].altSrc, 'manual');
    assert.ok(Math.abs(p.points[0].lat - 4.6097) < 1e-9);
  });

  await step('Coordenadas con errores: avisa y no guarda nada', async () => {
    await act('addCoords');
    await page.click('[data-act="saveNew"][data-more="0"]');
    assert.match(await toastText(), /Escribe las coordenadas/);
    await fill('#fCoord', 'esto no es una coordenada');
    assert.equal(await page.locator('#fPrev.err').count(), 1);
    await page.click('[data-act="saveNew"][data-more="0"]');
    assert.equal((await proj()).points.length, 1);
    await fill('#fCoord', '4.61, -74.08');
    await fill('#fAlt', 'abc');
    await page.click('[data-act="saveNew"][data-more="0"]');
    assert.match(await toastText(), /Altitud/);
    assert.equal((await proj()).points.length, 1);
    await fill('#fAlt', '');
    await fill('#fCoord', '');
    await page.click('[data-act="saveNew"][data-more="0"]');
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Guardar y añadir otro, sin altitud (queda «sin altitud»)', async () => {
    await act('addCoords');
    await fill('#fCoord', `4°36'35"N 74°04'54"W`);
    await page.click('[data-act="saveNew"][data-more="1"]');
    assert.equal(await sheetTitle(), 'Escribir coordenadas');
    assert.equal(await page.inputValue('#fCoord'), '');
    await fill('#fCoord', '4.6105, -74.0809');
    await fill('#fAlt', '2655,5');
    await page.click('[data-act="saveNew"][data-more="0"]');
    await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 3);
    assert.equal(p.points[1].alt, null);
    assert.equal(p.points[2].alt, 2655.5);
    assert.match(await text('#tab-puntos'), /sin altitud/);
  });

  await step('Editar un punto, cambiar su altitud y eliminarlo con «Deshacer»', async () => {
    await page.locator('[data-act="editPoint"]').nth(1).click();
    assert.match(await sheetTitle(), /Editar P2/);
    await fill('#fName', 'Esquina 2');
    await fill('#fAlt', '2650');
    await page.click('[data-act="saveEdit"]');
    await waitSheetClosed();
    let p = await proj();
    assert.equal(p.points[1].name, 'Esquina 2');
    assert.equal(p.points[1].alt, 2650);
    assert.equal(p.points[1].altSrc, 'manual');
    // dato inválido al editar
    await page.locator('[data-act="editPoint"]').nth(1).click();
    await fill('#fCoord', 'zzz');
    await page.click('[data-act="saveEdit"]');
    assert.equal(await sheetOpen(), true);
    await fill('#fCoord', '4.61, -74.08');
    await fill('#fAlt', 'x');
    await page.click('[data-act="saveEdit"]');
    assert.match(await toastText(), /Altitud/);
    await fill('#fAlt', '');
    await page.click('[data-act="saveEdit"]');
    await waitSheetClosed();
    p = await proj();
    assert.equal(p.points[1].alt, null);
    // eliminar y deshacer
    await page.locator('[data-act="editPoint"]').nth(1).click();
    await act('askDelete');
    assert.match(await sheetTitle(), /¿Eliminar Esquina 2\?/);
    await act('doDelete');
    await waitSheetClosed();
    assert.equal((await proj()).points.length, 2);
    await page.click('[data-act="toastAction"]');
    p = await proj();
    assert.equal(p.points.length, 3);
    assert.equal(p.points[1].name, 'Esquina 2');
  });

  await step('Pegar varias coordenadas: acepta nombres y altitudes, y rechaza líneas dañadas sin agregar nada', async () => {
    await act('addBulk');
    await fill('#bulk', '4.62, -74.09 | 2700 | Lindero norte\n4.621, -74.091');
    assert.match(await text('#bulkPrev'), /2 punto\(s\) válidos/);
    await fill('#bulk', '4.62, -74.09\nhola mundo');
    assert.match(await text('#bulkPrev'), /Línea 2/);
    await act('saveBulk');
    assert.match(await toastText(), /no se agregó nada/);
    await fill('#bulk', '4.62, -74.09 | mucho');
    assert.match(await text('#bulkPrev'), /altitud no válida/);
    await fill('#bulk', '');
    await act('saveBulk');
    assert.match(await toastText(), /Línea|Escribe/);
    await fill('#bulk', '4.62, -74.09 | 2700 | Lindero norte\n4.621, -74.091');
    await act('saveBulk');
    await waitSheetClosed();
    const p = await proj();
    assert.equal(p.points.length, 5);
    assert.equal(p.points[3].name, 'Lindero norte');
    assert.equal(p.points[3].alt, 2700);
  });

  await step('GPS: se enciende, muestra posición y precisión, y explica los errores', async () => {
    await act('gpsOn');
    assert.match(await text('#gpsChipText'), /Buscando/);
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 4 });
    assert.match(await text('#gpsChipText'), /±4 m/);
    assert.match(await text('#rLat'), /4\.6097/);
    assert.match(await text('#rAlt'), /2639/);
    assert.equal(await page.locator('#precBanner.okmsg').count(), 1);
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: null, acc: null });
    assert.match(await text('#gpsChipText'), /GPS activo/);
    assert.match(await text('#rAlt'), /sin dato/);
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 20 });
    assert.equal(await page.evaluate(() => document.querySelector('#gpsChip').className), 'chip chip-warn');
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 45 });
    assert.equal(await page.evaluate(() => document.querySelector('#gpsChip').className), 'chip chip-bad');
    await page.evaluate(() => window.__gps.error(2));
    assert.match(await toastText(), /No hay señal de GPS/);
    await page.evaluate(() => window.__gps.error(3));
    assert.match(await toastText(), /tardó demasiado/);
    await shot('02-gps-encendido');
  });

  await step('Marcar un punto con GPS: promedia, guarda altitud del GPS y conserva su origen al renombrar', async () => {
    await page.selectOption('[data-setting="minAcc"]', '5');
    assert.equal((await state()).settings.minAcc, 5);
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 3 });
    await act('mark');
    assert.equal(await page.locator('#progBar').count(), 1);
    await gpsPush({ lat: 4.60971, lon: -74.08171, alt: 2639.4, acc: 3 }, 5);
    await waitToast(/guardado \(±3 m/);
    let p = await proj();
    const pt = p.points[p.points.length - 1];
    assert.equal(pt.altSrc, 'gps');
    assert.equal(pt.src, 'gps');
    assert.equal(pt.acc, 3);
    // renombrar no toca el origen de la altitud (el campo muestra 2639 y la guardada es 2639,4)
    await page.locator('[data-act="editPoint"]').last().click();
    await fill('#fName', 'Mojón GPS');
    await page.click('[data-act="saveEdit"]');
    await waitSheetClosed();
    p = await proj();
    assert.equal(p.points[p.points.length - 1].altSrc, 'gps');
    assert.equal(p.points[p.points.length - 1].alt, 2639.4);
    // corregir a mano y restaurar la del GPS
    await page.locator('[data-act="editPoint"]').last().click();
    await fill('#fAlt', '2700');
    await page.click('[data-act="saveEdit"]');
    await waitSheetClosed();
    p = await proj();
    assert.equal(p.points[p.points.length - 1].altSrc, 'manual');
    await page.locator('[data-act="editPoint"]').last().click();
    await act('restoreGps');
    p = await proj();
    assert.equal(p.points[p.points.length - 1].altSrc, 'gps');
    assert.equal(p.points[p.points.length - 1].alt, 2639.4);
  });

  await step('Usar la altitud del GPS al escribir coordenadas a mano', async () => {
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2641.8, acc: 3 });
    await act('addCoords');
    await act('altFromGps');
    assert.equal(await page.inputValue('#fAlt'), '2642');
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Precisión mínima: avisa antes de marcar, deja esperar o marcar igual, y señala el punto menos preciso', async () => {
    await page.selectOption('[data-setting="minAcc"]', '3');
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 12 });
    assert.equal(await page.locator('#precBanner.warn').count(), 1);
    assert.match(await text('#precBanner'), /peor que el mínimo que elegiste \(±3 m\)/);
    await act('mark');
    assert.equal(await sheetTitle(), 'La precisión del GPS es baja');
    assert.equal(await page.locator('#progBar').count(), 0);
    await shot('03-precision-baja');
    await page.click('#sheet [data-act="closeSheet"].btn'); await waitSheetClosed();
    const before = (await proj()).points.length;
    assert.equal(before, 6);
    await act('mark');
    await act('markAnyway');
    await waitSheetClosed();
    assert.equal(await page.locator('#progBar').count(), 1);
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 12 }, 4);
    await waitToast(/este punto no es el más preciso/, 14000);
    assert.equal((await proj()).points.length, before + 1);
    assert.match(await text('#tab-puntos'), /menos preciso que tu mínimo/);
    await shot('04-punto-menos-preciso');
    await page.click('[data-act="toastAction"]');
    assert.equal((await proj()).points.length, before);
  });

  await step('Cancelar un marcado y esperar sin lecturas (tiempo agotado)', async () => {
    await page.selectOption('[data-setting="minAcc"]', '0');
    await gpsPush({ lat: 4.6097, lon: -74.0817, alt: 2639.4, acc: 3 });
    await act('mark');
    await act('cancelMark');
    await page.waitForSelector('#progBar', { state: 'detached' });
    assert.equal((await proj()).points.length, 6);
    await act('mark');
    await waitToast(/Tiempo agotado|No se pudo leer el GPS/, 14000);
    assert.equal((await proj()).points.length, 6);
  });

  await step('Sin permiso de ubicación: apaga el GPS y explica cómo activarlo', async () => {
    await page.evaluate(() => window.__gps.error(1));
    assert.match(await toastText(), /Sin permiso de ubicación/);
    assert.match(await text('#gpsChipText'), /GPS apagado/);
  });

  await step('Al ocultar la app el GPS se apaga y al volver se enciende solo', async () => {
    await act('gpsOn');
    const hide = (v) => page.evaluate((hidden) => { Object.defineProperty(document, 'hidden', { value: hidden, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
    await hide(true);
    assert.match(await text('#gpsChipText'), /GPS apagado/);
    await hide(false);
    assert.match(await text('#gpsChipText'), /Buscando/);
    await act('gpsOff');
    assert.match(await text('#gpsChipText'), /GPS apagado/);
  });

  await step('Los ajustes y los puntos siguen ahí después de cerrar y abrir la app', async () => {
    await page.selectOption('[data-setting="minAcc"]', '5');
    await page.reload();
    await page.waitForSelector('#tab-puntos');
    const s = await state();
    assert.equal(s.settings.minAcc, 5);
    assert.equal(s.projects[0].points.length, 6);
    assert.equal(await page.inputValue('[data-setting="minAcc"]'), '5');
  });

  await step('Un aviso visible no tapa los botones de la ventana que se abre (Guardar y añadir otro)', async () => {
    await fresh();
    await act('addCoords'); await fill('#fCoord', '4.6, -74.08');
    await page.click('[data-act="saveNew"][data-more="1"]');
    await waitToast(/guardado/);
    await page.waitForSelector('#sheet [data-act="saveNew"]');
    const choque = await page.evaluate(() => {
      const t = document.querySelector('#toast').getBoundingClientRect();
      return [...document.querySelectorAll('#sheet button, #sheet input')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
      }).map((b) => b.textContent.trim() || b.id);
    });
    assert.deepEqual(choque, [], 'el aviso tapa: ' + choque.join(', '));
    await shot('05-aviso-con-ventana');
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

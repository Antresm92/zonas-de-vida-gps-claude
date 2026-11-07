'use strict';
const Backup = require('../../www/js/backup.js');
const Zip = require('../../www/js/zip.js');
const { solidPng } = require('../helpers/png.js');
/* Recorrido 12 — versión 2.5.0: fotos de los puntos (galería y cámara del sistema), foto en grande, lista, reporte y las tres copias de seguridad:
 * completa (.zip, con fotos), liviana (.json, sin fotos) y pesada (.json con las fotos dentro); restaurar y limpieza de fotos sin uso. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, state, toastText, waitToast: esperarAviso, waitSheetClosed, addPointManual, download, setFile, errors, shot, sheetTitle, sheetOpen } = c;

  /* ---------- Ayudas ---------- */
  const png = (size, rgb) => solidPng(rgb ? rgb[0] : 40, rgb ? rgb[1] : 120, rgb ? rgb[2] : 200, 255, size);
  const archivo = (name, size, rgb) => ({ name, mimeType: 'image/png', buffer: png(size, rgb) });
  // Reducir una foto (decodificar, dibujar en un lienzo, guardar en IndexedDB) tarda más que otros avisos, sobre todo si el equipo está ocupado: se espera hasta 10 s
  const waitToast = (re, ms) => esperarAviso(re, ms || 10000);
  const dbOpen = `new Promise((res, rej) => { const r = indexedDB.open('zvg.v1.photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })`;
  const dbKeys = () => page.evaluate(`(async () => { const db = await ${dbOpen}; return new Promise((res) => { const q = db.transaction('fotos').objectStore('fotos').getAllKeys(); q.onsuccess = () => { db.close(); res(q.result); }; }); })()`);
  const dbGet = (id) => page.evaluate(`(async () => { const db = await ${dbOpen}; return new Promise((res) => { const q = db.transaction('fotos').objectStore('fotos').get(${JSON.stringify(id)}); q.onsuccess = () => { db.close(); const r = q.result; res(r ? { type: r.type, n: r.n, bytes: Array.from(new Uint8Array(r.data)) } : null); }; }); })()`);
  const dbClear = async () => { await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('zvg.v1.photos'); r.onsuccess = r.onerror = r.onblocked = () => res(); })); };
  const limpio = async () => { await fresh(); await dbClear(); await page.goto(page.url()); await page.waitForSelector('#tab-puntos'); errors.length = 0; };
  const fotosDe = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId).points[0].photos || []; };
  const abrirFicha = async (n) => { await tab('puntos'); await page.click('[data-act="editPoint"] >> nth=' + (n || 0)); await page.waitForSelector('#sheet #fPhotosWrap'); };
  const cerrarFicha = async () => { if (await sheetOpen()) { await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed(); } };
  // Antes de cada paso el recorrido cierra cualquier ventana abierta: los pasos que usan la ficha la vuelven a abrir
  const otraVez = async () => { if (!(await sheetOpen())) await abrirFicha(0); };
  const conteo = () => text('#fPhotosWrap .flabel');
  const cargadas = (sel) => page.waitForFunction((s) => { const l = document.querySelectorAll(s); return l.length > 0 && Array.from(l).every((i) => i.complete && i.naturalWidth > 0); }, sel, { timeout: 5000 });
  const sof = (b) => { for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }; i += 2 + ((b[i + 2] << 8) | b[i + 3]); } return null; };
  const hasAscii = (bytes, s) => { const t = Array.from(s).map((x) => x.charCodeAt(0)); for (let i = 0; i + t.length <= bytes.length; i++) { if (t.every((v, k) => bytes[i + k] === v)) return true; } return false; };
  const sheetText = () => text('#sheet');
  let ids = [], zipFile = null, jsonFile = null, heavyFile = null;

  /* ---------- Fotos en la ficha ---------- */
  await step('Ficha del punto: sección «Fotos (0 de 5)» con «Tomar foto» y «Galería»; la cámara pide la cámara y la galería deja elegir varias', async () => {
    await limpio();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await abrirFicha(0);
    assert.equal(await conteo(), 'Fotos (0 de 5)');
    assert.equal(await page.locator('#fPhotosWrap [data-act="photoCam"]').innerText(), 'Tomar foto');
    assert.equal(await page.locator('#fPhotosWrap [data-act="photoGal"]').innerText(), 'Galería');
    assert.equal(await page.getAttribute('#photoCam', 'capture'), 'environment');
    assert.match(await page.getAttribute('#photoCam', 'accept'), /^image\//);
    assert.equal(await page.getAttribute('#photoGal', 'multiple'), '');
    assert.match(await text('#fPhotosWrap'), /Las fotos se guardan al instante en este teléfono/);
    assert.match(await text('#fPhotosWrap'), /no conservan la ubicación del archivo original/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('photoCam')]);
    assert.equal(chooser.isMultiple(), false, 'la cámara toma una foto cada vez');
    await chooser.setFiles(archivo('camara.png', 1600, [200, 60, 60]));
    await waitToast(/Foto guardada/);
    assert.equal(await conteo(), 'Fotos (1 de 5)');
    await shot('120-ficha-una-foto');
  });

  await step('La foto se guarda al instante, reducida a 1280 px y en JPEG, sin los datos del archivo original, y sin tocar «Guardar cambios»', async () => {
    await otraVez();
    const l = await fotosDe();
    assert.equal(l.length, 1);
    assert.match(l[0].id, /^[A-Za-z0-9_\-]{1,40}$/);
    assert.deepEqual([l[0].w, l[0].h], [1280, 1280], 'una de 1600 px se reduce a 1280');
    ids = [l[0].id];
    const rec = await dbGet(ids[0]);
    assert.equal(rec.type, 'image/jpeg'); assert.equal(rec.n, rec.bytes.length); assert.equal(l[0].n, rec.n);
    assert.deepEqual(rec.bytes.slice(0, 3), [0xFF, 0xD8, 0xFF], 'es un JPEG');
    assert.deepEqual(sof(rec.bytes), { w: 1280, h: 1280 });
    assert.equal(hasAscii(rec.bytes, 'Exif'), false, 'sin EXIF (ahí viaja la ubicación de la foto)');
    assert.ok(rec.n < 200000, 'pesa unos KB, no los MB de la foto original: ' + rec.n);
    assert.equal(await page.locator('#fPhotosWrap .pbadge').innerText(), 'Principal');
    await cargadas('#fPhotosWrap img');
  });

  await step('Hasta 5 fotos por punto: lo que sobra se avisa y con 5 los botones se desactivan', async () => {
    await otraVez();
    await page.setInputFiles('#photoGal', [archivo('a.png', 300, [10, 200, 10]), archivo('b.png', 300, [200, 200, 10]), archivo('c.png', 300, [10, 200, 200]), archivo('d.png', 300, [200, 10, 200]), archivo('e.png', 300, [100, 100, 255])]);
    const t = await waitToast(/guardadas/);
    assert.match(t, /4 fotos guardadas/);
    assert.match(t, /Solo caben 5 por punto: se omitieron 1/);
    assert.equal(await conteo(), 'Fotos (5 de 5)');
    assert.equal(await page.locator('#fPhotosWrap [data-act="photoCam"]').isDisabled(), true);
    assert.equal(await page.locator('#fPhotosWrap [data-act="photoGal"]').isDisabled(), true);
    assert.match(await text('#fPhotosWrap'), /ya tiene 5 fotos\. Quita una para agregar otra/);
    const l = await fotosDe(); assert.equal(l.length, 5); ids = l.map((f) => f.id);
    assert.equal(new Set(ids).size, 5, 'cada foto con su propio id');
    assert.equal((await dbKeys()).length, 5);
    await cargadas('#fPhotosWrap img');
    await shot('121-ficha-cinco-fotos');
  });

  await step('«Hacer principal» pasa la foto al primer lugar; solo la primera lleva la etiqueta «Principal»', async () => {
    await otraVez();
    const tercera = ids[2];
    await page.click('[data-act="photoMain"][data-fid="' + tercera + '"]');
    await waitToast(/Ahora es la foto principal/);
    const l = await fotosDe();
    assert.equal(l[0].id, tercera);
    assert.deepEqual(l.slice(1).map((f) => f.id), [ids[0], ids[1], ids[3], ids[4]], 'las demás conservan su orden');
    assert.equal(await page.locator('#fPhotosWrap .pbadge').count(), 1);
    assert.equal(await page.locator('#fPhotosWrap .pcard').first().locator('.pbadge').count(), 1);
    assert.equal(await page.locator('#fPhotosWrap [data-act="photoMain"]').count(), 4, 'la principal no ofrece «Hacer principal»');
    ids = l.map((f) => f.id);
  });

  await step('«Quitar» saca la foto y «Deshacer» la devuelve al mismo lugar; la imagen no se borra hasta que se confirme al abrir la app', async () => {
    await otraVez();
    const segunda = ids[1];
    await page.click('[data-act="photoDel"][data-fid="' + segunda + '"]');
    await waitToast(/Foto quitada/);
    assert.equal(await conteo(), 'Fotos (4 de 5)');
    assert.equal((await fotosDe()).some((f) => f.id === segunda), false);
    assert.equal((await dbKeys()).length, 5, 'la imagen sigue guardada por si se deshace');
    await page.click('[data-act="toastAction"]');
    assert.equal(await conteo(), 'Fotos (5 de 5)');
    assert.deepEqual((await fotosDe()).map((f) => f.id), ids, 'volvió a su lugar');
    await cargadas('#fPhotosWrap img');
  });

  await step('Foto en grande: se abre al tocarla y se cierra con ×, con tocar fuera, con Escape y con el botón Atrás', async () => {
    await otraVez();
    const abrir = async () => { await page.click('[data-act="photoView"] >> nth=0'); await page.waitForSelector('#lightbox'); await cargadas('#lightbox img'); };
    await abrir();
    assert.equal(await page.getAttribute('#lightbox', 'role'), 'dialog');
    assert.equal(await page.getAttribute('#lightbox img', 'alt'), 'Foto en grande');
    await shot('122-foto-en-grande');
    await page.click('.lbclose'); await page.waitForSelector('#lightbox', { state: 'detached' });
    assert.equal(await c.page.evaluate(() => !document.querySelector('#sheet').hidden), true, 'la ficha sigue abierta debajo');
    await abrir(); await page.keyboard.press('Escape'); await page.waitForSelector('#lightbox', { state: 'detached' });
    await abrir(); await page.goBack(); await page.waitForSelector('#lightbox', { state: 'detached' });
    assert.equal(await c.page.evaluate(() => !document.querySelector('#sheet').hidden), true, 'Atrás cerró solo la foto, no la ficha');
    await abrir(); await page.mouse.click(195, 400); await page.waitForSelector('#lightbox', { state: 'detached' });
  });

  await step('Lo que no es una imagen o está dañado no se guarda y el aviso lo dice sin perder las fotos que ya hay', async () => {
    await otraVez();
    await page.click('[data-act="photoDel"] >> nth=4'); await waitToast(/Foto quitada/);        // hace sitio
    assert.equal(await conteo(), 'Fotos (4 de 5)');
    await page.setInputFiles('#photoGal', { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
    assert.match(await waitToast(/No se pudo guardar la foto/), /no es una imagen/);
    await page.setInputFiles('#photoGal', { name: 'rota.png', mimeType: 'image/png', buffer: Buffer.from('esto no es un png') });
    await waitToast(/No se pudo guardar la foto/);
    await page.setInputFiles('#photoGal', { name: 'vacia.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    assert.match(await waitToast(/No se pudo guardar la foto/), /vacío|no es una imagen/);
    assert.equal(await conteo(), 'Fotos (4 de 5)', 'nada cambió');
    await page.setInputFiles('#photoGal', archivo('quinta.png', 200, [90, 90, 90]));
    await waitToast(/Foto guardada/);
    assert.equal(await conteo(), 'Fotos (5 de 5)');
    ids = (await fotosDe()).map((f) => f.id);
  });

  await step('Al cerrar la ficha, la lista de Puntos muestra las miniaturas y el Reporte la sección «Fotos de los puntos»', async () => {
    await cerrarFicha();
    await tab('puntos');
    assert.equal(await page.locator('#tab-puntos .row >> nth=0').locator('.pstrip img').count(), 5);
    assert.equal(await page.locator('#tab-puntos .row >> nth=1').locator('.pstrip').count(), 0, 'los puntos sin foto no llevan tira');
    await cargadas('#tab-puntos .pstrip img');
    const desborde = await page.evaluate(() => Array.from(document.querySelectorAll('#tab-puntos .row')).map((r) => { const b = r.getBoundingClientRect(); const a = r.querySelector('.alt'); return { fila: Math.round(b.right), alt: a ? Math.round(a.getBoundingClientRect().right) : 0, ancho: window.innerWidth }; }));
    desborde.forEach((d) => assert.ok(d.alt <= d.ancho && d.fila <= d.ancho, 'la altitud y la fila caben en la pantalla aunque haya 5 miniaturas: ' + JSON.stringify(d)));
    await shot('123-lista-con-fotos');
    await tab('clima'); await page.fill('[data-field="pManual"]', '1200'); await page.press('[data-field="pManual"]', 'Enter');
    await tab('informe');
    const bloque = await page.evaluate(() => { const h = Array.from(document.querySelectorAll('#tab-informe h2')).find((x) => x.textContent === 'Fotos de los puntos'); return h ? h.parentElement.textContent : ''; });
    assert.match(bloque, /5 fotos en 1 punto de 3/);
    assert.match(bloque, /2 puntos no tienen foto: Medio, Arriba/);
    await cargadas('#tab-informe .pgrid-sm img');
  });

  await step('Reporte compartido: lleva las fotos dentro del archivo, reducidas a 900 px', async () => {
    await tab('informe');
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /<h2>Fotos de los puntos<\/h2>/);
    const imgs = [...f.text.matchAll(/<img src="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/g)].map((m) => new Uint8Array(Buffer.from(m[1], 'base64')));
    assert.equal(imgs.length, 5);
    assert.deepEqual(imgs.map((b) => [b[0], b[1], b[2]]), Array(5).fill([0xFF, 0xD8, 0xFF]));
    assert.ok(Math.max(...imgs.map((b) => Math.max(sof(b).w, sof(b).h))) <= 900, 'ninguna pasa de 900 px');
    assert.equal((f.text.match(/<figcaption>Principal<\/figcaption>/g) || []).length, 1);
    assert.match(f.text, /<span class="dot" style="background:#2F8F4E"><\/span>Abajo/);
  });

  /* ---------- Las dos copias de seguridad ---------- */
  await step('Proyectos → Copia de seguridad: tres botones, «Copia completa (.zip)», «Copia liviana (.json)» y «Copia pesada (.json con fotos)», y se explica para qué sirve cada una', async () => {
    await act('projects');
    assert.equal(await page.locator('[data-act="backupZip"]').innerText(), 'Copia completa (.zip)');
    assert.equal(await page.locator('[data-act="backupJson"]').innerText(), 'Copia liviana (.json)');
    assert.equal(await page.locator('[data-act="backupJsonFotos"]').innerText(), 'Copia pesada (.json con fotos)');
    assert.equal(await page.locator('[data-act="backupJsonFotos"]').isDisabled(), false, 'hay fotos: se puede');
    const t = await sheetText();
    assert.match(t, /\.zip: la copia completa para esta app; incluye las fotos de los puntos/);
    assert.match(t, /\.json liviano: sin fotos; sirve para llevar tus proyectos a otros dispositivos/);
    assert.match(t, /\.json pesado: el mismo \.json con las fotos dentro, para llevar también las fotos a otros dispositivos; hoy pesaría unos [\d.,]+ (KB|MB) \(5 fotos, y el texto ocupa un tercio más que la imagen\)/);
    assert.match(t, /«Restaurar» entiende los tres/);
    assert.equal(await page.locator('[data-act="backupExport"]').count(), 0, 'ya no hay un botón único que decide solo');
    await shot('124-tres-copias');
  });

  await step('Copia completa (.zip): un ZIP con copia.json y las 5 fotos tal como están guardadas', async () => {
    await act('projects');
    const f = await download(() => page.click('[data-act="backupZip"]'));
    assert.match(f.name, /^zonas-de-vida-copia-\d{4}-\d{2}-\d{2}\.zip$/);
    assert.equal(Zip.isZip(f.bytes), true);
    zipFile = f;
    const nombres = Zip.entries(f.bytes).map((e) => e.name).sort();
    assert.equal(nombres.length, 6);
    assert.ok(nombres.includes('copia.json'));
    assert.deepEqual(nombres.filter((n) => n !== 'copia.json'), ids.map((i) => 'fotos/' + i + '.jpg').sort());
    const z = Backup.readZip(f.bytes);
    assert.equal(z.skipped, 0);
    const v = Backup.validate(z.raw, { photos: z.photos });
    assert.equal(v.ok, true, v.errors.join('; ')); assert.deepEqual(v.warnings, []);
    assert.equal(v.summary.photos, 5);
    for (const id of ids) assert.deepEqual(Array.from(z.photos[id]), (await dbGet(id)).bytes, 'la foto ' + id + ' es idéntica a la guardada');
    const t = await waitToast(/Copia descargada/);
    assert.match(t, /Incluye 5 fotos/);
  });

  await step('Copia liviana (.json): sin fotos, con los mismos proyectos, y el aviso dice que las fotos no van', async () => {
    await act('projects');
    const f = await download(() => page.click('[data-act="backupJson"]'));
    assert.match(f.name, /^zonas-de-vida-copia-\d{4}-\d{2}-\d{2}\.json$/);
    jsonFile = f;
    const raw = JSON.parse(f.text);
    assert.equal(raw.summary.photos, 0);
    raw.state.projects.forEach((p) => p.points.forEach((q) => assert.equal('photos' in q, false)));
    assert.doesNotMatch(f.text, new RegExp(ids[0]));
    assert.ok(f.bytes.length < zipFile.bytes.length, 'el .json pesa menos que el .zip');
    const v = Backup.validate(raw);
    assert.equal(v.ok, true); assert.deepEqual(v.warnings, []);
    assert.equal(v.summary.points, 3);
    const t = await waitToast(/Copia descargada/);
    assert.match(t, /No incluye las 5 fotos de tus puntos: para guardarlas usa la copia completa \(\.zip\)/);
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Copia pesada (.json con fotos): un solo .json con las 5 fotos dentro como texto, idénticas a las guardadas, y pesa más que la liviana', async () => {
    await act('projects');
    const f = await download(() => page.click('[data-act="backupJsonFotos"]'));
    assert.match(f.name, /^zonas-de-vida-copia-fotos-\d{4}-\d{2}-\d{2}\.json$/, 'el nombre dice que lleva fotos');
    heavyFile = f;
    const raw = JSON.parse(f.text);
    assert.equal(raw.app, 'zonas-de-vida-gps');
    assert.equal(raw.summary.photos, 5);
    assert.deepEqual(Object.keys(raw.photos).sort(), ids.slice().sort());
    const pj = Backup.photosFromJson(raw);
    assert.equal(pj.skipped, 0);
    for (const id of ids) assert.deepEqual(Array.from(pj.photos[id]), (await dbGet(id)).bytes, 'la foto ' + id + ' es idéntica a la guardada');
    const v = Backup.validate(raw, { photos: pj.photos });
    assert.equal(v.ok, true, v.errors.join('; ')); assert.deepEqual(v.warnings, []); assert.equal(v.summary.photos, 5);
    assert.ok(f.bytes.length > jsonFile.bytes.length * 3, 'pesa mucho más que la liviana: ' + f.bytes.length + ' contra ' + jsonFile.bytes.length);
    assert.ok(f.bytes.length > zipFile.bytes.length, 'y más que el .zip (el texto ocupa un tercio más que la imagen)');
    const t = await waitToast(/Copia descargada/);
    assert.match(t, /\(pesa unos [\d.,]+ (KB|MB)\)/); assert.match(t, /Incluye 5 fotos/);
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Copia pesada: si las fotos pasan el tope de un .json avisa y manda a la copia completa, sin crear ningún archivo', async () => {
    await act('projects');
    await page.evaluate(() => { window.Backup.LIMITS.jsonPhotoBytes = 1000; });
    let bajo = false;
    page.once('download', () => { bajo = true; });
    await act('backupJsonFotos');
    const t = await waitToast(/demasiadas para meterlas en un \.json/);
    assert.match(t, /Usa la copia completa \(\.zip\)/);
    await page.waitForTimeout(300);
    assert.equal(bajo, false, 'no se descargó nada');
    await page.evaluate(() => { window.Backup.LIMITS.jsonPhotoBytes = 40 * 1024 * 1024; });
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Sin fotos en el teléfono, la copia completa sigue siendo un .zip válido, la pesada se desactiva y la liviana no menciona fotos', async () => {
    await page.evaluate(() => { window.__app.S.projects[0].points.forEach((p) => { delete p.photos; }); });
    await act('projects');
    assert.equal(await page.locator('[data-act="backupJsonFotos"]').isDisabled(), true, 'sin fotos no hay nada que meter');
    assert.match(await sheetText(), /todavía no hay fotos que incluir/);
    const z = await download(() => page.click('[data-act="backupZip"]'));
    assert.deepEqual(Zip.entries(z.bytes).map((e) => e.name), ['copia.json']);
    assert.doesNotMatch(await waitToast(/Copia descargada/), /foto/);
    const j = await download(() => page.click('[data-act="backupJson"]'));
    assert.doesNotMatch(await waitToast(/Copia descargada/), /foto/);
    assert.equal(JSON.parse(j.text).summary.photos, 0);
    await act('closeSheet'); await waitSheetClosed();
  });

  /* ---------- Restaurar ---------- */
  await step('Restaurar el .json (sin fotos) en un teléfono que tiene fotos: la ventana avisa qué pasa con ellas', async () => {
    await page.reload(); await page.waitForSelector('#tab-puntos');            // vuelve el estado guardado: las 5 fotos
    assert.equal((await fotosDe()).length, 5);
    await setFile('#backupFile', 'copia.json', jsonFile.text, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Restaurar copia de seguridad');
    const t = await sheetText();
    assert.match(t, /Ahora tienes 5 fotos en tus proyectos\. «Reemplazar todo» borra de este teléfono las que no vengan en la copia \(esta copia no trae fotos\); «Sumar» no borra ninguna\./);
    assert.doesNotMatch(t, /\d+ fotos?,|, \d+ fotos? /, 'el resumen de la copia no cuenta fotos');
    await shot('125-restaurar-json-con-fotos');
  });

  await step('«Sumar» con el .json no borra ninguna foto; «Reemplazar todo» sí las deja sin uso y se pueden recuperar con «Deshacer»', async () => {
    await setFile('#backupFile', 'copia.json', jsonFile.text, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreMerge'); await waitSheetClosed();
    assert.equal((await fotosDe()).length, 5, 'las fotos de mi proyecto siguen');
    assert.equal((await dbKeys()).length, 5);
    await page.click('[data-act="toastAction"]');                                // deshace la suma
    await setFile('#backupFile', 'copia.json', jsonFile.text, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreReplace'); await waitSheetClosed();
    assert.equal((await fotosDe()).length, 0, 'la copia liviana no trae fotos');
    await page.click('[data-act="toastAction"]');                                // Deshacer
    assert.equal((await fotosDe()).length, 5, 'deshacer devuelve las fotos');
    assert.equal((await dbKeys()).length, 5, 'las imágenes siguen en el teléfono mientras no se cierre la app');
  });

  await step('Restaurar el .zip en un teléfono sin fotos: vuelven las fotos con sus imágenes', async () => {
    await limpio();
    assert.deepEqual(await dbKeys(), []);
    await setFile('#backupFile', 'copia.zip', Buffer.from(zipFile.bytes), 'application/zip');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Restaurar copia de seguridad');
    assert.match(await sheetText(), /1 proyecto, 3 puntos, 5 fotos/);
    await shot('126-restaurar-zip');
    await act('restoreReplace'); await waitSheetClosed();
    assert.match(await toastText(), /Copia restaurada/);
    const l = await fotosDe();
    assert.deepEqual(l.map((f) => f.id).sort(), ids.slice().sort());
    assert.equal((await dbKeys()).length, 5);
    for (const f of l) assert.deepEqual((await dbGet(f.id)).bytes.slice(0, 3), [0xFF, 0xD8, 0xFF]);
    await abrirFicha(0);
    assert.equal(await conteo(), 'Fotos (5 de 5)');
    await cargadas('#fPhotosWrap img');
    await cerrarFicha();
  });

  await step('Restaurar el .json pesado en un teléfono sin fotos: vuelven las fotos con sus imágenes', async () => {
    await limpio();
    assert.deepEqual(await dbKeys(), []);
    await setFile('#backupFile', 'copia-fotos.json', heavyFile.text, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Restaurar copia de seguridad');
    assert.match(await sheetText(), /1 proyecto, 3 puntos, 5 fotos/);
    await act('restoreReplace'); await waitSheetClosed();
    assert.match(await toastText(), /Copia restaurada/);
    const l = await fotosDe();
    assert.deepEqual(l.map((f) => f.id).sort(), ids.slice().sort());
    assert.equal((await dbKeys()).length, 5);
    for (const f of l) assert.deepEqual((await dbGet(f.id)).bytes, Array.from(Backup.photosFromJson(JSON.parse(heavyFile.text)).photos[f.id]), 'imagen idéntica');
    await abrirFicha(0);
    assert.equal(await conteo(), 'Fotos (5 de 5)');
    await cargadas('#fPhotosWrap img');
    await cerrarFicha();
  });

  await step('.json pesado con una foto dañada dentro: se omite y se avisa; el resto se restaura', async () => {
    const raw = JSON.parse(heavyFile.text);
    raw.photos[ids[2]] = 'esto no es base64!';
    await limpio();
    await setFile('#backupFile', 'copia-fotos.json', JSON.stringify(raw), 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    const t = await sheetText();
    assert.match(t, /1 foto del archivo no se pudo leer y se omitió/);
    assert.match(t, /1 foto no venía en el archivo y se omitió/);
    assert.match(t, /1 proyecto, 3 puntos, 4 fotos/);
    await act('restoreReplace'); await waitSheetClosed();
    assert.equal((await fotosDe()).length, 4); assert.equal((await dbKeys()).length, 4);
  });

  await step('Restaurar el mismo .zip otra vez no repite las imágenes (si ya están y son iguales se reutilizan)', async () => {
    await limpio();
    await setFile('#backupFile', 'copia.zip', Buffer.from(zipFile.bytes), 'application/zip');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreReplace'); await waitSheetClosed();
    await setFile('#backupFile', 'copia.zip', Buffer.from(zipFile.bytes), 'application/zip');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await sheetText(), /Ahora tienes 5 fotos/);
    await act('restoreMerge'); await waitSheetClosed();
    assert.equal((await dbKeys()).length, 5, 'ninguna imagen duplicada');
    assert.match(await toastText(), /0 proyectos agregados · 1 ya estaba/);
  });

  await step('Una foto distinta con el mismo id no se pisa: la de la copia entra con un id nuevo', async () => {
    const id = ids[0];
    const otra = await page.evaluate(`(async () => { const db = await ${dbOpen}; return new Promise((res) => { const tx = db.transaction('fotos', 'readwrite'); const st = tx.objectStore('fotos'); const g = st.get(${JSON.stringify(id)}); g.onsuccess = () => { const r = g.result; const d = new Uint8Array(r.data); d[d.length - 3] ^= 0x55; st.put({ id: r.id, type: r.type, n: r.n, at: r.at, data: d.buffer }); }; tx.oncomplete = () => { db.close(); res(true); }; }); })()`);
    assert.equal(otra, true);
    const mia = (await dbGet(id)).bytes;
    await setFile('#backupFile', 'copia.zip', Buffer.from(zipFile.bytes), 'application/zip');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreReplace'); await waitSheetClosed();
    assert.deepEqual((await dbGet(id)).bytes, mia, 'mi imagen modificada sigue como estaba');
    const nuevos = (await fotosDe()).map((f) => f.id);
    assert.equal(nuevos.length, 5); assert.notEqual(nuevos[0], id, 'la foto de la copia tomó otro id');
    assert.equal((await dbKeys()).length, 6);
  });

  await step('ZIP dañado, ajeno o sin copia.json: se rechaza con un mensaje claro y no cambia nada', async () => {
    const antes = JSON.stringify(await state());
    const malo = async (nombre, bytes, re) => {
      await setFile('#backupFile', nombre, Buffer.from(bytes), 'application/zip');
      assert.match(await waitToast(re, 6000), re);
      assert.equal(await page.evaluate(() => document.querySelector('#sheet').hidden), true);
    };
    await malo('roto.zip', Buffer.concat([Buffer.from([0x50, 0x4B, 3, 4]), Buffer.alloc(60, 7)]), /No se pudo leer la copia: No se pudo leer el ZIP/);
    await malo('ajeno.zip', Zip.create([{ name: 'otra.txt', bytes: new Uint8Array([1]) }]), /falta copia\.json/);
    await malo('mala.zip', Zip.create([{ name: 'copia.json', bytes: new TextEncoder().encode('{no es json') }]), /No se pudo leer copia\.json/);
    assert.equal(JSON.stringify(await state()), antes);
  });

  await step('Una foto dañada dentro del ZIP no impide restaurar: se omite y se avisa', async () => {
    const z = new Uint8Array(zipFile.bytes);
    const e = Zip.entries(z).find((x) => x.name === 'fotos/' + ids[1] + '.jpg');
    z[e.offset + 30 + e.name.length + 4] ^= 0xFF;
    await limpio();
    await setFile('#backupFile', 'copia.zip', Buffer.from(z), 'application/zip');
    await page.waitForSelector('#sheet:not([hidden])');
    const t = await sheetText();
    assert.match(t, /1 foto del archivo no se pudo leer y se omitió/);
    assert.match(t, /1 foto no venía en el archivo y se omitió/);
    assert.match(t, /4 fotos/);
    await act('restoreReplace'); await waitSheetClosed();
    assert.equal((await fotosDe()).length, 4);
    assert.equal((await dbKeys()).length, 4);
  });

  await step('Al abrir la app se borran las imágenes que ningún punto usa; las que se usan se quedan', async () => {
    const quitada = (await fotosDe())[0].id;
    await abrirFicha(0);
    await page.click('[data-act="photoDel"][data-fid="' + quitada + '"]'); await waitToast(/Foto quitada/);
    await cerrarFicha();
    assert.equal((await dbKeys()).length, 4, 'todavía no se borra: se puede deshacer');
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await page.waitForFunction(async () => (await new Promise((res) => { const r = indexedDB.open('zvg.v1.photos', 1); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; })).length === 3, null, { timeout: 5000 });
    const usadas = (await fotosDe()).map((f) => f.id).sort();
    assert.deepEqual((await dbKeys()).sort(), usadas);
    assert.equal(usadas.includes(quitada), false);
  });

  await step('Eliminar el punto o cambiar de proyecto no rompe la ficha; al cerrar la app sus fotos se limpian y no hay errores en la consola', async () => {
    await tab('puntos');
    await page.click('[data-act="editPoint"] >> nth=0'); await page.waitForSelector('#sheet #fPhotosWrap');
    await act('askDelete'); await act('doDelete'); await waitSheetClosed();
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await page.waitForFunction(async () => (await new Promise((res) => { const r = indexedDB.open('zvg.v1.photos', 1); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; })).length === 0, null, { timeout: 5000 });
    assert.deepEqual(await dbKeys(), []);
    assert.deepEqual(errors, [], 'la consola quedó limpia: ' + errors.join(' | '));
  });
};

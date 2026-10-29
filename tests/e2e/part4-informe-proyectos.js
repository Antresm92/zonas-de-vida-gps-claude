'use strict';
/* Recorrido 4 — Informe (diagrama de Holdridge, HTML con Walter-Lieth y capas), proyectos y copia de seguridad. */
const Backup = require('../../www/js/backup.js');

module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, fill, tab, text, proj, state, toastText, waitToast, sheetOpen, sheetTitle, waitSheetClosed, addPointManual, download, setFile, fx, errors, shot } = c;
  const field = async (name, v) => { await fill('[data-field="' + name + '"]', v); await page.press('[data-field="' + name + '"]', 'Enter'); };
  const newProj = async (name) => { await act('projects'); await act('newProject'); await fill('#pName', name); await act('saveNewProject'); await waitSheetClosed(); await tab('puntos'); };
  const importFile = async (name, data, mime) => { await setFile('#gisFile', name, data, mime); await page.waitForSelector('#sheet:not([hidden])'); };
  const projectNames = async () => (await state()).projects.map((p) => p.name);

  await step('Informe: zona de vida, datos usados, diagrama de Holdridge y zonas por altitud de cada punto', async () => {
    await fresh();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6000, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await tab('clima');
    await field('pManual', '1200');
    await tab('informe');
    assert.match(await text('#tab-informe .result h3'), /\S/);
    assert.match(await text('#tab-informe'), /Datos usados/);
    assert.match(await text('#tab-informe'), /Altitud/);
    assert.match(await text('#tab-informe'), /Zonas según la altitud de cada punto/);
    assert.match(await text('#tab-informe'), /Podría caer también en|la zona no cambia/);
    assert.equal(await page.locator('#diag').count(), 1);
    assert.ok(await page.locator('#diag svg, #diag canvas').count() >= 1, 'el diagrama se dibuja');
    for (const a of ['dZoomIn', 'dZoomOut', 'dCenter', 'dFit']) await act(a);
    await shot('30-informe');
  });

  await step('Informe sin precipitación: dice qué falta y lleva a Clima', async () => {
    await tab('clima');
    await page.click('[data-act="clearField"][data-field="pManual"]');
    await tab('informe');
    assert.match(await text('#tab-informe'), /Falta la precipitación anual/);
    await page.click('#tab-informe [data-act="tab"][data-tab="clima"]');
    await page.waitForSelector('#tab-clima', { state: 'visible' });
    await field('pManual', '1200');
  });

  await step('Compartir el informe: HTML completo con diagrama de Holdridge, Walter-Lieth y capas de colores', async () => {
    // 12 meses a mano
    await act('monthly');
    const T = fx.T, P = [10, 12, 30, 60, 80, 20, 10, 8, 40, 120, 70, 20];
    for (let i = 0; i < 12; i++) { await fill('[data-mt="' + i + '"]', String(T[i]).replace('.', ',')); await fill('[data-mp="' + i + '"]', String(P[i])); }
    await act('saveMonthly'); await waitSheetClosed();
    // una capa importada
    await importFile('vecino.kml', fx.vecinoKml());
    await act('importLayer'); await waitSheetClosed();
    await tab('informe');
    const f = await download(() => page.click('[data-act="share"]'));
    assert.match(f.name, /^informe-zona-de-vida-mi-primer-proyecto\.html$/);
    assert.match(f.text, /^<!doctype html>/);
    assert.match(f.text, /Diagrama de Walter-Lieth/);
    assert.match(f.text, /Período seco/);
    assert.match(f.text, /Diagrama de Holdridge/);
    assert.match(f.text, /Lote vecino/);
    assert.match(f.text, /Zonas según la altitud de cada punto/);
    assert.ok(!/<script/i.test(f.text), 'el informe no lleva scripts');
    // abrirlo como lo vería otra persona
    const p2 = await context.newPage();
    const errs = [];
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.setContent(f.text);
    assert.ok(await p2.locator('svg').count() >= 4, 'hay varios dibujos (hexágono, plano, Walter-Lieth, Holdridge)');
    await p2.setViewportSize({ width: 800, height: 1100 });
    await p2.screenshot({ path: c.shots + '/31-informe-html.png', fullPage: true });
    await p2.close();
    assert.deepEqual(errs, []);
  });

  await step('Copiar el resumen en texto (incluye el diagrama de Walter-Lieth y las capas)', async () => {
    await act('copy');
    await waitToast(/Resumen copiado/);
    const t = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(t, /INFORME DE ZONA DE VIDA/);
    assert.match(t, /Diagrama de Walter-Lieth \(datos mensuales\)/);
    assert.match(t, /Capas importadas/);
    assert.match(t, /Puntos:/);
  });

  await step('Copiar con el portapapeles no disponible usa el método de respaldo', async () => {
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
    await act('copy');
    await waitToast(/Resumen copiado|No se pudo copiar/);
  });

  await step('Proyectos: crear, renombrar, cambiar, y eliminar (con opción de conservar)', async () => {
    await newProj('Finca B');
    assert.equal(await text('#projName'), 'Finca B');
    await act('projects');
    assert.match(await text('#sheet'), /Mi primer proyecto/);
    await act('renameProject');
    await fill('#pName', 'Finca Beta');
    await act('saveRename'); await waitSheetClosed();
    assert.equal(await text('#projName'), 'Finca Beta');
    await act('projects');
    await page.locator('[data-act="pickProject"]').first().click(); await waitSheetClosed();
    assert.equal(await text('#projName'), 'Mi primer proyecto');
    await act('projects');
    await page.locator('[data-act="pickProject"]').nth(1).click(); await waitSheetClosed();
    await act('projects');
    await act('askDeleteProject');
    assert.match(await sheetTitle(), /¿Eliminar "Finca Beta"\?/);
    await page.click('#sheet [data-act="closeSheet"].btn'); await waitSheetClosed();
    assert.equal((await state()).projects.length, 2);
    await act('projects');
    await act('askDeleteProject');
    await act('doDeleteProject'); await waitSheetClosed();
    assert.deepEqual(await projectNames(), ['Mi primer proyecto']);
    await act('projects');
    assert.equal(await page.locator('[data-act="askDeleteProject"]').count(), 0, 'no se puede eliminar el único proyecto');
    assert.match(await text('#sheet'), /versión 2\.3\.0/);
    await act('closeSheet'); await waitSheetClosed();
    // nombre vacío al crear → nombre por defecto
    await act('projects'); await act('newProject'); await fill('#pName', '   '); await act('saveNewProject'); await waitSheetClosed();
    assert.equal(await text('#projName'), 'Proyecto sin nombre');
    await act('projects'); await act('renameProject'); await fill('#pName', ''); await act('saveRename'); await waitSheetClosed();
    assert.equal(await text('#projName'), 'Proyecto sin nombre');
    await act('projects'); await page.locator('[data-act="pickProject"]').first().click(); await waitSheetClosed();
  });

  let backup;
  await step('Copia de seguridad: exporta todo a un archivo JSON que se puede validar', async () => {
    await act('projects');
    const f = await download(() => page.click('[data-act="backupExport"]'));
    assert.match(f.name, /^zonas-de-vida-copia-\d{4}-\d{2}-\d{2}\.json$/);
    backup = f.text;
    const raw = JSON.parse(backup);
    assert.equal(raw.app, 'zonas-de-vida-gps');
    assert.equal(raw.state.projects.length, 2);
    assert.equal(raw.summary.layers, 2);
    const v = Backup.validate(raw);
    assert.equal(v.ok, true);
    assert.match(await toastText(), /Copia descargada/);
    await act('closeSheet'); await waitSheetClosed();
  });

  await step('Restaurar sumando: no repite lo que ya existe y permite deshacer', async () => {
    await setFile('#backupFile', 'copia.json', backup, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.equal(await sheetTitle(), 'Restaurar copia de seguridad');
    assert.match(await text('#sheet'), /2 proyectos/);
    await shot('32-restaurar');
    await act('restoreMerge'); await waitSheetClosed();
    assert.equal((await state()).projects.length, 2, 'los proyectos iguales no se duplican');
    assert.match(await toastText(), /0 proyectos agregados · 2 ya estaban/);
    // si algo cambió, el proyecto restaurado se suma con otro nombre
    await page.evaluate(() => { const S = window.__app.S; S.projects[0].name = 'Cambiado'; });
    await setFile('#backupFile', 'copia.json', backup, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreMerge'); await waitSheetClosed();
    const names = await projectNames();
    assert.equal(names.length, 3);
    assert.ok(names.some((n) => /\(restaurado\)/.test(n)));
    await page.click('[data-act="toastAction"]');
    assert.equal((await state()).projects.length, 2);
  });

  await step('Restaurar reemplazando todo: deja solo la copia y permite deshacer', async () => {
    await page.evaluate(() => { const S = window.__app.S; S.projects = [S.projects[0]]; S.currentId = S.projects[0].id; S.settings.minAcc = 3; });
    await setFile('#backupFile', 'copia.json', backup, 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('restoreReplace'); await waitSheetClosed();
    const s = await state();
    assert.equal(s.projects.length, 2);
    assert.match(await toastText(), /Copia restaurada: 2 proyectos/);
    assert.ok(s.projects.some((p) => p.layers.length === 2));
    await page.click('[data-act="toastAction"]');
    assert.equal((await state()).projects.length, 1);
    assert.equal((await state()).settings.minAcc, 3);
  });

  await step('Copias dañadas o ajenas: se rechazan con un mensaje claro y no cambian nada', async () => {
    const before = JSON.stringify(await state());
    const bad = async (name, content) => {
      await setFile('#backupFile', name, content, 'application/json');
      await page.waitForSelector('#sheet:not([hidden])', { timeout: 3000 }).catch(() => {});
    };
    await bad('x.json', 'esto no es json');
    await waitToast(/no se pudo leer el JSON/);
    await bad('x.json', JSON.stringify({ hola: 1 }));
    assert.equal(await sheetTitle(), 'No se puede restaurar');
    assert.match(await text('#sheet'), /no es una copia de seguridad de Zonas de Vida/);
    await act('closeSheet'); await waitSheetClosed();
    await bad('x.json', JSON.stringify({ app: 'zonas-de-vida-gps', format: 99, state: { projects: [] } }));
    assert.match(await text('#sheet'), /versión más nueva/);
    await act('closeSheet'); await waitSheetClosed();
    await bad('x.json', JSON.stringify({ app: 'zonas-de-vida-gps', format: 1, state: { projects: [] } }));
    assert.match(await text('#sheet'), /ningún proyecto/);
    await act('closeSheet'); await waitSheetClosed();
    assert.equal(JSON.stringify(await state()), before);
  });

  await step('Copia manipulada: se limpian los datos peligrosos y los dañados se omiten con aviso', async () => {
    const raw = JSON.parse(backup);
    raw.state.projects[0].name = '<img src=x onerror=window.__pwned=1>';
    raw.state.projects[0].points[0].lat = 999;
    raw.state.projects[0].points[1].name = '<script>window.__pwned=2</script>';
    raw.state.projects[0].mainColor = 'red;background:url(x)';
    raw.state.projects[0].layers[0].color = '"><b>';
    raw.state.settings = { minAcc: 77, csvStyle: 'otro', areaUnit: 'parsecs' };
    await setFile('#backupFile', 'manipulada.json', JSON.stringify(raw), 'application/json');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await text('#sheet'), /coordenadas no válidas se omitieron/);
    await act('restoreReplace'); await waitSheetClosed();
    const s = await state();
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no se ejecutó nada del archivo');
    assert.equal(s.projects[0].mainColor, '#2F8F4E');
    assert.ok(s.projects[0].points.every((p) => Math.abs(p.lat) <= 90));
    assert.ok([0, 3, 5, 10, 20].includes(s.settings.minAcc));
    assert.ok(['es', 'std'].includes(s.settings.csvStyle));
    assert.ok(['ha', 'm2', 'km2', 'fanegadas'].includes(s.settings.areaUnit));
    assert.ok(!(await page.evaluate(() => document.body.innerHTML)).includes('<img src=x'), 'el nombre se muestra como texto');
    await tab('puntos');
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

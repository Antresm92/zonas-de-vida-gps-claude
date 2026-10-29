'use strict';
/* Recorrido 5 — sin conexión: la app se guarda en el equipo (service worker) y sigue funcionando sin internet. */
module.exports = async function (c) {
  const { page, context, assert, step, fresh, act, tab, text, proj, state, toastText, addPointManual, download, errors, url } = c;

  await step('La app se guarda en el equipo la primera vez que se abre', async () => {
    await fresh();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const info = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys[0]);
      const reqs = await cache.keys();
      return { keys, files: reqs.map((r) => new URL(r.url).pathname) };
    });
    assert.deepEqual(info.keys, ['zonas-de-vida-v5']);
    for (const f of ['/index.html', '/js/app.js', '/js/gis.js', '/js/zip.js', '/js/walter-lieth.js', '/js/backup.js', '/css/app.css', '/js/mapa.js', '/js/mapview.js', '/js/satelite.js', '/js/perfil.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css']) {
      assert.ok(info.files.includes(f), 'falta en la memoria offline: ' + f);
    }
  });

  await step('Sin internet: la app abre, calcula el área, exporta y avisa que no puede completar con internet', async () => {
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#tab-puntos');
    assert.equal(await page.evaluate(() => window.__app.version), '2.2.0');
    assert.equal(await page.locator('#netChip:not([hidden])').count(), 1);
    for (const p of ['4.60, -74.08', '4.60, -74.07', '4.61, -74.075']) await addPointManual(p, 2600);
    await tab('area');
    assert.match(await text('#tab-area .big'), /ha/);
    const f = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.match(f.text, /<Polygon>/);
    await tab('clima');
    await page.locator('[data-act="fetchOnline"]').first().click();
    assert.match(await toastText(), /Sin conexión/);
    await context.setOffline(false);
  });

  await step('Sin errores de JavaScript en la consola', async () => {
    assert.deepEqual(errors, []);
  });
};

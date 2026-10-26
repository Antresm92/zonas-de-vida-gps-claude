'use strict';
/* Recorrido 6 — versión web publicada en una subcarpeta, como en GitHub Pages
 * (https://usuario.github.io/zonas-de-vida-gps-claude/): rutas, memoria offline y avisos de la versión web.
 * El servidor de prueba responde 404 a todo lo que se pida fuera de esa subcarpeta. */
module.exports = async function (c) {
  const { page, context, assert, step, errors, H, shot } = c;
  const base = '/zonas-de-vida-gps-claude/';
  const { srv, url } = await H.serve(base);
  const origin = new URL(url).origin;
  const fallos = [];
  const onResponse = (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !r.url().endsWith('/favicon.ico')) fallos.push(r.status() + ' ' + r.url()); };
  const DAY = 24 * 3600 * 1000;
  const flags = (ms) => page.evaluate((t) => localStorage.setItem('zvg.v1.flags', JSON.stringify({ webNoteAt: t })), ms);
  const nota = () => page.locator('#tab-puntos .webnote').count();
  const abrir = async () => { await page.goto(url); await page.waitForSelector('#tab-puntos .block'); };

  page.on('response', onResponse);
  try {
    await step('En una subcarpeta (como GitHub Pages): abre sin errores y todo se pide dentro de la subcarpeta', async () => {
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      errors.length = 0;
      await abrir();
      assert.equal(await page.evaluate(() => window.__app.version), '2.0.1');
      assert.deepEqual(fallos, [], 'archivos pedidos que no existen: ' + fallos.join(', '));
      assert.equal(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope)), url);
    });

    await step('La memoria offline guarda los archivos dentro de la subcarpeta', async () => {
      const info = await page.evaluate(async () => {
        const keys = await caches.keys();
        const reqs = await (await caches.open(keys[0])).keys();
        return { keys, files: reqs.map((r) => new URL(r.url).pathname) };
      });
      for (const f of ['index.html', 'js/app.js', 'js/web.js', 'js/gis.js', 'css/app.css', 'icons/icon-192.png']) {
        assert.ok(info.files.includes(base + f), 'falta en la memoria offline: ' + base + f);
      }
      assert.ok(info.files.every((f) => f.startsWith(base)), 'hay archivos guardados fuera de la subcarpeta');
    });

    await step('Aviso: «los datos viven en este navegador» se ve, se puede cerrar y vuelve a los 7 días', async () => {
      assert.equal(await nota(), 1);
      const t = await page.locator('#tab-puntos .webnote').textContent();
      assert.match(t, /Estás usando la versión web/);
      assert.match(t, /solo en este navegador/);
      assert.match(t, /copias de seguridad/);
      assert.doesNotMatch(t, /HTTPS/, 'en 127.0.0.1 el navegador sí es seguro: no debe haber aviso de HTTPS');
      await shot('60-web-aviso');
      await page.click('[data-act="dismissWebNote"]');
      assert.equal(await nota(), 0);
      await abrir();
      assert.equal(await nota(), 0, 'cerrado: no vuelve al abrir otra vez');
      await flags(Date.now() - 6 * DAY);
      await abrir();
      assert.equal(await nota(), 0, 'a los 6 días todavía no');
      await flags(Date.now() - 8 * DAY);
      await abrir();
      assert.equal(await nota(), 1, 'a los 8 días vuelve');
    });

    await step('La ventana de proyectos explica dónde viven los datos y ofrece la copia de seguridad', async () => {
      await page.click('[data-act="projects"]');
      await page.waitForSelector('#sheet:not([hidden]) h2');
      const t = await page.locator('#sheet').textContent();
      assert.match(t, /Versión web: tus proyectos viven en este navegador, no en un servidor/);
      assert.match(t, /Exportar copia de seguridad/);
      await page.click('#sheet [aria-label="Cerrar"]');
      await page.waitForSelector('#sheet', { state: 'hidden' });
    });

    await step('Sin internet y desde la subcarpeta: la app abre desde la memoria offline', async () => {
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('#tab-puntos .block');
      assert.equal(await page.evaluate(() => window.__app.version), '2.0.1');
      assert.equal(await page.locator('#netChip:not([hidden])').count(), 1);
      await context.setOffline(false);
    });

    await step('Sin HTTPS: avisa que el GPS no funcionará y ese aviso no se puede cerrar', async () => {
      await page.addInitScript(() => { Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }); });
      await flags(Date.now() - DAY);          // el aviso informativo está cerrado
      await abrir();
      const t = await page.locator('#tab-puntos .webnote').textContent();
      assert.match(t, /Esta página no usa HTTPS/);
      assert.doesNotMatch(t, /Estás usando la versión web/, 'el informativo sigue cerrado');
      assert.equal(await page.locator('[data-act="dismissWebNote"]').count(), 0, 'un problema no se puede ocultar');
      await shot('61-web-sin-https');
    });

    await step('Dentro del APK (Capacitor) no aparece ningún aviso de la versión web', async () => {
      await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      await abrir();                          // aunque siga «sin HTTPS», en el APK no se muestra nada
      assert.equal(await nota(), 0);
      await page.click('[data-act="projects"]');
      await page.waitForSelector('#sheet:not([hidden]) h2');
      const t = await page.locator('#sheet').textContent();
      assert.doesNotMatch(t, /Versión web/);
      assert.match(t, /Zonas de Vida versión 2\.0\.1/);
      await page.click('#sheet [aria-label="Cerrar"]');
      await page.waitForSelector('#sheet', { state: 'hidden' });
    });

    await step('Sin errores de JavaScript en la consola', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(fallos, []);
    });
  } finally {
    page.off('response', onResponse);
    srv.close();
  }
};

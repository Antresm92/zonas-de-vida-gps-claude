'use strict';
/* tests/e2e/harness.js — herramientas para probar la app completa en Chromium sin teléfono:
 * servidor local, GPS simulado, internet simulado, descargas y medición de cobertura.
 * Necesita Playwright y Chromium (variables PW_PATH y CHROMIUM). No forma parte de "npm test". */
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const WWW = path.resolve(__dirname, '..', '..', 'www');
const PW = process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright';
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(WWW, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' }));
  });
}

// GPS de mentira dentro de la página: window.__gps.push({lat, lon, alt, acc}) / .error(code)
const GPS_SCRIPT = () => {
  const watchers = new Map(); let next = 1;
  const geo = {
    watchPosition(ok, err) { const id = next++; watchers.set(id, { ok, err }); return id; },
    clearWatch(id) { watchers.delete(id); },
    getCurrentPosition() {}
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  window.__gps = {
    push(c) { watchers.forEach((w) => w.ok({ coords: { latitude: c.lat, longitude: c.lon, altitude: c.alt === undefined ? null : c.alt, accuracy: c.acc === undefined ? null : c.acc, altitudeAccuracy: c.altAcc === undefined ? null : c.altAcc }, timestamp: Date.now() })); },
    error(code, message) { watchers.forEach((w) => w.err && w.err({ code, message: message || '' })); },
    count() { return watchers.size; }
  };
};

async function launch(opts) {
  opts = opts || {};
  const { chromium } = require(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'es-CO', timezoneId: 'America/Bogota', serviceWorkers: 'allow' });
  await context.addInitScript(GPS_SCRIPT);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  return { browser, context, page, errors };
}

async function saveCoverage(page, file) {
  const cov = await page.coverage.stopJSCoverage();
  fs.writeFileSync(file, JSON.stringify(cov.map((e) => ({ url: e.url, functions: e.functions }))));
}

// Mosaicos de mapa de mentira: responde a OpenStreetMap y a Esri con una imagen lisa y cuenta lo que se pidió.
// Así la prueba no toca los servidores reales (que desde aquí tampoco se alcanzan) ni gasta su cuota.
//   tiles.urls: todo lo pedido · tiles.count(/regex/) · tiles.fail(true|false): hace fallar los mosaicos · tiles.reset()
async function mockTiles(context) {
  const { solidPng } = require('../helpers/png.js');
  const png = solidPng(196, 214, 190, 255, 256);
  const tiles = {
    urls: [], failing: false,
    count(re) { return tiles.urls.filter((u) => re.test(u)).length; },
    fail(v) { tiles.failing = !!v; },
    reset() { tiles.urls.length = 0; }
  };
  await context.route(/^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//, (route) => {
    tiles.urls.push(route.request().url());
    if (tiles.failing) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  return tiles;
}

// Tabla de resultados
function runner(shotsDir) {
  const results = [];
  let page = null;
  return {
    results,
    setPage(p) { page = p; },
    async step(name, fn) {
      const t0 = Date.now();
      try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓ ' + name); }
      catch (e) {
        results.push({ name, ok: false, error: e && e.message || String(e) });
        console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 6).join('\n      '));
        if (page && shotsDir) { try { await page.screenshot({ path: path.join(shotsDir, 'fallo-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '.png') }); } catch (e2) { /* nada */ } }
      }
    }
  };
}

module.exports = { serve, launch, saveCoverage, runner, mockTiles, WWW, os };

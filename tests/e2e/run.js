'use strict';
/* tests/e2e/run.js — recorre la app como lo haría una persona (Chromium, GPS e internet simulados).
 *   node tests/e2e/run.js [--cov=archivo.json] [--shots=carpeta] [--parts=part2,part3]
 * Termina con código 1 si algo falla. Genera la cobertura del navegador para tools/cobertura.js. */
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const H = require('./harness.js');
const fx = require('./fixtures.js');

const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };

(async () => {
  const shots = arg('shots') || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  fs.mkdirSync(shots, { recursive: true });
  const { srv, url } = await H.serve();
  const { browser, context, page, errors } = await H.launch();
  const R = H.runner(shots); R.setPage(page);
  // Antes de cada paso se cierra cualquier ventana que haya quedado abierta por un paso anterior que falló
  const tidy = async () => {
    for (let i = 0; i < 3; i++) {
      const open = await page.evaluate(() => !document.querySelector('#sheet').hidden);
      if (!open) break;
      await page.click('#sheet [aria-label="Cerrar"]');
      await page.waitForSelector('#sheet', { state: 'hidden', timeout: 3000 }).catch(() => {});
    }
  };
  const step = (name, fn) => R.step(name, async () => { await tidy(); await fn(); });

  /* ---------- Ayudas ---------- */
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.S)));
  const proj = async () => { const s = await state(); return s.projects.find((p) => p.id === s.currentId); };
  const toastText = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t.hidden ? '' : t.textContent; });
  const act = (name, extra) => page.click('[data-act="' + name + '"]' + (extra || ''));
  const sheetOpen = () => page.evaluate(() => !document.querySelector('#sheet').hidden);
  const sheetTitle = () => page.evaluate(() => { const h = document.querySelector('#sheet h2'); return h ? h.textContent : ''; });
  const waitSheetClosed = () => page.waitForSelector('#sheet', { state: 'hidden' });
  const waitToast = async (re, ms) => {
    const t0 = Date.now(); let t = '';
    while (Date.now() - t0 < (ms || 4000)) { t = await toastText(); if (re.test(t)) return t; await page.waitForTimeout(50); }
    throw new Error('Aviso esperado ' + re + ' pero había: «' + t + '»');
  };
  const tab = async (name) => { await page.click('#nav-' + name); await page.waitForSelector('#tab-' + name, { state: 'visible' }); };
  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
  const fresh = async () => {
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(url);
    await page.waitForSelector('#tab-puntos');
    errors.length = 0;
  };
  // La app enfoca el primer campo de cada ventana medio segundo después de abrirla; si se escribe antes, el texto cae en ese campo
  const settle = () => page.waitForFunction(() => { const s = document.querySelector('#sheet'); if (s.hidden) return true; const f = s.querySelector('input,textarea'); return !f || s.contains(document.activeElement); }, null, { timeout: 2000 }).catch(() => {});
  const fill = async (sel, v) => { await settle(); await page.fill(sel, v); };
  const gpsPush = (c, n) => page.evaluate(([c2, n2]) => { for (let i = 0; i < (n2 || 1); i++) window.__gps.push(c2); }, [c, n]);
  // Las ventanas entran con una animación de 0,18 s: se espera a que termine para que la captura salga nítida
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); };
  const addPointManual = async (coords, alt, name) => {
    await act('addCoords'); await fill('#fCoord', coords);
    if (alt !== undefined) await fill('#fAlt', String(alt));
    if (name) await fill('#fName', name);
    await page.click('[data-act="saveNew"][data-more="0"]'); await waitSheetClosed();
  };
  const download = async (clickFn) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), clickFn()]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
  };
  const setFile = async (sel, name, data, mime) => page.setInputFiles(sel, { name, mimeType: mime || 'application/octet-stream', buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });

  const ctx = { page, url, state, proj, toastText, act, sheetOpen, sheetTitle, waitSheetClosed, waitToast, tab, text, fresh, fill, gpsPush, shot, addPointManual, download, setFile, step, errors, context, browser, assert, fx, shots, H };

  console.log('Recorrido de la app en Chromium (' + url + ')');
  await page.goto(url);
  await page.waitForSelector('#tab-puntos');
  const only = (arg('parts') || '').split(',').filter(Boolean);
  for (const part of ['part1-puntos', 'part2-area-importar', 'part3-clima', 'part4-informe-proyectos', 'part5-offline', 'part6-web']) {
    if (only.length && !only.some((o) => part.startsWith(o))) continue;
    const f = path.join(__dirname, part + '.js');
    if (fs.existsSync(f)) { console.log('\n' + part); await require(f)(ctx); }
  }

  const covFile = arg('cov');
  if (covFile) await H.saveCoverage(page, covFile);
  await browser.close(); srv.close();
  const bad = R.results.filter((r) => !r.ok);
  console.log('\n' + (R.results.length - bad.length) + ' de ' + R.results.length + ' pasos correctos' + (bad.length ? ', ' + bad.length + ' con fallo' : '') + '. Capturas en ' + shots);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

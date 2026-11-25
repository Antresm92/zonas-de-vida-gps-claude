'use strict';
/* Recorrido 35 — versión 2.34.0: alto contraste, registro de errores y tiempo de arranque.
   El contraste se MIDE en pantalla: para cada texto visible se calcula su color contra el fondo real (sumando las capas
   semitransparentes) con la fórmula de las pautas WCAG 2. En alto contraste todo texto debe llegar a 7:1 (4,5:1 si es grande). */
const fx = require('./fixtures.js');

module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, setFile, waitSheetClosed, waitToast, download, errors, shot } = c;

  // Contraste de cada texto visible (HTML y SVG). Devuelve los que no llegan al mínimo, con lo necesario para encontrarlos.
  const medir = () => page.evaluate(() => {
    const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    // Fondo real: las capas de fondo hacia arriba hasta una opaca. Sobre una imagen (las teselas del mapa) no se puede medir.
    const fondo = (el) => {
      const capas = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { capas.push(c); if (c.a >= 0.999) break; }
        if (e.classList && e.classList.contains('leaflet-container')) return null;       // debajo están las teselas (imágenes)
        if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null;
      }
      let b = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = capas.length - 1; i >= 0; i--) b = mix(capas[i], b);
      return b;
    };
    // Se mide todo lo que está dibujado en la pantalla actual, también lo que queda más abajo (sin desplazarse)
    const visible = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false; } return true; };
    const inactivo = (el) => !!el.closest('[disabled], .off, [aria-disabled="true"]');
    const malos = []; let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      const propio = [...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim());
      if (!propio || !visible(el) || inactivo(el)) continue;
      const svg = el instanceof SVGElement;
      const cs = getComputedStyle(el);
      let fg = parse(svg ? cs.fill : cs.color);
      if (!fg) continue;
      const bg = fondo(svg ? el.ownerSVGElement || el : el);
      if (!bg) continue;
      if (fg.a < 1) fg = mix(fg, bg);
      const x = lum(fg), y = lum(bg), ratio = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700, grande = size >= 24 || (size >= 18.66 && bold);
      n++;
      if (ratio < (grande ? 4.5 : 7)) malos.push({ t: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, fg: cs.color || cs.fill, en: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' < ' + (el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + String(el.parentElement.className || '').split(/\s+/).join('.') : '') });
    }
    return { n, malos };
  });
  const pantallas = async (etiqueta) => {
    const out = {};
    const ver = async (nombre) => { const r = await medir(); out[nombre] = r; if (etiqueta === 'alto contraste' && /^(Puntos|Polígono|Reporte)$/.test(nombre)) await shot('v234-ac-' + nombre.toLowerCase().replace('í', 'i')); };
    await tab('puntos'); await ver('Puntos');
    await tab('area'); await page.click('[data-act="polyView"][data-v="croquis"]'); await ver('Polígono');
    await tab('clima'); await ver('Clima');
    await tab('informe'); await ver('Reporte');
    await tab('herramientas'); await ver('Herramientas');
    await act('appGuide'); await ver('Cómo usar la app');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await act('diag'); await ver('Registro de errores');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    const total = Object.values(out).reduce((s, r) => s + r.n, 0), malos = Object.entries(out).flatMap(([k, r]) => r.malos.map((m) => k + ': «' + m.t + '» ' + m.ratio + ':1 (' + m.en + ')'));
    console.log('      [' + etiqueta + '] textos medidos: ' + total + ' · por debajo del mínimo de 7:1: ' + malos.length);
    if (etiqueta === 'alto contraste') malos.slice(0, 150).forEach((m) => console.log('        ' + m));
    return { total, malos };
  };
  const proyecto = async () => {
    await setFile('#gisFile', 'finca.kml', fx.fincaKml(), 'application/vnd.google-earth.kml+xml');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importMain'); await waitSheetClosed();
    await page.evaluate(() => {
      const l = window.__app.S.projects[0].lots[0];
      l.points.forEach((p, i) => { p.alt = 2400 + i; p.altSrc = 'manual'; });
      l.climate.pManual = 1300;
      window.Store.saveState(window.__app.S);
      window.__app.showTab('puntos');
    });
  };

  await step('Alto contraste: viene apagado; se enciende en Herramientas › Preferencias, se guarda y se apaga igual', async () => {
    await fresh();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('alto-contraste')), false);
    await tab('herramientas');
    const chk = page.locator('input[data-flag="altoContraste"]');
    assert.equal(await chk.isChecked(), false);
    assert.match(await text('#tab-herramientas'), /Alto contraste\s*Negro sobre blanco y bordes marcados, para leer al sol\. Solo cambia los colores\./);
    const antes = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await chk.check();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('alto-contraste')), true, 'se aplica en el acto');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    assert.notEqual(antes, 'rgb(255, 255, 255)');
    await page.reload(); await page.waitForSelector('#tab-puntos');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('alto-contraste')), true, 'sigue al volver a abrir');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).backgroundColor), 'rgb(0, 0, 0)');
    await tab('herramientas');
    await page.locator('input[data-flag="altoContraste"]').uncheck();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('alto-contraste')), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), antes, 'vuelve a los colores de siempre');
  });

  await step('Alto contraste: medido en pantalla, todo texto llega a 7:1 (y nada cambia de lugar)', async () => {
    await fresh();
    await proyecto();
    const normal = await pantallas('modo normal');
    // las mismas pantallas en alto contraste: mismas posiciones, otros colores
    await tab('puntos');
    const cajas = () => page.$$eval('#tab-puntos .row, .tabs button, .top', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','); }));
    const c0 = await cajas();
    await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('zvg.v1.flags') || '{}'); f.altoContraste = true; localStorage.setItem('zvg.v1.flags', JSON.stringify(f)); });
    await page.reload(); await page.waitForSelector('#tab-puntos');
    await tab('puntos');
    assert.deepEqual(await cajas(), c0, 'cada fila, botón y barra queda en el mismo lugar y del mismo tamaño');
    const alto = await pantallas('alto contraste');
    assert.ok(alto.total > 150, 'se midieron ' + alto.total + ' textos');
    assert.deepEqual(alto.malos, [], 'textos por debajo de 7:1 en alto contraste');
    assert.ok(normal.total > 150);
    await shot('v234-alto-contraste');
  });

  await step('Registro de errores: anota un error sin coordenadas y nunca lo envía; se ve, se comparte y se borra', async () => {
    await fresh();
    await page.evaluate(() => localStorage.removeItem('zvg.v1.diagnostico'));
    const salidas = [];
    const mira = (r) => { const u = r.url(); if (!/^(data|blob):/.test(u) && !u.startsWith(c.url.replace(/\/[^/]*$/, ''))) salidas.push(u); };
    page.on('request', mira);
    const n = errors.length;
    await page.evaluate(() => {
      setTimeout(() => { throw new TypeError('No se pudo leer el punto en 4.601234,-74.080123'); }, 0);
      Promise.reject(new Error('Prueba de promesa sin atender'));
    });
    await page.waitForFunction(() => { const d = JSON.parse(localStorage.getItem('zvg.v1.diagnostico') || '{}'); return d.errores && d.errores.length === 2; });
    errors.splice(n);                                      // estos dos errores los provocó la prueba
    await tab('herramientas');
    assert.match(await text('#tab-herramientas'), /Registro de errores\s*2 errores anotados/);
    await act('diag');
    const hoja = await text('#sheet');
    assert.match(hoja, /Se guarda solo en este teléfono y nunca se envía solo: sale únicamente si tú lo compartes\. No guarda tus puntos ni coordenadas\./);
    assert.match(hoja, /TypeError: No se pudo leer el punto en #,#/);
    assert.match(hoja, /Prueba de promesa sin atender/);
    assert.match(hoja, /versión 2\.34\.0/);
    assert.doesNotMatch(hoja, /4\.601234|74\.080123/, 'sin coordenadas');
    const f = await download(() => page.click('[data-act="diagShare"]'));
    assert.match(f.name, /^don-florentino-sig-registro-\d{4}-\d{2}-\d{2}\.txt$/);
    assert.match(f.text, /^Registro de errores · Don Florentino SIG\nVersión: 2\.34\.0 · /);
    assert.match(f.text, /2\. .*· versión 2\.34\.0\n   TypeError: No se pudo leer el punto en #,#\n/);
    assert.match(f.text, /1\. .*promesa sin atender\n   Prueba de promesa sin atender/);
    assert.doesNotMatch(f.text, /4\.601234|74\.080123|127\.0\.0\.1|localhost/);
    await waitToast(/Archivo descargado: don-florentino-sig-registro-/);
    page.off('request', mira);
    assert.deepEqual(salidas, [], 'anotar, ver y compartir el registro no se conecta a ningún lado');
    await page.click('#sheet [data-act="diagClear"]');
    await page.click('[data-act="diagClearYes"]');
    await waitToast(/Registro borrado\./);
    assert.equal(await page.evaluate(() => localStorage.getItem('zvg.v1.diagnostico')), null);
    assert.match(await text('#tab-herramientas'), /Registro de errores\s*Sin errores/);
  });

  await step('Tiempo de arranque: se mide cada vez que abre (los últimos 10) y se ve en el registro', async () => {
    await fresh();
    await page.evaluate(() => localStorage.removeItem('zvg.v1.diagnostico'));
    for (let i = 0; i < 12; i++) { await page.reload(); await page.waitForFunction(() => window.__app && typeof window.__app.arranque === 'number'); }
    const ms = await page.evaluate(() => window.__app.arranque);
    assert.ok(ms > 0 && ms < 10000, 'abrió en ' + ms + ' ms');
    const d = await page.evaluate(() => JSON.parse(localStorage.getItem('zvg.v1.diagnostico')));
    assert.equal(d.arranques.length, 10, 'solo las últimas 10');
    assert.equal(d.arranques[9].ms, ms);
    assert.ok(d.arranques.every((a) => a.v === '2.34.0'));
    await tab('herramientas');
    assert.match(await text('#tab-herramientas'), /Registro de errores\s*Sin errores · abrió en \d+,\d s/);
    await act('diag');
    assert.match(await text('#diagArranque'), /^Última vez: \d+,\d s · promedio de 10: \d+,\d s$/);
    console.log('      arranque en este equipo (vacío): ' + ms + ' ms · promedio de 10: ' + Math.round(d.arranques.reduce((s, a) => s + a.ms, 0) / 10) + ' ms');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });
};

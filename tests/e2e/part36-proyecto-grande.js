'use strict';
/* Recorrido 36 — versión 2.34.0: prueba de proyecto grande y medición de tiempos.
   Un trabajo de campo grande hecho a mano: 26 proyectos y 6.800 puntos (una finca de 400 puntos con 20 lotes de 150 puntos y 8 capas
   de 300, más 25 fincas pequeñas). Se mide cuánto tarda en abrir, en cambiar de pantalla, en dibujar el mapa, en hacer el reporte
   de todo el proyecto (HTML y PDF), en exportar y en hacer la copia; y se revisa que todo salga completo.
   Los límites son holgados (unas 5 veces lo medido en el computador de pruebas, como mínimo 1 s): sirven para detectar si algo se vuelve
   mucho más lento en una versión futura, no para prometer tiempos. En un teléfono todo tarda más que en un computador.
   Medido en la 2.34.0 (cambia según lo ocupado que esté el equipo): abre en 0,4 a 1,5 s; lo más lento es la pantalla Polígono (de 0,25 a
   1,4 s), casi todo en revisar si los polígonos se cruzan entre sí (Predio.warnings → Geo.polygonsOverlap); el reporte PDF de los 21
   polígonos tarda de 11 a 14 s y pesa 17 MB. */
const fs = require('fs');
const path = require('path');

module.exports = async function (c) {
  const { page, assert, step, fresh, tab, act, waitSheetClosed, url } = c;
  const T0 = Date.UTC(2026, 10, 25, 15);
  const tiempos = [];
  const anota = (que, ms, limite) => { tiempos.push([que, Math.round(ms), limite]); assert.ok(ms < limite, que + ': ' + Math.round(ms) + ' ms (límite ' + limite + ' ms)'); };

  // Polígonos casi circulares (sin cruces), con altitud que sube y baja como en el campo
  const anillo = (lat0, lon0, r, n, pref, alt0) => Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n, w = 1 + 0.06 * Math.sin(5 * a);
    return { id: pref + i, name: 'P' + (i + 1), lat: +(lat0 + r * w * Math.cos(a)).toFixed(6), lon: +(lon0 + r * w * Math.sin(a) / Math.cos(lat0 * Math.PI / 180)).toFixed(6),
      alt: Math.round(alt0 + 40 * Math.sin(3 * a)), altSrc: 'manual', acc: 4, src: 'gps', t: T0 + i * 1000 };
  });
  const COLORES = ['#2F8F4E', '#1F3FBF', '#C42D34', '#8A5200', '#6A1B9A', '#00838F', '#AD1457', '#37474F'];
  function grande() {
    const lat = 4.60, lon = -74.08, finca = { id: 'finca', name: 'Finca grande', kind: 'finca', points: anillo(lat, lon, 0.011, 400, 'f', 2600), climate: { pManual: 1100 }, nextPoint: 401, mainColor: '#2F8F4E' };
    const lotes = Array.from({ length: 20 }, (_, k) => {
      const a = (2 * Math.PI * k) / 20;
      return { id: 'lote' + k, name: 'Lote ' + (k + 1), kind: 'area', parent: 'finca', points: anillo(lat + 0.0066 * Math.cos(a), lon + 0.0066 * Math.sin(a), 0.0008, 150, 'l' + k + '-', 2580 + k),
        climate: { pManual: 1100 + k * 10 }, nextPoint: 151, mainColor: COLORES[k % COLORES.length] };
    });
    const capas = Array.from({ length: 8 }, (_, k) => ({ id: 'capa' + k, name: 'Capa ' + (k + 1), kind: 'polygon', color: COLORES[k], visible: true, file: 'capa' + (k + 1) + '.kml',
      points: anillo(lat + 0.02 * Math.cos(k), lon + 0.02 * Math.sin(k), 0.002, 300, 'c' + k + '-', 2500).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name })) }));
    const otros = Array.from({ length: 25 }, (_, k) => ({ id: 'proy' + k, name: 'Finca ' + (k + 1), created: T0, layers: [], lotId: 'pf' + k,
      lots: [{ id: 'pf' + k, name: 'Predio', kind: 'finca', points: anillo(4 + k * 0.05, -75 + k * 0.03, 0.002, 40, 'p' + k + '-', 1500 + k * 40), climate: { pManual: 1500 + k * 20 }, nextPoint: 41, mainColor: '#2F8F4E' }] }));
    const p = { id: 'grande', name: 'Proyecto grande', created: T0, layers: capas, lotId: 'finca', lots: [finca].concat(lotes) };
    return { v: 1, currentId: 'grande', projects: [p].concat(otros), settings: { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' } };
  }
  const estado = grande();
  const PUNTOS = estado.projects.reduce((s, p) => s + p.lots.reduce((t, l) => t + l.points.length, 0) + p.layers.reduce((t, l) => t + l.points.length, 0), 0);
  const descarga = async (fn, timeout) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: timeout || 120000 }), fn()]);
    const f = await dl.path();
    return { name: dl.suggestedFilename(), text: fs.readFileSync(f, 'utf8'), bytes: fs.readFileSync(f) };
  };

  await step('Proyecto grande (26 proyectos, 6.800 puntos): abre completo y se mide cuánto tarda', async () => {
    assert.equal(PUNTOS, 6800);
    await fresh();
    const vacio = await page.evaluate(() => window.__app.arranque);
    const json = JSON.stringify(estado);
    await page.evaluate((s) => localStorage.setItem('zvg.v1.state', s), json);
    await page.goto(url); await page.waitForSelector('#tab-puntos');
    await page.waitForFunction(() => window.__app && typeof window.__app.arranque === 'number');
    const ms = await page.evaluate(() => window.__app.arranque);
    console.log('      estado guardado: ' + (json.length / 1048576).toFixed(2) + ' MB · arranque vacío ' + vacio + ' ms · con el proyecto grande ' + ms + ' ms');
    anota('Abrir la app (proyecto grande)', ms, 3000);
    const s = await c.state();
    assert.equal(s.projects.length, 26);
    assert.equal(s.projects[0].lots.length, 21);
    assert.equal(s.projects.reduce((t, p) => t + p.lots.reduce((u, l) => u + l.points.length, 0) + p.layers.reduce((u, l) => u + l.points.length, 0), 0), PUNTOS, 'no se perdió ningún punto');
    assert.equal((await page.$$('#tab-puntos .row.pt')).length, 400, 'la lista muestra los 400 puntos de la finca');
  });

  await step('Proyecto grande: cambiar de pantalla, guardar y dibujar el mapa con 21 polígonos y 8 capas', async () => {
    for (const [t, nombre, lim] of [['puntos', 'Puntos', 1000], ['area', 'Polígono (croquis)', 7000], ['clima', 'Información', 1000], ['informe', 'Reporte', 1000], ['herramientas', 'Herramientas', 1000]]) {
      const ms = await page.evaluate((x) => { const t0 = performance.now(); window.__app.showTab(x); return performance.now() - t0; }, t);
      anota('Pantalla ' + nombre, ms, lim);
    }
    const g = await page.evaluate(() => { const t0 = performance.now(); const r = window.Store.saveState(window.__app.S); return { ms: performance.now() - t0, ok: r.ok }; });
    assert.equal(g.ok, true, 'se puede guardar');
    anota('Guardar todo', g.ms, 1000);
    await tab('area');
    const t0 = Date.now();
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mk-dot', { state: 'attached', timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#mapHost .mk-dot').length >= 400, null, { timeout: 20000 });
    anota('Abrir el mapa', Date.now() - t0, 3000);
    // el mapa dibuja con «canvas» (no deja una figura por polígono en la página): se cuenta lo que el mapa dice tener
    const m = await page.evaluate(() => { const i = window.__app.ui.map.info(); return { markers: i.markers.length, layers: i.layers.length }; });
    assert.equal(m.markers, 400, 'los 400 puntos de la finca');
    assert.ok(m.layers >= 28, 'los otros 20 polígonos y las 8 capas (' + m.layers + ')');
    await page.click('[data-act="polyView"][data-v="croquis"]');
  });

  await step('Proyecto grande: reporte de todo el proyecto (HTML y PDF), exportar KML y copia de seguridad, completos', async () => {
    await tab('informe');
    let t0 = Date.now();
    const h = await descarga(() => c.compartir('Html'));
    anota('Reporte HTML de todo el proyecto', Date.now() - t0, 20000);
    assert.equal((h.text.match(/<h1 class="lt">/g) || []).length, 21, 'un capítulo por cada polígono');
    assert.ok(h.text.includes('Resumen del proyecto'));
    t0 = Date.now();
    const pdf = await descarga(() => c.compartir('Pdf'), 180000);
    anota('Reporte PDF de todo el proyecto', Date.now() - t0, 70000);
    assert.equal(pdf.bytes.slice(0, 5).toString('latin1'), '%PDF-');
    const paginas = (pdf.bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(paginas >= 21, paginas + ' páginas');
    console.log('      reporte HTML ' + (h.bytes.length / 1048576).toFixed(1) + ' MB · PDF ' + (pdf.bytes.length / 1048576).toFixed(1) + ' MB, ' + paginas + ' páginas');
    await tab('area');
    await page.click('[data-act="polyView"][data-v="croquis"]');
    t0 = Date.now();
    const k = await descarga(() => page.click('[data-act="export"][data-fmt="kml"]'));
    anota('Exportar KML', Date.now() - t0, 1000);
    assert.ok((k.text.match(/<Placemark>/g) || []).length >= 21, 'el KML trae los polígonos');
    await act('projects');
    t0 = Date.now();
    const b = await descarga(() => page.click('[data-act="backupJson"]'));
    anota('Copia de seguridad (.json)', Date.now() - t0, 3000);
    const raw = JSON.parse(b.text);
    const n = raw.state.projects.reduce((t, p) => t + p.lots.reduce((u, l) => u + l.points.length, 0) + p.layers.reduce((u, l) => u + l.points.length, 0), 0);
    assert.equal(n, PUNTOS, 'la copia lleva todos los puntos');
    if (await page.locator('#sheet:not([hidden])').count()) { await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed(); }
    // tabla de tiempos, para comparar entre versiones
    console.log('      ' + tiempos.map(([q, ms, l]) => q + ': ' + ms + ' ms (límite ' + l + ')').join('\n      '));
    fs.writeFileSync(path.join(require('os').tmpdir(), 'tiempos-proyecto-grande.json'), JSON.stringify(tiempos, null, 1));
  });
};

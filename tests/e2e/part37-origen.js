'use strict';
/* Recorrido 37 — versión 2.34.1: el origen de cada punto, para la mayor certeza en los datos y la veracidad del reporte.
   Un polígono con puntos de cuatro orígenes: importados de un archivo (con su altitud), uno escrito a mano, uno del GPS (con su
   precisión) y uno de una versión anterior que no guardó su origen. La lista, la ficha y el reporte (en la app, HTML y PDF) deben
   decir de dónde salió cada uno, sin suponer nada, y los datos guardados no deben cambiar. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, setFile, waitSheetClosed, download, addPointManual, compartir, shot, shots } = c;
  const ring = [[4.6000, -74.0800], [4.6000, -74.0790], [4.6010, -74.0790], [4.6010, -74.0800]];
  const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Lote del archivo</name><Polygon><outerBoundaryIs><LinearRing><coordinates>' +
    ring.concat([ring[0]]).map((p, i) => p[1] + ',' + p[0] + ',' + (2600 + (i % 4) * 5)).join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';
  const RESUMEN = '1 con GPS (±4 m), 1 a mano, 4 de un archivo y 1 sin dato de origen. Altitud: 1 del GPS (±8 m), 1 a mano, 4 del archivo y 1 sin dato de origen.';
  let guardados = null;

  await step('Lista y ficha: cada punto dice de dónde salió (archivo, a mano, GPS o «sin dato»), sin suponer «a mano»', async () => {
    await fresh();
    await setFile('#gisFile', 'lote.kml', kml, 'application/vnd.google-earth.kml+xml');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importMain'); await waitSheetClosed();
    await addPointManual('4.6004, -74.0796', 2612, 'Mano');
    await page.evaluate(() => {
      const l = window.__app.S.projects[0].lots[0];
      l.points.push({ id: 'g1', name: 'Satelite', lat: 4.6006, lon: -74.0794, alt: 2618, altGps: 2618, altSrc: 'gps', acc: 3.6, altAcc: 8.4, src: 'gps', ts: Date.now() });
      l.points.push({ id: 'v1', name: 'Viejo', lat: 4.6008, lon: -74.0798, alt: 2605, ts: Date.now() });          // de una versión anterior: sin origen guardado
      l.climate.pManual = 1300;
      window.Store.saveState(window.__app.S);
      window.__app.showTab('puntos');
    });
    guardados = JSON.stringify((await c.state()).projects[0].lots[0].points);
    const filas = await page.$$eval('#tab-puntos .row.pt', (els) => els.map((e) => [e.querySelector('.pname').textContent, e.querySelector('.psub').textContent, e.querySelector('.alt').textContent]));
    const de = (n) => filas.find((f) => f[0] === n);
    assert.deepEqual(filas.filter((f) => /^P\d$/.test(f[0])).map((f) => [f[1], f[2].replace(/^[\d.,]+ m · /, '')]), Array(4).fill(['de un archivo', 'archivo']), 'los importados: posición y altitud del archivo (la altitud decía «a mano»)');
    assert.deepEqual(de('Mano').slice(1), ['escrito a mano', '2612 m · a mano']);
    assert.deepEqual(de('Satelite').slice(1), ['precisión ±4 m', '2618 m · GPS']);
    assert.deepEqual(de('Viejo').slice(1), ['origen sin dato', '2605 m · sin dato']);
    // ficha del punto sin origen
    await page.click('#tab-puntos [data-act="editPoint"][data-id="v1"]');
    assert.equal(await text('#sheet h3.sub + dl.kv dd'), 'sin dato', '«Origen de la posición»');
    assert.match(await text('#fAltHint'), /^No se guardó de dónde salió esta altitud \(punto de una versión anterior\)\. Puedes corregirla\.$/);
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await page.locator('#tab-puntos .row.pt').first().click();
    assert.equal(await text('#fAltHint'), 'Altitud tomada del archivo importado. Puedes corregirla.', 'antes decía «Altitud escrita a mano.»');
    assert.equal(await text('#sheet h3.sub + dl.kv dd'), 'archivo importado');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });

  await step('Reporte en la app y HTML: el resumen «Origen de los puntos» (en «Datos usados» y en Terreno) y una línea de origen bajo cada punto', async () => {
    await tab('informe');
    const r = await text('#tab-informe');
    const rr = r.replace(/\s+/g, ' '), i = rr.indexOf('Origen de los puntos');
    // en la vista del reporte de la app, en «Datos usados» (título y valor pueden venir pegados en el texto de la página)
    assert.ok(/Origen de los puntos ?1 con GPS/.test(rr) && rr.includes(RESUMEN), 'resumen en la vista del reporte: ' + (i >= 0 ? rr.slice(i, i + 260) : rr.slice(0, 600)));
    const h = await download(() => compartir('Html'));
    assert.ok(h.text.includes('<tr><th>Origen de los puntos</th><td>' + RESUMEN + '</td></tr>'), 'resumen en el HTML');
    for (const [n, o] of [['P1', 'de un archivo'], ['Mano', 'a mano'], ['Satelite', 'GPS ±4 m · altitud ±8 m'], ['Viejo', 'origen sin dato']]) {
      assert.match(h.text, new RegExp(n + '</th><td>[^<]*(<br><span class="small">[^<]*</span>)?<br><span class="small">' + o + '</span></td>'), n + ': ' + o);
    }
    await shot('v2341-origen-reporte');
  });

  await step('Reporte PDF: el mismo resumen y el origen de cada punto; los datos guardados no cambian', async () => {
    const f = await download(() => compartir('Pdf'));
    assert.equal(Buffer.from(f.bytes.slice(0, 5)).toString('latin1'), '%PDF-');
    if (spawnSync('which', ['pdftotext']).status === 0) {
      const file = path.join(shots, 'v2341-origen.pdf');
      fs.writeFileSync(file, Buffer.from(f.bytes));
      const t = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
      assert.ok(t.includes('Origen de los puntos'), 'fila del resumen');
      assert.ok(t.includes('1 con GPS (±4 m), 1 a mano, 4 de un archivo y 1 sin dato de origen.'), 'resumen en el PDF');
      assert.ok(t.includes('GPS ±4 m · altitud ±8 m'), 'origen del punto del GPS');
      assert.ok(t.includes('origen sin dato'), 'el punto sin origen no se presenta como «a mano»');
    }
    assert.equal(JSON.stringify((await c.state()).projects[0].lots[0].points), guardados, 'mirar y compartir el reporte no cambia ningún punto');
  });
};

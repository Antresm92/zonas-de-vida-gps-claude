'use strict';
/* Recorrido 34 — versión 2.33.0: auditoría de seguridad de las pantallas y del reporte.
   Un archivo compartido (KML, GeoJSON) o lo que alguien escribe puede traer «código» en un nombre. Aquí cada nombre lleva una
   carga que, si la app la tratara como HTML, sumaría 1 a window.__xss (o daría un error de JavaScript). Se recorren las
   pantallas donde aparecen esos nombres y se comprueba que siempre salen como texto. El reporte HTML, además, lleva una
   política de seguridad (CSP) que no deja correr scripts aunque alguien lo edite. */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, setFile, waitSheetClosed, download, state, errors, context, shot } = c;
  const X = '<img src=x onerror=__xss++>';                  // etiqueta nueva
  const Q = '"><img src=x onerror=__xss++>';                // salir de un atributo value="…"
  const S = "'><svg onload=__xss++>";                       // comillas simples
  const T = '</title><script>__xss++</script>';             // cerrar etiquetas
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ring = [[4.6000, -74.0800], [4.6000, -74.0790], [4.6010, -74.0790], [4.6010, -74.0800]];
  const kmlPoly = (name, r) => '<Placemark><name>' + xml(name) + '</name><Polygon><outerBoundaryIs><LinearRing><coordinates>' +
    r.concat([r[0]]).map((p) => p[1] + ',' + p[0] + ',2600').join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
  const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xml(T) + '</name>' + kmlPoly(X, ring) + '</Document></kml>';
  const capa = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: Q }, geometry: { type: 'Polygon', coordinates: [[[-74.0805, 4.6005], [-74.0795, 4.6005], [-74.0795, 4.6015], [-74.0805, 4.6015], [-74.0805, 4.6005]]] } },
    { type: 'Feature', properties: { name: S }, geometry: { type: 'Point', coordinates: [-74.0797, 4.6003] } }
  ] });

  // Ninguna carga se convirtió en HTML: el contador sigue en 0, no hay errores y no apareció ninguna etiqueta de las cargas
  const limpio = async (donde) => {
    await page.waitForTimeout(250);                         // una imagen rota avisa su error un instante después
    const r = await page.evaluate(() => ({ n: window.__xss, tags: document.querySelectorAll('img[src="x"], [onerror], [onload], svg[onload]').length }));
    assert.equal(r.n, 0, donde + ': una carga se ejecutó');
    assert.equal(r.tags, 0, donde + ': apareció una etiqueta de una carga');
    assert.deepEqual(errors.filter((e) => /__xss/.test(e)), [], donde);
  };

  await step('Un KML y un GeoJSON con código en los nombres se importan y se ven como texto en todas las pantallas', async () => {
    await fresh();
    await page.evaluate(() => { window.__xss = 0; });
    await setFile('#gisFile', 'peligroso.kml', kml, 'application/vnd.google-earth.kml+xml');
    await page.waitForSelector('#sheet:not([hidden])');
    await limpio('hoja «Importar archivo»');
    await act('importMain'); await waitSheetClosed();
    assert.ok((await c.toastText()).includes(X), 'el aviso muestra el nombre del archivo como texto');
    await limpio('aviso de importación');
    await setFile('#gisFile', 'capa.geojson', capa, 'application/geo+json');
    await page.waitForSelector('#sheet:not([hidden])');
    await act('importLayer'); await waitSheetClosed();
    // nombres de puntos, nota, proyecto y encabezado del reporte con cargas (como si vinieran de una copia de seguridad)
    await page.evaluate(([x, q, s, t]) => {
      const p = window.__app.S.projects[0], l = p.lots[0];
      p.name = t; l.name = x; l.points[0].name = x; l.points[1].name = q; l.points[2].name = s; l.points[3].name = t; l.points[0].note = q;
      l.climate.pManual = 1200;                             // con altitud (del archivo) y lluvia, el reporte queda listo
      localStorage.setItem('zvg.v1.author', JSON.stringify({ name: q, org: x }));
      window.__app.showTab('puntos');
    }, [X, Q, S, T]);
    const s = await state();
    assert.equal(s.projects[0].lots[0].name, X, 'el nombre del polígono se guarda tal cual (es texto)');
    assert.ok(s.projects[0].lots[0].points.every((pt) => pt.alt === 2600), 'la altitud viene del archivo');
    assert.ok(s.projects[0].layers.some((l) => l.name === Q), 'la capa conserva su nombre: ' + JSON.stringify(s.projects[0].layers.map((l) => l.name)));
    await limpio('Puntos');
    assert.ok((await text('#tab-puntos')).includes(X), 'el nombre se lee tal cual, como texto');
    await page.locator('[data-act="editPoint"]').nth(1).click();
    assert.equal(await page.inputValue('#fName'), Q, 'en el campo del nombre: las comillas no rompen el campo');
    await limpio('ficha del punto');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await page.locator('[data-act="editLayer"]').first().click();
    await limpio('ficha de la capa');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await tab('area');
    await page.click('[data-act="polyView"][data-v="croquis"]');
    await limpio('Polígono › Croquis');
    await page.click('[data-act="polyView"][data-v="mapa"]');
    await page.waitForSelector('#mapHost .mapa-leaflet .leaflet-pane', { state: 'attached' });
    await page.waitForFunction(() => window.__app.ui.map && window.__app.ui.map.info().zoom >= 15, null, { timeout: 8000 });
    await page.waitForSelector('.mk-lab', { state: 'attached' });
    await limpio('Polígono › Mapa');
    const rotulos = await page.$$eval('.mk-lab', (e) => e.map((x) => x.textContent));
    assert.ok(rotulos.some((r) => r.includes(X)), 'el rótulo del mapa muestra el texto: ' + JSON.stringify(rotulos));
    await page.click('section.tab:not([hidden]) .lots .lotchip[aria-pressed="true"]');
    await limpio('hoja de polígonos');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await tab('clima'); await limpio('Clima');
    await tab('informe'); await limpio('Reporte');
    assert.ok((await text('#tab-informe')).includes(X));
    await tab('herramientas'); await limpio('Herramientas');
    await act('projects'); await limpio('Proyectos');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await act('authorEdit');
    assert.equal(await page.inputValue('#auName'), Q); assert.equal(await page.inputValue('#auOrg'), X);
    await limpio('Encabezado del reporte');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
    await shot('v233-xss-texto');
  });

  await step('El reporte HTML lleva los nombres como texto y una política que no deja correr scripts', async () => {
    await tab('informe');
    const f = await download(() => c.compartir('Html'));
    assert.match(f.text, /^<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
    for (const carga of [X, Q, S, T]) assert.ok(!f.text.includes(carga), 'la carga ' + carga + ' no aparece sin escapar');
    assert.ok(f.text.includes('&lt;img src=x onerror=__xss++&gt;'));
    const p2 = await context.newPage();
    const errs = [];
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.setContent(f.text);
    await p2.waitForTimeout(300);
    const r = await p2.evaluate(() => {
      // un script agregado a la página (como lo haría alguien que edita el archivo) no corre: lo bloquea la política
      const sc = document.createElement('script'); sc.textContent = 'window.__corrio = 1'; document.head.appendChild(sc);
      return { xss: typeof window.__xss, corrio: window.__corrio === 1, tags: document.querySelectorAll('img[src="x"], [onerror], [onload]').length, svgs: document.querySelectorAll('svg').length };
    });
    assert.deepEqual([r.xss, r.corrio, r.tags], ['undefined', false, 0]);
    assert.ok(r.svgs >= 2, 'los dibujos (que son parte del documento) se siguen viendo');
    assert.deepEqual(errs, []);
    await p2.close();
  });

  await step('Lo exportado (KML y GPX) lleva los nombres escapados y vuelve a entrar idéntico', async () => {
    await tab('area');
    await page.click('[data-act="polyView"][data-v="croquis"]');
    const k = await download(() => page.click('[data-act="export"][data-fmt="kml"]'));
    assert.ok(!k.text.includes(X) && k.text.includes(xml(X)), 'KML con el nombre escapado');
    const g = await download(() => page.click('[data-act="export"][data-fmt="gpx"]'));
    assert.ok(!g.text.includes(X) && g.text.includes(xml(X)), 'GPX con el nombre escapado');
    assert.match(g.text, /creator="Don Florentino SIG"/);
    await setFile('#gisFile', 'de-vuelta.kml', k.text, 'application/vnd.google-earth.kml+xml');
    await page.waitForSelector('#sheet:not([hidden])');
    await limpio('importar el KML exportado');
    await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed();
  });
};

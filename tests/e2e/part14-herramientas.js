'use strict';
/* Recorrido 14 — versión 2.7.0: pestaña «Herramientas» (quinta del menú inferior): conversor de unidades (ocho tarjetas), clima actual donde estás
 * (Open-Meteo, respuestas simuladas) y GPS en vivo (lecturas simuladas). */
module.exports = async function (c) {
  const { page, assert, step, fresh, act, tab, text, fill, waitToast, waitSheetClosed, addPointManual, gpsPush, shot, sheetTitle, sheetOpen, proj, errors, context } = c;

  /* ---------- Ayudas ---------- */
  const CATS = [['area', 'Área', 10, 'm²'], ['distancia', 'Distancia', 9, 'm'], ['peso', 'Peso', 6, 'kg'], ['volumen', 'Volumen', 9, 'L'], ['energia', 'Energía', 9, 'J'],
    ['temperatura', 'Temperatura', 4, '°C'], ['velocidad', 'Velocidad', 5, 'km/h'], ['potencia', 'Potencia', 7, 'W']];
  const abrir = async (cat) => { await tab('herramientas'); await page.click('[data-act="convert"][data-tool="' + cat + '"]'); await page.waitForSelector('#cvRes .cvrow, #cvRes .tip'); };
  const filas = () => page.$$eval('#cvRes .cvrow', (els) => els.map((e) => [e.querySelector('.cvn').textContent, e.querySelector('b').textContent.replace(/\s+/g, ' ').trim()]));
  const fila = async (nombre) => { const f = (await filas()).find((x) => x[0].startsWith(nombre)); assert.ok(f, 'no hay fila «' + nombre + '»: ' + JSON.stringify(await filas())); return f[1]; };
  const cerrar = async () => { if (await sheetOpen()) { await page.click('#sheet [aria-label="Cerrar"]'); await waitSheetClosed(); } };
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  // Los avisos duran poco y el siguiente tapa al anterior: se anotan todos los que aparecen
  const watchToasts = () => page.evaluate(() => {
    window.__toasts = [];
    const el = document.querySelector('#toast');
    new MutationObserver(() => { if (!el.hidden && el.textContent) window.__toasts.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  const GPS = { lat: 4.6, lon: -74.08, alt: 2640, acc: 8 };

  /* Open-Meteo simulado (como en el recorrido 11); «gate» deja la respuesta en espera para probar que se cierre la ventana antes de que llegue */
  const mock = { mode: 'ok', hits: 0, urls: [], gate: null };
  const CORS = { 'access-control-allow-origin': '*' };
  const RESP = (t) => ({ latitude: 4.6, longitude: -74.1, timezone: 'America/Bogota',
    current: { time: '2026-10-28T14:00', interval: 900, temperature_2m: t, relative_humidity_2m: 87, weather_code: 1, pressure_msl: 1013.2, wind_speed_10m: 5.4 },
    daily: { time: ['2026-10-28'], sunrise: ['2026-10-28T05:44'], sunset: ['2026-10-28T17:42'] } });
  await page.route('**/api.open-meteo.com/v1/forecast**', async (r) => {
    mock.hits++; mock.urls.push(r.request().url());
    if (mock.gate) await mock.gate;
    if (mock.mode === 'fail') return r.fulfill({ status: 503, headers: CORS, body: 'busy' });
    r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(RESP(24.3)) });
  });
  const reset = () => { mock.mode = 'ok'; mock.hits = 0; mock.urls = []; mock.gate = null; };
  const query = (i) => new URL(mock.urls[i === undefined ? mock.urls.length - 1 : i]).searchParams;

  /* ---------- La pestaña ---------- */
  await step('Menú inferior: «Herramientas» es la quinta pestaña y abre su pantalla con las ocho tarjetas del conversor y las de Clima y GPS', async () => {
    await fresh();
    const etiquetas = await page.$$eval('nav.tabs button span', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(etiquetas, ['Puntos', 'Polígono', 'Información', 'Reporte', 'Herramientas']);
    await tab('herramientas');
    assert.equal(await page.getAttribute('#nav-herramientas', 'aria-current'), 'page');
    assert.equal(await page.isVisible('#tab-herramientas'), true);
    assert.equal(await page.isVisible('#tab-puntos'), false);
    assert.equal(await text('#tab-herramientas h2'), 'Herramientas');
    assert.equal(await text('#tab-herramientas .lead'), 'Conversor de unidades y utilidades de campo.');
    const h3 = await page.$$eval('#tab-herramientas h3', (els) => els.map((e) => e.textContent));
    assert.deepEqual(h3, ['Conversor de unidades', 'Utilidades de campo']);
    const tarjetas = await page.$$eval('#tab-herramientas .tcard', (els) => els.map((e) => { const s = e.querySelector('span'); return [e.querySelector('b').textContent, s ? s.textContent : null, e.getAttribute('data-act')]; }));
    assert.deepEqual(tarjetas, [...CATS.map((x) => [x[1], null, 'convert']), ['Clima', 'Condiciones actuales', 'toolWeather'], ['GPS', 'Coordenadas y precisión', 'toolGps']]);
    assert.equal(await page.locator('#tab-herramientas .tcard svg').count(), 10, 'cada tarjeta lleva su ícono');
    assert.equal(await page.locator('#tab-herramientas .tcard[data-act="convert"] span').count(), 0, 'las tarjetas del conversor no llevan subtítulo (2.8.1)');
    assert.equal(await page.locator('#tab-herramientas .tcard:not([data-act="convert"]) span').count(), 2, 'Clima y GPS conservan el suyo');
    await shot('140-herramientas');
    await tab('puntos');
    assert.equal(await page.isVisible('#tab-herramientas'), false);
    assert.equal(await page.getAttribute('#nav-puntos', 'aria-current'), 'page');
    assert.equal(await page.getAttribute('#nav-herramientas', 'aria-current'), null);
  });

  await step('Cabe en pantallas angostas: sin desbordar a los lados ni cortar las etiquetas del menú (390 × 844, 360 × 640 y 320 × 640)', async () => {
    await tab('herramientas');
    for (const [w, h] of [[390, 844], [360, 640], [320, 640]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(100);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        cortadas: Array.from(document.querySelectorAll('nav.tabs button span')).filter((e) => e.scrollWidth > e.parentElement.clientWidth).map((e) => e.textContent),
        fuera: Array.from(document.querySelectorAll('#tab-herramientas .tcard')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5).length,
        textoFuera: Array.from(document.querySelectorAll('#tab-herramientas .tcard b, #tab-herramientas .tcard span')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent) }));
      assert.ok(m.sw <= m.iw, w + ' px: la pantalla se desborda (' + m.sw + ' > ' + m.iw + ')');
      assert.deepEqual(m.cortadas, [], w + ' px: etiquetas cortadas');
      assert.equal(m.fuera, 0, w + ' px: tarjetas fuera de la pantalla');
      assert.deepEqual(m.textoFuera, [], w + ' px: textos de tarjeta cortados');
      if (w === 360) await shot('141-herramientas-360');
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  /* ---------- Conversor ---------- */
  await step('Cada tarjeta abre su conversor con el valor 1 en su unidad inicial y el resultado en todas las unidades a la vez', async () => {
    await fresh();
    for (const [id, nombre, n, sym] of CATS) {
      await abrir(id);
      assert.equal(await sheetTitle(), nombre);
      assert.equal(await page.inputValue('#cvVal'), '1');
      assert.equal(await page.locator('#cvUnit option').count(), n, nombre + ': unidades');
      assert.equal(await page.locator('#cvRes .cvrow').count(), n, nombre + ': filas');
      assert.equal(await page.locator('#cvRes .cvrow.cvfrom').count(), 1);
      const origen = await page.$eval('#cvRes .cvfrom b', (e) => e.textContent.replace(/\s+/g, ' ').trim());
      assert.equal(origen, '1 ' + sym, nombre + ': la fila de origen');
      await cerrar();
    }
    assert.deepEqual(errors, []);
  });

  await step('Área: 2,5 ha → 25.000 m², 3,90625 fanegadas, 6,177635 acres; el punto o la coma sirven como decimal', async () => {
    await abrir('area');
    await shot('142-conversor-area');
    await fill('#cvVal', '2,5');
    await page.selectOption('#cvUnit', 'ha');
    assert.equal(await fila('metro cuadrado'), '25.000 m²');
    assert.equal(await fila('hectárea'), '2,5 ha');
    assert.equal(await fila('kilómetro cuadrado'), '0,025 km²');
    assert.equal(await fila('fanegada'), '3,90625 fanegada');
    assert.equal(await fila('acre'), '6,177635 ac');
    assert.equal(await fila('pie cuadrado'), '269.097,8 ft²');
    assert.equal(await text('#cvRes .cvfrom .cvn'), 'hectárea');
    await fill('#cvVal', '2.5');
    assert.equal(await fila('metro cuadrado'), '25.000 m²');
    await fill('#cvVal', '1.234,5');
    assert.equal(await fila('metro cuadrado'), '12.345.000 m²');
    await fill('#cvVal', '1 fanegada'.replace(' fanegada', ''));
    await page.selectOption('#cvUnit', 'fanegada');
    assert.equal(await fila('hectárea'), '0,64 ha', 'una fanegada = 6.400 m²');
    assert.equal(await fila('metro cuadrado'), '6400 m²');
  });

  await step('Lo escrito se convierte al instante; un texto que no es número o un campo vacío explican qué pasa en lugar de mostrar resultados', async () => {
    await abrir('distancia');
    await fill('#cvVal', '1');
    await page.selectOption('#cvUnit', 'mi');
    assert.equal(await fila('kilómetro'), '1,609344 km');
    assert.equal(await fila('pie'), '5280 ft');
    assert.equal(await fila('milla náutica'), '0,8689762 nmi');
    await fill('#cvVal', 'abc');
    assert.equal(await page.locator('#cvRes .cvrow').count(), 0);
    assert.match(await text('#cvRes'), /No se entiende ese número\. Escríbelo así: 1234,5/);
    await fill('#cvVal', '');
    assert.match(await text('#cvRes'), /^Escribe un número para convertir\.$/);
    await fill('#cvVal', '1,5.3,2');
    assert.match(await text('#cvRes'), /No se entiende/);
    await fill('#cvVal', '-5');
    assert.equal(await fila('metro'), '-8046,72 m');
    await fill('#cvVal', '1e30');
    assert.equal(await fila('kilómetro'), '1,609344e30 km');
    await fill('#cvVal', '1e-20');
    assert.match(await fila('metro'), /^1,609344e-17 m$/);
    assert.deepEqual(errors, []);
  });

  await step('Temperatura: 100 °C son 212 °F, 373,15 K y 671,67 °R; por debajo del cero absoluto avisa', async () => {
    await abrir('temperatura');
    await fill('#cvVal', '100');
    assert.equal(await fila('grado Celsius'), '100 °C');
    assert.equal(await fila('grado Fahrenheit'), '212 °F');
    assert.equal(await fila('kelvin'), '373,15 K');
    assert.equal(await fila('grado Rankine'), '671,67 °R');
    await shot('143-conversor-temperatura');
    await fill('#cvVal', '-40');
    assert.equal(await fila('grado Fahrenheit'), '-40 °F');
    await fill('#cvVal', '-300');
    assert.equal(await page.locator('#cvRes .cvrow').count(), 0);
    assert.match(await text('#cvRes'), /cero absoluto/);
    await page.selectOption('#cvUnit', 'k');
    await fill('#cvVal', '0');
    assert.equal(await fila('grado Celsius'), '-273,15 °C');
    assert.equal(await fila('grado Rankine'), '0 °R');
  });

  await step('Peso, volumen, energía, velocidad y potencia dan los valores de referencia (1 lb = 453,5924 g, 1 gal = 3,785412 L, 1 kWh = 3600 kJ, 60 mph = 96,56064 km/h, 1 hp = 745,6999 W)', async () => {
    await abrir('peso'); await fill('#cvVal', '1'); await page.selectOption('#cvUnit', 'lb');
    assert.equal(await fila('gramo'), '453,5924 g'); assert.equal(await fila('onza'), '16 oz');
    await cerrar();
    await abrir('volumen'); await fill('#cvVal', '1'); await page.selectOption('#cvUnit', 'galus');
    assert.equal(await fila('litro'), '3,785412 L'); assert.equal(await fila('onza líquida'), '128 fl oz');
    await cerrar();
    await abrir('energia'); await fill('#cvVal', '1'); await page.selectOption('#cvUnit', 'kwh');
    assert.equal(await fila('kilojulio'), '3600 kJ'); assert.equal(await fila('kilocaloría'), '860,4207 kcal');
    await cerrar();
    await abrir('velocidad'); await fill('#cvVal', '60'); await page.selectOption('#cvUnit', 'mph');
    assert.equal(await fila('kilómetro por hora'), '96,56064 km/h'); assert.equal(await fila('nudo'), '52,13857 kn');
    await cerrar();
    await abrir('potencia'); await fill('#cvVal', '1'); await page.selectOption('#cvUnit', 'hp');
    assert.equal(await fila('vatio'), '745,6999 W'); assert.equal(await fila('caballo de vapor'), '1,01387 CV');
  });

  await step('El conversor recuerda el valor y la unidad de cada magnitud mientras la app está abierta; cada magnitud lleva los suyos', async () => {
    await fresh();
    await abrir('area'); await fill('#cvVal', '7'); await page.selectOption('#cvUnit', 'acre'); await cerrar();
    await abrir('distancia');
    assert.equal(await page.inputValue('#cvVal'), '1', 'la distancia no hereda lo del área');
    assert.equal(await page.inputValue('#cvUnit'), 'm');
    await cerrar();
    await abrir('area');
    assert.equal(await page.inputValue('#cvVal'), '7');
    assert.equal(await page.inputValue('#cvUnit'), 'acre');
    assert.equal(await fila('acre'), '7 ac');
    assert.equal(await sheetTitle(), 'Área');
  });

  await step('Tocar un resultado lo copia con su unidad y avisa; con el portapapeles bloqueado usa el método de respaldo', async () => {
    await abrir('area');
    await fill('#cvVal', '2,5'); await page.selectOption('#cvUnit', 'ha');
    await watchToasts();
    await page.click('#cvRes .cvrow >> nth=0');
    await waitToast(/^Copiado: 25\.000 m²$/);
    assert.equal(await clip(), '25.000 m²');
    await page.click('#cvRes .cvrow >> nth=3');
    await waitToast(/^Copiado: 3,90625 fanegada$/);
    assert.equal(await clip(), '3,90625 fanegada');
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.execCommand = () => true; });
    await page.click('#cvRes .cvrow >> nth=1');
    await waitToast(/^Copiado: 2,5 ha$/);
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.click('#cvRes .cvrow >> nth=1');
    await waitToast(/^No se pudo copiar\.$/);
  });

  await step('Funciona sin internet y sin errores de JavaScript', async () => {
    await fresh();
    await context.setOffline(true);
    try {
      await abrir('velocidad');
      await fill('#cvVal', '100');
      assert.equal(await fila('metro por segundo'), '27,77778 m/s');
      await shot('144-conversor-sin-internet');
    } finally { await context.setOffline(false); }
    assert.deepEqual(errors, []);
  });

  /* ---------- GPS ---------- */
  await step('GPS apagado: la tarjeta abre una ventana que lo dice y ofrece encenderlo; al encenderlo busca señal', async () => {
    await fresh();
    await tab('herramientas');
    await act('toolGps');
    assert.equal(await sheetTitle(), 'GPS');
    assert.match(await text('#toolBody'), /El GPS está apagado\. Enciéndelo para ver dónde estás\./);
    assert.equal(await text('#toolBody [data-act="toolGpsOn"]'), 'Encender GPS');
    assert.equal(await page.locator('#toolBody .readout').count(), 0);
    await act('toolGpsOn');
    assert.match(await text('#toolBody'), /Buscando señal/);
    assert.equal(await text('#gpsChipText'), 'Buscando señal…');
    assert.equal(await text('#toolBody [data-act="toolGpsOff"]'), 'Apagar GPS');
    await shot('145-gps-buscando');
  });

  await step('Con lectura: latitud, longitud, altitud y precisión en vivo; las nuevas lecturas cambian los números sin redibujar los botones', async () => {
    await tab('herramientas'); await act('toolGps');                       // el GPS sigue encendido y buscando señal
    assert.match(await text('#toolBody'), /Buscando señal/);
    await gpsPush(GPS);
    await page.waitForSelector('#toolBody .readout');
    assert.equal(await text('#tgLat'), '4.60000°');
    assert.equal(await text('#tgLon'), '-74.08000°');
    assert.equal((await text('#tgAlt')).trim(), '2640 m');
    assert.equal((await text('#tgAcc')).trim(), '±8 m');
    assert.match(await text('#tgDms'), /4° .*N .*74° .*W/);
    assert.equal(await text('#gpsChipText'), '±8 m');
    await shot('146-gps-lectura');
    const boton = await page.$('#toolBody [data-act="toolGpsCopy"]');
    await gpsPush({ lat: 4.60123, lon: -74.08456, alt: 2651, acc: 12 });
    assert.equal(await text('#tgLat'), '4.60123°');
    assert.equal(await text('#tgLon'), '-74.08456°');
    assert.equal((await text('#tgAlt')).trim(), '2651 m');
    assert.equal((await text('#tgAcc')).trim(), '±12 m');
    assert.equal(await boton.evaluate((e) => e.isConnected), true, 'el botón sigue siendo el mismo (un toque no se pierde)');
    await gpsPush({ lat: 4.6, lon: -74.08, acc: 6 });                       // sin altitud
    assert.equal((await text('#tgAlt')).trim(), 'sin dato');
  });

  await step('«Copiar coordenadas» deja «lat, lon» en el portapapeles listo para pegar en un mapa', async () => {
    await tab('herramientas'); await act('toolGps');
    await gpsPush(GPS);
    await page.waitForSelector('#toolBody .readout');
    await watchToasts();
    await act('toolGpsCopy');
    await waitToast(/^Coordenadas copiadas\.$/);
    assert.equal(await clip(), '4.60000, -74.08000');
  });

  await step('«Apagar GPS» vuelve a la pantalla de GPS apagado y el chip del encabezado lo refleja; la ventana abierta con el GPS ya encendido muestra la lectura de inmediato', async () => {
    await tab('herramientas'); await act('toolGps');
    await page.waitForSelector('#toolBody .readout');
    await act('toolGpsOff');
    assert.match(await text('#toolBody'), /El GPS está apagado/);
    assert.equal(await text('#gpsChipText'), 'GPS apagado');
    assert.equal(await page.locator('#toolBody .readout').count(), 0);
    await cerrar();
    await tab('puntos'); await act('gpsOn'); await gpsPush(GPS);
    await tab('herramientas'); await act('toolGps');
    await page.waitForSelector('#toolBody .readout');
    assert.equal(await text('#tgLat'), '4.60000°');
    await cerrar();
    assert.equal(await text('#gpsChipText'), '±8 m', 'cerrar la ventana no apaga el GPS');
  });

  await step('Cerrar la ventana de GPS y volver a abrir no deja lecturas viejas, y una lectura que llega con la ventana cerrada no falla', async () => {
    await act('toolGps');
    await cerrar();
    await gpsPush({ lat: 4.7, lon: -74.1, acc: 5 });
    await act('toolGps');
    await page.waitForSelector('#toolBody .readout');
    assert.equal(await text('#tgLat'), '4.70000°');
    await cerrar();
    await tab('puntos'); await act('gpsOff');
    assert.deepEqual(errors, []);
  });

  await step('Si el GPS no está disponible o el permiso se niega, la ventana avisa con el motivo y sigue usable', async () => {
    await fresh();
    await tab('herramientas'); await act('toolGps'); await act('toolGpsOn');
    await page.evaluate(() => window.__gps.error(1, 'denegado'));
    await page.waitForFunction(() => /Sin permiso de ubicación/.test(document.querySelector('#toast').textContent));
    assert.match(await text('#toolBody'), /El GPS está apagado/);
    assert.equal(await text('#toolBody [data-act="toolGpsOn"]'), 'Encender GPS');
    assert.deepEqual(errors, []);
  });

  /* ---------- Clima actual ---------- */
  await step('Clima sin conexión: la ventana lo dice, los botones quedan desactivados y no se pide nada', async () => {
    await fresh(); reset();
    await tab('herramientas');
    await context.setOffline(true);
    try {
      await act('toolWeather');
      assert.equal(await sheetTitle(), 'Clima actual');
      assert.match(await text('#toolBody'), /Sin conexión\. El clima actual se consulta con internet\./);
      assert.equal(await page.locator('#toolBody [data-act="toolWxGps"]').isDisabled(), true);
      assert.equal(mock.hits, 0);
      await shot('147-clima-sin-internet');
    } finally { await context.setOffline(false); }
    await cerrar();
  });

  await step('Clima sin puntos ni GPS: solo ofrece «Usar mi GPS»; al tocarlo enciende el GPS, espera la posición y pide el clima de donde estás', async () => {
    await fresh(); reset(); await watchToasts();
    await tab('herramientas'); await act('toolWeather');
    assert.equal(await text('#toolBody [data-act="toolWxGps"]'), 'Usar mi GPS');
    assert.equal(await page.locator('#toolBody [data-act="toolWxCenter"]').count(), 0, 'sin puntos no hay centro');
    assert.match(await text('#toolBody'), /no se guardan en el proyecto y no cambian la zona de vida/);
    assert.equal(mock.hits, 0, 'no consulta nada por sí solo');
    await act('toolWxGps');
    assert.match(await text('#toolBody'), /Buscando tu posición con el GPS/);
    assert.equal(await page.locator('#toolBody [data-act="toolWxGps"]').isDisabled(), true);
    assert.equal(await text('#gpsChipText'), 'Buscando señal…');
    assert.equal(mock.hits, 0, 'espera la lectura');
    await gpsPush(GPS);
    await page.waitForSelector('#toolBody .nowcard');
    assert.equal(mock.hits, 1);
    const q = query();
    assert.equal(q.get('latitude'), '4.60000'); assert.equal(q.get('longitude'), '-74.08000');
    assert.equal(q.get('current'), 'temperature_2m,relative_humidity_2m,weather_code,pressure_msl,wind_speed_10m');
    const t = await text('#toolBody');
    assert.match(t, /Tu posición/); assert.match(t, /4\.60000, -74\.08000 · GPS ±8 m/);
    assert.match(t, /24,3 °C/); assert.match(t, /Condición\s*Mayormente despejado/); assert.match(t, /Viento\s*5,4 km\/h/); assert.match(t, /Presión\s*1013 hPa/);
    assert.match(t, /Humedad\s*87 %/); assert.match(t, /Amanecer\s*05:44/); assert.match(t, /Atardecer\s*17:42/); assert.match(t, /Actualizado: .*· Open-Meteo/);
    assert.equal(await text('#toolBody [data-act="toolWxGps"]'), 'Actualizar');
    assert.equal(await page.locator('#toolBody [data-act="toolWxGps"]').isDisabled(), false);
    assert.equal((await proj()).weatherNow, undefined, 'no se guarda en el proyecto');
    await shot('148-clima-donde-estoy');
  });

  await step('Con el GPS ya encendido, abrir el clima consulta de inmediato; «Actualizar» vuelve a consultar con la posición de ahora', async () => {
    await tab('herramientas'); await act('toolWeather');                   // el GPS quedó encendido con la lectura anterior
    await page.waitForSelector('#toolBody .nowcard');
    assert.equal(mock.hits, 2);
    assert.equal(query().get('latitude'), '4.60000');
    await gpsPush({ lat: 4.65, lon: -74.1, acc: 5 });
    assert.match(await text('#toolBody'), /GPS ±8 m/, 'la tarjeta no cambia sola: espera a «Actualizar»');
    await act('toolWxGps');
    await page.waitForFunction(() => /4\.65000, -74\.10000 · GPS ±5 m/.test(document.querySelector('#toolBody').textContent));
    assert.equal(mock.hits, 3);
    assert.equal(query().get('latitude'), '4.65000');
    await cerrar();
    await tab('puntos'); await act('gpsOff');
  });

  await step('Con el GPS encendido desde Puntos y con lectura, abrir el clima consulta de inmediato; sin puntos no se pide un centro', async () => {
    await fresh(); reset();
    await tab('puntos'); await act('gpsOn'); await gpsPush(GPS);
    await tab('herramientas'); await act('toolWeather');
    await page.waitForSelector('#toolBody .nowcard');
    assert.equal(mock.hits, 1);
    assert.match(await text('#toolBody'), /Tu posición/);
    await cerrar();
    await tab('puntos'); await act('gpsOff');
  });

  await step('«Usar el centro de mis puntos» consulta el centro del proyecto, lo nombra y no lo guarda en el proyecto', async () => {
    await fresh(); reset();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await addPointManual('4.6060, -74.0700', 2640, 'Medio');
    await addPointManual('4.6090, -74.0750', 3500, 'Arriba');
    await tab('herramientas'); await act('toolWeather');
    assert.equal(await text('#toolBody [data-act="toolWxCenter"]'), 'Usar el centro de mis puntos');
    assert.equal(mock.hits, 0);
    await act('toolWxCenter');
    await page.waitForSelector('#toolBody .nowcard');
    assert.equal(mock.hits, 1);
    const q = query();
    assert.ok(Math.abs(+q.get('latitude') - 4.605) < 0.01 && Math.abs(+q.get('longitude') + 74.0750) < 0.01, 'centro: ' + q);
    const t = await text('#toolBody');
    assert.match(t, /Mi primer proyecto/); assert.match(t, /· centro de los puntos/); assert.match(t, /24,3 °C/);
    assert.doesNotMatch(t, /Tu posición/);
    assert.equal((await proj()).weatherNow, undefined, 'no se guarda en el proyecto');
    assert.equal(await text('#toolBody [data-act="toolWxGps"]'), 'Usar mi GPS');
    await cerrar();
    await tab('informe');                                                  // el reporte sigue sin clima actual propio
    assert.equal(await page.locator('#nowBlock .nowcard').count(), 0);
  });

  await step('Si Open-Meteo falla, la ventana lo dice con el motivo y se puede intentar otra vez', async () => {
    await fresh(); reset(); mock.mode = 'fail';
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await tab('herramientas'); await act('toolWeather'); await act('toolWxCenter');
    await page.waitForSelector('#toolBody .warn');
    assert.match(await text('#toolBody .warn'), /No se pudo consultar el clima actual: .*Revisa la conexión a internet/);
    assert.equal(await page.locator('#toolBody .nowcard').count(), 0);
    mock.mode = 'ok';
    await act('toolWxCenter');
    await page.waitForSelector('#toolBody .nowcard');
    assert.equal(await page.locator('#toolBody .warn').count(), 0, 'el error desaparece');
    assert.equal(mock.hits, 2);
  });

  await step('Si se cierra la ventana antes de que llegue la respuesta, no pasa nada, y al volver a abrirla empieza limpia', async () => {
    await fresh(); reset();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    let abrir_;
    mock.gate = new Promise((res) => { abrir_ = res; });
    await tab('herramientas'); await act('toolWeather'); await act('toolWxCenter');
    assert.match(await text('#toolBody'), /Consultando el clima/);
    assert.equal(await page.locator('#toolBody [data-act="toolWxCenter"]').isDisabled(), true, 'no se pueden lanzar dos consultas a la vez');
    await cerrar();
    abrir_(); mock.gate = null;
    await page.waitForTimeout(400);
    assert.equal(await sheetOpen(), false);
    await act('toolWeather');
    assert.equal(await page.locator('#toolBody .nowcard').count(), 0, 'sin tarjeta vieja');
    assert.equal(await text('#toolBody [data-act="toolWxCenter"]'), 'Usar el centro de mis puntos');
    assert.deepEqual(errors, []);
  });

  await step('Reporte y demás pestañas no cambian: el clima actual del Reporte sigue siendo el suyo y la copia de seguridad no lleva nada de Herramientas', async () => {
    await fresh(); reset();
    await addPointManual('4.6000, -74.0800', 1300, 'Abajo');
    await tab('herramientas'); await act('toolWeather'); await act('toolWxCenter'); await page.waitForSelector('#toolBody .nowcard'); await cerrar();
    const raw = await page.evaluate(() => JSON.stringify(window.__app.S));
    assert.doesNotMatch(raw, /convMem|wxToken|Open-Meteo|24\.3/);
    await tab('informe');
    assert.equal(await text('#nowBlock [data-act="fetchNow"]'), 'Consultar clima actual');
    assert.deepEqual(errors, []);
  });
};

'use strict';
/* Las hojas de ayuda se arman sin errores y ninguna fila queda vacía o rota (2.29.1: una coma faltante
   convertía la última fila de «Hasta dónde llega» en un acceso a una propiedad y rompía la hoja). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'ayudas.js'), 'utf8'), ctx);
  const sheets = [];
  const A = ctx.window.ZV.ayudas({ esc: (s) => String(s), openSheet: (t, h) => sheets.push([t, h]), APP_VERSION: '9.9.9' });
  return { A, sheets };
}

// «Qué hay de nuevo» se muestra solo si su identificador cambió: cada versión que agrega novedades lo sube (nunca lo baja)
const ver = (v) => String(v).split('.').map(Number).concat([0, 0, 0]).slice(0, 3);
const atLeast = (a, b) => { const x = ver(a), y = ver(b); for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k]; return true; };

test('cada hoja de ayuda se arma y no deja filas vacías ni «undefined»', () => {
  const { A, sheets } = load();
  ['openMapGuide', 'openAppGuide', 'openUses', 'openWhatsNew', 'openLicenses'].forEach((f) => A[f]());
  assert.equal(sheets.length, 5);
  for (const [t, h] of sheets) {
    assert.doesNotMatch(h, /undefined|<dt><\/dt>|<dd><\/dd>/, t);
    const dts = (h.match(/<dt>/g) || []).length, dds = (h.match(/<dd>/g) || []).length;
    assert.ok(dts > 2 && dts === dds, t + ': ' + dts + ' títulos y ' + dds + ' textos');
  }
  assert.match(A.WHATS_NEW_ID, /^\d+\.\d+(\.\d+)?$/);
});

test('la ayuda explica «Usos recomendados» donde corresponde', () => {
  const { A, sheets } = load();
  A.openAppGuide(); A.openUses(); A.openLicenses();
  assert.match(sheets[0][1], /Usos recomendados y evaluar el terreno/);
  assert.match(sheets[1][1], /capacidad de uso del IGAC/); assert.match(sheets[1][1], /No reemplaza un estudio de suelos/);
  assert.match(sheets[2][1], /IN-GAG-PC05-02/);
  assert.match(sheets[0][1], /Cultivos a evaluar y conclusión/); assert.match(sheets[1][1], /Conclusión y recomendaciones/);
  assert.match(sheets[1][1], /no una orden de siembra/); assert.match(sheets[2][1], /ECOCROP/);
});

test('la ayuda explica el mapa del IGAC (2.31.0) en las cinco hojas', () => {
  const { A, sheets } = load();
  A.openMapGuide(); A.openAppGuide(); A.openUses(); A.openWhatsNew(); A.openLicenses();
  assert.match(sheets[0][1], /Capacidad de uso \(IGAC\).*Guardar la zona del predio para usar sin conexión.*Es un mapa regional/s);
  assert.match(sheets[1][1], /Según el mapa del IGAC.*Consultar el mapa del IGAC/s);
  assert.match(sheets[2][1], /Según el mapa del IGAC/); assert.match(sheets[2][1], /algunos polígonos de estudios antiguos marcados «IV» salen con el color de la clase 6/);
  assert.match(sheets[3][1], /Según el mapa del IGAC.*Capa «Capacidad de uso \(IGAC\)»/s);
  assert.match(sheets[4][1], /mapa multiescalar.*CC BY 4\.0 \(Resolución 616 de 2020\)/s);
  assert.ok(atLeast(A.WHATS_NEW_ID, '2.31'), A.WHATS_NEW_ID);
});

test('la ayuda explica el catastro y para qué sirve la capa del IGAC (2.32.0)', () => {
  const { A, sheets } = load();
  A.openMapGuide(); A.openAppGuide(); A.openUses(); A.openWhatsNew(); A.openLicenses();
  assert.match(sheets[0][1], /Para qué te sirve.*clase 7 u 8/s);
  assert.match(sheets[1][1], /Número predial y lindero catastral.*Descargar GeoJSON.*escribir solo el número/s);
  assert.doesNotMatch(sheets[1][1] + sheets[2][1] + sheets[3][1], /Traer el lindero catastral|servicio interno/, 'sin la consulta directa');
  assert.match(sheets[2][1], /La capa del IGAC en el mapa/); assert.match(sheets[2][1], /Lindero catastral.*no permiten calcular áreas oficiales/s);
  assert.match(sheets[3][1], /Número predial y lindero catastral/);
  assert.match(sheets[4][1], /Catastro.*colombiaenmapas\.gov\.co/s);
  assert.match(sheets[4][1], /no es una aplicación oficial del IGAC/); assert.match(sheets[2][1], /No es una app oficial/);
  assert.ok(atLeast(A.WHATS_NEW_ID, '2.32'), A.WHATS_NEW_ID);
});

test('la ayuda explica los nombres de los puntos y cómo vaciar el único polígono (2.32.1)', () => {
  const { A, sheets } = load();
  A.openMapGuide(); A.openWhatsNew();
  assert.match(sheets[0][1], /Nombres de los puntos.*vienen apagados.*Ver › «Nombres de los puntos»/s);
  assert.match(sheets[0][1], /Eliminar o vaciar.*«Vaciar y empezar de nuevo» lo deja como un predio nuevo/s);
  assert.match(sheets[1][1], /Nombres de los puntos.*Vaciar y empezar de nuevo/s);
  assert.ok(atLeast(A.WHATS_NEW_ID, '2.32.1'), A.WHATS_NEW_ID);
});

test('2.33.0: «Fuentes y licencias» enlaza la licencia o las condiciones de cada proveedor', () => {
  const { A, sheets } = load();
  A.openLicenses();
  const h = sheets[0][1];
  const links = [...h.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ attrs: m[1], label: m[2], href: (/href="([^"]+)"/.exec(m[1]) || [])[1] }));
  assert.ok(links.length >= 15, links.length + ' enlaces');
  for (const l of links) {
    assert.match(l.href, /^https:\/\//, l.label + ': dirección segura');
    assert.match(l.attrs, /target="_blank" rel="noopener noreferrer" data-ext="1"/, l.label + ': se abre fuera de la app, sin dar acceso a la app');
  }
  const por = (titulo) => { const r = A.LICENSES.find((x) => x[0] === titulo); assert.ok(r, titulo); return (r[2] || []).map((x) => x[1]); };
  assert.ok(por('Mapa de calles').includes('https://www.openstreetmap.org/copyright'));
  assert.ok(por('Mapa de calles').includes('https://operations.osmfoundation.org/policies/tiles/'));
  assert.ok(por('Imágenes de satélite y nombres').some((u) => /esri\.com|arcgis\.com/.test(u)));
  assert.ok(por('Mapa topográfico').includes('https://opentopomap.org/about'));
  assert.ok(por('Clima de la zona').includes('https://power.larc.nasa.gov/docs/referencing/'));
  for (const t of ['Clima de la zona', 'Clima actual']) {
    assert.ok(por(t).includes('https://open-meteo.com/'), t + ': el enlace que pide Open-Meteo');
    assert.ok(por(t).includes('https://open-meteo.com/en/licence'), t);
  }
  assert.ok(por('Mapa en pantalla').includes('https://leafletjs.com/'));
  assert.ok(por('Cultivos a evaluar').includes('https://cran.r-project.org/package=Recocrop'));
  assert.ok(por('Mapa del IGAC').includes('https://www.igac.gov.co/datos-abiertos/datos-abiertos-geoespaciales'));
  assert.ok(por('Catastro').includes('https://www.colombiaenmapas.gov.co/'));
  // la altitud por internet (Open-Meteo con el modelo de Copernicus) ahora también se cita, como piden sus condiciones
  assert.match(h, /Altitud por internet.*Copernicus DEM GLO-90.*Open-Meteo/s);
  assert.ok(por('Altitud por internet').includes('https://open-meteo.com/en/docs/elevation-api'));
  assert.match(h, /Don Florentino SIG no es una aplicación oficial/);
  // cada servicio al que la app se conecta aparece citado
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readdirSync(path.join(__dirname, '..', 'www', 'js')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'www', 'js', f), 'utf8')).join('\n');
  const citado = { 'tile.openstreetmap.org': /OpenStreetMap/, 'server.arcgisonline.com': /Esri/, 'tile.opentopomap.org': /OpenTopoMap/, 'power.larc.nasa.gov': /NASA POWER/,
    'archive-api.open-meteo.com': /Clima de la zona<\/dt><dd>[^<]*Open-Meteo/, 'api.open-meteo.com/v1/forecast': /Clima actual<\/dt><dd>Open-Meteo/,
    'api.open-meteo.com/v1/elevation': /Altitud por internet<\/dt><dd>Open-Meteo/, 'mapas2.igac.gov.co': /mapas2\.igac\.gov\.co/ };
  for (const [host, re] of Object.entries(citado)) { assert.ok(js.includes(host), 'la app usa ' + host); assert.match(h, re, host + ' está citado'); }
});

test('2.34.0: las ayudas explican el alto contraste y el registro de errores', () => {
  const { A, sheets } = load();
  assert.ok(atLeast(A.WHATS_NEW_ID, '2.34'), A.WHATS_NEW_ID);
  A.openAppGuide();
  const guia = sheets[sheets.length - 1][1];
  assert.match(guia, /Alto contraste.*Herramientas › Preferencias › «Alto contraste»: negro sobre blanco/s);
  assert.match(guia, /Registro de errores.*nunca se envía solo.*No guarda tus puntos ni coordenadas/s);
  A.openWhatsNew();
  const nuevo = sheets[sheets.length - 1][1];
  assert.ok(nuevo.indexOf('Alto contraste') < nuevo.indexOf('Nuevo nombre: Don Florentino SIG'), 'lo de la 2.34 va primero');
  assert.match(nuevo, /Registro de errores.*Se guarda solo en tu teléfono y nunca se envía solo/s);
});

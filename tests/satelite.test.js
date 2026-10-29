'use strict';
/* satelite.js: croquis satelital del informe. Las cuentas (plan), el dibujo (overlay, svg), la huella (signature)
 * y la descarga con piezas de mentira (render) se prueban aquí; la descarga real en el navegador, en tests/e2e. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Satelite = require('../www/js/satelite.js');
const Geo = require('../www/js/geo.js');

const P = (name, lat, lon, extra) => Object.assign({ id: 'id-' + name, name, lat, lon }, extra || {});
const FINCA = [P('P1', 4.6000, -74.0800), P('P2', 4.6000, -74.0770), P('P3', 4.6030, -74.0770), P('P4', 4.6030, -74.0800)];
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('plan: sin puntos no hay nada que dibujar y dice por qué', () => {
  assert.deepEqual(Satelite.plan([], []), { ok: false, reason: 'no hay puntos para dibujar' });
  assert.equal(Satelite.plan(undefined, undefined).ok, false);
});

test('plan: elige el zoom más alto en que todo cabe con margen y pide pocos mosaicos', () => {
  const pl = Satelite.plan(FINCA, []);
  assert.equal(pl.ok, true);
  assert.equal(pl.width, 768); assert.equal(pl.height, 512);
  assert.ok(pl.tiles.length >= 6 && pl.tiles.length <= 12, 'mosaicos: ' + pl.tiles.length);
  const xs = FINCA.map((p) => pl.project(p.lat, p.lon));
  for (const q of xs) {
    assert.ok(q.x >= 70 - 1e-6 && q.x <= 768 - 70 + 1e-6, 'x dentro del margen: ' + q.x);
    assert.ok(q.y >= 70 - 1e-6 && q.y <= 512 - 70 + 1e-6, 'y dentro del margen: ' + q.y);
  }
  // un nivel más de zoom ya no cabría
  const w1 = (Satelite.worldX(-74.0770, pl.z + 1) - Satelite.worldX(-74.0800, pl.z + 1));
  const h1 = (Satelite.worldY(4.6000, pl.z + 1) - Satelite.worldY(4.6030, pl.z + 1));
  assert.ok(w1 > 768 - 140 || h1 > 512 - 140, 'con un nivel más no cabe');
});

test('plan: el centro de lo dibujado queda en el centro de la imagen', () => {
  const pl = Satelite.plan(FINCA, []);
  const c = pl.project((4.6000 + 4.6030) / 2, (-74.0800 + -74.0770) / 2);
  // Mercator no es lineal en latitud, pero a esta escala la diferencia es de una fracción de píxel
  assert.ok(Math.abs(c.x - 384) < 0.5, 'x ' + c.x);
  assert.ok(Math.abs(c.y - 256) < 1.5, 'y ' + c.y);
});

test('plan: las direcciones de los mosaicos siguen el orden z/y/x de Esri y no se repiten', () => {
  const pl = Satelite.plan(FINCA, []);
  pl.tiles.forEach((t) => assert.equal(t.url, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + t.z + '/' + t.y + '/' + t.x));
  assert.equal(new Set(pl.tiles.map((t) => t.url)).size, pl.tiles.length);
  pl.tiles.forEach((t) => { assert.equal(t.z, pl.z); assert.ok(t.dx > -256 && t.dx < 768 && t.dy > -256 && t.dy < 512); });
});

test('plan: metros por píxel salen de la latitud y del zoom', () => {
  const pl = Satelite.plan(FINCA, []);
  const esperado = 156543.03392804097 * Math.cos(4.6015 * Math.PI / 180) / Math.pow(2, pl.z);
  assert.ok(Math.abs(pl.mpp - esperado) / esperado < 1e-9, pl.mpp + ' vs ' + esperado);
  // 100 m medidos sobre la imagen concuerdan con la distancia real
  const a = pl.project(4.6000, -74.0800), b = pl.project(4.6000, -74.0770);
  const real = Geo.distance(4.6000, -74.0800, 4.6000, -74.0770);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) * pl.mpp - real) / real < 0.005);
});

test('plan: todos los puntos en el mismo lugar usan el zoom máximo; una zona enorme, el mínimo', () => {
  assert.equal(Satelite.plan([P('A', 4.6, -74.1), P('B', 4.6, -74.1)], []).z, Satelite.MAX_ZOOM);
  assert.equal(Satelite.plan([P('A', 4.6, -74.1), P('B', 4.6, -74.1)], [], { maxZoom: 15 }).z, 15);
  assert.equal(Satelite.plan([P('A', -50, -170), P('B', 60, 170)], []).z, Satelite.MIN_ZOOM);
});

test('plan: solo en una dirección (puntos en línea) también calcula el zoom', () => {
  const horiz = Satelite.plan([P('A', 4.6, -74.10), P('B', 4.6, -74.09)], []);
  const vert = Satelite.plan([P('A', 4.60, -74.1), P('B', 4.61, -74.1)], []);
  assert.ok(horiz.ok && vert.ok);
  assert.ok(horiz.z >= 14 && vert.z >= 14 && horiz.z <= 18);
});

test('plan: incluye las capas visibles y deja fuera las ocultas', () => {
  const lejos = { id: 'L1', kind: 'line', color: '#8E44AD', visible: true, points: [{ lat: 4.70, lon: -74.20 }, { lat: 4.72, lon: -74.18 }] };
  const solo = Satelite.plan(FINCA, []);
  const con = Satelite.plan(FINCA, [lejos]);
  const oculta = Satelite.plan(FINCA, [Object.assign({}, lejos, { visible: false })]);
  assert.ok(con.z < solo.z, 'con la capa lejana hay que alejar el zoom');
  assert.equal(oculta.z, solo.z);
});

test('plan: no pide mosaicos más allá de los polos y da la vuelta al mundo en el meridiano 180', () => {
  const polo = Satelite.plan([P('A', 85.05, 10), P('B', 85.04, 10.001)], []);
  assert.ok(polo.tiles.length > 0);
  polo.tiles.forEach((t) => assert.ok(t.y >= 0 && t.y < Math.pow(2, t.z)));
  const borde = Satelite.plan([P('A', 0, -179.9999), P('B', 0, -179.9998)], []);
  const n = Math.pow(2, borde.z);
  assert.ok(borde.tiles.some((t) => t.x === n - 1), 'el mosaico de la izquierda es el último del otro lado del mundo');
  borde.tiles.forEach((t) => assert.ok(t.x >= 0 && t.x < n));
});

test('niceLength: la barra de escala usa una longitud redonda que cabe', () => {
  assert.equal(Satelite.niceLength(0.5), 1);
  assert.equal(Satelite.niceLength(73), 50);
  assert.equal(Satelite.niceLength(250), 250);
  assert.equal(Satelite.niceLength(9999), 5000);
  assert.equal(Satelite.niceLength(1e9), 50000);
});

/* ---------- overlay ---------- */
const PLAN = Satelite.plan(FINCA, []);
const OV = (o) => Satelite.overlay(PLAN, Object.assign({ points: FINCA, layers: [] }, o || {}));

test('overlay: polígono cerrado, lados con su distancia, puntos con nombre, norte, escala y atribución', () => {
  const s = OV({ center: { lat: 4.6015, lon: -74.0785 } });
  assert.match(s, /stroke="#FFD60A" stroke-width="3\.2"/);
  assert.match(s, / Z" fill="none" stroke="#0E2418"/);                     // el contorno oscuro de abajo también se cierra
  assert.equal((s.match(/font-size="13" font-weight="700" text-anchor="middle"/g) || []).length, 4 + 1, '4 lados y el rótulo de la escala');
  assert.match(s, />332 m</);                                              // P4 → P1: 0,003° de latitud ≈ 332 m
  ['P1', 'P2', 'P3', 'P4'].forEach((n) => assert.match(s, new RegExp('>' + n + '<')));
  assert.equal((s.match(/r="6\.5" fill="#F57C00"/g) || []).length, 4);
  assert.match(s, /<text y="32"[^>]*>N<\/text>/);
  assert.match(s, /© Esri, Maxar, Earthstar Geographics/);
  assert.match(s, /r="10" fill="none" stroke="#E53935"/);                  // anillo rojo del centro
  assert.doesNotMatch(s, /NaN|Infinity|undefined/);
});

test('overlay: la escala dice una longitud redonda y su barra mide lo que dice', () => {
  const s = OV();
  const m = /<line x1="0" y1="0" x2="([\d.]+)" y2="0" stroke="#0E2418"[^>]*\/>[\s\S]*?>(\d+) m</.exec(s);
  assert.ok(m, 'hay barra de escala');
  const px = Number(m[1]), metros = Number(m[2]);
  assert.ok(Math.abs(px * PLAN.mpp - metros) < metros * 0.01 + 0.2);
  assert.ok([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].includes(metros));
});

test('overlay: con 2 puntos es una línea abierta con un solo lado; con 1 no hay línea ni lados ni centro', () => {
  const dos = Satelite.overlay(PLAN, { points: FINCA.slice(0, 2), center: { lat: 4.6, lon: -74.079 } });
  assert.doesNotMatch(dos, /\d Z" fill="none" stroke="#0E2418"/, 'no se cierra');
  assert.match(dos, /fill="none" fill-opacity="0\.13"/);
  assert.equal((dos.match(/font-size="13" font-weight="700" text-anchor="middle"/g) || []).length, 1 + 1);
  assert.match(dos, /r="10" fill="none" stroke="#E53935"/);
  const uno = Satelite.overlay(PLAN, { points: FINCA.slice(0, 1), center: { lat: 4.6, lon: -74.08 } });
  assert.doesNotMatch(uno, /stroke="#FFD60A"|#E53935/);
  assert.match(uno, />P1</);
});

test('overlay: lados que se cruzan se pintan en rojo claro', () => {
  const s = OV({ bad: true });
  assert.match(s, /stroke="#FF5A5A" stroke-width="3\.2"/);
  assert.doesNotMatch(s, /stroke="#FFD60A"/);
});

test('overlay: con muchos puntos se quitan los lados escritos (más de 12) y los nombres (más de 40)', () => {
  const muchos = (n) => Array.from({ length: n }, (_, i) => P('Q' + (i + 1), 4.6 + (i % 7) * 0.0001, -74.08 + i * 0.00005));
  const trece = Satelite.overlay(PLAN, { points: muchos(13) });
  assert.equal((trece.match(/font-size="13" font-weight="700"/g) || []).length, 1, 'solo el rótulo de la escala');
  assert.match(trece, />Q13</);
  const cuarentayuno = Satelite.overlay(PLAN, { points: muchos(41) });
  assert.doesNotMatch(cuarentayuno, />Q1</);
  assert.equal((cuarentayuno.match(/r="6\.5" fill="#F57C00"/g) || []).length, 41);
});

test('overlay: puntos sin nombre se llaman P1, P2… y los nombres se escriben como texto', () => {
  const s = Satelite.overlay(PLAN, { points: [{ lat: 4.6, lon: -74.08 }, P('<img src=x onerror=alert(1)>', 4.601, -74.079), { lat: 4.6015, lon: -74.0785, name: '' }] });
  assert.match(s, />P1</); assert.match(s, />P3</);
  assert.match(s, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(s, /<img/);
});

test('overlay: ignora puntos con coordenadas rotas', () => {
  const s = Satelite.overlay(PLAN, { points: FINCA.concat([{ name: 'X', lat: NaN, lon: 1 }, { name: 'Y', lat: 95, lon: 0 }, null]) });
  assert.doesNotMatch(s, />X<|>Y<|NaN/);
  assert.equal((s.match(/r="6\.5" fill="#F57C00"/g) || []).length, 4);
});

test('overlay: capas importadas con su color — polígono con hueco, línea punteada y puntos', () => {
  const capas = [
    { id: 'a', kind: 'polygon', color: '#8E44AD', visible: true, points: [{ lat: 4.6, lon: -74.081 }, { lat: 4.601, lon: -74.081 }, { lat: 4.601, lon: -74.080 }],
      holes: [[{ lat: 4.6004, lon: -74.0808 }, { lat: 4.6006, lon: -74.0808 }, { lat: 4.6006, lon: -74.0806 }], [{ lat: 4.6, lon: -74.08 }]] },
    { id: 'b', kind: 'line', color: '#16A085', visible: true, points: [{ lat: 4.6, lon: -74.079 }, { lat: 4.602, lon: -74.078 }] },
    { id: 'c', kind: 'polygon', color: '#D35400', visible: true, points: [{ lat: 4.6, lon: -74.079 }, { lat: 4.602, lon: -74.078 }] },     // «polígono» con 2 vértices: se dibuja como línea
    { id: 'd', kind: 'points', color: 'rojo', visible: true, points: [{ lat: 4.6012, lon: -74.0795 }, { lat: 4.6014, lon: -74.0793 }] },
    { id: 'e', kind: 'line', color: '#111111', visible: false, points: [{ lat: 4.6, lon: -74.079 }, { lat: 4.602, lon: -74.078 }] }
  ];
  const s = Satelite.overlay(PLAN, { points: [], layers: capas });
  assert.match(s, /fill-rule="evenodd" fill="#8E44AD" fill-opacity="0\.22"/);
  assert.equal((s.match(/ Z M/g) || []).length >= 1, true, 'el hueco de 3 vértices se agrega al mismo trazado');
  assert.match(s, /stroke="#16A085" stroke-width="2\.6" stroke-dasharray="7 5"/);
  assert.match(s, /stroke="#D35400" stroke-width="2\.6" stroke-dasharray="7 5"/);
  assert.equal((s.match(/r="5\.5" fill="#2980B9"/g) || []).length, 2, 'color inválido → azul de las capas');
  assert.doesNotMatch(s, /#111111/);
});

/* ---------- svg y huella ---------- */
test('svg: la imagen JPEG y lo dibujado encima, con descripción para lectores de pantalla', () => {
  const s = Satelite.svg(PLAN, JPEG, { points: FINCA });
  assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 768 512" width="100%" role="img" aria-label="Croquis satelital/);
  assert.ok(s.includes('<image href="' + JPEG + '" x="0" y="0" width="768" height="512"/>'));
  assert.ok(s.indexOf('<image') < s.indexOf('stroke="#FFD60A"'), 'la imagen va debajo');
  assert.ok(s.endsWith('</svg>'));
});

test('svg: no dibuja nada si no hay plan o si lo recibido no es una imagen JPEG en base 64', () => {
  assert.equal(Satelite.svg(null, JPEG, {}), '');
  assert.equal(Satelite.svg({ ok: false }, JPEG, {}), '');
  for (const mala of ['', undefined, null, 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA"><script>alert(1)</script>', 'http://x/y.jpg', 'data:image/jpeg;base64,AA AA', 5]) {
    assert.equal(Satelite.svg(PLAN, mala, { points: FINCA }), '', String(mala));
  }
});

test('signature: cambia cuando cambian los puntos, sus nombres o las capas visibles; no, cuando nada de eso cambia', () => {
  const base = { id: 'p1', points: FINCA.map((p) => Object.assign({}, p)), layers: [] };
  const sig = Satelite.signature(base);
  assert.equal(Satelite.signature(JSON.parse(JSON.stringify(base))), sig);
  const movido = JSON.parse(JSON.stringify(base)); movido.points[0].lat += 1e-6;
  assert.notEqual(Satelite.signature(movido), sig);
  const renombrado = JSON.parse(JSON.stringify(base)); renombrado.points[2].name = 'Mojón';
  assert.notEqual(Satelite.signature(renombrado), sig);
  const otro = JSON.parse(JSON.stringify(base)); otro.id = 'p2';
  assert.notEqual(Satelite.signature(otro), sig);
  const sinUno = JSON.parse(JSON.stringify(base)); sinUno.points.pop();
  assert.notEqual(Satelite.signature(sinUno), sig);
  // altitud y otros datos no afectan lo que se dibuja
  const conAlt = JSON.parse(JSON.stringify(base)); conAlt.points[0].alt = 2600; conAlt.points[0].acc = 4;
  assert.equal(Satelite.signature(conAlt), sig);
  // capas: una visible la cambia; una oculta, no; ocultarla otra vez la devuelve
  const capa = { id: 'L', kind: 'line', color: '#16A085', visible: true, points: [{ lat: 4.6, lon: -74.1 }, { lat: 4.61, lon: -74.1 }] };
  const conCapa = JSON.parse(JSON.stringify(base)); conCapa.layers = [JSON.parse(JSON.stringify(capa))];
  assert.notEqual(Satelite.signature(conCapa), sig);
  conCapa.layers[0].visible = false;
  assert.equal(Satelite.signature(conCapa), sig);
  const pintada = JSON.parse(JSON.stringify(base)); pintada.layers = [Object.assign({}, capa, { color: '#000000' })];
  assert.notEqual(Satelite.signature(pintada), Satelite.signature(Object.assign({}, pintada, { layers: [capa] })));
  // sin proyecto o sin listas, no se rompe
  assert.equal(typeof Satelite.signature(undefined), 'string');
  assert.equal(typeof Satelite.signature({}), 'string');
});

/* ---------- render (con piezas de mentira) ---------- */
function falsoLienzo() {
  const calls = { fills: [], draws: [] };
  const ctx = { fillStyle: '', fillRect(...a) { calls.fills.push([this.fillStyle, ...a]); }, drawImage(...a) { calls.draws.push(a); } };
  const canvas = { width: 0, height: 0, getContext(t) { assert.equal(t, '2d'); return ctx; }, toDataURL(tipo, calidad) { calls.tipo = tipo; calls.calidad = calidad; return JPEG; } };
  return { calls, canvas, make(w, h) { canvas.width = w; canvas.height = h; return canvas; } };
}

test('render: baja todos los mosaicos, los coloca donde van y devuelve un JPEG en base 64', async () => {
  const L = falsoLienzo(), pedidos = [];
  const uri = await Satelite.render(PLAN, { makeCanvas: L.make, loadTile: (u) => { pedidos.push(u); return Promise.resolve({ u }); } });
  assert.equal(uri, JPEG);
  assert.equal(L.canvas.width, 768); assert.equal(L.canvas.height, 512);
  assert.deepEqual(L.calls.fills[0], ['#C8D4C0', 0, 0, 768, 512], 'fondo mientras llegan los mosaicos');
  assert.deepEqual(pedidos.sort(), PLAN.tiles.map((t) => t.url).sort());
  assert.equal(L.calls.draws.length, PLAN.tiles.length);
  PLAN.tiles.forEach((t) => assert.ok(L.calls.draws.some((d) => d[0].u === t.url && d[1] === Math.round(t.dx) && d[2] === Math.round(t.dy) && d[3] === 256 && d[4] === 256)));
  assert.equal(L.calls.tipo, 'image/jpeg');
  assert.equal(L.calls.calidad, 0.82);
});

test('render: si ningún mosaico llega, explica que revise la conexión o que el servicio no deje guardarlas', async () => {
  const L = falsoLienzo();
  await assert.rejects(Satelite.render(PLAN, { makeCanvas: L.make, loadTile: () => Promise.reject(new Error('x')) }),
    (e) => e instanceof Error && /no se pudieron descargar las imágenes: revisa la conexión a internet/.test(e.message) && /no permitir guardarlas/.test(e.message));
  assert.equal(L.calls.draws.length, 0);
});

test('render: si faltan algunos mosaicos no entrega una imagen con huecos y dice cuántos', async () => {
  const L = falsoLienzo(); let i = 0;
  await assert.rejects(Satelite.render(PLAN, { makeCanvas: L.make, loadTile: () => (i++ === 1 ? Promise.reject(new Error('x')) : Promise.resolve({})) }),
    (e) => new RegExp('no se pudieron descargar 1 de ' + PLAN.tiles.length + ' imágenes').test(e.message));
});

test('render: si el servicio no deja leer los píxeles (lienzo «contaminado») lo dice sin dejar caer la app', async () => {
  const L = falsoLienzo();
  L.canvas.toDataURL = () => { throw new Error('SecurityError'); };
  await assert.rejects(Satelite.render(PLAN, { makeCanvas: L.make, loadTile: () => Promise.resolve({}) }),
    (e) => /el servicio de imágenes no permite guardarlas dentro del informe/.test(e.message));
});

test('render: si tarda demasiado se rinde, y lo que llegue después no hace nada', async () => {
  const L = falsoLienzo(), tardias = [];
  await assert.rejects(Satelite.render(PLAN, { makeCanvas: L.make, timeoutMs: 20, loadTile: () => new Promise((res) => tardias.push(res)) }),
    (e) => /tardó demasiado en descargar las imágenes/.test(e.message));
  tardias.forEach((res) => res({}));                                   // llegan tarde
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(L.calls.tipo, undefined, 'no se guardó ninguna imagen');
});

test('render: el límite de tiempo no corta una descarga que termina a tiempo', async () => {
  const L = falsoLienzo();
  const uri = await Satelite.render(PLAN, { makeCanvas: L.make, timeoutMs: 2000, loadTile: () => new Promise((res) => setTimeout(() => res({}), 5)) });
  assert.equal(uri, JPEG);
});

test('el pie del informe nombra a Esri, sus fuentes y el uso personal o interno', () => {
  assert.match(Satelite.CAPTION, /Esri/);
  assert.ok(Satelite.CAPTION.includes(Satelite.ATTRIBUTION));
  assert.match(Satelite.CAPTION, /uso personal o interno/);
  assert.match(Satelite.CAPTION, /norte y escala/);
});

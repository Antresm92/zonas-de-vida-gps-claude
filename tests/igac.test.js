'use strict';
/* El mapa de capacidad de uso del IGAC (2.31.0). Las respuestas de prueba copian la forma real del servicio
   (consultado el 18 nov 2026 en los puntos indicados). */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../www/js/igac.js');

const META = { Clase: '6', Subclase: 's', UCP: '6s-2', Limitantes: 'Saturación de aluminio (>90%), profundidad efectiva muy superficial y texturas finas',
  URecomendados: 'Cultivos transitorios, semipermanentes y permanentes adaptados a la alta saturación de aluminio', PManejo: 'Variedades resistentes a los altos contenidos de aluminio',
  Estudio: 'Estudio semidetallado de suelos', Escala: '1:25.000', 'Año': '2017', Clase_Multiescalar: '6' };   // (4,20; −72,50), Meta

test('la clase: números, romanos y códigos que no son clase', () => {
  assert.equal(I.claseNum('6'), 6); assert.equal(I.claseNum('VI'), 6); assert.equal(I.claseNum('IV'), 4); assert.equal(I.claseNum('VIII'), 8);
  assert.equal(I.claseNum('IVpc'), 4); assert.equal(I.claseNum('III'), 3); assert.equal(I.claseNum('V'), 5);
  for (const v of ['CA', 'ZU', 'MC', 'Sin estudio', '9', '', null, undefined, 'IX', 'Antrópico']) assert.equal(I.claseNum(v), null, String(v));
});

test('fromAttributes: clase multiescalar primero, subclase con letras y textos limpios', () => {
  const a = I.fromAttributes(META);
  assert.deepEqual([a.clase, a.codigo, a.ucp, a.escala, a.anio], [6, '6s', '6s-2', '1:25.000', '2017']);
  assert.match(a.limitantes, /^Saturación de aluminio/); assert.equal(a.especial, undefined);
  // Nariño 1:100.000 (estudio antiguo, en romanos): IV + 'ts' → 4ts
  const n = I.fromAttributes({ Clase: 'IV', Subclase: 'ts', UCP: 'IVts5', Clase_Multiescalar: '4', Escala: '1:100.000' });
  assert.equal(n.clase, 4); assert.equal(n.codigo, '4ts');
  // sin clase multiescalar (Sabana de Bogotá 1:10.000)
  assert.equal(I.fromAttributes({ Clase: '3', Subclase: 's', Clase_Multiescalar: null }).codigo, '3s');
  const zu = I.fromAttributes({ Clase: 'ZU', Subclase: 'ZU', UCP: 'ZU', Clase_Multiescalar: 'ZU', Limitantes: 'Zona urbana' });
  assert.equal(zu.clase, null); assert.equal(zu.codigo, 'ZU'); assert.equal(zu.especial, 'Zona urbana');
  assert.equal(I.fromAttributes({ Clase: 'HAC' }).especial, 'Sin clase agrológica (HAC)');
  assert.equal(I.fromAttributes(null), null);
  const largo = I.fromAttributes(Object.assign({}, META, { PManejo: 'x '.repeat(600) + '\u0007' }));
  assert.ok(largo.practicas.length <= 700 && largo.practicas.endsWith('…'));
});

test('parse: la respuesta del servicio, vacía o con error', () => {
  const r = I.parse({ features: [{ attributes: META }] });
  assert.equal(r.ok, true); assert.equal(r.data.codigo, '6s');
  assert.deepEqual(I.parse({ features: [] }), { ok: true, data: null });
  assert.equal(I.parse({ error: { code: 500, message: 'Error performing query operation' } }).ok, false);
  assert.equal(I.parse(null).ok, false);
  // si se cruzan dos estudios, gana el más detallado
  const dos = I.parse({ features: [{ attributes: { Clase: '7', Subclase: 'p', Escala: '1:100.000' } }, { attributes: { Clase: '4', Subclase: 'p', Escala: '1:10.000' } }] });
  assert.equal(dos.data.codigo, '4p');
  assert.deepEqual(I.letras('6pes'), ['pendiente', 'erosión', 'suelo']); assert.deepEqual(I.letras('ZU'), []); assert.deepEqual(I.letras('6t'), ['t']);
});

test('direcciones: consulta en un punto, en la zona del predio y baldosa del mapa', () => {
  const u = I.pointUrl(4.2, -72.5);
  assert.ok(u.startsWith('https://mapas2.igac.gov.co/server/rest/services/agrologia/capacidaddeusodelastierrasmultiescalar/MapServer/0/query?'));
  assert.match(u, /geometry=-72\.500000%2C4\.200000&geometryType=esriGeometryPoint&inSR=4326/); assert.match(u, /returnGeometry=false&f=json$/);
  assert.match(u, /outFields=Clase%2CSubclase%2CUCP%2CLimitantes%2CURecomendados%2CPManejo%2CEstudio%2CEscala%2CA%C3%B1o%2CClase_Multiescalar/);
  const b = I.bboxOf([{ lat: 4.2, lon: -72.5 }, { lat: 4.21, lon: -72.49 }, { lat: null, lon: 3 }]);
  assert.deepEqual(b, { s: 4.197, w: -72.503, n: 4.213, e: -72.487, big: false });
  assert.match(I.bboxUrl(b), /geometry=-72\.503%2C4\.197%2C-72\.487%2C4\.213&geometryType=esriGeometryEnvelope.*maxAllowableOffset=0\.0002&f=geojson$/);
  assert.equal(I.bboxOf([{ lat: 4, lon: -74 }, { lat: 4.5, lon: -74 }]).big, true);
  assert.equal(I.bboxOf([]), null);
  assert.deepEqual(I.tileBbox(0, 0, 0).map(Math.round), [-20037508, -20037508, 20037508, 20037508]);
  const t = I.tileUrl(1223, 2000, 12), bb = I.tileBbox(1223, 2000, 12);
  assert.ok(t.includes('/MapServer/export?bbox=' + bb.map((v) => v.toFixed(2)).join('%2C') + '&'));
  // esa baldosa contiene el punto (4,2; −72,5) en metros Web Mercator
  const mx = -72.5 * Math.PI / 180 * 6378137, my = Math.log(Math.tan(Math.PI / 4 + 4.2 * Math.PI / 360)) * 6378137;
  assert.ok(bb[0] <= mx && mx <= bb[2] && bb[1] <= my && my <= bb[3], 'la baldosa cubre el punto'); assert.match(t, /bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&layers=show%3A0&f=image$/);
});

const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const GJ = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQ(-72.51, 4.19, -72.49, 4.21), SQ(-72.501, 4.199, -72.499, 4.201)] }, properties: META },
  { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[SQ(-72.501, 4.199, -72.499, 4.201)]] }, properties: { Clase: 'CA', Clase_Multiescalar: 'CA', Escala: '1:25.000' } },
  { type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQ(-72.6, 4.0, -72.4, 4.4)] }, properties: { Clase: 'VII', Subclase: 'p', Clase_Multiescalar: '7', Escala: '1:100.000' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: META },
  { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 'x']]] }, properties: META }
] };

test('slim y classAt: lo descargado sirve para consultar sin conexión (con huecos y estudios superpuestos)', () => {
  const s = I.slim(GJ);
  assert.equal(s.features.length, 3); assert.equal(s.parcial, false);
  assert.equal(I.classAt(s, 4.205, -72.495).codigo, '6s', 'gana el estudio 1:25.000 sobre el 1:100.000');
  assert.equal(I.classAt(s, 4.2, -72.5).codigo, 'CA', 'en el hueco está el cuerpo de agua');
  assert.equal(I.classAt(s, 4.3, -72.45).codigo, '7p');
  assert.equal(I.classAt(s, 5, -70), null); assert.equal(I.classAt(null, 4.2, -72.5), null);
  assert.equal(I.slim({ features: [], exceededTransferLimit: true }).parcial, true);
  assert.equal(I.slim({}), null);
  assert.deepEqual(I.legend(s).map((x) => x.label), ['Clase 6', 'Clase 7', 'Cuerpo de agua']);
  assert.equal(I.colorOf(s.features[0].a), '#ffab00'); assert.equal(I.colorOf({ clase: null, codigo: 'ZU' }), '#ffbebe'); assert.equal(I.colorOf({ clase: null, codigo: 'XX' }), '#b2b2b2');
});

test('clean: lo que se guarda en el polígono y lo que llega de una copia', () => {
  const a = Object.assign(I.fromAttributes(META), { lat: 4.2, lon: -72.5, at: 1763400000000, src: 'guardado' });
  assert.deepEqual(I.clean(a), a);
  assert.deepEqual(I.clean({ clase: 6.5, codigo: 'x', lat: 200, at: -1, src: 'otro', __proto__x: 1 }), { clase: null, codigo: 'x', especial: 'Sin dato' });
  assert.equal(I.clean({ clase: 6 }), null); assert.equal(I.clean([]), null); assert.equal(I.clean('6s'), null);
  assert.equal(I.clean({ clase: 6, codigo: '6s', especial: 'nada' }).especial, undefined);
  assert.equal(I.clean({ clase: 6, codigo: '6s', limitantes: 'a'.repeat(5000) }).limitantes.length, 700);
});

test('compara: la clase del mapa del IGAC frente a la de la app', () => {
  assert.equal(I.compara({ clase: 6 }, 6).igual, true);
  assert.match(I.compara({ clase: 6 }, 7).txt, /^Tu evaluación da clase 7 \(más restrictiva\)\. El mapa del IGAC es regional/);
  assert.match(I.compara({ clase: 6 }, 3).txt, /menos restrictiva/);
  assert.equal(I.compara({ clase: null }, 3), null); assert.equal(I.compara({ clase: 6 }, null), null);
  assert.match(I.FUENTE.cita, /CC BY 4\.0 \(Resolución 616 de 2020\)/);
});

test('lo consultado queda guardado en el polígono y viaja en la copia de seguridad (limpio)', () => {
  const Store = require('../www/js/store.js'), Backup = require('../www/js/backup.js');
  const ig = Object.assign(I.fromAttributes(META), { lat: 4.2, lon: -72.5, at: 1763400000000 });
  const p = { id: 'p1', name: 'F', lots: [{ id: 'l1', name: 'Potrero', points: [], climate: {}, igac: Object.assign({ raro: '<script>' }, ig) }, { id: 'l2', name: 'B', points: [], climate: {}, igac: { clase: 3 } }] };
  Store.toLots(p);
  assert.deepEqual(p.lots[0].igac, ig); assert.equal(p.lots[1].igac, undefined);
  let k = 0;
  const st = { v: 1, currentId: 'p1', settings: {}, projects: [p] };
  const v = Backup.validate(JSON.parse(Backup.stringify(Backup.create(st, []))), { uid: () => 'u' + (++k) });
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.data.projects[0].lots[0].igac, ig); assert.equal(v.data.projects[0].lots[1].igac, undefined);
});

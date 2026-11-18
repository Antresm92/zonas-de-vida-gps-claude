'use strict';
/* Número predial y lindero catastral (2.32.0). La respuesta de prueba copia la forma real del servicio de Colombia en Mapas
   (consultado el 18 nov 2026), con un número, un lindero y unos valores inventados; trae dirección y avalúo para comprobar
   que se descartan. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/catastro.js');
const Gis = require('../www/js/gis.js');

const NUM = '505730002000000080046000000000';
const SQ = [[-72.501, 4.199], [-72.499, 4.199], [-72.499, 4.201], [-72.501, 4.201], [-72.501, 4.199]];
const RESP = { status: true, response: {
  unidad: { TIPO: 'MUNI', CODIGO: '50573', NOMBRE_COMPLETO: 'Puerto López, Meta', NOMBRE: 'Puerto López', SHAPE: '{}' },
  predio: { numPredial: NUM, numPredialAnterior: '', areaTerreno: 49283.5, areaConstruccion: 120, avaluo: 123456789, direccion: 'FINCA DE PRUEBA', codDestino: 'L', construcciones: [{}] },
  terreno: { geometryType: 'esriGeometryPolygon', spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: 1, CODIGO: NUM, CODIGO_ANTERIOR: '50573000200080046000', Shape__Area: 49200.1 }, geometry: { rings: [SQ, [[-72.6, 4.1], [-72.59, 4.1], [-72.59, 4.11], [-72.6, 4.1]]] } }] } } };

test('número predial: 30 dígitos (o 20 el anterior), con o sin espacios; se lee en grupos', () => {
  assert.equal(C.numero(NUM), NUM); assert.equal(C.numero('50 573 00 02 0000 0008 0046 000000000'), NUM);
  assert.equal(C.numero('50573000200080046000'), '50573000200080046000');
  for (const v of ['123', NUM + '1', 'abc', '', null, undefined, 5.5]) assert.equal(C.numero(v), '', String(v));
  assert.equal(C.legible(NUM), '50 573 00 02 0000 0008 0046 000000000');
});

test('parse: lindero, número, municipio y área; nunca la dirección ni el avalúo', () => {
  const r = C.parse(RESP);
  assert.equal(r.ok, true);
  const d = r.data;
  assert.deepEqual(Object.keys(d).sort(), ['anterior', 'areaM2', 'areaMapaM2', 'municipio', 'numero', 'rings']);
  assert.equal(d.numero, NUM); assert.equal(d.anterior, '50573000200080046000'); assert.equal(d.municipio, 'Puerto López, Meta'); assert.equal(d.areaM2, 49283.5);
  assert.equal(d.rings.length, 2); assert.equal(d.rings[0].length, 4, 'sin repetir el primer vértice al final');
  assert.deepEqual(d.rings[0][0], { lat: 4.199, lon: -72.501 });
  assert.equal(C.mainRing(d).length, 4);
  assert.ok(!JSON.stringify(d).includes('FINCA') && !JSON.stringify(d).includes('123456789'));
  assert.deepEqual(C.parse({ status: true, response: { unidad: {} } }), { ok: true, data: null });
  assert.equal(C.parse({ status: false, message: 'Error' }).ok, false);
  assert.deepEqual(C.parse({ status: false, message: 'No se encontro información asociada.' }), { ok: true, data: null }, 'así responde donde no hay datos');
  assert.equal(C.parse(null).ok, false);
});

test('el cuerpo de las consultas', () => {
  assert.equal(C.bodyXY(4.2, -72.5), 'cmd=query_xy&x=-72.5000000&y=4.2000000&token=');
  assert.equal(C.bodyNumero(NUM), 'cmd=query_codigo&query=' + NUM + '&token=');
  assert.equal(C.SERVICE, 'https://servicioscem.igac.gov.co/Geovisor/catastral');
});

test('clean y compara', () => {
  const g = { numero: NUM, anterior: '50573000200080046000', municipio: 'Puerto López, Meta', areaM2: 49283.5, fuente: 'consulta', at: 1763500000000 };
  assert.deepEqual(C.clean(Object.assign({ direccion: 'x', avaluo: 1 }, g)), g);
  assert.equal(C.clean({ numero: '12' }), null); assert.equal(C.clean([]), null);
  assert.deepEqual(C.clean({ numero: NUM, fuente: 'otra', areaM2: -3, municipio: '<b>x</b>' }), { numero: NUM, municipio: 'b x /b' });
  assert.equal(C.compara(10000, 10500).txt, 'La medida es 5,0 % mayor que el área catastral.');
  assert.equal(C.compara(10000, 9000).txt, 'La medida es 10,0 % menor que el área catastral.');
  assert.equal(C.compara(10000, 10000).txt, 'Igual al área catastral.');
  assert.equal(C.compara(null, 10), null);
});

test('camino A: el GeoJSON que descarga Colombia en Mapas entra con su número predial (y sin dirección)', () => {
  // la misma forma que arma Colombia en Mapas al pulsar «Descargar GeoJSON»
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'Numero predial': NUM, 'Numero predial anterior': '50573000200080046000', Municipio: 'Puerto López, Meta', Direccion: 'FINCA DE PRUEBA' },
    geometry: { type: 'Polygon', coordinates: [SQ] } }] };
  const r = Gis.parseText(JSON.stringify(fc), NUM + '.json');
  assert.equal(r.features.length, 1); assert.equal(r.features[0].name, NUM);
  assert.deepEqual(r.features[0].predial, { numero: NUM, anterior: '50573000200080046000', municipio: 'Puerto López, Meta' });
  const L = Gis.toLayers(r.features, { file: NUM + '.json' });
  assert.equal(L[0].name, NUM); assert.equal(L[0].predial.numero, NUM);
  assert.ok(!JSON.stringify(L).includes('FINCA'));
  // un GeoJSON cualquiera no trae número predial
  const otro = Gis.parseText(JSON.stringify({ type: 'Feature', properties: { name: 'Lote' }, geometry: { type: 'Polygon', coordinates: [SQ] } }), 'x.json');
  assert.equal(otro.features[0].predial, undefined);
});

test('lo guardado en el polígono pasa por la copia de seguridad', () => {
  const Store = require('../www/js/store.js'), Backup = require('../www/js/backup.js');
  const pr = { numero: NUM, municipio: 'Puerto López, Meta', areaM2: 49283.5, fuente: 'archivo', at: 1763500000000 };
  const p = { id: 'p1', name: 'F', lots: [{ id: 'l1', name: 'Predio', points: [], climate: {}, predial: Object.assign({ avaluo: 9 }, pr) }, { id: 'l2', name: 'B', points: [], climate: {}, predial: { numero: '1' } }] };
  Store.toLots(p);
  assert.deepEqual(p.lots[0].predial, pr); assert.equal(p.lots[1].predial, undefined);
  let k = 0;
  const v = Backup.validate(JSON.parse(Backup.stringify(Backup.create({ v: 1, currentId: 'p1', settings: {}, projects: [p] }, []))), { uid: () => 'u' + (++k) });
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.projects[0].lots[0].predial, pr);
});

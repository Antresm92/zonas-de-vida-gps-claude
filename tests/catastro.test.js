'use strict';
/* Número predial (2.32.0): el GeoJSON descargado de Colombia en Mapas y el número escrito a mano. El número y el lindero
   de prueba son inventados; el archivo trae una dirección para comprobar que se descarta. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/catastro.js');
const Gis = require('../www/js/gis.js');

const NUM = '505730002000000080046000000000';
const SQ = [[-72.501, 4.199], [-72.499, 4.199], [-72.499, 4.201], [-72.501, 4.201], [-72.501, 4.199]];
test('número predial: 30 dígitos (o 20 el anterior), con o sin espacios; se lee en grupos', () => {
  assert.equal(C.numero(NUM), NUM); assert.equal(C.numero('50 573 00 02 0000 0008 0046 000000000'), NUM);
  assert.equal(C.numero('50573000200080046000'), '50573000200080046000');
  for (const v of ['123', NUM + '1', 'abc', '', null, undefined, 5.5]) assert.equal(C.numero(v), '', String(v));
  assert.equal(C.legible(NUM), '50 573 00 02 0000 0008 0046 000000000');
});

test('clean: solo número, anterior, municipio, fuente y fecha', () => {
  const g = { numero: NUM, anterior: '50573000200080046000', municipio: 'Puerto López, Meta', fuente: 'archivo', at: 1763500000000 };
  assert.deepEqual(C.clean(Object.assign({ direccion: 'x', avaluo: 1, areaM2: 5 }, g)), g);
  assert.equal(C.clean({ numero: '12' }), null); assert.equal(C.clean([]), null);
  assert.deepEqual(C.clean({ numero: NUM, fuente: 'consulta', municipio: '<b>x</b>' }), { numero: NUM, municipio: 'b x /b' }, 'la app ya no consulta el catastro');
  assert.deepEqual(Object.keys(C).sort(), ['AVISO', 'PORTAL', 'clean', 'fromProps', 'legible', 'numero'], 'sin consulta directa al catastro');
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
  const pr = { numero: NUM, municipio: 'Puerto López, Meta', fuente: 'archivo', at: 1763500000000 };
  const p = { id: 'p1', name: 'F', lots: [{ id: 'l1', name: 'Predio', points: [], climate: {}, predial: Object.assign({ avaluo: 9 }, pr) }, { id: 'l2', name: 'B', points: [], climate: {}, predial: { numero: '1' } }] };
  Store.toLots(p);
  assert.deepEqual(p.lots[0].predial, pr); assert.equal(p.lots[1].predial, undefined);
  let k = 0;
  const v = Backup.validate(JSON.parse(Backup.stringify(Backup.create({ v: 1, currentId: 'p1', settings: {}, projects: [p] }, []))), { uid: () => 'u' + (++k) });
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.projects[0].lots[0].predial, pr);
});

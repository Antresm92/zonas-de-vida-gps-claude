'use strict';
/* Archivos y respuestas de internet de ejemplo para el recorrido en Chromium. Todo es inventado. */
const zlib = require('zlib');
const { makeZip } = require('../helpers/zipbuild.js');

// Finca de 28 vértices parecida a un lote catastral (≈ 21 ha) cerca de 4.93, -74.46
function fincaRing(n) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * 2 * Math.PI, r = 1 + 0.12 * Math.sin(3 * a) + 0.05 * Math.cos(5 * a);
    ring.push({ lat: 4.9302 + 0.0023 * r * Math.sin(a) * 0.62, lon: -74.4577 + 0.0023 * r * Math.cos(a) });
  }
  return ring;
}
const FINCA = fincaRing(28);
function kmlPolygon(name, ring, withAlt) {
  const c = ring.concat([ring[0]]).map((p) => p.lon.toFixed(7) + ',' + p.lat.toFixed(7) + ',' + (withAlt ? withAlt : 0)).join(' ');
  return '<Placemark><name>' + name + '</name><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>' + c + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
}
const kml = (inner) => '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>demo</name>' + inner + '</Document></kml>';
const fincaKml = () => kml(kmlPolygon('Finca Ejemplo', FINCA));
const fincaKmz = () => Buffer.from(makeZip([{ name: 'doc.kml', data: fincaKml() }]));
const vecinoKml = () => kml(kmlPolygon('Lote vecino', FINCA.map((p) => ({ lat: p.lat + 0.0035, lon: p.lon + 0.0004 }))) +
  '<Placemark><name>Pozo</name><Point><coordinates>-74.4570,4.9330,1800</coordinates></Point></Placemark>');
const geojson = () => JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'Potrero' }, geometry: { type: 'Polygon', coordinates: [[[-74.46, 4.93], [-74.458, 4.93], [-74.458, 4.932], [-74.46, 4.932], [-74.46, 4.93]]] } },
  { type: 'Feature', properties: { name: 'Quebrada' }, geometry: { type: 'LineString', coordinates: [[-74.461, 4.929], [-74.459, 4.931], [-74.457, 4.9315]] } },
  { type: 'Feature', properties: { name: 'Toma' }, geometry: { type: 'Point', coordinates: [-74.4595, 4.9305] } }
] });
const gpx = () => '<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Recorrido</name><trkseg>' +
  [[4.9300, -74.4600], [4.9300, -74.4580], [4.9320, -74.4580], [4.9320, -74.4600], [4.9300, -74.4600]].map((p) => '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"><ele>1850</ele></trkpt>').join('') + '</trkseg></trk></gpx>';

// NASA POWER: formato clásico (properties.parameter) y el nuevo (normals)
const T = [13.1, 13.4, 13.8, 14.0, 14.0, 13.6, 13.2, 13.3, 13.6, 13.7, 13.7, 13.3];
const PD = [1.2, 1.8, 2.7, 4.0, 3.6, 2.1, 1.6, 1.6, 2.1, 3.9, 3.9, 2.0];       // mm/día
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function powerClassic(lat, lon) {
  const t = {}, p = {};
  MON.forEach((m, i) => { t[m] = T[i]; p[m] = PD[i]; });
  t.ANN = 13.55; p.ANN = 2.5;
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat, 2600] }, properties: { parameter: { T2M: t, PRECTOTCORR: p } } };
}
function powerNormals(lat, lon) {
  const mk = (parameter, units, v, ann) => ({ parameter, units, longname: parameter, annual: ann, months: v.map((x, i) => ({ month: i + 1, value: x })) });
  return { geometry: { type: 'Point', coordinates: [lon, lat, 2600] }, normals: [mk('T2M', 'C', T, 13.55), mk('PRECTOTCORR', 'mm/day', PD, 2.5)] };
}
// Open-Meteo archivo: 10 años de datos diarios
function openMeteoArchive() {
  const time = [], tm = [], pr = [];
  for (let y = 2016; y <= 2025; y++) for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d = new Date(d.getTime() + 864e5)) {
    const m = d.getUTCMonth();
    time.push(d.toISOString().slice(0, 10)); tm.push(T[m] + 0.2); pr.push(PD[m] * (d.getUTCDate() % 3 === 0 ? 1.5 : 0.75));
  }
  return { elevation: 2610, daily: { time, temperature_2m_mean: tm, precipitation_sum: pr } };
}
module.exports = { FINCA, fincaKml, fincaKmz, vecinoKml, geojson, gpx, powerClassic, powerNormals, openMeteoArchive, T, PD, zlib };

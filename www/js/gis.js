/* gis.js — intercambio de datos de terreno con otros programas (SIG): KML/KMZ, GeoJSON, GPX y CSV.
 *
 * Exporta:  toKML · toGeoJSON · toGPX · toCSV      (modelo: { name, points, layers, mainColor, date })
 * Importa:  parseText · parseBytes (KML, KMZ, GeoJSON, GPX) → { format, name, features, warnings }
 *           toLayers(features) → capas de colores para sumar a un proyecto
 *
 * Característica (feature): { type: 'polygon'|'line'|'point', name, coords: [{lat, lon, alt, name?}], holes?: [[…]] }
 * Los polígonos se guardan sin repetir el primer punto al final.
 * Las altitudes solo se aceptan si parecen reales: si todas valen 0 (así guarda Google Earth los polígonos
 * pegados al suelo) o son "relativas al suelo", se ignoran y se avisa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./xml.js'), require('./zip.js'));
  else root.Gis = factory(root.Geo, root.Xml, root.Zip);
})(typeof self !== 'undefined' ? self : this, function (Geo, Xml, Zip) {
  'use strict';

  var LIMITS = { bytes: 40 * 1024 * 1024, layers: 200, vertices: 150000 };
  var MAIN_COLOR = '#2F8F4E';
  // Colores para las capas importadas (distintos del verde del polígono principal)
  var PALETTE = ['#E67E22', '#8E44AD', '#2980B9', '#C0392B', '#D4AC0D', '#E84393', '#16A085', '#34495E', '#8D6E63'];
  var COLORS = [MAIN_COLOR].concat(PALETTE);
  var ICON = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validLL(lat, lon) { return isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
  function cleanName(s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 80); }
  function esc(s) { return Xml.escape(s); }
  function fix(v, d) { return Number(v).toFixed(d); }
  function numEs(v, d) { return fix(v, d).replace('.', ','); }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

  /* =====================================================================
   *  Importación
   * ===================================================================== */

  // Contexto de lectura: cuenta coordenadas descartadas y controla el tamaño
  function Ctx() { this.warnings = []; this.flags = {}; this.bad = 0; this.verts = 0; this.features = []; }
  Ctx.prototype.pt = function (lon, lat, alt) {
    if (!validLL(lat, lon)) { this.bad++; return null; }
    if (++this.verts > LIMITS.vertices) throw new Error('El archivo tiene demasiados puntos (más de ' + LIMITS.vertices + ').');
    return { lat: lat, lon: lon, alt: isNum(alt) ? alt : null };
  };
  Ctx.prototype.warn = function (key, msg) { if (!this.flags[key]) { this.flags[key] = true; this.warnings.push(msg); } };

  function dedupe(pts) {
    var out = [];
    pts.forEach(function (p) { var q = out[out.length - 1]; if (!q || q.lat !== p.lat || q.lon !== p.lon) out.push(p); });
    if (out.length > 1) { var a = out[0], b = out[out.length - 1]; if (a.lat === b.lat && a.lon === b.lon) out.pop(); }
    return out;
  }

  // Descarta altitudes que no son reales (todas 0, o relativas al suelo)
  function checkAlts(ctx, coords, mode) {
    var any = false, nonzero = false;
    coords.forEach(function (c) { if (isNum(c.alt)) { any = true; if (c.alt !== 0) nonzero = true; } });
    if (!any) return;
    if (!nonzero) {
      coords.forEach(function (c) { c.alt = null; });
      ctx.warn('alt0', 'Las altitudes del archivo son todas 0 (así las guarda Google Earth cuando el dibujo va pegado al suelo), así que se ignoraron. Completa la altitud con el GPS o con internet.');
    } else if (mode === 'relativeToGround' || mode === 'relativeToSeaFloor') {
      coords.forEach(function (c) { c.alt = null; });
      ctx.warn('altrel', 'Las alturas del archivo son relativas al suelo, no sobre el nivel del mar; se ignoraron.');
    }
  }

  function pushPolygon(ctx, name, outer, holes, mode) {
    var ring = dedupe(outer);
    if (ring.length < 3) {
      if (ring.length >= 2) pushLine(ctx, name, ring, mode);
      else ctx.warn('smallring', 'Se omitió algún polígono con menos de 3 puntos.');
      return;
    }
    var hs = (holes || []).map(dedupe).filter(function (h) { return h.length >= 3; });
    var all = ring.concat.apply(ring, hs);
    checkAlts(ctx, all, mode);
    ctx.features.push({ type: 'polygon', name: cleanName(name), coords: ring, holes: hs });
  }
  function pushLine(ctx, name, pts, mode) {
    if (pts.length < 2) { ctx.warn('smallline', 'Se omitió alguna línea con menos de 2 puntos.'); return; }
    checkAlts(ctx, pts, mode);
    ctx.features.push({ type: 'line', name: cleanName(name), coords: pts });
  }
  function pushPoints(ctx, name, pts, mode) {
    checkAlts(ctx, pts, mode);
    pts.forEach(function (p) { ctx.features.push({ type: 'point', name: cleanName(name), coords: [p] }); });
  }

  function finishCtx(ctx, what) {
    if (!ctx.features.length) {
      if (ctx.bad) throw new Error('Las coordenadas de este archivo no están en grados (parecen coordenadas planas, como MAGNA-SIRGAS o UTM). Conviértelas a grados (WGS84) en Google Earth o QGIS y vuelve a exportar.');
      throw new Error('No encontré polígonos, líneas ni puntos en este archivo ' + what + '.');
    }
    if (ctx.bad) ctx.warnings.push('Se omitieron ' + ctx.bad + ' coordenada(s) fuera de rango.');
  }

  /* ---------- KML ---------- */
  function coordTuples(ctx, textValue) {
    var s = String(textValue || '').replace(/\s*,\s*/g, ',').trim();
    if (!s) return [];
    var out = [];
    s.split(/\s+/).forEach(function (tok) {
      var a = tok.split(',');
      if (a.length < 2 || a[0] === '' || a[1] === '') { ctx.bad++; return; }
      var lon = Number(a[0]), lat = Number(a[1]);
      var alt = a.length > 2 && a[2] !== '' ? Number(a[2]) : null;
      var p = ctx.pt(lon, lat, alt);
      if (p) out.push(p);
    });
    return out;
  }

  function parseKML(text) {
    var rootEl = Xml.parse(text);
    if (rootEl.name !== 'kml') throw new Error('Este archivo no es un KML.');
    var ctx = new Ctx(), docName = '';
    var top = Xml.child(rootEl, 'Document') || Xml.child(rootEl, 'Folder');
    if (top) docName = cleanName(Xml.text(Xml.child(top, 'name')));

    function geoms(node, out) {
      node.children.forEach(function (c) {
        if (c.name === 'Point' || c.name === 'LineString' || c.name === 'LinearRing' || c.name === 'Polygon' || c.name === 'Track') out.push(c);
        else if (c.name === 'MultiGeometry' || c.name === 'MultiTrack') geoms(c, out);
      });
      return out;
    }
    function ringCoords(holder) {
      var lr = Xml.child(holder, 'LinearRing');
      return lr ? coordTuples(ctx, Xml.text(Xml.child(lr, 'coordinates'))) : [];
    }
    function placemark(pm) {
      var name = Xml.text(Xml.child(pm, 'name'));
      geoms(pm, []).forEach(function (g) {
        var mode = Xml.text(Xml.child(g, 'altitudeMode'));
        if (g.name === 'Point') {
          pushPoints(ctx, name, coordTuples(ctx, Xml.text(Xml.child(g, 'coordinates'))).slice(0, 1), mode);
        } else if (g.name === 'LineString' || g.name === 'LinearRing') {
          pushLine(ctx, name, coordTuples(ctx, Xml.text(Xml.child(g, 'coordinates'))), mode);
        } else if (g.name === 'Polygon') {
          var outer = ringCoords(Xml.child(g, 'outerBoundaryIs') || { children: [] });
          var holes = Xml.kids(g, 'innerBoundaryIs').map(ringCoords);
          pushPolygon(ctx, name, outer, holes, mode);
        } else if (g.name === 'Track') {
          var pts = [];
          Xml.kids(g, 'coord').forEach(function (c) {
            var a = Xml.text(c).split(/\s+/);
            var p = ctx.pt(Number(a[0]), Number(a[1]), a.length > 2 ? Number(a[2]) : null);
            if (p) pts.push(p);
          });
          pushLine(ctx, name, pts, mode);
        }
      });
    }
    (function walk(node) {
      node.children.forEach(function (c) {
        if (c.name === 'Document' || c.name === 'Folder') walk(c);
        else if (c.name === 'Placemark') placemark(c);
        else if (c.name === 'NetworkLink') ctx.warn('netlink', 'El archivo trae vínculos a internet (NetworkLink); se ignoraron.');
      });
    })(rootEl);
    finishCtx(ctx, 'KML');
    return { format: 'kml', name: docName, features: ctx.features, warnings: ctx.warnings };
  }

  /* ---------- GeoJSON ---------- */
  var NAME_KEYS = ['name', 'Name', 'NAME', 'nombre', 'Nombre', 'NOMBRE', 'title', 'titulo', 'label', 'predio', 'PREDIO',
    'numero_predial', 'NUMERO_PREDIAL', 'codigo', 'CODIGO', 'id', 'ID'];
  function nameFromProps(p) {
    if (!p || typeof p !== 'object') return '';
    for (var i = 0; i < NAME_KEYS.length; i++) {
      var v = p[NAME_KEYS[i]];
      if ((typeof v === 'string' && v.trim()) || (typeof v === 'number' && isFinite(v))) return cleanName(v);
    }
    return '';
  }

  function parseGeoJSONObject(obj) {
    var ctx = new Ctx();
    function pos(a) {
      if (!Array.isArray(a) || a.length < 2 || typeof a[0] !== 'number' || typeof a[1] !== 'number') { ctx.bad++; return null; }
      return ctx.pt(a[0], a[1], typeof a[2] === 'number' ? a[2] : null);
    }
    function line(arr) { return Array.isArray(arr) ? arr.map(pos).filter(Boolean) : []; }
    function geometry(g, name) {
      if (!g || typeof g !== 'object') return;
      var i;
      switch (g.type) {
        case 'Point': pushPoints(ctx, name, [pos(g.coordinates)].filter(Boolean)); break;
        case 'MultiPoint': pushPoints(ctx, name, line(g.coordinates)); break;
        case 'LineString': pushLine(ctx, name, line(g.coordinates)); break;
        case 'MultiLineString': (g.coordinates || []).forEach(function (l) { pushLine(ctx, name, line(l)); }); break;
        case 'Polygon': polygon(g.coordinates, name); break;
        case 'MultiPolygon': (g.coordinates || []).forEach(function (pg) { polygon(pg, name); }); break;
        case 'GeometryCollection': for (i = 0; i < (g.geometries || []).length; i++) geometry(g.geometries[i], name); break;
        default: ctx.warn('geom-' + g.type, 'Se omitió una geometría de tipo "' + g.type + '".');
      }
    }
    function polygon(rings, name) {
      if (!Array.isArray(rings) || !rings.length) return;
      pushPolygon(ctx, name, line(rings[0]), rings.slice(1).map(line), null);
    }
    function feature(f) {
      if (!f || typeof f !== 'object') return;
      geometry(f.geometry, nameFromProps(f.properties));
    }
    if (obj.type === 'FeatureCollection') (obj.features || []).forEach(feature);
    else if (obj.type === 'Feature') feature(obj);
    else geometry(obj, '');
    finishCtx(ctx, 'GeoJSON');
    return { format: 'geojson', name: cleanName(obj.name), features: ctx.features, warnings: ctx.warnings };
  }

  var GJ_TYPES = ['FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];
  function parseJSONText(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('El archivo no es un JSON válido (' + (e && e.message || 'error de lectura') + ').'); }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (GJ_TYPES.indexOf(obj.type) >= 0) return parseGeoJSONObject(obj);
      if (obj.app === 'zonas-de-vida-gps' || Array.isArray(obj.projects) || (obj.state && Array.isArray(obj.state.projects))) {
        var err = new Error('Este archivo es una copia de seguridad de la app, no un mapa. Restáurala desde el menú Proyectos.');
        err.code = 'backup';
        throw err;
      }
    }
    throw new Error('No reconozco este JSON como GeoJSON (falta "type": "FeatureCollection", "Feature" o una geometría).');
  }

  /* ---------- GPX ---------- */
  function perimeterOf(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += Geo.haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon); return s; }

  function parseGPX(text) {
    var rootEl = Xml.parse(text);
    if (rootEl.name !== 'gpx') throw new Error('Este archivo no es un GPX.');
    var ctx = new Ctx();
    function wp(node) {
      var ele = Xml.text(Xml.child(node, 'ele'));
      return ctx.pt(Number(node.attrs.lon), Number(node.attrs.lat), ele !== '' ? Number(ele) : null);
    }
    Xml.kids(rootEl, 'wpt').forEach(function (w) {
      var p = wp(w);
      if (p) { var nm = Xml.text(Xml.child(w, 'name')); pushPoints(ctx, nm, [p]); }
    });
    function path(name, pts) {
      if (pts.length >= 4) {
        // un recorrido que vuelve al punto de partida se toma como polígono (perímetro caminado)
        var gap = Geo.haversine(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon);
        var per = perimeterOf(pts);
        if (gap <= Math.max(25, per * 0.01)) {
          var ring = pts.slice(0, -1);
          var a = Math.abs(Geo.polygonArea(ring));
          if (a / (per * per) >= 0.005) { pushPolygon(ctx, name, ring, [], null); return; }
        }
      }
      pushLine(ctx, name, pts, null);
    }
    Xml.kids(rootEl, 'rte').forEach(function (r) {
      path(Xml.text(Xml.child(r, 'name')), Xml.kids(r, 'rtept').map(wp).filter(Boolean));
    });
    Xml.kids(rootEl, 'trk').forEach(function (t) {
      var pts = [];
      Xml.kids(t, 'trkseg').forEach(function (s) { Xml.kids(s, 'trkpt').forEach(function (q) { var p = wp(q); if (p) pts.push(p); }); });
      path(Xml.text(Xml.child(t, 'name')), pts);
    });
    finishCtx(ctx, 'GPX');
    var meta = Xml.child(rootEl, 'metadata');
    return { format: 'gpx', name: cleanName(Xml.text(Xml.child(meta, 'name'))), features: ctx.features, warnings: ctx.warnings };
  }

  /* ---------- Entrada general ---------- */
  function sniff(text) {
    var t = String(text).replace(/^﻿/, '').replace(/^\s+/, '');
    var c = t.charAt(0);
    if (c === '{' || c === '[') return 'json';
    if (c === '<') {
      var m = /<([A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)/.exec(t.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, ''));
      var nm = m ? m[2].toLowerCase() : '';
      return nm === 'kml' ? 'kml' : nm === 'gpx' ? 'gpx' : 'xml';
    }
    return 'unknown';
  }

  function parseText(text) {
    var s = String(text === null || text === undefined ? '' : text);
    if (s.length > LIMITS.bytes) throw new Error('El archivo es demasiado grande (máximo 40 MB).');
    var kind = sniff(s);
    if (kind === 'json') return parseJSONText(s.replace(/^﻿/, ''));
    if (kind === 'kml') return parseKML(s);
    if (kind === 'gpx') return parseGPX(s);
    if (kind === 'xml') throw new Error('Este XML no es un KML ni un GPX.');
    throw new Error('No reconozco este archivo. Usa KML, KMZ, GeoJSON o GPX.');
  }

  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    return Zip.utf8(bytes);
  }

  // bytes: Uint8Array del archivo (KMZ o texto)
  function parseBytes(bytes) {
    if (!bytes || !bytes.length) throw new Error('El archivo está vacío.');
    if (bytes.length > LIMITS.bytes) throw new Error('El archivo es demasiado grande (máximo 40 MB).');
    if (Zip.isZip(bytes)) {
      var es = Zip.entries(bytes).filter(function (e) { return !e.dir; });
      var pick = es.filter(function (e) { return /(^|\/)doc\.kml$/i.test(e.name); })[0] || es.filter(function (e) { return /\.kml$/i.test(e.name); })[0];
      if (!pick) throw new Error('Este ZIP/KMZ no contiene ningún archivo .kml.');
      var res = parseKML(decodeText(Zip.extract(bytes, pick, LIMITS.bytes)));
      res.format = 'kmz';
      return res;
    }
    return parseText(decodeText(bytes));
  }

  /* ---------- De características a capas ---------- */
  function uidDefault() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // opts: { file, startAt (índice en la paleta), uid(), ts }
  function toLayers(features, opts) {
    opts = opts || {};
    var uid = opts.uid || uidDefault, start = opts.startAt || 0, ts = opts.ts || Date.now();
    var base = cleanName(opts.file || '').replace(/\.(kml|kmz|json|geojson|gpx)$/i, '').replace(/\.(kml|kmz|json|geojson|gpx)$/i, '');
    var layers = [], pts = [];
    function color() { return PALETTE[(start + layers.length) % PALETTE.length]; }
    features.forEach(function (f) {
      if (f.type === 'point') { pts.push(f); return; }
      var coords = f.coords.map(function (c) { return { lat: c.lat, lon: c.lon, alt: isNum(c.alt) ? c.alt : null }; });
      var layer = { id: uid(), name: f.name || base || (f.type === 'polygon' ? 'Polígono importado' : 'Línea importada'), kind: f.type, color: color(),
                    visible: true, points: coords, file: opts.file || '', ts: ts };
      if (f.holes && f.holes.length) layer.holes = f.holes.map(function (h) { return h.map(function (c) { return { lat: c.lat, lon: c.lon, alt: isNum(c.alt) ? c.alt : null }; }); });
      layers.push(layer);
    });
    if (pts.length) {
      layers.push({ id: uid(), name: (pts.length === 1 && pts[0].name) ? pts[0].name : (base ? base + ' (puntos)' : 'Puntos importados'), kind: 'points', color: color(), visible: true,
                    points: pts.map(function (f) { var c = f.coords[0]; var o = { lat: c.lat, lon: c.lon, alt: isNum(c.alt) ? c.alt : null }; if (f.name) o.name = f.name; return o; }),
                    file: opts.file || '', ts: ts });
    }
    if (layers.length > LIMITS.layers) throw new Error('El archivo trae ' + layers.length + ' elementos; el máximo es ' + LIMITS.layers + ' por importación.');
    return layers;
  }

  // Resumen para mostrar antes de importar
  function summarize(features) {
    var s = { polygons: 0, lines: 0, points: 0, vertices: 0, areaM2: 0, center: null, items: [] };
    var all = [];
    features.forEach(function (f) {
      s.vertices += f.coords.length;
      all = all.concat(f.coords);
      var it = { type: f.type, name: f.name, vertices: f.coords.length };
      if (f.type === 'polygon') {
        s.polygons++;
        it.areaM2 = Geo.polygonArea(f.coords);
        s.areaM2 += it.areaM2;
      } else if (f.type === 'line') { s.lines++; it.lengthM = perimeterOf(f.coords); } else s.points++;
      s.items.push(it);
    });
    if (all.length) s.center = Geo.centroid(all.length > 3000 ? all.filter(function (_, i) { return i % Math.ceil(all.length / 3000) === 0; }) : all);
    return s;
  }

  // Puntos de proyecto a partir de una capa (para usarla como polígono principal)
  function pointsFromLayer(layer, uid) {
    uid = uid || uidDefault;
    return layer.points.map(function (p, i) {
      return { id: uid(), name: p.name || ('P' + (i + 1)), lat: p.lat, lon: p.lon, alt: isNum(p.alt) ? p.alt : null, altGps: null,
               altSrc: isNum(p.alt) ? 'archivo' : null, acc: null, altAcc: null, src: 'archivo', ts: layer.ts || Date.now() };
    });
  }

  /* =====================================================================
   *  Exportación
   * ===================================================================== */

  function norm(m) {
    m = m || {};
    var points = (m.points || []).filter(function (p) { return p && validLL(p.lat, p.lon); });
    var layers = (m.layers || []).filter(function (l) { return l && l.visible !== false && Array.isArray(l.points) && l.points.length; });
    var n = points.length;
    return {
      name: cleanName(m.name) || 'Proyecto', date: m.date || Date.now(), points: points, layers: layers,
      mainColor: isHex(m.mainColor) ? m.mainColor : MAIN_COLOR,
      areaM2: n >= 3 ? Geo.polygonArea(points) : null,
      perimeter: n >= 2 ? Geo.perimeter(points, n >= 3) : null
    };
  }

  function closed(ring) { return ring.concat([ring[0]]); }
  function lonlatAlt(p) { return fix(p.lon, 7) + ',' + fix(p.lat, 7) + ',' + (isNum(p.alt) ? fix(p.alt, 1) : '0'); }
  function kmlColor(hex, alpha) {
    var h = isHex(hex) ? hex.slice(1) : '2F8F4E';
    return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }
  function ptDesc(p) {
    var bits = [];
    if (isNum(p.alt)) bits.push('Altitud: ' + numEs(p.alt, 0) + ' m' + (p.altSrc ? ' (' + (p.altSrc === 'gps' ? 'GPS' : p.altSrc === 'internet' ? 'internet' : p.altSrc === 'archivo' ? 'archivo' : 'a mano') + ')' : ''));
    if (isNum(p.acc)) bits.push('Precisión: ±' + numEs(p.acc, 0) + ' m');
    return bits.join(' · ');
  }

  function toKML(model) {
    var m = norm(model), out = [];
    var styles = [{ id: 'principal', color: m.mainColor }];
    m.layers.forEach(function (l, i) { styles.push({ id: 'capa' + i, color: l.color }); });
    out.push('<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', '<Document>', '<name>' + esc(m.name) + '</name>');
    var d = [];
    if (m.areaM2 !== null) d.push('Área: ' + numEs(m.areaM2 / 10000, 4) + ' ha (' + numEs(m.areaM2, 0) + ' m²)');
    if (m.perimeter !== null) d.push('Perímetro: ' + numEs(m.perimeter, 1) + ' m');
    d.push(m.points.length + ' vértices');
    d.push('Exportado desde Zonas de Vida el ' + new Date(m.date).toISOString().slice(0, 10));
    out.push('<description>' + esc(d.join(' · ')) + '</description>');
    styles.forEach(function (s) {
      out.push('<Style id="' + s.id + '"><LineStyle><color>' + kmlColor(s.color, 'ff') + '</color><width>3</width></LineStyle>' +
        '<PolyStyle><color>' + kmlColor(s.color, '55') + '</color></PolyStyle>' +
        '<IconStyle><color>' + kmlColor(s.color, 'ff') + '</color><scale>0.8</scale><Icon><href>' + ICON + '</href></Icon></IconStyle>' +
        '<LabelStyle><scale>0.8</scale></LabelStyle></Style>');
    });
    function ringXml(pts) { return '<LinearRing><coordinates>' + closed(pts).map(lonlatAlt).join(' ') + '</coordinates></LinearRing>'; }
    function polygonXml(name, style, outer, holes) {
      return '<Placemark><name>' + esc(name) + '</name><styleUrl>#' + style + '</styleUrl><Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>' +
        '<outerBoundaryIs>' + ringXml(outer) + '</outerBoundaryIs>' +
        (holes || []).map(function (h) { return '<innerBoundaryIs>' + ringXml(h) + '</innerBoundaryIs>'; }).join('') + '</Polygon></Placemark>';
    }
    function lineXml(name, style, pts) {
      return '<Placemark><name>' + esc(name) + '</name><styleUrl>#' + style + '</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>' +
        pts.map(lonlatAlt).join(' ') + '</coordinates></LineString></Placemark>';
    }
    function pointXml(name, style, p, desc) {
      return '<Placemark><name>' + esc(name) + '</name>' + (desc ? '<description>' + esc(desc) + '</description>' : '') + '<styleUrl>#' + style + '</styleUrl>' +
        '<Point><altitudeMode>clampToGround</altitudeMode><coordinates>' + lonlatAlt(p) + '</coordinates></Point></Placemark>';
    }
    var n = m.points.length;
    if (n) {
      out.push('<Folder><name>' + esc(m.name) + '</name>');
      if (n >= 3) out.push(polygonXml(m.name, 'principal', m.points, null));
      else if (n === 2) out.push(lineXml(m.name, 'principal', m.points));
      out.push('<Folder><name>Vértices</name>');
      m.points.forEach(function (p, i) { out.push(pointXml(p.name || ('P' + (i + 1)), 'principal', p, ptDesc(p))); });
      out.push('</Folder></Folder>');
    }
    m.layers.forEach(function (l, i) {
      var st = 'capa' + i;
      out.push('<Folder><name>' + esc(l.name) + '</name>');
      if (l.kind === 'polygon' && l.points.length >= 3) out.push(polygonXml(l.name, st, l.points, l.holes));
      else if (l.kind === 'points') l.points.forEach(function (p, k) { out.push(pointXml(p.name || (l.name + ' ' + (k + 1)), st, p, ptDesc(p))); });
      else out.push(lineXml(l.name, st, l.points));
      out.push('</Folder>');
    });
    out.push('</Document>', '</kml>');
    return out.join('\n');
  }

  // Orientación: > 0 antihoraria (en lon/lat con el norte arriba)
  function signedArea(ring) {
    var a = 0;
    for (var i = 0; i < ring.length; i++) { var p = ring[i], q = ring[(i + 1) % ring.length]; a += p.lon * q.lat - q.lon * p.lat; }
    return a / 2;
  }
  function orient(ring, ccw) { return (signedArea(ring) > 0) === ccw ? ring : ring.slice().reverse(); }
  function pos(p, withAlt) {
    var a = [Number(fix(p.lon, 7)), Number(fix(p.lat, 7))];
    if (withAlt && isNum(p.alt)) a.push(Number(fix(p.alt, 1)));
    return a;
  }
  function ringJson(ring, ccw) {
    var o = orient(ring, ccw), alt = o.every(function (p) { return isNum(p.alt); });
    return closed(o).map(function (p) { return pos(p, alt); });
  }

  function toGeoJSON(model) {
    var m = norm(model), feats = [], n = m.points.length;
    if (n >= 3) {
      feats.push({ type: 'Feature', properties: { name: m.name, tipo: 'poligono', area_m2: Number(fix(m.areaM2, 1)), area_ha: Number(fix(m.areaM2 / 10000, 4)),
        perimetro_m: Number(fix(m.perimeter, 1)), vertices: n, color: m.mainColor }, geometry: { type: 'Polygon', coordinates: [ringJson(m.points, true)] } });
    } else if (n === 2) {
      feats.push({ type: 'Feature', properties: { name: m.name, tipo: 'linea', largo_m: Number(fix(m.perimeter, 1)), color: m.mainColor }, geometry: { type: 'LineString', coordinates: m.points.map(function (p) { return pos(p, true); }) } });
    }
    m.points.forEach(function (p, i) {
      var props = { name: p.name || ('P' + (i + 1)), tipo: 'vertice', capa: m.name, color: m.mainColor };
      if (isNum(p.alt)) { props.altitud_m = Number(fix(p.alt, 1)); if (p.altSrc) props.fuente_altitud = p.altSrc; }
      if (isNum(p.acc)) props.precision_m = Number(fix(p.acc, 1));
      feats.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: pos(p, true) } });
    });
    m.layers.forEach(function (l) {
      var base = { name: l.name, capa: l.name, color: l.color };
      if (l.kind === 'polygon' && l.points.length >= 3) {
        feats.push({ type: 'Feature', properties: Object.assign({ tipo: 'poligono' }, base), geometry: { type: 'Polygon', coordinates: [ringJson(l.points, true)].concat((l.holes || []).map(function (h) { return ringJson(h, false); })) } });
      } else if (l.kind === 'points') {
        l.points.forEach(function (p, k) { feats.push({ type: 'Feature', properties: Object.assign({ tipo: 'punto' }, base, { name: p.name || (l.name + ' ' + (k + 1)) }), geometry: { type: 'Point', coordinates: pos(p, true) } }); });
      } else {
        feats.push({ type: 'Feature', properties: Object.assign({ tipo: 'linea' }, base), geometry: { type: 'LineString', coordinates: l.points.map(function (p) { return pos(p, true); }) } });
      }
    });
    return JSON.stringify({ type: 'FeatureCollection', name: m.name, features: feats }, null, 2);
  }

  function toGPX(model) {
    var m = norm(model), out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Zonas de Vida" xmlns="http://www.topografix.com/GPX/1/1">',
      '<metadata><name>' + esc(m.name) + '</name><time>' + new Date(m.date).toISOString() + '</time></metadata>');
    function wpt(p, name, desc) {
      return '<wpt lat="' + fix(p.lat, 7) + '" lon="' + fix(p.lon, 7) + '">' + (isNum(p.alt) ? '<ele>' + fix(p.alt, 1) + '</ele>' : '') +
        '<name>' + esc(name) + '</name>' + (desc ? '<desc>' + esc(desc) + '</desc>' : '') + '</wpt>';
    }
    function trk(name, pts, isRing) {
      var list = isRing ? closed(pts) : pts;
      return '<trk><name>' + esc(name) + '</name><trkseg>' + list.map(function (p) {
        return '<trkpt lat="' + fix(p.lat, 7) + '" lon="' + fix(p.lon, 7) + '">' + (isNum(p.alt) ? '<ele>' + fix(p.alt, 1) + '</ele>' : '') + '</trkpt>';
      }).join('') + '</trkseg></trk>';
    }
    m.points.forEach(function (p, i) { out.push(wpt(p, p.name || ('P' + (i + 1)), ptDesc(p))); });
    m.layers.forEach(function (l) {
      if (l.kind === 'points') l.points.forEach(function (p, k) { out.push(wpt(p, p.name || (l.name + ' ' + (k + 1)), l.name)); });
    });
    var n = m.points.length;
    if (n >= 2) out.push(trk(m.name, m.points, n >= 3));
    m.layers.forEach(function (l) { if (l.kind !== 'points') out.push(trk(l.name, l.points, l.kind === 'polygon' && l.points.length >= 3)); });
    out.push('</gpx>');
    return out.join('\n');
  }

  // CSV del polígono principal. style: 'es' (Excel en español: ; y coma decimal) | 'std' (, y punto decimal)
  function toCSV(points, opts) {
    opts = opts || {};
    var es = opts.style !== 'std', sep = es ? ';' : ',';
    var pts = (points || []).filter(function (p) { return p && validLL(p.lat, p.lon); });
    var n = pts.length, ring = n >= 3;
    function num(v, d) { if (!isNum(v)) return ''; var s = fix(v, d); return es ? s.replace('.', ',') : s; }
    function cell(s) { s = String(s); return /[";,\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var rows = [['Punto', 'Latitud', 'Longitud', 'Altitud', 'Rumbo', 'Distancia al vértice siguiente'].join(sep)];
    pts.forEach(function (p, i) {
      var nxt = ring ? pts[(i + 1) % n] : (i + 1 < n ? pts[i + 1] : null);
      var brg = nxt ? Geo.bearing(p.lat, p.lon, nxt.lat, nxt.lon) : null, dist = nxt ? Geo.distance(p.lat, p.lon, nxt.lat, nxt.lon) : null;
      rows.push([cell(p.name || ('P' + (i + 1))), num(p.lat, 7), num(p.lon, 7), num(p.alt, 1), num(brg, 1), num(dist, 2)].join(sep));
    });
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  return {
    LIMITS: LIMITS, MAIN_COLOR: MAIN_COLOR, PALETTE: PALETTE, COLORS: COLORS,
    parseText: parseText, parseBytes: parseBytes, sniff: sniff, toLayers: toLayers, summarize: summarize, pointsFromLayer: pointsFromLayer,
    toKML: toKML, toGeoJSON: toGeoJSON, toGPX: toGPX, toCSV: toCSV, isHex: isHex
  };
});

/* climate.js — de dónde sale la temperatura y la precipitación de cada punto.
 *
 * Prioridad (de mayor a menor confianza):
 *   1. valor manual del usuario
 *   2. datos descargados con internet (NASA POWER + elevación Open-Meteo), guardados en el punto
 *   3. memoria offline: paquete CSV importado / datos de consultas anteriores (interpolación por distancia)
 *   4. temperatura estimada por altitud (solo temperatura; la precipitación nunca se inventa)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.Climate = factory(root.Geo);
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  // Ajuste con temperaturas medias anuales de ciudades colombianas entre 0 y 2800 m
  // (error típico ≈ 1 °C, máximo ≈ 2 °C). Fuera del trópico es solo una aproximación.
  var T0_EQUATOR = 28.2;     // °C a nivel del mar en el ecuador
  var LAPSE = 0.00533;       // °C por metro de ascenso
  var DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ok12(a) { return Array.isArray(a) && a.length === 12 && a.every(isNum); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function mean(a) { return sum(a) / a.length; }

  function seaLevelTemp(lat) {
    var a = Math.abs(lat);
    if (a <= 40) return T0_EQUATOR - 0.0090 * a * a;
    return T0_EQUATOR - 0.0090 * 1600 - 0.62 * (a - 40);
  }

  // Temperatura media anual estimada (°C) o null si falta la altitud
  function estimateT(lat, alt) {
    if (!isNum(lat) || !isNum(alt)) return null;
    return seaLevelTemp(lat) - LAPSE * Math.max(alt, -100);
  }

  function estimateUncertainty(lat) { return Math.abs(lat) <= 15 ? 2 : 4; }

  /* ---------- Memoria offline (puntos de clima conocidos) ---------- */
  function Memory() { this.cells = {}; this.count = 0; }
  var CELL = 0.1;            // grados (~11 km)
  Memory.prototype._key = function (i, j) { return i + ',' + j; };
  Memory.prototype.add = function (recs) {
    var self = this;
    (recs || []).forEach(function (r) {
      if (!isNum(r.lat) || !isNum(r.lon)) return;
      if (!isNum(r.T) && !isNum(r.P)) return;
      var k = self._key(Math.floor(r.lat / CELL), Math.floor(r.lon / CELL));
      (self.cells[k] = self.cells[k] || []).push(r);
      self.count++;
    });
  };
  Memory.prototype.clear = function () { this.cells = {}; this.count = 0; };
  Memory.prototype.all = function () {
    var out = [];
    for (var k in this.cells) out = out.concat(this.cells[k]);
    return out;
  };
  // Registros dentro de radiusKm, ordenados por distancia
  Memory.prototype.near = function (lat, lon, radiusKm) {
    var res = [];
    var dLat = radiusKm / 111;
    var dLon = radiusKm / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    var i0 = Math.floor((lat - dLat) / CELL), i1 = Math.floor((lat + dLat) / CELL);
    var j0 = Math.floor((lon - dLon) / CELL), j1 = Math.floor((lon + dLon) / CELL);
    for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) {
      var list = this.cells[this._key(i, j)];
      if (!list) continue;
      for (var n = 0; n < list.length; n++) {
        var d = Geo.haversine(lat, lon, list[n].lat, list[n].lon) / 1000;
        if (d <= radiusKm) res.push({ rec: list[n], km: d });
      }
    }
    res.sort(function (a, b) { return a.km - b.km; });
    return res;
  };

  // Interpolación por inverso de la distancia al cuadrado con los k más cercanos
  function idw(items, getter, k) {
    var s = 0, w = 0, n = 0, used = [];
    for (var i = 0; i < items.length && n < k; i++) {
      var v = getter(items[i]);
      if (!isNum(v)) continue;
      var wt = 1 / Math.pow(Math.max(items[i].km, 0.1), 2);
      s += v * wt; w += wt; n++; used.push(items[i]);
    }
    return n ? { value: s / w, n: n, nearestKm: used[0].km, farthestKm: used[used.length - 1].km } : null;
  }

  /* ---------- Resolución por punto ---------- */
  // p: { lat, lon, alt, tManual, pManual, online:{T,P,monthlyT,elevCell,date,source} }
  // opts: { memory, radiusKm }
  function resolve(p, opts) {
    opts = opts || {};
    var radius = opts.radiusKm || 25;
    var out = { alt: isNum(p.alt) ? p.alt : null, T: null, TSrc: null, P: null, PSrc: null, monthlyT: null, notes: [],
                chartT: null, chartP: null, chartSrc: { T: null, P: null } };
    // Datos mensuales escritos por el usuario: solo valen si están los 12 meses
    var mm = p.monthlyManual || null;
    var mT = mm && ok12(mm.T) ? mm.T.slice() : null;
    var mP = mm && ok12(mm.P) ? mm.P.slice() : null;
    // Temperatura mensual de internet, corregida por la diferencia de altitud con la celda
    var onT = null;
    if (p.online && ok12(p.online.monthlyT)) {
      var c0 = isNum(p.online.elevCell) && isNum(p.alt) ? -LAPSE * (p.alt - p.online.elevCell) : 0;
      onT = p.online.monthlyT.map(function (t) { return t + c0; });
    }
    var onP = p.online && ok12(p.online.monthlyP) ? p.online.monthlyP.slice() : null;
    if (mT) { out.chartT = mT; out.chartSrc.T = 'manual'; } else if (onT) { out.chartT = onT; out.chartSrc.T = 'online'; }
    if (mP) { out.chartP = mP; out.chartSrc.P = 'manual'; } else if (onP) { out.chartP = onP; out.chartSrc.P = 'online'; }

    // ---- Temperatura
    if (isNum(p.tManual)) {
      out.T = p.tManual; out.TSrc = 'manual';
      if (mT) {
        out.monthlyT = mT;
        if (Math.abs(mean(mT) - p.tManual) > 0.5) out.notes.push('La temperatura anual que escribiste (' + p.tManual.toFixed(1) + ' °C) no coincide con el promedio de tus 12 meses (' + mean(mT).toFixed(1) + ' °C). La zona de vida usa la anual; el diagrama de Walter-Lieth usa los meses.');
      }
    } else if (mT) {
      out.T = mean(mT); out.TSrc = 'manual'; out.monthlyT = mT;
      out.notes.push('Temperatura media calculada con los 12 valores mensuales que escribiste.');
    } else if (p.online && isNum(p.online.T)) {
      var corr = 0, corrected = false;
      if (isNum(p.online.elevCell) && isNum(p.alt)) { corr = -LAPSE * (p.alt - p.online.elevCell); corrected = true; }
      out.T = p.online.T + corr; out.TSrc = 'online';
      if (p.online.monthlyT) out.monthlyT = p.online.monthlyT.map(function (t) { return t + corr; });
      if (corrected) out.notes.push('Temperatura de internet corregida por la diferencia de altitud con la celda de ~50 km (' + Math.round(p.online.elevCell) + ' m).');
      else out.notes.push('Temperatura de internet SIN corregir por altitud (falta la altitud del punto o de la celda): en montaña puede errar varios grados.');
    }
    var near = null;
    if (opts.memory && opts.memory.count && (out.T === null || !isNum(p.pManual) && !mP && !(p.online && isNum(p.online.P)))) {
      near = opts.memory.near(p.lat, p.lon, radius);
    }
    if (out.T === null && near && near.length) {
      var tAdj = idw(near, function (it) {
        if (!isNum(it.rec.T)) return null;
        if (isNum(it.rec.alt) && isNum(p.alt)) return it.rec.T - LAPSE * (p.alt - it.rec.alt);
        return it.rec.T;
      }, 4);
      if (tAdj) {
        out.T = tAdj.value; out.TSrc = 'memoria';
        out.notes.push('Temperatura tomada de ' + tAdj.n + ' dato(s) guardado(s) a ' + tAdj.nearestKm.toFixed(1) + ' km' +
          (isNum(p.alt) ? ' (ajustada por altitud).' : ' (sin ajuste por altitud: falta la altitud del punto).'));
      }
    }
    if (out.T === null) {
      var est = estimateT(p.lat, p.alt);
      if (est !== null) {
        out.T = est; out.TSrc = 'estimada';
        out.notes.push('Temperatura estimada solo con latitud y altitud (±' + estimateUncertainty(p.lat) + ' °C). Si tienes un dato medido, escríbelo.');
      } else {
        out.notes.push('Falta la altitud: sin ella no se puede estimar la temperatura. Escríbela, toma el GPS o completa con internet.');
      }
    }

    // ---- Precipitación
    if (isNum(p.pManual)) {
      out.P = p.pManual; out.PSrc = 'manual';
      if (mP && Math.abs(sum(mP) - p.pManual) > Math.max(30, 0.03 * p.pManual)) out.notes.push('La precipitación anual que escribiste (' + Math.round(p.pManual) + ' mm) no coincide con la suma de tus 12 meses (' + Math.round(sum(mP)) + ' mm). La zona de vida usa la anual; el diagrama de Walter-Lieth usa los meses.');
    } else if (mP) {
      out.P = sum(mP); out.PSrc = 'manual';
      out.notes.push('Precipitación anual calculada con los 12 valores mensuales que escribiste.');
    } else if (p.online && isNum(p.online.P)) {
      out.P = p.online.P; out.PSrc = 'online';
      out.notes.push('Precipitación de internet (rejilla de ~50 km): en zonas de montaña o con lluvia muy local puede diferir mucho de la real.');
    } else if (near && near.length) {
      var pm = idw(near, function (it) { return it.rec.P; }, 4);
      if (pm) {
        out.P = pm.value; out.PSrc = 'memoria';
        out.notes.push('Precipitación interpolada de ' + pm.n + ' dato(s) guardado(s) a ' + pm.nearestKm.toFixed(1) + (pm.n > 1 ? '–' + pm.farthestKm.toFixed(1) : '') + ' km.' +
          (pm.nearestKm > 10 ? ' Es lejos: la lluvia cambia mucho con el relieve, verifícala.' : ''));
      }
    }
    if (out.P === null) out.notes.push('Falta la precipitación anual: escríbela o importa un paquete de datos / completa con internet.');
    return out;
  }

  /* ---------- Importación de paquetes CSV ---------- */
  var ALIASES = {
    lat: ['lat', 'latitud', 'latitude', 'y'],
    lon: ['lon', 'lng', 'long', 'longitud', 'longitude', 'x'],
    alt: ['alt', 'altitud', 'altura', 'elev', 'elevacion', 'elevación', 'elevation', 'z', 'msnm'],
    T: ['t', 'temp', 'temperatura', 'tmean', 'tmedia', 't_media', 'temperatura_media', 'bio1', 'tmed'],
    P: ['p', 'prec', 'precip', 'precipitacion', 'precipitación', 'precipitation', 'lluvia', 'ppt', 'bio12', 'pmm'],
    name: ['name', 'nombre', 'estacion', 'estación', 'station', 'id', 'codigo', 'código']
  };

  function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

  function detectDelimiter(line) {
    var c = { ',': 0, ';': 0, '\t': 0 };
    for (var i = 0; i < line.length; i++) if (c.hasOwnProperty(line[i])) c[line[i]]++;
    var best = ',', n = -1;
    Object.keys(c).forEach(function (d) { if (c[d] > n) { n = c[d]; best = d; } });
    return best;
  }

  function parseCSV(text) {
    var out = { records: [], errors: [], notes: [] };
    var lines = stripBom(String(text || '')).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) { out.errors.push('El archivo está vacío o solo tiene encabezado.'); return out; }
    var delim = detectDelimiter(lines[0]);
    var head = lines[0].split(delim).map(function (h) { return h.trim().toLowerCase().replace(/^"|"$/g, ''); });
    var col = {};
    Object.keys(ALIASES).forEach(function (k) {
      for (var i = 0; i < head.length; i++) if (ALIASES[k].indexOf(head[i]) >= 0) { col[k] = i; break; }
    });
    if (col.lat === undefined || col.lon === undefined) {
      out.errors.push('No encontré las columnas de latitud y longitud (usa lat y lon). Encabezados leídos: ' + head.join(', '));
      return out;
    }
    if (col.T === undefined && col.P === undefined) {
      out.errors.push('No hay columna de temperatura ni de precipitación (usa temp y prec).');
      return out;
    }
    var decimalComma = delim === ';' || delim === '\t';
    function num(s) {
      if (s === undefined) return null;
      s = String(s).trim().replace(/^"|"$/g, '');
      if (s === '' || /^(na|nan|null|-9999|-999)$/i.test(s)) return null;
      var v = parseFloat(decimalComma ? s.replace(',', '.') : s);
      return isFinite(v) ? v : null;
    }
    var tIsBio1 = col.T !== undefined && head[col.T] === 'bio1';
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(delim);
      var lat = num(cells[col.lat]), lon = num(cells[col.lon]);
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        if (out.errors.length < 10) out.errors.push('Línea ' + (i + 1) + ': coordenadas no válidas.');
        continue;
      }
      var rec = { lat: lat, lon: lon, src: 'paquete' };
      if (col.alt !== undefined) rec.alt = num(cells[col.alt]);
      if (col.T !== undefined) rec.T = num(cells[col.T]);
      if (col.P !== undefined) rec.P = num(cells[col.P]);
      if (col.name !== undefined) rec.name = (cells[col.name] || '').trim();
      if (!isNum(rec.T) && !isNum(rec.P)) continue;
      out.records.push(rec);
    }
    if (tIsBio1) {
      var mx = 0;
      out.records.forEach(function (r) { if (isNum(r.T)) mx = Math.max(mx, Math.abs(r.T)); });
      if (mx > 60) {
        out.records.forEach(function (r) { if (isNum(r.T)) r.T = r.T / 10; });
        out.notes.push('La columna bio1 venía en décimas de °C (WorldClim 1.4); la dividí entre 10.');
      }
    }
    var badT = out.records.filter(function (r) { return isNum(r.T) && (r.T < -40 || r.T > 45); }).length;
    var badP = out.records.filter(function (r) { return isNum(r.P) && (r.P < 0 || r.P > 15000); }).length;
    if (badT) out.notes.push(badT + ' fila(s) con temperatura fuera de -40…45 °C: revisa las unidades.');
    if (badP) out.notes.push(badP + ' fila(s) con precipitación fuera de 0…15000 mm: revisa las unidades (mm por año).');
    return out;
  }

  /* ---------- Descarga con internet (NASA POWER + Open-Meteo) ---------- */
  // NASA POWER, climatología mensual: T2M (°C) y PRECTOTCORR (mm/día) por mes y anual.
  // Se aceptan los dos formatos conocidos de la respuesta:
  //   · clásico:  properties.parameter.T2M = { JAN…DEC, ANN }
  //   · nuevo:    normals = [{ parameter, units, annual, months: [{ month, value }] }]
  var VALID = function (v) { return isNum(v) && v > -900; };       // -999 = sin dato
  function monthIndex(m) {
    if (isNum(m)) return m >= 1 && m <= 12 ? m - 1 : -1;
    var t = String(m === null || m === undefined ? '' : m).trim();
    if (/^\d+$/.test(t)) { var n = parseInt(t, 10); return n >= 1 && n <= 12 ? n - 1 : -1; }
    var k = t.slice(0, 3).toUpperCase(), i = MONTHS.indexOf(k);
    if (i >= 0) return i;
    return { ENE: 0, ABR: 3, AGO: 7, DIC: 11 }.hasOwnProperty(k) ? { ENE: 0, ABR: 3, AGO: 7, DIC: 11 }[k] : -1;
  }
  function powerParams(json) {
    var out = {}, par = json && json.properties && json.properties.parameter;
    if (par && typeof par === 'object') {
      Object.keys(par).forEach(function (name) {
        var o = par[name] || {};
        out[name] = { months: MONTHS.map(function (m) { return o[m]; }), annual: o.ANN, units: null };
      });
    }
    var normals = json && (json.normals || (json.properties && json.properties.normals) || (json.data && json.data.normals));
    if (Array.isArray(normals)) {
      normals.forEach(function (e) {
        if (!e || !e.parameter) return;
        var months = [null, null, null, null, null, null, null, null, null, null, null, null], list = e.months;
        if (Array.isArray(list)) {
          list.forEach(function (x, i) {
            if (x && typeof x === 'object') { var idx = monthIndex(x.month !== undefined ? x.month : x.name); if (idx >= 0) months[idx] = x.value; }
            else if (list.length === 12) months[i] = x;
          });
        } else if (list && typeof list === 'object') {
          Object.keys(list).forEach(function (k) { var idx = monthIndex(k); if (idx >= 0) months[idx] = list[k]; });
        }
        out[e.parameter] = { months: months, annual: e.annual !== undefined ? e.annual : e.ann, units: e.units || null };
      });
    }
    return out;
  }
  function parsePower(json) {
    var par = powerParams(json);
    if (!par.T2M) throw new Error('Respuesta inesperada de NASA POWER');
    var monthlyT = par.T2M.months;
    var out = { T: null, monthlyT: null, P: null, monthlyP: null, elevCell: null, source: 'NASA POWER' };
    if (monthlyT.every(VALID)) {
      out.monthlyT = monthlyT;
      out.T = VALID(par.T2M.annual) ? par.T2M.annual : mean(monthlyT);
    } else if (VALID(par.T2M.annual)) {
      out.T = par.T2M.annual;
    }
    var pp = par.PRECTOTCORR;
    if (pp) {
      var perMonth = pp.units && /mm\s*\/\s*(month|mes|mo)\b/i.test(pp.units);       // si viniera ya por mes
      if (pp.months.every(VALID)) {
        out.monthlyP = pp.months.map(function (v, i) { return perMonth ? v : v * DAYS[i]; });
        out.P = sum(out.monthlyP);
      } else if (VALID(pp.annual)) {
        out.P = perMonth ? pp.annual * 12 : pp.annual * 365.25;
      }
    }
    var c = json.geometry && json.geometry.coordinates;
    var el = c && c.length >= 3 ? c[2] : (json.elevation !== undefined ? json.elevation : (json.properties && json.properties.elevation));
    if (VALID(el)) out.elevCell = el;
    if (out.T === null && out.P === null) throw new Error('NASA POWER no devolvió datos para este punto');
    return out;
  }

  // Open-Meteo (reanálisis ERA5), respuesta diaria de varios años → promedios mensuales.
  // Es el respaldo cuando NASA POWER no responde o no trae los 12 meses.
  function parseOpenMeteo(json) {
    var d = json && json.daily;
    if (!d || !Array.isArray(d.time)) throw new Error('Respuesta inesperada de Open-Meteo');
    var tx = d.temperature_2m_max, tn = d.temperature_2m_min;
    var tArr = Array.isArray(d.temperature_2m_mean) ? d.temperature_2m_mean :
      (Array.isArray(tx) && Array.isArray(tn) ? tx.map(function (v, i) { return isNum(v) && isNum(tn[i]) ? (v + tn[i]) / 2 : null; }) : null);
    var pr = Array.isArray(d.precipitation_sum) ? d.precipitation_sum : null;
    if (!tArr && !pr) throw new Error('Open-Meteo no devolvió temperatura ni lluvia');
    var tSum = [], tN = [], ym = {}, years = {}, i, m;
    for (m = 0; m < 12; m++) { tSum.push(0); tN.push(0); }
    for (i = 0; i < d.time.length; i++) {
      var mt = /^(\d{4})-(\d{2})-/.exec(String(d.time[i]));
      if (!mt) continue;
      var y = +mt[1]; m = +mt[2] - 1; years[y] = true;
      if (tArr && isNum(tArr[i])) { tSum[m] += tArr[i]; tN[m]++; }
      if (pr && isNum(pr[i])) { var k = y * 12 + m; (ym[k] = ym[k] || { s: 0, n: 0 }); ym[k].s += pr[i]; ym[k].n++; }
    }
    var out = { T: null, monthlyT: null, P: null, monthlyP: null, elevCell: isNum(json.elevation) ? json.elevation : null, source: 'Open-Meteo (reanálisis ERA5)', years: null };
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return a - b; });
    if (ys.length) out.years = [ys[0], ys[ys.length - 1]];
    if (tArr && tN.every(function (n) { return n >= 28; })) {
      out.monthlyT = tSum.map(function (v, j) { return v / tN[j]; });
      out.T = mean(out.monthlyT);
    }
    if (pr) {
      var per = [[], [], [], [], [], [], [], [], [], [], [], []];
      Object.keys(ym).forEach(function (key) {
        var kk = +key, yy = Math.floor(kk / 12), mo = kk % 12, o = ym[key];
        var dim = new Date(Date.UTC(yy, mo + 1, 0)).getUTCDate();
        if (o.n >= dim - 3) per[mo].push(o.s * dim / o.n);                 // mes casi completo; se escala si faltan días
      });
      if (per.every(function (a) { return a.length >= 2; })) {
        out.monthlyP = per.map(mean);
        out.P = sum(out.monthlyP);
      }
    }
    if (out.T === null && out.P === null) throw new Error('Open-Meteo no devolvió suficientes datos para este punto');
    return out;
  }

  function withTimeout(fetchFn, url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    return fetchFn(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // Devuelve { elevation, pointElevations, climate, errors[], notes[] }; cada parte puede fallar sin tumbar la otra.
  // opts.points: [{lat, lon}] para traer también la altitud de cada punto (una sola consulta, hasta 99 puntos).
  // El clima se pide primero a NASA POWER; si no responde o no trae los 12 meses, se usa Open-Meteo (años recientes).
  function fetchOnline(lat, lon, fetchFn, opts) {
    opts = opts || {};
    var f = fetchFn || (typeof fetch !== 'undefined' ? function (u, o) { return fetch(u, o); } : null);   // el fetch del navegador (o de Node)
    var ms = opts.timeoutMs || 20000;
    var res = { elevation: null, pointElevations: null, climate: null, errors: [], notes: [] };
    if (!f) { res.errors.push('Este dispositivo no puede hacer consultas de red.'); return Promise.resolve(res); }
    var pts = (opts.points || []).slice(0, 99);
    var la = [lat].concat(pts.map(function (p) { return p.lat; })).map(function (v) { return v.toFixed(5); }).join(',');
    var lo = [lon].concat(pts.map(function (p) { return p.lon; })).map(function (v) { return v.toFixed(5); }).join(',');
    var pElev = withTimeout(f, 'https://api.open-meteo.com/v1/elevation?latitude=' + la + '&longitude=' + lo, ms)
      .then(function (j) {
        var e = j && j.elevation;
        if (!Array.isArray(e) || !isNum(e[0])) throw new Error('sin dato de elevación');
        res.elevation = e[0];
        res.pointElevations = e.slice(1).map(function (v) { return isNum(v) ? v : null; });
      }).catch(function (e) { res.errors.push('Altitud: ' + (e && e.message || e)); });
    var nasaErr = null;
    var pClim = withTimeout(f, 'https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=' +
      lon.toFixed(5) + '&latitude=' + lat.toFixed(5) + '&format=JSON', ms)
      .then(function (j) { res.climate = parsePower(j); })
      .catch(function (e) { nasaErr = e && e.message || String(e); })
      .then(function () {
        var c = res.climate;
        if (c && c.monthlyT && c.monthlyP) return null;                     // NASA completo
        var y = (opts.year || new Date().getFullYear()) - 1;                // último año completo
        var base = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat.toFixed(5) + '&longitude=' + lon.toFixed(5) +
          '&start_date=' + (y - 9) + '-01-01&end_date=' + y + '-12-31&timezone=GMT&daily=';
        var ask = function (vars) { return withTimeout(f, base + vars, Math.max(ms, 40000)).then(parseOpenMeteo); };
        return ask('temperature_2m_mean,precipitation_sum')
          .catch(function () { return ask('temperature_2m_max,temperature_2m_min,precipitation_sum'); })
          .then(function (o) {
            if (c && !(o.monthlyT && o.monthlyP)) return;                   // el respaldo tampoco completa: se queda lo de NASA
            res.climate = o;
            res.notes.push(c ? 'NASA POWER no trajo los 12 meses; se usaron datos de Open-Meteo (' + o.source + ', ' + o.years[0] + '–' + o.years[1] + ').'
                             : 'NASA POWER no respondió' + (nasaErr ? ' (' + nasaErr + ')' : '') + '; se usaron datos de Open-Meteo (' + o.source + ', ' + o.years[0] + '–' + o.years[1] + ').');
          })
          .catch(function (e2) {
            res.errors.push('Clima: ' + (nasaErr ? 'NASA POWER: ' + nasaErr + '. ' : '') + 'Open-Meteo: ' + (e2 && e2.message || e2));
          });
      });
    return Promise.all([pElev, pClim]).then(function () {
      if (res.climate && !res.climate.monthlyT) res.notes.push('Los datos de internet no traen los 12 meses de temperatura: el diagrama de Walter-Lieth necesita escribirlos a mano.');
      return res;
    });
  }

  return {
    LAPSE: LAPSE, T0_EQUATOR: T0_EQUATOR,
    seaLevelTemp: seaLevelTemp, estimateT: estimateT, estimateUncertainty: estimateUncertainty,
    Memory: Memory, resolve: resolve, parseCSV: parseCSV, parsePower: parsePower, parseOpenMeteo: parseOpenMeteo, fetchOnline: fetchOnline
  };
});

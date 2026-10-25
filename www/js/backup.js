/* backup.js — copia de seguridad y restauración de todos los proyectos (puntos, capas, clima y ajustes).
 *
 * El archivo es un JSON { app, format, created, summary, state: { projects, currentId, settings }, memory }.
 * Al restaurar NO se copia nada tal cual: validate() reconstruye cada proyecto, punto y capa solo con los campos
 * conocidos y valores dentro de rango, así un archivo dañado o manipulado no puede romper la app.
 * Modos al restaurar: 'replace' (reemplaza todo) y 'merge' (suma los proyectos a los que ya hay). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Backup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APP = 'zonas-de-vida-gps', FORMAT = 1;
  var LIM = { projects: 500, points: 20000, layers: 500, layerPoints: 150000, memory: 100000 };
  var ALT_SRC = ['gps', 'manual', 'internet', 'archivo'];
  var PT_SRC = ['gps', 'manual', 'archivo'];
  var KINDS = ['polygon', 'line', 'points'];
  var UNITS = ['ha', 'm2', 'km2', 'fanegadas'];
  var MIN_ACC = [0, 3, 5, 10, 20];
  var MAIN_COLOR = '#2F8F4E', LAYER_COLOR = '#E67E22';

  function uidDefault() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null; }
  function str(v, max, dflt) {
    if (typeof v !== 'string' && typeof v !== 'number') return dflt;
    var s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    return s || dflt;
  }
  function hex(v, dflt) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : dflt; }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function series(v, lo, hi, nullable) {
    if (!Array.isArray(v) || v.length !== 12) return null;
    var out = v.map(function (x) { return num(x, lo, hi); });
    if (!nullable && out.some(function (x) { return x === null; })) return null;
    return out;
  }
  function validLL(lat, lon) { return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }

  /* ---------- Limpieza de cada estructura ---------- */
  function Cleaner(uid, now) { this.uid = uid; this.now = now; this.drop = { points: 0, layerPoints: 0, layers: 0, memory: 0, ids: 0 }; this.used = {}; }
  Cleaner.prototype.id = function (v) {
    if (typeof v === 'string' && /^[A-Za-z0-9_\-]{1,40}$/.test(v) && !has(this.used, v)) { this.used[v] = true; return v; }
    if (typeof v === 'string' && v) this.drop.ids++;
    var n; do { n = this.uid(); } while (has(this.used, n));
    this.used[n] = true; return n;
  };

  Cleaner.prototype.point = function (p, i) {
    p = obj(p);
    if (!p || !validLL(p.lat, p.lon)) { this.drop.points++; return null; }
    var alt = num(p.alt, -1000, 12000);
    var out = {
      id: this.id(p.id), name: str(p.name, 80, 'P' + (i + 1)), lat: p.lat, lon: p.lon, alt: alt,
      altGps: num(p.altGps, -1000, 12000), altSrc: alt === null ? null : oneOf(p.altSrc, ALT_SRC, 'manual'),
      acc: num(p.acc, 0, 100000), altAcc: num(p.altAcc, 0, 100000), src: oneOf(p.src, PT_SRC, 'manual'), ts: num(p.ts, 0, 8.64e15) || this.now
    };
    if (p.lowAcc === true) out.lowAcc = true;
    return out;
  };

  Cleaner.prototype.layerPoint = function (p) {
    p = obj(p);
    if (!p || !validLL(p.lat, p.lon)) { this.drop.layerPoints++; return null; }
    var o = { lat: p.lat, lon: p.lon, alt: num(p.alt, -1000, 12000) };
    var nm = str(p.name, 80, '');
    if (nm) o.name = nm;
    return o;
  };

  Cleaner.prototype.layer = function (l, budget) {
    l = obj(l);
    if (!l || !Array.isArray(l.points)) { this.drop.layers++; return null; }
    var self = this, kind = oneOf(l.kind, KINDS, 'polygon');
    var pts = [];
    for (var i = 0; i < l.points.length && budget.n < LIM.layerPoints; i++) { var q = self.layerPoint(l.points[i]); if (q) { pts.push(q); budget.n++; } }
    var min = kind === 'polygon' ? 3 : kind === 'line' ? 2 : 1;
    if (pts.length < min) { this.drop.layers++; return null; }
    var out = { id: this.id(l.id), name: str(l.name, 80, 'Capa importada'), kind: kind, color: hex(l.color, LAYER_COLOR), visible: l.visible !== false,
                points: pts, file: str(l.file, 120, ''), ts: num(l.ts, 0, 8.64e15) || this.now };
    if (kind === 'polygon' && Array.isArray(l.holes)) {
      var hs = [];
      l.holes.slice(0, 200).forEach(function (h) {
        if (!Array.isArray(h)) return;
        var hp = [];
        for (var k = 0; k < h.length && budget.n < LIM.layerPoints; k++) { var q2 = self.layerPoint(h[k]); if (q2) { hp.push(q2); budget.n++; } }
        if (hp.length >= 3) hs.push(hp);
      });
      if (hs.length) out.holes = hs;
    }
    return out;
  };

  function cleanClimate(c) {
    var out = {};
    c = obj(c);
    if (!c) return out;
    var v;
    if ((v = num(c.tManual, -40, 45)) !== null) out.tManual = v;
    if ((v = num(c.pManual, 0, 15000)) !== null && v > 0) out.pManual = v;
    if ((v = num(c.altOverride, -450, 9000)) !== null) out.altOverride = v;
    var o = obj(c.online);
    if (o) {
      var on = { T: num(o.T, -60, 60), P: num(o.P, 0, 60000), monthlyT: series(o.monthlyT, -60, 60, false), monthlyP: series(o.monthlyP, 0, 5000, false),
                 elevCell: num(o.elevCell, -1000, 12000), elevation: num(o.elevation, -1000, 12000), date: num(o.date, 0, 8.64e15), lat: num(o.lat, -90, 90), lon: num(o.lon, -180, 180), source: str(o.source, 60, null) };
      if (on.T !== null || on.P !== null || on.monthlyT || on.monthlyP || on.elevation !== null) out.online = on;
    }
    var m = obj(c.monthlyManual);
    if (m) {
      var mm = { T: series(m.T, -60, 60, true), P: series(m.P, 0, 5000, true) };
      if ((mm.T && mm.T.some(function (x) { return x !== null; })) || (mm.P && mm.P.some(function (x) { return x !== null; }))) out.monthlyManual = mm;
    }
    return out;
  }

  Cleaner.prototype.project = function (p, budget) {
    p = obj(p);
    if (!p) return null;
    var self = this, pts = [], layers = [];
    (Array.isArray(p.points) ? p.points : []).slice(0, LIM.points).forEach(function (q, i) { var c = self.point(q, i); if (c) pts.push(c); });
    (Array.isArray(p.layers) ? p.layers : []).slice(0, LIM.layers).forEach(function (l) { var c = self.layer(l, budget); if (c) layers.push(c); });
    var nxt = typeof p.nextPoint === 'number' && isFinite(p.nextPoint) && p.nextPoint >= 1 && p.nextPoint <= 1e7 ? Math.floor(p.nextPoint) : 0;
    return { id: this.id(p.id), name: str(p.name, 60, 'Proyecto sin nombre'), created: num(p.created, 0, 8.64e15) || this.now, points: pts,
             climate: cleanClimate(p.climate), nextPoint: Math.max(nxt, pts.length + 1), layers: layers, mainColor: hex(p.mainColor, MAIN_COLOR) };
  };

  function cleanSettings(s) {
    s = obj(s) || {};
    return { areaUnit: oneOf(s.areaUnit, UNITS, 'ha'), minAcc: oneOf(s.minAcc, MIN_ACC, 10), csvStyle: oneOf(s.csvStyle, ['es', 'std'], 'es') };
  }

  function cleanMemory(arr, drop) {
    var out = [];
    (Array.isArray(arr) ? arr : []).slice(0, LIM.memory).forEach(function (r) {
      r = obj(r);
      if (!r || !validLL(r.lat, r.lon)) { drop.memory++; return; }
      var T = num(r.T, -60, 60), P = num(r.P, 0, 60000);
      if (T === null && P === null) { drop.memory++; return; }
      var o = { lat: r.lat, lon: r.lon, T: T, P: P, alt: num(r.alt, -1000, 12000), src: str(r.src, 20, 'paquete') };
      var nm = str(r.name, 60, '');
      if (nm) o.name = nm;
      var d = num(r.date, 0, 8.64e15);
      if (d !== null) o.date = d;
      out.push(o);
    });
    return out;
  }

  /* ---------- Crear ---------- */
  function counts(projects) {
    var s = { projects: projects.length, points: 0, layers: 0 };
    projects.forEach(function (p) { s.points += (p.points || []).length; s.layers += (p.layers || []).length; });
    return s;
  }

  // state: { projects, currentId, settings }; memory: registros de clima guardados en el equipo
  function create(state, memory, meta) {
    meta = meta || {};
    var projects = JSON.parse(JSON.stringify(state.projects || []));
    return {
      app: APP, format: FORMAT, appVersion: meta.appVersion || '', created: new Date(meta.now || Date.now()).toISOString(),
      summary: counts(projects),
      state: { projects: projects, currentId: state.currentId, settings: JSON.parse(JSON.stringify(state.settings || {})) },
      memory: JSON.parse(JSON.stringify(memory || []))
    };
  }
  function stringify(b) { return JSON.stringify(b); }
  function fileName(now) {
    var d = new Date(now || Date.now()), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'zonas-de-vida-copia-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
  }

  /* ---------- Validar ---------- */
  // raw: objeto ya leído del JSON. Devuelve { ok, errors[], warnings[], data, summary, created }
  function validate(raw, opts) {
    opts = opts || {};
    var uid = opts.uid || uidDefault, now = opts.now || Date.now();
    var res = { ok: false, errors: [], warnings: [], data: null, summary: null, created: null };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.errors.push('El archivo no tiene el formato de una copia de seguridad.'); return res; }
    if (raw.app !== APP) { res.errors.push('Este archivo no es una copia de seguridad de Zonas de Vida.'); return res; }
    if (typeof raw.format !== 'number' || !(raw.format >= 1)) { res.errors.push('La copia no indica su versión de formato.'); return res; }
    if (raw.format > FORMAT) { res.errors.push('La copia se hizo con una versión más nueva de la app (formato ' + raw.format + '). Actualiza la app para restaurarla.'); return res; }
    var st = obj(raw.state);
    if (!st || !Array.isArray(st.projects)) { res.errors.push('La copia no contiene la lista de proyectos.'); return res; }
    if (!st.projects.length) { res.errors.push('La copia no tiene ningún proyecto.'); return res; }
    if (st.projects.length > LIM.projects) { res.errors.push('La copia tiene demasiados proyectos (máximo ' + LIM.projects + ').'); return res; }

    var cl = new Cleaner(uid, now), budget = { n: 0 }, projects = [];
    st.projects.forEach(function (p) { var c = cl.project(p, budget); if (c) projects.push(c); });
    if (!projects.length) { res.errors.push('Ningún proyecto de la copia se pudo leer.'); return res; }
    if (projects.length < st.projects.length) res.warnings.push((st.projects.length - projects.length) + ' proyecto(s) dañado(s) se omitieron.');
    if (cl.drop.points) res.warnings.push(cl.drop.points + ' punto(s) con coordenadas no válidas se omitieron.');
    if (cl.drop.layers) res.warnings.push(cl.drop.layers + ' capa(s) vacía(s) o dañada(s) se omitieron.');
    if (cl.drop.layerPoints) res.warnings.push(cl.drop.layerPoints + ' punto(s) de capas con coordenadas no válidas se omitieron.');
    if (cl.drop.ids) res.warnings.push('Se corrigieron ' + cl.drop.ids + ' identificador(es) repetido(s) o no válido(s).');
    if (budget.n >= LIM.layerPoints) res.warnings.push('Las capas eran muy grandes: se leyeron solo los primeros ' + LIM.layerPoints + ' puntos.');
    var memDrop = { memory: 0 };
    var memory = cleanMemory(raw.memory, memDrop);
    if (memDrop.memory) res.warnings.push(memDrop.memory + ' dato(s) de clima no válidos se omitieron.');

    var currentId = projects.some(function (p) { return p.id === st.currentId; }) ? st.currentId : projects[0].id;
    res.data = { projects: projects, currentId: currentId, settings: cleanSettings(st.settings), memory: memory };
    res.summary = counts(projects);
    res.summary.memory = memory.length;
    var t = typeof raw.created === 'string' ? Date.parse(raw.created) : NaN;
    res.created = isFinite(t) ? t : null;
    res.ok = true;
    return res;
  }

  /* ---------- Aplicar ---------- */
  // Texto con las claves ordenadas: dos proyectos iguales dan el mismo texto aunque los campos estén en otro orden
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function sameMem(a, b) { return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lon.toFixed(5) === b.lon.toFixed(5) && a.T === b.T && a.P === b.P && a.src === b.src; }

  // current: { state, memory }; data: res.data de validate(); mode: 'replace' | 'merge'
  function apply(current, data, mode, opts) {
    opts = opts || {};
    var uid = opts.uid || uidDefault;
    if (mode !== 'merge') {
      return { state: { v: 1, projects: data.projects, currentId: data.currentId, settings: data.settings }, memory: data.memory, added: data.projects.length, skipped: 0, renamed: 0 };
    }
    var st = current.state, ids = {}, sig = {};
    st.projects.forEach(function (p) { ids[p.id] = true; sig[p.id] = canon(p); });
    var added = [], skipped = 0, renamed = 0;
    data.projects.forEach(function (p) {
      if (has(ids, p.id) && sig[p.id] === canon(p)) { skipped++; return; }
      var q = JSON.parse(JSON.stringify(p));
      if (has(ids, q.id)) {
        do { q.id = uid(); } while (has(ids, q.id));
        q.name = str(q.name + ' (restaurado)', 60, q.name);
        renamed++;
      }
      ids[q.id] = true;
      added.push(q);
    });
    var mem = (current.memory || []).slice();
    data.memory.forEach(function (r) { if (!mem.some(function (m) { return sameMem(m, r); })) mem.push(r); });
    return {
      state: { v: 1, projects: st.projects.concat(added), currentId: st.currentId, settings: st.settings },
      memory: mem, added: added.length, skipped: skipped, renamed: renamed
    };
  }

  return { APP: APP, FORMAT: FORMAT, LIMITS: LIM, create: create, stringify: stringify, fileName: fileName, validate: validate, apply: apply, cleanSettings: cleanSettings, cleanClimate: cleanClimate };
});

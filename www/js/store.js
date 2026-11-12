/* store.js — datos guardados en el dispositivo (localStorage), siempre con try/catch.
 * Si el almacenamiento no está disponible la app sigue funcionando con los datos en memoria. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fotos.js'));
  else root.Store = factory(root.Fotos);
})(typeof self !== 'undefined' ? self : this, function (Fotos) {
  'use strict';

  var KEY_STATE = 'zvg.v1.state';
  var KEY_MEM = 'zvg.v1.memory';
  var KEY_FLAGS = 'zvg.v1.flags';
  var MAIN_COLOR = '#2F8F4E';
  var MIN_ACC = [0, 3, 5, 10, 20];
  var DEFAULT_SETTINGS = { areaUnit: 'ha', minAcc: 10, csvStyle: 'es' };
  var mem = {};          // respaldo si localStorage falla
  var storage = null;
  try { storage = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { storage = null; }

  // Cambiar de almacenamiento también vacía el respaldo en memoria (así las pruebas arrancan limpias)
  function setBackend(s) { storage = s; mem = {}; }
  function read(key) {
    try { if (storage) { var v = storage.getItem(key); if (v !== null) return JSON.parse(v); } } catch (e) { /* cae al respaldo */ }
    return Object.prototype.hasOwnProperty.call(mem, key) ? JSON.parse(mem[key]) : null;
  }
  function write(key, value) {
    var s = JSON.stringify(value);
    mem[key] = s;
    try { if (storage) { storage.setItem(key, s); return { ok: true }; } } catch (e) { return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'Sin espacio para guardar.' : 'No se pudo guardar en el dispositivo.' }; }
    return { ok: false, error: 'Este navegador no permite guardar datos; se perderán al cerrar.' };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- Lotes (2.15.0) ----------
   * Un proyecto guarda uno o más lotes: { id, name, created, layers, lots: [lote…], lotId }. Cada lote tiene sus propios puntos, clima y color:
   * { id, name, points, climate, nextPoint, mainColor, weatherNow? }. Para que el resto de la app siga leyendo y escribiendo
   * proyecto.points, .climate, .nextPoint, .mainColor y .weatherNow, esos cinco nombres son «atajos» al lote elegido (lotId):
   * no se guardan dos veces (al guardar solo va la lista de lotes). Los proyectos de versiones anteriores pasan a tener un «Lote 1». */
  var LOT_KEYS = ['points', 'climate', 'nextPoint', 'mainColor', 'weatherNow'];
  var LOT_MAX = 30, LOT_NAME_MAX = 40;
  var HEX = /^#[0-9a-fA-F]{6}$/;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function lotName(v, i) { var s = typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LOT_NAME_MAX) : ''; return s || 'Lote ' + (i + 1); }
  function newLot(name, color) { return { id: uid(), name: lotName(name, 0), points: [], climate: {}, nextPoint: 1, mainColor: HEX.test(color || '') ? color : MAIN_COLOR }; }
  function cleanLot(l, i) {
    l.id = typeof l.id === 'string' && l.id ? l.id : uid();
    l.name = lotName(l.name, i);
    l.points = Array.isArray(l.points) ? l.points : [];
    l.climate = isObj(l.climate) ? l.climate : {};
    l.nextPoint = typeof l.nextPoint === 'number' && isFinite(l.nextPoint) ? l.nextPoint : l.points.length + 1;
    l.mainColor = HEX.test(l.mainColor) ? l.mainColor : MAIN_COLOR;
    if (!isObj(l.weatherNow)) delete l.weatherNow;                    // clima actual consultado (2.5.0)
    l.points.forEach(function (pt) {                                  // fotos de cada punto (2.5.0): solo la lista de ids; la imagen vive aparte
      if (!pt || typeof pt !== 'object' || pt.photos === undefined) return;
      var ph = Fotos.cleanList(pt.photos);
      if (ph.length) pt.photos = ph; else delete pt.photos;
    });
    return l;
  }
  // Proyecto «plano» (sin atajos) con su lista de lotes. Uno de una versión anterior pasa a tener un solo lote, con un id que sale del id
  // del proyecto (así, restaurar dos veces la misma copia vieja da lo mismo y no duplica el proyecto).
  function toLots(p) {
    if (!Array.isArray(p.lots) || !p.lots.some(isObj)) {
      var l = { id: String(p.id || uid()) + '-l1', name: 'Lote 1', points: p.points, climate: p.climate, nextPoint: p.nextPoint, mainColor: p.mainColor };
      if (p.weatherNow !== undefined) l.weatherNow = p.weatherNow;
      p.lots = [l];
    }
    p.lots = p.lots.filter(isObj).slice(0, LOT_MAX).map(cleanLot);
    var seen = {};
    p.lots.forEach(function (l) { if (seen[l.id]) l.id = uid(); seen[l.id] = true; });
    if (!p.lots.some(function (l) { return l.id === p.lotId; })) p.lotId = p.lots[0].id;
    return p;
  }
  function activeLot(p) { for (var i = 0; i < p.lots.length; i++) if (p.lots[i].id === p.lotId) return p.lots[i]; return p.lots[0]; }
  // Pone los atajos al lote elegido. Se puede llamar más de una vez sobre el mismo proyecto.
  function lotify(p) {
    var plain = Object.getOwnPropertyDescriptor(p, 'toJSON');
    if (plain && plain.value && plain.value.zvLots) { toLots(p); return p; }       // ya tiene los atajos
    toLots(p);
    LOT_KEYS.forEach(function (k) {
      delete p[k];
      Object.defineProperty(p, k, {
        enumerable: true, configurable: false,
        get: function () { return activeLot(p)[k]; },
        set: function (v) { var l = activeLot(p); if (v === undefined) delete l[k]; else l[k] = v; }
      });
    });
    var toJSON = function () {            // al guardar: todo menos los atajos
      var o = {}, self = this;
      Object.keys(self).forEach(function (k) { if (LOT_KEYS.indexOf(k) < 0) o[k] = self[k]; });
      return o;
    };
    toJSON.zvLots = true;
    Object.defineProperty(p, 'toJSON', { value: toJSON, enumerable: false, configurable: false, writable: false });
    return p;
  }

  function newProject(name) {
    return lotify({ id: uid(), name: name || 'Proyecto sin nombre', created: Date.now(), layers: [], lots: [newLot('Lote 1')] });
  }

  function defaultState() {
    var p = newProject('Mi primer proyecto');
    return { v: 1, projects: [p], currentId: p.id, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }

  function loadState() {
    var s = read(KEY_STATE);
    if (!s || !Array.isArray(s.projects) || !s.projects.length) return defaultState();
    s.projects = s.projects.filter(isObj);
    if (!s.projects.length) return defaultState();
    s.projects.forEach(function (p) {
      p.layers = Array.isArray(p.layers) ? p.layers.filter(function (l) { return l && Array.isArray(l.points); }) : [];
      lotify(p);
    });
    if (!s.projects.some(function (p) { return p.id === s.currentId; })) s.currentId = s.projects[0].id;
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    if (MIN_ACC.indexOf(s.settings.minAcc) < 0) s.settings.minAcc = DEFAULT_SETTINGS.minAcc;
    if (s.settings.csvStyle !== 'es' && s.settings.csvStyle !== 'std') s.settings.csvStyle = 'es';
    delete s.settings.holdMs;     // ajuste que existió en la 2.4.0 («Tiempo para levantar un punto»): ya no se ofrece, el tiempo es fijo
    return s;
  }
  function saveState(s) { return write(KEY_STATE, s); }
  function hasSavedState() { var s = read(KEY_STATE); return !!(s && Array.isArray(s.projects) && s.projects.length); }   // ¿hay datos guardados de verdad (y no los de un primer arranque)?
  function loadMemory() { var m = read(KEY_MEM); return Array.isArray(m) ? m : []; }
  function saveMemory(arr) { return write(KEY_MEM, arr); }

  // Marcas pequeñas de este equipo (por ejemplo, la capa de mapa elegida). No entran en la copia de seguridad.
  function flagBag() { var f = read(KEY_FLAGS); return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; }
  function loadFlag(name) { var f = flagBag(); return Object.prototype.hasOwnProperty.call(f, name) ? f[name] : null; }
  function saveFlag(name, value) { var f = flagBag(); f[name] = value; return write(KEY_FLAGS, f); }

  /* ---------- Autor del reporte (2.14.0): nombre, entidad y logo que salen en el encabezado del reporte ---------- */
  // Se guarda aparte del estado (el logo es una imagen) y no viaja en las copias de seguridad.
  var KEY_AUTHOR = 'zvg.v1.author';
  var AUTHOR_MAX = 80, LOGO_MAX = 200000;          // largo del nombre y de la entidad; el logo en base64 (unos 150 KB de JPEG)
  var B64 = /^[A-Za-z0-9+/]+={0,2}$/;
  function cleanText(v) { return typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, AUTHOR_MAX) : ''; }
  function cleanAuthor(a) {
    a = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
    var logo = typeof a.logo === 'string' && a.logo.length <= LOGO_MAX && a.logo.length % 4 === 0 && B64.test(a.logo) && a.logo.indexOf('/9j/') === 0 ? a.logo : '';   // solo JPEG («/9j/» es FF D8 FF)
    return { name: cleanText(a.name), org: cleanText(a.org), logo: logo };
  }
  function loadAuthor() { return cleanAuthor(read(KEY_AUTHOR)); }
  function saveAuthor(a) { return write(KEY_AUTHOR, cleanAuthor(a)); }

  return { lotify: lotify, toLots: toLots, newLot: newLot, activeLot: activeLot, lotName: lotName, LOT_MAX: LOT_MAX, LOT_NAME_MAX: LOT_NAME_MAX, LOT_KEYS: LOT_KEYS, loadAuthor: loadAuthor, saveAuthor: saveAuthor, cleanAuthor: cleanAuthor, AUTHOR_MAX: AUTHOR_MAX, LOGO_MAX: LOGO_MAX, loadState: loadState, saveState: saveState, hasSavedState: hasSavedState, loadMemory: loadMemory, saveMemory: saveMemory, loadFlag: loadFlag, saveFlag: saveFlag,
           newProject: newProject, uid: uid, setBackend: setBackend, defaultState: defaultState, MAIN_COLOR: MAIN_COLOR, MIN_ACC: MIN_ACC };
});

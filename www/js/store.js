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

  function newProject(name) {
    return { id: uid(), name: name || 'Proyecto sin nombre', created: Date.now(), points: [], climate: {}, nextPoint: 1, layers: [], mainColor: MAIN_COLOR };
  }

  function defaultState() {
    var p = newProject('Mi primer proyecto');
    return { v: 1, projects: [p], currentId: p.id, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }

  function loadState() {
    var s = read(KEY_STATE);
    if (!s || !Array.isArray(s.projects) || !s.projects.length) return defaultState();
    s.projects.forEach(function (p) {
      p.points = Array.isArray(p.points) ? p.points : [];
      p.climate = p.climate || {};
      p.nextPoint = p.nextPoint || (p.points.length + 1);
      p.layers = Array.isArray(p.layers) ? p.layers.filter(function (l) { return l && Array.isArray(l.points); }) : [];
      p.mainColor = /^#[0-9a-fA-F]{6}$/.test(p.mainColor) ? p.mainColor : MAIN_COLOR;
      if (!p.weatherNow || typeof p.weatherNow !== 'object' || Array.isArray(p.weatherNow)) delete p.weatherNow;   // clima actual consultado (2.5.0)
      p.points.forEach(function (pt) {      // fotos de cada punto (2.5.0): solo la lista de ids; la imagen vive aparte
        if (!pt || typeof pt !== 'object' || pt.photos === undefined) return;
        var l = Fotos.cleanList(pt.photos);
        if (l.length) pt.photos = l; else delete pt.photos;
      });
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

  return { loadAuthor: loadAuthor, saveAuthor: saveAuthor, cleanAuthor: cleanAuthor, AUTHOR_MAX: AUTHOR_MAX, LOGO_MAX: LOGO_MAX, loadState: loadState, saveState: saveState, hasSavedState: hasSavedState, loadMemory: loadMemory, saveMemory: saveMemory, loadFlag: loadFlag, saveFlag: saveFlag,
           newProject: newProject, uid: uid, setBackend: setBackend, defaultState: defaultState, MAIN_COLOR: MAIN_COLOR, MIN_ACC: MIN_ACC };
});

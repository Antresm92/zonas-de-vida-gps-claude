/* store.js — datos guardados en el dispositivo (localStorage), siempre con try/catch.
 * Si el almacenamiento no está disponible la app sigue funcionando con los datos en memoria. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
    });
    if (!s.projects.some(function (p) { return p.id === s.currentId; })) s.currentId = s.projects[0].id;
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    if (MIN_ACC.indexOf(s.settings.minAcc) < 0) s.settings.minAcc = DEFAULT_SETTINGS.minAcc;
    if (s.settings.csvStyle !== 'es' && s.settings.csvStyle !== 'std') s.settings.csvStyle = 'es';
    return s;
  }
  function saveState(s) { return write(KEY_STATE, s); }
  function loadMemory() { var m = read(KEY_MEM); return Array.isArray(m) ? m : []; }
  function saveMemory(arr) { return write(KEY_MEM, arr); }

  // Marcas pequeñas de este equipo (por ejemplo, la capa de mapa elegida). No entran en la copia de seguridad.
  function flagBag() { var f = read(KEY_FLAGS); return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; }
  function loadFlag(name) { var f = flagBag(); return Object.prototype.hasOwnProperty.call(f, name) ? f[name] : null; }
  function saveFlag(name, value) { var f = flagBag(); f[name] = value; return write(KEY_FLAGS, f); }

  return { loadState: loadState, saveState: saveState, loadMemory: loadMemory, saveMemory: saveMemory, loadFlag: loadFlag, saveFlag: saveFlag,
           newProject: newProject, uid: uid, setBackend: setBackend, defaultState: defaultState, MAIN_COLOR: MAIN_COLOR, MIN_ACC: MIN_ACC };
});

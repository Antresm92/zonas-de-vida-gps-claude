/* web.js — avisos de la versión web (la app abierta en un navegador, no instalada como APK).
 * Lógica pura y probada: decide qué avisos mostrar y pide al navegador que no borre los datos solo.
 * `env` describe el entorno: { native, secure, geolocation, storage }. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Web = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REMIND_MS = 7 * 24 * 3600 * 1000;   // el aviso informativo, si lo cierras, vuelve a los 7 días

  function isWeb(env) { return !(env && env.native); }

  // Avisos de la versión web. Los de nivel «warn» son problemas reales y nunca se ocultan.
  function notes(env) {
    if (!isWeb(env)) return [];
    var out = [{
      level: 'info',
      title: 'Estás usando la versión web',
      text: 'Tus proyectos se guardan solo en este navegador, en este equipo: si borras los datos del sitio o cambias de navegador o de teléfono, no estarán. Haz copias de seguridad (menú de proyectos › Exportar copia de seguridad).'
    }];
    if (env.secure === false) {
      out.push({ level: 'warn', title: 'Esta página no usa HTTPS', text: 'El GPS del navegador no funciona sin HTTPS. Abre la dirección que empieza con https://. Mientras tanto puedes escribir las coordenadas a mano.' });
    }
    if (env.geolocation === false) {
      out.push({ level: 'warn', title: 'Este navegador no ofrece GPS', text: 'Puedes escribir las coordenadas a mano o abrir la app en otro navegador.' });
    }
    return out;
  }

  // Lo que se muestra ahora: { notes, canDismiss } o null si no hay nada que mostrar.
  // dismissedAt: momento (ms) en que se cerró el aviso informativo, o null.
  function banner(env, dismissedAt, now) {
    var all = notes(env);
    if (!all.length) return null;
    var silenced = typeof dismissedAt === 'number' && isFinite(dismissedAt) && dismissedAt <= now && now - dismissedAt < REMIND_MS;
    var shown = all.filter(function (n) { return n.level === 'warn' || !silenced; });
    if (!shown.length) return null;
    return { notes: shown, canDismiss: shown.some(function (n) { return n.level === 'info'; }) };
  }

  // Frase para la ventana de proyectos. persisted: true | false | null (el navegador no lo dice).
  function storageNote(persisted) {
    var t = 'Versión web: tus proyectos viven en este navegador, no en un servidor. Si cambias de navegador o de teléfono, o borras los datos del sitio, no estarán; por eso conviene exportar una copia de seguridad.';
    if (persisted === true) t += ' El navegador marcó este almacenamiento como protegido contra la limpieza automática (no contra el borrado a mano).';
    else if (persisted === false) t += ' El navegador podría limpiar estos datos por su cuenta si se queda sin espacio.';
    return t;
  }

  // Pide al navegador que conserve los datos. Devuelve true | false, o null si no se puede saber.
  function requestPersist(env) {
    var st = env && env.storage;
    if (!isWeb(env) || !st || typeof st.persist !== 'function') return Promise.resolve(null);
    try {
      var already = typeof st.persisted === 'function' ? st.persisted() : false;
      return Promise.resolve(already)
        .then(function (yes) { return yes ? true : st.persist(); })
        .then(function (r) { return !!r; }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  return { isWeb: isWeb, notes: notes, banner: banner, storageNote: storageNote, requestPersist: requestPersist, REMIND_MS: REMIND_MS };
});

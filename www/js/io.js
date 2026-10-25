/* io.js — guardar, compartir y leer archivos en el teléfono (app Android) o en el navegador.
 * En la app se escribe el archivo en la carpeta temporal y se abre el menú "Compartir" de Android
 * (correo, Drive, WhatsApp, «Guardar en…»). En el navegador se descarga o se usa el menú de compartir del sistema. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.IO = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var env = root;                                   // el navegador (window); las pruebas lo reemplazan con setEnv
  function setEnv(e) { env = e || root; }

  // Nombre de archivo seguro: sin tildes, sin símbolos raros, con la extensión pedida
  function slug(name, ext) {
    var s = String(name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'archivo';
    return ext ? s + '.' + ext : s;
  }

  function capPlugin(name) {
    var cap = env.Capacitor;
    if (!cap || !(cap.isNativePlatform && cap.isNativePlatform())) return null;
    try { if (cap.Plugins && cap.Plugins[name]) return cap.Plugins[name]; if (cap.registerPlugin) return cap.registerPlugin(name); } catch (e) { /* nada */ }
    return null;
  }
  function isCancel(e) { return /cancel|abort|dismiss/i.test(String(e && e.name || '') + ' ' + String(e && e.message || e || '')); }

  function download(filename, blob) {
    var U = env.URL || URL, doc = env.document || document;
    var url = U.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = filename; doc.body.appendChild(a); a.click(); a.remove();
    var t = setTimeout(function () { U.revokeObjectURL(url); }, 4000);
    if (t && t.unref) t.unref();
    return { how: 'download', name: filename };
  }

  // Devuelve una promesa con { how: 'share' | 'download' | 'cancel', name }
  function saveText(filename, mime, text, opts) {
    opts = opts || {};
    var FS = capPlugin('Filesystem'), SH = capPlugin('Share');
    if (FS && SH) {
      return FS.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' })
        .then(function (w) { return SH.share({ title: opts.title || filename, text: opts.text || '', url: w.uri, dialogTitle: opts.dialogTitle || 'Compartir archivo' }); })
        .then(function () { return { how: 'share', name: filename }; }, function (e) { if (isCancel(e)) return { how: 'cancel', name: filename }; throw e; });
    }
    var blob = new Blob([text], { type: mime || 'text/plain' });
    try {
      var file = new File([blob], filename, { type: mime || 'text/plain' });
      var nav = env.navigator;
      if (nav && nav.canShare && nav.canShare({ files: [file] })) {
        return nav.share({ files: [file], title: opts.title || filename, text: opts.text || '' })
          .then(function () { return { how: 'share', name: filename }; }, function (e) { return isCancel(e) ? { how: 'cancel', name: filename } : download(filename, blob); });
      }
    } catch (e) { /* sigue con la descarga */ }
    return Promise.resolve(download(filename, blob));
  }

  function readBytes(file) {
    if (file && file.arrayBuffer) return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function readText(file) {
    return readBytes(file).then(function (b) { return new TextDecoder('utf-8').decode(b).replace(/^﻿/, ''); });
  }

  return { slug: slug, saveText: saveText, readBytes: readBytes, readText: readText, capPlugin: capPlugin, setEnv: setEnv };
});

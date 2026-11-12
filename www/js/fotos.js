/* fotos.js — fotos de los puntos (2.5.0).
 *
 *  · Cada punto guarda solo una lista corta de fotos: point.photos = [{ id, w, h, n, at }] (la primera es la principal).
 *  · La imagen se guarda aparte, en el teléfono (IndexedDB), porque el almacenamiento normal (localStorage) se llena con pocas fotos.
 *  · Cada foto se reduce antes de guardarse (máximo 1280 px por lado, JPEG): así pesa unos cientos de KB y, al volver a dibujarla,
 *    desaparece todo lo que traía el archivo original (la ubicación escondida en la foto, el modelo del teléfono…).
 *  · Sin dependencias: lo que toca el navegador (createImageBitmap, canvas, IndexedDB, URL) entra como parámetro para poder probarlo en Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Fotos = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX_PER_POINT = 5;                 // fotos por punto
  var MAX_SIDE = 1280, QUALITY = 0.82;   // lo que se guarda
  var REPORT_SIDE = 900, REPORT_QUALITY = 0.75;   // lo que va dentro del reporte compartido (pesa menos)
  var MAX_INPUT = 40 * 1024 * 1024;      // una foto original de más de 40 MB no se abre
  var MAX_PHOTO = 8 * 1024 * 1024;       // una foto ya reducida (o una que viene en una copia de seguridad) no puede pesar más
  var DB_NAME = 'zvg.v1.photos', STORE = 'fotos';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isId(v) { return typeof v === 'string' && v !== '__proto__' && /^[A-Za-z0-9_\-]{1,40}$/.test(v); }
  function newId() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function isJpeg(b) { return !!b && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF; }
  function intIn(v, lo, hi) { return isNum(v) && Math.floor(v) === v && v >= lo && v <= hi ? v : null; }

  // Medidas de la foto reducida: no se agranda nunca, y se conserva la proporción
  function fit(w, h, max) {
    var big = Math.max(w, h);
    if (!(big > max)) return { w: w, h: h };
    var k = max / big;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // Lista de fotos de un punto, limpia: solo ids válidos y distintos, números dentro de rango, como máximo MAX_PER_POINT.
  // has: opcional; función (id) → true si la imagen existe (al restaurar una copia, solo cuentan las que vienen dentro).
  function cleanList(list, has) {
    var out = [], seen = {};
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < MAX_PER_POINT; i++) {
      var f = list[i];
      if (!f || typeof f !== 'object' || !isId(f.id) || Object.prototype.hasOwnProperty.call(seen, f.id)) continue;
      if (has && !has(f.id)) continue;
      seen[f.id] = true;
      out.push({ id: f.id, w: intIn(f.w, 1, 30000), h: intIn(f.h, 1, 30000), n: intIn(f.n, 1, MAX_PHOTO), at: isNum(f.at) && f.at >= 0 && f.at <= 8.64e15 ? f.at : null });
    }
    return out;
  }

  /* ---------- Reducir la imagen ---------- */
  // Abre la imagen respetando la orientación del teléfono (si no, las fotos tomadas de lado saldrían giradas)
  function decode(file, env) {
    var cib = env.createImageBitmap;
    function viaImage() {
      return new Promise(function (resolve, reject) {
        var U = env.URL, img = new env.Image(), url = U.createObjectURL(file);
        img.onload = function () { U.revokeObjectURL(url); resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, source: img }); };
        img.onerror = function () { U.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
        img.src = url;
      });
    }
    function wrap(bm) { return { width: bm.width, height: bm.height, source: bm, close: function () { if (bm.close) bm.close(); } }; }
    if (typeof cib !== 'function') return viaImage();
    return Promise.resolve().then(function () { return cib.call(env, file, { imageOrientation: 'from-image' }); })
      .catch(function () { return cib.call(env, file); })
      .then(wrap, viaImage);
  }

  /* ---------- Recortar los bordes de un solo color (para el logo, 2.16.0) ---------- */
  // data: píxeles RGBA (como los da getImageData), w × h. Devuelve { x, y, w, h } con la parte que no es borde.
  // El color del borde es el de las cuatro esquinas: si no se parecen entre sí, la imagen no tiene borde liso y no se recorta.
  // Una fila o columna es «borde» si casi todos sus píxeles (≥ 99 %) son de ese color (tolerancia para el ruido del JPEG).
  // Se deja un margen del 3 % alrededor; si lo que queda es casi todo (menos de 4 % de recorte) o casi nada, no se recorta.
  var TRIM_TOL = 24, TRIM_PAD = 0.03, TRIM_SIDE = 1000;      // el borde se busca con la imagen a 1000 px de lado como mucho
  function trimBox(data, w, h, tol) {
    var full = { x: 0, y: 0, w: w, h: h };
    if (!data || !(w > 8 && h > 8) || data.length < w * h * 4) return full;
    tol = isNum(tol) ? tol : TRIM_TOL;
    function px(x, y) { var i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; }
    function near(a, b) { return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; }
    var bg = px(0, 0);
    if (!near(bg, px(w - 1, 0)) || !near(bg, px(0, h - 1)) || !near(bg, px(w - 1, h - 1))) return full;
    function rowIsBg(y) { var bad = 0, lim = w * 0.01; for (var x = 0; x < w; x++) if (!near(px(x, y), bg) && ++bad > lim) return false; return true; }
    function colIsBg(x, y0, y1) { var bad = 0, lim = (y1 - y0 + 1) * 0.01; for (var y = y0; y <= y1; y++) if (!near(px(x, y), bg) && ++bad > lim) return false; return true; }
    var top = 0, bottom = h - 1, left = 0, right = w - 1;
    while (top < h && rowIsBg(top)) top++;
    if (top >= h) return full;                                   // toda la imagen es de un solo color
    while (bottom > top && rowIsBg(bottom)) bottom--;
    while (left < w && colIsBg(left, top, bottom)) left++;
    while (right > left && colIsBg(right, top, bottom)) right--;
    var bw = right - left + 1, bh = bottom - top + 1;
    if (bw < 8 || bh < 8) return full;
    var pad = Math.round(Math.max(bw, bh) * TRIM_PAD);
    var x0 = Math.max(0, left - pad), y0 = Math.max(0, top - pad), x1 = Math.min(w - 1, right + pad), y1 = Math.min(h - 1, bottom + pad);
    var out = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return out.w * out.h > w * h * 0.96 ? full : out;
  }

  // file: Blob/File (la foto elegida o ya guardada). opts: { max, quality, trim }. Devuelve { bytes: Uint8Array JPEG, w, h }.
  // Con trim: true se recortan antes los bordes de un solo color (ver trimBox) y el resultado dice cuánto en `trimmed`.
  function shrink(file, opts, env) {
    opts = opts || {}; env = env || root;
    var max = opts.max || MAX_SIDE, q = opts.quality || QUALITY;
    if (!file || typeof file.size !== 'number') return Promise.reject(new Error('No llegó ninguna imagen.'));
    if (file.size === 0) return Promise.reject(new Error('El archivo está vacío.'));
    if (file.size > MAX_INPUT) return Promise.reject(new Error('La foto es demasiado grande (más de 40 MB).'));
    if (file.type && !/^image\//i.test(file.type)) return Promise.reject(new Error('El archivo no es una imagen.'));
    return decode(file, env).then(function (img) {
      var s = fit(img.width, img.height, opts.trim ? Math.max(max, TRIM_SIDE) : max);
      if (!(s.w > 0 && s.h > 0)) { if (img.close) img.close(); throw new Error('La imagen no tiene tamaño.'); }
      var canvas = env.document.createElement('canvas');
      canvas.width = s.w; canvas.height = s.h;
      var ctx = canvas.getContext('2d');
      if (!ctx) { if (img.close) img.close(); throw new Error('Este dispositivo no puede preparar la foto.'); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.w, s.h);       // el JPEG no tiene transparencia: lo transparente queda blanco
      ctx.drawImage(img.source, 0, 0, s.w, s.h);
      if (img.close) img.close();
      var trimmed = false;
      if (opts.trim) {
        // se mira la imagen a buen tamaño, se busca el borde liso y se vuelve a dibujar solo la parte útil, ya reducida a `max`
        var box = { x: 0, y: 0, w: s.w, h: s.h };
        try { box = trimBox(ctx.getImageData(0, 0, s.w, s.h).data, s.w, s.h); } catch (e) { /* sin acceso a los píxeles: se deja entera */ }
        trimmed = box.w < s.w || box.h < s.h;
        var t = fit(box.w, box.h, max), c2 = env.document.createElement('canvas');
        c2.width = t.w; c2.height = t.h;
        var ctx2 = c2.getContext('2d');
        if (ctx2) { ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, t.w, t.h); ctx2.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, t.w, t.h); canvas = c2; s = t; }
        else trimmed = false;
        if (!ctx2 && (s.w > max || s.h > max)) throw new Error('Este dispositivo no puede preparar la foto.');
      }
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('No se pudo preparar la foto.')); }, 'image/jpeg', q);
      }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (!isJpeg(bytes)) throw new Error('No se pudo preparar la foto.');
        if (bytes.length > MAX_PHOTO) throw new Error('La foto reducida sigue siendo demasiado grande.');
        return opts.trim ? { bytes: bytes, w: s.w, h: s.h, trimmed: trimmed } : { bytes: bytes, w: s.w, h: s.h };
      });
    });
  }

  /* ---------- Guardar las imágenes en el teléfono (IndexedDB) ---------- */
  // idb: window.indexedDB (o uno de mentira en las pruebas). Todo devuelve promesas.
  function createStore(idb) {
    var opening = null;
    function open() {
      if (opening) return opening;
      opening = new Promise(function (resolve, reject) {
        if (!idb) { reject(new Error('Este dispositivo no permite guardar fotos.')); return; }
        var req;
        try { req = idb.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('No se pudo abrir el almacén de fotos.')); };
      });
      opening.catch(function () { opening = null; });         // si falló, la próxima vez se vuelve a intentar
      return opening;
    }
    // fn(store) hace la petición; el resultado se entrega cuando la transacción termina
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx, req;
          try { tx = db.transaction(STORE, mode); req = fn(tx.objectStore(STORE)); } catch (e) { reject(e); return; }
          tx.oncomplete = function () { resolve(req ? req.result : undefined); };
          tx.onerror = function () { reject(tx.error || new Error('No se pudo guardar la foto.')); };
          tx.onabort = function () { reject(tx.error || new Error('No se pudo guardar la foto.')); };
        });
      });
    }
    function copy(bytes) { var b = new Uint8Array(bytes.length); b.set(bytes); return b.buffer; }
    return {
      put: function (id, bytes) { return run('readwrite', function (st) { return st.put({ id: id, type: 'image/jpeg', n: bytes.length, at: Date.now(), data: copy(bytes) }); }).then(function () { return undefined; }); },
      get: function (id) { return run('readonly', function (st) { return st.get(id); }).then(function (r) { return r && r.data ? new Uint8Array(r.data) : null; }); },
      del: function (id) { return run('readwrite', function (st) { return st.delete(id); }).then(function () { return undefined; }); },
      keys: function () { return run('readonly', function (st) { return st.getAllKeys(); }).then(function (k) { return Array.isArray(k) ? k.filter(isId) : []; }); }
    };
  }

  // Borra del teléfono las imágenes que ningún punto usa (fotos quitadas, puntos o proyectos eliminados). keep: lista de ids en uso.
  function sweep(store, keep) {
    var used = {};
    keep.forEach(function (id) { used[id] = true; });
    return store.keys().then(function (all) {
      var gone = all.filter(function (id) { return !used[id]; });
      return Promise.all(gone.map(function (id) { return store.del(id); })).then(function () { return gone.length; });
    });
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // Guarda las fotos que vienen en una copia de seguridad: items = [{ id, bytes }]. Si ya hay una foto con ese id y es la misma, se reutiliza;
  // si hay una distinta con el mismo id, la que llega se guarda con un id nuevo (nunca se pisa una foto que ya tenías).
  // Devuelve { map: { idEnLaCopia: idGuardado }, written: cuántas imágenes se escribieron }.
  function importAll(store, items, mint) {
    mint = mint || newId;
    var map = {}, written = 0;
    return items.reduce(function (chain, it) {
      return chain.then(function () {
        return store.get(it.id).then(function (have) {
          if (have && same(have, it.bytes)) { map[it.id] = it.id; return; }
          var id = have ? mint() : it.id;
          return store.put(id, it.bytes).then(function () { map[it.id] = id; written++; });
        });
      });
    }, Promise.resolve()).then(function () { return { map: map, written: written }; });
  }

  // Direcciones temporales (blob:) para mostrar las imágenes guardadas; se piden una vez por foto y se reutilizan.
  function createUrls(store, urlApi, BlobCtor) {
    var made = {};
    return {
      get: function (id) {
        if (!made[id]) {
          made[id] = store.get(id).then(function (b) { return b ? urlApi.createObjectURL(new BlobCtor([b], { type: 'image/jpeg' })) : null; });
          made[id].catch(function () { delete made[id]; });
        }
        return made[id].then(function (u) { if (!u) delete made[id]; return u; });
      },
      revoke: function (id) { var p = made[id]; delete made[id]; if (p) p.then(function (u) { if (u) urlApi.revokeObjectURL(u); }, function () { /* nada */ }); },
      clear: function () { Object.keys(made).forEach(this.revoke); }
    };
  }

  /* ---------- Base64 (la copia .json con fotos lleva cada imagen como texto) ---------- */
  var B64 = /^[A-Za-z0-9+\/]*={0,2}$/;
  function toBase64(bytes) {
    var enc = typeof btoa === 'function' ? btoa : root && root.btoa;
    if (!enc) throw new Error('Este dispositivo no puede convertir la foto a texto.');
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));    // por trozos: no desborda la pila con fotos grandes
    return enc(s);
  }
  // Texto base64 → bytes; null si el texto no es base64 válido
  function fromBase64(text) {
    if (typeof text !== 'string' || text.length % 4 !== 0 || !B64.test(text)) return null;
    var dec = typeof atob === 'function' ? atob : root && root.atob, s;
    if (!dec) return null;
    try { s = dec(text); } catch (e) { return null; }
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Todas las fotos de un proyecto o de varios: lista de ids en uso
  function usedIds(projects) {
    var out = [], seen = {};
    (projects || []).forEach(function (p) {
      var groups = p && Array.isArray(p.lots) ? p.lots.concat([p]) : [p];      // desde la 2.15.0 los puntos están en los lotes del proyecto
      groups.forEach(function (g) {
        ((g && g.points) || []).forEach(function (pt) {
          (Array.isArray(pt.photos) ? pt.photos : []).forEach(function (f) { if (f && isId(f.id) && !seen[f.id]) { seen[f.id] = true; out.push(f.id); } });
        });
      });
    });
    return out;
  }
  function countAll(points) {
    var n = 0, withPhotos = 0;
    (points || []).forEach(function (pt) { var k = Array.isArray(pt.photos) ? pt.photos.length : 0; n += k; if (k) withPhotos++; });
    return { photos: n, points: withPhotos, without: (points || []).length - withPhotos };
  }

  return {
    MAX_PER_POINT: MAX_PER_POINT, MAX_SIDE: MAX_SIDE, QUALITY: QUALITY, REPORT_SIDE: REPORT_SIDE, REPORT_QUALITY: REPORT_QUALITY, MAX_INPUT: MAX_INPUT, MAX_PHOTO: MAX_PHOTO,
    trimBox: trimBox, isId: isId, newId: newId, isJpeg: isJpeg, fit: fit, cleanList: cleanList, shrink: shrink, createStore: createStore, sweep: sweep,
    importAll: importAll, createUrls: createUrls, usedIds: usedIds, countAll: countAll, toBase64: toBase64, fromBase64: fromBase64
  };
});

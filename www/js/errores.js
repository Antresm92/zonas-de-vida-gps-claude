/* errores.js — registro de errores y tiempo de arranque (2.34.0).
 * Si algo falla sin que la app lo atrape, se anota aquí para que la persona pueda compartirlo con quien mantiene la app.
 *  - Se guarda SOLO en el teléfono (clave zvg.v1.diagnostico) y NUNCA se envía solo: sale únicamente si la persona lo comparte.
 *  - Sin coordenadas: los números con 3 o más decimales pasan a «#» y las direcciones web pierden sus parámetros (?…).
 *  - Tamaño limitado: los últimos 50 errores (uno repetido suma veces, no ocupa otra fila) y los últimos 10 arranques.
 *  - Nunca rompe la app: si no hay dónde guardar, no anota; si anotar falla, se calla.
 * La parte de cálculo es pura (se prueba en Node); install() escucha los errores del navegador. Este archivo se carga antes que
 * los demás, para anotar también un error al cargar cualquiera de ellos. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Errores = factory(); root.Errores.install(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'zvg.v1.diagnostico';
  var MAX_ERR = 50, MAX_START = 10, MAX_SESSION = 100, MAX_N = 9999;
  var M_LEN = 300, D_LEN = 120, S_LINES = 4, S_LEN = 600, V_LEN = 20;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  var version = '';

  function str(s) { return s === null || s === undefined ? '' : String(s); }
  function clip(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function iso(now) { var d = new Date(typeof now === 'number' && isFinite(now) ? now : Date.now()); return isNaN(d) ? '' : d.toISOString().slice(0, 19) + 'Z'; }
  function oneLine(s) { return str(s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  // Quita lo que pueda decir dónde está la persona o qué consultó: los parámetros de las direcciones web y las coordenadas
  // (cualquier número con 3 o más decimales, con punto o con coma). Los archivos de la propia app quedan como «js/app.js».
  function scrub(s) {
    return str(s)
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/'"()]+\/(?=(?:js|vendor|css)\/)/gi, '')
      .replace(/\?[^\s'"()]*/g, '?…')
      .replace(/-?\d{1,3}[.,]\d{3,}/g, '#');
  }
  function where(file, line, col) {
    var f = scrub(file).replace(/^.*\//, '');
    if (!f) return '';
    return clip(f + (line ? ':' + line + (col ? ':' + col : '') : ''), D_LEN);
  }
  function stackOf(err) {
    var s = err && typeof err.stack === 'string' ? err.stack : '';
    if (!s) return '';
    var lines = s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length && !/^at\s|@/.test(lines[0])) lines.shift();          // la primera línea repite el mensaje
    return clip(lines.slice(0, S_LINES).map(scrub).join('\n'), S_LEN);
  }

  // Un error como fila del registro: { t: fecha (ISO, sin milésimas), v: versión, k: 'error' | 'promesa', m: mensaje, d: dónde, s: pila, n: veces }
  function record(o) {
    o = o || {};
    var err = o.error && typeof o.error === 'object' ? o.error : null, msg = oneLine(o.message);
    if (!msg && err) msg = (err.name && err.name !== 'Error' ? err.name + ': ' : '') + oneLine(err.message);
    if (!msg && o.error !== undefined && o.error !== null && !err) msg = oneLine(o.error);
    msg = msg.replace(/^Uncaught\s+(\(in promise\)\s*)?/i, '');
    return {
      t: iso(o.now), v: clip(oneLine(o.version !== undefined ? o.version : version), V_LEN), k: o.kind === 'promesa' ? 'promesa' : 'error',
      m: clip(scrub(msg || 'Error sin descripción'), M_LEN), d: where(o.file, o.line, o.col), s: stackOf(err), n: 1
    };
  }

  // Lo guardado, revisado: lo que no tenga la forma esperada se descarta (nunca rompe al abrir el registro)
  function cleanErr(e) {
    if (!e || typeof e !== 'object' || typeof e.m !== 'string' || !e.m) return null;
    var n = Math.floor(Number(e.n));
    return { t: ISO.test(e.t) ? e.t : '', v: clip(oneLine(e.v), V_LEN), k: e.k === 'promesa' ? 'promesa' : 'error', m: clip(oneLine(e.m), M_LEN),
      d: clip(oneLine(e.d), D_LEN), s: clip(str(e.s), S_LEN), n: n >= 1 ? Math.min(n, MAX_N) : 1 };
  }
  function cleanStart(a) {
    if (!a || typeof a !== 'object' || typeof a.ms !== 'number' || !isFinite(a.ms) || a.ms < 0 || a.ms >= 600000) return null;
    return { t: ISO.test(a.t) ? a.t : '', v: clip(oneLine(a.v), V_LEN), ms: Math.round(a.ms) };
  }
  function clean(raw) {
    var d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      v: 1,
      errores: (Array.isArray(d.errores) ? d.errores : []).map(cleanErr).filter(Boolean).slice(-MAX_ERR),
      arranques: (Array.isArray(d.arranques) ? d.arranques : []).map(cleanStart).filter(Boolean).slice(-MAX_START)
    };
  }

  // Suma un error. Si ya está (mismo mensaje, lugar, tipo y versión) solo cuenta una vez más y pasa al final, con la fecha nueva.
  function add(diag, rec) {
    var d = clean(diag), r = cleanErr(rec);
    if (!r) return d;
    for (var i = 0; i < d.errores.length; i++) {
      var e = d.errores[i];
      if (e.m === r.m && e.d === r.d && e.k === r.k && e.v === r.v) {
        d.errores.splice(i, 1);
        r.n = Math.min(e.n + r.n, MAX_N);
        break;
      }
    }
    d.errores.push(r);
    if (d.errores.length > MAX_ERR) d.errores = d.errores.slice(-MAX_ERR);
    return d;
  }
  // Cuánto tardó en abrir (milisegundos desde que el teléfono empezó a cargarla hasta la primera pantalla lista)
  function addStartup(diag, ms, ver, now) {
    var d = clean(diag), a = cleanStart({ ms: ms, v: ver !== undefined ? ver : version, t: iso(now) });
    if (!a) return d;
    d.arranques.push(a);
    if (d.arranques.length > MAX_START) d.arranques = d.arranques.slice(-MAX_START);
    return d;
  }

  function seconds(ms) { return (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',') + ' s'; }
  function summary(diag) {
    var d = clean(diag), ms = d.arranques.map(function (a) { return a.ms; });
    var veces = d.errores.reduce(function (s, e) { return s + e.n; }, 0);
    return {
      errores: d.errores.length, veces: veces,
      ultimo: ms.length ? ms[ms.length - 1] : null,
      promedio: ms.length ? Math.round(ms.reduce(function (s, x) { return s + x; }, 0) / ms.length) : null,
      arranques: ms.length
    };
  }

  // Del navegador solo interesa el sistema y su versión, y el motor y su versión (no el modelo del teléfono)
  function device(ua) {
    ua = str(ua);
    var os = /Android \d+(\.\d+)?/.exec(ua) || /(iPhone|CPU) OS \d+/.exec(ua) || /Windows NT \d+(\.\d+)?/.exec(ua) || /Mac OS X \d+[._]\d+/.exec(ua) || /Linux/.exec(ua);
    var br = /(Chrome|Firefox|Version)\/\d+/.exec(ua);
    return [os ? os[0].replace(/_/g, '.') : '', br ? br[0].replace('Version', 'Safari').replace('/', ' ') : ''].filter(Boolean).join(' · ') || 'desconocido';
  }
  // Fecha y hora del teléfono (las filas se guardan en UTC; se muestran en la hora local)
  function day(t) {
    var d = t ? new Date(t) : null;
    if (!d || isNaN(d)) return 'sin fecha';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // Texto para compartir (lo ve la persona antes de enviarlo)
  function text(diag, info) {
    info = info || {};
    var d = clean(diag), s = summary(d), out = [];
    out.push('Registro de errores · ' + (info.app || 'Don Florentino SIG'));
    out.push('Versión: ' + (clip(oneLine(info.version || version), V_LEN) || 'desconocida') + ' · ' + device(info.ua));
    out.push('Creado: ' + day(iso(info.now)) + ' (horas del teléfono)');
    out.push('No incluye puntos ni coordenadas. Revísalo antes de enviarlo.');
    out.push('');
    if (!s.arranques) out.push('Arranque: sin datos todavía.');
    else if (s.arranques === 1) out.push('Arranque: ' + seconds(s.ultimo) + ' (medido una vez).');
    else out.push('Arranque (últimas ' + s.arranques + ' veces, de la más vieja a la más reciente): ' + d.arranques.map(function (a) { return seconds(a.ms); }).join(' · ') +
      '. Promedio: ' + seconds(s.promedio) + '.');
    out.push('');
    if (!d.errores.length) out.push('Errores: ninguno.');
    else {
      out.push('Errores (' + d.errores.length + ', del más reciente al más viejo):');
      d.errores.slice().reverse().forEach(function (e, i) {
        out.push((i + 1) + '. ' + day(e.t) + ' · versión ' + (e.v || '?') + (e.k === 'promesa' ? ' · promesa sin atender' : '') + (e.n > 1 ? ' · ' + e.n + ' veces' : ''));
        out.push('   ' + e.m);
        if (e.d) out.push('   en ' + e.d);
        if (e.s) out.push(e.s.split('\n').map(function (l) { return '     ' + l; }).join('\n'));
      });
    }
    return out.join('\n') + '\n';
  }

  /* ---------- Guardar (con try/catch: sin almacenamiento, la app sigue igual) ---------- */
  function load(storage) {
    try { return clean(storage ? JSON.parse(storage.getItem(KEY)) : null); } catch (e) { return clean(null); }
  }
  function save(storage, diag) {
    try { if (!storage) return false; storage.setItem(KEY, JSON.stringify(clean(diag))); return true; } catch (e) { return false; }
  }
  function clear(storage) {
    try { if (storage) storage.removeItem(KEY); return true; } catch (e) { return false; }
  }
  function setVersion(v) { version = clip(oneLine(v), V_LEN); }

  /* ---------- Escuchar los errores del navegador ---------- */
  var installed = false, busy = false, count = 0;
  function note(storage, o) {
    if (busy || count >= MAX_SESSION) return false;        // nunca en bucle, y como mucho 100 por sesión
    busy = true; count++;
    try { o.now = Date.now(); return save(storage, add(load(storage), record(o))); } catch (e) { return false; } finally { busy = false; }
  }
  function install(win) {
    if (installed || !win || typeof win.addEventListener !== 'function') return;
    installed = true;
    var st = function () { try { return win.localStorage; } catch (e) { return null; } };
    // Solo errores del código: los de carga de una imagen o de un mapa no llegan aquí (no suben hasta la ventana)
    win.addEventListener('error', function (e) {
      if (!e || (e.target && e.target !== win && e.target.nodeType === 1)) return;
      note(st(), { kind: 'error', message: e.message, error: e.error, file: e.filename, line: e.lineno, col: e.colno });
    });
    win.addEventListener('unhandledrejection', function (e) {
      var r = e ? e.reason : null;
      note(st(), r && typeof r === 'object' && typeof r.message === 'string' ? { kind: 'promesa', error: r } : { kind: 'promesa', message: str(r) });
    });
  }

  return { KEY: KEY, MAX_ERR: MAX_ERR, MAX_START: MAX_START, MAX_SESSION: MAX_SESSION, scrub: scrub, record: record, clean: clean, add: add, addStartup: addStartup,
    summary: summary, seconds: seconds, device: device, day: day, text: text, load: load, save: save, clear: clear, setVersion: setVersion, note: note, install: install };
});

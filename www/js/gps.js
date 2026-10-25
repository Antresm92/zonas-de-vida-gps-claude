/* gps.js — lecturas del GPS del teléfono (navigator.geolocation).
 * Funciona igual en el navegador/PWA y dentro de la app Android (WebView de Capacitor).
 *
 * La altitud que entrega el GPS suele tener un error vertical de 10 a 30 m, así que "sample"
 * toma varias lecturas y promedia las mejores. Según el teléfono, la altitud puede venir
 * medida desde el elipsoide WGS84 y no desde el nivel del mar: en Colombia la diferencia es
 * de decenas de metros, que mueven la temperatura estimada menos de 0,5 °C. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Gps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function explain(err) {
    var code = err && err.code;
    if (code === 1) return 'Sin permiso de ubicación. Actívalo en Ajustes del teléfono > Aplicaciones > Zonas de Vida > Permisos.';
    if (code === 2) return 'No hay señal de GPS. Sal a un lugar abierto y espera unos segundos.';
    if (code === 3) return 'El GPS tardó demasiado. Sal a un lugar abierto y vuelve a intentar.';
    return 'No se pudo leer el GPS' + (err && err.message ? ': ' + err.message : '.');
  }

  function available(geo) {
    geo = geo || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    return !!geo;
  }

  // Precisión mínima requerida (±m). 0 o vacío = sin límite.
  // level: 'off' (sin límite) | 'none' (aún no hay lectura) | 'ok' (cumple) | 'bad' (peor que el mínimo)
  function precisionState(acc, min) {
    if (!isNum(min) || min <= 0) return { level: 'off', worse: false };
    if (!isNum(acc)) return { level: 'none', worse: false };
    return acc > min ? { level: 'bad', worse: true, over: acc - min } : { level: 'ok', worse: false };
  }
  function precisionText(acc, min) {
    var st = precisionState(acc, min);
    if (st.level === 'bad') return 'La precisión ahora es de ±' + Math.round(acc) + ' m, peor que el mínimo que elegiste (±' + min + ' m). Si marcas ahora, este punto no será el más preciso.';
    if (st.level === 'ok') return 'Precisión suficiente: ±' + Math.round(acc) + ' m (mínimo ±' + min + ' m).';
    return '';
  }

  // Promedia lecturas: descarta las que tienen una precisión mucho peor que la mejor.
  function combine(samples) {
    if (!samples.length) return null;
    var best = Infinity;
    samples.forEach(function (s) { if (isNum(s.acc) && s.acc < best) best = s.acc; });
    var keep = samples.filter(function (s) { return !isNum(s.acc) || !isFinite(best) || s.acc <= Math.max(best * 1.6, best + 3); });
    if (!keep.length) keep = samples;
    var lat = 0, lon = 0;
    keep.forEach(function (s) { lat += s.lat; lon += s.lon; });
    lat /= keep.length; lon /= keep.length;
    var alts = keep.filter(function (s) { return isNum(s.alt); }).map(function (s) { return s.alt; });
    var alt = null;
    if (alts.length) {
      alts.sort(function (a, b) { return a - b; });
      var mid = alts.length >> 1;
      alt = alts.length % 2 ? alts[mid] : (alts[mid - 1] + alts[mid]) / 2;      // mediana: resiste a lecturas locas
    }
    var altAccs = keep.filter(function (s) { return isNum(s.altAcc); }).map(function (s) { return s.altAcc; });
    var accs = keep.filter(function (s) { return isNum(s.acc); }).map(function (s) { return s.acc; });
    return {
      lat: lat, lon: lon, alt: alt,
      acc: accs.length ? Math.min.apply(null, accs) : null,
      altAcc: altAccs.length ? Math.min.apply(null, altAccs) : null,
      n: keep.length, total: samples.length, ts: Date.now()
    };
  }

  function toSample(pos) {
    var c = pos.coords || {};
    return { lat: c.latitude, lon: c.longitude, alt: isNum(c.altitude) ? c.altitude : null,
             acc: isNum(c.accuracy) ? c.accuracy : null, altAcc: isNum(c.altitudeAccuracy) ? c.altitudeAccuracy : null, ts: pos.timestamp || Date.now() };
  }

  // Lectura continua. Devuelve una función para detenerla.
  function watch(onFix, onError, geo) {
    geo = geo || navigator.geolocation;
    if (!geo) { onError && onError(new Error('Este dispositivo no tiene GPS accesible.')); return function () {}; }
    var id = geo.watchPosition(function (pos) { onFix(toSample(pos)); },
      function (e) { onError && onError(e); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    return function () { try { geo.clearWatch(id); } catch (e) { /* nada */ } };
  }

  // Toma lecturas durante "seconds" (o hasta tener "goodAcc" metros y mínimo 4 lecturas) y las promedia.
  // opts: { seconds, goodAcc, minSamples, targetAcc, maxSeconds, onProgress(sample, count, elapsedMs), geo, signal }
  function sample(opts) {
    opts = opts || {};
    var geo = opts.geo || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    var ms = (opts.seconds || 10) * 1000;
    var goodAcc = opts.goodAcc || 5;
    var minSamples = opts.minSamples || 4;
    return new Promise(function (resolve, reject) {
      if (!geo) { reject(new Error('Este dispositivo no tiene GPS accesible.')); return; }
      var samples = [], done = false, started = Date.now(), timer, id;
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { geo.clearWatch(id); } catch (e) { /* nada */ }
        if (opts.signal && opts.signal.removeEventListener) opts.signal.removeEventListener('abort', onAbort);
        var r = combine(samples);
        if (r) resolve(r);
        else reject(err || new Error('No llegó ninguna lectura del GPS.'));
      }
      function onAbort() { finish(new Error('Cancelado')); }
      if (opts.signal && opts.signal.addEventListener) opts.signal.addEventListener('abort', onAbort);
      id = geo.watchPosition(function (pos) {
        var s = toSample(pos);
        if (!isNum(s.lat) || !isNum(s.lon)) return;
        samples.push(s);
        if (opts.onProgress) opts.onProgress(s, samples.length, Date.now() - started);
        if (isNum(s.acc) && s.acc <= goodAcc && samples.length >= minSamples) finish();
      }, function (e) {
        if (e && e.code === 1) finish(e);                 // sin permiso: no tiene sentido seguir
        else if (!samples.length && e && e.code === 3) { /* seguir esperando hasta el límite */ }
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      // Al cumplirse el tiempo, si hay una precisión objetivo y aún no se logra, se sigue esperando hasta maxSeconds
      var maxMs = Math.max((opts.maxSeconds || 30) * 1000, ms);
      function check() {
        if (done) return;
        var best = Infinity;
        samples.forEach(function (x) { if (isNum(x.acc) && x.acc < best) best = x.acc; });
        if (opts.targetAcc && best > opts.targetAcc && Date.now() - started < maxMs) { timer = setTimeout(check, 400); return; }
        finish(new Error('Tiempo agotado sin lecturas del GPS.'));
      }
      timer = setTimeout(check, Math.max(ms, 1000));
    });
  }

  return { sample: sample, watch: watch, combine: combine, explain: explain, available: available, precisionState: precisionState, precisionText: precisionText };
});

/* gps.js — lecturas del GPS del teléfono (navigator.geolocation).
 * Funciona igual en el navegador/PWA y dentro de la app Android (WebView de Capacitor).
 *
 * La altitud que entrega el GPS suele tener un error vertical de 10 a 30 m, así que "sample"
 * toma varias lecturas y promedia las mejores. La API la da sobre el elipsoide WGS84 (en iPhone,
 * sobre el nivel del mar); desde la 2.35.1 la app la pasa al nivel del mar con el geoide EGM2008
 * al guardar el punto (geoide.js). En Colombia la diferencia va de unos −21 a +28 m. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Gps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function explain(err) {
    var code = err && err.code;
    if (code === 1) return 'Sin permiso de ubicación. Actívalo en Ajustes del teléfono > Aplicaciones > Don Florentino SIG > Permisos.';
    if (code === 2) return 'No hay señal de GPS. Sal a un lugar abierto y espera unos segundos.';
    if (code === 3) return 'El GPS no responde. Verifica que la ubicación del teléfono esté activada, o sal a un lugar abierto y vuelve a intentar.';
    return 'No se pudo leer el GPS' + (err && err.message ? ': ' + err.message : '.');
  }

  // ¿Este error quiere decir que el GPS está apagado o que la app no puede usarlo?
  // 1 = sin permiso de ubicación · 2 = posición no disponible (ubicación apagada o sin señal).
  // El código 3 (tardó demasiado) cuenta solo si todavía no llegó ninguna lectura desde que se encendió: en Android,
  // con la ubicación apagada, el WebView entrega ese código (confirmado en un teléfono el 8 nov 2026). Si ya hubo
  // lecturas, es una pérdida de señal pasajera (bajo techo) y basta con avisar.
  function isOff(err, hadFix) { return !!err && (err.code === 1 || err.code === 2 || (err.code === 3 && !hadFix)); }

  // Textos del aviso «¿Usar sin GPS?». kind: 'permiso' (código 1) o 'senal' (cualquier otro caso).
  function offNotice(err) {
    var perm = !!err && err.code === 1;
    return {
      kind: perm ? 'permiso' : 'senal',
      main: perm ? explain(err) : 'El GPS parece apagado o no llega su señal. Enciende la ubicación del teléfono (Ajustes > Ubicación) o sal a un lugar abierto.',
      yes: 'Si eliges «Sí», sigues sin GPS: puedes tocar el mapa o escribir las coordenadas.',
      no: perm ? 'Si eliges «No», el GPS queda apagado hasta que lo vuelvas a encender aquí.' : 'Si eliges «No», la app sigue buscando la señal.'
    };
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

  /* Promedia las lecturas de un punto (2.34.2).
   * Primero descarta las que tienen una precisión mucho peor que la mejor (igual que antes). Con las que quedan:
   *  - Método «ponderado» (el de siempre desde la 2.34.2): cada lectura pesa 1 / precisión², el promedio ponderado estándar
   *    (Particle Data Group, Review of Particle Physics 2018, Introducción, sección 5.2.2, ecuación 1). La precisión que se
   *    guarda es el PROMEDIO de las precisiones de las lecturas usadas, como guarda ArcGIS Field Maps al promediar
   *    («precisión horizontal promedio»). No se divide entre la raíz del número de lecturas (la otra parte de esa ecuación):
   *    eso supone errores independientes, y los de lecturas seguidas del GPS están correlacionados en el tiempo; daría una
   *    precisión mejor que la real.
   *  - Método «simple» (el anterior, opcional en Preferencias): todas pesan igual y la precisión es la de la mejor lectura.
   * La altitud es la mediana en los dos (resiste saltos de decenas de metros). Una lectura sin precisión pesa como la peor
   * conocida. spread: cuánto se mueven las lecturas alrededor del promedio (raíz del promedio ponderado de las distancias
   * al cuadrado, en metros), para verlo en vivo. */
  function wrap180(x) { return ((x + 540) % 360 + 360) % 360 - 180; }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function combine(samples, method) {
    if (!samples || !samples.length) return null;
    var simple = method === 'simple';
    var best = Infinity;
    samples.forEach(function (s) { if (isNum(s.acc) && s.acc < best) best = s.acc; });
    var keep = samples.filter(function (s) { return !isNum(s.acc) || !isFinite(best) || s.acc <= Math.max(best * 1.6, best + 3); });
    if (!keep.length) keep = samples;
    var accs = keep.filter(function (s) { return isNum(s.acc); }).map(function (s) { return s.acc; });
    var worst = accs.length ? Math.max.apply(null, accs) : null;
    var w = keep.map(function (s) {
      if (simple || worst === null) return 1;
      var a = Math.max(isNum(s.acc) ? s.acc : worst, 0.1);     // nunca dividir entre 0
      return 1 / (a * a);
    });
    // Longitudes medidas desde la primera lectura: así el promedio no se rompe cerca de ±180°
    var lon0 = keep[0].lon, sw = 0, la = 0, lo = 0;
    keep.forEach(function (s, i) { sw += w[i]; la += w[i] * s.lat; lo += w[i] * wrap180(s.lon - lon0); });
    var lat = la / sw, lon = wrap180(lon0 + lo / sw);
    var mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180), ss = 0;
    keep.forEach(function (s, i) { var dy = (s.lat - lat) * mLat, dx = wrap180(s.lon - lon) * mLon; ss += w[i] * (dx * dx + dy * dy); });
    var alts = keep.filter(function (s) { return isNum(s.alt); }).map(function (s) { return s.alt; });
    var alt = null;
    if (alts.length) {
      alts.sort(function (a, b) { return a - b; });
      var mid = alts.length >> 1;
      alt = alts.length % 2 ? alts[mid] : (alts[mid - 1] + alts[mid]) / 2;      // mediana: resiste a lecturas locas
    }
    var altAccs = keep.filter(function (s) { return isNum(s.altAcc); }).map(function (s) { return s.altAcc; });
    return {
      lat: lat, lon: lon, alt: alt,
      acc: accs.length ? (simple ? Math.min.apply(null, accs) : mean(accs)) : null,
      altAcc: altAccs.length ? (simple ? Math.min.apply(null, altAccs) : mean(altAccs)) : null,
      n: keep.length, total: samples.length, spread: Math.sqrt(ss / sw), method: simple ? 'simple' : 'ponderado', ts: Date.now()
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
  // opts: { seconds, goodAcc, minSamples, targetAcc, maxSeconds, onProgress(sample, count, elapsedMs), geo, signal, method ('ponderado' | 'simple') }
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
        var r = combine(samples, opts.method);
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

  return { wrap180: wrap180, sample: sample, watch: watch, combine: combine, explain: explain, isOff: isOff, offNotice: offNotice, available: available, precisionState: precisionState, precisionText: precisionText };
});

/* mapa.js — lógica del mapa del polígono, sin pantalla: capas base, qué se dibuja y avisos.
 * Todo lo que se puede probar sin navegador está aquí; mapview.js solo lo dibuja con Leaflet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mapa = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

  // Capas base. «calles» muestra las calles y los nombres; «satelite» muestra imágenes del terreno.
  var BASES = {
    calles: {
      id: 'calles', label: 'Calles',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    },
    satelite: {
      id: 'satelite', label: 'Satélite',
      url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
      attribution: 'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }
  };
  // Capa topográfica de OpenTopoMap: curvas de nivel y relieve sombreado (datos SRTM y OpenStreetMap). Sus mosaicos llegan hasta el nivel 17;
  // con más zoom se amplían (maxNativeZoom) en vez de quedar en blanco.
  BASES.topo = {
    id: 'topo', label: 'Topográfico',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 19, maxNativeZoom: 17,
    attribution: 'Datos: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, SRTM | Estilo: &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)'
  };
  // Calles y nombres que se pueden poner encima del satélite (vista híbrida)
  var REFERENCE = [
    { id: 'transporte', url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 },
    { id: 'lugares', url: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 }
  ];

  var LABEL_MIN_ZOOM = 15;           // con menos zoom no se escriben los nombres, para que no se amontonen
  var COLOMBIA = { lat: 4.57, lon: -74.3, zoom: 5 };   // vista inicial cuando todavía no hay nada que mostrar
  var TILE_ERRORS_BEFORE_NOTICE = 3;

  // Gestos del mapa (menú ⋮). Mantener pulsado un punto HOLD_MS (sin moverse más de HOLD_SLOP_PX) lo «levanta» para arrastrarlo;
  // dos toques cortos seguidos (≤ DOUBLE_TAP_MS y a ≤ DOUBLE_TAP_SLOP_PX uno del otro) abren su ficha.
  var MODES = ['add', 'move'];                // add: «Ingresar puntos» · move: «Posición manual»
  var HOLD_MS = 1000, HOLD_SLOP_PX = 10,        // HOLD_MS: tiempo fijo para levantar un punto (ya no se ajusta)
 DOUBLE_TAP_MS = 350, DOUBLE_TAP_SLOP_PX = 24, TAP_SLOP_PX = 8;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  // El color propio de un punto (el que se elige en su ficha); si no tiene uno válido, el de los puntos del proyecto
  function pointColor(q, dflt) { return q && typeof q.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.color) ? q.color : dflt; }
  function validLL(p) { return !!p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180; }

  function baseId(id) { return Object.prototype.hasOwnProperty.call(BASES, id) ? id : 'calles'; }

  // «P3 · 386 m»: nombre y altitud (si hay). fmt: cómo escribir el número (por defecto, entero).
  function pointLabel(pt, fmt) {
    var name = pt && pt.name ? String(pt.name) : '';
    if (!pt || !isNum(pt.alt)) return name;
    var n = typeof fmt === 'function' ? fmt(pt.alt) : String(Math.round(pt.alt));
    return (name ? name + ' · ' : '') + n + ' m';
  }

  // Último punto marcado: el de fecha más reciente; si no hay fechas, el último de la lista.
  function lastPoint(points) {
    var best = null, bestTs = -Infinity;
    (points || []).forEach(function (p) {
      if (!validLL(p)) return;
      var ts = isNum(p.ts) ? p.ts : -Infinity;
      if (best === null || ts >= bestTs) { best = p; bestTs = ts; }
    });
    return best;
  }

  function visibleLayers(layers) {
    return (layers || []).filter(function (l) { return l && l.visible !== false && Array.isArray(l.points) && l.points.some(validLL); });
  }

  function ring(points) {
    return (points || []).filter(validLL).map(function (p) { return [p.lat, p.lon]; });
  }

  // Cuadro que contiene todo lo que se dibuja: { south, west, north, east } o null si no hay nada.
  function extent(points, layers) {
    var s = Infinity, w = Infinity, n = -Infinity, e = -Infinity, any = false;
    function add(p) {
      if (!validLL(p)) return;
      any = true;
      if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
      if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon;
    }
    (points || []).forEach(add);
    visibleLayers(layers).forEach(function (l) { l.points.forEach(add); });
    return any ? { south: s, west: w, north: n, east: e } : null;
  }

  // Lo que se dibuja en el mapa para un proyecto.
  //  opts.polyActive: ¿se unen los puntos en un polígono?   opts.bad: los lados se cruzan   opts.fmt: cómo escribir la altitud
  function shapes(project, opts) {
    opts = opts || {};
    var p = project || {}, pts = (p.points || []).filter(validLL), color = p.mainColor || '#2F8F4E';
    var out = { color: color, polygon: null, points: [], layers: [], sides: [] };
    if (opts.polyActive !== false && pts.length >= 2) {
      out.polygon = { latlngs: ring(pts), closed: pts.length >= 3, bad: !!opts.bad };
    }
    if (out.polygon) out.sides = sides(pts, out.polygon.closed, opts.dist, opts.fmtDist);
    out.points = pts.map(function (q, i) {
      return { id: q.id, name: q.name || ('P' + (i + 1)), label: pointLabel(q, opts.fmt) || ('P' + (i + 1)), lat: q.lat, lon: q.lon, color: pointColor(q, color), order: i + 1 };   // order: puesto en el recorrido del polígono
    });
    out.layers = visibleLayers(p.layers).map(function (l) {
      var kind = l.kind === 'polygon' || l.kind === 'line' ? l.kind : 'points';
      var o = { id: l.id, name: l.name || '', kind: kind, color: l.color || '#2980B9', latlngs: ring(l.points), holes: [] };
      if (kind === 'polygon' && Array.isArray(l.holes)) o.holes = l.holes.map(ring).filter(function (h) { return h.length >= 3; });
      if (l.lot && o.latlngs.length) {          // otro lote del proyecto (2.15.0): más tenue, con su nombre y su área en el centro
        var la = 0, lo = 0;
        o.latlngs.forEach(function (q) { la += q[0]; lo += q[1]; });
        o.lot = true; o.lotId = l.lotId; o.label = (l.name || 'Lote') + (l.areaText ? ' · ' + l.areaText : '');
        o.at = [la / o.latlngs.length, lo / o.latlngs.length];
      }
      return o;
    });
    return out;
  }

  // ¿Dentro de qué otro lote cayó el toque? Devuelve su lotId o null. Solo cuentan los lotes con polígono (3 puntos o más).
  function inRing(lat, lon, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
  }
  function lotAt(ll, layers) {
    if (!ll || !isNum(ll.lat) || !isNum(ll.lon)) return null;
    var hit = null;
    (layers || []).forEach(function (l) {
      if (hit || !l || !l.lot || l.kind !== 'polygon') return;
      var pts = (l.points || []).filter(validLL);
      if (pts.length >= 3 && inRing(ll.lat, ll.lon, pts)) hit = l.lotId;
    });
    return hit;
  }

  function labelsVisible(zoom) { return isNum(zoom) && zoom >= LABEL_MIN_ZOOM; }

  // Texto de aviso cuando el mapa de fondo no puede cargar. state: { online, errors }. '' si no hace falta avisar.
  function tileNotice(state) {
    state = state || {};
    if (state.online === false) return 'Sin conexión: el mapa de fondo no se puede cargar. Tus puntos y el polígono se ven igual.';
    if ((state.errors || 0) >= TILE_ERRORS_BEFORE_NOTICE) return 'El mapa de fondo no está cargando. Revisa tu conexión; tus puntos y el polígono se ven igual.';
    return '';
  }

  // Posición del GPS lista para dibujar, o null si no sirve.
  function fixShape(fix) {
    if (!validLL(fix)) return null;
    return { lat: fix.lat, lon: fix.lon, acc: isNum(fix.acc) && fix.acc > 0 ? fix.acc : null };
  }

  /* ---------- Modos del mapa y gestos ---------- */
  function modeId(m) { return MODES.indexOf(m) >= 0 ? m : ''; }
  // Solo una casilla a la vez: tocar la que ya está activa la apaga; tocar la otra pasa a esa.
  function toggleMode(current, wanted) { var w = modeId(wanted); return !w || w === modeId(current) ? '' : w; }
  // Aviso corto del modo activo: va sobre el mapa y no debe tapar mucho (los puntos de debajo se siguen pudiendo tocar)
  function modeText(mode) {
    if (mode === 'add') return 'Ingresar puntos: toca el mapa.';
    if (mode === 'move') return 'Posición manual: mantén pulsado un punto ' + HOLD_MS / 1000 + ' s.';
    return '';
  }

  function pxDist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  // ¿Este toque repite al anterior (muy seguido y casi en el mismo sitio)? a y b: { x, y, t } con t en milisegundos.
  function isRepeatTap(a, b) { return !!a && !!b && b.t - a.t <= DOUBLE_TAP_MS && pxDist(a, b) <= DOUBLE_TAP_SLOP_PX; }

  // Los mismos puntos, con las coordenadas del que tiene ese id cambiadas (para ver el área y el perímetro mientras se arrastra).
  function withMoved(points, id, lat, lon) {
    return (points || []).map(function (p) { return p && p.id === id ? Object.assign({}, p, { lat: lat, lon: lon }) : p; });
  }

  // Gestos sobre un punto con «Posición manual». Es una máquina de estados sin pantalla ni reloj propios: el tiempo llega por
  // o.setTimer(fn, ms) / o.clearTimer(id) / o.now() (así se prueba en Node) y los avisos salen por o.onHold, o.onMove, o.onDrop, o.onAbort y o.onDouble.
  //  · mantener pulsado HOLD_MS sin moverse más de HOLD_SLOP_PX → el punto queda «levantado» (onHold); desde ahí cada movimiento llega a onMove y al soltar, a onDrop;
  //  · moverse más de HOLD_SLOP_PX antes de que pase el tiempo → se abandona (el dedo estaba arrastrando el mapa);
  //  · dos toques cortos seguidos sobre el mismo punto → onDouble.
  function pointGesture(o) {
    var cur = null, last = null, timer = null;
    function stopTimer() { if (timer !== null) { o.clearTimer(timer); timer = null; } }
    return {
      down: function (id, x, y) {
        if (cur) return;
        cur = { id: id, x: x, y: y, px: x, py: y, lifted: false, moved: false };
        timer = o.setTimer(function () { timer = null; cur.lifted = true; o.onHold(cur.id, cur.px, cur.py); }, HOLD_MS);
      },
      move: function (x, y) {
        if (!cur) return;
        cur.px = x; cur.py = y;
        if (cur.lifted) { cur.moved = true; o.onMove(cur.id, x, y); return; }
        if (pxDist({ x: x, y: y }, cur) > HOLD_SLOP_PX) { stopTimer(); cur = null; last = null; }
      },
      up: function (x, y) {
        if (!cur) return;
        var c = cur; cur = null; stopTimer();
        if (c.lifted) { last = null; o.onDrop(c.id, x, y, c.moved); return; }
        var tap = { id: c.id, x: x, y: y, t: o.now() };
        if (last && last.id === c.id && isRepeatTap(last, tap)) { last = null; o.onDouble(c.id); }
        else { last = tap; if (typeof o.onTap === 'function') o.onTap(c.id); }
      },
      cancel: function () {
        stopTimer();
        var c = cur; cur = null; last = null;
        if (c && c.lifted) o.onAbort(c.id);
      },
      state: function () { return !cur ? '' : cur.lifted ? 'lifted' : 'press'; }
    };
  }

  /* ---------- Medidas sobre el mapa ---------- */
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Rumbo de a hacia b, en grados desde el norte (0 a 360)
  function bearing(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180, dLon = (lon2 - lon1) * r;
    var y = Math.sin(dLon) * Math.cos(lat2 * r), x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  var WINDS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  function compass(deg) { return isNum(deg) ? WINDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : ''; }
  function plainDist(m) { return m >= 1000 ? (Math.round(m / 10) / 100) + ' km' : Math.round(m) + ' m'; }

  // Lados del polígono para rotularlos en el mapa: dónde va el rótulo (la mitad del lado), su longitud y después de qué punto
  // habría que insertar uno nuevo (after: posición en la lista). closed: el último se une con el primero.
  function sides(points, closed, distFn, fmtDist) {
    var pts = (points || []).filter(validLL), n = pts.length, out = [];
    if (n < 2) return out;
    var d = typeof distFn === 'function' ? distFn : haversine, f = typeof fmtDist === 'function' ? fmtDist : plainDist;
    var count = closed && n >= 3 ? n : n - 1;
    for (var i = 0; i < count; i++) {
      var a = pts[i], b = pts[(i + 1) % n], len = d(a.lat, a.lon, b.lat, b.lon);
      out.push({ after: i, a: [a.lat, a.lon], b: [b.lat, b.lon], mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], meters: len, text: f(len) });
    }
    return out;
  }
  // Un lado se rotula solo si en pantalla mide lo suficiente para que el rótulo no tape sus puntos; el «+» de insertar pide un poco más
  var SIDE_LABEL_MIN_PX = 64, SIDE_PLUS_MIN_PX = 96;
  function sideShows(px) { return { label: isNum(px) && px >= SIDE_LABEL_MIN_PX, plus: isNum(px) && px >= SIDE_PLUS_MIN_PX }; }

  // Resumen que va arriba del mapa. n: puntos; areaTxt y distTxt ya escritos por la app ('' si no hay).
  // Corto, para que quepa en una línea en teléfonos angostos: «0,54 ha · 318 m · 7 puntos» (el segundo dato es el perímetro).
  // crossed: los lados se cruzan; el área no sirve, así que en su lugar se dice eso (la app deja ordenar los puntos tocando el resumen).
  function summaryText(n, areaTxt, distTxt, crossed) {
    if (!isNum(n) || n <= 0) return '';
    if (n === 1) return '1 punto · faltan 2';
    if (n === 2) return (distTxt ? distTxt + ' · ' : '') + '2 puntos · falta 1';
    if (crossed) return 'Los lados se cruzan · toca para ordenar';
    return (areaTxt ? areaTxt + ' · ' : '') + (distTxt ? distTxt + ' · ' : '') + n + ' puntos';
  }
  // Dos rectángulos de pantalla { left, top, right, bottom } ¿se pisan? (para que el rótulo de un lado no tape el nombre de un punto)
  function rectsOverlap(a, b) {
    return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }
  // Dónde va el rótulo de un lado: en su sitio ('base'), al otro costado de la línea ('alt') si en su sitio pisa un nombre,
  // u oculto ('off') si en los dos pisa. hitsAlt es una función: solo se mira el otro costado cuando hace falta.
  function sidePlacement(hitsBase, hitsAlt) {
    if (!hitsBase) return 'base';
    return hitsAlt() ? 'off' : 'alt';
  }
  // Ir hasta un punto: qué decirle a la persona con cada lectura del GPS. ARRIVE_M: a esa distancia se da por llegada.
  var ARRIVE_M = 5;
  function navInfo(fix, pt, fmtDist) {
    var name = (pt && pt.name) || 'el punto';
    if (!validLL(pt)) return null;
    if (!validLL(fix)) return { text: name + ': esperando la posición del GPS…', arrived: false, bearing: null, meters: null };
    var m = haversine(fix.lat, fix.lon, pt.lat, pt.lon), f = typeof fmtDist === 'function' ? fmtDist : plainDist;
    if (m <= ARRIVE_M) return { text: 'Llegaste a ' + name + ' (a ' + Math.round(m) + ' m).', arrived: true, bearing: null, meters: m };   // tan cerca, los decimales no dicen nada
    var b = bearing(fix.lat, fix.lon, pt.lat, pt.lon);
    return { text: name + ': a ' + f(m) + ', hacia el ' + compass(b), arrived: false, bearing: b, meters: m };
  }

  // «a 58 m de ti, hacia el sureste»: dónde queda un punto respecto a la posición del GPS. '' si falta alguno de los dos.
  function relText(fix, pt, fmtDist) {
    if (!validLL(fix) || !validLL(pt)) return '';
    var m = haversine(fix.lat, fix.lon, pt.lat, pt.lon), f = typeof fmtDist === 'function' ? fmtDist : plainDist;
    if (m < 2) return 'estás sobre este punto';
    return 'a ' + f(m) + ' de ti, hacia el ' + compass(bearing(fix.lat, fix.lon, pt.lat, pt.lon));
  }

  // Medir: los lugares tocados forman tramos seguidos que se suman. Con dos lugares se da además el rumbo; con la figura cerrada
  // (3 lugares o más), el área y el perímetro.
  //  o: { closed, area(pts) → m², fmtArea(m²) → texto }   (sin area/fmtArea, cerrada solo da el perímetro)
  var MEASURE_MAX = 200;
  function measureLength(pts, closed) {
    var p = (pts || []).filter(validLL), m = 0;
    for (var i = 1; i < p.length; i++) m += haversine(p[i - 1].lat, p[i - 1].lon, p[i].lat, p[i].lon);
    if (closed && p.length >= 3) m += haversine(p[p.length - 1].lat, p[p.length - 1].lon, p[0].lat, p[0].lon);
    return m;
  }
  function measureText(pts, fmtDist, o) {
    var p = (pts || []).filter(validLL), f = typeof fmtDist === 'function' ? fmtDist : plainDist;
    o = o || {};
    if (!p.length) return 'Medir: toca lugares del mapa (o puntos) para sumar tramos.';
    if (p.length === 1) return 'Medir: toca el siguiente lugar.';
    if (p.length === 2) {
      var b = bearing(p[0].lat, p[0].lon, p[1].lat, p[1].lon);
      return f(measureLength(p)) + ' · rumbo ' + Math.round(b) % 360 + '° (' + compass(b) + ')';
    }
    if (o.closed) {
      var a = typeof o.area === 'function' && typeof o.fmtArea === 'function' ? o.fmtArea(o.area(p)) : '';
      return (a ? 'Área ' + a + ' · ' : '') + 'perímetro ' + f(measureLength(p, true));
    }
    return f(measureLength(p)) + ' en ' + (p.length - 1) + ' tramos';
  }
  // Cada lugar tocado se agrega al final (hasta MEASURE_MAX)
  function measureAdd(pts, ll) {
    var p = (pts || []).filter(validLL);
    if (!validLL(ll) || p.length >= MEASURE_MAX) return p;
    return p.concat([{ lat: ll.lat, lon: ll.lon }]);
  }

  /* ---------- Deshacer el último cambio del mapa ---------- */
  // Guarda cómo estaban los puntos de un proyecto antes de cada cambio (mover, insertar, borrar, reordenar…), hasta «max» pasos.
  //  push(pid, label, json): json es el estado ANTES del cambio (texto), label lo que se va a hacer («mover P3»)
  //  pop(pid, current): devuelve { label, json } del último cambio de ese proyecto que de verdad cambió algo, o null.
  //    Descarta por el camino los pasos de otro proyecto y los que dejan todo igual que ahora (por ejemplo, si ya se deshizo desde el aviso).
  //  peek(pid, current): lo mismo sin sacarlo.
  function undoStack(max) {
    var lim = isNum(max) && max > 0 ? Math.floor(max) : 20, items = [];
    function trim(pid, current) { while (items.length && (items[items.length - 1].pid !== pid || items[items.length - 1].json === current)) items.pop(); }
    return {
      push: function (pid, label, json) {
        if (typeof json !== 'string') return;
        if (items.length && items[items.length - 1].pid === pid && items[items.length - 1].json === json) return;   // dos avisos seguidos del mismo estado: uno solo
        items.push({ pid: pid, label: String(label || ''), json: json });
        if (items.length > lim) items.shift();
      },
      peek: function (pid, current) { trim(pid, current); var t = items[items.length - 1]; return t ? { label: t.label, json: t.json } : null; },
      pop: function (pid, current) { trim(pid, current); var t = items.pop(); return t ? { label: t.label, json: t.json } : null; },
      size: function () { return items.length; },
      clear: function () { items = []; }
    };
  }

  /* ---------- Caminar el lindero ---------- */
  // El GPS deja un punto cada cierta distancia mientras la persona recorre el borde del terreno.
  var TRACK_STEPS = [5, 10, 20, 50], TRACK_STEP_DEFAULT = 10, TRACK_MAX_ACC = 20;
  function trackStep(m) { m = Number(m); return TRACK_STEPS.indexOf(m) >= 0 ? m : TRACK_STEP_DEFAULT; }
  // ¿Qué se hace con esta lectura? 'add' (dejar un punto), 'near' (todavía cerca del anterior), 'imprecise' (lectura mala) o 'invalid'.
  //  last: último punto dejado (o null)   stepM: cada cuántos metros   maxAcc: precisión máxima aceptada (m)
  function trackDecision(last, fix, stepM, maxAcc) {
    if (!validLL(fix)) return 'invalid';
    var lim = isNum(maxAcc) && maxAcc > 0 ? maxAcc : TRACK_MAX_ACC;
    if (isNum(fix.acc) && fix.acc > lim) return 'imprecise';
    if (!validLL(last)) return 'add';
    return haversine(last.lat, last.lon, fix.lat, fix.lon) >= trackStep(stepM) ? 'add' : 'near';
  }
  function trackText(t) {
    t = t || {};
    var n = t.added || 0, base = 'Caminando el lindero: ' + n + (n === 1 ? ' punto' : ' puntos') + ' · uno cada ' + trackStep(t.step) + ' m';
    if (t.last === 'imprecise') return base + ' · esperando mejor señal del GPS';
    if (t.last === 'none') return base + ' · esperando la primera lectura del GPS';
    return base;
  }

  // Cambiar a mano el orden del recorrido: el punto pasa un puesto antes (delta −1) o después (+1). Devuelve una lista nueva;
  // si el punto no está o ya es el primero o el último en esa dirección, la devuelve igual.
  function moveInOrder(points, id, delta) {
    var pts = (points || []).slice(), i = -1;
    pts.forEach(function (q, k) { if (q && q.id === id) i = k; });
    var j = i + (delta < 0 ? -1 : 1);
    if (i < 0 || !delta || j < 0 || j >= pts.length) return pts;
    var t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    return pts;
  }
  // Puesto del punto en el recorrido: { pos: 3, n: 7, first: false, last: false } o null si no está
  function orderOf(points, id) {
    var pts = points || [], i = -1;
    pts.forEach(function (q, k) { if (q && q.id === id) i = k; });
    return i < 0 ? null : { pos: i + 1, n: pts.length, first: i === 0, last: i === pts.length - 1 };
  }

  // Herramientas del mapa que ocupan la franja de abajo (solo una a la vez): mira, medir, caminar e ir hasta un punto
  var TOOLS = ['mira', 'medir', 'caminar', 'ir'];
  function toolId(t) { return TOOLS.indexOf(t) >= 0 ? t : ''; }

  return {
    lotAt: lotAt, haversine: haversine, bearing: bearing, compass: compass, sides: sides, sideShows: sideShows, SIDE_LABEL_MIN_PX: SIDE_LABEL_MIN_PX, SIDE_PLUS_MIN_PX: SIDE_PLUS_MIN_PX,
    summaryText: summaryText, relText: relText, measureText: measureText, measureAdd: measureAdd, measureLength: measureLength, MEASURE_MAX: MEASURE_MAX, undoStack: undoStack,
    TRACK_STEPS: TRACK_STEPS, TRACK_STEP_DEFAULT: TRACK_STEP_DEFAULT, TRACK_MAX_ACC: TRACK_MAX_ACC, trackStep: trackStep, trackDecision: trackDecision, trackText: trackText,
    rectsOverlap: rectsOverlap, sidePlacement: sidePlacement, navInfo: navInfo, ARRIVE_M: ARRIVE_M,
    TOOLS: TOOLS, toolId: toolId, moveInOrder: moveInOrder, orderOf: orderOf,
    MODES: MODES, HOLD_MS: HOLD_MS, HOLD_SLOP_PX: HOLD_SLOP_PX, TAP_SLOP_PX: TAP_SLOP_PX, DOUBLE_TAP_MS: DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX: DOUBLE_TAP_SLOP_PX,
    pointColor: pointColor, modeId: modeId, toggleMode: toggleMode, modeText: modeText, isRepeatTap: isRepeatTap, withMoved: withMoved, pointGesture: pointGesture,
    BASES: BASES, REFERENCE: REFERENCE, LABEL_MIN_ZOOM: LABEL_MIN_ZOOM, COLOMBIA: COLOMBIA, TILE_ERRORS_BEFORE_NOTICE: TILE_ERRORS_BEFORE_NOTICE,
    baseId: baseId, pointLabel: pointLabel, lastPoint: lastPoint, visibleLayers: visibleLayers, extent: extent, shapes: shapes,
    labelsVisible: labelsVisible, tileNotice: tileNotice, fixShape: fixShape
  };
});

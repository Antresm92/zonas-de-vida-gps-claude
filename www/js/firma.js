/* firma.js — la firma dibujada con el dedo (2.34.3).
 * Un recuadro donde se firma con el dedo (o con el ratón). Al terminar se recorta a lo dibujado y se guarda como JPEG
 * con fondo blanco, igual que la firma en foto, para que el reporte (HTML y PDF) la ponga como cualquier imagen.
 * Los trazos se guardan como listas de puntos en píxeles de pantalla; bounds, length, isEmpty y outSize son funciones
 * puras, para las pruebas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Firma = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LINE = 2.6, INK = '#141414', MAX_W = 600, MAX_H = 240, MIN_LEN = 40, PAD = 12;

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  // Caja que encierra todos los trazos ([[{x, y}, …], …]); null si no hay ningún punto
  function bounds(strokes) {
    var b = null;
    (strokes || []).forEach(function (s) {
      (s || []).forEach(function (p) {
        if (!b) { b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }
        if (p.x < b.x0) b.x0 = p.x; if (p.y < b.y0) b.y0 = p.y;
        if (p.x > b.x1) b.x1 = p.x; if (p.y > b.y1) b.y1 = p.y;
      });
    });
    return b;
  }
  // Largo total de los trazos, en píxeles
  function length(strokes) {
    var L = 0;
    (strokes || []).forEach(function (s) { for (var i = 1; i < (s || []).length; i++) L += dist(s[i], s[i - 1]); });
    return L;
  }
  // Un toque suelto o un rayón muy corto no es una firma
  function isEmpty(strokes) { return length(strokes) < MIN_LEN; }
  // Tamaño de la imagen: lo dibujado más un margen, agrandado o achicado (los trazos no pierden calidad) hasta MAX_W × MAX_H
  function outSize(b, pad, maxW, maxH) {
    var w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad, k = Math.min((maxW || MAX_W) / w, (maxH || MAX_H) / h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k: k };
  }

  // Dibuja los trazos con curvas suaves por los puntos medios; k: escala, (ox, oy): esquina de lo que se dibuja
  function drawStrokes(ctx, strokes, k, ox, oy, width) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = width;
    function X(p) { return (p.x - ox) * k; }
    function Y(p) { return (p.y - oy) * k; }
    strokes.forEach(function (s) {
      if (!s.length) return;
      if (s.length === 1) { ctx.beginPath(); ctx.arc(X(s[0]), Y(s[0]), width / 2, 0, Math.PI * 2); ctx.fill(); return; }
      ctx.beginPath(); ctx.moveTo(X(s[0]), Y(s[0]));
      for (var i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(X(s[i]), Y(s[i]), (X(s[i]) + X(s[i + 1])) / 2, (Y(s[i]) + Y(s[i + 1])) / 2);
      ctx.lineTo(X(s[s.length - 1]), Y(s[s.length - 1]));
      ctx.stroke();
    });
  }

  // El recuadro para firmar. canvas: el <canvas> ya puesto en la página; onChange(vacio) avisa al terminar cada trazo.
  // Devuelve { clear, isEmpty, strokes, toJpeg(document) → Promise<Uint8Array> }.
  function pad(canvas, onChange, env) {
    env = env || (typeof window !== 'undefined' ? window : {});
    var strokes = [], cur = null, ratio = 1, ctx = canvas.getContext('2d');
    if (!ctx) return null;
    function redraw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStrokes(ctx, strokes, ratio, 0, 0, LINE * ratio);
    }
    function size() {                                       // el tamaño en pantalla (sin las animaciones de la hoja) × la densidad
      ratio = env.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      redraw();
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect(), sx = r.width ? canvas.clientWidth / r.width : 1, sy = r.height ? canvas.clientHeight / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }
    function down(e) {
      if (e.button > 0) return;
      e.preventDefault();
      if (canvas.width !== Math.max(1, Math.round(canvas.clientWidth * (env.devicePixelRatio || 1)))) size();     // giró el teléfono: se ajusta y se redibuja
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* nada */ }
      cur = [pos(e)]; strokes.push(cur);
      drawStrokes(ctx, [cur], ratio, 0, 0, LINE * ratio);
    }
    function move(e) {
      if (!cur) return;
      e.preventDefault();
      var p = pos(e), l = cur[cur.length - 1];
      if (dist(p, l) < 1) return;
      cur.push(p);
      drawStrokes(ctx, [[l, p]], ratio, 0, 0, LINE * ratio);   // mientras firma, solo el tramo nuevo; al soltar se redibuja suave
    }
    function up() {
      if (!cur) return;
      cur = null; redraw();
      if (onChange) onChange(isEmpty(strokes));
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    size();
    return {
      clear: function () { strokes = []; cur = null; redraw(); if (onChange) onChange(true); },
      isEmpty: function () { return isEmpty(strokes); },
      strokes: function () { return strokes; },
      resize: size,
      toJpeg: function (doc) {
        var b = bounds(strokes);
        if (!b || isEmpty(strokes)) return Promise.reject(new Error('Dibuja la firma primero.'));
        var o = outSize(b, PAD, MAX_W, MAX_H), c = (doc || env.document).createElement('canvas');
        c.width = o.w; c.height = o.h;
        var x = c.getContext('2d');
        if (!x) return Promise.reject(new Error('Este dispositivo no puede preparar la firma.'));
        x.fillStyle = '#fff'; x.fillRect(0, 0, o.w, o.h);             // el JPEG no tiene transparencia: fondo blanco
        drawStrokes(x, strokes, o.k, b.x0 - PAD, b.y0 - PAD, LINE * o.k);
        return new Promise(function (resolve, reject) {
          c.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('No se pudo preparar la firma.')); }, 'image/jpeg', 0.92);
        }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
          var bytes = new Uint8Array(buf);
          if (!(bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)) throw new Error('No se pudo preparar la firma.');
          return bytes;
        });
      }
    };
  }

  return { pad: pad, bounds: bounds, length: length, isEmpty: isEmpty, outSize: outSize, MAX_W: MAX_W, MAX_H: MAX_H, MIN_LEN: MIN_LEN };
});

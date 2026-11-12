/* pdf.js — escritor de PDF sin dependencias (sin internet, sin código nativo de Android).
 *
 * Recibe una lista de bloques (título, párrafo, tabla, imagen JPEG…) y devuelve los bytes de un PDF en hoja A4 con varias páginas.
 *   - Letra: Helvetica y Helvetica negrita, que todo lector de PDF trae; no se incrusta ninguna fuente. Eso limita el texto al
 *     alfabeto latino de Windows (CP1252: tildes, ñ, ¿, ¡, °, ±…); lo demás se cambia por algo parecido (≥ por >=) o por «?».
 *   - Imágenes: solo JPEG (se incrustan tal cual, sin recomprimir). Las gráficas SVG las convierte a JPEG la app antes de llamar aquí.
 *   - Sin compresión del texto: el reporte es corto y así el archivo es fácil de revisar.
 * Es la parte «pura»: no toca el navegador, así que se prueba entera en Node y con herramientas reales de PDF.
 *
 * Bloques (b.t):
 *   h1 {text} · sub {text} · h2 {text} · h3 {text, color?} · p {text, small?} · note {text} · list {items}
 *   table {rows: [[etiqueta, valor, colorDelPunto?]]} · zone {symbol, name, detail}
 *   legend {items: [[color, nombre]]} · image {img: {bytes}, maxW?, caption?} · gallery {items: [{img, caption}], per?} · spacer {h} · pagebreak {}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAGE = { w: 595.28, h: 841.89 };                 // A4 en puntos (1 pt = 1/72 de pulgada)
  var M = { l: 48, r: 48, t: 52, b: 58 };              // márgenes
  var C = { text: '#14301F', gray: '#5B6F61', line: '#D6DED8', green: '#2F8F4E', soft: '#DAEBDF', note: '#F2F5EF', red: '#D8353C' };

  /* ---------- Texto: CP1252 y anchos de Helvetica (AFM, milésimas de em) ---------- */
  // ASCII 32..126: regular y negrita
  var WR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // 0xA0..0xBF (símbolos), regular y negrita
  var SYMR = [278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611];
  var SYMB = [278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611];
  // 0xC0..0xFF: letra de la que toma el ancho (· = símbolo con ancho propio, ver SPECIAL)
  var BASE = 'AAAAAA.CEEEEIIII' + 'DNOOOOO.OUUUUY.B' + 'aaaaaa.ceeeeiiii' + 'dnooooo.ouuuuypy';
  var SPECIAL = { 0xC6: [1000, 1000], 0xD7: [584, 584], 0xDE: [667, 667], 0xE6: [889, 889], 0xF7: [584, 584], 0xD0: [722, 722], 0xF0: [556, 611], 0xDF: [611, 611] };
  // Unicode → CP1252 para 0x80..0x9F, con su ancho (regular, negrita)
  var WIN = { '€': [0x80, 556, 556], '‚': [0x82, 222, 278], 'ƒ': [0x83, 556, 556], '„': [0x84, 333, 500], '…': [0x85, 1000, 1000], '†': [0x86, 556, 556], '‡': [0x87, 556, 556], 'ˆ': [0x88, 333, 333],
    '‰': [0x89, 1000, 1000], 'Š': [0x8A, 667, 722], '‹': [0x8B, 333, 333], 'Œ': [0x8C, 1000, 1000], 'Ž': [0x8E, 611, 722], '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500],
    '”': [0x94, 333, 500], '•': [0x95, 350, 350], '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], '˜': [0x98, 333, 333], '™': [0x99, 1000, 1000], 'š': [0x9A, 500, 556], '›': [0x9B, 333, 333],
    'œ': [0x9C, 944, 944], 'ž': [0x9E, 500, 500], 'Ÿ': [0x9F, 667, 667] };
  var WIN_BY_CODE = {};
  Object.keys(WIN).forEach(function (k) { WIN_BY_CODE[WIN[k][0]] = WIN[k]; });
  // Símbolos que CP1252 no tiene: se cambian por algo parecido
  var SWAP = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '↔': '<->', '−': '-', '‐': '-', '‑': '-', '≈': '~', '≠': '!=', '∞': 'inf.', '✓': 'si', '✔': 'si', '✗': 'no', '✘': 'no', '′': "'", '″': '"', '⁄': '/', ' ': ' ', ' ': ' ' };

  function glyphWidth(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? WB : WR)[code - 32];
    if (code >= 0xA0 && code <= 0xBF) return (bold ? SYMB : SYMR)[code - 0xA0];
    if (code >= 0xC0 && code <= 0xFF) {
      if (SPECIAL[code]) return SPECIAL[code][bold ? 1 : 0];
      var ch = BASE.charAt(code - 0xC0);
      return ch === 'i' || ch === 'I' ? 278 : glyphWidth(ch.charCodeAt(0), bold);          // ì í î ï miden 278 aunque la «i» mida 222
    }
    if (WIN_BY_CODE[code]) return WIN_BY_CODE[code][bold ? 2 : 1];
    return 556;
  }

  // Texto cualquiera → texto «normalizado»: cada carácter vale entre 0 y 255 (su código en CP1252). Se conserva \n.
  function norm(text) {
    var s = String(text === null || text === undefined ? '' : text), out = '', i, ch, cp, rep, d;
    for (i = 0; i < s.length; i++) {
      cp = s.codePointAt(i); ch = String.fromCodePoint(cp);
      if (cp > 0xFFFF) i++;
      if (ch === '\n') { out += '\n'; continue; }
      if (ch === '\r' || cp === 0xFEFF || (cp >= 0x200B && cp <= 0x200D)) continue;
      if (cp === 9) { out += ' '; continue; }
      if (cp < 32 || (cp >= 0x7F && cp < 0xA0)) continue;
      if (cp <= 0x7E || (cp >= 0xA0 && cp <= 0xFF)) { out += ch; continue; }
      if (WIN[ch]) { out += String.fromCharCode(WIN[ch][0]); continue; }
      rep = SWAP[ch];
      if (rep !== undefined) { out += rep; continue; }
      d = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');          // «ā» → «a»
      out += d.length === 1 && d.charCodeAt(0) <= 0xFF && d.charCodeAt(0) >= 32 ? d : '?';
    }
    return out;
  }

  function widthOf(s, size, bold) {
    var t = 0;
    for (var i = 0; i < s.length; i++) t += glyphWidth(s.charCodeAt(i), bold);
    return t * size / 1000;
  }

  // Parte un texto en líneas que no pasen de «max» puntos. Una palabra más ancha que la línea se parte por caracteres.
  function wrap(s, size, bold, max) {
    var out = [];
    s.split('\n').forEach(function (para) {
      var words = para.split(' ').filter(function (w) { return w.length; }), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var cand = line ? line + ' ' + w : w;
        if (widthOf(cand, size, bold) <= max) { line = cand; return; }
        if (line) { out.push(line); line = ''; }
        while (w.length > 1 && widthOf(w, size, bold) > max) {
          var k = 1;
          while (k < w.length - 1 && widthOf(w.slice(0, k + 1), size, bold) <= max) k++;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      });
      out.push(line);
    });
    return out;
  }

  /* ---------- JPEG ---------- */
  // Mide un JPEG sin decodificarlo. null si no es un JPEG que este escritor pueda incrustar (solo gris y color RGB).
  function jpegInfo(b) {
    if (!b || b.length < 12 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    var i = 2, m, len;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        var info = { bits: b[i + 4], h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
        return info.w > 0 && info.h > 0 && info.bits === 8 && (info.comps === 1 || info.comps === 3) ? info : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }

  /* ---------- Salida PDF ---------- */
  function num(x) { var s = (Math.round(x * 100) / 100).toString(); return s === '-0' ? '0' : s; }
  function hexOf(s) { var h = ''; for (var i = 0; i < s.length; i++) h += (s.charCodeAt(i) < 16 ? '0' : '') + s.charCodeAt(i).toString(16); return h; }
  function utf16(text) {                                  // cadena de texto PDF en UTF-16BE (admite cualquier carácter)
    var h = 'FEFF', s = String(text === null || text === undefined ? '' : text);
    for (var i = 0; i < s.length; i++) h += ('0000' + s.charCodeAt(i).toString(16)).slice(-4);
    return '<' + h.toUpperCase() + '>';
  }
  function rgb(hex) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(hex || '') || /^#([0-9a-fA-F]{6})$/.exec(C.text);
    var v = parseInt(m[1], 16);
    return num(((v >> 16) & 255) / 255) + ' ' + num(((v >> 8) & 255) / 255) + ' ' + num((v & 255) / 255);
  }
  function dateStr(ms) {
    var d = new Date(typeof ms === 'number' && isFinite(ms) ? ms : Date.now());
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  /* ---------- Maquetación ---------- */
  function Doc(o) {
    this.o = o || {};
    this.pages = [];
    this.images = [];                                      // { bytes, info, name }
    this.y = 0;
    this.W = PAGE.w - M.l - M.r;                           // ancho útil
    this.page();
  }
  Doc.prototype.page = function () {
    this.pages.push({ ops: [], xo: {} });
    this.y = M.t;
  };
  Doc.prototype.op = function (s) { this.pages[this.pages.length - 1].ops.push(s); };
  Doc.prototype.top = function () { return this.y <= M.t + 0.01; };
  Doc.prototype.room = function () { return PAGE.h - M.b - this.y; };
  Doc.prototype.need = function (h) { if (!this.top() && this.room() < h) this.page(); };

  // Texto con la esquina superior izquierda de su renglón en (x, y); y crece hacia abajo
  Doc.prototype.text = function (x, y, s, size, bold, color) {
    if (!s) return;
    this.op('BT /F' + (bold ? 2 : 1) + ' ' + num(size) + ' Tf ' + rgb(color || C.text) + ' rg ' + num(x) + ' ' + num(PAGE.h - y - size * 0.92) + ' Td <' + hexOf(s) + '> Tj ET');
  };
  Doc.prototype.rect = function (x, y, w, h, fill) { this.op(rgb(fill) + ' rg ' + num(x) + ' ' + num(PAGE.h - y - h) + ' ' + num(w) + ' ' + num(h) + ' re f'); };
  Doc.prototype.hline = function (x1, x2, y, width, color) { this.op(rgb(color) + ' RG ' + num(width) + ' w ' + num(x1) + ' ' + num(PAGE.h - y) + ' m ' + num(x2) + ' ' + num(PAGE.h - y) + ' l S'); };
  Doc.prototype.dot = function (cx, cy, r, fill) {         // círculo relleno con borde fino (cuatro curvas de Bézier)
    var k = 0.5523 * r, X = cx, Y = PAGE.h - cy;
    this.op(rgb(fill) + ' rg 0.5 w 0.3 0.3 0.3 RG ' + num(X + r) + ' ' + num(Y) + ' m ' +
      num(X + r) + ' ' + num(Y + k) + ' ' + num(X + k) + ' ' + num(Y + r) + ' ' + num(X) + ' ' + num(Y + r) + ' c ' +
      num(X - k) + ' ' + num(Y + r) + ' ' + num(X - r) + ' ' + num(Y + k) + ' ' + num(X - r) + ' ' + num(Y) + ' c ' +
      num(X - r) + ' ' + num(Y - k) + ' ' + num(X - k) + ' ' + num(Y - r) + ' ' + num(X) + ' ' + num(Y - r) + ' c ' +
      num(X + k) + ' ' + num(Y - r) + ' ' + num(X + r) + ' ' + num(Y - k) + ' ' + num(X + r) + ' ' + num(Y) + ' c B');
  };
  Doc.prototype.addImage = function (img) {
    var found = null;
    this.images.forEach(function (e) { if (e.src === img.bytes) found = e; });
    if (found) return found;
    var info = jpegInfo(img && img.bytes);
    if (!info) return null;
    found = { src: img.bytes, bytes: img.bytes, info: info, name: 'Im' + (this.images.length + 1) };
    this.images.push(found);
    return found;
  };
  Doc.prototype.draw = function (e, x, y, w, h) {
    this.pages[this.pages.length - 1].xo[e.name] = true;
    this.op('q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(PAGE.h - y - h) + ' cm /' + e.name + ' Do Q');
  };

  // Un párrafo suelto: línea a línea, pasando de página cuando hace falta
  Doc.prototype.lines = function (s, size, bold, color, x, width, lh) {
    var self = this;
    wrap(norm(s), size, bold, width).forEach(function (ln) {
      self.need(lh);
      self.text(x, self.y, ln, size, bold, color);
      self.y += lh;
    });
  };

  Doc.prototype.block = function (b, next) {
    var self = this;
    if (!b || typeof b !== 'object') return;
    switch (b.t) {
      case 'h1': this.lines(b.text, 22, true, C.text, M.l, this.W, 27); this.y += 1; break;
      case 'sub': this.lines(b.text, 11.5, false, C.gray, M.l, this.W, 16); this.y += 8; break;
      case 'h2':
        this.need(Math.max(80, 44 + this.nextHeight(next)));         // el título (41 puntos con su raya) no se queda solo al final de la hoja
        if (!this.top()) this.y += 14;
        this.lines(b.text, 14, true, C.text, M.l, this.W, 19);
        this.hline(M.l, M.l + this.W, this.y + 1, 1.2, C.green);
        this.y += 8;
        break;
      case 'h3':
        this.need(Math.max(50, 30 + this.nextHeight(next))); this.y += 6;
        if (b.color) { this.dot(M.l + 4, this.y + 7, 3.6, b.color); this.lines(b.text, 11.5, true, C.text, M.l + 13, this.W - 13, 15); } else this.lines(b.text, 11.5, true, C.text, M.l, this.W, 15);
        this.y += 3;
        break;
      case 'p': {
        var small = !!b.small;
        this.lines(b.text, small ? 9 : 10.5, false, small ? C.gray : C.text, M.l, this.W, small ? 12.5 : 14.5);
        this.y += 5;
        break;
      }
      case 'note': {
        // El recuadro se dibuja renglón por renglón para que un aviso largo pueda pasar de página
        var nl = wrap(norm(b.text), 10, false, this.W - 22);
        this.need(Math.min(nl.length * 14 + 12, 200));
        nl.forEach(function (ln, k) {
          var pad = k === 0 ? 6 : 0, h = 14 + pad + (k === nl.length - 1 ? 6 : 0);
          if (self.room() < h) self.page();
          self.rect(M.l, self.y, self.W, h, C.note);
          self.rect(M.l, self.y, 3, h, C.red);
          self.text(M.l + 12, self.y + pad, ln, 10, false, C.text);
          self.y += h;
        });
        this.y += 6;
        break;
      }
      case 'list':
        (b.items || []).forEach(function (it) {
          var l2 = wrap(norm(it), 10.5, false, self.W - 14);
          self.need(15);
          self.text(M.l + 3, self.y, '\x95', 10.5, false, C.green);
          l2.forEach(function (ln) { self.need(14.5); self.text(M.l + 14, self.y, ln, 10.5, false, C.text); self.y += 14.5; });
        });
        this.y += 4;
        break;
      case 'table': this.table(b.rows || []); break;
      case 'zone': this.zone(b); break;
      case 'legend': this.legend(b.items || []); break;
      case 'image': this.image(b); break;
      case 'gallery': this.gallery(b); break;
      case 'spacer': this.y += typeof b.h === 'number' ? b.h : 8; break;
      case 'pagebreak': if (!this.top()) this.page(); break;
      default: break;
    }
  };

  Doc.prototype.table = function (rows) {
    var self = this, lw = Math.min(190, this.W * 0.4), vx = M.l + lw + 10, vw = this.W - lw - 10;
    rows.forEach(function (r) {
      var lab = wrap(norm(r[0]), 10, false, lw - (r[2] ? 14 : 4)), val = wrap(norm(r[1]), 10, false, vw);
      var n = Math.max(lab.length, val.length, 1), h = n * 13.5 + 8;
      self.need(h);
      if (r[2]) self.dot(M.l + 5, self.y + 4 + 6.5, 3.6, r[2]);
      lab.forEach(function (ln, k) { self.text(M.l + (r[2] ? 14 : 0), self.y + 4 + k * 13.5, ln, 10, false, C.gray); });
      val.forEach(function (ln, k) { self.text(vx, self.y + 4 + k * 13.5, ln, 10, false, C.text); });
      self.hline(M.l, M.l + self.W, self.y + h, 0.6, C.line);
      self.y += h;
    });
    this.y += 8;
  };

  Doc.prototype.zone = function (b) {
    var cx = M.l + 28, w = 56, h = 64;
    this.need(h + 10);
    var y = this.y + 2, pts = [[0.5, 0.02], [0.98, 0.25], [0.98, 0.75], [0.5, 0.98], [0.02, 0.75], [0.02, 0.25]], d = '';
    pts.forEach(function (p, k) { d += num(M.l + p[0] * w) + ' ' + num(PAGE.h - (y + p[1] * h)) + (k ? ' l ' : ' m '); });
    this.op(rgb(C.soft) + ' rg ' + rgb(C.green) + ' RG 2 w ' + d + 'h B');
    var sym = norm(b.symbol), sw = widthOf(sym, 14, true);
    this.text(cx - sw / 2, y + h / 2 - 8, sym, 14, true, C.text);
    var x = M.l + w + 14, tw = this.W - w - 14;
    var nm = wrap(norm(b.name), 17, true, tw), dt = wrap(norm(b.detail), 10, false, tw), top = y + (h - (nm.length * 21 + dt.length * 13.5)) / 2;
    var yy = Math.max(top, y);
    var self = this;
    nm.forEach(function (ln) { self.text(x, yy, ln, 17, true, C.text); yy += 21; });
    dt.forEach(function (ln) { self.text(x, yy, ln, 10, false, C.gray); yy += 13.5; });
    this.y = Math.max(y + h, yy) + 8;
  };

  // Leyenda: cuadritos de color con su nombre, en renglones que se ajustan al ancho
  Doc.prototype.legend = function (items) {
    var self = this, x = M.l, lh = 14;
    this.need(lh + 4);
    items.forEach(function (it) {
      var name = norm(it[1]), w = 12 + widthOf(name, 9, false) + 14;
      if (x > M.l && x + w > M.l + self.W) { x = M.l; self.y += lh; self.need(lh); }
      self.rect(x, self.y + 2, 8, 8, it[0]);
      self.text(x + 12, self.y + 1, name, 9, false, C.text);
      x += w;
    });
    this.y += lh + 4;
  };

  // Tamaño con que entra una imagen: no pasa del ancho pedido, ni del ancho útil, ni de una página
  Doc.prototype.fit = function (info, maxW, maxH) {
    var w = Math.min(maxW || this.W, this.W), h = w * info.h / info.w;
    if (h > maxH) { h = maxH; w = h * info.w / info.h; }
    return { w: w, h: h };
  };

  // Alto que ocupa el bloque que viene después de un título (imagen con su leyenda, o la primera fila de fotos); 0 si no hace falta
  Doc.prototype.nextHeight = function (b) {
    var self = this;
    if (b && b.t === 'image') {
      var info = jpegInfo(b.img && b.img.bytes);
      return info ? this.fit(info, b.maxW, this.imageMaxH(b)).h + 6 + this.captionHeight(b) : 0;
    }
    if (b && b.t === 'gallery') {
      var per = b.per || 3, cw = (this.W - 10 * (per - 1)) / per;
      var first = (b.items || []).slice(0, per).map(function (it) { return jpegInfo(it && it.img && it.img.bytes); }).filter(Boolean);
      return first.length ? Math.max.apply(null, first.map(function (i) { return self.fit(i, cw, 260).h; })) + 20 : 0;
    }
    return 0;
  };
  // Una imagen nunca mide más que una hoja menos el espacio de un título, para que un título y su imagen siempre quepan juntos en una hoja nueva
  Doc.prototype.imageMaxH = function (b) { var h = PAGE.h - M.t - M.b - 60 - this.captionHeight(b) - 6; return b.maxH > 0 ? Math.min(h, b.maxH) : h; };
  Doc.prototype.captionHeight = function (b) { return b.caption ? wrap(norm(b.caption), 9, false, this.W).length * 12.5 + 5 : 0; };

  Doc.prototype.image = function (b) {
    var e = b.img && this.addImage(b.img);
    if (!e) { this.block({ t: 'note', text: 'No se pudo incluir esta imagen.' }); return; }
    var s = this.fit(e.info, b.maxW, this.imageMaxH(b));
    this.need(s.h + 6 + this.captionHeight(b));
    this.draw(e, M.l, this.y, s.w, s.h);
    this.y += s.h + 6;
    if (b.caption) this.block({ t: 'p', text: b.caption, small: true });
  };

  Doc.prototype.gallery = function (b) {
    var self = this, per = b.per || 3, gap = 10, cw = (this.W - gap * (per - 1)) / per, items = (b.items || []).slice();
    while (items.length) {
      var row = items.splice(0, per).map(function (it) { var e = it && it.img && self.addImage(it.img); return e ? { e: e, cap: it.caption, s: self.fit(e.info, cw, 260) } : null; }).filter(Boolean);
      if (!row.length) continue;
      var h = Math.max.apply(null, row.map(function (r) { return r.s.h; })) + 16;
      this.need(h + 4);
      row.forEach(function (r, k) {
        var x = M.l + k * (cw + gap);
        self.draw(r.e, x, self.y, r.s.w, r.s.h);
        if (r.cap) self.text(x, self.y + r.s.h + 2, norm(r.cap), 8.5, false, C.gray);
      });
      this.y += h + 4;
    }
  };

  /* ---------- Armado del archivo ---------- */
  Doc.prototype.finish = function () {
    var self = this, o = this.o, total = this.pages.length, footer = norm(o.footer || '');
    // Pie de página: título a la izquierda, «Página n de N» a la derecha
    this.pages.forEach(function (pg, k) {
      var right = norm('Página ' + (k + 1) + ' de ' + total), y = PAGE.h - 34;
      pg.ops.push(rgb(C.line) + ' RG 0.6 w ' + num(M.l) + ' ' + num(PAGE.h - (y - 6)) + ' m ' + num(PAGE.w - M.r) + ' ' + num(PAGE.h - (y - 6)) + ' l S');
      if (footer) pg.ops.push('BT /F1 8 Tf ' + rgb(C.gray) + ' rg ' + num(M.l) + ' ' + num(PAGE.h - y - 7) + ' Td <' + hexOf(footer.slice(0, 80)) + '> Tj ET');
      pg.ops.push('BT /F1 8 Tf ' + rgb(C.gray) + ' rg ' + num(PAGE.w - M.r - widthOf(right, 8, false)) + ' ' + num(PAGE.h - y - 7) + ' Td <' + hexOf(right) + '> Tj ET');
    });

    var parts = [], len = 0, offsets = [];
    function put(x) {
      if (typeof x === 'string') { var u = new Uint8Array(x.length); for (var i = 0; i < x.length; i++) u[i] = x.charCodeAt(i) & 255; x = u; }
      parts.push(x); len += x.length;
    }
    function obj(n, body) { offsets[n] = len; put(n + ' 0 obj\n'); body.forEach(put); put('\nendobj\n'); }

    // Numeración: 1 catálogo, 2 páginas, 3 y 4 fuentes, 5 información, luego imágenes, luego (página, contenido) por cada hoja
    var firstImg = 6, firstPage = firstImg + this.images.length, kids = [], n;
    this.pages.forEach(function (_, k) { kids.push((firstPage + k * 2) + ' 0 R'); });
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R /Lang (es) >>']);
    obj(2, ['<< /Type /Pages /Count ' + total + ' /Kids [' + kids.join(' ') + '] >>']);
    obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
    obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
    obj(5, ['<< /Title ' + utf16(o.title) + ' /Author ' + utf16(o.author) + ' /Subject ' + utf16(o.subject) + ' /Creator ' + utf16(o.creator || 'Zonas de Vida') + ' /Producer ' + utf16('Zonas de Vida (pdf.js)') + ' /CreationDate (' + dateStr(o.date) + ') >>']);
    this.images.forEach(function (e, k) {
      var cs = e.info.comps === 1 ? '/DeviceGray' : '/DeviceRGB';
      obj(firstImg + k, ['<< /Type /XObject /Subtype /Image /Width ' + e.info.w + ' /Height ' + e.info.h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + e.bytes.length + ' >>\nstream\n', e.bytes, '\nendstream']);
    });
    this.pages.forEach(function (pg, k) {
      n = firstPage + k * 2;
      var xo = Object.keys(pg.xo).map(function (nm) { return '/' + nm + ' ' + (firstImg + parseInt(nm.slice(2), 10) - 1) + ' 0 R'; }).join(' ');
      obj(n, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE.w + ' ' + PAGE.h + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> /Contents ' + (n + 1) + ' 0 R >>']);
      var content = pg.ops.join('\n');
      obj(n + 1, ['<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream']);
    });
    var count = firstPage + this.pages.length * 2, xref = len, x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var i = 1; i < count; i++) x += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    var out = new Uint8Array(len), p = 0;
    parts.forEach(function (u) { out.set(u, p); p += u.length; });
    return out;
  };

  // blocks: lista de bloques. o: { title, author, subject, creator, date (ms), footer }
  function build(blocks, o) {
    var d = new Doc(o);
    var list = Array.isArray(blocks) ? blocks : [];
    list.forEach(function (b, i) { d.block(b, list[i + 1]); });
    return d.finish();
  }

  return { build: build, jpegInfo: jpegInfo, norm: norm, widthOf: widthOf, wrap: wrap, glyphWidth: glyphWidth, PAGE: PAGE, MARGINS: M };
});

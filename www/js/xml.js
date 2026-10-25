/* xml.js — lector XML mínimo para archivos KML y GPX. Sin dependencias: funciona en el navegador y en Node.
 *
 * - Quita los prefijos de espacio de nombres (gx:altitudeMode → altitudeMode, atom:link → link).
 * - Solo conoce las entidades predefinidas (&amp; &lt; &gt; &quot; &apos; y &#N; / &#xH;): un archivo no puede
 *   "expandir" texto con entidades propias (las declaraciones DOCTYPE se saltan sin procesarse).
 * - Limita la profundidad de anidamiento. Lanza Error con mensaje en español si el XML está mal formado. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xml = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DEPTH = 200;

  function isSpace(c) { return c === 32 || c === 9 || c === 10 || c === 13; }
  function local(name) { var i = name.indexOf(':'); return i < 0 ? name : name.slice(i + 1); }

  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      switch (e) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
      }
      var cp = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp >= 0 && cp <= 0x10FFFF) || (cp >= 0xD800 && cp <= 0xDFFF)) return '';
      return String.fromCodePoint(cp);
    });
  }

  // Devuelve el elemento raíz: { name, attrs, children[], text, parent }
  function parse(src) {
    var text = String(src === null || src === undefined ? '' : src);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var n = text.length, i = 0, depth = 0;
    var top = { name: '#document', attrs: Object.create(null), children: [], text: '', parent: null };
    var cur = top;

    function fail(msg, at) { throw new Error('XML no válido: ' + msg + ' (posición ' + at + ')'); }

    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) { if (cur !== top) cur.text += decode(text.slice(i)); break; }
      if (lt > i && cur !== top) cur.text += decode(text.slice(i, lt));
      var c1 = text.charAt(lt + 1);

      if (c1 === '!') {
        if (text.substr(lt, 4) === '<!--') {
          var ce = text.indexOf('-->', lt + 4);
          if (ce < 0) fail('comentario sin cerrar', lt);
          i = ce + 3; continue;
        }
        if (text.substr(lt, 9) === '<![CDATA[') {
          var de = text.indexOf(']]>', lt + 9);
          if (de < 0) fail('CDATA sin cerrar', lt);
          if (cur !== top) cur.text += text.slice(lt + 9, de);
          i = de + 3; continue;
        }
        // <!DOCTYPE ...> con subconjunto interno opcional [ ... ]: se salta sin procesar
        var j = lt + 2, br = 0;
        while (j < n) {
          var ch = text.charAt(j);
          if (ch === '[') br++;
          else if (ch === ']') br--;
          else if (ch === '>' && br <= 0) break;
          j++;
        }
        if (j >= n) fail('declaración sin cerrar', lt);
        i = j + 1; continue;
      }
      if (c1 === '?') {
        var pe = text.indexOf('?>', lt + 2);
        if (pe < 0) fail('instrucción sin cerrar', lt);
        i = pe + 2; continue;
      }
      if (c1 === '/') {
        var ge = text.indexOf('>', lt + 2);
        if (ge < 0) fail('etiqueta sin cerrar', lt);
        var nm = local(text.slice(lt + 2, ge).trim());
        if (cur === top || nm !== cur.name) fail('se esperaba </' + (cur === top ? '…' : cur.name) + '> y llegó </' + nm + '>', lt);
        cur = cur.parent; depth--; i = ge + 1; continue;
      }

      // etiqueta de apertura
      var s = lt + 1, e = s;
      while (e < n && !isSpace(text.charCodeAt(e)) && text.charAt(e) !== '/' && text.charAt(e) !== '>') e++;
      if (e === s) fail('etiqueta sin nombre', lt);
      var node = { name: local(text.slice(s, e)), attrs: Object.create(null), children: [], text: '', parent: cur };
      var selfClose = false;
      for (;;) {
        while (e < n && isSpace(text.charCodeAt(e))) e++;
        if (e >= n) fail('etiqueta sin cerrar', lt);
        var c2 = text.charAt(e);
        if (c2 === '>') { e++; break; }
        if (c2 === '/') {
          if (text.charAt(e + 1) !== '>') fail('"/" inesperado', e);
          selfClose = true; e += 2; break;
        }
        var as = e;
        while (e < n && !isSpace(text.charCodeAt(e)) && text.charAt(e) !== '=' && text.charAt(e) !== '>' && text.charAt(e) !== '/') e++;
        var an = local(text.slice(as, e));
        while (e < n && isSpace(text.charCodeAt(e))) e++;
        if (text.charAt(e) !== '=') fail('atributo "' + an + '" sin valor', e);
        e++;
        while (e < n && isSpace(text.charCodeAt(e))) e++;
        var q = text.charAt(e);
        if (q !== '"' && q !== "'") fail('atributo "' + an + '" sin comillas', e);
        var qe = text.indexOf(q, e + 1);
        if (qe < 0) fail('comillas sin cerrar', e);
        node.attrs[an] = decode(text.slice(e + 1, qe));
        e = qe + 1;
      }
      cur.children.push(node);
      if (!selfClose) {
        depth++;
        if (depth > MAX_DEPTH) fail('demasiado anidado', lt);
        cur = node;
      }
      i = e;
    }
    if (cur !== top) fail('falta cerrar <' + cur.name + '>', n);
    var rootEl = top.children[0];
    if (!rootEl) fail('el archivo no tiene elementos', 0);
    return rootEl;
  }

  // Primer hijo directo con ese nombre (o null)
  function child(node, name) {
    if (!node) return null;
    for (var i = 0; i < node.children.length; i++) if (node.children[i].name === name) return node.children[i];
    return null;
  }
  // Todos los hijos directos con ese nombre
  function kids(node, name) {
    var out = [];
    if (!node) return out;
    for (var i = 0; i < node.children.length; i++) if (node.children[i].name === name) out.push(node.children[i]);
    return out;
  }
  // Todos los descendientes con ese nombre, en orden de aparición
  function find(node, name) {
    var out = [];
    (function walk(nd) {
      for (var i = 0; i < nd.children.length; i++) {
        var c = nd.children[i];
        if (c.name === name) out.push(c);
        walk(c);
      }
    })(node);
    return out;
  }
  function text(node) { return node ? node.text.trim() : ''; }
  function escape(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { parse: parse, child: child, kids: kids, find: find, text: text, escape: escape, decode: decode };
});

/* predio.js — fincas y áreas (2.17.0): la jerarquía entre los polígonos de un proyecto. Lógica pura, sin pantalla.
 *
 * Cada polígono del proyecto (un «lote» en store.js) puede ser:
 *   finca  → el terreno completo (kind 'finca'). Puede haber varias en un proyecto. Su lindero se puede bloquear (locked).
 *   área   → una parte de trabajo: potrero, cafetal, cultivo… (kind 'area'), con su tipo (cat, texto libre) y la finca a la que
 *            pertenece (parent = id de la finca, opcional).
 *   lote   → sin kind: el polígono de siempre, que no es ni finca ni área.
 * Aquí se decide cómo se nombran, a qué finca pertenece un área, cómo se suman las áreas sin contar dos veces y qué avisos salen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.Predio = factory(root.Geo);
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  // Tipos de área sugeridos, cada uno con su color; la persona puede escribir cualquier otro («Cacaotera», «Casa»)
  var CATS = [['Potrero', '#8BC34A'], ['Cafetal', '#8D6E63'], ['Cultivo', '#F1C40F'], ['Vertiente', '#2980B9'], ['Bosque', '#1E8449'], ['Otra', '#8E44AD']];
  var FINCA_COLOR = '#2F8F4E';

  function isFinca(l) { return !!l && l.kind === 'finca'; }
  function isArea(l) { return !!l && l.kind === 'area'; }
  function closed(l) { return !!l && Array.isArray(l.points) && l.points.length >= 3; }
  function m2(l) { return closed(l) ? Geo.polygonArea(l.points) : 0; }
  // «Finca», el tipo del área («Potrero», «Cacaotera»…; «Área» si no tiene) o «Lote»
  function kindLabel(l) { return isFinca(l) ? 'Predio' : (l && l.cat) || 'Lote'; }      // 2.22.0: el global es el «Predio»; lo de adentro, el «Lote» (o su tipo)
  function catColor(cat) {
    var c = String(cat || '').trim().toLowerCase();
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0].toLowerCase() === c) return CATS[i][1];
    return CATS[CATS.length - 1][1];
  }
  function fincas(lots) { return (lots || []).filter(isFinca); }
  // La finca de un área (o null). Solo vale un parent que exista y sea una finca.
  function parentOf(l, lots) {
    if (!isArea(l) || !l.parent) return null;
    var f = (lots || []).filter(function (x) { return isFinca(x) && x.id === l.parent; });
    return f[0] || null;
  }
  function children(f, lots) { return (lots || []).filter(function (x) { return isArea(x) && x.parent === f.id; }); }
  function centroid(points) {
    var la = 0, lo = 0, n = 0;
    (points || []).forEach(function (p) { if (p && isFinite(p.lat) && isFinite(p.lon)) { la += p.lat; lo += p.lon; n++; } });
    return n ? { lat: la / n, lon: lo / n } : null;
  }
  function contains(f, ll) {
    if (!closed(f) || !ll) return false;
    var pts = f.points, inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.lat > ll.lat) !== (b.lat > ll.lat) && ll.lon < (b.lon - a.lon) * (ll.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
  }
  // A qué finca asignar un área nueva: la que contiene `near` (el centro del mapa o de sus puntos); si no, la preferida
  // (la que se estaba viendo); si no, la única que haya. Devuelve la finca o null.
  function guessParent(lots, near, preferId) {
    var fs = fincas(lots);
    if (!fs.length) return null;
    var hit = near ? fs.filter(function (f) { return contains(f, near); }) : [];
    if (hit.length) return hit[0];
    var pref = fs.filter(function (f) { return f.id === preferId; });
    return pref[0] || (fs.length === 1 ? fs[0] : null);
  }

  // Orden de jerarquía (2.20.0): cada finca seguida de sus áreas y, al final, los lotes y las áreas sin finca (en el orden que tenían)
  function ordered(lots) {
    lots = (lots || []).filter(Boolean);
    var out = [], used = [];
    fincas(lots).forEach(function (f) {
      out.push(f); used.push(f);
      children(f, lots).forEach(function (c) { if (used.indexOf(c) < 0) { out.push(c); used.push(c); } });
    });
    lots.forEach(function (l) { if (used.indexOf(l) < 0) out.push(l); });
    return out;
  }

  /* ---------- Cuentas: el total del proyecto sin contar dos veces ---------- */
  // Un área que pertenece a una finca ya está dentro de ella: no se suma al total. Cuentan las fincas, los lotes y las áreas sueltas.
  // Devuelve { total, closed, rows: [{ lot, m2, label, parent, pct }], fincas: [{ lot, m2, areas, used, free, n }] }
  function account(lots) {
    lots = lots || [];
    var total = 0, nClosed = 0, rows = [], fs = [];
    lots.forEach(function (l) {
      var a = m2(l), par = parentOf(l, lots), pa = par ? m2(par) : 0;
      if (a > 0 && !par) { total += a; nClosed++; }
      rows.push({ lot: l, m2: a, label: kindLabel(l), parent: par, pct: par && pa > 0 && a > 0 ? a / pa * 100 : null });
    });
    fincas(lots).forEach(function (f) {
      var ch = children(f, lots), used = 0, a = m2(f);
      ch.forEach(function (c) { used += m2(c); });
      fs.push({ lot: f, m2: a, n: ch.length, used: used, free: a > 0 ? Math.max(0, a - used) : 0, over: a > 0 && used > a + 1 });
    });
    return { total: total, closed: nClosed, rows: rows, fincas: fs };
  }

  /* ---------- Avisos ---------- */
  // Lista de textos (vacía si todo está bien):
  //   · un área que se sale de su finca (se informa y se deja continuar);
  //   · polígonos que se montan uno sobre otro. Entre una finca y sus áreas (o cualquier área y una finca que la contiene) no
  //     es un error: las áreas van dentro de la finca.
  function warnings(lots) {
    lots = lots || [];
    var out = [], sale = [];
    lots.forEach(function (l) {
      var par = parentOf(l, lots);
      if (par && closed(l) && closed(par) && Geo.sticksOut(l.points, par.points)) sale.push('«' + l.name + '» se sale del predio «' + par.name + '»');
    });
    if (sale.length) out.push((sale.length > 3 ? sale.slice(0, 3).join('; ') + ' y ' + (sale.length - 3) + ' más' : sale.join('; ')) +
      '. Puedes dejarlo así, pero recuerda que esa parte queda por fuera de los límites del predio.');
    var prs = [];
    for (var i = 0; i < lots.length; i++) for (var j = i + 1; j < lots.length; j++) {
      var a = lots[i], b = lots[j];
      if (!a || !b) continue;
      if ((isFinca(a) && isArea(b)) || (isFinca(b) && isArea(a))) continue;        // un área dentro (o al borde) de una finca es lo normal
      if (Geo.polygonsOverlap(a.points, b.points)) prs.push('«' + a.name + '» y «' + b.name + '»');
    }
    if (prs.length) out.push('Hay ' + (lots.some(function (l) { return l && l.kind; }) ? 'polígonos' : 'lotes') + ' que se montan uno sobre otro: ' + prs.slice(0, 3).join('; ') +
      (prs.length > 3 ? ' y ' + (prs.length - 3) + ' más' : '') + '. Revisa los linderos: el total del proyecto cuenta esa parte dos veces.');
    return out;
  }

  // 2.22.0: un lote sin predio cuyo centro cae dentro de un predio pasa a pertenecerle (así no se cuenta dos veces). Devuelve cuántos cambió.
  function adopt(lots) {
    var n = 0, fs = fincas(lots).filter(closed);
    (lots || []).forEach(function (l) {
      if (!isArea(l) || parentOf(l, lots) || !l.points || !l.points.length) return;
      var c = centroid(l.points), hit = fs.filter(function (f) { return contains(f, c); })[0];
      if (hit) { l.parent = hit.id; n++; }
    });
    return n;
  }

  /* ---------- Con qué choca un polígono (2.21.0) ---------- */
  // { finca (la suya, si se sale de ella; si no, null), others: [polígonos sobre los que se monta], text } o null si no choca con nada.
  // Como en los avisos, una finca y un área no chocan entre sí.
  function conflicts(lots, id) {
    lots = (lots || []).filter(Boolean);
    var me = lots.filter(function (l) { return l.id === id; })[0];
    if (!me || !closed(me)) return null;
    var par = parentOf(me, lots), finca = par && closed(par) && Geo.sticksOut(me.points, par.points) ? par : null;
    var others = lots.filter(function (o) {
      return o !== me && closed(o) && !((isFinca(me) && isArea(o)) || (isFinca(o) && isArea(me))) && Geo.polygonsOverlap(me.points, o.points);
    });
    if (!finca && !others.length) return null;
    var names = others.slice(0, 3).map(function (o) { return '«' + o.name + '»'; }).join(', ') + (others.length > 3 ? ' y ' + (others.length - 3) + ' más' : '');
    return { finca: finca, others: others,
      text: '«' + me.name + '»' + (finca ? ' se sale del predio «' + finca.name + '»' : '') + (finca && others.length ? ' y' : '') + (others.length ? ' se monta sobre ' + names : '') + '.' };
  }
  // Para saber si el choque es el mismo de antes (y no volver a preguntar por él)
  function conflictKey(c) { return c ? (c.finca ? 'F:' + c.finca.id : '') + '|' + c.others.map(function (o) { return o.id; }).sort().join(',') : ''; }

  return { adopt: adopt, conflicts: conflicts, conflictKey: conflictKey, CATS: CATS, FINCA_COLOR: FINCA_COLOR, isFinca: isFinca, isArea: isArea, kindLabel: kindLabel, catColor: catColor, fincas: fincas, parentOf: parentOf,
    children: children, centroid: centroid, contains: contains, guessParent: guessParent, account: account, warnings: warnings, m2: m2, ordered: ordered };
});

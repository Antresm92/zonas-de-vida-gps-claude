/* capacidad.js — clase de capacidad de uso de las tierras según el IGAC (2.29.0), para «Usos recomendados».
 *
 * La tabla se leyó dos veces del PDF del IGAC (texto extraído); la persona la compara con las páginas originales (4 a 14)
 * con la lista del documento «Usos recomendados · borrador para revisión». Decisiones tomadas con ella (15 nov 2026):
 * los derrumbes usan los rangos de las tablas de clases; la clase 5 solo se avisa; la distribución de las lluvias se
 * pregunta en campo y la app puede proponer una estimación justificada (usos.js).
 *
 * Fuente: Instituto Geográfico Agustín Codazzi (IGAC). «Clasificación de las tierras por su capacidad de uso».
 * Instructivo IN-GAG-PC05-02, versión 1, vigente desde el 11/05/2021.
 * https://igac.gov.co/sites/default/files/listadomaestro/in-gag-pc05-02_clasificacion_de_las_tierras_por_su_capacidad_de_uso.pdf
 *
 * Cómo se calcula (IGAC, pp. 33–34: el limitante más severo determina la clase):
 *   1. Para cada variable conocida se toma la mejor clase (la de número más bajo) que admite su valor (Tablas 1–8).
 *   2. La clase final es la peor de todas.
 *   3. La subclase son las letras de las variables que dieron esa clase (p. 15): p pendiente, e erosión,
 *      h humedad en exceso, s suelo, c clima.
 *   4. Lo que no se sabe no se usa, y el resultado queda «provisional».
 * La clase 5 (tierras casi planas con exceso de agua) no es un escalón más: aquí no se asigna sola; si el exceso de agua
 * es lo que limita y la pendiente es de 7 % o menos, se marca «posible clase 5» para revisar en campo (regla por aprobar).
 *
 * Cada variable: las categorías en orden y la mejor clase que admite cada una (sin contar la 5), con su tabla y página.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Capacidad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [id de la categoría, texto, mejor clase que la admite]
  var VARS = [
    { key: 'pendiente', letter: 'p', group: 'app', name: 'Pendiente', src: 'Tablas 1–8, pp. 4–14 (rangos: Tabla 9, pp. 15–16)', cats: [
      ['0-3', '0–3 %', 1], ['3-7', '3–7 %', 2], ['7-12', '7–12 %', 3], ['12-25', '12–25 %', 4], ['25-50', '25–50 %', 6], ['50-75', '50–75 %', 7], ['75+', 'Más de 75 %', 8]] },
    { key: 'erosion', letter: 'e', group: 'campo', name: 'Erosión', src: 'Tablas 1–8; grados: p. 17', cats: [
      ['no', 'No hay', 1], ['ligera', 'Ligera', 2], ['moderada', 'Moderada', 4], ['severa', 'Severa', 7], ['muysevera', 'Muy severa', 8]] },
    { key: 'masa', letter: 'e', group: 'campo', name: 'Movimientos en masa (% del área)', src: 'Tablas 1–8', cats: [
      ['no', 'No hay', 1], ['<5', 'Menos de 5 %', 3], ['5-25', '5–25 %', 4], ['25-50', '25–50 %', 6], ['50-75', '50–75 %', 7], ['75+', 'Más de 75 %', 8]] },
    { key: 'drenaje', letter: 'h', group: 'campo', name: 'Drenaje natural', src: 'Tablas 1–8; clases: pp. 18–19', cats: [
      ['bien', 'Bien drenado', 1], ['moderado', 'Moderadamente drenado', 2], ['imperfecto', 'Imperfectamente drenado', 3],
      ['pobre', 'Pobremente drenado', 4], ['modexcesivo', 'Moderadamente excesivo', 4], ['excesivo', 'Excesivamente drenado', 6], ['muypobre', 'Muy pobremente drenado', 6]] },
    { key: 'inundFrec', letter: 'h', group: 'campo', name: 'Inundaciones: frecuencia', src: 'Tablas 1–8; Tabla 11, p. 20', cats: [
      ['no', 'No se presentan', 1], ['rara', 'Raras (1 cada 10 o más años)', 2], ['ocasional', 'Ocasionales (1 cada 2–5 años)', 3],
      ['frecuente', 'Frecuentes (1–2 al año)', 4], ['muyfrecuente', 'Muy frecuentes (más de 2 al año)', 8]] },
    { key: 'inundDur', letter: 'h', group: 'campo', name: 'Inundaciones: duración', src: 'Tablas 1–8; Tabla 12, p. 20', cats: [
      ['no', 'No se presentan', 1], ['extcorta', 'Menos de 1 día', 2], ['muycorta', '1–2 días', 2], ['corta', '2–7 días', 3],
      ['larga', '7–30 días', 4], ['muylarga', '30–90 días', 6], ['extlarga', '90–180 días', 8]] },
    { key: 'enchFrec', letter: 'h', group: 'campo', name: 'Encharcamientos: frecuencia', src: 'Tablas 1–8; Tabla 11, p. 20', cats: [
      ['no', 'No se presentan', 1], ['raro', 'Raros', 2], ['ocasional', 'Ocasionales', 3], ['frecuente', 'Frecuentes', 4], ['muyfrecuente', 'Muy frecuentes', 8]] },
    { key: 'enchDur', letter: 'h', group: 'campo', name: 'Encharcamientos: duración', src: 'Tablas 1–8; Tabla 12, p. 20', cats: [
      ['no', 'No se presentan', 1], ['extcorta', 'Menos de 1 día', 2], ['muycorta', '1–2 días', 2], ['corta', '2–7 días', 3],
      ['larga', '7–30 días', 4], ['muylarga', '30–90 días', 6], ['extlarga', '90–180 días', 8]] },
    { key: 'profundidad', letter: 's', group: 'campo', name: 'Profundidad efectiva', src: 'Tablas 1–8; Tabla 14, p. 21', cats: [
      ['150+', 'Más de 150 cm', 1], ['100-150', '100–150 cm', 1], ['75-100', '75–100 cm', 2], ['50-75', '50–75 cm', 3], ['25-50', '25–50 cm', 4], ['<25', 'Menos de 25 cm', 6]] },
    { key: 'fragmentos', letter: 's', group: 'campo', name: 'Fragmentos de roca dentro del suelo (% del volumen)', src: 'Tablas 1–8', cats: [
      ['<3', 'Menos de 3 %', 1], ['3-15', '3–15 %', 3], ['15-35', '15–35 %', 4], ['35-60', '35–60 %', 6], ['60+', 'Más de 60 %', 7]] },
    { key: 'pedregosidad', letter: 's', group: 'campo', name: 'Pedregosidad superficial (% del área)', src: 'Tablas 1–8; Tabla 20, p. 25', cats: [
      ['<0.1', 'Menos de 0,1 %', 1], ['0.1-3', '0,1–3 %', 3], ['3-15', '3–15 %', 4], ['15-50', '15–50 %', 6], ['50-90', '50–90 %', 7], ['90+', 'Más de 90 %', 8]] },
    { key: 'afloramiento', letter: 's', group: 'campo', name: 'Afloramientos rocosos (% del área)', src: 'Tablas 1–8; Tabla 22, p. 26', cats: [
      ['<0.1', 'Menos de 0,1 %', 1], ['0.1-2', '0,1–2 %', 2], ['2-10', '2–10 %', 3], ['10-25', '10–25 %', 4], ['25-50', '25–50 %', 6], ['50-90', '50–90 %', 7], ['90+', 'Más de 90 %', 8]] },
    { key: 'fertilidad', letter: 's', group: 'lab', name: 'Fertilidad', src: 'Tablas 1–8; Tabla 23, p. 27', cats: [
      ['muyalta', 'Muy alta', 1], ['alta', 'Alta', 1], ['media', 'Media', 1], ['baja', 'Baja', 3], ['muybaja', 'Muy baja', 4]] },
    { key: 'aluminio', letter: 's', group: 'lab', name: 'Saturación de aluminio', src: 'Tablas 1–8; Tabla 24, p. 27', cats: [
      ['<15', 'Menos de 15 %', 1], ['15-30', '15–30 %', 3], ['30-60', '30–60 %', 4], ['60-90', '60–90 %', 6], ['90+', 'Más de 90 %', 7]] },
    { key: 'sales', letter: 's', group: 'lab', name: 'Sales', src: 'Tablas 1–8; Tabla 26, p. 28', cats: [
      ['no', 'No hay (normal)', 1], ['ligero', 'Ligeramente salino', 2], ['moderado', 'Moderadamente salino', 3], ['fuerte', 'Fuertemente salino', 6], ['muyfuerte', 'Muy fuertemente salino', 8]] },
    { key: 'sodio', letter: 's', group: 'lab', name: 'Sodio (profundidad a la que aparece)', src: 'Tablas 1–8; Tabla 26, p. 28', cats: [
      ['no', 'No hay', 1], ['100+', 'A más de 100 cm', 3], ['50-100', 'Entre 50 y 100 cm', 4], ['25-50', 'Entre 25 y 50 cm', 6], ['<25', 'A menos de 25 cm', 7]] },
    { key: 'camg', letter: 's', group: 'lab', name: 'Relación calcio/magnesio', src: 'Tablas 1–8', cats: [
      ['normal', 'Normal', 1], ['estrechaprof', 'Estrecha, a más de 50 cm', 2], ['estrecha', 'Estrecha', 3], ['invertida', 'Invertida', 3]] },
    { key: 'piso', letter: 'c', group: 'app', name: 'Piso térmico', src: 'Tablas 1–8; Tabla 28, p. 30', cats: [
      ['calido', 'Cálido', 1], ['templado', 'Templado', 1], ['frio', 'Frío', 1], ['muyfrio', 'Muy frío', 6], ['extfrio', 'Extremadamente frío', 7], ['subnival', 'Subnival', 8], ['nival', 'Nival', 8]] },
    { key: 'humedad', letter: 'c', group: 'app', name: 'Humedad del clima', src: 'Tablas 1–8; Tabla 31, p. 32', cats: [
      ['humedo', 'Húmedo', 1], ['seco', 'Seco', 1], ['muyhumedo', 'Muy húmedo', 6], ['muyseco', 'Muy seco', 6], ['pluvial', 'Pluvial', 6], ['semiarido', 'Semiárido', 7], ['arido', 'Árido', 8]] },
    { key: 'lluvias', letter: 'c', group: 'campo', name: 'Distribución de las lluvias', src: 'Tablas 1–8; Tabla 30, p. 31', cats: [
      ['1', 'Suficientes los dos semestres', 1], ['2', 'Un semestre suficiente; el otro con deficiencias, sin riego', 2],
      ['3', 'Un semestre suficiente; el otro con deficiencias, con riego', 3], ['4', 'Un semestre suficiente; el otro con exceso', 4],
      ['5', 'Exceso los dos semestres; permite ciertos cultivos', 4], ['6', 'Deficiencias los dos semestres; permite ciertos cultivos', 7],
      ['7', 'Exceso los dos semestres; no permite cultivos', 7], ['8', 'Deficiencias los dos semestres; no permite cultivos', 8]] },
    { key: 'heladas', letter: 'c', group: 'campo', name: 'Heladas', src: 'Tablas 1–8', cats: [
      ['no', 'No hiela', 1], ['1-2', '1–2 al año', 2], ['3-10', '3–10 al año', 3], ['10+', 'Más de 10 al año', 6]] }
  ];
  var BY = {}; VARS.forEach(function (v) { BY[v.key] = v; });

  // Usos de cada clase (IGAC, descripción de cada clase, pp. 3–14), en palabras cortas
  var USOS = {
    1: { pag: 'pp. 3–4', txt: 'Amplia diversidad de cultivos adaptados a las condiciones ecológicas; ganadería intensiva con pastos de corte.' },
    2: { pag: 'pp. 5–6', txt: 'Uso agrícola con cultivos transitorios, semiperennes y perennes; ganadería intensiva.' },
    3: { pag: 'pp. 6–7', txt: 'Agricultura con prácticas moderadas a intensivas de conservación.' },
    4: { pag: 'pp. 7–9', txt: 'Ganadería con pastos de buenos rendimientos; agroforestería en las partes más pendientes.' },
    5: { pag: 'pp. 9–10', txt: 'Agricultura y ganadería estacional; agroforestería, conservación y ecoturismo.' },
    6: { pag: 'pp. 10–11', txt: 'Solo algunos cultivos semiperennes o perennes, semidensos y densos; ganadería extensiva evitando el sobrepastoreo.' },
    7: { pag: 'pp. 12–13', txt: 'Aptitud forestal: el bosque tiene carácter protector; se excluye la ganadería.' },
    8: { pag: 'pp. 13–14', txt: 'Conservación de la naturaleza o su recuperación; sin uso agropecuario ni forestal productivo.' }
  };

  function best(key, cat) {
    var v = BY[key]; if (!v) return null;
    for (var i = 0; i < v.cats.length; i++) if (v.cats[i][0] === cat) return v.cats[i][2];
    return null;
  }

  // Lo que la app ya sabe, convertido a las categorías del IGAC
  function pendienteCat(pct) {
    if (typeof pct !== 'number' || !isFinite(pct) || pct < 0) return null;
    return pct <= 3 ? '0-3' : pct <= 7 ? '3-7' : pct <= 12 ? '7-12' : pct <= 25 ? '12-25' : pct <= 50 ? '25-50' : pct <= 75 ? '50-75' : '75+';
  }
  // Tabla 28, p. 30: por temperatura media anual
  function pisoCat(t) {
    if (typeof t !== 'number' || !isFinite(t)) return null;
    return t > 24 ? 'calido' : t >= 18 ? 'templado' : t >= 12 ? 'frio' : t >= 8 ? 'muyfrio' : t >= 4 ? 'extfrio' : t >= 1.5 ? 'subnival' : 'nival';
  }
  // Tabla 31 (pp. 31–32): por la relación evapotranspiración potencial / precipitación (ETP/P): pluvial 0,125–0,25;
  // muy húmedo 0,25–0,5; húmedo 0,5–1; seco 1–2; muy seco 2–4; semiárido 4–8; árido más de 8 (los mismos cortes de Holdridge).
  function humedadCat(r) {
    if (typeof r !== 'number' || !isFinite(r) || r <= 0) return null;
    return r < 0.25 ? 'pluvial' : r < 0.5 ? 'muyhumedo' : r < 1 ? 'humedo' : r < 2 ? 'seco' : r < 4 ? 'muyseco' : r < 8 ? 'semiarido' : 'arido';
  }

  // datos: { pendiente: '25-50', erosion: 'ligera', … } (sin una clave = «No sé»)
  function evaluar(datos) {
    datos = datos || {};
    var por = [], known = 0, cls = 1;
    VARS.forEach(function (v) {
      var cat = datos[v.key];
      if (cat === undefined || cat === null || cat === '') return;
      var b = best(v.key, cat);
      if (b === null) return;
      known++;
      por.push({ key: v.key, letter: v.letter, name: v.name, cat: cat, clase: b, src: v.src });
      if (b > cls) cls = b;
    });
    var lim = por.filter(function (x) { return x.clase === cls && cls > 1; });
    var letters = [];
    lim.forEach(function (x) { if (letters.indexOf(x.letter) < 0) letters.push(x.letter); });
    letters.sort(function (a, b) { return 'pehsc'.indexOf(a) - 'pehsc'.indexOf(b); });
    var flat = datos.pendiente === '0-3' || datos.pendiente === '3-7';
    var posible5 = cls > 4 && flat && lim.length > 0 && lim.every(function (x) { return x.letter === 'h'; });
    return {
      clase: known ? cls : null,
      subclase: known && cls > 1 ? String(cls) + letters.join('') : (known ? '1' : null),
      limita: lim,
      usos: known ? USOS[cls] : null,
      conocidas: known,
      total: VARS.length,
      provisional: known < VARS.length,
      posibleClase5: posible5
    };
  }

  return { VARS: VARS, USOS: USOS, best: best, pendienteCat: pendienteCat, pisoCat: pisoCat, humedadCat: humedadCat, evaluar: evaluar,
    FUENTE: { cita: 'Instituto Geográfico Agustín Codazzi (IGAC). Clasificación de las tierras por su capacidad de uso. Instructivo IN-GAG-PC05-02, versión 1, 2021.',
      url: 'https://igac.gov.co/sites/default/files/listadomaestro/in-gag-pc05-02_clasificacion_de_las_tierras_por_su_capacidad_de_uso.pdf' } };
});

/* Ayudas de la app (separadas de app.js en 2.24.0, sin cambiar lo que hacen).
 * Aquí viven los textos y las hojas de ayuda: «Cómo usar el mapa», «Cómo usar la app», «Qué hay de nuevo»,
 * «Para qué sirve la app» y «Fuentes y licencias». No guardan ni cambian datos: solo arman HTML y lo muestran.
 * Usa lo que app.js le pasa al llamarla: esc (escapar texto para HTML), openSheet (abrir la hoja de abajo)
 * y APP_VERSION (el número de versión que se muestra en «Qué hay de nuevo»). */
(function () {
  'use strict';
  window.ZV = window.ZV || {};
  window.ZV.ayudas = function (ctx) {
    var esc = ctx.esc, openSheet = ctx.openSheet, APP_VERSION = ctx.APP_VERSION;

    function guideHtml(groups) {
      return groups.map(function (g) {
        return (g[0] ? '<h3 class="sub guide-h">' + esc(g[0]) + '</h3>' : '') + '<dl class="guide">' + g[1].map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
      }).join('');
    }
    var MAP_GUIDE = [
      ['Lo básico', [
        ['Toca un punto', 'para ver sus datos, abrir su ficha, moverlo, eliminarlo o ir hasta él (con el GPS encendido te guía con una flecha y los metros que faltan). El número dentro de cada punto es su orden en el recorrido.'],
        ['Arriba', 'el área, el perímetro y el número de puntos del polígono elegido se actualizan solos. Si dice «Los lados se cruzan», tócalo para ordenar los puntos.'],
        ['Botones de la izquierda', 'bajo el menú ⋮: cambiar la capa (calles, satélite o topográfico, y encima la capacidad de uso del IGAC), ver todo el terreno, pantalla completa y deshacer el último cambio, paso a paso. A la derecha, acercar y alejar.'],
        ['Mi posición', 'el botón redondo de abajo centra el mapa donde estás y te sigue hasta que muevas el mapa.']
      ]],
      ['Crear y cambiar puntos', [
        ['Marcar punto', 'el botón azul de abajo guarda el lugar donde estás, con el GPS.'],
        ['Menú ⋮', '«Ingresar puntos» crea un punto donde toques. «Posición manual» deja mover un punto manteniéndolo pulsado un segundo y arrastrándolo.'],
        ['Insertar entre dos', 'con «Posición manual» aparece un «+» en la mitad de cada lado: al tocarlo entre P4 y P5, el nuevo es P5 y los que siguen suben un número. La forma del polígono no cambia.'],
        ['Cambiar el orden', 'en la tarjeta del punto, marca la casilla «Orden» y usa las flechas ◀ ▶. La casilla viene desmarcada para que el orden no cambie por descuido.'],
        ['Más opciones', '«Agregar con mira» (una cruz fija en el centro, más precisa que el dedo), «Caminar el lindero» (el GPS deja los puntos mientras recorres el borde) y «Ordenar los puntos».']
      ]],
      ['Predios y lotes', [
        ['＋ Polígono', 'crea un predio (el terreno completo) o un lote dentro de él: potrero, cafetal, cultivo… o el nombre que escribas. Queda elegido y listo para marcar.'],
        ['Elegir otro', 'toca dentro de otro polígono o su nombre en la fila de arriba. Los cambios se hacen solo en el polígono elegido; los demás se ven más tenues.'],
        ['Cómo se ven', 'el predio, con relleno liso; los lotes, con relleno de puntos de su color.'],
        ['Candado 🔒', 'al pasar de un predio a otro polígono, su lindero se bloquea solo. Para cambiarlo, toca «Editar» en el aviso del candado.'],
        ['Linderos compartidos', 'si marcas o sueltas un punto muy cerca de la esquina de otro polígono, se pega a ella y los dos comparten el lindero exacto. Se apaga en Herramientas › Preferencias.'],
        ['＋ Lote y ＋ Predio', 'en la fila de arriba. «＋ Predio» crea otro predio y «＋ Lote», un lote dentro del predio elegido. Los dos dejan dibujarlo (con «Crear y dibujar en el mapa» se abre el mapa con su predio a la vista, listo para marcar los puntos tocándolo) o traerlo de un archivo (KML, KMZ, GeoJSON o GPX): si el archivo trae varios polígonos, eliges cuáles entran, y si alguno choca con los linderos, cuáles se ajustan.'],
        ['Ajustar a los linderos', 'si el polígono que marcas se sale de su predio o se monta sobre otro, la app pregunta: «Ajustar a los linderos» lo recorta para que su borde siga el del predio y el de los vecinos (aparecen puntos nuevos en el lindero y se numeran de nuevo; se puede deshacer); «Dejar sobrepuesto» lo deja como está. Mientras siga encimado, dentro del mapa queda un aviso ámbar con el botón «Ajustar», y al tocar «Salir» la app vuelve a preguntar.'],
          ['Exportar un polígono', 'en la hoja «Editar» del predio o lote (su nombre en la fila de arriba › Editar), «Exportar polígono» te lleva a Exportar con él ya marcado: solo eliges el formato (KML, Shapefile…). También en Polígono › Croquis › Exportar › «Elegir polígonos».']
      ]],
      ['Medir', [
        ['Medir distancia', 'toca el mapa para ir sumando tramos; al cerrar la figura da también el área. No cambia tus puntos.']
      ]],
      ['Mapa del IGAC', [
        ['Capacidad de uso (IGAC)', 'en el botón de capas, bajo «Encima»: pone sobre el mapa la clase de capacidad de uso de las tierras del mapa oficial del IGAC, con su leyenda de colores. Con internet se ve en línea.'],
        ['Sin conexión', '«Guardar la zona del predio para usar sin conexión» descarga los polígonos del IGAC alrededor de los puntos del proyecto. Sin internet, la app los dibuja con esos colores. «Actualizar» los vuelve a bajar y «Borrar lo guardado» los quita.'],
        ['Es un mapa regional', 'sale de estudios a escala 1:100.000, 1:25.000 o 1:10.000: sirve de referencia, pero lo que evalúas en el predio es más detallado.']
      ]]
    ];
    function openMapGuide() {
      openSheet('Cómo usar el mapa', guideHtml(MAP_GUIDE) +
        '<p class="small muted">Puedes volver a ver esta ayuda en «Más opciones».</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
    }

    /* ---------- Ayuda y licencias ---------- */
    var APP_GUIDE = [
      ['Los tres pasos', [
        ['1 · Puntos', 'Marca los linderos del terreno con el GPS, escribe sus coordenadas (también salen en planas, Origen Nacional) o importa un archivo de Google Earth, GeoJSON o GPX. Con un punto ya hay zona de vida; con tres o más, también el área. Cada punto puede llevar fotos.'],
        ['2 · Información', 'Pulsa «Completar con internet» para traer la altitud, la temperatura y la lluvia. Si tienes datos medidos, escríbelos: mandan sobre lo estimado. Al final, «Usos recomendados» da la clase de capacidad de uso del IGAC. Sin la lluvia no hay zona de vida.'],
        ['3 · Reporte', 'La zona de vida de Holdridge con su diagrama, otras clasificaciones del clima (Caldas-Lang del IDEAM, De Martonne y Köppen), el clima actual, el perfil del relieve con la pendiente y los croquis. Compártelo en PDF o HTML.']
      ]],
      ['Ejemplo: tu primer predio en 5 pasos', [
        ['1 · Marca el predio', 'En Polígono › Mapa usa el «Predio» que trae el proyecto (o «＋ Predio») y elige «Dibujar»: toca el mapa en cada esquina del terreno. También puedes caminar el lindero con el GPS desde Puntos o importarlo de un archivo.'],
        ['2 · Agrega los lotes', 'Con «＋ Lote» marca el cafetal, el potrero o el bosque dentro del predio. Si alguno se monta sobre otro, toca «Ajustar» en el aviso del mapa.'],
        ['3 · Completa el clima', 'En Información toca «Completar con internet» (o escribe tus datos medidos). Con «Elegir polígonos ▾» completas varios a la vez. Si todos comparten el clima del predio, «Usar este clima en todos los polígonos» lo copia (los que tienen datos escritos a mano los conservan).'],
        ['4 · Revisa el reporte', 'En Reporte mira la zona de vida, el clima y los croquis, y desmarca las secciones que no necesites.'],
        ['5 · Comparte', '«Compartir reporte» en PDF o HTML: completo, solo los predios o un solo polígono. Para Google Earth o QGIS, Polígono › Croquis › Exportar.']
      ]],
      ['Lo demás', [
        ['Polígono', 'El croquis con las medidas y para exportar (KML, GeoJSON, GPX, CSV y Shapefile; todo el proyecto o los polígonos que elijas en una lista). En «Mapa», el terreno sobre calles, satélite o topográfico: ahí se crean, mueven y ordenan los puntos, y se mide.'],
        ['Predios y lotes', 'Todo proyecto empieza con su predio (el terreno completo); dentro de él van los lotes (potrero, cafetal, cultivo…), y puede haber varios predios. Cada polígono tiene sus puntos, su clima y su zona de vida. Se eligen en la fila de arriba; «＋ Predio» y «＋ Lote» crean otro, dibujándolo en el mapa o importándolo de un archivo. Si uno se sale de su predio o se monta sobre otro, un aviso en el mapa ofrece «Ajustar» sus linderos.'],
        ['Varios polígonos a la vez', 'En Información, «Elegir polígonos ▾» completa con internet los que marques, uno por uno, y al final dice cuáles quedaron listos. «Limpiar información ▾» borra, en los polígonos que marques, lo que elijas (clima o altitudes según su origen) para volver a completarlos; se puede deshacer.'],
        ['Usos recomendados y evaluar el terreno', 'Al final de Información, «Usos recomendados» 🌱 da la clase de capacidad de uso del IGAC (1 a 8) del polígono elegido, qué la limita y para qué sirve esa tierra. La pendiente, el piso térmico y la humedad los pone la app; lo demás lo respondes en «Evaluar el terreno ▾»: lo que ves en campo (erosión, drenaje, inundaciones, piedras, profundidad, heladas, lluvias) y, si tienes análisis de suelos, lo del laboratorio. Si no sabes algo, deja «No sé»: la clase queda «provisional» porque lo que falta puede bajarla. Para las lluvias por semestre la app propone una estimación con la lluvia mes por mes; lo que observes en campo manda. El [1] y el [2] muestran las fuentes.'],
        ['Según el mapa del IGAC', 'En «Usos recomendados», «Consultar el mapa del IGAC» pregunta al mapa oficial de capacidad de uso del IGAC por el centro del polígono: su clase, subclase, limitantes, usos recomendados y prácticas de manejo, con el estudio, la escala y el año. Queda guardado en el polígono y sale en el reporte. Al lado dice si coincide con tu evaluación. Sin internet usa la zona guardada desde el mapa (botón de capas › Capacidad de uso (IGAC)).'],
        ['Cultivos a evaluar y conclusión', 'En «Usos recomendados», «Cultivos a evaluar ▾» compara la temperatura y la lluvia del polígono con las de 127 cultivos sembrados en Colombia (base ECOCROP de la FAO) y con la clase de tierra del IGAC: los separa en óptimos, posibles con limitaciones (y qué los limita), marginales y no recomendados. Al final de cada polígono, el reporte trae «Conclusión y recomendaciones» con un resumen, recomendaciones con su fuente y esos cultivos. Es una estimación: valídala con un profesional.'],
        ['Qué va en el reporte', 'En «Reporte», la casilla a la izquierda de cada sección decide si esa parte sale en el reporte que compartes. Con varios polígonos, al compartir eliges: «Completo» (el resumen y cada polígono, cada predio seguido de sus lotes), «Global» (solo los predios que marques) o «Específico» (un solo polígono). El croquis de cada polígono se enfoca en él y resalta solo sus puntos; los demás se ven tenues de fondo.'],
        ['Proyectos y copia de seguridad', 'Cada proyecto guarda en el teléfono sus predios, lotes, puntos y fotos; en Herramientas › Proyectos creas otro o cambias de proyecto. Haz con frecuencia una copia de seguridad (.zip) y guárdala fuera del teléfono: si la app se desinstala o el teléfono se pierde, es la única forma de recuperar tu trabajo.'],
        ['Herramientas', 'Conversor de unidades, clima y GPS en vivo, proyectos y copia de seguridad, el encabezado del reporte (tu nombre y tu logo), preferencias y estas ayudas.'],
        ['Arriba', 'La franja de tres pasos dice qué está listo y qué falta. Tócala para ir a ese paso.'],
        ['Sin internet', 'La app abre y guarda puntos sin conexión. Los mapas, «Completar con internet», el clima actual y la consulta del mapa del IGAC sí la necesitan (el mapa del IGAC se puede guardar antes para verlo sin conexión).']
      ]]
    ];
    /* ---------- Qué hay de nuevo (2.23.5) ----------
     * Quien ya usaba la app y la actualiza ve, una sola vez, un resumen corto de lo nuevo; quien la instala por primera vez ve la ayuda
     * completa y no esto. Para una actualización grande futura basta con cambiar WHATS_NEW_ID y la lista. */
    var WHATS_NEW_ID = '2.31';
    var WHATS_NEW = [
      ['Según el mapa del IGAC', 'en Información › Usos recomendados, «Consultar el mapa del IGAC» trae la clase de capacidad de uso del mapa oficial para el centro del polígono, con sus limitantes, usos y prácticas, y la compara con tu evaluación. Queda guardada y sale en el reporte.'],
      ['Capa «Capacidad de uso (IGAC)»', 'en el botón de capas del mapa. Con «Guardar la zona del predio» también se ve sin conexión.'],
      ['Cultivos a evaluar', 'en Información › Usos recomendados, «Cultivos a evaluar ▾» compara el clima de cada polígono y su clase de tierra con 127 cultivos sembrados en Colombia: óptimos, posibles con limitaciones (y qué los limita), marginales y no recomendados.'],
      ['Conclusión y recomendaciones', 'al final de cada polígono del reporte: un resumen del predio, recomendaciones con su fuente y los cultivos a evaluar. Es una estimación y no reemplaza a un profesional.'],
      ['Usos recomendados 🌱', 'la clase de capacidad de uso del IGAC (1 a 8) de cada polígono, con «Evaluar el terreno» para lo de campo y laboratorio, todo con «No sé».']
    ];
    function openWhatsNew() {
      openSheet('Qué hay de nuevo', '<p class="lead">Versión ' + esc(APP_VERSION) + '</p><dl class="guide" id="whatsNew">' +
        WHATS_NEW.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
        '<div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button><button class="btn" data-act="appGuide">Ver la ayuda completa</button></div>');
    }
    function openAppGuide() {
      openSheet('Cómo usar la app', guideHtml(APP_GUIDE) +
        '<p class="small muted">Puedes volver a ver esta ayuda en «Herramientas», donde también está «Para qué sirve la app».</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
    }
    // Mini tutorial de usos (2.19.0): qué se puede hacer con cada parte del reporte y a quién le sirve
    var USES_GUIDE = [
      ['Qué es', [
        ['En una frase', 'Una mezcla de mapa y medidor de terrenos con enfoque ambiental: delimitas un predio en campo y la app entrega un reporte de su zona de vida, su clima y su relieve.'],
        ['De dónde salen los datos', 'Los puntos, de tu GPS o de lo que escribas. La altitud, la temperatura y la lluvia, de servicios públicos de internet (promedios de varios años), o de tus propias mediciones si las tienes. La app calcula con eso: no reemplaza una estación meteorológica ni un levantamiento topográfico.']
      ]],
      ['Qué te dice cada parte del reporte', [
        ['Croquis', 'Cuál es el predio: su forma, su tamaño y sus linderos, para reconocerlo y mostrarlo.'],
        ['Croquis satelital y topográfico', 'Qué hay dentro y alrededor (bosque, potreros, caminos, quebradas) y cómo es el terreno: las curvas de nivel muestran dónde sube y dónde baja.'],
        ['Perfil del relieve y pendiente', 'A qué altura está cada punto, cuál es el más alto y el más bajo, y qué tan inclinado es el terreno. Sirve para planear por dónde llegar, por dónde baja el agua o dónde cuesta más trabajar.'],
        ['Diagrama de Walter-Lieth', 'Cómo se reparte la lluvia en el año: meses húmedos y meses secos. Sirve para pensar cuándo sembrar, cuándo hay riesgo de falta de agua y qué labores hacer en cada época.'],
        ['Zona de vida de Holdridge', 'Qué tipo de vegetación natural corresponde a ese clima. Es la base para comparar el uso actual con lo que el sitio da de forma natural.'],
        ['Caldas-Lang (IDEAM)', 'El piso térmico y la humedad en el lenguaje que usa la asistencia técnica en Colombia: «templado húmedo», «frío semihúmedo».'],
        ['De Martonne y Köppen', 'Dos clasificaciones del clima usadas en todo el mundo: De Martonne dice qué tan seco o húmedo es el sitio; Köppen lo ubica entre los grandes tipos de clima y sirve para compararlo con otras regiones.'],
        ['Resumen de predios y lotes', 'Cuánto mide cada predio y qué parte ocupa cada lote (en hectáreas y en % del predio); avisa si algún polígono se sale de su predio o se monta sobre otro.'],
        ['Según el mapa del IGAC', 'Lo que dice el mapa oficial de capacidad de uso de las tierras del IGAC para ese sitio (clase, limitantes, usos y prácticas de manejo), al lado de tu evaluación. Sirve para contrastar y para citar una fuente oficial en un informe.'],
        ['Usos recomendados', 'Qué tan intensamente se puede usar esa tierra sin dañarla y para qué: cultivos, ganadería, bosque o conservación, según la clase de capacidad de uso del IGAC (1 a 8), y qué la limita (pendiente, erosión, agua, suelo o clima). Sirve como base técnica para planear un cultivo o un proyecto.'],
        ['Conclusión y recomendaciones', 'Un resumen del polígono (zona de vida, clima, meses secos y clase de tierra), recomendaciones con su fuente (pendiente, riego, drenaje, análisis de suelos) y los cultivos a evaluar según el clima y la tierra. Sirve como punto de partida para proyectar un cultivo o un proyecto.'],
        ['Coordenadas', 'La ubicación de cada punto en grados y en coordenadas planas (MAGNA-SIRGAS / Origen Nacional), lista para pasarla a un plano o a QGIS.'],
        ['Fotos', 'Las fotos tomadas en cada punto, como evidencia de lo que había el día de la visita.']
      ]],
      ['Usos por área', [
        ['Agrícola y pecuaria', 'Medir lotes y potreros, llevar las áreas de cultivo, de rotación o de riego dentro del predio, y saber el piso térmico y los meses secos antes de escoger qué sembrar.'],
        ['Forestal', 'Delimitar rodales y áreas de reforestación o conservación, con su zona de vida, su pendiente y un croquis para el plan de manejo.'],
        ['Ambiental', 'Caracterizar un predio para un estudio o una visita técnica: ubicación, área, zona de vida, clima y relieve en un solo documento con fuentes citadas.'],
        ['Estudio y docencia', 'Prácticas de campo: tomar puntos, ubicar el sitio en el diagrama de Holdridge y comparar varias clasificaciones del clima con los mismos datos.'],
        ['Predios y trámites', 'Un croquis con coordenadas geográficas y planas (MAGNA-SIRGAS, Origen Nacional) y archivos para Google Earth, QGIS o ArcGIS. No reemplaza un plano hecho por un topógrafo.']
      ]],
      ['Hasta dónde llega', [
        ['Precisión', 'El GPS de un teléfono tiene un error de varios metros: en un predio pequeño el área puede variar varios por ciento. El clima viene de datos en cuadros de varios kilómetros, ajustados con la altitud.'],
        ['Es orientativo', 'El resultado sirve para orientar decisiones y preparar visitas; para decisiones legales o inversiones grandes, confírmalo con mediciones y con un profesional.'],
        ['Cultivos a evaluar', 'Salen de rangos generales de temperatura y lluvia (FAO) y de la clase de tierra: no tienen en cuenta la variedad, el suelo que no evaluaste, el riego disponible, las plagas ni el mercado. Son cultivos para evaluar, no una orden de siembra.'],
        ['El mapa del IGAC', 'Es regional (escalas 1:100.000 a 1:10.000): un predio pequeño puede caer en un solo polígono del mapa aunque tenga suelos distintos. En la imagen en línea del IGAC, algunos polígonos de estudios antiguos marcados «IV» salen con el color de la clase 6 (así está su leyenda); la consulta y lo guardado los muestran como clase 4.'],
        ['La clase de uso', 'Sale solo de los datos que evaluaste: el suelo, las heladas o las inundaciones que no hayas revisado pueden bajarla. No reemplaza un estudio de suelos ni la visita de un profesional.']
      ]]
    ];
    function openUses() {
      openSheet('Para qué sirve la app', guideHtml(USES_GUIDE) + '<div class="btns"><button class="btn btn-primary" data-act="closeSheet">Entendido</button></div>');
    }
    function openLicenses() {
      var rows = [
        ['Mapa de calles', '© colaboradores de OpenStreetMap, licencia ODbL. openstreetmap.org/copyright'],
        ['Imágenes de satélite y nombres', 'Esri World Imagery y capas de referencia. Fuente: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG.'],
        ['Mapa topográfico', '© OpenTopoMap (CC-BY-SA), con datos de OpenStreetMap y SRTM.'],
        ['Clima de la zona', 'NASA POWER (NASA Langley Research Center) y Open-Meteo (CC BY 4.0).'],
        ['Clima actual', 'Open-Meteo (CC BY 4.0).'],
        ['Mapa en pantalla', 'Leaflet (licencia BSD de 2 cláusulas).'],
        ['Zonas de vida', 'Sistema de clasificación de L. R. Holdridge (1967). El resultado es orientativo.'],
        ['Caldas-Lang', 'IDEAM, Nota técnica NT_IDEAM-2025-003, «Actualización de la clasificación climática de Caldas-Lang».'],
        ['Köppen-Geiger y De Martonne', 'Criterios de Peel, Finlayson y McMahon (2007) para Köppen-Geiger; índice de aridez de E. de Martonne (1926).'],
        ['Diagrama de Walter-Lieth', 'Climodiagrama de H. Walter y H. Lieth: un mes es seco cuando la lluvia (mm) es menor que el doble de la temperatura (°C).'],
        ['Usos recomendados', 'Instituto Geográfico Agustín Codazzi (IGAC), «Clasificación de las tierras por su capacidad de uso», instructivo IN-GAG-PC05-02, versión 1 (2021). La estimación de las lluvias por semestre es una regla de la app basada en el criterio de mes seco de Walter-Lieth.'],
        ['Cultivos a evaluar', 'FAO, base de datos ECOCROP (requerimientos de temperatura y lluvia), en la versión del paquete Recocrop de R. J. Hijmans y R. Manners (2025, licencia GPL-3); método de aptitud de Hackett (1991). El nombre en Colombia, el tipo de cultivo y la lectura de la clase del IGAC son de la app.'],
        ['Mapa del IGAC', 'Instituto Geográfico Agustín Codazzi (IGAC), «Capacidad de uso de las tierras», mapa multiescalar (escalas 1:100.000, 1:25.000 y 1:10.000), servicio mapas2.igac.gov.co. Datos abiertos del IGAC, licencia CC BY 4.0 (Resolución 616 de 2020). Fuente: IGAC.'],
        ['Clases de pendiente', 'Instituto Geográfico Agustín Codazzi (IGAC), clases de pendiente de sus levantamientos de suelos y geomorfología.'],
        ['Coordenadas planas', 'MAGNA-SIRGAS / Origen Nacional (EPSG:9377), sistema único adoptado por el IGAC en 2020.']
      ];
      openSheet('Fuentes y licencias', '<dl class="guide">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
        '<p class="small muted">Los mapas, el clima y el mapa del IGAC se piden a esos servicios solo cuando hay internet (al IGAC, el centro del polígono o la zona del predio); la app no envía tus puntos a ningún otro lugar.</p><div class="btns"><button class="btn btn-primary" data-act="closeSheet">Cerrar</button></div>');
    }

    return { WHATS_NEW_ID: WHATS_NEW_ID, guideHtml: guideHtml, openMapGuide: openMapGuide, openWhatsNew: openWhatsNew,
      openAppGuide: openAppGuide, openUses: openUses, openLicenses: openLicenses };
  };
})();

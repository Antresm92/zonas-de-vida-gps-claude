# Zonas de Vida · GPS + Diagrama de Holdridge

App para Android (y web instalable) que:

- toma puntos con el **GPS** del teléfono o con coordenadas escritas a mano,
- calcula **área y perímetro** del terreno (hectáreas, m², km² y fanegadas),
- entrega un **informe de zona de vida de Holdridge** con su diagrama, región latitudinal, piso altitudinal y provincia de humedad,
- muestra el terreno en un **mapa** (calles, satélite o topográfico) con los puntos, su nombre y su altitud, y en un **croquis** con las medidas,
- **importa y exporta** polígonos de Google Earth y otros programas de mapas (KML, KMZ, GeoJSON, GPX; exporta también CSV para Excel),
- dibuja el **diagrama climático de Walter-Lieth** (meses secos y húmedos) con datos mensuales de internet o escritos a mano,
- guarda **copias de seguridad** de todos los proyectos y avisa cuando el GPS no alcanza la precisión que elegiste,
- **funciona sin conexión**: los puntos se guardan en el equipo y, cuando hay internet, se pueden completar con altitud y clima de la zona.

---

## 1. Obtener el APK sin instalar nada en tu computador

El APK se compila en la nube gratuita de GitHub. Hace falta una cuenta de GitHub (gratis) y unos 10 minutos.

1. Descomprime este `.zip`.
2. En <https://github.com/new> crea un repositorio (puede ser **privado**). Nómbralo, por ejemplo, `zonas-de-vida`.
3. En el repositorio nuevo pulsa **Add file → Upload files** y arrastra **todo el contenido** de la carpeta descomprimida (incluida la carpeta oculta `.github`). Pulsa **Commit changes**.
   - Si tu sistema no sube la carpeta `.github`, créala a mano: **Add file → Create new file**, escribe como nombre `.github/workflows/android.yml`, pega el contenido del archivo `android.yml` de este proyecto y confirma.
4. Abre la pestaña **Actions**. Si aparece un botón para habilitar los flujos de trabajo, púlsalo.
5. Elige **Compilar APK de Android → Run workflow**. Tarda entre 5 y 15 minutos.
6. Al terminar, entra a la ejecución (marca verde ✓) y baja hasta **Artifacts**: descarga `zonas-de-vida-apk`. Es un `.zip` con `zonas-de-vida.apk` dentro.
7. Pasa el `.apk` al teléfono, ábrelo y acepta **instalar apps de origen desconocido** cuando Android lo pida.

Si la compilación falla (✗ roja), abre el paso que falló y copia el mensaje de error: con él se puede corregir.

### Actualizar la app más adelante
Con GitHub Desktop: copia los archivos nuevos sobre la carpeta de tu repositorio (reemplazando los que tengan el mismo nombre), escribe un resumen en *Summary*, pulsa **Commit to main** y luego **Push origin**. GitHub compila el APK solo en unos minutos (pestaña **Actions**).

Cada APK nuevo usa **la misma clave de firma** (`scripts/debug.keystore`), así que se instala **encima** del anterior y conserva tus proyectos. Esa clave es la de depuración estándar de Android: sirve para uso personal, no para publicar en Google Play.

### Alternativa: compilar en tu computador
Con Node 20+, JDK 21 y Android Studio: `npm install`, `npm run android:add`, `npm run android:apk`. El APK queda en `android/app/build/outputs/apk/debug/`.

### Alternativa: web instalable (sin APK)
Sube la carpeta `www/` a cualquier alojamiento web con HTTPS (por ejemplo GitHub Pages), ábrela en Chrome del teléfono y elige **Instalar app / Añadir a pantalla de inicio**. Después de la primera visita abre sin conexión. Si cambias archivos, sube el número de `CACHE` en `www/sw.js` para que los teléfonos se actualicen.

---

## 2. Cómo se usa

1. **Puntos**: pulsa *Activar GPS* y luego *Marcar punto aquí* en cada vértice del terreno. Quédate quieto unos 10 segundos: la app promedia las lecturas. También puedes *Escribir coordenadas* (decimales o grados-minutos-segundos), *Pegar varias* o *Importar archivo*.
   - **Precisión mínima para marcar puntos** (sin límite, ±3, ±5, ±10 o ±20 m): si el GPS está menos preciso que lo que elegiste, la app lo avisa **antes** de marcar («este punto no será el más preciso») y tú decides si marcas igual o esperas. No bloquea nada; el punto queda guardado con su precisión real y señalado en la lista.
2. **Polígono** (antes «Área»), con dos vistas:
   - **Croquis**: con 3 o más puntos aparecen el área (en hectáreas, m², km² y fanegadas), el perímetro, los vértices, el centro, el rango de altitud, los lados con su rumbo y un dibujo del polígono. Si los lados se cruzan, avisa y ofrece reordenar los puntos. Aquí está **Exportar** (KML, GeoJSON, GPX y CSV).
   - **Mapa**: capa base **Calles** (OpenStreetMap), **Satélite** (Esri) o **Topográfico** (OpenTopoMap: curvas de nivel y relieve sombreado, con datos de OpenStreetMap y de la misión SRTM; sus alturas vienen de SRTM, no de tus puntos GPS), y con el satélite el botón *Calles y nombres sobre el satélite*. Dibuja el polígono del proyecto, cada punto con su nombre y altitud (por ejemplo «P3 · 386 m», los nombres aparecen desde cierto zoom para no amontonarse) y las capas importadas con sus colores. Herramientas: *Polígono activo* (muestra u oculta la figura que une los puntos), *Último punto* (centra el mapa en el último que marcaste), *Marcar punto* (guarda tu posición con el GPS, promediando lecturas y con el mismo aviso de precisión que la pestaña Puntos) y, a la derecha, *Mi posición* (centra el mapa donde estás). La capa elegida se recuerda en el equipo. **El mapa de fondo necesita internet** (los puntos y el polígono se ven igual sin conexión, y la app avisa); un mapa de fondo sin conexión llegará en otra etapa.
3. **Clima**: muestra la altitud, la temperatura y la precipitación que se usan, de dónde sale cada una y deja corregirlas. Con los 12 meses de temperatura y lluvia dibuja el **diagrama de Walter-Lieth** y se puede guardar como imagen (SVG).
4. **Informe**: zona de vida, datos usados, zonas vecinas posibles según el margen de error, **perfil del relieve**, **croquis satelital**, **croquis topográfico**, diagrama de Holdridge con tu punto, diagrama de Walter-Lieth y botón para compartir el informe (HTML) o copiar el resumen.
   - **Perfil del relieve** (con 2 o más puntos): la altitud de cada punto contra la distancia acumulada entre ellos, en el orden de la lista y sin volver al primero, con las cotas («P2 · 420 m»), el punto más alto y más bajo, el desnivel, el ascenso y descenso acumulados y el tramo más inclinado. Usa solo las altitudes guardadas (no consulta internet) y avisa si vienen del GPS del teléfono (error de varios metros, a veces decenas), si el desnivel es del orden de ese error, si mezclan fuentes o si faltan altitudes.
   - **Croquis satelital**: una imagen de Esri con el polígono, los nombres, la distancia de cada lado, el norte, la escala y la atribución. Se baja **una vez, con internet** (botón *Preparar croquis satelital* o automáticamente al compartir) y queda guardada **dentro** del archivo del informe, que después se ve igual sin conexión. Si cambias un punto o las capas visibles, hay que prepararlo de nuevo. Sin internet, o si el servicio falla, el informe sale igual con una nota que dice por qué no trae esa sección.
      - **Croquis topográfico** (debajo del satelital, mismo funcionamiento): una imagen de OpenTopoMap (curvas de nivel y relieve sombreado, con datos de OpenStreetMap y SRTM; licencia CC-BY-SA) con el polígono, los nombres, las distancias de los lados, el norte, la escala y la atribución. Se prepara con el botón *Preparar croquis topográfico* o automáticamente al compartir, y queda guardado dentro del archivo. Las curvas de nivel salen de datos de satélite y son aproximadas: no son las altitudes de tus puntos. Si falla uno de los dos croquis, el otro y el resto del informe salen igual, con una nota que dice cuál falló y por qué.
   - En el informe compartido el orden es: croquis, croquis satelital, croquis topográfico, perfil del relieve, zonas por altitud, calidad de los datos y diagramas.
5. **Proyectos** (toca el nombre arriba): cambiar de proyecto, crear, renombrar, eliminar y **copia de seguridad**.

### Importar polígonos de Google Earth y otros archivos
*Puntos → Importar archivo* acepta **KML, KMZ, GeoJSON y GPX** (por ejemplo el polígono de tu finca guardado en Google Earth Pro, o un `.json` catastral en GeoJSON). Antes de importar muestra qué trae el archivo (polígonos, líneas, puntos, vértices, hectáreas) y avisa si algo se ignora (altitudes en 0, coordenadas fuera de rango, agujeros).

- Si el proyecto está **vacío**, el polígono pasa a ser el polígono del proyecto y se calcula el área.
- Si el proyecto **ya tiene puntos**, la app advierte y ofrece: *Agregar como capa nueva* (queda de otro color y **no cambia** tu área ni tu zona de vida), *Reemplazar mis puntos* o *Crear proyecto nuevo*. Todo se puede **deshacer** desde el aviso que aparece abajo.
- Cada capa tiene color y nombre editables, se puede ocultar, eliminar, o *Usar como polígono del proyecto* (lo que tenías antes queda como capa). «Mis puntos» también cambia de color.
- Las capas se dibujan en el Croquis, en el Mapa y en el informe, con su leyenda.

### Exportar
*Polígono → Croquis → Exportar* guarda un archivo y abre el menú de compartir de Android (correo, Drive, WhatsApp o «Guardar en…»):

| Formato | Para abrir en | Contenido |
|---|---|---|
| **KML** | Google Earth | polígono, puntos con altitud y precisión, capas visibles y colores |
| **GeoJSON** | QGIS, mapas web | polígono (anillo antihorario y cerrado, RFC 7946) y capas |
| **GPX** | GPS de mano | puntos (waypoints) y trazas del polígono y las capas |
| **CSV** | Excel | `Punto, Latitud, Longitud, Altitud, Rumbo, Distancia al vértice siguiente`. Hay dos estilos: «para Excel en español» (`;` y coma decimal, con marca UTF-8) y «estándar» (`,` y punto decimal) |

### Copia de seguridad
*Proyectos → Exportar copia de seguridad* guarda en **un solo archivo** todos tus proyectos, puntos, capas, datos de clima y ajustes. *Restaurar copia…* la valida antes de tocar nada (formato, versión, coordenadas y valores dentro de rango; un archivo dañado o manipulado se rechaza o se limpia con aviso) y pregunta si **sumar** a tus proyectos (no repite lo que ya existe) o **reemplazar todo**. Ambas opciones se pueden deshacer.

### Diagrama de Walter-Lieth
Muestra la temperatura media mensual (°C) y la lluvia mensual (mm) con la escala de lluvia doble que la de temperatura (P = 2T): los meses **secos** (la lluvia queda por debajo de la curva de temperatura) salen punteados en naranja, los **húmedos** con rayas azules, y por encima de 100 mm la escala se comprime 10 veces y se rellena en azul sólido. Debajo del dibujo la app escribe en palabras los períodos secos, el déficit y los meses con más de 100 mm.

De dónde salen los 12 meses (en este orden de prioridad):
1. **Escritos por ti** («Escribir los 12 meses», en la pestaña Clima).
2. **Internet** con el botón *Completar con internet*: NASA POWER (promedios climatológicos de largo plazo, rejilla de ~50 km); si NASA no responde o no trae los 12 meses, Open-Meteo (reanálisis ERA5, últimos 10 años). La temperatura se corrige por la diferencia de altitud entre tu punto y la celda de la rejilla. La app dice cuál fuente usó.

Sin internet y sin datos escritos, el diagrama no se dibuja: no se inventan lluvias. **No tienes que configurar nada**: las consultas no necesitan clave ni registro.

### De dónde sale cada dato

| Dato | Por defecto | Cómo corregirlo |
|---|---|---|
| **Altitud** | La del **GPS** (mediana de las lecturas del punto; promedio entre puntos) | Editar el punto, o escribir una altitud para todo el análisis en la pestaña Clima. *Restaurar altitud del GPS* devuelve el valor original |
| **Temperatura** | **Estimada** con la altitud y la latitud: `T ≈ 28,2 − 0,009·lat² − 0,00533·altitud` (lat ≤ 40°). Error esperado ≈ ±2 °C en el trópico | Escribir una temperatura medida; manda sobre cualquier estimación |
| **Precipitación** | **Nunca se inventa.** Se escribe a mano, viene de un CSV importado, de datos guardados cerca (≤ 25 km) o de internet | Escribirla |

Con internet, *Completar con internet* trae la altitud de cada punto (Open-Meteo) y el clima mensual de la zona (NASA POWER, rejilla de ~50 km: en montaña puede diferir mucho de la lluvia real). Lo que se descarga queda guardado para usarlo después sin conexión.

*Importar CSV*: columnas `lat, lon` y `temp` y/o `prec` (opcional `alt`, `nombre`), con coma, punto y coma o tabulador. Reconoce `bio1`/`bio12` de WorldClim.

La altitud del GPS puede venir medida desde el elipsoide y no desde el nivel del mar; la diferencia puede llegar a unos 100 m en el peor lugar del planeta, y aun así equivale a menos de 1 °C de temperatura estimada.

---

## 3. Qué está verificado y qué no

**Verificado aquí:**
- **365 pruebas unitarias** (`npm test`, solo Node, sin instalar nada) que cubren la lógica: distancias y áreas en el elipsoide WGS84 contra una integración numérica independiente (hemisferio sur, 60° de latitud, meridiano 180°), geometría del diagrama de Holdridge y zonas de vida de ciudades colombianas, lectura y escritura de KML/KMZ/GeoJSON/GPX/CSV, copia de seguridad y restauración con archivos dañados o manipulados, diagrama de Walter-Lieth, lectura de las respuestas de NASA POWER (formato clásico y formato nuevo) y de Open-Meteo, el aviso de precisión del GPS, la lógica del mapa (capas base, qué se dibuja, aviso de mosaicos), el perfil del relieve (distancias, desnivel, avisos del GPS, dibujo) y el croquis satelital y el topográfico (qué mosaicos hacen falta en cada servicio, dónde cae cada punto, dibujo y atribución de cada uno, huella para saber si sigue vigente y la descarga con piezas de mentira, incluido el tiempo de espera y los mosaicos que faltan).
- **96 pasos en un navegador (Chromium) con GPS e internet simulados** (`node tests/e2e/run.js`, necesita Playwright): la app completa recorrida como la usaría una persona, sin errores de JavaScript en la consola, incluido el funcionamiento sin red y el mapa con **mosaicos simulados** (se comprueba qué pide la app y qué dibuja, que cabe en pantallas de 390 × 844 y 360 × 640 sin que las herramientas tapen los puntos, que las capas se recuerdan y que un nombre con código HTML se escribe como texto), la capa topográfica (no pide mosaicos de más del nivel 17) y el informe con perfil y croquis satelital (se baja una sola vez, queda dentro del archivo, se invalida al cambiar un punto, funciona sin internet y con el servicio caído, y dos toques seguidos a *Compartir* generan un solo informe).
- **Cobertura medida** (`node tools/cobertura.js`): las pruebas unitarias ejecutan el 99,7 % de las líneas de los módulos de lógica; sumando las pruebas en navegador, 99,9 % de todo `www/js`, con `app.js` (la interfaz), `mapview.js` (el mapa), `perfil.js` y `satelite.js` en 100 %. Las pocas líneas que faltan son ramas imposibles de provocar desde fuera.
- **Prueba de fallos provocados**: se cambiaron a propósito 127 operadores del código (por ejemplo `<` por `<=` o `&&` por `||`, elegidos al azar) y se comprobó que alguna prueba fallara. Se detectan 117 (92 %). Los 10 restantes, revisados uno por uno, no cambian el resultado de la app (por ejemplo, un ciclo que lee una posición de más sin efecto). Es una muestra, no todos los cambios posibles. En el mapa se provocaron además 8 fallos a mano (no re-encuadrar, perseguir siempre al GPS, no guardar la capa, escribir el nombre como HTML…) y las pruebas en navegador detectaron los 8. En el perfil, el croquis satelital y la capa topográfica se provocaron 12 más (usar un croquis viejo después de mover un punto, generar dos informes con dos toques, intentar bajar sin internet, invertir el orden de las secciones, guardar la imagen con mosaicos faltantes, no validar que lo recibido sea una imagen, escribir un nombre como código, pedir mosaicos que no existen…) y se detectaron los 12. En el croquis topográfico y en compartir con dos croquis se provocaron 13 más (usar la dirección de Esri para el mapa topográfico, dejar que llegue al nivel 18 que OpenTopoMap no tiene, no incluirlo al compartir, ponerlo arriba del satelital o después del perfil, firmarlo con la atribución de Esri, darlo por vigente después de mover un punto, que un fallo de uno rompa al otro, perder la nota de falla, el aviso de «preparando» siempre en singular…) y se detectaron los 13.

**No verificado:**
- **El APK no se compila en el entorno donde se programa** (bloquea los servidores de Android y npm). La versión 1 sí se compiló en GitHub y funcionó en un teléfono; esta versión no añade complementos nativos nuevos (usa los mismos de archivos y compartir), pero el APK nuevo sale del flujo de GitHub la primera vez.
- **No se probó en un teléfono real:** permisos y precisión del GPS, el menú de compartir de Android al exportar y el selector de archivos al importar. En el navegador simulado funcionan; en el teléfono falta confirmarlo.
- **Las consultas a internet no se ejecutaron contra los servicios reales** (NASA POWER y Open-Meteo): se probaron con respuestas de ejemplo. NASA POWER está cambiando el formato de su respuesta; la app entiende el clásico y el nuevo, y si ninguno funciona usa Open-Meteo y lo dice. Si ambos fallan, avisa y deja escribir los 12 meses a mano.
- La estimación de temperatura se ajustó con valores aproximados de ciudades colombianas, no con una serie de estaciones; fuera del trópico es solo una referencia.
- **Mapa (versiones 2.1.0 a 2.3.0), pendiente de confirmar en el teléfono:** desde donde se programa no se llega a los servidores de mapas, así que los mosaicos reales de OpenStreetMap, Esri y OpenTopoMap **no se han visto cargar**; en las pruebas se usan mosaicos simulados. La dirección de OpenTopoMap (`tile.opentopomap.org/{z}/{x}/{y}.png`, hasta el nivel 17) sale de la página de OpenStreetMap sobre ese servicio; **no pude leer la política de uso de OpenTopoMap** (su página no está al alcance desde aquí), así que está pendiente confirmar que su uso en una app esté permitido. Las direcciones de la capa *Calles y nombres sobre el satélite* (Esri `Reference/World_Transportation` y `Reference/World_Boundaries_and_Places`) coinciden con las que define la librería esri-leaflet en su código, pero **no se vieron cargar**. Tampoco se probó en un teléfono real el GPS dentro del mapa ni los toques sobre él.
- **Croquis satelital y topográfico, pendiente de confirmar en el teléfono:** para guardar la imagen dentro del informe la app dibuja los mosaicos en un lienzo y lo convierte en JPEG, y eso solo funciona si el servidor (el de Esri para el satelital, el de OpenTopoMap para el topográfico) permite leer los píxeles (cabecera CORS). **No pude comprobar ese permiso en ninguno de los dos**: el navegador simulado que uso no lo exige, así que esa parte la cubren pruebas con piezas de mentira y el funcionamiento real hay que verlo en el teléfono. Si el servidor no lo permite, el informe sale sin esa sección y lo dice (y el otro croquis no se ve afectado). La licencia CC-BY-SA del mapa de OpenTopoMap pide dar la atribución y compartir las obras derivadas con la misma licencia: el informe lleva la atribución en la imagen y en el pie, pero no soy abogado y no revisé qué implica compartir un informe con esa imagen. Las condiciones de Esri para imágenes estáticas (su [página](https://doc.arcgis.com/en/arcgis-online/reference/static-maps.htm)) permiten el uso personal, interno o dentro de un informe para un cliente con atribución cerca de la imagen; cualquier otro uso, como venderlas, necesita permiso de Esri. Esa página habla de los mapas de Esri en general y no nombra el servicio de imágenes en particular, y el informe lleva el aviso «uso personal o interno».
- **El perfil del relieve no es el relieve del terreno:** es lo que dicen las altitudes de tus puntos, y la altitud del GPS de un teléfono tiene error. Con poco desnivel, la línea puede ser ruido (el informe lo avisa).
- **Leaflet** (la librería del mapa, `www/vendor/leaflet`, licencia BSD-2-Clause) va incluida en la app para que abra sin internet. Se copió de un repositorio público de la misma cuenta y se revisó (sin `eval` ni llamadas de red, tamaños y huellas SHA-256 anotados en `LEEME.txt`), pero **todavía no se comparó con el paquete oficial de npm**.
- Los mapas de OpenStreetMap y de Esri se usan para ver el mapa en pantalla; la política de OpenStreetMap prohíbe bajar mosaicos por adelantado o para usarlos sin conexión, y Esri no permite descargas en bloque, por eso el mapa sin conexión tendrá que venir de otra fuente. El croquis satelital baja solo los 12 mosaicos como máximo de la imagen que se pide, una vez, y desde Esri (no desde OpenStreetMap).
- Una cobertura alta mide qué código se ejecuta, no que las pruebas comprueben lo correcto; por eso además se provocaron fallos a propósito (punto anterior).

El resultado es una **clasificación bioclimática orientativa**: no reemplaza un estudio de campo ni los datos de una estación meteorológica cercana.

---

## 4. Estructura

```
www/                 la app (HTML, CSS y JavaScript; el mapa usa Leaflet, incluido en vendor/)
  js/geo.js          coordenadas, distancias, área, centroide
  js/holdridge.js    biotemperatura, hexágonos, provincias de humedad, sensibilidad
  js/climate.js      altitud → temperatura, memoria offline, CSV, NASA POWER y Open-Meteo
  js/analysis.js     une todo para un proyecto
  js/gps.js          lecturas del GPS promediadas y aviso de precisión
  js/xml.js, zip.js  lectores de XML y de KMZ (ZIP) sin dependencias
  js/gis.js          importar/exportar KML, KMZ, GeoJSON, GPX y CSV; capas
  js/backup.js       copia de seguridad, validación y restauración
  js/walter-lieth.js diagrama ombrotérmico (cálculo y dibujo SVG)
  js/io.js           guardar, compartir y leer archivos (Android y navegador)
  js/mapa.js         lógica del mapa: capas base, qué se dibuja, avisos
  js/mapview.js      dibuja el mapa con Leaflet
  js/satelite.js     croquis con imagen de fondo del informe: satelital (Esri) y topográfico (OpenTopoMap) → imagen guardada dentro del informe
  js/perfil.js       perfil del relieve (altitud contra distancia acumulada)
  js/diagram.js      diagrama de Holdridge y plano del terreno con capas
  js/report.js       informe en texto y HTML
  js/store.js        datos guardados en el equipo
  js/app.js          interfaz
tests/               pruebas unitarias (npm test) y en navegador (tests/e2e)
tools/cobertura.js   mide qué código ejecutan las pruebas
android-res/         íconos de Android
scripts/             parche de Android y clave de firma
.github/workflows/   compilación del APK
```

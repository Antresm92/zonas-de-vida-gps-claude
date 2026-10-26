# Zonas de Vida · GPS + Diagrama de Holdridge

App para Android (y web instalable) que:

- toma puntos con el **GPS** del teléfono o con coordenadas escritas a mano,
- calcula **área y perímetro** del terreno (hectáreas, m², km² y fanegadas),
- entrega un **informe de zona de vida de Holdridge** con su diagrama, región latitudinal, piso altitudinal y provincia de humedad,
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

### Versión web en línea (GitHub Pages)
La misma app se publica como página web, para probarla desde el navegador del teléfono con un enlace, sin instalar el APK. **El APK se sigue generando exactamente igual**: la publicación web usa un archivo aparte (`.github/workflows/deploy-web.yml`) y no toca el del APK.

- **Enlace:** `https://antresm92.github.io/zonas-de-vida-gps-claude/` (aparece activo cuando termines los pasos de abajo y GitHub publique por primera vez).
- **Cómo se publica:** cada vez que llegan cambios a la rama `main`, GitHub prueba la app (`npm test`), prepara la carpeta `www/` con `scripts/preparar-web.js` y la publica. En la rama `version-web-online` solo prueba y prepara; **no publica**. También se puede lanzar a mano: pestaña **Actions › Publicar versión web › Run workflow**.
- **Actualizaciones:** el script cambia por sí solo el nombre de la memoria offline (`CACHE` de `sw.js`) en cada publicación, así nadie se queda con la versión vieja. Después de una publicación nueva, abre la página y recárgala una vez.
- **Instalarla como app:** en Chrome del teléfono abre el menú ⋮ › **Instalar app** (o **Añadir a la pantalla de inicio**). Después de la primera visita abre sin conexión.
- **Visibilidad:** GitHub Pages gratis solo publica desde repositorios **públicos**, y la página publicada es visible en internet para quien tenga el enlace aunque el repositorio sea privado. Si pasas el repositorio a privado con un plan gratuito, la página deja de publicarse.

**Pasos para activarla (una sola vez, con la página de GitHub):**
1. Sube la rama `version-web-online` (GitHub Desktop › **Push origin**) y revisa en **Actions** que «Publicar versión web» termine en verde. En esa rama no publica, solo comprueba.
2. En el repositorio: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
3. Une la rama a `main` (**Pull requests › New pull request › version-web-online › Create pull request › Merge**). Al llegar a `main` se publica.
4. En **Actions** se verá «Publicar versión web» y, al terminar, el enlace aparece en el trabajo «publicar» y en **Settings › Pages**. Ábrelo en el teléfono.

**Diferencias entre el APK y la versión web:**

| | APK | Versión web |
|---|---|---|
| Dónde viven los proyectos | En el teléfono, dentro de la app | Solo en ese navegador de ese equipo. Si borras los datos del sitio o cambias de navegador, no están. La app lo avisa y pide una copia de seguridad |
| GPS | Del teléfono | Del navegador: necesita HTTPS y permiso; la página debe estar abierta con la pantalla encendida |
| Exportar | Menú de compartir de Android | Menú de compartir del navegador si lo tiene; si no, descarga el archivo |
| Importar | Selector de archivos | Selector de archivos del navegador |
| Sin conexión | Siempre | Después de la primera visita (memoria offline del navegador) |
| NASA POWER y Open-Meteo | Funciona (comprobado en un teléfono real) | Debe funcionar igual; se comprueba una vez publicada la página |
| Mapa | Todavía no existe en ninguna de las dos versiones | Igual |

---

## 2. Cómo se usa

1. **Puntos**: pulsa *Activar GPS* y luego *Marcar punto aquí* en cada vértice del terreno. Quédate quieto unos 10 segundos: la app promedia las lecturas. También puedes *Escribir coordenadas* (decimales o grados-minutos-segundos), *Pegar varias* o *Importar archivo*.
   - **Precisión mínima para marcar puntos** (sin límite, ±3, ±5, ±10 o ±20 m): si el GPS está menos preciso que lo que elegiste, la app lo avisa **antes** de marcar («este punto no será el más preciso») y tú decides si marcas igual o esperas. No bloquea nada; el punto queda guardado con su precisión real y señalado en la lista.
2. **Área**: con 3 o más puntos aparecen el área, el perímetro, los lados con su rumbo y un dibujo del polígono. Si los lados se cruzan, avisa y ofrece reordenar los puntos. Aquí está **Exportar** (KML, GeoJSON, GPX y CSV).
3. **Clima**: muestra la altitud, la temperatura y la precipitación que se usan, de dónde sale cada una y deja corregirlas. Con los 12 meses de temperatura y lluvia dibuja el **diagrama de Walter-Lieth** y se puede guardar como imagen (SVG).
4. **Informe**: zona de vida, datos usados, zonas vecinas posibles según el margen de error, diagrama de Holdridge con tu punto, diagrama de Walter-Lieth y botón para compartir el informe (HTML) o copiar el resumen.
5. **Proyectos** (toca el nombre arriba): cambiar de proyecto, crear, renombrar, eliminar y **copia de seguridad**.

### Importar polígonos de Google Earth y otros archivos
*Puntos → Importar archivo* acepta **KML, KMZ, GeoJSON y GPX** (por ejemplo el polígono de tu finca guardado en Google Earth Pro, o un `.json` catastral en GeoJSON). Antes de importar muestra qué trae el archivo (polígonos, líneas, puntos, vértices, hectáreas) y avisa si algo se ignora (altitudes en 0, coordenadas fuera de rango, agujeros).

- Si el proyecto está **vacío**, el polígono pasa a ser el polígono del proyecto y se calcula el área.
- Si el proyecto **ya tiene puntos**, la app advierte y ofrece: *Agregar como capa nueva* (queda de otro color y **no cambia** tu área ni tu zona de vida), *Reemplazar mis puntos* o *Crear proyecto nuevo*. Todo se puede **deshacer** desde el aviso que aparece abajo.
- Cada capa tiene color y nombre editables, se puede ocultar, eliminar, o *Usar como polígono del proyecto* (lo que tenías antes queda como capa). «Mis puntos» también cambia de color.
- Las capas se dibujan en el plano de la pestaña Área y en el informe, con su leyenda.

### Exportar
*Área → Exportar* guarda un archivo y abre el menú de compartir de Android (correo, Drive, WhatsApp o «Guardar en…»):

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
- **305 pruebas unitarias** (`npm test`, solo Node, sin instalar nada) que cubren la lógica: distancias y áreas en el elipsoide WGS84 contra una integración numérica independiente (hemisferio sur, 60° de latitud, meridiano 180°), geometría del diagrama de Holdridge y zonas de vida de ciudades colombianas, lectura y escritura de KML/KMZ/GeoJSON/GPX/CSV, copia de seguridad y restauración con archivos dañados o manipulados, diagrama de Walter-Lieth, lectura de las respuestas de NASA POWER (formato clásico y formato nuevo) y de Open-Meteo, y el aviso de precisión del GPS.
- **71 pasos en un navegador (Chromium) con GPS e internet simulados** (`node tests/e2e/run.js`, necesita Playwright): la app completa recorrida como la usaría una persona, sin errores de JavaScript en la consola, incluido el funcionamiento sin red y la publicación en una subcarpeta como la de GitHub Pages.
- **Cobertura medida** (`node tools/cobertura.js`): las pruebas unitarias ejecutan el 99,7 % de las líneas de los módulos de lógica; sumando las pruebas en navegador, 99,9 % de todo `www/js`, con `app.js` (la interfaz) en 100 %. Las pocas líneas que faltan son ramas imposibles de provocar desde fuera.
- **Prueba de fallos provocados**: se cambiaron a propósito 127 operadores del código (por ejemplo `<` por `<=` o `&&` por `||`, elegidos al azar) y se comprobó que alguna prueba fallara. Se detectan 117 (92 %). Los 10 restantes, revisados uno por uno, no cambian el resultado de la app (por ejemplo, un ciclo que lee una posición de más sin efecto). Es una muestra, no todos los cambios posibles.

**No verificado:**
- **El APK no se compila en el entorno donde se programa** (bloquea los servidores de Android y npm). La versión 1 sí se compiló en GitHub y funcionó en un teléfono; esta versión no añade complementos nativos nuevos (usa los mismos de archivos y compartir), pero el APK nuevo sale del flujo de GitHub la primera vez.
- **No se probó en un teléfono real:** permisos y precisión del GPS, el menú de compartir de Android al exportar y el selector de archivos al importar. En el navegador simulado funcionan; en el teléfono falta confirmarlo.
- **Las consultas a internet no se ejecutaron contra los servicios reales** (NASA POWER y Open-Meteo): se probaron con respuestas de ejemplo. NASA POWER está cambiando el formato de su respuesta; la app entiende el clásico y el nuevo, y si ninguno funciona usa Open-Meteo y lo dice. Si ambos fallan, avisa y deja escribir los 12 meses a mano.
- La estimación de temperatura se ajustó con valores aproximados de ciudades colombianas, no con una serie de estaciones; fuera del trópico es solo una referencia.
- Una cobertura alta mide qué código se ejecuta, no que las pruebas comprueben lo correcto; por eso además se provocaron fallos a propósito (punto anterior).

El resultado es una **clasificación bioclimática orientativa**: no reemplaza un estudio de campo ni los datos de una estación meteorológica cercana.

---

## 4. Estructura

```
www/                 la app (HTML, CSS y JavaScript sin dependencias)
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

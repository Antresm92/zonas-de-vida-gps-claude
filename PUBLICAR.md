# Antes de publicar en Google Play — lista de verificación

Lista para revisar **antes** de subir Don Florentino SIG a Google Play. Marca cada casilla solo cuando esté hecha y comprobada.
Lo que dice «pendiente» es una decisión o un trámite que todavía no se ha hecho. Los requisitos de Google cambian: antes de
publicar, abre cada enlace y confirma que sigue igual (revisado el 25 de noviembre de 2026).

> Recordatorio: los resultados de la app son una **estimación** y no reemplazan a un profesional. Eso tiene que quedar dicho
> también en la ficha de la tienda y en las condiciones de uso.

## 1. Los dos paquetes que salen de GitHub (no se confunden)

| Artefacto en GitHub Actions | Archivo | Firma | Para qué |
|---|---|---|---|
| `don-florentino-sig-prueba-apk` | `don-florentino-sig-prueba.apk` | llave de **prueba** (`scripts/debug.keystore`, pública: está en el repositorio) | instalar en tu teléfono para probar; cada APK nuevo se instala encima del anterior |
| `don-florentino-sig-google-play-aab` | `don-florentino-sig-google-play.aab` | tu **llave de carga** (secretos `ANDROID_*`) | subirlo a Google Play; solo aparece si los secretos existen |

- [ ] El APK de prueba **nunca** se publica ni se reparte como versión oficial: su llave la tiene cualquiera.
- [x] El flujo se detiene si el `.aab` no está firmado o si lleva la llave de prueba (`scripts/check-aab-key.js`, desde la 2.33.0).
- [ ] El APK de prueba y la versión de Google Play **no se instalan uno encima del otro** (firmas distintas). Antes de instalar la de
      la tienda: en la app de prueba, *Herramientas › Proyectos › Copia completa (.zip)*; desinstala la de prueba; instala la de la
      tienda y restaura la copia.

## 2. Cuenta y llave

- [ ] Cuenta de desarrollador de Google Play (pendiente). Si es una cuenta **personal** creada después del 13 de noviembre de 2023,
      Google exige una **prueba cerrada con al menos 12 personas durante 14 días seguidos** antes de dejar publicar en producción
      ([requisito de pruebas](https://support.google.com/googleplay/android-developer/answer/14151465)). Consigue esas 12 personas
      con teléfono Android antes de empezar.
- [ ] Llave de carga creada (README, «Publicar en Google Play») y **copia guardada fuera del computador**, con sus contraseñas.
      Si se pierde, no se pueden publicar actualizaciones con ella (Google permite reemplazarla, pero es un trámite).
- [ ] Los cuatro secretos en GitHub (*Settings › Secrets and variables › Actions*): `ANDROID_KEYSTORE_BASE64`,
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- [ ] En Play Console, la firma de apps de Google Play (*Play App Signing*) activa: Google guarda la llave final y tú subes con la de carga.
- [ ] **Verificación de desarrollador de Android**: Google exige que las apps instaladas en teléfonos certificados sean de
      desarrolladores verificados. Empezó en septiembre de 2026 en Brasil, Indonesia, Singapur y Tailandia y Google anunció que
      llega a todos los países en **enero de 2027** ([qué es](https://support.google.com/android-developer-console/answer/16561738),
      [anuncio global](https://androidauthority.com/android-sideloading-rules-developer-verification-global-3737188)). Eso también
      afecta al **APK de prueba**: verifica tu identidad y registra el paquete `co.donflorentino.sig` antes de esa fecha, o cada
      teléfono tendrá que usar el procedimiento avanzado de Android para instalarlo.

## 3. Identidad de la app (no se puede cambiar después de publicar)

- [ ] Identificador: `co.donflorentino.sig` (desde la 2.33.0). Una vez publicado en Google Play **no se puede cambiar**.
- [ ] Nombre bajo el ícono: «Don Florentino SIG». Si en tu teléfono se corta, cambiarlo a «D F SIG» (prueba de campo de la 2.33.0).
- [ ] Ficha de la tienda: ícono de 512 × 512, gráfico destacado de 1024 × 500, capturas de pantalla, descripción corta y larga.
- [ ] Correo de contacto de la ficha: Google lo muestra en público. Usa uno de soporte, no el personal.
- [ ] Cuestionario de clasificación de contenido y público objetivo (la app no está dirigida a niños).

## 4. Privacidad (obligatorio, pendiente)

- [ ] **Política de privacidad** publicada en una dirección web **y dentro de la app**: Google la pide en los dos sitios
      ([política de datos del usuario](https://support.google.com/googleplay/android-developer/answer/10144311)). La app pide
      ubicación precisa (GPS); las fotos se toman con la app de cámara del teléfono (no pide el permiso de cámara).
      Debe decir, en palabras simples:
  - todo se guarda en el teléfono; no hay cuentas ni la app sube tus proyectos a ningún servidor;
  - para el mapa, el clima, la altitud y el mapa del IGAC se envía a esos servicios **solo la coordenada o la zona** que se consulta,
    y solo con internet (OpenStreetMap, Esri, OpenTopoMap, NASA POWER, Open-Meteo, IGAC);
  - las fotos quedan en el teléfono y solo salen si la persona las comparte o hace una copia;
  - la app no guarda dirección ni avalúo del predio;
  - las fotos pueden mostrar **personas**: quien toma la foto responde por ella (Ley 1581 de 2012, protección de datos personales).
- [ ] **Formulario de seguridad de los datos** (*Data safety*) en Play Console
      ([cómo llenarlo](https://support.google.com/googleplay/android-developer/answer/10787469)). Contestar lo mismo que dice la
      política: ubicación precisa y fotos se usan en el dispositivo; la coordenada se envía a los servicios de mapas y clima para
      que funcionen; nada se vende ni se usa para publicidad.
- [ ] Revisar la política de permisos de ubicación de 2026 (Google recomienda pedir la ubicación con el alcance mínimo)
      ([permisos](https://support.google.com/googleplay/android-developer/answer/9888170)). La app usa la ubicación solo con la
      pantalla abierta, nunca en segundo plano.
- [ ] **Condiciones de uso** (pendiente): resultados orientativos, «estimación, no reemplaza a un profesional»; el catastro y el
      mapa del IGAC son de referencia y no sirven para áreas oficiales ni para definir límites.

## 5. Licencias de los datos y mapas (pendiente: confirmar antes de publicar)

Todas las fuentes están citadas, con su enlace, en *Herramientas › Fuentes y licencias* (desde la 2.33.0). Lo que falta confirmar:

- [ ] **Imágenes de satélite de Esri** sin cuenta: el resumen de condiciones de Esri indica que, si no se usa software de Esri, se
      necesita una cuenta o suscripción de ArcGIS ([condiciones](https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf)).
      Decidir: conseguir la cuenta, pedir permiso o cambiar de proveedor de satélite.
- [ ] **Open-Meteo**: la versión gratuita es solo para uso **no comercial** y con menos de 10.000 consultas al día
      ([condiciones](https://open-meteo.com/en/terms)). Si la app se cobra o lleva anuncios, se necesita su plan pago. Su licencia
      pide un enlace junto a donde se muestran sus datos ([licencia](https://open-meteo.com/en/licence)): hoy está en
      *Fuentes y licencias*; confirmar si basta o si va también junto al clima.
- [ ] **OpenStreetMap**: su servidor de mapas es para uso moderado y pide identificar la app (ya se hace, desde la 2.32.0)
      ([política](https://operations.osmfoundation.org/policies/tiles/)). Con muchas personas usando la app, contratar otro proveedor.
- [ ] **OpenTopoMap**: pide contactarlos para proyectos grandes ([acerca de](https://opentopomap.org/about)).
- [ ] **ECOCROP / Recocrop** (GPL-3): la tabla de cultivos se copió del paquete Recocrop
      ([CRAN](https://cran.r-project.org/package=Recocrop)). Confirmar qué obliga la GPL-3 a una app que trae esos datos.
- [x] **IGAC** (CC BY 4.0, Resolución 616 de 2020): citado como pide la licencia.
- [ ] **Catastro**: la app no consulta el servicio del catastro (se quitó por riesgo legal). Pendiente: el correo al IGAC
      (contactenos@igac.gov.co) pidiendo autorización, si algún día se quiere la consulta directa.
- [ ] **Licencia del código del repositorio** (pendiente): hoy no tiene archivo de licencia, o sea «todos los derechos reservados».

## 6. Técnico

- [ ] Todas las pruebas en verde (`npm test` y `node tests/e2e/run.js`) y la compilación de GitHub en verde.
- [ ] Nivel de Android: desde el 31 de agosto de 2026, las apps nuevas y las actualizaciones deben apuntar a **Android 16 (API 36)**
      ([requisito](https://support.google.com/googleplay/android-developer/answer/11926878)). Hoy la app apunta a API 36 (Capacitor 8):
      revisarlo en el paso «Mostrar versión y niveles de Android» de la compilación.
- [ ] `versionCode` mayor que el de la versión anterior subida (sale solo de `package.json`).
- [ ] Decisión pendiente: versión mínima del WebView (teléfonos viejos).
- [ ] Pruebas de campo completas en un teléfono real (documento de pruebas de campo): GPS, fotos, copia y restauración, reporte.
- [x] Auditoría de seguridad de pantallas y reportes (2.33.0): textos importados y escritos salen como texto, no como código; el
      reporte HTML no deja correr scripts.

## 7. Después de publicar

- [ ] Revisar en Play Console los cierres inesperados y los «no responde» (ANR) de la primera semana.
- [ ] Responder las reseñas.
- [ ] Guardar en un lugar seguro la llave de carga y sus contraseñas (otra vez: sin ella no hay actualizaciones fáciles).

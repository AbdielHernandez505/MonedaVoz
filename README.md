# Moneda Voz

Moneda Voz es una herramienta estática que utiliza la cámara para apoyar el reconocimiento de monedas mexicanas y reproducir su descripción mediante audio. La interfaz está diseñada para baja visión: no usa textos menores de 18 px, ofrece resultado dominante, controles grandes y un modo opcional de texto gigante.

## Archivos

La aplicación usa HTML, CSS y JavaScript puro. Incluye `index.html`, `styles.css`, `app.js`, `my_model/model.json`, `my_model/metadata.json`, `my_model/weights.bin` y `sounds/confirm.mp3`. El archivo de sonido es el MP3 `lichess-confirmation.mp3` proporcionado por el usuario, guardado en la ruta que utiliza la aplicación.

Las librerías se cargan desde CDN: `@tensorflow/tfjs` versión `4.22.0` y `@teachablemachine/image` versión `0.8.5`. El modelo local se carga desde `./my_model/` y conserva las clases `1 peso`, `2 pesos`, `5 pesos`, `10 pesos`, `20 pesos`, `Fondo`.

## Puesta en marcha

Después de extraer el ZIP, ejecuta:

```bash
cd moneda-voz
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`. La primera carga necesita conexión a internet para descargar las librerías CDN. La cámara requiere `localhost` o HTTPS; no abras `index.html` directamente como archivo.

## Audio y detección

Pulsa `Iniciar cámara y audio`. En ese gesto se desbloquean tanto `speechSynthesis` como el elemento Audio del navegador. Cuando una moneda supera el umbral y se mantiene durante cinco cuadros seguidos, se reproduce `./sounds/confirm.mp3`; al terminar, o después de un respaldo máximo de 800 ms, se anuncia el valor en español `es-MX`. El botón `Silenciar` cancela y bloquea ambos audios. Retirar o mover la moneda no corta una frase de voz que ya esté sonando.

El umbral inicial es 85 %. `Fondo` y las predicciones por debajo del umbral no hablan. Se mantiene un cooldown de 3 segundos y no se repite la misma moneda hasta pasar por Fondo o detectar otra. `Repetir voz` vuelve a leer la última moneda confirmada.

## Accesibilidad

`Texto gigante` aumenta tamaños y espaciados en toda la vista. Los atajos son: `Espacio` para iniciar o detener la cámara cuando el foco no está en un control, `R` para repetir la última moneda y `M` para silenciar o activar el audio. Los botones tienen una altura mínima de 64 px y un foco visible dorado de 4 px.

El procesamiento de imagen ocurre en el navegador y no sube imágenes a un servidor. La herramienta no identifica falsificaciones y la confianza no garantiza una identificación correcta.

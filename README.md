# Moneda Voz

Moneda Voz es una herramienta estática que utiliza la cámara para apoyar el reconocimiento de monedas mexicanas y reproducir su descripción mediante audio. La interfaz está diseñada para baja visión: no usa textos menores de 18 px, ofrece resultado dominante, controles grandes y un modo opcional de texto gigante.

## Archivos

La aplicación usa HTML, CSS y JavaScript puro. Incluye `index.html`, `styles.css`, `app.js`, `my_model/model.json`, `my_model/metadata.json`, `my_model/weights.bin` y `sounds/confirm.mp3`. El archivo de sonido es el MP3 `lichess-confirmation.mp3` proporcionado por el usuario, guardado en la ruta que utiliza la aplicación.

Las librerías se cargan desde CDN: `@tensorflow/tfjs` versión `4.22.0` y `@teachablemachine/image` versión `0.8.5`. El modelo local se carga desde `./my_model/` y conserva las clases `1 peso`, `2 pesos`, `5 pesos`, `10 pesos`, `20 pesos`, `Fondo`.

## LINK DEL PROYECTO

https://monedavoz-ktnogmfl.manus.space/


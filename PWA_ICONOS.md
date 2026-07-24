# Icono de Dr Plants en la pantalla de inicio

Esta versión incluye configuración PWA para Android, iPhone y iPad:

- `public/manifest.json`
- `public/sw.js`
- iconos de 192 × 192 y 512 × 512
- icono adaptable (`maskable`) para Android
- icono de 180 × 180 para Apple
- etiquetas PWA y Apple dentro de `public/index.html`

## Prueba después del despliegue

1. Publica los archivos y espera a que el deployment termine.
2. Abre `https://drplants.campushbc.com` en el teléfono.
3. Android/Chrome: menú → **Agregar a pantalla principal** o **Instalar app**.
4. iPhone/Safari: Compartir → **Agregar a pantalla de inicio**.
5. Si ya existía un acceso anterior, elimínalo y agrégalo nuevamente para que tome el icono nuevo.

La aplicación debe mostrar la hoja blanca sobre el fondo verde dentro del icono.

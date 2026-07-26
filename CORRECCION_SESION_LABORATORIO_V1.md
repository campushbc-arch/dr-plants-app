# Corrección de sesión del Laboratorio — V1

- La sesión se restaura al iniciar la aplicación, no solo cuando se envía un mensaje.
- El chat del Laboratorio usa una única función de validación del token persistido.
- Se evita mostrar "inicia sesión" por un estado temporal desactualizado de la PWA.
- Ante un 401, la aplicación comprueba una vez el token persistido antes de cerrar la sesión.
- Las solicitudes de análisis también restauran la sesión antes de validar.
- Se incrementó la versión del caché del Service Worker para retirar el JavaScript anterior.

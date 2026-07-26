# Dr. Plants V6.2 — Corrección de envío en Dr. Agro

## Problema corregido
El botón del Agrónomo Inteligente dependía del evento `submit` y de `requestSubmit()`. En algunas instalaciones PWA o navegadores móviles ese evento no estaba ejecutándose, aunque el Laboratorio sí funcionaba porque usaba un manejador directo.

## Solución
- El botón de Dr. Agro llama directamente a `sendMsg()` mediante `onclick`.
- La tecla Enter llama directamente a `sendMsg()`.
- Se eliminó la doble ruta de eventos que podía provocar inconsistencias.
- Se mantuvieron el bloqueo de doble envío, la renovación de sesión y el manejo de respuestas de IA.
- Se eliminó del saludo el texto que pedía registrarse a usuarios ya autenticados.
- Se cambió la caché del service worker para forzar la actualización de la PWA.

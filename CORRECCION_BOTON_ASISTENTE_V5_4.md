# Dr. Plants V5.4 — corrección del botón de envío

Se reemplazó el envío basado únicamente en atributos HTML `onclick` por un formulario real con evento `submit`.

Cambios:
- Botón explícito `type="submit"`.
- Evento `submit` registrado al cargar la interfaz.
- Envío con Enter mediante `requestSubmit()`.
- Exposición explícita de `window.sendMsg`.
- Protección contra doble envío.
- Mensaje visible si ocurre un error de interfaz.
- Refuerzo de `pointer-events` y `z-index` del botón.
- Nueva caché de PWA para retirar la interfaz anterior.

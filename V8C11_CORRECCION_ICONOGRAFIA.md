# Dr. Plants V8C.11 — Corrección integral de iconografía

- Se detectaron 33 iconos `ti-*` utilizados por la interfaz sin una máscara SVG definida.
- Al no existir la máscara, la regla base `background-color: currentColor` renderizaba un cuadrado sólido.
- Se añadieron las definiciones SVG faltantes para Home Mercadeo y el resto de la aplicación.
- Se corrigieron, entre otros: speakerphone, pausa/play, chevrons, arrow-right, paperclip, photo, camera, user, settings, shield, credit-card, PDF, mensajes, presentación, world y truck.
- Se actualizó el caché PWA para forzar la carga del CSS corregido después del despliegue.
- Verificación: 70 clases de iconos usadas / 70 definidas / 0 faltantes.

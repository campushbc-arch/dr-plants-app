# Dr. Plants V8C.9 — Precios de mercado y TRM

## Mejoras
- Cada precio de la sección Precios & Mercado muestra fecha de publicación disponible.
- Si la fuente entrega hora, se muestra junto a la fecha; si no, se conserva la fecha oficial.
- Se muestra la unidad de comercialización (kg, carga, tonelada u otra unidad reportada).
- Se muestra explícitamente la fuente SIPSA-DANE para precios consultados en Datos Abiertos Colombia.
- Se mantiene una referencia de respaldo cuando el servicio público no responde, claramente identificada como referencia y no como precio en vivo.
- Se incorporó una tarjeta USD/COP con la TRM oficial publicada por la Superintendencia Financiera de Colombia mediante el conjunto de datos 32sa-8pi3 de Datos Abiertos Colombia.
- La tarjeta TRM muestra valor, vigencia y fuente.

## Despliegue
No requiere nuevas variables de entorno. Conservar `.env`, `drplants.db`, `uploads` y `node_modules`.

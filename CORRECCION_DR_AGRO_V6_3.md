# Dr Plants V6.3 — Corrección definitiva de Dr. Agro

## Causa identificada
La consulta sí activaba `sendMsg()`, pero fallaba antes de llamar al backend al construir el contexto de los lotes. Algunos lotes cargados desde la base de datos no tenían una entrada coincidente en `CROPS` o `LOCATIONS`, y el código intentaba leer `.label` de un valor indefinido.

## Corrección
- `loteContextoTexto()` ahora tolera datos incompletos y distintos formatos provenientes del backend.
- Se protegen cultivos, ubicaciones, aplicaciones, análisis, costos y semanas.
- Si algún dato no existe, se usa una descripción segura en vez de detener el asistente.
- Si ocurre cualquier error inesperado, Dr. Agro continúa con contexto general.
- Se actualizó la caché de la PWA a V6.3.

# AgroCircular V5 — buscador sin APIs comerciales

Esta versión elimina la dependencia de Google Places y no necesita `GOOGLE_MAPS_API_KEY`.

## Fuentes

1. Directorio propio guardado en SQLite (`puntos_circulares`).
2. OpenStreetMap para geocodificar ciudades.
3. Overpass API para localizar centros de reciclaje, puntos limpios y estaciones de transferencia.

Estas fuentes no cobran por cada búsqueda. Son servicios públicos sujetos a políticas de uso razonable, disponibilidad y límites de capacidad. Para evitar sobrecarga, Dr. Plants conserva cada búsqueda durante 30 minutos.

## Flujo del usuario

El usuario selecciona Colombia, Perú o Chile, su departamento/región, ciudad y residuo. El sistema combina el directorio propio con datos abiertos. Cuando no encuentra un punto, puede registrar una solicitud de recolección con cantidad, dirección y observaciones.

## Administración

Endpoints disponibles para el administrador:

- `GET /api/admin/circular/puntos`
- `POST /api/admin/circular/puntos`
- `PATCH /api/admin/circular/puntos/:id`
- `GET /api/admin/circular/solicitudes`
- `PATCH /api/admin/circular/solicitudes/:id`

Las solicitudes admiten los estados: `pendiente`, `contactando_gestor`, `programada`, `recolectada` y `cancelada`. Cada actualización notifica al usuario dentro de Dr. Plants.

## Variable opcional

`CIRCULAR_SEARCH_RADIUS_METERS=30000`

Define el radio de búsqueda alrededor de la ciudad. No agregue `GOOGLE_MAPS_API_KEY`; ya no se usa.

## Recomendación operativa

El equipo administrador debe alimentar y verificar progresivamente el directorio propio con gestores autorizados. Los resultados de OpenStreetMap deben confirmarse por teléfono antes de trasladar residuos, especialmente envases agroquímicos y materiales peligrosos.

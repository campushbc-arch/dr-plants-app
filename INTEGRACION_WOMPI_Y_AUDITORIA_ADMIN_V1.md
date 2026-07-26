# Integración Wompi y auditoría administrativa — V1

## Alcance implementado

- El administrador puede consultar conversaciones del módulo Laboratorio, respuestas de IA y documentos adjuntos.
- El administrador puede ver pedidos con usuario, fecha, estado, total y detalle por producto.
- El expediente muestra todos los datos del perfil, fotografías y documentos.
- Cada documento puede marcarse como pendiente, verificado o rechazado, dejando una observación.
- El administrador puede revisar el historial de pagos Wompi.
- Se habilitaron cobros por productos, consulta personalizada y análisis de laboratorio.

## Configuración Wompi

Configure en Hostinger:

- `WOMPI_PUBLIC_KEY`
- `WOMPI_INTEGRITY_SECRET`
- `WOMPI_EVENTS_SECRET`
- `APP_URL=https://drplants.campushbc.com`
- `PRECIO_CONSULTA_COP`
- `PRECIO_ANALISIS_LAB_COP`

Use primero las llaves de Sandbox. No coloque secretos privados dentro de `public/index.html`.

Configure en el panel de Wompi la URL de eventos:

`https://drplants.campushbc.com/api/pagos/wompi/eventos`

El servidor valida el checksum del evento antes de cambiar un pago a aprobado. La redirección del navegador no aprueba compras ni servicios.

## Flujo

1. La aplicación crea el pedido o la solicitud.
2. El backend calcula el valor y genera una referencia única.
3. El backend firma el pago y entrega la URL de Checkout.
4. El usuario paga en Wompi.
5. Wompi notifica el resultado por webhook.
6. Solo un evento auténtico con estado `APPROVED` cambia el pedido a pagado o activa el servicio.

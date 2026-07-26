# Dr. Plants V2.1 — Notificaciones bidireccionales

## Implementado

- Centro de notificaciones para cada usuario autenticado.
- Confirmación al crear solicitudes de laboratorio y consulta personalizada.
- Notificación cuando el administrador cambia el estado de laboratorio.
- Retroalimentación escrita del administrador incluida en la notificación.
- Agendamiento de consultas con fecha, hora, profesional y enlace/ubicación.
- Notificación por aprobación o rechazo del perfil de agrónomo.
- Notificación por aprobación o rechazo de documentos, incluyendo observaciones.
- Marcado individual y masivo de notificaciones como leídas.
- Envío opcional por correo cuando SMTP está configurado.

## Variables opcionales para correo

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
ADMIN_NOTIFICATION_EMAIL=

Sin SMTP, todas las notificaciones dentro de la aplicación siguen funcionando.

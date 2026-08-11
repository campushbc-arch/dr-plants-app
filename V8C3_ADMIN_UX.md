# Dr. Plants V8C.3 — Administración y accesos temporales

## Correcciones
- El acceso temporal dejó de depender de `prompt()` y de un `onclick` con nombre de usuario incrustado.
- Nuevo modal administrativo para seleccionar duración, tipo y motivo.
- La lista de usuarios muestra si existe un acceso temporal vigente y su fecha de vencimiento.
- Al otorgar o revocar acceso se actualizan inmediatamente usuarios y accesos temporales.

## Centro de alertas
- El panel muestra por defecto solo hasta 8 notificaciones pendientes.
- El historial se consulta bajo demanda y muestra hasta 30 registros recientes.
- Se conserva la opción de marcar todas como leídas.
- Se eliminó del panel principal la sensación de lista interminable de notificaciones.

## Navegación administrativa
Se agregó navegación rápida a Usuarios, Suscripciones, Operación, Formación e IA/Contenido.

No requiere nuevas variables de entorno ni cambios de base de datos.

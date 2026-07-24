# Control de acceso de usuarios

El panel administrador ahora permite:

- listar usuarios registrados;
- buscar por nombre, correo o teléfono;
- filtrar activos o bloqueados;
- bloquear y desbloquear cuentas;
- registrar fecha y motivo de bloqueo.

## Seguridad

El bloqueo se valida tanto al iniciar sesión como en cada solicitud autenticada. Un token emitido antes del bloqueo deja de servir inmediatamente. Las cuentas administradoras no aparecen en el listado y no pueden bloquearse desde este módulo.

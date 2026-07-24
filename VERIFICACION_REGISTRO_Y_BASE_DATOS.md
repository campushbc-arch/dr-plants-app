# Verificación de registro y base de datos

## Cambios incluidos
- Solo `splash` y `registro/inicio de sesión` son públicos.
- Todas las herramientas requieren una sesión JWT válida.
- El token se conserva en `localStorage` y se valida con `/api/auth/me`.
- El registro no permite modo demo si falla el servidor.
- Todos los campos del formulario son obligatorios.
- Las cuentas `admin` no pueden crearse desde el formulario público.
- El correo se normaliza a minúsculas.
- Endpoint administrativo de comprobación: `GET /api/admin/database-status`.

## Variable recomendada en Hostinger
Configura `DB_PATH` con una ruta persistente fuera de la carpeta de despliegue, por ejemplo:

`/home/u754460429/data/drplants.db`

Crea la carpeta si Hostinger no la crea automáticamente y asegúrate de que el proceso Node tenga permisos.

## Prueba de persistencia
1. Registra una cuenta de prueba con todos los campos.
2. Cierra sesión e inicia sesión nuevamente.
3. Haz un redeploy.
4. Vuelve a iniciar sesión.
5. Como administrador, consulta `/api/admin/database-status`.
6. Verifica que `usuarios` aumente y que `integrity` sea `ok`.

Si el usuario desaparece después del redeploy, la ruta actual de SQLite no es persistente y se debe corregir `DB_PATH`.

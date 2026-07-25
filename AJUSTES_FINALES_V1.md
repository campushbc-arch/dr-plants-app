# Ajustes finales Dr Plants V1

Esta versión cierra el primer modelo antes de iniciar Dr Plants V2.

## Registro de agrónomos
- Número de tarjeta profesional obligatorio.
- Especialidad obligatoria.
- Documento de identidad obligatorio (PDF, JPG, PNG o WEBP, máximo 10 MB).
- Archivo de tarjeta profesional obligatorio (PDF, JPG, PNG o WEBP, máximo 10 MB).
- El agrónomo queda en estado pendiente y no recibe sesión hasta ser aprobado.

## Revisión administrativa
- El administrador puede abrir el documento de identidad y la tarjeta profesional.
- El servidor impide aprobar una solicitud si falta cualquiera de los dos documentos.
- Aprobar, rechazar, bloquear y desbloquear son acciones independientes.

## Persistencia
Configurar en Hostinger:

DB_PATH=/home/u754460429/data/drplants/drplants.db
UPLOADS_PATH=/home/u754460429/data/drplants/uploads

No cambiar estas rutas en despliegues posteriores.

## Visualización administrativa de documentos

El panel de administración incluye ahora un expediente por usuario. Desde **Gestión de usuarios → Ver expediente y documentos**, el administrador puede:

- consultar los datos básicos del usuario;
- ver todos los archivos asociados a su cuenta;
- visualizar imágenes JPG, PNG y WEBP dentro de la aplicación;
- visualizar documentos PDF dentro de la aplicación;
- descargar el archivo original;
- revisar tanto los archivos aportados durante el registro como los cargados posteriormente desde el perfil.

Las solicitudes pendientes de agrónomos conservan los botones **Ver identidad** y **Ver tarjeta**, que utilizan el mismo visor protegido. Los archivos solo pueden abrirse con una sesión válida de administrador.

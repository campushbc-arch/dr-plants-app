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

# Parche de seguridad de carga de archivos — Dr. Plants V1

## Cambios incluidos

- Multer actualizado de 1.4.5-lts.1 a 2.2.0.
- Registro público limitado a 5 intentos por IP cada 15 minutos.
- Subidas autenticadas limitadas a 10 intentos por IP cada 15 minutos.
- Límites estrictos de archivos, campos, partes, encabezados y tamaño.
- El registro solo admite los campos `documentoIdentidad` y `tarjetaArchivo`.
- Verificación del contenido real mediante firmas mágicas de PDF, JPEG, PNG y WEBP.
- Verificación de coherencia entre extensión, MIME declarado y contenido real.
- Eliminación automática de archivos rechazados o huérfanos.
- Respuestas controladas para errores de Multer y archivos inválidos.
- Los documentos continúan almacenados fuera de la carpeta pública y se sirven mediante rutas autenticadas.

## Despliegue

1. Reemplazar el contenido del repositorio con esta versión.
2. En Hostinger ejecutar un redeploy completo para que se reinstalen las dependencias.
3. Confirmar en los logs que la instalación utiliza `multer@2.2.0`.
4. Ejecutar, cuando haya terminal disponible: `npm audit --omit=dev`.

## Pruebas mínimas

- Registro de agricultor sin archivos.
- Registro de agrónomo con identidad y tarjeta válidas.
- Rechazo de archivo superior a 10 MB.
- Rechazo de ZIP, SVG, HTML y ejecutables.
- Rechazo de un archivo renombrado como PDF o JPG.
- Rechazo de campos de archivo no autorizados.
- Respuesta HTTP 429 después de superar el límite de intentos.

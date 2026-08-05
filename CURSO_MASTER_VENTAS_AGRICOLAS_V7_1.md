# Dr. Plants V7.1 — Curso comercial agrícola

## Funcionalidad incorporada

- Sección **Otros cursos** dentro de Formación Tecnológica.
- Curso inicial: **Máster en Sistemas de Venta y Cierre de Negocios en el Sector Agrícola**.
- Descripción, precio y temario de 6 módulos / 18 lecciones.
- Datos de matrícula tomados automáticamente del perfil autenticado.
- Pago por Wompi por **$320.000 COP**.
- Pago aprobado deja la matrícula en `pago_aprobado`.
- El administrador recibe notificación y ve la matrícula, usuario, referencia y estado del pago.
- Solo el administrador puede activar el acceso.
- El usuario recibe notificación al ser activado.
- El contenido del curso está protegido por el backend y solo se entrega a matrículas activas.

## Flujo de prueba

1. Usuario entra a Formación Tecnológica > Otros cursos.
2. Abre el curso y consulta el temario.
3. Pulsa Matricularse, confirma sus datos y paga con Wompi.
4. Wompi envía `transaction.updated` al webhook.
5. El administrador entra a Panel > Matrículas de cursos.
6. Verifica `APPROVED` y pulsa **Activar acceso**.
7. El usuario recibe la notificación y puede entrar al contenido.

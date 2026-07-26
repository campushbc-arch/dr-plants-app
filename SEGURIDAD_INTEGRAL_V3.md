# Dr. Plants V3 — endurecimiento integral de seguridad

## Implementado

1. **Nodemailer actualizado a 9.0.3** para retirar la rama 6.x señalada por Dependabot.
2. **Helmet** para cabeceras HTTP seguras: HSTS en producción, anti-sniffing, referrer policy y protección de recursos.
3. **Rate limiting profesional** para API general, login, registro, archivos, pagos y webhook de Wompi.
4. **CORS estricto y control de Origin** basado en `APP_URL` y `CORS_ORIGIN`.
5. **JWT endurecido**: HS256 explícito, issuer, audience y vencimiento por defecto de 12 horas.
6. **Contraseñas reforzadas**: mínimo 10 caracteres, letras y números; bcrypt con 12 rondas por defecto.
7. **Validación y saneamiento** de objetos, cadenas, correos, teléfonos, identificadores y claves peligrosas.
8. **Límites de cuerpo HTTP** y protección contra parameter pollution con HPP.
9. **Carga de archivos protegida**: tamaño, MIME permitido, extensión y firma mágica del contenido.
10. **Auditoría de seguridad persistente** para registros, accesos, intentos fallidos, pagos y webhooks.
11. **Identificador por solicitud** (`X-Request-ID`) para rastrear errores sin exponer detalles internos.
12. **Errores seguros**: no se devuelven stack traces ni datos sensibles al navegador.
13. **Comprobación estática** con `npm run security:check` y script `npm run audit`.
14. **Endpoint administrativo** `/api/admin/auditoria-seguridad` para revisar eventos recientes.

## Consideración sobre CSRF

La API usa tokens Bearer en `Authorization`, no cookies automáticas de sesión. Por ello el CSRF clásico basado en cookies no aplica del mismo modo. Se agregó validación de `Origin` para operaciones de escritura desde navegadores y se excluyó únicamente el webhook firmado de Wompi.

## Variables obligatorias o recomendadas

- `JWT_SECRET`: mínimo 32 caracteres aleatorios en producción.
- `APP_URL=https://drplants.campushbc.com`
- `CORS_ORIGIN=https://drplants.campushbc.com`
- `NODE_ENV=production`
- `JWT_EXPIRES_IN=12h`
- `BCRYPT_ROUNDS=12`

## Despliegue

1. Conserva `.env`, la base de datos y `uploads`.
2. Reemplaza el código con esta versión.
3. Ejecuta o deja que Hostinger ejecute `npm install`.
4. Reinicia la aplicación.
5. Inicia sesión nuevamente: los tokens anteriores no tienen issuer/audience y serán rechazados deliberadamente.
6. Ejecuta `npm audit --audit-level=high` cuando tengas terminal disponible.
7. Prueba registro, login, archivos, laboratorio, pedidos y Wompi.

## Nota sobre CSP

El frontend actual contiene JavaScript y estilos inline. Activar una CSP estricta rompería la interfaz. Helmet protege el resto de cabeceras y la CSP queda desactivada temporalmente. La siguiente mejora recomendada es mover scripts y estilos a archivos externos y activar CSP con nonces o hashes.

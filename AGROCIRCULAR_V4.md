# AgroCircular V4 — búsqueda territorial y sesión continua

## Funcionalidades

- Selección de país, departamento/región y ciudad para Colombia, Perú y Chile.
- Selección del residuo: envases agroquímicos, empaques, residuos vegetales, orgánicos o reciclables generales.
- Consulta desde el backend para no exponer la llave de Google.
- Resultados con nombre, dirección, teléfono, horarios, fuente y enlace de navegación.
- Google Places como fuente principal; OpenStreetMap como alternativa cuando la llave no está configurada.
- Sesión renovable mediante cookie HttpOnly segura. Las peticiones reintentan automáticamente después de renovar el token.

## Variables nuevas

```env
GOOGLE_MAPS_API_KEY=tu_llave_de_google_places
REFRESH_TOKEN_DAYS=30
```

En Google Cloud habilita **Places API (New)** y restringe la llave al servidor/dominio de producción. No pongas la llave en `public/index.html`.

## Nota de sesión

Los usuarios que ya estaban conectados antes de instalar V4 deberán iniciar sesión una sola vez para recibir la cookie renovable. Después, el sistema conservará la sesión hasta 30 días, salvo cierre manual, bloqueo de cuenta o revocación.

## Verificación recomendada

1. Iniciar sesión.
2. Entrar a Circular y hacer varias búsquedas sin volver a autenticarse.
3. Esperar o simular la expiración del token de acceso y repetir una petición.
4. Confirmar que `/api/auth/refresh` renueva la sesión automáticamente.
5. Probar ciudades de Colombia, Perú y Chile.

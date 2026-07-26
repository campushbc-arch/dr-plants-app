# Dr. Plants V5.3 — corrección de arranque y rate limiting

## Error corregido

Se eliminó el `keyGenerator` personalizado que devolvía `req.ip` directamente. En `express-rate-limit` 8 esta forma dispara `ERR_ERL_KEY_GEN_IPV6` porque no normaliza correctamente las redes IPv6. El limitador vuelve a utilizar el generador predeterminado de la librería, que aplica su helper seguro para IPv4 e IPv6.

## Proxy de Hostinger

El servidor mantiene `trust proxy` con un salto por defecto y permite configurarlo con:

```env
TRUST_PROXY_HOPS=1
```

No se recomienda usar `trust proxy=true`, porque permitiría falsificar la IP del cliente si la infraestructura no elimina encabezados externos.

## Verificaciones

Ejecutar antes de desplegar:

```bash
npm install
npm run check
```

Después del despliegue, revisar:

- `/api/health` responde 200.
- Inicio de sesión funciona.
- El asistente responde.
- Laboratorio, pagos y AgroCircular no generan errores 500.
- Los logs no muestran `ERR_ERL_KEY_GEN_IPV6`.

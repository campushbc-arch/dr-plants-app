# Dr. Plants V8B — Inteligencia agronómica

## Alcance implementado

V8B amplía el CRM agronómico V8A con inteligencia por lote:

- Georreferenciación persistente de finca (latitud, longitud y altitud).
- Clima por lote a través de un adaptador meteorológico de backend.
- Precipitación, temperatura, humedad, ET0, radiación y viento.
- Balance hídrico indicativo por cultivo y necesidad de riego orientativa.
- Grados-día y señal de riesgo por calor.
- Registro de lluvia real medida en finca para comparar modelo vs. campo.
- Parámetros de proyección por lote: rendimiento objetivo, unidad, precio y etapa fenológica.
- Proyección de producción, ingreso, costos, utilidad y margen, con factor climático indicativo.
- Mercado oficial: conector automático ODEPA para Chile; fuentes oficiales identificadas para DANE-SIPSA (Colombia) y MIDAGRI (Perú), con tabla normalizada preparada para sus conectores y carga administrativa validada.
- Base de conocimiento agronómico administrable.
- Dr. Agro recibe automáticamente contexto de clientes, fincas, cultivos, riesgos climáticos y conocimiento validado.

## Variables meteorológicas

Opcionales:

- `WEATHER_API_BASE`: base del proveedor compatible con Open-Meteo. Por defecto `https://api.open-meteo.com`.
- `WEATHER_GEOCODING_BASE`: por defecto `https://geocoding-api.open-meteo.com`.
- `WEATHER_API_KEY`: clave del endpoint comercial, si aplica.
- `CLIMA_CACHE_MINUTES`: caché local, por defecto 30 minutos.
- `ODEPA_RESOURCE_ID`: recurso CKAN activo de precios mayoristas Chile. Se incluye un valor por defecto verificado al construir V8B.

Para pruebas puede utilizarse el endpoint público configurado por defecto. Antes de ofrecer Dr. Plants como servicio comercial con suscripción, configure un endpoint meteorológico con licencia comercial o una instancia propia compatible. El frontend ya no llama directamente a Open-Meteo: las solicitudes pasan por el backend, de modo que una clave comercial no queda expuesta.

## Interpretación

Los cálculos V8B son apoyo a decisión, no garantía de producción. La lluvia modelada debe complementarse con mediciones en campo cuando sea posible. La proyección financiera requiere que el usuario configure un rendimiento objetivo realista y, cuando no exista una cotización oficial normalizada, un precio objetivo/referencia.

## Mercado

- Chile: consulta automática del datastore de ODEPA para precios mayoristas de frutas y hortalizas.
- Colombia: fuente oficial DANE-SIPSA registrada. La estructura queda lista para un conector específico de datos diarios normalizados.
- Perú: fuente oficial MIDAGRI/Datero Agrario registrada. La estructura queda lista para sincronización de recursos publicados por MIDAGRI.

Nunca se presenta un precio como precio garantizado; se conserva fuente, mercado, fecha, unidad y moneda cuando están disponibles.

## Pruebas de aceptación

1. Crear una finca con país, región y ciudad.
2. Abrir un lote y verificar “Inteligencia del cultivo · V8B”.
3. Confirmar lluvia, ET0, balance hídrico y riesgos.
4. Registrar lluvia medida y confirmar que aparezca en el panel.
5. Configurar rendimiento objetivo y precio; verificar la proyección.
6. En Chile, probar un cultivo presente en ODEPA y verificar cotizaciones oficiales.
7. Cargar un artículo en la base de conocimiento desde el panel admin.
8. Preguntar a Dr. Agro por un lote y confirmar que use el contexto sin inventar datos.

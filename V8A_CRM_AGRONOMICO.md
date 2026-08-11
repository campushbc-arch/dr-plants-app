# Dr. Plants V8A — CRM Agronómico Profesional

Primera parte de V8. No requiere todavía credenciales nuevas de Wompi.

## Incluye
- Ingenieros agrónomos pueden registrar clientes propios.
- Cada cliente puede tener fincas asistidas y múltiples lotes/cultivos.
- Cada finca queda identificada por cliente, ubicación y profesional gestor.
- El agrónomo puede registrar y editar lotes que él administra, aplicaciones, análisis y costos.
- Se agregan visitas técnicas por lote.
- Resumen profesional: clientes, fincas, lotes y hectáreas asistidas.
- Productores mantienen la gestión de sus propias fincas.
- Los datos entre agrónomos quedan separados por usuario autenticado.

## Compatibilidad
Se conserva la tabla `fincas` existente y se agregan columnas mediante migración, por lo que no se borran los datos previos.

## Próxima parte V8B
Inteligencia climática e hídrica por lote, usando ubicación real y datos meteorológicos abiertos.

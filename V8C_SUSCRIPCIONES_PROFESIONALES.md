# Dr. Plants V8C — Suscripciones profesionales

## Planes
- Starter: 1–50 ha, $50.000/mes, $420.000/año.
- Professional: 51–200 ha, $76.000/mes, $638.400/año.
- Business: 201–800 ha, $120.000/mes, $1.008.000/año.
- Enterprise: 801–1.600 ha, $240.000/mes, $2.016.000/año.
- Corporate: 1.601+ ha, $460.000/mes, $3.864.000/año.

La anualidad aplica 30% de descuento sobre 12 mensualidades.

## Flujo
1. Cultivo es una sección premium para productores y agrónomos.
2. El usuario selecciona plan y periodicidad.
3. La tarjeta se tokeniza directamente navegador → Wompi; Dr. Plants nunca guarda PAN/CVC.
4. El backend crea una fuente de pago con WOMPI_PRIVATE_KEY.
5. En ese instante comienzan 7 días gratuitos.
6. Al terminar la prueba, el backend ordena el cobro recurrente. Si se aprueba, activa el periodo mensual/anual.
7. Si falla, queda morosa y reintenta al día siguiente; usuario y administrador reciben notificación.
8. Si supera el máximo de hectáreas del plan, conserva datos pero se bloquean operaciones premium hasta actualizar el plan.

## Variables nuevas
WOMPI_PRIVATE_KEY=prv_test_... (Sandbox) o prv_prod_... (Producción)
WOMPI_ENVIRONMENT=sandbox | production

Nunca expongas WOMPI_PRIVATE_KEY al navegador ni a GitHub.

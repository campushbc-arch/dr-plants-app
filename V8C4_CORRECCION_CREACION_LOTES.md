# Dr. Plants V8C.4 — creación robusta de fincas y lotes

- Corrige el bloqueo aparente al pulsar **Crear lote y generar plan**.
- Agrega estado visual de guardado y bloqueo contra doble clic.
- Añade timeout controlado para ubicación y guardado.
- Crea finca y lote en una sola transacción SQLite mediante `/api/fincas/crear-lote-completo`.
- Reutiliza una finca existente del mismo propietario/cliente en lugar de duplicarla.
- Valida el límite de hectáreas antes de insertar el nuevo lote.
- Mantiene acceso temporal/demo sin límite comercial, según la política V8C.1.
- Los errores ahora se muestran al usuario y en consola en vez de dejar la interfaz aparentemente congelada.

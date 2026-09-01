# V8C.8 · Privacidad de datos demo

- Los usuarios nuevos ya no reciben fincas ni lotes precargados.
- Los datos reales (`es_demo=0`) y los datos de demostración (`es_demo=1`) se filtran de forma excluyente en backend.
- Solo Super Admin y Ejecutivo Comercial pueden ver datos demo, y únicamente con Modo Demo activado.
- El Super Admin en modo normal ve exclusivamente información real; en modo demo ve únicamente sus propios escenarios demo.
- El frontend inicia `LOTES=[]`; se eliminó la biblioteca hard-coded que podía aparecer antes de sincronizar con backend.
- Cuando no existen fincas/lotes se muestra un estado vacío con instrucción para crear la primera finca.

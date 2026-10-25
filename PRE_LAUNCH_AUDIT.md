# PRE-LAUNCH AUDIT: especificación (resumen)

Este es el resumen de la especificación de auditoría que entregó el dueño el 2026-10-04. El estado vivo está en `AUDIT_STATE.md` y el historial en `AUDIT_HISTORY.md`. Ambos se leen siempre antes de empezar un ciclo.

## Ciclo
AUDITAR → ANALIZAR → PRIORIZAR → ARREGLAR → PROBAR → VERIFICAR → AUDITAR OTRA VEZ

El ciclo se repite hasta cumplir los criterios de producción. Cada ciclo se agrega a `AUDIT_HISTORY.md` y no se borra ninguno.

## Reglas
- Nunca borrar código a ciegas. Clasificar cada caso como CONFIRMADO / PROBABLE / POSIBLEMENTE USADO DINÁMICAMENTE. Solo se borra lo CONFIRMADO.
- Hay referencias dinámicas: `onclick="..."` en el HTML, nombres de funciones armados dentro de template strings, `localStorage`, y el camino de respaldo a Sheets.
- No cambiar el comportamiento previsto, salvo para arreglar un bug, un problema de seguridad o un problema de producción confirmado.
- Cambios chicos y reversibles. No agregar dependencias. Respetar la arquitectura actual.
- Arreglo automático solo con confianza CONFIRMADA o ALTA. Lo de confianza MEDIA o BAJA va a revisión humana.
- Nunca ocultar errores para que pasen las pruebas. Nunca imprimir secretos. Nunca commitear credenciales.
- No resetear el repo ni tocar cambios ajenos.
- Lo que pueda romper algo se deja como está y se marca HUMAN_REVIEW_REQUIRED.
- Si el mismo problema vuelve dos ciclos seguidos, se marca HUMAN_REVIEW_REQUIRED.
- Seguridad va antes que limpieza.

## Severidad
- **CRITICAL**: no se puede salir a producción. Ejemplos: secreto expuesto, bypass de auth, pérdida de datos, build roto.
- **HIGH**: arreglar antes del lanzamiento.
- **MEDIUM**: preferible arreglar antes.
- **LOW**: deuda técnica.
- **INFO**: observación.

## Verificación en este proyecto
No hay build, lint ni typecheck. Es HTML estático con JS sin bundler. En su lugar se usa:
- Pruebas: `for f in tests/*.test.js; do node $f; done`.
- Sintaxis: extraer el `<script>` más grande de `index.html` y correr `node --check`. También `node --check js/*.js`.
- Prueba manual en el navegador, en la copia local (launch config `crumbly-static`, puerto 8814).
- Asesores de Supabase (seguridad y rendimiento) por MCP. El MCP es de solo lectura: el SQL lo corre el dueño.

## Recorrido de flujos de negocio (obligatorio desde el ciclo 6)

Revisar código y correr tests no alcanza. En el ciclo 6 un campo que existía
pero estaba escondido en "Más opciones" hizo que un día entero de operación
no capturara ni un cliente, y cinco ciclos de auditoría no lo vieron.

Cada ciclo recorre de punta a punta, en un celular real o en el navegador a
375 px y con datos parecidos a los reales:

1. **Vender**: producto con adiciones, cliente nuevo (teléfono y nombre),
   cliente que vuelve (otro formato de teléfono) y venta sin cliente.
2. **Cobrar**: efectivo, transferencia con comprobante (foto vertical) y
   pago dividido, con y sin descuento.
3. **Pedidos**: llega al otro dispositivo, Listo, Entregado, deshacer y
   editar la nota.
4. **Gastos**: compra de inventario con varias líneas y comprobantes.
5. **Cerrar caja**: cuadra efectivo y transferencias y muestra descuentos.
6. **Contar inventario**: conteo físico completo hasta cerrarlo.
7. **Reabrir la app**: sigue "Sincronizado", los datos están y hay respaldo
   del día.

Por cada paso hay que preguntarse: ¿una persona con fila en la caja lo
encuentra y lo hace en segundos? Lo que no se encuentra cuenta como roto.

## Criterio de producción
CRITICAL = 0, HIGH = 0, pruebas OK, sintaxis OK, seguridad aceptable, configuración verificada y **recorrido de flujos sin fallas**. Además, un ciclo final independiente sin hallazgos nuevos CRITICAL o HIGH.

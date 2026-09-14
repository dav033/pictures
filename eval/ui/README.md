# Fixtures de interfaz

Datos para las pruebas e2e de la pantalla principal (`scripts/e2e-modo-vista.ts`).

- `plan-resuelto-arco-columnas.json`: `PlanResuelto` real resuelto el 2026-09-14 contra el catálogo local (arco orgánico blanco y dorado más un par de columnas, XV años). Contiene IDs y títulos públicos del catálogo, sin datos de clientes ni órdenes. El `approval_token` se reemplazó por un marcador sin firma, así que el plan no se puede aprobar contra el servidor real: la prueba simula `/api/chat` y `/api/generate`. Se añadieron `event_match_levels` y `event_relaxations` para ejercitar el contenido que solo se ve en modo dev.

Si el contrato de `PlanResuelto` cambia, regenerar el plan con una conversación real y volver a quitar el token.

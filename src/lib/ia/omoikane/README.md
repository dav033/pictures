# Omoikane

Chat de edición de propuesta: el agente conversacional que usa herramientas
para armar y ajustar la decoración. Nombrado por la deidad sintoísta de la
sabiduría y la inteligencia — "el que teje pensamientos" — que en el mito
idea el plan para resolver la crisis de Amaterasu, igual que este agente
razona sobre un turno de conversación y decide qué herramienta ejecutar.

- **Entrada**: historial de mensajes + brief del cliente ([ejecutar.ts](ejecutar.ts)).
- **Salida**: texto de respuesta + brief/recomendaciones/plan actualizados
  (`ResultadoConversacion`).
- **Proveedor / modelo**: Google Gemini, `MODELO_CHAT` ([gemini.ts](../../gemini.ts)),
  a través del motor genérico en `packages/agente-core` (extraído para ser
  reutilizable fuera de este dominio).
- **System prompt**: [prompt-sistema.ts](prompt-sistema.ts) (`construirSistema`).
- **Consumidor principal**: [api/chat/route.ts](../../../app/api/chat/route.ts).

Archivos propios: `ejecutar.ts`, `prompt-sistema.ts`, `historial-chat.ts`,
`texto-final-turno.ts`, `jerga-interna.ts`.

Lo que NO vive aquí, a propósito: el registro de herramientas
([`../herramientas/`](../herramientas/)) y el registro de proveedores
([`../nucleo/registro.ts`](../nucleo/registro.ts)) son infraestructura
compartida — también los usa el editor de plan (`/api/plan-editar`) y la
generación de imagen.

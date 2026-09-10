# Decision 0004: Embeddings de consulta por la frontera Python

**Estado:** aceptada para canario, no activada por defecto
**Fecha:** 2026-09-10

## Contexto

El catalogo ya usa vectores de 768 dimensiones generados con
`gemini-embedding-2`. Los embeddings de consulta seguian llamando al proveedor
desde TypeScript, mientras la migracion de reranking y la reindexacion
documental ya usaban la frontera Python.

## Decision

Se agrega `POST /internal/v1/embed` con el scope HMAC independiente
`ai.embedding`. El endpoint acepta solo `RETRIEVAL_QUERY`, usa el mismo modelo,
dimensiones y proveedor que el job documental, y devuelve un vector validado por
Next.

El `body_sha256` del contexto representa el cuerpo operativo canónico (el
payload de echo o los campos de la operación), no el envelope HTTP completo.
El receptor Python lo recalcula desde el JSON recibido después de validar el
modelo; la firma HMAC sigue cubriendo el envelope completo. Así el hash que
controla idempotencia no puede ser declarado distinto del contenido operativo,
sin depender de una serialización que pierda espacios significativos.

Las reclamaciones de idempotencia `in_progress` no se eliminan al expirar:
evitar que un worker tardío pueda finalizar una reclamación reutilizada tiene
prioridad sobre limpiar automáticamente una reclamación abandonada. Si falla
la finalización, el handler intenta registrar un estado `failed`; la
recuperación de reclamaciones huérfanas requiere un lease con fencing token y
queda como trabajo explícito de la fase operativa.

La activacion requiere el flag especifico
`RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED=true` y la seleccion general
`PYTHON_BACKEND_ENABLED=true`. `PYTHON_BACKEND_KILL_SWITCH` conserva prioridad
absoluta. Si la llamada Python falla, retrieval omite el vector y conserva sus
ramas lexicas; Python no puede modificar la whitelist comercial.

## Alternativas descartadas

- Mantener otra implementacion Gemini en TypeScript: prolonga dos fronteras de
  proveedor y dos lugares de observabilidad.
- Activar el cambio junto con reranking: mezcla dos variables de calidad y
  dificulta atribuir regresiones o coste.
- Permitir que el endpoint devuelva candidatos: viola la autoridad de
  PostgreSQL y amplia innecesariamente el contrato.

## Consecuencias y rollback

- La imagen Python debe recibir una clave Gemini antes del canario.
- El flag apagado mantiene exactamente el camino actual.
- El kill switch o el apagado del flag permite volver al embedding TypeScript;
  un fallo durante una solicitud degrada a retrieval lexical.
- La llamada real al proveedor y el despliegue siguen pendientes de
  autorizacion operativa y de coste.

# Embeddings de consulta Python (Fase 8.4)

**Corte:** 2026-09-10. **Estado:** implementado localmente, verificado y
apagado por defecto. No desplegado ni habilitado en trafico real.

## Contrato

- Next llama `POST /internal/v1/embed` mediante la frontera HMAC
  `operational.v1`.
- El scope independiente es `ai.embedding`.
- El cuerpo operativo contiene `text` y `task_type=RETRIEVAL_QUERY`.
- Python valida el texto, llama `gemini-embedding-2` con 768 dimensiones y
  devuelve `values`, `model`, `dimensions`, `task_type` y el numero de intentos.
- La respuesta se valida de nuevo en TypeScript, incluyendo finitud y cantidad
  de dimensiones.

## Activacion reversible

La ruta requiere simultaneamente:

- `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED=true`.
- `PYTHON_BACKEND_ENABLED=true`.
- `PYTHON_BACKEND_KILL_SWITCH` apagado.
- `RAG_USE_VECTOR=true`.

Con cualquier condicion falsa, el comportamiento actual permanece en Next.
Cuando Python esta seleccionado y falla, los consumidores de retrieval
conservan las ramas lexicas y no inventan un vector.

Los consumidores cubiertos son el chat de presupuesto, la busqueda hibrida y
la recuperacion por slot. El embedding documental offline no pasa por este
endpoint.

## Coste y despliegue

El endpoint requiere `GEMINI_API_KEY` o `GOOGLE_API_KEY` en el proceso Python.
El flag permanece apagado hasta reconstruir la imagen, provisionar la clave en
el entorno autorizado y ejecutar un canario controlado. No se realizo una
llamada real al proveedor durante esta implementacion.

## Verificacion

- `services/ai-api/tests/test_main.py` cubre autenticacion, scope y respuesta.
- `scripts/test-python-adapter.ts` cubre path, firma, hash, scope y respuesta.
- `npx tsc --noEmit`, Ruff y mypy pasan.

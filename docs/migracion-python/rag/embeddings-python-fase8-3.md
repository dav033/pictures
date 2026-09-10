# Embeddings documentales Python (Fase 8.3)

**Corte:** 2026-09-10. **Estado:** implementado y verificado. La migracion
`023_embedding_provenance.sql` ya esta aplicada en Neon; la corrida no encontro
pendientes y por eso no genero llamadas Gemini.

## Alcance

- `services/ai-api/scripts/embed_catalog.py` es un CLI offline; no es una ruta
  FastAPI y no participa en el retrieval de requests.
- `npm run rag:embed` conserva el punto de entrada operativo, pero delega en el
  CLI Python. El proveedor ya no se invoca desde `scripts/generate-embeddings.ts`.
- Python usa `google-genai==1.21.1`, `gemini-embedding-2`,
  `RETRIEVAL_DOCUMENT` y `VECTOR(768)`.
- La migracion `023_embedding_provenance.sql` agrega dimensiones y task type,
  y backfilla la provenance de las filas historicas sin forzar un reindexado
  pagado completo.
- El job valida el SHA-256 de `search_text`, procesa contenidos por lotes,
  limita concurrencia, reintenta solo errores transitorios, escribe de forma
  idempotente y evita dos ejecuciones simultaneas con un lease persistente
  compatible con conexiones pooler.
- El checkpoint local no contiene secretos y se escribe atomically en
  `data/staging/rag-embedding-checkpoint.json`.
- Cada lote registra `embedding_documento` en `ai_call_log`; un fallo de
  telemetria no convierte un embedding ya persistido en fallo.

## Seguridad y reversibilidad

- `--dry-run` solo consulta PostgreSQL; no llama Gemini ni escribe datos.
- El upsert exige que `embedding_source_hash` siga coincidiendo con el producto
  bloqueado antes de guardar el vector. Si el catálogo cambia, el producto se
  marca stale y se reintenta en otra corrida.
- Los errores del proveedor no imprimen la clave ni el DSN; el checkpoint solo
  conserva estado, hash, intentos y un mensaje acotado.
- Los embeddings de consulta usados por retrieval todavía viven en
  `src/lib/rag/embeddings.ts`. Mover ese camino requiere un contrato Python
  online y un canario separado; no se mezcla con esta reindexacion offline.

## Verificacion

```text
44 passed, 3 skipped
ruff check: PASS
ruff format --check: PASS
mypy app scripts: PASS
uv lock --check: PASS
npx tsc --noEmit: PASS
npm run rag:embed -- --help: PASS
```

La corrida normal limitada tambien termino con cero pendientes. No se ejecuto
una llamada real al proveedor porque todos los embeddings existentes ya
cumplen modelo, dimensiones, task type y hash de origen.

Los embeddings de consulta tienen ahora un contrato online separado en
`docs/migracion-python/rag/embeddings-query-python-fase8-4.md`; permanece
apagado por defecto y no altera este job offline.

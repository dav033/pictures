# Reranking Python del RAG (Fase 8.2)

**Corte:** 2026-09-09. **Estado:** implementado, verificado y desplegado; el
flag permanece apagado por defecto.

## Diseño

- `buscarHibrido()` aplica primero las ramas PostgreSQL, filtros duros y
  `finalVariantWhitelist()`. Solo después ordena por `finalScore` y obtiene
  `catalog_products.search_text` para una ventana acotada.
- `RAG_RERANK_ENABLED=true` y `PYTHON_BACKEND_ENABLED=true` habilitan la llamada
  `POST /internal/v1/rerank`. Python recibe `{ context, query, candidates }` y
  devuelve `{ order, scores }`; no puede añadir, quitar ni cambiar variantes.
- El adaptador comparte la firma HMAC `operational.v1` con Echo, pero conserva
  el cuerpo plano específico de rerank. El scope es `ai.rerank`.
- TypeScript ignora los scores para no delegar autoridad comercial: conserva
  `finalScore`, la whitelist y los `variantIds`, y solo aplica `order` a la
  ventana autorizada.
- Cualquier timeout, error de transporte, modelo o respuesta inválida vuelve
  al orden local. `branchStatus.rerank` deja `READY`, `SKIPPED_OPTIONAL` o
  `ERROR` para observabilidad.
- La inferencia se ejecuta con `asyncio.to_thread()` y un límite de un worker
  para no bloquear el event loop. El Dockerfile precarga los pesos durante el
  build y `RERANK_MODEL_WARMUP=1` calienta el modelo antes de readiness; el
  runtime no depende de descargarlo ni inicializar Torch en la primera request.

## Dependencias y modelo

- Modelo aprobado: `cross-encoder/ms-marco-MiniLM-L-6-v2`.
- Revision fijada: `233902d25c440f23af6f7d6e94d2946bac0bee0a`.
- `sentence-transformers==3.3.1`.
- `torch==2.5.1`; en Linux la lockfile usa el índice CPU de PyTorch.
- `truststore==0.10.4` solo está en la dependencia opcional de test para que
  las evaluaciones locales respeten los certificados del sistema. No se instala
  en la imagen (`uv sync --frozen --no-dev`).

## Evidencia

### Contrato e invariantes

```text
uv run --system-certs --extra test python -m pytest tests -q
38 passed, 3 skipped

uv run --system-certs ruff check app tests scripts/eval_rerank.py
All checks passed

npm run contracts:test:python-adapter
Python adapter: OK

npx tsc --noEmit
PASS
```

Los tres skips de pytest son las pruebas que requieren una URL de base de datos
de integración y quedaron correctamente omitidas sin DSN.

### Evaluación de orden

Fixture: `eval/rag/rerank-fixture-v1.json`, seis casos con candidatos ya
autorizados y `ideal_order` revisado. Runner:
`services/ai-api/scripts/eval_rerank.py`.

Con el modelo real y cache local:

| Métrica | Antes | Después |
|---|---:|---:|
| MRR | 0.500000 | 1.000000 |
| nDCG@3 | 0.852494 | 0.990835 |

El primer resultado relevante pasó a la primera posición en los seis casos. Dos
casos intercambiaron resultados secundarios, por lo que la mejora se
registra como fuerte pero no perfecta.

### RAG local

Con `DATABASE_URL=postgresql://demo:demo@127.0.0.1:5432/demo_rag`, sin vector ni
proveedor Gemini, el fixture de Fase 8.1 pasó:

```text
25 casos, nombre_recall_at_5=1, filtro_precision=1,
sin_resultado_accuracy=1, ids_invalidos_total=0, error_count=0
```

La misma suite con el backend Python local habilitado y el modelo calentado
también pasó. Una primera request en un proceso local sin
`RERANK_MODEL_WARMUP` puede registrar `rerank=ERROR` y conservar el orden local
mientras termina la carga del modelo; la prueba aislada posterior registró
`rerank=READY`. La imagen de producción activa el warmup antes de readiness.

### Despliegue

- Commit desplegado: `a9cb0a1`.
- CI de calidad y workflow de despliegue: exitosos.
- La imagen Python se construyó en EC2 desde este `Dockerfile`, incluyendo los
  pesos fijados del modelo.
- El contenedor activo respondió `/healthz` y `/readyz` con HTTP 200.
- Una llamada autenticada real a `POST /internal/v1/rerank` respondió HTTP 200
  con orden y scores del cross-encoder.
- `RAG_RERANK_ENABLED` sigue en `false`; por tanto, el tráfico RAG continúa con
  el orden local y el rollback funcional no requiere cambiar la imagen.

## Rollback

Dejar `RAG_RERANK_ENABLED=false` desactiva la capacidad sin cambiar código. Si
el backend Python deja de seleccionarse o se activa
`PYTHON_BACKEND_KILL_SWITCH=true`, el RAG continúa con el orden PostgreSQL.

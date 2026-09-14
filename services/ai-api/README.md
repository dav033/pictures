# AI API: contratos locales

Servicio FastAPI para la autoridad de dominio Python. Expone contratos
versionados, retrieval comercial desde PostgreSQL y el cross-encoder local de
reranking. El runtime no llama a un proveedor generativo para catálogo ni
reranking; el build de Docker descarga el modelo abierto aprobado desde
Hugging Face y lo deja dentro de la imagen.

## Entorno

Desde `services/ai-api`:

```bash
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
```

Con `uv` y `uv.lock`:

```powershell
uv sync --extra test
uv run --extra test python -m pytest
uv run --extra quality ruff check app scripts tests
uv run --extra quality ruff format --check app scripts tests
uv run --extra quality mypy app scripts
```

`pyproject.toml` fija versiones explícitas de FastAPI, Pydantic v2, pytest y del backend de build. Usa Python 3.11 o 3.12.

## Modelos generados

El generador lee los 37 esquemas versionados del repositorio: 9 de `contracts/chat/v1/` y 28 de `contracts/domain/v1/`.

Regenerar:

```bash
python scripts/generate_models.py
```

La salida incluye clases Pydantic raíz y validadores Draft 7 embebidos. Así,
`oneOf`, `$ref`, restricciones anidadas y `additionalProperties` se validan en
runtime sin depender de rutas del checkout.

Comprobar drift sin escribir:

```bash
python scripts/generate_models.py --check
```

El resultado es estable, ordenado y sin timestamps. El generador usa solo la biblioteca estándar y no accede a la red.

## Pruebas

Configura `PYTHONPATH` para importar `app` desde esta carpeta:

```bash
# Linux/macOS
PYTHONPATH=. python -m pytest
# Windows PowerShell
$env:PYTHONPATH = "."
python -m pytest
```

## Servidor y contenedor

`uvicorn` esta fijado como dependencia de runtime. Arranque local:

```powershell
rtk uv run --system-certs uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Evaluacion local del reranker (descarga el modelo si aun no esta en cache):

```powershell
uv run --system-certs --extra test python scripts/eval_rerank.py
```

La imagen usa `Dockerfile`, ejecuta como usuario no root y conserva readiness
fail-closed cuando no existe store durable en produccion. No incluye secretos;
inyectar `INTERNAL_HMAC_SECRET` mediante el gestor autorizado del entorno.

## Catálogo Python

`POST /internal/v1/catalog/search` es la primera capacidad comercial propiedad
de Python. Usa el snapshot de catálogo publicado en PostgreSQL y aplica en el
servidor los filtros de disponibilidad, precio, categoría, ocasión, color,
acabado, forma, diámetro y allowlist. Los SKU originales/canónicos se resuelven
antes de la búsqueda lexical; un SKU ambiguo no devuelve candidatos
seleccionables. La respuesta incluye la whitelist exacta y el snapshot que la
produjo.

La operación requiere el scope HMAC `catalog.search` y un `DATABASE_URL` con
acceso de lectura al catálogo. Next puede conservar una URL pública como
fachada, pero no debe consultar estas tablas ni repetir sus predicados.

### Selección comercial

`POST /internal/v1/catalog/selection` (scope `catalog.selection`) valida
contra el snapshot publicado las líneas elegidas dentro de la allowlist del
turno. Los rechazos por whitelist, stock, inventario o precio siguen siendo
HTTP 200 con `rechazados`. Una allowlist que empareja una variante con un
producto que no es su dueño en el snapshot es una entrada inválida:

| Código | HTTP | Causa | Qué debe hacer el llamador |
| --- | ---: | --- | --- |
| `allowlist_product_mismatch` | 422 | Un par `product_id`/`variant_id` de la allowlist no corresponde al dueño real de la variante en el snapshot. | Reconstruir la allowlist desde filas del catálogo; no reintentar el mismo payload. |

### Recomendaciones del editor

`POST /internal/v1/catalog/recommendations` (scope `catalog.recommendations`,
contratos `catalog-recommendations.v1` y `catalog-recommendations-result.v1`)
devuelve alternativas para una variante de referencia dentro de un
`catalog_snapshot_id` obligatorio. La referencia debe existir en ese snapshot
con producto `ACTIVE` (no se exige disponibilidad). Los candidatos cumplen los
mismos predicados comerciales que la resolución de planes: snapshot en ambas
tablas, `ACTIVE`, producto y variante disponibles, `COP`, `price > 0` y
`unidades_paq > 0`; además mismo `codigo_tamano` (o, si falta, mismo
diámetro), misma forma cuando la referencia la tiene, y mismo producto o misma
categoría. La variante de referencia se excluye. `lora_variant_ids` es opcional
(ausente = sin restricción; nunca vacío) y se aplica en SQL antes de `LIMIT`
(`limit` ≤ 100). El orden es el de SQL (mismo producto primero, título, precio);
Next solo puede reordenar por color y recortar para presentación, nunca añadir.
La operación es de solo lectura y no usa idempotency key.

| Código | HTTP | Causa | Qué debe hacer el llamador |
| --- | ---: | --- | --- |
| `catalog_snapshot_not_found` | 422 | El snapshot solicitado no está publicado. | Tratarlo como contexto de propuesta vencido; no caer a un snapshot sin fijar. |
| `reference_variant_not_found` | 422 | La variante de referencia no existe con producto `ACTIVE` en ese snapshot. | Informar que no hay alternativas para esa variante. |
| `invalid_request` | 422 | El sobre operativo o el payload no cumple el contrato. | Corregir el request antes de reintentarlo. |
| `insufficient_scope` | 403 | La firma no incluye `catalog.recommendations`. | Firmar con el scope de la operación. |
| `catalog_store_unavailable` | 503 | El servicio no puede usar el store de catálogo. | Reintentar cuando el store esté listo. |

## Resolución Python de planes

`POST /internal/v1/plan/resolve` resuelve el contrato activo `plan-resolution.v1`
para Plan 1.0. Requiere el scope HMAC `plan.resolve`, un
`catalog_snapshot_id` publicado y una allowlist de variantes producida por la
búsqueda del mismo turno. La respuesta compuesta valida
`plan-resuelto.v1`, `design-material-estimate-v1` y `quote.v1`; Plan 1.1 sigue
cerrado hasta que sus consumidores y rollback estén preparados.

### Contrato de errores

Los errores de `/internal/v1/plan/resolve` se distinguen entre resultados de
dominio y fallos del límite de transporte o infraestructura:

| Código | HTTP | Causa | Qué debe hacer el llamador |
| --- | ---: | --- | --- |
| `invalid_plan` | 422 | El plan no cumple Plan 1.0. | Corregir el plan antes de reintentarlo. |
| `catalog_snapshot_not_found` | 422 | El snapshot solicitado no está publicado. | Obtener un snapshot publicado y una allowlist del mismo turno; después reintentar. |
| `allowlist_product_mismatch` | 422 | Una entrada de la allowlist, o un material/`variant_override` cuyo `product_id` es un producto real del snapshot, usa una variante que pertenece a otro producto. La propiedad se comprueba por identidad (sin filtrar estado, stock ni precio). Una variante desconocida en el snapshot no es este error: queda en `sin_cobertura`. | Corregir los pares `product_id`/`variant_id` con datos del catálogo; no reintentar el mismo payload. |
| `invalid_request` | 422 | El sobre operativo o su payload no cumple el contrato de transporte. | Corregir el request, su contexto o su firma antes de reintentarlo. |
| `catalog_store_unavailable` | 503 | El servicio no puede usar el store de catálogo. | Aplicar la política de disponibilidad del servicio y reintentar cuando el store esté listo. |

La falta de cobertura de un material **no es un error**. En ese caso la ruta
responde HTTP 200 y entrega `plan_resuelto.sin_cobertura` con los materiales no
resueltos y `plan_resuelto.sustituciones` cuando se aplicó una sustitución
admisible. El llamador debe usar esos datos para explicar la cobertura parcial
al cliente, no convertirla en un fallo de la operación.

## Embeddings documentales offline

La reindexacion de `catalog_embeddings` vive en Python y no es una ruta FastAPI
ni parte del camino de retrieval. Primero aplica la migracion comercial
`023_embedding_provenance.sql`; despues ejecuta desde la raiz:

```powershell
npm run rag:embed -- --dry-run
npm run rag:embed -- --batch-size 8 --concurrency 2
```

El comando npm conserva el punto de entrada operativo, pero delega en
`services/ai-api/scripts/embed_catalog.py`. El job usa `google-genai`, mantiene
el modelo `gemini-embedding-2`, `RETRIEVAL_DOCUMENT` y 768 dimensiones, valida
el hash de `search_text`, escribe de forma idempotente y conserva un checkpoint
sin secretos en `data/staging/rag-embedding-checkpoint.json`. La ejecución real
requiere `DATABASE_URL` y `GEMINI_API_KEY`; `--dry-run` no llama a Gemini ni
escribe PostgreSQL.

La capacidad de reranking esta apagada por defecto en Next (`RAG_RERANK_ENABLED=false`).
El servicio solo procesa candidatos enviados por el caller; no consulta el catalogo
ni puede cambiar la whitelist. La imagen de Docker descarga el modelo durante el
build y activa un warmup antes de readiness (`RERANK_MODEL_WARMUP=1`), por lo que
el runtime no necesita acceso saliente a Hugging Face ni inicializa Torch en la
primera request.

## Embeddings de consulta online

La ruta `POST /internal/v1/embed` usa el mismo contrato HMAC y el scope
`ai.embedding`. Next solo la selecciona cuando
`RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED=true`, `PYTHON_BACKEND_ENABLED=true` y el
kill switch esta apagado; el retrieval vectorial tambien debe estar activo con
`RAG_USE_VECTOR=true`. El valor por defecto permanece apagado; el entorno
Python necesita `GEMINI_API_KEY` o `GOOGLE_API_KEY` para llamar al proveedor.
Si Python falla, los consumidores del retrieval conservan las ramas lexicas.

## Store PostgreSQL durable

En producción configura `DATABASE_URL` con un DSN PostgreSQL válido y aplica
antes la migración `migrations/001_operational_schema.sql` con el runner Python
propietario de este linaje. El servicio crea un pool `asyncpg` acotado y usa
transacciones no bloqueantes para consumir nonces y reservar/finalizar claves de
idempotencia. Nunca registra el DSN ni sus credenciales.

```powershell
$env:APP_ENV = "production"
$env:DATABASE_URL = "postgresql://usuario:contraseña@host/base"
$env:INTERNAL_HMAC_SECRET = "<secreto provisionado de 32 bytes o más>"
rtk uv run --system-certs uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Sin `DATABASE_URL`, los entornos `development`, `test` y `local` usan el store
en memoria. En producción `/readyz` devuelve `503` hasta que exista el DSN,
el pool pueda conectarse y el store durable esté listo. El ejemplo de secreto
es un marcador: no lo generes ni lo guardes en el repositorio.

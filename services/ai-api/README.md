# AI API: contratos locales

Servicio FastAPI para validar contratos versionados y ejecutar el cross-encoder local de reranking. El runtime no llama a un proveedor generativo; el build de Docker descarga el modelo abierto aprobado desde Hugging Face y lo deja dentro de la imagen.

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

El generador lee los 33 esquemas versionados del repositorio: 9 de `contracts/chat/v1/` y 24 de `contracts/domain/v1/`.

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

La capacidad de reranking esta apagada por defecto en Next (`RAG_RERANK_ENABLED=false`).
El servicio solo procesa candidatos enviados por el caller; no consulta el catalogo
ni puede cambiar la whitelist. La imagen de Docker descarga el modelo durante el
build y activa un warmup antes de readiness (`RERANK_MODEL_WARMUP=1`), por lo que
el runtime no necesita acceso saliente a Hugging Face ni inicializa Torch en la
primera request.

## Store PostgreSQL durable

En producción configura `DATABASE_URL` con un DSN PostgreSQL válido y aplica
antes la migración `migrations/020_operational_idempotency.sql` desde el repo
propietario de migraciones. El servicio crea un pool `asyncpg` acotado y usa
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

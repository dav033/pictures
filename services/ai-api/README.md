# AI API: contratos locales

Servicio mínimo para validar contratos versionados con FastAPI y Pydantic v2. Esta carpeta no llama proveedores de IA ni envía tráfico real.

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

La imagen usa `Dockerfile`, ejecuta como usuario no root y conserva readiness
fail-closed cuando no existe store durable en produccion. No incluye secretos;
inyectar `INTERNAL_HMAC_SECRET` mediante el gestor autorizado del entorno.

No hay servidor desplegado, credenciales de proveedores ni pruebas contra tráfico real en esta slice.

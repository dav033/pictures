# Etapa 4 - preparacion reversible y gates externos

Estado: **cerrada en entorno local reproducible; despliegue/cutover externo pendiente**.

El repo backend ya fue generado en
`C:\Users\davidt\Downloads\workspace\demo-decoracion-api`. El repo Next
continua en su ubicacion original y tiene un enlace hermano reversible en
`workspace/demo-decoracion`; no se movieron ni limpiaron sus cambios sucios.
El destino de despliegue, secretos reales y trafico remoto siguen sin estar
autorizados. Eso queda como gate externo posterior; no se afirma trafico
remoto.

## Cambios locales

- `src/lib/ia/python-adapter.ts` firma `operational.v1` con HMAC, hash exacto,
  request/correlation IDs, scopes, nonce nuevo por intento, deadline y
  `AbortSignal`. Mapea errores upstream a codigos estables.
- `src/app/api/internal/ai/echo/route.ts` demuestra corte por endpoint:
  Next por defecto, Python solo con `PYTHON_BACKEND_ENABLED`, y
  `PYTHON_BACKEND_KILL_SWITCH` siempre gana. No hay fallback automatico despues
  de seleccionar Python.
- `scripts/test-python-adapter.ts` cubre default, flag, kill switch, firma,
  headers, timeout, cancelacion, auth, replay y conflicto con `fetch` controlado.
- `scripts/contract-e2e-next-python.ps1` automatiza contra procesos locales
  levantados: primera llamada, replay, conflicto y timeout; si Next tiene
  `APP_PASSWORD`, la toma solo del entorno y no la imprime.
- `services/ai-api/` agrega store local inyectable de nonce/idempotencia,
  readiness fail-closed en produccion, limites, deadline, timeout,
  cancelacion, metricas y errores estables. No llama proveedores ni decide
  catalogo, stock, precio, cantidades, identidad, aprobacion o cotizacion.
- El repo backend extraido agrega `PostgresOperationalStore` con `asyncpg`,
  pool acotado, readiness contra PostgreSQL y fallback en memoria solo para
  desarrollo/test.
- `services/ai-api/Dockerfile` y `.dockerignore` preparan imagen reproducible;
  `uvicorn` queda fijado en `pyproject.toml` y `uv.lock`.
- `scripts/extract-ai-api.ps1` valida fuente, contratos, destino y autorizacion;
  extrae sin sobrescribir a layout independiente y escribe manifiesto sin
  secretos.
- `scripts/contract-e2e-ai-api.ps1` prueba el endpoint Python con HMAC, hash,
  scope, nonce, firma invalida, body alterado y ventana temporal, cuando exista
  un secreto local ya provisionado.
- ADR 0003 fija destino, layout, gates y rollback.

La evidencia Next-Python es local y reversible, no desplegada. Con un secreto
fixture efimero se observo HTTP real local contra el repo backend extraido y un
PostgreSQL Docker desechable: readiness 200, primera llamada 200 en Python,
replay 200 con header de replay, conflicto 409 y deadline 504. La migracion se
aplico dos veces y las tablas quedaron presentes; el conteo posterior mostro
una operacion completada y cuatro nonces. Tambien se comprobo Next por defecto
y kill switch forzando Next. No hay secreto provisionado, base remota
autorizada ni trafico remoto.

## Extraccion reproducible

Preflight desde raiz:

```powershell
rtk pwsh -NoProfile -File scripts/extract-ai-api.ps1
```

La salida confirma `services/ai-api/`, `contracts/` y estado del candidato
hermano. Si el destino no existe, lo reporta; no lo crea.

Extraccion, solo tras autorizacion explicita:

```powershell
rtk pwsh -NoProfile -File scripts/extract-ai-api.ps1 `
  -Destination 'C:\ruta\autorizada\demo-decoracion-api' `
  -Authorized -Extract -WhatIf

rtk pwsh -NoProfile -File scripts/extract-ai-api.ps1 `
  -Destination 'C:\ruta\autorizada\demo-decoracion-api' `
  -Authorized -Extract
```

El destino debe ser externo y vacio. Layout resultante:

```text
demo-decoracion-api/
|-- services/ai-api/
|-- migrations/016_operational_idempotency.sql
|-- contracts/
|-- .gitignore
`-- extraction-manifest.json
```

No se copian `.venv`, caches, `egg-info`, secretos, `DATABASE_URL` ni claves. El manifiesto
registra commit de origen o `working-tree`; no convierte cambios sucios en una
version publicable.

## Contrato Python local

Arranque, sin proveedor pago, cuando el runtime local este disponible:

```powershell
rtk uv run --directory services/ai-api --extra test uvicorn app.main:app `
  --host 127.0.0.1 --port 8000
```

En otra terminal, usar solo un secreto local ya provisionado; el script no lo
genera:

```powershell
rtk pwsh -NoProfile -File scripts/contract-e2e-ai-api.ps1 `
  -BaseUrl 'http://127.0.0.1:8000'
```

Con FastAPI en `8000` y Next en `3100`, con `PYTHON_BACKEND_ENABLED=true`,
`PYTHON_BACKEND_URL` e `INTERNAL_HMAC_SECRET` locales:

```powershell
rtk pwsh -NoProfile -File scripts/contract-e2e-next-python.ps1 `
  -NextBaseUrl 'http://127.0.0.1:3100'
```

La prueba HTTP local adicional demuestra seleccion Next, flag Python, kill
switch y replay/conflict en PostgreSQL Docker. El test TS mock cubre HMAC, IDs,
nonce por intento, errores, timeout y cancelacion. Esto no sustituye staging,
secreto provisionado, observabilidad desplegada ni cancelacion fisica de un
proveedor.

## Limites y observabilidad

Antes de activar cualquier endpoint deben conservarse:

- `PYTHON_BACKEND_ENABLED` apagado por defecto.
- `PYTHON_BACKEND_KILL_SWITCH` con precedencia absoluta.
- IDs propagados, HMAC con metodo, ruta, timestamp, nonce, hash y scopes.
- Nonce atomico de un solo uso en store durable.
- `idempotency_key` con hash estable, estados `new`, `in_flight`, `replay` y
  `conflict`, y respuesta terminal guardada.
- Errores publicos estables, sin stack traces, secretos ni payload completo.

Limites minimos de staging: body 64 KiB en frontera sintetica, deadline
absoluto, timeout de cliente/servidor, concurrencia, tamano de respuesta y
cancelacion propagada. Cancelacion local no prueba cancelacion confirmada de un
proveedor.

Health/readiness separan proceso vivo (`/healthz`) de configuracion lista
(`/readyz`), secreto valido y store durable. Logs pueden llevar IDs, endpoint,
resultado de seleccion, latencia y codigo; nunca secreto, firma, body completo,
conversacion o imagen. Metricas minimas: solicitudes por backend, latencia,
timeout, cancelacion, auth rechazada, replay/conflict, 5xx y readiness.

## SQL operacional

Se aplico `migrations/016_operational_idempotency.sql` dos veces contra el
contenedor Docker local desechable `demo-decoracion-stage4-pg`, usando
`ON_ERROR_STOP`. La segunda ejecucion fue idempotente y verifico las tablas
`operational_idempotency` y `operational_request_nonces`. No se uso la URL
Neon de `.env.local`, ni se aplico SQL remoto.

El repo backend usa `PostgresOperationalStore` cuando existe `DATABASE_URL` y
mantiene el store en memoria solo en desarrollo/test sin DSN. Produccion queda
readiness-fail-closed hasta tener DSN, migracion y pool validos.

## Matriz de salida

| Gate | Estado | Evidencia o siguiente paso |
|---|---|---|
| Fuente FastAPI y 33 modelos | PASS local | `services/ai-api`, `uv.lock`, pytest |
| Destino `demo-decoracion-api` | PASS local | `workspace/demo-decoracion-api`, Git separado |
| Extraccion reproducible | PASS local | 14 service + 44 contracts + 1 migration |
| Adaptador Next reversible | PASS local | Test mock + HTTP local; falta staging/remoto |
| Secreto HMAC | PENDIENTE EXTERNO | Provisionar y rotar en gestor autorizado |
| SQL PostgreSQL | PASS local | Docker desechable; remoto no ejecutado |
| Contrato Python interno | PASS local | Repo extraido + store durable Docker |
| Next default / flag / kill switch | PASS HTTP local | Next, Python y kill switch comprobados |
| Observabilidad desplegada | PENDIENTE EXTERNO | Instrumentar y verificar staging |
| Rollback | PASS local | Flags conservan Next; kill switch gana |

## Siguiente paso exacto

Etapa 5: obtener autorización para runtime, secreto HMAC y PostgreSQL de
staging; publicar `workspace/demo-decoracion-api`, configurar observabilidad y
repetir el mismo contrato con `PYTHON_BACKEND_ENABLED` apagado por defecto.
Mantener `PYTHON_BACKEND_KILL_SWITCH=true` disponible durante la observación.

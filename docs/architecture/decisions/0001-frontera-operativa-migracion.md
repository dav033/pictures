# ADR 0001: frontera operativa durante la migración

## Problema

La migración a Python necesita transportar identidad, deadline, autenticación,
idempotencia y selección de backend sin duplicar las reglas comerciales de
Next.

## Decisión

La fachada Next conserva la autoridad y expone contratos versionados. El
contexto `operational.v1` lleva request ID, correlation ID, deadline, hash del
body, scopes e idempotency key. La autenticación futura entre servicios usa
HMAC-SHA256 con timestamp, nonce, método, ruta, hash y scopes. Python solo se
selecciona cuando `PYTHON_BACKEND_ENABLED` está activo y el kill switch está
apagado; el default es Next.

La política de idempotencia distingue operación nueva, replay y conflicto, pero
no se simula persistencia con memoria local. El store durable se implementará
antes de mover efectos duplicables.

## Alternativas descartadas

- Enrutar tráfico a Python por defecto: no hay rollback ni store durable.
- Confiar solo en headers sin firma: permite suplantar identidad entre servicios.
- Mantener dos reglas comerciales: crea divergencia de precios, stock y
  procedencia.

## Consecuencias

- El contrato puede generar modelos Pydantic sin cambiar la fachada actual.
- El corte actual es reversible por flags y kill switch.
- El aborto físico de queries PostgreSQL y el replay durable quedan como
  trabajo explícito de Etapa 3.

## Rollback

Apagar `PYTHON_BACKEND_ENABLED` o activar
`PYTHON_BACKEND_KILL_SWITCH`; ambos seleccionan Next. No se elimina la ruta
legacy hasta verificar compatibilidad y rollback del servicio Python.

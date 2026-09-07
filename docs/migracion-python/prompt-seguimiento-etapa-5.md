# Prompt de seguimiento — Etapa 5

Continúa la migración Python de `demo-decoracion` desde el estado final de la
Etapa 4. La Etapa 4 quedó cerrada en entorno local reproducible. La Etapa 5
debe llevar la integración a staging autorizado, sin romper Next ni afirmar
tráfico remoto que no haya sido ejecutado.

## Plan vigente y documentos rectores

Antes de actuar, leer y respetar estos documentos, en este orden:

1. [`docs/migracion-python/00-prompt-continuacion.md`](00-prompt-continuacion.md):
   plan maestro original de 10 etapas y decisiones iniciales de estructura.
   Sus instrucciones antiguas sobre herramientas o rutas no sustituyen las
   reglas actuales de `AGENTS.md` ni el estado verificado abajo.
2. [`docs/migracion-python/progreso.md`](progreso.md): estado global más
   reciente y checks acumulados.
3. [`docs/migracion-python/04-etapa-4-preparacion-reversible.md`](04-etapa-4-preparacion-reversible.md):
   plan técnico vigente, gates, rollback y criterio de salida de Etapa 4.
4. [`docs/migracion-python/prompt-seguimiento-etapa-4.md`](prompt-seguimiento-etapa-4.md):
   contexto operativo de la etapa anterior.

Si aparece otro plan Markdown más reciente en el workspace, localizarlo con
`rg --files`, comparar fechas y documentar cuál se tomó como rector antes de
modificar código.

## Ubicaciones

Repo Next actual:

`C:\Users\davidt\Downloads\demo-decoracion`

Workspace agrupador:

`C:\Users\davidt\Downloads\workspace`

Enlace reversible al repo Next:

`C:\Users\davidt\Downloads\workspace\demo-decoracion`

Repo backend Python separado:

`C:\Users\davidt\Downloads\workspace\demo-decoracion-api`

Servicio Python histórico dentro del repo Next:

`C:\Users\davidt\Downloads\demo-decoracion\services\ai-api`

Contratos fuente:

`C:\Users\davidt\Downloads\demo-decoracion\contracts`

Contratos extraídos:

`C:\Users\davidt\Downloads\workspace\demo-decoracion-api\contracts`

Migración fuente:

`C:\Users\davidt\Downloads\demo-decoracion\scripts\migrations\016_operational_idempotency.sql`

Migración del backend:

`C:\Users\davidt\Downloads\workspace\demo-decoracion-api\migrations\016_operational_idempotency.sql`

## Estado final de la Etapa 4

Se implementó:

- Adaptador Next → Python con HMAC `operational.v1`, request ID,
  correlation ID, hash SHA-256, scopes, nonce, idempotencia, timeout,
  cancelación y errores estables.
- Ruta Next `/api/internal/ai/echo`.
- FastAPI con `/healthz`, `/readyz`, límites, deadlines, timeout,
  cancelación, logs redactados, métricas y errores estables.
- Store en memoria para desarrollo/test.
- `PostgresOperationalStore` asíncrono con `asyncpg`, pool acotado y
  readiness fail-closed en producción.
- Dockerfile no-root para el backend.
- Repo backend separado con Git, `.gitignore`, contratos y manifiesto de
  extracción.
- Scripts:
  - `scripts/extract-ai-api.ps1`
  - `scripts/contract-e2e-ai-api.ps1`
  - `scripts/contract-e2e-next-python.ps1`
  - `scripts/contract-e2e-next-flag.ps1`

## Evidencia local reproducible

Se creó un PostgreSQL Docker efímero llamado `demo-decoracion-stage4-pg`.

La migración se ejecutó dos veces con `ON_ERROR_STOP` y fue idempotente. Se
verificaron las tablas:

- `operational_idempotency`;
- `operational_request_nonces`.

La URL existente en `.env.local` apunta a Neon remoto. No se utilizó ni se
modificó. Tampoco se tocaron los contenedores existentes del usuario:

- `demo-decoracion-postgres-1`;
- `maros-postgres-local`.

E2E real local contra el repo backend separado y PostgreSQL durable:

```text
/readyz = 200
first = 200
replay = 200
conflict = 409
timeout = 504
```

También se comprobó:

```text
Next por defecto                  => backend=next
Python con PYTHON_BACKEND_ENABLED => backend=python
Kill switch activo                => backend=next
```

Checks finales del backend:

```text
26 tests PASS
ruff PASS
ruff format PASS
mypy PASS
uv lock --check PASS
generated_models.py sin drift
```

Checks Next:

```text
TypeScript PASS
adaptador Python PASS
build PASS
lint PASS, con warnings heredados y sin errores
```

## Dificultades resueltas

1. `demo-decoracion-api` no existía.

   Se creó en `workspace/demo-decoracion-api` con extracción autorizada.

2. El repo Next tenía cambios sucios.

   No se movió ni duplicó. Se creó un Junction reversible en
   `workspace/demo-decoracion`.

3. La extracción copiaba `decoracion_ai_api.egg-info`.

   Se corrigió `extract-ai-api.ps1` para excluir `egg-info`, `.venv`, caches,
   `.git`, bases SQLite y archivos de claves.

4. La extracción no incluía migración ni `.gitignore`.

   Ahora el repo backend incluye `migrations/016_operational_idempotency.sql`,
   `.gitignore` y `extraction-manifest.json`.

5. El replay usaba inicialmente un hash afectado por IDs variables.

   Se cambió al hash estable de la operación y se aceptan los IDs originales
   persistidos en un replay.

6. Readiness aceptaba secretos HMAC demasiado cortos.

   Se fijó un mínimo de 32 bytes y fallo cerrado.

7. El primer E2E no tenía `APP_PASSWORD` disponible en el proceso de prueba.

   Se corrigió el lanzamiento del script para inyectar la variable solo en el
   entorno local.

8. Un intento con `curl` falló por escaping de JSON en PowerShell.

   Se creó `contract-e2e-next-flag.ps1` con `HttpClient` nativo y cookies.

9. Los PostgreSQL existentes no se trataron como desechables.

   Se usó un contenedor efímero separado y se eliminó al finalizar.

10. El backend inicial usaba store en memoria.

    Un subagente agregó `PostgresOperationalStore`, tests async con fake,
    `asyncpg` fijado y configuración por `DATABASE_URL`.

## Decisiones arquitectónicas vigentes

- Next continúa siendo fachada, autoridad comercial y rollback inmediato.
- Python solo maneja transporte, validación y endpoints migrados.
- Python no decide catálogo, disponibilidad, precios, cantidades, identidad,
  aprobación, materiales ni cotización.
- `PYTHON_BACKEND_ENABLED` permanece apagado por defecto.
- `PYTHON_BACKEND_KILL_SWITCH` siempre gana.
- No hay fallback automático después de seleccionar Python, para evitar efectos
  duplicados.
- Sin `DATABASE_URL`, desarrollo/test puede usar store en memoria.
- En producción `/readyz` falla cerrado sin DSN, migración, pool o secreto HMAC
  válido.
- No se imprimen secretos, DSN completos, firmas ni payloads completos.
- No usar Neon remoto sin autorización explícita.
- No eliminar rutas legacy.

## Objetivo de la Etapa 5

### 1. Confirmar staging

Obtener y documentar autorización para:

- runtime del backend;
- destino de despliegue;
- PostgreSQL de staging;
- gestor de secretos;
- observabilidad;
- permisos de red entre Next y Python.

No inventar destinos ni credenciales.

### 2. Provisionar configuración

Configurar mediante el gestor autorizado:

- `APP_ENV=production`;
- `DATABASE_URL` de staging;
- `INTERNAL_HMAC_SECRET` de mínimo 32 bytes;
- scopes requeridos;
- timeout y límites;
- pool PostgreSQL.

No leer ni reutilizar automáticamente la URL Neon de `.env.local`.

### 3. Aplicar y verificar SQL

Aplicar explícitamente:

`migrations/016_operational_idempotency.sql`

Usar `ON_ERROR_STOP`, identificar la base antes de ejecutar y comprobar:

- tablas;
- índices;
- constraints;
- permisos mínimos;
- idempotencia de una segunda ejecución.

### 4. Desplegar el backend

Usar el Dockerfile del repo backend. Verificar:

- usuario no-root;
- `/healthz`;
- `/readyz`;
- logs sin secretos;
- métricas mínimas;
- límites de body;
- deadlines;
- timeout;
- cancelación;
- pool y conexiones PostgreSQL.

### 5. Validar contrato en staging

Probar sin proveedores pagos:

- llamada válida;
- HMAC inválido;
- scope inválido;
- nonce repetido;
- replay;
- conflicto de idempotencia;
- operación in-flight;
- timeout;
- cancelación;
- body demasiado grande;
- readiness inválido.

### 6. Ejecutar canary reversible

- Mantener Next como default.
- Activar Python solo para el endpoint aprobado.
- Empezar con porcentaje pequeño o tráfico controlado.
- Vigilar latencia, errores, replay, conflictos, timeouts y readiness.
- No activar reglas comerciales nuevas.

### 7. Probar rollback

Comprobar en staging que cualquiera de estas acciones devuelve el tráfico a
Next:

```text
PYTHON_BACKEND_ENABLED=false
```

o:

```text
PYTHON_BACKEND_KILL_SWITCH=true
```

El kill switch debe ganar siempre.

## Reglas de trabajo

- Inspeccionar primero:

  ```powershell
  rtk git status --short
  ```

  `AGENTS.md`, `CLAUDE.md`, `docs/migracion-python/`, `contracts/` y
  `package.json`.

- Preservar todos los cambios sucios.
- No usar `git reset`, `git checkout --` ni limpiezas destructivas.
- Usar `apply_patch` para editar.
- Usar `rtk` en comandos.
- Usar subagentes nativos con `gpt-5.6-luna` y razonamiento `xhigh`, con scopes
  de escritura separados.
- No usar OpenCode.
- No inventar secretos, credenciales, destinos ni autorizaciones.
- No afirmar tráfico remoto si no fue ejecutado.
- Mantener Next como rollback inmediato.

## Criterio de salida

Cerrar Etapa 5 únicamente si existe evidencia reproducible de staging con:

- backend desplegado;
- PostgreSQL de staging migrado;
- secreto HMAC provisionado correctamente;
- contrato Next → Python validado;
- observabilidad verificada;
- canary controlado;
- rollback comprobado.

Si falta autorización, secreto, runtime, base o evidencia de staging, dejar la
Etapa 5 en progreso y documentar el siguiente paso exacto. No afirmar tráfico
remoto ni producción.

## Entrega requerida

Informar:

- archivos modificados;
- subagentes usados;
- decisiones;
- comandos ejecutados;
- resultados de checks;
- destino y configuración de staging sin exponer secretos;
- evidencia de SQL;
- evidencia E2E;
- evidencia de rollback;
- riesgos;
- bloqueos externos;
- siguiente paso exacto.

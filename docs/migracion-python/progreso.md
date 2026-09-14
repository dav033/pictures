# Progreso migración Python

Última actualización: 2026-09-14

Estado global: **paridad comercial y cutover local del resolutor Python verificados; activación remota y controles E2/E3 pendientes**

> **Plan rector vigente:** [`PLAN-MAESTRO-V2.md`](PLAN-MAESTRO-V2.md).
>
> **Dos numeraciones, no las mezcles.** Las **Etapas 1 a 4** son las del plan
> viejo que ya se ejecutaron y que documentan los archivos `01-` a `04-` de
> esta carpeta. Las **Fases 1 a 10** son el trabajo nuevo que define el plan
> maestro v2: la Fase 1 es el primer trabajo nuevo, no una repetición.
>
> La documentación histórica eliminada no forma parte de la ruta operativa
> actual; este archivo solo enlaza a documentos presentes en el checkout.
>
> **El plan pasó de 6 a 10 fases** al revisar qué faltaba para que la
> implementación quedara cubierta. Las cuatro nuevas son CI y gates (Fase 2),
> seguridad y secretos (4), resiliencia y degradación (5), y carga y
> concurrencia (7). El mapa de la renumeración está en el capítulo 0 del plan.
> El capítulo 13 recoge las auditorías previas por fase y las reglas de
> delegación.
>
> Estado local: contratos, degradación RAG, paridad, B1-B3, lint, build, typecheck
> y calidad Python pasan con el PostgreSQL loopback. La suite de webhooks y las
> evaluaciones RAG que dependen de un fixture/catalogo coherente siguen fuera del
> cierre de esta capacidad.
>
> Los controles Happie se mantienen bajo prueba local; no se afirma estado
> remoto ni canario desplegado.
>
> RAG es la única ruta comercial. Si falla, el chat devuelve
> `RAG_UNAVAILABLE` y no cambia a un catálogo SQLite.

La preparación de Etapa 4 queda documentada en
[`04-etapa-4-preparacion-reversible.md`](04-etapa-4-preparacion-reversible.md).
El repo backend ya existe en `workspace/demo-decoracion-api` y el Next conserva
su ubicación original mediante un enlace hermano reversible. Secretos reales,
despliegue, observabilidad y tráfico remoto siguen bloqueados por gates
externos; no se inventan.

## Completado

- Auditorías A-D y síntesis formal de ownership, contratos, riesgos y rollback.
- Baseline local y correcciones previas de RAG, LoRA, plan y Happie.
- Contratos Zod/JSON Schema para chat, SSE, transcript, herramientas, errores,
  selección de catálogo, plan resuelto, materiales, cotización, blueprint,
  escena, LoRA, vocabulario y Happie.
- Fixtures y pruebas de aceptación/rechazo, incluyendo invariantes numéricas,
  respuesta Happie, HMAC, idempotencia y kill switch.
- `/api/chat` con IDs, SSE versionado, terminal único, payload limitado,
  deadline absoluto, cancelación y errores públicos estables.
- Cancelación propagada a `agente-core`, Gemini y reintentos; la UI puede
  cancelar el turno y valida cada evento SSE.
- Auth directa en rutas Happie internas y validación runtime del catálogo remoto.
- Base FastAPI local en `services/ai-api/`, sin proveedores ni autoridad comercial.
- Base FastAPI Stage 4 ampliada con store local de nonce/idempotencia,
  limites, deadline, timeout, cancelacion, metricas minimas, Dockerfile y
  readiness fail-closed en produccion.
- Adaptador Next reversible para `/api/internal/ai/echo`: Next por defecto,
  Python solo con flag, kill switch dominante, HMAC, IDs, hash, scopes, nonce
  nuevo por intento y errores estables. Evidencia local mock; sin trafico remoto.
- HTTP local comprobado con Next y FastAPI: Python 200, replay 200 con header,
  conflicto 409 y deadline 504 usando fixture efimero; no equivale a staging.
- `rtk pwsh -NoProfile -File scripts/contract-e2e-next-python.ps1`: PASS en
  procesos locales; el script no genera ni persiste secretos.
- Modelos Pydantic generados determinísticamente desde los 33 JSON Schema, con
  validación Draft 7 en runtime y `uv.lock`.
- Store PostgreSQL durable de idempotencia/replay y nonce, con TTL, respuesta
  guardada, reserva atómica, pool asyncpg y pruebas sin credenciales.
- Migración Python `001_operational_schema.sql` aplicada en la base operacional;
  tablas verificadas e integración Next → Python comprobada con ese store
  durable. La copia antigua del repo Next fue retirada.
- Cutover local comprobado: Next por defecto, Python con flag y kill switch
  forzando Next.
- Rollback conserva Next como default; kill switch sigue ganando siempre.
- Fase 8.2 desplegada en EC2: imagen Python con modelo precargado, readiness y
  rerank autenticado verificados; `RAG_RERANK_ENABLED` permanece apagado.
- Fase 8.3 implementada en Python: el job offline de embeddings documentales
  usa lotes, checkpoint, lease persistente, provenance y telemetría; la
  migración 023 ya está aplicada en Neon y la corrida encontró cero pendientes,
  por lo que no fue necesario llamar a Gemini.
- Fase 8.4 desplegada en EC2: endpoint Python autenticado para `RETRIEVAL_QUERY`,
  adaptador HMAC, flag independiente y fallback a ramas léxicas. La llamada real
  devolvió `200`, modelo `gemini-embedding-2`, 768 dimensiones y un intento.
- El canario Next autenticado ejecutó una conversación real con eventos de
  herramienta que incluyeron `buscar_catalogo_rag`; los flags están activos y el
  kill switch permanece apagado.
- Se conservaron los contenedores de rollback
  `demo-decoracion-rollback-f2cadd3` y `demo-decoracion-ai-api-rollback-f2cadd3`.
- Fase 9.0 cerrada sin coste adicional: la identidad cruzada de los manifiestos
  históricos queda excluida de evidencia reutilizable y el runtime exige resolver
  el artefacto completo desde el registro LoRA aprobado. No se reescribieron los
  manifiestos históricos.
- Fase 9.1 parcialmente endurecida en local, sin llamadas pagadas: se validan
  imágenes de entrada, se limita `cargarFoto` a hosts/MIME/tamaño permitidos y
  se propagan cancelación y deadlines totales a Gemini/fal.ai. Quedan pendientes
  la idempotencia específica de fal.ai, el presupuesto de gasto y el límite
  agregado de una ruta con QA/retry.

## Decisiones vigentes

1. Gemini es el proveedor real; OpenAI/opencode no forma parte del runtime.
2. Next mantiene las fachadas y autoridades durante la transición.
3. PostgreSQL mantiene autoridad comercial de catálogo/RAG.
4. Python entra mediante contratos y adaptadores explícitos, nunca copiando
   handlers ni duplicando reglas comerciales.
5. `PYTHON_BACKEND_ENABLED` y `PYTHON_BACKEND_KILL_SWITCH` seleccionan backend;
   por defecto se conserva Next y el kill switch siempre gana.
6. Plan 1.1, SceneSpec V2 y catálogo V3 están deferred.

## Límites para siguiente etapa

- El servicio Python y el tráfico remoto están activos en canario; falta observar
  una ventana operativa suficiente antes de ampliar el rollout.
- La siguiente fase es 9.1: seguridad de gasto de generación. No se ejecutan
  llamadas fal.ai hasta cerrar sus gates de idempotencia, deadline y presupuesto.
- Las migraciones SQL hasta `023_embedding_provenance.sql` están aplicadas y
  verificadas en Neon; falta probar recuperación ante fallos reales de la base.
- Las consultas PostgreSQL ya reciben la frontera de cancelación, pero el
  aborto de una query en curso requiere una revisión específica del driver y
  del pool antes de prometer cancelación física.
- No se certificaron rotaciones de secretos. La llamada real de embeddings y el
  flujo Next → Python ya fueron verificados con la clave provisionada y la
  autorización de coste disponible.

## Verificación de cierre

- `npm run contracts:test`: PASS.
- `npm run contracts:test:domain`: PASS.
- `npm run contracts:test:operational`: PASS.
- `npm run contracts:test:cancel`: PASS.
- `npm run contracts:check`: PASS.
- `npm run build --workspaces --if-present`: PASS.
- `npx tsc --noEmit`: PASS.
- `npm run lint`: PASS; quedan 28 warnings heredados, sin errores.
- `npm run build`: PASS; quedan warnings de tracing de rutas externas ya
  existentes, sin error de compilación.
- `python services/ai-api/scripts/generate_models.py --check`: PASS.
- `uv lock --check --system-certs` en `services/ai-api`: PASS.
- `uv run --extra test --extra quality --system-certs python -m pytest`: PASS, 48
  tests; 3 skips esperados y un warning heredado de `starlette`/AnyIO.
- `npx tsx scripts/test-idempotency-store.ts`: PASS.
- `npx eslint src/lib/ia/idempotencia/store.ts scripts/test-idempotency-store.ts`:
  PASS.
- `npx tsx scripts/test-python-adapter.ts`: PASS.
- `npx eslint src/lib/ia/python-adapter.ts src/app/api/internal/ai/echo/route.ts scripts/test-python-adapter.ts`: PASS.
- `uv run --extra quality --system-certs ruff check app scripts tests`: PASS.
- `uv run --extra quality --system-certs ruff format --check app scripts tests`: PASS.
- `uv run --extra quality --system-certs mypy app scripts`: PASS.
- `uv lock --check --system-certs`: PASS; `uvicorn` runtime fijado.

## Estado de salida de Etapa 4

Etapa 4 queda cerrada con repo backend separado, store PostgreSQL durable en
Docker, contrato HTTP Next → Python local, replay/conflicto/timeout y rollback
por flags. Tráfico remoto, secreto provisionado, observabilidad desplegada y
conexión de staging quedan para la etapa posterior; no se inventan credenciales
ni se activan por defecto.

## Resolución comercial del plan en Python — integración (2026-09-14)

El endpoint `POST /internal/v1/plan/resolve` ya existía y estaba probado, pero
`llamarPythonPlanResolution()` no lo usaba ningún consumidor: el chat, la
generación y la edición seguían resolviendo y cotizando en TypeScript. El
bloqueo real no era el transporte sino la **procedencia**: el resolutor Python
necesita el `catalog_snapshot_id` publicado y la allowlist *same-turn*, y ninguno
de los dos puede leerse del cuerpo de la petición.

### Decisión

[ADR 0006](../architecture/decisions/0006-procedencia-firmada-del-plan.md): la
procedencia viaja **firmada dentro del token de aprobación** (payload `v: 2`) con
`backend`, `catalogSnapshotId` y `allowlist`. Un plan se re-resuelve siempre con
el backend que lo produjo; si ese backend ya no está disponible, la petición
falla en cerrado pidiendo volver a solicitar la propuesta. No hay fallback
implícito a TypeScript.

### Implementado

- `src/lib/plan/aprobacion.ts`: token de plan v2 con procedencia firmada.
  `verificarTokenAprobacion` mantiene su firma y su semántica (exige el hash
  resuelto en servidor); `abrirContextoPlan` lee la procedencia antes de tener
  ese hash y no liga el hash a propósito. Los tokens v1 en vuelo siguen siendo
  válidos y se leen como `backend: "next"`.
- `src/lib/plan/resolver-backend.ts`: único dueño de la decisión "qué backend
  resuelve este plan" y de su ejecución. El camino Python nunca vuelve a ejecutar
  `estimateFromPlan` ni `cotizarPlan`: la respuesta ya trae `material_estimate` y
  `quote`.
- `src/lib/plan/python-mapper.ts`: mapeo de transporte puro Python → formas de la
  UI. No recalcula ningún valor comercial; `unidades_necesarias` y
  `additional_package_for_waste`, que `quote.v1` no transporta, se toman de la
  compra consolidada que viaja en la misma respuesta. Un vocabulario de `tipo`,
  `ubicacion` o `rol_escena` desconocido es una respuesta rota, no algo que se
  coercione en silencio.
- `src/lib/ia/python-adapter.ts`: `PythonAdapterError` expone `domainCode` con el
  código de dominio de Python. Antes, `catalog_snapshot_not_found` e
  `invalid_plan` colapsaban ambos en `PYTHON_INVALID_REQUEST` y el llamador no
  podía distinguirlos.
- `src/lib/ia/registro-herramientas.ts` (`confirmar_plan_decoracion`): resuelve
  por el backend seleccionado, emite el token con procedencia y devuelve la
  cotización del backend. Sin snapshot del turno responde
  `BACKEND_NO_DISPONIBLE` pidiéndole al modelo que busque primero en el catálogo;
  un fallo del backend se audita y se le dice al modelo que no invente precios ni
  confirme el plan. Todas las validaciones previas (restricciones, cardinalidad,
  cobertura de referencia, estimación física, `SIN_COBERTURA`,
  `PRESUPUESTO_EXCEDIDO`) siguen intactas y en el mismo orden.
- `src/app/api/generate/route.ts` y `src/app/api/plan-editar/route.ts`: abren la
  procedencia firmada, re-resuelven con el backend que produjo el plan y
  conservan la puerta de aprobación contra el hash resuelto. Los errores del
  backend Python se traducen a códigos estables en vez de a un 500 genérico.

### Paridad: la puerta de activación

`contracts/domain/v1/golden/plan-resolution/` contiene 9 vectores dorados con
catálogo, allowlist y plan, y dos expectativas generadas: la de TypeScript y la
de Python. Ninguna de las dos suites necesita base de datos ni red.

- `npm run plan:test-paridad` bloquea regresiones del resolutor TypeScript (entra
  en `npm run plan:test`).
- `pytest tests/test_plan_parity.py` bloquea regresiones del resolutor Python.
- `npm run plan:test-paridad-python` compara los dos backends pasando la
  respuesta Python por el mapper de producción: **9/9 vectores pasan**.

Divergencia/bug conocido que permanece fuera de la corrección de esta sesión:

1. En el vector `09-a5-linea-no-geometrica`, TypeScript aplica el ahorro de
   merma solo geométrico también a una línea no geométrica (`telón`). Python
   reproduce la autoridad TypeScript para mantener la paridad; debe corregirse
   primero en TypeScript con una decisión de dominio explícita.

Fuera de la comparación, con razón documentada y comprobados aparte: `plan_hash`
(el ADR 0006 lo define por backend) y `merma_log` (texto para una persona).

### Fixtures de dominio

`quote-ok.json`, `plan-resuelto-ok.json` y `material-estimate-ok.json` describían
el mismo escenario con mermas distintas (12,5% frente al valor operativo
`MERMA = 0.08`). Las tres quedan alineadas a 8% con la aritmética real del
resolutor, y la comprobación de consistencia del adaptador vuelve a ser
significativa.

### Verificación ejecutada (2026-09-14)

| Comando | Resultado |
| --- | --- |
| `npm run contracts:check` | PASS |
| `npm run contracts:test` | PASS |
| `npm run contracts:test:domain` | PASS |
| `npm run contracts:test:operational` | PASS |
| `npm run contracts:test:python-adapter` | PASS |
| `npm run plan:test` | PASS (incluye paridad, contexto y rollback Python) |
| `npm run lint` | PASS; 27 warnings heredados, 0 errores |
| `npm run build --workspaces --if-present` | PASS |
| `npx tsc --noEmit` | PASS |
| `pytest` (services/ai-api) | 89 passed, 3 skipped; warning heredado de AnyIO |
| `ruff check` / `ruff format --check` / `mypy` | PASS |
| `npm run plan:test-paridad-python` | PASS: 9/9 vectores |

El informe detallado de esta verificación está en
[`REPORTE-CUTOVER-PYTHON-2026-09-14.md`](../../REPORTE-CUTOVER-PYTHON-2026-09-14.md).

### Pendiente

El plan ejecutable con criterios de aceptación por tarea está en
[`PLAN-PARIDAD-Y-ACTIVACION.md`](PLAN-PARIDAD-Y-ACTIVACION.md).

- Decidir E2 (recomendaciones del editor) y E3 (asociación tipada
  producto-variante) antes de declarar el cutover comercial completo.
- El flag `PYTHON_BACKEND_ENABLED=true` solo se usó temporalmente en local; no se
  tocó ningún entorno remoto ni Neon. Fuera de esas pruebas, el kill switch
  fuerza Next.
- Sigue abierto el backlog fuera de esta capacidad: arnés `ia:bench` (1.4),
  telemetría durable de coste (1.5), panel de consumo (3.12), idempotencia de
  proveedores pagados (5.4/5.5, 9.1), presupuesto de latencia y backpressure
  (7.2) y el cutover selectivo con runbook final (Fase 10).

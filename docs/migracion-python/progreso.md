# Progreso migración Python

Última actualización: 2026-09-10

Estado global: **Etapa 4 local cerrada; Fases 8.2 y 8.3 implementadas; ejecución de embeddings 8.3 pendiente de autorización**

> **Plan rector vigente:** [`PLAN-MAESTRO-V2.md`](PLAN-MAESTRO-V2.md).
>
> **Dos numeraciones, no las mezcles.** Las **Etapas 1 a 4** son las del plan
> viejo que ya se ejecutaron y que documentan los archivos `01-` a `04-` de
> esta carpeta. Las **Fases 1 a 10** son el trabajo nuevo que define el plan
> maestro v2: la Fase 1 es el primer trabajo nuevo, no una repetición.
>
> La antigua quinta etapa (staging) pasa a ser la **Fase 6**; su contenido
> técnico en [`prompt-seguimiento-etapa-5.md`](prompt-seguimiento-etapa-5.md)
> sigue siendo válido y se adopta tal cual.
>
> **El plan pasó de 6 a 10 fases** al revisar qué faltaba para que la
> implementación quedara cubierta. Las cuatro nuevas son CI y gates (Fase 2),
> seguridad y secretos (4), resiliencia y degradación (5), y carga y
> concurrencia (7). El mapa de la renumeración está en el capítulo 0 del plan.
> El capítulo 13 recoge las auditorías previas por fase y las reglas de
> delegación.
>
> Estado: **Fases 1.1, 1.2 y 1.3 hechas.** El trabajo de las Etapas 1-4 está
> commiteado en `migracion/python-etapas-1-4` (7 commits) y el runner de
> migraciones ya confirma destino, verifica checksums y toma advisory lock.
> Siguen pendientes la Fase 1.4 (arnés `ia:bench`) y la Fase 1.5 (telemetría
> con taxonomía de flujo y capacidad).
>
> `main` aportó los controles de los webhooks Happie —idempotencia durable,
> rate limit, límite de body, deadline y cancelación— ya mezclados en la rama de
> trabajo. Eso cierra el riesgo "estado webhook no durable ni deduplicado" que
> la Etapa 1 dejó abierto, y abre dos puntos nuevos: las rutas de control
> responden fuera del contrato Happie (capítulo 4.7, entra como Fase 3.13) y hay
> un tercer mecanismo de idempotencia en el repo (capítulo 10.7).
>
> Los planes borrados del repositorio que seguían referenciados por comentarios
> de código vivo están recuperados en
> [`docs/planes-recuperados/`](../planes-recuperados/).

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
- Migración `020_operational_idempotency.sql` aplicada dos veces en un
  PostgreSQL Docker desechable local; tablas verificadas e integración Next →
  Python comprobada con ese store durable.
- Cutover local comprobado: Next por defecto, Python con flag y kill switch
  forzando Next.
- Rollback conserva Next como default; kill switch sigue ganando siempre.
- Fase 8.2 desplegada en EC2: imagen Python con modelo precargado, readiness y
  rerank autenticado verificados; `RAG_RERANK_ENABLED` permanece apagado.
- Fase 8.3 implementada en Python: el job offline de embeddings documentales
  usa lotes, checkpoint, lease persistente, provenance y telemetría; la
  migración 023 ya está aplicada en Neon y la corrida encontró cero pendientes,
  por lo que no fue necesario llamar a Gemini.
- Fase 8.4 implementada localmente: endpoint Python autenticado para
  `RETRIEVAL_QUERY`, adaptador HMAC, flag independiente y fallback a ramas
  léxicas; permanece apagada y sin despliegue.

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

- El servicio Python ya está desplegado y el tráfico remoto está preparado,
  pero el cutover funcional queda pendiente de activar el flag y observarlo.
- Las migraciones SQL hasta `023_embedding_provenance.sql` están aplicadas y
  verificadas en Neon; falta probar recuperación ante fallos reales de la base.
- Las consultas PostgreSQL ya reciben la frontera de cancelación, pero el
  aborto de una query en curso requiere una revisión específica del driver y
  del pool antes de prometer cancelación física.
- No se certificaron rotaciones de secretos ni una llamada real de embeddings
  contra el proveedor. El canario online requiere imagen nueva, clave Python y
  autorización de coste.

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
- `uv run --extra test --extra quality --system-certs python -m pytest`: PASS, 26 tests; queda
  un warning heredado de `starlette`/AnyIO.
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

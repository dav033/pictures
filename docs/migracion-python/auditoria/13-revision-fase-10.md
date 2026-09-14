# Auditoria documental - Fase 10: cutover selectivo, runbook y entrega

**Corte documental:** 2026-09-10. **Plan rector:**
[`PLAN-MAESTRO-V2.md`](../PLAN-MAESTRO-V2.md), seccion Fase 10.

## Alcance y metodo

Se contrastaron las seis entregas de la Fase 10 con el plan rector, `progreso.md`,
las auditorias anteriores, los documentos de RAG y resiliencia, los runners de
migraciones, los flags, los adaptadores y los artefactos de release actuales.

Esta es una auditoria estatica y documental. No se ejecutaron despliegues,
migraciones, llamadas a Gemini, fal.ai, Shopify, Happia o Neon, cambios de
entorno, pruebas pagadas ni operaciones remotas. Las corridas descritas por
otros documentos no se vuelven a afirmar como evidencia nueva.

Al iniciar la revision ya habia cambios locales ajenos a este informe,
incluidos `PLAN-COMPOSICION-RICA-V001.md`, el plan maestro, `progreso.md`, la
decision ADR 0004, rutas de generacion y archivos IA, ademas de
`auditoria/11-revision-fase-7.md`, `resiliencia/runbook-operativo.md` y
`.mypy_cache/`. No se revirtieron ni modificaron.

## Veredicto resumido

| Entrega | Clasificacion | Veredicto documental |
|---|---|---|
| **10.1** | **Parcial** | La arquitectura de activacion por capacidad y rollback existe. Rerank tiene evidencia antes/despues; el estado remoto de embeddings de consulta contradice otros documentos y no hay decision de cutover permanente por capacidad. |
| **10.2** | **Parcial** | Existe un runbook transversal amplio y dos runbooks RAG, pero el runbook transversal se declara borrador y deja sin probar presupuesto, fallos de proveedores, restore remoto, reconciliacion y responsables. |
| **10.3** | **Pendiente** | Siguen presentes `scripts/_tmp-populate-v004-stats.ts` y `AQUI.md`, precisamente los artefactos que el plan exige promover o retirar. |
| **10.4** | **Parcial** | `progreso.md` nombra al plan maestro como rector, pero la consolidacion del estado, el manifiesto de release y el archivo de documentos competidores no esta cerrada. |
| **10.5** | **Parcial** | La telemetria de tokens cacheados existe y la medicion historica es `15/15` con cero tokens cacheados, pero no hay decision Fase 10 basada en trafico actual ni cache explicito implementado. |
| **10.6** | **Pendiente** | Los dos linajes y sus runners estan implementados, pero la decision escrita sobre contador global, coste de cambio y retiro de la copia operacional no esta cerrada. |

**Estado global:** la Fase 10 no puede marcarse cerrada. La base tecnica para
un cutover reversible existe, pero faltan decisiones de producto/operacion,
evidencia actual de trafico y la limpieza documental y de temporales.

## 1. Fase 10.1 - cutover por capacidad

### Evidencia favorable

- El plan prohibe migrar el handler de chat completo y exige activar capacidades
  individuales con evidencia antes/despues y rollback (`PLAN-MAESTRO-V2.md:811-816`).
- El selector conserva Next si Python esta apagado y da precedencia absoluta al
  kill switch (`src/lib/ia/contracts/operational-v1.ts:169-176`).
- El reranking esta implementado con `RAG_RERANK_ENABLED=false` por defecto,
  solo recibe candidatos ya autorizados y vuelve al orden local ante timeout o
  error (`docs/migracion-python/rag/rerank-python-fase8-2.md:8-25,91-106`). Su
  fixture registra mejora de MRR `0.500000 -> 1.000000` y nDCG@3
  `0.852494 -> 0.990835`
  (`docs/migracion-python/rag/rerank-python-fase8-2.md:58-73`).
- El contrato de embeddings de consulta exige cuatro condiciones de activacion
  y conserva las ramas lexicas si Python falla
  (`docs/migracion-python/rag/embeddings-query-python-fase8-4.md:17-32`).

### Reservas

1. No hay un cutover permanente documentado para ninguna capacidad. Los flags
   de backend y rerank quedan apagados por defecto; el canario historico de Fase
   6 termino restaurado a Next (`resiliencia/fase-6-progreso-2026-09-08.md:68-76`).
2. El estado de 8.4 es incompatible entre documentos: su ficha dice
   "implementado localmente" y "no desplegado"
   (`docs/migracion-python/rag/embeddings-query-python-fase8-4.md:1-4`),
   mientras el ADR dice canario remoto verificado y flags activos
   (`docs/architecture/decisions/0004-embeddings-consulta-python.md:1-4,49-67`).
   `progreso.md` tambien afirma canario activo (`progreso.md:5,90-95`). No se
   puede elegir una de esas versiones sin evidencia autorizada del entorno.
3. La evidencia de rerank es suficiente para calidad local y una llamada remota
   descrita, pero no demuestra que el trafico productivo actual lo use: el flag
   sigue apagado (`docs/migracion-python/rag/rerank-python-fase8-2.md:91-106`).

**Conclusion 10.1:** el mecanismo es seguro y reversible, pero la entrega de
cutover queda parcial hasta resolver el estado de 8.4 y documentar una ventana,
metricas antes/despues y criterio de ampliacion por capacidad.

## 2. Fase 10.2 - runbook operativo

### Evidencia favorable

- Existe `docs/migracion-python/resiliencia/runbook-operativo.md`, con reglas de
  no reintento de operaciones pagadas, autoridad comercial de PostgreSQL,
  contencion comun y procedimientos separados para Gemini, fal.ai, PostgreSQL,
  kill switch, migraciones y rollback (`runbook-operativo.md:10-49,51-245`).
- Tambien existen procedimientos especificos para regeneracion y rollback del
  RAG, con gates `PASS`/`SKIPPED_OPTIONAL` y bloqueo ante manifests o snapshots
  inconsistentes (`docs/operations/rag-regeneration-v2.md:1-3`,
  `docs/operations/rag-rollback-v2.md:1-19,108-119`).

### Reservas

- El runbook de Fase 10.2 se declara "borrador operativo, no cerrado"
  (`runbook-operativo.md:1-8`).
- El propio documento confirma que no hay arnes local especifico para fallos de
  Gemini/fal.ai, que fal.ai carece de idempotencia de POST, que no existe gate de
  presupuesto antes de llamar al proveedor y que el rollback/restore remoto no
  esta probado (`runbook-operativo.md:30-39,304-318`).
- No hay dueño humano asignado para secretos, infraestructura, proveedores o
  aprobacion de gasto (`runbook-operativo.md:279-289,304-315`).
- El runbook describe como cambiar el entorno, pero marca esas acciones como
  no ejecutadas. Por tanto sirve como procedimiento controlado, no como
  evidencia de que el procedimiento fue ensayado.

**Conclusion 10.2:** documentada parcialmente. Puede guiar contencion sin
autorizar operaciones, pero no satisface aun el criterio de runbook operativo
cerrado y ejecutable por un tercero.

## 3. Fase 10.3 - retirada de temporales

El plan nombra expresamente `scripts/_tmp-populate-v004-stats.ts` y `AQUI.md` y
exige promoverlos a herramientas documentadas o retirarlos
(`PLAN-MAESTRO-V2.md:817`). La condicion sigue sin cumplirse:

- `scripts/_tmp-populate-v004-stats.ts` conserva un `main()` ejecutable que lee
  un JSON historico y escribe directamente `lora_dataset_element_stats`, sin
  interfaz documentada de herramienta, preview o procedimiento de recuperacion
  (`scripts/_tmp-populate-v004-stats.ts:18-80`).
- `AQUI.md` sigue siendo una nota de cierre de la antigua Fase 2, no un estado
  rector actual (`AQUI.md:1-3,30-47`).
- `.mypy_cache/` sigue sin trackear en el worktree. No es uno de los dos
  artefactos nominados por el plan, pero confirma que la higiene del checkout
  tampoco esta cerrada.

No se eliminan ni se promueven estos archivos en una auditoria, y hacerlo ahora
violaria el alcance acordado de modificar solo este informe.

**Conclusion 10.3:** pendiente.

## 4. Fase 10.4 - un solo documento de estado

### Lo que ya esta definido

`progreso.md` identifica formalmente a `PLAN-MAESTRO-V2.md` como plan rector y
separa las Etapas 1-4 antiguas de las Fases 1-10 nuevas
(`docs/migracion-python/progreso.md:7-23`). El plan tambien prescribe consolidar
un rector, un runbook y los ADRs sin borrar el archivo historico
(`PLAN-MAESTRO-V2.md:811-820`).

### Lo que falta

1. La carpeta aun contiene prompts antiguos, planes recuperados, documentos de
   progreso, ADRs, auditorias y notas de estado con distintos cortes. No existe
   un inventario de archivado que indique que documento manda para cada tipo de
   decision.
2. `docs/migracion-python/resiliencia/runbook-operativo.md` es un borrador y
   `release-manifest.json` sigue describiendo `image-generation-v000`, backend
   `existing-demo`, evaluacion `not_started`, `rollback_target: null` y estado
   `development_only` (`release-manifest.json:1-11`). No puede funcionar como
   manifiesto operativo del cutover Python.
3. El manifiesto tiene informacion RAG detallada, pero no registra el estado de
   `PYTHON_BACKEND_ENABLED`, `PYTHON_BACKEND_KILL_SWITCH`, rerank, embeddings de
   consulta ni revision desplegada. Su `rollback_target` anidado de RAG no
   corrige la ausencia de un target de release general.

**Conclusion 10.4:** parcial. Hay un rector declarado, pero no una vista unica
y vigente del estado de release y rollback.

## 5. Fase 10.5 - decision del cache explicito de Gemini

### Evidencia disponible

- El plan registra el campo `cachedContentTokenCount` y una medicion historica
  de `15/15` llamadas con cero tokens cacheados
  (`PLAN-MAESTRO-V2.md:201-228`).
- El runtime conserva ese dato en la telemetria de Gemini: el tipo de respuesta
  declara `cachedContentTokenCount` y la llamada guarda `usageMetadata`
  (`src/lib/ia/gemini/imagen.ts:10-20,80-117`); `agente-core` tambien lo
  propaga a `ai_call_log` (`packages/agente-core/src/gemini/chat.ts:1-20`,
  `packages/agente-core/src/telemetria.ts:115-123`).
- La recomendacion vigente era aplazar el cache explicito por falta de trafico
  concurrente (`PLAN-MAESTRO-V2.md:849-855`).

### Brecha de cierre

- No hay una decision de Fase 10 que convierta las cifras en "implementar" o
  "no implementar" con un horizonte de trafico, ahorro estimado, coste de
  mantenimiento y criterio de reevaluacion.
- No aparece `caches.create()` ni una configuracion `cachedContent` en el
  adaptador de imagen; el codigo solo envia `input` y `response_format`
  (`src/lib/ia/gemini/imagen.ts:82-101`).
- La cifra `15/15` es una medicion historica, no evidencia de trafico actual ni
  de una ventana operacional de concurrencia. No se debe presentar como ahorro
  mensual real.

**Conclusion 10.5:** parcial. La instrumentacion permite medir, pero la
decision basada en datos que exige la aceptacion sigue abierta.

## 6. Fase 10.6 - numeracion de migraciones

### Estado tecnico

- El runner TypeScript valida prefijos unicos, usa advisory lock, checksum,
  `--dry-run` y `--target`; ya no contiene reconciliacion de nombres
  operacionales retirados (`scripts/migrate.ts:86-123`).
- El linaje Python esta separado en `operational.*`, con su propio runner,
  checksum, lock y validacion de numeracion; deliberadamente no tiene
  `--target` ni reconciliacion porque hoy contiene una sola migracion
  (`services/ai-api/scripts/migrate.py:1-12,40-63`).
- El checkout contiene 23 migraciones comerciales numeradas `001` a `023` y
  una migracion Python independiente `001_operational_schema.sql`. La copia
  operacional del repo Next fue retirada; el esquema operacional tiene al
  runner Python como dueño (`PLAN-MAESTRO-V2.md:1233-1246`).

### Decision ausente

El plan documenta la colision 016/019 y deja abierta la pregunta de contador
global frente a prefijo por fecha o rama. Tambien deja pendiente consolidar los
tres mecanismos de idempotencia (`PLAN-MAESTRO-V2.md:1259-1290`). No hay un ADR
posterior que fije:

- si el contador comercial sigue siendo global;
- si `operational.*` mantiene numeracion propia;
- el coste y procedimiento de retirar o reconciliar `020`;
- la estrategia de colision para trabajo paralelo futuro.

**Conclusion 10.6:** pendiente. La implementacion evita colisiones conocidas,
pero no reemplaza la decision de arquitectura solicitada por la Fase 10.

## Hallazgos prioritarios

1. **Estado remoto contradictorio:** 8.4 aparece a la vez como no desplegado y
   como canario remoto activo. Antes de cambiar un flag hay que obtener una
   fuente autorizada del entorno y actualizar el estado rector.
2. **Release no trazable:** `release-manifest.json` no identifica la revision ni
   el rollback del backend Python y mantiene estado de desarrollo.
3. **Gasto sin barrera:** el runbook confirma que no existe un corte de
   presupuesto antes de llamadas pagadas; la generacion LoRA y cualquier
   evaluacion pagada deben seguir bloqueadas fuera de una autorizacion puntual.
4. **Temporales sin retirar:** el script de poblacion y `AQUI.md` siguen en el
   checkout sin una condicion de salida satisfecha.
5. **Numeracion sin decision:** hay dos linajes tecnicos y una copia operacional
   historica, pero no una decision escrita que cierre ownership, renumeracion e
   idempotencia.

## Dependencias y bloqueos

### Dependencias externas

- Confirmacion autorizada del estado real en EC2/Neon y de los flags activos.
- Metricas de una ventana de trafico real para decidir cutover y cache.
- Dueños de infraestructura, proveedores, secretos y presupuesto.
- Autorizacion separada para cualquier llamada pagada, cambio remoto,
  migracion, restore o redeploy.

### Bloqueos tecnicos/documentales

- Falta idempotencia o reconciliacion especifica para el POST pagado de fal.ai.
- Falta gate de presupuesto implementado antes de proveedor y un limite
  agregado para QA/retry.
- El restore de Neon y el rollback real de la migracion Python no estan
  ejercitados en una base remota.
- El redeploy automatico de `services/ai-api` no es equivalente al de Next,
  segun el estado documentado (`resiliencia/fase-6-progreso-2026-09-08.md:85-112`).

## Acciones para cerrar la fase

1. Resolver la discrepancia de 8.4 con evidencia remota autorizada y registrar
   una sola fuente de estado en el manifiesto rector.
2. Cerrar el runbook: asignar responsables, definir gates de gasto y agregar
   pruebas sin coste para los fallos de Gemini/fal.ai donde sea posible.
3. Promover o retirar `scripts/_tmp-populate-v004-stats.ts` y `AQUI.md` despues
   de confirmar sus consumidores; eliminar tambien artefactos de runtime que no
   deban pertenecer al checkout.
4. Documentar la decision del cache explicito con ventana, cifras, coste de
   mantenimiento y condicion de reevaluacion.
  5. Crear un ADR para numeracion/ownership de migraciones e idempotencia,
    incluyendo la separacion ya aplicada entre los linajes comercial y Python.
6. Solo despues, decidir un canario de una capacidad, con baseline,
   observacion, rollback y actualizacion del release manifest.

## Verificaciones no ejecutadas

- No se volvio a consultar EC2, Neon, proveedores ni cuentas de gasto.
- No se cambiaron flags ni se hicieron deploys, migraciones, restores o
  llamadas pagadas.
- No se ejecutaron lint, build, TypeScript, pytest ni E2E en esta auditoria.
- Las cifras y estados citados de otros documentos se consideran evidencia
  documental fechada, no una comprobacion del entorno actual.

## Fuentes revisadas

- `docs/migracion-python/PLAN-MAESTRO-V2.md:811-820,1089-1290`
- `docs/migracion-python/progreso.md:1-5,49-166`
- `docs/migracion-python/auditoria/09-revision-fase-5.md`
- `docs/migracion-python/auditoria/10-revision-fase-6.md`
- `docs/migracion-python/auditoria/11-revision-fase-7.md`
- `docs/migracion-python/rag/rerank-python-fase8-2.md`
- `docs/migracion-python/rag/embeddings-python-fase8-3.md`
- `docs/migracion-python/rag/embeddings-query-python-fase8-4.md`
- `docs/migracion-python/resiliencia/fase-6-progreso-2026-09-08.md`
- `docs/migracion-python/resiliencia/runbook-operativo.md`
- `docs/migracion-python/resiliencia/registro-flags.md`
- `docs/operations/rag-regeneration-v2.md`
- `docs/operations/rag-rollback-v2.md`
- `docs/architecture/decisions/0004-embeddings-consulta-python.md`
- `release-manifest.json`
- `src/lib/ia/feature-flags.ts`
- `src/lib/ia/contracts/operational-v1.ts`
- `src/lib/ia/python-adapter.ts`
- `src/lib/ia/gemini/imagen.ts`
- `packages/agente-core/src/gemini/chat.ts`
- `packages/agente-core/src/telemetria.ts`
- `scripts/migrate.ts`
- `services/ai-api/scripts/migrate.py`
- `scripts/_tmp-populate-v004-stats.ts`
- `AQUI.md`

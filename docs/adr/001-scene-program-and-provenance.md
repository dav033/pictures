# ADR-001 — Programa de escena antes de productos, y procedencia obligatoria

Estado: `aceptado, en implementación (Ola 0 — Tarea 00.2)`
Fecha: 2026-08-22
Plan de referencia: `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`

## Contexto

El diagnóstico del plan de arquitectura (sección 2) encontró que `PlanDecoracion`
V1 es plano: una lista de hasta ocho `estructuras` sin zonas, sin funciones
semánticas obligatorias y sin distinción entre compra, alquiler, elemento
existente del lugar y contexto no cotizable. El backend solo exige una
estructura focal, así que una respuesta con un único arco pasa todas las
validaciones actuales aunque el usuario haya pedido "ideas para mi boda en un
jardín" — una escena mucho más rica que un arco aislado.

Al mismo tiempo, el catálogo comercial verificado (PostgreSQL/Shopify) no
cubre mobiliario, floristería física ni iluminación de boda (sección 2.2).
Sin una regla explícita, la tentación natural del generador de imagen —y de
cualquier iteración futura del prompt— es "completar" visualmente la escena
inventando sillas, flores o luces que no existen en ningún catálogo,
alquiler ni evidencia del lugar. Eso rompe la promesa comercial del producto:
toda imagen aprobada debe poder facturarse o explicarse, nunca alucinarse.

Este ADR fija cuatro decisiones estructurales que ninguna ola posterior del
plan (dominio y recetas, RAG por slot, optimizador, orquestación, generación,
QA) puede contradecir, y las codifica como aserciones ejecutables en
`src/lib/scene/invariants.ts` para que dejen de depender de que el texto de
un prompt de LLM "se acuerde" de cumplirlas.

## Decisión

### 1. Programa antes de productos

La intención del usuario (`EventIntentV2`) se expande primero a un
`SceneProgramV1` — zonas, funciones y slots — mediante una receta versionada
y determinista (p. ej. `wedding_ceremony_garden@1`, sección 5.4). Solo
después de tener ese programa se buscan productos candidatos por slot en el
catálogo. El orden nunca se invierte: no se permite buscar o preseleccionar
productos y luego "armar" un programa alrededor de lo que ya se encontró,
porque eso reproduce el sesgo actual (el catálogo tiene 702 globos y 0
mobiliario, así que buscar primero productos siempre converge a "más
globos").

Codificado en `assertProgramBeforeProducts(events)`: sobre una traza de
pasos de pipeline (`intent_captured`, `program_generated`, `product_search`,
`candidate_selected`), ningún evento de búsqueda o selección de producto
puede ocurrir antes de que exista un evento `program_generated`.

### 2. Sin fuente no se renderiza

Todo objeto decorativo visible en una imagen generada debe tener un
`SupplyBinding` verificable: `catalog_sale`, `catalog_rental`,
`venue_existing` con evidencia, o `context_non_quotable` limitado a
fondo/arquitectura/vegetación natural genérica (sección 6.1). Nunca se
inventa mobiliario, flores o luces para completar visualmente una escena,
ni siquiera cuando el catálogo no alcanza — en ese caso la respuesta
correcta es una propuesta parcial con brechas explícitas (sección 1), no una
imagen más bonita con procedencia inventada.

Codificado en `assertNoRenderWithoutSource(instances)`,
`assertContextNonQuotableScope(binding)` (el `context_kind` de un binding
`context_non_quotable` solo puede ser pared, piso, cielo, terreno, luz
ambiental o vegetación natural — nunca sillas, mesas, flores arregladas,
lámparas decorativas, carteles ni centros de mesa) y
`assertVenueExistingHasEvidence(binding)` (un elemento `venue_existing`
exige una región de foto o una confirmación explícita).

### 3. Evento y vista son niveles distintos

La cobertura del evento completo (qué zonas están planificadas) es
independiente de la cobertura de una vista específica (qué funciones deben
ser visibles en un encuadre concreto). Una vista de ceremonia no intenta
mostrar la recepción; el sistema puede planificar `entrance_view`,
`ceremony_view`, `reception_view` y `detail_view` para el mismo evento sin
que ninguna de ellas cargue con la responsabilidad de mostrarlo todo
(sección 3, "Decisión sobre completo").

Codificado en `assertEventViewCoverageSeparation(coverageReport,
viewZoneAllowlist)`: valida que `event_coverage` y `view_coverage` sean
estructuras separadas y que ninguna vista reclame una zona fuera de su
alcance permitido ni una zona que ni siquiera esté planificada a nivel de
evento.

### 4. Precio desconocido bloquea aprobación final

Un plan con líneas `QUOTE_REQUIRED` puede mostrarse como estimación, pero
nunca puede aprobarse ni generarse como presupuesto verificado. El hard gate
de presupuesto (sección 6.3, invariantes 4 y 5) bloquea la aprobación si el
total conocido supera el techo declarado por el usuario o si faltan precios
obligatorios (`QUOTE_REQUIRED` u `UNAVAILABLE` en una línea requerida).

Codificado en `assertBudgetGateBeforeApproval(plan)`: solo aplica el gate
cuando `plan.status` es `APPROVED` o `VERIFICADO`; en ese caso, ninguna línea
obligatoria puede estar `QUOTE_REQUIRED` ni `UNAVAILABLE`, y el total
conocido no puede superar el techo.

### Invariante adicional codificada: revalidación por cambio de oferta

La sección 6.4 exige que un cambio de oferta, precio, modalidad,
disponibilidad o snapshot invalide `selection_hash`, `quote_hash` y
cualquier aprobación anterior. Se codifica en
`assertHashInvalidationOnOfferChange(previousHashes,
currentOfferSnapshotIds)`: si el conjunto de `snapshot_id` que un hash usó
para su selección ya no coincide con los snapshots vigentes de esas mismas
ofertas, ese hash no puede seguir marcado `valid`.

## Consecuencias

- Ninguna ruta de generación puede saltarse la expansión a `SceneProgramV1`
  para ir directo a buscar productos; cualquier código que lo intente falla
  una prueba determinista, no solo una revisión de prompt.
- Toda instancia de `SceneSpecV2` sin `supply_binding`, o con un
  `context_non_quotable` fuera de alcance, o con un `venue_existing` sin
  evidencia, es rechazable en código antes de llegar al proveedor de imagen.
- El botón de aprobación (Tarea 06.2) puede apoyarse en
  `assertBudgetGateBeforeApproval` para decidir si debe deshabilitarse, en
  vez de reimplementar la regla en la UI.
- Un cambio de oferta después de aprobar (E2E-7) tiene una función pura que
  detecta la inconsistencia sin necesitar volver a golpear PostgreSQL en la
  prueba.
- Estas funciones usan tipos locales mínimos (`MinimalSupplyBinding`,
  `MinimalScenePlan`, `MinimalCoverageReport`, ...) definidos en
  `src/lib/scene/invariants.ts`. Cuando la Tarea 01.1 publique los contratos
  Zod reales (`EventIntentV2`, `SceneProgramV1`, `SupplyBinding`,
  `ScenePlanV2`, `ResolvedScenePlanV2`, `SceneCoverageReport`), esos tipos
  locales deben reemplazarse por los tipos inferidos de Zod sin cambiar la
  firma pública de las funciones `assert*`; este ADR no bloquea esa
  migración ni depende de ella.
- Estas invariantes no reemplazan los contratos Zod de la Tarea 01.1 ni la
  frontera de autoridad comercial de la Tarea 00.3 (seed/`manualProducts`
  como `editorial_reference`/`test_only`); son un piso ejecutable adicional,
  no un sustituto.

## Alternativas consideradas

1. **Confiar en el prompt del sistema para expresar estas reglas en lenguaje
   natural.** Rechazada: el diagnóstico (sección 2.1) ya muestra que un
   prompt que "pide" tres a cinco estructuras puede terminar aceptando una
   sola porque el backend no lo exige en código. Una regla de negocio crítica
   que solo vive en texto de prompt es, por definición, best-effort.
2. **Esperar a los contratos Zod completos de la Tarea 01.1 antes de
   codificar cualquier invariante.** Rechazada: el plan exige que la Ola 0
   congele la línea base y fije decisiones auditable antes de tocar
   contratos (sección 11, matriz de olas: 00 no depende de nada y 01/02
   corren en paralelo). Codificar invariantes con tipos locales mínimos
   ahora permite empezar a probarlas de inmediato y da a la Tarea 01.1 un
   contrato de comportamiento que sus tipos deben poder satisfacer.
3. **Implementar las reglas únicamente como validación en el optimizador
   (Ola 3) o en la UI de aprobación (Ola 4).** Rechazada: dejaría un hueco
   entre Ola 0 y Ola 3/4 donde nada impide violar la regla, y duplicaría la
   lógica en varios lugares sin una fuente única de verdad. Las funciones de
   este módulo están pensadas para reutilizarse desde el optimizador, el
   resolver, la UI de aprobación y la suite E2E.
4. **Usar solo `{ ok: boolean, violations: string[] }` sin lanzar errores.**
   Rechazada como único mecanismo: para invariantes "gate" (p. ej. bloquear
   aprobación) es más seguro que el llamador tenga que manejar
   explícitamente un `throw` con `try/catch` que arriesgarse a ignorar un
   `ok: false` devuelto en silencio. Se adoptó un híbrido: cada función
   lanza `SceneInvariantViolationError` (que expone `.violations: string[]`)
   cuando la regla se viola, y devuelve `{ ok: true, violations: [] }`
   cuando se cumple.

## Verificación

`npx tsx scripts/test-scene-invariants.ts` prueba casos positivos y
negativos para cada una de las siete funciones `assert*` de
`src/lib/scene/invariants.ts`.

# Registro de flags de comportamiento

Inventario del estado actual del código para la Fase 5.3 del plan maestro
(capítulo 12.3). La fuente de verdad de cada default es la expresión que se
ejecuta en `src/` o `packages/`, no el valor de ejemplo de `.env.example`.

**Actualización 2026-09-09:** este documento se escribió el 2026-09-08 contra
`src/lib/ia/feature-flags.ts`, `src/lib/rag/flags.ts` y `src/lib/plan/flags.ts`
como tres archivos separados. Esa fragmentación de archivos ya se corrigió
(commit `0ef7881`): `src/lib/rag/flags.ts` y `src/lib/plan/flags.ts` se
eliminaron y los 9 flags que vivían ahí (`RAG_ENABLED`, `RAG_FRANJAS_ENABLED`,
`RAG_USE_VECTOR`, `RAG_USE_FULLTEXT`, `RAG_USE_TRIGRAM`,
`PLAN_DECORACION_ENABLED`, `LORA_ALLOW_REJECTED_FOR_TESTING`,
`FAL_MULTI_LORA_SUPPORTED`, `IMAGE_DEBUG`) ahora viven en
`src/lib/ia/feature-flags.ts` junto con los 11 de `FeatureFlag`, cada uno con
su default preservado exactamente y documentado en un comentario. La tabla de
abajo no se reescribió fila por fila para reflejar los nuevos paths; donde
diga `src/lib/rag/flags.ts` o `src/lib/plan/flags.ts`, leer
`src/lib/ia/feature-flags.ts`.
**Lo que esa consolidación NO cerró:** documentar el *default técnico* de un
flag no es lo mismo que escribir la *decisión de negocio* de por qué ese es
el default correcto. Los 13 flags de la sección "Huecos detectados" siguen sin
esa decisión escrita — eso requiere criterio de producto, no una
reorganización de archivos, y sigue pendiente de que alguien con esa autoridad
lo resuelva flag por flag.

El registro incluye toggles booleanos y los dos controles enumerados que el
código usa como rollback o selección de comportamiento (`LORA_PROMPT_VERSION`
y `GEMINI_CHAT_THINKING_LEVEL`). No incluye secretos, credenciales, URLs,
modelos, límites numéricos ni otros parámetros de conexión. `NODE_ENV` tampoco
es un flag de capacidad: es el modo de ejecución que condiciona algunos de
estos toggles.

## Inventario

| Flag | Archivo(s) donde vive | Default si no esta seteado | ¿Es esa una decision escrita o un accidente? | Que activa/desactiva |
|---|---|---|---|---|
| `REFERENCE_BLUEPRINT_V2` | `src/lib/ia/feature-flags.ts`; consumidor en `src/app/api/generate/route.ts` | `true` (`featureEnabled()` cae al `return true` generico) | Sin decision escrita — default implicito, revisar | Si esta apagado, `/api/generate` rechaza la solicitud. Encendido permite usar el blueprint V2 de referencias en generacion. |
| `IMAGE_QA_ENABLED` | `src/lib/ia/feature-flags.ts`; consumidor en `src/app/api/generate/route.ts` | `true` | Sin decision escrita — default implicito, revisar | Controla el reintento automatico de generacion cuando el QA visual devuelve `pass: false`. No es el flag que decide si corre la observacion de instancia. |
| `LOCALIZED_EDIT_ENABLED` | `src/lib/ia/feature-flags.ts`; consumidor en `src/app/api/generate/route.ts` | `true` | Sin decision escrita — default implicito, revisar | Permite la generacion o edicion localizada cuando la solicitud trae una foto del espacio (`venue`). Apagado, esa solicitud falla. |
| `SCENE_PLAN_V2_SHADOW` | `src/lib/ia/feature-flags.ts`; consumidor en `src/lib/ia/registro-herramientas.ts`; pipeline en `src/lib/scene/orchestrator.ts` | `false` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Ejecuta el pipeline de escena V2 en modo sombra, registra su resultado para comparar con V1 y no lo expone al usuario. |
| `SCENE_PLAN_V2_ENABLED` | `src/lib/ia/feature-flags.ts` | `false` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Esta declarado como capacidad del plan de escena V2, pero no tiene un consumidor adicional visible en `src/`; actualmente no activa una ruta por si solo. |
| `SCENE_PLAN_V2_REQUIRE_VERIFIED_SOURCES` | `src/lib/ia/feature-flags.ts` | `false` en el codigo, aunque `.env.example` contiene `true` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Esta declarado para exigir fuentes verificadas en el plan de escena V2, pero no tiene un consumidor adicional visible en `src/`; el valor de `.env.example` no cambia el default cuando la variable falta. |
| `SCENE_PLAN_V2_VISUAL_QA` | `src/lib/ia/feature-flags.ts` | `false` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Esta declarado para el QA visual del plan de escena V2, pero no tiene un consumidor adicional visible en `src/`; actualmente no activa una ruta por si solo. |
| `SCENE_PLAN_V2_KILL_SWITCH` | `src/lib/ia/feature-flags.ts` | `false` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Esta declarado como kill switch del plan de escena V2, pero no tiene un consumidor adicional visible en `src/`; actualmente no fuerza un apagado por si solo. |
| `PLAN_COST_OPTIMIZER_V2` | `src/lib/ia/feature-flags.ts`; consumidor en `src/lib/plan/resolver.ts`; snapshot en `src/app/api/generate/route.ts` | `true` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Activa la reoptimizacion de presentaciones y paquetes del plan. Apagarlo conserva el comportamiento V1 validado para rollback. |
| `PLAN_BUDGET_GATE_V2` | `src/lib/ia/feature-flags.ts`; snapshot en `src/app/api/generate/route.ts` | `true` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | El valor se incluye en el snapshot de auditoria del plan. No hay un consumidor adicional visible que aplique un gate independiente; apagarlo no evita por si solo la validacion comercial existente. |
| `IMAGE_INSTANCE_QA` | `src/lib/ia/feature-flags.ts`; consumidores en `src/lib/ia/image-qa.ts` y `src/app/api/generate/route.ts` | Si la variable falta, usa `IMAGE_QA_VISION` si existe; si tampoco existe, queda `true` cuando hay `GEMINI_API_KEY` y `false` cuando no la hay. Si se define explicitamente, acepta `1`, `true` u `on` (sin distinguir mayusculas) | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Decide si se intenta la observacion visual de instancia. Un plan aprobado falla cerrado antes de llamar al proveedor pagado si el flag esta apagado; el mismo gate controla la llamada de QA. |
| `IMAGE_QA_VISION` | Lectura heredada en `src/lib/ia/feature-flags.ts` | No tiene default independiente: solo se consulta como fallback de `IMAGE_INSTANCE_QA`; ausente, el fallback depende de la presencia de `GEMINI_API_KEY` | Decision escrita (ver comentario en `src/lib/ia/feature-flags.ts`) | Compatibilidad con el nombre antiguo del flag de QA. Si `IMAGE_INSTANCE_QA` no esta definido, `1`, `true` u `on` lo encienden y otros valores lo apagan. `IMAGE_INSTANCE_QA` explicito tiene precedencia. |
| `RAG_ENABLED` | `src/lib/rag/flags.ts`; consumidores en `src/app/api/chat/route.ts` y `src/lib/ia/registro-herramientas.ts` | `false` (solo el texto exacto `true` lo activa) | Sin decision escrita — default implicito, revisar | Activa el conjunto de herramientas y el prompt de retrieval de catalogo RAG. |
| `RAG_FRANJAS_ENABLED` | `src/lib/rag/flags.ts`; consumidores en `src/app/api/chat/route.ts` y `src/lib/ia/registro-herramientas.ts` | `false` (solo el texto exacto `true` lo activa) | Sin decision escrita — default implicito, revisar | Activa el flujo de franjas de presupuesto y la resolucion de canasta asociada al RAG. |
| `RAG_USE_VECTOR` | `src/lib/rag/retrieval/search.ts` y `src/lib/rag/chat/buscar-presupuesto.ts` | `false` (solo el texto exacto `true` lo activa) | Sin decision escrita — default implicito, revisar | Habilita la rama vectorial y los embeddings. En presupuesto tambien requiere una credencial Gemini; sin ella el retrieval vuelve a la ruta lexica. |
| `RAG_USE_FULLTEXT` | `src/lib/rag/retrieval/search.ts` | `true` (solo el texto exacto `false` la apaga) | Sin decision escrita — default implicito, revisar | Activa o desactiva la rama de busqueda full-text del retrieval hibrido. |
| `RAG_USE_TRIGRAM` | `src/lib/rag/retrieval/search.ts` | `true` (solo el texto exacto `false` la apaga) | Sin decision escrita — default implicito, revisar | Activa o desactiva la rama trigram del retrieval hibrido. |
| `RAG_RERANK_ENABLED` | `src/lib/ia/feature-flags.ts`; consumidor en `src/lib/rag/retrieval/search.ts` | `false` (solo el texto exacto `true` lo activa) | Decision escrita (Fase 8.2 en `PLAN-MAESTRO-V2.md` y comentario del flag) | Solicita reranking local con cross-encoder a Python despues de la whitelist SQL. Si Python esta apagado, falla o supera el deadline, conserva el orden local y no cambia el conjunto de candidatos. |
| `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED` | `src/lib/ia/feature-flags.ts`; consumidores en `src/lib/rag/embeddings.ts`, `src/lib/rag/chat/buscar-presupuesto.ts`, `src/lib/rag/retrieval/search.ts` y `src/lib/rag/retrieval/by-scene-slot.ts` | `false` (solo el texto exacto `true` lo activa) | Decision escrita (Fase 8.4 en `docs/migracion-python/rag/embeddings-query-python-fase8-4.md`) | Envia embeddings `RETRIEVAL_QUERY` al endpoint Python cuando tambien estan activos `RAG_USE_VECTOR` y el backend Python. Si Python falla, retrieval conserva las ramas lexicas. |
| `PLAN_DECORACION_ENABLED` | `src/lib/plan/flags.ts`; consumidores en `src/app/api/chat/route.ts`, `src/app/api/references/analyze/route.ts`, `src/app/api/ia/salud/route.ts`, `src/lib/ia/registro-herramientas.ts` y `src/lib/ia/prompt-sistema.ts` | `false` (acepta `1`, `true` u `on`, sin distinguir mayusculas) | Sin decision escrita — default implicito, revisar | Activa el plan declarativo de decoracion, el modo perceptual de referencias y sus herramientas cuando RAG tambien esta activo. |
| `LORA_PROMPT_VERSION` | Lectura en `src/app/api/generate/route.ts` | `v2`; cualquier valor distinto del literal `v1` cae en `v2` | Sin decision escrita — default implicito, revisar | Selecciona el compilador de prompt LoRA V1 o V2. `v1` es rollback explicito; la comparacion LoRA siempre envia V2 y no respeta este selector. |
| `LORA_ALLOW_REJECTED_FOR_TESTING` | Lectura en `src/lib/lora/mode-resolver.ts` | `false`; solo el texto exacto `true` y un entorno distinto de produccion pueden habilitarlo | Sin decision escrita — default implicito, revisar | Permite, unicamente para pruebas locales y cuando el caller lo solicita, usar un artefacto LoRA rechazado. En produccion permanece desactivado aunque la variable este en `true`. |
| `FAL_MULTI_LORA_SUPPORTED` | `src/lib/lora/mode-resolver.ts` y `src/app/api/lora/compatibility/route.ts` | `false` (solo el texto exacto `true` lo activa) | Sin decision escrita — default implicito, revisar | Declara si el proveedor soporta varias aplicaciones LoRA en una solicitud. Apagado, mas de una aplicacion falla con `LORA_MULTI_UNSUPPORTED`; tambien se refleja en el endpoint de compatibilidad. |
| `SEMPERTEX_LORA_EDIT` | Lectura en `src/lib/ia/sempertex-lora.ts` | `false` (solo el texto exacto `true` lo activa) | Decision escrita (ver comentario en `src/lib/ia/sempertex-lora.ts`) | Mantiene el LoRA sin imagenes de referencia por defecto. Al activarse, envia hasta cuatro inputs para el camino experimental de condicionamiento por layout. |
| `IMAGE_DEBUG` | Lecturas en `src/app/api/generate/route.ts` | `false` como override ambiental (solo el texto exacto `true` lo activa); en un entorno distinto de produccion el debug ya queda activo por `NODE_ENV` aunque esta variable falte | Sin decision escrita — default implicito, revisar | Añade logs de estimacion y datos visuales/de diagnostico a la respuesta de generacion. No debe confundirse el default de esta variable con el comportamiento no-productivo impuesto por `NODE_ENV`. |
| `PRECIO_INCLUYE_IVA` | `src/lib/cotizacion/motor.ts` y lectura equivalente en `src/lib/plan/resolver.ts` | `true`; solo el texto exacto `false` lo desactiva | Decision escrita (ver comentario en `src/lib/cotizacion/motor.ts`) | Determina si la cotizacion trata los precios del catalogo como IVA incluido. El comentario del motor confirma el default con el negocio. |
| `GEMINI_CHAT_THINKING_LEVEL` | Lectura y traduccion en `src/lib/ia/registro.ts`; telemetria en `src/app/api/chat/route.ts`; adaptador en `packages/agente-core/src/gemini/chat.ts` | Sin variable, `crearChatGemini` no envia `thinkingConfig` y conserva el default del modelo. Solo `low` o `minimal` producen un override; otros valores tambien quedan sin override | Decision escrita (ver comentario en `packages/agente-core/src/gemini/chat.ts`); el comentario de `src/lib/ia/registro.ts` afirma ademas que `low` esta activado por default, pero el codigo solo lo aplica cuando la variable esta definida | Ajusta el nivel de razonamiento del chat Gemini. No afecta las llamadas de imagen ni QA. |
| `PYTHON_BACKEND_ENABLED` | Seleccion en `src/lib/ia/contracts/operational-v1.ts`, expuesta por `src/lib/ia/python-adapter.ts` y usada por `src/app/api/internal/ai/echo/route.ts` | `false`; los valores verdaderos son `1`, `true` u `on` | Decision escrita (ver `docs/migracion-python/PLAN-MAESTRO-V2.md`, invariante 6) | Selecciona Python solo cuando esta activo y el kill switch esta apagado. **Aislado intencionalmente, no consolidar:** pertenece al contrato operativo de migracion y no al registro generico de capacidades; su pareja kill switch debe conservar precedencia absoluta. |
| `PYTHON_BACKEND_KILL_SWITCH` | Seleccion en `src/lib/ia/contracts/operational-v1.ts`, expuesta por `src/lib/ia/python-adapter.ts` y usada por `src/app/api/internal/ai/echo/route.ts` | `false`; los valores verdaderos son `1`, `true` u `on` | Decision escrita (ver `docs/migracion-python/PLAN-MAESTRO-V2.md`, invariante 6) | Cuando esta activo, fuerza el backend Next aunque `PYTHON_BACKEND_ENABLED` tambien lo este. **Aislado intencionalmente, no consolidar:** su precedencia absoluta es un invariante operativo de rollback y no puede quedar subordinada a un registro generico. |

## Reglas de precedencia y lectura

- `featureEnabled()` acepta `1`, `true` y `on`, sin distinguir mayusculas, para los 11 flags de `FeatureFlag` cuando tienen un valor explicito.
- En `feature-flags.ts`, los flags `SCENE_PLAN_V2_*` caen a `false`, los flags `PLAN_COST_OPTIMIZER_V2` y `PLAN_BUDGET_GATE_V2` caen a `true`, y el resto cae a `true` salvo el fallback especial de `IMAGE_INSTANCE_QA`.
- `IMAGE_INSTANCE_QA` tiene una sola fuente de verdad en `feature-flags.ts`. `image-qa.ts` y el gate de `/api/generate` llaman a `featureEnabled("IMAGE_INSTANCE_QA")`; no mantienen una segunda implementacion.
- `RAG_ENABLED` y `RAG_FRANJAS_ENABLED` solo reconocen `true` en minusculas. Los toggles RAG de ramas usan convenciones distintas: vector solo se activa con `true`, mientras full-text y trigram solo se apagan con `false`.
- Los valores presentes en `.env.example` son ejemplos de despliegue. No sustituyen los defaults del codigo cuando la variable no existe; por ejemplo, el codigo deja `SCENE_PLAN_V2_REQUIRE_VERIFIED_SOURCES` en `false` y los optimizadores de plan en `true`.
- `PYTHON_BACKEND_KILL_SWITCH` se evalua junto con `PYTHON_BACKEND_ENABLED` en `seleccionarBackendMigracion()`, y la seleccion resultante es `python` unicamente cuando `enabled && !killSwitch`.

## Huecos detectados

Estos son los flags cuya fila queda marcada como **Sin decision escrita — default implicito, revisar**:

- `REFERENCE_BLUEPRINT_V2`
- `IMAGE_QA_ENABLED`
- `LOCALIZED_EDIT_ENABLED`
- `RAG_ENABLED`
- `RAG_FRANJAS_ENABLED`
- `RAG_USE_VECTOR`
- `RAG_USE_FULLTEXT`
- `RAG_USE_TRIGRAM`
- `PLAN_DECORACION_ENABLED`
- `LORA_PROMPT_VERSION`
- `LORA_ALLOW_REJECTED_FOR_TESTING`
- `FAL_MULTI_LORA_SUPPORTED`
- `IMAGE_DEBUG`

El registro contiene **29 flags o controles de comportamiento** y **14** quedan
sin decision escrita visible en el codigo.

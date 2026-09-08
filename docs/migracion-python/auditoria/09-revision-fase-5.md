# Auditoría previa — Fase 5: Resiliencia, recuperación y degradación

**Alcance:** entregas 5.1 a 5.5 de `docs/migracion-python/PLAN-MAESTRO-V2.md`. Solo lectura. No se ejecutó ninguna migración, no se tocó ninguna base de datos, no se llamó a Gemini/fal.ai/Shopify.

**Nota de metodología:** el capítulo 13.3 del plan especifica `openai/gpt-5.6-luna` variante `xhigh`. Esta auditoría se produjo con un subagente Claude (`Plan`, sin herramientas de escritura) porque la cuenta OpenAI usada por `opencode` alcanzó su tope de uso el 2026-09-08. Desviación autorizada por el usuario en la misma sesión.

**Nota de contexto operativo:** el árbol de trabajo tiene 39 archivos con cambios sin commitear (`git status --porcelain`), incluyendo `src/lib/ia/image-qa.ts` y `src/lib/ia/sempertex-lora.ts`, citados abajo. Las citas de línea reflejan el árbol de trabajo actual (lo que hay hoy en disco), no necesariamente `HEAD`. Además, `scripts/migrations/021_ai_call_log.sql` está **sin trackear**. Si alguno de estos cambios se revierte o se commitea con variaciones antes de iniciar la Fase 5, las líneas exactas deben re-verificarse.

---

## 1. Verificación de evidencia

| Cita del plan | ¿Sigue apuntando a lo que dice? | Detalle |
|---|---|---|
| `PLAN-MAESTRO-V2.md:561,582,1088,1183` — "18 archivos sin nota `-- rollback:`" | **No, cambió.** El número está desactualizado y subestimado. | Al día de hoy hay **19 archivos** de los 21 en `scripts/migrations/` sin la nota. El propio commit que fija el plan en 18 ya es posterior al merge que trajo `020_operational_idempotency.sql`, que sí tiene la nota; con 20 archivos trackeados y solo uno con nota, el conteo correcto en ese momento ya era 19, no 18. Hoy, con `021_ai_call_log.sql` (sin commitear, con nota), son 21 archivos totales, 2 con nota, 19 sin ella. |
| `PLAN-MAESTRO-V2.md:575` — `src/app/api/generate/route.ts:604-607`, patrón `pass: null` | **Sigue vigente, desplazado en 1 línea.** | La función `buildQa` empieza en la línea **603** (no 604); el `pass: null` está en la línea **605**. El patrón citado es exacto y no fue tocado por los cambios sin commitear en ese archivo. |
| `PLAN-MAESTRO-V2.md:567-570` — `IMAGE_QA_ENABLED` activo por defecto; flags en `feature-flags.ts`, `flags.ts` y `process.env` directo | **Sigue vigente, e incompleto.** | Confirmado: `feature-flags.ts:14-25` no lista `IMAGE_QA_ENABLED` en ninguna excepción, cae en el `return true` genérico. Pero además existe un **tercer archivo de flags dedicado** no citado por el plan: `src/lib/plan/flags.ts` (`PLAN_DECORACION_ENABLED`). Y hay al menos `RAG_USE_VECTOR` (duplicado en `retrieval/search.ts:20` y `buscar-presupuesto.ts:109`), `LORA_PROMPT_VERSION`, `LORA_ALLOW_REJECTED_FOR_TESTING`, `FAL_MULTI_LORA_SUPPORTED`, `IMAGE_DEBUG` y, el caso más grave, `IMAGE_INSTANCE_QA` reimplementado de forma independiente en `image-qa.ts:79-84` con una lógica de default que no es idéntica a la de `feature-flags.ts:22`. Ver sección 5. |
| `PLAN-MAESTRO-V2.md:563-566` — sin backup/restore de la base comercial; artefactos LoRA en filesystem, sincronizados al EC2 por SSH | **Sigue vigente, pero la mecánica del "sincronizado por SSH" es distinta de lo que sugiere el texto.** | No hay ningún documento de backup/restore de Postgres comercial (Neon) — `docs/operations/rag-rollback-v2.md` es lo más cercano y **asume** que existe un backup sin decir cómo se toma, dónde vive ni cómo se verifica. La sincronización SSH real (`src/lib/lora/snapshot.ts`) mueve un **snapshot de estadísticas JSON y las imágenes de la galería del dataset** al volumen Docker del EC2 — **no** los pesos `.safetensors` del LoRA entrenado. Ver sección 5. |
| Capítulo 10.3(g) — "cada `.sql` debe empezar con un comentario `-- rollback:`" | **La implementación real es más laxa que el enunciado.** | `avisarReversionesFaltantes` en `scripts/migrate.ts:119-124` usa `/^\s*--\s*rollback:/im` — el flag `m` (multiline) permite la nota en **cualquier línea**, no solo al inicio, contradiciendo el "debe empezar con" del enunciado. Hoy no cambia el resultado (020 y 021 tienen la nota en la línea 5), pero un futuro archivo con la nota a mitad de archivo pasaría el check igual. |
| Capítulo 6, invariantes 1-8 | **Vigentes, sin evidencia de que hayan cambiado.** | — |
| Capítulo 13.2, seis secciones | Vigente, es la plantilla de este informe. | — |

---

## 2. Sigue en pie / ya no aplica / cambió de forma

| Entrega | Estado | Motivo |
|---|---|---|
| **5.1** — Nota `-- rollback:` en las 18 migraciones que no la tienen | **Cambió de forma.** | El universo real es **19 archivos**, no 18: `001` a `019` excepto `020` y `021` (que ya la tienen). Dos de los 19 (`013_plan_audit_chain.sql`, `019_happie_webhook.sql`) ni siquiera tienen un comentario descriptivo de cabecera — la nota de reversión ahí exige reconstruir intención desde el commit que los creó. |
| **5.2** — Backup y restore de la base comercial, ejecutado una vez contra una copia | **Sigue en pie tal cual.** | Confirmado que no existe: `docs/operations/rag-rollback-v2.md` documenta rollback de *datos del catálogo* vía reimportación determinista (Shopify/manifests), válido solo para tablas con fuente externa reproducible. No cubre `plan_audit_log`, `ai_call_log`, `lora_training_runs`, `rag_source_snapshots`, agregados de demanda ni embeddings ya calculados, ni documenta cómo tomar/restaurar un backup real de Neon. |
| **5.3** — Registro único de capacidades de IA con default explícito | **Sigue en pie, con alcance más amplio del descrito.** | El plan describe "tres sitios". Hay un cuarto archivo dedicado (`src/lib/plan/flags.ts`) y al menos 6 variables sueltas adicionales leídas con `process.env` directo, más el caso de reimplementación duplicada de `IMAGE_INSTANCE_QA` (ver sección 5). |
| **5.4** — Degradación probada por capacidad | **Cambió de forma: no todos los sub-casos parten del mismo punto.** | "Embeddings fallando" ya tiene un patrón de degradación en producción (`retrieval/search.ts:544-556`: try/catch → `ERROR` → sigue con FTS/trigram). "Postgres no disponible" **no** está cubierto para las ramas obligatorias `queryFullText`/`queryTrigram` (`search.ts:525-528`): sin try/catch, hace `throw` y tumba el turno. "Sin saldo en fal.ai" no se distingue de cualquier otro error 4xx/5xx (`sempertex-lora.ts:51-62`); no fabrica éxito, pero tampoco es un error identificable por tipo. "Gemini caído" para QA visual ya sigue el patrón correcto (`image-qa.ts:134-137`, catch → `null` → `pass: null`). "Store de idempotencia inalcanzable" tiene dos superficies distintas (Happie en producción hoy; contrato Python todavía sin tráfico real). |
| **5.5** — Inventario de artefactos LoRA y su recuperación | **Sigue en pie, con un hallazgo que cambia el diagnóstico.** | El plan sugiere que ya hay una copia de los pesos en el servidor vía SSH. No es así: lo que viaja por SSH es un snapshot de estadísticas y las imágenes de la galería, no los `.safetensors`. Los pesos reales se referencian en producción por **URL de fal.ai** (`sempertex-lora.ts:227-228`) y la única copia local conocida es la que un operador baja manualmente con `scripts/recibir-lora.ts` a `data/lora-backup/`, excluido de git y de la sincronización a EC2. |

---

## 3. Riesgo y esfuerzo por entrega

| Entrega | Riesgo | Esfuerzo | Invariante del cap. 6 en juego |
|---|---|---|---|
| **5.1** | Bajo en ejecución, pero **alto en integridad de la evidencia** si una nota de reversión incorrecta se ejecuta literalmente más tarde. `013` y `019` sin cabecera descriptiva obligan a reconstruir intención desde `git log`. | Medio — 19 archivos, varios triviales, algunos difíciles (`009` con índices compartidos, `013`/`016`-`018` con relaciones entre tablas LoRA). | Invariante 8 si una nota implica un DROP que una ruta activa todavía lee; invariante 5 si toca tablas de redondeo/paquetes sin verificar otros usos. |
| **5.2** | **Alto.** Mayor riesgo de la fase: un restore mal dirigido puede escribir sobre la base equivocada. | Alto — no hay procedimiento previo; hay que definir el mecanismo (pg_dump/pg_restore, branch de Neon, o snapshot), probarlo una vez contra una copia, y documentar qué tablas son reproducibles desde fuente y cuáles no. | Ninguno directamente, pero una ejecución descuidada viola la garantía implícita de "nunca se toca la base comercial real sin confirmación" (10.3d). |
| **5.3** | Medio. Riesgo de decisión oculta: si al consolidar flags se cambia silenciosamente el default de `IMAGE_QA_ENABLED` (hoy `true`), es un cambio de producto que debe quedar escrito, no ser efecto colateral. Riesgo de romper la paridad entre las dos implementaciones de `IMAGE_INSTANCE_QA`. | Medio — 4+ archivos de flags y ~6 lecturas sueltas de `process.env`. | Invariante 6 si la consolidación "arrastra" `PYTHON_BACKEND_ENABLED`/`KILL_SWITCH` al registro genérico y pierde su precedencia absoluta. |
| **5.4** | **Alto**, el segundo más alto de la fase. Probar "sin saldo en fal.ai"/"Gemini caído" sin llamar a proveedores exige mocks; si se prueba contra el proveedor real con reintentos, choca con el invariante 7 (`sempertex-lora.ts` no envía clave de idempotencia a fal.ai). Probar "Postgres no disponible" en FTS/trigram hoy resulta en excepción no capturada. | Alto — construir el arnés de inyección de fallos es trabajo nuevo. | Invariante 1 (que la degradación no fabrique producto/precio/aprobación), invariante 3 (que un camino degradado no salte la aprobación explícita), invariante 7 (retries fal.ai/Gemini). |
| **5.5** | Bajo en ejecución, medio en honestidad del resultado: riesgo de decir "se puede recuperar" solo porque existe `scripts/recibir-lora.ts`, sin verificar que se corrió para cada fila activa. | Bajo-medio — cruzar `lora_training_runs` contra los archivos reales en `data/lora-backup/`, local a una sola máquina. | Ninguno directo; indirectamente compromete la trazabilidad que el capítulo 9 da por sentada si un LoRA en producción pierde su backup y su URL de fal.ai expira. |

---

## 4. Orden propuesto dentro de la fase

El plan no fija un orden explícito entre 5.1-5.5. Orden propuesto, que **difiere del orden de numeración del plan**:

1. **5.5 (inventario LoRA) primero.** Lectura pura, sin dependencias; su resultado (dónde viven de verdad los pesos, qué corridas no tienen backup) puede reordenar las prioridades del resto.
2. **5.1 (notas de rollback) segundo.** La entrega más mecánica; escribir cada nota obliga a releer el esquema de cada migración, insumo directo para 5.2.
3. **5.3 (registro único de flags) tercero.** Prerrequisito de facto de 5.4: no tiene sentido diseñar pruebas de degradación "por capacidad" si las capacidades no están nombradas y centralizadas todavía.
4. **5.4 (degradación probada) cuarto**, apoyándose en el inventario de capacidades de 5.3.
5. **5.2 (backup/restore) último** — no por ser menos importante (es la de mayor riesgo), sino porque conviene ejecutarla con el resto de la fase ya estable, sin mezclar una operación de alto riesgo con cambios de código en curso, y con el catálogo de tablas de 5.1 ya claro.

Alternativa documentada explícitamente (13.2.4): si el criterio de quien coordina es "mitigar primero el riesgo más caro", invertir 5.2 al principio.

---

## 5. Lo que el plan no vio

1. **El conteo "18" ya estaba mal cuando se escribió, y hoy es 19 (o 21 con el archivo sin commitear).** No es solo deriva del repositorio: la aritmética no cuadraba ni en el commit donde se fijó, porque `020_operational_idempotency.sql` ya existía con su nota en ese momento.

2. **Los pesos del LoRA no están donde el plan implica.** El texto de la Fase 5 lleva a pensar que hay una copia de los `.safetensors` en el servidor de producción. La sincronización SSH real solo mueve estadísticas y fotos de la galería. El artefacto que de verdad importa recuperar vive como URL de fal.ai y, si acaso, como copia manual en el disco de quien corrió `scripts/recibir-lora.ts`. Esto cambia el diagnóstico de 5.5 de "documentar una sincronización existente" a "descubrir que no existe una copia operativa fuera del proveedor pagado y de un disco personal".

3. **La fragmentación de flags es peor de lo que el capítulo 12.3 describe.** No son "tres sitios": hay un cuarto archivo (`src/lib/plan/flags.ts`) y al menos un flag — `IMAGE_INSTANCE_QA` — con su lógica de default **reimplementada de forma independiente en dos archivos** (`feature-flags.ts:22` y `image-qa.ts:79-84`), con una tercera variable heredada (`IMAGE_QA_VISION`) viva solo en el segundo. Dos implementaciones del mismo default pueden divergir sin que ningún test lo note.

4. **La degradación de Postgres ya está resuelta a medias, y el plan no distingue las dos mitades.** La rama vectorial de retrieval ya degrada correctamente. Las ramas de texto completo y trigram, que no son opcionales, no tienen ese try/catch: una caída ahí tumba el turno completo. El plan trata "PostgreSQL no responde" como un solo caso; en la práctica hay dos rutas con comportamiento actual distinto.

5. **"Sin saldo en fal.ai" no tiene una señal distinguible hoy.** `falResponseError` no inspecciona código de estado ni cuerpo para diferenciar "sin saldo" de "solicitud inválida" o "rate limit". Cumple el mínimo de "no fabrica éxito" pero no "error estable" identificable por un operador.

6. **Ausencia de idempotencia en fal.ai es un riesgo directo para cualquier prueba de 5.4, no solo un dato del Anexo B.** El Anexo B ya documentó que no se envía clave de idempotencia a fal.ai. El plan de Fase 5 no conecta ese hallazgo con el invariante 7 al diseñar la prueba de "proveedor sin saldo": simularla con reintentos reales contra el proveedor de pago duplicaría un cargo. Debe quedar como restricción explícita del criterio de aceptación de 5.4.

7. **El pool de Postgres sin límites (capítulo 4.3) es la causa técnica directa detrás del hueco de 5.4 en Postgres.** `src/lib/rag/db.ts:12` sigue sin `max`, timeouts ni `statement_timeout`. Sin `connectionTimeoutMillis`, "Postgres no disponible" no falla rápido — la prueba de degradación de 5.4 no puede distinguir "caído y lo sabemos en 200ms" de "caído y lo descubrimos a los 30s". No está en el alcance formal de 5.4 pero es prerrequisito práctico.

---

## 6. Preguntas abiertas

1. **¿Contra qué copia se ejecuta el restore de 5.2?** Branch de Neon, `pg_dump`/`pg_restore` local, o Postgres Docker desechable — la respuesta cambia el esfuerzo en un orden de magnitud.
2. **¿Qué tablas comerciales se consideran "reproducibles desde fuente" y quién lo decide?** Si 5.2 solo prueba restore sobre el catálogo (lo más fácil), no habría probado nada sobre lo que realmente se perdería sin backup (`plan_audit_log`, `ai_call_log`, `lora_training_runs`, embeddings).
3. **¿`021_ai_call_log.sql` se commitea antes o después de que arranque 5.1?** Cambia el universo y la lista exacta de 5.1. Lo mismo aplica a los otros 38 archivos con cambios sin commitear.
4. **¿Cómo se simulan "proveedor caído" y "sin saldo" en 5.4 sin llamar a proveedores reales?** Hace falta decidir el mecanismo de inyección de fallos (interceptar `fetch`, flag de test, servidor falso local) antes de escribir la primera prueba.
5. **¿La consolidación de flags de 5.3 cambia el default de `IMAGE_QA_ENABLED` a `false`, o solo lo hace explícito manteniendo `true`?** El plan pide que no quede ningún flag activo por omisión sin decisión escrita, pero no dice cuál debe ser esa decisión.
6. **¿Quién verifica, por cada fila `succeeded`/activa en `lora_training_runs`, que existe una copia local con hash coincidente en algún `data/lora-backup/`?** Hoy no hay script que automatice ese cruce.
7. **¿El registro único de capacidades de 5.3 vive en el repo Next, o anticipa la frontera con el linaje Python de `operational.*` (capítulo 10.5)?** Si termina incluyendo `PYTHON_BACKEND_ENABLED`/`KILL_SWITCH`, hay que decidir explícitamente si eso viola la separación de linajes que la Fase 6 todavía no cerró.

---

## Archivos críticos para la implementación

- `scripts/migrate.ts`
- `scripts/migrations/` — los 19 archivos sin nota `-- rollback:`, especialmente `013_plan_audit_chain.sql` y `019_happie_webhook.sql` por carecer de cabecera descriptiva
- `src/lib/ia/feature-flags.ts`
- `src/lib/ia/image-qa.ts`
- `src/lib/rag/retrieval/search.ts`
- `src/lib/lora/snapshot.ts`
- `scripts/recibir-lora.ts`
- `docs/operations/rag-rollback-v2.md`

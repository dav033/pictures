# Auditoría previa — Fase 3 (Optimización de la interacción con Gemini, en TypeScript)

**Alcance:** los 13 puntos de Fase 3 del `PLAN-MAESTRO-V2.md`, verificados contra el código real del checkout en `C:\Users\davidt\Downloads\demo-decoracion`.

**Método:** solo lectura. No se ejecutó ningún script, evaluación, migración, Docker ni llamada a proveedor. Toda cifra de latencia/coste está marcada como **no medida** salvo que el propio plan la marque como medida.

**Nota de metodología:** el capítulo 13.3 del plan especifica `openai/gpt-5.6-luna` variante `xhigh` como modelo auditor. Esta auditoría se produjo con un subagente Claude (`Plan`, sin herramientas de escritura) porque la cuenta OpenAI usada por `opencode` alcanzó su tope de uso (`Error: The usage limit has been reached`, confirmado en tres intentos independientes) el 2026-09-08. Desviación autorizada explícitamente por el usuario en la misma sesión. El formato de seis secciones y las reglas de solo-lectura/cero-proveedores-pagados de 13.2/13.3 se preservaron sin cambios.

**Hallazgo transversal que condiciona todo lo demás:** el árbol de trabajo tiene **cambios sin commitear** sobre la rama `fase-1/medicion-y-migraciones-seguras` (`git status` muestra 29 archivos modificados y varios nuevos, entre ellos `src/lib/ia/telemetria-llamadas.ts`, `scripts/migrations/021_ai_call_log.sql`, `scripts/bench-ia/`, `.github/workflows/checks.yml`). Esos cambios implementan de facto buena parte de la Fase 1.4, la Fase 1.5 y la Fase 2.1–2.3 que el plan marca como "Pendiente". Esto no es objeto de esta auditoría (que es de la Fase 3), pero **cambia las referencias `archivo:línea`** que la Fase 3 cita, porque varias caen en archivos que esas ediciones ya tocaron. Se documenta en la sección 1 y se retoma en "Preguntas abiertas".

---

## 1. Verificación de evidencia

Verificado contra dos estados: **HEAD** (`878b66a`/`25b872d`, lo que hay commiteado) y el **árbol de trabajo actual** (con los cambios sin commitear descritos arriba). Cuando ambos coinciden se marca una sola fila.

| Cita del plan | Estado en HEAD | Estado en árbol de trabajo actual | Veredicto |
|---|---|---|---|
| `src/app/api/chat/route.ts:204-230` (imágenes solo en el último mensaje) | Coincide exactamente | Coincide exactamente (el diff sin commitear solo añade un bloque `telemetria: {...}` a partir de la línea 253, después de esta zona) | **Vigente, sin cambio de línea** |
| `src/app/api/chat/route.ts:147-153` (límite de 25 MB de body) | Coincide | Coincide | **Vigente** |
| `src/app/api/chat/route.ts:174-231` (anexo A, preparación del turno) | Coincide | Coincide | **Vigente** |
| `packages/agente-core/src/gemini/chat.ts:27-41` (conversión de imágenes a `inlineData` en cada llamada) | Coincide exactamente: `historialAContents`, bucle de imágenes en líneas 27-41 | **Se movió.** El árbol de trabajo inserta 18 líneas nuevas al principio del archivo (tipo `MetadatosUsoGemini` + función `extraerUsoGemini`, para `thoughtsTokenCount`/`toolUsePromptTokenCount` — Fase 1.5). La misma lógica hoy vive en **líneas 42-58** (bucle de imágenes en 50-58) | **Vigente en contenido, movida ~18 líneas** |
| `packages/agente-core/src/gemini/chat.ts:122-130,126` (instancia de `GoogleGenAI` por llamada, dentro de `cliente()`) | Coincide: `cliente()` en 123-126 | **Se movió** a líneas 145-148 por el mismo desplazamiento de 18 líneas | **Vigente en contenido, movida** |
| `packages/agente-core/src/historial-chat.ts:3,13-18` | Coincide exactamente, archivo no tocado por el WIP | Igual | **Vigente, sin cambio** |
| `src/lib/rag/chat/buscar-presupuesto.ts:17-26` (tipo `PoolItemPresupuesto` con campo `imagen`) | Coincide exactamente | Archivo no está en el diff sin commitear | **Vigente, sin cambio** |
| `src/lib/rag/chat/buscar-presupuesto.ts:235-247,249-274,290-302` (consulta trae todas las variantes del producto y arma `pool_por_rol` con `imagen`) | Coincide exactamente línea a línea | Igual | **Vigente, sin cambio** |
| `src/lib/rag/chat/buscar.ts:213-239` (consulta trae todas las variantes y filtra whitelist en JS) | Coincide exactamente; el propio código documenta en comentario (líneas 224-230) que esto ya se corrigió una vez por un bug de exactitud (mostrar variantes fuera de presupuesto), no por rendimiento | Igual | **Vigente, sin cambio** |
| `src/lib/ia/registro-herramientas.ts:385-400,402-434,461-472,474-509,527-561,582-602,611-635,810-836` | Todas coinciden exactamente, verificadas una a una | Archivo no está en el diff sin commitear | **Vigente, sin cambio en ninguna** |
| `src/lib/ia/image-qa.ts:95` (llamada sin `thinkingConfig`) | Coincide: `generateContent` sin `thinkingConfig`/`thinkingLevel` | **Se movió** a la línea ~97-107 (el WIP añade `import` de telemetría y una llamada `registrarGemini` antes/después de la petición), pero la ausencia de `thinkingConfig` **sigue siendo cierta**: el WIP instrumenta la llamada, no la optimiza | **Vigente en contenido, movida, y confirma que 3.3 sigue sin resolver** |
| `src/lib/gemini.ts:6` (`new GoogleGenAI` en cada `getGeminiClient()`) | Coincide exactamente | Archivo no tocado | **Vigente, sin cambio** |
| `src/lib/rag/db.ts:12` (`Pool` sin `max`/timeouts) | Coincide exactamente | Archivo no tocado | **Vigente, sin cambio** |
| `src/lib/rag/tamanos/resolver.ts:47-64` (`resolverVariantesPorDespiece`, un `SELECT` por llamada) | Coincide exactamente | Archivo no tocado | **Vigente, sin cambio** |
| `packages/agente-core/src/ejecutar.ts:56` (tope de 10 vueltas) | En HEAD el valor está en línea 53, no 56 (desajuste ya preexistente, menor) | En el árbol de trabajo el WIP añade telemetría con taxonomía `flujo`/`capacidad` (`registrarLlamadaIA`, tipo `FlujoIA`) y una función `bytesImagenes()`; el valor pasa a la **línea 63** | **Vigente en contenido, movida ~10 líneas respecto a HEAD y ~18 más allá de lo citado en el plan** |
| `packages/agente-core/src/ejecutar.ts:113-118,180-186,188-199` (ejecución serial de herramientas con `for...of`) | En HEAD el bucle no-stream está en 115-120 y el de stream en 191-198 (aproximado a lo citado) | En el árbol de trabajo, por la misma instrumentación, el bucle no-stream pasa a **157-162** y el de stream a **253-260** | **Vigente en contenido, movida sustancialmente (~70 líneas en la versión stream)** |
| `packages/agente-core/src/ejecutar.ts:115-120` (citado en 4.0.1, "los handlers construyen un payload rico...") | La cita es floja incluso en HEAD: en esas líneas está el bucle serial que empuja el resultado del handler al historial, no la construcción del payload en sí (eso vive en `registro-herramientas.ts`) | Se movió igual que arriba | **Cita imprecisa desde el origen; el hallazgo en sí (mismo objeto para UI y para el modelo) es correcto y vive realmente en `registro-herramientas.ts`, no en `ejecutar.ts`** |
| `src/lib/happie/webhook-control.ts:173-175` (`respond` usa `Response.json` directo, sin `schema_version`) | Coincide: función `respond` en 173-176 | El WIP añade 2 líneas para propagar `x-correlation-id` al request interno (líneas 201-202), **no toca** `respond` | **Vigente, moviéndose solo +1 línea (173-176)** |
| `src/components/admin/MotorIATab.tsx:128-143` (tabla plana de telemetría) | Coincide exactamente | Archivo no tocado en el diff sin commitear (pero su fuente de datos, `salud.telemetria`, seguirá siendo el buffer en memoria hasta que se conecte a `ai_call_log`) | **Vigente, sin cambio de línea** |
| `src/app/page.tsx:153-155,955-956,994` (`EstadoHerramienta`, evento SSE `herramienta`, `cancelarChat`) | Coincide exactamente | Archivo no tocado | **Vigente, sin cambio** |

**Resumen:** ninguna cita de la Fase 3 apunta a algo que ya no exista o que diga algo distinto. Cinco (`gemini/chat.ts` ×2, `ejecutar.ts` ×2, `image-qa.ts` ×1) tienen el número de línea desplazado porque el árbol de trabajo tiene instrumentación de telemetría sin commitear encima del mismo archivo. Ninguna requiere reescribir el diagnóstico; todas requieren releer el offset exacto en el momento de tocar el archivo, porque **ese WIP puede commitearse antes de que empiece la Fase 3** y volver a mover las líneas.

---

## 2. Sigue en pie / ya no aplica / cambió de forma

| # | Entrega | Veredicto | Motivo |
|---|---|---|---|
| 3.1 | No reenviar imágenes inline en cada vuelta | **Sigue en pie, sin cambio de forma** | El WIP sin commitear añade una función `bytesImagenes(historial)` en `ejecutar.ts` que **mide** exactamente el desperdicio que 3.1 describe (recorre `historial`, suma bytes de `imagen.base64` de cada mensaje de usuario) y lo emite en cada evento de telemetría por vuelta. Es evidencia adicional de que el problema es real y ahora medible, pero **no lo corrige**: la imagen sigue en el array `historial` durante todas las vueltas y `bytesImagenes()` la va a seguir contando (el mismo número) vuelta tras vuelta hasta que 3.1 se implemente. |
| 3.2 | Proyección compacta de resultado de herramienta | **Sigue en pie, sin cambio de forma** | `buscar-presupuesto.ts` sigue devolviendo `imagen` en `pool_por_rol` y no hay ninguna separación modelo/UI en el código verificado. |
| 3.3 | `thinkingLevel` en `observarImagenGenerada` | **Sigue en pie, sin cambio de forma** | El WIP instrumenta esta llamada con telemetría (`registrarGemini`, capacidad `qa_visual`) pero **no le añade `thinkingConfig`**. Es una constatación útil: cuando 3.3 se active, ya habrá una fila de telemetría con `thinking_level` vacío/`default` contra la que comparar el "después". |
| 3.4 | Filtrar variantes en SQL, no en JS | **Sigue en pie, sin cambio de forma** | Confirmado en `buscar.ts` y `buscar-presupuesto.ts`. El comentario en `buscar.ts:224-230` deja claro que hay una restricción de *corrección* (whitelist de precio/disponibilidad) montada sobre el mismo patrón; cualquier fix de 3.4 tiene que preservar esa whitelist exacta, no solo el rendimiento. |
| 3.5 | Batch de `resolverVariantesPorDespiece` | **Sigue en pie, sin cambio de forma** | Confirmado el N+1: un `SELECT` por ítem `usar_despiece`, llamado dentro del `for` de `confirmar_seleccion_rag`. |
| 3.6 | Reutilizar `GoogleGenAI` | **Sigue en pie, sin cambio de forma** | `crearChatGemini` sigue creando el cliente dentro de `cliente()`, invocado en cada `turno()`/`turnoStream()`. `src/lib/gemini.ts` y el parser/embeddings hacen lo mismo, cada uno con su propia fábrica. |
| 3.7 | Pool PostgreSQL con `max`/timeouts | **Sigue en pie, sin cambio de forma** | `src/lib/rag/db.ts:12` sin cambios. |
| 3.8 | Outbox para INSERT/UPDATE de observabilidad | **Sigue en pie, pero con un patrón de referencia ya construido que el plan no cita** | Los tres INSERT/UPDATE que 3.8 señala (`registrarBusqueda`, `registrarSeleccion`, `registrarPlanAudit`, todos en `src/lib/rag/observability/log.ts` vía `pool.query` directo) **siguen síncronos en la ruta crítica**, sin cambio. Pero el WIP de Fase 1.5 ya implementó un patrón fire-and-forget con manejo de errores para el registro de `ai_call_log` — `registrarLlamadaIA` en `packages/agente-core/src/telemetria.ts:150-171`: no bloquea al caller (`void`), atrapa el rechazo de la escritura (`.catch(() => undefined)`), y mantiene un `Set` de promesas pendientes (`pendientes`) con un `drenar()` para tests/cierre. Es exactamente la forma que 3.8 pide para su outbox, ya viva en el repo. Ver sección 5. |
| 3.9 | Herramientas de solo lectura en paralelo | **Sigue en pie, sin cambio de forma** | Confirmado `for...of` con `await` secuencial en ambas variantes (`ejecutarConversacion` y `ejecutarConversacionStream`). |
| 3.10 | Truncado de historial por tokens, no caracteres | **Sigue en pie, sin cambio de forma** | `historial-chat.ts` sin cambios. |
| 3.11 | Honestidad estructural en la UI | **Sigue en pie, sin cambio de forma; confirmado que hoy no existe en absoluto** | Se buscó `filtro_relajado`, `match_level`, `sustituciones`, `rechazados` en `src/app/page.tsx`: no aparecen. `sin_cobertura` sí se usa, pero solo para **deshabilitar el botón de generar**, no como elemento de honestidad visible ("2 tamaños sustituidos"). El backend sigue devolviendo estos campos en `registro-herramientas.ts`, listos para consumirse. |
| 3.12 | Pantalla de consumo de IA por flujo | **Cambió de forma: su prerrequisito de datos ya casi existe** | `MotorIATab.tsx` sigue siendo la tabla plana descrita, sin cambio propio. Pero el WIP sin commitear ya cablea `flujo`/`capacidad` en prácticamente **todas** las llamadas de IA del sistema (chat, parser, embeddings, QA visual, generación Gemini/fal.ai, análisis de referencias, Happie recomendador y conversación — ver sección 5), que es justo el dato que 11.3/9.4 necesitan para las tarjetas por flujo. 3.12 sigue siendo trabajo de UI puro, pero su bloqueador de datos puede estar mucho más cerca de resuelto de lo que el plan asume. |
| 3.13 | Rutas de control de Happie sobre contrato | **Sigue en pie, sin cambio de forma** | `webhook-control.ts:respond` sigue usando `Response.json` directo. El WIP solo añade propagación de `x-correlation-id` al request interno, sin relación con el contrato de error. `respuestaWebhook`/`HappieErrorV1Schema` siguen viviendo únicamente en `recomendar-paquetes-webhook.ts`. |

---

## 3. Riesgo y esfuerzo por entrega

Cualitativo. "Invariante" remite a la numeración del capítulo 6 del plan.

| # | Riesgo | Esfuerzo | Invariante que podría romper si se hace mal |
|---|---|---|---|
| 3.1 | Medio-alto: toca el transporte multimodal que ve el modelo en cada vuelta; un error deja al modelo "ciego" a la foto a mitad de conversación, difícil de detectar en pruebas manuales porque el turno 1 siempre funciona | Medio: superficie angosta (`historialAContents`, quizás el tipo `Mensaje`), pero exige decidir un mecanismo (referencia reutilizable vs. deduplicación por posición) y probarlo contra cancelación/expiración | Ninguno directamente, pero linda con el invariante 4 (honestidad al sustituir): si el modelo "olvida" la foto de referencia, puede inventar una sustitución sin decirlo |
| 3.2 | Medio: la proyección compacta puede omitir por accidente un campo que el modelo necesita para redactar honestamente (`sku`, `precio`, `match_level`) | Medio: exige enumerar campo por campo qué usa el modelo (redacción) frente a qué usa solo la UI, y mantener el objeto completo para UI/telemetría en paralelo | Invariante 4 directamente: `pool_por_rol`/`canasta` alimentan las reglas de "HONESTIDAD AL SUSTITUIR" del prompt |
| 3.3 | Bajo: extracción a schema cerrado, mismo patrón que el parser donde `MINIMAL` ya se midió 12/12 estable | Bajo: una línea de config | Ninguno. Es la entrega de menor riesgo de las 13 |
| 3.4 | Medio: la whitelist de variantes hoy se aplica en JS y ya existe un precedente de bug real de exactitud resuelto ahí mismo (comentario en `buscar.ts:224-230`); mover el filtro a SQL sin replicar exactamente esa lógica puede reintroducir ese bug | Medio: reescribir el `WHERE`/`JOIN` conservando semántica exacta, con fixtures de regresión antes/después | Invariante 2 indirectamente: si el filtro SQL es más laxo que el de JS, puede exponer variantes que no pasaron el filtro duro del retrieval |
| 3.5 | Medio: cruzar variantes entre familias de producto por un `WHERE product_id = ANY(...)` mal acotado | Medio: agregar pares `(productId, whitelist)` y resolver con una consulta que agrupe por producto | Ninguno directamente, pero descuidarlo puede asignar tamaño de un producto a otro |
| 3.6 | Bajo-medio: compartir una instancia mutable entre requests con distinta `apiKey`/modelo si el registro los permite variar en runtime | Bajo: singleton con clave de caché por `apiKey+modelo` | Ninguno. Riesgo operativo, no comercial |
| 3.7 | Bajo | Bajo: parámetros de configuración de `pg.Pool` | Ninguno. Es robustez, no toca autoridad ni comportamiento del modelo |
| 3.8 | Medio: mover el registro fuera de la ruta crítica no puede perder trazabilidad si el proceso muere antes de despachar (más relevante en runtime serverless con `maxDuration` corto) | Medio-alto si se construye desde cero; **bajo si se reutiliza el patrón ya existente en `telemetria.ts`** | Ninguno de comercio, pero si la trazabilidad de plan/selección se pierde de forma silenciosa, compromete la capacidad de auditar después una decisión de sustitución |
| 3.9 | Medio: exige marcar handlers explícitamente como "solo lectura, sin efectos" — el propio plan dice que esto no se puede inferir | Medio: cambiar `for...of` por `Promise.all` solo para el subconjunto marcado, preservando el orden de escritura en el historial | Invariante 2 y 7 si un handler de escritura se marca por error como paralelizable |
| 3.10 | Bajo: cambiar de caracteres a tokens es un cambio de medida, no de lógica; el riesgo está en decidir qué se descarta cuando se corta | Bajo-medio: requiere un tokenizador o aproximación, y decidir si el `base64` cuenta como bytes de imagen (aparte) o como "tokens" | Ninguno directo |
| 3.11 | Bajo: es aditivo, no cambia lo que el modelo hace | Medio: requiere UI nueva (chips/badges) y decidir la fuente de verdad (el JSON de la tool, no el texto del modelo) | Ninguno — de hecho reduce el riesgo del resto de la etapa |
| 3.12 | Bajo: es una vista sobre datos ya existentes o casi existentes | Medio-alto si `ai_call_log` (Fase 1.5) no está terminado; bajo si ya lo está | Ninguno |
| 3.13 | Bajo: mover una función pura de un archivo a otro, sin cambiar su comportamiento salvo añadir `schema_version` | Bajo-medio: evitar el ciclo de imports que `AGENTS.md` prohíbe — la dirección correcta es que `recomendar-paquetes-webhook.ts` importe de `webhook-control.ts`, no al revés | Ninguno de los 8; cubierta por `happie:test-webhook` |

---

## 4. Orden propuesto dentro de la fase

**Coincide con el plan para arrancar (3.1 y 3.2 primero)**, con una variación propuesta para el resto:

1. **3.1 y 3.2** — como fija el plan (capítulo 8.4). Mayor desperdicio verificado, scopes de archivo disjuntos entre sí (`route.ts`/`chat.ts` vs. `buscar-presupuesto.ts`/`registro-herramientas.ts`).
2. **3.11 antes que 3.4, 3.5, 3.8, 3.9** (diferencia respecto al plan, que la deja en posición 11 de 13). El propio plan da la razón que no aplica a su propio orden: "baja el riesgo de tocar el razonamiento del modelo". 3.4/3.5/3.8/3.9 tocan exactamente las rutas de retrieval/selección/plan cuyos campos de honestidad 3.11 expone.
3. **3.3** — cualquier momento tras 3.1/3.2; recomendada temprana (posición 3-4) por su relación beneficio/esfuerzo.
4. **3.4, luego 3.5** — mismo orden que el plan; comparten la necesidad de fixtures de regresión sobre selección de variantes.
5. **3.6 y 3.7** — en cualquier punto intermedio, bajo riesgo, sin dependencias.
6. **3.8** — después de 3.4/3.5, no antes: reutilizar `telemetria.ts` en vez de outbox nuevo.
7. **3.9** — al final de las que tocan `ejecutar.ts`/`registro-herramientas.ts`.
8. **3.10** — después de 3.1 (mismo archivo `historial-chat.ts`).
9. **3.12** — después de que 3.1/3.2/3.3 tengan datos reales en `ai_call_log`.
10. **3.13** — sin dependencia de nada más; puede ir en cualquier momento, incluso en paralelo.

**Diferencia explícita respecto al plan:** adelantar 3.11 (posición 11 → posición 3).

---

## 5. Lo que el plan no vio

1. **Ya existe un patrón de escritura no bloqueante y tolerante a fallos que 3.8 puede reutilizar en vez de construir desde cero.** `registrarLlamadaIA` (`packages/agente-core/src/telemetria.ts:150-171`, WIP) ya hace lo que 3.8 pide: no bloquea al caller, atrapa el rechazo de la escritura, mantiene un registro de promesas pendientes con drenaje para tests/cierre. Generalizarlo baja el esfuerzo de 3.8 de "medio-alto" a "bajo-medio".

2. **La medición que Fase 3.1 necesita para su "antes/después" puede que ya exista, sin commitear.** `bytesImagenes(historial)` en `ejecutar.ts` (WIP) calcula los bytes de imagen enviados por vuelta y ya se emite en telemetría (`bytesImagenEntrada`). Si se commitea antes de 3.1, la comparación antes/después queda gratis vía `ai_call_log`.

3. **La cobertura de telemetría por capacidad (capítulo 9.5) ya está casi completa en el WIP, no en 2 de 11 como narra el capítulo 9.1.** Verificado cableado en: `ejecutar.ts` (chat_turno), `query-parser/parse.ts` (parser_intencion), `embeddings.ts` (embedding_consulta), `image-qa.ts` (qa_visual), `gemini/imagen.ts` (imagen_generacion), `analizar-referencias-v2.ts` (análisis inventario/auditoría), `sempertex-lora.ts` (LoRA fal.ai), `conversacion-webhook.ts` (happie_conversacion). Solo `recomendador.ts` (happie_recomendacion) no se pudo confirmar con la misma certeza en el tiempo de esta auditoría. Impacta la premisa de partida del capítulo 9.1 y el criterio de aceptación de 1.5.

4. **`webhook-control.ts` ya empezó a moverse cerca de 3.13 sin resolverla** — el WIP añade propagación de `x-correlation-id` en las líneas 201-202 del mismo archivo cuya función `respond` (173-176) es el objetivo de 3.13. Riesgo de colisión de merge en una zona de 30 líneas si no se coordina.

5. **El campo `vuelta` se emite para `chat_turno` pero no para las llamadas dentro de una herramienta** (`buscar_catalogo_rag`, `confirmar_seleccion_rag`, etc.). Esas llamadas usan su propio `requestId` de RAG (`estado.ragRequestId`), distinto del de telemetría IA — hoy no hay forma de unir "esta vuelta del chat_turno" con "esta búsqueda RAG que ocurrió durante esa vuelta".

6. **`MotorIATab.tsx` seguirá mostrando ceros o datos parciales aunque el WIP de telemetría se commitee completo**, porque lee de `salud.telemetria` (buffer en memoria), no de `ai_call_log`. 3.12 necesita además cambiar la fuente de datos del panel admin — trabajo no mencionado explícitamente en ninguna entrega de la Fase 3.

7. **El comentario en `buscar.ts:224-230` es evidencia de un incidente de exactitud previo exactamente en la zona que 3.4 quiere tocar** (mostrar/cotizar una variante fuera del filtro de precio/disponibilidad). El plan lo trata como riesgo genérico de rendimiento; el riesgo real es reintroducir un bug ya corregido ahí.

---

## 6. Preguntas abiertas

1. **¿Qué hacer con el WIP sin commitear de Fase 1.4/1.5/2.1-2.3 antes de empezar la Fase 3?** Toca directamente `ejecutar.ts` y `gemini/chat.ts`, los dos archivos centrales de 3.1.
2. **¿El arnés `npm run ia:bench` cumple el criterio de aceptación de Fase 1.4** ("reproduce las cifras del capítulo 3 con ±15%")? No verificable en auditoría de solo lectura sin ejecutar proveedor.
3. **Para 3.1: ¿deduplicación por ID de imagen dentro del mismo `historial`, o una referencia real del proveedor (`fileData`/upload)?** El plan deja ambas abiertas; tienen esfuerzo e invariantes de ciclo de vida distintos.
4. **Para 3.2: ¿en qué punto del flujo se bifurcan "proyección para modelo" y "proyección para UI"?** Hoy no hay separación modelo/UI en ningún handler de `registro-herramientas.ts`; introducirla es el primer punto de bifurcación explícito del código de chat.
5. **¿La telemetría por herramienta (`herramienta`) se implementa como parte de 3.2 o queda para después?** El tipo `EventoLlamadaIA` ya tiene el campo pero no se encontró call site que lo rellene desde `registro-herramientas.ts`.
6. **¿Qué pasa con la protección de rama de `main` (Fase 2.5) antes de que la Fase 3 empiece a mergear cambios?** Sigue sin poder verificarse (`gh` no disponible en este entorno tampoco).
7. **¿`bytesImagenes()` deduplica cuando la misma `IMAGEN_ID` aparece en varios mensajes del mismo historial?** No verificado; si no deduplica, podría sobre-contar antes del fix de 3.1.

---

## Foco para el implementador — Fase 3.1 y Fase 3.2

### Fase 3.1 — no reenviar imágenes en cada vuelta del loop

**Estado real: sin implementar, confirmado en HEAD y en el árbol de trabajo.**

- `src/app/api/chat/route.ts:204-219` adjunta `fotoEspacio`/`imagenesReferencia` **solo al último mensaje de usuario** — eso ya es correcto, no hay re-adjunción por turnos anteriores.
- El problema real está en `packages/agente-core/src/gemini/chat.ts`, función `historialAContents` (líneas 42-58 en el árbol de trabajo actual, 27-41 en HEAD): se invoca de nuevo, desde cero, en **cada** llamada a `turno()`/`turnoStream()`, sobre el mismo array `historial` acumulativo. El mensaje de usuario con `imagenes` nunca se muta ni se limpia entre vueltas.
- `limitarHistorialChat` (`src/lib/ia/historial-chat.ts:13-18`) sigue sin contar `base64` en su presupuesto. Único control real de tamaño: el límite de 25 MB de body HTTP, aplicado una sola vez a la entrada.
- **Novedad para el implementador:** ya existe, sin commitear, `bytesImagenes(historial)` en `ejecutar.ts`, que mide el tamaño real en bytes de las imágenes por vuelta y lo emite en telemetría (`bytesImagenEntrada`). Si ese WIP se commitea antes de 3.1, el "antes" de la medición queda listo gratis.
- **Punto de decisión pendiente:** no hay precedente de "referencia reutilizable de imagen" ni de "marcar mensaje como ya visto". La opción de menor esfuerzo y riesgo es no volver a incluir `inlineData` para una imagen ya vista en una vuelta anterior de la misma ejecución, conservando solo el texto `[IMAGEN_ID=...]` en vueltas siguientes — vía un flag transitorio en el propio objeto `Mensaje` que `historialAContents` respete, no un cambio de contrato con el proveedor.

### Fase 3.2 — proyección compacta de resultados de herramienta

**Estado real: sin implementar, confirmado en HEAD y en el árbol de trabajo (archivos no tocados por el WIP).**

- `PoolItemPresupuesto` (`src/lib/rag/chat/buscar-presupuesto.ts:17-26`) incluye `imagen: string | null`, propagado sin poda al `poolPorRol` que `buscar_catalogo_rag` devuelve al modelo (`registro-herramientas.ts:402-434,425`).
- Duplicación adicional confirmada: `canasta` repite título/precio/ids que también aparecen en `pool_por_rol` (`registro-herramientas.ts:406-424`).
- En `confirmar_plan_decoracion` (`registro-herramientas.ts:810-836`), `plan_id`/`plan_hash` (líneas 819-820) son candidatos adicionales de poda — sirven al cliente/backend, no a la redacción del modelo.
- **No hay hoy ninguna separación de tipos ni de función entre "resultado para el modelo" y "resultado para UI/telemetría"** en ningún handler de `registro-herramientas.ts`. El motor (`ejecutar.ts`) empuja el objeto tal cual al historial como `functionResponse`, y ese mismo historial se serializa hacia el cliente SSE. 3.2 probablemente necesita introducir el primer punto de bifurcación explícito modelo/UI del código de chat.
- **Campos que no se pueden tocar** (invariante 4): `matched_signals`, `relaxations`/`filtro_relajado`, `match_level`, `sustituciones`, `sin_cobertura`, `sku`/`variant_id`/precio/tamaño/disponibilidad de cada variante confirmable. La poda segura se limita a `imagen`, duplicados exactos entre `canasta` y `pool_por_rol`, y `plan_id`/`plan_hash`.

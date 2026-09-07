# Auditoría RAG/chat

Auditoría estática y de solo lectura del estado actual del repositorio. No se ejecutaron scripts, evaluaciones, proveedores externos ni consultas contra PostgreSQL remoto. Los conteos marcados como **inferidos** salen del código; no son mediciones de latencia.

## 1. Anatomía de un turno de chat

### Entrada y preparación

1. `POST` lee y valida el JSON, resuelve el proveedor, construye el prompt del sistema y convierte el historial de texto a mensajes neutrales. Si hay `loraMode` activo con RAG, resuelve además el allowlist contra PostgreSQL antes de abrir el stream (`src/app/api/chat/route.ts:174-231`). El ajuste global del proveedor usa SQLite, no PostgreSQL (`src/lib/ia/registro.ts:17-24`; `src/lib/db.ts:7-8,345-363`).
2. `chatDe` crea el adaptador de Gemini, pero el cliente `GoogleGenAI` se crea de forma diferida cuando se ejecuta cada vuelta (`src/lib/ia/registro.ts:70-74`; `packages/agente-core/src/gemini/chat.ts:127-138,174-176`).
3. El wrapper crea un estado nuevo por request/turno, obtiene las herramientas activas y llama al motor genérico con `vueltasMax = 10` (`src/lib/ia/ejecutar.ts:86-98,118-128`; `src/lib/ia/registro-herramientas.ts:169-185`).

### Bucle real

En cada vuelta el motor:

1. Hace exactamente una llamada lógica al adaptador `turnoStream`, que envía a Gemini el sistema, historial y declarations (`packages/agente-core/src/ejecutar.ts:141-160`; `packages/agente-core/src/gemini/chat.ts:183-197`).
2. Si Gemini no devuelve function calls, termina el turno (`packages/agente-core/src/ejecutar.ts:173-185`).
3. Si devuelve una o varias function calls, añade el mensaje de modelo al historial, ejecuta los handlers **secuencialmente**, añade cada resultado al historial y vuelve a llamar al modelo (`packages/agente-core/src/ejecutar.ts:188-199`). No hay un límite independiente para el número de function calls contenidas en una respuesta; se extraen todas las partes con `functionCall` (`packages/agente-core/src/gemini/chat.ts:76-86`).

### Mínimos y máximos

- **Mínimo, con proveedor configurado:** 1 llamada lógica de chat Gemini para una respuesta sin herramientas (`packages/agente-core/src/ejecutar.ts:81-109`). Si falta `GEMINI_API_KEY`, la llamada no llega al proveedor y el adaptador falla antes (`packages/agente-core/src/gemini/chat.ts:136-139,174-176`).
- **Máximo del loop de chat:** 10 llamadas lógicas de chat (`src/lib/ia/registro-herramientas.ts:63-72`; `packages/agente-core/src/ejecutar.ts:76-82,141-142`).
- **Intentos HTTP máximos del stream:** hasta 3 aperturas por cada vuelta cuando el error es reintentable; el reintento solo cubre la apertura y no los bytes ya emitidos (`packages/agente-core/src/retry.ts:20-33`; `packages/agente-core/src/gemini/chat.ts:178-197`). Por tanto, el techo del componente de chat es 30 intentos HTTP, no 30 respuestas lógicas.
- **Máximo global de llamadas de modelo:** no es un número finito determinable con el código. A las 1–10 llamadas de chat se suman llamadas opcionales del parser de intención, embeddings y búsquedas por slot; además, una respuesta puede contener un número no acotado de tools y cada `buscar_catalogo_rag` puede disparar su propio parser remoto (`src/lib/rag/query-parser/parse.ts:33-59`; `src/lib/rag/chat/buscar-presupuesto.ts:107-115`; `src/lib/rag/retrieval/by-scene-slot.ts:178-195`). El límite real queda impuesto por el tamaño/respuesta del proveedor, no por un contador de handlers.

### Qué ocurre según la herramienta

| Camino | Llamadas de modelo | PostgreSQL, inferido desde el código |
|---|---:|---|
| Respuesta directa, sin tool | 1 chat | 0 consultas PG del handler. |
| `guardar_brief`, `calcular_medidas`, `buscar_decoraciones` o una tool no RAG | 1 llamada que pide la tool + otra que consume el resultado, salvo corte/cancelación | Los dos primeros no consultan PG en sus handlers; `buscar_decoraciones` usa el catálogo SQLite (`src/lib/ia/registro-herramientas.ts:208-211,260-288,839-853`). |
| `buscar_catalogo_rag` normal, búsqueda no SKU, éxito, sin relajación, vector apagado y una query enfocada | 2 chat; +0 o +1 parser Gemini si el parse local es ambiguo | 2 ramas léxicas en paralelo, whitelist de variantes, demanda, evidencia de evento, detalle de candidatos y un INSERT de observabilidad: **7 consultas PG inferidas** (`src/lib/rag/retrieval/search.ts:523-542,569-577`; `src/lib/rag/chat/buscar.ts:212-221`; `src/lib/rag/observability/log.ts:48-82`). |
| Mismo camino con vector activo | Igual | Añade una consulta vectorial PG y un embedding Gemini; el total base pasa a **8 consultas PG inferidas**, sin contar posibles relajaciones (`src/lib/rag/retrieval/search.ts:544-556,361-381`). |
| Búsqueda normal con relajación | Igual o más vueltas de chat según el modelo | Cada escalón vuelve a invocar `buscarHibrido`; la primera búsqueda puede consumir las dos ramas y la siguiente repite el pipeline (`src/lib/rag/chat/buscar.ts:177-205`). |
| `buscar_catalogo_rag` con franja | 2 chat por cada respuesta de tool, + parser Gemini opcional, +1 embedding Gemini opcional | Hasta 5 roles y hasta 5 intentos secuenciales por rol si todas las condiciones de relajación se activan; cada intento llama `buscarHibrido` (`src/lib/rag/presupuesto/franjas.ts:14-18`; `src/lib/rag/retrieval/por-rol.ts:76-133,147-184`). Hay además una consulta de detalle conjunta y un INSERT de observabilidad (`src/lib/rag/chat/buscar-presupuesto.ts:235-245,309-331`; `src/lib/rag/observability/log.ts:48-82`). |
| `confirmar_seleccion_rag` | Normalmente una vuelta con la tool y una final | Una consulta por cada ítem `usar_despiece`, una consulta conjunta de validación, un INSERT de selección y un UPDATE de búsqueda (`src/lib/ia/registro-herramientas.ts:527-565,582-602`; `src/lib/rag/tamanos/resolver.ts:47-64`; `src/lib/rag/chat/validar.ts:146-163`; `src/lib/rag/observability/log.ts:98-105,122-127`). Esto es un N+1 potencial por número de productos/colores con despiece. |
| `confirmar_plan_decoracion` | Una o varias vueltas de diseño + una vuelta que consume el plan, por cada reintento del modelo | Una consulta conjunta para catálogo/variantes, más INSERT de auditoría y UPDATE de resultado; si `SCENE_PLAN_V2_SHADOW` está activo, además espera todo el retrieval por slots antes de resolver (`src/lib/ia/registro-herramientas.ts:711-737,741-809`; `src/lib/plan/resolver.ts:344-373`; `src/lib/rag/observability/log.ts:165-195`). |

El stream no abre la respuesta HTTP hasta crear el generador, pero la primera llamada al proveedor ocurre dentro de `ReadableStream.start`; cada espera tiene además un timeout local absoluto (`src/app/api/chat/route.ts:241-289`).

## 2. Coste de entrada por vuelta

En **cada** llamada lógica a Gemini se vuelve a construir y enviar:

| Componente reenviado | Evidencia | Estimación estática en caracteres | Igual entre vueltas |
|---|---|---:|---|
| Prompt base y bloques activos | `construirSistema` concatena base, selección, RAG, franjas, plan, referencia, allowlist y brief (`src/lib/ia/prompt-sistema.ts:184-203`) | RAG + plan sin referencia: aproximadamente **22.000–30.000**; depende de los strings activos. **Inferido, no medido.** | Sí dentro del request, salvo que el código externo cambie el estado. |
| Declarations JSON de herramientas | Se pasan todas las herramientas activas en cada `turnoStream` (`packages/agente-core/src/gemini/chat.ts:185-193`; `src/lib/ia/registro-herramientas.ts:50-60`) | Aproximadamente **12.000–20.000** para RAG + plan por descripciones y schemas. **Inferido, no medido.** | Sí en todas las vueltas del request. |
| Historial inicial | El route recorta texto y lo convierte una vez en historial neutral (`src/app/api/chat/route.ts:220-231`; `src/lib/ia/historial-chat.ts:6-23`) | Hasta **16.000** caracteres de texto, salvo que el mensaje más reciente individual exceda el límite (`src/lib/ia/historial-chat.ts:3,13-19`). | Sí: el prefijo inicial reaparece en cada vuelta. |
| Imágenes inline | La última entrada de usuario conserva `base64`; Gemini la transforma en `inlineData` en cada conversión del historial (`src/app/api/chat/route.ts:200-230`; `packages/agente-core/src/gemini/chat.ts:27-41`) | Sin cota propia en `limitarHistorialChat`; puede ser desde cientos de KB hasta varios MB por imagen. El límite de body HTTP es 25 MB, no el límite de prompt por vuelta (`src/app/api/chat/route.ts:147-153`). | Sí en cada vuelta: no se elimina después de la primera llamada. |
| Resultado y llamada de cada tool ya ejecutada | El motor añade la llamada de modelo y el resultado al historial (`packages/agente-core/src/ejecutar.ts:188-199`) y `historialAContents` los vuelve `functionCall`/`functionResponse` (`packages/agente-core/src/gemini/chat.ts:43-69`) | Variable. Un candidato normal suele añadir cientos de caracteres; una búsqueda RAG con variantes o una canasta puede añadir varios KB. **Inferido, no medido.** | Cada vuelta posterior repite todo lo acumulado. |

La duplicación principal es, por tanto, acumulativa: vuelta `n` repite el prompt, declarations, historial de usuario, imágenes, todas las llamadas y todos los resultados de vueltas `1..n-1`. No existe una representación compacta del transcript ni un mecanismo de caché de contexto en el adaptador; cada llamada usa `generateContentStream` con el array completo (`packages/agente-core/src/gemini/chat.ts:183-197`).

La estimación de 16.000 caracteres no representa el coste multimodal real: el truncador solo suma `message.content.length` y no cuenta `base64` (`src/lib/ia/historial-chat.ts:13-18`). Esto hace que una petición con imágenes pueda cumplir el límite textual y aun así repetir una carga muy grande en todas las vueltas.

## 3. Resultados de herramientas

Los tamaños siguientes son proyecciones de `JSON.stringify`, no mediciones en producción. El tamaño exacto depende de nombres, arrays, número de variantes y descripciones.

| Handler | Forma del JSON que recibe el modelo | Orden de magnitud inferido | Campos candidatos a poda |
|---|---|---:|---|
| `guardar_brief` | `ok` + el brief completo (`src/lib/ia/registro-herramientas.ts:208-211`) | Decenas a cientos de caracteres | El brief completo duplica el contexto del sistema cuando no hubo cambios; podría devolverse solo el delta y un estado resumido, preservando los campos nuevos que el modelo necesita. |
| `buscar_catalogo` | Total, flags de demasiados resultados, tipos y productos con id, nombre, categoría, colores, ocasiones, tags, precio, unidades y disponibilidad (`src/lib/ia/registro-herramientas.ts:217-245`) | 250–500 por producto, más arrays. Con 8 productos: ~2–5 KB. **Inferido.** | En modo legado, `tags` solo es necesario para una búsqueda posterior; puede mantenerse si la instrucción realmente permite refinar por tags. `filtro_relajado` sí es necesario para honestidad. |
| `consultar_disponibilidad` | Un objeto por id con id, nombre y disponibilidad (`src/lib/ia/registro-herramientas.ts:248-257`) | ~80–150 por variante. **Inferido.** | Poco margen; el nombre ayuda a redactar y los tres campos son funcionales. |
| `calcular_medidas` | Figura, eje, despiece completo, total, supuestos, confianza y aviso (`src/lib/ia/registro-herramientas.ts:260-288`) | ~500–2.000 según número de líneas. **Inferido.** | `eje_m` o detalles repetidos podrían resumirse solo si no afectan a la explicación; `despiece`, `supuestos`, confianza y aviso son necesarios para seleccionar y comunicar límites. |
| `cotizar` | Todas las líneas, total, merma e IVA (`src/lib/ia/registro-herramientas.ts:291-301`) | ~300–2.000. **Inferido.** | Las líneas son necesarias para explicar paquetes/sobrantes; no hay poda segura clara sin cambiar el contrato. |
| `confirmar_seleccion_ia` | `ok`, contador, piezas con nombre/categoría/colores/unidades y fase (`src/lib/ia/registro-herramientas.ts:303-327`) | ~150–300 por pieza. **Inferido.** | La `fase` fija y el `ok` son compactos. Hay una inconsistencia: la descripción promete precio y `total_aproximado`, pero el handler no los devuelve (`src/lib/ia/herramientas.ts:213-215`; `src/lib/ia/registro-herramientas.ts:311-327`). No conviene optimizarla podando sin antes decidir cuál contrato es correcto. |
| `buscar_catalogo_rag` normal | Status, SKU status, filtro relajado, evento y candidatos; cada candidato incluye atributos y cada variante id/SKU/título/precio/disponibilidad/tamaño/diámetro/forma/colores (`src/lib/ia/registro-herramientas.ts:474-509`) | ~300–700 por producto + ~120–300 por variante; 15 productos con 2–3 variantes pueden ser ~6–15 KB. **Inferido.** | `matched_signals` y `relaxations` son necesarios para honestidad de evento/sustitución; `sku`, variant id, precio, tamaño, forma y disponibilidad son necesarios para confirmar. `imagen` no se devuelve aquí, por lo que ya no añade coste al modelo. |
| `buscar_catalogo_rag` con presupuesto | Franja, canasta, pool por rol, relajaciones, conflictos y evento (`src/lib/ia/registro-herramientas.ts:402-434`) | Puede superar **6–15 KB**: hasta 8 candidatos por cada rol activo y, además, la canasta repite título, precio e ids. **Inferido.** | `imagen` del pool no es utilizable por el modelo de texto y es candidato claro a eliminar (`src/lib/rag/chat/buscar-presupuesto.ts:17-26,290-302`). La canasta y `pool_por_rol` contienen duplicación deliberada para explicar/intercambiar; conviene entregar al modelo una proyección compacta y reservar el payload completo para UI/telemetría. |
| `confirmar_seleccion_rag` | Validados, rechazados, sustituciones, sin cobertura, fase y datos de franja/presupuesto (`src/lib/ia/registro-herramientas.ts:611-635`) | ~300–3.000, dominado por motivos y listas. **Inferido.** | `sku` y `titulo` son útiles para el resumen; `fase` es fija y puede ser una instrucción interna, aunque quitarla exige revisar el prompt. |
| `confirmar_plan_decoracion` | Estructuras, total, sustituciones, cobertura, advertencias, comercial, alternativas, fase y cotización (`src/lib/ia/registro-herramientas.ts:810-836`) | ~2–10 KB según estructuras/alternativas. **Inferido.** | `plan_id` y `plan_hash` sirven al cliente/backend pero no parecen necesarios para redactar el resumen; pueden eliminarse de la proyección para Gemini si se conserva el resultado completo en el estado/UI. `fase` es constante. |
| `buscar_decoraciones` | Total y por decoración id, nombre, descripción y nombres de elementos (`src/lib/ia/registro-herramientas.ts:839-853`) | ~200–600 por paquete. **Inferido.** | El `id` solo es necesario si el modelo debe referenciarlo; si la UI ya recibe la lista, puede ser un campo interno. |

La oportunidad transversal es separar `resultadoParaModelo` de `resultadoParaUI`: hoy el mismo objeto que alimenta el siguiente prompt también se conserva indirectamente para el resultado final, y los handlers construyen payloads ricos sin una proyección específica del modelo (`packages/agente-core/src/ejecutar.ts:115-120`; `src/lib/ia/registro-herramientas.ts:49-68`).

## 4. Cliente Gemini

- El chat se instancia una vez como objeto `ChatPort` por request (`src/app/api/chat/route.ts:185-198`; `src/lib/ia/registro.ts:70-74`), pero el adaptador crea un `GoogleGenAI` nuevo cada vez que entra en `turno` o `turnoStream` (`packages/agente-core/src/gemini/chat.ts:122-130,136-138,174-176`). En el camino real SSE eso significa una instancia por vuelta del loop, no una por request.
- Un retry de la misma apertura reutiliza la instancia local de esa vuelta, porque `cliente()` se evalúa antes de `conReintento` (`packages/agente-core/src/gemini/chat.ts:174-197`).
- El parser RAG y los embeddings usan otra fábrica y crean un `GoogleGenAI` nuevo en cada llamada (`src/lib/gemini.ts:6-10`; `src/lib/rag/query-parser/parse.ts:37-41`; `src/lib/rag/embeddings.ts:27-34`).
- No hay singleton de `GoogleGenAI`, configuración explícita de keep-alive, agente HTTP, timeout de SDK ni reutilización documentada de conexiones en el código auditado (`packages/agente-core/src/gemini/chat.ts:127-130`; `src/lib/gemini.ts:6-10`). Si el SDK interno reutiliza conexiones, no es observable desde este repositorio; el coste de creación de instancias es **no medido**.

## 5. PostgreSQL

### Pool

El pool PG real no está en `src/lib/db.ts`: ese archivo abre `data/demo.sqlite` y mantiene una conexión SQLite global (`src/lib/db.ts:7-14,345-347`). El pool RAG está en `src/lib/rag/db.ts`; es un singleton global por proceso, solo recibe `connectionString` y no configura `max`, timeouts de conexión/idle, `statement_timeout`, SSL explícito, health-check ni estrategia de cierre (`src/lib/rag/db.ts:4-14`). El comentario del retrieval identifica el default de `pg` como 10 conexiones, pero no es una configuración explícita del pool (`src/lib/rag/retrieval/por-rol.ts:135-145`).

### Consultas y multiplicación

- La búsqueda normal lanza FTS y trigram en paralelo, pero cada una vuelve a ejecutar una consulta por query enfocada (`src/lib/rag/retrieval/search.ts:123-131,277-311,314-359`). En el caller de chat normalmente hay una query enfocada (`src/lib/ia/registro-herramientas.ts:437`).
- Tras fusionar, `buscarHibrido` ejecuta por separado whitelist de variantes, demanda y evidencia de evento (`src/lib/rag/retrieval/search.ts:569-577`), y el caller ejecuta después otra consulta de detalle para todos los productos (`src/lib/rag/chat/buscar.ts:212-221`).
- La consulta de detalle normal trae **todas** las variantes de los productos recuperados y filtra en JavaScript contra `variantIds` (`src/lib/rag/chat/buscar.ts:213-239`). Es una transferencia potencialmente innecesaria, especialmente para productos con muchas presentaciones.
- En el camino de franjas, cada rol reintenta secuencialmente varios niveles de filtros y cada intento entra de nuevo en `buscarHibrido` (`src/lib/rag/retrieval/por-rol.ts:76-180`). La consulta de detalle de presupuesto también trae todas las variantes de los productos y luego conserva solo pares presentes en `pares` (`src/lib/rag/chat/buscar-presupuesto.ts:235-247,249-274`). No es un N+1 por fila, pero sí una multiplicación por rol y por escalón.
- `resolverVariantesPorDespiece` sí es N+1 potencial: el loop de confirmación lo llama una vez por cada ítem `usar_despiece`, y cada llamada hace un `SELECT` independiente (`src/lib/ia/registro-herramientas.ts:527-561`; `src/lib/rag/tamanos/resolver.ts:38-64`). La validación posterior sí agrupa todas las variantes en una consulta (`src/lib/rag/chat/validar.ts:146-163`).
- El resolver de plan agrupa los ids en una sola consulta, pero usa `product_id = ANY(...) OR variant_id = ANY(...) OR variant_id = ANY(...)`, por lo que puede traer más variantes que las finalmente permitidas y filtrarlas en memoria (`src/lib/plan/resolver.ts:344-373,374-386`).
- Cada búsqueda, selección y auditoría de plan agrega round-trips síncronos a la ruta crítica. Los callers hacen `await registrarBusqueda`, `await registrarSeleccion`, `await registrarPlanAudit` y `await actualizarResultadoBusqueda` (`src/lib/ia/registro-herramientas.ts:385-400,461-472,582-602,655-709,741-809`).

### Índices observables y supuestos

- FTS usa el `GIN` de `search_tsv`; trigram usa índices GIN de `title` y `handle`; SKU exacto usa índices de `UPPER(sku_original)`/`UPPER(sku_canonical)`; los filtros tienen índices sobre variante/producto y facetas JSONB (`scripts/migrations/001_init.sql:24-31`; `scripts/migrations/009_retrieval_indexes.sql:20-48`).
- El filtro de colores de variante usa `&&` y tiene GIN, y el filtro de precio/disponibilidad/forma/diámetro tiene un índice compuesto (`src/lib/rag/retrieval/search.ts:148-215`; `scripts/migrations/005_franjas_presupuesto.sql:24-29`; `scripts/migrations/009_retrieval_indexes.sql:38-48`).
- El índice compuesto de variantes empieza por `product_id`; las búsquedas generales también filtran por disponibilidad, precio, forma y diámetro sin un producto conocido (`src/lib/rag/retrieval/search.ts:154-172`; `scripts/migrations/009_retrieval_indexes.sql:38-40`). Si el planner no puede aprovecharlo bien, el coste debe comprobarse con `EXPLAIN (ANALYZE, BUFFERS)` en un entorno autorizado; aquí no se midió.
- El vector retrieval ordena por distancia sobre `catalog_embeddings` sin índice ANN. La migración declara expresamente que no se crean HNSW/IVFFlat hasta medir recall/latencia (`src/lib/rag/retrieval/search.ts:366-379`; `scripts/migrations/001_init.sql:51-59`; `scripts/migrations/009_retrieval_indexes.sql:1-4`). Es una oportunidad condicionada al tamaño real y al benchmark, no una ganancia demostrada.
- `demandByProduct` filtra por snapshot, producto, variante y clase de demanda; los índices existentes están separados por variante, peso y snapshot, no hay evidencia en el alcance de un índice compuesto exactamente para ese predicado (`src/lib/rag/retrieval/search.ts:409-432`; `scripts/migrations/008_order_demand_aggregate.sql:31-38`). El impacto es **no medido**.

### Transacciones

No hay `BEGIN`, `client.query` transaccional ni una transacción abierta en los handlers de chat/RAG; las operaciones usan `pool.query` individual (`src/lib/rag/db.ts:8-14`; `src/lib/rag/chat/buscar.ts:213-221`; `src/lib/rag/chat/validar.ts:149-163`; `src/lib/rag/observability/log.ts:48-82`). El loop espera el proveedor solo entre una consulta ya resuelta y la siguiente (`packages/agente-core/src/ejecutar.ts:115-120,191-197`), por lo que no se observa una transacción PostgreSQL retenida mientras Gemini procesa. Esto es una inferencia estática, no una captura de conexiones.

## 6. Embeddings

- `embeberTexto` hace una llamada individual a `embedContent` con un solo `contents: texto`; no hay API batch, memoización ni cache de consulta en esa capa (`src/lib/rag/embeddings.ts:27-49`).
- En la ruta de presupuesto sí hay reutilización correcta dentro de una búsqueda: se calcula un embedding para `semantic_query` y se pasa a todos los roles (`src/lib/rag/chat/buscar-presupuesto.ts:162-180`; `src/lib/rag/retrieval/por-rol.ts:48-55,149-152`). Esto evita un embedding por rol, pero no evita re-embeddings entre búsquedas o reintentos de escalera.
- En la búsqueda normal, `queryVector` genera un embedding si no recibió uno precalculado (`src/lib/rag/retrieval/search.ts:361-364`), y cada `buscarHibrido` de una relajación puede volver a pasar por esa rama (`src/lib/rag/chat/buscar.ts:177-205`).
- En retrieval por slot se calcula un embedding independiente por slot y se llama `buscarHibrido` con ese vector (`src/lib/rag/retrieval/by-scene-slot.ts:160-195`). Dos slots con texto equivalente no comparten vector; no hay cache por texto normalizado.
- El cliente de embeddings se instancia de nuevo por llamada (`src/lib/rag/embeddings.ts:27-34`; `src/lib/gemini.ts:6-10`). Los errores se tragan y se cae a retrieval léxico en `embeddingOpcional`, sin registrar la causa ni el coste de la tentativa (`src/lib/rag/chat/buscar-presupuesto.ts:107-115`).
- La API de embeddings usa `conReintento` con hasta 3 intentos para errores clasificados reintentables (`src/lib/rag/embeddings.ts:21-25,31-42`; `src/lib/retry.ts:20-33`). No hay batching ni reuso persistente de vectores de consulta. La generación de embeddings de documentos queda fuera de este camino de chat; en el código auditado no se demostró que un texto de consulta idéntico sea cacheado.

## 7. Truncado de historial

`limitarHistorialChat` recorre desde el mensaje más reciente hacia atrás, suma solo `content.length`, detiene el recorrido al primer mensaje que no cabe y reconstruye el orden original (`src/lib/ia/historial-chat.ts:6-19`). El primer mensaje individual siempre entra aunque exceda el límite, porque la condición de corte exige que ya exista otro mensaje (`src/lib/ia/historial-chat.ts:15-18`).

Después elimina cualquier mensaje asistente que haya quedado al principio, para que Gemini empiece por usuario (`src/lib/ia/historial-chat.ts:21-23`). Puede perder un bloque antiguo completo de conversación y su respuesta, no solo texto de baja prioridad; la aplicación confía en que el brief conserva hechos estructurados (`src/app/api/chat/route.ts:220-224`).

Las imágenes no participan en el presupuesto de 16.000 caracteres y se adjuntan solo al último mensaje de usuario del request (`src/app/api/chat/route.ts:200-230`; `src/lib/ia/historial-chat.ts:13-18`). Eso limita la re-inyección de imágenes de turnos anteriores, pero no reduce la repetición de las imágenes del turno actual durante el tool loop.

La estabilidad del prefijo entre turnos no está garantizada:

- El sistema incluye el `brief` serializado y puede incluir blueprint y allowlist, por lo que cambia cuando cambia el estado del evento o el modo (`src/lib/ia/prompt-sistema.ts:184-203`; `src/app/api/chat/route.ts:192-198`).
- El historial se corta desde la izquierda por caracteres; al cruzar el límite desaparecen mensajes iniciales y cambia el primer contenido de usuario (`src/lib/ia/historial-chat.ts:13-23`).
- Dentro de un mismo request, el sistema y las declarations sí son idénticos, pero el transcript crece con cada resultado de tool (`packages/agente-core/src/ejecutar.ts:188-199`).

## 8. Telemetría

### Lo que se registra

- Cada vuelta de chat exitosa registra proveedor, operación, duración, tokens de entrada, tokens de salida, tokens cacheados y resultado; los errores registran duración, resultado y mensaje de error (`packages/agente-core/src/ejecutar.ts:162-180`; `packages/agente-core/src/telemetria.ts:5-16`).
- El buffer es global en memoria, se antepone cada evento y conserva solo 50 eventos (`packages/agente-core/src/telemetria.ts:18-35`). La ruta de salud expone los últimos 20 (`src/app/api/ia/salud/route.ts:26-36`).
- Las búsquedas RAG persistidas contienen request id, intent, ids recuperados, scores, status y latencias de parse/retrieval/total; el camino de franjas agrega canasta, utilización, relajaciones y planificación (`src/lib/rag/observability/log.ts:24-80`; `scripts/migrations/004_observability.sql:6-25`; `scripts/migrations/005_franjas_presupuesto.sql:16-29`).
- Selecciones y planes se guardan en PostgreSQL con rechazos, hashes, geometría, costos y estado (`src/lib/rag/observability/log.ts:111-195`; `scripts/migrations/011_plan_audit.sql:3-25`).

### Persistencia y faltantes

- La telemetría de chat/imágenes en `@sempertex/agente-core` no sobrevive a un reinicio o a otra instancia del proceso (`packages/agente-core/src/telemetria.ts:20-24,27-39`). Los logs RAG/auditoría sí intentan sobrevivir en PG, aunque los errores de escritura se capturan y solo se imprimen (`src/lib/rag/observability/log.ts:18-23,83-86,106-108,128-130,196-199`).
- El route de producción no pasa `onLlamada` al stream, aunque el motor ofrece ese callback (`src/app/api/chat/route.ts:245-252`; `packages/agente-core/src/ejecutar.ts:42-48,191-195`). No queda duración por herramienta ni número de vueltas asociado al request.
- No se registra en PG el `request_id`/`correlation_id` junto a cada evento de tokens; el tipo de telemetría solo tiene proveedor, operación, tiempo, tokens y error (`src/app/api/chat/route.ts:263-269`; `packages/agente-core/src/telemetria.ts:5-16`).
- El parser de intención no conserva uso de tokens ni duración del `generateContent`, y el embedding tampoco registra uso, duración, número de reintentos ni tamaño del texto (`src/lib/rag/query-parser/parse.ts:37-59`; `src/lib/rag/embeddings.ts:27-49`).
- No hay precio por modelo, moneda, versión de prompt, hash de declarations, número de function calls, tamaño de payload, espera del pool, duración de cada SQL, filas devueltas ni coste de reintentos (`packages/agente-core/src/telemetria.ts:5-16`; `src/lib/rag/observability/log.ts:24-45`).

Para medir una optimización faltan como mínimo: un id de request en cada evento de modelo/tool/embedding/SQL, `vuelta`, `nombre_tool`, latencia de handler, prompt/response token count por llamada RAG, bytes de texto/imágenes/declarations, intentos de retry, filas y tiempo de cada query, espera de pool, y coste calculado desde una tabla versionada de precios. La instrumentación debe guardar hashes/metadatos acotados y no prompts completos ni imágenes, en línea con el filtrado actual de metadatos sensibles (`src/lib/rag/observability/log.ts:4-16,133-137`).

## 9. Oportunidades de optimización

Las ganancias son **esperadas y no medidas** salvo que se indique lo contrario. No se incluye la paralelización de la escalera por rol, porque este informe no reabre una alternativa ya descartada por el contexto de la auditoría.

### 1. Evitar reenviar imágenes inline en cada vuelta

- **Cambio:** representar la imagen mediante una referencia reutilizable soportada por el proveedor, o mantener un estado de contenido multimodal que no obligue a repetir el base64; como mínimo, no incluirla de nuevo cuando el modelo ya la recibió en la misma ejecución (`src/app/api/chat/route.ts:204-230`; `packages/agente-core/src/gemini/chat.ts:27-41`).
- **Beneficio esperado:** alto en turnos con fotos; puede eliminar cientos de KB/MB por vuelta y reducir tokens/transferencia. **Especulativo, no medido.**
- **Riesgo:** que Gemini pierda acceso a la imagen o que una referencia expire.
- **Invariante:** el modelo debe seguir viendo la foto del espacio y las referencias con sus IDs semánticos (`packages/agente-core/src/gemini/chat.ts:29-39`).
- **Verificación:** registrar bytes y tokens por vuelta, probar un diálogo con una tool y una foto, y comparar que el modelo identifique el mismo contenido/IDs; probar expiración y cancelación.

### 2. Proyección compacta de resultados para Gemini

- **Cambio:** crear una respuesta específica para el modelo, separada del payload UI/telemetría. Priorizar la poda de `imagen` de `pool_por_rol`, duplicados entre `canasta` y pool, `plan_id`/`plan_hash` y campos constantes (`src/lib/rag/chat/buscar-presupuesto.ts:17-26,290-302`; `src/lib/ia/registro-herramientas.ts:402-434,810-836`).
- **Beneficio esperado:** alto y directo sobre tokens de entrada en búsquedas por franja y confirmación de plan. **No medido.**
- **Riesgo:** que el modelo deje de tener ids, precios, tamaños, evidencia de evento o sustituciones necesarios para confirmar y hablar con honestidad.
- **Invariante:** toda selección debe continuar usando ids recuperados y todos los avisos de relajación/sustitución deben seguir visibles (`src/lib/ia/herramientas.ts:253-275`; `src/lib/ia/registro-herramientas.ts:621-635`).
- **Verificación:** snapshot tests del JSON destinado al modelo; tests de selección con 0, 1 y múltiples roles; comprobar que el payload UI conserva el objeto completo.

### 3. Filtrar variantes en SQL, no después de transferirlas

- **Cambio:** en el detalle normal y de presupuesto, incorporar la whitelist de `variant_id` en el `WHERE` o unirla mediante `unnest`, en lugar de pedir todas las variantes del producto y filtrarlas en JavaScript (`src/lib/rag/chat/buscar.ts:213-239`; `src/lib/rag/chat/buscar-presupuesto.ts:235-247,249-254`).
- **Beneficio esperado:** medio/alto en productos con muchas variantes; menos filas leídas, serializadas y transferidas. **No medido.**
- **Riesgo:** omitir una variante necesaria si la whitelist y el join no conservan exactamente la semántica actual.
- **Invariante:** el modelo solo puede ver variantes que pasaron los mismos filtros duros y la whitelist del retrieval (`src/lib/rag/retrieval/search.ts:224-233`; `src/lib/rag/chat/buscar.ts:231-239`).
- **Verificación:** comparar conjuntos ordenados de candidatos antes/después; `EXPLAIN (ANALYZE, BUFFERS)` con catálogo representativo; test con producto multi-variante y relajación.

### 4. Reutilizar una instancia de `GoogleGenAI`

- **Cambio:** crear el cliente una vez dentro de `crearChatGemini`, y usar un singleton por proceso para parser/embeddings si el SDK lo permite, sin compartir configuración mutable (`packages/agente-core/src/gemini/chat.ts:122-130`; `src/lib/gemini.ts:6-10`).
- **Beneficio esperado:** bajo/medio, principalmente evitar setup repetido y permitir que el transporte del SDK reutilice conexiones. **No medido; el keep-alive interno del SDK es desconocido.**
- **Riesgo:** fugas de configuración entre requests o comportamiento inesperado con rotación de API key.
- **Invariante:** cada request debe respetar la key, modelo, `AbortSignal` y `thinkingConfig` que hoy se pasan a cada llamada (`packages/agente-core/src/gemini/chat.ts:136-155,183-197`).
- **Verificación:** test con dos requests concurrentes y keys/modelos distintos; contar instancias; benchmark local sin proveedor pagado usando un fake de `GoogleGenAI`.

### 5. Eliminar round-trips redundantes de retrieval

- **Cambio:** fusionar, cuando sea seguro, evidencia de evento y proyección de detalle en una consulta; evaluar si whitelist y detalle pueden salir de una única consulta; evitar `demandByProduct` cuando la señal opcional no está materializada (`src/lib/rag/retrieval/search.ts:569-577`; `src/lib/rag/chat/buscar.ts:212-221`).
- **Beneficio esperado:** 1–3 round-trips PG menos por búsqueda exitosa. **No medido.**
- **Riesgo:** alterar ranking, distinguir `NO_MATCH`/`filtered_out` o perder evidencia explicable.
- **Invariante:** FTS/trigram/vector deben conservar scores, whitelist, disponibilidad, evidencia de evento y orden final (`src/lib/rag/retrieval/search.ts:582-612`).
- **Verificación:** comparación de resultados y scores en fixtures; `EXPLAIN`; prueba de demanda ausente, evento sin señales y filtro de color.

### 6. Batch de resolución de despieces

- **Cambio:** acumular todos los pares `(productId, whitelistVariantIds)` de una llamada `confirmar_seleccion_rag` y resolverlos con un único `SELECT`, conservando el matching por producto y la selección del diámetro más cercano (`src/lib/ia/registro-herramientas.ts:527-561`; `src/lib/rag/tamanos/resolver.ts:47-113`).
- **Beneficio esperado:** pasar de una consulta por ítem `usar_despiece` a una por confirmación; medio en planes con varios colores/productos. **No medido.**
- **Riesgo:** cruzar variantes entre familias o perder la whitelist específica por producto.
- **Invariante:** solo se usan variantes ACTIVE/disponibles, redondas, con precio/paquete válidos y pertenecientes al producto/whitelist correctos (`src/lib/rag/tamanos/resolver.ts:29-36,47-64`).
- **Verificación:** tests con 1, varios productos, varios colores, ausencia de cobertura y empate de precio/variante.

### 7. Contener el coste de la escalera por rol sin paralelizarla

- **Cambio:** estudiar una consulta SQL que devuelva candidatos etiquetados por nivel de relajación y seleccione el primer nivel no vacío, o eliminar intentos estrictamente dominados antes de entrar en `buscarHibrido` (`src/lib/rag/retrieval/por-rol.ts:76-133,147-184`).
- **Beneficio esperado:** reducir consultas repetidas en franjas que activan varios escalones; potencialmente alto en el peor caso. **No medido y sujeto a planner.**
- **Riesgo:** que la prioridad de color/ocasión/categoría/tope cambie o que una relajación se aplique silenciosamente.
- **Invariante:** las restricciones físicas no se relajan y cada relajación debe quedar explicada en la respuesta/log (`src/lib/rag/retrieval/por-rol.ts:161-184`; `src/lib/rag/chat/buscar-presupuesto.ts:305-317`).
- **Verificación:** tabla de casos por rol y cada escalón; comparar candidatos, orden, `relajaciones` y `conflictos`; `EXPLAIN` por consulta.

### 8. Sacar los INSERT/UPDATE no críticos de la ruta con outbox durable

- **Cambio:** persistir un evento acotado en un outbox local/PG y procesarlo con `waitUntil`/worker, en vez de esperar el INSERT de búsqueda, selección y auditoría antes de devolver cada resultado (`src/lib/ia/registro-herramientas.ts:385-400,461-472,582-602,741-809`; `src/lib/rag/observability/log.ts:47-82,98-127,165-195`).
- **Beneficio esperado:** eliminar 1 o más round-trips de la ruta de tool; medio, **no medido**.
- **Riesgo:** perder trazabilidad si el proceso muere antes de despachar el evento, o leer un log temporalmente incompleto.
- **Invariante:** cada búsqueda/selección/plan debe acabar durablemente registrado y asociado al `requestId` (`src/lib/rag/observability/log.ts:18-23`; `scripts/migrations/004_observability.sql:6-25`).
- **Verificación:** outbox con idempotency key, prueba de crash entre respuesta y worker, reintentos y comparación de cardinalidad con el camino síncrono.

### 9. Cachear embeddings solo dentro de una ejecución y medirlo

- **Cambio:** usar un mapa por request/turno con clave de texto normalizado y modelo/dimensión, especialmente para reintentos de la misma búsqueda; conservar el embedding único compartido por roles de presupuesto (`src/lib/rag/chat/buscar-presupuesto.ts:162-180`; `src/lib/rag/retrieval/search.ts:361-364`).
- **Beneficio esperado:** bajo/medio y solo cuando se repite exactamente una query o una escalera recalcula vector; **no medido**.
- **Riesgo:** devolver un vector de modelo/dimensión distinta si la clave no incluye configuración, o crecer sin límite.
- **Invariante:** `MODELO_EMBEDDING`, dimensión y task type deben coincidir con la consulta y `validarEmbedding` (`src/lib/rag/embeddings.ts:5-19,51-58`).
- **Verificación:** contador de hit/miss, prueba de reintento y cambio de modelo/dimensión; límite de tamaño y limpieza al terminar el request.

### 10. Instrumentar antes de reclamar una ganancia

- **Cambio:** añadir `request_id`, vuelta, herramienta, intento, bytes, tokens, tiempo de handler, filas/tiempo SQL y espera de pool a la telemetría acotada (`packages/agente-core/src/telemetria.ts:5-16`; `src/lib/rag/observability/log.ts:24-45`).
- **Beneficio esperado:** no reduce coste por sí solo, pero permite ordenar correctamente las optimizaciones y separar modelo, PG, red y logging. **No medido.**
- **Riesgo:** guardar prompts, imágenes, secretos o aumentar el coste de logging.
- **Invariante:** metadata mínima, truncada y sin claves sensibles, como ya exige `metadataAuditable` (`src/lib/rag/observability/log.ts:4-16`).
- **Verificación:** pruebas de redacción de secretos, correlación end-to-end, reinicio de proceso y comparación de contadores con un fake de proveedor/PG.

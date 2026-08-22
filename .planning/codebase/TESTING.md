# Estrategia de pruebas y benchmark del RAG

## Estado verificable de esta auditoría

Se inspeccionaron los scripts y reportes existentes, pero no se ejecutó una importación ni se escribió la base. Docker responde, aunque `docker info` reportó 0 contenedores corriendo y 0 imágenes en el contexto `desktop-linux`; por lo tanto, cualquier resultado de PostgreSQL debe marcarse como `BLOCKED` hasta levantar explícitamente el stack y comprobar migraciones, datos y embeddings.

El arnés existente es útil como punto de partida, pero no basta para aceptar una reconstrucción:

- `scripts/eval-retrieval.ts`: 15 SKUs + 15 nombres elegidos con `ORDER BY random()`, seis combinaciones de filtros y cinco negativos. El ground truth de filtros se calcula con SQL independiente, pero la muestra cambia en cada corrida y no cubre sistemáticamente color, forma, diámetro ni precios por variante.
- `scripts/eval-query-parser.ts`: 12 frases × 3 repeticiones, con foco en categorías, colores, ocasiones y precio. No verifica de forma completa `formas` ni `diametros_pulgadas`; además, su comentario histórico menciona un modelo `flash-lite` que el código actual ya no configura.
- `scripts/eval-tamanos.ts` y `reports/eval-tamanos-2026-08-21.txt`: cinco casos. El reporte observado dio 1/5 casos con mezcla de tamaños y solo 2/5 exclusivamente con el tamaño esperado; dos casos terminaron sin resultados. Es baseline de regresión, no evidencia de que el problema esté resuelto.
- `scripts/test-rag-validation.ts`: prueba IDs fuera de whitelist, precio falso, variante cruzada, cantidad inválida y agotados cuando existen. Es una buena prueba de autoridad de DB, pero el caso `UNKNOWN` depende todavía del prompt del LLM.
- `scripts/rag-health.ts` y `scripts/rag-metrics.ts`: salud/telemetría operativa; no sustituyen un benchmark de relevancia.

## Dataset de benchmark reproducible

Antes de comparar implementaciones:

1. Descargar cada URL una vez en un snapshot de evaluación fuera de producción, conservar HTTP status, `Content-Type`, bytes, ETag/Last-Modified si existen y SHA-256. Fijar el query string (`v=1779763986` y una sola versión de órdenes elegida) y no llamar la URL en medio de una corrida.
2. Validar el snapshot contra el contrato observado: 3.297 productos, 6.136 variantes, estados, 5.923 SKUs únicos, 66 claves repetidas y los conteos de precio/imagen indicados en `CONVENTIONS.md`. Si cambia la fuente, producir un diff y regenerar el ground truth; no forzar los números antiguos.
3. Construir un corpus canónico determinista con `product_id`/`variant_id` estables. Separar por producto, no por fila de variante, para evitar que el mismo producto aparezca en train y test.
4. Mantener `order_data.json` como señal de popularidad y generación de consultas. Excluir `customer.id`, no usarlo en prompts, y asumir truncamiento de líneas porque 175/200 órdenes tienen exactamente 10 líneas y no hay `pageInfo`.
5. La evaluación de SKU debe excluir o etiquetar como ambiguos los 66 SKUs repetidos. Para esos casos, el ground truth debe ser el conjunto de variantes/productos válidos, nunca un único producto inventado por el evaluador.

## Matriz mínima de consultas

El conjunto fijo inicial debe tener al menos 400 consultas y conservar IDs, etiquetas y evidencia:

| Familia | Mínimo | Ground truth |
| --- | ---: | --- |
| SKU exacto no duplicado | 50 | variante/producto de la fila fuente |
| Nombre exacto, variaciones de mayúsculas/acentos/typos | 50 | producto fuente; MRR/Recall |
| Consultas semánticas de intención de compra | 100 | 2 anotadores, adjudicación y lista de relevantes |
| Color y sinónimos/multi-color/estampado | 50 | etiqueta controlada + casos `unknown/ambiguous` |
| Forma, código y diámetro (R/C/LOL/T, pulgadas) | 50 | variante exacta y forma/diámetro |
| Filtros duros combinados (categoría/color/ocasión/precio/stock) | 50 | consulta SQL independiente a nivel de la misma variante |
| Presupuesto/franjas y composición de canasta | 25 | canasta válida, total y utilización |
| Negativas/no-match/adversariales | 25 | conjunto vacío o rechazo estructural |

Repetir el parser y el flujo de chat al menos 3 veces por caso para capturar inestabilidad. El retrieval puro debe ejecutarse contra el mismo snapshot y configuración, sin `random()` ni dependencia de la hora.

## Ground truth por capa

No hay un único ground truth para todas las preguntas. Guardar una etiqueta `ground_truth_type`:

- `exact_sku`: igualdad de SKU y variante no ambigua; espera Recall@1=1. Los SKU repetidos se marcan `ambiguous_sku` y se evalúan como conjunto.
- `exact_name`: título fuente y alias de catálogo; revisar manualmente colisiones de títulos idénticos.
- `hard_filter`: SQL independiente sobre producto y variante. Precio, disponibilidad, forma y diámetro deben cumplirse en la misma variante; no reutilizar la función de retrieval para construir la respuesta esperada.
- `semantic`: relevancia graduada 0/1/2 por dos anotadores que solo ven título, tags, color, ocasión, forma, disponibilidad y precio de la fuente. Las órdenes solo priorizan candidatos populares; no convierten popularidad en relevancia.
- `negative`: producto inexistente o categoría fuera del alcance. El backend debe devolver cero para SKU inexistente; para lenguaje semántico, aceptar candidatos solo si pasan un umbral calibrado y el chat los etiqueta como sustitutos/no-match.
- `price_stock`: el valor esperado es el de la variante del snapshot; comprobar exactitud, moneda COP, `availableForSale`/disponibilidad y timestamp.

## Métricas y criterios de aceptación

### Calidad de datos

- 100 % de productos canónicos con `product_id` y `handle` únicos; 100 % de variantes con `variant_id` único y FK válida.
- 0 payloads aceptados con precio no numérico; 0 variantes comprables con precio `<=0`; cada rechazo debe conservar razón y payload/hash.
- 100 % de filas cotizables con precio, moneda COP y disponibilidad derivados de la misma variante fuente; diferencia de precio 0,00 COP.
- 100 % de joins de inventario auditados por cobertura y colisión. Cualquier SKU normalizado que refiera a más de una variante queda `ambiguous` y no puede resolverse por SKU solo.
- 100 % de embeddings presentes, dimensionalidad correcta y hash igual a `search_text`; 0 embeddings huérfanos.
- Cobertura de color, ocasión, categoría, forma y diámetro reportada por atributo; no declarar PASS por la ausencia de `null`, porque un `null` puede ser la respuesta honesta.

### Retrieval y filtros

- SKU no ambiguo: Recall@1 >= 0,99 y Recall@5 = 1,00.
- Nombre/alias: Recall@5 >= 0,95; MRR@10 >= 0,90.
- Semántica: NDCG@10 >= 0,75 global y >= 0,70 por familia; no aceptar que una sola familia compense una taxonomía rota.
- Filtro duro: precisión@20 = 1,00, leakage de producto/variante = 0 y 100 % de variantes mostradas pertenecen a la whitelist aprobada.
- No-match: exact SKU inexistente = 100 % sin resultados; negativas semánticas >= 0,90 de exactitud, con respuesta explícita de sustitución cuando corresponda.
- IDs inválidos devueltos = 0; intentos de selección fuera de whitelist rechazados = 100 %; variante que pertenece a otro producto rechazada = 100 %.
- Precio/stock/formas/tamaño: 100 % de invariantes en la respuesta final, incluyendo no mezclar una variante fuera de precio con otra que hizo pasar el producto.

### Parser y chat

- Parser: 100 % de los campos etiquetados correctos en el set fijo y 100 % estables en 3 repeticiones; sin errores de schema. El baseline actual tiene 12 casos, que deben ampliarse para formas, diámetros, sinónimos y ambiguos.
- Chat: 0 IDs/precios/SKU inventados; 0 afirmaciones de color/forma/tamaño ausentes en la fuente; `NO_MATCH` y sustituciones deben conservar trazabilidad estructural. Una sola regresión en estos invariantes bloquea el cambio de modelo/thinking.

### Latencia y operación

El baseline documentado en `PLAN_RENDIMIENTO_RAG.md` fue, sobre 1.672 productos/3.727 variantes y 238 búsquedas, parseo p50 4.478 ms/p95 7.279 ms, retrieval p50 430 ms/p95 1.388 ms y total p50 5.070 ms/p95 8.108 ms. Es una referencia histórica, no una garantía para el snapshot de 3.297 productos.

Para la reconstrucción, aceptar solo si la corrida fija demuestra:

- retrieval p50 <= 500 ms y p95 <= 2.100 ms (o <=1,5× el baseline medido en el mismo entorno, lo que sea más estricto tras medir);
- parser p50 < 1.500 ms cuando use `thinkingLevel=minimal`, con p95 registrado y sin regresión de calidad;
- end-to-end p95 <= 1,15× el baseline de la misma máquina para la misma familia de consultas;
- tasa de timeout/error de fuente, embedding y DB < 1 % en una corrida de 100 consultas y 3 sincronizaciones consecutivas;
- sincronización idempotente: segunda corrida con snapshot idéntico produce 0 cambios de contenido y 0 embeddings innecesarios.

## Secuencia de ejecución

1. `npm run rag:health` y comprobación de que Docker/Postgres/pgvector están realmente levantados.
2. Migraciones y chequeos de extensiones/índices, sin importar datos todavía.
3. Validación de snapshot y adaptador en memoria; si falla contrato, detener.
4. Importación transaccional en un entorno de prueba, conteos y auditoría de rechazos/colisiones.
5. Embeddings; validar dimensiones, hash y cobertura.
6. Benchmark fijo de retrieval, parser y reglas de validación.
7. Evaluación de chat/end-to-end con whitelist, precios, disponibilidad, color, forma, tamaño y no-match.
8. `npm run rag:metrics` y revisión de logs; entregar un reporte con hash/configuración, métricas y fallos, no solo PASS/FAIL.

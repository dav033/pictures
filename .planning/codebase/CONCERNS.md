# Riesgos, bloqueos y deuda de calidad

## P0 — resolver antes de declarar el RAG operativo

### 1. El contrato de fuente no coincide con el pipeline actual

El usuario identifica `products_catalog.json` y `order_data.json` como fuentes del RAG, pero el código actual pagina `www.sempertex.com/products.json`, usa `products_catalog.json` solo como inventario y no lee `order_data.json`. El CDN observado contiene 3.297 productos/6.136 variantes, IDs GID, `status`, `availableForSale` y no contiene `option1`/`option2`/`body_html`/`images[].src`; `normalizarProducto()` espera otra forma. Pasar el archivo directamente provocaría errores de schema, campos vacíos o descartes silenciosos.

Mitigación obligatoria: decidir fuente de catálogo, escribir un adaptador explícito y probarlo con fixture congelado. Reportar por separado productos de `ACTIVE` y `DRAFT`, inventario, y órdenes históricas. No cambiar la fuente solo por nombre de archivo.

### 2. No hay un entorno Docker disponible para verificar end-to-end

`docker info` respondió, pero mostró 0 contenedores corriendo y 0 imágenes en `desktop-linux`. No se puede afirmar que PostgreSQL/pgvector, migraciones, importación, embeddings y retrieval estén funcionando. Cualquier reporte de éxito obtenido sin levantar el stack sería inválido.

Mitigación: levantar un entorno aislado de prueba, comprobar `SELECT 1`, versión de pgvector, migraciones, conteos y salud de Gemini antes de escribir/importar. Mantener el catálogo previo y una ruta de rollback.

### 3. Snapshot remoto antiguo y no versionado de forma reproducible

Los datos auditados tienen productos actualizados hasta 2026-05-22 y órdenes del 2026-05-21 al 25, mientras la auditoría es del 2026-08-21. Las URLs incluyen query strings `v`; dos versiones de `order_data` respondieron 200 con igual tamaño, pero no hay hash fijado. Un benchmark mezclando fetches de distintos momentos no es comparable.

Mitigación: guardar metadatos y SHA-256 del snapshot de evaluación, exigir edad máxima en producción, comparar conteos/diffs antes de purgar y registrar `source_updated_at`. Si el fetch llega vacío o cae por debajo del umbral, no borrar el catálogo anterior.

### 4. Precio, estado y disponibilidad no son una sola señal

El CDN tiene 278 variantes (4,53 %) con precio `<=0`, 161 productos con todas sus variantes no positivas y 85 productos `ACTIVE` sin variante disponible con precio positivo. También tiene 1.806 productos `DRAFT`. `availableForSale`, `inventoryQuantity` y un posible `available` de otra API no son intercambiables.

Mitigación: política explícita: solo variante `ACTIVE`/publicable, precio positivo y disponibilidad válida entra a candidatos comprables; todo descarte queda auditado. Nunca interpretar precio cero como gratis ni inventar inventario `0` cuando la fuente no lo trae. Las consultas de precio deben aplicar el tope y el stock sobre la misma variante.

### 5. SKU duplicado rompe el lookup exacto

Hay 66 claves SKU repetidas, 164 filas de variante involucradas y 64 líneas de órdenes (510 unidades) con esos SKU. El retrieval actual hace un `SELECT DISTINCT product_id WHERE v.sku=$1`, así que un SKU duplicado puede devolver múltiples productos aunque el usuario esperara uno. En órdenes, el SKU solo tampoco resuelve el producto.

Mitigación: imponer unicidad de una clave canónica solo si el negocio lo confirma; de lo contrario marcar `ambiguous`, buscar por `variant_id`/producto+SKU, o devolver una aclaración. Excluir SKU ambiguos del criterio Recall@1 y exigir 100 % de exactitud en SKU no ambiguos.

### 6. Tamaño y forma no vienen igual en las fuentes

El plan existente decodifica `option1` (`R-5`, `C-12`, `LOL`, `T`) en Postgres, pero `products_catalog.json` no trae `option1`; solo contiene títulos/tags. Los tags observados mezclan forma física (`REDONDO`, `CORAZON`, `LINK-O-LOON`), códigos (`R-12`, `T260`) y formato de armado (`BOUQUET`). Inferir tamaño desde título/tag puede ser ambiguo y contaminar filtros duros. El reporte actual ya mostró mezcla en 1/5 de casos y exclusividad correcta solo en 2/5.

Mitigación: no convertir tags en medidas sin reglas verificadas; conservar `null`/`unknown` cuando la fuente no determine la forma. Construir fixtures por forma/diámetro, exigir la misma variante en filtros y no relajar un tamaño explícito.

## P1 — riesgos de calidad que afectan relevancia

### 7. Taxonomía de color insuficiente y ruidosa

La paleta actual solo reconoce 15 valores por igualdad de tag/título. El snapshot contiene `LILA`, `TURQUESA`, `CHAMPAGNE`, `AZUL REY`, `AZUL CARIBE`, `VERDE LIMA`, `DORADO / NEGRO`, nombres de estampado y combinaciones de ocasión/color. Muchos tags son acabados o diseños, no colores simples. El plan previo ya midió 432/1.672 productos sin color derivado (26 %); el nuevo corpus debe volver a medirlo, no asumir que la cifra se conserva.

Mitigación: separar `base_color`, `secondary_colors`, `finish`, `pattern` y `occasion`; mantener alias controlados con versión. No tratar “metalizado” como color/forma y no usar un color derivado de baja confianza como filtro duro. Medir cobertura y falsos positivos por etiqueta.

### 8. Ocasión y categoría contienen tags comerciales no normalizados

El código reconoce 11 ocasiones exactas y algunos patrones de título, pero el snapshot usa `PROMOMADRE`, `PROMOPADRE`, `QUINCEAÑERO`, `FELIZ CUMPLEAÑOS`, `BABYSHOWER`, `NAVIDAD ROJA` y sufijos como `AMOR1`. La derivación incompleta produce falsos negativos; la derivación por substring puede producir falsos positivos. `productType` también contiene 184 valores vacíos y familias (`PIÑATERIA`, `JUGUETE`, `REVISTAS`) fuera de las 10 categorías controladas.

Mitigación: crear tabla/versionado de alias, separar ocasión de color/estampado/promoción y clasificar explícitamente `unknown`/fuera de alcance. El benchmark debe medir precision y recall de taxonomía antes de habilitar esos campos como filtro.

### 9. Historial de órdenes es censurado y no debe ser verdad comercial

`order_data.json` contiene 200 órdenes recientes, todas `UNFULFILLED`, 198 `PENDING`, sin `pageInfo` y con 175 órdenes limitadas exactamente a 10 líneas. Puede servir para priorizar consultas y generar ejemplos de demanda, pero no representa ventas completas, clientes, stock o precios actuales.

Mitigación: usar solo agregados por SKU/producto con decaimiento temporal y etiqueta `weak_signal`; nunca indexar clientes ni usar la orden para validar disponibilidad/precio. No usar órdenes del mismo SKU para test y entrenamiento sin separar por fecha/orden.

### 10. Ground truth actual no es reproducible ni cubre el problema pedido

`eval-retrieval.ts` usa muestras aleatorias y solo seis combos de filtros; por eso dos corridas pueden evaluar productos distintos. No hay un set fijo de consultas de color/forma/precio derivado de los dos JSON remotos, ni relevancia semántica humana. Los cinco casos de tamaño actuales son demasiado pocos y dos quedan sin resultados.

Mitigación: congelar snapshots/hash, construir un set mínimo de 400 consultas con ground truth por capa (SKU, nombre, semántica anotada, filtros SQL independientes, tamaño/forma, negativas) y publicar métricas por familia. Prohibir `ORDER BY random()` en criterios de aceptación.

### 11. No-match semántico puede devolver “vecinos” legítimos

El propio `test-rag-validation.ts` reconoce que el retrieval vectorial puede devolver candidatos para una consulta inexistente; la decisión final de `NO_MATCH` depende del LLM. Un umbral de similitud global no distingue bien nombres raros, SKUs inválidos y consultas semánticas.

Mitigación: ruta determinista para SKU inexistente, umbral calibrado por familia, evaluación de negativas, respuesta de sustitución explícita y telemetría de consultas con score máximo. Nunca afirmar que un vecino semántico es el producto pedido.

### 12. Embeddings y taxonomía pueden quedar desincronizados

El hash actual cubre `search_text`, que excluye precio/stock por diseño. Eso es correcto para cambios volátiles, pero cambiar alias de color, ocasión, categoría, forma o descripción exige cambiar `search_text`, versión de taxonomía y embedding. Mantener un embedding antiguo mientras se cambia la derivación crea un corpus híbrido difícil de depurar.

Mitigación: incluir versión de normalizador/taxonomía en el fingerprint, medir cobertura de embeddings y re-embeder solo filas cuyo texto/hash/modelo/dimensiones cambien. Verificar 0 huérfanos y 100 % de dimensiones válidas.

## P2 — operación, seguridad y rendimiento

### 13. Datos de órdenes contienen identificadores de clientes

Aunque hoy no se ingestan, el JSON remoto incluye `customer.id`. Incluirlo en `source_payload`, logs o embeddings expandiría el riesgo de PII sin valor para la búsqueda de productos.

Mitigación: no persistir órdenes crudas en la DB del RAG; si se necesita analítica, eliminar cliente/orden y conservar solo agregados, con retención y control de acceso documentados.

### 14. Re-embeddings y límites de API pueden romper una sincronización completa

El corpus CDN tiene 3.297 productos, casi el doble de la base histórica de 1.672 embeddings. Un import completo puede disparar 3.297 llamadas de embedding; reintentos paralelos sin rate-limit pueden generar 429 y dejar cobertura parcial.

Mitigación: cola idempotente, concurrencia configurable, backoff, checkpoint, métrica de pendientes y bloqueo del deploy si falta cualquier embedding. Probar una corrida completa y otra incremental; no confundir “upsert del producto” con “RAG listo”.

### 15. La decisión de índice vectorial debe basarse en medición

El baseline histórico resolvía ~1.672 productos con búsqueda vectorial exacta y retrieval p50 ~430 ms; el nuevo corpus de 3.297 productos sigue siendo pequeño, pero el salto de filas, filtros JSONB y variantes puede modificar el perfil. Agregar HNSW/IVFFlat prematuramente puede degradar recall y complicar migraciones.

Mitigación: medir exact search, HNSW y cualquier reranker sobre el mismo snapshot con Recall@K, p50/p95 y costo; aceptar un índice solo si mejora p95 sin superar 0,5 puntos porcentuales de pérdida de recall.

### 16. La latencia dominante no está necesariamente en Postgres

El plan de rendimiento midió el parseo del LLM como 88 % del total histórico (p50 4.478 ms), frente a retrieval p50 430 ms. Optimizar SQL o agregar un framework RAG no resolverá el cuello si se sacrifica el parser estructurado, la whitelist o la honestidad.

Mitigación: medir parseo, embedding, SQL, rerank, chat y end-to-end por separado; comparar `thinkingLevel`/modelo solo contra el set conversacional fijo. No fusionar llamadas ni habilitar caché semántico sin evidencia de calidad y tasa de hit.

## Criterios de salida de riesgos

No declarar reconstrucción terminada hasta cumplir simultáneamente: contrato de fuente adaptado y versionado; Docker/Postgres/pgvector comprobados; 0 IDs inválidos y 0 fugas de variante/precio/stock; SKU no ambiguo Recall@1 >=0,99; nombre Recall@5 >=0,95; filtro duro precision@20=1,00; no-match SKU=100 %; parser estable 3/3; embeddings completos; retrieval p95 <=2.100 ms en el corpus congelado; y una sincronización repetida sin cambios espurios. Cualquier P0 abierto mantiene el estado `BLOCKED`.

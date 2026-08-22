# Convenciones del RAG y contrato de datos

Este documento fija las convenciones que deben respetarse al reconstruir el RAG. La fuente de verdad de hechos comerciales es la fuente Shopify/CDN versionada; el LLM solo interpreta la consulta y redacta una respuesta basada en candidatos ya validados. No se deben mezclar datos inferidos con hechos crudos.

## Fuentes auditadas y precedencia

Se auditaron las URLs indicadas por el usuario el 2026-08-21, sin persistirlas en la base:

- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986`: HTTP 200, `application/json`, 5.151.603 bytes, 3.297 productos y 6.136 variantes.
- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de`: HTTP 200, `application/json`, 1.204.158 bytes, objeto GraphQL con `data.orders.edges`.
- La misma ruta de órdenes con `v=1779763985` también respondió 200 y el mismo tamaño. Debe elegirse una versión y guardarse su SHA-256; no se debe aceptar que dos snapshots con query strings diferentes sean intercambiables sin verificar hash.

El código actual no consume esas dos fuentes como un único catálogo. `src/lib/rag/catalog/fetch-shopify.ts` pagina `https://www.sempertex.com/products.json` para los productos y usa `products_catalog.json` como inventario cruzado por SKU. `order_data.json` no aparece en el pipeline. Esta distinción debe mantenerse explícita hasta que exista un adaptador y una decisión de fuente de verdad:

1. Producto y variante comprables: fuente de catálogo Shopify (`products.json` o un adaptador equivalente).
2. Inventario: snapshot CDN, siempre con timestamp, edad máxima y reporte de cobertura.
3. Historial de órdenes: señal agregada para priorización y evaluación; no reemplaza precio, disponibilidad ni catálogo actual.
4. Hechos de respuesta: únicamente filas canónicas persistidas y revalidadas en PostgreSQL.

## Contrato observado del CDN

`products_catalog.json` no tiene el tipo `ProductoPublico` que esperan `normalizarProducto()` y `VariantePublica`:

- Producto: `id` y variantes usan IDs GID/string, no necesariamente números; trae `status`, `productType`, `createdAt`, `updatedAt`, `images[].url` y `variants[].availableForSale`.
- Variante: trae `id`, `sku`, `price`, `compareAtPrice`, `title`, `availableForSale`, `inventoryQuantity` y `barcode`; no trae `option1`, `option2`, `option3`, `available`, `grams` ni `image_url`.
- Por lo tanto, no se debe pasar el JSON del CDN directamente a `normalizarProducto()`. Primero hay que versionar un adaptador que conserve el payload crudo, haga explícita cada conversión y marque como `null` lo que no está presente.

Conteos del snapshot observado:

| Hecho | Conteo |
| --- | ---: |
| Productos totales | 3.297 |
| `ACTIVE` / `DRAFT` | 1.491 / 1.806 |
| Variantes totales | 6.136 |
| Variantes `availableForSale=true/false` | 3.813 / 2.323 |
| Variantes con precio `<= 0` | 278 (4,53 %) |
| Productos con todas sus variantes no positivas | 161 |
| Productos `ACTIVE` sin variante disponible y con precio positivo | 85 |
| Productos sin imágenes | 40 |
| IDs y handles únicos | 3.297 / 3.297 |
| SKUs únicos / claves SKU repetidas | 5.923 / 66 |
| Filas de variante involucradas en SKU repetido | 164 |

El snapshot tiene precios COP positivos con cuantiles aproximados p1=891, p5=1.234, p50=6.624, p75=13.037, p95=34.821 y p99=183.087. Estos cuantiles sirven para cubrir presupuestos en el benchmark, no para fijar reglas comerciales permanentes.

## Contrato observado de órdenes

`order_data.json` tiene `data.orders.edges[].node` y cada orden contiene como máximo 10 `lineItems.edges`, sin `pageInfo`. Hay exactamente 200 órdenes, 1.855 líneas y 24.006 unidades; 897 SKUs distintos. 175 órdenes tienen exactamente 10 líneas, lo que sugiere truncamiento por límite de la consulta. No se debe tratar como historial completo.

- Fechas observadas: 2026-05-21 a 2026-05-25; es un snapshot antiguo respecto de la auditoría del 2026-08-21.
- Estados: 198 `PENDING`, 2 `PAID`; 200 `UNFULFILLED`.
- Total agregado reportado: COP 1.594.904.704,56; no es una fuente para recalcular precios actuales.
- Las 897 claves SKU de líneas sí encontraron una clave en el snapshot de productos, pero 64 líneas (510 unidades) usan una de las 66 claves SKU duplicadas. Una búsqueda por SKU duplicado no identifica un único producto.
- `customer.id` es dato potencialmente sensible y no debe indexarse, aparecer en embeddings, logs de consulta ni ejemplos de evaluación. Para popularidad solo se permiten agregados irreversibles por SKU/producto y con retención definida.

## Modelo canónico

El modelo de persistencia debe seguir `src/lib/rag/catalog/schemas.ts`:

- Producto: `product_id`, `handle`, título limpio, descripción, proveedor/tipo, tags, imágenes, estado, disponibilidad, rangos de precio, `derived`, `source_payload`, `search_text`, hash de embedding y `source_updated_at`.
- Variante: `variant_id`, `product_id`, SKU, título, precio, moneda COP, inventario y fuente, disponibilidad, opciones, payload, código/tamaño, forma y medidas.
- `source_payload` conserva autoridad de auditoría; `derived` contiene solo derivaciones deterministas; jamás se debe sobrescribir un dato crudo con una inferencia del LLM.
- Todo precio de cotización debe salir de la variante en DB, nunca del embedding, `search_text`, historial de órdenes o texto generado.

## Normalización y autoridad

1. Validar esquema y tipos antes de tocar PostgreSQL. Rechazar y registrar payloads sin ID, handle, título o variante con precio positivo; no inventar defaults silenciosos.
2. Filtrar `DRAFT` si la política es catálogo público comprable; conservar el motivo y el conteo de descartes. `status=ACTIVE` no implica disponibilidad: ambas dimensiones deben evaluarse por separado.
3. Normalizar SKU con una función única y auditable. La eliminación del prefijo `B2B-` solo puede hacerse en una clave de join explícita; conservar también el SKU original y abortar la sincronización si una clave normalizada colisiona sin resolución.
4. Disponibilidad de producto = existe una variante vendible que cumpla las reglas. Disponibilidad de variante y `inventoryQuantity` no son sinónimos. Cuando el snapshot no trae un campo, persistir `null` y no convertirlo a `false` o `0` sin política.
5. Precios `<= 0` quedan fuera de candidatos comprables y del rango de precio, pero permanecen en rechazo/auditoría. Aplicar precio y tamaño/forma sobre la misma variante (`EXISTS` con todas las condiciones), y repetir la whitelist al armar el contexto del LLM.
6. `search_text` debe ser determinista y excluir precio e inventario volátiles. Cambios de título, descripción, tags o taxonomía que alteren `search_text` invalidan el hash y exigen re-embedding; cambios de precio/stock no.
7. Filtros duros se ejecutan en SQL antes del ranking. Preferencias blandas se dejan en la consulta semántica. Un SKU inexistente con forma de SKU no se convierte en búsqueda semántica.
8. Todo upsert debe ser transaccional, idempotente por `product_id`, y acompañado de un log de sincronización. Nunca purgar el catálogo anterior ante fetch vacío o caída parcial; el umbral de caída debe ser configurable y probado.

## Taxonomía controlada actual y límites conocidos

La implementación actual deriva categorías, colores, ocasiones y forma en `src/lib/shopify/derivar.ts`:

- Categorías controladas: `globo_latex`, `globo_metalizado`, `globo_numero_letra`, `banderola_cartel`, `vela`, `kit`, `guirnalda_arco`, `complemento`, `empaque`, `desechable`.
- Colores controlados actuales: `dorado`, `dorado rosa`, `plateado`, `rojo`, `azul`, `rosado`, `verde`, `blanco`, `negro`, `morado`, `naranja`, `amarillo`, `fucsia`, `transparente`, `multicolor`.
- Ocasiones controladas: `cumpleanos`, `san_valentin`, `dia_madre`, `dia_padre`, `dia_mujer`, `navidad`, `halloween`, `graduacion`, `xv_anos`, `boda`, `baby_shower`.
- Formas decodificables de códigos de variante: `redondo`, `corazon`, `link`, `modelar`; también se decodifican medidas que no determinan forma (`N IN`, `AxB CM`).
- Diámetros conversacionales admitidos: 5, 9, 12, 18, 24 y 36 pulgadas.

El snapshot CDN contiene color compuesto, acabados, estampados y nombres que no son equivalentes a un color simple (`LILA`, `TURQUESA`, `CHAMPAGNE`, `AZUL REY`, `DORADO / NEGRO`, `NAVIDAD ROJA`, `POLKA ...`). Los tags de forma también mezclan códigos (`R-12`, `C-12`, `LOL 6`, `T260`) y conceptos de armado (`BOUQUET`). No promover estas cadenas automáticamente a filtros duros: primero mapear sinónimos y decidir qué hacer con multi-color/estampado. La cobertura y el porcentaje de `null` por atributo deben medirse en cada snapshot.

## Ranking y reproducibilidad

El retrieval actual combina full-text `spanish_unaccent` y vector con RRF (`k=60`, peso vector 0,6, texto 0,4), seguido de filtros de variante y un límite final. Los parámetros (`RAG_VECTOR_LIMIT`, `RAG_FINAL_LIMIT`, `RAG_MIN_SIMILARITY`) deben registrarse junto con cada benchmark. No introducir HNSW/IVFFlat solo por intuición: el baseline documentado tenía 1.672 productos/embeddings y ~430 ms p50 de retrieval; medir antes y después con el mismo corpus.

Toda corrida debe guardar: hash del snapshot, versión de taxonomía, modelo/dimensiones de embedding, configuración de ranking, versión del prompt/parser, fecha, muestra de consultas y métricas. Los datasets de evaluación deben ser fijos; no usar `ORDER BY random()` en una prueba de aceptación.

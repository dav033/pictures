# Reconstrucción RAG — integraciones y contratos de datos

Este inventario reconstruye qué entra al sistema, qué consume cada módulo y
qué debe cambiar para que los dos snapshots CDN sean la fuente de verdad. Los
conteos de los snapshots son observados en vivo el 2026-08-21/22; el estado de
Postgres no pudo observarse porque Docker no tiene contenedor, imagen ni
volumen.

## Mapa actual de integraciones

| Integración | Entrada/salida actual | Implementación | Estado |
|---|---|---|---|
| Catálogo público Shopify | `GET https://www.sempertex.com/products.json?limit=250&page=N` | `src/lib/rag/catalog/fetch-shopify.ts` | Fuente real del importador RAG actual; no es el primer JSON entregado |
| Inventario CDN | JSON configurado en `SHOPIFY_INVENTARIO_URL` | `obtenerInventarioCdnRag()` + `mapaInventarioCDN()` | Se espera un array reducido de productos/variantes, no el contrato real actual |
| Snapshot de órdenes | Ningún consumidor | `rg` no encuentra `order_data.json`, `orders` ni una URL equivalente | Completamente desconectado del RAG |
| Normalización | REST Shopify → modelo canónico | `src/lib/rag/catalog/normalize.ts` | Reutiliza `src/lib/shopify/derivar.ts`; no acepta camelCase GraphQL sin adaptador |
| Persistencia | Modelo canónico → `catalog_products`/`catalog_variants` | `src/lib/rag/catalog/persist.ts` | Transaccional en el importador, pero borra/reinserta variantes por producto |
| Embeddings | `search_text` → Gemini → `VECTOR(768)` | `scripts/generate-embeddings.ts`, `src/lib/rag/embeddings.ts` | Requiere `GEMINI_API_KEY`; no puede ejecutarse hoy |
| Retrieval | SQL FTS + pgvector + SKU exacto | `src/lib/rag/retrieval/search.ts` | Implementado; requiere tablas/embeddings |
| Chat | Intent estructurado + herramientas RAG | `src/lib/rag/chat/*`, `src/lib/ia/registro-herramientas.ts` | Implementado detrás de `RAG_ENABLED` |
| Sync HTTP Shopify | Fetch REST → SQLite | `src/app/api/shopify/sync/route.ts`, `src/lib/shopify/sincronizar.ts` | No actualiza Postgres; puede divergir del RAG |
| Webhooks | HMAC Shopify REST/Admin → Postgres | `src/app/api/rag/webhooks/shopify/route.ts` | Requiere `SHOPIFY_WEBHOOK_SECRET`; no cubre snapshots CDN ni órdenes |

## Incompatibilidad exacta de `products_catalog.json`

El importador actual hace esto:

```text
productos = GET /products.json (REST público)
inventario = GET SHOPIFY_INVENTARIO_URL
inventarioMap = cada inventario[].variants[].sku -> inventoryQuantity
normalizar(productos REST, inventarioMap)
```

El archivo entregado como `SHOPIFY_INVENTARIO_URL` no es un simple mapa de
inventario. Es un catálogo completo de 3.297 productos y 6.136 variantes con
contrato GraphQL/camelCase:

```json
{
  "id": "gid://shopify/Product/8634150912295",
  "title": "B2B ...",
  "handle": "b2b-...",
  "status": "DRAFT",
  "productType": "DECORACION",
  "vendor": "SEMPERTEX B2B",
  "tags": ["..."],
  "updatedAt": "2026-05-22T15:55:33Z",
  "variants": [{
    "id": "gid://shopify/ProductVariant/46594052849959",
    "sku": "B2B-30002979",
    "price": "4444.00",
    "title": "PAQUETE X 1",
    "availableForSale": false,
    "inventoryQuantity": 0
  }],
  "images": [{"id": "...", "url": "https://cdn...", "altText": ""}]
}
```

El `mapaInventarioCDN()` actual sí puede extraer `sku` e
`inventoryQuantity` por coincidencia de nombres, pero el resto del pipeline
continúa usando el REST público para producto. Si se cambia el fetch para usar
este JSON directamente sin un adaptador, ocurren pérdidas silenciosas:

| Campo real CDN | Campo que espera el normalizador | Efecto de pasar el objeto directo |
|---|---|---|
| `productType` | `product_type` | `derivarCategoria()` recibe `null`; categorías quedan incompletas |
| `status` | no se lee | `CatalogProduct.status` queda hardcodeado `ACTIVE`; entran DRAFT |
| `updatedAt` | `updated_at` | se pierde protección de orden temporal |
| `availableForSale` | `available` | todas las variantes se vuelven no disponibles por `Boolean(undefined)` |
| `images[].url` | `images[].src` | productos sin imagen aunque el CDN sí la tenga |
| no hay `body_html` | `body_html` | descripción nula; solo título/tags quedan para búsqueda |
| no hay `option1` | `option1` | no se decodifican tamaño/forma/diámetro |
| IDs GID string | REST IDs numéricos | la unión webhook/REST/órdenes puede duplicar entidades si no se canoniza |
| `variant.title` | `title` + `option1` | el nombre del paquete se conserva, pero no existe opción estructurada |

La solución debe ser un adaptador de fuente explícito, no un `as` de TypeScript:

1. Validar el JSON raíz, cada producto y cada variante con Zod; rechazar y
   contabilizar registros malformados.
2. Canonicalizar IDs GID a un formato estable común a todas las fuentes (por
   ejemplo el ID numérico como texto) y guardar el GID original en
   `source_payload`. Alternativamente, conservar GID en toda la base; lo que no
   es seguro es mezclar GID y numérico según el camino de entrada.
3. Mapear `productType → product_type`, `updatedAt → source_updated_at`,
   `availableForSale → available`, `images.url → image_urls` y conservar
   `compareAtPrice`/`barcode` dentro del payload o en columnas propias si serán
   consultados.
4. Aplicar una política de estado antes del upsert. Para recomendaciones
   públicas, la opción conservadora es `status=ACTIVE`; los 1.806 DRAFT no
   deben ser recuperables aunque tengan 190 productos con alguna variante
   vendible. La política debe quedar visible en el filtro y en las métricas.
5. Filtrar precio no positivo a nivel de variante. Un producto solo entra si
   conserva al menos una variante con precio positivo. Los 278 ceros y 161
   productos sin precio son datos de rechazo, no candidatos.
6. No inventar una descripción: si la fuente no la trae, usar un `search_text`
   explícitamente construido desde título, product type, tags, variante, color,
   ocasión y SKU; marcar la descripción como ausente.
7. No inventar tamaño/forma desde una cadena ambigua. `006_tamanos_variante.sql`
   y `decodificarTamano()` esperan `option1`, pero el snapshot actual no lo
   entrega. Se puede conservar `variant.title` y extraer solo patrones
   verificables (por ejemplo `R-12` si aparecen literalmente); el resto debe
   quedar `NULL` y no pasar filtros físicos como si fuera conocido.

## `order_data.json`: qué representa y cómo integrarlo sin contaminar RAG

El snapshot tiene forma de respuesta GraphQL:

```text
data.orders.edges[].node
  ├─ id, name, createdAt
  ├─ displayFinancialStatus, displayFulfillmentStatus
  ├─ totalPriceSet.shopMoney
  ├─ customer.id
  └─ lineItems.edges[].node
       ├─ id, title, quantity
       └─ variant.id, sku, product.id
```

Todos sus 1.855 line items tienen correspondencia con `products_catalog.json`.
Eso permite construir, durante una ingestión separada, un agregado por
`variant_id`/SKU:

```text
variant_id, sku, order_count, units_sold, first_order_at, last_order_at,
source_snapshot_hash
```

Recomendación de uso:

- Mantener el precio y la disponibilidad exclusivamente desde el snapshot de
  productos (o desde un futuro feed de inventario), nunca inferirlos del total
  de la orden.
- No insertar `customer.id`, nombre de cliente, IDs de orden ni line items
  crudos en `rag_query_log`, embeddings, prompts o respuestas. Si se necesita
  auditoría, guardar el RAW en una zona separada con retención y acceso mínimo,
  o solo un hash de snapshot.
- Usar `units_sold` como señal de popularidad de bajo peso/tie-breaker, no como
  filtro duro. Con 200 órdenes, una ventana de cinco días, 198 `PENDING` y solo
  2 `PAID`, no hay evidencia para afirmar “más vendido” ni para penalizar
  productos nuevos.
- Definir explícitamente qué estados cuentan. La opción prudente para
  “ventas realizadas” es `PAID`/`FULFILLED`; con el snapshot actual produciría
  una señal muy pequeña. Si se usa también `PENDING`, denominarla “demanda
  observada”, no venta confirmada.
- Guardar el hash/URL/version de cada snapshot para que un ranking pueda
  reproducirse y para que una nueva descarga no sume dos veces las mismas
  órdenes. La suma debe ser idempotente por `order.id + lineItem.id` o por un
  hash estable.

No se recomienda usar un framework de agentes para este agregado: una tabla de
hechos/aggregates y SQL determinista son más auditables que una cadena de
document loaders.

## Contrato canónico recomendado

La capa de adaptación debe entregar el mismo modelo que ya valida
`CatalogProductSchema`/`CatalogVariantSchema`, con estos ajustes funcionales:

### Producto

- `product_id`: ID canónico estable de Shopify como texto; conservar GID en
  `source_payload`.
- `title`, `handle`, `vendor`, `tags`, `image_urls`, `source_updated_at`: campos
  de la fuente ya saneados.
- `product_type`: `productType` mapeado; mantener el valor original para
  diagnóstico.
- `status`: distinguir `ACTIVE`/`DRAFT` y filtrar según política, no forzar
  siempre `ACTIVE`.
- `available`: solo una señal de compra actual (por ejemplo, alguna variante
  con `availableForSale` y precio válido); mantener `inventory_quantity` por
  separado para límites de cantidad.
- `description_text`: `NULL` cuando no existe; jamás generar hechos con LLM
  durante la importación.
- `derived`: categoría, colores y ocasiones deterministas. La taxonomía actual
  en `src/lib/shopify/derivar.ts` cubre product types B2B conocidos, pero debe
  probarse con los 775 tags distintos del snapshot.
- `search_text`/hash: no incluir precio ni stock; sí incluir título, tipo,
  tags, colores, ocasiones, variantes y SKU.

### Variante

- `variant_id`, `sku`, `price`, `available`, `inventory_quantity` desde el
  snapshot real.
- `title` debe conservar `PAQUETE X N` y el texto original; no confundir ese
  título con un tamaño físico.
- `options` debe conservar un JSON de origen explícito (`variant_title`,
  `barcode`, `compareAtPrice`, etc.) en vez de rellenar `option1` inventado.
- `codigo_tamano`, `forma`, `diam_pulg`, etc. deben ser `NULL` si no hay patrón
  comprobable. Si se detectan patrones en títulos, guardar el valor raw y la
  regla/version que lo derivó para poder auditar falsos positivos.

## Índices y consultas que deben verificarse en la DB restaurada

Consultas críticas reales identificadas en `search.ts` y `chat`:

1. SKU exacto: `catalog_variants.sku = $1` + unión a producto y disponibilidad.
2. Vector: `catalog_embeddings.embedding <=> $1::vector` + filtros de
   producto/variante + `LIMIT`.
3. FTS: `catalog_products.search_tsv @@ plainto_tsquery('spanish_unaccent',$1)`
   + ranking.
4. Precio/disponibilidad por la misma variante: `EXISTS` sobre
   `catalog_variants` con `product_id`, `available`, `price` y, cuando existe,
   forma/diámetro.
5. Facetas: `p.derived->>'category'`, `p.derived->'colors' ?| ...` y
   `p.derived->'occasions' ?| ...`.
6. Detalle final: `product_id = ANY($1::text[])` para reconstruir variantes
   permitidas.

Después de aplicar migraciones y cargar una base temporal, capturar
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` para cada consulta con casos de:

- SKU exacto existente y SKU inexistente;
- nombre/tags con y sin acento;
- `precioMax` donde una variante barata y otra cara conviven en el mismo
  producto (debe pasar solo la variante que cumple);
- color + forma/tamaño en la misma variante;
- producto `DRAFT` con variante disponible (debe quedar fuera de la vista
  pública);
- búsqueda sin resultados y búsqueda de catálogo amplio.

No activar HNSW/IVFFlat ni un framework externo antes de guardar un baseline de
latencia, recall@5/10/20, precisión de filtros duros, zero-result rate y costo
de embeddings. Para el tamaño actual, mejorar facetas/normalización y el
adaptador de datos tiene más impacto y menos riesgo que reemplazar el motor.

## Webhooks, snapshots y consistencia

El receptor `src/app/api/rag/webhooks/shopify/route.ts` valida HMAC y usa
`catalog_webhook_log` para deduplicar; el procesador espera payload REST/Admin
con `body.id` numérico, `body.product_type`, `body.body_html`,
`variant.available` y `variant.inventory_quantity`. No acepta el snapshot
GraphQL tal cual y tampoco procesa órdenes.

Para el nuevo flujo se deben distinguir dos caminos:

- **Bootstrap/rebuild:** descargar los dos snapshots con timeout/reintentos,
  validar contrato, calcular hash, importar en staging y publicar solo si las
  invariantes pasan. No borrar la base viva antes de validar que el conteo no
  cayó anormalmente.
- **Cambios incrementales:** seguir con webhook/API de Shopify si está
  disponible, usando el mismo adaptador canónico y la misma regla de IDs; o
  volver a descargar snapshots versionados si no existe una fuente incremental.

El `DELETE FROM catalog_variants WHERE product_id = $1` del upsert actual es
correcto para un rebuild por producto, pero exige importar todas las variantes
válidas de una fuente consistente. Para órdenes, nunca reusar este camino ni
mezclar una orden parcial con un catálogo nuevo sin una etiqueta de snapshot.

## Validación end-to-end pendiente

Con Postgres y secretos disponibles, el orden mínimo de prueba debe ser:

1. Levantar el compose en una base temporal y comprobar `pg_extension` para
   `vector` y `unaccent`.
2. Ejecutar `npm run rag:migrate` y validar que las seis migraciones quedan en
   `schema_migrations`.
3. Ingerir `products_catalog.json` por el adaptador nuevo; comprobar conteos,
   DRAFT excluidos, precios positivos, IDs únicos, imágenes y variantes sin
   huérfanos.
4. Ingerir el agregado de órdenes en una tabla separada; comprobar idempotencia
   ejecutando el mismo snapshot dos veces.
5. Generar embeddings solo para productos aprobados y validar dimensión/hash.
6. Ejecutar `npm run rag:eval`, `rag:eval-parser`, `rag:test-validation` y los
   casos de precio/color/forma/tamaño descritos arriba.
7. Probar la API/chat real: consulta → retrieval → whitelist → confirmación →
   subtotal resuelto desde DB. Verificar que ningún precio, SKU, imagen o ID
   viene de la salida del LLM.
8. Repetir con snapshot sin cambios: debe haber cero reembeddings y cero
   incrementos duplicados de popularidad.

La prueba E2E no puede declararse aprobada mientras no existan contenedor,
`DATABASE_URL` y `GEMINI_API_KEY` funcionales; esas condiciones no están
presentes en el workspace inspeccionado.

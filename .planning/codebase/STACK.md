# Reconstrucción RAG — stack e infraestructura

Fecha de inspección: 2026-08-21/22 (America/Bogota). Este documento separa
evidencia observada de hipótesis. No se modificaron datos, esquema, código
operativo ni contenedores durante la inspección.

## Estado comprobable hoy

El repositorio trae una implementación RAG sobre Postgres/pgvector, pero el
estado de ejecución local está vacío:

- Docker Desktop responde con engine `desktop-linux`, cliente/servidor 29.7.2
  y Compose v5.4.0.
- `docker compose config` resuelve un único servicio: `postgres`, imagen
  `pgvector/pgvector:pg16`, puerto `5432:5432`, volumen
  `rag_postgres_data:/var/lib/postgresql/data` y healthcheck con `pg_isready`.
- `docker compose ps -a` no muestra contenedores; `docker image ls` no muestra
  imágenes; `docker volume ls` no muestra volúmenes. El puerto TCP 5432 tampoco
  está escuchando.
- `.env.local` existe pero está vacío. No hay `.env` en el workspace y no están
  definidas en el proceso `DATABASE_URL`, `GEMINI_API_KEY`, las URLs Shopify ni
  los flags RAG. Por esto no se pudo conectar a Postgres, leer tablas, ejecutar
  `EXPLAIN`, comprobar extensiones, ni confirmar conteos previamente importados.
- `psql` instalado en el host: PostgreSQL client 17.0.9.0. No hay servidor local
  detrás de `localhost:5432`.

Esto significa que cualquier afirmación sobre filas, índices físicos, tamaño de
la base, planes reales de ejecución o embeddings existentes debe tratarse como
no verificada hasta levantar/restaurar el servicio y cargar la configuración.

## Versiones y dependencias del proyecto

| Componente | Versión/fuente |
|---|---|
| Next.js | 16.3.0 |
| React / React DOM | 19.2.8 |
| Node observado | v22.19.0 |
| `pg` | `^8.23.0` |
| `@google/genai` | `^2.16.0` |
| `tsx` | `^4.23.12` |
| Zod | `^4.4.3` |
| Postgres previsto | 16, imagen `pgvector/pgvector:pg16` |
| pgvector previsto | el que incluye la imagen `pgvector/pgvector:pg16`; versión exacta pendiente de runtime |

No hay LangChain, LlamaIndex ni otro framework RAG instalado. El pipeline está
hecho con `pg`, SQL explícito, RRF propio, parser estructurado de Gemini y
validación determinista en TypeScript.

## Cómo está compuesto el RAG actual

1. `scripts/migrate.ts` lee `DATABASE_URL`, ejecuta las migraciones SQL en orden
   y registra nombres en `schema_migrations`.
2. `scripts/import-shopify-catalog.ts` descarga productos públicos paginados y
   un JSON de inventario, normaliza con derivaciones deterministas y hace
   upsert transaccional en Postgres. También guarda un snapshot local bajo
   `data/raw/shopify-products.snapshot.json` (ignorado por git).
3. `scripts/generate-embeddings.ts` calcula embeddings Gemini para los
   `search_text` cuyo hash cambió y los guarda en `catalog_embeddings`.
4. `src/lib/rag/retrieval/search.ts` combina lookup exacto de SKU, búsqueda
   vectorial y FTS con Reciprocal Rank Fusion (RRF); los filtros duros se
   aplican antes del ranking y los filtros de variante intentan quedar en la
   misma fila/`EXISTS`.
5. `src/lib/rag/chat/buscar.ts` interpreta la consulta, aplica una escalera
   explícita para ocasión/color y obtiene variantes permitidas. La ruta de
   presupuesto (`buscar-presupuesto.ts`) añade retrieval por rol, reranking,
   diversidad y ensamblaje de canasta.
6. `src/lib/rag/chat/validar.ts` vuelve a resolver precio, disponibilidad,
   inventario y subtotal contra la DB; no confía en nombres/precios enviados
   por el LLM.

El endpoint `src/app/api/shopify/sync/route.ts` llama al sincronizador antiguo
de SQLite (`src/lib/shopify/sincronizar.ts`), no al importador de Postgres del
RAG. Son dos pipelines de sincronización potencialmente divergentes.

## Esquema previsto por las migraciones

### Catálogo

`001_init.sql` crea:

- `catalog_products`: producto canónico, texto de búsqueda, `derived` JSONB,
  payload de origen, disponibilidad, min/max de precio y `search_tsv` generado.
- `catalog_variants`: SKU, precio, disponibilidad, inventario, opciones y
  payload de variante, relacionado a producto con `ON DELETE CASCADE`.
- `catalog_embeddings`: un vector `VECTOR(768)` por producto, hash del texto y
  nombre de modelo.
- `catalog_rejections` y `catalog_sync_log` para rechazos y corridas.

Índices declarados originalmente: GIN sobre `search_tsv`, B-tree en
`product_type`, `available`, `catalog_variants.product_id` y `sku`. No se
declara índice ANN (HNSW/IVFFlat): el comentario de la migración lo descartó
por el catálogo pequeño y usa distancia exacta.

### Texto, webhooks y observabilidad

- `002_unaccent_fts.sql` habilita `unaccent` y crea la configuración
  `spanish_unaccent`; recrea el `tsvector` generado si todavía usa `spanish`.
- `003_webhooks.sql` añade `source_updated_at`, `catalog_webhook_log` e índice
  por producto.
- `004_observability.sql` crea `rag_query_log` con request, intent, IDs
  recuperados/seleccionados, scores, latencias y errores.
- `005_franjas_presupuesto.sql` crea `presupuesto_franjas`, columnas de canasta
  en `rag_query_log` e índice `(product_id, available, price)` en variantes.
- `006_tamanos_variante.sql` añade `codigo_tamano`, `forma`, `diam_pulg`,
  `largo_pulg`, `ancho_cm`, `alto_cm` e índice `(product_id, forma, diam_pulg)`.

Compatibilidad que debe comprobarse al restaurar una base previa: el esquema
fija `catalog_embeddings.embedding` en `VECTOR(768)` y
`generate-embeddings.ts` valida también exactamente 768 dimensiones, aunque la
dimensión puede configurarse con `GEMINI_EMBEDDING_DIMENSIONS`. Si ese env var
se cambió en la instalación perdida, los inserts/health checks no son
compatibles hasta fijar 768 o versionar la tabla/índice para otra dimensión.
Asimismo, una base que llegue solo hasta `005` no tiene las columnas que el
resolver de tamaños consulta; `006_tamanos_variante.sql` es obligatoria antes
de ejecutar ese flujo.

### Consecuencias de los índices actuales

Los filtros de categoría, colores y ocasiones consultan expresiones dentro de
`catalog_products.derived` (`->>`, `?|`) pero no tienen GIN ni tablas de facetas
normalizadas declaradas. Es el primer candidato a medir con
`EXPLAIN (ANALYZE, BUFFERS)` después de restaurar la DB. El filtro de variante
de precio/disponibilidad sí tiene apoyo parcial con el índice de `005`, aunque
la selectividad y el orden óptimo dependen de los datos reales.

Con el tamaño histórico documentado en `PLAN_RENDIMIENTO_RAG.md` (1.672
productos, 3.727 variantes, 1.672 embeddings), el retrieval se midió en el
orden de p50 430 ms/p95 1.388 ms; esas cifras son históricas y no fueron
reproducidas porque la base no está presente. El snapshot nuevo tiene casi el
doble de variantes, por lo que debe medirse de nuevo antes de agregar ANN.

## Fuente CDN observada

Se descargaron los dos enlaces entregados, sin guardar los archivos en el
workspace:

### `products_catalog.json?v=1779763986`

- Respuesta HTTP 200, `application/json`, aproximadamente 5.151.603 bytes.
- 3.297 productos y 6.136 variantes.
- Estructura GraphQL/camelCase: `id`, `title`, `handle`, `status`,
  `productType`, `vendor`, `tags`, `createdAt`, `updatedAt`, `variants`,
  `images`.
- Producto: 1.491 `ACTIVE`, 1.806 `DRAFT`; no deben mezclarse sin una política
  explícita de visibilidad.
- Variantes: 3.813 `availableForSale=true`, 2.323 `false`; 3.782 tienen
  inventario positivo y 2.331 inventario cero. Hay 31 variantes con
  `availableForSale=true` e inventario cero, así que disponibilidad e inventario
  no son exactamente la misma señal.
- 278 variantes tienen precio `<= 0`; 161 productos tienen todas sus variantes
  con precio no positivo. Hay 40 productos sin imágenes y 16 sin tags.
- Los product types más frecuentes son `LÁTEX` (1.111), `GLOBOS METALIZADOS`
  (643), `DESECHABLES` (455), `DECORACION` (435), vacío (184), `VELAS Y
  ACCESORIOS` (136), `FIESTAS PREDISEÑADAS` (78), `ACCESORIOS FIESTA` (76),
  `EMPAQUES DE REGALO` (75) y `E-DECORS` (62).
- La variante tiene `id`, `sku`, `price`, `compareAtPrice`, `title`,
  `availableForSale`, `inventoryQuantity`, `barcode`. No tiene `option1`,
  `option2`, `option3`, `grams` ni precio histórico.
- La imagen usa `{id,url,altText}`; no usa `{src}`. No existe `body_html` ni
  descripción textual equivalente.

### `order_data.json?v=1779763985de`

- Respuesta HTTP 200, `application/json`, aproximadamente 1.204.158 bytes.
- Envoltorio `{data:{orders:{edges:[...]}}}`; contiene 200 órdenes y 1.855
  line items, 905 variantes distintas y 897 SKUs distintos.
- Las líneas enlazan consistentemente con el catálogo: 1.855/1.855 coinciden
  por variant ID, SKU y producto.
- Ventana temporal observada: 2026-05-21 a 2026-05-25. Estado financiero:
  198 `PENDING`, 2 `PAID`; fulfillment: 200 `UNFULFILLED`.
- Contiene `customer.id`, IDs de órdenes y líneas. Es dato sensible de negocio:
  no debe llegar a prompts, respuestas ni logs de búsqueda.
- Tiene cantidad vendida, pero no precio unitario por línea. El total de orden
  no sirve para atribuir precio por producto sin una política adicional. Los
  datos de órdenes deben alimentar, como mucho, un agregado de popularidad
  débil/explicable; no son fuente de precio ni sustituyen disponibilidad.

## Decisiones de infraestructura para la reconstrucción

- Mantener Postgres + pgvector y el SQL determinista. Para 3.297 productos,
  exact scan vectorial sigue siendo una hipótesis razonable, pero hay que
  medirlo; HNSW se agrega solo si el benchmark real lo justifica o la escala
  crece significativamente.
- Añadir índices/facetas para atributos que se filtran repetidamente (color,
  categoría, ocasión, forma/tamaño) después de observar `EXPLAIN`; preferir
  columnas/tablas tipadas para precio, disponibilidad, forma y diámetro sobre
  esconder estos datos en JSONB.
- No agregar LangChain/LlamaIndex solo por usar un framework: el flujo necesita
  restricciones de precio/variante y validación de IDs que esos frameworks no
  resuelven automáticamente. Un framework podría encapsular un retriever, pero
  aumentaría dependencias y ocultaría el SQL crítico sin beneficio demostrado.
- `pg_trgm` es una opción acotada para títulos/handles/SKU con errores de
  escritura; no reemplaza el FTS ni debe gobernar precio/disponibilidad.
- El compose actual expone Postgres en todas las interfaces (`5432:5432`) y
  usa `demo/demo` hardcodeado. Es tolerable para un entorno desechable local,
  no para producción; se debe parametrizar secreto y enlazar a localhost o red
  privada.

## Bloqueadores para E2E

1. No existe contenedor/volumen/imagen ni una `DATABASE_URL` funcional.
2. No hay `GEMINI_API_KEY`, por lo que tampoco se puede probar la generación
   real de embeddings.
3. El importador actual no acepta directamente el contrato de los dos JSON
   proporcionados (ver `INTEGRATIONS.md`).

El siguiente paso seguro es provisionar/restaurar un Postgres temporal, aplicar
las seis migraciones, implementar un adaptador versionado para el snapshot CDN,
importar en una base nueva y medir invariantes/planes antes de decidir cambios
permanentes.

# Auditoría Etapa 1 — Dominio B: RAG y catálogo

**Repositorio:** `C:\Users\davidt\Downloads\demo-decoracion`  
**Fecha:** 2026-09-07  
**Resultado:** auditoría documental y estática. No se ejecutaron proveedores, producción, operaciones pagadas ni escrituras de catálogo.

## 1. Resumen ejecutivo

El dominio tiene tres recorridos de datos coexistentes:

1. **Legado SQLite:** catálogo web, `/api/catalogo/piezas`, `/api/shopify/sync`, productos seed y herramientas cuando `RAG_ENABLED=false`.
2. **RAG PostgreSQL v2:** importación REST/CDN, búsqueda híbrida, validación comercial, embeddings opcionales, webhook Shopify y consumidores de chat/plan.
3. **CDN v3 staged:** contratos, manifests, canonicalización y publicación transaccional preparados, pero sin comando de publicación independiente ni consumidor comercial completo.

La fuente comercial que debe preservarse para una futura migración es PostgreSQL RAG: producto, variante, precio, estado, disponibilidad e inventario. El modelo no puede inventar esos datos. SQLite debe mantenerse hasta probar paridad porque aún sirve rutas y páginas visibles.

La recomendación es una migración gradual por adaptadores: primero contratos y lectura RAG determinista; después escritura/importación y embeddings con control de modelo/dimensión; dejar para una etapa posterior el catálogo v3 staged y la escena comercial, que todavía contiene contratos incompletos y valores stub.

## 2. Alcance, rutas reales y ausencias

### Rutas encontradas

| Ruta | Comportamiento observado | Fuente |
|---|---|---|
| `src/app/api/catalogo/piezas/route.ts` | `POST` de búsqueda con `FiltrosCatalogo`; hace cast del JSON, llama búsqueda legacy y devuelve `{productos,total}` | SQLite `shopify_*` |
| `src/app/api/catalogo/imagenes/route.ts` | `GET` por `variant_id`; máximo 96 ids, producto `ACTIVE`; devuelve imagen por variante/producto | PostgreSQL |
| `src/app/api/productos/route.ts` | CRUD parcial de productos seed; `DELETE` elimina todos los seed y sus imágenes | SQLite seed |
| `src/app/api/productos/[id]/route.ts` | `PATCH`/`DELETE` de un producto seed mediante multipart | SQLite seed |
| `src/app/api/shopify/sync/route.ts` | `POST` sincroniza catálogo completo y `GET` consulta estado | SQLite legacy; no actualiza PostgreSQL RAG |
| `src/app/api/rag/webhooks/shopify/route.ts` | Verifica HMAC sobre el cuerpo crudo, deduplica y procesa `products/create|update|delete` | PostgreSQL RAG |
| `src/app/api/chat/route.ts` | SSE de conversación; expone candidatos, validaciones, rechazos y plan | Herramientas RAG/plan |
| `src/app/api/plan-editar/route.ts` | Búsqueda, alternativas, recomendaciones y edición con whitelist de variantes | PostgreSQL RAG + reglas de plan |
| `src/app/api/references/analyze/route.ts` | Con plan/RAG usa modo perceptual sin catálogo; en legado mezcla seed y SQLite Shopify | SQLite o flujo de plan |
| `src/app/catalogo/page.tsx` y `[handle]/page.tsx` | Exploración, facetas y detalle de catálogo | SQLite legacy |

### Ausencias verificadas

- No hay otra ruta de API de catálogo PostgreSQL para búsqueda general; `imagenes` es la única ruta PG directa dentro de `src/app/api/catalogo/`.
- No hay ruta que conecte `scripts/import-cdn-catalog.ts` con una operación HTTP.
- No hay implementación concreta de `SceneSourceAdapter`; el archivo existente define el contrato.
- No hay un servicio Python RAG ni adaptador Python visible en el alcance revisado; `services/image-api/` no aporta esa implementación.
- No existe comando independiente `promote(snapshot_id)` para el pipeline staged.
- Las migraciones SQL no tienen migraciones `down` observadas.
- No se observó suite Jest/Vitest ni script `test` general; hay scripts `tsx`, evaluaciones y pruebas específicas.

## 3. Mapa de flujo

```text
Shopify REST público + CDN inventory
        │
        ├─ scripts/import-shopify-catalog.ts
        │      └─ normalizarProducto v2 → upsert transaccional
        │             └─ PostgreSQL: catalog_products / catalog_variants
        │                    └─ scripts/generate-embeddings.ts → catalog_embeddings VECTOR(768)
        │                           └─ búsqueda FTS + trigram + vector opcional
        │                                  ├─ /api/chat → herramientas RAG → validar selección → SSE
        │                                  └─ /api/plan-editar → plan/alternativas/recomendaciones
        │
        ├─ POST /api/rag/webhooks/shopify
        │      └─ HMAC + idempotencia + stale-check → upsertProducto PostgreSQL
        │
        └─ scripts/import-cdn-catalog.ts
               └─ contratos Zod + manifest SHA-256 + staging/publish v3
                      └─ tablas de fuentes/ofertas/capacidades de escena
                         (sin adaptador comercial completo ni consumidor principal)

Shopify REST + CDN inventory
        └─ /api/shopify/sync → sincronizar.ts → SQLite shopify_producto/shopify_variante
               ├─ /api/catalogo/piezas
               ├─ /catalogo y /catalogo/[handle]
               ├─ consumidores legacy de referencias
               └─ herramientas legacy cuando RAG_ENABLED=false

Seed SQLite
        └─ /api/productos y /api/productos/[id]
```

## 4. Inventario de contratos y consumidores

### Contratos de catálogo

- `src/lib/rag/catalog/schemas.ts`: `CatalogProductSchema` y `CatalogVariantSchema`, con ids, SKU, precio COP, disponibilidad, inventario, tamaño, colores, unidades de paquete, `source_payload`, `search_text`, hash y fecha de fuente.
- `src/lib/shopify/tipos.ts`: tipos REST públicos, variantes, inventario CDN y tipos canónicos legacy.
- `src/lib/rag/sources/contracts.ts`: contratos Zod para fuente CDN GraphQL, `SourceKind`, manifest y rechazo de identidad sensible.
- `src/lib/rag/chat/buscar.ts`: `ResultadoBusquedaRag` con estados `OK`, `NO_MATCH` y `AMBIGUOUS_SKU`; candidatos agrupados por producto y variante.
- `src/lib/rag/chat/validar.ts`: contrato de selección same-turn; comprueba whitelist, pertenencia producto-variante, cantidad, disponibilidad y precio desde PostgreSQL.
- `src/lib/shopify/consultas.ts`: `FiltrosCatalogo`, búsqueda FTS legacy, facetas, `Producto` genérico y relajación ordenada.
- `src/lib/rag/webhooks/verificar.ts`: HMAC SHA-256 sobre bytes del cuerpo; `procesar.ts` deduplica por `x-shopify-webhook-id`.
- `src/lib/rag/embeddings.ts`: texto + tarea `RETRIEVAL_DOCUMENT|RETRIEVAL_QUERY`; salida numérica finita de dimensión exacta.

### Consumidores relacionados

| Consumidor | Contrato que usa | Observación de migración |
|---|---|---|
| `src/lib/ia/registro-herramientas.ts` | `buscar_catalogo_rag`, `confirmar_seleccion_rag`, presupuesto y plan | Es el consumidor comercial principal; registra whitelist e ids same-turn. |
| `src/lib/ia/herramientas.ts` | Schemas y reglas del prompt de herramientas | Exige SKU exacto, no inventar precios y respetar restricciones físicas. |
| `src/lib/rag/retrieval/search.ts` | Filtros duros + FTS/trigram/vector | Vector es opcional; el fallback lexical permite operación sin Gemini. |
| `src/lib/rag/chat/buscar-presupuesto.ts` | búsqueda por roles, presupuesto y canasta | Reutiliza embedding de consulta si está disponible. |
| `src/lib/rag/query-parser/parse.ts` | intención determinista y Gemini solo ante ambigüedad | No todo el flujo sin vector es necesariamente sin proveedor si existe `GEMINI_API_KEY`. |
| `src/lib/products.ts` | seed SQLite y tabla `shopify_variante` SQLite | Mezcla fuentes; sus etiquetas de procedencia no deben confundirse con PostgreSQL. |
| `src/lib/rag/retrieval/by-scene-slot.ts` | búsqueda por slot de escena | Actualmente devuelve `offer_id=stub-offer` y `snapshot_id=stub-snapshot`; no es fuente comercial. |
| `src/lib/rag/sources/verified-assets.ts` | tablas v3 de activos/ofertas verificadas | Existe consulta, pero no está conectada al retrieval por slot. |
| `src/lib/scene/orchestrator.ts` | pipeline shadow de escena | Solo se activa con `SCENE_PLAN_V2_SHADOW`; alcance experimental. |

## 5. Dependencias y límites técnicos

### Runtime y datos

- Next.js App Router para rutas y páginas.
- PostgreSQL mediante `pg`, `DATABASE_URL`, migraciones ordenadas en `scripts/migrate.ts`.
- `pgvector` para `catalog_embeddings`, `unaccent` y `pg_trgm` para recuperación lexical.
- Google Gemini mediante `@google/genai`, `GEMINI_API_KEY`; el embedding por defecto es `gemini-embedding-2` con dimensión 768.
- Shopify REST público y CDN de inventario; URLs por defecto en `src/lib/rag/catalog/fetch-shopify.ts` y `src/lib/shopify/sincronizar.ts`.
- Zod para contratos CDN/catálogo seleccionados; varias rutas HTTP aún usan casts directos.
- SQLite legacy para catálogo visible, sync antiguo y seed.

### Embeddings

| Punto | Estado |
|---|---|
| Generación documental | `scripts/generate-embeddings.ts`, una llamada por producto cuyo `embedding_source_hash` cambió. |
| Consulta | `search.ts` y `buscar-presupuesto.ts`, solo si `RAG_USE_VECTOR=true` y hay credencial. |
| Almacenamiento | `catalog_embeddings.embedding VECTOR(768)`, `model`, hash y timestamps. |
| Recuperación | RRF: FTS `.55`, trigram `.30`, vector `.15`; falla vectorial cae a lexical. |
| Reintentos | Compartidos desde `src/lib/retry.ts`; 429/5xx y errores desconocidos pueden reintentarse. |
| Compatibilidad | La dimensión de base es fija; el generador también verifica 768 aunque el entorno permita otra dimensión. Cambiar modelo/dimensión exige re-embedding y plan de compatibilidad. |
| Costo | No hay tarifa ni presupuesto en el repositorio. El costo escala con productos cambiados, consultas vectoriales, slots y parseos ambiguos; reintentos pueden aumentar consumo. |

`src/lib/rag/db.ts` crea un pool singleton sin límites explícitos de tamaño, conexión o statement timeout visibles en el archivo auditado. Debe tratarse como riesgo operacional antes de aumentar concurrencia.

## 6. Reglas de negocio a preservar

1. **Autoridad comercial:** precio, moneda, disponibilidad, inventario, SKU y variante provienen del catálogo; nunca del texto del modelo ni de una tabla de escena no verificada.
2. **Elegibilidad:** productos `ACTIVE`, variantes con precio positivo y filtros duros de disponibilidad, forma, diámetro, categoría, ocasión, color/acabado y precio.
3. **Restricciones de fuente:** el normalizador excluye `CURSOS`, `MERCHANDISING` y `KIT MERCADOLIBRE`; se deben conservar sus exclusiones y revisar explícitamente la regla legacy que elimina opciones `E-DECORS ARCO/BOUQUET`.
4. **Búsqueda:** estilos son señales blandas; tamaño, forma, diámetro, precio y disponibilidad explícitos son duros. La relajación es limitada: ocasión/color pueden relajarse; tamaño y forma no.
5. **SKU:** coincidencia exacta, diferenciación entre no encontrado, filtrado y ambiguo; no resolver silenciosamente una colisión.
6. **Selección:** ids de producto y variante deben provenir de candidatos de la misma vuelta; la validación debe volver a consultar datos comerciales y calcular subtotal en código.
7. **Físico y empaque:** conservar decodificación de tamaños/diámetros, formas inequívocas, `LOL-660`, unidades de paquete y advertencias de cantidades. No convertir “desconocido” en una unidad implícita en RAG.
8. **Inventario:** `available=true` es la señal comercial autoritativa; el inventario limita cantidad cuando está disponible. No afirmar stock por una señal parcial.
9. **Eventos y presupuesto:** intención de evento es evidencia adicional; bandas y canastas usan reglas deterministas y no cálculos de precio del LLM.
10. **Plan y LoRA:** conservar whitelist, aprobaciones de plan, cálculos materiales, compatibilidad LoRA y auditoría de procedencia.
11. **Webhook:** HMAC sobre cuerpo crudo, idempotencia, rechazo observable y respuesta 200 para duplicado/stale/rechazado con el fin de no provocar reintentos inútiles de Shopify.
12. **Proveniencia:** mantener fuente, snapshot, hash y fecha; no promover datos de escena sin oferta comercial, área de servicio, vigencia y evidencia verificadas.
13. **Privacidad:** los manifests no deben contener identidad sensible; no persistir payloads de cliente/pedido fuera del contrato requerido.

Riesgo de paridad detectado: el inventario CDN elimina el prefijo `B2B-` al construir el mapa, mientras algunos normalizadores consultan el SKU crudo de la variante. La misma forma aparece en el sync legacy y en el normalizador RAG v2. Debe verificarse con fixtures antes de declarar equivalencia de disponibilidad.

## 7. Matriz de migración

| Área | Decisión | Motivo y condición de salida |
|---|---|---|
| Contratos de producto/variante, filtros duros, selección validada y procedencia | **Migrar ahora** | Son límites estables y testeables sin proveedor; migrar como adaptador de lectura, con fixtures y comparación contra PG. |
| Recuperación RAG lexical y exact-SKU | **Migrar ahora** | FTS/trigram funciona sin embedding; reduce dependencia y permite baseline determinista. |
| Consumidor de chat/plan | **Mantener temporalmente** | La orquestación contiene reglas de plan, LoRA y same-turn; cambiarla junto con el catálogo aumenta el radio de regresión. |
| Webhook Shopify hacia PG | **Mantener temporalmente** | Tiene HMAC, deduplicación y stale-check; sustituirlo solo tras probar un writer Python idempotente. |
| Catálogo y sync SQLite visibles | **Mantener temporalmente** | `/catalogo`, `/api/catalogo/piezas` y `/api/shopify/sync` aún dependen de él. Retirar solo después de paridad de rutas, facetas, imágenes, precios y disponibilidad. |
| CRUD de productos seed | **Mantener temporalmente** | Es un dominio separado de Shopify/RAG; no mezclarlo en la primera extracción. |
| Generación y búsqueda vectorial | **Migrar después** | Es opcional, tiene costo/proveedor y contrato rígido `VECTOR(768)`; primero asegurar recuperación lexical y dual-run de embeddings. |
| Importador v2 REST/CDN | **Migrar ahora, detrás de adaptador** | Es el pipeline actualmente consumido por RAG; conservar normalización, hash, upsert transaccional y guardas anti-caída. |
| Importador CDN v3 staged | **Migrar después** | Tiene mejores contratos/manifests, pero no está conectado a una publicación independiente ni a todos los consumidores. |
| Retrieval de escena/ofertas verificadas | **Migrar después** | Adaptador de fuente ausente, assets no cableados y slots con ids stub; no puede ser autoridad comercial. |
| `/api/references/analyze` legacy | **Mantener temporalmente** | Tiene mezcla de fuentes y cambio de comportamiento por flags; requiere contrato de compatibilidad separado. |

## 8. Riesgos y reversión

| ID | Riesgo | Impacto | Control/reversión |
|---|---|---|---|
| R1 | Tres pipelines con universos potencialmente distintos | Precio, disponibilidad o resultados inconsistentes | Comparación por SKU/variant id antes del corte; feature flag y retorno a SQLite. |
| R2 | `/api/shopify/sync` no actualiza PostgreSQL | Una operación aparenta éxito y deja RAG desactualizado | Separar claramente comandos; monitorear `catalog_sync_log`; no usarlo como prueba de frescura PG. |
| R3 | Cast de JSON sin validación en `piezas`, webhook con payload parcialmente confiado | Datos corruptos o errores no deliberados | Contratos runtime antes de trasladar; rechazar con código estable. |
| R4 | Dimensión/modelo de embedding rígidos | Incompatibilidad de índice o resultados mixtos | Versionar modelo/dimensión; tabla/columna paralela o re-embedding completo; conservar la columna anterior hasta cobertura. |
| R5 | Clave B2B no normalizada de forma uniforme | Disponibilidad/inventario incorrectos | Fixture de SKU con y sin prefijo; corregir una única función canónica antes de cutover. |
| R6 | Staged sin promote independiente; migraciones sin down | Rollback técnico incompleto | Snapshot/backup, hash de fuente y reimport exacto; no borrar volumen ni hacer `down` destructivo. |
| R7 | Pool PG sin límites explícitos; reintentos amplios | Saturación, latencia y consumo de proveedor | Bounded concurrency, timeout y métricas antes de escalar. |
| R8 | Escena usa `stub-offer`/`stub-snapshot` y falta adapter | Riesgo de afirmar oferta, precio o disponibilidad inventados | Mantener desactivado; excluir de la migración comercial hasta tener fuente verificada. |
| R9 | Rutas administrativas y sync sin autorización visible en el alcance | Escrituras o sincronizaciones no autorizadas | Revisión de autenticación/autorización antes de exponer o migrar. |
| R10 | `.env.local` contiene credenciales de proveedores/DB | Exposición accidental y costo no controlado | No copiar secretos; rotar si fueron expuestos; usar variables de prueba y límites de cuota. |

### Procedimiento de reversión recomendado

1. Desactivar `RAG_ENABLED` y cualquier job de importación/embeddings; mantener el volumen para conservar evidencia.
2. Volver consumidores al camino SQLite conocido, sin ejecutar `docker compose down -v` ni borrar tablas.
3. Capturar versión de código, manifest/hash de fuente, estado de migraciones y conteos antes de restaurar.
4. Restaurar el backup o reimportar el snapshot exacto; no reconstruir desde una fuente distinta durante el incidente.
5. Reactivar por fases: stack, retrieval sin proveedor, validación, luego webhook y finalmente vector/escena.

El documento existente `docs/operations/rag-rollback-v2.md` respalda este enfoque. No se ejecutó rollback durante esta auditoría.

## 9. Baseline de pruebas y costo

### Local sin proveedor ni credenciales

Checks apropiados, no ejecutados en esta auditoría:

- `npm run rag:stack-check`: extensiones PG, dimensión y configuración; es el check de infraestructura de menor riesgo, pero requiere una base local.
- `npm run rag:e2e-v2`: E2E sin key/Gemini, útil para recuperación y validación determinista.
- `npx tsx scripts/bench-retrieval-v2.ts --no-key`: latencia de retrieval sin proveedor.
- `npm run rag:eval-parser`, scripts de contratos/ingesta y pruebas de resolución que usen fixtures.
- `scripts/import-cdn-catalog.ts` en modo `--offline --fixture --dry-run`, solo si se controla que no escriba manifest ni base.

No hay una suite general `npm test` observada. Los scripts de evaluación no sustituyen pruebas de contrato completas.

### Local con proveedor y credenciales

Requieren control explícito de cuota/costo y no se ejecutaron:

- `npm run rag:health` puede hacer una llamada real de embedding.
- `npm run rag:e2e-v2:gemini` y `npm run rag:eval-chat` pueden invocar Gemini.
- `npm run rag:embed` genera embeddings y modifica PostgreSQL; el costo depende de productos con hash cambiado.
- Consultas ambiguas pueden usar Gemini aunque `RAG_USE_VECTOR=false`, porque el parser puede pedir desambiguación.

El entorno local contiene credenciales de proveedor y base; no se copiaron valores a este informe. El repositorio no fija tarifa, presupuesto, cuota ni costo por token/vector. Por tanto, cualquier estimación monetaria debe venir de la cuenta/proveedor, no de este audit.

### Proveedor/producción

No se ejecutaron llamadas Gemini, Shopify, imports, webhooks, migraciones, escrituras PG/SQLite, sync, producción ni operaciones pagadas. Los resultados históricos documentados en `docs/operations/rag-regeneration-v2.md` —E2E sin key, E2E Gemini y p95— se tratan solo como baseline reportado; no fueron rerun ni verificados en esta revisión.

## 10. Límites de alcance

- Se revisaron rutas, contratos, consumidores y scripts del dominio solicitado; no se auditó la aplicación completa ni la seguridad global.
- No se midieron conteos actuales de catálogos, latencia, cobertura de embeddings o divergencia entre SQLite y PostgreSQL.
- No se validó conectividad, credenciales, estado real de extensiones PG ni disponibilidad de Shopify/Gemini.
- No se modificó código, configuración, migración, datos ni ningún archivo distinto de este informe.
- La existencia de una función o contrato no equivale a que esté cableado en producción; especialmente aplica a v3 y escena.

## 11. Recomendaciones reversibles

1. Congelar fixtures de contratos con casos: SKU ambiguo, B2B, precio cero, inventario ausente, tamaño/diámetro, producto excluido, ocasión conflictiva y webhook repetido/stale.
2. Crear un inventario de consumidores y una comparación read-only SQLite vs PostgreSQL por `product_id`, `variant_id`, SKU, precio, estado y disponibilidad; no cambiar autoridad durante la comparación.
3. Extraer primero un adaptador Python de lectura que respete los contratos actuales; mantener Next.js como transporte y conservar `RAG_ENABLED` como kill switch.
4. Hacer dual-run de normalización e importación sobre snapshot, sin publicar, y bloquear el corte si cambia elegibilidad o SKU.
5. Resolver en una única función la normalización del prefijo `B2B-` y probarla antes de migrar inventario.
6. Versionar explícitamente `embedding_model`, dimensión y hash de texto; limitar concurrencia, reintentos y presupuesto antes de habilitar vector.
7. Añadir validación runtime y autorización a los límites HTTP antes de convertirlos en contratos Python.
8. Mantener escena/v3 fuera del corte comercial hasta disponer de adapter de fuente, oferta verificable, snapshot, vigencia, área de servicio y comando de publicación/reversión.

**Decisión de etapa 1:** migrar primero el contrato de lectura RAG y sus invariantes comerciales; mantener SQLite, webhook y orquestación existentes como compatibilidad; posponer vector avanzado, staged v3 y escena hasta cerrar las brechas señaladas.

# Migración a backend Python — síntesis Etapa 1

Fecha: 2026-09-07  
Repositorio: `demo-decoracion`  
Estado: **Etapa 1 completa; migración de runtime aún no iniciada**

## Alcance y evidencia

Se auditaron cuatro dominios en paralelo, sin cambios de código ni llamadas pagadas:

- [A — chat, herramientas y proveedor](auditoria/01-chat-herramientas-proveedor.md)
- [B — RAG y catálogo](auditoria/02-rag-catalogo.md)
- [C — planes, presupuesto e imágenes](auditoria/03-planes-presupuesto-imagenes.md)
- [D — LoRA, Happie y línea base](auditoria/04-lora-happie-linea-base.md)

Correcciones verificadas: `services/image-api/` no contiene implementación; el proveedor de IA de la aplicación es Gemini; no existe aún servicio Python/FastAPI ni contrato Python consumidor de estas rutas.

## 1. Mapa de flujo global

```text
Browser / UI
  ├─ POST /api/chat
  │    ├─ proxy: cookie session y matcher
  │    ├─ selección proveedor + flags + límites de historial
  │    ├─ agente-core: transcript neutral, Gemini, retry, máximo 10 vueltas
  │    └─ herramientas por modo
  │         ├─ legado: catálogo, medidas, cotización y selección
  │         ├─ RAG: PostgreSQL, whitelist, filtros duros y validación
  │         └─ plan: restricciones, resolver, materiales, presupuesto y aprobación
  │
  ├─ POST /api/references/analyze
  │    └─ Gemini visión/chat -> reference blueprint -> chat y/o generate
  │
  ├─ POST /api/generate
  │    └─ plan/catálogo resueltos -> Gemini o LoRA/FAL -> imagen + provenance
  │
  └─ Happie
       ├─ UI/browser: API key + CORS -> recomendador -> filtros -> checkout
       ├─ webhooks: secret server-to-server -> recomendación o chat
       └─ catálogo activo, temas, necesidades y paquetes son autoridad local

Shopify/CDN -> importación/canonicalización -> PostgreSQL RAG -> retrieval/whitelist
FAL/Gemini -> operaciones externas con coste o credenciales; nunca baseline rápido
```

### Flujo de chat

`src/app/page.tsx` conserva mensajes y brief, envía payload a `POST /api/chat`, recibe SSE (`texto`, `herramienta`, `fin`, `error`) y proyecta el resultado a UI. `src/proxy.ts` protege por cookie cuando `APP_PASSWORD` está configurado. La ruta selecciona Gemini, recorta historial a 16.000 caracteres, adjunta imágenes solo al último turno de usuario y delega el loop a `packages/agente-core`.

El registro de herramientas aplica las flags `RAG_ENABLED`, `RAG_FRANJAS_ENABLED` y `PLAN_DECORACION_ENABLED`. El modelo no es autoridad para precio, stock, cantidades, SKU, variante ni aprobación de generación.

### Flujo RAG y catálogo

Shopify/CDN y fuentes curadas alimentan importadores y manifests. La autoridad comercial vigente es PostgreSQL: producto, variante, precio, disponibilidad, inventario y procedencia. Retrieval exacto/lexical y vector opcional producen candidatos; whitelist y validación same-turn limitan lo que el modelo puede confirmar. SQLite legado debe permanecer hasta demostrar paridad.

### Flujo de planes, presupuesto e imágenes

El plan activo es `PlanDecoracion` 1.0. Resolver, geometría, materiales, paquetes, merma, cotización, hashes y aprobación son reglas deterministas. `PlanDecoracion` 1.1 existe en código/pruebas, pero no es contrato activo de chat/generate. La generación consume selección/plan ya resueltos; la aprobación explícita precede a `/api/generate`.

### Flujo LoRA

Dataset y vocabulario producen allowlist y selección compatible. Registro/estado/artefacto se persisten en PostgreSQL o storage local; `/api/generate` compila prompt y llama al proveedor. FAL training y evaluaciones de imagen son efectos externos, con idempotencia, coste e incertidumbre de envío; no se duplican durante una migración.

### Flujo Happie y webhooks

Las rutas internas (`/api/happie/recomendar`, `/api/happie/recomendar-pasos`, `/api/happie/opciones`) y las fachadas browser (`/api/happie/recommend-packages`, `/api/happie/recommend-package`) no deben tratarse como un contrato único. Los webhooks (`/api/happie/webhook/recommend-packages`, `recommend-package`, `chat`) requieren autenticación server-to-server, sin CORS, replay e idempotencia. Paquetes e items se filtran contra catálogo activo antes de responder; los IDs del modelo no son autoridad.

## 2. Inventario de contratos y consumidores

| Contrato | Autoridad actual | Consumidores críticos | Tratamiento Etapa 2 |
|---|---|---|---|
| Chat HTTP + SSE | `src/app/api/chat/route.ts` | `src/app/page.tsx`, parser SSE | Versionar payload, eventos y errores; replay antes de cutover |
| Transcript neutral | `packages/agente-core/src/tipos.ts` | loop, Gemini, historial, evals | JSON Schema compartido/generado; conservar `thoughtSignature` |
| Herramientas | `src/lib/ia/herramientas.ts` + registro | Gemini, `agente-core`, UI indirecta | Versionar nombres, schemas, unknown-tool y resultados |
| Resultado conversación | `ResultadoConversacion` en core/registro | UI, generate, tests de plan/RAG | Golden fixtures; no duplicar reglas en Python |
| Error IA | `ErrorIA` y causas HTTP | chat, referencias, UI | Tabla estable sin filtrar mensajes internos |
| Auth/proveedor | cookie `session`, `ia_proveedor`, env | proxy, login, salud, chat | Definir identidad propagada y autorización explícita |
| Catálogo/RAG | PostgreSQL + contratos Zod/manifests | retrieval, selección, generate, cotización | DTO/schema generado; PG sigue autoridad |
| Plan/cotización | `PlanDecoracion` 1.0, resolver y motor | chat, plan-editor, generate, UI | Congelar versión, hashes, errores y aprobación |
| Reference blueprint | schemas de referencias | analyze, chat, generate | Versionar cobertura, omisiones justificadas y provenance |
| LoRA | schemas, registry, allowlist, vocabulario, artefactos | rutas LoRA, generate, UI admin | Adaptar estados `completed`/`succeeded`; no mover autoridad aún |
| Happie | Zod/tipos curados + contrato API externo | UI, cliente externo, webhooks | Validar respuestas runtime; fixtures de paquetes activos |
| Webhooks | secret/API key, CORS, status/error shape | integradores externos | Contract tests, replay, idempotencia y fachada Next |
| Telemetría | buffer en memoria + eventos | salud/debug | Añadir correlation ID, modelo, prompt version y usage; no guardar conversaciones completas |

Regla transversal: TypeScript y PostgreSQL conservan la autoridad comercial durante la transición. Python solo puede invocar adaptadores explícitos hasta que exista equivalencia probada.

## 3. Dependencias, ownership y límites

### Dependencias

- Next.js 16.3, React 19, TypeScript strict, Zod, `pg`, workspace packages.
- Gemini mediante `@google/genai`; embeddings `gemini-embedding-2`, dimensión 768.
- PostgreSQL/pgvector y SQLite legado para datos de catálogo y estado local.
- Shopify/CDN para fuentes; FAL para training/evaluación LoRA.
- Filesystem local para artefactos, datasets y manifests.

### Ownership que no debe duplicarse

- `packages/agente-core`: loop, transcript neutral, adaptador Gemini, retry y telemetría básica.
- Registro de herramientas: reglas de conversación y estado por request.
- RAG/PostgreSQL: producto, variante, precio, stock, disponibilidad y procedencia.
- Plan/materiales/cotización: geometría, cantidades, paquetes, merma, techo presupuestario y aprobación.
- LoRA: allowlist, vocabulario, compatibilidad, estado de entrenamiento y artefactos.
- Happie: filtros de paquetes/items activos, taxonomías curadas y checkout.
- Next/proxy: fachada HTTP actual, sesión y compatibilidad externa hasta cutover verificable.

### Brechas

- No existe servicio Python, lockfile Python, endpoint FastAPI ni tests Python.
- No hay `npm test`; el baseline está compuesto por scripts `tsx` y scripts Python de preparación, no por una suite única.
- Varias fronteras HTTP usan casts o validación parcial; convertirlas en contratos Python sin validación runtime trasladaría deuda.
- Rutas Happie internas y externas no tienen la misma frontera de autenticación.
- `PlanDecoracion` 1.1, catálogo staged v3 y escena tienen piezas de contrato, pero no son autoridades comerciales activas.
- `dist` de workspace no está versionado; build de paquetes es requisito de checkout limpio.

## 4. Matriz de migración

| Migrar ahora | Mantener temporalmente | Migrar después |
|---|---|---|
| JSON Schemas/DTO versionados y generados para TS/Python | `POST /api/chat` y fachadas Next | Cutover completo del handler chat |
| Transcript neutral, historial, errores y replay determinista | Registro de herramientas y reglas comerciales TS | Herramientas por dominio, una a una |
| Interfaces de lectura RAG y filtros duros | PostgreSQL, SQLite legado y Shopify sync | Escritura/importación y catálogo staged v3 |
| Core determinista de plan/cotización como contrato, no autoridad duplicada | Resolver TS, UI, SSE, generate y aprobación | Resolver Python tras golden vectors y dual-read |
| Adapter local de artefactos con hash/traversal/atomicidad | Allowlist/vocabulario LoRA y rutas admin | Repository PG y entrenamiento LoRA |
| Validación runtime de respuestas Happie y curadores deterministas | Webhooks como fachada externa | Conversación webhook durable |
| Fixtures, contract tests y telemetría mínima | Gemini/FAL detrás de interfaces existentes | Adaptadores provider y generación |

No se recomienda mover primero vector embeddings, escena comercial, LoRA training, evaluaciones pagadas, webhooks o conversación multi-turno durable. Su coste de reversión y dependencia externa es mayor.

## 5. Riesgos y plan de reversión

| Riesgo | Severidad | Control |
|---|---:|---|
| Drift en JSON, SSE, nombres de herramientas o resultado | Alta | Schemas versionados, fixtures, replay y fallback a Next |
| Python duplica precio, stock, whitelist, plan o vocabulario | Crítica | Un solo dueño; Python usa adapters; comparación sombra sin efectos |
| Pérdida de `thoughtSignature`, IDs o agrupación de function responses | Alta | Replay de transcript neutral y retorno al adaptador TS |
| Auth Python distinta o expuesta sin autorización | Crítica | Servicio interno, identidad propagada validada y contract tests |
| Retry/timeout duplica coste o efectos provider | Alta | Deadlines, retry solo recuperable, no retry tras primer byte ni envío incierto |
| Doble envío FAL o entrenamiento duplicado | Crítica | Idempotency key, request ID, estado `uncertain`; nunca dual-submit |
| Catálogo staged/escena promueve datos sin oferta verificable | Alta | Mantener PG vigente; gates de snapshot, precio, área, vigencia y provenance |
| Estado webhook no durable o no deduplicado | Alta | conversation ID, versión, expiración, replay e idempotencia antes de migrar |
| Build limpio carece de `dist` o `data` | Media | Build workspace en CI/Docker; almacenamiento versionado y hash tras restore |
| Tests mutantes usan DB no desechable | Alta | PG aislado, fixtures controlados, cleanup y prohibición de producción |

### Reversión estándar

1. Mantener Next como fachada canónica y activar Python por endpoint/feature flag.
2. Empezar con fixtures/replay y tráfico sintético; no usar generación ni training reales.
3. Comparar contratos, resultado determinista, hashes, errores, latencia, tokens/usage e idempotencia.
4. Si hay divergencia comercial, desactivar flag y volver al resolver/handler TS; no borrar datos ni hacer doble escritura.
5. Para efectos externos inciertos, conservar request ID/estado y resolver lectura/registro; nunca repetir automáticamente la operación.

## 6. Línea base de pruebas

### Ejecutado y PASS

- `npm run plan:test`: PASS; 10 suites locales de contratos, geometría, resolver, presupuesto, desglose, orden, prompt, materiales, intención abierta y contrato E2E de evento.
- `npm run chat:test-historial`: PASS.
- `npm run plan:test-event-contract`: PASS.
- `npm run plan:test-contratos`: PASS.
- `npm run ia:test-referencias-fixture`: PASS.
- `npm run ia:test-referencias-perceptual`: PASS.

No se ejecutaron Gemini, FAL, Shopify, producción, imports, webhooks externos, entrenamiento, generación pagada ni escrituras remotas.

### Clasificación operativa

- **L — local/determinista:** contratos, fixtures, historial, geometría, resolver con mocks, cotización, caption compiler, LoRA registry/filesystem local, Happie con stubs y evaluaciones con fixtures.
- **DB — infraestructura local controlada:** retrieval, integraciones PG/SQLite, webhooks con datos, migraciones y agregados. Requiere PostgreSQL desechable; algunos scripts escriben o borran datos.
- **M — mixto:** E2E RAG/escena y parser con camino local y flags PG/Gemini; documentar modo exacto antes de ejecutar.
- **P — proveedor/coste:** chat Gemini, embeddings, evaluación LoRA/FAL y generación de imágenes. Requiere credenciales, presupuesto, inputs versionados y captura de usage/request ID.

No existe `npm test`. Scripts Python hallados son preparación/curación/manifests/empaquetado; no son servicio ni pruebas automatizadas. `lint`, build y `tsc` quedan como verificaciones de integración separadas, no como resultado de esta auditoría documental.

## 7. Decisión de Etapa 1

Etapa 1 queda cerrada con alcance documental completo. El siguiente corte seguro es Etapa 2: contratos versionados, fixtures canónicos, errores estables y adaptadores de frontera. No se crea aún `demo-decoracion-api`, no se mueve autoridad comercial y no se retira ninguna ruta Next.


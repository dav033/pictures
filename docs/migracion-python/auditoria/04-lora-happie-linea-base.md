# Auditoría etapa 1 — Dominio D: LoRA y Happie

Fecha: 2026-09-07  
Repositorio auditado: `C:\Users\davidt\Downloads\demo-decoracion`  
Modo: lectura estática. El único archivo creado es este informe. No se ejecutaron pruebas, builds, lint, migraciones, operaciones de base de datos, proveedores externos, entrenamiento, generación ni producción.

## 1. Resultado ejecutivo

El dominio D no es un bloque único. Tiene dos flujos con fronteras distintas:

1. LoRA: catálogo y plan canónico, selección/allowlist, datasets, artefactos locales, registro PG, entrenamiento/evaluación FAL y consumo en generación.
2. Happie: catálogo remoto de paquetes, curación determinista, recomendación Gemini, API interna, API browser externa y webhooks autenticados.

No existe todavía un servicio Python/FastAPI real en las rutas auditadas. `services/` no contiene archivos; tampoco existen `services/image-api/` ni tests Python. La migración Python debe empezar por contratos y adaptadores, no por copiar handlers.

Hallazgos de mayor impacto:

- El contrato LoRA operativo está repartido entre Zod/TypeScript, PostgreSQL, rutas, almacenamiento local y variables de entorno. Hay dos vocabularios de estado: canónico `completed` y flujo/provider `succeeded`; un adaptador explícito es obligatorio.
- La activación de LoRA está protegida por varias compuertas: dataset listo, hash, backup, run completado, evaluación aprobada, URL HTTPS, allowlist de vocabulario y compatibilidad de máximo dos LoRAs. Esas compuertas son reglas de negocio, no detalles de transporte.
- El entrenamiento FAL y las evaluaciones de imagen son operaciones externas con posible costo. Quedan fuera de cualquier baseline rápido y no se ejecutaron.
- Happie llama a un catálogo externo y a Gemini. El cliente tipa la respuesta de Happia mediante cast, pero no la valida en runtime; es una brecha contractual relevante para Python.
- Las rutas Happie internas (`/api/happie/recomendar`, `/api/happie/recomendar-pasos`, `/api/happie/opciones`) no muestran el mismo límite de autenticación/validación que las rutas browser externas y webhooks. No deben migrarse como si fueran un contrato uniforme.
- El baseline del repo es una colección de scripts `tsx`, no un runner de tests único. No hay `npm test`; no se localizaron configuraciones `vitest`, `jest` ni `playwright` para hacer pasar automáticamente toda la línea base.

## 2. Alcance, rutas verificadas y ausencias

### Incluido

- `src/lib/lora/`
- `src/app/api/lora/`
- Scripts Python LoRA/dataset en `scripts/`
- `src/lib/happie/`
- `src/app/api/happie/`
- `packages/happie-package-ia/`
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `.env.example`, migraciones PG relacionadas y scripts `test`/`eval`.
- Consumidores encontrados fuera de esas carpetas cuando cambian el contrato LoRA/Happie.

### Ausencias confirmadas

- `services/`: sin archivos auditables.
- `services/image-api/`: ausente.
- Servicio Python para LoRA/Happie: ausente.
- Tests/evals Python: ausentes.
- `docs/migracion-python/auditoria/04-lora-happie-linea-base.md`: ausente antes de esta auditoría; creado como único cambio.
- Runner/configuración de pruebas estándar (`vitest.config.*`, `jest.config.*`, `playwright.config.*`): no localizados.
- Script raíz `test` en `package.json`: ausente.

El worktree ya estaba sucio antes de esta auditoría, con cambios en `AGENTS.md`, `CLAUDE.md`, plan/cotización/IA/LoRA, y archivos no rastreados como `AQUI.md`, `docs/PROPUESTA-AGENTS-CALIDAD.md`, scripts temporales/deploy y `src/lib/ia/scene-visual-contract.ts`. Se preservan; no son parte de este cambio.

## 3. Mapa de flujo real

### 3.1 LoRA: control y consumo

1. El catálogo y el plan producen productos, variantes, formas, diámetros, colores, estructuras y cantidades.
2. `src/lib/lora/product-vocabulary.ts` y sus datos canónicos traducen IDs/SDK a vocabulario visual permitido. El descriptor perceptual evita que el modelo invente acabado, color o tamaño.
3. `src/lib/lora/training-reference-counts.ts` obtiene evidencia de referencias/aprobaciones y estadísticas PG; para v007 expande familias por producto, forma y diámetro.
4. `src/lib/lora/dataset-builder.ts` audita candidatos: tamaño mínimo, duplicados, personas, texto, marca de agua, casi-duplicados, licencia, tipo de estructura, trigger y cobertura de captions. Luego separa train/validation/test por grupo.
5. `src/lib/lora/schema.ts` define manifest, selección, estados, recibos de entrenamiento, evaluación y compatibilidad.
6. Rutas `/api/lora/datasets`, `/datasets/preview`, `/dataset/exportar-seleccion`, `/dataset-v005` y `/dataset-v005/[archivo]` preparan/entregan datasets. La exportación guarda hash y datos de manifest.
7. `src/lib/lora/repository.ts` persiste datasets, runs, evaluaciones, artefactos, jobs, slots e idempotencia en PostgreSQL.
8. `src/lib/lora/artifact-store-local.ts` escribe ZIP/pesos localmente, con hash, rutas normalizadas, escritura atómica e idempotencia por contenido.
9. `/api/lora/trainings` solo crea un draft si el dataset cumple; `/trainings/[id]/start` sube el ZIP a FAL y envía el entrenamiento con confirmación textual e idempotency key.
10. El artefacto solo se publica para consumo si existe backup, run completado, evaluación aprobada, URL HTTPS y metadatos compatibles.
11. `mode-resolver.ts` resuelve el slot, la allowlist de catálogo y la selección de hasta dos LoRAs. `compatibility.ts` rechaza pares incompatibles.
12. `/api/generate` usa esa resolución, compila el prompt/caption y envía la generación al proveedor. Chat, plan-editor y componentes administrativos consumen partes del mismo contrato.

### 3.2 Happie: recomendación

1. `packages/happie-package-ia/src/cliente.ts` llama `HAPPIA_API_BASE_URL/packages` con `x-api-key`.
2. `filtros.ts`, `temas.ts`, `tipos-curados.ts` y `necesidades.ts` aplican taxonomías fijas y filtros/ordenamientos deterministas.
3. `recomendador.ts` construye contexto de paquetes activos, calcula precio sumando items activos y llama Gemini con salida Zod limitada a `packageId` y razón.
4. `generar-recomendacion.ts` valida la solicitud, limita preferencias, carga el catálogo, filtra/ordena, recomienda y construye URL de checkout.
5. Las rutas internas entregan opciones/recomendación para la UI Happie.
6. Las rutas browser externas pasan por CORS y `HAPPIE_EXTERNO_API_KEY`; las rutas webhook pasan por `HAPPIE_WEBHOOK_API_KEY` con comparación constante.
7. `conversacion-webhook.ts` mantiene estado de conversación validado, extrae intención con Gemini y solo recomienda después de confirmación.

## 4. Inventario de contratos y consumidores

### 4.1 LoRA

| Contrato | Fuente | Consumidores / obligación |
|---|---|---|
| Selección LoRA | `src/lib/lora/schema.ts` (`product`/`structure`, `artifactId`, `scale`) | `mode-resolver.ts`, `/api/lora/compatibility`, `/api/generate`; al menos una selección, escala 0–1.5. |
| Compatibilidad | `src/lib/lora/compatibility.ts` | Máximo dos; como máximo un product y un structure; mismo modelo/tokenizer/resolución; URL HTTPS; trigger no vacío. Error estable `LORA_INCOMPATIBLE`. |
| Estados | `schema.ts`, `repository.ts`, migraciones 015/016 | PG, paneles, rutas de training y resolver. Adaptar `succeeded` del provider a `completed` canónico. |
| Manifest v1/v2 | `schema.ts`, `dataset-builder.ts` | Exportación, validación, auditoría y training. v2 exige `eventdecor_structure_v1`, licencia verificada y audit/cobertura. |
| Training receipt | `schema.ts` | Registro de provider, endpoint, steps, LR, costo estimado/reportado, request ID, hash/storage key y veredicto. No perder provenance. |
| Allowlist | `mode-resolver.ts`, `training-reference-counts.ts`, vocabularios `v007-*` | `/api/generate`, plan/chat y selección de variantes. Excluye productos ofrecibles que no se pueden describir canónicamente. |
| Artefactos | `artifact-store.ts`, `artifact-store-local.ts` | Rutas de registro, backup, dataset y training. Root: `LORA_ARTIFACT_ROOT`, default `data/lora-artifacts`. |
| Slots/modos | migraciones 015–018, `mode-resolver.ts` | `training_1` muestra v007, escala default 0.8, allowlist activa; activación requiere run/backup/provider/evaluación. |
| Prompt visual | `lora-product-runtime.ts`, `descriptor-perceptual.ts`, `lora-caption-compiler.ts`, `sempertex-lora.ts` | `/api/generate`, tests de runtime/caption, evaluación de imagen. El catálogo y el plan prevalecen al texto del modelo. |
| Rutas HTTP | `src/app/api/lora/**` | Panel admin, `configuracion-lora`, `LoraPairSelector`, `LoraDatasetGallery`, `LoraStructureConsole`, `LoraRegistryPanel`, `LoraTrainingWizard`, generación y scripts operativos. |

Rutas LoRA encontradas: `/api/lora/compatibility`, `/modes`, `/overview`, `/artifacts`, `/datasets`, `/datasets/[id]`, `/datasets/preview`, `/trainings`, `/trainings/[id]`, `/trainings/[id]/start`, `/training-references`, `/training-reference-counts`, `/dataset-v005`, `/dataset-v005/[archivo]`, `/dataset/[archivo]` y `/dataset/exportar-seleccion`.

Controles HTTP relevantes:

- La mayoría de administración requiere autenticación y, en POST, same-origin.
- `/api/lora/dataset/[archivo]` es público; entrega el dataset/snapshot indicado por nombre de archivo. Confirmar si la exposición es intencional antes de replicarla.
- `/api/lora/dataset-v005/[archivo]` descarga fuentes remotas solo desde hosts permitidos, con límites de tamaño/tipo/timeout y redirecciones acotadas.
- `dataset-v005` DELETE y `dataset/exportar-seleccion` deben tratarse como operaciones mutantes; la revisión detecta autenticación, pero no la misma defensa same-origin de todos los POST.

### 4.2 Happie

| Contrato | Fuente | Consumidores / obligación |
|---|---|---|
| `HappiaPackage` | `packages/happie-package-ia/src/tipos.ts` | Cliente, recomendador, UI Happie; conserva IDs, `base_guests`, condiciones/restricciones e items activos. |
| Respuesta de catálogo | `ListarPackagesRespuesta` | `cliente.ts`; actualmente cast TypeScript sin validación Zod de respuesta externa. |
| Recomendación | `RecomendacionPaquete`, `ResultadoRecomendacion` | `recomendador.ts`, `generar-recomendacion.ts`, rutas internas/externas/webhook. IDs finales se cruzan contra catálogo activo. |
| Opciones curadas | `tipos-curados.ts`, `temas.ts`, `necesidades.ts` | `/api/happie/opciones`, `WizardFlow`, `ChatFlow`, `Tema`. Taxonomía fija con fallback. |
| Solicitud externa | `src/lib/happie/generar-recomendacion.ts` | Campos: evento, invitados, presupuesto, booleans, preferencias max 20×300, URL HTTP(S); resultado 1–3 paquetes y URL. |
| CORS browser | `cors-externo.ts` | `/api/happie/external/recommend-packages` y `recommend-package`; API key visible por diseño, no secreta. |
| Webhook | `recomendar-paquetes-webhook.ts`, `conversacion-webhook.ts` | `HAPPIE_WEBHOOK_API_KEY` mínimo 32, comparación constante, sin CORS, body/estado Zod. |
| Conversación | `conversacion-webhook.ts` | Fases `discovery`, `details`, `confirmation`, `finalized`; no recomienda antes de confirmación; estado validado pero no durable. |

Rutas Happie encontradas:

- Internas: `/api/happie/recomendar`, `/api/happie/recomendar-pasos`, `/api/happie/opciones`.
- Browser externo: `/api/happie/external/recommend-packages`, `/api/happie/external/recommend-package`.
- Webhook: `/api/happie/webhook/recommend-packages`, `/api/happie/webhook/recommend-package`, `/api/happie/webhook/chat`.

Consumidores UI: `src/app/happie/page.tsx`, `WizardFlow.tsx`, `ChatFlow.tsx`, `Carrito.tsx`, `PaqueteCard.tsx`, `Tema.tsx`. El contrato documentado adicional está en `docs/api/happie-recomendacion-externa.md`.

## 5. Dependencias, infraestructura y configuración

### LoRA

- PostgreSQL/pgvector mediante `pg`, `DATABASE_URL` y migraciones 015–018.
- FAL: `FAL_KEY`, `FAL_TRAINER_ENDPOINT`, `FAL_MULTI_LORA_SUPPORTED`; endpoint de entrenamiento por defecto `https://queue.fal.run/fal-ai/flux-2-trainer`.
- Almacenamiento local: `LORA_ARTIFACT_ROOT`; publicación de snapshots por SSH/Docker con variables `LORA_SNAPSHOT_*`.
- Imágenes: `sharp`; origen staging/órdenes y snapshots locales.
- Catálogo/vocabulario estático: `src/lib/lora/product-vocabulary*.ts`, `v007-catalog-allowlist.ts`, `v007-dataset-product-vocabulary.ts` y datos en `data/`.
- OpenAI/Google no son requisito de la compuerta LoRA, pero Gemini y generación aparecen en consumidores IA/evals.

### Happie

- Happia remoto: `HAPPIA_API_BASE_URL`, `HAPPIA_API_KEY`.
- Gemini: `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL` (default observado: `gemini-3.6-flash`).
- `@google/genai`, `zod`, paquete workspace `@sempertex/happie-package-ia`.
- Next standalone (`next.config.ts`), React y TypeScript strict.
- No hay servicio Python ni lock/dependency manifest Python para este dominio.

### Configuración transversal

`.env.example` documenta credenciales, PG local, flags RAG, `LORA_PROMPT_VERSION=v2`, FAL, artefactos, snapshot, Happia, keys browser/webhook y orígenes. `.dockerignore` excluye `data`; la imagen crea `/app/data`. Por tanto, un contenedor limpio puede perder snapshots/artefactos/datasets si no se monta volumen o se materializan en build.

## 6. Reglas de negocio que deben preservarse

### LoRA

1. Catálogo, disponibilidad, precio, cantidades, unidades y variantes son autoritativos; el modelo no puede crear productos ni precios.
2. El vocabulario perceptual canónico limita acabado, color, forma, diámetro y etiqueta. Una ruta de generación con elementos catalog-backed debe fallar con `LORA_PRODUCT_VOCABULARY_FAILED` si no puede resolver fidelidad canónica.
3. La allowlist se calcula desde evidencia/dataset y se cruza con vocabulario describible. No presentar una variante solo porque exista en catálogo.
4. Structure v2 usa trigger exacto `eventdecor_structure_v1`, tipos de estructura enum y auditoría de captions; exige licencia verificada y evaluación aprobada.
5. Dataset listo requiere imágenes/captions contables, hash, source metadata y consistencia manifest. El split es determinista por grupos, no por filas arbitrarias.
6. Una LoRA solo está lista si run completado/succeeded, artefacto respaldado, evaluación aprobada y URL HTTPS válida.
7. Máximo dos LoRAs: una de producto y una estructural; misma base/tokenizer/resolución y escala 0–1.5. Defaults observados: product 0.3, structure 0.6; slot v007 0.8.
8. Rechazadas solo se permiten en testing local explícito: `NODE_ENV !== production` y `LORA_ALLOW_REJECTED_FOR_TESTING=true`. No trasladar este bypass a Python productivo.
9. Confirmación textual exacta `ENVIAR ENTRENAMIENTO`, idempotency UUID y no reintentar automáticamente ante envío provider incierto; un timeout no demuestra que FAL no ejecutó.
10. Costo estimado de training: `steps * LORA_COST_USD_PER_STEP`, default 0.0064. Debe conservarse como estimado y separarse del costo reportado.
11. Artefactos locales usan prevención de traversal, hash y escritura atómica. Un adaptador Python debe mantener estas garantías y el contrato de rollback.

### Happie

1. Solo paquetes activos y items activos entran en el contexto final; el precio se suma desde items activos.
2. El modelo puede elegir IDs del catálogo, pero el resultado final se vuelve a filtrar contra IDs activos; no aceptar un ID inventado.
3. `base_guests` solo ordena por cercanía; no es filtro duro porque el catálogo puede ser inconsistente.
4. Evento, servicio y tema usan taxonomías curadas con fallback a todos los activos si no hay coincidencia exacta.
5. Necesidades de servicio son contexto de recomendación, no garantía de cobertura; no presentarlas como disponibilidad confirmada.
6. Las rutas browser requieren API key y CORS permitido; el webhook exige secret fuerte, sin CORS y comparación constante.
7. La conversación debe pedir evento, invitados y presupuesto, luego servicio/preferencias, y confirmar antes de recomendar.
8. La URL de checkout usa el origin solicitado/configurado más `/client/events/new?package=<id>`; validar origins permitidos si se convierte en contrato público.

## 7. Matriz de migración

| Elemento | Decisión | Motivo / corte reversible |
|---|---|---|
| Zod schemas LoRA, estados, compatibilidad, selección | Migrar ahora a contrato versionado compartido/generado | Es la frontera más estable. Mantener adapter TS y comparar fixtures antes de cambiar consumidores. |
| Allowlist, vocabulario, descriptor perceptual | Mantener en TS durante primera rebanada | Datos/reglas activas y worktree modificado. Extraer después con golden fixtures; una divergencia cambia qué producto puede venderse/visualizarse. |
| `dataset-builder`, auditoría y split | Migrar después de fijar fixtures | Incluye visión/metadata y reglas de licencia; migrar sin corpus aprobado no permite equivalencia. |
| `repository.ts` y consultas PG | Migrar después de contrato y schema | Las migraciones 015–018 son fuente de persistencia; primero generar cliente/DTO Python, luego dual-read o adapter. |
| `artifact-store-local.ts` | Migrar ahora como adapter pequeño, con pruebas de hash/traversal/atomicidad | Frontera aislada y reversible. Mantener mismo root/key/hash. |
| Rutas administrativas LoRA | Mantener temporalmente | Transporte Next funciona como fachada; mover solo cuando Python tenga auth, idempotencia y errores equivalentes. |
| Training FAL / start | Migrar después | Es efecto externo y cobrable. Python debe heredar idempotencia, uncertain-submit y límites; no hacer dual-submit. |
| Evaluaciones de imagen FAL | Mantener fuera del servicio | Son evaluaciones pagadas/externas, no health check local. Ejecutar solo con autorización y presupuesto. |
| `HappiaClient` + schema runtime de respuesta | Migrar ahora como boundary adapter | Es pequeño y revela el hueco de validación; añadir schema sin cambiar recomendación. |
| Curadores Happie, filtros y precio | Migrar ahora con fixtures de catálogo | Son deterministas y de alto valor contractual. Un solo dueño durante transición. |
| Recomendador Gemini | Migrar después | Requiere provider, prompt/versionado, timeouts, uso y evaluación probabilística. Interponer port/adapter, sin duplicar reglas de catálogo. |
| Webhooks Happie | Mantener fachada hasta validar Python | Son contrato externo; cambiar auth/error/shape rompe integradores. Migrar detrás de contract tests y feature flag. |
| Conversación webhook | Migrar después | Estado, replay, límites y confirmación requieren diseño de job/estado durable. No copiar como tarea en memoria. |
| Scripts Python de dataset | Mantener y reutilizar | Ya son herramientas de preparación; no prueban un servicio. Documentar entradas/salidas y encapsular CLI antes de usarlos como biblioteca. |
| Next UI/consumidores | Mantener | No ampliar la migración a frontend; usar el contrato existente y medir equivalencia. |

## 8. Riesgos, controles y reversión

| Riesgo | Evidencia | Control / reversión |
|---|---|---|
| Divergencia de estados `completed`/`succeeded` | `schema.ts`, repository y rutas | Adapter explícito; golden fixture de cada estado; rollback al resolver TS si difiere. |
| Doble envío FAL o cargo duplicado | `/trainings/[id]/start` y timeout incierto | Conservar idempotency event, request ID y estado `uncertain`; nunca retry automático; volver al endpoint TS. |
| Artefacto perdido en despliegue | `.dockerignore` excluye `data` | Volumen/almacenamiento versionado antes de cutover; fallback al store TS; verificar hash tras restore. |
| Python permite LoRA rechazada | flag local en `mode-resolver.ts` | Configuración fail-closed y tests de production; no copiar flag sin guardas. |
| Producto/price inventado | vocabulario, resolver y catálogo | Mantener fuente de verdad PG/catalog; pruebas de rechazo; rollback de consumidores al resolver TS. |
| Cambio de contrato Happia sin detección | cast en `cliente.ts` | Validar respuesta externa con Zod/Pydantic; métricas de schema mismatch; mantener cliente TS como fallback. |
| Recomendación con ID fantasma o paquete inactivo | filtro final silencioso | Telemetría de descartes y fixture; respuesta explícita sin recomendaciones si todo se descarta. |
| Llamadas externas sin timeout | Happia client; Gemini | Timeout, deadline y bounded concurrency en adapter; rollback a fachada anterior. |
| Fuga de detalle interno | errores 502 incluyen `error.message` | Mapear errores estables externos; guardar detalle solo en logs mínimos/correlation ID. |
| CORS/API key browser abusables | key visible por diseño | Rate limit, límites de body y origen; no tratar key browser como secreto. |
| Estado de conversación no durable/replay | `conversacion-webhook.ts` recibe estado del cliente | Introducir conversation/idempotency antes de mover; fallback al webhook TS. |
| Tests sobre DB mutable | `test-webhook`, `test-scene-catalog-migration`, aggregates | Base desechable y cleanup garantizado; no correr contra producción. |
| Worktree sucio | cambios preexistentes listados arriba | Revisar diff antes de cualquier commit; este informe no modifica esos archivos. |

Reversión recomendada: mantener la fachada Next como ruta canónica, activar Python detrás de una bandera por contrato/endpoint, comparar solo resultados deterministas sin efectos externos, y retirar la bandera únicamente después de verificar métricas, hashes, errores e idempotencia. Para training, el rollback debe cambiar resolución de lectura/registro, no repetir una llamada al proveedor.

## 9. Baseline de pruebas y evals

### 9.1 Lectura del baseline

`package.json` usa scripts independientes con `tsx`; no hay suite única. `tsconfig.json` es strict y excluye `packages`, que tiene su propio `tsconfig.build.json` strict/CommonJS. `eslint.config.mjs` ignora `packages/*/dist/**`. El baseline debe registrar comando, flags, dataset/fixture, `DATABASE_URL`, provider y si escribe archivos/DB.

Leyenda:

- **L**: local determinista; fixtures, mocks o filesystem local; sin provider ni credencial externa.
- **DB**: determinista/local de infraestructura, pero requiere `DATABASE_URL` y catálogo PostgreSQL; no implica proveedor pagado.
- **P**: requiere proveedor, credencial o costo. No ejecutar como baseline rápido.
- **M**: mezcla; tiene camino local y camino opcional DB/provider, indicado en nota.

La clasificación es estática; no significa que se haya ejecutado. Todos los comandos de abajo quedaron sin ejecutar en esta auditoría.

### 9.2 Todos los scripts `eval`/`test` localizados

| Clasificación | Scripts y condición |
|---|---|
| **L** | `eval/fixtures/source-contracts.test.ts`; `scripts/eval-event-query-parser.ts`; `scripts/eval-image-fidelity.ts`; `scripts/eval-query-parser.ts`; `scripts/eval-scene-baseline.ts` (declara no usar Gemini/FAL); `scripts/eval-scene-image-fidelity.ts`; `scripts/eval-variedad-composicion.ts` (fixtures; el modo live no es base); `scripts/test-chat-historial.ts`; `test-commercial-authority.ts`; `test-comparacion-tamanos.ts`; `test-descriptor-perceptual.ts`; `test-desglose-materiales.ts`; `test-event-open-rag.ts`; `test-event-plan-contract.ts`; `test-exp-fal-lib-identidad.ts` (mock/local, sin FAL); `test-geometria-plan.ts`; `test-happie-webhook.ts` (stubs/inyección local); `test-image-fidelity.ts`; `test-lora-caption-compiler.ts`; `test-lora-modes.ts` (Pool fake); `test-lora-product-runtime.ts`; `test-lora-registry.ts` (filesystem/temp local); `test-lora-specializations.ts`; `test-material-consistency.ts`; `test-open-intent-foundation.ts`; `test-open-intent-observability.ts`; `test-open-intent-plan-generation.ts`; `test-orden-desglose.ts`; `test-plan-contratos.ts`; `test-plan-lora-e2e.ts` (Pool fake, cadena resolver/blueprint/SceneSpec/caption); `test-plan-presupuesto.ts`; `test-plan-prompt.ts`; `test-reference-analysis-fixture.ts`; `test-reference-analysis-perceptual.ts`; `test-referencia-plan-cobertura.ts`; `test-resolver-plan.ts`; `test-rich-composition-contract.ts`; `test-scene-asset-schema.ts`; `test-scene-budget.ts`; `test-scene-contracts.ts`; `test-scene-invariants.ts`; `test-scene-optimizer.ts`; `test-scene-recipes.ts`; `test-visual-prompts.ts`. |
| **DB** | `bench-rag-v2.ts`; `bench-retrieval-v2.ts`; `eval-plan-decoracion.ts`; `eval-presupuesto.ts`; `eval-rag-v2.ts`; `eval-retrieval.ts`; `eval-tamanos.ts`; `test-generation-resolver.ts` (PG y limpia Gemini para evitar provider); `test-integracion-tamanos.ts` (PG + SQLite reales); `test-order-aggregates.ts` (PG, idempotencia); `test-plan-pg.ts`; `test-rag-validation.ts`; `test-resolver-tamanos.ts`; `test-scene-catalog-migration.ts` (PG y escribe fixtures); `test-webhook.ts` (PG y borra/crea datos de prueba). `bench-rag-v2.ts` además escribe el reporte local configurado. |
| **M** | `eval-e2e-scene-v2.ts` (local por defecto, `--with-pg` activa PG); `eval-scene-retrieval.ts` (local + PG opcional); `eval-e2e-rag-v2.ts` (PG requerido; Gemini opcional con `--with-gemini`); `eval-query-parser-v2.ts` (matriz local; Gemini opcional); `test-product-ingestion.ts` (modo `--canonicalize` local; flags `--schema`/idempotency usan PG). |
| **P** | `eval-chat-thinking.ts` (Gemini real, catálogo real, credencial `GEMINI_API_KEY`); `eval-lora-nuevo.ts` (FAL, URL de LoRA y generación de imágenes); `eval-lora-product-v007.ts` (FAL, 36 imágenes en las celdas observadas). |
| **DB/registro, no baseline seguro** | `registrar-evaluacion-product-v007.ts`: registra evaluación/veredicto en PG; no es un test puro aunque aparece junto a evals. No ejecutar sin DB desechable y aprobación de escritura. |

Observación: `eval-lora-nuevo.ts` y `eval-lora-product-v007.ts` desactivan TLS estricto si se usa `--insecure-tls`; no usar esa opción en una evaluación de aceptación.

### 9.3 Scripts de `package.json` relacionados

| Área | Comandos declarados | Clasificación de baseline |
|---|---|---|
| RAG | `rag:eval`, `rag:eval-presupuesto`, `rag:eval-parser`, `rag:test-event-open`, `rag:test-open-intent`, `rag:test-observability`, `rag:metrics`, `rag:regression` | Mezcla: parser/contratos locales; retrieval/metrics normalmente DB según script. Revisar `DATABASE_URL` antes. |
| RAG E2E/chat | `rag:e2e-v2` usa `--no-key`; `rag:e2e-v2:gemini` usa `.env.local`; `rag:eval-chat` usa `.env.local` | El primero es DB sin Gemini; el segundo y chat requieren credencial/proveedor. |
| RAG integración | `rag:test-validation`, `rag:test-generation-resolver`, `rag:test-webhook` | DB; algunos escriben/borran datos de prueba. Usar PG desechable. |
| IA/LoRA local | `ia:test`, `ia:test-prompts`, `ia:test-lora-compiler`, `lora:test-product-runtime`, `lora:test-registry`, `lora:test-modes`, `lora:test-specializations`, `lora:test-identidad`, `ia:test-plan-lora-e2e`, `ia:test-referencias-perceptual`, `ia:test-referencias-fixture` | L, según los scripts fuente agrupados arriba. |
| LoRA provider/registro | `lora:eval-product-v007`, `lora:record-product-eval-v007`, `lora:backfill`, `lora:wire-v007`, `lora:register-v005` | Provider/costo para la eval; PG/escritura para registro y operaciones de registro. Fuera del fast baseline. |
| Plan | `plan:test-referencia-cobertura`, `plan:test-open-intent-generation`, `plan:test-event-contract`, `chat:test-historial`, `plan:test-contratos`, `plan:test-geometria`, `plan:test-resolver`, `plan:test-presupuesto`, `plan:test-desglose`, `plan:test-orden`, `plan:test-prompt`, `plan:test-material-consistency`, `plan:test` | Principalmente L; `plan:test` encadena pruebas locales. |
| Plan infra/eval | `plan:test-pg`, `plan:eval`, `plan:eval-variedad --fixtures` | `plan:test-pg` y `plan:eval`: DB; `plan:eval-variedad --fixtures`: L; sin `--fixtures` no asumir que sea local. |
| Imagen | `ia:eval` (`eval-image-fidelity`) | L si usa el script local; no confundir con `eval-lora-*`, que es P. |

`npm run build`, `npm run lint`, `npm run build --workspaces --if-present` y `npx tsc --noEmit` son verificaciones relevantes según `AGENTS.md`, pero no se ejecutaron. `npm run build --workspaces --if-present` debe incluir el paquete Happie; la aplicación raíz excluye `packages` de su `tsconfig`.

### 9.4 Scripts Python relacionados

Rutas reales encontradas:

- `scripts/build-sempertex-full-training-dataset.py`
- `scripts/build-sempertex-pilot-dataset.py`
- `scripts/create-dataset-contact-sheets.py`
- `scripts/create-lora-proposal-page-01.py`
- `scripts/create-lora-proposal-pages-01-02.py`
- `scripts/curar_tags_tematicos.py`
- `scripts/empaquetar-dataset-lora-300.py`
- `scripts/extraer_tags.py`
- `scripts/finalize-dataset-manifest.py`
- `scripts/make-dataset-contact-sheet.py`
- `scripts/package-fal-dataset.py`
- `scripts/package-fal-final-dataset.py`
- `scripts/prepare-sempertex-dataset.py`

No son tests/evals automatizados; son preparación, curación, manifest, empaquetado y contact sheets. La clasificación operativa es **L de cálculo/lectura local**, pero varios escriben datasets, ZIPs, manifest o imágenes: no son sin efecto y deben correrse solo sobre copias/targets explícitos. No se encontró servicio Python que los consuma ni archivo de lock/runtime Python específico del dominio.

### 9.5 Baseline mínimo recomendado, sin efectos externos

Como baseline documentado, no ejecutado aquí:

1. L: contratos/fixtures, `test-lora-*`, caption compiler, runtime de vocabulario, compatibilidad y `test-plan-lora-e2e`.
2. L: tests Happie con mocks (`test-happie-webhook`) y contratos de opciones/recomendador que no creen red.
3. L: escenas, prompts, plan, referencia y autoridad comercial.
4. DB: solo en PostgreSQL desechable con snapshot controlado; separar tests mutantes (`test-webhook`, `test-scene-catalog-migration`, aggregates).
5. P: no pertenece al baseline CI rápido. Ejecutar FAL/Gemini solo en job explícito, presupuesto aprobado, inputs versionados y captura de usage/request ID.

## 10. Límites de alcance

- No se auditó visualmente la calidad de imágenes ni se hizo una evaluación estadística de Gemini/FAL.
- No se inspeccionó producción, cuentas provider, despliegues reales, secretos ni estado de la base remota.
- No se corrigieron validaciones, auth, timeouts, CORS, schemas ni rutas.
- No se determinó si `/api/lora/dataset/[archivo]` es públicamente intencional; se marca como decisión pendiente.
- No se certificó que los datos `data/` existan dentro de una imagen Docker limpia; solo se verificó la configuración que los excluye del contexto Docker.
- Los scripts mutantes y provider fueron clasificados por código, no ejecutados.
- Los cambios preexistentes del worktree no se atribuyen a esta auditoría ni se corrigieron.

## 11. Recomendaciones reversibles

1. Crear fixtures versionados para cada contrato: selección LoRA, compatibilidad, manifest v1/v2, estados provider/canónico, Happia response, paquete inactivo, ID fantasma y conversación antes/después de confirmación.
2. Añadir un contrato Pydantic/JSON Schema generado para Python y TypeScript; evitar copiar tipos manualmente. Validar en runtime la respuesta de Happia antes de recomendar.
3. Encapsular primero `artifact-store-local`, catálogo Happia, curadores y compatibilidad en adapters sin cambiar rutas públicas.
4. Definir una tabla de errores estable para ambas familias y no devolver `error.message` de providers al cliente.
5. Añadir timeout/deadline, límites de body y telemetría mínima a Happia/Gemini; registrar provider, modelo, prompt version, request/trace ID y usage estimado/reportado.
6. Mantener un solo dueño de allowlist/vocabulario durante la migración. Comparar salidas TS/Python en modo sombra solo para operaciones sin efectos.
7. Preparar PG desechable para el baseline DB y marcar con claridad tests que escriben/borran. Nunca usar producción.
8. Mantener training/evals pagados detrás de aprobación explícita, feature flag y job separado. No hacer dual-submit ni retry ante incertidumbre.
9. Antes de mover webhooks, agregar contract tests de auth, CORS, status/error, idempotencia y replay; hacer cutover por endpoint con rollback a Next.
10. Tratar el estado conversacional como durable antes de migrarlo: conversation ID, versión, tamaño, expiración y deduplicación.
11. Inventariar y fijar runtime Python/dependencias cuando exista el servicio; hoy no hay ruta ni lock que certificar.

## 12. Dictamen

El corte seguro de etapa 1 es contractual y determinista: schemas, adapters de catálogo/artefacto, curadores Happie, fixtures y baseline local. Se debe mantener en TypeScript la resolución de negocio LoRA, el training FAL, las evaluaciones pagadas, los webhooks externos y la conversación hasta contar con equivalencia verificable. La migración Python no está lista para retirar ninguna ruta existente; sí está lista para diseñar una primera rebanada reversible detrás de contratos versionados.

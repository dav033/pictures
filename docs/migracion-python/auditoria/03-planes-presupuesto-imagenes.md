# Auditoría Etapa 1 — Dominio C: planes, presupuesto e imágenes

**Fecha:** 2026-09-07
**Repositorio:** `C:\Users\davidt\Downloads\demo-decoracion`
**Alcance:** lectura de rutas reales, contratos, consumidores y pruebas. Único archivo escrito: este informe. Sin operaciones pagadas, producción ni cambios de código.

## 1. Resultado ejecutivo

El flujo activo separa razonablemente tres decisiones:

1. Referencias visuales: análisis de imágenes y `ReferenceBlueprintV2`.
2. Plan comercial: contrato `PlanDecoracion` 1.0, catálogo RAG/PostgreSQL, restricciones, resolución, presupuesto y aprobación.
3. Generación: revalidación del plan, escena, prompt, LoRA/proveedor y QA.

La autoridad comercial actual es el catálogo y el plan resuelto, no la salida libre del modelo. La generación consulta proveedor externo solo después de validar plan, catálogo, presupuesto, aprobación y coherencia visual.

**Recomendación de migración:** migrar primero funciones deterministas y testeables: contratos, geometría, despiece, optimización de paquetes, merma, consolidación, presupuesto, hashes y validaciones. Mantener temporalmente Next.js, UI, chat, PostgreSQL/RAG, SQLite legado y proveedores de imagen. Migrar después la orquestación HTTP, Plan 1.1 activo, análisis visual y jobs de generación.

La auditoría se hizo sobre un árbol de trabajo con cambios locales preexistentes, incluidos `src/lib/plan/resolver.ts`, `src/lib/plan/resuelto.ts`, `src/lib/plan/ubicaciones.ts`, `src/lib/cotizacion/motor.ts`, módulos IA y scripts. No se limpiaron ni atribuyeron esos cambios a esta auditoría.

## 2. Rutas reales y ausencias

| Área | Estado verificado | Observación |
|---|---|---|
| `src/lib/plan/` | Existe | Contratos, geometría, restricciones, resolución, hash, aprobación, desglose y optimización. |
| `src/lib/cotizacion/` | Existe | Solo `constantes.ts` y `motor.ts`. |
| `src/lib/materiales/` | Existe | Solo `estimacion.ts`; no hay índice ni segundo módulo de dominio. |
| `src/app/api/generate/` | Existe | Solo `route.ts`; handler grande, con catálogo, plan, escena y proveedor. |
| `src/app/api/references/` | Existe | Solo `analyze/route.ts`. |
| `src/app/api/references/route.ts` | Ausente | No existe endpoint raíz alternativo. |
| `src/app/api/generate/*` adicional | Ausente | No hay subrutas de generación. |
| Plan 1.1 en API/chat | No activo | Hay schema, resolver y pruebas locales; las rutas y la herramienta de confirmación construyen Plan 1.0. |

## 3. Mapa de flujo

1. La UI adjunta referencias mediante `ReferenceAnalysisController`.
2. `POST /api/references/analyze` valida 1–3 imágenes, MIME, dimensiones y límites de base64. Llama al proveedor conversacional. Con `PLAN_DECORACION_ENABLED`, el modo perceptual devuelve semántica visual sin decidir productos.
3. La UI conserva el blueprint y abre `POST /api/chat`. El flujo SSE ejecuta herramientas de `src/lib/ia/registro-herramientas.ts`.
4. `confirmar_plan_decoracion` construye `PlanDecoracion` 1.0, valida restricciones, cobertura de referencias, cardinalidad del evento, whitelist de variantes, resolución, materiales, presupuesto y aprobación.
5. La herramienta produce `PlanResuelto`, `Cotizacion` y token HMAC. La UI muestra `TarjetaPlanDecoracion` y `TarjetaCotizacion`. La generación requiere aprobación explícita.
6. `POST /api/generate` vuelve a validar plan, `plan_hash`, token, catálogo, allowlist LoRA, estimación de materiales, blueprint, escena, prompt y coherencia física.
7. Solo después se invoca Gemini o LoRA/FAL. Puede existir una llamada adicional de comparación o un retry correctivo de QA.
8. `plan-editar` re-resuelve el plan editado, verifica hash y aprobación, recalcula presupuesto y emite un nuevo token.

## 4. Inventario de contratos y consumidores

| Contrato | Definición | Consumidores principales | Estado migratorio |
|---|---|---|---|
| `PlanDecoracion` 1.0 | `src/lib/plan/tipos.ts` | `registro-herramientas.ts`, `generate`, `plan-editar`, UI, pruebas | Activo. Schema estricto, IDs, estructuras, medidas, materiales, restricciones y presupuesto. |
| `PlanDecoracion` 1.1 | `src/lib/plan/tipos.ts`, `composicion.ts` | Resolver y fixtures locales | Experimental/dormido. Añade anclas, relaciones, escultura, props y BOM. No es contrato activo de chat/generate. |
| `PlanResuelto` | `src/lib/plan/resuelto.ts` | `resolver.ts`, `cotizacion/motor.ts`, `generate`, componentes, desglose, prompts | Contrato comercial interno. Incluye compras consolidadas, cantidades, merma, sustituciones, hash, estado y trazabilidad. |
| `Cotizacion` | `src/lib/cotizacion/motor.ts` | UI, `generate`, `plan-editar`, borrador de cotización | Contrato de presentación/compras. Precio por paquete, IVA, cantidades de diseño, reserva, sobrante y consumo. |
| `MaterialEstimate` | `src/lib/materiales/estimacion.ts` | `generate`, `build-image-prompt`, `scene-spec`, QA y pruebas | Contrato físico/visual. Recalcula capacidad, merma, compras y warnings bloqueantes. |
| `ReferenceBlueprintV2` | módulos IA de referencias | controller, chat, plan card, scene spec, generate | Contrato de percepción y cobertura. En modo perceptual no autoriza productos. |
| `SceneSpec` | `src/lib/ia/scene-spec.ts` | generate, prompt compiler, QA | Contrato visual aprobado. Diferencia elementos de catálogo y referencia solamente visual. |
| Hash de plan | `src/lib/plan/hash.ts` | chat, generate, plan-editar, UI | Integridad. Cambios de layout, cantidades, precios o catálogo alteran el snapshot resuelto. |
| Token de aprobación | `src/lib/plan/aprobacion.ts` | chat, generate, plan-editar | HMAC con `planHash`, `requestId` y expiración de 24 h. Producción exige secreto. |
| Transporte HTTP/SSE | rutas API y `ejecutar.ts` | navegador, cliente IA, proveedor | Body de `generate`, `references` y `chat` usa casts y validación parcial; frontera prioritaria de endurecimiento. |

Consumidores relacionados revisados: `src/app/page.tsx`, `TarjetaPlanDecoracion.tsx`, `TarjetaCotizacion.tsx`, `ReferenceAnalysisController`, `src/app/api/chat/route.ts`, `src/app/api/plan-editar/route.ts`, `build-image-prompt.ts`, `scene-spec.ts`, `image-qa.ts`, módulos LoRA y rutas de debug.

## 5. Dependencias y acoplamientos

| Capa | Dependencias observadas | Implicación |
|---|---|---|
| Dominio determinista | Zod, utilidades de plan, geometría, optimizador, hash | Buena primera frontera Python. Requiere igualdad numérica y de redondeo. |
| Catálogo | PostgreSQL/RAG (`catalog_products`, `catalog_variants`), SQLite/Shopify legado | Dos fuentes con IDs y cobertura distintos. El resolver PG es autoridad para el plan RAG; no fusionar silenciosamente. |
| Aplicación | Herramientas IA, `resolverPlan`, estimador, cotizador, aprobación | Orquestación hoy distribuida entre chat, rutas y UI. Necesita adapter explícito durante migración. |
| Transporte | Next.js route handlers, SSE, cookies, payloads JSON | No debe entrar en el dominio Python. Requiere contratos versionados y errores estables. |
| Proveedores | Gemini para chat/visión/generación; LoRA/FAL opcional | Credenciales, latencia, retry y coste externos. No son baseline local. |
| Presentación | Página, tarjetas, estado de borrador | Consume IDs, nombres, cantidades, merma, estado comercial y token; romper nombres o cardinalidad rompe UI. |

## 6. Reglas de negocio que deben preservarse

1. **Catálogo:** producto, variante, SKU, precio, disponibilidad, unidades por paquete e imagen vienen del catálogo. El modelo no puede inventar productos, precios ni disponibilidad.
2. **Whitelist:** la resolución debe respetar variantes recuperadas y allowlist LoRA a nivel producto-variante. Producto y variante no son intercambiables.
3. **Versionado:** Plan 1.0 es el contrato activo. Plan 1.1 no debe activarse por inferencia; requiere negociación de versión y consumidores compatibles.
4. **Estructuras:** IDs únicos, al menos un foco, un fondo y un techo como máximo, tipos y ubicaciones permitidos, medidas explícitas o defaults documentados, relaciones válidas y referencias cubiertas u omitidas con motivo.
5. **Geometría:** unidades y despiece deben ser deterministas. Diámetros estándar y sustitución admisible están restringidos; no permitir sustituciones lejanas como R12 a R24.
6. **Materiales:** las participaciones de una estructura suman aproximadamente 1; geometrías no declaran unidades libres; elementos no geométricos declaran unidades y variante exacta; escultura/props usan BOM y origen trazable.
7. **Compra:** optimización por paquetes cerrados. Objetivo ordenado: coste, sobrante, cantidad de paquetes y `variant_id` estable.
8. **Merma:** default actual `MERMA = 0.08`; la reserva de proyecto se distribuye por compatibilidad. La merma no se representa visualmente como decoración adicional.
9. **Presupuesto:** total comercial basado en paquetes comprados y precios catalogados; IVA y estado `VERIFICADO`, `APROBACION_REQUERIDA` o `PRESUPUESTO_EXCEDIDO` deben conservarse.
10. **Integridad:** `plan_hash` y hash resuelto cubren plan, catálogo, cantidades, compras, layout y totales. El token HMAC debe verificar hash, request y expiración.
11. **Percepción versus decisión:** el blueprint visual puede describir una referencia; solo el plan aprobado y el catálogo autorizan materiales y generación comercial.
12. **Visual:** prompt y escena deben conservar estructura, tamaño físico y trazabilidad; no incluir sobrante de paquetes como objetos visibles; QA aprobado para planes aprobados.
13. **Seguridad:** autenticación, autorización, límites de imágenes, timeouts, errores deliberados y secretos server-only. Un timeout del proveedor no confirma cancelación ni ausencia de cobro.

## 7. Matriz de migración

| Decisión | Componentes | Motivo y condición de salida |
|---|---|---|
| **Migrar ahora** | Schemas Zod y validaciones de dominio; composición; defaults de medidas; despiece; restricciones; `optimizar-materiales`; `cotizarProductos`/parte pura de `cotizarPlan`; estimación y totales; hash canónico | Deterministas, testeables sin proveedor, impacto directo en presupuesto. Primero golden vectors TS/Python y comparación exacta; TS sigue como autoridad hasta cerrar divergencias. |
| **Migrar ahora, con adapter** | `PlanResuelto`, `Cotizacion`, `MaterialEstimate`, estados comerciales y errores estables | Contratos usados por muchas capas. Exponer versión y JSON canónico; no duplicar reglas en dos implementaciones sin comparación. |
| **Mantener temporalmente** | `generate/route.ts`, `references/analyze/route.ts`, `chat/route.ts`, `plan-editar/route.ts`, UI y SSE | Transporte, autenticación, cookies, streaming y coordinación. Migrarlos antes de congelar contratos amplía el radio de reversión. |
| **Mantener temporalmente** | Repositorios PG/RAG, catálogo SQLite/Shopify legado, allowlists y adaptadores de proveedor | Dependencias externas y fuentes con cobertura distinta. Encapsular; no cambiar autoridad en esta etapa. |
| **Migrar después** | Activación de Plan 1.1, escultura, props, anclas y relaciones en chat/generate | Hay soporte parcial en resolver/pruebas, pero no consumidores activos. Requiere contrato, edición, UI, hash, escena y rollback versionados. |
| **Migrar después** | Análisis visual LLM, compilación de prompt, LoRA/FAL, Gemini, image QA y retries | Dependencia de credenciales, latencia, coste y evaluación probabilística. Mantener fuera del primer corte determinista. |
| **Migrar después** | Jobs durables, idempotencia, cancelación confirmada, auditoría persistente y métricas de coste | Riesgo operativo separado. Requiere decisión de infraestructura, no una traducción directa de módulos. |

## 8. Riesgos y reversión

| Riesgo | Evidencia | Reversión segura |
|---|---|---|
| Deriva entre TS y Python | Cambios locales actuales en resolver, resuelto, motor y ubicaciones | Congelar commit, fixtures JSON y comparación dual; flag de lectura Python; volver a TS sin cambiar DB. |
| Diferencia de redondeo/COP/merma | Optimización por paquetes y `ceil` en varias capas | Vectores con cantidades, precios, IVA, sobrante y `MERMA`; usar enteros/`Decimal` definidos; fallback TS. |
| Catálogo equivocado | PG/RAG y SQLite/Shopify no tienen la misma cobertura ni IDs | Repository adapter con snapshot/identificador de fuente; rechazar mismatch; no reconciliar por nombre. |
| Token/hash incompatible | Aprobación HMAC y hash resuelto cruzan UI, chat y rutas | Mantener algoritmo, payload y TTL; versionar token; kill switch para ruta Python. |
| Plan 1.1 accidental | Schema/resolver existen, consumidores activos siguen 1.0 | Gate de versión explícito; no aceptar 1.1 hasta cubrir chat, edición, UI y generate. |
| Llamadas pagadas duplicadas | Comparación puede llamar dos proveedores; QA puede hacer retry Gemini | Flag por defecto apagado; presupuesto/request ID; registrar provider/model/usage; no retry automático tras efecto incierto. |
| Entrada HTTP insuficientemente validada | Casts en body de `generate`, `references` y `chat`; URLs remotas en generación | Schema runtime por endpoint, límites y allowlist de destinos; conservar errores 4xx estables. |
| Handler monolítico | `generate/route.ts` supera 1.000 líneas; mezcla HTTP, catálogo, dominio y proveedor | Extraer por adapter en cortes pequeños; rollback por feature flag; no reescritura global. |

Reversión de la migración propuesta: desactivar flag de lectura Python, mantener el mismo payload versionado, volver a resolver/cotizar en TS y comparar `plan_hash`/totales antes de aceptar. No introducir cambios de esquema ni doble escritura en Etapa 1.

## 9. Baseline de pruebas y coste

### Ejecutado, local y sin proveedor

| Comando | Resultado | Cobertura |
|---|---|---|
| `npm run plan:test` | PASS | Contratos, geometría, resolver, presupuesto, desglose, orden, prompt, consistencia de materiales, intención abierta y contrato E2E de evento. |
| `npm run ia:test-referencias-fixture` | PASS | Fixture local; selección, capas, alcance, cobertura y grupos UI. |
| `npm run ia:test-referencias-perceptual` | PASS | El modo perceptual no emite `catalog_product_id` ni `bill_of_materials`. |

Estas pruebas no requirieron credenciales ni llamadas pagadas. `plan:test` pasó sobre el árbol de trabajo actual, no sobre un checkout limpio.

### No ejecutado y motivo

- `npm run plan:test-pg`, `plan:eval`, `rag:test-generation-resolver` y evaluaciones de catálogo: requieren PostgreSQL, `.env.local` o snapshots; no se ejecutaron para evitar tocar una base externa o producción.
- Rutas reales de `/api/references/analyze` y `/api/generate`: no se ejecutaron con proveedor; requieren credenciales y pueden incurrir coste.
- Comparación de proveedores y retry correctivo: coste potencial de dos o más llamadas por solicitud.
- `lint`, `build` y `tsc`: no son necesarios para una auditoría documental y no se presentan como PASS.

Referencia operativa del repositorio: el requisito documentado fija p95 de imagen de 90 s y presupuesto objetivo máximo de USD 0,75 por imagen incluyendo un retry. `generate` declara `maxDuration = 120`, pero el límite de coste no aparece como guardia completa en el contrato. La medición real de proveedor queda pendiente con credenciales controladas.

## 10. Límites de alcance

- No se implementó Python ni se modificó código.
- No se validaron credenciales, precios vivos, latencia real, producción ni despliegue.
- No se hizo prueba contra PostgreSQL ni contra Gemini/FAL.
- No se auditó el dominio fuera de consumidores necesarios para planes, presupuesto e imágenes.
- La presencia de Plan 1.1 se reporta como capacidad parcial, no como flujo productivo.

## 11. Recomendaciones reversibles

1. Congelar el contrato 1.0 activo y registrar fixtures JSON canónicos de plan, resolución, cotización, estimación, hash y aprobación.
2. Crear una implementación Python pura detrás de un adapter, sin cambiar rutas ni UI. Comparar resultados TS/Python en modo sombra.
3. Definir formalmente enteros monetarios, redondeo, IVA, unidades físicas, merma, sustitución y errores versionados.
4. Encapsular PostgreSQL/RAG y SQLite/Shopify como repositorios separados, con `source_snapshot` obligatorio en resultados.
5. Añadir validación runtime de todos los bodies y respuestas externas antes de mover transporte.
6. Medir coste y uso por `request_id`, proveedor, modelo, versión de prompt y retry; bloquear comparación/retry fuera de un presupuesto explícito.
7. Activar Plan 1.1 solo tras cubrir chat, edición, UI, `generate`, escena, hash, aprobación y tests de rollback.
8. Mantener un kill switch de migración y documentar la señal de retiro: equivalencia de golden vectors, pruebas de contrato, reversión ensayada y observabilidad suficiente.

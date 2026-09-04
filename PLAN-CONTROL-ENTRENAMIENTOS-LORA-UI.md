# Plan: control de entrenamientos LoRA desde UI

Estado: listo para implementación  
Fecha: 2026-08-28  
Superficie principal: `/configuracion-lora`  
Superficie consumidora: asistente `/`

## 1. Decisiones confirmadas

- `/configuracion-lora` será centro de control del ciclo completo: preparar y exportar dataset, revisar estadísticas, configurar y lanzar entrenamiento, consultar estado, recibir y respaldar pesos, evaluar, asignar a un modo, activar y revertir.
- Habrá tres modos LoRA visibles en el asistente:
  - `Unlimited`: usa un entrenamiento LoRA asignado, pero permite cualquier elemento válido del catálogo.
  - `LoRA Training 1`: usa el entrenamiento asignado al slot 1 y limita estructuras/productos a los presentes en su dataset.
  - `LoRA Training 2`: usa el entrenamiento asignado al slot 2 y aplica la misma limitación.
- Los nombres de los slots serán estables, pero el administrador podrá cambiar qué entrenamiento ocupa cada slot.
- Si un plan contiene elementos no cubiertos por el entrenamiento seleccionado, no habrá sustitución automática. La generación se detendrá antes de gastar dinero y el usuario elegirá reemplazos compatibles.
- El historial y las estadísticas vivirán en PostgreSQL. ZIP, manifiestos, reportes y pesos vivirán en almacenamiento persistente mediante una abstracción con driver local para desarrollo y driver de objetos para despliegue.
- La pantalla conservará estructuras desplegables con fotos asociadas y la lista Shopify consolidada completa.
- No se volverán a agregar las categorías `Colores` ni `Acabados`.

## 2. Resultado esperado

Un administrador podrá crear un entrenamiento reproducible y auditable sin ejecutar scripts manuales. Cada dataset exportado tendrá un snapshot inmutable de imágenes, captions, procedencia y elementos representados. Cada corrida guardará parámetros, costo, estado, resultado y evaluación. El asistente resolverá el modelo desde el servidor y aplicará el límite correspondiente antes de llamar a fal.ai.

Flujo principal:

```text
Fuentes aprobadas
    |
    v
Vista previa y auditoría
    |
    v
Exportación inmutable: ZIP + manifiesto + estadísticas + hashes
    |
    v
Corrida: pasos + learning rate + costo + solicitud fal.ai
    |
    v
Recepción y respaldo de pesos
    |
    v
Evaluación con protocolo versionado
    |
    v
Asignación a Unlimited / Training 1 / Training 2
    |
    v
Generación con validación de cobertura y reemplazo elegido por usuario
```

## 3. Estado actual que debe evolucionar

### UI y generación

- `src/app/configuracion-lora/page.tsx` lee un único archivo fijo: `data/processed/lora-v004-composicion.json`.
- `src/app/page.tsx` maneja `selectorIA` con un valor único `lora` y envía `usarLora: true`.
- `src/app/api/generate/route.ts` interpreta booleanos (`usarLora`, `comparar`, `compararLora`). No recibe identidad de entrenamiento ni modo limitado.
- `src/lib/ia/sempertex-lora.ts` usa una URL, trigger y escala globales. No puede resolver diferentes entrenamientos por solicitud.

### Dataset y entrenamiento

- `scripts/exportar-dataset-fal.ts` crea ZIP y manifiesto, pero no registra una entidad histórica en DB.
- `scripts/analizar-composicion-lora.ts` está amarrado a v004 y rutas fijas.
- `scripts/entrenar-lora-v004.ts` sube el ZIP, lanza fal.ai y guarda un JSON local; mantiene el proceso abierto consultando hasta tres horas.
- `scripts/recibir-lora.ts`, `scripts/eval-lora-nuevo.ts` y `scripts/promover-lora.ts` cubren fases útiles, pero no comparten un registro transaccional.
- La promoción modifica `.env.local`, por lo que solo existe un LoRA global y no queda un historial completo de asignaciones por modo.

### Datos que ya pueden reutilizarse

- `feedback-*.json` aporta `aptoParaEntrenamiento`, categoría y `productosRepresentados[].representado`.
- `desglose.json` aporta producto, variante, SKU y cantidad reales de Shopify.
- Captions controlados permiten contar estructuras y relaciones espaciales.
- `PlanResuelto` ya contiene `estructuras[].tipo`, `lineas[].variant_id`, SKU y compras consolidadas.
- `SceneSpec` ya contiene elementos canónicos y `catalog_product_ids` antes de la llamada pagada.
- PostgreSQL y el sistema de migraciones ya existen.
- `src/proxy.ts` protege la aplicación con sesión derivada de `APP_PASSWORD`.

## 4. Principios del diseño

1. **Snapshot, no lectura viva.** Estadísticas de un entrenamiento nunca se recalculan contra archivos que puedan cambiar. Salen del manifiesto congelado al exportar.
2. **Dataset y corrida son entidades distintas.** Un mismo ZIP puede entrenarse con 1000, 1500 o 1950 pasos. El número de imágenes pertenece al dataset; pasos, learning rate y costo pertenecen a la corrida.
3. **Nada se infiere como representado.** Un producto Shopify solo entra en la lista permitida si una fuente explícita lo confirma. Para pedidos: `feedback.representado === true` y coincidencia con `desglose.json`.
4. **Validación antes del costo.** Incompatibilidades, captions faltantes, duplicados, configuración inválida y restricciones se resuelven antes de subir o generar.
5. **Servidor como autoridad.** El navegador envía el ID del modo; nunca una URL arbitraria de LoRA, una escala libre ni una lista permitida manipulable.
6. **Operaciones recuperables.** Ningún proceso de varias horas depende de memoria, intervalos o de mantener una pestaña abierta.
7. **Activación separada del entrenamiento.** Terminar una corrida no la pone en producción. Debe recibirse, evaluarse y asignarse explícitamente.
8. **Trazabilidad completa.** Todo artefacto tendrá ID, versión de esquema, timestamps, hashes y relación con su origen.

## 5. Modelo de datos

Crear `scripts/migrations/015_lora_training_registry.sql`. IDs generados en servidor; timestamps en UTC.

### `lora_datasets`

Un registro por exportación inmutable.

Campos mínimos:

- `id`: identificador estable.
- `label`: nombre humano, por ejemplo `sempertex-v005-300`.
- `schema_version`: versión del manifiesto.
- `status`: `building | ready | failed | archived`.
- `trigger_token`.
- `source_definition`: JSONB con criterios de selección y versiones de las fuentes.
- `image_count`, `caption_count`.
- `zip_storage_key`, `zip_sha256`, `zip_bytes`.
- `manifest_storage_key`, `manifest_sha256`.
- `statistics`: JSONB con snapshot agregado.
- `coverage_status`: `complete | partial | unknown`.
- `coverage_reviewed_images`, `coverage_total_images`.
- `error_message`.
- `created_at`, `exported_at`, `archived_at`.

Restricciones:

- ZIP y manifiesto requeridos cuando `status = ready`.
- `image_count = caption_count` para datasets entrenables.
- Etiqueta única.
- Hash del ZIP único para detectar exportaciones duplicadas.

### `lora_dataset_images`

Una fila por imagen incluida.

- `dataset_id`, `image_key` como clave compuesta.
- `image_sha256`, `caption_sha256`.
- `width`, `height`, `mime_type`.
- `source_kind`: `order_feedback | approved_manifest | manual | legacy_import`.
- `source_order`, `source_photo_index`, `source_ref`.
- `caption_word_count`.
- `review_status`: `confirmed | empty_confirmed | pending`.
- `metadata`: JSONB para rol, tema y transformaciones.

Unicidad adicional: `dataset_id + image_sha256` para prohibir duplicados dentro del mismo dataset.

### `lora_dataset_image_elements`

Relación verificable entre una imagen y un elemento visible.

- `dataset_id`, `image_key`.
- `element_kind`: `structure | shopify_variant | environment | spatial_relation`.
- `canonical_id`.
- `label`.
- `product_id`, `variant_id`, `sku` cuando corresponda.
- `evidence_kind`: `feedback_confirmed | controlled_caption | manual_review | imported_snapshot`.
- `evidence_ref`.

Para límites de generación se usarán solo:

- `structure` confirmado por vocabulario controlado o revisión humana.
- `shopify_variant` confirmado por datos de procedencia.

`environment` y `spatial_relation` alimentan estadísticas, no bloquean generación.

### `lora_dataset_element_stats`

Snapshot agregado para lectura rápida de UI.

- `dataset_id`, `element_kind`, `canonical_id`.
- `label`, `product_id`, `variant_id`, `sku`.
- `image_count`.
- `representation_pct`: `image_count / dataset.image_count * 100`.
- `image_keys`: JSONB con imágenes asociadas.

La lista Shopify se consolida por `variant_id`; si una fuente histórica no lo tiene, usar SKU; como último recurso una clave normalizada producto + variante y marcarla como identidad incompleta.

### `lora_training_runs`

Una fila por corrida real, incluso si reutiliza el mismo dataset.

- `id`, `label`, `dataset_id`.
- `provider`: inicialmente `fal`.
- `trainer_endpoint`, `output_lora_format`.
- `steps`, `learning_rate`.
- `estimated_epochs`: valor informativo calculado con fórmula versionada.
- `estimated_cost_usd`, `actual_cost_usd`.
- `status`: `draft | uploading | queued | running | succeeded | failed | cancelled`.
- `provider_request_id`.
- `provider_status_url`, `provider_response_url`: solo servidor.
- `uploaded_dataset_url`: solo servidor.
- `result_url`.
- `weight_storage_key`, `weight_sha256`, `weight_bytes`, `rank`, `architecture`.
- `artifact_status`: `pending | backed_up | invalid`.
- `configuration_snapshot`: JSONB inmutable enviado al proveedor.
- `provider_result_snapshot`: JSONB sanitizado.
- `error_message`.
- `created_at`, `submitted_at`, `started_at`, `completed_at`, `received_at`.

La corrida solo puede iniciarse si el dataset está `ready` y `coverage_status` no está `unknown`.

### `lora_evaluations`

- `id`, `training_run_id`.
- `protocol_version`.
- `lora_scale`.
- `seeds`: JSONB.
- `criteria`: JSONB.
- `passed_count`, `total_count`.
- `verdict`: `pending | approved | rejected`.
- `report_storage_key`.
- `result_snapshot`: JSONB.
- `created_at`, `completed_at`.

La regla inicial seguirá siendo 5/6 como mínimo a escala 0,8. Escala 1,0 se conserva como medición adicional.

### `lora_mode_slots`

Tres filas estables:

| `slug` | Nombre visible | Límite |
|---|---|---|
| `unlimited` | Unlimited | No aplica allowlist del dataset |
| `training_1` | LoRA Training 1 | Estructuras y variantes del dataset |
| `training_2` | LoRA Training 2 | Estructuras y variantes del dataset |

Campos:

- `slug`, `display_name`.
- `training_run_id`.
- `enforce_dataset_allowlist`.
- `lora_scale`.
- `enabled`.
- `updated_at`.

Solo corridas `succeeded`, respaldadas y aprobadas pueden asignarse. `Unlimited` también usa una corrida asignada; solo omite el límite de cobertura.

### `lora_mode_slot_history`

Historial append-only de activaciones y reversiones:

- slot, corrida anterior, corrida nueva.
- acción: `assign | activate | disable | rollback`.
- snapshot de escala y evaluación.
- timestamp y actor.

### `lora_jobs`

Registro recuperable para tareas largas:

- `kind`: `dataset_export | training_sync | weight_backup | evaluation`.
- `resource_id`.
- `status`: `pending | running | succeeded | failed`.
- `attempts`, `locked_at`, `heartbeat_at`, `error_message`.
- `created_at`, `finished_at`.

No se guardarán binarios en PostgreSQL.

## 6. Manifiestos inmutables

Crear esquema Zod versionado `lora-dataset-manifest.v1`. El JSON acompañará siempre al ZIP.

Contenido mínimo:

```json
{
  "schemaVersion": "lora-dataset-manifest.v1",
  "dataset": {
    "id": "...",
    "label": "sempertex-v005-300",
    "trigger": "eventdecor_style_v2",
    "imageCount": 300,
    "captionCount": 300,
    "zipSha256": "..."
  },
  "sourceDefinition": {},
  "images": [
    {
      "key": "...",
      "imageSha256": "...",
      "captionSha256": "...",
      "source": {},
      "reviewStatus": "confirmed",
      "elements": []
    }
  ],
  "statistics": {
    "structures": [],
    "shopifyVariants": [],
    "environment": [],
    "spatialRelations": []
  }
}
```

Crear también `lora-training-receipt.v1` por corrida. Este sí incluye dataset ID/hash, pasos, learning rate, costo, request ID, resultado, hash de pesos y evaluación. Así se cumplen estadísticas completas sin mezclar parámetros de corrida con identidad del dataset.

## 7. Pipeline de exportación

Extraer lógica reutilizable de los scripts a módulos server-only. Los scripts y la UI llamarán la misma implementación.

### Paso 1: definición de fuente

El administrador selecciona:

- versión/nombre del dataset;
- fuente aprobada;
- criterios de inclusión;
- trigger;
- política de captions;
- mínimo de resolución;
- si agrega imágenes manuales revisadas.

La definición queda guardada antes de procesar.

### Paso 2: vista previa sin escritura

Calcular:

- imágenes candidatas, aceptadas y rechazadas;
- captions faltantes o inválidos;
- hashes duplicados;
- resolución y orientación;
- cobertura de procedencia;
- estructuras;
- productos/variantes Shopify confirmados;
- distribución por fuente, rol y tema;
- gaps relevantes, como bilateralidad o centros de mesa.

La vista previa no crea ZIP ni cambia estado.

### Paso 3: revisión de procedencia

Cada imagen debe quedar en uno de estos estados:

- `confirmed`: tiene elementos confirmados.
- `empty_confirmed`: revisor confirma que aporta estilo/composición, pero no una identidad específica restringible.
- `pending`: falta clasificación.

Un dataset puede exportarse con cobertura parcial para experimentación, pero no puede alimentar `Training 1/2` hasta resolver todos los `pending`. `Unlimited` sí puede usarlo tras aprobación técnica.

Brecha actual importante: las 146 imágenes adicionales de v005 vienen de `sempertex-full-v001`, cuyo manifiesto conserva rol/tema/origen pero no todos los IDs Shopify visibles. Se requiere backfill o revisión explícita; no se inferirán IDs desde captions.

### Paso 4: pre-vuelo obligatorio

- exactamente un caption por imagen;
- nombres base únicos;
- hashes de imagen únicos;
- trigger correcto;
- vocabulario prohibido según versión de reglas;
- dimensiones válidas;
- imagen decodificable;
- producto Shopify solo cuando existe evidencia;
- estructura dentro de taxonomía canónica;
- ningún path fuera de directorios autorizados.

### Paso 5: exportación

1. Crear dataset con estado `building`.
2. Generar archivos en directorio temporal propio del dataset.
3. Producir ZIP plano compatible con fal.ai.
4. Generar manifiesto y estadísticas desde las entradas efectivamente empaquetadas.
5. Calcular hashes.
6. Subir/mover artefactos al almacenamiento persistente.
7. Insertar imágenes, relaciones y agregados.
8. Marcar `ready` solo al completar todo.
9. Si falla, marcar `failed`; nunca dejar un dataset aparentemente listo.

## 8. Control del entrenamiento

### Configuración

Formulario con:

- dataset listo;
- etiqueta de corrida;
- pasos;
- learning rate;
- formato de salida;
- escalas de evaluación;
- criterio de aprobación.

Mostrar antes de confirmar:

- número de imágenes;
- pasadas estimadas;
- costo estimado;
- cobertura de elementos;
- advertencias por pasos o learning rate altos;
- hash corto del ZIP.

Valores iniciales para v005: 1500 pasos y learning rate `0.00005`. Permitir otros valores, pero exigir confirmación reforzada por encima de 2000 pasos o `0.0001`.

### Inicio pagado

- `POST` idempotente; doble clic no puede crear dos corridas pagadas.
- El usuario confirma costo y corrida exacta.
- El servidor vuelve a validar dataset y configuración.
- Se toma snapshot inmutable del payload.
- Se sube el ZIP una vez.
- Se envía a fal.ai y se guardan `request_id`, URLs de seguimiento y saldo inicial.
- La respuesta HTTP termina al recibir la solicitud de cola; no espera horas.

### Seguimiento

- UI consulta estado con backoff mientras está abierta.
- Un worker recuperable sincroniza corridas pendientes aunque la pestaña se cierre.
- Cada sincronización actualiza timestamps y errores sin duplicar solicitudes.
- Al completar, se obtiene resultado, se guarda snapshot sanitizado y se agenda respaldo.
- Si fal.ai permite cancelación, exponerla. Si no, `Descartar` solo impide evaluación/promoción; no prometer cancelación inexistente.

### Recepción

- Validar cabecera safetensors, arquitectura FLUX, número de tensores, rank y tamaño.
- Descargar copia persistente inmediatamente.
- Validar bytes y SHA-256.
- No considerar corrida utilizable hasta `artifact_status = backed_up`.
- Conservar URL original del proveedor como procedencia, no como único respaldo.

### Evaluación y promoción

- Reusar protocolo de seis semillas a escala 0,8 y 1,0.
- Guardar imágenes, prompts, seeds, criterios y veredicto.
- Promoción bloqueada si no alcanza 5/6 a 0,8.
- Asignar una corrida aprobada a uno o varios slots mediante acción explícita.
- Revertir restaura asignación anterior desde historial; no edita `.env.local`.

## 9. Modos de generación

### Contrato nuevo

Reemplazar progresivamente `usarLora?: boolean` por un contrato explícito:

```ts
type LoraModeSlug = "unlimited" | "training_1" | "training_2";

type ImageEngineSelection =
  | { kind: "base" }
  | { kind: "lora"; mode: LoraModeSlug }
  | { kind: "compare"; mode: LoraModeSlug };
```

Durante migración, `usarLora: true` equivale a `kind: "lora", mode: "unlimited"`. El servidor registrará uso legacy hasta retirarlo.

### Resolución del LoRA

Crear un resolver server-only que, dado un slot:

1. carga slot habilitado;
2. carga corrida asignada;
3. comprueba corrida aprobada y pesos respaldados;
4. devuelve URL interna/proveedor, trigger, escala, run ID y dataset ID;
5. devuelve error operativo claro si el slot no está listo.

`generarConSempertexLora` recibirá esta configuración resuelta. Se eliminará dependencia funcional de una sola `SEMPERTEX_LORA_URL`; la variable queda como fallback temporal durante migración.

### Allowlist de `Training 1/2`

Validar después de resolver `PlanResuelto`/`SceneSpec`, pero antes de cargar imágenes, construir prompts o abrir llamada pagada.

Conjunto solicitado:

- tipos de `plan.estructuras[].tipo`;
- todos los `variant_id` de `plan.estructuras[].lineas` y `plan.compras`;
- IDs canónicos de `SceneSpec.catalog_product_ids` como control adicional.

Conjunto permitido:

- estructuras del snapshot `lora_dataset_element_stats`;
- variantes Shopify del mismo snapshot;
- aliases históricos solo si fueron revisados y resueltos a ID canónico.

`Unlimited` omite esta comparación, pero mantiene todas las reglas actuales de catálogo, cotización, procedencia y QA.

### Resultado incompatible

Responder antes de generar con HTTP `409` y código estable `LORA_UNSUPPORTED_ELEMENTS`:

```json
{
  "mode": "training_1",
  "trainingRunId": "...",
  "unsupported": [
    {
      "kind": "shopify_variant",
      "requestedId": "...",
      "label": "...",
      "structureId": "EST_01_ARCO",
      "candidates": []
    }
  ]
}
```

Nunca eliminar elementos silenciosamente ni continuar con un prompt incompleto.

## 10. Flujo para elegir reemplazos

1. El asistente muestra panel/modal `Este entrenamiento no conoce 2 elementos`.
2. Cada elemento incompatible conserva contexto: estructura, cantidad, producto solicitado y motivo.
3. Candidatos se obtienen del catálogo real, filtrados primero por allowlist del dataset y luego por compatibilidad de función, forma, tamaño y uso.
4. Mostrar foto, producto, variante, SKU y representación en el dataset.
5. Usuario elige un reemplazo por cada incompatibilidad. No hay opción preseleccionada.
6. Aplicar mediante el flujo existente de edición del plan, no alterando solo el prompt.
7. Recalcular materiales, cotización, `plan_hash` y `SceneSpec`.
8. Si cambió la cotización o el plan aprobado, pedir nueva aprobación.
9. Ejecutar nuevamente validación server-side.
10. Solo entonces llamar al modelo.

Para estructuras incompatibles, candidatos serán tipos estructurales presentes en el dataset y compatibles con rol/ubicación. Para variantes, se reutilizará búsqueda/recomendación de `/api/plan-editar`, agregando filtro obligatorio `allowedVariantIds`.

## 11. Diseño de `/configuracion-lora`

Modo de uso: operación administrativa. Prioridad a estado, riesgo, comparación y acciones claras.

### Encabezado

- estado general del sistema;
- saldo fal.ai disponible si la API lo permite;
- botón `Nuevo entrenamiento`;
- acceso al historial;
- alerta visible si algún slot no tiene corrida válida.

### Bloque `Modos activos`

Tres tarjetas: Unlimited, Training 1 y Training 2.

Cada tarjeta muestra:

- corrida asignada;
- dataset y número de imágenes;
- escala;
- modo restringido/no restringido;
- evaluación;
- fecha de activación;
- acciones `Cambiar`, `Desactivar`, `Revertir`.

### Bloque `Entrenamientos`

Tabla/lista con:

- etiqueta;
- dataset;
- imágenes;
- pasos;
- learning rate;
- costo;
- estado;
- evaluación;
- slots asignados;
- fecha.

Filtros: estado, dataset y slot. Acceso a detalle por fila.

### Asistente `Nuevo entrenamiento`

Etapas:

1. Fuente del dataset.
2. Vista previa y cobertura.
3. Revisión de imágenes pendientes.
4. Exportación.
5. Parámetros y costo.
6. Confirmación pagada.
7. Seguimiento.
8. Recepción y evaluación.
9. Asignación opcional a slot.

Cada etapa guarda progreso. Recargar no reinicia proceso.

### Detalle del entrenamiento

- timeline de estados;
- parámetros y recibo inmutable;
- hashes y artefactos;
- costo estimado/real;
- evaluación por escala y seed;
- composición del dataset;
- comparación contra otra corrida;
- acciones permitidas según estado.

### Composición del dataset

Conservar comportamiento actual:

- estructuras desplegables;
- fotos asociadas a cada estructura;
- todos los elementos Shopify consolidados;
- producto, variante, SKU, cantidad de fotos y porcentaje;
- orden por mayor representación confirmada;
- búsqueda y filtros para manejar cientos de productos sin truncarlos.

No mostrar `Colores` ni `Acabados` como grupos.

### Estados de UI obligatorios

- vacío sin datasets;
- exportando;
- entrenamiento en cola/en curso;
- fallo recuperable;
- corrida completada sin respaldo;
- evaluación pendiente;
- slot sin entrenamiento;
- dataset con cobertura parcial;
- incompatibilidades con reemplazos disponibles o sin candidatos;
- móvil y escritorio.

## 12. APIs

Todas las mutaciones requieren sesión válida, mismo origen e idempotencia cuando puedan gastar dinero o duplicar artefactos.

### Lectura

- `GET /api/lora/overview`: slots, corridas recientes, jobs y alertas.
- `GET /api/lora/datasets`: listado paginado.
- `GET /api/lora/datasets/[id]`: manifiesto resumido, estadísticas e imágenes.
- `GET /api/lora/trainings`: historial paginado.
- `GET /api/lora/trainings/[id]`: corrida, artefactos, evaluación y timeline.
- `GET /api/lora/modes`: slots resueltos para selector y administración.

### Dataset

- `POST /api/lora/datasets/preview`: auditoría sin escritura.
- `POST /api/lora/datasets`: crea definición draft.
- `POST /api/lora/datasets/[id]/export`: agenda exportación.
- `POST /api/lora/datasets/[id]/review`: guarda revisión de procedencia.
- `POST /api/lora/datasets/[id]/archive`: archiva sin borrar artefactos.

### Entrenamiento

- `POST /api/lora/trainings`: crea corrida draft.
- `POST /api/lora/trainings/[id]/start`: confirma y envía.
- `POST /api/lora/trainings/[id]/sync`: sincronización manual idempotente.
- `POST /api/lora/trainings/[id]/receive`: reintenta validación/respaldo.
- `POST /api/lora/trainings/[id]/evaluate`: agenda evaluación.
- `POST /api/lora/trainings/[id]/discard`: impide promoción sin borrar historial.

### Slots y compatibilidad

- `PATCH /api/lora/modes/[slug]`: asigna corrida/escala o desactiva.
- `POST /api/lora/modes/[slug]/rollback`: restaura asignación anterior.
- `POST /api/lora/compatibility`: valida plan y devuelve candidatos.

Errores usarán `{ code, message, details, retryable }`; nunca depender de comparar textos humanos.

## 13. Módulos de aplicación

Crear:

- `src/lib/lora/schema.ts`: esquemas Zod y estados.
- `src/lib/lora/repository.ts`: consultas PostgreSQL.
- `src/lib/lora/artifact-store.ts`: interfaz de almacenamiento.
- `src/lib/lora/artifact-store-local.ts`: driver para desarrollo.
- `src/lib/lora/dataset-builder.ts`: selección, auditoría, ZIP y manifiesto.
- `src/lib/lora/statistics.ts`: agregados genéricos por dataset.
- `src/lib/lora/fal-trainer.ts`: subida, envío, sync y recepción.
- `src/lib/lora/mode-resolver.ts`: resolución segura del slot.
- `src/lib/lora/compatibility.ts`: allowlist y candidatos.
- `src/lib/lora/evaluation.ts`: protocolo y persistencia.
- `src/components/lora/*`: dashboard, wizard, detalle, composición y reemplazos.
- `scripts/lora-worker.ts`: procesa jobs recuperables.
- `scripts/backfill-lora-registry.ts`: importación idempotente de historia actual.

Modificar:

- `src/app/configuracion-lora/page.tsx`.
- `src/app/page.tsx`.
- `src/app/api/generate/route.ts`.
- `src/lib/ia/sempertex-lora.ts`.
- `src/app/api/lora/dataset/[archivo]/route.ts` para resolver imágenes por dataset/ID sin paths libres.
- `scripts/exportar-dataset-fal.ts`, `scripts/analizar-composicion-lora.ts`, `scripts/entrenar-lora-v004.ts`, `scripts/recibir-lora.ts`, `scripts/eval-lora-nuevo.ts` y `scripts/promover-lora.ts` para convertirse en wrappers de módulos compartidos o quedar deprecados tras paridad.
- `package.json` con worker, backfill y pruebas LoRA.

Antes de tocar rutas o componentes, leer documentación local de Next 16:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`

## 14. Backfill inicial

`scripts/backfill-lora-registry.ts` será idempotente y ejecutará:

1. Importar v004 desde `lora-v004-composicion.json`, `PROCEDENCIA-v004-1000.json`, manifiesto de exportación y carpetas recaptionadas.
2. Crear dataset v004 con 154 imágenes y sus asociaciones actuales.
3. Crear corrida v004-1000 con parámetros, costo, rank, URL, hash y evaluación conocida.
4. Asignar v004 a `Unlimited` inicialmente.
5. Asignar v004 a `Training 1` solo cuando su cobertura canónica se marque completa.
6. Importar v005 de 300 imágenes como dataset preparado, sin inventar una corrida todavía.
7. Marcar como `pending` las imágenes v005 sin elementos verificables.
8. Dejar `Training 2` vacío hasta completar revisión, entrenamiento, respaldo y evaluación.
9. Comparar conteos importados con archivos originales; abortar si no coinciden.

Los JSON históricos se conservan como evidencia y fallback durante una versión; después dejan de ser fuente principal de UI.

## 15. Estadísticas

### Dataset

- imágenes y captions;
- imágenes únicas;
- palabras mínimas, mediana y máximas;
- resolución y orientación;
- fuente, rol y tema;
- cobertura revisada/pendiente;
- estructuras y porcentaje por imágenes;
- elementos Shopify consolidados y porcentaje;
- objetos del entorno y relaciones espaciales;
- imágenes sin elemento confirmado;
- gaps de composición.

### Corrida

- dataset y hash;
- pasos, learning rate y pasadas estimadas;
- costo estimado y real;
- duración en cola y entrenamiento;
- tamaño/rank/hash de pesos;
- resultados de evaluación por escala;
- estado de respaldo;
- slots actuales e historial.

### Comparación

- Training 1 contra Training 2;
- imágenes, pasos, costo y evaluación;
- elementos comunes, agregados y perdidos;
- diferencias de representación;
- cobertura del catálogo solicitado por planes recientes, cuando exista telemetría suficiente.

## 16. Seguridad y fiabilidad

- `FAL_KEY` nunca llega al cliente.
- Rutas pagadas verifican sesión en servidor, además de protección global de `src/proxy.ts`.
- Validar `Origin` en mutaciones.
- Idempotency key única por corrida y acción pagada.
- No aceptar paths de filesystem ni URLs de modelo desde el navegador.
- Descargas limitadas por tamaño, timeout y tipo.
- Artefactos escritos primero a temporal y publicados mediante rename/move seguro.
- Logs y snapshots sanitizados: no claves ni headers Authorization.
- Auditoría append-only para activaciones/reversiones.
- Promoción exige evaluación aprobada y respaldo verificado.
- Rate limit básico para start/sync/evaluate.
- El worker recupera jobs con lock vencido; no procesa dos veces una corrida.
- Retención definida: historial y manifiestos permanentes; temporales fallidos limpiables; pesos nunca se borran desde la primera versión de UI.

## 17. Pruebas

### Unitarias

- normalización de identidades Shopify;
- cálculo de representación sobre imágenes únicas;
- extracción de estructuras controladas;
- manifiesto y hashes;
- máquina de estados;
- costo/pasadas estimadas;
- resolución de slots;
- compatibilidad de plan;
- ranking de reemplazos filtrados;
- idempotencia.

### Integración PostgreSQL

- migración 015 desde DB limpia y DB existente;
- creación de dataset/export/corrida;
- transiciones válidas e inválidas;
- concurrencia en inicio pagado;
- historial de slots y rollback;
- backfill ejecutado dos veces sin duplicar.

### Contrato API

- `409 LORA_UNSUPPORTED_ELEMENTS` estable;
- slot vacío/deshabilitado;
- dataset parcial;
- corrida no aprobada;
- fallos y reintentos de fal.ai con mocks;
- sesión/origen/idempotencia.

### E2E

1. Crear exportación de prueba pequeña.
2. Ver estadísticas y fotos asociadas.
3. Crear corrida mock y recorrer estados.
4. Evaluar y asignar a Training 1.
5. Seleccionar Training 1 en asistente.
6. Generar con elementos permitidos.
7. Pedir elemento no permitido.
8. Ver panel de reemplazo, elegir candidato, recalcular/aprobar plan y generar.
9. Confirmar que Unlimited no bloquea el mismo elemento.
10. Revertir slot y confirmar modelo anterior.

### Regresión

- estructuras siguen desplegando fotos;
- todos los Shopify aparecen consolidados;
- no existen secciones `Colores` ni `Acabados`;
- modos Gemini y comparaciones actuales siguen funcionando;
- compilador LoRA, QA, plan, cotización y referencias no cambian semántica;
- `npm run lint`, `npx tsc --noEmit`, suites LoRA/plan/IA y `npm run build`.

### Browser

Validar `/configuracion-lora` y `/` en escritorio y móvil:

- navegación por teclado;
- foco en wizard/modal;
- estados largos y listas de cientos de elementos;
- progreso recuperado tras recarga;
- bloqueo previo a costo;
- reemplazos sin selección automática;
- selector con Unlimited, LoRA Training 1 y LoRA Training 2.

## 18. Fases de implementación

### Fase 0: contratos y preflight

- Leer docs Next 16 indicadas.
- Congelar tipos, estados y esquema de manifiesto.
- Crear fixtures v004/v005 y snapshot esperado.
- Definir almacenamiento local y variables nuevas.

Criterio de salida: contratos revisados y fixtures reproducibles; cero cambios de comportamiento público.

### Fase 1: registro y artefactos

- Migración 015.
- Repository y artifact store.
- Manifiesto genérico y estadísticas.
- Backfill v004/v005.
- Pruebas DB e idempotencia.

Criterio de salida: datos actuales consultables desde DB con conteos iguales a archivos históricos.

### Fase 2: lectura UI

- Refactor de `/configuracion-lora` para leer registry.
- Lista de datasets/corridas y detalle.
- Composición por dataset preservando estructuras/fotos y Shopify completo.
- Estados vacío/error/cobertura parcial.

Criterio de salida: paridad visual y numérica con pantalla actual, más historial.

### Fase 3: exportación desde UI

- Preview, auditoría, revisión y export job.
- ZIP/manifiesto/hashes.
- Recuperación tras error y recarga.
- Wrappers CLI sobre misma lógica.

Criterio de salida: exportación UI y CLI producen mismo manifiesto/hash para fixture idéntico.

### Fase 4: entrenamiento desde UI

- Formulario y estimación.
- Confirmación pagada e idempotencia.
- Adaptador fal.ai y sync asincrónico.
- Recepción/respaldo.
- Timeline y errores.

Criterio de salida: corrida mock completa; corrida real solo tras confirmación manual explícita.

### Fase 5: evaluación, slots y rollback

- Evaluación versionada.
- Gate 5/6.
- Slots, historial y reversión.
- Quitar promoción basada en edición de `.env.local`.

Criterio de salida: ninguna corrida no aprobada puede asignarse; rollback restaura configuración previa.

### Fase 6: modos del asistente

- Nuevo selector y contrato.
- Resolver configuración por slot.
- Adaptar `sempertex-lora.ts`.
- Compatibilidad server-side antes de llamada pagada.
- Telemetría con mode/run/dataset IDs.

Criterio de salida: cada modo usa corrida correcta; Unlimited permite catálogo completo; Training 1/2 bloquean fuera de cobertura.

### Fase 7: reemplazos elegidos

- API de candidatos filtrados.
- UI de incompatibilidades.
- Integración con edición, recálculo y nueva aprobación del plan.
- Revalidación final.

Criterio de salida: usuario siempre elige; jamás existe sustitución silenciosa ni generación con plan incompatible.

### Fase 8: endurecimiento y despliegue

- Seguridad, rate limits, locks y recuperación.
- E2E, responsive, accesibilidad y regresión.
- Documentación operativa y runbook de recuperación.
- Retirar fallback JSON/env solo después de una versión estable.

Criterio de salida: build y suites verdes, prueba real controlada, artefactos respaldados y rollback probado.

## 19. Orden recomendado de entregas

1. Registro + backfill + pantalla de lectura.
2. Exportación UI reproducible.
3. Entrenamiento y recepción.
4. Evaluación y slots.
5. Selector de modos.
6. Restricciones y reemplazos.
7. Comparativas y estadísticas avanzadas.

Esto evita conectar generación pagada a un registro todavía inmaduro.

## 20. Definición de terminado

- Cada exportación produce ZIP, manifiesto, hashes, imágenes, procedencia, elementos y estadísticas inmutables.
- Cada corrida registra dataset, pasos, imágenes, learning rate, costo, provider request, pesos, evaluación y estado.
- `/configuracion-lora` controla ciclo completo sin scripts obligatorios.
- Estructuras conservan fotos asociadas.
- Shopify conserva todos los elementos consolidados y ordenados por representación confirmada.
- `Colores` y `Acabados` no aparecen.
- Selector ofrece Unlimited, LoRA Training 1 y LoRA Training 2.
- Slots limitados bloquean antes del costo cuando hay elementos no entrenados.
- Usuario elige cada reemplazo; plan y cotización se recalculan y reaprueban.
- Unlimited permite cualquier elemento válido del catálogo.
- Cambio de slot y rollback quedan auditados.
- Ninguna clave sale al cliente y ningún LoRA depende únicamente de una URL externa.
- Lint, TypeScript, pruebas, build y validación browser pasan.


# Plan: estructuras en referencias, UX limpia y errores humanos

Checklist viva del loop de mejoras. Cada vuelta toma el primer ítem `pendiente` cuyo requisito previo esté `hecho`, lo completa (investigar, implementar, probar, verificar en vivo) y anota aquí los comandos ejecutados y sus resultados reales.

Estados: `pendiente`, `en curso`, `hecho`, `BLOQUEADO` (con opciones), `en espera` (depende de trabajo ajeno en curso).

Entorno: Next en http://127.0.0.1:3100 (el 3000 es otro proyecto), FastAPI en http://127.0.0.1:8000, PostgreSQL local `demo-decoracion-postgres-1`. Secretos: `. "$env:TEMP\demo-cutover-local\env-local.ps1"` en el mismo comando. Nunca usar `.env.local` (su `DATABASE_URL` es remoto).

> Nota de origen: el prompt que creó esta checklist llegó pegado con cortes. Los textos de D1, D2 y el encabezado del frente B se reconstruyeron a partir del objetivo general y del contexto que sí llegó completo; conviene revisarlos.

## Coordinación con otros agentes

Protocolo (pedido del usuario, 2026-09-14): el loop no se detiene por un choque. Antes de editar un archivo se comprueba su hora de modificación; si otro agente lo tocó en los últimos ~15 minutos, no se edita. En su lugar se detalla el plan del ítem, se explora el proyecto y se avanza con ítems que no toquen esos archivos. Cuando los archivos llevan un rato sin cambios, se retoma el ítem en espera.

- 2026-09-14 14:42–14:56: otro agente introduce "estructuras oficiales": `src/lib/plan/estructuras-oficiales.ts` (nuevo, con `identificarEstructuraOficial` y `UBICACION_PARA_CLIENTE`), `src/components/plan/IconoEstructura.tsx` (nuevo), `plan/tipos.ts`, `ia/herramientas.ts`, `ia/prompt-sistema.ts` (`GUIA_ESTRUCTURAS_OFICIALES`) y `TarjetaPlanDecoracion.tsx`. Los cambios del loop en esos archivos (descripción de `mezcla`, reglas de jerga y globos, prop `modoDev`) siguen presentes. C2 sobre la tarjeta del plan debe esperar a que ese trabajo se asiente.
- 2026-09-14 13:48–13:50: otro agente trabaja en el reconocimiento de referencias: `src/lib/ia/reference-structure.ts` (nuevo; detección tipada de estructuras: arco, semiarco, columna, guirnalda, pared… con posición, altura y simetría), `analizar-referencias-v2.ts`, `prompt-sistema.ts`, `lora-prompt-preflight.ts` (variante JSON) y el compilador LoRA. Solapa con D1–D4: al llegar al frente D hay que revisar y medir ese trabajo en vez de duplicarlo.
- 2026-09-14 13:14–13:35: hay actividad ajena de nuevo en `src/app/page.tsx` y `src/lib/ia/lora-caption-compiler.ts` (añade un `dialect` al render del caption; a las 13:35 `npx tsc --noEmit` fallaba en ese archivo por esa edición en curso, no por el loop). A4 no toca esos archivos.
- 2026-09-14 12:03–12:10: otro agente editaba `src/lib/ia/lora-prompt-preflight.ts`, `lora-caption-compiler.ts`, `lora-product-runtime.ts`, `src/lib/lora/product-vocabulary*.ts` y `scripts/tmp-repro-xv*.ts` (trabajo sobre `LORA_PREFLIGHT_FAILED`, codificación rota y el caso XV años). Mientras sigan cambiando esos archivos, A2 queda `en espera` y ningún ítem del loop los edita.

## A. Errores técnicos que llegan al cliente (prioridad 1)

### A1. Inventario de rutas de error — `hecho` (2026-09-14)

**Cómo llega un error a la pantalla.** Hay dos banners de texto libre en `src/app/page.tsx` (`{error}` en la línea 1694 y `{errorAdjuntos}` en la 1700). Todo lo que devuelve el servidor en el campo `error` se pinta tal cual:

| Origen en la UI | Línea | Fuente del texto |
| --- | --- | --- |
| Chat (SSE) | `page.tsx:941` | `datos.error` del evento `error` de `/api/chat` |
| Chat (JSON previo al stream) | `page.tsx:951` | `data.error` de `/api/chat` |
| Generación | `page.tsx:1165` | `data.error` de `/api/generate` (cualquier `throw new Error` del handler) |
| Generación (excepción) | `page.tsx:1226` | `reason.message` del cliente |
| Catálogo | `page.tsx:812` | `data.error` |
| Editar plan, cambiar o quitar pieza, recomendaciones | `TarjetaPlanDecoracion.tsx:226, 288, 354, 371, 391, 416, 439` | `datos.error` de `/api/plan-editar` y `/api/lora/training-references` |
| Análisis de referencias | `ReferenceAnalysisController.tsx:63` | `reason.message` a partir de `/api/references/analyze` |

**Además, sin ser un error:** `page.tsx:1180` abre `PromptModal` automáticamente después de cada generación (el cliente ve el prompt técnico en inglés), y `GenerationQaSummary` (`page.tsx:2185`) muestra el QA detallado. Ambos van a B2.

**`/api/generate` (`src/app/api/generate/route.ts`).** El `catch` final (línea 1229) devuelve `error.message` de cualquier `Error`. Mensajes técnicos que hoy pueden llegar al cliente:

| Código o texto | Línea | Causa | Traducción propuesta (A3) |
| --- | --- | --- | --- |
| `LORA_PREFLIGHT_FAILED: cobertura de colores N/M; longitud N supera límite 750` | 1179 (errores de `lora-prompt-preflight.ts:161, 187`) | El compilador de captions produce un prompt que no representa todos los colores o se pasa de 750 caracteres | Arreglar en A2. Residual: "No pudimos preparar la imagen con este estilo." [Reintentar] [Generar con estilo estándar] |
| `LORA_LANGUAGE_FAILED` | 1176 | Quedó texto en español dentro del prompt LoRA | Igual que el anterior |
| `LORA_PRODUCT_VOCABULARY_FAILED: … product_id …` | 1158 | Producto sin identidad canónica en el vocabulario LoRA; filtra IDs de producto | "Uno de los productos aún no se puede dibujar con este estilo." [Generar con estilo estándar] |
| `LORA_MODE_REQUIRED`, `LORA_MODE_INVALID`, `LORA_SELECTION_INVALID`, `LORA_MODE_SELECTION_CONFLICT` | 28, 774, 777, 778, 1031 | Fallo de configuración del cliente web o del registro LoRA | Error interno: "No pudimos preparar la imagen." [Reintentar] |
| `LORA_DATASET_ALLOWLIST_REJECTED: <variant_ids>` | 800 | Variantes fuera del pool entrenado; filtra IDs | "Algunos productos no están disponibles con este estilo." [Generar con estilo estándar] |
| `APROBACION_REQUERIDA: …` | 708, 827, 875 | Se generó sin `approval_token` válido | "Primero aprueba la propuesta." [Ver propuesta] |
| `IMAGE_QA_REQUIRED: …` | 1100 | Plan aprobado sin QA visual activado | "Activa la validación visual…" hoy también en `page.tsx:1242`. Decidir en A3/B2 si el QA se activa siempre |
| `PRESUPUESTO_EXCEDIDO: N COP supera el techo…` | 872 | Plan por encima del techo | "La propuesta supera tu presupuesto por $N." [Ajustar propuesta] |
| `Plan hash does not match the validated server plan.` (inglés) | 868, 869 | Plan del navegador distinto del validado | "La propuesta cambió. Vuelve a aprobarla." [Actualizar propuesta] |
| `Scene specification hash does not match…`, `Submitted scene specification does not match…`, `Approve at least one element before generating.` (inglés) | 1015, 1018, 1048 | Desincronización de escena | Igual que el anterior |
| `El prompt no coincide con el plan resuelto: …` | 1095 | Coherencia prompt/plan | Error interno con [Reintentar] |
| `El plan tiene materiales sin cobertura…`, `La estimación de materiales no es válida: …`, `…no es compatible con la escala…` | 870, 898, 900, 968, 970 | Plan inconsistente que llegó hasta la generación | "Hay que ajustar la propuesta antes de generar." [Pedir ajuste] |
| `NON_CONFORME: … — <retry_reasons>` (422, con `qa`) | 1196, 1204 | QA visual rechazó la imagen; filtra `EST_02_COLUMNAS#2`, `placement failure` | "La imagen no quedó fiel a la propuesta." [Reintentar] |
| `PYTHON_NO_SELECCIONADO`, `SIN_SNAPSHOT_CATALOGO` (`PlanBackendNoDisponibleError`) | 712, 715, 834, 837 | Backend del plan cambió | Mensaje ya humano; falta acción [Pedir propuesta de nuevo] |
| `pythonErrorBody(error)` (`isPythonAdapterError`) | 1221 | FastAPI caído o respuesta inválida | "El servicio no respondió." [Reintentar] |
| Validación de imágenes (`… no es una imagen válida`, `…supera el tamaño…`) | 121–151, 689 | Adjuntos inválidos | Ya humanas; conservar |
| `LoRA Sempertex genera desde texto. Para editar fotos… cambia a Gemini.` | 1034 | Nombres de proveedor/modelo | "Este estilo no admite editar fotos." [Generar con estilo estándar] |

**`/api/chat` (`src/app/api/chat/route.ts`).** Ya tiene sobre versionado (`ErrorEnvelopeV1`, `ChatErrorEventV1` en `src/lib/ia/contracts/chat-v1.ts:146-185`) con `code`, `retryable` y `request_id`, pero:

- `datosDeError` (líneas 91 y 99) devuelve "El catálogo RAG no está disponible…" y "No se pudo conectar al catálogo RAG (PostgreSQL). Verifica DATABASE_URL…". Jerga y configuración interna.
- `ErrorIA` "El proveedor de IA no está configurado en el servidor." (80). Aceptable para cliente, pero sin acción.
- La UI ignora `code`, `retryable` y `request_id`; solo pinta `error`.

**`/api/plan-editar` (`src/app/api/plan-editar/route.ts`).** Mensajes de `PlanEditError` en español y mayormente humanos. Filtraciones: `LORA_DATASET_ALLOWLIST_REJECTED: <variant_id>` (515 y 558), `detalles: error.issues` de Zod (554), `pythonErrorBody` (560) y `PythonPlanMappingError.message` (562).

**`/api/references/analyze` (`src/app/api/references/analyze/route.ts`).** Validaciones en inglés ("Attach between one and three reference images.", "Reference payload is too large.") y `error.message` crudo de cualquier excepción (línea 56).

**Herramientas del chat (`src/lib/ia/registro-herramientas.ts`).** El modelo recibe `status` y `accion_requerida` y los parafrasea al cliente. Todos están escritos como instrucciones de programador y citan identificadores:

| `status` | Línea | Texto que puede filtrarse |
| --- | --- | --- |
| `RESTRICCIONES_INCONSISTENTES` | 690–698 | "cardinalidad", "Evento abierto requiere 3–5 estructuras…" |
| `COBERTURA_REFERENCIA_INCOMPLETA` | 716–724 | `referencia_element_id`, `referencia_omitida` |
| `BACKEND_NO_DISPONIBLE` | 768–772 | `PYTHON_INVALID_REQUEST: invalid_request` |
| `PRODUCTO_VARIANTE_INCONSISTENTE` | 817–824 | `variant_id`, `product_id`, `variant_override`, `buscar_catalogo_rag` |
| `ESTIMACION_INCONSISTENTE` | 860–862 | "estimated material quantity appears too low for high density over 10.38 m" (inglés) |
| `SIN_COBERTURA` | 872–875 | `EST_01_ARCO:R-5 \| EST_01_ARCO:R-24` |
| `PRESUPUESTO_EXCEDIDO` | 885–890 | techo y delta en COP |

**Frecuencia real (base local, `plan_audit_log`, 2026-08-23 a 2026-09-14).** Comando: `docker exec demo-decoracion-postgres-1 psql -U demo -d demo_rag -c "select status, left(coalesce(error,''),160), count(*) from plan_audit_log group by 1,2 order by 3 desc"`.

| Estado | Casos | Error más común |
| --- | --- | --- |
| `CLIENT_APPROVED` | 145 | — |
| `APROBACION_REQUERIDA` | 97 | — |
| `RESTRICCIONES_INCONSISTENTES` | 66 | "Evento abierto requiere 3–5 estructuras coordinadas…" (41); "Se solicitaron 1 arco(s) y el plan declara 0." (11); colores o acabados faltantes (14) |
| `SIN_COBERTURA` | ≥ 60 | `EST_01_ARCO:R-12`, `R-24`, `R-5` (tamaños de globo sin producto) |
| `IMAGEN_QA` con error | 7 | `placement failure EST_02_COLUMNAS#2` (5), elementos faltantes (2) |
| `ESTIMACION_INCONSISTENTE` | 4 | "…too low for high density over 5.20 m (1 installed balloons)" |
| `IMAGEN_QA_RETRY` | 3 | — |
| `BACKEND_NO_DISPONIBLE` | 2 | `PYTHON_INVALID_REQUEST: invalid_request` |

`rag_query_log` (304 filas): 171 `OK`, 133 `NO_MATCH`, sin errores. `ai_call_log`: 24 errores de `embedding_consulta` frente a 11 correctos, 1 timeout de `imagen_generacion` y 1 chat cancelado. No existe tabla `generation_log`; los fallos de `/api/generate` previos a la llamada al proveedor (como `LORA_PREFLIGHT_FAILED`) **no se registran en ninguna tabla**, así que su frecuencia no se puede medir hoy. A3 debe registrar `code` y `request_id` para que sí se pueda.

**Conclusiones para los siguientes ítems.**
1. El problema de fondo es estructural: la UI pinta `error` como texto libre y los handlers usan `throw new Error("CODIGO: detalle")`. A3 necesita un único dueño que asigne código estable, mensaje de cliente y acción, y la UI debe dejar de pintar `error` crudo.
2. `SIN_COBERTURA` y `RESTRICCIONES_INCONSISTENTES` son los rechazos de herramienta más frecuentes (más de 120 casos) y sus textos son los que el modelo repite. A4 empieza por ahí.
3. "Se solicitaron 1 arco(s) y el plan declara 0." (11 casos) es la misma familia de A5 (propuesta sin la estructura pedida).

### A2. Causa raíz del preflight LoRA — `hecho` (2026-09-14, vuelta 4)

El compilador debe producir un prompt que pase siempre (todos los colores representados y dentro del límite, con compactación determinista que no pierda estructuras, ubicaciones ni relaciones). Si hay un fallo residual, reintentar la compilación una vez con la variante compacta. Nunca generar con un prompt que no pasó. Un test por cada escena real que haya fallado.

**Punto de partida.** El agente concurrente dejó `lora-caption-v2.4-compact-budget`: 7 pasos de compactación deterministas que no quitan estructuras ni colores, el presupuesto descuenta el trigger real y hay una regresión del caso XV años ("cobertura de colores 2/3; longitud 845 supera límite 750") en `test-lora-product-runtime.ts` §14. `ia:test-lora-compiler` y `lora:test-product-runtime` (41 aserciones) pasaban.

**Medición nueva: barrido combinatorio** `scripts/test-lora-preflight-barrido.ts` (`npm run ia:test-lora-preflight-barrido`). Recorre 4 focales × 4 grupos de soportes × 4 grupos de acentos × 6 paletas (1 a 4 colores) × 5 eventos × 2 triggers (`eventdecor_style_v2` y uno largo), con productos reales del vocabulario v007 y tamaños confirmados en el peor caso realista. Cada escena pasa por `compileProductPrompt` → `ensureLoraTriggers` → `preflightLoraPrompt`, igual que `/api/generate`.

| Versión | Escenas | Fallos | Longitud máxima |
| --- | --- | --- | --- |
| v2.4 (antes) | 1920 | **68 (3,5 %)**, todos "longitud N supera límite 750" | 837 |
| v2.5 (después) | 3840 | **0** | 750 |

**Cambios:**

1. `lora-caption-compiler.ts` → `lora-caption-v2.5-compact-budget`: dos pasos finales, que solo se aplican si nada anterior cabe. Paso 7: quitar las pistas de entorno de la cola (la decoración aprobada pesa más que la descripción del salón). Paso 8: etiquetas de producto "objeto + color" sin acabado ni patrón. Ambos conservan estructuras, ubicaciones, relaciones y colores; el preflight lo comprueba en cada escena del barrido.
2. **Fallo real encontrado en vivo** (gratis, antes del proveedor): una selección suelta sin plan con LoRA daba `LORA_PREFLIGHT_FAILED: 3 tipo(s) sin visual_semantics del plan, inferido(s) por nombre (balloon decoration kit…)`. No es de longitud, y ni compactar ni reintentar lo arregla: el LoRA exige las semánticas canónicas de un plan (regla intencional, fail-closed). `preflightLoraPrompt` expone ahora `requiresPlanSemantics` (solo sin `plan_hash`; con plan es un defecto de mapeo). La ruta lanza `LORA_PLAN_REQUIRED` y `ui-error.v1` suma `ESTILO_REQUIERE_PROPUESTA`: "Este estilo necesita una propuesta de decoración aprobada…", con [Generar con estilo estándar] y [Pedir propuesta] (deja "Arma una propuesta de decoración con las piezas que elegí." en el campo) y sin Reintentar. El código nuevo entra en `ui-error.v1` sin subir versión porque el contrato se creó hoy y aún no tiene consumidores externos.
3. **Segunda causa raíz encontrada en la generación real con plan:** el modelo declara "dos columnas a los lados" como UNA estructura `lateral_izquierdo` con `repeticiones: 2`. `cajasDeEstructuras` ponía las dos instancias en la caja izquierda y `planBlueprint` les daba `placement: lateral_izquierdo` a ambas. El caption decía "two balloon columns … standing on the left side" (relaciones 0/0) y el QA marcaba `placement failure EST_02_COLUMNAS#2`, el fallo de QA más frecuente de A1 (5 casos). Regla nueva con dueño único en `src/lib/plan/ubicaciones.ts` (`esParLateral`, `ubicacionDeInstancia`): una estructura lateral con exactamente 2 repeticiones es un par simétrico, #1 a la izquierda y #2 a la derecha en espejo (redondeado a 6 decimales porque la geometría entra en el `plan_hash` de Next). `planBlueprint` usa `ubicacionDeInstancia`. El `plan_hash` de Python no incluye geometría y no cambia; el de Next cambia solo para planes con ese patrón.
4. "Nunca generar con un prompt que no pasó": la ruta lanza antes de `generarConSempertexLora`. **Riesgo residual:** con `SEMPERTEX_LORA_EDIT=true` (hoy no está definido; apagado por defecto) `promptConReferencias` añade una guía de imágenes **después** del preflight, que ya no valida ese texto.

**Pruebas añadidas o ampliadas:** barrido (3840 escenas y el caso sin plan: `requiresPlanSemantics` sin `plan_hash` sí, con `plan_hash` no); `test-plan-lora-e2e.ts` con el par de columnas (cajas simétricas, igual declarando cualquier lateral, caption bilateral, preflight 1/1); `test-ui-error-contract.ts` con `LORA_PLAN_REQUIRED` y los 23 prefijos `LORA_*` que existen en `src/` (todos `ESTILO_NO_PREPARADO` salvo los dos de producto). Mientras tanto se detectaron `LORA_MODE_NOT_READY`, `LORA_MODE_DISABLED`, etc., que antes caían en `ERROR_INTERNO`: la regla quedó en "cualquier `LORA_*` no listado es de estilo".

| Comando | Resultado |
| --- | --- |
| `npm run ia:test-lora-preflight-barrido` | 3840 escenas, 0 fallos, máx. 750/750 |
| `npm run ia:test-plan-lora-e2e` | 2 PASS (incluye el par lateral) |
| `npm run plan:test` (16 scripts), `plan:test-paridad-python`, `contracts:test:domain`, `contracts:check` | exit 0 |
| `npm run ia:test-lora-compiler`, `lora:test-product-runtime` (41), `contracts:test:ui-error` (8), `rag:test-generation-resolver`, `ia:test-prompts` | exit 0 |
| `npx tsc --noEmit`, `npx eslint` de los archivos tocados | exit 0 |

**Verificación en vivo** (http://127.0.0.1:3100, scripts en `scratchpad/`):

| Caso | Costo | Resultado |
| --- | --- | --- |
| LoRA sin plan (3 globos R-12 de `training_1`) | gratis | 400 `ESTILO_REQUIERE_PROPUESTA`, origen `LORA_PLAN_REQUIRED` |
| Plan del estado del smoke con LoRA | gratis | 409 `ESTILO_SIN_PRODUCTOS` (una variante fuera de `training_1`; ese plan se creó sin LoRA) |
| Chat real con `loraMode: training_1` ("arco orgánico de 3 m blanco y dorado y dos columnas a los lados, XV años") → plan `VERIFICADO` → LoRA + QA | 1 turno de chat (5 llamadas de herramienta, 3 de ellas `confirmar_plan_decoracion`), 1 imagen fal.ai, 1 QA | 200, compilador v2.5, preflight OK (748 caracteres, estructuras 3/3, colores 2/2), **relaciones 0/0, QA `pass: false`** y caption "on the left side" → causa 3 |
| Mismo plan tras el arreglo del par | 1 imagen fal.ai, 1 QA | 200, preflight OK (610 caracteres, relaciones **1/1**), caption "one standing on the left and one on the right, flanking the main arch", **QA `pass: true`**, `plan_hash` igual. Imagen simétrica en `scratchpad/a2/plan-lora-par.png` |

**Pendiente derivado (B2):** en modo usuario, LoRA sin plan aprobado no puede funcionar. Hay que decidir si esas generaciones usan el estilo estándar desde el inicio (regla de capacidad, no fallback tras un fallo) o si el cliente siempre ve el aviso con la acción explícita. Queda anotado junto al bloqueo de LoRA de B2.

### A3. Contrato de errores para la UI — `hecho` (2026-09-14, vueltas 2 y 3)

Cada ruta devuelve `{ code estable, mensaje_usuario en español claro, accion_sugerida, detalles_dev }`. El modo usuario muestra mensaje y acción, por ejemplo "No pudimos preparar la imagen con este estilo. [Reintentar] [Generar con estilo estándar]". Generar con estilo estándar es una acción explícita del cliente, no un fallback automático. El modo dev muestra además `detalles_dev` y `request_id`. Contrato versionado y probado. Registrar `code` y `request_id` de los fallos de generación.

**Hecho (2026-09-14, vuelta 2):**

- Contrato `ui-error.v1` en `src/lib/ia/contracts/ui-error-v1.ts`: 19 códigos estables, 7 acciones, esquema Zod estricto y catálogo de mensajes. Es el único dueño del texto de cliente. Traduce también los 16 códigos `error.v1` del chat (`uiErrorDesdeChatV1`).
- Traductor de servidor `src/lib/errores-ui/traducir-error-servidor.ts`: clasifica por clase (`ErrorIA`, `PlanEditError`, `PlanBackendNoDisponibleError`, `AllowlistProductoVarianteError`, `NonCommercialSourceRejectedError`, `PythonAdapterError`, `ZodError`) y, como adaptador temporal documentado, por prefijo `CODIGO:` o inicio de mensaje. Lo desconocido cae en `ERROR_INTERNO` con el mensaje original en `detalles_dev`. `registrarFalloUi` deja una línea `[ui-error]` con `superficie`, `code`, `codigo_origen` y `request_id`, sin conversación ni imágenes.
- Rutas: `/api/plan-editar` y `/api/references/analyze` añaden `ui_error` y conservan los campos legacy (`error`, `causa`, sobre `operational.v1`), porque el smoke y las pruebas los comparan. `/api/chat` ya no dice "catálogo RAG (PostgreSQL). Verifica DATABASE_URL"; el diagnóstico pasa al log del servidor con `request_id`.
- UI: componente `src/components/errores/AvisoError.tsx` (`role="alert"`, botones de acción, cerrar accesible, detalles técnicos plegados). `page.tsx` guarda `{ ui, origen }` en vez de texto. Las acciones Reintentar (chat y generación, sin duplicar el mensaje), Generar con estilo estándar (`estiloEstandar` en el override, solo por clic), Ver propuesta, Pedir propuesta de nuevo, Ajustar propuesta (deja el texto en el campo, no lo envía), Activar revisión de calidad y Revisar imágenes funcionan. `TarjetaPlanDecoracion.tsx` y `ReferenceAnalysisController.tsx` muestran `mensaje_usuario`; este último valida además el blueprint con `ReferenceBlueprintV2Schema`.
- Los detalles dev se muestran fuera de producción (`DETALLES_DEV_PROVISIONAL`) hasta que B1 los ate al switch.

**Evidencia:**

| Comando | Resultado |
| --- | --- |
| `npm run contracts:test:ui-error` (nuevo) | 7 casos OK: catálogo sin jerga, sobre estricto y versionado, 30 mensajes reales de generación clasificados, clases tipadas, prioridad del prefijo sobre `PlanEditError` |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` sobre los 10 archivos tocados | 0 errores, 1 aviso preexistente (`TarjetaPlanDecoracion.tsx`, `react-hooks/exhaustive-deps`) |
| `npm run contracts:check`, `contracts:test`, `plan:test-contexto`, `chat:test-historial` | OK |
| `npm run plan:test-editar-python` | Falló al principio: comparaba el cuerpo completo y ahora existe `ui_error`. Se actualizó para comparar exactos los campos legacy y validar `ui_error` con el esquema. OK |
| Verificación en vivo (script fuera del repo, `scratchpad/verificar-a3.cjs`, contra http://127.0.0.1:3100, sin llamadas pagadas) | 12 PASS, 0 FAIL. `analyze` sin imágenes → 400 `ADJUNTO_INVALIDO`; `plan-editar` inválido → 400 `SOLICITUD_INVALIDA`; token manipulado → 409 `PROPUESTA_DESACTUALIZADA`. En navegador, con un SSE de error `RAG_UNAVAILABLE` simulado: aviso "El servicio no respondió…", sin jerga fuera de detalles, Reintentar hace una sola llamada nueva sin duplicar el mensaje, se cierra con teclado y no hay errores de runtime |

**Vuelta 3, `/api/generate`** (el agente concurrente terminó: borró sus scripts `tmp-*` y el archivo llevaba 12 minutos sin cambios). Sin tocar los `throw`: el `catch` final añade `ui_error` a cada respuesta y registra `[ui-error]`; los dos 422 `NON_CONFORME` pasan por `respuestaNoConforme` (`IMAGEN_NO_FIEL`, con `qa` y plan en el cuerpo); el 413 devuelve `ADJUNTO_INVALIDO`. Se clasificaron tres validaciones más (`imageQaRequested debe ser booleano`, `catalogSnapshotId must not be blank`, id en `productIds` y `ragVariantIds` a la vez → `SOLICITUD_INVALIDA`).

| Comando | Resultado |
| --- | --- |
| `npx tsc --noEmit`, `npx eslint` de los archivos tocados, `git diff --check` | exit 0 |
| `npm run contracts:test:ui-error` | 7 casos OK (33 mensajes reales) |
| `npm run plan:test` (16 scripts) | Primero falló `rag:test-allowlist`, que comparaba exacto el cuerpo de `/api/plan-editar`. Se actualizó igual que `plan:test-editar-python` (legacy exacto y `ui_error` validado con el esquema). Después, exit 0 |
| `scratchpad/verificar-a3-generate.cjs` contra http://127.0.0.1:3100 (sin llamadas pagadas: todo falla antes del proveedor) | 14 PASS, 0 FAIL. `imageQaRequested` inválido → 400 `SOLICITUD_INVALIDA`; foto vacía → 400 `ADJUNTO_INVALIDO`; variante inexistente → `PROPUESTA_DESACTUALIZADA`, con el texto legacy intacto; `usarLora` sin `loraMode` → 409 `ESTILO_NO_PREPARADO` con legacy `LORA_MODE_REQUIRED:` (el smoke no cambia) y `request_id`. En navegador, con chat y generación simulados: aviso "No pudimos preparar la imagen con este estilo." con Reintentar y Generar con estilo estándar, sin "cobertura", "límite" ni `LORA_`; el primer intento pidió LoRA `training_1`; "Generar con estilo estándar" repite la misma selección con `usarLora: false` y sin `loraMode`; Reintentar repite el último intento; nunca se reintenta solo; sin errores de runtime |

**Límite conocido:** falta comprobar con un plan aprobado real que "Generar con estilo estándar" conserva el `plan_hash` al quitar la allowlist LoRA. Si no lo conserva, el cliente ve `PROPUESTA_DESACTUALIZADA` con "Pedir la propuesta de nuevo" (fallo honesto, no silencioso). Se cubre en la batería final con el smoke en vivo o en B2.

### A4. El chat no repite jerga interna — `hecho` (2026-09-14, vuelta 5)

**Evaluación pagada** (`npx tsx --conditions=react-server scripts/eval-chat-jerga.ts`, 13:35–13:40, contra http://127.0.0.1:3100): **10/10 sin jerga**, modelo `gemini-3.6-flash`, hash del prompt `05c5ba3132639b5b`. 9 casos terminaron con plan; "tamano-sin-catalogo" terminó honestamente sin plan ("No encontré globos de 40 pulgadas en color dorado…"). Se leyeron a mano todas las respuestas finales: sin códigos ni ids; los montos salen como "$76.436 COP" (moneda, aceptable). `plan_audit_log` ya registra los errores nuevos redactados ("Pediste 2 columnas y la propuesta tiene 0 columnas.").

**Defecto encontrado en la evaluación y corregido:** en "cardinalidad" el plan quedó verificado, pero el modelo agotó `VUELTAS_MAX` y el cliente recibió "Perdón, me enredé un poco. ¿Me lo repites de otra forma?" con la propuesta en pantalla. `textoAlAgotarVueltas` solo contemplaba el modo legado (`seleccionFinalIA`); ahora, con `planResuelto`, responde "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar." (caso 5 de `test-jerga-herramientas.ts`, 6 casos OK; `plan:test` exit 0).

**Hallazgos para A5 (no son jerga, pero el cliente los sufre como lentitud o bucles):**

1. Conflicto de reglas: "2 arcos y 3 columnas" declarado como 2 estructuras con repeticiones choca con `validarCardinalidadEventoAbierto`, que cuenta estructuras declaradas (necesita 3–5) y no repeticiones. Una composición explícita del cliente debería bastar. Es el rechazo más frecuente de A1 (41 casos "Evento abierto requiere 3–5").
2. `SIN_COBERTURA` con R-5 y R-24 domina los reintentos: la mezcla de tamaños pide diámetros que el catálogo no tiene en esos colores, y el modelo reintenta a ciegas ("presupuesto-bajo" usó 17 llamadas de herramienta en dos turnos).

**Hecho (vuelta 5):**

- `src/lib/ia/jerga-interna.ts`: detector único `detectarJergaInterna` (SKU, códigos en MAYÚSCULAS_CON_GUIONES, campos snake_case, `EST_nn`, `REF_nn`, ids numéricos de 11+ dígitos, "cobertura", "límite", whitelist/allowlist, backend/prompt/LoRA/payload/hash/snapshot/preflight/status). "R-12" y "techo" se permiten.
- `src/lib/ia/mensajes-cliente.ts`: dueño único de `mensaje_cliente`. Cada `ok:false` de `confirmar_plan_decoracion` (plan inválido, `RESTRICCIONES_INCONSISTENTES`, `COBERTURA_REFERENCIA_INCOMPLETA`, `BACKEND_NO_DISPONIBLE` con y sin búsqueda previa, `PRODUCTO_VARIANTE_INCONSISTENTE`, `ESTIMACION_INCONSISTENTE`, `SIN_COBERTURA` con tamaños en pulgadas y nombre de la estructura, `PRESUPUESTO_EXCEDIDO` en pesos) y el catálogo LoRA no disponible (`catalogo-no-disponible.ts`) lo traen. `status`, `errores` y `accion_requerida` siguen siendo instrucciones técnicas para que el modelo corrija (se conservan: `test-plan-python-cutover` exige `buscar_catalogo_rag` en `accion_requerida` y `rag:test-allowlist` exige `causa`).
- `src/lib/plan/restricciones.ts`: mensajes en español de cliente ("Pediste 2 arcos y la propuesta tiene 0 arcos.", "Pediste el color dorado y la propuesta todavía no lo incluye.", "Para decorar el evento completo conviene armar entre 3 y 5 decoraciones coordinadas…"), antes "Se solicitaron 1 arco(s) y el plan declara 0." y "Evento abierto requiere 3–5 estructuras…".
- `src/lib/ia/prompt-sistema.ts`: bloque nuevo "CÓMO HABLAS DE LO INTERNO" en `SYSTEM_PROMPT_BASE` y corrección de las líneas que empujaban la jerga: `match_level` se dice con palabras; ante SKU ambiguo se pregunta por presentación o color (también en la descripción de `buscar_catalogo_rag` en `herramientas.ts`); "techo de su franja" → "su presupuesto"; "falta de cobertura" → "pieza que no esté disponible"; la regla de honestidad remite a `mensaje_cliente` en vez de "usa su status/errores/accion_requerida"; los ids `REF_*` son internos.
- Prueba determinista `scripts/test-jerga-herramientas.ts` (`npm run ia:test-jerga-herramientas`, añadida a `plan:test`): detector (11 positivos, 4 negativos); todos los mensajes del módulo; errores reales de `validarRestriccionesPlan` y cardinalidad; ramas reales de `confirmar_plan_decoracion` con Pool falso (plan inválido, `RESTRICCIONES_INCONSISTENTES`, `PRESUPUESTO_EXCEDIDO`, `CATALOGO_LORA_NO_DISPONIBLE`), todas con `mensaje_cliente` limpio; prompt sin "SKU exacto" ni "usa su status".
- `plan:test-contratos` fijaba el texto antiguo del acabado; se actualizó al mensaje nuevo con la misma exigencia.
- Evaluación pagada versionada: entradas en `eval/chat/jerga-v001.json` (10 casos: XV años, presupuesto bajo, color inexistente, tamaño sin catálogo, cardinalidad, boda, revelación, letras, corporativo, modo LoRA restringido) y script `scripts/eval-chat-jerga.ts` (HTTP contra el servidor local, una respuesta de seguimiento si no hay plan, resultados en `%TEMP%`, registra modelo, hash del prompt y fecha).

| Comando | Resultado |
| --- | --- |
| `npm run ia:test-jerga-herramientas` | 6 casos OK (incluye el texto al agotar vueltas) |
| `npm run plan:test` (17 scripts con el nuevo) | exit 0 (tras actualizar `plan:test-contratos`) |
| `plan:test-referencia-cobertura`, `plan:test-python-cutover`, `rag:test-open-intent`, `contracts:test` | exit 0 |
| `npx eslint` de los 9 archivos tocados | exit 0 |
| `npx tsc --noEmit` | a las 13:35 fallaba `lora-caption-compiler.ts:906` (`dialect`) por la edición en curso del otro agente; a las 13:45, exit 0 |

Reescribir cada `accion_requerida` y `status` de herramientas para que el modelo no cite SKU, IDs, códigos ni límites, y añadir la regla al prompt del sistema. Prueba determinista con los resultados de herramientas y evaluación con Gemini de 10 conversaciones reales en las que ninguna respuesta contenga los patrones prohibidos: SKU, `_ID`, `LORA_`, "cobertura", "límite", códigos en MAYÚSCULAS_CON_GUIONES.

**Hallazgos de la exploración (2026-09-14):**

- El prompt empuja la jerga: `prompt-sistema.ts:128` pide al modelo explicar el fallo "usando su status/errores/accion_requerida"; `:66` y `herramientas.ts:29` piden "confirmar el SKU exacto"; `:121` y `:127` citan `SIN_COBERTURA` y "falta de cobertura"; `:172` presenta ids `REF_01_E02` como vocabulario de conversación. No hay ninguna regla que prohíba citar IDs o códigos.
- Los resultados de herramientas llegan crudos al modelo (`packages/agente-core/src/gemini/chat.ts:91-104`) y el texto del modelo llega sin filtrar al navegador. Filtrar el stream no es fiable; hay que corregir el origen.
- Textos con jerga, además de la tabla de A1: `restricciones.ts:214, 221, 229, 309, 312` ("Se solicitaron 1 arco(s)…"); advertencias en inglés de `materiales/estimacion.ts:154, 157, 369-393`; `advertencias` de éxito `estructura_sin_cobertura:EST_…`, `sobrante_alto:<variant_id>`, `reserva_merma_no_cubierta:N` (`plan/resolver.ts:485, 593, 635`); `relajaciones` y `conflictos` de presupuesto (`presupuesto/por-rol.ts:113, 215`, `presupuesto/plan.ts:59-61`); motivos de `validar.ts:186-267` y `tamanos/resolver.ts:152` ("La whitelist no tiene R-12").
- Fuga de UI adicional: `page.tsx` pinta `⚠ {variantId}: {motivo}` de `ragRechazados` y "SKU …" de `ragValidados` (van a B2 o C2).

**Plan:**

1. Detector puro `src/lib/ia/jerga-interna.ts` → `detectarJergaInterna(texto): string[]`, con los patrones de la prueba de `ui-error.v1`, más `EST_\d{2}_[A-Z_]+(:R-\d+)?`, `REF_\d+_E\d+`, `\w+_id\b`, `\b\d{11,}\b` y "whitelist". Decisión: `R-12` y "techo" son vocabulario comercial aceptado ("globo de 12 pulgadas" es preferible, pero no es jerga prohibida).
2. `registro-herramientas.ts`: cada `ok:false` añade `mensaje_cliente` (español, sin IDs); los campos de texto libre (`errores`, `accion_requerida`, `advertencias`, `motivo`, `relajaciones`, `conflictos`) se redactan sin IDs ni códigos. `sin_cobertura` se proyecta como `faltantes[{ estructura: nombre, pulgadas }]`. Los IDs se conservan solo en los campos que el modelo debe devolver (candidatos y validados). `causa` LoRA sale del resultado y queda en auditoría; hay que ajustar `test-catalog-allowlist.ts:318-321`.
3. Mensajes humanos en `restricciones.ts` ("Pediste 1 arco y la propuesta no tiene ninguno.").
4. Bloque "CÓMO HABLAS DE LO INTERNO" en `SYSTEM_PROMPT_BASE` y corrección de `:66`, `:121`, `:127`, `:128`, `:172` y `herramientas.ts:29`.
5. Prueba determinista `scripts/test-jerga-herramientas.ts` (Pool falso, plantilla `test-event-plan-contract.ts`) que recorre cada rama `ok:false` de `confirmar_plan_decoracion`, el catálogo bloqueado y `restricciones.ts`; añadirla a `plan:test`.
6. Evaluación pagada `scripts/eval-chat-jerga.ts` (base `eval-chat-thinking.ts`, con plan activo, cargando secretos con `env-local.ps1`, nunca `--env-file=.env.local`) sobre 10 conversaciones versionadas en `eval/chat/jerga-v001.jsonl`: XV años, arco sin tamaños, presupuesto excedido, color inexistente, LoRA bloqueado, referencia adjunta, etc. Criterio: 0 coincidencias; registrar modelo y versión del prompt.

### A5. Propuesta coherente con lo pedido — `hecho` (2026-09-14, vuelta 6)

**Cambios:**

1. `validarPresenciaGlobos` y `permitePropuestaSinGlobos` en `src/lib/plan/restricciones.ts` (dueño único de las reglas "pedido frente a plan"). Una propuesta de diseño debe incluir al menos un producto con globos: categorías `globo_latex`, `globo_metalizado`, `globo_numero_letra`, `kit` y `guirnalda_arco`. La categoría sale de los candidatos del catálogo recuperados en el turno (`estado.ragCandidatos`), no de lo que declara el modelo, y el criterio no es "tiene diámetro": 104 de 134 globos metalizados (letras y figuras) y los kits no lo tienen. Exenciones: "sin globos" o "no quiero globos"; "solo/solamente/únicamente" + accesorio; artículos que no son globos (serpentinas, velas, banderolas, manteles…) sin mencionar globos ni estructuras. Una categoría desconocida no bloquea.
2. `confirmar_plan_decoracion` lo valida justo después de las restricciones y antes del backend: `ok:false`, `status: PLAN_SIN_GLOBOS`, `accion_requerida` técnica (buscar globos por color sin exigir la ocasión, porque ningún globo lleva la etiqueta `xv_anos`), `mensaje_cliente` limpio y auditoría en `plan_audit_log`. `BLOQUE_PLAN` suma la regla.
3. Cardinalidad de evento abierto (el rechazo más frecuente de A1 y causa del bucle "cardinalidad" de A4): el mínimo de 3 se cuenta en instancias (`repeticiones`) y no aplica si el cliente fijó la composición ("2 arcos y 3 columnas") o puso un presupuesto explícito, como ya ordenaba el prompt ("EL TECHO MANDA"). Dos piezas sin composición ni presupuesto siguen rechazándose (`test-open-intent-plan-generation.ts` sin cambios).

**Decisión de producto aplicada:** el asistente es de una marca de globos; la regla "exigir globos salvo pedido explícito de solo accesorios" se tomó en la vuelta 2 (ver hallazgos de A5). Consecuencia conocida: un pedido sin palabras de accesorios ni de globos ("Festival Lunaria verde y blanco") exige globos; `test-event-plan-contract.ts` no se ve afectado porque no carga categorías de candidatos.

| Comando | Resultado |
| --- | --- |
| `npm run plan:test-sin-globos` (nuevo, añadido a `plan:test`) | 4 casos OK: detección de pedidos sin globos (5 positivos, 4 negativos); regla por categoría (kit y categoría desconocida no bloquean; mensaje sin jerga); regresión real XV años solo serpentinas → `PLAN_SIN_GLOBOS` por la herramienta, y "solo serpentinas" pasa; cardinalidad por instancias, composición y presupuesto explícitos |
| `npm run plan:test` (18 scripts), `plan:test-python-cutover`, `plan:test-referencia-cobertura`, `rag:test-open-intent` | exit 0 |
| `npx tsc --noEmit`, `npx eslint` de los archivos tocados | exit 0 |

**Verificación en vivo** (2 conversaciones reales, `scratchpad/verificar-a5.cjs`):

| Caso | Antes | Después |
| --- | --- | --- |
| "XV años… rosa, dorado y plateado" | plan solo con serpentinas plateadas (reporte original) | 7 llamadas; plan con arco de globos reflex "Mis 15 Años" dorado y plata (R-12) más cortinas metálicas rosadas; 2 de 3 compras con diámetro |
| "Baby shower: 2 arcos y 3 columnas en azul y blanco" | 11 llamadas y "Perdón, me enredé un poco" (eval A4) | 10 llamadas, sin rechazos de cardinalidad; plan de 2 arcos y 3 columnas azules y mantel blanco. Los reintentos que quedan son `SIN_COBERTURA` → A6 |

### A6. Bucles por tamaños sin catálogo (`SIN_COBERTURA`) — `hecho` (2026-09-14, vuelta 7)

**Segunda causa, la principal, encontrada al medir:** la opción B sola no redujo los bucles (5 casos: 54 herramientas frente a 50 de base; "corporativo" empeoró a 21 llamadas sin plan). En el log, "corporativo" repetía `EST_01_PARED:R-12` aunque R-12 existe en el 95 % de los productos. El catálogo guarda colores canónicos gruesos (`azul`, `rosado`, `dorado`: 67 productos de látex con `azul`, ninguno con `azul rey`) y los dos resolvers comparan el color del material literalmente (`resolver.ts:130`, `plan.py:632` y `:940`). El modelo escribe el color del cliente ("azul rey", "rosa") y ninguna variante coincide, en ningún tamaño. Comprobado directamente contra `resolverPlan`: material "azul rey" → `sin_cobertura: [R-12]`; material "azul" → `[]`.

**Corrección:** `src/lib/plan/colores-catalogo.ts` (`colorDeCatalogo`, `canonizarColoresPlan`) aplica la taxonomía dueña de los sinónimos (`clasificarColores`, `src/lib/rag/taxonomy/v2.ts`) a `materiales[].color` y `variant_overrides[].color` una sola vez, en `confirmar_plan_decoracion`, antes de validar y resolver: "azul rey" → azul, "rosa" → rosado, "plata" → plateado, "oro rosa" → dorado rosa. Un color desconocido o que nombra varios colores se deja igual. No se tocan los resolvers ni la paridad: los dos backends reciben el color canónico. El tono lo sigue fijando el producto elegido ("Fashion Azul Rey"); el color solo filtra variantes dentro de ese producto. `validarRestriccionesPlan` sigue aceptando "rosa" frente a "rosado" (compara por inclusión).

**Evidencia final:**

| Comando | Resultado |
| --- | --- |
| `npm run plan:test-cobertura-tamanos` | 4 casos OK (incluye la regresión "azul rey" contra variantes "azul" por la herramienta real) |
| `npm run plan:test` (19 scripts), `plan:test-paridad-python`, `plan:test-python-cutover` | exit 0 |
| `npx tsc --noEmit`, `npx eslint` | exit 0 |

**Evaluación en vivo** (script liviano `scratchpad/verificar-a6-liviano.cjs`, sin `tsx`, porque la evaluación completa de 10 casos fue detenida por el sistema con 1,4 GB de RAM libre; mismos 5 casos que más reintentaban):

| Corrida | Herramientas | Confirmaciones | Planes | `SIN_COBERTURA` en el log |
| --- | --- | --- | --- | --- |
| Base (A4, antes de A5 y A6) | 50 | 26 | 5/5 | — |
| Opción B sola | 54 | 28 | 4/5 | 12 |
| **B + colores canonizados** | **45** | **21** | 4/5 | **2** |

Por caso tras la corrección: xv-glamour 6 herramientas; cardinalidad 9 (base 11); boda-jardin 6 (base 9); corporativo 6 (antes 21, ahora con plan); presupuesto-bajo 18 sin plan. Este último es inviable de forma honesta: 4 rediseños con `PRESUPUESTO_EXCEDIDO` (101.676 → 88.970 → 144.044 → 78.345 COP frente a 60.000) y la respuesta final da el mínimo real y pide decidir. Con una corrida por caso la variación del modelo es alta; la mejora clara y reproducible es la de colores, demostrada también de forma determinista.

**Pendiente menor:** en esa respuesta el modelo escribió "supera el límite de $60.000 COP". Viene de `BLOQUE_PLAN` ("cuánto se pasa del techo"). Cambiar a "cuánto se pasa de su presupuesto" en `prompt-sistema.ts`, que el otro agente editó a las 14:01; se hace cuando el archivo lleve 15 minutos sin cambios.

**Medición en el catálogo local** (508 productos redondos activos con variantes disponibles; misma sustitución admisible que `resolver.ts:104` y `plan.py:606`: solo vecinos estándar con proporción ≤ 1,5, por lo que 5↔9 no se admite):

| Diámetro | Productos que lo tienen |
| --- | --- |
| R-5 | 119 (23 %) |
| R-9 | 100 (20 %) |
| R-12 | 482 (95 %) |
| R-18 | 89 (18 %) |
| R-24 | 97 (19 %) |

| Mezcla | Productos que la cubren |
| --- | --- |
| `clasica` | 489 (96 %) |
| `organica_fina` (default de Python y del esquema de `calcular_medidas`) | **91 (18 %)** |
| `organica_gruesa` | 93 (18 %) |
| `solo_grandes` | 110 (22 %) |

**Causa raíz confirmada:** la mezcla orgánica que empuja el prompt falla en el 82 % de los productos y el modelo solo recibía la lista de faltantes.

**Implementado (opción B, sin tocar el dominio ni la paridad):**

- `pulgadasDeMezcla` y `MEZCLAS_DISPONIBLES` en `src/lib/medidas/geometria.ts` (dueño de las mezclas) y `mezclasCompatiblesConDiametros` en `src/lib/plan/resolver.ts` (dueño de la sustitución admisible).
- `coberturaPorProducto` en `registro-herramientas.ts`: el rechazo `SIN_COBERTURA` suma `cobertura_por_producto` con `tamanos_faltantes`, `tamanos_disponibles` (de los candidatos del turno) y `mezclas_compatibles`, y la `accion_requerida` dice cómo usarlo.
- Descripción de `mezcla` en el esquema de `confirmar_plan_decoracion` (`herramientas.ts`): qué diámetros pide cada mezcla y que un producto solo con 12 pulgadas va con `clasica`. No se tocó `prompt-sistema.ts` porque el otro agente lo editó a las 13:48.
- Prueba `scripts/test-plan-cobertura-tamanos.ts` (`npm run plan:test-cobertura-tamanos`, en `plan:test`): 3 casos OK (mezclas compatibles; cobertura por producto; rechazo real con `organica_fina` que sugiere `clasica` y un reintento con `clasica` que verifica el plan).

| Comando | Resultado |
| --- | --- |
| `npm run plan:test` (19 scripts), `plan:test-resolver`, `plan:test-geometria`, `plan:test-python-cutover` | exit 0 |
| `npx tsc --noEmit`, `npx eslint` de los archivos tocados | exit 0 |

**Línea base para comparar** (evaluación de A4, antes de A5 y A6): 79 llamadas de herramienta, 38 `confirmar_plan_decoracion`, 9 planes en 10 conversaciones; 9 rechazos `SIN_COBERTURA` en la ventana del log.

**Opción A (no implementada, candidata a ADR):** adaptar la mezcla a los diámetros disponibles dentro del resolver (Python autoritativo y adaptador TS), declarando la adaptación como sustitución. Evita el reintento por completo, pero cambia la cotización, el `plan_hash` y los vectores dorados de paridad.

**Evidencia:** en los últimos 8 días `plan_audit_log` tiene 39 rechazos `SIN_COBERTURA` frente a 36 `APROBACION_REQUERIDA` (planes que sí salieron): hoy es el motivo principal de reintentos. Tamaños faltantes: R-24 (131 menciones), R-5 (118), R-12 (115), R-18 (67), R-9 (57). En la evaluación de A4, "presupuesto-bajo" usó 17 llamadas de herramienta y "cardinalidad" varias rondas de `SIN_COBERTURA` antes de converger.

**Causa probable:** la mezcla de tamaños (`clasica`, `organica_fina`…) pide diámetros fijos (R-5…R-24) sin mirar qué tamaños existen para el producto y color elegidos; el modelo solo recibe la lista de faltantes y reintenta a ciegas cambiando productos.

**Plan (a validar en su vuelta):**

1. Medir: script determinista con el catálogo local que, para cada producto de globo y color, lista los diámetros disponibles, y cruzarlo con las mezclas del resolver para estimar qué porcentaje de combinaciones producto × mezcla falla.
2. Opción A, en el resolver (dueño Python y adaptador TS, con paridad): restringir la mezcla a los diámetros disponibles del producto y registrar la adaptación como `sustitucion` declarada. Cambia el plan resuelto y los vectores dorados, así que requiere revisión de paridad y posiblemente ADR.
3. Opción B, sin tocar el dominio: devolver en el rechazo `SIN_COBERTURA` los tamaños disponibles por producto elegido y una `accion_requerida` que diga exactamente qué mezcla sí cabe, para que el modelo converja en un reintento.
4. Criterio: en la suite `eval/chat/jerga-v001.json`, bajar llamadas de herramienta por conversación (hoy entre 4 y 17) sin empeorar planes aprobados.

Si el cliente pidió globos o una estructura de globos y el plan no tiene ningún globo, `confirmar_plan_decoracion` lo rechaza con un motivo corregible. Test de regresión con el caso de XV años que salió solo con serpentinas plateadas.

**Hallazgos:** las reglas "pedido frente a plan" viven solo en TypeScript (`src/lib/plan/restricciones.ts:162-288`); Python no las duplica. Las estructuras solo se detectan con número delante ("un arco" sí, "arco de globos" no). Las estructuras no geométricas (`backdrop`, `kit`, `accesorio`) aceptan cualquier variante (`plan/resolver.ts:470-482`), y por ahí entra un plan hecho solo de serpentinas. La definición compartida de globo es `diam_pulg != null` (`resolver.ts:600`, `estimacion.ts:442`, `plan.py:1367`) y alimenta `materialEstimate.balloons`. El único texto conocido del caso XV años ("Quiero decorar unos XV años en un salón, estilo glamour, colores rosa, dorado y plateado") **no dice "globos"**. Causa probable aguas arriba: `scripts/test-catalog-allowlist.ts:170` ("zero balloons carry the xv_anos tag") y el filtro de ocasión, que solo se relaja con cero resultados.

**Decisión tomada (deducible del producto):** el asistente es de una marca de globos y el plan se arma para decorar con globos. En modo diseño se exige al menos un globo, salvo que el cliente pida explícitamente solo accesorios o "sin globos". La alternativa estricta (solo cuando dice "globos") no cubre la regresión real. Obliga a revisar el caso "Festival Lunaria" de `test-event-plan-contract.ts`, que hoy acepta un plan solo con accesorios.

**Plan:**

1. En `restricciones.ts`: `solicitaSoloAccesorios(texto)` (negación: "sin globos", "solo serpentinas") y `validarGlobosResueltos(permiteSinGlobos, nGlobos)`. Sin tocar `RestriccionesUsuarioSchema` (cambiaría el contrato, el hash y los vectores dorados); el dato va en `EstadoConversacion`.
2. En `registro-herramientas.ts`, después de obtener la resolución y antes de estimación y `SIN_COBERTURA`: con `resolucion.materialEstimate.balloons.length === 0` y sin permiso explícito → `ok:false`, status nuevo `PLAN_SIN_GLOBOS`, `mensaje_cliente` humano, auditoría con `registrarPlanAudit` y una línea en `BLOQUE_PLAN`. Es neutral respecto al backend porque usa el catálogo resuelto, no lo que declara el modelo.
3. Pruebas `scripts/test-plan-sin-globos.ts` (Pool falso, `PYTHON_BACKEND_ENABLED=false`): XV años con solo serpentina → rechazo; con arco de globos → OK; "solo serpentinas plateadas" → OK; "sin globos" → OK; variante Python en `test-plan-python-cutover`. Los vectores dorados de paridad no cambian.
4. Seguimiento aparte: por qué la búsqueda de XV años no devuelve globos (etiqueta `xv_anos` y relajación del filtro de ocasión).

## B. Modo usuario y modo dev

### B1. Switch — `hecho` (2026-09-14, vuelta 8)

Visible y accesible (teclado, aria) en la cabecera. Preferencia por navegador en `localStorage` con try/catch. Por defecto: modo usuario. Opcional: `?dev=1`.

**Implementado:**

- `src/lib/estado/modo-vista.ts`: `useModoVista()` con `useSyncExternalStore` (el servidor siempre renderiza modo usuario; el navegador aplica la preferencia al hidratar, sin `setState` dentro de efectos). `localStorage` con try/catch y respaldo en memoria por pestaña; sincroniza con otras pestañas (`storage`). `?dev=1` activa y `?dev=0` desactiva, y queda guardado. Funciones puras `interpretarModoVista` (solo "dev" activa dev) y `modoVistaDesdeQuery`. Es una preferencia de presentación, **no un permiso**.
- `src/components/modo/SwitchModoVista.tsx`: `<button role="switch" aria-checked>` con nombre "Modo dev", operable con Tab y Espacio/Enter y con foco visible.
- `page.tsx`: switch al inicio de las acciones de la cabecera; `AvisoError` muestra detalles técnicos solo con `esModoDev` (se eliminó `DETALLES_DEV_PROVISIONAL`).
- Ajuste pendiente de A6 aplicado en `prompt-sistema.ts`: "cuánto se pasa de su presupuesto (dilo así, nunca "techo" ni "límite")". `ia:test-jerga-herramientas` y `plan:test-referencia-cobertura` siguen en verde.

| Comando | Resultado |
| --- | --- |
| `npm run ui:test-modo-vista` (nuevo) | PASS: default usuario, solo "dev" activa dev, `?dev=1/0` explícitos |
| `npx tsc --noEmit`, `npx eslint` de `page.tsx`, `modo-vista.ts`, `SwitchModoVista.tsx` | exit 0 |
| `scratchpad/verificar-b1.cjs` (Playwright contra http://127.0.0.1:3100) | 12 PASS, 0 FAIL: default usuario; `role=switch` con nombre; aviso sin detalles en usuario y con detalles al pasar a dev; persiste al recargar; Espacio con foco cambia y conserva el foco; `?dev=1` activa y queda guardado; `?dev=0` vuelve a usuario; sin errores de runtime ni de hidratación |

**Nuevo control dev para B2:** el otro agente añadió a la cabecera un selector "Formato del prompt LoRA" (texto, JSON o ambos, este último con doble costo). También va solo en modo dev.

**Plan:** hook `src/lib/estado/modo-vista.ts` (`useModoVista(): { modo, cambiar }`), con lectura inicial en efecto para no romper la hidratación. `?dev=1` activa dev y lo persiste; `?dev=0` vuelve a usuario. Control `role="switch"` con `aria-checked` y etiqueta "Modo dev", navegable con teclado. El modo es una preferencia de presentación, **no un permiso**: no autoriza nada en el servidor. `DETALLES_DEV_PROVISIONAL` de `page.tsx` pasa a leer el modo. Prueba pura con `tsx` de la función que interpreta `localStorage` y la query.

### B2. Contenido solo dev — `hecho` (2026-09-14, vueltas 9 y 10)

**Verificación en navegador** (`scratchpad/verificar-b2.cjs`, Playwright contra http://127.0.0.1:3100; chat y generación simulados con el plan real de A2, sin llamadas pagadas): **25 PASS, 0 FAIL**.

- Modo usuario: sin selector de modelo, casilla, Estadísticas ni enlaces de laboratorio, admin y LoRA; "Explorar catálogo" sí; sin id de la pieza descartada y con aviso humano; botón "Aprobar y generar imagen" habilitado sin tocar la casilla; aprobar envía `imageQaRequested: true` y, sin adjuntos, `usarLora: true` con `loraMode`; el modal del prompt no se abre solo; sin "Generada con" ni "Ver prompt usado"; sin razones técnicas del QA y con el aviso humano de imagen no fiel; sin errores de runtime.
- Modo dev: todo lo anterior visible; el id de la pieza descartada visible; el botón exige "Activa la validación visual".
- La primera corrida quedó colgada 27 minutos: la barra fija de aprobación tapa el botón de la tarjeta y Playwright no pone límite de tiempo a `click()` por defecto. Se detuvo (con 0,5 GB de RAM libre) y el script ahora usa límites de 20 s y el botón fijo, que es el que ve el cliente. No era un defecto de la app.
- Límite de la prueba: el plan guardado no trae `event_match_levels`, así que la comprobación de niveles de coincidencia no ejerce el caso con datos.

**Jerga que sigue visible en modo usuario dentro de `TarjetaPlanDecoracion`** (vista en la captura `scratchpad/b2/plan-usuario.png`; no se corrigió porque otro agente editó ese archivo a las 14:42 como parte de "estructuras oficiales"): "⚠ EST_01_ARCO: R-24 → R-18" (sustituciones con `estructura_id`), "EST_…: sin cobertura para R-…", "Techo: $ 1.500.000 · compatible", "Distribución cotizada: R-12 · 67 (54%) · R-5 · 26…" y etiquetas de tipo en mayúsculas ("ARCO"). Van a C2 (tras "Ver detalle" y sin ids), coordinando con ese trabajo.

**Implementado (vuelta 9):**

- Reglas puras en `src/lib/estado/modo-vista-reglas.ts`: `qaVisualEfectivo` (modo usuario: revisión visual siempre activa; dev: la casilla), `usarLoraEfectivo` (opción (a): LoRA por defecto; en modo usuario, estilo estándar si hay foto del espacio, referencias o ajuste de la imagen previa, decidido antes de pedir la imagen; el pedido explícito "estilo estándar" siempre gana; en dev manda el selector) y `abrirPromptAutomaticamente` (solo dev).
- `page.tsx`: el cuerpo de `/api/generate`, `aprobarPlan` y los botones de aprobación usan `qaEfectivo`. Solo en modo dev: selector de modelo, formato del prompt LoRA, casilla "Validar visualmente", enlace Estadísticas, enlaces Laboratorio JSON, Panel de administración y Configuración LoRA, mensaje con el JSON del análisis de referencias (se omite el mensaje completo, no solo el `<details>`), "SKU …" en la verificación de piezas, ids y motivos técnicos de piezas descartadas (en modo usuario: "Una pieza que te propuse ya no está disponible y la quité de la propuesta."), "Generada con…", "Ver prompt usado", apertura automática del `PromptModal` y `GenerationQaSummary` (en modo usuario, si `qa.pass === false`: "Esta imagen puede no reflejar exactamente la propuesta. Puedes generar otra versión.").
- `TarjetaPlanDecoracion.tsx`: prop `modoDev`; solo en dev los niveles de coincidencia del evento, los "Ajustes declarados" y el botón de referencias de entrenamiento (en modo usuario ni siquiera se consulta `/api/lora/training-reference-counts`). En ambos modos se corrigió jerga: "Dentro del techo" → "Dentro del presupuesto" y "Completa las piezas sin cobertura" → "Faltan piezas disponibles".

| Comando | Resultado |
| --- | --- |
| `npm run ui:test-modo-vista` | 2 PASS (interpretación del modo y reglas por modo: 13 aserciones de B2) |
| `npx tsc --noEmit`, `npx eslint` de `page.tsx`, `TarjetaPlanDecoracion.tsx`, `modo-vista-reglas.ts` | exit 0 (1 aviso preexistente de `exhaustive-deps` en la tarjeta) |

**Límite conocido:** `generar()` se ejecuta dentro de una cola y lee el modo del render en el que se creó la función; si el cliente cambia de modo en medio de un turno del chat, la generación automática de ese turno usa el modo anterior. Solo afecta al modo dev y es transitorio.

Solo en modo dev: `PromptModal` (hoy se abre solo tras cada generación, `page.tsx:1180`), JSON crudo de referencias, badges y selector LoRA, `request_id`, costes, QA detallado (`GenerationQaSummary`), laboratorio de referencias, detalles de errores y datos de allowlist o snapshot. El modo usuario no renderiza nada de eso.

**Riesgo detectado: tres controles "dev" condicionan el flujo del cliente.** Ocultarlos sin más rompe el modo usuario:

1. **Validación visual** (`qaVisualSolicitado`, `false` por defecto): sin ella `aprobarPlan` falla (`page.tsx`, "Activa la validación visual…") y el servidor devuelve `IMAGE_QA_REQUIRED` (`generate/route.ts:1099-1101`). Decisión: en modo usuario, la revisión de calidad va siempre activa, porque es obligatoria para aprobar un plan. Tiene costo y latencia de una llamada de visión por generación. Si no se quiere ese costo, la alternativa es activar `IMAGE_QA_ENABLED` en el servidor; en ambos casos la acción `activar_validacion_visual` del aviso deja de hacer falta en modo usuario.
2. **LoRA por defecto** (`selectorIA = "lora"`): `/api/generate` rechaza LoRA con foto del espacio, referencias o ajustes sobre la imagen previa (`route.ts:1033-1034`). Regla derivada para modo usuario: estilo estándar automático cuando hay adjuntos o un ajuste, LoRA en el resto. **BLOQUEADO (decisión de producto):** ¿el cliente final debe ver alguna vez imágenes LoRA? Opciones: (a) LoRA por defecto con la regla anterior; (b) estilo estándar siempre en modo usuario y LoRA solo en dev; (c) selector de "estilo" visible para el cliente, sin nombres técnicos. Mientras no se decida, B2 implementa (a), que conserva el comportamiento actual.
3. **`loraMode: "training_1"`** viaja siempre al chat (`page.tsx:905`) y restringe el catálogo a la lista del dataset LoRA (`chat/route.ts:205-208`), incluso con estilo estándar. Queda atado a la misma decisión del punto 2.

**Inventario a ocultar en modo usuario** (auditoría 2026-09-14): selector de modelo y casilla "Validar visualmente" de la cabecera; enlaces Estadísticas, Laboratorio JSON, Panel de administración y Configuración LoRA; mensajes que inyecta `cambiarSelector` ("LoRA Sempertex seleccionado…"); JSON de análisis de referencias (hay que filtrar el mensaje completo, no solo el `<details>`); bloque "Verificar piezas… SKU …" de `ragValidados` (los datos siguen usándose en `generar()`); ids de `ragRechazados` (el aviso se conserva, con nombre de pieza en vez de id); "Generada con {etiqueta}" y "Ver prompt usado"; `PromptModal` sin apertura automática; `GenerationQaSummary`; en `TarjetaPlanDecoracion`, niveles de coincidencia de evento, botón "N referencias en entrenamiento" y su modal; detalles técnicos de `AvisoError`.

### B3. Pruebas de modos — `hecho` (2026-09-14, vuelta 11)

**Implementado:** `scripts/e2e-modo-vista.ts` (`npm run ui:e2e-modo-vista`), con la librería `playwright` 1.62.1 ya instalada (sin dependencias nuevas), contra el servidor en marcha. Simula `/api/chat` y `/api/generate` con la fixture versionada `eval/ui/plan-resuelto-arco-columnas.json`: plan real con IDs públicos del catálogo, `approval_token` reemplazado por un marcador sin firma y `event_match_levels`/`event_relaxations` añadidos para ejercitar el contenido dev con datos (ver `eval/ui/README.md`). Límite de 20 s por acción. Las reglas puras siguen en `npm run ui:test-modo-vista`. El e2e no entra en las pruebas rápidas porque necesita el servidor y `APP_PASSWORD`.

| Comando | Resultado |
| --- | --- |
| `npx tsc --noEmit`, `npx eslint scripts/e2e-modo-vista.ts` | exit 0 |
| `npm run ui:e2e-modo-vista` (http://127.0.0.1:3100) | **32 PASS, 0 FAIL**: switch (8: default, aria, clic, persistencia, teclado, `?dev=1`, `?dev=0`, sin errores); modo usuario (15: controles, enlaces, niveles de coincidencia, ajustes declarados, id descartado, aviso humano, aprobación sin casilla, QA obligatorio, LoRA sin adjuntos, sin modal ni prompt, QA humano, sin errores); modo dev (9) |

Test de componentes o e2e: los dos modos renderizan lo que corresponde y el switch persiste.

**Plan:** el repositorio no tiene vitest, jest, testing-library ni `@playwright/test`; sí tiene la librería `playwright` 1.62.1, que ya se usó en la verificación de A3. Sin dependencias nuevas: (1) prueba pura con `tsx` del mapa de visibilidad por modo (`src/lib/estado/visibilidad-modo.ts`) y de las reglas efectivas (QA y estilo); (2) script e2e `scripts/e2e-modo-vista.ts` con la librería `playwright` contra el servidor local, que simula `/api/chat` y `/api/generate` como en A3, recorre ambos modos, recarga para comprobar la persistencia y valida con los `data-testid` existentes (`aprobar-generar-plan`, `plan-desglose`, `linea-referencias-entrenamiento`). Script npm `ui:e2e-modo-vista`, fuera de las pruebas rápidas porque necesita el servidor.

## C. Rediseño simple (sin ruido visual)

### C1. Auditoría visual — `hecho` (inventario 2026-09-14; capturas "antes" vuelta 12)

`src/app/page.tsx` (2092 líneas), `TarjetaPlanDecoracion.tsx` y los componentes de referencias: cada elemento en pantalla clasificado como esencial para el cliente, dev o eliminable. Capturas antes, guardadas fuera del repo.

**Inventario (2026-09-14, exploración de solo lectura).** Clasificación E = esencial, D = dev, R = redundante o eliminable.

| Zona | Elementos | Clase |
| --- | --- | --- |
| Cabecera | Título (E); logo con animación infinita y subtítulo (R); selector de modelo, "Validar visualmente", Estadísticas (D); Limpiar chat (E) | mixto |
| Navegación | Explorar catálogo (E); Laboratorio JSON, Panel de administración, Configuración LoRA (D) | mixto |
| Encabezado del chat | "Dirección creativa", título grande, texto de apoyo, "Brief en marcha / Curaduría + selección manual" | R (repite título y "Tu evento") |
| Mensajes | Burbuja (E); avatar con anillo giratorio (R); indicador de herramienta, Editar y reenviar, decoraciones, chips de categoría, productos, medidas (E) | E |
| Referencias | Estado "Analizando…" (E); lista con categoría en slug inglés y etiquetas de alcance (D/R); `ReferencePlanCard` con estado crudo en mayúsculas y notas finales (R) | mixto |
| Propuesta | `TarjetaPlanDecoracion` (ver abajo); `TarjetaCotizacion` junto a un plan repite el total (R) | E con detalle |
| Verificación | JSON de análisis (D); "Verificar piezas… SKU" (D); "⚠ {variantId}: {motivo}" (aviso E, id D) | D |
| Aviso | `AvisoError` (E, ya con mensaje humano) | E |
| Aprobar | **Tres botones de aprobación** (tarjeta, fijo abajo desde 1024 px, barra lateral); se ven dos a la vez | R |
| Barra lateral | Tu evento (E); Selección y "Agregar a mano" (E en flujo sin plan, R con plan); ajuste, aviso de selección cambiada, botón principal con 7 textos, progreso (E) | mixto |
| Imágenes | Imagen y aviso legal (E); "Generada con…", "Ver prompt usado", QA detallado (D); visor ampliado (E); `PromptModal` que se abre solo (D) | mixto |

`TarjetaPlanDecoracion`: **visible siempre** título, estado, descripción, total en unidades y COP, techo o exceso de presupuesto, nombres de estructuras, "Aprobar y generar imagen", "Ajustar plan" y el aviso de piezas sin disponibilidad (redactado sin `estructura_id`). **Tras "Ver detalle":** etiqueta y niveles de evento, relajaciones, tipo en mayúsculas, medidas, distribución "R-x · n (pct%)", el porqué, lista de elementos, ahorro por paquetes, alternativas, supuestos y sustituciones, presentación y sobrante, editor avanzado. **Eliminable:** "Una fila por variante…" y "Los paquetes se compran una sola vez…". **Dev:** "N referencias en entrenamiento" y su modal. La merma está en `TarjetaCotizacion.tsx:129-132`.

**Ruido medido:** animaciones infinitas decorativas (`ambient-drift`, `mark-breathe`, `avatar-orbit`, `stream-border`), cuadrícula de fondo, unos 10 `backdrop-filter` y desenfoque de entrada en cada mensaje; colores fuera de los tokens que se saltan el modo oscuro (`red-100/700`, `amber-*`, `emerald`); los errores usan el violeta de marca; unos 14 estilos distintos de etiqueta; tamaños `text-[10px]`, `text-[11px]` más ~8 tamaños rem; `max-w-[85%]` frente a `max-w-[92%]`; `text-texto-suave` 28 veces en `page.tsx` y 48 en la tarjeta del plan. Código muerto: `ScenePlanCard.tsx`, `SceneCoveragePanel.tsx` y las clases CSS `material-sidebar`, `material-comparison-card`, `material-kicker`, `material-dot`, `workspace-mode`.

**Capturas "antes" (2026-09-14 15:05, vuelta 12, tras B2):** `scratchpad/c1/antes/{1280,400}-{1-vacio,2-propuesta,3-error,4-imagen}.png`, tomadas con `scratchpad/capturas-c1.cjs` en modo usuario, con chat y generación simulados (fixture `eval/ui/plan-resuelto-arco-columnas.json` e imagen LoRA real de A2) y página completa. Desbordamiento horizontal: 0 px a 1280 y a 400. El mismo script con la etiqueta `despues` sirve para C4.

**Ruido observado en las capturas (entrada de C2):**

- Tarjeta del plan a 400 px: el título "Esto es lo que voy a armar" y el subtítulo se parten palabra por palabra porque "Ajustar plan" y "Dentro del presupuesto" ocupan el ancho.
- Jerga visible para el cliente en la tarjeta: "Distribución cotizada: R-12 · 67 (54%) · R-5 · 26 (21%)…", "Techo: $ 1.500.000 · compatible" y "⚠ EST_01_ARCO: R-24 → R-18" (tres veces, una por estructura o repetición).
- La tarjeta dice "39 cada una · a la izquierda" para el par de columnas: la ubicación declarada por el modelo, no el par izquierda/derecha que se corrigió en A2 para la imagen.
- Texto de relleno: "Los paquetes se compran una sola vez para toda la decoración…", "Ahorro por consolidar paquetes".
- Encabezado de la columna de chat ("Dirección creativa", título de 3 líneas, "Brief en marcha / Curaduría + selección manual") que repite el título de la cabecera y "Tu evento".
- Tres acciones de aprobación (tarjeta, barra fija y barra lateral); a 1280 px se ven dos a la vez, y tras aprobar la lateral dice "Aprobación registrada" junto a "Necesitas una pieza o referencia para generar", que contradice lo que acaba de pasar.
- A 400 px la barra lateral ("Tu evento", "Selección (0)", botón de aprobar) queda al final de la página, debajo del campo de texto.
- El distintivo "Cache disabled" es el indicador de desarrollo de Next y no aparece en producción.

### C2. Jerarquía clara en modo usuario — `en curso` (parte de página hecha en la vuelta 12; tarjeta del plan en espera de coordinación)

**Hecho en `page.tsx` (vuelta 12, modo usuario):** se oculta el encabezado de la columna de chat ("Dirección creativa…", "Brief en marcha / Curaduría + selección manual"); con una propuesta en la conversación se oculta la lista manual "Selección (0) / Agregar a mano"; el botón lateral solo aparece sin propuesta o para aplicar un ajuste escrito sobre una propuesta aprobada (antes había tres acciones de aprobación y dos visibles a la vez); "Necesitas una pieza o referencia para generar" ya no aparece con una propuesta en pantalla; la barra fija dice "Faltan piezas disponibles" en vez de "Completa las piezas sin cobertura". Modo dev sin cambios. Verificación: `npx tsc --noEmit` y `npx eslint src/app/page.tsx` exit 0; `npm run ui:e2e-modo-vista` 32 PASS; capturas intermedias `scratchpad/c1/c2-pagina/` sin desbordamiento horizontal a 1280 ni a 400.

**Pendiente en `TarjetaPlanDecoracion.tsx`** (otro agente la editó a las 14:42 y 14:58 con "estructuras oficiales"): mover a "Ver detalle" la "Distribución cotizada", el ahorro por paquetes, "Techo" y las sustituciones, redactadas sin `estructura_id` ni códigos R-; quitar "Los paquetes se compran una sola vez…"; arreglar el encabezado a 400 px (título y subtítulo partidos por las insignias); decir la ubicación real del par de columnas ("a los lados") en vez de "a la izquierda".

Chat, propuesta con precio total y un botón principal, e imagen. Tras "Ver detalle": desglose de materiales, sustituciones y merma. Una sola paleta, espaciado generoso, sin bordes ni badges redundantes, estados de carga, vacío y error explícitos.

### C3. Dividir `page.tsx` por responsabilidad — `pendiente` (requiere C2)

Conversación, propuesta, imagen, referencias y modo, sin cambiar el comportamiento. Reutilizar componentes existentes.

**Corte natural** (líneas aproximadas previas a A3): utilidades puras (tipos, SSE, recorte de imagen; 36-428) → `src/lib/chat-ui/`; conversación (`useConversacion`, 798-983 y render 1503-1692); propuesta (1240-1313, botones de aprobación); generación (`useGeneracionImagen`, 1022-1238 y panel 2128-2197); adjuntos y referencias (573-603, 1339-1381, 1491-1501, 1700-1870); selección manual (1950-2054, ya con contexto `useSeleccion`); estructura (cabecera y "Tu evento"). `limpiarTodo` toca todas las piezas: cada hook expone su `reset()`. Los refs espejo (`fotoEspacioRef`, `imagenesReferenciaRef`, `referenceDraftRef`, `briefRef`) se comparten entre conversación y generación y deben seguir siendo la fuente leída por los closures.

### C4. Capturas después — `pendiente` (requiere C3)

Comparadas con las de antes, con comprobación a 400 px de ancho y con teclado.

## D. Reconocimiento de estructuras en referencias

### Mapa actual del reconocimiento (exploración 2026-09-14)

Flujo: el cliente adjunta hasta 3 fotos (`page.tsx`, redimensionadas a 1800 px) → `ReferenceAnalysisController` hace POST a `/api/references/analyze` en cada cambio → `analizarReferenciasV2(chat, refs, [], "perceptual")` (`src/lib/ia/analizar-referencias-v2.ts:601-618`) ejecuta dos turnos con temperatura 0: inventario (`return_reference_inventory`, 6000 tokens) y auditoría (`return_reference_audit`, 4000 tokens, con el borrador cortado a 24 000 caracteres) → fusión por IoU ≥ 0,35 → `ReferenceBlueprintV2Schema`. Modelo `gemini-3.6-flash` o `GEMINI_CHAT_MODEL`; versión `ANALYSIS_PARSER_VERSION = "semantic-layers-v7-bill-of-materials"`; `promptVersion` en telemetría = sha256 corto del prompt. El blueprint viaja al chat (`referenceBlueprint`), que lo serializa en el prompt (máximo 20 elementos aprobados, `prompt-sistema.ts:147-166`) y exige cobertura en `confirmar_plan_decoracion` (`restricciones.ts:242-288`). En `/api/generate`, **con plan aprobado el blueprint se ignora** (`route.ts:915-919`): las posiciones salen de un layout fijo y la foto solo viaja como `composition_reference`.

Defectos que explican el "funciona muy mal":

1. **La auditoría no ve las imágenes.** `ChatPort` marca cada objeto imagen en un `WeakSet imagenesEnviadas` (`packages/agente-core/src/gemini/chat.ts:71-73`) y el turno de auditoría reutiliza esos objetos (`analizar-referencias-v2.ts:603, 613`): la segunda llamada recibe solo `[IMAGEN_ID=…]` en texto. La telemetría no lo detecta porque registra un `bytesImagenEntrada` fijo (`:569`).
2. **El esquema no pide lo que se quiere medir.** `category` y `scene_role` son texto libre; `quantity`, `observed_colors`, `material`, `shape`, `relationships` y `depth_layer` no están declarados (`additionalProperties: true`). Faltantes se rellenan en silencio: cantidad `1-1`, colores `["color not determinable"]`, densidad `unknown`, confianza 0,45.
3. **Vocabulario grueso.** Arco, guirnalda y columna colapsan en `balloon_structure`, y `centro_mesa` pasa a `tableware`. `visual_semantics.structure_type` existe en el esquema pero nunca se rellena. Los colores son texto libre sin normalizar contra `PALETA_COLORES_V2` (26 colores, `rag/taxonomy/v2.ts:27-54`, con `clasificarColores`).
4. **No se fuerza la llamada a la herramienta** (sin `functionCallingConfig`, `chat.ts:193-202`): si el modelo responde en texto, `extractJson` falla y el análisis devuelve 400.
5. **Límites incoherentes:** 40 elementos por imagen frente a 80 en el esquema; 20 en el prompt frente a cobertura de todos los aprobados (posibles bucles hasta `VUELTAS_MAX = 10`). Una "pared de globos" marcada `backdrop` queda `emulable` y no se puede asignar a una estructura (`restricciones.ts:263`).
6. **Confianza sin uso:** no hay umbral; `include_policy: "ask"` se sobrescribe, `unresolved_decisions` siempre `[]`, `requires_review: false`.
7. **Evaluación inexistente:** `ia:test-referencias-fixture` y `ia:test-referencias-perceptual` simulan la respuesta del proveedor y no miden exactitud. Hay 0 fixtures etiquetados con verdad de referencia.

### D1. Habilitado siempre — `pendiente`

(Reconstruido.) Localizar cada condición de UI o servidor que apaga o salta el análisis de referencias y dejarlo siempre activo cuando el cliente adjunta una referencia, conservando los kill-switches operativos explícitos.

**Condiciones encontradas:** `planDecoracionActivo` empieza en `false` y solo se actualiza desde `/api/ia/salud`; si ese fetch falla se ignora en silencio (`.catch(() => {})`) y la UI se queda en modo legado. Con `PLAN_DECORACION_ENABLED=false` el chat descarta el blueprint. Si el análisis falla, `onReady(false)` deja `esperarReferenciasListas` sondeando **sin límite de tiempo**: el envío del chat se queda colgado hasta que el cliente quita las fotos, y la generación se encola sin fin. Un blueprint inválido en el chat tumba el turno con 502 `INTERNAL_ERROR`.

**Plan:** (1) límite de tiempo y estado de error en `esperarReferenciasListas`: al fallar, aviso `ui-error.v1` con Reintentar análisis y Continuar sin referencia (acción explícita); (2) no ignorar el fallo de `/api/ia/salud`: estado visible y reintento; (3) un blueprint inválido en `/api/chat` degrada de forma observable (turno sin referencia, aviso y log con `request_id`) en vez de 502; (4) prueba e2e con el patrón de A3 (análisis simulado que falla y que tarda) y prueba unitaria del temporizador.

### D2. Línea base medible — `pendiente` (requiere D1)

(Reconstruido.) Conjunto etiquetado de referencias reales con tipo de estructura, conteo, ubicación, colores y densidad, apoyándose en `ia:test-referencias-fixture` e `ia:test-referencias-perceptual`. Métricas: precisión y recall por tipo de estructura, error de conteo, acierto de ubicación y de colores. Registrar modelo, versión del prompt y fecha.

**Plan:** `eval/referencias/v001/` con imágenes con licencia de uso (fotos propias, `src/descarga.jpg` y candidatas del dataset de estructuras LoRA con licencia verificada) y `etiquetas.jsonl` versionado: `{ imagen, estructuras: [{ tipo ∈ TIPOS_ESTRUCTURA, cantidad, ubicacion ∈ UBICACIONES, colores ⊂ PALETA_COLORES_V2, densidad }] }`. Script pagado opcional `scripts/eval-referencias.ts` (fuera de las pruebas rápidas): corre `analizarReferenciasV2`, empareja por tipo (y por caja cuando exista) y calcula precisión y recall por tipo, error absoluto de conteo, acierto de ubicación y de colores (Jaccard sobre la paleta), latencia y tokens. Escribe `docs/mejoras/referencias-metricas-<fecha>.md` con modelo, `ANALYSIS_PARSER_VERSION`, hash del prompt y fecha. Las funciones de métrica son puras y llevan prueba propia.

### D3. Mejoras iterativas — `pendiente` (requiere D2)

Cada una medida contra la línea base: prompt de visión estructurado con esquema estricto y ejemplos; análisis en dos pasadas (detección y verificación por región); confianza por elemento con umbral para pedir confirmación; normalización al vocabulario de estructuras del plan (arco, semiarco, guirnalda, columna, pared, centro_mesa…) y a la paleta del catálogo; detección de colores contra colores reales del catálogo. Conservar una mejora solo si sube la métrica sin empeorar otra más de 2 puntos.

**Orden propuesto, de mayor a menor impacto esperado:** (1) arreglar la auditoría ciega (enviar las imágenes en el segundo turno y registrar los bytes reales); (2) esquema estricto: `structure_type` con enum de `TIPOS_ESTRUCTURA`, `quantity` numérica, `observed_colors` con enum de la paleta, `ubicacion`, `density` y `symmetry`, y llamada a herramienta forzada (modo ANY); (3) normalización con `clasificarColores` y `normalizarTipoEstructura`; (4) umbral de confianza que llene `unresolved_decisions` y pida confirmación al cliente; (5) verificación por región en la segunda pasada; (6) alinear límites (40/80/20) y permitir asignar una pared de globos a una estructura.

### D4. Del reconocimiento al plan — `pendiente` (requiere D3)

Una referencia confirmada se convierte en estructuras y colores que `confirmar_plan_decoracion` usa (`referencia_element_id`), con productos reales del catálogo y cotización por el backend Python. Test end-to-end: foto, blueprint, plan con `approval_token` e imagen generada coherente con la referencia (QA visual).

**Plan:** llevar `structure_type`, caja y colores normalizados al bloque de referencia del prompt como sugerencia de `tipo`, `ubicacion` y `materiales.color` por `referencia_element_id`; conservar la geometría de la referencia en `planBlueprint` en vez del layout fijo; excepción de alcance para `balloon_structure` y pared. Prueba e2e con proveedor simulado para la parte determinista y una corrida pagada (máximo 3 imágenes) para la coherencia visual.

### D5. Documentación — `pendiente` (requiere D4)

Resultados en `docs/mejoras/` (métricas antes y después) y, si cambia la arquitectura, un ADR en `docs/architecture/decisions/`.

## Batería final

Debe pasar antes de terminar; se reporta la salida real.

- `npm run contracts:check`, `contracts:test`, `contracts:test:domain`, `contracts:test:python-adapter`
- `npm run plan:test`, `plan:test-paridad-python`
- `npm run rag:test-allowlist`, `rag:test-open-intent`
- `npm run ia:test-lora-compiler`, `ia:test-lora-preflight-barrido`, `ia:test-plan-lora-e2e`, `contracts:test:ui-error`
- `npm run lint`, `npm run build --workspaces --if-present`, `npm run build`, `npx tsc --noEmit`, `git diff --check`
- En `services/ai-api`: `pytest`, `ruff check`, `ruff format --check`, `mypy app scripts`
- Smoke en vivo: `npm run smoke:rutas-python-local -- --phase=python-on --state "$env:TEMP\demo-cutover-local\smoke-state.json"`

## Registro de vueltas

| Vuelta | Fecha | Ítem | Resultado |
| --- | --- | --- | --- |
| 1 | 2026-09-14 | A1 | Inventario completo (tablas arriba). Consultas a `plan_audit_log`, `rag_query_log` y `ai_call_log` locales. A2 en espera por agente concurrente en archivos LoRA. |
| 2 | 2026-09-14 | A3 (casi completo) + planes de A4, A5, B, C1, C3, D | Contrato `ui-error.v1`, traductor, aviso con acciones y cableado en chat, plan-editar, referencias y `page.tsx`. `generate/route.ts` en espera (el agente concurrente lo editó a las 12:23 y 12:34). Tres exploraciones de solo lectura produjeron los planes detallados y el inventario visual. Nuevo bloqueo de producto en B2 (uso de LoRA para el cliente final). |
| 3 | 2026-09-14 | A3 | `/api/generate` migrado a `ui-error.v1`. `plan:test` completo en verde tras actualizar `rag:test-allowlist`. 14 PASS en vivo. A3 `hecho`. Los archivos LoRA parecen libres (scripts `tmp-*` borrados), así que la próxima vuelta retoma A2. |
| 4 | 2026-09-14 | A2 | Barrido 1920→3840 escenas: 68 fallos de longitud → 0 (compilador v2.5). `LORA_PLAN_REQUIRED` / `ESTILO_REQUIERE_PROPUESTA` para selecciones sin plan. Par lateral con `repeticiones: 2` (causa de `placement failure EST_02_COLUMNAS#2`): QA real `false` → `true`. Gasto: 1 turno de chat, 2 imágenes LoRA, 2 QA. |
| 5 | 2026-09-14 | A4 | Detector único, `mensaje_cliente` en cada rechazo, restricciones en español de cliente, prompt corregido. Evaluación real 10/10 sin jerga (`gemini-3.6-flash`, prompt `05c5ba3132639b5b`). Corregido "me enredé" con plan verificado. Hallazgos de bucles (cardinalidad y tamaños) pasados a A5. Gasto: 10 conversaciones (≈16 turnos). |
| 6 | 2026-09-14 | A5 | `PLAN_SIN_GLOBOS` por categoría del catálogo con exenciones explícitas; cardinalidad por instancias y respetando composición o presupuesto del cliente. En vivo: XV años ya lleva arco de globos; "2 arcos y 3 columnas" sin rechazos de cardinalidad. Nuevo ítem A6 (bucles por tamaños faltantes). Gasto: 2 conversaciones. |
| 7 | 2026-09-14 | A6 | Medición: `organica_fina` solo cabe en el 18 % de los productos. Opción B (tamaños disponibles y mezclas compatibles en `SIN_COBERTURA`) no bastó; la causa principal era el color literal ("azul rey" frente a `azul`). Canonización de colores en la frontera: 5 casos de 54 a 45 herramientas, `SIN_COBERTURA` de 12 a 2, "corporativo" de 21 a 6. Evaluación completa detenida por falta de memoria; se usó un subconjunto liviano. Gasto: 10 conversaciones. |
| 8 | 2026-09-14 | B1 (+ ajuste pendiente de A6) | Switch accesible usuario/dev con `useSyncExternalStore`, persistencia y `?dev=1/0`; detalles técnicos del aviso atados al modo. 12 PASS en navegador. Prompt: "techo/límite" → "presupuesto". Sin gasto de proveedores. |
| 9–10 | 2026-09-14 | B2 | Reglas por modo (QA obligatorio y estilo por capacidad en modo usuario) y ocultamiento de controles y datos técnicos en `page.tsx` y la tarjeta del plan. 25 PASS en navegador tras corregir un script colgado. Jerga restante en la tarjeta anotada para C2 (archivo en uso por otro agente). Sin gasto de proveedores. |
| 11 | 2026-09-14 | B3 | e2e `ui:e2e-modo-vista` en el repo con fixture versionada: 32 PASS. Frente B completo. Sin gasto de proveedores. |
| 12 | 2026-09-14 | C1 + C2 (página) | 8 capturas "antes" (4 estados × 1280/400, modo usuario), sin desbordamiento horizontal; ruido concreto listado. C2 en `page.tsx`: sin encabezado redundante, una sola acción de aprobación, barra lateral sin textos contradictorios; e2e 32 PASS. Workflow de solo lectura del frente D lanzado en segundo plano. |

# Decision log

## 2026-08-13 — baseline local

- Canal: terminal.
- Acción: inspección read-only del repo y archivos de agente.
- Resultado: app Next.js 16.3.0 ya contiene chat, RAG, referencias, generación y QA; no existe
  dataset LoRA versionado. Se preservan cambios previos sin commit.
- Coste: USD 0.
- Error: comandos PowerShell directos no funcionan bajo proxy `rtk`; se usó `rtk powershell.exe`.

## 2026-08-13 — documentación técnica

- Canal: navegador.
- Acción: revisión de documentación oficial de fal.ai, Replicate y Hugging Face.
- Resultado: matriz y ADR provisional creados; no se creó cuenta ni se aceptaron términos.
- Coste: USD 0.
- Decisión: `fal.ai` candidato provisional; estado central conserva proveedor `null`.

## 2026-08-13 — salvaguardas locales

- Canal: terminal/código.
- Acción: creación de requisitos, configuración dev sin secretos, logs, riesgos, rollback y
  estructura de dataset.
- Resultado: CP-01 sigue pendiente; ningún recurso externo fue creado o modificado.
- Coste: USD 0.

## 2026-08-13 — ingesta Sempertex

- Canal: terminal/código local.
- Acción: se procesaron 25 imágenes de `data/raw/sempertex-v01` con Pillow 12.3.0.
- Resultado: 25 licencias `.license.json`, 25 copias PNG sin metadata EXIF, 0 corruptas y 0 duplicadas.
- Coste: USD 0; sin API ni subida externa.
- Decisión: no hacer upscaling automático. 10 imágenes de baja resolución se retiraron del dataset
  activo y se movieron a cuarentena recuperable; 15 quedaron aprobadas estructuralmente.

## 2026-08-13 — limpieza solicitada

- Canal: terminal/código local.
- Acción: mover 10 imágenes con lado corto menor a 1024 px, junto con sus licencias, a
  `data/quarantine/sempertex-v01-low-resolution/`.
- Resultado: dataset activo contiene 15 imágenes; manifiesto regenerado; rollback posible desde cuarentena.
- Coste: USD 0. No hubo borrado permanente ni subida externa.

## 2026-08-13 — captions y partición

- Canal: terminal/código local + revisión visual.
- Acción: captions en inglés con trigger `eventdecor_style_v1`; partición por grupo de escena.
- Resultado: 15 captions, `train=9`, `validation=2`, `test=4`, sin fuga de grupos.
- Coste: USD 0; no se envió dataset a proveedor externo.
- Estado: captions quedan en `draft_visual_review`; falta revisión humana de muestra antes del training.

## 2026-08-13 — autoauditoría de captions

- Canal: revisión local automática + inspección visual.
- Resultado: estructura y splits pasan; no hay PII, URLs, secretos ni fuga de grupos.
- Hallazgos: 2 correcciones P2 (`img-0003`, `img-0014`) y 2 mejoras P3.
- Decisión: no modificar automáticamente; captions siguen en `draft_visual_review`.

## 2026-08-13 — corrección post-auditoría

- Canal: terminal/código local.
- Acción: corregir inferencias visuales en `img-0003`, `img-0013` e `img-0014`.
- Resultado: 15 captions válidas, trigger único, splits intactos y sin PII; queda solo mejora
  estilística no bloqueante y revisión humana de muestra.

## 2026-08-13 — preflight de training dev

- Canal: terminal/código local + documentación oficial del proveedor.
- Acción: seleccionar fal.ai + `FLUX.2 [dev]`, limitar a 300 pasos y máximo USD 2.
- Resultado: ZIP local creado con 15 PNG y 15 `.txt`; coste teórico publicado USD 1.92.
- Bloqueo: falta `FAL_KEY` dev, cuenta dev y verificación de crédito; no se subió ZIP ni se creó job.
- Fuente: [fal.ai FLUX.2 Trainer V2](https://fal.ai/models/fal-ai/flux-2-trainer-v2).

## 2026-08-13 — envío de training dev

- Canal: Chrome/sesión del usuario en fal.ai.
- Acción: cargar `data/staging/dataset-decoration-v001-fal.zip` y enviar `fal-ai/flux-2-trainer-v2` con 300 pasos, learning rate `0.0001` y caption por defecto `eventdecor_style_v1`.
- Resultado visible: fal.ai mostró `Training submitted`; todavía no aparece request ID en Training History/Requests.
- Coste estimado: USD 1.92; saldo observado antes y después: USD 10.00.
- Decisión: no reenviar para evitar doble cobro; queda pendiente confirmación del backend.

## 2026-08-14 — verificación posterior del training

- Canal: Chrome/sesión actual del usuario en fal.ai.
- Observación: Training History y Requests no muestran registros visibles; el saldo sigue en USD 10.00 y el uso del mes en USD 0.00.
- Evidencia previa: captura del usuario con solicitud `019ffdd2a-c56d-7d42-9748-54dcd629c770` en estado `In Progress`.
- Decisión: estado final no verificable desde la sesión actual; no crear una segunda solicitud.

## 2026-08-14 — training completado

- Canal: Chrome/sesión correcta `davidtheran03` en fal.ai.
- Resultado: request `019ffd2a-c56d-7d42-9748-54cdd629c770` en estado `Completed`, código 200, duración 800.53 s.
- Configuración confirmada: 300 pasos, learning rate `0.0001`, `eventdecor_style_v1`.
- Coste observado en dashboard: USD 1.93; saldo restante: USD 8.07.
- Artefactos publicados: `pytorch_lora_weights.safetensors` y archivo de configuración; inferencia aún no ejecutada.

## 2026-08-14 — configuración de inferencia v001

- Canal: Chrome/sesión correcta + configuración local.
- Acción: preparar `fal-ai/flux-2/lora` con el LoRA completado, prompt fijo `prompt-001`, escala 1.0, guidance 2.5, seed 42, 28 pasos, una imagen y streaming desactivado.
- Resultado: formulario configurado; no se ejecutó inferencia ni se consumió crédito adicional.
- Artefacto: `configs/lora/inference-v001.yaml`.

## 2026-08-14 — selector LoRA en la pantalla principal

- Canal: terminal + navegador integrado.
- Decisión: añadir `LoRA Sempertex` al mismo selector visual sin convertirlo en proveedor de chat; Gemini/OpenAI siguen gestionando la conversación.
- Integración: la selección envía `usarLora` al endpoint de imágenes y usa `fal-ai/flux-2/lora` con el trigger `eventdecor_style_v1`; requiere `FAL_KEY` server-side.
- Seguridad/coste: no se ejecutó ninguna generación durante esta modificación; no hubo consumo adicional.
- Validación: opción visible y seleccionable en el navegador integrado; TypeScript sin errores; lint sin errores, con el warning previo documentado arriba.

## 2026-08-14 — corrección del límite de entradas LoRA

- Observación: la app mostraba `Approved scene needs 4 image inputs, provider limit is 0` al generar una propuesta con cuatro productos.
- Causa: el adaptador LoRA no recibe imágenes, pero el validador común interpretaba ese cero como bloqueo de los productos aprobados.
- Corrección: el LoRA conserva los productos en el prompt textual y no envía sus imágenes a fal.ai; las ediciones con foto de espacio o referencias siguen requiriendo Gemini/OpenAI.
- Coste: no se ejecutó una nueva generación durante la corrección.
- Validación: TypeScript sin errores, lint sin errores con el warning previo y `git diff --check` correcto.

## 2026-08-14 — integración en la aplicación

- Canal: terminal + navegador integrado.
- Acción: detener el servidor anterior del proyecto en el puerto 3000, levantar `npm run dev` y abrir `http://localhost:3000`.
- Resultado: HTTP 200; la app muestra el estado `LoRA Sempertex` y la ruta `/configuracion-lora` con los parámetros de inferencia.
- Validación: lint sin errores; permanece un warning previo en `src/lib/ia/analizar-referencias-v2.ts`.

## 2026-08-18 — se retira OpenAI del proyecto

- Canal: terminal + navegador integrado.
- Acción: eliminar por completo la integración de OpenAI (chat e imagen), incluyendo la máscara real de inpainting construida ese mismo día para corregir distorsión de geometría en fotos de espacio.
- Resultado: Gemini queda como único proveedor de chat/imagen; `tsc` y `lint` sin errores nuevos; generación real probada con Gemini tras el cambio.
- Coste: sin generación de imagen adicional durante la eliminación.
- Consecuencia directa: la máscara real solo existía vía la API de edición de OpenAI. Gemini no ofrece máscara real fuera de Vertex AI/Imagen 3 (`editImage`), que requiere proyecto de Google Cloud con facturación propia — verificado en vivo que el `GEMINI_API_KEY` actual (Google AI Studio) no da acceso a esos modelos.

## 2026-08-18 — mitigación solo-Gemini para foto de espacio

- Canal: terminal + navegador integrado.
- Acción: activar encadenamiento multi-turno real (`previous_interaction_id`/`store` de la API de interacciones de Gemini) y reescribir el prompt de preservación de venue con una instrucción concentrada de "edición local", en vez de la lista larga de "Preserve X." usada antes.
- Resultado: verificado en vivo interceptando `fetch` — la request de una revisión envía el `previousInteractionId` real de la generación anterior y la respuesta devuelve uno nuevo. No es una garantía pixel-perfecta como la máscara real; es una mejora de contexto/prompt, no una restricción forzada.
- Decisión explícita del usuario: no montar Vertex AI/Imagen 3 por ahora (evita infraestructura de Google Cloud nueva).

## 2026-08-18 — niveles de presupuesto para LoRA de edición futuro

- Canal: investigación web + documento de plan.
- Acción: definir 3 niveles de presupuesto (COP 30.000 / 70.000 / 100.000–200.000, tasa ≈ COP 3.130/USD) para un futuro entrenamiento LoRA orientado a edición/preservación de espacio real, comparando FLUX Kontext (`fal-ai/flux-kontext-trainer`, edición por instrucción con pares antes/después) contra un posible trainer de edición nativo de FLUX.2 (`fal-ai/flux-2-trainer-v2/edit`, formato aún sin confirmar) y contra inpainting con máscara real de la línea FLUX.1 (compatibilidad con LoRA de FLUX.2 sin confirmar).
- Resultado: documentado en `docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v001.md` §9. Ningún entrenamiento se ejecutó ni se gastó presupuesto real.
- Nota honesta incluida en el plan: el costo de la corrida en sí es bajo en las tres opciones; el presupuesto mayor compra más experimentos/iteración de dataset, no "más calidad" por sí solo.

## 2026-08-21 — se reemplaza el plan de entrenamiento v001 por v002 con presupuesto real de US$70

- Canal: investigación web (papers + documentación oficial fal.ai/FLUX.2) + terminal + navegador integrado.
- Acción: a petición explícita del usuario, se eliminó `docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v001.md` y las 3 propuestas PDF asociadas (v06/v07/v10, sin versionar en git, no recuperables) — el LoRA de prueba de 15 imágenes que documentaban ya no se va a usar. Se creó `PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md` desde cero con presupuesto real de US$70 (no niveles a elegir) y los 5 temas objetivo: Halloween, Navidad, bodas, cumpleaños infantil, día del amor y la amistad.
- Decisión de arquitectura: 1 LoRA base "Sempertex style" + 5 LoRAs de acento pequeños por tema, compuestos en inferencia vía el arreglo `loras` que ya existe en `sempertex-lora.ts` (antes con una sola entrada) — evita el *concept bleeding* de mezclar 5 temas en un solo entrenamiento (arXiv 2606.03792).
- Decisión sobre tamaño de globos: la medida absoluta (pulgadas exactas) no se entrena — ya vive correctamente como texto/metadata (`tamano_codigo`) y así se queda (arXiv 2503.06884, los modelos de difusión no cuentan/miden de forma confiable con o sin más datos). La proporción relativa entre tamaños sí se entrena, pero dentro del LoRA base con fotos donde varios tamaños de globo aparecen juntos en el mismo cuadro — no como LoRA aparte.
- Decisión de proceso: la selección de imágenes se hace a mano, no con los scripts `select-sempertex-training-products.ts`/`select-sempertex-final-training-dataset.ts` — esos scripts sí se corrigieron a nivel de código pero no se van a ejecutar.
- Corrección de datos encontrada en el camino: `forma` mezclaba shape (redondo/corazón/link/modelar) con acabado/categoría (metalizado, plano) en `derivar.ts`, `consultas.ts`, `herramientas.ts` y los dos scripts de selección — "metalizado" ya tenía hogar correcto en `categoria: globo_metalizado`, y "plano" (patrón `AxB CM`) resultó ser empaque/bolsas de regalo, no un globo en absoluto (verificado contra `data/demo.sqlite`). Se corrigió en los 5 archivos; de paso se arregló un bug real y activo (`LOL-660` decodificaba como 660" de diámetro en vez de 6"×60") y se agregaron los temas `boda`/`amor_amistad` a los clasificadores (antes inexistente/fusionado con "coquette").
- Prueba empírica en vivo: prompt de texto detallado a Gemini (sin LoRA, sin foto de referencia) pidiendo recrear el producto real "E-DECOR NEON" (bouquet: base compacta + globos en cordones hacia arriba) — resultado: dos masas de globos separadas en el piso, sin la estructura de cordones/cascada. Confirma que acabado (Fashion/Reflex/Silk) y formato de armado (arco/guirnalda/bouquet/semi arco) son ejes que necesitan fotos reales en el LoRA base, no solo descripción por texto — se agregó al §7 del plan.
- Decisión sobre foto de espacio: confirmado en código (`generate/route.ts`, `usarLora && venue → error`) que el LoRA de estilo no soporta ni soportará foto de espacio — es una tarea de edición/preservación, no de generación desde cero, y ya estaba identificada por separado como el LoRA de edición futuro (entrada del 18 de agosto). Gemini sigue siendo el único proveedor para ese caso; no se tocó ese código.
- Coste: US$0 — ningún entrenamiento real se envió a fal.ai todavía.

## 2026-08-22 — implementación end-to-end del plan de tamaños

- Canal: terminal/código local + PostgreSQL de desarrollo.
- Acción: se implementó la ruta opt-in `PlanDecoracion`: contratos y hash, geometría por estructura con reparto Hamilton tamaño × color, resolución contra whitelist, consolidación de paquetes/merma, desglose previo a la imagen, blueprint por ubicación, BOM/cotización con tamaños reales y coherencia prompt ↔ plan.
- Resultado: `npm run plan:test`, `npm run plan:test-pg`, `npm run plan:eval`, typecheck, lint y build pasan. La evaluación determinística cubrió 12 briefs contra un producto real de PG con 7 diámetros: 12/12 cobertura y coherencia; ahorro medio de 2,42 paquetes por consolidación.
- Decisión histórica: `PLAN_DECORACION_ENABLED=false` era el default inicial para rollback seguro y `IMAGE_QA_VISION` era el alias de QA visual.
- Resolución vigente (2026-09-10): RAG y `PLAN_DECORACION_ENABLED` quedan activos por defecto; `IMAGE_QA_ENABLED=false` es el default de QA y `imageQaRequested=true` es la solicitud explícita. Un resultado `unknown` nunca se reporta como aprobado.
- Coste: US$0; no se llamó a un proveedor de imágenes durante la evaluación.

## 2026-09-14 — el ahorro por merma del estimado solo cuenta compras de globo

- Canal: terminal/código local, sin base de datos ni proveedores.
- Problema: `material_estimate.totals.waste_only_savings_cop` (`src/lib/materiales/estimacion.ts`, `totals()`) aplicaba la fórmula por línea de compra (`ceil(ceil(diseño × (1 + MERMA)) / paquete) − ceil(diseño / paquete)`) a todas las compras. En el vector dorado `09-a5-linea-no-geometrica` el telón (1 unidad, 1 por paquete, 20.000 COP) reportaba 20.000 COP de "ahorro por evitar paquetes solo de merma", mientras `plan_resuelto.totales.waste_only_savings_cop` del mismo plan era 0. La ruta de medidas tenía el mismo defecto: un corazón foil de 5.000 COP daba 5.000 COP. Python (`services/ai-api/app/plan.py`) reproducía el defecto por paridad.
- Evidencia de dominio (merma solo para globos): `MERMA` se define como "revientes al inflar y al montar" (`src/lib/cotizacion/constantes.ts:2`) y la tarjeta la muestra como "merma por reventones al inflar/montar" (`src/components/TarjetaCotizacion.tsx:130`); `resolver.ts` solo reparte reserva a compras con `diam_pulg != null` (`eligible`, línea 601), solo compra paquetes adicionales para ellas (línea 609) y calcula `costoIngenuoConMerma` filtrando `linea.diam_pulg != null` (líneas 653-658); `purchaseLines` usa `eligible: esGlobo` (`estimacion.ts`) y `target_waste_reserve` del estimado solo suma `balloons`; `AQUI.md:19` ("Merma aplica solo a líneas físicas de globo") y `PLAN-COMPOSICION-RICA-V001.md:856-857` ("calabazas, manteles y velas no reciben merma de globos"). No se encontró ninguna fuente que asigne merma a elementos no geométricos. El único consumidor del campo es el log de depuración `formatMaterialEstimateLog`; `validateMaterialEstimate` lo recalcula y bloquea si no coincide.
- Decisión: nueva función `wasteOnlySavingsCop(balloons, special_elements, purchases)` en `estimacion.ts`, usada por `totals()`, con redondeo único al final. Una compra es elegible si su variante no es un `special_element` y su variante o su producto aparece en `balloons`. El producto cubre la ruta de medidas, donde el optimizador puede comprar otra presentación de paquete de la misma familia de globo que la variante que recibió la demanda. Python replica la regla en `_material_waste_only_savings(balloons, special, purchase_lines)`. La regla se deriva de las líneas del propio estimado porque `design-material-estimate-v1` no guarda la elegibilidad por compra; así `validateMaterialEstimate` recalcula lo mismo para estimados TypeScript y Python.
- Alternativas descartadas: (1) solo `variant_id` en `balloons`: deja fuera la presentación alternativa de la ruta de medidas; (2) excluir solo variantes en `special_elements`: los props de Plan 1.1 no aparecen en las líneas del estimado y volverían a recibir ahorro; (3) añadir `waste_eligible` a cada compra: cambio de contrato versionado con impacto en esquemas, modelos generados, mapper y todos los vectores, desproporcionado para esta corrección; (4) unificar con la fórmula de `plan_resuelto.totales`: son dos definiciones distintas (ver A2 en `docs/migracion-python/PLAN-PARIDAD-Y-ACTIVACION.md`).
- Límite conocido: un prop de Plan 1.1 que sea globo y cuyo producto no aparezca en ninguna estructura no suma ahorro (el resolutor sí le reparte reserva). Python solo resuelve Plan 1.0, así que no afecta a la paridad. Condición de retirada de la derivación: una versión del contrato que lleve la elegibilidad explícita por compra.
- Consecuencias: el vector `09` pasa de 20.000 a 0 en `expected.material_estimate.totals.waste_only_savings_cop` y en `expected_python.material_estimate.totals.waste_only_savings_cop`; los vectores 01-08 quedan byte a byte iguales. TypeScript y Python deben desplegarse juntos: `validateMaterialEstimate` compara el total recalculado en Next con el que envía Python, así que una versión mezclada rechazaría estimados que tengan compras no globo con ahorro distinto de 0.
- Rollback: revertir `wasteOnlySavingsCop` en `estimacion.ts` y `_material_waste_only_savings` en `plan.py` a la fórmula sobre todas las compras, y regenerar el vector `09` con `--update` y `PARIDAD_ACTUALIZAR=1`. No hay datos persistidos que migrar: el campo se calcula en cada resolución.
- Validación: `npm run plan:test-paridad` 9/9, `npm run plan:test-paridad-python` 9/9, `npm run plan:test`, `pytest tests/test_plan_parity.py tests/test_plan.py` (25 passed), `ruff check`, `ruff format --check`, `mypy app scripts`, `npx tsc --noEmit` y `eslint` sobre los archivos TypeScript cambiados.

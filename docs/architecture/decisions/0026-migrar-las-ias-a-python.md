# ADR-0026 — Migrar las 5 IAs generativas a Python, una por una

Date: 2026-09-22
Status: accepted (Fases 1-5 — Inari, Amaterasu, Uzume, Kagutsuchi, Happie —
implementadas; Omoikane quedó fuera de este ADR y se resolvió en ADR-0027)
Supersedes: nothing. Aplica el mismo principio de ADR-0023/0025 a un dominio
distinto (llamadas a proveedor, no reglas comerciales).

## Problem

Tras nombrar las 5 IAs generativas del repo (ADR-0025: Omoikane, Inari,
Amaterasu, Kagutsuchi, Uzume) más Watatsumi ya en Python, quedó una
inconsistencia visible: Watatsumi es la única que corre en el servicio Python
(`services/ai-api`); las otras cinco llaman a su proveedor (Gemini o fal.ai)
directo desde Next.js/TypeScript. Se decidió que ninguna IA generativa debía
seguir corriendo fuera de Python.

Migrar 5 módulos de golpe —especialmente Omoikane, el chat con streaming SSE y
un bucle de tool-calling de hasta 10 vueltas— es un proyecto grande y
arriesgado si se hace como una sola pieza. Este repo ya tiene un precedente de
cómo migrar una regla a Python mal: `plan.py` se migró con un flag de
"kill switch" que terminó con dos implementaciones (TS y Python) dando
números distintos en producción — el incidente que llevó a retirar el flag y
dejar a Python como único dueño de una sola vez (ADR-0023 paso 5).

## Decisions

### 1. El corte: TypeScript compone, Python llama al proveedor

En las 4 IAs de request/response simple (Inari, Amaterasu, Uzume, Kagutsuchi),
Python solo recibe el prompt/schema/imágenes ya armados y hace la llamada de
red al proveedor — nada de construcción de prompt, caché, fallback de
catálogo o interpretación de negocio se duplica en Python. Ver la tabla
completa y el detalle por IA en el plan de implementación (conversación
2026-09-22); el principio es el mismo que ya usa este repo para no tener dos
dueños de una regla (AGENTS.md, "Give every business rule one authoritative
owner").

### 2. Corte gradual por capacidad, nunca permanente

Cada IA tiene su propio flag (`INTENT_PARSER_PYTHON_ENABLED`, y los
equivalentes de las 3 fases siguientes), default OFF, combinado con
`seleccionarBackendPython().backend === "python"` — mismo patrón que
`RAG_RERANK_ENABLED`. El flag apagado ES el kill switch mientras se valida.
Una vez encendido y validado en producción, la implementación TypeScript
directa se borra en un cambio separado — nunca conviven las dos
indefinidamente. No se reintroduce un kill switch genérico aparte (el que
existía para `plan.py` fue retirado deliberadamente); cada flag de capacidad
cumple ese rol mientras dura la validación de su propia fase.

### 3. Sin contrato Zod↔Pydantic para operaciones simples

El pipeline `domain-v1.ts` → `contracts:export:domain` → `generate_models.py`
está pensado para contratos grandes reusados en varios lugares (plan
resuelto, recomendaciones de catálogo). Para una operación de una sola IA con
forma simple, se sigue el precedente ya existente de `rerank`/`embed`: un
modelo Pydantic definido junto a la operación (`app/<ia>/...py`) y un
schema Zod de validación de respuesta definido localmente en
`python-adapter.ts`, sin pasar por el generador. El *schema* que constriñe la
salida del modelo generativo (cuando aplica, como en Inari) viaja en el
payload de la petición en vez de vivir duplicado en Python — Python queda
agnóstico de esa forma.

### 4. Orden: las 4 simples primero, Omoikane aparte

Inari → Amaterasu → Uzume → Kagutsuchi. Omoikane queda fuera de este ADR: no
es "portar una llamada", es un problema de diseño nuevo (cómo streamear un
turno de tool-calling desde Python manteniendo el contrato `chat.sse.v1` que
ya ve el navegador). Se planea aparte cuando las 4 anteriores estén validadas.

## Fase 1 — Inari (implementada)

- `services/ai-api/app/inari/parse.py`: `interpretar_consulta_gemini` hace la
  única llamada a Gemini (`client.aio.models.generate_content`) con el prompt
  y el `response_schema` que TypeScript ya envía; nada de la lógica
  determinista (`interpretarConsultaDeterminista`, `mergeGeminiIntent`) se
  tocó ni se duplicó.
- Endpoint `POST /internal/v1/ia/intent-parse`, scope `ia.intent_parse`,
  reusa el boundary operacional existente (`_handle_operational_request`) sin
  cambios.
- `src/lib/ia/inari/parse.ts` gana una rama: si el parse local no es
  `"certain"` y el flag+backend seleccionan Python, llama
  `llamarPythonIntentParse` (nuevo en `python-adapter.ts`); si no, sigue el
  camino directo a Gemini sin cambios. El resultado remoto pasa por el mismo
  `mergeGeminiIntent` de siempre.
- Detalle de compatibilidad encontrado al implementar: el SDK Python
  (`google-genai` instalado) no tiene `ThinkingLevel`/`thinking_level` como el
  SDK JS — se usa `thinking_config=types.ThinkingConfig(thinking_budget=0)`
  como equivalente de `ThinkingLevel.MINIMAL`. Tampoco existe
  `response_json_schema` como parámetro; el campo correcto es
  `response_schema`, que acepta un `dict` crudo.
- **Hallazgo importante, verificado en vivo contra Gemini el 2026-09-22, no
  solo con `types.Schema.model_validate` (que no detectó el segundo punto —
  falló recién en la llamada real)**: el JSON Schema draft-7 real que exporta
  Zod (`z.toJSONSchema`, el mismo que ya usa el SDK JS en producción sin
  problema) no es compatible tal cual con `response_schema` en el SDK/API
  Python. Tres patrones fallan y `paraGoogleSchema` en `inari/parse.ts` los
  adapta antes de mandar el schema a Python:
  1. `$schema` en la raíz — rechazado como campo desconocido.
  2. `additionalProperties` (lo agrega `.strict()` de Zod) — la API de Gemini
     rechaza la request entera con "additional_properties parameter is not
     supported", incluso con valor `false`.
  3. Un enum numérico (`diametros_pulgadas`, que Zod representa como `anyOf`
     de ramas `{type, const}` porque `z.enum` solo admite strings) — el campo
     `enum` de Google solo acepta strings; un enum numérico se queda solo con
     su `type`, sin la restricción de valores (el texto del prompt ya dice
     los diámetros permitidos, y un valor fuera de rango sigue fallando
     `IntentQuerySchema.parse` del lado TypeScript, cayendo al mismo fallback
     que cualquier otra salida malformada).

  **Esto aplica a Amaterasu, Uzume y Kagutsuchi también** (las tres siguen
  usando Gemini): cualquier schema/tool declaration que se les mande desde
  TypeScript necesita pasar por el mismo tipo de adaptación antes de llegar a
  Python. No asumir que un schema que funciona en el SDK JS funciona igual en
  el SDK Python sin probarlo en vivo.
- Verificado: `pytest`/`ruff`/`mypy` en `services/ai-api` (219 tests, 0
  errores); `npx tsc --noEmit` y `npm run lint` en el árbol completo (0
  errores, mismas 38 advertencias preexistentes); suite del adaptador
  (`npm run contracts:test:python-adapter`) con el nuevo caso de Inari; y una
  llamada real de punta a punta contra Gemini el 2026-09-22 (Python real,
  schema real de `IntentQuerySchema`, respuesta real re-validada con
  `IntentQuerySchema.parse` del lado TypeScript) — así se encontraron los tres
  problemas de compatibilidad del schema descritos arriba.
  Pendiente de quien lo despliegue: correr `scripts/eval/eval-query-parser.ts` /
  `eval-query-parser-v2.ts` / `eval-tamanos.ts` con el flag encendido contra
  un Python real y comparar contra el flag apagado, con más variedad de casos
  que la prueba manual de esta sesión, antes de activar el flag por defecto.

## Fase 2 — Amaterasu (implementada)

- `services/ai-api/app/amaterasu/turno.py`: `ejecutar_turno_gemini` hace el
  turno de tool-calling que antes hacía `ChatPort.turno()` directo contra
  Gemini (`packages/agente-core/src/gemini/chat.ts`), acotado a la forma real
  que usa Amaterasu — un único mensaje de usuario con imágenes y texto, nunca
  historial multi-turno, porque cada una de las dos pasadas ("inventory" y
  "audit") es una llamada nueva e independiente, no una conversación. Nada de
  la caché/dedupe en vuelo, el atajo de la galería, `buildBlueprint`,
  `catalogFallback`, `resolveBillOfMaterials` ni el reintento por formato
  malformado se tocó — siguen en `analizar-referencias-v2.ts` sin cambios.
- Endpoint `POST /internal/v1/ia/reference-turn`, scope `ia.reference_turn`,
  con un límite de cuerpo propio de 11MB (`max_body_bytes_imagenes`) en vez
  del límite de 64KB que comparten el resto de operaciones — las fotos de
  referencia llegan hasta 3 imágenes bajo el mismo tope de 10MB que Next ya
  exige del lado del navegador (`LIMITE_CUERPO_ANALISIS_BYTES`).
- `src/lib/ia/amaterasu/chat-python.ts`: `crearChatTurnoPython` implementa
  `ChatPort` respaldado por ese endpoint. Valida que el `historial` recibido
  sea exactamente un mensaje de usuario (lanza un error claro si no — nunca
  intenta adivinar un caso multi-turno que no está implementado) y traduce
  errores del adaptador Python a las mismas causas de `ErrorIA` que ya
  produce el adaptador directo de Gemini, para que el resto del código
  (`registrarGemini`, el reintento por formato malformado) no note la
  diferencia. `turnoStream()` no está implementado — lanza explícitamente
  en vez de fingir soporte; Amaterasu nunca lo llama.
- Diferencia aceptada y documentada frente al camino TypeScript: la instancia
  `ChatPort` de Gemini deduplica bytes de imagen entre la pasada de
  inventario y la de auditoría (un `WeakSet` propio de esa instancia); el
  `ChatPort` respaldado por Python no tiene esa sesión, así que reenvía las
  imágenes completas en ambas pasadas — más ancho de banda por análisis vía
  Python, sin cambiar lo que el modelo ve ni el resultado.
- `src/app/api/references/analyze/route.ts`: flag propio
  `REFERENCE_ANALYSIS_PYTHON_ENABLED` (+`seleccionarBackendPython()`) decide
  entre `chatDe(id)` (directo) y `crearChatTurnoPython(...)` antes de llamar
  a `analizarReferenciasV2` — la función de negocio en sí no sabe ni le
  importa cuál de los dos recibió.
- **Tres hallazgos reales, encontrados igual que en la Fase 1 (con una
  llamada real, no solo con tipos)**: (1) `Blob.data` del SDK Python espera
  `bytes` crudos, no el string base64 que sí acepta `inlineData.data` en JS
  — hay que decodificar explícito. (2) `finish_reason`/`block_reason` llegan
  como enums (`FinishReason.STOP`), no como string plano; `str(enum)` da
  `"FinishReason.STOP"` en vez de `"STOP"` — hace falta leer `.value`.
  (3) Una imagen de prueba corrupta a mano (un base64 mal transcrito, NO un
  problema del sistema) produjo el mismo error confuso
  ("Unable to process input image") que ya había aparecido con una imagen de
  1×1 píxel genuinamente degenerada — la lección operativa es generar/leer
  la imagen de prueba en tiempo de ejecución, nunca pegarla a mano.
- Verificado: `pytest`/`ruff`/`mypy` en `services/ai-api` (228 tests, 0
  errores, 9 nuevos de Amaterasu); `npx tsc --noEmit` y `npm run lint` en el
  árbol completo (0 errores, mismas 38 advertencias preexistentes); suite del
  adaptador con el nuevo caso de reference-turn; tests unitarios de
  `chat-python.ts` (`npm run ia:test-amaterasu-chat-python`, agregado a
  `plan:test`); y una corrida real de punta a punta el 2026-09-22 —
  `analizarReferenciasV2` sin modificar, con una foto real del repo, contra
  el servicio Python real y Gemini real, con las dos pasadas completas —
  que devolvió 5 elementos correctamente detectados y aprobados
  (guirnalda de globos, backdrop, mesa de postres, confeti, instalación
  aérea). Pendiente de quien lo despliegue: la misma comparación
  flag-encendido-vs-apagado con más casos reales antes de activar por
  defecto.

## Fase 3 — Uzume (implementada)

- **Hallazgo que cambió el alcance de esta fase**: la llamada que usa
  `crearImagenGemini` no es `models.generateContent` (la de Inari/Amaterasu)
  sino la **Interactions API** (`client.interactions.create`, con
  `store`/`previous_interaction_id` para encadenar turnos de verdad). Esa API
  es tan nueva (fechada 2026 en el propio SDK JS) que **el SDK Python
  instalado (`google-genai==1.21.1`) no la tenía en absoluto** —
  `hasattr(client.aio, "interactions")` daba `False`. No fue un problema de
  nombres de campo como en las fases anteriores; la funcionalidad
  simplemente no existía en esa versión.
- **Se subió `google-genai` de 1.21.1 a 2.24.0**, lo que a su vez forzó subir
  `pydantic` de 2.10.4 a 2.12.5 (`google-genai>=2.24.0` requiere
  `pydantic>=2.12.5`, y `uv lock` lo rechazó hasta hacerlo). Antes de aceptar
  el cambio se corrió la suite completa de Python (242 tests) y una llamada
  real a Inari para confirmar que el salto de versión no rompía nada ya
  enviado (Watatsumi, Inari, Amaterasu) — todo siguió pasando sin tocar una
  línea de esos tres módulos.
- `services/ai-api/app/uzume/interaction.py`: `crear_interaccion_gemini` hace
  la llamada `client.aio.interactions.create(...)` que antes hacía
  `crearImagenGemini` directo. El array `input` (bloques de texto/imagen ya
  etiquetados con rol y uso permitido) viaja completo desde TypeScript — este
  módulo nunca decide para qué sirve una imagen de referencia, solo la manda.
- Endpoint `POST /internal/v1/ia/image-generate`, scope `ia.image_generate`,
  mismo límite de cuerpo de 11MB que Amaterasu (hasta 14 imágenes de entrada).
- `src/lib/ia/uzume/imagen-python.ts`: `crearImagenGeminiPython` implementa
  `ImagenPort` con la misma forma pública que `crearImagenGemini` — el resto
  de la app no nota la diferencia. Clasifica errores leyendo `domainCode`
  (el código de dominio que puso Python, ej. `image_generate_quota`) para
  reportar la misma causa (`sin_llave`/`cuota`/`filtrado`/`timeout`) que
  reportaría una falla directa contra Gemini — sin esto, el flag habría
  cambiado silenciosamente la experiencia de error del cliente.
- `src/lib/ia/nucleo/registro.ts`: a diferencia de Amaterasu (que ramificó en la
  ruta HTTP porque `chatDe()` también sirve a Omoikane), el flag de Uzume
  vive dentro de `imagenDe()` mismo — es el único punto de entrada para
  generación de imagen y ninguna otra IA lo usa, así que no hacía falta
  duplicar la rama en cada llamador (`generate/route.ts` y
  `laboratorio-referencias/route.ts`).
- Verificado: `pytest`/`ruff`/`mypy` en `services/ai-api` (242 tests, 0
  errores, 14 nuevos de Uzume); `npx tsc --noEmit` y `npm run lint` en el
  árbol completo (0 errores, mismas 38 advertencias preexistentes); suite del
  adaptador y tests unitarios de `imagen-python.ts`
  (`npm run ia:test-uzume-imagen-python`, agregado a `plan:test`); y tres
  llamadas reales de punta a punta el 2026-09-22: (1) generación directa sin
  imágenes de entrada, (2) generación con una foto de referencia real,
  (3) una cadena de dos llamadas con `previous_interaction_id` para confirmar
  que el encadenamiento multi-turno funciona de verdad contra la API real —
  las tres a través de `crearImagenGeminiPython().generar()`, el mismo código
  que usaría producción, no una prueba aislada del módulo Python. Pendiente
  de quien lo despliegue: la misma comparación flag-encendido-vs-apagado con
  más casos antes de activar por defecto.

## Fase 4 — Kagutsuchi (implementada)

- Python porta el `submit -> poll -> download` completo contra la cola de
  fal.ai que hacía `generarConSempertexLora` directo: el guard SSRF
  (`isAllowedFalQueueUrl`/`isAllowedFalImageUrl` → `_is_allowed_queue_url`/
  `_is_allowed_image_url`), el manejo manual de redirects (`fetchFalAllowed`
  → `_fetch_allowed`/`_download_bounded_image`, mismo tope de 4 saltos), la
  descarga acotada a 16MB, y la clasificación de cuenta rechazada
  (401/402/403 → `saldo_agotado`/`acceso_denegado`). TypeScript sigue armando
  el prompt final (`buildLoraEditPrompt`, `ensureLoraTriggers`), decidiendo
  qué referencias van a `/edit` (`referenciasParaLoraEdit`) y calculando
  tamaño/guidance (`imageSizeFor`, `guidanceScaleSeguro`) — Python recibe todo
  eso ya resuelto en el payload (`mode: "text"|"edit"`, `prompt`, `loras`,
  `guidance_scale`, `num_inference_steps`, `image_width`/`image_height`,
  `seed?`, `image_data_urls`) y no decide nada de negocio.
- `services/ai-api/app/kagutsuchi/lora.py` + `POST /internal/v1/ia/lora-generate`
  (scope `ia.lora_generate`, mismo límite de cuerpo de 11MB que Amaterasu/Uzume
  — hasta 4 imágenes para `/edit`). A diferencia de Inari/Amaterasu/Uzume
  (que llaman a un SDK), este módulo habla `httpx` puro contra la cola REST de
  fal.ai, así que reimplementa el guard SSRF en vez de heredarlo de un cliente.
- **El propio fal.ai puede tardar hasta 105s** (submit + poll cada 1.5s +
  descarga) — el mismo presupuesto que ya gastaba el camino directo dentro de
  la llamada `/api/generate` que ve el navegador. El techo compartido del
  boundary Next↔Python (`DEADLINE_MAX_MS`, antes 75_000) no alcanzaba para
  eso, así que se subió a **110_000** en `src/lib/ia/contracts/operational-v1.ts`
  (`DEADLINE_DEFAULT_MS` sigue en 75_000: ninguna otra operación pide más que
  el default, así que esto no cambia su comportamiento) y se regeneró el
  contrato (`npm run contracts:export:domain` →
  `uv run --directory services/ai-api python scripts/generate_models.py`).
  Kagutsuchi es la única llamada que pide explícitamente
  `deadlineMs: 110_000`; todas las demás operaciones no lo tocan.
- **`ProveedorImagenNoDisponibleError` debe seguir siendo esa clase exacta**:
  `traducir-error-servidor.ts` la reconoce por `instanceof`, no por mensaje,
  para mapear a `VISTA_PREVIA_NO_DISPONIBLE`. Eso obligó a extender el
  adaptador compartido con dos campos genéricos nuevos en `PythonAdapterError`
  — `providerStatus`/`providerDetail` — poblados desde
  `detail.provider_status`/`detail.provider_detail` (mismo mecanismo que ya
  usaba `attempts` para los reintentos de embeddings), y a extender
  `_detail_metadata` en `main.py` para dejarlos pasar del lado Python. Sin
  esto, Python solo podía comunicar su propio código/estado HTTP (502/503),
  perdiendo el 401/402/403 *real* que fal.ai devolvió — necesario para
  reconstruir el mensaje y el `.status` que espera esa clase.
  `errorDeAdaptadorLora` (`sempertex-lora.ts`, exportada para prueba directa)
  hace esa reconstrucción; cualquier otro código de dominio se vuelve un
  `Error` genérico, igual que ya hace hoy el camino directo para sus propios
  `new Error("fal.ai ...")`.
- El branch vive **dentro de `generarConSempertexLora` mismo**
  (`sempertex-lora.ts`), no en un archivo/puerto separado como Amaterasu o
  Uzume: a diferencia de esas dos, Kagutsuchi no tiene una interfaz de
  proveedor intercambiable (`ChatPort`/`ImagenPort`) que ya separara la
  composición de la llamada, y la composición (`buildLoraEditPrompt` y
  compañía) usa funciones privadas del mismo archivo. Meter la rama en un
  archivo nuevo habría creado un import circular; el mismo patrón que ya usa
  Inari (`enriquecerConGeminiPython` vive en `parse.ts`, no en un archivo
  aparte) resultó ser el precedente correcto, no el de Amaterasu/Uzume.
- Verificado: `pytest`/`ruff`/`mypy` en `services/ai-api` (264 tests, 0
  errores, 22 nuevos de Kagutsuchi — 20 del módulo + 2 de boundary en
  `test_main.py`); `npx tsc --noEmit` y `npm run lint` en el árbol completo (0
  errores, mismas 38 advertencias preexistentes); suite del adaptador
  (`llamarPythonLoraGenerate`, incluida la propagación de
  `providerStatus`/`providerDetail`) y `sempertex-lora-python.test.ts`
  (`npm run ia:test-kagutsuchi-lora-python`, agregado a `plan:test`); y dos
  llamadas reales el 2026-09-23 contra `generarConSempertexLora()` sin
  modificar, con el flag encendido y el servicio Python local corriendo
  (`--reload`, ver nota abajo): (1) modo texto sin imágenes — 18s, imagen PNG
  de 2.3MB devuelta; (2) modo `/edit` con una foto real de venue — agotó el
  techo de 105s (`lora_timeout`, 504), el mismo comportamiento que ya tendría
  el camino directo con esa misma solicitud lenta, no una regresión. Ambas
  usaron un peso LoRA real ya entrenado y subido a fal.ai (v007), así que solo
  costaron inferencia, no entrenamiento.
- **Encontrado durante la verificación en vivo, no un bug de producto**: las
  llamadas de Kagutsuchi salen por `httpx` puro (a diferencia de
  Inari/Amaterasu/Uzume, que van por el SDK `google-genai`), y en esta
  máquina el bundle de certificados de `certifi` no reconoce la CA con la que
  la red corporativa reendosa TLS para `fal.media` — el mismo problema de
  certificados locales que documenta la sección "Running locally" de este
  archivo para `uv`. `_default_client()` usa `truststore.SSLContext(...)`
  (no `truststore.inject_into_ssl()`, que parchea `ssl.SSLContext` para todo
  el proceso) para que ese único cliente valide contra el almacén de
  certificados del sistema operativo en vez del bundle de `certifi` — mismo
  patrón que ya usa `scripts/eval_rerank.py`.
- **Repetido el hallazgo de la Fase 2**: varios procesos `python.exe`
  huérfanos de corridas anteriores de `--reload` seguían escuchando en el
  puerto 8000 y sirvieron código viejo durante buena parte de la depuración
  en vivo, hasta matarlos todos por PID y arrancar limpio. Mismo síntoma que
  ya describe la Fase 2 de este documento para Amaterasu — vale la pena
  revisar `netstat`/`tasklist` antes de desconfiar del propio código cuando
  un cambio "no toma efecto".
- **Pendiente antes de activar el flag**: la misma comparación
  flag-encendido-vs-apagado con más casos reales (`scripts/test-lora-*.ts`,
  `test-fal-sin-saldo.ts`) que las fases anteriores dejaron pendiente, más
  confirmar si 105s alcanza en la práctica para `/edit` con carga real de
  fal.ai o si ese presupuesto necesita revisarse — la llamada (2) de arriba
  sugiere que puede ser ajustado, no que esté roto.

## Fase 5 — Happie (implementada, sin prueba en vivo)

Happie no estaba entre las 6 IAs nombradas del ADR-0025 y se encontró el
2026-09-24 buscando llamadas directas a proveedores que hubieran quedado fuera:
el chat del webhook de Happia (`src/lib/happie/conversacion-webhook.ts`) y el
recomendador de paquetes (`packages/happie-package-ia/src/recomendador.ts`)
creaban cada uno su propio `new GoogleGenAI(...)`. Las dos son llamadas de
salida estructurada con la misma forma que Inari (un mensaje de usuario con
partes de texto, instrucción de sistema, schema, `ThinkingLevel.MINIMAL`,
25 s, un solo intento), así que comparten una operación.

- `services/ai-api/app/happie/generacion.py`: `generar_happie_gemini` hace la
  llamada. `POST /internal/v1/ia/happie-generate`, scope `ia.happie_generate`,
  `purpose: "conversation_extract" | "package_recommend"` (solo para distinguir
  las dos en logs; no cambia la llamada). Límite de cuerpo propio de 4MB
  (`MAX_BODY_BYTES_HAPPIE`): el recomendador manda el catálogo activo de Happia
  como JSON y no cabe en los 64KB de las demás operaciones de texto. El tamaño
  real del catálogo no se midió todavía; 4MB es un techo, no una medición.
- El paquete no puede importar código de `src` (AGENTS.md), así que gana un
  puerto: `GenerarEstructurado` (`recomendarPaquetes*({ generar })`). Sin
  valor, el paquete usa `crearGeneradorGemini(apiKey)`, que es exactamente la
  llamada directa de antes. Prompt, schema y el filtro anti-ids-inventados
  siguen en el paquete en los dos caminos.
- La app inyecta `generadorHappiePython` (`src/lib/happie/generador-python.ts`)
  cuando `HAPPIE_PYTHON_ENABLED` está encendido: en las tres rutas del
  recomendador vía `iaRecomendacionHappie` y en el extractor del chat, que
  ahora también pasa por el puerto y dejó de importar `@google/genai`.
- `paraGoogleSchema` salió de `inari/parse.ts` a `src/lib/ia/nucleo/esquema-google.ts`
  para que Inari y Happie adapten el schema igual.
- `x-correlation-id` del cliente externo solo se adopta si es UUID
  (`correlacionValida`): el boundary Python lo exige, y el camino directo no.
- Cambio de comportamiento pequeño, en los dos caminos: un abort se reporta en
  telemetría por su causa (`signal.reason`) y no por el error con que lo
  envuelva el proveedor. Antes un timeout propio podía quedar como
  `cancelado`.
- Verificado: `pytest`/`ruff`/`mypy` (294 tests), `tsc`, `lint`,
  `happie:test-webhook`, `plan:test` con el nuevo
  `happie:test-generador-python`, y la envoltura en
  `contracts:test:python-adapter`. **No se hizo la llamada real** flag
  encendido vs. apagado (se pospuso el 2026-09-24): es lo que sigue antes de
  poder encender el flag, junto con medir el tamaño real del catálogo. El
  schema de extracción usa `.nullable()` (`anyOf` con `type: null`), un
  patrón que las fases anteriores no probaron en `response_schema` de Python.

## Consequences

- Cada fase agrega un flag más a `feature-flags.ts`; se retiran cuando su
  fase hace el cutover final (borra la rama TypeScript directa), así que la
  lista no crece indefinidamente.
- El servicio Python gana una dependencia de runtime más por fase (ninguna
  nueva en la Fase 1: `google-genai` ya estaba instalado para Watatsumi;
  Kagutsuchi usa `httpx`, que ya estaba instalado, y `truststore`, que ya era
  dependencia de test). `FAL_KEY` resultó no necesitar configuración nueva:
  `.env.local` ya lo tenía para Next.js, y el arranque local de Python
  (`uv run --env-file ../../.env.local`) lee el mismo archivo.
- La Fase 3 subió `google-genai` (1.21.1→2.24.0) y, en cascada, `pydantic`
  (2.10.4→2.12.5) en todo `services/ai-api` — no solo para Uzume. Es un
  cambio real de infraestructura compartida, no algo local a un módulo;
  quedó verificado (242 tests + una llamada real a Inari) antes de aceptarlo,
  pero cualquiera que revise este ADR debe saber que las Fases 1-2 corren hoy
  sobre una versión de SDK distinta a la que tenían cuando se escribieron.
- La Fase 4 subió `DEADLINE_MAX_MS` de 75_000 a 110_000 en
  `operational-v1.ts` — el techo compartido de TODO el boundary Next↔Python,
  no algo local a Kagutsuchi. `DEADLINE_DEFAULT_MS` (75_000) no cambió, así
  que ninguna operación existente pide más deadline del que ya pedía; solo
  Kagutsuchi pasa `deadlineMs: 110_000` explícito. El contrato
  `operational-context.v1` se regeneró (`contracts:export:domain` +
  `generate_models.py`) para que Python acepte ese máximo nuevo.
- El adaptador compartido (`PythonAdapterError`) gana dos campos genéricos —
  `providerStatus`/`providerDetail` — pensados para que un error de dominio
  Python comunique el status/detalle *original* del proveedor cuando difiere
  del status HTTP que usa el boundary para esa respuesta. Kagutsuchi es el
  primer consumidor (`ProveedorImagenNoDisponibleError` necesita el 401/402/403
  real de fal.ai, no el 503 genérico del boundary), pero el mecanismo es
  reusable por cualquier fase futura con la misma necesidad.
- Mientras una fase esté con el flag apagado (default), el comportamiento es
  bit a bit el mismo que antes de este ADR — no hay riesgo de producción por
  mergear una fase con su flag en OFF.
- Con Kagutsuchi implementado, las 4 fases simples (Inari, Amaterasu, Uzume,
  Kagutsuchi) están todas construidas y verificadas, todas con su flag en OFF
  por defecto. Omoikane queda fuera de este ADR (ver sección 4 de
  Decisions); su migración, con el boundary de streaming que necesitaba, está
  en ADR-0027.

## Rollback

Por fase: apagar el flag de esa capacidad vuelve al camino TypeScript directo
sin tocar código. Una vez borrada la rama TypeScript (tras el cutover), la
recuperación es desplegar la revisión anterior de ambos servicios — mismo
texto que ya documenta `resolver-backend.ts` para la resolución de plan.

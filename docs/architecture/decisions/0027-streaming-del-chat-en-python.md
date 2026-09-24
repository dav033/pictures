# ADR-0027 — El turno del chat (Omoikane) corre en Python, streameado

Date: 2026-09-23
Status: accepted (implementado detrás de `CHAT_PYTHON_ENABLED`, apagado por
defecto)
Supersedes: nothing. Cierra lo que ADR-0026 dejó fuera de alcance a propósito
("Omoikane se planea aparte").

## Problem

Con las cuatro fases de ADR-0026 hechas, Omoikane —el chat del cliente— era la
única IA generativa que seguía llamando al proveedor desde TypeScript. No se
podía portar como las otras cuatro porque esas son *request → una llamada →
response*, y el boundary Next↔Python (`_handle_operational_request` /
`llamarPythonOperacion`) está hecho para eso: un cuerpo JSON al final.

El chat, en cambio:

- streamea tokens al navegador mientras Gemini los genera (`chat.sse.v1`);
- corre un loop de tool-calling de hasta 10 vueltas (`ejecutarConversacionStream`
  en `packages/agente-core/src/ejecutar.ts`), y cada vuelta es un stream propio;
- en modelos "thinking", cada llamada a herramienta trae un `thoughtSignature`
  que hay que devolver intacto en la vuelta siguiente, o Gemini rechaza el
  turno ("missing thought_signature").

## Decisions

### 1. El corte es por vuelta, no por conversación

Se mantiene el principio de ADR-0026 ("TypeScript compone, Python llama al
proveedor"), aplicado a una vuelta del loop a la vez. Quedan en TypeScript,
sin cambios: el loop de herramientas, el SSE hacia el navegador, el prompt de
sistema, las declaraciones de herramientas y sus handlers, el cierre
anticipado y la telemetría (`registrarLlamadaIA` en el loop). Lo único que
cambia es de dónde saca cada vuelta sus fragmentos: un `ChatPort` nuevo,
`crearChatGeminiPython` (`src/lib/ia/omoikane/chat-python.ts`), cuyo
`turnoStream()` llama a Python en vez de a `@google/genai`.

Alternativa descartada: mover el loop completo a Python. Implicaba portar los
handlers de herramientas y su estado (`registro-herramientas.ts`,
`convergencia-plan.ts`), con reglas de negocio en dos idiomas durante la
migración — exactamente lo que ADR-0023 prohíbe.

### 2. Un boundary de streaming, hermano del existente

`_handle_operational_stream` (`services/ai-api/app/main.py`) comparte la
admisión con el boundary de siempre —se extrajo a `_admit_operational_request`:
límite de cuerpo, HMAC, schema, hash firmado del cuerpo, scope y deadline— y
responde NDJSON (`application/x-ndjson`), un evento por línea:

- `text {delta}`, cero o más;
- exactamente un terminal: `end {text, tool_calls, usage_metadata, model,
  finish_reason, block_reason}` o `error {code, phase, provider_status?,
  provider_message?}`.

Garantías del lado Python: si el generador termina sin terminal, el boundary
agrega un `error` (`internal_error`); el deadline firmado se aplica a cada
evento (`deadline_exceeded`); un fallo antes de abrir el stream (sin
`GEMINI_API_KEY`, `contents` ilegibles) es un error HTTP común, no un stream.
Del lado TypeScript (`leerPythonNdjson` + `llamarPythonChatTurnStream` en
`python-adapter.ts`): cada línea se valida con Zod, un stream sin terminal o
con una línea malformada es `PYTHON_INVALID_RESPONSE`, y se deja de leer en
cuanto llega el terminal. `llamarPythonOperacion` y el streaming comparten
`abrirPeticionPython` (firma, headers, mapeo de errores HTTP).

NDJSON y no SSE entre servidores: el único consumidor es Next, que ya arma su
propio SSE hacia el navegador; NDJSON no necesita parser de frames ni
reconexión, y cada línea es un JSON validable por sí solo.

**Sin idempotencia.** La ruta rechaza un `idempotency_key`
(`idempotency_not_supported`, 422) en vez de ignorarlo: repetir una vuelta ya
streameada duplicaría texto que el cliente ya vio y un cobro del proveedor.

### 3. `contents` los arma TypeScript

TypeScript manda los `contents` de Gemini tal como los arma
`historialAContents` (`@sempertex/agente-core/gemini`): camelCase, imágenes en
base64 con su etiqueta `[IMAGEN_ID=…]`, `functionCall` con `id` y
`thoughtSignature`, `functionResponse` agrupadas. Python los valida con el
propio `types.Content.model_validate` del SDK. Así la traducción del historial
—incluida la regla de no reenviar imágenes ya enviadas en vueltas anteriores—
sigue teniendo un único dueño. Verificado antes de construir (spike
2026-09-23): el SDK Python 2.24 acepta ese JSON y decodifica el base64 de
`inlineData.data` y `thoughtSignature` a `bytes`; Python devuelve las firmas
en base64 y el ida y vuelta entre vueltas funciona contra la API real.

### 4. Los errores del proveedor se clasifican en un solo lugar

Python no clasifica: manda `provider_status` y `provider_message` originales,
y TypeScript reconstruye un `ApiError({message, status})` y lo pasa por el
mismo `categorizarError` del camino directo (`errorIADeEvento`). Qué es
reintentable, qué es contenido filtrado y qué es una imagen rechazada
(`AI_IMAGE_REJECTED`) no se duplica en Python — a diferencia de Uzume
(ADR-0026, Fase 3), que tiene su propia copia de las reglas por substring.

### 5. Reintento solo al abrir, decidido en TypeScript

Cada error trae `phase`: `open` mientras no llegó ningún chunk del proveedor,
`stream` después. El `ChatPort` reintenta con el mismo `conReintento` del
camino directo, solo para errores `open` que `categorizarError` marque como
reintentables, y nunca después del primer evento. Es la misma ventana que
cubría `conReintento` alrededor de `generateContentStream`. Python nunca
reintenta, así que no hay dos políticas de reintento superpuestas.

### 6. Cancelación de punta a punta

Si el navegador se va, la ruta cierra el generador del loop → el `ChatPort`
cierra el generador del adaptador → el adaptador cancela el lector del cuerpo,
lo que cierra la conexión → Starlette detecta la desconexión y cancela el
stream → el `finally` de `_events` cierra el stream del SDK. Probado con una
desconexión ASGI real (`test_chat_stream_disconnect_closes_the_event_generator`)
y con la cancelación del cuerpo del lado TypeScript. Esto es cancelación
*local*: no hay confirmación de que Gemini haya dejado de generar del lado del
proveedor.

### 7. El flag vive en `chatOmoikaneDe()`, no en `chatDe()`

`chatDe()` también lo usa Amaterasu (ADR-0026, Fase 2). El flag
`CHAT_PYTHON_ENABLED` se lee en un punto de entrada propio,
`chatOmoikaneDe()` en `src/lib/ia/registro.ts`, que solo llama `/api/chat`.
La lectura de `GEMINI_CHAT_THINKING_LEVEL` sigue en un único lugar para ambos
caminos. La tabla de errores de transporte que ya usaba Amaterasu se movió a
`src/lib/ia/error-ia-python.ts` para compartirla, en vez de copiarla.

### 8. Límite de cuerpo de 25 MB, solo en esta ruta

`/api/chat` ya acepta 25 MB del navegador (foto del espacio + referencias). Con
el límite de 11 MB de las rutas de imágenes, chats que hoy funcionan fallarían
en el salto Next→Python, así que la ruta tiene su propio techo
(`MAX_BODY_BYTES_CHAT` / `PYTHON_MAX_BODY_BYTES_CHAT`).

## Verificación (2026-09-23)

- Python: 283 tests (19 nuevos: 13 del módulo, 6 del boundary, incluida la
  desconexión ASGI real); `ruff` y `mypy` limpios.
- TypeScript: `npx tsc --noEmit`, `npm run lint` (mismas 38 advertencias de
  base), la suite del adaptador (`contracts:test:python-adapter`, con
  content-type, línea malformada, stream sin terminal y lectura después del
  terminal) y `npm run ia:test-omoikane-chat-python` (9 tests, agregado a
  `plan:test`): deltas y fin, ida y vuelta de la firma y deduplicación de
  imágenes entre vueltas, reintento de un 429 al abrir, imagen rechazada sin
  reintento, error a mitad del stream sin reintento, stream truncado, sin
  llave, y cancelación del cuerpo al cortar antes del final.
- En vivo contra Gemini real:
  1. El `ChatPort` solo, dos vueltas: la vuelta 1 llamó una herramienta con
     firma, la vuelta 2 aceptó la firma devuelta y streameó la respuesta.
  2. El `POST` real de `src/app/api/chat/route.ts` (sin el middleware de
     sesión) con el flag encendido y apagado, mismo mensaje: en ambos, SSE
     200, 10 eventos, 5 deltas, `guardar_brief` y `buscar_catalogo_rag`
     ejecutadas con `ok=true`, `fin` con productos reales del catálogo; con el
     flag apagado Python no recibió ninguna llamada de chat. Latencia de esa
     única muestra: 9.3 s vía Python, 6.8 s directo — una sola corrida por
     lado, no una medición.

## Consequences

- El servicio Python gana su primer camino de streaming; cualquier operación
  futura que necesite streamear reutiliza `_handle_operational_stream` y
  `leerPythonNdjson` en vez de inventar otro transporte.
- Cada vuelta del chat suma un salto de red Next→Python. El costo de latencia
  no está medido todavía; decide el cutover.
- Con el flag encendido, las cinco IAs generativas pueden correr en Python.
  Con el flag apagado (default), `/api/chat` es bit a bit el camino anterior.

## Pendiente antes de encender el flag

- Medir latencia (p50/p95 del turno completo) con flag encendido vs apagado
  sobre los diálogos de `scripts/eval-chat-thinking.ts`, no con una muestra.
- Correr la misma comparación flag-on/off con conversaciones de varias vueltas
  que usen imágenes y `ajustar_plan_decoracion`.
- Probar el chat en el navegador con una sesión real (la verificación de arriba
  invoca el handler directo porque la app exige login).

## Rollback

Apagar `CHAT_PYTHON_ENABLED` vuelve al `ChatPort` directo sin tocar código.
Cuando se borre el camino directo (después del cutover), la recuperación es
desplegar la revisión anterior de ambos servicios, igual que ADR-0026.

# Superficie externa por endpoint (Fase 4.5)

Inventario de las 51 rutas bajo `src/app/api/**/route.ts` (confirmado con
`Glob`, no un conteo heredado). El gate global es `src/proxy.ts`
(convención real de Next.js 16.3.0, verificada en
`node_modules/next/dist/build/utils.js`): exige una cookie de sesión
derivada de `APP_PASSWORD` para toda ruta que NO empiece por uno de los
prefijos de su `matcher` — `api/login`, `api/happie/recommend-packages`,
`api/happie/recommend-package`, `api/happie/webhook`, `api/rag/webhooks/shopify`.
No se imprime ningún valor de secreto en este documento, solo nombres de
variables.

## Rutas excluidas del gate de `proxy.ts` (necesitan su propia autenticación)

| Ruta | Métodos | Bajo el gate de `proxy.ts`? | Autenticación adicional propia | CORS | Rate limit | Credencial/secreto | Qué expone |
|---|---|---|---|---|---|---|---|
| `/api/login` | POST | No (es la ruta que emite la cookie) | Compara `password` del body contra `APP_PASSWORD` con `!==` (`src/app/api/login/route.ts:38`) — **no es constant-time** | Sin CORS explícito | **Ninguno encontrado** — sin límite de intentos por IP/sesión | `APP_PASSWORD` | Emite la cookie de sesión de toda la app si la contraseña coincide |
| `/api/happie/recommend-packages` | POST, OPTIONS | No | `x-api-key` contra `HAPPIE_EXTERNO_API_KEY` con `===` (`src/lib/happie/cors-externo.ts:35`) — **no es constant-time** | Sí: `Access-Control-Allow-Origin` reflejado solo si el `Origin` está en la whitelist `HAPPIE_EXTERNO_ORIGENES` (`cors-externo.ts:18-27`); la key en sí NO exige que el `Origin` coincida (CORS es solo una barrera de navegador, no server-to-server) | **Ninguno encontrado** (`src/lib/happie/recomendar-paquetes-externo.ts:10-22`) | `HAPPIE_EXTERNO_API_KEY`; transitivamente `GEMINI_API_KEY`, `HAPPIA_API_KEY` vía `generarRecomendacion` | Hasta 3 recomendaciones de paquetes Happie por solicitud, con llamadas reales a Happia y Gemini |
| `/api/happie/recommend-package` | POST, OPTIONS | No | Igual que arriba, mismo mecanismo | Igual que arriba | **Ninguno encontrado** | Igual que arriba | 1 recomendación por solicitud, mismo camino de proveedor |
| `/api/happie/webhook/chat` | POST | No | `x-api-key` contra `HAPPIE_WEBHOOK_API_KEY` con `timingSafeEqual` (`src/lib/happie/recomendar-paquetes-webhook.ts:12-16,38-50`) — sí es constant-time | Sin CORS (server-to-server) | Sí, vía `webhook-control.ts`: 30/min por credencial, idempotencia por hash de body, límite de body 32 KB, timeout 60 s | `HAPPIE_WEBHOOK_API_KEY`; transitivamente `GEMINI_API_KEY` | Chat multi-turno server-to-server con Gemini para un consumidor externo |
| `/api/happie/webhook/recommend-package` | POST | No | Igual que `webhook/chat` (`clavesIguales`/`timingSafeEqual`) | Sin CORS | Igual (30/min, idempotencia, límites de `webhook-control.ts`) | `HAPPIE_WEBHOOK_API_KEY`; transitivamente `GEMINI_API_KEY`, `HAPPIA_API_KEY` | 1 recomendación server-to-server |
| `/api/happie/webhook/recommend-packages` | POST | No | Igual que arriba | Sin CORS | Igual | Igual | Hasta 3 recomendaciones server-to-server |
| `/api/rag/webhooks/shopify` | POST | No | Firma `X-Shopify-Hmac-Sha256` verificada contra el body crudo con `SHOPIFY_WEBHOOK_SECRET` (`src/lib/rag/webhooks/verificar.ts`, invocada en `route.ts:23`) | Sin CORS (server-to-server) | **Ninguno encontrado** — mitigado en la práctica porque una firma inválida ya corta la solicitud antes de tocar DB | `SHOPIFY_WEBHOOK_SECRET`, `DATABASE_URL` | Ingesta/actualización del catálogo RAG a partir de eventos de producto de Shopify |

## Rutas bajo el gate de `proxy.ts` sin autenticación adicional

Confirmado por grep (`Access-Control-Allow-Origin|x-api-key|rateLimit|timingSafeEqual|...`)
sobre todo `src/app/api/**`: **ningún** archivo `route.ts` fuera del grupo
de arriba implementa CORS, rate limit o una autenticación distinta a la
cookie de `proxy.ts` — ni siquiera las rutas `admin/*` tienen un gate de
rol separado; usan la misma `APP_PASSWORD` compartida que el resto de la
app (no hay usuarios individuales ni roles).

Las 44 rutas restantes comparten exactamente el mismo perfil —
**"Sí" bajo el gate, "Ninguna adicional — depende solo del gate de
proxy.ts", "Sin CORS explícito (mismo origen por defecto)", "Ninguno
encontrado"** — y se listan agrupadas por lo único que realmente varía:
qué credencial/proveedor usan y qué exponen.

### Llaman a un proveedor de pago directamente (mayor superficie de gasto)

| Ruta | Métodos | Credencial/secreto | Qué expone |
|---|---|---|---|
| `/api/chat` | POST | `DATABASE_URL`; `GEMINI_API_KEY` (chat + herramientas + embeddings de retrieval) | Turno de chat completo del armador de decoraciones, con tool-calling sobre el catálogo real |
| `/api/generate` | POST | `DATABASE_URL`, `GEMINI_API_KEY` (imagen + QA visual), `FAL_KEY` (si el modo LoRA activo lo requiere), `PLAN_APPROVAL_SECRET` (verifica el token de aprobación) | Genera la imagen final de una propuesta ya aprobada — el gasto de imagen real de la app |
| `/api/references/analyze` | POST | `GEMINI_API_KEY` (visión) | Analiza imágenes de referencia subidas por el cliente y devuelve el blueprint estructurado |
| `/api/debug/lora-prompt-compare` | POST | `GEMINI_API_KEY` y/o `FAL_KEY` según el modo comparado | Herramienta de comparación de prompts LoRA — nombre "debug" pero sin gate distinto al resto de la app |
| `/api/lora/trainings/[id]/start` | POST | `FAL_KEY` | **Dispara un entrenamiento LoRA real y facturable en fal.ai** (sube dataset, encola el job) — el endpoint de mayor costo unitario de toda la superficie |
| `/api/plan-editar` | POST | `DATABASE_URL`; `GEMINI_API_KEY` transitivamente (embeddings de `buscarCatalogoRag` si la rama vectorial está activa) | Busca/reemplaza/agrega piezas de un plan de decoración ya resuelto |

### Solo Postgres / catálogo local, sin proveedor de pago

`/api/productos`, `/api/productos/[id]`, `/api/decoraciones`,
`/api/decoraciones/[id]`, `/api/catalogo/piezas`, `/api/catalogo/imagenes`,
`/api/shopify/sync` (dispara una resincronización manual del catálogo
contra Shopify — usa credenciales de Shopify de solo lectura del catálogo,
no `SHOPIFY_WEBHOOK_SECRET`), `/api/laboratorio-referencias`. Credencial:
`DATABASE_URL` (y para `shopify/sync`, la variable de acceso al admin de
Shopify usada por el importador).

### Panel admin de órdenes y LoRA (operación interna, mismo gate compartido)

`/api/admin/arquitectura`, `/api/admin/snapshot`, `/api/admin/ordenes` y
sus 7 subrutas (`[numero]`, `[numero]/foto`, `[numero]/caption`,
`[numero]/recaption`, `[numero]/feedback`, `catalogo-buscar`, `manual`,
`estadisticas`), `/api/lora/overview`, `/api/lora/trainings`,
`/api/lora/trainings/[id]`, `/api/lora/compatibility`,
`/api/lora/artifacts`, `/api/lora/datasets`, `/api/lora/datasets/[id]`,
`/api/lora/datasets/preview`, `/api/lora/modes`,
`/api/lora/dataset-v005`, `/api/lora/dataset-v005/[archivo]`,
`/api/lora/dataset/[archivo]`, `/api/lora/dataset/exportar-seleccion`,
`/api/lora/training-references`, `/api/lora/training-reference-counts`.
Credencial: `DATABASE_URL` y/o acceso a filesystem/artefactos LoRA locales
(`LORA_ARTIFACT_ROOT`); ninguna llama a un proveedor de pago directamente
(el envío real de entrenamiento vive aparte, en `trainings/[id]/start`,
ya listado arriba).

### Preferencias y salud de IA

`/api/ia/proveedor` (cambia el proveedor de IA preferido, guarda una
cookie — no un secreto de proveedor), `/api/ia/salud` (lee el buffer de
telemetría en memoria de `agente-core`, ver Fase 3.12). Ninguno depende
de una credencial de proveedor para responder.

### Ruta interna con nombre engañoso

| Ruta | Métodos | Autenticación adicional propia | Credencial | Qué expone |
|---|---|---|---|---|
| `/api/internal/ai/echo` | POST | **Ninguna** (`src/app/api/internal/ai/echo/route.ts` no tiene ningún chequeo de auth propio dentro del handler) | Ninguna directa; selecciona backend Next/Python según flags, sin tocar proveedores de pago | Endpoint de eco usado para probar el adaptador Next↔Python (`operational.v1`); pese al segmento `internal/` en la URL, no tiene ningún aislamiento adicional — depende exactamente del mismo gate de `proxy.ts` que cualquier otra ruta |

## Hallazgos

- **`/api/lora/trainings/[id]/start` es la ruta de mayor riesgo de gasto de toda la superficie**: dispara un entrenamiento LoRA real y facturable en fal.ai (`src/app/api/lora/trainings/[id]/start/route.ts:78-83`), protegido únicamente por la misma `APP_PASSWORD` compartida que protege leer una lista de productos — sin límite de tasa, sin segunda confirmación, sin rol separado para quien puede iniciar entrenamientos.
- **Comparación de credenciales inconsistente entre los tres mecanismos de API key/password de la app**: el webhook server-to-server de Happie usa `timingSafeEqual` (`recomendar-paquetes-webhook.ts:12-16`, constant-time, correcto); tanto `apiKeyValida` para los endpoints de navegador de Happie (`cors-externo.ts:35`, `===`) como la comparación de `APP_PASSWORD` en `/api/login` (`route.ts:38`, `!==`) usan comparación directa de string — un side-channel de timing teórico contra dos de los tres secretos de acceso de la app.
- **`/api/login` no tiene límite de intentos** (`src/app/api/login/route.ts`): con una única contraseña compartida y sin usuarios individuales, es la superficie de fuerza bruta más directa de toda la app y no tiene ningún throttling, ni por IP ni global.
- **Las rutas `admin/*` no tienen un gate distinto al resto de la app**: no existe ningún concepto de rol o usuario admin — quien tiene `APP_PASSWORD` puede iniciar un entrenamiento LoRA facturable, editar catálogo manual y ver estadísticas de órdenes con la misma contraseña que usa para chatear.
- **`x-api-key` de los endpoints de navegador de Happie (`HAPPIE_EXTERNO_API_KEY`) es válida desde cualquier origen server-to-server**, no solo desde los orígenes de la whitelist de CORS: el CORS solo bloquea navegadores, así que si esa key se filtra (viaja en JS de cliente por diseño, según el propio comentario del código), un atacante puede reutilizarla con `curl` sin que la whitelist de `HAPPIE_EXTERNO_ORIGENES` lo detenga (`src/lib/happie/cors-externo.ts:33-36` no verifica `Origin` para la key, solo para los headers CORS de la respuesta).
- **`/api/rag/webhooks/shopify` devuelve `error.message` crudo en el 500 de error real** (`route.ts:52-57`) — bajo riesgo práctico porque el único consumidor esperado es el reintentador de Shopify, no un navegador, pero es una fuga de detalle interno sin acotar si algún día ese endpoint queda accesible a otro llamador.
- **No hay ningún límite de tasa por IP/sesión en `/api/chat`, `/api/generate` ni `/api/references/analyze`** (confirmado: cero coincidencias de rate-limit en esos tres archivos) — ya señalado por la auditoría 08 (hallazgo f), reconfirmado aquí con evidencia directa de código: cualquiera con `APP_PASSWORD` tiene llamadas ilimitadas a Gemini/fal.ai.

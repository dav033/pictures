# Procedimiento de rotación de secretos (Fase 4.4)

Para cada secreto: qué pasos rotarlo requiere, si romper el servicio
mientras se rota es posible, y si el procedimiento ya se **probó de
verdad** o solo está escrito. Ningún valor de secreto aparece en este
documento — solo nombres de variables y comandos.

## Los 5 que esta app controla por completo (probados el 2026-09-09)

Estos no dependen de ninguna cuenta de proveedor externo: rotarlos es
generar un valor nuevo y ponerlo donde corresponda. `npm run
test-rotacion-secretos` (nuevo, en CI) prueba en memoria — sin tocar
`.env.local`, sin reiniciar ningún servidor — que cada uno de estos
cinco, tras "rotar", rechaza el valor viejo y acepta el nuevo.

| Secreto | Procedimiento | Rompe el servicio mientras rota? | Probado |
|---|---|---|---|
| `APP_PASSWORD` | 1) Generar un valor nuevo (ej. `openssl rand -base64 32`). 2) Actualizar `APP_PASSWORD` en `.env.production` del EC2. 3) Reiniciar el contenedor `demo-decoracion`. | **Sí, para todos los usuarios activos**: la cookie de sesión es `sha256(APP_PASSWORD)` (`src/lib/auth/session.ts`) — rotar invalida automáticamente TODA sesión activa, no hay revocación selectiva. Es el comportamiento correcto de seguridad, pero significa que todo el mundo tiene que volver a iniciar sesión. | Sí — `probarAppPassword()` confirma que `sessionToken(viejo) !== sessionToken(nuevo)` |
| `PLAN_APPROVAL_SECRET` | 1) Generar valor nuevo. 2) Actualizar en `.env.production`. 3) Reiniciar el contenedor. | **Sí, para aprobaciones de plan en vuelo**: cualquier token de aprobación ya emitido (`crearTokenAprobacion`) y no canjeado en `/api/generate` antes de rotar queda inválido — el cliente tendría que volver a aprobar el plan. Ventana de exposición baja porque el token expira solo (`ttlMs`, 24h por defecto) de todas formas. | Sí — `probarPlanApprovalSecret()` confirma que un token firmado con el secreto viejo se rechaza tras rotar, y uno nuevo verifica |
| `SHOPIFY_WEBHOOK_SECRET` | 1) Generar el nuevo secreto **desde el admin de Shopify** (no se puede inventar del lado de la app — Shopify firma con el valor que él mismo genera). 2) Actualizar `SHOPIFY_WEBHOOK_SECRET` en `.env.production` **al mismo tiempo**. 3) Reiniciar el contenedor. | **Sí, si los dos lados no cambian juntos**: mientras Shopify firme con el valor viejo y la app espere el nuevo (o viceversa), todo webhook entrante falla con 401 y Shopify reintenta indefinidamente (ver `src/app/api/rag/webhooks/shopify/route.ts`). No hay forma de rotar sin una ventana de coordinación entre los dos lados. | Sí — `probarShopifyWebhookSecret()` confirma que una firma vieja se rechaza contra el secreto nuevo, y una firma nueva valida. La coordinación con Shopify en sí no se probó (no hay suscripción activa confirmada — ver pregunta abierta 3 de la auditoría 08) |
| `HAPPIE_EXTERNO_API_KEY` | 1) Generar valor nuevo. 2) Actualizar en `.env.production`. 3) Avisar al consumidor de navegador que use la clave nueva (viaja en su JS de cliente, así que también hay que redesplegar ESE lado). 4) Reiniciar el contenedor. | Sí, para el consumidor de navegador mientras no actualice su propio JS con la clave nueva. | Sí — `probarHappieExternoApiKey()` confirma rechazo de la vieja, aceptación de la nueva |
| `HAPPIE_WEBHOOK_API_KEY` | 1) Generar valor nuevo de **al menos 32 bytes** (`LONGITUD_MINIMA_SECRETO` en `recomendar-paquetes-webhook.ts:10` — un valor más corto hace que el webhook completo responda 503 "no configurado", no que falle silenciosamente). 2) Actualizar en `.env.production`. 3) Avisar al backend de Happia del valor nuevo. 4) Reiniciar el contenedor. | Sí, para Happia mientras no actualice su propio lado. | Sí — `probarHappieWebhookApiKey()` confirma 401 con la clave vieja tras rotar, autorización con la nueva, y que el mínimo de 32 bytes es real |

**Nota de proceso para los 5**: todos requieren reiniciar el contenedor
`demo-decoracion` porque leen `process.env.*` una vez que el proceso
arranca — no hay hot-reload de variables de entorno en producción.
`docker stop` + `docker run` (el propio patrón del script de deploy) ya
reinicia el proceso; no hace falta un mecanismo aparte.

## Los 4 que dependen de una cuenta de proveedor externo (procedimiento escrito, prueba pendiente)

Estos no se pueden probar sin generar antes una credencial real en la
consola de cada proveedor — fuera del alcance de lo que se autorizó
en esta entrega (evitar gasto/acceso no coordinado a cuentas de
terceros).

| Secreto | Procedimiento | Rompe el servicio mientras rota? | Estado |
|---|---|---|---|
| `GEMINI_API_KEY` | 1) Crear una key nueva en Google AI Studio / Google Cloud Console (misma cuenta/proyecto de facturación). 2) Actualizar `GEMINI_API_KEY` en `.env.production`. 3) Reiniciar el contenedor. 4) Confirmar con una llamada real que la key nueva funciona. 5) Revocar la key vieja. | Se lee en ~10 puntos del código (`src/lib/gemini.ts`, `packages/agente-core/src/gemini/chat.ts`, `src/lib/ia/gemini/imagen.ts`, `src/lib/rag/embeddings.ts`, `src/lib/happie/conversacion-webhook.ts`, `packages/happie-package-ia/src/recomendador.ts`), todos vía `process.env` en tiempo de ejecución — un reinicio del contenedor basta, no hay caché de proceso más allá de eso. Riesgo real es de disponibilidad si se revoca la vieja ANTES de confirmar que la nueva funciona. | Procedimiento escrito; **prueba real pendiente de acceso a la cuenta de Google/Gemini** |
| `FAL_KEY` | 1) Crear key nueva en el dashboard de fal.ai (mismo team de facturación — ver hallazgo de Fase 4.2 sobre el correo de esa cuenta, ya redactado del repo). 2) Actualizar en `.env.production`. 3) Reiniciar. 4) Confirmar con una generación real de bajo costo. 5) Revocar la vieja. | Superficie más acotada que Gemini (2 archivos: `src/lib/ia/sempertex-lora.ts`, `src/app/api/lora/trainings/[id]/start/route.ts`). Mismo riesgo de disponibilidad si se revoca antes de confirmar. | Procedimiento escrito; **prueba real pendiente de acceso a la cuenta de fal.ai** |
| `HAPPIA_API_KEY` | 1) Solicitar key nueva al equipo/soporte de Happia. 2) Actualizar en `.env.production`. 3) Reiniciar. 4) Confirmar con una llamada real a `/packages`. 5) Pedir revocación de la vieja a Happia. | Se usa solo para listar el catálogo remoto de Happia (`packages/happie-package-ia/src/cliente.ts`) — si la key nueva falla, los 3 flujos de recomendación Happie devuelven error controlado (ya endurecido tras el incidente de 503 de esta misma sesión, ver `docs/migracion-python/resiliencia/incidente-2026-09-08-happie-503.md`), no un crash. | Procedimiento escrito; **prueba real pendiente de acceso a la cuenta de Happia** (tercero — ni siquiera es una consola propia) |
| `DATABASE_URL` (Neon, rol principal `neondb_owner`) | 1) En la consola de Neon, resetear el password del rol o crear un rol nuevo con los mismos permisos. 2) Actualizar `DATABASE_URL` en `.env.production` (y en cualquier script local que la use). 3) Reiniciar el contenedor. 4) Confirmar con una query real de solo lectura. | **El de mayor blast radius de los 9**: es el rol dueño de todo el catálogo comercial, precios, planes y telemetría — un error aquí tumba la app completa, no solo un flujo. A diferencia del rol restringido `demo_decoracion_ai_api` creado en Fase 6 (que si se rota mal solo afecta idempotencia del backend Python), este es el rol principal. | Procedimiento escrito; **deliberadamente no probado en esta entrega** pese a tener acceso de lectura/escritura autorizado a esta Neon — el riesgo de romper la DB comercial completa por un error de rotación no se consideró proporcional al alcance de "probar los 5 que no necesitan cuenta externa" que se autorizó |

## Quién rota cada uno

**Sigue siendo el hueco real que ya señalaba el inventario de secretos**
(`inventario-secretos.md`): ningún secreto tiene un dueño humano
asignado hoy. Asignar dueño es una decisión de organización (quién en
Sempertex tiene o debería tener acceso a cada consola de proveedor), no
algo que este documento pueda decidir por sí mismo — queda como
pregunta abierta para quien opere este runbook la primera vez.

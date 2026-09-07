# Auditoría Etapa 1, dominio A: chat, herramientas y proveedor

Fecha: 2026-09-07  
Repositorio auditado: `C:\Users\davidt\Downloads\demo-decoracion`  
Modo: solo lectura, salvo este informe. No se ejecutaron operaciones pagadas ni producción.

## 1. Alcance y rutas verificadas

Rutas presentes y auditadas:

- `src/app/api/chat/route.ts`: Route Handler `POST /api/chat`, normalización de entrada, selección de proveedor, SSE y traducción de errores.
- `src/lib/ia/registro-herramientas.ts`: estado por request, registro de handlers, selección de herramientas y reglas de catálogo/RAG/plan.
- `src/lib/ia/ejecutar.ts`: wrapper de dominio sobre `@sempertex/agente-core`; conserva resultado rico para la UI.
- `src/lib/ia/historial-chat.ts`: ventana de historial de 16.000 caracteres.
- `src/lib/ia/registro.ts`: resolución de proveedor, configuración global y nivel de thinking.
- `src/lib/ia/gemini/chat.ts`: existe, pero es shim; reexporta `crearChatGemini` desde `@sempertex/agente-core/gemini`.
- `src/lib/ia/tipos.ts`, `src/lib/ia/herramientas.ts`, `src/lib/ia/prompt-sistema.ts`: contratos neutrales, schemas de herramientas y prompt por flags.
- `src/lib/auth/session.ts`, `src/lib/auth/request.ts`, `src/proxy.ts`: sesión por cookie y protección de rutas.
- `packages/agente-core/src/`: loop genérico, adaptador Gemini, retry, telemetría y tipos.

Consumidores relacionados verificados:

- `src/app/page.tsx`: cliente principal; envía `POST /api/chat`, parsea SSE y dispara generación automática cuando recibe selección IA.
- `src/app/api/references/analyze/route.ts`: usa el mismo `resolverProveedor` y `chatDe`, pero tiene flujo propio de análisis visual.
- `src/app/api/generate/route.ts`: consumidor posterior de selección, plan, proveedor e instrucciones; fuera del detalle de generación de imágenes de esta auditoría.
- `src/app/api/ia/proveedor/route.ts` y `src/app/api/ia/salud/route.ts`: configuración y salud del proveedor.
- `scripts/eval-chat-thinking.ts`, `scripts/test-chat-historial.ts`, `scripts/test-event-plan-contract.ts` y scripts de plan/RAG: consumidores de runtime y contratos.

Ausencias relevantes:

- No hay proveedor alternativo implementado. `ProveedorId` solo admite `"gemini"`.
- No hay servicio Python en este repositorio que ya consuma estos contratos. La migración objetivo todavía no tiene endpoint ni adaptador Python verificable.
- No hay implementación independiente en `src/lib/ia/gemini/chat.ts`; la implementación real está en `packages/agente-core/src/gemini/chat.ts`.
- `packages/agente-core/dist/` existe en el checkout local, pero no aparece en `git ls-files`; el paquete publica entradas `dist` y requiere build del workspace en un checkout limpio. El `Dockerfile` sí construye el paquete antes de la aplicación.

## 2. Mapa de flujo actual

1. `src/app/page.tsx` conserva mensajes de texto y `brief` en el cliente. Envía `messages`, `brief`, `proveedor`, `loraMode`, foto de espacio, referencias visuales y `referenceBlueprint` a `POST /api/chat`.
2. `src/proxy.ts` protege la ruta si existe `APP_PASSWORD`. Valida la cookie `session`; sin `APP_PASSWORD`, deja pasar la petición. El handler `/api/chat` no repite esta autenticación internamente.
3. `route.ts` hace `request.json()`, resuelve proveedor por precedencia `body.proveedor`, cookie `ia_proveedor`, ajuste global en `meta`, `IA_PROVEEDOR` y primer proveedor disponible.
4. `chatDe("gemini")` crea un `ChatPort` de Gemini. El modelo predeterminado es `GEMINI_CHAT_MODEL` o `gemini-3.6-flash`; `GEMINI_API_KEY` se lee en servidor.
5. La ruta valida con Zod solo `referenceBlueprint` cuando el plan está activo y `loraMode` cuando viene presente. Construye prompt con `RAG_ENABLED`, `RAG_FRANJAS_ENABLED`, `PLAN_DECORACION_ENABLED`, `brief`, blueprint y allowlist LoRA.
6. `limitarHistorialChat` conserva mensajes recientes hasta 16.000 caracteres, sin cortar el último mensaje aunque exceda el límite, y elimina mensajes iniciales de asistente para comenzar con turno de usuario. Las imágenes se adjuntan únicamente al último mensaje de usuario del request.
7. La ruta abre un `ReadableStream` SSE. Por cada `iterador.next()` aplica timeout de 75 s. Emite eventos `texto`, `herramienta`, `fin` o `error`.
8. `src/lib/ia/ejecutar.ts` crea un `EstadoConversacion` nuevo por request y delega el loop a `ejecutarConversacionStream` de `agente-core`. El estado mutable queda capturado por el registro de handlers.
9. `agente-core` llama Gemini hasta que no haya function calls o hasta `VUELTAS_MAX = 10`. Cada turno remoto usa retry de hasta 3 intentos para errores reintentables. Cada llamada de herramienta se ejecuta secuencialmente y su resultado vuelve al historial neutral.
10. `registro-herramientas.ts` ejecuta lógica legado, RAG o plan según flags. RAG consulta PostgreSQL y mantiene whitelist de productos/variantes por request. Plan valida restricciones, cobertura, materiales, presupuesto y aprobación.
11. El evento `fin` conserva `reply`, `brief`, recomendaciones, medidas, cotización, proveedor/modelo, selección IA, resultados RAG, plan y blueprint. `page.tsx` lo proyecta al mensaje; en flujo legado, una selección IA poblada dispara automáticamente `/api/generate`; en flujo de plan, queda pendiente de aprobación explícita.

Flujos paralelos importantes:

- `/api/references/analyze` usa Gemini directamente a través de `ChatPort`, con validación de imágenes propia, y entrega un blueprint que luego viaja al chat.
- `/api/generate` usa el proveedor de imagen y recibe selección/plan ya resueltos. No debe confundirse con el contrato conversacional.
- `/api/ia/proveedor` guarda cookie cliente o ajuste global. `/api/ia/salud` expone disponibilidad, modelos, flag de plan y últimos eventos de telemetría.

## 3. Inventario de contratos y consumidores

| Contrato | Definición actual | Consumidores y obligación de compatibilidad |
|---|---|---|
| Entrada HTTP | `Body` local de `route.ts`: `messages`, `brief`, `proveedor?`, imágenes, blueprint y `loraMode?` | `src/app/page.tsx`; cliente usa nombres exactos y JSON. Actualmente hay cast TypeScript, no validación runtime completa. |
| Historial neutral | `Mensaje`: usuario, asistente texto, asistente function calls, herramienta; imágenes con `base64`, `mime`, `id`, `descripcion` | `agente-core`, adaptador Gemini, evaluaciones y cualquier futuro proveedor. Es contrato central de migración. |
| Herramienta | `Herramienta`: `nombre`, `descripcion`, `esquema` JSON Schema | `src/lib/ia/herramientas.ts`, `herramientaADeclaracion`, Gemini y tests de contratos. |
| Registro | `RegistroHerramientas`: nombre a handler async `(args, llamada)`, resultado `Record<string, unknown>` | `src/lib/ia/registro-herramientas.ts` vía wrapper. Un handler desconocido devuelve error al modelo, no lanza. |
| ChatPort | `id`, `modelo`, `turno`, `turnoStream` | `registro.ts`, `agente-core`, análisis de referencias y `eval-chat-thinking`. |
| Error IA | `ErrorIA` con `causa`, `proveedor`, `reintentable`; causas `sin_llave`, `cuota`, `filtrado`, `timeout`, `red`, `desconocido` | `route.ts`, análisis de referencias, adaptador Gemini y UI. Los estados HTTP actuales son 503, 429, 422, 504 o 502. |
| SSE | `event: texto` con `delta`; `herramienta` con `nombre/estado`; `fin` con resultado rico; `error` con error/causa/proveedor | Parser manual `consumirSSE` en `src/app/page.tsx`. Cambiar nombres o forma rompe UI. |
| Resultado de dominio | `ResultadoConversacion` contiene brief, recomendaciones, decoraciones, categorías, medidas, cotización, selección IA, RAG, plan y blueprint | `page.tsx`, generación de imágenes y tests de contrato. |
| Herramientas activas | Legado: `guardar_brief`, `buscar_catalogo`, `consultar_disponibilidad`, `calcular_medidas`, `cotizar`, `buscar_decoraciones`, `confirmar_seleccion_ia`; RAG: `buscar_catalogo_rag`, `confirmar_seleccion_rag`; plan: `confirmar_plan_decoracion` | `herramientasActivas()` elimina herramientas superadas según flags. `cotizar` siempre se excluye del loop activo. |
| Estado de sesión IA | Cookie `ia_proveedor`; meta `ia_proveedor`; `IA_PROVEEDOR`; `GEMINI_API_KEY`; `GEMINI_CHAT_MODEL`; `GEMINI_CHAT_THINKING_LEVEL` | Selector de proveedor, salud, chat y rutas de referencias/generación. |
| Auth | Cookie `session` = SHA-256 de `APP_PASSWORD`, `httpOnly`, `SameSite=Lax`, `secure` en producción, 30 días | `proxy.ts`, login y `isAuthenticatedRequest`. La protección efectiva de `/api/chat` depende de proxy/matcher. |

Validación observada:

- El JSON de entrada de `/api/chat` no tiene schema runtime. `messages`, `brief`, imágenes y tamaños de payload se aceptan mediante cast. Un cuerpo malformado puede fallar dentro del loop o generar coste antes de fallar.
- `referenceBlueprint` y `loraMode` sí tienen parseo Zod condicionado por flags.
- Los handlers reciben `Record<string, unknown>` y varios usan casts (`args as FiltrosCatalogo`, `args as Figura`, etc.). El JSON Schema ayuda al proveedor, pero no sustituye validación en una frontera Python/HTTP ni en llamadas directas.
- `confirmar_plan_decoracion` sí usa `PlanDecoracionSchema.safeParse`; resolver RAG y `validarSeleccion` son autoridades de catálogo/stock, no el modelo.

## 4. Dependencias y ownership

Dependencias externas directas:

- Next `16.3.0`, React `19.2.8`, TypeScript `5`, `pg`, Zod y `server-only`.
- `@google/genai` declarado en raíz, `packages/agente-core` y `packages/happie-package-ia`; lockfile resuelve `2.16.0`.
- `@sempertex/agente-core` es workspace enlazado a `packages/agente-core`.

Dependencias internas del chat:

- Prompt/flags: `src/lib/ia/prompt-sistema.ts`, `src/lib/rag/flags.ts`, `src/lib/plan/flags.ts`.
- Catálogo/RAG: `src/lib/rag/`, `src/lib/shopify/consultas.ts`, PostgreSQL y observabilidad RAG.
- Negocio: `src/lib/plan/`, geometría/medidas, materiales, cotización, productos y allowlist LoRA.
- Seguridad/configuración: `src/proxy.ts`, `src/lib/auth/`, SQLite/meta y variables de entorno.
- Cliente: `src/app/page.tsx` y componentes de tarjetas de cotización/plan.

Ownership que debe conservarse:

- `agente-core` posee loop, transcript neutral, adaptación Gemini, retry y buffer de telemetría.
- `registro-herramientas.ts` posee estado y reglas específicas de decoración. No duplicar esas reglas en el motor genérico ni en Python sin un adaptador temporal explícito.
- RAG/DB posee autoridad comercial: producto, variante, precio, stock, disponibilidad y procedencia.
- Resolver de plan/materiales/cotización posee cantidades, paquetes, merma, geometría, techo presupuestario y aprobación.
- `proxy.ts` posee la primera barrera de sesión; el futuro servicio Python debe verificar identidad de forma explícita si queda expuesto fuera del proceso Next.

## 5. Reglas de negocio que deben preservarse

1. El modelo no es autoridad comercial. No puede inventar precio, stock, nombre, imagen, SKU ni variante. Los datos mostrables y subtotales salen de catálogo/DB.
2. En RAG, cada selección debe pertenecer a la whitelist recuperada en el request actual. No reutilizar IDs de turnos anteriores ni aceptar IDs inventados.
3. Rechazar explícitamente cantidades sin stock, variantes agotadas, ambigüedad de SKU y cobertura inexistente. No recortar cantidades ni sustituir en silencio.
4. `buscar_catalogo_rag` recibe el mensaje o resumen fiel; filtros duros se extraen de la solicitud original y `brief`, no de una reinterpretación libre del modelo.
5. `calcular_medidas` es estimación preliminar. Para `usar_despiece`, el backend decide tamaños/cantidades desde geometría; el modelo decide producto/color, no la mezcla física.
6. La intención de evento abierta conserva la etiqueta del cliente. Restricciones, cardinalidad, cobertura de referencia y coincidencia de evento se validan en código.
7. `confirmar_plan_decoracion` no acepta precios, cantidades de globos ni tamaños arbitrarios como autoridad. El resolver determina compras y cantidades; presupuesto excedido, falta de cobertura o inconsistencia física bloquean generación.
8. La aprobación del plan es explícita. Tener plan/cotización preliminar no autoriza automáticamente `/api/generate`.
9. El blueprint de referencia debe quedar cubierto por una estructura o una omisión declarada con motivo; no se permite omitir elementos aprobados en silencio.
10. El historial es acotado: 16.000 caracteres, mensajes recientes, inicio en usuario. El `brief` contiene hechos durables. Imágenes solo se reinyectan en el último mensaje, con IDs semánticos.
11. Gemini thinking signature debe viajar en function calls multi-turno. El adaptador conserva `thoughtSignature`; perderla rompe el siguiente turno.
12. Retry solo para errores reintentables. En streaming se reintenta únicamente abrir el stream, antes del primer byte; reintentar después puede duplicar texto o efectos.
13. Tope de 10 vueltas por request y manejo consciente al agotarlo: si la selección ya quedó resuelta, no informar falsamente que todo falló.
14. `APP_PASSWORD` vacío es permisivo para desarrollo; producción debe configurarlo y proteger todas las rutas/servicios expuestos. Cookie y precedencia de proveedor son compatibilidad observable.
15. Las flags cambian el contrato: con RAG activo se eliminan herramientas legado superadas; con plan activo se elimina selección RAG/medidas del loop y entra `confirmar_plan_decoracion`.

## 6. Matriz de migración recomendada

| Área | Migrar ahora | Mantener temporalmente | Migrar después |
|---|---|---|---|
| Contrato HTTP de chat y SSE | Congelar versión, schemas runtime y eventos `texto/herramienta/fin/error` | Endpoint Next actual como fallback | Retirar endpoint solo tras paridad y observación |
| Transcript neutral, loop de 10 vueltas y unknown-tool | Llevar a un core Python puro con fake provider y replay determinista | `@sempertex/agente-core` activo como implementación canónica durante transición | Eliminar paquete solo cuando ningún consumidor TS lo use |
| Adaptador Gemini | Crear interfaz Python equivalente a `ChatPort`; preservar `thoughtSignature`, uso, modelo, errores y retry | Adaptador TS `packages/agente-core/src/gemini/chat.ts` | Cambiar tráfico por flag, después retirar llamada TS |
| `historial-chat.ts` | Formalizar algoritmo y casos límite como contrato compartido | Implementación TS sin cambios | Reemplazar cuando el endpoint Python controle la reconstrucción del historial |
| `registro-herramientas.ts` y herramientas | Extraer inventario y payloads, no reimplementar reglas todavía | Handlers RAG/plan/cotización en TS junto con sus autoridades actuales | Migrar por dominio después de auditorías B/C y adaptadores de datos |
| Catálogo, whitelist, plan, materiales y cotización | Definir interfaces de frontera | PostgreSQL/Shopify/resolvers TS | Migrar en etapas B/C, con doble lectura o replay antes de cambiar autoridad |
| Auth y selección de proveedor | Definir contrato de identidad y propagación segura al servicio | `proxy.ts`, login, cookie `session`, `ia_proveedor` y meta | Migrar validación al servicio Python cuando exista frontera de red real |
| Telemetría | Añadir contrato de correlación, tokens, modelo y resultado | Buffer en memoria de 50 eventos; no sirve como auditoría durable | Persistencia/metrics después de fijar privacidad y retención |
| Herramientas legado | Testear y preservar mientras `RAG_ENABLED=false` siga siendo configuración válida | Ruta legacy completa | Retirar solo con evidencia de consumidores y rollback de flags |

Conclusión de etapa: migrar ahora contratos y core desacoplado; mantener autoridades comerciales y endpoint TS. Migrar el handler monolítico completo en una sola operación sería alto riesgo y contradiría ownership de AGENTS.md.

## 7. Riesgos, severidad y reversión

| Riesgo | Severidad | Reversión acotada |
|---|---:|---|
| Drift en JSON/SSE, nombres de herramientas o `ResultadoConversacion` rompe UI | Alta | Mantener versión de contrato, replay de fixtures y flag que conserve `/api/chat` TS |
| Pérdida de `thoughtSignature`, IDs de llamada o agrupación de function responses rompe Gemini multi-turno | Alta | Comparar transcript neutral serializado; volver al adaptador TS |
| Python duplica whitelist, stock, precio o reglas de plan | Crítica | Dejar autoridad en TS/DB; Python solo llama adaptador explícito; revertir tráfico sin cambiar datos |
| Endpoint Python expuesto sin verificación equivalente a proxy | Crítica | Mantener Python interno; exigir identidad propagada y validada antes de enrutar tráfico |
| Casts sin validación permiten payload grande/malformado, DoS o coste innecesario | Alta | Rechazar en frontera con límites de tamaño, MIME, número de mensajes y schema; conservar respuesta de error estable |
| Retry multiplicado por 10 vueltas, hasta 3 intentos por turno, eleva latencia y coste | Alta | Mantener límites, instrumentar llamadas y apagar tráfico Python/proveedor por flag |
| Cliente aborta y el servidor no propaga cancelación al iterador/proveedor | Media-alta | Añadir cancelación antes del cutover; mantener timeout y límite de vueltas; observar solicitudes huérfanas |
| Auth migrada cambia cookie o invalida sesiones | Media | No cambiar cookie durante primera migración; validar identidad en paralelo; rollback de ruta |
| `dist` del workspace no está versionado y falta build en checkout limpio | Media | Ejecutar build de paquete como paso de imagen/CI; no cambiar exports hasta verificar artefactos |
| Telemetría en memoria se pierde en restart y puede retener mensajes de error del proveedor | Media | No usarla como auditoría; agregar IDs y almacenamiento con redacción antes de depender de ella |

Plan de reversión recomendado: conservar `POST /api/chat` y el formato actual; introducir selección de backend detrás de una variable/feature flag; enviar primero solo tráfico sintético o replay; comparar resultado, herramienta, latencia, tokens y errores; activar por porcentaje; ante cualquier divergencia comercial, volver al handler TS sin migración de DB ni borrado de datos.

## 8. Baseline de pruebas y coste

Pruebas deterministas ejecutadas localmente, sin proveedor ni credenciales:

- `npm run chat:test-historial`: PASS. Comprueba límite, preservación de últimos mensajes y mensaje único mayor que el límite.
- `npm run plan:test-event-contract`: PASS. Comprueba que `confirmar_plan_decoracion`, resolver y payload UI conservan evento abierto y niveles de coincidencia usando pool mock.
- `npm run plan:test-contratos`: PASS. Comprueba contratos PlanDecoracion 1.0/1.1 y 12 reglas de validación.

Pruebas no ejecutadas por alcance/coste:

- `npm run rag:eval-chat`: usa `.env.local`, catálogo real y Gemini; requiere `GEMINI_API_KEY` y puede generar consumo remoto.
- `npm run rag:e2e-v2:gemini`, `npm run plan:eval`, `npm run ia:eval`, evaluaciones de imagen/LoRA y scripts de embeddings: requieren proveedor, credenciales y/o consumo pagado.
- `scripts/test-integracion-tamanos.ts` y `npm run plan:test-pg`: integración con PostgreSQL/SQLite; no se ejecutaron para evitar estado externo.
- No se ejecutaron rutas HTTP, navegador, SSE real, generación de imagen, producción ni despliegue.

Baseline por dependencia:

- Sin `GEMINI_API_KEY`, `resolverProveedor` falla con `ErrorIA("sin_llave")`; no debe ocurrir una llamada remota.
- Con llave, cada vuelta puede intentar hasta 3 aperturas remotas. Con máximo 10 vueltas, el techo teórico de aperturas Gemini es 30 por request, además de llamadas de datos/embeddings que active RAG. Es un límite operacional, no una estimación de factura.
- La facturación real depende de tokens de prompt, herramientas, imágenes, modelo y respuestas. El repo registra `promptTokenCount`, `candidatesTokenCount` y tokens cacheados en telemetría, pero no calcula coste ni lo persiste durablemente.
- El historial de 16.000 caracteres no representa todo el prompt: hay system prompt, schemas de herramientas, blueprint y posibles imágenes. La migración debe medir tokens reales, no convertir caracteres directamente a precio.

## 9. Límites de esta auditoría

- Auditoría estática del checkout actual; el worktree ya tenía cambios locales preexistentes. No se atribuye ningún cambio a esta auditoría salvo este informe.
- Se verificaron rutas y símbolos solicitados; no se auditó en profundidad RAG, catálogo, planes, materiales, generación de imagen, LoRA o Happie porque pertenecen a otros dominios.
- No se verificó compatibilidad de una versión futura de Python/FastAPI ni del SDK Gemini fuera de la versión instalada y lockeada (`@google/genai 2.16.0`).
- No se midieron latencias, tokens ni coste con proveedor real.
- La existencia de `proxy.ts` demuestra barrera de aplicación, no autenticación autónoma de cada handler. Cualquier nueva ruta Python debe tratar esta distinción como requisito de seguridad.

## 10. Recomendaciones reversibles para Etapa 2

1. Versionar schemas de entrada, SSE, resultado final, `Mensaje`, `LlamadaHerramienta`, errores y herramientas activas. Generar contrato para Python; no duplicarlo manualmente.
2. Crear fixtures de replay sin Gemini: respuesta final, una herramienta, varias herramientas, herramienta desconocida, agotamiento de 10 vueltas, error de cuota, timeout y function call con `thoughtSignature`.
3. Añadir fake `ChatPort` y pruebas del loop que comparen historial exacto, IDs locales, orden de respuestas y estados SSE.
4. Definir límites runtime antes de exponer cualquier endpoint Python: JSON, mensajes, caracteres, imágenes, MIME, base64, blueprint y `loraMode`.
5. Mantener RAG/plan/cotización bajo sus autoridades actuales; si Python los necesita, usar adaptadores explícitos con request ID, timeout y resultado versionado.
6. Preservar autenticación en Next durante primer corte. Antes de enrutar al servicio, propagar identidad verificable; no aceptar `user_id` enviado por navegador.
7. Instrumentar `request_id`, proveedor, modelo, versión de prompt, vueltas, herramientas, latencia, tokens y motivo de error; no registrar conversaciones completas, imágenes ni secretos.
8. Agregar kill switch de backend y rollback documentado. No retirar `agente-core`, herramientas legacy ni schemas actuales hasta que replay, integración local y una prueba controlada con proveedor pasen.

Dictamen: el dominio A es migrable por contratos y adaptador, no por traslado directo de `route.ts` y `registro-herramientas.ts`. El núcleo genérico ya está separado en `packages/agente-core`; la parte de mayor riesgo sigue siendo el contrato implícito entre Gemini, handlers comerciales, whitelist por request, plan/cotización y la UI SSE.

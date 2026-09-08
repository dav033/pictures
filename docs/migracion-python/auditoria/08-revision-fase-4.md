# Auditoría previa — Fase 4 (Seguridad, secretos y superficie externa)

**Alcance:** capítulo Fase 4 (4.1–4.5) del `PLAN-MAESTRO-V2.md`, capítulo 6 (invariantes), formato según capítulo 13.2.

**Rama auditada:** `fase-1/medicion-y-migraciones-seguras`, con cambios sin commitear en curso (ver sección 1).

**Nota de metodología:** el capítulo 13.3 del plan especifica `openai/gpt-5.6-luna` variante `xhigh`. Esta auditoría se produjo con un subagente Claude (`Plan`, sin herramientas de escritura) porque la cuenta OpenAI usada por `opencode` alcanzó su tope de uso el 2026-09-08. Desviación autorizada por el usuario en la misma sesión.

**Nota de método:** ninguna cifra de este informe se inventó. Donde no se midió algo, se dice "no medido". No se imprimió ningún valor de secreto real; solo se confirma existencia y ubicación.

---

## 1. Verificación de evidencia

| Cita del plan | ¿Sigue apuntando a lo que dice? | Detalle |
|---|---|---|
| `src/lib/ia/prompt-sistema.ts:173-186` (`bloqueReferencia`) | **Se movió.** La función real ocupa hoy las líneas **172-182**. El archivo no tiene cambios sin commitear — es HEAD real — así que la cita quedó desalineada (~4-5 líneas) por commits normales posteriores, no por un merge. El contenido semántico (serialización del blueprint de referencia hacia el prompt) sigue siendo el que describe el plan. | `src/lib/ia/prompt-sistema.ts:172-182` |
| `packages/happie-package-ia/src/recomendador.ts:104` (inyección del catálogo Happia) | **Correcta contra HEAD, ya desalineada en el working tree.** Contra HEAD, la línea 104 es exactamente `const contenido = JSON.stringify(paquetesActivos.map(paqueteAContexto));`. Un diff sin commitear (instrumentación de telemetría) ya desplazó ese statement a la línea 123 del working tree, y el `text` que arma el mensaje al modelo está en la línea 135. Es el caso de "referencia que se mueve el mismo día" que describe el capítulo 13.1, capturado en vivo. | HEAD: línea 104. Working tree: líneas 123 y 135. |
| Invariante 1/2 aplicados a `confirmar_seleccion_rag` | **Vigente, verificado en código, no solo en el prompt.** `src/lib/rag/chat/validar.ts:116-144` (`validarSeleccion`) rechaza cualquier `product_id`/`variant_id` que no esté en `idsRecuperados`, construido en `registro-herramientas.ts:97-102` y reseteado por turno/request en `crearEstadoConversacion`. El schema de la herramienta (`validar.ts:1-14`) no admite precio, nombre ni imagen: no hay campo por el cual el LLM pudiera inyectarlos. | Vigente y más fuerte de lo que el plan da a entender. |
| Mismo invariante en `confirmar_plan_decoracion` (ruta que usa `bloqueReferencia`) | **Vigente.** `src/lib/plan/resolver.ts` recibe el mismo `whitelist` como parámetro y lo aplica en al menos 6 puntos antes de aceptar cualquier `product_id`/`variant_id` del plan. Es relevante porque **es la ruta expuesta a la vía de inyección por imagen**, y el plan no la cita explícitamente — solo cita `confirmar_seleccion_rag`. | `src/lib/plan/resolver.ts` |
| Invariante 3 (aprobación explícita antes de `/api/generate`) | **Vigente y con defensa criptográfica, no solo de flujo.** `src/lib/plan/aprobacion.ts` firma el token con HMAC-SHA256 sobre `{planHash, requestId, expiresAt}` usando `PLAN_APPROVAL_SECRET`; `generate/route.ts:739` lo exige y lo ata al `plan_hash` exacto del plan resuelto en servidor. | `src/lib/plan/aprobacion.ts:25-45`, `generate/route.ts:739` |
| Rate limit por credencial en webhooks Happie | **Confirmado y más completo de lo que dice la frase suelta del plan.** `webhook-control.ts` implementa: `rate()` (30 hits/minuto por scope), `claim()`/`finish()` (idempotencia con hash del body, lease de 2 min, expiración 24h), límite de body de 32 KB, timeout de 60s, techo de adquisiciones de conexión pendientes (8). | `src/lib/happie/webhook-control.ts:1-228` |
| Inventario de secretos (Fase 4.1) | **Confirmado literal.** `.env.local` (no trackeado, correctamente en `.gitignore`) tiene exactamente las claves del plan: `GEMINI_API_KEY`, `FAL_KEY`, `APP_PASSWORD`, `DATABASE_URL`, `PLAN_APPROVAL_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, y tres de Happie (`HAPPIA_API_KEY`, `HAPPIE_EXTERNO_API_KEY`, `HAPPIE_WEBHOOK_API_KEY`). No se imprimió ningún valor. | `.env.local` (solo nombres) |

**Conclusión:** las citas puntuales siguen apuntando al lugar correcto en sustancia, pero una está desalineada por commits normales y la otra por el working tree actual (28 archivos modificados sin commitear, varios dentro del scope exacto de Fase 4: `recomendador.ts`, `webhook-control.ts`, `conversacion-webhook.ts`, `generate/route.ts`, `references/analyze/route.ts`). Cualquier implementador debe decidir primero si audita contra HEAD o contra el working tree.

---

## 2. Sigue en pie / ya no aplica / cambió de forma

| Entrega | Estado | Motivo |
|---|---|---|
| **4.1** — Inventario de secretos | **Sigue en pie, sin cambios de forma.** | Inventario exacto: 6 secretos propios + 3 de Happie. Falta "quién los rota" y "qué pasa si se filtra cada uno" — no existe en ningún documento. |
| **4.2** — Escaneo de secretos en CI e histórico | **Sigue en pie, hueco real.** | `checks.yml` no tiene job de escaneo de secretos. No hay hook de pre-commit. Chequeo manual acotado sobre el histórico con patrones básicos encontró un único hit: `HANDOFF-LORA-COMPOSICION.md` (commit `ea9bc58`) menciona en prosa `FAL_KEY=fc-...` truncado, junto con detalle de cuentas/facturación de fal.ai. No es un secreto completo, pero es información operativa sensible en un `.md` committeado que un escáner por regex no detectaría. Ningún `.env*` con valores reales fue commiteado nunca. |
| **4.3** — Inyección de prompt (imagen + catálogo Happia) | **Sigue en pie, descrito de forma menos precisa que la realidad.** | Hay una ruta de inyección real y demostrable con evidencia de código, y una segunda superficie de amplificación (webhook de conversación Happie) que el plan no menciona y que es más grave porque expone contenido a clientes de un tercero, no solo al propio cliente que sube la imagen. |
| **4.4** — Procedimiento de rotación probado | **Sigue en pie, sin cambios de forma.** | No existe ningún runbook de rotación para ninguno de los 9 secretos. El "probado" del criterio de aceptación no se ha ejercitado ni una vez. |
| **4.5** — Superficie externa por endpoint | **Cambió de forma respecto a lo que el plan da por hecho.** | El plan lo trata como trabajo mecánico de listar; en la práctica hay un mecanismo de gate global (`src/proxy.ts`) que cambia qué significa "expuesto" para cada endpoint, no mencionado en el plan ni en `.planning/codebase/ARCHITECTURE.md` (que además quedó obsoleto en este punto — ver sección 5). |

---

## 3. Riesgo y esfuerzo por entrega

| Entrega | Riesgo | Esfuerzo | Invariante del cap. 6 en juego |
|---|---|---|---|
| **4.1** | Bajo riesgo de ejecución, alto costo de omisión: sin dueño ni "qué pasa si se filtra", una filtración real no tiene playbook. | Bajo — ya 80% hecho por esta auditoría. | Ninguno directo; sostiene indirectamente el invariante 6. |
| **4.2** | Riesgo de falsos negativos con regex genérico (ya se encontró contenido sensible no-credencial que un escáner no atraparía). Riesgo de ruido si no se excluye `node_modules`/`.venv`. | Medio — instalar el escáner es mecánico; correrlo contra el histórico completo y tribiarlo toma tiempo real. | Ninguno; es preventivo. |
| **4.3** | **El de mayor riesgo real de los cinco**, aunque acotado por diseño (ver detalle abajo). | Alto — exige diseñar y correr casos concretos (imagen con texto adversarial, catálogo manipulado) sin gastar en proveedor pagado; no se puede completar con evidencia empírica de comportamiento del modelo sin al menos una corrida controlada de Gemini, prohibida en esta auditoría. | Invariantes 1 y 2 explícitamente; roza el 3 indirectamente (webhook de conversación, ver sección 5). |
| **4.4** | Riesgo operativo si se rota en caliente sin plan: `GEMINI_API_KEY` se lee en ~10 puntos distintos del código, todos vía `process.env` en tiempo de ejecución (inferido leyendo código, no medido con rotación real). `FAL_KEY` mucho más acotada (2 archivos), menor riesgo. | Medio-alto — "probado" implica ejecutar contra un entorno real, lo que roza la restricción de cero-proveedores-pagados de esta auditoría. | Invariante 6 si la rotación se mezcla con flags de entorno. |
| **4.5** | Riesgo medio: se encontró un caso concreto (sección 5) donde el gate global probablemente **rompe** un endpoint real en vez de protegerlo — riesgo de disponibilidad, no de exposición, pero dentro del alcance de "qué expone cada endpoint". | Medio — el inventario es mecánico (~55 rutas), pero decidir qué debería excluirse del matcher y verificarlo requiere criterio. | Ninguno directo; es el tipo de hallazgo que el capítulo 13.1 predice, aplicado a comportamiento, no solo a líneas de texto. |

**Detalle del riesgo de 4.3:**

Dos hops reales de inyección indirecta confirmados:

1. **Vía imagen de referencia:** `analizar-referencias-v2.ts` le pide a un modelo de visión describir cada elemento con un schema JSON donde `name` es `{type: "string"}` sin enum ni filtro de contenido, acotado solo por longitud (`reference-blueprint.ts`, `texto(160)`/`texto(240)`). Ese texto pasa **sin sanitizar** a `bloqueReferencia()` y queda embebido en el system prompt del chat principal.
2. **Vía catálogo Happia:** `generar-recomendacion.ts:96` trae paquetes reales desde `HAPPIA_API_BASE_URL` (remoto, fuera de control) y `recomendador.ts` serializa `conditions`, `restrictions` e `item.description` directamente al prompt.

**Lo que SÍ contiene el daño:**
- `confirmar_seleccion_rag`/`confirmar_plan_decoracion` verifican server-side contra whitelist por turno — un texto inyectado no puede confirmar un producto que no salió de una búsqueda real de ese turno.
- `/api/generate` exige token HMAC atado al `plan_hash` exacto — un texto de modelo no puede forjar esa firma.
- En `recomendador.ts`, el schema Zod de salida se resuelve contra `porId.get(r.packageId)` — un `packageId` inventado simplemente se descarta.

**Lo que NO contiene, y que el plan no analizó:**
`razon`/`resumen` en `recomendador.ts` (`RecomendacionSchema`, el schema interno que valida la salida cruda del modelo) no tienen límite de longitud propio. **Corrección post-auditoría (verificada en código):** esto está mitigado en la frontera que realmente importa — `HappieRecommendationResponseV1Schema` (`src/lib/ia/contracts/happie-v1.ts:61,67,72,78,112`) acota `razon` a 1.000 y `resumen` a 2.000 caracteres, y `generar-recomendacion.ts:119-142` valida contra ese contrato antes de responder; una violación lanza y el catch-all la convierte en un 502 limpio, nunca se expone sin acotar. El riesgo de tamaño/DoS por longitud ya estaba cerrado antes de esta auditoría. Lo que **sigue sin analizar** es contenido dentro de ese límite: un catálogo Happia manipulado puede inducir al modelo a escribir texto plausible pero engañoso en `razon`/`resumen`, devuelto en la respuesta de `/api/happie/webhook/chat` y mostrado a clientes de Happia — un problema de integridad de contenido, no de tamaño ni de inyección técnica (la respuesta es JSON, no se renderiza como HTML de este lado). Sigue siendo cualitativamente distinto de la vía imagen porque aquí quien controla el contenido inyectable no es quien ve el resultado, pero la severidad es menor de lo que este informe indicó originalmente.

---

## 4. Orden propuesto dentro de la fase

Difiere del orden implícito del plan:

1. **4.1 primero**, sin cambios — prerrequisito de todo, casi resuelto por esta auditoría.
2. **4.5 antes que 4.2 y 4.3** (diferencia respecto al plan). Mientras se hace el inventario de endpoints hay que decidir si `/api/rag/webhooks/shopify` debe excluirse del matcher de `src/proxy.ts` — es un cambio de código, y debe existir antes de intentar 4.4 (rotar y confirmar "no tumba el servicio" no tiene sentido si un endpoint ya está roto por otro motivo).
3. **4.3 en paralelo con 4.5, no después.** Ya tiene evidencia de código suficiente para el informe sin gastar en proveedor; lo que falta (comportamiento real del modelo ante payload adversarial) requiere una corrida controlada fuera del alcance de esta auditoría — debe quedar marcado como "análisis estático completo, validación dinámica pendiente", sin bloquear la fase.
4. **4.2 después de 4.1** — mecánico una vez que se sabe qué patrones buscar por secreto real.
5. **4.4 al final** — depende de que 4.5 ya corrigiera cualquier endpoint roto, y de que 4.1 tenga claro dónde vive cada secreto.

---

## 5. Lo que el plan no vio

**a) El gate de autenticación (`src/proxy.ts`) probablemente rompe el webhook de Shopify en producción.** `src/proxy.ts` es la convención real y activa de Next.js 16.3.0 (verificado en `node_modules/next/dist/build/utils.js`, `isProxyFile`), no código muerto. Su `matcher` excluye `api/login`, `api/happie/recommend-packages`, `api/happie/recommend-package` y `api/happie/webhook`, pero **no excluye `/api/rag/webhooks/shopify`**. Con `APP_PASSWORD` configurado en producción, un POST de Shopify (server-to-server, sin cookie de sesión) sería interceptado y respondido con un redirect a `/login`, no con el 2xx/401 que Shopify espera. El propio código del webhook documenta que "Shopify interpreta cualquier no-2xx como reintenta" — un redirect en bucle no es un reintento útil, es una sincronización de catálogo silenciosamente rota. No detectado ni por el plan ni por el documento de arquitectura existente.

**b) `.planning/codebase/ARCHITECTURE.md:248` está desactualizado exactamente en este punto.** Afirma que "no application authentication boundary was found around chat, catalog sync, RAG webhook, or admin routes" — documento del 21 de agosto de 2026; el commit que introdujo `src/proxy.ts` es del 23 de agosto. La afirmación ya no es cierta, pero el documento no se actualizó. Riesgo de que un implementador que lea ese `.md` en vez de verificar el código llegue a una conclusión incorrecta.

**c) El working tree actual ya tiene 28 archivos con cambios sin commitear dentro del scope exacto de Fase 4** (instrumentación de telemetría en `recomendador.ts`, `webhook-control.ts`, `conversacion-webhook.ts`, rutas de `generate`/`references/analyze`). Si Fase 4 arranca sin decidir si esos cambios se commitean antes, cualquier línea citada en este informe quedará obsoleta en el próximo commit — el mismo problema que el capítulo 13.1 describe con las referencias de Happie.

**d) `razon`/`resumen` sin límite de longitud es una superficie de contenido no confiable hacia un tercero (Happia), no solo hacia el propio cliente** — riesgo de contenido/reputación, no de autoridad comercial, y afecta a un tercero que no está en la lista de invariantes del capítulo 6.

**e) `HANDOFF-LORA-COMPOSICION.md` tiene detalle de cuentas/facturación de fal.ai y un prefijo de clave truncado, committeado en el histórico** — no una fuga completa, pero exactamente el tipo de exposición operativa que un escáner de secretos por regex no atrapa.

**f) No hay ningún límite de tasa por IP/usuario en `/api/chat`, `/api/generate` ni `/api/references/analyze` más allá del gate de `APP_PASSWORD` compartido.** Como es una única contraseña compartida (no hay usuarios individuales), cualquiera con esa contraseña tiene llamadas ilimitadas a Gemini/fal.ai sin control de cuota por sesión. Se solapa con la Fase 9.1 ("seguridad del gasto") pero también es relevante para 4.5 y no está mencionado ahí.

---

## 6. Preguntas abiertas

1. **¿Se audita/implementa Fase 4 contra HEAD o contra el working tree actual?** 28 archivos modificados sin commitear en el scope exacto de esta fase.
2. **¿`src/proxy.ts` realmente corre en el despliegue actual del EC2?** Verificación estática de que el mecanismo *puede* funcionar; no se confirmó dinámicamente contra un despliegue vivo con `APP_PASSWORD` seteado.
3. **¿`/api/rag/webhooks/shopify` está en uso hoy, o el webhook nunca se suscribió en el admin real de la tienda?** El propio comentario del archivo dice que la suscripción "requiere acceso al admin real y no se puede hacer desde este repo" — si nunca se configuró, el hallazgo (a) es latente, no activo.
4. **¿Quién tiene acceso hoy a las cuentas de proveedor (Gemini, fal.ai, Happia, Shopify) para ejecutar una rotación real en 4.4?**
5. **¿Cuál es el criterio de "probado" para 4.4 dado que esta auditoría (y probablemente la implementación temprana) tiene prohibido llamar a proveedores pagados?** Staging (Fase 6) todavía no existe.
6. **¿Hay aprobación para instalar gitleaks/trufflehog en `checks.yml` y correrlo contra el histórico completo?**
7. **¿La vía de contenido hacia clientes de Happia se considera dentro del alcance de "seguridad" de este plan, dado que el afectado es un tercero y no un invariante del capítulo 6?** Si no, ¿en qué fase se atiende?
8. **¿Alguien validó alguna vez con una llamada real controlada que un catálogo o imagen con texto adversarial de verdad logra el comportamiento descrito en la sección 3, o es hasta ahora análisis puramente estático?** El criterio de aceptación de 4.3 pide "el resultado real, no una afirmación de que está acotado" — esta auditoría entrega el análisis estático más fuerte posible sin gastar en proveedor; la validación dinámica queda pendiente por diseño de las reglas de la propia auditoría.

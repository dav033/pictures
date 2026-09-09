# Plan maestro v2 — migración Python y optimización de la interacción con los modelos

Fecha: 2026-09-07
Estado: propuesto, sustituye al plan de 10 etapas que nunca se escribió completo
Rector sobre: `00-prompt-continuacion.md`, `prompt-seguimiento-etapa-5.md`
Subordinado a: `AGENTS.md` (raíz)

---

## 0. Por qué existe este documento

El "plan maestro de 10 etapas" al que se refieren todos los documentos de esta
carpeta **nunca existió por escrito**. La única mención es una frase en
[`00-prompt-continuacion.md`](00-prompt-continuacion.md):

> "siguiendo un plan maestro de 10 etapas que el usuario ya definió (ETAPA 1
> auditoría, ETAPA 2 contratos, ETAPA 3 base del servicio Python, ... hasta
> ETAPA 10 limpieza y entrega)"

Las etapas 1 a 4 se ejecutaron y documentaron. Las etapas 5 a 10 solo existían
como esos puntos suspensivos. Este documento las escribe, con el estado real
verificado en disco y con el objetivo que motiva la migración puesto en el
centro: **que la interacción con Gemini y con el LoRA sea lo más óptima
posible sin romper nada**.

Además se recuperaron nueve planes que habían sido borrados del repositorio y
seguían siendo referenciados por comentarios de código vivo. Están en
[`docs/planes-recuperados/`](../planes-recuperados/). El más importante para
este trabajo es `PLAN_RENDIMIENTO_RAG.md`: contiene el trabajo de optimización
de Gemini con **mediciones reales**, y es la base del capítulo 3.

### Cómo se numera todo esto

Hay dos numeraciones y conviene no mezclarlas:

| Nombre | Qué es | Estado |
|---|---|---|
| **Etapas 1 a 4** | Las cuatro etapas del plan viejo que **ya se ejecutaron**: auditoría, contratos, base del servicio Python y preparación reversible. Documentadas en `01-` a `04-` de esta carpeta | Cerradas en local |
| **Fases 1 a 10** | El trabajo nuevo que define este documento. La Fase 1 es el primer trabajo nuevo, no una repetición de nada | Fase 1 en curso |

La primera versión de este documento llamaba "Etapa 5" a lo que ahora es la
Fase 1, por continuidad con la numeración vieja. Se renombró porque inducía a
error: leer "plan nuevo" y encontrarlo empezando en 5 sugiere que algo se
saltó, cuando en realidad las cuatro primeras ya estaban hechas antes de
escribir este plan.

Hay además una razón de fondo. La crítica central del capítulo 1.3 es que las
etapas del plan viejo cerraban entregando frontera de transporte sin ninguna
capacidad de IA. Este plan tiene un criterio de salida distinto, así que
numerar su primer paso como continuación de esa serie implicaría una
continuidad que no existe.

Nada del trabajo ya ejecutado cambia por el renombrado.

### De 6 fases a 10

La primera versión de este plan tenía seis fases. Se extendió a diez al revisar
qué faltaba para que la implementación quedara cubierta, no solo encaminada.
Las cuatro nuevas cubren huecos que ninguna fase trataba como trabajo propio:

| Nueva | Por qué faltaba |
|---|---|
| **Fase 2** — CI y gates | Cualquier push a `main` despliega al EC2 **sin un solo check**, y hay varios agentes commiteando. Todo lo demás se estaba planeando sin red |
| **Fase 4** — Seguridad y secretos | Ninguna fase trataba los secretos ni el contenido no confiable que llega al prompt. El staging necesita un secreto rotable antes de existir |
| **Fase 5** — Resiliencia y degradación | 19 migraciones sin nota de reversión (corregido por auditoría 5.0: el conteo de 18 ya estaba mal cuando se escribió — ver `auditoria/09-revision-fase-5.md`), sin procedimiento de restore probado, y nadie ha probado qué pasa cuando un proveedor está caído |
| **Fase 7** — Carga y concurrencia | Todas las cifras son de una máquina y un momento. Nadie midió el sistema con más de una conversación a la vez |

Mapa de la renumeración, para cualquier documento o rama que use los números
viejos:

| Antes | Ahora |
|---|---|
| Fase 1 | Fase 1 — sin cambio |
| Fase 2 (optimización Gemini) | **Fase 3** |
| Fase 3 (staging) | **Fase 6** |
| Fase 4 (capacidad IA en Python) | **Fase 8** |
| Fase 5 (LoRA y generación) | **Fase 9** |
| Fase 6 (cutover y entrega) | **Fase 10** |

La Fase 1 no se movió a propósito: está en curso y la rama de trabajo se llama
`fase-1/medicion-y-migraciones-seguras`. Los números son identificadores; el
orden lo define el grafo de dependencias del capítulo 8, no la secuencia.

---

## 1. Estado real verificado

### 1.1 Migración Python

Las cuatro etapas del plan viejo que sí se ejecutaron:

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 — auditoría | Cerrada | 4 informes de dominio + `01-sintesis-etapa-1.md` |
| 2 — contratos | Cerrada | 33 JSON Schema Draft 7, `contracts:check` sin drift |
| 3 — base del servicio | Cerrada local | FastAPI, 33 modelos Pydantic generados, `uv.lock` |
| 4 — preparación reversible | Cerrada local | Repo backend separado, store PG durable, E2E HTTP local |

Lo que el plan viejo llamaba etapas 5 a 10 no existía por escrito, salvo la
quinta (staging), que estaba redactada pero nunca se inició por gates externos.
Su contenido técnico sigue siendo válido y se adopta tal cual en la Fase 6.

### 1.2 Qué hace Python hoy — y qué no

El backend en `workspace/demo-decoracion-api` expone exactamente tres cosas:
`/healthz`, `/readyz` y `/internal/v1/echo`. Lo que tiene alrededor es
sustancial y está bien hecho: HMAC `operational.v1`, nonce de un solo uso,
idempotencia con estados `new`/`in_flight`/`replay`/`conflict`, respuesta
terminal guardada, deadline, cancelación, límite de body, readiness fail-closed
y store PostgreSQL con `asyncpg`.

**Pero no ejecuta ni una sola operación de IA.** No llama a Gemini, no toca
embeddings, no rerankea, no compila prompts. Es una frontera de transporte
probada, sin capacidad de IA todavía.

### 1.3 El desalineamiento central

La migración se justifica por "mejorar las interacciones de la IA con
Python/RAG y todo su ecosistema". Sin embargo:

- Las etapas 1 a 4 construyeron **frontera de transporte**, no capacidad de IA.
- Las optimizaciones de IA que sí dieron ganancia medida (bajar el nivel de
  razonamiento en el parser y en el chat: **-72% y -49% de latencia**) se
  hicieron **en TypeScript**, sin Python de por medio.
- La quinta etapa tal como estaba escrita en el plan viejo habría añadido
  despliegue y observabilidad para seguir sin mover una sola capacidad de IA.

Ese desalineamiento no invalida el trabajo hecho: la frontera es un
prerrequisito real y está bien construida. Lo que hay que corregir es el orden
y el criterio de salida de las etapas siguientes.

**Regla nueva:** ninguna etapa a partir de la 5 se cierra si no entrega una
capacidad de IA medible o un instrumento para medirla. Frontera sin capacidad
no cierra etapa.

### 1.4 Riesgos abiertos del repositorio

1. ~~**Todo el trabajo de las etapas 1 a 4 está sin commitear.**~~ **Resuelto
   en la Fase 1.1.** Eran 41 archivos modificados (1.279 inserciones) más
   `contracts/`, `docs/migracion-python/`, `services/`,
   `src/lib/ia/contracts/`, `src/lib/ia/idempotencia/`,
   `src/lib/ia/python-adapter.ts`, `src/app/api/internal/` y 12 scripts, todo
   sin versionar desde `c89cda1` (2026-09-04). Está en la rama
   `migracion/python-etapas-1-4`, en siete commits por frente de trabajo.
2. **El runner de migraciones podía escribir en producción sin preguntar.**
   `npm run rag:migrate` tomaba `DATABASE_URL` de `.env.local` —que en este
   checkout apunta a Neon remoto— sin imprimir ni confirmar el destino.
   Además `BEGIN`/SQL/`COMMIT` se ejecutaban sobre el pool, así que podían
   salir por conexiones distintas y la garantía transaccional era ilusoria.
   **Resuelto en la Fase 1.3**; el detalle está en el capítulo 10.
3. **No existe arnés de medición.** `PLAN_RENDIMIENTO_RAG.md` puso la Fase 0
   ("arnés de medición permanente") antes que todo lo demás, precisamente
   porque sin ella no se puede probar que una optimización funcionó. Nunca se
   construyó. Hay `scripts/bench-rag-v2.ts` y `scripts/bench-retrieval-v2.ts`,
   pero no están cableados en `package.json` y miden calidad de retrieval
   contra ground truth, no latencia ni tokens.
4. **La telemetría de tokens no sobrevive un reinicio.** Es un buffer en
   memoria de 50 eventos (`packages/agente-core/src/telemetria.ts:18`), sin
   `request_id`, sin versión de prompt y sin coste. `AGENTS.md` exige
   registrar identificadores de traza, proveedor, modelo, versión de prompt y
   uso reportado.
5. **Comentarios de código apuntando a archivos borrados.** Seis referencias
   vivas a `PLAN_RENDIMIENTO_RAG.md` en `src/lib/ia/prompt-sistema.ts:8`,
   `src/lib/ia/registro.ts:51`, `src/lib/rag/embeddings.ts:14`,
   `src/lib/rag/retrieval/por-rol.ts:135`, `scripts/eval-chat-thinking.ts:16` y
   `scripts/eval-query-parser.ts:10`. Resuelto al recuperar los planes.

---

## 2. Principios rectores

1. **Medir antes de optimizar, y medir después.** Ninguna optimización se
   activa sin antes/después reproducible. Fue exactamente ese arnés el que
   evitó desplegar `flash-lite` con una regresión de calidad real.
2. **Cada etapa entrega capacidad de IA o instrumento de medición.**
3. **La autoridad comercial no se mueve.** PostgreSQL y TypeScript siguen
   siendo dueños de catálogo, precio, disponibilidad, cantidades, geometría,
   materiales, cotización, aprobación y allowlist. Python puede *ordenar*,
   *evaluar* y *transportar*; no puede *decidir*.
4. **Todo reversible por variable de entorno**, con el valor por defecto igual
   al comportamiento actual.
5. **Un cambio, una medición, un criterio de aceptación.** Nada de lotes.
6. **Honestidad sobre lo no medido.** Toda ganancia proyectada se marca como
   proyectada hasta tener el número real.

---

## 3. Optimización de los modelos: qué ya está resuelto

Extraído de `docs/planes-recuperados/PLAN_RENDIMIENTO_RAG.md`. **Son cifras
medidas contra la API real**, no estimaciones. Esto ya está activo — no hay
que rehacerlo, y no hay que volver a proponerlo.

| Acción | Veredicto | Cifra medida |
|---|---|---|
| `thinkingLevel: MINIMAL` en el parser de intención | activo | 4.478 ms → 1.263 ms p50 (**3,5x**), 12/12 estable |
| `GEMINI_CHAT_THINKING_LEVEL=low` en el turno de chat | activo | 14.047 ms → 7.166 ms p50 (**-49%**), 7/7 diálogos estables |
| Corregir el comentario falso de `taskType` | hecho | Vectores idénticos bit a bit; norma L2 = 1.0 |
| `gemini-3.5-flash-lite` para el parser | revertido | Falla clasificación de intención hasta 5/8 |
| Paralelizar la escalera de relajación | revertido | 0 ganancia en 2 corridas; contención de pool descartada |
| Caché implícito de Gemini | medido: **no engancha** | 15/15 llamadas con `cachedContentTokenCount = 0` |
| Caché semántico de consultas | descartado | 236 consultas únicas de 238 (0,8% de repetición) |
| Fusionar el parser en el tool loop | descartado | Ahorra 850 ms a costa del aislamiento del schema |

**Ganancia combinada ya capturada:** un turno típico pasó de ~12,5 s estimados
a 4-5 s reales.

### 3.1 Qué significa hoy que el caché implícito no enganche

El prefijo estático medido en agosto era de **4.575 tokens** (system prompt
3.420 más declaraciones de 5-6 herramientas ~1.163), por encima del umbral de
4.096 de Gemini. Aun así, **no se cachea nada**: 15 de 15 llamadas devolvieron
cero tokens cacheados, incluyendo cinco idénticas en ráfaga paralela.

**Esa cifra está desactualizada y hoy es mayor.** La medición es del 2026-08-20
y `BLOQUE_PLAN` se añadió después. El system prompt actual, sumando sus bloques
(`SYSTEM_PROMPT_BASE` 6.068 + `BLOQUE_SELECCION` 3.064 + `BLOQUE_RAG` 6.610 +
`BLOQUE_FRANJAS` 2.108 + `BLOQUE_PLAN` 5.152), son **23.002 caracteres** —
del orden de 5.700 tokens solo el prompt, antes de las declaraciones de
herramientas. El coste de que el caché no enganche es por tanto
aproximadamente el doble de lo que el plan original estimó.

Consecuencia: se paga entrada completa por ese prefijo en **cada vuelta del
tool loop**, y el loop admite hasta 10 vueltas
(`packages/agente-core/src/ejecutar.ts:56`).

El caché **explícito** (`client.caches.create()`) resolvería eso con hasta 90%
de descuento en la porción cacheada. **No se implementa en este plan**, por la
razón que el plan original ya dio y que sigue vigente: el escenario que lo
justifica es tráfico concurrente de varios usuarios compartiendo el prefijo en
una ventana corta, y hoy el uso es de un solo desarrollador. Gestionar el ciclo
de vida del `CachedContent` (creación, TTL, facturación mínima por tiempo de
vida, invalidación al cambiar el prompt) es complejidad de mantenimiento real a
cambio de un ahorro absoluto insignificante en este patrón de uso.

**Queda como el primer punto a reevaluar en cuanto haya tráfico real**, con
datos de ese tráfico y no con una proyección. La Fase 1 deja la telemetría que
hará posible tomar esa decisión con números.

---

## 4. Lo que queda abierto, con evidencia

Hallazgos de esta revisión, no cubiertos por el plan recuperado. Los dos
primeros salieron de las auditorías de los anexos y son los de mayor impacto.

### 4.0 Las imágenes se reenvían en cada vuelta del tool loop

Cuando el cliente adjunta la foto de su espacio o imágenes de referencia, el
`base64` queda pegado al último mensaje de usuario
(`src/app/api/chat/route.ts:200-230`) y `historialAContents` lo vuelve a
convertir en `inlineData` **en cada conversión del historial**
(`packages/agente-core/src/gemini/chat.ts:27-41`). El historial se reconstruye
entero en cada vuelta, así que la imagen se sube de nuevo en cada una de hasta
10 vueltas.

Peor: **`limitarHistorialChat` no cuenta el base64** en su presupuesto. Suma
solo `message.content.length` (`src/lib/ia/historial-chat.ts:13-18`), así que
una petición con imágenes puede cumplir el límite de 16.000 caracteres de texto
y aun así arrastrar megabytes. El único tope real es el body HTTP de 25 MB
(`src/app/api/chat/route.ts:147-153`).

Es, con diferencia, el mayor desperdicio identificado en el camino de chat, y
no aparecía en el plan de rendimiento original.

### 4.0.1 El mismo objeto alimenta al modelo y a la UI

Los handlers construyen un payload rico que sirve simultáneamente como
resultado para la UI y como entrada del siguiente prompt
(`packages/agente-core/src/ejecutar.ts:115-120`). No hay proyección específica
para el modelo.

El caso más claro: el pool por rol de la búsqueda con presupuesto incluye un
campo `imagen` (`src/lib/rag/chat/buscar-presupuesto.ts:17-26,290-302`) que se
envía a un modelo de texto que no puede usarlo. Una búsqueda por franja puede
mandar entre 6 y 15 KB de JSON por vuelta.

### 4.1 `image-qa.ts` razona en `medium` por defecto

`src/lib/ia/image-qa.ts:95-103` llama a `generateContent` con `MODELO_CHAT`
(`gemini-3.6-flash`), `responseMimeType: "application/json"` y un
`responseJsonSchema` — es decir, **extracción estructurada a un schema
cerrado**, exactamente el caso donde `MINIMAL` se midió 12/12 estable en el
parser. Pero **no pasa `thinkingConfig`**, así que usa el default `medium`.

Corre al menos una vez por generación de imagen, y otra vez si se dispara el
reintento correctivo. Es la misma optimización que ya dio 3,5x en el parser,
aplicada a una llamada que se pasó por alto.

Contraste: `src/lib/happie/conversacion-webhook.ts:74` y
`packages/happie-package-ia/src/recomendador.ts:120` **sí** usan `MINIMAL`.
`analizarReferenciasV2` pasa por `ChatPort`, así que hereda
`GEMINI_CHAT_THINKING_LEVEL=low`. `image-qa.ts` es el único hueco.

### 4.2 El cliente de Gemini se instancia en cada llamada

`src/lib/gemini.ts:6` construye un `new GoogleGenAI({ apiKey })` en cada
`getGeminiClient()`, y `packages/agente-core/src/gemini/chat.ts:126` hace lo
mismo dentro de `cliente()`, que se invoca en cada `turno()` y cada
`turnoStream()`. No hay reuso de instancia ni, por tanto, del agente HTTP
subyacente entre llamadas.

Ganancia **no medida**. Es la clase de cambio que hay que medir con el arnés
antes de afirmar nada: puede ser ruido, o puede ser un handshake TLS por vuelta
del loop.

### 4.3 El pool de PostgreSQL no tiene ningún límite configurado

`src/lib/rag/db.ts:12`:

```ts
globalThis.__ragPool = new Pool({ connectionString: url });
```

Sin `max` (queda en el default de `pg`, que es 10), sin `idleTimeoutMillis`,
sin `connectionTimeoutMillis` y sin `statement_timeout`. Una query colgada no
tiene tope, y con `RAG_FRANJAS_ENABLED` un turno puede disparar hasta 25
queries concurrentes (5 roles × 5 intentos de la escalera) contra un pool de 10.

Nota honesta: el plan de rendimiento ya probó subir el pool a `max: 50` como
diagnóstico y **no mejoró la latencia**. Eso descarta la contención como causa
de aquel problema concreto, pero no convierte "pool sin configurar y sin
timeout de statement" en una decisión deliberada. Esto es robustez, no
velocidad, y así se presenta.

### 4.4 Las herramientas se ejecutan estrictamente en serie

`packages/agente-core/src/ejecutar.ts:113-118` y `:180-186` recorren las
llamadas del turno con `for...of` y `await` dentro. Si el modelo pide dos
búsquedas de catálogo independientes en la misma vuelta, se pagan las dos
latencias en fila.

Paralelizar solo es seguro para handlers de **solo lectura y sin efectos**.
Cualquier herramienta que escriba, cotice, apruebe o registre auditoría debe
seguir en serie y en el orden que emitió el modelo. Requiere marcar los
handlers explícitamente en el registro; no se puede inferir.

### 4.5 El truncado del historial es por caracteres

`src/lib/ia/historial-chat.ts:3` corta en 16.000 caracteres contando desde el
final. Es simple y predecible, que es una virtud. Pero corta por caracteres, no
por tokens, y desplaza el contenido entre turnos.

Con el caché implícito confirmado como inactivo, el impacto sobre caché es nulo
hoy. El impacto sobre tokens de entrada sí es real y no está medido.

### 4.6 No hay forma de saber cuánto cuesta una conversación

La telemetría son 50 eventos en memoria. No hay coste por modelo, no hay
`request_id`, no hay versión de prompt, no sobrevive a un reinicio. Existe
`rag_query_log` en PostgreSQL (migración 004) para telemetría de retrieval,
pero los tokens del turno de LLM no llegan ahí.

Sin esto, "coste por conversación" no se puede responder ni optimizar, y la
decisión sobre el caché explícito no se puede tomar con datos.

### 4.7 Las rutas de control de los webhooks Happie responden fuera de contrato

Detectado al mezclar `main`. `ejecutarWebhook` construye sus respuestas con
`Response.json` directo (`src/lib/happie/webhook-control.ts:173-175`), sin
pasar por `respuestaWebhook`, que es quien valida contra
`HappieErrorV1Schema` y añade `schema_version`.

Consecuencia: el camino feliz y el de autenticación sí van sobre contrato, pero
las rutas de control nuevas **no**:

| Ruta | Estado |
|---|---|
| Solicitud inválida | 400 |
| Límite de solicitudes excedido | 429 |
| Solicitud en curso | 409 |
| Cancelada por el cliente | 408 |
| Deadline agotado | 504 |
| Servicio no disponible | 503 |

Ninguna lleva `schema_version`. No es un descuido de quien escribió el módulo:
la capa de contratos no existía en la base sobre la que trabajó. Pero un
integrador externo que valide la respuesta contra el schema publicado la
rechazará.

El arreglo es mover el responder que normaliza contra el contrato a
`webhook-control.ts` y que los dos módulos de webhook lo importen desde ahí.
Hacerlo al revés —que `webhook-control` importe de
`recomendar-paquetes-webhook`— crea un ciclo de imports, que `AGENTS.md`
prohíbe. Entra en la Fase 3 como 2.13.

---

## 5. Fases 1 a 10

### Fase 1 — Consolidación, rescate y arnés de medición

**Sin gates externos. Es la fase más barata y desbloquea todas las demás.**

| # | Entrega | Estado | Criterio de aceptación |
|---|---|---|---|
| Fase 1.1 | Commit del trabajo de etapas 1-4 en rama, en slices por frente. `main` intacto | **Hecha** | `git status` limpio; `main` en `c89cda1`; 7 commits; sin archivos perdidos respecto al inventario de 1.4 |
| Fase 1.2 | Planes recuperados en `docs/planes-recuperados/` y comentarios de código apuntando a una ruta que existe | **Hecha** | Los 6 comentarios de 1.4(5) resuelven a un archivo existente |
| Fase 1.3 | **Migraciones seguras**, capítulo 10: confirmación de destino, checksum, advisory lock, transacción sobre un solo cliente, validación de numeración, `--dry-run`, `--target`, y la colisión 016 corregida con su reconciliación | **Hecha** | 7 pruebas contra PostgreSQL Docker desechable: gate remoto aborta sin conectar, dry-run deja 0 tablas, 19 migraciones con 19 checksums, segunda corrida 0 nuevas, checksum alterado falla, renombrado reconcilia sin re-aplicar, prefijo duplicado falla |
| Fase 1.4 | **Arnés de medición** `npm run ia:bench`. Mide por turno: latencia de parseo, retrieval, TTFT, turno completo, vueltas del loop, tokens de entrada/salida/pensamiento/cacheados, bytes de imagen enviados, y coste estimado por modelo | Pendiente | Reproduce las cifras del capítulo 3 con ±15% |
| Fase 1.5 | **Telemetría durable y taxonomía de IA**, capítulo 9. Migración `021_ai_call_log.sql`, tabla de precios versionada, catálogos cerrados de `flujo` y `capacidad`, y `thoughtsTokenCount` leído del SDK. Cubre las once llamadas de IA, no dos. El buffer en memoria se conserva para el panel en caliente | Pendiente | Los 8 flujos y las 12 capacidades emiten evento; la telemetría sobrevive un reinicio; un fallo al registrar no rompe un turno |

**Salida:** existe una línea base numérica del sistema tal como está hoy, y
aplicar una migración dejó de ser una operación peligrosa. Sin lo primero,
ninguna afirmación de la Fase 3 es verificable; sin lo segundo, la propia
migración de Fase 1.5 es un riesgo.

**Nota sobre Fase 1.5:** es la entrega que atiende directamente "coste por
conversación" y "diferenciar cada IA". No reduce el coste todavía — lo hace
visible y atribuible, que es el requisito previo de todo lo demás.

---

### Fase 2 — CI y gates de calidad

**Sin gates externos, salvo un permiso de repositorio en 2.5.** Va
inmediatamente después de la Fase 1 porque protege todo lo que viene después.

#### El hueco, verificado

`.github/workflows/deploy.yml` es el **único** workflow del repositorio. Su
disparador es `on: push: branches: [main]` y su único paso es un SSH al EC2 que
ejecuta `/home/ec2-user/deploy-demo-decoracion.sh`.

No hay `needs:`, no hay `workflow_run`, no hay un solo check antes de
desplegar. **Cualquier push a `main` va al servidor sin lint, sin `tsc`, sin
tests y sin build.** Y hoy hay más de un agente commiteando a `main` en
paralelo.

`AGENTS.md` exige exactamente lo contrario, en dos frases:

> "add PR checks for lint, application/package types, relevant tests, and
> build; deploy only the same revision that passed the required checks"
>
> "Verify the remote deployment script and branch protections before claiming
> deployment is gated. Document controls as pending until implemented and
> tested."

Los comandos de verificación existen y pasan — se corrieron a mano durante la
Fase 1 y la mezcla de `main`. Lo que no existe es nada que los obligue.

La protección de rama sobre `main` **no se pudo verificar**: `gh` no está
instalado en este entorno. Se documenta como desconocida, no como ausente.

#### Entregas

| # | Entrega | Criterio de aceptación |
|---|---|---|
| Fase 2.1 | Workflow de checks en pull request y en push: `lint`, `tsc --noEmit`, build de workspaces, build de Next, `contracts:check` y las cuatro suites de contratos, `plan:test`, `chat:test-historial`, `happie:test-webhook`, `test-python-adapter`, `test-idempotency-store` | Un PR con un error de tipos queda en rojo |
| Fase 2.2 | Job Python: `ruff check`, `ruff format --check`, `mypy`, `pytest`, `uv lock --check` y `generate_models.py --check` | Un drift en los modelos generados queda en rojo |
| Fase 2.3 | **Gate del despliegue.** `deploy.yml` deja de dispararse en push y pasa a depender del workflow de checks **del mismo SHA**, por `workflow_run` con `conclusion == success` o por un job con `needs:` | Un push a `main` con checks rojos **no** despliega, demostrado con un commit de prueba que falle a propósito |
| Fase 2.4 | PostgreSQL efímero en CI con `pgvector/pgvector:pg16` para lo que lo necesita: `rag:migrate:check`, el store de idempotencia y las pruebas de webhook | Esas pruebas corren en CI sin credenciales ni base remota |
| Fase 2.5 | Protección de rama en `main`: verificar si existe y, si no, solicitarla. **Requiere permisos de administrador del repositorio; no es una tarea que el implementador pueda cerrar solo** | Estado documentado con evidencia, no supuesto |
| Fase 2.6 | Ninguna prueba de CI llama a un proveedor pagado. La clasificación L / DB / M / P de la Etapa 1 dice cuál es cuál | Un CI completo cuesta cero en Gemini y en fal.ai |

#### Salida

Un PR que rompe tipos, lint, contratos o tests no se puede mergear, y una
revisión que no pasó los checks no llega al EC2. Mientras 2.5 siga sin
confirmarse, el plan dice "gate parcial", no "gate".

---

### Fase 3 — Optimización de la interacción con Gemini, en TypeScript

**Sin gates externos.** Cada punto se mide contra el arnés de la Fase 1, se
activa por variable de entorno con default en el comportamiento actual, y no
entra si su regresión no está verde.

Orden revisado tras la auditoría del anexo A. El punto Fase 3.1 pasó a ser el
primero: es el mayor desperdicio del camino de chat y no estaba identificado
antes de esta revisión.

| # | Cambio | Referencia | Ganancia esperada | Riesgo |
|---|---|---|---|---|
| Fase 3.1 | **No reenviar las imágenes inline en cada vuelta del loop.** Hoy el base64 de la foto del espacio y las referencias se re-serializa en cada una de hasta 10 vueltas, y `limitarHistorialChat` **no cuenta el base64** en su presupuesto de 16.000 caracteres — el tope real es el body HTTP de 25 MB | `src/app/api/chat/route.ts:204-230`, `packages/agente-core/src/gemini/chat.ts:27-41`, `src/lib/ia/historial-chat.ts:13-18` | **Alta** en cualquier turno con foto: cientos de KB a varios MB por vuelta. **No medida** | Medio — el modelo debe seguir viendo la imagen y su `IMAGEN_ID` |
| Fase 3.2 | **Proyección compacta del resultado de herramienta para el modelo**, separada del payload de UI/telemetría. El caso más claro: `pool_por_rol` envía un campo `imagen` a un modelo de texto que no puede usarlo | `src/lib/rag/chat/buscar-presupuesto.ts:17-26,290-302`, `src/lib/ia/registro-herramientas.ts:402-434,810-836` | **Alta** sobre tokens de entrada en búsquedas por franja y confirmación de plan. **No medida** | Medio — no puede perder ids, precios, tamaños, evidencia ni sustituciones |
| Fase 3.3 | `thinkingLevel` explícito en `observarImagenGenerada` | `src/lib/ia/image-qa.ts:95` | Proyectada por analogía con el parser (3,5x en esa llamada). **No medida** | Bajo — extracción a schema cerrado |
| Fase 3.4 | Filtrar variantes en SQL en vez de traerlas todas y filtrarlas en JavaScript | `src/lib/rag/chat/buscar.ts:213-239`, `src/lib/rag/chat/buscar-presupuesto.ts:235-247` | Media/alta en productos con muchas presentaciones. **No medida** | Medio — la semántica de whitelist debe conservarse exactamente |
| Fase 3.5 | Batch de `resolverVariantesPorDespiece`: hoy es un `SELECT` por cada ítem `usar_despiece` (N+1 real) | `src/lib/ia/registro-herramientas.ts:527-561`, `src/lib/rag/tamanos/resolver.ts:47-64` | Media en planes con varios colores/productos. **No medida** | Medio — no puede cruzar variantes entre familias |
| Fase 3.6 | Cliente Gemini reutilizado en vez de instanciado por llamada. En el camino SSE real es **una instancia por vuelta del loop**, no por request | `src/lib/gemini.ts:6`, `packages/agente-core/src/gemini/chat.ts:122-130` | **No medida**. Puede ser ruido | Bajo |
| Fase 3.7 | Pool PostgreSQL con `max`, timeouts y `statement_timeout` | `src/lib/rag/db.ts:12` | Robustez, no velocidad | Bajo |
| Fase 3.8 | Sacar de la ruta crítica los INSERT/UPDATE de observabilidad (`registrarBusqueda`, `registrarSeleccion`, `registrarPlanAudit`) con un outbox durable | `src/lib/ia/registro-herramientas.ts:385-400,461-472,582-602` | 1+ round-trip PG menos por herramienta. **No medida** | Medio — la trazabilidad debe seguir siendo durable |
| Fase 3.9 | Herramientas de solo lectura en paralelo dentro de una vuelta | `packages/agente-core/src/ejecutar.ts:188-199` | Ahorra una latencia de herramienta cuando el modelo pide 2+ | Medio — exige marcar handlers |
| Fase 3.10 | Revisar el truncado de historial (caracteres → tokens, y que cuente el base64) | `src/lib/ia/historial-chat.ts:3` | **No medida** | Bajo |
| Fase 3.11 | **Honestidad estructural en la UI** (capítulo 11.1): renderizar `filtro_relajado`, `match_level`, `sustituciones`, `sin_cobertura` y `rechazados` como elementos propios, independientes de lo que el modelo escriba | `src/lib/ia/registro-herramientas.ts:474-509,611-635`, `src/app/page.tsx` | No es de latencia: **reduce el riesgo de todo lo demás de esta etapa** | Bajo — solo añade, no quita |
| Fase 3.12 | **Pantalla de consumo de IA por flujo** (capítulo 11.3): tarjetas por funcionalidad, desglose por capacidad, coste por conversación de punta a punta | `src/components/admin/MotorIATab.tsx:128-143` | Hace visible el resultado de Fase 3.1 a 2.10 | Bajo |
| Fase 3.13 | **Rutas de control de los webhooks Happie sobre contrato** (capítulo 4.7): mover el responder que normaliza a `webhook-control.ts` para que 400, 429, 409, 408, 504 y 503 lleven `schema_version` | `src/lib/happie/webhook-control.ts:173-175` | Corrección de contrato, no de latencia | Bajo — `happie:test-webhook` cubre las seis rutas |

**Por qué Fase 3.11 va en esta etapa y no en una de UI aparte:** parte de lo que hoy
vigila el set de regresión conversacional —que el modelo confiese una
sustitución o un filtro relajado— pasa a ser una propiedad del sistema. Eso
baja el riesgo de tocar el razonamiento del modelo, que es exactamente lo que
hace el resto de la etapa.

**Estado real al 2026-09-09** (evidencia, no plan): 3.1 a 3.11 y 3.13 —
implementadas, verificadas (tsc/lint/build + regresión real contra
Postgres local o `happie:test-webhook` según el caso) y desplegadas a
producción, cada una en un commit propio de `main`. **3.12 queda
explícitamente bloqueada**, no por dificultad técnica sino por la propia
precondición que fija el orden revisado más arriba ("después de que
3.1/3.2/3.3 tengan datos reales en `ai_call_log`"): una consulta de
solo lectura contra la Neon de producción el 2026-09-09 mostró **2 filas
totales** en `ai_call_log`, ambas de flujos `happie_*` de pruebas de
verificación de esta misma sesión, **cero filas de `armador_decoracion`**
(el chat principal). Construir el desglose por flujo/capacidad y coste
por conversación ahora mismo sería una UI sin datos reales contra los
que validar la agregación — se retoma cuando haya tráfico real del chat
principal instrumentado por 3.1/3.2/3.3.

**Regresiones obligatorias antes de activar cualquiera:**
`npm run rag:eval-parser`, `npm run rag:eval-chat`, `npm run plan:test`,
`npm run contracts:test` y sus variantes, `npx tsc --noEmit`, `npm run lint`.

**Explícitamente fuera de alcance en esta etapa:** caché explícito de Gemini
(ver 3.1), cambio de modelo para el parser (ya medido y revertido), caché
semántico (ya descartado), fusionar el parser en el tool loop (ya descartado).

**Salida:** cada cambio con antes/después medido en el mismo arnés. Los que no
muestren ganancia se revierten y se documenta la medición, igual que se hizo
con `flash-lite` y con la escalera paralela.

---

### Fase 4 — Seguridad, secretos y superficie externa

**Sin gates externos para el análisis; la rotación sí necesita acceso a las
cuentas proveedor.** Va antes de la Fase 6 porque el staging necesita un
secreto provisionado y rotable, no uno improvisado.

#### Por qué existe esta fase

El plan tenía seguridad repartida entre los invariantes y los criterios de
salida, pero ninguna fase la trataba como trabajo propio. Y hay una superficie
de riesgo que **ninguna auditoría de este plan había mirado**: el contenido no
confiable que llega al modelo.

`bloqueReferencia` inyecta en el system prompt el resultado de analizar una
imagen que subió el cliente (`src/lib/ia/prompt-sistema.ts:173-186`), con
nombres de elemento y colores observados que salen de ese análisis. El
recomendador Happie inyecta el catálogo remoto de Happia
(`packages/happie-package-ia/src/recomendador.ts:104`). Los dos son datos que
no controlamos y que terminan dentro del prompt.

El modelo ya no es autoridad de nada comercial —eso está bien resuelto por el
invariante 1 y por la whitelist same-turn— así que el daño posible está
acotado. Pero "acotado" no es lo mismo que "analizado", y nadie lo ha
analizado.

#### Entregas

| # | Entrega | Criterio de aceptación |
|---|---|---|
| Fase 4.1 | Inventario de secretos: cuáles existen, dónde viven, quién los rota, y qué pasa si se filtra cada uno. Hoy `.env.local` tiene al menos `GEMINI_API_KEY`, `FAL_KEY`, `APP_PASSWORD`, `DATABASE_URL` de Neon, `PLAN_APPROVAL_SECRET`, `SHOPIFY_WEBHOOK_SECRET` y tres claves de Happie | Un documento con una fila por secreto, sin ningún valor |
| Fase 4.2 | Escaneo de secretos en CI y sobre el histórico completo | Cero hallazgos, o una lista de los que hay que rotar |
| Fase 4.3 | **Análisis de inyección de prompt** por las dos vías de arriba. Qué puede lograr un cliente con una imagen preparada y qué puede lograr Happia con un catálogo manipulado | Un informe con las rutas probadas y el resultado real, no una afirmación de que "está acotado" |
| Fase 4.4 | Procedimiento de rotación escrito y **probado** para cada secreto | Rotar el HMAC interno no tumba el servicio; rotar la clave de Gemini tampoco |
| Fase 4.5 | Superficie externa por endpoint: qué expone, qué CORS aplica, qué rate limit tiene y con qué credencial. **Hallazgo nuevo de la auditoría 4.0** (`auditoria/08-revision-fase-4.md` sección 5a): `src/proxy.ts` (gate de autenticación por `APP_PASSWORD`, no mencionado en ninguna versión previa de este plan) no excluye `/api/rag/webhooks/shopify` de su matcher; un POST server-to-server de Shopify sin cookie de sesión recibiría un redirect a `/login` en vez de 2xx/401, lo que rompería silenciosamente la sincronización de catálogo si ese webhook está en uso real (sin confirmar — ver preguntas abiertas del informe). Se corrige como parte de esta entrega, antes de 4.4 | Los webhooks Happie ya tienen rate limit por credencial; el resto queda inventariado, incluida la corrección del matcher de `proxy.ts` si el webhook de Shopify está activo |

#### Salida

Los secretos tienen dueño y procedimiento de rotación, y la frontera de
contenido no confiable está analizada con evidencia. Si el análisis de 4.3
encuentra algo explotable, se arregla en esta fase y no se aplaza.

---

### Fase 5 — Resiliencia, recuperación y degradación

**Sin gates externos.**

#### Por qué existe esta fase

Hay tres cosas que el plan daba por hechas sin estarlo:

1. **Reversión de migraciones.** 19 archivos sin nota `-- rollback:` (corregido:
   ver `auditoria/09-revision-fase-5.md` sección 1 — el conteo de 18 ya
   subestimaba el universo real incluso en el commit donde se fijó). El runner
   avisa desde la Fase 1.3, pero avisar no es tener el procedimiento.
2. **Recuperación de datos.** No hay procedimiento de backup ni de restore
   documentado para la base comercial. `data/` está casi todo en `.gitignore` y
   el SQLite es generado. Los artefactos LoRA viven en filesystem y se
   sincronizan al EC2 por SSH.
3. **Degradación.** `IMAGE_QA_ENABLED` queda activo si la variable no existe, y
   los flags están en tres sitios con tres convenciones distintas
   (`src/lib/ia/feature-flags.ts`, `src/lib/rag/flags.ts`, y `process.env`
   directo). Nadie ha probado qué pasa cuando Gemini está caído, cuando fal.ai
   no tiene saldo, o cuando PostgreSQL no responde.

El patrón correcto ya existe en el repo y sirve de precedente: cuando el
observador de QA no está disponible, `buildQa` devuelve `pass: null` y no
`pass: true` (`src/app/api/generate/route.ts:604-607`). No fabrica éxito. Eso
hay que generalizarlo, no inventarlo.

#### Entregas

| # | Entrega | Criterio de aceptación |
|---|---|---|
| Fase 5.1 | Nota `-- rollback:` en las **19** migraciones que no la tienen (corregido por auditoría 5.0, ver `auditoria/09-revision-fase-5.md`). Cierra 10.3(g) | El aviso del runner desaparece porque el problema se resolvió, no porque se silenció el aviso |
| Fase 5.2 | Backup y restore de la base comercial: procedimiento escrito y **ejecutado una vez** contra una copia | Un restore verificado, no una afirmación de que se podría |
| Fase 5.3 | Registro único de capacidades de IA con default explícito por cada una (capítulo 12.3). Auditoría 5.0 encontró un cuarto archivo de flags no citado (`src/lib/plan/flags.ts`) y una reimplementación duplicada de `IMAGE_INSTANCE_QA` en dos archivos con lógica de default distinta — ver `auditoria/09-revision-fase-5.md` secciones 2 y 5 | Ningún flag queda activo por omisión sin que esa sea la decisión escrita |
| Fase 5.4 | **Degradación probada por capacidad**: proveedor caído, sin saldo en fal.ai, PostgreSQL no disponible, embeddings fallando, store de idempotencia no alcanzable. Auditoría 5.0: las ramas FTS/trigram de retrieval no capturan la caída de Postgres (`throw` no capturado, tumba el turno) mientras la rama vectorial sí degrada correctamente — no es un solo caso, son dos con estado distinto | Cada caso degrada de forma observable, con un error estable, y **ninguno fabrica éxito** |
| Fase 5.5 | Inventario de artefactos LoRA y cómo se recuperan si se pierde el filesystem o el volumen del EC2. **Corregido por auditoría 5.0:** los pesos `.safetensors` no viajan por la sincronización SSH al EC2 — esa solo mueve estadísticas y galería del dataset. Los pesos viven como URL de fal.ai y, si acaso, en una copia manual local (`data/lora-backup/`) de quien corrió `scripts/recibir-lora.ts`, no replicada ni versionada. Ver `auditoria/09-revision-fase-5.md` secciones 2 y 5 | Se sabe qué es irrecuperable y qué no, antes de necesitarlo |

#### Salida

Para cada dependencia externa hay una respuesta probada a "¿y si esto no
está?". La que hoy no tiene respuesta es todas.

---

### Fase 6 — Staging real del backend Python

**Destino confirmado — y actualizado por la auditoría 6.0** (`auditoria/10-revision-fase-6.md`, con acceso real de solo lectura autorizado explícitamente por el usuario): EC2 `n8n-maros` ya **sirve un despliegue vivo de `demo-decoracion`** (no solo "está listo para desplegar"), compartido con otros tres proyectos activos en la misma máquina. PostgreSQL Neon confirmado y con datos reales: solo existe el schema `public` (el schema `operational` de la condición de abajo todavía no existe), y las migraciones aplicadas en Neon llegan hasta `019_happie_webhook.sql` — **020 y 021 (Fase 1.5, esta sesión) no están aplicadas en Neon todavía**.

**Hallazgo crítico de la auditoría 6.0, no anticipado por este plan:** el gate de CI/CD de la Fase 2 (`checks.yml`, `deploy.yml` gateado por `workflow_run`, script de deploy con validación de SHA) existe solo en el commit local de la rama de trabajo — **`main` no tiene `checks.yml`, el `deploy.yml` real de `main` sigue disparando por `push` sin ningún gate, y el script ejecutable real del EC2 (`/home/ec2-user/deploy-demo-decoracion.sh`, fuera del checkout de git) es la versión vieja sin validación de SHA.** Mientras esto no se mergee y se despliegue, cualquier push a `main` de cualquier agente sigue desplegando sin checks al mismo servidor que ya sirve tráfico. Esto debe resolverse antes de que la Fase 6 genere más actividad de despliegue (ver orden en el informe de auditoría, sección 4).

**Actualización (2026-09-08, mismo día): el gate se mergeó y se ejecutó contra `main` real por primera vez — y encontró cinco problemas reales que nunca se habían probado, más un bug de producción preexistente en el webhook de Happie (503 por un schema Zod que no aceptaba `description: null`, el estado real de la API de Happia).** Los cinco (drift de contratos, Python sin paquete instalable, modelos Python desactualizados, un test de cancelación con timing frágil, y un build de workspace faltante en el job de CI) se corrigieron en cadena hasta que `Quality checks` pasó de verdad y `Deploy to EC2` se disparó por primera vez — que a su vez reveló que el script real del EC2 tenía finales de línea CRLF de una copia manual anterior, también corregido. Los tres webhooks de Happie se verificaron con llamadas reales y autenticadas tras el despliegue: `200` con recomendaciones reales. Detalle completo, línea de tiempo y lecciones en `resiliencia/incidente-2026-09-08-happie-503.md`.

**El mismo día, con autorización explícita del usuario en cada paso, se completó el criterio de salida entero de esta fase contra infraestructura real:** schema `operational` migrado en Neon (`services/ai-api/scripts/migrate.py`, nuevo runner Python con las mismas garantías que `scripts/migrate.ts`), rol Postgres restringido `demo_decoracion_ai_api` creado y verificado (confirmado con una conexión real que puede leer/escribir `operational.*` y recibe "permission denied" al intentar leer `public.catalog_products`), backend Python desplegado y sano en el EC2 (`demo-decoracion-ai-api`, red interna `stack_web`), contrato `operational.v1` validado con una llamada real Next→Python (`backend: "python"` en la respuesta), canario controlado, y **rollback comprobado de verdad**: con `PYTHON_BACKEND_ENABLED=true` activo, `PYTHON_BACKEND_KILL_SWITCH=true` forzó `backend: "next"` en el redeploy siguiente. El webhook de Happie se verificó en `200` después de cada uno de los redeploys de esta secuencia. Al final de la sesión ambos flags se dejaron explícitamente en `false` — la validación de hoy no equivale a una decisión de cutover, que sigue siendo alcance de la Fase 10. Detalle completo en `resiliencia/fase-6-progreso-2026-09-08.md`.

**Condición no negociable:** las tablas operacionales van a un **schema
separado** dentro de Neon, nunca mezcladas con las tablas comerciales del
catálogo. El servicio Python no recibe permisos de lectura sobre catálogo,
precios ni inventario en esta etapa.

El contenido técnico de esta etapa ya está escrito y sigue siendo válido: es el
cuerpo de [`prompt-seguimiento-etapa-5.md`](prompt-seguimiento-etapa-5.md),
puntos 2 a 7 (provisionar configuración, aplicar y verificar SQL, desplegar el
backend, validar contrato en staging, canary reversible, probar rollback). No
se reescribe aquí; se adopta.

Lo único que cambia respecto a ese documento es el punto 1 ("confirmar
staging"), que ya está resuelto por la decisión de arriba.

**Salida:** el criterio de salida de `prompt-seguimiento-etapa-5.md`, sin
rebajarlo. Si falta secreto, base o evidencia, la etapa queda en progreso y se
documenta el siguiente paso exacto. No se afirma tráfico remoto no ejecutado.

---

### Fase 7 — Carga, concurrencia y presupuesto de latencia

**Sin gates externos.** Va después del staging porque medir carga contra el
entorno desplegado dice más que medirla en un portátil, pero el escenario se
construye antes y se puede correr en local.

#### Por qué existe esta fase

Todas las cifras del capítulo 3 vienen, según el propio plan que las produjo,
de "una sola máquina, una sola región y un solo momento", y la variabilidad de
red no está caracterizada. Nadie ha medido el sistema con más de una
conversación a la vez.

Y hay una aritmética que no cierra: en modo franjas un turno puede disparar
hasta 25 consultas concurrentes —5 roles por 5 escalones— contra un pool cuyo
`max` no está configurado y queda en el default de 10 de `pg`. La Fase 3.7
configura el pool, pero configurarlo no es lo mismo que saber cómo se comporta
saturado.

Además queda un límite que la Etapa 4 dejó abierto por escrito: la frontera de
cancelación llega a las consultas, pero **abortar una query en curso no está
probado** y depende del driver y del pool. Hasta que se pruebe, el sistema no
puede prometer cancelación física.

#### Entregas

| # | Entrega | Criterio de aceptación |
|---|---|---|
| Fase 7.1 | Escenario de carga reproducible con **proveedor falso**, para que medir no cueste dinero: N conversaciones concurrentes, p50/p95/p99 por flujo y ocupación del pool | Se puede repetir y comparar entre corridas |
| Fase 7.2 | Presupuesto de latencia por flujo, derivado de un requisito y del baseline medido | Ningún número inventado; si no hay requisito, se pide antes de fijarlo |
| Fase 7.3 | Comportamiento bajo saturación: qué se degrada primero, y si el usuario recibe un error estable en vez de un timeout ciego | Documentado con la corrida que lo demuestra |
| Fase 7.4 | **Cancelación física de una query PostgreSQL en curso**: probarla o declararla no soportada | Se deja de prometer lo que no se probó |

#### Salida

Se sabe cuántas conversaciones concurrentes aguanta y qué cede primero. Hoy no
se sabe ninguna de las dos cosas.

---

### Fase 8 — Primera capacidad de IA real en Python

Aquí la migración empieza a pagar. Se eligen capacidades donde el ecosistema
Python aporta algo que TypeScript no tiene, y que **no son autoridad
comercial**.

| # | Capacidad | Por qué Python | Límite duro |
|---|---|---|---|
| 8.1 | Suite de evaluación del RAG en `pytest` con fixtures versionados | Reemplaza evals `tsx` sueltos por una suite reproducible con reporte de varianza | Solo lee. Cero autoridad |
| 8.2 | **Reranking de candidatos** (cross-encoder local) | Mejora la precisión del retrieval **sin una llamada más a Gemini** | Recibe la lista que PostgreSQL ya autorizó y **solo puede reordenarla**. No puede añadir ni quitar un candidato |
| 8.3 | Embeddings en batch para reindexación del catálogo | Offline, fuera del camino del request | No toca el retrieval en vivo |

La restricción de 8.2 es lo que hace que el reranking sea seguro: la whitelist,
el filtro duro y la validación same-turn siguen siendo de PostgreSQL y
TypeScript. Python solo opina sobre el orden. Si el servicio Python cae o se
apaga por flag, el orden vuelve a ser el de PostgreSQL y nada más cambia.

**Salida:** reranking activo detrás de flag, con evaluación antes/después sobre
el ground truth existente (`eval/rag/ground-truth-v2.jsonl`), desactivable sin
tocar código, y con el resultado documentado aunque sea negativo.

---

### Fase 9 — Camino LoRA y generación de imagen

Los ejes son **seguridad del gasto primero**, luego fidelidad, luego coste. El
detalle con evidencia está en el anexo B.

La auditoría cambió el orden previsto: hay tres defectos de seguridad del gasto
que deben ir antes que cualquier optimización de calidad, porque hoy un
request puede pagar una generación que nadie puede reconciliar.

#### Fase 9.0 — Bloqueo previo (sin coste)

`PLAN-COMPOSICION-RICA-V001.md` §1.1 bloquea nuevas llamadas pagadas hasta
resolver la inconsistencia de atribución de identidad del LoRA: la URL
terminada en `0aa82cf2` (v004) aparece registrada junto al trigger
`eventdecor_style_v3` en tres manifiestos de experimento y en el fallback de
`src/lib/ia/sempertex-lora.ts:6-10`. **Esto se resuelve antes de gastar un
dólar más.**

#### Fase 9.1 — Seguridad del gasto

| # | Defecto | Referencia |
|---|---|---|
| a | **El `POST` a fal.ai no lleva clave de idempotencia.** Si el cliente pierde la respuesta de una sumisión que fal.ai sí ejecutó, no existe reconciliación local: se paga y no se sabe. `AGENTS.md` lo prohíbe explícitamente ("un timeout no prueba que el proveedor no ejecutó la petición") | `src/lib/ia/sempertex-lora.ts:134-153` |
| b | **El presupuesto temporal de fal.ai excede el de la ruta.** `POST` 110 s + polling 110 s + resultado 30 s + descarga 30 s = hasta 280 s, contra `maxDuration = 120`. Una ejecución lenta revienta el límite de la ruta con cada fetch individual dentro de su propio timeout | `src/lib/ia/sempertex-lora.ts:150-189`, `src/app/api/generate/route.ts:63` |
| c | **La generación de imagen de Gemini no recibe `AbortSignal` ni timeout.** El único límite es `maxDuration` | `src/lib/ia/gemini/imagen.ts:74-90` |
| d | **`/api/generate` no limita el tamaño de las imágenes de entrada** (`fotoEspacio`, `imagenesReferencia`, `previousGeneratedImage`), mientras `/api/references/analyze` sí lo hace (1-3 imágenes, MIME, 28 MB por imagen, dimensiones) | `src/app/api/generate/route.ts:65-107`, `src/app/api/references/analyze/route.ts:20-31` |
| e | **`cargarFoto` descarga sin validar** `Content-Length`, MIME, dimensiones ni allowlist de host | `src/app/api/generate/route.ts:140-150` |
| f | **No hay presupuesto de gasto** (capítulo 12.1). Nada impide repetir por accidente la sesión que gastó US$1.932 en 61 generaciones. Requiere el `ai_call_log` de la Fase 1; bloquea **antes** de la llamada, con umbral de aviso y umbral de corte | depende de 9.7 |

#### Fase 9.2 — Coste y latencia

| # | Cambio | Referencia | Nota |
|---|---|---|---|
| a | Filtrar los productos por los `catalog_product_ids` que el `SceneSpec` aprobó **antes** de `cargarFotosProducto`. Hoy se descargan todas las fotos y luego `buildInputs` descarta las que no caben | `src/app/api/generate/route.ts:916,563-590` | Alta en I/O y memoria |
| b | Caché de análisis de referencias compartido y persistente, con modelo, versión de prompt y modo en la clave. Hoy es un `Map` en proceso de 40 entradas que se pierde al reiniciar | `src/lib/ia/analizar-referencias-v2.ts:194-195,564-567` | Evita 2 llamadas Gemini por acierto |
| c | Resolver en paralelo el artifact LoRA y su allowlist; hoy son dos awaits consecutivos que consultan la misma tabla de slots | `src/app/api/generate/route.ts:677-684` | Media en latencia de BD |
| d | **`maxTokens` y `temperatura` son ignorados por el adaptador.** `analizar-referencias-v2.ts:569-584` los fija (6.000 y 4.000) pero `crearChatGemini` no los copia a la config de Gemini. Es un defecto de correctitud, no solo de coste: los límites que el código cree tener no existen | `packages/agente-core/src/gemini/chat.ts:141-153`, `packages/agente-core/src/tipos.ts:44-51` | Arreglar con fixtures de salida completa antes de fijar un número |
| e | Medir cuándo se ejecuta el QA visual de Gemini. `IMAGE_QA_ENABLED` queda **activo por defecto si la variable no existe**, y el QA corre incluso en caminos LoRA donde no hay reintento correctivo que lo aproveche | `src/lib/ia/feature-flags.ts:14-25`, `src/app/api/generate/route.ts:1145-1147` | **No tocar el gate de planes aprobados** |

**Peor caso inferido hoy:** camino Gemini base con QA fallido = 2 generaciones
+ 2 observaciones de visión. `compararLora` = 2 envíos fal.ai + 2 QA Gemini.
`/api/references/analyze` = hasta 6 intentos Gemini (2 turnos lógicos × 3
reintentos), sin clave de idempotencia.

#### Fase 9.3 — Fidelidad

Documentos vivos que esta etapa retoma, hoy huérfanos:
`PLAN-COMPOSICION-RICA-V001.md`, `PLAN-COMPOSICION-Y-CELEBRACIONES-V001.md`,
`PLAN-CAPTIONS-DATASET-V007.md`, `HANDOFF-LORA-COMPOSICION.md`.

Ninguna compactación del prompt de imagen entra sin evaluación A/B con los
mismos seeds e inputs: el modelo depende de prioridad, cardinalidad, venue,
colores, cantidades y prohibiciones, y compactar sin medir cambia la imagen
aunque no cambie ninguna regla comercial.

---

### Fase 10 — Cutover selectivo, runbook y entrega

| # | Entrega | Criterio de aceptación |
|---|---|---|
| Fase 10.1 | **Cutover por capacidad, no por ruta.** No hay cutover del handler de chat completo: se activa lo que la Fase 8 demostró que Python hace mejor y se deja en Next lo demás | Cada capacidad activada tiene su evidencia de antes/después y su flag de rollback |
| Fase 10.2 | **Runbook operativo.** Qué hacer cuando Gemini está caído, cuando fal.ai no tiene saldo, cuando hay que usar el kill switch, cuando una migración falla a mitad, cuando el gasto se acerca al tope. Se apoya en la degradación probada de la Fase 5.4 | Alguien que no escribió el código puede seguirlo |
| Fase 10.3 | Retirar el código temporal cuya **condición de remoción ya se cumplió** — no por antigüedad. Incluye `scripts/_tmp-populate-v004-stats.ts`, que debe promoverse a herramienta documentada o retirarse, y `AQUI.md` | Cada exención de regla que quede tiene motivo y condición de salida escritos |
| Fase 10.4 | **Un solo documento de estado.** Hoy hay siete documentos de plan compitiendo por ser el rector, más nueve recuperados. Consolidar en un rector, un runbook y los ADRs; archivar el resto sin borrarlo | Un lector nuevo sabe en un minuto qué documento manda |
| Fase 10.5 | Cerrar el ciclo del capítulo 3.1: con telemetría de tráfico real, decidir el caché explícito de Gemini **con datos** | La decisión queda documentada con las cifras que la sostienen, sea sí o sea no |
| Fase 10.6 | Cerrar 10.7: decidir si el esquema de numeración de migraciones sigue siendo un contador secuencial global | Decisión escrita, con su coste de migración si cambia |

---

## 6. Invariantes que ninguna fase puede romper

Cualquier cambio de este plan que toque uno de estos puntos se detiene y se
consulta antes de continuar.

1. El modelo **nunca** es autoridad de producto, variante, precio, stock,
   disponibilidad, cantidad ni aprobación.
2. `confirmar_seleccion_rag` rechaza cualquier `product_id`/`variant_id` que no
   venga de la respuesta de `buscar_catalogo_rag` del **mismo turno**.
3. La aprobación explícita del cliente precede a `/api/generate`. Ningún
   camino la puede saltar.
4. Las reglas de honestidad al sustituir (color, tamaño, forma) se conservan
   textualmente. Bajar el razonamiento del modelo no puede erosionarlas: es
   justo lo que el set de regresión conversacional vigila.
5. Merma, paquetes, unidades por paquete y redondeo de dinero se calculan en
   un solo lugar. No se duplican en Python.
6. `PYTHON_BACKEND_ENABLED` apagado por defecto.
   `PYTHON_BACKEND_KILL_SWITCH` gana siempre.
7. Ningún reintento puede duplicar un efecto pagado. Un timeout no prueba que
   el proveedor no ejecutó la operación.
8. No se borra ninguna ruta legacy hasta que su reemplazo pasó replay,
   observación y rollback controlado.

---

## 7. Qué no vamos a hacer, y por qué

| Propuesta | Veredicto | Razón |
|---|---|---|
| Caché explícito de Gemini | Aplazado a Fase 10 | Sin tráfico concurrente el ahorro absoluto es insignificante frente al coste de mantener el ciclo de vida del `CachedContent` |
| Caché semántico de consultas | Descartado | 0,8% de repetición medida sobre 238 consultas reales |
| Modelo más barato para el parser | Descartado | Medido: `flash-lite` falla clasificación de intención hasta 5 de 8 veces |
| Fusionar el parser en el tool loop | Descartado | Ahorra 850 ms a costa del aislamiento del schema determinista, que es lo que hoy impide que el modelo transporte un producto inventado |
| Índice HNSW/IVFFlat en pgvector | No aplica | 430 ms p50 sobre 1.672 filas; el retrieval es el 8% del problema |
| LangChain u otro framework de orquestación | No aplica | Agrega capas sobre las mismas llamadas; no quita round-trips ni tokens |
| Reescribir el resolver de plan en Python | Descartado | Duplicaría la autoridad comercial en dos lenguajes. `AGENTS.md` lo prohíbe explícitamente |
| Migrar el handler de chat completo a Python | Descartado | El cutover es por capacidad, no por ruta (Fase 10) |

---

## 8. Orden de ejecución

### 8.1 Dependencias

```
Fase 1  medición y migraciones seguras ─── sin gates
   │
   └─► Fase 2  CI y gates ─── sin gates ──────────► protege todo lo que sigue
          │
          ├─► Fase 3  optimización Gemini ────────► latencia y coste, medidos
          │
          ├─► Fase 4  seguridad y secretos ───────► prerrequisito del staging
          │      │
          │      └─► Fase 6  staging ── EC2 + Neon
          │             │
          │             ├─► Fase 7  carga y concurrencia
          │             │
          │             └─► Fase 8  capacidad de IA en Python
          │                    │
          │                    └─► Fase 9  LoRA y generación
          │                           │
          │                           └─► Fase 10  cutover, runbook y entrega
          │
          └─► Fase 5  resiliencia y degradación ──► independiente de la 3 y la 4
```

### 8.2 Qué puede correr en paralelo

- **3, 4 y 5** son independientes entre sí. Solo comparten el requisito de que
  la Fase 2 exista, para que sus cambios estén protegidos por checks.
- **7 y 8** son independientes entre sí una vez hay staging.
- **9** necesita la 8 solo para el reranking; su bloqueo previo E9.0 y la
  seguridad del gasto E9.1 no dependen de nada y pueden adelantarse.

### 8.3 Reglas de orden que no se negocian

1. **La Fase 2 va segunda.** Hoy cualquier push a `main` despliega al EC2 sin
   un solo check, y hay varios agentes commiteando en paralelo. Cada fase que
   se haga antes de cerrar eso se hace sin red.
2. **La Fase 1.5 va antes de la 1.4.** El arnés se apoya en los mismos campos
   que la telemetría; al revés obliga a medir dos veces.
3. **La Fase 4 va antes de la 6.** El staging necesita un secreto provisionado
   y rotable; improvisarlo es crear el problema que la fase resuelve.
4. **E9.0 y E9.1 van antes que cualquier gasto pagado**, aunque la Fase 9 se
   adelante por otro motivo.
5. **Ninguna fase de la 3 a la 10 empieza sin su auditoría previa X.0**
   (capítulo 13). El plan se escribió sobre el código de un momento; las
   referencias `archivo:línea` se mueven, y ya se movieron.

### 8.4 Arranque inmediato

Fase 1.5, luego 1.4, luego la Fase 2 completa. Después la auditoría previa de
la Fase 3 y sus dos ganancias grandes, 3.1 (imágenes reenviadas en cada vuelta)
y 3.2 (proyección compacta de resultados).

---

## 9. Diseño: observabilidad y taxonomía de las IA

Esta es la especificación concreta de la entrega Fase 1.4. Sin ella no se puede
responder "cuántos tokens gastó esta conversación y en qué parte".

### 9.1 El problema, medido en el código

`EventoTelemetria` tiene ocho campos y el tipo `Operacion` tiene **dos valores**:
`"chat" | "imagen"` (`packages/agente-core/src/telemetria.ts:3-16`).
`registrarEvento` se invoca desde exactamente dos lugares: el loop de chat
(`packages/agente-core/src/ejecutar.ts:88,98,163,173`) y `/api/generate`
(`src/app/api/generate/route.ts:1162,1173`).

El sistema hace **once llamadas de IA distintas**. Así se ven hoy:

| Llamada de IA | Dónde | Cómo se registra hoy |
|---|---|---|
| Turno de chat del loop | `packages/agente-core/src/ejecutar.ts:141` | `chat` — un evento por vuelta, sin saber qué vuelta es |
| Parser de intención | `src/lib/rag/query-parser/parse.ts:41` | **nada** |
| Embedding de consulta | `src/lib/rag/embeddings.ts:33` | **nada** |
| Embedding de documento (reindexación) | `src/lib/rag/embeddings.ts:33` | **nada** |
| QA visual de imagen | `src/lib/ia/image-qa.ts:95` | **nada** |
| Análisis de referencia — inventario | `src/lib/ia/analizar-referencias-v2.ts:569` | `chat` — indistinguible de un turno real |
| Análisis de referencia — auditoría | `src/lib/ia/analizar-referencias-v2.ts:576` | `chat` — indistinguible |
| Generación de imagen Gemini | `src/lib/ia/gemini/imagen.ts:74` | `imagen`, **sin tokens** |
| Generación LoRA fal.ai | `src/lib/ia/sempertex-lora.ts:134` | `imagen`, **sin tokens, sin coste, sin `request_id` del proveedor** |
| Recomendador Happie | `packages/happie-package-ia/src/recomendador.ts:105` | **nada** |
| Conversación Happie webhook | `src/lib/happie/conversacion-webhook.ts:57` | **nada** |

**Seis no se registran en absoluto. Tres son indistinguibles entre sí. Dos no
reportan tokens.** Y las dos generaciones de imagen —una de Gemini, una de
fal.ai, con tarifas y monedas completamente distintas— comparten la misma
etiqueta `imagen`.

**Actualización tras mezclar `main`.** Las dos llamadas de Happie pasan ahora
por `ejecutarWebhook` (`src/lib/happie/webhook-control.ts:165`), que ya genera
un `correlationId` por solicitud y lo devuelve en la cabecera
`X-Correlation-ID`. La instrumentación de la Fase 1.5 **debe reutilizar ese
identificador** en vez de inventar uno propio: si no, el evento de telemetría y
el log del webhook quedan sin forma de correlacionarse.

Ese módulo también trae su propia tabla de idempotencia,
`happie_webhook_requests` (`019_happie_webhook.sql`). Con eso el repositorio
tiene ya tres mecanismos de idempotencia: éste, `operational_idempotency` para
la frontera Next→Python, y el `PostgresOperationalStore` del servicio Python
sobre esa misma tabla. Los tres resuelven el mismo problema en fronteras
distintas. Consolidarlos no es tarea de la Fase 1; queda anotado en 10.7 para
decidirlo cuando la Fase 6 defina los linajes.

### 9.2 Faltan los tokens de razonamiento

El adaptador lee tres campos de `usageMetadata`: `promptTokenCount`,
`candidatesTokenCount` y `cachedContentTokenCount`
(`packages/agente-core/src/gemini/chat.ts:158-162`).

El SDK instalado expone además **`thoughtsTokenCount`** y
`toolUsePromptTokenCount` (`node_modules/@google/genai/dist/genai.d.ts:5917,5919`).

Los tokens de razonamiento **se facturan como salida**. Hoy, por tanto, no se
puede separar cuánto de la factura de salida es razonamiento y cuánto es texto
entregado al cliente — que es exactamente la métrica sobre la que se tomó la
decisión de bajar `thinkingLevel`. Aquella se midió con benchmarks ad-hoc que
después se borraron; en producción esa cifra sigue siendo invisible.

### 9.3 La taxonomía propuesta: dos niveles

La pregunta que hay que poder responder en la UI es **"¿cuánto se gastó el
armador de decoraciones? ¿y el generador de imagen? ¿y el otro?"**. Eso es una
agrupación por **funcionalidad del producto**, no por tipo técnico de llamada.

Por eso la taxonomía tiene dos niveles y el evento lleva los dos:

- **`flujo`** — nivel de producto. Es lo que se ve por defecto en la UI y lo que
  el negocio reconoce. Catálogo en 9.4.
- **`capacidad`** — nivel técnico. Es el desglose al que se entra al hacer clic
  sobre un flujo. Catálogo en 9.5.

Un flujo agrupa varias capacidades, y **una misma capacidad puede pertenecer a
flujos distintos**: un `chat_turno` ocurre tanto en el armador de decoraciones
como en la conversación de Happie, y su coste no se debe mezclar. Por eso son
dos campos independientes y no una jerarquía fija.

| Campo | Ejemplo | Para qué sirve |
|---|---|---|
| `flujo` | ver 9.4 | **Qué funcionalidad del producto gastó.** Es la dimensión de la UI |
| `capacidad` | ver 9.5 | **Qué parte técnica del proceso.** Es el desglose |
| `request_id` | uuid del request HTTP | Agrupar todo lo que costó un turno |
| `correlation_id` | uuid de la conversación | Agrupar una conversación **de punta a punta, cruzando flujos** |
| `proveedor` | `gemini`, `fal` | Quién cobra |
| `modelo` | `gemini-3.6-flash`, `gemini-embedding-2`, `gemini-3.1-flash-image`, `flux-2/lora` | Qué tarifa aplica |
| `superficie` | `/api/chat`, `/api/generate`, `script:rag-embed` | La ruta concreta. Diagnóstico, no UI |
| `vuelta` | `0..9`, `null` | Qué vuelta del tool loop. Distingue "una conversación cara" de "un turno que dio 8 vueltas" |
| `herramienta` | `buscar_catalogo_rag`, `null` | Si la llamada nació dentro de un handler |
| `thinking_level` | `low`, `minimal`, `default` | Qué configuración estaba activa cuando se midió |
| `prompt_version` | hash corto de los bloques activos del system prompt | Comparar dos corridas sin adivinar si el prompt cambió |
| `tokens_entrada` | `promptTokenCount` | |
| `tokens_salida` | `candidatesTokenCount` | |
| `tokens_pensamiento` | `thoughtsTokenCount` | **Nuevo.** Se factura como salida |
| `tokens_cacheados` | `cachedContentTokenCount` | Hoy siempre 0; se conserva por si cambia |
| `bytes_imagen_entrada` | suma de `inlineData` enviado | Mide el desperdicio de 4.0 |
| `intento` | `1..3` | Separar coste de reintentos del coste base |
| `proveedor_request_id` | `request_id` de fal.ai | Reconciliar un cobro con una sumisión |
| `ms` | latencia | |
| `resultado` | `ok`, `error`, `timeout`, `cancelado` | |
| `coste_estimado` | número + moneda, **marcado como estimado** | Ver 9.6 |

### 9.4 Catálogo cerrado de `flujo`

Cada flujo tiene una **etiqueta en español** que es la que aparece en pantalla.
El identificador es estable; la etiqueta puede cambiar sin migrar datos.

| `flujo` | Etiqueta en la UI | Qué es para el usuario | Dónde se origina | Capacidades que agrega |
|---|---|---|---|---|
| `armador_decoracion` | **Armador de decoraciones** | El chat donde el cliente describe su evento y arma la propuesta | `/api/chat` | `chat_turno`, `parser_intencion`, `embedding_consulta` |
| `generador_imagen` | **Generador de imagen** | El botón que produce la visualización de la decoración aprobada | `/api/generate` | `imagen_generacion`, `imagen_generacion_correctiva`, `qa_visual` |
| `analisis_referencia` | **Análisis de referencias** | Subir una foto de inspiración y que se descomponga en elementos | `/api/references/analyze` | `analisis_referencia_inventario`, `analisis_referencia_auditoria` |
| `happie_paquetes` | **Happie — recomendador** | El widget externo que recomienda paquetes de evento | `/api/happie/*` | `happie_recomendacion` |
| `happie_conversacion` | **Happie — conversación** | El webhook conversacional de Happie | `/api/happie/webhook/chat` | `happie_conversacion`, `chat_turno` |
| `entrenamiento_lora` | **Entrenamiento LoRA** | Admin: entrenar y evaluar un LoRA. Cobra fal.ai, en USD | scripts y `/api/lora/*` | entrenamiento y evaluación fal.ai |
| `indexacion_catalogo` | **Indexación de catálogo** | Admin: sincronizar y re-embeber el catálogo | `rag:import`, `rag:embed` | `embedding_documento` |
| `evaluacion` | **Evaluaciones** | Correr un eval o el arnés de medición | `scripts/eval-*`, `ia:bench` | cualquiera |

`evaluacion` existe para que el gasto de tus propias pruebas **no contamine**
las cifras de producto. Hoy no hay forma de separarlo y cualquier medición de
"cuánto cuesta el armador" incluiría tus benchmarks.

Regla: un evento **siempre** lleva flujo. Si el código no puede determinarlo,
falla en desarrollo en vez de escribir un valor por defecto que ensucie los
totales.

### 9.5 Catálogo cerrado de `capacidad`

Un tipo union en TypeScript y un `CHECK` en PostgreSQL, no un string libre.
Añadir una capacidad nueva debe ser un cambio de contrato visible, no un typo
que se cuela en un dashboard.

```
chat_turno
parser_intencion
embedding_consulta
embedding_documento
qa_visual
imagen_generacion
imagen_generacion_correctiva
analisis_referencia_inventario
analisis_referencia_auditoria
happie_recomendacion
happie_conversacion
rerank_candidatos          (reservado para la Fase 8)
```

`imagen_generacion_correctiva` va separada a propósito: es la llamada que se
paga dos veces por un QA fallido, y merecía su propia línea desde el principio.

### 9.6 Tabla de precios versionada

El coste no se calcula con constantes en el código. Se lee de una tabla
`ai_model_pricing` con `modelo`, `vigente_desde`, `precio_entrada`,
`precio_salida`, `precio_cacheado`, `moneda` y `fuente`. Un evento guarda el
`pricing_id` que usó, así que un cambio de tarifa no reescribe el histórico.

Todo coste calculado se marca como **estimado**. `AGENTS.md` lo exige y es
honesto: es una multiplicación local, no una factura del proveedor.

`fal.ai` cobra por generación, no por token — su fila lleva precio por unidad y
`tokens_*` en `null`. Es justo la distinción que hoy se pierde al meterlo en la
misma etiqueta `imagen` que Gemini.

### 9.7 Esquema y numeración

Migración `021_ai_call_log.sql`. La numeración se movió dos veces por
colisiones reales: 017 y 018 son de LoRA, 019 lo tomó `happie_webhook` en
`main`, y 020 quedó para `operational_idempotency`. Ver 10.1 y 10.7.

`scripts/migrate.ts` valida la unicidad del prefijo, así que un número repetido
falla antes de tocar la base. Confirma el siguiente número libre con
`ls scripts/migrations` antes de crear el archivo; no lo asumas de este
documento, que ya quedó obsoleto una vez.

Tablas: `ai_call_log` (un evento por llamada) y `ai_model_pricing`. Índices por
`request_id`, `correlation_id`, `(capacidad, created_at)` y
`(proveedor, modelo, created_at)`.

La escritura va por el outbox de Fase 3.8, no en la ruta crítica. Un fallo al
registrar telemetría **nunca** puede hacer fallar un turno de chat.

### 9.8 Qué no se registra, nunca

Prompts completos, conversaciones, imágenes, base64, claves, firmas ni DSN.
Solo hashes, tamaños y metadatos acotados, con el mismo criterio que ya aplica
`metadataAuditable` (`src/lib/rag/observability/log.ts:4-16`).

### 9.9 Qué se puede responder cuando esto exista

**Nivel de producto** — lo que se ve en la pantalla de 11.3:

- "Este mes el armador de decoraciones gastó $X, el generador de imagen $Y y el
  análisis de referencias $Z."
- "Una imagen cuesta en promedio $X, y un 18% de ese coste son los reintentos
  correctivos por QA fallido."
- "Una conversación que termina en plan aprobado cuesta $X; una que se abandona
  cuesta $Y. El 70% se abandona."
- "Happie cuesta más por recomendación que el armador por conversación
  completa" — o lo contrario. Hoy no hay forma de saberlo porque Happie no
  registra nada.
- "El entrenamiento LoRA de este mes fueron US$X en fal.ai" — hoy invisible
  para el sistema; solo aparece en el saldo de la cuenta.

**Nivel técnico** — el desglose:

- "Esta conversación costó X, y el 60% se fue en la vuelta 4 del tool loop."
- "El 40% de la factura del armador es razonamiento, no texto entregado."
- "El QA visual es el 30% de la factura de generación y solo cambia la imagen
  en el 5% de los casos" — o lo contrario.
- "Bajar `thinkingLevel` ahorró N tokens de razonamiento por turno en
  producción", no solo en un benchmark de 7 diálogos.
- "La foto del cliente costó 4 MB × 6 vueltas en este turno" — la cifra que
  justifica o descarta la entrega Fase 3.1.
- "El caché explícito ahorraría X al mes con el tráfico actual" — la decisión
  aplazada en 3.1, tomada con datos.

---

## 10. Migraciones seguras

### 10.1 Defectos que tenía el runner

Los siete se verificaron leyendo `scripts/migrate.ts` tal como estaba. La
columna de estado refleja la Fase 1.3.

| # | Defecto | Estado |
|---|---|---|
| 1 | **Colisión de número.** Existían `016_lora_specializations.sql` y `016_operational_idempotency.sql`. El runner ordenaba alfabéticamente, así que funcionaba por accidente: `_lora_` ordena antes que `_operational_` | Resuelto: el operacional pasó a `019`, y un prefijo repetido ahora es error |
| 2 | **Sin checksum.** Marcaba aplicada por `filename`. Editar una migración ya aplicada se ignoraba en silencio y dos entornos divergían sin señal | Resuelto: columna aditiva; una divergencia detiene la ejecución |
| 3 | **Sin lock.** Dos `rag:migrate` concurrentes podían aplicar lo mismo a la vez | Resuelto: `pg_advisory_lock` de sesión |
| 4 | **Sin dry-run.** No se podía ver qué se iba a aplicar | Resuelto: `--dry-run` que no escribe ni la tabla de registro, y `--target` para bisecar |
| 5 | **No confirmaba el destino, y el destino por defecto es remoto.** Cargaba `.env.local` y usaba `DATABASE_URL` sin imprimir a qué host apuntaba. En este checkout esa URL es **Neon remoto** — la misma que toda la Etapa 4 se cuidó de no tocar | Resuelto: imprime `usuario@host:puerto/base` sin la contraseña y aborta si el host no es local sin `--allow-remote` |
| 6 | **Sin reversión.** No hay migraciones `down` ni nota de rollback por archivo | **Parcial**: el runner avisa de las 18 sin nota `-- rollback:`. Escribirlas exige entender qué deja atrás cada una; no se inventan |
| 7 | **Dos dueños del mismo DDL.** El archivo operacional existe en `scripts/migrations/` (repo Next) y en `migrations/` (repo Python) | **Abierto**: se cierra en la Fase 6 con los dos linajes de 10.5 |

Había un octavo, que solo apareció al leer el archivo completo:

8. **La transacción era ilusoria.** `BEGIN`, el SQL y `COMMIT` se ejecutaban
   con `pool.query`, es decir sobre el **pool** y no sobre un cliente. Con un
   pool, esas tres llamadas pueden salir por conexiones distintas, así que una
   migración que fallara a mitad podía quedar parcialmente aplicada sin que el
   `ROLLBACK` la alcanzara. En un flujo secuencial normalmente reutilizaba la
   misma conexión ociosa, pero nada lo garantizaba. Resuelto: toda la ejecución
   usa un único `Client`.

De todos, el 5 era el que podía causar un incidente el mismo día, y el 8 el
que podía dejar una base a medio migrar sin dejar rastro.

### 10.2 La trampa de renumerar

`schema_migrations` usa `filename` como clave primaria
(`scripts/migrate.ts:22-24`). **Renombrar un archivo ya aplicado hace que se
vuelva a aplicar.** Corregir la colisión de 016 no es un `git mv`: necesita, en
la misma transacción, un `UPDATE schema_migrations SET filename = ... WHERE
filename = ...` de reconciliación, o la siguiente ejecución re-aplica el DDL
en todos los entornos donde ya estaba.

Esto debe quedar escrito en el propio archivo de migración de reconciliación,
no solo en este documento.

### 10.3 Runner endurecido — TypeScript

**Implementado en la Fase 1.3.** Los siete puntos están en `scripts/migrate.ts`
y verificados contra un PostgreSQL Docker desechable; el (g) quedó como aviso y
no como error, por la razón de 10.1(6).

| # | Cambio | Detalle |
|---|---|---|
| a | Columna `checksum` en `schema_migrations` | SHA-256 del contenido. Si un archivo aplicado cambió de checksum, **falla** con el nombre y ambos hashes. No lo re-aplica ni lo ignora |
| b | `pg_advisory_lock(<clave fija>)` | Se toma antes de leer el estado y se libera al final. Dos runners concurrentes se serializan |
| c | `--dry-run` | Imprime qué migraciones faltan, en qué orden y con qué checksum. No abre transacción de escritura |
| d | **Confirmación del destino** | Antes de aplicar, imprime `host`, `database` y `user` (nunca la contraseña ni el DSN completo). Si el host **no** es `localhost`/`127.0.0.1`, exige `--allow-remote` explícito. Sin ese flag, aborta |
| e | `--target <archivo>` | Aplicar hasta una migración concreta, para bisecar un fallo |
| f | Validación de numeración | Falla si dos archivos comparten prefijo numérico. Habría atrapado la colisión de 016 el día que se creó |
| g | Nota de reversión obligatoria | Cada `.sql` debe empezar con un comentario `-- rollback:` que describa cómo revertir, aunque sea "no reversible, requiere restore". Se valida con un lint, no con buena voluntad |

El punto (d) es el que convierte `rag:migrate` de un comando peligroso en uno
aburrido, que es lo que debe ser.

### 10.4 Entorno y migraciones del lado Python

El repo backend ya tiene runtime reproducible: `uv.lock`, `pyproject.toml`,
Python 3.11, `ruff`, `mypy` y `pytest` con comandos que funcionan de verdad.
Lo que le falta es el equivalente de 10.3.

**Recomendación: SQL plano con un runner propio, no Alembic.**

Razón: el DDL ya está escrito y revisado, y la autoridad del esquema comercial
vive fuera de Python. El `autogenerate` de Alembic quiere derivar migraciones
de modelos SQLAlchemy que este servicio no tiene y no debería tener —
introducirlo empujaría a modelar en Python tablas cuya autoridad es de otro
lado, que es justo lo que el principio 3 prohíbe.

Alembic sí sería la opción correcta el día que el servicio Python tenga
entidades propias con un modelo ORM. No es el caso hoy y forzarlo ahora crea
una dependencia difícil de revertir.

El runner Python replica las mismas siete garantías de 10.3 y añade:

- `--schema`: todas las tablas operacionales viven en un **schema dedicado**
  (`operational`), nunca en `public` junto a las comerciales. Eso hace que el
  usuario de base del servicio Python pueda tener permisos limitados a ese
  schema, y que un `GRANT` accidental no le dé acceso a catálogo ni precios.
- Verificación de permisos mínimos post-migración: el usuario del servicio debe
  poder `SELECT/INSERT/UPDATE/DELETE` en `operational.*` y **no** poder leer
  `public.catalog_*`. Es un test, no un supuesto.

### 10.5 Ownership: dos linajes, cero solapamiento

| Linaje | Dueño | Alcance | Runner |
|---|---|---|---|
| Comercial | Repo Next | `public.*` — catálogo, variantes, embeddings, planes, órdenes, observabilidad RAG | `npm run rag:migrate` |
| Operacional | Repo Python | `operational.*` — idempotencia, nonces | Runner Python |

`020_operational_idempotency.sql` **se retira de `scripts/migrations/`** del
repo Next una vez el linaje Python esté operativo, y se documenta en el propio
archivo cuál es su nuevo dueño. Mientras tanto sigue duplicado, pero con una
nota explícita en ambos lados diciendo cuál es la copia autoritativa.

`ai_call_log` (capítulo 9) pertenece al **linaje comercial**: lo escribe Next
y vive en `public`.

### 10.6 Cómo esto entra en las fases

- 10.1(1-5, 8), 10.2 y 10.3(a-f) → **Fase 1.3, hecha.** Eran la condición para
  que cualquier migración posterior fuera segura, incluida la de 9.7.
- 10.3(g), la nota de reversión por archivo → **abierto**, sin fase asignada.
  Son 18 archivos y cada nota exige entender qué deja atrás esa migración.
- 10.4 y 10.5, el runner Python y los dos linajes → **Fase 6**, junto con el
  despliegue del backend. Cierra también 10.1(7).
- 10.7, consolidar los tres mecanismos de idempotencia → **Fase 6**, con la
  decisión de linajes.

### 10.7 La validación de numeración se cobró su primera pieza

Al día siguiente de implementarla, mezclar `main` produjo una segunda colisión:
allí se había creado `019_happie_webhook.sql` mientras esta rama tenía
`019_operational_idempotency.sql`. Git no lo marca como conflicto —son nombres
de archivo distintos, cada uno añadido en un lado— así que **sin la validación
habría entrado silenciosamente**, y el orden de aplicación habría quedado a
merced del desempate alfabético.

Resolución: el de Happie conserva el 019 porque puede estar aplicado en una
base real; el operacional se movió a 020. `RENOMBRADOS` conserva las **dos**
entradas viejas, `016` y `019`, porque cualquiera de las dos puede estar
registrada en algún entorno y la reconciliación de cada una es independiente.

Dos lecciones, y la segunda importa más que la primera:

1. **Ningún documento debe fijar el próximo número de migración.** Este plan lo
   hizo dos veces y quedó obsoleto las dos. Se confirma con
   `ls scripts/migrations` en el momento de crear el archivo.
2. **Con varios agentes trabajando en paralelo sobre el mismo repo, un
   contador global secuencial es una fuente estructural de colisiones.** La
   validación las convierte en un error temprano en vez de un fallo silencioso,
   que es la mitad del problema resuelta. La otra mitad —que el número no sea
   un recurso disputado— pide un esquema distinto: prefijo por marca de tiempo,
   o por rama. No se cambia ahora: renumerar 20 archivos existentes tiene su
   propio riesgo y `RENOMBRADOS` tendría que crecer con cada uno. Queda como
   decisión abierta para la Fase 6, junto con los linajes.

Y un tercer mecanismo de idempotencia apareció en el camino:
`happie_webhook_requests`, además de `operational_idempotency` y el store
Python sobre esa misma tabla. Los tres son correctos en su frontera; tener tres
no lo es. Consolidarlos entra en la Fase 6.

---

## 11. Usabilidad de la interfaz

### 11.1 La honestidad hoy depende del prompt; puede ser estructural

El backend ya devuelve, como datos estructurados, todo lo que el modelo
*debería* confesar:

| Dato | Dónde |
|---|---|
| `filtro_relajado` (`ocasiones` \| `colores`) | `src/lib/ia/registro-herramientas.ts:474-509` |
| `match_level` (`exact_event` \| `thematic` \| `adaptable`) | mismo |
| `sustituciones` y `sin_cobertura` de tamaños | `src/lib/ia/registro-herramientas.ts:611-635` |
| `status: NO_MATCH` / `AMBIGUOUS_SKU` | mismo |
| `rechazados` con motivo | mismo |

Y el system prompt dedica párrafos enteros a instruir al modelo para que los
mencione ("HONESTIDAD AL SUSTITUIR", las reglas de `filtro_relajado`, la de
`match_level`). Es decir: **una garantía comercial se está apoyando en que el
modelo obedezca una instrucción de texto.**

Esos datos deberían renderizarse como elementos de primera clase de la UI —un
chip "color relajado: pedías dorado", un badge "temático, no exacto", una nota
"2 tamaños sustituidos"— junto a la respuesta, **independientemente de lo que
el modelo haya escrito**.

Beneficios, en orden de importancia:

1. La honestidad deja de ser una promesa del prompt y pasa a ser una propiedad
   del sistema. Si el modelo la omite, la UI la muestra igual.
2. Se puede bajar el razonamiento del modelo con menos riesgo, porque parte de
   lo que hoy vigila el set de regresión conversacional pasa a ser estructural.
3. El usuario final entiende mejor por qué le ofrecen lo que le ofrecen.

Es, probablemente, la mejora de UI con más valor real del plan, y además
refuerza la Fase 3 en vez de competir con ella.

### 11.2 El indicador de progreso ya existe, pero dice poco

`EstadoHerramienta` (`src/app/page.tsx:153-155`) muestra una etiqueta por
herramienta y "Escribiendo…" cuando no hay ninguna. La infraestructura está
bien: el SSE ya emite `herramienta` con estado `ejecutando`/`lista`
(`src/app/page.tsx:955-956`).

Lo que falta es granularidad dentro de una herramienta lenta. Una
`buscar_catalogo_rag` con franjas puede tardar segundos y hoy es una sola
etiqueta estática. Con sub-eventos —interpretando, buscando en catálogo,
validando disponibilidad, cotizando— el usuario ve avance real en vez de un
spinner.

Requiere extender el contrato SSE con un evento `progreso` **aditivo y
opcional**, versionado como el resto (`CHAT_SSE_CONTRACT_VERSION`). Un cliente
viejo que no lo entienda debe seguir funcionando.

### 11.3 Pantalla de consumo de IA — diseño concreto

Ésta es la entrega que responde "el armador de decoraciones se gastó esto, el
generador de imagen esto, el otro esto".

El panel de hoy muestra una lista plana de `proveedor · operacion · ms · tokens`
sobre un buffer de 20 eventos en memoria
(`src/components/admin/MotorIATab.tsx:128-143`). Con `ai_call_log` detrás y el
campo `flujo` del capítulo 9, se convierte en cuatro vistas.

#### Vista 1 — Tarjetas por flujo (la vista por defecto)

Una tarjeta por cada flujo del catálogo 9.4, ordenadas por gasto descendente.
Cada tarjeta muestra:

```
┌──────────────────────────────────┐
│ Armador de decoraciones          │
│                                  │
│ $ 148.200 COP        ↑ 12%       │
│                                  │
│ 84 conversaciones                │
│ $ 1.764 por conversación         │
│ 312 llamadas · 1,9 M tokens      │
└──────────────────────────────────┘
```

- **Gasto del periodo**, con variación contra el periodo anterior.
- **Unidad de negocio propia de cada flujo**, no una genérica: el armador
  cuenta conversaciones, el generador cuenta imágenes, el análisis cuenta
  referencias, el entrenamiento cuenta corridas. Y el coste unitario derivado
  ("$ por imagen", "$ por conversación"), que es la cifra que de verdad se
  compara mes a mes.
- Los flujos que cobra fal.ai se muestran **en USD**, con el equivalente en COP
  al lado marcado como estimado. Nunca se suman monedas en silencio.

Selector de periodo arriba: hoy, 7 días, 30 días, rango. Y un interruptor
**"excluir evaluaciones"**, activo por defecto, que saca el flujo `evaluacion`
del total para que tus pruebas no inflen las cifras de producto.

#### Vista 2 — Desglose de un flujo

Al hacer clic en una tarjeta, el desglose por `capacidad` y por `modelo`:

```
Armador de decoraciones — 30 días — $ 148.200 COP

  chat_turno          gemini-3.6-flash      $ 121.400   82%
    ├ entrada                                 $  46.100
    ├ razonamiento                            $  58.900   ← 40% del flujo
    └ salida entregada                        $  16.400
  parser_intencion    gemini-3.6-flash      $  19.700   13%
  embedding_consulta  gemini-embedding-2    $   7.100    5%
```

Separar **razonamiento** de **salida entregada** es lo que hoy no se puede
hacer (ver 9.2) y es exactamente donde se ve si `thinkingLevel` está bien
puesto. Si el razonamiento es el 40% de la factura de un flujo, eso es un
número accionable; hoy es invisible.

#### Vista 3 — Conversaciones

Una conversación cruza flujos: el cliente charla (armador), sube una
referencia (análisis), aprueba y genera (generador). La tabla por
`correlation_id` muestra el coste **de punta a punta**:

| Conversación | Duración | Armador | Referencias | Imagen | Total | Terminó en |
|---|---|---|---|---|---|---|
| `a3f…` | 12 min | $1.980 | $840 | $6.100 | **$8.920** | plan aprobado |
| `9c1…` | 4 min | $760 | — | — | **$760** | abandonada |

La última columna es la métrica que importa de verdad: **cuánto cuesta llegar a
un plan aprobado**. Con eso se puede decir "una cotización aprobada cuesta
$X en IA" — que es una cifra de negocio, no de infraestructura.

#### Vista 4 — Últimas llamadas (diagnóstico)

La lista plana de hoy, conservada, ahora con `flujo`, `capacidad`, `vuelta`,
`intento` y `resultado`. Sirve para diagnosticar un caso concreto, no para
mirarla a diario.

#### Fuera del admin

| Superficie | Qué muestra | Para quién |
|---|---|---|
| Barra de desarrollo en el chat, detrás de una flag | Coste y tokens del turno actual, desglosados por vuelta | Tú, mientras iteras el prompt |
| Nada | El cliente final no ve tokens, costes ni modelos | El cliente |

### 11.4 La generación de imagen es una caja negra de hasta dos minutos

`/api/generate` declara `maxDuration = 120` y no emite ningún progreso
intermedio. El polling de fal.ai sí conoce el estado
(`src/lib/ia/sempertex-lora.ts:150-182`) pero no lo comunica.

Dos mejoras, en orden:

1. Emitir progreso —en cola, generando, descargando, evaluando— reutilizando el
   patrón SSE que ya funciona en el chat.
2. Mostrar el QA visual como resultado explicable cuando falla: hoy un plan no
   conforme devuelve 422 (`src/app/api/generate/route.ts:1156-1161`) y el
   usuario recibe un error. `evaluateSceneQa` produce hasta 12 razones
   concretas (`src/lib/ia/image-qa.ts:148-187`) que nadie ve.

### 11.5 Detalles menores con buena relación esfuerzo/valor

- El botón de cancelar ya existe (`cancelarChat`, `src/app/page.tsx:994`) y la
  cancelación llega hasta Gemini. Vale la pena hacerlo más visible durante
  esperas largas.
- Cuando el loop se agota sin respuesta final (`agotado: true`), el usuario
  recibe un texto genérico. Con el desglose de vueltas se puede decir qué
  estaba intentando el asistente.
- `AMBIGUOUS_SKU` hoy se resuelve pidiéndole al modelo que pregunte. Un
  selector de variante en la UI es más rápido y no gasta un turno.

---

## 12. Ideas adicionales

Ordenadas por relación valor/esfuerzo. Ninguna es prerrequisito de otra.

### 12.1 Presupuesto de gasto con corte duro

`HANDOFF-LORA-COMPOSICION.md` documenta una sesión de experimentos que gastó
**US$1.932 en 61 generaciones**, dejando US$21,88 de saldo. No hay nada en el
código que impida repetirlo por accidente: ni tope diario, ni tope por
conversación, ni corte al acercarse a un límite.

Propuesta: presupuestos **por flujo**, usando el mismo catálogo de 9.4 que la
pantalla de consumo. Leídos del `ai_call_log`, evaluados **antes** de la
llamada —no después— y devolviendo un error estable. Dos umbrales por flujo:
aviso y corte.

| Flujo | Tope sugerido | Por qué ahí |
|---|---|---|
| `entrenamiento_lora` | por corrida y por día, en USD | Es donde ocurrió el gasto de US$1.932 |
| `generador_imagen` | por día y por conversación | Cada llamada cuesta dinero real y el retry correctivo la duplica |
| `armador_decoracion` | por conversación | Un loop de 10 vueltas con imágenes es caro; el tope corta el caso patológico |
| `evaluacion` | por corrida | Que un eval mal parametrizado no se lleve el saldo |

Los topes se ven y se editan en la misma pantalla de 11.3: cada tarjeta de
flujo muestra su consumo contra su presupuesto. Es el mismo dato, leído en las
dos direcciones — lo que se gastó y lo que queda.

Es la única entrega de este plan que puede evitar una pérdida concreta de
dinero, y depende directamente de que exista la telemetría.

### 12.2 Replay de transcripts dorados contra un proveedor falso

Hoy, probar un cambio en el prompt o en el loop exige llamar a Gemini de
verdad. Un conjunto de transcripts reales (redactados, sin datos personales)
que se reproduzcan contra un `ChatPort` falso permitiría:

- Verificar que un cambio no altera la traza de herramientas, sin gastar.
- Correr esa verificación en CI, donde hoy no hay nada de esto.
- Convertir `scripts/eval-chat-thinking.ts` de 7 diálogos pagados en un set
  grande y gratuito, reservando las llamadas reales para la validación final.

Encaja como entrega de la Fase 8 (suite de evaluación en Python), que ya
contempla fixtures versionados.

### 12.3 Un solo interruptor por capacidad de IA

Los flags están repartidos en tres sitios con tres convenciones distintas:
`src/lib/ia/feature-flags.ts` (default `true` salvo excepciones),
`src/lib/rag/flags.ts` (`=== "true"`) y variables sueltas leídas con
`process.env` directo.

`IMAGE_QA_ENABLED` queda **activo si la variable no existe**
(`src/lib/ia/feature-flags.ts:14-25`) — es decir, cada generación paga una
llamada de visión salvo que alguien sepa apagarla explícitamente. Eso debería
ser una decisión consciente, no un default heredado.

Propuesta: un registro único de capacidades de IA con default explícito por
cada una, y la regla de que apagar una capacidad **degrada** el sistema pero
nunca lo rompe ni fabrica un éxito. `pass: null` en vez de `pass: true` cuando
el QA no corre ya sigue ese criterio (`src/app/api/generate/route.ts:604-607`);
falta generalizarlo.

### 12.4 Versionar el prompt como un artefacto

El system prompt son cinco bloques concatenados en tiempo de ejecución
(`src/lib/ia/prompt-sistema.ts:184-203`). No tiene versión, ni hash, ni
registro de cambios. Dos corridas del arnés separadas por una semana no son
comparables si alguien tocó un párrafo.

Propuesta mínima: un hash corto de los bloques activos, calculado al arrancar,
expuesto en el evento de telemetría como `prompt_version` (ya está en la tupla
de 9.3) y en el panel admin. Sin ceremonia adicional.

### 12.5 Coste en pesos, no en tokens

El negocio es colombiano y cotiza en COP. La tabla de precios de 9.5 debería
guardar la tasa de cambio usada junto al coste, para que "esta conversación
costó $X COP" sea una cifra estable y auditable, no una que cambia al
recalcularla meses después.

### 12.6 Lo que deliberadamente no propongo

| Idea | Por qué no |
|---|---|
| Dashboard de observabilidad con Grafana/Prometheus | Para un despliegue de un contenedor y un desarrollador, el panel admin con `ai_call_log` detrás alcanza. Reevaluar con tráfico |
| Tracing distribuido (OpenTelemetry) | El `request_id`/`correlation_id` de 9.3 resuelve la correlación que hace falta hoy. OTel tiene sentido cuando haya más de dos procesos |
| Colas de trabajos (Celery, RQ) para generación | El store de idempotencia de la Etapa 4 ya cubre el caso durable. Una cola añade infraestructura antes de tener el problema |
| Streaming de la generación de imagen | Gemini y fal.ai no lo ofrecen para este caso. El progreso de 11.4 es lo que sí se puede hacer |
| Migrar la UI a otro framework | No hay ningún problema medido que lo justifique |

---

## 13. Auditoría previa y delegación

Este capítulo recoge decisiones **permanentes** que antes vivían solo en un
prompt de sesión. Estaban en el lugar equivocado: un prompt se pega, se usa y
se tira, y con él se irían el alcance de las auditorías y las reglas de
delegación. Es exactamente cómo se perdió `PLAN_RENDIMIENTO_RAG.md`, que es el
origen de la mitad de este plan.

### 13.1 Cada fase de la 3 a la 10 abre con una auditoría previa

**Entrega X.0 de cada fase.** No es ceremonia: el plan se escribió sobre el
código de un momento concreto, y sus referencias `archivo:línea` ya se movieron
una vez —la mezcla de `main` desplazó las de Happie el mismo día—. Empezar una
fase sin verificar su propia evidencia es construir sobre una foto vieja.

| Auditoría | Alcance | Informe |
|---|---|---|
| **3.0** | Los 13 puntos de la Fase 3 | `auditoria/07-revision-fase-3.md` |
| **4.0** | Superficie de secretos e inyección de prompt por referencias y por catálogo Happia | `auditoria/08-revision-fase-4.md` |
| **5.0** | Reversibilidad de las migraciones (19, no 18 — ver informe), recuperación de datos y flags dispersos | `auditoria/09-revision-fase-5.md` |
| **6.0** | Viabilidad real del EC2 y de Neon como destino, y el problema de distribución de contratos al repo API | `auditoria/10-revision-fase-6.md` |
| **7.0** | Concurrencia real del pool y del loop, y cancelación física de queries | `auditoria/11-revision-fase-7.md` |
| **8.0** | Qué puede hacer el reranking sin tocar autoridad, y qué mide hoy el ground truth existente | `auditoria/12-revision-fase-8.md` |
| **9.0** | Ya definida como bloqueo previo: la inconsistencia de identidad del LoRA | ver Fase 9 |
| **10.0** | Qué código temporal cumplió su condición de remoción y qué documentos sobran | `auditoria/13-revision-fase-10.md` |

Las auditorías de fases independientes entre sí se pueden lanzar en paralelo.
Las de la 3, 4 y 5 no dependen de nada y pueden salir juntas.

**Estado (2026-09-08): 3.0, 4.0 y 5.0 hechas.** Se lanzaron en paralelo con
subagentes `openai/gpt-5.6-luna` variante `xhigh` vía `opencode`, pero la
cuenta OpenAI alcanzó su tope de uso (`Error: The usage limit has been
reached`, confirmado en tres intentos independientes) antes de producir
ningún informe. Con autorización explícita del usuario en la misma sesión, se
relanzaron con subagentes Claude (`Plan`, sin herramientas de escritura,
mismo formato de seis secciones y mismas reglas de solo-lectura/cero-
proveedores-pagados de 13.2/13.3) y los tres completaron. Cada informe deja
esta desviación anotada en su propia cabecera. Los hallazgos con evidencia
que contradecían el plan ya se integraron en los capítulos 5 (Fase 4.5,
Fase 5.1, 5.3, 5.4, 5.5) y en la fila de la Fase 5 de la tabla del capítulo 0.

**6.0 hecha (2026-09-08).** A diferencia de 3.0/4.0/5.0, esta auditoría
requería credenciales reales de infraestructura compartida (SSH al EC2,
lectura de Neon), así que la hizo el orquestador directamente, con
autorización explícita del usuario en la misma sesión, en vez de un
subagente. Confirma que el EC2 ya sirve un despliegue vivo (no solo que
está listo) y que el gate de CI/CD de la Fase 2 existe solo en local, no
en `main` ni en el script real del servidor — ver el cuerpo de la Fase 6
y `auditoria/10-revision-fase-6.md`.

### 13.2 Las seis secciones que produce cada informe

Iguales para todos, para que sean comparables:

1. **Verificación de evidencia.** Cada `archivo:línea` que cita el plan en su
   alcance: ¿sigue apuntando a lo que dice? Lista las que se movieron y a dónde.
2. **Sigue en pie / ya no aplica / cambió de forma.** Una fila por entrega, con
   el motivo.
3. **Riesgo y esfuerzo por entrega.** Cualitativo, no en horas. Qué invariante
   del capítulo 6 podría romper cada una.
4. **Orden propuesto dentro de la fase**, con la razón. Puede diferir del plan;
   si difiere, hay que decirlo explícitamente.
5. **Lo que el plan no vio.** La sección más valiosa. Defectos u oportunidades
   en su alcance que el plan no menciona. Los dos anexos existentes salieron de
   aquí: el reenvío de imágenes en cada vuelta y la ausencia de idempotencia en
   fal.ai no estaban en ninguna versión previa del plan.
6. **Preguntas abiertas** que un implementador necesita resueltas antes de
   empezar.

### 13.3 Reglas para todo auditor

- **Solo lectura.** No modifica nada del repositorio salvo su informe.
- **Cero llamadas a proveedores pagados.** Ni Gemini, ni fal.ai, ni Shopify.
  Nada de `npm run *:eval*`.
- Toda cifra de latencia o coste va marcada como **medida** o **inferida**. Si
  no la midió, dice "no medido". No se inventan números.
- **No reabre lo ya descartado con medición** (capítulo 7): `flash-lite` para
  el parser, caché semántico, fusionar el parser en el tool loop, paralelizar
  la escalera de relajación, índice ANN en pgvector.
- Modelo `openai/gpt-5.6-luna`, variante `xhigh`.

### 13.4 Al recibir los informes

Los lee quien implementa, no otro subagente. Si un informe contradice el plan
**con evidencia**, se actualiza el plan en el mismo commit — no se deja
divergir en silencio. Si afirma algo sin evidencia, se descarta y se dice por
qué.

### 13.5 Cuándo delegar y cuándo no

**Sí:**

- Lectura en abanico: buscar un patrón en muchos archivos, verificar que una
  lista de referencias sigue viva, inventariar call sites.
- Auditoría acotada cuya única salida es un informe.
- Una porción de implementación con **scope de escritura disjunto** del de
  quien coordina, y criterio de aceptación escrito **antes** de lanzarla.

**No:**

- Decisiones de arquitectura o de contrato.
- Nada que toque autoridad comercial.
- Trabajo cuyo criterio de aceptación no se sepa escribir todavía. Si no puedes
  decir cómo verificarás el resultado, no está listo para delegar.

**Scopes disjuntos.** Dos subagentes no tocan el mismo archivo; quien coordina
integra. La Fase 1.5 se presta: la migración SQL, la instrumentación de
`agente-core`, y la instrumentación de las llamadas fuera de `agente-core` son
tres scopes que no se solapan.

**La carga cognitiva se queda con quien coordina.** Los subagentes leen en
abanico y ejecutan porciones acotadas; no deciden.

### 13.6 Trabajo concurrente en el mismo repositorio

Hay varios agentes trabajando sobre este repositorio a la vez, y eso ya causó
dos incidentes en dos días: un cambio de rama deliberado que se interpretó como
accidente y se deshizo, y una colisión de numeración de migraciones. Reglas:

- **Confirmar qué directorio está libre antes de ejecutar git.** Incluso
  `git status` refresca el índice y toma lock.
- **Un worktree por rama.** `git worktree add` no toca los archivos, ni el
  índice, ni el `HEAD` del worktree de otro; cambiar de rama en el worktree de
  otro sí. Una rama solo puede estar checkouteada en un worktree a la vez, y
  eso es la protección real.
- **Nunca cambiar de rama en un directorio que no sea el asignado.**
- Lo que no se comparte entre worktrees pesa: `node_modules` son 684 MB,
  `.next`, `.env.local` (que no está trackeado) y el `.venv` del servicio
  Python.

---

## Anexos

Auditorías de solo lectura hechas con subagentes `gpt-5.6-luna` variante
`xhigh` sobre el checkout actual, sin ejecutar proveedores ni PostgreSQL. Toda
cifra de latencia en ellas está marcada como inferida, no medida.

- **Anexo A** — [camino RAG/chat: retrieval, embeddings, tool loop](auditoria/05-anexo-a-rag-chat-optimizacion.md).
  Anatomía del turno, coste de entrada por vuelta, tamaño de cada resultado de
  herramienta, pool y consultas PostgreSQL, embeddings, truncado, telemetría y
  10 oportunidades con invariante y verificación por cada una.
- **Anexo B** — [camino de generación: Gemini imagen, QA visual y LoRA/fal.ai](auditoria/06-anexo-b-generacion-lora-optimizacion.md).
  Inventario de llamadas a proveedor por request, cadena secuencial crítica,
  coste de prompt, configuración de razonamiento por llamada, ciclo de QA y
  reintentos, I/O de imágenes, 11 oportunidades y una lista explícita de qué no
  tocar.

La sección 8 del anexo B ("Qué NO tocar") es de lectura obligatoria antes de
cualquier cambio en `/api/generate`: enumera con `archivo:línea` las
invariantes de procedencia comercial, plan aprobado, allowlist de dataset,
compatibilidad de artifact, cantidades visuales frente a paquetes, identidad de
color, cardinalidad, venue y QA como evidencia.

# Prompt de implementación — Fase 1.5 y auditoría de las Fases 2 a 6

Pega este documento como primer mensaje de una sesión nueva.

---

## 0. Qué se te pide

Dos cosas, en este orden:

1. **Implementar la Fase 1.5**: telemetría durable de IA con taxonomía de dos
   niveles (`flujo` y `capacidad`). Es lo que hace visible y atribuible el
   gasto por funcionalidad del producto.
2. **Auditar las Fases 2 a 6** con subagentes, para saber si el plan sigue en
   pie contra el código actual antes de seguir gastando trabajo en él.

Puedes lanzar la auditoría en paralelo mientras implementas, porque los
auditores son de solo lectura y no tocan lo que tú escribes.

**La carga cognitiva principal es tuya.** Los subagentes sirven para leer en
abanico y para porciones de implementación acotadas y verificables, no para
decidir arquitectura ni para que les delegues el criterio.

---

## 1. Dos numeraciones — no las mezcles

Esto ya causó una confusión y conviene tenerlo claro desde el primer minuto:

| Nombre | Qué es | Estado |
|---|---|---|
| **Etapas 1 a 4** | Las cuatro etapas del plan **viejo** que ya se ejecutaron: auditoría, contratos, base FastAPI y preparación reversible. Documentadas en `01-` a `04-` de esta carpeta | Cerradas en local |
| **Fases 1 a 6** | El trabajo **nuevo**, definido en `PLAN-MAESTRO-V2.md`. La Fase 1 es el primer trabajo nuevo, no una repetición de nada | Fase 1 en curso |

Cuando alguien diga "la etapa 5" se está refiriendo al plan viejo. El trabajo
vivo se numera por fases.

---

## 2. Ubicaciones

| Qué | Dónde |
|---|---|
| Repo Next (fuente canónica) | `C:\Users\davidt\Downloads\demo-decoracion` |
| Rama de trabajo | `fase-1/medicion-y-migraciones-seguras` |
| Repo backend Python (artefacto de despliegue) | `C:\Users\davidt\Downloads\workspace\demo-decoracion-api` |
| Workspace agrupador | `C:\Users\davidt\Downloads\workspace` |
| Servicio Python | `demo-decoracion/services/ai-api` |
| Contratos canónicos | `demo-decoracion/contracts` |
| Migraciones | `demo-decoracion/scripts/migrations` |

El repo Next es la fuente canónica del servicio Python y de los contratos,
porque el generador Pydantic deriva sus modelos de `contracts/` por ruta
relativa. El repo API es el artefacto de despliegue.

---

## 3. Documentos rectores, en orden

1. **`AGENTS.md`** de la raíz. Manda sobre todo lo demás. Comunícate en
   español, escribe reglas y código en inglés donde ya lo esté.
2. **`docs/migracion-python/PLAN-MAESTRO-V2.md`**. El plan vigente. Para esta
   tarea importan sobre todo:
   - capítulo 9 completo — la especificación de la telemetría;
   - capítulo 11.3 — la pantalla que consumirá esos datos;
   - capítulo 6 — los invariantes intocables;
   - capítulo 7 — lo ya descartado con medición, para no volver a proponerlo.
3. **`docs/migracion-python/progreso.md`**. Estado acumulado.
4. **`docs/migracion-python/auditoria/05-anexo-a-rag-chat-optimizacion.md`** y
   **`06-anexo-b-generacion-lora-optimizacion.md`**. Las dos auditorías de
   optimización, con evidencia `archivo:línea`.
5. **`docs/planes-recuperados/PLAN_RENDIMIENTO_RAG.md`**. Contiene las
   mediciones reales sobre las que se decidieron los niveles de razonamiento
   activos. No repitas ese trabajo ni cuestiones sus cifras sin medir.

---

## 4. Estado verificado

Rama `fase-1/medicion-y-migraciones-seguras`, worktree limpio. `main` intacto
en `c89cda1`.

```
903c1eb docs(plan): renumera el trabajo nuevo como Fases 1-6
5c0c83c feat(migraciones): runner con destino confirmado, checksum y lock
b471e4c feat(python): store PostgreSQL durable con asyncpg
1635d49 docs(migracion): plan maestro v2, auditorias, ADRs y planes recuperados
c8fc6b5 docs(reglas): AGENTS.md como fuente unica de reglas de ingenieria
3737510 feat(python): servicio FastAPI, store de idempotencia y adaptador reversible
9aa8971 fix(happie): auth directa en endpoints internos y validacion runtime
e6cc461 feat(contratos): versiona chat, SSE, dominio y frontera operativa
1a69d77 feat(lora): vocabulario compositivo, contrato visual y titulo de producto
b391e32 feat(plan): resolucion comercial de esculturas, props y estructuras 1.1
```

Hecho de la Fase 1:

- **1.1** El trabajo de las Etapas 1-4 está commiteado.
- **1.2** Nueve planes borrados recuperados en `docs/planes-recuperados/`; los
  seis comentarios de código que apuntaban a rutas inexistentes ya resuelven.
- **1.3** `scripts/migrate.ts` endurecido: confirma destino y aborta si es
  remoto sin `--allow-remote`, verifica checksums, toma `pg_advisory_lock`, usa
  un único `Client` (antes `BEGIN`/SQL/`COMMIT` iban sobre el pool y podían
  salir por conexiones distintas), valida unicidad del prefijo numérico, y
  ofrece `--dry-run` y `--target`. La colisión de `016` se resolvió moviendo el
  operacional a `019`, con reconciliación en `RENOMBRADOS`.

Pendiente de la Fase 1:

- **1.5** Telemetría durable y taxonomía. **Es tu primera tarea.**
- **1.4** Arnés `npm run ia:bench`. Va **después** de 1.5 a propósito: se
  apoya en los mismos campos, y hacerlo antes obliga a medir dos veces.

---

## 5. Tarea 1 — Implementar la Fase 1.5

### 5.1 El problema, ya verificado

`Operacion` tiene dos valores, `"chat" | "imagen"`
(`packages/agente-core/src/telemetria.ts:3`), y `registrarEvento` se llama
desde dos sitios: el loop de chat (`packages/agente-core/src/ejecutar.ts:88,98,163,173`)
y `/api/generate` (`src/app/api/generate/route.ts:1162,1173`).

El sistema hace **once llamadas de IA distintas**. Seis no se registran, tres
son indistinguibles entre sí, y dos no reportan tokens:

| Llamada | Dónde | Hoy |
|---|---|---|
| Turno de chat del loop | `packages/agente-core/src/ejecutar.ts:141` | `chat`, sin saber qué vuelta |
| Parser de intención | `src/lib/rag/query-parser/parse.ts:41` | nada |
| Embedding de consulta | `src/lib/rag/embeddings.ts:33` | nada |
| Embedding de documento | `src/lib/rag/embeddings.ts:33` | nada |
| QA visual | `src/lib/ia/image-qa.ts:95` | nada |
| Referencia — inventario | `src/lib/ia/analizar-referencias-v2.ts:569` | `chat`, indistinguible |
| Referencia — auditoría | `src/lib/ia/analizar-referencias-v2.ts:576` | `chat`, indistinguible |
| Imagen Gemini | `src/lib/ia/gemini/imagen.ts:74` | `imagen`, sin tokens |
| Imagen LoRA fal.ai | `src/lib/ia/sempertex-lora.ts:134` | `imagen`, sin tokens ni `request_id` del proveedor |
| Recomendador Happie | `packages/happie-package-ia/src/recomendador.ts:107` | nada |
| Conversación Happie | `src/lib/happie/conversacion-webhook.ts:60` | nada |

**Las dos de Happie ya tienen un `correlationId`: reúsalo.** Desde la mezcla de
`main`, ambas pasan por `ejecutarWebhook`, que genera un UUID por solicitud
(`src/lib/happie/webhook-control.ts:169`) y lo devuelve en `X-Correlation-ID`.
Si la telemetría inventa uno propio, el evento y el log del webhook quedan sin
forma de correlacionarse. Hay que propagarlo hasta el evento.

Y el adaptador lee tres campos de `usageMetadata`
(`packages/agente-core/src/gemini/chat.ts:158-162`) e ignora
**`thoughtsTokenCount`**, que el SDK sí expone
(`node_modules/@google/genai/dist/genai.d.ts:5917`). Los tokens de
razonamiento se facturan como salida, así que hoy no se puede separar cuánto
de la factura es el modelo pensando.

### 5.2 Qué entregar

Lee el capítulo 9 completo antes de escribir código. Resumen de lo exigido:

**a. Migración `ai_call_log`.** **Confirma el número libre con
`ls scripts/migrations` en el momento de crearla; no lo tomes de este
documento.** Al escribirse decía 020, y al día siguiente ya era 021: `main`
creó `019_happie_webhook.sql` y el operacional tuvo que moverse a 020. Con
varios agentes en paralelo sobre el mismo repo, un contador secuencial global
es una fuente estructural de colisiones (ver capítulo 10.7 del plan).

`migrate.ts` valida la unicidad del prefijo, así que un número repetido falla
antes de tocar la base — pero descubrirlo en el commit es peor que mirar el
directorio antes. Incluye su nota `-- rollback:`, como hace
`020_operational_idempotency.sql`.

Dos tablas: `ai_call_log` y `ai_model_pricing`. Un evento guarda el
`pricing_id` que usó, para que un cambio de tarifa no reescriba el histórico.
Índices por `request_id`, `correlation_id`, `(flujo, created_at)`,
`(capacidad, created_at)` y `(proveedor, modelo, created_at)`.

**b. Los dos catálogos cerrados.** Union type en TypeScript y `CHECK` en
PostgreSQL, no strings libres. `flujo` son los 8 de 9.4 con su etiqueta en
español; `capacidad` son los 12 de 9.5. Añadir uno nuevo debe ser un cambio de
contrato visible.

Un evento **siempre** lleva flujo. Si el código no puede determinarlo, falla en
desarrollo en vez de escribir un valor por defecto que ensucie los totales.

**c. Instrumentar las once llamadas** de la tabla de 5.1, cada una con su
`flujo`, `capacidad`, `vuelta` cuando aplique, `intento`, y
`proveedor_request_id` donde el proveedor lo dé (fal.ai sí lo da).

**d. Leer `thoughtsTokenCount`** y guardarlo separado de `tokens_salida`.

**e. Escritura por outbox, no en la ruta crítica.** Un fallo al registrar
telemetría **nunca** puede hacer fallar un turno de chat. El buffer en memoria
de 50 eventos se conserva para el panel en caliente.

**f. Nada de prompts completos, conversaciones, imágenes, base64, claves,
firmas ni DSN.** Solo hashes, tamaños y metadatos acotados, con el criterio que
ya aplica `metadataAuditable` (`src/lib/rag/observability/log.ts:4-16`).

### 5.3 Criterio de salida de la Fase 1.5

- Los 8 flujos y las 12 capacidades emiten evento.
- La telemetría sobrevive un reinicio del proceso.
- Un fallo al registrar no rompe un turno — pruébalo, no lo asumas.
- `src/app/api/ia/salud/route.ts` sigue funcionando y el panel admin no se
  rompe.
- Ningún secreto ni contenido de conversación llega a la tabla.

La pantalla de consumo (capítulo 11.3) es de la **Fase 2.12**, no de esta. Aquí
solo se genera el dato.

---

## 6. Tarea 2 — Auditoría de las Fases 2 a 6

### 6.1 Por qué

El plan se escribió sobre auditorías del código anterior a la consolidación del
servicio Python y al endurecimiento del runner. Cada fila de las Fases 2 a 6
lleva evidencia `archivo:línea`, y esas referencias pueden haberse movido. Antes
de gastar más trabajo sobre el plan hay que saber qué sigue en pie.

### 6.2 Tres auditores en paralelo

Lanza tres subagentes de solo lectura. Cada uno escribe **únicamente** su
informe.

| Auditor | Alcance | Informe |
|---|---|---|
| **A** | Fase 2 completa: los 12 puntos de optimización de Gemini en TypeScript | `docs/migracion-python/auditoria/07-revision-fase-2.md` |
| **B** | Fases 3 y 4: staging en el EC2 y Neon, y la primera capacidad de IA en Python (reranking, suite pytest, embeddings en batch) | `docs/migracion-python/auditoria/08-revision-fases-3-4.md` |
| **C** | Fases 5 y 6: camino LoRA y generación, y el cutover selectivo | `docs/migracion-python/auditoria/09-revision-fases-5-6.md` |

### 6.3 Qué debe producir cada informe

Las mismas seis secciones en los tres:

1. **Verificación de evidencia.** Cada `archivo:línea` que cita el plan en su
   alcance: ¿sigue apuntando a lo que dice? Lista las que se movieron y a dónde.
2. **Sigue en pie / ya no aplica / cambió de forma.** Una fila por entrega del
   plan, con el motivo.
3. **Riesgo y esfuerzo por entrega.** Cualitativo, no en horas. Qué invariante
   podría romper cada una.
4. **Orden propuesto dentro de la fase**, con la razón. Puede diferir del plan;
   si difiere, dilo explícitamente.
5. **Lo que el plan no vio.** Lo más valioso del informe. Defectos u
   oportunidades en su alcance que el plan no menciona.
6. **Preguntas abiertas** que un implementador necesita resueltas antes de
   empezar esa fase.

Reglas para los tres:

- Solo lectura. No modifican nada del repo salvo su informe.
- **Cero llamadas a proveedores pagados**: ni Gemini, ni fal.ai, ni Shopify.
  Nada de `npm run *:eval*`.
- Toda cifra de latencia o coste va marcada como **medida** o **inferida**. Si
  no la midieron, dicen "no medido". No se inventan números.
- No reabren lo ya descartado con medición (capítulo 7 del plan):
  `flash-lite` para el parser, caché semántico, fusionar el parser en el tool
  loop, paralelizar la escalera de relajación, índice ANN en pgvector.

### 6.4 Al recibir los tres informes

Léelos tú y sintetiza. Si alguno contradice el plan con evidencia, **actualiza
el plan** — no lo dejes divergir en silencio. Si alguno afirma algo sin
evidencia, descártalo y dilo.

---

## 7. Cómo usar subagentes

### 7.1 Cuándo sí

- Lectura en abanico: buscar un patrón en muchos archivos, verificar que una
  lista de referencias sigue viva, inventariar call sites.
- Auditoría acotada con un informe como única salida.
- Una porción de implementación con **scope de escritura separado** del tuyo y
  criterio de aceptación escrito antes de lanzarla.

### 7.2 Cuándo no

- Decisiones de arquitectura o de contrato.
- Cualquier cosa que toque autoridad comercial.
- Trabajo cuyo criterio de aceptación no sepas escribir todavía. Si no puedes
  decir cómo verificarás el resultado, todavía no está listo para delegar.

### 7.3 Sintaxis de opencode

El mensaje posicional va **antes** de las flags, y `--file` necesita el `=`:
sin él, el flag de tipo array se come el mensaje siguiente como si fuera parte
de los adjuntos.

```bash
opencode run "Sigue al pie de la letra las instrucciones del archivo adjunto. Eres un auditor de solo lectura. No modifiques ningun archivo salvo el informe de salida indicado en el propio archivo adjunto. No ejecutes comandos que llamen a proveedores pagados." --agent build -m openai/gpt-5.6-luna --variant xhigh --auto --title "revision-fase-2" --file="<ruta absoluta al prompt del auditor>"
```

Lánzalos siempre en background. Escribe el prompt de cada auditor en un archivo
en disco, no inline.

**Lección aprendida, respétala:** si un proceso `opencode` sigue vivo cuando
termina la sesión, el proceso sobrevive pero su log queda huérfano y deja de
actualizarse — pierdes visibilidad aunque siga consumiendo CPU. Si al retomar
ves procesos con `Get-Process opencode` pero ningún informe nuevo y el log no
avanza, mátalos y relánzalos dentro de la sesión actual. No los dejes corriendo
a ciegas entre sesiones.

Al cierre de la sesión que generó este documento quedaban tres procesos
`opencode` huérfanos de sesiones anteriores (PIDs 28248, 28836, 31700). Si
siguen ahí, confirma con el usuario antes de matarlos.

### 7.4 Scopes de escritura

Si delegas implementación, cada subagente escribe en archivos disjuntos y tú
integras. Dos subagentes no tocan el mismo archivo. La telemetría de la Fase
1.5 se presta bien a esto: la migración SQL, la instrumentación de
`agente-core`, y la instrumentación de las llamadas fuera de `agente-core` son
tres scopes que no se solapan.

---

## 8. Reglas de trabajo

- Antes de editar: `git status --short`, y lee el código afectado y sus
  consumidores.
- **Nunca** `git reset`, `git checkout --`, ni limpiezas destructivas. Usa
  `git restore --staged` si necesitas desestagear.
- No hagas push sin pedirlo.
- Usa `rtk` como prefijo en los comandos.
- Preserva cualquier cambio local que encuentres.
- Bases de datos: usa un contenedor **desechable** que crees y elimines tú.
  **No toques `demo-decoracion-postgres-1` ni `maros-postgres-local`**, que son
  del usuario. Si necesitas pgvector, la imagen es `pgvector/pgvector:pg16`.
- `DATABASE_URL` de `.env.local` apunta a **Neon remoto**. No la uses. Pasa el
  DSN del contenedor desechable por variable de entorno en la línea de comando:
  `process.loadEnvFile` no sobreescribe una variable ya puesta, verificado.
- No inventes secretos, credenciales, destinos ni autorizaciones.
- No afirmes que un check pasó si no lo ejecutaste.

---

## 9. Invariantes intocables

Del capítulo 6 del plan. Si un cambio toca uno de estos, detente y consulta.

1. El modelo nunca es autoridad de producto, variante, precio, stock,
   disponibilidad, cantidad ni aprobación.
2. `confirmar_seleccion_rag` rechaza cualquier `product_id`/`variant_id` que no
   venga de `buscar_catalogo_rag` del **mismo turno**.
3. La aprobación explícita del cliente precede a `/api/generate`.
4. Las reglas de honestidad al sustituir se conservan textualmente.
5. Merma, paquetes, unidades por paquete y redondeo de dinero se calculan en un
   solo lugar. No se duplican en Python.
6. `PYTHON_BACKEND_ENABLED` apagado por defecto;
   `PYTHON_BACKEND_KILL_SWITCH` gana siempre.
7. Ningún reintento puede duplicar un efecto pagado. Un timeout no prueba que
   el proveedor no ejecutó la operación.
8. No se borra ninguna ruta legacy hasta que su reemplazo pasó replay,
   observación y rollback controlado.

Añade uno más, específico de esta fase: **la telemetría es observación, nunca
control.** Ningún dato del `ai_call_log` puede cambiar una decisión comercial.
Los topes de gasto de la Fase 5.1(f) son la única excepción prevista, y
bloquean una llamada a proveedor, no una regla de negocio.

---

## 10. Verificación

Estos comandos funcionan hoy y todos pasaron en la sesión anterior. Corre los
relevantes a lo que toques.

```powershell
rtk npm run build --workspaces --if-present
rtk npx tsc --noEmit
rtk npm run lint
rtk npm run contracts:check
rtk npm run contracts:test
rtk npm run contracts:test:domain
rtk npm run contracts:test:operational
rtk npm run contracts:test:cancel
rtk npm run plan:test
rtk npm run chat:test-historial
rtk npx tsx scripts/test-python-adapter.ts
rtk npx tsx scripts/test-idempotency-store.ts
```

Lado Python, desde `services/ai-api`:

```powershell
rtk uv run --extra test --extra quality --system-certs python -m pytest
rtk uv run --extra quality --system-certs ruff check app scripts tests
rtk uv run --extra quality --system-certs ruff format --check app scripts tests
rtk uv run --extra quality --system-certs mypy app scripts
rtk uv lock --check --system-certs
rtk uv run --extra test --system-certs python scripts/generate_models.py --check
```

Migraciones, contra el contenedor desechable:

```powershell
rtk npm run rag:migrate:check
```

Referencias: `npm run lint` deja **28 warnings heredados y 0 errores** — si
aparecen más, son tuyos. `pytest` daba **24 tests** al cerrar la sesión
anterior. `contracts:check` valida 9 schemas de chat y 24 de dominio sin drift.

Añade pruebas de comportamiento para lo que cambies. Para la Fase 1.5 como
mínimo: que un fallo del sink no rompa el turno, que un flujo desconocido falle
en desarrollo, y que ningún campo sensible llegue a la tabla.

---

## 11. Entrega

Al terminar, informa:

- archivos modificados y en qué commits;
- subagentes usados, para qué, y qué aportó cada uno;
- decisiones tomadas y por qué;
- comandos ejecutados con su resultado real;
- qué se midió y qué quedó sin medir, explícitamente;
- riesgos y bloqueos externos;
- el siguiente paso exacto.

Actualiza `docs/migracion-python/progreso.md` y el estado de las entregas en
`PLAN-MAESTRO-V2.md`. Si la auditoría cambió algo del plan, que se vea en el
plan.

Si algo del contexto no está claro, **pregunta antes de asumir**. Nada de este
proyecto es inmutable.

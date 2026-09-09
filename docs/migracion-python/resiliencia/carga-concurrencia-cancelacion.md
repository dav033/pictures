# Carga, concurrencia y cancelación de queries (Fase 7)

**Corte:** 2026-09-09. **Método:** carga real contra el Postgres local
(`demo-decoracion-postgres-1`, nunca Neon), con proveedor de IA **falso**
(sin `GEMINI_API_KEY`, `RAG_USE_VECTOR=false` — cero gasto real, misma ruta
de código que producción cuando no hay llave o el proveedor está caído). El
pool bajo prueba es el real de `src/lib/rag/db.ts` (`getRagPool()`), sin
modificar.

## Conclusión ejecutiva

El pool no se rompe bajo carga — se vuelve lento sin límite. Ningún nivel de
concurrencia probado (hasta 400 turnos concurrentes del flujo más pesado)
produjo un solo error del pool; en cambio la latencia creció linealmente y
sin techo visible (p50 de 53ms a 15,7 **segundos** en el flujo de
presupuesto). Esto no es degradación con un error estable — es exactamente
el "timeout ciego" que la Fase 7 pedía descartar o confirmar: hoy nadie le
dice al usuario que algo salió mal, simplemente tarda más y más.

Sobre cancelación: `statement_timeout` (ya configurado, 30s en producción)
sí cancela físicamente una query que se pasa de tiempo — verificado contra
`pg_stat_activity`, no solo contra el rechazo de una promesa. Pero el patrón
que usa hoy el código de producción para "dejar de esperar" una respuesta
lenta (`conLimiteDeEspera` en `src/app/api/chat/route.ts`) **no cancela
nada**: el cliente deja de esperar, la query sigue corriendo en Postgres
hasta terminar por sí sola o hasta `statement_timeout`. Existe un mecanismo
real en el driver `pg` para cancelar de verdad (probado, funciona en 131ms),
pero no está conectado a ningún punto del código hoy, y depende de una API
interna marcada como obsoleta (se elimina en `pg@9.0`).

---

## Fase 7.1 — Escenario de carga reproducible

**Arnés:** `scripts/load-test-rag.ts`. Simula N conversaciones concurrentes
contra los dos flujos que golpean el pool con más intensidad:

- **`chat`** — `buscarCatalogoRag()`, una búsqueda de catálogo simple.
- **`presupuesto`** — `buscarCatalogoRagConPresupuesto()` con la franja
  `escena`, que dispara **5 roles en paralelo por turno**
  (`ROLES_PRESUPUESTO`), cada uno con sus propias ramas léxicas concurrentes
  — el caso que el plan cita como origen del riesgo de saturación.

Cada nivel de concurrencia corre durante una duración fija (8s en la corrida
base) con N workers reales, cada uno emitiendo turnos en bucle. El pool se
muestrea cada 50ms (`totalCount`, `idleCount`, `waitingCount`) para medir
ocupación real, no inferida.

**Resultado completo:** `reports/load-test-rag.md` (niveles 1, 5, 10, 15,
20, 30, 50, 80 — ambos flujos) y `reports/load-test-rag-extremo.md`
(niveles 120, 180, 250, solo `presupuesto`, para confirmar que la tendencia
sigue sin techo).

Resumen del flujo `presupuesto` (el más exigente):

| Concurrencia | p50 | p95 | p99 | error % | pool.waiting max | pool.total max |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 53ms | 104ms | 125ms | 0% | 0 | 20 |
| 10 | 447ms | 1.114ms | 1.639ms | 0% | 59 | 20 |
| 30 | 1.394ms | 1.884ms | 2.049ms | 0% | 265 | 20 |
| 80 | 3.684ms | 4.963ms | 5.254ms | 0% | 780 | 20 |
| 180 | 8.105ms | 11.490ms | 11.980ms | 0% | 1.780 | 20 |
| 250 | 12.491ms | 14.369ms | 14.540ms | 0% | 2.480 | 20 |

`pool.total` toca el `max: 20` configurado desde concurrencia ≈10 en
adelante — el pool está saturado (todas las conexiones ocupadas) mucho antes
de que aparezca ningún error. A partir de ahí, más concurrencia solo alarga
la cola.

## Fase 7.2 — Presupuesto de latencia por flujo

**No hay un requisito de negocio documentado** para fijar un umbral de
aceptación (p. ej. "el chat debe responder en menos de N segundos") — se
confirmó explícitamente con el usuario antes de escribir esta sección. Por
tanto esta entrega documenta el **baseline medido** en 7.1 sin fijar un
gate:

- Flujo `chat`, sin contención (concurrencia 1): p50 35ms, p95 108ms.
- Flujo `presupuesto`, sin contención (concurrencia 1): p50 53ms, p95 104ms.
- Ambos números son con proveedor falso — **no incluyen el tiempo real de
  Gemini** (el turno de chat completo en producción también espera al LLM;
  este baseline aísla solo la capa RAG/Postgres, que es la que Fase 7 pedía
  caracterizar bajo concurrencia).

Cuando exista un requisito de negocio real, se puede convertir esta tabla en
gates de aceptación (mismo patrón que `scripts/bench-rag-v2.ts`) sin volver
a correr nada — los números ya están medidos y son reproducibles.

## Fase 7.3 — Comportamiento bajo saturación

**Qué se degrada primero: la latencia, no la disponibilidad — y sin techo
visible dentro de lo probado.** Incluso a concurrencia 400 en el flujo
`presupuesto` (20× el `max` del pool), **cero errores**; p50 15,7s, p99
23,1s, `pool.waiting` llegó a 3.980 turnos en cola simultáneos.

**Por qué no aparece ningún error, aunque `connectionTimeoutMillis: 5000`
esté configurado:** cada turno no mantiene una sola conexión reservada de
principio a fin — internamente hace muchas llamadas independientes y de
corta duración a `pool.query()` (FTS, trigram, whitelist de variantes,
demanda, evidencia de evento, ×5 roles en `presupuesto`). El pool procesa
esa cola de micro-adquisiciones lo bastante rápido como para que **ninguna
espera individual** llegue a los 5.000ms, aunque la **suma acumulada** de
esperas a lo largo de un turno complejo sí llegue a varios segundos. El
resultado observable es justo lo que la Fase 7 quería descartar o
confirmar: un **timeout ciego** — el usuario no recibe un error identificable,
solo espera cada vez más.

Esto no es un fallo del pool ni de Postgres: es una consecuencia directa del
patrón de acceso actual (`pool.query()` suelto por cada sentencia, nunca una
transacción o conexión reservada por turno). Verificado, no asumido: se
corrió hasta 20× el límite configurado del pool sin que apareciera ningún
error del pool o de Postgres.

**No se implementa ningún cambio de código en esta entrega** — 7.3 pide
documentar el comportamiento observado, no corregirlo. Un límite de
concurrencia por turno a nivel de aplicación (backpressure explícito, no
solo el `max` del pool) es la mitigación obvia; queda fuera de esta fase.

## Fase 7.4 — Cancelación física de una query PostgreSQL en curso

**Arnés:** `scripts/test-query-cancellation.ts`, 10 aserciones, las 10 en
verde contra Postgres local real. Tres preguntas, tres respuestas
verificadas contra `pg_stat_activity` (no solo contra el rechazo de una
promesa, que puede pasar sin que la query se detenga de verdad):

**A. ¿`statement_timeout` cancela de verdad?** Sí. Con el mismo mecanismo
que usa producción (`statement_timeout` en la config del `Pool`, 30s allí,
2s en la prueba para que sea rápida), una `pg_sleep(10)` se cancela a los
~2s con el error real de Postgres `canceling statement due to statement
timeout`, y el backend deja de estar `active` en `pg_stat_activity`
inmediatamente. Esto YA está protegiendo producción contra una query
individual que se cuelga.

**B. ¿El patrón real de `conLimiteDeEspera` (dejar de esperar del lado del
cliente) cancela algo?** No. Se replicó exactamente ese patrón: una
`pg_sleep(4)` corriendo, el código "se rinde" a los 500ms (como hace
`conLimiteDeEspera` en `src/app/api/chat/route.ts:50-58` cuando el
`deadline` se cumple) sin llamar a ningún método de cancelación. Se
confirmó con una conexión de monitoreo separada que el backend de Postgres
**sigue `active`** ejecutando la query 200ms después de que el cliente ya
había desistido, y solo termina cuando `pg_sleep(4)` acaba por sí sola. El
gasto de cómputo/IO en Postgres continúa huérfano, sin nadie escuchando el
resultado, hasta que termina o hasta que `statement_timeout` lo corta por
las suyas.

**C. ¿Existe un mecanismo real en el driver para cancelar de verdad?** Sí,
pero no está conectado a nada en el código de esta app hoy. `pg` 8.23
expone `client.cancel(target, query)` — un método interno, sin documentar
en el README, que abre una conexión nueva y envía un `CancelRequest` con el
`processID`/`secretKey` de la conexión ocupada (así es el protocolo de
cancelación de Postgres: no se puede cancelar sobre la misma conexión que
está bloqueada ejecutando la query). Probado: cancela una `pg_sleep(10)` en
131ms, con el error real de Postgres `canceling statement due to user
request`, confirmado contra `pg_stat_activity`. **Limitaciones reales para
usarlo en este código:**

1. Requiere `pool.connect()` + `client.query(objetoQuery)` y conservar el
   objeto `Query`, no el patrón `pool.query()` suelto que usa hoy todo el
   RAG (`buscarHibrido`, `buscarCatalogoRag`, etc.) — conectar esto exigiría
   tocar la forma en que se hacen las consultas, no solo agregar una
   llamada.
2. `client.activeQuery` (de la que depende `cancel()` para saber si la
   query sigue activa) está marcado `deprecated` y **se elimina en `pg@9.0`**
   — construir sobre esto hoy es construir sobre una API con fecha de
   vencimiento conocida.
3. Nada en el código actual pasa un `AbortSignal` ni ningún otro identificador
   hasta la capa de retrieval — ni `buscarHibrido`, ni `buscarCatalogoRag`,
   ni `buscarCatalogoRagConPresupuesto` aceptan una señal de cancelación
   hoy. Conectar A con C no es solo "llamar a cancel en el momento
   correcto"; es un cambio de forma de toda la cadena de llamadas.

**Veredicto de la entrega ("probarla o declararla no soportada"): probada y
declarada NO soportada en el código actual**, aunque el driver la haga
técnicamente posible. La frontera de cancelación del plan (`crearDeadlineSignal`,
`conLimiteDeEspera`) llega hasta donde el código dejó de esperar — nunca
hasta Postgres.

## Qué no cubre esta fase

- No se implementó ningún backpressure de aplicación ni cancelación real
  conectada a la cadena de llamadas — son cambios de código, y 7.1-7.4 piden
  medir y probar, no corregir.
- No se probó contra el proveedor de IA real (Gemini) bajo concurrencia —
  el "proveedor falso" fue deliberado para no gastar dinero; el tiempo de
  espera real de Gemini bajo carga concurrente de la cuenta del proyecto es
  una pregunta aparte, no respondida aquí.
- No se probó contra Neon (producción) — todo corrió contra el Postgres
  local Docker, con datos reales sincronizados pero sin el comportamiento de
  red/latencia específico de Neon ni su propio límite de conexiones.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/load-test-rag.ts --concurrency 1,5,10,15,20,30,50,80 --duration 8 --flow both
npx tsx scripts/test-query-cancellation.ts
```

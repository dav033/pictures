# Auditoría documental — Fase 7: carga, concurrencia y latencia

**Corte documental:** 2026-09-10. **Plan rector:**
[`PLAN-MAESTRO-V2.md`](../PLAN-MAESTRO-V2.md), sección Fase 7.

## Alcance y método

Se contrastaron el plan, `progreso.md`, la entrega narrativa de resiliencia,
los dos reportes de carga, los dos scripts de prueba y el código actual del
pool, del endpoint de chat y del retrieval.

Esta es una auditoría documental y de lectura del árbol actual. No se
ejecutaron `scripts/load-test-rag.ts` ni `scripts/test-query-cancellation.ts`,
ni cargas, Docker, build, lint, proveedores de IA, Neon o cualquier otra
operación remota. No se verificaron de nuevo las corridas descritas por los
artefactos.

Al iniciar la revisión, el worktree estaba en `main...origin/main`, con
cambios locales ajenos a este informe y `.mypy_cache/` sin trackear. El archivo
objetivo no existía. Esos cambios no se usaron como evidencia de Fase 7, no se
revirtieron y no se modificaron.

## Veredicto resumido

| Entrega | Clasificación | Veredicto documental |
|---|---|---|
| **7.1** | **Cumplida con reservas** | El arnés y los reportes cubren los dos flujos, percentiles y métricas del pool en Postgres local con proveedor falso. La reproducción no está blindada contra una `DATABASE_URL` remota y no representa el tiempo de Gemini. |
| **7.2** | **Parcial, correctamente abierta** | Hay baseline reproducible y no se inventó un gate. Falta el requisito de negocio que permita convertirlo en presupuesto de latencia y criterio de aceptación. |
| **7.3** | **Cumplida en el diagnóstico probado, con reserva de evidencia** | Está documentado que la latencia crece sin error observable hasta los niveles reportados. La cifra adicional de concurrencia 400 no tiene una tabla o salida primaria versionada; además `pool.waiting` no mide turnos completos. |
| **7.4** | **Cumplida como prueba local y declaración de no soporte** | El artefacto prueba `statement_timeout`, abandono del cliente y el mecanismo interno de `pg`. El flujo actual no conecta cancelación física a las consultas RAG. |

**Estado global:** Fase 7 no debe marcarse como completamente cerrada: 7.2
sigue parcial por ausencia de SLO/requisito de negocio, y 7.3 conserva una
brecha de trazabilidad para la afirmación de 400. La evidencia existente sí
permite cerrar el diagnóstico local de 7.1, 7.3 y 7.4 dentro de sus límites.

## 1. Contraste con el plan y el progreso

El plan define estos criterios (`PLAN-MAESTRO-V2.md:686-698`):

- **7.1:** escenario reproducible con proveedor falso, N conversaciones,
  p50/p95/p99 por flujo y ocupación del pool.
- **7.2:** presupuesto derivado de requisito y baseline; ningún umbral
  inventado si no existe requisito.
- **7.3:** degradación bajo saturación, primer punto de fallo y error estable
  frente a timeout ciego, documentado con una corrida.
- **7.4:** probar cancelación física de una query PostgreSQL o declararla no
  soportada.

El propio plan registra el estado de las cuatro entregas en
`PLAN-MAESTRO-V2.md:700-708`. `progreso.md` está actualizado al 2026-09-10 y
describe trabajo posterior de Fase 8 y 9, pero no contiene una entrada propia
de 7.1-7.4. Por tanto, la afirmación de estado de Fase 7 proviene del plan y
de `resiliencia/carga-concurrencia-cancelacion.md`, no de un registro
independiente en el progreso general.

Hay una inconsistencia histórica en la motivación del plan: `PLAN-MAESTRO-V2.md:675-679`
todavía describe el pool como si usara el default de `pg` (`max` 10), mientras
el estado de la entrega y el código actual usan `max: 20`. El criterio y los
resultados de Fase 7 ya usan 20; la motivación inicial debe leerse como
contexto anterior, no como configuración vigente.

## 2. Fase 7.1 — escenario reproducible

### Evidencia

`scripts/load-test-rag.ts`:

- Fuerza `GEMINI_API_KEY` vacío y `RAG_USE_VECTOR=false` (`:12-25`), y usa el
  `getRagPool()` real (`:55-66`), no un pool simulado.
- Ejecuta workers concurrentes por nivel y mide `totalCount`, `idleCount` y
  `waitingCount` cada 50 ms (`:73-95`).
- Calcula p50, p95, p99, máximo y tasa de error separada (`:98-130`).
- Acepta niveles y duración por argumentos y escribe el reporte (`:143-168`,
  `:208-231`).

Los reportes versionados cubren:

- `reports/load-test-rag.md`: `chat` y `presupuesto`, concurrencias 1, 5,
  10, 15, 20, 30, 50 y 80, durante 8 s.
- `reports/load-test-rag-extremo.md`: `presupuesto`, concurrencias 120, 180
  y 250, durante 12 s.

La entrega narrativa confirma que el pool probado es el de
`src/lib/rag/db.ts`, contra Postgres local y con proveedor de IA falso. El
código actual del pool fija `max: 20`, `idleTimeoutMillis: 30_000`,
`connectionTimeoutMillis: 5_000` y `statement_timeout: 30_000`
(`src/lib/rag/db.ts:8-24`).

### Reservas

1. La reproducción documentada sobrescribe `DATABASE_URL` con
   `127.0.0.1` en el comando, pero el script solo comprueba que la variable
   exista (`:208-210`). También carga `.env.local` y `.env` (`:10`). No hay una
   validación que rechace Neon u otro host remoto. El artefacto dice que no se
   usó Neon; el script, por sí solo, no lo impide.
2. El proveedor falso caracteriza la capa RAG/PostgreSQL sin coste, no el
   tiempo del LLM ni el turno completo de chat en producción.
3. La evidencia primaria llega a concurrencia 250. La afirmación posterior de
   una corrida a 400 aparece en el documento narrativo y en el plan, pero no en
   ninguno de los dos reportes versionados ni en un archivo de salida separado.
4. La métrica `waitingCount` de `pg.Pool` cuenta solicitudes pendientes de
   adquirir una conexión. No equivale a cantidad de conversaciones o turnos
   completos en cola: un turno de presupuesto emite muchas consultas y cada
   adquisición puede tener su propia solicitud.
5. El cálculo de percentiles usa únicamente latencias de turnos exitosos
   (`load-test-rag.ts:105-119`). Mientras el error sea 0% esto no cambia las
   cifras reportadas, pero con errores la latencia de fallos no entraría en los
   percentiles.

### Qué sí se puede afirmar

Se puede afirmar que existe un arnés reproducible en código para comparar los
dos flujos RAG contra un Postgres local, con percentiles y muestreo del pool.
También se puede afirmar que el caso `presupuesto` ejecuta el fan-out por
roles descrito por el plan (`buscar-presupuesto.ts:185-203`).

No se puede afirmar a partir de esta auditoría que el sistema soporte 250 o
400 conversaciones con una latencia aceptable; solo que esos escenarios (250
con evidencia tabular, 400 según la narrativa) no registraron el tipo de error
reportado.

## 3. Fase 7.2 — presupuesto de latencia

### Evidencia y clasificación

**Clasificación: parcial, de forma intencional y correcta.** El plan prohíbe
inventar umbrales si no hay requisito. `reports/load-test-rag.md:8` y
`resiliencia/carga-concurrencia-cancelacion.md:70-87` registran que no existe
un requisito de negocio documentado y dejan el resultado como baseline.

En concurrencia 1, el reporte conserva estos valores del RAG con proveedor
falso:

| Flujo | p50 | p95 | p99 | Alcance |
|---|---:|---:|---:|---|
| `chat` | 35 ms | 108 ms | 132 ms | RAG/PostgreSQL, sin Gemini |
| `presupuesto` | 53 ms | 104 ms | 125 ms | RAG/PostgreSQL, sin Gemini |

No hay un umbral de aceptación ni un pass/fail de latencia, lo que es
coherente con el criterio del plan y evita presentar un número operativo sin
dueño de negocio.

### Pendiente necesario

Debe decidirse, fuera de esta auditoría, el requisito por flujo: percentil,
ventana de medición, población concurrente, inclusión o exclusión del tiempo
del proveedor y tratamiento de errores. Solo después corresponde fijar gates y
repetir la medición en el entorno que se quiera certificar.

### Qué no se puede afirmar

El baseline no es un presupuesto de latencia de producción, no contiene la
latencia de Gemini, no caracteriza red o Neon y no demuestra que el chat
completo cumpla ningún SLO. Tampoco puede llamarse “fallo” a 7.2 mientras el
requisito que el plan exige todavía no existe; su estado correcto es abierto.

## 4. Fase 7.3 — saturación y degradación

### Evidencia

Los reportes muestran 0% de error en todos sus niveles. En el flujo
`presupuesto`, que es el más exigente, la tabla versionada llega a:

- concurrencia 80: p50 3.684 ms, p95 4.963 ms, p99 5.254 ms;
- concurrencia 120: p50 4.701 ms, p95 6.503 ms, p99 7.204 ms;
- concurrencia 180: p50 8.105 ms, p95 11.490 ms, p99 11.980 ms;
- concurrencia 250: p50 12.491 ms, p95 14.369 ms, p99 14.540 ms.

`pool.total max` llega a 20 y `pool.waiting max` crece con la concurrencia.
La evidencia tabular permite sostener que, dentro de esos niveles, la primera
degradación observada fue la latencia y la cola de solicitudes de conexión,
no una excepción del pool.

La narrativa (`carga-concurrencia-cancelacion.md:89-117`) atribuye el
“timeout ciego” a muchas adquisiciones cortas mediante `pool.query()` en vez
de reservar una conexión por turno. El patrón existe en el retrieval actual:
`search.ts` realiza varias llamadas directas a `pool.query()` (`:149`, `:177`,
`:401`, `:429`, `:468`, `:531`, `:558`, `:580`, `:616`) y el flujo de
presupuesto ejecuta consultas por rol (`buscar-presupuesto.ts:185-203`).

### Reservas de evidencia

1. El documento narrativo afirma una corrida a concurrencia 400 con p50 de
   15,7 s, p99 de 23,1 s y `pool.waiting` de 3.980. No hay una salida primaria
   versionada que permita auditar esa corrida; el último nivel tabulado es
   250. La cifra 400 puede conservarse como afirmación documentada, pero no
   como resultado independiente verificable desde los reportes guardados.
2. `pool.waiting` no debe describirse como “turnos en cola”. Es una cantidad
   de adquisiciones pendientes en el pool en el instante del muestreo. Para
   afirmar turnos pendientes haría falta instrumentar identidad de turno y
   ciclo de vida de cada consulta.
3. El arnés mide latencia total del turno y estado del pool, pero no mide por
   separado el tiempo de espera de cada adquisición. Por eso la explicación
   de que ninguna espera individual alcanzó 5 s es compatible con el código y
   con 0% de errores, pero no está directamente instrumentada en el reporte.
4. La ausencia de error no es capacidad aceptable. A 250 ya se observan
   p50/p95 de segundos; el plan no define que “0% de error” sea un SLO.

### Estado del código actual

No se observa un límite de concurrencia por turno ni backpressure de aplicación
en la frontera del retrieval. El retrieval actual sí usa `Promise.allSettled`
para que un error independiente de FTS o trigram no descarte necesariamente la
otra rama (`search.ts:691-715`), pero eso no limita la cola ni produce un
rechazo estable cuando la saturación solo aumenta la latencia. La ruta de chat
puede mapear errores de base de datos a `RAG_UNAVAILABLE`
(`src/app/api/chat/route.ts:88-95`, `:117-119`), pero las corridas de 7.3 no
alcanzaron esa condición.

### Decisiones pendientes

- Definir un máximo de turnos concurrentes y la política al alcanzarlo:
  rechazo estable, espera acotada o cola explícita.
- Definir si el presupuesto de latencia incluye la cola, cada adquisición,
  todo el retrieval y/o el proveedor de IA.
- Capturar una salida reproducible para la corrida 400, o retirar esa cifra de
  las afirmaciones de cierre.
- Corregir la terminología de `pool.waiting` en la documentación o añadir la
  instrumentación que permita medir turnos, no solo solicitudes de conexión.

## 5. Fase 7.4 — cancelación física de PostgreSQL

### Evidencia y clasificación

**Clasificación: cumplida como prueba local y declaración explícita de no
soporte en la aplicación.** `scripts/test-query-cancellation.ts` contiene diez
aserciones agrupadas en tres pruebas:

- **A:** `statement_timeout` rechaza una `pg_sleep` y se confirma ausencia de
  actividad mediante `pg_stat_activity` (`:61-99`).
- **B:** una carrera que deja de esperar a los 500 ms no cancela la query; el
  monitor confirma que el backend sigue `active` (`:101-139`).
- **C:** `client.cancel(target, query)` consigue cancelación física con una
  conexión reservada y el monitor vuelve a confirmarla (`:141-215`).

El artefacto narrativo registra las diez aserciones en verde y distingue
correctamente entre el mecanismo real de `statement_timeout`, el abandono del
cliente y la API interna de `pg`. El `pg` instalado y bloqueado es 8.23.0
(`package-lock.json:8504-8505`), y el código del driver muestra que
`cancel()` depende de `activeQuery` (`node_modules/pg/lib/client.js:574-587`).

### Contraste con el código actual

La ruta de chat abre una señal de deadline y usa `conLimiteDeEspera()` para
dejar de esperar a `iterador.next()` (`src/app/api/chat/route.ts:49-57`,
`:243-294`). Esa señal sí se entrega al orquestador y al registro de
herramientas (`src/lib/ia/ejecutar.ts:120-145`), y las funciones RAG la
reciben bajo el nombre `rerankSignal` (`registro-herramientas.ts:393-406`,
`:497-505`).

La reserva frente a la redacción original de la entrega es importante: no es
correcto decir que no pasa ninguna señal hasta ningún componente de retrieval.
Sí llega a preparación de embedding/rerank y a la llamada opcional Python.
Pero el contrato la define como `rerankSignal` (`retrieval/types.ts:32-50`),
las consultas SQL siguen siendo llamadas directas a `pool.query()` sin una
señal de cancelación, y no existe reserva de conexión por turno ni llamada a
`client.cancel()` en el retrieval. La conclusión operacional no cambia:
abortar la espera del cliente o el rerank opcional no prueba ni implementa la
cancelación física de una query PostgreSQL de catálogo.

### Reservas

1. Las diez aserciones se documentan como ejecutadas, pero no hay un log de
   salida versionado. Esta auditoría no las volvió a ejecutar.
2. La prueba usa Postgres local. No demuestra el comportamiento del despliegue
   en Neon ni de una conexión de producción.
3. La prueba B reproduce la semántica de una carrera de promesas con
   `pg_sleep`; no atraviesa el endpoint completo ni una consulta real de
   retrieval. Demuestra la propiedad del patrón usado, no una trazabilidad
   end-to-end del turno HTTP.
4. `statement_timeout: 30_000` está configurado en el pool del código actual,
   pero esta lectura no verifica una instancia desplegada ni la efectividad
   remota de esa configuración.
5. La cancelación de `pg` probada depende de una API interna obsoleta. No debe
   convertirse en una promesa de producto ni en una integración permanente sin
   decidir una API soportada y una estrategia de ownership de la conexión.

### Veredicto operativo

La Fase 7.4 cumple el criterio del plan de “probarla o declararla no
soportada”: la capacidad física existe en el driver y fue descrita como
probada localmente, pero no está soportada por el flujo actual de la
aplicación. La cancelación del cliente, el deadline SSE y el fallback de
rerank no deben presentarse como cancelación física de PostgreSQL.

## 6. Decisiones y próximos gates

1. **SLO de 7.2:** el dueño de producto debe fijar requisitos separados para
   `chat` y `presupuesto`, incluidos percentil, concurrencia y alcance del
   reloj.
2. **Backpressure de 7.3:** decidir límite de turnos, cola máxima y error
   público estable. La configuración `max: 20` del pool por sí sola no es esa
   política.
3. **Cancelación de 7.4:** decidir si se implementará cancelación física,
   usando una API soportada y conexiones controladas, o si se mantendrá la
   declaración de no soporte como límite explícito.
4. **Integridad de los artefactos:** guardar la salida y parámetros de la
   corrida 400 si la cifra se conserva; de lo contrario, limitar el cierre a
   los niveles 1-250 documentados.
5. **Seguridad de reproducción:** hacer que los scripts rechacen destinos
   remotos cuando el escenario se declara local, o añadir una salvaguarda
   equivalente antes de permitir que se usen como arnés operativo.
6. **Consistencia documental:** añadir una entrada explícita de Fase 7 al
   seguimiento general solo cuando se haya decidido cómo representar 7.2
   parcial y la reserva de 400. Esta auditoría no modifica ese seguimiento.

## 7. Afirmaciones que no deben hacerse

- “El pool aguanta 250/400 conversaciones.” Los resultados muestran ausencia
  de error en escenarios concretos, no una capacidad aceptable ni un límite
  certificado.
- “La latencia de producción es 35/53 ms.” Esos números son solo RAG local,
  con proveedor falso y sin red de Neon ni Gemini.
- “La saturación devuelve un error estable.” En las corridas observadas no
  hubo error: se observó cola y latencia creciente.
- “`pool.waiting` son turnos en cola.” Son solicitudes pendientes de adquirir
  conexiones muestreadas por el pool.
- “El timeout del cliente cancela PostgreSQL.” La prueba B demuestra lo
  contrario.
- “El `AbortSignal` actual cancela consultas RAG.” Actualmente se usa para el
  orquestador y operaciones opcionales de embedding/rerank; las consultas SQL
  del retrieval no tienen cancelación física conectada.
- “7.2 pasó un gate.” No existe el requisito de negocio necesario para crear
  ese gate.
- “Se verificó el comportamiento contra Neon, Gemini o el tráfico real.” La
  evidencia de Fase 7 fue deliberadamente local y sin proveedor real.

## Fuentes revisadas

- `docs/migracion-python/PLAN-MAESTRO-V2.md:662-708`
- `docs/migracion-python/progreso.md:1-5,119-132`
- `docs/migracion-python/resiliencia/carga-concurrencia-cancelacion.md:1-197`
- `reports/load-test-rag.md:1-46`
- `reports/load-test-rag-extremo.md:1-33`
- `scripts/load-test-rag.ts:1-237`
- `scripts/test-query-cancellation.ts:1-236`
- `src/lib/rag/db.ts:8-27`
- `src/app/api/chat/route.ts:49-57,88-119,243-294`
- `src/lib/ia/ejecutar.ts:120-145`
- `src/lib/ia/registro-herramientas.ts:375-406,497-505`
- `src/lib/rag/retrieval/types.ts:32-50`
- `src/lib/rag/retrieval/search.ts:149-177,504-558,646-739`
- `src/lib/rag/chat/buscar-presupuesto.ts:185-203`
- `package-lock.json:8504-8505`
- `node_modules/pg/lib/client.js:574-587`

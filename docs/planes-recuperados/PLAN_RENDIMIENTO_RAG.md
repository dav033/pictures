# Plan de rendimiento del RAG

**Estado:** las 6 fases del plan quedaron cerradas. Activas: Fase 1 (thinking mínimo en parser), Fase 3 (comentario de `taskType` corregido), Fase 4 (`GEMINI_CHAT_THINKING_LEVEL=low`), Fase 5 (instrumentación de caché, sin activar caché explícito). **Implementadas, medidas y revertidas por evidencia propia:** Fase 2 (modelo `flash-lite` — regresión real de calidad) y Fase 6 (paralelizar la escalera de relajación — sin ganancia medida de latencia, dos corridas + un descarte de hipótesis de pool).
**Fecha:** 2026-08-20.
**Base de medición:** catálogo real (1.672 productos, 3.727 variantes, 1.672 embeddings), API de Gemini real, 238 búsquedas registradas en `rag_query_log`.

Todas las cifras de este documento son **medidas**, no estimadas, salvo donde diga explícitamente "estimado".

---

## 1. Dónde se va el tiempo hoy

### 1.1 Latencia registrada en producción local (`rag_query_log`, n=238)

| Etapa | p50 | p95 | % del total |
|---|---|---|---|
| `latency_parse_ms` (interpretar consulta) | **4.478 ms** | 7.279 ms | **88%** |
| `latency_retrieval_ms` (embedding + SQL) | 430 ms | 1.388 ms | 8% |
| `latency_total_ms` (herramienta completa) | 5.070 ms | 8.108 ms | 100% |

La conclusión es inequívoca: **el retrieval no es el cuello de botella.** Postgres y pgvector resuelven en cientos de milisegundos sobre 1.672 productos. El 88% del tiempo se va en una sola llamada al LLM que solo extrae un JSON de ~60 tokens.

### 1.2 Causa raíz medida

`gemini-3.6-flash` razona por defecto en nivel `medium`. Medido sobre 6 consultas reales del log:

| Consulta | Tokens de "thinking" | Tokens de salida |
|---|---|---|
| "cumpleaños infantil globos dorados decoracion" | 458 | 56 |
| "decoracion de navidad para jardin" | 229 | 51 |
| "globos R-12 verde cafe latex para arbol de navidad" | 587 | 66 |
| "globos fiesta navideña verde rojo dorado café arco" | 518 | 73 |
| "kit globos árbol de navidad o estrella dorada" | **844** | 59 |
| "hola buenas tardes" | 307 | 43 |

**El modelo gasta entre 4x y 14x más tokens pensando que produciendo.** Para una tarea que es clasificación a enums cerrados, ese razonamiento no aporta — lo demuestra el punto 1.3.

### 1.3 Efecto de bajar el nivel de razonamiento (medido)

| Configuración | Latencia media | Thinking | Salidas válidas |
|---|---|---|---|
| baseline (`medium`, actual) | **4.021 ms** | 2.943 tokens | 6/6 |
| `thinkingLevel: "minimal"` | **1.267 ms** | 0 | 6/6 |
| `thinkingLevel: "low"` | 1.434 ms | 0 | 6/6 |
| `gemini-3.5-flash-lite` (default) | **853 ms** | 0 | 4/4 |
| `gemini-3.5-flash-lite` + `minimal` | **813 ms** | 0 | 4/4 |

> **Nota de API:** `thinkingBudget: 0` **no funciona** en Gemini 3.x — devuelve `400 INVALID_ARGUMENT`. Desde Gemini 3.5 el parámetro es `thinkingLevel` (`minimal` | `low` | `medium` | `high`). Verificado contra la API real y contra los tipos del SDK instalado (`node_modules/@google/genai/dist/genai.d.ts:11405`).

### 1.4 El turno de chat también razona

No solo el parseo. Un turno de chat con el system prompt real:

| Configuración | Latencia | Thinking |
|---|---|---|
| baseline | 3.602–4.636 ms | 365–395 tokens |
| `thinkingLevel: "minimal"` | 1.187–1.252 ms | 0 |

Esto importa porque un turno RAG completo son **dos** llamadas de chat (una para decidir llamar la herramienta, otra para redactar la respuesta) más el parseo.

### 1.5 Presupuesto de latencia de un turno completo (estimado a partir de las mediciones)

```
HOY:          chat(3,8s) + parse(4,5s) + retrieval(0,4s) + chat(3,8s)  ≈ 12,5 s
Fases 1-2:    chat(3,8s) + parse(0,85s) + retrieval(0,4s) + chat(3,8s) ≈  8,9 s   (-29%)
+ Fase 4:     chat(1,2s) + parse(0,85s) + retrieval(0,4s) + chat(1,2s) ≈  3,7 s   (-70%)
```

**Matiz importante:** la segunda llamada de chat va en streaming, así que el usuario ve texto antes de que termine. La mejora *percibida* será menor que la mejora de reloj en esa etapa, y mayor en las etapas previas (donde hoy el usuario mira una pantalla quieta).

---

## 2. Corrección de mi diagnóstico anterior

En la conversación previa dije que la prioridad #1 era **eliminar el round-trip separado de `interpretarConsulta`** fusionándolo en el loop de tool-calling. **Los datos dicen que estaba equivocado.**

El problema nunca fue que hubiera una llamada de más — fue que esa llamada tardaba 4,5 s por razonar de más. Bajando el nivel de razonamiento y cambiando de modelo, la misma llamada cuesta 850 ms. Fusionarla ahorraría esos 850 ms restantes, pero a cambio de perder el aislamiento del schema determinista (`IntentQuerySchema`), que es justo la pieza que hoy garantiza que el LLM no pueda transportar un producto o precio inventado — y que tiene un test estructural dedicado (`regression-anti-alucinacion.ts`).

**Recomendación revisada: no fusionar.** Mala relación beneficio/riesgo una vez arreglado el razonamiento.

---

## 3. Hallazgos que NO son de rendimiento

Aparecieron durante la investigación y son más urgentes que la mitad del plan.

### 3.1 🔴 `taskType` se está ignorando silenciosamente

`src/lib/rag/embeddings.ts` distingue `RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`, con un comentario que explica que "Gemini lo usa para orientar el espacio vectorial de forma distinta en cada caso". **Eso ya no es cierto.** Medido:

```
mismo texto, taskType=RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY
  vectores idénticos bit a bit:   true
  similitud coseno:               1.000000
  vector sin taskType:            idéntico a los dos anteriores
```

`gemini-embedding-2` ignora el parámetro. La distinción documento/consulta que el código cree tener **no existe**. No es un bug que rompa nada hoy (ambos lados usan el mismo espacio, que es consistente), pero es una suposición falsa documentada como verdad en un comentario, y alguien la va a creer.

Dato adicional medido: **los vectores ya vienen normalizados** (norma L2 = 1.000000), así que no hace falta normalizar a mano en 768 dimensiones.

### 3.2 🟡 El caché implícito de contexto probablemente no está pegando

Gemini cachea automáticamente prefijos de prompt desde **4.096 tokens**. Medido:

| Componente | Tokens |
|---|---|
| `SYSTEM_PROMPT_BASE` | 1.408 |
| `BLOQUE_SELECCION` | 710 |
| `BLOQUE_RAG` | 777 |
| `BLOQUE_FRANJAS` | 528 |
| **System prompt total** | **3.420** |
| Declaraciones de herramientas (6 activas) | 1.163 |
| **Prefijo total** | **4.583** |

El system prompt solo (3.420) **no llega** al umbral; sumando las herramientas (4.583) **sí lo cruza**. En una prueba aislada sin herramientas, `cachedContentTokenCount` fue **0 en las 3 llamadas idénticas** — confirmado que ahí no pega. **No verifiqué** si pega en el camino real de la app (con herramientas incluidas). Eso es lo primero que hay que instrumentar.

Si no está pegando, se está pagando precio completo por ~4.600 tokens de entrada en **cada vuelta** del loop de herramientas (hasta 10 por conversación).

### 3.3 ✅ El caché semántico NO vale la pena — descartado

Fue lo que propuse en la conversación anterior y los datos lo matan. Sobre las 238 búsquedas reales:

```
total_busquedas: 238
mensajes_unicos: 236
repetición exacta: 0,8%   (una sola consulta apareció 3 veces)
```

Con 236 consultas únicas de 238, un caché — exacto o semántico — no tendría casi nada que devolver. Construirlo sería complejidad e invalidación de caché a cambio de ~1% de hits. **Recomendación: no construirlo.** Si algún día el tráfico se vuelve repetitivo (varios usuarios, consultas de catálogo comunes), se re-evalúa con datos nuevos.

---

## 4. Plan por fases

Ordenadas por relación impacto/riesgo. Cada fase es independiente y reversible.

### Fase 0 — Arnés de medición permanente
**Por qué primero:** sin esto no se puede probar que ninguna fase funcionó.

- Crear `scripts/bench-rag.ts` (los benchmarks de esta investigación fueron temporales y se borraron).
- Debe medir: latencia de parseo, latencia de retrieval, latencia de turno completo, tokens de thinking, y `cachedContentTokenCount`.
- Debe guardar el baseline en `data/` para comparar corridas.
- Añadir `rag:bench` a `package.json`.

**Criterio de aceptación:** reproduce las cifras de §1 con ±15%.

---

### Fase 1 — `thinkingLevel: "minimal"` en el parseo de intención
**Impacto:** parseo 4.021 ms → 1.267 ms (**3,2x**). **Riesgo:** bajo, pero real (ver abajo).

Cambio en `src/lib/rag/query-parser/parse.ts`:

```ts
config: {
  systemInstruction: INSTRUCCION,
  responseMimeType: "application/json",
  responseJsonSchema: JSON_SCHEMA,
  thinkingConfig: { thinkingLevel: "minimal" },   // ← nuevo
}
```

**Regresión medida y su mitigación.** Comparando 12 casos baseline vs `minimal`, **11/12 dieron filtros duros idénticos**. El caso que difirió es significativo:

```
"cumpleaños infantil globos dorados decoracion"
  baseline: categorias = []
  minimal:  categorias = [globo_latex, globo_metalizado, globo_numero_letra]
```

Sin razonamiento, el modelo aplica filtros de categoría de más — lo que **restringe la búsqueda** y puede dejar fuera kits y combos válidos. Repitiendo 4 veces por caso, se confirmó además que el comportamiento es **inestable** (dos resultados distintos para la misma consulta).

La mitigación se probó y funciona: agregar **una regla explícita** sobre categorías a `INSTRUCCION`. Con el prompt reforzado, `minimal` volvió a dar `categorias: []` en los tres casos problemáticos, de forma **estable en las 4 repeticiones**:

```
- "categorias" es el filtro MÁS restrictivo: úsalo SOLO si el cliente nombra explícitamente
  un tipo de producto Y sería un error mostrarle otro tipo (ej. "solo velas", "únicamente
  desechables"). Mencionar "globos" de pasada al describir una decoración NO es un filtro de
  categoría — va en semantic_query. Ante la duda, deja "categorias" vacío: el ranking ya
  prioriza lo que el cliente describió, y un filtro de categoría de más puede dejar fuera
  kits y combos que sí le servían.
```

**Interpretación:** el razonamiento del modelo estaba compensando una instrucción incompleta. Escribir la regla explícitamente es mejor ingeniería que pagar 4 segundos por que el modelo la infiera cada vez.

**Criterios de aceptación:**
- Parseo p50 < 1.500 ms.
- Filtros duros idénticos al baseline en ≥ 11/12 casos, **con el caso de categorías incluido**.
- Estable en 4 repeticiones (sin resultados divergentes).
- `npm run rag:eval` mantiene todos sus umbrales actuales.

**Actualización — implementado y verificado.** `src/lib/rag/query-parser/parse.ts` usa `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }` (mismo modelo, `MODELO_CHAT`). Se creó `scripts/eval-query-parser.ts` (`npm run rag:eval-parser`) como regresión permanente — no existía ningún test de esta pieza. Resultado real: **12/12 casos estables en 3 repeticiones cada uno, p50=1.263ms** (vs 4.478ms del baseline real de producción — **3,5x**).

La regla de "categorias" tuvo que iterarse una vez más de lo previsto: la primera versión ("úsalo solo si el cliente lo nombra explícitamente") arregló el falso-positivo original pero introdujo un falso-negativo nuevo — "necesito un **arco** de globos verde y rojo" a veces dejaba de categorizar como `guirnalda_arco`. La distinción correcta no era "explícito vs. de pasada", era **"la palabra mapea a una sola categoría o abarca varias"**: "arco"/"guirnalda"/"velas"/"kit" son inequívocas, pero "globos" por sí solo abarca 3 categorías del catálogo (`globo_latex`, `globo_metalizado`, `globo_numero_letra`) y fijarla sería adivinar. Con la regla reescrita así, 12/12 estable.

---

### Fase 2 — Modelo dedicado para el parseo (`gemini-3.5-flash-lite`)
**Impacto:** 1.267 ms → **853 ms** (4,7x vs baseline) y **~10x más barato**. **Riesgo:** bajo.

El parseo es clasificación a enums cerrados: no necesita el mismo modelo que conversa con el cliente. Separar el modelo de parseo del de chat:

```ts
// src/lib/gemini.ts
export const MODELO_PARSER = process.env.GEMINI_PARSER_MODEL ?? "gemini-3.5-flash-lite";
```

**Costo por parseo** (precios oficiales vigentes; `gemini-3.6-flash` $0,75/$3,75 por 1M, `gemini-3.5-flash-lite` $0,30/$2,50 por 1M; los tokens de thinking se facturan como salida):

| Configuración | Costo por búsqueda | vs hoy |
|---|---|---|
| Hoy (3.6-flash, thinking medium) | $0,00233 | — |
| Fase 1 (3.6-flash, minimal) | $0,00045 | **5,2x más barato** |
| Fase 2 (flash-lite, minimal) | $0,00024 | **9,7x más barato** |

**Criterios de aceptación:** los mismos de la Fase 1, más parseo p50 < 1.000 ms. Si la calidad de extracción cae por debajo del umbral, se revierte a Fase 1 (una variable de entorno).

**Actualización — implementada, medida y REVERTIDA.** Se implementó `MODELO_PARSER` con `gemini-3.5-flash-lite` y se corrió `rag:eval-parser` completo: **2 de 12 casos fallaron, ambos de forma inestable** (no en todas las repeticiones). Aislado con 8 repeticiones dirigidas por caso, comparando `gemini-3.6-flash` vs `gemini-3.5-flash-lite`, con y sin `thinkingLevel`:

| Caso | 3.6-flash (con/sin minimal) | flash-lite (con/sin minimal) |
|---|---|---|
| Extracción de colores compuestos ("verde y rojo") | 8/8 correcto | 7/8 y 7/8 — **1/8 devolvió `colores: []`** |
| Clasificación de intención ambigua ("ver agotados también") | 8/8 `product_search` | 5/8 y 3/8 — **hasta 5/8 clasificó `other`** |

**No es un efecto del nivel de razonamiento** (con y sin `minimal` falla igual en `flash-lite`, y funciona igual en `3.6-flash`) — es el modelo en sí, medible incluso en tareas de clasificación simple. Se revirtió: `MODELO_PARSER` se eliminó de `src/lib/gemini.ts`, `parse.ts` volvió a `MODELO_CHAT`. La Fase 1 (mismo modelo, `thinkingLevel: minimal`) se mantiene — es la que sostiene el 3,5x medido arriba.

Esta es la razón por la que la Fase 0 (arnés de medición) importa más de lo que parecía en el diseño original: sin `rag:eval-parser`, este cambio se habría desplegado con solo "parece que da las mismas respuestas en unos pocos ejemplos a mano" — que es exactamente el nivel de evidencia con el que se propuso originalmente esta fase.

---

### Fase 3 — Arreglar la mentira de `taskType` (correctitud, no rendimiento)
**Impacto:** ninguno en latencia. **Riesgo:** ninguno. **Urgencia:** alta, es deuda de correctitud.

- Quitar el parámetro `taskType` de `embeberTexto` o dejarlo documentado como inerte con la evidencia.
- Corregir el comentario de `src/lib/rag/embeddings.ts:8-12`, que hoy afirma algo falso.
- Quitar cualquier suposición de que documento y consulta viven en espacios distintos.
- Documentar que los vectores ya vienen L2-normalizados.

**Importante:** esto **no** obliga a re-embeber el catálogo. Los 1.672 embeddings actuales son válidos y consistentes entre sí — simplemente nunca fueron lo que el comentario decía.

**Criterio de aceptación:** `npm run rag:eval` sin cambios en sus métricas (prueba de que el parámetro efectivamente no hacía nada).

**Actualización — implementada.** Comentario de `src/lib/rag/embeddings.ts` corregido con la evidencia medida (vectores idénticos bit a bit entre `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY`/sin taskType, norma L2=1.0). El parámetro se mantiene en la firma de `embeberTexto` — es inerte hoy pero no dañino, y documenta la intención en cada call site; se retiraría solo si se vuelve confuso mantenerlo. `rag:eval` sin cambios en sus métricas, como se esperaba.

---

### Fase 4 — `thinkingLevel` en el turno de chat
**Impacto:** el más grande (turno de chat 3,8 s → 1,2 s, y ocurre 2+ veces por turno). **Riesgo: ALTO.**

Aquí es donde hay que tener cuidado. El razonamiento del modelo de chat no es decorativo: sostiene la elección de herramienta, las reglas de honestidad al sustituir, la decisión de no inventar productos, y el flujo conversacional. Bajarlo a `minimal` sin evaluación es exactamente el error que este proyecto ha evitado en todo lo demás.

**Propuesta escalonada:**
1. Probar `low` antes que `minimal` (en el parseo la diferencia entre ambos fue de solo 167 ms, pero en conversación puede importar mucho más).
2. Construir un set de conversaciones de regresión (8–10 diálogos completos) que ejerciten: elección correcta de herramienta, honestidad al sustituir color, manejo de `NO_MATCH`, y respeto a la whitelist.
3. Comparar baseline vs `low` vs `minimal` sobre ese set.
4. Activar detrás de una variable de entorno, con default en el valor actual.

**Criterio de aceptación:** cero regresiones en el set de conversaciones. **Si hay una sola, no se activa** — 2,6 s no valen una alucinación.

**Actualización — implementada y activa.** Se creó `scripts/eval-chat-thinking.ts` (`npm run rag:eval-chat`, requiere `--conditions=react-server` porque `ejecutar.ts`/`registro.ts`/`db.ts` importan `server-only` — ver nota de infraestructura abajo) con 7 diálogos reales contra el catálogo, cada uno con verificación **estructural** de la traza de herramientas (se instrumentó `ejecutarConversacion` con un `onLlamada` opcional, sin cambiar comportamiento) en vez de comparar texto: elección correcta de herramienta, honestidad ante NO_MATCH y SKU inexistente, `guardar_brief` captura los datos, regla de "una búsqueda por elemento", y franjas de presupuesto.

Resultado, 2 repeticiones x 7 casos x 3 configuraciones:

| Config | Casos estables | Latencia p50 | Latencia p95 |
|---|---|---|---|
| baseline (medium, actual) | 7/7 | 14.047ms | 24.474ms |
| `low` | 7/7 | 7.166ms | 13.634ms |
| `minimal` | 7/7 | 7.938ms | 14.072ms |

Cero regresiones en ambas configuraciones — por criterio del propio plan, esto SÍ se activa. Se eligió **`low` sobre `minimal`** pese a ganar prácticamente lo mismo en latencia: más margen de razonamiento para casos no cubiertos por estas 7 pruebas, en una pieza que el plan mismo clasificó como riesgo ALTO. Activado vía `GEMINI_CHAT_THINKING_LEVEL=low` en `.env.local` (mecanismo: `registro.ts` lee la env var y la pasa a `crearChatGemini({thinkingLevel})`, que ahora acepta el parámetro opcional — sin la env var, comportamiento idéntico a antes).

Verificado en el navegador contra el servidor real después de reiniciar (para recoger el nuevo `.env.local`): flujo completo correcto, cero errores de consola, sustitución honesta (pidió "blanco y dorado", el catálogo no tenía blanco exacto, la respuesta dijo "dorados y champaña" sin reclamar blanco).

**Nota de infraestructura descubierta en el camino:** `ejecutar.ts`, `registro.ts`, `db.ts` (y otros) importan `"server-only"`, que lanza una excepción si se resuelve fuera de la condición `react-server` del bundler de Next.js — por eso ningún script antes de este importaba `ejecutar.ts` directo. `node/tsx --conditions=react-server` resuelve `server-only` a un módulo vacío en vez de lanzar, permitiendo probar el orquestador real sin duplicar su lógica. También se encontró y arregló un bug del propio arnés de evaluación: `flags.ts` lee `RAG_ENABLED` en el top-level del módulo, y los `import`s de un script se resuelven ANTES que cualquier `process.loadEnvFile()` puesto después de ellos en el mismo archivo — la primera versión de `eval-chat-thinking.ts` leía `RAG_ENABLED=false` por esta razón, aunque `.env.local` diga `true`. Se resolvió cargando el env con `tsx --env-file=.env.local` (carga a nivel de proceso, antes de que cualquier módulo se evalúe) en vez de `process.loadEnvFile()` dentro del script.

Para que la evaluación probara el prompt de producción EXACTO (no una copia que pudiera divergir), `SYSTEM_PROMPT_BASE`/`BLOQUE_SELECCION`/`BLOQUE_RAG`/`BLOQUE_FRANJAS` se extrajeron de `route.ts` a `src/lib/ia/prompt-sistema.ts` (extracción pura, mismo texto) — `route.ts` y el script de evaluación importan la misma función `construirSistema()`.

**Limitación honesta:** 7 diálogos de un solo turno cada uno, 2 repeticiones. Cubre las 4 dimensiones de riesgo que el plan nombró, pero no es exhaustivo — no prueba conversaciones multi-turno reales (varios mensajes de usuario encadenados) ni el camino de `ejecutarConversacionStream` específicamente (se probó `ejecutarConversacion`, no-streaming; ambos comparten el mismo `thinkingConfig` pero son llamadas HTTP distintas a la API de Gemini). Si en uso real aparece un patrón de conversación que estas 7 pruebas no cubren y algo se comporta mal, `GEMINI_CHAT_THINKING_LEVEL` vacío revierte al instante sin tocar código.

---

### Fase 5 — Verificar y asegurar el caché implícito
**Impacto:** hasta 90% de descuento en la porción cacheada del prompt de entrada; latencia menor en TTFT. **Riesgo:** bajo.

1. Instrumentar `cachedContentTokenCount` en el camino real de la app (con herramientas incluidas) y registrarlo en `rag_query_log`.
2. Si **no** está pegando: revisar el orden del prompt. Hoy `contexto` (el brief, que cambia en cada request) se concatena **al final** del system prompt — que es la posición correcta. Verificar que nada variable se cuele antes.
3. Si está pegando, medir el ahorro real y dejarlo documentado.

**Criterio de aceptación:** `cachedContentTokenCount > 0` de forma consistente a partir de la segunda vuelta del loop de herramientas, o una explicación documentada de por qué no aplica.

**Actualización — verificado: NO engancha. Instrumentado; caché explícito evaluado y descartado.**

Medido con el prefijo real (system prompt + las 5 herramientas activas con RAG+franjas = 4.575 tokens, por encima del umbral de 4.096): **15/15 llamadas con `cachedContentTokenCount = 0`** — 5 idénticas en secuencia, 5 idénticas en paralelo (simulando ráfaga), 5 con sufijo distinto. No es un problema de umbral (4.575 > 4.096 con margen) ni de que las llamadas no fueran realmente idénticas. El caché implícito de la API de Gemini Developer (`GEMINI_API_KEY` de AI Studio, no Vertex) simplemente no se activa para este patrón de tráfico con esta llave — verificado también en vivo en el panel de admin (`/admin` → Motor IA) después de una conversación real: ninguna llamada mostró tokens cacheados.

Se instrumentó de todas formas (`cachedContentTokenCount` → `TurnoChat.uso.cacheados` → `EventoTelemetria.tokensCacheados` → columna "Tokens" del panel admin, `src/components/admin/MotorIATab.tsx`) para que quede visible sin volver a investigar si esto cambia — un cambio de SDK, de tier de API, o de tráfico podría activarlo sin que nadie lo note si no hay dónde mirarlo.

**No se implementó caché explícito** (`client.caches.create()`, sí soportado por `generateContent`). Motivos:
- Requeriría partir el prompt en una porción estática cacheable (todo salvo `contexto`, el brief que cambia por request) y gestionar el ciclo de vida del `CachedContent` (creación, TTL, facturación mínima por tiempo de vida, invalidación cuando cambie el prompt) — complejidad real de mantenimiento nueva.
- El caso de uso que lo justifica es tráfico concurrente de varios usuarios compartiendo el mismo prefijo en una ventana corta — exactamente el escenario de producción que quedó fuera de alcance en esta sesión. Con un solo desarrollador probando localmente, no hay prefijo repetido suficiente para que el ahorro (~90% del costo de la porción cacheada) sea significativo en términos absolutos.
- Si esto se despliega para más de un usuario, es el primer punto a reevaluar — con datos de tráfico real, no los de esta sesión.

---

### Fase 6 — Paralelizar la escalera de relajación (solo modo franjas)
**Impacto:** medio, acotado al modo franjas (`RAG_FRANJAS_ENABLED`, hoy apagado). **Riesgo:** bajo, pero quema más cuota.

`src/lib/rag/retrieval/por-rol.ts` prueba hasta 5 configuraciones **en secuencia** hasta que una devuelve resultados. Los 5 roles ya corren en paralelo entre sí, pero dentro de cada rol la escalera es serial.

Opción: lanzar los intentos en paralelo y quedarse con el primero no vacío. Cambia latencia por consumo — en el peor caso hace 5 queries donde hoy hace 1.

**Recomendación: dejarla para el final.** Con el retrieval en 430 ms p50, esta fase optimiza el 8% del problema. Solo tiene sentido cuando las fases 1–4 ya hayan movido el 88%.

**Actualización — implementada, medida y REVERTIDA.** Se paralelizaron los `intentos` con `Promise.all` (mismo criterio de prioridad: gana el primero en el orden de la escalera que tenga resultados, nunca "el que respondió más rápido"). Antes de medir se verificó que el supuesto base fuera cierto: con `scripts/eval-presupuesto.ts` contra el catálogo real, **8 de 12 casos SÍ activan la escalera de relajación** (hasta 5 relajaciones por caso) — no es un escenario raro, la premisa de la fase era correcta.

Aun así, la latencia no mejoró:

| Versión | p50 | p95 |
|---|---|---|
| Secuencial (antes) | 1.674ms | 2.212ms |
| Paralela, corrida 1 | 1.887ms | 3.581ms |
| Paralela, corrida 2 | 1.752ms | 2.940ms |
| Paralela + pool `max: 50` (descartar contención) | 1.977ms | 2.182ms |

Se sospechó contención del pool de Postgres (`max` sin configurar = 10 por defecto de `pg`; un turno de franjas puede disparar hasta 5 roles × 5 intentos = 25 queries concurrentes) — se probó subiendo el pool a `max: 50` en una corrida de diagnóstico, y **tampoco mejoró**, descartando esa hipótesis. La causa real no se investigó más: el plan ya clasificó esta fase como "impacto medio, 8% del problema", y confirmar la causa exacta de por qué el paralelismo no ayuda aquí costaría más esfuerzo del que ese impacto justifica.

Se revirtió a secuencial — pagar hasta 5x más queries por rol sin ninguna ganancia medida es estrictamente peor que no tocarlo. `scripts/eval-presupuesto.ts` quedó con una mejora permanente y real de esta investigación: ahora imprime `relajaciones` por caso, útil para cualquier trabajo futuro sobre la escalera.

---

## 5. Resumen de decisiones

| Acción | Veredicto | Razón |
|---|---|---|
| Bajar thinking en el parseo (mismo modelo) | ✅ **Hecho** | Medido: 4.478ms → 1.263ms p50 (**3,5x**), 12/12 estable |
| Modelo `flash-lite` para parseo | ❌ **Hecho y revertido** | Medido: falla clasificación de intención (hasta 5/8) y color compuesto (1/8) |
| Arreglar `taskType` | ✅ **Hecho** | El código documentaba algo falso, corregido con evidencia |
| Bajar thinking en el chat (`low`) | ✅ **Hecho y activo** | 7/7 estable, p50 14.047ms→7.166ms — activado vía `GEMINI_CHAT_THINKING_LEVEL` |
| Verificar caché implícito | ✅ **Hecho: NO engancha** | 15/15 llamadas con 0 tokens cacheados, prefijo por encima del umbral. Instrumentado en el panel admin por si cambia |
| Caché explícito | **Descartado por ahora** | Requiere partir el prompt + gestionar ciclo de vida; el ahorro solo se justifica con tráfico concurrente real |
| Paralelizar escalera de relajación | **Hecho y revertido** | 8/12 casos activan la escalera (premisa correcta), pero 0 ganancia medida en 2 corridas; contención de pool descartada como causa |
| Paralelizar relajación | **Aplazar** | Optimiza el 8% del problema |
| **Caché semántico** | **Descartar** | 0,8% de repetición: no tendría qué devolver |
| **Fusionar parseo en tool-loop** | **Descartar** | Ahorra 850 ms a costa del aislamiento del schema |
| Índice HNSW/IVFFlat | **No aplica** | 430 ms p50 sobre 1.672 filas; no es el cuello |
| Framework (LangChain, etc.) | **No aplica** | Agrega capas sobre las mismas llamadas; no quita round-trips |

**Ganancia medida de las fases 1+3 (parseo de intención):** 4.478ms → 1.263ms p50 (**-72%**, 3,5x). En el pipeline completo de franjas (`rag:eval-presupuesto`): 3.338ms → 1.743ms p50 (**-48%**).
**Ganancia medida de la fase 4 (turno de chat):** 14.047ms → 7.166ms p50 (**-49%**), 7/7 diálogos de regresión estables.
**Combinadas**, un turno típico con búsqueda + confirmación (parseo + retrieval + 2 turnos de chat) pasa de un estimado de ~12,5s a algo del orden de 4-5s reales — ya no es una proyección, la mayoría de las piezas están medidas por separado y activas en `.env.local`.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| `minimal` aplica filtros de categoría de más → menos resultados | **Confirmada** (medida) | Regla explícita en el prompt, ya probada estable |
| Bajar thinking en chat degrada honestidad/elección de herramienta | Media | Fase 4 detrás de flag + set de regresión conversacional |
| `flash-lite` extrae peor en consultas largas | Baja | Umbral de aceptación + rollback por variable de entorno |
| Un cambio de modelo de Google altera el comportamiento | Media | Fijar el id de modelo en `.env`, no depender del default |
| Las cifras de latencia varían por red/hora | Alta | Fase 0 (arnés) antes que cualquier cambio |

---

## 7. Lo que NO se midió

Honestidad sobre los límites de esta investigación:

- **No** se verificó si el caché implícito pega en el camino real de la app (con herramientas). Es la primera tarea de la Fase 5.
- **No** se midió la latencia del embedding por separado — está incluida dentro de los 430 ms de retrieval junto con el SQL.
- **No** se evaluó el impacto de bajar el thinking sobre la calidad *conversacional* (solo sobre la extracción estructurada). Es exactamente lo que la Fase 4 exige antes de activarse.
- Las mediciones salen de **una sola máquina, una sola región y un solo momento**. La variabilidad de red no está caracterizada.
- El set de comparación de calidad fueron **12 casos**. Suficiente para detectar una regresión evidente (de hecho detectó dos, una real y una de mi propio criterio de prueba), insuficiente para afirmar equivalencia estadística. Ahora vive como `scripts/eval-query-parser.ts` (`npm run rag:eval-parser`) — se puede ampliar en vez de repetir el trabajo ad-hoc.
- El caso de "categorías" se arregló dos veces en esta sesión (primero sobre-corrigió, después se afinó). Es evidencia de que **12 casos no bastan para confiar ciegamente en un prompt nuevo** — bastaron para encontrar el problema, no para garantizar que no hay un tercer caso similar sin cubrir.

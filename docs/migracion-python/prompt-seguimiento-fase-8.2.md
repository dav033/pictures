# PROMPT DE SEGUIMIENTO — Fase 8.2 y 8.3 (primera capacidad de IA real en Python)

Eres el orquestador continuando `docs/migracion-python/PLAN-MAESTRO-V2.md`, un
plan de 10 fases para migrar demo-decoracion (chatbot de decoración con
Next.js + Gemini/fal.ai) a un backend Python incremental. Las Fases 1–7 y la
8.1 ya están completas y desplegadas. Sigue la Fase 8.2 (reranking con
cross-encoder) y, si hay tiempo, la 8.3 (embeddings batch offline).

## Estado exacto del repo

- Working directory: `C:\Users\davidt\Downloads\demo-decoracion`
- Rama: `main` (se trabaja y se pushea directo a main en esta sesión —
  patrón ya establecido, no una decisión a re-litigar)
- Último commit al cierre de la sesión anterior: `055d233` — feat(rag):
  suite de evaluación del RAG en pytest con fixture reproducible (Fase 8.1)
- Árbol de trabajo limpio al cierre (verificar con `git status` al
  empezar, por si hay cambios concurrentes de otra sesión — ya ha pasado
  antes en este proyecto)

## Infraestructura real (ya autorizada, no pedir permiso de nuevo salvo escalamiento)

- **Producción**: EC2 `n8n-maros` (alias SSH en `~/.ssh/config`, clave
  `~/.ssh/n8n-maros-ssh.pem`), contenedor Docker `demo-decoracion` en la red
  `stack_web`, compartido con 3 proyectos más (`hermes-agent-personal`,
  `stack-api`, `lotm`, `trainingapp-*`). Deploy vía
  `.github/workflows/deploy.yml` (dispara por `workflow_run` cuando
  `checks.yml` = "Quality checks" concluye success), ejecuta
  `/home/ec2-user/deploy-demo-decoracion.sh <SHA>`.
- **Disco del EC2 — RIESGO ACTIVO**: al cierre de la sesión anterior,
  **92% usado, 3.6GB libres** (`df -h /`, `/dev/nvme0n1p1`, 40G totales).
  Ya se agotó una vez esta semana (100%, deploy falló con `ENOSPC`) y se
  liberaron 6.9GB con `docker builder prune -f` (cero riesgo, no toca
  imágenes/contenedores de otros proyectos, ya autorizado como acción
  segura recurrente). **Antes de desplegar 8.2** (que añade PyTorch +
  sentence-transformers a la imagen Docker de `services/ai-api`, estimado
  1-2GB adicionales), correr `ssh n8n-maros "df -h /"` primero. Si está por
  encima de ~85%, correr `docker builder prune -f` de nuevo (seguro, ya
  autorizado). Si eso no basta, **pedir confirmación explícita** antes de
  tocar imágenes viejas de `hermes-agent-personal` (~20 tags, no es tuyo).
- **Neon** (Postgres comercial real):
  `neondb_owner@ep-weathered-tree-axgxgn6c-pooler.c-4.us-east-2.aws.neon.tech/neondb`.
  Acceso de lectura ya autorizado. **8.2 no necesita tocar Neon en ningún
  paso** — todo el desarrollo/prueba del reranking debe correr contra el
  Postgres local.
- **Postgres local (Docker)**: contenedor `demo-decoracion-postgres-1`,
  usuario `demo`, password `demo`, DB `demo_rag`, puerto 5432 (host).
  `DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"`.
  **Hallazgo real de la sesión anterior**: este Postgres local NO tiene
  `sku_original`/`sku_canonical` poblados (el pipeline `npm run rag:sync` →
  `scripts/import-shopify-catalog.ts` no los calcula; Neon sí los tiene
  completos, producción no está afectada). Esto no bloquea 8.2, pero si
  alguna prueba de reranking usa casos de categoría SKU, van a fallar por
  esto, no por el reranking — ver
  `docs/migracion-python/rag/eval-python-fase8.md`.
- **CI**: `.github/workflows/checks.yml` tiene el job `python-quality`
  (`services/ai-api`, corre `uv run pytest` sin `DATABASE_URL` — cualquier
  test que dependa de Postgres debe usar `pytest.mark.skipif` como ya hace
  `tests/test_operational_schema_permissions.py` y la nueva
  `tests/test_rag_eval_variance.py`) y el job `deterministic-tests`
  (Next.js/TS, sí tiene `DATABASE_URL` contra un Postgres efímero en CI).
  Ninguno de los dos tiene Node+Python simultáneamente disponibles con
  certeza — si el reranking necesita un test de integración real
  Next→Python, probablemente no puede correr en ninguno de los jobs de CI
  existentes sin agregar uno nuevo; documentar esa limitación en vez de
  fingir que hay cobertura de CI que no existe.
- **Log real de CI sin gh CLI** (no está instalado): `GH_TOKEN=$(git
  credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null |
  sed -n 's/^password=//p')`, luego `curl -sL -H "Authorization: token
  $GH_TOKEN" .../logs`. **Los logs de GitHub Actions llegan con cada letra
  "e" reemplazada por "***"** en la vista previa de algunas herramientas —
  es un artefacto de redacción, no un error real; si un log se ve raro,
  guardarlo a un archivo y grepear/leerlo directo en vez de confiar en el
  preview.

## Reglas de seguridad y método establecidas (no re-litigar, solo aplicar)

- Prioridad permanente: el webhook de Happia
  (`/api/happie/webhook/{chat,recommend-package,recommend-packages}`) tiene
  que seguir funcionando después de CUALQUIER cambio, sobre todo tras un
  deploy a producción. Verificar tras cada deploy: `ssh n8n-maros "docker
  inspect demo-decoracion --format 'Status={{.State.Status}}
  Restarting={{.State.Restarting}}'; docker logs demo-decoracion --since
  10m 2>&1 | grep -iE 'fatal|unhandled|TypeError'"`.
- Nunca loguear ni devolver mensajes de error crudos de proveedores/DB al
  cliente.
- **No inventar números/umbrales sin medición o requisito real.** Ya se
  aplicó explícitamente en 7.2 (sin requisito de latencia documentado, se
  dejó el baseline medido sin gate) y en 8.1 (el gate de determinismo
  cross-corrida usa varianza CERO como criterio porque es una garantía
  real del sistema con proveedor falso, no un umbral inventado). Para 8.2:
  la evaluación antes/después NO debe fijar un umbral de "cuánto debe
  mejorar" sin que exista un requisito — si el reranking no mejora o
  empeora, se documenta como resultado negativo tal cual pide la Salida de
  la Fase 8, no se fuerza un resultado positivo.
- Antes de tocar código de un hallazgo previo, releer el archivo real —
  varias veces esta semana un hallazgo de sesiones anteriores ya estaba
  corregido, o (como con `rag_source_snapshots` y
  `sku_original`/`sku_canonical`) resultó ser un problema más profundo de
  lo que el plan asumía. No asumir que este mismo prompt sigue vigente sin
  comprobar contra el código actual al empezar.
- Verificación estándar antes de cada commit: `npx tsc --noEmit`, `npm run
  lint -- <archivos tocados>`, `npm run build --workspaces --if-present`
  (y `npm run build` completo si se tocó código de aplicación Next), más
  el/los test(s) real(es) relevantes. Para el lado Python:
  `cd services/ai-api && uv run --extra quality ruff check app scripts
  tests && uv run --extra quality ruff format --check app scripts tests &&
  uv run --extra quality mypy app scripts && uv run --extra test python -m
  pytest`. Después de cada push a main, monitorear "Quality checks" y
  "Deploy to EC2" vía la API pública de GitHub Actions antes de dar por
  cerrado el commit.
- Gasto real en proveedores pagados (Gemini, fal.ai) requiere autorización
  explícita antes de ejecutar. **El cross-encoder de 8.2 NO es un gasto
  real** (modelo local, CPU, sin llamada a ningún proveedor) — no requiere
  esta autorización, pero descargar el modelo (~80MB de pesos vía
  HuggingFace Hub) sí necesita salida a internet desde donde se ejecute;
  confirmar que el entorno de build/CI/EC2 tiene esa salida o que el
  modelo se empaqueta en la imagen en vez de descargarse en runtime.
- Rotar/tocar `DATABASE_URL` de producción (Neon) requiere autorización
  aparte — no aplica a 8.2/8.3.
- Commits en español, estilo ya establecido: prefijo tipo (fix, feat, perf,
  docs, test, refactor) + (alcance), cuerpo explicando qué se encontró/por
  qué/cómo se verificó, terminando en `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>`.
- Comunicación con el usuario en español; comentarios de código en inglés
  (ver `AGENTS.md`).

## Decisiones ya tomadas por el usuario (no re-preguntar)

1. **Modelo cross-encoder aprobado**: `cross-encoder/ms-marco-MiniLM-L-6-v2`
   (sentence-transformers). Estándar de industria, CPU-only, ~80MB de
   pesos. Se explicó al usuario qué hace un cross-encoder (reordena un par
   query+candidato leyéndolos juntos, más preciso que los embeddings
   bi-encoder que ya usa el retrieval, pero muy caro para correr sobre todo
   el catálogo — por eso solo reordena la lista corta que Postgres ya
   filtró) y por qué en Python (ecosistema PyTorch/transformers maduro;
   evita pagar otra llamada a Gemini). Si en el camino aparece una razón
   real para cambiar de modelo (no solo preferencia), confirmar con el
   usuario antes de cambiarlo — la aprobación fue para este modelo
   específico.
2. **Riesgo de disco del EC2 aceptado con esta condición**: construir 8.2
   completo primero (local, sin tocar el EC2), decidir el despliegue
   después, revisando el disco otra vez antes de desplegar — exactamente
   el patrón de "explicar antes de ejecutar" ya usado para 5.2.
3. **Orden**: 8.1 → 8.2 → 8.3 (el orden del plan), sin cambios.

## Las 3 entregas de Fase 8, estado exacto al cierre de la sesión anterior (2026-09-09)

### 8.1 — Suite de evaluación del RAG en pytest — HECHO

Ver `docs/migracion-python/rag/eval-python-fase8.md` para el detalle
completo. Resumen:

- `scripts/eval-rag-fixture.ts` genera (`--generate`) y corre (`--run`) un
  fixture determinista contra el catálogo en vivo (sin depender de
  `rag_source_snapshots`, que está rota — ver hallazgo abajo).
- `eval/rag/fixture-live-catalog.json` es el fixture versionado (25 casos
  hoy: 0 sku por el hallazgo de `sku_original`, 15 nombre, 5 filtro, 5
  sin_resultado).
- `services/ai-api/tests/test_rag_eval_variance.py` corre el fixture 3
  veces en procesos independientes y exige varianza cero en las métricas
  de correctitud.
- **Usa este fixture para la evaluación antes/después de 8.2**, no
  `eval/rag/ground-truth-v2.jsonl` (ver hallazgo siguiente). Puede que
  necesites extenderlo (más casos, o una categoría nueva que compare el
  orden de candidatos ambiguos/parecidos — el reranking no cambia RECALL,
  cambia en qué POSICIÓN queda el candidato correcto entre varios
  parecidos, así que el fixture actual de 8.1, centrado en recall binario,
  puede no ser suficientemente sensible para medir la mejora que 8.2
  promete. Diseñar esto con cuidado, no asumir que el fixture de 8.1 sirve
  tal cual).

**Hallazgo activo (no arreglado, documentado)**: `eval/rag/queries-v2.jsonl`
+ `ground-truth-v2.jsonl` (416 casos, el corpus que la Salida de la Fase 8
cita literalmente) depende de una fila publicada en `rag_source_snapshots`,
que solo escribe `scripts/import-cdn-catalog.ts` — el pipeline que de
verdad usa `npm run rag:sync` (`scripts/import-shopify-catalog.ts`) nunca
la escribe. `rag_source_snapshots` está vacía tanto en Neon como en local.
`bench-rag-v2.ts`/`eval-rag-v2.ts` no pueden correr contra ninguna base
real disponible. Arreglar esto es trabajo de otra fase (Fase 3/regeneración
RAG) — no lo hagas como parte de 8.2 salvo que el usuario lo pida
explícitamente.

### 8.2 — Reranking de candidatos (cross-encoder local) — NO INICIADO

**Entrega exacta** (plan, capítulo Fase 8): "Recibe la lista que PostgreSQL
ya autorizó y solo puede reordenarla. No puede añadir ni quitar un
candidato." **Salida**: "reranking activo detrás de flag, con evaluación
antes/después sobre el ground truth existente [ajustar a 8.1, ver arriba],
desactivable sin tocar código, y con el resultado documentado aunque sea
negativo."

**Lo que ya se investigó y hay que tener en cuenta, con ubicaciones
exactas** (releer cada archivo antes de tocarlo — los números de línea
pueden haber cambiado):

1. **Punto de inserción en el pipeline RAG real**:
   `src/lib/rag/retrieval/search.ts`, función `buscarHibrido()`. El flujo
   real hoy es: ramas léxicas (FTS/trigram, con degradación ya arreglada en
   Fase 5.4) + rama vectorial opcional → `fusionarRankingsLocal(branches)`
   (RRF) → `finalVariantWhitelist()` (Postgres decide qué variantes son
   válidas) → construcción de `ResultadoRetrieval[]` → `.slice(0,
   FINAL_LIMIT)`. El reranking debe insertarse DESPUÉS de que la lista ya
   está validada por whitelist (nunca antes — el reranker no debe ver
   candidatos que Postgres no autorizó) y ANTES del `.slice(0,
   FINAL_LIMIT)` final, para poder cambiar cuáles quedan en el top-N
   mostrado sin cambiar el conjunto de candidatos elegibles. Localiza estas
   funciones de nuevo (`Grep` por `fusionarRankingsLocal`,
   `finalVariantWhitelist`, `FINAL_LIMIT`) porque el archivo pudo cambiar.
2. **Adaptador Next→Python — necesita generalizarse, es código de
   seguridad**: `src/lib/ia/python-adapter.ts` hoy está hardcodeado al
   endpoint `/internal/v1/echo` (`PYTHON_ECHO_PATH`, `PYTHON_ECHO_SCOPE`,
   y el schema de respuesta `responseSchema` asume la forma exacta de la
   respuesta de echo: `{schema_version, request_id, correlation_id,
   payload}`). Para 8.2 hace falta o (a) generalizar `llamarPythonEcho` en
   algo como `llamarPythonOperacion(path, scope, payload, ...)` reusable
   por echo y por rerank, preservando el comportamiento exacto de echo
   (firma HMAC, replay/nonce, idempotencia, deadline, mapeo de errores —
   todo ese código ya está bien probado, no reinventarlo, extraerlo con
   cuidado), o (b) duplicar la lógica en una función paralela
   `llamarPythonRerank` — MENOS deseable (duplica ~200 líneas de código de
   seguridad), pero MÁS seguro si el tiempo no alcanza para generalizar sin
   riesgo. Antes de tocar esto: correr `npm run
   contracts:test:python-adapter` (existe, `scripts/test-python-adapter.ts`)
   para ver la cobertura actual, y no romper ese test.
3. **Lado Python — mismo patrón, mismo problema de generalización**:
   `services/ai-api/app/main.py`, función `create_app()`. Hoy TODA la
   lógica de auth/idempotencia/deadline/nonce está inline dentro del
   closure de la ruta `POST /internal/v1/echo` (~150 líneas, líneas
   498-633 al momento de escribir esto). El `echo_handler` es pluggable
   (`Callable[[EchoRequest], Awaitable[dict]]`) pero el contrato
   HTTP/auth/idempotencia no lo es — está atado a esa única ruta. Para
   agregar `POST /internal/v1/rerank` sin duplicar esas 150 líneas, hay
   que extraer esa lógica en un helper reusable (p.ej. una función
   `_handle_operational_request(request, model, handler, scope)` que
   ambas rutas llamen). Antes de tocar: correr `uv run --extra test python
   -m pytest tests/test_main.py -v` para ver la cobertura actual del
   endpoint echo, y no reducirla.
4. **Registro de flags**: `src/lib/ia/feature-flags.ts` (consolidado en
   Fase 5.3 esta semana). Agregar el flag nuevo (p.ej.
   `RAG_RERANK_ENABLED`) ahí, con su default explícito Y su racional de
   negocio escrito en el comentario — no repitas el patrón que
   `docs/migracion-python/resiliencia/registro-flags.md` ya marcó como
   "Sin decisión escrita — default implícito, revisar" para 13 flags
   existentes. Esta vez, decide y escribe el default explícitamente (con
   toda seguridad el default correcto es `false`/apagado hasta que la
   evaluación antes/después confirme que ayuda — pero escríbelo, no lo
   dejes implícito).
5. **Dependencias Python nuevas**: `services/ai-api/pyproject.toml`. Añadir
   `sentence-transformers` (trae `torch` como dependencia transitiva,
   CPU-only si se fija bien — revisar que no arrastre CUDA por accidente,
   que infla el tamaño de la imagen sin necesidad ninguna en este servidor
   sin GPU). Correr `uv lock` después de editar `pyproject.toml` (el CI
   corre `uv lock --check`, va a fallar si el lockfile no está
   sincronizado).
6. **Docker**: `services/ai-api/Dockerfile`. Revisar cuánto crece la imagen
   final con la dependencia nueva (`docker images` local antes/después) y
   decidir si el modelo (~80MB) se descarga en build time (más
   reproducible, imagen más grande) o en runtime la primera vez que se usa
   (imagen más chica, pero el primer request paga la descarga y necesita
   salida a internet desde el EC2 en ese momento — verificar que el EC2 sí
   tiene esa salida antes de asumirlo).

**Diseño de la evaluación antes/después**: correr el fixture de 8.1 (o uno
extendido, ver nota arriba) con el flag apagado, guardar métricas; correr
con el flag encendido, comparar. Documentar el resultado tal cual sea,
incluyendo si es negativo — la Salida de la Fase 8 lo exige explícitamente.

### 8.3 — Embeddings en batch para reindexación del catálogo — NO INICIADO

**Entrega exacta**: "Offline, fuera del camino del request." **Límite
duro**: "No toca el retrieval en vivo." Menor riesgo que 8.2 (no toca el
camino de la request real, no necesita el adaptador HMAC generalizado). Si
8.2 se queda a medias por tiempo, esta es la candidata más fácil de cerrar
aparte, sin depender de 8.2.

No se investigó el detalle de esta entrega en la sesión anterior — hay que
partir de cero: revisar cómo se generan embeddings hoy
(`scripts/generate-embeddings.ts`, parte de `npm run rag:sync` →
`rag:embed`) para entender qué reemplazaría o complementaría un batch job
en Python, y si tiene sentido que viva en `services/ai-api` o en un script
aparte.

## Orden sugerido (a validar/ajustar al empezar)

1. Releer este prompt contra el código actual — confirmar que
   `python-adapter.ts`, `main.py` y `search.ts` siguen en el estado descrito
   arriba antes de diseñar nada (el patrón de esta semana: varios hallazgos
   de prompts anteriores ya habían cambiado).
2. Revisar disco del EC2 (`ssh n8n-maros "df -h /"`) — si está por encima
   de ~85%, `docker builder prune -f` antes de seguir (no depende de lo que
   hagas en 8.2, es higiene del servidor compartido).
3. Diseñar y confirmar con el usuario (con `AskUserQuestion` si hace falta)
   el enfoque de generalización del adaptador HMAC (opción (a) generalizar
   vs (b) duplicar, ver punto 2 de 8.2 arriba) antes de escribir código —
   es código de seguridad, no improvisar.
4. Construir el lado Python: extraer el helper reusable en `main.py`,
   agregar `/internal/v1/rerank`, el módulo de reranking real
   (`app/reranker.py` o similar) con el modelo aprobado, tests con `uv run
   pytest`.
5. Generalizar `python-adapter.ts` (o agregar el paralelo), sin romper
   `npm run contracts:test:python-adapter`.
6. Conectar el flag y el punto de inserción en `search.ts`.
7. Diseñar y correr la evaluación antes/después con el fixture de 8.1
   (extendido si hace falta).
8. Documentar el resultado (positivo o negativo) en
   `docs/migracion-python/rag/` y actualizar
   `docs/migracion-python/PLAN-MAESTRO-V2.md` con "Estado real al [fecha]"
   para 8.2, siguiendo el mismo patrón usado toda esta semana.
9. Antes de desplegar: revisar disco del EC2 de nuevo, pedir confirmación
   si hace falta más limpieza que toque imágenes de otros proyectos.
10. Si hay tiempo, 8.3 (embeddings batch), empezando de cero según la nota
    de arriba.

## Cómo comunicarte

En español con el usuario, en inglés en comentarios de código. Actualizar
`PLAN-MAESTRO-V2.md` al cerrar cada entrega con evidencia real, igual que
se hizo toda esta semana. Preguntar antes de: cambiar el modelo
cross-encoder aprobado, tocar imágenes Docker de otros proyectos en el EC2
compartido, o desplegar a producción si el disco sigue ajustado.

# Prompt de seguimiento · Plan A, fase A0 en modo loop autónomo

> Se ejecuta con `/loop` en Claude Code (ver `COMO-LANZAR` al final). En **cada iteración** relee este archivo completo y el archivo de estado antes de actuar. Versión del prompt: `fase-a-loop 1.0.0` (2026-09-15).

## Parámetros de la corrida (edítalos antes de lanzar)

| Parámetro | Valor | Uso |
|---|---|---|
| `DATA_ROOT` | `C:\Users\davidt\Downloads\estructuras-dataset` | Imágenes y manifiesto privado. **Fuera del repo.** |
| `RAMA` | `fase-a/a0-linea-base` | Rama de trabajo creada desde `2026-09-14` ya limpia (contiene los planes y los cambios del 2026-09-15) |
| `TOPE_GEMINI_USD` | `15` | Tope total de llamadas pagas a Gemini en esta corrida (medido hoy: ≈US$0,011 por análisis) |
| `TOPE_DESCARGAS` | `800` | Máximo de archivos descargados de Wikimedia Commons en esta corrida |
| `META_CANDIDATAS_POR_CLASE` | `60` | Parar de buscar una clase al llegar a este número de candidatas con licencia verificada |
| `DEV_SEED_V0` | `10–60` imágenes | Tamaño del set de iteración (Plan A §A0.4a) |
| `ESTADO` | `docs/planes/estructuras-2026-09/ejecucion/fase-a/ESTADO.md` | Memoria entre iteraciones |
| `REVISION` | `docs/planes/estructuras-2026-09/ejecucion/fase-a/REVISION-HUMANA.md` | Lo que necesita a una persona |

## GOAL

Dejar lista y medida la **línea base del reconocimiento actual** (Plan A, fase A0) sobre imágenes **externas** con licencia verificada, sin cambiar el comportamiento de producción:

1. Recolectar de forma autónoma imágenes de estructuras de globos desde **Wikimedia Commons** (única fuente descargable sin intervención humana), verificar la licencia archivo por archivo, sanearlas, deduplicarlas y agruparlas en carpetas por las 16 clases oficiales mediante **pre-clasificación asistida** (candidatas, no verdad terreno).
2. Construir `dev-seed-v0` (10–60 imágenes, estratificado por familia) con manifiesto y prueba de disjunción.
3. Implementar lo necesario de A0.1–A0.3 (telemetría, red de pruebas, runner con `--preview` y tope de gasto).
4. Correr la línea base v13 con N=5 sobre `dev-seed-v0` (A0.4a) dentro de `TOPE_GEMINI_USD` y publicar un memo con cifras medidas.
5. Terminar con todo lo que requiere una persona listado en `REVISION` y el loop detenido.

**Terminado =** tareas T0–T9 en `COMPLETADA` o `BLOQUEADA` con motivo, commits en `RAMA`, verificaciones ejecutadas y reportadas con su resultado real, memo A0.4a escrito y `REVISION` al día.

## Lectura obligatoria (primera iteración; después, solo lo que la tarea necesite)

1. `AGENTS.md` (reglas del repo; mandan sobre este prompt salvo en los límites duros de abajo, que son más estrictos).
2. `docs/planes/estructuras-2026-09/README.md` (decisiones DT-1…DT-7, puertas, pendientes).
3. `00-fundamentos-compartidos.md`: §2 decisiones, §4 taxonomía (en especial §4.3 orgánico = prueba de silueta S1, §4.4 árbol, §4.5 fichas, §4.7 tabla detección→oficial), §5 esquema de anotación, §7 programa de datos, §8 arnés de evaluación.
4. `01-plan-A-reconocimiento-y-propuesta.md`: §6 A0.1–A0.4a, §7 puertas G0, §12 primeros 10 días.
5. `04-guia-fuentes-externas.md`: §2 semáforo, §3 consultas por clase, §5 flujo (estados, manifiesto, pre-clasificación, dedup, splits, carpetas).

No re-investigues lo que esos documentos ya resolvieron. Si encuentras una contradicción real entre documento y código, regístrala en `ESTADO` y sigue con la interpretación más conservadora.

## Límites duros (no negociables)

**Fuentes e imágenes**
- Descarga automática **solo** desde Wikimedia Commons vía API oficial (`action=query&prop=imageinfo&iiprop=url|size|sha1|extmetadata`), con User-Agent descriptivo que incluya un contacto, peticiones en serie o concurrencia ≤2, parámetro `maxlag`, y reintentos con espera ante 429/503.
- Licencia verificada **por archivo** en `extmetadata` (`LicenseShortName`, `LicenseUrl`, `Artist`, `AttributionRequired`). Acepta solo CC0, dominio público (PDM/PD) y CC BY. **CC BY-SA** → registrar en `15_quarantine/by-sa-revision-legal/` sin usarla. Cualquier NC, ND, "fair use", sin licencia o dudosa → excluir.
- Openverse solo para descubrir; la licencia se re-verifica siempre en la página de Commons de origen (si el origen no es Commons, no se descarga).
- **Prohibido descargar** de Pinterest, Instagram, Facebook, TikTok, Google Imágenes, Unsplash, Pexels, Pixabay, Flickr, bancos de stock, Etsy, Amazon o webs de decoradores. Prohibido contactar personas o enviar mensajes. Puedes anotar *leads* (nombre comercial y URL pública) en `REVISION` para que una persona pida permiso.
- Descarta o pone en cuarentena: lado menor <1024 px (queda apta solo para evaluación y detector, marcada), marcas de agua, texto o logos prominentes, personajes con licencia, menores identificables, personas prominentes, collages, renders o imágenes generadas por IA. Nunca elimines marcas de agua ni edites el contenido.
- Saneado: aplica orientación EXIF, borra metadatos (registra antes si había GPS), convierte a sRGB JPEG. El original queda inmutable en `10_raw/`.
- Estructura de carpetas y manifiesto **exactamente** como la guía §5.2 y §5.8 bajo `DATA_ROOT`. Las carpetas por clase (`60_curated/`) se regeneran desde el manifiesto; nunca muevas archivos a mano.
- **Ninguna imagen entra al repo.** Al repo solo va la proyección del manifiesto **sin datos personales** en `datasets/estructuras/manifests/estructuras-ext/`. Verifica con `git status` antes de cada commit.

**Pre-clasificación**
- La IA propone **atributos**; la clase oficial la deriva el código con la tabla de Fundamentos §4.7. Abstenerse es válido (`no_determinable`).
- Usa **subagentes de Claude** (modelo `sonnet`) leyendo las imágenes de `20_sanitized/`, con el prompt de la guía §5.4 versionado (semver + sha256) en `DATA_ROOT/50_prelabel/`. **No uses Gemini** para pre-clasificar: es el sistema que se evalúa.
- Solo imágenes con `envio_proveedores_ia_permitido=true` (Commons CC0/PD/BY lo cumplen por licencia pública; regístralo con esa base).
- Estas etiquetas son **candidatas de curación**: no cuentan como verdad terreno, no sirven para medir exactitud y no se usan para entrenar el detector del Plan C.
- Marca por hash el 10 % ciego (`sha256 mod 10 == 0`) **antes** de pre-clasificar; esas imágenes van a `REVISION` sin predicción visible.

**Código, datos y producción**
- Trabaja solo en `RAMA`. Nunca hagas commit en `main` ni en `2026-09-14`, ni push sin que el usuario lo pida. No reescribas historia.
- No toques producción: sin `ssh`, sin despliegues, sin cambiar flags del servidor (el flag temporal `IMAGE_QA_NON_BLOCKING` se queda como está).
- **Neon es la base de producción.** Solo `SELECT` en transacción `READ ONLY`. Las migraciones (p. ej. la de A0.1) se escriben y se prueban con la base desechable de los tests; **no se aplican** a Neon: se anotan en `REVISION` como "pendiente de aplicar por una persona".
- Sin llamadas a fal.ai en esta fase.
- Toda llamada paga a Gemini pasa por el runner con `--preview` primero; si el costo estimado acumulado supera `TOPE_GEMINI_USD`, no la ejecutes y marca la tarea `BLOQUEADA`. Reporta costo estimado y costo reportado por separado.
- No imprimas ni guardes secretos (`.env.local`, llaves, URLs de base de datos).
- Respeta `AGENTS.md`: scripts import-safe con CLI separada, `--dry-run` por defecto en lo que escriba datos, idempotencia por sha256, validación en tiempo de ejecución, pruebas deterministas separadas de evaluaciones con proveedores.
- Si necesitas los servidores locales, verifica primero si ya corren (`http://127.0.0.1:8000/readyz`, `http://localhost:3010/login`). Si los arrancas tú, Python va con `uv run --system-certs --env-file ../../.env.local uvicorn app.main:app --host 127.0.0.1 --port 8000` desde `services/ai-api` (no uses `source` sobre `.env.local`).

## Backlog en orden

| Id | Tarea | Referencia | Hecho cuando |
|---|---|---|---|
| T0 | Preparación: si el árbol de trabajo tiene cambios sin commit, **no los descartes**: marca T0 `BLOQUEADA` y pide a la persona que los commitee. Si está limpio, crear `RAMA` desde `2026-09-14`; crear `ESTADO` y `REVISION` con las plantillas de abajo; comprobar `.gitignore` para `DATA_ROOT` y `datasets/`; inventario de lo que ya existe (runner, manifiestos, pruebas) para no duplicar | Plan A §12 día 1 | Rama creada, archivos de estado commiteados |
| T1 | A0.2: pruebas deterministas fuera de CI → integrarlas al script agregado; fixture de orientación EXIF; lista de cajas por defecto sospechosas | Plan A §A0.2 | Scripts en `package.json`, verdes o con deuda previa documentada |
| T2 | Si ya existe `tools/dataset-estructuras-ext/` y `DATA_ROOT` con imágenes revisadas (prompt `recolector-imagenes-loop.md`), **reutilízalos** y salta T2–T4 tomando solo las `aceptada`. Si no: herramienta de recolección Commons (import-safe, `--dry-run` por defecto, reanudable): búsqueda por categorías y consultas de la guía §3 para las 16 clases, verificación de licencia, descarga ≤`TOPE_DESCARGAS`, saneado, hashes (una sola implementación, `hash_impl` registrado), QC de flags, manifiesto privado y proyección sin datos personales, eventos `events.jsonl` | Guía §5.1–§5.3, §5.6, §5.8 | Pruebas deterministas del verificador de licencias, del saneado y del manifiesto; corrida `--dry-run` revisada |
| T3 | Corrida real de recolección hasta `META_CANDIDATAS_POR_CLASE` o `TOPE_DESCARGAS`; deduplicación (d ≤2 se une, 3–6 a revisión) también contra conjuntos internos | Guía §5.6 | Conteo por clase candidata y por licencia en `ESTADO` |
| T4 | Pre-clasificación con subagentes `sonnet` en lotes, colas de revisión (`negativo_probable`, `clase_clara`, `ambigua_o_abstencion`, `flags`), regeneración de `60_curated/<clase>/`; tabla de cobertura contra las metas por clase | Guía §5.4; Fundamentos §4.7, §7.7 | Carpetas regeneradas desde el manifiesto; brechas por clase en `REVISION` |
| T5 | `dev-seed-v0`: selección estratificada por familia (sorteo por titular y montaje de la guía §5.7), `particion=dev`, manifiesto en `datasets/estructuras/manifests/dev-seed-v0.jsonl`, prueba determinista de disjunción | Plan A §A0.4a; Fundamentos §7.3–§7.4 | Prueba en CI verde |
| T6 | A0.1: instrumentación (`finishReason`, telemetría por pase, migración escrita y probada en base desechable, no aplicada) | Plan A §A0.1 | Pruebas verdes; migración anotada en `REVISION` |
| T7 | A0.3: runner de reconocimiento con `--preview`, `--max-usd`, concurrencia y plazos acotados, salida `prediccion-estructuras.v1`, `run.json` | Plan A §A0.3; Fundamentos §8 | Pruebas con vectores sintéticos; `--preview` sobre `dev-seed-v0` con costo estimado |
| T8 | A0.4a: línea base v13 tal cual (parser, temperatura y pensamiento de producción) con N=5 sobre `dev-seed-v0`, dentro de `TOPE_GEMINI_USD`; p50/p95 por pase y de punta a punta, tasa malformada, `finishReason`, *flip rate*; sin métricas de exactitud (no hay verdad humana) | Plan A §A0.4a | `run.json` completo; costo reportado ±30 % del estimado |
| T9 | Memo A0.4a en `ejecucion/fase-a/memo-a0-4a.md`, actualizar Plan A con cifras medidas, cerrar `REVISION` (10 % ciego, cuarentenas BY-SA, flags, brechas por clase, leads, migraciones pendientes, decisiones DP/Q que bloquean A1) | Plan A §7 G0 | Todo commiteado; loop detenido |

Fuera de alcance de esta corrida: A0.4 (necesita `gold-eval-v1` con doble anotación humana), A0.5, A1 en adelante, cualquier cambio de comportamiento visible en producción.

## Protocolo de cada iteración

1. Relee este archivo y `ESTADO`. Si `ESTADO` dice `COMPLETADO` o todas las tareas restantes están `BLOQUEADA` por algo humano, resume y **detén el loop** (no programes otra iteración).
2. Toma la primera tarea `PENDIENTE` o `EN_CURSO` cuyas dependencias estén cumplidas. Trabaja un avance coherente (una tarea o una parte verificable de ella), no varias a medias.
3. Antes de gastar dinero o descargar en volumen, ejecuta la variante `--preview`/`--dry-run` y anota lo que haría.
4. Verifica según `AGENTS.md`: `npm run lint`, `npm run build --workspaces --if-present`, `npx tsc --noEmit` y los scripts de prueba afectados; `uv run pytest` si tocaste Python. Reporta resultados reales; nunca llames "verde" a algo que no corriste.
5. Commit en `RAMA` con mensaje convencional en español y el trailer de coautoría que indique tu entorno.
6. Actualiza `ESTADO`: tarea y estado, evidencia (comandos y resultado), conteos, gasto estimado vs reportado acumulado, siguiente paso, bloqueos. Agrega a `REVISION` lo que requiera una persona.
7. Ritmo: si queda trabajo inmediato, siguiente iteración en 60–120 s; si esperas algo externo (rate limit, proceso largo en segundo plano), 20–30 min; si todo lo restante espera a una persona, detén el loop.

Si una tarea falla dos iteraciones seguidas por la misma causa, márcala `BLOQUEADA` con diagnóstico y pasa a la siguiente que no dependa de ella.

## Plantillas

`ESTADO.md`:

```markdown
# Estado · fase A0 (loop)
Prompt: fase-a-loop 1.0.0 · Rama: fase-a/a0-linea-base · Actualizado: <ISO>
Estado global: EN_CURSO | COMPLETADO | BLOQUEADO

| Id | Estado | Evidencia / notas |
|---|---|---|
| T0 | PENDIENTE | |
...

## Conteos
Candidatas por clase (licencia verificada) · descargas usadas / TOPE · cuarentenas por motivo

## Gasto
Gemini estimado acumulado: US$ · reportado: US$ · tope: US$15

## Bitácora (más reciente arriba)
- <ISO> T? · qué se hizo · verificación · siguiente paso
```

`REVISION-HUMANA.md`: secciones `Muestra ciega (10 %)`, `Cuarentena BY-SA`, `Flags de riesgo`, `Brechas por clase frente a metas`, `Leads para pedir permiso`, `Migraciones sin aplicar`, `Decisiones que bloquean A1`.

---

## COMO-LANZAR

Resumen para la persona que lanza el loop (no es parte de las instrucciones del agente):

1. En la rama `2026-09-14`, haz commit de los cambios pendientes (escaneo de 5 s, flag temporal de QA, `.env.local.example` y la carpeta `docs/planes/estructuras-2026-09/`) para que el árbol quede limpio. Crea la carpeta `DATA_ROOT` y edita los parámetros de arriba si quieres otros topes.
2. Abre una terminal nueva en la raíz del repo y arranca Claude Code con `claude --model claude-opus-5`.
3. Dentro de la sesión: `/effort xhigh` (no uses `ultracode`: lanza orquestaciones con muchos agentes y multiplica el gasto de tokens).
4. Permisos: aprueba en `/permissions` las herramientas que va a repetir (`npm`, `npx`, `node`, `git`, `uv`, `curl`) o arranca con `--permission-mode acceptEdits`. No uses `--dangerously-skip-permissions`: este equipo tiene acceso SSH al servidor de producción.
5. Lanza el loop auto-regulado (sin intervalo):
   `/loop Ejecuta una iteración del protocolo de docs/planes/estructuras-2026-09/prompts/fase-a-loop.md. Relee ese archivo y el ESTADO antes de actuar.`
6. Sigue el avance en `docs/planes/estructuras-2026-09/ejecucion/fase-a/ESTADO.md`. Para detenerlo: Esc/Ctrl+C o escribe "detén el loop".

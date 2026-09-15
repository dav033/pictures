# Estado · fase A0 (loop)
Prompt: fase-a-loop 1.0.0 · Rama: fase-a/a0-linea-base · Actualizado: 2026-09-15
Estado global: EN_CURSO

| Id | Estado | Evidencia / notas |
|---|---|---|
| T0 | COMPLETADA | Árbol limpio en `2026-09-14` (HEAD `8590d90`); rama creada; `.gitignore` e inventario revisados (abajo) |
| T1 | COMPLETADA | Parte 3: lista explícita de cajas por defecto (`ejemplo-10/REF_01_E03`, retiro "A7 fusionado") y vectores `box_2d` (fuera de rango, invertidos, área mínima, inválida→caja por defecto F10) en `ia:test-analisis-ejemplos`; `plan:test` exit 0 (182). A0.2 tarea 5 (laboratorio F18) queda en `REVISION` por requerir confirmación de uso. Parte 1: las 8 pruebas de A0.2 pasan en la base (exit 0 cada una, sin `process.env`/`fetch`) y se agregaron a `plan:test`; `npm run plan:test` exit 0 (178 casos). Parte 2 hecha: fixture `eval/fixtures/exif/orientacion-6.jpg` + 2 casos en `ia:test-referencias-ruta` (caracterización: el servidor no normaliza; la UI sí). Falta: lista explícita de cajas por defecto |
| T2 | OMITIDA | Protocolo (sección "Convivencia con el loop recolector", cambio local del usuario detectado 2026-09-15): la hace el loop recolector en `demo-decoracion-recolector` / `datos/recolector-estructuras`; la fase A no escribe en `DATA_ROOT` |
| T3 | OMITIDA | Ídem (recolector) |
| T4 | OMITIDA | Ídem (recolector) |
| T5 | BLOQUEADA | Esperando imágenes aceptadas del recolector: `DATA_ROOT\manifests\snapshots\aceptadas-latest.json` no existe (verificado 2026-09-15) |
| T6 | EN_CURSO | Parte 1 hecha: `TurnoChat.finishReason`/`blockReason` opcionales en `agente-core` (`extraerCierreGemini`, `turno` y `turnoStream`); prueba en `gemini-chat.test.ts`; `agente-core:test-gemini-chat` y `-errores` (antes fuera de CI) agregadas a `plan:test`. Parte 2 hecha: `ChatPort.thinkingLevel` efectivo, `EventoLlamadaIA.finishReason`/`configHash`, `analysisConfigHash` (sin tocar la clave de caché, eso es A1.3) y registro por pase; `ia:test-telemetria-referencias` (5 casos, puerto simulado, ausencia de contenido sensible) en `plan:test`. **El `INSERT` durable aún no escribe las columnas nuevas** (van con la migración). Falta: migración `024` con rollback probada en base desechable, filas de `ai_model_pricing`, auditoría `PLAN_NO_CONVERGE`, consulta de volumen, prueba de ausencia de contenido sensible |
| T7 | PENDIENTE | |
| T8 | PENDIENTE | Depende de T5, T6, T7 |
| T9 | PENDIENTE | Depende de T8 |

## Inventario inicial (T0, 2026-09-15)

- **CI** (`.github/workflows/checks.yml`): build de workspaces, `contracts:check`, lint, build, `tsc --noEmit`; job con base (`rag:migrate`, `contracts:test*`, `plan:test`, `chat:test-historial`, `happie:test-webhook`, `test-idempotency-store`); job Python (`uv lock --check`, ruff, mypy, `generate_models --check`, pytest).
- **`plan:test`** agrupa 25 scripts. No incluye: `ia:test-referencias-reglas`, `-perceptual`, `-fixture`, `-ruta`, `ui:test-recorte-referencia`, `ui:test-armazon`, `ia:test-generate-qa-plan`, `ia:test-qa-esperados` (entrada de T1).
- **Runner de reconocimiento:** no existe (`scripts/eval/`, `src/lib/eval/`, `tools/` ausentes). `eval/` tiene `chat, expected, fixtures, ia, prompts, rag, results, ui`; sin `eval/estructuras/` ni `eval/fixtures/exif/`.
- **Manifiestos de estructuras:** `datasets/` no existe. `.gitignore` no lo ignora (correcto: la proyección sin datos personales debe versionarse). `DATA_ROOT` está fuera del repo, no requiere regla; aún no existe la carpeta (la crea T2).
- **Telemetría:** `finishReason` no aparece en `packages/agente-core/src` ni en `src/lib/ia` (entrada de T6). Última migración `scripts/migrations/023_embedding_provenance.sql`; `024` libre.
- **Herramientas de imagen previas:** scripts Python con Pillow en `scripts/*.py` (datasets Sempertex); `services/ai-api` usa `uv` con `httpx==0.28.1`. Python 3.14.5 y uv 0.12.6 en la máquina.
- **Cambios locales de `scripts/test-armazon-ui.ts`** que menciona Plan A §A0.2: ya no hay cambios sin commit.

## Contradicciones registradas

- Plan A §A0.2 pide que "la prueba EXIF pase o exista un PR con normalización", pero normalizar en `analisis-http.ts` cambia producción (fuera de esta corrida). Verificado: `src/app/page.tsx` (`redimensionarImagen`) y `src/app/laboratorio-referencias/page.tsx` enderezan en el navegador (`createImageBitmap` con `imageOrientation: "from-image"` + recodificación en canvas); el servidor reenvía los bytes intactos. Se dejó una prueba de caracterización con condición de retiro y la decisión en `REVISION`. No se sabe si Gemini aplica la orientación EXIF (comprobarlo cuesta una llamada paga; no se hizo).

- Guía §5.3 ubica los scripts de adquisición en `tools/dataset-estructuras-ext/` [P] (Python con dependencias bloqueadas) y Plan A §A0.3 ubica métricas en `tools/eval-estructuras/`; ninguna existe. Interpretación conservadora: crear `tools/dataset-estructuras-ext/` como proyecto `uv` propio con `uv.lock`, sin mezclar dependencias con `services/ai-api`.

## Conteos
Candidatas por clase (licencia verificada): 0 · descargas usadas: 0 / 800 · cuarentenas: 0

## Gasto
Gemini estimado acumulado: US$0 · reportado: US$0 · tope: US$15

## Bitácora (más reciente arriba)
- 2026-09-15 T6 (parte 2) · telemetría por pase del análisis de referencias (`finish_reason`, `thinking_level` efectivo, `prompt_version`, `config_hash`) en el evento, sin cambiar SQL: `deploy.yml` no corre migraciones y un `INSERT` con columnas inexistentes perdería toda la telemetría en silencio · verificación: `npm run lint` exit 0 (30 warnings = base), `npm run build --workspaces --if-present` exit 0, `npx tsc --noEmit` exit 0, `npm run plan:test` exit 0, `ia:test-referencias-reglas` y `contracts:test:cancel` exit 0 · siguiente: migración `024` (con rollback) + `INSERT` de `finish_reason`/`config_hash`, probada en base desechable.
- 2026-09-15 T6 (parte 1) · `finishReason`/`blockReason` en el puerto Gemini (campo opcional, sin cambio de comportamiento) · verificación: `npm run lint` exit 0 (0 errores, 30 warnings idénticos a la base), `npm run build --workspaces --if-present` exit 0, `npx tsc --noEmit` exit 0, `npm run plan:test` exit 0 (incluye las 2 pruebas de agente-core: 4 + 4 casos) · siguiente: telemetría por pase en el análisis de referencias.
- 2026-09-15 Protocolo actualizado por el usuario (sin commit en `prompts/fase-a-loop.md`; no lo commitea este loop): T2–T4 pasan al recolector, T5 bloqueada hasta que exista la instantánea `aceptadas-latest.json`; `show-toplevel` y rama verificados · siguiente: T6 (A0.1 instrumentación).
- 2026-09-15 T1 (parte 3, cierre) · 1 caja por defecto en el análisis fijo (73 cajas revisadas), lista de excepciones exacta; 6 vectores `box_2d` vía `analizarReferenciasV2` con puerto simulado · verificación: `npm run ia:test-analisis-ejemplos` exit 0 (7 casos), `npx eslint` del archivo exit 0, `npx tsc --noEmit` exit 0, `npm run plan:test` exit 0 (182 casos) · siguiente: T2 (herramienta de recolección Commons, `--dry-run` por defecto).
- 2026-09-15 T1 (parte 2) · fixture EXIF orientación 6 (sintético, 1,2 KB) con README; 2 casos en `scripts/test-reference-analyze-route.ts` · verificación: `npm run ia:test-referencias-ruta` exit 0 (12 casos), `npx eslint` del archivo exit 0, `npx tsc --noEmit` exit 0; no se corrió `npm run lint` completo ni build (sin cambios de app ni paquetes) · siguiente: lista explícita de excepciones de cajas por defecto (E03 del análisis fijo) con condición de retiro "A7 fusionado"; con eso T1 queda completa.
- 2026-09-15 T1 (parte 1) · 8 pruebas fuera de CI corridas en la base: todas exit 0; agregadas al final de `plan:test` · verificación: `npm run plan:test` exit 0; solo cambia `package.json` (sin TS nuevo, no se corrió lint/tsc/build) · siguiente: fixture EXIF orientación 6 en `eval/fixtures/exif/` contra `/api/references/analyze` con puerto simulado, luego lista de excepciones de cajas por defecto.
- 2026-09-15 T0 · rama `fase-a/a0-linea-base` creada desde `2026-09-14` limpio; ESTADO y REVISION creados; inventario · verificación: `git status` limpio antes de crear la rama; solo documentación (sin checks de aplicación, según `AGENTS.md`) · siguiente: T1 (correr en la base las 8 pruebas fuera de CI).

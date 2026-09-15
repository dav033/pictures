# Estado · fase A0 (loop)
Prompt: fase-a-loop 1.0.0 · Rama: fase-a/a0-linea-base · Actualizado: 2026-09-15
Estado global: EN_CURSO

| Id | Estado | Evidencia / notas |
|---|---|---|
| T0 | COMPLETADA | Árbol limpio en `2026-09-14` (HEAD `8590d90`); rama creada; `.gitignore` e inventario revisados (abajo) |
| T1 | PENDIENTE | Las 8 pruebas de A0.2 están **fuera** de `plan:test` (verificado); fixture EXIF inexistente |
| T2 | PENDIENTE | |
| T3 | PENDIENTE | Depende de T2 |
| T4 | PENDIENTE | Depende de T3 |
| T5 | PENDIENTE | Depende de T4 |
| T6 | PENDIENTE | |
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

- Guía §5.3 ubica los scripts de adquisición en `tools/dataset-estructuras-ext/` [P] (Python con dependencias bloqueadas) y Plan A §A0.3 ubica métricas en `tools/eval-estructuras/`; ninguna existe. Interpretación conservadora: crear `tools/dataset-estructuras-ext/` como proyecto `uv` propio con `uv.lock`, sin mezclar dependencias con `services/ai-api`.

## Conteos
Candidatas por clase (licencia verificada): 0 · descargas usadas: 0 / 800 · cuarentenas: 0

## Gasto
Gemini estimado acumulado: US$0 · reportado: US$0 · tope: US$15

## Bitácora (más reciente arriba)
- 2026-09-15 T0 · rama `fase-a/a0-linea-base` creada desde `2026-09-14` limpio; ESTADO y REVISION creados; inventario · verificación: `git status` limpio antes de crear la rama; solo documentación (sin checks de aplicación, según `AGENTS.md`) · siguiente: T1 (correr en la base las 8 pruebas fuera de CI).

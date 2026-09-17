# Informes

Snapshot of the evaluation output for the image- and colour-fidelity work,
committed 2026-09-17.

**Note on repository policy.** The root `AGENTS.md` says "No images, no absolute
paths and no customer data enter the repository. Evaluation inputs live outside
it." The user explicitly waived that rule for this folder on 2026-09-17 so the
benchmark evidence travels with the code. It is a deliberate exemption, not an
oversight — do not "clean it up" on the assumption that it was a mistake, and do
not treat it as precedent for committing images elsewhere. Everything here is
sample references and model output; there is no customer data.

## What is here

| Path | What it is |
|---|---|
| `bench/informe.html` | the rendered comparison across all runs — open this first |
| `bench/fase-*/resultado.json` | the measurements themselves: palette, measured share, caption, preflight, QA verdict, placement, spend, and (from phase 4 on) the flags the run had enabled |
| `bench/fase-*/*.png` | stage-1 LoRA output and the final composite, per case, full resolution |
| `bench/fase-*/mini/` | the JPEG thumbnails the HTML report actually references |
| `bench/img/` | reference and space photos used by the report |
| `diagnostico/` | output of the one-off diagnostic scripts (`scripts/diag-*.ts`) |
| `artifacts/fidelidad-imagen-y-color.html` | source of the published artifact |

The published artifact is at
<https://claude.ai/artifact/9Q4PvPDKfWK2imhpWtnqh5> and is the readable version
of the same data.

## The runs

Four reference photos chosen with a fixed seed (`20260917`) and one space photo
(`decoracion-jardin-moderno.jpg`), identical across every run, so the only
variable is the code. Per-image seeds are fixed too (101/202/303/404). Each run
is 4 analyses, 4 fal calls, 4 Gemini compositions and 4 QA passes, US$0.168.

| run | what it measures | QA |
|---|---|---|
| `fase-0-linea-base` | before any change | 0/4 |
| `fase-1` | the fail-closed defects fixed | 2/4 |
| `fase-2` | colour measured over pixels | 2/4 |
| `fase-3` | caption budget + venue placement | 2/4 |
| `fase-4` | all four new flags on | 0/4 |
| `fase-4b` | isolation: same as 4 without `REFERENCIA_EN_ETAPA1_V1` | 1/4 |

Phases 0 to 3 did **not** record which feature flags were enabled, so a
difference between two of them cannot be attributed to the code with certainty.
That gap is why `meta.banderas` exists from phase 4 on, and why the report has a
"Flags on" column that reads `not recorded` for the older runs. What can be
reconstructed: measured dominance was on in 2 and 3 (the runs carry
`participaciones`), and venue placement was on in 2 and 3 (`colocacion.usada`
is 4/4).

Read `bench/informe.html`'s own note before drawing conclusions from the QA
column: it is 4 images per run judged by a vision model, so the trend is
suggestive and not established.

## Regenerating

`reports/` is the working directory the harness writes to and is git-ignored;
this folder is the committed snapshot. To refresh the report from existing runs
without spending anything:

```bash
npx tsx scripts/bench-informe.ts
```

To add a run (paid, declares its own cap):

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/bench-fidelidad.ts \
  --fase fase-5 --espacio "<path to a space photo outside the repo>" \
  --confirm-spend --max-usd 1.00
```

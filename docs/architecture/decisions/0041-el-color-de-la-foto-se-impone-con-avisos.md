# ADR-0041 — The photo's colour is enforced, and every change is told

Date: 2026-10-05
Status: accepted (owner decision, 2026-10-05)
Supersedes ADR-0037 ("the photo's colour is reported, never enforced"). Keeps ADR-0024 (what the photo's colour
may decide), ADR-0034's decision on the finish, and ADR-0024 Decision 3 for proportion (compared and reported,
never enforced).

## Problem

Three owners disagreed about the same rule:

- ADR-0037 (2026-09-30, accepted) removed the refusal `COLORES_REFERENCIA_OMITIDOS` and the pruning of colours
  the photo does not have: the photo's colour would be reported, never enforced.
- The revert `ee5db0f` (2026-10-02) undid commit `994175d`, which had carried that uncommitted colour work with
  it. The refusal and the pruning came back; the ADR was not touched, so the code and the accepted decision said
  opposite things for three days.
- The 2026-10-04 work (`6fc3e95`, "color Sempertex medido") went further the other way: at confirmation the
  server swaps a balloon for the Sempertex reference measured in the photo (`aplicarReferenciasMedidas`), a
  colour change the customer was never told about.

On top of that, the rule that decided which colours a piece has let the background in: any neutral measured in
the pixels of a piece's box entered first, even if the analyzer never named it. On the gallery photos a white
wall turned a pink and gold garland into beige, cream and white, and a dark backdrop put black first on a
burgundy and silver frame; the swap then bought the backdrop's colour.

## Decision

The owner chose to **enforce** the photo's colour, **with a notice for every change**:

1. **The analyzer's labels decide which colours a piece has; the pixel measurement only orders and weighs
   them.** A measured colour no label names never takes a slot, neutrals included (`coloresNombradosOrdenados`,
   `colores-referencia.ts`). The same rule filters the Sempertex references (`referenciasCompatibles`).
2. **The refusal stays.** `confirmar_plan_decoracion` still refuses a plan that drops a dominant photo colour
   the catalog can build (`COLORES_REFERENCIA_OMITIDOS`), and still prunes colours the photo does not have.
3. **The measured-reference swap stays, and is told.** When `aplicarReferenciasMedidas` changes a balloon's
   colour (not only its family), it records a `color_referencia` adjustment and the customer gets a notice
   ("En X los globos de color fucsia van en rosado (Satín Rosado), que es el color que tiene tu foto"); the
   model is told the card does not show it, so it must.
4. **A colour the catalog does not sell is substituted and told**, in the labels path and in the measured path
   alike (`gris` → `plateado`, "se usó plateado").
5. **A single-colour reading (`color_unico`) needs the confidence of any other photo reading (0.5)**, and a
   single colour with sprinkled accents of another colour is not single-colour.
6. **The photo's pattern hint matches materials within the catalog's substitution radius** (ΔE 45, read from
   the `catalog-search.v1` contract) and only mutually; an unmatched accent drops alone with a notice.
7. **The notice for a photo colour no piece buys lands on the piece whose element shows it**, not on the first
   piece.

## Consequences

- Fidelity to the photo is decided by the server, not left to the model; the cost ADR-0037 avoided (a refusal
  is one more model round trip) is accepted.
- Every server-side colour change is visible to the customer, either signed in the plan (`sustituciones`) or
  through the model's summary (`avisos_cliente`).
- A colour only the pixels see (one the analyzer missed) no longer enters the plan; it is the price of not
  buying walls and backdrops.
- Still open, for a person: whether colours of furniture and lighting (not of a balloon piece) should keep
  producing "the photo shows X and this piece does not have it" on the first piece (decision of 2026-09-15 with
  the gallery photo 07), against the scenery rule in `AGENTS.md`; and whether light/baby blue needs its own
  catalog colour (the catalog sells one blue, `#1f4fbf`).

## Rollback

Revert the commits of 2026-10-05 on `fix/color-organico-conteo` that implement items 1–7 (`516ad18`, `4307c1f`,
`a032010`); nothing persisted changes shape, so plans signed in between stay valid.

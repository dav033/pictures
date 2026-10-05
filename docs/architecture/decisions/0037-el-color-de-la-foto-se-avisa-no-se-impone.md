# ADR-0037 — The photo's colour is reported, never enforced

Date: 2026-09-30
Status: superseded by ADR-0041 (2026-10-05: the photo's colour is enforced, and every change is told). Its code
was undone by the revert `ee5db0f` on 2026-10-02, which reverted `994175d` and with it this decision's
uncommitted changes; this record was left saying the opposite of the code until ADR-0041.
Supersedes ADR-0034 (Decision 1: a colour the photo does not have never reaches
the quote). Extends ADR-0024 Decision 3 — "proportion is compared and reported,
never enforced" — to the colour itself. ADR-0034's Decision on the FINISH
(`acabadosObservadosDeMateriales` / `aplicarAcabadoReferencia`) stays.

## Problem

Two mechanisms made the reference photo's palette binding on the plan:

- `COLORES_REFERENCIA_OMITIDOS`: `confirmar_plan_decoracion` refused a plan
  whose structures dropped a dominant photo colour the catalog could build, and
  asked the model to rebuild them. A refusal costs a whole extra model round
  trip per turn, plus a read-only catalog lookup, and it was the only refusal in
  this area that the server could have simply reported instead.
- `materialesDeColorInventado` + `quitarMaterialesDeColorInventado`: a material
  whose colour the photo does not have was pruned from the plan before quoting,
  with a customer notice.

The first is the expensive one. The second is free at runtime, but it is an
audit: it decides, after the model, that a colour the model chose is wrong, and
it did so from a palette it cannot always read — a label the taxonomy does not
alias ("copper", "taupe"), and equally `confetti` or `multicolor`, made it skip
the structure entirely, so the guard was off precisely in the photos where
confetti balloons appear.

The product decision (2026-09-30) is not to depend on audits here.

## Decision

The photo's colour is a **signal the customer is told about**, in both
directions, and never a gate:

1. A photo colour the plan does not buy is reported as a substitution
   (`sustitucionesColorReferencia` here and `_reference_color_substitutions` in
   `plan.py`, unchanged) and shown in the proposal card. It no longer refuses a
   plan, and confirming no longer looks those colours up in the catalog.
2. A colour the plan buys that the photo does not have stays in the plan. It is
   quoted, drawn and charged like any other material the model chose.

The prompt still tells the model to follow each element's observed colours, and
`buscar_catalogo_rag` still answers with `colores_en_catalogo` so it can find
them. Nothing after the model's answer enforces either direction.

## Consequences

- One less refusal per turn in the reference flow: the turn that used to spend a
  round trip rebuilding a plan now signs it and tells the customer what changed.
- A "Reflex Fucsia" the photo never had is quoted again (the 2026-09-29 defect
  ADR-0034 was written for). Fidelity to the photo's palette now rests entirely
  on the prompt and on what the search returns.
- The downstream chain ADR-0034 mentions is back in scope: a colour the plan
  buys that the photo lacks can leave the photo's pattern hint without a
  material and drop the piece to its preset.
- Pure boundary policy: no contract, no `plan_hash`, no golden vector.

## Rollback

Revert this commit: it restores both mechanisms, their tests and their prompt
text. Nothing persisted changes shape, so plans signed in between stay valid.

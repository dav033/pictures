# ADR-0034 — A colour the photo does not have never reaches the quote

Date: 2026-09-29
Status: accepted
Complements ADR-0024 (what the reference photo's colour is allowed to decide).
Does not supersede it: Decision 2 there — the photo's palette is not a hard
search filter — still holds. This is about the plan, not the search.

## Problem

The colour audit only ever looked one way: at the photo's colours the plan does
**not** buy. That direction has `sustitucionesColorReferencia` (the notice),
`coloresReferenciaOmitidos` and the `COLORES_REFERENCIA_OMITIDOS` refusal (the
repair). The opposite direction — a colour the plan buys and the photo does not
have — had nothing but a sentence in the system prompt.

On 2026-09-29 a "Mr & Mrs" balloon wall was read correctly (pearl blush pink,
chrome gold, matte white → `rosado`, `dorado`, `blanco`) and the plan bought
`Reflex Dorado Rosa` 50 %, `Reflex Dorado` 20 %, `Fashion Blanco` 15 % **and
`Reflex Fucsia` 15 %**. The fuchsia is in no part of that photo. The model was
told not to do it and did it.

A quote that charges for a colour the customer's photo does not contain is the
same class of failure as one that silently drops a colour the photo does
contain. Only the second was covered.

## Decision

### 1. The material is removed at the boundary, not refused back to the model

`materialesDeColorInventado` (colores-referencia.ts) finds the materials whose
colour the referenced photo element does not have;
`quitarMaterialesDeColorInventado` (cobertura-materiales.ts) takes them out of
the plan before it is validated and resolved, rescaling `participacion` to 1 and
moving `rol_material: "principal"` if the removed material held it — the same
removal, and the same `material_quitado` notice channel, that a material without
size coverage already went through.

Bounding it beforehand was preferred over auditing it afterwards, deliberately:
the invented colour never reaches the quote, the image prompt or the customer's
card, and the turn spends neither a refusal nor another model call. A refusal
would have added latency to every plan to fix a mistake the server can fix
itself, and the turn's refusal budget (`RECHAZOS_PARA_CONVERGER`) exists because
that budget is scarce.

This is boundary policy, not a commercial rule: it decides which materials enter
the plan, and Python still owns every quantity derived from them (AGENTS.md).

### 2. Invention and substitution are told apart by ΔE, not by a synonym table

The same chromatic model ADR-0024 uses to resolve `gris` as `plateado` at ΔE 16
decides this: `colorCatalogoMasCercano(colour, observedColours)` returns
`undefined` above `DELTA_E_MAXIMO` (45). Measured against the "Mr & Mrs" photo,
`dorado rosa` is 23 from the observed `rosado` — a substitution, and one
`sustitucionesColorReferencia` already reports to the customer — while `fucsia`
is 48 from `rosado`, 88 from `blanco` and 97 from `dorado`.

Rejected: a list of acceptable stand-ins per catalog colour. It is a second
owner of a question the ΔE table already answers, and it drifts.

### 3. What is deliberately not judged

- Structures without `referencia_element_id`: there is no photo to measure against.
- An element whose palette could not be read whole — a label the taxonomy leaves
  unaliased on purpose (`copper`, `taupe`) — because a colour of the photo we
  cannot see cannot prove a material wrong.
- `transparente` (a finish) and `multicolor` (not a hue), and any colour the ΔE
  table does not know: without a distance there is no accusation.
- Everything, when the customer asked for colours: the photo is then no longer
  the only authority. Same rule the opposite direction already used.
- A structure whose materials would **all** be removed: pruning it would delete
  the piece. That case stays with `COLORES_REFERENCIA_OMITIDOS`, which asks the
  model to rebuild it with the photo's colours.

The observed list is **not** capped at `MAX_COLORES_REFERENCIA`. Those three are
what a piece must carry; this is what the photo has, and capping it would accuse
the fourth colour of a photo that does have it.

## Consequences

- Plans lose a material the customer never asked for and the photo never had.
  The customer is told in the proposal card ("no incluí globos fucsia porque tu
  foto no los tiene: la armé con …") so the assistant cannot promise a colour the
  quote does not buy, and the removal is recorded in `plan_audit_log` as
  `PLAN_COLOR_SIN_REFERENCIA`.
- A piece can come out with fewer colours than the model designed. That is the
  intended trade: by the repo's own threshold, a stand-in beyond ΔE 45 is not a
  defensible substitution. The second E2E (D5) changed expectation for exactly
  this reason — the `violeta` the model put on a burgundy/white/silver arch is
  71.6 from `burdeos`, so it is removed and reported, while a `rojo` at 40.9
  would have stayed.
- Fidelity of the colour pattern improves as a side effect: with the invented
  material gone, `material_de_color` (patron_color.py) has fewer wrong candidates
  to resolve a photo hint against.

## Rollback

Additive and local: one pure function per module plus one call site in
`confirmar_plan_decoracion`. No contract, no `plan_hash`, no golden vector and no
migration is touched, so reverting the commit is the whole rollback.

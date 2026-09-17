# ADR-0024 — What the reference photo's colour is allowed to decide

Date: 2026-09-17
Status: accepted
Supersedes: nothing. Complements ADR-0023 (Python owns the plan's numbers).

## Problem

Phase 2 of `PLAN-IMAGE-AND-COLOR-FIDELITY.md` found that the colour path had no
owner for three questions, and answered all three by accident:

1. **What is grey?** `gris` is in the analyser's output, in the neutral family and
   in the LoRA's vocabulary, but not in the catalog palette. It disappeared, or —
   under the old hue-angle distance — silently became `negro`, so a matte grey
   photo bought black balloons.
2. **What may the photo's palette constrain?** It was ranking context only. The
   comment at `registro-herramientas.ts` was explicit about it, but the reason
   given ("it is not measured") had stopped being true.
3. **What if the plan's proportions contradict the photo's?** Nothing compared
   them. A plan could declare 70 % gold over a photo that is 70 % red and no part
   of the system noticed.

These are product decisions. They are recorded here because the code now behaves
one specific way and the next person needs to know it was chosen, not defaulted.

## Decisions

### 1. Grey is sold as `plateado`, deliberately and out loud

The catalog does stock it: grey balloons are filed under `plateado` in the derived
colours (`colores-producto.ts`, noted at `globos-por-color.ts:116`). So the option
"declare it unavailable" would refuse a sale the catalog can make.

`gris` therefore stays **outside** `PALETA_COLORES_V2` (nothing is sold under that
label) and **inside** `HEX_COLORES_OBSERVABLES`, so the ΔE model can measure it and
resolve it. `colorCatalogoMasCercano("gris", …)` returns `plateado` at ΔE 16 against
`negro`'s 51 — a factor of three, not a tie broken alphabetically.

The half that makes this a decision rather than a substitution is the telling:
`gris` survives into `coloresFotoCliente` (the palette shown to the customer) and
into `colores_referencia`, so `sustitucionesColorReferencia` emits *"La foto de
referencia muestra gris y esta pieza no lo lleva: se armó con plateado."*

Rejected: filtering `gris` out early. It makes a colour the photo had
indistinguishable from a colour it never had.

### 2. The photo's palette is a recorded signal, never a hard filter

With Phase 2.1 the palette is measured, so the strongest option — a hard catalog
filter with a relaxation rung — became defensible for the first time. It is still
rejected, for a reason that is in the code and not in taste: the relaxation ladder
would drop the occasion *and* return nothing whenever the catalog does not sell
that tone. `coloresFotoParaBusqueda` already excludes non-catalog colours precisely
to stop that, and re-adding the failure mode one layer up would undo it.

What was actually missing was not the constraint but the record. A photo colour that
no candidate offers is now recorded on every search
(`estado.ragColoresFotoSinCubrir`), unconditionally — before, it was only visible in
the rare case where the ladder reached the colour rung, which is not the common case.
The common case is a search that returns plenty of results, none of them in the
photo's colour, leaving no trace anywhere.

Promotion to a soft boost with a scored penalty, or to a filter, is a later decision
and now has the data it needs. It should not be taken without that data.

### 3. Proportion is compared and reported, never enforced

`desviacionesProporcion` contrasts the measured share of the reference against the
plan's declared `participacion` and reports any colour off by ≥ 0.2. It changes no
number. The plan is what is built and charged (`AGENTS.md`); a decorator inverting
the photo's proportions is a legitimate design call. Nobody being told is not.

The 0.2 floor is where rounding a balloon count to whole packs stops explaining the
difference. The measured share is renormalised over the classified pixels before
comparing, because the photo's measurement spreads over every pixel in the box —
wood, shadow — while `participacion` spreads over the balloons alone. Comparing them
raw would flag every plan that exists.

## Consequences

- A grey photo now buys silver and says so. Before it bought black and said nothing.
- `ragColoresFotoSinCubrir` is new telemetry with no behaviour attached. That is
  deliberate: it is the input to the next decision, not the decision.
- Proportion warnings will appear on plans that were previously silent. If the
  volume is high, the finding is about the analyser or about `participacion`, not
  about the threshold — resist raising it before looking.

## Rollback

All three are additive and local. Decision 1 is the ΔE table already shipped in
Phase 2.4 plus reporting; Decision 2 adds a recorded field; Decision 3 adds a pure
module nothing depends on. Reverting any one does not touch a contract, a migration
or `plan_hash`.

# ADR-0035 — The confetti pattern says to the generator what the card promises

Date: 2026-09-29
Status: accepted
Amends ADR-0028, section 8: the `aleatorio` row of the phrase table, which left
`prompt_gemini` and `prompt_lora` deliberately empty. Everything else in
ADR-0028 holds — Python is still the only author of a pattern's wording
(decision 2), TypeScript still inserts it verbatim, and `patrones_color` still
lives outside `plan_hash`.

## Problem

ADR-0028 section 8 froze the confetti row as *"(vacío: la frase orgánica de
hoy)"*. The reasoning was conservative and reasonable at the time: a confetti
pattern is the distribution the image prompt already produced, so saying nothing
kept every existing prompt byte-for-byte identical.

It was wrong about what "saying nothing" means. The image prompt is not silent
when a pattern has no phrase — it falls back to `ORGANIC_COLOR_DISTRIBUTION`
(`build-image-prompt.ts`):

> Distribute them through intentional organic clusters and transitions; avoid
> flat stripes, random speckles, or one color replacing another.

That sentence asks for **clusters of one colour** and forbids **speckles**. It is
the exact opposite of a confetti scatter. So the confetti pattern was not
leaving the decision to the generator; it was handing the generator an
instruction to do the other thing.

Measured on 2026-09-29 with a real "Mr & Mrs" balloon wall (uniform pearl blush
pink, chrome gold clustered in four zones, a few white flowers). The plan came
out correct: organic wall, three colours — `rosado` 75 %, `dorado` 20 %,
`blanco` 5 % — pattern "Confeti · de tu foto", and the customer's card promised
*"repartidos salteados, sin formar líneas"*. The generated image came out in
**three vertical bands**: strong pink on the left, white in the centre, gold on
the right.

The card made a promise in Spanish that never reached the generator in any form,
while a sentence asking for the opposite did.

## Decision

### 1. The confetti pattern writes its two phrases, like every other mode

`_Redactor.aleatorio` (`services/ai-api/app/patron_color.py`) now returns:

- `prompt_gemini`: `COLOR PATTERN — an even scatter of A, B and C intermixed
  balloon by balloon over the whole piece, every color reaching every area; no
  stripes, no bands, no blocks, no gradient, and no color gathered into a zone or
  a corner.`
- `prompt_lora`: `with A, B and C scattered evenly all over the piece`

Same grammar as the corpus (`espiral`, `bloques`, `degradado`, `damero`): a
`COLOR PATTERN — ` noun phrase plus a reinforcement clause after a semicolon for
Gemini; a short participial clause for the LoRA dialect. Same ceiling of four
named colours (beyond it, `N colors` for Gemini and `multicolor` for the LoRA
fragment). The LoRA fragment stays ASCII, digit-free and negation-free, as
section 8 requires.

It goes in `patron_color.py`, not in TypeScript: Python owns the pattern's wording
(ADR-0028, decision 2). TypeScript changed only comments and tests.

### 2. Neither phrase may contain the word "confetti"

This is the load-bearing constraint, and it is why the English does not simply
translate the Spanish name. In this repository's English vocabulary "confetti"
names a **product**, not a distribution:
`balloon.round.foil.white.printed_confetti`, `"clear confetti-filled balloons"`,
`"confetti or marble printed balloons"`
(`src/lib/lora/product-vocabulary-catalog-data.ts`), and
`reference-structure.ts` even lists `confetti` alongside `clear` and
`transparent` in `NO_FINISH_COLOR`.

Putting the word in the image prompt would invite the generator to fill opaque
matte latex balloons with confetti that the plan never bought — a product
invention of the same class ADR-0034 removes on the purchase side, with no
equivalent guard on the image side. The distribution is said as
`scattered evenly` / `an even scatter`, and a test asserts the word never
appears in either phrase.

### 3. A garland with confetti now carries a pattern

`frasesDeEstructuras` derives `guirnalda.conPatron` from whether the pattern's
phrases are non-empty, so a garland assembled with a confetti pattern now joins
its assembly phrase to a colour phrase and drops the organic fallback, and the
stage-2 `GEMINI_COMPOSITION_PATTERN_LOCK` applies to it. That is the intended
consequence: a confetti scatter *is* a statement about where each colour goes.

The adapter's empty-phrase guard stays. No Python mode returns an empty phrase
any more, but a response from an older revision of `ai-api` still can, and an
empty phrase must not be pasted onto the accent or assembly clauses.

## What is deliberately not done

**The photo's raw tone label does not reach the image prompt.** The measured
failure had a second half: the photo said `pearl blush pink` and the prompt said
`pink`. Part of that is now fixed for free — with a phrase to write, the confetti
mode goes through `_color_en`, which names the colour **with its finish** from
`x-acabados-en`. The real case now reads `matte pink, high-shine chrome gold and
matte white` instead of a bare `pink, gold, white`.

The rest — the words `blush` and `pale` — stays out, and this is a decision, not
an omission:

- `coloresConAcabadoReferencia` returns `{color, acabado, etiqueta}`
  (`src/lib/plan/colores-referencia.ts`). `color` is catalog vocabulary and
  `acabado` is a closed four-value set, but **`etiqueta` is unvalidated model
  prose** — `observed_colors: z.array(texto(80)).max(8)` in
  `reference-blueprint.ts`, free-form English, up to 80 characters.
- A label the taxonomy deliberately leaves unaliased (`copper`, `taupe`,
  `terracotta`) would put a hue into the image prompt that no plan line buys and
  no `sustitucionesColorReferencia` entry records — while the same line of the
  prompt says `use exactly these catalog colors: …`. The product bought must win
  over the word in the photo; an 80-character free-text field cannot be made to
  respect that at the boundary.
- `etiqueta` today reaches exactly one prompt, the chat/plan system prompt
  (`src/lib/ia/omoikane/prompt-sistema.ts`), where the model is asked to *choose
  catalog colours* from it. That is the right place for raw observation. The
  image prompt is downstream of the purchase and must not re-open the question.

Carrying only the finish would be safe, and that is what now happens through the
channel Python already owns. Carrying the shade adjective needs a validated
shade vocabulary that does not exist; inventing one here would create a second
owner of "what colour is this", which ADR-0024 and ADR-0034 spent two ADRs
giving a single owner (ΔE against the catalog palette). Not attempted.

## Alternatives considered

- **Reword `ORGANIC_COLOR_DISTRIBUTION` so it suits confetti too.** Rejected:
  that sentence is the fallback for every structure *without* a pattern, where
  organic clustering is the right instruction. Changing it would alter every
  prompt in the repo and both frozen snapshots, to fix one mode.
- **Write the confetti sentence in TypeScript, next to the fallback it
  replaces.** Rejected: it would give the pattern's wording a second owner,
  against ADR-0028 decision 2. The whole point of the phrase channel is that
  Python writes it and TypeScript inserts it.
- **Translate the Spanish name and say "a confetti scatter".** Rejected for the
  product collision in decision 2.
- **Regenerate `prompts-sin-patron.json` from the new builders.** Rejected: it is
  a frozen oracle captured once before the adapter existed, and regenerating an
  expectation from the code under test turns the suite into a mirror (AGENTS.md).
  Instead the `modo aleatorio` variant of that check was replaced by a
  `frases vacías` variant — which still tests the invariant that mattered, that
  an empty phrase is treated as absent — and confetti got its own positive
  assertion. The fixture file itself is untouched.

## Consequences

### What is invalidated

- **No hash and no cache key changes.** `plan_hash` excludes `patrones_color`
  (attached after hashing, `plan.py`). `sceneSpecHash` excludes `color_pattern`
  (injected at prompt-render time). The reference-analysis cache key
  (`analysisCacheKey`) is built from the v16 recognizer text,
  `ANALYSIS_PARSER_VERSION`, mode, catalog text, model and image bytes — none of
  which this touches. The photo-reading caches key on image bytes plus request.
- **The frozen v16 analysis prompt is untouched.** It is a different prompt from
  the image prompt, in a different direction (photo → JSON, not JSON → image),
  and `build-image-prompt.ts` does not import it. ADR-0029 is unaffected.
- **No version constant auto-bumps, and none is bumped by hand.**
  `VERSION_PATRON` (`patron-color.v1`) versions the pattern *contract*, not its
  English wording, and the contract did not change.
  `LORA_CAPTION_COMPILER_VERSION` versions the caption *template*; the compiler
  still inserts Python's fragment verbatim and was not modified — the same
  reasoning under which ADR-0032 added new assembly wording without bumping it.
  The Gemini image prompt has no version constant to bump; its only fingerprint
  is the frozen snapshots above.
- **Two telemetry values change for plans with a confetti pattern**, because the
  final LoRA caption now carries the new fragment: `captionHash` in the
  `plan_audit_log` generation diagnostic and `loraPromptHash` in the
  `/api/generate` response. Nothing is cached on either.
- **No golden vector changes.** The three goldens carrying `COLOR PATTERN —`
  text (29 espiral, 30 degradado, 31 damero) use other modes;
  `git status contracts/domain/v1/golden/` is empty after this change.
- **The image-fidelity baseline for confetti pieces is invalidated.** Any earlier
  visual comparison of a plan whose pattern is `aleatorio` was produced from a
  prompt that asked for organic clusters; it is no longer the same experiment.
  Pieces with any other pattern, and pieces with no pattern, are unaffected.

### What is not yet proven

This change is verified deterministically — the phrases, their grammar, their
insertion point, coherence, the LoRA language gate and the preflight. It is
**not** verified against a real generation: no paid call was made. What it fixes
is that the instruction now exists and says the right thing; whether the
generator obeys it on the "Mr & Mrs" wall needs one generation with the same
plan, compared against the banded image from 2026-09-29.

## Rollback

Local and additive: one method in `patron_color.py` plus comments and tests. No
contract, no `plan_hash`, no golden vector, no cache key and no migration, so
reverting the commit is the whole rollback — and the confetti pattern goes back
to emitting empty phrases, which every consumer still handles.

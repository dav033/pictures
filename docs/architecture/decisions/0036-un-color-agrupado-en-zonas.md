# ADR-0036 — A colour gathered in zones

Date: 2026-09-29
Status: accepted
Amends ADR-0028: adds an eighth mode to `patron-color.v1` (sections 1, 3, 4, 6, 7,
8 and 11) and changes the preset for a wall with a dominant colour. Everything
else in ADR-0028 holds — Python is still the only owner of the pattern's
semantics and of its wording (decision 2), TypeScript still validates the shape
and draws what comes out, and `patrones_color` still lives outside `plan_hash`.
Extends ADR-0035, which gave the confetti mode its two phrases; this one gives
the trade the pattern those phrases could not describe.

## Problem

Measured on 2026-09-29 with the same real "Mr & Mrs" balloon wall as ADR-0035
(pearl blush pink base, chrome gold clustered in **four zones** — upper right
corner, bottom centre, lower left corner, middle of the left side — and a few
white flowers).

The plan read the photo correctly: organic wall, `rosado` 65 % / `dorado` 25 % /
`blanco` 10 %. The pattern came out "Confeti · de tu foto" every single time, and
the generated image spread the gold over the whole wall instead of gathering it.

ADR-0035 fixed the *wording* of that confetti — it now says what the card
promises. But the diagnosis went one level deeper: **the pattern the wall
actually has was not expressible in the contract at all.**

- `_MODOS_POR_TIPO["pared"]` offered `anillos, bloques, degradado, aleatorio,
  damero`. Every one of them is either periodic or runs along an axis
  (`_EJE_ES["pared"]` is "de arriba abajo"). None can say "this colour goes
  gathered in these places".
- `_TIPOS_ESPIRAL_SUGERIDA` does not contain `pared`, so a wall's preset always
  fell through to `aleatorio`.
- The only two-dimensional thing in the contract is `pintados` (row, column,
  material), and today only the editor's manual brush produces it. Nothing
  derives it from the photo.
- The hint path made it worse: `_base_de_pista` for `aleatorio` deliberately
  ignores the colours and weights it read and rebuilds the preset's own confetti
  from `participacion`. A photo hint of `aleatorio` and no hint at all produce
  the identical pattern.

So after ADR-0035 the prompt said, about a wall whose gold sits in four corners:

> …every color reaching every area; no stripes, no bands, no blocks, no
> gradient, and **no color gathered into a zone or a corner**.

The sentence is a correct rendering of a confetti. The piece is not a confetti.

## Decision

### 1. An eighth declarative mode, `zonas`, only on a wall

`patron-color.v1` gains one variant in `BasePatronColorSchema`
(`src/lib/plan/patron-color.ts`):

```ts
z.object({
  modo: z.literal("zonas"),
  fondo: IndiceMaterialSchema,
  zonas: z.array(z.object({
    material: IndiceMaterialSchema,
    ancla: z.enum(ANCLAS_ZONA),
    extension: z.number().int().min(1).max(60),
  }).strict()).min(1).max(8),
}).strict()
```

`ANCLAS_ZONA` is the nine places a decorator — and the model reading the photo —
splits a wall into: `superior_izquierda`, `superior_centro`, `superior_derecha`,
`media_izquierda`, `centro`, `media_derecha`, `inferior_izquierda`,
`inferior_centro`, `inferior_derecha`.

Three properties make it fit the model that already exists:

- **Several zones may share a `material`.** That is the whole point: "the gold
  goes in four zones" is four entries with the same material. The wording groups
  them back together by colour so the generator reads one colour in four places,
  not four colours.
- **The parameters are resolution-independent.** An anchor and a percentage mean
  the same thing whatever grid the measurements produce, so editing the piece's
  size does not invalidate the pattern.
- **`pared` only.** A wall is the one 2-D geometry (`TIPO_REJILLA`); on a column
  "gathered at the top" is what `bloques` already says. `_MODOS_POR_TIPO["pared"]`
  gains `zonas` and nothing else changes.

New cross rules, in `patron_color._validar`, the only owner of them:

- `direccion` must stay `longitudinal`. Zones are absolute places on the piece,
  not a path along an axis; rotating them would not mean anything
  (`direccion_no_permitida`). Mirror was already impossible on a wall.
- `sum(extension) <= 90` (`MAX_EXTENSION_ZONAS`), so the background always keeps
  a tenth of the piece. Over it, the stable motive is `zonas_sin_fondo`.

### 2. Expansion: the cells nearest each anchor, in exact integers

`_rejilla_de_zonas` fills the grid with `fondo` and then serves each zone the
free cells closest to its anchor:

- Each zone's quota comes from `_mayor_resto(filas × columnas, [...extensiones,
  100 - sum])`, the same exact-integer apportionment every other mode uses, with
  at least one cell per zone. **A colour therefore receives the same number of
  cells it would receive from a confetti of the same weights; only where they
  fall changes.**
- Distance is squared Euclidean on *cell indices*, in twelfths of a cell, so it
  is an integer and the ordering never depends on binary rounding: the cell
  `(fila, columna)` sits at `(12·columna + 6, 12·fila + 6)` and the anchor
  `(ax, ay)` in sixths of the piece at `(2·ax·columnas, 2·ay·filas)`. Cell
  indices and not fractions of the piece, because `_rejilla` already sizes the
  grid with near-square cells: a patch comes out round *on the wall*, which is
  how balloons actually cluster. Ties break by `(distance, fila, columna)` — no
  `sha256`, unlike the confetti.
- Zones are served in order and each takes only free cells, so two overlapping
  zones do not erase each other: the first wins, the second moves outward. A zone
  that reaches no cell leaves its colour without balloons, and `_expandir` rejects
  that as `material_sin_uso` exactly as in every other mode.

A 49 × 79 wall (3 871 cells, near the module's 4 000 ceiling) expands in 6 ms on
this machine.

### 3. The wall preset goes in zones when one colour rules

`sugerir_patron` sends a wall to `zonas` when the leading colour reaches
`DOMINANCIA_ZONAS` (0.5) and the piece has at most `MAX_MATERIALES_ZONAS` (4)
colours: the principal colour is the background and every other gets **one**
patch the size of its participation, spread over `_ANCLAS_PRESET` (corners
first, alternating sides so two patches never come out stuck together).

That is the organic wall of the trade, and it is also what the image prompt was
asking for *on its own* whenever a piece carried no pattern
(`ORGANIC_COLOR_DISTRIBUTION`: "intentional organic clusters and transitions").
Until now a confetti contradicted it.

Without a dominant colour — three or four even shares — there is no background
that rules and the confetti stays the honest reading. That gate is a craft rule,
not a measurement, and it is the knob to turn if the default turns out wrong.

One patch per colour is what the preset honestly knows. *How many* places a
colour is gathered in, and which, only the photo can say.

### 4. The photo can read the zones, and that costs the pattern prompt's version

`patron_referencia` gains the `zonas` bullet in `SYSTEM_INSTRUCTION`, the nine
anchors, and an optional `zonas` array in `RESPONSE_SCHEMA` (`color` from the
catalog palette, `ancla`, `extension`). The prompt says explicitly that several
entries may share a colour ("four patches of dorado is four entries") and that a
colour sprinkled all over is `aleatorio`, not `zonas`.

The hint carries the patch colours **by name**, like `colores`, because whoever
reads the photo does not know the piece's material indices; `patron_color`
resolves them with the same ΔE tone table (`material_de_color`).
`colores[0]` is the background.

Degrading, never inventing:

- A `zonas` hint with no patches says nothing about *where*, so
  `validar_pistas` turns it into `ninguno` and the piece falls to the preset.
- A patch whose colour the piece does not carry makes `patron_desde_pista` return
  `None` — the preset again. A patch in the wrong place would show up in the
  chart, on the assembly sheet and in the image prompt; the preset is the better
  answer.

**This is not free**, and it is the one cost of this ADR that is not local: the
pattern-detection prompt is no longer the same experiment. `PROMPT_VERSION` moves
from `patron-referencia.v1:0d8c93d34d672014` to
`patron-referencia.v1:5cbba9bd04d02884`, and **any earlier measurement of how
well the photo's pattern is read is invalidated for every mode**, not only for
walls: the model now chooses from eight modes instead of seven, so a piece that
used to come back `aleatorio` can come back `zonas`. There is no stored
evaluation baseline for this prompt in `eval/`, so nothing in the repository had
to be regenerated — but that is an absence of a baseline, not the absence of a
cost.

What this does **not** touch: the v16 reference-analysis prompt stays byte-frozen
(ADR-0029). `patron-referencia` is a separate call made after it, its own prompt,
and `analysisCacheKey` is not built from it. Its own read caches on image bytes
plus request, so the version move re-reads each photo once.

### 5. The wording, in the same grammar as the corpus

`_Redactor.zonas`, in Python, because Python owns the pattern's wording
(ADR-0028 decision 2). Anchors are grouped **by colour**, not listed one by one:
four gold clauses in a row read as four different colours.

- `prompt_gemini`: `COLOR PATTERN — a base of pearl pink filling the whole piece,
  with high-shine chrome gold gathered into four compact patches at the upper
  right corner, the bottom center, the lower left corner and the middle of the
  left side, plus matte white gathered into one compact patch at the center; each
  patch is one solid group of touching balloons of that single color and the base
  color fills everything between the patches; no stripes, no bands, no gradient
  and no even scatter of the patch colors.`
- `prompt_lora`: `with gold clustered in four compact patches, plus white
  clustered at the center over a pink base` — ASCII, digit-free, negation-free
  (ADR-0028 §8). The anchor list is spelled out only when a colour has a single
  patch: with several it is the longest fragment in the caption and
  `LORA_PROMPT_MAX_LENGTH` starts dropping parts.

Clauses are joined with `", plus "` and not `" and "` because each colour's
anchor list already carries its own `and`, and two in a row made the last place
of one colour look like it belonged to the next. Four named colours is the
ceiling, as in every other mode.

### 6. The sketch already respects them

Nothing was needed in `silueta_patron.py`. `_lectura_pared` maps each balloon of
the silhouette to a grid cell by band-scanning top to bottom and left to right,
so the patches land where the grid puts them. The counts per colour come from the
size × material matrix that `plan.py` already bought; the sketch reassigns
colour to a position, never a quantity.

## Measured scope

Same plan (2 × 1,5 m wall, `rosado` 0,6 · `dorado` 0,3 · `blanco` 0,1, no
declared pattern), resolved twice — once with the new preset, once with
`_pared_va_en_zonas` forced to `False`, which is exactly the old behaviour:

| | moves |
|---|---|
| `plan_hash` | **yes**, `6bbda6ee…` → `48d26b7d…` |
| preset's mode | **yes**, `aleatorio` → `zonas` |
| pattern name and both prompt phrases | **yes** |
| `celdas` (where each colour goes) | **yes** |
| `participacion` | no — `[0.6, 0.3, 0.1]` |
| balloons per colour | no — rosado 108 · dorado 54 · blanco 18 |
| `compras` (packages) | no — blanco 1 · dorado 2 · rosado 3 |
| quoted total | no — 61 500 COP |

The hash moves and the money does not, and that is by construction: a zone's
quota is `_mayor_resto` over the same effective weights a confetti uses. It can
still differ by a cell or two when the rounded shares do not add up to 100.

`plan_hash` moving is the real consequence: **every wall in flight whose pattern
was the preset gets a new hash, so an approved plan has to be re-approved.** It
was accepted knowingly — nothing is deployed and the branch is 50 commits ahead
of what runs.

### Golden vectors

**Not one existing vector moved.** Measured, not assumed: after regenerating,
`git status contracts/domain/v1/golden/` shows only the new file. The reason is
itself the gap — of the 31 vectors, only two carry a wall (22 has a single colour,
which admits no pattern; 31 declares a `damero` by hand), so changing a wall's
preset could not move any of them.

`32-pared-organica-zonas-tres-colores.json` closes that gap: a wall in `zonas`
with three colours, the first vector whose pattern is neither periodic nor along
an axis. It declares the pattern by hand, like vectors 29–31, because
`completar_patrones` is not part of a vector's request and a preset is therefore
not reachable from this suite; the preset itself is locked by
`tests/test_patron_color.py`. It carries no `expected` block: it was written after
ADR-0023 retired the TypeScript resolver, so a second independent oracle never
existed for these numbers, and the suite reads `expected_python` alone.

While regenerating, a second problem surfaced and was fixed:
`_write_expected_python` stored `patrones_color[].posiciones`, the silhouette
sketch, which the comparison explicitly strips (`_sin_croquis`). A routine
regeneration came out with **2 379 lines of drawing added and no number moved** —
the diff nobody reviews case by case, which is what the module's own header warns
against. It now stores the result without the sketch, and the 31 existing vectors
came back byte-identical.

## Alternatives considered

- **Let the photo hint carry `pintados`** (the field exists and the expander
  already honours it). Rejected, on four counts, each sufficient:
  1. **It says nothing to the generator.** `pintados` adds exactly one sentence
     to `prompt_gemini`: *"Some clusters were hand-painted by the decorator;
     follow the per-cluster color map exactly."* The image model never sees that
     map. The measured failure is that the gold is spread in the generated image;
     painted cells reach the chart and the assembly sheet and are mute towards
     the generator, which is half of what was asked for.
  2. **It does not survive editing.** `sugerir_patron_modo` deliberately drops
     `pintados` on a style change ("son de la gráfica del estilo anterior"), and
     `filas_de_racimos` returns `None` when they exist. The zones read from the
     photo would evaporate the moment the decorator touched the style — and the
     brief asked for a pattern that survives exactly that.
  3. **It is tied to a grid that moves.** Cells are indices into
     `filas × columnas`, derived from `total`, `ancho_m` and `alto_m`. A hint is
     read before the plan's measurements are final and the decorator can change
     them afterwards; the cells would then be wrong, or out of range — there is
     already a warning path for precisely that ("N pintados quedaron fuera de la
     estructura").
  4. **It does not fit.** `pintados` caps at 512 entries and a wall reaches 4 000
     cells; four gold zones on a 76-column wall is hundreds of cells, all of them
     inside `estructuras` and therefore inside the canonical JSON that
     `plan_hash` signs.
- **Make `_base_de_pista` honour the colours and weights it reads for
  `aleatorio`.** Not done, and deliberately left alone: the comment there records
  why (a confetti spreads *every* colour of the piece by participation, and an
  accent over a confetti would block its colour slider). It is also no longer the
  problem — a photo hint no longer has to abuse `aleatorio` to mean "gathered".
- **Change `ORGANIC_COLOR_DISTRIBUTION` so it suits a gathered wall.** Rejected
  for the same reason ADR-0035 rejected it: it is the fallback for every piece
  *without* a pattern and changing it would alter every prompt in the repo.
- **Make the wall preset `zonas` unconditionally.** Rejected: with three or four
  even shares there is no background, and "a base of A with patches of B, C and D
  covering three quarters of it" describes a confetti badly.
- **Express the zones in metres, or in fractions of the piece.** Rejected: the
  nine anchors are how a decorator and the model reading the photo both talk, they
  survive a resize, and a free coordinate would need a validated frame that
  nothing else in the contract has.

## What is not yet proven

Verified deterministically: the expansion (cell by cell, hand-computed on a
3 × 4 wall), the counts, the cross rules and their stable motives, the preset and
its gate, the hint and its three degradation paths, both phrases, the LoRA
language gate, the editor's style switch in and out of `zonas`, 2 to 12 colours,
and the contract chain.

**Not** verified against a real generation: no paid call was made. What is fixed
is that the piece can now state "this colour is gathered here", that the
statement reaches the chart, the assembly sheet and the image prompt, and that the
prompt no longer says the opposite. Whether the generator obeys it on the
"Mr & Mrs" wall needs one generation with the same plan, compared against the
image from 2026-09-29.

Also unproven: whether the model reading the photo returns the four gold zones.
That needs one paid vision call on the real photo.

## Rollback

Additive, but not local, in this order:

1. Revert the commit. The mode disappears from the contract, the preset goes back
   to confetti, and `patron-referencia`'s prompt version returns to
   `0d8c93d34d672014`.
2. Delete `32-pared-organica-zonas-tres-colores.json`. It is the only golden
   vector that depends on the mode; the other 31 are untouched by both directions.
3. **Any plan already stored with a `zonas` pattern becomes invalid**: the
   contract's `additionalProperties: false` and the discriminated union reject the
   variant, and `plan_hash` will not match. Nothing is deployed and no plan has
   one yet, which is why this is a rollback note and not a migration. Once a plan
   with `zonas` exists, rolling back needs those plans rewritten to `aleatorio`
   first, with their hashes re-signed and their approvals re-taken.

Steps 1 and 2 are the whole rollback today. Step 3 is the condition under which
it stops being free.

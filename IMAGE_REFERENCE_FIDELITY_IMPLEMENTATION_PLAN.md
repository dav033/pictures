# Image Reference Fidelity and Venue Editing — Implementation Plan

## 1. Objective

Rebuild the reference-analysis and image-generation flow so that it:

1. Detects important decorative and background elements, including curtains, drapes, backdrops, panels, balloon structures, plinths, furniture, florals, signage, and lighting.
2. Lets the user confirm, reject, add, recolor, and reposition detected elements before paying for image generation.
3. Uses a user-approved scene specification as the only source of truth for generated decoration.
4. Preserves the uploaded venue photo's camera, crop, architecture, perspective, and lighting outside explicitly editable regions.
5. Recreates reference composition and relationships without treating reference or product photos as flat images to paste into the venue.
6. Prevents unapproved decorative objects from appearing.
7. Uses English schema keys and English generation prompts, with explicit positive and negative constraints.
8. Measures fidelity with repeatable tests instead of relying on prompt changes alone.

Do not change the catalog, quote, or RAG behavior except where generation needs item quantities or a clear distinction between catalog-backed and reference-only elements.

## 2. Confirmed Problems in the Current Implementation

### 2.1 Contradictory reference policy

`src/app/api/generate/route.ts`, `src/lib/ia/tipos.ts`, and `src/lib/ia/gemini/imagen.ts` explicitly say that style references may never contribute objects. Therefore, a curtain can be correctly detected in the analysis JSON and still be forbidden from appearing in the generated image.

Replace the single `referenciasEstilo` concept with explicit source roles:

- `composition_reference`
- `element_reference`
- `palette_reference`
- `style_reference`
- `catalog_product_reference`
- `venue_base`

One image may have more than one approved role.

### 2.2 User correction happens too late

Reference analysis currently runs inside `/api/generate`, and the UI displays the JSON only after generation finishes. The user cannot correct a missed curtain, unwanted object, wrong color, or bad interpretation before generation.

Analysis and approval must become a separate pre-generation step.

### 2.3 Analysis output is not an executable scene contract

The current schema has free-form `copiar` and `no_copiar` strings but lacks:

- Stable element IDs.
- Element category and role.
- Detection confidence and visible evidence.
- Include/exclude/ask decision.
- Color adaptation policy.
- Catalog-backed versus reference-only status.
- Reference-space versus target-space coordinates.
- Layer relationships such as “curtain behind balloon arch.”
- Explicit positive and negative prompt sections.

### 2.4 Reference coordinates are applied to a different image

`anclas_espaciales` describes positions inside the reference image. Those percentages cannot be reused directly in a different venue photo. This causes decorations to appear in invalid places.

Store two independent coordinate systems:

- `reference_bbox`: where the element appears in its source reference.
- `target_bbox`: where the approved element must appear in the venue or output canvas.

Copy relative relationships and layers from the reference, but map them to a target region selected or confirmed on the venue.

### 2.5 Product-reference wording encourages collage artifacts

Current provider prompts say products must look “exactly like” their photos and must not be reinterpreted. A model may satisfy that instruction by copying source pixels, backgrounds, or camera angles, producing pasted-looking results.

The new policy must preserve product identity, not source pixels:

- Preserve color, shape, print, material, and distinguishing details.
- Re-render the product as a physical object from the venue camera angle.
- Match venue light, shadow, focus, scale, occlusion, and contact surfaces.
- Never copy the source image's background, border, crop, halo, or studio lighting.

### 2.6 Venue preservation is prompt-only

The current one-pass edit asks the model to preserve the venue but provides no protected-region mask, deterministic outside-region comparison, or post-generation verification. Complex multi-image input also dilutes attention from the venue base.

### 2.7 Aspect-ratio mismatch

The UI accepts `16:9`, but the OpenAI adapter currently maps it to `1536x1024` (`3:2`). This can change crop and geometry. Each provider needs an explicit capability map. Unsupported ratios must use padding plus a recorded crop transform, never stretching.

### 2.8 Revisions are not true revisions

`instruccion` is described as an adjustment to a previous generation, but `/api/generate` does not receive the previous generated image. It regenerates from the venue/reference inputs. Add an explicit revision path that edits the selected generated result.

### 2.9 Provider defaults and limits need updating

- Keep `GEMINI_IMAGE_MODEL` configurable. For `gemini-3.1-flash-image`, distinguish total input images from high-fidelity object-reference limits; do not expose one generic number as if every image had equal fidelity.
- Change the OpenAI default from deprecated `gpt-image-1` to the current supported image model, presently `gpt-image-2`, while keeping the environment override.
- Keep model-specific parameters behind capability checks. Do not send an unsupported `input_fidelity` or mask parameter merely because another model accepts it.

Official references to verify again during implementation:

- OpenAI GPT Image 2: https://developers.openai.com/api/docs/models/gpt-image-2
- Google Gemini image generation and editing: https://ai.google.dev/gemini-api/docs/image-generation

## 3. Target User Flow

### 3.1 Upload

The user may upload:

- One venue photo.
- One to three design references.
- Optional catalog selections already known by the application.

Preserve semantic IDs from upload through analysis, approval, prompt construction, provider input order, telemetry, and QA.

### 3.2 Analyze before generating

Call a new `POST /api/references/analyze` endpoint as soon as references are attached or when the user clicks “Analyze references.” Do not start expensive image generation yet.

The endpoint must return:

- Reference blueprint v2.
- Detected element candidates.
- Confidence and visible evidence for each candidate.
- Suggested source roles for each image.
- Suggested color policy.
- Reference-layer and composition relationships.
- Warnings and unresolved decisions.

Use a two-pass analysis:

1. **Inventory pass:** exhaustive visible-object and background-layer analysis using a domain checklist. Explicitly inspect the rear decorative layer for curtains, fabric drapes, shimmer walls, printed backdrops, panels, frames, and lighting.
2. **Audit pass:** give a verifier the image and draft inventory. Ask only which visible event-design elements were missed, misclassified, or unsupported by evidence. Merge by stable element ID and bounding-box overlap. Never silently promote a verifier-only low-confidence item to required.

Every detected item needs a short `visible_evidence` description and `reference_bbox`. Low-confidence items remain visible in the UI as “Possible element” choices.

### 3.3 User review

Before generation, show a compact review panel, not raw JSON. For every candidate, provide:

- Include toggle.
- Name/category.
- Confidence label.
- Source thumbnail and highlighted reference bounding box.
- Color control:
  - `match_reference`
  - `adapt_to_event_palette`
  - `custom`
- Quantity or quantity range where meaningful.
- “Catalog product” or “Reference-only” badge.
- Target placement controls when a venue photo exists.

Required actions:

- “Add missing element” must allow a user to add `curtain`, choose a color policy, and place it even when analysis missed it completely.
- A detected curtain should default to `include` when confidence is medium or high, but the user can disable it.
- A reference-only item must be visibly marked as not guaranteed to exist in inventory and excluded from the quote unless matched to a real catalog item.
- Automatic generation in `ia_escoge` mode must pause for review when references or a venue photo create unresolved element or placement decisions. No-reference generation may remain automatic.

### 3.4 Placement on the venue

Overlay target boxes on the venue photo. At minimum support drag, resize, and layer ordering. Store normalized coordinates relative to the venue's actual content rectangle.

If the user does not place an item, create a suggestion from a venue-analysis step that identifies:

- Free wall/backdrop regions.
- Floor line and wall plane.
- Doors, windows, people, furniture, and architecture to protect.
- Light direction and approximate scale cues.

The user must be able to confirm the suggested region. For a curtain-and-balloon design, encode the curtain as a rear layer and balloons as a foreground layer with overlap, not as two independent pasted rectangles.

### 3.5 Generate and validate

Compile only approved data into a generation scene specification. Do not send the entire forensic analysis JSON to the image model.

After generation:

1. Run deterministic outside-edit-region comparison where an actual edit mask is supported.
2. Run a visual QA pass for required elements, forbidden extras, venue preservation, target placement, composition relationships, and collage artifacts.
3. Allow at most one automatic corrective retry, using only failed checks as corrective instructions.
4. Return the image, scene-spec version, QA report, and whether a retry occurred.

## 4. Reference Blueprint V2

Create `src/lib/ia/reference-blueprint.ts` with a strict Zod schema. Use English keys and enums. Keep free text length-limited. Reject unknown top-level fields.

Recommended shape:

```json
{
  "schema_version": "2.0",
  "source_images": [
    {
      "image_id": "REF_01",
      "approved_roles": ["element_reference", "composition_reference", "palette_reference"]
    }
  ],
  "elements": [
    {
      "element_id": "REF_01_E01",
      "source_image_id": "REF_01",
      "name": "fabric curtain backdrop",
      "category": "curtain",
      "scene_role": "backdrop",
      "detection_confidence": 0.86,
      "visible_evidence": "Pleated fabric spans the rear center behind the balloon installation.",
      "reference_bbox": { "x": 0.18, "y": 0.05, "width": 0.64, "height": 0.82 },
      "depth_layer": 1,
      "include_policy": "ask",
      "approved": false,
      "source_type": "reference_only",
      "quantity": { "mode": "approximate", "min": 1, "max": 1 },
      "appearance": {
        "observed_colors": ["warm beige"],
        "resolved_colors": [],
        "color_policy": "adapt_to_event_palette",
        "material": "soft pleated fabric",
        "shape": "floor-length rectangular drape"
      },
      "relationships": [
        { "type": "behind", "target_element_id": "REF_01_E02" }
      ],
      "uncertainties": []
    }
  ],
  "composition": {
    "focal_point": "balloon installation over curtain backdrop",
    "density": "dense",
    "symmetry": "asymmetric",
    "negative_space": ["upper-right edge", "lower-left floor area"]
  },
  "palette": {
    "observed": ["warm beige", "cream", "muted gold"],
    "priority": ["cream", "muted gold"]
  },
  "unresolved_decisions": [
    {
      "decision_id": "D01",
      "element_id": "REF_01_E01",
      "question": "Include the curtain and adapt its color to the event palette?"
    }
  ]
}
```

Rules:

- Confidence is evidence confidence, not a guarantee.
- `approved` can only be set by an explicit user action or an unambiguous default rule recorded by the server.
- `source_type: reference_only` must never become quoteable inventory.
- Increment the schema version and include the analysis system-prompt hash in the cache key. Otherwise an in-memory result produced by an old prompt can survive a prompt update.
- Provide a temporary v1-to-v2 adapter only for existing laboratory fixtures. New generation must reject v1 after rollout.

## 5. Approved Scene Specification

Create `src/lib/ia/scene-spec.ts`. This is separate from raw detection and is the only generation contract.

Recommended shape:

```json
{
  "schema_version": "1.0",
  "generation_mode": "edit_venue",
  "canvas": {
    "aspect_ratio": "16:9",
    "content_rect": { "x": 0, "y": 0, "width": 1, "height": 1 }
  },
  "venue": {
    "source_image_id": "VENUE_01",
    "preserve": [
      "camera position",
      "crop",
      "walls",
      "ceiling",
      "floor",
      "doors",
      "windows",
      "existing furniture",
      "ambient lighting"
    ],
    "protected_regions": [],
    "editable_regions": [
      { "region_id": "R01", "bbox": { "x": 0.24, "y": 0.12, "width": 0.48, "height": 0.76 } }
    ]
  },
  "elements": [
    {
      "element_id": "CURTAIN_01",
      "name": "fabric curtain backdrop",
      "source_type": "reference_only",
      "required": true,
      "target_bbox": { "x": 0.28, "y": 0.13, "width": 0.40, "height": 0.73 },
      "depth_layer": 1,
      "resolved_colors": ["ivory"],
      "identity_constraints": ["floor-length", "soft vertical pleats"]
    }
  ],
  "positive_prompt": {
    "required_elements": [],
    "composition": [],
    "venue_preservation": [],
    "photorealistic_integration": []
  },
  "negative_prompt": {
    "forbidden_elements": [],
    "forbidden_venue_changes": [],
    "forbidden_compositing_artifacts": []
  }
}
```

Resolve colors with this precedence:

1. Explicit user color override.
2. Exact catalog-product color when identity requires it.
3. User-approved per-element color policy.
4. Event palette.
5. Observed reference color.

Never add an element to satisfy a palette or “complete” a design.

## 6. English Prompt Builder

Move all prompt construction out of `src/app/api/generate/route.ts` into `src/lib/ia/build-image-prompt.ts`. It must be a pure function with snapshot tests.

Do not depend on a provider-specific negative-prompt API. Keep positive and negative constraints structured in JSON, then compile both into one English instruction unless a provider offers a verified separate field.

Prompt order must express priority clearly:

1. Task and edit mode.
2. Source-of-truth priority.
3. Venue preservation.
4. Exact approved element allowlist.
5. Target placement and layer relationships.
6. Reference and catalog identity rules.
7. Photorealistic integration requirements.
8. Negative constraints.
9. Final self-check.
10. Delimited JSON data.

Recommended template:

```text
ROLE
You are a photorealistic event-design image editor.

TASK
Edit VENUE_01. Add only the approved decorative elements in APPROVED_SCENE_SPEC.
This is a localized edit of the supplied venue photo, not a new venue and not a collage.

SOURCE-OF-TRUTH PRIORITY
1. APPROVED_SCENE_SPEC controls which elements exist, their colors, placement, and layers.
2. VENUE_01 controls camera position, crop, architecture, perspective, and ambient light.
3. CATALOG_* images control product identity only.
4. REF_* images control only their explicitly approved roles.
If sources conflict, follow this order. Do not resolve conflicts by inventing content.

MUST INCLUDE
- Render every element whose required field is true exactly once or within its approved quantity range.
- Place each element inside its target_bbox and preserve approved behind/in-front-of relationships.

MUST PRESERVE
- Keep VENUE_01 camera, framing, walls, ceiling, floor, doors, windows, furniture, and existing light unchanged outside editable regions.
- Keep empty areas empty when the specification does not place decoration there.

PHOTOREALISTIC INTEGRATION
- Re-render referenced products as physical three-dimensional objects from the venue camera angle.
- Match scene perspective, scale, lens softness, white balance, light direction, shadows, reflections, occlusion, and floor/wall contact.
- Use natural overlap between the curtain, balloon installation, and foreground objects.
- Never copy a source image background, rectangular crop, border, halo, or studio shadow.

MUST NOT INCLUDE
- No decorative object absent from the approved element allowlist.
- No extra balloons, garlands, tables, signs, flowers, plants, lights, furniture, people, text, logos, or party props unless explicitly approved.
- No duplicated elements, floating objects, impossible supports, flat stickers, cutout edges, pasted rectangles, halos, mismatched sharpness, or mismatched lighting.
- Do not move, replace, redesign, widen, narrow, repaint, or relight venue architecture.

FINAL CHECK BEFORE OUTPUT
Verify that all required elements are present, all forbidden elements are absent, target placement is respected, rear layers remain behind foreground layers, and the result looks photographed in the venue rather than composited.

<APPROVED_SCENE_SPEC>
...validated compact JSON...
</APPROVED_SCENE_SPEC>
```

Prompt-builder invariants:

- Output is English except immutable product names or verbatim user text stored as data.
- No contradictory phrases such as “references never provide objects” when an approved `element_reference` exists.
- Only approved elements appear in `MUST INCLUDE`.
- Every unapproved detected element is either omitted or appears in `MUST NOT INCLUDE` when confusion is likely.
- Raw base64, raw forensic analysis, uncertainty prose, and unused references never enter the prompt.
- Product descriptions describe identity, not pixel copying.

## 7. Provider Adapter Changes

### 7.1 Shared request type

Update `src/lib/ia/tipos.ts`:

- Replace `referenciasEstilo` with typed `inputs` containing `image_id`, `role`, `priority`, and `allowed_use`.
- Add `sceneSpec`, optional `editMask`, optional `previousGeneratedImage`, and `revisionMode`.
- Add provider capabilities: exact aspect ratios, total input limit, object-fidelity limit, mask support, high-fidelity option support, and multi-turn support.
- Keep venue input first and send only images used by approved elements.

### 7.2 Gemini

Update `src/lib/ia/gemini/imagen.ts`:

- Interleave every image with its English ID/role label.
- Use `VENUE_01` first.
- Describe semantic edit regions precisely when a binary mask parameter is unavailable.
- Prefer a small number of relevant references over filling the maximum input count.
- Preserve interaction state or the previous generated image for user revisions; do not regenerate adjustments from scratch.
- Keep aspect ratio exact when supported.

### 7.3 OpenAI

Update `src/lib/ia/openai/imagen.ts`:

- Default to `gpt-image-2`, still allowing `OPENAI_IMAGE_MODEL` override.
- Verify request fields against installed `openai` SDK types and current official documentation.
- Use an actual alpha mask for localized venue edits when the selected model/endpoint supports it.
- Keep model-specific fidelity options behind capability checks.
- Preserve the ordered English image map because the edits endpoint receives an ordered image collection rather than per-image captions.
- Fix unsupported aspect ratios with pad/edit/crop and store the coordinate transform used by target boxes.

### 7.4 Reference budget

Use priority:

1. Venue base or previous generated image.
2. One master composition reference.
3. References for required approved elements.
4. Catalog images for identity-critical products.
5. Palette/style-only references.

Drop unused references before calling the provider and report dropped IDs in debug telemetry. Never silently drop a required element reference.

## 8. Localized Venue Editing and Anti-Paste Strategy

Implement the following sequence:

1. Build target editable regions from approved target boxes, including a small soft margin for shadows and overlap.
2. Protect all pixels outside those regions where provider masking allows it.
3. Run the first edit using the venue plus only approved, relevant references.
4. Compare outside-region pixels against the original venue after normalizing dimensions.
5. Detect flat compositing artifacts in visual QA.
6. If QA fails only integration checks, perform one harmonization edit on the generated image with a narrow instruction to correct lighting, contact shadows, perspective, and edges while preserving object count and venue geometry.

Do not generate transparent decorations and paste them directly as the final result. A transparent intermediate may be used only as a layout aid; the final provider pass must integrate lighting, shadows, occlusion, depth of field, and surface contact.

For revisions:

- `revise_current_result` uses the selected generated image as the edit base.
- The original venue remains a protected identity reference.
- Apply the user's delta to the existing approved scene spec.
- Revalidate the allowlist and target regions.
- Do not rerun reference detection unless references changed.

## 9. API Changes

### 9.1 New endpoint

Create `src/app/api/references/analyze/route.ts`:

- Validate image count, MIME type, dimensions, and payload size.
- Assign stable IDs.
- Run inventory and audit passes.
- Return `ReferenceBlueprintV2` plus analysis metadata.
- Cache by image hash, analysis model, schema version, and system-prompt hash.
- Never log base64 image data.

### 9.2 Generation endpoint

Refactor `src/app/api/generate/route.ts`:

- Accept the approved scene spec and its hash.
- Validate product IDs again server-side.
- Validate that catalog-backed elements resolve to real catalog records.
- Validate that every required element has a source or sufficient text identity.
- Validate target boxes, layers, and editable regions.
- Build prompt through the pure English prompt builder.
- Call the provider adapter.
- Run QA and optional single retry.
- Return `prompt`, `sceneSpec`, `qa`, provider/model, and generated image in debug-enabled environments. In production, avoid returning the full prompt unless explicitly enabled.

Do not accept a client-supplied scene spec as trusted. Parse it with the strict server schema and rebuild positive/negative constraints from approved structured fields.

### 9.3 Laboratory endpoint

Update `src/app/api/laboratorio-referencias/route.ts` to v2 so laboratory tests use the same scene-spec and prompt builder as production. Remove its separate prompt policy to prevent drift.

## 10. UI Changes

Split logic currently concentrated in `src/app/page.tsx` into focused components:

- `src/components/references/ReferenceReviewPanel.tsx`
- `src/components/references/DetectedElementCard.tsx`
- `src/components/references/PlacementEditor.tsx`
- `src/components/references/ColorPolicyControl.tsx`
- `src/components/references/GenerationQaSummary.tsx`

Required states:

- `idle`
- `analyzing_references`
- `needs_review`
- `ready_to_generate`
- `generating`
- `validating`
- `retrying_once`
- `complete`
- `failed`

Required UX behavior:

- Show analysis before generation.
- Use human-readable element cards; keep raw JSON behind a debug details control.
- Preserve analysis while unrelated chat messages arrive.
- Invalidate analysis only when reference pixels or roles change.
- Invalidate target mapping when the venue photo changes.
- Preserve approved choices when the user only changes event text.
- Add “Refine this image” and send the selected generated image through the revision path.
- Explain that reference-only elements can appear in the visualization but are not included in the catalog quote.

Image preprocessing:

- Preserve orientation and aspect ratio.
- Increase reference-analysis quality from the current aggressive `1280 / JPEG 0.8` path when payload budget permits; target 1600–2048 px and high-quality JPEG/WebP.
- Do not stretch images.
- Record original and processed dimensions.
- Keep venue and reference preprocessing policies separate.

## 11. Visual QA

Create `src/lib/ia/image-qa.ts` and `scripts/eval-image-fidelity.ts`.

QA contract:

```json
{
  "required_elements": [
    { "element_id": "CURTAIN_01", "present": true, "placement_ok": true, "appearance_ok": true }
  ],
  "unexpected_elements": [],
  "venue_preservation": {
    "camera_ok": true,
    "architecture_ok": true,
    "outside_region_similarity": 0.98
  },
  "composition": {
    "layering_ok": true,
    "reference_relationships_ok": true
  },
  "integration": {
    "lighting_ok": true,
    "perspective_ok": true,
    "contact_shadows_ok": true,
    "pasted_artifacts": []
  },
  "pass": true,
  "retry_reasons": []
}
```

Use deterministic checks where possible and a vision-model evaluator only for semantic checks. A model-generated QA score must not be presented as certainty.

Automatic retry policy:

- Maximum one retry.
- Retry only for a small, actionable set: missing required element, unexpected decoration, major placement failure, major venue mutation, or obvious collage artifact.
- Build a short corrective prompt from failed checks.
- Do not add new design details during retry.
- If retry fails, return the better result with warnings rather than looping.

## 12. Tests

### 12.1 Unit tests

Add tests for:

- Blueprint v2 parsing and rejection of unknown/oversized fields.
- Stable element IDs and analysis cache invalidation.
- Color precedence.
- `reference_bbox` and `target_bbox` separation.
- Layer-cycle detection.
- Prompt output is English and deterministic.
- Positive prompt contains every approved required element.
- Negative prompt forbids unapproved and common hallucinated elements.
- Prompt contains no contradictory reference policy.
- Product wording prohibits source-background copying.
- Provider capability selection and input-budget ordering.
- Aspect padding/cropping transforms.
- Revision requests include the previous result.

### 12.2 API integration tests

Mock provider adapters and verify:

- Analysis occurs before generation.
- A detected curtain reaches the review response.
- A manually added curtain reaches `MUST INCLUDE` even if the analyzer missed it.
- `adapt_to_event_palette` changes the curtain's resolved color without changing its required status.
- An unapproved table or floral item never reaches the allowlist.
- Required references are never silently truncated.
- Changing the venue invalidates target boxes.
- Production generation rejects unvalidated v1 JSON.

### 12.3 End-to-end UI tests

Fixture scenario:

1. Upload reference containing balloons and a rear curtain.
2. Upload a venue photo.
3. Confirm curtain and choose a different color.
4. Drag composition to a valid wall region.
5. Generate.
6. Confirm UI shows QA result and reference-only disclaimer.
7. Refine the generated image and verify the previous result is used as edit base.

### 12.4 Visual regression set

Create a private, rights-cleared fixture set with at least:

- Five curtain/backdrop references with different colors and partial occlusion.
- Five venue photos with doors, windows, furniture, and restricted wall areas.
- Balloon arcs, garlands, panels, plinths, florals, and signage.
- At least three deliberate low-confidence cases.
- At least three cases where reference color must be adapted.

Record provider, exact model, prompt hash, schema version, scene-spec hash, latency, retry reason, and QA output. Do not commit customer photos or base64 payloads.

## 13. Acceptance Criteria

Use the regression set to establish the baseline first, then require:

1. Every visible curtain/backdrop in the curated set is either detected as a candidate or can be added manually before generation; no silent omission path remains.
2. A user can include a curtain while choosing reference color, event-palette adaptation, or custom color.
3. No generation starts with unresolved required-element decisions when references are present.
4. Generated prompt contains an exact allowlist of approved elements and an explicit forbidden list.
5. Reference-only elements never enter quote data without a real catalog match.
6. Venue camera/crop and architecture remain unchanged outside approved edit regions for mask-capable providers; define a provider-specific similarity threshold from baseline rather than one universal arbitrary number.
7. Required element centers fall inside their approved target boxes, with reasonable overlap tolerance for organic balloon edges and shadows.
8. No source-image borders, rectangular crops, halos, or source backgrounds appear in accepted outputs.
9. `16:9` venue inputs are never silently rendered as stretched or reinterpreted `3:2` scenes.
10. Revisions edit the selected generated result instead of restarting from the original inputs.
11. `npm run lint`, `npm run build`, new unit/integration tests, and the visual-evaluation script complete successfully.

## 14. Implementation Order

### Phase 0 — Baseline and safeguards

1. Read the repository `AGENTS.md` and the relevant Next.js 16 local guides before code changes:
   - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
   - `node_modules/next/dist/docs/01-app/01-getting-started/12-images.md`
2. Capture current prompts and outputs for the visual regression fixtures.
3. Add feature flags: `REFERENCE_BLUEPRINT_V2`, `IMAGE_QA_ENABLED`, and `LOCALIZED_EDIT_ENABLED`.

Exit: baseline report exists and old path still works when flags are off.

### Phase 1 — Schemas and prompt builder

1. Add blueprint v2 and scene-spec schemas.
2. Add merge, color-resolution, target-placement, and validation helpers.
3. Add pure English prompt builder and unit tests.
4. Add v1 fixture adapter for laboratory migration only.

Exit: prompt snapshots prove the curtain can be required while unapproved objects remain forbidden.

### Phase 2 — Analysis and review API

1. Split analysis from generation.
2. Implement inventory and audit passes.
3. Add prompt/schema version to cache keys.
4. Add API integration tests.

Exit: reference upload returns editable candidates without generating an image.

### Phase 3 — Review and placement UI

1. Add review cards, manual-element entry, color policies, and catalog/reference-only labels.
2. Add target placement overlay.
3. Pause automatic generation when review is required.
4. Build approved scene spec client-side, then validate/rebuild it server-side.

Exit: curtain can be detected or manually added, recolored, positioned, and approved.

### Phase 4 — Provider and localized-edit refactor

1. Add provider capability maps.
2. Change input roles and priority selection.
3. Migrate OpenAI default model and verify SDK fields.
4. Add mask-capable edit path and aspect transforms.
5. Add true revision input.

Exit: venue edits are localized, input roles are unambiguous, and revisions use the previous output.

### Phase 5 — QA and retry

1. Add deterministic outside-region comparison.
2. Add semantic visual QA.
3. Add single corrective retry.
4. Add telemetry without raw image logging.

Exit: failures are detected and surfaced; no unlimited retry loop exists.

### Phase 6 — Evaluation and rollout

1. Run both providers on the fixture set.
2. Compare v1 and v2 on detection, venue preservation, unwanted objects, placement, and collage artifacts.
3. Tune thresholds per provider/model.
4. Enable flags gradually and keep rollback path until v2 wins on acceptance metrics.
5. Remove v1 generation path only after successful rollout.

Exit: v2 meets acceptance criteria and has documented provider-specific limitations.

## 15. Non-Goals and Safety Rules

- Do not promise exact balloon counts from a generative image model; use approved ranges and validate visual density.
- Do not treat a generated visualization as an inventory guarantee.
- Do not quote reference-only elements.
- Do not log customer images, raw base64, or full unredacted prompts in production.
- Do not let user-supplied JSON bypass strict schemas or become system instructions.
- Do not solve venue preservation by merely repeating “keep everything unchanged” more times. Use target regions, masks where supported, coordinate transforms, and QA.
- Do not accept a visually attractive output when it violates the approved allowlist or venue constraints.

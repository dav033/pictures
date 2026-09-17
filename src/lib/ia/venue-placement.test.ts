import assert from "node:assert/strict";
import test from "node:test";
import type { VenueAnalysis } from "./analizar-venue";
import { placeStructuresInVenue, type VenuePlacementStructure } from "./venue-placement";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function venue(overrides: Partial<VenueAnalysis> = {}): VenueAnalysis {
  return {
    schema_version: "1.0",
    image_id: "VENUE_01",
    openings: [],
    flat_walls: [],
    floor_plane: {
      bbox: box(0, 0.52, 1, 0.48),
      polygon: [{ x: 0, y: 0.52 }, { x: 1, y: 0.52 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      wall_floor_line: { start: { x: 0, y: 0.6 }, end: { x: 1, y: 0.6 } },
      confidence: 1,
    },
    obstacles: [],
    eye_level: { y: 0.45, confidence: 1 },
    metric_anchors: [{ anchor_id: "door-1", kind: "door", bbox: box(0.1, 0.12, 0.2, 0.48), measurement_axis: "height", real_world_m: 2, confidence: 1 }],
    ...overrides,
  };
}

function structure(input: Partial<VenuePlacementStructure> & Pick<VenuePlacementStructure, "element_id" | "scene_role" | "category">): VenuePlacementStructure {
  return {
    element_id: input.element_id,
    scene_role: input.scene_role,
    category: input.category,
    reference_bbox: input.reference_bbox ?? box(0.1, 0.1, 0.2, 0.2),
    approved: true,
    include_policy: "include",
    visual_semantics: input.visual_semantics,
  };
}

function overlaps(a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean {
  return Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width)
    && Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height);
}

test("focal arch follows the best opening when the opening is on the right", () => {
  const analysis = venue({
    openings: [{ opening_id: "porch-right", kind: "porch", bbox: box(0.64, 0.14, 0.25, 0.46), frameable: true, confidence: 0.98 }],
  });
  const focal = structure({ element_id: "EST_01_ARCO", category: "balloon_structure", scene_role: "midground" });

  const placed = placeStructuresInVenue(analysis, [focal]);

  assert.ok(placed[focal.element_id]!.x > 0.5, "the focal box should be right of frame center");
  assert.ok(placed[focal.element_id]!.x < 0.8, "the focal box should frame the opening, not hug the edge");
});

test("without an opening the focal structure rests on the detected floor plane", () => {
  const focal = structure({ element_id: "EST_01_ARCO", category: "balloon_structure", scene_role: "midground" });

  const placed = placeStructuresInVenue(venue(), [focal]);
  const target = placed[focal.element_id]!;

  assert.ok(Math.abs(target.x + target.width / 2 - 0.5) < 0.01);
  assert.ok(Math.abs(target.y + target.height - 0.6) < 0.01, "the structure should contact the floor-wall line");
});

test("a lateral column moves to a safe flank instead of overlapping an obstacle", () => {
  const obstacle = box(0.52, 0.12, 0.2, 0.48);
  const analysis = venue({ obstacles: [{ obstacle_id: "right-column", kind: "column", bbox: obstacle, confidence: 1 }] });
  const column = structure({
    element_id: "EST_02_COL_DER",
    category: "balloon_structure",
    scene_role: "foreground",
    visual_semantics: {
      structure_type: "columna",
      placement: "lateral_derecho",
      design_role: "acento",
      repetition_group: "EST_02_COL_DER",
      dimensions_m: { width: 0.5, height: 2 },
      density: "media",
    },
  });

  const target = placeStructuresInVenue(analysis, [column])[column.element_id]!;

  assert.equal(overlaps(target, obstacle), false);
  assert.ok(target.x < obstacle.x || target.x > obstacle.x + obstacle.width, "the column should be relocated outside the obstacle");
});

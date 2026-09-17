import type { ReferenceElement, ReferenceBBox } from "./reference-blueprint";
import type { VenueAnalysis } from "./analizar-venue";

export type VenuePlacementStructure = Pick<ReferenceElement, "element_id" | "category" | "scene_role" | "reference_bbox" | "visual_semantics" | "approved" | "include_policy">;
export type PlacementBox = ReferenceBBox;

const MIN_BOX_SIZE = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBox(centerX: number, centerY: number, width: number, height: number): PlacementBox {
  const safeWidth = clamp(width, MIN_BOX_SIZE, 0.96);
  const safeHeight = clamp(height, MIN_BOX_SIZE, 0.96);
  return {
    x: clamp(centerX - safeWidth / 2, 0, 1 - safeWidth),
    y: clamp(centerY - safeHeight / 2, 0, 1 - safeHeight),
    width: safeWidth,
    height: safeHeight,
  };
}

function boxRight(box: PlacementBox): number {
  return box.x + box.width;
}

function boxBottom(box: PlacementBox): number {
  return box.y + box.height;
}

function boxCenterX(box: PlacementBox): number {
  return box.x + box.width / 2;
}

function overlaps(a: PlacementBox, b: PlacementBox): boolean {
  return Math.max(a.x, b.x) < Math.min(boxRight(a), boxRight(b))
    && Math.max(a.y, b.y) < Math.min(boxBottom(a), boxBottom(b));
}

function forbiddenBoxes(analysis: VenueAnalysis, occupied: PlacementBox[]): PlacementBox[] {
  return [...analysis.obstacles.map((obstacle) => obstacle.bbox), ...occupied];
}

function safeCandidate(candidates: PlacementBox[], forbidden: PlacementBox[], fallback: PlacementBox): PlacementBox {
  const firstSafe = candidates.find((candidate) => forbidden.every((item) => !overlaps(candidate, item)));
  if (firstSafe) return firstSafe;

  for (const scale of [0.85, 0.7, 0.55, 0.4, 0.25]) {
    const width = fallback.width * scale;
    const height = fallback.height * scale;
    for (let y = 0.04; y <= 0.94; y += 0.06) {
      for (let x = 0.04; x <= 0.94; x += 0.06) {
        const candidate = clampBox(x, y, width, height);
        if (forbidden.every((item) => !overlaps(candidate, item))) return candidate;
      }
    }
  }
  return fallback;
}

function metricScale(analysis: VenueAnalysis): number | undefined {
  const scales = analysis.metric_anchors
    .map((anchor) => (anchor.measurement_axis === "width" ? anchor.bbox.width : anchor.bbox.height) / anchor.real_world_m)
    .filter((scale) => Number.isFinite(scale) && scale > 0)
    .sort((a, b) => a - b);
  if (!scales.length) return undefined;
  return scales[Math.floor(scales.length / 2)];
}

function structureDimensions(structure: VenuePlacementStructure, scale: number | undefined, defaultWidth: number, defaultHeight: number): { width: number; height: number } {
  const dimensions = structure.visual_semantics?.dimensions_m;
  const height = dimensions?.height && scale ? dimensions.height * scale : defaultHeight;
  const width = dimensions?.width && scale ? dimensions.width * scale : defaultWidth;
  return { width: clamp(width, MIN_BOX_SIZE, 0.9), height: clamp(height, MIN_BOX_SIZE, 0.9) };
}

function isBackdrop(structure: VenuePlacementStructure): boolean {
  return structure.scene_role === "backdrop" || ["backdrop", "curtain", "drape", "panel"].includes(structure.category);
}

function isFocal(structure: VenuePlacementStructure): boolean {
  return structure.visual_semantics?.design_role === "focal" || structure.scene_role === "midground";
}

function requestedSide(structure: VenuePlacementStructure): "left" | "right" | undefined {
  const placement = structure.visual_semantics?.placement ?? "";
  if (placement.includes("izquierdo") || placement.includes("left")) return "left";
  if (placement.includes("derecho") || placement.includes("right")) return "right";
  return undefined;
}

function bestOpening(analysis: VenueAnalysis): VenueAnalysis["openings"][number] | undefined {
  return analysis.openings
    .filter((opening) => opening.frameable)
    .slice()
    .sort((a, b) => b.confidence * b.bbox.width * b.bbox.height - a.confidence * a.bbox.width * a.bbox.height)[0];
}

function bestWall(analysis: VenueAnalysis): VenueAnalysis["flat_walls"][number] | undefined {
  return analysis.flat_walls
    .filter((wall) => wall.suitable_for_backdrop)
    .slice()
    .sort((a, b) => b.confidence * b.bbox.width * b.bbox.height - a.confidence * a.bbox.width * a.bbox.height)[0];
}

function floorYAt(analysis: VenueAnalysis, x: number): number {
  const line = analysis.floor_plane.wall_floor_line;
  const deltaX = line.end.x - line.start.x;
  if (Math.abs(deltaX) < 0.001) return Math.max(line.start.y, line.end.y);
  const t = clamp((x - line.start.x) / deltaX, 0, 1);
  return line.start.y + (line.end.y - line.start.y) * t;
}

function floorBoxAt(analysis: VenueAnalysis, centerX: number, width: number, height: number): PlacementBox {
  const floorY = floorYAt(analysis, centerX);
  return clampBox(centerX, floorY - height / 2, width, height);
}

function openingBox(analysis: VenueAnalysis, structure: VenuePlacementStructure, opening: VenueAnalysis["openings"][number], scale: number | undefined): PlacementBox {
  const dimensions = structureDimensions(structure, scale, opening.bbox.width * 1.08, opening.bbox.height * 1.08);
  const width = Math.max(dimensions.width, opening.bbox.width * 1.08);
  const height = Math.max(dimensions.height, opening.bbox.height * 1.04);
  const bottom = boxBottom(opening.bbox);
  return clampBox(boxCenterX(opening.bbox), bottom - height / 2, width, height);
}

function sideCandidates(
  analysis: VenueAnalysis,
  structure: VenuePlacementStructure,
  anchorX: number,
  side: "left" | "right" | undefined,
  index: number,
  scale: number | undefined,
): PlacementBox[] {
  const dimensions = structureDimensions(structure, scale, 0.18, 0.44);
  const gap = 0.035 + index * 0.02;
  const leftCenter = anchorX - gap - dimensions.width / 2;
  const rightCenter = anchorX + gap + dimensions.width / 2;
  const alternatingSide = index % 2 === 0 ? "left" : "right";
  const preferred = side ?? alternatingSide;
  const centers = preferred === "left"
    ? [leftCenter, rightCenter, 0.14, 0.86, 0.3, 0.7]
    : [rightCenter, leftCenter, 0.86, 0.14, 0.7, 0.3];
  return centers.map((centerX) => floorBoxAt(analysis, centerX, dimensions.width, dimensions.height));
}

function backdropCandidates(analysis: VenueAnalysis, wall: VenueAnalysis["flat_walls"][number] | undefined, structure: VenuePlacementStructure, scale: number | undefined): PlacementBox[] {
  const region = wall?.bbox ?? { x: 0.08, y: 0.06, width: 0.84, height: 0.62 };
  const dimensions = structureDimensions(structure, scale, region.width * 0.9, region.height * 0.86);
  const width = Math.min(dimensions.width, region.width);
  const height = Math.min(dimensions.height, region.height);
  const centers = [
    region.x + region.width / 2,
    region.x + width / 2,
    region.x + region.width - width / 2,
  ];
  return centers.map((centerX) => clampBox(centerX, region.y + region.height / 2, width, height));
}

function floorCandidates(analysis: VenueAnalysis, structure: VenuePlacementStructure, index: number, scale: number | undefined, anchorX: number): PlacementBox[] {
  const dimensions = structureDimensions(structure, scale, 0.24, 0.34);
  const centers = [anchorX, 0.5, index % 2 === 0 ? 0.25 : 0.75, 0.15, 0.85];
  return centers.map((centerX) => floorBoxAt(analysis, centerX, dimensions.width, dimensions.height));
}

function placeFocal(analysis: VenueAnalysis, structure: VenuePlacementStructure, opening: VenueAnalysis["openings"][number] | undefined, scale: number | undefined, forbidden: PlacementBox[]): PlacementBox {
  if (opening) {
    const target = openingBox(analysis, structure, opening, scale);
    return safeCandidate([target, ...floorCandidates(analysis, structure, 0, scale, boxCenterX(opening.bbox))], forbidden, target);
  }
  const candidates = floorCandidates(analysis, structure, 0, scale, 0.5);
  return safeCandidate(candidates, forbidden, candidates[0]!);
}

function placeBackdrop(analysis: VenueAnalysis, structure: VenuePlacementStructure, wall: VenueAnalysis["flat_walls"][number] | undefined, scale: number | undefined, forbidden: PlacementBox[]): PlacementBox {
  const candidates = backdropCandidates(analysis, wall, structure, scale);
  return safeCandidate(candidates, forbidden, candidates[0]!);
}

/**
 * Purely maps approved scene structures onto normalized venue findings. It
 * never calls a provider and never reads process.env, HTTP, or the plan price.
 */
export function placeStructuresInVenue(analysis: VenueAnalysis, structures: readonly VenuePlacementStructure[]): Record<string, PlacementBox> {
  const scale = metricScale(analysis);
  const opening = bestOpening(analysis);
  const wall = bestWall(analysis);
  const boxes: Record<string, PlacementBox> = {};
  const occupied: PlacementBox[] = [];
  const focal = structures.find((structure) => !isBackdrop(structure) && isFocal(structure));
  const anchorX = opening ? boxCenterX(opening.bbox) : focal ? 0.5 : 0.5;

  for (const structure of structures) {
    if (!isBackdrop(structure)) continue;
    const box = placeBackdrop(analysis, structure, wall, scale, forbiddenBoxes(analysis, occupied));
    boxes[structure.element_id] = box;
  }

  let focalPlaced = false;
  let sideIndex = 0;
  for (const structure of structures) {
    if (isBackdrop(structure)) continue;
    const forbidden = forbiddenBoxes(analysis, occupied);
    if (!focalPlaced && focal?.element_id === structure.element_id) {
      const box = placeFocal(analysis, structure, opening, scale, forbidden);
      boxes[structure.element_id] = box;
      occupied.push(box);
      focalPlaced = true;
      continue;
    }

    const side = requestedSide(structure);
    const candidates = sideCandidates(analysis, structure, anchorX, side, sideIndex, scale);
    const fallback = candidates[0]!;
    const box = safeCandidate(candidates, forbidden, fallback);
    boxes[structure.element_id] = box;
    occupied.push(box);
    sideIndex += 1;
  }
  return boxes;
}

export function automaticTargetBox(element: VenuePlacementStructure, index: number, venue: boolean): PlacementBox {
  if (!venue) return element.reference_bbox;
  if (element.scene_role === "backdrop" || ["curtain", "drape"].includes(element.category)) return { x: 0.08, y: 0.04, width: 0.84, height: 0.82 };
  if (element.scene_role === "lighting") return { x: 0.12, y: 0.05, width: 0.76, height: 0.42 };
  if (element.scene_role === "midground" || element.category === "balloon_structure") {
    if (index === 0) return { x: 0.12, y: 0.12, width: 0.76, height: 0.5 };
    return index % 2 === 0
      ? { x: 0.08, y: 0.38, width: 0.3, height: 0.5 }
      : { x: 0.62, y: 0.38, width: 0.3, height: 0.5 };
  }
  if (element.scene_role === "foreground") return { x: 0.18, y: 0.56, width: 0.64, height: 0.34 };
  return { x: 0.08 + (index % 3) * 0.3, y: 0.16 + Math.floor(index / 3) * 0.25, width: 0.24, height: 0.28 };
}

export function targetBoxesFor(
  blueprint: { elements: readonly VenuePlacementStructure[] },
  supplied: Record<string, PlacementBox> | undefined,
  venue: boolean,
  venueAnalysis?: VenueAnalysis,
): Record<string, PlacementBox> {
  const boxes = { ...(supplied ?? {}) };
  const approved = blueprint.elements.filter((element) => element.approved && element.include_policy !== "exclude");
  if (!venue) {
    for (const element of approved) {
      if (!boxes[element.element_id]) boxes[element.element_id] = automaticTargetBox(element, approved.indexOf(element), false);
    }
    return boxes;
  }

  const placed = venueAnalysis ? placeStructuresInVenue(venueAnalysis, approved) : {};
  for (const [index, element] of approved.entries()) {
    if (placed[element.element_id]) boxes[element.element_id] = placed[element.element_id];
    else if (!boxes[element.element_id]) boxes[element.element_id] = automaticTargetBox(element, index, true);
  }
  return boxes;
}

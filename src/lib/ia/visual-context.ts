import type { Brief } from "@/lib/types";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";

export type VenueKind = "indoor" | "outdoor" | "unknown";
export type LightingKind = "day" | "afternoon" | "sunset" | "night" | "unspecified";

export type VisualContext = {
  userRequest?: string;
  eventType?: string;
  /** Open customer label. May be unknown to catalog taxonomy. */
  eventLabel?: string;
  venue?: string;
  venueKind: VenueKind;
  timeOfDay?: string;
  lightingKind: LightingKind;
  palette: string[];
  style?: string;
  dateOrSeason?: string;
  guestCount?: number;
  eventCue?: string;
  confirmedMotifs?: string[];
  pieceMatchLevels?: Array<{ piece: string; match_level: string }>;
  approvedPlan?: string[];
  approvedMaterials?: string[];
};

type VenuePattern = { pattern: RegExp; label: string; kind: VenueKind; cue: string };

const VENUE_PATTERNS: VenuePattern[] = [
  { pattern: /\bjardin\b/, label: "jard\u00edn", kind: "outdoor", cue: "outdoor garden setting with visible vegetation, garden ground, depth, and open sky" },
  { pattern: /\bplaya\b|\bbeach\b/, label: "playa", kind: "outdoor", cue: "recognizable beach setting with sand, shoreline, coastal depth, and open sky" },
  { pattern: /\bterraza\b|\brooftop\b/, label: "terraza", kind: "outdoor", cue: "recognizable open-air terrace with exterior depth, skyline or surrounding outdoor architecture" },
  { pattern: /\bpatio\b/, label: "patio", kind: "outdoor", cue: "recognizable open-air patio with exterior floor, surrounding architecture, and open sky" },
  { pattern: /\bparque\b|\bpark\b/, label: "parque", kind: "outdoor", cue: "recognizable outdoor park with vegetation, open ground, spatial depth, and open sky" },
  { pattern: /\bfinca\b|\bhacienda\b/, label: "hacienda", kind: "outdoor", cue: "recognizable hacienda or country-estate setting with characteristic architecture and exterior grounds" },
  { pattern: /\bsalon\b|\bballroom\b/, label: "sal\u00f3n", kind: "indoor", cue: "recognizable indoor event hall with real walls, ceiling, floor, architectural depth, and event lighting" },
  { pattern: /\bhotel\b/, label: "hotel", kind: "indoor", cue: "recognizable hotel event space with finished architecture, floor, walls, ceiling, and realistic depth" },
  { pattern: /\brestaurante\b|\brestaurant\b/, label: "restaurante", kind: "indoor", cue: "recognizable restaurant event space with real architecture, furnishings, and believable depth" },
  { pattern: /\bcasa\b|\bhogar\b|\bhome\b/, label: "casa", kind: "indoor", cue: "recognizable residential event space with real domestic architecture and believable scale" },
  { pattern: /\bapartamento\b|\bapartment\b/, label: "apartamento", kind: "indoor", cue: "recognizable apartment interior with real walls, floor, ceiling, and residential scale" },
  { pattern: /\boficina\b|\boffice\b/, label: "oficina", kind: "indoor", cue: "recognizable office environment with workplace architecture and believable spatial depth" },
  { pattern: /\binterior\b|\bindoor\b/, label: "interior", kind: "indoor", cue: "clearly indoor environment with real architecture, floor, walls, ceiling, and spatial depth" },
  { pattern: /\bexterior\b|\boutdoor\b|\bal aire libre\b/, label: "exterior", kind: "outdoor", cue: "clearly outdoor environment with open sky, exterior ground, surrounding context, and spatial depth" },
];

function clean(value: string | undefined, max = 500): string | undefined {
  const result = value?.trim().replace(/\s+/g, " ");
  return result ? result.slice(0, max) : undefined;
}

function normalized(value: string | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchVenue(value: string | undefined): VenuePattern | undefined {
  const text = normalized(value);
  return VENUE_PATTERNS.find((candidate) => candidate.pattern.test(text));
}

function extractVenueFromRequest(request: string | undefined): string | undefined {
  const known = matchVenue(request);
  if (known) return known.label;
  const source = clean(request);
  if (!source) return undefined;
  const match = source.match(/\ben\s+(?:un|una|el|la)?\s*([^,.;]+?)(?=\s+(?:de|por)\s+(?:la\s+)?(?:noche|d[i\u00ed]a|tarde|ma[\u00f1n]ana|atardecer)|$)/i);
  return clean(match?.[1], 100);
}

function detectTime(value: string): { timeOfDay?: string; lightingKind: LightingKind } {
  const text = normalized(value);
  if (/\b(noche|nocturn[oa]?|night|evening)\b/.test(text)) return { timeOfDay: "noche", lightingKind: "night" };
  if (/\b(atardecer|anochecer|sunset|dusk)\b/.test(text)) return { timeOfDay: "atardecer", lightingKind: "sunset" };
  if (/\b(tarde|afternoon)\b/.test(text)) return { timeOfDay: "tarde", lightingKind: "afternoon" };
  if (/\b(dia|diurn[oa]?|manana|morning|daytime)\b/.test(text)) return { timeOfDay: "d\u00eda", lightingKind: "day" };
  return { lightingKind: "unspecified" };
}

function detectEvent(value: string): { label?: string; cue?: string } {
  const text = normalized(value);
  if (/\bnavidad\b|\bchristmas\b/.test(text)) return { label: "Navidad", cue: "Christmas celebration atmosphere" };
  if (/\bhalloween\b/.test(text)) return { label: "Halloween", cue: "Halloween celebration atmosphere" };
  if (/\bboda\b|\bwedding\b/.test(text)) return { label: "Boda", cue: "wedding celebration atmosphere" };
  if (/\bcumpleanos\b|\bbirthday\b/.test(text)) return { label: "Cumplea\u00f1os", cue: "birthday celebration atmosphere" };
  if (/\bquince(?:\s+anos?|anos?|anera)?\b|\bxv\b/.test(text)) return { label: "Quincea\u00f1os", cue: "fifteenth-birthday celebration atmosphere" };
  if (/\bbaby shower\b/.test(text)) return { label: "Baby shower", cue: "baby shower celebration atmosphere" };
  if (/\bgraduacion\b|\bgraduation\b/.test(text)) return { label: "Graduaci\u00f3n", cue: "graduation celebration atmosphere" };
  return {};
}

function safeOpenEventCue(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const safe = label.replace(/[\r\n]/g, " ").trim().slice(0, 160);
  return safe
    ? `open event cue: express "${safe}" through the approved composition, palette, motifs, and lighting only; do not invent text, signage, or accessories`
    : undefined;
}

export function buildVisualContext(input: {
  brief?: Brief;
  userRequest?: string;
  eventLabel?: string;
  confirmedMotifs?: string[];
  pieceMatchLevels?: Array<{ piece: string; match_level: string }>;
  approvedPlan?: string[];
  approvedMaterials?: string[];
}): VisualContext {
  const brief = input.brief ?? {};
  const userRequest = clean(input.userRequest);
  const combinedRequest = [brief.tipo_evento, userRequest].filter(Boolean).join("; ");
  const detectedEvent = detectEvent(combinedRequest);
  const openEvent = parseEventSearchIntent(combinedRequest).event_label;
  const eventLabel = clean(input.eventLabel, 160) ?? clean(openEvent ?? undefined, 160) ?? clean(brief.tipo_evento, 160) ?? detectedEvent.label;
  const eventType = clean(brief.tipo_evento) ?? detectedEvent.label ?? eventLabel;
  const explicitVenue = clean(brief.espacio, 120);
  const venue = explicitVenue ?? extractVenueFromRequest(userRequest);
  const combined = [userRequest, eventType, venue, brief.momento_dia, brief.estilo, brief.fecha].filter(Boolean).join("; ");
  const explicitTime = clean(brief.momento_dia, 60);
  const detectedTime = detectTime(explicitTime ?? combined);
  const venueMatch = matchVenue(venue ?? userRequest);

  return {
    userRequest,
    eventType,
    eventLabel,
    venue,
    venueKind: venueMatch?.kind ?? "unknown",
    timeOfDay: explicitTime ?? detectedTime.timeOfDay,
    lightingKind: detectedTime.lightingKind,
    palette: (brief.colores ?? []).map((color) => clean(color, 60)).filter((color): color is string => Boolean(color)),
    style: clean(brief.estilo, 120),
    dateOrSeason: clean(brief.fecha, 120),
    guestCount: brief.invitados,
    eventCue: detectedEvent.cue ?? safeOpenEventCue(eventLabel),
    confirmedMotifs: (input.confirmedMotifs ?? []).map((motif) => clean(motif, 100)).filter((motif): motif is string => Boolean(motif)).slice(0, 12),
    pieceMatchLevels: (input.pieceMatchLevels ?? []).filter((item) => Boolean(item?.piece && item?.match_level)).slice(0, 40),
    approvedPlan: (input.approvedPlan ?? []).map((line) => clean(line, 180)).filter((line): line is string => Boolean(line)).slice(0, 40),
    approvedMaterials: (input.approvedMaterials ?? []).map((line) => clean(line, 180)).filter((line): line is string => Boolean(line)).slice(0, 80),
  };
}

export function buildPositiveEnvironmentCues(context: VisualContext): string[] {
  const cues: string[] = [];
  const venueMatch = matchVenue(context.venue);
  if (venueMatch) cues.push(venueMatch.cue);
  else if (context.venue) cues.push(`recognizable ${context.venue} environment with architecture, surfaces, scale, and spatial cues characteristic of that exact place`);
  else if (context.userRequest) cues.push("environment visibly matching the user's original request");

  if (context.lightingKind === "night") cues.push("unmistakable nighttime exposure with dark sky or dark exterior surroundings, visible practical event lighting, and controlled warm highlights");
  if (context.lightingKind === "sunset") cues.push("unmistakable sunset or dusk exposure with fading sky light and balanced event lighting");
  if (context.lightingKind === "afternoon") cues.push("afternoon ambient light consistent with the named venue");
  if (context.lightingKind === "day") cues.push("clear daytime ambient light consistent with the named venue");
  if (context.eventCue) cues.push(context.eventCue);
  return cues;
}

/**
 * English-only environment cues for the LoRA caption register. The general
 * image prompt may preserve an open customer label verbatim, but the LoRA was
 * trained on English captions, so unknown venue text and open event labels
 * must not be copied into its prompt.
 */
export function buildLoraEnvironmentCues(context: VisualContext): string[] {
  const cues: string[] = [];
  const venueMatch = matchVenue(context.venue);
  if (venueMatch) cues.push(venueMatch.cue);
  else if (context.venue) cues.push("recognizable event venue environment with real architecture, surfaces, scale, and spatial depth");

  if (context.lightingKind === "night") cues.push("unmistakable nighttime exposure with dark sky or dark exterior surroundings, visible practical event lighting, and controlled warm highlights");
  if (context.lightingKind === "sunset") cues.push("unmistakable sunset or dusk exposure with fading sky light and balanced event lighting");
  if (context.lightingKind === "afternoon") cues.push("afternoon ambient light consistent with the named venue");
  if (context.lightingKind === "day") cues.push("clear daytime ambient light consistent with the named venue");
  if (context.eventCue && !/^open event cue:/i.test(context.eventCue)) cues.push(context.eventCue);
  return cues;
}

export function buildVisualFailureConditions(context: VisualContext): string[] {
  const failures: string[] = [];
  if (context.venue) failures.push(`wrong venue or generic replacement venue instead of ${context.venue}`);
  if (context.venueKind === "outdoor") failures.push("indoor room, visible interior ceiling, studio wall, or enclosed catalog set");
  if (context.venueKind === "indoor") failures.push("unrequested outdoor landscape or open-air replacement venue");
  if (context.lightingKind === "night") failures.push("daylight, bright daytime windows, sunlit room, or daytime sky");
  if (context.lightingKind === "day") failures.push("nighttime darkness or nocturnal lighting");
  return failures;
}

export function buildVisualSceneLock(context: VisualContext): string {
  const lines = [
    context.userRequest ? `USER REQUEST VERBATIM: ${context.userRequest}` : undefined,
    context.eventLabel ? `EVENT LABEL (FREE TEXT): ${context.eventLabel}` : undefined,
    context.eventType ? `MANDATORY EVENT: ${context.eventType}` : undefined,
    context.venue ? `MANDATORY VENUE: ${context.venue}` : undefined,
    context.timeOfDay ? `MANDATORY TIME OF DAY: ${context.timeOfDay}` : undefined,
    context.style ? `STYLE: ${context.style}` : undefined,
    context.palette.length ? `PALETTE: ${context.palette.join(", ")}` : undefined,
    context.dateOrSeason ? `DATE OR SEASON: ${context.dateOrSeason}` : undefined,
    context.guestCount ? `GUEST COUNT: ${context.guestCount}` : undefined,
    context.confirmedMotifs?.length ? `CONFIRMED MOTIFS: ${context.confirmedMotifs.join(", ")}` : undefined,
    context.pieceMatchLevels?.length
      ? `PIECE MATCH LEVELS: ${context.pieceMatchLevels.map((item) => `${item.piece}=${item.match_level}`).join("; ")}`
      : undefined,
    context.approvedPlan?.length ? `APPROVED PLAN: ${context.approvedPlan.join("; ")}` : undefined,
    context.approvedMaterials?.length ? `APPROVED MATERIALS: ${context.approvedMaterials.join("; ")}` : undefined,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "No explicit scene context supplied.";
}

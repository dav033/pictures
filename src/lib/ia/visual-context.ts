import type { Brief } from "@/lib/types";
import type { PlanDecoracion } from "@/lib/plan/tipos";
import { parseEventSearchIntent } from "@/lib/rag/query-parser/event-search";
import { perfilCreatividad, type NivelCreatividad } from "./creatividad";

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

/** A place phrase never spans punctuation. */
const CLAUSE_SEPARATOR = /[,.;:!?\u00a1\u00bf()\n]+/;
/**
 * Every "en <determiner> <head> ..." of a clause. The phrase ends before the
 * next complement ("en", "para", "con", ...), a time ("de noche") or the clause
 * end, so "en la noche de gala en el club" yields both "noche de gala" and "club".
 */
const PLACE_PHRASE = /\ben\s+(?:el|la|los|las|un|una|unos|unas|mi|mis|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella)\s+(\S+(?:\s+\S+)*?)(?=\s+(?:en|para|con|porque|que|donde|y|pero)\s|\s+(?:de|por)\s+(?:la\s+)?(?:noche|d[i\u00ed]a|tarde|ma[\u00f1n]ana|atardecer)\b|\s*$)/gi;
/**
 * Heads that name a place where an event is held. A positive list: an open
 * complement with a determiner ("en el estilo boho", "en mi opinión") is not a
 * venue, and an unlisted place is not counted (the chat may then suggest one).
 */
const PLACE_HEAD = /^(?:piscina|iglesia|capilla|parroquia|catedral|templo|club|colegio|escuela|universidad|conjunto|edificio|urbanizacion|condominio|casa|apartamento|apto|finca|hacienda|quinta|granja|rancho|cabana|chalet|villa|hotel|restaurante|bar|discoteca|gastrobar|cafe|cafeteria|oficina|empresa|local|tienda|bodega|auditorio|teatro|gimnasio|coliseo|estadio|cancha|salon|sala|terraza|azotea|balcon|patio|jardin|parque|playa|lago|bosque|campo|mirador|hospital|clinica|carpa|kiosco|quiosco|sede|recinto)(?:s|es)?$/;

/** First place phrase of the request, without its determiner ("piscina del conjunto"). */
function findPlacePhrase(request: string | undefined): string | undefined {
  for (const clause of clean(request)?.split(CLAUSE_SEPARATOR) ?? []) {
    for (const match of clause.matchAll(PLACE_PHRASE)) {
      const phrase = clean(match[1], 100);
      const head = normalized(phrase?.split(" ")[0]);
      if (phrase && PLACE_HEAD.test(head)) return phrase;
    }
  }
  return undefined;
}

/**
 * The venue named in the request, read exactly as requestNamesVenue reads it.
 * A legacy fallback kept any "en <...>" tail verbatim, so "en blanco y dorado
 * con un arco" or "en la pared" became a MANDATORY VENUE of the image prompt
 * (2026-09-15 calibration, every default-level prompt of four plans).
 */
function extractVenueFromRequest(request: string | undefined): string | undefined {
  return matchVenue(request)?.label ?? findPlacePhrase(request);
}

/**
 * Whether the request names a place: a known venue, or an "en <determiner>
 * <place>" phrase in any clause. A bare complement ("en tonos pastel", "en
 * diciembre"), a spot, decoration, event or time ("en la entrada", "en la
 * fiesta", "en la noche") and an open complement ("en el estilo boho") are not
 * a venue. Bounded heuristic: a city without a determiner ("en Bogotá") and a
 * place outside PLACE_HEAD are not counted.
 */
function requestNamesVenue(request: string | undefined): boolean {
  return Boolean(matchVenue(request) || findPlacePhrase(request));
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

/**
 * Whether the customer already named a venue or a time of day, with the same
 * patterns the scene is built from. Creativity only fills what is left open.
 * The text/brief reading is shared by the chat (scene suggestion) and the
 * generation (completarEscenaConPlan). A venue photo is the venue and its
 * ambient light (the edit preserves both), so `fotoEspacio` specifies both
 * dimensions; the generation and the chat (sugerenciaEscenaDelTurno) both
 * pass it, so the chat never suggests a venue the generation would ignore.
 */
export function escenaEspecificada(
  texto: string | undefined,
  brief: Pick<Brief, "espacio" | "momento_dia"> = {},
  opciones: { fotoEspacio?: boolean } = {},
): { lugar: boolean; momento: boolean } {
  const foto = opciones.fotoEspacio === true;
  return {
    lugar: foto || Boolean(clean(brief.espacio)) || requestNamesVenue(texto),
    momento: foto || Boolean(clean(brief.momento_dia)) || detectTime(texto ?? "").lightingKind !== "unspecified",
  };
}

/** Scene fields of an approved plan; Plan 1.0 and 1.1 share them. */
export type EscenaDelPlan = {
  espacio: Pick<PlanDecoracion["espacio"], "tipo" | "fuente">;
  concepto: Pick<PlanDecoracion["concepto"], "momento_dia">;
};

/**
 * Completes the brief with the venue and time of day recorded in the approved
 * plan, only for the dimension the customer left open. "Specified" is read with
 * the same fields buildVisualContext reads, so anything the customer said (in
 * the brief or in the request) keeps winning over the plan.
 *
 * - `espacio.fuente === "cliente"` is the customer's own statement (maybe from
 *   an earlier chat turn missing from this request) and applies at every level.
 * - An assumed venue ("supuesto", or "foto": inferred from an attached image
 *   that may be an inspiration reference) and `momento_dia` (no provenance)
 *   apply only at levels whose design rule tells the chat to fill the scene,
 *   read from the creativity table exactly as the chat reads it
 *   (prompt-sistema.ts bloqueCreatividad: no design rule, no scene rule). The
 *   default level gives the chat no scene rule and does not show the plan scene
 *   to the customer, so its forced guess keeps the pre-calibration prompt.
 * - With a venue photo (`fotoEspacio`) the photo is the venue and its light:
 *   the plan never forces a place or a time on it.
 *
 * Known limitation: `nivel` is the slider value when generating, not the level
 * the plan was designed with; the signed approval context (plan/aprobacion.ts)
 * does not record it. Remove this note once the approval context carries the
 * design level and /api/generate passes that instead.
 */
export function completarEscenaConPlan(input: {
  brief?: Brief;
  userRequest?: string;
  plan?: EscenaDelPlan;
  nivel: NivelCreatividad;
  fotoEspacio?: boolean;
}): Brief | undefined {
  if (!input.plan) return input.brief;
  const brief = input.brief ?? {};
  const completaEscena = perfilCreatividad(input.nivel).instruccionDiseno !== "";
  const { espacio, concepto } = input.plan;
  const lugar = clean(espacio.tipo, 120);
  const momento = clean(concepto.momento_dia, 60);
  const opciones = { fotoEspacio: input.fotoEspacio };
  const lugarDelCliente = escenaEspecificada(input.userRequest, brief, opciones).lugar;
  const momentoDelCliente = escenaEspecificada([input.userRequest, brief.tipo_evento, brief.espacio, brief.estilo, brief.fecha].filter(Boolean).join("; "), brief, opciones).momento;
  return {
    ...brief,
    ...(lugar && !lugarDelCliente && (espacio.fuente === "cliente" || completaEscena) ? { espacio: lugar } : {}),
    ...(momento && !momentoDelCliente && completaEscena ? { momento_dia: momento } : {}),
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

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Herramienta, LlamadaHerramienta } from "@/lib/ia/nucleo/tipos";
import { ADVISOR_ESTIMATE_NOTICE, EventBriefSchema, type EventBriefState, parseEventBriefState } from "./contracts";
import { calculateBriefProgress, calculateStateProgress } from "./progress";
import type { PhotoPreference } from "./repository";
import { ADVISOR_DIRECTIONS_ENABLED, ADVISOR_STANDARD_PACKAGES_ENABLED } from "./features";
import { buildCustomPackage, MAX_CUSTOM_ITEMS } from "./custom-package";
import { ADVISOR_DIRECTION_IDS, getDirectionOffers, isOfferedDirection, parseStoredDirectionOffers } from "./directions";
import type { DirectionOffer } from "./directions-contract";
import type { HappiaCatalogueResult } from "./catalogue";
import { packageCard, proposeStandardPackage } from "./packages";
import { customerEvidence, keepWithEvidence, KeepItemSchema, MAX_KEEP_ITEMS, PhotoReadingSchema, type PhotoReading } from "./photo-evidence";
import { appendBriefChanges, budgetDisplay, diffBrief, EVENT_KIND_LABELS, formatBriefChange, PRIORITY_LABELS, sameFact } from "./brief-changes";

const fieldNames = Object.keys(EventBriefSchema.shape).filter((key) => key !== "contactPermission" && key !== "addressPermission" && key !== "proposedPackage");
const fieldsSchema = EventBriefSchema.partial().omit({ contactPermission: true, addressPermission: true, proposedPackage: true }).strict();
const summaryArgsSchema = z.object({}).strict();
const approvalArgsSchema = z.object({ summaryVersion: z.number().int().positive() }).strict();
const noArgsSchema = z.object({}).strict();
const customPackageArgsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  items: z.array(z.object({ serviceId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(60).optional() }).strict()).min(1).max(MAX_CUSTOM_ITEMS),
}).strict();
const directionArgsSchema = z.object({ directionId: z.string().refine(isOfferedDirection) }).strict();
const photoFeedbackSchema = z.object({ attachmentId: z.string().min(1).max(100), confirmed: z.boolean(), preference: z.enum(["like", "dislike", "neutral"]), keep: z.array(KeepItemSchema).max(MAX_KEEP_ITEMS).optional() }).strict();
const photoReadingArgsSchema = PhotoReadingSchema.extend({ attachmentId: z.string().min(1).max(100) }).strict();
const fieldPropertySchema = (field: string): Record<string, unknown> => {
  if (field === "venueType") return { type: "string", description: "Tipo de lugar indicado por el cliente: salón, casa, restaurante, jardín, colegio, etc. En 'salón Casa Jardín', guarda salón aquí y Casa Jardín en venueName." };
  if (field === "venueName") return { type: "string", description: "Nombre propio del lugar; no sustituye venueType. Guarda también el tipo de lugar cuando el cliente lo haya indicado." };
  if (field === "venueUndecided") return { type: "boolean", description: "true cuando el cliente aún no sabe o no está seguro de dónde será el evento; entonces no se pide dirección." };
  if (field === "budgetUndisclosed") return { type: "boolean", description: "true cuando el cliente prefiere no decir el presupuesto; no vuelvas a preguntarlo." };
  if (field === "venueSearch") return { type: "string", description: "Qué lugar buscaría si aún no lo tiene: tipo (salón, finca, al aire libre), zona o barrio y capacidad. Se le pasa a Happia para ayudar a buscar el lugar; no hay búsqueda automática." };
  if (field === "story") return { type: "string", description: "Por qué es especial esta celebración para quien organiza, en sus palabras." };
  if (field === "budgetRange") return { type: "string", description: "Rango de presupuesto cuando el cliente da un rango y no un monto, por ejemplo: Hasta $300.000." };
  if (field === "brandRequests") return { type: "string", description: "Marcas o proveedores que el cliente pide expresamente." };
  if (field === "eventKind") return { type: "string", enum: ["birthday", "corporate", "school", "wedding", "social", "other"] };
  if (field === "organiserPriority") return { type: "string", enum: ["impress", "personalise", "simple", "best_price"] };
  if (["guestCount", "honoreeAge"].includes(field)) return { type: "integer", minimum: field === "guestCount" ? 1 : 0 };
  if (field === "budget") return { type: "number", minimum: 0 };
  if (field === "colors") return { type: "array", items: { type: "string" } };
  if (field === "contactEmail") return { type: "string", format: "email" };
  return { type: "string" };
};

export const ADVISOR_TOOLS: Herramienta[] = [
  { nombre: "save_event_fields", descripcion: "Guarda campos de evento indicados explícitamente por el cliente.", esquema: { type: "object", additionalProperties: false, properties: Object.fromEntries(fieldNames.map((key) => [key, fieldPropertySchema(key)])) } },
  { nombre: "propose_summary", descripcion: "Solicita al servidor crear el resumen si el brief está completo.", esquema: { type: "object", additionalProperties: false, properties: {} } },
  { nombre: "approve_summary", descripcion: "Registra aprobación del resumen vigente; requiere confirmación explícita del cliente.", esquema: { type: "object", additionalProperties: false, required: ["summaryVersion"], properties: { summaryVersion: { type: "integer", minimum: 1 } } } },
  { nombre: "record_photo_reading", descripcion: "Guarda tu primera lectura estructurada de una foto del cliente (estilo, colores y elementos que ves) para que él la confirme. Úsala en la primera respuesta tras recibir la foto, con los IDs del contexto; describe solo lo que ves en la imagen.", esquema: { type: "object", additionalProperties: false, required: ["attachmentId", "style", "colors", "elements"], properties: { attachmentId: { type: "string" }, style: { type: "string", description: "Estilo general en pocas palabras, por ejemplo «arco orgánico de globos, clásico y sobrio»." }, colors: { type: "array", maxItems: 6, items: { type: "string" }, description: "Nombres de los colores principales." }, elements: { type: "array", maxItems: 8, items: { type: "string" }, description: "Elementos decorativos que se ven: arco, guirnalda, columna, mesa de dulces…" } } } },
  { nombre: "record_photo_feedback", descripcion: "Registra por attachmentId lo que el cliente dijo en SU ÚLTIMO MENSAJE sobre una foto: si confirmó tu lectura, si le gusta o le disgusta y qué quiere conservar sí o sí (keep). El servidor solo guarda lo que ese mensaje respalda; no atribuyas a otra imagen ni inventes. Usa los IDs disponibles en el contexto.", esquema: { type: "object", additionalProperties: false, required: ["attachmentId", "confirmed", "preference"], properties: { attachmentId: { type: "string" }, confirmed: { type: "boolean" }, preference: { type: "string", enum: ["like", "dislike", "neutral"] }, keep: { type: "array", maxItems: MAX_KEEP_ITEMS, items: { type: "string" }, description: "Lo que el cliente quiere conservar sí o sí de esta foto, con sus palabras (ej. «el arco blanco y negro»)." } } } },
  { nombre: "show_directions", descripcion: "Muestra las doce direcciones visuales permitidas y sus artículos temáticos verificados; úsala cuando el cliente aún no decide.", esquema: { type: "object", additionalProperties: false, properties: {} } },
  { nombre: "select_direction", descripcion: "Registra una dirección que el cliente eligió entre las que ya se le mostraron.", esquema: { type: "object", additionalProperties: false, required: ["directionId"], properties: { directionId: { type: "string", enum: ADVISOR_DIRECTION_IDS } } } },
  { nombre: "propose_standard_package", descripcion: "Pide al servidor el paquete estándar de Happia que mejor encaja con tipo de evento, temática, ciudad e invitados. Úsalo antes de ofrecer servicios a medida. El servidor devuelve el paquete, su estimado en COP y avisos; no indiques IDs ni precios.", esquema: { type: "object", additionalProperties: false, properties: {} } },
  { nombre: "propose_custom_package", descripcion: "Arma una propuesta a medida con servicios individuales del «Catálogo de Happia» de la ciudad del evento. Pasa solo los id del catálogo que te dio el servidor y, para los servicios por unidad, la cantidad; el servidor valida cada servicio, fija las cantidades por persona y calcula los precios y el total. Si algún id no existe, no se arma nada.", esquema: { type: "object", additionalProperties: false, required: ["items"], properties: { name: { type: "string", description: "Nombre corto de la propuesta, por ejemplo «Fiesta de fútbol de David»." }, items: { type: "array", minItems: 1, maxItems: MAX_CUSTOM_ITEMS, items: { type: "object", additionalProperties: false, required: ["serviceId"], properties: { serviceId: { type: "string", description: "Identificador (id=...) del servicio en el catálogo." }, quantity: { type: "integer", minimum: 1, description: "Unidades, solo para servicios por unidad; los servicios por persona usan los invitados." } } } } } } },
];

const RETIRED_TOOLS: ReadonlySet<string> = new Set([
  ...(ADVISOR_DIRECTIONS_ENABLED ? [] : ["show_directions", "select_direction"]),
  ...(ADVISOR_STANDARD_PACKAGES_ENABLED ? [] : ["propose_standard_package"]),
]);
/** What the model is offered: tools of switched-off features (inspiration gallery, closed packages) are not declared. */
export const ADVISOR_MODEL_TOOLS: Herramienta[] = ADVISOR_TOOLS.filter((tool) => !RETIRED_TOOLS.has(tool.nombre));

export type AdvisorToolEffect = { event: "tool"; name: string; result: unknown; state: EventBriefState; progress: ReturnType<typeof calculateBriefProgress> };
export type BriefMutator = (mutate: (state: unknown, version: number) => unknown) => Promise<{ version: number; state: unknown }>;

const CUSTOMER_APPROVAL = /\b(?:apruebo|confirmo|acepto)\s+(?:(?:el|la|este|esta)\s+)?(?:resumen|propuesta)\b|\bestoy de acuerdo con (?:el )?(?:resumen|propuesta)\b|\bdoy mi aprobaci[oó]n (?:al|a la) (?:resumen|propuesta)\b/i;
const CUSTOMER_REJECTION = /\bno (?:apruebo|confirmo|acepto|estoy de acuerdo)\b/i;
const CUSTOMER_CONTACT_CONSENT = /\b(?:autorizo (?:que me contacten|el contacto)|pueden contactarme|acepto que me contacten)\b/i;
const CUSTOMER_ADDRESS_CONSENT = /\b(?:autorizo (?:usar|compartir) (?:mi )?(?:direcci[oó]n|ubicaci[oó]n)|pueden usar mi direcci[oó]n)\b/i;
const packageCopFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function packageSummaryLines(proposal: EventBriefState["standardPackage"]): string[] {
  if (!proposal) return [];
  if (proposal.kind === "custom") {
    const total = proposal.estimate.status === "available" && proposal.estimate.subtotalCop !== null ? packageCopFormat.format(proposal.estimate.subtotalCop) : "no disponible";
    return [
      `Propuesta a medida: ${proposal.name}`,
      ...proposal.lines.map((line) => `• ${line.name} (${line.provider}) x${line.quantity}${line.basis === "per_person" ? " invitados" : ""}: ${packageCopFormat.format(line.subtotalCop)}`),
      `Total de referencia (no es una cotización): ${total} COP antes de IVA y comisión`,
      ...proposal.disclosures.map((disclosure) => `Aviso de la propuesta: ${disclosure}`),
    ];
  }
  const { estimate } = proposal;
  const source = estimate.source === "seeded_last_good" ? "Último catálogo verificado" : "Catálogo Happia";
  const price = estimate.status === "available" && estimate.subtotalCop !== null
    ? `${packageCopFormat.format(estimate.subtotalCop)} COP antes de IVA y comisión`
    : "no disponible";
  const freshness = estimate.fetchedAt
    ? `${estimate.fetchedAt} · antigüedad: ${estimate.snapshotAgeSeconds === null ? "desconocida" : `${estimate.snapshotAgeSeconds} segundos`}`
    : "fecha de consulta no disponible";
  return [
    `Paquete estándar: ${proposal.name}`,
    `Precio de referencia del paquete (no es una cotización): ${price}`,
    `Fuente del estimado: ${source}`,
    `Actualidad del catálogo: ${freshness}`,
    ...proposal.disclosures.map((disclosure) => `Aviso del paquete: ${disclosure}`),
  ];
}

export function customerConsent(text: string): { contact: boolean; address: boolean; refusedContact: boolean; refusedAddress: boolean } {
  return {
    contact: CUSTOMER_CONTACT_CONSENT.test(text), address: CUSTOMER_ADDRESS_CONSENT.test(text),
    refusedContact: /\b(?:no (?:quiero|autorizo|acepto) que me contacten|no autorizo compartir (?:mi )?(?:direcci[oó]n|ubicaci[oó]n) ni que me contacten|no (?:quiero|autorizo|acepto|autorizo compartir|comparto) (?:el contacto|mi contacto|mis datos de contacto|mi (?:tel[eé]fono|correo))|prefiero no (?:dar|compartir) (?:mi )?(?:contacto|tel[eé]fono|correo)(?: ni (?:mi )?(?:tel[eé]fono|correo))?|no autorizo (?:a )?(?:compartir|usar) (?:mi )?contacto)\b/i.test(text),
    refusedAddress: /\b(?:no (?:quiero|autorizo|acepto|comparto) (?:dar|compartir|usar)? ?(?:(?:mi|la|el) )?(?:direcci[oó]n|ubicaci[oó]n)|prefiero no (?:dar|compartir) (?:(?:mi|la|el) )?(?:direcci[oó]n|ubicaci[oó]n))\b/i.test(text),
  };
}

export function applyCustomerConsentToState(state: EventBriefState, text: string): EventBriefState {
  const consent = customerConsent(text);
  const previousContact = state.brief.contactPermission;
  const previousAddress = state.brief.addressPermission;
  const previousRefusedContact = state.refused.contact;
  const previousRefusedAddress = state.refused.address;
  if (consent.refusedContact) { state.refused.contact = true; state.brief.contactPermission = false; }
  if (consent.refusedAddress) { state.refused.address = true; state.brief.addressPermission = false; }
  if (consent.contact && !state.refused.contact) state.brief.contactPermission = true;
  if (consent.address && !state.refused.address) state.brief.addressPermission = true;
  if (previousContact !== state.brief.contactPermission || previousAddress !== state.brief.addressPermission
    || previousRefusedContact !== state.refused.contact || previousRefusedAddress !== state.refused.address) {
    state.summary = null;
    state.approval = null;
  }
  return state;
}

export async function applyAdvisorTool(input: {
  call: LlamadaHerramienta;
  operationId: string;
  currentCustomerText: string;
  mutateBrief: BriefMutator;
  loadDirectionOffers?: () => Promise<DirectionOffer[]>;
  loadCatalogue?: () => Promise<HappiaCatalogueResult>;
  photoIds?: ReadonlySet<string>;
  /** `null` leaves that part as it was; `keep` replaces the list when given. */
  savePhotoFeedback?: (attachmentId: string, confirmed: boolean | null, preference: PhotoPreference | null, keep?: string[]) => Promise<boolean>;
  savePhotoReading?: (attachmentId: string, reading: PhotoReading) => Promise<boolean>;
  now?: () => Date;
  /** The customer turn this tool runs in; links recorded changes to that turn's reply. */
  turnId?: string | null;
}): Promise<AdvisorToolEffect> {
  const { call, currentCustomerText } = input;
  let catalogue: HappiaCatalogueResult = { status: "unavailable", reason: "request_failed" };
  let packageCardValue: unknown;
  const customArgs = call.nombre === "propose_custom_package" ? customPackageArgsSchema.safeParse(call.args) : null;
  if ((call.nombre === "propose_standard_package" && summaryArgsSchema.safeParse(call.args).success) || customArgs?.success) {
    try { catalogue = await (input.loadCatalogue ?? (async () => (await import("./catalogue")).getHappiaCatalogue()))(); } catch { /* Explicit no-match below; never invent a catalogue result. */ }
  }
  const argsHash = createHash("sha256").update(JSON.stringify(call.args)).digest("hex");
  let message = "";
  let recordReceipt = true;
  let directionOffers: DirectionOffer[] | null = null;
  if (call.nombre === "show_directions" && noArgsSchema.safeParse(call.args).success) {
    try {
      if (input.loadDirectionOffers) directionOffers = await input.loadDirectionOffers();
      else {
        const catalogueModule = await import("./catalogue");
        directionOffers = getDirectionOffers(await catalogueModule.getHappiaCatalogue());
      }
    } catch {
      const unavailable: HappiaCatalogueResult = { status: "unavailable", reason: "request_failed" };
      directionOffers = getDirectionOffers(unavailable);
    }
  }
  const result = await input.mutateBrief((raw, version) => {
    const state = parseEventBriefState(raw);
    const receipt = state.toolReceipts[input.operationId];
    if (receipt) {
      const matchingReceipt = receipt.name === call.nombre && receipt.argsHash === argsHash;
      message = matchingReceipt
        ? receipt.message
        : "Este turno ya aplicó una herramienta diferente en este paso. Se conserva el cambio anterior; inicia un turno nuevo para continuar.";
      if (matchingReceipt && (call.nombre === "propose_standard_package" || call.nombre === "propose_custom_package") && state.standardPackage) packageCardValue = packageCard(state.standardPackage);
      return state;
    }
    if ((call.nombre === "propose_summary" && !summaryArgsSchema.safeParse(call.args).success)
      || ((call.nombre === "approve_summary") && !approvalArgsSchema.safeParse(call.args).success)
      || ((call.nombre === "propose_standard_package") && !summaryArgsSchema.safeParse(call.args).success)
      || (call.nombre === "propose_custom_package" && !customArgs?.success)
      || (call.nombre === "record_photo_feedback" && !photoFeedbackSchema.safeParse(call.args).success)
      || (call.nombre === "record_photo_reading" && !photoReadingArgsSchema.safeParse(call.args).success)
      || (call.nombre === "show_directions" && !noArgsSchema.safeParse(call.args).success)
      || (call.nombre === "select_direction" && !directionArgsSchema.safeParse(call.args).success)) {
      message = "Los argumentos de la herramienta no son válidos; no se aplicó ningún cambio.";
      return state;
    }
    applyCustomerConsentToState(state, currentCustomerText);

    if (call.nombre === "save_event_fields") {
      const patch = fieldsSchema.safeParse(call.args);
      if (!patch.success) { message = "Los campos recibidos no son válidos; pide al cliente que aclare el dato."; return state; }
      // Zod defaults on omitted properties must not overwrite existing values in a partial update.
      const suppliedFields = Object.fromEntries(Object.keys(call.args).map((field) => [field, Reflect.get(patch.data, field)]));
      const updated = EventBriefSchema.safeParse({ ...state.brief, ...suppliedFields });
      if (!updated.success) { message = "No fue posible guardar esos campos; solicita una aclaración."; return state; }
      const fitChanged = (["eventKind", "theme", "city", "guestCount"] as const).some((field) => updated.data[field] !== state.brief[field]);
      // An amount and a band are two ways to say one budget: the newest wins and the other is cleared (the summary would show the old one).
      const supplied = new Set(Object.keys(call.args));
      if (supplied.has("budget") && updated.data.budget !== null && !supplied.has("budgetRange")) updated.data.budgetRange = null;
      if (supplied.has("budgetRange") && updated.data.budgetRange && !supplied.has("budget")) updated.data.budget = null;
      if (updated.data.budget !== null || updated.data.budgetRange) updated.data.budgetUndisclosed = false;
      // The same range or amount worded differently keeps the first wording (a quick-pick chip's exact text).
      if (state.brief.budgetRange && updated.data.budgetRange && sameFact(state.brief.budgetRange, updated.data.budgetRange)) updated.data.budgetRange = state.brief.budgetRange;
      state.changes = appendBriefChanges(state.changes, diffBrief(state.brief, updated.data, input.turnId ?? null));
      state.brief = updated.data;
      if (fitChanged && state.standardPackage) { state.standardPackage = null; state.brief.proposedPackage = null; }
      state.summary = null;
      state.approval = null;
      message = "Campos guardados. El resumen y la aprobación anteriores quedaron invalidados.";
    } else if (call.nombre === "show_directions") {
      const validatedOffers = parseStoredDirectionOffers(directionOffers);
      if (!validatedOffers) {
        message = "No están disponibles las direcciones en este momento.";
        return state;
      }
      state.directionOffers = validatedOffers;
      message = "Direcciones verificadas para mostrar al cliente.";
    } else if (call.nombre === "select_direction") {
      const directionId = call.args.directionId;
      if (!isOfferedDirection(directionId) || !state.directionOffers.some(({ id }) => id === directionId)
        || !currentCustomerText.includes(directionId)) {
        message = "La dirección no se ha ofrecido o el cliente no la seleccionó explícitamente.";
        return state;
      }
      state.selectedDirectionId = directionId;
      message = "Dirección elegida; los demás datos del evento se conservaron.";
    } else if (call.nombre === "propose_standard_package") {
      const outcome = proposeStandardPackage(catalogue, state.brief);
      if (outcome.status === "no_match") {
        state.standardPackage = null;
        state.brief.proposedPackage = null;
        state.summary = null;
        state.approval = null;
        message = outcome.reason === "catalogue_unavailable"
          ? "No hay catálogo de paquetes disponible ahora; no ofrezcas un paquete estándar ni inventes precios."
          : "No hay un paquete estándar de Happia que encaje con este evento; continúa con servicios a medida sin inventar paquetes.";
      } else {
        state.standardPackage = outcome.proposal;
        state.brief.proposedPackage = `${outcome.proposal.name} (${outcome.proposal.packageId})`;
        packageCardValue = outcome.card;
        state.summary = null;
        state.approval = null;
        const estimate = outcome.proposal.estimate;
        message = `Paquete estándar propuesto: ${outcome.proposal.name}. ${estimate.status === "available" ? `Estimado ${estimate.subtotalCop} COP antes de IVA y comisión.` : "Precio estimado no disponible."} ${ADVISOR_ESTIMATE_NOTICE} ${outcome.proposal.disclosures.join(" ")}`;
      }
    } else if (call.nombre === "propose_custom_package" && customArgs?.success) {
      const outcome = buildCustomPackage(catalogue, state.brief, customArgs.data);
      if (outcome.status === "rejected") { message = outcome.reason; return state; }
      state.standardPackage = outcome.proposal;
      state.brief.proposedPackage = `${outcome.proposal.name} (propuesta a medida)`;
      packageCardValue = outcome.card;
      state.summary = null;
      state.approval = null;
      const total = outcome.proposal.estimate.subtotalCop;
      message = `Propuesta a medida armada: ${outcome.proposal.name}. Servicios: ${outcome.proposal.lines.map((line) => `${line.name} x${line.quantity} = ${line.subtotalCop} COP`).join("; ")}. Total de referencia ${total} COP antes de IVA y comisión. ${ADVISOR_ESTIMATE_NOTICE} Avisos: ${outcome.proposal.disclosures.join(" ")} Preséntala al cliente con esos servicios y precios exactos; no agregues nada más.`;
    } else if (call.nombre === "propose_summary") {
      const progress = calculateStateProgress(state);
      if (!progress.complete) { message = `Faltan campos obligatorios: ${progress.missing.join(", ")}.`; return state; }
      const summaryVersion = state.summarySequence + 1;
      const safeBrief = { ...state.brief,
        address: state.brief.addressPermission && !state.refused.address ? state.brief.address : null,
        contactName: state.brief.contactPermission && !state.refused.contact ? state.brief.contactName : null,
        contactPhone: state.brief.contactPermission && !state.refused.contact ? state.brief.contactPhone : null,
        contactEmail: state.brief.contactPermission && !state.refused.contact ? state.brief.contactEmail : null,
      };
      const summaryLines = [
        `Evento: ${safeBrief.eventName ?? (safeBrief.eventKind ? EVENT_KIND_LABELS[safeBrief.eventKind] : "sin especificar")}`,
        safeBrief.honoreeName ? `Homenajeado/a: ${safeBrief.honoreeName}` : null,
        safeBrief.story ? `Por qué es especial: ${safeBrief.story}` : null,
        `Fecha: ${safeBrief.date ?? "sin especificar"}`,
        safeBrief.startTime || safeBrief.endTime ? `Horario: ${[safeBrief.startTime, safeBrief.endTime].filter(Boolean).join("–")}` : null,
        `Invitados: ${safeBrief.guestCount ?? "sin especificar"}`,
        safeBrief.venueUndecided
          ? `Lugar: por definir en ${safeBrief.city ?? "ciudad sin especificar"}${safeBrief.venueSearch ? ` · busca: ${safeBrief.venueSearch}` : ""}`
          : `Lugar: ${[safeBrief.venueName, safeBrief.venueType, safeBrief.city].filter(Boolean).join(", ") || "sin especificar"}`,
        safeBrief.department ? `Departamento: ${safeBrief.department}` : null,
        `Presupuesto: ${budgetDisplay(safeBrief) ?? "sin especificar"}`,
        safeBrief.companyName ? `Empresa: ${safeBrief.companyName}` : null,
        safeBrief.schoolName ? `Institución educativa: ${safeBrief.schoolName}${safeBrief.grade ? `, ${safeBrief.grade}` : ""}` : null,
        safeBrief.theme ? `Tema: ${safeBrief.theme}` : null,
        safeBrief.colors.length ? `Colores: ${safeBrief.colors.join(", ")}` : null,
        safeBrief.style ? `Estilo: ${safeBrief.style}` : null,
        safeBrief.organiserPriority ? `Lo más importante: ${PRIORITY_LABELS[safeBrief.organiserPriority]}` : null,
        safeBrief.likes ? `Le gusta: ${safeBrief.likes}` : null,
        safeBrief.dislikes ? `No le gusta: ${safeBrief.dislikes}` : null,
        safeBrief.brandRequests ? `Marcas o proveedores: ${safeBrief.brandRequests}` : null,
        state.standardPackage ? null : safeBrief.proposedPackage ? `Paquete propuesto: ${safeBrief.proposedPackage}` : null,
        ...packageSummaryLines(state.standardPackage),
        safeBrief.notes ? `Notas: ${safeBrief.notes}` : null,
        safeBrief.address ? `Dirección autorizada: ${safeBrief.address}` : null,
        safeBrief.contactName ? `Contacto autorizado: ${safeBrief.contactName}` : null,
        safeBrief.contactPhone ? `Teléfono autorizado: ${safeBrief.contactPhone}` : null,
        safeBrief.contactEmail ? `Correo autorizado: ${safeBrief.contactEmail}` : null,
        ...state.changes.filter((change) => !["contactName", "contactPhone", "contactEmail", "address"].includes(change.field))
          .map((change) => `Cambio: ${formatBriefChange(change)}${change.impact ? ` (${change.impact})` : ""}`),
      ].filter((line): line is string => line !== null);
      state.summary = { version: summaryVersion, briefVersion: version + 1, text: summaryLines.join("\n") };
      state.summarySequence = summaryVersion;
      state.approval = null;
      message = `Resumen ${summaryVersion} propuesto. Muéstralo al cliente y espera su confirmación explícita.`;
    } else if (call.nombre === "approve_summary") {
      const summaryVersion = call.args.summaryVersion;
      if (!Number.isSafeInteger(summaryVersion) || !state.summary || summaryVersion !== state.summary.version) {
        message = "No se puede aprobar: el resumen no es el vigente. Propón el resumen actualizado.";
      } else if (CUSTOMER_REJECTION.test(currentCustomerText) || !CUSTOMER_APPROVAL.test(currentCustomerText)) {
        message = "No se puede aprobar sin confirmación explícita del cliente al resumen vigente.";
      } else if (state.refused.contact || state.refused.address || !state.brief.contactPermission || !state.brief.addressPermission) {
        message = "La aprobación no está disponible hasta contar con autorización explícita para contacto y dirección.";
      } else if (state.approval?.summaryVersion === summaryVersion) {
        message = "Este resumen ya estaba aprobado por el cliente.";
        recordReceipt = false;
      } else {
        state.approval = { summaryVersion: summaryVersion as number, confirmedAt: (input.now ?? (() => new Date()))().toISOString() };
        message = "Resumen aprobado por confirmación explícita del cliente.";
      }
    } else if (call.nombre === "record_photo_feedback") {
      const feedback = photoFeedbackSchema.parse(call.args);
      message = input.photoIds?.has(feedback.attachmentId) && input.savePhotoFeedback
        ? `Preferencia recibida para la foto ${feedback.attachmentId}.`
        : "No se pudo asociar la preferencia a una foto de esta conversación.";
    } else if (call.nombre === "record_photo_reading") {
      const reading = photoReadingArgsSchema.parse(call.args);
      message = input.photoIds?.has(reading.attachmentId) && input.savePhotoReading
        ? `Lectura recibida para la foto ${reading.attachmentId}.`
        : "No se pudo asociar la lectura a una foto de esta conversación.";
    } else {
      message = "Herramienta desconocida; no se aplicaron cambios.";
    }
    if (recordReceipt) state.toolReceipts[input.operationId] = { name: call.nombre, argsHash, message };
    return state;
  });
  if (call.nombre === "record_photo_reading") {
    const reading = photoReadingArgsSchema.safeParse(call.args);
    if (reading.success && input.photoIds?.has(reading.data.attachmentId) && input.savePhotoReading) {
      const { attachmentId, ...fields } = reading.data;
      message = await input.savePhotoReading(attachmentId, fields)
        ? `Lectura guardada para la foto ${attachmentId}. Describe esa lectura al cliente y pídele que confirme si es correcta; quedó pendiente de su confirmación.`
        : "No se encontró la foto para guardar su lectura.";
    }
  }
  if (call.nombre === "record_photo_feedback") {
    const feedback = photoFeedbackSchema.safeParse(call.args);
    if (feedback.success && input.photoIds?.has(feedback.data.attachmentId) && input.savePhotoFeedback) {
      // Only what the customer's own latest message supports is stored; the rest is reported back so the advisor asks.
      const evidence = customerEvidence(currentCustomerText);
      const confirmed = feedback.data.confirmed ? (evidence.confirmed ? true : null) : (evidence.corrected ? false : null);
      const preference = feedback.data.preference === "like" ? (evidence.likes ? "like" as const : null)
        : feedback.data.preference === "dislike" ? (evidence.dislikes ? "dislike" as const : null) : "neutral" as const;
      const keep = feedback.data.keep ? keepWithEvidence(feedback.data.keep, currentCustomerText) : null;
      const saved = confirmed === null && preference === null && !(keep?.accepted.length)
        ? true
        : await input.savePhotoFeedback(feedback.data.attachmentId, confirmed, preference, keep?.accepted.length ? keep.accepted : undefined);
      const unsupported = [
        confirmed === null ? (feedback.data.confirmed ? "que confirmó tu lectura" : "que corrigió tu lectura") : null,
        preference === null ? `que le ${feedback.data.preference === "like" ? "gusta" : "disgusta"} la foto` : null,
        ...(keep?.rejected ?? []).map((item) => `conservar «${item}»`),
      ].filter((item): item is string => item !== null);
      message = !saved ? "No se encontró la foto para guardar su preferencia."
        : `Guardado para la foto ${feedback.data.attachmentId}: ${[confirmed === null ? null : `lectura ${confirmed ? "confirmada" : "corregida"}`, preference && preference !== "neutral" ? (preference === "like" ? "le gusta" : "no le gusta") : null, keep?.accepted.length ? `conservar: ${keep.accepted.join(", ")}` : null].filter(Boolean).join("; ") || "sin cambios"}.${unsupported.length ? ` NO se guardó (el último mensaje del cliente no lo dice): ${unsupported.join("; ")}. Pregúntaselo en vez de suponerlo.` : ""}`;
    }
  }
  const state = parseEventBriefState(result.state);
  const toolResult = {
    message,
    ...(call.nombre === "show_directions" && directionOffers ? { directions: state.directionOffers } : {}),
    ...((call.nombre === "propose_standard_package" || call.nombre === "propose_custom_package") && packageCardValue ? { card: packageCardValue } : {}),
  };
  return { event: "tool", name: call.nombre, result: toolResult, state, progress: calculateStateProgress(state) };
}

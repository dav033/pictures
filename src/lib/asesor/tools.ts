import { createHash } from "node:crypto";
import { z } from "zod";
import type { Herramienta, LlamadaHerramienta } from "@/lib/ia/nucleo/tipos";
import { EventBriefSchema, type EventBriefState, parseEventBriefState } from "./contracts";
import { calculateBriefProgress } from "./progress";
import { ADVISOR_DIRECTION_IDS, getDirectionOffers, isOfferedDirection, parseStoredDirectionOffers } from "./directions";
import type { DirectionOffer } from "./directions-contract";
import type { HappiaCatalogueResult } from "./catalogue";

const fieldNames = Object.keys(EventBriefSchema.shape).filter((key) => key !== "contactPermission" && key !== "addressPermission");
const fieldsSchema = EventBriefSchema.partial().omit({ contactPermission: true, addressPermission: true }).strict();
const summaryArgsSchema = z.object({}).strict();
const approvalArgsSchema = z.object({ summaryVersion: z.number().int().positive() }).strict();
const noArgsSchema = z.object({}).strict();
const directionArgsSchema = z.object({ directionId: z.string().refine(isOfferedDirection) }).strict();
const fieldPropertySchema = (field: string): Record<string, unknown> => {
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
  { nombre: "show_directions", descripcion: "Muestra las doce direcciones visuales permitidas y sus artículos temáticos verificados; úsala cuando el cliente aún no decide.", esquema: { type: "object", additionalProperties: false, properties: {} } },
  { nombre: "select_direction", descripcion: "Registra una dirección que el cliente eligió entre las que ya se le mostraron.", esquema: { type: "object", additionalProperties: false, required: ["directionId"], properties: { directionId: { type: "string", enum: ADVISOR_DIRECTION_IDS } } } },
];

export type AdvisorToolEffect = { event: "tool"; name: string; result: unknown; state: EventBriefState; progress: ReturnType<typeof calculateBriefProgress> };
export type BriefMutator = (mutate: (state: unknown, version: number) => unknown) => Promise<{ version: number; state: unknown }>;

const CUSTOMER_APPROVAL = /\b(?:apruebo|confirmo|acepto)\s+(?:(?:el|la|este|esta)\s+)?(?:resumen|propuesta)\b|\bestoy de acuerdo con (?:el )?(?:resumen|propuesta)\b|\bdoy mi aprobaci[oó]n (?:al|a la) (?:resumen|propuesta)\b/i;
const CUSTOMER_REJECTION = /\bno (?:apruebo|confirmo|acepto|estoy de acuerdo)\b/i;
const CUSTOMER_CONTACT_CONSENT = /\b(?:autorizo (?:que me contacten|el contacto)|pueden contactarme|acepto que me contacten)\b/i;
const CUSTOMER_ADDRESS_CONSENT = /\b(?:autorizo (?:usar|compartir) (?:mi )?(?:direcci[oó]n|ubicaci[oó]n)|pueden usar mi direcci[oó]n)\b/i;

export function customerConsent(text: string): { contact: boolean; address: boolean; refusedContact: boolean; refusedAddress: boolean } {
  return {
    contact: CUSTOMER_CONTACT_CONSENT.test(text), address: CUSTOMER_ADDRESS_CONSENT.test(text),
    refusedContact: /\b(?:no (?:quiero|autorizo|acepto) que me contacten|no autorizo compartir (?:mi )?(?:direcci[oó]n|ubicaci[oó]n) ni que me contacten|no (?:quiero|autorizo|acepto|autorizo compartir|comparto) (?:el contacto|mi contacto|mis datos de contacto|mi (?:tel[eé]fono|correo))|prefiero no (?:dar|compartir) (?:mi )?(?:contacto|tel[eé]fono|correo)|no autorizo (?:a )?(?:compartir|usar) (?:mi )?contacto)\b/i.test(text),
    refusedAddress: /\b(?:no (?:quiero|autorizo|acepto|comparto) (?:dar|compartir|usar)? ?(?:mi )?(?:direcci[oó]n|ubicaci[oó]n)|prefiero no (?:dar|compartir) (?:mi )?(?:direcci[oó]n|ubicaci[oó]n))\b/i.test(text),
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
  now?: () => Date;
}): Promise<AdvisorToolEffect> {
  const { call, currentCustomerText } = input;
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
      const unavailable: HappiaCatalogueResult = { status: "unavailable", reason: "no_valid_snapshot" };
      directionOffers = getDirectionOffers(unavailable);
    }
  }
  const result = await input.mutateBrief((raw, version) => {
    const state = parseEventBriefState(raw);
    const receipt = state.toolReceipts[input.operationId];
    if (receipt) {
      message = receipt.name === call.nombre && receipt.argsHash === argsHash
        ? receipt.message
        : "Este turno ya aplicó una herramienta diferente en este paso. Se conserva el cambio anterior; inicia un turno nuevo para continuar.";
      return state;
    }
    if ((call.nombre === "propose_summary" && !summaryArgsSchema.safeParse(call.args).success)
      || (call.nombre === "approve_summary" && !approvalArgsSchema.safeParse(call.args).success)
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
      state.brief = updated.data;
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
    } else if (call.nombre === "propose_summary") {
      const progress = calculateBriefProgress(state.brief);
      if (!progress.complete) { message = `Faltan campos obligatorios: ${progress.missing.join(", ")}.`; return state; }
      const summaryVersion = state.summarySequence + 1;
      const safeBrief = { ...state.brief,
        address: state.brief.addressPermission && !state.refused.address ? state.brief.address : null,
        contactName: state.brief.contactPermission && !state.refused.contact ? state.brief.contactName : null,
        contactPhone: state.brief.contactPermission && !state.refused.contact ? state.brief.contactPhone : null,
        contactEmail: state.brief.contactPermission && !state.refused.contact ? state.brief.contactEmail : null,
      };
      const summaryLines = [
        `Evento: ${safeBrief.eventName ?? safeBrief.eventKind ?? "sin especificar"}`,
        safeBrief.honoreeName ? `Homenajeado/a: ${safeBrief.honoreeName}` : null,
        `Fecha: ${safeBrief.date ?? "sin especificar"}`,
        safeBrief.startTime || safeBrief.endTime ? `Horario: ${[safeBrief.startTime, safeBrief.endTime].filter(Boolean).join("–")}` : null,
        `Invitados: ${safeBrief.guestCount ?? "sin especificar"}`,
        `Lugar: ${[safeBrief.venueName, safeBrief.venueType, safeBrief.city].filter(Boolean).join(", ") || "sin especificar"}`,
        safeBrief.department ? `Departamento: ${safeBrief.department}` : null,
        `Presupuesto: ${safeBrief.budget === null ? "sin especificar" : `${safeBrief.currency} ${safeBrief.budget}`}`,
        safeBrief.companyName ? `Empresa: ${safeBrief.companyName}` : null,
        safeBrief.schoolName ? `Institución educativa: ${safeBrief.schoolName}${safeBrief.grade ? `, ${safeBrief.grade}` : ""}` : null,
        safeBrief.theme ? `Tema: ${safeBrief.theme}` : null,
        safeBrief.colors.length ? `Colores: ${safeBrief.colors.join(", ")}` : null,
        safeBrief.style ? `Estilo: ${safeBrief.style}` : null,
        safeBrief.organiserPriority ? `Prioridad: ${safeBrief.organiserPriority}` : null,
        safeBrief.likes ? `Le gusta: ${safeBrief.likes}` : null,
        safeBrief.dislikes ? `No le gusta: ${safeBrief.dislikes}` : null,
        safeBrief.brandRequests ? `Solicitudes: ${safeBrief.brandRequests}` : null,
        safeBrief.proposedPackage ? `Paquete propuesto: ${safeBrief.proposedPackage}` : null,
        safeBrief.notes ? `Notas: ${safeBrief.notes}` : null,
        safeBrief.address ? `Dirección autorizada: ${safeBrief.address}` : null,
        safeBrief.contactName ? `Contacto autorizado: ${safeBrief.contactName}` : null,
        safeBrief.contactPhone ? `Teléfono autorizado: ${safeBrief.contactPhone}` : null,
        safeBrief.contactEmail ? `Correo autorizado: ${safeBrief.contactEmail}` : null,
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
    } else {
      message = "Herramienta desconocida; no se aplicaron cambios.";
    }
    if (recordReceipt) state.toolReceipts[input.operationId] = { name: call.nombre, argsHash, message };
    return state;
  });
  const state = parseEventBriefState(result.state);
  const toolResult = call.nombre === "show_directions" && directionOffers
    ? { message, directions: state.directionOffers }
    : { message };
  return { event: "tool", name: call.nombre, result: toolResult, state, progress: calculateBriefProgress(state.brief) };
}

import { ADVISOR_ESTIMATE_NOTICE, type EventBrief, type ProposalLine, type StandardPackageProposal } from "./contracts";
import type { HappiaCatalogueResult, HappiaService } from "./catalogue";
import { offerableServices } from "./catalogue-context";
import { budgetCeiling, packageCard, type AdvisorPackageCard } from "./packages";

/** What the model asks for: service ids copied from the catalogue it was given, and a quantity for unit-priced services. */
export type CustomPackageRequest = { name?: string; items: ReadonlyArray<{ serviceId: string; quantity?: number }> };

export const MAX_CUSTOM_ITEMS = 12;
const MAX_UNIT_QUANTITY = 60;

export type CustomPackageResult =
  | { status: "proposal"; proposal: StandardPackageProposal; card: AdvisorPackageCard }
  | { status: "rejected"; reason: string };

function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Services of the event's city only; a service from another city can never be offered. */
export function servicesInCity(catalogue: Extract<HappiaCatalogueResult, { status: "available" }>, city: string): Array<HappiaService & { name: string }> {
  const wanted = normalise(city);
  return offerableServices(catalogue.data.services).filter((service) => normalise(service.city) === wanted || normalise(service.city_slug) === wanted.replace(/\s+/g, "-"));
}

function themeWords(brief: EventBrief): string[] {
  return normalise([brief.theme, brief.style].filter(Boolean).join(" ")).split(" ").filter((word) => word.length > 3 && !["fiesta", "cumpleanos", "celebracion", "tema", "tematica"].includes(word));
}

function lineHash(lines: ProposalLine[]): string {
  const text = lines.map((line) => `${line.serviceId}x${line.quantity}`).sort().join("|");
  let hash = 5381;
  for (const char of text) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/**
 * Builds a custom proposal out of individual Happia services. The server validates every id against the live catalogue
 * of the event's city, fixes the quantities (per-person services follow the guest count) and computes every price;
 * the model never supplies a price, a name or an id the catalogue does not have.
 */
export function buildCustomPackage(catalogue: HappiaCatalogueResult, brief: EventBrief, request: CustomPackageRequest): CustomPackageResult {
  if (catalogue.status !== "available") return { status: "rejected", reason: "No hay catálogo de Happia disponible ahora; no armes ni ofrezcas una propuesta ni inventes precios." };
  if (!brief.city) return { status: "rejected", reason: "Aún no hay ciudad del evento: pregúntala antes de armar una propuesta." };
  if (brief.guestCount === null) return { status: "rejected", reason: "Aún no hay cantidad de invitados: pregúntala antes de armar una propuesta." };
  if (request.items.length === 0) return { status: "rejected", reason: "La propuesta no incluye ningún servicio; elige al menos uno del catálogo." };
  if (request.items.length > MAX_CUSTOM_ITEMS) return { status: "rejected", reason: `Demasiados servicios (máximo ${MAX_CUSTOM_ITEMS}); elige los más importantes.` };
  const local = servicesInCity(catalogue, brief.city);
  if (local.length === 0) return { status: "rejected", reason: `Happia no tiene servicios en ${brief.city}; no ofrezcas nada y di que el equipo confirmará qué se puede hacer.` };
  const byId = new Map(local.map((service) => [service.id, service]));
  const unknown = request.items.filter((item) => !byId.has(item.serviceId)).map((item) => item.serviceId);
  if (unknown.length > 0) return { status: "rejected", reason: `Estos servicios no existen en el catálogo de ${brief.city}: ${unknown.join(", ")}. Usa solo los identificadores del catálogo que te dio el servidor; no se armó la propuesta.` };

  const guests = brief.guestCount;
  const isPerPerson = (service: HappiaService) => service.charge_type === "per_person" || service.charge_mode === "per_person";
  // Per-person services follow the guest count, event-priced and non-editable ones are a single unit, the rest take the asked quantity (repeated ids add up).
  const wanted = new Map<string, number>();
  for (const item of request.items) {
    const service = byId.get(item.serviceId) as HappiaService;
    if (isPerPerson(service)) { wanted.set(service.id, guests); continue; }
    if (service.charge_mode === "event" || !service.quantity_editable) { wanted.set(service.id, 1); continue; }
    const asked = Number.isInteger(item.quantity) && (item.quantity as number) >= 1 ? (item.quantity as number) : 1;
    wanted.set(service.id, Math.min(MAX_UNIT_QUANTITY, (wanted.get(service.id) ?? 0) + asked));
  }
  const lines: ProposalLine[] = [...wanted].map(([id, quantity]) => {
    const service = byId.get(id) as HappiaService & { name: string };
    return { serviceId: id, name: service.name.trim(), category: service.category_name, provider: service.provider_name, quantity, basis: isPerPerson(service) ? "per_person" : "unit",
      unitPriceCop: service.total, subtotalCop: Math.round(service.total * quantity) };
  });
  const total = lines.reduce((sum, line) => sum + line.subtotalCop, 0);

  const disclosures: string[] = ["Son servicios individuales de Happia armados para ti; las cantidades, la disponibilidad y el total final los confirma el decorador."];
  const words = themeWords(brief);
  const text = normalise(lines.map((line) => `${line.name} ${(byId.get(line.serviceId) as HappiaService).description ?? ""}`).join(" ")).split(" ");
  const themeMatches = words.length > 0 && words.some((word) => text.includes(word));
  if (words.length > 0 && !themeMatches) disclosures.push(`Ningún servicio del catálogo de ${brief.city} es específico de la temática "${brief.theme ?? brief.style}"; la temática y los colores los define el decorador con estos servicios.`);
  const ceiling = budgetCeiling(brief);
  if (ceiling !== null && total > ceiling) disclosures.push(`El total supera el presupuesto indicado${brief.budgetRange ? ` (${brief.budgetRange})` : ""}; dile al cliente que es mayor y qué servicios se pueden quitar para bajarlo.`);
  const uncovered = lines.filter((line) => line.basis === "unit" && /\bpara\s+\d+\s+invitados\b/i.test(`${(byId.get(line.serviceId) as HappiaService).description ?? ""}`));
  for (const line of uncovered) disclosures.push(`"${line.name}" indica una capacidad por unidad en su descripción; confirma que ${line.quantity} unidad(es) alcanzan para ${guests} invitados.`);

  const proposal: StandardPackageProposal = {
    kind: "custom", lines, packageId: `custom-${lineHash(lines)}`, name: request.name?.trim() || "Propuesta a medida", baseGuests: guests, guestCount: guests,
    estimate: { status: total > 0 ? "available" : "unavailable", subtotalCop: total > 0 ? total : null, basis: "before_vat_and_commission", source: catalogue.source,
      fetchedAt: catalogue.fetchedAt, snapshotAgeSeconds: catalogue.snapshotAgeSeconds, notice: ADVISOR_ESTIMATE_NOTICE },
    coverage: { event: "unknown", theme: themeMatches ? "matches" : "unknown", city: "matches", guests: "matches_base" },
    disclosures,
    categories: [...new Set(lines.map((line) => line.category).filter((name) => name.trim() !== ""))].sort((a, b) => a.localeCompare(b, "es")),
  };
  return { status: "proposal", proposal, card: packageCard(proposal) };
}

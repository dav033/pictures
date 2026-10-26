import type { HappiaCatalogueResult, HappiaService } from "./catalogue";

const MAX_SERVICES = 60;
const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Below this a price is a data error ("Catering de comida" at $8 per person), not an offer. */
const MIN_PLAUSIBLE_PRICE_COP = 100;

/** Catalogue rows that are not offerable: unnamed, implausibly priced or test entries ("Prueba"). */
function offerable(service: HappiaService): service is HappiaService & { name: string } {
  return typeof service.name === "string" && service.name.trim() !== "" && service.total >= MIN_PLAUSIBLE_PRICE_COP && !/\bprueba\b/i.test(`${service.name} ${service.description ?? ""}`);
}

/** A service that is a place to hold the event (hall, venue, auditorium…), by its category or name. */
export function isVenueService(service: Pick<HappiaService, "category_name" | "name">): boolean {
  return /sal[oó]n|lugar|espacio|sede|finca|venue|auditorio|terraza|hotel|club|quinta|casa de eventos/i.test(`${service.category_name} ${service.name ?? ""}`);
}

export function offerableServices(services: readonly HappiaService[]): Array<HappiaService & { name: string }> {
  return services.filter(offerable);
}

function serviceLine(service: HappiaService & { name: string }): string {
  const description = service.description?.replace(/\s+/g, " ").trim().slice(0, 140);
  const perPerson = service.charge_type === "per_person" || service.charge_mode === "per_person";
  return `• id=${service.id} · ${service.name} [${service.category_name}] · ${service.provider_name} · ${copFormat.format(service.total)} ${perPerson ? "por persona (se multiplica por los invitados)" : service.charge_mode === "event" || !service.quantity_editable ? "por evento (1 unidad)" : "por unidad (puedes pedir varias)"}${description ? ` — ${description}` : ""}`;
}

/**
 * What Happia can actually provide, for the model's context. The advisor may only propose these services; anything
 * else is not offered. Without a city the model gets the cities Happia covers; without a catalogue, nothing to offer.
 */
export function catalogueForModel(catalogue: HappiaCatalogueResult, city: string | null): string {
  if (catalogue.status !== "available") {
    return "Catálogo de Happia: no disponible ahora. No propongas servicios, elementos ni precios concretos; conversa solo sobre gustos y colores y di que el equipo confirmará qué se puede hacer.";
  }
  const services = offerableServices(catalogue.data.services);
  const cities = [...new Set(services.map((service) => service.city))].sort((a, b) => a.localeCompare(b, "es"));
  if (!city) return `Catálogo de Happia: aún no sabes la ciudad. Happia tiene servicios en: ${cities.join(", ") || "ninguna ciudad"}. No propongas elementos concretos hasta saber la ciudad.`;
  const wanted = normalise(city);
  const local = services.filter((service) => normalise(service.city) === wanted || normalise(service.city_slug) === wanted.replace(/\s+/g, "-"));
  if (local.length === 0) {
    return `Catálogo de Happia: no hay servicios en ${city}. Happia tiene servicios en: ${cities.join(", ")}. Dilo con honestidad; no propongas elementos concretos.`;
  }
  const lines = local.slice(0, MAX_SERVICES).map(serviceLine);
  return `Catálogo de Happia en ${city} (lo único que se puede ofrecer; arma la propuesta con propose_custom_package usando estos id):\n${lines.join("\n")}`;
}

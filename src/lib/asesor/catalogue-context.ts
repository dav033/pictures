import type { HappiaCatalogueResult, HappiaService } from "./catalogue";

const MAX_SERVICES = 40;
const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Catalogue rows that are not offerable: unnamed, priced at zero or test entries ("Prueba"). */
function offerable(service: HappiaService): service is HappiaService & { name: string } {
  return typeof service.name === "string" && service.name.trim() !== "" && service.total > 0 && !/\bprueba\b/i.test(`${service.name} ${service.description ?? ""}`);
}

function serviceLine(service: HappiaService & { name: string }): string {
  const description = service.description?.replace(/\s+/g, " ").trim().slice(0, 140);
  return `• ${service.name} [${service.category_name}] ${copFormat.format(service.total)}${service.charge_type === "per_person" ? " por persona" : ""}${description ? ` — ${description}` : ""}`;
}

/**
 * What Happia can actually provide, for the model's context. The advisor may only propose these services; anything
 * else is not offered. Without a city the model gets the cities Happia covers; without a catalogue, nothing to offer.
 */
export function catalogueForModel(catalogue: HappiaCatalogueResult, city: string | null): string {
  if (catalogue.status !== "available") {
    return "Catálogo de Happia: no disponible ahora. No propongas servicios, elementos ni precios concretos; conversa solo sobre gustos y colores y di que el equipo confirmará qué se puede hacer.";
  }
  const services = catalogue.data.services.filter(offerable);
  const cities = [...new Set(services.map((service) => service.city))].sort((a, b) => a.localeCompare(b, "es"));
  if (!city) return `Catálogo de Happia: aún no sabes la ciudad. Happia tiene servicios en: ${cities.join(", ") || "ninguna ciudad"}. No propongas elementos concretos hasta saber la ciudad.`;
  const wanted = normalise(city);
  const local = services.filter((service) => normalise(service.city) === wanted || normalise(service.city_slug) === wanted.replace(/\s+/g, "-"));
  if (local.length === 0) {
    return `Catálogo de Happia: no hay servicios en ${city}. Happia tiene servicios en: ${cities.join(", ")}. Dilo con honestidad; no propongas elementos concretos.`;
  }
  const lines = local.slice(0, MAX_SERVICES).map(serviceLine);
  return `Catálogo de Happia en ${city} (lo único que se puede ofrecer):\n${lines.join("\n")}`;
}

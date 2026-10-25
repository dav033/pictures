import { ADVISOR_ESTIMATE_NOTICE, type EventBrief, type StandardPackageProposal } from "./contracts";
import type { HappiaCatalogueResult, HappiaPackage } from "./catalogue";

export type AdvisorPackageCard = {
  kind: "package";
  id: string;
  title: string;
  description: string;
  content: string;
  estimate: StandardPackageProposal["estimate"];
};

export type StandardPackageResult =
  | { status: "proposal"; proposal: StandardPackageProposal; card: AdvisorPackageCard }
  | { status: "no_match"; reason: "catalogue_unavailable" | "no_fitting_package" };

type Coverage = "matches" | "excluded" | "unknown";

const EVENT_SYNONYMS: Record<string, readonly string[]> = {
  birthday: ["birthday", "cumpleanos"],
  corporate: ["corporate", "corporativo", "empresarial"],
  school: ["school", "escolar", "colegio"],
  wedding: ["wedding", "boda", "matrimonio"],
  social: ["social"],
  other: ["other", "otro"],
};

function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Reads optional catalogue metadata (a string or string array under any of `keys`); the catalogue schema passes unknown keys through. */
function metadataList(pkg: HappiaPackage, keys: readonly string[]): string[] {
  const record = pkg as Record<string, unknown>;
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) values.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return values.map(normalise).filter(Boolean);
}

function eventCoverage(pkg: HappiaPackage, brief: EventBrief): Coverage {
  const declared = metadataList(pkg, ["event_kind", "event_kinds"]);
  if (declared.length === 0 || !brief.eventKind) return "unknown";
  return EVENT_SYNONYMS[brief.eventKind].some((word) => declared.includes(word)) ? "matches" : "excluded";
}

function themeCoverage(pkg: HappiaPackage, brief: EventBrief): Coverage {
  const declared = metadataList(pkg, ["themes", "theme_tags"]);
  const theme = brief.theme ? normalise(brief.theme) : "";
  if (declared.length === 0 || !theme) return "unknown";
  return declared.some((entry) => theme.includes(entry) || entry.includes(theme)) ? "matches" : "excluded";
}

function cityCoverage(pkg: HappiaPackage, brief: EventBrief): Coverage {
  const declared = metadataList(pkg, ["city_slug", "city"]);
  const city = brief.city ? normalise(brief.city) : "";
  if (declared.length === 0 || !city) return "unknown";
  return declared.includes(city) ? "matches" : "excluded";
}

function estimateSubtotal(pkg: HappiaPackage, guests: number): number | null {
  const items = pkg.package_items.filter((item) => item.is_active);
  if (items.length === 0) return null;
  let subtotal = 0;
  for (const item of items) {
    if (!Number.isFinite(item.total)) return null;
    subtotal += item.charge_type === "per_person" || item.charge_mode === "per_person" ? item.total * guests : item.total;
  }
  return subtotal > 0 ? Math.round(subtotal) : null;
}

const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function proposalFor(pkg: HappiaPackage, brief: EventBrief, catalogue: Extract<HappiaCatalogueResult, { status: "available" }>, coverage: { event: Coverage; theme: Coverage; city: Coverage }): StandardPackageProposal {
  const guests = brief.guestCount ?? pkg.base_guests;
  const subtotal = estimateSubtotal(pkg, guests);
  const guestsCoverage = brief.guestCount === null ? "unknown" : brief.guestCount === pkg.base_guests ? "matches_base" : "differs_from_base";
  const disclosures: string[] = [];
  if (coverage.event === "unknown") disclosures.push("El catálogo no indica para qué tipo de evento aplica este paquete; hay que confirmarlo.");
  if (coverage.theme === "unknown") disclosures.push("El catálogo no indica temáticas para este paquete; no se garantiza que encaje con la temática.");
  if (coverage.city === "unknown") disclosures.push("El catálogo no indica la ciudad de este paquete; no se garantiza cobertura en la ciudad del evento.");
  if (guestsCoverage === "differs_from_base") disclosures.push(`El paquete está pensado para ${pkg.base_guests} invitados; el costo y la capacidad para ${brief.guestCount} se confirman con el equipo.`);
  if (guestsCoverage === "unknown") disclosures.push(`Aún no hay número de invitados; el paquete está pensado para ${pkg.base_guests}.`);
  if (pkg.restrictions || pkg.conditions) disclosures.push("El paquete tiene condiciones o restricciones que se revisan al cerrar la propuesta.");
  if (subtotal === null) disclosures.push("El catálogo no trae precios completos para este paquete; no se muestra estimado.");
  return {
    packageId: pkg.id, name: pkg.name, baseGuests: pkg.base_guests, guestCount: brief.guestCount,
    estimate: {
      status: subtotal === null ? "unavailable" : "available", subtotalCop: subtotal, basis: "before_vat_and_commission",
      source: catalogue.source, fetchedAt: catalogue.fetchedAt, snapshotAgeSeconds: catalogue.snapshotAgeSeconds, notice: ADVISOR_ESTIMATE_NOTICE,
    },
    coverage: { event: coverage.event === "matches" ? "matches" : "unknown", theme: coverage.theme === "matches" ? "matches" : "unknown", city: coverage.city === "matches" ? "matches" : "unknown", guests: guestsCoverage },
    disclosures,
    categories: [...new Set(pkg.package_items.filter((item) => item.is_active).map((item) => item.category_name).filter((name): name is string => typeof name === "string" && name.trim() !== ""))].sort((a, b) => a.localeCompare(b, "es")),
  };
}

export function packageCard(proposal: StandardPackageProposal): AdvisorPackageCard {
  const { estimate } = proposal;
  const price = estimate.status === "available" && estimate.subtotalCop !== null
    ? `Estimado: ${copFormat.format(estimate.subtotalCop)} COP antes de IVA y comisión`
    : "Precio estimado no disponible";
  return {
    kind: "package", id: proposal.packageId, title: proposal.name,
    description: `${price}. ${estimate.notice}`,
    content: `Me interesa el paquete ${proposal.name}.`,
    estimate,
  };
}

/** Highest amount the customer wants to spend: an amount, or the top of a band ("Hasta $300.000", "$300.000–$600.000"); none for "Más de …". */
export function budgetCeiling(brief: Pick<EventBrief, "budget" | "budgetRange">): number | null {
  if (brief.budget !== null) return brief.budget;
  if (!brief.budgetRange || /^m[aá]s de/i.test(brief.budgetRange.trim())) return null;
  const amounts = brief.budgetRange.match(/\d[\d.]*/g)?.map((amount) => Number(amount.replace(/\./g, ""))).filter(Number.isFinite) ?? [];
  return amounts.length ? Math.max(...amounts) : null;
}

/** Picks the standard Happia package that best fits the brief. Candidates come only from the validated catalogue; metadata that excludes a package removes it, missing metadata is disclosed. */
export function proposeStandardPackage(catalogue: HappiaCatalogueResult, brief: EventBrief): StandardPackageResult {
  if (catalogue.status !== "available") return { status: "no_match", reason: "catalogue_unavailable" };
  const ceiling = budgetCeiling(brief);
  const candidates = catalogue.data.packages.flatMap((pkg) => {
    if (!pkg.is_active || !pkg.package_items.some((item) => item.is_active)) return [];
    const coverage = { event: eventCoverage(pkg, brief), theme: themeCoverage(pkg, brief), city: cityCoverage(pkg, brief) };
    if (coverage.event === "excluded" || coverage.theme === "excluded" || coverage.city === "excluded") return [];
    const subtotal = estimateSubtotal(pkg, brief.guestCount ?? pkg.base_guests);
    const overBudget = ceiling !== null && subtotal !== null && subtotal > ceiling;
    return [{ pkg, coverage, overBudget, distance: brief.guestCount === null ? 0 : Math.abs(pkg.base_guests - brief.guestCount) }];
  });
  // Within the customer's budget first, then closest to the guest count (a soft preference, not a capacity), then featured, then a stable id order.
  candidates.sort((a, b) => Number(a.overBudget) - Number(b.overBudget) || a.distance - b.distance || Number(b.pkg.is_featured) - Number(a.pkg.is_featured) || a.pkg.id.localeCompare(b.pkg.id));
  const best = candidates[0];
  if (!best) return { status: "no_match", reason: "no_fitting_package" };
  const proposal = proposalFor(best.pkg, brief, catalogue, { event: best.coverage.event as Coverage, theme: best.coverage.theme, city: best.coverage.city });
  return { status: "proposal", proposal, card: packageCard(proposal) };
}

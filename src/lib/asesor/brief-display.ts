import type { BriefViewData } from "./brief";
import { budgetDisplay, formatBriefChange, PRIORITY_LABELS } from "./brief-changes";

const LABELS: Record<string, string> = {
  eventKind: "Tipo de evento", eventName: "Evento", date: "Fecha", startTime: "Hora de inicio", endTime: "Hora de cierre",
  guestCount: "Invitados", venueType: "Tipo de lugar", venueName: "Lugar", address: "Dirección", venueSearch: "Lugar por buscar en Happia", city: "Ciudad", department: "Departamento",
  budget: "Presupuesto", budgetRange: "Presupuesto", story: "Por qué es especial", contactName: "Contacto", contactPhone: "Teléfono", contactEmail: "Correo",
  honoreeName: "Homenajeado/a", honoreeAge: "Edad del homenajeado", companyName: "Empresa", schoolName: "Institución", grade: "Grado", audience: "Público",
  organiserPriority: "Lo más importante", theme: "Tema", colors: "Colores", style: "Estilo", likes: "Le gusta", dislikes: "No le gusta",
  brandRequests: "Marcas o proveedores", notes: "Notas", decorationPlacement: "Dónde irá la decoración", proposedPackage: "Paquete propuesto",
};

function display(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getBriefDisplayEntries(data: BriefViewData): Array<{ label: string; value: string }> {
  const entries = Object.entries(data.brief)
    .filter(([key]) => key in LABELS && !(key === "proposedPackage" && data.standardPackage) && key !== "budget" && key !== "budgetRange")
    .map(([key, value]) => ({ label: LABELS[key], value: key === "organiserPriority" && typeof value === "string" ? PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] ?? value : display(value) }))
    .filter((entry): entry is { label: string; value: string } => entry.value !== null);
  if (data.brief.venueUndecided) entries.unshift({ label: "Lugar", value: "Por definir: el cliente aún no sabe dónde será" });
  // Budget fields are absent from the vendor projection, so this shows only in the full brief.
  const budget = "budget" in data.brief || "budgetRange" in data.brief || "budgetUndisclosed" in data.brief
    ? budgetDisplay({ budget: data.brief.budget ?? null, budgetRange: data.brief.budgetRange ?? null, budgetUndisclosed: data.brief.budgetUndisclosed ?? false, currency: data.brief.currency ?? "COP" }) : null;
  if (budget) entries.push({ label: "Presupuesto", value: budget });
  const proposal = data.standardPackage;
  if (!proposal) return entries;
  const { estimate } = proposal;
  const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const price = estimate.status === "available" && estimate.subtotalCop !== null
    ? `${copFormat.format(estimate.subtotalCop)} COP antes de IVA y comisión`
    : "Precio estimado no disponible";
  const source = estimate.source === "seeded_last_good" ? "Último catálogo verificado" : "Catálogo Happia";
  const freshness = estimate.fetchedAt
    ? `${estimate.fetchedAt}${estimate.snapshotAgeSeconds === null ? "" : ` · antigüedad: ${estimate.snapshotAgeSeconds} segundos`}`
    : "Fecha de consulta no disponible";
  return [
    ...entries,
    ...(proposal.kind === "custom"
      ? [{ label: "Propuesta a medida", value: proposal.name }, ...proposal.lines.map((line) => ({ label: `Servicio · ${line.category}`, value: `${line.name} (${line.provider}) x${line.quantity}${line.basis === "per_person" ? " invitados" : ""}: ${copFormat.format(line.subtotalCop)}` }))]
      : [{ label: "Paquete estándar", value: `${proposal.name} (${proposal.packageId})` }]),
    { label: proposal.kind === "custom" ? "Total de referencia" : "Estimado del paquete", value: price },
    { label: "Fuente del estimado", value: source },
    { label: "Actualidad del catálogo", value: freshness },
    { label: "Nota del estimado", value: estimate.notice },
    ...proposal.disclosures.map((disclosure, index) => ({ label: `Aviso del paquete ${index + 1}`, value: disclosure })),
  ];
}

/** The brief's change history: what the customer changed after first saying it, oldest first. */
export function getBriefChangeLines(data: BriefViewData): string[] {
  return data.changes.map((change) => `${formatBriefChange(change)}${change.impact ? `. ${change.impact}` : ""}`);
}

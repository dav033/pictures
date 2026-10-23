import type { BriefViewData } from "./brief";

const LABELS: Record<string, string> = {
  eventKind: "Tipo de evento", eventName: "Evento", date: "Fecha", startTime: "Hora de inicio", endTime: "Hora de cierre",
  guestCount: "Invitados", venueType: "Tipo de lugar", venueName: "Lugar", address: "Dirección", city: "Ciudad", department: "Departamento",
  budget: "Presupuesto", contactName: "Contacto", contactPhone: "Teléfono", contactEmail: "Correo",
  honoreeName: "Homenajeado/a", honoreeAge: "Edad del homenajeado", companyName: "Empresa", schoolName: "Institución", grade: "Grado", audience: "Público",
  organiserPriority: "Prioridad", theme: "Tema", colors: "Colores", style: "Estilo", likes: "Le gusta", dislikes: "No le gusta",
  brandRequests: "Solicitudes", notes: "Notas", proposedPackage: "Paquete propuesto",
};

function display(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getBriefDisplayEntries(data: BriefViewData): Array<{ label: string; value: string }> {
  const entries = Object.entries(data.brief)
    .filter(([key]) => key in LABELS && !(key === "proposedPackage" && data.standardPackage))
    .map(([key, value]) => ({ label: LABELS[key], value: display(value) }))
    .filter((entry): entry is { label: string; value: string } => entry.value !== null);
  const proposal = data.standardPackage;
  if (!proposal) return entries;
  const { estimate } = proposal;
  const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const price = estimate.status === "available" && estimate.subtotalCop !== null
    ? `${copFormat.format(estimate.subtotalCop)} COP antes de IVA y comisión`
    : "Precio estimado no disponible";
  const source = estimate.source === "postgres" ? "Catálogo Happia" : "Último catálogo verificado";
  const freshness = estimate.fetchedAt
    ? `${estimate.fetchedAt}${estimate.snapshotAgeSeconds === null ? "" : ` · antigüedad: ${estimate.snapshotAgeSeconds} segundos`}`
    : "Fecha de consulta no disponible";
  return [
    ...entries,
    { label: "Paquete estándar", value: `${proposal.name} (${proposal.packageId})` },
    { label: "Estimado del paquete", value: price },
    { label: "Fuente del estimado", value: source },
    { label: "Actualidad del catálogo", value: freshness },
    { label: "Nota del estimado", value: estimate.notice },
    ...proposal.disclosures.map((disclosure, index) => ({ label: `Aviso del paquete ${index + 1}`, value: disclosure })),
  ];
}

import type { CatalogueServiceView } from "@/lib/asesor/proposal-editor";

export type { CatalogueServiceView };
export type CatalogueResult =
  | { status: "ok"; city: string; guests: number | null; services: CatalogueServiceView[] }
  | { status: "no_city" | "no_services" | "unavailable" | "error"; message: string };

const MESSAGES = {
  no_city: "Aún no sé la ciudad del evento; dímela en el chat para mostrarte los servicios disponibles.",
  no_services: "Happia no tiene servicios disponibles en esa ciudad por ahora.",
  unavailable: "El catálogo de Happia no está disponible ahora. Inténtalo de nuevo en un momento.",
  error: "No pudimos cargar los servicios. Inténtalo de nuevo.",
} as const;

export async function fetchCatalogue(conversationId: string, signal?: AbortSignal): Promise<CatalogueResult> {
  try {
    const response = await fetch(`/api/asesor/catalogue?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
    const body = (await response.json().catch(() => null)) as { status?: string; city?: string; guests?: number | null; services?: CatalogueServiceView[] } | null;
    if (response.ok && body?.status === "ok" && Array.isArray(body.services) && typeof body.city === "string") return { status: "ok", city: body.city, guests: body.guests ?? null, services: body.services };
    const status = body?.status === "no_city" || body?.status === "no_services" || body?.status === "unavailable" ? body.status : response.status === 503 ? "unavailable" : "error";
    return { status, message: MESSAGES[status] };
  } catch {
    return { status: "error", message: MESSAGES.error };
  }
}

export type ProposalItem = { serviceId: string; quantity?: number };

/** Saves the customer's edit; the server prices every service again and answers with the new state, or says why not. */
export async function saveProposal(conversationId: string, items: ProposalItem[]): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/asesor/proposal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, items }) });
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    if (response.ok) return { ok: true, body };
    return { ok: false, message: response.status === 422 && body?.message ? body.message : "No pudimos guardar el cambio. Inténtalo de nuevo." };
  } catch {
    return { ok: false, message: "Sin conexión: no se guardó el cambio." };
  }
}

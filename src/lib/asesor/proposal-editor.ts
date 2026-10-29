import { z } from "zod";
import type { HappiaCatalogueResult } from "./catalogue";
import { isVenueService } from "./catalogue-context";
import { buildCustomPackage, MAX_CUSTOM_ITEMS, servicesInCity } from "./custom-package";
import { parseEventBriefState, type EventBriefState } from "./contracts";
import { calculateStateProgress } from "./progress";
import { servesOfService, type Serves } from "./servings";
import type { AsesorRepository } from "./repository";

/** A Happia service as the explorer shows it: price and basis from the live catalogue, nothing invented. */
export type CatalogueServiceView = {
  id: string; name: string; category: string; provider: string; priceCop: number;
  basis: "per_person" | "unit" | "event"; description: string | null; serves: Serves | null; imageUrl: string | null; venue: boolean;
};

export type CatalogueListing =
  | { status: "ok"; city: string; guests: number | null; services: CatalogueServiceView[] }
  | { status: "no_city" | "unavailable" | "no_services"; city: string | null };

export function listServices(catalogue: HappiaCatalogueResult, city: string | null, guests: number | null): CatalogueListing {
  if (catalogue.status !== "available") return { status: "unavailable", city };
  if (!city) return { status: "no_city", city };
  const services = servicesInCity(catalogue, city).map((service): CatalogueServiceView => ({
    id: service.id, name: service.name.trim(), category: service.category_name, provider: service.provider_name, priceCop: service.total,
    basis: service.charge_type === "per_person" || service.charge_mode === "per_person" ? "per_person" : service.charge_mode === "event" || !service.quantity_editable ? "event" : "unit",
    description: service.description?.replace(/\s+/g, " ").trim() || null, serves: servesOfService(service),
    imageUrl: typeof service.image_url === "string" && service.image_url.startsWith("https://") ? service.image_url : null, venue: isVenueService(service),
  })).sort((a, b) => a.category.localeCompare(b.category, "es") || a.priceCop - b.priceCop);
  return services.length ? { status: "ok", city, guests, services } : { status: "no_services", city };
}

export const ProposalEditSchema = z.object({
  conversationId: z.string().min(1).max(100),
  items: z.array(z.object({ serviceId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(60).optional() }).strict()).max(MAX_CUSTOM_ITEMS),
}).strict();
export type ProposalEdit = z.infer<typeof ProposalEditSchema>;

/**
 * The customer's edit of the proposal (add, change a quantity, remove): the whole list of services they want. The server
 * re-validates every service against the live catalogue of the event's city and prices it again; an empty list clears the proposal.
 */
export function applyProposalEdit(state: EventBriefState, catalogue: HappiaCatalogueResult, items: ProposalEdit["items"]): { status: "ok"; state: EventBriefState } | { status: "rejected"; reason: string } {
  if (items.length === 0) {
    state.standardPackage = null;
    state.brief.proposedPackage = null;
  } else {
    const outcome = buildCustomPackage(catalogue, state.brief, { ...(state.standardPackage?.kind === "custom" ? { name: state.standardPackage.name } : {}), items, logisticsConfirmed: true });
    if (outcome.status === "rejected") return { status: "rejected", reason: outcome.reason };
    state.standardPackage = outcome.proposal;
    state.brief.proposedPackage = `${outcome.proposal.name} (propuesta a medida)`;
  }
  // A changed proposal needs a fresh summary and a fresh approval.
  state.summary = null;
  state.approval = null;
  return { status: "ok", state };
}

type Repository = Pick<AsesorRepository, "upsertAccount" | "getConversation" | "latestBrief" | "mutateBrief">;
type Dependencies = {
  authorize: (request: Request) => { role: "user" | "admin" } | Response;
  repository: () => Repository;
  loadCatalogue: () => Promise<HappiaCatalogueResult>;
  sameOrigin: (request: Request) => boolean;
};
const NO_STORE = { "Cache-Control": "private, no-store" };

async function ownedConversation(repository: Repository, role: string, conversationId: string): Promise<boolean> {
  const { id: accountId } = await repository.upsertAccount(`advisor:${role}`);
  const conversation = await repository.getConversation(conversationId);
  return conversation !== null && conversation.accountId === accountId;
}

/** `GET ?conversationId=…`: the services of the event's city, with prices, for the explorer. */
export function createCatalogueHandler(dependencies: Dependencies) {
  return async function GET(request: Request): Promise<Response> {
    const session = dependencies.authorize(request);
    if (session instanceof Response) return session;
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (!conversationId || conversationId.length > 100) return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
    try {
      const repository = dependencies.repository();
      if (!(await ownedConversation(repository, session.role, conversationId))) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404, headers: NO_STORE });
      const state = parseEventBriefState((await repository.latestBrief(conversationId))?.state);
      const listing = listServices(await dependencies.loadCatalogue(), state.brief.city, state.brief.guestCount);
      return Response.json(listing, { status: listing.status === "unavailable" ? 503 : 200, headers: NO_STORE });
    } catch {
      return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
    }
  };
}

/** `PUT {conversationId, items}`: replaces the proposal's services; answers with the new brief state the screen renders. */
export function createProposalHandler(dependencies: Dependencies) {
  return async function PUT(request: Request): Promise<Response> {
    const session = dependencies.authorize(request);
    if (session instanceof Response) return session;
    if (!dependencies.sameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403, headers: NO_STORE });
    const parsed = ProposalEditSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
    try {
      const repository = dependencies.repository();
      if (!(await ownedConversation(repository, session.role, parsed.data.conversationId))) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404, headers: NO_STORE });
      const catalogue = await dependencies.loadCatalogue();
      let rejection: string | null = null;
      const saved = await repository.mutateBrief(parsed.data.conversationId, (raw) => {
        const outcome = applyProposalEdit(parseEventBriefState(raw), catalogue, parsed.data.items);
        if (outcome.status === "rejected") { rejection = outcome.reason; return raw ?? parseEventBriefState(raw); }
        return outcome.state;
      });
      if (rejection) return Response.json({ code: "PROPOSAL_REJECTED", message: rejection }, { status: 422, headers: NO_STORE });
      const state = parseEventBriefState(saved.state);
      return Response.json({ state, progress: calculateStateProgress(state), briefVersion: saved.version }, { headers: NO_STORE });
    } catch {
      return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
    }
  };
}

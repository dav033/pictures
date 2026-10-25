import { z } from "zod";
import { isOfferedDirection, parseStoredDirectionOffers } from "./directions";
import type { DirectionOffer } from "./directions-contract";

export const EventKindSchema = z.enum(["birthday", "corporate", "school", "wedding", "social", "other"]);

/** R3 customer supplied facts. PII and permissions are explicit fields, never model-granted capabilities. */
export const EventBriefSchema = z.object({
  eventKind: EventKindSchema.nullable().default(null),
  eventName: z.string().trim().min(1).max(160).nullable().default(null),
  date: z.string().trim().min(1).max(80).nullable().default(null),
  startTime: z.string().trim().min(1).max(40).nullable().default(null),
  endTime: z.string().trim().min(1).max(40).nullable().default(null),
  guestCount: z.number().int().min(1).max(100_000).nullable().default(null),
  venueType: z.string().trim().min(1).max(100).nullable().default(null),
  venueName: z.string().trim().min(1).max(200).nullable().default(null),
  address: z.string().trim().min(1).max(500).nullable().default(null),
  city: z.string().trim().min(1).max(120).nullable().default(null),
  department: z.string().trim().min(1).max(120).nullable().default(null),
  budget: z.number().finite().nonnegative().nullable().default(null),
  currency: z.enum(["COP", "USD"]).default("COP"),
  honoreeName: z.string().trim().min(1).max(160).nullable().default(null),
  honoreeAge: z.number().int().min(0).max(120).nullable().default(null),
  companyName: z.string().trim().min(1).max(200).nullable().default(null),
  schoolName: z.string().trim().min(1).max(200).nullable().default(null),
  grade: z.string().trim().min(1).max(80).nullable().default(null),
  audience: z.string().trim().min(1).max(300).nullable().default(null),
  organiserPriority: z.enum(["impress", "personalise", "simple", "best_price"]).nullable().default(null),
  theme: z.string().trim().min(1).max(200).nullable().default(null),
  colors: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  style: z.string().trim().min(1).max(200).nullable().default(null),
  likes: z.string().trim().max(2000).nullable().default(null),
  dislikes: z.string().trim().max(2000).nullable().default(null),
  brandRequests: z.string().trim().max(2000).nullable().default(null),
  proposedPackage: z.string().trim().max(500).nullable().default(null),
  contactName: z.string().trim().min(1).max(160).nullable().default(null),
  contactPhone: z.string().trim().min(1).max(40).nullable().default(null),
  contactEmail: z.string().trim().email().max(254).nullable().default(null),
  contactPermission: z.boolean().default(false),
  addressPermission: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().default(null),
}).strict();

export type EventBrief = z.infer<typeof EventBriefSchema>;
export type EventBriefPatch = Partial<Omit<EventBrief, "currency" | "colors" | "contactPermission" | "addressPermission">> &
  Partial<Pick<EventBrief, "currency" | "colors" | "contactPermission" | "addressPermission">>;

export const emptyEventBrief = (): EventBrief => EventBriefSchema.parse({});

export const ADVISOR_ESTIMATE_NOTICE = "Versión de prueba. Estamos afinando esta asesoría; revisaremos contigo los detalles antes de cerrar la propuesta.";

const coverageSchema = z.enum(["matches", "unknown"]);
export const StandardPackageProposalSchema = z.object({
  packageId: z.string().min(1),
  name: z.string().min(1),
  baseGuests: z.number().int().positive(),
  guestCount: z.number().int().positive().nullable(),
  estimate: z.object({
    status: z.enum(["available", "unavailable"]),
    subtotalCop: z.number().finite().nonnegative().nullable(),
    basis: z.literal("before_vat_and_commission"),
    source: z.enum(["happia_api", "postgres", "seeded_last_good"]),
    fetchedAt: z.string().nullable(),
    snapshotAgeSeconds: z.number().int().nonnegative().nullable(),
    notice: z.string().min(1),
  }).strict(),
  coverage: z.object({ event: coverageSchema, theme: coverageSchema, city: coverageSchema, guests: z.enum(["matches_base", "differs_from_base", "unknown"]) }).strict(),
  disclosures: z.array(z.string()),
}).strict();
export type StandardPackageProposal = z.infer<typeof StandardPackageProposalSchema>;

export type EventBriefState = {
  brief: EventBrief;
  standardPackage: StandardPackageProposal | null;
  directionOffers: DirectionOffer[];
  selectedDirectionId: string | null;
  summary: { version: number; text: string; briefVersion: number } | null;
  /** Monotonic counter retained when a field correction invalidates the current summary. */
  summarySequence: number;
  approval: { summaryVersion: number; confirmedAt: string } | null;
  refused: { contact: boolean; address: boolean };
  toolReceipts: Record<string, { name: string; argsHash: string; message: string }>;
};

export function parseEventBriefState(input: unknown): EventBriefState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { brief: emptyEventBrief(), standardPackage: null, directionOffers: [], selectedDirectionId: null, summary: null, summarySequence: 0, approval: null, refused: { contact: false, address: false }, toolReceipts: {} };
  }
  const value = input as Record<string, unknown>;
  const parsed = EventBriefSchema.safeParse(value.brief ?? {});
  const summaryRaw = value.summary;
  const summarySequence = Number.isSafeInteger(value.summarySequence) && (value.summarySequence as number) >= 0
    ? value.summarySequence as number
    : typeof summaryRaw === "object" && summaryRaw !== null && Number.isSafeInteger(Reflect.get(summaryRaw, "version"))
      ? Reflect.get(summaryRaw, "version") as number : 0;
  const approvalRaw = value.approval;
  const refusedRaw = value.refused;
  const standardPackage = StandardPackageProposalSchema.safeParse(value.standardPackage);
  const directionOffers = parseStoredDirectionOffers(value.directionOffers) ?? [];
  return {
    brief: parsed.success ? parsed.data : emptyEventBrief(),
    standardPackage: standardPackage.success ? standardPackage.data : null,
    directionOffers,
    selectedDirectionId: isOfferedDirection(value.selectedDirectionId)
      && directionOffers.some(({ id }) => id === value.selectedDirectionId) ? value.selectedDirectionId : null,
    summary: typeof summaryRaw === "object" && summaryRaw !== null && !Array.isArray(summaryRaw)
      && Number.isSafeInteger(Reflect.get(summaryRaw, "version")) && typeof Reflect.get(summaryRaw, "text") === "string"
      && Number.isSafeInteger(Reflect.get(summaryRaw, "briefVersion"))
      ? { version: Reflect.get(summaryRaw, "version"), text: Reflect.get(summaryRaw, "text"), briefVersion: Reflect.get(summaryRaw, "briefVersion") }
      : null,
    summarySequence,
    approval: typeof approvalRaw === "object" && approvalRaw !== null && !Array.isArray(approvalRaw)
      && Number.isSafeInteger(Reflect.get(approvalRaw, "summaryVersion")) && typeof Reflect.get(approvalRaw, "confirmedAt") === "string"
      ? { summaryVersion: Reflect.get(approvalRaw, "summaryVersion"), confirmedAt: Reflect.get(approvalRaw, "confirmedAt") }
      : null,
    refused: {
      contact: typeof refusedRaw === "object" && refusedRaw !== null && Reflect.get(refusedRaw, "contact") === true,
      address: typeof refusedRaw === "object" && refusedRaw !== null && Reflect.get(refusedRaw, "address") === true,
    },
    toolReceipts: typeof value.toolReceipts === "object" && value.toolReceipts !== null && !Array.isArray(value.toolReceipts)
      ? value.toolReceipts as EventBriefState["toolReceipts"] : {},
  };
}

import type { AdvisorPackageCard } from "@/lib/asesor/packages";
import type { AdvisorComposerCard } from "./conversation-contract";

export type AdvisorComposerOptionCard = Extract<AdvisorComposerCard, { kind: "direction" }> | AdvisorPackageCard;

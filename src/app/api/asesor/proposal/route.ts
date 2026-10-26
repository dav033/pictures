import { requireAdvisorRole } from "@/lib/asesor/auth";
import { getHappiaCatalogue } from "@/lib/asesor/catalogue";
import { createProposalHandler } from "@/lib/asesor/proposal-editor";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { isSameOriginRequest } from "@/lib/auth/request";

/** The customer edits the custom proposal on screen (add, change quantity, remove); the server prices it again. */
export const PUT = createProposalHandler({ authorize: requireAdvisorRole, repository: createAsesorRepository, loadCatalogue: () => getHappiaCatalogue(), sameOrigin: isSameOriginRequest });

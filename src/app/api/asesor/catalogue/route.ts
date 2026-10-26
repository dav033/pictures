import { requireAdvisorRole } from "@/lib/asesor/auth";
import { getHappiaCatalogue } from "@/lib/asesor/catalogue";
import { createCatalogueHandler } from "@/lib/asesor/proposal-editor";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { isSameOriginRequest } from "@/lib/auth/request";

/** The Happia services of the event's city, with prices, for the explorer ("Explorar servicios"). */
export const GET = createCatalogueHandler({ authorize: requireAdvisorRole, repository: createAsesorRepository, loadCatalogue: () => getHappiaCatalogue(), sameOrigin: isSameOriginRequest });

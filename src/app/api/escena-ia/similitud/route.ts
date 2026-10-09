import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { conRegistro } from "@/lib/registro/servidor";
import { tomarCupoEscenaIA } from "@/lib/globos3d/cupo-escena-ia";
import { atenderSimilitud, origenCoincideConHost } from "@/lib/globos3d/similitud-refinado";
import { embeberImagen } from "@/lib/rag/embeddings";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";

/**
 * Taller 3D → criterio de aceptación del refinado con la foto (REQ-001 paso 9): qué tanto se parecen a la foto la captura
 * de la escena de antes y la de después de una ronda, con embeddings de imagen (gemini-embedding-2). La lógica vive en
 * `@/lib/globos3d/similitud-refinado` (probada sin red).
 */
export const POST = conRegistro("/api/escena-ia/similitud", atenderPOST, { vista: "3d" });

function atenderPOST(request: Request) {
  return atenderSimilitud(request, {
    autenticado: isAuthenticatedRequest,
    mismoOrigen: (request) => isSameOriginRequest(request) || origenCoincideConHost(request),
    cupo: tomarCupoEscenaIA,
    normalizar: normalizarFotoA,
    embeber: embeberImagen,
  });
}

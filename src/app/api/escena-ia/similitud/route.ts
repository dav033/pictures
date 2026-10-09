import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { contextoActual, conRegistro, decidir } from "@/lib/registro/servidor";
import { tomarCupoSimilitud } from "@/lib/globos3d/cupo-escena-ia";
import { atenderSimilitud } from "@/lib/globos3d/refinado/similitud-servidor";
import { embeberImagen } from "@/lib/rag/embeddings";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";

/**
 * Taller 3D → criterio de aceptación del refinado con la foto (REQ-001 paso 9): decide si una ronda se queda (estructura de la
 * escena y parecido con la foto por embeddings de imagen, gemini-embedding-2) y deja la decisión en el registro. La lógica vive
 * en `@/lib/globos3d/refinado/similitud-servidor` (probada sin red).
 */
export const POST = conRegistro("/api/escena-ia/similitud", atenderPOST, { vista: "3d" });

function atenderPOST(request: Request) {
  return atenderSimilitud(request, {
    autenticado: isAuthenticatedRequest,
    mismoOrigen: isSameOriginRequest,
    cupo: tomarCupoSimilitud,
    normalizar: normalizarFotoA,
    embeber: embeberImagen,
    contexto: () => {
      const actual = contextoActual();
      return { requestId: actual?.solicitud, correlationId: actual?.conversacion ?? actual?.solicitud };
    },
    registrar: decidir,
  });
}

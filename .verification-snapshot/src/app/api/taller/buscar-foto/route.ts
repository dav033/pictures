import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { conRegistro } from "@/lib/registro/servidor";
import { embeberImagen } from "@/lib/rag/embeddings";
import { atenderBusquedaFoto } from "@/lib/taller/buscar-foto";
import { buscarVisible } from "@/lib/taller/buscar-visible";
import { normalizarFoto } from "@/lib/taller/normalizar-foto";

/**
 * «Buscar por foto» en la biblioteca del taller 3D (REQ-002): recibe una foto (multipart, campo `imagen`, ≤ 6 MB), la
 * lleva a JPEG de hasta 1024 px, la embebe con gemini-embedding-2 y busca los items parecidos. Sin la biblioteca
 * indexada contesta 503 con un mensaje claro. La lógica vive en `@/lib/taller/buscar-foto` (probada sin red).
 */
export const POST = conRegistro("/api/taller/buscar-foto", atenderPOST, { vista: "3d" });

function atenderPOST(request: Request) {
  return atenderBusquedaFoto(request, {
    autenticado: isAuthenticatedRequest,
    mismoOrigen: isSameOriginRequest,
    embeber: embeberImagen,
    normalizar: normalizarFoto,
    buscar: (entrada) => buscarVisible(entrada),
  });
}

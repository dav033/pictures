import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { conRegistro } from "@/lib/registro/servidor";
import { atenderEscenaDesdeFoto } from "@/lib/taller/escena-desde-foto";
import { modelarFotoReal } from "@/lib/taller/modelar-foto-real";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";

/**
 * Taller 3D → foto a escena (REQ-001): sube la foto de una decoración (multipart, campo `imagen`, ≤ 6 MB) y devuelve
 * `{ escena, lectura, notas, omitidas, plantillas }`: Gemini LEE la foto (visión; nunca genera imágenes), una función
 * determinista la compila a la escena y la biblioteca aporta las plantillas más parecidas. La lógica vive en
 * `@/lib/taller/escena-desde-foto` (probada sin red). Comparte el tope por hora con `/api/escena-ia`.
 */
export const POST = conRegistro("/api/escena-desde-foto", atenderPOST, { vista: "3d" });

function atenderPOST(request: Request) {
  return atenderEscenaDesdeFoto(request, {
    autenticado: isAuthenticatedRequest,
    mismoOrigen: isSameOriginRequest,
    normalizar: normalizarFotoA,
    modelar: modelarFotoReal,
  });
}

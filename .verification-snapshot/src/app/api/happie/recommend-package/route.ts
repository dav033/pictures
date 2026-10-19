import { manejarRecomendacionExterna } from "@/lib/happie/recomendar-paquetes-externo";
import { respuestaPreflight } from "@/lib/happie/cors-externo";
import { conRegistro } from "@/lib/registro/servidor";

/** Exactamente 1 recomendación. Ver `recommend-packages` para hasta 3. */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/recommend-package", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  return manejarRecomendacionExterna(request, 1);
}

export async function OPTIONS(request: Request) {
  return respuestaPreflight(request);
}

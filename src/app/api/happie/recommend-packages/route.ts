import { manejarRecomendacionExterna } from "@/lib/happie/recomendar-paquetes-externo";
import { respuestaPreflight } from "@/lib/happie/cors-externo";
import { conRegistro } from "@/lib/registro/servidor";

/** Hasta 3 recomendaciones. Ver `recommend-package` para 1 sola. */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/recommend-packages", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  return manejarRecomendacionExterna(request, 3);
}

export async function OPTIONS(request: Request) {
  return respuestaPreflight(request);
}

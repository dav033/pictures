import { manejarRecomendacionExterna } from "@/lib/happie/recomendar-paquetes-externo";
import { respuestaPreflight } from "@/lib/happie/cors-externo";

/** Hasta 3 recomendaciones. Ver `recommend-package` para 1 sola. */
export async function POST(request: Request) {
  return manejarRecomendacionExterna(request, 3);
}

export async function OPTIONS(request: Request) {
  return respuestaPreflight(request);
}

import { manejarRecomendacionExterna } from "@/lib/happie/recomendar-paquetes-externo";
import { respuestaPreflight } from "@/lib/happie/cors-externo";

/** Exactamente 1 recomendación. Ver `recommend-packages` para hasta 3. */
export async function POST(request: Request) {
  return manejarRecomendacionExterna(request, 1);
}

export async function OPTIONS(request: Request) {
  return respuestaPreflight(request);
}

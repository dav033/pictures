import { isAuthenticatedRequest } from "@/lib/auth/request";
import { conRegistro } from "@/lib/registro/servidor";
import { leerHojaArmado } from "@/lib/taller/hoja-armado-bandera";

/**
 * Bandera `taller_hoja_armado` (PRO-01): si el Taller 3D muestra la «Hoja de armado». Ruta aparte, no la página, porque /3d
 * está prerenderizada y no puede leer Neon. Nunca se cachea: la bandera se cambia sin desplegar.
 */
const SIN_CACHE = { "Cache-Control": "no-store" } as const;

export const GET = conRegistro("/api/taller/hoja-armado", async (request: Request) => {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida.", codigo: "SESION_REQUERIDA" }, { status: 401, headers: SIN_CACHE });
  return Response.json(await leerHojaArmado(), { headers: SIN_CACHE });
}, { vista: "3d" });

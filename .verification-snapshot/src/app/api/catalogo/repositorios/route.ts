import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { leerRespuestaRepositorios } from "@/lib/catalogo/repositorios-api";
import { conRegistro } from "@/lib/registro/servidor";

/**
 * Los repositorios del catálogo para el Taller 3D (REQ-013 fase 5): sus manifiestos, cuáles ve la superficie `taller` y si el
 * panel «Añadir» va por repositorio (`ui`). Ruta aparte y no `NEXT_PUBLIC_*` porque /3d está prerenderizada y lo que se enciende o
 * apaga se cambia sin desplegar (fila de `ajustes_runtime`, `catalogo/visibilidad.ts` y `catalogo/ui-repositorios.ts`). Nunca se cachea.
 */
const SIN_CACHE = { "Cache-Control": "no-store" } as const;

export const GET = conRegistro("/api/catalogo/repositorios", atenderGET, { vista: "3d" });

async function atenderGET(request: Request) {
  if (!isAuthenticatedRequest(request) || !isSameOriginRequest(request)) {
    return Response.json({ error: "Sesión requerida.", codigo: "SESION_REQUERIDA" }, { status: 401, headers: SIN_CACHE });
  }
  return Response.json(await leerRespuestaRepositorios(), { headers: SIN_CACHE });
}

import { conRegistro } from "@/lib/registro/servidor";
import { atenderCotizacionTallerV2 } from "@/lib/taller/cotizacion-taller";
import { dependenciasCotizacionTaller } from "@/lib/taller/dependencias-cotizacion-taller";

/** Respuesta ampliada y versionada para iniciar la cotización profesional con el mismo precio D-038 del Taller. */
export const maxDuration = 30;

export const POST = conRegistro("/api/taller/cotizacion/v2", (request: Request) => atenderCotizacionTallerV2(request, dependenciasCotizacionTaller), { vista: "3d" });

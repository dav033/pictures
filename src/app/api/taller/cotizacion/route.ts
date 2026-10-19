import { conRegistro } from "@/lib/registro/servidor";
import { atenderCotizacionTaller } from "@/lib/taller/cotizacion-taller";
import { dependenciasCotizacionTaller } from "@/lib/taller/dependencias-cotizacion-taller";

/**
 * El precio de la «Lista de compra» del Taller 3D (D-038): la lista de materiales de la escena, cotizada con el mismo
 * cotizador que el plan del motor 3D de la vista guiada (paquetes y reserva con la regla única; precios de Python
 * `lista-materiales`). Sin modelo ni RAG. Lógica en lib/taller.
 */
export const maxDuration = 30;

export const POST = conRegistro("/api/taller/cotizacion", (request: Request) => atenderCotizacionTaller(request, dependenciasCotizacionTaller), { vista: "3d" });

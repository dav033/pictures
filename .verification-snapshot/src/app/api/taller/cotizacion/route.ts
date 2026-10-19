import { cotizarBom, crosswalkEnVivo, crosswalkIncluido, snapshotPublicado } from "@/lib/globos3d/motor/v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { atenderCotizacionTaller, type DependenciasCotizacionTaller } from "@/lib/taller/cotizacion-taller";

/**
 * El precio de la «Lista de compra» del Taller 3D (D-038): la lista de materiales de la escena, cotizada con el mismo
 * cotizador que el plan del motor 3D de la vista guiada (paquetes y reserva con la regla única; precios de Python
 * `lista-materiales`). Sin modelo ni RAG. Lógica en lib/taller.
 */
export const maxDuration = 30;

const dependencias: DependenciasCotizacionTaller = {
  cotizar: (bom, signal) => {
    const requestId = crypto.randomUUID();
    return cotizarBom(bom, {
      crosswalk: async () => crosswalkIncluido(),
      crosswalkEnVivo: () => crosswalkEnVivo(),
      snapshotPublicado: () => snapshotPublicado(),
      cotizarLista: (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: signal }),
    });
  },
  auditar: decidir,
};

export const POST = conRegistro("/api/taller/cotizacion", (request: Request) => atenderCotizacionTaller(request, dependencias), { vista: "3d" });

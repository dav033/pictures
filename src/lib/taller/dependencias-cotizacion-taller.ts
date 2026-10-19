import "server-only";
import { cotizarBom, crosswalkEnVivo, crosswalkIncluido, snapshotPublicado } from "@/lib/globos3d/motor/v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { decidir } from "@/lib/registro/servidor";
import type { DependenciasCotizacionTaller } from "./cotizacion-taller";

/** Adaptadores externos que usan ambas versiones HTTP del cotizador único del Taller. */
export const dependenciasCotizacionTaller: DependenciasCotizacionTaller = {
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

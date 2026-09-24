import type { GenerarEstructurado, RegistrarTelemetriaRecomendacion } from "@sempertex/happie-package-ia";
import type { FlujoIA } from "@sempertex/agente-core";
import { HAPPIE_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { generadorHappiePython } from "./generador-python";
import { idsDeSolicitud, telemetriaRecomendacion } from "./telemetria";

/**
 * Lo que cada ruta le pasa al recomendador del paquete: su telemetría y, con
 * `HAPPIE_PYTHON_ENABLED` (ADR-0026, fase 5), el generador respaldado por
 * Python. Sin el flag, `generar` queda indefinido y el paquete llama a Gemini
 * directo. Los dos comparten ids para correlacionar la telemetría con los
 * logs de Python.
 */
export function iaRecomendacionHappie(
  request: Request,
  flujo: Extract<FlujoIA, "happie_paquetes" | "happie_conversacion">,
): { registrarTelemetria: RegistrarTelemetriaRecomendacion; generar: GenerarEstructurado | undefined } {
  const ids = idsDeSolicitud(request);
  return {
    registrarTelemetria: telemetriaRecomendacion(request, flujo, ids),
    generar: HAPPIE_PYTHON_ENABLED ? generadorHappiePython("package_recommend", ids) : undefined,
  };
}

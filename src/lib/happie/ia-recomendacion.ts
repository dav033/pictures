import { crearGeneradorGemini, type GenerarEstructurado, type RegistrarTelemetriaRecomendacion } from "@sempertex/happie-package-ia";
import type { FlujoIA } from "@sempertex/agente-core";
import { HAPPIE_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { envolverFuncionIa } from "@/lib/registro/servidor";
import { generadorHappiePython } from "./generador-python";
import { idsDeSolicitud, telemetriaRecomendacion } from "./telemetria";

/**
 * Generador de Happie auditado (src/lib/registro): `llamada_ia` con la instrucción de sistema, las partes y el
 * esquema; `respuesta_ia` con el texto y los tokens. Devuelve y lanza exactamente lo mismo que `base`.
 */
export function generadorHappieAuditado(base: GenerarEstructurado, proposito: string): GenerarEstructurado {
  return envolverFuncionIa(base, {
    proveedor: HAPPIE_PYTHON_ENABLED ? "python" : "gemini",
    proposito,
    modelo: (solicitud) => solicitud.modelo,
    describir: (solicitud) => ({
      sistema: solicitud.instruccionSistema,
      mensajes: solicitud.partes.map((texto) => ({ rol: "usuario", texto })),
      parametros: { jsonSchema: solicitud.jsonSchema },
    }),
    extraer: (resultado) => ({
      ...(resultado.texto !== undefined ? { texto: resultado.texto } : {}),
      ...(resultado.uso ? { tokens: { entrada: resultado.uso.promptTokenCount, salida: resultado.uso.candidatesTokenCount, pensamiento: resultado.uso.thoughtsTokenCount, cacheados: resultado.uso.cachedContentTokenCount } } : {}),
    }),
  });
}

/**
 * Lo que cada ruta le pasa al recomendador del paquete: su telemetría y el generador SIEMPRE auditado: con
 * `HAPPIE_PYTHON_ENABLED` (ADR-0026, fase 5) el respaldado por Python; sin él, el Gemini directo del propio
 * paquete (el mismo que usaría por defecto). Sin llave ni flag queda indefinido y el paquete da su error de
 * siempre. Los dos comparten ids para correlacionar la telemetría con los logs de Python.
 */
export function iaRecomendacionHappie(
  request: Request,
  flujo: Extract<FlujoIA, "happie_paquetes" | "happie_conversacion">,
): { registrarTelemetria: RegistrarTelemetriaRecomendacion; generar: GenerarEstructurado | undefined } {
  const ids = idsDeSolicitud(request);
  const apiKey = process.env.GEMINI_API_KEY;
  const base = HAPPIE_PYTHON_ENABLED ? generadorHappiePython("package_recommend", ids) : apiKey ? crearGeneradorGemini(apiKey) : undefined;
  return {
    registrarTelemetria: telemetriaRecomendacion(request, flujo, ids),
    generar: base ? generadorHappieAuditado(base, "happie_recomendacion") : undefined,
  };
}

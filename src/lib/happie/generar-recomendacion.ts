import {
  HappiaClient,
  cargarConfigDesdeEnv,
  ordenarPorInvitados,
  paquetesParaTipoCurado,
  recomendarPaquetesConFiltros,
  type ServiciosSolicitados,
} from "@sempertex/happie-package-ia";
import { z } from "zod";
import {
  HAPPIE_CONTRACT_VERSION,
  HappieErrorV1Schema,
  HappieRecommendationRequestV1Schema,
  HappieRecommendationResponseV1Schema,
} from "@/lib/ia/contracts/happie-v1";

/**
 * El schema del contrato versionado es la fuente única. `main` había vuelto a
 * escribirlo a mano porque la capa de contratos no existía en su base; tiene
 * los mismos campos y la misma validación de URL, y además es `.strict()` y
 * acepta `schema_version`. Se exporta porque `ejecutarWebhook` lo recibe como
 * parámetro.
 */
export const CuerpoSolicitudSchema = HappieRecommendationRequestV1Schema;

type CuerpoSolicitud = z.infer<typeof CuerpoSolicitudSchema> & ServiciosSolicitados;

type ResultadoGeneracion = {
  status: number;
  body: unknown;
};

/** HAPPIA_API_BASE_URL es "https://www.happia.co/api"; el sitio de cliente
 * vive en el mismo dominio sin el sufijo "/api". */
function baseUrlPorDefecto(apiBaseUrl: string): string {
  return new URL(apiBaseUrl).origin;
}

function urlDePaquete(baseUrl: string, packageId: string): string {
  const url = new URL("/client/events/new", baseUrl);
  url.searchParams.set("package", packageId);
  return url.toString();
}

async function leerSolicitud(request: Request): Promise<ResultadoGeneracion | CuerpoSolicitud> {
  let desconocido: unknown;
  try {
    desconocido = await request.json();
  } catch {
    return { status: 400, body: { error: "El body debe ser JSON válido." } };
  }

  const resultado = CuerpoSolicitudSchema.safeParse(desconocido);
  if (!resultado.success) {
    return {
      status: 400,
      body: {
        error: "Solicitud de recomendación inválida.",
        campos: resultado.error.issues.map((issue) => issue.path.join(".")).filter(Boolean),
      },
    };
  }

  return resultado.data;
}

/**
 * Lógica de negocio compartida por todas las variantes de este endpoint
 * (navegador con CORS y webhook server-to-server) — parsea y valida el
 * body, pide las recomendaciones a la IA y arma la respuesta. No hace el
 * chequeo de API key ni decide headers de transporte: eso lo resuelve
 * cada wrapper según su consumidor.
 */
export async function generarRecomendacion(
  request: Request,
  maxRecomendaciones: number,
): Promise<ResultadoGeneracion> {
  const solicitud = await leerSolicitud(request);
  if ("status" in solicitud) return solicitud;

  const { tipoEvento, invitados, presupuesto, preferencias, url, comida, bebida, decoracion, fotografia } = solicitud;

  let baseUrl: string | undefined;
  if (url) {
    try {
      baseUrl = new URL(url).origin;
    } catch {
      return { status: 400, body: { error: "La url proporcionada no es válida." } };
    }
  }

  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages(request.signal);

    // Mismo narrowing determinista (sin LLM) que el flujo por pasos: primero
    // por tipo curado (con fallback a todo el catálogo activo si no hay
    // categoría exacta), luego por cercanía a los invitados pedidos.
    const { paquetes: coincidencias, coincidenciaExacta } = paquetesParaTipoCurado(tipoEvento, packages);
    const candidatos = ordenarPorInvitados(coincidencias, invitados);

    const resultado = await recomendarPaquetesConFiltros({
      tipoEvento,
      invitados,
      presupuesto,
      servicios: { comida, bebida, decoracion, fotografia },
      preferencias,
      paquetes: candidatos,
      coincidenciaExacta,
      maxRecomendaciones: Math.max(1, Math.min(3, Math.trunc(maxRecomendaciones))),
      signal: request.signal,
    });

    const baseUrlFinal = baseUrl ?? baseUrlPorDefecto(config.baseUrl);
    const body = HappieRecommendationResponseV1Schema.parse({
      schema_version: HAPPIE_CONTRACT_VERSION,
      recomendaciones: resultado.recomendaciones.map((recomendacion) => ({
        url: urlDePaquete(baseUrlFinal, recomendacion.paquete.id),
        razon: recomendacion.razon,
      })),
      resumen: resultado.resumen,
    });
    return {
      status: 200,
      body,
    };
  } catch (error) {
    // Un abort del caller se propaga tal cual: `ejecutarWebhook` lo traduce a
    // 408 o 504 según quién canceló. Convertirlo aquí en 502 ocultaría la causa.
    if (request.signal.aborted) throw error;
    const esTimeout = error instanceof Error && error.name === "TimeoutError";
    return {
      status: esTimeout ? 504 : 502,
      body: HappieErrorV1Schema.parse({
        schema_version: HAPPIE_CONTRACT_VERSION,
        error: esTimeout ? "Tiempo de espera agotado." : "No se pudo generar la recomendación. Intenta de nuevo.",
      }),
    };
  }
}

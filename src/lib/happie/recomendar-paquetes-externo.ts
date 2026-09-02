import {
  HappiaClient,
  cargarConfigDesdeEnv,
  ordenarPorInvitados,
  paquetesParaTipoCurado,
  recomendarPaquetesConFiltros,
  type ServiciosSolicitados,
} from "@sempertex/happie-package-ia";
import { apiKeyValida, conEncabezadosCors, encabezadosCors } from "./cors-externo";

type CuerpoSolicitud = {
  tipoEvento?: string;
  invitados?: number;
  presupuesto?: number;
  preferencias?: string[];
  /** URL base del sitio de Happia (ej. "https://www.happia.co"), para armar
   * el link de cada paquete recomendado. Si no viene, se deriva de
   * `HAPPIA_API_BASE_URL` quitándole el sufijo "/api". */
  url?: string;
} & ServiciosSolicitados;

/** HAPPIA_API_BASE_URL es "https://www.happia.co/api"; el sitio de cliente
 * vive en el mismo dominio sin el sufijo "/api". */
function baseUrlPorDefecto(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api\/?$/, "");
}

function urlDePaquete(baseUrl: string, packageId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/client/events/new?package=${packageId}`;
}

/**
 * Lógica compartida por los dos endpoints de recomendación
 * (`recommend-packages` y `recommend-package`) — solo cambia cuántas
 * recomendaciones como máximo se le piden a la IA. Pensados para un
 * consumidor externo desde el navegador: no pasan por la cookie de sesión
 * de la app (ver `proxy.ts`), se protegen con API key + origen permitido.
 */
export async function manejarRecomendacionExterna(
  request: Request,
  maxRecomendaciones: number,
): Promise<Response> {
  const cors = encabezadosCors(request);

  if (!apiKeyValida(request)) {
    return conEncabezadosCors(Response.json({ error: "API key inválida o ausente." }, { status: 401 }), cors);
  }

  const { tipoEvento, invitados, presupuesto, preferencias, url, comida, bebida, decoracion, fotografia }: CuerpoSolicitud =
    await request.json();

  if (!tipoEvento || !invitados || invitados <= 0 || !presupuesto || presupuesto <= 0) {
    return conEncabezadosCors(
      Response.json({ error: "Falta tipo de evento, cantidad de invitados o presupuesto." }, { status: 400 }),
      cors,
    );
  }

  let baseUrl: string | undefined;
  if (url) {
    try {
      baseUrl = new URL(url).origin;
    } catch {
      return conEncabezadosCors(Response.json({ error: "La url proporcionada no es válida." }, { status: 400 }), cors);
    }
  }

  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages();

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
      maxRecomendaciones,
    });

    const baseUrlFinal = baseUrl ?? baseUrlPorDefecto(config.baseUrl);
    const cuerpoRespuesta = {
      recomendaciones: resultado.recomendaciones.map((recomendacion) => ({
        url: urlDePaquete(baseUrlFinal, recomendacion.paquete.id),
        razon: recomendacion.razon,
      })),
      resumen: resultado.resumen,
    };

    return conEncabezadosCors(Response.json(cuerpoRespuesta), cors);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return conEncabezadosCors(
      Response.json({ error: `No se pudo generar la recomendación: ${detalle}` }, { status: 502 }),
      cors,
    );
  }
}

import { HappiaClient, cargarConfigDesdeEnv, recomendarCatalogo } from "@sempertex/happie-package-ia";
import { z } from "zod";
import { HAPPIE_V2, HappieRecommendationRequestV2Schema, HappieRecommendationResponseV2Schema, catalogOptions } from "@/lib/ia/contracts/happie-v2";
import { iaRecomendacionHappie } from "./ia-recomendacion";
import { registrarFalloHappie } from "./registrar-fallo";

type Input = z.infer<typeof HappieRecommendationRequestV2Schema>;

export async function generarRecomendacionCatalogo(request: Request, input: Input): Promise<{ status: number; body: unknown }> {
  let options: ReturnType<typeof catalogOptions>;
  try { options = catalogOptions(input); }
  catch { return { status: 400, body: { schema_version: HAPPIE_V2, error: "Las cantidades no coinciden con el modo solicitado." } }; }
  try {
    const config = cargarConfigDesdeEnv();
    const client = new HappiaClient(config);
    // Only fetch the requested catalogue(s), once, sharing the caller deadline.
    const [servicios, { packages }] = await Promise.all([
      options.cantidad.servicios > 0 ? client.listarServicios({ city: input.city, signal: request.signal }) : Promise.resolve([]),
      options.cantidad.paquetes > 0 ? client.listarPackages(request.signal, { city: input.city }) : Promise.resolve({ packages: [] }),
    ]);
    const needs = (["comida", "bebida", "decoracion", "fotografia"] as const).filter((key) => input[key]);
    const result = await recomendarCatalogo({
      ...options, tipoEvento: input.tipoEvento, invitados: input.invitados, presupuesto: input.presupuesto,
      preferencias: input.preferencias, necesidades: needs, servicios, paquetes: packages,
      signal: request.signal, ...iaRecomendacionHappie(request, "happie_conversacion"),
    });
    const base = input.url ? new URL(input.url).origin : new URL(config.baseUrl).origin;
    const recomendaciones = result.recomendaciones.map((r) => {
      if (r.tipo === "servicio") return r;
      const url = new URL("/client/events/new", base);
      url.searchParams.set("package", r.paquete.id);
      return { ...r, url: url.toString() };
    });
    return { status: 200, body: HappieRecommendationResponseV2Schema.parse({
      schema_version: HAPPIE_V2, ...options, recomendaciones,
      servicios: recomendaciones.filter((r) => r.tipo === "servicio"),
      paquetes: recomendaciones.filter((r) => r.tipo === "paquete"), resumen: result.resumen,
    }) };
  } catch (error) {
    if (request.signal.aborted) throw error;
    registrarFalloHappie("catalogo-v2", error, request.headers.get("x-correlation-id"));
    return { status: error instanceof Error && error.name === "TimeoutError" ? 504 : 502,
      body: { schema_version: HAPPIE_V2, error: "No se pudo consultar o recomendar el catálogo. Intenta de nuevo." } };
  }
}

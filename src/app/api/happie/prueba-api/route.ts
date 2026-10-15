import { z } from "zod";
import { HAPPIA_LIMITE_MAXIMO, HappiaApiError, HappiaClient, cargarConfigDesdeEnv } from "@sempertex/happie-package-ia";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { panelPruebaActivo } from "@/lib/happie/panel-prueba";

/**
 * Manual check of the Happia Integrations API from the running app:
 *   GET /api/happie/prueba-api?recurso=services&city=barranquilla            -> everything (no limit)
 *   GET /api/happie/prueba-api?recurso=services&page=2&limit=50              -> one page
 * Session required (same guard as the other /api/happie routes). Never returns the key.
 */
const ConsultaSchema = z.object({
  recurso: z.enum(["services", "packages"]).default("services"),
  city: z.string().trim().regex(/^[a-z0-9-]{1,60}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

export async function GET(request: Request) {
  if (!panelPruebaActivo()) return Response.json({ error: "No disponible." }, { status: 404 });
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const consulta = ConsultaSchema.safeParse(params);
  if (!consulta.success) {
    return Response.json({ error: "Parámetros inválidos.", detalle: z.flattenError(consulta.error).fieldErrors }, { status: 400 });
  }
  const { recurso, city, page, limit } = consulta.data;
  const maximo = HAPPIA_LIMITE_MAXIMO[recurso];
  if (limit !== undefined && limit > maximo) {
    return Response.json({ error: `limit debe ser un entero entre 1 y ${maximo}` }, { status: 400 });
  }

  let config;
  try {
    config = cargarConfigDesdeEnv();
  } catch {
    return Response.json({ error: "La integración con Happia no está configurada." }, { status: 503 });
  }

  try {
    const cliente = new HappiaClient(config);
    // No page and no limit: read every page (the client paginates, dedupes and bounds the read itself).
    if (page === undefined && limit === undefined) {
      const items = recurso === "services"
        ? await cliente.listarServicios({ city, signal: request.signal })
        : (await cliente.listarPackages(request.signal, { city })).packages;
      return Response.json({ recurso, city: city ?? null, pagination: { totalItems: items.length, totalPages: 1, currentPage: 1 }, items });
    }
    const argumentos = { page, limit, city, signal: request.signal };
    const resultado = recurso === "services"
      ? await cliente.listarServiciosPagina(argumentos)
      : await cliente.listarPackagesPagina(argumentos);
    return Response.json({ recurso, city: city ?? null, pagination: resultado.pagination, items: resultado.items });
  } catch (error) {
    if (error instanceof HappiaApiError) {
      // Fixed text per family: the upstream's own message stays out of the browser.
      const texto = error.status === 401 ? "Happia rechazó la API key (¿caducada?)."
        : error.status === 400 ? "Happia rechazó los parámetros."
        : "Happia no respondió correctamente.";
      return Response.json({ error: texto, upstreamStatus: error.status }, { status: 502 });
    }
    // Includes schema drift (ZodError): the upstream answered, but not with the documented contract.
    return Response.json({ error: "Happia respondió algo fuera del contrato documentado o no respondió." }, { status: 502 });
  }
}

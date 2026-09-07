import { HappiaClient, cargarConfigDesdeEnv, tiposEventoCurados, necesidadesCuradas } from "@sempertex/happie-package-ia";
import { isAuthenticatedRequest } from "@/lib/auth/request";

/** No existe en la API de Happia — el usuario definió estas tres opciones a
 * mano; se muestran tal cual y viajan como contexto estructurado al LLM. */
const UBICACIONES = ["Salón de eventos", "Al aire libre", "Casa"] as const;

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages(request.signal);

    const tipos = tiposEventoCurados(packages);
    const necesidades = necesidadesCuradas(packages);

    const invitadosBase = packages.filter((p) => p.is_active).map((p) => p.base_guests);
    const invitadosSugeridos = invitadosBase.length
      ? { min: Math.min(...invitadosBase), max: Math.max(...invitadosBase) }
      : null;

    return Response.json({ tipos, necesidades, ubicaciones: UBICACIONES, invitadosSugeridos });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: `No se pudieron cargar las opciones: ${detalle}` }, { status: 502 });
  }
}

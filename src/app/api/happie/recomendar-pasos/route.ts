import {
  HappiaClient,
  cargarConfigDesdeEnv,
  paquetesParaTipoCurado,
  ordenarPorInvitados,
  recomendarPaquetesEstructurado,
} from "@sempertex/happie-package-ia";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import {
  HAPPIE_CONTRACT_VERSION,
  HappieErrorV1Schema,
  HappiePackageRecommendationResponseV1Schema,
  HappieStructuredRecommendationRequestV1Schema,
} from "@/lib/ia/contracts/happie-v1";

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request) || !isSameOriginRequest(request)) {
    return Response.json(
      HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "Sesión requerida." }),
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "El body debe ser JSON válido." }),
      { status: 400 },
    );
  }
  const parsed = HappieStructuredRecommendationRequestV1Schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "Faltan datos del evento." }),
      { status: 400 },
    );
  }

  const { tipoEvento, invitados, ubicacion, necesidades } = parsed.data;
  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages(request.signal);

    const { paquetes: coincidencias, coincidenciaExacta } = paquetesParaTipoCurado(tipoEvento, packages);
    const candidatos = ordenarPorInvitados(coincidencias, invitados);
    const resultado = await recomendarPaquetesEstructurado({
      tipoEvento,
      invitados,
      ubicacion,
      paquetes: candidatos,
      coincidenciaExacta,
      necesidades,
      signal: request.signal,
    });

    return Response.json(
      HappiePackageRecommendationResponseV1Schema.parse({
        schema_version: HAPPIE_CONTRACT_VERSION,
        ...resultado,
      }),
    );
  } catch {
    return Response.json(
      HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "No se pudo generar la recomendación." }),
      { status: 502 },
    );
  }
}

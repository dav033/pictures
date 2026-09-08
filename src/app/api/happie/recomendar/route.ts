import { HappiaClient, cargarConfigDesdeEnv, recomendarPaquetes } from "@sempertex/happie-package-ia";
import {
  HAPPIE_CONTRACT_VERSION,
  HappieDescriptionRequestV1Schema,
  HappieErrorV1Schema,
  HappiePackageRecommendationResponseV1Schema,
} from "@/lib/ia/contracts/happie-v1";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { telemetriaRecomendacion } from "@/lib/happie/telemetria";

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request) || !isSameOriginRequest(request)) {
    return Response.json(HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "Sesión requerida." }), { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "El body debe ser JSON válido." }), { status: 400 });
  }
  const parsed = HappieDescriptionRequestV1Schema.safeParse(body);

  if (!parsed.success) {
    return Response.json(HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "Describe el evento que vas a realizar." }), { status: 400 });
  }

  try {
    const config = cargarConfigDesdeEnv();
    const cliente = new HappiaClient(config);
    const { packages } = await cliente.listarPackages(request.signal);

    const resultado = await recomendarPaquetes({ descripcionEvento: parsed.data.descripcionEvento, paquetes: packages, signal: request.signal, registrarTelemetria: telemetriaRecomendacion(request, "happie_paquetes") });

    return Response.json(HappiePackageRecommendationResponseV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, ...resultado }));
  } catch {
    return Response.json(HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "No se pudo generar la recomendación." }), { status: 502 });
  }
}

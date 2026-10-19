import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

export async function POST() {
  const requestId = crypto.randomUUID();
  const mensaje = "IMAGEN_SOLO_FLUX: el laboratorio de referencias ya no genera imágenes.";
  return Response.json({
    error: mensaje,
    ui_error: construirUiErrorV1("IMAGEN_SOLO_FLUX", { mensaje, codigoOrigen: "IMAGEN_SOLO_FLUX", requestId }),
  }, { status: 410, headers: { "x-request-id": requestId } });
}

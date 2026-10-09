import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderCaptura } from "@/lib/feedback-ia/manejadores-registro";
import { conRegistro } from "@/lib/registro";

/** Sube la captura JPEG (≤ 600 KB) de antes o después de un turno al almacén S3; el servidor firma, el navegador nunca ve las claves. */
export const POST = conRegistro("/api/feedback-ia/capturas", (request: Request) => atenderCaptura(request, dependenciasReales()));

import { dependenciasReales } from "@/lib/feedback-ia/dependencias";
import { atenderAnalisisCron } from "@/lib/feedback-ia/manejadores-analisis";
import { conRegistro } from "@/lib/registro";

export const maxDuration = 60;

/**
 * Análisis semanal de huecos para un cron (Vercel Cron o curl con `Authorization: Bearer $CRON_SECRET`). Está fuera del
 * Proxy de sesión (src/proxy.ts) porque el cron no trae cookie; se autentica solo con CRON_SECRET y sin él queda cerrada.
 */
export const GET = conRegistro("/api/feedback-ia/analisis-cron", (request: Request) => atenderAnalisisCron(request, dependenciasReales()));

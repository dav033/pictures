import { leerMotorGuiada } from "@/lib/guiada-motor/bandera";
import { atenderFijarMotor, atenderLecturaMotor } from "@/lib/guiada-motor/manejadores";
import { conRegistro, decidir } from "@/lib/registro";

/**
 * Bandera `GUIADA_MOTOR` (REQ-007): con qué motor se crea un plan nuevo de la guiada. Ruta aparte, no la página, porque
 * /asistente está prerenderizada (cacheComponents) y no puede leer cookies ni Neon. Lógica en lib/guiada-motor.
 */
const dependencias = { leer: leerMotorGuiada, auditar: decidir };

export const GET = conRegistro("/api/guiada/motor", (request: Request) => atenderLecturaMotor(request, dependencias), { vista: "guiada" });
export const POST = conRegistro("/api/guiada/motor", (request: Request) => atenderFijarMotor(request), { vista: "guiada" });

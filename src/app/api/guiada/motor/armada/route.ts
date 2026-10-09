import { atenderArmadaMotor, crearCacheArmada, type DependenciasArmada } from "@/lib/guiada-motor/armada-motor";
import { armarDesdeEspec } from "@/lib/globos3d/motor/v1";
import { conRegistro, decidir } from "@/lib/registro";

/**
 * La armada del plan 3D para la vista del cliente (REQ-007, fase 3): vuelve a armar la espec firmada y devuelve la armada
 * compacta (o el SVG de reserva). Sin modelo, sin RAG y sin Python. Lógica en lib/guiada-motor/armada-motor.ts.
 */
export const maxDuration = 30;

const dependencias: DependenciasArmada = {
  armar: armarDesdeEspec,
  cache: crearCacheArmada(48),
  auditar: decidir,
};

// La entrada se audita (sin el token: el registro lo oculta); la salida no: es una armada o un SVG de hasta 30 KB que se piden en cada vista.
export const POST = conRegistro("/api/guiada/motor/armada", (request: Request) => atenderArmadaMotor(request, dependencias), { vista: "guiada", maxBytesCuerpo: 400_000, auditarSalida: false });

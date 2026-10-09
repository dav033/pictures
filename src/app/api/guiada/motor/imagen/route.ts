import { getRagPool } from "@/lib/rag/db";
import { aligerarImagenGenerada } from "@/lib/generacion/imagen-liviana";
import { MAX_CARACTERES_CUERPO_IMAGEN } from "@/lib/guiada-motor/imagen-contrato";
import { generarImagenGuiada3d } from "@/lib/guiada-motor/imagen-flux";
import { ALMACENAR_IMAGEN_EN_SERVIDOR, atenderImagenMotor, type DependenciasImagen } from "@/lib/guiada-motor/imagen-motor";
import { armarDesdeEspec, descripcionImagenDeEspec } from "@/lib/globos3d/motor/v1";
import { tomarFotoDeLaHora } from "@/lib/globos3d/tope-fotos-hora";
import { conRegistro, decidir } from "@/lib/registro";

/**
 * «Ver cómo quedaría» de un plan del motor 3D (REQ-007, fase 4): vuelve a armar la espec firmada, la cuenta en inglés y la pasa
 * por FLUX.1 Kontext max con la captura del visor como imagen base (el camino del «Igual al visor» del Taller, D-025). Sin
 * Python, sin modelo de texto y sin tocar `/api/generate`. Lógica en lib/guiada-motor/imagen-motor.ts.
 */
export const maxDuration = 120;

const dependencias: DependenciasImagen = {
  describir: descripcionImagenDeEspec,
  armar: armarDesdeEspec,
  generar: (prompt, base, senal) => generarImagenGuiada3d(prompt, base, senal),
  aligerar: aligerarImagenGenerada,
  tomarFoto: () => tomarFotoDeLaHora(),
  almacen: ALMACENAR_IMAGEN_EN_SERVIDOR ? getRagPool : null,
  auditar: decidir,
};

// La entrada se audita con la captura y el token reducidos a su huella; la salida, la imagen, también.
export const POST = conRegistro("/api/guiada/motor/imagen", (request: Request) => atenderImagenMotor(request, dependencias), { vista: "guiada", maxBytesCuerpo: MAX_CARACTERES_CUERPO_IMAGEN });

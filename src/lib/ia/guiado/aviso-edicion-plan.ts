import type { MotorGuiada } from "@/lib/guiada-motor/tipos";

/**
 * El aviso que lee el modelo del chat cuando el cliente pide un cambio del plan (`editarPlan` en la ruta de la guiada). Con
 * `python` es exactamente el de siempre (el cambio lo rehace Python); con el motor 3D no se nombra a Python ni se promete
 * el recuento: el cambio se aplica en el servidor del 3D y, si no se puede, se le dice al cliente.
 */
const AVISO_PYTHON = "La interfaz hace este cambio sobre el plan del cliente y conserva todo lo demás (título, medidas, acabados, otros colores y piezas); Python vuelve a contar los globos. Responde con UNA frase corta que diga qué cambias; no digas que ya quedó ni des cantidades ni precios.";
const AVISO_3D = "La interfaz hace este cambio sobre el plan del cliente y conserva todo lo demás (título, medidas, acabados, otros colores y piezas); los globos se vuelven a contar al aplicar el cambio y, si no se puede hacer, se le dice al cliente. Responde con UNA frase corta que diga qué cambias; no digas que ya quedó ni des cantidades ni precios.";

export function avisoEdicionPlan(motor: MotorGuiada): string {
  return motor === "3d" ? AVISO_3D : AVISO_PYTHON;
}

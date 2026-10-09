import type { Escena } from "./escena";
import { medidasDeMesa } from "./salon-evento";
import { registroVivo } from "./salon-registro";
import { zonasDeEscena, zonasPresentes } from "./salon-zonas";

const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

/** Lo que hay hoy en el salón, dicho para el modelo y el usuario: sala, mesas, mesa principal, pista y las demás zonas (leído de la escena, no de lo que se pidió). */
export function resumenDeSalon(escena: Escena): string {
  const registro = registroVivo(escena);
  const z = zonasDeEscena(escena);
  const partes: string[] = [];
  if (registro) partes.push(`${z.mesas.length} mesas de ${medidasDeMesa(registro.mesa, registro.sillas).puestos}`);
  if (z.mesaPrincipal) partes.push(`mesa principal con ${z.mesaPrincipal.sillas.length} sillas`);
  if (z.pista) partes.push(`pista de ${metros(z.pista.x1 - z.pista.x0)}`);
  const otras = zonasPresentes(escena).filter((zona) => zona === "mesa_postres" || zona === "fondo_fotos" || zona === "entrada");
  const nombres = { mesa_postres: "mesa de postres", fondo_fotos: "fondo de fotos", entrada: "entrada" } as const;
  partes.push(...otras.map((zona) => nombres[zona as keyof typeof nombres]));
  const { anchoCm, fondoCm, altoCm } = escena.sala;
  return `Salón de ${metros(anchoCm)} × ${metros(fondoCm)} × ${metros(altoCm)}: ${partes.join(", ") || "sin piezas"}`;
}

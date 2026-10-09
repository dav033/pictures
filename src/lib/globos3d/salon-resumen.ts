import type { Escena } from "./escena";
import { sillasDeMesaNodo } from "./mobiliario-asientos-mesa";
import { registroVivo } from "./salon-registro";
import { zonasDeEscena, zonasPresentes } from "./salon-zonas";

const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

function textoDeMesas(escena: Escena, ids: readonly string[]): string {
  const sillas = ids.flatMap((id) => { const n = escena.nodos.find((x) => x.id === id); return n ? [sillasDeMesaNodo(escena, n).total] : []; });
  const distintas = [...new Set(sillas)];
  if (distintas.length <= 1) return `${sillas.length} mesas de ${distintas[0] ?? 0}`;
  return `${sillas.length} mesas con ${sillas.reduce((a, b) => a + b, 0)} sillas en total (de ${Math.min(...sillas)} a ${Math.max(...sillas)} por mesa)`;
}

/** Lo que hay hoy en el salón, dicho para el modelo y el usuario: sala, mesas, mesa principal, pista y las demás zonas (leído de la escena, no de lo que se pidió). */
export function resumenDeSalon(escena: Escena): string {
  const registro = registroVivo(escena);
  const z = zonasDeEscena(escena);
  const partes: string[] = [];
  // Las sillas se cuentan de la escena (`sillasDeMesaNodo`), no de lo que se pidió: lo dibujado es lo que cuenta.
  if (registro) partes.push(textoDeMesas(escena, z.mesas));
  if (z.mesaPrincipal) partes.push(`mesa principal con ${z.mesaPrincipal.sillas.length} sillas`);
  if (z.pista) partes.push(`pista de ${metros(z.pista.x1 - z.pista.x0)}`);
  const otras = zonasPresentes(escena).filter((zona) => zona === "mesa_postres" || zona === "fondo_fotos" || zona === "entrada");
  const nombres = { mesa_postres: "mesa de postres", fondo_fotos: "fondo de fotos", entrada: "entrada" } as const;
  partes.push(...otras.map((zona) => nombres[zona as keyof typeof nombres]));
  const { anchoCm, fondoCm, altoCm } = escena.sala;
  return `Salón de ${metros(anchoCm)} × ${metros(fondoCm)} × ${metros(altoCm)}: ${partes.join(", ") || "sin piezas"}`;
}

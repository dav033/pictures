import { armarEscena, type Escena } from "./escena";

/**
 * **Los montones de piso dentro de la sala** (`compilar-lectura.ts`): un montón grande y puesto muy atrás (o muy a un lado) por la profundidad de su pie
 * en la foto podía atravesar la pared del fondo (el de la derecha de la foto del cumpleaños, 19 cm adentro). Una vez armados, los que se salen se corren
 * lo justo hacia dentro. Solo se mueve un montón que está en el piso o suelto; si no cabe de ancho, queda centrado en su lado y se avisa.
 */

/** Separación (cm) que se deja entre el montón y la pared. */
const HOLGURA_CM = 2;

export function montonesDentroDeLaSala(escena: Escena, ids: readonly string[], notas: string[]): Escena {
  if (!ids.length) return escena;
  const { anchoCm, fondoCm } = escena.sala;
  const montones = escena.nodos.filter((n) => ids.includes(n.id) && (n.colocacion.en === "piso" || n.colocacion.en === "libre"));
  const cajas = new Map(armarEscena({ ...escena, nodos: montones }).porNodo.map((n) => [n.id, n.caja]));
  const nodos = escena.nodos.map((n) => {
    const c = cajas.get(n.id);
    if (!c || (n.colocacion.en !== "piso" && n.colocacion.en !== "libre")) return n;
    const dz = Math.max(0, -fondoCm / 2 + HOLGURA_CM - c.min.z) - Math.max(0, c.max.z - (fondoCm / 2 - HOLGURA_CM));
    const dx = Math.max(0, -anchoCm / 2 + HOLGURA_CM - c.min.x) - Math.max(0, c.max.x - (anchoCm / 2 - HOLGURA_CM));
    if (Math.abs(dz) < 0.5 && Math.abs(dx) < 0.5) return n;
    notas.push(`«${n.nombre}» se salía de la sala (${Math.abs(dz) >= 0.5 ? `${Math.round(Math.abs(dz))} cm por ${dz > 0 ? "la pared del fondo" : "el frente"}` : ""}${Math.abs(dz) >= 0.5 && Math.abs(dx) >= 0.5 ? ", " : ""}${Math.abs(dx) >= 0.5 ? `${Math.round(Math.abs(dx))} cm por un lado` : ""}): se corrió hacia dentro.`);
    return { ...n, colocacion: { ...n.colocacion, xCm: Math.round((n.colocacion.xCm + dx) * 10) / 10, zCm: Math.round((n.colocacion.zCm + dz) * 10) / 10 } };
  });
  return { ...escena, nodos };
}

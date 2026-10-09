import type { Escena, NodoEscena } from "./escena";
import { entradaDeCatalogo, type FondoCatalogo } from "./fondos-escenografia";

/**
 * Cómo se **cuenta el mobiliario por lo que es** (su entrada del catálogo y sus asientos reales), nunca por el nombre que le puso el
 * modelo (2026-10-09): la conversación 3d-20261009-103125-92b58a pidió «4 sillas por mesa», el modelo agregó la mesa de 8 sillas
 * llamándola «Mesa redonda 1 con 4 sillas» y la verificación repitió ese nombre, que alimentó cuatro respuestas falsas. Puro y sin red.
 */

export type MuebleDeNodo = { entrada: FondoCatalogo; asientos: number; esMesa: boolean };

/** La entrada del catálogo que es este nodo y cuántos asientos trae; null si no es un mueble o fondo del catálogo. */
export function muebleDeNodo(n: NodoEscena): MuebleDeNodo | null {
  if (n.pieza.tipo !== "escenografia" || !n.pieza.mueble) return null;
  const entrada = entradaDeCatalogo(n.pieza.mueble.id);
  if (!entrada) return null;
  const asientos = entrada.clase === "mueble" ? entrada.asientos ?? (entrada.asiento ? 1 : 0) : 0;
  return { entrada, asientos, esMesa: entrada.grupo === "mesa" };
}

/** Los juegos de varias mesas (nido) y las mesas que traen cosas de fábrica (el carrito, la de regalos) no admiten algo encima: su cubierta no es una sola o ya está ocupada. */
const SIN_CUBIERTA_LIBRE = /^(mesas_nido|carrito_dulces|mesa_regalos)/;

/** El id del catálogo si este nodo es una mesa que admite algo encima (no un juego de mesas nido); si no, null. */
export function muebleDeMesa(n: NodoEscena): string | null {
  const id = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined;
  if (!id || SIN_CUBIERTA_LIBRE.test(id)) return null;
  return entradaDeCatalogo(id)?.grupo === "mesa" ? id : null;
}

const r0 = (n: number) => Math.round(n);

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** «Mesa redonda con 8 sillas» (mesa_redonda_sillas): 8 asientos, 270×270×90 cm — todo del catálogo y de las medidas guardadas. */
export function describirMueble(n: NodoEscena): string {
  const m = muebleDeNodo(n);
  if (!m) return `escenografía fuera del catálogo (${n.id})`;
  const o = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.opciones : undefined;
  const partes = [m.entrada.id, ...(m.asientos ? [`${m.asientos} ${plural(m.asientos, "asiento", "asientos")}`] : []), ...(o ? [`${r0(o.anchoCm)}×${r0(o.fondoCm)}×${r0(o.altoCm)} cm`] : [])];
  return `${m.entrada.nombre} (${partes.join(", ")})`;
}

/**
 * Lo que hay de mobiliario en la escena, contado por catálogo: «Mobiliario real: 6 × Mesa redonda con mantel, 24 × Silla Tiffany; 24
 * asientos; mesas con algo encima: 4 de 6.» Vacío si no hay ninguno.
 */
export function resumenDeMobiliario(escena: Escena): string {
  const porNombre = new Map<string, number>();
  let asientos = 0, mesas = 0, conEncima = 0;
  const encima = new Set(escena.nodos.flatMap((n) => (n.colocacion.en === "sobre" ? [n.colocacion.padreId] : [])));
  for (const n of escena.nodos) {
    const m = muebleDeNodo(n);
    if (!m) continue;
    porNombre.set(m.entrada.nombre, (porNombre.get(m.entrada.nombre) ?? 0) + 1);
    asientos += m.asientos;
    if (m.esMesa) { mesas += 1; if (encima.has(n.id)) conEncima += 1; }
  }
  if (!porNombre.size) return "";
  const lista = [...porNombre].map(([nombre, cuantos]) => `${cuantos} × ${nombre}`).join(", ");
  return `Mobiliario real (por catálogo): ${lista}; ${asientos} ${plural(asientos, "asiento", "asientos")}${mesas ? `; mesas con algo encima: ${conEncima} de ${mesas}` : ""}.`;
}

// ----------------------------------------------------------------------------------------------------------
// Un nombre que contradice el catálogo
// ----------------------------------------------------------------------------------------------------------

const NUMEROS: Readonly<Record<string, number>> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const SILLAS_EN_NOMBRE = /\b(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(?:sillas?|asientos?|puestos?)\b/i;

/** Cuántas sillas dice el nombre («Mesa 1 con 4 sillas» → 4); null si no dice ninguna cantidad. */
export function sillasQueDiceElNombre(nombre: string): number | null {
  const m = SILLAS_EN_NOMBRE.exec(nombre);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : NUMEROS[m[1]!.toLowerCase()] ?? null;
}

/** La mesa sola que se usa en vez del conjunto con sillas fijas (el camino para pedir otra cantidad). */
const MESA_SIN_SILLAS: Readonly<Record<string, string>> = { mesa_redonda_sillas: "mesa_redonda_mantel", mesa_imperial_sillas: "mesa_imperial_mantel" };

export type VeredictoNombre = { tipo: "ok" } | { tipo: "corregido"; nombre: string; aviso: string } | { tipo: "error"; error: string };

/**
 * ¿El nombre pedido contradice lo que es el mueble? Con un conjunto de sillas fijas (la mesa de 8 sillas) que dice otra cantidad:
 * error con el camino (`mesa_redonda_mantel` + `silla_tiffany` cantidad N alrededor). Con una pieza que no trae sillas (la mesa sola)
 * o un asiento suelto: se quita la cantidad del nombre y se usa el del catálogo.
 */
export function comprobarNombreMueble(entrada: FondoCatalogo, nombre: string | undefined): VeredictoNombre {
  if (!nombre) return { tipo: "ok" };
  const dicen = sillasQueDiceElNombre(nombre);
  if (dicen === null || entrada.clase !== "mueble" || entrada.grupo !== "mesa") return { tipo: "ok" };
  const reales = entrada.asientos ?? 0;
  if (dicen === reales) return { tipo: "ok" };
  if (reales > 0) {
    const sola = MESA_SIN_SILLAS[entrada.id] ?? entrada.id;
    return {
      tipo: "error",
      error: `El nombre «${nombre}» dice ${dicen} sillas, pero «${entrada.nombre}» (${entrada.id}) trae SIEMPRE ${reales} y no se puede cambiar. Para ${dicen} sillas por mesa: agregar_mobiliario ${sola} y después agregar_mobiliario silla_tiffany con cantidad ${dicen}, disposicion alrededor y alrededor_de = el id de esa mesa. No llames «con ${dicen} sillas» a lo que trae ${reales}.`,
    };
  }
  return {
    tipo: "corregido", nombre: entrada.nombre,
    aviso: `«${entrada.nombre}» no trae sillas: dejé su nombre del catálogo en vez de «${nombre}». Las sillas se agregan aparte con silla_tiffany (cantidad, disposicion alrededor, alrededor_de = su id).`,
  };
}

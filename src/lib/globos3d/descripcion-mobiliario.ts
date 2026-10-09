import type { Escena, NodoEscena } from "./escena";
import { entradaDeCatalogo, type FondoCatalogo } from "./fondos-escenografia";
import { asientosPropios, contarMobiliario, esMesa, tapaDeMesa } from "./mobiliario-asientos-mesa";
import { mesaDePieza, nombreDeMesa, sillasDePieza } from "./mobiliario-conjunto";
import { nombreDeMueble } from "./mobiliario-pieza";
import { SILLAS } from "./mobiliario-sillas-param";
import { asientosDeEntrada } from "./mobiliario-tipos";

/**
 * Cómo se **cuenta el mobiliario por lo que es** (su entrada del catálogo, su mesa paramétrica y sus asientos reales), nunca por el nombre que
 * le puso el modelo (2026-10-09): la conversación 3d-20261009-103125-92b58a pidió «4 sillas por mesa», el modelo agregó la mesa de 8 sillas
 * llamándola «Mesa redonda 1 con 4 sillas» y la verificación repitió ese nombre, que alimentó cuatro respuestas falsas. Los números salen de
 * `mobiliario-asientos-mesa.ts` (la única fuente de mesas y sillas); aquí solo se dicen. Puro y sin red.
 */

export type MuebleDeNodo = {
  /** La entrada del catálogo; null en una mesa o un grupo de sillas paramétricos (no son del catálogo). */
  entrada: FondoCatalogo | null;
  /** El id del catálogo, o `mesa_param` / `sillas_param`. */
  id: string;
  /** Su nombre por lo que es («Mesa redonda con 4 sillas» si el salón le puso 4; «Mesa redonda Ø150»; «Silla Tiffany»), no el que le puso el modelo. */
  nombre: string;
  grupo: string;
  /** Los asientos que lleva esta pieza en sí (`asientosPropios`). */
  asientos: number;
  esMesa: boolean;
  /** Una silla suelta del catálogo (se reparte en fila o alrededor de una mesa) o un grupo de sillas de una mesa paramétrica. */
  esAsiento: boolean;
};

/** Qué mueble es este nodo y cuántos asientos trae; null si no es un mueble o fondo del catálogo ni una mesa o grupo de sillas paramétricos. */
export function muebleDeNodo(n: NodoEscena): MuebleDeNodo | null {
  if (n.pieza.tipo !== "escenografia" || !n.pieza.mueble) return null;
  const mesa = mesaDePieza(n.pieza), grupo = sillasDePieza(n.pieza);
  if (mesa) return { entrada: null, id: n.pieza.mueble.id, nombre: nombreDeMesa(mesa), grupo: "mesa", asientos: 0, esMesa: true, esAsiento: false };
  if (grupo) return { entrada: null, id: n.pieza.mueble.id, nombre: SILLAS[grupo.tipo].nombre, grupo: "asiento", asientos: grupo.puestos.length, esMesa: false, esAsiento: true };
  const entrada = entradaDeCatalogo(n.pieza.mueble.id);
  if (!entrada) return null;
  const nombre = entrada.clase === "mueble" ? nombreDeMueble(entrada, n.pieza.mueble.opciones) : entrada.nombre;
  return { entrada, id: entrada.id, nombre, grupo: entrada.grupo ?? "fondo", asientos: asientosPropios(n), esMesa: esMesa(n), esAsiento: entrada.clase === "mueble" && Boolean(entrada.asiento) };
}

/** El id de la mesa si este nodo es una mesa que admite algo encima (no un juego de mesas nido ni la que trae cosas de fábrica); si no, null. */
export function muebleDeMesa(n: NodoEscena): string | null {
  const tapa = tapaDeMesa(n);
  return tapa && !tapa.deFabricaConCosas ? tapa.id : null;
}

const r0 = (n: number) => Math.round(n);

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** «Mesa redonda con 8 sillas» (mesa_redonda_sillas): 8 asientos, 270×270×90 cm — todo del catálogo y de las medidas guardadas. */
export function describirMueble(n: NodoEscena): string {
  const m = muebleDeNodo(n);
  if (!m) return `escenografía fuera del catálogo (${n.id})`;
  const o = n.pieza.tipo === "escenografia" ? n.pieza.mueble?.opciones : undefined;
  const partes = [m.id, ...(m.asientos ? [`${m.asientos} ${plural(m.asientos, "asiento", "asientos")}`] : []), ...(o ? [`${r0(o.anchoCm)}×${r0(o.fondoCm)}×${r0(o.altoCm)} cm`] : [])];
  return `${m.nombre} (${partes.join(", ")})`;
}

/**
 * Lo que hay de mobiliario en la escena, contado por lo que es: «Mobiliario real: 6 × Mesa redonda Ø150, 24 × Silla Tiffany; 24 asientos;
 * mesas con algo encima: 4 de 6.» Vacío si no hay ninguno.
 */
export function resumenDeMobiliario(escena: Escena): string {
  const porNombre = new Map<string, number>();
  const encima = new Set(escena.nodos.flatMap((n) => (n.colocacion.en === "sobre" && !sillasDePieza(n.pieza) ? [n.colocacion.padreId] : [])));
  let conEncima = 0;
  for (const n of escena.nodos) {
    const m = muebleDeNodo(n);
    if (!m) continue;
    // Un grupo de sillas cuenta cada silla (24 sillas de 6 mesas son 24, no 6).
    porNombre.set(m.nombre, (porNombre.get(m.nombre) ?? 0) + (m.esAsiento ? m.asientos : 1));
    if (m.esMesa && encima.has(n.id)) conEncima += 1;
  }
  if (!porNombre.size) return "";
  const { mesas, sillas } = contarMobiliario(escena);
  const lista = [...porNombre].map(([nombre, cuantos]) => `${cuantos} × ${nombre}`).join(", ");
  return `Mobiliario real (por lo que es cada pieza): ${lista}; ${sillas} ${plural(sillas, "asiento", "asientos")}${mesas ? `; mesas con algo encima: ${conEncima} de ${mesas}` : ""}.`;
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

/** La mesa sola que se usa en vez del conjunto con sillas fijas (el camino con piezas del catálogo para pedir otra cantidad). */
const MESA_SIN_SILLAS: Readonly<Record<string, string>> = { mesa_redonda_sillas: "mesa_redonda_mantel", mesa_redonda10_sillas: "mesa_redonda_mantel", mesa_imperial_sillas: "mesa_imperial_mantel" };

export type VeredictoNombre = { tipo: "ok" } | { tipo: "corregido"; nombre: string; aviso: string } | { tipo: "error"; error: string };

/**
 * ¿El nombre pedido contradice lo que es el mueble? Con un conjunto de sillas del catálogo que dice otra cantidad que la que trae
 * (`opciones.sillas` o las de siempre): error con el camino (`agregar_mesas` con sillas_por_mesa N). Con una mesa que no trae sillas o un
 * asiento suelto: se quita la cantidad del nombre y se usa el del catálogo.
 */
export function comprobarNombreMueble(entrada: FondoCatalogo, nombre: string | undefined, opciones?: { sillas?: number }): VeredictoNombre {
  if (!nombre) return { tipo: "ok" };
  const dicen = sillasQueDiceElNombre(nombre);
  if (dicen === null || entrada.clase !== "mueble" || entrada.grupo !== "mesa") return { tipo: "ok" };
  const reales = asientosDeEntrada(entrada, opciones);
  if (dicen === reales) return { tipo: "ok" };
  if (reales > 0) {
    return {
      tipo: "error",
      error: `El nombre «${nombre}» dice ${dicen} sillas, pero «${entrada.nombre}» (${entrada.id}) trae SIEMPRE ${reales} y el nombre no las cambia. Para ${dicen} sillas por mesa lo más simple es agregar_mesas con sillas_por_mesa ${dicen} (o cambiar_sillas); con piezas del catálogo: agregar_mobiliario ${MESA_SIN_SILLAS[entrada.id] ?? entrada.id} y después agregar_mobiliario silla_tiffany con cantidad ${dicen}, disposicion alrededor y alrededor_de = el id de esa mesa. No llames «con ${dicen} sillas» a lo que trae ${reales}.`,
    };
  }
  return {
    tipo: "corregido", nombre: entrada.nombre,
    aviso: `«${entrada.nombre}» no trae sillas: dejé su nombre del catálogo en vez de «${nombre}». Las sillas se ponen con agregar_mesas (sillas_por_mesa) o cambiar_sillas, o sueltas con silla_tiffany (cantidad, disposicion alrededor, alrededor_de = su id).`,
  };
}

/** El error de un nombre que dice otra cantidad de sillas que las que lleva la mesa (`reales`), o null si no hay contradicción. */
export function errorDeNombreConSillas(nombre: string | undefined, reales: number): string | null {
  const dicen = nombre ? sillasQueDiceElNombre(nombre) : null;
  if (dicen === null || dicen === reales) return null;
  return `El nombre «${nombre}» dice ${dicen} sillas, pero la mesa lleva ${reales}: las sillas salen de la pieza (sillas_por_mesa de agregar_mesas, cantidad de cambiar_sillas), no del nombre. Quita la cantidad del nombre o cambia las sillas a ${dicen}.`;
}
